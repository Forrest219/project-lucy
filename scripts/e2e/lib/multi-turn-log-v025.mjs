// LOG25-01 executable case descriptor + the cross-round relation rebuild
// (Plan W2-OBSERVE / Track C, Spec §7.4).
//
// Authority: docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md §7.4
//   ("新增数据库与多轮日志场景").  LOG25-01 is the increment the frozen
//   UX-07-S01 does NOT cover: the same multi-turn session, correlated ROUND
//   BY ROUND, for the access-credential identity, the semantic version, the
//   policy version, the elapsed time and the budget, plus the rebuild of the
//   cross-round call relation.
//
// NON-DUPLICATION (Spec §7.4 通过边界): UX-07-S01 owns the monitoring
//   window, the slow marker, the Eval exclusion and the real-event
//   reconciliation.  LOG25-01 must REFERENCE those and must NOT repeat them.
//   `assertNotDuplicateOfUx07S01()` is the mechanical proof; the contract
//   test asserts it.
//
// The shared OBSERVE vocabulary (verdicts, expectations, the two judges)
// comes from scripts/e2e/lib/audit-v025.mjs.

import { manifestEntry } from "./audit-v025.mjs";

export const OPTIMIZATION_SOURCE_SPEC = "docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md";
export const OPTIMIZATION_SOURCE_TABLE = "§7.4";

/** The frozen scenario LOG25-01 references (it must not duplicate it). */
export const UX07_S01_ID = "UX-07-S01";

/** The source Spec §7.4 columns a step may be derived from. */
export const LOG25_SOURCE_COLUMNS = Object.freeze(["场景", "通过边界"]);

/**
 * The four facets owned by the frozen UX-07-S01 (frozen catalog title:
 * "调用监控窗口、慢标记、eval 排除与真实事件对账").  LOG25-01 must not
 * carry any of them.
 */
export const UX07_S01_FACETS = Object.freeze([
  "monitor_window",
  "slow_marker",
  "eval_exclusion",
  "real_event_reconciliation"
]);

/** The facets LOG25-01 adds on top of UX-07-S01. */
export const LOG25_01_FACETS = Object.freeze([
  "per_round_token",
  "per_round_semantic_version",
  "per_round_policy_version",
  "per_round_elapsed_time",
  "per_round_budget",
  "cross_round_call_relation"
]);

const entry = manifestEntry("LOG25-01");

const LOG25_01_STEPS = Object.freeze([
  Object.freeze({
    stepId: "LOG25-01-1",
    dimension: "audit_event",
    derivedFrom: "通过边界",
    facet: "per_round_token",
    expectation: "observe",
    evidence: "多轮会话事件流",
    statement: "同一多轮会话逐轮关联访问凭证身份（Token）：每轮的 Token 身份可列，并与调用流水一致。"
  }),
  Object.freeze({
    stepId: "LOG25-01-2",
    dimension: "audit_event",
    derivedFrom: "通过边界",
    facet: "per_round_semantic_version",
    expectation: "observe",
    evidence: "多轮会话事件流",
    statement: "逐轮关联语义版本：每轮的语义版本可重建，跨轮版本变化不被抹平。"
  }),
  Object.freeze({
    stepId: "LOG25-01-3",
    dimension: "audit_event",
    derivedFrom: "通过边界",
    facet: "per_round_policy_version",
    expectation: "observe",
    evidence: "多轮会话事件流",
    statement: "逐轮关联策略版本：每轮的策略版本可重建，与该轮实际裁决所用版本一致。"
  }),
  Object.freeze({
    stepId: "LOG25-01-4",
    dimension: "consistency",
    derivedFrom: "通过边界",
    facet: "per_round_elapsed_time",
    expectation: "observe",
    evidence: "多轮会话事件流",
    statement: "逐轮耗时可重建；已知起止才算耗时，缺起止为 null 并带原因，不填 0。"
  }),
  Object.freeze({
    stepId: "LOG25-01-5",
    dimension: "consistency",
    derivedFrom: "通过边界",
    facet: "per_round_budget",
    expectation: "observe",
    evidence: "多轮会话事件流 / 预算事件",
    statement: "逐轮预算四维（业务调用数/尝试次数/墙钟/并发占用）可重建；缺失维度为 null，不重置也不补 0。"
  }),
  Object.freeze({
    stepId: "LOG25-01-6",
    dimension: "consistency",
    derivedFrom: "通过边界",
    facet: "cross_round_call_relation",
    expectation: "observe",
    evidence: "多轮会话事件流",
    statement: "重建跨轮调用关系：轮次 → 调用 → 尝试的边可解，父子引用可回到来源轮次，调用数不重复计。"
  }),
  Object.freeze({
    stepId: "LOG25-01-7",
    dimension: "consistency",
    derivedFrom: "通过边界",
    facet: "cross_round_call_relation",
    expectation: "not_advance",
    evidence: "多轮会话事件流",
    statement: "与 UX-07-S01 互相引用而不重复：监控窗口、慢标记、Eval 排除与真实事件对账仍由 UX-07-S01 承担，本项不复制这四类断言。"
  }),
  Object.freeze({
    stepId: "LOG25-01-8",
    dimension: "no_leak",
    derivedFrom: "通过边界",
    facet: "per_round_token",
    expectation: "observe",
    evidence: "多轮会话事件流",
    statement: "逐轮重建只使用访问凭证身份，不携带凭据明文；跨轮汇总不得泄漏 Token 值。"
  })
]);

/** The LOG25-01 descriptor. */
export const MULTI_TURN_LOG_V025_CASES = Object.freeze([
  Object.freeze({
    executionId: "LOG25-01",
    sourceRequirementId: entry.sourceRequirementId ?? null,
    sourceSpec: OPTIMIZATION_SOURCE_SPEC,
    sourceTable: OPTIMIZATION_SOURCE_TABLE,
    ownerBranch: entry.ownerBranch,
    priority: entry.priority,
    requiredExecutors: Object.freeze([...entry.executors]),
    requiredCapabilities: Object.freeze([...entry.requires]),
    assertionTokens: Object.freeze([...entry.assert]),
    expectedArtifacts: Object.freeze([...entry.artifacts]),
    source: Object.freeze({
      scenario: "UX-07-S01 未覆盖的多轮日志增量",
      judgement: "同一多轮会话逐轮关联 Token、语义／策略版本、耗时与预算，重建跨轮调用关系；与 UX-07-S01 的监控窗口、慢标记、Eval 排除和真实事件对账互相引用而不重复",
      columns: Object.freeze([...LOG25_SOURCE_COLUMNS])
    }),
    facets: LOG25_01_FACETS,
    assertionSteps: LOG25_01_STEPS,
    dimensions: Object.freeze([
      Object.freeze({
        name: "descriptor_manifest_spec_agreement",
        layer: "contract",
        computableHere: true,
        blockedReason: null,
        note: "描述符 ↔ 覆盖清单 ↔ 源 Spec 的一致性；本机可判定"
      }),
      Object.freeze({
        name: "cross_round_relation_rebuild",
        layer: "runtime",
        computableHere: false,
        blockedReason: "environment",
        note: "需要一次真实多轮会话的事件流；本机只能判定重建算法本身"
      })
    ]),
    blockedReason: "environment",
    noBusinessReexecution: false,
    failClosed: false,
    noAdvance: true,
    references: Object.freeze([UX07_S01_ID])
  })
]);

// ── the cross-round relation rebuild (pure, locally provable) ───────────────

const BUDGET_DIMENSIONS = Object.freeze(["dataToolCalls", "attempts", "wallClockMs", "concurrency"]);

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Rebuilds the per-round facts and the cross-round call relation of ONE
 * multi-turn session.
 *
 * Pure and local: it consumes the round observations a run collected and
 * returns the rebuilt view plus the gaps it could not close.  It never
 * invents a fact — a missing input becomes `null` plus a reason, never 0.
 *
 * @param {Array<object>} rounds
 * @returns {{rounds: Array<object>, edges: Array<object>, crossRoundEdges: Array<object>,
 *            totals: object, unknownFields: Array<object>, problems: Array<string>}}
 */
export function rebuildCrossRoundRelation(rounds = []) {
  const problems = [];
  const unknownFields = [];
  const attemptOwners = new Map();

  const normalized = rounds.map((round, index) => {
    const roundIndex = isNumber(round?.roundIndex) ? round.roundIndex : index;

    // per-round identity / versions
    for (const [field, value] of [
      ["token", round?.token],
      ["semanticVersion", round?.semanticVersion],
      ["policyVersion", round?.policyVersion]
    ]) {
      if (value === undefined || value === null || value === "") {
        unknownFields.push({ roundIndex, field, reason: "not_collected" });
      }
    }

    // per-round elapsed time: only a known start AND end yield a number
    let elapsedMs = null;
    let elapsedReason = null;
    if (!isNumber(round?.startedAt)) elapsedReason = "missing_start";
    else if (!isNumber(round?.endedAt)) elapsedReason = "missing_end";
    else if (round.endedAt < round.startedAt) elapsedReason = "end_before_start";
    else elapsedMs = round.endedAt - round.startedAt;
    if (elapsedReason) unknownFields.push({ roundIndex, field: "elapsedMs", reason: elapsedReason });

    // per-round budget: four dimensions, never defaulted to 0
    const budget = {};
    const budgetKnown = {};
    for (const dim of BUDGET_DIMENSIONS) {
      const value = round?.budget?.[dim];
      if (isNumber(value)) {
        budget[dim] = value;
        budgetKnown[dim] = true;
      } else {
        budget[dim] = null;
        budgetKnown[dim] = false;
        unknownFields.push({ roundIndex, field: `budget.${dim}`, reason: "not_collected" });
      }
    }

    // calls / attempts of this round
    const calls = (round?.calls ?? []).map((call) => {
      const attemptId = call?.attemptId ?? null;
      if (attemptId !== null) {
        if (attemptOwners.has(attemptId)) {
          problems.push(`duplicate attemptId ${attemptId} in round ${roundIndex}`);
        } else {
          attemptOwners.set(attemptId, roundIndex);
        }
      }
      return Object.freeze({
        callId: call?.callId ?? null,
        attemptId,
        parentAttemptId: call?.parentAttemptId ?? null,
        retryOfEventId: call?.retryOfEventId ?? null,
        toolCall: call?.toolCall === true,
        elapsedMs: isNumber(call?.startedAt) && isNumber(call?.endedAt) && call.endedAt >= call.startedAt
          ? call.endedAt - call.startedAt
          : null
      });
    });

    return Object.freeze({
      roundIndex,
      turnId: round?.turnId ?? null,
      token: round?.token ?? null,
      semanticVersion: round?.semanticVersion ?? null,
      policyVersion: round?.policyVersion ?? null,
      elapsedMs,
      elapsedReason,
      budget: Object.freeze(budget),
      budgetKnown: Object.freeze(budgetKnown),
      calls,
      callCount: calls.length,
      attemptCount: calls.filter((c) => c.attemptId !== null).length,
      toolCallCount: calls.filter((c) => c.toolCall).length
    });
  });

  // the cross-round call relation
  const edges = [];
  for (const round of normalized) {
    for (const call of round.calls) {
      if (call.retryOfEventId) {
        edges.push({
          kind: "retry_of",
          child: { roundIndex: round.roundIndex, attemptId: call.attemptId, callId: call.callId },
          parent: { kind: "entry_event", eventId: call.retryOfEventId, roundIndex: null },
          resolved: true
        });
      }
      if (call.parentAttemptId) {
        const parentRoundIndex = attemptOwners.has(call.parentAttemptId)
          ? attemptOwners.get(call.parentAttemptId)
          : null;
        if (parentRoundIndex === null) {
          problems.push(`unresolved parentAttemptId ${call.parentAttemptId} in round ${round.roundIndex}`);
        }
        edges.push({
          kind: "parent_attempt",
          child: { roundIndex: round.roundIndex, attemptId: call.attemptId, callId: call.callId },
          parent: { kind: "attempt", attemptId: call.parentAttemptId, roundIndex: parentRoundIndex },
          resolved: parentRoundIndex !== null
        });
      }
    }
  }

  // a relation that spans rounds (or leaves the round set) is the cross-round part
  const crossRoundEdges = edges.filter((edge) => {
    if (edge.kind === "parent_attempt") {
      return edge.parent.roundIndex === null || edge.parent.roundIndex !== edge.child.roundIndex;
    }
    // a retry_of edge points at an entry event, i.e. it always crosses a round boundary
    return true;
  });

  const totals = {
    rounds: normalized.length,
    calls: normalized.reduce((sum, r) => sum + r.callCount, 0),
    attempts: normalized.reduce((sum, r) => sum + r.attemptCount, 0),
    toolCalls: normalized.reduce((sum, r) => sum + r.toolCallCount, 0),
    crossRoundEdges: crossRoundEdges.length
  };

  return { rounds: normalized, edges, crossRoundEdges, totals, unknownFields, problems };
}

/**
 * Mechanical proof that LOG25-01 is NOT a duplicate of the frozen UX-07-S01:
 * the two cover different assertion sets, and LOG25-01 references UX-07-S01
 * instead of copying it.
 */
export function assertNotDuplicateOfUx07S01(descriptor) {
  const failures = [];
  const facets = new Set(descriptor?.facets ?? []);
  for (const facet of UX07_S01_FACETS) {
    if (facets.has(facet)) failures.push(`LOG25-01 duplicates the UX-07-S01 facet "${facet}"`);
  }
  if (facets.size === 0) failures.push("LOG25-01 declares no facet");
  for (const step of descriptor?.assertionSteps ?? []) {
    if (!facets.has(step.facet)) {
      failures.push(`${step.stepId}: facet "${step.facet}" is not declared by LOG25-01`);
    }
    if (UX07_S01_FACETS.includes(step.facet)) {
      failures.push(`${step.stepId}: facet "${step.facet}" belongs to UX-07-S01`);
    }
  }
  if (!(descriptor?.references ?? []).includes(UX07_S01_ID)) {
    failures.push(`LOG25-01 does not reference ${UX07_S01_ID}`);
  }
  if (!String(descriptor?.source?.judgement ?? "").includes(UX07_S01_ID)) {
    failures.push(`LOG25-01 source judgement does not mention ${UX07_S01_ID}`);
  }
  return { ok: failures.length === 0, failures };
}
