// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublishWorkbench,
  boundaryChecklistForChangedFiles,
  classifyChangedSemanticFile,
  fileChangeStatusLabel,
  impactedTableNames
} from "../pages/publish/PublishWorkbench";

function renderWorkbench() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublishWorkbench />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PublishWorkbench helpers", () => {
  it("maps changed files to boundary checklist prompts", () => {
    expect(
      boundaryChecklistForChangedFiles([
        "webui/src/pages/connections/ConnectionOverview.tsx",
        "webui/server/catalog-assets.ts",
        "webui/src/pages/TableEditor.tsx",
        "webui/server/semantic-assets.ts"
      ])
    ).toEqual([
      "检查数据接入是否只处理 Connection / Schema / Manifest / Catalog / 启用表范围 / 连通测试。",
      "检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。",
      "检查语义建模是否只处理业务语义和 overlay。",
      "检查资产包分类、secret hard block 和 Validate Gate。"
    ]);
  });

  it("classifies schema manifests separately from table overlays", () => {
    expect(classifyChangedSemanticFile("semantic-layer/demo-mysql/_schema/dataforai.yaml")).toEqual({
      kind: "schema-manifest",
      conn: "demo-mysql",
      schema: "dataforai",
      filePath: "semantic-layer/demo-mysql/_schema/dataforai.yaml"
    });
    expect(impactedTableNames([
      "semantic-layer/demo-mysql/_schema/dataforai.yaml",
      "semantic-layer/demo-mysql/superstore_orders.yaml"
    ])).toEqual(["superstore_orders"]);
  });

  it("maps internal file status codes to business labels", () => {
    expect(fileChangeStatusLabel("W")).toBe("已修改");
    expect(fileChangeStatusLabel("modified")).toBe("已修改");
    expect(fileChangeStatusLabel("A")).toBe("新增");
  });
});

describe("PublishWorkbench", () => {
  it("renders empty-state header actions without 表目录", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
          status: 404
        });
      })
    );

    renderWorkbench();

    expect(
      screen.getByRole("heading", { name: "发布工作台" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("审阅待生效语义资产，校验通过后一键发布并重建索引。")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传语义资产" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "强制重建索引" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出当前快照 (.zip)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "校验变更" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表目录" })).not.toBeInTheDocument();
    expect(screen.queryByText("变更审阅与校验")).not.toBeInTheDocument();
    expect(screen.getByText("发布门禁")).toBeInTheDocument();
  });

  it("switches changed files and auto-validates pending files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  { filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml", status: "modified", diff: "+ orders diff" },
                  { filePath: "semantic-layer/mysql-aliyun/customers.yaml", status: "added", diff: "+ customers diff" }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  { conn: "mysql-aliyun", schema: "dataforai", table: "superstore_orders", validation: { ok: true, exitCode: 0, stdout: "", stderr: "" } },
                  { conn: "mysql-aliyun", schema: "dataforai", table: "customers", validation: { ok: false, exitCode: 1, stdout: "", stderr: "bad" } }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    expect(await screen.findByText(/\+ orders diff/)).toBeInTheDocument();
    expect(screen.getByText("变更详情")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-file-status")).toHaveTextContent("已修改");
    fireEvent.click(screen.getByRole("button", { name: /customers.yaml/ }));
    expect(screen.getByText(/\+ customers diff/)).toBeInTheDocument();
    expect(await screen.findByText("1 张表未通过")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("未通过")).toBeInTheDocument());
    expect(screen.queryByText("FAIL")).not.toBeInTheDocument();
  });

  it("shows validation issues in the workbench summary when validate fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "semantic-layer/demo-mysql/ai_intl_ad_daily.yaml",
                    status: "modified",
                    diff: "+ overlay"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  {
                    conn: "demo-mysql",
                    schema: "chatbi",
                    table: "ai_intl_ad_daily",
                    validation: {
                      ok: false,
                      exitCode: 1,
                      stdout: "",
                      stderr:
                        "Project: /data/lucy\nsemantic-layer/demo-mysql/_schema/._dataforai.yaml: Semantic-layer source YAML must contain an object\n",
                      issues: [
                        { message: "Project: /data/lucy" },
                        {
                          message:
                            "semantic-layer/demo-mysql/_schema/._dataforai.yaml: Semantic-layer source YAML must contain an object"
                        }
                      ]
                    }
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
          status: 404
        });
      })
    );

    renderWorkbench();

    expect(await screen.findByTestId("workbench-validation-issues")).toHaveTextContent(
      "._dataforai.yaml: Semantic-layer source YAML must contain an object"
    );
    expect(screen.queryByText("Project: /data/lucy")).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-validation-tech-details")).toBeInTheDocument();
  });

  it("keeps the force-reindex action visible and labeled 强制重建索引 even when there are no changed files", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: { files: [] }
            })
          );
        }
        if (url === "/api/semantic-assets/reindex" && init?.method === "POST") {
          calls.push(url);
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                force: false,
                startedAt: "2026-07-31T00:00:00.000Z",
                finishedAt: "2026-07-31T00:00:01.000Z",
                reindex: { ok: true, exitCode: 0, stdout: "indexed", stderr: "" }
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    expect(await screen.findByTestId("workbench-empty-state")).toBeInTheDocument();
    const reindexButton = screen.getByTestId("workbench-reindex");
    expect(reindexButton).toHaveTextContent("强制重建索引");
    expect(screen.getByTestId("workbench-upload-semantic-asset")).toHaveTextContent(
      "上传语义资产"
    );

    fireEvent.click(reindexButton);

    expect(await screen.findByTestId("workbench-reindex-result")).toHaveTextContent(
      "reindex 完成，退出码 0"
    );
    expect(calls).toEqual(["/api/semantic-assets/reindex"]);
  });

  it("opens the semantic asset publish drawer from advanced upload when pending files exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                    status: "modified",
                    diff: "+ orders diff"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  {
                    conn: "mysql-aliyun",
                    schema: "dataforai",
                    table: "superstore_orders",
                    validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    expect(await screen.findByText(/\+ orders diff/)).toBeInTheDocument();
    const advanced = screen.getByTestId("publish-advanced-actions");
    fireEvent.click(within(advanced).getByText("高级"));
    const uploadButton = await within(advanced).findByTestId("workbench-upload-semantic-asset");
    fireEvent.click(uploadButton);
    expect(await screen.findByTestId("semantic-asset-publish-drawer")).toBeInTheDocument();
  });

  it("keeps the publish-and-reindex CTA disabled when validate-changed returns no rows for pending files", async () => {
    let validateCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "wiki/customer-success.md",
                    status: "modified",
                    diff: "+ wiki diff"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          validateCalls += 1;
          return new Response(
            JSON.stringify({ ok: true, data: { results: [] } })
          );
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );

    renderWorkbench();

    const publishCta = await screen.findByTestId("workbench-publish-and-reindex");
    await waitFor(() => expect(validateCalls).toBeGreaterThan(0));
    await waitFor(() =>
      expect(publishCta).toHaveAttribute("data-gate", "pending")
    );
    expect(publishCta).toBeDisabled();
    expect(screen.getByTestId("publish-gate-next-step")).toHaveTextContent(/发布已阻断/);
    expect(screen.queryByText("建议命令")).not.toBeInTheDocument();
    expect(screen.queryByText("git diff")).not.toBeInTheDocument();
  });

  it("auto-validates and highlights publish CTA when validate gate passes", async () => {
    let validateCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                    status: "modified",
                    diff: "+ orders diff"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          validateCalls += 1;
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  {
                    conn: "mysql-aliyun",
                    schema: "dataforai",
                    table: "superstore_orders",
                    validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    const publishCta = await screen.findByTestId("workbench-publish-and-reindex");
    await waitFor(() => expect(validateCalls).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getByTestId("workbench-publish-and-reindex")).toHaveAttribute("data-gate", "ready")
    );
    expect(publishCta).not.toBeDisabled();
    expect(screen.getByTestId("publish-gate-next-step")).toHaveTextContent(/校验已通过/);
  });

  it("shows boundary checklist prompts for changed implementation files under advanced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "webui/src/pages/connections/ConnectionOverview.tsx",
                    status: "modified",
                    diff: "+ connection diff"
                  },
                  {
                    filePath: "webui/server/catalog-assets.ts",
                    status: "modified",
                    diff: "+ catalog asset diff"
                  },
                  {
                    filePath: "webui/src/pages/TableEditor.tsx",
                    status: "modified",
                    diff: "+ table editor diff"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { results: [] } }));
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    const checklist = await screen.findByTestId("review-boundary-checklist");
    expect(checklist).toHaveTextContent(
      "检查数据接入是否只处理 Connection / Schema / Manifest / Catalog / 启用表范围 / 连通测试。"
    );
    expect(checklist).toHaveTextContent("检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。");
    expect(checklist).toHaveTextContent("检查语义建模是否只处理业务语义和 overlay。");
  });

  it("renders schema manifest impact separately and does not treat it as a table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "semantic-layer/demo-mysql/_schema/dataforai.yaml",
                    status: "W",
                    diff: ""
                  },
                  {
                    filePath: "semantic-layer/demo-mysql/superstore_orders.yaml",
                    status: "W",
                    diff: "+ overlay"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  {
                    conn: "demo-mysql",
                    schema: "dataforai",
                    table: "superstore_orders",
                    validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                tables: [
                  {
                    conn: "demo-mysql",
                    schema: "dataforai",
                    table: "superstore_orders",
                    filePath: "semantic-layer/demo-mysql/_schema/dataforai.yaml",
                    columnCount: 1,
                    columnNames: [],
                    hasTableDesc: true,
                    hasGrain: true,
                    measureCount: 0,
                    joinCount: 0,
                    wikiRefCount: 0,
                    completion: "done",
                    mtime: "2026-07-30T00:00:00.000Z"
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    expect(await screen.findByTestId("publish-impact-schema-list")).toHaveTextContent(
      "demo-mysql/dataforai"
    );
    expect(screen.getByTestId("publish-impact-table-superstore_orders")).toBeInTheDocument();
    expect(screen.queryByTestId("publish-impact-table-dataforai")).not.toBeInTheDocument();
    expect(screen.queryByText("状态：W")).not.toBeInTheDocument();
  });

  it("renders real conn/schema in the change-impact drawer link when sources are loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  { filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml", status: "modified", diff: "+ diff" }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  {
                    conn: "mysql-aliyun",
                    schema: "dataforai",
                    table: "superstore_orders",
                    validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                tables: [
                  {
                    conn: "mysql-aliyun",
                    schema: "dataforai",
                    table: "superstore_orders",
                    filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
                    columnCount: 1,
                    columnNames: [],
                    hasTableDesc: true,
                    hasGrain: true,
                    measureCount: 0,
                    joinCount: 0,
                    wikiRefCount: 0,
                    completion: "done",
                    mtime: "2026-07-30T00:00:00.000Z"
                  }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    const link = await screen.findByTestId("publish-impact-table-superstore_orders");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute(
      "href",
      "/?object=table&conn=mysql-aliyun&schema=dataforai&table=superstore_orders"
    );
  });

  it("renders impacted table as plain text when sources lookup misses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  { filePath: "semantic-layer/mysql-aliyun/ghost_table.yaml", status: "modified", diff: "+ diff" }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { results: [] } }));
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    const label = await screen.findByTestId("publish-impact-table-ghost_table");
    expect(label.tagName).toBe("SPAN");
    expect(label).toHaveTextContent("ghost_table");
    expect(
      document.querySelector('a[href*="conn=_"][href*="schema=_"]')
    ).not.toBeInTheDocument();
  });

  it("uses pending-state header with validate and publish, without 表目录", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  {
                    filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                    status: "modified",
                    diff: "+ diff"
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { results: [] } }));
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    expect(await screen.findByTestId("workbench-validate")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-publish-and-reindex")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-export-snapshot")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表目录" })).not.toBeInTheDocument();
    expect(screen.getByTestId("publish-flow-steps")).toHaveTextContent("审阅变更");
  });
});
