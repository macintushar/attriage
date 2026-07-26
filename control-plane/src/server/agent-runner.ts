import { mkdirSync, writeFileSync } from "node:fs"

import { env } from "./env"
import { spawnInSession } from "./sandbox"
import type { AgentRecord, AgentStep, SessionRecord } from "./types"
import { log } from "./logger"

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

/** Sarvam language codes → the name to actually say in the prompt. */
const LANGUAGE_NAMES: Record<string, string> = {
  "bn-IN": "Bengali",
  "en-IN": "English",
  "gu-IN": "Gujarati",
  "hi-IN": "Hindi",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "od-IN": "Odia",
  "pa-IN": "Punjabi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "ur-IN": "Urdu",
  "as-IN": "Assamese",
  "ks-IN": "Kashmiri",
  "kok-IN": "Konkani",
  "mai-IN": "Maithili",
  "mni-IN": "Manipuri",
  "ne-IN": "Nepali",
  "sa-IN": "Sanskrit",
  "sat-IN": "Santali",
  "sd-IN": "Sindhi",
  "doi-IN": "Dogri",
  "brx-IN": "Bodo",
}

export function languageName(code: string | null | undefined): string | null {
  if (!code || code === "auto" || code === "unknown") return null
  return LANGUAGE_NAMES[code] ?? null
}

export function writeSystemPrompt(
  session: SessionRecord,
  agent: AgentRecord,
  detectedLanguage?: string | null
) {
  mkdirSync(session.workdir, { recursive: true })
  writeFileSync(
    `${session.workdir}/system-prompt.md`,
    buildSystemPrompt(agent, detectedLanguage)
  )
}

/**
 * Platform behavior that applies even to agents created before the prompt
 * builder learned about a language. The conversation history is useful context,
 * but must never pin the reply language to an earlier turn.
 *
 * `detectedLanguage` is what STT identified for *this* turn's voice note. The
 * file is rewritten before every turn, so naming it here is a per-turn fact,
 * not a standing instruction — and it is the only signal strong enough to beat
 * a conversation history full of the previous language. Without it, a caller
 * who spoke Tamil for five turns and then switched to Kannada kept getting
 * Tamil back, because everything in the model's context still said Tamil.
 */
export function buildSystemPrompt(
  agent: AgentRecord,
  detectedLanguage?: string | null
): string {
  const language = [
    "## Language for each reply",
    "",
    "Determine the language of the latest user message independently on every turn.",
    "Reply in that language, including languages not named elsewhere in this prompt.",
    "If the user switches languages, switch immediately. The latest user message",
    "overrides the language used earlier in the conversation. Mirror mixed-language",
    "messages naturally.",
  ]

  const name = languageName(detectedLanguage)
  if (name) {
    language.push(
      "",
      `Speech-to-text identified the latest voice message as **${name}** (\`${detectedLanguage}\`).`,
      `Reply in ${name}, even if every earlier turn in this conversation was in a`,
      "different language. Do not carry the previous language forward.",
      "If the transcript itself is plainly in some other language, trust the",
      "transcript — the detected label is a hint, not an override."
    )
  }

  const parts = [agent.systemPrompt.trim(), language.join("\n")]
  if (agent.goal.trim()) {
    parts.push(`\n## Your objective\n\n${agent.goal.trim()}`)
  }
  return `${parts.filter(Boolean).join("\n\n")}\n`
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
  onText?: (delta: string) => void,
  detectedLanguage?: string | null
): Promise<TurnResult> {
  const turnStartedAt = performance.now()
  log.info("agent.turn.started", {
    sessionId: session.id,
    agentId: agent.id,
    provider: env.provider,
    model: env.model,
    inputChars: userText.length,
  })
  writeSystemPrompt(session, agent, detectedLanguage)

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
            log.info("agent.tool.started", {
              sessionId: session.id,
              agentId: agent.id,
              tool: step.tool,
              toolCallId: id,
            })
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
            log.info("agent.tool.completed", {
              sessionId: session.id,
              agentId: agent.id,
              tool: done.tool,
              toolCallId: id,
              status: done.status,
              durationMs: done.ms,
            })
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
      const result = {
        text: "",
        steps: [...steps.values()],
        error:
          providerError ||
          stderr.trim().slice(0, 800) ||
          `pi produced no reply (exit ${code})`,
      }
      log.error("agent.turn.failed", {
        sessionId: session.id,
        agentId: agent.id,
        durationMs: Math.round(performance.now() - turnStartedAt),
        error: result.error,
      })
      return result
    }
    log.info("agent.turn.completed", {
      sessionId: session.id,
      agentId: agent.id,
      durationMs: Math.round(performance.now() - turnStartedAt),
      outputChars: text.length,
      toolCalls: steps.size,
      costUsd,
      providerError,
    })
    return { text, steps: [...steps.values()], costUsd, error: providerError }
  } finally {
    clearTimeout(timer)
  }
}
