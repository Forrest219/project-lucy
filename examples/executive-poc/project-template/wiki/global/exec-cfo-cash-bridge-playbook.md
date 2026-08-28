---
sl_refs:
  - demo-exec-mysql/dataforai/fct_pl_monthly
  - demo-exec-mysql/dataforai/fct_cashflow_monthly
  - demo-exec-mysql/dataforai/fct_collection_monthly
---

# Executive POC：利润 vs 经营现金流 Bridge

## 演示顺序（多轮单源）

1. `fct_pl_monthly` + segment `q2_2026` → `net_profit` 合计
2. `fct_cashflow_monthly` + segment `q2_2026` → `operating_cf` 合计
3. `fct_collection_monthly` → `collection_amt`, `inventory_delta`, `avg_tax_refund_lag_days`

## Bridge 模板

```text
经营 CF 变动 ≈ 净利润变动 + 营运资本（回款、存货）+ 退税节奏
```

Demo 数据刻意构造：Q2 2026 净利润同比约 +15%，经营 CF 同比约 -28%。
