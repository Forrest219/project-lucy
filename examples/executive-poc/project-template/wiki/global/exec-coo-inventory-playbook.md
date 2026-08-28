---
sl_refs:
  - demo-exec-mysql/dataforai/fct_inventory_health_daily
  - demo-exec-mysql/dataforai/dim_warehouse
---

# Executive POC：库存周转与双向预警

## 何时使用

- 滞销（DOS > 60）
- 断货风险（DOS < 7 且无在途 PO）

## 口径

`days_of_supply` 已在表内预计算；禁止 Agent 自行写窗口函数重算。

## 推荐 segment

| 场景 | segment | 仓库 region |
|---|---|---|
| 华南滞销 | slow_moving | South_China |
| 华东断货 | stockout_risk | East_China |
