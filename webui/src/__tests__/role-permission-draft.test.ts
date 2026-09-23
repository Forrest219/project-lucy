import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_DENY_TOOL_NAMES,
  READONLY_QA_PRESET,
  READONLY_QA_WIKI_PRESET,
  buildEffectiveDigest,
  deriveConnections,
  expansionNotice,
  groupTableGrants,
  matchingPresetName,
  partitionGrantableTools,
  stampPreset,
} from "../lib/rolePermissionDraft";

// ─── ABSOLUTE_DENY_TOOL_NAMES ────────────────────────────────────────────────

describe("ABSOLUTE_DENY_TOOL_NAMES", () => {
  it("contains exactly the 6 baseline tools", () => {
    expect(ABSOLUTE_DENY_TOOL_NAMES).toContain("sl_query");
    expect(ABSOLUTE_DENY_TOOL_NAMES).toContain("sl_read_source");
    expect(ABSOLUTE_DENY_TOOL_NAMES).toContain("sql_execution");
    expect(ABSOLUTE_DENY_TOOL_NAMES).toContain("sql_dialect_notes");
    expect(ABSOLUTE_DENY_TOOL_NAMES).toContain("memory_ingest");
    expect(ABSOLUTE_DENY_TOOL_NAMES).toContain("memory_ingest_status");
    expect(ABSOLUTE_DENY_TOOL_NAMES).toHaveLength(6);
  });
});

// ─── READONLY_QA_PRESET ───────────────────────────────────────────────────────

describe("READONLY_QA_PRESET", () => {
  it("contains exactly 6 tools", () => {
    expect(READONLY_QA_PRESET).toHaveLength(6);
  });

  it("contains the required 6 tools", () => {
    expect(READONLY_QA_PRESET).toContain("lucy_catalog");
    expect(READONLY_QA_PRESET).toContain("lucy_read_source");
    expect(READONLY_QA_PRESET).toContain("lucy_query");
    expect(READONLY_QA_PRESET).toContain("lucy_explain_query");
    expect(READONLY_QA_PRESET).toContain("lucy_freshness");
    expect(READONLY_QA_PRESET).toContain("lucy_begin_question");
  });

  it("does not contain sl_validate", () => {
    expect(READONLY_QA_PRESET).not.toContain("sl_validate");
  });
});

// ─── READONLY_QA_WIKI_PRESET ──────────────────────────────────────────────────

describe("READONLY_QA_WIKI_PRESET", () => {
  it("contains exactly 8 tools", () => {
    expect(READONLY_QA_WIKI_PRESET).toHaveLength(8);
  });

  it("is a superset of READONLY_QA_PRESET plus wiki tools", () => {
    for (const tool of READONLY_QA_PRESET) {
      expect(READONLY_QA_WIKI_PRESET).toContain(tool);
    }
    expect(READONLY_QA_WIKI_PRESET).toContain("wiki_search");
    expect(READONLY_QA_WIKI_PRESET).toContain("wiki_read");
  });

  it("does not contain sl_validate", () => {
    expect(READONLY_QA_WIKI_PRESET).not.toContain("sl_validate");
  });
});

// ─── stampPreset ─────────────────────────────────────────────────────────────

describe("stampPreset", () => {
  it("returns complete preset copy, ignoring current", () => {
    const current = ["lucy_query", "sl_validate", "extra_tool"];
    const result = stampPreset(current, READONLY_QA_PRESET);
    expect(result).toEqual([...READONLY_QA_PRESET]);
  });

  it("is not a union of current and preset", () => {
    const current = ["sl_validate", "wiki_search"];
    const result = stampPreset(current, READONLY_QA_PRESET);
    expect(result).not.toContain("sl_validate");
    expect(result).not.toContain("wiki_search");
    expect(result).toHaveLength(READONLY_QA_PRESET.length);
  });

  it("returns a new array (not same reference as preset)", () => {
    const result = stampPreset([], READONLY_QA_PRESET);
    expect(result).toEqual([...READONLY_QA_PRESET]);
    // Mutations to result should not affect preset
    result.push("injected");
    expect(READONLY_QA_PRESET).not.toContain("injected");
  });

  it("stampPreset with wiki preset returns all 8 tools", () => {
    const result = stampPreset([], READONLY_QA_WIKI_PRESET);
    expect(result).toHaveLength(8);
    expect(result).toContain("wiki_search");
    expect(result).toContain("wiki_read");
  });
});

// ─── matchingPresetName ───────────────────────────────────────────────────────

describe("matchingPresetName", () => {
  it("returns 只读问答 for exact QA preset (any order)", () => {
    const shuffled = [...READONLY_QA_PRESET].reverse();
    expect(matchingPresetName(shuffled)).toBe("只读问答");
  });

  it("returns 只读问答 + 知识库 for exact wiki preset (any order)", () => {
    const shuffled = [...READONLY_QA_WIKI_PRESET].sort();
    expect(matchingPresetName(shuffled)).toBe("只读问答 + 知识库");
  });

  it("returns null when one tool is added to QA preset", () => {
    const extra = [...READONLY_QA_PRESET, "sl_validate"];
    expect(matchingPresetName(extra)).toBeNull();
  });

  it("returns null when one tool is removed from QA preset", () => {
    const fewer = READONLY_QA_PRESET.slice(0, 5);
    expect(matchingPresetName([...fewer])).toBeNull();
  });

  it("returns null for empty tool list", () => {
    expect(matchingPresetName([])).toBeNull();
  });

  it("returns null for completely different tools", () => {
    expect(matchingPresetName(["sl_validate", "entity_details"])).toBeNull();
  });

  it("QA preset with one tool swapped returns null", () => {
    const swapped = [...READONLY_QA_PRESET.slice(0, 5), "sl_validate"];
    expect(matchingPresetName(swapped)).toBeNull();
  });
});

// ─── partitionGrantableTools ──────────────────────────────────────────────────

describe("partitionGrantableTools", () => {
  it("puts AbsoluteDeny tools into rejected", () => {
    const tools = ["lucy_query", "sl_query", "sl_read_source", "wiki_search"];
    const { grantable, rejected } = partitionGrantableTools(tools);
    expect(rejected).toContain("sl_query");
    expect(rejected).toContain("sl_read_source");
    expect(rejected).not.toContain("lucy_query");
    expect(rejected).not.toContain("wiki_search");
  });

  it("puts non-AbsoluteDeny tools into grantable", () => {
    const tools = ["lucy_query", "wiki_search", "lucy_catalog"];
    const { grantable, rejected } = partitionGrantableTools(tools);
    expect(grantable).toEqual(expect.arrayContaining(["lucy_query", "wiki_search", "lucy_catalog"]));
    expect(rejected).toHaveLength(0);
  });

  it("rejected contains only AbsoluteDeny (not other tools)", () => {
    const tools = ["lucy_query", "sl_query", "memory_ingest", "unknown_tool"];
    const { rejected } = partitionGrantableTools(tools);
    for (const t of rejected) {
      expect(ABSOLUTE_DENY_TOOL_NAMES).toContain(t);
    }
  });

  it("empty input returns empty arrays", () => {
    const { grantable, rejected } = partitionGrantableTools([]);
    expect(grantable).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it("all AbsoluteDeny tools go to rejected", () => {
    const { rejected } = partitionGrantableTools([...ABSOLUTE_DENY_TOOL_NAMES]);
    expect(new Set(rejected)).toEqual(new Set(ABSOLUTE_DENY_TOOL_NAMES));
  });
});

// ─── deriveConnections ────────────────────────────────────────────────────────

describe("deriveConnections", () => {
  it("names mode: deduplicates connections from table list", () => {
    const tables = [
      { connection: "rds-test", schema: "rds", name: "t1" },
      { connection: "rds-test", schema: "rds", name: "t2" },
      { connection: "mysql-main", schema: "dw", name: "t3" },
    ];
    const connections = deriveConnections(tables, "names");
    expect(connections).toHaveLength(2);
    expect(connections).toContain("rds-test");
    expect(connections).toContain("mysql-main");
  });

  it("names mode: returns empty array for no tables", () => {
    expect(deriveConnections([], "names")).toEqual([]);
  });

  it("catalog_bound mode: returns the provided catalog connections, ignoring tables", () => {
    const tables = [{ connection: "rds-test", schema: "rds", name: "t1" }];
    const catalogConnections = ["declared-conn-1", "declared-conn-2"];
    const result = deriveConnections(tables, "catalog_bound", catalogConnections);
    expect(result).toEqual(["declared-conn-1", "declared-conn-2"]);
  });

  it("catalog_bound mode with empty tables and catalog list returns catalog list", () => {
    const result = deriveConnections([], "catalog_bound", ["conn-a", "conn-b"]);
    expect(result).toEqual(["conn-a", "conn-b"]);
  });

  it("catalog_bound mode without catalog list returns empty (not derived from empty tree)", () => {
    const result = deriveConnections([], "catalog_bound");
    expect(result).toEqual([]);
  });

  it("prefix mode: deduplicates from tables (same as names)", () => {
    const tables = [
      { connection: "rds-test", schema: "rds", name: "t1" },
      { connection: "rds-test", schema: "rds", name: "t2" },
    ];
    expect(deriveConnections(tables, "prefix")).toEqual(["rds-test"]);
  });
});

// ─── groupTableGrants ─────────────────────────────────────────────────────────

describe("groupTableGrants", () => {
  it("groups same-connection same-schema all-row tables into one selector", () => {
    const tables = [
      { connection: "rds-test", schema: "rds_test", name: "table_a" },
      { connection: "rds-test", schema: "rds_test", name: "table_b" },
    ];
    const selectors = groupTableGrants(tables);
    expect(selectors).toHaveLength(1);
    expect(selectors[0].names).toEqual(expect.arrayContaining(["table_a", "table_b"]));
    expect(selectors[0].row_access).toBeUndefined();
    expect(selectors[0].row_policy).toBeUndefined();
  });

  it("splits tables with different row policies into separate selectors", () => {
    const tables = [
      { connection: "rds-test", schema: "rds_test", name: "table_a" },
      {
        connection: "rds-test",
        schema: "rds_test",
        name: "table_b",
        predicates: [{ field: "region", op: "eq" as const, value: "East" }],
      },
    ];
    const selectors = groupTableGrants(tables);
    expect(selectors).toHaveLength(2);

    const allRow = selectors.find((s) => !s.row_access);
    const scoped = selectors.find((s) => s.row_access === "scoped");
    expect(allRow).toBeTruthy();
    expect(allRow?.names).toContain("table_a");
    expect(scoped).toBeTruthy();
    expect(scoped?.names).toContain("table_b");
    expect(scoped?.row_policy?.predicates.some((p) => p.field === "region")).toBe(true);
  });

  it("all-row selector has no row_policy", () => {
    const tables = [{ connection: "c", schema: "s", name: "t1" }];
    const [sel] = groupTableGrants(tables);
    expect(sel.row_access).toBeUndefined();
    expect(sel.row_policy).toBeUndefined();
  });

  it("scoped selector writes row_access: scoped and row_policy", () => {
    const tables = [
      {
        connection: "c",
        schema: "s",
        name: "t1",
        predicates: [{ field: "region", op: "eq" as const, value: "East" }],
      },
    ];
    const [sel] = groupTableGrants(tables);
    expect(sel.row_access).toBe("scoped");
    expect(sel.row_policy).toBeDefined();
    expect(sel.row_policy?.predicates[0]).toMatchObject({
      sourceName: "t1",
      field: "region",
      op: "eq",
      value: "East",
    });
  });

  it("groups two same-schema same-policy tables into one scoped selector", () => {
    const pred = [{ field: "region", op: "eq" as const, value: "East" }];
    const tables = [
      { connection: "c", schema: "s", name: "t1", predicates: pred },
      { connection: "c", schema: "s", name: "t2", predicates: pred },
    ];
    const selectors = groupTableGrants(tables);
    expect(selectors).toHaveLength(1);
    expect(selectors[0].names).toHaveLength(2);
    // predicates should include both sourceName entries
    const sourceNames = selectors[0].row_policy?.predicates.map((p) => p.sourceName) ?? [];
    expect(sourceNames).toContain("t1");
    expect(sourceNames).toContain("t2");
  });

  it("stores op as eq/in (not 等于/属于)", () => {
    const tables = [
      {
        connection: "c",
        schema: "s",
        name: "t1",
        predicates: [{ field: "region", op: "in" as const, value: ["East", "West"] }],
      },
    ];
    const [sel] = groupTableGrants(tables);
    const pred = sel.row_policy?.predicates[0];
    expect(pred?.op).toBe("in");
    expect(pred?.values).toEqual(expect.arrayContaining(["East", "West"]));
  });
});

// ─── expansionNotice ──────────────────────────────────────────────────────────

describe("expansionNotice", () => {
  it("returns null for names mode", () => {
    expect(expansionNotice("names")).toBeNull();
  });

  it("returns correct string for prefix mode", () => {
    expect(expansionNotice("prefix")).toBe("此后同前缀的新表自动进入");
  });

  it("returns correct string for catalog_bound mode", () => {
    expect(expansionNotice("catalog_bound")).toBe(
      "已声明连接上，后续新启用的表自动进入，并走扩权审计"
    );
  });
});

// ─── buildEffectiveDigest ─────────────────────────────────────────────────────

describe("buildEffectiveDigest", () => {
  it("omits measure part when publishedMeasureCount is null", () => {
    const result = buildEffectiveDigest({
      connections: ["rds-test"],
      tableCount: 3,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
    });
    expect(result).not.toContain("已发布指标");
    expect(result).not.toContain("对应 0 个");
  });

  it("includes measure count when publishedMeasureCount is provided", () => {
    const result = buildEffectiveDigest({
      connections: ["rds-test"],
      tableCount: 3,
      publishedMeasureCount: 12,
      toolCount: 6,
      mode: "names",
    });
    expect(result).toContain("对应 12 个已发布指标");
  });

  it("never outputs 对应 0 个 even when count is zero", () => {
    // Note: publishedMeasureCount: 0 would output "对应 0 个已发布指标" which is valid (count known but zero).
    // The prohibition is only when count is null (unknown).
    const nullResult = buildEffectiveDigest({
      connections: ["c"],
      tableCount: 1,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
    });
    expect(nullResult).not.toContain("对应 0 个");
  });

  it("no row policies: outputs 已授权表均不限制行", () => {
    const result = buildEffectiveDigest({
      connections: ["rds-test"],
      tableCount: 3,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
    });
    expect(result).toContain("已授权表均不限制行。");
  });

  it("with row policy: outputs per-table policy sentence", () => {
    const result = buildEffectiveDigest({
      connections: ["rds-test"],
      tableCount: 3,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
      rowPolicies: [{ table: "ods_orders", field: "region", value: "East" }],
    });
    expect(result).toContain("ods_orders 已配置行级策略 region = East。");
    expect(result).toContain("lucy_query 强制注入过滤");
    expect(result).toContain("读定义、新鲜度、实体详情在该表上将被直接拒绝");
    expect(result).toContain("解释查询不取数，只返回本地安全说明。");
  });

  it("with policies: other tables get 其余 N 张表不限制行", () => {
    const result = buildEffectiveDigest({
      connections: ["rds-test"],
      tableCount: 3,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
      rowPolicies: [{ table: "ods_orders", field: "region", value: "East" }],
    });
    expect(result).toContain("其余 2 张表不限制行。");
  });

  it("always outputs the system boundary sentence", () => {
    const result = buildEffectiveDigest({
      connections: ["c"],
      tableCount: 1,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
    });
    expect(result).toContain(
      "原始 SQL、旧版 sl_query / sl_read_source、记忆注入属于系统禁止能力，不可授予。"
    );
  });

  it("names mode: no expansion notice appended", () => {
    const result = buildEffectiveDigest({
      connections: ["c"],
      tableCount: 1,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "names",
    });
    expect(result).not.toContain("此后同前缀");
    expect(result).not.toContain("后续新启用的表");
  });

  it("prefix mode: appends expansion notice to asset sentence", () => {
    const result = buildEffectiveDigest({
      connections: ["c"],
      tableCount: 1,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "prefix",
    });
    expect(result).toContain("此后同前缀的新表自动进入");
  });

  it("catalog_bound mode: appends catalog expansion notice to asset sentence", () => {
    const result = buildEffectiveDigest({
      connections: ["c"],
      tableCount: 1,
      publishedMeasureCount: null,
      toolCount: 6,
      mode: "catalog_bound",
    });
    expect(result).toContain("已声明连接上，后续新启用的表自动进入，并走扩权审计");
  });
});
