# Project Lucy 系统使用与运维手册

| 项 | 内容 |
| --- | --- |
| 文档类型 | System Handbook |
| 适用对象 | 使用者、管理员、运维人员、接入 Agent 的协作者、开发者 |
| 事实来源 | `webui/server/`、`webui/src/`、`semantic-layer/`、`webui/config/`、`ktx.yaml.example`、`webui/docs/01-17` |
| 当前日期 | 2026-07-29 |

## 目录

- [1. 系统概述与架构拓扑](#1-系统概述与架构拓扑)
- [2. 快速上手](#2-快速上手)
- [3. 功能模块操作指南](#3-功能模块操作指南)
- [4. Agent / 客户端接入指南](#4-agent--客户端接入指南)
- [5. 配置与环境变量速查](#5-配置与环境变量速查)
- [6. FAQ 与排障指南](#6-faq-与排障指南)

## 1. 系统概述与架构拓扑

### 1.1 Lucy 是什么

Project Lucy 是基于 KTX 的本地语义补充工作台与 MCP 访问治理代理。它把数据库连接、静态语义层 YAML、业务 Wiki、Eval 用例和访问权限配置编译成 Agent 可用、可审计、可回归的数据服务。

Lucy 的两个核心身份：

| 身份 | 面向对象 | 核心职责 |
| --- | --- | --- |
| 本地语义补充工作台 | 数据/业务维护者 | 维护表描述、字段语义、grain、measures、segments、joins、Wiki、Eval cases |
| MCP 访问治理代理 | Codex、Hermes、Claude Code 等 Agent | Bearer token 鉴权、工具/表级 ACL、审计日志、runtime instructions 注入 |

### 1.2 架构拓扑

```text
浏览器 / WebUI 用户
  │
  │ http://127.0.0.1:5173  (dev Vite，/api 代理到 5174)
  ▼
React WebUI
  │
  │ REST /api
  ▼
Fastify WebUI API :5174
  ├─ 读取/写入 ktx.yaml、semantic-layer/、wiki/、evals/、.ktx-ui/
  ├─ 调用 ktx CLI 做 connection test / sl validate
  └─ 同进程启动 Lucy MCP Proxy :7879

Agent 客户端
  │
  │ POST http://127.0.0.1:7879/mcp
  │ Authorization: Bearer <agent-token>
  ▼
Lucy MCP Auth Proxy :7879
  ├─ 读取 webui/config/access.yaml 做身份与 ACL 裁决
  ├─ 写 .ktx-ui/audit.sqlite 访问审计
  ├─ 注入 webui/config/data-qa-instructions.md runtime instructions
  └─ 转发允许的请求到 KTX MCP upstream :7878

KTX CLI / MCP daemon
  ├─ ktx.yaml
  ├─ semantic-layer/<connection>/_schema/*.yaml      # manifest
  ├─ semantic-layer/<connection>/<source>.yaml       # overlay
  └─ wiki/**/*.md
```

端口说明：

| 场景 | 默认端口 | 说明 |
| --- | --- | --- |
| Vite dev UI | `5173` | `webui/vite.config.ts`；开发访问页面用它 |
| Fastify API / 静态 WebUI | `5174` | `LUCY_WEBUI_PORT` 可覆盖 |
| KTX MCP upstream | `7878` | 仅作为 Lucy Proxy 上游，不建议外部 Agent 直连 |
| Lucy MCP Proxy | `7879` | Agent 正式接入地址 |
| Docker/demo 宿主端口 | 可能是 `5174`、`55176`、`55177` 等 | 以 compose 环境变量和启动日志为准 |

### 1.3 核心原则

| 原则 | 含义 | 落点 |
| --- | --- | --- |
| Zero AI Dependency 数据管道 | 数据库接入、表目录、白名单、静态 Catalog 刷新不依赖 LLM、embedding 或 enrichment | `POST /api/catalog/reload` 只读本地 YAML |
| 文件系统为 SSOT | WebUI 是编辑器，不是业务事实数据库 | `ktx.yaml`、`semantic-layer/`、`wiki/`、`evals/`、`webui/config/access.yaml` |
| DryRun + Diff 预览落盘 | 写类操作默认预览，必须显式 `dryRun:false` 才写入 | 表编辑、Wiki、Agent/Role、Token、白名单、schema 添加 |
| 安全边界集中 | 所有写入走 `webui/server/fs-safe.ts` | 白名单目录、黑名单目录、路径穿越、symlink 逃逸 |
| 运行时指导与开发规则分离 | 数据问答 rules 由 Proxy initialize 注入；开发规则在 `AGENTS.md` / `docs/DEVELOPMENT.md` | 禁止把数据问答规则正文写回 `CLAUDE.md` |

### 1.4 目录与事实源地图

| 路径 | 角色 | 谁维护 |
| --- | --- | --- |
| `ktx.yaml` | KTX 项目配置、连接、`enabled_tables` | 运维/管理员 |
| `ktx.yaml.example` | 脱敏模板 | 开发者 |
| `semantic-layer/<conn>/_schema/*.yaml` | KTX scan/import 生成的物理表 manifest | KTX 生成，通常不手改 |
| `semantic-layer/<conn>/<source>.yaml` | 人工维护 overlay：grain、measures、segments、派生列、业务扩展 | 数据/语义维护者 |
| `wiki/**/*.md` | 业务文档和口径说明 | 业务/数据维护者 |
| `evals/<domain>/eval/*-eval-cases.yaml` | Agent 质量评测用例 | 测试/数据维护者 |
| `webui/config/access.yaml` | Role、Agent、Token hash、默认 deny/known tools | 管理员 |
| `webui/config/data-qa-instructions.md` | MCP initialize 注入的数据问答运行时指导 | 平台维护者 |
| `.ktx-ui/audit.sqlite`（或 `LUCY_AUDIT_DB`） | MCP 访问审计、撤销 token、权限快照、问题簇 | 系统生成 |
| `.ktx-ui/catalog-reloads.json` | 最近静态 Catalog reload 记录 | 系统生成 |
| `.ktx-ui/eval/runs.sqlite`（或 `LUCY_EVAL_DB`） | Eval run 历史 | 系统生成 |

## 2. 快速上手

### 2.1 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | 根 `package.json` 要求 `>=22`；WebUI 依赖现代 React/Vite/Fastify |
| npm | 用于安装 WebUI 依赖和运行脚本 |
| KTX CLI | `ktx mcp start`、`ktx status`、`ktx sl validate`、`ktx admin reindex` |
| 数据库账号 | 建议只读账号；生产库禁止 DDL/DML |
| Git | Review 页读取 `git diff`，Lucy 不自动 commit |

### 2.2 本地启动

```bash
cd /Users/zhangxingchen/Projects/project-lucy

# 1. 启动 KTX MCP daemon，供 Lucy Proxy 转发
ktx mcp start --project-dir /Users/zhangxingchen/Projects/project-lucy

# 2. 启动 WebUI + Fastify API + Lucy MCP Proxy
cd webui
npm install
npm run dev
```

启动后：

| 地址 | 用途 |
| --- | --- |
| `http://127.0.0.1:5173/onboarding` | 开发态 WebUI 上线检查 |
| `http://127.0.0.1:5174/api/health` | Fastify 健康检查 |
| `http://127.0.0.1:7879/mcp` | Agent MCP 接入地址 |

如果当前 KTX CLI 已支持 `ktx ui`，可用它作为封装入口；仍以启动日志中的 WebUI/API/Proxy 地址为准。

### 2.3 最小配置流程

1. 准备 `ktx.yaml`。

```bash
cp ktx.yaml.example ktx.yaml
```

2. 替换连接占位符，密码必须走本地文件或环境变量，不写明文。

```yaml
connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
    host: <CHANGE-ME-MYSQL-HOST>
    port: 3306
    database: dataforai
    username: <CHANGE-ME-USERNAME>
    password: file:/Users/zhangxingchen/Projects/project-lucy/.ktx/secrets/mysql-aliyun-password
    schemas:
      - dataforai
```

3. 创建密钥文件。

```bash
mkdir -p .ktx/secrets
printf '<your-mysql-password>' > .ktx/secrets/mysql-aliyun-password
```

4. 验证 KTX。

```bash
ktx status
ktx connection test mysql-aliyun
ktx sl validate superstore_orders --connection-id mysql-aliyun
```

5. 在 WebUI 加载本地资产。

打开 `http://127.0.0.1:5173/connections`，点击连接或全局的 `重新扫描`/`触发 Ingest` 按钮。当前实现中旧 Ingest 文案会调用静态 Catalog reload，不再执行 AI enrichment 或 `ktx ingest` 子进程。

也可以直接调用 API：

```bash
curl -s -X POST http://127.0.0.1:5174/api/catalog/reload \
  -H 'content-type: application/json' \
  -d '{"connectionId":"mysql-aliyun","schema":"dataforai"}'
```

## 3. 功能模块操作指南

### 3.1 部署向导与上线检查

入口：`/onboarding`

上线检查是 5 步 readiness，不等同于语义覆盖率。

| 步骤 | Ready 条件 | 处理入口 |
| --- | --- | --- |
| 1. 接入数据库 | 至少 1 个 connection，且 KTX runtime 可用 | `/connections` |
| 2. 限定表范围 | `enabled_tables` 数量大于 0 | `/connections/whitelist` |
| 3. 配置语义层 | 至少 1 张 semantic table 进入 `done` | `/` 表目录 |
| 4. 校验并审阅变更 | 当前无未审阅 changed files | `/review` |
| 5. 配置 Agent MCP | 存在启用 Agent，且至少 1 个可用 token；非全 legacy allow | `/admin/agents` |

当 `Deployment readiness = 5/5` 时，WebUI 会给出 MCP 配置模板；未完成时会指出下一项阻塞原因。

### 3.2 数据库接入

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 连接概览 | `/connections` | 查看 connection、schema、enabled table、KTX 可用性、MCP endpoint |
| 表白名单 | `/connections/whitelist` | 维护 `ktx.yaml` 的 `enabled_tables` |
| 连通测试 | `/connections/test` | 调用 `ktx connection test <connId>` |

连接信息来自 `ktx.yaml`。WebUI 只暴露 `passwordSource`，不会读取或返回 `password: file:` 指向的密钥内容。

白名单保存流程：

1. 在 `/connections/whitelist` 勾选/取消物理表。
2. 点击预览，后端调用：

```http
PUT /api/connections/:connId/enabled-tables
```

请求示例：

```json
{
  "dryRun": true,
  "enabledTables": [
    "dataforai.superstore_orders",
    "dataforai.kx_fact_financial_amount"
  ]
}
```

3. 预览 `ktx.yaml` diff。
4. 确认后以 `dryRun:false` 写入。
5. 写入会进入配置变更审计，表名必须已经出现在本地 `_schema/*.yaml` manifest 中。

静态 Catalog reload：

| API | 行为 |
| --- | --- |
| `POST /api/catalog/reload` | 重新读取 `ktx.yaml` 与 `semantic-layer/<conn>/_schema/*.yaml`，返回统计和 warning |
| `GET /api/catalog/reloads` | 查看最近 reload 记录 |
| `POST /api/connections/:connId/ingest` | 兼容旧端点；返回 `deprecated:true`，内部走静态 reload |

常见 warning：

| code | 含义 |
| --- | --- |
| `SCHEMA_MANIFEST_MISSING` | `ktx.yaml` 配了 schema，但本地 `semantic-layer/<conn>/_schema/<schema>.yaml` 不存在 |
| `SCHEMA_MANIFEST_EMPTY` | manifest 存在但没有表 |
| `ENABLED_TABLE_NOT_SCANNED` | `enabled_tables` 中的表未出现在本地 manifest |
| `MANIFEST_PARSE_FAILED` | manifest YAML 解析失败 |

### 3.3 语义层维护

入口：`/` 表目录、`/sources/:conn/:schema/:table` 单表编辑、`/joins/:conn/:schema/:table` 关联关系。

语义层有 manifest / overlay 双层：

| 文件 | 角色 | 写入规则 |
| --- | --- | --- |
| `semantic-layer/<conn>/_schema/<schema>.yaml` | manifest，物理表结构、列、AI 描述 | WebUI 可写 `descriptions.human` 和 joins；不要手写派生列 |
| `semantic-layer/<conn>/<source>.yaml` | overlay，人工业务扩展 | grain、measures、segments、派生 columns、业务补丁 |

Human vs AI 描述隔离：

```yaml
descriptions:
  ai: "KTX/AI 生成的描述"
  human: "人工确认后的业务描述"
```

写入原则：

| 内容 | 写入位置 |
| --- | --- |
| 表描述/字段描述 | manifest 中的 `descriptions.human` |
| grain | overlay `grain:` |
| measures | overlay `measures:` |
| segments | overlay `segments:` |
| 派生列 `expr` | overlay `columns:` |
| 物理列新增 | 重新生成 manifest，不手改 `_schema` |

示例 overlay：

```yaml
grain:
  - order_id
measures:
  - name: total_sales
    expr: sum(sales)
    description: 销售额合计
segments:
  - name: active_rows
    expr: is_deleted = 0
columns:
  - name: order_year
    type: time
    role: time
    expr: YEAR(order_date)
```

保存流程：

1. 单表编辑器修改描述、grain、measures、segments 或 joins。
2. 前端先发 `dryRun:true` 预览 diff。
3. 用户确认后发 `dryRun:false`。
4. 后端通过 `safeWrite` 写入，随后调用 `ktx sl validate <sourceName> --connection-id <conn>`。
5. `/review` 查看本次 changed files，并可运行 `Validate changed`。

CLI 验证：

```bash
ktx sl validate superstore_orders --connection-id mysql-aliyun
ktx sl read superstore_orders --connection-id mysql-aliyun
ktx --project-dir /Users/zhangxingchen/Projects/project-lucy admin reindex
```

说明：编辑 YAML 后，MCP/KTX 检索通常读本地 SQLite 索引；需要让 Agent 搜到新口径时，执行 `ktx admin reindex`。

### 3.4 业务文档 Wiki

入口：`/wiki`

Wiki 文件位于 `wiki/**/*.md`，使用 Markdown + YAML frontmatter。WebUI 支持列表、编辑、预览、diff、保存。

Frontmatter 字段：

| 字段 | 用途 |
| --- | --- |
| `summary` | 页面摘要 |
| `tags` | 标签 |
| `sl_refs` | 关联语义对象，格式为 `conn/schema/table` |
| `refs` | 外部或内部引用 |
| `usage_mode` | 使用模式说明 |

示例：

```markdown
---
summary: Superstore 订单业务口径
tags:
  - superstore
  - order
sl_refs:
  - mysql-aliyun/dataforai/superstore_orders
refs:
  - docs/mysql-comment-maintenance.md
usage_mode: agent_context
---

# Superstore 订单口径

这里写业务定义、限制、常见问题和示例。
```

单表编辑器与 Wiki 的双向联动：

| 行为 | URL |
| --- | --- |
| 从表进入 Wiki | `/wiki?sl_ref=mysql-aliyun/dataforai/superstore_orders` |
| 找到已有关联页 | WebUI 打开匹配 `sl_refs` 的页面 |
| 未找到 | 生成草稿 key，并预填 `frontmatter.sl_refs` |
| 从 Wiki 返回表 | `sl_refs` chip 链到 `/sources/:conn/:schema/:table` |

保存 API：

```http
PUT /api/wiki/:key
```

```json
{
  "dryRun": true,
  "frontmatter": {
    "summary": "订单口径",
    "sl_refs": ["mysql-aliyun/dataforai/superstore_orders"]
  },
  "content": "# 订单口径\n..."
}
```

安全边界：Wiki key 必须是 `wiki/` 下的相对 `.md` 路径；禁止绝对路径、`..`、非 Markdown 文件。

### 3.5 访问治理 Admin

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| Agent 实例 | `/admin/agents` | 创建/禁用 Agent、查看 token 与最近调用 |
| Role 配置 | `/admin/roles` | 管理 role 权限模板和 YAML role |
| 访问日志 | `/admin/audit` | 按用户、工具、source、trace、outcome 查询 |
| 数据源热力 | `/admin/audit-sources` | 查看 source/table 调用和拒绝分布 |
| 配置变更 | `/admin/config-audit` | 查看 `access.yaml`、`ktx.yaml` 等配置变更 |

权威配置：`webui/config/access.yaml`。

Role-first 模型：

```yaml
roles:
  kx_readonly:
    description: KX 财务数据只读问答
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - kx_dim_company
            - kx_fact_financial_amount
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question

users:
  - id: analyst_agent
    name: Analyst Agent
    enabled: true
    role: kx_readonly
    tokens:
      - hash: sha256:<hex>
        label: laptop
        created: 2026-07-29

defaults:
  deny_tools:
    - sql_execution
    - memory_ingest
    - memory_ingest_status
```

Token 发行规则：

| 操作 | 行为 |
| --- | --- |
| 新建 token | 生成 32 字节随机明文；HTTP 响应只显示一次 |
| 落盘 | `access.yaml` 只保存 `sha256:<hex>` |
| 撤销 token | 先写 `.ktx-ui/audit.sqlite.revoked_tokens`，再从 YAML 删除 |
| 删除 Agent | 先撤销该 Agent 所有 token，再删除 YAML user |
| 复制 MCP 配置 | 只复制 `${LUCY_AGENT_TOKEN}` 占位符，不复制明文 |

注意：`expires_at` 当前仅作为配置 metadata；Proxy 身份校验不会按该字段自动拒绝过期 token。下线 token 必须在 Admin 执行撤销，或调用 `DELETE /api/admin/agents/:userId/tokens/:label`。

权限裁决机制：

1. Bearer token 现场 `sha256`。
2. 与 `access.yaml` 中 token hash 匹配。
3. 检查 token 是否在 `revoked_tokens`。
4. 解析 user 的 role。
5. role 通过 `connections` + `tableSelectors` 解析成 effective sources/tables。
6. `tools/list` 只展示允许工具。
7. `tools/call` 再次做工具、连接、表、raw query、敏感 metadata、并发等裁决。
8. 允许/拒绝/错误全部写审计，包含 `decision_reason`。

常见 `decision_reason`：

| reason | 含义 |
| --- | --- |
| `allowed` | 通过 |
| `agent_disabled` | Agent 被禁用 |
| `tool_forbidden` | role 未授权该工具；user 不存在或未配置时也可能返回 |
| `tool_forbidden_global` | 命中全局 deny tools |
| `table_forbidden:<table>` | 请求表不在授权范围 |
| `raw_query_forbidden` | `lucy_query`/`sl_query` 传入原始 SQL |
| `explicit_table_required:<empty>` | 查询未显式引用可解析 source/table |
| `explicit_table_required:<table>` | 请求涉及敏感表，但没有显式声明该表 |
| `unknown_or_forbidden_connection:<conn>` | connection 缺失或未授权 |
| `sensitive_metadata_forbidden:kx` | 敏感元数据工具未获得完整敏感表授权 |
| `role_resolution_failed:<role>` | role 配置无法解析 |
| `query_concurrency_exceeded` | 单 token 并发 `lucy_query` 超限 |

问题簇审计：

| 表/视图 | 含义 |
| --- | --- |
| `access_log` | 每次 MCP 调用 |
| `access_log_sources` | 调用涉及的数据源正规化结果 |
| `conversation_turns` | 客户端通过 `lucy_begin_question` 上报的问题 |
| `inferred_turns` | 按时间窗口聚类推断的问题簇 |
| `inferred_turn_access_logs` | 问题簇与 access log 关联 |
| `revoked_tokens` | 已撤销 token hash；即使 YAML 残留也应拒绝 |
| `permission_snapshots` | 每次裁决时保存的权限快照，便于事后复盘 |

Admin API 示例：

```bash
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=50"
curl -s "http://127.0.0.1:5174/api/admin/audit/turns?source=all&lookbackHours=24"
curl -s "http://127.0.0.1:5174/api/admin/audit/sources?hours=24"
```

### 3.6 质量评测 Eval

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| Case 管理 | `/eval/cases` | 查看 domain 与 case |
| Case 编辑 | `/eval/cases/:domain/:caseId` | 编辑 YAML case，支持 dryRun diff |
| 运行历史 | `/eval/runs` | 查看 run 列表 |
| Run 详情 | `/eval/runs/:runId` | 查看逐 case 结果、artifact、compare |
| 趋势监控 | `/eval/monitor` | pass rate 趋势、top failures、drift distribution、阈值 |

Eval 文件约定：

```text
evals/<domain>/eval/<domain>-eval-cases.yaml
```

已有 domain：

| domain | 文件 |
| --- | --- |
| `superstore` | `evals/superstore/eval/superstore-eval-cases.yaml` |
| `kx_financial` | `evals/kx_financial/eval/kx_financial-eval-cases.yaml` |
| `data_agent_poc` | `evals/data_agent_poc/eval/data_agent_poc-eval-cases.yaml` |

Run 启动 API：

```http
POST /api/eval/runs
```

```json
{
  "domain": "superstore",
  "caseSelection": { "mode": "all" },
  "ktxMcpUrl": "http://127.0.0.1:7879/mcp",
  "triggeredBy": "local-admin"
}
```

运行机制：

| 步骤 | 行为 |
| --- | --- |
| 预检 | `claude auth status` 必须通过 |
| 并发 | 同一时间只允许一个 queued/running eval |
| 执行 | 后端 spawn eval runner，并通过 SSE 提供 run stream |
| 入库 | `.ktx-ui/eval/runs.sqlite` 或 `LUCY_EVAL_DB` |
| 产物 | run artifact 和 markdown summary |
| 分类 | `pass`、`logic_regression`、`tool_error`、`schema_drift`、`data_drift` |

## 4. Agent / 客户端接入指南

### 4.1 接入地址

```text
http://127.0.0.1:7879/mcp
```

请求必须携带：

```http
Authorization: Bearer ${LUCY_AGENT_TOKEN}
```

不要把 `KTX_INTERNAL_TOKEN` 分发给外部 Agent；它只用于 Lucy Proxy 调用 KTX upstream。

### 4.2 Codex / Claude Code `.mcp.json`

推荐使用环境变量，不把 token 明文写入仓库：

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "http://127.0.0.1:7879/mcp",
      "headers": {
        "Authorization": "Bearer ${LUCY_AGENT_TOKEN}"
      }
    }
  }
}
```

本机 shell 中读取 secret 文件：

```bash
export LUCY_AGENT_TOKEN="$(cat /Users/zhangxingchen/Projects/project-lucy/.ktx/secrets/lucy-agent-token)"
```

### 4.3 Hermes / 通用 HTTP MCP client

```json
{
  "mcpServers": {
    "lucy": {
      "url": "http://127.0.0.1:7879/mcp",
      "headers": {
        "Authorization": "Bearer ${LUCY_AGENT_TOKEN}"
      }
    }
  }
}
```

生产或客户部署中，将 token 存在 Agent 平台的 secret store，再通过环境变量或平台变量注入。

### 4.4 可用工具面

R1 / 新接入 Agent 推荐只暴露 6 个 `lucy_*` 核心工具：

| 工具 | 用途 | 备注 |
| --- | --- | --- |
| `lucy_catalog` | 列出当前 token 可见 connection/source 和安全示例 | 查询前首选 |
| `lucy_read_source` | 读取一个授权 semantic source | Proxy 转发到 `sl_read_source` |
| `lucy_query` | 运行授权语义查询 | Proxy 转发到 `sl_query`；禁止 raw SQL |
| `lucy_explain_query` | 解释同一参数会如何被授权/限流，不执行查询 | 排障用，不是常规 dry-run |
| `lucy_freshness` | 返回 source 的语义层更新时间与物理 freshness 可用性 | 当前物理数据 freshness 不可用时显式说明 |
| `lucy_begin_question` | 可选，上报自然语言问题，便于审计关联 | 可用 `LUCY_ENABLE_QUESTION_TOOL=false` 关闭 |

兼容/辅助工具可能包括 `kx_catalog`、`wiki_search`、`wiki_read`、`connection_list`、`sl_query`、`sl_read_source`、`entity_details` 等。是否可见完全由 role 的 `allow.tools` 和全局 defaults 决定。

`lucy_query` 参数建议：

```json
{
  "connectionId": "poc-mysql-aliyun",
  "measures": ["poc_ad_revenue_daily.ad_revenue"],
  "dimensions": [
    { "field": "poc_ad_revenue_daily.dt", "granularity": "month" }
  ],
  "segments": ["poc_ad_revenue_daily.domestic"],
  "order_by": [
    { "field": "poc_ad_revenue_daily.dt", "direction": "asc" }
  ],
  "limit": 20
}
```

注意：

| 规则 | 原因 |
| --- | --- |
| 使用 source-qualified key，如 `source.measure` | ACL 需要显式表归属 |
| `dimensions` / `order_by` 用对象数组 | Proxy 会校验 shape |
| 不传 `query` / `sql` 原始 SQL | raw query 默认拒绝 |
| `limit` 默认 `LUCY_QUERY_DEFAULT_LIMIT`，最大 `LUCY_QUERY_MAX_LIMIT` | 防止过大结果 |
| 每 token 并发 `lucy_query` 默认最多 4 个 | 超限 `query_concurrency_exceeded` |

## 5. 配置与环境变量速查

### 5.1 `webui/config/access.yaml`

结构：

```yaml
roles:
  <role_id>:
    description: <text>
    allow:
      connections:
        - <connection-id>
      tableSelectors:
        - connection: <connection-id>
          schema: <schema>
          names:
            - <source-name>
        - connection: <connection-id>
          schema: <schema>
          prefix: kx_
      tools:
        - lucy_catalog
        - lucy_query

users:
  - id: <agent-id>
    name: <display-name>
    enabled: true
    role: <role_id>
    tokens:
      - hash: sha256:<hex>
        label: <token-label>
        created: 2026-07-29
        expires_at: 2026-08-29T00:00:00Z
        # 当前仅作 metadata；Proxy 不会自动按过期时间拒绝请求。

defaults:
  deny_tools:
    - sql_execution
  known_tools:
    - lucy_catalog
    - lucy_query
  table_touching_tools:
    - lucy_query
  sensitive_metadata_tools:
    - dictionary_search
  sensitive_table_prefixes:
    - dataforai.kx_
```

约束：

| 配置 | 约束 |
| --- | --- |
| `role.allow.tools` | 必须非空；包含 wildcard `*` 会触发 fail-closed，整个 role 解析失败 |
| `tableSelectors` | `names` 与 `prefix` 二选一；匹配 0 个 source 会 fail-closed |
| `users[].allow` | legacy，只读兼容；新 Agent 必须选择 role |
| `users[].tokens[].hash` | 只存 hash，不存明文 |
| `users[].tokens[].expires_at` | 当前仅作 metadata，不参与 Proxy 鉴权；过期下线必须撤销 token |
| `defaults.deny_tools` | 全局拒绝优先于 role allow |

### 5.2 `ktx.yaml`

关键字段：

```yaml
connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
    host: <host>
    port: 3306
    database: dataforai
    username: <readonly-user>
    password: file:/absolute/path/.ktx/secrets/mysql-aliyun-password
    schemas:
      - dataforai

  starrocks-r1:
    driver: mysql
    engine: starrocks
    wire_protocol: mysql
    readonly: true
    r1_target: true
    enabled_tables:
      - dataforai.kx_fact_financial_amount
    host: <host>
    port: 9030
    database: dataforai
    username: <readonly-user>
    password: env:STARROCKS_PASSWORD
    schemas:
      - dataforai

storage:
  state: sqlite
  search: sqlite-fts5
  git:
    author: ktx <ktx@example.com>

setup:
  database_connection_ids:
    - mysql-aliyun
    - starrocks-r1
```

字段说明：

| 字段 | 用途 |
| --- | --- |
| `connections.<id>.driver` | KTX 连接 driver |
| `engine` / `wire_protocol` | Doris/StarRocks 等 MySQL wire 目标需要明确；原生 MySQL 通常只需 `driver: mysql` |
| `readonly` | 运维意图；数据库账号仍应真实只读 |
| `r1_target` | 标记该连接面向 R1 / Agent 只读目标使用 |
| `enabled_tables` | WebUI 白名单和 MCP 暴露基础范围 |
| `schemas` | 配置态 schema；manifest 是否存在由 Catalog reload 检查 |
| `password` | 推荐 `file:` 或 `env:`；不要 inline 明文 |
| `storage.state` / `storage.search` | 本地状态库和全文索引实现 |
| `storage.git.author` | KTX/Lucy 产生变更时使用的 Git author 标识 |

### 5.3 环境变量

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `KTX_PROJECT_ROOT` | 向上查找 `ktx.yaml` | 指定 Lucy/KTX 项目根 |
| `KTX_INTERNAL_TOKEN` | 空 | Lucy Proxy 转发到 KTX upstream 时使用的内部 Bearer |
| `LUCY_AGENT_TOKEN` | 无 | 推荐客户端配置占位；由本机 secret store 或 shell 环境注入 |
| `LUCY_WEBUI_HOST` | `127.0.0.1` | Fastify 绑定 host |
| `LUCY_WEBUI_PORT` | `5174` | Fastify API / 静态 WebUI 端口 |
| `LUCY_WEBUI_DIST_DIR` | `webui/dist` | 生产静态资源目录 |
| `LUCY_PROXY_HOST` | `127.0.0.1` | MCP Proxy 绑定 host |
| `LUCY_PROXY_PORT` | `7879` | MCP Proxy 端口 |
| `LUCY_PROXY_UPSTREAM_HOST` | `127.0.0.1` | KTX MCP upstream host |
| `LUCY_PROXY_UPSTREAM_PORT` | `7878` | KTX MCP upstream port |
| `LUCY_PROXY_MAX_BODY_BYTES` | `1048576` | Proxy 请求体上限 |
| `LUCY_PROXY_UPSTREAM_TIMEOUT_MS` | `30000` | 上游超时 |
| `LUCY_ACCESS_CONFIG_PATH` | `webui/config/access.yaml` | 覆盖 access 配置路径 |
| `LUCY_AUDIT_DB` | `.ktx-ui/audit.sqlite` | 覆盖 MCP 审计库 |
| `LUCY_EVAL_DB` | `.ktx-ui/eval/runs.sqlite` | 覆盖 Eval 运行库 |
| `LUCY_ENABLE_INSTRUCTIONS_INJECTION` | 开启 | `false` 时关闭 initialize instructions 注入 |
| `LUCY_ENABLE_QUESTION_TOOL` | 开启 | `false` 时不注入 `lucy_begin_question` |
| `LUCY_STORE_QUESTION_PREVIEW` | 开启 | 是否保存脱敏问题预览 |
| `LUCY_QUESTION_PREVIEW_MAX_CHARS` | `500` | 问题预览最大长度 |
| `LUCY_QUESTION_PREVIEW_RETENTION_DAYS` | `30` | 问题预览保留天数 |
| `LUCY_QUESTION_PREVIEW_PURGE_SAMPLE_RATE` | `0.01` | `lucy_begin_question` 后 lazy purge 采样率 |
| `LUCY_REPORTED_TURN_ATTACH_WINDOW_MS` | `600000` | reported question 与后续调用关联窗口 |
| `LUCY_TURN_INFER_GAP_MS` | `120000` | inferred turn 聚类间隔 |
| `LUCY_TURN_INFER_LOOKBACK_HOURS` | `24` | inferred turn 查询回看窗口 |
| `LUCY_QUERY_DEFAULT_LIMIT` | `100` | `lucy_query` 默认 limit |
| `LUCY_QUERY_MAX_LIMIT` | `1000` | `lucy_query` 最大 limit |
| `LUCY_QUERY_MAX_INFLIGHT` | `4` | 单 token 并发 `lucy_query` 上限 |
| `LUCY_R1_SLOW_QUERY_MS` | `30000` | R1 observability 慢查询阈值 |
| `LUCY_R1_HERMES_ACCURACY_REPORT` | 未设置 | R1 observability 读取外部 Hermes 准确率报告 |

Docker 常用宿主映射变量：

| 变量 | 用途 |
| --- | --- |
| `LUCY_WEBUI_HOST_PORT` | 宿主机映射到容器 `5174` |
| `LUCY_PROXY_HOST_PORT` | 宿主机映射到容器 `7879` |
| `KTX_VERSION` | 构建镜像时安装的 KTX 版本 |
| `LUCY_EXPECTED_KTX_VERSION` | smoke/health 期望版本 |

## 6. FAQ 与排障指南

### 6.1 为什么提示“未发现本地 manifest”？

含义：`ktx.yaml` 中配置了 schema 或 `enabled_tables`，但 `semantic-layer/<conn>/_schema/<schema>.yaml` 不存在，或该 manifest 没有包含目标表。

处理：

```bash
# 1. 检查 ktx.yaml
rg -n "enabled_tables|schemas" ktx.yaml

# 2. 检查本地 manifest
ls semantic-layer/mysql-aliyun/_schema

# 3. 如 manifest 已存在，刷新 WebUI Catalog 视图
curl -s -X POST http://127.0.0.1:5174/api/catalog/reload \
  -H 'content-type: application/json' \
  -d '{"connectionId":"mysql-aliyun"}'

# 4. 如 KTX 索引需要给 Agent 检索，重建索引
ktx --project-dir /Users/zhangxingchen/Projects/project-lucy admin reindex
```

注意：当前 WebUI 的 Reload Catalog 只读本地静态 YAML；它不会自动连接数据库扫描新表，也不会触发 AI enrichment。

### 6.2 JSON-RPC `Access denied` / `decision_reason` 怎么查？

1. 先看客户端返回文本，通常形如：

```json
{
  "result": {
    "isError": true,
    "content": [
      { "type": "text", "text": "Access denied: table_forbidden:dataforai.secret_table" }
    ]
  }
}
```

2. 在 WebUI 打开 `/admin/audit`，按 user/tool/outcome 过滤。

3. 用 API 直接查询：

```bash
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=50"
curl -s "http://127.0.0.1:5174/api/admin/audit/sources?hours=24"
```

4. 对照 role：

```bash
rg -n "roles:|tableSelectors|tools|<agent-id>|<role-id>" webui/config/access.yaml
```

5. 若是 `role_resolution_failed`，检查 selector 是否能匹配到本地 manifest source：

```bash
ktx sl read <source-name> --connection-id <connection-id>
```

### 6.3 配置文件改动后什么时候生效？

| 改动 | 生效机制 |
| --- | --- |
| `webui/config/access.yaml` role/user/token | MCP 身份识别/token hash 匹配路径可能缓存最多 30 秒；Admin 管理接口通常直接读文件或 fresh 解析；新 token 立即验证可等待 30 秒或重启 WebUI/Proxy |
| `semantic-layer/**/*.yaml` | WebUI 下次 API 读取文件即可看到；KTX/MCP 检索需要 `ktx admin reindex` |
| `wiki/**/*.md` | WebUI 下次读取文件即可看到；KTX/MCP 检索需要 `ktx admin reindex` |
| `ktx.yaml enabled_tables` | WebUI 保存后立即写文件；运行静态 `POST /api/catalog/reload` 检查 manifest 对齐 |
| `ktx.yaml` 新连接或凭据 | 可能需要重启 KTX MCP daemon；至少运行 `ktx connection test <connId>` |
| `webui/config/data-qa-instructions.md` | Proxy 当前实现一次性加载；修改后重启 WebUI/Proxy 才稳妥 |

### 6.4 WebUI 页面打不开

检查：

```bash
curl -fsS http://127.0.0.1:5174/api/health
```

如果 `5173` 页面打不开但 `5174` 健康检查正常，检查 `npm run dev` 是否启动了 Vite；如果 `5174` 也失败，检查 `LUCY_WEBUI_PORT` 或端口占用。

### 6.5 MCP 返回 401

常见原因：

| 原因 | 处理 |
| --- | --- |
| 未带 `Authorization` | 客户端配置加 `Bearer ${LUCY_AGENT_TOKEN}` |
| token 明文与 YAML hash 不匹配 | 重新在 Admin 生成 token |
| token 已撤销 | 新建 token |
| `LUCY_ACCESS_CONFIG_PATH` 指向了另一份配置 | 检查 WebUI/Proxy 进程环境 |
| 客户端环境变量未展开 | 确认 `${LUCY_AGENT_TOKEN}` 在启动客户端前已 export |
| 误以为 `expires_at` 会自动下线 token | 当前 `expires_at` 仅作 metadata；请撤销 token，或调用 `DELETE /api/admin/agents/:userId/tokens/:label` |

### 6.6 KTX upstream 不可用

本地 fallback 只覆盖 `initialize`、`tools/list`，以及 `tools/call` 的 `wiki_search`。`lucy_query`、`lucy_read_source`、`lucy_catalog` 等真实数据工具仍需要 KTX upstream。

检查：

```bash
ktx status
ktx mcp start --project-dir /Users/zhangxingchen/Projects/project-lucy
curl -fsS http://127.0.0.1:5174/api/health
```

Proxy 转发目标由 `LUCY_PROXY_UPSTREAM_HOST` / `LUCY_PROXY_UPSTREAM_PORT` 控制，默认 `127.0.0.1:7878`。

### 6.7 为什么白名单表保存失败？

`PUT /api/connections/:connId/enabled-tables` 会拒绝：

| 错误 | 含义 |
| --- | --- |
| `INVALID_ENABLED_TABLE` | 表名不是 `schema.table` 或含非法字符 |
| `DUPLICATE_ENABLED_TABLE` | 重复表 |
| `TABLE_NOT_SCANNED` | 表不在本地 manifest |
| `CONNECTION_NOT_FOUND` | `ktx.yaml` 没有该 connection |

处理：先补齐/刷新 `semantic-layer/<conn>/_schema/*.yaml`，再运行 Reload Catalog。

### 6.8 安全边界速查

| 边界 | 当前实现 |
| --- | --- |
| 可写目录 | `semantic-layer/`、`evals/`、`skills/`、`wiki/`、`.ktx-ui/`、`webui/config/` |
| 可写单文件 | `ktx.yaml` |
| 禁止写 | `.ktx/secrets/`、`raw-sources/`、`.git/`、白名单外路径 |
| 禁止读返回 | `.ktx/secrets/**` |
| secret 预览 | `ktx.yaml` diff 会剥离 password/token/secret 类键 |
| token 明文 | 只在创建 token 的 HTTP 响应出现一次 |
| Role tools wildcard | `role.allow.tools` 为空或包含 `*` 会让整个 role fail-closed，返回 `role_resolution_failed:<role>` |
| 外部 Agent | 只拿 Agent token，不拿 `KTX_INTERNAL_TOKEN` |
| 原始 SQL | `lucy_query` / `sl_query` raw `query`/`sql` 默认拒绝 |
| 服务绑定 | 本地默认 `127.0.0.1`；Docker/客户部署才显式 `0.0.0.0` |

### 6.9 最小健康检查清单

```bash
# WebUI/API
curl -fsS http://127.0.0.1:5174/api/health

# 本地配置解析
curl -fsS http://127.0.0.1:5174/api/project

# Catalog 静态刷新
curl -fsS -X POST http://127.0.0.1:5174/api/catalog/reload \
  -H 'content-type: application/json' \
  -d '{}'

# KTX 语义层验证
ktx sl validate <source-name> --connection-id <connection-id>

# Agent 接入 smoke：用真实 token 初始化 MCP session 后 tools/list
# 不要在命令或日志里输出 token 明文。
```
