import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm"

import { paths } from "../env"
import { sessionId as deriveSessionId } from "../routing"
import type {
  AgentRecord,
  ChannelKind,
  ChannelRecord,
  ConnectorBinding,
  MessageKind,
  SessionRecord,
} from "../types"
import { db, databaseReady } from "./client"
import {
  agents,
  channels,
  connectors,
  member,
  messages,
  sessions,
} from "./schema"

function jsonArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function jsonObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )
}

const agentRecord = (row: typeof agents.$inferSelect): AgentRecord => ({
  ...row,
  tools: jsonArray(row.tools),
})

const channelRecord = (row: typeof channels.$inferSelect): ChannelRecord => ({
  ...row,
  kind: row.kind as ChannelKind,
  status: row.status as ChannelRecord["status"],
})

const sessionRecord = (
  row: typeof sessions.$inferSelect,
  organizationId: string
): SessionRecord => ({ ...row, organizationId })

export async function isOrganizationMember(
  userId: string,
  organizationId: string
) {
  await databaseReady
  return Boolean(
    await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          eq(member.organizationId, organizationId)
        )
      )
      .get()
  )
}

export async function listAgents(
  organizationId: string
): Promise<AgentRecord[]> {
  await databaseReady
  return (
    await db
      .select()
      .from(agents)
      .where(eq(agents.organizationId, organizationId))
      .orderBy(desc(agents.createdAt))
  ).map(agentRecord)
}

export async function getAgent(
  organizationId: string,
  id: string
): Promise<AgentRecord | null> {
  await databaseReady
  const row = await db
    .select()
    .from(agents)
    .where(and(eq(agents.organizationId, organizationId), eq(agents.id, id)))
    .get()
  return row ? agentRecord(row) : null
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

async function uniqueId(
  table: "agent" | "channel",
  organizationId: string,
  name: string,
  requested?: string
) {
  const source = table === "agent" ? agents : channels
  const fallback = table
  const base = requested ?? (slugify(name) || fallback)
  let id = base
  let suffix = 2
  while (
    await db
      .select({ id: source.id })
      .from(source)
      .where(and(eq(source.organizationId, organizationId), eq(source.id, id)))
      .get()
  ) {
    id = `${base}-${suffix++}`
  }
  return id
}

export async function createAgent(
  organizationId: string,
  input: Omit<AgentRecord, "id" | "organizationId" | "createdAt"> & {
    id?: string
  }
): Promise<AgentRecord> {
  await databaseReady
  const row: typeof agents.$inferInsert = {
    ...input,
    id: await uniqueId("agent", organizationId, input.name, input.id),
    organizationId,
    createdAt: Date.now(),
  }
  await db.insert(agents).values(row)
  return agentRecord(row as typeof agents.$inferSelect)
}

export async function updateAgent(
  organizationId: string,
  id: string,
  patch: Partial<AgentRecord>
) {
  const current = await getAgent(organizationId, id)
  if (!current) return null
  const {
    id: _id,
    organizationId: _organizationId,
    createdAt: _createdAt,
    ...safe
  } = patch
  await db
    .update(agents)
    .set(safe)
    .where(and(eq(agents.organizationId, organizationId), eq(agents.id, id)))
  return getAgent(organizationId, id)
}

export async function deleteAgent(organizationId: string, id: string) {
  await db
    .delete(agents)
    .where(and(eq(agents.organizationId, organizationId), eq(agents.id, id)))
}

export async function getConnectors(
  organizationId: string,
  agentId: string
): Promise<ConnectorBinding[]> {
  const rows = await db
    .select({ binding: connectors })
    .from(connectors)
    .innerJoin(
      agents,
      and(
        eq(connectors.agentId, agents.id),
        eq(agents.organizationId, organizationId)
      )
    )
    .where(eq(connectors.agentId, agentId))
  return rows.map(({ binding }) => ({
    ...binding,
    allowedActions: jsonArray(binding.allowedActions),
    credentialEnv: jsonObject(binding.credentialEnv),
    config: jsonObject(binding.config),
  }))
}

export async function setConnectors(
  organizationId: string,
  agentId: string,
  bindings: ConnectorBinding[]
) {
  if (!(await getAgent(organizationId, agentId))) return false
  await db.transaction(async (tx) => {
    await tx.delete(connectors).where(eq(connectors.agentId, agentId))
    if (bindings.length) {
      await tx
        .insert(connectors)
        .values(bindings.map((binding) => ({ ...binding, agentId })))
    }
  })
  return true
}

export async function listChannels(
  organizationId: string
): Promise<ChannelRecord[]> {
  return (
    await db
      .select()
      .from(channels)
      .where(eq(channels.organizationId, organizationId))
      .orderBy(channels.createdAt)
  ).map(channelRecord)
}

/** Process startup only: reconnect persisted transports across every tenant. */
export async function listAllChannelsForReconnect(): Promise<ChannelRecord[]> {
  return (await db.select().from(channels).orderBy(channels.createdAt)).map(
    channelRecord
  )
}

export async function getChannel(
  organizationId: string,
  id: string
): Promise<ChannelRecord | null> {
  const row = await db
    .select()
    .from(channels)
    .where(
      and(eq(channels.organizationId, organizationId), eq(channels.id, id))
    )
    .get()
  return row ? channelRecord(row) : null
}

export async function createChannel(
  organizationId: string,
  input: {
    name: string
    kind: ChannelKind
    defaultAgentId?: string | null
    id?: string
  }
): Promise<ChannelRecord> {
  if (
    input.defaultAgentId &&
    !(await getAgent(organizationId, input.defaultAgentId))
  ) {
    throw new Error("default agent not found")
  }
  const row: typeof channels.$inferInsert = {
    id: await uniqueId("channel", organizationId, input.name, input.id),
    organizationId,
    name: input.name,
    kind: input.kind,
    defaultAgentId: input.defaultAgentId ?? null,
    status: input.kind === "playground" ? "connected" : "disconnected",
    createdAt: Date.now(),
  }
  await db.insert(channels).values(row)
  return channelRecord(row as typeof channels.$inferSelect)
}

export async function ensurePlaygroundChannel(organizationId: string) {
  const id = `playground-${organizationId}`
  const existing = await getChannel(organizationId, id)
  if (existing) return existing
  return createChannel(organizationId, {
    id,
    name: "Playground",
    kind: "playground",
  })
}

export async function updateChannel(
  organizationId: string,
  id: string,
  patch: Partial<
    Omit<ChannelRecord, "id" | "organizationId" | "kind" | "createdAt">
  >
) {
  const current = await getChannel(organizationId, id)
  if (!current) return null
  if (
    patch.defaultAgentId &&
    !(await getAgent(organizationId, patch.defaultAgentId))
  )
    return null
  await db
    .update(channels)
    .set(patch)
    .where(
      and(eq(channels.organizationId, organizationId), eq(channels.id, id))
    )
  return getChannel(organizationId, id)
}

export async function deleteChannel(organizationId: string, id: string) {
  await db
    .delete(channels)
    .where(
      and(eq(channels.organizationId, organizationId), eq(channels.id, id))
    )
}

export async function channelsUsingAgent(
  organizationId: string,
  agentId: string
) {
  const rows = await db
    .selectDistinct({ channel: channels })
    .from(channels)
    .leftJoin(sessions, eq(sessions.channelId, channels.id))
    .where(
      and(
        eq(channels.organizationId, organizationId),
        ne(channels.kind, "playground"),
        or(
          eq(channels.defaultAgentId, agentId),
          and(eq(sessions.agentId, agentId), eq(sessions.agentPinned, true))
        )
      )
    )
  return rows.map(({ channel }) => channelRecord(channel))
}

async function scopedSession(organizationId: string, id: string) {
  return db
    .select({ session: sessions })
    .from(sessions)
    .innerJoin(
      channels,
      and(
        eq(sessions.channelId, channels.id),
        eq(channels.organizationId, organizationId)
      )
    )
    .where(eq(sessions.id, id))
    .get()
}

export async function getSession(organizationId: string, id: string) {
  const row = await scopedSession(organizationId, id)
  return row ? sessionRecord(row.session, organizationId) : null
}

export async function findSession(
  organizationId: string,
  channelId: string,
  peerJid: string
) {
  const channel = await getChannel(organizationId, channelId)
  if (!channel) return null
  const row = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.channelId, channelId), eq(sessions.peerJid, peerJid))
    )
    .get()
  return row ? sessionRecord(row, organizationId) : null
}

export interface SessionSummary extends SessionRecord {
  messageCount: number
  lastMessageAt: number | null
  lastMessage: string | null
}

export async function listSessions(
  organizationId: string,
  channelId: string
): Promise<SessionSummary[]> {
  if (!(await getChannel(organizationId, channelId))) return []
  const rows = await db
    .select({
      session: sessions,
      messageCount: sql<number>`count(${messages.id})`,
      lastMessageAt: sql<number | null>`max(${messages.createdAt})`,
    })
    .from(sessions)
    .leftJoin(messages, eq(messages.sessionId, sessions.id))
    .where(eq(sessions.channelId, channelId))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.lastActiveAt))
  return Promise.all(
    rows.map(async ({ session, messageCount, lastMessageAt }) => {
      const last = await db
        .select({ text: messages.text, transcript: messages.transcript })
        .from(messages)
        .where(eq(messages.sessionId, session.id))
        .orderBy(desc(messages.id))
        .limit(1)
        .get()
      return {
        ...sessionRecord(session, organizationId),
        messageCount: Number(messageCount),
        lastMessageAt,
        lastMessage: last?.text || last?.transcript || null,
      }
    })
  )
}

export async function countSessions(organizationId: string, channelId: string) {
  if (!(await getChannel(organizationId, channelId))) return 0
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(eq(sessions.channelId, channelId))
    .get()
  return Number(row?.count ?? 0)
}

export async function ensureSessionRow(
  organizationId: string,
  channelId: string,
  peerJid: string,
  agentId: string | null,
  options: { pinned?: boolean } = {}
): Promise<{ session: SessionRecord; created: boolean }> {
  const existing = await findSession(organizationId, channelId, peerJid)
  if (existing) return { session: existing, created: false }
  if (!(await getChannel(organizationId, channelId)))
    throw new Error("channel not found")
  if (agentId && !(await getAgent(organizationId, agentId)))
    throw new Error("agent not found")
  const now = Date.now()
  const id = deriveSessionId(channelId, peerJid)
  const row: typeof sessions.$inferInsert = {
    id,
    channelId,
    peerJid,
    agentId,
    agentPinned: options.pinned ?? false,
    workdir: paths.sessionDir(id),
    status: "idle",
    createdAt: now,
    lastActiveAt: now,
  }
  await db.insert(sessions).values(row).onConflictDoNothing()
  return {
    session: (await findSession(organizationId, channelId, peerJid))!,
    created: true,
  }
}

export async function setSessionAgent(
  organizationId: string,
  id: string,
  agentId: string | null,
  pinned: boolean
) {
  if (!(await getSession(organizationId, id))) return null
  if (agentId && !(await getAgent(organizationId, agentId))) return null
  await db
    .update(sessions)
    .set({ agentId, agentPinned: pinned })
    .where(eq(sessions.id, id))
  return getSession(organizationId, id)
}

export async function touchSession(
  organizationId: string,
  id: string,
  patch: { containerId?: string | null; status?: string; agentId?: string } = {}
) {
  if (!(await getSession(organizationId, id))) return false
  await db
    .update(sessions)
    .set({ ...patch, lastActiveAt: Date.now() })
    .where(eq(sessions.id, id))
  return true
}

export async function deleteSession(organizationId: string, id: string) {
  const session = await getSession(organizationId, id)
  if (session) await db.delete(sessions).where(eq(sessions.id, id))
}

export async function playgroundSessionsFor(
  organizationId: string,
  agentId: string
) {
  const playground = await ensurePlaygroundChannel(organizationId)
  return (
    await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.channelId, playground.id),
          eq(sessions.agentId, agentId)
        )
      )
  ).map((row) => sessionRecord(row, organizationId))
}

export async function staleSessions(idleMs: number) {
  const rows = await db
    .select({ session: sessions, organizationId: channels.organizationId })
    .from(sessions)
    .innerJoin(channels, eq(sessions.channelId, channels.id))
    .where(
      and(
        sql`${sessions.containerId} is not null`,
        lt(sessions.lastActiveAt, Date.now() - idleMs)
      )
    )
  return rows.map(({ session, organizationId }) =>
    sessionRecord(session, organizationId)
  )
}

export async function insertMessage(
  organizationId: string,
  row: {
    sessionId: string
    role: "user" | "agent"
    kind: MessageKind
    text: string
    transcript?: string | null
    audioPath?: string | null
    audioSeconds?: number | null
  }
) {
  if (!(await getSession(organizationId, row.sessionId)))
    throw new Error("session not found")
  const result = await db
    .insert(messages)
    .values({ ...row, createdAt: Date.now() })
    .returning({ id: messages.id })
  return result[0].id
}

export async function messagesMissingAudioDuration(limit = 500) {
  return db
    .select({ id: messages.id, audioPath: messages.audioPath })
    .from(messages)
    .where(
      and(
        eq(messages.kind, "voice"),
        sql`${messages.audioPath} is not null`,
        sql`${messages.audioSeconds} is null`
      )
    )
    .orderBy(desc(messages.id))
    .limit(limit) as Promise<{ id: number; audioPath: string }[]>
}

export async function setMessageAudioSeconds(id: number, seconds: number) {
  await db
    .update(messages)
    .set({ audioSeconds: seconds })
    .where(eq(messages.id, id))
}

export async function patchMessage(
  id: number,
  patch: { text?: string; transcript?: string; audioPath?: string }
) {
  await db.update(messages).set(patch).where(eq(messages.id, id))
}

export async function listMessages(organizationId: string, sessionId: string) {
  if (!(await getSession(organizationId, sessionId))) return []
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.id)
}

export async function listChannelMessages(
  organizationId: string,
  channelId: string,
  opts: { search?: string; limit?: number } = {}
) {
  if (!(await getChannel(organizationId, channelId))) return []
  const limit = Math.max(1, Math.min(opts.limit ?? 2000, 5000))
  const search = opts.search?.trim()
  const condition = search
    ? and(
        eq(sessions.channelId, channelId),
        or(
          sql`${messages.text} like ${`%${search}%`}`,
          sql`${messages.transcript} like ${`%${search}%`}`
        )
      )
    : eq(sessions.channelId, channelId)
  const rows = await db
    .select({ message: messages, peerJid: sessions.peerJid })
    .from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(condition)
    .orderBy(desc(messages.id))
    .limit(limit)
  return rows.map(({ message, peerJid }) => ({ ...message, peerJid }))
}
