import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/libsql/migrator"

import { db, databaseReady } from "./client"

const MIGRATION_KEY = Symbol.for("attriage.database-migrations")
const globals = globalThis as typeof globalThis & {
  [MIGRATION_KEY]?: Promise<void>
}

export function migrateDatabase() {
  return (
    globals[MIGRATION_KEY] ??
    (globals[MIGRATION_KEY] = databaseReady
      .then(() =>
        migrate(db, {
          migrationsFolder: fileURLToPath(
            new URL("../../../drizzle", import.meta.url)
          ),
        })
      )
      .then(() => undefined))
  )
}
