---
name: answer-style
title: Claude Code 数据回答风格
version: v0.3
owner: xingchen
domain: answer-style
status: published
description: >
  把已经查实的数据回答写成麦肯锡 exhibit：一句结论标题、一行单位副题、一张表、白话注和资料来源。
  排名和对比用结论表，单位收到万或亿，主结论行加粗。分类按指标排序，期间保持时间顺序。
  用户要精确到元、对账或导出时改用查数表。
  计算仍遵守 warehouse-knowledge 与 metrics-policy。
triggers:
  - 排名
  - 口径
  - 表格
  - 利润
  - 销售额
  - 对比
  - 汇总
  - 查询结果
  - 数据回答
dependencies:
  - references/business-style.md
  - references/prose.md
  - references/template.md
  - ../warehouse/references/metrics-policy.md
eval_coverage: []
publish_targets:
  - claude-code
  - mcp
roles_allowed:
  - "*"
---

# Claude Code 数据回答风格

先把数查实，再写成一张 exhibit。计算、表路由、加权口径仍走 `warehouse-knowledge` 和 `skills/warehouse/references/metrics-policy.md`。本 Skill 只规定用户看得见的版式。

## 三层

| 层 | 载体 | 风格 | 细则 |
| --- | --- | --- | --- |
| 对话 | 结论标题、再跑一句 | 判断句；提议在来源之后 | [prose.md](references/prose.md) |
| 商务 | 副题和表格 | 麦肯锡 exhibit | [business-style.md](references/business-style.md) |
| 脚注 | 注、资料来源 | 白话，默认不写 SQL | [prose.md](references/prose.md) |

成品骨架见 [template.md](references/template.md)。

顺序：标题 → 副题 → 表 → 注 → 资料来源 → 必要时再跑一句。还在查数、权限被拒、工具失败时，不用这套版式编空表。

## 写表之前

- 排名、对比、结构用结论表：标题是判断，副题写 `2026 年；人民币万元` 这类单位，主结论行加粗。产品线等分类按指标排序；年份和月份保持时间顺序。
- 精确到元、对账、导出用查数表：范围标题，人民币元，千分位两位小数，不加粗。
- 一张回答只出一种表。列只服务标题。结论表不加排名列。
- 注写过滤、汇总粒度和舍入。资料来源写业务名称、期间和粒度。
- 默认不写 SQL。用户追问口径时再给聚合表达式。
