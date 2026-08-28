---
sl_refs:
  - demo-exec-mysql/dataforai/fct_order_line_daily
  - demo-exec-mysql/dataforai/mv_order_quarterly_rollup
---

# Executive POC：明细 vs 预聚合（MV 等价层）

## 路由

| 问题粒度 | 首选 source |
|---|---|
| 季度 × 区域 × 品类 聚合 | `mv_order_quarterly_rollup` |
| 明细钻取、日级 | `fct_order_line_daily` |

## 演示叙事

MySQL 预聚合表等价于生产环境 StarRocks 异步 MV 命中层；语义层 measure 不变，底层引擎可替换。

## 验证

同维度 `total_sales` 在 MV 与明细聚合结果应一致（容差 0.01%）。
