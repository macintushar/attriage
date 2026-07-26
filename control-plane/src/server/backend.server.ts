import { readFile } from "node:fs/promises"

import { env, ensureDataDirs, paths } from "./env"
import {
  channelStatus,
  connectChannel,
  disconnectChannel,
  reconnectPairedChannels,
  routeInbound,
} from "./channel"
import {
  channelsUsingAgent,
  countSessions,
  createAgent,
  createChannel,
  deleteAgent,
  deleteChannel,
  deleteSession,
  ensureSessionRow,
  getAgent,
  getChannel,
  getConnectors,
  getSession,
  listAgents,
  listChannelMessages,
  listChannels,
  listMessages,
  listSessions,
  playgroundSessionsFor,
  setConnectors,
  setSessionAgent,
  updateAgent,
  updateChannel,
} from "./db"
import { channelBus, runBus, runTopic } from "./events"
import { runPipeline } from "./pipeline"
import type { PipelineInput } from "./pipeline"
import { PLAYGROUND_CHANNEL_ID, peerLabel, playgroundPeer } from "./routing"
import { chat } from "./sarvam"
import { dockerAvailable, startReaper, stopSession } from "./sandbox"
import { startSarvamShim } from "./sarvam-shim"
import { backfillAudioDurations } from "./audio-backfill"
import type { AgentRecord, ChannelKind, ChannelRecord } from "./types"
import { log, withLogContext } from "./logger"

const STARTED_KEY = Symbol.for("sarvam-control-plane.backend-started")
const globals = globalThis as typeof globalThis & {
  [STARTED_KEY]?: boolean
}

/**
 * Starts long-lived backend services once per process. Keeping the marker on
 * globalThis makes this safe across Vite server-module reloads in development.
 */
function ensureBackendStarted() {
  if (globals[STARTED_KEY]) return
  log.info("backend.starting", {
    provider: env.provider,
    model: env.model,
    sandboxImage: env.sandboxImage,
  })
  ensureDataDirs()
  startReaper()
  startSarvamShim()
  globals[STARTED_KEY] = true
  reconnectPairedChannels()
  void backfillAudioDurations()

  if (!env.sarvamKey) {
    log.warn("backend.sarvam_key_missing")
  }
  log.info("backend.started")
}

const json = (data: unknown, status = 200) => Response.json(data, { status })

/** Server-sent events from an in-memory bus. */
function sse(
  subscribe: (send: (event: unknown) => void) => () => void
): Response {
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (event: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        } catch {
          // Client vanished mid-write; cleanup happens in cancel().
        }
      }
      send({ type: "hello" })
      unsubscribe = subscribe(send)
      // A comment frame keeps the connection alive through idle proxies.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          /* ignore */
        }
      }, 25_000)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}

function agentPayload(agent: AgentRecord) {
  return {
    ...agent,
    connectors: getConnectors(agent.id),
    // Agents no longer own a channel, so the useful summary is the inverse:
    // which channels currently point work at this agent.
    channels: channelsUsingAgent(agent.id).map((channel) => ({
      id: channel.id,
      name: channel.name,
      kind: channel.kind,
      status: channelStatus(channel.id),
      isDefault: channel.defaultAgentId === agent.id,
    })),
  }
}

function channelPayload(channel: ChannelRecord) {
  return {
    ...channel,
    status: channelStatus(channel.id),
    sessionCount: countSessions(channel.id),
    defaultAgentName: channel.defaultAgentId
      ? (getAgent(channel.defaultAgentId)?.name ?? null)
      : null,
  }
}

/**
 * One stored message as the browser sees it — `audioPath` is a server path, so
 * it becomes a URL the media route can serve.
 */
function toMessagePayload(
  sessionId: string,
  message: {
    id: number
    role: string
    kind: string
    text: string
    transcript: string | null
    audioPath: string | null
    createdAt: number
    audioSeconds: number | null
  }
) {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    text: message.text,
    transcript: message.transcript ?? undefined,
    audioUrl: message.audioPath
      ? `/api/media/${sessionId}/${message.audioPath.split("/").pop()}`
      : undefined,
    // Without this a voice note read back from the database renders as 0:00 —
    // which is every voice note in a transcript.
    audioSeconds: message.audioSeconds ?? undefined,
    createdAt: message.createdAt,
  }
}

function messagePayload(sessionId: string) {
  return listMessages(sessionId).map((message) =>
    toMessagePayload(sessionId, message)
  )
}

/** Reads a text or multipart body into one pipeline input. */
async function readInput(request: Request): Promise<PipelineInput | Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData()
    const file = form.get("audio")
    if (!(file instanceof Blob)) return json({ error: "audio required" }, 400)
    return {
      kind: "voice",
      audio: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "audio/ogg",
      audioSeconds: Number(form.get("seconds") ?? 0) || undefined,
    }
  }
  const body = (await request.json()) as { text?: string }
  if (!body.text?.trim()) return json({ error: "text required" }, 400)
  return { kind: "text", text: body.text }
}

/**
 * Handles the application's `/api/*` surface inside the TanStack Start server.
 * `path` is relative to `/api` (for example `/agents`).
 */
async function dispatchBackendRequest(
  request: Request,
  path: string
): Promise<Response> {
  ensureBackendStarted()
  const url = new URL(request.url)

  // ── health ────────────────────────────────────────────────────────────────
  if (path === "/health" && request.method === "GET") {
    return json({
      ok: true,
      docker: await dockerAvailable(),
      sarvamKey: Boolean(env.sarvamKey),
      model: env.model,
      image: env.sandboxImage,
    })
  }

  // ── agents ────────────────────────────────────────────────────────────────
  if (path === "/agents" && request.method === "GET") {
    return json(listAgents().map(agentPayload))
  }

  if (path === "/agents" && request.method === "POST") {
    const body = (await request.json()) as Partial<AgentRecord> & {
      connectors?: ReturnType<typeof getConnectors>
    }
    if (!body.name?.trim()) return json({ error: "name is required" }, 400)
    const agent = createAgent({
      name: body.name,
      voice: body.voice ?? true,
      tools: body.tools ?? [],
      systemPrompt: body.systemPrompt ?? "",
      goal: body.goal ?? "",
      language: body.language ?? "auto",
      ttsSpeaker: body.ttsSpeaker ?? "shubh",
    })
    if (body.connectors?.length) {
      setConnectors(
        agent.id,
        body.connectors.map((connector) => ({
          ...connector,
          agentId: agent.id,
        }))
      )
    }
    return json(agentPayload(agent), 201)
  }

  const agentMatch = path.match(/^\/agents\/([^/]+)(\/.*)?$/)
  if (agentMatch) {
    const agentId = agentMatch.at(1)
    const rest = agentMatch.at(2) ?? ""
    if (!agentId) return json({ error: "bad agent path" }, 400)
    const agent = getAgent(agentId)
    if (!agent) return json({ error: "agent not found" }, 404)

    if (rest === "" && request.method === "GET") {
      return json(agentPayload(agent))
    }

    if (rest === "" && request.method === "PATCH") {
      const patch = (await request.json()) as Partial<AgentRecord> & {
        connectors?: ReturnType<typeof getConnectors>
      }
      const next = updateAgent(agentId, patch)
      if (patch.connectors) {
        setConnectors(
          agentId,
          patch.connectors.map((connector) => ({
            ...connector,
            agentId,
          }))
        )
      }
      return json(agentPayload(next!))
    }

    if (rest === "" && request.method === "DELETE") {
      // Channels that pointed here keep running and report "no agent"; only the
      // agent's own playground sessions go with it.
      for (const session of playgroundSessionsFor(agentId)) {
        if (session.containerId) await stopSession(session.id).catch(() => {})
        deleteSession(session.id)
      }
      deleteAgent(agentId)
      return json({ ok: true })
    }

    // Live run stream for this agent, wherever it runs — the playground plus any
    // channel session currently assigned to it.
    if (rest === "/events" && request.method === "GET") {
      return sse((send) => runBus.subscribe(runTopic.agent(agentId), send))
    }

    // ── playground ──────────────────────────────────────────────────────────
    // The built-in channel runs the identical pipeline; only delivery differs.
    if (rest === "/messages") {
      const peer = playgroundPeer(
        agentId,
        url.searchParams.get("peer") || undefined
      )
      const playground = getChannel(PLAYGROUND_CHANNEL_ID)
      if (!playground) return json({ error: "no playground channel" }, 500)

      if (request.method === "GET") {
        const session = ensureSessionRow(playground.id, peer, agentId, {
          pinned: true,
        }).session
        return json(messagePayload(session.id))
      }

      if (request.method === "POST") {
        const input = await readInput(request)
        if (input instanceof Response) return input
        const { session } = ensureSessionRow(playground.id, peer, agentId, {
          pinned: true,
        })
        // Fire-and-forget: the caller watches /events for progress.
        runPipeline({
          channel: playground,
          session,
          agent,
          input,
          delivery: { send: async () => {} },
        }).catch(() => {})
        return json({ ok: true, sessionId: session.id })
      }
    }
  }

  // ── channels ──────────────────────────────────────────────────────────────
  if (path === "/channels" && request.method === "GET") {
    return json(listChannels().map(channelPayload))
  }

  if (path === "/channels" && request.method === "POST") {
    const body = (await request.json()) as {
      name?: string
      kind?: ChannelKind
      defaultAgentId?: string | null
    }
    if (!body.name?.trim()) return json({ error: "name is required" }, 400)
    const kind = body.kind ?? "whatsapp"
    if (kind === "playground") {
      return json({ error: "the playground channel is built in" }, 400)
    }
    if (body.defaultAgentId && !getAgent(body.defaultAgentId)) {
      return json({ error: "unknown default agent" }, 400)
    }
    const channel = createChannel({
      name: body.name.trim(),
      kind,
      defaultAgentId: body.defaultAgentId ?? null,
    })
    return json(channelPayload(channel), 201)
  }

  const channelMatch = path.match(/^\/channels\/([^/]+)(\/.*)?$/)
  if (channelMatch) {
    const channelId = channelMatch.at(1)
    const rest = channelMatch.at(2) ?? ""
    if (!channelId) return json({ error: "bad channel path" }, 400)
    const channel = getChannel(channelId)
    if (!channel) return json({ error: "channel not found" }, 404)

    if (rest === "" && request.method === "GET") {
      return json(channelPayload(channel))
    }

    if (rest === "" && request.method === "PATCH") {
      const body = (await request.json()) as {
        name?: string
        defaultAgentId?: string | null
      }
      if (body.defaultAgentId && !getAgent(body.defaultAgentId)) {
        return json({ error: "unknown default agent" }, 400)
      }
      const next = updateChannel(channelId, {
        name: body.name?.trim() || undefined,
        // `null` clears the default; `undefined` leaves it alone.
        defaultAgentId:
          body.defaultAgentId === undefined ? undefined : body.defaultAgentId,
      })
      return json(channelPayload(next!))
    }

    if (rest === "" && request.method === "DELETE") {
      if (channel.kind === "playground") {
        return json({ error: "the playground channel cannot be deleted" }, 400)
      }
      await disconnectChannel(channelId).catch(() => {})
      for (const session of listSessions(channelId)) {
        if (session.containerId) await stopSession(session.id).catch(() => {})
      }
      deleteChannel(channelId)
      return json({ ok: true })
    }

    // Pairing: POST starts it, GET streams QR + status.
    if (rest === "/connect" && request.method === "POST") {
      connectChannel(channelId).catch((error) => {
        channelBus.emit(channelId, {
          type: "status",
          status: "disconnected",
          error: error instanceof Error ? error.message : String(error),
        })
      })
      return json({ ok: true, status: channelStatus(channelId) })
    }

    if (rest === "/connect" && request.method === "DELETE") {
      await disconnectChannel(channelId)
      return json({ ok: true })
    }

    if (rest === "/connect" && request.method === "GET") {
      return sse((send) => {
        send({
          type: "status",
          status: channelStatus(channelId),
          phone: channel.phone ?? undefined,
          error: channel.lastError ?? undefined,
        })
        return channelBus.subscribe(channelId, send)
      })
    }

    // Every run on this channel, across all of its sessions.
    if (rest === "/events" && request.method === "GET") {
      return sse((send) => runBus.subscribe(runTopic.channel(channelId), send))
    }

    if (rest === "/sessions" && request.method === "GET") {
      return json(
        listSessions(channelId).map((session) => ({
          ...session,
          peerLabel: peerLabel(session.peerJid),
          agentName: session.agentId
            ? (getAgent(session.agentId)?.name ?? null)
            : null,
          // What would answer right now, which is not session.agentId when the
          // session is unpinned and the channel default has since moved.
          effectiveAgentId: session.agentPinned
            ? session.agentId
            : (channel.defaultAgentId ?? session.agentId),
        }))
      )
    }

    // Open a session against a specific peer by hand — used to send the first
    // message to a number, and to test a channel without waiting for one.
    if (rest === "/sessions" && request.method === "POST") {
      const body = (await request.json()) as {
        peerJid?: string
        agentId?: string | null
      }
      if (!body.peerJid?.trim()) return json({ error: "peerJid required" }, 400)
      const { session, created } = ensureSessionRow(
        channelId,
        body.peerJid.trim(),
        body.agentId ?? channel.defaultAgentId,
        { pinned: Boolean(body.agentId) }
      )
      return json(session, created ? 201 : 200)
    }

    // Everything said on this channel, grouped back into conversations. Feeds
    // the read-only transcript tab, which reviews history instead of replying,
    // so there is no POST counterpart here on purpose.
    if (rest === "/messages" && request.method === "GET") {
      const search = url.searchParams.get("q")?.trim() || undefined
      const requested = Number(url.searchParams.get("limit"))
      // Mirrors the clamp inside listChannelMessages so `truncated` below is
      // compared against the cap that actually applied.
      const limit = Math.max(
        1,
        Math.min(requested > 0 ? requested : 2_000, 5_000)
      )
      const rows = listChannelMessages(channelId, { search, limit })

      const bySession = new Map<string, typeof rows>()
      for (const row of rows) {
        const bucket = bySession.get(row.sessionId)
        if (bucket) bucket.push(row)
        else bySession.set(row.sessionId, [row])
      }

      // listSessions is already ordered by lastActiveAt DESC, so conversations
      // come out newest-active first. A search drops the ones with no match.
      const sessions = listSessions(channelId)
        .filter((session) => bySession.has(session.id))
        .map((session) => ({
          id: session.id,
          peerJid: session.peerJid,
          peerLabel: peerLabel(session.peerJid),
          agentId: session.agentId,
          agentName: session.agentId
            ? (getAgent(session.agentId)?.name ?? null)
            : null,
          lastActiveAt: session.lastActiveAt,
          // The conversation's real length, not the filtered count, so a search
          // still says how much history sits behind the matches.
          messageCount: session.messageCount,
          messages: (bySession.get(session.id) ?? [])
            .slice()
            .reverse()
            .map((row) => toMessagePayload(session.id, row)),
        }))

      return json({
        sessions,
        totalMessages: rows.length,
        truncated: rows.length >= limit,
      })
    }
  }

  // ── sessions ──────────────────────────────────────────────────────────────
  const sessionMatch = path.match(/^\/sessions\/([^/]+)(\/.*)?$/)
  if (sessionMatch) {
    const sessionId = sessionMatch.at(1)
    const rest = sessionMatch.at(2) ?? ""
    if (!sessionId) return json({ error: "bad session path" }, 400)
    const session = getSession(sessionId)
    if (!session) return json({ error: "session not found" }, 404)
    const channel = getChannel(session.channelId)
    if (!channel) return json({ error: "channel not found" }, 404)

    if (rest === "" && request.method === "GET") {
      const { session: fresh, agentId } = routeInbound(channel, session.peerJid)
      return json({
        ...fresh,
        peerLabel: peerLabel(fresh.peerJid),
        channelName: channel.name,
        channelKind: channel.kind,
        channelDefaultAgentId: channel.defaultAgentId,
        effectiveAgentId: agentId,
        effectiveAgentName: agentId ? (getAgent(agentId)?.name ?? null) : null,
        messages: messagePayload(fresh.id),
      })
    }

    // Assign this one conversation to a different agent, or clear the override
    // and put it back under the channel's default.
    if (rest === "" && request.method === "PATCH") {
      const body = (await request.json()) as { agentId?: string | null }
      if (body.agentId && !getAgent(body.agentId)) {
        return json({ error: "unknown agent" }, 400)
      }
      const next = body.agentId
        ? setSessionAgent(sessionId, body.agentId, true)
        : setSessionAgent(sessionId, channel.defaultAgentId, false)
      return json(next)
    }

    if (rest === "" && request.method === "DELETE") {
      // Drops the container and the transcript. The workspace on disk survives,
      // so an accidental reset is recoverable by hand.
      if (session.containerId) await stopSession(sessionId).catch(() => {})
      deleteSession(sessionId)
      return json({ ok: true })
    }

    if (rest === "/events" && request.method === "GET") {
      return sse((send) => runBus.subscribe(runTopic.session(sessionId), send))
    }

    // Send into a session as the operator — the reply goes out over the real
    // channel when there is one, so this is how you nudge a stalled chat.
    if (rest === "/messages" && request.method === "POST") {
      const { agentId } = routeInbound(channel, session.peerJid)
      const agent = agentId ? getAgent(agentId) : null
      if (!agent) return json({ error: "no agent assigned" }, 409)
      const input = await readInput(request)
      if (input instanceof Response) return input
      runPipeline({
        channel,
        session,
        agent,
        input,
        delivery: { send: async () => {} },
      }).catch(() => {})
      return json({ ok: true })
    }
  }

  // ── media playback ────────────────────────────────────────────────────────
  const media = path.match(/^\/media\/([^/]+)\/([^/]+)$/)
  if (media && request.method === "GET") {
    const sessionId = media.at(1)
    const name = media.at(2)
    if (!sessionId || !name || name.includes("..")) {
      return json({ error: "bad path" }, 400)
    }
    try {
      const file = await readFile(
        `${paths.sessionDir(sessionId)}/media/${name}`
      )
      return new Response(new Uint8Array(file), {
        headers: { "content-type": "audio/ogg" },
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") return json({ error: "not found" }, 404)
      throw error
    }
  }

  // ── prompt assistant (used by the wizard's "Improve with AI") ─────────────
  if (path === "/assist/prompt" && request.method === "POST") {
    const body = (await request.json()) as {
      prompt?: string
      instruction?: string
    }
    if (!body.prompt || !body.instruction) {
      return json({ error: "prompt and instruction are required" }, 400)
    }
    try {
      const revised = await chat([
        {
          role: "system",
          content:
            "You edit system prompts for WhatsApp customer-service agents. " +
            "Apply the user's instruction to their prompt and return ONLY the " +
            "full revised prompt in markdown. Preserve existing structure and " +
            "headings unless the instruction says otherwise. No commentary.",
        },
        {
          role: "user",
          content: `Instruction: ${body.instruction}\n\n---\n\n${body.prompt}`,
        },
      ])
      return json({ prompt: revised.trim() || body.prompt })
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        502
      )
    }
  }

  return json({ error: "not found" }, 404)
}

/**
 * Logs every REST request at the shared boundary. Body contents and headers are
 * deliberately excluded: prompts, messages, cookies, and credentials must not
 * leak into application logs.
 */
export async function handleBackendRequest(
  request: Request,
  path: string
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID()
  const startedAt = performance.now()
  return withLogContext({ requestId }, async () => {
    log.info("http.request.started", {
      method: request.method,
      path,
      contentType: request.headers.get("content-type") ?? undefined,
      contentLength: request.headers.get("content-length") ?? undefined,
    })
    try {
      const response = await dispatchBackendRequest(request, path)
      response.headers.set("x-request-id", requestId)
      log.info("http.request.completed", {
        method: request.method,
        path,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return response
    } catch (error) {
      log.error("http.request.failed", {
        method: request.method,
        path,
        durationMs: Math.round(performance.now() - startedAt),
        error,
      })
      throw error
    }
  })
}
