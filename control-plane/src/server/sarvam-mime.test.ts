import { describe, expect, it } from "vitest"

import { sarvamMimeType } from "./sarvam"

describe("sarvamMimeType", () => {
  it("strips the codec parameter WhatsApp sends", () => {
    // Sarvam allowlists "audio/ogg" but string-matches, so the parameter form
    // was rejected with a 400 and every inbound voice note failed.
    expect(sarvamMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg")
  })

  it("strips the parameter the browser's MediaRecorder sends", () => {
    expect(sarvamMimeType("audio/ogg;codecs=opus")).toBe("audio/ogg")
    expect(sarvamMimeType("audio/webm;codecs=opus")).toBe("audio/webm")
  })

  it("leaves a bare type alone", () => {
    expect(sarvamMimeType("audio/ogg")).toBe("audio/ogg")
  })

  it("normalises case and whitespace", () => {
    expect(sarvamMimeType(" Audio/OGG ; codecs=opus")).toBe("audio/ogg")
  })

  it("defaults to ogg when the sender said nothing", () => {
    expect(sarvamMimeType(undefined)).toBe("audio/ogg")
    expect(sarvamMimeType("")).toBe("audio/ogg")
  })
})
