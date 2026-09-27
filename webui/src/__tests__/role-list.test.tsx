// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleList } from "../pages/admin/RoleList";
import type { Role } from "../lib/types";

function renderRoleList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/roles"]}>
        <Routes>
          <Route path="/admin/roles" element={<RoleList />} />
          <Route path="/admin/roles/new" element={<div data-testid="new-role">new role</div>} />
          <Route path="/admin/roles/:roleId" element={<div data-testid="role-detail">role detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "analyst",
    description: "Analyst role",
    source: "yaml",
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
    sourceNames: ["superstore_orders", "dataforai.superstore_orders"],
    sourceCount: 3,
    invalid: false,
    warnings: [],
    usageCount: 0,
    users: [],
    configUpdatedAt: "2026-08-04T06:32:00.000Z",
    ...overrides
  };
}

function findRow(roleId: string): HTMLElement {
  return screen.getByTestId(`role-row-${roleId}`);
}

const TEMPLATE_ROLE: Role = {
  id: "wiki_only",
  description: "Wiki only template",
  source: "template",
  tools: ["wiki_search", "wiki_read"],
  connections: [],
  sourceNames: [],
  sourceCount: 0,
  invalid: false,
  warnings: [],
  usageCount: 0,
  users: [],
  configUpdatedAt: null
};

const INVALID_TEMPLATE_ROLE: Role = {
  id: "lucy_r1_exact_readonly",
  description:
    "Lucy R1 发布证据账号模板：仅允许访问 POC 数据源和 6 个受控查询工具。用于发布验收，不建议作为日常 Agent 角色。",
  source: "template",
  tools: ["lucy_query"],
  connections: ["poc-mysql-aliyun"],
  sourceNames: [],
  sourceCount: 5,
  invalid: true,
  warnings: ["role_resolution_failed:lucy_r1_exact_readonly"],
  usageCount: 0,
  users: [],
  configUpdatedAt: null
};

const INVALID_YAML_ROLE: Role = {
  id: "broken_yaml",
  description: "Broken yaml",
  source: "yaml",
  tools: ["nope"],
  connections: [],
  sourceNames: [],
  sourceCount: 0,
  invalid: true,
  warnings: ["unknown tool: nope"],
  usageCount: 0,
  users: [],
  configUpdatedAt: "2026-08-04T06:32:00.000Z"
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubRoles(roles: Role[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/roles") {
        return new Response(JSON.stringify({ ok: true, data: { roles } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

describe("RoleList", () => {
  it("renders formal and reference-template roles with 中文业务 status badges", async () => {
    stubRoles([
      makeRole({
        id: "analyst_a",
        description: "Analyst",
        usageCount: 2,
        users: [
          { id: "zhangsan", name: "张三", enabled: true, tokenCount: 1 },
          { id: "lisi", name: "李四", enabled: true, tokenCount: 0 }
        ]
      }),
      { ...TEMPLATE_ROLE, id: "wiki_only_a" }
    ]);

    renderRoleList();
    expect(await screen.findByRole("heading", { name: "角色权限" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "角色配置" })).not.toBeInTheDocument();

    const analystCard = await waitFor(() => findRow("analyst_a"));
    expect(within(analystCard).getByText("analyst_a")).toBeInTheDocument();
    expect(within(analystCard).getByText("正式")).toBeInTheDocument();
    expect(within(analystCard).getByText("使用中")).toBeInTheDocument();
    expect(within(analystCard).queryByText("正在服务 Agent")).not.toBeInTheDocument();
    expect(within(analystCard).queryByText(/^in use$/)).not.toBeInTheDocument();
    expect(findRowOrNull("wiki_only_a")).toBeNull();

    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const templateCard = await waitFor(() => findRow("wiki_only_a"));
    expect(within(templateCard).getByText("wiki_only_a")).toBeInTheDocument();
    expect(within(templateCard).getByText("参考模板")).toBeInTheDocument();
    expect(within(templateCard).queryByText(/^template$/)).not.toBeInTheDocument();
    expect(within(templateCard).queryByText("使用中")).not.toBeInTheDocument();
  });

  it("renders static lifecycle metrics without clickable KPI filters", async () => {
    stubRoles([
      makeRole({
        id: "metrics_in_use",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      }),
      makeRole({ id: "metrics_unused" }),
      INVALID_YAML_ROLE,
      INVALID_TEMPLATE_ROLE,
      {
        ...TEMPLATE_ROLE,
        id: "metrics_template_in_use",
        usageCount: 1,
        users: [{ id: "template_user", name: "Template User", enabled: true, tokenCount: 0 }]
      }
    ]);

    renderRoleList();
    await waitFor(() => findRow("metrics_in_use"));

    expect(screen.queryByText(/YAML role/)).not.toBeInTheDocument();
    expect(screen.getByTestId("role-metric-grid")).toBeInTheDocument();
    expect(screen.getByTestId("metric-role-count")).toHaveTextContent("3");
    expect(screen.getByTestId("metric-in-use")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-invalid")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-unused")).toHaveTextContent("1");
    expect(screen.getByTestId("role-invalid-notice")).toHaveTextContent(/解析异常/);

    expect(screen.queryByRole("button", { name: /筛选：/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("metric-invalid").className).not.toMatch(/pl-metric-card--danger/);
    expect(screen.getByTestId("metric-help-role-count")).toBeInTheDocument();
    expect(screen.getByTestId("metric-help-invalid")).toBeInTheDocument();
    expect(screen.getByTestId("metric-role-count")).toHaveClass("pl-metric-card--with-help");
  });

  it("does not render the legacy status strip and drops template helper from header", async () => {
    stubRoles([
      makeRole({
        id: "strip_in_use",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      }),
      INVALID_YAML_ROLE,
      TEMPLATE_ROLE
    ]);

    renderRoleList();
    await waitFor(() => findRow("strip_in_use"));
    expect(screen.queryByTestId("role-status-strip")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/参考模板仅用于低频创建辅助/);
    expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\d+\s*yaml\s*·/);
  });

  it("labels the filter control 筛选角色范围 with Chinese Role-subject options", async () => {
    stubRoles([
      makeRole({
        id: "filter_in_use",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      }),
      TEMPLATE_ROLE,
      INVALID_YAML_ROLE
    ]);

    renderRoleList();
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;

    const labels = Array.from(filter.options).map((opt) => opt.textContent);
    expect(labels).toEqual(["全部正式 Role", "使用中", "待修复", "未引用", "参考模板"]);
  });

  it("uses 待修复 for invalid yaml roles and never renders 禁用/已停用", async () => {
    stubRoles([INVALID_YAML_ROLE]);
    renderRoleList();
    const card = await waitFor(() => findRow("broken_yaml"));
    expect(within(card).getByText("待修复")).toBeInTheDocument();
    expect(within(card).queryByText(/^invalid$/)).not.toBeInTheDocument();
    expect(within(card).queryByText("禁用")).not.toBeInTheDocument();
    expect(within(card).queryByText("已停用")).not.toBeInTheDocument();
  });

  it("uses 参考模板 for template roles and never renders naked Template", async () => {
    stubRoles([TEMPLATE_ROLE]);
    renderRoleList();
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const row = await waitFor(() => findRow("wiki_only"));
    expect(within(row).getByText("参考模板")).toBeInTheDocument();
    expect(within(row).getByText("内置模板")).toBeInTheDocument();
    expect(within(row).queryByText(/^Template$/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^template$/)).not.toBeInTheDocument();
  });

  it("uses 使用中 for in-use yaml roles and never renders in use / 正在服务 Agent", async () => {
    stubRoles([
      makeRole({
        id: "in_use_role",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      })
    ]);
    renderRoleList();
    const card = await waitFor(() => findRow("in_use_role"));
    expect(within(card).getByText("使用中")).toBeInTheDocument();
    expect(within(card).queryByText("正在服务 Agent")).not.toBeInTheDocument();
    expect(within(card).queryByText(/^in use$/)).not.toBeInTheDocument();
  });

  it("filters by yaml-aligned business scope and keeps template invalid under 参考模板", async () => {
    stubRoles([
      makeRole({
        id: "scope_in_use",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      }),
      makeRole({ id: "scope_unused" }),
      INVALID_YAML_ROLE,
      INVALID_TEMPLATE_ROLE,
      {
        ...TEMPLATE_ROLE,
        id: "scope_template_in_use",
        usageCount: 1,
        users: [{ id: "template_user", name: "Template User", enabled: true, tokenCount: 0 }]
      }
    ]);

    renderRoleList();
    await waitFor(() => findRow("scope_in_use"));
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;

    expect(filter.value).toBe("formal");
    expect(findRowOrNull("scope_in_use")).not.toBeNull();
    expect(findRowOrNull("scope_unused")).not.toBeNull();
    expect(findRowOrNull("broken_yaml")).not.toBeNull();
    expect(findRowOrNull("lucy_r1_exact_readonly")).toBeNull();

    // 使用中：仅 yaml + usageCount > 0
    fireEvent.change(filter, { target: { value: "in-use" } });
    expect(findRowOrNull("scope_in_use")).not.toBeNull();
    expect(findRowOrNull("scope_template_in_use")).toBeNull();
    expect(findRowOrNull("scope_unused")).toBeNull();
    expect(findRowOrNull("broken_yaml")).toBeNull();

    // 待修复：仅 formal invalid
    fireEvent.change(filter, { target: { value: "needs-repair" } });
    expect(findRowOrNull("broken_yaml")).not.toBeNull();
    expect(findRowOrNull("lucy_r1_exact_readonly")).toBeNull();
    expect(findRowOrNull("scope_in_use")).toBeNull();

    // 未引用：仅 valid unused yaml
    fireEvent.change(filter, { target: { value: "unused" } });
    expect(findRowOrNull("scope_unused")).not.toBeNull();
    expect(findRowOrNull("scope_in_use")).toBeNull();
    expect(findRowOrNull("broken_yaml")).toBeNull();

    // 参考模板：模板 invalid 仍保留待修复状态，诊断详情下沉到对象详情抽屉
    fireEvent.change(filter, { target: { value: "templates" } });
    expect(findRowOrNull("scope_template_in_use")).not.toBeNull();
    const invalidTemplate = findRow("lucy_r1_exact_readonly");
    expect(within(invalidTemplate).getByText("待修复")).toBeInTheDocument();
    expect(within(invalidTemplate).queryByText(/role_resolution_failed/)).not.toBeInTheDocument();
    expect(findRowOrNull("scope_in_use")).toBeNull();
    expect(findRowOrNull("broken_yaml")).toBeNull();
  });

  it("shows 没有正式 Role 待修复 when needs-repair filter has no formal invalid roles", async () => {
    stubRoles([makeRole({ id: "healthy_only" }), INVALID_TEMPLATE_ROLE]);
    renderRoleList();
    await waitFor(() => findRow("healthy_only"));
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "needs-repair" } });
    expect(await screen.findByText("没有正式 Role 待修复")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: "xyz" } });
    expect(await screen.findByText("没有匹配的 Role")).toBeInTheDocument();
    expect(screen.queryByText("没有正式 Role 待修复")).not.toBeInTheDocument();
  });

  it("renders one canonical table row with actions and Asia/Shanghai config time", async () => {
    stubRoles([
      makeRole({
        id: "demo_readonly",
        description: "Demo Superstore readonly agent",
        usageCount: 2,
        users: [
          { id: "demo_agent", name: "Demo", enabled: true, tokenCount: 1 },
          { id: "zhaoying", name: "Zhao", enabled: true, tokenCount: 0 }
        ],
        configUpdatedAt: "2026-08-04T06:32:00.000Z"
      })
    ]);
    renderRoleList();
    const row = await waitFor(() => findRow("demo_readonly"));
    expect(screen.getByTestId("role-list-table")).toBeInTheDocument();
    expect(screen.queryByTestId("role-card")).not.toBeInTheDocument();
    expect(within(row).getByText("Demo Superstore readonly agent")).toBeInTheDocument();
    expect(within(row).getByText("3 个 source · 1 个 conn")).toBeInTheDocument();
    expect(within(row).getByTestId("role-allowed-tools-count-demo_readonly")).toHaveTextContent("1 个");
    expect(row.textContent).toMatch(/2 个/);
    expect(row.textContent).toMatch(/Demo, Zhao/);
    expect(within(row).getByText("2026-08-04 14:32")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "编辑" })).toBeInTheDocument();
    expect(within(row).getByTestId("role-id-link-demo_readonly").getAttribute("href"))
      .toContain("object=role&roleId=demo_readonly");

    fireEvent.click(within(row).getByRole("button", { name: "demo_readonly 的更多操作" }));
    expect(screen.getByRole("menuitem", { name: "基于此新建" }))
      .toHaveAttribute("href", "/admin/roles/demo_readonly?mode=copy");
    expect(screen.queryByRole("menuitem", { name: "快捷抽屉预览" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeDisabled();
  });

  it("filters by search text on id and description", async () => {
    stubRoles([
      makeRole({ id: "analyst_search", description: "数据分析师" }),
      makeRole({ id: "engineer_search", description: "数据工程师" })
    ]);
    renderRoleList();
    await waitFor(() => findRow("analyst_search"));

    const search = screen.getByPlaceholderText(/搜索/);
    fireEvent.change(search, { target: { value: "工程" } });
    expect(findRowOrNull("analyst_search")).toBeNull();
    expect(findRowOrNull("engineer_search")).not.toBeNull();

    fireEvent.change(search, { target: { value: "analy" } });
    expect(findRowOrNull("analyst_search")).not.toBeNull();
    expect(findRowOrNull("engineer_search")).toBeNull();
  });

  it("clicking 新建 Role navigates to /admin/roles/new", async () => {
    stubRoles([]);
    renderRoleList();
    fireEvent.click(await screen.findByRole("link", { name: /新建 Role/ }));
    expect(await screen.findByTestId("new-role")).toBeInTheDocument();
  });

  it("template table row uses 查看 and keeps copy as a secondary action", async () => {
    stubRoles([TEMPLATE_ROLE]);
    renderRoleList();
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const row = await waitFor(() => findRow("wiki_only"));
    const buttons = within(row).queryAllByRole("link");
    expect(buttons.find((b) => b.textContent?.includes("复制为 YAML Role"))).toBeUndefined();
    expect(within(row).getByRole("link", { name: "查看" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "wiki_only 的更多操作" }));
    expect(screen.getByRole("menuitem", { name: "基于此新建" })).toBeInTheDocument();
  });

  it("keeps invalid template status concise in the table", async () => {
    stubRoles([INVALID_TEMPLATE_ROLE]);
    renderRoleList();
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const row = await waitFor(() => findRow("lucy_r1_exact_readonly"));
    expect(within(row).getByText("待修复")).toBeInTheDocument();
    expect(within(row).getByText(/仅允许访问 POC 数据源/)).toBeInTheDocument();
    expect(
      within(row).queryByText(/role_resolution_failed/)
    ).not.toBeInTheDocument();
  });

  it("keeps search and status visible while advanced capability filters are collapsed", async () => {
    stubRoles([
      makeRole({
        id: "with_table",
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        sourceNames: ["superstore_orders"]
      }),
      makeRole({
        id: "other_conn",
        connections: ["poc-mysql"],
        tools: ["wiki_search"],
        sourceNames: ["poc_metric_catalog"]
      }),
      makeRole({
        id: "unresolved",
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        sourceNames: [],
        invalid: true,
        warnings: ["role_resolution_failed:unresolved"]
      })
    ]);
    renderRoleList();
    await screen.findByTestId("role-list-table");

    const toggle = screen.getByTestId("role-advanced-filters-toggle");
    expect(screen.getByLabelText("搜索 role")).toBeInTheDocument();
    expect(screen.getByLabelText("筛选角色范围")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "role-advanced-filters");
    expect(screen.queryByTestId("role-advanced-filters")).not.toBeInTheDocument();
    expect(screen.queryByTestId("role-filter-connection")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("role-advanced-filters")).toHaveAttribute("aria-label", "高级筛选");

    fireEvent.change(screen.getByTestId("role-filter-connection"), { target: { value: "mysql-aliyun" } });
    expect(toggle).toHaveTextContent("收起高级（1）");
    expect(findRowOrNull("with_table")).toBeTruthy();
    expect(findRowOrNull("other_conn")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("role-advanced-filters")).not.toBeInTheDocument();
    expect(screen.getByTestId("role-current-filter")).toHaveTextContent("连接 mysql-aliyun");

    fireEvent.click(toggle);

    fireEvent.change(screen.getByTestId("role-filter-connection"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("role-filter-tool"), { target: { value: "wiki_search" } });
    expect(findRowOrNull("other_conn")).toBeTruthy();
    expect(findRowOrNull("with_table")).toBeNull();

    fireEvent.change(screen.getByTestId("role-filter-tool"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("role-filter-table"), { target: { value: "superstore" } });
    expect(findRowOrNull("with_table")).toBeTruthy();
    expect(findRowOrNull("unresolved")).toBeNull();
    expect(screen.getByTestId("role-current-filter").textContent).toMatch(/无法解析表范围/);

    fireEvent.change(screen.getByLabelText("搜索 role"), { target: { value: "wiki_search" } });
    fireEvent.change(screen.getByTestId("role-filter-table"), { target: { value: "" } });
    expect(findRowOrNull("other_conn")).toBeTruthy();
    expect(findRowOrNull("with_table")).toBeNull();

    fireEvent.click(screen.getByTestId("role-clear-filters"));
    expect((screen.getByLabelText("搜索 role") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("筛选角色范围") as HTMLSelectElement).value).toBe("formal");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("role-clear-filters")).not.toBeInTheDocument();
    expect(findRowOrNull("with_table")).toBeTruthy();
    expect(findRowOrNull("other_conn")).toBeTruthy();
  });

  it("offers clear filters from a filtered empty state", async () => {
    stubRoles([makeRole({ id: "healthy_only" })]);
    renderRoleList();
    await screen.findByTestId("role-row-healthy_only");

    fireEvent.change(screen.getByLabelText("搜索 role"), { target: { value: "missing" } });
    expect(await screen.findByText("没有匹配的 Role")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("role-clear-filters-empty"));

    expect(await screen.findByTestId("role-row-healthy_only")).toBeInTheDocument();
    expect((screen.getByLabelText("搜索 role") as HTMLInputElement).value).toBe("");
  });
});

function findRowOrNull(roleId: string): HTMLElement | null {
  return screen.queryByTestId(`role-row-${roleId}`);
}
