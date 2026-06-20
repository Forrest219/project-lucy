# Table Routing Policy

## Quick Reference

| 问题类型 | Canonical Table |
|----------|----------------|
| 超市零售分析（订单/销售/利润/折扣） | `dataforai.superstore_orders` |
| 月度汇总 / 趋势 / 环比 | `dataforai.superstore_orders` 按 `order_date` 聚合 |
| 区域经理 | `dataforai.superstore_people` |
| 退货分析 | `dataforai.superstore_returns` JOIN `superstore_orders` |
| KX 财报金额明细 | `dataforai.kx_fact_financial_amount` JOIN `kx_dim_company` / `kx_dim_financial_item` |
| KX 公司 | `dataforai.kx_dim_company` |
| KX 财报项目 | `dataforai.kx_dim_financial_item` |
| KX 资产负债表明细 | `dataforai.kx_vw_balance_sheet_detail` |
| KX 现金流量表明细 | `dataforai.kx_vw_cash_flow_statement_detail` |
| KX 利润表明细 | `dataforai.kx_vw_income_statement_detail` |

## dataforai 表范围

本项目启用 `dataforai` 下的超市样例 domain 与 KX 财务报表 domain。遇到"订单"问题时，默认使用 `dataforai.superstore_orders`；遇到"财报/报表项目/资产负债表/利润表/现金流量表"问题时，默认使用 KX 财务表或对应明细视图。

## dataforai 表关系

```
superstore_orders  ──(order_id)──▶  superstore_returns
superstore_orders  ──(region)───▶  superstore_people
kx_fact_financial_amount ──(company_id)──▶ kx_dim_company
kx_fact_financial_amount ──(item_id)─────▶ kx_dim_financial_item
```

超市表 JOIN 时须加 `is_deleted = 0` 过滤两侧。KX 财务表不含 `is_deleted`，不要套用超市软删除过滤。
