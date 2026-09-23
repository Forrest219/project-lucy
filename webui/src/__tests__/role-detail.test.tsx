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

function stubCatalogApis(
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  overrides?: {
    tools?: Array<{ name: string; description?: string; globalDenied?: boolean }>;
    tables?: string[];
  }
) {
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
            tools: overrides?.tools ?? [
              { name: "sl_query", description: "sl query (system deny)", globalDenied: true },
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
          data: {
            tables: overrides?.tables ?? ["dataforai.superstore_orders", "dataforai.superstore_returns"]
          }
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
    // New UI: RoleTableGrants + RoleToolGrants replace old connection/tools/range sections
    expect(screen.getByTestId("role-tools-field")).toBeInTheDocument();
    expect(screen.getByTestId("role-table-grants")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /预览保存/ })).toBeInTheDocument();
    // lucy_query appears as a checkbox in RoleToolGrants
    expect(await screen.findByRole("checkbox", { name: /lucy_query/ })).toBeInTheDocument();
    // sl_query and sql_execution are globalDenied and must NOT appear as checkboxes
    expect(screen.queryByRole("checkbox", { name: /sl_query/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /sql_execution/ })).not.toBeInTheDocument();
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
    // Select a table in the tree to set connections via RoleTableGrants
    fireEvent.click(await screen.findByRole("checkbox", { name: "superstore_orders" }));

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
    // Connections fallback appears when connections API fails
    expect(await screen.findByTestId("role-connections-fallback-hint")).toBeInTheDocument();
    // Tools fallback appears and TagInput is shown for manual entry
    expect(screen.getByTestId("role-tools-fallback-hint")).toBeInTheDocument();
    // TagInput fallback is only rendered when tools API fails (toolsFallback=true)
    const toolInput = within(screen.getByTestId("role-tools-field")).getByLabelText("添加标签");
    fireEvent.change(toolInput, { target: { value: "lucy_query" } });
    fireEvent.keyDown(toolInput, { key: "Enter" });
    expect(within(screen.getByTestId("role-tools-field")).getByText("lucy_query")).toBeInTheDocument();
  });

  it("table range uses connection schemas and supports 指定表名 / 按前缀匹配", async () => {
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    // New UI: RoleTableGrants shows tree with connections and tables
    const tableGrants = await screen.findByTestId("role-table-grants");
    // Tables load from API: superstore_orders available
    expect(await within(tableGrants).findByRole("checkbox", { name: "superstore_orders" })).toBeInTheDocument();
    // Advanced section has prefix mode toggle
    fireEvent.click(within(tableGrants).getByText("高级"));
    fireEvent.click(within(tableGrants).getByRole("checkbox", { name: "按前缀匹配" }));
    // Expansion notice appears outside advanced section
    expect(screen.getByTestId("table-grants-expansion-notice")).toBeInTheDocument();
    expect(screen.getByTestId("table-grants-expansion-notice").textContent).toContain("此后同前缀的新表自动进入");
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
      if (url === "/api/admin/roles/wiki_only" && (!init?.method || init.method === "GET")) {
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
    // All APIs fail → tools fallback TagInput is shown
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "DOWN", message: "down" } }), { status: 500 }))
    );
    renderAt("/admin/roles/new");
    fireEvent.change(await screen.findByLabelText(/^角色标识/), { target: { value: "wildcard_role" } });
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    // TagInput fallback appears when tools API fails (toolsFallback=true)
    const toolInput = within(await screen.findByTestId("role-tools-field")).getByLabelText("添加标签");
    fireEvent.change(toolInput, { target: { value: "*" } });
    fireEvent.keyDown(toolInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /预览保存/ }));
    expect(screen.queryByTestId("role-diff")).not.toBeInTheDocument();
  });

  it("effective permissions tab renders digest with RoleEffectiveDigest", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));
    // RoleEffectiveDigest shows the natural-language digest
    const digestText = await screen.findByTestId("role-effective-digest-text");
    expect(digestText.textContent).toContain("生效 1 个 MCP 工具");
    expect(digestText.textContent).toContain("mysql-aliyun");
    // System boundary sentence is always present
    expect(digestText.textContent).toContain("系统禁止能力");
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
    // RoleEffectiveDigest renders capabilities inside a <details> with testid "capability-preview-details"
    const capDetails = await screen.findByTestId("capability-preview-details");
    expect(capDetails).toHaveTextContent("rowGrant=scoped:883501db707ba111 · region=East");
    expect(capDetails.textContent ?? "").not.toMatch(/rowGrant=TRUE/);
    expect(capDetails.textContent ?? "").not.toMatch(/行级已生效/);
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
      if (url === "/api/admin/roles/scoped_east" && (!init?.method || init.method === "GET")) {
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
    // RoleTableGrants initializes with the scoped selector
    // The collapsed row policy label should show the predicate
    const collapsedLabel = await screen.findByTestId("row-policy-collapsed-label-superstore_orders");
    expect(collapsedLabel.textContent).toContain("region 等于 East");

    // Expand the row policy editor
    fireEvent.click(screen.getByRole("button", { name: "展开 superstore_orders 行策略" }));
    expect(screen.getByDisplayValue("East")).toBeInTheDocument();

    // Change value from East to West
    fireEvent.change(screen.getByLabelText("superstore_orders 条件 1 取值"), { target: { value: "West" } });

    // After the change, dirty bar should appear, click preview
    fireEvent.click(await screen.findByRole("button", { name: /预览并保存/ }));

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
    // Select table in tree
    fireEvent.click(await screen.findByRole("checkbox", { name: "superstore_orders" }));
    // Expand row policy editor and add a predicate
    fireEvent.click(screen.getByRole("button", { name: "展开 superstore_orders 行策略" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 添加条件" }));
    fireEvent.change(screen.getByLabelText("superstore_orders 条件 1 字段"), { target: { value: "region" } });
    fireEvent.change(screen.getByLabelText("superstore_orders 条件 1 取值"), { target: { value: "East" } });

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

  it("M55: 生效边界摘要包含工具数和系统边界句（RoleEffectiveDigest）", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));
    // RoleEffectiveDigest replaces the old tool badge list
    const digestText = await screen.findByTestId("role-effective-digest-text");
    // 摘要应包含生效工具数
    expect(digestText.textContent).toContain("生效 1 个 MCP 工具");
    // 系统边界句固定
    expect(digestText.textContent).toContain("系统禁止能力，不可授予");
    // 摘要不含「行级已生效」等不该有的断言
    expect(digestText.textContent).not.toContain("行级已生效");
    // 能力元组默认在 details 内（Data Capability Preview）
    expect(screen.getByTestId("capability-preview-details")).toBeInTheDocument();
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
      if (url === "/api/admin/roles/analyst" && (!init?.method || init.method === "GET")) {
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
      if (url === "/api/admin/roles/analyst" && (!init?.method || init.method === "GET")) {
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

  it("MCP tools picker (RoleToolGrants): globalDenied tools absent, grantable tools appear", async () => {
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    const toolsField = await screen.findByTestId("role-tools-field");
    // RoleToolGrants: grantable tools appear as checkboxes, globalDenied do NOT
    expect(await within(toolsField).findByRole("checkbox", { name: /lucy_query/ })).toBeInTheDocument();
    expect(within(toolsField).getByRole("checkbox", { name: /lucy_read_source/ })).toBeInTheDocument();
    expect(within(toolsField).getByRole("checkbox", { name: /wiki_search/ })).toBeInTheDocument();
    expect(within(toolsField).getByRole("checkbox", { name: /wiki_read/ })).toBeInTheDocument();
    // sl_query and sql_execution are globalDenied: no checkbox rendered
    expect(within(toolsField).queryByRole("checkbox", { name: /sl_query/ })).not.toBeInTheDocument();
    expect(within(toolsField).queryByRole("checkbox", { name: /sql_execution/ })).not.toBeInTheDocument();
    // Count shows "已选 N 个" (no denominator)
    expect(within(toolsField).getByText(/^已选 \d+ 个$/)).toBeInTheDocument();
    // Static system-denied sentence at bottom
    expect(within(toolsField).getByText(/原始 SQL.*系统禁止/s)).toBeInTheDocument();
  });

  it("MCP tools (RoleToolGrants): preset buttons work and count shows 已选 N 个", async () => {
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    const toolsField = await screen.findByTestId("role-tools-field");
    // Initially 0 tools selected
    expect(await within(toolsField).findByText("已选 0 个")).toBeInTheDocument();
    // Click "只读问答" preset
    fireEvent.click(within(toolsField).getByRole("button", { name: "只读问答" }));
    // After preset: "当前与只读问答一致" message appears
    expect(await within(toolsField).findByText(/当前与只读问答一致/)).toBeInTheDocument();
    // Count updates (only grantable tools counted, no denominator)
    expect(within(toolsField).getByText(/^已选 \d+ 个$/)).toBeInTheDocument();
    // Grantable tools like lucy_query are checked
    expect(within(toolsField).getByRole("checkbox", { name: /lucy_query/ })).toBeChecked();
  });

  // ── T6 新增测试 ────────────────────────────────────────────────────────────────

  it("T6: sl_query 在权限配置无 checkbox；预览 allow.tools 不含 sl_query；diff 含「系统拒绝」通知", async () => {
    // Role's existing allow already has sl_query (e.g. from older config)
    const roleWithSlQuery = makeYamlRole({
      id: "analyst",
      role: {
        description: "Analyst role",
        allow: { connections: ["mysql-aliyun"], tools: ["sl_query", "lucy_query"] }
      }
    });
    const fetchMock = stubCatalogApis(
      async (input, init) => {
        const url = String(input);
        if (url === "/api/admin/roles/analyst" && (!init?.method || init.method === "GET")) {
          return new Response(JSON.stringify({ ok: true, data: roleWithSlQuery }));
        }
        if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body));
          if (body.dryRun) {
            return new Response(JSON.stringify({ ok: true, data: { diff: "+ tools", proposedYaml: "yaml", version: "v1" } }));
          }
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      },
      {
        tools: [
          { name: "sl_query", description: "sl query", globalDenied: true },
          { name: "lucy_query", description: "query", globalDenied: false },
        ]
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "权限配置" }));

    // sl_query must NOT appear as a checkbox (globalDenied)
    expect(screen.queryByRole("checkbox", { name: /sl_query/ })).not.toBeInTheDocument();
    // lucy_query checkbox is present
    expect(await screen.findByRole("checkbox", { name: /lucy_query/ })).toBeInTheDocument();

    // Trigger preview (description change makes it dirty)
    fireEvent.click(screen.getByRole("button", { name: "基本信息" }));
    fireEvent.change(screen.getByDisplayValue("Analyst role"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: /预览并保存/ }));

    await waitFor(() => {
      const dryRunCall = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "PATCH" && JSON.parse(String(call[1].body)).dryRun === true
      );
      expect(dryRunCall).toBeTruthy();
      const body = JSON.parse(String((dryRunCall![1] as RequestInit).body));
      // sl_query must NOT be in the preview payload's allow.tools
      expect(body.patch.allow.tools).not.toContain("sl_query");
      expect(body.patch.allow.tools).toContain("lucy_query");
    });

    // Diff tab should show the rejected tools notice
    const rejectedDiv = await screen.findByTestId("role-diff-rejected-tools");
    expect(rejectedDiv.textContent).toContain("系统拒绝，保存后从授权中移除");
    expect(rejectedDiv.textContent).toContain("sl_query");
  });

  it("T6: 未生成预览时，diff tab 不显示确认保存按钮", async () => {
    stubSingleRole(makeYamlRole());
    renderAt("/admin/roles/analyst");
    await screen.findByRole("heading", { name: "analyst" });
    // Navigate to diff tab without previewing
    fireEvent.click(screen.getByRole("button", { name: "变更预览" }));
    // No save/confirm button (no preview generated)
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认创建" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认删除" })).not.toBeInTheDocument();
  });

  it("T7: 生效边界摘要的工具数 = effectivePermissions.tools.length，不是 form.tools 数量", async () => {
    // Role allow has sl_query + lucy_query (2 tools in form),
    // but effectivePermissions.tools only has lucy_query (1 effective tool)
    const role = makeYamlRole({
      role: {
        description: "Analyst role",
        allow: {
          connections: ["mysql-aliyun"],
          tools: ["sl_query", "lucy_query"],
          tableSelectors: [{ connection: "mysql-aliyun", schema: "dataforai", names: ["superstore_orders"] }]
        }
      },
      effectivePermissions: {
        roleIds: ["analyst"],
        snapshotHash: "abc",
        sourceMapVersion: "v1",
        tools: ["lucy_query"],  // only 1 effective tool
        connections: ["mysql-aliyun"],
        sources: [{ connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "dataforai", table: "dataforai.superstore_orders" }],
        legacyAllow: false
      }
    });
    stubSingleRole(role);
    renderAt("/admin/roles/analyst");
    fireEvent.click(await screen.findByRole("button", { name: "生效边界" }));

    const digestText = await screen.findByTestId("role-effective-digest-text");
    // Must show 1 (from effectivePermissions.tools.length), not 2 (from form.tools)
    expect(digestText.textContent).toContain("生效 1 个 MCP 工具");
    expect(digestText.textContent).not.toContain("生效 2 个 MCP 工具");
  });

  it("table names picker (RoleTableGrants): table tree shows and tables can be checked", async () => {
    vi.stubGlobal("fetch", stubCatalogApis());
    renderAt("/admin/roles/new");
    fireEvent.click(screen.getByRole("button", { name: "权限配置" }));
    const tableGrants = await screen.findByTestId("role-table-grants");
    // Both tables are available in the tree
    expect(await within(tableGrants).findByRole("checkbox", { name: "superstore_orders" })).toBeInTheDocument();
    expect(within(tableGrants).getByRole("checkbox", { name: "superstore_returns" })).toBeInTheDocument();
    // Check a table
    fireEvent.click(within(tableGrants).getByRole("checkbox", { name: "superstore_orders" }));
    expect(within(tableGrants).getByRole("checkbox", { name: "superstore_orders" })).toBeChecked();
    // Uncheck
    fireEvent.click(within(tableGrants).getByRole("checkbox", { name: "superstore_orders" }));
    expect(within(tableGrants).getByRole("checkbox", { name: "superstore_orders" })).not.toBeChecked();
  });
});
