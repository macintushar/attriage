import { mkdirSync, writeFileSync } from "node:fs"

import { env } from "./env"
import { spawnInSession } from "./sandbox"
import type { AgentRecord, AgentStep, SessionRecord } from "./types"

export interface TurnResult {
  text: string
  steps: AgentStep[]
  costUsd?: number
  error?: string
}

/** One line of `pi --mode json`. Only the fields we consume are typed. */
interface PiEvent {
  type: string
  toolCallId?: string
  toolName?: string
  args?: Record<string, unknown>
  result?: unknown
  isError?: boolean
  delta?: string
  assistantMessageEvent?: { type: string; delta?: string }
  message?: {
    role?: string
    content?: Array<{ type?: string; text?: string }>
    usage?: { cost?: number | { total?: number } }
    /** Pi sets this instead of a non-zero exit code when a provider call fails. */
    stopReason?: string
    errorMessage?: string
  }
  messages?: Array<{
    role?: string
    content?: Array<{ type?: string; text?: string }>
  }>
}

/**
 * The label shown in the trace. For bash — which is how the agent drives pm —
 * that's the command itself, so the UI literally shows
 * `pm reverse run rplan_… --approve …` as it happens.
 */
function stepLabel(
  toolName: string,
  args: Record<string, unknown> | undefined
): string {
  if (!args) return toolName
  const command = args.command ?? args.cmd
  if (typeof command === "string")
    return command.replace(/\s+/g, " ").trim().slice(0, 300)
  const path = args.path ?? args.file_path ?? args.filePath
  if (typeof path === "string") return `${toolName} ${path}`
  return toolName
}

function resultDetail(result: unknown): string | undefined {
  if (result == null) return undefined
  if (typeof result === "string") return result.slice(0, 600)
  if (typeof result === "object") {
    const content = (result as { content?: Array<{ text?: string }> }).content
    if (Array.isArray(content)) {
      const text = content
        .map((c) => c.text ?? "")
        .join("\n")
        .trim()
      if (text) return text.slice(0, 600)
    }
    const output = (result as { output?: string }).output
    if (typeof output === "string") return output.slice(0, 600)
  }
  return undefined
}

function textOf(message: {
  content?: Array<{ type?: string; text?: string }>
}): string {
  return (message.content ?? [])
    .filter((c) => c.type === "text" || typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("")
    .trim()
}

export function writeSystemPrompt(session: SessionRecord, agent: AgentRecord) {
  mkdirSync(session.workdir, { recursive: true })
  const parts = [agent.systemPrompt.trim()]
  if (agent.goal.trim()) {
    parts.push(`\n## Your objective\n\n${agent.goal.trim()}`)
  }
  writeFileSync(`${session.workdir}/system-prompt.md`, `${parts.join("\n")}\n`)
}

/**
 * Runs one agent turn inside the session's sandbox.
 *
 * Multi-turn memory is free: `--session-id` resumes the Pi session JSONL that
 * lives in the mounted workspace, so the agent remembers the conversation even
 * after its container has been reaped and restarted.
 */
export async function runTurn(
  session: SessionRecord,
  agent: AgentRecord,
  userText: string,
  onStep: (step: AgentStep) => void,
  onText?: (delta: string) => void
): Promise<TurnResult> {
  writeSystemPrompt(session, agent)

  const proc = spawnInSession(session, [
    "pi",
    "-p",
    "--mode",
    "json",
    // Without --approve, Pi's non-interactive modes silently ignore
    // project-local config (skills, settings) and the run looks mysteriously dumb.
    "--approve",
    "--provider",
    env.provider,
    "--model",
    env.model,
    "--session-dir",
    "/workspace/.pi/sessions",
    "--session-id",
    session.id,
    "--tools",
    "bash,read,write,ls",
    "--skill",
    "/workspace/skills",
    "--append-system-prompt",
    "/workspace/system-prompt.md",
    userText,
  ])

  const timer = setTimeout(() => proc.kill(), env.turnTimeoutMs)

  const steps = new Map<string, AgentStep>()
  const startedAt = new Map<string, number>()
  let streamed = ""
  let finalText = ""
  let costUsd: number | undefined
  let providerError: string | undefined

  try {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const bytes of proc.stdout) {
      buffer += decoder.decode(bytes, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("{")) continue

        let event: PiEvent
        try {
          event = JSON.parse(trimmed) as PiEvent
        } catch {
          continue
        }

        switch (event.type) {
          case "tool_execution_start": {
            const id = event.toolCallId ?? crypto.randomUUID()
            const step: AgentStep = {
              id,
              tool: event.toolName ?? "tool",
              label: stepLabel(event.toolName ?? "tool", event.args),
              status: "running",
            }
            steps.set(id, step)
            startedAt.set(id, Date.now())
            onStep(step)
            break
          }
          case "tool_execution_end": {
            const id = event.toolCallId ?? ""
            const existing = steps.get(id)
            if (!existing) break
            const done: AgentStep = {
              ...existing,
              status: event.isError ? "error" : "done",
              detail: resultDetail(event.result),
              ms: Date.now() - (startedAt.get(id) ?? Date.now()),
            }
            steps.set(id, done)
            onStep(done)
            break
          }
          case "message_update": {
            const delta = event.assistantMessageEvent?.delta
            if (event.assistantMessageEvent?.type === "text_delta" && delta) {
              streamed += delta
              onText?.(delta)
            }
            break
          }
          case "message_end": {
            if (event.message?.role === "assistant") {
              const text = textOf(event.message)
              if (text) finalText = text
              const cost = event.message.usage?.cost
              const amount = typeof cost === "number" ? cost : cost?.total
              if (typeof amount === "number") costUsd = (costUsd ?? 0) + amount
              // Pi exits 0 even when the provider call failed, reporting it here
              // instead. Without this a 403 or rate-limit would surface as a
              // silent empty reply — the worst possible failure mode for a
              // patient waiting on WhatsApp.
              if (
                event.message.stopReason === "error" &&
                event.message.errorMessage
              ) {
                providerError = event.message.errorMessage
              }
            }
            break
          }
          case "agent_end": {
            const last = [...(event.messages ?? [])]
              .reverse()
              .find((m) => m.role === "assistant")
            if (last) {
              const text = textOf(last)
              if (text) finalText = text
            }
            break
          }
          default:
            break
        }
      }
    }

    const [stderr, code] = await Promise.all([proc.stderrText, proc.exited])

    const text = (finalText || streamed).trim()
    if (!text) {
      // `||`, not `??`: an empty stderr is a string, so `??` would keep it and
      // leave `error` falsy. That let an empty reply through the caller's
      // `error && !text` guard and be delivered as silence — which is exactly
      // the failure this branch exists to prevent. It happens for real when the
      // turn timeout kills pi mid-tool-loop and it writes nothing to stderr.
      return {
        text: "",
        steps: [...steps.values()],
        error:
          providerError ||
          stderr.trim().slice(0, 800) ||
          `pi produced no reply (exit ${code})`,
      }
    }
    return { text, steps: [...steps.values()], costUsd, error: providerError }
  } finally {
    clearTimeout(timer)
  }
}
