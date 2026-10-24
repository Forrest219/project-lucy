/**
 * Lucy v0.25 / L25-09 — B1 / B2 / B3 主状态派生、三视图、空值原因。
 */
import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATUS_DOMAIN,
  DELIVERY_STATUSES,
  DERIVATION_VERSION,
  PRIMARY_STATUSES,
  deriveAuthorizationView,
  deriveExecutionView,
  derivePrimaryStatus,
  emptyPrimaryStatusCounts,
  isPrimaryStatus,
  isWrittenDeliveryStatus,
  summarizePrimaryStatuses
} from "../proxy/audit-derivation";
import {
  NULL_REASON_VALUES,
  isNullReason,
  legacyNullReason,
  normalizeNullReason,
  nullReasonFor,
  nullValue
} from "../proxy/audit-null-reasons";

describe("B1 derivePrimaryStatus — U10 九行有序派生表", () => {
  it("派生规则版本为 v2p5-1", () => {
    expect(DERIVATION_VERSION).toBe("v2p5-1");
  });

  it("八桶枚举完整且互斥", () => {
    expect(PRIMARY_STATUSES).toEqual([
      "succeeded",
      "failed",
      "denied",
      "budget_stopped",
      "cancelled",
      "timeout",
      "indeterminate",
      "unknown"
    ]);
    expect(new Set(PRIMARY_STATUSES).size).toBe(8);
    expect(emptyPrimaryStatusCounts()).toEqual({
      succeeded: 0,
      failed: 0,
      denied: 0,
      budget_stopped: 0,
      cancelled: 0,
      timeout: 0,
      indeterminate: 0,
      unknown: 0
    });
  });

  it("规则 1：事实矛盾优先于一切，落 unknown + conflict", () => {
    const r = derivePrimaryStatus({
      unresolvedContradiction: true,
      conflictTags: ["success_and_failure_both_observed"],
      verifiedSuccess: true,
      verifiedFailure: true,
      budgetStopped: true,
      notExecuted: true
    });
    expect(r.primaryStatus).toBe("unknown");
    expect(r.conflict).toBe(true);
    expect(r.conflictTags).toEqual(["success_and_failure_both_observed"]);
    expect(r.rule).toBe(1);
  });

  it("规则 2：预算终止 + 未执行 → budget_stopped（不是 denied）", () => {
    const r = derivePrimaryStatus({ budgetStopped: true, notExecuted: true });
    expect(r.primaryStatus).toBe("budget_stopped");
    expect(r.rule).toBe(2);
    expect(r.authorization).toBe("not_evaluated");
  });

  it("规则 3：授权拒绝 + 未执行 → denied", () => {
    const r = derivePrimaryStatus({ authorizationDenied: true, notExecuted: true });
    expect(r.primaryStatus).toBe("denied");
    expect(r.rule).toBe(3);
  });

  it("规则 2 优先于规则 3：预算终止不伪装为权限拒绝", () => {
    const r = derivePrimaryStatus({
      budgetStopped: true,
      notExecuted: true,
      authorizationDenied: true
    });
    expect(r.primaryStatus).toBe("budget_stopped");
  });

  it("规则 4：可核验失败凭据 → failed", () => {
    const r = derivePrimaryStatus({ verifiedFailure: true });
    expect(r.primaryStatus).toBe("failed");
    expect(r.rule).toBe(4);
  });

  it("规则 5：可核验成功凭据 → succeeded", () => {
    const r = derivePrimaryStatus({ verifiedSuccess: true });
    expect(r.primaryStatus).toBe("succeeded");
    expect(r.rule).toBe(5);
  });

  it("闭合凭据先于取消 / 超时", () => {
    const cancelled = derivePrimaryStatus({ verifiedCancellation: true, verifiedSuccess: true });
    expect(cancelled.primaryStatus).toBe("succeeded");
    expect(cancelled.rule).toBe(5);
    const timedOut = derivePrimaryStatus({ executionTimeout: true, verifiedFailure: true });
    expect(timedOut.primaryStatus).toBe("failed");
    expect(timedOut.rule).toBe(4);
  });

  it("规则 6：已确认取消 → cancelled（仅取消请求不足）", () => {
    const r = derivePrimaryStatus({ verifiedCancellation: true });
    expect(r.primaryStatus).toBe("cancelled");
    expect(r.rule).toBe(6);
  });

  it("规则 7：超时凭据 → timeout", () => {
    const r = derivePrimaryStatus({ executionTimeout: true });
    expect(r.primaryStatus).toBe("timeout");
    expect(r.rule).toBe(7);
  });

  it("规则 8：持久前缀 + 中断未定 → indeterminate", () => {
    const r = derivePrimaryStatus({ durablePrefix: true, interruptedWithoutResult: true });
    expect(r.primaryStatus).toBe("indeterminate");
    expect(r.rule).toBe(8);
    expect(r.execution).toBe("interrupted");
  });

  it("规则 9：证据不足 → unknown（旧 ok 不推定 succeeded）", () => {
    const r = derivePrimaryStatus({ legacyOutcome: "ok" });
    expect(r.primaryStatus).toBe("unknown");
    expect(r.rule).toBe(9);
    expect(r.conflict).toBe(false);
  });

  it("证据引用原样保留", () => {
    const r = derivePrimaryStatus({
      verifiedSuccess: true,
      evidenceRefs: ["ledger:12", "access_log:88"]
    });
    expect(r.evidenceRefs).toEqual(["ledger:12", "access_log:88"]);
  });
});

describe("B2 三视图独立判定", () => {
  it("authorization / execution / delivery 相互独立", () => {
    const r = derivePrimaryStatus({
      verifiedSuccess: true,
      deliveryStatus: "unknown"
    });
    expect(r.authorization).toBe("allowed");
    expect(r.execution).toBe("succeeded");
    expect(r.delivery).toBe("unknown");
  });

  it("送达缺失不改执行结果（ACK 缺失不得改成执行失败）", () => {
    const r = derivePrimaryStatus({
      verifiedSuccess: true,
      deliveryStatus: "prepared"
    });
    expect(r.primaryStatus).toBe("succeeded");
    expect(r.execution).toBe("succeeded");
    expect(r.delivery).toBe("prepared");
  });

  it("budget_stop 不映射为 execution=interrupted", () => {
    const r = derivePrimaryStatus({ budgetStopped: true, notExecuted: true });
    expect(r.execution).toBe("not_executed");
    expect(r.execution).not.toBe("interrupted");
  });

  it("delivery 本期只写四值，unacknowledged 仅保留值域", () => {
    expect(DELIVERY_STATUSES).toEqual(["prepared", "sent", "acknowledged", "unknown"]);
    expect(DELIVERY_STATUS_DOMAIN).toContain("unacknowledged");
    expect(isWrittenDeliveryStatus("unacknowledged")).toBe(false);
    expect(isWrittenDeliveryStatus("acknowledged")).toBe(true);
  });

  it("显式视图提示优先于推导", () => {
    const r = derivePrimaryStatus({
      verifiedSuccess: true,
      authorizationView: "not_evaluated",
      executionView: "unknown"
    });
    expect(r.authorization).toBe("not_evaluated");
    expect(r.execution).toBe("unknown");
  });

  it("deriveAuthorizationView / deriveExecutionView 可单独调用", () => {
    expect(deriveAuthorizationView({ authorizationDenied: true })).toBe("denied");
    expect(deriveAuthorizationView({ budgetStopped: true })).toBe("not_evaluated");
    expect(deriveExecutionView({ notExecuted: true })).toBe("not_executed");
    expect(deriveExecutionView({ durablePrefix: true, interruptedWithoutResult: true })).toBe("interrupted");
  });
});

describe("B1 汇总闭合断言", () => {
  it("八桶合计等于集合总数", () => {
    const summary = summarizePrimaryStatuses([
      { primaryStatus: "succeeded" },
      { primaryStatus: "succeeded" },
      { primaryStatus: "denied" },
      { primaryStatus: "budget_stopped" },
      { primaryStatus: "failed" },
      { primaryStatus: "cancelled" },
      { primaryStatus: "timeout" },
      { primaryStatus: "indeterminate" },
      { primaryStatus: "unknown" }
    ]);
    expect(summary.closed).toBe(true);
    expect(summary.total).toBe(9);
    expect(summary.counts.succeeded).toBe(2);
    const bucketSum = PRIMARY_STATUSES.reduce((sum, s) => sum + summary.counts[s], 0);
    expect(bucketSum).toBe(summary.total);
  });

  it("空集合闭合且分母为 0", () => {
    const summary = summarizePrimaryStatuses([]);
    expect(summary.closed).toBe(true);
    expect(summary.total).toBe(0);
  });

  it("非法状态值触发闭合失败", () => {
    const summary = summarizePrimaryStatuses([
      { primaryStatus: "nope" as never }
    ]);
    expect(summary.closed).toBe(false);
    expect(summary.closureErrors.length).toBeGreaterThan(0);
  });

  it("isPrimaryStatus 只接受八桶", () => {
    expect(isPrimaryStatus("succeeded")).toBe(true);
    expect(isPrimaryStatus("ok")).toBe(false);
  });
});

describe("B3 空值原因六值枚举", () => {
  it("枚举为 U2 冻结的六值", () => {
    expect(NULL_REASON_VALUES).toEqual([
      "not_applicable",
      "not_collected",
      "redacted",
      "parse_failed",
      "unknown",
      "not_supported"
    ]);
  });

  it("空白 / 非法值归一为 unknown，不推定 not_collected", () => {
    expect(normalizeNullReason(null)).toBe("unknown");
    expect(normalizeNullReason(undefined)).toBe("unknown");
    expect(normalizeNullReason("")).toBe("unknown");
    expect(normalizeNullReason("not_collected_ish")).toBe("unknown");
    expect(legacyNullReason()).toBe("unknown");
  });

  it("合法值原样保留", () => {
    for (const reason of NULL_REASON_VALUES) {
      expect(isNullReason(reason)).toBe(true);
      expect(normalizeNullReason(reason)).toBe(reason);
    }
  });

  it("nullReasonFor 依 presence 与给定原因决定", () => {
    expect(nullReasonFor(true)).toBe("not_applicable");
    expect(nullReasonFor(false, "redacted")).toBe("redacted");
    expect(nullReasonFor(false, "parse_failed")).toBe("parse_failed");
    expect(nullReasonFor(false, undefined)).toBe("unknown");
  });

  it("缺值记录带原因与证据来源", () => {
    const record = nullValue<string>(null, "not_collected", "call_args");
    expect(record.value).toBeNull();
    expect(record.reason).toBe("not_collected");
    expect(record.evidenceSource).toBe("call_args");
  });
});
