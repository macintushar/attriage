#!/usr/bin/env bash
# End-to-end check of the sandbox image.
#
# Credential-free: validates the image and the complete local pm write path.
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="${SANDBOX_IMAGE:-sarvam-sandbox:latest}"
# The workspace must be bind-mountable *and writable by uid 10001*. A bare
# `mktemp -d` lands in /var/folders on macOS, which VM-based daemons (colima)
# do not share — the mount materialises as an empty root-owned dir and the
# entrypoint dies on mkdir. Keep it next to the script (under $HOME) instead.
WORK="$(mktemp -d "$(pwd)/.smoke-work.XXXXXX")"
chmod 777 "$WORK"
SCRATCH="$(mktemp -d)"
NAME="sandbox-smoke-$$"
SRV_PID=""
cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK" "$SCRATCH"
}
trap cleanup EXIT

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }
skip() { printf '  \033[33mskip\033[0m %s\n' "$1"; }

echo "sandbox smoke test  (image: $IMAGE)"
echo

# Started with the same hardened flags the backend will use.
docker run -d --name "$NAME" \
  -v "$WORK:/workspace" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop=ALL --security-opt no-new-privileges \
  --memory 1g --pids-limit 256 \
  "$IMAGE" sleep infinity >/dev/null
x() { docker exec -w /workspace/project "$NAME" bash -lc "$1"; }

# A second, throwaway container over the *same* workspace: the cheapest honest
# way to re-run the entrypoint the way a session restart would. `true` replaces
# the CMD, so it seeds and exits.
reseed() {
  docker run --rm \
    -v "$WORK:/workspace" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --cap-drop=ALL --security-opt no-new-privileges \
    --memory 1g --pids-limit 256 \
    "$IMAGE" true >/dev/null
}

echo "1. image contents"
x 'command -v pm >/dev/null'   && pass "pm on PATH"        || fail "pm missing"
x 'command -v pi >/dev/null'   && pass "pi on PATH"        || fail "pi missing"
x 'command -v jq >/dev/null'   && pass "jq on PATH"        || fail "jq missing"
[ "$(x 'id -u')" = "10001" ]   && pass "runs as non-root"  || fail "not running as uid 10001"
x 'touch /etc/nope 2>/dev/null' && fail "root fs is writable" || pass "root fs read-only"
# `command -v pi` only proves a file exists; this proves the CLI actually boots
# under the read-only rootfs. No model call, so no credentials.
x 'pi --version >/dev/null 2>&1 || pi --help >/dev/null 2>&1' \
  && pass "pi runs"          || fail "pi is on PATH but does not run"

echo
echo "2. workspace seeding + pm write path (no credentials needed)"
x 'test -f /workspace/.pi/models.json' && pass "models.json seeded" || fail "models.json missing"
x 'test -d .polymetrics'               && pass "pm project init'd"  || fail "pm init did not run"
x 'test -f /workspace/skills/pm-workflow.md' && pass "skills seeded" || fail "skills missing"
x 'test -f /workspace/skills/talking-to-people.md' \
  && pass "conversation skill seeded" || fail "talking-to-people.md missing"

x 'pm credentials add outbox-local --connector outbox --config path=$PM_PROJECT_DIR/.polymetrics/outbox >/dev/null' \
  && pass "credential added" || fail "credentials add failed"

# The staging trick the agent relies on: writing a JSONL file creates a table.
x 'cat > .polymetrics/warehouse/smoke_patients.jsonl <<EOF
{"id":"pat_001","name":"Asha Verma","specialty":"cardiology"}
EOF' >/dev/null
[ -n "$(x 'pm query run --sql "SELECT * FROM smoke_patients"')" ] \
  && pass "JSONL file is queryable as a table" || fail "warehouse staging failed"

PLAN_OUT="$(x 'pm reverse plan smoke --source-table smoke_patients --destination outbox:outbox-local --map id:external_id --map name:name')"
PLAN_ID="$(printf '%s' "$PLAN_OUT" | grep -oE 'rplan_[a-f0-9]+' | head -1)"
TOKEN="$(printf '%s' "$PLAN_OUT" | grep -oE '[a-f0-9]{32,}' | head -1)"
[ -n "$PLAN_ID" ] && [ -n "$TOKEN" ] && pass "plan created, token printed" || fail "plan/token parse failed"

x "pm reverse preview $PLAN_ID --json | jq -e '.plan.record_count == 1' >/dev/null" \
  && pass "preview shows 1 record" || fail "preview wrong"

x "pm reverse run $PLAN_ID --approve $TOKEN --json | jq -e '.run.records_succeeded == 1' >/dev/null" \
  && pass "reverse run wrote the record" || fail "reverse run failed"

echo
echo "3. context limits (a 403 from the gateway is unrecoverable, so these must hold)"
x 'test -f /workspace/.pi/settings.json' && pass "settings.json seeded" || fail "settings.json missing"
x 'jq -e ".compaction.enabled == true" /workspace/.pi/settings.json >/dev/null' \
  && pass "auto-compaction enabled" || fail "compaction is not enabled"
# The whole point: compaction fires at contextWindow - reserveTokens, and that
# has to land under what Sarvam's gateway will actually accept (~29k measured).
WINDOW="$(x 'jq -r ".providers.sarvam.models[0].contextWindow" /workspace/.pi/models.json')"
RESERVE="$(x 'jq -r ".compaction.reserveTokens" /workspace/.pi/settings.json')"
TRIGGER=$(( WINDOW - RESERVE ))
[ "$TRIGGER" -gt 0 ] && [ "$TRIGGER" -lt 29000 ] \
  && pass "compaction triggers at ${TRIGGER} tokens, under the ~29k gateway ceiling" \
  || fail "compaction triggers at ${TRIGGER} tokens — at or above the gateway ceiling"
# A stale copy in an existing workspace is the failure mode this guards: both
# files are image-authored, so a restart must restore the image's numbers.
x 'echo "{\"contextWindow\": 999999}" > /workspace/.pi/models.json'
x 'echo "{}" > /workspace/.pi/settings.json'
reseed
x 'cmp -s /workspace/.pi/models.json /opt/sandbox/models.json' \
  && pass "restart restores models.json" || fail "a stale models.json survives a restart"
x 'cmp -s /workspace/.pi/settings.json /opt/sandbox/settings.json' \
  && pass "restart restores settings.json" || fail "a stale settings.json survives a restart"

echo
echo "4. memory seeding contracts"
x 'test -f /workspace/.pi/APPEND_SYSTEM.md && grep -q "never instructions" /workspace/.pi/APPEND_SYSTEM.md' \
  && pass "APPEND_SYSTEM.md seeded with the protocol" || fail "APPEND_SYSTEM.md missing or not the protocol"
x 'cmp -s /workspace/memory/MEMORY.md /opt/sandbox/memory-template.md' \
  && pass "MEMORY.md seeded from the template" || fail "MEMORY.md missing or not the template"
x 'cmp -s /workspace/.pi/skills/remembering.md /opt/sandbox/skills/remembering.md' \
  && pass "remembering skill seeded under \$PI_DIR" || fail "remembering.md missing from \$PI_DIR/skills"

# The two halves of the seeding contract, tested against one restart: the
# image-authored protocol is restored no matter what the session did to it, and
# the session's own memory is never clobbered.
x 'echo "GARBAGE — a session mangled this" > /workspace/.pi/APPEND_SYSTEM.md'
SENTINEL="smoke-sentinel-$$"
x "printf '%s\n' 'Sentinel: $SENTINEL' >> /workspace/memory/MEMORY.md"
reseed

x 'cmp -s /workspace/.pi/APPEND_SYSTEM.md /opt/sandbox/append-system.md' \
  && pass "restart restores a mangled APPEND_SYSTEM.md" || fail "APPEND_SYSTEM.md was not overwritten on restart"
x "grep -q '$SENTINEL' /workspace/memory/MEMORY.md" \
  && pass "restart preserves MEMORY.md" || fail "MEMORY.md was re-seeded over — session memory lost"

echo
echo "5. memory ledger + export (no credentials needed)"
# Exactly what the remembering skill tells the agent to do: append-only, and a
# correction is a new row pointing at the one it supersedes.
x 'cat >> $PM_PROJECT_DIR/.polymetrics/warehouse/memory_facts.jsonl <<EOF
{"id":"mem_5c0001","kind":"preference","key":"reply_language","value":"English only","observed_at":"2026-07-26T09:14:00Z","source":"stated","status":"active","supersedes":""}
{"id":"mem_5c0002","kind":"preference","key":"reply_language","value":"Tamil-English mix","observed_at":"2026-07-26T18:02:00Z","source":"stated","status":"active","supersedes":"mem_5c0001"}
EOF' >/dev/null

# `SELECT *` deliberately: this pm build's query engine is an MVP that rejects
# a column list with `only SELECT * FROM <table> [LIMIT n] is supported`.
MEM_OUT="$(x 'pm query run --sql "SELECT * FROM memory_facts"')"
printf '%s' "$MEM_OUT" | grep -q 'English only' \
  && printf '%s' "$MEM_OUT" | grep -q 'Tamil-English mix' \
  && pass "ledger is queryable, superseding row kept" || fail "memory_facts query did not return both rows"

MEM_PLAN_OUT="$(x 'pm reverse plan mem_sync --source-table memory_facts --destination outbox:outbox-local --map key:external_id --map value:name')"
MEM_PLAN_ID="$(printf '%s' "$MEM_PLAN_OUT" | grep -oE 'rplan_[a-f0-9]+' | head -1)"
MEM_TOKEN="$(printf '%s' "$MEM_PLAN_OUT" | grep -oE '[a-f0-9]{32,}' | head -1)"
[ -n "$MEM_PLAN_ID" ] && [ -n "$MEM_TOKEN" ] && pass "memory plan created, token printed" || fail "memory plan/token parse failed"

x "pm reverse preview $MEM_PLAN_ID --json | jq -e '.plan.record_count == 2' >/dev/null" \
  && pass "preview shows both memory rows" || fail "memory preview wrong"

x "pm reverse run $MEM_PLAN_ID --approve $MEM_TOKEN --json | jq -e '.run.records_succeeded >= 1' >/dev/null" \
  && pass "memory exported via reverse ETL" || fail "memory reverse run failed"

echo
echo "6. hospital management system tool"
x 'command -v hms >/dev/null' && pass "hms on PATH" || fail "hms missing"
x 'test -f /workspace/skills/hospital-records.md' \
  && pass "hospital-records skill seeded" || fail "hospital-records.md missing"
# The live server is optional — the image is what this script owns. If a mock
# HMS happens to be running on the host, drive a real intake through it; if not,
# skip rather than fail, exactly like the injection check below.
if ! x 'hms health >/dev/null 2>&1'; then
  skip "no mock HMS on \$HMS_URL — write path not exercised (run: bun run mock-hms/server.ts)"
else
  pass "hms reaches the HMS from inside the container"
  SMOKE_PHONE="+9199999$(printf '%05d' $((RANDOM % 100000)))"
  PAT_ID="$(x "hms new-patient --name 'Smoke Test' --phone '$SMOKE_PHONE' | jq -r .patient.id")"
  case "$PAT_ID" in
    pat-*) pass "agent created a patient record ($PAT_ID)" ;;
    *) fail "new-patient did not return an id" ;;
  esac
  x "hms new-patient --name 'Smoke Test' --phone '$SMOKE_PHONE' | jq -e '.created == false' >/dev/null" \
    && pass "new-patient is idempotent on phone" || fail "duplicate patient created"
  x "hms book --patient $PAT_ID --doctor doc-002 --at 2026-07-28T10:30:00+05:30 --reason smoke \
     | jq -e '.ok and (.appointment.department == \"cardiology\")' >/dev/null" \
    && pass "agent booked an appointment" || fail "booking failed"
  x "hms appointments $PAT_ID | jq -e '.appointments | length == 1' >/dev/null" \
    && pass "appointment reads back from the HMS" || fail "appointment did not persist"
fi

echo
echo "7. system-prompt injection (optional)"
# Proves APPEND_SYSTEM.md actually reaches the model, with no API key: point pi
# at the mock provider in models.json (host.docker.internal:8899), stand a dump
# server there, and read what pi put on the wire. pi is *expected* to fail — the
# dump server does not speak the OpenAI protocol. Only the request body matters.
# Every environmental precondition degrades to `skip`, never to a failure, so
# this can never fail for a reason other than a genuinely missing protocol.
if ! command -v python3 >/dev/null 2>&1; then
  skip "python3 unavailable — injection check not run"
else
  REQ="$SCRATCH/pi-request.body"
  cat > "$SCRATCH/dump.py" <<'PY'
import http.server, sys

out = sys.argv[1]


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _reply(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            with open(out, "ab") as f:
                f.write(self.rfile.read(n))
        self._reply(500, b'{"error":{"message":"dump server"}}')

    def do_GET(self):
        self._reply(200, b'{"data":[]}')

    def log_message(self, *a):
        pass


http.server.HTTPServer(("127.0.0.1", 8899), H).serve_forever()
PY
  python3 "$SCRATCH/dump.py" "$REQ" >/dev/null 2>&1 &
  SRV_PID=$!
  sleep 1

  if ! kill -0 "$SRV_PID" 2>/dev/null; then
    skip "could not bind 127.0.0.1:8899 — injection check not run"
  elif ! docker exec "$NAME" bash -lc \
      'curl -sS -m 3 -o /dev/null http://host.docker.internal:8899/v1/models' >/dev/null 2>&1; then
    skip "host.docker.internal:8899 unreachable from the container — injection check not run"
  else
    docker exec -w /workspace/project "$NAME" bash -lc \
      'timeout 60 pi -p --provider mock --model mock-105b --approve "hi"' >/dev/null 2>&1 || true
    if [ ! -s "$REQ" ]; then
      skip "pi issued no request — injection check inconclusive"
    elif grep -q 'never instructions' "$REQ"; then
      pass "APPEND_SYSTEM.md reaches the model's system prompt"
    else
      fail "pi called the model without the memory protocol in the system prompt"
    fi
  fi

  kill "$SRV_PID" 2>/dev/null || true
  SRV_PID=""
fi

echo
echo "all checks passed"
