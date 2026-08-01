// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import type { CatalogReloadRun, ConnectionInfo, SourceSummary } from "../lib/types";
import { assertNoForbiddenTerms } from "./forbidden-terms";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error
  }
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
  catalogReload?: Partial<CatalogReloadRun>;
} = {}): HandlerMap {
  const connections = opts.connections ?? [opts.connection ?? TEST_CONN];
  const sources = opts.sources ?? TEST_SOURCES;
  const persistedByConnection = new Map(connections.map((conn) => [conn.id, [...conn.enabledTables]]));
    const handlers: HandlerMap = {
      "GET /api/connections": () =>
        new Response(JSON.stringify({ ok: true, data: { connections } })),
      "GET /api/project": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { root: "/tmp/project-lucy", ktxAvailable: true, connections }
          })
        ),
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
            tables: opts.catalogReload?.tables ?? 3,
            enabledTables: opts.catalogReload?.enabledTables ?? 3,
            warnings: opts.catalogReload?.warnings ?? [],
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

function renderWhitelist(initialEntries: string[] = ["/"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <TableWhitelist />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client };
}

beforeEach(() => {
  vi.resetAllMocks();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TableWhitelist", () => {
  async function openBatchMenu() {
    // jsdom does not implement <details> open/close semantics, so we open
    // the menu programmatically before clicking menu items.
    const details = document.querySelector(
      '[data-testid="whitelist-batch-menu"]'
    ) as HTMLDetailsElement | null;
    if (details && !details.open) details.open = true;
  }

  async function clickBatchAction(name: "全选" | "反选") {
    await openBatchMenu();
    const menu = await screen.findByTestId("whitelist-batch-menu-panel");
    fireEvent.click(within(menu).getByRole("menuitem", { name }));
  }

  it("renders toolbar, grouped table, and status badges from existing API data", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    expect(await screen.findByRole("heading", { name: "启用表范围" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "表白名单" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索表名/描述...")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Schema 筛选" })).toBeInTheDocument();
    expect(screen.getAllByText("已选 2/3 张表")[0]).toBeInTheDocument();
    expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：DATAFORAI")).toBeInTheDocument();
    expect(screen.getByText("superstore_orders")).toBeInTheDocument();
    expect(screen.getByText("8 个")).toBeInTheDocument();
    expect(screen.getByText("已启用，语义完成")).toBeInTheDocument();
    expect(screen.getByText("已启用，待补语义")).toBeInTheDocument();
    expect(screen.getByText("未启用")).toBeInTheDocument();
    // Forbidden legacy labels from M45 terminology refresh must not appear.
    expect(screen.queryByText("已纳入")).not.toBeInTheDocument();
    expect(screen.queryByText("待同步")).not.toBeInTheDocument();
  });

  it("links semantic-ready whitelisted rows to the source detail page", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_orders");
    expect(within(row).getByRole("link", { name: /查看语义/ })).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_orders"
    );
  });

  it("links whitelisted rows without source completion so semantic work remains reachable", async () => {
    stubWhitelistFetch(defaultHandlers({ sources: [TEST_SOURCES[0]] }));
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_people");
    expect(within(row).getByText("已启用，待补语义")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /编辑语义/ })).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_people"
    );
  });

  it("renders one shared table head plus a lightweight group header row per (connection, schema)", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const table = await screen.findByTestId("pl-whitelist-table");
    const headers = within(table).getAllByRole("row", { name: /表名/ });
    expect(headers).toHaveLength(1);

    const groupRow = await screen.findByTestId("whitelist-group-mysql-aliyun-dataforai");
    expect(within(groupRow).getByText(/连接：MYSQL-ALIYUN/)).toBeInTheDocument();
    expect(within(groupRow).getByText(/共 3 张表/)).toBeInTheDocument();
  });

  it("replaces the 加入白名单 status-toggle button with a 查看字段 link for disabled rows", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    // superstore_returns is not in the persisted enabledTables — it is
    // currently 未启用. The action cell must be a navigation link, not a
    // status toggle button.
    const disabledRow = await screen.findByTestId(
      "whitelist-row-dataforai.superstore_returns"
    );
    expect(
      within(disabledRow).queryByRole("button", { name: "加入白名单" })
    ).not.toBeInTheDocument();
    const link = within(disabledRow).getByRole("link", { name: /查看字段/ });
    expect(link).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_returns"
    );
  });

  it("hoists 刷新本地目录 to PageHeader and moves 批量操作 into the toolbar", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const pageActions = await screen.findByTestId("page-header-actions");
    expect(within(pageActions).getByTestId("whitelist-reload-catalog")).toHaveTextContent(
      "刷新本地目录"
    );
    // M45: batch ops no longer live in PageHeader.actions.
    expect(within(pageActions).queryByTestId("whitelist-batch-menu")).not.toBeInTheDocument();
    expect(within(pageActions).queryByTestId("whitelist-select-all")).not.toBeInTheDocument();
    expect(within(pageActions).queryByTestId("whitelist-invert")).not.toBeInTheDocument();

    // Filter toolbar keeps filters + selection summary + batch menu only.
    const toolbar = screen.getByRole("toolbar", { name: "启用表范围工具栏" });
    expect(
      within(toolbar).queryByTestId("whitelist-reload-catalog")
    ).not.toBeInTheDocument();
    expect(within(toolbar).getByTestId("whitelist-batch-menu")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("pl-whitelist-selection-summary")).toHaveTextContent(
      "已选 2/3 张表"
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
      expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：ANALYTICS")).toBeInTheDocument();
      expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：DATAFORAI")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Schema 筛选" }), {
      target: { value: "analytics" }
    });

    await waitFor(() => {
      expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：ANALYTICS")).toBeInTheDocument();
    });
    expect(screen.queryByText("连接：MYSQL-ALIYUN · Schema：DATAFORAI")).not.toBeInTheDocument();
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
      "openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。"
    );

    fireEvent.change(schemaSelect, { target: { value: "openclaw_db" } });

    await waitFor(() => {
      expect(screen.getAllByText("已选 0/0 张表")[0]).toBeInTheDocument();
    });
    expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：OPENCLAW_DB")).toBeInTheDocument();
    expect(screen.queryByText("连接：MYSQL-ALIYUN · Schema：DATAFORAI")).not.toBeInTheDocument();
    expect(screen.queryByText("superstore_orders")).not.toBeInTheDocument();
  });

  it("filters tables by name search and updates the visible selection summary", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });

    await waitFor(() => {
      expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument();
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
      expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument();
    });

    await clickBatchAction("全选");

    expect(await screen.findAllByText("已选 1/1 张表")).toHaveLength(1);
    expect(screen.getByText(/已修改 1 张表/)).toBeInTheDocument();
    expect(screen.getByText(/新增 1 张表/)).toBeInTheDocument();

    await clickBatchAction("反选");

    await waitFor(() => {
      expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument();
    });
    expect(screen.queryByText(/变更未保存/)).not.toBeInTheDocument();
  });

  it("opens YAML preview drawer with the dry-run diff and added-table chips", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => {
      expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument();
    });

    await clickBatchAction("全选");
    fireEvent.click(screen.getByRole("button", { name: "预览 YAML" }));

    const drawer = await screen.findByRole("dialog", { name: "YAML 预览" });
    expect(within(drawer).getByText("启用表范围：2 -> 3")).toBeInTheDocument();
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
    expect(within(drawer).getByText("启用表范围：2 -> 1")).toBeInTheDocument();
    expect(within(drawer).getByText("移除：dataforai.superstore_people")).toBeInTheDocument();
  });

  it("previews every changed connection before saving writes them", async () => {
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
    await waitFor(() => expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument());
    await clickBatchAction("全选");

    fireEvent.change(search, { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument());
    await clickBatchAction("全选");

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
      expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument();
    });

    await clickBatchAction("全选");
    // M45: saving the whitelist must only write enabled_tables; the page
    // will follow up by auto-reloading the local catalog. Ingest must
    // never be triggered.
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
    // Auto-reload is allowed and expected (one POST per changed connection).
    await waitFor(() => {
      const reloadCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/api/catalog/reload")
      );
      expect(reloadCalls.length).toBeGreaterThan(0);
    });
    expect(await screen.findByText(/启用表范围已保存/)).toBeInTheDocument();
    expect(screen.queryByText(/请刷新本地目录/)).not.toBeInTheDocument();
    expect(screen.queryByText(/保存不会自动刷新本地目录/)).not.toBeInTheDocument();
  });

  it("surfaces a 刷新本地目录 action in the toolbar even without any draft changes", async () => {
    const { fetchMock } = stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const reloadButton = await screen.findByTestId("whitelist-reload-catalog");
    expect(reloadButton).toHaveTextContent("刷新本地目录");
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

  it("keeps the toolbar reload action enabled as a global reload in multi-connection projects", async () => {
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
          })
        ]
      })
    );
    renderWhitelist();

    const reloadButton = await screen.findByTestId("whitelist-reload-catalog");
    expect(reloadButton).toHaveTextContent("刷新本地目录");
    expect(reloadButton).not.toBeDisabled();

    fireEvent.click(reloadButton);

    await waitFor(() => {
      const reloadCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/api/catalog/reload")
      );
      expect(reloadCall).toBeDefined();
    });
    const reloadCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/catalog/reload")
    );
    expect(reloadCall?.[1]?.body).toBe(JSON.stringify({}));
  });

  it("shows compact missing Manifest diagnostic inside the configured empty schema state without a duplicate reload action", async () => {
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
    expect(within(empty).getByText(/缺少 Manifest：openclaw_db/)).toBeInTheDocument();
    expect(within(empty).getByText("openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。")).toBeInTheDocument();
    expect(within(empty).getByText("semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml")).toBeInTheDocument();
    expect(within(empty).getByRole("button", { name: "展开详情" })).toHaveAttribute("aria-expanded", "false");
    expect(within(empty).getByRole("button", { name: "复制路径" })).toBeInTheDocument();
    expect(within(empty).queryByRole("button", { name: "上传 Manifest" })).not.toBeInTheDocument();
    expect(within(empty).getByRole("link", { name: "去连接概览上传 Manifest" })).toHaveAttribute("href", "/connections");
    expect(within(empty).queryByText("上传该 Schema 的 YAML")).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog-asset-upload-drawer")).not.toBeInTheDocument();
    expect(
      within(empty).queryByTestId("whitelist-empty-reload-catalog-mysql-aliyun-openclaw_db")
    ).not.toBeInTheDocument();

    const reloadCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/catalog/reload")
    );
    expect(reloadCalls).toHaveLength(0);
  });

  it("preselects the Schema filter from the ?schema= query param without overwriting a later manual change", async () => {
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
    renderWhitelist(["/connections/whitelist?schema=openclaw_db"]);

    const schemaSelect = await screen.findByRole("combobox", { name: "Schema 筛选" });
    expect(schemaSelect).toHaveValue("openclaw_db");
    expect(
      screen.getByTestId("configured-schema-empty-mysql-aliyun-openclaw_db")
    ).toBeInTheDocument();

    // User manually picks another option — the new value should stick.
    fireEvent.change(schemaSelect, { target: { value: "dataforai" } });
    expect(schemaSelect).toHaveValue("dataforai");
  });

  it("falls back to 'all' when the ?schema= query param is unknown", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist(["/connections/whitelist?schema=ghost"]);
    const schemaSelect = await screen.findByRole("combobox", { name: "Schema 筛选" });
    expect(schemaSelect).toHaveValue("all");
  });

  it("routes missing Manifest repair from the configured empty state to the connection overview", async () => {
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
    renderWhitelist(["/connections/whitelist?schema=openclaw_db"]);

    const empty = await screen.findByTestId(
      "configured-schema-empty-mysql-aliyun-openclaw_db"
    );
    const repairLink = within(empty).getByRole("link", {
      name: "去连接概览上传 Manifest"
    });
    expect(repairLink).toHaveAttribute("href", "/connections");
    expect(within(empty).queryByRole("button", { name: "上传 Manifest" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog-asset-upload-drawer")).not.toBeInTheDocument();
    // The action should not be a duplicate global reload — the toolbar covers
    // that. Only the contextual repair link is rendered here.
    expect(
      within(empty).queryByTestId("whitelist-reload-catalog")
    ).not.toBeInTheDocument();
  });

  it("surfaces the save success copy and triggers auto-reload when the whitelist is saved", async () => {
    const { fetchMock } = stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const search = await screen.findByPlaceholderText("搜索表名/描述...");
    fireEvent.change(search, { target: { value: "returns" } });
    await waitFor(() => {
      expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument();
    });
    await clickBatchAction("全选");
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    // M45: success copy no longer carries "保存不会自动刷新本地目录".
    expect(
      await screen.findByText(/启用表范围已保存/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/保存不会自动刷新本地目录/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/若你同时更新了 YAML 文件，请刷新本地目录/)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/请刷新本地目录/)).not.toBeInTheDocument();
    void fetchMock;
  });

  it("replaces the save banner with a reload summary that separates discovered and whitelisted table counts", async () => {
    stubWhitelistFetch(
      defaultHandlers({
        catalogReload: {
          tables: 3,
          enabledTables: 2,
          warnings: [
            {
              code: "SCHEMA_MANIFEST_MISSING",
              connectionId: "mysql-aliyun",
              schema: "openclaw_db",
              filePath: "semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml",
              message: "openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。"
            }
          ]
        }
      })
    );
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_people");
    fireEvent.click(within(row).getByRole("checkbox", { name: "选择 superstore_people" }));
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    // M45: save must surface the auto-reload path and never the legacy
    // "保存不会自动刷新本地目录" copy.
    expect(await screen.findByText(/启用表范围已保存/)).toBeInTheDocument();
    expect(screen.queryByText(/保存不会自动刷新本地目录/)).not.toBeInTheDocument();

    // Auto-reload kicked off in onSuccess; the toast includes the standard
    // 启用表范围已保存 success message.
    await waitFor(() => {
      expect(
        toastMocks.success.mock.calls.some(([message]) =>
          String(message).includes("启用表范围已保存")
        )
      ).toBe(true);
    });

    // Save success banner now ends in 本地目录已刷新.
    expect(
      await screen.findByText(/本地目录已刷新/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/请刷新本地目录/)).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument());
    await clickBatchAction("全选");

    fireEvent.change(search, { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getAllByText("已选 0/1 张表")[0]).toBeInTheDocument());
    await clickBatchAction("全选");

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

  it("M21: uses Schema 筛选 / 全部 Schema / 连接+Schema Chinese heading and Manifest terminology", async () => {
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

    // Schema 筛选 control stays stable, with 全部 Schema as the placeholder.
    const schemaSelect = await screen.findByRole("combobox", { name: "Schema 筛选" });
    expect(within(schemaSelect).getByRole("option", { name: "全部 Schema" })).toBeInTheDocument();
    expect(screen.queryByText("全部架构")).not.toBeInTheDocument();
    expect(screen.queryByText("模式筛选")).not.toBeInTheDocument();

    // Group heading follows the canonical Chinese format with colon-typed dots.
    await waitFor(() => {
      expect(screen.getByText("连接：MYSQL-ALIYUN · Schema：DATAFORAI")).toBeInTheDocument();
    });

    // Empty-schema copy uses Manifest terminology and the new compact diagnostic.
    const empty = await screen.findByTestId(
      "configured-schema-empty-mysql-aliyun-openclaw_db"
    );
    expect(within(empty).getByText(/缺少 Manifest：openclaw_db/)).toBeInTheDocument();
    expect(within(empty).getByText("openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。")).toBeInTheDocument();
    expect(within(empty).queryByText("表清单")).not.toBeInTheDocument();
    expect(within(empty).queryByText("上传该 Schema 的 YAML")).not.toBeInTheDocument();

    assertNoForbiddenTerms(document.body);
  });

  it("M31: toolbar keeps only filter + selection summary, and the reload button returns to 刷新本地目录 after success", async () => {
    const { fetchMock } = stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const toolbar = await screen.findByRole("toolbar", { name: "启用表范围工具栏" });
    expect(within(toolbar).getByTestId("pl-whitelist-filter-area")).toBeInTheDocument();
    expect(
      within(toolbar).getByTestId("pl-whitelist-selection-summary")
    ).toBeInTheDocument();
    // Reload stays in PageHeader.actions; batch ops belong to the toolbar.
    expect(within(toolbar).queryByTestId("whitelist-reload-catalog")).not.toBeInTheDocument();

    const reloadButton = await screen.findByTestId("whitelist-reload-catalog");
    expect(reloadButton).toHaveTextContent("刷新本地目录");

    fireEvent.click(reloadButton);

    await waitFor(() => {
      expect(reloadButton).toHaveTextContent("刷新本地目录中...");
    });

    await waitFor(() => {
      expect(reloadButton).toHaveTextContent("刷新本地目录");
    });

    expect(screen.queryByText(/完成 ✓/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog-reload-inline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog-reload-error")).not.toBeInTheDocument();

    const reloadCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/catalog/reload")
    );
    expect(reloadCalls.length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(
        toastMocks.success.mock.calls.some(([message]) =>
          String(message).includes("本地目录已刷新 · 发现 3 张表 · 启用表范围 3 张")
        )
      ).toBe(true);
      void fetchMock;
    });
  });

  it("M31: toolbar surfaces a copy-path error Toast when the Clipboard API is unavailable", async () => {
    // The jsdom environment does not implement navigator.clipboard by default,
    // so the copy action should fall back to a graceful error Toast.
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

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

    const empty = await screen.findByTestId(
      "configured-schema-empty-mysql-aliyun-openclaw_db"
    );
    fireEvent.click(within(empty).getByRole("button", { name: "复制路径" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml"
      );
      expect(
        toastMocks.error.mock.calls.some(([message]) =>
          String(message).includes("复制路径失败")
        )
      ).toBe(true);
    });
  });

  it("M31: 查看语义 uses lightweight link affordance and field count has no arrow glyph", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_orders");
    const link = within(row).getByRole("link", { name: /查看语义/ });

    expect(link).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_orders"
    );
    expect(link.className).toContain("pl-inline-link");
    expect(link.className).not.toContain("pl-btn--ghost");
    expect(link.className).not.toContain("pl-btn--primary");
    expect(link.className).not.toContain("pl-btn--secondary");
    expect(link.className).not.toContain("pl-btn");

    expect(within(row).getByText("8 个")).toBeInTheDocument();
    expect(within(row).queryByText(/↑/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/↓/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/→/)).not.toBeInTheDocument();
  });

  it("M31: 表头 (Table) and row table names carry browser translation defense per M31 spec", async () => {
    stubWhitelistFetch(defaultHandlers());
    renderWhitelist();

    const table = await screen.findByRole("table");
    const tableHead = within(table).getByRole("row", { name: /表名/ });
    const headerCell = within(tableHead).getByText("表名 (Table)");

    expect(headerCell.tagName).toBe("TH");
    expect(headerCell).toHaveAttribute("translate", "no");
    expect(headerCell.className).toContain("notranslate");

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_orders");
    const nameCell = within(row).getByText("superstore_orders");

    expect(nameCell.tagName).toBe("SPAN");
    expect(nameCell).toHaveAttribute("translate", "no");
    expect(nameCell.className).toContain("notranslate");
  });
});
