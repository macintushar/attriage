import { useCallback, useEffect, useState } from "react"

import { apiFetch } from "./api"

export type ChannelKind = "whatsapp" | "playground" | "telegram" | "webchat"

export type ChannelStatus = "disconnected" | "pairing" | "connected"

export interface Channel {
  id: string
  name: string
  kind: ChannelKind
  /** Agent every new session on this channel starts with. */
  defaultAgentId: string | null
  defaultAgentName: string | null
  status: ChannelStatus
  /** The paired number, once a WhatsApp channel connects. */
  phone: string | null
  lastError: string | null
  sessionCount: number
  createdAt: number
}

export interface Session {
  id: string
  channelId: string
  peerJid: string
  peerLabel: string
  agentId: string | null
  agentName: string | null
  /** True when someone assigned this conversation an agent by hand. */
  agentPinned: boolean
  /** What would answer right now — the pin, or the channel's current default. */
  effectiveAgentId: string | null
  containerId: string | null
  status: string
  messageCount: number
  lastMessageAt: number | null
  lastMessage: string | null
  createdAt: number
  lastActiveAt: number
}

export const CHANNEL_KINDS: {
  id: ChannelKind
  label: string
  desc: string
  available: boolean
}[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    desc: "Pairs with a real number over WhatsApp Web",
    available: true,
  },
  {
    id: "telegram",
    label: "Telegram",
    desc: "Telegram Bot API",
    available: false,
  },
  {
    id: "webchat",
    label: "Web chat",
    desc: "Embeddable widget",
    available: false,
  },
]

export function channelKindLabel(kind: ChannelKind): string {
  return (
    CHANNEL_KINDS.find((k) => k.id === kind)?.label ??
    (kind === "playground" ? "Playground" : kind)
  )
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `failed to ${what}: ${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchChannels(): Promise<Channel[]> {
  return readJson(await apiFetch("/api/channels"), "load channels")
}

export async function fetchChannel(id: string): Promise<Channel | null> {
  const res = await apiFetch(`/api/channels/${id}`)
  if (res.status === 404) return null
  return readJson(res, "load channel")
}

export async function createChannel(input: {
  name: string
  kind: ChannelKind
  defaultAgentId: string | null
}): Promise<Channel> {
  return readJson(
    await apiFetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    "create channel"
  )
}

export async function updateChannel(
  id: string,
  patch: { name?: string; defaultAgentId?: string | null }
): Promise<Channel> {
  return readJson(
    await apiFetch(`/api/channels/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "save channel"
  )
}

export async function deleteChannel(id: string) {
  await apiFetch(`/api/channels/${id}`, { method: "DELETE" })
}

export async function fetchSessions(channelId: string): Promise<Session[]> {
  return readJson(
    await apiFetch(`/api/channels/${channelId}/sessions`),
    "load sessions"
  )
}

/** One stored message, as both the session detail and the transcript return it. */
export interface TranscriptMessage {
  id: number
  role: "user" | "agent"
  kind: "text" | "voice"
  text: string
  transcript?: string
  audioUrl?: string
  /** Voice-note length, measured server-side from the audio. */
  audioSeconds?: number
  createdAt: number
}

export interface SessionDetail extends Session {
  channelName: string
  channelKind: ChannelKind
  channelDefaultAgentId: string | null
  effectiveAgentName: string | null
  messages: TranscriptMessage[]
}

export async function fetchSession(id: string): Promise<SessionDetail | null> {
  const res = await apiFetch(`/api/sessions/${id}`)
  if (res.status === 404) return null
  return readJson(res, "load session")
}

/** One conversation's worth of a channel transcript. */
export interface TranscriptSession {
  id: string
  peerJid: string
  peerLabel: string
  agentId: string | null
  agentName: string | null
  lastActiveAt: number
  /** The whole conversation's length, even when a search narrows `messages`. */
  messageCount: number
  messages: TranscriptMessage[]
}

export interface ChannelTranscript {
  sessions: TranscriptSession[]
  totalMessages: number
  /** The row cap was reached, so older messages are not in this response. */
  truncated: boolean
}

export async function fetchChannelTranscript(
  channelId: string,
  opts: { search?: string } = {}
): Promise<ChannelTranscript> {
  const params = opts.search?.trim()
    ? `?q=${encodeURIComponent(opts.search.trim())}`
    : ""
  return readJson(
    await apiFetch(`/api/channels/${channelId}/messages${params}`),
    "load transcript"
  )
}

/** `null` clears the override and returns the session to the channel default. */
export async function assignSessionAgent(
  sessionId: string,
  agentId: string | null
) {
  return readJson(
    await apiFetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    }),
    "assign agent"
  )
}

export async function deleteSession(id: string) {
  await apiFetch(`/api/sessions/${id}`, { method: "DELETE" })
}

/** Channel list with a manual refresh, used by the channels index. */
export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setChannels(await fetchChannels())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { channels, error, reload }
}

/**
 * Sessions for one channel, refreshed on an interval.
 *
 * Polling rather than SSE: a new WhatsApp peer appears at human speed, and the
 * list has to stay right after an agent reassignment made in another tab too.
 */
export function useSessions(channelId: string | undefined, intervalMs = 5_000) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!channelId) return
    try {
      setSessions(await fetchSessions(channelId))
    } catch {
      // Leave the last good list on screen rather than blanking it.
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), intervalMs)
    return () => clearInterval(timer)
  }, [reload, intervalMs])

  return { sessions, loading, reload }
}
