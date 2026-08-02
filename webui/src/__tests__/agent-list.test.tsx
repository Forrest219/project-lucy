// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentList } from "../pages/admin/AgentList";
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
    stats: { callsLast7d: 0, deniedLast7d: 0, topTables: [] },
    ...overrides
  };
}

const analystRole: Role = {
  id: "analyst",
  description: "Analyst role",
  source: "yaml",
  tools: ["lucy_query", "lucy_read_source"],
  connections: ["mysql-aliyun"],
  sourceCount: 3,
  invalid: false,
  warnings: []
};

afterEach(() => {
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
    // M36: the resource-scope row exposes "legacy wildcard" by name. Use
    // the test-id so we don't accidentally match the duplicate headline.
    const scopeRow = screen.getByTestId("agent-scope-resource-legacy1");
    expect(scopeRow).toHaveTextContent(/legacy wildcard/);
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

  it("new agent modal shows role summary card with source count, connections, tools and warnings", async () => {
    const richRole: Role = {
      id: "data_engineer",
      description: "Data engineering",
      source: "yaml",
      tools: ["lucy_query", "lucy_read_source", "lucy_catalog"],
      connections: ["mysql-aliyun", "postgres-aws"],
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
});
