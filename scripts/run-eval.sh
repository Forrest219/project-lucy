#!/usr/bin/env bash
# scripts/run-eval.sh — bash wrapper for the project-lucy eval runner (P3-A · T-A.7).
# Agent adapter is selected via --adapter or EVAL_AGENT_ADAPTER (see scripts/eval-runner.mjs).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

exec node "${REPO_ROOT}/scripts/eval-runner.mjs" "$@"
