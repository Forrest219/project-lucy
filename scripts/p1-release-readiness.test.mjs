import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("p1 release readiness aggregate", () => {
  it("lists all P1 gates without executing them", () => {
    const result = spawnSync("node", ["scripts/p1-release-readiness.mjs", "--list"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.gates.map((gate) => gate.id), [
      "context",
      "skills",
      "endpoint",
      "observability",
      "agent-e2e",
      "business-eval-full",
      "starrocks-certification"
    ]);
    const agentGate = parsed.gates.find((gate) => gate.id === "agent-e2e");
    assert.equal(agentGate.command, "npm run e2e:agent");
    assert.equal(agentGate.kind, "e2e");
  });

  it("dry-runs all P1 gates and writes aggregate evidence", () => {
    const out = "inbox/p1-release-readiness-test.json";
    const result = spawnSync("node", ["scripts/p1-release-readiness.mjs", "--dry-run", "--out", out], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS/);
  });
});
