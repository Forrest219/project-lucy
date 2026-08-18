# Lucy 配置作者 Skills（分析师）

面向分析师：拿着 **Skill + 数据库连接**，生成可导入 Lucy 的 YAML / MD，无需手写全套配置。

| Skill | 用途 |
|---|---|
| `lucy-config-package` | 一键编排：语义 → Wiki → Eval → README |
| `lucy-semantic-author` | 生成 Schema Manifest + overlays |
| `lucy-wiki-author` | 生成 `/wiki` 业务口径 Markdown |
| `lucy-eval-author` | 生成 eval cases（测逻辑，不绑死样本日） |
| `moji-intl-weekly-brief` | 墨迹国际化近 7 日经营周报（本地 Markdown） |
| `moji-intl-ops-dashboard` | 墨迹国际化近 7 日经营看板（JSON → 静态 HTML） |

## 中文要求

各 Skill 均强制遵守 `references/chinese-copy-rules.md`（权威副本也在 `lucy-config-package/references/`）：

- 用户可见描述、Wiki 正文、Eval 题干/解析 **必须中文**
- 仅保留必要英文关键词（字段名、DAU/AF/USD、公式等）

## 语义契约门禁

`lucy-semantic-author` / `lucy-config-package` 交付前必须跑：

```bash
python3 .cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py <output_dir>
```

拦截非法 `joins[].relationship`（如 `many_to_many`）等 KTX 契约错误。规则见 `lucy-semantic-author/references/schema-lint-rules.md`。

## 用法示例

在 Cursor 对话中：

```text
用 lucy-config-package：
connection = mysql-aliyun
schema = chatbi
tables = 四张 ai_intl_* 
domain = chatbi_intl
输出到桌面 lucy_upload_chatbi_intl
```

或单独调用 `lucy-semantic-author` / `lucy-wiki-author` / `lucy-eval-author`。

## 与 `skills/` 目录的区别

| 路径 | 角色 |
|---|---|
| `.cursor/skills/lucy-*-author` | **配置生成**（作者工具） |
| 仓库根 `skills/` | **问答运行时** Skill（Agent 查数时用） |
