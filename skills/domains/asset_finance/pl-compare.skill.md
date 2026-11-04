---
name: pl-compare
title: 对照利润表
version: 1.0.0
domain: asset_finance
status: published
owner: xingchen
roles_allowed: [demo_readonly, lucy_admin]
prerequisites:
  sources:
    - mysql-aliyun.asset_finance.v_pl_amount
    - mysql-aliyun.asset_finance.dim_financial_item
    - mysql-aliyun.asset_finance.dim_company
    - mysql-aliyun.asset_finance.dim_reporting_period
  measures:
    - v_pl_amount.pl_total_amount
triggers:
  - 对照利润表
  - 利润表同比
  - 利润表环比
  - 营业收入变动
  - 毛利率变动
  - 净利率变动
description: asset_finance 默认财务场景。按单源、单公司做利润表本期与对照期对照，给出金额差、变动率和利润率百分点差。
---

# 对照利润表

在 `asset_finance` 上回答「这期利润表相对上期变了什么」。扁平对照可以直接算。科目树要第二次查维度；拼不出树时仍给出扁平对照，并说明未拼树。

## 数据

| 项 | 值 |
|----|----|
| 连接 / Schema | `mysql-aliyun` / `asset_finance` |
| 主视图 | `v_pl_amount` |
| 金额 | `v_pl_amount.pl_total_amount`（`sum(amount)`，元） |
| 切片 | `company_code` + 单个 `source_system` + `amount_type` |
| 默认切片 | 未指定时用 `kx_8` / `bx` / `actual`，本期 `2025FY`，对照期 `2024FY` |

## 强制规则

1. 先 `lucy_catalog`，再 `lucy_query`。不要手写 JDBC，不要默认穿透事实大表。
2. 不对 `v_pl_amount` 过滤 `statement_type`。公司用 `company_code`，不用 `company_id`。
3. 一次只答一个 `source_system`。`kx` / `zo` / `bx` / `ksc` 禁止加总，也不要说成集团合并。
4. 关键行用下表 `item_code`。禁止用「营业收入」「净利润」做精确等值过滤。
5. 跨期对齐顺序：先本期码精确命中对照期；未中则用带装饰前缀的全名配对；仍未中则两期各占一行，空的一期标「该期无事实行」，不要丢掉。
6. 变动额 = 本期 − 对照期。变动率 = 变动额 / |对照期|；对照期为 0 时标不可计算，不要和「无事实行」混成同一个空值。利润率之差用百分点。
7. `ksc` 已换算成元。EPS 不进表。不与 `poc_zhio` 混查。

| 角色 | kx | zo | bx | ksc |
|------|----|----|----|-----|
| 营业收入 / 总收入 | `kx_item_63` | `zo_is_002`；总收入 `zo_is_001` | `bx_IS_105_其中_营业收入`；总收入 `bx_IS_104_一_营业总收入` | `ksc_total_revenue` |
| 营业成本 | `kx_item_64` | `zo_is_004` | `bx_IS_110_其中_营业成本` | `ksc_cogs` |
| 营业利润 | `kx_item_83` | `zo_is_018` | `bx_IS_137_三_营业利润_亏损以_号填列` | `ksc_operating_loss` |
| 净利润 | `kx_item_94` | `zo_is_023` | `bx_IS_142_五_净利润_净亏损以_号填列` | `ksc_net_loss` |

`bx` / `zo` 不要把「营业总收入」和「其中：营业收入」重复加进同一行。

## 步骤

1. 定公司、源、本期与对照期。期间用 `period_code`，或利润表视图上的 `fiscal_year` + `fiscal_quarter`。
2. 查 `v_pl_amount`：度量 `pl_total_amount`，维度至少含 `item_code`、`item_name_cn`、`period_code`，过滤公司、源、两期、`amount_type`。
3. 关键行先按锚点码取。对照期按「先码、后全名」对齐，并记下对齐方式：`item_code`、全名兜底、仅本期、仅对照期。
4. 需要科目树时再查 `dim_financial_item`（`statement_type=PL` 或 segment `pl_items`），取 `parent_item_id`、`sort_order`、`section_code`，按 `item_code` 在回答里拼树。没有父级或顺序时按勾稽顺序给扁平表，并写明未拼树。
5. 回答先给关键行（收入、成本、毛利、营业利润、净利润）和毛利率、营业利润率、净利率的本期、对照期、百分点差，再按需展开其余科目。表头写明公司、`company_code`、源、币种元、两期 `period_code`。

## 回答里要留下的口径

- 单源，禁止与其他源加总。
- 对齐方式，以及锚点在两期的实际码是否漂移。
- 空值是「该期无事实行」还是「对照期为 0」。
- 未拼树时写明。
