---
sl_refs:
  - demo-exec-mysql/dataforai/fct_daily_cash_balance
  - demo-exec-mysql/dataforai/fct_ar_aging_detail
  - demo-exec-mysql/dataforai/dim_legal_entity
---

# Executive POC：资金与应收（半可加）

## 何时使用

- 月末资金存量、日终余额趋势
- 应收账款账龄、90+ 逾期占比

## 半可加规则

| 指标 | 跨子公司 | 跨时间 |
|---|---|---|
| 资金存量 | 对 **month_end** measure 求 SUM | 必须用 `cash_balance_month_end` + `month_end_only` |
| 应收余额 | SUM(ar_balance) | 同一 `as_of_date` 截面 |

## 推荐 measure

| 问题 | measure | segment |
|---|---|---|
| 各月月末资金 | cash_balance_month_end | month_end_only |
| 90+ 应收占比 | ar_over_90_ratio | latest_month_end |

## 常见错误

- SUM(cash_balance) 跨月 — 余额被重复加总
- AVG(账龄占比) — 必须用 SUM/SUM
