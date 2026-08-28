---
sl_refs:
  - demo-exec-mysql/dataforai/fct_daily_cash_balance
  - demo-exec-mysql/dataforai/fct_ar_aging_detail
  - demo-exec-mysql/dataforai/fct_pl_monthly
  - demo-exec-mysql/dataforai/fct_cashflow_monthly
  - demo-exec-mysql/dataforai/fct_collection_monthly
  - demo-exec-mysql/dataforai/fct_budget_actual
  - demo-exec-mysql/dataforai/fct_channel_pl_monthly
  - demo-exec-mysql/dataforai/vw_gl_trial_balance_summary
  - demo-exec-mysql/dataforai/fct_gl_journal_line
  - demo-exec-mysql/dataforai/vw_channel_pl_consumer
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

## 场景路由（CFO-first v2）

| 场景 | 用户意图 | 首选 source | Playbook |
|---|---|---|---|
| CFO-1 | 月末资金、应收账龄、90+ 占比 | `fct_daily_cash_balance`, `fct_ar_aging_detail` | exec-cfo-semi-additive |
| CFO-2 | 利润 vs 经营现金流背离 | `fct_pl_monthly`, `fct_cashflow_monthly`, `fct_collection_monthly` | exec-cfo-cash-bridge |
| CFO-3 | 成本中心 CNY 预算达成 | `fct_budget_actual`, `dim_cost_center` | exec-cfo-budget-fx |
| **CFO-4** | **SC vs VC 渠道 P&L** | `fct_channel_pl_monthly`, `dim_channel` | exec-cfo-channel-pl |
| **CFO-5** | **GL 汇总 vs 明细分录** | `vw_gl_trial_balance_summary`, `fct_gl_journal_line` | exec-cfo-gl-routing |
| **CFO-6** | **USD 预算折算 CNY** | `fct_budget_actual`, `dim_fx_rate` | exec-cfo-budget-fx |
| **CFO-7** | **BP vs CFO 行级 ACL** | `vw_channel_pl_consumer` vs 全表 | exec-cfo-channel-pl + exec-cio-access |
| COO-4 | 滞销 / 断货 DOS | `fct_inventory_health_daily` | exec-coo-inventory |
| COO-5 | 履约时长（SC vs VC） | `fct_fulfillment_order` | exec-coo-acquisition |
| CIO-7 | 大表聚合 vs MV | `mv_order_quarterly_rollup` 优先 | exec-cio-performance |
| CIO-8 *(appendix)* | Token ROI | `fct_ai_token_consumption`, `fct_business_ticket_closed` | exec-cio-ai-governance |

## 禁止事项

- 禁止跨 connection join
- 禁止对余额类指标跨时间 `SUM(cash_balance)` 或 `SUM(end_balance)`
- 禁止对比率使用 `AVG` 行级占比
- 禁止用获客表回答渠道 P&L
