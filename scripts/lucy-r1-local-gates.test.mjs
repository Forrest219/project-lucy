import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-local-gates.mjs");

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("R1 local gates list matches the runbook local release gate surface", () => {
  const result = runScript(["--list"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  const commands = output.gates.map((gate) => gate.command);
  for (const command of [
    "npm run r1:readiness",
    "npm run lint:spec",
    "npm run security:baseline",
    "npm run r1:mcp-contract:test",
    "npm run r1:doris-smoke:test",
    "npm run r1:hermes-report:test",
    "npm run r1:readiness:test",
    "npm run r1:release-bundle:test",
    "npm run r1:status:test",
    "(cd webui && npm test)",
    "(cd webui && npm run build)"
  ]) {
    assert(commands.includes(command), `missing local gate command: ${command}`);
  }
});

test("R1 local gates dry run prints every gate without executing them", () => {
  const result = runScript(["--dry-run"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /DRY-RUN r1-readiness/);
  assert.match(result.stdout, /DRY-RUN webui-build/);
  assert.match(result.stdout, /PASS \(dry run\) 11 local gate\(s\)/);
});
