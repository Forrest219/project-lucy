---
name: ops-questioning
title: 运维问数
version: 1.0.0
domain: lucy-ops
status: published
roles_allowed: [lucy_ops_reader]
prerequisites:
  sources:
    - "lucy-ops.ops_calls"
    - "lucy-ops.ops_call_tables"
  wiki_docs:
    - "lucy-ops/ops-questioning.md"
triggers:
  - "谁被拒绝"
  - "生成 SQL"
  - "哪张表被问得最多"
  - "活跃 Agent"
  - "调用流水"
  - "裁决原因"
description: 运维问数 SOP：在运维问数连接（lucy-ops）上追问调用流水。只回答活跃 Agent；不回答业务活跃 Token 与访问账户。
---

# 运维问数

本连接只读当前实例的**调用流水**（`ops_calls`）与**调用流水 × 涉及数据表**
（`ops_call_tables`）两张视图。它能回答：某张表上谁被拒绝、生成 SQL 是什么；
某个工具的失败是否集中在一个 Agent；刚才哪张示例表被问到。

**本连接只回答活跃 Agent。**

## 回答口径（按顺序判断）

1. **问的是活跃 Agent，或问句已经写明 Agent**：按窗口对 `ops_calls.agent_id`
   去重后查询。窗口用 `call_day` 过滤。

2. **问句出现「活跃用户」「用户」「业务活跃 Token」或「活跃 Token」**：**不要**查询
   Token 人口。说明本连接没有稳定的凭据身份——`token_label` 只在同一 Agent 内
   唯一：两个 Agent 可以用同一个标签；同一 Agent 删除后重建同名标签也无法区分
   前后两枚 Token。业务活跃 Token 以**使用概况**为准，并指向使用概况的对应视图。

3. **明细里可以显示 `token_label`**，作为该行的标签展示。**不把 `token_label`
   去重称为业务活跃 Token**：禁止把 `count(distinct token_label)` 说成业务活跃
   Token、活跃用户或任何 Token 人口。

4. **访问账户不在本连接**。本连接没有访问账户口径，也不查 `ui_page_views`。
   需要时指向使用概况的界面使用视图。

5. **`call_day` 是 UTC 日历日**（`ts` 的 UTC 日历日）。问「过去 7 天」时过滤这
   7 个 UTC 日，并在回答里写明窗口是 UTC。不要把使用概况卡片上的数字复述成
   查询结果。

6. **「哪张表被问得最多」和「谁被拒绝、生成 SQL 是什么」走 `ops_call_tables`**。
   `generated_sql` 是高基数属性：只在已经按表、Agent、结果或 `request_id` 过滤
   之后取出，**生成 SQL 不作为默认分组**。

## 两张视图的关系

两张视图覆盖**同一个事件集合**：默认用量（协议事件与默认视图排除的评测探针不
计入）再排除本连接自己的追问。某次调用只要有一行来源属于本连接，它就整次从两
张视图里消失，不会只在其中一张留下残余行。回答调用次数时两张视图的结果应当一
致；不一致时先检查是否用了不同的窗口。

## 边界

- 不回答业务活跃 Token，不回答访问账户，不查 `ui_page_views`。
- 不把 `token_label` 去重称为人口。
- 生成 SQL 只在过滤后的明细里取。
- 本连接不回答三张示例表的业务口径问题（例如退货口径），那以 Docker demo 已有
  的 Wiki 为准。
