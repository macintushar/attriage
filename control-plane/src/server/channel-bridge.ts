import type { DirectMessageHandler, MessageHandler } from "chat"
import type { BaileysAdapter } from "chat-adapter-baileys"
import type { ConnectionState } from "baileys"

import { audioDuration } from "./audio"

type WhatsAppBot = {
  onDirectMessage: (handler: DirectMessageHandler) => void
  onNewMessage: (pattern: RegExp, handler: MessageHandler) => void
}

type ConnectionListener = (update: Partial<ConnectionState>) => void

type AdapterInternals = {
  _socket: {
    ev: {
      on: (event: "connection.update", listener: ConnectionListener) => void
    }
    sendMessage: (
      jid: string,
      message: {
        audio: Buffer
        mimetype: "audio/ogg; codecs=opus"
        ptt: true
        seconds?: number
      }
    ) => Promise<unknown>
  } | null
  _createSocket: () => Promise<void>
}

/**
 * Chat SDK routes direct messages before regex message handlers. Register the
 * same pipeline for both DMs and non-DM threads (for example WhatsApp groups).
 */
export function registerWhatsAppMessageHandler(
  bot: WhatsAppBot,
  handler: MessageHandler
) {
  bot.onDirectMessage((thread, message) => handler(thread, message))
  bot.onNewMessage(/[\s\S]*/, handler)
}

/**
 * The Baileys adapter owns reconnection but does not currently expose its
 * connection.update events. Wrap its socket factory so every initial or
 * replacement socket reports its real lifecycle to the control plane.
 *
 * Keep this compatibility shim isolated: if the adapter removes these
 * internals, connecting fails visibly instead of leaving the UI in "pairing".
 */
export function observeBaileysLifecycle(
  adapter: BaileysAdapter,
  listener: ConnectionListener
) {
  const internals = adapter as unknown as AdapterInternals
  if (typeof internals._createSocket !== "function") {
    throw new Error(
      "installed Baileys adapter does not expose a connection lifecycle"
    )
  }

  const createSocket = internals._createSocket.bind(adapter)
  internals._createSocket = async () => {
    await createSocket()
    if (!internals._socket) {
      throw new Error("Baileys adapter created no WhatsApp socket")
    }
    internals._socket.ev.on("connection.update", listener)
  }
}

export function phoneFromWhatsAppJid(jid: string | undefined) {
  const phone = jid?.split("@", 1)[0]?.split(":", 1)[0]
  return phone ? `+${phone}` : undefined
}

/**
 * Send synthesized speech as an actual WhatsApp voice note.
 *
 * The adapter's generic file API deliberately omits Baileys' `ptt` flag. Using
 * it here made the text half of a reply succeed while the audio half could be
 * dropped or rendered as an ordinary file. Keep this provider-specific detail
 * beside the other adapter compatibility shims.
 */
export async function sendWhatsAppVoiceNote(
  adapter: BaileysAdapter,
  threadId: string,
  audio: Buffer
) {
  if (!audio.byteLength) throw new Error("cannot send an empty voice note")

  const internals = adapter as unknown as AdapterInternals
  if (!internals._socket) {
    throw new Error("WhatsApp socket is not connected")
  }

  if (audio.toString("latin1", 0, 4) !== "OggS") {
    throw new Error("voice note is not an Ogg/Opus attachment")
  }

  const { jid } = adapter.decodeThreadId(threadId)
  const seconds = audioDuration(audio)
  await internals._socket.sendMessage(jid, {
    audio,
    mimetype: "audio/ogg; codecs=opus",
    ptt: true,
    ...(seconds ? { seconds } : {}),
  })
}

export function disconnectStatusCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  const output = (error as { output?: unknown }).output
  if (!output || typeof output !== "object") return undefined
  const statusCode = (output as { statusCode?: unknown }).statusCode
  return typeof statusCode === "number" ? statusCode : undefined
}
