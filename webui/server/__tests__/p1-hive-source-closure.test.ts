/**
 * P1-4 Hive 直连（编译侧）— H3 来源闭包构建器。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.3
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H3）
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHiveSourceClosure,
  readHivePublishedGeneration,
  sqlSourcePhysicalTables,
  toCompilerSources,
  type HivePublishedGeneration
} from "../hive/source-closure";
import { invalidateContentPathsCache } from "../paths";

const FINANCE_MANIFEST = {
  finance_orders: {
    table: "finance.orders",
    descriptions: { human: "订单明细" },
    columns: [
      { name: "order_id", type: "bigint", pk: true },
      { name: "customer_id", type: "bigint" },
      { name: "tenant_id", type: "varchar" },
      { name: "status", type: "varchar" },
      { name: "amount", type: "decimal" },
      { name: "created_at", type: "timestamp" },
      { name: "internal_note", type: "varchar" }
    ],
    joins: [
      {
        to: "finance_customers",
        on: "finance_orders.customer_id = finance_customers.customer_id",
        relationship: "many_to_one"
      }
    ]
  }
};

const CUSTOMERS_MANIFEST = {
  finance_customers: {
    table: "finance.customers",
    columns: [
      { name: "customer_id", type: "bigint", pk: true },
      { name: "region", type: "varchar" }
    ]
  }
};

function generation(overrides: Partial<HivePublishedGeneration> = {}): HivePublishedGeneration {
  return {
    connectionId: "prod_hive",
    manifests: [
      { schema: "finance", tables: FINANCE_MANIFEST },
      { schema: "finance", tables: CUSTOMERS_MANIFEST }
    ],
    overlays: [],
    enabledTables: ["finance.orders", "finance.customers"],
    generation: "gen-test",
    ...overrides
  };
}

describe("H3 来源闭包构建器", () => {
  it("保留 grain、列覆盖、派生列、排除列、segments、joins 与隐藏可见性", () => {
    const built = buildHiveSourceClosure(
      generation({
        overlays: [
          {
            fileName: "finance_orders.yaml",
            document: {
              name: "finance_orders",
              grain: ["order_id", "tenant_id"],
              exclude_columns: ["internal_note"],
              column_overrides: [{ name: "amount", descriptions: { human: "订单金额" } }],
              columns: [
                {
                  name: "order_month",
                  type: "string",
                  expr: "date_format(finance_orders.created_at, 'yyyy-MM')"
                },
                {
                  name: "secret_token",
                  type: "string",
                  expr: "'x'",
                  visibility: "hidden"
                }
              ],
              measures: [{ name: "revenue", expr: "sum(finance_orders.amount)" }],
              segments: [{ name: "settled", expr: "finance_orders.status = 'SETTLED'" }]
            }
          }
        ]
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const orders = built.value.sources.find((source) => source.name === "finance_orders")!;
    expect(orders.grain).toEqual(["order_id", "tenant_id"]);
    expect(orders.measures.map((measure) => measure.name)).toEqual(["revenue"]);
    expect(orders.segments.map((segment) => segment.name)).toEqual(["settled"]);
    expect(orders.joins.map((join) => join.to)).toEqual(["finance_customers"]);
    // 排除列真的消失了，派生列真的加进来了。
    expect(orders.columns.some((column) => column.name === "internal_note")).toBe(false);
    expect(orders.columns.some((column) => column.name === "order_month")).toBe(true);
    // 列覆盖生效。
    expect(orders.columns.find((column) => column.name === "amount")?.description).toBe("订单金额");
    // 隐藏列被记录，供 AST 检查使用。
    expect(built.value.hiddenColumnsBySourceName.get("finance_orders")).toEqual(["secret_token"]);
    // 类型映射到计算层契约。
    expect(orders.columns.find((column) => column.name === "amount")?.type).toBe("number");
    expect(orders.columns.find((column) => column.name === "created_at")?.type).toBe("time");
    expect(orders.columns.find((column) => column.name === "created_at")?.role).toBe("time");
  });

  it("跨 database 同名表不合并：规范源键包含连接与 Schema", () => {
    const built = buildHiveSourceClosure(
      generation({
        manifests: [
          {
            schema: "finance",
            tables: {
              finance_orders: {
                table: "finance.orders",
                columns: [{ name: "order_id", type: "bigint", pk: true }]
              }
            }
          },
          {
            schema: "sales",
            tables: {
              sales_orders: {
                table: "sales.orders",
                columns: [{ name: "order_id", type: "bigint", pk: true }]
              }
            }
          }
        ],
        enabledTables: ["finance.orders", "sales.orders"]
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.sources.map((source) => source.name).sort()).toEqual([
      "finance_orders",
      "sales_orders"
    ]);
    expect(built.value.sourceNameByCanonicalKey.get("prod_hive/finance/orders")).toBe("finance_orders");
    expect(built.value.sourceNameByCanonicalKey.get("prod_hive/sales/orders")).toBe("sales_orders");
    expect(built.value.physicalTables).toEqual(["finance.orders", "sales.orders"]);
  });

  it("重复名称显式报错", () => {
    const built = buildHiveSourceClosure(
      generation({
        manifests: [
          {
            schema: "a_b",
            tables: {
              a_b_c: { table: "a_b.c", columns: [{ name: "id", type: "bigint", pk: true }] }
            }
          },
          {
            schema: "a",
            tables: {
              a_b_c: { table: "a.b_c", columns: [{ name: "id", type: "bigint", pk: true }] }
            }
          }
        ],
        enabledTables: []
      })
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hive_source_duplicate_name");
  });

  it("孤立 overlay 显式报错（不静默跳过）", () => {
    const built = buildHiveSourceClosure(
      generation({
        overlays: [
          {
            fileName: "finance_orders.yaml",
            document: { name: "finance_orders", grain: ["order_id"] }
          },
          {
            fileName: "ghost.yaml",
            document: { name: "finance_ghost", grain: ["id"] }
          }
        ]
      })
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hive_source_orphan_overlay");
    expect(built.detail).toContain("finance_ghost");
  });

  it("缺失 join 目标显式报错", () => {
    const built = buildHiveSourceClosure(
      generation({
        manifests: [
          {
            schema: "finance",
            tables: {
              finance_orders: {
                table: "finance.orders",
                columns: [{ name: "order_id", type: "bigint", pk: true }],
                joins: [
                  {
                    to: "finance_missing",
                    on: "finance_orders.x = finance_missing.x",
                    relationship: "many_to_one"
                  }
                ]
              }
            }
          }
        ],
        enabledTables: ["finance.orders"]
      })
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hive_source_missing_join_target");
  });

  it("未知引用显式报错：grain、measure filter、派生列", () => {
    const badGrain = buildHiveSourceClosure(
      generation({
        overlays: [
          {
            fileName: "finance_orders.yaml",
            document: { name: "finance_orders", grain: ["not_a_column"] }
          }
        ]
      })
    );
    expect(badGrain.ok).toBe(false);
    if (badGrain.ok) return;
    expect(badGrain.reason).toBe("hive_source_unknown_reference");

    const badMeasure = buildHiveSourceClosure(
      generation({
        overlays: [
          {
            fileName: "finance_orders.yaml",
            document: {
              name: "finance_orders",
              measures: [
                { name: "revenue", expr: "sum(finance_orders.amount)", filter: "missing_col = 'x'" }
              ]
            }
          }
        ]
      })
    );
    expect(badMeasure.ok).toBe(false);
    if (badMeasure.ok) return;
    expect(badMeasure.reason).toBe("hive_source_unknown_reference");
  });

  it("物理依赖超出启用表范围时显式报错", () => {
    const built = buildHiveSourceClosure(
      generation({ enabledTables: ["finance.customers"] })
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hive_source_dependency_not_allowed");
  });

  it("Manifest 键必须遵循 <schema>_<table> 命名，否则显式报错", () => {
    const built = buildHiveSourceClosure(
      generation({
        manifests: [
          {
            schema: "finance",
            tables: {
              orders: {
                table: "finance.orders",
                columns: [{ name: "order_id", type: "bigint", pk: true }]
              }
            }
          }
        ]
      })
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hive_source_name_mismatch");
  });
});

describe("H3 sql: source 的依赖展开", () => {
  it("CTE 名不误作物表：CTE 只登记为 CTE，物理表照常展开", () => {
    const dependency = sqlSourcePhysicalTables(`
WITH recent AS (
  SELECT order_id, tenant_id FROM finance.orders
)
SELECT r.order_id FROM recent r
`);
    expect(dependency.ok).toBe(true);
    if (!dependency.ok) return;
    expect(dependency.tables).toEqual(["finance.orders"]);
    expect(dependency.cteNames).toEqual(["recent"]);
    expect(dependency.tables).not.toContain("recent");
  });

  it("sql: source 的物理依赖超出启用范围时报错", () => {
    const built = buildHiveSourceClosure(
      generation({
        enabledTables: ["finance.orders", "finance.customers"],
        overlays: [
          {
            fileName: "finance_events.yaml",
            document: {
              name: "finance_events",
              sql: "SELECT order_id FROM finance.secret_events",
              grain: ["order_id"],
              columns: [{ name: "order_id", type: "bigint" }]
            }
          }
        ]
      })
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toBe("hive_source_dependency_not_allowed");
  });

  it("sql: source 的 CTE 依赖不被当成物理表越过启用范围", () => {
    const built = buildHiveSourceClosure(
      generation({
        enabledTables: ["finance.orders", "finance.customers"],
        overlays: [
          {
            fileName: "finance_events.yaml",
            document: {
              name: "finance_events",
              sql: "WITH base AS (SELECT order_id FROM finance.orders) SELECT order_id FROM base",
              grain: ["order_id"],
              columns: [{ name: "order_id", type: "bigint" }]
            }
          }
        ]
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.sources.some((source) => source.name === "finance_events")).toBe(true);
    expect(built.value.cteNames).toContain("base");
  });
});

describe("H3 目录失败与编译载荷", () => {
  it("目录读取失败显式报错，不返回空快照成功状态", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hive-closure-"));
    await mkdir(path.join(root, "config"), { recursive: true });
    const result = await readHivePublishedGeneration(root, "prod_hive");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_source_directory_unreadable");
  });

  it("编译载荷遵循 SourceDefinition 契约：table 与 sql 互斥，且不丢字段", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hive-closure-"));
    const contentRoot = path.join(root, "config");
    const base = path.join(contentRoot, "semantic-layer", "prod_hive");
    await mkdir(path.join(base, "_schema"), { recursive: true });
    await writeFile(
      path.join(base, "_schema", "finance.yaml"),
      `tables:
  finance_orders:
    table: finance.orders
    columns:
      - name: order_id
        type: bigint
        pk: true
      - name: amount
        type: decimal
`,
      "utf8"
    );
    await writeFile(
      path.join(base, "finance_orders.yaml"),
      `name: finance_orders
grain:
  - order_id
measures:
  - name: revenue
    expr: sum(finance_orders.amount)
`,
      "utf8"
    );

    // The content root is resolved from the environment, exactly like the
    // WebUI server does at runtime.
    const previousRoot = process.env.LUCY_CONTENT_ROOT;
    process.env.LUCY_CONTENT_ROOT = contentRoot;
    invalidateContentPathsCache();
    try {
      const read = await readHivePublishedGeneration(root, "prod_hive", {
        enabledTables: ["finance.orders"]
      });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const built = buildHiveSourceClosure(read.value);
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      const payload = toCompilerSources(built.value.sources);
      const orders = payload.find((source) => source.name === "finance_orders")!;
      expect(orders.table).toBe("finance.orders");
      expect(orders.sql).toBeUndefined();
      expect(orders.grain).toEqual(["order_id"]);
      expect(orders.measures).toEqual([{ name: "revenue", expr: "sum(finance_orders.amount)" }]);
      // 编译载荷里没有连接 ID 或凭据字段。
      expect(JSON.stringify(payload)).not.toContain("prod_hive");
    } finally {
      if (previousRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
      else process.env.LUCY_CONTENT_ROOT = previousRoot;
      invalidateContentPathsCache();
    }
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-4 §7 验收矩阵 — 按编号命名的用例（V02）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.3（语义资产
 *     与来源闭包）、§4.3.5（严格 AST）、§7（验收矩阵 V02 的通过标准）
 *
 * V02：Manifest＋overlay 完整来源 —— grain、派生列、segment、join、隐藏列不丢；
 *       重复／孤立／未知引用失败。
 *
 * 与既有 H3 用例的分工：既有断言的是**解析后的来源对象**；这里断言的是
 * **送到计算层的编译载荷**（字段一个都不许丢）＋ 三类失败各自的理由码。
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("P1-4 §7 — V02 Manifest＋overlay 的完整来源", () => {
  it("V02 — grain／派生列／segment／join／隐藏列一个都不丢（编译载荷同样不丢）；重复／孤立／未知引用各自失败", () => {
    const built = buildHiveSourceClosure(
      generation({
        overlays: [
          {
            fileName: "finance_orders.yaml",
            document: {
              name: "finance_orders",
              grain: ["order_id", "tenant_id"],
              exclude_columns: ["internal_note"],
              column_overrides: [{ name: "amount", descriptions: { human: "订单金额" } }],
              columns: [
                {
                  name: "order_month",
                  type: "string",
                  expr: "date_format(finance_orders.created_at, 'yyyy-MM')"
                },
                { name: "secret_token", type: "string", expr: "'x'", visibility: "hidden" }
              ],
              measures: [{ name: "revenue", expr: "sum(finance_orders.amount)" }],
              segments: [{ name: "settled", expr: "finance_orders.status = 'SETTLED'" }]
            }
          }
        ]
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const orders = built.value.sources.find((source) => source.name === "finance_orders")!;
    // grain / 派生列 / segment / join / 隐藏可见性 一个都不丢。
    expect(orders.grain).toEqual(["order_id", "tenant_id"]);
    expect(orders.segments.map((segment) => segment.name)).toEqual(["settled"]);
    expect(orders.joins.map((join) => join.to)).toEqual(["finance_customers"]);
    expect(orders.columns.some((column) => column.name === "order_month")).toBe(true);
    expect(orders.columns.find((column) => column.name === "order_month")?.expr).toBe(
      "date_format(finance_orders.created_at, 'yyyy-MM')"
    );
    // 排除列真的消失了，隐藏列被记录下来供 AST 检查使用。
    expect(orders.columns.some((column) => column.name === "internal_note")).toBe(false);
    expect(built.value.hiddenColumnsBySourceName.get("finance_orders")).toEqual(["secret_token"]);
    // join 目标也在闭包里（物理依赖完整）。
    expect(built.value.sources.some((source) => source.name === "finance_customers")).toBe(true);
    expect(built.value.physicalTables).toContain("finance.customers");

    // 送到计算层的编译载荷同样一个字段都不丢（只拼 measures 是不允许的）。
    const payload = toCompilerSources(built.value.sources);
    const payloadOrders = payload.find((source) => source.name === "finance_orders")!;
    expect(payloadOrders.table).toBe("finance.orders");
    expect(payloadOrders.grain).toEqual(["order_id", "tenant_id"]);
    expect(payloadOrders.measures).toEqual([{ name: "revenue", expr: "sum(finance_orders.amount)" }]);
    expect(payloadOrders.segments).toEqual([
      { name: "settled", expr: "finance_orders.status = 'SETTLED'" }
    ]);
    expect(payloadOrders.joins).toEqual([
      {
        to: "finance_customers",
        on: "finance_orders.customer_id = finance_customers.customer_id",
        relationship: "many_to_one"
      }
    ]);
    const payloadColumns = payloadOrders.columns as Array<Record<string, unknown>>;
    expect(payloadColumns.some((column) => column.name === "order_month")).toBe(true);
    expect(payloadColumns.some((column) => column.name === "internal_note")).toBe(false);
    expect(payloadColumns.some((column) => column.name === "secret_token" && column.visibility === "hidden")).toBe(true);

    // ── 三类引用失败各自显式报错，不返回旧快照成功状态 ────────────────────
    const duplicate = buildHiveSourceClosure(
      generation({
        manifests: [
          {
            schema: "a_b",
            tables: { a_b_c: { table: "a_b.c", columns: [{ name: "id", type: "bigint", pk: true }] } }
          },
          {
            schema: "a",
            tables: { a_b_c: { table: "a.b_c", columns: [{ name: "id", type: "bigint", pk: true }] } }
          }
        ],
        enabledTables: []
      })
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toBe("hive_source_duplicate_name");

    const orphan = buildHiveSourceClosure(
      generation({
        overlays: [
          { fileName: "ghost.yaml", document: { name: "finance_ghost", grain: ["id"] } }
        ]
      })
    );
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) {
      expect(orphan.reason).toBe("hive_source_orphan_overlay");
      expect(orphan.detail).toContain("finance_ghost");
    }

    const unknown = buildHiveSourceClosure(
      generation({
        overlays: [
          {
            fileName: "finance_orders.yaml",
            document: { name: "finance_orders", grain: ["not_a_column"] }
          }
        ]
      })
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("hive_source_unknown_reference");
  });
});
