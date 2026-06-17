# project-lucy

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy README |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-17 |
| 撰写人 | Codex |
| 委托人 | 待确认 |
| 基于材料 | AGENTS.md、docs/DEVELOPMENT.md、ktx.yaml、semantic-layer/、.ktx/、wiki/ |
| 适用范围 | 项目入口说明，供 AI coding agent 理解仓库定位、目录边界与本地运行入口 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/README.md |

## 两个语境，不要混读

本仓库同时服务两类 agent，语境完全独立，混读会导致 prompt 污染：

| 语境 | 入口文件 | 读者 | 注入方式 |
|------|---------|------|---------|
| **运行时**：KTX 数据问答 | [`CLAUDE.md`](CLAUDE.md) | KTX 内置 LLM agent | `ktx.yaml → llm.provider.backend: claude-code` 自动注入 |
| **开发态**：改代码 / 改配置 | [`AGENTS.md`](AGENTS.md) → [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Claude Code、Codex 等 coding agent | agent 启动时读取 AGENTS.md |
| **Vibe coding**：多角色协作 | [`agents/README.md`](agents/README.md) | 同上，按需调用角色 | 同上 |

> `CLAUDE.md` 由 ktx.yaml 自动注入给数据问答 LLM，**不是给 coding agent 读的**。coding agent 的入口是 `AGENTS.md`。

---

`project-lucy` 是一个基于 KTX MCP Server 的语义、Skill 与 Wiki 管理平台，旨在为 Claude Code、Codex 等 data agent 提供可维护的上下文、业务知识和数据问答能力。

本仓库关注的不是单一数据源，而是一套可迁移的 agent context 工程：用 `ktx.yaml` 管理 KTX MCP Server 运行配置，用 `semantic-layer/` 管理数据语义，用 `.ktx/skills/` 承载可复用能力，用 `wiki/` 沉淀业务知识。

## 核心目录

| 路径 | 说明 |
|---|---|
| `ktx.yaml` | KTX MCP Server 配置入口，包含连接、存储、模型、扫描和 agent 运行设置。数据库连接可按环境替换。 |
| `semantic-layer/` | 语义层定义，描述 schema、表、字段、关系与业务含义，是 data agent 理解数据结构的主要来源。 |
| `.ktx/skills/` | KTX Skill 目录，用于放置面向 agent 的可复用操作能力。 |
| `.ktx/prompts/` | KTX 运行时 prompt 目录，用于承载产品运行时上下文。 |
| `wiki/` | 业务知识库目录，用于沉淀跨数据表、跨场景的解释性知识。 |
| `raw-sources/` | 数据源扫描与抽取产生的原始材料，作为语义层建设和回溯的输入。 |
| `docs/` | 开发治理、工单和设计文档。开发规则以 `docs/DEVELOPMENT.md` 为准。 |
| `AGENTS.md` | AI coding agent 的开发入口，指向本仓库治理规则。 |
| `CLAUDE.md` | KTX 数据问答运行时上下文，不是开发说明。 |

## 本地运行

本项目依赖 KTX CLI，并通过 KTX MCP Server 向 Claude Code、Codex 等客户端提供语义层、Wiki 和 Skill 能力。首次运行前，请确保本机已经安装 KTX，并准备好当前环境需要的数据源连接、模型后端和本地密钥文件。

常见流程：

```bash
# 检查 KTX 项目配置
ktx setup

# 扫描或更新数据源上下文
ktx scan

# 启动或注册 KTX MCP Server
# 具体子命令以当前 KTX CLI 版本为准
ktx --help
```

具体命令以当前 KTX 版本为准；如果本地 CLI 的 MCP 子命令名称不同，请优先使用 `ktx --help` 查看可用入口。

## 开发约定

在本仓库中写代码或改配置前，先阅读：

- `AGENTS.md`
- `docs/DEVELOPMENT.md`

重要边界：

- `CLAUDE.md` 是 KTX 产品运行时上下文，不是 agent 开发说明。
- `.ktx/secrets/` 下的密钥文件不得输出、提交或写入文档。
- 数据库连接不是仓库身份的一部分，可以按使用者环境自定义。
- 涉及新功能、跨文件改动、语义层、KTX 运行时行为或治理类文件的变更，需要先给出计划并获得确认。

## 设计原则

- 语义层优先：让 agent 先理解数据含义，再生成查询或分析。
- 上下文可维护：把业务知识沉淀到 Wiki、Prompt 和 Skill，而不是散落在临时对话里。
- 配置可迁移：数据源、模型和运行环境应通过配置替换，不绑定单一开发实例。
- 运行时与开发态隔离：产品问答上下文和开发治理规则分别维护，避免 prompt 污染。
