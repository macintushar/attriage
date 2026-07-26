#!/usr/bin/env bash
# Build the agent sandbox image.
#   ./build.sh                 # build :latest
#   PM_REF=<sha> ./build.sh    # pin pm to a commit
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="${SANDBOX_IMAGE:-sarvam-sandbox:latest}"
PM_REF="${PM_REF:-main}"
PI_VERSION="${PI_VERSION:-0.82.1}"

echo "building ${IMAGE}  (pm ref: ${PM_REF}, pi: ${PI_VERSION})"

docker build \
  --build-arg "PM_REF=${PM_REF}" \
  --build-arg "PI_VERSION=${PI_VERSION}" \
  -t "${IMAGE}" \
  .

echo
echo "built ${IMAGE}"
docker run --rm --entrypoint sh "${IMAGE}" -c \
  'echo "  pm:     $(pm version | head -1)  ($(cat /opt/pm/commit | cut -c1-12))"; echo "  pi:     $(pi --version)"; echo "  node:   $(node --version)"'
