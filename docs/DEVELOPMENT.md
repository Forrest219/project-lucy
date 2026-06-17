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

## Onboarding（首次拉取本仓库）

1. `cp ktx.yaml.example ktx.yaml`（如已存在 `ktx.yaml` 则跳过；当前 `ktx.yaml` 仍 tracked，新机器可以直接用）
2. 替换 `ktx.yaml` 中的 `<CHANGE-ME-*>` 占位符为本地实际值（host / db / username / 密码文件绝对路径）
3. `mkdir -p .ktx/secrets && echo '<your-mysql-password>' > .ktx/secrets/mysql-aliyun-password`（该目录已在 `.ktx/.gitignore` 排除）
4. 安装 KTX CLI：`npm install -g @kaelio/ktx@latest`（或在 `/Users/zhangxingchen/Projects/ktx` 跑 `pnpm install && pnpm run link:dev` 链入开发版本）
5. 启动本地 MCP daemon：`ktx mcp start --project-dir /Users/zhangxingchen/Projects/project-lucy`
   - 仓库已附带 `.mcp.json`（HTTP 端点 `http://localhost:7878/mcp`），Claude Code 启动时会自动连接；daemon 不运行则连接失败。
   - 仅 Claude Desktop 走 stdio（`ktx mcp stdio`），本仓库不预置该配置。
6. 验证：`ktx status` 报告 `Agent integration ready: yes`，并跑一次 `ktx sl "<keyword>"` 看连接是否通

> **凭据/路径漂移防护**：`ktx.yaml.example` 由 M3.4 维护；当 `ktx.yaml` 中的 host/user/路径字段发生变化时，请同步更新 `.example`。

## 上游依赖：KTX

本仓库不包含 KTX 本体（CLI / MCP server / 语义层引擎），运行依赖外部 KTX 安装。

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/kaelio/ktx |
| 本机 clone | `/Users/zhangxingchen/Projects/ktx` |

何时查阅 KTX 源码：

- 注册 / 调试 KTX MCP server（启动命令、传输方式、可用 tool 列表）
- 验证 `sl_read` / `sl_query` / `wiki_search` / `sl_validate` 的实际行为与 `CLAUDE.md` 描述是否一致
- 排查 `ktx.yaml` 字段含义、scan / ingest / agent 行为
- 在 KTX 本身有 bug / 缺特性时定位上游 issue

约定：

- 修改 KTX 源码属于**上游变更**，在 `/Users/zhangxingchen/Projects/ktx` 内进行，遵循该仓库自身的协作规则，不在本仓库提交。
- 本仓库只引用 KTX，**不复制** KTX 内部规则 / prompt 到本仓库。

## CLAUDE.md / AGENTS.md 分工

| 文件 | 用途 | 谁读 |
|------|------|------|
| `CLAUDE.md` | KTX 产品运行时上下文（数据问答规则），由 `ktx.yaml` 的 `llm.provider.backend: claude-code` 注入 | KTX 内置 agent |
| `AGENTS.md` | 开发态入口，指向本文档 | Codex / 支持 AGENTS.md 的工具，以及打开本仓库做开发的 Claude Code |
| `docs/DEVELOPMENT.md`（本文件） | 实际的开发治理规则 | 同上 |

两者都只做单行引用，不整段复制对方内容，避免运行时 prompt 被开发态规则污染，也避免开发治理规则散落在产品语境里维护两份。
