import { describe, expect, it } from "vitest"

import { buildSystemPrompt } from "./agent-runner"
import type { AgentRecord } from "./types"

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Test agent",
    voice: true,
    tools: [],
    systemPrompt: "Help the patient.",
    goal: "",
    language: "auto",
    ttsSpeaker: "anushka",
    createdAt: 1,
    ...overrides,
  }
}

describe("buildSystemPrompt", () => {
  it("makes the latest user language override conversation history", () => {
    const prompt = buildSystemPrompt(agent())

    expect(prompt).toContain(
      "Determine the language of the latest user message independently on every turn."
    )
    expect(prompt).toContain(
      "If the user switches languages, switch immediately."
    )
    expect(prompt).toContain(
      "The latest user message\noverrides the language used earlier in the conversation."
    )
  })

  it("names the STT-detected language of the current turn", () => {
    const prompt = buildSystemPrompt(agent({ language: "ta-IN" }), "kn-IN")

    expect(prompt).toContain(
      "Speech-to-text identified the latest voice message as **Kannada** (`kn-IN`)."
    )
    expect(prompt).toContain("Reply in Kannada")
    expect(prompt).toContain("Do not carry the previous language forward.")
  })

  it("omits the detected-language block for text turns and unknown codes", () => {
    for (const code of [undefined, null, "auto", "unknown", "xx-XX"]) {
      expect(buildSystemPrompt(agent(), code)).not.toContain(
        "Speech-to-text identified"
      )
    }
  })

  it("keeps the configured objective after the platform language rule", () => {
    const prompt = buildSystemPrompt(agent({ goal: "Book an appointment." }))

    expect(prompt.indexOf("## Language for each reply")).toBeLessThan(
      prompt.indexOf("## Your objective")
    )
    expect(prompt).toContain("Book an appointment.")
  })
})
