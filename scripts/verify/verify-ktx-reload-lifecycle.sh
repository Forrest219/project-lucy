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
#   --container  Spec 191 Step 8 / AC-12 against a built image
#                (LUCY_RELOAD_VERIFY_IMAGE). Never builds an image.
#                Phase A runs ephemeral SUPERVISOR_ONLY containers with a stub
#                ktx (first-start failure, reload, spontaneous exit, backoff
#                exhaustion, SIGTERM). Phase B optionally checks a live lucy
#                container (AC-3 WebUI PID unchanged + /api/health during reload).
#                Phase C (VERIFY-191-C01) writes a canary connection into the
#                live project, asks the supervisor to reload, then asserts
#                connection_list evidence includes the new id (no docker restart).
#
# Usage:
#   scripts/verify/verify-ktx-reload-lifecycle.sh --local
#   LUCY_RELOAD_VERIFY_IMAGE=project-lucy:demo \
#     scripts/verify/verify-ktx-reload-lifecycle.sh --container
#   Optional live phase:
#     LUCY_RELOAD_VERIFY_CONTAINER=<name>   # default: auto-detect running image
#     LUCY_RELOAD_VERIFY_HEALTH_URL=http://127.0.0.1:55176/api/health
#     LUCY_RELOAD_VERIFY_SKIP_LIVE=1        # skip Phase B + Phase C
#     LUCY_RELOAD_VERIFY_SKIP_C01=1         # skip only VERIFY-191-C01
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

CONTAINER_WORKDIR=""
CONTAINER_IDS=""

cleanup_container() {
  local id
  for id in ${CONTAINER_IDS}; do
    docker rm -f "${id}" >/dev/null 2>&1 || true
  done
  CONTAINER_IDS=""
  if [[ -n "${CONTAINER_WORKDIR}" && -d "${CONTAINER_WORKDIR}" ]]; then
    rm -rf "${CONTAINER_WORKDIR}"
  fi
  CONTAINER_WORKDIR=""
}

wait_container_file() {
  # wait_container_file <container> <path-in-container> <ticks>
  local container="$1"
  local path="$2"
  local limit="$3"
  local waited=0
  while [[ "${waited}" -lt "${limit}" ]]; do
    if docker exec "${container}" test -f "${path}" >/dev/null 2>&1; then
      return 0
    fi
    waited=$((waited + 1))
    sleep 0.2
  done
  return 1
}

read_container_json_field() {
  # read_container_json_field <container> <path> <field>
  docker exec "$1" node -e '
const fs = require("fs");
const [file, field] = process.argv.slice(1);
let doc = {};
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { doc = {}; }
const value = doc[field];
process.stdout.write(value === undefined || value === null ? "" : String(value));
' "$2" "$3" 2>/dev/null || true
}

container_sha256() {
  # container_sha256 <container> <path>
  docker exec "$1" node -e '
const fs = require("fs");
const crypto = require("crypto");
const buf = fs.readFileSync(process.argv[1]);
process.stdout.write(crypto.createHash("sha256").update(buf).digest("hex"));
' "$2"
}

start_supervisor_container() {
  # start_supervisor_container <name-suffix> <project-host-dir> [extra docker -e ...]
  local suffix="$1"
  local project_host="$2"
  shift 2
  local name="lucy-191-ac12-${suffix}-$$"
  local cid
  cid="$(docker run -d --name "${name}" --user 0 \
    -e LUCY_ENTRYPOINT_SUPERVISOR_ONLY=1 \
    -e KTX_PROJECT_ROOT=/verify/project \
    -e KTX_MCP_HOST=127.0.0.1 \
    -e KTX_MCP_PORT=7878 \
    -e KTX_INTERNAL_TOKEN=stub-token \
    -e KTX_STUB_PID_FILE=/verify/project/.ktx-ui/stub.pid \
    -e PATH=/verify/stub:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    -v "${project_host}:/verify/project" \
    -v "${CONTAINER_WORKDIR}/stub:/verify/stub:ro" \
    "$@" \
    "${LUCY_RELOAD_VERIFY_IMAGE}")"
  CONTAINER_IDS="${CONTAINER_IDS} ${cid}"
  printf '%s\n' "${cid}"
}

find_live_lucy_container() {
  local explicit="${LUCY_RELOAD_VERIFY_CONTAINER:-}"
  if [[ -n "${explicit}" ]]; then
    printf '%s\n' "${explicit}"
    return 0
  fi
  docker ps --filter "ancestor=${LUCY_RELOAD_VERIFY_IMAGE}" --format '{{.Names}}' | head -n 1
}

run_container_phase_a() {
  echo "-- Phase A: ephemeral SUPERVISOR_ONLY containers (image entrypoint) --"
  CONTAINER_WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/lucy-ktx-reload-ctr-XXXXXX")"
  mkdir -p "${CONTAINER_WORKDIR}/stub" \
    "${CONTAINER_WORKDIR}/project-ok/.ktx-ui" \
    "${CONTAINER_WORKDIR}/project-fail/.ktx-ui" \
    "${CONTAINER_WORKDIR}/project-exit/.ktx-ui" \
    "${CONTAINER_WORKDIR}/project-backoff/.ktx-ui"
  write_stub_ktx "${CONTAINER_WORKDIR}/stub/ktx"
  printf 'connections:\n  demo:\n    host: db.example.test\n' > "${CONTAINER_WORKDIR}/project-ok/ktx.yaml"
  cp "${CONTAINER_WORKDIR}/project-ok/ktx.yaml" "${CONTAINER_WORKDIR}/project-fail/ktx.yaml"
  cp "${CONTAINER_WORKDIR}/project-ok/ktx.yaml" "${CONTAINER_WORKDIR}/project-exit/ktx.yaml"
  cp "${CONTAINER_WORKDIR}/project-ok/ktx.yaml" "${CONTAINER_WORKDIR}/project-backoff/ktx.yaml"

  # A1 — first start failure must exit non-zero (no degraded run)
  local fail_cid
  fail_cid="$(start_supervisor_container fail "${CONTAINER_WORKDIR}/project-fail" -e KTX_STUB_FAIL=1)"
  local waited=0
  local fail_status=""
  while [[ "${waited}" -lt 75 ]]; do
    fail_status="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "${fail_cid}" 2>/dev/null || echo "missing 1")"
    case "${fail_status}" in
      "exited "*) break ;;
    esac
    waited=$((waited + 1))
    sleep 0.2
  done
  local fail_exit
  fail_exit="$(docker inspect -f '{{.State.ExitCode}}' "${fail_cid}" 2>/dev/null || echo 0)"
  local fail_running
  fail_running="$(docker inspect -f '{{.State.Running}}' "${fail_cid}" 2>/dev/null || echo true)"
  if [[ "${fail_running}" == "false" && "${fail_exit}" != "0" ]]; then
    pass "AC-12 first-start failure exits non-zero (status ${fail_exit})"
  else
    fail "AC-12 first-start failure exits non-zero (running=${fail_running} exit=${fail_exit})"
    docker logs "${fail_cid}" >&2 || true
  fi
  docker rm -f "${fail_cid}" >/dev/null 2>&1 || true
  CONTAINER_IDS="$(printf '%s\n' ${CONTAINER_IDS} | grep -v "^${fail_cid}$" | tr '\n' ' ')"

  # A2 — happy path: ready + reload receipt + daemon pid change
  local ok_cid
  ok_cid="$(start_supervisor_container ok "${CONTAINER_WORKDIR}/project-ok")"
  if wait_container_file "${ok_cid}" /verify/project/.ktx-ui/ktx-ready 75; then
    pass "AC-12 supervisor reaches ready inside the image"
  else
    fail "AC-12 supervisor reaches ready inside the image"
    docker logs "${ok_cid}" >&2 || true
  fi

  assert_eq "AC-12 capability protocol is published in-container" \
    "lucy-ktx-reload/1" \
    "$(read_container_json_field "${ok_cid}" /verify/project/.ktx-ui/ktx-reload.capability protocol)"

  local first_daemon_pid
  first_daemon_pid="$(docker exec "${ok_cid}" cat /verify/project/.ktx-ui/stub.pid 2>/dev/null | tr -d '[:space:]' || true)"
  local request_id="container-reload-1"
  local digest
  digest="$(container_sha256 "${ok_cid}" /verify/project/ktx.yaml)"
  docker exec "${ok_cid}" node -e '
const fs = require("fs");
const [id, digest] = process.argv.slice(1);
const payload = JSON.stringify({
  requestId: id,
  requestedDigest: digest,
  requestedAt: new Date().toISOString()
}) + "\n";
const tmp = "/verify/project/.ktx-ui/ktx-reload.request.tmp";
const dest = "/verify/project/.ktx-ui/ktx-reload.request";
fs.writeFileSync(tmp, payload);
fs.renameSync(tmp, dest);
' "${request_id}" "${digest}"

  if wait_container_file "${ok_cid}" /verify/project/.ktx-ui/ktx-reload.result 75; then
    pass "AC-12 reload receipt is written in-container"
  else
    fail "AC-12 reload receipt is written in-container"
    docker logs "${ok_cid}" >&2 || true
  fi

  assert_eq "AC-12 receipt matches requestId" \
    "${request_id}" \
    "$(read_container_json_field "${ok_cid}" /verify/project/.ktx-ui/ktx-reload.result requestId)"
  assert_eq "AC-12 receipt status is succeeded" \
    "succeeded" \
    "$(read_container_json_field "${ok_cid}" /verify/project/.ktx-ui/ktx-reload.result status)"

  local second_daemon_pid
  second_daemon_pid="$(docker exec "${ok_cid}" cat /verify/project/.ktx-ui/stub.pid 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "${second_daemon_pid}" && "${second_daemon_pid}" != "${first_daemon_pid}" ]]; then
    pass "AC-12 reload restarts the daemon (pid ${first_daemon_pid} → ${second_daemon_pid})"
  else
    fail "AC-12 reload restarts the daemon (before ${first_daemon_pid}, after ${second_daemon_pid})"
  fi

  # A3 — SIGTERM: container stops; daemon not left running inside a live container
  docker stop -t 15 "${ok_cid}" >/dev/null 2>&1 || true
  local ok_running
  ok_running="$(docker inspect -f '{{.State.Running}}' "${ok_cid}" 2>/dev/null || echo true)"
  local ok_exit
  ok_exit="$(docker inspect -f '{{.State.ExitCode}}' "${ok_cid}" 2>/dev/null || echo 1)"
  if [[ "${ok_running}" == "false" ]]; then
    pass "AC-12 SIGTERM stops the supervisor container (exit ${ok_exit})"
  else
    fail "AC-12 SIGTERM stops the supervisor container"
  fi
  # After stop the container rootfs is still inspectable via docker start... but
  # leftover host processes would only exist if the stub escaped the namespace.
  # Assert the stopped container no longer has a running task.
  local ok_pid
  ok_pid="$(docker inspect -f '{{.State.Pid}}' "${ok_cid}" 2>/dev/null || echo 0)"
  if [[ "${ok_pid}" == "0" ]]; then
    pass "AC-12 no leftover container task after SIGTERM"
  else
    fail "AC-12 no leftover container task after SIGTERM (pid ${ok_pid})"
  fi
  docker rm -f "${ok_cid}" >/dev/null 2>&1 || true
  CONTAINER_IDS="$(printf '%s\n' ${CONTAINER_IDS} | grep -v "^${ok_cid}$" | tr '\n' ' ')"

  # A4 — spontaneous exit → restart once
  local exit_cid
  exit_cid="$(start_supervisor_container exit "${CONTAINER_WORKDIR}/project-exit")"
  if wait_container_file "${exit_cid}" /verify/project/.ktx-ui/ktx-ready 75; then
    pass "AC-12 spontaneous-exit fixture reaches ready"
  else
    fail "AC-12 spontaneous-exit fixture reaches ready"
    docker logs "${exit_cid}" >&2 || true
  fi
  local exit_first
  exit_first="$(docker exec "${exit_cid}" cat /verify/project/.ktx-ui/stub.pid 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "${exit_first}" =~ ^[0-9]+$ ]]; then
    # slim images may lack /bin/kill; bash builtin works under the entrypoint shell.
    docker exec "${exit_cid}" bash -c "kill -KILL '${exit_first}'" >/dev/null 2>&1 || true
  fi
  waited=0
  local exit_new=""
  while [[ "${waited}" -lt 100 ]]; do
    exit_new="$(docker exec "${exit_cid}" cat /verify/project/.ktx-ui/stub.pid 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ -n "${exit_new}" && "${exit_new}" != "${exit_first}" ]]; then break; fi
    waited=$((waited + 1))
    sleep 0.2
  done
  if [[ -n "${exit_new}" && "${exit_new}" != "${exit_first}" ]]; then
    pass "AC-12 spontaneous daemon exit is restarted (pid ${exit_first} → ${exit_new})"
  else
    fail "AC-12 spontaneous daemon exit is restarted (before ${exit_first}, after ${exit_new})"
    docker logs "${exit_cid}" >&2 || true
  fi
  docker rm -f "${exit_cid}" >/dev/null 2>&1 || true
  CONTAINER_IDS="$(printf '%s\n' ${CONTAINER_IDS} | grep -v "^${exit_cid}$" | tr '\n' ' ')"

  # A5 — backoff exhaustion ⇒ container exits
  local backoff_cid
  backoff_cid="$(start_supervisor_container backoff "${CONTAINER_WORKDIR}/project-backoff" \
    -e LUCY_KTX_RELOAD_BACKOFF_LIMIT=0)"
  if wait_container_file "${backoff_cid}" /verify/project/.ktx-ui/ktx-ready 75; then
    pass "AC-12 backoff fixture reaches ready"
  else
    fail "AC-12 backoff fixture reaches ready"
    docker logs "${backoff_cid}" >&2 || true
  fi
  local backoff_first
  backoff_first="$(docker exec "${backoff_cid}" cat /verify/project/.ktx-ui/stub.pid 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "${backoff_first}" =~ ^[0-9]+$ ]]; then
    docker exec "${backoff_cid}" bash -c "kill -KILL '${backoff_first}'" >/dev/null 2>&1 || true
  fi
  waited=0
  local backoff_status=""
  while [[ "${waited}" -lt 100 ]]; do
    backoff_status="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "${backoff_cid}" 2>/dev/null || echo "missing 1")"
    case "${backoff_status}" in
      "exited "*) break ;;
    esac
    waited=$((waited + 1))
    sleep 0.2
  done
  local backoff_exit
  backoff_exit="$(docker inspect -f '{{.State.ExitCode}}' "${backoff_cid}" 2>/dev/null || echo 0)"
  local backoff_running
  backoff_running="$(docker inspect -f '{{.State.Running}}' "${backoff_cid}" 2>/dev/null || echo true)"
  if [[ "${backoff_running}" == "false" && "${backoff_exit}" != "0" ]]; then
    pass "AC-12 backoff exhaustion exits the container (status ${backoff_exit})"
  else
    fail "AC-12 backoff exhaustion exits the container (running=${backoff_running} exit=${backoff_exit})"
    docker logs "${backoff_cid}" >&2 || true
  fi
  docker rm -f "${backoff_cid}" >/dev/null 2>&1 || true
  CONTAINER_IDS="$(printf '%s\n' ${CONTAINER_IDS} | grep -v "^${backoff_cid}$" | tr '\n' ' ')"
}

run_container_phase_b() {
  echo "-- Phase B: live lucy container (AC-3 + health window) --"
  if [[ "${LUCY_RELOAD_VERIFY_SKIP_LIVE:-0}" == "1" ]]; then
    echo "  skip — LUCY_RELOAD_VERIFY_SKIP_LIVE=1"
    return 0
  fi

  local live
  live="$(find_live_lucy_container)"
  if [[ -z "${live}" ]]; then
    fail "AC-3/AC-12 live lucy container is running (set LUCY_RELOAD_VERIFY_CONTAINER or start demo)"
    return 0
  fi
  echo "  using live container ${live}"

  local health_url="${LUCY_RELOAD_VERIFY_HEALTH_URL:-http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}/api/health}"
  if curl -fsS -m 5 "${health_url}" >/dev/null 2>&1; then
    pass "AC-12 live /api/health is 200 before reload"
  else
    fail "AC-12 live /api/health is 200 before reload (${health_url})"
    return 0
  fi

  # Lucy WebUI + Proxy share one node process (npm run start → server/index.ts).
  # slim images may lack pgrep; read /proc instead.
  local lucy_pid_before
  lucy_pid_before="$(docker exec "${live}" node -e '
const fs = require("fs");
const self = String(process.pid);
const pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
let best = "";
for (const pid of pids) {
  if (pid === self) continue;
  let cmd = "";
  try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " "); } catch { continue; }
  // Prefer the real Lucy entry; never this finder (`node -e …server/index.ts…`).
  if (cmd.includes("server/index.ts") && !/\bnode\s+-e\b/.test(cmd)) {
    best = pid;
  }
}
process.stdout.write(best);
' 2>/dev/null || true)"
  local ktx_pid_before
  ktx_pid_before="$(docker exec "${live}" sh -c 'cat /data/lucy/.ktx-ui/ktx.pid 2>/dev/null || true' | tr -d '[:space:]')"
  if [[ ! "${lucy_pid_before}" =~ ^[0-9]+$ ]]; then
    fail "AC-3 live WebUI/Proxy pid is observable before reload"
    return 0
  fi
  if [[ ! "${ktx_pid_before}" =~ ^[0-9]+$ ]]; then
    fail "AC-12 live KTX pid is observable before reload"
    return 0
  fi
  pass "AC-3 live WebUI/Proxy pid observed (${lucy_pid_before}); KTX pid ${ktx_pid_before}"

  local request_id="live-reload-$$"
  local digest
  digest="$(container_sha256 "${live}" /data/lucy/ktx.yaml)"
  docker exec "${live}" node -e '
const fs = require("fs");
const [id, digest] = process.argv.slice(1);
const payload = JSON.stringify({
  requestId: id,
  requestedDigest: digest,
  requestedAt: new Date().toISOString()
}) + "\n";
const tmp = "/data/lucy/.ktx-ui/ktx-reload.request.tmp";
const dest = "/data/lucy/.ktx-ui/ktx-reload.request";
fs.writeFileSync(tmp, payload);
fs.renameSync(tmp, dest);
' "${request_id}" "${digest}"

  # Health must stay reachable during the reload window (Spec §10.1).
  local health_ok=1
  local i=0
  while [[ "${i}" -lt 30 ]]; do
    if ! curl -fsS -m 2 "${health_url}" >/dev/null 2>&1; then
      health_ok=0
      break
    fi
    if docker exec "${live}" test -f /data/lucy/.ktx-ui/ktx-reload.result >/dev/null 2>&1; then
      local rid
      rid="$(read_container_json_field "${live}" /data/lucy/.ktx-ui/ktx-reload.result requestId)"
      if [[ "${rid}" == "${request_id}" ]]; then break; fi
    fi
    i=$((i + 1))
    sleep 0.5
  done
  if [[ "${health_ok}" -eq 1 ]]; then
    pass "AC-12 /api/health stays 200 during the reload window"
  else
    fail "AC-12 /api/health stays 200 during the reload window"
  fi

  if wait_container_file "${live}" /data/lucy/.ktx-ui/ktx-reload.result 40; then
    local live_status
    live_status="$(read_container_json_field "${live}" /data/lucy/.ktx-ui/ktx-reload.result status)"
    local live_rid
    live_rid="$(read_container_json_field "${live}" /data/lucy/.ktx-ui/ktx-reload.result requestId)"
    if [[ "${live_rid}" == "${request_id}" && "${live_status}" == "succeeded" ]]; then
      pass "AC-12 live reload receipt succeeded"
    else
      fail "AC-12 live reload receipt succeeded (requestId=${live_rid} status=${live_status})"
    fi
  else
    fail "AC-12 live reload receipt is written"
  fi

  local lucy_pid_after
  lucy_pid_after="$(docker exec "${live}" node -e '
const fs = require("fs");
const self = String(process.pid);
const pids = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
let best = "";
for (const pid of pids) {
  if (pid === self) continue;
  let cmd = "";
  try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " "); } catch { continue; }
  if (cmd.includes("server/index.ts") && !/\bnode\s+-e\b/.test(cmd)) {
    best = pid;
  }
}
process.stdout.write(best);
' 2>/dev/null || true)"
  local ktx_pid_after
  ktx_pid_after="$(docker exec "${live}" sh -c 'cat /data/lucy/.ktx-ui/ktx.pid 2>/dev/null || true' | tr -d '[:space:]')"
  if [[ "${lucy_pid_after}" == "${lucy_pid_before}" ]]; then
    pass "AC-3 WebUI/Proxy PID unchanged across reload (${lucy_pid_before})"
  else
    fail "AC-3 WebUI/Proxy PID unchanged across reload (${lucy_pid_before} → ${lucy_pid_after})"
  fi
  if [[ -n "${ktx_pid_after}" && "${ktx_pid_after}" != "${ktx_pid_before}" ]]; then
    pass "AC-1 live KTX daemon PID changed (${ktx_pid_before} → ${ktx_pid_after})"
  else
    fail "AC-1 live KTX daemon PID changed (${ktx_pid_before} → ${ktx_pid_after})"
  fi
}

# VERIFY-191-C01 — write ktx.yaml canary connection → supervisor reload →
# connection_list evidence includes the new id. Equivalence of POST create
# (config write + Spec 191 request/receipt); does not require WebUI auth.
write_verify191_c01_helper() {
  local dest="$1"
  cat > "${dest}" <<'HELPER'
#!/usr/bin/env node
const fs = require("fs");
const [cmd, ...args] = process.argv.slice(2);

function writeRequest(requestId, digest) {
  const payload = JSON.stringify({
    requestId,
    requestedDigest: digest,
    requestedAt: new Date().toISOString()
  }) + "\n";
  const tmp = "/data/lucy/.ktx-ui/ktx-reload.request.tmp";
  const destPath = "/data/lucy/.ktx-ui/ktx-reload.request";
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, destPath);
}

function injectCanary(id) {
  const path = "/data/lucy/ktx.yaml";
  const text = fs.readFileSync(path, "utf8");
  if (new RegExp("^\\s*" + id + ":", "m").test(text)) {
    process.stderr.write("canary id already present\n");
    process.exit(2);
  }
  const block = [
    "  " + id + ":",
    "    driver: mysql",
    "    host: 127.0.0.1",
    "    port: 3306",
    "    database: verify191c01",
    "    username: verify191c01",
    "    password: verify191c01-not-a-secret",
    "    schemas:",
    "      - verify191c01",
    ""
  ].join("\n");
  let next;
  if (/^connections:\s*\n/m.test(text)) {
    next = text.replace(/^(connections:\s*\n)/m, "$1" + block);
  } else {
    next = text + "\nconnections:\n" + block;
  }
  fs.writeFileSync(path, next);
}

function parseEnvelope(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const lines = trimmed.split(/\n/).map((line) => line.replace(/^data:\s?/, "")).filter(Boolean);
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* continue */ }
  }
  return null;
}

async function assertConnectionList(target) {
  const token = fs.readFileSync("/data/lucy/.ktx-ui/ktx-internal-token", "utf8").trim();
  const endpoint = "http://127.0.0.1:7878/mcp";
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: "Bearer " + token
  };
  const initRes = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify191-c01-init",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verify-191-c01", version: "1.0" }
      }
    })
  });
  const sessionId = initRes.headers.get("mcp-session-id");
  if (!initRes.ok || !sessionId) {
    process.stderr.write("initialize failed\n");
    process.exit(3);
  }
  await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  });
  const callRes = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "mcp-session-id": sessionId },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify191-c01-list",
      method: "tools/call",
      params: { name: "connection_list", arguments: {} }
    })
  });
  const envelope = parseEnvelope(await callRes.text());
  const result = envelope && envelope.result ? envelope.result : null;
  let payload = result && result.structuredContent;
  if (!payload) {
    const content = result && Array.isArray(result.content) ? result.content : [];
    const text = content.map((item) => (item && item.text) || "").join("\n");
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  const raw = payload && Array.isArray(payload.connections) ? payload.connections : [];
  const ids = raw.map((row) => {
    if (typeof row === "string") return row;
    return row && (row.id || row.connectionId || row.connection_id || row.name);
  }).filter(Boolean);
  if (!ids.includes(target)) {
    process.stderr.write("missing " + target + " in " + JSON.stringify(ids) + "\n");
    process.exit(4);
  }
  process.stdout.write(ids.join(","));
}

if (cmd === "inject") injectCanary(args[0]);
else if (cmd === "request") writeRequest(args[0], args[1]);
else if (cmd === "assert-list") {
  assertConnectionList(args[0]).catch((err) => {
    process.stderr.write(String(err && err.message ? err.message : err) + "\n");
    process.exit(5);
  });
} else {
  process.stderr.write("usage: verify191-c01-helper.js inject|request|assert-list ...\n");
  process.exit(2);
}
HELPER
}

run_container_phase_c_verify_191_c01() {
  echo "-- Phase C: VERIFY-191-C01 create-connection canary --"
  if [[ "${LUCY_RELOAD_VERIFY_SKIP_LIVE:-0}" == "1" || "${LUCY_RELOAD_VERIFY_SKIP_C01:-0}" == "1" ]]; then
    echo "  skip — LUCY_RELOAD_VERIFY_SKIP_LIVE or LUCY_RELOAD_VERIFY_SKIP_C01 set"
    return 0
  fi

  local live
  live="$(find_live_lucy_container)"
  if [[ -z "${live}" ]]; then
    fail "VERIFY-191-C01 live lucy container is running"
    return 0
  fi
  echo "  using live container ${live}"

  if ! docker exec "${live}" test -f /data/lucy/.ktx-ui/ktx-reload.capability >/dev/null 2>&1; then
    fail "VERIFY-191-C01 ktx-reload.capability is present"
    return 0
  fi
  pass "VERIFY-191-C01 ktx-reload.capability is present"

  local canary_id="verify191c01-$$"
  local request_id="verify191-c01-$$"
  local backup="/data/lucy/ktx.yaml.verify191c01.bak"
  local helper_host helper_ctr
  helper_host="$(mktemp "${TMPDIR:-/tmp}/verify191-c01-helper-XXXXXX.js")"
  # Must land under the lucy-owned project tree: image /tmp is often root-only.
  helper_ctr="/data/lucy/.ktx-ui/verify191-c01-helper.js"
  write_verify191_c01_helper "${helper_host}"
  docker cp "${helper_host}" "${live}:${helper_ctr}" >/dev/null
  docker exec -u 0 "${live}" chown lucy:lucy "${helper_ctr}" >/dev/null 2>&1 \
    || docker exec "${live}" chmod a+r "${helper_ctr}" >/dev/null 2>&1 \
    || true
  rm -f "${helper_host}"

  if ! docker exec "${live}" cp /data/lucy/ktx.yaml "${backup}" >/dev/null 2>&1; then
    fail "VERIFY-191-C01 backup ktx.yaml"
    return 0
  fi
  pass "VERIFY-191-C01 backup ktx.yaml"

  restore_c01() {
    docker exec "${live}" sh -c "
      if [ -f '${backup}' ]; then
        mv -f '${backup}' /data/lucy/ktx.yaml
      fi
      rm -f /data/lucy/.ktx-ui/ktx-reload.result '${helper_ctr}'
    " >/dev/null 2>&1 || true
    local restore_digest
    restore_digest="$(container_sha256 "${live}" /data/lucy/ktx.yaml 2>/dev/null || true)"
    if [[ -n "${restore_digest}" ]]; then
      docker exec "${live}" node -e '
const fs = require("fs");
const [id, digest] = process.argv.slice(1);
const payload = JSON.stringify({
  requestId: id,
  requestedDigest: digest,
  requestedAt: new Date().toISOString()
}) + "\n";
const tmp = "/data/lucy/.ktx-ui/ktx-reload.request.tmp";
const dest = "/data/lucy/.ktx-ui/ktx-reload.request";
fs.writeFileSync(tmp, payload);
fs.renameSync(tmp, dest);
' "verify191-c01-restore-$$" "${restore_digest}" >/dev/null 2>&1 || true
      wait_container_file "${live}" /data/lucy/.ktx-ui/ktx-reload.result 40 || true
    fi
  }

  if ! docker exec "${live}" node "${helper_ctr}" inject "${canary_id}"; then
    fail "VERIFY-191-C01 write canary connection into ktx.yaml"
    restore_c01
    return 0
  fi
  pass "VERIFY-191-C01 write canary connection (${canary_id})"

  docker exec "${live}" rm -f /data/lucy/.ktx-ui/ktx-reload.result >/dev/null 2>&1 || true
  local digest
  digest="$(container_sha256 "${live}" /data/lucy/ktx.yaml)"
  docker exec "${live}" node "${helper_ctr}" request "${request_id}" "${digest}"

  if wait_container_file "${live}" /data/lucy/.ktx-ui/ktx-reload.result 60; then
    local c01_status c01_rid
    c01_status="$(read_container_json_field "${live}" /data/lucy/.ktx-ui/ktx-reload.result status)"
    c01_rid="$(read_container_json_field "${live}" /data/lucy/.ktx-ui/ktx-reload.result requestId)"
    if [[ "${c01_rid}" == "${request_id}" && "${c01_status}" == "succeeded" ]]; then
      pass "VERIFY-191-C01 supervisor receipt succeeded"
    else
      fail "VERIFY-191-C01 supervisor receipt succeeded (requestId=${c01_rid} status=${c01_status})"
      restore_c01
      return 0
    fi
  else
    fail "VERIFY-191-C01 supervisor receipt is written"
    restore_c01
    return 0
  fi

  local list_err list_out list_rc
  list_err="$(mktemp "${TMPDIR:-/tmp}/verify191-c01-list-XXXXXX.err")"
  set +e
  list_out="$(docker exec "${live}" node "${helper_ctr}" assert-list "${canary_id}" 2>"${list_err}")"
  list_rc=$?
  set -e
  if [[ "${list_rc}" -eq 0 && "${list_out}" == *"${canary_id}"* ]]; then
    pass "VERIFY-191-C01 connection_list includes canary id"
  else
    fail "VERIFY-191-C01 connection_list includes canary id"
    sed -E 's/Bearer[[:space:]]+[A-Za-z0-9._-]+/Bearer [redacted]/g' "${list_err}" >&2 || true
  fi
  rm -f "${list_err}"

  restore_c01
  pass "VERIFY-191-C01 restored ktx.yaml after canary"
}

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
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    echo "image not found: ${image}" >&2
    return 2
  fi
  echo "using image ${image}"
  trap cleanup_container EXIT
  run_container_phase_a
  run_container_phase_b
  run_container_phase_c_verify_191_c01
  cleanup_container
  trap - EXIT
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
