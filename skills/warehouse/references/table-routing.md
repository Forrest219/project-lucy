# Table Routing Policy

## Quick Reference

| 问题类型 | Canonical Table |
|----------|----------------|
| 超市零售分析（订单/销售/利润/折扣） | `dataforai.superstore_orders` |
| 月度汇总 / 趋势 / 环比 | `dataforai.superstore_orders` 按 `order_date` 聚合 |
| 区域经理 | `dataforai.superstore_people` |
| 退货分析 | `dataforai.superstore_returns` JOIN `superstore_orders` |

## dataforai 表范围

本项目只保留 `dataforai` 超市 domain。遇到"订单"问题时，默认使用 `dataforai.superstore_orders`。

## dataforai 表关系

```
superstore_orders  ──(order_id)──▶  superstore_returns
superstore_orders  ──(region)───▶  superstore_people
```

JOIN 时须加 `is_deleted = 0` 过滤两侧。
