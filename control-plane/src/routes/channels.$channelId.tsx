import { useEffect, useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  IconArrowLeft,
  IconPin,
  IconPlus,
  IconRobot,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  AgentSelect,
  ChannelIcon,
  Chip,
  StatusDot,
  timeAgo,
} from "@/components/channel-bits"
import { ChannelTranscript } from "@/components/channel-transcript"
import { useChannel } from "@/lib/use-channel"
import { useAgents } from "@/lib/agents-store"
import {
  assignSessionAgent,
  channelKindLabel,
  deleteChannel,
  fetchChannel,
  updateChannel,
  useSessions,
} from "@/lib/channels-store"
import type { Channel, Session } from "@/lib/channels-store"

type Tab = "sessions" | "transcript" | "pairing" | "settings"

export const Route = createFileRoute("/channels/$channelId")({
  loader: async ({ params }) => ({
    channel: await fetchChannel(params.channelId),
  }),
  component: ChannelDetail,
})

function ChannelDetail() {
  const { channel: loaded } = Route.useLoaderData()
  const [channel, setChannel] = useState<Channel | null>(loaded)
  // The playground has nothing to pair, so it does not get a pairing tab.
  const [tab, setTab] = useState<Tab>("sessions")

  useEffect(() => setChannel(loaded), [loaded])

  if (!channel) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">
          Channel not found.{" "}
          <Link to="/channels" className="text-primary underline">
            Back to channels
          </Link>
        </p>
      </main>
    )
  }

  const pairable = channel.kind !== "playground"
  const tabs: { id: Tab; label: string }[] = [
    { id: "sessions", label: "Sessions" },
    { id: "transcript", label: "Transcript" },
    ...(pairable ? [{ id: "pairing" as const, label: "Pairing" }] : []),
    { id: "settings", label: "Settings" },
  ]

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/channels"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            Channels
          </Link>
          <h1 className="mt-1 flex items-center gap-2 font-heading text-lg font-semibold">
            <ChannelIcon kind={channel.kind} className="size-5 text-primary" />
            {channel.name}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip>{channelKindLabel(channel.kind)}</Chip>
            <Chip>
              <StatusDot status={channel.status} />
              {channel.status}
              {channel.phone ? ` · ${channel.phone}` : ""}
            </Chip>
            <Chip icon={IconRobot}>
              {channel.defaultAgentName
                ? `default: ${channel.defaultAgentName}`
                : "no default agent"}
            </Chip>
            <Chip icon={IconUsers}>{channel.sessionCount} sessions</Chip>
          </div>
        </div>
        <div className="flex rounded-xl border p-0.5">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
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

      {!channel.defaultAgentId && channel.kind !== "playground" && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          This channel has no default agent, so messages from new numbers are
          ignored. Set one under Settings.
        </p>
      )}

      {tab === "sessions" && <SessionsTab channel={channel} />}
      {tab === "transcript" && <ChannelTranscript channelId={channel.id} />}
      {tab === "pairing" && <PairingTab channel={channel} />}
      {tab === "settings" && (
        <SettingsTab channel={channel} onChange={setChannel} />
      )}
    </main>
  )
}

/**
 * Every conversation on the channel, and which agent handles each one.
 *
 * Reassigning here pins the session: it stops following the channel default, so
 * a VIP or an escalation can sit on a different agent from everyone else.
 */
function SessionsTab({ channel }: { channel: Channel }) {
  const agents = useAgents()
  const { sessions, loading, reload } = useSessions(channel.id)
  // A brand-new peer shows up on the channel's SSE stream before the next poll.
  useChannel(channel.id, reload)

  const [busy, setBusy] = useState<string | null>(null)

  const assign = async (session: Session, agentId: string | null) => {
    setBusy(session.id)
    try {
      await assignSessionAgent(session.id, agentId)
      await reload()
    } finally {
      setBusy(null)
    }
  }

  if (loading && sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading sessions…</p>
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <p className="text-sm font-medium">No sessions yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          {channel.kind === "whatsapp"
            ? "A session is created the first time a number messages this channel. Pair the number, then message it from another phone."
            : "Sessions appear here as soon as someone starts a conversation."}
        </p>
        {channel.kind === "whatsapp" && (
          <NewSessionForm channelId={channel.id} onCreated={reload} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4"
        >
          <div className="min-w-0 flex-1">
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: session.id }}
              className="block truncate font-medium hover:text-primary"
            >
              {session.peerLabel}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {session.lastMessage
                ? session.lastMessage.slice(0, 90)
                : "no messages yet"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Chip>{session.messageCount} messages</Chip>
              <Chip>active {timeAgo(session.lastActiveAt)}</Chip>
              {session.containerId && <Chip>sandbox up</Chip>}
              {session.agentPinned && <Chip icon={IconPin}>pinned</Chip>}
            </div>
          </div>
          <div className="w-full sm:w-56">
            <AgentSelect
              agents={agents}
              value={session.agentPinned ? session.agentId : null}
              onChange={(agentId) => void assign(session, agentId)}
              disabled={busy === session.id}
              defaultLabel={
                channel.defaultAgentName
                  ? `Channel default (${channel.defaultAgentName})`
                  : "Channel default (none)"
              }
            />
          </div>
        </div>
      ))}
      {channel.kind === "whatsapp" && (
        <NewSessionForm channelId={channel.id} onCreated={reload} />
      )}
    </div>
  )
}

/**
 * Opens a session against a number by hand. Useful before a demo: you get the
 * session (and its agent assignment) ready without waiting to be messaged.
 */
function NewSessionForm({
  channelId,
  onCreated,
}: {
  channelId: string
  onCreated: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [peer, setPeer] = useState("")
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    const digits = peer.replace(/[^\d]/g, "")
    if (!digits) {
      setError("Enter a number with country code, e.g. +91 98765 43210")
      return
    }
    setError(null)
    const res = await fetch(`/api/channels/${channelId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peerJid: `${digits}@s.whatsapp.net` }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `failed to open session (${res.status})`)
      return
    }
    setPeer("")
    setOpen(false)
    await onCreated()
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        <IconPlus data-icon="inline-start" />
        Add a number manually
      </Button>
    )
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border p-3 text-left">
      <input
        value={peer}
        onChange={(e) => setPeer(e.target.value)}
        placeholder="+91 98765 43210"
        className="h-9 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:border-ring"
      />
      <Button size="sm" onClick={() => void create()}>
        Open session
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  )
}

function PairingTab({ channel }: { channel: Channel }) {
  const { status, qr, phone, error, connect, disconnect } = useChannel(
    channel.id
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 rounded-3xl border bg-card p-8">
      <div className="text-center">
        <h2 className="font-heading text-base font-semibold">
          Connect WhatsApp
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Pairs this channel with a real WhatsApp number over WhatsApp Web. Use
          a spare number — this is an unofficial client, and WhatsApp can
          suspend numbers that automate.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <StatusDot status={status} />
        <span className="font-medium capitalize">{status}</span>
        {(phone ?? channel.phone) && (
          <span className="text-muted-foreground">
            · {phone ?? channel.phone}
          </span>
        )}
      </div>

      {qr && (
        <div className="flex flex-col items-center gap-3">
          <img
            src={qr}
            alt="WhatsApp pairing QR code"
            className="size-64 rounded-2xl border bg-white p-2"
          />
          <ol className="text-xs text-muted-foreground">
            <li>1. WhatsApp → Settings → Linked devices</li>
            <li>2. Link a device, then scan this code</li>
          </ol>
        </div>
      )}

      {status === "pairing" && !qr && (
        <p className="text-xs text-muted-foreground">Waiting for a QR code…</p>
      )}

      {error && (
        <p className="max-w-md rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={connect}
          disabled={status === "connected" || status === "pairing"}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === "connected" ? "Connected" : "Connect WhatsApp"}
        </button>
        {status !== "disconnected" && (
          <button
            onClick={disconnect}
            className="rounded-xl border px-4 py-2 text-sm font-medium"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}

function SettingsTab({
  channel,
  onChange,
}: {
  channel: Channel
  onChange: (channel: Channel) => void
}) {
  const agents = useAgents()
  const navigate = useNavigate()
  const [name, setName] = useState(channel.name)
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: {
    name?: string
    defaultAgentId?: string | null
  }) => {
    setSaved("saving")
    setError(null)
    try {
      onChange(await updateChannel(channel.id, patch))
      setSaved("saved")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaved("idle")
    }
  }

  const remove = async () => {
    if (
      !confirm(
        `Delete “${channel.name}”? Its ${channel.sessionCount} session(s) and their transcripts go too. Agents are not affected.`
      )
    )
      return
    await deleteChannel(channel.id)
    void navigate({ to: "/channels" })
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <label className="text-sm font-medium" htmlFor="settings-name">
          Channel name
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:border-ring"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!name.trim() || name === channel.name}
            onClick={() => void save({ name: name.trim() })}
          >
            Save
          </Button>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="settings-agent">
          Default agent
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Handles every session that has not been pinned to another agent —
          including ones already in progress.
        </p>
        <AgentSelect
          id="settings-agent"
          className="mt-1.5"
          agents={agents}
          value={channel.defaultAgentId}
          onChange={(defaultAgentId) => void save({ defaultAgentId })}
          defaultLabel="No agent — messages are ignored"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {saved === "saving" ? "saving…" : saved === "saved" ? "saved" : ""}
      </p>

      {error && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {channel.kind !== "playground" && (
        <div className="rounded-2xl border border-destructive/30 p-4">
          <div className="text-sm font-medium">Delete channel</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Unpairs the number and removes its sessions. The agents it used
            stay.
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => void remove()}
          >
            <IconTrash data-icon="inline-start" />
            Delete “{channel.name}”
          </Button>
        </div>
      )}
    </div>
  )
}
