---
name: dupont
title: 杜邦分解
version: 1.0.0
domain: asset_finance
status: published
owner: xingchen
roles_allowed: [demo_readonly, lucy_admin]
prerequisites:
  sources:
    - mysql-aliyun.asset_finance.v_pl_amount
    - mysql-aliyun.asset_finance.v_bs_amount
    - mysql-aliyun.asset_finance.dim_financial_item
  measures:
    - v_pl_amount.pl_total_amount
    - v_bs_amount.bs_total_amount
triggers:
  - 杜邦
  - 杜邦分析
  - ROE
  - 净资产收益率
  - 净利率
  - 资产周转
  - 权益乘数
description: asset_finance 默认财务场景。用净利率、总资产周转率和权益乘数分解 ROE。缺资产负债表锚点时只给出能算的部分，不用假数补树。
---

# 杜邦分解

回答「ROE 由净利率、周转和杠杆各贡献多少」。四源都有资产负债表行；半自动是因为科目名不统一，不是因为没有表。

```
ROE = 净利率 × 总资产周转率 × 权益乘数
    = 净利润/营业收入 × 营业收入/总资产 × 总资产/股东权益
```

现网没有应收、存货、固定资产周转天数的驱动明细。先不要展开这三支。

## 数据

| 项 | 值 |
|----|----|
| 利润表 | `v_pl_amount.pl_total_amount`：净利润、营业收入 |
| 资产负债表 | `v_bs_amount.bs_total_amount`：总资产、股东权益 |
| 期间 | 只用 `period_code`（以及双方都有的 `fiscal_year`）。资产负债表视图没有季、月列 |
| 默认切片 | 未指定时用 `kx_8` / `bx` / `actual` / `2025FY`。平均法还需要上一期资产负债表 |

## 强制规则

1. 先 `lucy_catalog`，确认两张视图都在，再 `lucy_query`。
2. 单公司、单 `source_system`。跨源拒绝合并。
3. 关键行用锚点码，禁止裸名精确匹配。多名或空结果时列出候选码并停止自动树。
4. ROE 乘积再与「净利润 / 股东权益」交叉校验。偏差超过 0.5 个百分点时标「不一致，查科目映射」，不要改口径凑平。
5. 缺总资产或权益时，只报能算的净利率；ROE、周转、乘数标「待补」。禁止用假数补树。
6. 不依赖现金流量表。不与 `poc_zhio` 混查。

| 角色 | kx | zo | bx | ksc |
|------|----|----|----|-----|
| 营业收入 | `kx_item_63` | `zo_is_002` | `bx_IS_105_其中_营业收入` | `ksc_total_revenue` |
| 净利润 | `kx_item_94` | `zo_is_023` | `bx_IS_142_五_净利润_净亏损以_号填列` | `ksc_net_loss` |
| 总资产 | `kx_item_57` | `zo_bs_021` | `bx_BS_045_资产总计` | `ksc_total_assets` |
| 股东权益 | `kx_item_56` | `zo_bs_044` | `bx_BS_101_所有者权益_或股东权益_合计` | `ksc_total_equity` |

## 步骤

1. 用 `company_code`、单源、`period_code` 对齐利润表和资产负债表。
2. 按锚点取净利润、营业收入、总资产、股东权益。需要核对名称时再查 `dim_financial_item` 的 `aggregation_role`，避免把小计当端点。
3. 计算并标明资产口径：
   - 净利率 = 净利润 / 营业收入
   - 总资产周转率 = 营业收入 / 总资产。两个 `period_code` 的资产都在时，优先用平均资产，并同时给出期末法
   - 权益乘数 = 总资产 / 股东权益。平均法与期末法使用同一套资产口径
   - ROE = 三者相乘
4. 平均法缺上一期资产负债表时，该行标「待补」，期末法仍可报。
5. 回答给出四个端点的 `item_code`、`period_code`、金额，两种口径的三因子和 ROE，以及交叉校验差。单位为元。写明单源。
