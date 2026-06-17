---
name: reviewer
description: 高风险数据回答输出前的 9 项审查清单。覆盖财务指标、跨表 JOIN、领导汇报、因果分析场景。
scope: dataforai (超市 domain)
---

# Reviewer — 9 项高风险审查清单

## 何时触发

回答中包含以下任一信号时，**回答输出前**必须按本清单逐项检查并在回答末尾附 ✓/✗ 矩阵：

- **财务指标**：利润、利润率、折扣、折扣率、收入、销售额、客单价
- **跨表 JOIN**：涉及 `superstore_orders` ↔ `superstore_returns` / `superstore_people`
- **领导汇报**：用户措辞包含"给老板看"、"汇报"、"周报"、"总结"
- **因果分析**：用户措辞包含"为什么"、"原因"、"导致"、"归因"

## 9 项清单

| # | 检查项 | 通过判据 | 失败处置 |
|---|---|---|---|
| 1 | **走语义层** | SQL 由 `sl_query` 生成或调用了 measure，不是手写 raw SQL | 转 `sl_query`，或在回答头部显式声明 "raw SQL fallback，假设：..." |
| 2 | **软删过滤** | `WHERE is_deleted = 0` 已添加到所有事实表 | 加上；如刻意不加（如审计全量），显式说明 |
| 3 | **加权指标** | 折扣率 / 利润率 / 客单价用 `SUM(x)/NULLIF(SUM(y),0)`，**未用** `AVG(per_row_ratio)` | 改用 measure 或加权公式（见 `wiki/global/discount-policy.md`、`profit-rule.md`） |
| 4 | **负利润保留** | 利润率分析**未** 出现 `WHERE profit > 0` / `HAVING SUM(profit) > 0` 等过滤 | 删过滤；如确实要算"盈利单的利润率"，必须是另一个明确命名的指标，不能叫 `profit_margin` |
| 5 | **退货 grain 正确** | 用 `superstore_returns` JOIN `orders` 时，没把同订单多 line item 都标记 returned；按需在 returns 端先 `DISTINCT order_id` 或用 `IN (SELECT ...)` | 改写 join；参考 `wiki/global/return-semantics.md` |
| 6 | **JOIN 声明** | 使用的 join 已在 `semantic-layer/.../*.yaml` 的 `joins:` 块中存在 | 已声明 → ✓；未声明 → 显式标注"使用未声明的 join，假设 cardinality 为 X"|
| 7 | **时间 grain 一致** | 行级 (row_id) / 订单级 (order_id) / 月度 (`DATE_FORMAT(order_date,'%Y-%m')`) 在同一查询里不混用；分子分母 grain 对齐 | 拆查询或先聚合再求比 |
| 8 | **Provenance Footer** | 回答末尾附 6 行 footer：source tier / tables / measures / freshness / validation / assumptions | 补全；任何一项空缺需写 `n/a` 并解释 |
| 9 | **风险标注** | 因果 / 汇报场景下，显式列出至少 1 条 "限于样本范围"、"未控制 X 变量" 类假设 | 补一句 "本结论基于 Tableau 超市样本 N 年数据，未考虑 ..." |

## 输出格式（强制）

在最终回答末尾追加：

```
### Review Matrix
1. 走语义层      ✓ / ✗（原因）
2. 软删过滤      ✓ / ✗
3. 加权指标      ✓ / ✗
4. 负利润保留    ✓ / ✗  (n/a 若非利润分析)
5. 退货 grain    ✓ / ✗  (n/a 若不涉及 returns)
6. JOIN 声明     ✓ / ✗  (n/a 若单表)
7. 时间 grain    ✓ / ✗
8. Provenance    ✓ / ✗
9. 风险标注      ✓ / ✗
```

**任一 ✗ 不得直接发出**：要么修后重检，要么在回答正文（非 footer）顶部用一行 `⚠️ 已知局限：...` 显式声明。

## 模型建议

reviewer 跑在 Claude Code 主会话里，模型由用户 `/model` 选定。对财务汇报场景建议切到 **opus**；常规审查 sonnet 足够。

## 参考

- `wiki/global/discount-policy.md` — 折扣率口径
- `wiki/global/profit-rule.md` — 利润 / 负值处理
- `wiki/global/return-semantics.md` — 退货 grain
- `CLAUDE.md` — 触发条件、provenance footer 模板
- `semantic-layer/mysql-aliyun/_schema/dataforai.yaml` — measures / joins 单一事实源
