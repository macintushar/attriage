import { describe, expect, it } from "vitest"

import { speakableText } from "./sarvam"

describe("speakableText", () => {
  it("strips the emphasis a model reaches for on important details", () => {
    // The real confirmation the agent produced during an end-to-end run.
    const reply = speakableText(
      "**Dr. Vikram Iyer** - Cardiology\n**Time:** 10:00 AM\n**Location:** Room B-204"
    )

    expect(reply).not.toContain("*")
    expect(reply).toContain("Dr. Vikram Iyer - Cardiology")
    expect(reply).toContain("Time: 10:00 AM")
  })

  it("keeps bold-italic and single-asterisk emphasis readable", () => {
    expect(speakableText("***urgent***")).toBe("urgent")
    expect(speakableText("that is *very* important")).toBe(
      "that is very important"
    )
  })

  it("leaves a lone asterisk and mid-word asterisks alone", () => {
    expect(speakableText("2 * 3 = 6")).toBe("2 * 3 = 6")
  })

  it("removes list, heading and quote markers that would be read aloud", () => {
    const reply = speakableText(
      "## Appointment\n\n- Bring your reports\n- Arrive early\n\n> Please be on time"
    )

    expect(reply).toContain("Appointment")
    expect(reply).toContain("Bring your reports")
    expect(reply).not.toMatch(/^[->#]/m)
  })

  it("keeps numbered steps, which are spoken naturally", () => {
    expect(speakableText("1. Register\n2. Pay")).toBe("1. Register\n2. Pay")
  })

  it("speaks a link's label rather than its URL", () => {
    expect(speakableText("See [the map](https://hospital.example/map/x?y=1)")).toBe(
      "See the map"
    )
  })

  it("unwraps code spans, since an id may legitimately appear in one", () => {
    expect(speakableText("Your id is `apt-0115ea`")).toBe(
      "Your id is apt-0115ea"
    )
  })

  it("leaves ordinary Indic and mixed-language text untouched", () => {
    const reply = "नमस्ते रवि, आपका appointment कल सुबह 10 बजे है।"
    expect(speakableText(reply)).toBe(reply)
  })
})
