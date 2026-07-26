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
/**
 * The chat adapter hands us `<adapterName>:<base64 of the real JID>`, so the
 * JID is not readable until it is unwrapped. Everything downstream — the label
 * in a trace, the phone number the agent is told — depends on getting the real
 * one back, and a peer that stayed wrapped silently looked like a playground
 * peer instead of a person.
 */
export function decodePeerJid(peerJid: string): string {
  if (peerJid.includes("@")) return peerJid
  const encoded = peerJid.slice(peerJid.indexOf(":") + 1)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return peerJid
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8")
    return decoded.includes("@") ? decoded : peerJid
  } catch {
    return peerJid
  }
}

/**
 * The peer's phone number, or null when we genuinely do not have one.
 *
 * Null is the important case. WhatsApp increasingly identifies people by a
 * `@lid` — a privacy identifier that is *not* a phone number and cannot be
 * turned into one here. Returning a best guess would put a number that reaches
 * nobody onto a patient's record, so a caller that cannot be identified has to
 * be reported as exactly that.
 */
export function peerPhone(peerJid: string): string | null {
  const jid = decodePeerJid(peerJid)
  if (!jid.endsWith("@s.whatsapp.net")) return null
  const number = jid.split("@", 1)[0]?.split(":", 1)[0] ?? ""
  return /^\d{7,15}$/.test(number) ? `+${number}` : null
}

/**
 * A stable contact key for this peer, for the hospital record.
 *
 * A phone number when the platform gives one, otherwise `wa:<lid>` — which is
 * not dialable but *is* how you reach this person, since it is the identity
 * they are messaging from. The point is that it always comes from the channel:
 * the alternative is asking the model, which answers with a fake number when it
 * does not know.
 */
export function patientContact(peerJid: string): string {
  const phone = peerPhone(peerJid)
  if (phone) return phone
  const jid = decodePeerJid(peerJid)
  if (jid.endsWith("@lid")) return `wa:${jid.slice(0, -"@lid".length)}`
  return `peer:${jid.replace(/[^A-Za-z0-9:_-]/g, "-")}`
}

export function peerLabel(peerJid: string): string {
  peerJid = decodePeerJid(peerJid)
  // A `@lid` is digits, but it is not a phone number. Formatting it as `+…`
  // would put something that looks dialable in front of whoever is reading the
  // session list, so say what it actually is.
  if (peerJid.endsWith("@lid")) {
    return `${peerJid.slice(0, -"@lid".length)} (WhatsApp id)`
  }
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
