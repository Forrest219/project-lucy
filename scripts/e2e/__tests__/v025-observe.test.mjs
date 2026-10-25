// v0.25 Track C / W2-OBSERVE contract tests (Plan §5.4, implementation plan §3.1).
//
// These are CONTRACT-level tests: they run on stock macOS, need no instance,
// no browser, no Agent and no database.  They prove that the OBSERVE branch
// (AUD25-A01..A12, ARV25-V01..V12, LOG25-01) has
//
//   * 25 execution ids, each present exactly once, in the approved form;
//   * an owner branch equal to the approved owner;
//   * legal executors / capabilities / assertion tokens / artifacts;
//   * NON-EMPTY, ID-SPECIFIC assertion steps anchored to the source Spec
//     (a copy-paste regression fails here);
//   * fail-closed semantics, with a NEGATIVE test proving a permissive
//     result is rejected;
//   * "a crash never re-executes business" encoded on the barrier ids;
//   * a cross-round relation rebuild for LOG25-01 that is provably NOT a
//     duplicate of the frozen UX-07-S01;
//   * status semantics where a single executed layer is never a pass.
//
// Nothing here records a run status: the descriptors declare contracts, the
// runtime dimensions stay not_run / blocked until a real environment runs
// them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "../lib/common.mjs";
import { ASSERTION_TOKENS, CAPABILITIES, EXECUTOR_LETTERS, loadCatalog } from "../lib/catalog.mjs";
import {
  LOG25_IDS,
  SOURCE_GROUPS,
  executionIdFor,
  loadCoverage
} from "../lib/v025-coverage.mjs";
import { BLOCKED_REASONS, createResult, statusFromDimensions, validateResult } from "../lib/v025-result.mjs";
import {
  AUDIT_DELIVERY_BLOCKED_IDS,
  AUD25_IDS,
  AUDIT_NO_ADVANCE_IDS,
  AUDIT_PRIMARY_STATUS_BUCKETS,
  AUDIT_REFUSAL_IDS,
  AUDIT_SOURCE_COLUMNS,
  AUDIT_SOURCE_SPEC,
  AUDIT_V025_CASES,
  OBSERVE_EXPECTATIONS,
  OBSERVE_EXPECTED_VERDICTS,
  OBSERVE_VERDICTS,
  hasNoAdvanceStep,
  hasRefusalStep,
  judgeFailClosed,
  judgeNoBusinessReexecution,
  judgeSteps,
  manifestEntry
} from "../lib/audit-v025.mjs";
import {
  ARV25_IDS,
  RECONCILIATION_DELIVERY_BLOCKED_IDS,
  RECONCILIATION_NO_ADVANCE_IDS,
  RECONCILIATION_REFUSAL_IDS,
  RECONCILIATION_SOURCE_COLUMNS,
  RECONCILIATION_SOURCE_SPEC,
  RECONCILIATION_V025_CASES
} from "../lib/audit-reconciliation-v025.mjs";
import {
  LOG25_01_FACETS,
  LOG25_SOURCE_COLUMNS,
  MULTI_TURN_LOG_V025_CASES,
  OPTIMIZATION_SOURCE_SPEC,
  UX07_S01_FACETS,
  UX07_S01_ID,
  assertNotDuplicateOfUx07S01,
  rebuildCrossRoundRelation
} from "../lib/multi-turn-log-v025.mjs";

// ── helpers ─────────────────────────────────────────────────────────────────

const coverage = loadCoverage();
const manifestById = new Map(coverage.newScenarios.map((s) => [s.executionId, s]));

const ALL_CASES = [
  ...AUDIT_V025_CASES,
  ...RECONCILIATION_V025_CASES,
  ...MULTI_TURN_LOG_V025_CASES
];
const CASE_BY_ID = new Map(ALL_CASES.map((d) => [d.executionId, d]));

function readSpec(relPath) {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** Rows of a Markdown table section: [firstCell, ...cells]. */
function tableRows(text, fromHeading, toHeading) {
  const section = text.split(fromHeading)[1]?.split(toHeading)[0] ?? "";
  return section
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

/** Audit Spec §13.2 -> Map<Axx, { title, judgement, columns }>. */
function auditSpecRows() {
  const rows = tableRows(readSpec(AUDIT_SOURCE_SPEC), "### 13.2", "### 13.3");
  const out = new Map();
  for (const cells of rows) {
    const m = (cells[0] ?? "").match(/^(A\d{2})\s*(.*)$/);
    if (!m) continue;
    out.set(m[1], {
      title: m[2].trim(),
      columns: {
        "输入 / 前置条件": cells[1] ?? "",
        "故障点": cells[2] ?? "",
        "预期事件集合与状态/关系": cells[3] ?? "",
        "证据位置": cells[4] ?? "",
        "判定规则": cells[5] ?? ""
      },
      judgement: cells[5] ?? ""
    });
  }
  return out;
}

/** Reconciliation Spec §7 -> Map<Vxx, { scenario, judgement }>. */
function reconciliationSpecRows() {
  const rows = tableRows(readSpec(RECONCILIATION_SOURCE_SPEC), "## 7. 验收矩阵", "## 8.");
  const out = new Map();
  for (const cells of rows) {
    const id = cells[0] ?? "";
    if (!/^V\d{2}$/.test(id)) continue;
    out.set(id, { scenario: cells[1] ?? "", judgement: cells[2] ?? "" });
  }
  return out;
}

/** Optimization Spec §7.4 -> Map<LOG25-xx, { scenario, owner, judgement }>. */
function incrementSpecRows() {
  const rows = tableRows(readSpec(OPTIMIZATION_SOURCE_SPEC), "### 7.4", "### 7.5");
  const out = new Map();
  for (const cells of rows) {
    const id = (cells[0] ?? "").replaceAll("`", "").trim();
    if (!/^(CON|LOG)25-\d{2}$/.test(id)) continue;
    out.set(id, { scenario: cells[1] ?? "", owner: cells[2] ?? "", judgement: cells[3] ?? "" });
  }
  return out;
}

/** The observations a correct runtime would report for the closed steps. */
function closedObservations(descriptor) {
  const observations = {};
  for (const step of descriptor.assertionSteps) {
    if (step.expectation === "refuse") observations[step.stepId] = "refused";
    else if (step.expectation === "not_advance") observations[step.stepId] = "preserved";
  }
  return observations;
}

const auditRows = auditSpecRows();
const reconciliationRows = reconciliationSpecRows();
const incrementRows = incrementSpecRows();
const catalogCases = loadCatalog().cases;
const ux07S01 = catalogCases.find((c) => c.id === UX07_S01_ID);

// ── 1. identity and completeness ───────────────────────────────────────────

describe("W2-OBSERVE: execution id completeness and approved form", () => {
  it("carries exactly the 25 OBSERVE execution ids, each once", () => {
    assert.equal(ALL_CASES.length, 25);
    assert.equal(new Set(ALL_CASES.map((d) => d.executionId)).size, 25);
    const ids = ALL_CASES.map((d) => d.executionId).sort();
    const expected = [
      ...AUD25_IDS.map((id) => `AUD25-${id}`),
      ...ARV25_IDS.map((id) => `ARV25-${id}`),
      ...LOG25_IDS
    ].sort();
    assert.deepEqual(ids, expected);
  });

  it("uses the approved execution-id form of each requirement group", () => {
    const auditGroup = SOURCE_GROUPS.find((g) => g.key === "AUD25");
    const arvGroup = SOURCE_GROUPS.find((g) => g.key === "ARV25");
    for (const id of AUD25_IDS) {
      assert.equal(executionIdFor(auditGroup, id), `AUD25-${id}`);
    }
    for (const id of ARV25_IDS) {
      assert.equal(executionIdFor(arvGroup, id), `ARV25-${id}`);
    }
    assert.ok(LOG25_IDS.includes("LOG25-01"));
  });

  it("every id also exists in the approved coverage manifest", () => {
    for (const d of ALL_CASES) {
      const entry = manifestById.get(d.executionId);
      assert.ok(entry, `${d.executionId} is missing from scripts/e2e/contracts/v025-coverage.yaml`);
      assert.equal(entry.ownerBranch, d.ownerBranch);
    }
  });
});

// ── 2. ownership ────────────────────────────────────────────────────────────

describe("W2-OBSERVE: owner branch", () => {
  it("AUD25 and ARV25 are owned by OBSERVE as approved", () => {
    const auditGroup = SOURCE_GROUPS.find((g) => g.key === "AUD25");
    const arvGroup = SOURCE_GROUPS.find((g) => g.key === "ARV25");
    assert.equal(auditGroup.ownerBranch, "OBSERVE");
    assert.equal(arvGroup.ownerBranch, "OBSERVE");
    for (const d of [...AUDIT_V025_CASES, ...RECONCILIATION_V025_CASES]) {
      assert.equal(d.ownerBranch, "OBSERVE", `${d.executionId} owner`);
    }
  });

  it("LOG25-01 is owned by the branch the approved increment table names", () => {
    const row = incrementRows.get("LOG25-01");
    assert.ok(row, "Spec §7.4 has no LOG25-01 row");
    assert.equal(row.owner, "OBSERVE");
    assert.equal(CASE_BY_ID.get("LOG25-01").ownerBranch, "OBSERVE");
  });
});

// ── 3. vocabulary legality ──────────────────────────────────────────────────

describe("W2-OBSERVE: executor / capability / assertion vocabulary", () => {
  it("uses only legal executors, capabilities and assertion tokens", () => {
    for (const d of ALL_CASES) {
      assert.ok(d.requiredExecutors.length > 0, `${d.executionId} has no executor`);
      for (const e of d.requiredExecutors) {
        assert.ok(EXECUTOR_LETTERS.includes(e), `${d.executionId} unknown executor ${e}`);
      }
      for (const c of d.requiredCapabilities) {
        assert.ok(CAPABILITIES.includes(c), `${d.executionId} unknown capability ${c}`);
      }
      assert.ok(d.assertionTokens.length > 0, `${d.executionId} has no assertion token`);
      for (const a of d.assertionTokens) {
        assert.ok(ASSERTION_TOKENS.includes(a), `${d.executionId} unknown assertion token ${a}`);
      }
      assert.ok(d.expectedArtifacts.length > 0, `${d.executionId} has no artifact`);
    }
  });

  it("mirrors the manifest entry exactly", () => {
    for (const d of ALL_CASES) {
      const entry = manifestEntry(d.executionId);
      assert.deepEqual([...d.requiredExecutors], [...entry.executors], `${d.executionId} executors`);
      assert.deepEqual([...d.requiredCapabilities], [...entry.requires], `${d.executionId} capabilities`);
      assert.deepEqual([...d.assertionTokens], [...entry.assert], `${d.executionId} assertion tokens`);
      assert.deepEqual([...d.expectedArtifacts], [...entry.artifacts], `${d.executionId} artifacts`);
    }
  });

  it("every assertion step's dimension is one of that id's declared assertion tokens", () => {
    for (const d of ALL_CASES) {
      for (const step of d.assertionSteps) {
        assert.ok(
          d.assertionTokens.includes(step.dimension),
          `${d.executionId}/${step.stepId} dimension ${step.dimension} is not declared`
        );
      }
    }
  });
});

// ── 4. id-specific, source-Spec-derived steps ───────────────────────────────

describe("W2-OBSERVE: id-specific assertion steps", () => {
  it("every id has at least two non-empty steps", () => {
    for (const d of ALL_CASES) {
      assert.ok(d.assertionSteps.length >= 2, `${d.executionId} has ${d.assertionSteps.length} steps`);
      for (const step of d.assertionSteps) {
        assert.ok(step.statement.trim().length > 10, `${d.executionId}/${step.stepId} has no statement`);
        assert.ok(step.evidence.trim().length > 0, `${d.executionId}/${step.stepId} has no evidence`);
        assert.ok(OBSERVE_EXPECTATIONS.includes(step.expectation), `${d.executionId}/${step.stepId} expectation`);
      }
    }
  });

  it("no two steps share a statement (a copy-paste regression fails)", () => {
    const statements = ALL_CASES.flatMap((d) => d.assertionSteps.map((s) => s.statement));
    const seen = new Set();
    for (const s of statements) {
      assert.ok(!seen.has(s), `duplicated assertion step text: "${s}"`);
      seen.add(s);
    }
    assert.equal(seen.size, statements.length);
    assert.ok(statements.length >= 100, `only ${statements.length} assertion steps for 25 ids`);
  });

  it("no two ids share a step-id, and no two ids share a source anchor", () => {
    const stepIds = ALL_CASES.flatMap((d) => d.assertionSteps.map((s) => s.stepId));
    assert.equal(new Set(stepIds).size, stepIds.length);
    const anchors = ALL_CASES.map((d) => `${d.source.scenario}||${d.source.judgement}`);
    assert.equal(new Set(anchors).size, anchors.length);
  });

  it("anchors every AUD25 id to its own source Spec row", () => {
    for (const d of AUDIT_V025_CASES) {
      const row = auditRows.get(d.sourceRequirementId);
      assert.ok(row, `Audit Spec §13.2 has no ${d.sourceRequirementId} row`);
      assert.equal(d.source.scenario, row.title, `${d.executionId} scenario anchor`);
      assert.equal(d.source.judgement, row.judgement, `${d.executionId} judgement anchor`);
      for (const step of d.assertionSteps) {
        assert.ok(
          AUDIT_SOURCE_COLUMNS.includes(step.derivedFrom),
          `${d.executionId}/${step.stepId} derives from an unknown column ${step.derivedFrom}`
        );
        assert.ok(
          String(row.columns[step.derivedFrom] ?? "").length > 0,
          `${d.executionId}/${step.stepId} derives from an empty source column`
        );
      }
    }
  });

  it("anchors every ARV25 id to its own source Spec row", () => {
    for (const d of RECONCILIATION_V025_CASES) {
      const row = reconciliationRows.get(d.sourceRequirementId);
      assert.ok(row, `Reconciliation Spec §7 has no ${d.sourceRequirementId} row`);
      assert.equal(d.source.scenario, row.scenario, `${d.executionId} scenario anchor`);
      assert.equal(d.source.judgement, row.judgement, `${d.executionId} judgement anchor`);
      for (const step of d.assertionSteps) {
        assert.ok(
          RECONCILIATION_SOURCE_COLUMNS.includes(step.derivedFrom),
          `${d.executionId}/${step.stepId} derives from an unknown column ${step.derivedFrom}`
        );
      }
    }
  });

  it("anchors LOG25-01 to the approved increment row", () => {
    const d = CASE_BY_ID.get("LOG25-01");
    const row = incrementRows.get("LOG25-01");
    assert.ok(row, "Spec §7.4 has no LOG25-01 row");
    assert.equal(d.source.scenario, row.scenario);
    assert.equal(d.source.judgement, row.judgement);
    for (const step of d.assertionSteps) {
      assert.ok(LOG25_SOURCE_COLUMNS.includes(step.derivedFrom), `${step.stepId} derivedFrom`);
    }
  });

  it("names the eight primary-status buckets of the frozen derivation table", () => {
    const spec = readSpec(AUDIT_SOURCE_SPEC);
    const table = spec.split("### 4.3")[1]?.split("### 4.4")[0] ?? "";
    const named = new Set(
      [...table.matchAll(/^\|\s*\d+\s*[^|]*\|\s*([a-z_]+(?:\s*\+\s*conflict\s*标签)?)\s*\|/gm)]
        .map((m) => m[1].replace(/\s*\+\s*conflict\s*标签/, ""))
    );
    assert.ok(named.size >= 8, `Spec §4.3(a) yielded only ${named.size} bucket names`);
    for (const bucket of AUDIT_PRIMARY_STATUS_BUCKETS) {
      assert.ok(named.has(bucket), `descriptor bucket ${bucket} is not in Spec §4.3(a)`);
    }
    assert.equal(AUDIT_PRIMARY_STATUS_BUCKETS.length, 8);
  });
});

// ── 5. fail-closed semantics ────────────────────────────────────────────────

describe("W2-OBSERVE: fail-closed semantics", () => {
  it("the barrier and fail-closed ids encode a refusal / no-advance expectation", () => {
    for (const id of AUDIT_REFUSAL_IDS) {
      const d = CASE_BY_ID.get(`AUD25-${id}`);
      assert.ok(hasRefusalStep(d), `AUD25-${id} must encode a hard refusal`);
    }
    for (const id of RECONCILIATION_REFUSAL_IDS) {
      const d = CASE_BY_ID.get(`ARV25-${id}`);
      assert.ok(hasRefusalStep(d), `ARV25-${id} must encode a hard refusal`);
    }
    for (const id of AUDIT_NO_ADVANCE_IDS) {
      const d = CASE_BY_ID.get(`AUD25-${id}`);
      assert.ok(hasNoAdvanceStep(d), `AUD25-${id} must encode a no-advance expectation`);
    }
    for (const id of RECONCILIATION_NO_ADVANCE_IDS) {
      const d = CASE_BY_ID.get(`ARV25-${id}`);
      assert.ok(hasNoAdvanceStep(d), `ARV25-${id} must encode a no-advance expectation`);
    }
  });

  it("NEGATIVE: a permissive result on a fail-closed step is rejected", () => {
    const d = CASE_BY_ID.get("AUD25-A02");
    const refusalStep = d.assertionSteps.find((s) => s.expectation === "refuse");
    assert.ok(refusalStep, "AUD25-A02 has no refusal step");

    // the correct world: every closed step held
    const correct = closedObservations(d);
    assert.equal(judgeFailClosed(d, correct).ok, true);

    // the permissive world: the barrier failed but the request advanced anyway
    const permissive = { ...correct, [refusalStep.stepId]: "advanced" };
    const verdict = judgeFailClosed(d, permissive);
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /expected refuse/);
  });

  it("NEGATIVE: a permissive result on a no-advance step is rejected", () => {
    const d = CASE_BY_ID.get("AUD25-A01");
    const step = d.assertionSteps.find((s) => s.expectation === "not_advance");
    assert.ok(step, "AUD25-A01 has no no-advance step");
    const correct = closedObservations(d);
    assert.equal(judgeFailClosed(d, correct).ok, true);
    const permissive = { ...correct, [step.stepId]: "advanced" };
    const verdict = judgeFailClosed(d, permissive);
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /expected not_advance/);
  });

  it("the judge rejects a missing observation and an unknown verdict", () => {
    const d = CASE_BY_ID.get("AUD25-A05");
    assert.equal(judgeSteps(d, {}).ok, false);
    assert.equal(judgeSteps(d, { [d.assertionSteps[0].stepId]: "maybe" }).ok, false);
    for (const expectation of OBSERVE_EXPECTATIONS) {
      const acceptable = OBSERVE_EXPECTED_VERDICTS[expectation];
      assert.ok(Array.isArray(acceptable) && acceptable.length > 0, expectation);
      for (const verdict of acceptable) {
        assert.ok(OBSERVE_VERDICTS.includes(verdict), `${expectation}/${verdict}`);
      }
    }
  });
});

// ── 6. no silent business re-execution ─────────────────────────────────────

describe("W2-OBSERVE: a crash never re-executes business", () => {
  it("the barrier / recovery ids forbid silent business re-execution", () => {
    for (const id of ["A01", "A02", "A03", "A04"]) {
      const d = CASE_BY_ID.get(`AUD25-${id}`);
      assert.equal(d.noBusinessReexecution, true, `AUD25-${id} must forbid business re-execution`);
      assert.ok(
        d.assertionSteps.some((s) => s.expectation === "not_advance"),
        `AUD25-${id} must encode a no-advance expectation`
      );
    }
  });

  it("NEGATIVE: an upstream re-execution after the fault is rejected", () => {
    const d = CASE_BY_ID.get("AUD25-A01");
    assert.equal(judgeNoBusinessReexecution(d, { upstreamCallsBefore: 1, upstreamCallsAfter: 1 }).ok, true);
    const verdict = judgeNoBusinessReexecution(d, { upstreamCallsBefore: 1, upstreamCallsAfter: 2 });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /business was re-executed/);
  });

  it("the no-re-execution judge refuses to guess when the counters are missing", () => {
    const d = CASE_BY_ID.get("AUD25-A04");
    assert.equal(judgeNoBusinessReexecution(d, {}).ok, false);
  });
});

// ── 7. LOG25-01 cross-round correlation ─────────────────────────────────────

describe("W2-OBSERVE: LOG25-01 cross-round correlation", () => {
  const rounds = [
    {
      roundIndex: 1,
      turnId: "turn-1",
      token: "e2e_finance",
      semanticVersion: "sem-2026-10-25",
      policyVersion: "pol-7",
      startedAt: 1_000,
      endedAt: 1_800,
      budget: { dataToolCalls: 3, attempts: 5, wallClockMs: 800, concurrency: 2 },
      calls: [
        { callId: "c-1", attemptId: "a-1", parentAttemptId: null, retryOfEventId: null, toolCall: true, startedAt: 1_000, endedAt: 1_400 }
      ]
    },
    {
      roundIndex: 2,
      turnId: "turn-2",
      token: "e2e_finance",
      semanticVersion: "sem-2026-10-25",
      policyVersion: "pol-8",
      startedAt: 2_000,
      endedAt: 2_400,
      budget: { dataToolCalls: 5, attempts: 7, wallClockMs: 400, concurrency: 1 },
      calls: [
        { callId: "c-2", attemptId: "a-2", parentAttemptId: "a-1", retryOfEventId: "ev-1", toolCall: true, startedAt: 2_000, endedAt: 2_300 }
      ]
    },
    {
      // a round with no end timestamp and an incomplete budget
      roundIndex: 3,
      turnId: "turn-3",
      token: "e2e_sales",
      semanticVersion: "sem-2026-10-25",
      policyVersion: "pol-8",
      startedAt: 3_000,
      endedAt: null,
      budget: { dataToolCalls: 6, attempts: null, wallClockMs: null, concurrency: null },
      calls: [
        { callId: "c-3", attemptId: "a-3", parentAttemptId: "a-2", retryOfEventId: null, toolCall: false, startedAt: 3_000, endedAt: null }
      ]
    }
  ];

  it("rebuilds the per-round token, semantic version, policy version, elapsed time and budget", () => {
    const rebuilt = rebuildCrossRoundRelation(rounds);
    assert.equal(rebuilt.rounds.length, 3);
    assert.equal(rebuilt.rounds[0].token, "e2e_finance");
    assert.equal(rebuilt.rounds[2].token, "e2e_sales");
    assert.equal(rebuilt.rounds[0].semanticVersion, "sem-2026-10-25");
    assert.equal(rebuilt.rounds[1].policyVersion, "pol-8");
    assert.equal(rebuilt.rounds[0].elapsedMs, 800);
    assert.equal(rebuilt.rounds[1].elapsedMs, 400);
    assert.equal(rebuilt.rounds[0].budget.dataToolCalls, 3);
    assert.equal(rebuilt.rounds[0].budget.wallClockMs, 800);
  });

  it("never fills an unknown elapsed time or budget dimension with 0", () => {
    const rebuilt = rebuildCrossRoundRelation(rounds);
    const third = rebuilt.rounds[2];
    assert.equal(third.elapsedMs, null);
    assert.equal(third.elapsedReason, "missing_end");
    assert.equal(third.budget.attempts, null);
    assert.equal(third.budget.wallClockMs, null);
    assert.equal(third.budget.dataToolCalls, 6);
    assert.ok(rebuilt.unknownFields.some((u) => u.roundIndex === 3 && u.field === "elapsedMs"));
    assert.ok(rebuilt.unknownFields.some((u) => u.field === "budget.attempts"));
  });

  it("rebuilds the cross-round call relation", () => {
    const rebuilt = rebuildCrossRoundRelation(rounds);
    const parentEdges = rebuilt.edges.filter((e) => e.kind === "parent_attempt");
    assert.equal(parentEdges.length, 2);
    const crossRound = parentEdges.find((e) => e.child.attemptId === "a-2");
    assert.ok(crossRound, "no cross-round parent edge for a-2");
    assert.equal(crossRound.parent.attemptId, "a-1");
    assert.equal(crossRound.parent.roundIndex, 1);
    assert.equal(crossRound.child.roundIndex, 2);
    assert.ok(rebuilt.edges.some((e) => e.kind === "retry_of" && e.parent.eventId === "ev-1"));
    assert.ok(rebuilt.crossRoundEdges.length >= 2);
    assert.equal(rebuilt.totals.rounds, 3);
    assert.equal(rebuilt.totals.calls, 3);
    assert.equal(rebuilt.totals.attempts, 3);
    assert.equal(rebuilt.totals.toolCalls, 2);
  });

  it("reports an unresolvable parent attempt instead of inventing one", () => {
    const rebuilt = rebuildCrossRoundRelation([
      { roundIndex: 1, turnId: "t", token: "x", semanticVersion: "s", policyVersion: "p", startedAt: 1, endedAt: 2, budget: {}, calls: [
        { callId: "c", attemptId: "a", parentAttemptId: "ghost", retryOfEventId: null, toolCall: true }
      ] }
    ]);
    assert.ok(rebuilt.problems.some((p) => p.includes("unresolved parentAttemptId ghost")));
    assert.ok(rebuilt.crossRoundEdges.some((e) => e.resolved === false));
  });

  it("is provably NOT a duplicate of the frozen UX-07-S01", () => {
    const d = CASE_BY_ID.get("LOG25-01");
    const verdict = assertNotDuplicateOfUx07S01(d);
    assert.deepEqual(verdict.failures, [], verdict.failures.join("\n"));
    assert.ok(d.references.includes(UX07_S01_ID));
    for (const facet of d.facets) {
      assert.ok(LOG25_01_FACETS.includes(facet), facet);
      assert.ok(!UX07_S01_FACETS.includes(facet), `LOG25-01 copies the UX-07-S01 facet ${facet}`);
    }
  });

  it("the UX-07-S01 facet list matches the four facets the frozen catalog title names", () => {
    assert.ok(ux07S01, "UX-07-S01 is not in the frozen catalog");
    const title = String(ux07S01.title ?? "");
    for (const marker of ["监控窗口", "慢标记", "eval 排除", "真实事件对账"]) {
      assert.ok(title.includes(marker), `UX-07-S01 title no longer names "${marker}"`);
    }
    assert.equal(UX07_S01_FACETS.length, 4);
  });

  it("the two cover different assertion sets (different facets AND different layers)", () => {
    const log = CASE_BY_ID.get("LOG25-01");
    const logFacets = new Set(log.facets);
    for (const facet of UX07_S01_FACETS) {
      assert.ok(!logFacets.has(facet), `LOG25-01 must not cover ${facet}`);
    }
    assert.ok(
      log.requiredCapabilities.includes("agent-client"),
      "LOG25-01 must require the real agent client"
    );
    assert.ok(
      ux07S01.requires.includes("browser"),
      "UX-07-S01 is the browser-side monitoring scenario"
    );
    assert.ok(
      !log.requiredCapabilities.includes("browser"),
      "LOG25-01 must not re-run the UX-07-S01 browser surface"
    );
    assert.notDeepEqual([...log.assertionTokens].sort(), [...ux07S01.assert].sort());
  });
});

// ── 8. status semantics ─────────────────────────────────────────────────────

describe("W2-OBSERVE: status semantics (never a fabricated pass)", () => {
  it("an item whose only executed layer is unit is not_run, not passed", () => {
    const d = CASE_BY_ID.get("AUD25-A01");
    const status = statusFromDimensions(
      { unit: { status: "passed" } },
      { required: d.requiredExecutors }
    );
    assert.equal(status, "not_run");
  });

  it("no OBSERVE id can be passed by this environment alone", () => {
    for (const d of ALL_CASES) {
      const contractOnly = { unit: { status: "passed" } };
      assert.equal(
        statusFromDimensions(contractOnly, { required: d.requiredExecutors }),
        "not_run",
        `${d.executionId} must not be a pass from the unit layer alone`
      );
      const hasRuntimeGap = d.dimensions.some((dim) => dim.computableHere === false);
      assert.ok(hasRuntimeGap, `${d.executionId} declares no dimension that needs a real environment`);
    }
  });

  it("every id declares at least one dimension that is computable here", () => {
    for (const d of ALL_CASES) {
      assert.ok(
        d.dimensions.some((dim) => dim.computableHere === true),
        `${d.executionId} has no locally computable dimension`
      );
    }
  });

  it("the blocked reason of every id is a legal v0.25 blocked reason", () => {
    for (const d of ALL_CASES) {
      assert.ok(BLOCKED_REASONS.includes(d.blockedReason), `${d.executionId} blockedReason ${d.blockedReason}`);
    }
  });

  it("AUD25-A12 and ARV25-V12 stay blocked until customer amd64 / historical-sample evidence exists", () => {
    assert.deepEqual([...AUDIT_DELIVERY_BLOCKED_IDS], ["A12"]);
    assert.deepEqual([...RECONCILIATION_DELIVERY_BLOCKED_IDS], ["V12"]);

    const a12 = CASE_BY_ID.get("AUD25-A12");
    assert.equal(a12.blockedReason, "delivery");
    assert.ok(a12.dimensions.some((d) => d.layer === "history" && d.blockedReason === "delivery"));

    const v12 = CASE_BY_ID.get("ARV25-V12");
    assert.equal(v12.blockedReason, "delivery");
    assert.ok(v12.requiredCapabilities.includes("k8s-amd64"), "ARV25-V12 must require k8s-amd64");
    assert.ok(v12.dimensions.some((d) => d.layer === "delivery" && d.blockedReason === "delivery"));

    // a blocked record is well formed; these ids cannot become a passed record here
    for (const id of ["AUD25-A12", "ARV25-V12"]) {
      const record = createResult({
        executionId: id,
        runId: "t-run",
        instanceId: "t-instance",
        candidateDigest: "t-digest",
        status: "blocked",
        blockedReason: "delivery",
        executorResults: {},
        evidenceRefs: []
      });
      assert.deepEqual(validateResult(record), []);
      assert.equal(record.status, "blocked");
    }
  });
});
