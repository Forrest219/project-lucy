// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "../pages/Catalog";
import type { SourceSummary } from "../lib/types";

function makeSummary(overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table: "superstore_orders",
    filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    columnCount: 8,
    columnNames: ["order_id", "order_date"],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 9,
    joinCount: 1,
    wikiRefCount: 0,
    completion: "done",
    mtime: "2026-06-15T08:00:00.000Z",
    authorizedAgentCount: 3,
    semanticUpdatedAt: "2026-07-01T10:30:00.000Z",
    semanticUpdatedAtSource: "overlay",
    ...overrides
  };
}

function renderCatalog(tables: SourceSummary[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/sources")) {
        return new Response(
          JSON.stringify({ ok: true, data: { tables } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }), { status: 404 });
    })
  );

  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Catalog />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return client;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Catalog density (M- Catalog table refactor)", () => {
  it("renders the table with the M46 governance columns", async () => {
    renderCatalog([makeSummary()]);

    const table = await screen.findByTestId("catalog-table");
    expect(within(table).getByRole("table").className).toContain("pl-data-grid");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "表名",
      "语义状态",
      "结构",
      "Agent 引用",
      "语义更新时间",
      "操作"
    ]);
  });

  it("removes catalog header badge and cross-module actions", async () => {
    renderCatalog([makeSummary()]);

    await screen.findByTestId("catalog-table");
    expect(screen.queryByTestId("catalog-count")).not.toBeInTheDocument();
    expect(screen.getByTestId("catalog-result-count")).toHaveTextContent("1 条结果");
    const header = screen.getByTestId("page-header");
    expect(within(header).queryByRole("link", { name: "业务 Wiki" })).not.toBeInTheDocument();
    expect(within(header).queryByRole("link", { name: "审阅" })).not.toBeInTheDocument();
  });

  it("shows search before connection and Schema filters in the filter bar", async () => {
    renderCatalog([makeSummary()]);

    await screen.findByTestId("catalog-table");
    const searchInput = screen.getByPlaceholderText("搜索表名或字段名...");
    const connectionTrigger = screen.getByLabelText("连接筛选");
    const schemaTrigger = screen.getByLabelText("Schema 筛选");
    expect(searchInput.compareDocumentPosition(connectionTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(connectionTrigger.compareDocumentPosition(schemaTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders structure, authorized agents, and formatted semantic-updated columns", async () => {
    renderCatalog([makeSummary()]);

    const row = await screen.findByTestId("catalog-row-superstore_orders");
    expect(within(row).getByText("字段 8 / 关联 1 / 指标 9")).toBeInTheDocument();
    expect(within(row).getByTestId("catalog-row-agents-superstore_orders")).toHaveTextContent("3 个");
    // 2026-07-01T10:30:00.000Z → local time formatted as YYYY-MM-DD HH:mm
    const updatedCell = within(row).getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(updatedCell).toBeInTheDocument();
    expect(updatedCell.title).toContain("取该表 Schema Manifest 与语义 overlay 文件的较晚修改时间");
    expect(updatedCell.title).toContain("来源：语义 overlay");
  });

  it("shows manifest source in the tooltip when overlay is older or absent", async () => {
    renderCatalog([
      makeSummary({
        table: "manifest_only",
        schema: "dataforai",
        semanticUpdatedAt: "2026-06-15T08:00:00.000Z",
        semanticUpdatedAtSource: "manifest"
      })
    ]);
    const row = await screen.findByTestId("catalog-row-manifest_only");
    const updatedCell = within(row).getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(updatedCell.title).toContain("来源：Schema Manifest");
  });

  it("renders only the 维护语义 lightweight link by default when there is no associated Wiki", async () => {
    renderCatalog([makeSummary()]);

    const row = await screen.findByTestId("catalog-row-superstore_orders");
    const action = within(row).getByTestId("catalog-row-maintain-superstore_orders");
    expect(action).toHaveTextContent("维护语义");
    expect(action).toHaveAttribute(
      "href",
      "/catalog/mysql-aliyun/dataforai/superstore_orders"
    );
    expect(action.className).toContain("pl-inline-link");
    expect(action.className).not.toContain("pl-btn");
    // secondary actions are not rendered when they do not have a concrete use.
    expect(within(row).queryByTestId("catalog-row-copy-ref-superstore_orders")).toBeNull();
    expect(within(row).queryByTestId("catalog-row-detail-superstore_orders")).toBeNull();
    expect(within(row).queryByTestId("catalog-row-wiki-superstore_orders")).toBeNull();
    expect(within(row).queryByTestId("row-more-trigger")).toBeNull();
  });

  it("opens the associated Wiki menu on trigger click and closes on outside click + Escape", async () => {
    renderCatalog([makeSummary({ wikiRefCount: 1 })]);

    const row = await screen.findByTestId("catalog-row-superstore_orders");
    const trigger = within(row).getByTestId("row-more-trigger");

    // menu is initially closed
    expect(within(row).queryByTestId("row-more-menu")).toBeNull();

    // click opens menu
    fireEvent.click(trigger);
    const menu = await within(row).findByTestId("row-more-menu");
    expect(within(menu).queryByTestId("catalog-row-copy-ref-superstore_orders")).toBeNull();
    expect(within(menu).queryByTestId("catalog-row-detail-superstore_orders")).toBeNull();
    expect(within(menu).getByTestId("catalog-row-wiki-superstore_orders")).toHaveTextContent("查看关联的 业务 Wiki");

    // outside click closes
    fireEvent.mouseDown(document.body);
    expect(within(row).queryByTestId("row-more-menu")).toBeNull();

    // re-open, Escape closes
    fireEvent.click(trigger);
    await within(row).findByTestId("row-more-menu");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(row).queryByTestId("row-more-menu")).toBeNull();
  });

  it("does not duplicate schema.table in the table-name cell", async () => {
    renderCatalog([makeSummary()]);

    const row = await screen.findByTestId("catalog-row-superstore_orders");
    const nameCell = within(row).getByTestId("catalog-row-edit-superstore_orders").closest("td");
    expect(nameCell).toHaveTextContent("superstore_orders");
    expect(nameCell).not.toHaveTextContent("dataforai.superstore_orders");
  });

  it("shows a recovery-oriented empty state when filters have no match", async () => {
    renderCatalog([makeSummary()]);

    await screen.findByTestId("catalog-table");
    fireEvent.change(screen.getByPlaceholderText("搜索表名或字段名..."), {
      target: { value: "missing_table" }
    });

    const empty = await screen.findByTestId("catalog-empty-state");
    expect(empty).toHaveTextContent("没有匹配的语义资产");
    expect(empty).toHaveTextContent("清空搜索或筛选条件");
    expect(empty).toHaveTextContent("刷新本地 Catalog");
    expect(screen.queryByTestId("catalog-table")).not.toBeInTheDocument();
  });

  it("shows a no-data empty state when the local Catalog has no semantic assets", async () => {
    renderCatalog([]);

    const empty = await screen.findByTestId("catalog-empty-state");
    expect(empty).toHaveTextContent("尚未加载到语义资产");
    expect(empty).toHaveTextContent("刷新本地 Catalog");
    expect(empty).toHaveTextContent("semantic-layer YAML");
  });

  it("does not render Owner / 下游引用 / 看板引用 / 血缘 in the catalog page", async () => {
    renderCatalog([makeSummary()]);
    await screen.findByTestId("catalog-table");
    const container = document.body;
    const forbidden = ["Owner", "下游引用", "看板引用", "血缘"];
    for (const term of forbidden) {
      expect(container.textContent ?? "").not.toContain(term);
    }
  });

  it("maps completion status to a distinct status badge class for each state", async () => {
    renderCatalog([
      makeSummary({ table: "done_table", schema: "dataforai", completion: "done" }),
      makeSummary({ table: "partial_table", schema: "dataforai", completion: "partial" }),
      makeSummary({ table: "not_started_table", schema: "dataforai", completion: "not_started" }),
      makeSummary({ table: "failed_table", schema: "dataforai", completion: "validation_failed" })
    ]);

    const done = await screen.findByTestId("catalog-row-done_table");
    expect(within(done).getByText("已完成").className).toContain("pl-status-done");
    expect(within(done).getByText("已完成").className).toContain("pl-status-badge");

    const partial = await screen.findByTestId("catalog-row-partial_table");
    expect(within(partial).getByText("部分完成").className).toContain("pl-status-partial");

    const notStarted = await screen.findByTestId("catalog-row-not_started_table");
    expect(within(notStarted).getByText("未开始").className).toContain("pl-status-not_started");

    const failed = await screen.findByTestId("catalog-row-failed_table");
    expect(within(failed).getByText("校验失败").className).toContain("pl-status-validation_failed");
  });
});
