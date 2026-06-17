---
name: warehouse-knowledge
version: v1.0
owner: forrest
triggers:
  - 数据
  - 指标
  - SQL
  - 分析
  - 查询
  - 报表
  - 销售
  - 利润
  - 折扣
  - 订单
dependencies:
  - references/table-routing.md
  - references/metrics-policy.md
eval_coverage: []
last_pass_rate: ~
publish_targets:
  - claude-code
  - mcp
---

# Warehouse Knowledge Skill

顶层路由器。所有数据问题必须经过此 Skill，再决定进入哪个领域 Skill。

## 查询优先级（强制执行）

```
Step 1  先查 KTX semantic layer
        → ktx sl read / sl query
        → 获取表描述、字段描述、grain、measures、joins

Step 2  再查 KTX wiki / curated reference docs
        → ktx wiki search
        → 获取业务口径、Gotcha、路由规则

Step 3  上述均不能覆盖时，才允许 raw SQL
        → 必须在回答中标注：「以下基于 raw SQL，假设：…」
```

**禁止跳过 Step 1 直接写 SQL。**

## 表路由规则

参见 `references/table-routing.md`。

## 指标口径

参见 `references/metrics-policy.md`。

## 回答格式

每个回答必须附带 Provenance Footer：

```
Source tier : semantic layer | reference doc | raw SQL
Tables      : <schema.table>
Measures    : <measure_name>
Freshness   : MAX(<date_field>) = <value>
Validation  : SQL executed · metric checks passed
Assumptions : <如有 raw SQL fallback，列出假设>
```
