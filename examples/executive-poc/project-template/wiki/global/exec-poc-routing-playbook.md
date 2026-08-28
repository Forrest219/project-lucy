---
sl_refs:
  - demo-exec-mysql/dataforai/fct_daily_cash_balance
  - demo-exec-mysql/dataforai/fct_ar_aging_detail
  - demo-exec-mysql/dataforai/fct_pl_monthly
  - demo-exec-mysql/dataforai/fct_cashflow_monthly
  - demo-exec-mysql/dataforai/fct_collection_monthly
  - demo-exec-mysql/dataforai/fct_budget_actual
  - demo-exec-mysql/dataforai/fct_inventory_health_daily
  - demo-exec-mysql/dataforai/fct_acquisition_monthly
  - demo-exec-mysql/dataforai/fct_fulfillment_order
  - demo-exec-mysql/dataforai/fct_sales_margin
  - demo-exec-mysql/dataforai/fct_sales_margin_regional
  - demo-exec-mysql/dataforai/fct_order_line_daily
  - demo-exec-mysql/dataforai/mv_order_quarterly_rollup
  - demo-exec-mysql/dataforai/fct_ai_token_consumption
  - demo-exec-mysql/dataforai/fct_business_ticket_closed
---

# Executive POC 总路由

> 内部 CFO / COO / CIO 能力演示包。MySQL 自包含；不依赖 StarRocks。数值 gold：`examples/executive-poc/mysql/_baseline.json`。

## 场景路由

| 场景 | 用户意图 | 首选 source | Playbook |
|---|---|---|---|
| CFO-1 | 月末资金、应收账龄、90+ 占比 | `fct_daily_cash_balance`, `fct_ar_aging_detail` | exec-cfo-semi-additive |
| CFO-2 | 利润 vs 经营现金流背离 | `fct_pl_monthly`, `fct_cashflow_monthly`, `fct_collection_monthly` | exec-cfo-cash-bridge |
| CFO-3 | 预算达成、多币种 | `fct_budget_actual`, `dim_fx_rate`, `dim_cost_center` | exec-cfo-budget-fx |
| COO-4 | 滞销 / 断货 DOS | `fct_inventory_health_daily` | exec-coo-inventory |
| COO-5 | CAC、履约时长 | `fct_acquisition_monthly`, `fct_fulfillment_order` | exec-coo-acquisition |
| CIO-6 | 权限、脱敏 | 按角色选 margin 表 | exec-cio-access |
| CIO-7 | 大表聚合 vs MV | `mv_order_quarterly_rollup` 优先 | exec-cio-performance |
| CIO-8 | Token ROI | `fct_ai_token_consumption`, `fct_business_ticket_closed` | exec-cio-ai-governance |

## 禁止事项

- 禁止跨 connection join
- 禁止对余额类指标跨时间 `SUM(cash_balance)`
- 禁止对比率使用 `AVG` 行级占比
