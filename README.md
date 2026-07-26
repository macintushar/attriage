# WhatsApp Agent Platform

Create any number of agents. Each is a system prompt plus a set of Polymetrics
`pm` connectors, fronted by its own WhatsApp number. Messages arrive as text or
voice, Sarvam transcribes them, and a **Pi agent running in a per-session Docker
sandbox** drives `pm` over bash to read and write the customer's systems.

The hero flow is patient intake: a patient WhatsApps the number, converses in
Hindi/English/Tamil by voice or text, and the agent collects their details,
works out which specialty they need, writes the record, books the appointment,
and confirms it back. **That agent is one row in a table** — nothing in the
backend knows about healthcare.

## Models

| Job | Model |
|---|---|
| Agent | `sarvam-105b` (128K ctx, OpenAI-compatible, tool calling) |
| Speech → text | `saaras:v3` (takes WhatsApp ogg/opus directly; 30s cap per request) |
| Text → speech | `bulbul:v3` (emits opus, so no transcode on the way out) |

## Layout

```
control-plane/   TanStack Start app (:3000) — UI, API, WhatsApp, Sarvam, sandboxes, SQLite
sandbox/         Docker image with pi + pm — the security boundary for agent bash
```

The TanStack Start backend owns the long-lived Baileys sockets and sandbox
reaper. Its process-level state survives Vite server-module reloads in
development, so the UI and backend run as one application without duplicating
WhatsApp connections.

## Setup

```bash
cp .env.example .env          # add SARVAM_API_KEY from dashboard.sarvam.ai
./sandbox/build.sh            # builds pi + pm into sarvam-sandbox:latest (few min)
./sandbox/smoke.sh            # verifies the image and the full pm write path

cd control-plane && bun install && bun run seed   # creates the patient-intake agent
```

## Run

One process:

```bash
cd control-plane && bun run dev      # :3000
```

Open <http://localhost:3000>. The nav badge turns amber if `SARVAM_API_KEY` is
missing or Docker is unreachable — the two things that silently break a demo.

Drive one turn without a browser or WhatsApp:

```bash
cd control-plane && bun run try-turn patient-intake "hi, I need to see a doctor"
```

Connect a real number: open the agent → **Channel** → *Connect WhatsApp* → scan
the QR with WhatsApp → Settings → Linked devices. Use a spare number; Baileys is
an unofficial client and WhatsApp can suspend numbers that automate.

## How a turn works

```
WhatsApp ─► receive ─► download ─► stt (Saaras v3) ─► sandbox ─► agent (Pi + Sarvam-105B)
                                                                   │ bash: pm …
                                                        tts (Bulbul v3) ─► send
```

The playground and WhatsApp go through the **same** `runPipeline` — a playground
that diverges from production is worse than none. Voice-only stages are marked
skipped for text messages. The `agent` stage nests every Pi tool call, so the
trace shows the actual `pm reverse plan` / `run --approve` commands as they run.

Session identity is `(agentId, peerJid)`: one patient thread = one session = one
container = one Pi session JSONL. Containers idle >15 min are reaped; the
workspace survives, so the next message resumes the conversation.

## How agents reach external systems

The agent runs `pm` from its bash tool, guided by
`sandbox/skills/pm-workflow.md`. Writes go through pm's gate:
`plan → preview → run --approve <token>`.

The one thing worth knowing: warehouse tables in this build are **plain JSONL
files**, so the agent stages a record by writing
`.polymetrics/warehouse/<table>.jsonl` — no SQL DDL, no DuckDB.

⚠️ **The agent approves its own writes.** pm redacts approval tokens from
`--json` output specifically so *"an agent cannot silently approve its own
external mutation"* (`pm reverse --help`). Ours reads the token from plain-text
stdout and approves itself, because autonomous booking is the product. It's
bounded by a per-agent action allowlist and a confirm-before-writing rule in the
prompt. If you want a real gate, have the backend hold the token and require a
human confirmation before `run` — see `sandbox/README.md`.

## Adding a connector to an agent

Connectors are config, not code. In the wizard's **Connections** step, per
connector: a connection name, which write actions are allowed, non-secret
`config` (`base_url=…`), and `credentialEnv` mapping a secret field to an **env
var name** (`api_key=ACME_API_KEY`). Secret *values* live only in the backend's
environment and are injected at `docker run` time — they never pass through the
browser, the database, or a prompt.

Check what a connector needs first:

```bash
docker run --rm sarvam-sandbox:latest pm connectors inspect <slug>
```

Only 224 of the 547 connectors can write; the rest expose no mutations.

## Verify

```bash
./sandbox/smoke.sh                                   # image + pm write path
cd control-plane && bun run typecheck && bun run lint && bun run test
cd control-plane && bun run build
```
# attriage
