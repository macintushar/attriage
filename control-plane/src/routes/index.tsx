import { Link, createFileRoute } from "@tanstack/react-router"
import {
  IconMessage,
  IconMicrophone,
  IconPlus,
  IconRobot,
  IconTool,
} from "@tabler/icons-react"

import { buttonVariants } from "@/components/ui/button"
import { Chip, StatusDot, timeAgo } from "@/components/channel-bits"
import { useAgents } from "@/lib/agents-store"
import { connectorName } from "@/lib/pm-catalog"

export const Route = createFileRoute("/")({ component: Dashboard })

function Dashboard() {
  const agents = useAgents()

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            What your bots do. Where they answer is set up under{" "}
            <Link to="/channels" className="underline hover:text-foreground">
              Channels
            </Link>
            .
          </p>
        </div>
        <Link to="/agents/new" className={buttonVariants()}>
          <IconPlus data-icon="inline-start" />
          Create agent
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {agents.map((agent) => {
          const channels = agent.channels ?? []
          return (
            <Link
              key={agent.id}
              to="/agents/$agentId"
              params={{ agentId: agent.id }}
              className="group rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <IconRobot className="size-5" />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  created {timeAgo(agent.createdAt)}
                </span>
              </div>
              <h2 className="mt-3 font-medium group-hover:text-primary">
                {agent.name}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {channels.length === 0 ? (
                  <Chip>playground only</Chip>
                ) : (
                  channels.slice(0, 2).map((channel) => (
                    <Chip key={channel.id}>
                      <StatusDot status={channel.status} />
                      {channel.name}
                    </Chip>
                  ))
                )}
                <Chip icon={IconMessage}>text</Chip>
                {agent.voice && <Chip icon={IconMicrophone}>voice</Chip>}
                <Chip icon={IconTool}>
                  {agent.tools.length === 0
                    ? "no tools"
                    : agent.tools.slice(0, 2).map(connectorName).join(", ") +
                      (agent.tools.length > 2
                        ? ` +${agent.tools.length - 2}`
                        : "")}
                </Chip>
              </div>
            </Link>
          )
        })}

        <Link
          to="/agents/new"
          className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <IconPlus className="size-5" />
          New agent
        </Link>
      </div>
    </main>
  )
}

