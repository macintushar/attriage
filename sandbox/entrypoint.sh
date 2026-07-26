#!/usr/bin/env bash
# Seeds a session workspace, then hands off. Idempotent: the backend starts the
# container once per session and then `docker exec`s a `pi` run per turn, so
# this must be safe to re-run against an already-populated workspace.
set -euo pipefail

PI_DIR="${PI_CODING_AGENT_DIR:-/workspace/.pi}"
PROJECT_DIR="${PM_PROJECT_DIR:-/workspace/project}"

mkdir -p "$PI_DIR/sessions" "$PROJECT_DIR" /workspace/staging /workspace/skills

# Pi's Sarvam provider config. Copied rather than symlinked so a session can be
# inspected or hand-edited without mutating the image.
if [ ! -f "$PI_DIR/models.json" ]; then
  cp /opt/sandbox/models.json "$PI_DIR/models.json"
fi

# Agent-facing docs: our workflow guide plus pm's generated per-connector skills.
# Ours are overwritten, not preserved (`-r`, not `-rn`): they are authored in the
# image and never edited per session, so a stale workspace copy from an older
# image is always wrong. With -n a fixed skill would never reach an existing
# session — the guidance would look updated and silently not be.
cp -r /opt/sandbox/skills/. /workspace/skills/ 2>/dev/null || true
if [ ! -e /workspace/skills/pm-connectors ]; then
  cp -r /opt/pm/skills/. /workspace/skills/ 2>/dev/null || true
fi

# One pm project per session. `pm init` is not idempotent, so guard on the dir.
if [ ! -d "$PROJECT_DIR/.polymetrics" ]; then
  ( cd "$PROJECT_DIR" && pm init >/dev/null )
fi

exec "$@"
