// Slims pm-connectors.json (7.8MB, incl. full docs_md) down to the fields the
// UI needs. Rerun with `bun run gen:catalog` whenever pm-connectors.json changes.
import { readFileSync, writeFileSync } from "node:fs"

const src = JSON.parse(
  readFileSync(new URL("../pm-connectors.json", import.meta.url), "utf8")
)

const slim = src
  .map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    type: c.integration_type,
    stage: c.release_stage,
    streams: (c.streams ?? []).map((s) => s.name),
    // Most of the 547 connectors are read-only. The builder needs to know so it
    // stops offering them as things the agent can "do".
    canWrite: Boolean(c.capabilities?.write),
    // Tuples, not objects: this ships to the browser, and `[name, method, kind]`
    // costs roughly half of `{name, method, kind}` across ~1,900 actions.
    // pm-catalog.ts expands them and derives the plain `actions` list.
    actionMeta: (c.write_actions ?? []).map((a) => [
      a.name,
      a.method ?? null,
      a.kind ?? null,
    ]),
    docs: c.docs_url ?? null,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug))

const out = new URL("../src/lib/pm-catalog.gen.json", import.meta.url)
writeFileSync(out, JSON.stringify(slim))
console.log(`wrote ${slim.length} connectors to src/lib/pm-catalog.gen.json`)
