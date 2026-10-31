// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublishWorkbench,
  boundaryChecklistForChangedFiles,
  classifyChangedSemanticFile,
  countDiffLines,
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

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }));
}

function notFound(url: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
    { status: 404 }
  );
}

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

  it("counts added and deleted diff lines accurately", () => {
    const diff = "--- a/file.yaml\n+++ b/file.yaml\n@@ -1,3 +1,4 @@\n-old line\n+new line 1\n+new line 2\n context";
    expect(countDiffLines(diff)).toEqual({ added: 2, deleted: 1 });
    expect(countDiffLines("")).toEqual({ added: 0, deleted: 0 });
    expect(countDiffLines(undefined)).toEqual({ added: 0, deleted: 0 });
  });
});

describe("PublishWorkbench", () => {
  it("renders empty-state activation actions without upload or export", async () => {
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
    expect(screen.queryByTestId("page-header-badges")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-header")).toHaveTextContent(
      "审阅并校验语义与 Wiki 变更，同步索引后使其对 Agent 生效。"
    );
    expect(screen.getByTestId("workbench-sync-index")).toHaveTextContent("同步索引");
    expect(screen.getByTestId("workbench-more-menu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传语义资产" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出当前快照/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "校验变更" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表目录" })).not.toBeInTheDocument();
    expect(screen.getByText("生效准备")).toBeInTheDocument();
    expect(screen.getByText("待发布变更")).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-mirror-only-semantic")).not.toBeInTheDocument();
  });

  it("keeps the secondary 同步索引 in the middle column of the empty state", async () => {
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

    expect(await screen.findByTestId("workbench-empty-state")).toHaveTextContent("暂无待同步变更");
    // The maintenance sync lives in 生效准备, NOT in the page header.
    const gate = screen.getByTestId("publish-gate-panel");
    expect(within(gate).getByTestId("workbench-sync-index")).toHaveTextContent("同步索引");
    const headerActions = screen.getByTestId("page-header-actions");
    expect(within(headerActions).queryByTestId("workbench-sync-index")).not.toBeInTheDocument();
    expect(within(headerActions).queryByTestId("workbench-publish-and-reindex")).not.toBeInTheDocument();
    expect(within(headerActions).queryByTestId("workbench-validate")).not.toBeInTheDocument();
  });

  it("warns when the ktx mirror still has semantic files missing from the content root", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [],
                mirrorOnlySemanticFiles: ["semantic-layer/mysql-aliyun/ai_intl_country_daily.yaml"],
                mirrorDriftTruncated: false
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
          status: 404
        });
      })
    );

    renderWorkbench();

    const notice = await screen.findByTestId("workbench-mirror-only-semantic");
    expect(notice).toHaveTextContent("镜像中仍有内容根已删除的语义文件，本次索引可能继续收录。");
    expect(notice).toHaveTextContent("semantic-layer/mysql-aliyun/ai_intl_country_daily.yaml");
    expect(notice.querySelector(".notranslate")).toHaveAttribute("translate", "no");
  });

  it("uses the three-column workbench layout and opens change detail only on file click", async () => {
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

    expect(await screen.findByTestId("workbench-pending-panel")).toBeInTheDocument();
    expect(screen.getByTestId("publish-gate-panel")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-recent-panel")).toBeInTheDocument();
    expect(screen.getByText("生效准备")).toBeInTheDocument();
    expect(screen.getByText("待发布变更")).toBeInTheDocument();
    expect(screen.getByText("最近发布")).toBeInTheDocument();
    // The pending file count lives in the LEFT column, not in the gate panel.
    await waitFor(() =>
      expect(screen.getByTestId("workbench-pending-count")).toHaveTextContent("2 个待同步文件")
    );
    // The "整批同步" disclosure moved into the LEFT column as well.
    expect(screen.getByTestId("workbench-batch-sync-hint")).toHaveTextContent(
      "本批一并同步 2 项"
    );
    expect(
      within(screen.getByTestId("workbench-pending-panel")).getByTestId(
        "workbench-batch-sync-hint"
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-change-detail-drawer")).not.toBeInTheDocument();
    expect(screen.queryByText(/\+ orders diff/)).not.toBeInTheDocument();
    expect(screen.queryByText("变更详情")).not.toBeInTheDocument();

    const ordersButton = await screen.findByRole("button", { name: /superstore_orders\.yaml/ });
    fireEvent.click(ordersButton);
    const drawer = await screen.findByTestId("workbench-change-detail-drawer");
    expect(within(drawer).getByText("变更详情")).toBeInTheDocument();
    expect(within(drawer).getByText(/\+ orders diff/)).toBeInTheDocument();
    expect(within(drawer).getByTestId("workbench-file-status")).toHaveTextContent("已修改");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("workbench-change-detail-drawer")).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /customers\.yaml/ }));
    expect(await within(screen.getByTestId("workbench-change-detail-drawer")).findByText(/\+ customers diff/)).toBeInTheDocument();
    expect(await screen.findByTestId("workbench-validation-banner")).toHaveTextContent(
      "表语义校验失败 1 张"
    );
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

  it("keeps full reindex in more menu with force true when empty", async () => {
    const bodies: unknown[] = [];
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
          bodies.push(JSON.parse(String(init.body ?? "{}")));
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                force: true,
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
    expect(screen.getByTestId("workbench-sync-index")).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-upload-semantic-asset")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("workbench-more-menu")).getByText("更多"));
    const reindexButton = screen.getByTestId("workbench-reindex");
    expect(reindexButton).toHaveTextContent("全量重建索引");
    fireEvent.click(reindexButton);

    expect(await screen.findByTestId("workbench-reindex-result")).toHaveTextContent(
      "reindex 完成，退出码 0"
    );
    expect(bodies).toEqual([{ force: true }]);
  });

  it("does not expose upload or export on the activation workbench", async () => {
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

    expect(await screen.findByTestId("publish-gate-panel")).toBeInTheDocument();
    expect(screen.queryByText(/\+ orders diff/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-advanced-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workbench-upload-semantic-asset")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workbench-export-snapshot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("semantic-asset-publish-drawer")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "同步索引并生效" })).toBeInTheDocument();
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
    expect(screen.getByTestId("publish-gate-next-step")).toHaveTextContent(/同步已阻断|同步已被阻断/);
    expect(screen.queryByText("建议命令")).not.toBeInTheDocument();
    expect(screen.queryByText("git diff")).not.toBeInTheDocument();
  });

  it("auto-validates and highlights publish CTA when validate gate passes", async () => {
    let validateCalls = 0;
    const reindexBodies: unknown[] = [];
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
                ],
                pendingDigest: "digest-auto",
                baselineState: "ready",
                baselineGeneration: 7,
                impact: {
                  pendingDigest: "digest-auto",
                  complete: true,
                  counts: { files: 1, tables: 1, manifests: 0, wikiPages: 0 },
                  tables: [
                    {
                      identity: {
                        connectionId: "mysql-aliyun",
                        schema: "dataforai",
                        table: "superstore_orders"
                      },
                      reasons: [
                        {
                          kind: "overlay_change",
                          summary: "指标定义变更",
                          source: "pending_disk_change",
                          filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                          evidenceRef: "ref-1"
                        }
                      ]
                    }
                  ],
                  wikiChanges: [],
                  schemaChanges: [],
                  relatedScope: [],
                  otherChanges: [],
                  unresolved: []
                }
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
                pendingDigest: "digest-auto",
                baselineState: "ready",
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
        if (url === "/api/semantic-assets/reindex" && init?.method === "POST") {
          reindexBodies.push(JSON.parse(String(init.body ?? "{}")));
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                force: false,
                startedAt: "2026-08-07T00:00:00.000Z",
                finishedAt: "2026-08-07T00:00:01.000Z",
                pendingDigest: "digest-auto",
                baselineState: "ready",
                baselineGeneration: 8,
                reindex: { ok: true, exitCode: 0, stdout: "indexed", stderr: "" }
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

    fireEvent.click(publishCta);
    const confirmDrawer = await screen.findByTestId("publish-sync-confirm-panel");
    expect(within(confirmDrawer).getByText("确认同步索引并生效")).toBeInTheDocument();
    expect(screen.queryByTestId("semantic-asset-publish-drawer")).not.toBeInTheDocument();
    expect(screen.queryByText(/选择文件|拖入此处|拖入 Schema/)).not.toBeInTheDocument();
    // The confirmation is bound to the content version and explains the range.
    expect(within(confirmDrawer).getByTestId("publish-sync-confirm-digest")).toHaveTextContent(
      "digest-auto"
    );
    expect(within(confirmDrawer).getByTestId("publish-impact-summary")).toHaveTextContent(
      "涉及表 1 张"
    );

    fireEvent.click(screen.getByTestId("publish-sync-confirm-submit"));
    await waitFor(() => expect(reindexBodies).toEqual([{ force: false, pendingDigest: "digest-auto" }]));
    await waitFor(() =>
      expect(screen.queryByTestId("publish-sync-confirm-panel")).not.toBeInTheDocument()
    );
  });

  it("shows boundary checklist prompts for changed implementation files under 索引与边界", async () => {
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

  it("uses pending-state header with validate and sync, without upload or export", async () => {
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
    expect(screen.getByRole("button", { name: "同步索引并生效" })).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-export-snapshot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workbench-upload-semantic-asset")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表目录" })).not.toBeInTheDocument();
    expect(screen.getByTestId("publish-flow-steps")).toHaveTextContent("审阅变更");
  });

  it("renders pipeline stepper with dynamic step indicators and line diff stats", async () => {
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
                    filePath: "semantic-layer/demo-mysql/superstore_orders.yaml",
                    status: "modified",
                    diff: "--- a/file\n+++ b/file\n+line 1\n+line 2\n-old line"
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

    const stepper = await screen.findByTestId("publish-flow-steps");
    expect(stepper).toHaveTextContent("审阅变更");
    expect(stepper).toHaveTextContent("校验");
    expect(stepper).toHaveTextContent("同步索引");

    // Line diff stats badge
    expect(await screen.findByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();

    // Calm UI all-pass banner
    expect(await screen.findByTestId("workbench-validation-banner")).toHaveTextContent(
      "表语义校验通过 1/1"
    );
  });

  it("SC-145-01 shows in-progress copy scoped to table semantics with elapsed seconds", async () => {
    vi.useFakeTimers();
    try {
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
                      filePath: "semantic-layer/demo-mysql/superstore_orders.yaml",
                      status: "modified",
                      diff: "+ diff"
                    }
                  ]
                }
              })
            );
          }
          if (url === "/api/validate-changed" && init?.method === "POST") {
            return new Promise<Response>(() => {});
          }
          if (url === "/api/sources") {
            return new Response(JSON.stringify({ ok: true, data: { tables: [] } }));
          }
          return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
        })
      );

      renderWorkbench();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const validateButton = screen.getByTestId("workbench-validate");
      expect(validateButton).toHaveTextContent("正在校验表语义…");
      expect(validateButton).toBeDisabled();
      expect(screen.getByTestId("workbench-publish-and-reindex")).toBeDisabled();
      expect(screen.getByTestId("workbench-validation-pending")).toHaveTextContent(
        "正在校验表语义…"
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByTestId("workbench-validation-pending")).toHaveTextContent("已等待 3 秒");
    } finally {
      vi.useRealTimers();
    }
  });

  it("SC-145-02/03 splits pending file count from table validation count and discloses rest files", async () => {
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
                    filePath: "semantic-layer/demo-mysql/superstore_orders.yaml",
                    status: "modified",
                    diff: "+ diff"
                  },
                  { filePath: "wiki/global/guide.md", status: "modified", diff: "+ wiki" },
                  { filePath: "webui/config/data-qa-instructions.md", status: "modified", diff: "+ cfg" }
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

    await waitFor(() =>
      expect(screen.getByTestId("workbench-pending-count")).toHaveTextContent("3 个待同步文件")
    );
    expect(screen.getByTestId("workbench-batch-sync-hint")).toHaveTextContent(
      "本批一并同步 3 项"
    );
    expect(screen.getByTestId("workbench-validation-banner")).toHaveTextContent(
      "表语义校验通过 1/1"
    );
    expect(screen.getByTestId("workbench-validation-rest-files")).toHaveTextContent(
      "其余 2 个文件随本批同步，不逐份做表语义校验。"
    );
    expect(screen.getByTestId("workbench-publish-and-reindex")).not.toBeDisabled();
  });

  it("SC-145-04 keeps sync blocked and shows failure count when a table fails", async () => {
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
                    filePath: "semantic-layer/demo-mysql/superstore_orders.yaml",
                    status: "modified",
                    diff: "+ diff"
                  },
                  { filePath: "wiki/global/guide.md", status: "modified", diff: "+ wiki" }
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
                    table: "superstore_orders",
                    validation: { ok: false, exitCode: 1, stdout: "", stderr: "bad" }
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

    expect(await screen.findByTestId("workbench-validation-banner")).toHaveTextContent(
      "表语义校验失败 1 张"
    );
    expect(screen.getByTestId("workbench-publish-and-reindex")).toBeDisabled();
    expect(screen.queryByTestId("workbench-validation-rest-files")).not.toBeInTheDocument();
  });

  it("SC-145-05 shows zero-table state without claiming a pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [{ filePath: "wiki/global/guide.md", status: "modified", diff: "+ wiki" }]
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

    expect(await screen.findByTestId("workbench-validation-banner")).toHaveTextContent("无可校验表");
    expect(screen.queryByText(/校验通过/)).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-publish-and-reindex")).toBeDisabled();
  });

  // ── three-column workbench (Spec §4) ─────────────────────────────────────

  it("renders the three columns in reading order 待发布变更 → 生效准备 → 最近发布", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/diff") return okJson({ files: [] });
        if (url.startsWith("/api/semantic-assets/releases")) {
          return okJson({ records: [], total: 0 });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    const layout = await screen.findByTestId("publish-workbench-layout");
    const pending = within(layout).getByTestId("workbench-pending-panel");
    const gate = within(layout).getByTestId("publish-gate-panel");
    const recent = within(layout).getByTestId("workbench-recent-panel");

    expect(pending).toHaveAttribute("aria-label", "待发布变更");
    expect(gate).toHaveAttribute("aria-label", "生效准备");
    expect(recent).toHaveAttribute("aria-label", "最近发布");

    // The DOM order is the reading order.
    expect(
      pending.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      gate.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps exactly one publish action on the page, inside the middle column", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return okJson({
            files: [
              {
                filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                status: "modified",
                diff: "+ diff"
              }
            ],
            pendingDigest: "digest-1",
            baselineState: "ready"
          });
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return okJson({
            pendingDigest: "digest-1",
            baselineState: "ready",
            results: [
              {
                conn: "mysql-aliyun",
                schema: "dataforai",
                table: "superstore_orders",
                validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
              }
            ]
          });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    await waitFor(() =>
      expect(screen.getByTestId("workbench-publish-and-reindex")).toHaveAttribute(
        "data-gate",
        "ready"
      )
    );

    // One publish action — in the middle column only.
    expect(screen.getAllByTestId("workbench-publish-and-reindex")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "同步索引并生效" })).toHaveLength(1);
    expect(
      within(screen.getByTestId("publish-gate-panel")).getByTestId(
        "workbench-publish-and-reindex"
      )
    ).toBeInTheDocument();

    // The page header carries only 刷新 / 更多 — never the validate or publish button.
    const headerActions = screen.getByTestId("page-header-actions");
    expect(
      within(headerActions).queryByTestId("workbench-publish-and-reindex")
    ).not.toBeInTheDocument();
    expect(within(headerActions).queryByTestId("workbench-validate")).not.toBeInTheDocument();
    expect(within(headerActions).getByTestId("workbench-refresh")).toBeInTheDocument();
    expect(within(headerActions).getByTestId("workbench-more-menu")).toBeInTheDocument();

    // A pending batch does not offer the maintenance sync as a second action.
    expect(screen.queryByTestId("workbench-sync-index")).not.toBeInTheDocument();
  });

  it("groups the pending list by asset type and shows the pending file count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return okJson({
            files: [
              {
                filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                status: "modified",
                diff: "+ overlay"
              },
              {
                filePath: "semantic-layer/demo-mysql/_schema/dataforai.yaml",
                status: "modified",
                diff: "+ manifest"
              },
              { filePath: "wiki/global/guide.md", status: "modified", diff: "+ wiki" }
            ],
            pendingDigest: "digest-1",
            baselineState: "ready"
          });
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return okJson({ pendingDigest: "digest-1", results: [] });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    await waitFor(() =>
      expect(screen.getByTestId("workbench-pending-count")).toHaveTextContent("3 个待同步文件")
    );
    expect(screen.getByTestId("workbench-pending-group-semantic")).toHaveTextContent(
      "语义资产 · 1"
    );
    expect(screen.getByTestId("workbench-pending-group-manifest")).toHaveTextContent(
      "Schema Manifest · 1"
    );
    expect(screen.getByTestId("workbench-pending-group-wiki")).toHaveTextContent("业务 Wiki · 1");
  });

  it("does not render the empty state and offers no publish action when the pending request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: "INTERNAL_ERROR", message: "读取待发布变更失败" }
            }),
            { status: 500 }
          );
        }
        return notFound(url);
      })
    );

    renderWorkbench();

    const error = await screen.findByTestId("workbench-pending-error");
    expect(error).toHaveTextContent("变更加载失败");
    expect(error).toHaveTextContent("读取待发布变更失败");
    // A failed pending request must NOT look like "there is nothing to publish".
    expect(screen.queryByTestId("workbench-empty-state")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无待同步变更")).not.toBeInTheDocument();
    // The publish action is not offered while the pending range is unknown.
    expect(screen.queryByTestId("workbench-publish-and-reindex")).not.toBeInTheDocument();
  });

  it("keeps the submission blocked when the pending request fails after a successful load", async () => {
    let diffCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          diffCalls += 1;
          if (diffCalls === 1) {
            return okJson({
              files: [
                {
                  filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                  status: "modified",
                  diff: "+ diff"
                }
              ],
              pendingDigest: "digest-1",
              baselineState: "ready"
            });
          }
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: "INTERNAL_ERROR", message: "读取待发布变更失败" }
            }),
            { status: 500 }
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return okJson({
            pendingDigest: "digest-1",
            baselineState: "ready",
            results: [
              {
                conn: "mysql-aliyun",
                schema: "dataforai",
                table: "superstore_orders",
                validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
              }
            ]
          });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    await waitFor(() =>
      expect(screen.getByTestId("workbench-publish-and-reindex")).toHaveAttribute(
        "data-gate",
        "ready"
      )
    );

    fireEvent.click(screen.getByTestId("workbench-refresh"));

    expect(await screen.findByTestId("workbench-pending-error")).toHaveTextContent(
      "变更加载失败"
    );
    expect(screen.queryByTestId("workbench-empty-state")).not.toBeInTheDocument();

    // The confirmation stays bound to the failed pending range: it cannot be submitted.
    fireEvent.click(screen.getByTestId("workbench-publish-and-reindex"));
    const drawer = await screen.findByTestId("publish-sync-confirm-panel");
    expect(within(drawer).getByTestId("publish-sync-confirm-submit")).toBeDisabled();
    expect(within(drawer).getByTestId("publish-sync-confirm-blocked-reason")).toHaveTextContent(
      "待发布变更加载失败，无法提交。"
    );
  });

  it("marks a stale validation as stale and keeps the publish CTA disabled (PWB-05)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return okJson({
            files: [
              {
                filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                status: "modified",
                diff: "+ diff"
              }
            ],
            // The CURRENT content version.
            pendingDigest: "digest-new",
            baselineState: "ready"
          });
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return okJson({
            // An OLDER content version — the late answer must not win.
            pendingDigest: "digest-old",
            baselineState: "ready",
            results: [
              {
                conn: "mysql-aliyun",
                schema: "dataforai",
                table: "superstore_orders",
                validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
              }
            ]
          });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    expect(await screen.findByTestId("workbench-validation-stale")).toHaveTextContent(
      "待发布内容已变化"
    );
    const cta = screen.getByTestId("workbench-publish-and-reindex");
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute("data-gate", "stale");
    expect(screen.getByTestId("publish-gate-next-step")).toHaveTextContent("重新校验");
    expect(screen.getByTestId("publish-change-impact")).toHaveAttribute(
      "data-impact-state",
      "stale"
    );
  });

  it("keeps the loaded pending list visible while refreshing", async () => {
    let diffCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          diffCalls += 1;
          if (diffCalls === 1) {
            return okJson({
              files: [
                {
                  filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                  status: "modified",
                  diff: "+ diff"
                }
              ],
              pendingDigest: "digest-1",
              baselineState: "ready"
            });
          }
          // The refresh never settles — the page must keep the loaded data.
          return new Promise<Response>(() => {});
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return okJson({
            pendingDigest: "digest-1",
            baselineState: "ready",
            results: [
              {
                conn: "mysql-aliyun",
                schema: "dataforai",
                table: "superstore_orders",
                validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
              }
            ]
          });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    await waitFor(() =>
      expect(screen.getByTestId("workbench-pending-count")).toHaveTextContent("1 个待同步文件")
    );

    fireEvent.click(screen.getByTestId("workbench-refresh"));

    await waitFor(() =>
      expect(screen.getByTestId("workbench-refresh")).toHaveTextContent("刷新中…")
    );
    // The already loaded data stays on screen — no full-page overlay, no empty state.
    expect(screen.getByTestId("workbench-pending-groups")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-pending-count")).toHaveTextContent("1 个待同步文件");
    expect(screen.getByTestId("publish-gate-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-empty-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workbench-pending-error")).not.toBeInTheDocument();
  });

  it("degrades gracefully when the diff response carries no pendingDigest and no impact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return okJson({
            files: [
              {
                filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
                status: "modified",
                diff: "+ diff"
              }
            ]
          });
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return okJson({
            results: [
              {
                conn: "mysql-aliyun",
                schema: "dataforai",
                table: "superstore_orders",
                validation: { ok: true, exitCode: 0, stdout: "", stderr: "" }
              }
            ]
          });
        }
        if (url === "/api/sources") return okJson({ tables: [] });
        return notFound(url);
      })
    );

    renderWorkbench();

    await waitFor(() =>
      expect(screen.getByTestId("workbench-publish-and-reindex")).toHaveAttribute(
        "data-gate",
        "ready"
      )
    );
    expect(screen.getByTestId("workbench-publish-and-reindex")).not.toBeDisabled();
    // Without a server impact the page falls back to the file-derived table list.
    expect(screen.getByTestId("publish-change-impact-list")).toHaveTextContent(
      "superstore_orders"
    );
    expect(screen.queryByTestId("workbench-validation-stale")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workbench-pending-error")).not.toBeInTheDocument();
  });
});
