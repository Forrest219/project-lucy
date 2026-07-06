# Lucy Skill 最小治理规范

`skills/` 是 project-lucy 的 Skill 文件事实源。当前阶段不实现完整 Skill Editor；治理目标是让 Skill 文件、依赖 reference、运行时说明和 eval 覆盖可以被脚本验证。

## 文件布局

- 每个可执行 Skill 放在独立目录，并以 `SKILL.md` 作为入口。
- `SKILL.md` 的 reference 依赖通过 frontmatter `dependencies` 声明，路径相对当前 `SKILL.md`，且必须留在 `skills/` 下。
- `skills/**/references/*.md`、`skills/domains/**/*.md`、`skills/analysis/**/*.md` 可以作为 reference 文档；被 Skill 使用时必须出现在 `dependencies`。

## `SKILL.md` frontmatter

必填字段：

```yaml
---
name: warehouse-knowledge
version: v1.0
owner: forrest
triggers:
  - 数据
dependencies:
  - references/table-routing.md
eval_coverage:
  - superstore-profit-001
publish_targets:
  - claude-code
  - mcp
---
```

- `version` 使用 `v<major>.<minor>` 或 `v<major>.<minor>.<patch>`。
- `triggers` 是人工路由线索，不代表运行时自动加载。
- `eval_coverage` 记录覆盖该 Skill 的 eval case id；为空时不阻断 smoke，但会产生 warning。

## 运行时边界

`webui/config/data-qa-instructions.md` 是 Lucy MCP Proxy fallback instructions。它必须对 Skill / 业务路由做引用或明确说明，例如：

- fallback 不自动加载 Skill，业务路由需要通过可见 catalog / wiki / 显式读取 Skill 后执行；或
- fallback 明确指向可用的 Skill 路由机制。

不要把完整 Skill 正文复制进 runtime instructions。

## Eval 覆盖

每个 `evals/**/eval/*-eval-cases.yaml` 的 `cases[]` 条目必须包含可检查的 `skill_version`，格式同 `v1.0`。这让 Skill 变更后可以明确判断哪些 eval case 覆盖了哪个 Skill 版本。

## 验证命令

```bash
node scripts/p1-skills-smoke.mjs
node --test scripts/p1-skills-smoke.test.mjs
```

smoke 会写出 `inbox/p1-skills-evidence.json`。如有失败，`blockers[]` 会列出阻断原因、文件和检查项。
