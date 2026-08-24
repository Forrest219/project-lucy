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
    sourceNames: ["superstore_orders", "dataforai.superstore_orders"],
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
    sourceNames: [],
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

function stubCatalogApis(fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/connections") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            connections: [
              {
                id: "mysql-aliyun",
                schemas: ["dataforai"],
                enabledTables: ["dataforai.superstore_orders"]
              }
            ]
          }
        })
      );
    }
    if (url === "/api/admin/mcp-tools") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            tools: [
              { name: "lucy_query", description: "query", globalDenied: false },
              { name: "lucy_read_source", description: "read", globalDenied: false },
              { name: "wiki_search", description: "wiki", globalDenied: false },
              { name: "wiki_read", description: "wiki", globalDenied: false },
              { name: "sql_execution", description: "raw sql", globalDenied: true }
            ]
          }
        })
      );
    }
    if (url === "/api/connections/mysql-aliyun/tables") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { tables: ["dataforai.superstore_orders", "dataforai.superstore_returns"] }
        })
      );
    }
    if (fetchImpl) {
      return fetchImpl(input, init);
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
}

function stubSingleRole(detail: RoleDetailType) {
  vi.stubGlobal(
    "fetch",
    stubCatalogApis(async (input) => {
      const url = String(input);
      if (url === `/api/admin/roles/${detail.id}`) {
        return new Response(JSON.stringify({ ok: true, data: detail }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

describe("RoleDetail", () => {
  it("/admin/roles/new renders identity tab and permissions tab without usage", async () => {
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    expect(await screen.findByRole("heading", { name: "新建 Role" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/新建正式 Role/);
    expect(screen.getByLabelText(/^角色标识/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^说明/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用情况" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生效边界" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    expect(screen.getByText("允许的连接")).toBeInTheDocument();
    expect(screen.getByTestId("role-tools-field")).toBeInTheDocument();
    expect(screen.getByText("可访问的表范围")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 添加表范围" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /预览保存/ })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /lucy_query/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /sql_execution/ })).toBeDisabled();
  });

  it("create flow calls POST /api/admin/roles dryRun first, then dryRun:false on confirm", async () => {
    const fetchMock = stubCatalogApis(async (input, init) => {
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
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "new_role" } });
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /lucy_query/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /mysql-aliyun/ }));

    fireEvent.click(screen.getByRole("button", { name: /预览保存/ }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "POST" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(dryRunCall).toBeTruthy();
      const body = JSON.parse(String((dryRunCall![1] as RequestInit).body));
      expect(body.role.allow.tools).toContain("lucy_query");
      expect(body.role.allow.connections).toContain("mysql-aliyun");
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

  it("shows controlled manual fallback when catalog APIs fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "DOWN", message: "down" } }), { status: 500 }))
    );
    renderAt("/admin/roles/new");
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    expect(await screen.findByTestId("role-connections-fallback-hint")).toBeInTheDocument();
    expect(screen.getByTestId("role-tools-fallback-hint")).toBeInTheDocument();
    const toolInput = within(screen.getByTestId("role-tools-field")).getByLabelText("添加标签");
    fireEvent.change(toolInput, { target: { value: "lucy_query" } });
    fireEvent.keyDown(toolInput, { key: "Enter" });
    expect(within(screen.getByTestId("role-tools-field")).getByText("lucy_query")).toBeInTheDocument();
  });

  it("table range uses connection schemas and supports 指定表名 / 按前缀匹配", async () => {
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /mysql-aliyun/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ 添加表范围" }));
    const range = await screen.findByTestId("role-table-range-1");
    fireEvent.change(within(range).getByLabelText(/表范围 1 连接/), { target: { value: "mysql-aliyun" } });
    fireEvent.change(within(range).getByLabelText(/表范围 1 Schema/), { target: { value: "dataforai" } });
    expect(within(range).getByLabelText(/表范围 1 Schema/).tagName).toBe("SELECT");
    expect(await within(range).findByRole("checkbox", { name: /superstore_orders/ })).toBeInTheDocument();
    fireEvent.click(within(range).getByRole("radio", { name: /^指定表名$/ }));
    fireEvent.click(within(range).getByRole("radio", { name: /按前缀匹配/ }));
    expect(within(range).getByLabelText(/表范围 1 按前缀匹配/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    // tools pre-filled from template
    expect(await screen.findByRole("checkbox", { name: /wiki_search/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /wiki_read/ })).toBeChecked();
  });

  it("copy flow calls POST /api/admin/roles/:roleId/copy dryRun first then dryRun:false", async () => {
    const fetchMock = stubCatalogApis(async (input, init) => {
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
    const idInput = (await screen.findByLabelText(/^角色标识/)) as HTMLInputElement;
    fireEvent.change(idInput, { target: { value: "wiki_clone" } });
    fireEvent.change(screen.getByLabelText(/^说明/), { target: { value: "Copied and edited" } });
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
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "wildcard_role" } });
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    const toolInput = within(await screen.findByTestId("role-tools-field")).getByLabelText("添加标签");
    fireEvent.change(toolInput, { target: { value: "*" } });
    fireEvent.keyDown(toolInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /预览保存/ }));
    expect(screen.queryByTestId("role-diff")).not.toBeInTheDocument();
  });

  it("effective permissions tab renders tools and sources", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));
    expect(screen.getByText("lucy_query")).toBeInTheDocument();
    expect(screen.getByText(/dataforai/)).toBeInTheDocument();
  });

  it("Data Capability Preview shows scoped digest, not hardcoded TRUE", async () => {
    stubSingleRole(
      makeYamlRole({
        effectivePermissions: {
          roleIds: ["analyst"],
          snapshotHash: "abc",
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
              rowGrant: {
                kind: "scoped",
                digest: "883501db707ba111",
                predicates: [{ field: "region", op: "eq", value: "East" }]
              }
            }
          ]
        }
      })
    );
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));
    const preview = await screen.findByTestId("capability-preview");
    expect(preview).toHaveTextContent("rowGrant=scoped:883501db707ba111 · region=East");
    expect(preview.textContent ?? "").not.toMatch(/rowGrant=TRUE/);
    expect(preview.textContent ?? "").not.toMatch(/行级已生效/);
  });

  it("loads scoped selectors into 行级策略 editor and round-trips on dryRun", async () => {
    const scopedRole = makeYamlRole({
      id: "scoped_east",
      role: {
        description: "Scoped east",
        allow: {
          connections: ["mysql-aliyun"],
          tools: ["lucy_query"],
          tableSelectors: [
            {
              connection: "mysql-aliyun",
              schema: "dataforai",
              names: ["superstore_orders"],
              row_access: "scoped",
              row_policy: {
                predicates: [{ field: "region", op: "eq", value: "East" }]
              }
            }
          ]
        }
      }
    });
    const fetchMock = stubCatalogApis(async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/roles/scoped_east" && !init) {
        return new Response(JSON.stringify({ ok: true, data: scopedRole }));
      }
      if (url === "/api/admin/roles/scoped_east" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: { diff: "+ row_access: scoped", proposedYaml: "yaml", version: "v-scoped" }
            })
          );
        }
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
        status: 404
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/scoped_east");
    fireEvent.click(await screen.findByRole("button", { name: "权限配置" }));
    const range = await screen.findByTestId("role-table-range-1");
    expect(within(range).getByRole("radio", { name: /限定行/ })).toBeChecked();
    expect(within(range).getByDisplayValue("region")).toBeInTheDocument();
    expect(within(range).getByDisplayValue("East")).toBeInTheDocument();

    fireEvent.change(within(range).getByLabelText(/表范围 1 条件 1 取值/), {
      target: { value: "West" }
    });
    fireEvent.click(screen.getByRole("button", { name: /预览并保存/ }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(dryRunCall).toBeTruthy();
      const body = JSON.parse(String((dryRunCall![1] as RequestInit).body));
      const selector = body.patch.allow.tableSelectors[0];
      expect(selector.row_access).toBe("scoped");
      expect(selector.row_policy.predicates).toEqual([{ field: "region", op: "eq", value: "West" }]);
    });
  });

  it("create flow can write scoped + row_policy via 行级策略 editor", async () => {
    const fetchMock = stubCatalogApis(async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/roles" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                diff: "+ row_access: scoped",
                proposedYaml: "roles:\n  scoped_new: {}\n"
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { written: true, role: makeYamlRole({ id: "scoped_new" }) }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
        status: 404
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "scoped_new" } });
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /lucy_query/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /mysql-aliyun/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ 添加表范围" }));
    const range = await screen.findByTestId("role-table-range-1");
    fireEvent.change(within(range).getByLabelText(/表范围 1 连接/), { target: { value: "mysql-aliyun" } });
    fireEvent.change(within(range).getByLabelText(/表范围 1 Schema/), { target: { value: "dataforai" } });
    fireEvent.click(await within(range).findByRole("checkbox", { name: /superstore_orders/ }));
    fireEvent.click(within(range).getByRole("radio", { name: /限定行/ }));
    fireEvent.change(within(range).getByLabelText(/表范围 1 条件 1 字段/), {
      target: { value: "region" }
    });
    fireEvent.change(within(range).getByLabelText(/表范围 1 条件 1 取值/), {
      target: { value: "East" }
    });
    fireEvent.click(screen.getByRole("button", { name: /预览保存/ }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "POST" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(dryRunCall).toBeTruthy();
      const body = JSON.parse(String((dryRunCall![1] as RequestInit).body));
      const selector = body.role.allow.tableSelectors[0];
      expect(selector.row_access).toBe("scoped");
      expect(selector.row_policy.predicates).toEqual([{ field: "region", op: "eq", value: "East" }]);
      expect(selector.names).toContain("superstore_orders");
    });
  });

  it("M55: 生效边界 explains that allowed MCP tools filter tools/list and intercept tools/call", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));
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
    const fetchMock = stubCatalogApis(async (input, init) => {
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
    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    const desc2 = screen.getByDisplayValue("v1") as HTMLInputElement;
    fireEvent.change(desc2, { target: { value: "v2" } });
    fireEvent.click(screen.getByRole("button", { name: "变更预览" }));
    expect(screen.queryByTestId("role-diff")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    fireEvent.click(screen.getByRole("button", { name: /预览并保存/ }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("delete flow sends dryRun false in the DELETE body on confirm", async () => {
    const fetchMock = stubCatalogApis(async (input, init) => {
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
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));
    expect(await screen.findByText("待修复")).toBeInTheDocument();
    expect(screen.getByText(/权限解析失败/)).toBeInTheDocument();
    const technical = screen.getByTestId("role-detail-warning-tech-0");
    expect(technical).toHaveTextContent("role_resolution_failed:broken");
    expect(technical.getAttribute("translate")).toBe("no");
    expect(technical.className).toContain("notranslate");
    expect(screen.queryByText(/该 role 当前无法解析：role_resolution_failed/)).not.toBeInTheDocument();
  });
});
