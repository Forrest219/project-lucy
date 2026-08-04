import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "verify-202608-access-governance-gate.mjs");

// The verify script imports `better-sqlite3` and the gate's TypeScript
// modules, all of which live under `webui/`. Spawn it from `webui/` so
// Node resolves bare specifiers out of the correct `node_modules` tree.
const WEBUI_DIR = path.join(ROOT, "webui");

function runScript(args) {
  // The script imports `.ts` files via `./trace/evidence.js` aliases, so
  // the child process needs the same tsx loader that `verify:gate` uses.
  return spawnSync(process.execPath, ["--import", "tsx/esm", SCRIPT, ...args], {
    cwd: WEBUI_DIR,
    encoding: "utf8"
  });
}

function parseOutput(result) {
  if (result.stderr && result.stderr.trim() !== "${SCRIPT} crashed:") {
    // Surface the underlying failure for easy debugging without failing
    // the test on the noisy tail of the script's stderr.
    process.stderr.write(result.stderr);
  }
  // The verify script prints summary lines interleaved with the JSON
  // summary footer. Locate the JSON `--- SUMMARY ---` block and parse it.
  const match = result.stdout.match(/--- SUMMARY ---\s*(\{[\s\S]*\})/);
  assert(match, "expected verify script to print a JSON summary footer");
  return JSON.parse(match[1]);
}

test("verify-202608-access-governance-gate.mjs passes all 10 spec §10 cases under --strict", () => {
  const result = runScript(["--strict"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = parseOutput(result);
  assert.equal(summary.ok, true);
  assert.equal(summary.strict, true);
  assert.equal(summary.target, "access-governance-gate");
  assert.equal(summary.counts.fail, 0);
  assert.equal(summary.counts.total, 10);
  assert.equal(summary.counts.pass, 10);
  for (const id of [
    "P0.sensitive-role-widening",
    "P0.global-deny-weakened",
    "P0.sensitive-prefix-weakened",
    "P0.raw-query-added",
    "P2.stale-token-cleanup",
    "OVERRIDE.single-approver-fail",
    "OVERRIDE.two-approver-evidence",
    "SHAPE.frontend-independent",
    "APPEND-ONLY.replay-writes-new-row",
    "HOT-STORE.no-plaintext-credential"
  ]) {
    const check = summary.results.find((r) => r.id === id);
    assert.equal(check?.status, "pass", `missing or failing check: ${id}`);
  }
});

test("verify-202608-access-governance-gate.mjs always prints a JSON summary footer", () => {
  // Smoke guard so future contract drift on the script's stdout shape
  // surfaces here rather than silently breaking downstream consumers.
  const result = runScript([]);
  assert.equal(result.status, 0);
  const summary = parseOutput(result);
  assert.equal(summary.target, "access-governance-gate");
  assert(typeof summary.counts.total === "number");
  assert(typeof summary.counts.pass === "number");
  assert(typeof summary.counts.fail === "number");
});
