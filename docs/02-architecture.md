# Architecture

## How one turn works

```
WhatsApp ─► receive ─► download ─► stt (Saaras v3) ─► sandbox ─► agent (Pi + Sarvam-105B)
                                                                    │ bash: pm …
                                                         tts (Bulbul v3) ─► send
```

The in-app **playground** and the real **WhatsApp channel** both go through
the exact same `runPipeline` function — there is deliberately no separate
"demo mode" that could drift from what actually ships. Voice-only stages are
marked skipped for text messages. The `agent` stage nests every Pi tool call
in its trace, so a trace viewer shows the literal `pm reverse plan` /
`pm reverse run --approve` commands the model ran, not a summary.

## Session identity and lifecycle

- A session is keyed by **`(agentId, peerJid)`** — one patient WhatsApp thread
  maps to one session, one Docker container, and one Pi session JSONL
  transcript.
- Containers idle **>15 minutes** are reaped. The workspace directory
  survives the reap, so the next incoming message resumes the conversation
  with full history intact — the container is disposable, the workspace isn't.
- Provisioning a new session container runs `pm init` inside the entrypoint;
  the backend polls for readiness rather than assuming `docker run -d` means
  "ready" (see bug #2 in
  [03-status-and-gotchas.md](03-status-and-gotchas.md)).

## The sandbox: the actual security boundary

The agent authors and executes its own `bash` commands to drive `pm` — that's
the design, and it's exactly why it must never run on the host. `sandbox/`
(a ~785 MB Docker image, `sarvam-sandbox:latest`) is where that boundary
lives.

Contents: `pi` (agent harness, pinned via `PI_VERSION`, default `0.82.1`),
`pm` (built from `polymetrics-ai/cli` source — see below), `jq` (the agent
parses `pm --json` envelopes with it), plus `git`, `curl`, `ripgrep`, `bash`,
`tini` as PID 1 to reap runaway child processes.

Hardened `docker run` flags actually used:

| Control | Effect |
|---|---|
| non-root `agent` (uid 10001) | no privileged writes |
| `--read-only` + tmpfs `/tmp` | only `/workspace` is writable |
| `--cap-drop=ALL` | no raw sockets, no mount, no ptrace |
| `--security-opt no-new-privileges` | setuid binaries can't escalate |
| `--memory 1g` / `--pids-limit 256` | a runaway loop can't exhaust the host |
| no Docker socket mounted | no container-escape-via-daemon |
| `/workspace` = one session's dir | sessions can't see each other |

**Deliberately open:** network egress. The agent needs `api.sarvam.ai` and
whatever connector APIs it's configured to call. This is documented as the
widest remaining hole, with the stated mitigation (an egress-allowlisting
proxy on a custom bridge) explicitly *not yet implemented*. Worth having an
answer ready if a judge asks "what stops the agent from exfiltrating data or
calling out to something arbitrary?" — honest answer: nothing yet, it's a
known and documented gap, not an oversight.

## Why `pm` (Polymetrics) instead of hand-rolled integrations

`pm` is a local-first ETL / reverse-ETL CLI: connectors declare read streams
and, where the underlying API supports mutation, reverse-ETL **write
actions**. This buys the platform two things a bespoke integration-per-connector
approach wouldn't:

1. **Generality.** 547 connectors are cataloged; the agent only needs to learn
   one CLI surface (`pm connectors inspect`, `pm reverse plan/preview/run`) no
   matter which one it's driving. Only **224 of 547** connectors can actually
   write — worth knowing before picking a demo connector (the original seed
   agent mistakenly listed Freshdesk, which has zero write actions).
2. **A built-in approval gate.** Writes are staged in three steps —
   `plan → preview → run --approve <token>` — and nothing external mutates
   until step 3. That structure is what makes "confirm with the patient before
   booking" enforceable rather than aspirational.

### The warehouse is just JSONL, not a database

The image is built with `CGO_ENABLED=0`, which makes `pm` select its pure-Go
warehouse backend instead of DuckDB. A warehouse table named `foo` **is**
`.polymetrics/warehouse/foo.jsonl` — the agent "creates a table" by writing a
file, one JSON object per line. No SQL DDL, no embedded database to reason
about. This was flagged as a risk in the original plan and turned out not to
be one (see corrections in
[03-status-and-gotchas.md](03-status-and-gotchas.md)).

### The write recipe the agent actually follows

1. **Stage**: write the record to
   `.polymetrics/warehouse/<table>.jsonl`, verify with
   `pm query run --sql "SELECT * FROM <table>"`.
2. **Plan**: `pm reverse plan <name> --source-table <table> --destination <connector>:<credential> --action <action> --map <src>:<dst> [...]`
   — at least one `--map` is required. Prints a plan id and an **approval
   token** (only in human-readable stdout; `--json` redacts it on purpose).
3. **Preview**: `pm reverse preview <plan-id>` — changes nothing, shows the
   mapped rows that *would* be written.
4. **Run**: `pm reverse run <plan-id> --approve <token>` — the only step that
   actually mutates the external system.

Exit codes are stable and meaningful: `0` success, `2` usage error, `3`
validation error, `4` auth failure, `7` policy/approval required.

## ⚠️ The agent approves its own writes

`pm` redacts the approval token from `--json` output *specifically* so that
"an agent cannot silently approve its own external mutation" (`pm reverse
--help`, quoted directly). This platform's agent reads the plain-text stdout
instead and approves itself — a deliberate choice, because autonomous booking
*is* the product, but it does bypass a control `pm`'s own authors built in on
purpose.

Mitigations actually in place: a per-agent action allowlist, and a
prompt-level rule (`sandbox/skills/pm-workflow.md`) to confirm details with
the user before an irreversible write. The documented "real" fix — have the
**backend**, not the agent, hold the token and require an explicit human
confirmation before `run` — is not implemented. This is a legitimate,
answerable question for judges, not a hidden flaw: see
[06-pitch-and-demo-strategy.md](06-pitch-and-demo-strategy.md) for how to
frame it.

## Secrets handling

Connector credentials are configured per-agent as `credentialEnv` (a secret
field name → an env var name, e.g. `api_key=ACME_API_KEY`). Secret *values*
live only in the control-plane's own environment and are injected at
`docker run` time — they never pass through the browser, the SQLite database,
or a prompt. The agent references credentials by name only; `pm-workflow.md`
explicitly instructs the agent never to put secret values in command
arguments, files, or anything it says.

## Connector configuration model

Connectors are **config, not code**. Per connector, per agent: a connection
name, an allowlist of which write actions may be used, non-secret `config`
(e.g. `base_url=…`), and the `credentialEnv` mapping above. This is what makes
"add a new business vertical" a wizard flow instead of a code change — the
backend genuinely doesn't know what business it's running.
