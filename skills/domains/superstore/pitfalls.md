# Superstore Pitfalls

常见错误模式与反例。遇到相关问题时必须检查此列表。

## P1 — 折扣字段误用 AVG

**错误**：`AVG(discount)`
**正确**：`SUM(discount * sales) / NULLIF(SUM(sales), 0)`
**原因**：discount 是行级折扣率。小额订单折扣高、大额订单折扣低时，简单平均结果偏高。
**数据证明**：superstore_orders 简单均值 ≈ 15.54%，加权均值 ≈ 13.98%，差距 1.56 个百分点。

## P2 — 订单数用 COUNT(*)

**错误**：`COUNT(*)`
**正确**：`COUNT(DISTINCT order_id)`
**原因**：superstore_orders 是明细表，一笔订单含多个产品行。COUNT(*) 统计的是行数，不是订单数。

## P3 — 利润率误用 AVG

**错误**：`AVG(profit / sales)` 或 `AVG(profit_rate)`
**正确**：`SUM(profit) / NULLIF(SUM(sales), 0)`
**原因**：行级利润率在大销售额订单上权重不对，简单平均失真。

## P4 — 过滤亏损行

**错误**：`WHERE profit > 0` 后再计算利润率
**正确**：不过滤，亏损行必须纳入分母
**原因**：负利润行是分析的核心对象（高折扣、高成本商品），过滤后利润率虚高。

## P5 — 未过滤 is_deleted

**错误**：`SELECT ... FROM superstore_orders`（无过滤）
**正确**：`WHERE is_deleted = 0`
**原因**：全量重导入时旧批次数据不物理删除，is_deleted=1 的行是历史批次残留。

## P6 — orders 表歧义

**错误**：直接使用 `openclaw_db.orders` 做超市分析
**正确**：超市分析必须用 `dataforai.superstore_orders`
**原因**：两张表都叫 orders，但数据完全不同。openclaw_db.orders 是约 32 行的演示数据。

## P7 — 退货表误用 returned 字段值

**错误**：`WHERE returned = 'Yes'` 或 `WHERE returned = 1`
**正确**：`WHERE returned = '是'`（汉字）
**原因**：源数据为中文 Excel，退货标记值为汉字 `'是'`。
