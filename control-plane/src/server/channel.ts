import { existsSync, mkdirSync } from "node:fs"

import { Chat } from "chat"
import { createMemoryState } from "@chat-adapter/state-memory"
import { createBaileysAdapter } from "chat-adapter-baileys"
import type { BaileysAdapter } from "chat-adapter-baileys"
import { DisconnectReason, useMultiFileAuthState } from "baileys"
import QRCode from "qrcode"

import {
  disconnectStatusCode,
  observeBaileysLifecycle,
  phoneFromWhatsAppJid,
  registerWhatsAppMessageHandler,
} from "./channel-bridge"
import {
  ensureSessionRow,
  getAgent,
  getChannel,
  listChannels,
  updateChannel,
} from "./db"
import { channelBus } from "./events"
import { env, paths } from "./env"
import { runPipeline } from "./pipeline"
import { resolveAgentId } from "./routing"
import type { ChannelRecord, ChannelStatus, SessionRecord } from "./types"

interface Connection {
  channelId: string
  adapter: BaileysAdapter
  bot: Chat
  status: ChannelStatus
}

const CONNECTIONS_KEY = Symbol.for("sarvam-control-plane.channels")
const globals = globalThis as typeof globalThis & {
  [CONNECTIONS_KEY]?: Map<string, Connection>
}
const connections =
  globals[CONNECTIONS_KEY] ??
  (globals[CONNECTIONS_KEY] = new Map<string, Connection>())

function setStatus(
  channelId: string,
  status: ChannelStatus,
  extra: { phone?: string; error?: string } = {}
) {
  const conn = connections.get(channelId)
  if (conn) conn.status = status
  updateChannel(channelId, {
    status,
    // Keep the last known number while reconnecting — the UI showing the paired
    // number is how you tell a blip apart from a logout.
    phone: extra.phone ?? (status === "disconnected" ? null : undefined),
    lastError: extra.error ?? null,
  })
  channelBus.emit(channelId, { type: "status", status, ...extra })
}

export function channelStatus(channelId: string): ChannelStatus {
  const conn = connections.get(channelId)
  if (conn) return conn.status
  // The playground is always up: it is the control plane itself.
  return getChannel(channelId)?.kind === "playground"
    ? "connected"
    : "disconnected"
}

/**
 * Resolves the session and agent for an inbound peer.
 *
 * A peer that has never written in gets a session on the channel's default
 * agent; one that the control plane has pinned keeps the agent it was pinned to.
 */
export function routeInbound(
  channel: ChannelRecord,
  peerJid: string
): { session: SessionRecord; agentId: string | null; created: boolean } {
  const { session, created } = ensureSessionRow(
    channel.id,
    peerJid,
    channel.defaultAgentId
  )
  return { session, agentId: resolveAgentId(session, channel), created }
}

/**
 * Starts (or returns) the WhatsApp connection for one channel.
 *
 * Multi-tenancy is native to the adapter: a distinct `adapterName` and auth
 * directory per channel means one process can front many numbers.
 */
export async function connectChannel(channelId: string): Promise<void> {
  if (connections.has(channelId)) return

  const channel = getChannel(channelId)
  if (!channel) throw new Error(`unknown channel ${channelId}`)
  if (channel.kind !== "whatsapp") {
    throw new Error(`${channel.kind} channels cannot be paired yet`)
  }

  const authDir = paths.waAuth(channelId)
  mkdirSync(authDir, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  const adapter = createBaileysAdapter({
    adapterName: `channel-${channelId}`.replace(/:/g, "-"),
    auth: { state, saveCreds },
    userName: channel.name,
    onQR: async (qr) => {
      setStatus(channelId, "pairing")
      channelBus.emit(channelId, {
        type: "qr",
        dataUrl: await QRCode.toDataURL(qr),
      })
    },
  })

  observeBaileysLifecycle(adapter, (update) => {
    // Ignore a late close event from a socket that was explicitly disconnected.
    if (connections.get(channelId)?.adapter !== adapter) return

    if (update.connection === "open") {
      setStatus(channelId, "connected", {
        phone: phoneFromWhatsAppJid(adapter.botUserId),
      })
      return
    }

    if (update.connection === "connecting") {
      setStatus(channelId, "pairing")
      return
    }

    if (update.connection === "close") {
      const code = disconnectStatusCode(update.lastDisconnect?.error)
      if (code === DisconnectReason.loggedOut) {
        connections.delete(channelId)
        setStatus(channelId, "disconnected", {
          error: "WhatsApp logged out. Connect again to pair this number.",
        })
      } else {
        // The adapter reconnects automatically, including the expected restart
        // immediately after a successful QR scan.
        setStatus(channelId, "pairing")
      }
    }
  })

  const bot = new Chat({
    userName: channel.name,
    adapters: { whatsapp: adapter },
    state: createMemoryState(),
  })

  // Handlers must be registered before connect() — messages can arrive the
  // instant the socket opens, and an unhandled first message is a lost patient.
  registerWhatsAppMessageHandler(bot, async (thread, message) => {
    if (message.author.isMe) return

    // Re-read the channel every message: its default agent can change between
    // one message and the next, and that change should take effect immediately.
    const current = getChannel(channelId)
    if (!current) return

    const peerJid = thread.id
    const { session, agentId, created } = routeInbound(current, peerJid)
    if (created) {
      channelBus.emit(channelId, {
        type: "session",
        sessionId: session.id,
        peerJid,
        agentId,
      })
    }

    const agent = agentId ? getAgent(agentId) : null
    if (!agent) {
      // Staying silent beats improvising: this number has no agent configured,
      // and a stranger should not get a machine-generated apology either.
      console.warn(
        `[${channelId}] no agent for ${peerJid} — set a default agent on the channel`
      )
      channelBus.emit(channelId, {
        type: "status",
        status: channelStatus(channelId),
        error: `A message from ${peerJid} was ignored: no agent is assigned.`,
      })
      return
    }

    const audio = message.attachments.find(
      (attachment) => attachment.type === "audio"
    )

    try {
      await runPipeline({
        channel: current,
        session,
        agent,
        input: audio
          ? {
              kind: "voice",
              mimeType: audio.mimeType ?? "audio/ogg",
              // Media URLs expire, so fetch inside the pipeline's download
              // stage rather than holding the closure for later.
              fetchAudio: async () => {
                if (!audio.fetchData)
                  throw new Error("attachment has no fetchData")
                return audio.fetchData()
              },
            }
          : { kind: "text", text: message.text },
        delivery: {
          send: async (text, replyAudio) => {
            if (text.trim()) await thread.post(text)
            if (replyAudio?.byteLength) {
              // Audio can't carry a caption, so this is necessarily a second
              // message. It arrives as a playable attachment, not a ptt bubble —
              // the adapter never sets ptt:true and exposes no raw socket.
              await thread.post({
                markdown: "",
                files: [
                  {
                    data: replyAudio,
                    filename: "reply.ogg",
                    mimeType: "audio/ogg",
                  },
                ],
              })
            }
          },
        },
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`[${channelId}] pipeline failed:`, detail)
      await thread
        .post("Sorry — something went wrong on my side. Could you try again?")
        .catch(() => {})
    }
  })

  connections.set(channelId, { channelId, adapter, bot, status: "pairing" })
  setStatus(channelId, "pairing")

  await bot.initialize()
  try {
    await adapter.connect()
  } catch (error) {
    connections.delete(channelId)
    const detail = error instanceof Error ? error.message : String(error)
    setStatus(channelId, "disconnected", { error: detail })
    throw error
  }
}

export async function disconnectChannel(channelId: string): Promise<void> {
  const conn = connections.get(channelId)
  if (!conn) return
  connections.delete(channelId)
  await conn.adapter.disconnect().catch(() => {})
  setStatus(channelId, "disconnected")
}

/**
 * Brings previously paired channels back up at boot.
 *
 * Baileys credentials live in the channel's auth directory, so a channel that
 * was connected when the process stopped can resume without another QR scan —
 * which matters when the alternative is re-pairing a number on stage.
 */
export function reconnectPairedChannels() {
  if (!env.autoReconnectChannels) return
  for (const channel of listChannels()) {
    if (channel.kind !== "whatsapp") continue
    if (channel.status === "disconnected") continue
    if (!existsSync(`${paths.waAuth(channel.id)}/creds.json`)) continue
    connectChannel(channel.id).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[${channel.id}] could not resume: ${detail}`)
    })
  }
}

export async function shutdownChannels() {
  await Promise.all([...connections.keys()].map((id) => disconnectChannel(id)))
}
