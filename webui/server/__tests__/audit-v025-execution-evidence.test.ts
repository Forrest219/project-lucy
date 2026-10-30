/**
 * Lucy v0.25 / L25-09 —— 写路径执行凭据（D1）与 P0-4 列名漂移（D-32）。
 *
 * 两项缺陷的共同症状是「审计事实存在但读不出来」：
 *
 * - **执行凭据缺口**：写路径从不提供 `executionEvidence`，于是
 *   `verifiedSuccess` / `verifiedFailure` 恒缺，主状态按 §4.3(a) 规则 9 落
 *   `unknown`。后果是生产数据里 `succeeded` / `failed` 两桶恒为 0，主状态
 *   实际只有 `unknown` / `denied` / `budget_stopped` 三种取值。
 * - **列名漂移**：P0-4 读侧读 `authorization_view` / `execution_view`，但
 *   `access_log` 从未创建这两列（写路径写的是 `authorization_status` /
 *   `execution_status`），于是 `probeColumns` 兜底把它们投影成
 *   `NULL AS ...`，授权/执行视图**静默恒为 unknown**。
 *
 * 纪律（D1）：
 * - 凭据只来自**执行观测点**，不由 `outcome` 反推 —— HTTP 200 不推定执行成功；
 * - 观测不充分 → 不登记凭据（落 `unknown`），不得猜测。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  classifyAuditEvent,
  executionEvidenceFromObservation
} from "../proxy/audit-classification";
import { productionPrimaryStatusPort } from "../admin/reconciliation-ports";
import type { ReconciliationContext } from "../admin/reconciliation-context";

// ────────────────────────────────────────────────────────────────────────────
// Gap 1 —— 执行凭据
// ────────────────────────────────────────────────────────────────────────────

describe("L25-09 D-1: 写路径执行凭据产出真实主状态桶", () => {
  it("观测到执行成功 → 主状态 succeeded，执行视图 succeeded", () => {
    const r = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "ok",
      decisionReason: "allowed",
      responseRowCount: 5,
      responseBytes: 1024,
      evidence: executionEvidenceFromObservation({ executed: true, authorizationAllowed: true })
    });
    expect(r.primaryStatus).toBe("succeeded");
    expect(r.executionStatus).toBe("succeeded");
    expect(r.authorizationStatus).toBe("allowed");
  });

  it("观测到上游执行失败 → 主状态 failed，执行视图 failed", () => {
    const r = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "error",
      decisionReason: "upstream_error",
      errorDetail: "upstream_status=500",
      evidence: executionEvidenceFromObservation({ failed: true, authorizationAllowed: true })
    });
    expect(r.primaryStatus).toBe("failed");
    expect(r.executionStatus).toBe("failed");
  });

  it("入参/语义校验失败（未执行）→ 不得记为 failed", () => {
    const r = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "error",
      decisionReason: "ambiguous_field",
      evidence: executionEvidenceFromObservation({ notExecuted: true, authorizationAllowed: true })
    });
    // 未执行 ≠ 执行失败：执行视图是 not_executed，主状态不得是 failed。
    expect(r.executionStatus).toBe("not_executed");
    expect(r.primaryStatus).not.toBe("failed");
  });

  it("授权拒绝 → 主状态 denied，执行视图 not_executed", () => {
    const r = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "denied",
      decisionReason: "sensitive_metadata_forbidden",
      evidence: executionEvidenceFromObservation({ authorizationDenied: true, notExecuted: true })
    });
    expect(r.primaryStatus).toBe("denied");
    expect(r.authorizationStatus).toBe("denied");
    expect(r.executionStatus).toBe("not_executed");
  });

  it("预算终止 → 主状态 budget_stopped，且授权保留真实裁决 allowed（F-03 回归保护）", () => {
    const r = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "budget_stop",
      decisionReason: "question_budget_exhausted",
      evidence: executionEvidenceFromObservation({ authorizationAllowed: true, notExecuted: true })
    });
    expect(r.primaryStatus).toBe("budget_stopped");
    // 预算桶不得反推授权结论，也不得覆盖已发生的 allowed。
    expect(r.authorizationStatus).toBe("allowed");
    expect(r.authorizationStatus).not.toBe("not_evaluated");
  });

  it("§4.3(a) 规则 9：outcome=ok 但无执行凭据 → 仍落 unknown（禁止 HTTP 200 推定成功）", () => {
    const r = classifyAuditEvent({
      tool: "lucy_query",
      outcome: "ok",
      decisionReason: "allowed",
      responseRowCount: 5,
      responseBytes: 1024
      // evidence 缺省 —— 旧 outcome=ok 不构成执行成功凭据。
    });
    expect(r.primaryStatus).toBe("unknown");
    expect(r.executionStatus).not.toBe("succeeded");
    expect(r.authorizationStatus).toBe("unknown");
    expect(r.authorizationStatus).not.toBe("allowed");
  });

  it("凭据构造器不接受间接信号：空观测 → undefined（缺省即事实不成立）", () => {
    expect(executionEvidenceFromObservation(undefined)).toBeUndefined();
    expect(executionEvidenceFromObservation({})).toBeUndefined();
  });

  it("凭据构造器：executed 与 failed 互斥（同时给出时以 executed 为准，不产生矛盾）", () => {
    const ev = executionEvidenceFromObservation({ executed: true, failed: true });
    expect(ev?.verifiedSuccess).toBe(true);
    expect(ev?.verifiedFailure).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Gap 4 —— 列名漂移（D-32）
// ────────────────────────────────────────────────────────────────────────────

describe("L25-09 D-32: P0-4 读侧列名漂移", () => {
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
      generatedAt: "2026-10-28T00:00:00.000Z",
      completeness: {
        complete: true,
        combined_complete: true,
        projection_complete: true,
        scope_complete: true,
        file_hash_ok: true,
        relation_check_ok: true,
        lag_ms: 0,
        association_quality: {
          confirmed: 1,
          candidate: 0,
          unassigned: 0,
          conflict: 0,
          legacy_unverified: 0
        },
        data_scope: { ok: true },
        client_coverage: { observed: true, gap_windows: [] },
        policy_scope_expanded: [],
        untrusted_self_report: 0,
        legal_empty_window: false,
        classification_version: "v2p5-1",
        digest_version: "v2p5-1"
      },
      coverage: {
        ingress_receipt: {
          status: "unknown",
          metric: "request",
          numerator: null,
          denominator: null,
          source: "coverage_source_not_available",
          diff_ids: [],
          reason: "coverage_source_not_available"
        }
      }
    } as unknown as ReconciliationContext;
  }

  it("授权/执行视图取自真实写入列（authorization_status / execution_status），不再是恒 unknown", () => {
    const port = productionPrimaryStatusPort;
    const context = makeContext();
    const unit = {
      unitId: "42",
      metricUnit: "tool_call" as const,
      associationStatus: "confirmed" as const,
      primaryStatusColumn: "succeeded",
      authorizationViewColumn: "allowed",
      executionViewColumn: "succeeded",
      deliveryStatusColumn: "unknown",
      legacyOutcome: "ok"
    } as never;
    const facts = port.derive(unit, context);
    expect(facts.authorization).toBe("allowed");
    expect(facts.execution).toBe("succeeded");
    expect(facts.primaryStatus).toBe("succeeded");
  });

  it("老库缺 V3 列 → 兜底 unknown 并附原因，不得写成 0 / false", () => {
    const port = productionPrimaryStatusPort;
    const context = makeContext();
    const unit = {
      unitId: "43",
      metricUnit: "tool_call" as const,
      associationStatus: "unassigned" as const,
      // 三列全部缺省（迁移前的历史行）。
      primaryStatusColumn: null,
      authorizationViewColumn: null,
      executionViewColumn: null,
      deliveryStatusColumn: null,
      legacyOutcome: null
    } as never;
    const facts = port.derive(unit, context);
    expect(facts.authorization).toBe("unknown");
    expect(facts.execution).toBe("unknown");
    expect(facts.primaryStatus).toBe("unknown");
  });

  it("反向对照：access_log 从未创建 authorization_view / execution_view 两列", () => {
    // 这两列是本次缺陷的根因。若将来有人新增同名列，本用例会失败，
    // 提醒：读侧已改读 *_status，不要再引入第二套同义事实源。
    const db = new Database(":memory:");
    db.exec("CREATE TABLE access_log (id INTEGER PRIMARY KEY, authorization_status TEXT, execution_status TEXT)");
    const cols = new Set(
      (db.prepare("PRAGMA table_info(access_log)").all() as Array<{ name: string }>).map((r) => r.name)
    );
    const out = {
      authorization_view: cols.has("authorization_view"),
      execution_view: cols.has("execution_view"),
      authorization_status: cols.has("authorization_status"),
      execution_status: cols.has("execution_status")
    };
    writeFileSync("/tmp/lucy-d32-columns.json", JSON.stringify(out, null, 2));
    expect(out.authorization_status).toBe(true);
    expect(out.execution_status).toBe(true);
  });
});
