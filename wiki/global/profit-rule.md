# 利润口径与负利润处理（Profit Rule）

> 适用：`dataforai.superstore_orders` 等含行级 `profit` 字段的事实表。

## 定义

```
profit_margin = SUM(profit) / NULLIF(SUM(sales), 0)
```

`profit` 是 **行级净利润**，已扣除该行的成本和折扣影响，**可为负值**（亏损行）。

## 关键约束：负利润行不可过滤

```sql
-- ❌ 错误：会高估整体利润率
WHERE profit > 0
```

**业务含义**：负利润是真实的经营损失（清仓、深折、高退货成本等）。过滤掉这些行 = 只看赢的行 = 系统性高估利润。

如果用户明确问"盈利订单的利润率"，那是另一个指标（在 measure 维度上加 `WHERE profit > 0`），不是 `profit_margin`。

## 禁止的简化

| 写法 | 为什么错 |
|---|---|
| `AVG(profit / sales)` | 行级比率的简单平均不等于整体加权率，且 `sales = 0` 会爆 |
| `SUM(profit) / COUNT(*)` | 算的是平均行级利润元，不是利润率 |
| `WHERE profit > 0 后再 SUM(profit)/SUM(sales)` | 数学上仍是比率，但口径不对（见上） |

## Gotcha

- **同一订单的多行可能盈亏交错**。利润率按行求和，不按订单聚合 — 这是有意的。如果要算"盈利订单数 / 总订单数"，那是订单层指标，需要先 `GROUP BY order_id HAVING SUM(profit) > 0` 子查询。
- **退货行不在 `superstore_orders` 中减扣**。退货事实在 `superstore_returns` 表，业务上是否要从利润中扣回成本由分析人确认，默认 `profit_margin` 不做退货调整。

## 用法

优先 `superstore_orders.profit_margin` measure；高风险（财务汇报）触发 reviewer skill。

## 参考

- `semantic-layer/mysql-aliyun/_schema/dataforai.yaml` → `superstore_orders.measures.profit_margin`
- `wiki/global/return-semantics.md` — 退货语义
