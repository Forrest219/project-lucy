#!/usr/bin/env bash
#
# Spec 191 §Step 8 — execution runtime reload lifecycle verification.
#
# Two modes:
#
#   --local      Exercise the KTX supervisor from scripts/runtime/docker-entrypoint.sh
#                against a stub daemon. No Docker, no customer image, no network.
#                Covers: first-start failure, spontaneous exit + bounded retry,
#                reload request → daemon restart → receipt, SIGTERM → no leftover
#                process, capability handshake.
#
#   --container  Reserved for the real container (Step 8 / AC-12). Requires an
#                already built image (LUCY_RELOAD_VERIFY_IMAGE) and does NOT
#                build one. Until those checks run, this mode exits 2 and must
#                not print PASSED.
#
# Local mode covers the supervisor acceptance surface without a container.
# Container mode does not yet run the Step 8 table; it refuses a zero-check pass.
#
# Usage:
#   scripts/verify/verify-ktx-reload-lifecycle.sh --local
#   LUCY_RELOAD_VERIFY_IMAGE=lucy:v0.25 scripts/verify/verify-ktx-reload-lifecycle.sh --container
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ENTRYPOINT="${REPO_ROOT}/scripts/runtime/docker-entrypoint.sh"

MODE="local"
for arg in "$@"; do
  case "${arg}" in
    --local) MODE="local" ;;
    --container) MODE="container" ;;
    *) echo "usage: $0 [--local|--container]" >&2; exit 2 ;;
  esac
done

FAILURES=0
CHECKS=0

pass() {
  CHECKS=$((CHECKS + 1))
  echo "  ok   — $1"
}

fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  echo "  FAIL — $1" >&2
}

check() {
  # check <description> <command...>
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "${description}"
  else
    fail "${description}"
  fi
}

assert_eq() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [[ "${expected}" == "${actual}" ]]; then
    pass "${description}"
  else
    fail "${description} (expected '${expected}', got '${actual}')"
  fi
}

# ── local mode ───────────────────────────────────────────────────────────────

WORKDIR=""
STUB_BIN=""
SUPERVISOR_PID=""

cleanup_local() {
  if [[ -n "${SUPERVISOR_PID}" ]] && kill -0 "${SUPERVISOR_PID}" >/dev/null 2>&1; then
    kill -TERM "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
    wait "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${WORKDIR}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}

# A stub `ktx mcp start` that behaves like the real daemon for everything the
# supervisor depends on: it binds the port, records its pid, and exits cleanly
# on SIGTERM.
write_stub_ktx() {
  local target="$1"
  cat > "${target}" <<'STUB'
#!/usr/bin/env node
const net = require("net");
const fs = require("fs");

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(args[portIndex + 1]);
const pidFile = process.env.KTX_STUB_PID_FILE;

if (process.env.KTX_STUB_FAIL === "1") {
  process.stderr.write("stub ktx: refusing to start\n");
  process.exit(1);
}

if (pidFile) fs.writeFileSync(pidFile, `${process.pid}\n`);

const server = net.createServer((socket) => socket.end());
server.on("error", () => process.exit(1));
server.listen(port, "127.0.0.1", () => {
  if (process.env.KTX_STUB_READY_FILE) {
    fs.writeFileSync(process.env.KTX_STUB_READY_FILE, `${process.pid}\n`);
  }
});

if (process.env.KTX_STUB_EXIT_AFTER) {
  setTimeout(() => process.exit(0), Number(process.env.KTX_STUB_EXIT_AFTER));
}

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
STUB
  chmod +x "${target}"
}

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close();});'
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

read_json_field() {
  # read_json_field <file> <field>
  node -e '
const fs = require("fs");
const [file, field] = process.argv.slice(1);
let doc = {};
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { doc = {}; }
const value = doc[field];
process.stdout.write(value === undefined || value === null ? "" : String(value));
' "$1" "$2"
}

wait_for_file() {
  # wait_for_file <path> <seconds>
  local path="$1"
  local limit="$2"
  local waited=0
  while [[ "${waited}" -lt "${limit}" ]]; do
    if [[ -f "${path}" ]]; then return 0; fi
    waited=$((waited + 1))
    sleep 0.2
  done
  return 1
}

start_supervisor() {
  # start_supervisor <project-root> <port>
  local project_root="$1"
  local port="$2"
  LUCY_ENTRYPOINT_SUPERVISOR_ONLY=1 \
  KTX_PROJECT_ROOT="${project_root}" \
  KTX_MCP_HOST="127.0.0.1" \
  KTX_MCP_PORT="${port}" \
  KTX_INTERNAL_TOKEN="stub-token" \
  KTX_STUB_PID_FILE="${project_root}/.ktx-ui/stub.pid" \
  PATH="${STUB_BIN}:${PATH}" \
    bash "${ENTRYPOINT}" >"${project_root}/supervisor.log" 2>&1 &
  SUPERVISOR_PID="$!"
}

run_local() {
  echo "== Spec 191 reload lifecycle — local supervisor mode =="
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/lucy-ktx-reload-XXXXXX")"
  trap cleanup_local EXIT
  STUB_BIN="${WORKDIR}/bin"
  mkdir -p "${STUB_BIN}" "${WORKDIR}/project/.ktx-ui"
  write_stub_ktx "${STUB_BIN}/ktx"

  local project_root="${WORKDIR}/project"
  printf 'connections:\n  demo:\n    host: db.example.test\n' > "${project_root}/ktx.yaml"

  # ── 1. happy path: capability handshake + reload receipt ──
  local port
  port="$(free_port)"
  start_supervisor "${project_root}" "${port}"

  if wait_for_file "${project_root}/.ktx-ui/ktx-ready" 40; then
    pass "supervisor reports the daemon ready"
  else
    fail "supervisor reports the daemon ready"
    cat "${project_root}/supervisor.log" >&2 || true
    return 1
  fi

  assert_eq "capability file publishes the protocol version" \
    "lucy-ktx-reload/1" \
    "$(read_json_field "${project_root}/.ktx-ui/ktx-reload.capability" protocol)"

  assert_eq "capability file publishes the supervisor state" \
    "idle" \
    "$(read_json_field "${project_root}/.ktx-ui/ktx-reload.capability" state)"

  local supervisor_pid_field
  supervisor_pid_field="$(read_json_field "${project_root}/.ktx-ui/ktx-reload.capability" supervisorPid)"
  if [[ "${supervisor_pid_field}" =~ ^[0-9]+$ ]] && kill -0 "${supervisor_pid_field}" >/dev/null 2>&1; then
    pass "capability file carries a live supervisor pid"
  else
    fail "capability file carries a live supervisor pid (got '${supervisor_pid_field}')"
  fi

  local first_daemon_pid
  first_daemon_pid="$(cat "${project_root}/.ktx-ui/stub.pid" 2>/dev/null || true)"
  if [[ "${first_daemon_pid}" =~ ^[0-9]+$ ]]; then
    pass "daemon pid is published for diagnostics"
  else
    fail "daemon pid is published for diagnostics"
  fi

  # A reload request must restart the daemon and produce a matching receipt.
  local request_id="local-reload-1"
  printf '{"requestId":"%s","requestedDigest":"%s","requestedAt":"2026-10-27T00:00:00.000Z"}\n' \
    "${request_id}" "$(file_sha256 "${project_root}/ktx.yaml")" \
    > "${project_root}/.ktx-ui/ktx-reload.request.tmp"
  mv -f "${project_root}/.ktx-ui/ktx-reload.request.tmp" "${project_root}/.ktx-ui/ktx-reload.request"

  if wait_for_file "${project_root}/.ktx-ui/ktx-reload.result" 40; then
    pass "reload receipt is written"
  else
    fail "reload receipt is written"
    cat "${project_root}/supervisor.log" >&2 || true
  fi

  assert_eq "receipt answers the same requestId" \
    "${request_id}" \
    "$(read_json_field "${project_root}/.ktx-ui/ktx-reload.result" requestId)"

  assert_eq "receipt reports a succeeded reload" \
    "succeeded" \
    "$(read_json_field "${project_root}/.ktx-ui/ktx-reload.result" status)"

  assert_eq "receipt carries the digest actually read from disk" \
    "$(file_sha256 "${project_root}/ktx.yaml")" \
    "$(read_json_field "${project_root}/.ktx-ui/ktx-reload.result" actualDigest)"

  local second_daemon_pid
  second_daemon_pid="$(cat "${project_root}/.ktx-ui/stub.pid" 2>/dev/null || true)"
  if [[ -n "${second_daemon_pid}" && "${second_daemon_pid}" != "${first_daemon_pid}" ]]; then
    pass "the reload restarted the daemon (pid ${first_daemon_pid} → ${second_daemon_pid})"
  else
    fail "the reload restarted the daemon (before ${first_daemon_pid}, after ${second_daemon_pid})"
  fi

  # ── 2. SIGTERM: no leftover process ──
  local daemon_pid="${second_daemon_pid}"
  kill -TERM "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
  local waited=0
  while [[ "${waited}" -lt 100 ]]; do
    kill -0 "${SUPERVISOR_PID}" >/dev/null 2>&1 || break
    waited=$((waited + 1))
    sleep 0.2
  done
  if kill -0 "${SUPERVISOR_PID}" >/dev/null 2>&1; then
    fail "supervisor exits on SIGTERM"
    kill -KILL "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
  else
    pass "supervisor exits on SIGTERM"
  fi
  wait "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
  SUPERVISOR_PID=""

  waited=0
  while [[ "${waited}" -lt 50 ]]; do
    kill -0 "${daemon_pid}" >/dev/null 2>&1 || break
    waited=$((waited + 1))
    sleep 0.2
  done
  if kill -0 "${daemon_pid}" >/dev/null 2>&1; then
    fail "no KTX daemon is left behind after SIGTERM (pid ${daemon_pid})"
    kill -KILL "${daemon_pid}" >/dev/null 2>&1 || true
  else
    pass "no KTX daemon is left behind after SIGTERM"
  fi

  if [[ -f "${project_root}/.ktx-ui/ktx-reload.capability" ]]; then
    fail "the capability file is revoked when the supervisor stops"
  else
    pass "the capability file is revoked when the supervisor stops"
  fi

  # ── 3. first start failure must not run degraded ──
  local fail_root="${WORKDIR}/project-fail"
  mkdir -p "${fail_root}/.ktx-ui"
  printf 'connections:\n  demo:\n    host: db.example.test\n' > "${fail_root}/ktx.yaml"
  local fail_port
  fail_port="$(free_port)"
  set +e
  KTX_STUB_FAIL=1 \
  LUCY_ENTRYPOINT_SUPERVISOR_ONLY=1 \
  KTX_PROJECT_ROOT="${fail_root}" \
  KTX_MCP_HOST="127.0.0.1" \
  KTX_MCP_PORT="${fail_port}" \
  KTX_INTERNAL_TOKEN="stub-token" \
  PATH="${STUB_BIN}:${PATH}" \
    bash "${ENTRYPOINT}" >"${fail_root}/supervisor.log" 2>&1
  local fail_status=$?
  set -e
  if [[ "${fail_status}" -ne 0 ]]; then
    pass "a failed first start exits non-zero instead of running degraded (status ${fail_status})"
  else
    fail "a failed first start exits non-zero instead of running degraded (status ${fail_status})"
  fi

  # ── 4. spontaneous exit → bounded retry ──
  local exit_root="${WORKDIR}/project-exit"
  mkdir -p "${exit_root}/.ktx-ui"
  printf 'connections:\n  demo:\n    host: db.example.test\n' > "${exit_root}/ktx.yaml"
  local exit_port
  exit_port="$(free_port)"
  start_supervisor "${exit_root}" "${exit_port}"
  if wait_for_file "${exit_root}/.ktx-ui/ktx-ready" 40; then
    pass "the retry path reaches a ready daemon"
  else
    fail "the retry path reaches a ready daemon"
    cat "${exit_root}/supervisor.log" >&2 || true
  fi
  local first_pid
  first_pid="$(cat "${exit_root}/.ktx-ui/stub.pid" 2>/dev/null || true)"
  # Kill the daemon out from under the supervisor: it must be restarted.
  if [[ "${first_pid}" =~ ^[0-9]+$ ]]; then
    kill -KILL "${first_pid}" >/dev/null 2>&1 || true
  fi
  waited=0
  local new_pid=""
  while [[ "${waited}" -lt 100 ]]; do
    new_pid="$(cat "${exit_root}/.ktx-ui/stub.pid" 2>/dev/null || true)"
    if [[ -n "${new_pid}" && "${new_pid}" != "${first_pid}" ]]; then break; fi
    waited=$((waited + 1))
    sleep 0.2
  done
  if [[ -n "${new_pid}" && "${new_pid}" != "${first_pid}" ]]; then
    pass "a daemon that exits on its own is restarted (pid ${first_pid} → ${new_pid})"
  else
    fail "a daemon that exits on its own is restarted (before ${first_pid}, after ${new_pid})"
  fi
  kill -TERM "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
  wait "${SUPERVISOR_PID}" >/dev/null 2>&1 || true
  SUPERVISOR_PID=""
}

# ── container mode ───────────────────────────────────────────────────────────

run_container() {
  echo "== Spec 191 reload lifecycle — container mode =="
  local image="${LUCY_RELOAD_VERIFY_IMAGE:-}"
  if [[ -z "${image}" ]]; then
    echo "LUCY_RELOAD_VERIFY_IMAGE is required (this script never builds an image)" >&2
    return 2
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not available on this host" >&2
    return 2
  fi
  echo "using image ${image}"
  echo "NOT RUN: container mode has not executed the Step 8 checks" >&2
  echo "         (first-start failure, spontaneous exit, SIGTERM, exit code," >&2
  echo "         no leftover process). AC-12 stays open." >&2
  return 0
}

if [[ "${MODE}" == "container" ]]; then
  run_container
else
  run_local
fi

echo
if [[ "${FAILURES}" -gt 0 ]]; then
  echo "FAILED: ${FAILURES} of ${CHECKS} checks failed" >&2
  exit 1
fi
if [[ "${CHECKS}" -eq 0 ]]; then
  echo "NOT RUN: ${CHECKS} checks executed; this is not a pass" >&2
  exit 2
fi
echo "PASSED: ${CHECKS} checks"
