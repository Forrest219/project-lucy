// v0.25 Track D — P1 execution descriptors and their evidence semantics.
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md
//       §7.3 (P1 mapping), §7.4 (CON25 increment), §8.1 (evidence layers), §8.2 (statuses)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md
//       §6.1 (RTP/RTV/ASV), §6.2 (ACM), §6.3 (HIVE), §6.4 (CONN)
//   * docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md §8 (RTP/RTV)
//   * docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §8 (ASV)
//   * webui/docs/187-access-relation-sankey-spec.md §10 (SC)
//   * docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §7 (V01–V17)
//   * docs/governance/database-support-matrix.md §3 (support status — single source of truth)
//   * webui/src/lib/connectionId.ts (DATABASE_TYPES — single source of truth for the 8 types)
//
// What this file proves, mechanically:
//
//   1. Every Track D execution id exists exactly once, with the APPROVED (non-uniform)
//      executionId form and its own source requirement id / source Spec.
//   2. Every id has the approved owner branch and mirrors the manifest's executors,
//      capabilities, assertion tokens and artifacts.
//   3. Every descriptor has the SAME shape across the five descriptor modules
//      (steps / assertionSteps / dimensions / failClosed), so a cross-track gate can
//      read them uniformly.
//   4. Every id has NON-EMPTY, ID-SPECIFIC assertion steps. A copy-paste regression
//      (the same step list reused for 17 Hive ids) fails the uniqueness assertion.
//   5. CON25-01..08 cover exactly the 8 DATABASE_TYPES keys, in the manifest's order.
//   6. Support-status discipline: a `gated` type without its certification environment
//      is `blocked`; an `experimental` / `roadmap` type can only be verified for its
//      declared limits and fail-closed behaviour — a "real query support passed" verdict
//      is NOT EXPRESSIBLE for it.
//   7. CON25-09..12 encode fail-closed expectations, and a permissive observation is
//      rejected by a negative test.
//   8. The refusal contracts of RTP／RTV／ASV／ACM are executable: a permissive
//      observation is rejected by a negative test for every refusal-contract id.
//   9. HIV25-V03..V05 keep the compile-side and the real-HS2 dimensions apart; a
//      compile-side pass can never be reported as an HS2 execution pass.
//  10. `statusFromDimensions()` integration: an item whose only executed layer is unit
//      is `not_run`, never `passed`.
//
// Nothing here records a run status. This file never claims that any execution item
// passed: no browser, no real Agent, no real HS2 cluster and no customer environment
// exist in this environment.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "../lib/common.mjs";
import { ASSERTION_TOKENS, CAPABILITIES, EXECUTOR_LETTERS } from "../lib/catalog.mjs";
import { SOURCE_GROUPS, executionIdFor, loadCoverage } from "../lib/v025-coverage.mjs";
import { statusFromDimensions } from "../lib/v025-result.mjs";
import {
  HIV25_CASES,
  HIV25_COMPILE_ONLY_IDS,
  HIV25_EXECUTION_IDS,
  HIV25_REAL_HS2_IDS,
  HIV25_SPLIT_IDS,
  hiveCaseFor,
  hiveCompilePassCanSatisfyHs2,
  hiveDimensionSplit,
  hiveExpectedBlockedReason,
  hiveStatusFor
} from "../lib/hive-v025.mjs";
import {
  CON25_CASES,
  CON25_EXECUTION_IDS,
  CON25_FAIL_CLOSED_IDS,
  CON25_IDENTITY_IDS,
  CON25_SUPPORT_STATUS,
  DATABASE_TYPE_ORDER,
  con25CaseFor,
  con25DatabaseType,
  con25EvidenceDimensions,
  con25FailClosedVerdict,
  con25OutcomeWithoutEnvironment,
  con25RealQuerySupportExpressible,
  con25RequiredDimensions,
  con25StatusFor,
  con25SupportStatus
} from "../lib/connection-matrix-v025.mjs";
import {
  RTP25_CASES,
  RTV25_CASES,
  ROW_POLICY_CASES,
  rowPolicyCaseFor,
  rowPolicyCaseIds,
  rowPolicyRefusalIds,
  rowPolicyRefusalVerdict,
  rowPolicyTemplateCases
} from "../lib/row-policy-templates-v025.mjs";
import {
  ASV25_CASES,
  authorizationSummaryCaseFor,
  authorizationSummaryCaseIds,
  authorizationSummaryRefusalIds,
  authorizationSummaryRefusalVerdict
} from "../lib/authorization-summary-v025.mjs";
import {
  ACM25_CASES,
  accessMapCaseFor,
  accessMapCaseIds,
  accessMapRefusalIds,
  accessMapRefusalVerdict
} from "../lib/access-map-v025.mjs";

const coverage = loadCoverage();
const manifestById = new Map(coverage.newScenarios.map((s) => [s.executionId, s]));

/** Every Track D descriptor: the four P1 groups plus the two lib modules. */
const ALL_CASES = [
  ...RTP25_CASES, ...RTV25_CASES, ...ASV25_CASES, ...ACM25_CASES, ...HIV25_CASES, ...CON25_CASES
];

/** The manifest rows Track D owns. */
const TRACK_D_MANIFEST_ROWS = coverage.newScenarios.filter((s) =>
  /^(RTP25|RTV25|ASV25|ACM25|HIV25|CON25)-/.test(s.executionId)
);

/** Reads the 8 selectable UI database types straight from the TypeScript source of truth. */
function readDatabaseTypes() {
  const source = readFileSync(path.join(REPO_ROOT, "webui", "src", "lib", "connectionId.ts"), "utf8");
  const block = source.split("export const DATABASE_TYPES")[1]?.split("\n];")[0] ?? "";
  return [...block.matchAll(/key:\s*"([a-z]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------------------

describe("v0.25 Track D — execution descriptors (RTP/RTV/ASV/ACM/HIV/CON)", () => {
  it("covers every Track D execution id exactly once", () => {
    assert.equal(ALL_CASES.length, 75, "Track D owns 10 + 8 + 14 + 14 + 17 + 12 = 75 execution items");
    const ids = ALL_CASES.map((c) => c.executionId);
    assert.equal(new Set(ids).size, ids.length, "no execution id appears twice");
    assert.deepEqual(
      [...ids].sort(),
      [...TRACK_D_MANIFEST_ROWS.map((s) => s.executionId)].sort(),
      "the descriptors cover exactly the manifest's Track D rows"
    );
  });

  it("exposes one descriptor array per group, so a cross-track gate can read them uniformly", () => {
    assert.equal(RTP25_CASES.length, 10, "RTP25_CASES");
    assert.equal(RTV25_CASES.length, 8, "RTV25_CASES");
    assert.equal(ASV25_CASES.length, 14, "ASV25_CASES");
    assert.equal(ACM25_CASES.length, 14, "ACM25_CASES");
    assert.equal(HIV25_CASES.length, 17, "HIV25_CASES");
    assert.equal(CON25_CASES.length, 12, "CON25_CASES");
    assert.equal(ROW_POLICY_CASES.length, 18, "ROW_POLICY_CASES");
    assert.deepEqual([...rowPolicyCaseIds()], [
      ...RTP25_CASES.map((c) => c.executionId), ...RTV25_CASES.map((c) => c.executionId)
    ]);
    assert.deepEqual([...authorizationSummaryCaseIds()], ASV25_CASES.map((c) => c.executionId));
    assert.deepEqual([...accessMapCaseIds()], ACM25_CASES.map((c) => c.executionId));
  });

  it("publishes a module-level array per descriptor module for the cross-track gate", () => {
    // The cross-track gate resolves ONE accessor per module, so each module must expose
    // its complete id set under a single name. `row-policy-templates-v025.mjs` holds 18
    // ids (RTP + RTV) and exposes them as `rowPolicyTemplateCases`; the per-group views
    // `RTP25_CASES` (10) and `RTV25_CASES` (8) remain available for per-group use.
    assert.deepEqual([...rowPolicyTemplateCases].map((c) => c.executionId),
      [...RTP25_CASES, ...RTV25_CASES].map((c) => c.executionId));
    assert.equal(rowPolicyTemplateCases.length, 18);
    assert.equal(new Set(rowPolicyTemplateCases.map((c) => c.executionId)).size, 18);
    assert.deepEqual([...ROW_POLICY_CASES].map((c) => c.executionId),
      rowPolicyTemplateCases.map((c) => c.executionId));
    // every module-level array carries exactly its own group's ids
    assert.equal(new Set(HIV25_CASES.map((c) => c.executionId)).size, 17);
    assert.equal(new Set(CON25_CASES.map((c) => c.executionId)).size, 12);
    assert.equal(new Set(ASV25_CASES.map((c) => c.executionId)).size, 14);
    assert.equal(new Set(ACM25_CASES.map((c) => c.executionId)).size, 14);
  });

  it("uses the approved (non-uniform) executionId form for every id", () => {
    for (const item of ALL_CASES) {
      const row = manifestById.get(item.executionId);
      assert.ok(row, `${item.executionId} is not in the coverage manifest`);
      if (item.sourceRequirementId === null) {
        assert.equal(item.executionId, row.executionId);
        continue;
      }
      const group = SOURCE_GROUPS.find((g) => item.executionId.startsWith(`${g.key}-`));
      assert.ok(group, `${item.executionId} has no approved source group`);
      assert.equal(item.executionId, executionIdFor(group, item.sourceRequirementId),
        `${item.executionId} does not match the approved form`);
    }
    // the approved forms really are non-uniform — this test would notice if they were unified
    assert.deepEqual(HIV25_EXECUTION_IDS[0], "HIV25-V01");
    assert.deepEqual(CON25_EXECUTION_IDS[0], "CON25-01");
    assert.deepEqual(ACM25_CASES[0].executionId, "ACM25-SC-01");
    assert.deepEqual(RTP25_CASES[0].executionId, "RTP25-01");
    assert.deepEqual(RTV25_CASES[0].executionId, "RTV25-01");
    assert.deepEqual(ASV25_CASES[0].executionId, "ASV25-01");
  });

  it("binds every id to its own source requirement id and source Spec", () => {
    for (const item of ALL_CASES) {
      const row = manifestById.get(item.executionId);
      assert.ok(row, `${item.executionId} is not in the coverage manifest`);
      assert.equal(item.sourceRequirementId, row.sourceRequirementId ?? null, `${item.executionId} source requirement id`);
      assert.equal(item.sourceSpec, row.sourceSpec, `${item.executionId} source Spec`);
      assert.equal(item.priority, row.priority, `${item.executionId} priority`);
    }
    // the source requirement ids are the ones the source Specs actually declare
    assert.deepEqual(RTP25_CASES.map((c) => c.sourceRequirementId),
      Array.from({ length: 10 }, (_, i) => `RTP-${String(i + 1).padStart(2, "0")}`));
    assert.deepEqual(RTV25_CASES.map((c) => c.sourceRequirementId),
      Array.from({ length: 8 }, (_, i) => `RTV-${String(i + 1).padStart(2, "0")}`));
    assert.deepEqual(ASV25_CASES.map((c) => c.sourceRequirementId),
      Array.from({ length: 14 }, (_, i) => `ASV-${String(i + 1).padStart(2, "0")}`));
    assert.deepEqual(ACM25_CASES.map((c) => c.sourceRequirementId),
      Array.from({ length: 14 }, (_, i) => `SC-${String(i + 1).padStart(2, "0")}`));
    assert.deepEqual(HIV25_EXECUTION_IDS, Array.from({ length: 17 }, (_, i) => `HIV25-V${String(i + 1).padStart(2, "0")}`));
  });

  it("gives every id the approved owner branch", () => {
    const expected = {
      RTP25: "ACCESS", RTV25: "ACCESS", ASV25: "ACCESS",
      ACM25: "OBSERVE", HIV25: "CONN", CON25: "CONN"
    };
    for (const item of ALL_CASES) {
      const key = item.executionId.split("-")[0];
      assert.equal(item.ownerBranch, expected[key], `${item.executionId} owner branch`);
      assert.equal(item.ownerBranch, manifestById.get(item.executionId).ownerBranch,
        `${item.executionId} owner branch differs from the manifest`);
    }
  });

  it("mirrors the manifest's executors, capabilities, assertion tokens and artifacts", () => {
    for (const item of ALL_CASES) {
      const row = manifestById.get(item.executionId);
      assert.deepEqual([...item.executors], [...row.executors], `${item.executionId} executors`);
      assert.deepEqual([...item.requires], [...row.requires], `${item.executionId} requires`);
      assert.deepEqual([...item.assert], [...row.assert], `${item.executionId} assert`);
      assert.deepEqual([...item.artifacts], [...row.artifacts], `${item.executionId} artifacts`);
    }
  });

  it("uses only legal executors, capabilities and assertion tokens", () => {
    for (const item of ALL_CASES) {
      for (const e of item.executors) assert.ok(EXECUTOR_LETTERS.includes(e), `${item.executionId} executor ${e}`);
      for (const r of item.requires) assert.ok(CAPABILITIES.includes(r), `${item.executionId} capability ${r}`);
      for (const a of item.assert) assert.ok(ASSERTION_TOKENS.includes(a), `${item.executionId} assertion token ${a}`);
    }
  });

  it("gives every descriptor the same shape across the five descriptor modules", () => {
    for (const item of ALL_CASES) {
      assert.deepEqual([...item.steps], [...item.assertionSteps],
        `${item.executionId}: steps and assertionSteps must be the same steps`);
      assert.ok(Array.isArray(item.dimensions) && item.dimensions.length > 0, `${item.executionId} dimensions`);
      assert.equal(typeof item.failClosed, "object", `${item.executionId} failClosed`);
      assert.equal(typeof item.failClosed.isRefusal, "boolean", `${item.executionId} failClosed.isRefusal`);
      assert.ok(Array.isArray(item.failClosed.expectation), `${item.executionId} failClosed.expectation`);
      assert.deepEqual([...item.failClosed.tokens], [...item.failClosed.expectation],
        `${item.executionId} failClosed.tokens must mirror failClosed.expectation`);
      assert.equal(typeof item.failClosed.reason, "string", `${item.executionId} failClosed.reason`);
      assert.equal(typeof item.failClosed.detail, "string", `${item.executionId} failClosed.detail`);
      assert.equal(typeof item.passSemantics, "string", `${item.executionId} passSemantics`);
      assert.ok(Array.isArray(item.forbiddenPassSemantics), `${item.executionId} forbiddenPassSemantics`);
    }
  });

  it("gives every id non-empty, id-specific assertion steps", () => {
    for (const item of ALL_CASES) {
      assert.ok(Array.isArray(item.steps), `${item.executionId} steps`);
      assert.ok(item.steps.length >= 2, `${item.executionId} needs at least 2 assertion steps`);
      assert.equal(new Set(item.steps).size, item.steps.length,
        `${item.executionId} repeats an assertion step`);
      for (const step of item.steps) {
        assert.equal(typeof step, "string");
        assert.ok(step.trim().length > 0, `${item.executionId} has an empty assertion step`);
      }
    }
  });

  it("has no copy-paste assertion steps across the whole Track D (regression guard)", () => {
    const byText = new Map();
    for (const item of ALL_CASES) {
      const key = item.steps.join("||");
      assert.ok(!byText.has(key), `${item.executionId} reuses the assertion steps of ${byText.get(key)}`);
      byText.set(key, item.executionId);
    }
    // a step list may not be reused inside one group either (a 17x "same as V01" regression)
    for (const [groupKey, cases] of Object.entries({
      RTP25: RTP25_CASES, RTV25: RTV25_CASES, ASV25: ASV25_CASES, ACM25: ACM25_CASES, CON25: CON25_CASES
    })) {
      const seen = new Map();
      for (const item of cases) {
        const key = item.steps.join("||");
        assert.ok(!seen.has(key), `${groupKey}: ${item.executionId} reuses the steps of ${seen.get(key)}`);
        seen.set(key, item.executionId);
      }
    }
    const hiveTexts = new Set(HIV25_CASES.map((c) => c.steps.join("||")));
    assert.equal(hiveTexts.size, 17, "each of the 17 Hive ids has its own assertion steps");
    assert.equal(new Set(RTP25_CASES.map((c) => c.steps.join("||"))).size, 10);
    assert.equal(new Set(RTV25_CASES.map((c) => c.steps.join("||"))).size, 8);
    assert.equal(new Set(ASV25_CASES.map((c) => c.steps.join("||"))).size, 14);
    assert.equal(new Set(ACM25_CASES.map((c) => c.steps.join("||"))).size, 14);
    assert.equal(new Set(CON25_CASES.map((c) => c.steps.join("||"))).size, 12);
  });

  it("separates the layers closable here from the layers that need a real environment", () => {
    for (const item of ALL_CASES) {
      for (const dim of item.dimensions) {
        assert.equal(typeof dim.computableHere, "boolean", `${item.executionId} ${dim.name} computableHere`);
        assert.equal(typeof dim.name, "string", `${item.executionId} dimension name`);
        assert.ok(String(dim.note ?? "").length > 0, `${item.executionId} ${dim.name} note`);
        if (dim.requiresRealEnvironment) {
          assert.ok(["environment", "delivery", "capability", "implementation"].includes(dim.blockedReason),
            `${item.executionId} ${dim.name} blocked reason`);
        } else {
          assert.equal(dim.blockedReason, null, `${item.executionId} ${dim.name} must not carry a blocked reason`);
        }
      }
      // the four P1 groups each have at least one layer that is closable without an
      // external system. The Hive ids are different: V07–V15 and V16–V17 are bound to a
      // real HS2 cluster / a customer delivery environment from end to end, and their
      // compile-side counterpart is a separate id, not a local layer of the same item.
      const isP1Group = ["RTP25", "RTV25", "ASV25", "ACM25"].includes(item.executionId.split("-")[0]);
      if (isP1Group) {
        assert.ok(item.dimensions.some((d) => d.computableHere === true),
          `${item.executionId} needs a locally computable layer`);
      }
    }
    for (const item of CON25_CASES) {
      const dims = con25EvidenceDimensions(item.executionId);
      assert.ok(dims.locallyComputable.length > 0, `${item.executionId} local dimensions`);
      assert.ok(dims.needsRealEnvironment.length > 0, `${item.executionId} real-environment dimensions`);
    }
  });
});

describe("v0.25 RTP／RTV — row policy templates and per-table reverse lookup", () => {
  it("covers RTP25-01..10 and RTV25-01..08 with their own source rows", () => {
    assert.deepEqual(RTP25_CASES.map((c) => c.executionId),
      Array.from({ length: 10 }, (_, i) => `RTP25-${String(i + 1).padStart(2, "0")}`));
    assert.deepEqual(RTV25_CASES.map((c) => c.executionId),
      Array.from({ length: 8 }, (_, i) => `RTV25-${String(i + 1).padStart(2, "0")}`));
    for (const item of ROW_POLICY_CASES) {
      assert.equal(item.ownerBranch, "ACCESS", `${item.executionId} owner`);
      assert.equal(item.priority, "P1", `${item.executionId} priority`);
      assert.equal(item.sourceSpec, "docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md");
    }
  });

  it("mirrors the manifest's executors, capabilities and assertion tokens for RTP／RTV", () => {
    for (const item of ROW_POLICY_CASES) {
      const row = manifestById.get(item.executionId);
      assert.deepEqual([...item.executors], [...row.executors], `${item.executionId} executors`);
      assert.deepEqual([...item.requires], [...row.requires], `${item.executionId} requires`);
      assert.deepEqual([...item.assert], [...row.assert], `${item.executionId} assert`);
      assert.deepEqual([...item.artifacts], [...row.artifacts], `${item.executionId} artifacts`);
    }
    // RTP is the only group that also requires the Agent client and the security artifact
    assert.deepEqual([...RTP25_CASES[0].executors], ["P", "B", "A", "V"]);
    assert.deepEqual([...RTV25_CASES[0].executors], ["P", "B", "V"]);
    assert.deepEqual([...RTP25_CASES[0].artifacts], ["management-case-result.json", "security-case-result.json"]);
    assert.deepEqual([...RTV25_CASES[0].artifacts], ["management-case-result.json"]);
  });

  it("records the refusal contracts of the ids whose contract IS a refusal", () => {
    const refusalIds = rowPolicyRefusalIds();
    assert.ok(refusalIds.length > 0, "the row-policy group has refusal contracts");
    for (const id of refusalIds) {
      const item = rowPolicyCaseFor(id);
      assert.ok(item, `${id} has no descriptor`);
      assert.equal(item.failClosed.isRefusal, true, `${id} failClosed.isRefusal`);
      assert.ok(item.failClosed.reason.length > 0, `${id} failClosed.reason`);
      for (const token of item.failClosed.expectation) {
        assert.ok(item.assert.includes(token), `${id} refusal token ${token} is not declared`);
      }
    }
    // the refusal ids are exactly the ones whose source rows say so
    assert.deepEqual(refusalIds, [
      "RTP25-03", "RTP25-04", "RTP25-06", "RTP25-07", "RTP25-10",
      "RTV25-03", "RTV25-05", "RTV25-07"
    ]);
  });

  it("rejects a permissive outcome on every RTP／RTV refusal contract (negative test)", () => {
    const permissive = {
      refused: false,
      persisted: true,
      reasonClasses: ["generic"],
      reason: "",
      referencedRefused: false,
      unreferencedSaved: false,
      stalePreviewSubmittable: true,
      resavedAfterDryRun: false,
      readBlockedOnRecoveryFailure: false,
      writeBlockedOnRecoveryFailure: false,
      v1Rejected: false,
      legacyRejected: false,
      illegalCombinationRejected: false,
      legacyBehaviourChanged: true,
      states: ["ok"],
      emptyTableAsUnrestricted: true,
      emptyGrantValueCreated: true,
      state: "ok",
      failedSetVisible: false,
      showedZeroAuthorization: true,
      writeApis: 2
    };
    for (const id of rowPolicyRefusalIds()) {
      const verdict = rowPolicyRefusalVerdict(id, permissive);
      assert.equal(verdict.ok, false, `${id} must reject a permissive outcome`);
      assert.ok(verdict.reason.length > 0, `${id} must explain the rejection`);
    }
    // the honest outcomes are accepted
    assert.equal(rowPolicyRefusalVerdict("RTP25-03", {
      refused: true, persisted: false, reason: "op not allowed",
      reasonClasses: ["missing_reference", "illegal_op", "empty_predicate", "missing_measure", "missing_field"]
    }).ok, true);
    assert.equal(rowPolicyRefusalVerdict("RTP25-04", {
      referencedRefused: true, unreferencedSaved: true, persisted: false
    }).ok, true);
    assert.equal(rowPolicyRefusalVerdict("RTV25-03", {
      states: ["no_grant", "unsatisfiable", "compile_failed", "empty_filter"],
      emptyTableAsUnrestricted: false, emptyGrantValueCreated: false
    }).ok, true);
    assert.equal(rowPolicyRefusalVerdict("RTV25-05", {
      state: "unavailable", failedSetVisible: true, showedZeroAuthorization: false
    }).ok, true);
    assert.equal(rowPolicyRefusalVerdict("RTV25-07", { writeApis: 0 }).ok, true);
  });
});

describe("v0.25 ASV — access authorization summary", () => {
  it("covers ASV25-01..14 with their own source rows", () => {
    assert.deepEqual(ASV25_CASES.map((c) => c.executionId),
      Array.from({ length: 14 }, (_, i) => `ASV25-${String(i + 1).padStart(2, "0")}`));
    for (const item of ASV25_CASES) {
      assert.equal(item.ownerBranch, "ACCESS", `${item.executionId} owner`);
      assert.equal(item.priority, "P1", `${item.executionId} priority`);
      assert.equal(item.sourceSpec, "docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md");
      const row = manifestById.get(item.executionId);
      assert.deepEqual([...item.executors], [...row.executors], `${item.executionId} executors`);
      assert.deepEqual([...item.requires], [...row.requires], `${item.executionId} requires`);
      assert.deepEqual([...item.assert], [...row.assert], `${item.executionId} assert`);
      assert.deepEqual([...item.artifacts], [...row.artifacts], `${item.executionId} artifacts`);
    }
  });

  it("records the refusal contracts of the ids whose contract IS a refusal", () => {
    const refusalIds = authorizationSummaryRefusalIds();
    assert.deepEqual(refusalIds, ["ASV25-04", "ASV25-08", "ASV25-10", "ASV25-12", "ASV25-13"]);
    for (const id of refusalIds) {
      const item = authorizationSummaryCaseFor(id);
      assert.ok(item, `${id} has no descriptor`);
      assert.equal(item.failClosed.isRefusal, true, `${id} failClosed.isRefusal`);
      assert.ok(item.failClosed.reason.length > 0, `${id} failClosed.reason`);
      for (const token of item.failClosed.expectation) {
        assert.ok(item.assert.includes(token), `${id} refusal token ${token} is not declared`);
      }
    }
    // the summary is read-only: its secret-protection id must carry the no_leak token
    assert.ok(authorizationSummaryCaseFor("ASV25-13").assert.includes("no_leak"));
  });

  it("rejects a permissive outcome on every ASV refusal contract (negative test)", () => {
    const permissive = {
      denominatorUnknown: true,
      denominatorShown: true,
      unknownFilledWithZero: true,
      staleNumberKept: true,
      state: "ok",
      failuresVisible: false,
      showedZeroValue: true,
      prefilledOk: false,
      autoExecuted: true,
      legacyIdentified: false,
      emptyDistinguishableFromFailure: false,
      absoluteDenyGrantable: true,
      newWriteEntries: 2,
      leakedSecrets: ["plaintext-token"],
      overAuthorizedContent: true
    };
    for (const id of authorizationSummaryRefusalIds()) {
      const verdict = authorizationSummaryRefusalVerdict(id, permissive);
      assert.equal(verdict.ok, false, `${id} must reject a permissive outcome`);
      assert.ok(verdict.reason.length > 0, `${id} must explain the rejection`);
    }
    // the honest outcomes are accepted
    assert.equal(authorizationSummaryRefusalVerdict("ASV25-04", {
      denominatorUnknown: true, denominatorShown: false, unknownFilledWithZero: false, staleNumberKept: false
    }).ok, true);
    assert.equal(authorizationSummaryRefusalVerdict("ASV25-08", {
      state: "partial", failuresVisible: true, showedZeroValue: false
    }).ok, true);
    assert.equal(authorizationSummaryRefusalVerdict("ASV25-10", { prefilledOk: true, autoExecuted: false }).ok, true);
    assert.equal(authorizationSummaryRefusalVerdict("ASV25-12", {
      legacyIdentified: true, emptyDistinguishableFromFailure: true, absoluteDenyGrantable: false
    }).ok, true);
    assert.equal(authorizationSummaryRefusalVerdict("ASV25-13", {
      newWriteEntries: 0, leakedSecrets: [], overAuthorizedContent: false
    }).ok, true);
  });
});

describe("v0.25 ACM — access relation sankey", () => {
  it("covers ACM25-SC-01..SC-14 with their own source rows", () => {
    assert.deepEqual(ACM25_CASES.map((c) => c.executionId),
      Array.from({ length: 14 }, (_, i) => `ACM25-SC-${String(i + 1).padStart(2, "0")}`));
    for (const item of ACM25_CASES) {
      assert.equal(item.ownerBranch, "OBSERVE", `${item.executionId} owner`);
      assert.equal(item.priority, "P1", `${item.executionId} priority`);
      assert.equal(item.sourceSpec, "webui/docs/187-access-relation-sankey-spec.md");
      const row = manifestById.get(item.executionId);
      assert.deepEqual([...item.executors], [...row.executors], `${item.executionId} executors`);
      assert.deepEqual([...item.requires], [...row.requires], `${item.executionId} requires`);
      assert.deepEqual([...item.assert], [...row.assert], `${item.executionId} assert`);
      assert.deepEqual([...item.artifacts], [...row.artifacts], `${item.executionId} artifacts`);
    }
  });

  it("records the refusal contracts of the ids whose contract IS a refusal", () => {
    const refusalIds = accessMapRefusalIds();
    assert.deepEqual(refusalIds, ["ACM25-SC-07", "ACM25-SC-10", "ACM25-SC-13"]);
    for (const id of refusalIds) {
      const item = accessMapCaseFor(id);
      assert.ok(item, `${id} has no descriptor`);
      assert.equal(item.failClosed.isRefusal, true, `${id} failClosed.isRefusal`);
      assert.ok(item.failClosed.reason.length > 0, `${id} failClosed.reason`);
      for (const token of item.failClosed.expectation) {
        assert.ok(item.assert.includes(token), `${id} refusal token ${token} is not declared`);
      }
    }
  });

  it("rejects a permissive outcome on every ACM refusal contract (negative test)", () => {
    const permissive = {
      degradedStates: ["access_unreadable"],
      renderedEmptyGraph: true,
      needsReviewCopy: "需复核：这次调用明显越权",
      confirmedCopy: "确凿越权",
      unknownUpgradedToConfirmed: true,
      coverageNumerator: 3,
      coverageDenominator: 10,
      coverageUnknownFilledWithZero: true
    };
    for (const id of accessMapRefusalIds()) {
      const verdict = accessMapRefusalVerdict(id, permissive);
      assert.equal(verdict.ok, false, `${id} must reject a permissive outcome`);
      assert.ok(verdict.reason.length > 0, `${id} must explain the rejection`);
    }
    // the honest outcomes are accepted
    assert.equal(accessMapRefusalVerdict("ACM25-SC-07", {
      degradedStates: ["access_unreadable", "access_invalid", "access_config_path_mismatch"],
      renderedEmptyGraph: false
    }).ok, true);
    assert.equal(accessMapRefusalVerdict("ACM25-SC-10", {
      needsReviewCopy: "需复核 1 条", confirmedCopy: "确凿越权：调用当时授权亦不覆盖"
    }).ok, true);
    assert.equal(accessMapRefusalVerdict("ACM25-SC-13", {
      unknownUpgradedToConfirmed: false, coverageNumerator: 3, coverageDenominator: 10,
      coverageUnknownFilledWithZero: false
    }).ok, true);
  });
});

describe("v0.25 CON25 — database-type and access-failure matrix", () => {
  it("covers exactly the 8 DATABASE_TYPES keys, in the manifest's order", () => {
    const uiTypes = readDatabaseTypes();
    assert.equal(uiTypes.length, 8, "DATABASE_TYPES has 8 selectable types");
    assert.deepEqual([...DATABASE_TYPE_ORDER], uiTypes, "the descriptor order differs from the UI source of truth");
    const covered = CON25_EXECUTION_IDS.slice(0, 8).map((id) => con25DatabaseType(id));
    assert.deepEqual(covered, uiTypes, "CON25-01..08 do not cover the 8 types in order");
    assert.deepEqual(CON25_EXECUTION_IDS.slice(8), ["CON25-09", "CON25-10", "CON25-11", "CON25-12"]);
    // the manifest's own titles name the same 8 types
    const titles = CON25_EXECUTION_IDS.slice(0, 8).map((id) => manifestById.get(id).title);
    assert.match(titles[0], /^MySQL/);
    assert.match(titles[1], /^PostgreSQL/);
    assert.match(titles[2], /^StarRocks/);
    assert.match(titles[3], /^Doris/);
    assert.match(titles[4], /^SQL Server/);
    assert.match(titles[5], /^Oracle/);
    assert.match(titles[6], /^SQLite/);
    assert.match(titles[7], /^Amazon Athena/);
  });

  it("quotes the support status and never upgrades it", () => {
    const expected = {
      "CON25-01": "verified", "CON25-02": "verified", "CON25-03": "gated", "CON25-04": "gated",
      "CON25-05": "experimental", "CON25-06": "roadmap", "CON25-07": "verified", "CON25-08": "experimental"
    };
    for (const [id, status] of Object.entries(expected)) {
      assert.equal(con25SupportStatus(id), status, `${id} support status`);
      assert.equal(manifestById.get(id).supportStatus, status, `${id} manifest support status`);
      assert.equal(CON25_SUPPORT_STATUS[id], status);
    }
  });

  it("makes a gated type blocked (never passed) without its certification environment", () => {
    for (const id of ["CON25-03", "CON25-04"]) {
      const outcome = con25OutcomeWithoutEnvironment(id);
      assert.equal(outcome.status, "blocked", `${id} without its environment`);
      assert.equal(outcome.blockedReason, "environment", `${id} blocked reason`);
      assert.ok(con25RequiredDimensions(id).includes("certification-environment"), `${id} certification dimension`);
      const without = con25StatusFor(id, {
        dimensionStatuses: {
          "support-status-lookup": { status: "passed" },
          "database-type-mapping": { status: "passed" },
          "real-connection": { status: "passed" },
          "real-read-only-query": { status: "passed" }
        },
        environmentAvailable: false
      });
      assert.equal(without, "blocked", `${id} without its certification environment`);
      const partial = con25StatusFor(id, {
        dimensionStatuses: {
          "support-status-lookup": { status: "passed" },
          "database-type-mapping": { status: "passed" }
        }
      });
      assert.equal(partial, "not_run", `${id} with only the local dimensions executed`);
    }
  });

  it("makes a 'real query support passed' verdict inexpressible for experimental / roadmap types", () => {
    for (const id of ["CON25-05", "CON25-06", "CON25-08"]) {
      assert.equal(con25RealQuerySupportExpressible(id), false, `${id} must not express real query support`);
      const item = con25CaseFor(id);
      assert.ok(item.forbiddenPassSemantics.includes("real_query_support_passed"), `${id} forbidden verdict`);
      const status = con25StatusFor(id, {
        dimensionStatuses: { "support-status-lookup": { status: "passed" } },
        verdict: "real_query_support_passed"
      });
      assert.equal(status, "failed", `${id} must reject a real-query-support verdict`);
    }
    for (const id of ["CON25-01", "CON25-02", "CON25-07"]) {
      assert.equal(con25RealQuerySupportExpressible(id), true, `${id} may express real query support`);
    }
    for (const id of ["CON25-09", "CON25-10", "CON25-11", "CON25-12"]) {
      assert.equal(con25DatabaseType(id), null, `${id} is not a database type`);
      assert.equal(con25RealQuerySupportExpressible(id), false, `${id} must not express real query support`);
    }
  });

  it("encodes fail-closed expectations for CON25-09..12", () => {
    assert.deepEqual([...CON25_FAIL_CLOSED_IDS], ["CON25-10", "CON25-11", "CON25-12"]);
    assert.deepEqual([...CON25_IDENTITY_IDS], ["CON25-09"]);
    for (const id of ["CON25-10", "CON25-11", "CON25-12"]) {
      const item = con25CaseFor(id);
      assert.ok(item.assert.includes("deny"), `${id} must assert deny`);
      assert.ok(item.steps.some((s) => s.includes("失败关闭")), `${id} needs a fail-closed step`);
      assert.equal(item.failClosed.isRefusal, true, `${id} failClosed.isRefusal`);
      assert.ok(item.failClosed.reason.length > 0, `${id} failClosed.reason`);
      // the remaining tokens differ per scenario and are quoted from the manifest:
      //   CON25-10 deny + no_side_effect + no_leak
      //   CON25-11 deny + unavailable_not_open
      //   CON25-12 deny + unavailable_not_open + no_leak
      const expected = {
        "CON25-10": ["deny", "no_side_effect", "no_leak"],
        "CON25-11": ["deny", "unavailable_not_open"],
        "CON25-12": ["deny", "unavailable_not_open", "no_leak"]
      }[id];
      assert.deepEqual([...item.assert], expected, `${id} assertion tokens`);
      assert.deepEqual([...manifestById.get(id).assert], expected, `${id} manifest assertion tokens`);
    }
    const identity = con25CaseFor("CON25-09");
    assert.ok(identity.assert.includes("exactly_one_wins"), "CON25-09 must assert exactly_one_wins");
    assert.ok(identity.assert.includes("upstream_exec_zero"), "CON25-09 must assert upstream_exec_zero");
  });

  it("rejects a permissive observation on CON25-09..12 (negative test)", () => {
    const permissive = {
      connectionSucceeded: true,
      usable: true,
      errorClass: "other",
      leakedSecrets: [],
      upstreamExecutions: 1,
      matchedSides: 2,
      unauthorizedUpstreamExecutions: 1
    };
    for (const id of ["CON25-10", "CON25-11", "CON25-12", "CON25-09"]) {
      const verdict = con25FailClosedVerdict(id, permissive);
      assert.equal(verdict.ok, false, `${id} must reject a permissive observation`);
      assert.ok(verdict.reason.length > 0, `${id} must explain the rejection`);
    }
    assert.equal(con25FailClosedVerdict("CON25-10", { connectionSucceeded: false, leakedSecrets: ["s3cr3t"] }).ok, false);
    assert.equal(con25FailClosedVerdict("CON25-11", {
      connectionSucceeded: false, usable: false, errorClass: "unsupported", upstreamExecutions: 0
    }).ok, false);
    assert.equal(con25FailClosedVerdict("CON25-10", {
      connectionSucceeded: false, usable: false, errorClass: "auth", leakedSecrets: [], upstreamExecutions: 0
    }).ok, true);
    assert.equal(con25FailClosedVerdict("CON25-11", {
      connectionSucceeded: false, usable: false, errorClass: "network", leakedSecrets: [], upstreamExecutions: 0
    }).ok, true);
    assert.equal(con25FailClosedVerdict("CON25-12", {
      connectionSucceeded: false, usable: false, errorClass: "tls", leakedSecrets: [], upstreamExecutions: 0
    }).ok, true);
    assert.equal(con25FailClosedVerdict("CON25-09", {
      connectionSucceeded: true, usable: true, errorClass: "other", leakedSecrets: [], upstreamExecutions: 1,
      matchedSides: 1, unauthorizedUpstreamExecutions: 0
    }).ok, true);
  });

  it("never turns a missing run into a pass", () => {
    for (const id of CON25_EXECUTION_IDS) {
      const outcome = con25OutcomeWithoutEnvironment(id);
      assert.notEqual(outcome.status, "passed", `${id} must not be a pass without a run`);
      assert.equal(outcome.status, "blocked", `${id} outcome without an environment`);
      assert.equal(outcome.blockedReason, "environment", `${id} blocked reason`);
      assert.equal(con25StatusFor(id, { dimensionStatuses: {}, environmentAvailable: true }), "not_run",
        `${id} with no executed dimension`);
    }
  });
});

describe("v0.25 HIV25 — the compile side and the real-HS2 side stay separate", () => {
  it("keeps V03..V05's compile-side and real-HS2 dimensions apart", () => {
    for (const id of HIV25_SPLIT_IDS) {
      const split = hiveDimensionSplit(id);
      assert.equal(split.compileSide, true, `${id} needs a compile-side dimension`);
      assert.equal(split.realHs2, true, `${id} needs a real-HS2 dimension`);
      const names = hiveCaseFor(id).dimensions.map((d) => d.name);
      assert.deepEqual(names, ["compile-side", "real-hs2"], `${id} dimension names`);
    }
  });

  it("records the compile-only ids as compile-only", () => {
    assert.deepEqual([...HIV25_COMPILE_ONLY_IDS], ["HIV25-V01", "HIV25-V02", "HIV25-V06"]);
    for (const id of HIV25_COMPILE_ONLY_IDS) {
      const split = hiveDimensionSplit(id);
      assert.equal(split.compileSide, true, `${id} compile side`);
      assert.equal(split.realHs2, false, `${id} must not require an HS2 cluster`);
      assert.equal(hiveExpectedBlockedReason(id), null, `${id} blocked reason`);
    }
    for (const id of HIV25_REAL_HS2_IDS) {
      assert.equal(hiveExpectedBlockedReason(id), "environment", `${id} blocked reason`);
    }
    assert.equal(hiveExpectedBlockedReason("HIV25-V16"), "delivery");
    assert.equal(hiveExpectedBlockedReason("HIV25-V17"), "delivery");
  });

  it("never lets a compile-side pass be reported as an HS2 execution pass", () => {
    for (const id of HIV25_SPLIT_IDS) {
      assert.equal(hiveCompilePassCanSatisfyHs2(id), false, `${id} must not let a compile pass stand in for HS2`);
      const compileOnly = hiveStatusFor(id, { dimensionStatuses: { "compile-side": { status: "passed" } } });
      assert.equal(compileOnly, "not_run", `${id} with only the compile side executed`);
      const hs2Failed = hiveStatusFor(id, {
        dimensionStatuses: { "compile-side": { status: "passed" }, "real-hs2": { status: "failed" } }
      });
      assert.equal(hs2Failed, "failed", `${id} with a failed HS2 side`);
      const bothPassed = hiveStatusFor(id, {
        dimensionStatuses: { "compile-side": { status: "passed" }, "real-hs2": { status: "passed" } }
      });
      assert.equal(bothPassed, "passed", `${id} with both sides passed`);
    }
    for (const item of HIV25_CASES) {
      assert.ok(item.forbiddenPassSemantics.includes("hs2_execution_passed_without_cluster"),
        `${item.executionId} must forbid an HS2 pass without a cluster`);
    }
  });

  it("records the refusal contracts of the Hive ids whose contract IS a refusal", () => {
    const refusalIds = HIV25_CASES.filter((c) => c.failClosed.isRefusal).map((c) => c.executionId);
    assert.deepEqual(refusalIds, [
      "HIV25-V06", "HIV25-V09", "HIV25-V11", "HIV25-V13", "HIV25-V15"
    ]);
    for (const id of refusalIds) {
      const item = hiveCaseFor(id);
      assert.ok(item.failClosed.reason.length > 0, `${id} failClosed.reason`);
      for (const token of item.failClosed.expectation) {
        assert.ok(item.assert.includes(token), `${id} refusal token ${token} is not declared`);
      }
    }
  });
});

describe("v0.25 result format integration (Plan W0-6)", () => {
  it("treats an item whose only executed layer is unit as not_run", () => {
    const required = ["P", "B", "A", "V"];
    const dimensions = { P: { status: "passed" } };
    assert.equal(statusFromDimensions(dimensions, { required }), "not_run");
    // a Hive item whose compile side is the only executed layer is not_run: the compile
    // side alone never completes an item, and never stands in for an HS2 execution
    assert.equal(hiveStatusFor("HIV25-V01", { dimensionStatuses: { "compile-side": { status: "passed" } } }),
      "not_run");
    assert.equal(hiveStatusFor("HIV25-V03", { dimensionStatuses: { "compile-side": { status: "passed" } } }),
      "not_run");
    // and through the CON25 helper: the local dimensions alone never complete an item
    assert.equal(con25StatusFor("CON25-01", {
      dimensionStatuses: { "support-status-lookup": { status: "passed" } }
    }), "not_run");
  });

  it("never reports a partial dimension set as passed", () => {
    const required = ["P", "B", "A", "V"];
    assert.equal(statusFromDimensions({ P: { status: "passed" }, B: { status: "passed" } }, { required }), "not_run");
    assert.equal(statusFromDimensions({
      P: { status: "passed" }, B: { status: "passed" }, A: { status: "passed" }, V: { status: "passed" }
    }, { required }), "passed");
    assert.equal(statusFromDimensions({
      P: { status: "passed" }, B: { status: "passed" }, A: { status: "passed" }, V: { status: "passed" }
    }, { required, verifierPassed: false }), "failed");
  });
});
