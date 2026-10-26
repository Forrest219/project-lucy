#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${LUCY_APP_ROOT:-/app}"
PROJECT_ROOT="${KTX_PROJECT_ROOT:-/data/lucy}"
WEBUI_ROOT="${LUCY_WEBUI_ROOT:-${APP_ROOT}/webui}"
TEMPLATE_ROOT="${LUCY_TEMPLATE_ROOT:-${APP_ROOT}/project-template}"
SEED_STATE_DIR="${PROJECT_ROOT}/.lucy-seed"

# V-01 (T0A-2) — deployment-mode preflight. Runs before any filesystem work so a
# customer-mode container can never come up with the WebUI auth switched off.
# Default mode is customer; invalid values and customer+LUCY_WEBUI_AUTH=off are fatal.
preflight_deployment_mode() {
  local mode auth pinned cookie profile access
  mode="$(printf '%s' "${LUCY_DEPLOYMENT_MODE:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  auth="$(printf '%s' "${LUCY_WEBUI_AUTH:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  pinned="$(printf '%s' "${LUCY_CHART_DEPLOYMENT_MODE:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  cookie="$(printf '%s' "${LUCY_WEBUI_COOKIE_SECURE:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  profile="$(printf '%s' "${LUCY_WEBUI_TEST_PROFILE:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  access="$(printf '%s' "${LUCY_WEBUI_ACCESS:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ -n "${mode}" ]] || mode="customer"
  case "${mode}" in
    customer|development) ;;
    *)
      echo "[lucy] fatal: invalid LUCY_DEPLOYMENT_MODE='${LUCY_DEPLOYMENT_MODE}'; expected customer or development" >&2
      exit 1
      ;;
  esac
  # T02: the Chart pins its mode in LUCY_CHART_DEPLOYMENT_MODE; an override that
  # lands in LUCY_DEPLOYMENT_MODE (e.g. via extraEnvFrom) must not relax it.
  if [[ -n "${pinned}" && "${pinned}" != "${mode}" ]]; then
    echo "[lucy] fatal: LUCY_DEPLOYMENT_MODE=${mode} contradicts the Chart-pinned mode ${pinned}; remove the override (for example from extraEnvFrom)" >&2
    exit 1
  fi
  if [[ "${mode}" == "customer" && "${auth}" == "off" ]]; then
    echo "[lucy] fatal: LUCY_WEBUI_AUTH=off is not allowed when LUCY_DEPLOYMENT_MODE=customer (default); refusing to start" >&2
    exit 1
  fi
  # Customer HTTPS keeps Secure cookies. Intranet HTTP is LUCY_WEBUI_ACCESS=http.
  # The lab test profile remains LUCY_WEBUI_TEST_PROFILE=1 and must not be combined with it.
  case "${access}" in
    ""|http|https) ;;
    *)
      echo "[lucy] fatal: invalid LUCY_WEBUI_ACCESS='${LUCY_WEBUI_ACCESS}'; expected http or https" >&2
      exit 1
      ;;
  esac
  if [[ "${mode}" == "customer" && "${access}" == "http" && ( "${profile}" == "1" || "${profile}" == "true" ) ]]; then
    echo "[lucy] fatal: LUCY_WEBUI_ACCESS=http cannot be combined with LUCY_WEBUI_TEST_PROFILE; refusing to start" >&2
    exit 1
  fi
  if [[ "${mode}" == "customer" && "${access}" == "http" && ( "${cookie}" == "1" || "${cookie}" == "true" ) ]]; then
    echo "[lucy] fatal: LUCY_WEBUI_COOKIE_SECURE=1 contradicts LUCY_WEBUI_ACCESS=http; refusing to start" >&2
    exit 1
  fi
  if [[ "${mode}" == "customer" && "${access}" != "http" && ( "${cookie}" == "0" || "${cookie}" == "false" ) && "${profile}" != "1" && "${profile}" != "true" ]]; then
    echo "[lucy] fatal: LUCY_WEBUI_COOKIE_SECURE=0 is not allowed when LUCY_DEPLOYMENT_MODE=customer (default); set LUCY_WEBUI_ACCESS=http for intranet HTTP, or LUCY_WEBUI_TEST_PROFILE=1 for a lab test profile; refusing to start" >&2
    exit 1
  fi
}
preflight_deployment_mode

# A2 — Configurable Content Root.
# Resolves the directory that holds semantic-layer/, wiki/, evals/, skills/.
# Defaults to <PROJECT_ROOT>/config/ (the M31 layout). Legacy deployments keep
# these dirs as project-root siblings by setting LUCY_CONTENT_ROOT=".".
# Empty / unset → default config/. The ktx-required sibling view still lives
# under <PROJECT_ROOT>/runtime/ and is populated by sync_runtime_mirror below.
CONTENT_ROOT=""
if [[ -n "${LUCY_CONTENT_ROOT:-}" ]]; then
  CONTENT_ROOT="${LUCY_CONTENT_ROOT}"
else
  CONTENT_ROOT="./config"
fi
mkdir -p "${PROJECT_ROOT}"
if [[ "${CONTENT_ROOT}" = /* ]]; then
  mkdir -p "${CONTENT_ROOT}"
  CONTENT_ROOT_ABS="$(cd "${CONTENT_ROOT}" && pwd -P)"
else
  mkdir -p "${PROJECT_ROOT}/${CONTENT_ROOT}"
  CONTENT_ROOT_ABS="$(cd "${PROJECT_ROOT}" && cd "${CONTENT_ROOT}" && pwd -P)"
fi
export LUCY_CONTENT_ROOT="${CONTENT_ROOT_ABS}"

KTX_MCP_HOST="${KTX_MCP_HOST:-127.0.0.1}"
KTX_MCP_PORT="${KTX_MCP_PORT:-7878}"
LUCY_PROXY_UPSTREAM_HOST="${LUCY_PROXY_UPSTREAM_HOST:-127.0.0.1}"
LUCY_PROXY_UPSTREAM_PORT="${LUCY_PROXY_UPSTREAM_PORT:-${KTX_MCP_PORT}}"

export KTX_PROJECT_ROOT="${KTX_PROJECT_ROOT:-${PROJECT_ROOT}}"
PROJECT_ROOT="${KTX_PROJECT_ROOT}"
export LUCY_PROXY_UPSTREAM_HOST LUCY_PROXY_UPSTREAM_PORT
export LUCY_WEBUI_HOST="${LUCY_WEBUI_HOST:-0.0.0.0}"
export LUCY_WEBUI_PORT="${LUCY_WEBUI_PORT:-5174}"
export LUCY_PROXY_HOST="${LUCY_PROXY_HOST:-0.0.0.0}"
export LUCY_PROXY_PORT="${LUCY_PROXY_PORT:-7879}"
export POSTHOG_DISABLED="${POSTHOG_DISABLED:-1}"

# ─── Spec 191 §4/§9: KTX supervisor and the execution-runtime reload channel ───
#
# The WebUI writes ktx.yaml, but `ktx mcp start` parses the config once at
# startup and never re-reads it. Spec 191 lets the owner reload the execution
# layer by restarting ONLY the KTX daemon — no Pod, container or WebUI restart.
#
# The channel is a single-file request/receipt pair under <projectRoot>/.ktx-ui:
#   ktx-reload.capability  supervisor publishes it (protocol + heartbeat)
#   ktx-reload.request     Node writes one reload request
#   ktx-reload.result      supervisor writes the matching receipt
#   ktx.pid                the current KTX daemon pid (diagnostics + cleanup)
#   ktx-supervisor.pid     the supervisor pid (diagnostics + cleanup)
KTX_UI_DIR="${PROJECT_ROOT}/.ktx-ui"
KTX_PID_FILE="${KTX_UI_DIR}/ktx.pid"
KTX_SUPERVISOR_PID_FILE="${KTX_UI_DIR}/ktx-supervisor.pid"
KTX_RELOAD_REQUEST_FILE="${KTX_UI_DIR}/ktx-reload.request"
KTX_RELOAD_RESULT_FILE="${KTX_UI_DIR}/ktx-reload.result"
KTX_RELOAD_CAPABILITY_FILE="${KTX_UI_DIR}/ktx-reload.capability"
KTX_READY_FILE="${KTX_UI_DIR}/ktx-ready"
KTX_RELOAD_PROTOCOL="lucy-ktx-reload/1"
# Poll interval is 0.2s, so 25 ticks ≈ 5s between capability heartbeats.
KTX_RELOAD_HEARTBEAT_TICKS="${LUCY_KTX_RELOAD_HEARTBEAT_TICKS:-25}"
# Backoff between failed starts: 1s → 2s → 4s → 8s → 16s, then give up.
KTX_RELOAD_BACKOFF_LIMIT="${LUCY_KTX_RELOAD_BACKOFF_LIMIT:-5}"
KTX_RELOAD_BACKOFF_MAX_S="${LUCY_KTX_RELOAD_BACKOFF_MAX_S:-16}"
KTX_RELOAD_STOP_TIMEOUT_S="${LUCY_KTX_RELOAD_STOP_TIMEOUT_S:-10}"

sync_template_tree() {
  local src="$1"
  local dest="$2"
  local label="$3"
  local copied=0
  local skipped=0

  [[ -d "${src}" ]] || return 0
  mkdir -p "${dest}"

  # Customer-owned files must not be overwritten on upgrade (F-06).
  # Only copy missing paths; bundled seed upgrades require an explicit migrate path.
  while IFS= read -r -d '' file; do
    local rel="${file#${src}/}"
    local target="${dest}/${rel}"
    if [[ ! -e "${target}" ]]; then
      mkdir -p "$(dirname "${target}")"
      cp "${file}" "${target}"
      copied=$((copied + 1))
    else
      skipped=$((skipped + 1))
    fi
  done < <(find "${src}" -type f ! -name ".DS_Store" -print0)

  if [[ "${copied}" -gt 0 ]]; then
    echo "[lucy] synced ${copied} missing ${label} file(s) into ${dest}"
  fi
  if [[ "${skipped}" -gt 0 ]]; then
    echo "[lucy] preserved ${skipped} existing ${label} file(s) in ${dest}"
  fi
}

sync_context_from_template() {
  if [[ "${LUCY_DISABLE_TEMPLATE_SYNC:-0}" == "1" ]]; then
    echo "[lucy] template sync disabled (LUCY_DISABLE_TEMPLATE_SYNC=1)"
    return 0
  fi
  # A2: seed into the configured content root (default <PROJECT_ROOT>/config/).
  # The ktx-required sibling view lives under <PROJECT_ROOT>/runtime/ and is
  # populated by sync_runtime_mirror so ktx — which expects siblings of
  # ktx.yaml — keeps working without code changes.
  sync_template_tree "${TEMPLATE_ROOT}/semantic-layer" "${CONTENT_ROOT_ABS}/semantic-layer" "semantic-layer (config)"
  sync_template_tree "${TEMPLATE_ROOT}/wiki" "${CONTENT_ROOT_ABS}/wiki" "wiki (config)"
  sync_template_tree "${TEMPLATE_ROOT}/skills" "${CONTENT_ROOT_ABS}/skills" "skills (config)"
  sync_template_tree "${TEMPLATE_ROOT}/evals" "${CONTENT_ROOT_ABS}/evals" "evals (config)"
}

# A2 — ktx requires semantic-layer/wiki/evals/skills as siblings of ktx.yaml.
# After seeding into the configured content root, mirror the seed (and any
# customer-authored content the WebUI later writes there) into <runtime>/ so
# the ktx sibling view stays in sync. Idempotent — re-runs only copy missing
# files; customer edits to runtime/ are never overwritten.
sync_runtime_mirror() {
  if [[ "${LUCY_DISABLE_RUNTIME_MIRROR:-0}" == "1" ]]; then
    echo "[lucy] runtime mirror disabled (LUCY_DISABLE_RUNTIME_MIRROR=1)"
    return 0
  fi
  local mirror="${PROJECT_ROOT}/runtime"
  sync_template_tree "${CONTENT_ROOT_ABS}/semantic-layer" "${mirror}/semantic-layer" "runtime mirror semantic-layer"
  sync_template_tree "${CONTENT_ROOT_ABS}/wiki" "${mirror}/wiki" "runtime mirror wiki"
  sync_template_tree "${CONTENT_ROOT_ABS}/skills" "${mirror}/skills" "runtime mirror skills"
  sync_template_tree "${CONTENT_ROOT_ABS}/evals" "${mirror}/evals" "runtime mirror evals"
}

seed_project() {
  mkdir -p "${PROJECT_ROOT}"
  if [[ ! -f "${PROJECT_ROOT}/ktx.yaml" ]]; then
    echo "[lucy] seeding missing project files into ${PROJECT_ROOT}"
    # Missing paths only. An existing access.yaml / admins.yaml must keep its tokens.
    sync_template_tree "${TEMPLATE_ROOT}" "${PROJECT_ROOT}" "project"
  fi
  sync_context_from_template
  patch_demo_skill_tools
  patch_lucy_admin_tools
  mkdir -p "${PROJECT_ROOT}/.ktx/secrets" "${PROJECT_ROOT}/.ktx-ui" "${SEED_STATE_DIR}"
  printf "%s\n" "${LUCY_BUNDLED_KTX_VERSION:-unknown}" > "${SEED_STATE_DIR}/bundled-ktx-version"
}

# Reuse the volume-backed internal token across container recreate. Generating a
# new one on every start invalidates clients that were given this credential.
load_or_create_internal_token() {
  local token_file="${PROJECT_ROOT}/.ktx-ui/ktx-internal-token"
  if [[ -n "${KTX_INTERNAL_TOKEN:-}" ]]; then
    export KTX_INTERNAL_TOKEN
    return 0
  fi
  if [[ -f "${token_file}" ]]; then
    KTX_INTERNAL_TOKEN="$(tr -d '[:space:]' < "${token_file}")"
  fi
  if [[ -z "${KTX_INTERNAL_TOKEN:-}" ]]; then
    KTX_INTERNAL_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
    printf '%s\n' "${KTX_INTERNAL_TOKEN}" > "${token_file}"
    chmod 600 "${token_file}" || true
    echo "[lucy] created persistent KTX internal token"
  else
    echo "[lucy] reused persistent KTX internal token"
  fi
  export KTX_INTERNAL_TOKEN
}

# Spec 147 T7: smooth upgrade keeps an existing access.yaml. Idempotently add
# lucy_skill_read / lucy_skill_search under demo_readonly when running the demo template.
patch_demo_skill_tools() {
  case "${TEMPLATE_ROOT}" in
    */examples/docker-demo/project-template) ;;
    *) return 0 ;;
  esac
  local access_yaml="${PROJECT_ROOT}/webui/config/access.yaml"
  [[ -f "${access_yaml}" ]] || return 0
  node - "${access_yaml}" <<'JS'
const fs = require("fs");
const path = process.argv[2];
let text = fs.readFileSync(path, "utf8");
const tools = ["lucy_skill_read", "lucy_skill_search"];
const roleMarker = /^(\s*)demo_readonly:\s*$/m;
const match = roleMarker.exec(text);
if (!match) {
  process.exit(0);
}
const roleIndent = match[1] ?? "";
const roleStart = match.index;
const afterRole = text.slice(roleStart + match[0].length);
const nextRole = afterRole.search(new RegExp(`^${roleIndent}\\S`, "m"));
const roleBlockEnd = nextRole === -1 ? text.length : roleStart + match[0].length + nextRole;
let roleBlock = text.slice(roleStart, roleBlockEnd);
const toolsMatch = roleBlock.match(/^(\s*)tools:\s*$/m);
if (!toolsMatch) {
  process.exit(0);
}
const listIndent = `${toolsMatch[1]}  `;
let inserted = 0;
for (const tool of tools) {
  if (roleBlock.includes(`- ${tool}`)) continue;
  roleBlock = roleBlock.replace(/^(\s*tools:\s*\n)/m, `$1${listIndent}- ${tool}\n`);
  inserted += 1;
}
if (inserted === 0) process.exit(0);
const out = text.slice(0, roleStart) + roleBlock + text.slice(roleBlockEnd);
fs.writeFileSync(path, out);
console.log(`[lucy] patched demo_readonly tools (+${inserted}) in ${path}`);
JS
}

# Existing volumes keep access.yaml. Idempotently grant lucy_admin every
# non-denied MCP tool added after the role was first seeded.
patch_lucy_admin_tools() {
  case "${TEMPLATE_ROOT}" in
    */examples/docker-demo/project-template) ;;
    *) return 0 ;;
  esac
  local access_yaml="${PROJECT_ROOT}/webui/config/access.yaml"
  [[ -f "${access_yaml}" ]] || return 0
  node - "${access_yaml}" <<'JS'
const fs = require("fs");
const path = process.argv[2];
let text = fs.readFileSync(path, "utf8");
const tools = [
  "sl_validate",
  "lucy_skill_search",
  "lucy_skill_read",
  "lucy_certified_route",
  "lucy_report_template"
];
const roleMarker = /^(\s*)lucy_admin:\s*$/m;
const match = roleMarker.exec(text);
if (!match) process.exit(0);
const roleIndent = match[1] ?? "";
const roleStart = match.index;
const afterRole = text.slice(roleStart + match[0].length);
const nextRole = afterRole.search(new RegExp(`^${roleIndent}\\S`, "m"));
const roleBlockEnd = nextRole === -1 ? text.length : roleStart + match[0].length + nextRole;
let roleBlock = text.slice(roleStart, roleBlockEnd);
const toolsMatch = roleBlock.match(/^(\s*)tools:\s*$/m);
if (!toolsMatch) process.exit(0);
const listIndent = `${toolsMatch[1]}  `;
let inserted = 0;
for (const tool of tools) {
  if (roleBlock.includes(`- ${tool}`)) continue;
  roleBlock = roleBlock.replace(
    /^(\s*tools:\s*\n(?:[ \t]*-[ \t]+\S+[ \t]*\n)*)/m,
    `$1${listIndent}- ${tool}\n`
  );
  inserted += 1;
}
if (inserted === 0) process.exit(0);
const out = text.slice(0, roleStart) + roleBlock + text.slice(roleBlockEnd);
fs.writeFileSync(path, out);
console.log(`[lucy] patched lucy_admin tools (+${inserted}) in ${path}`);
JS
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
  # A2: validate the resolved content root, not the project root. The ktx
  # sibling view is at <runtime>/, but the *source of truth* the WebUI uses
  # lives under LUCY_CONTENT_ROOT (default <projectRoot>/config/). Checking
  # the resolved location catches empty templates even when runtime/ is
  # already populated by sync_runtime_mirror.
  local semantic_dir="${CONTENT_ROOT_ABS}/semantic-layer"
  semantic_count="$(count_files "${semantic_dir}" "*.yaml")"

  if [[ -d "${semantic_dir}" ]]; then
    schema_count="$(find "${semantic_dir}" -path "*/_schema/*.yaml" -type f ! -name ".DS_Store" | wc -l | tr -d " ")"
  else
    schema_count="0"
  fi

  if [[ "${semantic_count}" -eq 0 ]]; then
    echo "[lucy] fatal: ${semantic_dir} has no YAML files; refusing to start with an empty data context" >&2
    return 1
  fi

  if [[ "${schema_count}" -eq 0 ]]; then
    echo "[lucy] fatal: ${semantic_dir} has no _schema YAML files; refusing to start with no visible data sources" >&2
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

# ─── Spec 191 §4: supervisor primitives ──────────────────────────────────────

# Set to 1 by the TERM/INT trap so every blocking loop can bail out promptly.
KTX_SUPERVISOR_STOP=0
# The reload state published in the capability file: idle | reloading.
KTX_SUPERVISOR_STATE="idle"
# The request the supervisor is currently executing (empty when idle).
KTX_SUPERVISOR_REQUEST_ID=""
# The pid of the running KTX daemon, owned by the supervisor.
KTX_CHILD_PID=""
# The request currently being processed by the supervisor.
KTX_RELOAD_REQUEST_ID=""
KTX_RELOAD_REQUESTED_DIGEST=""

ktx_utc_now() {
  date -u +%Y-%m-%dT%H:%M:%S.000Z
}

# sha256 of a file as hex — must match the Node side (readKtxYamlDigest).
ktx_sha256() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    printf ''
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file}" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "${file}" | awk '{print $NF}'
  else
    printf ''
  fi
}

# Atomic publish: write to a temp file, then rename. The Node side must never
# observe a half-written request, receipt or capability file.
ktx_write_atomic() {
  local target="$1"
  local content="$2"
  local tmp="${target}.tmp.$$"
  printf '%s\n' "${content}" > "${tmp}" || return 1
  mv -f "${tmp}" "${target}"
}

# The supervisor's own pid. `$$` keeps the PARENT shell's pid inside a
# background subshell, so BASHPID is the only reliable source here.
ktx_supervisor_pid() {
  if [[ -n "${BASHPID:-}" ]]; then
    printf '%s' "${BASHPID}"
  else
    printf '%s' "$$"
  fi
}

# Publish the reload channel capability (Spec 191 §9.1 H1/H2).
# `state` tells the Node side whether the supervisor is currently executing a
# reload, so a timed-out request can check the REAL channel state (P7/P9)
# instead of assuming the channel is free.
ktx_write_capability() {
  local started_at="$1"
  local heartbeat_at
  heartbeat_at="$(ktx_utc_now)"
  ktx_write_atomic "${KTX_RELOAD_CAPABILITY_FILE}" \
    "$(printf '{"protocol":"%s","supervisorPid":%s,"startedAt":"%s","heartbeatAt":"%s","state":"%s","currentRequestId":"%s"}' \
      "${KTX_RELOAD_PROTOCOL}" "$(ktx_supervisor_pid)" "${started_at}" "${heartbeat_at}" \
      "${KTX_SUPERVISOR_STATE}" "${KTX_SUPERVISOR_REQUEST_ID}")" || true
}

# Revoke the capability file when the supervisor stops (Spec 191 §9.1 H3).
ktx_revoke_capability() {
  rm -f "${KTX_RELOAD_CAPABILITY_FILE}" >/dev/null 2>&1 || true
}

# Write the reload receipt (Spec 191 §6.2). The receipt carries the requestId
# it answers plus the digest actually read from disk (P4/P5).
ktx_write_reload_result() {
  local request_id="$1"
  local actual_digest="$2"
  local status="$3"
  local detail="${4:-}"
  local finished_at
  local tmp="${KTX_RELOAD_RESULT_FILE}.tmp.$$"
  finished_at="$(ktx_utc_now)"
  node -e '
const fs = require("fs");
const [file, requestId, actualDigest, status, detail, finishedAt] = process.argv.slice(1);
const payload = { requestId, actualDigest, status, finishedAt };
if (detail) payload.detail = detail;
fs.writeFileSync(file, JSON.stringify(payload) + "\n");
' "${tmp}" "${request_id}" "${actual_digest}" "${status}" "${detail}" "${finished_at}" >/dev/null 2>&1 || {
    rm -f "${tmp}" >/dev/null 2>&1 || true
    return 1
  }
  mv -f "${tmp}" "${KTX_RELOAD_RESULT_FILE}"
}

# Is the upstream MCP port accepting connections?
ktx_port_ready() {
  node -e '
    const net = require("net");
    const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
    socket.on("connect", () => { socket.end(); process.exit(0); });
    socket.on("error", () => process.exit(1));
    setTimeout(() => process.exit(1), 500);
  ' "${KTX_MCP_HOST}" "${KTX_MCP_PORT}" >/dev/null 2>&1
}

# Wait for the port, the daemon's early exit, or a shutdown request.
# Returns 0 only when the port is ready. The capability heartbeat is refreshed
# while waiting, so a slow start or a slow reload never looks like a dead
# supervisor.
ktx_wait_ready() {
  local pid="$1"
  local started_at="${2:-}"
  local waited=0
  local beats=0
  while [[ "${waited}" -lt 60 ]]; do
    if [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then return 1; fi
    if ! kill -0 "${pid}" >/dev/null 2>&1; then return 1; fi
    if ktx_port_ready; then return 0; fi
    waited=$((waited + 1))
    beats=$((beats + 1))
    if [[ -n "${started_at}" && "${beats}" -ge 5 ]]; then
      beats=0
      ktx_write_capability "${started_at}"
    fi
    sleep 1
  done
  echo "[lucy] timed out waiting for KTX MCP upstream on ${KTX_MCP_HOST}:${KTX_MCP_PORT}" >&2
  return 1
}

# Wait for the port to be released so the replacement daemon can rebind it.
ktx_wait_port_released() {
  local waited=0
  while [[ "${waited}" -lt 50 ]]; do
    if ! ktx_port_ready; then return 0; fi
    waited=$((waited + 1))
    sleep 0.2
  done
  return 1
}

# Stop a child and make sure it is really gone — no leftover daemon.
# `wait` reaps the child, so a zombie never looks "still alive" to the caller.
ktx_stop_child() {
  local pid="${1:-}"
  local killer
  [[ -n "${pid}" ]] || return 0
  kill -0 "${pid}" >/dev/null 2>&1 || {
    wait "${pid}" >/dev/null 2>&1 || true
    return 0
  }
  kill -TERM "${pid}" >/dev/null 2>&1 || true
  # Bounded wait: a watchdog escalates to SIGKILL if the child ignores TERM.
  ( sleep "${KTX_RELOAD_STOP_TIMEOUT_S}"; kill -KILL "${pid}" >/dev/null 2>&1 || true ) &
  killer="$!"
  wait "${pid}" >/dev/null 2>&1 || true
  kill -TERM "${killer}" >/dev/null 2>&1 || true
  wait "${killer}" >/dev/null 2>&1 || true
  return 0
}

# Consume the pending reload request, if any. The request file is RENAMED, so
# the supervisor takes it atomically and the Node side can never overwrite a
# request that is already being processed.
ktx_consume_reload_request() {
  local tmp="${KTX_RELOAD_REQUEST_FILE}.consume.$$"
  local parsed
  KTX_RELOAD_REQUEST_ID=""
  KTX_RELOAD_REQUESTED_DIGEST=""
  if ! mv -f "${KTX_RELOAD_REQUEST_FILE}" "${tmp}" >/dev/null 2>&1; then
    rm -f "${tmp}" >/dev/null 2>&1 || true
    return 0
  fi
  parsed="$(node -e '
const fs = require("fs");
const file = process.argv[1];
let doc = {};
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { doc = {}; }
process.stdout.write([String(doc.requestId ?? ""), String(doc.requestedDigest ?? "")].join("\u001f"));
' "${tmp}" 2>/dev/null || true)"
  rm -f "${tmp}" >/dev/null 2>&1 || true
  if [[ -z "${parsed}" ]]; then
    echo "[lucy] reload request file was not readable JSON; ignoring" >&2
    return 0
  fi
  IFS=$'\x1f' read -r KTX_RELOAD_REQUEST_ID KTX_RELOAD_REQUESTED_DIGEST <<< "${parsed}" || true
  if [[ -z "${KTX_RELOAD_REQUEST_ID}" ]]; then
    echo "[lucy] reload request had no requestId; ignoring" >&2
    return 0
  fi
  return 0
}

# Start the KTX daemon and record its pid.
ktx_start_daemon() {
  ktx mcp start \
    --project-dir "${PROJECT_ROOT}" \
    --host "${KTX_MCP_HOST}" \
    --port "${KTX_MCP_PORT}" \
    --token "${KTX_INTERNAL_TOKEN}" \
    --foreground &
  KTX_CHILD_PID="$!"
  printf '%s\n' "${KTX_CHILD_PID}" > "${KTX_PID_FILE}"
}

# ─── Spec 191 §4.3: the supervisor state machine ─────────────────────────────
#
# STARTING → RUNNING ⇄ RELOADING, with BACKOFF on every unexpected exit.
# The supervisor owns the daemon lifecycle; the parent shell only waits for the
# supervisor and for Lucy.
supervise_ktx() {
  local started_at
  local failures=0
  local backoff=1
  local ever_ready=0
  local ticks=0
  local ktx_pid=""

  started_at="$(ktx_utc_now)"
  trap 'KTX_SUPERVISOR_STOP=1' TERM INT
  # Drop the daemon pid file on any orderly exit. A SIGKILL cannot run traps,
  # so the file survives exactly in the case the parent's leftover sweep needs
  # it — a stale pid must never be signalled after the pid was recycled.
  trap 'rm -f "${KTX_PID_FILE}" >/dev/null 2>&1 || true' EXIT

  printf '%s\n' "$(ktx_supervisor_pid)" > "${KTX_SUPERVISOR_PID_FILE}"
  ktx_write_capability "${started_at}"

  while [[ "${KTX_SUPERVISOR_STOP}" -eq 0 ]]; do
    if [[ "${failures}" -gt 0 ]]; then
      echo "[lucy] KTX MCP upstream not ready; retry ${failures}/${KTX_RELOAD_BACKOFF_LIMIT} in ${backoff}s" >&2
      sleep "${backoff}"
      backoff=$((backoff * 2))
      if [[ "${backoff}" -gt "${KTX_RELOAD_BACKOFF_MAX_S}" ]]; then
        backoff="${KTX_RELOAD_BACKOFF_MAX_S}"
      fi
    fi

    ktx_start_daemon
    ktx_pid="${KTX_CHILD_PID}"

    if ! ktx_wait_ready "${ktx_pid}" "${started_at}"; then
      ktx_stop_child "${ktx_pid}"
      if [[ "${ever_ready}" -eq 0 ]]; then
        # Spec 191 §4.2 #5: the first start must not silently degrade.
        echo "[lucy] fatal: KTX MCP upstream failed to start; refusing to run degraded" >&2
        ktx_revoke_capability
        exit 1
      fi
      failures=$((failures + 1))
      if [[ "${failures}" -gt "${KTX_RELOAD_BACKOFF_LIMIT}" ]]; then
        echo "[lucy] fatal: KTX MCP upstream failed ${failures} times; giving up" >&2
        ktx_revoke_capability
        exit 1
      fi
      continue
    fi

    ever_ready=1
    failures=0
    backoff=1
    ktx_write_capability "${started_at}"
    printf '%s\n' "$(ktx_supervisor_pid)" > "${KTX_READY_FILE}"

    while [[ "${KTX_SUPERVISOR_STOP}" -eq 0 ]]; do
      # ── reload request ──
      if [[ -f "${KTX_RELOAD_REQUEST_FILE}" ]]; then
        ktx_consume_reload_request
        if [[ -z "${KTX_RELOAD_REQUEST_ID}" ]]; then
          continue
        fi
        echo "[lucy] reload requested (${KTX_RELOAD_REQUEST_ID}); restarting KTX MCP upstream" >&2
        KTX_SUPERVISOR_STATE="reloading"
        KTX_SUPERVISOR_REQUEST_ID="${KTX_RELOAD_REQUEST_ID}"
        ktx_write_capability "${started_at}"
        ktx_stop_child "${ktx_pid}"
        ktx_wait_port_released || true
        ktx_start_daemon
        ktx_pid="${KTX_CHILD_PID}"
        if ktx_wait_ready "${ktx_pid}" "${started_at}"; then
          ktx_write_reload_result \
            "${KTX_RELOAD_REQUEST_ID}" \
            "$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")" \
            "succeeded" \
            ""
          KTX_SUPERVISOR_STATE="idle"
          KTX_SUPERVISOR_REQUEST_ID=""
          ktx_write_capability "${started_at}"
          continue
        fi
        # The daemon did not come back: report the failure honestly and fall
        # back to the bounded retry path. The configuration is NOT rolled back.
        ktx_stop_child "${ktx_pid}"
        ktx_write_reload_result \
          "${KTX_RELOAD_REQUEST_ID}" \
          "$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")" \
          "failed" \
          "KTX MCP upstream did not become ready after the reload"
        KTX_SUPERVISOR_STATE="idle"
        KTX_SUPERVISOR_REQUEST_ID=""
        ktx_write_capability "${started_at}"
        failures=$((failures + 1))
        if [[ "${failures}" -gt "${KTX_RELOAD_BACKOFF_LIMIT}" ]]; then
          echo "[lucy] fatal: KTX MCP upstream failed ${failures} times after a reload; giving up" >&2
          ktx_revoke_capability
          exit 1
        fi
        break
      fi

      # ── the daemon exited on its own ──
      if ! kill -0 "${ktx_pid}" >/dev/null 2>&1; then
        wait "${ktx_pid}" >/dev/null 2>&1 || true
        echo "[lucy] KTX MCP upstream exited unexpectedly" >&2
        failures=$((failures + 1))
        if [[ "${failures}" -gt "${KTX_RELOAD_BACKOFF_LIMIT}" ]]; then
          echo "[lucy] fatal: KTX MCP upstream failed ${failures} times; giving up" >&2
          ktx_revoke_capability
          exit 1
        fi
        break
      fi

      ticks=$((ticks + 1))
      if [[ "${ticks}" -ge "${KTX_RELOAD_HEARTBEAT_TICKS}" ]]; then
        ticks=0
        ktx_write_capability "${started_at}"
      fi
      sleep 0.2
    done
  done

  ktx_stop_child "${ktx_pid}"
  ktx_revoke_capability
  rm -f "${KTX_SUPERVISOR_PID_FILE}" "${KTX_READY_FILE}" >/dev/null 2>&1 || true
  return 0
}

# Wait for a child to exit, with a hard bound. Escalates to SIGKILL when the
# child overruns, so container shutdown can never hang on a stuck daemon.
wait_for_child_exit() {
  local pid="${1:-}"
  local timeout_s="${2:-10}"
  local killer
  [[ -n "${pid}" ]] || return 0
  kill -0 "${pid}" >/dev/null 2>&1 || {
    wait "${pid}" >/dev/null 2>&1 || true
    return 0
  }
  ( sleep "${timeout_s}"; kill -KILL "${pid}" >/dev/null 2>&1 || true ) &
  killer="$!"
  wait "${pid}" >/dev/null 2>&1 || true
  kill -TERM "${killer}" >/dev/null 2>&1 || true
  wait "${killer}" >/dev/null 2>&1 || true
  return 0
}

# Last-resort cleanup: make sure no KTX daemon survives the container shutdown,
# even when the supervisor was killed without running its own cleanup.
ktx_kill_leftover_daemon() {
  local pid=""
  local waited=0
  if [[ -f "${KTX_PID_FILE}" ]]; then
    pid="$(tr -d '[:space:]' < "${KTX_PID_FILE}" 2>/dev/null || true)"
  fi
  case "${pid}" in
    ''|*[!0-9]*) return 0 ;;
  esac
  kill -0 "${pid}" >/dev/null 2>&1 || return 0
  kill -TERM "${pid}" >/dev/null 2>&1 || true
  while [[ "${waited}" -lt 25 ]]; do
    kill -0 "${pid}" >/dev/null 2>&1 || return 0
    waited=$((waited + 1))
    sleep 0.2
  done
  kill -KILL "${pid}" >/dev/null 2>&1 || true
  return 0
}

# Spec 191 §4.4 — graceful shutdown.
# The supervisor is stopped first: it forwards TERM to the KTX daemon and reaps
# it. Only then is Lucy stopped. The leftover sweep is the belt-and-braces path
# for the case where the supervisor itself was SIGKILLed.
# Wait until the supervisor reports a ready daemon, so the WebUI still starts
# only after the KTX upstream is listening (the pre-Spec 191 ordering).
wait_for_ktx_ready() {
  local waited=0
  while [[ "${waited}" -lt 70 ]]; do
    if [[ -f "${KTX_READY_FILE}" ]]; then return 0; fi
    if ! kill -0 "${SUPERVISOR_PID}" >/dev/null 2>&1; then return 1; fi
    waited=$((waited + 1))
    sleep 1
  done
  return 1
}

shutdown() {
  local status="${1:-0}"
  trap - TERM INT EXIT
  if [[ -n "${SUPERVISOR_PID:-}" ]]; then
    kill -TERM "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
    wait_for_child_exit "${SUPERVISOR_PID}" "${KTX_RELOAD_STOP_TIMEOUT_S}"
  fi
  ktx_kill_leftover_daemon
  if [[ -n "${LUCY_PID:-}" ]]; then kill "${LUCY_PID}" >/dev/null 2>&1 || true; fi
  wait >/dev/null 2>&1 || true
  exit "${status}"
}

report_git_init_failure() {
  echo "[lucy] fatal: failed to initialize git repository at ${PROJECT_ROOT}" >&2
  echo "[lucy]   uid=$(id -u) gid=$(id -g)" >&2
  echo "[lucy]   pwd=$(pwd)" >&2
  echo "[lucy]   KTX_PROJECT_ROOT=${KTX_PROJECT_ROOT}" >&2
  if [[ -e "${PROJECT_ROOT}" ]]; then
    ls -la "${PROJECT_ROOT}" >&2 || true
    if [[ -e "${PROJECT_ROOT}/.git" ]]; then
      ls -la "${PROJECT_ROOT}/.git" >&2 || true
    fi
  else
    echo "[lucy]   ${PROJECT_ROOT} does not exist" >&2
  fi
}

ensure_git_repo() {
  mkdir -p "${PROJECT_ROOT}"
  if [[ -d "${PROJECT_ROOT}/.git" ]]; then
    return 0
  fi
  if ! git -C "${PROJECT_ROOT}" init; then
    report_git_init_failure
    return 1
  fi
  echo "[lucy] initialized git repository at ${PROJECT_ROOT}"
}

# Spec 191 §4 — supervisor-only mode.
# Runs ONLY the KTX supervisor: no project seeding, no WebUI, no catalog
# refresh. It exists so the reload lifecycle can be exercised against a stub
# daemon without rebuilding the customer image. Production never sets it.
if [[ "${LUCY_ENTRYPOINT_SUPERVISOR_ONLY:-0}" == "1" ]]; then
  mkdir -p "${KTX_UI_DIR}"
  supervise_ktx
  exit $?
fi

ensure_git_repo
seed_project
sync_runtime_mirror
load_or_create_internal_token
validate_project_context

if [[ "${LUCY_ENTRYPOINT_SEED_ONLY:-0}" == "1" ]]; then
  echo "[lucy] seed-only mode complete"
  exit 0
fi

maybe_reindex_context

echo "[lucy] bundled KTX: $(ktx --version)"
echo "[lucy] project root: ${PROJECT_ROOT}"

# Spec 191 §4.2 — the supervisor owns the KTX daemon; the parent shell waits
# for the supervisor and for Lucy. Clear any channel files left behind by a
# previous run so a stale receipt can never be read as this boot's answer.
rm -f "${KTX_RELOAD_CAPABILITY_FILE}" "${KTX_RELOAD_RESULT_FILE}" \
  "${KTX_RELOAD_REQUEST_FILE}" "${KTX_SUPERVISOR_PID_FILE}" "${KTX_READY_FILE}" \
  >/dev/null 2>&1 || true

supervise_ktx &
SUPERVISOR_PID="$!"

# The traps are armed before the WebUI starts: from here on the supervisor and
# the daemon exist, so every exit path must go through the cleanup chain.
trap 'shutdown 143' TERM INT
trap 'shutdown $?' EXIT

if ! wait_for_ktx_ready; then
  supervisor_status=0
  wait "${SUPERVISOR_PID}" >/dev/null 2>&1 || supervisor_status="$?"
  if [[ "${supervisor_status}" -eq 0 ]]; then supervisor_status=1; fi
  echo "[lucy] fatal: KTX MCP upstream did not become ready (supervisor status ${supervisor_status})" >&2
  shutdown "${supervisor_status}"
fi

cd "${WEBUI_ROOT}"
npm run start &
LUCY_PID="$!"

wait -n "${SUPERVISOR_PID}" "${LUCY_PID}"
status="$?"
echo "[lucy] child process exited with status ${status}" >&2
shutdown "${status}"
