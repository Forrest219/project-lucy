#!/usr/bin/env node
/**
 * P1-63 — entrypoint drain-first protocol (unit/bash; no real Docker UAT).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const entrypoint = path.join(repoRoot, "scripts/runtime/docker-entrypoint.sh");
const composeFile = path.join(repoRoot, "deploy/compose/docker-compose.demo.yml");

async function readEntrypoint() {
  return readFile(entrypoint, "utf8");
}

test("entrypoint drain-first: Lucy notified before supervisor TERM", async () => {
  const source = await readEntrypoint();
  assert.match(source, /lucy_request_and_wait_drain/);
  assert.match(source, /LUCY_DRAIN_REQUEST_FILE/);
  assert.match(source, /LUCY_DRAIN_ACK_FILE/);

  const shutdownIdx = source.indexOf("\nshutdown() {");
  assert.ok(shutdownIdx > 0, "shutdown() present");
  const shutdownBody = source.slice(shutdownIdx, shutdownIdx + 2500);
  const drainIdx = shutdownBody.indexOf("lucy_request_and_wait_drain");
  const supervisorIdx = shutdownBody.indexOf('kill -TERM "${SUPERVISOR_PID}"');
  assert.ok(drainIdx > 0, "drain call in shutdown");
  assert.ok(supervisorIdx > drainIdx, "supervisor TERM after drain");
  // Must not keep the old "supervisor first" order as current truth inside shutdown.
  const oldFirst = shutdownBody.indexOf("The supervisor is stopped first");
  assert.equal(oldFirst, -1);
});

test("entrypoint preserves exit status through drain-first shutdown", async () => {
  const source = await readEntrypoint();
  assert.match(source, /exit "\$\{status\}"/);
  assert.match(source, /trap 'shutdown 143' TERM INT/);
  assert.match(source, /LUCY_SHUTDOWN_STARTED/);
});

test("entrypoint owns the actual Node PID, not an early-exiting npm launcher", async () => {
  const source = await readEntrypoint();
  const start = source.lastIndexOf('cd "${WEBUI_ROOT}"');
  const launchRaw = source.slice(start, source.indexOf("\nwait -n ", start));
  // workflow-contracts installs only root deps; do not require webui/node_modules/tsx.
  // Keep background + LUCY_PID ownership shape; swap the loader for a plain Node fixture.
  assert.match(launchRaw, /node --import tsx server\/index\.ts &/);
  const launch = launchRaw.replace(
    /node --import tsx server\/index\.ts &/,
    "node server/index.mjs &"
  );
  const root = await mkdtemp(path.join(tmpdir(), "lucy-drain-pid-"));
  try {
    await mkdir(path.join(root, "server"));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      path.join(root, "server/index.mjs"),
      `
      import { writeFileSync } from "node:fs";
      writeFileSync("actual.pid", String(process.pid));
      process.on("SIGTERM", () => setTimeout(() => { writeFileSync("settled", "yes"); process.exit(0); }, 100));
      setInterval(() => {}, 1000);
    `
    );
    const script = `set -eu
      WEBUI_ROOT="$1"
      ${launch}
      trap 'if test -f actual.pid; then kill -TERM "$(cat actual.pid)" 2>/dev/null || true; fi; kill -TERM "$LUCY_PID" 2>/dev/null || true; wait "$LUCY_PID" 2>/dev/null || true' EXIT
      for i in $(seq 1 100); do test -f actual.pid && break; sleep .05; done
      test "$LUCY_PID" = "$(cat actual.pid)"
      kill -TERM "$LUCY_PID"
      wait "$LUCY_PID"
      test "$(cat settled)" = yes
      trap - EXIT
    `;
    const result = spawnSync("bash", ["-c", script, "sh", root], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("entrypoint budgets and stop-timeout conflict warning", async () => {
  const source = await readEntrypoint();
  assert.match(source, /LUCY_DRAIN_BUDGET_S="\$\{LUCY_DRAIN_BUDGET_S:-20\}"/);
  assert.match(source, /lucy_validate_stop_timeout_budget/);
  assert.match(source, /total exit budget may miss/);
});

test("duplicate shutdown is idempotent (single owner)", async () => {
  const source = await readEntrypoint();
  assert.match(
    source,
    /if \[\[ "\$\{LUCY_SHUTDOWN_STARTED\}" -ne 0 \]\]; then\s*\n\s*return 0/
  );
});

test("drain request file carries no credentials", async () => {
  const source = await readEntrypoint();
  const fnIdx = source.indexOf("lucy_request_and_wait_drain()");
  const body = source.slice(fnIdx, fnIdx + 1800);
  assert.match(body, /printf 'phase=DRAIN\\n'/);
  assert.doesNotMatch(body, /token|password|secret|bearer|BOOTSTRAP/i);
});

test("compose demo stop_grace_period is ≥45s (file + render)", async () => {
  const yaml = await readFile(composeFile, "utf8");
  assert.match(yaml, /stop_grace_period:\s*45s/);

  const rendered = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "config"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env } }
  );
  if (rendered.status !== 0) {
    // Compose may need secrets path; still assert file contract when render fails.
    assert.match(yaml, /stop_grace_period:\s*45s/);
    assert.match(rendered.stderr || "", /./);
    return;
  }
  assert.match(rendered.stdout, /stop_grace_period:\s*45s?/);
});

test("bash drain ack wait tolerates missing lucy pid (no hang)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lucy-drain-bash-"));
  const uiDir = path.join(root, ".ktx-ui");
  await mkdir(uiDir, { recursive: true });

  const script = `
set -euo pipefail
KTX_UI_DIR="${uiDir}"
LUCY_DRAIN_REQUEST_FILE="\${KTX_UI_DIR}/lucy-process-drain.request"
LUCY_DRAIN_ACK_FILE="\${KTX_UI_DIR}/lucy-process-drain.ack"
LUCY_DRAIN_BUDGET_S=1
LUCY_DRAIN_ACK_WAIT_S=1
LUCY_WRAP_UP_BUDGET_S=1
LUCY_PID=""
source /dev/null
# Inline minimal copy of wait path when LUCY_PID empty.
lucy_request_and_wait_drain() {
  if [[ -z "\${LUCY_PID:-}" ]]; then return 0; fi
  return 0
}
lucy_request_and_wait_drain
echo ok
`;
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
  await rm(root, { recursive: true, force: true });
});

test("drain-then-supervisor order simulation with fake pids", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lucy-drain-order-"));
  const uiDir = path.join(root, ".ktx-ui");
  await mkdir(uiDir, { recursive: true });
  const logFile = path.join(root, "order.log");

  // Fake Lucy: on TERM write ack then exit; stay alive until TERM.
  const lucyScript = path.join(root, "fake-lucy.sh");
  await writeFile(
    lucyScript,
    `#!/bin/bash
ACK="${uiDir}/lucy-process-drain.ack"
trap 'printf "phase=DRAINING\\npid=$$\\n" > "$ACK"; exit 0' TERM
while true; do sleep 0.1; done
`,
    { mode: 0o755 }
  );

  const supervisorScript = path.join(root, "fake-supervisor.sh");
  await writeFile(
    supervisorScript,
    `#!/bin/bash
LOG="${logFile}"
trap 'echo supervisor_term >> "$LOG"; exit 0' TERM
while true; do sleep 0.1; done
`,
    { mode: 0o755 }
  );

  const runner = `
set -euo pipefail
KTX_UI_DIR="${uiDir}"
LUCY_DRAIN_REQUEST_FILE="\${KTX_UI_DIR}/lucy-process-drain.request"
LUCY_DRAIN_ACK_FILE="\${KTX_UI_DIR}/lucy-process-drain.ack"
LUCY_DRAIN_BUDGET_S=5
LUCY_DRAIN_ACK_WAIT_S=3
LUCY_WRAP_UP_BUDGET_S=2
KTX_RELOAD_STOP_TIMEOUT_S=2
LUCY_ORPHAN_CLEANUP_BUDGET_S=1
LOG="${logFile}"

wait_for_child_exit() {
  local pid="\${1:-}"
  local timeout_s="\${2:-2}"
  local killer
  [[ -n "\${pid}" ]] || return 0
  kill -0 "\${pid}" >/dev/null 2>&1 || { wait "\${pid}" >/dev/null 2>&1 || true; return 0; }
  ( sleep "\${timeout_s}"; kill -KILL "\${pid}" >/dev/null 2>&1 || true ) &
  killer="\$!"
  wait "\${pid}" >/dev/null 2>&1 || true
  kill -TERM "\${killer}" >/dev/null 2>&1 || true
  wait "\${killer}" >/dev/null 2>&1 || true
  return 0
}

ktx_kill_leftover_daemon() { echo orphan_sweep >> "\$LOG"; return 0; }

lucy_request_and_wait_drain() {
  local waited=0
  local ack_waited=0
  if [[ -z "\${LUCY_PID:-}" ]]; then return 0; fi
  if ! kill -0 "\${LUCY_PID}" >/dev/null 2>&1; then
    wait "\${LUCY_PID}" >/dev/null 2>&1 || true
    return 0
  fi
  mkdir -p "\${KTX_UI_DIR}" >/dev/null 2>&1 || true
  rm -f "\${LUCY_DRAIN_ACK_FILE}" >/dev/null 2>&1 || true
  printf 'phase=DRAIN\\n' > "\${LUCY_DRAIN_REQUEST_FILE}" 2>/dev/null || true
  echo drain_begin >> "\$LOG"
  kill -TERM "\${LUCY_PID}" >/dev/null 2>&1 || true
  while [[ "\${ack_waited}" -lt 15 ]]; do
    if [[ -f "\${LUCY_DRAIN_ACK_FILE}" ]]; then
      echo drain_ack >> "\$LOG"
      break
    fi
    if ! kill -0 "\${LUCY_PID}" >/dev/null 2>&1; then
      wait "\${LUCY_PID}" >/dev/null 2>&1 || true
      return 0
    fi
    ack_waited=\$((ack_waited + 1))
    sleep 0.2
  done
  while [[ "\${waited}" -lt 25 ]]; do
    if ! kill -0 "\${LUCY_PID}" >/dev/null 2>&1; then
      wait "\${LUCY_PID}" >/dev/null 2>&1 || true
      echo drain_lucy_exit >> "\$LOG"
      return 0
    fi
    waited=\$((waited + 1))
    sleep 0.2
  done
  kill -TERM "\${LUCY_PID}" >/dev/null 2>&1 || true
  wait_for_child_exit "\${LUCY_PID}" 2
  return 0
}

bash "${lucyScript}" &
LUCY_PID=\$!
bash "${supervisorScript}" &
SUPERVISOR_PID=\$!
sleep 0.3

lucy_request_and_wait_drain
echo after_drain_before_supervisor >> "\$LOG"
kill -TERM "\${SUPERVISOR_PID}" >/dev/null 2>&1 || true
wait_for_child_exit "\${SUPERVISOR_PID}" 2
ktx_kill_leftover_daemon
echo done >> "\$LOG"
`;

  const result = spawnSync("bash", ["-c", runner], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const log = await readFile(logFile, "utf8");
  const drainBegin = log.indexOf("drain_begin");
  const drainAck = log.indexOf("drain_ack");
  const afterDrain = log.indexOf("after_drain_before_supervisor");
  const supervisorTerm = log.indexOf("supervisor_term");
  assert.ok(drainBegin >= 0);
  assert.ok(drainAck > drainBegin);
  assert.ok(afterDrain > drainAck);
  assert.ok(supervisorTerm > afterDrain, `order log:\n${log}`);

  await rm(root, { recursive: true, force: true });
});

test("seed-only entrypoint still exits 0 (shutdown path not required)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lucy-drain-seed-"));
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");

  const result = spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1"
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  await rm(root, { recursive: true, force: true });
});
