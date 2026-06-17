# project-lucy 开发治理（Development Governance）

> 本文档面向**在本仓库写代码 / 改配置的 agent**（Claude Code、Codex 等）。
> 与 `CLAUDE.md`（KTX 数据问答运行时上下文）是两套独立语境，互不同步、互不替代。

## 适用范围

- **适用**：修改 `webui/`、`ktx.yaml`、`semantic-layer/`、`skills/`、`.ktx/` 等仓库源码与配置的任何会话
- **不适用**：纯数据问答场景——那部分规则在 `CLAUDE.md` 和 `.ktx/prompts/warehouse-knowledge.md`，不要把本文档内容同步进去

## 强制流程：Plan Mode

以下改动，必须先输出计划（Claude Code 用 Plan Mode / EnterPlanMode，Codex 用等价的"先列步骤"机制），经人工确认后才能落地：

- 新功能、架构调整、跨文件改动
- semantic-layer / 数据库 schema 相关变更
- 修改 `skills/`、`CLAUDE.md`、`AGENTS.md`、`ktx.yaml` 等治理类文件
- 任何会影响 KTX 数据问答运行时行为的改动

例外（无需先出计划，可直接执行，范围保持窄）：

- 单文件内的 typo / 注释 / 格式修正
- 已经在被批准的计划范围内的后续小步执行

## 红线（Off-Limits）

- `.ktx/secrets/` 下的密码/密钥文件：禁止读取内容后输出、禁止提交到 git
- `ktx.yaml` 中的数据库连接信息：改动前必须先确认，不能静默修改
- 生产数据库（Aliyun RDS MySQL）：只读查询，禁止 DDL/DML 写操作

## Spec 落位规则

- 设计文档/工单（PRD、架构、任务拆分）落在 `docs/`，作为本仓库的事实来源
- `webui` 开发通过 `docs/` 下的工单（wo-M0 ~ wo-M5）交给 Codex 执行；任何 agent 在本仓库改代码时同样遵循工单边界，不擅自扩大范围
- 个人分析 / 协作笔记不进本仓库，按既有约定放 Obsidian

## CLAUDE.md / AGENTS.md 分工

| 文件 | 用途 | 谁读 |
|------|------|------|
| `CLAUDE.md` | KTX 产品运行时上下文（数据问答规则），由 `ktx.yaml` 的 `llm.provider.backend: claude-code` 注入 | KTX 内置 agent |
| `AGENTS.md` | 开发态入口，指向本文档 | Codex / 支持 AGENTS.md 的工具，以及打开本仓库做开发的 Claude Code |
| `docs/DEVELOPMENT.md`（本文件） | 实际的开发治理规则 | 同上 |

两者都只做单行引用，不整段复制对方内容，避免运行时 prompt 被开发态规则污染，也避免开发治理规则散落在产品语境里维护两份。
