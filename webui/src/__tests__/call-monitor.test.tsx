// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { buildAuditCallsHref, CallMonitor } from "../pages/ops/CallMonitor";

const fetchMock = vi.fn();

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

  it("renders KPIs, SLO warning, rankings and audit deep links", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          generatedAt: new Date().toISOString(),
          window: { range: "24h", hours: 24, since: new Date().toISOString(), slowMs: 1000 },
          traffic: {
            businessCalls: 10,
            okCalls: 6,
            errorCalls: 2,
            deniedCalls: 2,
            successRate: 0.6,
            errorRate: 0.2,
            deniedRate: 0.2
          },
          latency: { p50Ms: 40, p95Ms: 2200, slowCalls: 3 },
          slo: {
            thresholds: { p95LatencyMs: 1000, maxErrorRate: 0.02, maxDeniedRate: 0.1 },
            status: "warn",
            violations: ["error_rate", "denied_rate", "latency_p95"]
          },
          topTools: [{ tool: "lucy_query", calls: 8, errors: 2, denied: 1 }],
          recentFailures: [
            {
              id: 9,
              ts: "2026-09-24T01:00:00.000Z",
              tool: "lucy_query",
              outcome: "error",
              durationMs: 1200,
              userId: "agent-a",
              requestId: "req-1",
              traceId: "trace-1"
            }
          ]
        }
      })
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("call-monitor-slo-status")).toHaveTextContent("需关注");
    });
    expect(screen.getByRole("heading", { name: "调用监控" })).toBeInTheDocument();
    expect(screen.getByTestId("call-monitor-kpi-volume")).toHaveTextContent("10");
    expect(screen.getByTestId("call-monitor-tool-lucy_query")).toHaveAttribute(
      "href",
      "/admin/audit?view=calls&range=24h&tool=lucy_query"
    );
    expect(screen.getByTestId("call-monitor-link-errors")).toHaveAttribute(
      "href",
      "/admin/audit?view=calls&range=24h&outcome=error"
    );
    expect(screen.getByTestId("call-monitor-auto-refresh")).toBeChecked();

    fireEvent.click(screen.getByTestId("call-monitor-range-1h"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("range=1h"))).toBe(true);
    });
  });

  it("shows empty state when there are no business calls", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          generatedAt: new Date().toISOString(),
          window: { range: "24h", hours: 24, since: new Date().toISOString(), slowMs: 30000 },
          traffic: {
            businessCalls: 0,
            okCalls: 0,
            errorCalls: 0,
            deniedCalls: 0,
            successRate: 0,
            errorRate: 0,
            deniedRate: 0
          },
          latency: { p50Ms: null, p95Ms: null, slowCalls: 0 },
          slo: {
            thresholds: { p95LatencyMs: 30000, maxErrorRate: 0.02, maxDeniedRate: 0.1 },
            status: "no_data",
            violations: []
          },
          topTools: [],
          recentFailures: []
        }
      })
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("call-monitor-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("call-monitor-slo-status")).toHaveTextContent("暂无数据");
  });
});
