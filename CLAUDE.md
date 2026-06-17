# KTX Project — Claude Code Context

> 若你在本仓库做开发 / 改代码（而非回答数据问题），先读 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。本文件其余内容是 KTX 数据问答运行时上下文，不要混入开发治理规则。

本项目是一个本地自服务数据分析 Agent 栈，底座为 KTX 语义层 + Aliyun RDS MySQL 8.0.34。

## 使用 KTX 工具

本项目挂载了 KTX MCP server，提供以下核心工具：

| 工具 | 用途 |
|------|------|
| `sl_read` / `sl list` | 读取语义层（表描述、字段、measures、joins） |
| `sl_query` | 使用语义层生成并执行 SQL |
| `wiki_search` | 检索 wiki / reference docs |
| `sl_validate` | 验证语义层定义 |

---

## 查询优先级（强制执行）

**每次回答数据问题，必须按此顺序执行：**

```
Step 1  先查 KTX semantic layer（sl_read / sl_query）
        → 获取 canonical table、字段描述、grain、measures、joins

Step 2  再查 KTX wiki / reference docs（wiki_search）
        → 获取业务口径、Gotcha、路由规则

Step 3  以上均不能覆盖时，才允许 raw SQL
        → 必须标注：「以下基于 raw SQL，假设：…」
```

禁止跳过 Step 1 直接写 SQL。

---

## 表路由（关键）

本项目数据问答仅启用 **`dataforai`** 超市 domain。

| 分析意图 | 路由 |
|---|---|
| 超市零售明细（订单、折扣、利润、客户、产品、区域） | `dataforai.superstore_orders` (10194 行，4 年样本) |
| 月度 / 季度 / 年度趋势 | `dataforai.superstore_orders` 按 `order_date` 聚合（如 `DATE_FORMAT(order_date,'%Y-%m')`），不要依赖外部汇总表 |
| 退货关联 | `dataforai.superstore_returns` JOIN `superstore_orders` ON `order_id`（join 已在 sl yaml 中声明） |
| 区域经理 | `dataforai.superstore_people`（按 region 维表） |

所有查询默认加 `WHERE is_deleted = 0`；查 returns 时再加 `returned = '是'`。

---

## 指标口径

指标公式以 `sl_read` 返回的 `measures` 为单一事实源（`dataforai.superstore_orders`），禁止跳过语义层手写聚合公式。详细口径与 Gotcha 见 `wiki/global/discount-policy.md`、`wiki/global/profit-rule.md`。

---

## 高风险场景触发 Reviewer

涉及以下情况时，输出前调用 reviewer skill（若存在）；否则将其 9 项检查清单内联到回答前：

- 财务指标（利润率、折扣、收入）
- 跨表 JOIN
- 领导汇报
- 因果分析（"为什么"、"原因"）

---

## Provenance Footer

每个数据回答必须附：

```
Source tier : semantic layer | reference doc | raw SQL
Tables      : <schema.table>
Measures    : <measure_name>
Freshness   : MAX(<date_field>) = <value>
Validation  : SQL executed · metric checks passed
Assumptions : <raw SQL fallback 时列出假设>
```
