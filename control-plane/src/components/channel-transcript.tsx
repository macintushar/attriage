import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconRefresh,
  IconRobot,
  IconSearch,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Chip, timeAgo } from "@/components/channel-bits"
import { MessageBubble } from "@/components/chat-panel"
import { fetchChannelTranscript } from "@/lib/channels-store"
import type {
  ChannelTranscript as Transcript,
  TranscriptSession,
} from "@/lib/channels-store"
import { cn } from "@/lib/utils"

/** Below this many conversations, every one starts open — the page stays scannable. */
const EXPAND_ALL_BELOW = 5

function startsOpen(index: number, count: number, searching: boolean): boolean {
  return searching || count < EXPAND_ALL_BELOW || index === 0
}

/**
 * Every conversation on a channel on one page, read-only.
 *
 * Deliberately has no composer: this is for reviewing what happened on a live
 * WhatsApp number, and there should be no path from reading history to
 * accidentally messaging a real person. Replying is still one click away
 * through the per-session link.
 */
export function ChannelTranscript({ channelId }: { channelId: string }) {
  const [search, setSearch] = useState("")
  const [term, setTerm] = useState("")
  const [data, setData] = useState<Transcript | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Which sections the reader has toggled away from their default state.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  // Guards against a slow early request landing after a later one.
  const requestRef = useRef(0)

  const load = useCallback(
    async (searchTerm: string) => {
      const seq = ++requestRef.current
      setLoading(true)
      try {
        const next = await fetchChannelTranscript(channelId, {
          search: searchTerm,
        })
        if (seq !== requestRef.current) return
        setData(next)
        setError(null)
      } catch (e) {
        if (seq !== requestRef.current) return
        // Leave the last good transcript on screen rather than blanking it.
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (seq === requestRef.current) setLoading(false)
      }
    },
    [channelId]
  )

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    void load(term)
    // A new search changes which sections should be open by default.
    setOverrides({})
  }, [load, term])

  const sessions = data?.sessions ?? []
  const searching = term.length > 0

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background px-1 py-2">
        <div className="relative min-w-56 flex-1">
          <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search every conversation on this channel"
            aria-label="Search transcript"
            className="h-9 w-full rounded-xl border bg-background pr-3 pl-9 text-sm outline-none focus:border-ring"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(term)}
          disabled={loading}
        >
          <IconRefresh data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {loading && !data
          ? "Loading transcript…"
          : `${data?.totalMessages ?? 0} ${searching ? "matching " : ""}message${
              (data?.totalMessages ?? 0) === 1 ? "" : "s"
            } across ${sessions.length} conversation${
              sessions.length === 1 ? "" : "s"
            }`}
        {data?.truncated && " · showing the most recent only"}
      </p>

      {error && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {!loading && sessions.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">
            {searching ? "No messages match" : "No conversations yet"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            {searching
              ? `Nothing on this channel mentions “${term}”.`
              : "Once someone messages this channel, every conversation shows up here."}
          </p>
        </div>
      )}

      {sessions.map((session, index) => (
        <Conversation
          key={session.id}
          session={session}
          open={
            overrides[session.id] ??
            startsOpen(index, sessions.length, searching)
          }
          onToggle={(next) =>
            setOverrides((prev) => ({ ...prev, [session.id]: next }))
          }
        />
      ))}
    </div>
  )
}

function Conversation({
  session,
  open,
  onToggle,
}: {
  session: TranscriptSession
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const Chevron = open ? IconChevronDown : IconChevronRight

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <button
          onClick={() => onToggle(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {session.peerLabel}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Chip>{session.messageCount} messages</Chip>
              <Chip>active {timeAgo(session.lastActiveAt)}</Chip>
              {session.agentName && (
                <Chip icon={IconRobot}>{session.agentName}</Chip>
              )}
            </div>
          </div>
        </button>
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          Open
          <IconExternalLink className="size-3.5" />
        </Link>
      </div>

      {open && (
        <div
          className={cn(
            "space-y-2 border-t bg-[#ece5dd] px-3 py-4",
            session.messages.length === 0 && "text-center"
          )}
        >
          {session.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      )}
    </section>
  )
}
