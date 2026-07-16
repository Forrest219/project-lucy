#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${LUCY_APP_ROOT:-/app}"
PROJECT_ROOT="${KTX_PROJECT_ROOT:-/data/lucy}"
WEBUI_ROOT="${LUCY_WEBUI_ROOT:-${APP_ROOT}/webui}"
TEMPLATE_ROOT="${LUCY_TEMPLATE_ROOT:-${APP_ROOT}/project-template}"
SEED_STATE_DIR="${PROJECT_ROOT}/.lucy-seed"

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

sync_template_tree() {
  local src="$1"
  local dest="$2"
  local label="$3"
  local copied=0
  local updated=0

  [[ -d "${src}" ]] || return 0
  mkdir -p "${dest}"

  while IFS= read -r -d '' file; do
    local rel="${file#${src}/}"
    local target="${dest}/${rel}"
    if [[ ! -e "${target}" ]]; then
      mkdir -p "$(dirname "${target}")"
      cp "${file}" "${target}"
      copied=$((copied + 1))
    elif ! cmp -s "${file}" "${target}"; then
      cp "${file}" "${target}"
      updated=$((updated + 1))
    fi
  done < <(find "${src}" -type f ! -name ".DS_Store" -print0)

  if [[ "${copied}" -gt 0 ]]; then
    echo "[lucy] synced ${copied} missing ${label} file(s) into ${dest}"
  fi
  if [[ "${updated}" -gt 0 ]]; then
    echo "[lucy] refreshed ${updated} changed ${label} file(s) in ${dest}"
  fi
}

sync_context_from_template() {
  sync_template_tree "${TEMPLATE_ROOT}/semantic-layer" "${PROJECT_ROOT}/semantic-layer" "semantic-layer"
  sync_template_tree "${TEMPLATE_ROOT}/wiki" "${PROJECT_ROOT}/wiki" "wiki"
  sync_template_tree "${TEMPLATE_ROOT}/skills" "${PROJECT_ROOT}/skills" "skills"
}

seed_project() {
  mkdir -p "${PROJECT_ROOT}"
  if [[ ! -f "${PROJECT_ROOT}/ktx.yaml" ]]; then
    echo "[lucy] seeding project files into ${PROJECT_ROOT}"
    cp -R "${TEMPLATE_ROOT}/." "${PROJECT_ROOT}/"
  fi
  sync_context_from_template
  mkdir -p "${PROJECT_ROOT}/.ktx/secrets" "${PROJECT_ROOT}/.ktx-ui" "${SEED_STATE_DIR}"
  printf "%s\n" "${LUCY_BUNDLED_KTX_VERSION:-unknown}" > "${SEED_STATE_DIR}/bundled-ktx-version"
}

count_files() {
  local root="$1"
  local pattern="$2"
  [[ -d "${root}" ]] || {
    echo "0"
    return 0
  }
  find "${root}" -type f -name "${pattern}" ! -name ".DS_Store" | wc -l | tr -d " "
}

validate_project_context() {
  local semantic_count
  local schema_count
  semantic_count="$(count_files "${PROJECT_ROOT}/semantic-layer" "*.yaml")"

  if [[ -d "${PROJECT_ROOT}/semantic-layer" ]]; then
    schema_count="$(find "${PROJECT_ROOT}/semantic-layer" -path "*/_schema/*.yaml" -type f ! -name ".DS_Store" | wc -l | tr -d " ")"
  else
    schema_count="0"
  fi

  if [[ "${semantic_count}" -eq 0 ]]; then
    echo "[lucy] fatal: ${PROJECT_ROOT}/semantic-layer has no YAML files; refusing to start with an empty data context" >&2
    return 1
  fi

  if [[ "${schema_count}" -eq 0 ]]; then
    echo "[lucy] fatal: ${PROJECT_ROOT}/semantic-layer has no _schema YAML files; refusing to start with no visible data sources" >&2
    return 1
  fi

  if grep -q "<CHANGE-ME\\|CHANGE-ME" "${PROJECT_ROOT}/ktx.yaml" 2>/dev/null; then
    if [[ "${LUCY_ALLOW_PLACEHOLDER_KTX:-0}" == "1" ]]; then
      echo "[lucy] warning: ${PROJECT_ROOT}/ktx.yaml still contains CHANGE-ME placeholders"
    else
      echo "[lucy] fatal: ${PROJECT_ROOT}/ktx.yaml contains CHANGE-ME placeholders; set LUCY_ALLOW_PLACEHOLDER_KTX=1 only for template-only demos" >&2
      return 1
    fi
  fi
}

maybe_reindex_context() {
  if [[ "${LUCY_AUTO_REINDEX:-1}" != "1" ]]; then
    return 0
  fi

  echo "[lucy] refreshing KTX semantic index"
  if ! ktx --project-dir "${PROJECT_ROOT}" admin reindex >/tmp/lucy-reindex.log 2>&1; then
    echo "[lucy] warning: KTX reindex failed; continuing startup" >&2
    sed -n '1,80p' /tmp/lucy-reindex.log >&2 || true
  fi
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
validate_project_context

if [[ "${LUCY_ENTRYPOINT_SEED_ONLY:-0}" == "1" ]]; then
  echo "[lucy] seed-only mode complete"
  exit 0
fi

maybe_reindex_context

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
