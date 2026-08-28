---
sl_refs:
  - demo-exec-mysql/dataforai/fct_channel_pl_monthly
  - demo-exec-mysql/dataforai/vw_channel_pl_consumer
  - demo-exec-mysql/dataforai/dim_channel
---

# Executive POC：跨境渠道损益（SC / VC）

## 何时使用

- 亚马逊 SC 自营 vs VC 寄售毛利率、平台费占比
- 按渠道/子公司/月份的 P&L 经营分析
- 财务 BP 查看消费事业群渠道（`vw_channel_pl_consumer`）

## 首选 source

| 用户意图 | source |
|---|---|
| 渠道收入、毛利、平台费、毛利率 | `fct_channel_pl_monthly` |
| 消费事业群 BP 视角 | `vw_channel_pl_consumer` |
| 渠道名称、SC/VC 模式 | `dim_channel` |

## 口径

- 毛利 = `revenue - platform_fee - cogs`（已在表内预计算 `gross_margin`）
- 毛利率 = `sum(gross_margin) / sum(revenue)`，禁止 AVG 行级比率
- 平台费占比 = `sum(platform_fee) / sum(revenue)`

## 禁止事项

- **禁止**用 `fct_acquisition_monthly`（获客 spend/CAC）回答渠道 P&L
- **禁止**用 `fct_fulfillment_order` 履约时长替代毛利率
- VC 平台费通常显著高于 SC；Q2 2026 演示数据中 SC 毛利率应高于 VC

## 演示问句

> Q2 亚马逊 SC 与 VC 渠道谁毛利率更高？平台费占收入比各是多少？
