// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableEditor } from "../pages/TableEditor";

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sources/mysql-aliyun/dataforai/superstore_orders"]}>
        <Routes>
          <Route path="/sources/:conn/:schema/:table" element={<TableEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubEditorFetch({ failSave = false }: { failSave?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
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
                columnNames: ["order_id"],
                hasTableDesc: true,
                hasGrain: false,
                measureCount: 1,
                joinCount: 0,
                wikiRefCount: 0,
                completion: "partial",
                mtime: "2026-06-15T00:00:00.000Z"
              }
            ]
          }
        })
      );
    }
    if (url === "/api/sources/mysql-aliyun/dataforai/superstore_orders" && !init) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            model: {
              conn: "mysql-aliyun",
              schema: "dataforai",
              table: "superstore_orders",
              filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
              qualifiedName: "dataforai.superstore_orders",
              descriptions: { ai: "AI table description" },
              grain: ["order_id"],
              columns: [{ name: "order_id", type: "number", pk: true, descriptions: { ai: "AI column description" } }],
              measures: [{ name: "total_sales", expr: "sum(sales)", description: "Total sales" }],
              segments: [],
              joins: [],
              unknownKeys: []
            },
            rawYaml: "table: dataforai.superstore_orders\n",
            completion: "partial"
          }
        })
      );
    }
    if (url === "/api/sources/mysql-aliyun/dataforai/superstore_orders" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (body.dryRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "+ human: Human column description",
              proposedYaml: "proposed",
              files: [{ filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml", diff: "+ human", proposedYaml: "proposed" }]
            }
          })
        );
      }
      if (failSave) {
        return new Response(JSON.stringify({ ok: false, error: { code: "SAVE_FAILED", message: "disk denied" } }), { status: 500 });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            written: true,
            validation: { ok: true, exitCode: 0, stdout: "", stderr: "" },
            changedFiles: []
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TableEditor", () => {
  it("renders editable descriptions and requests dryRun preview", async () => {
    const fetchMock = stubEditorFetch();

    renderEditor();

    expect(await screen.findByText("维护表语义：superstore_orders")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^字段/ }));
    const columnInput = await screen.findByDisplayValue("AI column description");
    fireEvent.change(columnInput, { target: { value: "Human column description" } });

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
      const body = JSON.parse(String(putCall?.[1]?.body));
      expect(body.dryRun).toBe(true);
      expect(body.patch.columns[0]).toEqual({
        name: "order_id",
        description: "Human column description"
      });
    });

    expect(await screen.findByText(/\+ human: Human column description/)).toBeInTheDocument();
  });

  it("switches sections through the object tree", async () => {
    stubEditorFetch();
    renderEditor();

    expect(await screen.findByText("维护表语义：superstore_orders")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Measures/ }));

    expect(screen.getByDisplayValue("total_sales")).toBeInTheDocument();
    expect(screen.getByDisplayValue("sum(sales)")).toBeInTheDocument();
  });

  it("saves with dryRun false from the page-level save button", async () => {
    const fetchMock = stubEditorFetch();
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "保存" }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find((call) => {
        if (call[1]?.method !== "PUT") {
          return false;
        }
        return JSON.parse(String(call[1].body)).dryRun === false;
      });
      expect(saveCall).toBeTruthy();
    });
  });

  it("shows save errors in the inspector", async () => {
    stubEditorFetch({ failSave: true });
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存失败：disk denied")).toBeInTheDocument();
  });
});
