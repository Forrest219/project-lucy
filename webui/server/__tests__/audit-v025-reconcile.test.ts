/**
 * Lucy v0.25 / L25-09 — B11 / B12 / B25 对账、auditCoverage、as-of S 视图。
 */
import { describe, expect, it } from "vitest";
import {
  AUDIT_COVERAGE_CHECKS,
  METRIC_UNITS,
  RECONCILE_DIFF_CLASSES,
  UNIT_DEFINITIONS,
  deriveAsOfSView,
  evaluateAuditCoverage,
  reconcile,
  summarize,
  type CoverageInput
} from "../proxy/audit-reconcile";

describe("B11 计量单位字典", () => {
  it("五个单位分别登记", () => {
    expect(METRIC_UNITS).toEqual([
      "protocol_request",
      "tool_call",
      "execution_attempt",
      "registered_inquiry",
      "display_group"
    ]);
    for (const unit of METRIC_UNITS) {
      const def = UNIT_DEFINITIONS[unit];
      expect(def.metricId).toContain(unit);
      expect(def.version).toBe("v2p5-1");
      expect(def.definition.length).toBeGreaterThan(0);
      expect(def.boundary.length).toBeGreaterThan(0);
    }
  });

  it("协议请求与工具调用不是同一集合（边界各自声明）", () => {
    expect(UNIT_DEFINITIONS.protocol_request.boundary).not.toBe(
      UNIT_DEFINITIONS.tool_call.boundary
    );
    expect(UNIT_DEFINITIONS.execution_attempt.definition).toContain("attempt_id");
    expect(UNIT_DEFINITIONS.registered_inquiry.definition).toContain("turnId");
  });
});

describe("B11 summarize + 闭合断言", () => {
  const filter = { seqUpperBound: 120 };

  it("汇总给出 N/D、八桶与旧 outcome 单列直方图", () => {
    const summary = summarize("tool_call", filter, [
      { unitId: "a", primaryStatus: "succeeded", legacyOutcome: "ok" },
      { unitId: "b", primaryStatus: "denied", legacyOutcome: "denied" },
      { unitId: "c", primaryStatus: "unknown", legacyOutcome: "ok" }
    ]);
    expect(summary.denominator).toBe(3);
    expect(summary.counts.succeeded).toBe(1);
    expect(summary.counts.denied).toBe(1);
    expect(summary.counts.unknown).toBe(1);
    expect(summary.legacyOutcomeCounts).toEqual({ ok: 2, denied: 1 });
    expect(summary.closed).toBe(true);
    expect(summary.seqUpperBound).toBe(120);
    expect(summary.metricId).toBe("tool_call/v2p5-1");
  });

  it("分母为 0 时不产生比例结论", () => {
    const summary = summarize("protocol_request", filter, []);
    expect(summary.denominator).toBe(0);
    expect(summary.closed).toBe(true);
    expect(summary.unobservableReasons).toContain("no_independent_ingress_counter");
  });
});

describe("B12 auditCoverage 六项独立检查", () => {
  function allChecks(overrides: Partial<Record<string, Partial<CoverageInput>>> = {}): CoverageInput[] {
    return AUDIT_COVERAGE_CHECKS.map((id) => ({
      id,
      status: "pass" as const,
      numerator: 10,
      denominator: 10,
      unit: "protocol_request" as const,
      evidenceSource: `independent_${id}`,
      ...(overrides[id] ?? {})
    }));
  }

  it("六项检查固定且各有中文标题", () => {
    expect(AUDIT_COVERAGE_CHECKS).toEqual([
      "ingress_receive_coverage",
      "processing_terminal_coverage",
      "projection_catchup",
      "association_dependency",
      "cross_endpoint_match",
      "export_coverage"
    ]);
    const report = evaluateAuditCoverage({ seqUpperBound: 10, checks: allChecks() });
    expect(report.checks).toHaveLength(6);
    expect(report.checks[0].title).toBe("入口接收覆盖");
  });

  it("全 pass 时 combined = pass", () => {
    const report = evaluateAuditCoverage({ seqUpperBound: 10, checks: allChecks() });
    expect(report.combined).toBe("pass");
    expect(report.allConclusive).toBe(true);
  });

  it("缺独立证据时记 unknown，且 unknown 不合成为 pass", () => {
    const report = evaluateAuditCoverage({
      seqUpperBound: 10,
      checks: allChecks({
        ingress_receive_coverage: {
          status: "unknown",
          reason: "no_independent_ingress_counter",
          numerator: 0,
          denominator: 0
        }
      })
    });
    const check = report.checks.find((c) => c.id === "ingress_receive_coverage")!;
    expect(check.status).toBe("unknown");
    expect(check.reason).toBe("no_independent_ingress_counter");
    expect(report.combined).toBe("unknown");
    expect(report.allConclusive).toBe(false);
  });

  it("N ≠ D 时 pass 降级为 fail", () => {
    const report = evaluateAuditCoverage({
      seqUpperBound: 10,
      checks: allChecks({ export_coverage: { numerator: 9, denominator: 10 } })
    });
    const check = report.checks.find((c) => c.id === "export_coverage")!;
    expect(check.status).toBe("fail");
    expect(check.reason).toBe("numerator_ne_denominator");
    expect(report.combined).toBe("fail");
  });

  it("差异集合非空时 pass 降级为 fail", () => {
    const report = evaluateAuditCoverage({
      seqUpperBound: 10,
      checks: allChecks({ association_dependency: { diffIds: ["row-7"] } })
    });
    const check = report.checks.find((c) => c.id === "association_dependency")!;
    expect(check.status).toBe("fail");
    expect(check.diffIds).toEqual(["row-7"]);
  });

  it("分母为 0 时 pass 降级为 unknown", () => {
    const report = evaluateAuditCoverage({
      seqUpperBound: 10,
      checks: allChecks({ projection_catchup: { numerator: 0, denominator: 0 } })
    });
    const check = report.checks.find((c) => c.id === "projection_catchup")!;
    expect(check.status).toBe("unknown");
    expect(check.reason).toBe("denominator_zero");
  });

  it("未提供的检查项记 unknown + check_not_provided", () => {
    const report = evaluateAuditCoverage({ seqUpperBound: 10, checks: [] });
    expect(report.checks).toHaveLength(6);
    expect(report.checks.every((c) => c.status === "unknown")).toBe(true);
    expect(report.checks[0].reason).toBe("check_not_provided");
  });
});

describe("B11 差异七分类", () => {
  it("七分类枚举固定", () => {
    expect(RECONCILE_DIFF_CLASSES).toEqual([
      "not_sent_locally",
      "not_observed_at_ingress",
      "missing_terminal_state",
      "parameter_conflict",
      "result_conflict",
      "filtered_out",
      "pending_verification"
    ]);
  });

  it("不强行配对未匹配项", () => {
    const result = reconcile({ expectedIds: ["a", "b"], observedIds: ["a", "c"] });
    expect(result.matchedIds).toEqual(["a"]);
    expect(result.missingIds).toEqual(["b"]);
    expect(result.extraIds).toEqual(["c"]);
    expect(result.diffs.length).toBe(2);
  });

  it("不可观测 ID 单列披露且不缩分母", () => {
    const result = reconcile({
      expectedIds: ["a", "b"],
      observedIds: ["a"],
      unobservableIds: ["b"]
    });
    expect(result.unobservableIds).toEqual(["b"]);
    expect(result.missingIds).toEqual([]);
  });
});

describe("B25 as-of S 视图", () => {
  const snapshot = {
    rows: [
      { id: "r1", ledgerSeq: 10, fields: { status: "denied", turn: "t1" } },
      { id: "r2", ledgerSeq: 20, fields: { status: "ok", turn: "t2" } }
    ],
    revisions: [
      { id: "rev1", ledgerSeq: 15, targetRowId: "r1", fields: { status: "confirmed" } },
      { id: "rev2", ledgerSeq: 25, targetRowId: "r2", fields: { status: "revised" } }
    ]
  };

  it("折叠 ledger_seq <= S 的修订事件", () => {
    const view = deriveAsOfSView(snapshot, 20);
    expect(view.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(view.rows[0].fields.status).toBe("confirmed");
    expect(view.rows[1].fields.status).toBe("ok");
    expect(view.appliedRevisionIds).toEqual(["rev1"]);
    expect(view.deferredRevisionIds).toEqual(["rev2"]);
    expect(view.closed).toBe(true);
  });

  it("seq > S 的行与修订被推迟并披露", () => {
    const view = deriveAsOfSView(snapshot, 12);
    expect(view.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(view.deferredRowIds).toEqual(["r2"]);
    expect(view.deferredRevisionIds).toEqual(["rev1", "rev2"]);
  });

  it("修订目标不在视图内时不凭空造行，并记闭合错误", () => {
    const view = deriveAsOfSView(
      {
        rows: [{ id: "r1", ledgerSeq: 10, fields: {} }],
        revisions: [{ id: "rev9", ledgerSeq: 11, targetRowId: "missing", fields: { x: 1 } }]
      },
      20
    );
    expect(view.rows).toHaveLength(1);
    expect(view.closed).toBe(false);
    expect(view.closureErrors[0]).toContain("revision_target_not_in_view");
  });

  it("只按 seq 过滤不足以宣称修订视图一致：被推迟修订必须被披露", () => {
    const view = deriveAsOfSView(snapshot, 20);
    expect(view.deferredRevisionIds.length).toBeGreaterThan(0);
  });
});
