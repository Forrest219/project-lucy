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
    if (url === "/api/admin/agents" && !init) {
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
    stubAgentsEndpoints([makeAgent({ id: "no1", name: "无访问", stats: { callsLast7d: 0, deniedLast7d: 0, topTables: [] } })]);

    renderAgentList();
    expect(await screen.findByRole("heading", { name: "Agent 实例" })).toBeInTheDocument();
    // M40: 一级根页面不再渲染面包屑
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("无访问")).toBeInTheDocument();
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

  it("copy MCP config writes a safe template with placeholder token and no plaintext", async () => {
    stubAgentsEndpoints([makeAgent({ id: "zhangsan", name: "张三" })]);
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderAgentList();
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /MCP 配置/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const payload = String((writeText.mock.calls as Array<[string]>)[0]?.[0] ?? "");
    const parsed = JSON.parse(payload);
    expect(parsed.mcpServers.lucy.headers.Authorization).toBe("Bearer ${LUCY_AGENT_TOKEN}");
    expect(parsed.mcpServers.lucy.url).toBe("https://lucy.example.com/mcp");
    expect(payload).not.toMatch(/sha256:[0-9a-f]{16,}/i);
    expect(payload).not.toMatch(/[0-9a-f]{32,}/);
    expect(payload).not.toContain("http://localhost:7879/mcp");
    expect(payload).not.toContain("http://127.0.0.1:7879/mcp");
  });

  it("surfaces runtime diagnostics when MCP config copy is unavailable", async () => {
    stubAgentsEndpoints([makeAgent({ id: "zhangsan", name: "张三" })], [analystRole], {
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
    });

    renderAgentList();

    expect(await screen.findByText("张三")).toBeInTheDocument();
    expect(screen.getByText("LUCY_PUBLIC_MCP_URL must be a valid absolute URL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /MCP 配置/ })).toBeDisabled();
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

    fireEvent.change(await screen.findByLabelText(/用户 ID/), { target: { value: "newagent1" } });
    fireEvent.change(screen.getByLabelText(/显示名/), { target: { value: "新人" } });
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
    fireEvent.change(await screen.findByLabelText(/用户 ID/), { target: { value: "newagent1" } });
    fireEvent.change(screen.getByLabelText(/显示名/), { target: { value: "新人" } });
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

  it("renders usage-aware top metrics instead of 7d denied", async () => {
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
    await screen.findByRole("heading", { name: "Agent 实例" });

    // 顶部 4 个指标按 spec §6.1
    expect(screen.getByTestId("metric-active-tokens")).toHaveTextContent("活跃 Token");
    expect(screen.getByTestId("metric-active-tokens")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-calls-last-7d")).toHaveTextContent("近 7 天调用");
    expect(screen.getByTestId("metric-calls-last-7d")).toHaveTextContent("10");
    expect(screen.getByTestId("metric-denied-last-7d")).toHaveTextContent("近 7 天拒绝");
    expect(screen.getByTestId("metric-denied-last-7d")).toHaveTextContent("0");

    // 旧的 7d denied 文案必须彻底消失
    expect(document.body).not.toHaveTextContent(/^\s*7d denied\s*$/);
    expect(document.body).not.toHaveTextContent(/^\s*Token 数\s*$/);

    // PageHeader badge 暴露配置 Token 数量
    expect(screen.getByTestId("badge-configured-token-total")).toHaveTextContent("1 配置 Token");
  });

  it("agent card links role id to role detail and exposes 查看权限 link", async () => {
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
    await screen.findByTestId("agent-card-demo_agent");

    const roleLink = screen.getByTestId("agent-role-link-demo_agent");
    expect(roleLink).toHaveTextContent("demo_readonly");
    expect(roleLink).toHaveAttribute("href", "/admin/roles/demo_readonly");
    expect(roleLink.getAttribute("aria-label") ?? "").toContain("demo_readonly");

    const permissionsLink = screen.getByTestId("agent-permissions-link-demo_agent");
    expect(permissionsLink.getAttribute("href")).toBe("/admin/agents/demo_agent?tab=permissions");

    // 不再展示完整 Tool scope 行
    expect(screen.queryByTestId("agent-scope-tool-demo_agent")).not.toBeInTheDocument();
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
    await screen.findByTestId("metric-active-tokens");
    expect(screen.getByTestId("metric-active-tokens")).toHaveTextContent("1");

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
      expect(screen.getAllByTestId("metric-active-tokens").at(-1)).toHaveTextContent("1");
    });
  });

  it("warns when an agent has recent denials without changing the layout", async () => {
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
    const deniedCell = await screen.findByTestId("agent-denied-7d-demo_agent");
    expect(deniedCell).toHaveTextContent("3 次拒绝");
    expect(deniedCell.className).toContain("text-warning-strong");
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
      configuredTokenCount: 1,
      activeTokenCountLast7d: 1,
      callsLast7d: 8,
      deniedLast7d: 1
    });
  });
});
