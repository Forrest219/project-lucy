---
sl_refs:
  - demo-exec-mysql/dataforai/fct_sales_margin
  - demo-exec-mysql/dataforai/fct_sales_margin_regional
---

# Executive POC：权限与脱敏（VIEW + ACL）

## 机制

Lucy 通过 **角色可见表集合** 编译权限，不是运行时 Dynamic RLS。

| 角色 | 可见 source | 说明 |
|---|---|---|
| exec_cfo_readonly | fct_sales_margin | 全国 + 完整 customer_phone |
| exec_sales_regional | fct_sales_margin_regional | 仅华南 + phone 掩码 |

## Demo 流程

同一问题「各团队业绩毛利率与客户联系方式」：

- CFO token → 可见全国明细
- Regional token → 仅华南 + `customer_phone_masked`

## 对外口径

不要说「SQL 自动注入 WHERE」；应说 **权限编译到可见表与列（VIEW）**。
