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
    handlers[`POST /api/connections/${conn.id}/ingest`] = () =>
      new Response(JSON.stringify({ ok: true, data: { exitCode: 0, stdout: "ok", stderr: "" } }));
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
    expect(screen.getByText("已勾选 2 / 3 张表")).toBeInTheDocument();
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

    expect(await screen.findByText("Connection: mysql-aliyun · Schema: analytics")).toBeInTheDocument();
    expect(screen.getByText("Connection: mysql-aliyun · Schema: dataforai")).toBeInTheDocument();

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

  it("filters tables by name search and updates the visible selection summary", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });

    await waitFor(() => {
      expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument();
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
      expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    expect(await screen.findByText("已勾选 1 / 1 张表")).toBeInTheDocument();
    expect(screen.getByText(/变更未保存/)).toBeInTheDocument();
    expect(screen.getByText(/新增 1 张表/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "反选当前结果" }));

    await waitFor(() => {
      expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument();
    });
    expect(screen.queryByText(/变更未保存/)).not.toBeInTheDocument();
  });

  it("opens YAML preview drawer with the dry-run diff and added-table chips", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => {
      expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.change(search, { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.click(screen.getByRole("button", { name: "预览 YAML" }));

    const drawer = await screen.findByRole("dialog", { name: "YAML 预览" });
    expect(within(drawer).getByText("写入 ktx.yaml 前的最终检查，共 2 个连接。")).toBeInTheDocument();
    expect(within(drawer).getByText("Connection: mysql-aliyun")).toBeInTheDocument();
    expect(within(drawer).getByText("Connection: analytics-pg")).toBeInTheDocument();
    expect(within(drawer).getAllByText(/dataforai\.superstore_returns/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/analytics\.revenue_monthly/).length).toBeGreaterThan(0);
  });

  it("persists enabled tables and triggers ingest on save-and-scan", async () => {
    const { fetchMock } = stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => {
      expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "保存并触发扫描" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/connections/mysql-aliyun/enabled-tables"),
        expect.objectContaining({ method: "PUT" })
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/connections/mysql-aliyun/ingest"),
      expect.objectContaining({ method: "POST" })
    );
    expect(await screen.findAllByText(/扫描完成|白名单已保存/)).not.toHaveLength(0);
  });

  it("shows per-connection save progress and keeps every scan log for multi-connection saves", async () => {
    const { fetchMock, handlers } = stubWhitelistFetch(
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
    handlers["POST /api/connections/mysql-aliyun/ingest"] = () =>
      new Response(
        JSON.stringify({ ok: true, data: { exitCode: 0, stdout: "mysql scan ok", stderr: "" } })
      );
    handlers["POST /api/connections/analytics-pg/ingest"] = () =>
      new Response(
        JSON.stringify({ ok: true, data: { exitCode: 0, stdout: "pg scan ok", stderr: "" } })
      );
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.change(search, { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getByText("已勾选 0 / 1 张表")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全选当前结果" }));

    fireEvent.click(screen.getByRole("button", { name: "保存并触发扫描" }));

    const progress = await screen.findByTestId("whitelist-save-progress");
    await waitFor(() => {
      expect(within(progress).getByText("mysql-aliyun")).toBeInTheDocument();
      expect(within(progress).getByText("analytics-pg")).toBeInTheDocument();
      expect(within(progress).getAllByText("扫描完成")).toHaveLength(2);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/connections/mysql-aliyun/enabled-tables"),
      expect.objectContaining({ method: "PUT" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/connections/analytics-pg/enabled-tables"),
      expect.objectContaining({ method: "PUT" })
    );
    expect(await screen.findByText("Connection: mysql-aliyun · 退出码 0")).toBeInTheDocument();
    expect(screen.getByText("Connection: analytics-pg · 退出码 0")).toBeInTheDocument();
    expect(screen.getByText("mysql scan ok")).toBeInTheDocument();
    expect(screen.getByText("pg scan ok")).toBeInTheDocument();
  });
});
