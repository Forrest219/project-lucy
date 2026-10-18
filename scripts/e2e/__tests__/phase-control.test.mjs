// B3 fault control + lifecycle phase executor (Spec §6.2, §8.3).
//
// Tests cover the registered control contract: validation, namespace allowlist, fault
// rollback, and the recovery executor. The producer never fabricates a successful
// recovery; missing supported control yields `unimplemented`, not a silent pass.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  executeRecovery,
  FaultControlError,
  localChmodFault,
  localReplaceFileFault,
  resolveAllowedNamespaces,
  validateRecovery,
  withFault
} from "../lib/phase-control.mjs";

function makeRun(overrides = {}) {
  return {
    runId: "r1",
    instanceId: "i1",
    paths: { runDir: "/tmp/lucy-e2e-fake" },
    k8s: { namespace: "lucy-e2e-cli", release: "lucy-e2e" },
    ...overrides
  };
}

describe("B3 phase-control: validateRecovery rejects product back-doors", () => {
  it("rejects recovery.kind !== 'harness'", () => {
    const { ok, problems } = validateRecovery({ kind: "product", command: "x", requires: [] });
    assert.equal(ok, false);
    assert.match(problems.join(" "), /recovery kind must be "harness"/);
  });

  it("rejects an unsupported fault in requires", () => {
    const { ok, problems } = validateRecovery({ kind: "harness", command: "x", requires: ["destroy"] });
    assert.equal(ok, false);
    assert.match(problems.join(" "), /unsupported control "destroy"/);
  });

  it("accepts the four allowlisted operations", () => {
    for (const req of ["restart", "clock", "storage", "network"]) {
      const { ok, problems } = validateRecovery({ kind: "harness", command: "x", requires: [req], ...(req === "network" ? { networkProfile: "policy-x" } : {}) });
      assert.equal(ok, true, `${req} must be accepted (got problems: ${problems.join("; ")})`);
    }
  });
});

describe("B3 phase-control: resolveAllowedNamespaces refuses production-shaped namespaces", () => {
  it("refuses when the run did not register a namespace", () => {
    const r = makeRun({ k8s: {} });
    const { allowed, problems } = resolveAllowedNamespaces(r);
    assert.deepEqual(allowed, []);
    assert.match(problems.join(" "), /namespace is not registered/);
  });

  it("refuses production-shaped namespaces", () => {
    for (const ns of ["default", "kube-system", "prod", "production"]) {
      const r = makeRun({ k8s: { namespace: ns, release: "lucy" } });
      const { problems } = resolveAllowedNamespaces(r);
      assert.match(problems.join(" "), new RegExp(`"${ns}"`));
    }
  });

  it("accepts a registered namespace + release pair", () => {
    const r = makeRun();
    const { allowed, problems } = resolveAllowedNamespaces(r);
    assert.deepEqual(allowed, ["lucy-e2e-cli"]);
    assert.deepEqual(problems, []);
  });
});

describe("B3 phase-control: local fault controls are scoped to the run directory", () => {
  it("localChmodFault flips mode and the rollback restores it", () => {
    // Use a real temp directory; the function rejects paths outside the run dir.
    const runDir = mkdtempSync(join(tmpdir(), "lucy-pc-"));
    try {
      const file = join(runDir, "marker.txt");
      writeFileSync(file, "x");
      const fault = localChmodFault({ run: { paths: { runDir } }, file: "marker.txt", mode: 0o600, undoMode: 0o644 });
      assert.equal(statSync(file).mode & 0o777, 0o600);
      fault.rollback();
      assert.equal(statSync(file).mode & 0o777, 0o644);
    } finally { rmSync(runDir, { recursive: true, force: true }); }
  });

  it("localReplaceFileFault replaces body and rollback restores the original", () => {
    const runDir = mkdtempSync(join(tmpdir(), "lucy-pc-"));
    try {
      const file = join(runDir, "marker.txt");
      writeFileSync(file, "before");
      const fault = localReplaceFileFault({ run: { paths: { runDir } }, file: "marker.txt", body: "during" });
      assert.equal(readFileSync(file, "utf8"), "during");
      fault.rollback();
      assert.equal(readFileSync(file, "utf8"), "before");
    } finally { rmSync(runDir, { recursive: true, force: true }); }
  });

  it("rejects a fault target outside the run directory (escapes the harness control plane)", () => {
    assert.throws(() => localChmodFault({ run: { paths: { runDir: "/tmp/lucy-fake" } }, file: "/etc/passwd", mode: 0o600 }), FaultControlError);
  });
});

describe("B3 phase-control: executeRecovery uses the injected executor (not a global spawnSync)", () => {
  it("calls the injected executor with the interpolated command and runs through try/finally", () => {
    const calls = [];
    const executor = ({ command, id, runId }) => {
      calls.push({ command, id, runId });
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };
    const run = makeRun();
    const result = executeRecovery({
      run, recovery: { kind: "harness", command: "kubectl rollout restart deploy/${RELEASE} -n ${NAMESPACE}", requires: ["restart"] },
      executor
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "kubectl rollout restart deploy/lucy-e2e -n lucy-e2e-cli");
    assert.equal(calls[0].runId, "r1");
    assert.equal(result.record.status, 0);
  });

  it("returns refused when the executor exits non-zero", () => {
    const executor = () => ({ status: 1, signal: null, stdout: "", stderr: "denied" });
    const result = executeRecovery({
      run: makeRun(), recovery: { kind: "harness", command: "kubectl rollout restart deploy/${RELEASE} -n ${NAMESPACE}", requires: ["restart"] },
      executor
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "refused");
    assert.match(result.problems.join(" "), /exited 1/);
  });

  it("returns unimplemented when the executor errored (missing supported control)", () => {
    const executor = () => ({ error: new Error("kubectl not found"), status: null, signal: null, stdout: "", stderr: "" });
    const result = executeRecovery({
      run: makeRun(), recovery: { kind: "harness", command: "kubectl rollout restart deploy/${RELEASE} -n ${NAMESPACE}", requires: ["restart"] },
      executor
    });
    assert.equal(result.ok, false);
    assert.equal(result.classification, "unimplemented");
  });

  it("refuses to run on a production-shaped namespace (the executor is never called)", () => {
    const calls = [];
    const executor = (rec) => { calls.push(rec); return { status: 0 }; };
    const result = executeRecovery({
      run: makeRun({ k8s: { namespace: "production", release: "lucy" } }),
      recovery: { kind: "harness", command: "kubectl delete all --all -n ${NAMESPACE}", requires: ["restart"] },
      executor
    });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0, "executor must NOT be called when the namespace is refused");
  });
});

describe("B3 phase-control: withFault rolls back on success and on error", () => {
  it("rolls back the fault after the action resolves", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "lucy-pc-"));
    try {
      const file = join(runDir, "marker.txt");
      writeFileSync(file, "before");
      const fault = localReplaceFileFault({ run: { paths: { runDir } }, file: "marker.txt", body: "during" });
      const out = await withFault(fault, async () => "result");
      assert.equal(out, "result");
      assert.equal(readFileSync(file, "utf8"), "before");
    } finally { rmSync(runDir, { recursive: true, force: true }); }
  });

  it("rolls back the fault even when the action throws", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "lucy-pc-"));
    try {
      const file = join(runDir, "marker.txt");
      writeFileSync(file, "before");
      const fault = localReplaceFileFault({ run: { paths: { runDir } }, file: "marker.txt", body: "during" });
      await assert.rejects(() => withFault(fault, async () => { throw new Error("action-failed"); }), /action-failed/);
      assert.equal(readFileSync(file, "utf8"), "before", "rollback ran even when the action threw");
    } finally { rmSync(runDir, { recursive: true, force: true }); }
  });
});
