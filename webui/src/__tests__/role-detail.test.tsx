// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleDetail } from "../pages/admin/RoleDetail";
import type { RoleDetail as RoleDetailType } from "../lib/types";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/roles/new" element={<RoleDetail mode="create" />} />
          <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
          <Route path="/admin/agents/:userId" element={<div data-testid="agent-detail">agent</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeYamlRole(overrides: Partial<RoleDetailType> = {}): RoleDetailType {
  return {
    id: "analyst",
    version: "v-detail",
    description: "Analyst role",
    source: "yaml",
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
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
        tableSelectors: [
          { connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }
        ]
      }
    },
    effectivePermissions: {
      roleIds: ["analyst"],
      snapshotHash: "abc",
      sourceMapVersion: "v1",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sources: [
        { connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "dataforai", table: "dataforai.superstore_orders" }
      ],
      legacyAllow: false
    },
    ...overrides
  };
}

function makeTemplateRole(): RoleDetailType {
  return makeYamlRole({
    id: "wiki_only",
    description: "Wiki only template",
    source: "template",
    tools: ["wiki_search", "wiki_read"],
    connections: [],
    sourceCount: 0,
    role: {
      description: "Wiki only template",
      allow: { tools: ["wiki_search", "wiki_read"] }
    },
    effectivePermissions: {
      roleIds: ["wiki_only"],
      snapshotHash: "tmp",
      sourceMapVersion: "v1",
      tools: ["wiki_search", "wiki_read"],
      connections: [],
      sources: [],
      legacyAllow: false
    }
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSingleRole(detail: RoleDetailType) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/admin/roles/${detail.id}`) {
        return new Response(JSON.stringify({ ok: true, data: detail }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

describe("RoleDetail", () => {
  it("/admin/roles/new renders the create form and shows role id input", async () => {
    renderAt("/admin/roles/new");
    expect(await screen.findByRole("heading", { name: "新建 Role" })).toBeInTheDocument();
    expect(document.getElementById("role-id-input")).toBeInTheDocument();
    expect(document.getElementById("role-tools-input")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /预览保存/ })).toBeInTheDocument();
  });

  it("create flow calls POST /api/admin/roles dryRun first, then dryRun:false on confirm", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/roles" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                diff: "+ roles:\n+   new_role: ...\n+     allow:\n+       tools:\n+         - lucy_query",
                proposedYaml: "roles:\n  new_role:\n    allow:\n      tools: [lucy_query]\n"
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { written: true, role: makeYamlRole({ id: "new_role" }) }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^Role ID/), { target: { value: "new_role" } });
    fireEvent.change(screen.getByLabelText(/^MCP 工具/), { target: { value: "lucy_query" } });
    fireEvent.change(screen.getByLabelText(/^Connections/), { target: { value: "mysql-aliyun" } });

    fireEvent.click(screen.getByRole("button", { name: /预览保存/ }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "POST" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(dryRunCall).toBeTruthy();
    });

    expect(await screen.findByTestId("role-diff")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /确认创建/ }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "POST" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(saveCall).toBeTruthy();
    });
  });

  it("renders edit form for yaml role and dirty state triggers sticky save bar", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    expect(await screen.findByRole("heading", { name: "analyst" })).toBeInTheDocument();
    expect(screen.queryByTestId("role-dirty-bar")).not.toBeInTheDocument();

    const descInput = screen.getByDisplayValue("Analyst role") as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: "Edited" } });
    expect(await screen.findByTestId("role-dirty-bar")).toBeInTheDocument();
  });

  it("template role detail shows read-only banner and 基于此模板创建 Role CTA", async () => {
    stubSingleRole(makeTemplateRole());
    renderAt("/admin/roles/wiki_only");
    // M57: 模板状态使用「参考模板」文案，且必须能跳到 detail/usage/perms 等 tab。
    expect(await screen.findByText("参考模板")).toBeInTheDocument();
    // 模板只读 banner 内的 CTA 必须改用「基于此模板创建 Role」，并把 role id 编入 aria-label。
    const copyLink = screen.getByRole("link", { name: /基于参考模板 wiki_only 创建 Role/ });
    expect(copyLink.textContent).toBe("基于此模板创建 Role");
    expect(copyLink.getAttribute("href")).toBe("/admin/roles/wiki_only?mode=copy");
    // helper 文案说明 YAML diff 与正式 Role 语义（文本被 notranslate span 拆分，直接断言 body 文本）。
    expect(document.body.textContent ?? "").toMatch(/写入\s*access\.yaml/);
    expect(document.body.textContent ?? "").toMatch(/YAML\s*diff/);
    // 旧「复制为 YAML Role」字样不得作为按钮文案出现。
    expect(screen.queryByRole("link", { name: /^复制为 YAML Role$/ })).not.toBeInTheDocument();
  });

  it("copy mode pre-fills form from source and requires new role id", async () => {
    stubSingleRole(makeTemplateRole());
    renderAt("/admin/roles/wiki_only?mode=copy");
    expect(await screen.findByText(/复制 Role/)).toBeInTheDocument();
    // role id input should be empty
    const idInput = document.getElementById("role-id-input") as HTMLInputElement;
    expect(idInput.value).toBe("");
    // tools pre-filled from template
    const toolsTextarea = document.getElementById("role-tools-input") as HTMLTextAreaElement;
    expect(toolsTextarea.value).toContain("wiki_search");
  });

  it("copy flow calls POST /api/admin/roles/:roleId/copy dryRun first then dryRun:false", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/roles/wiki_only" && !init) {
        return new Response(JSON.stringify({ ok: true, data: makeTemplateRole() }));
      }
      if (url === "/api/admin/roles/wiki_only/copy" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                diff: "+ roles:\n+   wiki_clone: ...",
                proposedYaml: "roles:\n  wiki_clone:\n    allow:\n      tools: [wiki_search, wiki_read]\n"
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { written: true, role: makeYamlRole({ id: "wiki_clone" }) }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/wiki_only?mode=copy");
    const idInput = (await screen.findByLabelText(/^Role ID/)) as HTMLInputElement;
    fireEvent.change(idInput, { target: { value: "wiki_clone" } });
    fireEvent.change(screen.getByLabelText(/^描述/), { target: { value: "Copied and edited" } });
    fireEvent.click(screen.getByRole("button", { name: /预览复制/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (item) => String(item[0]) === "/api/admin/roles/wiki_only/copy" && JSON.parse(String((item[1] as RequestInit).body)).dryRun === true
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body)).role.description).toBe("Copied and edited");
    });

    fireEvent.click(await screen.findByRole("button", { name: /确认创建/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (item) => String(item[0]) === "/api/admin/roles/wiki_only/copy" && JSON.parse(String((item[1] as RequestInit).body)).dryRun === false
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body)).role.description).toBe("Copied and edited");
    });
  });

  it("rejects wildcard tools before submit", async () => {
    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^Role ID/), { target: { value: "wildcard_role" } });
    fireEvent.change(screen.getByLabelText(/^MCP 工具/), { target: { value: "*" } });
    fireEvent.click(screen.getByRole("button", { name: /预览保存/ }));
    // No fetch calls because we don't have a fetch mock
    expect(screen.queryByTestId("role-diff")).not.toBeInTheDocument();
  });

  it("effective permissions tab renders tools and sources", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "权限预览" }));
    expect(screen.getByText("lucy_query")).toBeInTheDocument();
    expect(screen.getByText(/dataforai/)).toBeInTheDocument();
  });

  it("M55: 权限预览 explains that allowed MCP tools filter tools/list and intercept tools/call", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "权限预览" }));
    const label = await screen.findByTestId("role-allowed-tools-label");
    // 标签需明确 runtime 影响，且不能丢失 tools/list、tools/call 提示
    expect(label.textContent ?? "").toContain("允许的 MCP 工具");
    expect(label.textContent ?? "").toContain("tools/list");
    expect(label.textContent ?? "").toContain("tools/call");
    // 工具 chip 列表数据-testid 保持
    const toolList = screen.getByTestId("role-allowed-tools-list");
    expect(toolList).toHaveTextContent("lucy_query");
  });

  it("usage tab lists agents that reference the role", async () => {
    stubSingleRole(
      makeYamlRole({
        usageCount: 2,
        users: [
          { id: "zhangsan", name: "张三", enabled: true, tokenCount: 0 },
          { id: "lisi", name: "李四", enabled: true, tokenCount: 1 }
        ]
      })
    );
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "使用情况" }));
    const zhangsan = screen.getByText("张三");
    expect(zhangsan).toBeInTheDocument();
    const card = zhangsan.closest("a");
    expect(card?.getAttribute("href")).toBe("/admin/agents/zhangsan");
  });

  it("editing after preview clears stale diff and save uses the preview version", async () => {
    stubSingleRole(makeYamlRole());
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/roles/analyst" && !init) {
        return new Response(JSON.stringify({ ok: true, data: makeYamlRole() }));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (!body.dryRun) {
          return new Response(JSON.stringify({ ok: true, data: { written: true, version: "v-after" } }));
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { diff: "+ description: Stale", proposedYaml: "yaml", version: "v-preview" }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/analyst");
    const desc = (await screen.findByDisplayValue("Analyst role")) as HTMLInputElement;
    fireEvent.change(desc, { target: { value: "v1" } });
    fireEvent.click(screen.getByRole("button", { name: /预览并保存/ }));
    expect(await screen.findByTestId("role-diff")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(saveCall).toBeTruthy();
      const saveBody = JSON.parse(String((saveCall![1] as RequestInit).body));
      expect(saveBody.version).toBe("v-preview");
      expect(saveBody.patch.description).toBe("v1");
    });

    // Go back to config, edit again; the old diff is invalidated immediately.
    fireEvent.click(screen.getByRole("button", { name: "基本配置" }));
    const desc2 = screen.getByDisplayValue("v1") as HTMLInputElement;
    fireEvent.change(desc2, { target: { value: "v2" } });
    fireEvent.click(screen.getByRole("button", { name: "变更预览" }));
    expect(screen.queryByTestId("role-diff")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "基本配置" }));
    fireEvent.click(screen.getByRole("button", { name: /预览并保存/ }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("delete flow sends dryRun false in the DELETE body on confirm", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/roles/analyst" && !init) {
        return new Response(JSON.stringify({ ok: true, data: makeYamlRole() }));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "DELETE") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: { diff: "- analyst", proposedYaml: "roles: {}\n", version: "v-delete-preview" }
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, data: { written: true } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/analyst?mode=delete");
    fireEvent.click(await screen.findByRole("button", { name: /预览删除/ }));
    expect(await screen.findByTestId("role-diff")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "DELETE" && JSON.parse(String(call[1].body)).dryRun === false
      );
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(String((saveCall![1] as RequestInit).body)).version).toBe("v-delete-preview");
    });
  });

  it("renders invalid warning when role cannot be resolved", async () => {
    stubSingleRole(
      makeYamlRole({
        id: "broken",
        invalid: true,
        warnings: ["role_resolution_failed:broken"],
        role: { allow: { tools: ["nope"] } }
      })
    );
    renderAt("/admin/roles/broken");
    fireEvent.click(await screen.findByRole("button", { name: "权限预览" }));
    expect(await screen.findByText("待修复")).toBeInTheDocument();
    expect(screen.getByText(/权限解析失败/)).toBeInTheDocument();
    const technical = screen.getByTestId("role-detail-warning-tech-0");
    expect(technical).toHaveTextContent("role_resolution_failed:broken");
    expect(technical.getAttribute("translate")).toBe("no");
    expect(technical.className).toContain("notranslate");
    expect(screen.queryByText(/该 role 当前无法解析：role_resolution_failed/)).not.toBeInTheDocument();
  });
});
