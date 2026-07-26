# Handoff — Sarvam Hackathon: WhatsApp Agent Platform

_Last updated: 2026-07-25 — the mock is gone; this is the real system._

See `README.md` for setup and how it works. This file records state, decisions,
and the things that will bite you.

## What's real now

Everything except a live Sarvam call, which needs a key (see Blocked below).

- **`sandbox/`** — Docker image, `sarvam-sandbox:latest` (785 MB), with pi 0.82.1
  and pm built from source. `./sandbox/smoke.sh` passes 13 credential-free checks
  including the full JSONL → plan → preview → `run --approve` write path.
- **`control-plane/`** — one TanStack Start application owns the UI and backend:
  SQLite (`control-plane/data/app.db`), per-session Docker sandboxes with a
  reaper, Saaras/Bulbul, the Baileys WhatsApp channel, SSE event bus, and the
  `pi --mode json` parser. The Channel tab supports in-browser QR pairing; the
  playground shows nested pm commands and captures real voice notes.
- **Seeded agent** — `patient-intake`, via
  `cd control-plane && bun run seed`.

Gates: `control-plane` typecheck ✓ lint ✓ 9/9 tests ✓; all 5 UI routes SSR 200
with no errors.

## Blocked on one thing

**`SARVAM_API_KEY` is not set anywhere**, so the agent leg is unproven
end-to-end. Everything up to it works: the request reaches Sarvam and comes back
`403 invalid_api_key_error`, which confirms `sandbox/models.json` (base URL, auth
header, model id) is correct and only the key is missing.

```bash
cd control-plane && bun run try-turn patient-intake "hi"      # full pipeline
```

If Sarvam needs `compat` flags Pi's docs don't cover, that's where it surfaces.
Candidates already researched: `supportsUsageInStreaming: false`,
`maxTokensField: "max_tokens"`, `requiresToolResultName`.

## Corrections to the original plan

- **`go install polymetrics.ai/cmd/pm@latest` cannot work** — that domain has MX
  records but no A record, so the `?go-get=1` lookup fails. The documented
  release-binary path is also dead: `polymetrics-ai/cli` is public with **zero
  releases and zero tags**. We clone and build from source.
- **The "staging into DuckDB" risk doesn't exist.** Built with `CGO_ENABLED=0`,
  pm uses a pure-Go **JSONL warehouse** — table `foo` *is*
  `.polymetrics/warehouse/foo.jsonl`. The agent stages a record by writing a
  file. Verified against a real binary, including a row with no
  `_polymetrics_*` metadata. The planned `pm_write` fallback was dropped.
- **`Sarvam-M` is dead, `Saarika` is legacy** → `sarvam-105b`, `saaras:v3`,
  `bulbul:v3`. Auth header is `api-subscription-key`; failures are **403, not
  401**.
- **Pi has no sandbox API and no MCP.** The per-session container is ours.

## Bugs found and fixed while building

Worth knowing, because each was silent:

1. **Pi exits 0 when a provider call fails**, reporting it as
   `stopReason: "error"` + `errorMessage` on the assistant message. The runner
   originally checked only the exit code, so a 403 became an *empty reply* — the
   worst failure mode for a patient waiting on WhatsApp.
   (`control-plane/src/server/agent-runner.ts`)
2. **Sandbox provisioning race.** `docker run -d` returns before the entrypoint
   finishes `pm init`, so `pm credentials add` ran against a project-less
   workspace, failed, and `|| true` + `touch .provisioned` marked the broken
   workspace as done permanently. Now there's a readiness poll and the marker is
   only written on success. (`control-plane/src/server/sandbox.ts`)
3. **SSR "Failed to parse URL".** The agent-detail loader runs on the server
   where a relative `/api/...` URL has no origin. `src/lib/api.ts` now dispatches
   directly to the in-process backend handler during SSR.
4. **Tests accumulated renders.** There's no vitest config, so
   testing-library's auto-cleanup never registers — the suites call `cleanup()`
   explicitly. Adding a second test to an existing file without it will fail
   confusingly.

## Gotchas

- **Shell cwd persists between commands** in this environment, and `cd` can fail
  with "no such directory" because you're already there. Use absolute paths.
- `rtk` filters inline shell output; when grep looks empty, write to a file and
  read it.
- **Never commit `data/`** — `data/wa/` holds live WhatsApp credentials. It's
  gitignored.
- `timeout` isn't installed on this machine (it's GNU coreutils).
- The catalog is regenerated with `bun run gen:catalog`; it now emits `canWrite`
  and `[name, method, kind]` action tuples (590 KB). Only **224 of 547**
  connectors can write — the seeded "Order Support" demo agent used to list
  Freshdesk, which has zero write actions.
- Baileys can't send a real voice note (`ptt` is never set), so TTS audio arrives
  as a playable attachment. Accepted; noted in `sandbox/README.md`.
- Stray dev servers have grabbed 3001/3002 before — read Vite's startup line.

## Next steps

1. **Set `SARVAM_API_KEY` and run the two commands above.** Nothing else matters
   until the agent leg is proven.
2. Pair a spare WhatsApp number early (Channel tab) — don't do it for the first
   time on stage.
3. Swap `outbox` for the real healthcare connector:
   `HMS_CONNECTOR=<slug> HMS_CONFIG='{...}' HMS_CREDENTIAL_ENV='{"api_key":"X"}' bun run seed`.
   Check its fields first with `pm connectors inspect <slug>`.
4. Decide the approval-gate question (see README) deliberately — for a bot
   booking real medical appointments it deserves a decision, not a default.
5. Rehearse the fallback: the playground drives the identical pipeline with no
   WhatsApp involved, so it survives a ban or a flaky venue network.
