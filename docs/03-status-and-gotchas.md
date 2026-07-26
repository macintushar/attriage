# Status and gotchas

_Baseline: `HANDOFF.md` as of 2026-07-25, plus a fresh check of this clone on
2026-07-26._

## 🚨 Fix this before anyone else clones the repo

**`control-plane/` is empty in this clone — and it will be empty for anyone
else too, including judges, unless this is fixed.**

`git ls-tree` shows why:

```
160000 commit 755ac675d12caf4e7118ecc2c5b61a89deaa7eca	control-plane
```

Mode `160000` is a **git submodule (gitlink) reference**, not a regular
tracked directory. It points at commit `755ac675…`, but there is **no
`.gitmodules` file** in the repo, so git has no URL to fetch it from. The
entire TanStack Start application — the UI, the WhatsApp/Baileys channel, the
Sarvam pipeline glue, `agent-runner.ts`, `sandbox.ts`, `src/lib/api.ts`, the
SQLite layer, the test suite HANDOFF.md says is "9/9 passing" — **is not
present in the public GitHub repo** at
`https://github.com/macintushar/attriage`. Only `sandbox/` (the Docker image
and skills) and the top-level docs are actually there.

This was almost certainly caused by committing `control-plane` as a nested git
repo (it has its own `.git`) without either (a) adding a proper `.gitmodules`
entry and pushing that repo somewhere public, or (b) just committing it as a
normal directory.

**Two ways to fix it, pick one before submission:**

1. **Flatten it in** (simplest, recommended for a hackathon): from the repo
   root, `git rm --cached control-plane`, then `rm -rf control-plane/.git`
   (the nested repo's own git metadata) and `git add control-plane` to commit
   it as normal files.
2. **Make it a real submodule**: push the `control-plane` repo somewhere
   (even a private-then-public repo works), add a `.gitmodules` pointing at
   it, and make sure judges know to `git clone --recurse-submodules`.

Option 1 is safer for a demo — no dependency on a second repo being reachable
at judging time, no submodule-init step to forget.

**Action:** confirm which of these has already happened locally (there is a
non-empty `control-plane/` *somewhere* — HANDOFF.md describes real, working
code) and push the fix before the deadline.

## What's real right now (per HANDOFF.md, as of 2026-07-25)

Everything except a live Sarvam call, which needs a key:

- **`sandbox/`** — `sarvam-sandbox:latest` (785 MB) with pi 0.82.1 and `pm`
  built from source. `./sandbox/smoke.sh` passes 13 credential-free checks,
  including the full JSONL → plan → preview → `run --approve` write path.
- **`control-plane/`** (source not in this clone — see above) — one TanStack
  Start app owning UI + backend: SQLite, per-session Docker sandboxes with a
  reaper, Saaras/Bulbul integration, Baileys WhatsApp channel, an SSE event
  bus, and a `pi --mode json` output parser. In-browser QR pairing on the
  Channel tab; the playground shows nested `pm` commands and captures real
  voice notes.
- **Seeded agent**: `patient-intake`, via `cd control-plane && bun run seed`.
- **Gates green**: `control-plane` typecheck ✓, lint ✓, 9/9 tests ✓; all 5 UI
  routes SSR 200 with no errors.

## Blocked on one thing

`SARVAM_API_KEY` is not set anywhere, so the agent leg is unproven
**end-to-end**. Everything up to it works — the request reaches Sarvam and
comes back `403 invalid_api_key_error`, confirming `sandbox/models.json`
(base URL, auth header, model id) is correct and only the key is missing.

```bash
cd control-plane && bun run try-turn patient-intake "hi"      # full pipeline
```

If Sarvam needs `compat` flags Pi's docs don't cover, this is where it
surfaces. Already-researched candidates: `supportsUsageInStreaming: false`,
`maxTokensField: "max_tokens"`, `requiresToolResultName`.

**This is the single highest-priority task before any demo**, per HANDOFF.md's
own "Next steps" — get a real `SARVAM_API_KEY` from
[dashboard.sarvam.ai](https://dashboard.sarvam.ai) and run the command above
early, not for the first time on stage.

## Corrections made to the original plan (worth knowing so you don't re-discover them)

- `go install polymetrics.ai/cmd/pm@latest` **cannot work** — that domain has
  MX records but no A record, so the `?go-get=1` lookup fails. The documented
  release-binary path is also dead (`polymetrics-ai/cli` has zero releases,
  zero tags). Solution: clone and build from source (already done in the
  Dockerfile).
- The feared "staging into DuckDB" complexity **doesn't exist** — see the
  JSONL-warehouse explanation in
  [02-architecture.md](02-architecture.md).
- Model names in earlier plans were stale: `Sarvam-M` is dead, `Saarika` is
  legacy. Current names are `sarvam-105b`, `saaras:v3`, `bulbul:v3`. Auth
  header is `api-subscription-key`. Auth failures are **403, not 401**.
- Pi has **no sandbox API and no MCP** — the per-session container is custom,
  built for this project, not something Pi provides.

## Bugs found and fixed (each was silent — worth re-checking if behavior regresses)

1. **Pi exits 0 even when a provider call fails**, surfacing the failure only
   as `stopReason: "error"` + `errorMessage` on the assistant message. The
   original runner checked exit code only, so a 403 silently became an *empty
   reply* — the worst possible failure mode for a patient waiting on
   WhatsApp. Fixed in `agent-runner.ts`.
2. **Sandbox provisioning race**: `docker run -d` returns before the
   entrypoint finishes `pm init`, so `pm credentials add` could run against a
   project-less workspace, fail, get swallowed by `|| true`, and still get
   marked `.provisioned` — permanently broken, permanently "done." Fixed with
   a readiness poll; the marker is now only written on success. Fixed in
   `sandbox.ts`.
3. **SSR "Failed to parse URL"**: the agent-detail loader runs server-side,
   where a relative `/api/...` URL has no origin. `src/lib/api.ts` now
   dispatches directly to the in-process backend handler during SSR.
4. **Tests were accumulating renders** — no vitest config means
   testing-library's auto-cleanup never registers; suites call `cleanup()`
   explicitly instead. Adding a new test file without this will fail
   confusingly.

## Operational gotchas

- Shell `cwd` persists between commands in the dev environment; `cd` can fail
  with "no such directory" simply because you're already there — prefer
  absolute paths.
- **Never commit `data/`** — `control-plane/data/wa/` holds live WhatsApp
  credentials. It's gitignored; double-check before any `git add -A`.
- `timeout` isn't installed on the dev machine (GNU coreutils-only tool).
- The connector catalog (`bun run gen:catalog`) emits `canWrite` +
  `[name, method, kind]` tuples, ~590 KB. Only **224 of 547** connectors can
  write — a previous demo agent listed Freshdesk, which has zero write
  actions. Check with `pm connectors inspect <slug>` before wiring a new
  connector into an agent.
- Baileys can't send a real WhatsApp voice note (`ptt` is never set); TTS
  audio arrives as a playable attachment instead. Accepted limitation, noted
  in `sandbox/README.md` — worth pre-empting if a judge expects a native
  voice-note bubble.
- Stray dev servers have previously grabbed ports 3001/3002 before — read
  Vite's actual startup line rather than assuming `:3000`.

## Next steps, in priority order (from HANDOFF.md)

1. **Fix the missing `control-plane` source in the public repo** (see top of
   this doc — not in the original HANDOFF.md, added here because it blocks
   everything else being reviewable).
2. Set `SARVAM_API_KEY` and run `bun run try-turn patient-intake "hi"`.
   Nothing else matters until the agent leg is proven end-to-end.
3. Pair a spare WhatsApp number early (Channel tab) — don't do it for the
   first time on stage.
4. Swap the `outbox` demo connector for a real healthcare connector:
   `HMS_CONNECTOR=<slug> HMS_CONFIG='{...}' HMS_CREDENTIAL_ENV='{"api_key":"X"}' bun run seed`.
   Check its fields first with `pm connectors inspect <slug>`.
5. Decide the self-approval question deliberately (see
   [02-architecture.md](02-architecture.md)) — for a bot booking real medical
   appointments it deserves an explicit answer, not a shrug.
6. Rehearse the fallback: the playground drives the identical pipeline with
   no WhatsApp involved, so a WhatsApp ban or flaky venue network doesn't
   sink the demo.
