# syntax=docker/dockerfile:1.7
#
# Sandbox image for the WhatsApp agent platform.
#
# Why this exists: the agent writes and executes its own `bash` commands to
# drive `pm`. That is the whole point of the design, and it is also the reason
# none of it may touch the host. This image is the security boundary.
#
# Everything mutable lives under /workspace, which is a bind mount of one
# session's directory. The image itself is immutable and can be run with
# --read-only. See README.md for the hardened `docker run` flags.

##############################  stage 1 — pm  ##############################
# pm has no published releases and its module path (polymetrics.ai) has no DNS
# A record, so neither `go install` nor the release-binary path in the docs
# works. Building from source is the only route.
FROM golang:1.26-bookworm AS pm-build

ARG PM_REPO=https://github.com/polymetrics-ai/cli
ARG PM_REF=main

WORKDIR /src
RUN git clone --depth 1 "${PM_REPO}" . \
 && if [ "${PM_REF}" != "main" ]; then \
      git fetch --depth 1 origin "${PM_REF}" \
      && git checkout --detach FETCH_HEAD; \
    fi \
 && git rev-parse HEAD > /pm-commit

# CGO_ENABLED=0 selects the pure-Go JSONL warehouse instead of DuckDB. That is
# deliberate, not a compromise: warehouse tables become plain .jsonl files, so
# the agent can stage a record by writing a file. No C toolchain, static binary.
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pm ./cmd/pm

# Metadata-only: reads connector manifests, never the vault or the network.
RUN /out/pm skills generate --dir /out/pm-skills

###########################  stage 2 — agent image  ########################
FROM node:24-bookworm-slim

ARG PI_VERSION=0.82.1

# jq matters more than it looks: the agent parses pm's --json envelopes with it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git jq ripgrep tini \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
 && npm cache clean --force

COPY --from=pm-build /out/pm        /usr/local/bin/pm
COPY --from=pm-build /out/pm-skills /opt/pm/skills
COPY --from=pm-build /pm-commit     /opt/pm/commit

COPY models.json   /opt/sandbox/models.json
COPY skills/       /opt/sandbox/skills/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# The memory system. append-system.md is the protocol the agent is always told
# about; memory-template.md is the empty shape of a person's memory file, which
# the entrypoint copies into a session only once. Baked in, so a session cannot
# lose or corrupt them — a fresh container start always restores the protocol.
COPY append-system.md   /opt/sandbox/append-system.md
COPY memory-template.md /opt/sandbox/memory-template.md

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && useradd --uid 10001 --create-home --shell /bin/bash agent \
 && mkdir -p /workspace \
 && chown agent:agent /workspace

# Pi state lives in the mounted workspace, not $HOME, so the root filesystem can
# stay read-only and each session's agent state is self-contained and disposable.
ENV PI_CODING_AGENT_DIR=/workspace/.pi \
    PI_TELEMETRY=0 \
    PI_SKIP_VERSION_CHECK=1 \
    PM_PROJECT_DIR=/workspace/project \
    PM_SKILLS_DIR=/opt/pm/skills \
    HOME=/home/agent

USER agent
WORKDIR /workspace

# tini reaps the processes the agent spawns; without it a runaway `pm` would
# linger as a zombie for the container's lifetime.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]
