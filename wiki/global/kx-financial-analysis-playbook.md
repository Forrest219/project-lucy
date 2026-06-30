# KX 财务分析口径与公司别名

> 适用：`dataforai` KX 财务报表域，面向 `wiki_search` / `wiki_read` 解决“柯西公司”“2026 年经营情况”等自然语言问题。

## 实体别名

“柯西公司”“柯西”“KX 公司”默认指同一家公司：

| 别名 | 规范值 |
|---|---|
| 公司全称 | `深圳市柯西信息科技有限公司` |
| 公司维表 | `dataforai.kx_dim_company` |
| 关联键 | `company_id = 1` |
| 财报事实表 | `dataforai.kx_fact_financial_amount` |

查公司名称时必须通过：

```sql
kx_fact_financial_amount.company_id = kx_dim_company.company_id
```

不要从 `source_file_name`、`source_sheet_name` 或文件名解析公司名；这些字段只用于数据追溯。

## 表路由

| 用户问题 | 首选 source |
|---|---|
| 资产负债率、流动比率、资产/负债/权益合计 | `kx_vw_balance_sheet_detail` |
| 资产负债表关键行、按行次展示资产负债表 | `kx_vw_balance_sheet_detail` |
| 营业收入、营收、毛利率、净利率、利润摘要 | `kx_vw_income_statement_detail` |
| 每月营业收入 | `kx_vw_income_statement_detail`，使用 `本月金额` |
| 截至 Q1 收入/利润 | `kx_vw_income_statement_detail`，使用 `本年累计金额` + `期间季度标签` |
| 经营/投资/筹资现金流量净额 | `kx_vw_cash_flow_statement_detail` |
| 期末现金余额 | `kx_vw_cash_flow_statement_detail` |
| 科目底层金额明细、跨期间明细金额 | `kx_fact_financial_amount` JOIN `kx_dim_financial_item` |
| 单季度发生额、amount_type、quarter_no、来源追溯 | `kx_fact_financial_amount` |
| 财报项目解释、项目归属、报表类型 | `kx_dim_financial_item` |

报表展示口径优先走三张 `kx_vw_*_detail` 视图；底层金额明细和建模口径走
`kx_fact_financial_amount`。用户通常会说“营业收入”“营收”“净利润”等中文科目或指标，
不要要求用户提供 item_id。

## 时间口径

- “2026 年”默认映射为 `fiscal_year = 2026`。
- 当前 KX 快照中，2026 年已有报表期间为 `202601` 到 `202605`。
- 用户未指定月份时，默认按当前最大 `report_period` 做“截至该期间”的分析，并在回答中说明数据不是完整全年。
- 如果使用中文明细视图，时间字段对应 `报表期间` / `报表日期`。
- 语义层视图派生了 `期间年份`、`期间月份`、`期间月份标签`、`期间季度`、`期间季度标签`、`是否季末月份`。
  例如“2026Q1”优先用 `期间季度标签 = '2026Q1'`，不要每次手写裸字符串范围。

## 金额口径

| 报表 | 默认金额口径 | 事实表过滤 |
|---|---|---|
| 利润表 | 本年累计金额；必要时补充本月金额 | `statement_type = 'income_statement'`，优先 `amount_type = 'year_to_date'` |
| 现金流量表 | 本年累计金额；必要时补充本月金额 | `statement_type = 'cash_flow'`，优先 `amount_type = 'year_to_date'` |
| 资产负债表 | 期末余额；必要时补充年初余额 | `statement_type = 'balance_sheet'`，优先 `amount_type = 'end_balance'` |

默认规则：

- 资产负债表默认使用 `期末余额`。
- 利润表默认使用 `本年累计金额`。
- 现金流量表默认使用 `本年累计金额`。
- “每月 / 月度”默认使用 `本月金额`。
- “截至 Q1 / 截至 3 月”使用累计口径。
- “单季度发生额”走 fact 的季度口径，不要用视图猜。

`amount` 为 NULL 表示原始报表为空。不要默认把 NULL 当 0；只有在业务明确要求补零展示时才使用 `COALESCE`，并在回答中说明。

## “经营情况”默认分析框架

用户问“使用 ktx 分析 柯西公司 2026 年的经营情况”时，至少覆盖：

1. 数据范围：公司为 `深圳市柯西信息科技有限公司`，`company_id = 1`，期间为 2026 年当前可用报表期间。
2. 利润表：收入、营业成本、期间费用、营业利润、利润总额、净利润等关键项目。
3. 资产负债表：资产总计、负债合计、所有者权益合计；说明使用期末余额。
4. 现金流量表：经营活动、投资活动、筹资活动现金流量净额；说明使用本年累计金额。
5. 异常与边界：金额 NULL 不等于 0；不要套用 Superstore 的 `is_deleted = 0` 过滤。
6. Provenance：列明使用的 KX 表/视图、期间、金额口径和是否使用 raw SQL fallback。

## 禁止事项

- 不要查询 `superstore_*` 表回答 KX 财务问题。
- 不要给 KX 财务表加 `is_deleted = 0`；KX 表没有该字段。
- 不要从源文件名解析公司或报表项目。
- 不要把不同 `amount_type` 混加后当成一个财务指标。
