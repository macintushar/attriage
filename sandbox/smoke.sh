#!/usr/bin/env bash
# End-to-end check of the sandbox image.
#
# Credential-free: validates the image and the complete local pm write path.
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="${SANDBOX_IMAGE:-sarvam-sandbox:latest}"
WORK="$(mktemp -d)"
NAME="sandbox-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }

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

echo "1. image contents"
x 'command -v pm >/dev/null'   && pass "pm on PATH"        || fail "pm missing"
x 'command -v pi >/dev/null'   && pass "pi on PATH"        || fail "pi missing"
x 'command -v jq >/dev/null'   && pass "jq on PATH"        || fail "jq missing"
[ "$(x 'id -u')" = "10001" ]   && pass "runs as non-root"  || fail "not running as uid 10001"
x 'touch /etc/nope 2>/dev/null' && fail "root fs is writable" || pass "root fs read-only"

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
echo "all checks passed"
