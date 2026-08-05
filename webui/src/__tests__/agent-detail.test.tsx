// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDetail } from "../pages/admin/AgentDetail";

function renderAgentDetail(initialPath = "/admin/agents/zhangsan") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/admin/agents/:userId" element={<AgentDetail />} />
          <Route path="/admin/agents/:userId/tokens/new" element={<div data-testid="new-token">new token</div>} />
          <Route path="/admin/roles" element={<div data-testid="roles-page">roles</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeAgentDetailResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      version: "v1",
      agent: {
        id: "zhangsan",
        name: "张三",
        enabled: true,
        role: "analyst",
        tokens: [
          {
            hash: "sha256:aaaa0000bbbb1111cccc2222dddd3333",
            label: "hermes-laptop",
            created: "2026-06-18",
            expires_at: null,
            last_used: "2026-06-21T10:11:12.000Z",
            last_tool: "sl_query",
            last_outcome: "ok"
          }
        ],
        allow: { tables: ["dataforai.superstore_orders"], tools: ["sl_query"] },
        effectivePermissions: {
          roleIds: ["analyst"],
          snapshotHash: "snap-1234",
          sourceMapVersion: "v1",
          tools: ["lucy_query", "lucy_read_source", "lucy_catalog"],
          connections: ["mysql-aliyun"],
          sources: [
            { connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "dataforai", table: "dataforai.superstore_orders" },
            { connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "dataforai", table: "dataforai.superstore_returns" }
          ],
          legacyAllow: false
        },
        permissionWarnings: [],
        stats: {
          callsLast7d: 1,
          deniedLast7d: 0,
          activeTokensLast7d: 1,
          configuredTokens: 1,
          topTables: []
        },
        ...overrides
      }
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubAgentEndpoints(extraRoles: Array<Record<string, unknown>> = []) {
  const roles = [
    {
      id: "analyst",
      description: "Analyst role",
      source: "yaml",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sourceNames: ["superstore_orders"],
      sourceCount: 2,
      invalid: false,
      warnings: []
    },
    ...extraRoles
  ];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/admin/agents/zhangsan" && !init) {
      return new Response(JSON.stringify(makeAgentDetailResponse()));
    }
    if (url === "/api/admin/agents/zhangsan" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      if (body.dryRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { diff: "+ name: 张三编辑", proposedYaml: "yaml" }
          })
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            written: true,
            agent: {
              id: "zhangsan",
              name: body.patch?.name ?? "张三编辑",
              enabled: body.patch?.enabled ?? true,
              role: body.patch?.role ?? "analyst",
              tokens: [],
              allow: { tables: [], tools: [] }
            }
          }
        })
      );
    }
    if (url === "/api/admin/roles") {
      return new Response(JSON.stringify({ ok: true, data: { roles } }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AgentDetail", () => {
  it("low-risk edits save in one step with dryRun then write", async () => {
    const fetchMock = stubAgentEndpoints();

    renderAgentDetail();

    expect(await screen.findByDisplayValue("张三")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("张三"), { target: { value: "张三编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(dryRunCall).toBeTruthy();
      expect(saveCall).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "预览并保存" })).not.toBeInTheDocument();
  });

  it("role change opens confirm modal before writing", async () => {
    const fetchMock = stubAgentEndpoints([
      {
        id: "ops_readonly",
        description: "Ops",
        source: "yaml",
        tools: ["lucy_query"],
        connections: ["mysql-aliyun"],
        sourceNames: ["superstore_orders"],
        sourceCount: 1,
        invalid: false,
        warnings: []
      }
    ]);
    renderAgentDetail();
    const roleSelect = await screen.findByDisplayValue("analyst");
    fireEvent.change(roleSelect, { target: { value: "ops_readonly" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const modal = await screen.findByTestId("agent-save-confirm-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(/\+ name: 张三编辑/)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(String(saveCall?.[1]?.body)).patch.role).toBe("ops_readonly");
    });
  });

  it("clears stale diff preview when edits change after viewing diff", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    fireEvent.change(await screen.findByDisplayValue("张三"), { target: { value: "预览名" } });
    fireEvent.click(screen.getByRole("button", { name: "查看变更 diff" }));
    expect(await screen.findByText(/\+ name: 张三编辑/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    fireEvent.change(screen.getByDisplayValue("预览名"), { target: { value: "预览后又改名" } });
    fireEvent.click(screen.getByRole("button", { name: "变更预览" }));
    expect(screen.queryByText(/\+ name: 张三编辑/)).not.toBeInTheDocument();
    expect(screen.getByText(/可点「查看变更 diff」审阅/)).toBeInTheDocument();
  });

  it("does not show sticky save bar before any edits", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    expect(await screen.findByDisplayValue("张三")).toBeInTheDocument();
    expect(screen.queryByTestId("sticky-save-bar")).not.toBeInTheDocument();
  });

  it("shows sticky save bar after editing the name", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    const nameInput = await screen.findByDisplayValue("张三");
    fireEvent.change(nameInput, { target: { value: "张三改" } });

    const bar = await screen.findByTestId("sticky-save-bar");
    expect(bar).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "放弃修改" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "查看变更 diff" })).toBeInTheDocument();
  });

  it("放弃修改 restores original values and clears dirty state", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    const nameInput = await screen.findByDisplayValue("张三");
    fireEvent.change(nameInput, { target: { value: "张三改" } });
    const bar = await screen.findByTestId("sticky-save-bar");

    fireEvent.click(within(bar).getByRole("button", { name: "放弃修改" }));

    await waitFor(() => {
      expect(screen.queryByTestId("sticky-save-bar")).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("张三")).toBeInTheDocument();
  });

  it("Cmd+S / Ctrl+S triggers save when there are dirty edits", async () => {
    const fetchMock = stubAgentEndpoints();
    renderAgentDetail();
    const nameInput = await screen.findByDisplayValue("张三");
    fireEvent.change(nameInput, { target: { value: "张三改" } });
    await screen.findByTestId("sticky-save-bar");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(saveCall).toBeTruthy();
    });
  });

  it("Token tab exposes all required fields including hash prefix and revokes the token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan" && !init) {
        return new Response(JSON.stringify(makeAgentDetailResponse()));
      }
      if (url === "/api/admin/roles") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              roles: [
                {
                  id: "analyst",
                  description: "Analyst role",
                  source: "yaml",
                  tools: ["lucy_query"],
                  connections: ["mysql-aliyun"],
                  sourceNames: ["superstore_orders"],
                  sourceCount: 2,
                  invalid: false,
                  warnings: []
                }
              ]
            }
          })
        );
      }
      if (url.startsWith("/api/admin/agents/zhangsan/tokens/") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true, data: { written: true, revokedAt: "2026-06-22" } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderAgentDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Token" }));

    const tokenCard = await screen.findByText("hermes-laptop");
    const card = tokenCard.closest("div")?.parentElement?.parentElement;
    expect(card).not.toBeNull();
    const cardText = card?.textContent ?? "";
    expect(cardText).toContain("2026-06-18");
    expect(cardText).toContain("sha256:aaaa0000bbbb1111");
    expect(cardText).toContain("sl_query");
    expect(cardText).toContain("ok");

    fireEvent.click(screen.getByRole("link", { name: /生成新 Token/ }));
    await waitFor(() => {
      expect(screen.getByTestId("new-token")).toBeInTheDocument();
    });
  });

  it("opens Token tab from the tab query parameter", async () => {
    stubAgentEndpoints();
    renderAgentDetail("/admin/agents/zhangsan?tab=tokens");

    expect(await screen.findByText(/当前活跃 token/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Token" })).toHaveClass("pl-admin-tab--active");
  });

  it("Effective Permissions tree groups sources by connection then schema and shows tools", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    fireEvent.click(await screen.findByRole("button", { name: "权限预览" }));
    const tree = await screen.findByTestId("permissions-tree");
    expect(tree).toHaveTextContent("mysql-aliyun");
    expect(tree).toHaveTextContent("dataforai");
    expect(tree).toHaveTextContent("superstore_orders");
    expect(tree).toHaveTextContent("lucy_query");
  });

  it("Effective Permissions tree shows legacy wildcard warning when legacyAllow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan") {
        return new Response(
          JSON.stringify(
            makeAgentDetailResponse({
              effectivePermissions: undefined,
              permissionWarnings: ["legacy wildcard 仍在使用；建议尽快迁移到 role"],
              allow: { tables: ["*"], tools: ["*"] }
            })
          )
        );
      }
      if (url === "/api/admin/roles") {
        return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAgentDetail();
    fireEvent.click(await screen.findByRole("button", { name: "权限预览" }));

    expect(await screen.findByText(/legacy wildcard 仍在使用/)).toBeInTheDocument();
  });

  it("Agent detail role field shows 管理角色 link", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    expect(await screen.findByText("张三")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /管理角色/ });
    expect(link.getAttribute("href")).toBe("/admin/roles");
  });

  it("Agent detail 基本信息 tab exposes configured tokens and active token count from stats", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    await screen.findByDisplayValue("张三");
    expect(document.body).toHaveTextContent("1");
    expect(document.body).not.toHaveTextContent(/^\s*7d denied\s*$/);
  });
});
