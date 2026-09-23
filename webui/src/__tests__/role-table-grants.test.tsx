// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleTableGrants } from "../components/RoleTableGrants";
import {
  buildTableAllow,
  type TableGrant,
} from "../lib/rolePermissionDraft";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Shared fixture data ──────────────────────────────────────────────────────

const CONNECTIONS = [
  { id: "rds-test", schemas: ["rds_schema"] },
];

const CANDIDATE_TABLES: Record<string, string[]> = {
  "rds-test\0rds_schema": ["table_a", "table_b"],
};

// ─── buildTableAllow — pure function tests ────────────────────────────────────

describe("buildTableAllow", () => {
  it("two same-schema all-row tables → one names selector, one connection", () => {
    const tables: TableGrant[] = [
      { connection: "rds-test", schema: "rds_schema", name: "table_a" },
      { connection: "rds-test", schema: "rds_schema", name: "table_b" },
    ];
    const result = buildTableAllow({ mode: "names", tables });

    expect(result.connections).toEqual(["rds-test"]);
    expect(result.tableSelectors).toHaveLength(1);
    const sel = result.tableSelectors![0];
    expect(sel.names).toContain("table_a");
    expect(sel.names).toContain("table_b");
    expect(sel.row_access).toBe("all");
    expect(sel.row_policy).toBeUndefined();
  });

  it("one table with region=East → two selectors; scoped has row_policy; other is all-row", () => {
    const tables: TableGrant[] = [
      { connection: "rds-test", schema: "rds_schema", name: "table_a" },
      {
        connection: "rds-test",
        schema: "rds_schema",
        name: "table_b",
        predicates: [{ field: "region", op: "eq", value: "East" }],
      },
    ];
    const result = buildTableAllow({ mode: "names", tables });

    expect(result.tableSelectors).toHaveLength(2);

    const allRow = result.tableSelectors!.find((s) => s.row_access === "all");
    const scoped = result.tableSelectors!.find((s) => s.row_access === "scoped");

    expect(allRow).toBeDefined();
    expect(allRow!.names).toContain("table_a");
    expect(allRow!.row_policy).toBeUndefined();

    expect(scoped).toBeDefined();
    expect(scoped!.names).toContain("table_b");
    expect(scoped!.row_policy).toBeDefined();
    expect(scoped!.row_policy!.predicates.some((p) => p.field === "region")).toBe(true);
  });

  it("catalog_bound → connections from manual list, source_scope, no tableSelectors", () => {
    const tables: TableGrant[] = [
      { connection: "rds-test", schema: "rds_schema", name: "table_a" },
    ];
    const result = buildTableAllow({
      mode: "catalog_bound",
      tables,
      manualConnections: ["conn-1", "conn-2"],
    });

    expect(result.connections).toEqual(["conn-1", "conn-2"]);
    expect(result.source_scope).toBe("catalog_bound");
    expect(result.tableSelectors).toBeUndefined();
  });

  it("catalog_bound with no manual connections → empty connections list, no tableSelectors", () => {
    const result = buildTableAllow({
      mode: "catalog_bound",
      tables: [],
    });
    expect(result.connections).toEqual([]);
    expect(result.source_scope).toBe("catalog_bound");
    expect(result.tableSelectors).toBeUndefined();
  });

  it("prefix mode → same grouping as names, connections derived from tables", () => {
    const tables: TableGrant[] = [
      { connection: "rds-test", schema: "rds_schema", name: "table_a" },
      { connection: "rds-test", schema: "rds_schema", name: "table_b" },
    ];
    const result = buildTableAllow({ mode: "prefix", tables });

    expect(result.connections).toEqual(["rds-test"]);
    expect(result.tableSelectors).toHaveLength(1);
    expect(result.source_scope).toBeUndefined();
  });

  it("two same-schema same-policy (scoped) tables → one scoped selector", () => {
    const pred = [{ field: "region", op: "eq" as const, value: "East" }];
    const tables: TableGrant[] = [
      { connection: "c", schema: "s", name: "t1", predicates: pred },
      { connection: "c", schema: "s", name: "t2", predicates: pred },
    ];
    const result = buildTableAllow({ mode: "names", tables });

    expect(result.tableSelectors).toHaveLength(1);
    const sel = result.tableSelectors![0];
    expect(sel.row_access).toBe("scoped");
    expect(sel.names).toHaveLength(2);
    expect(sel.row_policy).toBeDefined();
  });
});

// ─── RoleTableGrants component — DOM tests ─────────────────────────────────────

describe("RoleTableGrants component", () => {
  it("renders connection → schema → table tree", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    expect(screen.getByText("rds-test")).toBeInTheDocument();
    expect(screen.getByText("rds_schema")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "table_a" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "table_b" })).toBeInTheDocument();
  });

  it("no manual table name input when candidates loaded", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );
    expect(screen.queryByText("候选表加载失败")).not.toBeInTheDocument();
  });

  it("shows manual table name input when candidates failed to load", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={{}}
        candidatesLoaded={false}
      />
    );
    expect(screen.getByText("候选表加载失败，请手工补填表名：")).toBeInTheDocument();
  });

  it("row policy collapsed by default: no row_access / all / scoped / op text visible", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    // Check a table
    fireEvent.click(screen.getByRole("checkbox", { name: "table_a" }));

    // The row policy section exists but is NOT expanded
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\brow_access\b/);
    // "all" and "scoped" must not appear as standalone labels
    // (they may appear only as CSS class names or JS identifiers, never as visible label text)
    // Check the collapsed label specifically
    const collapsedLabel = screen.getByTestId("row-policy-collapsed-label-table_a");
    expect(collapsedLabel.textContent).toBe("行权限：全部行");
    expect(collapsedLabel.textContent).not.toContain("all");
    expect(collapsedLabel.textContent).not.toContain("scoped");
    expect(collapsedLabel.textContent).not.toContain("op");
    expect(collapsedLabel.textContent).not.toContain("row_access");
  });

  it("expanded row policy shows 等于 and 属于 operators only", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    // Select a table
    fireEvent.click(screen.getByRole("checkbox", { name: "table_a" }));

    // Expand the policy editor
    fireEvent.click(screen.getByRole("button", { name: "展开 table_a 行策略" }));

    // Add a condition
    fireEvent.click(screen.getByRole("button", { name: "+ 添加条件" }));

    // Verify operators are 等于 / 属于
    const opSelect = screen.getByRole("combobox", { name: "table_a 条件 1 运算符" });
    const options = within(opSelect).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["等于", "属于"]);
  });

  it("默认折叠的高级区包含按前缀匹配和启用目录绑定", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    const advanced = screen.getByTestId("table-grants-advanced");
    // Advanced section exists but is closed by default
    expect(advanced).not.toHaveAttribute("open");

    // Open it
    fireEvent.click(screen.getByText("高级"));
    expect(screen.getByRole("checkbox", { name: "按前缀匹配" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用目录绑定" })).toBeInTheDocument();
  });

  it("打开前缀后能找到 expansionNotice 原文，且该句不在折叠区内部", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    // Open advanced section
    fireEvent.click(screen.getByText("高级"));
    // Toggle prefix mode
    fireEvent.click(screen.getByRole("checkbox", { name: "按前缀匹配" }));

    // The expansion notice must be visible
    const notice = screen.getByTestId("table-grants-expansion-notice");
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toBe("此后同前缀的新表自动进入");

    // The notice element must NOT be inside the advanced <details> element
    const advanced = screen.getByTestId("table-grants-advanced");
    expect(advanced.contains(notice)).toBe(false);
  });

  it("catalog_bound 模式：显示手工连接勾选，表树禁止勾选", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    // Open advanced and enable catalog_bound
    fireEvent.click(screen.getByText("高级"));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用目录绑定" }));

    // Manual connection checkboxes appear
    expect(screen.getByTestId("table-grants-manual-connections")).toBeInTheDocument();

    // Table tree checkboxes are disabled
    const tableACheckbox = screen.getByRole("checkbox", { name: "table_a" });
    expect(tableACheckbox).toBeDisabled();
  });

  it("catalog_bound 展开后 expansionNotice 在高级区外部", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    fireEvent.click(screen.getByText("高级"));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用目录绑定" }));

    const notice = screen.getByTestId("table-grants-expansion-notice");
    expect(notice.textContent).toBe("已声明连接上，后续新启用的表自动进入，并走扩权审计");

    const advanced = screen.getByTestId("table-grants-advanced");
    expect(advanced.contains(notice)).toBe(false);
  });

  it("前缀规则旁显示固定句「此条件覆盖…」", () => {
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    fireEvent.click(screen.getByText("高级"));
    fireEvent.click(screen.getByRole("checkbox", { name: "按前缀匹配" }));

    expect(
      screen.getByText("此条件覆盖这条规则命中的每一张表，包括以后新进来的表。")
    ).toBeInTheDocument();
  });

  it("onAllowChange called with buildTableAllow output when tables selected", () => {
    const onChange = vi.fn();
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
        onAllowChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "table_a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "table_b" }));

    // Should have been called; last call should have one selector (same schema, same policy → grouped)
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.connections).toContain("rds-test");
    expect(lastCall.tableSelectors).toHaveLength(1);
    expect(lastCall.tableSelectors[0].row_access).toBe("all");
  });

  it("names mode: no expansion notice rendered", () => {
    render(
      <RoleTableGrants
        initialMode="names"
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
      />
    );

    expect(screen.queryByTestId("table-grants-expansion-notice")).not.toBeInTheDocument();
  });

  it("输入前缀 poc_ 后 onAllowChange 的 allow 包含 prefixRule: 'poc_'，而不是空字符串", () => {
    const onChange = vi.fn();
    render(
      <RoleTableGrants
        connections={CONNECTIONS}
        candidateTablesByKey={CANDIDATE_TABLES}
        candidatesLoaded={true}
        onAllowChange={onChange}
      />
    );

    // Open advanced section and enable prefix mode
    fireEvent.click(screen.getByText("高级"));
    fireEvent.click(screen.getByRole("checkbox", { name: "按前缀匹配" }));

    // Type prefix value
    const prefixField = screen.getByRole("textbox", { name: "表名前缀" });
    fireEvent.change(prefixField, { target: { value: "poc_" } });

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // prefixRule must carry the actual input value
    expect(lastCall.prefixRule).toBe("poc_");
    // Empty prefix must not appear anywhere in the serialized allow
    expect(JSON.stringify(lastCall)).not.toContain('"prefix":""');
  });
});
