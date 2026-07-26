#!/usr/bin/env bash
# Seeds a session workspace, then hands off. Idempotent: the backend starts the
# container once per session and then `docker exec`s a `pi` run per turn, so
# this must be safe to re-run against an already-populated workspace.
set -euo pipefail

PI_DIR="${PI_CODING_AGENT_DIR:-/workspace/.pi}"
PROJECT_DIR="${PM_PROJECT_DIR:-/workspace/project}"

mkdir -p "$PI_DIR/sessions" "$PROJECT_DIR" /workspace/staging /workspace/skills \
         /workspace/memory

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

# The memory protocol, appended to Pi's system prompt on every turn. Same
# reasoning as the skills copy above: image-authored, never edited per session,
# so overwriting is what self-heals a stale or mangled copy. Unlike the skills
# copies this is not best-effort — no `|| true`. A session running without the
# protocol would look fine and quietly never remember anything, so if the file
# is missing the container should fail loudly at start rather than at turn 50.
cp /opt/sandbox/append-system.md "$PI_DIR/APPEND_SYSTEM.md"

# Pi auto-discovers skills under its own dir, so placing the remembering skill
# here means no --skill flag to add on the backend's `docker exec` line.
mkdir -p "$PI_DIR/skills"
cp /opt/sandbox/skills/remembering.md "$PI_DIR/skills/remembering.md"

# Preserved, not overwritten — the one file here that is genuinely the session's
# own. It holds what the agent has learned about the person, so re-seeding it on
# a container restart would be amnesia. The template only ever fills a blank.
[ -f /workspace/memory/MEMORY.md ] \
  || cp /opt/sandbox/memory-template.md /workspace/memory/MEMORY.md

# One pm project per session. `pm init` is not idempotent, so guard on the dir.
if [ ! -d "$PROJECT_DIR/.polymetrics" ]; then
  ( cd "$PROJECT_DIR" && pm init >/dev/null )
fi

exec "$@"
