import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Live agent runs over SSE.
 *
 * `ChatMessage`, `Stage`, `StageStatus` and `PipelineRun` keep the shape the
 * mock used (they mirror src/server/types.ts), so ChatPanel and TracePanel
 * render real runs with almost no change.
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
  audioUrl?: string
  createdAt: number
}

export type StageStatus = "idle" | "running" | "done" | "skipped" | "error"

export type StageId =
  | "receive"
  | "download"
  | "stt"
  | "sandbox"
  | "agent"
  | "tts"
  | "send"

/** One Pi tool call, nested under the `agent` stage. */
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

type RunEvent =
  | { type: "hello" }
  | { type: "run_start"; run: PipelineRun }
  | { type: "stage"; runId: number; stage: Stage }
  | { type: "step"; runId: number; step: AgentStep }
  | { type: "message"; message: ChatMessage }
  | { type: "message_patch"; id: number; patch: Partial<ChatMessage> }
  | { type: "run_end"; runId: number; totalMs: number }
  | { type: "error"; runId?: number; message: string }

export interface RunStreamUrls {
  /** SSE topic to follow. */
  events: string
  /** GET for the stored transcript, POST to send. Omit for a read-only view. */
  messages?: string
  /** Seeded transcript, for callers that already loaded it (route loaders). */
  history?: ChatMessage[]
}

/**
 * Follows runs on one SSE topic and keeps a transcript in sync.
 *
 * The same hook drives the agent playground (`agent:<id>` topic) and a channel
 * session's page (`session:<id>`), because both are watching the same pipeline
 * from different angles.
 */
export function useRunStream({
  events,
  messages: messagesUrl,
  history,
}: RunStreamUrls) {
  const [messages, setMessages] = useState<ChatMessage[]>(history ?? [])
  const [run, setRun] = useState<PipelineRun | null>(null)
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  // Replay the stored transcript so a reload doesn't look like a fresh session.
  useEffect(() => {
    if (!messagesUrl) return
    let cancelled = false
    fetch(messagesUrl)
      .then((res) => (res.ok ? res.json() : []))
      .then((loaded: ChatMessage[]) => {
        if (!cancelled) setMessages(loaded)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messagesUrl])

  useEffect(() => {
    const source = new EventSource(events)

    source.onmessage = (raw) => {
      let event: RunEvent
      try {
        event = JSON.parse(raw.data) as RunEvent
      } catch {
        return
      }

      switch (event.type) {
        case "run_start":
          setRun(event.run)
          setError(null)
          busyRef.current = true
          setBusy(true)
          break

        case "stage":
          setRun((current) =>
            current && current.id === event.runId
              ? {
                  ...current,
                  stages: current.stages.map((s) =>
                    s.id === event.stage.id ? { ...s, ...event.stage } : s
                  ),
                }
              : current
          )
          break

        case "step":
          setRun((current) => {
            if (!current || current.id !== event.runId) return current
            return {
              ...current,
              stages: current.stages.map((stage) => {
                if (stage.id !== "agent") return stage
                const steps = stage.steps ? [...stage.steps] : []
                const at = steps.findIndex((s) => s.id === event.step.id)
                if (at >= 0) steps[at] = event.step
                else steps.push(event.step)
                return { ...stage, steps }
              }),
            }
          })
          break

        case "message":
          setMessages((current) =>
            current.some((m) => m.id === event.message.id)
              ? current
              : [...current, event.message]
          )
          break

        case "message_patch":
          setMessages((current) =>
            current.map((m) =>
              m.id === event.id ? { ...m, ...event.patch } : m
            )
          )
          break

        case "run_end":
          setRun((current) =>
            current && current.id === event.runId
              ? { ...current, totalMs: event.totalMs }
              : current
          )
          busyRef.current = false
          setBusy(false)
          break

        case "error":
          setError(event.message)
          busyRef.current = false
          setBusy(false)
          break

        default:
          break
      }
    }

    return () => source.close()
  }, [events])

  const sendText = useCallback(
    (text: string) => {
      if (!messagesUrl || busyRef.current || !text.trim()) return
      busyRef.current = true
      setBusy(true)
      fetch(messagesUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        busyRef.current = false
        setBusy(false)
      })
    },
    [messagesUrl]
  )

  const sendVoice = useCallback(
    (blob: Blob, seconds?: number) => {
      if (!messagesUrl || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      const form = new FormData()
      form.append("audio", blob, "note.ogg")
      if (seconds) form.append("seconds", String(Math.round(seconds)))
      fetch(messagesUrl, {
        method: "POST",
        body: form,
      }).catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        busyRef.current = false
        setBusy(false)
      })
    },
    [messagesUrl]
  )

  return { messages, run, isBusy, error, sendText, sendVoice }
}

/** The agent playground: its own session on the built-in playground channel. */
export function useAgentRun(agentId: string | undefined) {
  return useRunStream({
    events: `/api/agents/${agentId}/events`,
    messages: `/api/agents/${agentId}/messages?peer=playground`,
  })
}

/**
 * One channel session, live. Sending here runs the agent for real — on WhatsApp
 * the reply goes to the actual person, so the caller decides whether to offer it.
 */
export function useSessionRun(
  sessionId: string,
  options: { canSend?: boolean; history?: ChatMessage[] } = {}
) {
  return useRunStream({
    events: `/api/sessions/${sessionId}/events`,
    messages: options.canSend
      ? `/api/sessions/${sessionId}/messages`
      : undefined,
    history: options.history,
  })
}
