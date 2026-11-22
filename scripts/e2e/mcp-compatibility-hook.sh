#!/usr/bin/env bash
# P1-53 Task 5 — Bash 3.2-safe wrapper for MCP upgrade compatibility hooks.
#
# Called after Compose health or K8s acceptance tools/list. Never auto-rollbacks
# production. Feature flag LUCY_MCP_COMPAT=1; default off → exit 3 (SKIPPED).
# Missing baseline/env when enabled → exit 2 (BLOCKED), never fake PASS.
#
# Usage:
#   bash scripts/e2e/mcp-compatibility-hook.sh plan|run|release-gate [options...]
#   bash scripts/e2e/mcp-compatibility-hook.sh run --lane compose
#   bash scripts/e2e/mcp-compatibility-hook.sh run --lane instance --rollback-occurred
#
# Exit: 0 pass, 1 fail, 2 blocked, 3 skipped (matches Spec §8.2 / EXIT_CODES).
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HOOK_JS="${SCRIPT_DIR}/mcp-compatibility-hook.mjs"

if [[ ! -f "${HOOK_JS}" ]]; then
  echo "mcp-compatibility-hook: missing ${HOOK_JS}" >&2
  exit 2
fi

# bash 3.2: no mapfile/readarray; forward "$@" as-is.
exec node "${HOOK_JS}" "$@"
