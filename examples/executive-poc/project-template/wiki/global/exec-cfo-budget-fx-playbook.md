---
sl_refs:
  - demo-exec-mysql/dataforai/fct_budget_actual
  - demo-exec-mysql/dataforai/dim_cost_center
  - demo-exec-mysql/dataforai/dim_fx_rate
  - demo-exec-mysql/dataforai/fct_daily_cash_balance
---

# Executive POC：预算、成本中心与汇率

## 何时使用

- Q3 预算达成率、业务线超支风险
- 多币种换算（closing vs average）
- 跨境实体多币种资金存量折算 CNY

## 口径

- 达成率 = `sum(actual_amt) / sum(budget_amt)`，禁止 AVG
- 默认 CNY；USD 需 join `dim_fx_rate` 按 `rate_type` 选取
- **多币种合并达成率（CFO-6）**：USD 行按 closing 7.18 折算后与 CNY 同行 SUM/SUM，或用 measure `budget_achievement_rate_cny` + segment `usd_only` 仅看 USD 行（折算后比率相同）

## USD 预算折算步骤

1. filter `fct_budget_actual.currency = 'USD'` + `cost_center_id = 4` + Q3 segment
2. 取 `dim_fx_rate` 其中 `rate_type = 'closing'`、`from_ccy = 'USD'`
3. 达成率 = `sum(actual_amt * rate) / sum(budget_amt * rate)`

## 多币种资金

- `fct_daily_cash_balance` 含 `currency` 列；实体 2（华南运营）有 CNY + USD
- 汇总 CNY 存量用 `cash_balance_month_end_cny`（USD × 7.18）

## 层级

`dim_cost_center` 固定 4 层（非真 ragged）；末级敏捷小组用 `level = 3` 过滤。
