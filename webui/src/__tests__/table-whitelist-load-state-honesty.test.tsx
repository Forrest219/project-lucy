// @vitest-environment jsdom
/**
 * P1-80／REQ-030-101 — tables pending／error must not masquerade as missing Manifest.
 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import type { ConnectionInfo, SourceSummary } from "../lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const TEST_CONN: ConnectionInfo = {
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readOnlyExpected: true,
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
};

const TEST_TABLES = [
  "dataforai.superstore_orders",
  "dataforai.superstore_people",
  "dataforai.superstore_returns"
];

function makeSource(table: string): SourceSummary {
  return {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table,
    qualifiedName: `dataforai.${table}`,
    filePath: "",
    columnCount: 1,
    columnNames: [],
    hasTableDesc: false,
    hasGrain: false,
    measureCount: 0,
    joinCount: 0,
    wikiRefCount: 0,
    completion: "not_started",
    mtime: "",
    enabled: true,
    authorizedAgentCount: 0,
    semanticUpdatedAt: "2026-06-15T08:00:00.000Z",
    semanticUpdatedAtSource: "manifest"
  };
}

type Handler = (body: unknown, init?: RequestInit) => Response | Promise<Response>;
type HandlerMap = Record<string, Handler>;

function baseHandlers(tablesHandler: Handler): HandlerMap {
  return {
    "GET /api/connections": () =>
      new Response(JSON.stringify({ ok: true, data: { connections: [TEST_CONN] } })),
    "GET /api/project": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { root: "/tmp/project-lucy", ktxAvailable: true, connections: [TEST_CONN] }
        })
      ),
    "GET /api/sources": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            tables: [
              makeSource("superstore_orders"),
              makeSource("superstore_people"),
              makeSource("superstore_returns")
            ]
          }
        })
      ),
    "GET /api/connections/mysql-aliyun/tables": tablesHandler
  };
}

function stubFetch(handlers: HandlerMap) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.replace(/^http:\/\/[^/]+/, "")}`;
    const handler = handlers[key];
    if (!handler) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
        { status: 404 }
      );
    }
    return handler(undefined, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderWhitelist() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <TableWhitelist />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("P1-80 enabled-tables load-state honesty", () => {
  it("SC-01 pending: does not report missing Manifest or invalid enabled", async () => {
    stubFetch(
      baseHandlers(() => new Promise(() => {}))
    );
    renderWhitelist();

    expect(await screen.findByRole("heading", { name: "启用表范围" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("whitelist-tables-loading-mysql-aliyun")).toHaveTextContent(
        "正在读取表清单…"
      );
    });
    expect(screen.queryByTestId("whitelist-missing-manifest-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("无效启用")).not.toBeInTheDocument();
    expect(screen.queryByTestId("whitelist-remove-invalid-enabled")).not.toBeInTheDocument();
    expect(screen.queryByTestId("whitelist-invalid-enabled-section")).not.toBeInTheDocument();
  });

  it("SC-02 error: shows read failure, not missing Manifest / invalid enabled", async () => {
    stubFetch(
      baseHandlers(
        () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: "INTERNAL", message: "tables probe forced error" }
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    renderWhitelist();

    expect(await screen.findByTestId("whitelist-tables-error-mysql-aliyun")).toHaveTextContent(
      "表清单读取失败，请重试。"
    );
    expect(screen.queryByTestId("whitelist-missing-manifest-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("无效启用")).not.toBeInTheDocument();
    const remove = screen.queryByTestId("whitelist-remove-invalid-enabled");
    if (remove) {
      expect(remove).toBeDisabled();
    }
  });

  it("SC-03 success empty: may report missing Manifest and invalid enabled", async () => {
    stubFetch(
      baseHandlers(
        () =>
          new Response(
            JSON.stringify({ ok: true, data: { tables: [], physicalNames: {} } })
          )
      )
    );
    renderWhitelist();

    expect(await screen.findByTestId("whitelist-missing-manifest-summary")).toHaveTextContent(
      "dataforai 缺少 Manifest，暂不可配置表范围。"
    );
    expect(
      await screen.findByTestId("whitelist-invalid-enabled-section", {}, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("whitelist-invalid-enabled-section")).getAllByText("无效启用").length).toBeGreaterThan(0);
    expect(screen.getByTestId("whitelist-remove-invalid-enabled")).toBeEnabled();
  });

  it("SC-04 success non-empty covering enabled tables: no false positives", async () => {
    stubFetch(
      baseHandlers(
        () =>
          new Response(
            JSON.stringify({ ok: true, data: { tables: TEST_TABLES, physicalNames: {} } })
          )
      )
    );
    renderWhitelist();

    expect(await screen.findByText("superstore_orders")).toBeInTheDocument();
    expect(screen.queryByTestId("whitelist-missing-manifest-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("无效启用")).not.toBeInTheDocument();
    expect(screen.getAllByText(/已选 2\/3 张表/).length).toBeGreaterThan(0);
  });

  it("SC-05 mixed: ready A stays healthy while pending B only shows loading", async () => {
    const connB: ConnectionInfo = {
      id: "pg-pending",
      driver: "postgres",
      engine: "postgres",
      wireProtocol: "postgres",
      readOnlyExpected: true,
      schemas: ["public"],
      enabledTables: ["public.orders"]
    };
    stubFetch({
      "GET /api/connections": () =>
        new Response(
          JSON.stringify({ ok: true, data: { connections: [TEST_CONN, connB] } })
        ),
      "GET /api/project": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { root: "/tmp/project-lucy", ktxAvailable: true, connections: [TEST_CONN, connB] }
          })
        ),
      "GET /api/sources": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              tables: [
                makeSource("superstore_orders"),
                makeSource("superstore_people"),
                makeSource("superstore_returns")
              ]
            }
          })
        ),
      "GET /api/connections/mysql-aliyun/tables": () =>
        new Response(
          JSON.stringify({ ok: true, data: { tables: TEST_TABLES, physicalNames: {} } })
        ),
      "GET /api/connections/pg-pending/tables": () => new Promise(() => {})
    });
    renderWhitelist();

    expect(await screen.findByText("superstore_orders")).toBeInTheDocument();
    expect(await screen.findByTestId("whitelist-tables-loading-pg-pending")).toHaveTextContent(
      "正在读取表清单…"
    );
    expect(screen.queryByTestId("whitelist-tables-loading-mysql-aliyun")).not.toBeInTheDocument();
    expect(screen.queryByTestId("whitelist-missing-manifest-summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/public 缺少 Manifest/)).not.toBeInTheDocument();
    expect(screen.queryByText("无效启用")).not.toBeInTheDocument();
  });
});
