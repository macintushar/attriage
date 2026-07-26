# Hackathon context

## Important caveat

**Nothing in this repo names the specific hackathon this was built for.**
`HANDOFF.md`'s title says only "Sarvam Hackathon." Public web search (run
2026-07-26) turned up several Sarvam-affiliated events, but I could not
confirm which one — if any — this project targets. Everything below is
**[unconfirmed]** unless you tell me otherwise. Treat this doc as a set of
candidates and a generic judging checklist, not as the actual rules.

**If you have the real submission page, rules doc, or Devfolio/Devpost link —
paste it in and I'll replace this whole file with the confirmed version.**
That's a five-minute fix that removes all the guesswork below.

## Candidate events found

| Event | Dates | Fit | Notes |
|---|---|---|---|
| **India Agentic AI Open Hackathon** (Sarvam + NVIDIA + OpenACC + gnani.ai) | Registration closed Jun 19; online kickoff Jul 16; in-person Bangalore **Jul 24–25, 2026** | Dates line up almost exactly with `HANDOFF.md`'s last-updated timestamp (2026-07-25) and today (2026-07-26) | [unconfirmed] Publicly described as mandating **NVIDIA's** agentic AI stack for enterprise multi-agent automation — this repo shows no NVIDIA integration, which is either a mismatch or an area this project doesn't need to touch. Prize: chance at a DGX Spark. |
| **Sarvam Epoch** (Builder Edition) | Jul 30, 2026 | Later than the repo's current state, invite-only | [unconfirmed] Reads as more of a summit/showcase than a submission-judged hackathon — thin public info. |
| **Warpspeed: Agentic AI Hackathon** (Lightspeed + Sarvam) | Jun 21–22, **2025** | Already happened, a year before this repo's commits | Almost certainly not this one, given the date mismatch — included for context on what a Sarvam-partnered hackathon typically looks like. |
| **Sarvam Virtual Buildathon** ("Build What Matters") | Unconfirmed dates | Generic 36-hour online hackathon, Sarvam-run | [unconfirmed] No date/theme match found. |

None of these is confirmed. **Do not repeat the NVIDIA-stack requirement, the
DGX Spark prize, or any specific judging rubric to teammates or judges as
fact** until you've checked the actual event page.

## What to verify right now

1. The exact event name and its official rules/submission page.
2. Whether there's a **mandatory sponsor-tech requirement** (e.g., "must use
   the NVIDIA agentic AI stack") — if the India Agentic AI Open Hackathon
   candidate above is correct, this project's Sarvam-only stack may need an
   NVIDIA touchpoint added, or an explicit note on why it's out of scope.
2. Submission deadline and format (repo link only? demo video required? live
   demo slot?).
3. Judging criteria weighting, if published.
4. Any theme constraint beyond "agentic AI" — several of these events use
   that exact phrase, and this project fits it well regardless of which one
   it is.

## Generic judging rubric (applies across nearly every AI/agentic hackathon)

Even without the confirmed rules, these dimensions show up in essentially
every hackathon judging rubric I found in this research pass (CXC, SmartEarth,
Smallest AI, OpenAI Build Week, DevNetwork), so they're a safe default to
prepare against:

| Dimension | What judges are actually checking | Where this project stands |
|---|---|---|
| **Technical execution** | Does it actually run, end-to-end, live? | Blocked on `SARVAM_API_KEY` — see [03-status-and-gotchas.md](03-status-and-gotchas.md). This is the single biggest risk to this score. |
| **Innovation / novelty** | Is this a template with a new skin, or a genuinely different approach? | Strong: general-purpose "agent is a database row" architecture + free-form voice conversation instead of a menu bot is a real differentiator (see [05-competitive-landscape.md](05-competitive-landscape.md)). |
| **Real-world impact / usefulness** | Would a real business actually use this? | Strong, if the pitch leads with the platform (any WhatsApp business agent) and uses healthcare as the proof point, not the whole story. |
| **Use of sponsor technology** | Did you actually use Sarvam (or the mandated stack) meaningfully, not superficially? | Very strong for Sarvam specifically — every model in the pipeline (`sarvam-105b`, `saaras:v3`, `bulbul:v3`) is Sarvam's. Weak/unknown for NVIDIA if that turns out to be required. |
| **Presentation / demo quality** | Can the team show it working, clearly, in the time slot? | Needs rehearsal — see [06-pitch-and-demo-strategy.md](06-pitch-and-demo-strategy.md) for a concrete script and a fallback path (playground, no WhatsApp) if live messaging is flaky on venue wifi. |
| **Completeness / polish** | Does it feel shipped, or held together with duct tape? | Currently undermined by the missing `control-plane/` source in the public repo — fix that first (see 03). |

## Recommendation

Don't build further hackathon-specific content (judging weightings, sponsor
requirements, submission format) into this knowledge base until the actual
event is confirmed — it would just be guessing dressed up as research. Once
you paste the real link, this file gets replaced with something you can
actually rely on.
