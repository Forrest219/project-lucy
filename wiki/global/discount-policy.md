---
visibility: private
sl_refs:
  - mysql-aliyun/dataforai/superstore_orders
---

# 折扣率口径（Discount Rate Policy）

> 适用：`dataforai.superstore_orders` 及任何含 `discount` × `sales` 字段对的零售明细表。

## 定义

折扣率 = **销售额加权折扣**：

```
weighted_discount = SUM(discount * sales) / NULLIF(SUM(sales), 0)
```

`discount` 字段语义：**折扣率（0–1 之间的小数）**，表示该行折让占原价的比例。已在销售额 `sales` 中扣减（`sales` 已是折后金额）。

## 禁止的简化

| 写法 | 为什么错 |
|---|---|
| `AVG(discount)` | 简单平均不反映销售额权重；高单价行 vs 低单价行被同权处理，结果偏高 |
| `SUM(discount) / COUNT(*)` | 同上，同样是简单平均 |
| `SUM(discount * original_price) / SUM(original_price)` | 数据库中没有 `original_price` 字段，会报错或被误算 |

## Gotcha

- **`discount = 0` 的行也要纳入分母**。这些是无折扣订单，分子贡献 0，分母正常加 `sales`，整体加权率自然被稀释 — 这是正确行为，不要预过滤 `discount > 0`。
- **负折扣不存在**。若查询返回 `discount < 0`，是脏数据，应在分析前向用户提示。
- **免运费 / 礼品卡不算 discount**。当前数据集没单列免运费或礼品卡字段，所以 `discount` 字段仅代表商品价格折让。如果业务方问"含运费的折扣率"，需明确口径不一致。

## 用法

优先调用 `superstore_orders.weighted_discount` measure，不要在 SQL 里手写公式 — 避免漂移。

## 参考

- `semantic-layer/mysql-aliyun/superstore_orders.yaml` → `superstore_orders.measures.weighted_discount`
- `CLAUDE.md` 指标口径段（M1.4 完成后将引用本文件而非内联公式）
