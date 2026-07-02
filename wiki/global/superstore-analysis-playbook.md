---
visibility: private
sl_refs:
  - mysql-aliyun/dataforai/superstore_orders
  - mysql-aliyun/dataforai/superstore_returns
  - mysql-aliyun/dataforai/superstore_people
---

# Superstore 数据分析路由与口径示例

> 适用：`dataforai` 超市样例域，面向 KTX MCP 的 `wiki_search` / `wiki_read` 验证。

## 何时使用

当用户询问超市订单、销售额、利润、折扣、退货、区域经理、客户、商品、品类、年度趋势时，优先使用本页作为业务路由参考。

## 表路由

| 问题类型 | 首选表 |
|---|---|
| 销售额、利润、折扣、订单数、客户数、商品、品类、地区趋势 | `dataforai.superstore_orders` |
| 退货订单、退货率、退货订单关联分析 | `dataforai.superstore_returns` + `superstore_orders` |
| 区域经理、区域负责人 | `dataforai.superstore_people` + `superstore_orders` |

`superstore_orders` 是订单明细表，粒度是 `row_id`，一笔 `order_id` 可能有多行商品明细。

## 当前数据快照

当前 `dataforai` 超市域的基准规模：

| 表 | 当前记录数 | 说明 |
|---|---:|---|
| `dataforai.superstore_orders` | 10,194 明细行 | 不是订单数；订单数应使用 `order_count = count(distinct order_id)`，当前为 5,083 |
| `dataforai.superstore_returns` | 296 行 | 每行是一笔已退货订单记录 |
| `dataforai.superstore_people` | 6 行 | 区域到区域经理的映射表 |

因此，`10,194` 与 `5,083` 不是冲突：前者是订单商品明细行数，后者是去重订单数。凡是用户问“订单数”，必须使用 `order_count`，不能用 `COUNT(*)`。

## 默认过滤

所有 `superstore_*` 表默认排除逻辑删除行：

```sql
is_deleted = 0
```

查询退货表时还要加：

```sql
returned = '是'
```

## 核心指标

优先使用语义层 measure，不要在 SQL 中临时发明公式。

| 指标 | measure | 口径 |
|---|---|---|
| 销售额 | `total_sales` | `sum(sales)` |
| 利润 | `total_profit` | `sum(profit)` |
| 利润率 | `profit_margin` | `sum(profit) / nullif(sum(sales), 0)` |
| 加权折扣率 | `weighted_discount` | `sum(discount * sales) / nullif(sum(sales), 0)` |
| 订单数 | `order_count` | `count(distinct order_id)` |
| 客户数 | `customer_count` | `count(distinct customer_id)` |

## 常见错误

- 订单数不能用 `COUNT(*)`，因为 `superstore_orders` 是明细行，不是订单头。
- 折扣率不能用 `AVG(discount)`，应使用销售额加权口径 `weighted_discount`。
- 利润率不能用 `AVG(profit / sales)`，应使用 `profit_margin`。
- 不要过滤 `profit > 0` 后再算整体利润率；负利润是真实亏损。
- 退货不是行级标记。`returns` 里的 `order_id` 表示整单退货，JOIN 到订单明细后会扩展到该订单的所有商品行。
- 当前没有退货成本字段，不要硬算“退货利润损失”。

## JOIN 规则

区域经理：

```sql
superstore_orders.region = superstore_people.region
```

退货订单：

```sql
superstore_orders.order_id = superstore_returns.order_id
```

退货分析建议先在 `superstore_returns` 侧按 `order_id` 去重，再关联订单明细，避免把订单级退货误解成商品行级退货。

## 检索关键词

超市、Superstore、dataforai、订单数、明细行、加权折扣、weighted_discount、利润率、profit_margin、退货、returned、区域经理、region、regional_manager、is_deleted。
