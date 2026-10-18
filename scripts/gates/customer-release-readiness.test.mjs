import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { REPO_ROOT, EXIT_CODES } from "../e2e/lib/common.mjs";
import { prepareEnvironment } from "../e2e/prepare-environment.mjs";
import { collectGateResults } from "./collect-gate-results.mjs";
import { READINESS_STEPS, decideReadiness, reconcileChild } from "./customer-release-readiness.mjs";
import { statusFromExitCode } from "./record-gate-result.mjs";

const SCRIPT = path.join(REPO_ROOT, "scripts/gates/customer-release-readiness.mjs");
const PROFILE = path.join(REPO_ROOT, "scripts/e2e/profiles/customer-release.yaml");
const roots = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-readiness-"));
  roots.push(dir);
  return dir;
};
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const candidate = { gitSha: "a".repeat(40), treeDigest: `sha256:${"b".repeat(64)}`, imageDigest: `sha256:${"c".repeat(64)}`, platform: "linux/amd64", ktxVersion: "0.16.0", chartVersion: "0.17.0" };
const candidateFile = () => {
  const file = path.join(tmp(), "identity.json");
  writeFileSync(file, JSON.stringify(candidate));
  return file;
};

async function makeRun(mode) {
  const root = tmp();
  const dir = tmp();
  const identity = path.join(dir, "identity.json");
  writeFileSync(identity, JSON.stringify(candidate));
  const { run, runJsonPath } = await prepareEnvironment({
    runId: `ready-${mode}-${Math.random().toString(36).slice(2, 8)}`, mode, runRoot: root,
    ...(mode === "release" ? { candidatePath: identity, profilePath: PROFILE } : {})
  });
  return { run, runJsonPath };
}

const cli = (args) => spawnSync("node", [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });

describe("customer-release-readiness (the only customer aggregate gate)", () => {
  it("--list prints the pipeline, exits 0 and writes nothing", () => {
    const result = cli(["--list"]);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.mode, "list");
    assert.deepEqual(parsed.steps, READINESS_STEPS);
    assert.ok(parsed.steps.some((s) => /SAME digest/.test(s)) && parsed.steps.some((s) => /promote exactly the tested digest/.test(s)));
  });

  it("a local run can never be gated for release (exit 1)", async () => {
    const { runJsonPath } = await makeRun("local");
    const result = cli(["--candidate", candidateFile(), "--run", runJsonPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /only a release run can be gated for release/);
  });

  it("collect mode exits 3, is never releaseReady, and writes a separate file (never release-readiness.json)", async () => {
    const { run, runJsonPath } = await makeRun("release");
    const result = cli(["--candidate", candidateFile(), "--run", runJsonPath, "--collect"]);
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stdout).releaseReady, false);
    assert.ok(existsSync(path.join(run.paths.runDir, "release-readiness.collect.json")));
    assert.ok(!existsSync(path.join(run.paths.runDir, "release-readiness.json")));
  });

  it("collect and dry-run cannot overwrite an earlier release verdict", async () => {
    const { run, runJsonPath } = await makeRun("release");
    const sentinel = path.join(run.paths.runDir, "release-readiness.json");
    writeFileSync(sentinel, '{"status":"passed","releaseReady":true,"sentinel":true}\n');
    for (const flag of ["--collect", "--dry-run"]) {
      const result = cli(["--candidate", candidateFile(), "--run", runJsonPath, flag]);
      assert.equal(result.status, 3);
      assert.deepEqual(JSON.parse(readFileSync(sentinel, "utf8")), { status: "passed", releaseReady: true, sentinel: true });
    }
  });

  it("a release run without any collected evidence is blocked/failed, never ready", async () => {
    const { run, runJsonPath } = await makeRun("release");
    const result = cli(["--candidate", candidateFile(), "--run", runJsonPath]);
    assert.ok([1, 2].includes(result.status), `exit ${result.status}`);
    const verdict = JSON.parse(readFileSync(path.join(run.paths.runDir, "release-readiness.json"), "utf8"));
    assert.equal(verdict.releaseReady, false);
    assert.ok(verdict.absentDependencies.includes("results/security.json"));
    assert.equal(JSON.parse(result.stdout).exitCode, result.status, "the exit code equals the JSON verdict");
  });

  it("decideReadiness reports absent dependencies and omitted denominators as not ready", async () => {
    const { run } = await makeRun("release");
    const { verdict, missing } = decideReadiness({ run, candidate, mode: "release" });
    assert.ok(missing.length >= 4);
    assert.equal(verdict.releaseReady, false);
    assert.ok(verdict.problems.some((p) => p.code === "omitted_case"));
  });

  it("[A1] readiness summary.required equals the verifier's expected denominator (no manual GUI inflation)", async () => {
    // Regression for the bug where `clients.filter(c => c.required)` included workbuddy/cursor and produced
    // expectedCount=517 while the verifier expected 373, triggering `summary_tampered`.
    const { run } = await makeRun("release");
    const { evidence } = decideReadiness({ run, candidate, mode: "release" });
    const automated = inputs => inputs.clientsDoc.clients.filter((c) => c.required && c.execution === "automated").length;
    const inputs = (await import("../e2e/verify-evidence.mjs")).loadVerifyInputs();
    const frozen = (await import("../e2e/lib/catalog.mjs")).expectedExecutions(
      inputs.cases,
      inputs.clientsDoc.clients.filter((c) => c.required && c.execution === "automated").map((c) => c.product)
    ).length;
    // evidence.summary.required reflects the readiness-side expectedCount; the verifier compares it against the
    // automated-only denominator it computes.
    assert.equal(evidence.summary.required, frozen, "summary.required must use the automated-only denominator");
    assert.equal(automated(inputs), 2, "v5: exactly two automated required products");
  });

  it("child exit codes must agree with child JSON (contract failure otherwise)", () => {
    assert.equal(reconcileChild({ jsonStatus: "passed", exitCode: 3 }).status, "failed");
    assert.equal(reconcileChild({ jsonStatus: "collect", exitCode: 3 }).status, "collect");
    for (const [status, code] of Object.entries(EXIT_CODES)) assert.equal(reconcileChild({ jsonStatus: status, exitCode: code }).problem, null);
  });
});

describe("gate result collection uses structured sources only", () => {
  it("maps reverse-test outcomes to GATE-01 cases and blocks every case that has no structured source", async () => {
    const { run } = await makeRun("release");
    const outcomes = new Map([["GATE-01-V01", { status: "passed", detail: "t1" }], ["GATE-01-V02", { status: "failed", detail: "t2" }]]);
    const body = await collectGateResults({ run, candidate, reverseTests: async () => outcomes });
    const by = Object.fromEntries(body.cases.map((c) => [c.id, c]));
    assert.equal(by["GATE-01-V01"].status, "passed");
    assert.equal(by["GATE-01-V02"].status, "failed");
    assert.equal(by["GATE-01-V03"].status, "blocked", "no reverse test result => blocked, not passed");
    assert.equal(by["OPS-01-V01"].status, "blocked");
    assert.equal(by["SEC-23-V01"].status, "blocked", "npm audit result absent => blocked");
    assert.equal(by["SEC-23-V05"].status, "blocked", "G1–G4 results absent => blocked");
    assert.equal(body.contextMigrationPending, undefined, "an unmeasured counter is left unset, never 0");
    assert.ok(by["GATE-01-V01"].artifacts[0].sha256.length === 64);
  });

  it("judges SEC-23 from npm audit against the register, SEC-23-V05 from digest-bound gates, retained artifacts from a scan", async () => {
    const { run } = await makeRun("release");
    const results = path.join(run.paths.runDir, "results");
    mkdirSync(results, { recursive: true });
    writeFileSync(path.join(results, "npm-audit.json"), JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } }));
    const gates = ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version"].map((name) => ({ name, status: "passed", imageDigest: candidate.imageDigest }));
    writeFileSync(path.join(results, "existing-gates.json"), JSON.stringify({ gates }));
    writeFileSync(path.join(results, "context-migration.json"), JSON.stringify({ pending: 0 }));
    writeFileSync(path.join(results, "projection.json"), JSON.stringify({ backlog: 0 }));
    // SEC-17-V10 requires per-ask indexed evidence (Review A6 §3). Seed an agent.json with a
    // minimal asks[] record so the canary policy is bound per-question. The ask's goldKey is
    // a real question from <run.paths.checker/gold.json> (produced by prepareEnvironment).
    const gold = JSON.parse(readFileSync(path.join(run.paths.checker, "gold.json"), "utf8"));
    const goldKey = Object.keys(gold.questions ?? {})[0];
    const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
    const agentId = Object.keys(tokens)[0];
    writeFileSync(path.join(results, "agent.json"), JSON.stringify({
      contract: "lucy-agent-e2e-v1",
      runId: run.runId,
      cases: [{ id: "UX-02-V01", runner: "agent", scenario: "UX-02", client: "claude-code", run: 1, status: "passed", asks: [{ askIndex: 0, agentId, goldKey, expectation: "answer", sessionId: "s0", model: "test", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T00:01:00.000Z", tokenFingerprint: "fp", answer: "", bindingProblems: [] }], assertions: [], artifacts: [] }]
    }));
    const body = await collectGateResults({ run, candidate, reverseTests: async () => new Map() });
    const by = Object.fromEntries(body.cases.map((c) => [c.id, c]));
    assert.equal(by["SEC-23-V01"].status, "passed");
    assert.equal(by["SEC-23-V02"].status, "passed");
    assert.equal(by["SEC-23-V05"].status, "passed");
    assert.equal(by["SEC-17-V10"].status, "passed");
    assert.equal(body.contextMigrationPending, 0);
    assert.equal(body.projectionBacklog, 0);

    // gates on another digest, high vulnerability and a leaked credential each flip their case to failed
    writeFileSync(path.join(results, "leaky.json"), JSON.stringify({ note: Object.values(tokens)[0] }));
    writeFileSync(path.join(results, "npm-audit.json"), JSON.stringify({ vulnerabilities: { "left-pad": { severity: "high" } }, metadata: { vulnerabilities: { high: 1, critical: 0 } } }));
    writeFileSync(path.join(results, "existing-gates.json"), JSON.stringify({ gates: gates.map((g) => ({ ...g, imageDigest: `sha256:${"9".repeat(64)}` })) }));
    const bad = await collectGateResults({ run, candidate, reverseTests: async () => new Map() });
    const badBy = Object.fromEntries(bad.cases.map((c) => [c.id, c]));
    assert.equal(badBy["SEC-23-V01"].status, "failed");
    assert.equal(badBy["SEC-23-V05"].status, "failed");
    assert.equal(badBy["SEC-17-V10"].status, "failed");
  });

  it("record-gate-result derives status from the exit code only and requires a digest", async () => {
    const { runJsonPath, run } = await makeRun("release");
    const script = path.join(REPO_ROOT, "scripts/gates/record-gate-result.mjs");
    const ok = spawnSync("node", [script, "--run", runJsonPath, "--name", "g2-elf-arch", "--exit-code", "0", "--image-digest", candidate.imageDigest], { encoding: "utf8" });
    assert.equal(ok.status, 0);
    const failed = spawnSync("node", [script, "--run", runJsonPath, "--name", "g4-ktx-version", "--exit-code", "139", "--image-digest", candidate.imageDigest], { encoding: "utf8" });
    assert.equal(failed.status, 0);
    const doc = JSON.parse(readFileSync(path.join(run.paths.runDir, "results", "existing-gates.json"), "utf8"));
    assert.equal(doc.gates.find((g) => g.name === "g2-elf-arch").status, "passed");
    assert.equal(doc.gates.find((g) => g.name === "g4-ktx-version").status, "failed");
    const noDigest = spawnSync("node", [script, "--run", runJsonPath, "--name", "x", "--exit-code", "0", "--image-digest", "latest"], { encoding: "utf8" });
    assert.equal(noDigest.status, 1);
    assert.equal(statusFromExitCode(42), "blocked");
  });
});
