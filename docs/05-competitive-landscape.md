# Competitive landscape

Research pass run 2026-07-26. Scope: existing WhatsApp healthcare bots (what
this project would replace), the reverse-ETL/agent-tooling space this project
is built on top of, and the broader Sarvam-hackathon field it's likely
competing in. Treat the market-sizing and vendor claims here as directional,
sourced from vendor marketing pages — not independently verified.

## Existing WhatsApp healthcare bots: mostly menu trees, not conversation

Every vendor found in this space (Botsense, Orai Robotics, ColorWhistle,
HelloTars, WACTO, SwiftSell AI, Fril Softwares, Quad One, respond.io) follows
the same pattern: **present a menu, collect a structured selection, confirm.**
Typical flow: pick a department → pick a doctor → pick a time slot from a
list → automated confirmation + a 24-hour-before reminder. Botsense's
positioning is representative: REST APIs and webhooks into specific Indian
HMS/LIMS platforms (Practo, HealthPlix, Aarogya) with the booking flow
completing "in under 2 minutes."

**What that architecture can't do that this project's can:**

- Take an unstructured, out-of-order message like *"hi my mother is 68, she
  has chest pain since morning, we are in Chennai"* and extract name-less
  patient, age, symptom, onset, and location without forcing the user through
  a menu that ignores what they already said. (This exact example is the
  worked case in `sandbox/skills/talking-to-people.md`.)
- Hold the conversation in **mixed Hindi-English or Tamil-English**, mirroring
  the user's register (formal vs. casual, short vs. anxious-and-long) rather
  than routing to a fixed-language flow.
- Handle a genuinely open-ended request that doesn't fit the menu — the agent
  reasons about which of its configured connector actions applies, rather
  than the user being limited to what's on the menu.
- Detect and escalate an emergency ("chest pain now", "trouble breathing")
  *before* continuing the booking flow, as an explicit conversational rule
  rather than a keyword-triggered branch.

**What the menu-bot vendors have that this project doesn't (yet), and it's
worth being honest about this in Q&A:** years of production hardening,
existing HMS integration partnerships, and a UX that's *predictable* — a menu
never misunderstands you. The pitch for this project isn't "menus are wrong,"
it's "menus are a ceiling on what the interaction can be, and this removes
the ceiling while staying bounded by an allowlist and a confirm-before-write
rule."

## The reverse-ETL space `pm`/Polymetrics sits in

Established reverse-ETL vendors (Hightouch, Census, Polytomic, and others
listed in vendor comparison articles from Domo, Improvado, Boomi, Skyvia) all
target the same job: sync a data warehouse *out* to operational tools (CRM,
ad platforms, support desks). They're built for **scheduled, batch** syncs
driven by a data team, not for a single LLM agent staging one record at a
time mid-conversation and immediately executing a plan/preview/run cycle.

That's the actual differentiator worth naming: this project uses reverse-ETL
machinery (`plan → preview → run --approve`) as an **agent-safety primitive**
— a structural checkpoint between "the model decided something" and "an
external system changed" — not as a data-team batch tool. Framing it as
"reverse ETL, but the trigger is a conversation, not a cron job" is a clean
one-liner for judges who already know what reverse ETL is.

Public information specifically on `polymetrics.ai`/`polymetrics-ai/cli` is
thin (per `sandbox/README.md`, it has no published releases, no DNS A record
on its module path, and the sandbox build clones and compiles from source) —
this looks like an early-stage or internal tool rather than an established
product with its own public market position. That's worth knowing:
**Polymetrics isn't a widely-recognized brand a judge is likely to already
have an opinion about**, so it needs a one-sentence explanation in the pitch
rather than being name-dropped as if it's self-evident (see
[06-pitch-and-demo-strategy.md](06-pitch-and-demo-strategy.md)).

## The agent harness: Pi

`@earendil-works/pi-coding-agent` (the underlying `pi` package has ~46K
GitHub stars) is a general-purpose, open-source coding-agent harness —
read/bash/edit/write tools, session management, a unified multi-provider LLM
API, extensible via TypeScript extensions and "skills." It's built for coding
agents, not conversational customer-facing bots — this project is repurposing
a dev-tool harness as the runtime for a patient-facing WhatsApp conversation,
driving `pm` over `bash` instead of driving a codebase. That repurposing is
itself worth stating plainly: it's an unusual, credible-if-it-works choice
(a real, battle-tested agent loop instead of a bespoke one), and it's also
why `sandbox/README.md` notes "Pi has no sandbox API and no MCP" — the
per-session Docker isolation had to be built for this project specifically,
it isn't something Pi provided.

## Other Sarvam-ecosystem activity (context, not direct competitors)

- **Sarvam Samvaad** — Sarvam's own commercial "Conversational AI Platform,"
  launched with WhatsApp support via Meta's Business Calling API, no-code
  agent building, 11 Indian languages. This is close in spirit to what this
  project builds (voice+text WhatsApp agents in Indian languages) but aimed
  at a **no-code enterprise builder** audience rather than an
  agent-drives-arbitrary-backend-writes architecture. Worth knowing so you
  don't get asked "isn't this just Samvaad?" without an answer ready: the
  honest answer is that this project trades Samvaad's no-code simplicity for
  a general-purpose coding-agent loop that can reason about and execute
  *arbitrary* connector actions, not a fixed set of no-code building blocks.
- **Warpspeed 2025** (Lightspeed + Sarvam) winners built "voice-led and
  multilingual AI Agents" over 24 hours using the Sarvam Stack — the same
  stack this project uses, one hackathon cycle earlier. If judges or
  organizers overlap with that event, they've already seen Sarvam-stack voice
  agents; the connector-driven backend-write architecture (vs. a single-shot
  voice demo) is the angle that differentiates this from "another Sarvam
  voice bot."

## Bottom line for positioning

Three things to lead with, because they're specific and defensible rather
than generic hackathon claims:

1. **The backend is genuinely healthcare-agnostic** — an agent is a database
   row (prompt + connector config), not a fork of the codebase. Most
   hackathon healthcare bots are healthcare-specific top to bottom.
2. **Writes go through a real approval gate** (`plan → preview → run
   --approve`), not a direct API call the model makes unsupervised — even
   though the current build has the agent approve its own token (see
   [02-architecture.md](02-architecture.md)), the *structure* for a real human
   gate already exists and is one code change away.
3. **It's a full voice-in/voice-out multilingual loop on Sarvam's own stack**,
   not a text-only demo with TTS bolted on for the pitch.
