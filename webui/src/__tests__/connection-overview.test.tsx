// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionInfo } from "../lib/types";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";

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
  testHandler?: TestHandler,
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
    ...(testHandler ? { "POST /api/connections/mysql-aliyun/test": testHandler } : {}),
    "GET /api/catalog/reloads": catalogReloadsHandler ?? (() => new Response(JSON.stringify({ ok: true, data: { runs: [], last: null, lastByConnection: {} } })))
  };
}

function stubOverviewFetch({
  connections = [
    {
      id: "mysql-aliyun",
      driver: "mysql",
      schemas: ["dataforai"],
      enabledTables: ["dataforai.superstore_orders", "dataforai.customers"]
    }
  ],
  ktxAvailable = true,
  projectError = false,
  tables = [sourceSummary("superstore_orders"), sourceSummary("customers"), sourceSummary("orders", "crm")],
  testHandler,
  catalogReloadsResponse,
  mcpEndpoint
}: {
  connections?: ConnectionInfo[];
  ktxAvailable?: boolean;
  projectError?: boolean;
  tables?: ReturnType<typeof sourceSummary>[];
  testHandler?: TestHandler;
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
    testHandler,
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
    // M17: cross-page navigation must NOT live in the page header anymore.
    expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "连通测试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开表目录" })).not.toBeInTheDocument();
    // The per-connection card still surfaces the upload + reload actions.
    expect(screen.getAllByRole("button", { name: "上传 YAML" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "刷新本地目录" }).length).toBeGreaterThan(0);
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
    expect(screen.getByRole("columnheader", { name: "上下文动作" })).toBeInTheDocument();
    expect(
      await screen.findByTestId("schema-asset-status-mysql-aliyun-dataforai")
    ).toHaveTextContent("已存在");
    expect(screen.getByTestId("schema-row-mysql-aliyun-dataforai")).toHaveTextContent("1 张表");
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).toHaveAttribute(
      "href",
      "/connections/whitelist?schema=dataforai"
    );

    expect(screen.getByTestId("schema-asset-status-mysql-aliyun-openclaw_db")).toHaveTextContent(
      "缺失 manifest"
    );
    expect(screen.getByTestId("schema-row-mysql-aliyun-openclaw_db")).toHaveAttribute(
      "data-tone",
      "warning"
    );
    expect(screen.getByTestId("schema-row-mysql-aliyun-openclaw_db")).toHaveTextContent("0 张表");
    expect(screen.getByTestId("upload-yaml-mysql-aliyun-openclaw_db")).toBeInTheDocument();
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

  it("starts every connection as Not tested", async () => {
    stubOverviewFetch();
    renderOverview();

    expect(await screen.findByText("Not tested")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
  });

  it("transitions a connection card to Connected when the test returns status ok", async () => {
    stubOverviewFetch({
      testHandler: () =>
        new Response(
          JSON.stringify({ ok: true, data: { status: "ok", latencyMs: 5, detail: "ok", stdout: "ok", stderr: "" } })
        )
    });
    renderOverview();

    const testButton = await screen.findByTestId("test-connection-mysql-aliyun");
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status-mysql-aliyun")).toHaveTextContent(
        "Connected"
      );
    });
  });

  it("transitions a connection card to Disconnected when the test returns status error", async () => {
    stubOverviewFetch({
      testHandler: () =>
        new Response(
          JSON.stringify({ ok: true, data: { status: "error", reason: "denied", stdout: "", stderr: "denied" } })
        )
    });
    renderOverview();

    const testButton = await screen.findByTestId("test-connection-mysql-aliyun");
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status-mysql-aliyun")).toHaveTextContent(
        "Disconnected"
      );
    });
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
          schemas: ["mart"],
          enabledTables: ["mart.ceo_metric_snapshot"]
        }
      ],
      tables: [sourceSummary("ceo_metric_snapshot", "mart")]
    });

    renderOverview();

    expect(await screen.findByText("doris-r1")).toBeInTheDocument();
    expect(screen.getByTestId("engine-badge-doris-r1")).toHaveTextContent("Doris");
    expect(screen.getByTestId("connection-status-doris-r1")).toHaveTextContent("Not tested");
    expect(screen.getByTestId("connection-card-doris-r1")).toHaveTextContent("Read-only expected");
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
          schemas: ["mart"],
          enabledTables: ["mart.ceo_metric_snapshot"]
        }
      ],
      tables: [sourceSummary("ceo_metric_snapshot", "mart")]
    });

    renderOverview();

    expect(await screen.findByText("starrocks-r1")).toBeInTheDocument();
    expect(screen.getByTestId("engine-badge-starrocks-r1")).toHaveTextContent("StarRocks");
    expect(screen.getByTestId("connection-card-starrocks-r1")).toHaveTextContent("Read-only expected");
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
      screen.getByText("配置来源：ktx.yaml。凭据不在 WebUI 中编辑。")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传 YAML" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
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

    const status = await screen.findByTestId("catalog-status-mysql-aliyun");
    expect(status).toHaveTextContent("Catalog 已同步");
    expect(status).toHaveTextContent("2026-07-29 10:30");
    expect(screen.queryByTestId("catalog-last-run")).not.toBeInTheDocument();
    expect(screen.queryByText("上次刷新")).not.toBeInTheDocument();
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

    const status = await screen.findByTestId("catalog-status-mysql-aliyun");
    expect(status).toHaveTextContent("Catalog 未刷新");
    expect(status).toHaveTextContent("尚未读取本地 YAML");
  });
});
