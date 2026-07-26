/**
 * Wire types emitted by the TanStack Start backend.
 *
 * `ChatMessage`, `Stage`, `StageStatus` and `PipelineRun` keep the exact shape
 * the mock UI already renders (control-plane/src/lib/mock-agent.ts), so the
 * chat and trace panels needed almost no change when the mock was replaced.
 * The additions are `StageId "sandbox"`, `Stage.steps` and `ChatMessage.createdAt`.
 */

export type MessageKind = "text" | "voice"

export interface ChatMessage {
  id: number
  role: "user" | "agent"
  kind: MessageKind
  text: string
  /** Filled in after the STT stage completes (voice messages only) */
  transcript?: string
  audioSeconds?: number
  /** Relative URL the browser can play the agent's TTS reply from */
  audioUrl?: string
  createdAt: number
}

export type StageStatus = "idle" | "running" | "done" | "skipped" | "error"

export type StageId =
  "receive" | "download" | "stt" | "sandbox" | "agent" | "tts" | "send"

/** One Pi tool call, nested under the `agent` stage in the trace. */
export interface AgentStep {
  id: string
  tool: string
  label: string
  status: "running" | "done" | "error"
  detail?: string
  ms?: number
}

export interface Stage {
  id: StageId
  label: string
  service: string
  voiceOnly: boolean
  status: StageStatus
  detail?: string
  ms?: number
  steps?: AgentStep[]
}

export interface PipelineRun {
  id: number
  kind: MessageKind
  stages: Stage[]
  startedAt: number
  totalMs?: number
}

export type RunEvent =
  | { type: "run_start"; run: PipelineRun }
  | { type: "stage"; runId: number; stage: Stage }
  | { type: "step"; runId: number; step: AgentStep }
  | { type: "message"; message: ChatMessage }
  | { type: "message_patch"; id: number; patch: Partial<ChatMessage> }
  | { type: "run_end"; runId: number; totalMs: number }
  | { type: "error"; runId?: number; message: string }

export type ChannelEvent =
  | { type: "qr"; dataUrl: string }
  | { type: "status"; status: ChannelStatus; phone?: string; error?: string }
  /** A peer we had never seen before opened a session on this channel. */
  | { type: "session"; sessionId: string; peerJid: string; agentId: string | null }

export type ChannelStatus = "disconnected" | "pairing" | "connected"

export const STAGE_DEFS: Array<Omit<Stage, "status">> = [
  {
    id: "receive",
    label: "Message received",
    // Overridden per run with the channel's own name — the pipeline is shared,
    // but the trace should say which channel it came in on.
    service: "Channel",
    voiceOnly: false,
  },
  {
    id: "download",
    label: "Download voice note",
    service: "Channel",
    voiceOnly: true,
  },
  {
    id: "stt",
    label: "Speech to text",
    service: "Sarvam Saaras v3 · STT",
    voiceOnly: true,
  },
  {
    id: "sandbox",
    label: "Sandbox ready",
    service: "Docker · per session",
    voiceOnly: false,
  },
  {
    id: "agent",
    label: "Agent run",
    service: "Pi · Sarvam-105B",
    voiceOnly: false,
  },
  {
    id: "tts",
    label: "Text to speech",
    service: "Sarvam Bulbul v3 · TTS",
    voiceOnly: true,
  },
  {
    id: "send",
    label: "Reply sent",
    service: "Channel",
    voiceOnly: false,
  },
]

/** Trace label for the receive/send stages of a run on this channel. */
export function channelService(kind: ChannelKind, name: string): string {
  const transport: Record<ChannelKind, string> = {
    whatsapp: "WhatsApp · Baileys",
    playground: "Attriage",
    telegram: "Telegram Bot API",
    webchat: "Web chat",
  }
  return `${name} · ${transport[kind]}`
}

/**
 * An agent is pure behaviour — prompt, tools, voice. It is deliberately not
 * bound to a channel: the same agent can answer WhatsApp, the playground, and
 * (later) Telegram, and a channel can hand different sessions to different
 * agents.
 */
export interface AgentRecord {
  id: string
  name: string
  voice: boolean
  tools: string[]
  systemPrompt: string
  goal: string
  language: string
  ttsSpeaker: string
  createdAt: number
}

/**
 * `playground` is the built-in channel behind the in-app chat and `try-turn`.
 * Giving it the same shape as WhatsApp means one session model, one pipeline,
 * and no "the playground works but production doesn't" class of bug.
 */
export type ChannelKind = "whatsapp" | "playground" | "telegram" | "webchat"

export interface ChannelRecord {
  id: string
  name: string
  kind: ChannelKind
  /** Agent handed every new session, unless the session is pinned elsewhere. */
  defaultAgentId: string | null
  status: ChannelStatus
  /** The paired number, once a WhatsApp channel connects. */
  phone: string | null
  lastError: string | null
  createdAt: number
}

export interface SessionRecord {
  id: string
  channelId: string
  /** Channel-scoped peer identity — a WhatsApp JID, or `agent:<id>` in the playground. */
  peerJid: string
  /**
   * The peer's WhatsApp display name, as they set it. Self-chosen and
   * unverified — a hint about who is writing, never an identity.
   */
  peerName: string | null
  /** Resolved agent for this session. Null only if the channel has no default. */
  agentId: string | null
  /** True once someone overrode the agent here; pinned sessions ignore the default. */
  agentPinned: boolean
  workdir: string
  containerId: string | null
  status: string
  createdAt: number
  lastActiveAt: number
}

export interface ConnectorBinding {
  agentId: string
  slug: string
  connectionName: string
  allowedActions: string[]
  /** Secret field → env var name. Values never leave the server. */
  credentialEnv: Record<string, string>
  /**
   * Non-secret connector config (base_url, api_version, path, repository…).
   * Safe to store and display; passed to `pm credentials add --config k=v`.
   * `$WORKSPACE` expands to /workspace inside the sandbox.
   */
  config: Record<string, string>
}
