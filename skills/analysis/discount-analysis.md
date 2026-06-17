---
name: discount-analysis
version: v1.0
triggers:
  - 折扣
  - discount
  - 优惠
  - 打折
dependencies:
  - ../warehouse/references/metrics-policy.md
publish_targets:
  - claude-code
  - mcp
---

# Discount Analysis Skill

跨 domain 的折扣分析工作流。适用于任何含 `discount`、`sales` 字段的 domain。

## 分析步骤

1. 确认使用 KTX measure `weighted_discount`，不手写公式
2. 查有折扣 / 无折扣行数分布（掌握基数，无折扣行不可排除）
3. 计算整体加权平均折扣率：`SUM(discount*sales) / NULLIF(SUM(sales),0)`
4. 按折扣段分组（0%、0–20%、21–40%、>40%），对比各段利润率
5. 识别高折扣亏损区间（discount > 0.2 通常为亏损临界）
6. 结论注明口径：加权平均 vs 简单平均的差异

## 核心规则

- 禁止 `AVG(discount)`——改用 `weighted_discount` measure
- 禁止 `WHERE discount > 0` 后再聚合——无折扣行必须纳入基数
- 结论中注明：本文使用销售额加权平均折扣率

## Gotcha

加权均值（13.98%）与简单均值（15.54%）在 superstore 数据中相差 1.56pp。
向管理层汇报时，务必说明口径，避免混用。
