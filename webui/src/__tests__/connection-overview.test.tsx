// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionInfo } from "../lib/types";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { assertNoForbiddenTerms } from "./forbidden-terms";

function renderOverview() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConnectionOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

function sourceSummary(table: string, schema = "dataforai") {
  return {
    conn: "mysql-aliyun",
    schema,
    table,
    filePath: "",
    columnCount: 1,
    columnNames: [],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 0,
    joinCount: 0,
    wikiRefCount: 0,
    completion: "partial",
    mtime: ""
  };
}

type TestHandler = (body: unknown, init?: RequestInit) => Response | Promise<Response>;

function makeHandlerMap(
  projectHandler: TestHandler,
  catalogReloadsHandler?: TestHandler
): Record<string, TestHandler> {
  return {
    "GET /api/project": projectHandler,
    "GET /api/sources": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { tables: [sourceSummary("superstore_orders"), sourceSummary("customers"), sourceSummary("orders", "crm")] }
        })
      ),
    "GET /api/catalog/reloads": catalogReloadsHandler ?? (() => new Response(JSON.stringify({ ok: true, data: { runs: [], last: null, lastByConnection: {} } })))
  };
}

function stubOverviewFetch({
  connections = [
    {
      id: "mysql-aliyun",
      driver: "mysql",
      host: "127.0.0.1",
      port: "3306",
      database: "dataforai",
      schemas: ["dataforai"],
      enabledTables: ["dataforai.superstore_orders", "dataforai.customers"]
    }
  ],
  ktxAvailable = true,
  projectError = false,
  tables = [sourceSummary("superstore_orders"), sourceSummary("customers"), sourceSummary("orders", "crm")],
	  catalogReloadsResponse,
	  catalogReloadsPending = false,
	  catalogReloadsError,
	  catalogReloadPostError,
	  mcpEndpoint
	}: {
	  connections?: ConnectionInfo[];
	  ktxAvailable?: boolean;
	  projectError?: boolean;
  tables?: ReturnType<typeof sourceSummary>[];
	  catalogReloadsResponse?: { runs: unknown[]; last: unknown | null; lastByConnection: Record<string, unknown> };
	  catalogReloadsPending?: boolean;
	  catalogReloadsError?: string;
	  catalogReloadPostError?: string;
	  mcpEndpoint?: {
    url: string | null;
    status: "configured" | "fallback" | "invalid";
    source: "env" | "fallback";
    configured: boolean;
    diagnostics: Array<{ code: string; message: string }>;
  };
} = {}) {
  const resolvedMcpEndpoint = mcpEndpoint ?? {
    url: "https://lucy.example.com/mcp",
    status: "configured" as const,
    source: "env" as const,
    configured: true,
    diagnostics: []
  };
  const handlers = makeHandlerMap(
    (() => {
      if (projectError) {
        return () =>
          new Response(
            JSON.stringify({ ok: false, error: { code: "PROJECT_FAILED", message: "project unavailable" } }),
            { status: 500 }
          );
      }
      return () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              root: "/tmp/project-lucy",
              ktxAvailable,
              connections,
              mcpEndpoint: resolvedMcpEndpoint
            }
          })
        );
    })(),
    catalogReloadsPending
      ? () => new Promise<Response>(() => {})
      : catalogReloadsError
        ? () =>
            new Response(
              JSON.stringify({ ok: false, error: { code: "CATALOG_RELOADS_FAILED", message: catalogReloadsError } }),
              { status: 500 }
            )
        : catalogReloadsResponse
          ? () => new Response(JSON.stringify({ ok: true, data: catalogReloadsResponse }))
          : undefined
  );
	  // tables override
	  handlers["GET /api/sources"] = () =>
	    new Response(JSON.stringify({ ok: true, data: { tables } }));
	  if (catalogReloadPostError) {
	    handlers["POST /api/catalog/reload"] = () =>
	      new Response(
	        JSON.stringify({
	          ok: false,
	          error: { code: "CATALOG_RELOAD_FAILED", message: catalogReloadPostError }
	        }),
	        { status: 500 }
	      );
	  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    })
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnectionOverview", () => {
  it("renders sourced status metrics and quick actions", async () => {
    stubOverviewFetch();

    renderOverview();

    expect(await screen.findByRole("heading", { name: "连接概览" })).toBeInTheDocument();
    expect(screen.getAllByTestId("connection-metric")).toHaveLength(4);
    expect(screen.getByText("数据连接")).toBeInTheDocument();
    expect(screen.getByText("启用的表")).toBeInTheDocument();
    expect(screen.getByText("语义层对象")).toBeInTheDocument();
    expect(screen.getByText("Catalog 状态")).toBeInTheDocument();
    expect(screen.queryByText("语义源")).not.toBeInTheDocument();
    expect(screen.queryByText("KTX Runtime")).not.toBeInTheDocument();
    expect(screen.getByText("mysql-aliyun")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:3306")).toBeInTheDocument();
    expect(screen.getAllByText("dataforai").length).toBeGreaterThan(0);
    // M17: cross-page navigation must NOT live in the page header anymore.
    expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "连通测试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开表目录" })).not.toBeInTheDocument();
    // M44: connection-level upload is no longer in the card footer.
    // The row-level "上传 Manifest" link is the only upload affordance.
    expect(screen.queryByRole("button", { name: "上传 Schema Manifest" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传 YAML" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "刷新本地目录" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    expect(screen.queryByText("运行连通测试")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP endpoint")).not.toBeInTheDocument();
  });

  it("renders an accessible ⓘ help trigger for every metric", async () => {
    stubOverviewFetch();
    renderOverview();

    for (const label of ["数据连接", "启用的表", "语义层对象", "Catalog 状态"]) {
      expect(
        await screen.findByRole("button", { name: `${label} 管理含义` })
      ).toBeInTheDocument();
    }
  });

  it("shows per-schema manifest status and the correct next action", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders", "dataforai")],
      catalogReloadsResponse: {
        runs: [],
        last: null,
        lastByConnection: {
          "mysql-aliyun": {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "mysql-aliyun",
            connectionIds: ["mysql-aliyun"],
            connections: 1,
            configuredSchemas: 2,
            manifestSchemas: 1,
            tables: 1,
            enabledTables: 1,
            warnings: [
              {
                code: "SCHEMA_MANIFEST_MISSING",
                connectionId: "mysql-aliyun",
                schema: "openclaw_db",
                filePath: "semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml",
                message: "openclaw_db manifest missing"
              }
            ],
            source: "static-yaml"
          }
        }
      }
    });
    renderOverview();

    expect(await screen.findByTestId("schema-asset-table-mysql-aliyun")).toBeInTheDocument();
    expect(screen.queryByText("关联 Schema 资产列表")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Schema" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Manifest 状态" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "本地表数" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "启用表数" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(
      await screen.findByTestId("schema-asset-status-mysql-aliyun-dataforai")
    ).toHaveTextContent("已存在");
    expect(screen.getByTestId("schema-row-mysql-aliyun-dataforai")).toHaveTextContent("1 张表");
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).toHaveAttribute(
      "href",
      "/connections/whitelist?schema=dataforai"
    );
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).toHaveClass(
      "pl-row-action-link"
    );
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).toHaveTextContent(
      "维护启用范围"
    );
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).not.toHaveClass(
      "pl-btn",
      "pl-btn--ghost",
      "pl-btn--primary",
      "pl-btn--secondary"
    );
    expect(screen.queryByText("维护白名单")).not.toBeInTheDocument();
    expect(screen.getByTestId("schema-enabled-count-mysql-aliyun-dataforai")).toHaveTextContent("1 张表");
    expect(screen.getByTestId("schema-enabled-count-mysql-aliyun-openclaw_db")).toHaveTextContent("0 张表");

    expect(screen.getByTestId("schema-asset-status-mysql-aliyun-openclaw_db")).toHaveTextContent(
      "缺失 Manifest"
    );
    expect(screen.getByTestId("schema-row-mysql-aliyun-openclaw_db")).toHaveAttribute(
      "data-tone",
      "warning"
    );
    expect(screen.getByTestId("schema-row-mysql-aliyun-openclaw_db")).not.toHaveClass(
      "pl-catalog-reload-warning"
    );
    expect(screen.getByTestId("schema-row-mysql-aliyun-openclaw_db")).toHaveTextContent("0 张表");
    expect(screen.getByTestId("upload-yaml-mysql-aliyun-openclaw_db")).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-reload-warning-mysql-aliyun-openclaw_db")).not.toBeInTheDocument();
    const warningToggle = screen.getByTestId("catalog-reload-warning-toggle-mysql-aliyun-openclaw_db");
    expect(warningToggle).toHaveTextContent("查看详情");
    fireEvent.click(warningToggle);
    const warningSubrow = screen.getByTestId("catalog-reload-warning-mysql-aliyun-openclaw_db");
    expect(warningSubrow.tagName).toBe("TR");
    expect(warningSubrow).toHaveTextContent("缺少 Manifest");
  });

  it("shows management-meaning Tooltip content on the 数据连接 help trigger", async () => {
    stubOverviewFetch();
    renderOverview();

    const trigger = await screen.findByRole("button", { name: "数据连接 管理含义" });
    fireEvent.focus(trigger);

    // Radix Tooltip 1.x renders a visual popper plus a visually-hidden a11y
    // mirror, so the title shows up twice. Assert on the first occurrence.
    const titles = await screen.findAllByTestId("metric-tooltip-title");
    expect(titles[0]).toHaveTextContent("数据连接 · 管理含义");
    expect(screen.getAllByText("关注问题：").length).toBeGreaterThan(0);
    expect(screen.getAllByText("打通了多少个物理数据源？数据孤岛破除了多少？").length).toBeGreaterThan(0);
    expect(screen.getAllByText("定义：").length).toBeGreaterThan(0);
    expect(screen.getAllByText("打通的物理数据库数量，决定跨库联合查询的基础范围。").length).toBeGreaterThan(0);
    expect(screen.getAllByText("健康标准：").length).toBeGreaterThan(0);
    expect(screen.getAllByText("至少包含 1 个生产/测试数据库").length).toBeGreaterThan(0);
  });

  it("does not render MCP endpoint runtime config inside the connection overview", async () => {
    stubOverviewFetch({
      mcpEndpoint: {
        url: "http://127.0.0.1:7879/mcp",
        status: "fallback",
        source: "fallback",
        configured: false,
        diagnostics: [
          {
            code: "MISSING_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
          }
        ]
      }
    });

    renderOverview();

    expect(await screen.findByText("mysql-aliyun")).toBeInTheDocument();
    expect(screen.queryByText("MCP endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText("http://127.0.0.1:7879/mcp")).not.toBeInTheDocument();
    expect(screen.queryByTestId("copy-mcp-endpoint")).not.toBeInTheDocument();
  });

  it("shows the Doris R1 target connection profile", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "doris-r1",
          driver: "mysql",
          engine: "doris",
          wireProtocol: "mysql",
          r1Target: true,
          readOnlyExpected: true,
          host: "10.0.0.8",
          port: "9030",
          database: "mart",
          schemas: ["mart"],
          enabledTables: ["mart.ceo_metric_snapshot"]
        }
      ],
      tables: [sourceSummary("ceo_metric_snapshot", "mart")]
    });

    renderOverview();

    expect(await screen.findByText("doris-r1")).toBeInTheDocument();
    expect(screen.getByTestId("engine-badge-doris-r1")).toHaveTextContent("Doris");
    expect(screen.getByText("10.0.0.8:9030")).toBeInTheDocument();
    expect(screen.getByTestId("connection-card-doris-r1")).not.toHaveTextContent("预期只读");
    expect(screen.queryByTestId("connection-readonly-doris-r1")).not.toBeInTheDocument();
    expect(screen.getByTestId("connection-card-doris-r1")).not.toHaveTextContent("Read-only expected");
  });

  it("shows the StarRocks R1 target connection profile", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "starrocks-r1",
          driver: "mysql",
          engine: "starrocks",
          wireProtocol: "mysql",
          r1Target: true,
          readOnlyExpected: true,
          host: "10.0.0.9",
          port: "9030",
          database: "mart",
          schemas: ["mart"],
          enabledTables: ["mart.ceo_metric_snapshot"]
        }
      ],
      tables: [sourceSummary("ceo_metric_snapshot", "mart")]
    });

    renderOverview();

    expect(await screen.findByText("starrocks-r1")).toBeInTheDocument();
    expect(screen.getByTestId("engine-badge-starrocks-r1")).toHaveTextContent("StarRocks");
    expect(screen.getByText("10.0.0.9:9030")).toBeInTheDocument();
    const card = screen.getByTestId("connection-card-starrocks-r1");
    expect(card).not.toHaveTextContent("预期只读");
    expect(within(card).queryByTestId("connection-readonly-starrocks-r1")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("Read-only expected");
  });

  it("shows localized status for non-read-only connection metadata", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "write-risk-db",
          driver: "mysql",
          readOnlyExpected: false,
          passwordSource: "inline",
          host: "127.0.0.1",
          port: "3306",
          database: "demo",
          schemas: ["demo"],
          enabledTables: ["demo.orders"]
        }
      ],
      tables: [sourceSummary("orders", "demo")]
    });

    renderOverview();

    const card = await screen.findByTestId("connection-card-write-risk-db");
    expect(card).toHaveTextContent("未声明只读");
    expect(card).not.toHaveTextContent("Write-risk");
    expect(within(card).getByTestId("connection-readonly-write-risk-db")).toHaveAttribute(
      "title",
      "来自 ktx.yaml 的 readonly 标记；真实只读能力由数据库账号权限保证。"
    );
    // M44: the credential source is no longer surfaced per card; only Host/Database
    // remain in the KeyValue grid.
    expect(within(card).queryByText("inline")).not.toBeInTheDocument();
    expect(within(card).queryByText("凭据：inline")).not.toBeInTheDocument();
    expect(within(card).queryByText("凭据来源")).not.toBeInTheDocument();
    expect(within(card).queryByText("配置文件")).not.toBeInTheDocument();
  });

  it("keeps the overview layout stable with no connections", async () => {
    stubOverviewFetch({ connections: [], tables: [] });
    renderOverview();

    expect(await screen.findByText("暂无连接配置，请在 ktx.yaml 中添加 connections。")).toBeInTheDocument();
    expect(screen.getByText("数据连接")).toBeInTheDocument();
    expect(screen.getByText("语义层对象")).toBeInTheDocument();
  });

  it("shows project API errors", async () => {
    stubOverviewFetch({ projectError: true });
    renderOverview();

    expect(await screen.findByText("连接状态加载失败：project unavailable")).toBeInTheDocument();
  });

  it("M44: keeps the header compact (no project-root context, no pill badge)", async () => {
    stubOverviewFetch({ ktxAvailable: false });
    renderOverview();

    const header = await screen.findByTestId("page-header");
    expect(header.querySelector(".pl-page-header-badges")).toBeNull();
    expect(header).toHaveTextContent("维护每个连接的 Schema、YAML 资产与本地目录刷新状态。");
    expect(within(header).queryByText("工作目录：")).not.toBeInTheDocument();
    expect(within(header).queryByText("/tmp/project-lucy")).not.toBeInTheDocument();
    expect(within(header).queryByText("KTX 不可用")).not.toBeInTheDocument();
    expect(within(header).queryByTestId("page-header-badge-root")).not.toBeInTheDocument();
  });

  it("M17: keeps the header compact (no connection count, no KTX badge, no big description card)", async () => {
    stubOverviewFetch();
    renderOverview();

    expect(await screen.findByRole("heading", { name: "连接概览" })).toBeInTheDocument();
    expect(screen.queryByText("1 个连接")).not.toBeInTheDocument();
    expect(screen.queryByText("KTX 可用")).not.toBeInTheDocument();
    expect(
      screen.queryByText("连接配置来自当前项目，不在 WebUI 中直接编辑凭据。")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("配置来源：ktx.yaml。凭据不在 WebUI 中编辑。")
    ).not.toBeInTheDocument();
    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    const kv = within(card).getByTestId("connection-kv-mysql-aliyun");
    expect(within(kv).getByText("Host")).toBeInTheDocument();
    expect(within(kv).getByText("Database")).toBeInTheDocument();
    // M44: ktx.yaml and credential source no longer surface per card.
    expect(within(card).queryByText("配置文件")).not.toBeInTheDocument();
    expect(within(card).queryByText("凭据来源")).not.toBeInTheDocument();
    expect(within(card).queryByText("ktx.yaml")).not.toBeInTheDocument();
    expect(within(card).queryByText("配置：ktx.yaml")).not.toBeInTheDocument();
    expect(within(card).queryByText("凭据：file")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传 Schema Manifest" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传 YAML" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加载资产" })).not.toBeInTheDocument();
  });

  it("renders the connection-level 刷新本地目录 action and no CLI ingest wording", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsResponse: { runs: [], last: null, lastByConnection: {} }
    });
    renderOverview();

    expect(
      await screen.findByTestId("catalog-reload-mysql-aliyun")
    ).toHaveTextContent("刷新本地目录");
    expect(screen.getByTestId("catalog-reload-mysql-aliyun")).toHaveAttribute(
      "title",
      "重新读取 ktx.yaml 与 semantic-layer YAML 文件，不会连接数据库，也不会执行 ingest。"
    );
    expect(screen.queryByText(/触发 Ingest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/重新扫描/)).not.toBeInTheDocument();
  });

  it("renders one compact catalog status line from the catalog-reloads sidecar", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsResponse: {
        runs: [
          {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "mysql-aliyun",
            connectionIds: ["mysql-aliyun"],
            connections: 1,
            configuredSchemas: 1,
            manifestSchemas: 1,
            tables: 4,
            enabledTables: 4,
            warnings: [],
            source: "static-yaml"
          }
        ],
        last: {
          id: "rel_20260729_103000_001",
          status: "success",
          startedAt: "2026-07-29T02:30:00.000Z",
          finishedAt: "2026-07-29T02:30:00.045Z",
          durationMs: 45,
          requestedConnectionId: "mysql-aliyun",
          connectionIds: ["mysql-aliyun"],
          connections: 1,
          configuredSchemas: 1,
          manifestSchemas: 1,
          tables: 4,
          enabledTables: 4,
          warnings: [],
          source: "static-yaml"
        },
        lastByConnection: {
          "mysql-aliyun": {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "mysql-aliyun",
            connectionIds: ["mysql-aliyun"],
            connections: 1,
            configuredSchemas: 1,
            manifestSchemas: 1,
            tables: 4,
            enabledTables: 4,
            warnings: [],
            source: "static-yaml"
          }
        }
      }
    });
    renderOverview();

    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    // M44: success state lives in the header-right refresh timestamp only;
    // the body no longer renders `本地目录已刷新 ... 已完成 ... 4 张表`.
    const headerTimestamp = within(card).getByTestId("connection-last-reload-mysql-aliyun");
    expect(headerTimestamp).toHaveTextContent("上次刷新：");
    expect(headerTimestamp).toHaveTextContent("2026-07-29 10:30");
    expect(within(card).queryByTestId("catalog-reload-status-mysql-aliyun")).not.toBeInTheDocument();
    expect(within(card).queryByText("本地目录已刷新")).not.toBeInTheDocument();
    expect(within(card).queryByText("已完成")).not.toBeInTheDocument();
    expect(within(card).queryByText("4 张表")).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog-last-run")).not.toBeInTheDocument();
    expect(within(card).queryByText("尚未读取本地 YAML")).not.toBeInTheDocument();
  });

  it("M24: renders card-local reload status, Schema context, and inline missing Manifest diagnostics", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "demo-mysql",
          driver: "mysql",
          host: "demo-db",
          port: "3306",
          database: "dataforai",
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [
        { ...sourceSummary("superstore_orders"), conn: "demo-mysql", schema: "dataforai" },
        { ...sourceSummary("customers"), conn: "demo-mysql", schema: "dataforai" },
        { ...sourceSummary("orders"), conn: "demo-mysql", schema: "dataforai" }
      ],
      catalogReloadsResponse: {
        runs: [],
        last: {
          id: "rel_20260729_103000_001",
          status: "success",
          startedAt: "2026-07-29T02:30:00.000Z",
          finishedAt: "2026-07-29T02:30:00.045Z",
          durationMs: 45,
          requestedConnectionId: "demo-mysql",
          connectionIds: ["demo-mysql"],
          connections: 1,
          configuredSchemas: 2,
          manifestSchemas: 1,
          tables: 3,
          enabledTables: 1,
          warnings: [
            {
              code: "SCHEMA_MANIFEST_MISSING",
              connectionId: "demo-mysql",
              schema: "openclaw_db",
              filePath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
              message: "openclaw_db manifest missing"
            }
          ],
          source: "static-yaml"
        },
        lastByConnection: {
          "demo-mysql": {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "demo-mysql",
            connectionIds: ["demo-mysql"],
            connections: 1,
            configuredSchemas: 2,
            manifestSchemas: 1,
            tables: 3,
            enabledTables: 1,
            warnings: [
              {
                code: "SCHEMA_MANIFEST_MISSING",
                connectionId: "demo-mysql",
                schema: "openclaw_db",
                filePath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
                message: "openclaw_db manifest missing"
              }
            ],
            source: "static-yaml"
          }
        }
      }
    });
    renderOverview();

    const card = await screen.findByTestId("connection-card-demo-mysql");
    const kv = within(card).getByTestId("connection-kv-demo-mysql");
    expect(within(kv).getByText("Host")).toBeInTheDocument();
    expect(within(kv).getByText("Database")).toBeInTheDocument();
    expect(within(card).queryByText("配置文件")).not.toBeInTheDocument();
    expect(within(card).queryByText("凭据来源")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("配置：ktx.yaml");
    expect(card).not.toHaveTextContent("配置来源：ktx.yaml。凭据不在 WebUI 中编辑。");
    // M44: success status now lives in the header-right refresh timestamp;
    // the body no longer renders `pl-catalog-reload-status` while a Banner
    // would otherwise be hidden. Healthy status surfaces as `上次刷新：<ts>`.
    const headerTimestamp = within(card).getByTestId("connection-last-reload-demo-mysql");
    expect(headerTimestamp).toHaveTextContent("上次刷新：");
    expect(within(card).queryByTestId("catalog-reload-status-demo-mysql")).not.toBeInTheDocument();
    expect(within(card).getByTestId("catalog-reload-demo-mysql")).toHaveTextContent("刷新本地目录");

    const table = within(card).getByTestId("schema-asset-table-demo-mysql");
    expect(within(card).queryByText("关联 Schema 资产列表")).not.toBeInTheDocument();
    expect(within(card).getByRole("columnheader", { name: "Manifest 状态" })).toBeInTheDocument();
    expect(within(card).getByTestId("schema-asset-status-demo-mysql-openclaw_db")).toHaveTextContent(
      "缺失 Manifest"
    );
    expect(within(card).getByTestId("schema-row-demo-mysql-openclaw_db")).toHaveTextContent("0 张表");
    expect(within(card).getByTestId("schema-enabled-count-demo-mysql-openclaw_db")).toHaveTextContent("0 张表");
    expect(within(card).queryByTestId("catalog-reload-warning-demo-mysql-openclaw_db")).not.toBeInTheDocument();
    const detailsButton = within(card).getByTestId("catalog-reload-warning-toggle-demo-mysql-openclaw_db");
    expect(detailsButton).toHaveTextContent("查看详情");
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailsButton);
    expect(detailsButton).toHaveTextContent("收起详情");
    expect(detailsButton).toHaveAttribute("aria-expanded", "true");
    const warning = within(card).getByTestId("catalog-reload-warning-demo-mysql-openclaw_db");
    expect(table).toContainElement(warning);
    expect(warning).toHaveTextContent("缺少 Manifest：openclaw_db");
    expect(warning).toHaveTextContent("semantic-layer/demo-mysql/_schema/openclaw_db.yaml");

    const collapseButton = within(warning).getByRole("button", { name: "收起详情" });
    expect(collapseButton).toHaveClass("pl-btn", "pl-btn--ghost", "pl-btn--sm");
    const copyButton = within(warning).getByRole("button", { name: "复制路径" });
    expect(copyButton).toHaveClass("pl-btn", "pl-btn--ghost", "pl-btn--sm");
    const recheckButton = within(warning).getByTestId("catalog-reload-recheck-demo-mysql-openclaw_db");
    expect(recheckButton).toHaveClass("pl-btn", "pl-btn--secondary", "pl-btn--sm");
    expect(recheckButton).toHaveTextContent("重新检查");
    expect(warning).toHaveTextContent("missing_manifest");
    expect(warning).toHaveTextContent("刷新本地目录只读取本地 YAML，不会连接数据库。");
    expect(screen.queryByText("有提示")).not.toBeInTheDocument();
  });

  it("never-run: surfaces the refresh warning banner and hides the legacy muted status row", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsResponse: { runs: [], last: null, lastByConnection: {} }
    });
    renderOverview();

    const banner = await screen.findByTestId("connection-refresh-warning-mysql-aliyun");
    expect(banner).toHaveTextContent("本地目录未刷新：尚未读取本地 YAML 资产配置。");
    // M44: when a Banner is shown, the body no longer renders the legacy
    // `本地目录未刷新 · 尚未读取本地 YAML` muted status row.
    expect(within(banner).getByTestId("connection-refresh-warning-action-mysql-aliyun")).toHaveTextContent(
      "立即刷新"
    );
    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(within(card).queryByTestId("catalog-reload-status-mysql-aliyun")).not.toBeInTheDocument();
    expect(within(card).queryByText("尚未读取本地 YAML")).not.toBeInTheDocument();
    expect(within(card).queryByTestId("connection-last-reload-mysql-aliyun")).not.toBeInTheDocument();
  });

  it("M44: surfaces an amber refresh warning banner with 立即刷新 for never-run connections", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsResponse: { runs: [], last: null, lastByConnection: {} }
    });
    renderOverview();

    const banner = await screen.findByTestId("connection-refresh-warning-mysql-aliyun");
    expect(banner).toHaveTextContent("本地目录未刷新：尚未读取本地 YAML 资产配置。");
    expect(banner).toHaveClass("pl-connection-refresh-warning");
    const refreshAction = within(banner).getByTestId("connection-refresh-warning-action-mysql-aliyun");
    expect(refreshAction).toHaveTextContent("立即刷新");
    expect(refreshAction.textContent ?? "").not.toMatch(/[↗→]/);
    expect(refreshAction).toHaveClass("pl-btn--ghost");
    expect(refreshAction).not.toHaveClass("pl-btn--primary");
    // The Catalog 状态 metric carries the warning tone.
    const catalogMetric = screen
      .getAllByTestId("connection-metric")
      .find((node) => node.getAttribute("data-metric") === "catalogStatus");
    expect(catalogMetric).toHaveClass("pl-metric-card--warning");
    assertNoForbiddenTerms(document.body);
  });

  it("M44: does not show never-run warnings while catalog reload history is still loading", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsPending: true
    });
    renderOverview();

    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(within(card).queryByTestId("connection-refresh-warning-mysql-aliyun")).not.toBeInTheDocument();
    expect(within(card).getByTestId("catalog-reload-status-mysql-aliyun")).toHaveTextContent(
      "正在读取本地目录状态..."
    );
    const catalogMetric = screen
      .getAllByTestId("connection-metric")
      .find((node) => node.getAttribute("data-metric") === "catalogStatus");
    expect(catalogMetric).toHaveTextContent("加载中");
    expect(catalogMetric).not.toHaveClass("pl-metric-card--warning");
  });

  it("M44: does not show never-run warnings when catalog reload history fails to load", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsError: "reload history unavailable"
    });
    renderOverview();

    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(within(card).queryByTestId("connection-refresh-warning-mysql-aliyun")).not.toBeInTheDocument();
    expect(within(card).getByTestId("catalog-reload-status-mysql-aliyun")).toHaveTextContent(
      "本地目录状态加载失败"
    );
    const catalogMetric = screen
      .getAllByTestId("connection-metric")
      .find((node) => node.getAttribute("data-metric") === "catalogStatus");
    expect(catalogMetric).toHaveTextContent("加载失败");
    expect(catalogMetric).toHaveClass("pl-metric-card--danger");
  });

	  it("M44: hides the refresh warning and warning tone once a successful catalog run exists", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsResponse: {
        runs: [],
        last: {
          id: "rel_20260729_103000_001",
          status: "success",
          startedAt: "2026-07-29T02:30:00.000Z",
          finishedAt: "2026-07-29T02:30:00.045Z",
          durationMs: 45,
          requestedConnectionId: "mysql-aliyun",
          connectionIds: ["mysql-aliyun"],
          connections: 1,
          configuredSchemas: 1,
          manifestSchemas: 1,
          tables: 1,
          enabledTables: 1,
          warnings: [],
          source: "static-yaml"
        },
        lastByConnection: {
          "mysql-aliyun": {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "mysql-aliyun",
            connectionIds: ["mysql-aliyun"],
            connections: 1,
            configuredSchemas: 1,
            manifestSchemas: 1,
            tables: 1,
            enabledTables: 1,
            warnings: [],
            source: "static-yaml"
          }
        }
      }
    });
    renderOverview();

    expect(
      screen.queryByTestId("connection-refresh-warning-mysql-aliyun")
    ).not.toBeInTheDocument();
    const catalogMetric = await screen
      .findAllByTestId("connection-metric")
      .then((nodes) => nodes.find((node) => node.getAttribute("data-metric") === "catalogStatus"));
    expect(catalogMetric).toBeDefined();
	    expect(catalogMetric).not.toHaveClass("pl-metric-card--warning");
	  });

	  it("M44: surfaces a footer alert when manual catalog reload fails", async () => {
	    stubOverviewFetch({
	      catalogReloadPostError: "local YAML scan failed",
	      catalogReloadsResponse: {
	        runs: [],
	        last: {
	          id: "rel_20260729_103000_001",
	          status: "success",
	          startedAt: "2026-07-29T02:30:00.000Z",
	          finishedAt: "2026-07-29T02:30:00.045Z",
	          durationMs: 45,
	          requestedConnectionId: "mysql-aliyun",
	          connectionIds: ["mysql-aliyun"],
	          connections: 1,
	          configuredSchemas: 1,
	          manifestSchemas: 1,
	          tables: 1,
	          enabledTables: 1,
	          warnings: [],
	          source: "static-yaml"
	        },
	        lastByConnection: {
	          "mysql-aliyun": {
	            id: "rel_20260729_103000_001",
	            status: "success",
	            startedAt: "2026-07-29T02:30:00.000Z",
	            finishedAt: "2026-07-29T02:30:00.045Z",
	            durationMs: 45,
	            requestedConnectionId: "mysql-aliyun",
	            connectionIds: ["mysql-aliyun"],
	            connections: 1,
	            configuredSchemas: 1,
	            manifestSchemas: 1,
	            tables: 1,
	            enabledTables: 1,
	            warnings: [],
	            source: "static-yaml"
	          }
	        }
	      }
	    });
	    renderOverview();

	    const card = await screen.findByTestId("connection-card-mysql-aliyun");
	    fireEvent.click(within(card).getByTestId("catalog-reload-mysql-aliyun"));

	    const status = await within(card).findByTestId("catalog-reload-status-mysql-aliyun");
	    expect(status).toHaveAttribute("role", "alert");
	    expect(status).toHaveTextContent("本地目录刷新失败");
	    expect(status).toHaveTextContent("local YAML scan failed");
	  });

	  it("M44: long Host values render with overflow defenses and full value as title", async () => {
    const longHost = "rm-very-long-cluster-name-shanghai-1.cluster-abcdefghi.rds.aliyuncs.com";
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          host: longHost,
          port: "3306",
          database: "data_agent_poc",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"],
          passwordSource: "file"
        }
      ],
      tables: [sourceSummary("superstore_orders")],
      catalogReloadsResponse: { runs: [], last: null, lastByConnection: {} }
    });
    renderOverview();

    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(card.textContent ?? "").toContain(longHost);
    const hostNode = card.querySelector("code.pl-connection-kv-host");
    expect(hostNode).not.toBeNull();
    expect(hostNode).toHaveTextContent(`${longHost}:3306`);
    expect(hostNode).toHaveAttribute("title", `${longHost}:3306`);
    expect(hostNode).toHaveAttribute("dir", "ltr");
    expect(hostNode).toHaveClass("notranslate");
    expect(hostNode.closest("[translate='no']")).not.toBeNull();
    const kvHost = hostNode.closest(".pl-connection-kv");
    expect(kvHost).not.toBeNull();
    const dbNodes = Array.from(card.querySelectorAll("dd code"));
    const dbNode = dbNodes.find((node) => node.textContent === "data_agent_poc");
    expect(dbNode).toBeDefined();
    expect(dbNode).toHaveAttribute("dir", "ltr");
    expect(dbNode).toHaveClass("notranslate");
    expect(dbNode.closest("[translate='no']")).not.toBeNull();
  });

  it("M29/M44: footer hosts exactly one Primary (刷新本地目录) and the row keeps 上传 Manifest", async () => {
    stubOverviewFetch();
    renderOverview();

    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(within(card).queryByTestId("connection-card-header-actions-mysql-aliyun")).not.toBeInTheDocument();

    const footerActions = within(card).getByTestId("connection-card-schema-actions-mysql-aliyun");
    expect(within(footerActions).getByRole("button", { name: /\+ 添加 Schema/ })).toBeInTheDocument();
    expect(within(footerActions).getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
    expect(
      within(footerActions).getAllByRole("button").map((button) => button.textContent?.trim())
    ).toEqual(["+ 添加 Schema", "刷新本地目录"]);
    expect(within(footerActions).getByRole("button", { name: /\+ 添加 Schema/ })).toHaveClass("pl-btn--secondary");
    const refreshButton = within(footerActions).getByRole("button", { name: "刷新本地目录" });
    expect(refreshButton).toHaveClass("pl-btn--primary");
    expect(within(footerActions).queryByRole("button", { name: "上传 Schema Manifest" })).not.toBeInTheDocument();
    expect(within(footerActions).queryByRole("button", { name: "上传 YAML" })).not.toBeInTheDocument();
    expect(within(footerActions).queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    // Each card exposes at most one Primary across footer + banner.
    const primaryButtons = within(card).getAllByRole("button", { hidden: true }).filter((button) =>
      button.className.includes("pl-btn--primary")
    );
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]).toHaveTextContent("刷新本地目录");
    expect(within(card).getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "上传语义包" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "上传资产包" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "下载当前全量资产包" })
    ).not.toBeInTheDocument();

    // The full-width system-level export card must not live below the
    // connection list anymore.
    expect(
      screen.queryByTestId("semantic-asset-export-panel")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("connections-export-hint")).not.toBeInTheDocument();
    expect(
      screen.queryByText("下载当前全量资产包")
    ).not.toBeInTheDocument();
  });

  it("M21: missing-manifest row says 缺失 Manifest and shows the 上传 Manifest row action", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "demo-mysql",
          driver: "mysql",
          schemas: ["openclaw_db"],
          enabledTables: []
        }
      ],
      tables: [],
      catalogReloadsResponse: {
        runs: [],
        last: null,
        lastByConnection: {
          "demo-mysql": {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "demo-mysql",
            connectionIds: ["demo-mysql"],
            connections: 1,
            configuredSchemas: 1,
            manifestSchemas: 0,
            tables: 0,
            enabledTables: 0,
            warnings: [
              {
                code: "SCHEMA_MANIFEST_MISSING",
                connectionId: "demo-mysql",
                schema: "openclaw_db",
                filePath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
                message: "openclaw_db manifest missing"
              }
            ],
            source: "static-yaml"
          }
        }
      }
    });
    renderOverview();

    expect(
      await screen.findByTestId("schema-asset-status-demo-mysql-openclaw_db")
    ).toHaveTextContent("缺失 Manifest");
    const uploadBtn = await screen.findByTestId("upload-yaml-demo-mysql-openclaw_db");
    expect(uploadBtn).toHaveTextContent("上传 Manifest");
    expect(uploadBtn).toHaveClass("pl-row-action-link");
    expect(uploadBtn).toHaveClass("notranslate");
    expect(uploadBtn).toHaveAttribute("translate", "no");
    expect(uploadBtn).not.toHaveClass(
      "pl-btn",
      "pl-btn--ghost",
      "pl-btn--primary",
      "pl-btn--secondary"
    );
    fireEvent.click(uploadBtn);
    expect(
      await screen.findByRole("heading", { name: /上传 openclaw_db 的 Schema Manifest/ })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-asset-upload-schema")).not.toBeInTheDocument();
  });

  it("M21: uses 缺失 Manifest (capital M) for missing manifest rows and exposes no machine-translation artifacts", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders", "dataforai")],
      catalogReloadsResponse: {
        runs: [],
        last: null,
        lastByConnection: {
          "mysql-aliyun": {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "mysql-aliyun",
            connectionIds: ["mysql-aliyun"],
            connections: 1,
            configuredSchemas: 2,
            manifestSchemas: 1,
            tables: 1,
            enabledTables: 1,
            warnings: [
              {
                code: "SCHEMA_MANIFEST_MISSING",
                connectionId: "mysql-aliyun",
                schema: "openclaw_db",
                filePath: "semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml",
                message: "openclaw_db manifest missing"
              }
            ],
            source: "static-yaml"
          }
        }
      }
    });
    renderOverview();

    const status = await screen.findByTestId("schema-asset-status-mysql-aliyun-openclaw_db");
    expect(status).toHaveTextContent("缺失 Manifest");
    expect(status).toHaveClass("notranslate");
    expect(status).toHaveAttribute("translate", "no");
    expect(status).not.toHaveTextContent("缺失 manifest");
    expect(screen.queryByText("财政部舱单")).not.toBeInTheDocument();
    expect(screen.queryByText("模式清单")).not.toBeInTheDocument();
    assertNoForbiddenTerms(document.body);
  });
});
