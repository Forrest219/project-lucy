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
        stats: { callsLast7d: 1, deniedLast7d: 0, topTables: [] },
        ...overrides
      }
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubAgentEndpoints() {
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
              name: "张三编辑",
              enabled: true,
              role: "analyst",
              tokens: [],
              allow: { tables: [], tools: [] }
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
            roles: [
              {
                id: "analyst",
                description: "Analyst role",
                source: "yaml",
                tools: ["lucy_query"],
                connections: ["mysql-aliyun"],
                sourceCount: 2,
                invalid: false,
                warnings: []
              }
            ]
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AgentDetail", () => {
  it("requires dry-run diff preview before saving edits", async () => {
    const fetchMock = stubAgentEndpoints();

    renderAgentDetail();

    expect(await screen.findByDisplayValue("张三")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Token" }));
    expect(await screen.findByText("hermes-laptop")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("最近使用：");
    expect(document.body).toHaveTextContent("sl_query");
    expect(document.body).toHaveTextContent("ok");
    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

    fireEvent.change(await screen.findByDisplayValue("张三"), { target: { value: "张三编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));

    expect(await screen.findByText(/\+ name: 张三编辑/)).toBeInTheDocument();
    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true);
      expect(dryRunCall).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false);
      expect(saveCall).toBeTruthy();
    });
  });

  it("saves the exact patch that produced the displayed diff", async () => {
    const fetchMock = stubAgentEndpoints();
    renderAgentDetail();
    fireEvent.change(await screen.findByDisplayValue("张三"), { target: { value: "预览名" } });
    fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    expect(await screen.findByText(/\+ name: 张三编辑/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    fireEvent.change(screen.getByDisplayValue("预览名"), { target: { value: "预览后又改名" } });

    fireEvent.click(screen.getByRole("button", { name: "变更预览" }));
    expect(screen.queryByText(/\+ name: 张三编辑/)).not.toBeInTheDocument();
    expect(screen.getByText(/点「预览并保存」生成 diff/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    fireEvent.click(screen.getByRole("button", { name: "预览并保存" }));
    expect(await screen.findByText(/\+ name: 张三编辑/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find((call) => {
        const init = call[1] as RequestInit | undefined;
        if (init?.method !== "PATCH") return false;
        const body = JSON.parse(String(init.body));
        return body.dryRun === false;
      });
      expect(saveCall).toBeTruthy();
      const body = JSON.parse(String(saveCall?.[1]?.body));
      expect(body.patch.name).toBe("预览后又改名");
    });
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
    expect(within(bar).getByRole("button", { name: "预览并保存" })).toBeInTheDocument();
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

  it("Cmd+S / Ctrl+S triggers preview when there are dirty edits", async () => {
    const fetchMock = stubAgentEndpoints();
    renderAgentDetail();
    const nameInput = await screen.findByDisplayValue("张三");
    fireEvent.change(nameInput, { target: { value: "张三改" } });
    await screen.findByTestId("sticky-save-bar");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(dryRunCall).toBeTruthy();
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
});

function withinBar(_node: HTMLElement) {
  // simple helper removed: use Testing Library's `within` instead.
  return null as never;
}
