// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

function renderAudit(initialEntry = "/admin/audit") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/audit" element={<Audit />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Admin / Audit turns tab (Spec 89)", () => {
  it("defaults to turns tab with split time columns and updated labels (Spec 94)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/agents")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                agents: [{ id: "demo_agent", name: "Demo Agent", enabled: true, tokenCount: 1 }],
                version: 1,
                summary: {}
              }
            })
          );
        }
        if (url.includes("/api/admin/audit/turns")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                total: 1,
                referenceLatency: { windowHours: 168, p95Ms: 120, totalCallsInWindow: 10, slowCallsInFilter: 1 },
                entries: [
                  {
                    id: "inf_test_1",
                    source: "inferred",
                    userId: "demo_agent",
                    startedAt: "2026-08-04T08:00:00.000Z",
                    endedAt: "2026-08-04T08:00:16.000Z",
                    businessCallCount: 2,
                    questionSummary: "推断：查询 superstore",
                    confidence: "medium",
                    tools: ["sl_query"],
                    sources: [{ connectionId: "demo-mysql", physicalTable: "dataforai.superstore_orders" }],
                    turnSpanMs: 16000,
                    totalCallDurationMs: 8200,
                    maxCallDurationMs: 5000,
                    slowCallCount: 1,
                    outcomeSummary: { ok: 2, denied: 0, error: 0 }
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, data: { entries: [], total: 0 } }));
      })
    );

    renderAudit();

    expect(await screen.findByRole("tab", { name: "问询记录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "数据热力" })).not.toBeInTheDocument();
    expect(await screen.findByTestId("audit-turns-table")).toBeInTheDocument();
    expect(screen.getByText("开始时间")).toBeInTheDocument();
    expect(screen.getByText("结束时间")).toBeInTheDocument();
    expect(screen.getByText("工具调用数")).toBeInTheDocument();
    expect(screen.getByText("涉及数据表")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Agent 名称或 ID")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-latency-reference")).not.toBeInTheDocument();
    expect(screen.getByText("Demo Agent (demo_agent)")).toBeInTheDocument();
    expect(screen.getByText("含 1 次慢调用")).toBeInTheDocument();
    expect(screen.queryByText("业务调用")).not.toBeInTheDocument();
  });

  it("shows primary export on calls tab only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/audit/turns")) {
          return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [], referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 } } }));
        }
        if (url.startsWith("/api/admin/audit?")) {
          return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderAudit("/admin/audit?tab=calls");

    expect(await screen.findByRole("tab", { name: "调用流水" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("audit-export-csv")).toHaveClass("pl-btn--primary");
  });

  it("shows page-scoped summary when slowOnly is enabled on calls tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/audit/turns")) {
          return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [], referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 } } }));
        }
        if (url.startsWith("/api/admin/audit?")) {
          return new Response(JSON.stringify({
            ok: true,
            data: {
              total: 25,
              entries: [
                {
                  id: 1,
                  ts: "2026-08-04T08:00:00.000Z",
                  userId: "demo_agent",
                  tool: "sl_query",
                  outcome: "ok",
                  durationMs: 10,
                  tables: []
                }
              ]
            }
          }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderAudit("/admin/audit?tab=calls&slowOnly=1");

    expect(await screen.findByTestId("audit-calls-summary")).toHaveTextContent("本页慢调用 1 条（筛选前共 25 条）");
    expect(screen.getByTestId("audit-pagination-summary")).toHaveTextContent("慢调用筛选：仅统计当前页");
  });

  it("opens turn drawer with indexed call rows and connection column (Spec 94)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/agents")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                agents: [{ id: "demo_agent", name: "Demo Agent", enabled: true, tokenCount: 1 }],
                version: 1,
                summary: {}
              }
            })
          );
        }
        if (url.includes("/api/admin/audit/turns/inf_test_1")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                id: "inf_test_1",
                source: "inferred",
                userId: "demo_agent",
                questionSummary: "推断：查询 superstore",
                accessLogs: [
                  {
                    id: 1,
                    ts: "2026-08-04T08:00:01.000Z",
                    tool: "sl_query",
                    outcome: "ok",
                    durationMs: 5000,
                    isSlowCall: true,
                    tables: ["dataforai.superstore_orders"],
                    connectionId: "demo-mysql"
                  }
                ],
                referenceLatency: { windowHours: 168, p95Ms: 120 }
              }
            })
          );
        }
        if (url.includes("/api/admin/audit/turns")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                total: 1,
                referenceLatency: { windowHours: 168, p95Ms: 120, totalCallsInWindow: 1, slowCallsInFilter: 1 },
                entries: [
                  {
                    id: "inf_test_1",
                    source: "inferred",
                    userId: "demo_agent",
                    startedAt: "2026-08-04T08:00:00.000Z",
                    endedAt: "2026-08-04T08:00:16.000Z",
                    businessCallCount: 1,
                    confidence: "medium",
                    tools: ["sl_query"],
                    sources: [],
                    turnSpanMs: 16000,
                    totalCallDurationMs: 5000,
                    slowCallCount: 1,
                    outcomeSummary: { ok: 1, denied: 0, error: 0 }
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, data: { entries: [], total: 0 } }));
      })
    );

    renderAudit();
    fireEvent.click(await screen.findByTestId("audit-turn-row-inf_test_1"));
    expect(await screen.findByTestId("audit-turn-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("audit-turn-drawer-close")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("数据库连接")).toBeInTheDocument();
      expect(screen.getByText("demo-mysql")).toBeInTheDocument();
      expect(screen.getByText("慢于多数请求")).toBeInTheDocument();
    });
  });
});
