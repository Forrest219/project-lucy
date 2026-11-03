// @vitest-environment jsdom
//
// Lucy v0.25 P1-1 §3.1 / §4 / §6.1 — 角色编辑器接入行策略模板引用.
//
// Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
//   §3.1（模板与引用形态）, §4（写入合同）, §6.1（角色详情增加三种写法）;
//   RTP-08（不可绑定项禁用并给原因）、RTP-10（无模板配置行为不变）.
//
// 覆盖三件事：
//   1. 草稿 → access.yaml 的引用形态（template / template+predicates / predicates）；
//   2. 角色编辑器里能选模板、不可绑定项禁用并**在选择时**披露原因；
//   3. 切模式不丢已写的内联条件（模板谓词与内联谓词取交集，不是并集）。
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { RoleDetail } from "../pages/admin/RoleDetail";
import { buildTableAllow, groupTableGrants } from "../lib/rolePermissionDraft";
import type { RoleDetail as RoleDetailType, RoleSelector } from "../lib/types";

vi.mock("sonner", () => ({
  toast: {
    message: vi.fn(),
    error: vi.fn(),
    success: vi.fn()
  }
}));

const TABLE_KEY = "mysql-aliyun/dataforai/superstore_orders";

const TEMPLATES_RESPONSE = {
  snapshot: {
    identity: {
      configVersion: "cfg-1",
      policyVersion: "pol-1",
      sourceMapVersion: "sm-1",
      capabilityDigest: "cap-1"
    },
    state: "ok",
    problem: null,
    failures: []
  },
  state: "ok",
  templates: [
    {
      name: "by_region",
      description: "按大区限定行",
      predicates: [{ field: "region", op: "eq", value: "East" }],
      digest: "digest-region",
      references: [],
      usabilityByTable: [
        {
          connectionId: "mysql-aliyun",
          schema: "dataforai",
          sourceName: "superstore_orders",
          usability: { status: "bindable" }
        }
      ]
    },
    {
      name: "by_missing_field",
      description: "字段不存在",
      predicates: [{ field: "region_code", op: "eq", value: "CN-EAST" }],
      digest: "digest-missing",
      references: [],
      usabilityByTable: [
        {
          connectionId: "mysql-aliyun",
          schema: "dataforai",
          sourceName: "superstore_orders",
          usability: { status: "field_missing", fields: ["region_code"] }
        }
      ]
    }
  ],
  issues: []
};

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
        tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }]
      }
    },
    effectivePermissions: {
      roleIds: ["analyst"],
      snapshotHash: "abc",
      sourceMapVersion: "v1",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sources: [{ connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_orders", table: "dataforai.superstore_orders" }],
      legacyAllow: false,
      capabilities: []
    },
    ...overrides
  };
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
          <Route path="/admin/roles" element={<div>roles</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function installFetch(role: RoleDetailType, onPatch?: (body: any) => void) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `/api/admin/roles/${role.id}` && method === "GET") {
      return new Response(JSON.stringify({ ok: true, data: role }));
    }
    if (url === `/api/admin/roles/${role.id}` && method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      onPatch?.(body);
      return new Response(JSON.stringify({ ok: true, data: { diff: "+ change", proposedYaml: "yaml", version: "v-preview" } }));
    }
    if (url.startsWith("/api/admin/row-policy/templates")) {
      return new Response(JSON.stringify({ ok: true, data: TEMPLATES_RESPONSE }));
    }
    if (url === "/api/connections") {
      return new Response(JSON.stringify({ ok: true, data: { connections: [{ id: "mysql-aliyun", schemas: ["dataforai"], enabledTables: ["dataforai.superstore_orders"] }] } }));
    }
    if (url === "/api/connections/mysql-aliyun/tables") {
      return new Response(JSON.stringify({ ok: true, data: { tables: ["dataforai.superstore_orders"] } }));
    }
    if (url === "/api/admin/mcp-tools") {
      return new Response(JSON.stringify({ ok: true, data: { tools: [{ name: "lucy_query", globalDenied: false }] } }));
    }
    if (url === `/api/sources/mysql-aliyun/dataforai/superstore_orders`) {
      return new Response(JSON.stringify({ ok: true, data: {
        model: {
          conn: "mysql-aliyun",
          schema: "dataforai",
          table: "superstore_orders",
          filePath: "semantic-layer/demo.yaml",
          descriptions: {},
          columns: [{ name: "region", type: "string", descriptions: {} }],
          measures: []
        },
        rawYaml: "",
        completion: "done"
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

// ─── 1. 草稿 → access.yaml 的引用形态 ───────────────────────────────────────

describe("行策略模板：草稿到 access.yaml 的映射", () => {
  it("只引用模板：写 template，不写 predicates（空数组会被服务端判形状错误）", () => {
    const built = buildTableAllow({
      mode: "names",
      tables: [{ connection: "c", schema: "s", name: "orders", rowPolicyTemplate: "by_region" }]
    });
    expect(built.tableSelectors?.[0]).toEqual({
      connection: "c",
      schema: "s",
      names: ["orders"],
      row_access: "scoped",
      row_policy: { template: "by_region" }
    });
    expect(built.tableSelectors?.[0]?.row_policy).not.toHaveProperty("predicates");
  });

  it("两者并用：template 与内联 predicates 并存（服务端展开后同一条选择器内取交集）", () => {
    const built = buildTableAllow({
      mode: "names",
      tables: [{
        connection: "c",
        schema: "s",
        name: "orders",
        rowPolicyTemplate: "by_region",
        predicates: [{ field: "status", op: "eq", value: "SETTLED" }]
      }]
    });
    expect(built.tableSelectors?.[0]?.row_policy?.template).toBe("by_region");
    expect(built.tableSelectors?.[0]?.row_policy?.predicates).toEqual([
      { sourceName: "orders", field: "status", op: "eq", value: "SETTLED" }
    ]);
  });

  it("只写条件：不带模板的既有行为完全不变（RTP-10）", () => {
    const built = buildTableAllow({
      mode: "names",
      tables: [{ connection: "c", schema: "s", name: "orders", predicates: [{ field: "region", op: "eq", value: "East" }] }]
    });
    expect(built.tableSelectors?.[0]?.row_policy).toEqual({
      predicates: [{ sourceName: "orders", field: "region", op: "eq", value: "East" }]
    });
    expect(built.tableSelectors?.[0]?.row_policy).not.toHaveProperty("template");
  });

  it("模板不同的表不合并成一条选择器", () => {
    const grouped = groupTableGrants([
      { connection: "c", schema: "s", name: "a", rowPolicyTemplate: "by_region" },
      { connection: "c", schema: "s", name: "b", rowPolicyTemplate: "by_status" }
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped.map((selector) => selector.row_policy?.template)).toEqual(["by_region", "by_status"]);
  });

  it("没有行策略的表仍然写 all（不受模板功能影响）", () => {
    const built = buildTableAllow({ mode: "names", tables: [{ connection: "c", schema: "s", name: "orders" }] });
    expect(built.tableSelectors?.[0]).toEqual({ connection: "c", schema: "s", names: ["orders"], row_access: "all" });
  });
});

// ─── 2. 角色编辑器里的模板选择 ───────────────────────────────────────────────

describe("角色编辑器：行策略模板选择器", () => {
  it("列出全部候选；不可绑定项禁用并在选择时给出原因（RTP-08）", async () => {
    installFetch(makeRole());
    renderAt("/admin/roles/analyst?tab=rowPolicy");
    const entry = await screen.findByTestId(`row-policy-entry-${TABLE_KEY}`);
    const picker = await within(entry).findByTestId("row-policy-template-picker");
    expect(within(picker).getByTestId("row-policy-template-option-by_region")).toBeEnabled();
    // 不可绑定项**可见但禁用**，原因在选择时就披露，不等到保存。
    const unusable = within(picker).getByTestId("row-policy-template-option-by_missing_field");
    expect(unusable).toBeDisabled();
    expect(unusable).toHaveTextContent("字段不存在");
    expect(unusable).toHaveTextContent("region_code");
  });

  it("选择模板后写入引用形态，保存的 YAML 只带 template", async () => {
    let patchBody: any;
    installFetch(makeRole(), (body) => { patchBody = body; });
    renderAt("/admin/roles/analyst?tab=rowPolicy");
    const entry = await screen.findByTestId(`row-policy-entry-${TABLE_KEY}`);
    const select = await within(entry).findByLabelText("引用行策略模板");
    fireEvent.change(select, { target: { value: "by_region" } });

    await waitFor(() => expect(within(entry).getByTestId("row-policy-authoring-mode-template")).toBeInTheDocument());
    expect(within(entry).getByTestId("row-policy-authoring-mode-template")).toHaveTextContent("仅引用模板");

    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    await screen.findByTestId("role-permission-review-drawer");
    await waitFor(() => expect(patchBody).toBeDefined());

    const selector = patchBody.patch.allow.tableSelectors[0];
    expect(selector.row_access).toBe("scoped");
    expect(selector.row_policy).toEqual({ template: "by_region" });
    // 实际写盘形状（服务端 `validateRoleShape` 接受 `{ template, predicates? }`）。
    expect(stringify(selector)).toBe(
      ["connection: mysql-aliyun", "schema: dataforai", "names:", "  - superstore_orders", "row_access: scoped", "row_policy:", "  template: by_region", ""].join("\n")
    );
  });

  it("两者并用：template 与内联条件同时写入（同一条选择器内取交集）", async () => {
    let patchBody: any;
    installFetch(makeRole(), (body) => { patchBody = body; });
    renderAt("/admin/roles/analyst?tab=rowPolicy");
    const entry = await screen.findByTestId(`row-policy-entry-${TABLE_KEY}`);

    // 先写一条内联条件。
    fireEvent.click(within(entry).getByRole("button", { name: "编辑 superstore_orders 行级策略" }));
    const drawer = await screen.findByTestId("row-policy-drawer");
    fireEvent.click(await within(drawer).findByRole("button", { name: "添加条件" }));
    fireEvent.change(within(drawer).getByLabelText("superstore_orders 条件 1 字段"), { target: { value: "region" } });
    fireEvent.change(within(drawer).getByLabelText("superstore_orders 条件 1 取值"), { target: { value: "East" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "应用" }));
    await waitFor(() => expect(within(entry).getByTestId("row-policy-authoring-mode-inline")).toBeInTheDocument());

    // 再引用模板：模式变成「两者并用」，已写的内联条件一条都不丢。
    const select = await within(entry).findByLabelText("引用行策略模板");
    fireEvent.change(select, { target: { value: "by_region" } });
    await waitFor(() => expect(within(entry).getByTestId("row-policy-authoring-mode-both")).toBeInTheDocument());
    expect(within(entry).getByTestId("row-policy-authoring-mode-both")).toHaveTextContent("引用模板 + 直接写条件");

    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    await screen.findByTestId("role-permission-review-drawer");
    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody.patch.allow.tableSelectors[0].row_policy).toEqual({
      template: "by_region",
      predicates: [{ field: "region", op: "eq", value: "East" }]
    });
  });

  it("切回「直接写条件」保留此前写下的内联条件（模板引用只作溯源）", async () => {
    let patchBody: any;
    installFetch(makeRole(), (body) => { patchBody = body; });
    renderAt("/admin/roles/analyst?tab=rowPolicy");
    const entry = await screen.findByTestId(`row-policy-entry-${TABLE_KEY}`);

    fireEvent.click(within(entry).getByRole("button", { name: "编辑 superstore_orders 行级策略" }));
    const drawer = await screen.findByTestId("row-policy-drawer");
    fireEvent.click(await within(drawer).findByRole("button", { name: "添加条件" }));
    fireEvent.change(within(drawer).getByLabelText("superstore_orders 条件 1 字段"), { target: { value: "region" } });
    fireEvent.change(within(drawer).getByLabelText("superstore_orders 条件 1 取值"), { target: { value: "East" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "应用" }));

    const select = await within(entry).findByLabelText("引用行策略模板");
    fireEvent.change(select, { target: { value: "by_region" } });
    await waitFor(() => expect(within(entry).getByTestId("row-policy-authoring-mode-both")).toBeInTheDocument());

    // 移除模板引用 → 回到「只写条件」，内联条件仍在。
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(within(entry).getByTestId("row-policy-authoring-mode-inline")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "保存权限配置" }));
    await screen.findByTestId("role-permission-review-drawer");
    await waitFor(() => expect(patchBody).toBeDefined());
    expect(patchBody.patch.allow.tableSelectors[0].row_policy).toEqual({
      predicates: [{ field: "region", op: "eq", value: "East" }]
    });
  });

  it("既有配置里的模板引用原样读回草稿", async () => {
    const role = makeRole({
      role: {
        description: "Analyst role",
        allow: {
          connections: ["mysql-aliyun"],
          tools: ["lucy_query"],
          // 服务端读回的就是引用形态（P1-1 §3.1）；共享类型 `RoleRowPolicy`
          // 还没建模 `template`，这里按线上实际形状造夹具。
          tableSelectors: [{
            connection: "mysql-aliyun",
            schema: "dataforai",
            names: ["superstore_orders"],
            row_access: "scoped",
            row_policy: { template: "by_region" }
          } as unknown as RoleSelector]
        }
      }
    });
    installFetch(role);
    renderAt("/admin/roles/analyst?tab=rowPolicy");
    const entry = await screen.findByTestId(`row-policy-entry-${TABLE_KEY}`);
    await waitFor(() => expect(within(entry).getByTestId("row-policy-authoring-mode-template")).toBeInTheDocument());
    const select = await within(entry).findByLabelText("引用行策略模板");
    expect(select).toHaveValue("by_region");
  });
});
