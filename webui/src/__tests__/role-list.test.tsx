// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const INVALID_ROLE: Role = {
  id: "broken",
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
  it("renders YAML and template roles with usage count", async () => {
    stubRoles([
      makeRole({ id: "analyst", description: "Analyst", usageCount: 2, users: [
        { id: "zhangsan", name: "张三", enabled: true, tokenCount: 1 },
        { id: "lisi", name: "李四", enabled: true, tokenCount: 0 }
      ] }),
      TEMPLATE_ROLE
    ]);

    renderRoleList();
    expect(await screen.findByRole("heading", { name: "角色权限" })).toBeInTheDocument();
    expect(screen.getByText("访问治理")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "角色配置" })).not.toBeInTheDocument();
    expect(await screen.findByText("analyst")).toBeInTheDocument();
    expect(screen.getByText("wiki_only")).toBeInTheDocument();
    // M39 polish: the "Agent" word is wrapped in a notranslate span for
    // translation defense, which splits the text node. Use a custom
    // matcher to assert the text content across the wrapping span.
    expect(
      screen.getByText((_content, element) => {
        return element?.textContent?.replace(/\s+/g, " ").trim() === "2 位 Agent 引用";
      })
    ).toBeInTheDocument();
    expect(screen.getByText("template")).toBeInTheDocument();
  });

  it("shows invalid warning badge for invalid roles", async () => {
    stubRoles([INVALID_ROLE]);
    renderRoleList();
    expect(await screen.findByText("broken")).toBeInTheDocument();
    expect(screen.getByText(/unknown tool/)).toBeInTheDocument();
  });

  it("filters by source: all / yaml / template / invalid / in-use", async () => {
    stubRoles([
      makeRole({ id: "analyst", usageCount: 1, users: [{ id: "u1", name: "U1", enabled: true, tokenCount: 0 }] }),
      TEMPLATE_ROLE,
      INVALID_ROLE,
      makeRole({ id: "free_role", description: "Unused" })
    ]);

    renderRoleList();
    await waitFor(() => {
      expect(screen.getByText("analyst")).toBeInTheDocument();
    });

    const filter = screen.getByLabelText("筛选来源") as HTMLSelectElement;

    // yaml only
    fireEvent.change(filter, { target: { value: "yaml" } });
    expect(screen.getByText("analyst")).toBeInTheDocument();
    expect(screen.getByText("free_role")).toBeInTheDocument();
    expect(screen.queryByText("wiki_only")).not.toBeInTheDocument();

    // template only
    fireEvent.change(filter, { target: { value: "template" } });
    expect(screen.getByText("wiki_only")).toBeInTheDocument();
    expect(screen.queryByText("analyst")).not.toBeInTheDocument();

    // invalid
    fireEvent.change(filter, { target: { value: "invalid" } });
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(screen.queryByText("wiki_only")).not.toBeInTheDocument();

    // in-use
    fireEvent.change(filter, { target: { value: "in-use" } });
    expect(screen.getByText("analyst")).toBeInTheDocument();
    expect(screen.queryByText("free_role")).not.toBeInTheDocument();
  });

  it("filters by search text on id and description", async () => {
    stubRoles([
      makeRole({ id: "analyst", description: "数据分析师" }),
      makeRole({ id: "engineer", description: "数据工程师" })
    ]);
    renderRoleList();
    await waitFor(() => {
      expect(screen.getByText("analyst")).toBeInTheDocument();
    });

    const search = screen.getByPlaceholderText(/搜索/);
    fireEvent.change(search, { target: { value: "工程" } });
    expect(screen.queryByText("analyst")).not.toBeInTheDocument();
    expect(screen.getByText("engineer")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "analy" } });
    expect(screen.getByText("analyst")).toBeInTheDocument();
    expect(screen.queryByText("engineer")).not.toBeInTheDocument();
  });

  it("clicking 新建 Role navigates to /admin/roles/new", async () => {
    stubRoles([]);
    renderRoleList();
    fireEvent.click(await screen.findByRole("link", { name: /新建 Role/ }));
    expect(await screen.findByTestId("new-role")).toBeInTheDocument();
  });

  it("clicking 复制为 YAML Role on a template navigates with copy mode", async () => {
    stubRoles([TEMPLATE_ROLE]);
    renderRoleList();
    const card = await screen.findByText("wiki_only");
    const cardNode = card.closest("[data-testid='role-card']") ?? card.parentElement;
    expect(cardNode).not.toBeNull();
    const buttons = within(cardNode as HTMLElement).getAllByRole("link");
    const copyLink = buttons.find((b) => b.textContent?.includes("复制为 YAML Role"));
    expect(copyLink).toBeDefined();
    expect(copyLink?.getAttribute("href")).toBe("/admin/roles/wiki_only?mode=copy");
  });

  it("renders a metric summary of yaml vs template vs invalid count", async () => {
    stubRoles([
      makeRole({ id: "a" }),
      makeRole({ id: "b", invalid: false }),
      TEMPLATE_ROLE,
      INVALID_ROLE
    ]);
    renderRoleList();
    expect(await screen.findByTestId("summary")).toHaveTextContent("3 yaml · 1 template · 1 invalid");
  });
});
