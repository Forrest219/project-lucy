// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Monitor } from "../pages/eval/Monitor";

function renderMonitor() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <Monitor />
    </QueryClientProvider>
  );
}

function stubMonitorFetch({ empty = false }: { empty?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/eval/domains") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { domains: [{ domain: "superstore", filePath: "evals/superstore", caseCount: 2 }] }
        })
      );
    }
    if (url === "/api/eval/monitor/config" && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true, data: {} }));
    }
    if (url.startsWith("/api/eval/monitor/trend")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            thresholds: { yellow: 0.9, red: 0.8 },
            points: empty
              ? []
              : [
                  { date: "2026-06-19", passRate: 0.75, totalRuns: 3 },
                  { date: "2026-06-18", passRate: 0.95, totalRuns: 2 }
                ]
          }
        })
      );
    }
    if (url.startsWith("/api/eval/monitor/top-failures")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { items: empty ? [] : [{ caseId: "case_sales", failCount: 2, lastFailAt: "2026-06-19T00:00:00.000Z" }] }
        })
      );
    }
    if (url.startsWith("/api/eval/monitor/drift-distribution")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { items: empty ? [] : [{ drift: "sql_changed", count: 4 }] }
        })
      );
    }
    if (url === "/api/eval/monitor/config") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            config: {
              domains: {
                superstore: { passRateYellow: 0.9, passRateRed: 0.8, consecutiveFailThreshold: 3 }
              }
            }
          }
        })
      );
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

describe("Monitor", () => {
  it("renders metrics dashboard and sourced monitor sections", async () => {
    stubMonitorFetch();
    renderMonitor();

    expect(await screen.findByRole("heading", { name: "趋势监控" })).toBeInTheDocument();
    expect(screen.getByText("最新通过率")).toBeInTheDocument();
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("红线状态")).toBeInTheDocument();
    expect(screen.getByText("sql_changed")).toBeInTheDocument();
    expect(screen.getByText("case_sales")).toBeInTheDocument();
  });

  it("shows stable empty states for trend, drift and top failures", async () => {
    stubMonitorFetch({ empty: true });
    renderMonitor();

    expect(await screen.findByText("暂无数据")).toBeInTheDocument();
    expect(screen.getByText("暂无 drift 数据")).toBeInTheDocument();
    expect(screen.getByText("暂无失败 case")).toBeInTheDocument();
  });

  it("uses segmented day control to refetch dashboard data", async () => {
    const fetchMock = stubMonitorFetch();
    renderMonitor();

    expect(await screen.findByRole("heading", { name: "趋势监控" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "90d" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("days=90"))).toBe(true);
    });
  });

  it("saves edited thresholds via PUT and clamps out-of-range values", async () => {
    const fetchMock = stubMonitorFetch();
    renderMonitor();

    expect(await screen.findByRole("heading", { name: "趋势监控" })).toBeInTheDocument();
    fireEvent.change(await screen.findByDisplayValue("90"), { target: { value: "85" } });
    fireEvent.change(await screen.findByDisplayValue("3"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "保存阈值" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
      const body = JSON.parse(String(putCall?.[1]?.body));
      expect(body.config.domains.superstore.passRateYellow).toBe(0.85);
      expect(body.config.domains.superstore.consecutiveFailThreshold).toBe(20);
    });
  });
});
