---
name: lucy-config-package
description: >-
  Orchestrates Lucy upload-package authoring for analysts: runs semantic YAML,
  Wiki Markdown, and Eval YAML generation from a DB connection, then writes a
  ready-to-import folder. Use when the user asks to 配置 Lucy、生成上传包、
  从数据库生成语义/Wiki/Eval、一键导入包, or mentions lucy-config-package /
  lucy-semantic-author / lucy-wiki-author / lucy-eval-author together.
---

# Lucy 配置包编排（分析师作者 Skill）

分析师只需提供 **数据库连接 + schema/表（可选业务说明）**，本 Skill 编排三个作者 Skill，产出可直接导入 Lucy 的文件夹。

## 必读规范

1. [中文文案硬性要求](references/chinese-copy-rules.md) — **全程强制**
2. [上传包目录约定](references/package-layout.md)
3. 子 Skill（按序执行并读取其 `SKILL.md`）：
   - [lucy-semantic-author](../lucy-semantic-author/SKILL.md)
   - [lucy-wiki-author](../lucy-wiki-author/SKILL.md)
   - [lucy-eval-author](../lucy-eval-author/SKILL.md)

## 输入（向用户确认，缺一不可先问）

| 项 | 说明 |
|---|---|
| connection | DBeaver MCP connection 名/id，或已有 Lucy `connectionId` |
| schema | 如 `chatbi` |
| tables | 表清单；空则列出 schema 下用户确认的表 |
| domain | 短名，用于目录/eval 名，如 `chatbi_intl` |
| output_dir | 默认 `~/Desktop/lucy_upload_<domain>` |
| 业务材料 | 可选：问答样例 docx/md、Owner 口径说明 |

## 执行顺序

复制清单并勾选：

```text
- [ ] 读中文规范与包布局
- [ ] 连库：list tables → columns/comments → 抽样 distinct/日期范围
- [ ] 跑 semantic-author → Manifest + overlays（含 JOIN 决策：禁止 many_to_many）
- [ ] 跑 semantic lint：python3 .cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py <output_dir>
- [ ] 跑 wiki-author → playbook.md（sl_refs 对齐 semantic）
- [ ] 跑 eval-author → eval-cases.yaml（引用 wiki + measures）
- [ ] 写中文 README（导入步骤）
- [ ] 中文自检清单全部通过
- [ ] 向用户汇报：输出路径 + 导入顺序 + lint 已通过
```

## 硬约束

- **逻辑随数据而动**：不把样本日期写死进口径；公式用字段名。
- **用户可见文案中文**：见中文规范；术语关键词可英文。
- **语义契约**：`joins[].relationship` 仅 `many_to_one|one_to_many|one_to_one`；事实↔事实期间对齐不写 joins。完整规则见 [lucy-semantic-author/references/schema-lint-rules.md](../lucy-semantic-author/references/schema-lint-rules.md)。交付前 **必须** 跑 `lint-semantic-yaml.py`，失败不得交付。
- **不写 secrets**：不把密码、token 写入任何产出文件。
- **不直接改生产 PVC**：默认只写 `output_dir`；用户确认后再说如何在 WebUI 导入。

## 完成时回复用户（中文）

1. 产出目录路径  
2. 文件清单（语义 / Wiki / Eval）  
3. Lucy 导入顺序：连接准备 → 语义发布 → Wiki 上传 → Eval 落盘  
4. 已知假设与待 Owner 确认的口径点  
