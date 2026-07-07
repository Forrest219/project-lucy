# project-lucy

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy README |
| 文档类型 | Other |
| 版本 | v1.2 |
| 撰写日期 | 2026-06-18；v1.2 更新 2026-07-06（同步 data agent context compiler + governed MCP runtime 定位与 Proxy instructions 运行时入口） |
| 撰写人 | Claude |
| 委托人 | 待确认 |
| 基于材料 | AGENTS.md、docs/DEVELOPMENT.md、docs/project-overview.md、ktx.yaml、.mcp.json、lucy-skills/docs/01-spec.md、skills/、evals/ |
| 适用范围 | 项目入口说明，供 AI coding agent 理解仓库定位、目录边界与本地运行入口 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/README.md |

## 两个语境，不要混读

本仓库同时服务两类 agent，语境完全独立，混读会导致 prompt 污染：

| 语境 | 入口文件 | 读者 | 注入方式 |
|------|---------|------|---------|
| **运行时**：Lucy 数据问答 | Lucy MCP Proxy `initialize` instructions（来源 [`webui/config/data-qa-instructions.md`](webui/config/data-qa-instructions.md)） | 任何走 `:7879` 的 MCP client | MCP `initialize` 响应注入，见 [`webui/docs/07-mcp-auth-proxy-spec.md`](webui/docs/07-mcp-auth-proxy-spec.md) §4.4 |
| **开发态**：改代码 / 改配置 | [`AGENTS.md`](AGENTS.md) → [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Claude Code、Codex 等 coding agent | agent 启动时读取 AGENTS.md |

> `CLAUDE.md` 现在只做入口指引，不承载数据问答规则正文。coding agent 的入口是 `AGENTS.md`；数据问答运行时指导由 Lucy MCP Proxy 注入。

---

`project-lucy` 是面向中小企业的 **data agent context compiler + governed MCP runtime**，旨在把数据库、BI、文档、人工口径编译成 Claude Code、Codex、Hermes、Cursor 等 data agent 可安全使用、可审计、可回归的数据服务。

本仓库关注的不是单一数据源，而是一套可迁移的 agent context 工程：用 `semantic-layer/` 管理 Semantic Pack，用 `wiki/` 和 `skills/` 承载 Knowledge Pack，用 `evals/`、审计和后续 trusted query 资产形成 Query / Quality Pack，并通过 Lucy MCP Proxy 暴露受治理 MCP runtime。

## 核心目录

| 路径 | 说明 |
|---|---|
| `ktx.yaml` | KTX MCP Server 配置入口，包含连接（Aliyun RDS MySQL）、存储、模型、扫描和 agent 运行设置。数据库连接可按环境替换；`ktx.yaml.example` 存放脱敏模板。 |
| `semantic-layer/` | 语义层定义，`mysql-aliyun/` 下含 `_schema/`（KTX 扫描生成）与手工 overlay YAML（measures / segments / joins）。 |
| `skills/` | lucy 增量 skill 库，当前由 LLM 通过 Read 工具主动读取 `SKILL.md`；未来由 `lucy-skills` MCP server 暴露。包含 4 个子目录：`warehouse/`（路由器 Skill）、`reviewer/`（高风险审查 Skill）、`analysis/`（折扣与利润分析 Skill）、`domains/`（超市领域 Reference）。 |
| `lucy-skills/` | 独立 MCP server，用于将 `skills/` 以标准 MCP Resource 形式暴露给 data agent（P1.5 立项中，spec 见 `lucy-skills/docs/01-spec.md`，尚未实现）。 |
| `.ktx/prompts/` | KTX 运行时 prompt 目录，用于承载产品运行时上下文。 |
| `wiki/` | 业务知识库目录（`global/`），沉淀跨数据表、跨场景的解释性知识（折扣策略、利润规则、退货语义）。 |
| `evals/` | Eval Case 目录（`superstore/eval/superstore-eval-cases.yaml`），7 条覆盖折扣 / 订单数 / 利润率 / is_deleted 的发布前门禁测试。 |
| `webui/` | 治理工作台（React 19 + Vite + Fastify），提供 Catalog / TableEditor / JoinEditor / WikiEditor / Review 五个页面，M0–M5 全部完成。 |
| `raw-sources/` | 数据源扫描与抽取产生的原始材料，作为语义层建设和回溯的输入。 |
| `docs/` | 开发治理与项目概览。`docs/DEVELOPMENT.md` 是开发规则权威源；`docs/project-overview.md` 是全组件索引。 |
| `AGENTS.md` | AI coding agent 的开发入口，指向本仓库治理规则。 |
| `CLAUDE.md` | 开发/运行入口指引，不承载数据问答规则正文。 |
| `AGENT_PIPELINE.md` | 可选的完整交付流水线（pm / architect / coder / tester / reviewer 5 角色）；仅在需要正式审计、不可逆操作或团队交接时启用。 |

## KTX MCP 相关目录

以下目录与 KTX MCP Server 直接相关，改动前需了解其在 MCP 生命周期中的角色：

### 核心数据源（MCP 工具直接暴露）

| 目录 | MCP 工具 | 说明 |
|------|----------|------|
| `semantic-layer/` | `sl_read_source` / `sl_query` | 语义层定义，含扫描生成的 `_schema/` 和手工 overlay YAML |
| `wiki/` | `wiki_search` / `wiki_read` | 业务知识库，`wiki/global/` 为跨场景业务知识 |
| `evals/` | `memory_ingest`（写入） | 内存索引与 eval 门禁用例 |

#### 维护规则

| 路径 | 是否手动维护 | 触发时机 |
|------|------------|---------|
| `semantic-layer/mysql-aliyun/_schema/` | **否**，`ktx ingest` 自动生成，手动改会被覆盖 | 跑 `ktx ingest mysql-aliyun` 后自动更新 |
| `semantic-layer/mysql-aliyun/superstore_orders.yaml` | **是**，手工 overlay | 数据库表结构变化、measures / joins / segments 定义调整时 |
| `wiki/global/` | **是**，全部手写 | 业务口径变化、发现新 Gotcha、折扣 / 利润 / 退货规则更新时 |
| `evals/superstore/eval/` | **是**，手写 eval 用例 | 扩充测试覆盖、发现新边界场景、发布前门禁不足时 |

### 运行时（daemon 维护，不直接对外暴露）

| 目录 / 文件 | 说明 |
|-------------|------|
| `.ktx/prompts/` | MCP 运行时 prompt 模板和动态上下文 |
| `.ktx/db.sqlite` | KTX 内部知识索引，通过 MCP 工具间接访问 |
| `.ktx/runtime/` | daemon.json、PID、日志（仅 daemon 内部使用） |

### 配置

| 文件 | 说明 |
|------|------|
| `ktx.yaml` | `ktx mcp start` 的唯一配置入口 |
| `raw-sources/` | `ktx ingest` 扫描输入，不直接暴露给 MCP agent |

### 与 KTX MCP 无关的目录

`skills/`、`webui/`、`docs/` 不被 KTX MCP 加载，属于上层应用层（增量 Skill、前端、开发治理）。

---

## 本地运行

本项目依赖 KTX CLI，并通过 Lucy MCP Proxy 向 Claude Code、Codex 等客户端提供受治理的语义层、Wiki、Skill 和查询能力。首次运行前，请确保本机已经安装 KTX，并准备好当前环境需要的数据源连接、模型后端和本地密钥文件。

**客户部署 / 运维**：见 [`docs/customer-deployment-guide.md`](docs/customer-deployment-guide.md)、[`docs/deployment-docker.md`](docs/deployment-docker.md) 与 [`docs/admin-guide.md`](docs/admin-guide.md)。首版客户标准路径是标准 Lucy image + `customer-config/` 配置包 bind mount 到 `/data/lucy`；持续维护表语义、wiki、eval 和权限时先改 `customer-config/`，再运行 reindex/validate/eval gate。
**全链路测试用例**：见 [`docs/lucy-test-cases.md`](docs/lucy-test-cases.md)。

**首次 Onboarding**（详见 `docs/DEVELOPMENT.md §Onboarding`）：

```bash
# 1. 如尚未存在 ktx.yaml，从模板复制后替换 <CHANGE-ME-*> 占位符
cp ktx.yaml.example ktx.yaml

# 2. 创建密钥目录并写入 MySQL 密码（该目录已在 .gitignore 排除）
mkdir -p .ktx/secrets && echo '<your-mysql-password>' > .ktx/secrets/mysql-aliyun-password

# 3. 安装 KTX CLI（或使用本机 dev 版本）
npm install -g @kaelio/ktx@latest

# 4. 启动 KTX MCP daemon；外部客户端应通过 Lucy MCP Proxy :7879 接入
ktx mcp start --project-dir /Users/zhangxingchen/Projects/project-lucy

# 5. 验证连接
ktx status
```

仓库已附带 `.mcp.json` 示例；客户端应配置到 Lucy MCP Proxy，而不是直接暴露 KTX upstream。daemon / proxy 未运行则连接失败。

**治理工作台（WebUI）**：

```bash
cd webui
npm install
npm run dev      # Vite 前端（3000 端口）
npm run server   # Fastify API（3001 端口）
```

**后续操作**：

```bash
# 扫描或更新语义层
ktx ingest mysql-aliyun

# 验证语义层定义
ktx sl validate superstore_orders

# 列出所有语义源
ktx sl list
```

## 开发约定

在本仓库中写代码或改配置前，先阅读：

- `AGENTS.md`
- `docs/DEVELOPMENT.md`

重要边界：

- `CLAUDE.md` 是入口指引，不是数据问答运行时上下文或 agent 开发说明。
- `.ktx/secrets/` 下的密钥文件不得输出、提交或写入文档。
- 数据库连接不是仓库身份的一部分，可以按使用者环境自定义；`ktx.yaml` 中的连接信息改动前必须先确认。
- 涉及新功能、跨文件改动、语义层、KTX 运行时行为或治理类文件（`CLAUDE.md`、`AGENTS.md`、`ktx.yaml`、`skills/`）的变更，需要先进入 Plan Mode 给出计划并获得人工确认。
- `skills/` 是 lucy 增量能力的单一事实源；`.ktx/skills/` 已废弃，不要再写入。

## 设计原则

- 上下文编译优先：先把数据库、BI、文档、人工口径编译成可维护 context pack，再交给 agent 使用。
- 语义层优先：让 agent 先理解数据含义，再生成查询或分析。
- 上下文可维护：把业务知识沉淀到 Wiki、Skill、eval 和审计证据，而不是散落在临时对话里。
- 配置可迁移：数据源、模型和运行环境应通过配置替换，不绑定单一开发实例。
- 运行时与开发态隔离：产品问答上下文和开发治理规则分别维护，避免 prompt 污染。
