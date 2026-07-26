import { Link, createFileRoute } from "@tanstack/react-router"
import { IconPlus, IconRobot, IconUsers } from "@tabler/icons-react"

import { buttonVariants } from "@/components/ui/button"
import {
  ChannelIcon,
  Chip,
  StatusDot,
  timeAgo,
} from "@/components/channel-bits"
import { channelKindLabel, useChannels } from "@/lib/channels-store"

export const Route = createFileRoute("/channels/")({ component: Channels })

/**
 * Channels are configured on their own, independently of agents: a channel owns
 * a number and its conversations, and points them at whichever agent should
 * answer.
 */
function Channels() {
  const { channels, error } = useChannels()

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Where people reach you — each channel routes its sessions to an
            agent
          </p>
        </div>
        <Link to="/channels/new" className={buttonVariants()}>
          <IconPlus data-icon="inline-start" />
          Add channel
        </Link>
      </header>

      {error && (
        <p className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {channels.map((channel) => (
          <Link
            key={channel.id}
            to="/channels/$channelId"
            params={{ channelId: channel.id }}
            className="group rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ChannelIcon kind={channel.kind} className="size-5" />
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <StatusDot status={channel.status} />
                {channel.status}
              </span>
            </div>
            <h2 className="mt-3 font-medium group-hover:text-primary">
              {channel.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {channelKindLabel(channel.kind)}
              {channel.phone ? ` · ${channel.phone}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip icon={IconRobot}>
                {channel.defaultAgentName ?? "no default agent"}
              </Chip>
              <Chip icon={IconUsers}>
                {channel.sessionCount === 1
                  ? "1 session"
                  : `${channel.sessionCount} sessions`}
              </Chip>
              {channel.kind !== "playground" && (
                <Chip>added {timeAgo(channel.createdAt)}</Chip>
              )}
            </div>
          </Link>
        ))}

        <Link
          to="/channels/new"
          className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <IconPlus className="size-5" />
          New channel
        </Link>
      </div>
    </main>
  )
}
