// ROW25 contract tests — the W2-ACCESS responsibility branch (Plan §5.3, implementation plan §3.1 Track B).
//
// These tests are the mechanical proof that the ROW25 P0 branch is REAL test
// assets rather than prose:
//   * all 22 source requirements are present exactly once, with the approved
//     executionId form and the source requirement id read live from the source
//     Spec (no omission, no fabrication);
//   * every id is owned by the approved branch (ACCESS) and carries legal
//     executors / capabilities / assertion tokens;
//   * every id has id-SPECIFIC assertion steps — a copy-paste regression fails;
//   * the fail-closed ids encode a refusal, and a permissive result is rejected
//     (V15, V20, V21 among them);
//   * V19 / V22 stay conditional on D-03. The product ledger may record D-03
//     fixed from the two repository tests. Their descriptor expectedStatus
//     stays not_run; that close does not record an E2E pass or customer delivery.
//   * the status semantics are the approved ones: an item whose only executed
//     layer is the unit layer is `not_run`, never `passed`.
//
// Nothing here records a run status: no execution item may be recorded as
// passed without real run evidence (implementation plan §3.2.3).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

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
  ROW25_C19_IDS,
  ROW25_EXECUTION_GROUPS,
  ROW25_EXECUTION_IDS,
  ROW25_OWNER_BRANCH,
  ROW25_P1_IDS,
  ROW25_SOURCE_SPEC,
  accessCase,
  accessCases,
  accessContractProblems,
  accessSummary,
  judgeRefusal
} from "../lib/access-v025.mjs";

const coverage = loadCoverage();
const specText = readFileSync(path.join(REPO_ROOT, ROW25_SOURCE_SPEC), "utf8");
const group = SOURCE_GROUPS.find((g) => g.key === "ROW25");
const cases = accessCases();

/** The manifest rows this branch owns, keyed by execution id. */
const manifestRows = new Map(
  coverage.newScenarios.filter((s) => s.executionId.startsWith("ROW25-")).map((s) => [s.executionId, s])
);

/** The machine-checkable defect ledger — D-03's real state, never forged here. */
const findings = parse(readFileSync(path.join(REPO_ROOT, "docs", "qa", "security-findings.yaml"), "utf8"));
const d03 = findings.findings.find((f) => f.id === "D-03");

describe("ROW25 execution descriptors (W2-ACCESS, Plan §5.3)", () => {
  it("covers all 22 source requirements exactly once, with the approved executionId form", () => {
    assert.equal(cases.length, 22, "ROW25 must carry exactly 22 descriptors");
    assert.equal(new Set(cases.map((c) => c.executionId)).size, 22, "no duplicate executionId");
    assert.deepEqual([...cases.map((c) => c.executionId)].sort(), [...ROW25_EXECUTION_IDS].sort());
    assert.equal(manifestRows.size, 22, "the manifest must carry exactly 22 ROW25 rows");
    for (const c of cases) {
      assert.equal(executionIdFor(group, c.sourceRequirementId), c.executionId, `${c.executionId} is not the approved form`);
      assert.equal(c.sourceRequirementId, `V${c.executionId.slice(-2)}`);
    }
  });

  it("takes every source requirement id live from the source Spec (no omission, no fabrication)", () => {
    const baseline = sourceRequirementBaseline().get("ROW25");
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
        `${c.sourceRequirementId} has no acceptance row in ${ROW25_SOURCE_SPEC}`
      );
    }
  });

  it("is owned by the approved branch ACCESS on every id", () => {
    for (const c of cases) {
      assert.equal(c.ownerBranch, ROW25_OWNER_BRANCH, `${c.executionId} owner branch`);
      assert.equal(c.ownerBranch, group.ownerBranch, `${c.executionId} owner branch vs the approved group`);
      assert.equal(manifestRows.get(c.executionId).ownerBranch, ROW25_OWNER_BRANCH, `${c.executionId} owner branch in the manifest`);
    }
    assert.equal(accessSummary().byGroup["same-source-preview"], 6);
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
    for (const [, row] of manifestRows) {
      for (const e of row.executors) assert.ok(EXECUTOR_LETTERS.includes(e), `manifest executor ${e}`);
      for (const r of row.requires) assert.ok(CAPABILITIES.includes(r), `manifest capability ${r}`);
      for (const a of row.assert) assert.ok(ASSERTION_TOKENS.includes(a), `manifest assertion token ${a}`);
    }
  });

  it("mirrors the approved coverage manifest exactly (single source of truth)", () => {
    assert.deepEqual(accessContractProblems(), [], "descriptor / manifest drift");
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
    for (const [step, owners] of stepOwner) {
      assert.ok(owners.length <= 2, `step shared by ${owners.length} ids (${owners.join(", ")}): ${step}`);
    }
    const fingerprints = new Set(cases.map((c) => c.steps.join("")));
    assert.equal(fingerprints.size, cases.length, "two ids share the identical step list");
    for (const c of cases) {
      const unique = c.steps.filter((s) => stepOwner.get(s).length === 1);
      assert.ok(unique.length > 0, `${c.executionId} has no step of its own`);
    }
  });

  it("keeps the four approved execution groups (Plan §5.3) intact", () => {
    const grouped = new Map();
    for (const c of cases) {
      if (!grouped.has(c.executionGroup)) grouped.set(c.executionGroup, []);
      grouped.get(c.executionGroup).push(c.executionId);
    }
    assert.deepEqual([...grouped.keys()].sort(), Object.keys(ROW25_EXECUTION_GROUPS).sort());
    for (const [name, ids] of Object.entries(ROW25_EXECUTION_GROUPS)) {
      assert.deepEqual([...(grouped.get(name) ?? [])].sort(), [...ids].sort(), `group ${name}`);
    }
  });

  it("encodes a refusal for every fail-closed id and rejects a permissive result", () => {
    const failClosed = cases.filter((c) => c.failClosed);
    assert.ok(failClosed.length >= 10, "the ACCESS branch must declare its fail-closed ids");
    for (const id of ["ROW25-V15", "ROW25-V20", "ROW25-V21"]) {
      assert.ok(failClosed.some((c) => c.executionId === id), `${id} must be fail-closed`);
    }
    for (const c of failClosed) {
      assert.ok(c.refusal, `${c.executionId} is fail-closed but carries no refusal expectation`);
      assert.ok(
        (c.refusal.description && c.refusal.description.length > 0) || (c.refusal.reasonCode && c.refusal.reasonCode.length > 0),
        `${c.executionId} refusal expectation must name what is refused`
      );
      assert.ok(c.refusal.effect && c.refusal.effect.length > 0, `${c.executionId} refusal must state its effect`);
      const permissive = judgeRefusal(c, { refused: false });
      assert.equal(permissive.ok, false, `${c.executionId} accepted a permissive result`);
      assert.equal(permissive.verdict, "permissive-rejected");
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

  it("names the source Spec's own reason codes where the Spec names one", () => {
    const expected = new Map([
      ["ROW25-V04", "row_policy_template_unresolved"],
      ["ROW25-V05", "row_policy_field_unknown"],
      ["ROW25-V06", "row_policy_field_unresolved:measure"],
      ["ROW25-V07", "row_policy_op_forbidden"],
      ["ROW25-V17", "row_policy_requires_wrapped_tool"],
      ["ROW25-V18", "row_policy_upstream_unproven"]
    ]);
    for (const [id, code] of expected) {
      assert.equal(accessCase(id).refusal.reasonCode, code, `${id} reason code`);
      assert.ok(specText.includes(code), `${code} must come from ${ROW25_SOURCE_SPEC}`);
    }
    // ids whose Spec row names no code must not carry an invented one
    for (const id of ["ROW25-V11", "ROW25-V13", "ROW25-V15"]) {
      assert.equal(accessCase(id).refusal.reasonCode, null, `${id} must not invent a reason code`);
    }
  });

  it("records D-03 fixed by the repository tests while V19 / V22 stay not_run", () => {
    assert.ok(d03, "D-03 must exist in the defect ledger");
    assert.equal(d03.status, "fixed");
    assert.equal(d03.fixedIn, "b7b157354d970860cdb03552c5d5839d7a7ccb9f");
    assert.deepEqual(d03.verifiedBy, ["ROW25-V19", "ROW25-V22"]);
    assert.equal(d03.acceptedBy, null);

    const g01 = findings.findings.find((f) => f.id === "G-01");
    const g06 = findings.findings.find((f) => f.id === "G-06");
    assert.equal(g01?.status, "open", "G-01 stays open; D-03 does not claim customer delivery");
    assert.equal(g01?.fixedIn, null);
    assert.deepEqual(g01?.verifiedBy, []);
    assert.equal(g06?.status, "open", "G-06 stays open; Wave 0b stays with blocked_delivery");
    assert.equal(g06?.fixedIn, null);
    assert.deepEqual(g06?.verifiedBy, []);

    const conditional = cases.filter((c) => c.conditional);
    assert.deepEqual(conditional.map((c) => c.executionId).sort(), ["ROW25-V19", "ROW25-V22"]);
    for (const c of conditional) {
      assert.equal(c.conditionalOn, "D-03", `${c.executionId} must name D-03 as its condition`);
      assert.equal(c.expectedStatus, "not_run", `${c.executionId} must not claim an E2E pass`);
      assert.ok(!ROW25_C19_IDS.includes(c.executionId), `${c.executionId} is not a C19 id`);
      const status = statusFromDimensions(
        { unit: { status: "passed" } },
        { required: [...c.requiredExecutors], verifierPassed: true }
      );
      assert.equal(status, "not_run", `${c.executionId}: a single passing layer is never a pass`);
      const maintenance = c.evidenceDimensions.find((d) => d.dimension === "customer-maintenance-line");
      assert.ok(maintenance, `${c.executionId} must carry the maintenance-line dimension`);
      assert.equal(maintenance.state, "blocked");
      assert.equal(maintenance.blockedReason, "environment");
      assert.match(maintenance.doesNotProve, /客户/);
      assert.ok(
        c.localCoverage.includes("webui/server/__tests__/row-policy-d03-uppercase.test.ts"),
        `${c.executionId} points at the uppercase-schema repository test`
      );
      assert.ok(
        c.localCoverage.includes("webui/server/__tests__/row-policy-d03-realfs.test.ts"),
        `${c.executionId} points at the real-filesystem regression`
      );
    }
  });

  it("keeps template ids at P1 and out of the C19 set", () => {
    for (const id of ROW25_P1_IDS) {
      assert.equal(accessCase(id).priority, "P1", id);
      assert.ok(!ROW25_C19_IDS.includes(id), `${id} is a template id`);
    }
    for (const id of ROW25_C19_IDS) {
      assert.equal(accessCase(id).priority, "P0", id);
      assert.ok(!ROW25_P1_IDS.includes(id), id);
    }
    assert.equal(ROW25_C19_IDS.length, 11);
  });

  it("requires mysql for every ROW25 id and does not require postgres", () => {
    for (const c of cases) {
      assert.ok(c.requiredCapabilities.includes("mysql"), `${c.executionId} must require mysql`);
      assert.ok(!c.requiredCapabilities.includes("postgres"), `${c.executionId} must not require postgres`);
    }
  });

  it("keeps the fault dimension on V15 and no other id", () => {
    const v15 = accessCase("ROW25-V15");
    assert.ok(v15.requiredCapabilities.includes("fault-control"), "V15 needs the fault-control capability");
    const faultDim = v15.evidenceDimensions.find((d) => d.dimension === "fault");
    assert.ok(faultDim, "V15 must carry the fault evidence dimension");
    assert.equal(faultDim.state, "blocked");
    assert.equal(faultDim.blockedReason, "environment");
    for (const c of cases.filter((x) => x.executionId !== "ROW25-V15")) {
      assert.ok(!c.requiredCapabilities.includes("fault-control"), `${c.executionId} must not claim a fault dimension`);
      assert.ok(
        !c.evidenceDimensions.some((d) => d.dimension === "fault"),
        `${c.executionId} must not carry the fault evidence dimension`
      );
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
      const full = Object.fromEntries(c.requiredExecutors.map((e) => [e, { status: "passed" }]));
      assert.equal(statusFromDimensions(full, { required: [...c.requiredExecutors], verifierPassed: true }), "passed");
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

  it("does not invent a second execution-id namespace for the row-permission requirements", () => {
    const ids = new Set(ROW25_EXECUTION_IDS);
    assert.equal(ids.size, 22);
    for (const id of ids) assert.match(id, /^ROW25-V\d{2}$/, `${id} is not the approved ROW25 form`);
  });
});
