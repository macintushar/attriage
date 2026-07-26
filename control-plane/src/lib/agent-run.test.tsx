// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentRun } from "./agent-run"

/** Minimal EventSource stand-in we can push events through. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  static get last() {
    return FakeEventSource.instances.at(-1)!
  }
}

const RUN = {
  id: 7,
  kind: "voice" as const,
  startedAt: 1000,
  stages: [
    {
      id: "stt" as const,
      label: "Speech to text",
      service: "Sarvam Saaras v3 · STT",
      voiceOnly: true,
      status: "idle" as const,
    },
    {
      id: "agent" as const,
      label: "Agent run",
      service: "Pi · Sarvam-105B",
      voiceOnly: false,
      status: "idle" as const,
    },
  ],
}

describe("useAgentRun", () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal("EventSource", FakeEventSource)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 }))
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("builds a run from the event stream and nests agent steps", async () => {
    const { result } = renderHook(() => useAgentRun("intake"))
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1))
    const source = FakeEventSource.last

    act(() => source.emit({ type: "run_start", run: RUN }))
    expect(result.current.isBusy).toBe(true)
    expect(result.current.run?.id).toBe(7)

    act(() =>
      source.emit({
        type: "stage",
        runId: 7,
        stage: { ...RUN.stages[0], status: "done", ms: 420, detail: "hi-IN" },
      })
    )
    expect(result.current.run?.stages[0]?.status).toBe("done")
    expect(result.current.run?.stages[0]?.ms).toBe(420)

    // Tool calls land under the agent stage — that's what renders the pm commands.
    act(() =>
      source.emit({
        type: "step",
        runId: 7,
        step: {
          id: "call_1",
          tool: "bash",
          label: "pm reverse plan intake --source-table patient_intake",
          status: "running",
        },
      })
    )
    expect(result.current.run?.stages[1]?.steps).toHaveLength(1)

    // The same id must update in place rather than append a duplicate.
    act(() =>
      source.emit({
        type: "step",
        runId: 7,
        step: {
          id: "call_1",
          tool: "bash",
          label: "pm reverse plan intake --source-table patient_intake",
          status: "done",
          ms: 900,
        },
      })
    )
    expect(result.current.run?.stages[1]?.steps).toHaveLength(1)
    expect(result.current.run?.stages[1]?.steps?.[0]?.status).toBe("done")

    act(() => source.emit({ type: "run_end", runId: 7, totalMs: 5100 }))
    expect(result.current.run?.totalMs).toBe(5100)
    expect(result.current.isBusy).toBe(false)
  })

  it("back-patches a voice message with its transcript", async () => {
    const { result } = renderHook(() => useAgentRun("intake"))
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1))
    const source = FakeEventSource.last

    act(() =>
      source.emit({
        type: "message",
        message: {
          id: 1,
          role: "user",
          kind: "voice",
          text: "",
          createdAt: 1,
        },
      })
    )
    // A repeat of the same id must not duplicate the bubble.
    act(() =>
      source.emit({
        type: "message",
        message: { id: 1, role: "user", kind: "voice", text: "", createdAt: 1 },
      })
    )
    expect(result.current.messages).toHaveLength(1)

    act(() =>
      source.emit({
        type: "message_patch",
        id: 1,
        patch: { transcript: "मुझे सीने में दर्द है" },
      })
    )
    expect(result.current.messages[0]?.transcript).toBe("मुझे सीने में दर्द है")
  })

  it("surfaces errors and clears the busy flag", async () => {
    const { result } = renderHook(() => useAgentRun("intake"))
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1))
    const source = FakeEventSource.last

    act(() => source.emit({ type: "run_start", run: RUN }))
    act(() =>
      source.emit({
        type: "error",
        runId: 7,
        message: "403 invalid_api_key_error",
      })
    )

    expect(result.current.error).toBe("403 invalid_api_key_error")
    expect(result.current.isBusy).toBe(false)
  })

  it("drops a second send while a run is in flight", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useAgentRun("intake"))
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1))
    fetchMock.mockClear()

    act(() => {
      result.current.sendText("first")
      result.current.sendText("second")
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
