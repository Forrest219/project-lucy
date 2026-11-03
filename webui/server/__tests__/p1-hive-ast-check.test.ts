/**
 * P1-4 Hive 直连（编译侧）— H5 严格 Hive AST 检查。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.3.5
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H5）
 */
import { describe, expect, it } from "vitest";
import {
  checkHiveSql,
  findUnverifiedHiveConstructs,
  parseHiveSql,
  type HiveAstCheckInput
} from "../hive/ast-check";

const ALLOWED = ["finance.orders", "finance.customers"];

const SOURCE_ALIAS_TO_PHYSICAL = new Map([
  ["finance_orders", "finance.orders"],
  ["finance_customers", "finance.customers"]
]);

function check(sql: string, overrides: Partial<HiveAstCheckInput> = {}) {
  return checkHiveSql({
    sql,
    allowedPhysicalTables: ALLOWED,
    sourceAliasToPhysical: SOURCE_ALIAS_TO_PHYSICAL,
    maxLimit: 1000,
    ...overrides
  });
}

const GOOD_SQL = `SELECT SUM(finance_orders.amount) AS revenue
FROM finance.orders AS finance_orders
WHERE finance_orders.tenant_id = 'A'
GROUP BY finance_orders.tenant_id
LIMIT 100`;

describe("H5 严格 Hive AST 检查", () => {
  it("合规语句通过：单语句、只读、依赖在授权闭包内、LIMIT 合规", () => {
    const result = check(GOOD_SQL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.physicalTables).toEqual(["finance.orders"]);
    expect(result.outputColumns).toEqual(["revenue"]);
    expect(result.limit).toBe(100);
  });

  it("多语句被拒绝", () => {
    const twoSelects = check(
      "SELECT finance_orders.order_id FROM finance.orders AS finance_orders LIMIT 10; SELECT 1 FROM finance.orders"
    );
    expect(twoSelects.ok).toBe(false);
    if (twoSelects.ok) return;
    expect(twoSelects.reason).toBe("hive_sql_parse_failed");

    // 多语句里夹带写操作时，报的是"非只读"。
    const withDrop = check(
      "SELECT finance_orders.order_id FROM finance.orders AS finance_orders LIMIT 10; DROP TABLE finance.orders"
    );
    expect(withDrop.ok).toBe(false);
    if (withDrop.ok) return;
    expect(withDrop.reason).toBe("hive_sql_not_readonly");
  });

  it("写操作与系统元数据操作全部被拒绝，不向 JDBC 分派", () => {
    const writes = [
      "INSERT INTO finance.orders VALUES (1)",
      "CREATE TABLE finance.copy AS SELECT * FROM finance.orders",
      "DROP TABLE finance.orders",
      "EXPORT TABLE finance.orders TO '/tmp/out'",
      "LOAD DATA INPATH '/tmp/in' INTO TABLE finance.orders",
      "ADD JAR /tmp/x.jar",
      "SET hive.exec.dynamic.partition=true",
      "USE finance",
      "TRUNCATE TABLE finance.orders"
    ];
    for (const sql of writes) {
      const result = check(sql);
      expect(result.ok, `must reject: ${sql}`).toBe(false);
      if (result.ok) continue;
      expect(
        result.reason === "hive_sql_not_readonly" || result.reason === "hive_sql_parse_failed"
      ).toBe(true);
    }
  });

  it("依赖与授权来源闭包不匹配时被拒绝", () => {
    const result = check(
      "SELECT finance_orders.amount FROM finance.secret_orders AS finance_orders LIMIT 10"
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_dependency_not_allowed");
  });

  it("JOIN 引入的表同样必须在授权闭包内", () => {
    const result = check(
      `SELECT finance_orders.amount FROM finance.orders AS finance_orders
       JOIN finance.secret_customers AS finance_customers
         ON finance_orders.customer_id = finance_customers.customer_id
       LIMIT 10`
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_dependency_not_allowed");
  });

  it("超过 LIMIT 上限被拒绝；缺少 LIMIT 也被拒绝", () => {
    const tooBig = check(
      "SELECT finance_orders.amount FROM finance.orders AS finance_orders LIMIT 5000"
    );
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.reason).toBe("hive_sql_limit_exceeded");

    const missing = check(
      "SELECT finance_orders.amount FROM finance.orders AS finance_orders"
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("hive_sql_limit_missing");
  });

  it("隐藏列出现在输出投影时被拒绝", () => {
    const result = check(
      "SELECT finance_orders.internal_note AS internal_note FROM finance.orders AS finance_orders LIMIT 10",
      { hiddenColumns: new Set(["internal_note"]) }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_hidden_column_exposed");
  });

  it("字节上限被拒绝", () => {
    const result = check(GOOD_SQL, { maxSqlBytes: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_too_large");
  });

  it("CTE 名不误作物表：CTE 引用展开为它真正读的物理表", () => {
    const result = check(
      `WITH recent AS (
         SELECT order_id, amount FROM finance.orders
       )
       SELECT recent.amount FROM recent LIMIT 10`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.physicalTables).toEqual(["finance.orders"]);
    expect(result.physicalTables).not.toContain("recent");
  });

  it("CTE 名字与物理表同名时也不会把 CTE 当成越权物理表放行", () => {
    const result = check(
      `WITH finance_orders AS (
         SELECT order_id FROM finance.secret_orders
       )
       SELECT finance_orders.order_id FROM finance_orders LIMIT 10`
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_dependency_not_allowed");
  });
});

describe("H5 强制谓词在聚合前生效", () => {
  it("强制谓词出现在 WHERE 中时通过（按语法树比较，不是字符串包含）", () => {
    const result = check(
      `SELECT SUM(finance_orders.amount) AS revenue
       FROM finance.orders AS finance_orders
       WHERE (finance_orders.tenant_id = 'A')
       GROUP BY finance_orders.tenant_id
       LIMIT 100`,
      {
        requiredPredicates: [
          { expression: "finance_orders.tenant_id = 'A'", sourceAlias: "finance_orders" }
        ]
      }
    );
    expect(result.ok).toBe(true);
  });

  it("强制谓词缺失时拒绝分派", () => {
    const result = check(
      `SELECT SUM(finance_orders.amount) AS revenue
       FROM finance.orders AS finance_orders
       GROUP BY finance_orders.tenant_id
       LIMIT 100`,
      {
        requiredPredicates: [
          { expression: "finance_orders.tenant_id = 'A'", sourceAlias: "finance_orders" }
        ]
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_forced_predicate_missing");
  });

  it("强制谓词只在 HAVING 里（聚合之后）时拒绝", () => {
    const result = check(
      `SELECT SUM(finance_orders.amount) AS revenue
       FROM finance.orders AS finance_orders
       GROUP BY finance_orders.tenant_id
       HAVING finance_orders.tenant_id = 'A'
       LIMIT 100`,
      {
        requiredPredicates: [
          { expression: "finance_orders.tenant_id = 'A'", sourceAlias: "finance_orders" }
        ]
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_forced_predicate_missing");
  });

  it("谓词值不同不算命中：不能靠字符串包含冒充策略生效", () => {
    const result = check(
      `SELECT SUM(finance_orders.amount) AS revenue
       FROM finance.orders AS finance_orders
       WHERE (finance_orders.tenant_id = 'A')
       GROUP BY finance_orders.tenant_id
       LIMIT 100`,
      {
        requiredPredicates: [
          { expression: "finance_orders.tenant_id = 'B'", sourceAlias: "finance_orders" }
        ]
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_forced_predicate_missing");
  });

  it("谓词约束的源不在本语句作用域内时拒绝", () => {
    const result = check(GOOD_SQL, {
      requiredPredicates: [
        { expression: "finance_customers.region = 'APAC'", sourceAlias: "finance_customers" }
      ]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_sql_forced_predicate_missing");
  });
});

describe("H5 时间分组的待验证标记", () => {
  it("DATE_TRUNC 月分组能通过形状检查，但被标为待真实 HS2 验证", () => {
    const sql = `SELECT DATE_TRUNC('MONTH', finance_orders.created_at) AS created_at_month,
       SUM(finance_orders.amount) AS revenue
FROM finance.orders AS finance_orders
GROUP BY DATE_TRUNC('MONTH', finance_orders.created_at)
LIMIT 100`;
    const result = check(sql);
    // 形状检查通过 —— 但这只证明形状，不证明 HS2 能执行。
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unverifiedConstructs).toContain("date_trunc");

    const parsed = parseHiveSql(sql);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(findUnverifiedHiveConstructs(parsed.statement)).toEqual(["date_trunc"]);
  });

  it("不含时间分组的语句没有待验证标记", () => {
    const result = check(GOOD_SQL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unverifiedConstructs).toEqual([]);
  });
});
