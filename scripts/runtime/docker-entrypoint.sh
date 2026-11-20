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
# P1-63 — whole-instance drain IPC (no credentials). Parent owns shutdown.
LUCY_DRAIN_REQUEST_FILE="${KTX_UI_DIR}/lucy-process-drain.request"
LUCY_DRAIN_ACK_FILE="${KTX_UI_DIR}/lucy-process-drain.ack"
# Budgets: drain ≤20s, supervisor/KTX 10s, orphan ≤5s, wrap-up 5s, total ≤40s.
# External stop grace must be ≥45s (demo compose stop_grace_period: 45s).
LUCY_DRAIN_BUDGET_S="${LUCY_DRAIN_BUDGET_S:-20}"
LUCY_DRAIN_ACK_WAIT_S="${LUCY_DRAIN_ACK_WAIT_S:-5}"
LUCY_ORPHAN_CLEANUP_BUDGET_S="${LUCY_ORPHAN_CLEANUP_BUDGET_S:-5}"
LUCY_WRAP_UP_BUDGET_S="${LUCY_WRAP_UP_BUDGET_S:-5}"
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
  # 客户与 demo 都在对外服务前补齐正式 lucy_admin。已存在只追加缺失工具名。
  ensure_system_formal_role lucy_admin
  mkdir -p "${PROJECT_ROOT}/.ktx/secrets" "${PROJECT_ROOT}/.ktx-ui" "${SEED_STATE_DIR}"
  printf "%s\n" "${LUCY_BUNDLED_KTX_VERSION:-unknown}" > "${SEED_STATE_DIR}/bundled-ktx-version"
}

# ─── Spec 149 §8 / WO T7 — 运维问数连接 ────────────────────────────────────────
#
# KTX daemon 只在**启动时**解析连接：写盘不会让已经跑起来的 daemon 看见新连接。
# 因此视图、连接块、内容根资产与项目根镜像都必须在 supervise_ktx 之前完成，
# 摘要戳也必须在这之后写（见 write_ops_evidence_stamp）。
#
# 失败只关闭这一个连接：不阻断启动，也不影响其它数据面。
OPS_EVIDENCE_CLI="${WEBUI_ROOT}/server/ops-evidence/cli.ts"

ops_evidence_cli() {
  local subcommand="$1"
  local tsx_bin="${WEBUI_ROOT}/node_modules/.bin/tsx"
  if [[ ! -f "${OPS_EVIDENCE_CLI}" ]]; then
    echo "[lucy] ops-evidence CLI not found; the ops evidence connection stays unavailable"
    return 1
  fi
  if [[ ! -x "${tsx_bin}" ]]; then
    echo "[lucy] warning: tsx is not available; the ops evidence connection stays unavailable" >&2
    return 1
  fi
  "${tsx_bin}" "${OPS_EVIDENCE_CLI}" "${subcommand}"
}

ensure_ops_evidence() {
  if ! ops_evidence_cli ensure; then
    echo "[lucy] warning: the ops evidence ensure failed; the connection stays unavailable" >&2
  fi
  return 0
}

write_ops_evidence_stamp() {
  if ! ops_evidence_cli stamp; then
    echo "[lucy] warning: the ops evidence digest stamp could not be written" >&2
  fi
  return 0
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

# 正式 lucy_admin：全模板路径。缺则按规范块创建；已存在只追加缺失工具。
# 闸拒绝或写失败只告警，不阻断启动。lucy_ops_reader 不在这里写。
ensure_system_formal_role() {
  local which="$1"
  local cli="${WEBUI_ROOT}/server/admin/ensure-system-formal-roles-cli.ts"
  local tsx_bin="${WEBUI_ROOT}/node_modules/.bin/tsx"
  if [[ ! -f "${cli}" ]]; then
    echo "[lucy] warning: system formal role CLI not found; ${which} was not ensured" >&2
    return 0
  fi
  if [[ ! -x "${tsx_bin}" ]]; then
    echo "[lucy] warning: tsx is not available; ${which} was not ensured" >&2
    return 0
  fi
  if ! "${tsx_bin}" "${cli}" "${which}"; then
    echo "[lucy] warning: ${which} formal role ensure failed" >&2
  fi
  return 0
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
KTX_SUPERVISOR_COMPLETED_REQUEST_ID=""
# The pid of the running KTX daemon, owned by the supervisor.
KTX_CHILD_PID=""
# The request currently being processed by the supervisor.
KTX_RELOAD_REQUEST_ID=""
KTX_RELOAD_REQUESTED_DIGEST=""
# P1-69: one caller deadline; empty outside an explicit reload (startup/backoff unchanged).
KTX_RELOAD_DEADLINE_MS=""
KTX_RELOAD_STAGE_DEADLINE_MS=""

# Existing parent-owned whole-instance facts; reload never clears or reverses them.
ktx_instance_draining() {
  [[ -e "${LUCY_DRAIN_REQUEST_FILE}" || -e "${LUCY_DRAIN_ACK_FILE}" ]]
}

ktx_epoch_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

ktx_reload_remaining_ms() {
  local now remaining
  now="$(ktx_epoch_ms)" || return 1
  remaining=$((KTX_RELOAD_DEADLINE_MS - now))
  if [[ -n "${KTX_RELOAD_STAGE_DEADLINE_MS}" ]] && [[ "${KTX_RELOAD_STAGE_DEADLINE_MS}" -lt "${KTX_RELOAD_DEADLINE_MS}" ]]; then
    remaining=$((KTX_RELOAD_STAGE_DEADLINE_MS - now))
  fi
  [[ "${remaining}" -gt 0 ]] || return 1
  printf '%s' "${remaining}"
}

ktx_reload_stage() {
  local now
  now="$(ktx_epoch_ms)" || return 1
  KTX_RELOAD_STAGE_DEADLINE_MS=$((now + $1))
  if [[ "${KTX_RELOAD_STAGE_DEADLINE_MS}" -gt "${KTX_RELOAD_DEADLINE_MS}" ]]; then
    KTX_RELOAD_STAGE_DEADLINE_MS="${KTX_RELOAD_DEADLINE_MS}"
  fi
}

# Sleep only within the current request/stage deadline (startup still uses original sleeps).
ktx_reload_pause() {
  node -e 'const [total,stage,delay]=process.argv.slice(1).map(Number); const end=Math.min(total,stage||Infinity,Date.now()+delay); setTimeout(()=>{},Math.max(0,end-Date.now()));' "${KTX_RELOAD_DEADLINE_MS}" "${KTX_RELOAD_STAGE_DEADLINE_MS:-0}" "$1"
}

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

# The supervisor's own pid.
#
# Callers publish this value from command substitutions. Inside $(...), both
# $$ (parent of that subshell) and BASHPID (the subshell itself) are wrong:
# the subshell exits as soon as printf returns, and Node then treats the
# supervisor as dead. Capture the pid once in the supervisor shell and only
# echo that saved value from here.
ktx_supervisor_pid() {
  if [[ -n "${KTX_SUPERVISOR_SELF_PID:-}" ]]; then
    printf '%s' "${KTX_SUPERVISOR_SELF_PID}"
  elif [[ -n "${BASHPID:-}" ]]; then
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
    "$(printf '{"protocol":"%s","supervisorPid":%s,"startedAt":"%s","heartbeatAt":"%s","state":"%s","currentRequestId":"%s","completedRequestId":"%s"}' \
      "${KTX_RELOAD_PROTOCOL}" "$(ktx_supervisor_pid)" "${started_at}" "${heartbeat_at}" \
      "${KTX_SUPERVISOR_STATE}" "${KTX_SUPERVISOR_REQUEST_ID}" "${KTX_SUPERVISOR_COMPLETED_REQUEST_ID}")" || true
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
  local probe_ms=500 remaining
  if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]]; then
    remaining="$(ktx_reload_remaining_ms)" || return 1
    if [[ "${remaining}" -lt "${probe_ms}" ]]; then probe_ms="${remaining}"; fi
  fi
  node -e '
    const net = require("net");
    const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
    socket.on("connect", () => { socket.end(); process.exit(0); });
    socket.on("error", () => process.exit(1));
    setTimeout(() => process.exit(1), Math.max(1, Number(process.argv[3])));
  ' "${KTX_MCP_HOST}" "${KTX_MCP_PORT}" "${probe_ms}" >/dev/null 2>&1
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
    if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]] && ktx_instance_draining; then return 1; fi
    if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]] && ! ktx_reload_remaining_ms >/dev/null; then return 1; fi
    if ! kill -0 "${pid}" >/dev/null 2>&1; then return 1; fi
    if ktx_port_ready; then return 0; fi
    waited=$((waited + 1))
    beats=$((beats + 1))
    if [[ -n "${started_at}" && "${beats}" -ge 5 ]]; then
      beats=0
      ktx_write_capability "${started_at}"
    fi
    if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]]; then ktx_reload_pause 1000; else sleep 1; fi
  done
  echo "[lucy] timed out waiting for KTX MCP upstream on ${KTX_MCP_HOST}:${KTX_MCP_PORT}" >&2
  return 1
}

# Wait for the port to be released so the replacement daemon can rebind it.
ktx_wait_port_released() {
  local waited=0
  while [[ "${waited}" -lt 50 ]]; do
    if [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then return 1; fi
    if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]] && ktx_instance_draining; then return 1; fi
    if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]] && ! ktx_reload_remaining_ms >/dev/null; then return 1; fi
    if ! ktx_port_ready; then return 0; fi
    waited=$((waited + 1))
    if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]]; then ktx_reload_pause 200; else sleep 0.2; fi
  done
  return 1
}

# Stop a child and make sure it is really gone — no leftover daemon.
# `wait` reaps the child, so a zombie never looks "still alive" to the caller.
ktx_stop_child() {
  local pid="${1:-}"
  local killer stop_s="${KTX_RELOAD_STOP_TIMEOUT_S}" remaining
  [[ -n "${pid}" ]] || return 0
  kill -0 "${pid}" >/dev/null 2>&1 || {
    wait "${pid}" >/dev/null 2>&1 || true
    return 0
  }
  kill -TERM "${pid}" >/dev/null 2>&1 || true
  # Bounded wait: a watchdog escalates to SIGKILL if the child ignores TERM.
  if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]]; then
    # The private watchdog computes remaining time AFTER its own startup overhead.
    node -e 'const [pid,total,stage,cap]=process.argv.slice(1).map(Number); const end=Math.min(total,stage||Infinity,Date.now()+cap*1000); setTimeout(()=>{try{process.kill(pid,"SIGKILL")}catch{}},Math.max(0,end-Date.now()));' "${pid}" "${KTX_RELOAD_DEADLINE_MS}" "${KTX_RELOAD_STAGE_DEADLINE_MS:-0}" "${stop_s}" &
  else
    ( sleep "${stop_s}"; kill -KILL "${pid}" >/dev/null 2>&1 || true ) &
  fi
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
  KTX_RELOAD_DEADLINE_MS=""
  KTX_RELOAD_STAGE_DEADLINE_MS=""
  if ! mv -f "${KTX_RELOAD_REQUEST_FILE}" "${tmp}" >/dev/null 2>&1; then
    rm -f "${tmp}" >/dev/null 2>&1 || true
    return 0
  fi
  parsed="$(node -e '
const fs = require("fs");
const file = process.argv[1];
let doc = {};
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { doc = {}; }
const requestedAt = Date.parse(String(doc.requestedAt ?? ""));
const deadline = Number(doc.deadlineAt ?? (Number.isFinite(requestedAt) ? requestedAt + 60000 : 0));
process.stdout.write([String(doc.requestId ?? ""), String(doc.requestedDigest ?? ""), String(Number.isFinite(deadline) ? Math.min(deadline,Date.now()+60000) : 0)].join("\u001f"));
' "${tmp}" 2>/dev/null || true)"
  rm -f "${tmp}" >/dev/null 2>&1 || true
  if [[ -z "${parsed}" ]]; then
    echo "[lucy] reload request file was not readable JSON; ignoring" >&2
    return 0
  fi
  IFS=$'\x1f' read -r KTX_RELOAD_REQUEST_ID KTX_RELOAD_REQUESTED_DIGEST KTX_RELOAD_DEADLINE_MS <<< "${parsed}" || true
  if [[ -z "${KTX_RELOAD_REQUEST_ID}" ]]; then
    echo "[lucy] reload request had no requestId; ignoring" >&2
    return 0
  fi
  return 0
}

# Start the KTX daemon and record its pid.
ktx_start_daemon() {
  if [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then return 1; fi
  if ktx_instance_draining; then return 1; fi
  if [[ -n "${KTX_RELOAD_DEADLINE_MS}" ]] && ! ktx_reload_remaining_ms >/dev/null; then return 1; fi
  # Final synchronous shutdown check after deadline helper process returned.
  if ktx_instance_draining || [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then return 1; fi
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
  # This assignment must stay in the supervisor shell, before any $(...).
  KTX_SUPERVISOR_SELF_PID="${BASHPID:-$$}"
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

    # Do not turn a failed reload into a new BACKOFF restart during whole-instance drain.
    while ktx_instance_draining && [[ "${KTX_SUPERVISOR_STOP}" -eq 0 ]]; do sleep 0.2; done
    if [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then break; fi
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
        # Expired or draining work must never restart KTX later.
        if ktx_instance_draining || ! ktx_reload_remaining_ms >/dev/null || [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then
          ktx_write_reload_result "${KTX_RELOAD_REQUEST_ID}" "$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")" "failed" "执行层重载请求已过期或服务正在停止；未停止执行层"
          KTX_SUPERVISOR_COMPLETED_REQUEST_ID="${KTX_RELOAD_REQUEST_ID}"
          KTX_RELOAD_DEADLINE_MS=""; KTX_RELOAD_STAGE_DEADLINE_MS=""
          ktx_write_capability "${started_at}"
          continue
        fi
        echo "[lucy] reload requested (${KTX_RELOAD_REQUEST_ID}); restarting KTX MCP upstream" >&2
        KTX_SUPERVISOR_STATE="reloading"
        KTX_SUPERVISOR_REQUEST_ID="${KTX_RELOAD_REQUEST_ID}"
        ktx_reload_stage 10000
        ktx_write_capability "${started_at}"
        # Parent can begin whole-instance drain while capability publication awaited I/O.
        if ! ktx_reload_remaining_ms >/dev/null || ktx_instance_draining || [[ "${KTX_SUPERVISOR_STOP}" -ne 0 ]]; then
          ktx_write_reload_result "${KTX_RELOAD_REQUEST_ID}" "$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")" "failed" "服务正在停止；未停止执行层"
          KTX_SUPERVISOR_COMPLETED_REQUEST_ID="${KTX_RELOAD_REQUEST_ID}"
          KTX_SUPERVISOR_STATE="idle"; KTX_SUPERVISOR_REQUEST_ID=""
          KTX_RELOAD_DEADLINE_MS=""; KTX_RELOAD_STAGE_DEADLINE_MS=""
          ktx_write_capability "${started_at}"
          continue
        fi
        ktx_stop_child "${ktx_pid}"
        ktx_wait_port_released || true
        KTX_RELOAD_STAGE_DEADLINE_MS=""
        local loaded_digest
        loaded_digest="$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")"
        ktx_reload_stage 20000
        if ktx_start_daemon; then
          ktx_pid="${KTX_CHILD_PID}"
          if ktx_wait_ready "${ktx_pid}" "${started_at}"; then
            if [[ "${loaded_digest}" == "$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")" ]]; then
              ktx_write_reload_result "${KTX_RELOAD_REQUEST_ID}" "${loaded_digest}" "succeeded" ""
            else
              ktx_write_reload_result "${KTX_RELOAD_REQUEST_ID}" "${loaded_digest}" "failed" "配置在执行层启动期间发生变化，未确认加载"
            fi
            KTX_SUPERVISOR_COMPLETED_REQUEST_ID="${KTX_RELOAD_REQUEST_ID}"
            KTX_SUPERVISOR_STATE="idle"
            KTX_SUPERVISOR_REQUEST_ID=""
            KTX_RELOAD_DEADLINE_MS=""; KTX_RELOAD_STAGE_DEADLINE_MS=""
            ktx_write_capability "${started_at}"
            continue
          fi
        fi
        # The daemon did not come back: report the failure honestly and fall
        # back to the bounded retry path. The configuration is NOT rolled back.
        ktx_stop_child "${ktx_pid}"
        ktx_write_reload_result \
          "${KTX_RELOAD_REQUEST_ID}" \
          "$(ktx_sha256 "${PROJECT_ROOT}/ktx.yaml")" \
          "failed" \
          "KTX MCP upstream did not become ready after the reload"
        KTX_SUPERVISOR_COMPLETED_REQUEST_ID="${KTX_RELOAD_REQUEST_ID}"
        KTX_SUPERVISOR_STATE="idle"
        KTX_SUPERVISOR_REQUEST_ID=""
        KTX_RELOAD_DEADLINE_MS=""; KTX_RELOAD_STAGE_DEADLINE_MS=""
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
  local killer stop_s="${KTX_RELOAD_STOP_TIMEOUT_S}" remaining
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

# Spec 191 §4.4 / P1-63 — graceful shutdown (drain-first).
# Whole-instance TERM/INT: notify Lucy DRAINING and wait for bounded drain while
# KTX stays up; then stop supervisor/KTX with the original cleanup; then wrap up.
# Duplicate TERM/INT/EXIT join the same shutdown via LUCY_SHUTDOWN_STARTED.
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

# Validate custom stop timeout against the whole-instance budget (no silent shrink).
lucy_validate_stop_timeout_budget() {
  local stop_s="${KTX_RELOAD_STOP_TIMEOUT_S:-10}"
  local drain_s="${LUCY_DRAIN_BUDGET_S:-20}"
  local orphan_s="${LUCY_ORPHAN_CLEANUP_BUDGET_S:-5}"
  local wrap_s="${LUCY_WRAP_UP_BUDGET_S:-5}"
  local total=$((drain_s + stop_s + orphan_s + wrap_s))
  if [[ "${total}" -gt 40 ]]; then
    echo "[lucy] warning: stop/drain budget conflict: drain=${drain_s}s stop=${stop_s}s orphan=${orphan_s}s wrap=${wrap_s}s total=${total}s > 40s" >&2
  fi
  if [[ "${stop_s}" -gt 10 ]]; then
    echo "[lucy] warning: KTX_RELOAD_STOP_TIMEOUT_S=${stop_s} exceeds default 10s; total exit budget may miss ≤40s" >&2
  fi
  return 0
}

# Notify Lucy to drain and wait for DRAINING ack + process exit (KTX still alive).
lucy_request_and_wait_drain() {
  local waited=0
  local ack_waited=0
  local drain_s="${LUCY_DRAIN_BUDGET_S:-20}"
  local ack_s="${LUCY_DRAIN_ACK_WAIT_S:-5}"

  if [[ -z "${LUCY_PID:-}" ]]; then
    return 0
  fi
  if ! kill -0 "${LUCY_PID}" >/dev/null 2>&1; then
    wait "${LUCY_PID}" >/dev/null 2>&1 || true
    return 0
  fi

  mkdir -p "${KTX_UI_DIR}" >/dev/null 2>&1 || true
  rm -f "${LUCY_DRAIN_ACK_FILE}" >/dev/null 2>&1 || true
  # Request file carries no credentials — phase marker only.
  printf 'phase=DRAIN\n' > "${LUCY_DRAIN_REQUEST_FILE}" 2>/dev/null || true
  # Signal Lucy as a second confirmable channel within this instance.
  kill -TERM "${LUCY_PID}" >/dev/null 2>&1 || true

  echo "[lucy] drain: begin pid=${LUCY_PID} budget=${drain_s}s" >&2

  # Handoff window: external TERM → DRAINING ack. Work admitted in this window
  # is counted by Lucy; parent must not treat signal send time as barrier close.
  while [[ "${ack_waited}" -lt $((ack_s * 5)) ]]; do
    if [[ -f "${LUCY_DRAIN_ACK_FILE}" ]]; then
      echo "[lucy] drain: ack received" >&2
      break
    fi
    if ! kill -0 "${LUCY_PID}" >/dev/null 2>&1; then
      wait "${LUCY_PID}" >/dev/null 2>&1 || true
      echo "[lucy] drain: lucy exited before ack" >&2
      return 0
    fi
    ack_waited=$((ack_waited + 1))
    sleep 0.2
  done

  # Wait for Lucy to finish drain and exit while KTX remains up (≤ drain budget).
  while [[ "${waited}" -lt $((drain_s * 5)) ]]; do
    if ! kill -0 "${LUCY_PID}" >/dev/null 2>&1; then
      wait "${LUCY_PID}" >/dev/null 2>&1 || true
      echo "[lucy] drain: lucy settled exit" >&2
      return 0
    fi
    waited=$((waited + 1))
    sleep 0.2
  done

  echo "[lucy] drain: deadline reached; forcing lucy exit" >&2
  kill -TERM "${LUCY_PID}" >/dev/null 2>&1 || true
  wait_for_child_exit "${LUCY_PID}" "${LUCY_WRAP_UP_BUDGET_S:-5}"
  return 0
}

LUCY_SHUTDOWN_STARTED=0

shutdown() {
  local status="${1:-0}"
  # Duplicate TERM/INT/EXIT join the same process (idempotent).
  if [[ "${LUCY_SHUTDOWN_STARTED}" -ne 0 ]]; then
    return 0
  fi
  LUCY_SHUTDOWN_STARTED=1
  trap - TERM INT EXIT

  lucy_validate_stop_timeout_budget

  # 1) Drain Lucy first (KTX stays alive for in-flight dependency work).
  lucy_request_and_wait_drain

  # 2) Original supervisor → KTX cleanup (default 10s).
  if [[ -n "${SUPERVISOR_PID:-}" ]]; then
    echo "[lucy] drain: stopping supervisor pid=${SUPERVISOR_PID}" >&2
    kill -TERM "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
    wait_for_child_exit "${SUPERVISOR_PID}" "${KTX_RELOAD_STOP_TIMEOUT_S}"
  fi

  # 3) Orphan KTX sweep (≤5s bound via existing loop + kill).
  ktx_kill_leftover_daemon

  # 4) Remaining Lucy wrap-up if still alive.
  if [[ -n "${LUCY_PID:-}" ]] && kill -0 "${LUCY_PID}" >/dev/null 2>&1; then
    kill -TERM "${LUCY_PID}" >/dev/null 2>&1 || true
    wait_for_child_exit "${LUCY_PID}" "${LUCY_WRAP_UP_BUDGET_S:-5}"
  fi

  rm -f "${LUCY_DRAIN_REQUEST_FILE}" "${LUCY_DRAIN_ACK_FILE}" >/dev/null 2>&1 || true
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
load_or_create_internal_token
# 内容根校验在运维问数确保**之前**：该守卫要拦住的是「模板本身没有数据源」，
# 不能被运维问数自带的语义文件顶成一个非零计数。
validate_project_context
# Spec 149 §8 — 运维问数连接必须在 KTX daemon 启动之前就位。
ensure_ops_evidence
sync_runtime_mirror
# 摘要戳写在这之后：它是「daemon 启动前配置已就绪」的证据。
write_ops_evidence_stamp

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
  "${LUCY_DRAIN_REQUEST_FILE}" "${LUCY_DRAIN_ACK_FILE}" \
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
# Own the actual server PID. npm/tsx launchers may exit on TERM while their
# Node child is still draining, which would stop KTX before its RPC settles.
node --import tsx server/index.ts &
LUCY_PID="$!"

wait -n "${SUPERVISOR_PID}" "${LUCY_PID}"
status="$?"
echo "[lucy] child process exited with status ${status}" >&2
shutdown "${status}"
