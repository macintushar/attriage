/**
 * Finds the request size at which Sarvam's gateway starts refusing.
 *
 *   node --env-file=../.env --import tsx scripts/probe-context-limit.ts
 *
 * Written because a live session died with a bare `403 Forbidden` from
 * `Microsoft-Azure-Application-Gateway` at ~45.6k input tokens, well under the
 * 128k context window the model advertises. Compaction keys off the declared
 * window, so the declared window has to reflect what the gateway will actually
 * accept — and that is a number worth measuring rather than guessing.
 *
 * Binary search on filler size. One request per step, `max_tokens: 1`.
 */
export {}

const KEY = process.env.SARVAM_API_KEY
if (!KEY) throw new Error("SARVAM_API_KEY is not set")

const MODEL = process.env.AGENT_MODEL ?? "sarvam-105b"

/** Roughly one token per word for this filler, which is all we need here. */
const filler = (tokens: number) => "hospital appointment record ".repeat(tokens / 3)

async function attempt(tokens: number): Promise<{ ok: boolean; status: number; note: string }> {
  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-subscription-key": KEY!,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1,
      messages: [
        { role: "user", content: `Ignore this text: ${filler(tokens)}\n\nSay OK.` },
      ],
    }),
  })
  const body = await res.text()
  const note = body.includes("Application-Gateway")
    ? "gateway 403 (request rejected before the model)"
    : body.slice(0, 120).replace(/\s+/g, " ")
  return { ok: res.ok, status: res.status, note }
}

let low = 0 // known good
let high = 120_000 // assumed bad
const seen: string[] = []

// Confirm the bracket before searching, so a total outage is not misread as a
// tiny limit.
const base = await attempt(1_000)
console.log(`  1k tokens → ${base.status} ${base.ok ? "ok" : base.note}`)
if (!base.ok) throw new Error("even a 1k-token request failed — this is not a size limit")

const ceiling = await attempt(high)
console.log(
  `  ${high / 1000}k tokens → ${ceiling.status} ${ceiling.ok ? "ok" : ceiling.note}`
)
if (ceiling.ok) {
  console.log("\nno ceiling below 120k — the 403 was not request size")
  process.exit(0)
}

while (high - low > 2_000) {
  const mid = Math.round((low + high) / 2 / 1000) * 1000
  const r = await attempt(mid)
  seen.push(`${mid / 1000}k → ${r.status}`)
  console.log(`  ${mid / 1000}k tokens → ${r.status} ${r.ok ? "ok" : r.note}`)
  if (r.ok) low = mid
  else high = mid
}

console.log(`\nlargest accepted: ~${low / 1000}k tokens · first refused: ~${high / 1000}k`)
console.log(`suggested contextWindow: ${Math.floor((low * 0.8) / 1000) * 1000} (20% margin)`)
