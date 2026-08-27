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
| `ktx.yaml` | **本机私有**（gitignore）。从 `ktx.yaml.example` 复制后填写自己的连接；勿提交。 |
| `ktx.yaml.example` | 脱敏连接模板（占位符），供开发者复制。 |
| `semantic-layer/` | 本机可放私有连接目录（gitignore：`mysql-aliyun/` 等）。仓库仅跟踪 `demo-mysql/` CI stub；客户交付 seed 用 `customer-config.example/semantic-layer/`。 |
| `skills/` | lucy 增量 skill 库（产品通用技能）。本机域名/内网专用 skill 勿提交。 |
| `lucy-skills/` | 独立 MCP server，用于将 `skills/` 以标准 MCP Resource 形式暴露给 data agent（P1.5 立项中，spec 见 `lucy-skills/docs/01-spec.md`，尚未实现）。 |
| `.ktx/prompts/` | KTX 运行时 prompt 目录，用于承载产品运行时上下文。 |
| `wiki/` | 业务知识库。仓库仅跟踪 `wiki/global/demo-superstore.md` stub；其余本机私有。 |
| `evals/` | 仓库跟踪 `evals/superstore/`（demo 可跑）；内网绑定套件本机私有。 |
| `webui/` | 治理工作台（React 19 + Vite + Fastify）。`webui/config/access.yaml` 本机私有；提交的是 `access.yaml.example`。 |
| `raw-sources/` | 本机扫描材料（gitignore 内网连接目录）；勿提交含真实 host 的快照。 |
| `customer-config.example/` | 客户交付空壳模板；默认 Docker seed 与离线包均以此为准。 |
| `examples/docker-demo/` | 本地 compose 测试库（`demo-mysql`）；仅 demo 栈使用，不进客户默认 seed。 |
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
| `semantic-layer/<your-connection>/_schema/` | **否**（本机私有），`ktx ingest` 自动生成 | 对本机连接跑 ingest 后更新 |
| `semantic-layer/demo-mysql/` | **是**，仓库 CI stub | 仅维护 demo 门禁所需最小 schema/overlay |
| `examples/*/project-template/semantic-layer/` | **是** | demo compose 模板变更时 |
| `wiki/global/demo-superstore.md` | **是**，仓库 stub | demo 知识变更时；其余 wiki 本机私有 |
| `evals/superstore/eval/` | **是** | 扩充 demo 可跑的发布前门禁 |

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
# 1. 私有运行时配置（均不进 git）
cp ktx.yaml.example ktx.yaml
cp webui/config/access.yaml.example webui/config/access.yaml
# 编辑 ktx.yaml / access.yaml 为你自己的连接与 Agent

# 2. 创建密钥目录并写入数据库密码
mkdir -p .ktx/secrets && echo '<your-db-password>' > .ktx/secrets/<connection>-password

# 3. 安装 KTX CLI（或使用本机 dev 版本）
npm install -g @kaelio/ktx@latest

# 4. 启动 KTX MCP daemon；外部客户端应通过 Lucy MCP Proxy :7879 接入
ktx mcp start --project-dir "$(pwd)"

# 5. 验证连接
ktx status
```

本地 Docker 验证用 `docker compose -f docker-compose.demo.yml up`（仅 `demo-mysql`）。客户交付默认 seed 来自 `customer-config.example`，与开发者私有测试库分离。

**治理工作台（WebUI）**：

```bash
cd webui
npm install
npm run dev      # Vite 前端（3000 端口）
npm run server   # Fastify API（3001 端口）
```

**桌面端定时截图库（snapshot-product）**

spec 见 `docs/webui-snapshot-product.md`。截图脚本是只读工具，不改任何业务文件，输出落到 `var/screenshots/` 与 `var/logs/`（已在 `.gitignore`）。

```bash
# 一次性跑（需 docker 5174 端口在跑）
node webui/scripts/snapshot-product.mjs

# 健康检查（launchd 调度器探针）
node webui/scripts/snapshot-product.mjs --healthcheck
# 期望 stdout：OK: http://127.0.0.1:5174/overview returns 200，退出码 0

# 可选配置：动态路由 fixture（/connections/:id 等需要）
cat > webui/scripts/snapshot-product.fixtures.json <<'JSON'
{
  "/connections/:id": [{"id": "demo-1"}],
  "/catalog/:conn/:schema/:table": [{"conn": "demo", "schema": "public", "table": "orders"}]
}
JSON

# 安装 launchd 调度（默认只生成 plist，不自动 bootstrap；--bootstrap 显式注册）
bash scripts/install-snapshot-product-launchd.sh              # 写 ~/Library/LaunchAgents/com.lucy.snapshot-product.plist
bash scripts/install-snapshot-product-launchd.sh --bootstrap   # 用户显式要求时才跑：launchctl bootstrap
bash scripts/install-snapshot-product-launchd.sh --uninstall   # 卸载

# plist 模板本身可被 reviewer 审查：scripts/launchd/com.lucy.snapshot-product.plist
```

环境变量（覆盖默认）：`LUCY_SNAPSHOT_BASE_URL`、`LUCY_SNAPSHOT_OUTPUT_DIR`、`LUCY_SNAPSHOT_TIMEOUT_MS`、`LUCY_SNAPSHOT_DRY_RUN=1`、`LUCY_SNAPSHOT_LAUNCHD_HOUR`、`LUCY_SNAPSHOT_LAUNCHD_MINUTE`、`LUCY_SNAPSHOT_LAUNCHD_LABEL`、`LUCY_SNAPSHOT_NODE_BIN`。

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
