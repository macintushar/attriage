import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const output = "src/server/db/schema/auth.ts"
const generated = spawnSync(
  "better-auth",
  [
    "generate",
    "--config",
    "src/server/auth.ts",
    "--output",
    output,
    "--yes",
  ],
  { stdio: "inherit" }
)

if (generated.status !== 0) process.exit(generated.status ?? 1)

// Better Auth CLI currently emits Drizzle's pre-v1 `relations()` declarations.
// Drizzle v1 RC no longer exports that function, and the adapter only needs the
// table definitions. Strip the incompatible relation helpers deterministically.
const source = readFileSync(output, "utf8")
const tablesOnly = source
  .replace(/import \{ relations, sql \} from "drizzle-orm";/, 'import { sql } from "drizzle-orm";')
  .replace(/\nexport const userRelations[\s\S]*$/, "\n")

writeFileSync(output, tablesOnly)

const formatted = spawnSync("prettier", ["--write", output], {
  stdio: "inherit",
})
process.exit(formatted.status ?? 0)
