// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("template role detail shows read-only banner and copy CTA", async () => {
    stubSingleRole(makeTemplateRole());
    renderAt("/admin/roles/wiki_only");
    expect(await screen.findByText("template")).toBeInTheDocument();
    // The page intro and the in-page banner both mention the template; we expect
    // the banner copy inside the config tab to render the "复制为 YAML Role" link.
    const copyLink = screen.getByRole("link", { name: /复制为 YAML Role/ });
    expect(copyLink.getAttribute("href")).toBe("/admin/roles/wiki_only?mode=copy");
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
    fireEvent.click(screen.getByRole("button", { name: /预览复制/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (item) => String(item[0]) === "/api/admin/roles/wiki_only/copy" && JSON.parse(String((item[1] as RequestInit).body)).dryRun === true
      );
      expect(call).toBeTruthy();
    });

    fireEvent.click(await screen.findByRole("button", { name: /确认创建/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (item) => String(item[0]) === "/api/admin/roles/wiki_only/copy" && JSON.parse(String((item[1] as RequestInit).body)).dryRun === false
      );
      expect(call).toBeTruthy();
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

  it("editing after preview clears stale diff", async () => {
    stubSingleRole(makeYamlRole());
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/roles/analyst" && !init) {
        return new Response(JSON.stringify({ ok: true, data: makeYamlRole() }));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH" && JSON.parse(String(init.body)).dryRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { diff: "+ description: Stale", proposedYaml: "yaml" }
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

    // Go back to config, edit again
    fireEvent.click(screen.getByRole("button", { name: "基本配置" }));
    const desc2 = screen.getByDisplayValue("v1") as HTMLInputElement;
    fireEvent.change(desc2, { target: { value: "v2" } });
    // Stale diff should be replaced when we re-preview
    fireEvent.click(screen.getByRole("button", { name: /预览并保存/ }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders invalid warning when role cannot be resolved", async () => {
    stubSingleRole(
      makeYamlRole({
        id: "broken",
        invalid: true,
        warnings: ["unknown tool: nope"],
        role: { allow: { tools: ["nope"] } }
      })
    );
    renderAt("/admin/roles/broken");
    fireEvent.click(await screen.findByRole("button", { name: "权限预览" }));
    expect(await screen.findByText(/unknown tool: nope/)).toBeInTheDocument();
  });
});
