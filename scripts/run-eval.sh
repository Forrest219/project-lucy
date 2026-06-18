#!/usr/bin/env bash
# scripts/run-eval.sh — bash wrapper for the project-lucy eval runner (P3-A · T-A.7).
# Fail-fast on missing claude CLI; forward all args to eval-runner.mjs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if ! command -v claude >/dev/null 2>&1; then
  echo "error: 'claude' CLI not found in PATH. Install Claude Code first." >&2
  echo "       See https://docs.claude.com/claude-code for install steps." >&2
  exit 2
fi

if ! claude auth status >/dev/null 2>&1; then
  echo "error: 'claude auth status' failed. Please run \`claude login\` first." >&2
  exit 2
fi

exec node "${REPO_ROOT}/scripts/eval-runner.mjs" "$@"
