# Pitch and demo strategy

## The narrative, in three sentences

"We built a WhatsApp agent **platform**, not a healthcare bot — an agent is a
system prompt plus a set of connectors, so the same backend that does patient
intake in Hindi, English, and Tamil could just as easily run appointment
booking for a salon or lead qualification for a real-estate agency. We picked
patient intake as the proof point because it stresses every hard part at
once: multilingual voice, urgency detection, and irreversible real-world
writes. And every write goes through a real plan-preview-run gate, not a
model calling an API unsupervised."

Lead with the **platform**, prove it with **healthcare**. Judges have seen a
lot of single-purpose healthcare bots; "this generalizes" is the sentence that
makes them lean in.

## Before you're allowed to demo: the two blockers

Everything else in this doc is wasted effort until these two are closed —
they're not polish, they're pass/fail:

1. **Missing `control-plane/` source in the public repo.** See
   [03-status-and-gotchas.md](03-status-and-gotchas.md#-fix-this-before-anyone-else-clones-the-repo).
   If a judge clones the repo to look at code and finds an empty folder where
   the entire application lives, that's an unrecoverable first impression —
   fix it before anything else on this list.
2. **`SARVAM_API_KEY` unset**, so the agent leg has never run end-to-end.
   `cd control-plane && bun run try-turn patient-intake "hi"` is the single
   command that proves or disproves the whole pitch. Run it — today, not
   backstage — and fix whatever `compat` flag issue it surfaces (candidates
   already identified: `supportsUsageInStreaming: false`,
   `maxTokensField: "max_tokens"`, `requiresToolResultName`).

## Demo script (assuming both blockers are closed)

Aim for **under 4 minutes** of live demo inside whatever slot you get —
judges reward tight, confident, and something-goes-slightly-wrong-but-you-
recover over a long, flawless, over-rehearsed run.

1. **(30s) Set up the platform claim before showing anything.** Show the
   agent list / wizard for a few seconds — "each of these rows is a complete
   agent: prompt, connectors, its own WhatsApp number." Don't dwell.
2. **(90s) Live WhatsApp voice note.** Send a real voice note as a worried
   relative, in mixed Hindi-English if you can pull it off naturally: *"hi
   mera mom ko chest pain hai since morning, hum Chennai mein hain."* Let the
   agent respond — ideally by voice — acknowledging what it heard, asking
   only for the missing piece, and flagging urgency if it triggers that path.
3. **(60s) Show the trace, not just the chat.** Open the playground trace for
   that same turn and point at the nested `pm` commands — `pm reverse plan`,
   `pm reverse preview`, `pm reverse run --approve <token>`. This is the
   moment that proves "there's a real gated write happening," not a
   hallucinated confirmation. This is your strongest, most differentiated
   visual — don't rush it.
4. **(30s) Close the loop.** Show the confirmation message arriving back on
   WhatsApp with a specific, real detail (doctor name, time) that came from
   `pm reverse run`'s actual output, not an invented one — and say so
   explicitly: "the agent is instructed to never state a detail it didn't
   read from a tool result."
5. **(30s) Land the platform point again.** "Swap the prompt and the
   connector, and this is a different business tomorrow — nothing here is
   healthcare-specific."

### Fallback if WhatsApp/venue wifi is flaky

The playground drives the **identical** `runPipeline` with no WhatsApp
involved (per `README.md` — this was deliberately architected, not
improvised). If live WhatsApp messaging is unreliable on venue network,
switch to the playground without apologizing — it's the same pipeline, and
saying so once ("this is the exact same code path WhatsApp uses") turns a
downgrade into a non-issue.

## Questions judges are likely to ask, and the honest answer to have ready

Prepare these *before* you're asked — a fast, specific, honest answer reads
as far more credible than a smooth one that dodges:

**"Why does an LLM agent get to run bash commands against real systems? Isn't
that dangerous?"**
Point at the sandbox: non-root, read-only root filesystem, all Linux
capabilities dropped, no Docker socket mounted, per-session isolation, memory
and process-count limits. Then name the one gap honestly: network egress is
open, because the agent needs to reach Sarvam and connector APIs, and an
egress-allowlist proxy is the documented-but-not-yet-built next step. Don't
claim it's fully locked down — the docs don't, and neither should you.

**"Can the agent approve its own writes? Isn't that the exact thing the
reverse-ETL tool tried to prevent?"**
Yes, and say so directly — `pm` redacts the approval token from `--json`
output specifically to prevent this, and this build reads it from
human-readable stdout anyway. The honest framing: autonomous booking is the
product, so this was a deliberate tradeoff, bounded by a per-agent action
allowlist and a "confirm before irreversible write" prompt rule — and the
architecture already has the right insertion point (the backend holding the
token instead of the agent) if a real human gate is required. Having thought
about this and made a call beats not having noticed it.

**"What happens if the AI mishears or hallucinates a detail — like the wrong
appointment time?"**
Two real, load-bearing rules from `sandbox/skills/pm-workflow.md`, not
hand-waving: the agent is instructed to never state a confirmation detail it
didn't read from actual tool output, and to say "I couldn't complete that"
rather than invent a plausible-sounding result. If you can, demo this by
intentionally forcing a failure path (e.g. an unreachable connector) and
showing the agent decline to fabricate an answer.

**"How is this different from [existing WhatsApp healthcare bot /
Sarvam Samvaad]?"** — see
[05-competitive-landscape.md](05-competitive-landscape.md) for the full
comparison. Short version: menu bots can't hold the kind of conversation this
does; Samvaad is a no-code builder for a fixed set of blocks, this is a
general coding-agent loop that can reason about and execute arbitrary
connector actions.

**"Does this only work for healthcare?"**
No — and prove it if you have time: mention (or better, show) that adding a
new vertical is a config change (new prompt + connector config in the
wizard), not a code change. This is the platform's actual thesis; don't let
it stay abstract if you can make it concrete.

**"What's not done yet?"**
Answer plainly from [03-status-and-gotchas.md](03-status-and-gotchas.md) —
the human-approval-gate hardening, the egress allowlist, and (until you close
it) the live Sarvam key. Listing real gaps confidently reads better than
implying there are none and getting caught.

## What to avoid saying

- Don't claim the approval-token self-approval issue "isn't a real concern" —
  it's real, it's documented by `pm`'s own maintainers as something they
  built a control against. Own it instead.
- Don't imply Polymetrics/`pm` is an established, widely-used product — it
  isn't (see [05-competitive-landscape.md](05-competitive-landscape.md)); it's
  a fine-grained, deliberate architectural choice, and it holds up fine
  described honestly as one.
- Don't promise the NVIDIA-stack requirement is met if you haven't confirmed
  whether it applies — see [04-hackathon-context.md](04-hackathon-context.md).
  If it turns out to be mandatory and unmet, address it directly rather than
  glossing over it.

## One-line answers, for when time is short

- **What is it?** "A platform where a WhatsApp agent is a database row —
  prompt plus connectors — demoed as multilingual voice-and-text patient
  intake."
- **What makes it hard?** "The agent holds a real free-form conversation in
  three languages, decides what it still needs to know, and only then drives
  a gated, previewable write to a real backend — no menus."
- **What's the biggest risk you're aware of?** "The agent currently approves
  its own writes, which the write tool's own docs say it's designed to
  prevent — we made that call deliberately, bounded by an allowlist, and the
  fix (backend-held approval) is a known, scoped change."
