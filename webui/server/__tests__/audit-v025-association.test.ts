/**
 * Lucy v0.25 / L25-09 —— B9（标识语义 / 重连与 attempt 独立性）、
 * B10（归属证据顺序）、B15（repairHint 可用性闭环）、B25（as-of S 视图）。
 *
 * 本文件只验证实现行为，不代表 A07/A08/A12/A10 验收已执行。
 */

import { describe, expect, it } from "vitest";
import {
  assertDistinctClientIdentifiers,
  assertDistinctUpstreamIdentifier,
  isSameLogicalCall,
  resolveAttributionByEvidence,
  type AttributionEvidence
} from "../proxy/turn-correlation.js";
import {
  evaluateAttemptRelation,
  isSameLogicalExecution
} from "../proxy/audit-scope-change.js";
import {
  buildRepairClosure,
  evaluateRepairTarget,
  type RepairTargetEvidence
} from "../proxy/question-experience.js";

describe("B10 归属证据顺序", () => {
  it("显式绑定优先于迟到修订、会话绑定与系统推断", () => {
    const evidence: AttributionEvidence[] = [
      { kind: "identity_inferred", turnId: "t_inferred", confidence: "low", associationStatus: "candidate" },
      { kind: "session_bound", turnId: "t_session", confidence: "low", associationStatus: "candidate" },
      { kind: "late_revision", turnId: "t_late", confidence: "high", associationStatus: "confirmed" },
      { kind: "explicit_binding", turnId: "t_explicit", confidence: "high", associationStatus: "confirmed" }
    ];
    const resolved = resolveAttributionByEvidence(evidence);
    expect(resolved.evidenceKind).toBe("explicit_binding");
    expect(resolved.turnId).toBe("t_explicit");
    expect(resolved.mode).toBe("explicit");
    expect(resolved.confidence).toBe("high");
    expect(resolved.conflicted).toBe(false);
  });

  it("迟到修订不代表更可信：最高只能 low 置信 + candidate", () => {
    const resolved = resolveAttributionByEvidence([
      { kind: "late_revision", turnId: "t_late", confidence: "high", associationStatus: "confirmed" }
    ]);
    expect(resolved.evidenceKind).toBe("late_revision");
    expect(resolved.confidence).toBe("low");
    expect(resolved.associationStatus).toBe("candidate");
  });

  it("同级证据互相矛盾时保留冲突，不选边", () => {
    const resolved = resolveAttributionByEvidence([
      { kind: "session_bound", turnId: "t_a", confidence: "low", associationStatus: "candidate" },
      { kind: "session_bound", turnId: "t_b", confidence: "low", associationStatus: "candidate" }
    ]);
    expect(resolved.conflicted).toBe(true);
    expect(resolved.mode).toBe("unassigned");
    expect(resolved.associationStatus).toBe("conflict");
    expect(resolved.turnId).toBeUndefined();
  });

  it("没有任何证据时是未归属，不是成功也不是默认候选", () => {
    const resolved = resolveAttributionByEvidence([]);
    expect(resolved.mode).toBe("unassigned");
    expect(resolved.confidence).toBe("none");
    expect(resolved.associationStatus).toBe("unassigned");
    expect(resolved.evidenceKind).toBe("unassigned");
  });

  it("裁决函数不接受时间参数 —— 无法按时间回绑", () => {
    // resolveAttributionByEvidence 的签名里没有时间参数；时间接近不构成证据。
    const resolved = resolveAttributionByEvidence([
      { kind: "identity_inferred", turnId: "t_old", confidence: "low", associationStatus: "candidate" }
    ]);
    expect(resolved.evidenceKind).toBe("identity_inferred");
    expect(resolved.turnId).toBe("t_old");
  });
});

describe("B9 标识语义", () => {
  it("client_call_id 只在已认证适配器命名空间内标识同一次逻辑调用", () => {
    expect(
      isSameLogicalCall({ adapterId: "a1", clientCallId: "c1" }, { adapterId: "a1", clientCallId: "c1" })
    ).toBe(true);
    expect(
      isSameLogicalCall({ adapterId: "a1", clientCallId: "c1" }, { adapterId: "a2", clientCallId: "c1" })
    ).toBe(false);
  });

  it("client_call_id 不得等于 client_event_id", () => {
    expect(assertDistinctClientIdentifiers({ clientCallId: "c1", clientEventId: "e1" })).toEqual({ ok: true });
    expect(assertDistinctClientIdentifiers({ clientCallId: "c1", clientEventId: "c1" })).toEqual({
      ok: false,
      reason: "client_call_id_equals_client_event_id"
    });
  });

  it("upstream_operation_id 不得用 operation_id 冒充，且必须带上游命名空间", () => {
    expect(
      assertDistinctUpstreamIdentifier({ upstreamOperationId: "op_1", operationId: "op_1" })
    ).toEqual({ ok: false, reason: "upstream_id_equals_operation_id" });
    expect(
      assertDistinctUpstreamIdentifier({
        upstreamOperationId: "up_1",
        operationId: "op_1",
        upstreamNamespace: null
      })
    ).toEqual({ ok: false, reason: "upstream_id_missing_namespace" });
    expect(
      assertDistinctUpstreamIdentifier({
        upstreamOperationId: "up_1",
        operationId: "op_1",
        upstreamNamespace: "conn-1"
      })
    ).toEqual({ ok: true });
    // 上游无凭据 → null + 原因，不拿内部 ID 冒充。
    expect(
      assertDistinctUpstreamIdentifier({ upstreamOperationId: null, operationId: "op_1" })
    ).toEqual({ ok: true });
  });

  it("重连本身不新增 attempt", () => {
    const verdict = evaluateAttemptRelation({
      parentAttemptId: "attempt_1",
      attemptId: "attempt_1",
      resumedSameAttempt: false,
      actuallyExecuted: false
    });
    expect(verdict).toEqual({ ok: true, independent: false, reason: "reconnect_without_execution" });
  });

  it("实际新执行必须有独立 attempt", () => {
    expect(
      evaluateAttemptRelation({
        parentAttemptId: "attempt_1",
        attemptId: "attempt_2",
        resumedSameAttempt: false,
        actuallyExecuted: true
      })
    ).toEqual({ ok: true, independent: true });
    // 两次独立执行共用一个 attempt ID → 拒绝。
    expect(
      evaluateAttemptRelation({
        parentAttemptId: "attempt_1",
        attemptId: "attempt_1",
        resumedSameAttempt: false,
        actuallyExecuted: true
      })
    ).toEqual({ ok: false, reason: "attempt_not_independent" });
  });

  it("既有幂等执行契约证明是原尝试续接时允许复用 attempt", () => {
    expect(
      evaluateAttemptRelation({
        parentAttemptId: "attempt_1",
        attemptId: "attempt_1",
        resumedSameAttempt: true,
        actuallyExecuted: true
      })
    ).toEqual({ ok: true, independent: false, reason: "resumed_same_attempt" });
  });

  it("相同 SQL 不能单独证明两次请求是同一次执行", () => {
    expect(
      isSameLogicalExecution({
        adapterIdA: "a1",
        clientCallIdA: null,
        adapterIdB: "a1",
        clientCallIdB: null,
        sameSql: true
      })
    ).toBe(false);
    expect(
      isSameLogicalExecution({
        adapterIdA: "a1",
        clientCallIdA: "c1",
        adapterIdB: "a1",
        clientCallIdB: "c1"
      })
    ).toBe(true);
  });
});

describe("B15 repairHint 可用性闭环", () => {
  const usable: RepairTargetEvidence = {
    target: "orders",
    schemaExists: true,
    visibleToPrincipal: true,
    compiled: true,
    parameterShapeValid: true,
    callable: true
  };

  it("五项检查全部通过才是可用目标", () => {
    expect(evaluateRepairTarget(usable)).toEqual({ ok: true });
    expect(evaluateRepairTarget({ ...usable, schemaExists: null })).toEqual({
      ok: false,
      reason: "schema_evidence_unavailable"
    });
    expect(evaluateRepairTarget({ ...usable, schemaExists: false })).toEqual({
      ok: false,
      reason: "object_not_found"
    });
    expect(evaluateRepairTarget({ ...usable, visibleToPrincipal: false })).toEqual({
      ok: false,
      reason: "not_visible_to_principal"
    });
    expect(evaluateRepairTarget({ ...usable, compiled: false })).toEqual({
      ok: false,
      reason: "not_compiled"
    });
    expect(evaluateRepairTarget({ ...usable, parameterShapeValid: false })).toEqual({
      ok: false,
      reason: "invalid_parameter_shape"
    });
    expect(evaluateRepairTarget({ ...usable, callable: false })).toEqual({
      ok: false,
      reason: "not_callable"
    });
  });

  it("有合法目标时只推荐通过检查的目标", () => {
    const closure = buildRepairClosure({
      failureDimension: "权限拒绝",
      candidates: [usable, { ...usable, target: "secret_payroll", visibleToPrincipal: false }]
    });
    expect(closure.usableTargets).toEqual(["orders"]);
    expect(closure.factualError).toBeNull();
    expect(closure.text).toContain("orders");
    expect(closure.text).not.toContain("secret_payroll");
  });

  it("无合法目标时给事实性错误与可用候选", () => {
    const closure = buildRepairClosure({
      failureDimension: "权限拒绝",
      candidates: [
        { ...usable, target: "missing_table", schemaExists: false },
        { ...usable, target: "uncompiled", compiled: false }
      ],
      availableCandidates: ["missing_table", "uncompiled"]
    });
    expect(closure.usableTargets).toEqual([]);
    expect(closure.factualError).toContain("当前没有可用的合法目标");
    expect(closure.factualError).toContain("Schema 中不存在该对象");
    expect(closure.factualError).toContain("语义模型未完成或校验失败");
    expect(closure.text).toContain("可用候选");
  });
});
