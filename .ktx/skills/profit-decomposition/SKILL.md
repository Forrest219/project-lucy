---
name: profit-decomposition
description: 超市 domain 利润拆解 workflow。回答"利润为什么涨/跌"、"利润 TOP/BOT"、"利润率结构"类问题时按此步骤执行。
scope: dataforai (超市 domain)
---

# Profit Decomposition Workflow

## 何时触发

用户问题命中以下信号时调用本 workflow：

- 利润、利润率、毛利、净利
- "为什么利润 X"（X = 涨/跌/亏损/低于预期）
- 利润 TOP / 排名 / 贡献分析
- "亏损类目/客户/订单"
- 利润率结构 / 利润分布

不触发：纯销售额、订单量（除非涉及利润口径）。

## 公式与口径

**严格遵循 `wiki/global/profit-rule.md`，本 skill 不再重复。**

核心铁律：
- 利润可为负，**禁止** `WHERE profit > 0` 后再算利润率
- 利润率 = `SUM(profit) / NULLIF(SUM(sales), 0)`，分子分母同 grain 同过滤
- "亏损单"是合法过滤（`WHERE profit < 0`），但产出的指标必须改名（叫 `loss_amount`、`loss_order_count`），不能再叫 `profit_margin`

## 8 步执行清单

### Step 1 — 确认分析意图
回答前先内部判断属于哪类：

| 意图 | 输出形态 |
|---|---|
| 利润 TOP / BOT 排名 | 排序 + LIMIT，列出每行的 `sales / profit / profit_margin / order_count` |
| 利润同比/环比 | 两期对比表 + 差值 + 差异率（差异率必须基于绝对值，避免分母接近 0 时翻倍效应） |
| 利润为什么 X（因果） | **必触发 reviewer**，按下面 Step 6 拆解 |
| 利润率结构 | 维度切片 + 加权利润率 + 占比 |

### Step 2 — 选维度
建议拆解维度（按优先级）：
1. **类目 / 子类目** — 商品结构问题
2. **区域 / 子区域** — 地理与渠道问题
3. **客户细分 (Segment)** — 客群结构问题
4. **折扣区间** — 定价问题（联合调用 discount-analysis skill）
5. **时间** — 趋势与季节

不要堆 5+ 维度，每个维度独立出表。

### Step 3 — 走语义层
- `sl_query` + `profit_margin` / `total_sales` / `order_count` measures
- `profit_margin` 当前定义在 `superstore_orders`，按行级 grain；上钩到类目维度无需调整

### Step 4 — 保留亏损行（强约束）
**任何利润率分析**都必须明确：
- `default_filters: ["is_deleted = 0"]` 已在 sl 内，不要再叠加 profit 过滤
- 若 raw SQL fallback，回答头部声明 "包含亏损行" 字样
- 如果发现某维度组合下利润率为负，**正常输出**，不要"修正"

### Step 5 — 解构利润率（profit margin decomposition）
当用户问"为什么利润率低"时，拆解链路（标准 P&L 拆法）：

```
profit_margin
  = SUM(profit) / SUM(sales)
  = SUM(sales - cost) / SUM(sales)
  = 1 - SUM(cost) / SUM(sales)
```

**Tableau 超市样本没有显式 cost 字段**，profit 已是净利。所以可拆的维度只有：
- 销售额组合（高毛利 vs 低毛利类目占比变化）
- 折扣率（折扣抬高 → 利润率压缩）
- 退货损失（退货导致的实际利润损失，需 JOIN returns）

在结论里明确说"无 cost 字段，拆解限于销售结构 + 折扣 + 退货"。

### Step 6 — 因果分析模板（高风险）
**问题含"为什么"时**：

1. 先给数据现象（不带因果词）："2023 Q3 利润率从 12% 降到 8%"
2. 列候选驱动（带数据佐证），按贡献度排序：
   - 销售结构：高毛利类目占比从 X% 降到 Y%
   - 折扣：平均折扣率从 X% 升到 Y%
   - 退货：退货率从 X% 升到 Y%
   - 单个大客户/订单异常（若有 outlier 行）
3. 显式声明未控制变量："未控制季节、促销活动、宏观因素"
4. **触发 reviewer** 第 9 项风险标注

### Step 7 — 时间 grain 检查
- 月度趋势：`DATE_FORMAT(order_date, '%Y-%m')`
- 季度：`CONCAT(YEAR(order_date),'Q',QUARTER(order_date))`
- 同比环比时分子分母必须同维度组合，**严禁**总体均值跨期对比掩盖结构变化

### Step 8 — Provenance footer
`CLAUDE.md` 标准 footer。`Measures:` 列出 `profit_margin` / `total_sales` / `order_count`；若用 raw SQL，`Assumptions:` 段写清亏损行处理、退货关联策略。

## 常见错误

| 错误 | 原因 | 修正 |
|---|---|---|
| `WHERE profit > 0` 算"利润率" | 直觉过滤"无效"行 | 删过滤，亏损行必须保留 |
| 同时按订单和行算利润率 | grain 混用 | 拆查询，或都用行级再 `SUM/SUM` |
| 同比基期分母≈0 时报"+9999%" | 没保护小数 | 报绝对差额或基期数值 |
| "因为折扣高所以利润低"无控制 | 因果跳过相关 | 改相关性描述 + reviewer |
| 把"亏损单的利润率"叫 `profit_margin` | 命名污染 | 改名 `negative_profit_margin` 并显式说明子集 |

## 参考

- `wiki/global/profit-rule.md`
- `wiki/global/discount-policy.md`（折扣是利润驱动之一）
- `wiki/global/return-semantics.md`（退货损失拆解时必读）
- `.ktx/skills/reviewer/SKILL.md`（因果 / 汇报场景必触发）
- `.ktx/skills/discount-analysis/SKILL.md`（折扣维度拆解时切过去）
