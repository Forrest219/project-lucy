import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SCRIPT = "scripts/gates/p1-release-readiness.mjs";
const GATE_IDS = [
  "context",
  "skills",
  "endpoint",
  "governance",
  "publish-regression",
  "observability",
  "agent-e2e",
  "business-eval-full",
  "starrocks-certification"
];

function runReadiness(args, env = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

// A fake `npm` whose exit code per `npm run <script>` comes from FAKE_NPM_CODES (JSON). Every child prints
// misleading wording on purpose, so the tests prove that status comes from exit codes, not stdout.
function withFakeNpm(codes, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "readiness-fake-npm-"));
  try {
    const bin = path.join(dir, "npm");
    writeFileSync(bin, `#!/usr/bin/env node
const codes = JSON.parse(process.env.FAKE_NPM_CODES || "{}");
const script = process.argv[3];
console.log("PASS blocked missing precheck unavailable");
process.exit(codes[script] ?? codes["*"] ?? 0);
`, "utf8");
    chmodSync(bin, 0o755);
    return fn({ PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_NPM_CODES: JSON.stringify(codes) }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runWithFakeNpm(codes, args) {
  return withFakeNpm(codes, (env, dir) => {
    const out = path.join(dir, "evidence.json");
    const result = runReadiness([...args, "--out", out], env);
    return { result, evidence: JSON.parse(readFileSync(out, "utf8")) };
  });
}

describe("p1 release readiness aggregate", () => {
  it("lists all P1 gates as JSON without executing them or writing evidence", () => {
    const result = runReadiness(["--list"]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.mode, "list");
    assert.deepEqual(parsed.gates.map((gate) => gate.id), GATE_IDS);
    const agentGate = parsed.gates.find((gate) => gate.id === "agent-e2e");
    assert.equal(agentGate.command, "npm run e2e:agent");
    assert.equal(agentGate.kind, "e2e");
  });

  it("dry-run never counts as passed and exits 3", () => {
    const { result, evidence } = runWithFakeNpm({ "*": 0 }, ["--dry-run"]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(evidence.status, "dry_run");
    assert.equal(evidence.exitCode, 3);
    assert.equal(evidence.releaseReady, false);
    assert.equal(evidence.summary.passed, 0);
    assert.equal(evidence.summary.dryRun, GATE_IDS.length);
    assert(evidence.gates.every((gate) => gate.status === "dry_run"));
  });

  it("all gates passing exits 0 without claiming releaseReady", () => {
    const { result, evidence } = runWithFakeNpm({ "*": 0 }, []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.summary.passed, GATE_IDS.length);
    assert.equal(evidence.releaseReady, false);
  });

  it("a blocked gate exits 2 and is never reported as passed", () => {
    const { result, evidence } = runWithFakeNpm({ "*": 0, "smoke:p1:governance": 2, "smoke:p1:business-eval-full": 42 }, []);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.exitCode, 2);
    assert.deepEqual(evidence.gates.filter((gate) => gate.status === "blocked").map((gate) => gate.id), ["governance", "business-eval-full"]);
  });

  it("--allow-blocked only collects: exit 3, never a publishable 0", () => {
    const { result, evidence } = runWithFakeNpm({ "*": 0, "smoke:p1:governance": 2 }, ["--allow-blocked"]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(evidence.status, "collect");
    assert.equal(evidence.allowBlocked, true);
    assert.equal(evidence.releaseReady, false);
  });

  it("a failed gate exits 1 even when --allow-blocked is set", () => {
    const { result, evidence } = runWithFakeNpm({ "*": 0, "smoke:p1:context": 1, "smoke:p1:governance": 2 }, ["--allow-blocked"]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(evidence.status, "failed");
  });

  it("classifies by exit code, not by stdout wording", () => {
    const { result, evidence } = runWithFakeNpm({ "*": 0, "smoke:p1:skills": 1 }, []);
    assert.equal(result.status, 1, result.stderr);
    // Every child prints "blocked/missing/precheck/unavailable"; exit 1 is still failed and exit 0 still passed.
    assert.equal(evidence.gates.find((gate) => gate.id === "skills").status, "failed");
    assert.equal(evidence.gates.find((gate) => gate.id === "context").status, "passed");
    assert.equal(evidence.summary.blocked, 0);
  });
});
