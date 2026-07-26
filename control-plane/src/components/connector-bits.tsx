import { cn } from "@/lib/utils"
import { avatarStyle } from "@/lib/pm-catalog"
import type { ReleaseStage } from "@/lib/pm-catalog"

export function ConnectorAvatar({
  slug,
  name,
  className,
}: {
  slug: string
  name: string
  className?: string
}) {
  return (
    <span
      style={avatarStyle(slug)}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold uppercase",
        className
      )}
    >
      {name.charAt(0)}
    </span>
  )
}

export function StageBadge({ stage }: { stage: ReleaseStage }) {
  if (stage === "ga") return null
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-px text-[10px] font-medium",
        stage === "beta" && "bg-sky-100 text-sky-700",
        stage === "alpha" && "bg-amber-100 text-amber-700"
      )}
    >
      {stage}
    </span>
  )
}
