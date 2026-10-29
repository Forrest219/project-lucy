// Negative contract tests for the daily aggregate gate (Spec §1.1 item 5, §6).
//
// The aggregate reads ONLY needs.<job>.result. Any result that is not exactly "success"
// — failure, skipped, cancelled, timed out — and any dependency that is missing from `needs`
// must fail the gate. An empty expected list must never pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { evaluate } from "./ci-required-gate.mjs";
import { REPO_ROOT } from "../e2e/lib/common.mjs";

const GATE = path.join(REPO_ROOT, "scripts/gates/ci-required-gate.mjs");
const EXPECTED = ["spec-and-webui", "docker-smoke", "k8s-static"];

const allSuccess = (jobs = EXPECTED) =>
  Object.fromEntries(jobs.map((job) => [job, { result: "success", outputs: {} }]));

describe("ci-required aggregate", () => {
  it("passes when every dependency succeeded", () => {
    const { ok, failures } = evaluate({ needs: allSuccess(), expected: EXPECTED });
    assert.ok(ok, failures.join("; "));
  });

  it("fails on a failed dependency", () => {
    const needs = allSuccess();
    needs["docker-smoke"] = { result: "failure", outputs: {} };
    const { ok, failures } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok);
    assert.match(failures.join("\n"), /docker-smoke: result is "failure"/);
  });

  it("fails on a skipped dependency", () => {
    const needs = allSuccess();
    needs["docker-smoke"] = { result: "skipped", outputs: {} };
    const { ok, failures } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok, "a skipped dependency is not a success");
    assert.match(failures.join("\n"), /skipped/);
  });

  it("fails on a cancelled dependency", () => {
    const needs = allSuccess();
    needs["k8s-static"] = { result: "cancelled", outputs: {} };
    const { ok } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok, "a cancelled dependency is not a success");
  });

  it("fails on a timed out dependency", () => {
    const needs = allSuccess();
    needs["spec-and-webui"] = { result: "timed_out", outputs: {} };
    const { ok } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok, "a timed out dependency is not a success");
  });

  it("fails when a dependency is missing from needs", () => {
    const needs = allSuccess();
    delete needs["docker-smoke"];
    const { ok, failures } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok, "a dependency that did not run cannot be a success");
    assert.match(failures.join("\n"), /missing from needs/);
  });

  it("fails when a job exists in needs but is not aggregated", () => {
    const needs = allSuccess([...EXPECTED, "brand-new-job"]);
    const { ok, failures } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok, "a job that the aggregate does not know about must not be silently ignored");
    assert.match(failures.join("\n"), /brand-new-job: present in needs but not aggregated/);
  });

  it("never passes an empty expected list", () => {
    const { ok, failures } = evaluate({ needs: allSuccess(), expected: [] });
    assert.ok(!ok);
    assert.match(failures.join("\n"), /empty/);
  });

  it("treats an unknown result value as a failure", () => {
    const needs = allSuccess();
    needs["docker-smoke"] = { result: "weird", outputs: {} };
    const { ok } = evaluate({ needs, expected: EXPECTED });
    assert.ok(!ok);
  });
});

describe("ci-required aggregate CLI", () => {
  const run = (args) => spawnSync(process.execPath, [GATE, ...args], { cwd: REPO_ROOT, encoding: "utf8" });

  it("exits 0 when every dependency succeeded", () => {
    const result = run(["--needs-json", JSON.stringify(allSuccess()), "--expect", EXPECTED.join(",")]);
    assert.equal(result.status, 0, result.stderr);
  });

  it("exits 1 when a dependency did not succeed", () => {
    const needs = allSuccess();
    needs["docker-smoke"] = { result: "skipped", outputs: {} };
    const result = run(["--needs-json", JSON.stringify(needs), "--expect", EXPECTED.join(",")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ci-required: FAILED/);
  });

  it("exits 2 on malformed input instead of reporting a pass", () => {
    assert.equal(run(["--needs-json", "{not json", "--expect", EXPECTED.join(",")]).status, 2);
    assert.equal(run(["--expect", EXPECTED.join(",")]).status, 2);
    assert.equal(run(["--needs-json", JSON.stringify(allSuccess())]).status, 2);
    assert.equal(run(["--needs-json", "[]", "--expect", EXPECTED.join(",")]).status, 2);
  });
});
