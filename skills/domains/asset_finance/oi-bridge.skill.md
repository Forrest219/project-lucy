---
name: oi-bridge
title: 经营利润桥
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
  - 经营利润桥
  - 营业利润桥
  - 利润桥
  - 量价
  - mix
  - 经营利润变动原因
description: asset_finance 默认财务场景。只取两期营业利润端点。现网没有量、价、mix、汇率驱动，禁止编造桥因子。
---

# 经营利润桥

用户要的是：对照期营业利润走到本期营业利润，中间柱是量、价、mix、成本效率、销售管理费用、研发、一次性项目、汇率。

现网只有科目级利润表，没有这些驱动。本 Skill 的合格回答是两端真实营业利润、空的因子清单，以及科目级变动明细。科目级变动不是驱动分解，必须标明。

标准因子顺序（有驱动事实之后才填数）：量、价/mix、工业或成本效率、销售管理费用、研发、其他、汇率。校验式：对照期营业利润 + 因子合计 = 本期营业利润。因子未知时，差额标「未解释」，不要把它算进任何一个因子。

## 数据

| 项 | 值 |
|----|----|
| 端点 | `v_pl_amount.pl_total_amount` 的营业利润 |
| 切片 | `company_code` + 单 `source_system` + 两期 `period_code` + `amount_type` |
| 默认切片 | 未指定时用 `kx_8` / `bx` / `actual`，`2025FY` 对 `2024FY` |
| 驱动事实 | 未建。不要查别的 schema 凑量价 |

营业利润锚点：kx `kx_item_83`（候选 `kx_item_140`）；zo `zo_is_018`；bx `bx_IS_137_三_营业利润_亏损以_号填列`；ksc `ksc_operating_loss`。名称带「三、营业利润」一类装饰，裸名精确匹配会空。

## 强制规则

1. 无驱动维时，禁止给出量、价、mix、汇率或其他因子的金额，也禁止用科目差额冒充这些因子。
2. 两端必须来自锚点码。跨期按「先 `item_code`，再装饰全名」。
3. 可以附科目级变动：相关科目的本期减对照期，加总应等于营业利润变动。这张明细要标成「科目变动，不是驱动桥」。
4. 不对 `v_pl_amount` 过滤 `statement_type`。单源，不与 `poc_zhio` 混查。
5. 只有驱动事实进入 `asset_finance` 并出现在 `lucy_catalog` 之后，才允许按因子顺序聚合并做两端校验。在那之前，状态保持「待补数」。

## 步骤

1. 按与对照利润表相同的切片，取对照期和本期营业利润。
2. 列出七个因子，金额留空，注明待补维。
3. 报告两端金额、差额，以及「差额未解释」。
4. 若展开科目，逐行给变动额并核对加总。
5. 回答第一句写明：当前不能做经营利润驱动桥，只能给出两端营业利润。单位元，写明公司、源和两期 `period_code`。
