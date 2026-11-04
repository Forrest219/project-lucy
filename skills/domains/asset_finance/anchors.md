# asset_finance 科目锚点

> 类型：Domain Reference（不是 Skill）。Agent 只读到单个 Skill 正文时，以该 Skill 内嵌的锚点表为准；本文件给维护者对照。

连接 `mysql-aliyun`，schema `asset_finance`。默认吃广告视图 `v_pl_amount` / `v_bs_amount` / `v_cf_amount`。四源 `kx` / `zo` / `bx` / `ksc` 科目前缀并存，禁止跨 `source_system` 加总。

科目展示名常带装饰前缀。禁止用「营业收入」「净利润」「资产总计」对 `item_name_cn` 做精确等值过滤。优先用 `item_code`；不确定时 `contains` 拉候选再点选。

| 角色 | kx | zo | bx | ksc |
|------|----|----|----|-----|
| 营业收入 / 总收入 | `kx_item_63`（一、营业收入） | `zo_is_002`（其中：营业收入）；总收入 `zo_is_001` | `bx_IS_105_其中_营业收入`；总收入 `bx_IS_104_一_营业总收入` | `ksc_total_revenue` |
| 营业成本 | `kx_item_64` | `zo_is_004` | `bx_IS_110_其中_营业成本` | `ksc_cogs` |
| 营业利润 / 经营亏损 | `kx_item_83`；候选 `kx_item_140` | `zo_is_018` | `bx_IS_137_三_营业利润_亏损以_号填列` | `ksc_operating_loss` |
| 净利润 / 净亏损 | `kx_item_94`；候选 `kx_item_151` | `zo_is_023`；归母 `zo_is_025` | `bx_IS_142_五_净利润_净亏损以_号填列` | `ksc_net_loss` / `ksc_parent_net_loss` |
| 总资产 | `kx_item_57` | `zo_bs_021` | `bx_BS_045_资产总计` | `ksc_total_assets` |
| 股东权益 | `kx_item_56` | `zo_bs_044`；归母 `zo_bs_043` | `bx_BS_101_所有者权益_或股东权益_合计`；归母 `bx_BS_242` 前缀 | `ksc_total_equity` / `ksc_parent_equity` |

锚点抽自 `dim_financial_item`（2026-11-01）。执行前用 `lucy_query` 复核该码是否仍在。

视图 `joins` 为空，没有 `statement_type`、没有 `company_id`。切片公司用 `company_code`。树、大类、父级要再查 `dim_financial_item`，按 `item_code` 对齐。`statement_type` 只出现在维度或事实表。

用户未指定切片时，默认演示切片是 `company_code=kx_8`、`source_system=bx`、`amount_type=actual`。对照用 `2025FY` 与 `2024FY`。桑基默认单期 `2025FY`。

`ksc` 金额已按千元乘 1000 入元。EPS 映射为忽略，不进事实、不进比率。不与 `poc_zhio` 混查。不写出口令或连接串。
