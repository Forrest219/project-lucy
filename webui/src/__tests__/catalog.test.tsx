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
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "表名",
      "Connection",
      "Schema",
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

  it("shows Connection before Schema in the filter bar", async () => {
    renderCatalog([makeSummary()]);

    await screen.findByTestId("catalog-table");
    const connectionTrigger = screen.getByLabelText("按 Connection 筛选");
    const schemaTrigger = screen.getByLabelText("按 Schema 筛选");
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

  it("renders only the 维护语义 primary button by default; 查看详情 and 业务 Wiki live behind the more menu", async () => {
    renderCatalog([makeSummary()]);

    const row = await screen.findByTestId("catalog-row-superstore_orders");
    // primary action visible
    expect(within(row).getByTestId("catalog-row-maintain-superstore_orders")).toHaveTextContent("维护语义");
    expect(within(row).getByTestId("catalog-row-maintain-superstore_orders")).toHaveAttribute(
      "href",
      "/catalog/mysql-aliyun/dataforai/superstore_orders"
    );
    // detail/wiki links NOT in the row yet
    expect(within(row).queryByTestId("catalog-row-copy-ref-superstore_orders")).toBeNull();
    expect(within(row).queryByTestId("catalog-row-detail-superstore_orders")).toBeNull();
    expect(within(row).queryByTestId("catalog-row-wiki-superstore_orders")).toBeNull();
  });

  it("opens the more menu on trigger click and closes on outside click + Escape", async () => {
    renderCatalog([makeSummary()]);

    const row = await screen.findByTestId("catalog-row-superstore_orders");
    const trigger = within(row).getByTestId("row-more-trigger");

    // menu is initially closed
    expect(within(row).queryByTestId("row-more-menu")).toBeNull();

    // click opens menu
    fireEvent.click(trigger);
    const menu = await within(row).findByTestId("row-more-menu");
    expect(within(menu).getByTestId("catalog-row-copy-ref-superstore_orders")).toHaveTextContent("复制完整引用");
    expect(within(menu).getByTestId("catalog-row-detail-superstore_orders")).toHaveTextContent("查看详情");
    expect(within(menu).getByTestId("catalog-row-wiki-superstore_orders")).toHaveTextContent("业务 Wiki");

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
