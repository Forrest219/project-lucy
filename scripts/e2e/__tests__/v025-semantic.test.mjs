// SEM25 contract tests — the W2-SEM responsibility branch (Plan §5.2, implementation plan §3.1 Track B).
//
// These tests are the mechanical proof that the SEM25 P0 branch is REAL test
// assets rather than prose:
//   * all 22 source requirements are present exactly once, with the approved
//     executionId form and the source requirement id read live from the source
//     Spec (no omission, no fabrication);
//   * every id is owned by the approved branch (SEM) and carries legal
//     executors / capabilities / assertion tokens;
//   * every id has id-SPECIFIC assertion steps — a copy-paste regression fails;
//   * fail-closed ids encode a refusal, and a permissive outcome is rejected;
//   * the status semantics are the approved ones: an item whose only executed
//     layer is the unit layer is `not_run`, never `passed`.
//
// Nothing here records a run status: no execution item may be recorded as
// passed without real run evidence (implementation plan §3.2.3).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "../lib/common.mjs";
import { ASSERTION_TOKENS, CAPABILITIES, EXECUTOR_LETTERS } from "../lib/catalog.mjs";
import {
  SOURCE_GROUPS,
  executionIdFor,
  loadCoverage,
  sourceRequirementBaseline
} from "../lib/v025-coverage.mjs";
import { BLOCKED_REASONS, RESULT_STATUSES, statusFromDimensions } from "../lib/v025-result.mjs";
import {
  SEM25_EXECUTION_GROUPS,
  SEM25_EXECUTION_IDS,
  SEM25_OWNER_BRANCH,
  SEM25_SOURCE_SPEC,
  judgeRefusal,
  semanticCase,
  semanticCases,
  semanticContractProblems,
  semanticSummary
} from "../lib/semantic-v025.mjs";

const coverage = loadCoverage();
const specText = readFileSync(path.join(REPO_ROOT, SEM25_SOURCE_SPEC), "utf8");
const group = SOURCE_GROUPS.find((g) => g.key === "SEM25");
const cases = semanticCases();

/** The manifest rows this branch owns, keyed by execution id. */
const manifestRows = new Map(
  coverage.newScenarios.filter((s) => s.executionId.startsWith("SEM25-")).map((s) => [s.executionId, s])
);

describe("SEM25 execution descriptors (W2-SEM, Plan §5.2)", () => {
  it("covers all 22 source requirements exactly once, with the approved executionId form", () => {
    assert.equal(cases.length, 22, "SEM25 must carry exactly 22 descriptors");
    assert.equal(new Set(cases.map((c) => c.executionId)).size, 22, "no duplicate executionId");
    assert.deepEqual([...cases.map((c) => c.executionId)].sort(), [...SEM25_EXECUTION_IDS].sort());
    assert.equal(manifestRows.size, 22, "the manifest must carry exactly 22 SEM25 rows");
    for (const c of cases) {
      assert.equal(executionIdFor(group, c.sourceRequirementId), c.executionId, `${c.executionId} is not the approved form`);
      assert.equal(c.sourceRequirementId, `V${c.executionId.slice(-2)}`);
    }
  });

  it("takes every source requirement id live from the source Spec (no omission, no fabrication)", () => {
    const baseline = sourceRequirementBaseline().get("SEM25");
    assert.equal(baseline.length, 22, "the source Spec must yield 22 requirement ids");
    assert.deepEqual(
      [...cases.map((c) => c.sourceRequirementId)].sort(),
      [...baseline].sort(),
      "the descriptors must cover exactly the source Spec's requirement ids"
    );
    for (const c of cases) {
      assert.match(
        specText,
        new RegExp(`^\\|\\s*${c.sourceRequirementId}\\s*\\|`, "m"),
        `${c.sourceRequirementId} has no acceptance row in ${SEM25_SOURCE_SPEC}`
      );
    }
  });

  it("is owned by the approved branch SEM on every id", () => {
    for (const c of cases) {
      assert.equal(c.ownerBranch, SEM25_OWNER_BRANCH, `${c.executionId} owner branch`);
      assert.equal(c.ownerBranch, group.ownerBranch, `${c.executionId} owner branch vs the approved group`);
      assert.equal(manifestRows.get(c.executionId).ownerBranch, SEM25_OWNER_BRANCH, `${c.executionId} owner branch in the manifest`);
    }
    assert.equal(semanticSummary().byGroup["identity-and-selection"], 4);
  });

  it("declares only legal executors, capabilities and assertion tokens", () => {
    for (const c of cases) {
      assert.ok(c.requiredExecutors.length > 0, `${c.executionId} has no executor`);
      for (const e of c.requiredExecutors) {
        assert.ok(EXECUTOR_LETTERS.includes(e), `${c.executionId} unknown executor ${e}`);
      }
      assert.ok(c.requiredCapabilities.length > 0, `${c.executionId} has no capability`);
      for (const r of c.requiredCapabilities) {
        assert.ok(CAPABILITIES.includes(r), `${c.executionId} unknown capability ${r}`);
      }
      assert.ok(c.assertionTokens.length > 0, `${c.executionId} has no assertion token`);
      for (const a of c.assertionTokens) {
        assert.ok(ASSERTION_TOKENS.includes(a), `${c.executionId} unknown assertion token ${a}`);
      }
      assert.ok(c.artifacts.length > 0, `${c.executionId} has no artifact`);
    }
    // The manifest's own rows for this branch must stay legal too — the
    // descriptors are only as good as the contract they mirror.
    for (const [, row] of manifestRows) {
      for (const e of row.executors) assert.ok(EXECUTOR_LETTERS.includes(e), `manifest executor ${e}`);
      for (const r of row.requires) assert.ok(CAPABILITIES.includes(r), `manifest capability ${r}`);
      for (const a of row.assert) assert.ok(ASSERTION_TOKENS.includes(a), `manifest assertion token ${a}`);
    }
  });

  it("mirrors the approved coverage manifest exactly (single source of truth)", () => {
    assert.deepEqual(semanticContractProblems(), [], "descriptor / manifest drift");
  });

  it("gives every id non-empty, id-specific assertion steps", () => {
    const stepOwner = new Map();
    for (const c of cases) {
      assert.ok(Array.isArray(c.steps), `${c.executionId} has no steps`);
      assert.ok(c.steps.length >= 3, `${c.executionId} needs at least 3 id-specific steps`);
      for (const step of c.steps) {
        assert.equal(typeof step, "string", `${c.executionId} step must be a string`);
        assert.ok(step.trim().length >= 12, `${c.executionId} has an empty or trivial step`);
        if (!stepOwner.has(step)) stepOwner.set(step, []);
        stepOwner.get(step).push(c.executionId);
      }
    }
    // a copy-paste regression ("same as V01" for 22 ids) shows up as one step
    // text shared by many ids, or as two ids with identical step lists
    for (const [step, owners] of stepOwner) {
      assert.ok(owners.length <= 2, `step shared by ${owners.length} ids (${owners.join(", ")}): ${step}`);
    }
    const fingerprints = new Set(cases.map((c) => c.steps.join("")));
    assert.equal(fingerprints.size, cases.length, "two ids share the identical step list");
    for (const c of cases) {
      const unique = c.steps.filter((s) => stepOwner.get(s).length === 1);
      assert.ok(unique.length > 0, `${c.executionId} has no step of its own`);
    }
  });

  it("keeps the four approved execution groups (Plan §5.2) intact", () => {
    const grouped = new Map();
    for (const c of cases) {
      if (!grouped.has(c.executionGroup)) grouped.set(c.executionGroup, []);
      grouped.get(c.executionGroup).push(c.executionId);
    }
    assert.deepEqual([...grouped.keys()].sort(), Object.keys(SEM25_EXECUTION_GROUPS).sort());
    for (const [name, ids] of Object.entries(SEM25_EXECUTION_GROUPS)) {
      assert.deepEqual([...(grouped.get(name) ?? [])].sort(), [...ids].sort(), `group ${name}`);
    }
  });

  it("encodes a refusal for the fail-closed ids and rejects a permissive result", () => {
    const failClosed = cases.filter((c) => c.failClosed);
    assert.ok(failClosed.length >= 5, "the SEM branch must declare its fail-closed ids");
    for (const c of failClosed) {
      assert.ok(c.refusal, `${c.executionId} is fail-closed but carries no refusal expectation`);
      assert.ok(
        (c.refusal.description && c.refusal.description.length > 0) || (c.refusal.reasonCode && c.refusal.reasonCode.length > 0),
        `${c.executionId} refusal expectation must name what is refused`
      );
      assert.ok(c.refusal.effect && c.refusal.effect.length > 0, `${c.executionId} refusal must state its effect`);
      // the negative case: a permissive outcome must be rejected
      const permissive = judgeRefusal(c, { refused: false });
      assert.equal(permissive.ok, false, `${c.executionId} accepted a permissive result`);
      assert.equal(permissive.verdict, "permissive-rejected");
      // and the compliant case
      const compliant = judgeRefusal(c, { refused: true, sideEffectFree: true });
      assert.equal(compliant.ok, true, `${c.executionId} rejected a correct refusal`);
      assert.equal(compliant.verdict, "refused");
    }
  });

  it("rejects a refusal on an id whose contract does not require one", () => {
    const open = cases.filter((c) => !c.failClosed);
    assert.ok(open.length > 0);
    for (const c of open) {
      assert.equal(c.refusal, null, `${c.executionId} must not declare a refusal`);
      assert.equal(judgeRefusal(c, { refused: false }).ok, true);
      assert.equal(judgeRefusal(c, { refused: true }).verdict, "unexpected-refusal");
    }
  });

  it("separates the computable unit layer from the environment-bound dimensions", () => {
    for (const c of cases) {
      const unit = c.evidenceDimensions.filter((d) => d.dimension === "unit");
      assert.equal(unit.length, 1, `${c.executionId} must have exactly one unit dimension`);
      assert.equal(unit[0].state, "available");
      assert.equal(unit[0].blockedReason, null);
      for (const d of c.evidenceDimensions.filter((x) => x.dimension !== "unit")) {
        assert.equal(d.state, "blocked", `${c.executionId} dimension ${d.dimension}`);
        assert.ok(BLOCKED_REASONS.includes(d.blockedReason), `${c.executionId} illegal blockedReason ${d.blockedReason}`);
        assert.ok(d.proves && d.proves.length > 0, `${c.executionId} dimension ${d.dimension} must say what it proves`);
      }
    }
  });

  it("keeps the real-Agent (V03) and the customer amd64 (V22) dimensions delivery-bound", () => {
    const v03 = semanticCase("SEM25-V03");
    assert.ok(v03.requiredExecutors.includes("A"), "V03 must require the agent-client executor");
    assert.ok(v03.requiredCapabilities.includes("agent-client"), "V03 must require the agent-client capability");
    assert.ok(v03.assertionTokens.includes("typed_gold"), "V03 must assert the typed gold");
    const agentDim = v03.evidenceDimensions.find((d) => d.dimension === "agent");
    assert.equal(agentDim.blockedReason, "delivery", "V03's agent evidence is Wave 0b delivery, not a local gap");

    const v22 = semanticCase("SEM25-V22");
    assert.ok(v22.requiredCapabilities.includes("k8s-amd64"), "V22 must require the customer amd64 capability");
    const customerDim = v22.evidenceDimensions.find((d) => d.dimension === "customer");
    assert.equal(customerDim.blockedReason, "delivery", "V22's customer evidence is delivery-bound");
  });

  it("records every item as not_run — nothing may be recorded as passed without run evidence", () => {
    for (const c of cases) {
      assert.equal(c.expectedStatus, "not_run", `${c.executionId} must not claim a status it did not run`);
      assert.ok(RESULT_STATUSES.includes(c.expectedStatus));
    }
  });

  it("derives not_run (not passed) when only the unit layer executed", () => {
    for (const c of cases) {
      const status = statusFromDimensions(
        { unit: { status: "passed" } },
        { required: [...c.requiredExecutors], verifierPassed: true }
      );
      assert.equal(status, "not_run", `${c.executionId}: a single passing layer is never a pass`);
      // the same item once every required dimension really ran
      const full = Object.fromEntries(c.requiredExecutors.map((e) => [e, { status: "passed" }]));
      assert.equal(statusFromDimensions(full, { required: [...c.requiredExecutors], verifierPassed: true }), "passed");
      // a failed dimension is a failure, whatever else passed
      const broken = { ...full, [c.requiredExecutors[0]]: { status: "failed" } };
      assert.equal(statusFromDimensions(broken, { required: [...c.requiredExecutors], verifierPassed: true }), "failed");
    }
  });

  it("points at repository test layers that already exist", () => {
    for (const c of cases) {
      for (const file of c.localCoverage) {
        assert.ok(existsSync(path.join(REPO_ROOT, file)), `${c.executionId} references a missing test layer: ${file}`);
      }
    }
  });

  it("does not invent a third owner branch or a second execution-id namespace", () => {
    const ids = new Set(SEM25_EXECUTION_IDS);
    assert.equal(ids.size, 22);
    for (const id of ids) assert.match(id, /^SEM25-V\d{2}$/, `${id} is not the approved SEM25 form`);
  });
});
