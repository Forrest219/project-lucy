// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GovernanceOverview } from "../pages/admin/GovernanceOverview";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GovernanceOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const hours = Number(new URL(url, "http://localhost").searchParams.get("hours") ?? "168");
    if (url.includes("/api/admin/governance/overview")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          windowHours: hours,
          localAdminNotice: "local-admin mode",
          usageOverview: {
            agentCount: 2,
            activeAgentCount: 1,
            agentActiveRate: 50,
            configuredTokenCount: 2,
            activeTokenCount: 1,
            tokenActiveRate: 50,
            configuredTableCount: 4,
            activeTableCount: hours === 24 ? 1 : 2,
            hasOpenEndedTableScope: false,
            calls: hours === 24 ? 1 : 3,
            p95LatencyMs: hours === 24 ? 40 : 120,
            avgLatencyMs: hours === 24 ? 40 : 70
          },
          popularTables: [{
            table: "mysql.dataforai.kx_fact_financial_amount",
            calls: hours === 24 ? 1 : 2,
            lastSeen: "2026-08-03T01:00:00.000Z"
          }],
          tableStatsSource: "access_log_sources",
          cards: {
            calls: hours === 24 ? 1 : 3,
            deniedRate: 33.3
          }
        }
      }));
    }
    if (url.includes("/api/admin/governance/agents")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          agents: [{
            id: "agent-a",
            name: "Agent A",
            enabled: true,
            roleId: "finance_readonly",
            calls: hours === 24 ? 1 : 3,
            avgLatencyMs: hours === 24 ? 40 : 70,
            lastSeen: "2026-08-03T01:00:00.000Z",
            activeTokenCount: 1,
            configuredTokenCount: 2,
            auditHref: "/admin/audit?user=agent-a",
            agentHref: "/admin/agents/agent-a"
          }]
        }
      }));
    }
    if (url.includes("/api/admin/governance/tokens")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tokens: [
            {
              agentId: "agent-a",
              label: "quiet-token",
              tokenHashPrefix: "quietprefix12",
              lastUsed: "2026-08-04T01:00:00.000Z",
              calls: hours === 24 ? 0 : 1,
              activeInWindow: hours !== 24,
              configured: true,
              auditHref: "/admin/audit?user=agent-a"
            },
            {
              agentId: "agent-a",
              label: "active-token",
              tokenHashPrefix: "abc123def456",
              lastUsed: "2026-08-03T01:00:00.000Z",
              calls: hours === 24 ? 1 : 5,
              activeInWindow: true,
              configured: true,
              auditHref: "/admin/audit?user=agent-a"
            }
          ]
        }
      }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GovernanceOverview", () => {
  it("renders usage-first overview with windowed KPI titles and call rankings", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole("heading", { name: "使用概况" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "治理概览" })).not.toBeInTheDocument();
    expect(await screen.findByText("Agent A")).toBeInTheDocument();

    expect(screen.getByTestId("governance-usage-overview")).toHaveClass("pl-page-stack");
    expect(screen.getByTestId("governance-usage-metrics")).toHaveClass("pl-usage-metric-groups");
    for (const groupTestId of [
      "governance-usage-metrics-config",
      "governance-usage-metrics-active",
      "governance-usage-metrics-operations"
    ] as const) {
      expect(screen.getByTestId(groupTestId)).toHaveClass("pl-metric-grid", "pl-metric-grid--three");
      expect(screen.getByTestId(groupTestId).querySelectorAll(":scope > .pl-metric-card")).toHaveLength(3);
    }
    expect(screen.getByTestId("governance-usage-rank-grid")).toHaveClass("pl-usage-rank-grid");
    expect(screen.getByTestId("governance-agent-usage")).toHaveClass("pl-panel");
    expect(screen.getByTestId("governance-token-usage")).toHaveClass("pl-panel");
    expect(screen.getByTestId("governance-popular-tables")).toHaveClass("pl-panel");

    expect(screen.getByTestId("metric-agent-count")).toHaveTextContent("总数");
    expect(screen.getByTestId("metric-active-agent-count")).toHaveTextContent("近 7 天活跃");
    expect(screen.getByTestId("metric-active-agent-count")).toHaveTextContent("50%");
    expect(screen.getByTestId("metric-configured-token-count")).toHaveTextContent("配置");
    expect(screen.getByTestId("metric-active-token-count")).toHaveTextContent("近 7 天活跃");
    expect(screen.getByTestId("metric-configured-table-count")).toHaveTextContent("授权表");
    expect(screen.getByTestId("metric-active-table-count")).toHaveTextContent("近 7 天活跃表");
    expect(screen.getByTestId("metric-calls")).toHaveTextContent("近 7 天调用量");
    expect(screen.getByTestId("metric-acl-denied")).toHaveTextContent("近 7 天 ACL 拒绝次数");
    expect(screen.getByTestId("metric-p95-latency")).toHaveTextContent("多数请求耗时");

    const metricOrder = Array.from(
      screen.getByTestId("governance-usage-metrics").querySelectorAll(":scope .pl-metric-card")
    ).map((card) => card.getAttribute("data-testid"));
    expect(metricOrder).toEqual([
      "metric-agent-count",
      "metric-configured-token-count",
      "metric-configured-table-count",
      "metric-active-agent-count",
      "metric-active-token-count",
      "metric-active-table-count",
      "metric-calls",
      "metric-acl-denied",
      "metric-p95-latency"
    ]);
    expect(within(screen.getByTestId("metric-configured-token-count")).getByText("Token")).toBeInTheDocument();
    expect(screen.getByTestId("metric-help-agent-count")).toBeInTheDocument();
    expect(screen.getByTestId("metric-help-p95-latency")).toBeInTheDocument();
    expect(screen.getByTestId("metric-agent-count")).toHaveClass("pl-metric-card--with-help");
    expect(screen.getByTestId("metric-active-agent-count").querySelectorAll(":scope > small")).toHaveLength(1);

    expect(screen.queryByTestId("metric-agent-active-rate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("metric-token-active-rate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("metric-avg-latency")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("governance-usage-metrics")).queryByText("平均响应时长")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("metric-active-agent-count")).queryByText(/有调用/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("governance-usage-metrics")).queryByText("配置表")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("governance-usage-metrics")).queryByText("响应上限")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: /Agent 调用排行 · 近 7 天/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Token 调用排行 · 近 7 天/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /表调用排行 · 近 7 天/ })).toBeInTheDocument();
    expect(screen.getByText("active-token")).toBeInTheDocument();
    expect(screen.getByText("quiet-token")).toBeInTheDocument();
    expect(screen.getByText("mysql.dataforai.kx_fact_financial_amount")).toBeInTheDocument();

    const tokenRank = screen.getByTestId("governance-token-rank");
    const tokenLabels = within(tokenRank).getAllByRole("link").map((node) => node.textContent);
    expect(tokenLabels[0]).toBe("active-token");
    expect(tokenLabels[1]).toBe("quiet-token");

    for (const testId of [
      "governance-agent-rank",
      "governance-token-rank",
      "governance-table-rank"
    ] as const) {
      expect(screen.getByTestId(testId)).toHaveClass("pl-usage-rank-list");
      expect(screen.getByTestId(`${testId}-body`)).toHaveClass("pl-usage-rank-body");
    }
    expect(screen.queryByTestId("governance-agent-table")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看日志" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "管理角色" })).not.toBeInTheDocument();

    const controls = screen.getByTestId("governance-stats-time-controls");
    expect(controls).toHaveClass("flex", "items-center", "gap-3");
    const statsTime = screen.getByTestId("governance-stats-time");
    expect(statsTime).toHaveTextContent(/^统计时间：/);
    expect(statsTime).toHaveAttribute("aria-hidden", "true");
    expect(within(controls).getByTestId("governance-stats-time").compareDocumentPosition(
      within(controls).getByRole("tablist", { name: "时间窗口" })
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const windowGroup = screen.getByRole("tablist", { name: "时间窗口" });
    expect(windowGroup).toHaveClass("pl-segmented-control");
    expect(windowGroup).toHaveClass("pl-segmented-control--cols-2");
    expect(screen.getByTestId("governance-window-7d")).toHaveClass("pl-segmented-control-item--active");
    expect(screen.getByTestId("governance-window-7d").className).not.toMatch(/pl-btn--primary/);

    expect(screen.queryByText("Role 边界")).not.toBeInTheDocument();
    expect(screen.queryByText("拒绝原因")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 风险排行")).not.toBeInTheDocument();
    expect(screen.queryByText("Token 巡检")).not.toBeInTheDocument();
    expect(screen.queryByText(/近窗口/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不重复展示顶部 KPI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/仅统计已结构化/)).not.toBeInTheDocument();
    expect(screen.queryByText(/select \*/i)).not.toBeInTheDocument();

    expect(screen.queryByTestId("governance-window-badge")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "访问日志" })).not.toBeInTheDocument();

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/access_log/);
    expect(bodyText).not.toMatch(/AVG\(/);
    expect(bodyText).not.toMatch(/去重 prefix/);
  });

  it("switches window and refreshes usage queries, keeping window text in titles", async () => {
    const fetchMock = stubFetch();
    renderPage();

    await screen.findByText("Agent A");
    await waitFor(() => {
      expect(within(screen.getByTestId("metric-calls")).getByText("3")).toBeInTheDocument();
      expect(within(screen.getByTestId("metric-p95-latency")).getByText("120 ms")).toBeInTheDocument();
    });
    expect(within(screen.getByTestId("metric-active-agent-count")).getByText(/近 7 天/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("governance-window-24h"));

    await waitFor(() => {
      expect(within(screen.getByTestId("metric-calls")).getByText("1")).toBeInTheDocument();
      expect(within(screen.getByTestId("metric-p95-latency")).getByText("40 ms")).toBeInTheDocument();
    });
    expect(within(screen.getByTestId("metric-active-agent-count")).getByText(/近 24 小时/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Agent 调用排行 · 近 24 小时/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      return url.includes("hours=24");
    })).toBe(true);
  });
});
