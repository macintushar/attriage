# Agent sandbox image

The execution environment for one agent session. Contains **Pi** (the agent
harness), **pm** (the Polymetrics ETL/reverse-ETL CLI), and the small set of
tools the agent needs to drive them.

## Why it exists

The agent authors and runs its own shell commands to drive `pm`. That is the
design, and it is exactly why it must not run on the host. This image is the
security boundary — it is the only thing standing between a model-generated
`bash` string and the machine.

## Build

```bash
./build.sh                    # sarvam-sandbox:latest
PM_REF=<sha> ./build.sh       # pin pm to a commit
SANDBOX_IMAGE=foo:1 ./build.sh
```

Build takes a few minutes: `pm` has no published releases and its module path
(`polymetrics.ai`) has no DNS A record, so neither `go install` nor the
release-binary path from the docs works. We clone and compile from source.

`CGO_ENABLED=0` is deliberate. It selects pm's pure-Go **JSONL warehouse**
instead of DuckDB, which is what makes agent-driven writes tractable: a
warehouse table is just a `.jsonl` file, so the agent stages a record by
writing a file rather than by executing SQL DDL.

## Verify

```bash
./smoke.sh                          # image + pm write path, no credentials
cd ../control-plane
bun run try-turn patient-intake "hi" # live agent turn through the backend
```

## Contents

| | |
|---|---|
| `pi` | agent harness, pinned via `PI_VERSION` (default 0.82.1) |
| `pm` | built from `polymetrics-ai/cli@PM_REF` |
| `jq` | the agent parses pm's `--json` envelopes with it |
| `git`, `curl`, `ripgrep`, `bash`, `ca-certificates` | |
| `tini` | pid 1, reaps processes the agent spawns |

Baked-in config:

- `/opt/sandbox/models.json` — Pi provider config for `sarvam-105b`, routed
  through the backend's private host shim. The API key never enters the image
  or container.
- `/opt/sandbox/skills/pm-workflow.md` — how to use pm, including the JSONL
  staging recipe and the approval-token rules.
- `/opt/sandbox/skills/talking-to-people.md` — conversation quality: cadence,
  language and register mirroring, transcription repair, distress and emergency
  handling, and how to close a conversation.
- `/opt/sandbox/skills/remembering.md` — durable memory: how to maintain
  `MEMORY.md` and the append-only `memory_facts` warehouse table.
- `/opt/sandbox/append-system.md` — the memory protocol, copied to
  `.pi/APPEND_SYSTEM.md` every container start so Pi appends it to the system
  prompt on every turn.
- `/opt/sandbox/memory-template.md` — the empty shape of `MEMORY.md`, seeded
  once per session and never overwritten after that.
- `/opt/pm/skills/` — pm's own generated per-connector guides.

## Running

One container per session, started once, then `docker exec` per turn:

```bash
docker run -d --name "pi-$SESSION_ID" \
  -v "$PWD/data/sessions/$SESSION_ID:/workspace" \
  --add-host host.docker.internal:host-gateway \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop=ALL --security-opt no-new-privileges \
  --memory 1g --pids-limit 256 \
  sarvam-sandbox:latest sleep infinity

docker exec -w /workspace "pi-$SESSION_ID" \
  pi -p --mode json --approve \
     --provider sarvam --model sarvam-105b \
     --session-dir /workspace/.pi/sessions --session-id "$SESSION_ID" \
     --tools bash,read,write,ls \
     --skill /workspace/skills/pm-workflow.md \
     "$USER_MESSAGE"
```

`--approve` is required: Pi's non-interactive modes silently ignore
project-local config without it.

### Security posture

| Control | Effect |
|---|---|
| non-root `agent` (uid 10001) | no privileged writes |
| `--read-only` + tmpfs `/tmp` | only `/workspace` is writable |
| `--cap-drop=ALL` | no raw sockets, no mount, no ptrace |
| `--security-opt no-new-privileges` | setuid binaries cannot escalate |
| `--memory` / `--pids-limit` | a runaway loop cannot exhaust the host |
| no docker socket mounted | no container escape via the daemon |
| `/workspace` = one session's dir | sessions cannot see each other |

**Network egress is deliberately open** — the agent needs `api.sarvam.ai` and
whatever APIs its connectors call. That is the widest remaining hole. If you
want it narrowed, put the container on a custom bridge behind an egress proxy
allowlisting only those hosts; nothing in the image assumes open egress.

Secrets are passed as env vars at `docker run` time and referenced by name.
Nothing sensitive is baked into a layer.

### Layout inside a session workspace

```
/workspace
├── .pi/
│   ├── APPEND_SYSTEM.md     memory protocol — refreshed from the image each start
│   ├── models.json          seeded from the image on first start
│   ├── sessions/            Pi's JSONL transcripts — multi-turn memory
│   └── skills/              remembering.md — auto-discovered by Pi
├── memory/
│   └── MEMORY.md            durable peer memory — seeded once, agent-maintained
├── project/                 the pm project ($PM_PROJECT_DIR)
│   └── .polymetrics/
│       ├── warehouse/*.jsonl    tables — the agent writes these directly
│       │                        (memory_facts.jsonl is the memory ledger)
│       └── outbox/              reverse-ETL receipts
├── skills/                  pm-workflow.md + generated connector guides
└── staging/                 agent scratch space
```

`entrypoint.sh` seeds all of this and is idempotent, so restarting a container
over an existing session directory is safe.

## Known issue: the agent can approve its own writes

pm splits writes into `plan → preview → run --approve <token>` and redacts the
token from `--json` output specifically so that *"an agent cannot silently
approve its own external mutation"* (`pm reverse --help`).

Our agent drives pm through `bash`, so it reads the token off plain-text stdout
and approves itself. That is a deliberate choice — autonomous appointment
booking is the product — but it does bypass a control pm's authors put there on
purpose, and it is worth being explicit about rather than discovering later.

Mitigations in place: the agent is restricted to a configured action allowlist,
and the workflow skill instructs it to confirm details with the user before an
irreversible write. If you want a real gate, the clean insertion point is the
`run` step — have the backend, not the agent, hold the token and require an
explicit user confirmation before executing.
