---
name: lucy-eval-author
description: >-
  Generates Lucy eval case YAML (Chinese questions and explanations) that test
  metric logic, units, joins, and reconciliation—not frozen sample dates. Use
  when the user asks to 生成 eval、评测集、回归 case、quiz cases, or turn a
  business Q&A doc into Lucy evals paired with semantic/wiki assets.
---

# Lucy Eval 作者

基于语义 YAML + Wiki（+ 可选问答样例），生成测 **口径/勾稽/单位/跨表逻辑** 的 eval cases；日期仅为抽样，逻辑随数据可重跑。

## 中文硬性要求（本 Skill 强制）

完整规范：[chinese-copy-rules.md](references/chinese-copy-rules.md)

1. `question`、`explanation`、quiz `stem` / `options[].text`、`tool_assertions[].reason` **用中文**。
2. 允许保留字段名、measure 名、工具名（`sl_query`）等英文标识。
3. 禁止整题英文；禁止只有英文 explanation。
4. 交付前自检：每条 case 的 question/explanation 含中文。

## 输入

- 语义 overlays（measures / grain / 别名）
- Wiki playbook（口径与陷阱）
- 可选：`AI 友好型问答` 类样例（抽取题型，不绑死其日期）
- 抽样查询（用于填 expected 时可选；逻辑题可不写死数字）
- domain、output_dir

## 工作流

```text
- [ ] 读中文规范与 case 模板
- [ ] 从 Wiki/语义列出必测逻辑点（单位、双口径、留存定义、JOIN、去重、脏数）
- [ ] 将样例题改写为「参数化」问法（日期/国家用占位或「任取有数日」）
- [ ] 编写 cases（中文 question/explanation）+ 必要 tool_assertions
- [ ] 可选 quiz_cases（中文）
- [ ] 中文自检 + YAML parse
```

## 输出路径

```text
<output_dir>/evals/<domain>/eval/<domain>-eval-cases.yaml
```

## 命题原则

| 要测 | 不要测 |
|---|---|
| 单位（人 vs % vs 美元/人） | 写死某一天的唯一正确答案作为唯一价值 |
| 服务器 ≥ AF 等勾稽 | 依赖库中未必存在的国家/日期 |
| 留存率必须有分母 | 与语义 measure 名不一致的题干 |
| JOIN KEY、跨表 CPI | 需要写库的 DML |
| 跨端 sum 去重风险 | |
| 留存率 >100% / 留存>DAU 脏数意识 | |

有抽样数时：可给「当前库可回归」的精确题，但 explanation 须写清公式，换日可重算。

## Case 最小字段

见 [case-template.md](references/case-template.md)。对齐仓库现有 `evals/*/eval/*-eval-cases.yaml` 风格；包含 `skill_version`（可用 `v0.1`）。

`context_required.keys` 指向生成的 wiki 路径（如 `global/<playbook>.md`）。
