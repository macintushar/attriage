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

/**
 * Aborts a turn when the model repeats the exact same failing tool call.
 *
 * Observed with sarvam-105b: one turn re-ran an identical failing `cat` 438
 * times, saw the error every time, and burned the whole 240s turn budget — the
 * patient got silence. Three identical consecutive failures is already proof
 * the model is not going to change course; killing pi then turns four minutes
 * of dead air into an immediate, explainable error.
 */
export const PERSEVERATION_LIMIT = 3
/**
 * A second, looser tripwire for the "fishing expedition" variant: the model
 * varies the command each time (so the identical-repeat check never fires) but
 * every attempt fails — observed as 20+ distinct failing `pm etl read`
 * guesses in one turn. A single successful call resets it, so a legitimate
 * plan→fail→inspect→retry sequence is never cut off.
 */
export const FLAIL_LIMIT = 10

/**
 * Volatile identifiers (plan ids, approval tokens) change on every attempt, so
 * a plan→run→fail loop never produces two byte-identical commands. Normalizing
 * them out lets the guard see "the same run keeps failing" through the noise —
 * observed as an alternating plan-ok / run-fail loop that burned a full turn.
 */
function normalizeGuardKey(key: string): string {
  return key
    .replace(/rplan_[a-f0-9]+/g, "rplan_X")
    .replace(/[a-f0-9]{24,}/g, "HEX")
}

export function createPerseverationGuard(
  limit = PERSEVERATION_LIMIT,
  flailLimit = FLAIL_LIMIT
) {
  const keys = new Map<string, string>()
  // Per-command failure counts. A success of the *same* command clears its
  // count; successes of other commands do not — otherwise an interleaved
  // succeeding step (re-planning before every doomed run) resets the guard
  // and the loop runs to the turn timeout anyway.
  const failsByKey = new Map<string, number>()
  let anyFailStreak = 0
  return {
    start(id: string, tool: string, args: Record<string, unknown> | undefined) {
      keys.set(id, normalizeGuardKey(`${tool} ${JSON.stringify(args ?? {})}`))
    },
    /** Returns the abort reason when the turn should be aborted, else null. */
    end(id: string, isError: boolean): "repeat" | "flail" | null {
      const key = keys.get(id)
      keys.delete(id)
      if (!key) return null
      if (!isError) {
        failsByKey.delete(key)
        anyFailStreak = 0
        return null
      }
      anyFailStreak += 1
      const count = (failsByKey.get(key) ?? 0) + 1
      failsByKey.set(key, count)
      if (count >= limit) return "repeat"
      if (anyFailStreak >= flailLimit) return "flail"
      return null
    },
  }
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

  // The pm project dir, not /workspace: a small model reaches for relative
  // paths (`cat .polymetrics/...`, bare `pm` commands), and every one of them
  // must land in the project. Pi still picks up /workspace/.pi via
  // PI_CODING_AGENT_DIR, so APPEND_SYSTEM.md and skills are unaffected —
  // smoke.sh's injection check runs pi from this cwd and passes.
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
    // An explicit --append-system-prompt OVERRIDES Pi's discovery of
    // .pi/APPEND_SYSTEM.md, so the memory protocol must be passed here too —
    // protocol first, then the agent's own prompt. Dropping the first flag
    // silently disables memory for every turn that goes through this runner.
    "--append-system-prompt",
    "/workspace/.pi/APPEND_SYSTEM.md",
    "--append-system-prompt",
    "/workspace/system-prompt.md",
    userText,
  ], "/workspace/project")

  const timer = setTimeout(() => proc.kill(), env.turnTimeoutMs)

  const steps = new Map<string, AgentStep>()
  const startedAt = new Map<string, number>()
  const guard = createPerseverationGuard()
  let streamed = ""
  let finalText = ""
  let costUsd: number | undefined
  let providerError: string | undefined
  let abortError: string | undefined

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
            guard.start(id, step.tool, event.args)
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
            const abortReason = guard.end(id, Boolean(event.isError))
            if (abortReason) {
              abortError =
                abortReason === "repeat"
                  ? `agent repeated a failing command ${PERSEVERATION_LIMIT} times ` +
                    `("${existing.label.slice(0, 80)}") — aborted to avoid a silent timeout`
                  : `agent made ${FLAIL_LIMIT} consecutive failing tool calls ` +
                    `(last: "${existing.label.slice(0, 80)}") — aborted to avoid a silent timeout`
              proc.kill()
            }
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
          abortError ||
          providerError ||
          stderr.trim().slice(0, 800) ||
          `pi produced no reply (exit ${code})`,
      }
    }
    return {
      text,
      steps: [...steps.values()],
      costUsd,
      error: abortError || providerError,
    }
  } finally {
    clearTimeout(timer)
  }
}
