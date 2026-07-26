import { useMemo, useState } from "react"
import { IconCheck, IconSearch } from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import { CONNECTORS, filterConnectors, getConnector } from "@/lib/pm-catalog"
import type { ReleaseStage } from "@/lib/pm-catalog"
import { ConnectorAvatar, StageBadge } from "@/components/connector-bits"

const PAGE = 40

interface ConnectorPickerProps {
  selected: string[]
  onToggle: (slug: string) => void
}

export function ConnectorPicker({ selected, onToggle }: ConnectorPickerProps) {
  const [query, setQuery] = useState("")
  const [stage, setStage] = useState<ReleaseStage | "all">("all")
  const [limit, setLimit] = useState(PAGE)

  const results = useMemo(() => {
    const matches = filterConnectors({ query, stage })
    // Pin selected connectors on top so they stay visible while browsing
    return [
      ...matches.filter((c) => selected.includes(c.slug)),
      ...matches.filter((c) => !selected.includes(c.slug)),
    ]
  }, [query, stage, selected])

  const visible = results.slice(0, limit)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-xl border bg-background px-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          <IconSearch className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            placeholder={`Search ${CONNECTORS.length} tools…`}
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

      <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {visible.map((c) => {
          const isSelected = selected.includes(c.slug)
          return (
            <button
              key={c.slug}
              onClick={() => onToggle(c.slug)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50"
              )}
            >
              <ConnectorAvatar slug={c.slug} name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <StageBadge stage={c.stage} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.description}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {c.streams.length} reads · {c.actions.length} actions
              </span>
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  isSelected &&
                    "border-primary bg-primary text-primary-foreground"
                )}
              >
                {isSelected && <IconCheck className="size-3" />}
              </span>
            </button>
          )
        })}
        {results.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tools match “{query}”.
          </p>
        )}
        {results.length > limit && (
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full rounded-xl border border-dashed py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Show more ({results.length - limit} remaining)
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selected.length} selected:{" "}
          {selected.map((s) => getConnector(s)?.name ?? s).join(", ")}
        </p>
      )}
    </div>
  )
}
