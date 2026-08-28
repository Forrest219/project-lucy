---
sl_refs:
  - demo-exec-mysql/dataforai/fct_acquisition_monthly
  - demo-exec-mysql/dataforai/fct_fulfillment_order
  - demo-exec-mysql/dataforai/dim_channel
---

# Executive POC：获客与履约

## 何时使用

- CAC 对比、渠道花费效率
- 履约时长、退货率

## 推荐 measure

| 问题 | source | measure |
|---|---|---|
| 渠道 CAC | fct_acquisition_monthly | cac |
| 平均履约天数 | fct_fulfillment_order | avg_fulfill_days |

Demo：VC 履约时长比 SC 长约 96%（见 baseline `coo5.fulfill_days_gap_pct`）。
