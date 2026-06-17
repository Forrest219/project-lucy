---
name: discount-analysis
description: 超市 domain 折扣率分析 workflow。回答"折扣对销售/利润影响"、"高折扣占比"、"哪些类目/区域折扣异常"类问题时按此步骤执行。
scope: dataforai (超市 domain)
---

# Discount Analysis Workflow

## 何时触发

用户问题命中以下信号时调用本 workflow：

- 折扣率 / 折扣金额 / 折扣区间分布
- "高折扣"、"打折"、"降价"、"促销"
- "折扣对 X 的影响"（X = 销售额 / 利润 / 退货 / 客单价）
- "哪些 X 折扣高 / 低"（X = 类目 / 区域 / 子类目 / 客户细分）

不触发：单纯问销售额、利润、订单数（折扣维度不进入分析）。

## 公式与口径

**严格遵循 `wiki/global/discount-policy.md` 与 `wiki/global/profit-rule.md`，本 skill 不再重复公式。**

核心：
- 折扣率必须用 sales 加权：`SUM(discount * sales) / NULLIF(SUM(sales), 0)`
- 任何"按类目/区域"折扣分布都先 `GROUP BY` 再按上式聚合
- 折扣 = 0 与折扣 missing **不同**，不要静默 coalesce（除非用户明确允许）

## 7 步执行清单

### Step 1 — 确定分析对象
明确以下三件事，缺一不可：
1. **维度** (group by)：类目 / 子类目 / 区域 / 月份 / 客户细分（mutually exclusive，不要堆 4+ 维度）
2. **过滤** (where)：年份、地区、类目子集
3. **目标量** (measure)：折扣率、折扣金额、折扣订单占比、折扣 × 利润相关性

### Step 2 — 走语义层
- 优先用 `sl_query` + `discount_rate` measure
- 若 measure 不在 sl 中或需要自定义维度切片，落 raw SQL 但必须在回答头部声明 "raw SQL fallback"

### Step 3 — 折扣区间分桶（可选）
当用户问"折扣分布"或"高折扣订单"，按业务习惯分桶：
- `discount = 0` 无折扣
- `0 < discount <= 0.2` 轻度
- `0.2 < discount <= 0.5` 中度
- `discount > 0.5` 重度

桶边界写在回答里，不要默认 4 等分。

### Step 4 — 关联利润（高风险）
**回答"折扣对利润影响"时**：
- 至少同时报告：折扣率、利润率、订单数三个指标
- 不要只给"折扣率高的类目利润率低"这种相关结论，没控制销量与季节
- 若用户追问因果，转 `reviewer` skill 第 9 项风险标注

### Step 5 — 关联退货（可选）
当问题含"折扣是不是导致退货增加"时，JOIN `superstore_returns`，按 `returned = '是'` 计算折扣订单退货率。grain 必须在 order_id 级，不能 row_id 级（见 `return-semantics.md`）。

### Step 6 — 输出排序与限幅
- 默认按目标量降序 + LIMIT 10（避免长尾噪音）
- 用户明确说"全部"才输出完整列表
- 若有空桶/零样本组，显式列出"X 类目无折扣订单"而非省略

### Step 7 — Provenance footer
按 `CLAUDE.md` 模板附 footer。其中 `Measures:` 字段必须列出 `discount_rate`、`profit_margin` 等实际用到的 measure 名。

## 常见错误

| 错误 | 原因 | 修正 |
|---|---|---|
| `AVG(discount)` 当折扣率 | 没读 wiki | 改 `SUM(d*s)/SUM(s)` |
| 同时按 row_id 算订单数与折扣率 | grain 混用 | 订单数用 `COUNT(DISTINCT order_id)`，折扣率仍按行级加权 |
| "高折扣 → 高退货" 因果结论 | 未控制变量 | 改为相关性描述 + 触发 reviewer |
| 把免运费、满减统一叫"折扣" | 字段语义 | 见 `discount-policy.md` Gotcha 段 |

## 参考

- `wiki/global/discount-policy.md`
- `wiki/global/profit-rule.md`（折扣与利润联合分析时必读）
- `wiki/global/return-semantics.md`（折扣与退货联合分析时必读）
- `.ktx/skills/reviewer/SKILL.md`（因果 / 汇报场景必触发）
