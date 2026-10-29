// Contract test for the root test registry (Spec §4.1).
//
// The registry is what stops the daily gate from sweeping the whole repository with a blind
// `node --test`. This test keeps it honest:
//   - every tracked root test file is registered exactly once,
//   - every registered file is still tracked,
//   - every entry states its runner, environment, side effects and command,
//   - every excluded entry states WHY it is excluded,
//   - every gated entry names a command that a workflow really runs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../e2e/lib/common.mjs";

const REGISTRY_PATH = path.join(REPO_ROOT, "scripts/gates/root-test-registry.json");
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const entries = registry.entries;

const workflowText = ["lucy-ci.yml", "lucy-release.yml", "lucy-typecheck.yml"]
  .map((name) => readFileSync(path.join(REPO_ROOT, ".github/workflows", name), "utf8"))
  .join("\n");

const trackedRootTests = execFileSync("git", ["ls-files", "scripts"], { cwd: REPO_ROOT, encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(test|spec)\.(mjs|js|cjs|sh)$/.test(file))
  .sort();

describe("root test registry", () => {
  it("registers every tracked root test file exactly once", () => {
    const registered = entries.map((entry) => entry.path).sort();
    assert.deepEqual(
      registered,
      trackedRootTests,
      "the registry and the tracked root test files drifted apart; a test must not enter or leave the gate unrecorded",
    );
    assert.equal(new Set(registered).size, registered.length, "a file is registered twice");
  });

  it("registers only files that are still tracked", () => {
    const tracked = new Set(trackedRootTests);
    for (const entry of entries) {
      assert.ok(tracked.has(entry.path), `${entry.path} is registered but is not a tracked root test`);
    }
  });

  it("states the runner, environment, side effects and command for every entry", () => {
    for (const entry of entries) {
      for (const field of ["runner", "environment", "sideEffects", "command"]) {
        assert.equal(typeof entry[field], "string", `${entry.path}: ${field} must be a string`);
        assert.ok(entry[field].trim().length > 0, `${entry.path}: ${field} must not be empty`);
      }
      assert.ok(
        ["node --test", "bash"].includes(entry.runner),
        `${entry.path}: unexpected runner ${entry.runner}`,
      );
      assert.ok(entry.command.includes(entry.path), `${entry.path}: the command must name the file`);
    }
  });

  it("gives every exclusion a reason and no gate", () => {
    const excluded = entries.filter((entry) => entry.gate === null);
    assert.ok(excluded.length > 0, "the registry must keep recording the exclusions it made");
    for (const entry of excluded) {
      assert.equal(entry.gateCommand, null, `${entry.path}: an excluded entry has no gate command`);
      assert.equal(typeof entry.reason, "string", `${entry.path}: an exclusion must state a reason`);
      assert.ok(entry.reason.trim().length > 20, `${entry.path}: the exclusion reason is too thin to be a review`);
    }
  });

  it("gives every gated entry a gate command that a workflow really runs", () => {
    const gated = entries.filter((entry) => entry.gate !== null);
    assert.ok(gated.length > 0, "the registry must record the tests the daily gate runs");
    for (const entry of gated) {
      assert.equal(typeof entry.gateCommand, "string", `${entry.path}: a gated entry needs a gate command`);
      assert.equal(entry.reason, null, `${entry.path}: a gated entry needs no exclusion reason`);
      assert.ok(
        workflowText.includes(entry.gateCommand),
        `${entry.path}: gate command "${entry.gateCommand}" is not run by any workflow`,
      );
    }
  });

  it("registers the deterministic contracts in the workflow-contracts layer", () => {
    const layer = entries.filter((entry) => entry.gate === "workflow-contracts");
    assert.ok(layer.length >= 20, "the workflow-contracts layer lost its registered tests");
    for (const entry of layer) {
      assert.equal(entry.environment, "deterministic", `${entry.path} must not need an external service`);
    }
  });

  it("keeps the release-only and environment-dependent suites out of the daily contract layer", () => {
    for (const entry of entries) {
      if (entry.gate === "workflow-contracts") {
        assert.ok(
          !/real-e2e|customer-release|postgres|mysql|doris|browser|playwright/.test(entry.path),
          `${entry.path} needs an environment the daily contract job does not provide`,
        );
      }
    }
  });
});
