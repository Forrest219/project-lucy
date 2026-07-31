// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PublishWorkbench,
  boundaryChecklistForChangedFiles
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

describe("PublishWorkbench", () => {
  it("maps changed files to boundary checklist prompts", () => {
    expect(
      boundaryChecklistForChangedFiles([
        "webui/src/pages/connections/ConnectionOverview.tsx",
        "webui/server/catalog-assets.ts",
        "webui/src/pages/TableEditor.tsx",
        "webui/server/semantic-assets.ts"
      ])
    ).toEqual([
      "检查数据库接入是否只处理 Connection / Schema / Manifest / Catalog / 白名单 / 连通测试。",
      "检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。",
      "检查语义层维护是否只处理业务语义和 overlay。",
      "检查资产包分类、secret hard block 和 Validate Gate。"
    ]);
  });

  it("renders the publish workbench header and core actions", async () => {
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
      screen.getByText("查看并发布当前待生效的语义资产", { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "校验变更" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "强制重建索引" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传语义资产" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出当前快照 (.zip)" })).toBeInTheDocument();
    // With zero pending files the main publish CTA must be present but
    // disabled, never rendered as an enabled highlighted CTA.
    const publishCta = screen.queryByRole("button", { name: "发布并重建索引" });
    if (publishCta) {
      expect(publishCta).toBeDisabled();
    }
    expect(screen.queryByText("变更审阅与校验")).not.toBeInTheDocument();
    expect(screen.queryByText("Validate changed")).not.toBeInTheDocument();
  });

  it("switches changed files and shows validate results", async () => {
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
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    expect(await screen.findByText(/\+ orders diff/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /customers.yaml/ }));
    expect(screen.getByText(/\+ customers diff/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "校验变更" }));
    expect(await screen.findByText("1 张表未通过")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("FAIL")).toBeInTheDocument());
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

  it("opens the semantic asset publish drawer when 上传语义资产 is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    const uploadButton = await screen.findByTestId("workbench-upload-semantic-asset");
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
          // Files outside the changedSources scope (e.g. a wiki page or
          // .ktx-ui sidecar) show up in `/api/diff` but are not validated by
          // `/api/validate-changed`. The publish CTA must stay disabled in
          // that case so the workbench never claims a clean validate gate.
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
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );

    renderWorkbench();

    // Wait for the diff to populate and inspect the initial gate.
    const publishCta = await screen.findByTestId("workbench-publish-and-reindex");
    await waitFor(() =>
      expect(publishCta).toHaveAttribute("data-gate", "pending")
    );
    expect(publishCta).toBeDisabled();
    // After clicking the workbench's own `校验变更` button, the validate
    // endpoint still returns an empty results array (wiki files aren't
    // covered) so the gate must remain `pending` and the CTA must stay
    // disabled. This is the fail-closed case described in M32 P2 #1.
    fireEvent.click(screen.getByRole("button", { name: "校验变更" }));
    await waitFor(() => expect(validateCalls).toBeGreaterThan(0));
    expect(
      screen.getByTestId("workbench-publish-and-reindex")
    ).toHaveAttribute("data-gate", "pending");
    expect(screen.getByTestId("workbench-publish-and-reindex")).toBeDisabled();
  });

  it("highlights the publish-and-reindex CTA only when pending files exist and validate gate passes", async () => {
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
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    // Wait for /api/diff to populate so the gate enters `pending` instead of `empty`.
    const publishCta = await screen.findByTestId("workbench-publish-and-reindex");
    await waitFor(() =>
      expect(publishCta).toHaveAttribute("data-gate", "pending")
    );
    expect(publishCta).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "校验变更" }));
    await waitFor(() => expect(validateCalls).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getByTestId("workbench-publish-and-reindex")).toHaveAttribute("data-gate", "ready")
    );
    expect(screen.getByTestId("workbench-publish-and-reindex")).not.toBeDisabled();
  });

  it("shows boundary checklist prompts for changed implementation files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderWorkbench();

    const checklist = await screen.findByTestId("review-boundary-checklist");
    expect(checklist).toHaveTextContent(
      "检查数据库接入是否只处理 Connection / Schema / Manifest / Catalog / 白名单 / 连通测试。"
    );
    expect(checklist).toHaveTextContent("检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。");
    expect(checklist).toHaveTextContent("检查语义层维护是否只处理业务语义和 overlay。");
  });
});
