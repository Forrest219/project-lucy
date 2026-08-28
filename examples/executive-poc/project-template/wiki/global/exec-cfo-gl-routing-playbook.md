---
sl_refs:
  - demo-exec-mysql/dataforai/vw_gl_trial_balance_summary
  - demo-exec-mysql/dataforai/fct_gl_journal_line
  - demo-exec-mysql/dataforai/fct_gl_account_balance
  - demo-exec-mysql/dataforai/dim_gl_account
---

# Executive POC：GL 汇总 vs 明细分录路由

## 何时使用

- 「6001 营业收入合计」「科目汇总余额」→ **展示层 VIEW**
- 「凭证分录明细」「某笔借贷」→ **明细 fact**
- 科目月末余额趋势 → **半可加** fact

## 表路由

| 用户问题 | 首选 source |
|---|---|
| 营业收入合计、科目汇总余额、试算平衡展示 | `vw_gl_trial_balance_summary` |
| 6001 科目 | segment `revenue_6001` 或 filter `account_code = '6001'` |
| 凭证明细、分录借贷、过账日期 | `fct_gl_journal_line` |
| 科目日余额、月末余额（需半可加） | `fct_gl_account_balance` |
| 科目名称、类型 | `dim_gl_account` |

## 半可加规则

- 科目余额与资金余额同理：禁止跨月 `SUM(end_balance)` 日行
- 月末趋势用 `end_balance_month_end` + `month_end_only`

## 禁止事项

- 问「Q2 营业收入合计」时 **不要**直接扫 `fct_gl_journal_line` 除非用户明确要求明细
- 问「分录明细」时 **不要**只用汇总 VIEW

## 演示问句

> 2026 Q2 全集团 6001 营业收入科目月末余额合计是多少？若要看分录明细应查哪张表？
