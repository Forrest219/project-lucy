# Project Lucy 系统使用与运维手册

| 项 | 内容 |
| --- | --- |
| 文档类型 | System Handbook |
| 适用对象 | 使用者、管理员、运维人员、接入 Agent 的协作者、开发者 |
| 事实来源 | `webui/server/`、`webui/src/`、`semantic-layer/`、`webui/config/`、`ktx.yaml.example`、`webui/docs/01-17` |
| 当前日期 | 2026-08-20 |

## 目录

- [0. 常见问题速查](#0-常见问题速查)
- [1. 系统概述与架构拓扑](#1-系统概述与架构拓扑)
  - [1.5 WebUI 入口速查（5+1 侧栏地图）](#15-webui-入口速查5+1-侧栏地图)
- [2. 快速上手](#2-快速上手)
- [3. 功能模块操作指南](#3-功能模块操作指南)
  - [3.1 部署向导与上线检查](#31-部署向导与上线检查)
    - [系统概览待处理事项](#系统概览待处理事项)
  - [3.2 数据库接入](#32-数据库接入)
  - [3.3 语义层维护](#33-语义层维护)
    - [为什么要编写语义 YAML](#为什么要编写语义-yaml)
    - [推荐编写工作流](#推荐编写工作流)
    - [grain、join 与 fanout](#grainjoin-与-fanout)
    - [KTX 官方延伸阅读](#ktx-官方延伸阅读)
  - [3.4 业务文档 Wiki](#34-业务文档-wiki)
  - [3.5 访问治理 Admin](#35-访问治理-admin)
    - [审计热库与冷库（SQL 留存边界）](#审计热库与冷库sql-留存边界)
  - [3.6 质量评测 Eval](#36-质量评测-eval)
  - [3.7 YAML 文件规范与交付验收](#37-yaml-文件规范与交付验收)
    - [3.7.0 overlay 字段速查（编写辅导）](#370-overlay-字段速查编写辅导)
- [4. Agent / 客户端接入指南](#4-agent--客户端接入指南)
- [5. 配置与环境变量速查](#5-配置与环境变量速查)
- [6. FAQ 与排障指南](#6-faq-与排障指南)
  - [6.10 `lucy_query` 报 No join path / 跨表失败](#610-lucy_query-报-no-join-path--跨表失败)
  - [6.11 fanout / Aggregate locality 拒绝查询](#611-fanout--aggregate-locality-拒绝查询)
  - [6.12 `order_by` 排序无效或排反](#612-order_by-排序无效或排反)
  - [6.13 语义查询答不出复杂分析题，或 Eval 对不上 gold](#613-语义查询答不出复杂分析题或-eval-对不上-gold)
  - [6.14 改了 Manifest / Wiki，MCP 仍旧或 reindex 失败](#614-改了-manifest--wikimcp-仍旧或-reindex-失败)

## 0. 常见问题速查

本节是按用户问题组织的快速入口。每条答案给下一步判断；完整操作以正文章节为准。
常见问题按三种角色分组：开发者 / 管理员 / 接入协作者。
第 6 章 FAQ 与排障指南 是配套的故障排查 deep dive。

### 0.1 面向开发者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| 我在哪里新建数据库连接？ | `WebUI` 不新建物理连接；先在 `ktx.yaml` 和 secret 文件声明连接，再回 `WebUI` 管理已声明连接。 | [3.2 数据库接入](#32-数据库接入)、[WebUI 与 ktx.yaml 的职责边界](#webui-与-ktxyaml-的职责边界) |
| 数据库密码应该放在哪里？ | 用 `file:`、`env:` 或 `Docker` secrets；不要把明文密码写进 `ktx.yaml`、文档、`commit message` 或聊天记录。 | [连接形态与配置字段](#连接形态与配置字段)、[5.2 ktx.yaml](#52-ktxyaml) |
| 点了刷新本地目录，刷新后的表在哪里看？ | `/connections` 看 reload 状态，`/connections/enabled-tables` 看可纳入启用表范围的表，`WebUI` 首页 `/` 看已进入语义建模的表。 | [刷新本地目录](#刷新本地目录) |
| 连接概览上的「已发现表数」是什么？ | 统计本地 Schema Manifest 已读到的表，不是远端物理库实时表数；与「已启用表数」（`enabled_tables`）对照看。 | [连接概览指标说明](#连接概览指标说明) |
| 为什么提示“未发现本地 manifest”？ | `ktx.yaml` 声明了 `Schema` 或启用表范围，但本地 `semantic-layer/<conn>/_schema/<schema>.yaml` 缺失或未包含目标表。 | [6.1 为什么提示“未发现本地 manifest”？](#61-为什么提示未发现本地-manifest) |
| `YAML` 改完后为什么 `Agent` 仍然搜不到新口径？ | `WebUI` 读文件即可看到；`KTX` / `MCP` 检索需要 `ktx admin reindex`，并且还要用 `sl read` 确认 `overlay` 已合并到目标 `source`。 | [6.3 配置文件改动后什么时候生效？](#63-配置文件改动后什么时候生效)、[3.7.6.2 KTX 合并与索引检查](#3762-ktx-合并与索引检查) |
| 我应该改 `manifest` 还是 `overlay`？ | 物理表结构和物理列描述在 `manifest`；`grain`、`measures`、`segments`、派生列和业务补丁在 `overlay`。 | [3.3 语义层维护](#33-语义层维护)、[3.7.1 YAML 类型总览](#371-yaml-类型总览) |
| 新增指标怎样才算可以交付？ | 不能只看 `reindex` 或单个 `sl validate`；必须通过静态检查、`sl read`、真实 query、`MCP smoke` 和最终 `GO / NO-GO` 门槛。 | [3.7.6 GO / NO-GO 交付 checklist](#376-go--no-go-交付-checklist) |
| `lucy_query` 报 `No join path`？ | 跨 source 查询需要 Manifest/overlay 声明 `joins` + `relationship`，并完成索引重建；有物理外键不等于语义层已连通。 | [6.10 `lucy_query` 报 No join path / 跨表失败](#610-lucy_query-报-no-join-path--跨表失败)、[grain、join 与 fanout](#grainjoin-与-fanout) |
| 查询被 fanout / Aggregate locality 拒绝？ | measure 源与 filter/dimension 路径不能靠 `one_to_many` 扇出聚合；换 measure 源、改维度，或拆成多步半连接式查询。 | [6.11 fanout / Aggregate locality 拒绝查询](#611-fanout--aggregate-locality-拒绝查询) |
| 评测用例和运行历史在哪里？ | 用 `/eval/cases` 维护评测用例，用 `/eval/runs` 看运行历史，用 `/eval/monitor` 看趋势监控。 | [3.6 质量评测 Eval](#36-质量评测-eval) |
| `/overview`「待处理事项」里「N 张表待补语义」怎么算？ | 按表计数：只统计已进入启用表范围（`enabled_tables`）且出现在本地 `Manifest` 的表。`N` = 这些表中 `completion !== done` 的数量；未启用的 `Manifest` 表不计入。`done` 需同时有表描述、`grain`、主键、全部非 `hidden` 列描述和至少一个 `measure`。 | [系统概览待处理事项](#系统概览待处理事项)、[3.3 语义层维护](#33-语义层维护) |
| 「待处理事项」其它条目分别统计什么？ | `Catalog` 待处理当前与语义缺口同数；待发布看 `/api/diff` 文件数；无评测看是否已有评测运行记录。近 7 天 `ACL` 拒绝只在「访问风险」指标卡展示，不进入待处理事项。计数为 0 不展示。 | [系统概览待处理事项](#系统概览待处理事项) |

### 0.2 面向管理员

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| `Agent` 返回 `Access denied` 时先查哪里？ | 先看客户端里的 `decision_reason`，再打开 `/admin/audit` 或查 `/api/admin/audit?outcome=denied`，对照 `role` 的连接、表和工具授权。 | [6.2 JSON-RPC Access denied / decision_reason 怎么查？](#62-json-rpc-access-denied--decisionreason-怎么查)、[3.5 访问治理 Admin](#35-访问治理-admin) |
| `expires_at` 到期后 `token` 会自动失效吗？ | 不会。`expires_at` 当前只是 `metadata`；要下线 `token` 必须在 `Admin` 撤销或调用删除 `token` `API`。 | [3.5 访问治理 Admin](#35-访问治理-admin)、[6.5 MCP 返回 401](#65-mcp-返回-401) |
| 为什么 `/admin/audit` 看不到完整 `SQL`？ | 这是审计热库边界：只保留 `query_hash` 与脱敏截断的 `query_preview`，不存完整 `SQL` / `SQL AST` 原文。业务 `Eval` 运行库可另存 runner 捕获的 `SQL`；从生产访问日志抽安全候选时也只能看到脱敏摘要。 | [审计热库与冷库（SQL 留存边界）](#审计热库与冷库sql-留存边界)、[3.6 质量评测 Eval](#36-质量评测-eval) |
| 新连接什么时候对 `Agent` 可见？ | `ktx.yaml`、`manifest` / `overlay`、启用表范围、`KTX reindex`、`access.yaml` `role` / `ACL` 都就绪后才可见。 | [Agent 可见性与 ACL 同步](#agent-可见性与-acl-同步)、[新增数据库连接（运维 Runbook）](#新增数据库连接运维-runbook) |

### 0.3 面向接入协作者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| `MCP` 返回 401 是什么原因？ | 通常是未带 `Bearer` `token`、`token` hash 不匹配、`token` 已撤销、`expires_at` 已到期、环境变量未展开或进程读取了另一份 `access` 配置。 | [6.5 MCP 返回 401](#65-mcp-返回-401) |
| 本地开发应该访问哪个端口？ | 页面端口以启动日志为准；常见开发入口是 `Vite 5173`，`API 5174`，`Lucy MCP Proxy 7879`。`Docker` / demo 宿主端口可能是 `55176` 等映射端口。 | [2.2 本地启动](#22-本地启动)、[4.1 接入地址](#41-接入地址) |
| 为什么 Visible Scope 没有我刚启用的表？ | 检查 `enabled_tables`、`role` 的 `tableSelectors`、以及是否**新开** MCP session；扩权后旧 session 不会自动刷新 Scope。 | [Agent 可见性与 ACL 同步](#agent-可见性与-acl-同步)、[6.2 JSON-RPC Access denied / decision_reason 怎么查？](#62-json-rpc-access-denied--decisionreason-怎么查) |
| `order_by` 为什么没按我想的降序？ | 结构化参数请用 `direction: desc|asc`；仅写 `dir` 可能被忽略，导致默认升序。 | [6.12 `order_by` 排序无效或排反](#612-order_by-排序无效或排反) |

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
  │ POST <LUCY_PUBLIC_MCP_URL>
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
| Lucy MCP Proxy | `7879` | 内部监听端口；Agent 正式接入地址以 `LUCY_PUBLIC_MCP_URL` / WebUI 展示值为准 |
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
| `.ktx-ui/audit.sqlite`（或 `LUCY_AUDIT_DB`） | MCP 访问审计热库：撤销 token、权限快照、问题簇、`query_hash` / 脱敏 preview；不存完整 SQL 原文 | 系统生成 |
| `.ktx-ui/catalog-reloads.json` | 最近静态 Catalog reload 记录 | 系统生成 |
| `.ktx-ui/eval/runs.sqlite`（或 `LUCY_EVAL_DB`） | Eval run 历史 | 系统生成 |

### 1.5 WebUI 入口速查（5+1 侧栏地图）

本节是侧栏可见入口的镜像视图。
事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（v0.2 起由 `webui/src/app/navigation.ts` 导出）。
`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档（含旧路径），不与代码并列称为权威源。
架构调整时，请先改 `webui/src/app/navigation.ts`，再同步 §1.5 表格，最后开 follow-up 工单修 06 spec §3 / §4。

| 分组 | 二级菜单 | 路径 | 一句话用途 |
| --- | --- | --- | --- |
| 系统概览 | 系统概览 | `/overview` | 聚合 Lucy `MCP`、`KTX` `Runtime`、语义资产与 `Agent` 接入的当前健康状态；「待处理事项」统计口径见 [系统概览待处理事项](#系统概览待处理事项) |
| 数据接入 | 连接概览 | `/connections` | 查看每个连接的 `Schema`、`YAML` 资产与本地目录刷新状态 |
| 数据接入 | 启用表范围 | `/connections/enabled-tables` | 维护进入语义层的表范围，保存后写入 `ktx.yaml` 的 `enabled_tables` 字段 |
| 语义建模 | 语义资产 | `/catalog` | 维护当前 `KTX` 项目的结构化 semantic-layer `YAML` 模型，按搜索 / 连接 / `Schema` / 语义状态定位对象 |
| 语义建模 | 业务 Wiki | `/wiki` | 管理业务口径、指标说明和分析 Playbook 的 Markdown 文档 |
| 语义发布 | 发布工作台 | `/publish/workbench` | 查看并发布当前待生效的语义资产；发布后自动重建 `KTX` 索引 |
| 语义发布 | 发布记录 | `/publish/history` | 查看历史发布批次、Reindex 执行结果及当前版本快照 |
| 质量评测 | 评测用例 | `/eval/cases` | 管理各 domain 的 `Eval` case 定义（`YAML` 源文件） |
| 质量评测 | 运行历史 | `/eval/runs` | 查看评测运行历史与单次运行的详情 |
| 质量评测 | 趋势监控 | `/eval/monitor` | 查看 `Eval` 质量趋势、失败集中度与 drift 分布 |
| 质量评测 | 安全候选 | `/eval/security-candidates` | 审阅安全评测候选与风险样本 |
| 访问治理 | 使用概况 | `/admin/usage` | 查看 Agent、Token 和表的访问使用情况与调用量 |
| 访问治理 | Agent | `/admin/agents` | 配置每个 `Agent` 实例能用哪些 `MCP` 工具和访问哪些表 |
| 访问治理 | 角色权限 | `/admin/roles` | 管理 `access.yaml` 中的 `Role` 模板：新建 / 编辑 / 删除 / 复制 |
| 访问治理 | 访问日志 | `/admin/audit` | 查看 `MCP` Proxy 记录的工具调用，可按用户 / 工具 / 状态过滤 |
| 访问治理 | MCP 调试台 | `/admin/mcp-playground` | 预览 Agent 的 MCP 工具 ACL 裁决，并可做受控 `tools/list` 试调 |
| 访问治理 | 配置审计 | `/admin/config-audit` | 查看访问配置写入历史；多管理员模式下 actor 为登录管理员 id |
| 访问治理 | 登录账户 | `/admin/admins` | 管理 WebUI 登录账户（所有者 / 运维）；丢密码见 break-glass |

> 事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（`webui/src/app/navigation.ts` 导出）；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档。

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
cd <PROJECT_ROOT>

# 1. 启动 KTX MCP daemon，供 Lucy Proxy 转发
ktx mcp start --project-dir <PROJECT_ROOT>

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
| `http://127.0.0.1:7879/mcp` | 本地开发 MCP fallback；客户部署以 `LUCY_PUBLIC_MCP_URL` / WebUI 展示值为准 |

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
    password: <file:<PROJECT_ROOT>/.ktx/secrets/mysql-aliyun-password>
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

#### 系统概览待处理事项

入口：`/overview`（兼容路由 `/onboarding`）。

「待处理事项」是首页聚合的跨模块运维队列，由前端根据多个只读接口的计数本地拼装；**计数为 0 的项不展示**。上线检查 readiness 与本队列不是同一套规则。

| 条目 | 计数来源 | 口径说明 |
| --- | --- | --- |
| N 张表待补语义 | `GET /api/sources`（`enabled === true`） | **已启用 ∩ `Manifest`** 中 `completion !== done` 的表数。按**表**计数；未启用 `Manifest` 表不计入。 |
| N 个 Catalog 对象待处理 | 同上 | **当前实现与「待补语义」使用同一公式**（已启用集上的 `total − done`）；文案写 Catalog 同步不完整，但数字并非独立 Catalog 同步指标。 |
| 存在 N 个待发布文件 | `GET /api/diff` | 返回的可审阅变更文件数（`files.length`）。 |
| 近 30 天无评测数据 | `GET /api/eval/runs?limit=1` | 仅在接口成功且确认 **0 条**评测运行记录时出现。探测实现是「是否已有至少 1 条 run」，**未按 30 天时间窗过滤**；加载中或接口失败时不展示该项。 |

近 7 天 ACL 拒绝（各 `Agent` 的 `stats.deniedLast7d` 求和）只在「访问风险」指标卡展示，**不进入**「待处理事项」——滚动窗口无法通过「查看访问日志」闭环消除。

一张表何时算 `done`（`webui/server/completion.ts`）：

1. 有表描述（`descriptions.human` 或 `descriptions.ai`）
2. 有 `grain`
3. 至少一列标记主键（`pk: true`）
4. 全部非 `hidden` 列都有描述
5. 至少一个 `measure`

缺任一项则为 `partial` 或 `not_started`，都计入「待补语义」。补语义入口见 [3.3 语义层维护](#33-语义层维护)；发布入口见 `/publish/workbench`。

### 3.2 数据库接入

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 连接概览 | `/connections` | 查看 connection、schema、enabled table、KTX 可用性、MCP endpoint |
| 表白名单 | `/connections/whitelist` | 维护 `ktx.yaml` 的 `enabled_tables` |
| 连通测试 | `/connections/test` | 调用 `ktx connection test <connId>` |

> WebUI 不负责新建物理数据库连接。新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。
> WebUI 管理的是已声明连接：查看连接状态、测试连接、添加 Schema、维护表白名单、上传 YAML 资产、刷新本地目录。

| 问题 | 手册应回答 |
| --- | --- |
| 我在哪里新建连接？ | 编辑 `ktx.yaml`，不是 WebUI |
| 密码放哪里？ | `file:` / `env:` / Docker secrets，不写 inline 明文 |
| WebUI 能做什么？ | 管理已声明连接 |
| 新连接什么时候对 Agent 可见？ | `ktx.yaml`、manifest / overlay、`enabled_tables`、`access.yaml` 均就绪后 |

| 工作 | 操作入口 |
| --- | --- |
| 新增物理数据库连接 | `ktx.yaml` + secret 文件 |
| 修改连接 host / port / username / password | `ktx.yaml` + secret 文件 |
| 给已有连接添加 Schema | WebUI `/connections` 或受控 API |
| 测试连接 | WebUI 或 `ktx connection test` |
| 维护表白名单 | WebUI `/connections/whitelist` |
| 让 Agent 可见 | `webui/config/access.yaml` role / ACL |

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

#### 刷新本地目录

`刷新本地目录` 是数据库接入模块的 Catalog Reload 动作，只重新读取本地 `ktx.yaml` 与 `semantic-layer/**` YAML，不连接物理数据库，不执行 `ktx ingest`，也不会触发 AI enrichment。

入口地址：

```text
/connections
```

深链地址：

```text
/help?section=catalog-reload
```

刷新后的“本地目录”不是一个独立页面。它是 WebUI 从本地文件读出的资产视图，按查看目的分布在不同入口：

- 看刷新是否成功：打开 `/connections`，在对应 connection 卡片内查看 `本地目录已刷新`、表数量、warning 数量和缺失 Manifest 诊断。
- 看哪些表可被纳入启用表范围：打开 `/connections/enabled-tables`。这里展示的是本地 manifest 中已经存在、可写入 `ktx.yaml enabled_tables` 的表。
- 看哪些表已经进入语义层维护：打开 WebUI 首页 `/`。这里展示的是已被系统读入并可维护描述、指标、分群、joins 的 semantic table。
- 看底层 YAML 文件：在仓库中查看 `semantic-layer/<conn>/_schema/<schema>.yaml`（manifest）和 `semantic-layer/<conn>/<source>.yaml`（overlay）。
- 看最近 reload 历史：调用 `GET /api/catalog/reloads`，或查看系统生成文件 `.ktx-ui/catalog-reloads.json`。当前 WebUI 暂无独立的“本地目录历史”页面。

自检顺序：

1. 在 `/connections` 点击 `刷新本地目录`，先看当前 connection 卡片是否出现成功状态和 warning。
2. 如果提示缺失 Manifest，先补齐或上传 `semantic-layer/<conn>/_schema/<schema>.yaml`，再重新刷新。
3. 如果刷新成功但启用表范围中没有目标表，检查目标表是否已经存在于本地 manifest。
4. 如果 WebUI 能看到 YAML 改动，但 Agent / MCP 搜索不到，运行 `ktx admin reindex` 重建 KTX 检索索引；Reload Catalog 只更新 WebUI 对本地 YAML 的读取状态，不等同于 KTX reindex。

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

#### 连接概览指标说明

`/connections` 顶部 KPI 与 Schema 表列头描述的是同一组本地 Catalog 指标，不是远端物理库的实时扫描结果。

深链地址：

```text
/help?section=connection-overview-metrics
```

| UI 文案 | 含义 | 来源 |
| --- | --- | --- |
| 已发现表数 / 服务器目录已发现表 | 本地 Schema Manifest 已读入 Catalog 的表数量 | `semantic-layer/<conn>/_schema/<schema>.yaml` |
| 已启用表数 | 已纳入启用表范围、可进入语义层的表数量 | `ktx.yaml` 的 `enabled_tables` |
| 未启用表 | 已发现但尚未写入 `enabled_tables` 的表；缺 Manifest 的未知表不计入 | 已发现 − 已启用 |

对照与排障：

- 「已发现表数」为 0、但「已启用表数」> 0：通常表示 `enabled_tables` 已配置，但本地 Schema Manifest 尚未读到这些表；先补 Manifest，再点 `刷新本地目录`。
- 需要看物理库里实际有哪些表时，使用连接卡上的库内目录能力（若已启用），不要把「已发现表数」当成库内表数。
- 维护启用范围请打开 `/connections/enabled-tables`。

#### WebUI 与 ktx.yaml 的职责边界

> WebUI 是已声明连接的管理界面，不承担物理数据库连接的创建与凭据管理。物理连接的事实源是 `ktx.yaml`，凭据的事实源是 `.ktx/secrets/`、环境变量或 Docker secrets。

| 角色 | 负责的事 | 不负责的事 |
| --- | --- | --- |
| WebUI | 查看 connection、连通测试、添加 Schema、维护 `enabled_tables`、上传 YAML 资产、刷新本地目录、显示 secret 路径来源 | 写入 host / port / user / password；读取 `password: file:` 指向的密钥内容；直接连接物理数据库做扫描 |
| `ktx.yaml` + secret | 声明物理连接的 driver、host、port、username、password、schemas、`enabled_tables` | Agent 鉴权；role / ACL 治理 |
| `webui/config/access.yaml` | 定义 role、Agent、token hash、ACL（连接、表白名单、工具） | 物理连接配置；MCP upstream 行为 |

常见误判：

| 误判 | 正确做法 |
| --- | --- |
| WebUI 上没有"新建连接"按钮是 bug | 这是安全边界；新增连接必须改 `ktx.yaml` + secret |
| 在 `access.yaml` 改 password 即可改连接凭据 | `access.yaml` 不存凭据；改密码必须改 secret 文件并 reload |
| `ktx.yaml` 配了连接，Agent 立即可见 | 还需 manifest、`enabled_tables`、`access.yaml` 三件套就绪 |
| 物理表加好就等于 Agent 能查 | 还要在 `access.yaml` 把表加进 role 的 `tableSelectors` |

#### 连接形态与配置字段

新增连接前先确定目标形态。`ktx.yaml` 里的 connection 字段是通用的，按 driver 决定默认值；Doris / StarRocks 等 MySQL wire protocol OLAP 源需显式声明 `engine` 和 `wire_protocol`。

通用字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `driver` | 是 | KTX driver，例如 `mysql`、`postgres` |
| `engine` | 视情况 | 数据库引擎标识，例如 `doris`、`starrocks`；原生 MySQL 可省略 |
| `wire_protocol` | 视情况 | Doris / StarRocks 等使用 MySQL wire protocol 的 OLAP 源应显式写出 |
| `readonly` | 建议 | 运维意图标记；真实只读必须由数据库账号权限保证 |
| `r1_target` | 视情况 | 仅 R1 受控目标源需要显式设置 |
| `enabled_tables` | 是 | 允许进入语义层 / Agent 暴露基础范围的表 |
| `host` | 是 | 数据库 host，不在公开文档泄露真实值 |
| `port` | 是 | 数据库端口 |
| `database` | 是 | 默认 database / catalog，具体语义以 driver 为准 |
| `username` | 是 | 只读账号 |
| `password` | 是 | 使用 `file:` 或 `env:`，禁止明文 |
| `schemas` | 是 | 已纳入治理的 Schema 列表 |

连接形态矩阵：

| 连接形态 | 推荐配置形态 | 说明 |
| --- | --- | --- |
| MySQL | `driver: mysql`，默认端口 `3306` | 原生 MySQL；`engine` 通常可省略 |
| PostgreSQL | `driver: postgres`，默认端口 `5432` | Schema 语义按 PostgreSQL 处理 |
| Doris | `driver: mysql`、`engine: doris`、`wire_protocol: mysql` | MySQL wire protocol OLAP 源；R1 目标源需 `readonly: true`、`r1_target: true` |
| StarRocks | `driver: mysql`、`engine: starrocks`、`wire_protocol: mysql` | MySQL wire protocol OLAP 源；当前仍是 gated support，需证据后才能写 release-verified |

通用模板（本地开发路径）：

```yaml
connections:
  <connection-id>:
    driver: <mysql|postgres>
    engine: <optional-engine>
    wire_protocol: <optional-wire-protocol>
    readonly: true
    enabled_tables:
      - <schema>.<table_or_view>
    host: <DB_HOST>
    port: <DB_PORT>
    database: <DATABASE>
    username: <READONLY_USERNAME>
    password: file:<PROJECT_ROOT>/.ktx/secrets/<connection-id>-password
    schemas:
      - <schema>

setup:
  database_connection_ids:
    - <connection-id>
```

通用模板（Docker / customer-config 路径，容器内路径）：

```yaml
password: file:/data/lucy/.ktx/secrets/<connection-id>-password
```

凭据保护要求：

| 路径形态 | 示例 | 适用场景 |
| --- | --- | --- |
| `file:<absolute-path>` | `file:<PROJECT_ROOT>/.ktx/secrets/<connection-id>-password` | 本地开发、CI 沙盒 |
| `file:/data/lucy/...` | `file:/data/lucy/.ktx/secrets/<connection-id>-password` | Docker 容器内 |
| `env:<NAME>` | `env:LUCY_DB_PASSWORD_<CONNECTION_ID>` | 12-factor / Kubernetes secret |
| inline 明文 | 禁止 | 任何环境都不允许 |

#### 新增数据库连接（运维 Runbook）

按以下顺序操作，前后步骤不可调换。流程目标是：先把"事实源 + 凭据 + 索引 + ACL"全部就绪，再让 Agent 接入。

1. 收集连接信息：确认目标数据库类型、host、port、database / catalog、schemas、目标表清单。
2. 创建只读账号：生产库必须使用真只读账号；`SELECT` 权限只授予目标 schema / 表。
3. 创建 secret 文件或环境变量：见下方"本地开发路径"或"Docker / customer-config 路径"。
4. 编辑 `ktx.yaml`：使用通用模板填入 connection 块（见 3.2.2）。
5. 测试连接：`ktx connection test <connection-id>`。
6. 生成或导入 manifest：运行 `ktx ingest <connection-id>` 前，必须确认当前 `scan.enrichment`、LLM 和 embedding 配置涉及的外部数据流已获得客户 / 数据 Owner 授权；未授权时改用受控 Manifest 上传，或在获批的无 enrichment 扫描路径下生成 manifest。产物落在 `semantic-layer/<conn>/_schema/<schema>.yaml`。
7. 维护 `enabled_tables`：把允许的物理表写入 `ktx.yaml`，确保已在 manifest 中。
8. 重建索引：`ktx admin reindex --force`，让 KTX MCP 检索读到新连接与新表。
9. 同步 `webui/config/access.yaml`：在对应 role 的 `allow.connections` / `tableSelectors` / `tools` 中加入新连接与目标表。
10. 验收：WebUI `/connections` 看到新连接；`/admin/audit` 能看到 MCP smoke 的 allow / deny；用真实 Agent token 跑最小 smoke。

本地开发路径（仓库根即项目根）：

```bash
cd <PROJECT_ROOT>
mkdir -p .ktx/secrets
printf '%s' '<DB_PASSWORD>' > .ktx/secrets/<connection-id>-password
chmod 600 .ktx/secrets/<connection-id>-password

# 验证连通
ktx --project-dir <PROJECT_ROOT> connection test <connection-id>

# 生成 manifest 前，先确认 scan.enrichment / LLM / embedding 外部数据流已获授权。
# 未授权时不要执行 ingest，改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
ktx --project-dir <PROJECT_ROOT> ingest <connection-id>

# 重建索引
ktx --project-dir <PROJECT_ROOT> admin reindex --force

# 验证目标 source
ktx --project-dir <PROJECT_ROOT> sl validate <source-name> --connection-id <connection-id>
```

Docker / customer-config 路径（容器内项目根为 `/data/lucy`）：

```bash
# 在容器内准备 secret 目录
docker compose exec lucy mkdir -p /data/lucy/.ktx/secrets

# 从宿主机把密钥文件灌进容器
docker compose exec -T lucy sh -c 'cat > /data/lucy/.ktx/secrets/<connection-id>-password' \
  < ./<connection-id>-password

# 收紧权限 + 重启服务
docker compose exec lucy chmod 600 /data/lucy/.ktx/secrets/<connection-id>-password
docker compose restart lucy

# 容器内跑通验证
docker compose exec lucy ktx --project-dir /data/lucy connection test <connection-id>

# 生成 manifest 前，先确认 scan.enrichment / LLM / embedding 外部数据流已获授权。
# 未授权时不要执行 ingest，改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
docker compose exec lucy ktx --project-dir /data/lucy ingest <connection-id>

docker compose exec lucy ktx --project-dir /data/lucy admin reindex --force
docker compose exec lucy ktx --project-dir /data/lucy sl validate <source-name> --connection-id <connection-id>
```

如果是 bind mount 部署，宿主机的 `customer-config/` 通常映射为：

```text
customer-config/ktx.yaml             -> /data/lucy/ktx.yaml
customer-config/.ktx/secrets/        -> /data/lucy/.ktx/secrets/
```

WebUI 验收：

| 页面 | 验收点 |
| --- | --- |
| `/connections` | 新连接可见，driver / engine / Schema / enabled table 数量正确 |
| `/connections/test` 或连接卡片 | 连通测试成功；失败时展示可诊断原因 |
| `/connections/whitelist` | 只出现本地 manifest 中可选表；白名单与 `enabled_tables` 对齐 |
| `/admin/roles` 或 `access.yaml` | role 已授权新连接和目标表 |
| `/admin/audit` | MCP smoke 的 allow / deny 记录可追溯 |

> WebUI 的"刷新本地目录"只重新读取 `ktx.yaml` 与 `semantic-layer/**` YAML。它不会连接物理数据库扫描新表，也不会替代 `ktx ingest` 或受控 manifest 上传。
> 物理库扫描、列变更、Doris / StarRocks 形态识别都靠 `ktx ingest` 或受控 Manifest 上传；新增连接、换驱动、加表后必须在授权数据流下重跑 `ktx ingest` + `ktx admin reindex --force`，或先上传 Manifest 再 reindex，然后回 WebUI 点"刷新本地目录"。

#### Agent 可见性与 ACL 同步

新增连接后，Agent 是否可见由两层配置共同决定，缺一不可：

| 层 | 配置文件 | 控制内容 |
| --- | --- | --- |
| 连接层 | `ktx.yaml` | connection、Schema、`enabled_tables`、secret 路径 |
| 治理层 | `webui/config/access.yaml` | role 的 `allow.connections`、`tableSelectors`、`tools` |

通用 role 片段（脱敏占位符）：

```yaml
roles:
  <role-id>:
    description: <role-description>
    allow:
      connections:
        - <connection-id>
      tableSelectors:
        - connection: <connection-id>
          schema: <schema>
          names:
            - <table_or_view>
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
```

新增连接后必须做的同步动作：

| 动作 | 入口 | 落点 |
| --- | --- | --- |
| 在 `access.yaml` 把新连接加进 role | 编辑 YAML 或 WebUI `/admin/roles` | `roles.<role>.allow.connections` |
| 在 `access.yaml` 把新表白名单加进 role | 编辑 YAML 或 WebUI `/admin/roles` | `roles.<role>.allow.tableSelectors` |
| 确认 role 的 `tools` 列表仍含 `lucy_*` 工具 | 编辑 YAML 或 WebUI `/admin/roles` | `roles.<role>.allow.tools` |
| Proxy / MCP 重新加载配置 | 改完保存即生效；如未生效，重启 Proxy | 同进程 Fastify / 容器重启 |
| 跑最小 smoke | `lucy_catalog` + 一条只读 query | 写到 `LUCY_AUDIT_DB` |

常见失败原因（与 `/admin/audit` 决策 reason 对应）：

| 症状 | 首查位置 | 处理 |
| --- | --- | --- |
| WebUI 看不到新连接 | `ktx.yaml`、环境变量 `KTX_PROJECT_ROOT`、容器挂载路径 | 确认运行时实际加载的配置根 |
| 连通测试失败 | host / port / 网络 / 只读账号 / secret 文件路径 | 容器内跑 `ktx connection test`；不要只在宿主机验证 |
| 提示缺失 Manifest | `semantic-layer/<conn>/_schema/<schema>.yaml` | 跑 `ktx ingest` 或上传受控 manifest，再刷新本地目录 |
| 白名单表不可选 | manifest 未包含目标表 | 检查 manifest 内容和 `enabled_tables` 拼写 |
| Agent 看不到新连接 | `webui/config/access.yaml` role | 同步 `connections` 与 `tableSelectors`；等待缓存刷新或重启 Proxy |
| 查询被拒 | `/admin/audit` decision reason | 按下表 `reason` 分类处理 |

| decision_reason | 含义 | 处理 |
| --- | --- | --- |
| `unknown_or_forbidden_connection:<conn>` | connection 缺失或未授权 | 在 role 的 `allow.connections` 加上该 connection |
| `table_forbidden:<table>` | 请求表不在授权范围 | 在 role 的 `allow.tableSelectors` 加上该表 |
| `tool_forbidden` / `tool_forbidden_global` | role 未授权该工具，或命中全局 deny | 调整 `allow.tools` 或 `defaults.deny_tools` |
| `raw_query_forbidden` | `lucy_query` / `sl_query` 传入了原始 SQL | 改用 measure / dimension 形式；只在受控场景下用 `lucy_read_source` |

排障命令：

```bash
# 1. 看 access.yaml 是否包含新连接与表
rg -n "roles:|tableSelectors|tools|<connection-id>|<role-id>" webui/config/access.yaml

# 2. 看最近拒绝记录
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=20"

# 3. 看 connection 是否被加载
ktx --project-dir <PROJECT_ROOT> connection list
```

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
ktx --project-dir <PROJECT_ROOT> admin reindex
```

说明：编辑 YAML 后，`MCP` / `KTX` 检索通常读本地 SQLite 索引；需要让 Agent 搜到新口径时，执行 `ktx admin reindex`。

#### 为什么要编写语义 YAML

语义层 `YAML` 不是普通配置文件，而是团队与 `Agent` 共同遵守的**可执行分析契约**：

| 概念 | 含义 | 在 Lucy 中的落点 |
| --- | --- | --- |
| 上下文即代码 | `semantic-layer/` 与 `wiki/` 以 Git 可审阅的文件存在，可 diff、可合并 | `WebUI` 保存走 dryRun diff；`/review` 查看变更 |
| 可执行语义 | `Agent` 使用已批准的 `measures`、`joins`、`segments`，而不是每次从零拼 `SQL` | `lucy_query` / `sl_query` 编译语义查询 |
| 扫描起草、人工精修 | `KTX` ingest 生成 manifest 初稿；业务口径由人在 overlay 与 Wiki 中补齐 | manifest 在 `_schema/`；`grain` / `measures` 等在 overlay |

你编写的每一块语义，最终都会进入编译器：声明 `grain` 与 `join relationship` 错误，会导致 measure 重复计数或查询被拒；只写 `description` 而不写清口径边界，`Agent` 仍可能搜不到或选错 measure。

overlay 各块在运行时的用途：

| `YAML` 块 | `Agent` 运行时用途 |
| --- | --- |
| `grain` | 定义行粒度，防止聚合时重复计数 |
| `measures` | 预定义指标，可直接在语义查询中引用 |
| `segments` | 可复用的筛选片段 |
| `joins` + `relationship` | 编译器选择 join 路径与安全方向 |
| Wiki + `sl_refs` | 口径说明、同义词、例外规则（编译时不读，但 `Agent` 检索时会读） |

#### 推荐编写工作流

大多数语义改动按以下顺序进行（先小改、先验证、再发布）：

1. **发现已有上下文**

   ```bash
   ktx sl --json
   ktx sl "<业务关键词>" --json
   ktx wiki "<口径关键词>" --json --limit 10
   ```

2. **改最小相关文件**——已有 manifest source 补指标走 overlay `semantic-layer/<conn>/<source>.yaml`；口径说明走 `wiki/`。不要一次 diff 里混多个 unrelated 概念。

3. **校验 overlay**

   ```bash
   ktx sl validate <source> --connection-id <conn>
   ```

4. **编译代表性查询**（在执行前先看生成 `SQL`）

   ```bash
   ktx sl query \
     --connection-id <conn> \
     --measure <source>.<measure> \
     --dimension <source>.<time_column> \
     --format sql
   ```

5. **确认可发现性**——用用户可能问的业务措辞再搜一次；必要时补 Wiki `summary` / `tags` 与 measure `description`。

6. **发布与索引**——`WebUI` 发布工作台发布语义资产，或执行 `ktx admin reindex`；用 `sl read` 确认 overlay 已合并。

修复已有口径时，额外建议：

```bash
git diff -- semantic-layer wiki
ktx sl validate <source> --connection-id <conn>
ktx sl query --connection-id <conn> --measure <source>.<measure> --format sql
```

#### grain、join 与 fanout

`KTX` 语义层是编译器：`Agent` 声明要什么 measure / dimension / filter；编译器根据 `YAML` 中的 join 图与 `grain` 生成 `SQL`。因此 **grain 与 relationship 不是可选装饰**，而是防重复计数的硬约束。

| `relationship` | 规划影响 | 典型用法 |
| --- | --- | --- |
| `many_to_one` | 向维度方向扩展行数时通常安全 | 订单 → 客户、订单 → 商品 |
| `one_to_many` | 会放大行数，易触发 fanout | 订单 → 订单明细 |
| `one_to_one` | 键匹配时双向通常安全 | 用户 ↔ 用户档案 |

**fanout（扇出）**：两张事实表通过同一维度 join 时，若先 join 再聚合，一侧事实表的每一行会被另一侧匹配行数放大，measure 会静默翻倍。编译器检测到多 source 的 raw measure 时，会改为「各事实表先按自身 grain 预聚合，再回连维度」——overlay 里缺少正确 `grain` / `relationship` 时，编译结果会与手写 `SQL` 直觉不一致。

```yaml
# ❌ 风险：订单与退款都贡献 measure，但未声明 grain / relationship
measures:
  - name: revenue
    expr: sum(amount)

# ✅ 更好：显式 grain；join 写清 relationship
grain:
  - order_id
joins:
  - to: customers
    on: orders.customer_id = customers.customer_id
    relationship: many_to_one
measures:
  - name: revenue
    expr: sum(case when status != 'refunded' then amount end)
    description: 已完成订单的销售额，不含已退款订单。
```

好 measure 的写法：

- 名称贴近业务用语，但避免同义词堆砌；同义词放 Wiki `tags`。
- `description` 写清包含 / 排除边界（例如「不含退款」「按完成日而非下单日」）。
- 需要行级过滤时用 measure 级 `filter`，不要把本该属于 segment 的逻辑散落到多个 measure。

#### overlay 常见字段速查

overlay 在 manifest 之上增量声明业务语义。完整字段表见 [3.7.0 overlay 字段速查（编写辅导）](#370-overlay-字段速查编写辅导) 与 [KTX Writing Context](https://docs.kaelio.com/ktx/docs/guides/writing-context)。

| 组件 | 常用字段 | 说明 |
| --- | --- | --- |
| 列 | `visibility: public / internal / hidden` | `hidden` 列不参与 `Agent` 列表 |
| measure | `filter` | 仅作用于该 measure 的 `SQL` 谓词 |
| join | `alias` | 重复 join 同一目标时区分别名 |
| 派生列 | `columns[].expr` | 必须有 `expr`；不要与 manifest 物理列重名 |

Lucy 与上游 `KTX` 文档的一个关键差异：人工描述写入 `descriptions.human`（不是 `descriptions.user`）；物理列用复数 `descriptions:`，measure / segment 用单数 `description:`。

#### KTX 官方延伸阅读

本节只链外部权威文档，避免与 `KTX` 官方文档双维护。架构与字段细节以官方为准；Lucy 特有的 manifest / overlay 边界仍以本节与 [3.7 YAML 文件规范与交付验收](#37-yaml-文件规范与交付验收) 为准。

| 主题 | 建议阅读 | 官方 URL |
| --- | --- | --- |
| 产品定位与双面向架构 | Introduction | https://docs.kaelio.com/ktx/docs/getting-started/introduction |
| 首次安装与 ingest | Quickstart | https://docs.kaelio.com/ktx/docs/getting-started/quickstart |
| 语义 source 与 Wiki 编写 | Writing Context | https://docs.kaelio.com/ktx/docs/guides/writing-context |
| 编译器、join 图与 fanout | Semantic Layer Internals | https://docs.kaelio.com/ktx/docs/concepts/semantic-layer-internals |
| `ktx.yaml` 项目配置 | ktx.yaml reference | https://docs.kaelio.com/ktx/docs/configuration/ktx-yaml |
| `ktx sl` / `validate` / `query` | CLI Reference | https://docs.kaelio.com/ktx/docs/cli-reference |

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
| MCP 调试台 | `/admin/mcp-playground` | ACL 裁决预览与受控 `tools/list` 试调 |
| 数据源热力 | `/admin/audit-sources` | 查看 source/table 调用和拒绝分布 |
| 配置变更 | `/admin/config-audit` | 查看 `access.yaml`、`ktx.yaml`、`admins.yaml` 等配置变更 |
| 管理员 | `/admin/admins` | WebUI 登录账户（所有者 / 运维）；仅所有者可增删账户 |

权威配置：

| 文件 | 用途 |
| --- | --- |
| `webui/config/access.yaml` | Agent / Role / MCP `Token` ACL（数据面） |
| `webui/config/admins.yaml` | WebUI 登录账户（控制面；scrypt 密码哈希；无明文） |

#### WebUI 管理员登录

Lucy 是自托管控制面：管理面登录与 SaaS「邮箱注册 / 邮箱找回」不同。控制面账户只有两级（与 MCP Agent Role 无关）：

| 角色 id | UI 主术语 | 日常职责 | 不能做 |
| --- | --- | --- | --- |
| `owner` | 所有者 | 全部 WebUI 日常工作 + **登录账户治理**（增删改其他登录账户、指定所有者） | — |
| `operator` | 运维 | 连接、语义 / Wiki / 发布、Eval、Agent / Role / Token、访问日志与配置审计 | 管理其他 WebUI 登录账户 |

权限矩阵（控制面）：

| 能力 | 所有者 | 运维 |
| --- | --- | --- |
| 数据库连接 / 启用表 / ingest | ✓ | ✓ |
| 语义层 / Wiki / 发布工作台 | ✓ | ✓ |
| Eval case / run / monitor | ✓ | ✓ |
| Agent、Role（`access.yaml`）、Token 发行与撤销 | ✓ | ✓ |
| 访问日志 / 配置审计 / MCP 调试台 | ✓ | ✓ |
| `/admin/admins` 登录账户增删改 | ✓ | ✗ |

说明：运维即可完成「连接、配置语义、Eval、添加和管理 Agent Role」等日常工作；所有者额外负责控制面账户与 break-glass 相关治理。旧配置里的 `role: admin` 读入时等价于 `operator`。

| 模式 | 条件 | 行为 |
| --- | --- | --- |
| 开放（`open`） | 无启用中的登录账户，且未设 `LUCY_WEBUI_AUTH=required` | 不强制登录；配置审计 actor 为「本机管理员」 |
| 引导（`bootstrap`） | 无启用中的登录账户，且 `LUCY_WEBUI_AUTH=required` | 打开 `/login` 创建首个**所有者** |
| 需登录（`required`） | 至少一名启用登录账户 | 除公开路由外需有效会话 Cookie |

推荐正式部署：

1. 设置 `LUCY_WEBUI_AUTH=required`（可选同时设置 `LUCY_WEBUI_SESSION_SECRET`）。
2. 打开 `/login`，创建首个所有者（账户 id + 密码，至少 10 字符）。
3. 在「登录账户」页添加运维账户（默认角色为运维）；按需再添加备用所有者。

密码只存 `password_hash`（`scrypt:<salt>:<hash>`），**不能从配置反推明文**，也**没有邮箱找回**。

#### 丢失管理员账号或密码时如何恢复（break-glass）

适用：全部 WebUI 管理员凭据丢失、或只剩无法登录的账户。这是**运维 break-glass**，依赖能读写部署配置卷 / 主机的人；完成后应记入变更审计。

**优先路径 A — 仍有可登录的所有者**

1. 用其他所有者登录 WebUI。
2. 打开 `/admin/admins`，为遗忘账户重置密码，或禁用后新建。
3. 确认配置审计里出现 `admin_patch` / `admin_create` 记录。

**路径 B — 无人可登录（配置卷恢复）**

1. 在部署机上备份当前文件：
   ```bash
   cp webui/config/admins.yaml webui/config/admins.yaml.bak.$(date +%Y%m%d%H%M%S)
   ```
2. 清空启用中的管理员。任选其一：
   - 将 `admins:` 改为空列表：
     ```yaml
     version: "1"
     admins: []
     ```
   - 或临时移走 / 删除 `webui/config/admins.yaml`（进程会按空配置处理）。
3. 确认 `LUCY_WEBUI_AUTH=required`（正式环境建议保持），重启 WebUI 进程 / Pod。
4. 打开 `/login`，重新 **创建首个所有者**（bootstrap）。
5. 立即再创建至少一名备用所有者；轮换相关会话（可选：删除 `.ktx-ui/webui-session-secret` 使旧 Cookie 失效，需同步重启）。
6. 在工单 / 变更记录中写明：操作人、时间、备份路径、新所有者 id（**不要**写密码）。

**不要做的事**

| 错误做法 | 原因 |
| --- | --- |
| 期待邮箱验证码 / 「忘记密码」链接 | 产品不提供；自托管默认无出网 SMTP 契约 |
| 手改 `password_hash` 为明文 | 校验只认 `scrypt:…`；明文无效 |
| 把 `LUCY_WEBUI_AUTH=off` 当作长期方案 | 仅调试；会重新开放匿名管理面 |
| 与 MCP Agent `Token` 混用 | Agent `Token` 不能登录 WebUI；WebUI 会话不能当 MCP Bearer |

保护建议：限制谁能读写 `webui/config/admins.yaml` 与 customer-config 卷；break-glass 按双人 / 变更单执行。

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
| 过期 | `expires_at` 到期或不可解析时，`MCP` Proxy 鉴权失败（401）；也可在 Admin 提前撤销 |

注意：`expires_at` 由 Proxy 身份校验强制拒绝已过期 token。到期后仍建议在 Admin 执行撤销，或调用 `DELETE /api/admin/agents/:userId/tokens/:label`，避免配置残留。

权限裁决机制：

1. Bearer token 现场 `sha256`。
2. 与 `access.yaml` 中 token hash 匹配。
3. 检查 token 是否在 `revoked_tokens`。
4. 检查 `expires_at`（缺省则永不过期）。
5. 解析 user 的 role。
6. role 通过 `connections` + `tableSelectors` 解析成 effective sources/tables。
7. `tools/list` 只展示允许工具。
8. `tools/call` 再次做工具、连接、表、raw query、敏感 metadata、并发等裁决。
9. 允许/拒绝/错误全部写审计，包含 `decision_reason`。

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
| `token_expired` | token 已过期或 `expires_at` 不可解析 |

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

#### 审计热库与冷库（SQL 留存边界）

访问日志与 Trace / Evidence 采用**分层存储**。当前近线事实源是本地**热库**；长期**冷归档**是产品规划能力（对象存储，规划保留 180 天+）。深链：`/help?section=admin-audit-hot-cold-store`。

| | 热库（当前实现） | 冷库 / 冷归档（规划） |
| --- | --- | --- |
| 位置 | `.ktx-ui/audit.sqlite`（可用 `LUCY_AUDIT_DB` 覆盖） | 对象存储归档（S3 兼容），不是 Admin 默认即时查询源 |
| 用途 | `/admin/audit` 即时查询、Trace 钻取、拒绝原因复盘 | 长期留存、合规抽查、偶发深挖 |
| 查询体验 | 快，与 WebUI / Admin API 绑定 | 慢，按归档批次取回 |
| SQL 相关 | **允许**：`query_hash`、脱敏截断的 `query_preview`（字面量替换且长度截断）、结构摘要 / Trace metadata。**禁止**：完整 `SQL` / `SQL AST` 原文、完整结果行、Token 明文、数据库凭据、客户行级样本 | 若业务需要事后阅读完整 `SQL`，应走受控冷归档并对静态内容加密；**不是**热库默认行为 |

**为什么热库不明文存完整 SQL**

- `SQL` 常含业务过滤条件、客户标识、金额区间等敏感信息。
- 热库接触面大：本地 SQLite 文件、Admin API、备份与开发机拷贝都可能碰到。
- Admin UI 与发布就绪证据包同样不展示完整 `SQL` 原文。

**哈希 vs 加密（不要混用）**

| | 哈希（例如 `query_hash`） | 加密 |
| --- | --- | --- |
| 能否还原原文 | **不能**（单向） | **能**（持有正确密钥时可解密） |
| 典型用途 | 判断两次调用是否同一条 `SQL`、做去重与对照 | 冷归档需要事后阅读全文时的静态保护 |
| 丢了原文 / 密钥 | hash 仍在，但永远看不到 `SQL` 正文 | 密文仍在，没有密钥也解不开 |

因此：热库用 hash + 脱敏 preview，是「默认可验证同异、不可还原全文」；若未来冷库存完整 `SQL`，加密是为了「默认谁也读不了，只有授权流程能解密查看」，不是为了永久销毁可读性。

**与 Eval 的边界**

| 事实源 | 是否可存完整 SQL | 说明 |
| --- | --- | --- |
| `.ktx-ui/audit.sqlite`（审计热库） | 否 | 生产 MCP 调用的近线审计；安全候选抽取也只能基于脱敏摘要 |
| `.ktx-ui/eval/runs.sqlite`（Eval 运行库） | 是（runner 捕获时） | 与审计库隔离；供 `sql_assertions` 与失败分析 |
| `/eval/security-candidates` | 否（来自审计） | 从访问日志归一化而来，不含完整 `SQL` 原文 |

含义：业务 Eval **在线跑**可以验证生成 `SQL`；用生产 `/admin/audit` **反推**完整 `SQL` 结构会天然受限。这是安全边界，不是页面漏字段。

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
| 入库 | `.ktx-ui/eval/runs.sqlite` 或 `LUCY_EVAL_DB`（与审计热库隔离；runner 捕获到的 `SQL` 可写入 run case，供断言与失败分析。生产 `/admin/audit` 不存完整 `SQL`，见 [审计热库与冷库（SQL 留存边界）](#审计热库与冷库sql-留存边界)） |
| 产物 | run artifact 和 markdown summary |
| 分类 | `pass`、`logic_regression`、`tool_error`、`schema_drift`、`data_drift` |

### 3.7 YAML 文件规范与交付验收

本节为人工配置人员、运维人员、Claude Code / Codex 等 Agent 检查者提供统一可执行的 YAML 交付 runbook。事故教训：分析师上传的语义 YAML 文件结构不符合 KTX/Lucy 的 manifest / overlay 合并模型，会让 MCP 侧无法提供正确问答。**`reindex` 成功、单个 `sl validate` 成功都不能单独作为交付成功依据。**

编写动机、推荐工作流、grain / fanout 说明见 [为什么要编写语义 YAML](#为什么要编写语义-yaml)、[推荐编写工作流](#推荐编写工作流)、[grain、join 与 fanout](#grainjoin-与-fanout)；本节聚焦**交付分型与验收**。

#### 3.7.0 overlay 字段速查（编写辅导）

overlay 完整形态见 [KTX Writing Context](https://docs.kaelio.com/ktx/docs/guides/writing-context)。下表是 Lucy 客户交付中最常用的 overlay 字段；**默认 augmentation overlay 不写 `table:`**。

| 字段 / 组件 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 必须等于 manifest source name（文件名亦应一致） |
| `grain` | 是 | 唯一标识一行业务的列列表 |
| `measures[].name` | 是 | 业务指标名 |
| `measures[].expr` | 是 | 在 source grain 上的聚合表达式 |
| `measures[].filter` | 否 | 仅作用于该 measure 的行级谓词 |
| `measures[].description` | 强烈建议 | 单数 `description:`；写清口径边界 |
| `segments[].name` / `expr` | 否 | 可复用筛选；`expr` 为 `SQL` 谓词 |
| `joins[].to` / `on` / `relationship` | 否 | `relationship` 取 `many_to_one` / `one_to_many` / `one_to_one` |
| `joins[].alias` | 否 | 同一目标多次 join 时的查询别名 |
| `columns[].expr` | 派生列时必填 | 派生列定义；勿与 manifest 物理列重名 |
| `columns[].visibility` | 否 | `public` / `internal` / `hidden` |

Lucy 与上游 `KTX` 文档的差异（交付时勿混用）：

| 主题 | 上游 `KTX` 常见写法 | Lucy overlay / manifest |
| --- | --- | --- |
| 人工描述桶 | `descriptions.user` | `descriptions.human`（manifest 物理列） |
| 物理列描述 | `descriptions:`（复数） | 同左；禁止单数 `description:` |
| measure 描述 | `description:`（单数） | 同左 |
| overlay 默认形态 | 可独立 `table:` + `sql:` source | 已有 manifest 时默认**无** `table:` |
| Wiki `sl_refs` | 常为 source name 列表 | Lucy 用 `conn/schema/table` 路径 |

最小 overlay 示例（augmentation，非 new source）：

```yaml
name: <manifest_source_name>
grain:
  - <grain_column>
measures:
  - name: net_revenue
    expr: sum(amount - refund_amount)
    filter: status = 'completed'
    description: 已完成订单净收入，已扣退款，不含取消单。
segments:
  - name: high_value_orders
    expr: amount > 100
    description: 单笔金额超过 100 的订单。
```

#### 3.7.1 YAML 类型总览

Lucy 维护的 YAML 文件分 7 类。每一类都有明确的路径、维护者与是否适合手工上传的边界，分析师与 Agent 在准备交付包时必须先对齐类型。

| 类型 | 路径 | 用途 | 维护者 | 是否适合手工上传 |
| --- | --- | --- | --- | --- |
| KTX 项目配置 | `ktx.yaml` | 数据库连接、schema、`enabled_tables`、storage | 运维 / 管理员 | 谨慎，必须 dry-run diff |
| Schema manifest | `semantic-layer/<conn>/_schema/<schema>.yaml` | 物理表、物理列、nullable、数据库/AI/人工描述 | KTX 扫描或受控上传 | 可以，但必须是 manifest 形态 |
| Manifest augmentation overlay | `semantic-layer/<conn>/<source>.yaml` | 给已有 manifest source 补 grain、measures、segments、joins、派生列 | 分析师 / 语义 Owner | 可以，是客户业务语义高频交付形态 |
| New semantic source | `semantic-layer/<conn>/<source>.yaml` | 新建一个独立 semantic source | 高级用户 / 平台维护者 | 谨慎，必须同步 ACL 与问答口径 |
| Wiki frontmatter | `wiki/**/*.md` | 业务文档与语义对象引用 | 业务 / 数据维护者 | 可以，通过 Wiki 编辑器优先 |
| Eval cases | `evals/<domain>/eval/*-eval-cases.yaml` | 问答质量回归用例 | 测试 / 数据维护者 | 可以，但必须跑 Eval |
| Access config | `webui/config/access.yaml` | Role、Agent、Token hash、ACL | 管理员 | 谨慎，必须确认权限快照 |

通用上传安全规则：

| 规则 | 说明 |
| --- | --- |
| 禁止上传真实凭据 | 手册、示例、commit message 严禁出现真实 host、username、password、token、cookie；统一用 `<REDACTED>`、`<YOUR_HOST>`、`<YOUR_TOKEN>` |
| 走 `fs-safe` 白名单 | 任何 WebUI 写入都走 `webui/server/fs-safe.ts`；手工 `cat > ...` 也要保证目标在允许目录内 |
| 不要混目录 | manifest 文件只能在 `_schema/`，overlay 只能在 `semantic-layer/<conn>/`；不要把 overlay 写进 `_schema/`，也不要新建一个语义表目录 |
| 默认产物不写进 `webui/config/data-qa-instructions.md` | 数据问答运行时指导由 `webui/config/data-qa-instructions.md` 单独维护，与本节交付规则解耦 |
| 默认产物不写进 `CLAUDE.md` / `AGENTS.md` | 开发治理规则由 `AGENTS.md` 与 `docs/DEVELOPMENT.md` 承载，运行时数据问答规则由 Proxy initialize 注入 |

最小安全示例（使用脱敏占位符，不含真实凭据）：

```yaml
# ktx.yaml —— 项目级配置（脱敏示例，password 留空或指向 secret 文件）
project: <YOUR_PROJECT>
storage: .ktx

connections:
  <connection-id>:
    type: <DB_TYPE>
    dsn: <YOUR_DSN>      # 不要把密码写在 dsn 中
    # password 留空，使用 passwordSource: <env-var> 或 .ktx/secrets/ 注入
```

```yaml
# semantic-layer/<conn>/_schema/<schema>.yaml —— schema manifest
tables:
  <manifest_source_name>:
    table: <schema>.<physical_table>
    columns:
      - name: <column_name>
        type: <physical_type>
        nullable: <true|false>
        descriptions:
          db: <数据库侧字段说明>
          ai: <AI 推理时使用的字段说明>
          human: <人工补充的业务字段说明>
```

```yaml
# semantic-layer/<conn>/<source>.yaml —— augmentation overlay（默认无 table:）
name: <manifest_source_name>

grain:
  - <primary_time_column>

measures:
  - name: <measure_name>
    expr: <sql_expression>
    description: <measure 业务说明>

segments:
  - name: <segment_name>
    expr: <sql_filter_expression>
    description: <segment 业务说明>
```

```yaml
# semantic-layer/<conn>/<new_source>.yaml —— new semantic source（高级用法，必须补 ACL）
name: <new_source_name>           # ⚠ 与目标 manifest source name 不一致时属于新建 source
table: <schema>.<physical_table>  # ⚠ 显式声明 table: 会把语义推向"新建 source"
grain:
  - <primary_time_column>
measures:
  - name: <measure_name>
    expr: <sql_expression>
```

```yaml
# webui/config/access.yaml —— ACL 片段
roles:
  - id: <role_id>
    tableSelectors:
      - "<source_name>"            # 必须显式覆盖目标 source
    tools:
      allow: ["lucy_query", "lucy_read_source", "lucy_catalog"]
```

#### 3.7.2 Schema manifest 规范

目标路径：

```text
semantic-layer/<conn>/_schema/<schema>.yaml
```

manifest 是 KTX 扫描/受控上传生成的物理结构事实源。**不要**把它当作业务语义编辑面。

硬规则：

| 规则 | 结果 |
| --- | --- |
| 顶层必须是 `tables:` mapping | 否则不是合法 manifest |
| 物理列使用复数 `descriptions:` | 物理列使用单数 `description:` 是高风险错误（见 3.7.7） |
| 物理列 type 必须来自 KTX 扫描 | 手工伪造 type 会导致查询侧类型推导错误 |
| 派生列不应写进 manifest | 派生 `expr` 列属于 overlay（3.7.3） |
| 物理列结构变化重新扫描 | 不要手改物理列结构来"绕过"扫描；改完仍要走 Reload Catalog |

最小骨架：

```yaml
tables:
  <manifest_source_name>:
    table: <schema>.<physical_table>
    columns:
      - name: <column_name>
        type: <physical_type>
        nullable: <true|false>
        descriptions:
          db: <数据库侧字段说明>
          human: <人工补充说明>
```

#### 3.7.3 Manifest augmentation overlay 规范

这是客户业务语义最常见、也最容易出错的形态。**默认客户交付场景下，分析师补指标都属于这一类。**

目标路径：

```text
semantic-layer/<conn>/<manifest_source_name>.yaml
```

硬规则：

| 规则 | 说明 |
| --- | --- |
| 文件名必须等于 manifest source name | 文件名 = `ai_metric_international_country_daily.yaml`，对应 manifest 里的 `ai_metric_international_country_daily` |
| 顶层 `name` 必须等于 manifest source name | 错位会让 overlay 指向不存在的 source 或意外新增 source |
| 默认不写 `table:` | 已有 source 不需要再声明物理表；写 `table:` 会把语义推向"新建 source" |
| 默认不重复声明物理 `columns:` | 物理列已来自 manifest；重复声明会引入字段缺失或 unknown column |
| 派生列写在 `columns[].expr` | 派生列必须有 `expr`，且不能与 manifest 物理列重名 |
| 描述用单数 `description:` | `measures[].description` 与 `segments[].description` 合法 |
| join 引用列来自 manifest 或派生列 | measure / segment / join 表达式必须可解析到已知列 |

Bad vs Good 对比：

```yaml
# ❌ Bad —— 名为 overlay，实际是新建 source
name: international_country_metrics                # 与 manifest source name 不一致
table: chatbi.ai_metric_international_country_daily  # 显式 table: 推到新建 source 语义
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
  - name: valid_dau_rows
    expr: dau is not null
columns:                                          # 错误地只声明了部分物理列
  - name: date
    type: time
```

```yaml
# ✅ Good —— 正确的 augmentation overlay
name: ai_metric_international_country_daily       # 文件名 + name 完全对齐 manifest source
grain:
  - date
measures:
  - name: dau
    expr: sum(dau)
    description: 国际化日活跃用户数。
  - name: valid_dau_rows
    expr: dau is not null
    description: DAU 有效行。
segments:
  - name: <业务筛选片段>
    expr: <sql_filter_expression>
    description: <业务说明>
```

#### 3.7.4 New semantic source 规范

新建 semantic source 是**高级**操作，等价于在同一张物理表上额外暴露一个业务入口。它**不**是给已有 source 增强的快捷方式。

判断标准：交付包中出现以下任意一项，**必须**先怀疑是"误把 overlay 写成 new source"：

| 可疑信号 | 说明 |
| --- | --- |
| `name` 与 manifest source name 不一致 | 例如 `international_country_metrics` vs `ai_metric_international_country_daily` |
| 显式写 `table:` | 已存在 manifest 时，写 `table:` 通常意味着想新建 |
| 目标业务是"给同一物理表补指标" | 这种场景默认应走 overlay（3.7.3），不是 new source |

如果确实需要 new source，必须同时满足：

| 条件 | 说明 |
| --- | --- |
| 业务理由 | 文档化"为什么不能合并到原 source" |
| ACL 同步 | `access.yaml` 的 `tableSelectors` 必须覆盖新 source |
| Wiki / Eval 同步 | Wiki 说明何时选哪个 source；Eval case 覆盖选源与查询 |
| Agent smoke 同步 | `data-qa-instructions.md` 与 Agent 选源规则要更新 |
| `sl read` + 真实 query | 必须能在 catalog 与 query 中看到新 source 与对应 measure |

最小骨架（与 overlay 区别在 `table:` 与 `name`）：

```yaml
# ⚠ 高级用法：新建 source，默认交付场景应优先走 overlay
name: <new_source_name>
table: <schema>.<physical_table>
grain:
  - <primary_time_column>
measures:
  - name: <measure_name>
    expr: <sql_expression>
```

#### 3.7.5 描述字段规范

manifest 与 overlay 在描述字段上分两层，写错层级会触发 `Unrecognized key: "description"`（见 3.7.7）。

| 层级 | 字段 | 适用对象 | 备注 |
| --- | --- | --- | --- |
| 物理列 / 物理 source | `descriptions:`（复数） | manifest 中 `tables[*].columns[*]`、物理表/列 | 必须用 `db` / `ai` / `human` 等桶 |
| measure / segment | `description:`（单数） | overlay 中 `measures[*]`、`segments[*]` | 单数合法 |
| 派生列 | `descriptions.human` | overlay 中 `columns[*].expr` 对应的派生列 | 人工补充写到 `human` 桶 |

硬规则：

| 规则 | 说明 |
| --- | --- |
| 物理列禁止单数 `description:` | 物理列必须用 `descriptions:` mapping |
| 人工描述写 `descriptions.human` | 保留 `ai` / `db` 桶（ADR-03） |
| measure / segment 单数 `description` 合法 | 但不要把 measure 的 `description` 误写到物理列 |
| 不引入新的作者桶 | 新增桶需要全局约定，谨慎为之 |

#### 3.7.6 GO / NO-GO 交付 checklist

只有**全部**以下检查通过，才允许把 YAML 包交付客户或发布到正式 `/data/lucy`。**`reindex` 成功、单个 `sl validate` 成功都不能单独作为可交付依据。**

##### 3.7.6.1 静态文件检查

| 检查项 | GO 条件 |
| --- | --- |
| 路径 | manifest 在 `_schema/`；overlay 在 `semantic-layer/<conn>/`；不出现陌生目录 |
| 文件名 | augmentation overlay 文件名等于 manifest source name |
| 顶层 `name` | augmentation overlay `name` 等于 manifest source name |
| 顶层 `table:` | augmentation overlay 默认没有 `table:` |
| 物理 `columns:` | augmentation overlay 默认不重复声明物理 `columns:` |
| 描述字段 | 物理列用 `descriptions.*`；物理列禁止单数 `description:` |
| 表达式引用 | measure / segment / join 引用的列都能从 manifest 或派生列解析 |
| 残留文件 | 不存在意外新增 source 文件（与 `find` 列表比对） |
| 凭据 | 文件内无真实 host、username、password、token；示例统一用占位符 |

快速巡检命令：

```bash
# 列出所有 yaml 文件，确认没有意外新增 source
find semantic-layer/<conn> -maxdepth 2 -type f -name "*.yaml" | sort

# 检查 name / table / columns / description 关键字
rg -n "^name:|^table:|^columns:|description:|descriptions:" semantic-layer/<conn>

# 检查是否有真实凭据漏出
rg -n "password:|token:|Authorization" semantic-layer/<conn>
```

##### 3.7.6.2 KTX 合并与索引检查

必须在与客户镜像一致的 KTX/Lucy 版本中执行（建议 staging 环境）：

```bash
# 1. 强制重建语义层索引
ktx --project-dir /data/lucy admin reindex --force

# 2. 目标 manifest source 的 validate
ktx --project-dir /data/lucy sl validate <source-name> --connection-id <conn>

# 3. 目标 source 的物理列 + 新增业务指标可见性
ktx --project-dir /data/lucy sl read <source-name> --connection-id <conn>
```

| 检查项 | GO 条件 |
| --- | --- |
| `admin reindex --force` | 索引成功；`scanned` 数量与改动范围一致（无意外新增 source） |
| `sl validate` | 每个目标 manifest source 返回合法 |
| `sl read` | 可见完整物理列 + 新增 measures / segments |
| 合并结果 | 新增业务指标合并在原 source 下，而不是新生成 source |
| 错误文本 | 不出现 `unknown column`、`Unrecognized key: "description"`、`MANIFEST_PARSE_FAILED` |

##### 3.7.6.3 真实语义查询 + MCP smoke

至少执行一条真实 query：

```bash
ktx --project-dir /data/lucy sl --connection-id <conn> query \
  --measure <source>.<measure> \
  --dimension <source>.<dimension> \
  --limit 5 \
  --execute \
  --max-rows 5
```

随后用真实 Agent token 跑 MCP smoke：

```text
Lucy 能读取什么数据？
<指定日期> <业务核心指标> 是多少？
<指定日期> 按平台拆分的 <业务核心指标> 是多少？
```

| 检查项 | GO 条件 |
| --- | --- |
| 真实 query | 返回数据，字段口径与预期一致 |
| ACL | Agent token 对目标 source 有权限；无 `table_forbidden:<source>` |
| Catalog | `lucy_catalog` / `sl read` 能看到目标 source 与 measure |
| 问答 | Agent 选源正确，不报 metadata / unknown column / manifest parse 失败 |

##### 3.7.6.4 最终门槛

> 只有全部 checklist 通过，才允许把 YAML 包交付客户或发布到正式 `/data/lucy`。
> 任何一项不通过：返回 NO-GO，先修 YAML 或补 ACL，再回到 3.7.6.1 重跑。

#### 3.7.7 常见错误与诊断 Runbook

| 症状 | 高概率原因 | 处理 |
| --- | --- | --- |
| `segment references unknown column(s): <col>` | overlay 重复声明了不完整 `columns:`，使物理列集合不完整 | 删除重复物理 `columns:`；只保留 `measures` / `segments` / `grain`（参见 3.7.3） |
| `Unrecognized key: "description"` | 物理列使用了单数 `description:` | 改为 `descriptions.human` 或合法作者桶（参见 3.7.5） |
| `reindex scanned` 数量异常增加 | 交付包新增了意外 source | 检查 overlay 文件名和 `name` 是否与 manifest source 同名（参见 3.7.3 / 3.7.4） |
| 原 source `measures: []` | 新指标写进了另一个 source | 改 overlay 文件名和 `name`，删除错误 `table:`（参见 3.7.3） |
| MCP `table_forbidden:<source>` | 新 source 未进入 role ACL | 优先确认是否不该新增 source；若确实新增则同步 `access.yaml`（参见 3.7.4 / 5.1） |
| Agent 选到错误 source | 同一物理表出现多个业务 source 且口径不清 | 合并到原 source 或补 Wiki / Eval / ACL 指导（参见 3.7.4） |
| `MANIFEST_PARSE_FAILED` | YAML 语法或 manifest shape 错误 | 先用 `ktx sl validate` 复现；修 YAML parse 后再回到 3.7.6.2 |
| `eval` 跑出 `tool_error` | smoke 选源失败或 ACL 不通过 | 先确认 3.7.6.2 + 3.7.6.3 通过；再回到 Eval |
| `No join path` / join graph 未连通 | Manifest/overlay 未声明 `joins`，或未 reindex | 见 [6.10](#610-lucy_query-报-no-join-path--跨表失败) |
| fanout / Aggregate locality | measure 与 filter 路径经 `one_to_many` 扇出 | 见 [6.11](#611-fanout--aggregate-locality-拒绝查询)、[grain、join 与 fanout](#grainjoin-与-fanout) |
| Wiki reindex `NOT NULL ... summary` | Wiki frontmatter 缺非空 `summary` | 见 [6.14](#614-改了-manifest--wikimcp-仍旧或-reindex-失败) |

诊断命令（与 3.7.6.1 共用，按需调用）：

```bash
# 1. 看 yaml 文件结构
rg -n "^name:|^table:|^columns:|description:|descriptions:" semantic-layer/<conn>

# 2. 列全部 source 文件
find semantic-layer/<conn> -maxdepth 2 -type f -name "*.yaml" | sort

# 3. 读 source 实际合并结果
ktx --project-dir /data/lucy sl read <source-name> --connection-id <conn>

# 4. 看 MCP 拒绝记录
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=20"

# 5. 跑 smoke
ktx --project-dir /data/lucy sl --connection-id <conn> query \
  --measure <source>.<measure> --dimension <source>.<dimension> \
  --limit 5 --execute --max-rows 5
```

FAQ 交叉引用（既有章节同步增补）：

| FAQ 章节 | 增补要点 |
| --- | --- |
| 6.1 为什么提示"未发现本地 manifest"？ | 增补"`reindex` 成功不代表 overlay 合并正确"，按 3.7.6.2 重跑 |
| 6.3 配置文件改动后什么时候生效？ | 区分 `access.yaml` 缓存、KTX reindex、Reload Catalog 的生效时机 |
| 6.7 为什么白名单表保存失败？ | 增补 ACL / source 新增风险（参见 3.7.4） |
| 6.9 最小健康检查清单 | 增补 `sl read`、真实 query、MCP smoke 步骤（参见 3.7.6） |
| 6.10–6.14 语义查询 / Eval / 生效排障 | join 图、fanout、`order_by.direction`、复杂分析边界、Manifest/Wiki 生效 |

#### 3.7.8 Agent 自检协议

Claude Code / Codex 等 Agent 在检查客户 YAML 交付包时必须按以下协议执行，**不得**只凭单个 `validate` 结论给 GO。

##### 3.7.8.1 输入清单

| 输入 | 必需 |
| --- | --- |
| 待交付文件列表与内容 | 是 |
| 目标项目根或 staging 根 | 是 |
| 目标 connection id | 是 |
| 目标 manifest `_schema/*.yaml` | 是 |
| 当前 `access.yaml` 或目标 Agent role | 建议 |
| 业务 smoke 问题 | 建议 |

##### 3.7.8.2 输出模板

````markdown
## 结论
GO / NO-GO

## 阻断项
- [P0] ...

## 风险项
- [P1] ...

## 文件级检查
| 文件 | 类型 | 结论 | 理由 |

## 必须修改
1. ...

## 验收命令
```bash
...
```

## GO 门槛
- [ ] ...
````

##### 3.7.8.3 Agent 硬约束

Agent **不得**：

| 禁止行为 | 原因 |
| --- | --- |
| 仅凭 `reindex` 成功宣告 GO | `reindex` 只能说明索引没崩，不能证明合并语义正确（参见 3.7.6.2） |
| 仅凭一个意外新 source 的 `sl validate` 成功宣告 GO | 误把 overlay 写成 new source 时，`validate` 仍会通过 |
| 忽略 ACL / Wiki / Eval 同步 | new source 缺一不可（参见 3.7.4） |
| 修改或泄露 secrets | 任何文件、log、commit message 都不能出现真实凭据 |
| 在未确认前写客户 YAML | 只能给修复建议；落盘由用户授权 |

##### 3.7.8.4 Agent 必须检查的最小项

1. 文件路径是否符合类型（3.7.1）。
2. manifest source 是否存在（3.7.2）。
3. overlay 文件名 / `name` 是否匹配 manifest source（3.7.3）。
4. augmentation overlay 是否错误携带 `table:`（3.7.3）。
5. augmentation overlay 是否重复声明物理 `columns:`（3.7.3）。
6. measure / segment / join 引用字段是否可从 manifest 或派生列解析（3.7.3 / 3.7.5）。
7. 描述字段是否符合 `descriptions.human` / `description` 分层（3.7.5）。
8. `sl validate`、`sl read`、真实 query、MCP smoke 是否全部通过（3.7.6）。
9. 若新增 source，ACL、Wiki、Eval 是否同步（3.7.4）。
10. 任何文件、命令、log 都不含真实凭据（3.7.1 / 3.7.6.1）。

## 4. Agent / 客户端接入指南

### 4.1 接入地址

接入地址以 WebUI 展示的 Public MCP endpoint 为准。部署方通过
`LUCY_PUBLIC_MCP_URL` 配置该值；未配置时 WebUI 只会显示本地开发 fallback。

```text
<LUCY_PUBLIC_MCP_URL>
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
      "url": "<LUCY_PUBLIC_MCP_URL>",
      "headers": {
        "Authorization": "Bearer ${LUCY_AGENT_TOKEN}"
      }
    }
  }
}
```

本机 shell 中读取 secret 文件：

```bash
export LUCY_AGENT_TOKEN="$(cat <PROJECT_ROOT>/.ktx/secrets/lucy-agent-token)"
```

### 4.3 Hermes / 通用 HTTP MCP client

```json
{
  "mcpServers": {
    "lucy": {
      "url": "<LUCY_PUBLIC_MCP_URL>",
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
| `users[].tokens[].expires_at` | Proxy 鉴权强制拒绝已过期 token；建议到期后仍撤销以清理 YAML |
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
    password: <file:/absolute/path/.ktx/secrets/mysql-aliyun-password>
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
    password: <env:STARROCKS_PASSWORD>
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
| `LUCY_ADMINS_CONFIG_PATH` | `webui/config/admins.yaml` | 覆盖 WebUI 管理员配置路径 |
| `LUCY_WEBUI_AUTH` | （空） | `required`：无管理员时进入 bootstrap；`off`：强制开放（仅调试） |
| `LUCY_WEBUI_SESSION_SECRET` | 自动落到 `.ktx-ui/webui-session-secret` | WebUI 登录会话 HMAC 密钥 |
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
ktx --project-dir <PROJECT_ROOT> admin reindex
```

注意：当前 WebUI 的 Reload Catalog 只读本地静态 YAML；它不会自动连接数据库扫描新表，也不会触发 AI enrichment。

> **关联：M20 YAML 交付 runbook**
>
> - 交付包存在但 `admin reindex` 仍报"未发现本地 manifest"：先按 [3.7.6.2 KTX 合并与索引检查](#3762-ktx-合并与索引检查) 跑 `sl read`，再回到本节。
> - 如果是 overlay 文件名 / `name` 与 manifest source 不一致导致新生成 source：参考 [3.7.3 Manifest augmentation overlay 规范](#373-manifest-augmentation-overlay-规范) 与 [3.7.7 常见错误与诊断 Runbook](#377-常见错误与诊断-runbook)。

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
| `webui/config/access.yaml` role/user/token | Admin 创建/撤销 Token 与删除 Agent 会立即清 Proxy access 配置缓存；其余热更新路径仍可能有最多 30 秒缓存 |
| `semantic-layer/**/*.yaml` | WebUI 下次 API 读取文件即可看到；KTX/MCP 检索需要 `ktx admin reindex` |
| `wiki/**/*.md` | WebUI 下次读取文件即可看到；KTX/MCP 检索需要 `ktx admin reindex` |
| `ktx.yaml enabled_tables` | WebUI 保存后立即写文件；运行静态 `POST /api/catalog/reload` 检查 manifest 对齐 |
| `ktx.yaml` 新连接或凭据 | 可能需要重启 KTX MCP daemon；至少运行 `ktx connection test <connId>` |
| `webui/config/data-qa-instructions.md` | Proxy 当前实现一次性加载；修改后重启 WebUI/Proxy 才稳妥 |

> **关联：M20 YAML 交付 runbook**
>
> - `admin reindex` 成功不等于 YAML 已合并到目标 source，详见 [3.7.6.2 KTX 合并与索引检查](#3762-ktx-合并与索引检查) 与 [3.7.6.4 最终门槛](#3764-最终门槛)。
> - 若 new semantic source 已新增，ACL 缓存需要等 Proxy 30 秒或重启；ACL 同步动作见 [3.7.4 New semantic source 规范](#374-new-semantic-source-规范)。

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
| `expires_at` 已到期或不可解析 | 重新生成 token，或修正 `access.yaml` 中的过期时间 |
| `LUCY_ACCESS_CONFIG_PATH` 指向了另一份配置 | 检查 WebUI/Proxy 进程环境 |
| 客户端环境变量未展开 | 确认 `${LUCY_AGENT_TOKEN}` 在启动客户端前已 export |
| 误以为撤销后仍有 30 秒窗口 | Token 撤销 / Agent 删除会立即清 Proxy 缓存；新请求应立即 401 |

### 6.6 KTX upstream 不可用

本地 fallback 只覆盖 `initialize`、`tools/list`，以及 `tools/call` 的 `wiki_search`。`lucy_query`、`lucy_read_source`、`lucy_catalog` 等真实数据工具仍需要 KTX upstream。

检查：

```bash
ktx status
ktx mcp start --project-dir <PROJECT_ROOT>
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

> **关联：M20 YAML 交付 runbook**
>
> - 若白名单指向的 source 是交付包中新生成的 source，先确认是否属于"误把 overlay 写成 new source"。判定标准见 [3.7.4 New semantic source 规范](#374-new-semantic-source-规范)。
> - 如果确实需要 new source，记得同步 `access.yaml` 的 `tableSelectors`，详见 [3.7.4 New semantic source 规范](#374-new-semantic-source-规范) 与 [3.7.7 常见错误与诊断 Runbook](#377-常见错误与诊断-runbook)。

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
| 审计热库 SQL 留存 | 热库（`.ktx-ui/audit.sqlite`）不存完整 `SQL` / `SQL AST` 原文；只存 `query_hash` 与脱敏 `query_preview`。详见 [审计热库与冷库（SQL 留存边界）](#审计热库与冷库sql-留存边界) |
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

> **关联：M20 YAML 交付 runbook**
>
> - 上述清单覆盖"健康"层面；要确认 YAML 交付包**业务语义合并正确**，必须按 [3.7.6 GO / NO-GO 交付 checklist](#376-go--no-go-交付-checklist) 全量跑过。
> - 完整交付前请至少额外执行 `ktx sl read`、真实 `ktx sl query` 与 Agent MCP smoke，问题簇查询见 [3.7.6.3 真实语义查询 + MCP smoke](#3763-真实语义查询--mcp-smoke)。
> - Agent 自动复核协议见 [3.7.8 Agent 自检协议](#378-agent-自检协议)。

### 6.10 `lucy_query` 报 No join path / 跨表失败

含义：语义编译器在 **join 图**里找不到从 measure source 到 dimension/filter source 的安全路径。常见文案含 `No join path`、`not connected in the join graph`。

这与「物理库里有外键 / 表已启用」不是一回事：`lucy_query` 只认 Manifest / overlay 里声明的 `joins`。

| 检查项 | 做法 |
| --- | --- |
| 是否声明 join | 在 `semantic-layer/<conn>/_schema/<schema>.yaml`（或相关 overlay）为相关表写 `joins`：`to`、`on`（source 限定列名）、`relationship`、`source: formal` |
| relationship 是否合法 | 仅用 `many_to_one` / `one_to_many` / `one_to_one`；禁止 `many_to_many`。桥表拆成两条 `many_to_one` 指向两端 |
| 索引是否更新 | 改 YAML 后执行 `ktx admin reindex`（或 WebUI 语义资产全量重建）；Docker 卷部署还须先把文件同步进容器数据卷 |
| 是否读到合并结果 | `ktx sl read <source> --connection-id <conn>` 确认 joins 已出现在合并模型中 |

概念说明见 [grain、join 与 fanout](#grainjoin-与-fanout)。YAML 写法见 [3.7 YAML 文件规范与交付验收](#37-yaml-文件规范与交付验收)。

### 6.11 fanout / Aggregate locality 拒绝查询

含义：join 路径可能存在，但编译器认为沿 `one_to_many` 做 filter/dimension 会 **扇出放大** 聚合，或 measure 源无法安全到达目标维度。常见文案含 `fanout`、`Aggregate locality cannot safely reach`。

处理原则：

1. **换 measure 源**：尽量从「多对一」指向维度的事实/桥表发起 `count`/`sum`，再挂 `many_to_one` 维度。  
2. **少用跨 o2m 的 filter**：若过滤维度只能经 `one_to_many` 到达，先单独查出允许的键集合，再在第二步用 `in` 过滤（半连接式两步查询）。  
3. **补反向边要谨慎**：为连通性增加 `one_to_many` 可能引入多路径歧义（`Ambiguous join path`）；优先保证业务主路径清晰。  
4. **不要用「先 join 再聚合」的直觉硬刚**：语义层会改写预聚合策略；错误 `grain`/`relationship` 会导致拒查或静默错数。详见 [grain、join 与 fanout](#grainjoin-与-fanout)。

### 6.12 `order_by` 排序无效或排反

`lucy_query` / `sl_query` 的 `order_by` 项必须是对象，且降序/升序字段名为 **`direction`**（取值 `desc` / `asc`）。

| 写法 | 结果 |
| --- | --- |
| `{"field":"metric","direction":"desc"}` | 按预期降序 |
| `{"field":"metric","dir":"desc"}` | `dir` 常被忽略，可能变成默认升序，Top-N 看起来「答错」 |
| 字符串 `"-metric"` 或非对象项 | 可能直接 `invalid_arguments` |

排障：打开 `include: ["sql"]`（若环境允许）核对最终 `ORDER BY` 是否带 `DESC`。

### 6.13 语义查询答不出复杂分析题，或 Eval 对不上 gold

分清三类问题，避免把能力边界当成「环境坏了」：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| 单表/已声明 join 的聚合可查，但窗口函数、NTILE 分箱、回归、复杂中位数链路失败 | 薄语义层（缺专用 measure/segment/派生列）表达力不足 | 补业务 measure/segment，或接受评测用例走受控 SQL / 旁路口径；**默认 MCP 拒绝 raw SQL**（见 [6.8 安全边界速查](#68-安全边界速查)） |
| Case 标注需要 raw SQL fallback，但 Agent 只有 `lucy_*` | 产品面与评测元数据不一致 | 扩工具授权须走治理；Pilot/内测可用独立 SQL 旁路评分，不得假装 `lucy_query` Pass |
| 换引擎或重装载后数值与旧 gold 不一致 | gold 引擎漂移（分位数、时区、类型映射） | 在目标库重算并更新 `evals/**/gold`；对不稳定算法放宽 `numeric_tolerance`，并在校准说明中登记 |

Eval 入口见 [3.6 质量评测 Eval](#36-质量评测-eval)。交付验收勿用「单次 query 碰巧有数」代替 [GO / NO-GO](#376-go--no-go-交付-checklist)。

### 6.14 改了 Manifest / Wiki，MCP 仍旧或 reindex 失败

| 症状 | 高概率原因 | 处理 |
| --- | --- | --- |
| 仓库 YAML 已改，MCP / `sl read` 仍是旧模型 | 进程读的是 Docker 数据卷或另一 `PROJECT_ROOT` | 同步文件到实际项目根，再 `admin reindex` / 语义资产「同步索引」 |
| `Visible Scope` 仍无新表 | ACL 未扩 `tableSelectors`，或仍在用旧 MCP session | 更新 `access.yaml` role；**新开** session 再 `initialize` |
| Agent 绑定 role 失败 / 配置不生效 | 用户字段误用复数 `roles` | 使用单数 `role: <roleId>` |
| Wiki reindex 报 `NOT NULL ... summary` | frontmatter 缺非空 `summary` | 补 `summary` 后重新上传/commit，再 reindex |
| reindex 部分 scope 失败、部分成功 | 日志里看清失败 scope（如仅 `wiki/global`） | 先修失败 scope，不要假设「有 failed=1 就等于语义层未更新」——以 `sl/<conn> scanned=…` 行为准 |

生效时机总表见 [6.3 配置文件改动后什么时候生效？](#63-配置文件改动后什么时候生效)。
