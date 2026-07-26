# WhatsApp Agent Platform

Two things are configured independently:

- An **agent** is a system prompt plus a set of Polymetrics `pm` connectors. It
  has no number and no channel of its own.
- A **channel** is somewhere people message you — a WhatsApp number. It owns its
  conversations and points them at an agent.

Messages arrive as text or voice, Sarvam transcribes them, and a **Pi agent
running in a per-session Docker sandbox** drives `pm` over bash to read and write
the customer's systems.

The hero flow is patient intake: a patient WhatsApps the number, converses in
Hindi/English/Tamil by voice or text, and the agent collects their details,
works out which specialty they need, writes the record, books the appointment,
and confirms it back. **That agent is one row in a table** — nothing in the
backend knows about healthcare.

## Channels, sessions, agents

```
Channel (a WhatsApp number)
├── default agent ─────────────► Agent (prompt + connectors)
└── Session (one peer)  ┐
    Session (one peer)  ├─ follows the channel default…
    Session (one peer) ─┘  …unless pinned to a different agent
```

Every new number that writes in becomes a **session** on that channel, handed to
the channel's default agent. Change the default and every unpinned session moves
with it, including ones already in progress. Assign an agent to a single session
in the control plane and it is *pinned*: it keeps that agent no matter what the
default does. That is how one number serves triage by default and routes a
specific caller to billing.

Reassigning a session keeps its workspace and its conversation history — only the
prompt and the connector credentials change. The **Playground** is a built-in
channel, so the in-app chat and `try-turn` take the identical path as WhatsApp.

## Models

| Job | Model |
|---|---|
| Agent | `sarvam-105b` (128K ctx, OpenAI-compatible, tool calling) |
| Speech → text | `saaras:v3` (takes WhatsApp ogg/opus directly; 30s cap per request) |
| Text → speech | `bulbul:v3` (emits opus at 48 kHz — it rejects its own default rate) |

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

cd control-plane && bun install && bun run seed   # patient-intake agent + a WhatsApp channel
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

Connect a real number: **Channels** → pick the channel → **Pairing** → *Connect
WhatsApp* → scan the QR with WhatsApp → Settings → Linked devices. Use a spare
number; Baileys is an unofficial client and WhatsApp can suspend numbers that
automate. Pairing survives a restart — the credentials live in
`data/wa/<channelId>/`, and a channel that was connected reconnects at boot.

## How a turn works

```
Channel ─► receive ─► download ─► stt (Saaras v3) ─► sandbox ─► agent (Pi + Sarvam-105B)
             │                                                     │ bash: pm …
    resolve session + agent                             tts (Bulbul v3) ─► send
```

Routing happens before the pipeline runs: `channel.ts` turns a peer into a
session, `resolveAgentId` turns the session into an agent, and `runPipeline`
receives all three. The playground and WhatsApp go through the **same**
`runPipeline` — a playground that diverges from production is worse than none.
Voice-only stages are marked skipped for text messages. The `agent` stage nests
every Pi tool call, so the trace shows the actual `pm reverse plan` /
`run --approve` commands as they run.

Session identity is `(channelId, peerJid)`: one patient thread = one session =
one container = one Pi session JSONL. Containers idle >15 min are reaped; the
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
