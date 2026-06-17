# Discount Policy

## Quick Reference

- **字段**：`discount`（DECIMAL(10,6)，范围 0-1）
- **含义**：行级折扣率（例：0.2 = 打八折）
- **KTX measure**：`weighted_discount`
- **禁止写法**：`AVG(discount)`

## 正确聚合公式

```sql
SUM(discount * sales) / NULLIF(SUM(sales), 0)
```

理由：折扣率必须以销售额为权重。不同商品销售额差异显著，用简单平均会高估整体折扣水平。

## 实测数据（superstore_orders，batch 20260617_120212）

| 聚合方式 | 结果 |
|---------|------|
| 简单平均 AVG(discount) | 15.54% |
| 加权平均 SUM(d\*s)/SUM(s) | **13.98%** |
| 差距 | 1.56 个百分点 |

## 使用例外

用户明确要求「每行折扣的简单平均」时，允许使用 `AVG(discount)`，但必须在回答中注明：
> 注：此处使用简单平均折扣率（非销售额加权），结果为 15.54%。业务标准口径（加权）为 13.98%。

## 高折扣区间

- 折扣 > 20% → `high_discount` segment，通常对应亏损区间
- 折扣 = 0 → 无折扣行，**不可排除**，应纳入加权平均分母
