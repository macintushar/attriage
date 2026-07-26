import { useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconPin, IconTrash } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat-panel"
import { TracePanel } from "@/components/trace-panel"
import { AgentSelect, Chip, timeAgo } from "@/components/channel-bits"
import { useSessionRun } from "@/lib/agent-run"
import { useAgents } from "@/lib/agents-store"
import {
  assignSessionAgent,
  deleteSession,
  fetchSession,
} from "@/lib/channels-store"
import type { SessionDetail } from "@/lib/channels-store"

export const Route = createFileRoute("/sessions/$sessionId")({
  loader: async ({ params }) => ({
    session: await fetchSession(params.sessionId),
  }),
  component: SessionRoute,
})

function SessionRoute() {
  const { session } = Route.useLoaderData()

  if (!session) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">
          Session not found.{" "}
          <Link to="/channels" className="text-primary underline">
            Back to channels
          </Link>
        </p>
      </main>
    )
  }

  // Keyed so switching sessions starts a clean stream rather than inheriting the
  // previous conversation's messages.
  return <SessionView key={session.id} loaded={session} />
}

/**
 * One conversation: who it is with, which agent answers it, the transcript, and
 * the live trace of the turn in flight.
 */
function SessionView({ loaded }: { loaded: SessionDetail }) {
  const navigate = useNavigate()
  const agents = useAgents()
  const [session, setSession] = useState(loaded)
  const [busy, setBusy] = useState(false)

  const agentName =
    agents.find((a) => a.id === session.effectiveAgentId)?.name ??
    session.effectiveAgentName
  const agent = agents.find((a) => a.id === session.effectiveAgentId)

  const { messages, run, isBusy, error, sendText, sendVoice } = useSessionRun(
    session.id,
    { canSend: Boolean(session.effectiveAgentId), history: loaded.messages }
  )

  const assign = async (agentId: string | null) => {
    setBusy(true)
    try {
      await assignSessionAgent(session.id, agentId)
      const fresh = await fetchSession(session.id)
      if (fresh) setSession(fresh)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Reset the conversation with ${session.peerLabel}?`)) return
    await deleteSession(session.id)
    void navigate({
      to: "/channels/$channelId",
      params: { channelId: session.channelId },
    })
  }

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 p-4 sm:p-6 lg:h-full">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/channels/$channelId"
            params={{ channelId: session.channelId }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            {session.channelName}
          </Link>
          <h1 className="mt-1 font-heading text-lg font-semibold">
            {session.peerLabel}
          </h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip>{messages.length} messages</Chip>
            <Chip>active {timeAgo(session.lastActiveAt)}</Chip>
            {session.containerId && <Chip>sandbox up</Chip>}
            {session.agentPinned && <Chip icon={IconPin}>pinned agent</Chip>}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="w-56">
            <label
              className="text-xs text-muted-foreground"
              htmlFor="session-agent"
            >
              Agent for this session
            </label>
            <AgentSelect
              id="session-agent"
              className="mt-1"
              agents={agents}
              value={session.agentPinned ? session.agentId : null}
              onChange={(agentId) => void assign(agentId)}
              disabled={busy}
              defaultLabel={
                session.channelDefaultAgentId
                  ? `Channel default (${
                      agents.find((a) => a.id === session.channelDefaultAgentId)
                        ?.name ?? session.channelDefaultAgentId
                    })`
                  : "Channel default (none)"
              }
            />
          </div>
          <Button
            variant="destructive"
            size="icon"
            onClick={() => void remove()}
          >
            <IconTrash />
          </Button>
        </div>
      </header>

      {!session.effectiveAgentId && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          No agent is assigned to this session, so messages from{" "}
          {session.peerLabel} are ignored. Pick an agent above, or set a default
          on the channel.
        </p>
      )}

      {session.channelKind === "whatsapp" && (
        <p className="text-xs text-muted-foreground">
          This is a live WhatsApp conversation — anything you send here is
          delivered to {session.peerLabel} by {agentName ?? "the agent"}.
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <ChatPanel
          agentName={agentName ?? "Unassigned"}
          voiceEnabled={agent?.voice ?? false}
          messages={messages}
          isBusy={isBusy}
          error={error}
          onSendText={sendText}
          onSendVoice={sendVoice}
          readOnly={!session.effectiveAgentId}
          readOnlyReason="Assign an agent to reply here"
        />
        <TracePanel run={run} />
      </div>
    </main>
  )
}
