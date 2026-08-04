// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
      if (!handler && key.startsWith("GET /api/catalog/assets/schema-manifest?")) {
        const query = new URL(url, "http://localhost").searchParams;
        const schema = query.get("schema") ?? "dataforai";
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              connectionId: query.get("connectionId") ?? "mysql-aliyun",
              schema,
              assetKind: "schema_manifest",
              assetType: "schemaManifest",
              targetPath: `semantic-layer/mysql-aliyun/_schema/${schema}.yaml`,
              filename: `${schema}.yaml`,
              content: `tables:\n  superstore_orders:\n    table: ${schema}.superstore_orders\n`,
              sizeBytes: 64,
              sha256: "a".repeat(64)
            }
          })
        );
      }
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
    expect(screen.getByText("缺 Manifest 的 Schema")).toBeInTheDocument();
    expect(screen.getByText("本地表目录")).toBeInTheDocument();
    expect(screen.getByText("未启用表")).toBeInTheDocument();
    expect(screen.queryByText("启用的表")).not.toBeInTheDocument();
    expect(screen.queryByText("语义层对象")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog 状态")).not.toBeInTheDocument();
    expect(screen.queryByText("语义源")).not.toBeInTheDocument();
    expect(screen.queryByText("KTX Runtime")).not.toBeInTheDocument();
    expect(screen.getByText("mysql-aliyun")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:3306")).toBeInTheDocument();
    expect(screen.getAllByText("dataforai").length).toBeGreaterThan(0);
    const mysqlCard = await screen.findByTestId("connection-card-mysql-aliyun");
    expect(mysqlCard.querySelector(".pl-connection-engine-icon")).not.toBeNull();
    expect(screen.getByTestId("engine-badge-mysql-aliyun")).toHaveTextContent("MySQL");
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

    for (const label of ["数据连接", "缺 Manifest 的 Schema", "本地表目录", "未启用表"]) {
      expect(
        await screen.findByRole("button", { name: `${label} 说明` })
      ).toBeInTheDocument();
    }
  });

  it("aggregates KPI cards from first-hand connection and local Manifest table facts", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "demo-mysql",
          driver: "mysql",
          schemas: ["dataforai", "openclaw_db"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [
        { ...sourceSummary("superstore_orders"), conn: "demo-mysql", schema: "dataforai" },
        { ...sourceSummary("superstore_returns"), conn: "demo-mysql", schema: "dataforai" }
      ]
    });
    renderOverview();

    const metrics = await screen.findAllByTestId("connection-metric");
    const metricByType = (type: string) => {
      const metric = metrics.find((node) => node.getAttribute("data-metric") === type);
      expect(metric).toBeDefined();
      return metric!;
    };

    expect(metricByType("connections")).toHaveTextContent("数据连接");
    expect(metricByType("connections")).toHaveTextContent("1");
    expect(metricByType("connections")).toHaveTextContent("2 个 Schema");
    expect(metricByType("missingManifestSchemas")).toHaveTextContent("缺 Manifest 的 Schema");
    expect(metricByType("missingManifestSchemas")).toHaveTextContent("1");
    expect(metricByType("missingManifestSchemas")).toHaveTextContent("配置 2 个 Schema / 有 Manifest 1 个");
    expect(metricByType("missingManifestSchemas")).toHaveClass("pl-metric-card--warning");
    expect(metricByType("localCatalogTables")).toHaveTextContent("本地表目录");
    expect(metricByType("localCatalogTables")).toHaveTextContent("2");
    expect(metricByType("localCatalogTables")).toHaveTextContent("来自 1 个 Schema Manifest");
    expect(metricByType("unenabledTables")).toHaveTextContent("未启用表");
    expect(metricByType("unenabledTables")).toHaveTextContent("1");
    expect(metricByType("unenabledTables")).toHaveTextContent("已启用 1 / 本地 2 张表");
  });

  it("uses physical qualifiedName when matching local Manifest tables against enabled_tables", async () => {
    stubOverviewFetch({
      connections: [
        {
          id: "demo-mysql",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.orders_physical"]
        }
      ],
      tables: [
        {
          ...sourceSummary("orders_source"),
          conn: "demo-mysql",
          schema: "dataforai",
          qualifiedName: "dataforai.orders_physical"
        }
      ]
    });
    renderOverview();

    const metrics = await screen.findAllByTestId("connection-metric");
    const unenabledMetric = metrics.find((node) => node.getAttribute("data-metric") === "unenabledTables");
    expect(unenabledMetric).toBeDefined();
    expect(unenabledMetric).toHaveTextContent("未启用表");
    expect(unenabledMetric).toHaveTextContent("0");
    expect(unenabledMetric).toHaveTextContent("已启用 1 / 本地 1 张表");
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
    expect(screen.getByTestId("view-manifest-mysql-aliyun-dataforai")).toHaveTextContent("查看 Manifest");
    expect(screen.getByTestId("download-manifest-mysql-aliyun-dataforai")).toHaveTextContent("下载");
    expect(screen.getByTestId("reupload-manifest-mysql-aliyun-dataforai")).toHaveTextContent("重新上传");
    expect(screen.getByTestId("schema-whitelist-mysql-aliyun-dataforai")).toHaveAttribute(
      "href",
      "/connections/enabled-tables?connection=mysql-aliyun&schema=dataforai"
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

  it("M46: lets users view, download, and reupload an existing Schema Manifest", async () => {
    const createObjectURL = vi.fn(() => "blob:schema-manifest");
    const revokeObjectURL = vi.fn();
    const anchorClicks: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });

    stubOverviewFetch({
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders", "dataforai")]
    });
    renderOverview();

    fireEvent.click(await screen.findByTestId("view-manifest-mysql-aliyun-dataforai"));
    const drawer = await screen.findByTestId("catalog-asset-manifest-drawer");
    expect(drawer).toHaveTextContent("查看 dataforai 的 Schema Manifest");
    expect(await screen.findByTestId("catalog-asset-manifest-target-file")).toHaveTextContent(
      "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
    );
    expect(
      (within(drawer).getByTestId("catalog-asset-manifest-content") as HTMLTextAreaElement).value
    ).toContain("dataforai.superstore_orders");
    expect(within(drawer).queryByTestId("catalog-asset-manifest-whitelist")).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("link", { name: "维护启用范围" })).not.toBeInTheDocument();

    vi.spyOn(document.body, "appendChild").mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        node.click = () => {
          anchorClicks.push(node.download);
        };
      }
      return node;
    });
    fireEvent.click(within(drawer).getByTestId("catalog-asset-manifest-download"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClicks).toContain("dataforai.yaml");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:schema-manifest");

    fireEvent.click(within(drawer).getByTestId("catalog-asset-manifest-reupload"));
    expect(await screen.findByRole("heading", { name: /更新 dataforai 的 Schema Manifest/ })).toBeInTheDocument();
    expect((screen.getByTestId("catalog-asset-upload-textarea") as HTMLTextAreaElement).value).toContain(
      "dataforai.superstore_orders"
    );
    expect(screen.getByTestId("catalog-asset-upload-overwrite-note")).toHaveTextContent("将覆盖现有 YAML");
  });

  it("shows one-sentence Tooltip content on the 数据连接 help trigger", async () => {
    stubOverviewFetch();
    renderOverview();

    const trigger = await screen.findByRole("button", { name: "数据连接 说明" });
    fireEvent.focus(trigger);

    // Radix Tooltip 1.x renders a visual popper plus a visually-hidden a11y
    // mirror, so the hint shows up twice. Assert on the first occurrence.
    const hints = await screen.findAllByTestId("metric-tooltip-hint");
    expect(hints[0]).toHaveTextContent("统计 ktx.yaml 中已声明的连接，可在下方连接卡片逐一核对。");
    expect(screen.queryByText("关注问题：")).not.toBeInTheDocument();
    expect(screen.queryByText("定义：")).not.toBeInTheDocument();
    expect(screen.queryByText("健康标准：")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("connection-card-doris-r1").querySelector(".pl-connection-engine-icon")).not.toBeNull();
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
    expect(screen.getByTestId("connection-card-starrocks-r1").querySelector(".pl-connection-engine-icon")).not.toBeNull();
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
    expect(screen.getByText("本地表目录")).toBeInTheDocument();
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
    expect(headerTimestamp).toHaveTextContent("本地目录刷新：");
    expect(headerTimestamp).toHaveTextContent("2026-07-29 10:30");
    expect(headerTimestamp).toHaveAttribute(
      "title",
      expect.stringContaining("2026-07-29T02:30:00.000Z")
    );
    expect(headerTimestamp).toHaveAttribute(
      "title",
      expect.stringContaining("不会连接数据库")
    );
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
    // would otherwise be hidden. Healthy status surfaces as `本地目录刷新：<ts>`.
    const headerTimestamp = within(card).getByTestId("connection-last-reload-demo-mysql");
    expect(headerTimestamp).toHaveTextContent("本地目录刷新：");
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
    expect(screen.queryByText("Catalog 状态")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Catalog 状态")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Catalog 状态")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Catalog 状态")).not.toBeInTheDocument();
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

  it("M29/M44: footer keeps peer secondary actions and the row keeps 上传 Manifest", async () => {
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
    expect(refreshButton).toHaveClass("pl-btn--secondary");
    expect(within(footerActions).queryByRole("button", { name: "上传 Schema Manifest" })).not.toBeInTheDocument();
    expect(within(footerActions).queryByRole("button", { name: "上传 YAML" })).not.toBeInTheDocument();
    expect(within(footerActions).queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    // Peer actions in the footer should stay at the same secondary hierarchy.
    expect(within(footerActions).queryByRole("button", { name: "刷新本地目录" })).not.toHaveClass("pl-btn--primary");
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

describe("ConnectionOverview schema-row source drift explanation (UX-CONNECTIONS-005)", () => {
  // UX-CONNECTIONS-005: when a schema has zero local Manifest tables but
  // enabled_tables lists >0 entries for that schema, surface the data-source
  // discrepancy via (a) a `data-state="drift"` hook on the local-count cell
  // for CSS styling, (b) a `title` tooltip explaining the dual-source origin,
  // (c) an inline drift tag so the explanation is visible without hover, and
  // (d) `aria-describedby` for screen-reader access.

  it("marks the local-count cell as `data-state=\"drift\"` and renders an inline source-drift tag", async () => {
    stubOverviewFetch({
      // Connection declares a `demo_finance` schema with two enabled tables,
      // but `/api/sources` returns no rows for it — i.e. local Manifest read
      // returned zero for this schema. This is the canonical "drift" case.
      connections: [
        {
          id: "starrocks-r1",
          driver: "mysql",
          schemas: ["demo_finance"],
          enabledTables: ["demo_finance.ceo_metric_snapshot", "demo_finance.fct_revenue"]
        }
      ],
      tables: []
    });

    renderOverview();

    const localCount = await screen.findByTestId("schema-local-count-starrocks-r1-demo_finance");
    expect(localCount).toHaveAttribute("data-state", "drift");
    expect(localCount).toHaveTextContent("0 张表");
    expect(localCount).toHaveAttribute(
      "title",
      expect.stringContaining("enabled_tables 已配置")
    );
    expect(localCount).toHaveAttribute(
      "aria-describedby",
      "schema-source-drift-hint-starrocks-r1-demo_finance"
    );

    const driftTag = screen.getByTestId("schema-source-drift-tag-starrocks-r1-demo_finance");
    expect(driftTag).toHaveTextContent("· 来源：enabled_tables");
    expect(driftTag).toHaveClass("pl-schema-asset-source-drift-tag");

    // Enabled-count cell must still report the real number, not collapse to 0.
    const enabledCount = screen.getByTestId("schema-enabled-count-starrocks-r1-demo_finance");
    expect(enabledCount).toHaveTextContent("2 张表");
  });

  it("does NOT mark the local-count cell as drift when both sources agree", async () => {
    stubOverviewFetch({
      // Both sources agree: enabled_tables has one entry, and one local
      // Manifest row exists for the same schema.
      connections: [
        {
          id: "mysql-aliyun",
          driver: "mysql",
          schemas: ["dataforai"],
          enabledTables: ["dataforai.superstore_orders"]
        }
      ],
      tables: [sourceSummary("superstore_orders", "dataforai")]
    });

    renderOverview();

    const localCount = await screen.findByTestId("schema-local-count-mysql-aliyun-dataforai");
    expect(localCount).toHaveAttribute("data-state", "ok");
    expect(localCount).not.toHaveAttribute("title");
    expect(localCount).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByTestId("schema-source-drift-tag-mysql-aliyun-dataforai")
    ).not.toBeInTheDocument();
  });
});

describe("ConnectionOverview grid visual consistency (M72)", () => {
  it("uses the shared pl-data-grid contract for Schema asset tables", async () => {
    stubOverviewFetch();
    renderOverview();

    const table = await screen.findByTestId("schema-asset-table-mysql-aliyun");
    expect(table.className).toContain("pl-data-grid");
    expect(table.className).toContain("pl-data-table");
    expect(table.className).toContain("pl-schema-asset-table");

    const localHead = within(table).getByRole("columnheader", { name: "本地表数" });
    const enabledHead = within(table).getByRole("columnheader", { name: "启用表数" });
    expect(localHead.className).toContain("pl-schema-asset-table-num-head");
    expect(enabledHead.className).toContain("pl-schema-asset-table-num-head");

    const localCell = await screen.findByTestId("schema-local-count-mysql-aliyun-dataforai");
    const enabledCell = await screen.findByTestId("schema-enabled-count-mysql-aliyun-dataforai");
    expect(localCell.className).toContain("pl-schema-asset-local-count");
    expect(enabledCell.className).toContain("pl-schema-asset-table-num");
  });

  it("keeps schema asset table typography and action-column width aligned with shared grid tokens", () => {
    const css = readFileSync("src/app/app.css", "utf8");
    const tableRule = css.match(/\.pl-schema-asset-table td\s*\{[^}]*\}/);
    expect(tableRule).not.toBeNull();
    expect(tableRule![0]).toMatch(/py-2/);
    expect(tableRule![0]).toMatch(/text-fg-default/);
    expect(tableRule![0]).not.toMatch(/py-1\.5|leading-5|text-fg-body/);

    const codeRule = css.match(/\.pl-schema-asset-table code\s*\{[^}]*\}/);
    expect(codeRule).not.toBeNull();
    expect(codeRule![0]).toMatch(/text-xs/);
    expect(codeRule![0]).not.toMatch(/text-sm/);

    const actionColRule = css.match(/\.pl-schema-asset-col-action\s*\{[^}]*\}/);
    expect(actionColRule).not.toBeNull();
    expect(actionColRule![0]).toMatch(/width:\s*24%/);
  });
});
