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

type TestHandler = (body: unknown, init?: RequestInit) => Response;

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
  mcpEndpoint
}: {
  connections?: ConnectionInfo[];
  ktxAvailable?: boolean;
  projectError?: boolean;
  tables?: ReturnType<typeof sourceSummary>[];
  catalogReloadsResponse?: { runs: unknown[]; last: unknown | null; lastByConnection: Record<string, unknown> };
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
    catalogReloadsResponse
      ? () => new Response(JSON.stringify({ ok: true, data: catalogReloadsResponse }))
      : undefined
  );
  // tables override
  handlers["GET /api/sources"] = () =>
    new Response(JSON.stringify({ ok: true, data: { tables } }));

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
    // The per-connection card still surfaces the upload + reload actions.
    expect(screen.getAllByRole("button", { name: "上传 Schema Manifest" }).length).toBeGreaterThan(0);
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

    expect(await screen.findByText("关联 Schema 资产列表")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Schema" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Manifest 状态" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "本地表数" })).toBeInTheDocument();
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
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).not.toHaveClass(
      "pl-btn",
      "pl-btn--ghost",
      "pl-btn--primary",
      "pl-btn--secondary"
    );

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
    expect(screen.getByTestId("connection-card-doris-r1")).toHaveTextContent("预期只读");
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
    expect(card).toHaveTextContent("预期只读");
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
    const credentialMeta = within(card).getByText("凭据：inline");
    expect(credentialMeta).toHaveClass("pl-connection-meta-tag");
    expect(credentialMeta).not.toHaveClass("pl-connection-meta-tag--warning");
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

  it("surfaces project root as the only environment badge in the header", async () => {
    stubOverviewFetch({ ktxAvailable: false });
    renderOverview();

    expect(await screen.findByTestId("page-header-badge-root")).toHaveTextContent("/tmp/project-lucy");
    expect(screen.queryByText("KTX 不可用")).not.toBeInTheDocument();
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
    expect(card).toHaveTextContent("配置：ktx.yaml");
    expect(within(card).getByText("配置：ktx.yaml")).toHaveAttribute(
      "title",
      "连接基础配置与凭据来源由 ktx.yaml 管理，WebUI 不直接编辑凭据。"
    );
    expect(
      within(card).getByText("配置：ktx.yaml")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传 Schema Manifest" })).toBeInTheDocument();
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

    const status = await screen.findByTestId("catalog-reload-status-mysql-aliyun");
    expect(status).toHaveTextContent("本地目录已刷新");
    expect(status).toHaveTextContent("2026-07-29 10:30");
    expect(status).toHaveTextContent("4 张表");
    expect(status).toHaveTextContent("已完成");
    expect(status.querySelectorAll(".pl-catalog-reload-badge")).toHaveLength(0);
    expect(within(status).queryByRole("button", { name: /完成/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog-last-run")).not.toBeInTheDocument();
    expect(screen.queryByText("上次刷新")).not.toBeInTheDocument();
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
    expect(card).toHaveTextContent("配置：ktx.yaml");
    expect(card).not.toHaveTextContent("配置来源：ktx.yaml。凭据不在 WebUI 中编辑。");
    const status = within(card).getByTestId("catalog-reload-status-demo-mysql");
    expect(status).toHaveTextContent("本地目录已刷新");
    expect(status).toHaveTextContent("3 张表");
    expect(status).toHaveTextContent("1 个提示");
    expect(status).toHaveTextContent("已完成");
    expect(status.querySelectorAll(".pl-catalog-reload-badge")).toHaveLength(0);
    expect(within(status).queryByRole("button", { name: /完成/ })).not.toBeInTheDocument();
    expect(within(card).getByTestId("catalog-reload-demo-mysql")).toHaveTextContent("刷新本地目录");

    const table = within(card).getByTestId("schema-asset-table-demo-mysql");
    const warning = within(card).getByTestId("catalog-reload-warning-demo-mysql-openclaw_db");
    expect(table).toContainElement(warning);
    expect(within(card).getByText("关联 Schema 资产列表")).toBeInTheDocument();
    expect(within(card).getByRole("columnheader", { name: "Manifest 状态" })).toBeInTheDocument();
    expect(within(card).getByTestId("schema-asset-status-demo-mysql-openclaw_db")).toHaveTextContent(
      "缺失 Manifest"
    );
    expect(within(card).getByTestId("schema-row-demo-mysql-openclaw_db")).toHaveTextContent("0 张表");
    expect(warning).toHaveTextContent("缺少 Manifest：openclaw_db");
    expect(warning).toHaveTextContent("semantic-layer/demo-mysql/_schema/openclaw_db.yaml");

    const detailsButton = within(warning).getByRole("button", { name: "展开详情" });
    expect(detailsButton).toHaveClass("pl-btn", "pl-btn--ghost", "pl-btn--sm");
    const copyButton = within(warning).getByRole("button", { name: "复制路径" });
    expect(copyButton).toHaveClass("pl-btn", "pl-btn--ghost", "pl-btn--sm");
    const recheckButton = within(warning).getByTestId("catalog-reload-recheck-demo-mysql-openclaw_db");
    expect(recheckButton).toHaveClass("pl-btn", "pl-btn--secondary", "pl-btn--sm");
    expect(recheckButton).toHaveTextContent("重新检查");
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute("aria-expanded", "true");
    expect(warning).toHaveTextContent("missing_manifest");
    expect(warning).toHaveTextContent("刷新本地目录只读取本地 YAML，不会连接数据库。");
    expect(screen.queryByText("有提示")).not.toBeInTheDocument();
  });

  it("renders the never-run catalog status when the sidecar has no entry for the connection", async () => {
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

    const status = await screen.findByTestId("catalog-reload-status-mysql-aliyun");
    expect(status).toHaveTextContent("本地目录未刷新");
    expect(status).toHaveTextContent("尚未读取本地 YAML");
  });

  it("M29: centralizes Connection actions in the footer action bar", async () => {
    stubOverviewFetch();
    renderOverview();

    const card = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(within(card).queryByTestId("connection-card-header-actions-mysql-aliyun")).not.toBeInTheDocument();

    const footerActions = within(card).getByTestId("connection-card-schema-actions-mysql-aliyun");
    expect(within(footerActions).getByRole("button", { name: /\+ 添加 Schema/ })).toBeInTheDocument();
    expect(within(footerActions).getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
    expect(within(footerActions).getByRole("button", { name: "上传 Schema Manifest" })).toBeInTheDocument();
    expect(
      within(footerActions).getAllByRole("button").map((button) => button.textContent?.trim())
    ).toEqual(["+ 添加 Schema", "刷新本地目录", "上传 Schema Manifest"]);
    expect(within(footerActions).getByRole("button", { name: /\+ 添加 Schema/ })).toHaveClass("pl-btn--secondary");
    expect(within(footerActions).queryByRole("button", { name: "上传 YAML" })).not.toBeInTheDocument();
    expect(within(footerActions).queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
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
    expect(status).not.toHaveTextContent("缺失 manifest");
    expect(screen.queryByText("财政部舱单")).not.toBeInTheDocument();
    expect(screen.queryByText("模式清单")).not.toBeInTheDocument();
    assertNoForbiddenTerms(document.body);
  });
});
