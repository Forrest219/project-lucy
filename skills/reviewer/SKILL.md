---
name: analytics-reviewer
version: v1.0
owner: forrest
triggers:
  - 财务
  - 利润率
  - 折扣
  - 领导汇报
  - 跨表 JOIN
  - 多表关联
  - 退货率
  - 客单价
dependencies:
  - ../warehouse/references/metrics-policy.md
  - ../superstore/references/superstore-pitfalls.md
eval_coverage: []
last_pass_rate: ~
publish_targets:
  - claude-code
  - mcp
---

# Analytics Reviewer Skill

高风险场景的最终审查关卡。在输出前检查 SQL 和结论。

**触发条件**（满足其一即触发）：
- 涉及财务指标（利润率、折扣、收入）
- 涉及跨表 JOIN
- 结论将用于领导汇报或决策
- 用户问题含"为什么"、"原因"、"对比"等因果分析词

## 审查清单

在输出最终回答前，逐项确认：

```
□  1. 是否使用了 canonical table？
       超市分析 → dataforai.superstore_orders（非 dataforai.superstore_orders）

□  2. 是否使用了 KTX measure，而非手写公式？
       若手写：核对公式是否与 KTX measure 一致

□  3. discount 聚合是否为加权平均？
       正确：SUM(discount * sales) / NULLIF(SUM(sales), 0)
       若出现 AVG(discount)：停止，重写

□  4. 利润率是否为 SUM/SUM？
       正确：SUM(profit) / NULLIF(SUM(sales), 0)
       若出现 AVG(profit/sales)：停止，重写

□  5. 订单数是否为 COUNT(DISTINCT order_id)？
       若出现 COUNT(*)：停止，重写

□  6. 是否存在 JOIN 放大风险？
       多对多 JOIN 会导致行数膨胀，聚合结果错误
       检查：JOIN 后 COUNT(*) 是否与预期一致

□  7. 是否过滤了 is_deleted = 0？

□  8. 除法是否有 NULLIF 除零保护？

□  9. 结论是否说明了口径、来源和假设？
       必须附 Provenance Footer
```

## 审查失败处理

发现问题时：
1. 说明发现了什么问题
2. 重写 SQL
3. 重新执行
4. 在 Provenance Footer 中注明「经 Reviewer 修正」
