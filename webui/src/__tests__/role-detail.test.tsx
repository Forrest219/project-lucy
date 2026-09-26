// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleDetail } from "../pages/admin/RoleDetail";
import type { RoleDetail as RoleDetailType } from "../lib/types";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/roles/new" element={<RoleDetail mode="create" />} />
          <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
          <Route path="/admin/roles" element={<div>roles</div>} />
          <Route path="/admin/agents/:userId" element={<div>agent</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeRole(overrides: Partial<RoleDetailType> = {}): RoleDetailType {
  return {
    id: "analyst",
    version: "v-detail",
    description: "Analyst role",
    source: "yaml",
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
    sourceNames: ["superstore_orders"],
    sourceCount: 1,
    invalid: false,
    warnings: [],
    usageCount: 0,
    users: [],
    role: {
      description: "Analyst role",
      allow: {
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }],
      },
    },
    effectivePermissions: {
      roleIds: ["analyst"],
      snapshotHash: "abc",
      sourceMapVersion: "v1",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sources: [{ connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_orders", table: "dataforai.superstore_orders" }],
      legacyAllow: false,
      capabilities: [],
    },
    ...overrides,
  };
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function installFetch(role: RoleDetailType | null = null, handler?: FetchHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = await handler?.(url, init);
    if (handled) return handled;
    if (role && url === `/api/admin/roles/${role.id}` && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify({ ok: true, data: role }));
    }
    if (url === "/api/connections") {
      return new Response(JSON.stringify({ ok: true, data: { connections: [{ id: "mysql-aliyun", schemas: ["dataforai"], enabledTables: ["dataforai.superstore_orders"] }] } }));
    }
    if (url === "/api/connections/mysql-aliyun/tables") {
      return new Response(JSON.stringify({ ok: true, data: { tables: ["dataforai.superstore_orders", "dataforai.superstore_returns"] } }));
    }
    if (url === "/api/admin/mcp-tools") {
      return new Response(JSON.stringify({ ok: true, data: { tools: [
        { name: "sl_query", globalDenied: true },
        { name: "lucy_query", globalDenied: false },
        { name: "lucy_catalog", globalDenied: false },
        { name: "lucy_read_source", globalDenied: false },
        { name: "lucy_explain_query", globalDenied: false },
        { name: "lucy_freshness", globalDenied: false },
        { name: "lucy_begin_question", globalDenied: false },
        { name: "wiki_search", globalDenied: false },
        { name: "wiki_read", globalDenied: false },
        { name: "entity_details", globalDenied: false },
        { name: "sl_validate", globalDenied: false },
      ] } }));
    }
    if (url === "/api/sources/mysql-aliyun/dataforai/superstore_orders") {
      return new Response(JSON.stringify({ ok: true, data: {
        model: {
          conn: "mysql-aliyun", schema: "dataforai", table: "superstore_orders", filePath: "semantic-layer/demo.yaml",
          descriptions: {}, columns: [{ name: "region", type: "string", descriptions: {} }, { name: "order_id", type: "string", descriptions: {} }],
          measures: [{ name: "total_sales", expr: "sum(sales)" }],
        },
        rawYaml: "", completion: "done",
      } }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RoleDetail Spec 150", () => {
  it("renders four independent create surfaces and an initially clean shared draft", async () => {
    installFetch();
    renderAt("/admin/roles/new");
    expect(await screen.findByRole("heading", { name: "新建 Role" })).toBeInTheDocument();
    for (const name of ["基本信息", "可访问的表", "允许的 MCP 工具", "行级策略（可选）"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "权限配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "生效边界" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "变更预览" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("role-dirty-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("role-boundary-summary")).toBeInTheDocument();
  });

  it("keeps table and tool edits in one draft across surfaces", async () => {
    installFetch();
    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "new_role" } });
    fireEvent.click(screen.getByRole("tab", { name: /可访问的表/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "superstore_orders" }));
    fireEvent.click(screen.getByRole("tab", { name: /允许的 MCP 工具/ }));
    fireEvent.click(screen.getByRole("button", { name: "只读问答" }));
    fireEvent.click(screen.getByRole("tab", { name: /可访问的表/ }));
    expect(screen.getByRole("checkbox", { name: "superstore_orders" })).toBeChecked();
    expect(screen.getByTestId("role-boundary-summary")).toHaveTextContent("6");
    expect(screen.getByTestId("role-dirty-bar")).toBeInTheDocument();
  });

  it("maps the legacy permissions deep link to 可访问的表", async () => {
    installFetch(makeRole());
    renderAt("/admin/roles/analyst?tab=permissions");
    expect(await screen.findByRole("tab", { name: /可访问的表/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("role-table-grants")).toBeInTheDocument();
  });

  it("runs create dryRun before opening the review Drawer and confirms the exact payload", async () => {
    const calls: Array<{ dryRun: boolean; body: any }> = [];
    installFetch(null, (url, init) => {
      if (url === "/api/admin/roles" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        calls.push({ dryRun: body.dryRun, body });
        if (body.dryRun) return new Response(JSON.stringify({ ok: true, data: { diff: "+ role", proposedYaml: "roles: {}" } }));
        return new Response(JSON.stringify({ ok: true, data: { written: true, runtimeAck: true } }));
      }
      if (url === "/api/admin/roles/new_role") return new Response(JSON.stringify({ ok: true, data: makeRole({ id: "new_role" }) }));
    });
    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "new_role" } });
    fireEvent.click(screen.getByRole("tab", { name: /可访问的表/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "superstore_orders" }));
    fireEvent.click(screen.getByRole("tab", { name: /允许的 MCP 工具/ }));
    fireEvent.click(screen.getByRole("button", { name: "只读问答" }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    const drawer = await screen.findByTestId("role-permission-review-drawer");
    expect(within(drawer).getByText("确认权限变更")).toBeInTheDocument();
    expect(within(drawer).getByText("完整 YAML diff")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.dryRun).toBe(true);
    expect(JSON.stringify(calls[0]!.body)).not.toContain("prefix");
    fireEvent.click(within(drawer).getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(calls.some((call) => call.dryRun === false)).toBe(true));
    expect(calls[1]!.body.role).toEqual(calls[0]!.body.role);
  });

  it("invalidates a preview after the Drawer is closed and the draft changes", async () => {
    installFetch(makeRole(), (url, init) => {
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true, data: { diff: "+ change", proposedYaml: "yaml", version: "v-preview" } }));
      }
    });
    renderAt("/admin/roles/analyst");
    fireEvent.change(await screen.findByLabelText("说明"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    const drawer = await screen.findByTestId("role-permission-review-drawer");
    fireEvent.click(within(drawer).getByRole("button", { name: "取消" }));
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "Changed again" } });
    expect(screen.queryByTestId("role-permission-review-drawer")).not.toBeInTheDocument();
  });

  it("requires catalog_bound confirmation and a non-empty connection", async () => {
    const fetchMock = installFetch();
    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "catalog_role" } });
    fireEvent.click(screen.getByRole("tab", { name: /可访问的表/ }));
    fireEvent.click(screen.getByText("高级设置"));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用目录绑定" }));
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]) === "/api/admin/roles")).toBe(false));
    fireEvent.click(screen.getByRole("tab", { name: /行级策略/ }));
    expect(screen.getByTestId("row-policy-catalog-bound-disabled")).toBeInTheDocument();
  });

  it("edits row policy in a focused Drawer with physical columns only", async () => {
    installFetch(makeRole({
      tools: ["lucy_query", "lucy_read_source"],
      role: {
        description: "Analyst role",
        allow: {
          connections: ["mysql-aliyun"],
          tools: ["lucy_query", "lucy_read_source"],
          tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }],
        },
      },
    }));
    renderAt("/admin/roles/analyst?tab=rowPolicy");
    fireEvent.click(await screen.findByRole("button", { name: "编辑 superstore_orders 行级策略" }));
    const drawer = await screen.findByTestId("row-policy-drawer");
    fireEvent.click(await within(drawer).findByRole("button", { name: "添加条件" }));
    const field = within(drawer).getByLabelText("superstore_orders 条件 1 字段");
    expect(within(field).getByRole("option", { name: "region" })).toBeInTheDocument();
    expect(within(field).queryByRole("option", { name: "total_sales" })).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "region" } });
    fireEvent.change(within(drawer).getByLabelText("superstore_orders 条件 1 取值"), { target: { value: "East" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "应用" }));
    expect(await screen.findByText("已配置 1 条条件")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-tool-warning")).toBeInTheDocument();
  });

  it("migrates a resolvable legacy prefix and never sends prefix in v2 payload", async () => {
    const legacy = makeRole({
      role: { description: "Legacy", allow: { tools: ["lucy_query"], connections: ["mysql-aliyun"], tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", prefix: "superstore_" }] } },
      effectivePermissions: { ...makeRole().effectivePermissions!, sources: [{ connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_orders", table: "dataforai.superstore_orders" }] },
    });
    let previewBody: any;
    installFetch(legacy, (url, init) => {
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        previewBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ok: true, data: { diff: "+ migration", proposedYaml: "yaml", version: "v2" } }));
      }
    });
    renderAt("/admin/roles/analyst");
    expect(await screen.findByTestId("legacy-prefix-migration")).toHaveTextContent("展开为当前明确表清单");
    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    await screen.findByTestId("role-permission-review-drawer");
    expect(JSON.stringify(previewBody)).not.toContain("prefix");
    expect(previewBody.patch.allow.tableSelectors[0].names).toContain("superstore_orders");
  });

  it("keeps templates read-only and exposes only copy", async () => {
    const template = makeRole({ id: "wiki_only", source: "template", usageCount: 0, role: { description: "Wiki template", allow: { tools: ["wiki_search", "wiki_read"] } } });
    installFetch(template);
    renderAt("/admin/roles/wiki_only");
    expect(await screen.findByDisplayValue("Wiki template")).toBeDisabled();
    expect(screen.getByRole("link", { name: "基于此模板创建 Role" })).toHaveAttribute("href", "/admin/roles/wiki_only?mode=copy&tab=overview");
    expect(screen.queryByRole("button", { name: "删除 Role" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("role-dirty-bar")).not.toBeInTheDocument();
  });

  it("uses a delete impact Drawer and blocks deletion while referenced", async () => {
    const used = makeRole({ usageCount: 1, users: [{ id: "agent-1", name: "Agent 1", enabled: true, tokenCount: 1 }] });
    installFetch(used);
    renderAt("/admin/roles/analyst");
    expect(await screen.findByRole("button", { name: "删除 Role" })).toBeDisabled();

    cleanup();
    const calls: boolean[] = [];
    installFetch(makeRole(), (url, init) => {
      if (url === "/api/admin/roles/analyst" && init?.method === "DELETE") {
        const body = JSON.parse(String(init.body));
        calls.push(body.dryRun);
        return body.dryRun
          ? new Response(JSON.stringify({ ok: true, data: { diff: "- analyst", proposedYaml: "roles: {}", version: "delete-preview" } }))
          : new Response(JSON.stringify({ ok: true, data: { written: true, runtimeAck: true } }));
      }
    });
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "删除 Role" }));
    const drawer = await screen.findByTestId("role-permission-review-drawer");
    expect(within(drawer).getByText("确认删除 Role")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(calls).toEqual([true, false]));
  });

  it("converts the legacy delete deep link into an overview dryRun Drawer", async () => {
    const calls: boolean[] = [];
    installFetch(makeRole(), (url, init) => {
      if (url === "/api/admin/roles/analyst" && init?.method === "DELETE") {
        const body = JSON.parse(String(init.body));
        calls.push(body.dryRun);
        return new Response(JSON.stringify({ ok: true, data: { diff: "- analyst", proposedYaml: "roles: {}", version: "delete-preview" } }));
      }
    });
    renderAt("/admin/roles/analyst?mode=delete");
    const drawer = await screen.findByTestId("role-permission-review-drawer");
    expect(within(drawer).getByText("确认删除 Role")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "概览", hidden: true })).toHaveAttribute("aria-selected", "true");
    expect(calls).toEqual([true]);
  });

  it("retains the draft and review Drawer when runtimeAck is false", async () => {
    installFetch(makeRole(), (url, init) => {
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return body.dryRun
          ? new Response(JSON.stringify({ ok: true, data: { diff: "+ desc", proposedYaml: "yaml", version: "preview" } }))
          : new Response(JSON.stringify({ ok: true, data: { written: false, runtimeAck: false } }));
      }
    });
    renderAt("/admin/roles/analyst");
    fireEvent.change(await screen.findByLabelText("说明"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    const drawer = await screen.findByTestId("role-permission-review-drawer");
    fireEvent.click(within(drawer).getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(screen.getByTestId("role-permission-review-drawer")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Keep me")).toBeInTheDocument();
    expect(screen.getByTestId("role-dirty-bar")).toBeInTheDocument();
  });

  it("lists referencing agents on the usage surface", async () => {
    installFetch(makeRole({ usageCount: 1, users: [{ id: "agent-1", name: "运营问数", enabled: true, tokenCount: 2 }] }));
    renderAt("/admin/roles/analyst?tab=usage");
    expect(await screen.findByText("运营问数")).toBeInTheDocument();
    expect(screen.getByText(/agent-1/).closest("a")).toHaveAttribute("href", "/admin/agents/agent-1");
  });
});
