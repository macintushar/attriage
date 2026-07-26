import { useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconCheck } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AgentSelect, CHANNEL_ICONS } from "@/components/channel-bits"
import { CHANNEL_KINDS, createChannel } from "@/lib/channels-store"
import type { ChannelKind } from "@/lib/channels-store"
import { useAgents } from "@/lib/agents-store"

export const Route = createFileRoute("/channels/new")({ component: NewChannel })

function NewChannel() {
  const navigate = useNavigate()
  const agents = useAgents()
  const [name, setName] = useState("")
  const [kind, setKind] = useState<ChannelKind>("whatsapp")
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const channel = await createChannel({
        name: name.trim(),
        kind,
        defaultAgentId,
      })
      void navigate({
        to: "/channels/$channelId",
        params: { channelId: channel.id },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link
        to="/channels"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        Channels
      </Link>

      <h1 className="mt-4 font-heading text-xl font-semibold">Add channel</h1>
      <p className="text-sm text-muted-foreground">
        A channel is one place people message you. Pair it after you create it.
      </p>

      <section className="mt-6 space-y-5">
        <div>
          <label className="text-sm font-medium" htmlFor="channel-name">
            Channel name
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            For you, not for patients — e.g. “Hospital main line”.
          </p>
          <input
            id="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hospital WhatsApp"
            className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
          />
        </div>

        <div>
          <div className="text-sm font-medium">Type</div>
          <div className="mt-1.5 grid grid-cols-3 gap-3">
            {CHANNEL_KINDS.map((option) => {
              const Icon = CHANNEL_ICONS[option.id]
              const selected = kind === option.id
              return (
                <button
                  key={option.id}
                  disabled={!option.available}
                  onClick={() => setKind(option.id)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    selected && "border-primary bg-primary/5",
                    !option.available && "opacity-50"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      selected ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <div className="mt-2 text-sm font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.available ? option.desc : "coming soon"}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="channel-agent">
            Default agent
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every new conversation on this channel starts here. You can reassign
            individual sessions later.
          </p>
          <AgentSelect
            id="channel-agent"
            className="mt-1.5"
            agents={agents}
            value={defaultAgentId}
            onChange={setDefaultAgentId}
            defaultLabel="No agent — messages are ignored"
          />
          {agents.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600">
              You have no agents yet.{" "}
              <Link to="/agents/new" className="underline">
                Create one first
              </Link>{" "}
              so this channel has something to answer with.
            </p>
          )}
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <footer className="mt-8 flex justify-end">
        <Button
          onClick={() => void create()}
          disabled={creating || !name.trim()}
        >
          {creating ? "Creating…" : "Create channel"}
          <IconCheck data-icon="inline-end" />
        </Button>
      </footer>
    </main>
  )
}
