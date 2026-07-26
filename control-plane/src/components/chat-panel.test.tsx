// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatPanel } from "./chat-panel"
import type { ChatMessage } from "@/lib/agent-run"

/** Stand-in for MediaRecorder that lets a test drive stop/ondataavailable. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = () => true

  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType = "audio/ogg;codecs=opus"
  state = "inactive"

  constructor(
    readonly stream: { getTracks: () => { stop: () => void }[] },
    readonly options?: { mimeType?: string }
  ) {
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.state = "recording"
  }

  stop() {
    this.state = "inactive"
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: this.mimeType }),
    })
    this.onstop?.()
  }

  static get last() {
    return FakeMediaRecorder.instances.at(-1)!
  }
}

const stopTrack = vi.fn()

function stubMedia() {
  FakeMediaRecorder.instances = []
  stopTrack.mockClear()
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: stopTrack }],
      })),
    },
  })
}

describe("ChatPanel", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn()
    stubMedia()
  })

  afterEach(() => {
    // There is no vitest config enabling globals, so testing-library's
    // auto-cleanup never registers — unmount explicitly or renders accumulate.
    cleanup()
    vi.unstubAllGlobals()
  })

  it("records a real voice note and hands back a blob", async () => {
    const onSendVoice = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isBusy={false}
        onSendText={vi.fn()}
        onSendVoice={onSendVoice}
      />
    )

    await act(async () => {
      screen.getByLabelText("Record voice note").click()
    })

    // Composer is locked and a stop control replaces the mic while recording.
    const composer = screen.getByPlaceholderText<HTMLInputElement>(
      "Recording voice note…"
    )
    expect(composer.disabled).toBe(true)
    const stop = screen.getByLabelText("Stop recording and send")

    await act(async () => {
      stop.click()
    })

    expect(onSendVoice).toHaveBeenCalledTimes(1)
    const [blob, seconds] = onSendVoice.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
    expect(typeof seconds).toBe("number")
    // The mic stream must be released or the browser keeps the mic indicator lit.
    expect(stopTrack).toHaveBeenCalled()
  })

  it("prefers ogg/opus, which Saaras and WhatsApp both take natively", async () => {
    render(
      <ChatPanel
        messages={[]}
        isBusy={false}
        onSendText={vi.fn()}
        onSendVoice={vi.fn()}
      />
    )
    await act(async () => {
      screen.getByLabelText("Record voice note").click()
    })
    expect(FakeMediaRecorder.last.options?.mimeType).toBe(
      "audio/ogg;codecs=opus"
    )
  })

  it("ignores Enter on an empty draft", () => {
    const onSendText = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isBusy={false}
        voiceEnabled={false}
        onSendText={onSendText}
        onSendVoice={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText("Type a message")
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    })
    expect(onSendText).not.toHaveBeenCalled()
  })

  it("renders a transcript under a voice note and formats long durations", () => {
    const messages: ChatMessage[] = [
      {
        id: 1,
        role: "user",
        kind: "voice",
        text: "",
        transcript: "मुझे सीने में दर्द है",
        audioSeconds: 75,
        createdAt: Date.now(),
      },
    ]
    render(
      <ChatPanel
        messages={messages}
        isBusy={false}
        onSendText={vi.fn()}
        onSendVoice={vi.fn()}
      />
    )
    expect(screen.getByText("मुझे सीने में दर्द है")).toBeTruthy()
    // The old `0:SS` formatting rendered this as "0:75".
    expect(screen.getByText("1:15")).toBeTruthy()
  })

  it("shows a pipeline error to the user", () => {
    render(
      <ChatPanel
        messages={[]}
        isBusy={false}
        error="403 invalid_api_key_error"
        onSendText={vi.fn()}
        onSendVoice={vi.fn()}
      />
    )
    expect(screen.getByText("403 invalid_api_key_error")).toBeTruthy()
  })
})
