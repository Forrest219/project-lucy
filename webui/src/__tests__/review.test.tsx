// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Review, boundaryChecklistForChangedFiles } from "../pages/Review";

function renderReview() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Review />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Review", () => {
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

  it("switches changed files and shows validate changed results", async () => {
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

    renderReview();

    expect(await screen.findByText(/\+ orders diff/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /customers.yaml/ }));
    expect(screen.getByText(/\+ customers diff/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Validate changed" }));
    expect(await screen.findByText("1 张表未通过")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("FAIL")).toBeInTheDocument());
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

    renderReview();

    const checklist = await screen.findByTestId("review-boundary-checklist");
    expect(checklist).toHaveTextContent(
      "检查数据库接入是否只处理 Connection / Schema / Manifest / Catalog / 白名单 / 连通测试。"
    );
    expect(checklist).toHaveTextContent("检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。");
    expect(checklist).toHaveTextContent("检查语义层维护是否只处理业务语义和 overlay。");
  });
});
