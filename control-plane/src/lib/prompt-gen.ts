import { getConnector } from "./pm-catalog"

export interface PromptInputs {
  name: string
  voice: boolean
  tools: string[]
  /** The multi-step objective, in the builder's own words. */
  goal?: string
}

/** Auto-generates the agent's system prompt from the builder selections. */
export function generateSystemPrompt({
  name,
  voice,
  tools,
  goal,
}: PromptInputs) {
  const lines: string[] = [
    `You are **${name || "the assistant"}**, talking to people on WhatsApp.`,
    "",
    "## Language & tone",
    "- On every turn, reply in the language of the customer's latest message, including mixed-language messages.",
    "- If the customer switches languages, switch immediately; the latest message overrides the language used earlier in the conversation.",
    "- Be warm and concise. Get to the answer in the first sentence.",
    "- Ask one question at a time. Short questions get short answers, which transcribe far more reliably.",
  ]
  if (voice) {
    lines.push(
      "- Voice notes get spoken replies: keep them under 3 short sentences, with no lists, links, or formatting."
    )
  }
  lines.push(
    "- **Read the `talking-to-people` skill before your first reply.** It is how you",
    "  are judged: cadence, never making someone repeat themselves, distress and",
    "  emergencies, and how to close. Follow it in every message."
  )
  lines.push("")

  if (goal?.trim()) {
    lines.push("## What you are here to do", goal.trim(), "")
  }

  if (tools.length > 0) {
    lines.push(
      "## Systems you can reach",
      "You work through the `pm` command-line tool from your bash tool. Read the",
      "`pm-workflow` skill before your first write, and inspect a connector before",
      "you use it — never guess a field or action name.",
      ""
    )
    for (const slug of tools) {
      const c = getConnector(slug)
      if (!c) continue
      lines.push(`### ${c.name} (\`${c.slug}\`)`)
      lines.push(firstSentence(c.description))
      if (c.streams.length > 0) {
        lines.push(`- Can read: ${clip(c.streams)}`)
      }
      if (c.actions.length > 0) {
        lines.push(`- Can do: ${clip(c.actions)}`)
      } else {
        lines.push("- Read-only — this connector cannot write anything.")
      }
      lines.push("")
    }
  }

  lines.push(
    "## Guardrails",
    "- Never invent ids, amounts, dates, or names — look them up first.",
    "- Read the details back and get a clear yes before anything irreversible.",
    "- Do only what you were asked to do. If the task needs a system or an action you were not given, say so plainly instead of improvising.",
    "- End with a one-line summary of any action you took.",
    "- If you can't help, say so and offer to connect a human."
  )
  return lines.join("\n")
}

function firstSentence(text: string) {
  const idx = text.indexOf(". ")
  return idx === -1 ? text : text.slice(0, idx + 1)
}

function clip(items: string[], max = 6) {
  return items.slice(0, max).join(", ") + (items.length > max ? ", …" : "")
}

export interface PromptTweak {
  id: string
  label: string
  instruction: string
}

/**
 * Quick chips for the prompt assistant. These are now canned *instructions*
 * sent to the model — the previous versions did exact-string `.replace()`
 * surgery that silently no-opped as soon as the user edited that line.
 */
export const PROMPT_TWEAKS: PromptTweak[] = [
  {
    id: "friendlier",
    label: "Friendlier tone",
    instruction:
      "Make the tone noticeably warmer and more reassuring, and allow the occasional light emoji on text replies. Keep replies just as direct.",
  },
  {
    id: "shorter",
    label: "Shorter replies",
    instruction:
      "Add a hard cap: every reply stays under two sentences unless the customer explicitly asks for detail.",
  },
  {
    id: "escalation",
    label: "Escalation policy",
    instruction:
      "Add an Escalation section: hand off to a human immediately if the person is distressed, asks for a human twice, or raises anything urgent. When escalating, summarise the conversation so they never repeat themselves.",
  },
]

/** Sends the prompt plus an instruction to the model for a real rewrite. */
export async function improvePrompt(
  prompt: string,
  instruction: string
): Promise<{ prompt: string; reply: string }> {
  const res = await fetch("/api/assist/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, instruction }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      prompt,
      reply: `Couldn't apply that: ${body.error ?? res.statusText}`,
    }
  }
  const data = (await res.json()) as { prompt: string }
  return { prompt: data.prompt, reply: "Done — updated the prompt." }
}
