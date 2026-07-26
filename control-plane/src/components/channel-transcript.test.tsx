// @vitest-environment jsdom
import type { ReactNode } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChannelTranscript } from "./channel-transcript"
import type { ChannelTranscript as Transcript } from "@/lib/channels-store"

// The transcript links out to a session page. Standing up a real router is more
// machinery than this component's behaviour needs, so Link becomes an anchor.
// `vi.mock` is hoisted above the imports above, so this still takes effect.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <a className={className}>{children}</a>,
}))

const HOUR = 3_600_000

const intake = {
  id: "hospital--919876500001",
  peerJid: "919876500001@s.whatsapp.net",
  peerLabel: "+919876500001",
  agentId: "patient-intake",
  agentName: "Patient intake",
  lastActiveAt: Date.now() - HOUR,
  messageCount: 2,
  messages: [
    {
      id: 11,
      role: "user" as const,
      kind: "text" as const,
      text: "I need an appointment on Tuesday",
      createdAt: Date.now() - HOUR,
    },
    {
      id: 12,
      role: "agent" as const,
      kind: "text" as const,
      text: "Booked you for 3pm Tuesday.",
      createdAt: Date.now() - HOUR + 1000,
    },
  ],
}

const followUp = {
  id: "hospital--919876500002",
  peerJid: "919876500002@s.whatsapp.net",
  peerLabel: "+919876500002",
  agentId: "patient-intake",
  agentName: "Patient intake",
  lastActiveAt: Date.now() - 6 * HOUR,
  messageCount: 1,
  messages: [
    {
      id: 21,
      role: "user" as const,
      kind: "voice" as const,
      text: "",
      transcript: "my knee still hurts after the surgery",
      audioUrl: "/api/media/hospital--919876500002/in-21.ogg",
      createdAt: Date.now() - 6 * HOUR,
    },
  ],
}

/** Serves whatever the current test decided a given request URL should return. */
let route: (url: string) => Transcript
const requested: string[] = []

function stubFetch() {
  requested.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input)
      requested.push(url)
      return new Response(JSON.stringify(route(url)), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
  )
}

describe("ChannelTranscript", () => {
  beforeEach(() => {
    route = () => ({
      sessions: [intake, followUp],
      totalMessages: 3,
      truncated: false,
    })
    stubFetch()
  })

  afterEach(cleanup)

  it("groups messages by conversation, newest active first", async () => {
    render(<ChannelTranscript channelId="hospital" />)

    await screen.findByText("+919876500001")

    const headings = screen
      .getAllByRole("button", { expanded: true })
      .map((section) => within(section).getByText(/^\+91/).textContent)
    expect(headings).toEqual(["+919876500001", "+919876500002"])

    // Each conversation carries its own messages, not one merged stream.
    expect(screen.getByText("I need an appointment on Tuesday")).toBeDefined()
    expect(screen.getByText("Booked you for 3pm Tuesday.")).toBeDefined()
    expect(screen.getByText("3 messages across 2 conversations")).toBeDefined()
  })

  it("filters to matching messages and hides conversations with none", async () => {
    render(<ChannelTranscript channelId="hospital" />)
    await screen.findByText("+919876500001")

    route = () => ({
      sessions: [{ ...followUp, messages: followUp.messages }],
      totalMessages: 1,
      truncated: false,
    })

    fireEvent.change(screen.getByLabelText("Search transcript"), {
      target: { value: "knee" },
    })

    await waitFor(() => {
      expect(screen.queryByText("+919876500001")).toBeNull()
    })
    expect(screen.getByText("+919876500002")).toBeDefined()
    expect(requested.at(-1)).toContain("q=knee")
    expect(
      screen.getByText("1 matching message across 1 conversation")
    ).toBeDefined()
  })

  it("renders a voice note transcript in a past conversation", async () => {
    render(<ChannelTranscript channelId="hospital" />)

    expect(
      await screen.findByText("my knee still hurts after the surgery")
    ).toBeDefined()
    expect(
      screen.getByRole("button", { name: "Play voice note" })
    ).toBeDefined()
  })

  it("says so when a channel has no conversations yet", async () => {
    route = () => ({ sessions: [], totalMessages: 0, truncated: false })
    render(<ChannelTranscript channelId="hospital" />)

    expect(await screen.findByText("No conversations yet")).toBeDefined()
    expect(screen.queryByRole("textbox")).not.toBeNull()
  })

  it("collapses a conversation when its header is clicked", async () => {
    render(<ChannelTranscript channelId="hospital" />)
    await screen.findByText("+919876500001")

    fireEvent.click(screen.getAllByRole("button", { expanded: true })[0])

    await waitFor(() => {
      expect(screen.queryByText("I need an appointment on Tuesday")).toBeNull()
    })
    // The other conversation is untouched.
    expect(
      screen.getByText("my knee still hurts after the surgery")
    ).toBeDefined()
  })
})
