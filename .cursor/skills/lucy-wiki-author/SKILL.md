---
name: lucy-wiki-author
description: >-
  Generates Lucy Business Wiki Markdown playbooks (Chinese) with sl_refs to
  semantic sources for /wiki upload. Use when the user asks to 生成 Wiki、业务
  口径文档、playbook.md、wiki/global, or document metric definitions and
  pitfalls for Lucy Agent retrieval.
---

# Lucy Wiki 作者

基于已生成（或已有）语义 YAML + 业务说明，生成可上传到 `/wiki` 的中文 playbook。

## 中文硬性要求（本 Skill 强制）

完整规范：[chinese-copy-rules.md](references/chinese-copy-rules.md)

1. 标题、正文、表格说明、常见错误、回答策略 **全部中文**。
2. 允许嵌入英文关键词：指标缩写、字段名、公式、`sl_refs` 路径。
3. 禁止整段英文 playbook；禁止中英混杂导致口径歧义。
4. 交付前自检：正文中文为主；代码块内字段名可英文。

## 输入

- 语义产出：Manifest + overlays（必读，保证 measure/字段名一致）
- connectionId（写 `sl_refs`）
- 可选：业务问答样例 / Owner 口径
- output_dir

## 工作流

```text
- [ ] 读中文规范与 playbook 模板
- [ ] 从 overlay 收集 grain / measures / segments / 注释中的勾稽
- [ ] 从业务材料补同义词、禁止项、脏数规则
- [ ] 写 wiki/global/<playbook>.md（中文）
- [ ] 核对 sl_refs = <connection>/<schema>/<source>
- [ ] 中文自检
```

## 输出路径

```text
<output_dir>/wiki/global/<domain>-playbook.md
```

Frontmatter：

```yaml
---
visibility: private
sl_refs:
  - <connectionId>/<schema>/<source_name>
---
```

## 正文结构（必须中文标题）

按模板 [playbook-template.md](references/playbook-template.md) 填写：

1. 何时使用  
2. 表角色与粒度  
3. 同义词与过滤规则  
4. 单位与量纲  
5. 核心口径与公式（随数据而动，不写死样本日）  
6. 跨表关联键与成本类公式（如有）  
7. 推荐 measure  
8. 常见错误  
9. 回答策略  

## 硬约束

- 公式用字段名；日期/国家由用户问题过滤。
- 与语义 YAML 的 source 名、measure 名一致。
- 明确「禁止 AVG 预计算比率」「跨端 sum 去重风险」等陷阱（中文表述）。
