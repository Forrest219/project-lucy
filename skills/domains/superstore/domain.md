# Superstore Domain Reference

> 类型：Domain Reference Doc（不是 Skill）
> 加载方式：由 Knowledge Skill 在检测到 superstore 相关查询时按需加载
> 数据源：dataforai.superstore_orders / superstore_returns / superstore_people

## Quick Reference

- **Canonical fact table**: `dataforai.superstore_orders`
- **Default date field**: `order_date`
- **Default grain**: 每行 = 一条订单明细（`row_id` 唯一）
- **Standard filter**: `WHERE is_deleted = 0`
- **Date range**: 约 4 年（2020–2023）
- **Row count**: 10,194 行（batch superstore_20260617_120212）

## Business Context

Tableau 示例超市数据集，中国零售业务。
回答问题类型：销售趋势、品类利润、折扣策略、区域对比、客户细分、退货影响。

## Entity Grain

| 表 | 一行代表 |
|----|---------|
| `superstore_orders` | 一个订单中的一个产品明细行 |
| `superstore_returns` | 一笔退货记录（一个 order_id） |
| `superstore_people` | 一个区域的负责经理 |

## Key Measures（使用 KTX measures，不手写公式）

| KTX Measure | 含义 |
|-------------|------|
| `weighted_discount` | 销售额加权平均折扣率 |
| `profit_margin` | 利润率 |
| `order_count` | 订单数 |
| `total_sales` | 销售总额 |
| `total_profit` | 利润总额 |
| `customer_count` | 去重客户数 |
| `avg_order_value` | 客单价 |
| `loss_row_count` | 亏损明细行数 |

## Dimensions

| 概念 | 字段 | 枚举值 |
|------|------|--------|
| 客户细分 | `segment` | 消费者 / 公司 / 小型企业 |
| 产品大类 | `category` | 技术 / 办公用品 / 家具 |
| 大区 | `region` | 华东 / 华北 / 华南 / 西南 / 西北 / 华中 |
| 装运模式 | `ship_mode` | 一级 / 二级 / 标准 / 当日 |

## Key Tables

**superstore_orders** — 所有销售分析的起点
- 何时用：订单 / 产品 / 客户 / 时间趋势分析
- JOIN key：`order_id`（→ returns）、`region`（→ people）

**superstore_returns** — 退货分析
- 使用方式：`LEFT JOIN superstore_orders ON order_id`
- 注意：`returned` 字段值为中文 `'是'`，非 `'Yes'`

**superstore_people** — 区域经理
- 使用方式：`JOIN superstore_orders ON region`

## Cross-References

- 常见错误 → `pitfalls.md`
- 折扣口径 → `discount-policy.md`
- 表选择规则 → `../../warehouse/references/table-routing.md`
- 折扣分析程序 → `../../analysis/discount-analysis.md`
- 利润拆解程序 → `../../analysis/profit-decomposition.md`
