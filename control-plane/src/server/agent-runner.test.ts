import { describe, expect, it } from "vitest"

import { createPerseverationGuard } from "./agent-runner"

describe("createPerseverationGuard", () => {
  it("aborts with 'repeat' after N identical consecutive failures", () => {
    const guard = createPerseverationGuard(3)
    const args = { command: "cat .polymetrics/config.yaml" }
    guard.start("a", "bash", args)
    expect(guard.end("a", true)).toBeNull()
    guard.start("b", "bash", args)
    expect(guard.end("b", true)).toBeNull()
    guard.start("c", "bash", args)
    expect(guard.end("c", true)).toBe("repeat")
  })

  it("clears a command's failure count when that same command succeeds", () => {
    const guard = createPerseverationGuard(3, 10)
    const args = { command: "pm connectors list" }
    guard.start("a", "bash", args)
    expect(guard.end("a", true)).toBeNull()
    guard.start("b", "bash", args)
    expect(guard.end("b", true)).toBeNull()
    guard.start("ok", "bash", args)
    expect(guard.end("ok", false)).toBeNull()
    guard.start("c", "bash", args)
    expect(guard.end("c", true)).toBeNull()
  })

  it("a different command's success does not reset a failing command's count", () => {
    // The observed plan-ok/run-fail alternation: re-planning succeeds every
    // time, the run keeps failing with fresh plan ids and tokens. The
    // normalizer folds those ids away, so the third failing run still trips.
    const guard = createPerseverationGuard(3, 10)
    for (let i = 0; i < 3; i++) {
      guard.start(`plan${i}`, "bash", { command: "pm reverse plan x" })
      expect(guard.end(`plan${i}`, false)).toBeNull()
      guard.start(`run${i}`, "bash", {
        command: `pm reverse run rplan_${i}f414ea4c7d9067a --approve ${i}34a0d67c4ac0ed61ab63825fe62d6cd8b77`,
      })
      const verdict = guard.end(`run${i}`, true)
      if (i < 2) expect(verdict).toBeNull()
      else expect(verdict).toBe("repeat")
    }
  })

  it("aborts with 'flail' after M distinct consecutive failures", () => {
    const guard = createPerseverationGuard(3, 4)
    for (const [i, cmd] of ["one", "two", "three"].entries()) {
      guard.start(String(i), "bash", { command: `cat ${cmd}` })
      expect(guard.end(String(i), true)).toBeNull()
    }
    guard.start("last", "bash", { command: "cat four" })
    expect(guard.end("last", true)).toBe("flail")
  })

  it("distinguishes tools with identical arguments", () => {
    const guard = createPerseverationGuard(2)
    guard.start("a", "read", { path: "/x" })
    expect(guard.end("a", true)).toBeNull()
    guard.start("b", "ls", { path: "/x" })
    expect(guard.end("b", true)).toBeNull()
  })

  it("ignores ends for unknown call ids", () => {
    const guard = createPerseverationGuard(1, 1)
    expect(guard.end("never-started", true)).toBeNull()
  })
})
