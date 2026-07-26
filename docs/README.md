# Knowledge base — index

Everything here is derived from the current state of this repo (commits
`62fb3d5`, `c48fdd1`) plus public web research done on 2026-07-26. It exists to
get anyone — a teammate, a judge's question, future-you at 2am — to the right
answer fast.

**Read this first:** [`03-status-and-gotchas.md`](03-status-and-gotchas.md)
opens with a repo-integrity issue (missing `control-plane` source) that will
sink a demo or a judge's `git clone` if it's not fixed before submission.

| File | What's in it |
|---|---|
| [01-project-overview.md](01-project-overview.md) | What the product is, the hero flow, who it's for, the models it uses |
| [02-architecture.md](02-architecture.md) | How a message actually moves through the system, the security model, the pm/reverse-ETL write path |
| [03-status-and-gotchas.md](03-status-and-gotchas.md) | What's built vs. blocked, known bugs, operational gotchas — **start here** |
| [04-hackathon-context.md](04-hackathon-context.md) | Candidate hackathons this was likely built for (unconfirmed — needs your input), typical judging rubrics |
| [05-competitive-landscape.md](05-competitive-landscape.md) | Where this sits vs. existing WhatsApp healthcare bots and the Sarvam/agentic-AI hackathon field |
| [06-pitch-and-demo-strategy.md](06-pitch-and-demo-strategy.md) | The narrative, the demo script, the questions judges will ask, and how to answer them |

## What's confirmed vs. researched

Docs 01–03 are built entirely from this repo's own `README.md`, `HANDOFF.md`,
`sandbox/`, and git history — treat them as ground truth as of this clone.

Docs 04–05 include material found via public web search because the repo
itself doesn't name the specific hackathon or cite competitors. Where a claim
is inferred rather than confirmed, it's marked **[unconfirmed]**. Don't repeat
those to judges as fact without checking first — see 04 for exactly what needs
your confirmation.
