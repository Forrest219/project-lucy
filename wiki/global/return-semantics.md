---
visibility: private
sl_refs:
  - mysql-aliyun/dataforai/superstore_orders
  - mysql-aliyun/dataforai/superstore_returns
---

# 退货语义（Return Semantics）

> 适用：`dataforai.superstore_returns` 与 `dataforai.superstore_orders` 的关联。

## 基础语义

- `superstore_returns` 每行记录一笔退货事件。
- 主键：`id`（代理键）；业务键：`order_id`。
- `returned` 列在样本中**只有 '是' 这一个取值**。该列在结构上预留了 '否'，实际未出现。

**结论**：可以认为"`returns` 表里的每一行都是一笔已发生的退货"。但稳健写法仍应显式 `WHERE returned = '是'`，防止未来出现 '否' 行导致沉默错误。

## 与 `superstore_orders` 的 cardinality

```
superstore_returns.order_id  ──many_to_one──>  superstore_orders.order_id
```

- 一个 `order_id` 在 `orders` 中通常有多行（每行一个商品 line item）。
- 一个 `order_id` 在 `returns` 中**只出现 0 或 1 次**（退货标的是整单，不分商品行）。

⚠️ **JOIN 注意**：如果直接 `orders LEFT JOIN returns ON order_id`，**每一个被退货订单的所有 line item 都会被标记为 returned**。这通常不是你想要的"退货明细"。

正确写法两种：

1. **订单级退货率**：先在 `returns` 端去重 order_id，再 join；或直接 `orders.order_id IN (SELECT order_id FROM returns WHERE returned='是')`。
2. **行级退货率**：当前 schema 不支持，因为退货标记不到 line item 级。如果业务方问"哪些产品退货最多"，只能近似为"被退货订单中的产品"，并标注假设。

## 不可用的派生指标

- "退货利润损失" — 退货成本未在 `orders.profit` 中扣减，也无独立字段。这是 schema 缺失，**不要尝试硬算**，应反馈业务方。
- "退货率（金额）" — 同上，需先和业务方对齐定义（按订单数？按 sales 金额？按 quantity？）。

## 默认过滤

任何使用 `superstore_returns` 的查询：

```sql
WHERE is_deleted = 0
  AND returned = '是'
```

## 参考

- `semantic-layer/mysql-aliyun/_schema/dataforai.yaml` → `superstore_returns.joins` (M1.2)
- `enrichment/relationships.json` review 数组第 1 条（conf=0.93）— 候选关系来源
