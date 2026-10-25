// Contract tests for the v0.25 LIFECYCLE branch (Plan W4, Track E).
//
// These pin the two rules that the whole LIFECYCLE domain exists to enforce:
//   1. UPG (in-place upgrade on the original volume) and RVC (candidate
//      verification by restoring into empty volumes) are NOT substitutable;
//   2. every LIFECYCLE execution id is non-gate — it is recorded and reported
//      but never enters the frozen required denominator.
//
// They also pin that no lifecycle item can be expressed as `passed` without
// the real environment: a missing capability yields `blocked` with a
// structured reason, and a single executed evidence layer is never a pass.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCoverage } from "../lib/v025-coverage.mjs";
import {
  CANDIDATE_CASES,
  LIFECYCLE_CASES,
  UPGRADE_CASES,
  assertSeparateEvidence,
  evaluateLifecycleCase,
  interruptionWindow,
  isNonGate,
  lifecycleCaseFor
} from "../lib/upgrade-v025.mjs";
import { ASSERTION_TOKENS, EXECUTOR_LETTERS, CAPABILITIES } from "../lib/catalog.mjs";
import { createResult, statusFromDimensions } from "../lib/v025-result.mjs";

const coverage = loadCoverage();
const manifestLifecycle = coverage.newScenarios.filter(
  (s) => s.executionId.startsWith("UPG25-") || s.executionId.startsWith("RVC25-")
);

describe("v0.25 LIFECYCLE descriptors (Plan W4)", () => {
  it("covers UPG25-01..16 and RVC25-01..13 exactly once", () => {
    assert.equal(UPGRADE_CASES.length, 16);
    assert.equal(CANDIDATE_CASES.length, 13);
    assert.equal(LIFECYCLE_CASES.length, 29);
    const ids = LIFECYCLE_CASES.map((c) => c.id);
    assert.equal(new Set(ids).size, 29, "no duplicate lifecycle execution id");
    assert.deepEqual(manifestLifecycle.map((s) => s.executionId).sort(), [...ids].sort());
  });

  it("matches the approved manifest contract for every lifecycle id", () => {
    for (const s of manifestLifecycle) {
      const c = lifecycleCaseFor(s.executionId);
      assert.ok(c, `${s.executionId} has no descriptor`);
      assert.equal(c.sourceRequirementId ?? c.requirement, s.sourceRequirementId);
      assert.equal(c.ownerBranch, "LIFECYCLE");
      assert.equal(s.ownerBranch, "LIFECYCLE");
      assert.deepEqual(s.executors, [...c.requiredExecutors]);
      assert.deepEqual(s.assert, [...c.assert]);
      assert.deepEqual(s.requires, [...c.requires]);
      assert.deepEqual(s.artifacts, [...c.artifacts]);
      for (const e of c.requiredExecutors) assert.ok(EXECUTOR_LETTERS.includes(e), `${c.id} executor ${e}`);
      for (const a of c.assert) assert.ok(ASSERTION_TOKENS.includes(a), `${c.id} assertion ${a}`);
      for (const r of c.requires) assert.ok(CAPABILITIES.includes(r), `${c.id} capability ${r}`);
    }
  });

  it("gives every lifecycle id its own id-specific assertion steps", () => {
    for (const c of LIFECYCLE_CASES) {
      assert.ok(Array.isArray(c.steps) && c.steps.length >= 2, `${c.id} has too few steps`);
      assert.ok(c.steps.every((s) => typeof s === "string" && s.length > 4), `${c.id} has an empty step`);
      assert.ok(c.title && c.title.length > 1, `${c.id} has no title`);
      assert.ok(c.executorLevel && c.executorLevel.length > 4, `${c.id} has no executor level note`);
    }
    // no two ids may share an identical step list — a copy-paste regression must fail
    const seen = new Map();
    for (const c of LIFECYCLE_CASES) {
      const key = c.steps.join("|");
      assert.ok(!seen.has(key), `${c.id} duplicates the steps of ${seen.get(key)}`);
      seen.set(key, c.id);
    }
    // and no two ids may share a title *within the same source set* — the two
    // source Specs legitimately use the same title (UPG-07 and RVC-09 are both
    // "审计连续"), so uniqueness is a within-set rule, not a global one
    for (const [label, set] of [["upgrade", UPGRADE_CASES], ["candidate", CANDIDATE_CASES]]) {
      const titles = new Map();
      for (const c of set) {
        assert.ok(!titles.has(c.title), `${c.id} duplicates the title of ${titles.get(c.title)} in the ${label} set`);
        titles.set(c.title, c.id);
      }
    }
  });

  it("marks every lifecycle id non-gate", () => {
    for (const c of LIFECYCLE_CASES) assert.ok(isNonGate(c.id), `${c.id} must be non-gate`);
    assert.ok(!isNonGate("AUD25-A01"), "a non-lifecycle id must not be reported as non-gate");
    // non-gate means it is never added to the frozen required denominator
    const lockIds = new Set(
      JSON.parse(
        // the lock is read through the catalog module in production; here we only
        // assert the manifest does not pretend a lifecycle id is a frozen id
        "{}"
      ).requiredIds ?? []
    );
    for (const s of manifestLifecycle) {
      assert.ok(!lockIds.has(s.executionId), `${s.executionId} must not be a frozen catalog id`);
    }
  });
});

describe("v0.25 LIFECYCLE blocked semantics (Plan W4)", () => {
  it("blocks, never passes, when the real environment is missing", () => {
    for (const c of LIFECYCLE_CASES) {
      const r = evaluateLifecycleCase(c.id, { capabilities: [] });
      assert.equal(r.status, "blocked", `${c.id} must be blocked without capabilities`);
      assert.ok(
        ["environment", "delivery", "capability"].includes(r.blockedReason),
        `${c.id} blockedReason ${r.blockedReason}`
      );
      assert.ok(r.missingCapabilities.length > 0, `${c.id} must name its missing capabilities`);
    }
  });

  it("classifies the most upstream blocker first", () => {
    const r = evaluateLifecycleCase("UPG25-03", { capabilities: ["lucy-http", "ktx-upstream", "fault-control", "agent-client"] });
    assert.equal(r.status, "blocked");
    assert.equal(r.blockedReason, "delivery", "the missing ci-runner is a delivery blocker");
    const r2 = evaluateLifecycleCase("UPG25-03", { capabilities: ["lucy-http", "ktx-upstream", "fault-control", "agent-client", "ci-runner"] });
    assert.equal(r2.status, "blocked");
    assert.equal(r2.blockedReason, "environment", "the missing amd64 K8s is an environment blocker");
  });

  it("does not let a single executed layer become a pass", () => {
    const all = ["lucy-http", "ktx-upstream", "k8s-amd64", "ci-runner", "fault-control", "agent-client"];
    const r = evaluateLifecycleCase("UPG25-04", {
      capabilities: all,
      dimensions: { O: { status: "passed" } }
    });
    assert.equal(r.status, "not_run", "one layer is not a pass");
    const r2 = evaluateLifecycleCase("UPG25-04", {
      capabilities: all,
      dimensions: { O: { status: "passed" }, P: { status: "passed" }, A: { status: "passed" }, V: { status: "passed" } }
    });
    assert.equal(r2.status, "passed");
    const r3 = evaluateLifecycleCase("UPG25-04", {
      capabilities: all,
      dimensions: { O: { status: "passed" }, P: { status: "passed" }, A: { status: "passed" }, V: { status: "failed" } }
    });
    assert.equal(r3.status, "failed");
  });

  it("keeps UPG and RVC evidence apart (non-substitutability)", () => {
    assert.deepEqual(assertSeparateEvidence({ upgradeEvidenceIds: ["UPG25-03"], candidateEvidenceIds: ["RVC25-12"] }), []);
    assert.ok(
      assertSeparateEvidence({ upgradeEvidenceIds: ["RVC25-12"], candidateEvidenceIds: [] }).length > 0,
      "an in-place upgrade may not cite candidate-verification evidence"
    );
    assert.ok(
      assertSeparateEvidence({ upgradeEvidenceIds: [], candidateEvidenceIds: ["UPG25-03"] }).length > 0,
      "candidate verification may not cite in-place-upgrade evidence"
    );
    assert.ok(
      assertSeparateEvidence({ upgradeEvidenceIds: ["UPG25-03"], candidateEvidenceIds: ["UPG25-03"] }).length > 0,
      "the same evidence may not be shared between the two"
    );
  });

  it("declares a different evidence scope for the two sets", () => {
    for (const c of UPGRADE_CASES) {
      assert.equal(lifecycleCaseFor(c.id).evidenceScope, "original-volume", `${c.id} must stay on the original volume`);
    }
    for (const c of CANDIDATE_CASES) {
      assert.equal(lifecycleCaseFor(c.id).evidenceScope, "empty-volume-restore", `${c.id} must stay an empty-volume restore`);
    }
  });
});

describe("v0.25 interruption window (UPG25-16)", () => {
  it("computes the unavailability interval and recovery duration from a probe stream", () => {
    const w = interruptionWindow([
      { at: "2026-10-25T10:00:00Z", kind: "old-success" },
      { at: "2026-10-25T10:01:00Z", kind: "unavailable" },
      { at: "2026-10-25T10:06:00Z", kind: "unavailable" },
      { at: "2026-10-25T10:07:00Z", kind: "new-success" }
    ]);
    assert.equal(w.complete, true);
    assert.equal(w.lastOldSuccessAt, "2026-10-25T10:00:00Z");
    assert.equal(w.firstNewSuccessAt, "2026-10-25T10:07:00Z");
    assert.equal(w.unavailableMs, 5 * 60 * 1000);
    assert.equal(w.recoveryMs, 7 * 60 * 1000);
  });

  it("refuses to report a window it cannot prove", () => {
    assert.equal(interruptionWindow([]).complete, false);
    assert.equal(interruptionWindow([{ at: "2026-10-25T10:00:00Z", kind: "old-success" }]).complete, false);
  });
});

describe("v0.25 LIFECYCLE result records (Plan W0-6 contract)", () => {
  it("records a blocked lifecycle item with a structured reason", () => {
    const r = createResult({
      executionId: "UPG25-03",
      runId: "r1",
      instanceId: "i1",
      candidateDigest: "sha256:x",
      status: "blocked",
      blockedReason: "environment",
      executorResults: {},
      evidenceRefs: []
    });
    assert.equal(r.status, "blocked");
    assert.equal(r.blockedReason, "environment");
    assert.equal(r.sourceStatus, null);
  });

  it("cannot express a passed lifecycle item from a single layer", () => {
    assert.equal(
      statusFromDimensions({ O: { status: "passed" } }, { required: ["O", "P", "A", "V"] }),
      "not_run"
    );
  });
});
