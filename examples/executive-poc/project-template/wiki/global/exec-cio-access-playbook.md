---
sl_refs:
  - demo-exec-mysql/dataforai/fct_sales_margin
  - demo-exec-mysql/dataforai/fct_sales_margin_regional
  - demo-exec-mysql/dataforai/fct_channel_pl_monthly
  - demo-exec-mysql/dataforai/vw_channel_pl_consumer
---

# Executive POC：权限与脱敏（VIEW + ACL）

## 机制

Lucy 通过 **角色可见表集合** 编译权限，不是运行时 Dynamic RLS。

| 角色 | 可见 source | 说明 |
|---|---|---|
| exec_cfo_readonly | fct_sales_margin, fct_channel_pl_monthly, vw_gl_* | 全国财务 + 渠道 + GL |
| exec_bp_consumer_readonly | vw_channel_pl_consumer | 仅消费事业群渠道 P&L |
| exec_sales_regional | fct_sales_margin_regional | 仅华南 + phone 掩码 |

## Demo 流程

**CFO-7（行级 ACL）**：同一问题「Q2 SC 渠道毛利率」

- CFO token → 可查 `fct_channel_pl_monthly` 全渠道全实体
- BP token → 仅 `vw_channel_pl_consumer`；拒绝 `fct_channel_pl_monthly` 与 GL 表

**CIO-6（销售脱敏）**：

- CFO token → 可见全国 margin + 完整 customer_phone
- Regional token → 仅华南 + `customer_phone_masked`

## 对外口径

不要说「SQL 自动注入 WHERE」；应说 **权限编译到可见表与列（VIEW）**。
