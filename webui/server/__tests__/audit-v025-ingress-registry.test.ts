/**
 * Lucy v0.25 / L25-09 — B6 / D1 / D3 / U12 入口登记与身份分配。
 */
import { describe, expect, it } from "vitest";
import {
  AUDIT_WINDOWS,
  CORRELATION_HEADER_NAMES,
  CORRELATION_HEADERS_VERSION,
  ENDPOINT_IDS,
  ENDPOINT_REGISTRY,
  allocateIngressIdentity,
  buildCorrelationHeaders,
  isEndpointId,
  resolveEndpoint,
  settlementDeadlines
} from "../proxy/ingress-registry";

describe("B6 入口登记", () => {
  it("三个逻辑入口各自登记", () => {
    expect(ENDPOINT_IDS).toEqual(["mcp-http", "admin-http", "agent-audit-ingest"]);
    expect(isEndpointId("mcp-http")).toBe(true);
    expect(isEndpointId("nope")).toBe(false);
  });

  it("57881（MCP）与 55176（管理）分别登记，端口并存是合法部署形态", () => {
    expect(ENDPOINT_REGISTRY["mcp-http"].listen.port).toBe(57881);
    expect(ENDPOINT_REGISTRY["admin-http"].listen.port).toBe(55176);
    expect(ENDPOINT_REGISTRY["agent-audit-ingest"].listen.port).toBe(55176);
  });

  it("每个入口登记可观察路由组件", () => {
    for (const id of ENDPOINT_IDS) {
      const reg = resolveEndpoint(id);
      expect(reg.observableRoute.length).toBeGreaterThan(0);
      expect(reg.observableRoute[0]).toBe("ingress");
    }
  });

  it("未知入口拒绝解析", () => {
    expect(() => resolveEndpoint("bogus" as never)).toThrow(/unknown_endpoint/);
  });
});

describe("D3 入口身份分配", () => {
  it("operation_id / attempt_id / ingress_event_id 同时分配", () => {
    const identity = allocateIngressIdentity({ endpointId: "mcp-http" });
    expect(identity.operationId.startsWith("mcp_")).toBe(true);
    expect(identity.attemptId.startsWith("attempt_")).toBe(true);
    expect(identity.ingressEventId).toBe(`${identity.operationId}:received`);
    expect(identity.receivedEventId).toBe(identity.ingressEventId);
  });

  it("首次请求没有父 attempt / retry_of", () => {
    const identity = allocateIngressIdentity({ endpointId: "mcp-http" });
    expect(identity.parentAttemptId).toBeNull();
    expect(identity.retryOf).toBeNull();
  });

  it("业务重试产生新 attempt + parent_attempt_id + retry_of", () => {
    const original = allocateIngressIdentity({ endpointId: "mcp-http" });
    const retry = allocateIngressIdentity({
      endpointId: "mcp-http",
      parentAttemptId: original.attemptId,
      retryOf: original.ingressEventId
    });
    expect(retry.attemptId).not.toBe(original.attemptId);
    expect(retry.operationId).not.toBe(original.operationId);
    expect(retry.parentAttemptId).toBe(original.attemptId);
    expect(retry.retryOf).toBe(original.ingressEventId);
  });

  it("注入的 id 生成器可复现", () => {
    let counter = 0;
    const identity = allocateIngressIdentity({
      endpointId: "mcp-http",
      idFactory: () => `id${++counter}`
    });
    expect(identity.operationId).toBe("mcp_id1");
    expect(identity.attemptId).toBe("attempt_id2");
  });
});

describe("U12 回传信封", () => {
  it("三项关联头指向已提交 received 的 ingress_event_id", () => {
    const identity = allocateIngressIdentity({ endpointId: "mcp-http" });
    const headers = buildCorrelationHeaders(identity);
    expect(CORRELATION_HEADERS_VERSION).toBe("v2p5-1");
    expect(headers[CORRELATION_HEADER_NAMES.eventId]).toBe(identity.ingressEventId);
    expect(headers[CORRELATION_HEADER_NAMES.operationId]).toBe(identity.operationId);
    expect(headers[CORRELATION_HEADER_NAMES.attemptId]).toBe(identity.attemptId);
  });
});

describe("U6 结算窗口", () => {
  it("T1=24h / T2=72h / T3=60s 为冻结值", () => {
    expect(AUDIT_WINDOWS.t1SettlementHours).toBe(24);
    expect(AUDIT_WINDOWS.t2ObservationGraceHours).toBe(72);
    expect(AUDIT_WINDOWS.t3ExportCatchupSeconds).toBe(60);
  });

  it("截止时间自 received_at 起算，不因重启或重试延长", () => {
    const receivedAt = 1_000_000;
    const deadlines = settlementDeadlines(receivedAt);
    expect(deadlines.t1Deadline).toBe(receivedAt + 24 * 3_600_000);
    expect(deadlines.t2Deadline).toBe(receivedAt + 72 * 3_600_000);
    expect(settlementDeadlines(receivedAt)).toEqual(deadlines);
  });
});
