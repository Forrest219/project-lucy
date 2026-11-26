#!/usr/bin/env bash
# Shared PostToolUse (Edit|Write) fast static check for Claude Code & Codex CLI.
# Compatible with stock macOS bash 3.2 under UTF-8 locales (uses ${file_path}).

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v jq >/dev/null 2>&1; then
  echo "[agent-post-edit-check] info: jq not installed; skipping hook." >&2
  exit 0
fi

file_path="$(jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -z "${file_path}" ] && exit 0
[ ! -f "${file_path}" ] && exit 0

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${REPO_ROOT}" || exit 0

emit_msg() {
  jq -n --arg msg "$1" '{systemMessage: $msg}'
}

case "${file_path}" in
  *.test.ts|*.test.tsx|*.test.mjs|*.test.js|*.spec.ts|*.spec.tsx|*.spec.mjs)
    if ! out="$(node scripts/lint/skip-ledger-id-gate.mjs --root "${file_path}" 2>&1)"; then
      emit_msg "❌ lint:skip-ledger 未通过（${file_path}）：${out}"
    fi
    ;;
  */webui/src/*.tsx)
    if ! out="$(node webui/scripts/lint-url-driven-input.mjs 2>&1)"; then
      emit_msg "❌ lint:url-driven-input 未通过：${out}"
    fi
    ;;
  */webui/server/*.ts)
    if ! out="$(node scripts/lint/server-sync-io-gate.mjs 2>&1)"; then
      emit_msg "❌ lint:server-sync-io 未通过：${out}"
    fi
    ;;
  */.github/*)
    ;;
  *.yaml|*.yml)
    if ! out="$(node scripts/lint/yaml-alias-gate.mjs --root "${file_path}" 2>&1)"; then
      emit_msg "❌ lint:yaml-alias 未通过（${file_path}）：${out}"
    fi
    ;;
esac

exit 0
