---
sl_refs:
  - demo-exec-mysql/dataforai/fct_budget_actual
  - demo-exec-mysql/dataforai/dim_cost_center
  - demo-exec-mysql/dataforai/dim_fx_rate
---

# Executive POC：预算、成本中心与汇率

## 何时使用

- Q3 预算达成率、业务线超支风险
- 多币种换算（closing vs average）

## 口径

- 达成率 = `sum(actual_amt) / sum(budget_amt)`，禁止 AVG
- 默认 CNY；USD 需 join `dim_fx_rate` 按 `rate_type` 选取

## 层级

`dim_cost_center` 固定 4 层（非真 ragged）；末级敏捷小组用 `level = 3` 过滤。
