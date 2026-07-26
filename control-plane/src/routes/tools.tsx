import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  IconArrowsExchange,
  IconExternalLink,
  IconSearch,
  IconX,
} from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import { CONNECTORS, filterConnectors, getConnector } from "@/lib/pm-catalog"
import type { Connector, ReleaseStage } from "@/lib/pm-catalog"
import { ConnectorAvatar, StageBadge } from "@/components/connector-bits"

export const Route = createFileRoute("/tools")({ component: ToolLibrary })

const PAGE = 60

function ToolLibrary() {
  const [query, setQuery] = useState("")
  const [stage, setStage] = useState<ReleaseStage | "all">("all")
  const [limit, setLimit] = useState(PAGE)
  const [detailSlug, setDetailSlug] = useState<string | null>(null)

  const results = useMemo(
    () => filterConnectors({ query, stage }),
    [query, stage]
  )
  const detail = detailSlug ? getConnector(detailSlug) : undefined

  return (
    <main className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">Tool library</h1>
          <p className="text-sm text-muted-foreground">
            {CONNECTORS.length} integrations your agents can read from and act
            on
          </p>
        </div>
        <div className="flex gap-2">
          <label className="flex h-9 w-64 items-center gap-2 rounded-xl border bg-background px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <IconSearch className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setLimit(PAGE)
              }}
              placeholder="Search tools…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="flex rounded-xl border p-0.5">
            {(["all", "ga", "beta", "alpha"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStage(s)
                  setLimit(PAGE)
                }}
                className={cn(
                  "rounded-[9px] px-2.5 text-xs font-medium text-muted-foreground",
                  stage === s && "bg-muted text-foreground"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {results.slice(0, limit).map((c) => (
              <button
                key={c.slug}
                onClick={() =>
                  setDetailSlug((cur) => (cur === c.slug ? null : c.slug))
                }
                className={cn(
                  "rounded-2xl border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md",
                  detailSlug === c.slug && "border-primary"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <ConnectorAvatar slug={c.slug} name={c.name} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {c.name}
                      </span>
                      <StageBadge stage={c.stage} />
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {c.streams.length} reads · {c.actions.length} actions
                    </div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {c.description}
                </p>
              </button>
            ))}
          </div>
          {results.length > limit && (
            <button
              onClick={() => setLimit((l) => l + PAGE)}
              className="mt-3 w-full rounded-xl border border-dashed py-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Show more ({results.length - limit} remaining)
            </button>
          )}
          {results.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No tools match “{query}”.
            </p>
          )}
        </div>

        {detail && (
          <DetailPanel connector={detail} onClose={() => setDetailSlug(null)} />
        )}
      </div>
    </main>
  )
}

function DetailPanel({
  connector,
  onClose,
}: {
  connector: Connector
  onClose: () => void
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b p-4">
        <ConnectorAvatar
          slug={connector.slug}
          name={connector.name}
          className="size-10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold">{connector.name}</h2>
            <StageBadge stage={connector.stage} />
          </div>
          <code className="text-xs text-muted-foreground">
            {connector.slug}
          </code>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close details"
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {connector.description}
        </p>

        <Section title={`Can read (${connector.streams.length})`}>
          {connector.streams.map((s) => (
            <code
              key={s}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]"
            >
              {s}
            </code>
          ))}
          {connector.streams.length === 0 && <Empty />}
        </Section>

        <Section title={`Can do (${connector.actions.length})`}>
          {connector.actions.map((a) => (
            <code
              key={a}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
            >
              <IconArrowsExchange className="size-3" />
              {a}
            </code>
          ))}
          {connector.actions.length === 0 && <Empty />}
        </Section>

        {connector.docs && (
          <a
            href={connector.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            API documentation
            <IconExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </aside>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium">{title}</h3>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

function Empty() {
  return <span className="text-[11px] text-muted-foreground">none</span>
}
