import { describe, expect, it } from "vitest"

import {
  agentFromPlaygroundPeer,
  peerLabel,
  peerPhone,
  playgroundPeer,
  resolveAgentId,
  sessionId,
} from "./routing"

const session = (agentId: string | null, agentPinned: boolean) => ({
  agentId,
  agentPinned,
})

describe("resolveAgentId", () => {
  it("hands an unpinned session to the channel's current default", () => {
    expect(
      resolveAgentId(session("old-agent", false), {
        defaultAgentId: "new-agent",
      })
    ).toBe("new-agent")
  })

  it("keeps a pinned session on its agent when the default moves", () => {
    expect(
      resolveAgentId(session("vip-agent", true), { defaultAgentId: "new-agent" })
    ).toBe("vip-agent")
  })

  it("falls back to the session's agent when the channel has no default", () => {
    // The default can be cleared — by hand, or by deleting the agent it named.
    // A conversation already in progress should not go silent because of it.
    expect(
      resolveAgentId(session("agent-a", false), { defaultAgentId: null })
    ).toBe("agent-a")
  })

  it("reports no agent when a pinned session's agent was deleted", () => {
    expect(
      resolveAgentId(session(null, true), { defaultAgentId: "new-agent" })
    ).toBeNull()
  })
})

describe("sessionId", () => {
  it("survives use as a container name and a directory name", () => {
    const id = sessionId("hospital-whatsapp", "919876543210@s.whatsapp.net")
    expect(id).toBe("hospital-whatsapp--919876543210-s-whatsapp-net")
    expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps two peers on one channel apart", () => {
    expect(sessionId("wa", "1@s.whatsapp.net")).not.toBe(
      sessionId("wa", "2@s.whatsapp.net")
    )
  })

  it("keeps the same peer on two channels apart", () => {
    expect(sessionId("wa-a", "1@s.whatsapp.net")).not.toBe(
      sessionId("wa-b", "1@s.whatsapp.net")
    )
  })
})

describe("playground peers", () => {
  it("round-trips the agent it addresses", () => {
    const peer = playgroundPeer("patient-intake")
    expect(peer).toBe("agent:patient-intake")
    expect(agentFromPlaygroundPeer(peer)).toBe("patient-intake")
  })

  it("separates the CLI from the in-app playground", () => {
    expect(playgroundPeer("a", "cli")).not.toBe(playgroundPeer("a"))
  })

  it("reads the agent from a source that contains a colon", () => {
    // Some pre-refactor web-chat peers look like this once migrated.
    expect(agentFromPlaygroundPeer("agent-x:NTQ2QGxpZA:patient-intake")).toBe(
      "patient-intake"
    )
  })
})

describe("peerLabel", () => {
  it("renders a WhatsApp JID as a phone number", () => {
    expect(peerLabel("919876543210@s.whatsapp.net")).toBe("+919876543210")
  })

  it("names a playground peer by its agent and source", () => {
    expect(peerLabel("agent:patient-intake")).toBe("patient-intake (agent)")
    expect(peerLabel("wc2:patient-intake")).toBe("patient-intake (wc2)")
  })

  it("leaves a peer it doesn't recognise alone", () => {
    expect(peerLabel("something-else")).toBe("something-else")
  })
})

describe("peer identity from a wrapped adapter id", () => {
  const wrap = (jid: string) =>
    `channel-hospital-intake:${Buffer.from(jid).toString("base64")}`

  it("recovers a phone number from the adapter's base64 peer id", () => {
    expect(peerPhone(wrap("919845012345@s.whatsapp.net"))).toBe("+919845012345")
    expect(peerLabel(wrap("919845012345@s.whatsapp.net"))).toBe("+919845012345")
  })

  it("refuses to turn a @lid into a phone number", () => {
    // A LID is WhatsApp's privacy identifier. It is all digits and it is not
    // dialable; treating it as a number would write a dead contact to a record.
    expect(peerPhone(wrap("54623528321265@lid"))).toBeNull()
    expect(peerLabel(wrap("54623528321265@lid"))).toBe(
      "54623528321265 (WhatsApp id)"
    )
  })

  it("leaves playground peers and undecodable ids alone", () => {
    expect(peerPhone("cli:patient-intake")).toBeNull()
    expect(peerLabel("cli:patient-intake")).toBe("patient-intake (cli)")
    expect(peerPhone("wa:not-base64!!")).toBeNull()
  })
})
