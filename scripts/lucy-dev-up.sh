#!/usr/bin/env bash
# scripts/lucy-dev-up.sh — auto-detect host arch and start Lucy for dev.
#
# Why this exists:
#   docker-compose.yml defaults to TARGETPLATFORM=linux/amd64 (customer
#   baseline). On Apple Silicon (linux/arm64) hosts, building amd64 falls
#   back to QEMU emulation, which segfaults on the native uv binary that
#   ktx downloads during `ktx admin runtime install` (exit 139).
#
#   This script detects the host arch via `uname -m` and forwards to
#   docker compose with the matching TARGETPLATFORM / TARGETARCH. Dev
#   builds stay native → fast + reliable.
#
# Usage:
#   scripts/lucy-dev-up.sh                  # build + up (default: customer compose)
#   scripts/lucy-dev-up.sh up               # up only (no rebuild)
#   scripts/lucy-dev-up.sh down             # down (keep volume)
#   scripts/lucy-dev-up.sh down -v          # down + delete lucy-data volume
#   scripts/lucy-dev-up.sh logs -f lucy     # tail logs
#   scripts/lucy-dev-up.sh ps               # compose ps
#   scripts/lucy-dev-up.sh exec lucy bash   # shell into running lucy
#
# Flags (passed through to docker compose):
#   -f, --file FILE   Override compose file (default: docker-compose.yml)
#
# Env overrides (rarely needed):
#   TARGETPLATFORM=linux/amd64  scripts/lucy-dev-up.sh     # force amd64 (slow on arm64)
#   TARGETARCH=amd64            scripts/lucy-dev-up.sh
#   UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
#     scripts/lucy-dev-up.sh up -d --build                  # PyPI mirror if pypi is blocked
#
# Notes:
#   - Customer builds in customer networks are unaffected: their compose
#     file's TARGETPLATFORM default (linux/amd64) still applies.
#   - For production / cross-arch verification, use the explicit override
#     above (QEMU emulation will be slow but accurate).
#   - This is the dev path; for an in-place upgrade preserving /data/lucy,
#     use scripts/upgrade-lucy.sh instead.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEFAULT_COMPOSE_FILE="docker-compose.yml"

usage() {
  cat <<EOF
Usage: $(basename "$0") [docker-compose-args...]

Auto-detects host arch (arm64 / amd64) and starts Lucy via docker compose.
Defaults to '${DEFAULT_COMPOSE_FILE}'. All remaining args pass through.

Common invocations:
  $(basename "$0")                  # build + up -d
  $(basename "$0") up -d --build    # explicit build
  $(basename "$0") down
  $(basename "$0") logs -f lucy
  $(basename "$0") -f docker-compose.demo.yml up -d --build
EOF
}

# Allow --help / -h anywhere in argv.
for arg in "$@"; do
  case "${arg}" in
    -h|--help) usage; exit 0 ;;
  esac
done

# Detect host arch only when the caller didn't override.
if [[ -z "${TARGETPLATFORM:-}" || -z "${TARGETARCH:-}" ]]; then
  case "$(uname -m)" in
    arm64|aarch64)
      TARGETARCH="${TARGETARCH:-arm64}"
      TARGETPLATFORM="${TARGETPLATFORM:-linux/arm64}"
      ;;
    x86_64|amd64)
      TARGETARCH="${TARGETARCH:-amd64}"
      TARGETPLATFORM="${TARGETPLATFORM:-linux/amd64}"
      ;;
    *)
      echo "error: unsupported host architecture: $(uname -m)" >&2
      echo "       set TARGETPLATFORM / TARGETARCH explicitly to override" >&2
      exit 1
      ;;
  esac
fi

export TARGETPLATFORM TARGETARCH

# Pick default compose file only if the caller didn't pass -f/--file.
HAS_COMPOSE_FILE=0
for arg in "$@"; do
  case "${arg}" in
    -f|--file) HAS_COMPOSE_FILE=1; break ;;
  esac
done

COMPOSE_ARGS=()
if [[ "${HAS_COMPOSE_FILE}" -eq 0 ]]; then
  COMPOSE_ARGS=(-f "${DEFAULT_COMPOSE_FILE}")
fi

echo ">> host=$(uname -m)  TARGETPLATFORM=${TARGETPLATFORM}  TARGETARCH=${TARGETARCH}"
echo ">> docker compose ${COMPOSE_ARGS[*]:-} $*"

exec docker compose "${COMPOSE_ARGS[@]}" "$@"
