#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${LUCY_APP_ROOT:-/app}"
PROJECT_ROOT="${KTX_PROJECT_ROOT:-/data/lucy}"
WEBUI_ROOT="${LUCY_WEBUI_ROOT:-${APP_ROOT}/webui}"
TEMPLATE_ROOT="${LUCY_TEMPLATE_ROOT:-${APP_ROOT}/project-template}"

KTX_MCP_HOST="${KTX_MCP_HOST:-127.0.0.1}"
KTX_MCP_PORT="${KTX_MCP_PORT:-7878}"
LUCY_PROXY_UPSTREAM_HOST="${LUCY_PROXY_UPSTREAM_HOST:-127.0.0.1}"
LUCY_PROXY_UPSTREAM_PORT="${LUCY_PROXY_UPSTREAM_PORT:-${KTX_MCP_PORT}}"

if [[ -z "${KTX_INTERNAL_TOKEN:-}" ]]; then
  KTX_INTERNAL_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
fi

export KTX_PROJECT_ROOT PROJECT_ROOT
export KTX_INTERNAL_TOKEN
export LUCY_PROXY_UPSTREAM_HOST LUCY_PROXY_UPSTREAM_PORT
export LUCY_WEBUI_HOST="${LUCY_WEBUI_HOST:-0.0.0.0}"
export LUCY_WEBUI_PORT="${LUCY_WEBUI_PORT:-5174}"
export LUCY_PROXY_HOST="${LUCY_PROXY_HOST:-0.0.0.0}"
export LUCY_PROXY_PORT="${LUCY_PROXY_PORT:-7879}"
export POSTHOG_DISABLED="${POSTHOG_DISABLED:-1}"

seed_project() {
  mkdir -p "${PROJECT_ROOT}"
  if [[ ! -f "${PROJECT_ROOT}/ktx.yaml" ]]; then
    echo "[lucy] seeding project files into ${PROJECT_ROOT}"
    cp -R "${TEMPLATE_ROOT}/." "${PROJECT_ROOT}/"
  fi
  mkdir -p "${PROJECT_ROOT}/.ktx/secrets" "${PROJECT_ROOT}/.ktx-ui"
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"
  for _ in $(seq 1 60); do
    if node -e '
      const net = require("net");
      const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
      socket.on("connect", () => { socket.end(); process.exit(0); });
      socket.on("error", () => process.exit(1));
      setTimeout(() => process.exit(1), 500);
    ' "${host}" "${port}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "[lucy] timed out waiting for ${label} on ${host}:${port}" >&2
  return 1
}

shutdown() {
  local status="${1:-0}"
  trap - TERM INT EXIT
  if [[ -n "${LUCY_PID:-}" ]]; then kill "${LUCY_PID}" >/dev/null 2>&1 || true; fi
  if [[ -n "${KTX_PID:-}" ]]; then kill "${KTX_PID}" >/dev/null 2>&1 || true; fi
  wait >/dev/null 2>&1 || true
  exit "${status}"
}

seed_project

if grep -q "<CHANGE-ME" "${PROJECT_ROOT}/ktx.yaml" 2>/dev/null; then
  echo "[lucy] warning: ${PROJECT_ROOT}/ktx.yaml still contains CHANGE-ME placeholders"
fi

echo "[lucy] bundled KTX: $(ktx --version)"
echo "[lucy] project root: ${PROJECT_ROOT}"

ktx mcp start \
  --project-dir "${PROJECT_ROOT}" \
  --host "${KTX_MCP_HOST}" \
  --port "${KTX_MCP_PORT}" \
  --token "${KTX_INTERNAL_TOKEN}" \
  --foreground &
KTX_PID="$!"

wait_for_port "${KTX_MCP_HOST}" "${KTX_MCP_PORT}" "KTX MCP upstream"

cd "${WEBUI_ROOT}"
npm run start &
LUCY_PID="$!"

trap 'shutdown 143' TERM INT
trap 'shutdown $?' EXIT

wait -n "${KTX_PID}" "${LUCY_PID}"
status="$?"
echo "[lucy] child process exited with status ${status}" >&2
shutdown "${status}"
