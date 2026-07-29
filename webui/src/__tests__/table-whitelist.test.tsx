// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import type { ConnectionInfo, SourceSummary } from "../lib/types";

const TEST_CONN: ConnectionInfo = {
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readOnlyExpected: true,
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
};

const TEST_CONN_REPLICA: ConnectionInfo = {
  id: "analytics-pg",
  driver: "postgres",
  engine: "postgres",
  wireProtocol: "postgres",
  readOnlyExpected: true,
  schemas: ["analytics"],
  enabledTables: ["analytics.revenue_daily"]
};

const TEST_TABLES = [
  "dataforai.superstore_orders",
  "dataforai.superstore_people",
  "dataforai.superstore_returns"
];

function makeSource(table: string, overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table,
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
    ...overrides
  };
}

const TEST_SOURCES: SourceSummary[] = [
  makeSource("superstore_orders", { columnCount: 8, completion: "done", hasTableDesc: true }),
  makeSource("superstore_people", { columnCount: 2, completion: "partial", hasTableDesc: false }),
  makeSource("superstore_returns", { columnCount: 3, completion: "not_started", hasTableDesc: false })
];

type Handler = (body: unknown, init?: RequestInit) => Response;
type HandlerMap = Record<string, Handler>;

function defaultHandlers(opts: {
  connections?: ConnectionInfo[];
  connection?: ConnectionInfo;
  tables?: string[];
  tablesByConnection?: Record<string, string[]>;
  sources?: SourceSummary[];
} = {}): HandlerMap {
  const connections = opts.connections ?? [opts.connection ?? TEST_CONN];
  const sources = opts.sources ?? TEST_SOURCES;
  const persistedByConnection = new Map(connections.map((conn) => [conn.id, [...conn.enabledTables]]));
  const handlers: HandlerMap = {
    "GET /api/connections": () =>
      new Response(JSON.stringify({ ok: true, data: { connections } })),
    "GET /api/sources": () =>
      new Response(JSON.stringify({ ok: true, data: { tables: sources } }))
  };

  for (const conn of connections) {
    const tables = opts.tablesByConnection?.[conn.id] ?? opts.tables ?? TEST_TABLES;
    handlers[`GET /api/connections/${conn.id}/tables`] = () =>
      new Response(JSON.stringify({ ok: true, data: { tables } }));
    handlers[`PUT /api/connections/${conn.id}/enabled-tables`] = (body) => {
      const b = body as { dryRun?: boolean; enabledTables?: string[] };
      const newEnabled = b.enabledTables ?? [];
      const persisted = persistedByConnection.get(conn.id) ?? [];
      if (b.dryRun === true) {
        const added = newEnabled.filter((t) => !persisted.includes(t));
        const diffLines = ["--- ktx.yaml", "+++ ktx.yaml", "@@"].concat(
          added.map((t) => `+      - ${t}`)
        );
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: diffLines.join("\n") + "\n",
              proposedYaml:
                "connections:\n  " +
                conn.id +
                ":\n    enabled_tables:\n      - " +
                newEnabled.join("\n      - ") +
                "\n",
              oldEnabledTables: persisted,
              newEnabledTables: newEnabled
            }
          })
        );
      }
      persistedByConnection.set(conn.id, newEnabled);
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            written: true,
            oldEnabledTables: persisted,
            newEnabledTables: newEnabled
          }
        })
      );
    };
    // M14: catalog reload endpoint replaces the deprecated ingest endpoint.
    handlers[`POST /api/catalog/reload`] = (body) => {
      const b = body as { connectionId?: string; schema?: string };
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: b.connectionId,
            requestedSchema: b.schema,
            connectionIds: b.connectionId ? [b.connectionId] : [conn.id],
            connections: 1,
            configuredSchemas: 1,
            manifestSchemas: 1,
            tables: 3,
            enabledTables: 3,
            warnings: [],
            source: "static-yaml"
          }
        })
      );
    };
  }

  return handlers;
}

function stubWhitelistFetch(handlers: HandlerMap = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const key = `${method} ${url.replace(/^http:\/\/[^/]+/, "")}`;
    const handler = handlers[key] ?? handlers[`${method} ${url}`];
    if (!handler) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
        { status: 404 }
      );
    }
    return handler(body, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, handlers };
}

function renderWhitelist() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TableWhitelist />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client };
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

describe("TableWhitelist", () => {
  it("renders toolbar, grouped table, and status badges from existing API data", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    expect(await screen.findByRole("heading", { name: "表白名单" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索表名/描述...")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Schema 筛选" })).toBeInTheDocument();
    expect(screen.getAllByText("已勾选 2 / 3 张表")[0]).toBeInTheDocument();
    expect(screen.getByText("Connection: mysql-aliyun · Schema: dataforai")).toBeInTheDocument();
    expect(screen.getByText("superstore_orders")).toBeInTheDocument();
    expect(screen.getByText("8 个")).toBeInTheDocument();
    expect(screen.getByText("已纳入")).toBeInTheDocument();
    expect(screen.getByText("已启用，待补语义")).toBeInTheDocument();
    expect(screen.getByText("未启用")).toBeInTheDocument();
  });

  it("links semantic-ready whitelisted rows to the source detail page", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_orders");
    expect(within(row).getByRole("link", { name: "查看语义" })).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_orders"
    );
  });

  it("links whitelisted rows without source completion so semantic work remains reachable", async () => {
    stubWhitelistFetch(defaultHandlers({ sources: [TEST_SOURCES[0]] }));
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_people");
    expect(within(row).getByText("已启用，待补语义")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "查看语义" })).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_people"
    );
  });

  it("groups visible rows by connection and schema instead of reusing the first schema", async () => {
    stubWhitelistFetch(
      defaultHandlers({
        connection: {
          ...TEST_CONN,
          schemas: ["analytics", "dataforai"],
          enabledTables: ["dataforai.superstore_orders", "analytics.revenue_daily"]
        },
        tables: ["dataforai.superstore_orders", "analytics.revenue_daily"],
        sources: [
          makeSource("superstore_orders", { columnCount: 8, completion: "done" }),
          makeSource("revenue_daily", {
            schema: "analytics",
            columnCount: 4,
            completion: "done"
          })
        ]
      })
    );
    renderWhitelist();

    await screen.findByRole("combobox", { name: "Schema 筛选" });
    await waitFor(() => {
      expect(screen.getByText("Connection: mysql-aliyun · Schema: analytics")).toBeInTheDocument();
      expect(screen.getByText("Connection: mysql-aliyun · Schema: dataforai")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Schema 筛选" }), {
      target: { value: "analytics" }
    });

    await waitFor(() => {
      expect(screen.getByText("Connection: mysql-aliyun · Schema: analytics")).toBeInTheDocument();
    });
    expect(screen.queryByText("Connection: mysql-aliyun · Schema: dataforai")).not.toBeInTheDocument();
    expect(screen.getByText("revenue_daily")).toBeInTheDocument();
    expect(screen.queryByText("superstore_orders")).not.toBeInTheDocument();
  });

  it("keeps configured schemas in the filter even when the local manifest is missing", async () => {
    stubWhitelistFetch(
      defaultHandlers({
        connection: {
          ...TEST_CONN,
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
        },
        tables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
      })
    );
    renderWhitelist();

    const schemaSelect = await screen.findByRole("combobox", { name: "Schema 筛选" });
    expect(within(schemaSelect).getByRole("option", { name: "openclaw_db" })).toBeInTheDocument();
    expect(screen.getByTestId("configured-schema-empty-mysql-aliyun-openclaw_db")).toHaveTextContent(
      "openclaw_db 已在连接配置中启用，但本地 semantic-layer 尚未提供表清单。"
    );

    fireEvent.change(schemaSelect, { target: { value: "openclaw_db" } });

    await waitFor(() => {
      expect(screen.getAllByText("已勾选 0 / 0 张表")[0]).toBeInTheDocument();
    });
    expect(screen.getByText("Connection: mysql-aliyun · Schema: openclaw_db")).toBeInTheDocument();
    expect(screen.queryByText("Connection: mysql-aliyun · Schema: dataforai")).not.toBeInTheDocument();
    expect(screen.queryByText("superstore_orders")).not.toBeInTheDocument();
  });

  it("filters tables by name search and updates the visible selection summary", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });

    await waitFor(() => {
      expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument();
    });
    expect(screen.queryByText("superstore_orders")).not.toBeInTheDocument();
    expect(screen.queryByText("superstore_people")).not.toBeInTheDocument();
    expect(screen.getByText("superstore_returns")).toBeInTheDocument();
  });

  it("select-all visible adds rows to draft, surfaces floating bar; invert visible toggles back", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });

    await waitFor(() => {
      expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    expect(await screen.findAllByText("已勾选 1 / 1 张表")).toHaveLength(2);
    expect(screen.getByText(/变更未保存/)).toBeInTheDocument();
    expect(screen.getByText(/新增 1 张表/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "反选当前结果" }));

    await waitFor(() => {
      expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument();
    });
    expect(screen.queryByText(/变更未保存/)).not.toBeInTheDocument();
  });

  it("opens YAML preview drawer with the dry-run diff and added-table chips", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => {
      expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "预览 YAML" }));

    const drawer = await screen.findByRole("dialog", { name: "YAML 预览" });
    expect(within(drawer).getByText("enabled_tables: 2 -> 3")).toBeInTheDocument();
    expect(
      within(drawer).getAllByText(/dataforai\.superstore_returns/).length
    ).toBeGreaterThan(0);
    expect(drawer.querySelector(".pl-diff-viewer")).toBeTruthy();
  });

  it("opens YAML preview drawer with removed-table chips", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_people");
    fireEvent.click(within(row).getByRole("checkbox", { name: "选择 superstore_people" }));
    fireEvent.click(screen.getByRole("button", { name: "预览 YAML" }));

    const drawer = await screen.findByRole("dialog", { name: "YAML 预览" });
    expect(within(drawer).getByText("enabled_tables: 2 -> 1")).toBeInTheDocument();
    expect(within(drawer).getByText("移除：dataforai.superstore_people")).toBeInTheDocument();
  });

  it("previews every changed connection before save-and-scan can write them", async () => {
    stubWhitelistFetch(
      defaultHandlers({
        connections: [TEST_CONN, TEST_CONN_REPLICA],
        tablesByConnection: {
          "mysql-aliyun": TEST_TABLES,
          "analytics-pg": ["analytics.revenue_daily", "analytics.revenue_monthly"]
        },
        sources: [
          ...TEST_SOURCES,
          makeSource("revenue_daily", {
            conn: "analytics-pg",
            schema: "analytics",
            columnCount: 4,
            completion: "done"
          }),
          makeSource("revenue_monthly", {
            conn: "analytics-pg",
            schema: "analytics",
            columnCount: 5,
            completion: "not_started"
          })
        ]
      })
    );
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.change(search, { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.click(screen.getByRole("button", { name: "预览 YAML" }));

    const drawer = await screen.findByRole("dialog", { name: "YAML 预览" });
    expect(within(drawer).getByText("写入 ktx.yaml 前的最终检查，共 2 个连接。")).toBeInTheDocument();
    expect(within(drawer).getByText("Connection: mysql-aliyun")).toBeInTheDocument();
    expect(within(drawer).getByText("Connection: analytics-pg")).toBeInTheDocument();
    expect(within(drawer).getAllByText(/dataforai\.superstore_returns/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/analytics\.revenue_monthly/).length).toBeGreaterThan(0);
  });

  it("persists enabled tables but does not auto-trigger ingest or catalog reload on save", async () => {
    const { fetchMock } = stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => {
      expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));
    // M13: button text changed from "保存并触发扫描" to "保存变更", and saving
    // the whitelist must NOT call /ingest or /api/catalog/reload automatically.
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/connections/mysql-aliyun/enabled-tables"),
        expect.objectContaining({ method: "PUT" })
      );
    });
    const ingestCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes("/api/connections/mysql-aliyun/ingest");
    });
    expect(ingestCalls).toHaveLength(0);
    const reloadCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes("/api/catalog/reload");
    });
    expect(reloadCalls).toHaveLength(0);
    expect(await screen.findByText(/表白名单已保存/)).toBeInTheDocument();
  });

  it("surfaces a 刷新本地表目录 action in the toolbar even without any draft changes", async () => {
    const { fetchMock } = stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const reloadButton = await screen.findByTestId("whitelist-reload-catalog");
    expect(reloadButton).toHaveTextContent("刷新本地表目录");
    expect(reloadButton).not.toBeDisabled();

    fireEvent.click(reloadButton);
    await waitFor(() => {
      const reloadCalls = fetchMock.mock.calls.filter((call) => {
        const url = String(call[0]);
        return url.includes("/api/catalog/reload");
      });
      expect(reloadCalls.length).toBeGreaterThan(0);
    });
    // The deprecated ingest endpoint must never be called from the whitelist.
    const ingestCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/ingest")
    );
    expect(ingestCalls).toHaveLength(0);
  });

  it("forwards the current schema filter to the reload request when the toolbar button is clicked", async () => {
    const { fetchMock } = stubWhitelistFetch(
      defaultHandlers({
        connection: {
          ...TEST_CONN,
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
        },
        tables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
      })
    );
    renderWhitelist();

    const schemaSelect = await screen.findByRole("combobox", { name: "Schema 筛选" });
    fireEvent.change(schemaSelect, { target: { value: "openclaw_db" } });

    fireEvent.click(await screen.findByTestId("whitelist-reload-catalog"));

    await waitFor(() => {
      const reloadCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/api/catalog/reload")
      );
      expect(reloadCall).toBeDefined();
    });
    const reloadCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/catalog/reload")
    );
    expect(reloadCall?.[1]?.body).toBe(
      JSON.stringify({ connectionId: "mysql-aliyun", schema: "openclaw_db" })
    );
  });

  it("exposes a 刷新本地表目录 action inside the configured empty schema state", async () => {
    const { fetchMock } = stubWhitelistFetch(
      defaultHandlers({
        connection: {
          ...TEST_CONN,
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
        },
        tables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
      })
    );
    renderWhitelist();

    const empty = await screen.findByTestId("configured-schema-empty-mysql-aliyun-openclaw_db");
    const button = within(empty).getByTestId(
      "whitelist-empty-reload-catalog-mysql-aliyun-openclaw_db"
    );
    expect(button).toHaveTextContent("刷新本地表目录");

    fireEvent.click(button);
    await waitFor(() => {
      const reloadCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/api/catalog/reload")
      );
      expect(reloadCall).toBeDefined();
    });
    const reloadCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/catalog/reload")
    );
    expect(reloadCall?.[1]?.body).toBe(
      JSON.stringify({ connectionId: "mysql-aliyun", schema: "openclaw_db" })
    );
  });

  it("saves multi-connection whitelist changes without auto-triggering ingest", async () => {
    const { fetchMock } = stubWhitelistFetch(
      defaultHandlers({
        connections: [TEST_CONN, TEST_CONN_REPLICA],
        tablesByConnection: {
          "mysql-aliyun": TEST_TABLES,
          "analytics-pg": ["analytics.revenue_daily", "analytics.revenue_monthly"]
        },
        sources: [
          ...TEST_SOURCES,
          makeSource("revenue_daily", {
            conn: "analytics-pg",
            schema: "analytics",
            columnCount: 4,
            completion: "done"
          }),
          makeSource("revenue_monthly", {
            conn: "analytics-pg",
            schema: "analytics",
            columnCount: 5,
            completion: "not_started"
          })
        ]
      })
    );
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.change(search, { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getAllByText("已勾选 0 / 1 张表")[0]).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/connections/mysql-aliyun/enabled-tables"),
        expect.objectContaining({ method: "PUT" })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/connections/analytics-pg/enabled-tables"),
        expect.objectContaining({ method: "PUT" })
      );
    });
    const ingestCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/ingest")
    );
    expect(ingestCalls).toHaveLength(0);
  });
});
