#!/usr/bin/env bash
# Customer entry point. Python stdlib only; never enable shell tracing around credentials.
set +x
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null 2>&1 || { echo '[customer-deploy] PYTHON3_REQUIRED' >&2; exit 1; }
exec python3 "${SCRIPT_DIR}/customer-deployment-helper.py" "$@"
