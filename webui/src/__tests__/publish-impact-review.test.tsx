// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishImpactReview } from "../components/semantic-assets/PublishImpactReview";
import type {
  PublishImpact,
  PublishImpactReason,
  PublishImpactTable
} from "../lib/types";

/**
 * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.5 — the shared
 * impact review body of the 「确认同步索引并生效」 panel.
 *
 * The three rules under test:
 *   - the table list is NEVER truncated (no `slice(0, 8)`);
 *   - one table with several reasons is ONE table in the totals;
 *   - search and folding change the DISPLAY only — the synced range stays whole.
 */

function makeReason(overrides: Partial<PublishImpactReason> = {}): PublishImpactReason {
  return {
    kind: "overlay_change",
    summary: "指标定义变更",
    source: "pending_disk_change",
    filePath: "semantic-layer/conn-a/a_table.yaml",
    evidenceRef: "ref-a",
    ...overrides
  };
}

function makeTable(
  connectionId: string,
  schema: string,
  table: string,
  reasons: PublishImpactReason[] = [makeReason()]
): PublishImpactTable {
  return {
    identity: { connectionId, schema, table },
    reasons
  };
}

function makeImpact(overrides: Partial<PublishImpact> = {}): PublishImpact {
  return {
    pendingDigest: "digest-1",
    complete: true,
    counts: { files: 0, tables: 0, manifests: 0, wikiPages: 0 },
    tables: [],
    wikiChanges: [],
    schemaChanges: [],
    relatedScope: [],
    otherChanges: [],
    unresolved: [],
    ...overrides
  };
}

function renderReview(impact: PublishImpact) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublishImpactReview impact={impact} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function twelveTables(): PublishImpactTable[] {
  return Array.from({ length: 12 }, (_, index) =>
    makeTable(
      "conn-a",
      "schema_x",
      `t${index}`,
      [
        makeReason({
          summary: `指标定义变更 ${index}`,
          filePath: `semantic-layer/conn-a/t${index}.yaml`,
          evidenceRef: `ref-${index}`
        })
      ]
    )
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PublishImpactReview", () => {
  it("summarises the range: tables, manifests, wiki pages and pending files", () => {
    renderReview(
      makeImpact({
        counts: { files: 6, tables: 3, manifests: 1, wikiPages: 2 }
      })
    );

    const summary = screen.getByTestId("publish-impact-summary");
    expect(summary).toHaveTextContent("涉及表 3 张 · Schema Manifest 1 个 · 业务 Wiki 2 篇");
    expect(summary).toHaveTextContent("待同步文件 6 个");
  });

  it("renders every table of a large batch — the list is never truncated", () => {
    const tables = twelveTables();
    renderReview(
      makeImpact({
        tables,
        counts: { files: 12, tables: 12, manifests: 0, wikiPages: 0 }
      })
    );

    expect(screen.getAllByTestId("publish-impact-table")).toHaveLength(12);
    expect(screen.getByTestId("publish-impact-table-count")).toHaveTextContent(
      "当前显示 12 / 共 12 张"
    );
  });

  it("renders both reasons of a table but counts the table once", () => {
    renderReview(
      makeImpact({
        tables: [
          makeTable("conn-a", "schema_x", "a_table", [
            makeReason({
              kind: "overlay_change",
              summary: "指标定义变更",
              evidenceRef: "ref-overlay",
              filePath: "semantic-layer/conn-a/a_table.yaml"
            }),
            makeReason({
              kind: "manifest_table_change",
              summary: "Schema Manifest 中的字段描述变更",
              evidenceRef: "ref-manifest",
              filePath: "semantic-layer/conn-a/_schema/schema_x.yaml"
            })
          ])
        ],
        counts: { files: 2, tables: 1, manifests: 1, wikiPages: 0 }
      })
    );

    expect(screen.getAllByTestId("publish-impact-table")).toHaveLength(1);
    const reasons = within(screen.getByTestId("publish-impact-reasons")).getAllByRole("listitem");
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toHaveTextContent("指标定义变更");
    expect(reasons[1]).toHaveTextContent("Schema Manifest 中的字段描述变更");
    expect(reasons[0]).toHaveTextContent("变更来源：既有待发布变更");
    expect(reasons[1]).toHaveTextContent("变更来源：既有待发布变更");

    // The table counts ONCE in the totals.
    expect(screen.getByTestId("publish-impact-summary")).toHaveTextContent("涉及表 1 张");
    expect(screen.getByTestId("publish-impact-table-count")).toHaveTextContent("共 1 张");
  });

  it("filters the DISPLAY only — the synced range stays whole", () => {
    renderReview(
      makeImpact({
        tables: twelveTables(),
        counts: { files: 12, tables: 12, manifests: 0, wikiPages: 0 }
      })
    );

    const search = screen.getByTestId("publish-impact-search");
    fireEvent.change(search, { target: { value: "t3" } });

    expect(screen.getAllByTestId("publish-impact-table")).toHaveLength(1);
    expect(screen.getByTestId("publish-impact-table-count")).toHaveTextContent(
      "当前显示 1 / 共 12 张"
    );
    // The total is NOT reduced by the search.
    expect(screen.getByTestId("publish-impact-summary")).toHaveTextContent("涉及表 12 张");
    expect(screen.getByTestId("publish-impact-filter-note")).toHaveTextContent(
      "仍会同步全部范围"
    );
    expect(screen.getByTestId("publish-impact-filter-note")).toHaveTextContent(
      "搜索与折叠只影响展示，本次仍会同步全部范围。"
    );
  });

  it("also matches a table by its reason text", () => {
    renderReview(
      makeImpact({
        tables: [
          makeTable("conn-a", "schema_x", "a_table", [
            makeReason({ summary: "字段描述变更", evidenceRef: "ref-a" })
          ]),
          makeTable("conn-a", "schema_x", "b_table", [
            makeReason({ summary: "指标定义变更", evidenceRef: "ref-b" })
          ])
        ],
        counts: { files: 2, tables: 2, manifests: 0, wikiPages: 0 }
      })
    );

    fireEvent.change(screen.getByTestId("publish-impact-search"), {
      target: { value: "字段描述" }
    });

    const entries = screen.getAllByTestId("publish-impact-table");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent("conn-a/schema_x/a_table");
    expect(screen.getByTestId("publish-impact-table-count")).toHaveTextContent(
      "当前显示 1 / 共 2 张"
    );
  });

  it("collapses a connection/schema group but keeps the group total", () => {
    renderReview(
      makeImpact({
        tables: [
          makeTable("conn-a", "schema_x", "a1"),
          makeTable("conn-a", "schema_x", "a2"),
          makeTable("conn-a", "schema_x", "a3"),
          makeTable("conn-b", "schema_y", "b1")
        ],
        counts: { files: 4, tables: 4, manifests: 0, wikiPages: 0 }
      })
    );

    const toggles = screen.getAllByTestId("publish-impact-group-toggle");
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveTextContent("连接 conn-a / Schema schema_x");
    expect(toggles[0]).toHaveTextContent("3 张");
    expect(screen.getAllByTestId("publish-impact-table")).toHaveLength(4);

    fireEvent.click(toggles[0]);

    // The folded group's entries are hidden …
    const entries = screen.getAllByTestId("publish-impact-table");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent("conn-b/schema_y/b1");
    // … but the header keeps the group total.
    const collapsedToggle = screen.getAllByTestId("publish-impact-group-toggle")[0];
    expect(collapsedToggle).toHaveTextContent("3 张");
    expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("publish-impact-filter-note")).toHaveTextContent(
      "仍会同步全部范围"
    );
  });

  it("renders wiki, schema-level, related-scope and unresolved sections in their own areas", () => {
    renderReview(
      makeImpact({
        tables: [makeTable("conn-a", "schema_x", "a_table")],
        counts: { files: 3, tables: 1, manifests: 1, wikiPages: 1 },
        wikiChanges: [
          { filePath: "wiki/global/guide.md", title: "客户成功指南", changeType: "modified" }
        ],
        schemaChanges: [
          { connectionId: "conn-a", schema: "schema_x", evidenceRef: "ref-schema" }
        ],
        relatedScope: [
          {
            identity: { connectionId: "conn-b", schema: "schema_y", table: "b_table" },
            relationKind: "校验依赖",
            evidenceRef: "ref-related"
          }
        ],
        unresolved: [
          { filePath: "semantic-layer/conn-c/ghost.yaml", reason: "无法解析表身份", blocking: false }
        ]
      })
    );

    expect(screen.getByTestId("publish-impact-wiki")).toHaveTextContent("业务 Wiki");
    expect(screen.getByTestId("publish-impact-wiki")).toHaveTextContent("客户成功指南");
    expect(screen.getByTestId("publish-impact-wiki")).toHaveTextContent("wiki/global/guide.md");

    expect(screen.getByTestId("publish-impact-schema-changes")).toHaveTextContent(
      "Schema 级变更"
    );
    expect(screen.getByTestId("publish-impact-schema-changes")).toHaveTextContent(
      "conn-a/schema_x"
    );

    expect(screen.getByTestId("publish-impact-related-scope")).toHaveTextContent(
      "关联与校验范围"
    );
    expect(screen.getByTestId("publish-impact-related-scope")).toHaveTextContent(
      "conn-b/schema_y/b_table"
    );

    expect(screen.getByTestId("publish-impact-unresolved")).toHaveTextContent("影响范围待核对");
    expect(screen.getByTestId("publish-impact-unresolved")).toHaveTextContent(
      "semantic-layer/conn-c/ghost.yaml"
    );
    expect(screen.getByTestId("publish-impact-unresolved")).toHaveTextContent("无法解析表身份");
  });

  it("hides the optional sections when they are empty", () => {
    renderReview(
      makeImpact({
        tables: [makeTable("conn-a", "schema_x", "a_table")],
        counts: { files: 1, tables: 1, manifests: 0, wikiPages: 0 }
      })
    );

    expect(screen.queryByTestId("publish-impact-schema-changes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-impact-related-scope")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-impact-unresolved")).not.toBeInTheDocument();
    // The wiki section stays, but says there is no wiki change.
    expect(screen.getByTestId("publish-impact-wiki")).toHaveTextContent(
      "本次没有业务 Wiki 变更。"
    );
  });

  it("blocks the submission and names the blocking reasons when the range is incomplete", () => {
    renderReview(
      makeImpact({
        complete: false,
        tables: [makeTable("conn-a", "schema_x", "a_table")],
        counts: { files: 2, tables: 1, manifests: 0, wikiPages: 0 },
        unresolved: [
          {
            filePath: "semantic-layer/conn-c/ghost.yaml",
            reason: "无法解析完整表身份",
            blocking: true
          },
          { filePath: "wiki/global/guide.md", reason: "仅提示：非阻断项", blocking: false }
        ]
      })
    );

    const notice = screen.getByTestId("publish-impact-incomplete");
    expect(notice).toHaveTextContent("影响范围未完整解析，本次提交已被阻断。");

    const blocking = within(screen.getByTestId("publish-impact-blocking-reasons")).getAllByRole(
      "listitem"
    );
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toHaveTextContent("semantic-layer/conn-c/ghost.yaml");
    expect(blocking[0]).toHaveTextContent("无法解析完整表身份");
    expect(blocking[0]).not.toHaveTextContent("仅提示：非阻断项");
  });

  it("loads the evidence on demand and keeps the search text and the folded group", async () => {
    const evidenceCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/publish-workbench/evidence")) {
          evidenceCalls.push(url);
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                kind: "diff",
                logicalPath: "semantic-layer/conn-b/b_table.yaml",
                content: "+ metrics:\n+   - gmv"
              }
            })
          );
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );

    renderReview(
      makeImpact({
        tables: [
          makeTable("conn-a", "schema_x", "a_table", [
            makeReason({ evidenceRef: "ref-a", filePath: "semantic-layer/conn-a/a_table.yaml" })
          ]),
          makeTable("conn-b", "schema_y", "b_table", [
            makeReason({
              evidenceRef: "ref-b",
              summary: "指标定义变更",
              filePath: "semantic-layer/conn-b/b_table.yaml"
            })
          ])
        ],
        counts: { files: 2, tables: 2, manifests: 0, wikiPages: 0 }
      })
    );

    // The operator searches and folds a group BEFORE reading the evidence.
    fireEvent.change(screen.getByTestId("publish-impact-search"), {
      target: { value: "table" }
    });
    const toggles = screen.getAllByTestId("publish-impact-group-toggle");
    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");

    const expandButtons = screen.getAllByTestId("publish-impact-evidence-toggle");
    expect(expandButtons).toHaveLength(1);
    fireEvent.click(expandButtons[0]);

    expect(
      await screen.findByTestId("publish-impact-evidence")
    ).toHaveTextContent("+ metrics:");
    expect(evidenceCalls).toHaveLength(1);
    expect(evidenceCalls[0]).toContain("/api/publish-workbench/evidence?ref=ref-b");

    // The reading position survives the evidence expansion.
    expect(screen.getByTestId("publish-impact-search")).toHaveValue("table");
    expect(screen.getAllByTestId("publish-impact-group-toggle")[0]).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
