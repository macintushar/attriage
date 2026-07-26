# Handoff — Sarvam Hackathon: WhatsApp Agent Platform

_Last updated: 2026-07-26 — channels and agents are now configured separately._

See `README.md` for setup and how it works. This file records state, decisions,
and the things that will bite you.

## What's real now

The whole path, including a live Sarvam call.

- **`sandbox/`** — Docker image, `sarvam-sandbox:latest` (785 MB), with pi 0.82.1
  and pm built from source. `./sandbox/smoke.sh` passes 13 credential-free checks
  including the full JSONL → plan → preview → `run --approve` write path.
- **`control-plane/`** — one TanStack Start application owns the UI and backend:
  SQLite (`control-plane/data/app.db`), per-session Docker sandboxes with a
  reaper, Saaras/Bulbul, the Baileys WhatsApp channels, SSE event bus, and the
  `pi --mode json` parser.
- **Channels are their own objects** — `/channels` lists them, each has Sessions
  / Pairing / Settings, and a session's agent can be pinned from the UI. The
  playground is a built-in channel, so it shares the session model.
- **Seeded** — the `patient-intake` agent plus a `hospital-whatsapp` channel that
  defaults to it: `cd control-plane && bun run seed`.

Gates: typecheck ✓ lint ✓ 47/47 tests ✓; all 9 UI routes SSR 200. A real text
turn runs end to end (`try-turn`, and a channel session over the API), and a real
**voice** turn now does too: inbound note → Saaras transcript → agent → Bulbul
reply, with both durations measured and persisted.

## The refactor, in one paragraph

An agent used to *be* a channel: `agents.channel` was a column, `channels` was
keyed by `agentId`, and a session was `(agentId, peerJid)`. Now `channels` is a
first-class table (`id, name, kind, defaultAgentId, status, phone`), a session is
`(channelId, peerJid)` carrying `agentId` + `agentPinned`, and `agents.channel`
is dropped. Routing lives in `src/server/routing.ts` as pure functions —
`resolveAgentId` is the whole policy and is unit-tested. `runPipeline` no longer
resolves anything; it takes `{channel, session, agent, input, delivery}`.

The migration keeps each new channel's id equal to the old agent id, so
`data/wa/<id>` and every session workdir still match — **a paired number does not
need rescanning.**

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
5. **Voice never worked end to end, in either direction.** Two independent
   400s, both silent:
   - **STT rejected every voice note.** WhatsApp labels its audio
     `audio/ogg; codecs=opus`, and Sarvam validates the upload type by exact
     string match — `audio/ogg` is on its allowlist, the parameter form is not.
     `sarvamMimeType()` strips parameters. The browser's MediaRecorder sends the
     same form, so the playground was broken too.
   - **TTS rejected every reply.** `/text-to-speech` defaults to 22050 Hz, which
     its own opus encoder refuses; the request now sends
     `speech_sample_rate: 48000`. The pipeline deliberately treats a TTS failure
     as non-fatal ("must not cost the patient their text reply"), so this
     surfaced only as replies that were never spoken.

   Both were invisible because **`SarvamError` didn't put the response body in
   its message** — the log said `failed: 400` and nothing else. It now includes
   Sarvam's own explanation, which is what found both bugs in one attempt. If you
   add a Sarvam call, keep that.
6. **Voice-note durations were never stored**, so anything read back from the
   database rendered as `0:00`. `audioSeconds` had exactly one producer (the
   browser's `seconds` field) and no column. Durations are now measured from the
   Ogg granule position server-side (`audio.ts`) — one source that works for
   WhatsApp, TTS and the browser alike — and `audio-backfill.ts` recovers them
   for older rows whose audio is still on disk.
7. **`ALTER TABLE … RENAME` rewrote foreign keys in other tables.** The channel
   migration renames `sessions` out of the way; modern SQLite helpfully repointed
   `messages.sessionId` and `runs.sessionId` at the temporary
   `sessions_legacy` — which is then dropped. Every message insert failed with
   `no such table: main.sessions_legacy`, i.e. the agent replied and nothing was
   recorded. `PRAGMA foreign_keys = OFF` does **not** prevent this;
   `PRAGMA legacy_alter_table = ON` does. `repairSessionReferences()` in
   `db.ts` rebuilds both tables for any database migrated before that fix, so
   it self-heals on boot. Watch for this in any future table rebuild.

## Gotchas

- **Shell cwd persists between commands** in this environment, and `cd` can fail
  with "no such directory" because you're already there. Use absolute paths.
- `rtk` filters inline shell output; when grep looks empty, write to a file and
  read it.
- **Never commit `data/`** — `data/wa/` holds live WhatsApp credentials. It's
  gitignored.
- `timeout` isn't installed on this machine (it's GNU coreutils).
- **ffmpeg and ffprobe are not installed, and voice works anyway.** They are only
  needed to split a voice note over Sarvam's 30-second cap; anything shorter goes
  through untranscoded. The 30s gate used to call `ffprobe` and therefore always
  measured `null`, so the split never even got considered — it now reads the Ogg
  stream directly. Install ffmpeg if you expect long voice notes; otherwise
  Sarvam rejects them with a clear error.
- The catalog is regenerated with `bun run gen:catalog`; it now emits `canWrite`
  and `[name, method, kind]` action tuples (590 KB). Only **224 of 547**
  connectors can write — the seeded "Order Support" demo agent used to list
  Freshdesk, which has zero write actions.
- Baileys can't send a real voice note (`ptt` is never set), so TTS audio arrives
  as a playable attachment. Accepted; noted in `sandbox/README.md`.
- Stray dev servers have grabbed 3000/3001/3002 before — read Vite's startup
  line. One held :3000 through this whole refactor; the live Baileys socket
  survived the hot reloads because the connection map hangs off a `Symbol.for`
  global keyed by channel id, which the migration deliberately preserved.
- **A channel with no default agent silently ignores new numbers.** That is
  deliberate — a stranger should not get a machine-generated apology — but it
  looks like a dead number. The channel page shows an amber banner for it.
- **Channels marked connected now resume their socket at boot.** Good (no rescan
  after a restart), but two processes sharing `data/` would both reconnect with
  the same credentials, and Baileys can answer that by logging the number out.
  Set `CHANNEL_AUTO_RECONNECT=0` if you ever run two.
- `data/wa/hh/` is an empty auth directory left by a deleted agent from before
  the refactor. Harmless; no channel row points at it.

## Next steps

1. Pair a spare WhatsApp number early (**Channels → Pairing**) — don't do it for
   the first time on stage. The seeded `hospital-whatsapp` channel is separate
   from the migrated `patient-intake` channel, which already holds the
   credentials for `+919902181190`; delete whichever you don't want.
2. Swap `outbox` for the real healthcare connector:
   `HMS_CONNECTOR=<slug> HMS_CONFIG='{...}' HMS_CREDENTIAL_ENV='{"api_key":"X"}' bun run seed`.
   Check its fields first with `pm connectors inspect <slug>`.
3. Decide the approval-gate question (see README) deliberately — for a bot
   booking real medical appointments it deserves a decision, not a default.
4. Rehearse the fallback: the playground drives the identical pipeline with no
   WhatsApp involved, so it survives a ban or a flaky venue network.
5. Telegram and web chat are listed as channel kinds but marked unavailable.
   Adding one is now a `channel.ts` adapter plus a `ChannelKind` case — no agent,
   session, or pipeline change.
