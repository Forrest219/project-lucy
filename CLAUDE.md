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

超市零售分析 → **`dataforai.superstore_orders`**（10194 行，Tableau 4 年样本）
不要使用 `openclaw_db.orders`（约 32 行演示数据，与超市分析无关）

月度趋势 / 汇总 → `openclaw_db.bidm_ai_metric_summary_mth`

所有查询默认加 `WHERE is_deleted = 0`。

---

## 指标口径（强制）

| 指标 | 正确写法 | 禁止 |
|------|---------|------|
| 折扣率 | `SUM(discount * sales) / NULLIF(SUM(sales), 0)` | `AVG(discount)` |
| 利润率 | `SUM(profit) / NULLIF(SUM(sales), 0)` | `AVG(profit/sales)` |
| 订单数 | `COUNT(DISTINCT order_id)` | `COUNT(*)` |
| 客单价 | `SUM(sales) / NULLIF(COUNT(DISTINCT order_id), 0)` | `AVG(sales)` |

profit 可为负值（亏损行），**禁止** `WHERE profit > 0` 后再统计利润率。

---

## 高风险场景触发 Reviewer

涉及以下情况时，输出前执行 `.ktx/skills/reviewer/SKILL.md` 的 9 项检查清单：

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

---

## Skill 文件位置

```
.ktx/prompts/
  warehouse-knowledge.md          ← MCP 通道注入（与本文件内容同源）

skills/                           ← 顶层目录（可见，WebUI 可编辑）
  warehouse/
    SKILL.md                      ← Knowledge Skill（路由器）
    references/
      table-routing.md            ← 表选择规则（新增 domain 时在此追加）
      metrics-policy.md           ← 指标聚合口径
  domains/                        ← Domain Reference Docs（不是 Skill）
    superstore/
      domain.md                   ← 超市领域参考文档
      pitfalls.md                 ← 7 个常见错误
      discount-policy.md          ← 折扣字段完整说明
    [future-domain/domain.md]     ← 接入新 domain 时新增此文件
  analysis/                       ← 分析工作流 Skill（跨 domain 复用）
    discount-analysis.md          ← 折扣分析程序
    profit-decomposition.md       ← 利润拆解程序
  reviewer/
    SKILL.md                      ← 9 项高风险审查清单
```
