#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${LUCY_APP_ROOT:-/app}"
PROJECT_ROOT="${KTX_PROJECT_ROOT:-/data/lucy}"
WEBUI_ROOT="${LUCY_WEBUI_ROOT:-${APP_ROOT}/webui}"
TEMPLATE_ROOT="${LUCY_TEMPLATE_ROOT:-${APP_ROOT}/project-template}"
SEED_STATE_DIR="${PROJECT_ROOT}/.lucy-seed"

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
if [[ "${CONTENT_ROOT}" = /* ]]; then
  CONTENT_ROOT_ABS="${CONTENT_ROOT}"
else
  CONTENT_ROOT_ABS="$(cd "${PROJECT_ROOT}" && cd "${CONTENT_ROOT}" && pwd -P 2>/dev/null || echo "${PROJECT_ROOT}/${CONTENT_ROOT}")"
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
