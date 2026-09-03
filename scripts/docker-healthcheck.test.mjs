#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const HEALTHCHECK = path.join(ROOT, "scripts", "docker-healthcheck.sh");

async function runHealthcheck({ runtimeMode = "ready", nodeFailAt = "" } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-healthcheck-"));
  const binDir = path.join(dir, "bin");
  const nodeCountFile = path.join(dir, "node-count");
  await writeFile(nodeCountFile, "0\n", "utf8");
  await mkdir(binDir, { recursive: true });

  const ktxStub = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "@kaelio/ktx test"
  exit 0
fi
if [[ "\${1:-} \${2:-} \${3:-}" != "admin runtime status" ]]; then
  exit 2
fi
case "\${STUB_RUNTIME_MODE:-ready}" in
  ready)
    echo "status: ready"
    for ((i = 0; i < 5000; i++)); do
      printf 'feature-%05d: available-and-ready-for-use\\n' "\$i"
    done
    ;;
  not-ready)
    echo "status: installing"
    ;;
  failure)
    exit 7
    ;;
esac
`;
  const nodeStub = `#!/usr/bin/env bash
set -euo pipefail
count="\$(<"\${STUB_NODE_COUNT_FILE}")"
count="\$((count + 1))"
printf '%s\\n' "\${count}" > "\${STUB_NODE_COUNT_FILE}"
if [[ -n "\${STUB_NODE_FAIL_AT:-}" && "\${count}" == "\${STUB_NODE_FAIL_AT}" ]]; then
  exit 9
fi
exit 0
`;
  await writeFile(path.join(binDir, "ktx"), ktxStub, "utf8");
  await writeFile(path.join(binDir, "node"), nodeStub, "utf8");
  await chmod(path.join(binDir, "ktx"), 0o755);
  await chmod(path.join(binDir, "node"), 0o755);

  try {
    const result = spawnSync("bash", [HEALTHCHECK], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        STUB_RUNTIME_MODE: runtimeMode,
        STUB_NODE_COUNT_FILE: nodeCountFile,
        STUB_NODE_FAIL_AT: nodeFailAt
      },
      encoding: "utf8"
    });
    return {
      ...result,
      nodeCalls: Number((await readFile(nodeCountFile, "utf8")).trim())
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("accepts ready runtime output even when the producer writes beyond the pipe buffer", async () => {
  const result = await runHealthcheck();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.nodeCalls, 2);
});

test("fails closed when the runtime status command fails", async () => {
  const result = await runHealthcheck({ runtimeMode: "failure" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ktx runtime status command failed/);
  assert.equal(result.nodeCalls, 0);
});

test("fails closed when the runtime is not ready", async () => {
  const result = await runHealthcheck({ runtimeMode: "not-ready" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /ktx runtime not ready/);
  assert.equal(result.nodeCalls, 0);
});

test("fails when the WebUI probe fails", async () => {
  const result = await runHealthcheck({ nodeFailAt: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(result.nodeCalls, 1);
});

test("fails when the MCP proxy probe fails", async () => {
  const result = await runHealthcheck({ nodeFailAt: "2" });
  assert.notEqual(result.status, 0);
  assert.equal(result.nodeCalls, 2);
});
