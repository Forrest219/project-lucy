/**
 * P1-4 Hive 直连（编译侧）— H6 强制行策略转换。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.3.2
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H6）
 */
import { describe, expect, it } from "vitest";
import {
  bindHiveQuerySources,
  buildHiveCompilerQuery,
  buildHiveForcedFilters,
  hiveScopeContradiction,
  normalizeHiveQueryArgs,
  stripClientPolicyOverrides
} from "../hive/row-policy";
import { buildForcedFiltersPayload, type RowGrant } from "../proxy/row-policy";

/** One Role, one AND group. */
const singleArmGrant: RowGrant = {
  kind: "scoped",
  digest: "digest-a",
  predicates: [
    { field: "tenant_id", sourceName: "orders", op: "eq", value: "A" },
    { field: "region", sourceName: "orders", op: "eq", value: "APAC" }
  ],
  orArms: [
    [
      { field: "tenant_id", sourceName: "orders", op: "eq", value: "A" },
      { field: "region", sourceName: "orders", op: "eq", value: "APAC" }
    ]
  ]
};

/** Two Roles → two OR arms. */
const twoRoleGrant: RowGrant = {
  kind: "scoped",
  digest: "digest-b",
  predicates: [
    { field: "tenant_id", sourceName: "orders", op: "eq", value: "A" }
  ],
  orArms: [
    [{ field: "tenant_id", sourceName: "orders", op: "eq", value: "A" }],
    [{ field: "tenant_id", sourceName: "orders", op: "eq", value: "B" }]
  ]
};

const BINDING = new Map([["orders", "finance_orders"]]);

describe("H6 强制行策略转换", () => {
  it("客户端提供的策略覆盖字段被剥离", () => {
    const stripped = stripClientPolicyOverrides({
      measures: ["orders.revenue"],
      forced_filters: { or: [{ and: [{ field: "orders.tenant_id", op: "eq", value: "Z" }] }] },
      forcedFilters: { or: [] },
      predefined_measures_only: false,
      row_policy: { predicates: [] }
    });
    expect(stripped.forced_filters).toBeUndefined();
    expect(stripped.forcedFilters).toBeUndefined();
    expect(stripped.predefined_measures_only).toBeUndefined();
    expect(stripped.row_policy).toBeUndefined();
    expect(stripped.measures).toEqual(["orders.revenue"]);
  });

  it("规范化阶段也把伪造的覆盖字段去掉", () => {
    const normalized = normalizeHiveQueryArgs({
      measures: ["orders.revenue"],
      forced_filters: { or: [] },
      predefined_measures_only: false
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.args.forced_filters).toBeUndefined();
    expect(normalized.args.predefined_measures_only).toBeUndefined();
    expect(normalized.request.measures).toEqual(["orders.revenue"]);
  });

  it("服务端强制谓词被转换成 filters[]，不依赖 forced_filters 字段", () => {
    const forced = buildHiveForcedFilters({
      grant: singleArmGrant,
      logicalSourceName: "orders",
      ktxSourceName: "finance_orders"
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.forced.filters).toEqual([
      "(finance_orders.tenant_id = 'A' AND finance_orders.region = 'APAC')"
    ]);
    expect(forced.forced.digests).toEqual(["digest-a"]);
    // 产物里没有 forced_filters 这种字段。
    expect(JSON.stringify(forced.forced)).not.toContain("forced_filters");
  });

  it("Role 间 OR、Role 内 AND 的代数被保留", () => {
    const forced = buildHiveForcedFilters({
      grant: twoRoleGrant,
      logicalSourceName: "orders",
      ktxSourceName: "finance_orders"
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.forced.filters).toEqual([
      "((finance_orders.tenant_id = 'A') OR (finance_orders.tenant_id = 'B'))"
    ]);
  });

  it("TRUE 授予不产生强制过滤", () => {
    const forced = buildHiveForcedFilters({
      grant: { kind: "all" },
      logicalSourceName: "orders",
      ktxSourceName: "finance_orders"
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.forced.filters).toEqual([]);
  });

  it("受限授予但生成不出谓词时失败关闭，不当成没有限制", () => {
    const forced = buildHiveForcedFilters({
      grant: {
        kind: "scoped",
        digest: "digest-c",
        predicates: [],
        orArms: []
      },
      logicalSourceName: "orders",
      ktxSourceName: "finance_orders"
    });
    expect(forced.ok).toBe(false);
    if (forced.ok) return;
    expect(forced.reason).toBe("row_policy_forced_filters_empty");
  });

  it("来源绑定：请求提到未授权来源时拒绝", () => {
    const normalized = normalizeHiveQueryArgs({ measures: ["secret.revenue"] });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const bound = bindHiveQuerySources(normalized.request, {
      sourceNameByLogicalName: BINDING
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.reason).toBe("hive_source_not_bound:secret");
  });

  it("组装后的编译查询把来源改写成 KTX 源名，强制谓词排在 filters[] 首位", () => {
    const normalized = normalizeHiveQueryArgs({
      measures: ["orders.revenue"],
      dimensions: [{ field: "orders.region" }],
      filters: [{ field: "orders.status", op: "eq", value: "SETTLED" }]
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const bound = bindHiveQuerySources(normalized.request, {
      sourceNameByLogicalName: BINDING
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const forced = buildHiveForcedFilters({
      grant: singleArmGrant,
      logicalSourceName: "orders",
      ktxSourceName: "finance_orders"
    });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;

    const assembled = buildHiveCompilerQuery({
      request: normalized.request,
      bindings: bound.bindings,
      forced: forced.forced,
      maxLimit: 1000
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    expect(assembled.query.measures).toEqual(["finance_orders.revenue"]);
    expect(assembled.query.dimensions).toEqual([{ field: "finance_orders.region" }]);
    expect(assembled.query.filters).toEqual([
      "(finance_orders.tenant_id = 'A' AND finance_orders.region = 'APAC')",
      "finance_orders.status = 'SETTLED'"
    ]);
    // 编译查询里没有 forced_filters 字段。
    expect("forced_filters" in assembled.query).toBe(false);
    // AST 检查要证明的谓词。
    expect(assembled.requiredPredicates).toEqual([
      {
        expression: "(finance_orders.tenant_id = 'A' AND finance_orders.region = 'APAC')",
        sourceAlias: "finance_orders"
      }
    ]);
  });

  it("客户端的 eq/in 过滤与强制范围矛盾时识别为矛盾，不等成空结果", () => {
    const normalized = normalizeHiveQueryArgs({
      measures: ["orders.revenue"],
      filters: [{ field: "orders.tenant_id", op: "eq", value: "B" }]
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const payload = buildForcedFiltersPayload(singleArmGrant, "orders");
    expect(payload).toBeDefined();
    expect(hiveScopeContradiction(normalized.request, payload)).toBe(true);

    const compatible = normalizeHiveQueryArgs({
      measures: ["orders.revenue"],
      filters: [{ field: "orders.tenant_id", op: "eq", value: "A" }]
    });
    expect(compatible.ok).toBe(true);
    if (!compatible.ok) return;
    expect(hiveScopeContradiction(compatible.request, payload)).toBe(false);
  });

  it("现有 shape gate 仍然生效：原始 SQL 过滤串被拒绝", () => {
    const normalized = normalizeHiveQueryArgs({
      measures: ["orders.revenue"],
      filters: ["orders.tenant_id = 'A'"]
    });
    expect(normalized.ok).toBe(false);
    if (normalized.ok) return;
    expect(normalized.reason).toContain("filters_string_forbidden");
  });

  it("字符串形态的客户端过滤在组装层也被拒绝，不进入计算层", () => {
    const assembled = buildHiveCompilerQuery({
      request: {
        measures: ["orders.revenue"],
        dimensions: [],
        // 绕过规范化直接送进来的原始 SQL 片段。
        filters: ["orders.tenant_id = 'A' OR 1 = 1"],
        segments: [],
        order_by: [],
        include_empty: true
      },
      bindings: BINDING,
      forced: { filters: [], digests: [] },
      maxLimit: 1000
    });
    expect(assembled.ok).toBe(false);
    if (assembled.ok) return;
    // 失败原因码清晰：字符串形态的过滤器被禁止。
    expect(assembled.reason).toBe("hive_filter_string_forbidden");
    // 片段不得出现在任何产物里。
    expect(JSON.stringify(assembled)).not.toContain("1 = 1");
  });

  it("字符串过滤器不会绕过强制谓词：请求被拒而不是被放宽", () => {
    const assembled = buildHiveCompilerQuery({
      request: {
        measures: ["orders.revenue"],
        dimensions: [],
        filters: ["1 = 1"],
        segments: [],
        order_by: [],
        include_empty: true
      },
      bindings: BINDING,
      forced: { filters: ["(finance_orders.tenant_id = 'A')"], digests: ["digest-a"], sourceAlias: "finance_orders" },
      maxLimit: 1000
    });
    expect(assembled.ok).toBe(false);
    if (assembled.ok) return;
    expect(assembled.reason).toBe("hive_filter_string_forbidden");
  });
});
