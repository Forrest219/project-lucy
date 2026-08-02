// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectDetailDrawer } from "../components/ObjectDetailDrawer";
import type { AuditLogEntry, SourceSummary } from "../lib/types";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ObjectDetailDrawer />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderAtWithLocation(path: string) {
  function Probe() {
    const location = useLocation();
    return <div data-testid="probe-location" data-search={location.search} data-pathname={location.pathname} />;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ObjectDetailDrawer />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const tableFixture: SourceSummary = {
  conn: "mysql-aliyun",
  schema: "dataforai",
  table: "superstore_orders",
  filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
  columnCount: 8,
  columnNames: ["order_key", "row_id"],
  hasTableDesc: true,
  hasGrain: true,
  measureCount: 1,
  joinCount: 0,
  wikiRefCount: 1,
  completion: "done",
  mtime: "2026-07-30T00:00:00.000Z"
};

function stubDrawerFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sources") {
      return new Response(JSON.stringify({ ok: true, data: { tables: [tableFixture] } }));
    }
    if (url === "/api/admin/agents") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            agents: [
              {
                id: "zhangsan",
                name: "张三",
                enabled: true,
                role: "analyst",
                tokens: [],
                stats: { callsLast7d: 1, deniedLast7d: 0, topTables: [] }
              }
            ]
          }
        })
      );
    }
    if (url.startsWith("/api/eval/runs/")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: 42,
            domain: "superstore",
            status: "succeeded",
            startedAt: "2026-07-30T00:00:00.000Z",
            finishedAt: "2026-07-30T00:01:00.000Z",
            triggeredBy: "ops",
            trigger: "manual",
            ktxMcpUrl: "http://localhost:7878/mcp",
            caseSelection: { mode: "all" },
            totalCases: 10,
            passCount: 9,
            failCount: 1,
            results: [
              { caseId: "case_a", status: "PASS" },
              { caseId: "case_b", status: "FAIL", failedAssertions: ["missing column"] }
            ]
          }
        })
      );
    }
    if (url.startsWith("/api/admin/audit")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            total: 1,
            entries: [
              {
                id: 7,
                ts: "2026-07-30T00:00:00.000Z",
                userId: "zhangsan",
                tool: "sl_query",
                tables: ["superstore_orders"],
                outcome: "ok",
                durationMs: 12,
                requestId: "req-7"
              }
            ]
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

describe("ObjectDetailDrawer", () => {
  it("opens a table drawer with translation defense for code-like identifiers", async () => {
    stubDrawerFetch();
    renderAt("/?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders");

    expect(await screen.findByTestId("object-detail-title")).toHaveTextContent("superstore_orders");
    expect(await screen.findByTestId("object-detail-table-body")).toBeInTheDocument();
    // Connection / Schema / Table labels all wrapped with notranslate
    const connCells = screen.getAllByText("mysql-aliyun");
    for (const cell of connCells) {
      expect(cell).toHaveAttribute("translate", "no");
      expect(cell.className).toContain("notranslate");
    }
  });

  it("renders a Connection / Schema / Table / Field count summary for the matched table", async () => {
    stubDrawerFetch();
    renderAt("/?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders");

    const body = await screen.findByTestId("object-detail-table-body");
    expect(body).toHaveTextContent("dataforai");
    expect(body).toHaveTextContent("8");
    expect(body).toHaveTextContent("1 个");
  });

  it("shows a safe error state when the table is not found", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { tables: [] } }))
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/?object=table&conn=mysql-aliyun&schema=missing&table=nope");

    const error = await screen.findByTestId("object-detail-table-not-found");
    expect(error).toHaveTextContent("未找到该表");
    expect(error).toHaveTextContent("nope");
  });

  it("renders an agent drawer with the role / token summary", async () => {
    stubDrawerFetch();
    renderAt("/?object=agent&agentId=zhangsan");

    const body = await screen.findByTestId("object-detail-agent-body");
    expect(body).toHaveTextContent("张三");
    expect(body).toHaveTextContent("analyst");
    expect(body).toHaveTextContent("启用");
  });

  it("renders a run drawer with the recent failed case list", async () => {
    stubDrawerFetch();
    renderAt("/?object=evalRun&runId=42");

    const body = await screen.findByTestId("object-detail-run-body");
    expect(body).toHaveTextContent("superstore");
    expect(body).toHaveTextContent("9/10");
    expect(body).toHaveTextContent("case_b");
  });

  it("renders an audit event drawer with the tool and tables summary", async () => {
    stubDrawerFetch();
    renderAt("/?object=auditEvent&eventId=7");

    const body = await screen.findByTestId("object-detail-audit-body");
    expect(body).toHaveTextContent("sl_query");
    expect(body).toHaveTextContent("superstore_orders");
  });

  it("close button strips the object query params and stays on the same pathname", async () => {
    stubDrawerFetch();
    renderAtWithLocation("/onboarding?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders");

    const close = await screen.findByTestId("object-detail-close");
    fireEvent.click(close);

    await waitFor(() => {
      const probe = screen.getByTestId("probe-location");
      expect(probe.getAttribute("data-pathname")).toBe("/onboarding");
      expect(probe.getAttribute("data-search")).toBe("");
    });
  });

  it("does not render the drawer when no object query is present", () => {
    renderAt("/onboarding");
    expect(screen.queryByTestId("object-detail-drawer")).not.toBeInTheDocument();
  });

  it("ignores malformed object kinds and shows a safe empty state", () => {
    renderAt("/?object=unknown&foo=bar");
    expect(screen.queryByTestId("object-detail-drawer")).not.toBeInTheDocument();
  });

  it("ignores partial table params and does not open the drawer", () => {
    renderAt("/?object=table&conn=mysql-aliyun&schema=dataforai");
    expect(screen.queryByTestId("object-detail-drawer")).not.toBeInTheDocument();
  });

  it("deep-link button points to the full page for the active target", async () => {
    stubDrawerFetch();
    renderAt("/?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders");

    const link = await screen.findByTestId("object-detail-deep-link");
    expect(link).toHaveAttribute(
      "href",
      "/catalog/mysql-aliyun/dataforai/superstore_orders"
    );
  });

  it("renders the audit event drawer from the initial location state without re-fetching", async () => {
    // M36 review follow-up: the Audit page passes the clicked row via
    // `location.state.initialAuditEntry`. The drawer must render that
    // payload directly so paginated / filtered audit pages do not flash
    // a "未找到" error while waiting for the next list page.
    stubDrawerFetch();
    const initialEntry: AuditLogEntry = {
      id: 99,
      ts: "2026-07-30T00:00:00.000Z",
      userId: "zhangsan",
      tool: "sl_query",
      tables: ["superstore_orders"],
      outcome: "ok",
      durationMs: 12,
      requestId: "req-99"
    };
    function statefulWrapper() {
      return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter
            initialEntries={[
              { pathname: "/admin/audit", search: "?object=auditEvent&eventId=99", state: { initialAuditEntry: initialEntry } }
            ]}
          >
            <ObjectDetailDrawer />
          </MemoryRouter>
        </QueryClientProvider>
      );
    }
    statefulWrapper();

    const body = await screen.findByTestId("object-detail-audit-body");
    expect(body).toHaveTextContent("sl_query");
    expect(body).toHaveTextContent("superstore_orders");
  });
});
