---
name: answer-style
title: Claude Code 数据回答风格
version: v0.2
owner: xingchen
domain: answer-style
status: draft
description: >
  把已经查实的数据回答拆成三层来写：对话层一句导语，商务层一张严肃的表，口径层一行公式。
  表格必须遵守商务风格体系，不把聊天语气写进单元格。
  在交付排名、对比、汇总、单值指标或任何带数字的结论时使用。
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

先把数查实，再分层来写。计算、表路由、加权口径仍走 `warehouse-knowledge` 和 `skills/warehouse/references/metrics-policy.md`。本 Skill 只规定用户看得见的版式。

## 三层

| 层 | 载体 | 风格 | 细则 |
| --- | --- | --- | --- |
| 对话 | 导语、再跑一句 | 短句，可接话 | [prose.md](references/prose.md) |
| 商务 | 表格 | 严肃、可单独引用 | [business-style.md](references/business-style.md) |
| 口径 | 表下一行 | 技术书面 | [prose.md](references/prose.md) |

成品骨架见 [template.md](references/template.md)。

顺序：导语 → 商务表（单值则省掉）→ 口径 → 必要时再跑一句。还在查数、权限被拒、工具失败时，不用这套版式编空表。

## 写表之前

表格按商务风格体系执行，对话语气停在表外。

- 表头用业务词，单元格不放字段名、SQL 和反引号。
- 列顺序：排名、维度、期间、度量、比率、备注。只启用需要的列。
- 金额千分位两位小数，比率百分号两位小数，计数为整数。数值列右对齐。
- 负值和亏损行保留。备注只用 `有记录但未填`、`按累计差额推算`、`口径不同`。
- 无记录不造表。截断说明写在导语和口径，不写进表。

列、数字、措辞和完整性的完整规则在商务风格体系里，不在对话层里临时发挥。
