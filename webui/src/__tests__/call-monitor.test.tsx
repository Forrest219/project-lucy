// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { buildAuditCallsHref, CallMonitor, formatFailureTime } from "../pages/ops/CallMonitor";

const fetchMock = vi.fn();

function seriesPoint(index: number, calls = 0) {
  return {
    start: new Date(Date.UTC(2026, 9, 11, index)).toISOString(),
    businessCalls: calls,
    okCalls: calls,
    errorCalls: 0,
    deniedCalls: 0,
    successRate: calls > 0 ? 1 : null,
    errorRate: calls > 0 ? 0 : null,
    deniedRate: calls > 0 ? 0 : null,
    p95Ms: calls >= 20 ? 100 : null,
    slowCalls: 0
  };
}

function monitorPayload(businessCalls: number) {
  return {
    generatedAt: new Date().toISOString(),
    window: {
      range: "24h",
      timeZone: "Asia/Shanghai",
      bucket: "hour",
      bucketCount: 24,
      since: new Date().toISOString(),
      until: new Date().toISOString(),
      slowMs: businessCalls > 0 ? 1000 : 30000
    },
    series: Array.from({ length: 24 }, (_, index) => seriesPoint(index, index === 23 ? businessCalls : 0)),
    traffic: {
      businessCalls,
      okCalls: businessCalls > 0 ? 6 : 0,
      errorCalls: businessCalls > 0 ? 2 : 0,
      deniedCalls: businessCalls > 0 ? 2 : 0,
      successRate: businessCalls > 0 ? 0.6 : 0,
      errorRate: businessCalls > 0 ? 0.2 : 0,
      deniedRate: businessCalls > 0 ? 0.2 : 0
    },
    latency: {
      p50Ms: businessCalls > 0 ? 40 : null,
      p95Ms: businessCalls > 0 ? 2200 : null,
      slowCalls: businessCalls > 0 ? 3 : 0
    },
    slo: {
      thresholds: { p95LatencyMs: businessCalls > 0 ? 1000 : 30000, maxErrorRate: 0.02, maxDeniedRate: 0.1 },
      status: businessCalls > 0 ? "warn" : "no_data",
      violations: businessCalls > 0 ? ["error_rate", "denied_rate", "latency_p95"] : []
    },
    topTools: businessCalls > 0 ? [{ tool: "lucy_query", calls: 8, errors: 2, denied: 1 }] : [],
    recentFailures: businessCalls > 0
      ? [{
          id: 9,
          ts: "2026-09-24T01:00:00.000Z",
          tool: "lucy_query",
          outcome: "error" as const,
          durationMs: 1200,
          userId: "agent-a",
          requestId: "req-1",
          traceId: "trace-1"
        }]
      : []
  };
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ ok: true, data })
  };
}

function renderPage(initial = "/ops/calls?range=24h") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/ops/calls" element={<CallMonitor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("buildAuditCallsHref", () => {
  it("builds Spec 143 deep links for audit calls", () => {
    expect(buildAuditCallsHref({ range: "24h", outcome: "error" })).toBe(
      "/admin/audit?view=calls&range=24h&outcome=error"
    );
    expect(buildAuditCallsHref({ range: "1h", tool: "lucy_query", slowOnly: true })).toBe(
      "/admin/audit?view=calls&range=1h&tool=lucy_query&slowOnly=1"
    );
    expect(buildAuditCallsHref({ range: "30d", outcome: "denied" })).toBe(
      "/admin/audit?view=calls&range=30d&outcome=denied"
    );
  });
});

describe("formatFailureTime", () => {
  const now = new Date(2026, 9, 12, 21, 20, 55);

  it("shows only the clock when the failure is on the same local day", () => {
    const time = formatFailureTime(new Date(2026, 9, 12, 14, 36, 48).toISOString(), now);
    expect(time.visible).toBe("14:36:48");
    expect(time.full).toBe("2026-10-12 14:36:48");
  });

  it("keeps the date when the failure is on another local day", () => {
    const time = formatFailureTime("2026-09-24T01:00:00.000Z", now);
    expect(time.visible).toBe(time.full);
    expect(time.visible).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(time.visible.startsWith("2026-10-12")).toBe(false);
  });

  it("returns the raw value when the timestamp cannot be parsed", () => {
    expect(formatFailureTime("not-a-time", now)).toEqual({ visible: "not-a-time", full: "not-a-time" });
  });
});

describe("CallMonitor page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders KPIs, sparklines, rankings and audit deep links", async () => {
    fetchMock.mockResolvedValue(jsonResponse(monitorPayload(10)));

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("call-monitor-kpi-volume")).toHaveTextContent("10");
    });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["近 1 小时", "近 24 小时", "近 7 天", "近 30 天"]);
    expect(screen.getByTestId("call-monitor-range-24h")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("call-monitor-stats-time")).not.toBeInTheDocument();
    expect(screen.queryByTestId("call-monitor-slo-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-header")).not.toHaveTextContent("统计时间");
    expect(screen.getByTestId("call-monitor-kpi-error")).toHaveClass("pl-metric-card--warning");
    expect(screen.getByTestId("call-monitor-kpi-denied")).toHaveClass("pl-metric-card--warning");
    expect(screen.getByTestId("call-monitor-kpi-p95")).toHaveClass("pl-metric-card--warning");
    expect(screen.getByRole("heading", { name: "调用监控" })).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-usage-slow-mark")).toHaveTextContent("问询慢标记自");
    expect(screen.getByTestId("call-monitor-usage-slow-mark")).toHaveTextContent("2026-10-12");
    expect(screen.getByText("慢于多数请求")).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-sparkline-volume")).toHaveAttribute("aria-label", "近 24 小时调用量，近 24 小时，按小时");
    expect(screen.getByTestId("call-monitor-sparkline-success")).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-sparkline-error")).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-sparkline-denied")).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-sparkline-p95")).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-sparkline-slow")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("趋势图");
    expect(screen.getByTestId("call-monitor-tool-lucy_query")).toHaveAttribute(
      "href",
      "/admin/audit?view=calls&range=24h&tool=lucy_query"
    );
    expect(screen.getByTestId("call-monitor-link-errors")).toHaveAttribute(
      "href",
      "/admin/audit?view=calls&range=24h&outcome=error"
    );
    expect(screen.getByTestId("call-monitor-kpi-volume").querySelector("small")).toBeNull();
    expect(screen.getByTestId("call-monitor-kpi-volume")).toHaveTextContent("近 24 小时调用量");
    expect(screen.getByTestId("call-monitor-auto-refresh").closest("label")).toHaveTextContent("每 30 秒刷新");
    expect(screen.queryByText("自动刷新")).not.toBeInTheDocument();
    const failure = screen.getByTestId("call-monitor-failure-9");
    const failureTime = formatFailureTime("2026-09-24T01:00:00.000Z");
    expect(failure).toHaveTextContent(failureTime.visible);
    expect(failure).toHaveAttribute("title", failureTime.full);
    expect(failure).toHaveAttribute("aria-label", failureTime.full);
    expect(screen.getByTestId("call-monitor-auto-refresh")).toBeChecked();
    expect(document.body.textContent ?? "").not.toContain("活跃率");

    fireEvent.click(screen.getByTestId("call-monitor-range-7d"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("range=7d"))).toBe(true);
    });
    expect(screen.getByTestId("call-monitor-auto-refresh")).toBeChecked();

    fireEvent.click(screen.getByTestId("call-monitor-range-30d"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("range=30d"))).toBe(true);
    });
    expect(screen.getByTestId("call-monitor-auto-refresh")).toBeChecked();
  });

  it("shows empty state when there are no business calls", async () => {
    fetchMock.mockResolvedValue(jsonResponse(monitorPayload(0)));

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("call-monitor-empty")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("call-monitor-sparkline-volume")).not.toBeInTheDocument();
    expect(screen.queryByTestId("call-monitor-stats-time")).not.toBeInTheDocument();
    expect(screen.queryByTestId("call-monitor-slo-status")).not.toBeInTheDocument();
  });

  it("keeps the 24 hour tab when the legacy hours query is 168", async () => {
    fetchMock.mockResolvedValue(jsonResponse(monitorPayload(1)));
    renderPage("/ops/calls?hours=168");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("range=24h"))).toBe(true);
    });
    expect(screen.getByTestId("call-monitor-range-24h")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("call-monitor-range-7d")).toHaveAttribute("aria-selected", "false");
  });

  it("does not treat the first load as an empty window", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.queryByText("所选范围内无数据")).not.toBeInTheDocument();
    expect(screen.queryByTestId("call-monitor-sparkline-volume")).not.toBeInTheDocument();
  });

  it("keeps the last snapshot when a later refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(monitorPayload(10)));
    renderPage();
    await screen.findByText("10");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: { code: "unavailable", message: "上游不可用" } })
    });
    fireEvent.click(screen.getByTestId("call-monitor-refresh"));
    expect(await screen.findByText(/本次刷新失败：上游不可用/)).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-kpi-volume")).toHaveTextContent("10");
    expect(screen.getByTestId("call-monitor-kpi-volume")).not.toHaveAttribute("data-metric-state", "unavailable");
    expect(screen.getByTestId("call-monitor-sparkline-volume")).toBeInTheDocument();
  });

  it("shows a load failure when the first request fails", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: { code: "unavailable", message: "库不可用" } })
    });
    renderPage();
    expect(await screen.findByText(/调用监控加载失败：库不可用/)).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-kpi-volume")).toHaveAttribute("data-metric-state", "unavailable");
    expect(screen.queryByTestId("call-monitor-sparkline-volume")).not.toBeInTheDocument();
  });
});
