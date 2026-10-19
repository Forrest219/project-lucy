/**
 * T04a audit-trust 集成测试：
 * - 共享分类函数 classifyAccessLogEvent 一致性
 * - 4 轴状态 + event_type + transport_sub_type 映射
 * - 字段歧义不冒充权限拒绝 (G0-03 caveat)
 * - legacy outcome / failure dimension 兼容
 */
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_VERSION,
  classifyAccessLogEvent,
  classifyAccessLogBatch
} from "../../proxy/audit-classification";

describe("T04a shared classification function", () => {
  it("returns the constant CLASSIFICATION_VERSION", () => {
    expect(CLASSIFICATION_VERSION).toBe("audit-trust-2026-10-19-r1.v1");
  });

  it("classifies a successful tool_call as ok on all axes", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      decisionReason: "allowed",
      responseRowCount: 10
    });
    expect(r.eventType).toBe("tool_call");
    expect(r.transportSubType).toBe("other");
    expect(r.transportStatus).toBe("succeeded");
    expect(r.authorizationStatus).toBe("allowed");
    expect(r.executionStatus).toBe("succeeded");
    expect(r.usabilityStatus).toBe("usable");
    expect(r.classificationVersion).toBe(CLASSIFICATION_VERSION);
  });

  it("classifies a permission-denied tool as denied + not_executed", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "denied",
      decisionReason: "permission_denied",
      failureDimension: "权限拒绝"
    });
    expect(r.transportStatus).toBe("failed");
    expect(r.authorizationStatus).toBe("denied");
    expect(r.executionStatus).toBe("not_executed");
  });

  it("classifies budget_stop as interrupted (not denied)", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "budget_stop",
      decisionReason: "question_budget_exhausted"
    });
    expect(r.authorizationStatus).toBe("not_evaluated");
    expect(r.executionStatus).toBe("interrupted");
  });

  it("classifies handshake protocol methods as protocol/handshake", () => {
    for (const tool of ["tools/list", "initialize", "notifications/initialized"]) {
      const c = classifyAccessLogEvent({ tool, outcome: "ok" });
      expect(c.eventType).toBe("protocol");
      expect(c.transportSubType).toBe("handshake");
    }
  });

  it("classifies probe methods as protocol/probe", () => {
    for (const tool of ["ping", "resources/list", "resources/templates/list", "notifications/cancelled"]) {
      const c = classifyAccessLogEvent({ tool, outcome: "ok" });
      expect(c.eventType).toBe("protocol");
      expect(c.transportSubType).toBe("probe");
    }
  });

  it("classifies server/discover as protocol/unknown_method", () => {
    const c = classifyAccessLogEvent({ tool: "server/discover", outcome: "ok" });
    expect(c.eventType).toBe("protocol");
    expect(c.transportSubType).toBe("unknown_method");
  });

  it("does NOT map field ambiguity to authorizationStatus=denied (G0-03 caveat)", () => {
    // scan_missing is a usability evaluation, NOT a permission verdict.
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      decisionReason: "scan_missing",
      responseRowCount: 0
    });
    expect(r.authorizationStatus).toBe("allowed");
    expect(r.usabilityStatus).toBe("metadata_missing");
  });

  it("scan_failed also maps to metadata_missing (not not_applicable)", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      decisionReason: "scan_failed",
      responseRowCount: null
    });
    expect(r.usabilityStatus).toBe("metadata_missing");
  });

  it("eventTypeHint=protocol still infers transportSubType from tool name", () => {
    const r = classifyAccessLogEvent({
      tool: "tools/list",
      outcome: "ok",
      eventTypeHint: "protocol"
    });
    expect(r.eventType).toBe("protocol");
    expect(r.transportSubType).toBe("handshake");
  });

  it("eventTypeHint=protocol for server/discover infers unknown_method", () => {
    const r = classifyAccessLogEvent({
      tool: "server/discover",
      outcome: "ok",
      eventTypeHint: "protocol"
    });
    expect(r.eventType).toBe("protocol");
    expect(r.transportSubType).toBe("unknown_method");
  });

  it("usabilityStatus maps row_count=0 to empty (when no field ambiguity)", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      responseRowCount: 0
    });
    expect(r.usabilityStatus).toBe("empty");
  });

  it("usabilityStatus maps missing row_count to not_applicable", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok"
    });
    expect(r.usabilityStatus).toBe("not_applicable");
  });

  it("honors explicit hints over inferred values (write-back parity)", () => {
    const r = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      eventTypeHint: "audit_management",
      authorizationStatusHint: "denied"
    });
    expect(r.eventType).toBe("audit_management");
    expect(r.authorizationStatus).toBe("denied");
  });

  it("classifyAccessLogBatch returns one ClassifiedEvent per input", () => {
    const rows = [
      { tool: "lucy_query", outcome: "ok", responseRowCount: 5 },
      { tool: "tools/list", outcome: "ok" },
      { tool: "lucy_query", outcome: "denied" }
    ];
    const out = classifyAccessLogBatch(rows);
    expect(out).toHaveLength(3);
    expect(out[0].eventType).toBe("tool_call");
    expect(out[1].eventType).toBe("protocol");
    expect(out[2].authorizationStatus).toBe("denied");
  });

  it("is deterministic for identical inputs", () => {
    const a = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      responseRowCount: 5,
      decisionReason: "allowed"
    });
    const b = classifyAccessLogEvent({
      tool: "lucy_query",
      outcome: "ok",
      responseRowCount: 5,
      decisionReason: "allowed"
    });
    expect(a).toEqual(b);
  });

  it("legacy outcome strings map consistently", () => {
    // ok / error / denied / budget_stop — legacy enum preserved.
    expect(classifyAccessLogEvent({ tool: "t", outcome: "ok" }).transportStatus).toBe("succeeded");
    expect(classifyAccessLogEvent({ tool: "t", outcome: "error" }).transportStatus).toBe("failed");
    expect(classifyAccessLogEvent({ tool: "t", outcome: "denied" }).transportStatus).toBe("failed");
    expect(classifyAccessLogEvent({ tool: "t", outcome: "budget_stop" }).transportStatus).toBe("failed");
    // unknown / null
    expect(classifyAccessLogEvent({ tool: "t", outcome: null }).transportStatus).toBe("unknown");
  });
});