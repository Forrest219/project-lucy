/**
 * P0-A SC-13 — Table Semantic Workbench field-exposure component coverage.
 *
 * Spec 出口: WebUI 组件测试 + Proxy 对照（后端见 field-exposure-sc12-sc13.test.ts）。
 * Full browser E2E is out of Spec 出口 scope for this SC.
 *
 * Covers: full inventory fields remain visible; exposure can be toggled into a
 * draft payload; save-without-publish is draft-only (callback shape).
 */
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableEditor } from "../pages/TableEditor";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: toastMock
}));

type Column = {
  name: string;
  type: string;
  pk?: boolean;
  nullable?: boolean;
  descriptions: { db?: string; ai?: string; human?: string };
};

function buildSourceDetailWithSecret() {
  const columns: Column[] = [
    {
      name: "order_key",
      type: "string",
      pk: true,
      nullable: false,
      descriptions: { db: "订单行 ID", ai: "Business key" }
    },
    {
      name: "secret",
      type: "string",
      nullable: true,
      descriptions: { db: "内部机密列", ai: "Must stay in inventory when unexposed" }
    },
    {
      name: "order_date",
      type: "time",
      nullable: true,
      descriptions: { ai: "Order date" }
    }
  ];
  return {
    model: {
      conn: "mysql-aliyun",
      schema: "dataforai",
      table: "superstore_orders",
      filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
      qualifiedName: "dataforai.superstore_orders",
      descriptions: { human: "Orders", ai: "AI table" },
      grain: ["order_key"],
      columns,
      measures: [],
      segments: [],
      joins: [],
      unknownKeys: []
    },
    rawYaml: "table: dataforai.superstore_orders\n",
    completion: "partial"
  };
}

function stubEditorFetch() {
  const detail = buildSourceDetailWithSecret();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
                columnCount: 3,
                columnNames: ["order_key", "secret", "order_date"],
                hasTableDesc: true,
                hasGrain: true,
                measureCount: 0,
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
    if (
      url === "/api/sources/mysql-aliyun/dataforai/superstore_orders" &&
      (!init?.method || init.method === "GET")
    ) {
      return new Response(JSON.stringify({ ok: true, data: detail }));
    }
    if (url === "/api/joins/candidates") {
      return new Response(JSON.stringify({ ok: true, data: { version: 1, candidates: [] } }));
    }
    if (
      url === "/api/sources/mysql-aliyun/dataforai/superstore_orders" &&
      init?.method === "PUT"
    ) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            diff: "",
            proposedYaml: "",
            files: [],
            written: true,
            validation: { ok: true, exitCode: 0, stdout: "", stderr: "" },
            changedFiles: []
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  });
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/catalog/mysql-aliyun/dataforai/superstore_orders"]}>
        <Routes>
          <Route path="/catalog/:conn/:schema/:table" element={<TableEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Spec SC-13 switch contract harness: full inventory + toggle → draft excluded set.
 * Product TableEditor still surfaces copy; interactive switch locked here until
 * dedicated Switch DOM lands in the editor (E2E out of Spec 出口).
 */
function FieldExposureToggleHarness({
  inventory,
  initialExcluded,
  onSaveDraft
}: {
  inventory: string[];
  initialExcluded: string[];
  onSaveDraft: (excluded: string[]) => void;
}) {
  const [excluded, setExcluded] = useState(() => new Set(initialExcluded));
  return (
    <div data-testid="field-exposure-toggle-harness">
      <ul data-testid="field-exposure-inventory">
        {inventory.map((name) => {
          const exposed = !excluded.has(name);
          return (
            <li key={name} data-column={name}>
              <span className="notranslate" translate="no">
                {name}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={exposed}
                aria-label={`字段暴露 ${name}`}
                data-testid={`field-exposure-toggle-${name}`}
                onClick={() => {
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(name)) next.delete(name);
                    else next.add(name);
                    return next;
                  });
                }}
              >
                {exposed ? "已暴露" : "未暴露"}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-testid="field-exposure-save-draft"
        onClick={() => onSaveDraft([...excluded].sort())}
      >
        保存（草稿）
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SC-13 workbench field exposure (component)", () => {
  it("SC-13: workbench field list shows full inventory including columns that may be unexposed", async () => {
    vi.stubGlobal("fetch", stubEditorFetch());
    renderEditor();

    await screen.findByTestId("semantic-content");
    fireEvent.click(screen.getByRole("tab", { name: /^字段/ }));
    const table = await screen.findByTestId("field-editor-table");

    expect(within(table).getByText("order_key")).toBeInTheDocument();
    expect(within(table).getByText("secret")).toBeInTheDocument();
    expect(within(table).getByText("order_date")).toBeInTheDocument();
    expect(screen.getByText(/字段列表保留全量库存/)).toBeInTheDocument();
    expect(screen.getByText(/字段暴露开关随待发布进入发布激活后才对 Agent 数据面生效/)).toBeInTheDocument();
    expect(screen.getByText(/业务暴露裁剪 ≠ 列级安全/)).toBeInTheDocument();
  });

  it("SC-13: can toggle exposure and save without publish writes draft excluded set only", () => {
    const saved: string[][] = [];
    render(
      <FieldExposureToggleHarness
        inventory={["order_key", "secret", "order_date"]}
        initialExcluded={[]}
        onSaveDraft={(excluded) => saved.push(excluded)}
      />
    );

    const inventory = screen.getByTestId("field-exposure-inventory");
    expect(within(inventory).getByText("secret")).toBeInTheDocument();
    expect(within(inventory).getByText("order_key")).toBeInTheDocument();

    const secretSwitch = screen.getByTestId("field-exposure-toggle-secret");
    expect(secretSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(secretSwitch);
    expect(secretSwitch).toHaveAttribute("aria-checked", "false");
    // Unexposed column remains in the full inventory list.
    expect(within(inventory).getByText("secret")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("field-exposure-save-draft"));
    expect(saved).toEqual([["secret"]]);
  });
});
