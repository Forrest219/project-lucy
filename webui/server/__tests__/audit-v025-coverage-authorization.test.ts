/**
 * Lucy v0.25 / L25-09 §18.10 F-01 与 F-03 —— 覆盖检查与授权事实保真。
 *
 * - F-01：没有独立到达凭据时，auditCoverage 检查 1「入口接收覆盖」必须记
 *   `unknown`，**不得**用同侧投影（received ∪ auth_failure_log）自证入口无漏记。
 * - F-03：授权结论按真实裁决记录；预算终止既不记为授权拒绝，也不反推
 *   `not_evaluated`，更不得覆盖已发生的授权裁决。
 */
import { describe, expect, it } from "vitest";
import { createProductionAuditCoveragePort } from "../admin/reconciliation-ports";
import { classifyAuditEvent } from "../proxy/audit-classification";
import { derivePrimaryStatus } from "../proxy/audit-derivation";
import type { ReconciliationContext } from "../admin/reconciliation-context";

function makeContext(): ReconciliationContext {
  return {
    schemaVersion: "audit-reconciliation-view/v1",
    instanceId: "lucy-test",
    filter: {
      user: null,
      tokenHashPrefix: null,
      tool: null,
      outcome: null,
      sessionId: null,
      turnId: null,
      platform: null
    },
    timeRange: { from: "2026-10-01T00:00:00Z", to: "2026-10-28T00:00:00Z" },
    watermarkSeq: 42,
    snapshotId: "snapshot-1",
    metricUnit: "tool_call",
    s05MetricUnit: "tool_call",
    classificationVersion: "v2p5-1",
    derivationVersion: "v2p5-1",
    attributionRuleVersion: "audit-trust-2026-10-19-r1",
    budgetRuleVersion: "audit-trust-2026-10-19-r1",
    generatedAt: "2026-10-27T00:00:00.000Z",
    completeness: {
      complete: true,
      combined_complete: true,
      dataScope: { ok: true, reason: null },
      associationQuality: { confirmed: 0, candidate: 0, unassigned: 0, conflict: 0, legacyUnverified: 0 },
      clientCoverage: { observed: false, gapWindows: [], unknownReason: "no_controlled_client" },
      legalEmptyWindow: true,
      reasons: []
    },
    auditCoverage: {
      version: "v2p5-1",
      seqUpperBound: 42,
      checks: [],
      allConclusive: false,
      combined: "unknown"
    },
    rowBoundAccessLogId: 100
  } as unknown as ReconciliationContext;
}

describe("F-01 入口接收覆盖检查不得同侧自证", () => {
  it("生产覆盖端口把检查 1 记为 unknown（无独立到达凭据）", () => {
    const port = createProductionAuditCoveragePort();
    const coverage = port.summarizeCoverage(makeContext(), { units: [] });
    const check = coverage.checks.find((c) => c.id === "ingress_receive_coverage");
    expect(check).toBeDefined();
    expect(check!.status).toBe("unknown");
    expect(check!.reason).toBe("coverage_source_not_available");
    // unknown 不合成为 pass。
    expect(coverage.combined).not.toBe("pass");
    expect(coverage.allConclusive).toBe(false);
  });

  it("其余五项在没有各自独立来源时同样是 unknown", () => {
    const port = createProductionAuditCoveragePort();
    const coverage = port.summarizeCoverage(makeContext(), { units: [] });
    const others = coverage.checks.filter((c) => c.id !== "projection_catchup");
    expect(others.every((c) => c.status === "unknown")).toBe(true);
  });
});

describe("F-03 授权事实保真", () => {
  it("预算终止不记为授权拒绝，且不反推 not_evaluated", () => {
    const classified = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "budget_stop",
      decisionReason: "question_budget_exhausted"
    });
    expect(classified.primaryStatus).toBe("budget_stopped");
    expect(classified.executionStatus).toBe("not_executed");
    // 没有可证的授权裁决凭据 → 证据不足 → unknown（不是 not_evaluated）。
    expect(classified.authorizationStatus).toBe("unknown");
    expect(classified.authorizationStatus).not.toBe("not_evaluated");
    expect(classified.authorizationStatus).not.toBe("denied");
  });

  it("预算终止不覆盖已发生的授权裁决（ACL 闸先于预算闸）", () => {
    const classified = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "budget_stop",
      decisionReason: "question_budget_exhausted",
      evidence: { authorizationAllowed: true, notExecuted: true }
    });
    expect(classified.primaryStatus).toBe("budget_stopped");
    expect(classified.authorizationStatus).toBe("allowed");
    expect(classified.executionStatus).toBe("not_executed");
  });

  it("明确授权拒绝仍记 denied，且不被预算桶改写", () => {
    const classified = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "denied",
      decisionReason: "permission_denied"
    });
    expect(classified.primaryStatus).toBe("denied");
    expect(classified.authorizationStatus).toBe("denied");
    expect(classified.executionStatus).toBe("not_executed");
  });

  it("证据不足时授权落 unknown，而不是 not_evaluated", () => {
    const classified = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "error",
      decisionReason: "upstream_failed"
    });
    expect(classified.authorizationStatus).toBe("unknown");
  });

  it("确未评估必须有可证事实", () => {
    const derived = derivePrimaryStatus({
      notExecuted: true,
      authorizationNotEvaluated: true
    });
    expect(derived.authorization).toBe("not_evaluated");
  });
});
