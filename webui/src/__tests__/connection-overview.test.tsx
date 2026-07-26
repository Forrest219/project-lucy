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
  testHandler?: TestHandler
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
    ...(testHandler ? { "POST /api/connections/mysql-aliyun/test": testHandler } : {})
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
  testHandler
}: {
  connections?: ConnectionInfo[];
  ktxAvailable?: boolean;
  projectError?: boolean;
  tables?: ReturnType<typeof sourceSummary>[];
  testHandler?: TestHandler;
} = {}) {
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
              connections
            }
          })
        );
    })(),
    testHandler
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

    expect(await screen.findByText("连接概览")).toBeInTheDocument();
    expect(screen.getAllByTestId("connection-metric")).toHaveLength(5);
    expect(screen.getByText("数据连接")).toBeInTheDocument();
    expect(screen.getByText("启用的表")).toBeInTheDocument();
    expect(screen.getByText("语义层对象")).toBeInTheDocument();
    expect(screen.getByText("语义源")).toBeInTheDocument();
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("mysql-aliyun")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "表白名单" })).toHaveAttribute("href", "/connections/whitelist");
    expect(screen.getByRole("link", { name: "连通测试" })).toHaveAttribute("href", "/connections/test");
    expect(screen.getByRole("link", { name: "打开表目录" })).toHaveAttribute("href", "/");
  });

  it("renders an accessible ⓘ help trigger for every metric", async () => {
    stubOverviewFetch();
    renderOverview();

    for (const label of ["数据连接", "启用的表", "语义层对象", "语义源", "KTX Runtime"]) {
      expect(
        await screen.findByRole("button", { name: `${label} 管理含义` })
      ).toBeInTheDocument();
    }
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

  it("copies the MCP endpoint string with one click", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    stubOverviewFetch();
    renderOverview();

    fireEvent.click(await screen.findByTestId("copy-mcp-endpoint"));
    expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:7879/mcp");
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
    expect(screen.getByText("doris / mysql wire / R1 target / read-only expected")).toBeInTheDocument();
    expect(screen.getByTestId("engine-badge-doris-r1")).toHaveTextContent("Doris");
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
    expect(screen.getByText("starrocks / mysql wire / R1 target / read-only expected")).toBeInTheDocument();
    expect(screen.getByTestId("engine-badge-starrocks-r1")).toHaveTextContent("StarRocks");
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

  it("surfaces unavailable KTX Runtime status", async () => {
    stubOverviewFetch({ ktxAvailable: false });
    renderOverview();

    expect(await screen.findByText("不可用")).toBeInTheDocument();
  });
});
