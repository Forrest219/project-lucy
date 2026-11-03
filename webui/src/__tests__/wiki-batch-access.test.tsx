// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikiBatchAccessDrawer } from "../components/WikiBatchAccessDrawer";
import type { WikiBatchAccessDocument } from "../components/WikiBatchAccessDrawer";
import { WikiEditor } from "../pages/WikiEditor";
import type { WikiAccessListEntry, WikiAclState, WikiDirectorySummary } from "../lib/types";

const MOCK_ROLES = ["analyst", "finance_reader"];

function accessEntry(overrides: Partial<WikiAccessListEntry> = {}): WikiAccessListEntry {
  return {
    file_version: "sha256:fixture",
    acl: { state: "missing" },
    declared_role_count: 0,
    declared_without_discover: 0,
    declared_without_read: 0,
    ...overrides
  };
}

function pageEntry(key: string, acl: WikiAclState = { state: "missing" }) {
  return {
    key,
    summary: key.split("/").pop()?.replace(/\.md$/, "") ?? key,
    tags: [],
    slRefs: [],
    access: accessEntry({
      acl,
      declared_role_count: acl.state === "roles" ? acl.roles.length : acl.state === "all" ? null : 0
    })
  };
}

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/wiki" element={<WikiEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

function renderDrawer(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function listApi(
  pages: ReturnType<typeof pageEntry>[],
  directories: WikiDirectorySummary[] = []
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/wiki" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, data: { pages, directories } }));
    }
    if (url === "/api/admin/roles?includeTemplates=false") {
      return new Response(
        JSON.stringify({ ok: true, data: { roles: MOCK_ROLES.map((id) => ({ id })) } })
      );
    }
    if (url === "/api/sources") {
      return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
    }
    const pageMatch = url.match(/^\/api\/wiki\/(.+)$/);
    if (pageMatch && method === "GET") {
      const key = decodeURIComponent(pageMatch[1]);
      const page = pages.find((item) => item.key === key);
      if (!page) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }),
          { status: 404 }
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: page.key,
            frontmatter: { summary: page.summary },
            content: `# ${page.summary}`,
            rawMarkdown: `# ${page.summary}`,
            file_version: "sha256:fixture",
            acl: page.access.acl
          }
        })
      );
    }
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
      { status: 404 }
    );
  });
}

function batchApi(
  pages: ReturnType<typeof pageEntry>[],
  resultStatuses: Record<string, string> = {}
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/admin/roles?includeTemplates=false") {
      return new Response(
        JSON.stringify({ ok: true, data: { roles: MOCK_ROLES.map((id) => ({ id })) } })
      );
    }
    if (url === "/api/wiki/access/batch/preview" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      const action = body.action as { mode: string; role_ids?: string[]; allowed_roles?: string[] };
      const items = body.items.map((item: { key: string }) => {
        const page = pages.find((entry) => entry.key === item.key);
        const current = page?.access.acl ?? { state: "missing" };
        const next =
          action.mode === "add"
            ? {
                state: "roles" as const,
                roles: Array.from(
                  new Set([
                    ...(current.state === "roles" ? current.roles : []),
                    ...(action.role_ids ?? [])
                  ])
                )
              }
            : {
                state: (action.allowed_roles ?? []).includes("*")
                  ? ("all" as const)
                  : (action.allowed_roles ?? []).length === 0
                    ? ("empty" as const)
                    : ("roles" as const),
                ...((action.allowed_roles ?? []).includes("*") ||
                (action.allowed_roles ?? []).length === 0
                  ? {}
                  : { roles: action.allowed_roles ?? [] })
              };
        return {
          key: item.key,
          title: page?.summary,
          file_version: page?.access.file_version ?? "sha256:fixture",
          current_acl: current,
          next_acl: next,
          direction: "widen",
          noop: false,
          issues: []
        };
      });
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            operation_id: `op-${items.length}-${action.mode}`,
            plan_digest: `plan-${action.mode}`,
            action,
            role_channel_version: "rcv-1",
            items,
            summary: {
              total: items.length,
              widening: items.length,
              narrowing: 0,
              unchanged: 0,
              corrupt: 0,
              missing_channel: 0,
              affected_agent_count: items.length,
              blocking: 0
            },
            blocking: false
          }
        })
      );
    }
    if (url === "/api/wiki/access/batch/commit" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      const items = body.items.map((item: { key: string }) => {
        const status = resultStatuses[item.key] ?? "applied";
        return {
          key: item.key,
          title: item.key,
          status,
          file_version: "sha256:fixture",
          current_acl: { state: "missing" },
          next_acl: { state: "roles", roles: ["analyst"] },
          direction: "widen",
          error_code: status === "failed" ? "wiki_write_conflict" : undefined,
          error_message: status === "failed" ? "文档已被其他人更新" : undefined
        };
      });
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            operation_id: body.operation_id,
            plan_digest: body.plan_digest,
            action: body.action,
            role_channel_version: "rcv-1",
            status: "completed",
            items,
            summary: {
              total: items.length,
              widening: items.length,
              narrowing: 0,
              unchanged: 0,
              corrupt: 0,
              missing_channel: 0,
              affected_agent_count: items.length,
              blocking: 0
            },
            created_at: "2026-10-27T00:00:00.000Z",
            updated_at: "2026-10-27T00:00:00.000Z"
          }
        })
      );
    }
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
      { status: 404 }
    );
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Wiki list bulk selection (Spec 193 §7.1)", () => {
  it("enters and exits selection mode and keeps the full path visible", async () => {
    const pages = [pageEntry("global/a.md"), pageEntry("global/b.md")];
    vi.stubGlobal("fetch", listApi(pages));
    renderPage("/wiki?dir=global");

    fireEvent.click(await screen.findByTestId("wiki-library-batch-start"));
    expect(await screen.findByTestId("wiki-library-select-global/a.md")).toBeInTheDocument();
    // The full path stays visible in selection mode.
    expect(screen.getAllByTestId("wiki-library-document-path")[0]).toHaveTextContent(
      "wiki/global/a.md"
    );

    fireEvent.click(screen.getByTestId("wiki-library-batch-exit"));
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-library-select-global/a.md")).not.toBeInTheDocument();
    });
  });

  it("disables 继续 with zero selection and explains the reason via aria-describedby", async () => {
    const pages = [pageEntry("global/a.md")];
    vi.stubGlobal("fetch", listApi(pages));
    renderPage("/wiki?dir=global");

    fireEvent.click(await screen.findByTestId("wiki-library-batch-start"));
    const cont = await screen.findByTestId("wiki-library-batch-continue");
    expect(cont).toBeDisabled();
    const reason = screen.getByTestId("wiki-library-continue-reason");
    expect(reason).toHaveTextContent("请先选择至少一篇文档。");
    expect(cont).toHaveAttribute("aria-describedby", reason.id);
  });

  it("selects the current filtered result and keeps the selection scoped to documents", async () => {
    const pages = [pageEntry("global/a.md"), pageEntry("global/b.md"), pageEntry("ops/c.md")];
    vi.stubGlobal("fetch", listApi(pages));
    renderPage("/wiki?dir=global");

    fireEvent.click(await screen.findByTestId("wiki-library-batch-start"));
    fireEvent.click(await screen.findByTestId("wiki-library-select-filtered"));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-library-selection-count")).toHaveTextContent("已选 2 篇");
    });
    expect(screen.queryByTestId("wiki-library-select-ops/c.md")).not.toBeInTheDocument();
  });

  it("refuses the 101st document and leaves the selection unchanged", async () => {
    // 100 documents match the 无人可见 filter, one does not. The filtered
    // result fits the limit; the 101st document must still be refused.
    const pages = [
      ...Array.from({ length: 100 }, (_, index) =>
        pageEntry(`global/doc-${String(index).padStart(3, "0")}.md`)
      ),
      pageEntry("global/extra.md", { state: "all" })
    ];
    vi.stubGlobal("fetch", listApi(pages));
    renderPage("/wiki?dir=global");

    fireEvent.click(await screen.findByTestId("wiki-library-batch-start"));
    fireEvent.click(await screen.findByTestId("wiki-library-access-filter-none"));
    fireEvent.click(await screen.findByTestId("wiki-library-select-filtered"));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-library-selection-count")).toHaveTextContent("已选 100 篇");
    });

    // Show every document again and try to add the 101st one.
    fireEvent.click(screen.getByTestId("wiki-library-access-filter-all"));
    fireEvent.click(await screen.findByTestId("wiki-library-select-global/extra.md"));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-library-selection-notice")).toHaveTextContent(
        "一次最多选择 100 篇文档"
      );
    });
    expect(screen.getByTestId("wiki-library-selection-count")).toHaveTextContent("已选 100 篇");
  });

  it("refuses 选择当前筛选结果 when the filtered result would exceed 100 documents", async () => {
    const pages = Array.from({ length: 101 }, (_, index) =>
      pageEntry(`global/doc-${String(index).padStart(3, "0")}.md`)
    );
    vi.stubGlobal("fetch", listApi(pages));
    renderPage("/wiki?dir=global");

    fireEvent.click(await screen.findByTestId("wiki-library-batch-start"));
    fireEvent.click(await screen.findByTestId("wiki-library-select-filtered"));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-library-selection-notice")).toHaveTextContent(
        "超过 100 篇上限"
      );
    });
    expect(screen.getByTestId("wiki-library-selection-count")).toHaveTextContent("已选 0 篇");
  });

  it("clears the selection when the directory changes", async () => {
    const pages = [pageEntry("global/a.md"), pageEntry("ops/b.md")];
    vi.stubGlobal("fetch", listApi(pages));
    renderPage("/wiki?dir=global");

    fireEvent.click(await screen.findByTestId("wiki-library-batch-start"));
    fireEvent.click(await screen.findByTestId("wiki-library-select-global/a.md"));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-library-selection-count")).toHaveTextContent("已选 1 篇");
    });

    // Switching the directory must not keep a hidden selection.
    const tree = await screen.findByTestId("wiki-tree");
    const opsToggle = within(tree)
      .getAllByTestId("wiki-tree-group-toggle")
      .find((node) => node.textContent?.includes("ops"));
    expect(opsToggle).toBeTruthy();
    fireEvent.click(opsToggle!);

    await waitFor(() => {
      expect(screen.getByTestId("wiki-library-selection-notice")).toHaveTextContent(
        "切换目录已清空批量选择"
      );
    });
  });
});

describe("WikiBatchAccessDrawer (Spec 193 §7.2 – §7.4)", () => {
  const documents: WikiBatchAccessDocument[] = [
    {
      key: "global/a.md",
      title: "A",
      file_version: "sha256:a",
      acl: { state: "missing" }
    },
    {
      key: "global/b.md",
      title: "B",
      file_version: "sha256:b",
      acl: { state: "roles", roles: ["analyst"] }
    }
  ];

  it("offers exactly the two supported operations", async () => {
    vi.stubGlobal("fetch", batchApi([pageEntry("global/a.md"), pageEntry("global/b.md")]));
    renderDrawer(
      <WikiBatchAccessDrawer documents={documents} onClose={() => undefined} open />
    );

    const drawer = await screen.findByTestId("wiki-batch-drawer");
    expect(within(drawer).getByLabelText("添加角色")).toBeInTheDocument();
    expect(within(drawer).getByLabelText("替换可访问角色")).toBeInTheDocument();
    expect(within(drawer).queryByLabelText("移除角色")).not.toBeInTheDocument();
  });

  it("previews the per-document difference plus a summary before submitting", async () => {
    const fetchMock = batchApi([pageEntry("global/a.md"), pageEntry("global/b.md")]);
    vi.stubGlobal("fetch", fetchMock);
    renderDrawer(
      <WikiBatchAccessDrawer documents={documents} onClose={() => undefined} open />
    );

    const drawer = await screen.findByTestId("wiki-batch-drawer");
    fireEvent.click(await within(drawer).findByLabelText("analyst"));
    fireEvent.click(within(drawer).getByTestId("wiki-batch-preview"));

    const table = await within(drawer).findByTestId("wiki-batch-plan-table");
    expect(table).toHaveTextContent("global/a.md");
    expect(table).toHaveTextContent("global/b.md");
    expect(within(drawer).getByTestId("wiki-batch-plan-summary")).toHaveTextContent("将扩权");

    const preview = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/wiki/access/batch/preview"
    );
    expect(preview).toBeTruthy();
    const body = JSON.parse(String(preview?.[1]?.body));
    expect(body.action).toEqual({ mode: "add", role_ids: ["analyst"] });
    expect(body.items).toEqual([
      { key: "global/a.md", expected_version: "sha256:a" },
      { key: "global/b.md", expected_version: "sha256:b" }
    ]);
  });

  it("requires the independent all-roles confirmation for 替换可访问角色", async () => {
    vi.stubGlobal("fetch", batchApi([pageEntry("global/a.md"), pageEntry("global/b.md")]));
    renderDrawer(
      <WikiBatchAccessDrawer documents={documents} onClose={() => undefined} open />
    );

    const drawer = await screen.findByTestId("wiki-batch-drawer");
    fireEvent.click(within(drawer).getByLabelText("替换可访问角色"));
    fireEvent.click(within(drawer).getByLabelText("所有角色可见"));
    fireEvent.click(within(drawer).getByTestId("wiki-batch-preview"));

    await within(drawer).findByTestId("wiki-batch-plan-table");
    expect(within(drawer).getByTestId("wiki-batch-all-confirm")).toBeInTheDocument();
    expect(within(drawer).getByTestId("wiki-batch-submit")).toBeDisabled();

    fireEvent.click(
      within(drawer).getByRole("checkbox", { name: /我确认把这批文档设为所有角色可见/ })
    );
    await waitFor(() => {
      expect(within(drawer).getByTestId("wiki-batch-submit")).not.toBeDisabled();
    });
  });

  it("requires the independent empty confirmation for 替换可访问角色", async () => {
    vi.stubGlobal("fetch", batchApi([pageEntry("global/a.md"), pageEntry("global/b.md")]));
    renderDrawer(
      <WikiBatchAccessDrawer documents={documents} onClose={() => undefined} open />
    );

    const drawer = await screen.findByTestId("wiki-batch-drawer");
    fireEvent.click(within(drawer).getByLabelText("替换可访问角色"));
    fireEvent.click(within(drawer).getByLabelText("无人可见"));
    fireEvent.click(within(drawer).getByTestId("wiki-batch-preview"));

    await within(drawer).findByTestId("wiki-batch-plan-table");
    expect(within(drawer).getByTestId("wiki-batch-empty-confirm")).toBeInTheDocument();
    expect(within(drawer).getByTestId("wiki-batch-submit")).toBeDisabled();
  });

  it("replaces the form with the result view and keeps a partial result visible", async () => {
    vi.stubGlobal(
      "fetch",
      batchApi([pageEntry("global/a.md"), pageEntry("global/b.md")], {
        "global/a.md": "applied",
        "global/b.md": "conflict"
      })
    );
    renderDrawer(
      <WikiBatchAccessDrawer documents={documents} onClose={() => undefined} open />
    );

    const drawer = await screen.findByTestId("wiki-batch-drawer");
    fireEvent.click(await within(drawer).findByLabelText("analyst"));
    fireEvent.click(within(drawer).getByTestId("wiki-batch-preview"));
    await within(drawer).findByTestId("wiki-batch-plan-table");
    fireEvent.click(within(drawer).getByTestId("wiki-batch-submit"));

    const result = await within(drawer).findByTestId("wiki-batch-result");
    expect(result).toHaveTextContent("共 2 篇文档");
    expect(result).toHaveTextContent("批量授权不是跨文件事务");
    expect(within(drawer).queryByTestId("wiki-batch-submit")).not.toBeInTheDocument();
  });

  it("retries only the unfinished items and never retries needs_review", async () => {
    const fetchMock = batchApi(
      [pageEntry("global/a.md"), pageEntry("global/b.md"), pageEntry("global/c.md")],
      {
        "global/a.md": "applied",
        "global/b.md": "conflict",
        "global/c.md": "needs_review"
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const threeDocuments: WikiBatchAccessDocument[] = [
      { key: "global/a.md", title: "A", file_version: "sha256:a", acl: { state: "missing" } },
      { key: "global/b.md", title: "B", file_version: "sha256:b", acl: { state: "missing" } },
      { key: "global/c.md", title: "C", file_version: "sha256:c", acl: { state: "missing" } }
    ];
    renderDrawer(
      <WikiBatchAccessDrawer documents={threeDocuments} onClose={() => undefined} open />
    );

    const drawer = await screen.findByTestId("wiki-batch-drawer");
    fireEvent.click(await within(drawer).findByLabelText("analyst"));
    fireEvent.click(within(drawer).getByTestId("wiki-batch-preview"));
    await within(drawer).findByTestId("wiki-batch-plan-table");
    fireEvent.click(within(drawer).getByTestId("wiki-batch-submit"));

    const result = await within(drawer).findByTestId("wiki-batch-result");
    expect(result).toHaveTextContent("待核对");
    expect(result).toHaveTextContent("需运维核对，不可重试");
    expect(within(drawer).getByTestId("wiki-batch-result-needs-review")).toHaveTextContent(
      "不进入重试范围"
    );

    fetchMock.mockClear();
    fireEvent.click(within(drawer).getByTestId("wiki-batch-result-retry"));
    await waitFor(() => {
      const preview = fetchMock.mock.calls.find(
        (call) => call[0] === "/api/wiki/access/batch/preview"
      );
      expect(preview).toBeTruthy();
      const body = JSON.parse(String(preview?.[1]?.body));
      // Only conflict / failed / not_run take part in the retry.
      expect(body.items.map((item: { key: string }) => item.key)).toEqual(["global/b.md"]);
    });
  });

  it("restores a previous run by operation id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/roles?includeTemplates=false") {
        return new Response(
          JSON.stringify({ ok: true, data: { roles: MOCK_ROLES.map((id) => ({ id })) } })
        );
      }
      if (url === "/api/wiki/access/batches/op-restored") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              operation_id: "op-restored",
              plan_digest: "plan-1",
              action: { mode: "add", role_ids: ["analyst"] },
              role_channel_version: "rcv-1",
              status: "completed",
              items: [
                {
                  key: "global/a.md",
                  status: "applied",
                  file_version: "sha256:a",
                  direction: "widen"
                }
              ],
              summary: {
                total: 1,
                widening: 1,
                narrowing: 0,
                unchanged: 0,
                corrupt: 0,
                missing_channel: 0,
                affected_agent_count: 1,
                blocking: 0
              },
              created_at: "2026-10-27T00:00:00.000Z",
              updated_at: "2026-10-27T00:00:00.000Z"
            }
          })
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
        { status: 404 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDrawer(
      <WikiBatchAccessDrawer
        documents={documents}
        initialOperationId="op-restored"
        onClose={() => undefined}
        open
      />
    );

    const result = await screen.findByTestId("wiki-batch-result");
    expect(result).toHaveTextContent("共 1 篇文档");
    expect(result).toHaveTextContent("global/a.md");
  });
});
