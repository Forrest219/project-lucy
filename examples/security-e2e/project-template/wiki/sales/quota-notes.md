---
summary: 销售团队订单口径备注。
allowed_roles: [sales_reader]
sl_refs: [sales-db/orders_masked]
---

# 销售订单口径

{{CANARY_SALES_WIKI}}

订单数使用 `COUNT(DISTINCT order_id)`，区域取 `region` 字段。
