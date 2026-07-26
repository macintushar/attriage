import { useEffect, useSyncExternalStore } from "react"

import { apiFetch } from "./api"
import type { ChannelKind, ChannelStatus } from "./channels-store"

export interface ConnectorBinding {
  slug: string
  connectionName: string
  allowedActions: string[]
  /** Secret field → env var NAME. Values never travel through the browser. */
  credentialEnv: Record<string, string>
  /** Non-secret connector config (base_url, api_version, path…). */
  config: Record<string, string>
}

/** Where an agent is currently reachable. Set by channel config, not here. */
export interface AgentChannelRef {
  id: string
  name: string
  kind: ChannelKind
  status: ChannelStatus
  /** True when the channel hands every new session to this agent. */
  isDefault: boolean
}

/**
 * An agent is behaviour only — no channel, no number. Which channels route to
 * it is configured on the channel side; `channels` is the read-only summary.
 */
export interface AgentConfig {
  id: string
  name: string
  /** Text is always on; voice is the optional capability */
  voice: boolean
  tools: string[]
  systemPrompt: string
  /** Free-text multi-step objective, fed into the system prompt */
  goal: string
  /** "auto" or a BCP-47 code; drives STT hinting and TTS language */
  language: string
  ttsSpeaker: string
  createdAt: number
  connectors?: ConnectorBinding[]
  channels?: AgentChannelRef[]
}

/** bulbul:v3 voices. The full set is 37; these read well for support agents. */
export const TTS_SPEAKERS = [
  "shubh",
  "ritu",
  "priya",
  "aditya",
  "kavya",
  "rahul",
  "neha",
  "dev",
]

export const LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "hi-IN", label: "Hindi" },
  { code: "en-IN", label: "English (India)" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "mr-IN", label: "Marathi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "od-IN", label: "Odia" },
]

// ── client-side cache ───────────────────────────────────────────────────────
// The server is the source of truth; this is a snapshot so the existing
// useSyncExternalStore call sites keep working unchanged.

let agents: AgentConfig[] = []
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function fetchAgents(): Promise<AgentConfig[]> {
  const res = await apiFetch("/api/agents")
  if (!res.ok) throw new Error(`failed to load agents: ${res.status}`)
  agents = (await res.json()) as AgentConfig[]
  loaded = true
  emit()
  return agents
}

/** Reactive list. Triggers one fetch on first mount. */
export function useAgents(): AgentConfig[] {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => agents,
    () => agents
  )
  useEffect(() => {
    if (!loaded) void fetchAgents().catch(() => {})
  }, [])
  return snapshot
}

export function getCachedAgent(id: string) {
  return agents.find((a) => a.id === id)
}

export async function fetchAgent(id: string): Promise<AgentConfig | null> {
  const res = await apiFetch(`/api/agents/${id}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`failed to load agent: ${res.status}`)
  const agent = (await res.json()) as AgentConfig
  agents = agents.some((a) => a.id === agent.id)
    ? agents.map((a) => (a.id === agent.id ? agent : a))
    : [...agents, agent]
  emit()
  return agent
}

export async function addAgent(
  config: Omit<AgentConfig, "id" | "createdAt">
): Promise<AgentConfig> {
  const res = await apiFetch("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `failed to create agent: ${res.status}`)
  }
  const agent = (await res.json()) as AgentConfig
  agents = [agent, ...agents]
  emit()
  return agent
}

export async function updateAgent(id: string, patch: Partial<AgentConfig>) {
  // Optimistic: the prompt editor writes on a debounce and shouldn't flicker.
  agents = agents.map((a) => (a.id === id ? { ...a, ...patch } : a))
  emit()
  const res = await apiFetch(`/api/agents/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`failed to save agent: ${res.status}`)
  const agent = (await res.json()) as AgentConfig
  agents = agents.map((a) => (a.id === id ? agent : a))
  emit()
  return agent
}

export async function deleteAgent(id: string) {
  agents = agents.filter((a) => a.id !== id)
  emit()
  await apiFetch(`/api/agents/${id}`, { method: "DELETE" })
}
