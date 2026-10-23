import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { REPO_ROOT } from "../lib/common.mjs";

const SCRIPT = path.join(REPO_ROOT, "scripts/smoke/package-sow-trust-evidence.mjs");
const roots = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-sow-"));
  roots.push(dir);
  return dir;
};
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const pack = (args) => spawnSync("node", [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });

function manifestFor(dir, { runId = "run-a", verdict }) {
  const verdictFile = path.join(dir, "release-readiness.json");
  if (verdict) writeFileSync(verdictFile, JSON.stringify(verdict));
  const manifestFile = path.join(dir, "run-manifest.json");
  writeFileSync(manifestFile, JSON.stringify({
    contract: "lucy-sow-run-manifest-v1", runId,
    evidence: path.join(dir, "evidence.json"), report: path.join(dir, "report.html"), artifacts: path.join(dir, "artifacts"), refresh: path.join(dir, "refresh.json"),
    releaseVerdict: verdictFile
  }));
  return manifestFile;
}

describe("SOW trust package uses the same verifier as the customer release (Plan T13)", () => {
  it("strict packaging without an explicit run manifest is blocked (fixed inbox paths cannot prove one run)", () => {
    const out = path.join(tmp(), "pkg");
    const result = pack(["--strict", "--out", out]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /needs --run-manifest/);
    assert.equal(JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8")).status, "PARTIAL_READY_NEEDS_REFRESH");
  });

  it("collect-only packaging stays available for review but is never READY", () => {
    const result = pack(["--out", path.join(tmp(), "pkg")]);
    assert.equal(result.status, 3);
  });

  it("a manifest whose release verdict is missing, failed, blocked or for another run is not READY", () => {
    const cases = [
      ["missing verdict", undefined],
      ["failed verdict", { runId: "run-a", status: "failed", releaseReady: false }],
      ["blocked verdict", { runId: "run-a", status: "blocked", releaseReady: false }],
      ["passed but not releaseReady", { runId: "run-a", status: "passed", releaseReady: false }],
      ["another run's passed verdict", { runId: "run-b", status: "passed", releaseReady: true }]
    ];
    for (const [label, verdict] of cases) {
      const dir = tmp();
      const result = pack(["--strict", "--run-manifest", manifestFor(dir, { verdict }), "--out", path.join(dir, "pkg")]);
      assert.equal(result.status, 2, label);
      assert.equal(JSON.parse(readFileSync(path.join(dir, "pkg", "manifest.json"), "utf8")).status, "PARTIAL_READY_NEEDS_REFRESH", label);
    }
  });

  it("even a passed verdict of the right run cannot make a package with no real evidence READY", () => {
    const dir = tmp();
    const result = pack(["--strict", "--run-manifest", manifestFor(dir, { verdict: { runId: "run-a", status: "passed", releaseReady: true } }), "--out", path.join(dir, "pkg")]);
    assert.equal(result.status, 2);
  });

  it("an invalid manifest contract is reported", () => {
    const dir = tmp();
    const manifestFile = path.join(dir, "bad.json");
    writeFileSync(manifestFile, JSON.stringify({ contract: "nope" }));
    const result = pack(["--strict", "--run-manifest", manifestFile, "--out", path.join(dir, "pkg")]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /contract must be lucy-sow-run-manifest-v1/);
  });
});
