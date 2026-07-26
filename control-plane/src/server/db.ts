import { DatabaseSync } from "node:sqlite"

import { ensureDataDirs, paths } from "./env"
import { PLAYGROUND_CHANNEL_ID, sessionId as deriveSessionId } from "./routing"
import type {
  AgentRecord,
  ChannelKind,
  ChannelRecord,
  ChannelStatus,
  ConnectorBinding,
  MessageKind,
  SessionRecord,
} from "./types"
import { log } from "./logger"

ensureDataDirs()

const DB_KEY = Symbol.for("sarvam-control-plane.database")
const globals = globalThis as typeof globalThis & {
  [DB_KEY]?: DatabaseSync
}

/**
 * Vite can re-evaluate server modules during development. Keep one SQLite
 * handle for the process so hot reloads do not leak WAL connections.
 */
export const db =
  globals[DB_KEY] ?? (globals[DB_KEY] = new DatabaseSync(paths.db()))

interface Statement<TRow, TParams extends unknown[]> {
  all: (...params: TParams) => TRow[]
  get: (...params: TParams) => TRow | undefined
  run: (...params: TParams) => { lastInsertRowid: number | bigint }
}

function query<TRow = unknown, TParams extends unknown[] = unknown[]>(
  sql: string
): Statement<TRow, TParams> {
  return db.prepare(sql) as unknown as Statement<TRow, TParams>
}
db.exec("PRAGMA journal_mode = WAL")

function tableColumns(table: string): string[] {
  return query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name)
}

/**
 * Splits the old agent-owned channel into a standalone channel.
 *
 * Before this, `channels` was keyed by agentId and a session belonged to an
 * agent. Now a channel is its own object and owns its sessions. The new channel
 * deliberately keeps the agent's id: the Baileys auth directory
 * (`data/wa/<id>`) and every session workdir are named after it, so a paired
 * number and its conversations survive the refactor instead of needing a rescan.
 */
function migrateAgentOwnedChannels() {
  const channelColumns = tableColumns("channels")
  // A fresh database has no tables yet; a migrated one already has `id`.
  if (!channelColumns.length || channelColumns.includes("id")) return

  const legacy = query<
    { agentId: string; phone: string | null; authDir: string | null },
    []
  >("SELECT agentId, phone, authDir FROM channels").all()
  const agents = query<{ id: string; name: string }, []>(
    "SELECT id, name FROM agents"
  ).all()

  // Rebuilding tables means briefly holding rows that reference a table being
  // replaced, which the foreign-key checker would reject mid-flight.
  db.exec("PRAGMA foreign_keys = OFF")
  // Modern ALTER TABLE RENAME also rewrites REFERENCES clauses in *other*
  // tables — so renaming `sessions` out of the way silently repoints
  // messages.sessionId at the temporary table and every later insert fails with
  // "no such table: sessions_legacy". This pragma restores the old, local
  // behaviour. `repairSessionReferences` cleans up databases migrated before it.
  db.exec("PRAGMA legacy_alter_table = ON")
  db.exec("ALTER TABLE channels RENAME TO channels_legacy")
  db.exec("ALTER TABLE sessions RENAME TO sessions_legacy")
  db.exec("PRAGMA legacy_alter_table = OFF")
  createSchema()

  const now = Date.now()
  const insertChannel = query(
    `INSERT INTO channels (id, name, kind, defaultAgentId, status, phone, lastError, createdAt)
     VALUES (?, ?, 'whatsapp', ?, 'disconnected', ?, NULL, ?)`
  )
  const paired = new Map(legacy.map((row) => [row.agentId, row]))
  for (const agent of agents) {
    const row = paired.get(agent.id)
    insertChannel.run(
      agent.id,
      `${agent.name} WhatsApp`,
      agent.id,
      row?.phone ?? null,
      now
    )
  }

  ensurePlaygroundChannel()

  // `playground` was a magic peer string on the agent's own sessions; it is now
  // a peer on the built-in channel. Reusing each row's stored id keeps its
  // workdir — and therefore its Pi conversation history — intact.
  const insertSessionRow = query(
    `INSERT OR IGNORE INTO sessions
       (id, channelId, peerJid, agentId, agentPinned, workdir, containerId, status, createdAt, lastActiveAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  )
  for (const row of query<
    {
      id: string
      agentId: string
      peerJid: string
      workdir: string
      status: string
      createdAt: number
      lastActiveAt: number
    },
    []
  >("SELECT * FROM sessions_legacy").all()) {
    const isPlayground = !row.peerJid.includes("@")
    insertSessionRow.run(
      row.id,
      isPlayground ? PLAYGROUND_CHANNEL_ID : row.agentId,
      isPlayground ? `${row.peerJid}:${row.agentId}` : row.peerJid,
      row.agentId,
      // Playground sessions have no channel default to follow, so they are
      // pinned to the agent whose playground they belong to.
      isPlayground ? 1 : 0,
      row.workdir,
      row.status === "running" ? "idle" : row.status,
      row.createdAt,
      row.lastActiveAt
    )
  }

  db.exec("DROP TABLE channels_legacy")
  db.exec("DROP TABLE sessions_legacy")
  db.exec("PRAGMA foreign_keys = ON")
  log.info("database.migration.agent_channels_completed", {
    agents: agents.length,
  })
}

function createSchema() {
  db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  voice        INTEGER NOT NULL DEFAULT 1,
  tools        TEXT NOT NULL DEFAULT '[]',
  systemPrompt TEXT NOT NULL DEFAULT '',
  goal         TEXT NOT NULL DEFAULT '',
  language     TEXT NOT NULL DEFAULT 'auto',
  ttsSpeaker   TEXT NOT NULL DEFAULT 'shubh',
  createdAt    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connectors (
  agentId        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  connectionName TEXT NOT NULL,
  allowedActions TEXT NOT NULL DEFAULT '[]',
  credentialEnv  TEXT NOT NULL DEFAULT '{}',
  config         TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (agentId, slug)
);

CREATE TABLE IF NOT EXISTS channels (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'whatsapp',
  -- Deleting an agent must not silently break a live number: the channel stays
  -- and reports that it has no agent configured.
  defaultAgentId TEXT REFERENCES agents(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'disconnected',
  phone          TEXT,
  lastError      TEXT,
  createdAt      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  channelId    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  peerJid      TEXT NOT NULL,
  agentId      TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agentPinned  INTEGER NOT NULL DEFAULT 0,
  workdir      TEXT NOT NULL,
  containerId  TEXT,
  status       TEXT NOT NULL DEFAULT 'idle',
  createdAt    INTEGER NOT NULL,
  lastActiveAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_channel_peer ON sessions(channelId, peerJid);

`)
  db.exec(sessionChildDdl("messages", "messages", true))
  db.exec(sessionChildDdl("runs", "runs", true))
}

/**
 * DDL for the two tables that hang off `sessions`. Shared so a rebuild produces
 * exactly the schema `createSchema` would have.
 */
function sessionChildDdl(
  table: "messages" | "runs",
  name: string,
  ifNotExists = false
): string {
  const head = `CREATE TABLE ${ifNotExists ? "IF NOT EXISTS " : ""}${name}`
  if (table === "messages") {
    // `audioSeconds` is last so a fresh table matches the column order that
    // `ensureColumn` produces on an existing one — see `rebuildTable`.
    return `${head} (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  transcript   TEXT,
  audioPath    TEXT,
  createdAt    INTEGER NOT NULL,
  audioSeconds REAL
)`
  }
  return `${head} (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  messageId INTEGER,
  kind      TEXT NOT NULL,
  stages    TEXT NOT NULL DEFAULT '[]',
  totalMs   INTEGER,
  startedAt INTEGER NOT NULL
)`
}

/**
 * Repairs `messages` and `runs` in a database migrated before the
 * `legacy_alter_table` fix above, where they were left pointing at the
 * temporary `sessions_legacy` table. Symptom: every message insert fails with
 * "no such table: main.sessions_legacy", so no conversation can be recorded.
 */
function repairSessionReferences() {
  for (const table of ["messages", "runs"] as const) {
    const sql = query<{ sql: string | null }, [string]>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table)?.sql
    if (!sql?.includes("sessions_legacy")) continue

    const rows = Number(
      query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ??
        0
    )
    db.exec("PRAGMA foreign_keys = OFF")
    db.exec("PRAGMA legacy_alter_table = ON")
    db.exec(sessionChildDdl(table, `${table}_rebuilt`))
    // Copy by name, not `SELECT *`: the old table's column order depends on
    // which `ensureColumn` calls have run against it, and a positional copy
    // would silently shuffle values between columns.
    const shared = tableColumns(`${table}_rebuilt`).filter((column) =>
      tableColumns(table).includes(column)
    )
    db.exec(
      `INSERT INTO ${table}_rebuilt (${shared.join(", ")})
       SELECT ${shared.join(", ")} FROM ${table}`
    )
    db.exec(`DROP TABLE ${table}`)
    db.exec(`ALTER TABLE ${table}_rebuilt RENAME TO ${table}`)
    db.exec("PRAGMA legacy_alter_table = OFF")
    db.exec("PRAGMA foreign_keys = ON")
    log.info("database.migration.session_reference_repaired", { table, rows })
  }
}

/**
 * `CREATE TABLE IF NOT EXISTS` above never alters an existing table, so columns
 * added after someone's DB was created need backfilling explicitly. Cheap enough
 * to run on every boot.
 */
function ensureColumn(table: string, column: string, definition: string) {
  if (!tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function dropColumn(table: string, column: string) {
  if (tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
}

/** The channel behind the in-app playground and `try-turn`. Always present. */
function ensurePlaygroundChannel() {
  query(
    `INSERT OR IGNORE INTO channels (id, name, kind, defaultAgentId, status, createdAt)
     VALUES (?, 'Playground', 'playground', NULL, 'connected', ?)`
  ).run(PLAYGROUND_CHANNEL_ID, Date.now())
}

migrateAgentOwnedChannels()
db.exec("PRAGMA foreign_keys = ON")
createSchema()
repairSessionReferences()

ensureColumn("connectors", "config", "TEXT NOT NULL DEFAULT '{}'")
ensureColumn("agents", "goal", "TEXT NOT NULL DEFAULT ''")
ensureColumn("agents", "language", "TEXT NOT NULL DEFAULT 'auto'")
ensureColumn("agents", "ttsSpeaker", "TEXT NOT NULL DEFAULT 'shubh'")
// Voice-note length, measured from the audio. Null for text and for a voice
// note recorded before this column existed — `backfillAudioDurations` fills those.
ensureColumn("messages", "audioSeconds", "REAL")
// An agent is no longer bound to one channel; channels choose agents now.
dropColumn("agents", "channel")
ensurePlaygroundChannel()

// Keep absolute session paths aligned with the consolidated data directory
// after moving state from the legacy package.
query(
  "UPDATE sessions SET workdir = ? || '/' || id WHERE workdir != ? || '/' || id"
).run(paths.sessions(), paths.sessions())

interface AgentRow {
  id: string
  name: string
  voice: number
  tools: string
  systemPrompt: string
  goal: string
  language: string
  ttsSpeaker: string
  createdAt: number
}

function toAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    voice: row.voice === 1,
    tools: JSON.parse(row.tools),
    systemPrompt: row.systemPrompt,
    goal: row.goal,
    language: row.language,
    ttsSpeaker: row.ttsSpeaker,
    createdAt: row.createdAt,
  }
}

export function listAgents(): AgentRecord[] {
  return query<AgentRow, []>("SELECT * FROM agents ORDER BY createdAt DESC")
    .all()
    .map(toAgent)
}

export function getAgent(id: string): AgentRecord | null {
  const row = query<AgentRow, [string]>(
    "SELECT * FROM agents WHERE id = ?"
  ).get(id)
  return row ? toAgent(row) : null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Turns a display name into an id that is free in `table`. */
function uniqueId(
  table: "agents" | "channels",
  name: string,
  requested: string | undefined,
  fallback: string
): string {
  const base = requested ?? (slugify(name) || fallback)
  const taken = (id: string) =>
    query<{ id: string }, [string]>(`SELECT id FROM ${table} WHERE id = ?`).get(
      id
    ) !== undefined
  let id = base || fallback
  let n = 2
  while (taken(id)) id = `${base}-${n++}`
  return id
}

export function createAgent(
  input: Omit<AgentRecord, "id" | "createdAt"> & { id?: string }
): AgentRecord {
  const id = uniqueId("agents", input.name, input.id, "agent")
  const agent: AgentRecord = { ...input, id, createdAt: Date.now() }
  query(
    `INSERT INTO agents (id, name, voice, tools, systemPrompt, goal, language, ttsSpeaker, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    agent.id,
    agent.name,
    agent.voice ? 1 : 0,
    JSON.stringify(agent.tools),
    agent.systemPrompt,
    agent.goal,
    agent.language,
    agent.ttsSpeaker,
    agent.createdAt
  )
  return agent
}

export function updateAgent(
  id: string,
  patch: Partial<AgentRecord>
): AgentRecord | null {
  const current = getAgent(id)
  if (!current) return null
  const next = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
  }
  query(
    `UPDATE agents SET name = ?, voice = ?, tools = ?, systemPrompt = ?,
       goal = ?, language = ?, ttsSpeaker = ? WHERE id = ?`
  ).run(
    next.name,
    next.voice ? 1 : 0,
    JSON.stringify(next.tools),
    next.systemPrompt,
    next.goal,
    next.language,
    next.ttsSpeaker,
    id
  )
  return next
}

export function deleteAgent(id: string) {
  query("DELETE FROM agents WHERE id = ?").run(id)
}

export function getConnectors(agentId: string): ConnectorBinding[] {
  return query<
    {
      agentId: string
      slug: string
      connectionName: string
      allowedActions: string
      credentialEnv: string
      config: string
    },
    [string]
  >("SELECT * FROM connectors WHERE agentId = ?")
    .all(agentId)
    .map((r) => ({
      agentId: r.agentId,
      slug: r.slug,
      connectionName: r.connectionName,
      allowedActions: JSON.parse(r.allowedActions),
      credentialEnv: JSON.parse(r.credentialEnv),
      config: JSON.parse(r.config),
    }))
}

export function setConnectors(agentId: string, bindings: ConnectorBinding[]) {
  query("DELETE FROM connectors WHERE agentId = ?").run(agentId)
  const insert = query(
    `INSERT INTO connectors (agentId, slug, connectionName, allowedActions, credentialEnv, config)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const b of bindings) {
    insert.run(
      agentId,
      b.slug,
      b.connectionName,
      JSON.stringify(b.allowedActions),
      JSON.stringify(b.credentialEnv),
      JSON.stringify(b.config)
    )
  }
}

// ── channels ────────────────────────────────────────────────────────────────

interface ChannelRow {
  id: string
  name: string
  kind: string
  defaultAgentId: string | null
  status: string
  phone: string | null
  lastError: string | null
  createdAt: number
}

function toChannel(row: ChannelRow): ChannelRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ChannelKind,
    defaultAgentId: row.defaultAgentId,
    status: row.status as ChannelStatus,
    phone: row.phone,
    lastError: row.lastError,
    createdAt: row.createdAt,
  }
}

export function listChannels(): ChannelRecord[] {
  return query<ChannelRow, []>("SELECT * FROM channels ORDER BY createdAt")
    .all()
    .map(toChannel)
}

export function getChannel(id: string): ChannelRecord | null {
  const row = query<ChannelRow, [string]>(
    "SELECT * FROM channels WHERE id = ?"
  ).get(id)
  return row ? toChannel(row) : null
}

export function createChannel(input: {
  name: string
  kind: ChannelKind
  defaultAgentId?: string | null
  id?: string
}): ChannelRecord {
  const id = uniqueId("channels", input.name, input.id, "channel")
  const channel: ChannelRecord = {
    id,
    name: input.name,
    kind: input.kind,
    defaultAgentId: input.defaultAgentId ?? null,
    status: "disconnected",
    phone: null,
    lastError: null,
    createdAt: Date.now(),
  }
  query(
    `INSERT INTO channels (id, name, kind, defaultAgentId, status, phone, lastError, createdAt)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).run(
    channel.id,
    channel.name,
    channel.kind,
    channel.defaultAgentId,
    channel.status,
    channel.createdAt
  )
  return channel
}

export function updateChannel(
  id: string,
  patch: Partial<Omit<ChannelRecord, "id" | "kind" | "createdAt">>
): ChannelRecord | null {
  const current = getChannel(id)
  if (!current) return null
  // An explicit `undefined` means "leave this alone" — spreading it in would
  // both wipe the column and hand SQLite a value it refuses to bind.
  const defined = Object.fromEntries(
    Object.entries(patch as Record<string, unknown>).filter(
      ([, value]) => value !== undefined
    )
  )
  const next = { ...current, ...defined }
  query(
    `UPDATE channels SET name = ?, defaultAgentId = ?, status = ?, phone = ?, lastError = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.defaultAgentId,
    next.status,
    next.phone,
    next.lastError,
    id
  )
  return next
}

export function deleteChannel(id: string) {
  query("DELETE FROM channels WHERE id = ?").run(id)
}

/**
 * Which real channels hand work to this agent — as their default, or through a
 * pinned session. The playground is excluded: every agent has one, so listing it
 * would say nothing about where the agent is actually reachable.
 */
export function channelsUsingAgent(agentId: string): ChannelRecord[] {
  return query<ChannelRow, [string, string]>(
    `SELECT DISTINCT c.* FROM channels c
       LEFT JOIN sessions s ON s.channelId = c.id
      WHERE c.kind != 'playground'
        AND (c.defaultAgentId = ? OR (s.agentId = ? AND s.agentPinned = 1))
      ORDER BY c.createdAt`
  )
    .all(agentId, agentId)
    .map(toChannel)
}

// ── sessions ────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  channelId: string
  peerJid: string
  agentId: string | null
  agentPinned: number
  workdir: string
  containerId: string | null
  status: string
  createdAt: number
  lastActiveAt: number
}

function toSession(row: SessionRow): SessionRecord {
  return { ...row, agentPinned: row.agentPinned === 1 }
}

export function getSession(id: string): SessionRecord | null {
  const row = query<SessionRow, [string]>(
    "SELECT * FROM sessions WHERE id = ?"
  ).get(id)
  return row ? toSession(row) : null
}

export function findSession(
  channelId: string,
  peerJid: string
): SessionRecord | null {
  const row = query<SessionRow, [string, string]>(
    "SELECT * FROM sessions WHERE channelId = ? AND peerJid = ?"
  ).get(channelId, peerJid)
  return row ? toSession(row) : null
}

export interface SessionSummary extends SessionRecord {
  messageCount: number
  lastMessageAt: number | null
  lastMessage: string | null
}

export function listSessions(channelId: string): SessionSummary[] {
  return query<SessionRow & Record<string, unknown>, [string]>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM messages m WHERE m.sessionId = s.id) AS messageCount,
            (SELECT MAX(createdAt) FROM messages m WHERE m.sessionId = s.id) AS lastMessageAt,
            (SELECT COALESCE(NULLIF(m.text, ''), m.transcript)
               FROM messages m WHERE m.sessionId = s.id
              ORDER BY m.id DESC LIMIT 1) AS lastMessage
       FROM sessions s
      WHERE s.channelId = ?
      ORDER BY s.lastActiveAt DESC`
  )
    .all(channelId)
    .map((row) => ({
      ...toSession(row),
      messageCount: Number(row.messageCount ?? 0),
      lastMessageAt: (row.lastMessageAt as number | null) ?? null,
      lastMessage: (row.lastMessage as string | null) ?? null,
    }))
}

export function countSessions(channelId: string): number {
  return Number(
    query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM sessions WHERE channelId = ?"
    ).get(channelId)?.n ?? 0
  )
}

/**
 * Finds or opens the session for a peer on a channel.
 *
 * The agent recorded here is the channel's default at the time the peer first
 * wrote in; `resolveAgentId` decides whether it still applies.
 */
export function ensureSessionRow(
  channelId: string,
  peerJid: string,
  agentId: string | null,
  options: { pinned?: boolean } = {}
): { session: SessionRecord; created: boolean } {
  const existing = findSession(channelId, peerJid)
  if (existing) return { session: existing, created: false }

  const id = deriveSessionId(channelId, peerJid)
  const now = Date.now()
  const session: SessionRecord = {
    id,
    channelId,
    peerJid,
    agentId,
    agentPinned: options.pinned ?? false,
    workdir: paths.sessionDir(id),
    containerId: null,
    status: "idle",
    createdAt: now,
    lastActiveAt: now,
  }
  query(
    `INSERT INTO sessions
       (id, channelId, peerJid, agentId, agentPinned, workdir, containerId, status, createdAt, lastActiveAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'idle', ?, ?)`
  ).run(
    session.id,
    session.channelId,
    session.peerJid,
    session.agentId,
    session.agentPinned ? 1 : 0,
    session.workdir,
    session.createdAt,
    session.lastActiveAt
  )
  return { session, created: true }
}

/**
 * Overrides (or clears) a session's agent from the control plane. Clearing it
 * puts the session back under the channel's default.
 */
export function setSessionAgent(
  id: string,
  agentId: string | null,
  pinned: boolean
): SessionRecord | null {
  query("UPDATE sessions SET agentId = ?, agentPinned = ? WHERE id = ?").run(
    agentId,
    pinned ? 1 : 0,
    id
  )
  return getSession(id)
}

export function touchSession(
  id: string,
  patch: { containerId?: string | null; status?: string; agentId?: string } = {}
) {
  const sets: string[] = ["lastActiveAt = ?"]
  const args: (string | number | null)[] = [Date.now()]
  if (patch.containerId !== undefined) {
    sets.push("containerId = ?")
    args.push(patch.containerId)
  }
  if (patch.status !== undefined) {
    sets.push("status = ?")
    args.push(patch.status)
  }
  // The resolved agent is written back so the sessions list shows what actually
  // answered, not what the default happened to be when the peer first wrote in.
  if (patch.agentId !== undefined) {
    sets.push("agentId = ?")
    args.push(patch.agentId)
  }
  args.push(id)
  query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...args)
}

export function deleteSession(id: string) {
  query("DELETE FROM sessions WHERE id = ?").run(id)
}

/**
 * Playground sessions belong to the agent they were opened against, so they go
 * when it does. Channel sessions do not: a real conversation with a real person
 * outlives whichever agent happened to be answering it.
 */
export function playgroundSessionsFor(agentId: string): SessionRecord[] {
  return query<SessionRow, [string, string]>(
    "SELECT * FROM sessions WHERE channelId = ? AND agentId = ?"
  )
    .all(PLAYGROUND_CHANNEL_ID, agentId)
    .map(toSession)
}

export function staleSessions(idleMs: number): SessionRecord[] {
  return query<SessionRow, [number]>(
    "SELECT * FROM sessions WHERE containerId IS NOT NULL AND lastActiveAt < ?"
  )
    .all(Date.now() - idleMs)
    .map(toSession)
}

export function insertMessage(row: {
  sessionId: string
  role: "user" | "agent"
  kind: MessageKind
  text: string
  transcript?: string | null
  audioPath?: string | null
  /** Voice only. Measured from the audio, so history shows a real length. */
  audioSeconds?: number | null
}): number {
  const res = query(
    `INSERT INTO messages (sessionId, role, kind, text, transcript, audioPath, createdAt, audioSeconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.sessionId,
    row.role,
    row.kind,
    row.text,
    row.transcript ?? null,
    row.audioPath ?? null,
    Date.now(),
    row.audioSeconds ?? null
  )
  return Number(res.lastInsertRowid)
}

/**
 * Voice messages whose duration was never recorded — rows written before the
 * column existed. The audio is still on disk, so the length is recoverable.
 */
export function messagesMissingAudioDuration(limit = 500): {
  id: number
  audioPath: string
}[] {
  return query<{ id: number; audioPath: string }, [number]>(
    `SELECT id, audioPath FROM messages
      WHERE kind = 'voice' AND audioPath IS NOT NULL AND audioSeconds IS NULL
      ORDER BY id DESC LIMIT ?`
  ).all(limit)
}

export function setMessageAudioSeconds(id: number, seconds: number) {
  query("UPDATE messages SET audioSeconds = ? WHERE id = ?").run(seconds, id)
}

export function patchMessage(
  id: number,
  patch: { text?: string; transcript?: string; audioPath?: string }
) {
  const sets: string[] = []
  const args: (string | number)[] = []
  for (const key of ["text", "transcript", "audioPath"] as const) {
    const value = patch[key]
    if (value === undefined) continue
    sets.push(`${key} = ?`)
    args.push(value)
  }
  if (!sets.length) return
  args.push(id)
  query(`UPDATE messages SET ${sets.join(", ")} WHERE id = ?`).run(...args)
}

interface MessageRow {
  id: number
  sessionId: string
  role: string
  kind: string
  text: string
  transcript: string | null
  audioPath: string | null
  createdAt: number
  audioSeconds: number | null
}

export function listMessages(sessionId: string) {
  return query<MessageRow, [string]>(
    "SELECT * FROM messages WHERE sessionId = ? ORDER BY id"
  ).all(sessionId)
}

/** `%` and `_` in a search term are literal, not wildcards. */
function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * Every message on a channel, across all of its sessions.
 *
 * `messages` has no channelId of its own, so this joins through `sessions`.
 * The cap keeps the *newest* rows rather than the oldest, so a long-running
 * channel shows recent history instead of its first day — callers re-sort
 * ascending once the rows are grouped back into conversations.
 */
export function listChannelMessages(
  channelId: string,
  opts: { search?: string; limit?: number } = {}
): (MessageRow & { peerJid: string })[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 2_000, 5_000))
  const search = opts.search?.trim()
  const where = search
    ? "s.channelId = ? AND (m.text LIKE ? ESCAPE '\\' OR m.transcript LIKE ? ESCAPE '\\')"
    : "s.channelId = ?"
  const args: (string | number)[] = search
    ? [channelId, likeTerm(search), likeTerm(search), limit]
    : [channelId, limit]
  // Row type only: leaving TParams at its `unknown[]` default is what lets the
  // conditionally built `args` spread typecheck, as in `updateSession`.
  return query<MessageRow & { peerJid: string }>(
    `SELECT m.*, s.peerJid FROM messages m
       JOIN sessions s ON s.id = m.sessionId
      WHERE ${where}
      ORDER BY m.id DESC
      LIMIT ?`
  ).all(...args)
}
