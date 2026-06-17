# Table Routing Policy

## Quick Reference

| 问题类型 | Canonical Table | 禁止使用 |
|----------|----------------|---------|
| 超市零售分析（订单/销售/利润/折扣） | `dataforai.superstore_orders` | `openclaw_db.orders`（小型 demo，数据不同） |
| 月度汇总 / 趋势 / 环比 | `openclaw_db.bidm_ai_metric_summary_mth` | 禁止扫 superstore_orders 明细聚合月度 |
| 客户档案 | `openclaw_db.customers` | — |
| 区域经理 | `dataforai.superstore_people` | — |
| 退货分析 | `dataforai.superstore_returns` JOIN `superstore_orders` | — |

## 同名表歧义

`orders` 在本项目中存在两处：
- `openclaw_db.orders` — 小型演示库，约 32 行，**不用于 superstore 分析**
- `dataforai.superstore_orders` — Tableau 超市样本，10194 行，**超市分析的唯一 canonical table**

遇到"订单"问题时，默认使用 `dataforai.superstore_orders`，除非用户明确说明是 openclaw 演示数据。

## dataforai 表关系

```
superstore_orders  ──(order_id)──▶  superstore_returns
superstore_orders  ──(region)───▶  superstore_people
```

JOIN 时须加 `is_deleted = 0` 过滤两侧。
