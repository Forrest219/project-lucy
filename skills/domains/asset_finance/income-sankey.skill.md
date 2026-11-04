---
name: income-sankey
title: 收支桑基
version: 1.0.0
domain: asset_finance
status: published
owner: xingchen
roles_allowed: [demo_readonly, lucy_admin]
prerequisites:
  sources:
    - mysql-aliyun.asset_finance.v_pl_amount
    - mysql-aliyun.asset_finance.dim_financial_item
  measures:
    - v_pl_amount.pl_total_amount
triggers:
  - 收支桑基
  - 桑基
  - 收入到利润
  - 利润怎么来的
  - 毛利到营业利润
description: asset_finance 默认财务场景。把单期利润表收成收入、成本、费用到利润的流向。没有产品或地区拆分维时收入只留一个节点，不编造分支。
---

# 收支桑基

回答「这一期的收入怎么流到成本和利润」。只有科目汇总时可以做大类近似。这和经营利润桥不同：桥没有量价因子就不能拆驱动，桑基可以按科目大类说明流向。

流向：收入 → 营业成本与毛利 → 期间费用 → 营业利润 → 净利润。父节点流出等于子节点流入。对不上的差额单列「轧差」或「未分配」，禁止静默丢掉。

## 数据

| 项 | 值 |
|----|----|
| 主视图 | `v_pl_amount.pl_total_amount` |
| 大类 | 再查 `dim_financial_item` 的 `section_code`、`parent_item_id`、`sort_order` |
| 切片 | 一个 `company_code`、一个 `source_system`、一个 `period_code` |
| 默认切片 | 未指定时用 `kx_8` / `bx` / `actual` / `2025FY` |

对照期不要画进同一条流。要对比就分开两期说明。

## 强制规则

1. 不对 `v_pl_amount` 过滤 `statement_type`。视图不能一跳带出科目树。
2. 没有收入拆分维（产品、地区、客户）时，收入侧只有一个节点。禁止为了好看编造分支。
3. `bx` / `zo` 不要把「营业总收入」和「其中：营业收入」都算进收入。
4. 勾稽：收入 − 营业成本 ≈ 毛利；毛利 − 期间费用 − 其他经营损益 ≈ 营业利润。其他经营损益为负时按带符号金额计入，并在说明里写清符号，不要把负项变成正项后还声称守恒。
5. 单源。不与 `poc_zhio` 混查。EPS 不进流向。

| 节点 | 锚点 |
|------|------|
| 营业收入 | kx `kx_item_63`；zo `zo_is_002` 或总收入 `zo_is_001`；bx 总收入 `bx_IS_104_一_营业总收入`；ksc `ksc_total_revenue` |
| 营业成本 | kx `kx_item_64`；zo `zo_is_004`；bx `bx_IS_110_其中_营业成本`；ksc `ksc_cogs` |
| 期间费用 | 销售、管理、研发、财务费用，按名称 contains 折叠。ksc 可用 `ksc_ga_expense`、`ksc_rd_expense`、`ksc_opex_total` |
| 营业利润 | kx `kx_item_83`；zo `zo_is_018`；bx `bx_IS_137_三_营业利润_亏损以_号填列`；ksc `ksc_operating_loss` |
| 净利润 | kx `kx_item_94`；zo `zo_is_023`；bx `bx_IS_142_五_净利润_净亏损以_号填列`；ksc `ksc_net_loss` |

## 步骤

1. 定单期切片。
2. 查 `v_pl_amount` 的科目金额。关键行用锚点码。
3. 再查 `dim_financial_item`，按 `section_code` 和名称把成本、费用折成大类。
4. 列出每条边的起点、终点、金额和符号。先报守恒是否通过，再描述流向。
5. 回答标题写明公司、源、`period_code`，以及「无收入拆分维，收入为单节点」。单位元。
