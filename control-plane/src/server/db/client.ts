import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"

import { ensureDataDirs, paths } from "../env"

ensureDataDirs()

const CLIENT_KEY = Symbol.for("attriage.libsql-client")
const DB_KEY = Symbol.for("attriage.drizzle")
const globals = globalThis as typeof globalThis & {
  [CLIENT_KEY]?: ReturnType<typeof createClient>
  [DB_KEY]?: ReturnType<typeof drizzle>
}

export const client =
  globals[CLIENT_KEY] ??
  (globals[CLIENT_KEY] = createClient({ url: `file:${paths.db()}` }))

export const db = globals[DB_KEY] ?? (globals[DB_KEY] = drizzle({ client }))

const PRAGMA_KEY = Symbol.for("attriage.sqlite-pragmas")
const pragmaGlobals = globalThis as typeof globalThis & {
  [PRAGMA_KEY]?: Promise<void>
}

export const databaseReady =
  pragmaGlobals[PRAGMA_KEY] ??
  (pragmaGlobals[PRAGMA_KEY] = Promise.all([
    client.execute("PRAGMA journal_mode = WAL"),
    client.execute("PRAGMA foreign_keys = ON"),
  ]).then(() => undefined))
