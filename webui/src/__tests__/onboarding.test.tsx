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
  evalRuns?: { total: number; runs: unknown[] };
} = {}) {
  const agents = options.agents ?? [readyAgent];
  const sources = options.sources ?? [readySource];
  const evalRuns = options.evalRuns ?? { total: 1, runs: [{ id: 1 }] };
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
    // M36 review follow-up: the dashboard now asks the eval API whether
    // any run has happened. Default fixture says "yes, one run" so the
    // "近 30 天无评测数据" item is not falsely surfaced.
    if (url === "/api/eval/runs?limit=1") {
      return new Response(JSON.stringify({ ok: true, data: evalRuns }));
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

    expect(await screen.findByRole("heading", { name: "运维驾驶舱" })).toBeInTheDocument();
    expect(screen.queryByText("运行状态")).not.toBeInTheDocument();
    const pageActions = screen.getByLabelText("页面操作");
    expect(within(pageActions).queryByRole("link", { name: "打开系统手册" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新状态" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "数据库接入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "配置 Agent" })).not.toBeInTheDocument();
    expect(screen.queryByText("Deployment readiness")).not.toBeInTheDocument();
    // M36: KTX Runtime is now rendered inside the service-health strip
    // (not a `.pl-metric-card`) but the label must still be present.
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("Lucy MCP")).toBeInTheDocument();
    expect(screen.getByText("语义层覆盖")).toBeInTheDocument();
    expect(screen.getByText("Agent 接入")).toBeInTheDocument();
    // The legacy 3-up metric grid is intentionally not rendered anymore; the
    // service-health strip replaces it.
    expect(document.querySelectorAll(".pl-metric-grid > .pl-metric-card")).toHaveLength(0);
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

  it("renders the M36 ops dashboard sections", async () => {
    renderPage();

    // Header moved from "系统概览" to "运维驾驶舱".
    expect(await screen.findByRole("heading", { name: "运维驾驶舱" })).toBeInTheDocument();
    // M36 review follow-up: the static DEV badge was removed because the
    // environment switcher is out of scope for M36. If we ever re-introduce
    // a badge it must come from runtime config, not be hard-coded.
    expect(screen.queryByTestId("onboarding-env-badge")).not.toBeInTheDocument();
    // Service health strip
    expect(screen.getByTestId("ops-service-health")).toBeInTheDocument();
    expect(screen.getByText("服务健康")).toBeInTheDocument();
    expect(screen.getByText("Lucy MCP")).toBeInTheDocument();
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("语义层覆盖")).toBeInTheDocument();
    expect(screen.getByText("Agent 接入")).toBeInTheDocument();
    // Action required queue
    expect(screen.getByTestId("ops-action-required")).toBeInTheDocument();
    expect(screen.getByText("待处理事项")).toBeInTheDocument();
    // Quality + Access snapshots
    expect(screen.getByTestId("ops-quality-snapshot")).toBeInTheDocument();
    expect(screen.getByTestId("ops-access-risk")).toBeInTheDocument();
    expect(screen.getByText("质量快照")).toBeInTheDocument();
    expect(screen.getByText("访问风险")).toBeInTheDocument();
  });

  it("shows the eval monitor entry link with the 触发首次 Run copy in the quality snapshot", async () => {
    renderPage();
    const qualitySnapshot = await screen.findByTestId("ops-quality-snapshot");
    const link = within(qualitySnapshot).getByRole("link", { name: "触发首次 Run" });
    expect(link).toHaveAttribute("href", "/eval/monitor");
  });

  it("suppresses the eval-gap queue item once any eval run exists", async () => {
    // Default fixture stubs /api/eval/runs?limit=1 to return one run, so
    // the "近 30 天无评测数据" item must NOT appear in the queue.
    renderPage();

    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).not.toHaveTextContent("近 30 天无评测数据");
  });

  it("shows the eval-gap queue item when no eval run has happened", async () => {
    renderPage({ evalRuns: { total: 0, runs: [] } });

    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).toHaveTextContent("近 30 天无评测数据");
  });
});
