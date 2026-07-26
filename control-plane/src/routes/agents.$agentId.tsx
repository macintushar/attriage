import { memo, useEffect, useRef, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  IconArrowLeft,
  IconMessage,
  IconMicrophone,
  IconPlus,
  IconTool,
} from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import { ChatPanel } from "@/components/chat-panel"
import { TracePanel } from "@/components/trace-panel"
import { ChannelIcon, Chip, StatusDot } from "@/components/channel-bits"
import { useAgentRun } from "@/lib/agent-run"
import { fetchAgent, updateAgent } from "@/lib/agents-store"
import type { AgentConfig } from "@/lib/agents-store"
import { connectorName } from "@/lib/pm-catalog"

type Tab = "playground" | "prompt" | "channels"

export const Route = createFileRoute("/agents/$agentId")({
  // A loader (rather than a synchronous store read) is what makes this route
  // survive a page reload now that agents live in the database.
  loader: async ({ params }) => ({ agent: await fetchAgent(params.agentId) }),
  component: AgentDetail,
})

function AgentDetail() {
  const { agent: loaded } = Route.useLoaderData()
  const [tab, setTab] = useState<Tab>("playground")

  if (!loaded) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">
          Agent not found.{" "}
          <Link to="/" className="text-primary underline">
            Back to agents
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 p-4 sm:p-6 lg:h-full">
      <AgentHeader agent={loaded} tab={tab} onTabChange={setTab} />
      {tab === "playground" && <Playground agent={loaded} />}
      {tab === "prompt" && <PromptEditor agent={loaded} />}
      {tab === "channels" && <ChannelsTab agent={loaded} />}
    </main>
  )
}

function Playground({ agent }: { agent: AgentConfig }) {
  const { messages, run, isBusy, error, sendText, sendVoice } = useAgentRun(
    agent.id
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <ChatPanel
        agentName={agent.name}
        voiceEnabled={agent.voice}
        messages={messages}
        isBusy={isBusy}
        error={error}
        onSendText={sendText}
        onSendVoice={sendVoice}
      />
      <TracePanel run={run} />
    </div>
  )
}

function PromptEditor({ agent }: { agent: AgentConfig }) {
  const [draft, setDraft] = useState(agent.systemPrompt)
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced: the old version fired a store write on every keystroke.
  useEffect(() => {
    if (draft === agent.systemPrompt) return
    setSaved("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      updateAgent(agent.id, { systemPrompt: draft })
        .then(() => setSaved("saved"))
        .catch(() => setSaved("idle"))
    }, 600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [draft, agent.id, agent.systemPrompt])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          The agent's brain — edits apply to the next run.
        </p>
        <span className="text-xs text-muted-foreground">
          {saved === "saving" ? "saving…" : saved === "saved" ? "saved" : ""}
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="min-h-72 flex-1 resize-none rounded-2xl border bg-background p-4 font-mono text-xs leading-relaxed outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
      />
      {agent.goal && (
        <div className="rounded-2xl border bg-muted/40 p-3">
          <div className="text-xs font-medium">Objective</div>
          <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
            {agent.goal}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Where this agent is reachable. Read-only on purpose — routing is configured on
 * the channel, because a channel can point at any agent and an agent can be
 * answering on several at once.
 */
function ChannelsTab({ agent }: { agent: AgentConfig }) {
  const channels = agent.channels ?? []

  if (channels.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <p className="text-sm font-medium">Not connected to any channel</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          This agent only runs in the playground. Add a channel and set it as
          the default agent to put it in front of real people.
        </p>
        <Link
          to="/channels/new"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary underline"
        >
          <IconPlus className="size-4" />
          Add a channel
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Configured on the channel side. Open a channel to change which agent
        answers, or to reassign a single conversation.
      </p>
      {channels.map((channel) => (
        <Link
          key={channel.id}
          to="/channels/$channelId"
          params={{ channelId: channel.id }}
          className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:shadow-md"
        >
          <ChannelIcon kind={channel.kind} className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{channel.name}</div>
            <div className="text-xs text-muted-foreground">
              {channel.isDefault
                ? "default agent for this channel"
                : "handles specific pinned sessions"}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <StatusDot status={channel.status} />
            {channel.status}
          </span>
        </Link>
      ))}
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: "playground", label: "Playground" },
  { id: "prompt", label: "System prompt" },
  { id: "channels", label: "Channels" },
]

const AgentHeader = memo(function AgentHeader({
  agent,
  tab,
  onTabChange,
}: {
  agent: Pick<AgentConfig, "name" | "voice" | "tools" | "channels">
  tab: Tab
  onTabChange: (tab: Tab) => void
}) {
  const live = (agent.channels ?? []).filter(
    (channel) => channel.status === "connected"
  )
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          Agents
        </Link>
        <h1 className="mt-1 font-heading text-lg font-semibold">
          {agent.name}
        </h1>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {live.map((channel) => (
            <Chip key={channel.id}>
              <StatusDot status={channel.status} />
              {channel.name}
            </Chip>
          ))}
          <Chip icon={IconMessage}>text</Chip>
          {agent.voice && <Chip icon={IconMicrophone}>voice</Chip>}
          {agent.tools.map((tool) => (
            <Chip key={tool} icon={IconTool}>
              {connectorName(tool)}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex rounded-xl border p-0.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              "rounded-[9px] px-3 py-1 text-xs font-medium text-muted-foreground",
              tab === item.id && "bg-muted text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  )
})
