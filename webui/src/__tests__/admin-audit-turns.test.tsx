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

    const viewTabs = await screen.findByTestId("audit-view-tabs");
    expect(viewTabs).toHaveClass("pl-segmented-control", "pl-segmented-control--cols-2");
    expect(screen.getByTestId("audit-tab-turns")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("audit-tab-turns")).toHaveClass("pl-segmented-control-item--active");
    expect(screen.getByTestId("audit-tab-calls")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("audit-tab-calls").className).not.toMatch(/pl-segmented-control-item--active/);
    expect(screen.queryByRole("tab", { name: "数据热力" })).not.toBeInTheDocument();
    const turnsTable = await screen.findByTestId("audit-turns-table");
    expect(turnsTable).toHaveClass("pl-data-grid", "pl-audit-table");
    expect(turnsTable.querySelector("td.pl-audit-table-muted")).not.toBeNull();
    expect(screen.getByText("开始时间")).toBeInTheDocument();
    expect(screen.getByText("结束时间")).toBeInTheDocument();
    expect(screen.getByText("工具调用数")).toBeInTheDocument();
    expect(screen.getByText("涉及数据表")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Agent 名称或 ID")).toBeInTheDocument();
    expect(screen.getByTestId("audit-time-label")).toHaveTextContent("时间");
    const sinceInput = screen.getByTestId("audit-since") as HTMLInputElement;
    expect(sinceInput.value).toMatch(/:00$/);
    expect(screen.queryByTestId("audit-latency-reference")).not.toBeInTheDocument();
    expect(screen.getByText("Demo Agent (demo_agent)")).toBeInTheDocument();
    expect(screen.getByText("含 1 次慢调用")).toBeInTheDocument();
    expect(screen.queryByText("业务调用")).not.toBeInTheDocument();
  });

  it("shows primary export on both tabs (Spec 106 header parity)", async () => {
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

    renderAudit("/admin/audit?view=calls&range=7d");

    expect(await screen.findByTestId("audit-tab-calls")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("audit-export-csv")).toHaveClass("pl-btn--primary");

    cleanup();
    renderAudit("/admin/audit?range=7d");
    expect(await screen.findByTestId("audit-tab-turns")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("audit-export-csv")).toHaveClass("pl-btn--primary");
  });

  it("exposes identity columns, shared filters, and accepts legacy hours URL (Spec 106)", async () => {
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
          expect(url).toMatch(/hours=168/);
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                total: 1,
                referenceLatency: { windowHours: 168, p95Ms: 120, totalCallsInWindow: 10, slowCallsInFilter: 0 },
                entries: [
                  {
                    id: "inf_test_1",
                    source: "inferred",
                    userId: "demo_agent",
                    startedAt: "2026-08-04T08:00:00.000Z",
                    endedAt: "2026-08-04T08:00:16.000Z",
                    businessCallCount: 1,
                    questionSummary: "推断：查询",
                    confidence: "medium",
                    tools: ["sl_query"],
                    sources: [{ physicalTable: "dataforai.superstore_orders" }],
                    turnSpanMs: 16000,
                    totalCallDurationMs: 100,
                    maxCallDurationMs: 100,
                    slowCallCount: 0,
                    outcomeSummary: { ok: 1, denied: 0, error: 0 }
                  }
                ]
              }
            })
          );
        }
        if (url.startsWith("/api/admin/audit?")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                total: 1,
                entries: [
                  {
                    id: 42,
                    ts: "2026-08-04T08:00:00.000Z",
                    userId: "demo_agent",
                    tool: "sl_query",
                    outcome: "ok",
                    durationMs: 10,
                    tables: ["dataforai.superstore_orders"],
                    lucyTurnId: "inf_test_1",
                    requestId: 1
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, data: { entries: [], total: 0 } }));
      })
    );

    renderAudit("/admin/audit?hours=168");
    expect(await screen.findByTestId("audit-shared-filters")).toBeInTheDocument();
    expect(screen.getByTestId("audit-key-search")).toBeInTheDocument();
    const turnsTable = await screen.findByTestId("audit-turns-table");
    expect(screen.getByRole("columnheader", { name: "问询 ID" })).toBeInTheDocument();
    expect(turnsTable.querySelector("th.w-14.whitespace-nowrap")).not.toBeNull();
    expect(screen.getByTestId("audit-turn-id-inf_test_1")).toHaveTextContent("inf_test_1");
    expect(screen.getByTestId("audit-export-csv")).toBeInTheDocument();

    cleanup();
    renderAudit("/admin/audit?tab=calls&hours=168");
    expect(await screen.findByTestId("audit-calls-table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "事件 ID" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "序号" })).toBeInTheDocument();
    expect(screen.getByTestId("audit-event-id-42")).toHaveTextContent("42");
    expect(screen.getByTestId("audit-call-turn-id-42")).toHaveTextContent("inf_test_1");
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
