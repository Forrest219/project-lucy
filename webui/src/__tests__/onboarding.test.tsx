// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "../pages/Onboarding";
import type { Agent, SourceSummary } from "../lib/types";

const readyAgent: Agent = {
  id: "analyst",
  name: "Analyst",
  enabled: true,
  role: "analyst",
  tokens: [{ hash: "abc", label: "default", created: "2026-06-21T00:00:00.000Z" }]
};

const readySource: SourceSummary = {
  conn: "mysql-demo",
  schema: "demo",
  table: "orders",
  filePath: "semantic-layer/mysql-demo/_schema/demo.yaml",
  columnCount: 4,
  columnNames: ["id", "amount"],
  hasTableDesc: true,
  hasGrain: true,
  measureCount: 1,
  joinCount: 0,
  wikiRefCount: 0,
  completion: "done",
  mtime: "2026-06-21T00:00:00.000Z"
};

function renderPage(options: {
  agents?: Agent[];
  sources?: SourceSummary[];
  mcpEndpoint?: {
    url: string | null;
    status: "configured" | "fallback" | "invalid";
    source: "env" | "fallback";
    configured: boolean;
    diagnostics: Array<{ code: string; message: string }>;
  };
} = {}) {
  const agents = options.agents ?? [readyAgent];
  const sources = options.sources ?? [readySource];
  const mcpEndpoint = options.mcpEndpoint ?? {
    url: "https://lucy.example.com/mcp",
    status: "configured" as const,
    source: "env" as const,
    configured: true,
    diagnostics: []
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/project") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          root: "/tmp/project-lucy",
          ktxAvailable: true,
          connections: [
            { id: "mysql-demo", driver: "mysql", schemas: ["demo"], enabledTables: ["demo.orders"] }
          ],
          mcpEndpoint
        }
      }));
    }
    if (url === "/api/sources") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tables: sources
        }
      }));
    }
    if (url === "/api/diff") {
      return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
    }
    if (url === "/api/admin/agents") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          agents
        }
      }));
    }
    return new Response(JSON.stringify({ ok: true, data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Onboarding", () => {
  it("summarizes runtime system status and copies MCP config", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "系统概览" })).toBeInTheDocument();
    expect(screen.getByText("运行状态")).toBeInTheDocument();
    const pageActions = screen.getByLabelText("页面操作");
    expect(within(pageActions).queryByRole("link", { name: "打开系统手册" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新状态" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "数据库接入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "配置 Agent" })).not.toBeInTheDocument();
    expect(screen.queryByText("Deployment readiness")).not.toBeInTheDocument();
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("KTX Runtime").closest(".pl-metric-card")).not.toHaveClass("pl-metric-card--success");
    expect(screen.getByText("语义资产覆盖度")).toBeInTheDocument();
    expect(screen.getByText("Agent 接入与安全")).toBeInTheDocument();
    const metricGrid = document.querySelector(".pl-metric-grid");
    expect(metricGrid).toHaveClass("grid", "grid-cols-1", "md:grid-cols-3", "gap-4");
    expect(document.querySelectorAll(".pl-metric-grid > .pl-metric-card")).toHaveLength(3);
    expect(screen.getByText("mysql-demo")).toBeInTheDocument();
    expect(screen.getByText("https://lucy.example.com/mcp")).toBeInTheDocument();
    expect(screen.queryByText("http://localhost:7879/mcp")).not.toBeInTheDocument();
    expect(screen.queryByText("http://127.0.0.1:7879/mcp")).not.toBeInTheDocument();
    expect(screen.getByText("实时状态与诊断")).toBeInTheDocument();
    expect(screen.getByText("数据源连接")).toBeInTheDocument();
    expect(screen.getByText("语义层状态")).toBeInTheDocument();
    expect(screen.getByText("变更审阅")).toBeInTheDocument();
    expect(screen.getByText("Agent 接入点")).toBeInTheDocument();
    expect(document.querySelector(".pl-onboarding-step-index")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "维护语义" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "审阅校验" })).not.toBeInTheDocument();
    expect(screen.getByText("Lucy MCP 服务运行正常")).toBeInTheDocument();
    expect(screen.getByText("服务节点已就绪，当前可正常接受 Agent 连接：https://lucy.example.com/mcp")).toBeInTheDocument();
    expect(screen.queryByText("Lucy MCP is ready for Agent delivery")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /复制 .*mcp\.json 配置/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Semantic Tables")).not.toBeInTheDocument();
    expect(screen.queryByText("Checklist")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制 MCP 配置" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer <LUCY_AGENT_TOKEN>"));
  });

  it("surfaces the local fallback URL and a deployment warning when LUCY_PUBLIC_MCP_URL is unset", async () => {
    renderPage({
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

    expect(await screen.findByText("http://127.0.0.1:7879/mcp")).toBeInTheDocument();
    expect(
      await screen.findByText(/当前使用本地默认 MCP endpoint|本地默认/)
    ).toBeInTheDocument();
  });

  it("hides the MCP config snippet when the runtime endpoint is invalid", async () => {
    renderPage({
      mcpEndpoint: {
        url: null,
        status: "invalid",
        source: "env",
        configured: false,
        diagnostics: [
          {
            code: "INVALID_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL must be a valid absolute URL."
          }
        ]
      }
    });

    expect(await screen.findByText("Agent 接入点")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制 MCP 配置" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("LUCY_PUBLIC_MCP_URL must be a valid absolute URL.")
    ).toBeInTheDocument();
  });

  it("keeps Agent MCP actions inside the endpoint diagnostic item", async () => {
    renderPage();

    const agentItem = (await screen.findByText("Agent 接入点")).closest("section");
    expect(agentItem).toBeInTheDocument();
    expect(within(agentItem as HTMLElement).getByText("MCP config")).toBeInTheDocument();
    expect(within(agentItem as HTMLElement).getByRole("button", { name: "复制 MCP 配置" })).toBeInTheDocument();
    expect(within(agentItem as HTMLElement).queryByRole("link", { name: "新建 Token" })).not.toBeInTheDocument();
    expect(within(agentItem as HTMLElement).getByRole("link", { name: "查看 Agent 管理 ->" })).toHaveAttribute("href", "/admin/agents");
  });

  it("aligns warning diagnostic badges with the warning tone", async () => {
    renderPage({
      sources: [
        readySource,
        { ...readySource, table: "customers", completion: "partial" },
        { ...readySource, table: "products", completion: "not_started" }
      ]
    });

    const semanticItem = (await screen.findByText("语义层状态")).closest("section");
    expect(semanticItem).toHaveAttribute("data-tone", "warning");
    expect(within(semanticItem as HTMLElement).getByText("2 待完善")).toHaveClass("pl-status-partial");
    expect(within(semanticItem as HTMLElement).queryByText("Ready")).not.toBeInTheDocument();
  });

  it("shows a not-ready blocker banner with the first failure reason", async () => {
    renderPage({ agents: [] });

    expect(await screen.findByText("Lucy MCP 服务异常")).toBeInTheDocument();
    expect(screen.getByText("阻塞原因：尚未创建 Agent")).toBeInTheDocument();
    expect(screen.getByText("尚未创建 Agent")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开阻塞项" })
    ).toHaveAttribute("href", "/admin/agents");
  });

  it.each([
    ["尚未创建 Agent", []],
    ["启用的 Agent 暂无可用 token", [{ ...readyAgent, tokens: [] }]],
    ["所有 Agent 均已禁用", [{ ...readyAgent, enabled: false }]],
    ["所有 Agent 仍为 legacy allow，需迁移到 role", [{ ...readyAgent, role: undefined, allow: { tables: ["*"], tools: ["*"] } }]]
  ])("explains MCP setup gap: %s", async (message, agents) => {
    renderPage({ agents: agents as Agent[] });

    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
