// @vitest-environment jsdom
/**
 * 批 C-2 集成用例：P0-4 只读对账 · 使用概况页 + E8 差异明细入口。
 *
 * 守的不变量（Spec §2.4 / §2.6 / §4.4）：
 *  1. 规模为 null 一律显示「不可观测 + 原因」，**不得**显示 0；
 *  2. 比率同时给出 N／D；分母为 0 或不可观测时不显示 0% / 100%；
 *  3. 「活跃数 > 配置数」**不自动等于数据异常**；
 *  4. as-of S 不可证明时显式披露为诊断视图，不静默当完整结论；
 *  5. 差异集合四类逐类列出，身份清单不截断计数。
 *
 * 2026-11-02 追加（L25-02／03 功能收口）：
 *  6. 问询详情逐条给出完整表身份，**不收成「等 N 个」**（Spec §4.1）；
 *  7. 使用概况的表排行逐条给出完整 `connectionId / schema / table`，
 *     并可复制全文；列表文本**不出现「等 N 个」**（Spec §3.4 / §4.2）。
 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditReconciliation } from "../pages/admin/AuditReconciliation";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn()
}));

vi.mock("sonner", () => ({ toast: toastMock }));

function usagePayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      reconciliationContext: {
        instanceId: "inst-1",
        watermarkSeq: 42,
        snapshotId: "snap-1",
        generatedAt: "2026-10-28T00:00:00.000Z",
        metricUnit: "tool_call",
        classificationVersion: "v2p5-1",
        derivationVersion: "v2p5-1",
        attributionRuleVersion: "v1",
        budgetRuleVersion: "v1"
      },
      projectionCoverage: {},
      asOfProof: { ok: true },
      diagnosticIncomplete: null,
      tokenReconciliation: {
        configuredSnapshot: {
          capturedAt: "2026-10-28T00:00:00.000Z",
          configVersion: "v1",
          available: true,
          unavailableReason: null,
          total: 5,
          enabled: 4,
          disabled: 1,
          expired: 0,
          identityAmbiguity: false
        },
        activeWindow: {
          from: "2026-10-27T00:00:00.000Z",
          to: "2026-10-28T00:00:00.000Z",
          timezone: "UTC",
          metricUnit: "tool_call",
          eventScope: "tool_call_only",
          protocolEventsExcluded: 3,
          identityCount: 2,
          toolCallCount: 9
        },
        unknownIdentity: { count: 0, reasons: [] },
        differences: [
          {
            id: "configured_not_active",
            label: "已配置未活跃",
            count: 3,
            nullReason: null,
            identities: ["tok-a", "tok-b", "tok-c"],
            reasons: [],
            evidenceRefs: []
          },
          {
            id: "active_not_in_current_config",
            label: "活跃但当前配置不可见",
            count: null,
            nullReason: "not_collected",
            identities: [],
            reasons: [],
            evidenceRefs: []
          },
          {
            id: "disabled_or_deleted",
            label: "已停用或已删除",
            count: 1,
            nullReason: null,
            identities: ["tok-d"],
            reasons: ["已停用"],
            evidenceRefs: []
          },
          {
            id: "identity_unverified",
            label: "身份未核验",
            count: 0,
            nullReason: null,
            identities: [],
            reasons: [],
            evidenceRefs: []
          }
        ],
        anomaly: { flagged: false, reason: "", activeGreaterThanConfigured: false },
        completeness: { numerator: 2, denominator: 5, ratio: 0.4, ratioNullReason: null }
      },
      calls: {
        items: [
          {
            unitId: "1",
            ts: "2026-10-28T00:00:00.000Z",
            tool: "sl_query",
            turnId: "turn-1",
            tokenIdentity: "tok-a",
            tokenIdentityKind: "hash_prefix",
            protocol: false
          }
        ],
        nextCursor: null,
        complete: true,
        totalMatched: 1,
        returned: 1
      },
      ...overrides
    }
  };
}

/**
 * 13 条长表身份（Spec §4.1 V01 的形状）：连接 / Schema / 表 三段都足够长，
 * 任何「截成等 N 个」的处理都会在这一组上暴露。
 */
const LONG_TABLE_IDENTITIES = Array.from({ length: 13 }, (_, index) => {
  const n = String(index + 1).padStart(2, "0");
  return {
    connectionId: `mysql-aliyun-connection-${n}-with-a-long-connection-name`,
    schema: `reporting_schema_${n}_with_a_long_schema_name`,
    table: `fact_table_${n}_with_a_very_long_physical_table_name`
  };
});

function tableEvidenceOf(identity: (typeof LONG_TABLE_IDENTITIES)[number], callCount = 1) {
  return {
    identityKey: JSON.stringify([identity.connectionId, identity.schema, identity.table]),
    connectionId: identity.connectionId,
    schema: identity.schema,
    table: identity.table,
    identityComplete: true,
    missingIdentityParts: [],
    physicalTable: identity.table,
    callCount,
    firstObservedAt: "2026-11-02T00:00:00.000Z",
    lastObservedAt: "2026-11-02T00:01:00.000Z",
    sourceStatus: "resolved",
    sourceStatusNullReason: null
  };
}

function renderPage(initialUrl = "/admin/audit-reconciliation?range=7d") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <AuditReconciliation />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubUsage(payload: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/audit/reconciliation/usage")) {
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: { inquiry: {} } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("批 C-2：P0-4 使用概况页", () => {
  it("Token 对账卡片并列显示配置数与活跃数", async () => {
    stubUsage(usagePayload());
    renderPage();

    await waitFor(() => expect(screen.getByTestId("reconciliation-token-card")).toBeInTheDocument());
    expect(screen.getByTestId("reconciliation-configured-total")).toHaveTextContent("5");
    expect(screen.getByTestId("reconciliation-active-count")).toHaveTextContent("2");
    expect(screen.getByTestId("reconciliation-active-rate")).toHaveTextContent("40.0%");
    // 比率同时给出 N／D
    expect(screen.getByTestId("reconciliation-token-card")).toHaveTextContent("N=2");
    expect(screen.getByTestId("reconciliation-token-card")).toHaveTextContent("D=5");
  });

  it("四类差异集合逐类列出；规模为 null 显示「不可观测」而不是 0", async () => {
    stubUsage(usagePayload());
    renderPage();

    await waitFor(() => expect(screen.getByTestId("reconciliation-differences")).toBeInTheDocument());
    for (const id of [
      "configured_not_active",
      "active_not_in_current_config",
      "disabled_or_deleted",
      "identity_unverified"
    ]) {
      expect(screen.getByTestId(`reconciliation-difference-${id}`)).toBeInTheDocument();
    }
    const unobservable = screen.getByTestId("reconciliation-difference-active_not_in_current_config");
    expect(unobservable).toHaveTextContent("不可观测");
    expect(unobservable).not.toHaveTextContent(">0<");
    expect(screen.getByTestId("reconciliation-difference-configured_not_active")).toHaveTextContent("3");
  });

  it("配置快照不可观测时，三个依赖配置的差异集合显示不可观测而不是 0", async () => {
    const payload = usagePayload();
    const data = (payload as { data: Record<string, unknown> }).data;
    (data.tokenReconciliation as { configuredSnapshot: Record<string, unknown> }).configuredSnapshot = {
      capturedAt: "2026-10-28T00:00:00.000Z",
      configVersion: null,
      available: false,
      unavailableReason: "config_snapshot_unreadable",
      total: null,
      enabled: null,
      disabled: null,
      expired: null,
      identityAmbiguity: false
    };
    stubUsage(payload);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("reconciliation-config-unavailable")).toBeInTheDocument()
    );
    expect(screen.getByTestId("reconciliation-configured-total")).toHaveTextContent("不可观测");
  });

  it("分母为 0 时比率不显示 0% / 100%", async () => {
    const payload = usagePayload();
    const data = (payload as { data: Record<string, unknown> }).data;
    (data.tokenReconciliation as { completeness: Record<string, unknown> }).completeness = {
      numerator: null,
      denominator: 0,
      ratio: null,
      ratioNullReason: "not_collected"
    };
    stubUsage(payload);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("reconciliation-active-rate")).toBeInTheDocument());
    const rate = screen.getByTestId("reconciliation-active-rate");
    expect(rate).toHaveTextContent("未采集");
    expect(rate).not.toHaveTextContent("0.0%");
    expect(rate).not.toHaveTextContent("100.0%");
  });

  it("as-of S 不可证明时显式披露为诊断视图", async () => {
    const payload = usagePayload();
    const data = (payload as { data: Record<string, unknown> }).data;
    data.asOfProof = { ok: false, reason: "missing_ledger_seq" };
    stubUsage(payload);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("reconciliation-asof-incomplete")).toBeInTheDocument()
    );
    expect(screen.getByTestId("reconciliation-asof-incomplete")).toHaveTextContent("诊断视图");
  });

  it("「活跃数超过配置数」不被直接说成数据异常", async () => {
    const payload = usagePayload();
    const data = (payload as { data: Record<string, unknown> }).data;
    (data.tokenReconciliation as { anomaly: Record<string, unknown> }).anomaly = {
      flagged: false,
      reason: "口径未同时一致",
      activeGreaterThanConfigured: true
    };
    stubUsage(payload);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("reconciliation-anomaly")).toBeInTheDocument());
    const anomaly = screen.getByTestId("reconciliation-anomaly");
    expect(anomaly).toHaveTextContent("尚未判定为数据异常");
    expect(anomaly).not.toHaveTextContent("数据异常。");
  });

  it("导出入口指向对账导出端点", async () => {
    stubUsage(usagePayload());
    renderPage();

    await waitFor(() => expect(screen.getByTestId("reconciliation-export")).toBeInTheDocument());
    const href = screen.getByTestId("reconciliation-export").getAttribute("href") ?? "";
    expect(href).toContain("/api/admin/audit/reconciliation/export");
  });

  it("时间范围把对应 hours 带到用量读取和导出", async () => {
    const fetchMock = stubUsage(usagePayload());
    renderPage("/admin/audit-reconciliation?range=24h");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("/usage?") && url.includes("hours=24"))).toBe(true);
    });
    expect(screen.getByTestId("reconciliation-export").getAttribute("href")).toContain("hours=24");

    fireEvent.click(screen.getByTestId("reconciliation-range-30d"));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("hours=720"))).toBe(true);
    });
    expect(screen.getByTestId("reconciliation-export").getAttribute("href")).toContain("hours=720");

    fireEvent.click(screen.getByTestId("reconciliation-range-7d"));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("hours=168"))).toBe(true);
    });
    expect(screen.getByTestId("reconciliation-export").getAttribute("href")).toContain("hours=168");
  });

  it("正式读取 409 后展示诊断缺失，单问询仍按自己的结果渲染", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit/reconciliation/usage") && !url.includes("mode=diagnostic")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "RECONCILIATION_AS_OF_S_UNPROVABLE",
              message: "无法证明基础事实、归属修订、关联与聚合可按账本上界 S 精确重建，正式对账读取失败"
            }
          }),
          { status: 409 }
        );
      }
      if (url.includes("mode=diagnostic")) {
        return new Response(
          JSON.stringify(
            usagePayload({
              asOfProof: {
                ok: false,
                missingTotal: 2,
                dimensions: [
                  { id: "baseFacts", ok: false, missingCount: 1 },
                  { id: "revisions", ok: true, missingCount: 0 },
                  { id: "relations", ok: true, missingCount: 0 },
                  { id: "aggregates", ok: false, missingCount: 1 }
                ]
              }
            })
          ),
          { status: 200 }
        );
      }
      if (url.includes("/inquiries/turn-kept")) {
        return new Response(
          JSON.stringify({ ok: true, data: { inquiry: { turnId: "turn-kept" } } }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, data: { inquiry: {} } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage("/admin/audit-reconciliation?range=7d&turnId=turn-kept");

    await waitFor(() => expect(screen.getByTestId("reconciliation-asof-missing")).toBeInTheDocument());
    expect(screen.getByTestId("reconciliation-asof-incomplete")).toHaveTextContent("诊断视图");
    expect(screen.getByTestId("reconciliation-asof-missing")).toHaveTextContent("缺失 2 项");
    expect(screen.getByTestId("reconciliation-asof-missing")).toHaveTextContent("基础事实 1");
    expect(screen.getByTestId("reconciliation-asof-missing")).toHaveTextContent("聚合 1");
    expect(screen.getByTestId("reconciliation-inquiry-input")).toBeInTheDocument();
    expect(screen.queryByTestId("reconciliation-inquiry-error")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("reconciliation-inquiry-detail")).toHaveTextContent("turn-kept"));
    expect(screen.getByTestId("reconciliation-token-card")).toBeInTheDocument();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/usage?") && url.includes("hours=168") && !url.includes("mode="))).toBe(
      true
    );
    expect(urls.some((url) => url.includes("mode=diagnostic"))).toBe(true);
    expect(urls.some((url) => url.includes("/inquiries/turn-kept"))).toBe(true);
  });

  it("完整使用明细逐行列出并给出分页计数", async () => {
    stubUsage(usagePayload());
    renderPage();

    await waitFor(() => expect(screen.getByTestId("reconciliation-usage-row-1")).toBeInTheDocument());
    expect(screen.getByTestId("reconciliation-usage-row-1")).toHaveTextContent("sl_query");
    expect(screen.getByTestId("reconciliation-usage-paging")).toHaveTextContent("已返回 1 / 匹配 1");
  });

  // ── 2026-11-02：L25-02／03 功能收口的两句产品行为 ────────────────────────

  it("问询详情逐条给出完整表身份，不收成「等 N 个」", async () => {
    const inquiry = {
      turnId: "turn-long-tables",
      tables: {
        complete: LONG_TABLE_IDENTITIES.map((identity) => tableEvidenceOf(identity)),
        unknownBucket: {
          callIds: [],
          callCount: 0,
          reason: "not_collected",
          detail: "调用存在但没有可核验来源引用；来源未知，不从 SQL 文本无条件猜测"
        }
      }
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit/reconciliation/usage")) {
        return new Response(JSON.stringify(usagePayload()), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, data: { inquiry } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage("/admin/audit-reconciliation?range=7d&turnId=turn-long-tables");

    const detail = await screen.findByTestId("reconciliation-inquiry-detail");
    for (const identity of LONG_TABLE_IDENTITIES) {
      expect(detail).toHaveTextContent(identity.connectionId);
      expect(detail).toHaveTextContent(identity.schema);
      expect(detail).toHaveTextContent(identity.table);
    }
    // 截断成「等 N 个」就是信息断点：详情里不许出现这种收口。
    expect(detail.textContent ?? "").not.toMatch(/等\s*\d+\s*个/);
  });

  it("使用概况的表排行列出完整表身份并可复制全文", async () => {
    const ranked = tableEvidenceOf(LONG_TABLE_IDENTITIES[0], 3);
    const payload = usagePayload({
      tables: {
        complete: [ranked],
        incomplete: [],
        unknownBucket: {
          callIds: [],
          callCount: 0,
          reason: "not_collected",
          detail: "调用存在但没有可核验来源引用；来源未知，不从 SQL 文本无条件猜测"
        }
      }
    });
    stubUsage(payload);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
    renderPage();

    const ranking = await screen.findByTestId("reconciliation-table-ranking");
    expect(ranking).toHaveTextContent(ranked.connectionId);
    expect(ranking).toHaveTextContent(ranked.schema);
    expect(ranking).toHaveTextContent(ranked.table);
    expect(ranking.textContent ?? "").not.toMatch(/等\s*\d+\s*个/);

    fireEvent.click(screen.getByTestId("reconciliation-table-copy"));
    await waitFor(() => {
      expect(vi.mocked(navigator.clipboard.writeText)).toHaveBeenCalled();
    });
    const copied = String(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] ?? "");
    expect(copied).toContain(ranked.connectionId);
    expect(copied).toContain(ranked.schema);
    expect(copied).toContain(ranked.table);
  });
});
