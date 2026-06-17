# Metrics Policy

## 强制聚合口径

| 指标名 | 正确写法 | 禁止写法 | 原因 |
|--------|---------|---------|------|
| 折扣率 | `SUM(discount * sales) / NULLIF(SUM(sales), 0)` | `AVG(discount)` | 简单平均不反映销售额权重，结果偏高约 1-2 个百分点 |
| 利润率 | `SUM(profit) / NULLIF(SUM(sales), 0)` | `AVG(profit / sales)` | 行级利润率简单平均在高销售额订单上失真 |
| 订单数 | `COUNT(DISTINCT order_id)` | `COUNT(*)` | superstore_orders 是明细表，一笔订单多行 |
| 客单价 | `SUM(sales) / NULLIF(COUNT(DISTINCT order_id), 0)` | `AVG(sales)` | AVG(sales) 是行级均值，非订单均值 |

## 利润相关注意

- `profit` 可为负值（亏损行）。
- 分析利润时**不得过滤 `profit < 0` 的行**，否则高估整体利润。
- 负利润行是分析重点（高折扣商品、特定子类别）。

## 除零保护

所有除法运算必须使用 `NULLIF(分母, 0)` 保护，避免 division by zero。

## 时间字段

- `order_date`、`ship_date` 为 DATE 类型。
- 通过 mysql2 驱动展示时可能携带时区偏移（`T16:00:00.000Z`），属展示问题，存储值正确，不影响日期计算。
