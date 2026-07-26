# attriage

A WhatsApp agent platform for patient intake. A patient messages the number, speaks or types in Hindi/English/Tamil, and an AI agent collects their details, determines the right specialty, writes the record, books the appointment, and confirms back — **all defined by one row in a table**, with no healthcare logic baked into the backend.

## Core concepts

Two things are configured independently:

- An **agent** is a system prompt plus a set of Polymetrics `pm` connectors. It has no phone number of its own.
- A **channel** is a WhatsApp number. It owns its conversations and points them at an agent.

```
Channel (a WhatsApp number)
├── default agent ─────────────► Agent (prompt + connectors)
└── Session (one peer)  ┐
    Session (one peer)  ├─ follows the channel default…
    Session (one peer) ─┘  …unless pinned to a different agent
```

Every new number that writes in becomes a **session** on that channel, handed to the channel's default agent. Change the default and every unpinned session moves with it — including ones already in progress. Assign a specific agent to a single session in the control plane and it is **pinned**: it keeps that agent regardless of the channel default. This is how one number does triage by default but routes a specific caller to billing.

Reassigning a session keeps its workspace and conversation history — only the prompt and connector credentials change. The **Playground** is a built-in channel, so the in-app chat and `try-turn` take the identical path as a real WhatsApp message.

## How a turn works

```
Channel ─► receive ─► download ─► stt (Saaras v3) ─► sandbox ─► agent (Pi + Sarvam-105B)
             │                                                     │ bash: pm …
    resolve session + agent                             tts (Bulbul v3) ─► send
```

Routing happens before the pipeline runs: `channel.ts` turns a peer into a session, `resolveAgentId` turns the session into an agent, and `runPipeline` receives all three. The Playground and WhatsApp go through the **same** `runPipeline` — a playground that diverges from production is worse than none. Voice-only stages are skipped for text messages. The `agent` stage nests every Pi tool call, so the trace shows the actual `pm reverse plan` / `run --approve` commands as they run.

Session identity is `(channelId, peerJid)`: one patient thread = one session = one container = one Pi session JSONL. Containers idle >15 min are reaped; the workspace survives, so the next message resumes the conversation.

## Models

| Job | Model |
|---|---|
| Agent | `sarvam-105b` (128K ctx, OpenAI-compatible, tool calling) |
| Speech → text | `saaras:v3` (takes WhatsApp ogg/opus directly; 30s cap per request) |
| Text → speech | `bulbul:v3` (emits opus at 48 kHz) |

## Layout

```
control-plane/   TanStack Start app (:3000) — UI, API, WhatsApp, Sarvam, sandboxes, SQLite
sandbox/         Docker image with pi + pm — the security boundary for agent bash
```

The TanStack Start backend owns the long-lived Baileys sockets and sandbox reaper. Its process-level state survives Vite server-module reloads in development, so the UI and backend run as one application without duplicating WhatsApp connections.

## Setup

```bash
cp .env.example .env          # add SARVAM_API_KEY from dashboard.sarvam.ai
./sandbox/build.sh            # builds pi + pm into sarvam-sandbox:latest (few min)
./sandbox/smoke.sh            # verifies the image and the full pm write path

cd control-plane && bun install && bun run seed   # patient-intake agent + a WhatsApp channel
```

## Run

```bash
cd control-plane && bun run dev      # :3000
```

Open <http://localhost:3000>. The nav badge turns amber if `SARVAM_API_KEY` is missing or Docker is unreachable — the two things that silently break a demo.

Drive one turn without a browser or WhatsApp:

```bash
cd control-plane && bun run try-turn patient-intake "hi, I need to see a doctor"
```

Connect a real number: **Channels → pick the channel → Pairing → Connect WhatsApp → scan the QR → Settings → Linked devices**. Use a spare number; Baileys is an unofficial client and WhatsApp can suspend numbers that automate. Pairing survives a restart — credentials live in `data/wa/<channelId>/` and a connected channel reconnects at boot.

## External connectors (pm)

The agent runs `pm` from its bash tool, guided by `sandbox/skills/pm-workflow.md`. Writes go through pm's gate: `plan → preview → run --approve <token>`.

Warehouse tables in this build are **plain JSONL files** — no SQL DDL, no DuckDB. The agent stages a record by writing `.polymetrics/warehouse/<table>.jsonl`.

> **The agent approves its own writes.** pm redacts approval tokens from `--json` output specifically so that *"an agent cannot silently approve its own external mutation"* — ours reads the token from plain-text stdout and approves itself, because autonomous booking is the product. It is bounded by a per-agent action allowlist and a confirm-before-writing rule in the prompt. If you want a real gate, have the backend hold the token and require a human confirmation before `run` — see `sandbox/README.md`.

### Adding a connector to an agent

Connectors are config, not code. In the wizard's **Connections** step: pick a connection name, select which write actions are allowed, add non-secret `config` (`base_url=…`), and map secret fields to env var names (`api_key=ACME_API_KEY`). Secret values live only in the backend's environment and are injected at `docker run` time — they never pass through the browser, the database, or a prompt.

Check what a connector needs first:

```bash
docker run --rm sarvam-sandbox:latest pm connectors inspect <slug>
```

Only 224 of the 547 available connectors can write; the rest expose no mutations.

## Mock hospital management system

A stand-in for the hospital's real HIS, so a demo ends with a record you can point at.

```bash
bun run mock-hms/server.ts     # :8081 — open http://localhost:8081 for the live view
```

The sandbox image ships an `hms` CLI on the agent's `PATH` (`sandbox/bin/hms`, documented for the agent in `sandbox/skills/hospital-records.md`). It talks to the server over HTTP at `$HMS_URL`, which defaults to `http://host.docker.internal:8081` — the host, as seen from the container. The whole intake is three calls:

```bash
hms find-patient "$PHONE"
hms new-patient --name "Priya S" --phone "$PHONE" --language ta
hms book --patient pat-a1b2c3 --doctor doc-002 --at 2026-07-28T10:30:00+05:30
```

The dashboard at `/` lists appointments, patients and the doctor roster, and refreshes every 2s, so records appear as the agent writes them. State is `mock-hms/data.json` (gitignored) — delete it to reset. No auth, no persistence guarantees; it is a demo prop, not a service.

## Verify

```bash
./sandbox/smoke.sh                                   # image + pm write path
cd control-plane && bun run typecheck && bun run lint && bun run test
cd control-plane && bun run build
```
