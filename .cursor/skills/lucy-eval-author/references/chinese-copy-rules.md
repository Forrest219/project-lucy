# Lucy 配置作者 Skill — 中文文案硬性要求

所有面向分析师、问答 Agent、WebUI 导入包的用户可见文案必须使用中文。本规范适用于语义 YAML、Wiki MD、Eval YAML、README。

## 必须中文

| 位置 | 字段 / 内容 |
|---|---|
| Schema Manifest | `descriptions.db`、`descriptions.ai`、表级 `descriptions.db/ai` |
| Semantic Overlay | `measures[].description`、`segments[].description`、文件头注释中的业务说明 |
| Wiki | 标题、正文、表格说明、常见错误、回答策略 |
| Eval | `question`、`explanation`、`reason`、quiz `stem` / `options[].text` |
| 上传包 README | 步骤说明、口径说明、注意事项 |

## 允许保留英文（关键词 / 特殊术语）

- 行业术语：`Schema`、`Manifest`、`Catalog`、`MCP`、`YAML`、`API`、`JOIN`、`CPI`、`CAC`、`DAU`、`MAU`、`UV`、`AF`、`USD`、`ETL`
- 物理标识：表名、字段名、source `name`、`platform` 枚举值（如 `iphone`）、文件路径、URL
- 公式中的函数与字段：`sum(dau)`、`nullif(...)`、`Asia/Shanghai`
- 用户同义词映射中的原文：`iOS` → `iphone`

## 禁止

1. 用整段英文写 `ai:` / `description` / Wiki 段落（关键词嵌入中文句可以）。
2. 为「好看」把业务说明改成英文；Agent 与分析师默认中文协作。
3. 中英混排长句导致口径歧义（例如半句英文半句中文描述同一规则）。

## 自检清单（发布前必过）

- [ ] 每个 `descriptions.ai` / `db` 含中文，或不含整句英文。
- [ ] 每个 `measures[].description`、`segments[].description` 以中文为主。
- [ ] Wiki 正文中文；代码块内字段名可英文。
- [ ] Eval 的 `question` / `explanation` / `reason` 中文。
- [ ] README 导入步骤中文。
