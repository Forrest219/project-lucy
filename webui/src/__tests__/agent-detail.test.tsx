// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDetail, constraintsFromAgent, serializeConstraints } from "../pages/admin/AgentDetail";
import type { Agent } from "../lib/types";

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
            { connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_orders", table: "dataforai.superstore_orders" },
            { connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_returns", table: "dataforai.superstore_returns" }
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
    if (url === "/api/admin/agents/zhangsan" && (!init || !init.method || init.method === "GET")) {
      return new Response(JSON.stringify(makeAgentDetailResponse()));
    }
    if (url === "/api/admin/agents/zhangsan" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      if (body.dryRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: body.patch?.constraints !== undefined
                ? "+ constraints:\n+   sources:"
                : "+ name: 张三编辑",
              proposedYaml: "yaml",
              ...(body.patch?.roles || body.patch?.constraints !== undefined
                ? {
                    effectivePermissions: {
                      roleIds: body.patch?.roles ?? ["analyst"],
                      snapshotHash: "snap-1234",
                      sourceMapVersion: "v1",
                      tools: ["lucy_query"],
                      connections: ["mysql-aliyun"],
                      sources: [],
                      legacyAllow: false,
                      capabilities: [
                        {
                          tool: "lucy_query",
                          connectionId: "mysql-aliyun",
                          schema: "dataforai",
                          sourceName: body.patch?.roles ? "server_composed_source" : "superstore_orders",
                          physicalTable: "dataforai.superstore_orders",
                          sourceKey: "mysql-aliyun|dataforai|superstore_orders|dataforai.superstore_orders",
                          rowGrant: "all",
                          finalRows: { kind: "scoped", digest: "deadbeefcafebabe" },
                          protected: true,
                          constraintsSummary: "region=East"
                        }
                      ]
                    }
                  }
                : {})
            }
          })
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            written: true,
            runtimeAck: true,
            policyVersion: "pv-test-agent-detail-001",
            agent: {
              id: "zhangsan",
              name: body.patch?.name ?? "张三编辑",
              enabled: body.patch?.enabled ?? true,
              role: body.patch?.role ?? "analyst",
              tokens: [],
              allow: { tables: [], tools: [] },
              ...(body.patch?.constraints !== undefined
                ? { constraints: body.patch.constraints }
                : {})
            }
          }
        })
      );
    }
    if (url.startsWith("/api/admin/roles")) {
      return new Response(JSON.stringify({ ok: true, data: { roles } }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AgentDetail", () => {
  it("keeps status, role, and token context out of the PageHeader", async () => {
    stubAgentEndpoints();
    renderAgentDetail("/admin/agents/zhangsan?tab=tokens");

    expect(await screen.findByText(/当前活跃 token/)).toBeInTheDocument();
    expect(screen.queryByTestId("page-header-badges")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "权限预览" }));
    expect(await screen.findByText("当前角色")).toBeInTheDocument();
  });

  it("exposes MCP playground deep link with agentId", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    const link = await screen.findByTestId("agent-detail-mcp-playground");
    expect(link).toHaveAttribute("href", "/admin/mcp-playground?agentId=zhangsan&mode=dry-run");
    expect(link).toHaveTextContent("在 MCP 调试台试调");
  });

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
    const analyst = await screen.findByRole("checkbox", { name: "analyst" });
    fireEvent.click(screen.getByRole("checkbox", { name: "ops_readonly" }));
    fireEvent.click(analyst);
    await waitFor(() => {
      expect(screen.getByTestId("agent-role-capability")).toHaveTextContent("server_composed_source");
    });
    expect(screen.getByTestId("agent-role-capability")).not.toHaveTextContent("lucy_catalog");
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
      expect(JSON.parse(String(saveCall?.[1]?.body)).patch.roles).toEqual(["ops_readonly"]);
    });
  });

  it("keeps two roles checked and writes both in the save patch", async () => {
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
    const field = await screen.findByTestId("agent-role-field");
    expect(within(field).queryByRole("combobox")).not.toBeInTheDocument();
    const analyst = within(field).getByRole("checkbox", { name: "analyst" });
    const ops = within(field).getByRole("checkbox", { name: "ops_readonly" });
    expect(analyst).toBeChecked();

    fireEvent.click(ops);

    expect(analyst).toBeChecked();
    expect(ops).toBeChecked();
    await waitFor(() => {
      expect(screen.getByTestId("agent-role-capability")).toHaveTextContent("analyst, ops_readonly");
    });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(within(await screen.findByTestId("agent-save-confirm-modal")).getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(JSON.parse(String(saveCall?.[1]?.body)).patch.roles).toEqual(["analyst", "ops_readonly"]);
    });
  });

  it("clears stale diff preview when edits change after viewing diff", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    fireEvent.change(await screen.findByDisplayValue("张三"), { target: { value: "预览名" } });
    fireEvent.click(screen.getByRole("button", { name: "查看变更 diff" }));
    expect(await screen.findByText(/\+ name: 张三编辑/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "基本信息" }));
    fireEvent.change(screen.getByDisplayValue("预览名"), { target: { value: "预览后又改名" } });
    fireEvent.click(screen.getByRole("tab", { name: "变更预览" }));
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
      if (url === "/api/admin/agents/zhangsan" && (!init || !init.method || init.method === "GET")) {
        return new Response(JSON.stringify(makeAgentDetailResponse()));
      }
      if (url.startsWith("/api/admin/roles")) {
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
    fireEvent.click(await screen.findByRole("tab", { name: "Token" }));

    const row = await screen.findByTestId("agent-token-row-hermes-laptop");
    const rowText = row.textContent ?? "";
    expect(rowText).toContain("2026-06-18");
    expect(rowText).toContain("[REDACTED]");
    expect(rowText).not.toContain("sha256:aaaa0000bbbb1111");
    expect(rowText).toContain("sl_query");
    expect(rowText).toContain("ok");
    expect(rowText).not.toContain("身份");

    fireEvent.click(screen.getByRole("link", { name: /生成新 Token/ }));
    await waitFor(() => {
      expect(screen.getByTestId("new-token")).toBeInTheDocument();
    });
  });

  it("Token tab renders five tokens as compact rows without empty context fields", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan") {
        return new Response(
          JSON.stringify(
            makeAgentDetailResponse({
              tokens: [
                {
                  hash: "sha256:11110000aaaa1111bbbb2222cccc3333",
                  label: "sparse",
                  created: "2026-06-01"
                },
                {
                  hash: "sha256:22220000aaaa1111bbbb2222cccc3333",
                  label: "noted",
                  created: "2026-06-02",
                  device_name: "xingchen-mbp",
                  last_client: "cursor",
                  last_client_version: "0.45.0",
                  last_device_name_seen: "office-imac"
                },
                {
                  hash: "sha256:33330000aaaa1111bbbb2222cccc3333",
                  label: "expiring",
                  created: "2026-06-03",
                  expires_at: "2026-12-01",
                  last_used: "2026-06-20T08:00:00.000Z"
                },
                {
                  hash: "sha256:44440000aaaa1111bbbb2222cccc3333",
                  label: "client-only",
                  created: "2026-06-04",
                  last_client: "codex"
                },
                {
                  hash: "sha256:55550000aaaa1111bbbb2222cccc3333",
                  label: "unused",
                  created: "2026-06-05"
                }
              ]
            })
          )
        );
      }
      if (url.startsWith("/api/admin/roles")) {
        return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAgentDetail("/admin/agents/zhangsan?tab=tokens");

    const list = await screen.findByTestId("agent-token-list");
    expect(within(list).getAllByTestId(/^agent-token-row-/)).toHaveLength(5);
    expect(list).not.toHaveTextContent("身份");

    const sparse = screen.getByTestId("agent-token-row-sparse");
    expect(sparse).toHaveTextContent("尚未使用");
    expect(sparse).not.toHaveTextContent("备注");
    expect(sparse).not.toHaveTextContent("Agent 类型");
    expect(sparse).not.toHaveTextContent("最近设备名");

    const noted = screen.getByTestId("agent-token-row-noted");
    expect(noted).toHaveTextContent("备注");
    expect(noted).toHaveTextContent("xingchen-mbp");
    expect(noted).toHaveTextContent("cursor 0.45.0");
    expect(noted).toHaveTextContent("office-imac");

    expect(screen.getByTestId("agent-token-row-client-only")).toHaveTextContent("codex");
    expect(screen.getByTestId("agent-token-row-client-only")).not.toHaveTextContent("备注");
    expect(screen.getByTestId("agent-token-row-expiring")).toHaveTextContent("过期 2026-12-01");
    expect(screen.getByTestId("agent-token-row-unused")).toHaveTextContent("尚未使用");
  });

  it("opens Token tab from the tab query parameter", async () => {
    stubAgentEndpoints();
    renderAgentDetail("/admin/agents/zhangsan?tab=tokens");

    expect(await screen.findByText(/当前活跃 token/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Token" })).toHaveClass("pl-admin-tab--active");
  });

  it("Effective Permissions tree groups sources by connection then schema and shows tools", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    fireEvent.click(await screen.findByRole("tab", { name: "权限预览" }));
    const tree = await screen.findByTestId("permissions-tree");
    expect(tree).toHaveTextContent("mysql-aliyun");
    expect(tree).toHaveTextContent("dataforai");
    expect(tree).toHaveTextContent("superstore_orders");
    expect(tree).toHaveTextContent("lucy_query");
  });

  it("Data Capability Preview shows scoped digest from API rowGrant", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan") {
        return new Response(
          JSON.stringify(
            makeAgentDetailResponse({
              effectivePermissions: {
                roleIds: ["analyst"],
                snapshotHash: "snap-1234",
                sourceMapVersion: "v1",
                tools: ["lucy_query"],
                connections: ["mysql-aliyun"],
                sources: [
                  {
                    connectionId: "mysql-aliyun",
                    schema: "dataforai",
                    sourceName: "superstore_orders",
                    table: "dataforai.superstore_orders"
                  }
                ],
                legacyAllow: false,
                capabilityDigest: "ae0a470dc0ca9931",
                capabilities: [
                  {
                    tool: "lucy_query",
                    connectionId: "mysql-aliyun",
                    schema: "dataforai",
                    sourceName: "superstore_orders",
                    physicalTable: "dataforai.superstore_orders",
                    sourceKey: "mysql-aliyun|dataforai|superstore_orders|dataforai.superstore_orders",
                    rowGrant: { kind: "scoped", digest: "883501db707ba111" },
                    finalRows: { kind: "scoped", digest: "aabbccddeeff0011" },
                    protected: true,
                    constraintsSummary: "region=East"
                  }
                ]
              }
            })
          )
        );
      }
      if (url.startsWith("/api/admin/roles")) {
        return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAgentDetail();
    fireEvent.click(await screen.findByRole("tab", { name: "权限预览" }));
    const preview = await screen.findByTestId("capability-preview");
    // rowGrant/FinalRows detail lives inside <details> but still accessible via textContent
    expect(preview).toHaveTextContent("rowGrant=scoped:883501db707ba111");
    expect(preview).toHaveTextContent("FinalRows=scoped:aabbccddeeff0011");
    expect(preview).toHaveTextContent("protected");
    expect(preview).toHaveTextContent("constraints=region=East");
    expect(preview.textContent ?? "").not.toMatch(/rowGrant=TRUE/);
    expect(preview.textContent ?? "").not.toMatch(/行级取数已生效/);
  });

  it("constraints form round-trip preserves TypedScalar (number / spaces / case)", () => {
    const agent = {
      id: "zhangsan",
      name: "张三",
      enabled: true,
      role: "analyst",
      tokens: [],
      constraints: {
        sources: [
          {
            connection: "mysql-aliyun",
            schema: "dataforai",
            names: ["superstore_orders"],
            predicates: [
              { field: "qty", op: "eq", value: 1 },
              { field: "region", op: "eq", value: "ABC " },
              { field: "flag", op: "in", values: [true, 0, "x "] }
            ]
          }
        ]
      }
    } as Agent;
    const form = constraintsFromAgent(agent);
    const serialized = serializeConstraints(form);
    expect(serialized?.sources?.[0]?.predicates).toEqual([
      { field: "qty", op: "eq", value: 1 },
      { field: "region", op: "eq", value: "ABC " },
      { field: "flag", op: "in", values: [true, 0, "x "] }
    ]);
    expect(typeof serialized?.sources?.[0]?.predicates?.[0]?.value).toBe("number");
  });

  it("personal row limit editor explains the tightening and picks granted tables", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    const editor = await screen.findByTestId("agent-constraints-editor");
    expect(editor).toHaveTextContent("个人行限制");
    expect(editor).toHaveTextContent("未添加个人行限制");
    expect(editor).toHaveTextContent("在这个 Agent 已绑定角色的行级策略之上");
    expect(editor.querySelector(".notranslate")).toBeTruthy();
    expect(editor.textContent ?? "").toMatch(/不表示行级取数已生效/);
    fireEvent.click(within(editor).getByRole("button", { name: "添加行限制" }));
    expect(within(editor).getByText(/行限制 1/)).toBeInTheDocument();
    expect(within(editor).getByRole("checkbox", { name: "superstore_orders" })).toBeInTheDocument();
    expect(within(editor).queryByRole("textbox", { name: "connection" })).not.toBeInTheDocument();
    expect(await screen.findByTestId("sticky-save-bar")).toBeInTheDocument();
  });

  it("constraints save opens confirm modal with FinalRows preview then writes with runtimeAck", async () => {
    const fetchMock = stubAgentEndpoints();
    renderAgentDetail();
    const editor = await screen.findByTestId("agent-constraints-editor");
    fireEvent.click(within(editor).getByRole("button", { name: "添加行限制" }));
    fireEvent.click(within(editor).getByRole("checkbox", { name: "superstore_orders" }));
    fireEvent.change(within(editor).getByRole("textbox", { name: "字段" }), { target: { value: "region" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "取值" }), { target: { value: "East" } });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const modal = await screen.findByTestId("agent-save-confirm-modal");
    expect(within(modal).getByText("确认个人行限制变更")).toBeInTheDocument();
    // Sticky save bar must not remain mounted — it intercepts pointer events on confirm.
    expect(screen.queryByTestId("sticky-save-bar")).not.toBeInTheDocument();
    const preview = within(modal).getByTestId("confirm-finalrows-preview");
    expect(preview).toHaveTextContent("FinalRows=scoped:deadbeefcafebabe");
    expect(preview).toHaveTextContent("protected");
    expect(preview).toHaveTextContent("不表示行级取数已生效");

    fireEvent.click(within(modal).getByTestId("agent-save-confirm-submit"));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(saveCall).toBeTruthy();
      const body = JSON.parse(String(saveCall?.[1]?.body));
      expect(body.patch.constraints).toMatchObject({
        sources: [
          {
            connection: "mysql-aliyun",
            schema: "dataforai",
            names: ["superstore_orders"],
            predicates: [{ field: "region", op: "eq", value: "East" }]
          }
        ]
      });
    });
  });

  it("marks a personal row limit stale when its table is outside the current role grant", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan") {
        return new Response(JSON.stringify(makeAgentDetailResponse({
          constraints: {
            sources: [{
              connection: "other-db",
              schema: "other",
              names: ["secret_table"],
              predicates: [{ field: "dept", op: "eq", value: "A" }]
            }]
          }
        })));
      }
      if (url.startsWith("/api/admin/roles")) {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            roles: [{
              id: "analyst",
              description: "Analyst role",
              source: "yaml",
              tools: ["lucy_query"],
              connections: ["mysql-aliyun"],
              sourceNames: ["superstore_orders"],
              sourceCount: 1,
              invalid: false,
              warnings: []
            }]
          }
        }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    }));
    renderAgentDetail();
    const editor = await screen.findByTestId("agent-constraints-editor");
    expect(editor).toHaveTextContent("已失效");
    expect(editor).toHaveTextContent("secret_table");
    expect(within(editor).queryByRole("textbox", { name: "connection" })).not.toBeInTheDocument();
    expect(within(editor).queryByRole("textbox", { name: "schema" })).not.toBeInTheDocument();
    expect(within(editor).queryByRole("textbox", { name: "names" })).not.toBeInTheDocument();
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
      if (url.startsWith("/api/admin/roles")) {
        return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAgentDetail();
    fireEvent.click(await screen.findByRole("tab", { name: "权限预览" }));

    expect(await screen.findByText(/legacy wildcard 仍在使用/)).toBeInTheDocument();
  });

  it("Agent detail role field shows 管理角色 link", async () => {
    stubAgentEndpoints();
    renderAgentDetail();
    expect(await screen.findByText("张三")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /管理角色/ });
    expect(link.getAttribute("href")).toBe("/admin/roles");
  });

  it("Agent detail Token tab exposes active token count from stats", async () => {
    stubAgentEndpoints();
    renderAgentDetail("/admin/agents/zhangsan?tab=tokens");
    expect(await screen.findByText(/当前活跃 token/)).toHaveTextContent("1");
    expect(document.body).not.toHaveTextContent(/^\s*7d denied\s*$/);
  });

  // Spec 129 tests
  it("clicking a tab writes ?tab= to URL search", async () => {
    stubAgentEndpoints();
    const locationRef = { current: "" };
    function LocationCapture() {
      const loc = useLocation();
      locationRef.current = loc.search;
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/agents/zhangsan"]}>
          <LocationCapture />
          <Routes>
            <Route path="/admin/agents/:userId" element={<AgentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByDisplayValue("张三");
    fireEvent.click(screen.getByRole("tab", { name: "Token" }));
    expect(locationRef.current).toContain("tab=tokens");

    fireEvent.click(screen.getByRole("tab", { name: "权限预览" }));
    expect(locationRef.current).toContain("tab=permissions");
  });

  it("roles API is called with includeTemplates=false and templates are absent from select", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(makeAgentDetailResponse()));
      }
      if (url.startsWith("/api/admin/roles")) {
        // Verify includeTemplates=false is in the URL
        expect(url).toContain("includeTemplates=false");
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              roles: [
                { id: "analyst", description: "Analyst", source: "yaml", tools: [], connections: [], sourceNames: [], sourceCount: 0, invalid: false, warnings: [] },
                { id: "ref-template", description: "Template", source: "template", tools: [], connections: [], sourceNames: [], sourceCount: 0, invalid: false, warnings: [] }
              ]
            }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAgentDetail();
    await screen.findByDisplayValue("张三");
    const field = screen.getByTestId("agent-role-field");
    expect(field).toHaveTextContent("analyst");
    expect(field).not.toHaveTextContent("ref-template");
    expect(screen.getByRole("checkbox", { name: "analyst" })).toBeChecked();
  });

  it("Permissions tab: 数据能力 label present; capabilityDigest in details only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/agents/zhangsan") {
        return new Response(
          JSON.stringify(
            makeAgentDetailResponse({
              effectivePermissions: {
                roleIds: ["analyst"],
                snapshotHash: "snap-1234",
                sourceMapVersion: "v1",
                tools: ["lucy_query"],
                connections: ["mysql-aliyun"],
                sources: [],
                legacyAllow: false,
                capabilityDigest: "ae0a470dc0ca9931",
                capabilities: [
                  {
                    tool: "lucy_query",
                    connectionId: "mysql-aliyun",
                    schema: "dataforai",
                    sourceName: "superstore_orders",
                    physicalTable: "dataforai.superstore_orders",
                    sourceKey: "mysql-aliyun|dataforai|superstore_orders|dataforai.superstore_orders",
                    rowGrant: "all",
                    finalRows: { kind: "scoped", digest: "ae0a470dc0ca9931" },
                    protected: false,
                    constraintsSummary: null
                  }
                ]
              }
            })
          )
        );
      }
      if (url.startsWith("/api/admin/roles")) {
        return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAgentDetail();
    fireEvent.click(await screen.findByRole("tab", { name: "权限预览" }));
    const preview = await screen.findByTestId("capability-preview");

    // Main label must be 「数据能力」
    expect(preview).toHaveTextContent("数据能力");

    // capabilityDigest must be inside a <details> element, not in the top-level visible text
    const detailsEl = preview.querySelector("details");
    expect(detailsEl).not.toBeNull();
    expect(detailsEl?.textContent ?? "").toContain("ae0a470dc0ca9931");

    // The text outside <details> must NOT contain the digest
    const mainText = Array.from(preview.childNodes)
      .filter((n) => n !== detailsEl)
      .map((n) => (n as Element).textContent ?? "")
      .join("");
    expect(mainText).not.toContain("ae0a470dc0ca9931");
  });
});
