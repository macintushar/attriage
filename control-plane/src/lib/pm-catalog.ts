import type { CSSProperties } from "react"

import raw from "./pm-catalog.gen.json"

export type ReleaseStage = "ga" | "beta" | "alpha"

export interface ActionMeta {
  name: string
  method: string | null
  kind: string | null
}

export interface Connector {
  slug: string
  name: string
  description: string
  type: string
  stage: ReleaseStage
  streams: string[]
  actions: string[]
  /** False for the majority of connectors — their APIs expose no mutations. */
  canWrite: boolean
  actionMeta: ActionMeta[]
  docs: string | null
}

/** The generated file stores actions as `[name, method, kind]` tuples to keep
 *  the client payload down; expand them once here. */
type RawConnector = Omit<Connector, "actions" | "actionMeta"> & {
  actionMeta: [string, string | null, string | null][]
}

export const CONNECTORS: Connector[] = (raw as unknown as RawConnector[]).map(
  (c) => {
    const actionMeta = c.actionMeta.map(([name, method, kind]) => ({
      name,
      method,
      kind,
    }))
    return { ...c, actionMeta, actions: actionMeta.map((a) => a.name) }
  }
)

const bySlug = new Map(CONNECTORS.map((c) => [c.slug, c]))

export function getConnector(slug: string) {
  return bySlug.get(slug)
}

export function connectorName(slug: string) {
  return bySlug.get(slug)?.name ?? slug
}

export interface CatalogFilter {
  query: string
  stage: ReleaseStage | "all"
}

export function filterConnectors({ query, stage }: CatalogFilter): Connector[] {
  const q = query.trim().toLowerCase()
  return CONNECTORS.filter((c) => {
    if (stage !== "all" && c.stage !== stage) return false
    if (!q) return true
    return (
      c.slug.includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    )
  })
}

/** Deterministic avatar hue per connector so the catalog feels branded */
export function avatarStyle(slug: string): CSSProperties {
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return {
    backgroundColor: `oklch(0.93 0.05 ${hue})`,
    color: `oklch(0.45 0.11 ${hue})`,
  }
}
