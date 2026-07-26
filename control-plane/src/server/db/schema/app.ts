import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organization } from "./auth"

export const agents = sqliteTable(
  "agents",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    voice: integer({ mode: "boolean" }).notNull().default(true),
    tools: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    systemPrompt: text().notNull().default(""),
    goal: text().notNull().default(""),
    language: text().notNull().default("auto"),
    ttsSpeaker: text().notNull().default("shubh"),
    createdAt: integer().notNull(),
  },
  (table) => [uniqueIndex("agents_org_id").on(table.organizationId, table.id)]
)

export const connectors = sqliteTable(
  "connectors",
  {
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    connectionName: text().notNull(),
    allowedActions: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    credentialEnv: text({ mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    config: text({ mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.slug] })]
)

export const channels = sqliteTable(
  "channels",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: text().notNull(),
    defaultAgentId: text().references(() => agents.id, {
      onDelete: "set null",
    }),
    status: text().notNull().default("disconnected"),
    phone: text(),
    lastError: text(),
    createdAt: integer().notNull(),
  },
  (table) => [uniqueIndex("channels_org_id").on(table.organizationId, table.id)]
)

export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    peerJid: text().notNull(),
    agentId: text().references(() => agents.id, { onDelete: "set null" }),
    agentPinned: integer({ mode: "boolean" }).notNull().default(false),
    workdir: text().notNull(),
    containerId: text(),
    status: text().notNull().default("idle"),
    createdAt: integer().notNull(),
    lastActiveAt: integer().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_channel_peer").on(table.channelId, table.peerJid),
    index("sessions_last_active").on(table.lastActiveAt),
  ]
)

export const messages = sqliteTable(
  "messages",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text().notNull(),
    kind: text().notNull(),
    text: text().notNull().default(""),
    transcript: text(),
    audioPath: text(),
    createdAt: integer().notNull(),
    audioSeconds: real(),
  },
  (table) => [
    index("messages_session_created").on(table.sessionId, table.createdAt),
  ]
)

export const runs = sqliteTable(
  "runs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: integer(),
    kind: text().notNull(),
    stages: text({ mode: "json" }).$type<unknown[]>().notNull().default([]),
    totalMs: integer(),
    startedAt: integer()
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("runs_session_started").on(table.sessionId, table.startedAt),
  ]
)
