import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconFlask,
  IconMessageChatbot,
} from "@tabler/icons-react"
import type { IconMessage } from "@tabler/icons-react"

import { cn } from "@/lib/utils"
import type { ChannelKind, ChannelStatus } from "@/lib/channels-store"

export const CHANNEL_ICONS: Record<ChannelKind, typeof IconBrandWhatsapp> = {
  whatsapp: IconBrandWhatsapp,
  playground: IconFlask,
  telegram: IconBrandTelegram,
  webchat: IconMessageChatbot,
}

export function ChannelIcon({
  kind,
  className,
}: {
  kind: ChannelKind
  className?: string
}) {
  const Icon = CHANNEL_ICONS[kind]
  return <Icon className={className} />
}

export function StatusDot({ status }: { status: ChannelStatus }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "pairing" && "animate-pulse bg-amber-500",
        status === "disconnected" && "bg-muted-foreground/40"
      )}
    />
  )
}

export function Chip({
  icon: Icon,
  children,
  className,
}: {
  icon?: typeof IconMessage
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground",
        className
      )}
    >
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  )
}

/**
 * Agent picker used for both a channel's default and a single session's
 * override. `defaultLabel` is what the empty value means in context — "no agent"
 * for a channel, "follow the channel default" for a session.
 */
export function AgentSelect({
  agents,
  value,
  onChange,
  defaultLabel,
  disabled,
  className,
  id,
}: {
  agents: { id: string; name: string }[]
  value: string | null
  onChange: (agentId: string | null) => void
  defaultLabel: string
  disabled?: boolean
  className?: string
  id?: string
}) {
  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "h-9 w-full rounded-xl border bg-background px-2 text-sm outline-none focus:border-ring disabled:opacity-50",
        className
      )}
    >
      <option value="">{defaultLabel}</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  )
}

export function timeAgo(ts: number | null) {
  if (!ts) return "never"
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
