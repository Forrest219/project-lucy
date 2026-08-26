// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: toastMock
}));

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

function renderAuditWithProbe(initialEntry: string) {
  function Probe() {
    const location = useLocation();
    return <div data-testid="probe-location" data-search={location.search} />;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/admin/audit"
            element={
              <>
                <Audit />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubEmptyAuditApis() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } }));
      }
      if (url.includes("/api/admin/audit/turns")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 0,
              entries: [],
              summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
              referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
            }
          })
        );
      }
      if (url.startsWith("/api/admin/audit")) {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  window.localStorage.clear();
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
                summary: { reportedCount: 0, inferredCount: 1, reportedShare: 0 },
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
    const turnsFrame = screen.getByTestId("audit-turns-grid-frame");
    expect(turnsFrame).toHaveClass("pl-data-grid-frame");
    const turnsRegion = screen.getByRole("region", {
      name: "问询记录表格，可横向和纵向滚动"
    });
    expect(turnsRegion).toHaveClass("pl-data-grid-scroll", "pl-audit-grid-scroll");
    expect(turnsRegion).toHaveAttribute("tabindex", "0");
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
    expect(screen.getByTestId("audit-turns-coverage-summary")).toHaveTextContent("已上报问询 0");
    expect(screen.getByTestId("audit-turns-coverage-summary")).toHaveTextContent("推断问询 1");
    expect(screen.getByTestId("audit-turns-coverage-hint")).toHaveTextContent("用户原文依赖客户端可选上报");
  });

  it("wraps 调用流水 in the shared bounded scroll frame with investigation column order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/agents")) {
          return new Response(JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } }));
        }
        if (url.includes("/api/admin/audit/turns")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                total: 0,
                entries: [],
                summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
                referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
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
                summary: { businessCalls: 1, protocolCalls: 0, deniedCalls: 0, dataBearingCalls: 1 },
                entries: [
                  {
                    id: 42,
                    ts: "2026-08-26T06:00:00.000Z",
                    userId: "demo_agent",
                    clientIp: "203.0.113.9",
                    userAgent: "Cursor/1.0",
                    tool: "lucy_query",
                    outcome: "ok",
                    durationMs: 12,
                    requestId: "req-42",
                    decisionReason: "allowed"
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderAudit("/admin/audit?view=calls&range=7d");

    const callsFrame = await screen.findByTestId("audit-calls-grid-frame");
    expect(callsFrame).toHaveClass("pl-data-grid-frame");
    const callsRegion = screen.getByRole("region", {
      name: "调用流水表格，可横向和纵向滚动"
    });
    expect(callsRegion).toHaveClass("pl-data-grid-scroll", "pl-audit-grid-scroll");
    expect(callsRegion).toHaveAttribute("tabindex", "0");

    const table = screen.getByTestId("audit-calls-table");
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim());
    expect(headers.slice(0, 7)).toEqual([
      "序号",
      "时间",
      "事件 ID",
      "问询 ID",
      "Agent",
      "访问上下文",
      "状态"
    ]);
    expect(headers).toContain("涉及数据表");
    expect(headers).toContain("访问上下文");
    expect(screen.getByTestId("audit-access-context-42")).toHaveTextContent("203.0.113.9");
  });

  it("shows primary export on both tabs (Spec 106 header parity)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/admin/audit/turns")) {
          return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [], summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 }, referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 } } }));
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
                summary: { reportedCount: 0, inferredCount: 1, reportedShare: 0 },
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
          return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [], summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 }, referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 } } }));
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
                summary: { reportedCount: 0, inferredCount: 1, reportedShare: 0 },
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

  it("uses local datetime-local values and sends UTC ISO on the wire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T05:03:00.000Z"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } }));
      }
      if (url.includes("/api/admin/audit/turns")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 0,
              entries: [],
              summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
              referenceLatency: { windowHours: 24, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
            }
          })
        );
      }
      return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAudit("/admin/audit?range=24h");
    const sinceInput = await screen.findByTestId("audit-since");
    const offsetMinutes = new Date("2026-08-26T05:03:00.000Z").getTimezoneOffset();
    // Only assert the Shanghai-shaped local display when the host TZ matches.
    if (offsetMinutes === -480) {
      expect(sinceInput).toHaveValue("2026-08-25T13:00");
    }
    await waitFor(() => {
      const turnCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/api/admin/audit/turns"));
      expect(turnCall).toBeTruthy();
      expect(turnCall!).toMatch(/since=2026-08-25T05%3A00%3A00\.000Z|since=2026-08-25T05:00:00\.000Z/);
    });

    fireEvent.change(sinceInput, { target: { value: "2026-08-25T14:30" } });
    await waitFor(() => {
      const turnCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/admin/audit/turns"));
      const latest = turnCalls.at(-1) ?? "";
      expect(latest).toMatch(/since=/);
      if (offsetMinutes === -480) {
        expect(latest).toMatch(/since=2026-08-25T06%3A30%3A00\.000Z|since=2026-08-25T06:30:00\.000Z/);
      }
    });
    const exportLink = screen.getByTestId("audit-export-csv");
    expect(exportLink.getAttribute("href")).toMatch(/since=/);
  });

  it("seeds key from turnId on calls deep-link and keeps key after drawer close", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } }));
      }
      if (url.includes("/api/admin/audit/turns/lucy_test")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              id: "lucy_test",
              source: "reported",
              userId: "demo_agent",
              accessLogs: [],
              referenceLatency: { windowHours: 24, p95Ms: 0 }
            }
          })
        );
      }
      if (url.includes("/api/admin/audit/turns")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 0,
              entries: [],
              summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
              referenceLatency: { windowHours: 24, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
            }
          })
        );
      }
      if (url.startsWith("/api/admin/audit?")) {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }));
      }
      return new Response(JSON.stringify({ ok: true, data: { entries: [], total: 0 } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAuditWithProbe("/admin/audit?range=24h&view=calls&turnId=lucy_test");

    await waitFor(() => {
      const search = screen.getByTestId("probe-location").getAttribute("data-search") ?? "";
      expect(search).toContain("key=lucy_test");
      expect(search).toContain("turnId=lucy_test");
      expect(search).toContain("view=calls");
      expect(search).toContain("range=24h");
    });

    await waitFor(() => {
      const callUrls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/admin/audit?"));
      expect(callUrls.some((u) => u.includes("key=lucy_test"))).toBe(true);
    });

    const exportHref = screen.getByTestId("audit-export-csv").getAttribute("href") ?? "";
    expect(exportHref).toContain("key=lucy_test");

    fireEvent.click(await screen.findByTestId("audit-turn-drawer-close"));
    await waitFor(() => {
      const search = screen.getByTestId("probe-location").getAttribute("data-search") ?? "";
      expect(search).not.toContain("turnId=");
      expect(search).toContain("key=lucy_test");
      expect(search).toContain("view=calls");
    });
  });

  it("does not overwrite an explicit key with turnId", async () => {
    stubEmptyAuditApis();
    renderAuditWithProbe("/admin/audit?range=24h&view=calls&turnId=lucy_test&key=manual");
    await waitFor(() => {
      const search = screen.getByTestId("probe-location").getAttribute("data-search") ?? "";
      expect(search).toContain("key=manual");
      expect(search).not.toMatch(/key=lucy_test/);
    });
    expect(screen.getByTestId("audit-key-search")).toHaveValue("manual");
  });

  it("exposes keyboard open action, pressed range state, and copy toast", async () => {
    stubEmptyAuditApis();
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
                source: "reported",
                userId: "demo_agent",
                accessLogs: [],
                referenceLatency: { windowHours: 168, p95Ms: 0 }
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
                summary: { reportedCount: 1, inferredCount: 0, reportedShare: 1 },
                referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 },
                entries: [
                  {
                    id: "inf_test_1",
                    source: "reported",
                    userId: "demo_agent",
                    startedAt: "2026-08-04T08:00:00.000Z",
                    endedAt: "2026-08-04T08:00:16.000Z",
                    businessCallCount: 1,
                    confidence: "high",
                    tools: ["sl_query"],
                    sources: [],
                    turnSpanMs: 16000,
                    totalCallDurationMs: 100,
                    slowCallCount: 0,
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

    renderAudit("/admin/audit?range=7d");

    const windowControl = await screen.findByTestId("audit-window-control");
    expect(windowControl).toHaveAttribute("role", "group");
    expect(screen.getByRole("button", { name: "7 天" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "24 小时" })).toHaveAttribute("aria-pressed", "false");

    const openBtn = await screen.findByTestId("audit-turn-open-inf_test_1");
    fireEvent.click(openBtn);
    expect(await screen.findByTestId("audit-turn-drawer")).toBeInTheDocument();

    const idCell = screen.getByTestId("audit-turn-id-inf_test_1").closest("td");
    expect(idCell).toHaveClass("pl-audit-turn-id-cell");
    const startCell = within(screen.getByTestId("audit-turns-table")).getAllByText((_, node) => {
      return node?.getAttribute?.("data-part") === "date";
    });
    expect(startCell.length).toBeGreaterThanOrEqual(1);

    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => undefined) }
    });
    fireEvent.click(screen.getByTestId("audit-turn-id-inf_test_1"));
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("已复制问询 ID");
    });
  });

  it("shows clear-filters when a non-default filter is active", async () => {
    stubEmptyAuditApis();
    renderAudit("/admin/audit?range=24h&user=demo_agent");
    expect(await screen.findByTestId("audit-clear-filters")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("audit-clear-filters"));
    await waitFor(() => {
      expect(screen.queryByTestId("audit-clear-filters")).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Agent 名称或 ID")).toHaveValue("");
  });
});
