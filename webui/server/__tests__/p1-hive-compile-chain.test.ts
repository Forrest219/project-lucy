/**
 * P1-4 Hive 直连（编译侧）— 端到端编译链。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.3、§4.2、§4.3
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H3–H6）
 *
 * 这条用例把编译侧真正串起来：来源闭包 → 请求规范化 → 服务端强制行策略 →
 * 只编译桥 → 严格 AST 检查。它证明的是「编译侧自洽」，不证明 HS2 可执行。
 */
import { describe, expect, it } from "vitest";
import {
  buildHiveSourceClosure,
  toCompilerSources,
  type HivePublishedGeneration
} from "../hive/source-closure";
import {
  bindHiveQuerySources,
  buildHiveCompilerQuery,
  buildHiveForcedFilters,
  normalizeHiveQueryArgs
} from "../hive/row-policy";
import { checkHiveSql } from "../hive/ast-check";
import { compileHiveQuery, type HiveSpawner } from "../hive/compile-bridge";
import type { RowGrant } from "../proxy/row-policy";

const GENERATION: HivePublishedGeneration = {
  connectionId: "prod_hive",
  manifests: [
    {
      schema: "finance",
      tables: {
        finance_orders: {
          table: "finance.orders",
          columns: [
            { name: "order_id", type: "bigint", pk: true },
            { name: "tenant_id", type: "varchar" },
            { name: "region", type: "varchar" },
            { name: "amount", type: "decimal" },
            { name: "internal_note", type: "varchar" }
          ]
        }
      }
    }
  ],
  overlays: [
    {
      fileName: "finance_orders.yaml",
      document: {
        name: "finance_orders",
        grain: ["order_id"],
        // An existing manifest column is patched through column_overrides;
        // a new column would go into `columns` (the KTX overlay contract).
        column_overrides: [{ name: "internal_note", visibility: "hidden" }],
        measures: [{ name: "revenue", expr: "sum(finance_orders.amount)" }]
      }
    }
  ],
  enabledTables: ["finance.orders"],
  generation: "gen-integration"
};

const GRANT: RowGrant = {
  kind: "scoped",
  digest: "digest-integration",
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

function spawnerReturning(sql: string): HiveSpawner {
  return () => {
    let stdoutListener: ((chunk: Buffer) => void) | undefined;
    let closeListener: ((code: number | null, signal: string | null) => void) | undefined;
    let stdin = "";
    return {
      write: (payload) => {
        stdin += payload;
      },
      end: () => {
        void stdin;
        queueMicrotask(() => {
          stdoutListener?.(
            Buffer.from(
              JSON.stringify({ sql, dialect: "hive", columns: [], plan: { sources_used: [] } }),
              "utf8"
            )
          );
          closeListener?.(0, null);
        });
      },
      onStdout: (listener) => {
        stdoutListener = listener;
      },
      onStderr: () => {},
      onClose: (listener) => {
        closeListener = listener;
      },
      onError: () => {},
      kill: () => {}
    };
  };
}

describe("编译侧端到端链路", () => {
  it("来源闭包 → 强制行策略 → 编译 → AST 检查：合法链路通过", async () => {
    const closure = buildHiveSourceClosure(GENERATION);
    expect(closure.ok).toBe(true);
    if (!closure.ok) return;

    const normalized = normalizeHiveQueryArgs({
      measures: ["orders.revenue"],
      filters: [{ field: "orders.status", op: "eq", value: "SETTLED" }]
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const bound = bindHiveQuerySources(normalized.request, {
      sourceNameByLogicalName: new Map([["orders", "finance_orders"]])
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const forced = buildHiveForcedFilters({
      grant: GRANT,
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

    // 编译请求里带上了强制谓词，且没有 forced_filters 字段。
    expect(assembled.query.filters[0]).toBe(
      "(finance_orders.tenant_id = 'A' AND finance_orders.region = 'APAC')"
    );
    expect("forced_filters" in assembled.query).toBe(false);

    const compiledSql = `SELECT SUM(finance_orders.amount) AS revenue
FROM finance.orders AS finance_orders
WHERE (finance_orders.tenant_id = 'A' AND finance_orders.region = 'APAC')
  AND finance_orders.status = 'SETTLED'
LIMIT 100`;

    const compiled = await compileHiveQuery({
      sources: toCompilerSources(closure.value.sources),
      query: assembled.query as unknown as Record<string, unknown>,
      policy: { predefinedMeasuresOnly: true, maxLimit: 1000 },
      daemon: { command: "/opt/ktx/ktx-daemon", args: [] },
      spawner: spawnerReturning(compiledSql)
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const checked = checkHiveSql({
      sql: compiled.sql,
      allowedPhysicalTables: closure.value.physicalTables,
      sourceAliasToPhysical: closure.value.physicalTableBySourceName,
      hiddenColumns: new Set(closure.value.hiddenColumnsBySourceName.get("finance_orders")),
      maxLimit: 1000,
      requiredPredicates: assembled.requiredPredicates
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.physicalTables).toEqual(["finance.orders"]);
  });

  it("编译结果丢掉强制谓词时，AST 检查拒绝，不向 JDBC 分派", async () => {
    const closure = buildHiveSourceClosure(GENERATION);
    expect(closure.ok).toBe(true);
    if (!closure.ok) return;

    const normalized = normalizeHiveQueryArgs({ measures: ["orders.revenue"] });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const bound = bindHiveQuerySources(normalized.request, {
      sourceNameByLogicalName: new Map([["orders", "finance_orders"]])
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const forced = buildHiveForcedFilters({
      grant: GRANT,
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

    // 模拟一个"丢了强制谓词"的编译结果。
    const compiled = await compileHiveQuery({
      sources: toCompilerSources(closure.value.sources),
      query: assembled.query as unknown as Record<string, unknown>,
      policy: { predefinedMeasuresOnly: true, maxLimit: 1000 },
      daemon: { command: "/opt/ktx/ktx-daemon", args: [] },
      spawner: spawnerReturning(
        "SELECT SUM(finance_orders.amount) AS revenue FROM finance.orders AS finance_orders LIMIT 100"
      )
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const checked = checkHiveSql({
      sql: compiled.sql,
      allowedPhysicalTables: closure.value.physicalTables,
      sourceAliasToPhysical: closure.value.physicalTableBySourceName,
      hiddenColumns: new Set(closure.value.hiddenColumnsBySourceName.get("finance_orders")),
      maxLimit: 1000,
      requiredPredicates: assembled.requiredPredicates
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.reason).toBe("hive_sql_forced_predicate_missing");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-4 §7 验收矩阵 — 按编号命名的用例（V05）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.3（语义资产
 *     与来源闭包）、§4.3.3（行策略与 SQL 安全）、§4.3.5（严格 AST）、
 *     §7（验收矩阵 V05 的通过标准）
 *
 * V05：JOIN、fan-out、CTE、sql source —— 来源闭包与列血缘正确、聚合不膨胀；
 *       不支持形态明确拒绝。
 *
 * 「聚合不膨胀」在本轮的可验证形态是 §4.3.4 的守门：受保护的 JOIN 源必须
 * 在聚合前被证明受约束，否则整条语句不向 JDBC 分派。
 * ─────────────────────────────────────────────────────────────────────────────
 */

const JOIN_GENERATION: HivePublishedGeneration = {
  connectionId: "prod_hive",
  manifests: [
    {
      schema: "finance",
      tables: {
        finance_orders: {
          table: "finance.orders",
          columns: [
            { name: "order_id", type: "bigint", pk: true },
            { name: "customer_id", type: "bigint" },
            { name: "tenant_id", type: "varchar" },
            { name: "amount", type: "decimal" }
          ],
          joins: [
            {
              to: "finance_customers",
              on: "finance_orders.customer_id = finance_customers.customer_id",
              relationship: "many_to_one"
            }
          ]
        },
        finance_customers: {
          table: "finance.customers",
          columns: [
            { name: "customer_id", type: "bigint", pk: true },
            { name: "region", type: "varchar" }
          ]
        }
      }
    }
  ],
  overlays: [],
  enabledTables: ["finance.orders", "finance.customers"],
  generation: "gen-join"
};

const SQL_GENERATION: HivePublishedGeneration = {
  connectionId: "prod_hive",
  manifests: [
    {
      schema: "finance",
      tables: {
        finance_orders: {
          table: "finance.orders",
          columns: [
            { name: "order_id", type: "bigint", pk: true },
            { name: "amount", type: "decimal" }
          ]
        }
      }
    }
  ],
  overlays: [
    {
      fileName: "finance_events.yaml",
      document: {
        name: "finance_events",
        sql: "WITH base AS (SELECT order_id, amount FROM finance.orders) SELECT order_id FROM base",
        grain: ["order_id"],
        columns: [{ name: "order_id", type: "bigint" }]
      }
    }
  ],
  enabledTables: ["finance.orders"],
  generation: "gen-sql"
};

describe("P1-4 §7 — V05 JOIN／fan-out／CTE／sql source", () => {
  it("V05 — JOIN 与 sql source 的物理依赖进入来源闭包；CTE 名不误作物表；越界与聚合前未受约束的形态明确拒绝", () => {
    // ① JOIN 目标进入来源闭包，关系（fan-out 语义）随闭包保留。
    const joined = buildHiveSourceClosure(JOIN_GENERATION);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const orders = joined.value.sources.find((source) => source.name === "finance_orders")!;
    expect(orders.joins).toHaveLength(1);
    expect(orders.joins[0]!.to).toBe("finance_customers");
    expect(orders.joins[0]!.relationship).toBe("many_to_one");
    expect(joined.value.sources.some((source) => source.name === "finance_customers")).toBe(true);
    expect(joined.value.physicalTables).toContain("finance.customers");

    // 编译载荷里 join 的关系也不丢（否则「聚合是否膨胀」无人可判）。
    const payload = toCompilerSources(joined.value.sources);
    const payloadOrders = payload.find((source) => source.name === "finance_orders")!;
    expect(payloadOrders.joins).toEqual([
      {
        to: "finance_customers",
        on: "finance_orders.customer_id = finance_customers.customer_id",
        relationship: "many_to_one"
      }
    ]);

    // ② sql: source 的物理依赖被展开；CTE 名只登记为 CTE，不误作物表。
    const fromSql = buildHiveSourceClosure(SQL_GENERATION);
    expect(fromSql.ok).toBe(true);
    if (!fromSql.ok) return;
    expect(fromSql.value.physicalTables).toContain("finance.orders");
    expect(fromSql.value.physicalTables).not.toContain("base");
    expect(fromSql.value.cteNames).toContain("base");

    // ③ CTE 引用展开为它真正读的物理表（CTE 名不得出现在物理依赖里）。
    const cteCheck = checkHiveSql({
      sql: `WITH recent AS (SELECT order_id, amount FROM finance.orders)
            SELECT recent.amount FROM recent LIMIT 10`,
      allowedPhysicalTables: joined.value.physicalTables,
      sourceAliasToPhysical: joined.value.physicalTableBySourceName,
      maxLimit: 1000
    });
    expect(cteCheck.ok).toBe(true);
    if (!cteCheck.ok) return;
    expect(cteCheck.physicalTables).toEqual(["finance.orders"]);
    expect(cteCheck.physicalTables).not.toContain("recent");

    // ④ 不支持形态明确拒绝：JOIN 引入闭包外的表 → 依赖不匹配，不向 JDBC 分派。
    const outside = checkHiveSql({
      sql: `SELECT finance_orders.amount FROM finance.orders AS finance_orders
            JOIN finance.secret_customers AS finance_customers
              ON finance_orders.customer_id = finance_customers.customer_id
            LIMIT 10`,
      allowedPhysicalTables: joined.value.physicalTables,
      sourceAliasToPhysical: joined.value.physicalTableBySourceName,
      maxLimit: 1000
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.reason).toBe("hive_sql_dependency_not_allowed");

    // ⑤ 聚合不膨胀的守门：受保护的 JOIN 源未在聚合前被约束 → 整条语句拒绝。
    const unguarded = checkHiveSql({
      sql: `SELECT SUM(finance_orders.amount) AS revenue
            FROM finance.orders AS finance_orders
            JOIN finance.customers AS finance_customers
              ON finance_orders.customer_id = finance_customers.customer_id
            GROUP BY finance_orders.tenant_id
            LIMIT 100`,
      allowedPhysicalTables: joined.value.physicalTables,
      sourceAliasToPhysical: joined.value.physicalTableBySourceName,
      maxLimit: 1000,
      requiredPredicates: [
        { expression: "finance_customers.region = 'APAC'", sourceAlias: "finance_customers" }
      ]
    });
    expect(unguarded.ok).toBe(false);
    if (unguarded.ok) return;
    expect(unguarded.reason).toBe("hive_sql_forced_predicate_missing");
  });
});
