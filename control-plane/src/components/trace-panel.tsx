import {
  IconAlertTriangle,
  IconBox,
  IconBrandWhatsapp,
  IconCheck,
  IconDownload,
  IconLanguage,
  IconLoader2,
  IconSend,
  IconSparkles,
  IconTerminal2,
  IconVolume,
} from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import type { AgentStep, PipelineRun, Stage, StageId } from "@/lib/agent-run"

const STAGE_ICONS: Record<StageId, typeof IconCheck> = {
  receive: IconBrandWhatsapp,
  download: IconDownload,
  stt: IconLanguage,
  sandbox: IconBox,
  agent: IconSparkles,
  tts: IconVolume,
  send: IconSend,
}

export function TracePanel({ run }: { run: PipelineRun | null }) {
  return (
    <div className="flex min-h-[28rem] min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border bg-card shadow-lg lg:h-full lg:min-h-0">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Pipeline trace</h2>
          <p className="text-xs text-muted-foreground">
            WhatsApp → Saaras v3 → sandbox → Sarvam-105B → Bulbul v3 → WhatsApp
          </p>
        </div>
        {run && (
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-medium text-foreground">
              Run #{run.id} · {run.kind} message
            </div>
            {/* Truthiness would render a genuine 0 ms run as "in progress" forever. */}
            {run.totalMs != null ? (
              <div>finished in {(run.totalMs / 1000).toFixed(1)}s</div>
            ) : (
              <div className="text-primary">in progress…</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {run ? (
          <ol className="space-y-0">
            {run.stages.map((stage, i) => (
              <StageRow
                key={stage.id}
                stage={stage}
                isLast={i === run.stages.length - 1}
              />
            ))}
          </ol>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            No runs yet. Send a message from the phone and watch each stage
            light up here.
          </div>
        )}
      </div>
    </div>
  )
}

function StageRow({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  const Icon = STAGE_ICONS[stage.id]
  const isActive = stage.status === "running"
  const isDone = stage.status === "done"
  const isSkipped = stage.status === "skipped"
  const isError = stage.status === "error"

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors",
            isDone && "border-primary bg-primary text-primary-foreground",
            isActive && "border-primary bg-primary/10 text-primary",
            isError && "border-destructive bg-destructive/10 text-destructive",
            isSkipped && "border-dashed text-muted-foreground/50",
            stage.status === "idle" && "text-muted-foreground/60"
          )}
        >
          {isActive ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : isDone ? (
            <IconCheck className="size-4" />
          ) : isError ? (
            <IconAlertTriangle className="size-4" />
          ) : (
            <Icon className="size-4" />
          )}
        </div>
        {!isLast && (
          <div
            className={cn(
              "my-1 w-px flex-1 bg-border",
              isDone && "bg-primary/40"
            )}
          />
        )}
      </div>

      <div className={cn("min-w-0 flex-1 pb-6", isSkipped && "opacity-50")}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "text-sm font-medium",
              isActive && "text-primary",
              isError && "text-destructive",
              stage.status === "idle" && "text-muted-foreground"
            )}
          >
            {stage.label}
          </span>
          <span className="text-xs text-muted-foreground">{stage.service}</span>
          {(isDone || isError) && stage.ms != null && (
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {stage.ms} ms
            </span>
          )}
          {isSkipped && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              skipped — text message
            </span>
          )}
        </div>

        {stage.detail && (
          <p
            className={cn(
              "mt-1 rounded-lg px-2.5 py-1.5 font-mono text-xs break-words",
              isError
                ? "bg-destructive/10 text-destructive"
                : "bg-muted/60 text-muted-foreground"
            )}
          >
            {stage.detail}
          </p>
        )}

        {/* The agent's own tool calls — this is where the pm commands show up. */}
        {stage.steps && stage.steps.length > 0 && (
          <ol className="mt-2 space-y-1.5">
            {stage.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        )}
      </div>
    </li>
  )
}

function StepRow({ step }: { step: AgentStep }) {
  return (
    <li className="rounded-lg border border-dashed bg-background/60 px-2.5 py-1.5">
      <div className="flex items-start gap-2">
        {step.status === "running" ? (
          <IconLoader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
        ) : step.status === "error" ? (
          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        ) : (
          <IconTerminal2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <code className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed break-words text-foreground">
          {step.label}
        </code>
        {step.ms != null && (
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {step.ms} ms
          </span>
        )}
      </div>
      {step.detail && (
        <pre className="mt-1 max-h-24 overflow-y-auto font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
          {step.detail}
        </pre>
      )}
    </li>
  )
}
