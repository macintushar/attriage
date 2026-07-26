import { useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  IconArrowLeft,
  IconCheck,
  IconLoader2,
  IconLock,
  IconMessage,
  IconMicrophone,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LANGUAGES, TTS_SPEAKERS, addAgent } from "@/lib/agents-store"
import type { ConnectorBinding } from "@/lib/agents-store"
import { CONNECTORS, getConnector } from "@/lib/pm-catalog"
import {
  PROMPT_TWEAKS,
  generateSystemPrompt,
  improvePrompt,
} from "@/lib/prompt-gen"
import { ConnectorPicker } from "@/components/connector-picker"

export const Route = createFileRoute("/agents/new")({ component: NewAgent })

const STEPS = [
  "Basics",
  "Capabilities",
  "Tools",
  "Connections",
  "System prompt",
] as const

const PROMPT_STEP = 4

function NewAgent() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [voice, setVoice] = useState(false)
  const [language, setLanguage] = useState("auto")
  const [ttsSpeaker, setSpeaker] = useState("shubh")
  const [tools, setTools] = useState<string[]>([])
  const [bindings, setBindings] = useState<Record<string, ConnectorBinding>>({})
  const [prompt, setPrompt] = useState("")
  const [promptTouched, setPromptTouched] = useState(false)
  const [assistantReply, setAssistantReply] = useState<string | null>(null)
  const [instruction, setInstruction] = useState("")
  const [improving, setImproving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const canContinue = step === 0 ? name.trim().length > 0 : true
  const isLast = step === STEPS.length - 1

  const inputs = { name: name.trim(), voice, tools, goal: goal.trim() }

  const regenerate = () => {
    setPrompt(generateSystemPrompt(inputs))
    setPromptTouched(false)
    setAssistantReply(null)
  }

  const goNext = () => {
    // Entering the prompt step: generate unless the user already edited it.
    if (step === PROMPT_STEP - 1 && !promptTouched) {
      setPrompt(generateSystemPrompt(inputs))
    }
    setStep((s) => s + 1)
  }

  const runInstruction = async (text: string) => {
    if (!text.trim() || improving) return
    setImproving(true)
    setInstruction("")
    const result = await improvePrompt(prompt, text)
    setPrompt(result.prompt)
    setPromptTouched(true)
    setAssistantReply(result.reply)
    setImproving(false)
  }

  const bindingFor = (slug: string): ConnectorBinding =>
    bindings[slug] ?? {
      slug,
      connectionName: `${slug}-main`,
      allowedActions: getConnector(slug)?.actions ?? [],
      credentialEnv: {},
      config: {},
    }

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const agent = await addAgent({
        name: name.trim(),
        voice,
        tools,
        systemPrompt: prompt,
        goal: goal.trim(),
        language,
        ttsSpeaker,
        connectors: tools.map(bindingFor),
      })
      void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
      setCreating(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        Agents
      </Link>

      <h1 className="mt-4 font-heading text-xl font-semibold">Create agent</h1>
      <p className="text-sm text-muted-foreground">
        Describe the job, pick the systems it can reach — we generate the rest.
      </p>

      {/* Stepper */}
      <ol className="mt-6 mb-8 flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-medium",
                i < step && "bg-primary text-primary-foreground",
                i === step && "bg-primary/15 text-primary ring-1 ring-primary",
                i > step && "bg-muted text-muted-foreground"
              )}
            >
              {i < step ? <IconCheck className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                i === step ? "font-medium" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="w-4 border-t" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="space-y-5">
          <div>
            <label className="text-sm font-medium" htmlFor="agent-name">
              Agent name
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Patient Intake"
              className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="agent-goal">
              What should it do?
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Describe the job step by step. This becomes the agent's objective,
              so it can run multi-step work rather than answering one question.
            </p>
            <textarea
              id="agent-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={5}
              placeholder={
                "e.g. Greet the patient, collect their name, age and symptoms, work out which specialty they need, create their record, book the earliest matching appointment, then confirm the time and doctor."
              }
              className="mt-1.5 w-full resize-y rounded-xl border bg-background p-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
            />
          </div>
          <p className="rounded-2xl border bg-muted/30 p-4 text-xs text-muted-foreground">
            You'll pick where this agent answers later — a channel points at an
            agent, so one agent can serve several channels at once.
          </p>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between rounded-2xl border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <IconMessage className="size-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Text</div>
                <div className="text-xs text-muted-foreground">
                  Reply to text messages · powered by Sarvam-105B
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <IconLock className="size-3.5" />
              always on
            </span>
          </div>

          <button
            onClick={() => setVoice((v) => !v)}
            className={cn(
              "flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-colors",
              voice && "border-primary bg-primary/5"
            )}
          >
            <div className="flex items-center gap-3">
              <IconMicrophone
                className={cn(
                  "size-5",
                  voice ? "text-primary" : "text-muted-foreground"
                )}
              />
              <div>
                <div className="text-sm font-medium">Voice</div>
                <div className="text-xs text-muted-foreground">
                  Voice notes in &amp; out · Saaras v3 STT + Bulbul v3 TTS
                </div>
              </div>
            </div>
            <span
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                voice ? "bg-primary" : "bg-muted-foreground/30"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform",
                  voice && "translate-x-4"
                )}
              />
            </span>
          </button>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-2xl border p-4">
              <div className="text-sm font-medium">Language</div>
              <div className="text-xs text-muted-foreground">
                Auto-detect works across 23 languages.
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="mt-2 h-9 w-full rounded-xl border bg-background px-2 text-sm outline-none focus:border-ring"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className={cn("rounded-2xl border p-4", !voice && "opacity-50")}
            >
              <div className="text-sm font-medium">Voice</div>
              <div className="text-xs text-muted-foreground">
                Bulbul v3 speaker for spoken replies.
              </div>
              <select
                value={ttsSpeaker}
                disabled={!voice}
                onChange={(e) => setSpeaker(e.target.value)}
                className="mt-2 h-9 w-full rounded-xl border bg-background px-2 text-sm outline-none focus:border-ring"
              >
                {TTS_SPEAKERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pick what your agent can read and act on — {CONNECTORS.length}{" "}
            integrations, no code needed.
          </p>
          <ConnectorPicker
            selected={tools}
            onToggle={(slug) =>
              setTools((prev) =>
                prev.includes(slug)
                  ? prev.filter((t) => t !== slug)
                  : [...prev, slug]
              )
            }
          />
        </section>
      )}

      {step === 3 && (
        <section className="space-y-3">
          {tools.length === 0 ? (
            <p className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              No tools selected — your agent will just converse. Go back a step
              to give it access to a system.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Name each connection and choose which write actions the agent is
                allowed to perform. Credentials are read from environment
                variables on the server — never entered here.
              </p>
              {tools.map((slug) => {
                const connector = getConnector(slug)
                const binding = bindingFor(slug)
                const update = (patch: Partial<ConnectorBinding>) =>
                  setBindings((prev) => ({
                    ...prev,
                    [slug]: { ...binding, ...patch },
                  }))
                return (
                  <div key={slug} className="rounded-2xl border p-4">
                    <div className="text-sm font-medium">
                      {connector?.name ?? slug}
                    </div>
                    <label className="mt-2 block text-xs text-muted-foreground">
                      Connection name
                      <input
                        value={binding.connectionName}
                        onChange={(e) =>
                          update({ connectionName: e.target.value })
                        }
                        className="mt-1 h-9 w-full rounded-xl border bg-background px-2 font-mono text-xs outline-none focus:border-ring"
                      />
                    </label>
                    {connector && connector.actions.length > 0 ? (
                      <div className="mt-3">
                        <div className="text-xs text-muted-foreground">
                          Allowed actions
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {connector.actions.map((action) => {
                            const on = binding.allowedActions.includes(action)
                            return (
                              <button
                                key={action}
                                onClick={() =>
                                  update({
                                    allowedActions: on
                                      ? binding.allowedActions.filter(
                                          (a) => a !== action
                                        )
                                      : [...binding.allowedActions, action],
                                  })
                                }
                                className={cn(
                                  "rounded-full border px-2.5 py-1 font-mono text-[11px]",
                                  on
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "text-muted-foreground"
                                )}
                              >
                                {action}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Read-only connector — nothing to authorise.
                      </p>
                    )}

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <KeyValueField
                        label="Config"
                        hint="key=value per line — e.g. base_url=https://api.acme.com"
                        value={binding.config}
                        onChange={(config) => update({ config })}
                      />
                      <KeyValueField
                        label="Credentials"
                        hint="field=ENV_VAR per line. Names only — the server reads the values."
                        value={binding.credentialEnv}
                        onChange={(credentialEnv) => update({ credentialEnv })}
                      />
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </section>
      )}

      {step === PROMPT_STEP && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Generated from the job description, capabilities, and tools. Edit
              anything — it's your agent's brain.
            </p>
            <Button variant="outline" size="xs" onClick={regenerate}>
              <IconRefresh data-icon="inline-start" />
              Regenerate
            </Button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setPromptTouched(true)
            }}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-2xl border bg-background p-4 font-mono text-xs leading-relaxed outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
          />

          <div className="rounded-2xl border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {improving ? (
                <IconLoader2 className="size-3.5 animate-spin text-primary" />
              ) : (
                <IconSparkles className="size-3.5 text-primary" />
              )}
              Improve with AI
            </div>
            {assistantReply && (
              <p className="mt-1.5 text-xs text-primary">{assistantReply}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PROMPT_TWEAKS.map((tweak) => (
                <button
                  key={tweak.id}
                  disabled={improving}
                  onClick={() => void runInstruction(tweak.instruction)}
                  className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-50"
                >
                  {tweak.label}
                </button>
              ))}
            </div>
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && void runInstruction(instruction)
              }
              disabled={improving}
              placeholder="Or tell it what to change… e.g. “always confirm the appointment time twice”"
              className="mt-2 h-9 w-full rounded-xl border bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-50"
            />
          </div>
        </section>
      )}

      {createError && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {createError}
        </p>
      )}

      <footer className="mt-8 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => s - 1)}
          className={cn(step === 0 && "invisible")}
        >
          Back
        </Button>
        {isLast ? (
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? "Creating…" : "Create agent"}
            <IconCheck data-icon="inline-end" />
          </Button>
        ) : (
          <Button disabled={!canContinue} onClick={goNext}>
            Continue
          </Button>
        )}
      </footer>
    </main>
  )
}

/**
 * Compact `key=value` per line editor. Two of these beat twenty inputs for a
 * connector whose field list we don't know until pm tells us.
 */
function KeyValueField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const text = Object.entries(value)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")

  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <textarea
        defaultValue={text}
        rows={3}
        onBlur={(e) => {
          const next: Record<string, string> = {}
          for (const line of e.target.value.split("\n")) {
            const at = line.indexOf("=")
            if (at < 1) continue
            const key = line.slice(0, at).trim()
            if (key) next[key] = line.slice(at + 1).trim()
          }
          onChange(next)
        }}
        className="mt-1 w-full resize-y rounded-xl border bg-background p-2 font-mono text-[11px] outline-none focus:border-ring"
      />
      <span className="text-[10px]">{hint}</span>
    </label>
  )
}
