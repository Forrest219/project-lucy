import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_DENY_TOOL_NAMES,
  READONLY_QA_PRESET,
  READONLY_QA_WIKI_PRESET,
  buildEffectiveDigest,
  buildTableAllow,
  deriveConnections,
  derivePermissionImpact,
  expansionNotice,
  groupTableGrants,
  matchingPresetName,
  normalizeRolePermissionDraft,
  partitionGrantableTools,
  rolePermissionDraftHash,
  stampPreset,
  type RolePermissionDraft,
  type TableGrant,
} from "../lib/rolePermissionDraft";

describe("Role permission draft helpers", () => {
  it("keeps the six AbsoluteDeny tools and partitions them", () => {
    expect(ABSOLUTE_DENY_TOOL_NAMES).toHaveLength(6);
    expect(partitionGrantableTools(["sl_query", "lucy_query", "memory_ingest"])).toEqual({
      grantable: ["lucy_query"],
      rejected: ["sl_query", "memory_ingest"],
    });
  });

  it("stamps presets as replacement and detects exact matches", () => {
    expect(stampPreset(["sl_validate"], READONLY_QA_PRESET)).toEqual([...READONLY_QA_PRESET]);
    expect(matchingPresetName([...READONLY_QA_PRESET])).toBe("只读问答");
    expect(matchingPresetName([...READONLY_QA_WIKI_PRESET].reverse())).toBe("只读问答 + 知识库");
    expect(matchingPresetName(["lucy_query"])).toBeNull();
  });

  it("derives connections and groups same-policy tables", () => {
    const tables: TableGrant[] = [
      { connection: "c", schema: "s", name: "a" },
      { connection: "c", schema: "s", name: "b" },
      { connection: "d", schema: "x", name: "z", predicates: [{ field: "region", op: "eq", value: "East" }] },
    ];
    expect(deriveConnections(tables, "names")).toEqual(["c", "d"]);
    const grouped = groupTableGrants(tables);
    expect(grouped).toHaveLength(2);
    expect(grouped.find((selector) => selector.connection === "c")?.names).toEqual(["a", "b"]);
    expect(grouped.find((selector) => selector.connection === "d")?.row_access).toBe("scoped");
  });

  it("serializes names and catalog_bound without any prefix surface", () => {
    const names = buildTableAllow({ mode: "names", tables: [{ connection: "c", schema: "s", name: "a" }] });
    expect(names.connections).toEqual(["c"]);
    expect(names.tableSelectors?.[0]).toMatchObject({ connection: "c", schema: "s", names: ["a"], row_access: "all" });
    expect(JSON.stringify(names)).not.toContain("prefix");

    const catalog = buildTableAllow({ mode: "catalog_bound", tables: [], manualConnections: ["c"] });
    expect(catalog).toEqual({ connections: ["c"], source_scope: "catalog_bound" });
    expect(expansionNotice("names")).toBeNull();
    expect(expansionNotice("catalog_bound")).toContain("扩权审计");
  });

  it("normalizes order, in values and creates a stable semantic hash", () => {
    const first: RolePermissionDraft = {
      roleId: " role ",
      description: " desc ",
      scope: {
        mode: "names",
        tables: [{ connection: "c", schema: "s", name: "a", predicates: [{ field: " region ", op: "in", value: ["West", "East", "East"] }] }],
      },
      tools: ["wiki_read", "lucy_query", "lucy_query"],
    };
    const second: RolePermissionDraft = {
      roleId: "role",
      description: "desc",
      scope: {
        mode: "names",
        tables: [{ connection: "c", schema: "s", name: "a", predicates: [{ field: "region", op: "in", value: ["East", "West"] }] }],
      },
      tools: ["lucy_query", "wiki_read"],
    };
    expect(normalizeRolePermissionDraft(first)).toEqual(normalizeRolePermissionDraft(second));
    expect(rolePermissionDraftHash(first)).toBe(rolePermissionDraftHash(second));
  });

  it("derives expansion, contraction, row policy and catalog-bound impacts", () => {
    const baseline: RolePermissionDraft = {
      roleId: "role",
      description: "",
      scope: { mode: "names", tables: [{ connection: "c", schema: "s", name: "a" }] },
      tools: ["lucy_query", "sl_query"],
    };
    const next: RolePermissionDraft = {
      roleId: "role",
      description: "",
      scope: { mode: "names", tables: [{ connection: "c", schema: "s", name: "a", predicates: [{ field: "region", op: "eq", value: "East" }] }, { connection: "c", schema: "s", name: "b" }] },
      tools: ["lucy_query", "wiki_read"],
    };
    expect(derivePermissionImpact(baseline, next, ["sl_query"], [{ id: "agent-1", name: "Agent 1", enabled: true, tokenCount: 1 }])).toEqual(expect.objectContaining({
      tablesAdded: ["c/s/b"],
      toolsAdded: ["wiki_read"],
      toolsRemoved: ["sl_query"],
      rowPoliciesChanged: ["c/s/a"],
      rejectedToolsRemoved: ["sl_query"],
      risk: "mixed",
      affectedAgents: [{ id: "agent-1", name: "Agent 1", enabled: true, tokenCount: 1 }],
    }));
    expect(derivePermissionImpact(next, { ...next, scope: { mode: "catalog_bound", connections: ["c"] } }).catalogBoundChange).toBe("enabled");
    const restricted = { ...baseline, scope: { mode: "names" as const, tables: [{ connection: "c", schema: "s", name: "a", predicates: [{ field: "region", op: "eq" as const, value: "East" }] }] } };
    expect(derivePermissionImpact(baseline, restricted).risk).toBe("contracted");
    expect(derivePermissionImpact(restricted, baseline).risk).toBe("expanded");
  });

  it("builds the effective digest with protected-table warnings", () => {
    const digest = buildEffectiveDigest({
      connections: ["c"],
      tableCount: 2,
      publishedMeasureCount: null,
      toolCount: 1,
      mode: "names",
      rowPolicies: [{ table: "orders", field: "region", value: "East" }],
    });
    expect(digest).toContain("包含 2 张表");
    expect(digest).toContain("orders 已配置行级策略");
    expect(digest).toContain("系统禁止能力");
  });
});
