// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentList, activeTokenCount, configuredTokenCount, summarizeAgents } from "../pages/admin/AgentList";
import type { Agent, McpEndpointInfo, Role } from "../lib/types";

function renderAgentList() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/agents"]}>
        <Routes>
          <Route path="/admin/agents" element={<AgentList />} />
          <Route path="/admin/agents/:userId" element={<AgentDetailProbe />} />
          <Route path="/admin/audit" element={<div data-testid="audit-page">audit</div>} />
          <Route path="/admin/roles" element={<div data-testid="roles-page">roles</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function AgentDetailProbe() {
  const location = useLocation();
  return <div data-testid="agent-detail" data-search={location.search}>detail token handoff</div>;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "zhangsan",
    name: "张三",
    enabled: true,
    role: "analyst",
    tokens: [],
    stats: {
      callsLast7d: 0,
      deniedLast7d: 0,
      activeTokensLast7d: 0,
      configuredTokens: 0,
      topTables: []
    },
    ...overrides
  };
}

const analystRole: Role = {
  id: "analyst",
  description: "Analyst role",
  source: "yaml",
  tools: ["lucy_query", "lucy_read_source"],
  connections: ["mysql-aliyun"],
  sourceNames: ["superstore_orders"],
  sourceCount: 3,
  invalid: false,
  warnings: []
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubAgentsEndpoints(
  agents: Agent[],
  roles: Role[] = [analystRole],
  mcpEndpoint: McpEndpointInfo = {
    url: "https://lucy.example.com/mcp",
    status: "configured" as const,
    source: "env" as const,
    configured: true,
    diagnostics: []
  }
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/project") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            root: "/tmp/project-lucy",
            ktxAvailable: true,
            connections: [],
            mcpEndpoint
          }
        })
      );
    }
    if (url === "/api/admin/agents" && (!init || !init.method || init.method === "GET")) {
      return new Response(JSON.stringify({ ok: true, data: { agents, version: "v1" } }));
    }
    if (url === "/api/admin/roles") {
      return new Response(JSON.stringify({ ok: true, data: { roles } }));
    }
    if (url === "/api/admin/agents" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.dryRun) {
        return new Response(JSON.stringify({ ok: true, data: { diff: "+ id: newagent1", proposedYaml: "yaml" } }));
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            written: true,
            agent: makeAgent({ id: body.agent.id, name: body.agent.name, role: body.agent.role })
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AgentList", () => {
  it("renders 未访问 for agents that have never been seen", async () => {
    stubAgentsEndpoints([makeAgent({ id: "no1", name: "冷账号", stats: { callsLast7d: 0, deniedLast7d: 0, topTables: [] } })]);

    renderAgentList();
    expect(await screen.findByRole("heading", { name: "Agent" })).toBeInTheDocument();
    // M40: 一级根页面不再渲染面包屑
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("冷账号")).toBeInTheDocument();
    });
    expect(screen.getByText("未访问")).toBeInTheDocument();
  });

  it("renders relative last seen and keeps full timestamp in title attribute", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    stubAgentsEndpoints([makeAgent({ id: "zhangsan", name: "张三", stats: { callsLast7d: 4, deniedLast7d: 0, lastSeen: tenMinAgo, topTables: [] } })]);

    renderAgentList();
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
    });
    const seen = screen.getByText(/\d+ 分钟前/);
    expect(seen).toBeInTheDocument();
    expect(seen.getAttribute("title")).toBeTruthy();
    expect(seen.getAttribute("title")?.length ?? 0).toBeGreaterThan(0);
  });

  it("renders legacy wildcard warning for legacy ACL agents", async () => {
    stubAgentsEndpoints([
      makeAgent({
        id: "legacy1",
        name: "旧ACL",
        role: undefined,
        allow: { tables: ["*"], tools: ["*"] }
      })
    ]);

    renderAgentList();
    await waitFor(() => {
      expect(screen.getByText("旧ACL")).toBeInTheDocument();
    });
    // M55: the resource-scope row is gone; "旧 ACL · legacy wildcard"
    // appears in the role line test-id instead.
    const roleLine = screen.getByTestId("agent-role-line-legacy1");
    expect(roleLine).toHaveTextContent(/旧 ACL/);
    expect(roleLine).toHaveTextContent(/legacy wildcard/);
  });

  it("renders agent list as pl-data-grid table without row-level MCP copy", async () => {
    stubAgentsEndpoints([makeAgent({ id: "zhangsan", name: "张三" })]);

    renderAgentList();
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    expect(screen.getByTestId("agent-list-table")).toHaveClass("pl-data-grid");
    const section = screen.getByTestId("agent-list-section");
    expect(section).toHaveClass("pl-data-grid-frame");
    expect(section).not.toHaveClass("rounded-md");
    expect(section).not.toHaveClass("border");
    expect(section).not.toHaveClass("p-4");
    const scroll = screen.getByTestId("agent-list-grid-scroll");
    expect(scroll).toHaveClass("pl-data-grid-scroll");
    expect(screen.queryByRole("button", { name: /MCP 配置/ })).not.toBeInTheDocument();
  });

  it("view logs navigates to /admin/audit?user=<agentId>", async () => {
    stubAgentsEndpoints([makeAgent({ id: "zhangsan", name: "张三" })]);

    renderAgentList();
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "查看日志" }));

    await waitFor(() => {
      expect(screen.getByTestId("audit-page")).toBeInTheDocument();
    });
  });

  it("new agent modal role select labels templates/invalid with 中文业务 terms instead of bare English", async () => {
    stubAgentsEndpoints([], [
      {
        ...analystRole,
        id: "demo_template",
        source: "template",
        invalid: false
      },
      {
        ...analystRole,
        id: "broken_role",
        invalid: true,
        warnings: ["role_resolution_failed:broken_role"]
      }
    ]);

    renderAgentList();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));

    const select = await screen.findByDisplayValue(/demo_template/);
    const optionTexts = Array.from((select as HTMLSelectElement).options).map((opt) => opt.textContent);
    // 模板不能裸露 "template"，应展示「参考模板」；invalid 角色展示「待修复」。
    expect(optionTexts.some((text) => text?.includes("参考模板"))).toBe(true);
    expect(optionTexts.some((text) => text?.includes("待修复"))).toBe(true);
    expect(optionTexts.some((text) => /\(template\)/.test(text ?? ""))).toBe(false);
    expect(optionTexts.some((text) => /\(invalid\)/.test(text ?? ""))).toBe(false);
  });

  it("new agent modal shows role summary card with source count, connections, tools and warnings", async () => {
    const richRole: Role = {
      id: "data_engineer",
      description: "Data engineering",
      source: "yaml",
      tools: ["lucy_query", "lucy_read_source", "lucy_catalog"],
      connections: ["mysql-aliyun", "postgres-aws"],
      sourceNames: ["orders"],
      sourceCount: 7,
      invalid: false,
      warnings: ["Selector matched 0 sources for connection=postgres-aws"]
    };
    stubAgentsEndpoints([], [richRole]);

    renderAgentList();
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));

    await waitFor(() => {
      expect(screen.getByText(/7 个授权 source/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("role-summary-card")).toHaveTextContent("mysql-aliyun");
    expect(screen.getByTestId("role-summary-card")).toHaveTextContent("postgres-aws");
    expect(screen.getByTestId("role-summary-card")).toHaveTextContent("lucy_query");
    expect(screen.getByTestId("role-summary-card")).toHaveTextContent("Selector matched 0 sources");
    // Verify primary CTA is no longer just "预览变更"
    expect(screen.queryByRole("button", { name: "预览变更" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一步：预览配置/ })).toBeInTheDocument();
  });

  it("new agent modal calls dryRun:true first and only writes on user confirm", async () => {
    stubAgentsEndpoints([]);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    renderAgentList();
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));

    fireEvent.change(await screen.findByPlaceholderText("例：wangwu"), { target: { value: "newagent1" } });
    fireEvent.change(screen.getByPlaceholderText("例：王五"), { target: { value: "新人" } });
    fireEvent.click(screen.getByRole("button", { name: /下一步：预览配置/ }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find((call) => {
        const init = call[1] as RequestInit | undefined;
        if (init?.method !== "POST") return false;
        const body = JSON.parse(String(init.body));
        return body.dryRun === true && body.agent?.id === "newagent1";
      });
      expect(dryRunCall).toBeTruthy();
    });
  });

  it("new agent create confirmation navigates to the token handoff tab", async () => {
    stubAgentsEndpoints([]);

    renderAgentList();
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));
    fireEvent.change(await screen.findByPlaceholderText("例：wangwu"), { target: { value: "newagent1" } });
    fireEvent.change(screen.getByPlaceholderText("例：王五"), { target: { value: "新人" } });
    fireEvent.click(screen.getByRole("button", { name: /下一步：预览配置/ }));
    expect(await screen.findByText(/\+ id: newagent1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() => {
      expect(screen.getByTestId("agent-detail")).toBeInTheDocument();
    });
    expect(screen.getByTestId("agent-detail")).toHaveAttribute("data-search", "?tab=tokens");
  });

  it("new agent modal role field shows 管理角色 link and empty-state when no roles", async () => {
    stubAgentsEndpoints([], []);
    renderAgentList();
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));

    expect(await screen.findByText(/还没有可用角色/)).toBeInTheDocument();
    const createLink = screen.getByRole("link", { name: /创建角色/ });
    expect(createLink.getAttribute("href")).toBe("/admin/roles/new");
  });

  it("new agent modal role field shows 管理角色 link to role admin", async () => {
    stubAgentsEndpoints([], [analystRole]);
    renderAgentList();
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));

    const link = await screen.findByRole("link", { name: /管理角色/ });
    expect(link.getAttribute("href")).toBe("/admin/roles");
  });

  it("renders stability-and-adoption top metrics", async () => {
    stubAgentsEndpoints(
      [
        makeAgent({
          id: "demo_agent",
          name: "Demo Agent",
          tokens: [
            { hash: "sha256:aaa", label: "tok-a", created: "2026-06-01" }
          ],
          stats: {
            callsLast7d: 10,
            deniedLast7d: 0,
            activeTokensLast7d: 1,
            configuredTokens: 1,
            topTables: []
          }
        })
      ],
      [
        {
          ...analystRole,
          id: "demo_readonly"
        }
      ],
      // stub mcp endpoint
      {
        url: "https://lucy.example.com/mcp",
        status: "configured",
        source: "env",
        configured: true,
        diagnostics: []
      }
    );

    renderAgentList();
    await screen.findByRole("heading", { name: "Agent" });

    // 顶部 4 个指标：存量 → 活跃覆盖 → 调用强度（Spec 98）
    expect(screen.getByTestId("metric-agent-count")).toHaveTextContent("Agent 总数");
    expect(screen.getByTestId("metric-active-agent-count")).toHaveTextContent("近 7 天活跃 Agent");
    expect(screen.getByTestId("metric-active-agent-count")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-active-token-count")).toHaveTextContent("近 7 天活跃 Token");
    expect(screen.getByTestId("metric-active-token-count")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-calls")).toHaveTextContent("近 7 天调用量");
    expect(screen.getByTestId("metric-calls")).toHaveTextContent("10");

    const metricOrder = [
      ...document.querySelectorAll("[data-testid='agent-metric-grid'] > [data-testid^='metric-']")
    ].map((el) => el.getAttribute("data-testid"));
    expect(metricOrder).toEqual([
      "metric-agent-count",
      "metric-active-agent-count",
      "metric-active-token-count",
      "metric-calls"
    ]);
    expect(screen.getByTestId("metric-help-agent-count")).toBeInTheDocument();
    expect(screen.getByTestId("metric-help-calls")).toBeInTheDocument();
    expect(screen.getByTestId("metric-agent-count")).toHaveClass("pl-metric-card--with-help");

    // 拒绝指标不再出现在 KPI 区
    expect(document.body).not.toHaveTextContent(/^\s*7d denied\s*$/);
    expect(document.body).not.toHaveTextContent("近 7 天拒绝");
    expect(document.body).not.toHaveTextContent(/^\s*Token 数\s*$/);

    // PageHeader 不再展示 count badges（由 KPI 网格承载）
    expect(screen.queryByTestId("badge-configured-token-total")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-agent-total")).not.toBeInTheDocument();
  });

  it("agent table row links role id to role detail and exposes 查看权限 link", async () => {
    stubAgentsEndpoints([
      makeAgent({
        id: "demo_agent",
        name: "Demo Agent",
        role: "demo_readonly",
        stats: {
          callsLast7d: 10,
          deniedLast7d: 0,
          activeTokensLast7d: 1,
          configuredTokens: 1,
          topTables: []
        }
      })
    ]);

    renderAgentList();
    await screen.findByTestId("agent-row-demo_agent");

    const roleLink = screen.getByTestId("agent-role-link-demo_agent");
    expect(roleLink).toHaveTextContent("demo_readonly");
    expect(roleLink).toHaveAttribute("href", "/admin/roles/demo_readonly");
    expect(roleLink.getAttribute("aria-label") ?? "").toContain("demo_readonly");

    const permissionsLink = screen.getByTestId("agent-permissions-link-demo_agent");
    expect(permissionsLink.getAttribute("href")).toBe("/admin/agents/demo_agent?tab=permissions");

    // 不再展示完整 Tool scope 行
    expect(screen.queryByTestId("agent-scope-tool-demo_agent")).not.toBeInTheDocument();
  });

  it("supports role and activity filters in filter bar", async () => {
    stubAgentsEndpoints([
      makeAgent({
        id: "active_agent",
        name: "活跃 Agent",
        role: "demo_readonly",
        stats: { callsLast7d: 5, deniedLast7d: 0, activeTokensLast7d: 1, configuredTokens: 1, topTables: [] }
      }),
      makeAgent({
        id: "idle_agent",
        name: "空闲 Agent",
        role: "ops_readonly",
        stats: { callsLast7d: 0, deniedLast7d: 0, activeTokensLast7d: 0, configuredTokens: 1, topTables: [] }
      })
    ]);

    renderAgentList();
    await screen.findByTestId("agent-row-active_agent");
    expect(screen.getByTestId("agent-row-idle_agent")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "角色" }), { target: { value: "demo_readonly" } });
    expect(screen.getByTestId("agent-row-active_agent")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-row-idle_agent")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "角色" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "近 7 天活跃" }), { target: { value: "inactive" } });
    expect(screen.getByTestId("agent-row-idle_agent")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-row-active_agent")).not.toBeInTheDocument();
  });

  it("filter bar has labeled dimensions and result count without token-band filter", async () => {
    stubAgentsEndpoints([
      makeAgent({ id: "demo_agent", name: "Demo Agent", role: "demo_readonly" })
    ]);
    renderAgentList();
    await screen.findByTestId("agent-list-table");
    expect(screen.getByLabelText("搜索显示名或用户 ID")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "当前状态" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "角色" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "近 7 天活跃" })).toBeInTheDocument();
    expect(screen.queryByLabelText("按配置Token数筛选")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-list-result-count")).toHaveTextContent("1 条结果");
    expect(screen.getByRole("columnheader", { name: "显示名/用户 ID" })).toBeInTheDocument();
  });

  it("uses backend summary when present and falls back to client-side aggregate when absent", async () => {
    const withSummary = [
      makeAgent({
        id: "demo_agent",
        name: "Demo Agent",
        role: "demo_readonly",
        tokens: [{ hash: "sha256:aa", label: "tok", created: "2026-06-01" }],
        stats: {
          callsLast7d: 10,
          deniedLast7d: 0,
          activeTokensLast7d: 1,
          configuredTokens: 1,
          topTables: []
        }
      })
    ];
    const fetchWithSummary = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/agents") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              agents: withSummary,
              version: "v1",
              summary: {
                agentCount: 1,
                enabledAgentCount: 1,
                configuredTokenCount: 1,
                activeTokenCountLast7d: 1,
                callsLast7d: 10,
                deniedLast7d: 0
              }
            }
          })
        );
      }
      if (url === "/api/project") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              root: "/tmp",
              ktxAvailable: true,
              connections: [],
              mcpEndpoint: {
                url: "https://lucy.example.com/mcp",
                status: "configured",
                source: "env",
                configured: true,
                diagnostics: []
              }
            }
          })
        );
      }
      if (url === "/api/admin/roles") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              roles: [{ ...analystRole, id: "demo_readonly" }]
            }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchWithSummary);
    renderAgentList();
    await screen.findByTestId("metric-active-token-count");
    expect(screen.getByTestId("metric-active-token-count")).toHaveTextContent("1");

    // Fallback 路径：移除 summary 后再次渲染，helper 仍能算出 1
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/admin/agents") {
          return new Response(JSON.stringify({ ok: true, data: { agents: withSummary, version: "v1" } }));
        }
        if (url === "/api/project") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                root: "/tmp",
                ktxAvailable: true,
                connections: [],
                mcpEndpoint: {
                  url: "https://lucy.example.com/mcp",
                  status: "configured",
                  source: "env",
                  configured: true,
                  diagnostics: []
                }
              }
            })
          );
        }
        if (url === "/api/admin/roles") {
          return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/agents"]}>
          <Routes>
            <Route path="/admin/agents" element={<AgentList />} />
            <Route path="/admin/agents/:userId" element={<div data-testid="agent-detail">detail</div>} />
            <Route path="/admin/audit" element={<div data-testid="audit-page">audit</div>} />
            <Route path="/admin/roles" element={<div data-testid="roles-page">roles</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("metric-active-token-count").at(-1)).toHaveTextContent("1");
    });
  });

  it("renders prioritized table columns for ops value", async () => {
    stubAgentsEndpoints([
      makeAgent({
        id: "demo_agent",
        name: "Demo Agent",
        stats: {
          callsLast7d: 12,
          deniedLast7d: 3,
          activeTokensLast7d: 1,
          configuredTokens: 1,
          topTables: []
        }
      })
    ]);

    renderAgentList();
    await screen.findByTestId("agent-row-demo_agent");
    expect(screen.getByRole("columnheader", { name: "序号" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "显示名/用户 ID" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "当前状态" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "配置最后变更时间" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "创建日期" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "近 7 天拒绝" })).not.toBeInTheDocument();

    const headers = [...document.querySelectorAll("[data-testid='agent-list-table'] thead th")].map(
      (th) => th.textContent?.replace(/\s+/g, " ").trim()
    );
    expect(headers).toEqual([
      "序号",
      "显示名/用户 ID",
      "角色",
      "当前状态",
      "配置 Token",
      "近 7 天活跃 Token",
      "近 7 天调用量",
      "创建日期",
      "配置最后变更时间",
      "最近访问时间",
      "操作"
    ]);
  });
});

describe("agentList helpers", () => {
  const NOW = new Date("2026-08-02T12:00:00.000Z");

  it("configuredTokenCount mirrors agent.tokens.length", () => {
    expect(configuredTokenCount(makeAgent({ tokens: [] }))).toBe(0);
    expect(configuredTokenCount(makeAgent({ tokens: [
      { hash: "sha256:aa", label: "a", created: "2026-06-01" },
      { hash: "sha256:bb", label: "b", created: "2026-06-01" }
    ] }))).toBe(2);
  });

  it("activeTokenCount prefers stats.activeTokensLast7d then falls back to last_used", () => {
    const recent = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const stale = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const backendAgent = makeAgent({
      tokens: [
        { hash: "sha256:aa", label: "a", created: "2026-06-01", last_used: stale },
        { hash: "sha256:bb", label: "b", created: "2026-06-01", last_used: recent }
      ],
      stats: { callsLast7d: 0, deniedLast7d: 0, activeTokensLast7d: 5, configuredTokens: 2, topTables: [] }
    });
    expect(activeTokenCount(backendAgent, NOW)).toBe(5);

    // 无 backend 字段，按 last_used 在窗口内的数量统计
    const fallbackAgent = makeAgent({
      tokens: [
        { hash: "sha256:aa", label: "a", created: "2026-06-01", last_used: recent },
        { hash: "sha256:bb", label: "b", created: "2026-06-01", last_used: stale }
      ],
      stats: { callsLast7d: 0, deniedLast7d: 0, configuredTokens: 2, topTables: [] }
    });
    expect(activeTokenCount(fallbackAgent, NOW)).toBe(1);

    // 完全无最近访问
    const untouched = makeAgent({
      tokens: [{ hash: "sha256:aa", label: "a", created: "2026-06-01" }],
      stats: { callsLast7d: 0, deniedLast7d: 0, configuredTokens: 1, topTables: [] }
    });
    expect(activeTokenCount(untouched, NOW)).toBe(0);
  });

  it("summarizeAgents aggregates per-agent counts and stats", () => {
    const agents = [
      makeAgent({
        id: "a1",
        enabled: true,
        tokens: [
          { hash: "sha256:aa", label: "a", created: "2026-06-01", last_used: "2026-08-01T00:00:00.000Z" }
        ],
        stats: { callsLast7d: 3, deniedLast7d: 1, activeTokensLast7d: 1, configuredTokens: 1, topTables: [] }
      }),
      makeAgent({
        id: "a2",
        enabled: false,
        tokens: [],
        stats: { callsLast7d: 5, deniedLast7d: 0, activeTokensLast7d: 0, configuredTokens: 0, topTables: [] }
      })
    ];
    const now = new Date("2026-08-02T00:00:00.000Z");
    const summary = summarizeAgents(agents, now);
    expect(summary).toEqual({
      agentCount: 2,
      enabledAgentCount: 1,
      activeAgentCountLast7d: 2,
      configuredTokenCount: 1,
      activeTokenCountLast7d: 1,
      callsLast7d: 8,
      deniedLast7d: 1,
      metricsState: "ok"
    });
  });
});
