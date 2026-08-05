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
            calls: 2,
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
          tokens: [{
            agentId: "agent-a",
            label: "active-token",
            tokenHashPrefix: "abc123def456",
            lastUsed: "2026-08-03T01:00:00.000Z",
            activeInWindow: true,
            configured: true,
            auditHref: "/admin/audit?user=agent-a"
          }]
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
  it("renders usage-first overview without risk modules or governance-branded title", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole("heading", { name: "使用概况" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "治理概览" })).not.toBeInTheDocument();
    expect(await screen.findByText("Agent A")).toBeInTheDocument();

    expect(screen.getByTestId("governance-usage-overview")).toHaveClass("pl-page-stack");
    expect(screen.getByTestId("governance-usage-metrics")).toHaveClass("pl-metric-grid");
    expect(screen.getByTestId("governance-usage-metrics")).not.toHaveClass("pl-metric-grid--three");
    expect(screen.getByTestId("governance-agent-usage")).toHaveClass("pl-panel");
    expect(screen.getByTestId("governance-token-usage")).toHaveClass("pl-panel");
    expect(screen.getByTestId("governance-popular-tables")).toHaveClass("pl-panel");

    expect(screen.getByTestId("metric-agent-count")).toHaveTextContent("总数");
    expect(screen.getByTestId("metric-active-agent-count")).toHaveTextContent("活跃");
    expect(screen.getByTestId("metric-active-agent-count")).toHaveTextContent("50%");
    expect(screen.getByTestId("metric-configured-token-count")).toHaveTextContent("配置");
    expect(screen.getByTestId("metric-active-token-count")).toHaveTextContent("活跃");
    expect(screen.getByTestId("metric-configured-table-count")).toHaveTextContent("配置表");
    expect(screen.getByTestId("metric-active-table-count")).toHaveTextContent("活跃表");
    expect(screen.getByTestId("metric-calls")).toHaveTextContent("调用量");
    expect(screen.getByTestId("metric-p95-latency")).toHaveTextContent("响应上限");
    expect(within(screen.getByTestId("metric-configured-token-count")).getByText("Token")).toBeInTheDocument();

    // No standalone active-rate cards; rate lives inside the active Agent/Token cards.
    expect(screen.queryByTestId("metric-agent-active-rate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("metric-token-active-rate")).not.toBeInTheDocument();
    // avg latency is no longer the primary KPI.
    expect(screen.queryByTestId("metric-avg-latency")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("governance-usage-metrics")).queryByText("平均响应时长")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Agent 使用排行" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Token 使用摘要" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最受访问表（Top 10）" })).toBeInTheDocument();
    expect(screen.getByText("active-token")).toBeInTheDocument();
    expect(screen.getByText("mysql.dataforai.kx_fact_financial_amount")).toBeInTheDocument();

    // Spec 82: light pl-data-grid conformance for the three usage tables.
    for (const testId of [
      "governance-agent-table",
      "governance-token-table",
      "governance-popular-tables-table"
    ] as const) {
      const table = screen.getByTestId(testId);
      expect(table).toHaveClass("pl-data-grid");
      expect(table).toHaveClass("pl-usage-overview-table");
      expect(table.className).not.toMatch(/min-w-full/);
      expect(table.className).not.toMatch(/divide-y/);
    }
    expect(screen.getByRole("link", { name: "查看日志" })).toHaveClass("pl-row-action-link");

    expect(screen.queryByText("Role 边界")).not.toBeInTheDocument();
    expect(screen.queryByText("拒绝原因")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 风险排行")).not.toBeInTheDocument();
    expect(screen.queryByText("Token 巡检")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("governance-token-usage")).queryByText("Token 活跃率")).not.toBeInTheDocument();
    expect(screen.queryByText(/select \*/i)).not.toBeInTheDocument();

    // Top bar no longer carries a redundant window badge or a second 访问日志 entry.
    expect(screen.queryByTestId("governance-window-badge")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "访问日志" })).not.toBeInTheDocument();

    // Hints must stay user-friendly; no raw implementation identifiers.
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toMatch(/access_log/);
    expect(bodyText).not.toMatch(/AVG\(/);
    expect(bodyText).not.toMatch(/去重 prefix/);
  });

  it("switches window and refreshes usage queries, keeping window text in hints", async () => {
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
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      return url.includes("hours=24");
    })).toBe(true);
  });
});
