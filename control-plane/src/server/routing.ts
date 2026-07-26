/**
 * How a message finds its agent.
 *
 * Channels and agents are configured independently, so every inbound message
 * goes through two lookups: peer → session, session → agent. These are pure so
 * the rules can be tested without a database or a WhatsApp socket.
 */
import type { ChannelRecord, SessionRecord } from "./types"

export const PLAYGROUND_CHANNEL_ID = "playground"

/**
 * A session's agent.
 *
 * An unpinned session follows its channel's default, so changing the default
 * moves every conversation that nobody has overridden — including ones already
 * in flight. Pinning one in the control plane opts it out permanently.
 */
export function resolveAgentId(
  session: Pick<SessionRecord, "agentId" | "agentPinned">,
  channel: Pick<ChannelRecord, "defaultAgentId">
): string | null {
  if (session.agentPinned) return session.agentId
  return channel.defaultAgentId ?? session.agentId
}

/**
 * Session ids double as container names and directory names, so they have to
 * survive `docker run --name` and a filesystem. A WhatsApp JID
 * (`919876543210@s.whatsapp.net`) has neither property.
 */
export function sessionId(channelId: string, peerJid: string): string {
  const safe = (value: string) =>
    value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `${safe(channelId).slice(0, 40)}--${safe(peerJid).slice(0, 48)}`.toLowerCase()
}

/**
 * Playground peers are per-agent: the built-in channel has no default agent, so
 * the peer identity is what says which agent you are talking to.
 */
export function playgroundPeer(agentId: string, source = "agent"): string {
  return `${source}:${agentId}`
}

/**
 * The agent a playground peer addresses, or null for any other channel.
 *
 * Split on the *last* colon: the agent id is the suffix, and a source can
 * contain a colon itself (some pre-refactor web-chat peers do).
 */
export function agentFromPlaygroundPeer(peerJid: string): string | null {
  const at = peerJid.lastIndexOf(":")
  return at > 0 ? peerJid.slice(at + 1) || null : null
}

/** Human label for a peer in the sessions list. */
export function peerLabel(peerJid: string): string {
  if (peerJid.includes("@")) {
    const number = peerJid.split("@", 1)[0]?.split(":", 1)[0] ?? peerJid
    return /^\d+$/.test(number) ? `+${number}` : number
  }
  // A playground peer is `<source>:<agentId>`. The source is what tells two of
  // them apart — the in-app chat, the CLI, or a web-chat tab.
  const agentId = agentFromPlaygroundPeer(peerJid)
  if (agentId) return `${agentId} (${peerJid.slice(0, peerJid.lastIndexOf(":"))})`
  return peerJid
}
