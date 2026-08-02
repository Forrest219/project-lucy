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
    sourceCount: 3,
    invalid: false,
    warnings: [],
    usageCount: 0,
    users: [],
    ...overrides
  };
}

function findCard(roleId: string): HTMLElement {
  const card = screen
    .getAllByTestId("role-card")
    .find((node) => node.getAttribute("data-role-id") === roleId);
  if (!card) throw new Error(`role card ${roleId} not found`);
  return card;
}

const TEMPLATE_ROLE: Role = {
  id: "wiki_only",
  description: "Wiki only template",
  source: "template",
  tools: ["wiki_search", "wiki_read"],
  connections: [],
  sourceCount: 0,
  invalid: false,
  warnings: [],
  usageCount: 0,
  users: []
};

const INVALID_TEMPLATE_ROLE: Role = {
  id: "lucy_r1_exact_readonly",
  description:
    "Lucy R1 发布证据账号模板：仅允许访问 POC 数据源和 6 个受控查询工具。用于发布验收，不建议作为日常 Agent 角色。",
  source: "template",
  tools: ["lucy_query"],
  connections: ["poc-mysql-aliyun"],
  sourceCount: 5,
  invalid: true,
  warnings: ["role_resolution_failed:lucy_r1_exact_readonly"],
  usageCount: 0,
  users: []
};

const INVALID_YAML_ROLE: Role = {
  id: "broken_yaml",
  description: "Broken yaml",
  source: "yaml",
  tools: ["nope"],
  connections: [],
  sourceCount: 0,
  invalid: true,
  warnings: ["unknown tool: nope"],
  usageCount: 0,
  users: []
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

    // 默认筛选是「全部正式 Role」，analyst_a（yaml）应当出现，wiki_only_a（template）被隐藏。
    const analystCard = await waitFor(() => findCard("analyst_a"));
    expect(within(analystCard).getByText("analyst_a")).toBeInTheDocument();
    expect(within(analystCard).getByText("正在服务 Agent")).toBeInTheDocument();
    expect(within(analystCard).queryByText(/^in use$/)).not.toBeInTheDocument();
    expect(findCardOrNull("wiki_only_a")).toBeNull();

    // 切到「参考模板」筛选，验证 template 卡片的中文文案。
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const templateCard = await waitFor(() => findCard("wiki_only_a"));
    expect(within(templateCard).getByText("wiki_only_a")).toBeInTheDocument();
    expect(within(templateCard).getByText("参考模板")).toBeInTheDocument();
    expect(within(templateCard).queryByText(/^template$/)).not.toBeInTheDocument();
    expect(within(templateCard).queryByText(/^Template$/)).not.toBeInTheDocument();
  });

  it("renders the four business-oriented default metrics", async () => {
    stubRoles([
      makeRole({
        id: "metrics_in_use",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      }),
      makeRole({ id: "metrics_unused" }),
      INVALID_YAML_ROLE,
      {
        ...TEMPLATE_ROLE,
        id: "metrics_template_in_use",
        usageCount: 1,
        users: [{ id: "template_user", name: "Template User", enabled: true, tokenCount: 0 }]
      }
    ]);

    renderRoleList();
    await waitFor(() => findCard("metrics_in_use"));

    // 头部不应再出现旧的 YAML role / Template / Invalid 计数。
    expect(screen.queryByText(/YAML role/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Template$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Invalid$/)).not.toBeInTheDocument();

    // 默认 KPI 必须包含四项业务指标（在 metric grid 内，不在卡片 badge 内）。
    expect(screen.getByTestId("role-metric-正式 Role")).toBeInTheDocument();
    expect(screen.getByTestId("role-metric-正在服务 Agent")).toBeInTheDocument();
    expect(screen.getByTestId("role-metric-待修复")).toBeInTheDocument();
    expect(screen.getByTestId("role-metric-未被 Agent 使用")).toBeInTheDocument();
    expect(screen.getByTestId("role-metric-正在服务 Agent")).toHaveTextContent("2");
    // 参考模板不在默认 KPI 内。
    expect(screen.queryByTestId("role-metric-参考模板")).not.toBeInTheDocument();
  });

  it("shows the status strip instead of the legacy yaml/template/invalid summary", async () => {
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
    const strip = await screen.findByTestId("role-status-strip");
    expect(strip.textContent).toMatch(/正式 Role/);
    expect(strip.textContent).toMatch(/正在服务 Agent/);
    expect(strip.textContent).toMatch(/待修复/);
    expect(strip.textContent).toMatch(/参考模板/);
    // 老的弱文本 summary 必须彻底消失。
    expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\d+\s*yaml\s*·/);
  });

  it("labels the filter control 筛选角色范围 with Chinese business options", async () => {
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
    expect(labels).toEqual([
      "全部正式 Role",
      "正在服务 Agent",
      "待修复",
      "未被 Agent 使用",
      "参考模板"
    ]);
  });

  it("uses 待修复 for invalid yaml roles and never renders 禁用/已停用", async () => {
    stubRoles([INVALID_YAML_ROLE]);
    renderRoleList();
    const card = await waitFor(() => findCard("broken_yaml"));
    expect(within(card).getByText("待修复")).toBeInTheDocument();
    expect(within(card).queryByText(/^invalid$/)).not.toBeInTheDocument();
    expect(within(card).queryByText("禁用")).not.toBeInTheDocument();
    expect(within(card).queryByText("已停用")).not.toBeInTheDocument();
  });

  it("uses 参考模板 for template roles and never renders naked Template", async () => {
    stubRoles([TEMPLATE_ROLE]);
    renderRoleList();
    // 默认筛选「全部正式 Role」会隐藏 template，需要切到「参考模板」筛选。
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const card = await waitFor(() => findCard("wiki_only"));
    expect(within(card).getByText("参考模板")).toBeInTheDocument();
    expect(within(card).queryByText(/^Template$/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/^template$/)).not.toBeInTheDocument();
  });

  it("uses 正在服务 Agent for in-use yaml roles and never renders in use", async () => {
    stubRoles([
      makeRole({
        id: "in_use_role",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      })
    ]);
    renderRoleList();
    const card = await waitFor(() => findCard("in_use_role"));
    expect(within(card).getByText("正在服务 Agent")).toBeInTheDocument();
    expect(within(card).queryByText(/^in use$/)).not.toBeInTheDocument();
  });

  it("filters by business scope: 全部正式 Role / 正在服务 Agent / 待修复 / 未被 Agent 使用 / 参考模板", async () => {
    stubRoles([
      makeRole({
        id: "scope_in_use",
        usageCount: 1,
        users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }]
      }),
      makeRole({ id: "scope_unused" }),
      INVALID_YAML_ROLE,
      {
        ...TEMPLATE_ROLE,
        id: "scope_template_in_use",
        usageCount: 1,
        users: [{ id: "template_user", name: "Template User", enabled: true, tokenCount: 0 }]
      }
    ]);

    renderRoleList();
    await waitFor(() => findCard("scope_in_use"));
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;

    // 全部正式 Role：默认筛选，只看 source=yaml（含 invalid / unused / in-use）。
    expect(filter.value).toBe("formal");
    expect(findCardOrNull("scope_in_use")).not.toBeNull();
    expect(findCardOrNull("scope_unused")).not.toBeNull();
    expect(findCardOrNull("broken_yaml")).not.toBeNull();
    expect(findCardOrNull("wiki_only")).toBeNull();

    // 正在服务 Agent：所有被 Agent 引用的 role，包括被引用的参考模板。
    fireEvent.change(filter, { target: { value: "in-use" } });
    expect(findCardOrNull("scope_in_use")).not.toBeNull();
    expect(findCardOrNull("scope_template_in_use")).not.toBeNull();
    expect(findCardOrNull("scope_unused")).toBeNull();
    expect(findCardOrNull("broken_yaml")).toBeNull();

    // 待修复：包含 invalid yaml 与 invalid template。
    fireEvent.change(filter, { target: { value: "needs-repair" } });
    expect(findCardOrNull("broken_yaml")).not.toBeNull();
    expect(findCardOrNull("wiki_only")).toBeNull();
    expect(findCardOrNull("scope_in_use")).toBeNull();

    // 未被 Agent 使用：仅 valid 且未引用。
    fireEvent.change(filter, { target: { value: "unused" } });
    expect(findCardOrNull("scope_unused")).not.toBeNull();
    expect(findCardOrNull("scope_in_use")).toBeNull();
    expect(findCardOrNull("broken_yaml")).toBeNull();

    // 参考模板：仅 template。
    fireEvent.change(filter, { target: { value: "templates" } });
    expect(findCardOrNull("scope_template_in_use")).not.toBeNull();
    expect(findCardOrNull("scope_in_use")).toBeNull();
    expect(findCardOrNull("broken_yaml")).toBeNull();
  });

  it("filters by search text on id and description", async () => {
    stubRoles([
      makeRole({ id: "analyst_search", description: "数据分析师" }),
      makeRole({ id: "engineer_search", description: "数据工程师" })
    ]);
    renderRoleList();
    await waitFor(() => findCard("analyst_search"));

    const search = screen.getByPlaceholderText(/搜索/);
    fireEvent.change(search, { target: { value: "工程" } });
    expect(findCardOrNull("analyst_search")).toBeNull();
    expect(findCardOrNull("engineer_search")).not.toBeNull();

    fireEvent.change(search, { target: { value: "analy" } });
    expect(findCardOrNull("analyst_search")).not.toBeNull();
    expect(findCardOrNull("engineer_search")).toBeNull();
  });

  it("clicking 新建 Role navigates to /admin/roles/new", async () => {
    stubRoles([]);
    renderRoleList();
    fireEvent.click(await screen.findByRole("link", { name: /新建 Role/ }));
    expect(await screen.findByTestId("new-role")).toBeInTheDocument();
  });

  it("template list card no longer shows 复制为 YAML Role as a primary action", async () => {
    stubRoles([TEMPLATE_ROLE]);
    renderRoleList();
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "templates" } });
    const card = await waitFor(() => findCard("wiki_only"));
    const buttons = within(card).queryAllByRole("link");
    expect(buttons.find((b) => b.textContent?.includes("复制为 YAML Role"))).toBeUndefined();
    expect(within(card).getByRole("link", { name: "查看" })).toBeInTheDocument();
  });

  it("renders user-readable diagnosis for role_resolution_failed warnings", async () => {
    stubRoles([INVALID_TEMPLATE_ROLE]);
    renderRoleList();
    const filter = (await screen.findByLabelText("筛选角色范围")) as HTMLSelectElement;
    // 待修复筛选同时覆盖 invalid yaml 和 invalid template。
    fireEvent.change(filter, { target: { value: "needs-repair" } });
    const card = await waitFor(() => findCard("lucy_r1_exact_readonly"));
    expect(within(card).getByText(/权限解析失败/)).toBeInTheDocument();
    const techNode = within(card).getByText(/role_resolution_failed/);
    expect(techNode).toBeInTheDocument();
    expect(techNode.getAttribute("translate")).toBe("no");
    expect(techNode.className).toContain("notranslate");
    expect(within(card).getByText(/仅允许访问 POC 数据源/)).toBeInTheDocument();
    expect(
      within(card).queryByText(/exact 6-tool controlled data service surface/)
    ).not.toBeInTheDocument();
  });
});

function findCardOrNull(roleId: string): HTMLElement | null {
  try {
    return findCard(roleId);
  } catch {
    return null;
  }
}
