---
name: profit-decomposition
version: v1.0
triggers:
  - 利润
  - profit
  - 亏损
  - 利润率
  - 为什么亏
dependencies:
  - ../warehouse/references/metrics-policy.md
publish_targets:
  - claude-code
  - mcp
---

# Profit Decomposition Skill

跨 domain 的利润拆解工作流。适用于任何含 `profit`、`sales` 字段的 domain。

## 分析路径

1. 确认使用 KTX measure `profit_margin`，不手写公式
2. 按大类维度拆解（品类 / 区域 / 细分，视问题选择）
3. 按折扣段分析（>20% 折扣段利润率是否为负）
4. 退货关联：`LEFT JOIN superstore_returns` 确认退货对利润的影响
5. 用 `loss_row_count` measure 定位亏损集中的子类别

## 核心规则

- 利润率 = `SUM(profit) / NULLIF(SUM(sales), 0)`，禁止 `AVG(profit/sales)`
- 负利润行（亏损行）不可过滤——亏损行是分析的核心对象
- 历史数据发现（如"某区域利润偏低"）属 dated finding，不写入本 Skill
  → 请记录到 `wiki/<domain>/findings-YYYYMMDD.md`，标注观察时间

## 分析产出格式

```
利润率：XX%（SUM/SUM 口径）
最高利润类别：XX（利润率 XX%）
最低利润类别：XX（利润率 XX%，折扣率 XX%）
亏损集中点：折扣 > 20% 的明细行，占总行数 XX%，贡献利润 XX 元
```
