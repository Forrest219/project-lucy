# Project Lucy 系统使用与运维手册

| 项 | 内容 |
| --- | --- |
| 文档类型 | System Handbook |
| 适用对象 | 使用者、管理员、运维人员、接入 Agent 的协作者、开发者 |
| 事实来源 | `webui/server/`、`webui/src/`、`semantic-layer/`、`webui/config/`、`ktx.yaml.example`、`webui/docs/01-17` |
| 当前日期 | 2026-10-19 |
| 文档基线（请勿手改） | 详见 §0.0 文档基线 |

### 0.0 文档基线（自动同步）

本表由 `npm run lint:handbook-baseline` 校验；任一格被手改、与事实源（该值的权威来源）不一致即 fail。

| 字段 | 当前值 | 来源 |
| --- | --- | --- |
| 产品版本（`VERSION`） | 0.20.0 | `VERSION` |
| 产品版本标签 | v0.20.0 | `webui/src/lib/lucyVersion.ts` FALLBACK |
| Helm `appVersion` | 0.20.0 | `deploy/k8s/helm/lucy/Chart.yaml` `appVersion` |
| 捆绑 KTX 版本 | 0.16.0 | `Dockerfile` `LUCY_BUNDLED_KTX_VERSION` |
| 上次手册审计 | 2026-10-24 | 人工维护；下次审计由治理 PR 触发 |
| 版本号规则 | `0.20.x`（同一版本线按数值递增，见 `docs/governance/version-matrix.md` §1.1） | `docs/governance/version-matrix.md` |

> **不要**手改本表。改完事实源后跑 `npm run lint:handbook-baseline`；脚本会因更新而失败时，按报错提示同步本表，再跑一次。

### 0.4 版本号说明

2026-10-24 产品版本先从 `2.0.0` 更正为 `0.2.0`，随后因 `0.2.0 < 0.17.0` 再次更正为 **`0.20.0`**。当前客户标签为 `v0.20.0`，捆绑 KTX 仍为 `0.16.0`，Helm Chart 包版本为 `0.2.7`。

**更正原因**：`2.0.0` 是与 Helm Chart 版本线容易混淆的错误切线；`0.2.0` 又错误地低于历史 `0.17.0`。`0.20.0` 恢复当前 `0.x` 版本线的数值顺序：`0.20.0 > 0.17.0 > 0.2.0`。`v2.0.0` 是已废止的历史切线，不作为当前版本线的承接基准。

**版本号规则**（详见 `docs/governance/version-matrix.md`）：

| 触发 | 递增 | 例 |
| --- | --- | --- |
| 下一次客户交付包 | 第二段 +1 | `0.20.0 → 0.21.0` |
| 大能力、破坏性配置或捆绑 KTX 主版本变化 | 第二段 +10 | `0.20.0 → 0.30.0` |
| 补丁段 | 保持 `0`，直到矩阵另定 hotfix 规则 | `0.20.0 → 0.20.1` 暂不启用 |
| 再进主版本 | 需新的明示批准 | `1.0.0` |

> **同一产品版本线必须按数值递增。** 不得通过降低版本号表示最新发布。构建提交用于识别具体构建及其与 `main` 的关系，是对产品版本的补充，不能用来允许版本号倒退。

**客户镜像 tag 形式**：`customer-amd64-0.20.0-YYYYMMDD-<gitSha>`。

登录后，侧栏左下角只保留一个账户入口；点击可查看完整账户信息、打开「系统手册」或「退出登录」。开放模式或未登录时仍可直接打开系统手册。产品版本、构建提交和随包 KTX 版本常驻在「系统设置 / 版本信息」（`/admin/version`）。构建提交的可见文本是前 12 位；复制内容或 `/api/health` 的 `gitSha` 才是完整 40 位。这不是产品版本，也不能在 Helm 或 `LUCY_VERSION` 里手改；构建时没有写入则显示 `unknown`。构建混入未提交改动时页面在构建提交同一行显示工作区状态，文案是「构建时工作区有未提交改动」，不写 `dirty`；干净构建（含全部客户 CI 构建）不显示该句。对照客户正在跑的 `main` 提交时看这一页的构建提交，而不是只看产品版本号。

本次版本更正**不**涉及的事项：

- `webui/package.json` 的 `version`（npm 包版本）保持 `1.0.0`，与包无关。
- Helm Chart `version` 当前是 `0.2.7`；图表包版本与 `appVersion` 分开。
- `@kaelio/ktx` 仍为 `0.16.0`；本次未升级运行时。
- 已发布的 `v2.0.0`、`v0.2.0` 标签与 GitHub Release 均作为历史事实保留，不删除、不移动。

## 0. 常见问题速查

本节是按用户问题组织的快速入口。每条答案给下一步判断；完整操作以正文章节为准。
常见问题按三种角色分组：开发者 / 管理员 / 接入协作者。
第 6 章 FAQ 与排障指南 是配套的深入排查。

### 0.1 面向开发者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| 我在哪里新建数据库连接？ | `WebUI` 不新建物理连接；先在 `ktx.yaml` 和 secret 文件声明连接，再回 `WebUI` 管理已声明连接。 | [3.2 数据接入 · 连接 / Schema / 表范围](#data-access-connections)、[WebUI 与 ktx.yaml 的职责边界](#database-connection-boundary) |
| 数据库密码应该放在哪里？ | 用 `file:`、`env:` 或 `Docker` secrets；不要把明文密码写进 `ktx.yaml`、文档、`commit message` 或聊天记录。 | [连接形态与配置字段](#database-connection-shapes)、[5.2 ktx.yaml](#ktx-yaml) |
| 点了刷新本地目录，刷新后的表在哪里看？ | `/connections` 看 reload 状态，`/connections/enabled-tables` 看可纳入启用表范围的表，`/catalog` 语义资产页看已进入语义建模的表。 | [刷新本地目录](#catalog-reload) |
| 连接概览上的「已发现表数」是什么？ | 统计本地 Schema Manifest 已读到的表，不是远端物理库实时表数；与「已启用表数」（`enabled_tables`）对照看。 | [连接概览指标说明](#connection-overview-metrics) |
| 为什么提示「未发现本地 manifest」？ | `ktx.yaml` 声明了 `Schema` 或启用表范围，但本地 `semantic-layer/<conn>/_schema/<schema>.yaml` 缺失或未包含目标表。 | [6.1 为什么提示「未发现本地 manifest」？](#manifest) |
| `YAML` 改完后为什么 `Agent` 仍然搜不到新口径？ | `WebUI` 读文件即可看到；`KTX` / `MCP` 检索需要 `ktx admin reindex`，并且还要用 `sl read` 确认 `overlay` 已合并到目标 `source`。 | [6.3 配置文件改动后什么时候生效？](#config-change-effective-timeline)、[3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist) |
| 我应该改 `manifest` 还是 `overlay`？ | 物理表结构和物理列描述在 `manifest`；`grain`、`measures`、`segments`、派生列和业务补丁在 `overlay`。 | [3.3 业务上下文 · 语义层](#semantic-layer)、[3.7.1 YAML 类型总览](#yaml-type-overview) |
| 新增指标怎样才算可以交付？ | 不能只看 `reindex` 或单个 `sl validate`；必须通过静态检查、`sl read`、真实 query、`MCP smoke` 和最终 `GO / NO-GO` 门槛。 | [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist) |
| 可以用编码代理自动生成语义 / Wiki / 评测用例吗？ | 可以。用**配置作者 Skills**（Claude Code / Codex / Cursor）生成产物；生成后仍须过全包发布前检查与 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist)。这不是 MCP 问答运行时 Skill。 | [配置作者 Skills](#config-author-skills) |
| `lucy_query` 报 `No join path`？ | 跨 source 查询需要 Manifest/overlay 声明 `joins` + `relationship`，并完成索引重建；有物理外键不等于语义层已连通。 | [6.10 `lucy_query` 报 No join path / 跨表失败](#lucy-query-no-join-path)、[grain、join 与 fanout](#semantic-grain-fanout) |
| 查询被 fanout / Aggregate locality 拒绝？ | measure 源与 filter/dimension 路径不能靠 `one_to_many` 扇出聚合；换 measure 源、改维度，或拆成多步半连接式查询。 | [6.11 fanout / Aggregate locality 拒绝查询](#lucy-query-fanout-locality) |
| 评测用例和运行历史在哪里？ | 在 `/eval/cases` 维护套件，用离线跑批生成结果，再上传到 `/eval/runs`。通过率和没答出来的计数在 `/eval/monitor`。 | [3.6 质量评测](#quality-evaluation) |
| `/catalog` 的「语义状态」和 `/connections/enabled-tables` 的「状态」有什么关系？ | 共用 `GET /api/sources` 的 `completion`。`/catalog` 展示四态完成度；启用表范围页先看 `enabled_tables`，再把非 `done` 收成「已启用，待补语义」。 | [语义状态与启用表范围状态](#semantic-status-and-enabled-status)、[系统概览待处理事项](#overview-action-required) |
| `/overview`「待处理事项」里「N 张表待补语义」怎么算？ | 按表计数：只统计已进入启用表范围（`enabled_tables`）且出现在本地 `Manifest` 的表。`N` = 这些表中 `completion !== done` 的数量；未启用的 `Manifest` 表不计入。`done` 需同时有表描述、`grain`、主键、全部非 `hidden` 列描述和至少一个 `measure`。 | [系统概览待处理事项](#overview-action-required)、[3.3 业务上下文 · 语义层](#semantic-layer) |
| 「待处理事项」其它条目分别统计什么？ | 只保留三类：待补语义、待发布文件、近 30 天无评测。待发布看 `/api/diff` 文件数；无评测看是否已有评测运行记录。计数为 0 不展示。近 7 天 `ACL` 拒绝不在首页展示，到 `/admin/audit` 或调用监控查看。 | [系统概览待处理事项](#overview-action-required) |

### 0.2 面向管理员

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| 什么时候该建角色，什么时候该建 `Agent` / `Token`？ | 角色 = 可复用的权限边界；`Agent` = 要对审计负责的人/机器人；`Token` = 某台设备或某个客户端的接入凭证。先角色、再 `Agent`、最后签发 `Token`。 | [什么时候配置角色、Agent 和 Token](#admin-role-agent-token-guide) |
| 同一人多台电脑要建几个 `Agent`？ | **一个** `Agent`，按设备或客户端各发一个 `Token`。只有权限边界不同时才拆成多个 `Agent`。 | [什么时候配置角色、Agent 和 Token](#admin-role-agent-token-guide) |
| `Agent` 返回 `Access denied` 时先查哪里？ | 先看客户端里的 `decision_reason`，再打开 `/admin/audit` 或查 `/api/admin/audit?outcome=denied`，对照 `role` 的连接、表和工具授权。 | [6.2 JSON-RPC `Access denied` / `decision_reason` 怎么查？](#json-rpc-access-denied-decision-reason)、[3.5 访问治理 · 角色 / Agent / Token](#access-governance) |
| `expires_at` 到期后 `token` 会自动失效吗？ | 会。`MCP` Proxy 在鉴权时校验 `expires_at`（不再只是 `metadata`）；到期或不可解析的值一律视为未授权（401）。要提前下线可在 `Admin` 撤销 `token`；到期后仍建议撤销，避免配置残留。 | [3.5 访问治理 · 角色 / Agent / Token](#access-governance)、[6.5 MCP 返回 401](#mcp-401) |
| 问询记录和调用流水都能导出吗？ | 可以。`/admin/audit` 的「导出问询记录」是一问一行，「导出调用流水」是一调用一行；两者通过「问询 ID」关联。 | [问询记录与调用流水怎么选、怎么导出](#admin-audit-turns-vs-calls) |
| 调用流水里的「生成 SQL」从哪来？ | `lucy_query` 经语义层编译后的 SQL；热库字段 `generated_sql` 明文保存，调用流水列表与 CSV 可直接 review。不存 deny 路径的 raw `sql`/`query` 攻击载荷。 | [审计热库与冷库（SQL 留存边界）](#admin-audit-hot-cold-store)、[3.5 访问治理 · 角色 / Agent / Token](#access-governance) |
| 新连接什么时候对 `Agent` 可见？ | `ktx.yaml`、`manifest` / `overlay`、启用表范围、`KTX reindex`、`access.yaml` `role` / `ACL` 都就绪后才可见。 | [Agent 可见性与 ACL 同步](#database-connection-acl-sync)、[新增数据库连接（运维 Runbook）](#database-connection-operations-runbook) |

### 0.3 面向接入协作者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| `MCP` 返回 401 是什么原因？ | 通常是未带 `Bearer` `token`、`token` hash 不匹配、`token` 已撤销、`expires_at` 已到期、环境变量未展开或进程读取了另一份 `access` 配置。 | [6.5 MCP 返回 401](#mcp-401) |
| Lucy 整体架构是什么样的？ | 先看两张产品架构图：一张是控制面/运行时总览，一张是摄取流与服务流。WebUI 内打开 `/help?section=product-architecture-diagrams`，或点开下方全屏图。 | [1.6 产品架构图（摄取与服务）](#product-architecture-diagrams) |
| 本地开发应该访问哪个端口？ | 页面端口以启动日志为准；常见开发入口是 `Vite 5173`，`API 5174`，`Lucy MCP Proxy 7879`。`Docker` / demo 宿主端口可能是 `55176` 等映射端口。 | [2.2 本地启动](#local-startup)、[4.1 接入地址](#mcp-endpoint) |
| 为什么 Visible Scope 没有我刚启用的表？ | 检查 `enabled_tables`、`role` 的 `tableSelectors`、以及是否**新开** MCP session；扩权后旧 session 不会自动刷新 Scope。 | [Agent 可见性与 ACL 同步](#database-connection-acl-sync)、[6.2 JSON-RPC `Access denied` / `decision_reason` 怎么查？](#json-rpc-access-denied-decision-reason) |
| `order_by` 为什么没按我想的降序？ | 结构化参数请用 `direction: desc|asc`；仅写 `dir` 可能被忽略，导致默认升序。 | [6.12 `order_by` 排序无效或排反](#lucy-query-order-by) |

## 1. 系统概述与架构拓扑

### 1.1 Lucy 是什么

Project Lucy 是基于 KTX 的本地语义补充工作台与 MCP 访问治理代理。它把数据库连接、静态语义层 YAML、业务 Wiki、评测用例和访问权限配置编译成 Agent 可用、可审计、可回归的数据服务。

Lucy 的两个核心身份：

| 身份 | 面向对象 | 核心职责 |
| --- | --- | --- |
| 本地语义补充工作台 | 数据/业务维护者 | 维护表描述、字段语义、grain、measures、segments、joins、Wiki、评测用例 |
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
| Zero AI Dependency 数据管道 | 数据库接入、语义资产、启用表范围、静态 Catalog 刷新不依赖 LLM、embedding 或 enrichment | `POST /api/catalog/reload` 只读本地 YAML |
| 文件系统为 SSOT | WebUI 是编辑器，不是业务事实数据库 | `ktx.yaml`、`semantic-layer/`、`wiki/`、`evals/`、`webui/config/access.yaml` |
| DryRun + Diff 预览落盘 | 写类操作默认预览，必须显式 `dryRun:false` 才写入 | 表编辑、Wiki、Agent/Role、Token、启用表范围、schema 添加 |
| 安全边界集中 | 所有写入走 `webui/server/fs-safe.ts` | 允许目录、禁止目录、路径穿越、symlink 逃逸 |
| 运行时指导与开发规则分离 | 数据问答 rules 由 Proxy initialize 注入；开发规则在 `AGENTS.md` / `docs/governance/DEVELOPMENT.md` | 禁止把数据问答规则正文写回 `CLAUDE.md` |

### 1.4 目录与事实源地图

> 本手册中的「事实源」指某项配置或信息的权威来源文件（single source of truth）。改动事实源后，其余文档与配置需同步更新。

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
| `.ktx-ui/audit.sqlite`（或 `LUCY_AUDIT_DB`） | MCP 访问审计热库：撤销 token、权限快照、问题簇、`generated_sql`（编译结果明文）、`query_hash` / 脱敏 preview；不存 raw query 攻击载荷 / 结果行 / Token 明文 | 系统生成 |
| `.ktx-ui/audit-cold/query-artifacts/`（或 `LUCY_AUDIT_COLD_DIR`） | 查询原文加密冷存（Spec 124 legacy，可选；运维主路径为热库 `generated_sql`） | 系统生成 |
| `.ktx-ui/catalog-reloads.json` | 最近静态 Catalog reload 记录 | 系统生成 |
| `.ktx-ui/eval/runs.sqlite`（或 `LUCY_EVAL_DB`） | 评测运行历史 | 系统生成 |

### 1.5 WebUI 入口速查（运行状态侧栏地图）

本节是侧栏可见入口的镜像视图。
事实源唯一为 `webui/src/app/navigation.ts` 的 `navGroups`（Spec 143 起不再使用置顶 `topLevelEntry` 渲染）。
`webui/docs/06-navigation-ia.md` §3 与代码对齐；架构调整时请先改 `navigation.ts`，再同步 §1.5 表格。

| 分组 | 二级菜单 | 路径 | 一句话用途 |
| --- | --- | --- | --- |
| 运行状态 | 系统概览 | `/overview` | 确认系统可用，处理当前待办。 |
| 运行状态 | 调用监控 | `/ops/calls` | 准实时查看 MCP 工具调用量、成败与请求时效。 |
| 运行状态 | 使用概况 | `/admin/usage` | 查看 Agent、Token、数据表的活跃率，以及 WebUI 页面访问情况。 |
| 数据接入 | 连接概览 | `/connections` | 管理数据库连接、`Schema` 与 `Schema Manifest`，并查看连通性和本地目录同步状态。 |
| 数据接入 | 启用表范围 | `/connections/enabled-tables` | 配置各连接进入语义层的表范围，并审阅保存前变更。 |
| 业务上下文 | 语义资产 | `/catalog` | 管理表、字段、指标、分群与关联等结构化语义资产。 |
| 业务上下文 | 业务 Wiki | `/wiki` | 管理业务口径、指标说明与分析指引等业务文档。 |
| 业务上下文 | 业务 Skill | `/skills` | 查看受治理的业务 `Skill` 资产及其发布状态与角色授权。 |
| 语义发布 | 发布工作台 | `/publish/workbench` | 审阅并校验语义与 `Wiki` 变更，同步索引后使其对 `Agent` 生效。 |
| 语义发布 | 发布记录 | `/publish/history` | 查看历次语义发布的变更范围、执行结果与操作记录。 |
| 质量评测 | 评测用例 | `/eval/cases` | 管理数据问答与语义质量的评测用例及预期结果。 |
| 质量评测 | 运行历史 | `/eval/runs` | 查看评测运行记录、通过率、结果明细与失败诊断。 |
| 质量评测 | 趋势监控 | `/eval/monitor` | 监控评测通过率、失败集中度与质量漂移趋势。 |
| 质量评测 | 现场提问 | `/eval/field-questions` | 审定访问日志里反复出现的业务问法，补问法后收成评测用例。 |
| 质量评测 | 安全评测候选 | `/eval/security-candidates` | 从访问拒绝日志中提取权限与数据隔离场景，审定后转为安全评测用例。 |
| 访问治理 | Agent | `/admin/agents` | 管理 `Agent` 身份、角色、`Token` 及数据访问边界。 |
| 访问治理 | Token 凭据 | `/admin/tokens` | 全局查看、签发与定向吊销 `Agent` 访问凭据。 |
| 访问治理 | 角色权限 | `/admin/roles` | 管理角色的数据库连接、数据表与 `MCP` 工具授权范围。 |
| 访问治理 | 行权限视图 | `/admin/row-policies` | 按表反查角色的行策略与 `Agent` 的最终行约束。 |
| 访问治理 | 访问关系图 | `/admin/access-map` | 查看授权路径与实际访问路径的对应关系。 |
| 访问治理 | 访问日志 | `/admin/audit` | 按问询和工具调用追溯 `Agent` 访问行为、权限裁决与执行耗时。 |
| 访问治理 | MCP 调试台 | `/admin/mcp-playground` | 检查 `Agent` 能不能连上，或者能不能查某张表。 |
| 访问治理 | 配置审计 | `/admin/config-audit` | 查看各类配置与内容资产的写入记录、变更内容和操作者。 |
| 系统设置 | 品牌外观 | `/admin/branding` | 配置客户 `Logo`、产品名称与品牌副标题。 |
| 系统设置 | 登录账户 | `/admin/admins` | 管理 `WebUI` 登录账户，并配置所有者或运维角色。 |
| 系统设置 | 版本信息 | `/admin/version` | 查看产品版本、构建提交和随包 `KTX` 版本；有未提交改动时显示工作区状态。 |

> 事实源唯一为 `webui/src/app/navigation.ts` 的 `navGroups`。

### 1.6 产品架构图（摄取与服务）

这两张图是 Lucy 产品架构的**权威视图**（优先于帮助文档站 `product-intro.html` 内的简化示意）。在 `/help` 中可直接打开全屏图：

| 图 | 看什么 | 全屏打开 |
| --- | --- | --- |
| Lucy 架构总览 | 控制面（WebUI）与运行时（MCP Proxy / KTX / 数据源 / Agent）如何分层协作 | [/api/help/diagrams/lucy-architecture-diagram](/api/help/diagrams/lucy-architecture-diagram) |
| 摄取与服务流程 | 摄取侧：数据源 → 语义/Wiki/Skill → 评测发布前检查；服务侧：Agent 提问 → 鉴权/上下文/SQL → 可信答案 | [/api/help/diagrams/lucy-docs-flows](/api/help/diagrams/lucy-docs-flows) |

仓库内静态副本（可离线用浏览器打开）：

- `docs/user-guide/lucy-architecture-diagram.html`
- `docs/user-guide/lucy-docs-flows.html`

一句话速览：

1. **摄取**：把库表与业务口径编译成 Semantic / Wiki / Skill / 评测上下文包。
2. **服务**：Agent 只经 Lucy MCP Proxy 拿上下文并跑只读查询；不直连业务库。

部署端口与进程拓扑见上文 [1.2 架构拓扑](#architecture-topology)。侧栏入口地图见 [1.5 WebUI 入口速查](#webui-entry-map)。

## 2. 快速上手

### 2.1 环境要求

| 依赖 | 要求 |
| --- | --- |
| Node.js | 根 `package.json` 要求 `>=22`；WebUI 依赖现代 React/Vite/Fastify |
| npm | 用于安装 WebUI 依赖和运行脚本 |
| KTX CLI | `ktx mcp start`、`ktx status`、`ktx sl validate`、`ktx admin reindex` |
| 数据库账号 | 建议只读账号；生产库禁止 DDL/DML |
| Git | 发布工作台读取 `git diff`，Lucy 不自动 commit |

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
| `http://127.0.0.1:5173/overview` | 开发态 WebUI 上线检查 |
| `http://127.0.0.1:5174/api/health` | Fastify 健康检查 |
| `http://127.0.0.1:7879/mcp` | 本地 npm 开发 MCP fallback（未设 `LUCY_PUBLIC_MCP_URL`）；**不计**部署就绪。Docker demo 默认 Advertise 为 `http://127.0.0.1:57881/mcp`；客户部署以 `LUCY_PUBLIC_MCP_URL` / WebUI 展示值为准 |


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
    password: file:<PROJECT_ROOT>/.ktx/secrets/mysql-aliyun-password
    schemas:
      - dataforai
```

3. 创建密码文件。

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

### 3.1 运行状态 · 系统概览与上线检查

入口：`/overview`

上线检查是 5 步 readiness，不等同于语义覆盖率。

| 步骤 | Ready 条件 | 处理入口 |
| --- | --- | --- |
| 1. 接入数据库 | 至少 1 个 connection，且 KTX runtime 可用 | `/connections` |
| 2. 限定表范围 | `enabled_tables` 数量大于 0 | `/connections/enabled-tables` |
| 3. 配置语义层 | 至少 1 张 semantic table 进入 `done` | `/catalog` 语义资产 |
| 4. 校验并审阅变更 | 当前无未审阅 changed files | `/publish/workbench` |
| 5. 配置 Agent MCP | 存在启用 Agent，且至少 1 个可用 token；非全 legacy allow；且 `GET /api/project.mcpEndpoint.status === configured`（已设置合法 `LUCY_PUBLIC_MCP_URL`）。`fallback` / `invalid` **不计**就绪 | `/admin/agents`；部署包装设置 `LUCY_PUBLIC_MCP_URL` |

系统概览 `/overview` 的 Lucy MCP 就绪同样要求 `mcpEndpoint.status === configured`。未设置 public URL 时显示本地 fallback 并可复制（仅本地 npm 便利），但文案标明不可用于客户交付，且计入系统异常 / 未就绪。

当 `Deployment readiness = 5/5` 时，WebUI 会给出 MCP 配置模板；未完成时会指出下一项阻塞原因。

#### 系统概览待处理事项

入口：`/overview`（兼容路由 `/onboarding`）。

「待处理事项」是首页聚合的跨模块运维队列，由前端根据多个只读接口的计数本地拼装；**计数为 0 的项不展示**。上线检查 readiness 与本队列不是同一套规则。

| 条目 | 计数来源 | 口径说明 |
| --- | --- | --- |
| N 张表待补语义 | `GET /api/sources`（`enabled === true`） | **已启用 ∩ `Manifest`** 中 `completion !== done` 的表数。按**表**计数；未启用 `Manifest` 表不计入。徽章为「待处理」，不因缺口比例升为「高风险」。 |
| 存在 N 个待发布文件 | `GET /api/diff` | 返回的可审阅变更文件数（`files.length`）。 |
| 近 30 天无评测数据 | `GET /api/eval/runs/summary?days=30` | 仅在接口成功且返回 `state='no_data'`（确认 **0 条** `status='succeeded'` 运行）时出现。时间窗为 `[started_at ≥ windowStart, started_at < windowEnd]`（30 天半开区间）；加载中、接口失败或 `state='unavailable'` 时均不展示该项。徽章为「提醒」。 |

首页 **不再** 并列「Catalog 对象待处理」（曾与待补语义同数）或「访问风险 / 近 7 天 ACL 拒绝」。`ACL` 拒绝次数到 `/admin/audit` 或调用监控查看——滚动窗口无法通过「查看访问日志」闭环消除，故不进入待处理事项，也不占首页第一屏。

一张表何时算 `done`（`webui/server/completion.ts`）：

1. 有表描述（`descriptions.human` 或 `descriptions.ai`）
2. 有 `grain`
3. 至少一列标记主键（`pk: true`）
4. 全部非 `hidden` 列都有描述
5. 至少一个 `measure`

缺任一项则为 `partial` 或 `not_started`，都计入「待补语义」。补语义入口见 [3.3 业务上下文 · 语义层](#semantic-layer)；发布入口见 `/publish/workbench`。`/catalog`「语义状态」与启用表范围「状态」的对照见 [语义状态与启用表范围状态](#semantic-status-and-enabled-status)。

#### 调用监控（/ops/calls）

入口：`/ops/calls`。运行状态分组下，与 `/overview`（系统概览）和 `/admin/usage`（使用概况）并列；侧栏位置见 [1.5 WebUI 入口速查](#webui-entry-map)。

调用监控回答「MCP 工具调用现在是否健康、是否变慢、是否被拒绝」：六张 KPI 卡片（调用量（24h）、成功率、错误率、拒绝率、P95 耗时、慢请求数（>30s）），加工具调用排行（Top 10）与最近失败与拒绝短表。**只读观测页**：不修改 ACL、不写日志、不调 KTX、不接告警通道。

**关键指标**

| UI 主术语 | 口径 | 来源事实 |
| --- | --- | --- |
| 调用量（24h） | `access_log` 中业务 MCP 工具调用次数；排除协议工具 | `.ktx-ui/audit.sqlite` |
| 成功率 | `ok / businessCalls` | 同上；分母为 0 → 展示「暂无调用」 |
| 错误率 | `error / businessCalls` | 超阈（`LUCY_OBSERVABILITY_MAX_ERROR_RATE`，默认 `0.02`）红标 |
| 拒绝率 | `denied / businessCalls` | 超阈（`LUCY_OBSERVABILITY_MAX_DENIED_RATE`，默认 `0.1`）红标；用于排查 ACL 异常，独立列于错误率之外 |
| P95 耗时 | 窗内 `durationMs` 的 P95 | 超阈（`LUCY_OBSERVABILITY_SLOW_MS`，默认 `30000`）红标 |
| 慢请求数（>30s） | `durationMs > slowMs` 的次数 | 同上阈值 |

页头不展示「统计时间」或「SLO 总状态」；阈值越线只体现在对应 KPI 卡片红标。

**滚动窗口**

| `range` | 默认 | 用途 |
| --- | --- | --- |
| `1h` | — | 当前尖峰盯盘 |
| `24h` | 是 | 默认主盯盘窗 |
| `7d` | — | 周级节奏 |
| `30d` | — | 月级趋势（仅本页；访问日志补 `30d` 为此下钻） |

切换写入 URL `range=`，自动刷新（默认 30s）改写当前一桶；兼容读旧 `hours=`。窗口与 `/admin/audit` 持久日志不同——本窗口是**热数据**、刷新快、不替代审计导出。慢请求数空桶记 0；P95 耗时在该桶调用 < 20 次时断开。

**`callSource` 标记**

来自 `MCP 调试台` 受控试调的调用记为 `mcp-playground`，来自生产 Agent 的记为 `agent`。调用监控默认聚合两者（业务 MCP 调用集合），但列表/工具排行/失败短表都可以按 `callSource` 过滤——把试调与真实调用分开看。详见 [MCP 调试台（/admin/mcp-playground）](#mcp-playground) § 从试调到审计。

**不要做什么**

- 不修改 ACL、不调 Proxy 裁决语义。
- 不写日志、不发邮件 / Slack / Webhook。
- 不接评测 / Hermes / 跑批数据。
- 不做 SSE / WebSocket 真推送；30s 轮询即可。
- 任何「封禁 / 限流 / 改权限」动作走 `/admin/audit` 取证，或 `/admin/mcp-playground` ACL 预览后再改 `access.yaml`。

**关联**

- §3.5 [访问治理](#access-governance)：访问日志是本页 KPI 的取证主场。
- §3.11 [MCP 会话与上游连接](#mcp-session-upstream)：上游会话归属决定 `callSource` 的语义。
- §3.9 [接入向导](#onboarding-guide) Step 6（首问验证）：本窗口可用于观察首问后的工具调用是否符合预期。

权威 Spec：`webui/docs/143-call-monitoring-ops-page-spec.md`、`webui/docs/165-call-monitor-window-series-spec.md`、`webui/docs/156-runtime-status-usage-boundary-spec.md` §5.1。

### 3.2 数据接入 · 连接 / Schema / 表范围

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 连接概览 | `/connections` | 查看 connection、schema、enabled table、KTX 可用性、MCP endpoint |
| 启用表范围 | `/connections/enabled-tables` | 维护 `ktx.yaml` 的 `enabled_tables` |
| 连通测试 | `/connections/test` | 调用 `ktx connection test <connId>` |

> WebUI 不负责新建物理数据库连接。新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。
> WebUI 管理的是已声明连接：查看连接状态、测试连接、添加 Schema、维护启用表范围、上传 YAML 资产、刷新本地目录。

| 问题 | 结论 |
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
| 维护启用表范围 | WebUI `/connections/enabled-tables` |
| 让 Agent 可见 | `webui/config/access.yaml` role / ACL |

连接信息来自 `ktx.yaml`。WebUI 只暴露 `passwordSource`，不会读取或返回 `password: file:` 指向的密码文件内容。

启用表范围保存流程：

1. 在 `/connections/enabled-tables` 勾选/取消物理表。
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

刷新后的「本地目录」不是一个独立页面。它是 WebUI 从本地文件读出的资产视图，按查看目的分布在不同入口：

- 看刷新是否成功：打开 `/connections`，在对应 connection 卡片内查看 `本地目录已刷新`、表数量、warning 数量和缺失 Manifest 诊断。
- 看哪些表可被纳入启用表范围：打开 `/connections/enabled-tables`。这里展示的是本地 manifest 中已经存在、可写入 `ktx.yaml enabled_tables` 的表。
- 看哪些表已经进入语义层维护：打开 `/catalog` 语义资产页。这里展示的是已被系统读入并可维护描述、指标、分群、joins 的 semantic table。
- 看底层 YAML 文件：在仓库中查看 `semantic-layer/<conn>/_schema/<schema>.yaml`（manifest）和 `semantic-layer/<conn>/<source>.yaml`（overlay）。
- 看最近 reload 历史：调用 `GET /api/catalog/reloads`，或查看系统生成文件 `.ktx-ui/catalog-reloads.json`。当前 WebUI 暂无独立的「本地目录历史」页面。

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
| WebUI | 查看 connection、连通测试、添加 Schema、维护 `enabled_tables`、上传 YAML 资产、刷新本地目录、显示 secret 路径来源 | 写入 host / port / user / password；读取 `password: file:` 指向的密码文件内容；直接连接物理数据库做扫描 |
| `ktx.yaml` + secret | 声明物理连接的 driver、host、port、username、password、schemas、`enabled_tables` | Agent 鉴权；role / ACL 治理 |
| `webui/config/access.yaml` | 定义 role、Agent、token hash、ACL（连接、表范围、工具） | 物理连接配置；MCP upstream 行为 |

常见误判：

| 误判 | 正确做法 |
| --- | --- |
| WebUI 上没有「新建连接」按钮是 bug | 这是安全边界；新增连接必须改 `ktx.yaml` + secret |
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
    host: <CHANGE-ME-MYSQL-HOST>
    port: <CHANGE-ME-PORT>
    database: <CHANGE-ME-DATABASE>
    username: <CHANGE-ME-USERNAME>
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
| `file:<absolute-path>` | `file:<PROJECT_ROOT>/.ktx/secrets/<connection-id>-password` | 本地开发、CI 试调环境 |
| `file:/data/lucy/...` | `file:/data/lucy/.ktx/secrets/<connection-id>-password` | Docker 容器内 |
| `env:<NAME>` | `env:LUCY_DB_PASSWORD_<CONNECTION_ID>` | 12-factor / Kubernetes secret |
| inline 明文 | 禁止 | 任何环境都不允许 |

#### 新增数据库连接（运维 Runbook）

按以下顺序操作，前后步骤不可调换。流程目标是：先把「事实源 + 凭据 + 索引 + ACL」全部就绪，再让 Agent 接入。

1. 收集连接信息：确认目标数据库类型、host、port、database / catalog、schemas、目标表清单。
2. 创建只读账号：生产库必须使用真只读账号；`SELECT` 权限只授予目标 schema / 表。
3. 创建 secret 文件或环境变量：见下方「本地开发路径」或「Docker / customer-config 路径」。
4. 编辑 `ktx.yaml`：使用通用模板填入 connection 块（见「连接形态与配置字段」的通用模板）。
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

# 从宿主机把密码文件灌进容器
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
| `/connections/enabled-tables` | 只出现本地 manifest 中可选表；启用表范围与 `enabled_tables` 对齐 |
| `/admin/roles` 或 `access.yaml` | role 已授权新连接和目标表 |
| `/admin/audit` | MCP smoke 的 allow / deny 记录可追溯 |

> WebUI 的「刷新本地目录」只重新读取 `ktx.yaml` 与 `semantic-layer/**` YAML。它不会连接物理数据库扫描新表，也不会替代 `ktx ingest` 或受控 manifest 上传。
> 物理库扫描、列变更、Doris / StarRocks 形态识别都靠 `ktx ingest` 或受控 Manifest 上传；新增连接、换驱动、加表后必须在授权数据流下重跑 `ktx ingest` + `ktx admin reindex --force`，或先上传 Manifest 再 reindex，然后回 WebUI 点「刷新本地目录」。

#### Agent 可见性与 ACL 同步

新增连接后，Agent 是否可见由两层配置共同决定，缺一不可：

| 层 | 配置文件 | 控制内容 |
| --- | --- | --- |
| 连接层 | `ktx.yaml` | connection、Schema、`enabled_tables`、secret 路径 |
| 治理层 | `webui/config/access.yaml` | role 的 `allow.connections`、`tableSelectors` 或 `source_scope: catalog_bound`、`tools` |

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

运维数据面预置角色 `lucy_admin`（Spec 131）使用 `source_scope: catalog_bound`，**不是** WebUI 登录账户：

```yaml
roles:
  lucy_admin:
    description: 平台运维数据面（非 WebUI 登录账户）
    permission_model_version: 2
    allow:
      connections:
        - "*"
      source_scope: catalog_bound
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        # …显式工具清单；禁止 *
```

| Role 类型 | 同连接新增启用表 | 新增 connection |
| --- | --- | --- |
| `tableSelectors.names` | 必须改 `tableSelectors` | 必须改 `allow.connections` + selectors |
| `lucy_admin` | 写入 `enabled_tables` 并完成语义层 + 策略重编译即可（有 `policy_scope_expanded`） | 新连接在策略重编译后自动进入 |
| 其他 `catalog_bound` | 写入 `enabled_tables` 并完成语义层 + 策略重编译即可（有 `policy_scope_expanded`） | **仍必须**写入 `allow.connections` |

新增连接后必须做的同步动作：

| 动作 | 入口 | 落点 |
| --- | --- | --- |
| 在 `access.yaml` 把新连接加进 role | 编辑 YAML 或 WebUI `/admin/roles` | `roles.<role>.allow.connections` |
| 在 `access.yaml` 把新增表加进 role（`names` Role） | 编辑 YAML 或 WebUI `/admin/roles` | `roles.<role>.allow.tableSelectors` |
| `catalog_bound` Role：确认新表已在 `enabled_tables` | `/connections/enabled-tables` | `ktx.yaml`；无需改 names |
| 确认 role 的 `tools` 列表仍含 `lucy_*` 工具 | 编辑 YAML 或 WebUI `/admin/roles` | `roles.<role>.allow.tools` |
| Proxy / MCP 重新加载配置 | 改完保存即生效；如未生效，重启 Proxy | 同进程 Fastify / 容器重启 |
| 跑最小 smoke | `lucy_catalog` + 一条只读 query | 写到 `LUCY_AUDIT_DB` |

常见失败原因（与 `/admin/audit` 决策 reason 对应）：

| 症状 | 首查位置 | 处理 |
| --- | --- | --- |
| WebUI 看不到新连接 | `ktx.yaml`、环境变量 `KTX_PROJECT_ROOT`、容器挂载路径 | 确认运行时实际加载的配置根 |
| 连通测试失败 | host / port / 网络 / 只读账号 / secret 文件路径 | 容器内跑 `ktx connection test`；不要只在宿主机验证 |
| 提示缺失 Manifest | `semantic-layer/<conn>/_schema/<schema>.yaml` | 跑 `ktx ingest` 或上传受控 manifest，再刷新本地目录 |
| 目标表无法纳入启用表范围 | manifest 未包含目标表 | 检查 manifest 内容和 `enabled_tables` 拼写 |
| Agent 看不到新连接 | `webui/config/access.yaml` role | 同步 `connections` 与 `tableSelectors`；等待缓存刷新或重启 Proxy |
| 查询被拒 | `/admin/audit` decision reason | 按下表 `reason` 分类处理 |

| decision_reason | 含义 | 处理 |
| --- | --- | --- |
| `unknown_or_forbidden_connection:<conn>` | connection 缺失或未授权 | 在 role 的 `allow.connections` 加上该 connection |
| `table_forbidden:<table>` | 请求表不在授权范围 | 在 role 的 `allow.tableSelectors` 加上该表 |
| `tool_forbidden` / `tool_forbidden_global` | role 未授权该工具，或命中全局 deny | 调整 `allow.tools` 或 `defaults.deny_tools` |
| `raw_query_forbidden` | `lucy_query` 传入了原始 SQL | 改用 measure / dimension 形式；只在受控场景下用 `lucy_read_source` |

排障命令：

```bash
# 1. 看 access.yaml 是否包含新连接与表
rg -n "roles:|tableSelectors|tools|<connection-id>|<role-id>" webui/config/access.yaml

# 2. 看最近拒绝记录
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=20"

# 3. 看 connection 是否被加载
ktx --project-dir <PROJECT_ROOT> connection list
```

### 3.3 业务上下文 · 语义层

入口：`/catalog` 语义资产、`/catalog/:conn/:schema/:table` 单表编辑、`/joins/:conn/:schema/:table` 关联关系。

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
5. `/publish/workbench` 查看本次 changed files，并可运行 `Validate changed`。

CLI 验证：

```bash
ktx sl validate superstore_orders --connection-id mysql-aliyun
ktx sl read superstore_orders --connection-id mysql-aliyun
ktx --project-dir <PROJECT_ROOT> admin reindex
```

说明：编辑 YAML 后，`MCP` / `KTX` 检索通常读本地 SQLite 索引；需要让 Agent 搜到新口径时，执行 `ktx admin reindex`。

#### 语义状态与启用表范围状态

`/catalog` 的「语义状态」和 `/connections/enabled-tables` 的「状态」共用 `GET /api/sources` 的 `completion`，但列名回答的问题不同。

| 页面与列 | 回答的问题 | 取值 |
| --- | --- | --- |
| `/catalog`「语义状态」 | 这张表的语义 `YAML` 写到哪了 | `not_started` 未开始、`partial` 部分完成、`done` 已完成、`validation_failed` 校验失败 |
| `/connections/enabled-tables`「状态」 | 有没有进入启用表范围，再叠上完成度 | 先看 `enabled_tables` 勾选 / 草稿 / 无效启用；已启用后再看是否 `done` |

「有没有启用」在语义资产页是另一枚徽章：未进 `enabled_tables` 的表，表名旁标「未启用」，不改「语义状态」列。默认列表只展示已启用表。

同一张已启用且出现在本地 `Manifest` 的表：

| `/catalog` 语义状态 | `/connections/enabled-tables` 状态 |
| --- | --- |
| 未开始 / 部分完成 / 校验失败 | 已启用，待补语义 |
| 已完成 | 已启用，语义完成 |

启用表范围页还会出现草稿与异常态：「待启用」「待禁用」「无效启用」（在 `enabled_tables` 里但本地没有 `Manifest`）。未启用行不展示完成度。

`/overview`「语义覆盖 / N 张表待补语义」用启用表范围这套口径：已启用 ∩ `Manifest`，且 `completion !== done`。`done` 门槛见 [系统概览待处理事项](#overview-action-required)。

#### 为什么要编写语义 YAML

语义层 `YAML` 不是普通配置文件，而是团队与 `Agent` 共同遵守的**可执行分析契约**：

| 概念 | 含义 | 在 Lucy 中的落点 |
| --- | --- | --- |
| 上下文即代码 | `semantic-layer/` 与 `wiki/` 以 Git 可审阅的文件存在，可 diff、可合并 | `WebUI` 保存走 dryRun diff；`/publish/workbench` 查看变更 |
| 可执行语义 | `Agent` 使用已批准的 `measures`、`joins`、`segments`，而不是每次从零拼 `SQL` | `lucy_query` 编译语义查询 |
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

overlay 在 manifest 之上增量声明业务语义。完整字段表见 [3.7.0 overlay 字段速查（编写辅导）](#yaml-overlay-field-guide) 与 [KTX Writing Context](https://docs.kaelio.com/ktx/docs/guides/writing-context)。

| 组件 | 常用字段 | 说明 |
| --- | --- | --- |
| 列 | `visibility: public / internal / hidden` | `hidden` 列不参与 `Agent` 列表 |
| measure | `filter` | 仅作用于该 measure 的 `SQL` 谓词 |
| join | `alias` | 重复 join 同一目标时区分别名 |
| 派生列 | `columns[].expr` | 必须有 `expr`；不要与 manifest 物理列重名 |

Lucy 与上游 `KTX` 文档的一个关键差异：人工描述写入 `descriptions.human`（不是 `descriptions.user`）；物理列用复数 `descriptions:`，measure / segment 用单数 `description:`。

#### KTX 官方延伸阅读

本节只链外部权威文档，避免与 `KTX` 官方文档双维护。架构与字段细节以官方为准；Lucy 特有的 manifest / overlay 边界仍以本节与 [3.7 YAML 规范与交付验收](#yaml-delivery-standard) 为准。

| 主题 | 建议阅读 | 官方 URL |
| --- | --- | --- |
| 产品定位与双面向架构 | Introduction | https://docs.kaelio.com/ktx/docs/getting-started/introduction |
| 首次安装与 ingest | Quickstart | https://docs.kaelio.com/ktx/docs/getting-started/quickstart |
| 语义 source 与 Wiki 编写 | Writing Context | https://docs.kaelio.com/ktx/docs/guides/writing-context |
| 编译器、join 图与 fanout | Semantic Layer Internals | https://docs.kaelio.com/ktx/docs/concepts/semantic-layer-internals |
| `ktx.yaml` 项目配置 | ktx.yaml reference | https://docs.kaelio.com/ktx/docs/configuration/ktx-yaml |
| `ktx sl` / `validate` / `query` | CLI Reference | https://docs.kaelio.com/ktx/docs/cli-reference |

#### 语义资产范围树（连接与 Schema）

入口：`/catalog`。本节说明该页在 Spec 152 之后的定位方式。

`/catalog` 改为**左侧目录树（连接与 Schema 范围树）+ 右侧语义资产表格**的双栏工作区，用于跨多个连接与 `Schema` 定位语义资产。

**破坏性变更提示**：右侧原有的「连接筛选」与「Schema 筛选」下拉**已移除**，改由左树承担同样的范围选择职责。旧的筛选方式不再可用。

树结构为三层：「全部连接」根节点 → `Connection` 节点 → `Schema` 叶节点，按 `/api/sources` 中的首次出现顺序展示。不含 `Table` 层节点。

| 操作 | 效果 |
| --- | --- |
| 选择根节点 | 清除 `connection` 与 `schema` |
| 选择 `Connection` | 写入 `connection`、清除 `schema`，并展开该分支 |
| 选择 `Schema` | 写入对应的 `connection` 与 `schema`，并展开父 `Connection` |
| 点击展开 / 收起 | 只改变本地展开状态，**不修改 URL，也不改变筛选** |

展开状态默认行为：没有位置深链时所有 `Connection` 初始收起；有有效的 `connection` / `schema` 深链时自动展开所在 `Connection`，之后允许手动收起。**展开状态不持久化**，刷新页面回到默认。

节点计数跟随 `scope`（启用范围）、`completion`（语义状态）与 `q`（搜索）筛选变化，但**不受当前选中的 `Connection` / `Schema` 影响**——这样可以对照「该连接下还剩多少未完成」。计数为 0 的节点仍然展示且可选择。

左树是工作区内的范围选择器，**不是**与全局侧栏等价的第二导航；左树不提供独立搜索，请在右侧表格用搜索框过滤。

`connection` 与 `schema` 仍是 `URL` 上的筛选事实源，页面刷新或分享链接可还原位置。`Connection` 名、`Schema` 名与表名在页面上做了浏览器翻译防御。

本节描述的范围树不适用于「启用表范围」页，也不改变表语义编辑器的行为。

### 3.4 业务上下文 · Wiki

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
  - docs/runbooks/mysql-comment-maintenance.md
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
| 从 Wiki 返回表 | `sl_refs` chip 链到 `/catalog/:conn/:schema/:table` |

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

### 3.5 访问治理 · 角色 / Agent / Token

本节聚焦「角色 / Agent / Token」三层对象关系，先建决策，再打开对应页面；问询记录、break-glass、审计冷热库、`WebUI` 管理员登录等仍在本节内按 H4 查阅。侧栏分组按访问治理主题将这些 H4 与第 3.8 / 3.10 / 3.11 节共用，但深链与正文位置稳定。

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| Agent 实例 | `/admin/agents` | 创建/禁用 Agent、查看 token 与最近调用 |
| Role 配置 | `/admin/roles` | 管理 role 权限模板和 YAML role |
| 访问日志 | `/admin/audit` | 按用户、工具、source、trace、outcome 查询 |
| MCP 调试台 | `/admin/mcp-playground` | 检查 `Agent` 能不能连上，或者能不能查某张表 |
| 数据源热力 | `/admin/audit-sources` | 查看 source/table 调用和拒绝分布 |
| 配置变更 | `/admin/config-audit` | 查看 `access.yaml`、`ktx.yaml`、`admins.yaml` 等配置变更 |
| 管理员 | `/admin/admins` | WebUI 登录账户（所有者 / 运维）；仅所有者可增删账户 |

权威配置：

| 文件 | 用途 |
| --- | --- |
| `webui/config/access.yaml` | Agent / Role / MCP `Token` ACL（数据面） |
| `webui/config/admins.yaml` | WebUI 登录账户（控制面；scrypt 密码哈希；无明文） |

#### 什么时候配置角色、Agent 和 Token

深链：`/help?section=admin-role-agent-token-guide`。

访问治理最容易踩的坑，不是「页面在哪」，而是**把三层对象配错层**：该改权限边界时却去发凭证，或同一人每换一台电脑就新建一个 `Agent`。本节按管理员日常决策写：先选对对象，再打开对应页面。

#### 先建立三层对象关系

| 你要解决的问题 | 配什么 | 打开哪里 | 一句话 |
| --- | --- | --- | --- |
| 「这一类人/机器人，能看哪些连接和表、能调哪些 `MCP` 工具？」 | **角色权限**（`Role`） | `/admin/roles` | 可复用的权限边界；被多个 `Agent` 引用 |
| 「张三 / 评测机器人，要对哪次调用负责？」 | **`Agent`** | `/admin/agents` | 接入主体与审计身份；绑定一个或多个角色 |
| 「这台电脑 / 这个 Codex，拿什么 Token 连上 Lucy？」 | **`Token`** | `Agent` 详情 → Token | 接入凭证；同一 `Agent` 下多个 `Token` **权限相同** |

产品口径：**一人一 `Agent`、一 `MCP`；多 `Token` 只负责鉴权，不改变权限。**  
`WebUI` 登录账户（所有者 / 运维）与 `MCP` `Agent` / `Token` 是两套体系，不要混用。

#### 什么时候该配角色

在「权限边界要复用，或要对一类职责做统一收紧/放开」时配角色。

**适合：**

- 新业务域或新连接要对一类使用者开放（如财务只读、评测只读）
- 多个人 / 多个 `Agent` 应共享同一套表范围与工具清单
- 要统一改权：改一次角色，所有引用它的 `Agent` 一起生效
- 需要行级策略时：写在角色上（不要试图用 `Token` 区分行域）

**不适合：**

- 仅为某台笔记本单独开权限 → 发 `Token`，不要为设备造角色
- 把角色当成「某个人」或「`WebUI` 登录名」 → 那是 `Agent` / 登录账户的事

**做法建议：** 角色标识用业务含义（如 `kx_readonly`），写清说明；工具显式列举，禁止 `*`；表尽量精确到表名。正式角色优先；参考模板只用于「复制后改成正式角色」，不要直接当线上权限源。有 `Agent` 引用时先改绑定再删角色。

#### 什么时候该配 Agent

在「有一个要对审计负责的接入主体」时配 `Agent`。

**适合：**

- 新同事或新团队开始用 Lucy 做数据问答
- 独立业务机器人（评测、值班）需要单独身份与日志
- 同一人需要两套互斥权限边界（如日常只读 vs 含敏感表）→ **两个 `Agent`**，各绑不同角色

**不适合：**

- 同一人多设备 / 多客户端（笔记本、台式机、Cursor、Codex）→ **一个 `Agent`，多个 `Token`**
- 只想临时试调 `MCP` → 优先用 `/admin/mcp-playground` 受控试调；正式交付再为负责人建 `Agent`

**做法建议：** 新建时必须先选好角色，并看清权限预览再保存。人级再收紧用 `Agent` 强制约束（与角色行授予做交集），不要把「只给张三更严」写进全组共用角色。离职或下线：先禁用 → 撤销全部 `Token` → 再删除。

#### 什么时候该配 Token

在「某个客户端要真正连上 `MCP`」时配 `Token`。

**适合：**

- 新设备或新客户端首次接入
- 怀疑泄露、长期未用、人员交接 → 新建并撤销旧 `Token`（轮换）
- 新建客户端凭据 → 必须设置 `expires_at`；管理页默认 90 天，最长 365 天

**不适合：**

- 用不同 `Token` 表达不同权限（当前模型下同 `Agent` 同权；需要隔离就拆 `Agent`）
- 把 `Token` 当 `WebUI` 登录密码，或把 `KTX_INTERNAL_TOKEN` 发给外部客户端

**做法建议：** 明文只在创建时出现一次，立刻放进客户端凭据库，不要进仓库或长期聊天记录。一设备（或一客户端）一个 `Token`，用标签 / 设备名备注区分。列表页「复制 `MCP` 配置」只含占位符，不要二次粘贴历史明文。到期后 Proxy 会 401；仍建议在 Admin 显式撤销，避免配置残留。

#### 场景速查

| 你遇到的情况 | 配 / 改什么 |
| --- | --- |
| 「财务只读能查哪些表、哪些工具」变了 | 改 **角色** |
| 「张三要开始用 Lucy」 | 建 **`Agent`**（绑已有角色）+ 签发 **`Token`** |
| 「张三换了电脑 / 新开 Cursor」 | 只加 **`Token`** |
| 「张三比同组其他人少看一张敏感表」 | 用更窄角色，或在该 `Agent` 上加强制约束；**不是**发特殊 `Token` |
| 「这台机器的 Token 可能泄露」 | **撤销**该 `Token` 并重发 |
| 「评测机器人整体下线」 | **禁用** `Agent` 并撤光其 `Token` |

#### 推荐操作顺序

```text
连接 / 语义 / 启用表已就绪
        ↓
① 配置角色（权限边界）     →  /admin/roles
        ↓
② 创建 Agent 并绑定角色     →  /admin/agents
        ↓
③ 为 Agent 签发 Token      →  Agent 详情 → Token
        ↓
④ 客户端配置 MCP URL + Bearer →  smoke；在 /admin/audit 确认 allow
```

日常扩权：改角色（或给 `Agent` 加角色）→ 用权限预览 / `MCP` 调试台确认 → **新开** `MCP` session（旧 session 不会自动刷新 Visible Scope）。  
日常新电脑：只新建 `Token`，不要新建角色或 `Agent`。

#### 常见误区

1. 每个设备建一个 `Agent` → 审计碎片化；应一 `Agent` 多 `Token`。
2. 每个 `Agent` 手搓一份私有权限、从不建角色 → 改权成本高、边界易漂移。
3. 指望 `Token` 做表级 / 行级差异 → 当前不支持；需要隔离就拆 `Agent`。
4. 改完角色后旧客户端仍拒访 → 扩权后需新开 session。
5. 把 `WebUI` 登录与 `MCP` `Bearer` 混用 → 两套凭证，互不登录对方系统。

YAML 结构、签发规则与裁决链路见本节后续三节：[Role-first 模型](#role-first-model)、[Token 发行规则](#token-issuance-policy)、[权限裁决机制](#permission-decision-flow)；调用与审计留痕见 [问题簇审计](#question-cluster-audit)。客户端粘贴配置见 [4. Agent / 客户端接入指南](#mcp-integration)。

#### 问询记录与调用流水怎么选、怎么导出

深链：`/help?section=admin-audit-turns-vs-calls`。

访问日志有两个审计粒度：**问询记录**用于看一次用户问询的整体链路，**调用流水**用于看单次工具调用的取证细节。两者通过「问询 ID」关联。

```text
1 条问询记录 -> N 条调用流水
```

| 要回答的问题 | 看哪个页签 | 用哪个导出 | 一行代表什么 |
| --- | --- | --- | --- |
| 用户问了什么、整体是否成功？ | 问询记录 | 导出问询记录 | 一次用户问询 |
| 这次问询涉及哪些表、用了几个工具、有没有慢调用？ | 问询记录 | 导出问询记录 | 一次用户问询 |
| 哪个工具调用失败、被拒或变慢？ | 调用流水 | 导出调用流水 | 一次工具调用 |
| 要看裁决原因、访问上下文或生成 SQL？ | 调用流水 | 导出调用流水 | 一次工具调用 |
| 要做离线审计闭环与完整性对账？ | 调用流水 / 审计证据包 | 导出审计证据包 | 多个审计文件 + Manifest |

导出时遵循当前筛选条件。「导出问询记录」保留来源标记：`用户原始问询` 来自客户端上报，`系统推断问询` 来自调用流水聚类；不要把推断问询当作用户原文。「导出调用流水」沿用 `access_log` 明细字段，包含工具、裁决原因、生成 SQL、访问上下文、`request_id` 与 `trace_id` 等事件级信息。

CSV 文件名带秒级时间戳和流水号，避免浏览器生成 `(1)` 这类不可审计版本名：

| 导出 | 文件名样式 |
| --- | --- |
| 导出问询记录 | `audit-turns-YYYYMMDD-HHmmss-000001.csv` |
| 导出调用流水 | `audit-calls-YYYYMMDD-HHmmss-000001.csv` |
| 字段说明 | `audit-turns-fields-YYYYMMDD-HHmmss-000001.json` / `audit-calls-fields-YYYYMMDD-HHmmss-000001.json` |

时间字段采用双轨：`本地时间` 使用 `Asia/Shanghai` 的 `YYYY-MM-DD HH:mm:ss`，方便人工阅读和 Excel 解析；`UTC` 原始字段保留用于跨时区对账、证据复核和脚本处理。调用流水 CSV 中 `ts` 是原始 UTC，`ts_local` 是本地时间；问询记录 CSV 中「开始时间」「结束时间」是本地时间，「开始时间 UTC」「结束时间 UTC」是原始值。

页面上的「字段说明」会下载当前页签对应的 JSON 元数据，解释每一列的含义、格式和触发条件。正式离线审计仍优先下载「导出审计证据包」，字段说明用于帮助人工 review 单个 CSV。

排查建议：

1. 先在「问询记录」找到异常问询，复制「问询 ID」。
2. 切到「调用流水」用同一个「问询 ID」筛选。
3. 查看具体事件的工具、裁决原因、生成 SQL 和耗时。
4. 需要离线复核时，同时导出问询记录与调用流水；正式审计再导出审计证据包。

#### WebUI 管理员登录

Lucy 是自托管控制面：管理面登录与 SaaS「邮箱注册 / 邮箱找回」不同。控制面账户只有两级（与 MCP Agent Role 无关）：

| 角色 id | UI 主术语 | 日常职责 | 不能做 |
| --- | --- | --- | --- |
| `owner` | 所有者 | 全部 WebUI 日常工作 + **登录账户治理**（增删改其他登录账户、指定所有者） | — |
| `operator` | 运维 | 连接、语义 / Wiki / 发布、质量评测、Agent / Role / Token、访问日志与配置审计 | 管理其他 WebUI 登录账户 |

权限矩阵（控制面）：

| 能力 | 所有者 | 运维 |
| --- | --- | --- |
| 数据库连接 / 启用表 / ingest | ✓ | ✓ |
| 语义层 / Wiki / 发布工作台 | ✓ | ✓ |
| 评测用例 / 运行 / 趋势监控 | ✓ | ✓ |
| Agent、Role（`access.yaml`）、Token 发行与撤销 | ✓ | ✓ |
| 访问日志 / 配置审计 / MCP 调试台 | ✓ | ✓ |
| `/admin/admins` 登录账户增删改 | ✓ | ✗ |

说明：运维即可完成「连接、配置语义、质量评测、添加和管理 Agent Role」等日常工作；所有者额外负责控制面账户与 break-glass 相关治理。旧配置里的 `role: admin` 读入时等价于 `operator`。

| 模式 | 条件 | 行为 |
| --- | --- | --- |
| 开放（`open`） | 无启用中的登录账户，且未设 `LUCY_WEBUI_AUTH=required` | 不强制登录；配置审计 actor 为「本机管理员」 |
| 引导（`bootstrap`） | 无启用中的登录账户，且 `LUCY_WEBUI_AUTH=required` | 打开 `/login` 创建首个**所有者** |
| 需登录（`required`） | 至少一名启用登录账户 | 除公开路由外需有效会话 Cookie |

推荐正式部署：

1. 设置 `LUCY_WEBUI_AUTH=required`（可选同时设置 `LUCY_WEBUI_SESSION_SECRET`）。
2. 打开 `/login`，创建首个所有者（登录账户 + 密码，至少 10 字符）。
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

#### Role-first 模型

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

#### Token 发行规则

| 操作 | 行为 |
| --- | --- |
| 新建 token | 生成 32 字节随机明文；必须设置 `expires_at`（默认 90 天、最长 365 天）；HTTP 响应只显示一次且禁止缓存 |
| 落盘 | `access.yaml` 只保存 `sha256:<hex>` |
| 撤销 token | 先写 `.ktx-ui/audit.sqlite.revoked_tokens`，再从 YAML 删除 |
| 删除 Agent | 先撤销该 Agent 所有 token，再删除 YAML user |
| 复制 MCP 配置 | 只复制 `${LUCY_AGENT_TOKEN}` 占位符，不复制明文 |
| 过期 | `expires_at` 到期或不可解析时，`MCP` Proxy 鉴权失败（401）；也可在 Admin 提前撤销 |

注意：`expires_at` 由 Proxy 身份校验强制拒绝已过期 token。到期后仍建议在 Admin 执行撤销，或调用 `DELETE /api/admin/agents/:userId/tokens/:label`，避免配置残留。

#### 权限裁决机制

1. Bearer token 现场 `sha256`。
2. 与 `access.yaml` 中 token hash 匹配。
3. 检查 token 是否在 `revoked_tokens`。
4. 检查 `expires_at`（新建 Token 必填；仅历史配置缺省时按永不过期兼容读取，并应在上线前轮换）。
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
| `raw_query_forbidden` | `lucy_query` 传入原始 SQL |
| `explicit_table_required:<empty>` | 查询未显式引用可解析 source/table |
| `explicit_table_required:<table>` | 请求涉及敏感表，但没有显式声明该表 |
| `unknown_or_forbidden_connection:<conn>` | connection 缺失或未授权 |
| `sensitive_metadata_forbidden:kx` | 敏感元数据工具未获得完整敏感表授权 |
| `role_resolution_failed:<role>` | role 配置无法解析 |
| `query_concurrency_exceeded` | 单 token 并发 `lucy_query` 超限 |
| `token_expired` | token 已过期或 `expires_at` 不可解析 |

#### 问题簇审计

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

访问日志与 Trace / Evidence 采用分层存储。运维主路径（Spec 125）：热库明文保存 **生成 SQL**，调用流水列表与 CSV 直接展示，便于定期 review 准确性。深链：`/help?section=admin-audit-hot-cold-store`。

| | 热库（Spec 125 主路径） | 查询原文冷存（Spec 124 legacy） | 对象存储冷归档（规划） |
| --- | --- | --- | --- |
| 位置 | `.ktx-ui/audit.sqlite`（可用 `LUCY_AUDIT_DB` 覆盖） | `.ktx-ui/audit-cold/query-artifacts/`（可选） | 对象存储（S3 兼容） |
| 用途 | `/admin/audit` 即时查询、生成 SQL review、Trace 钻取 | 可选加密副本；非默认运维入口 | 长期留存 |
| SQL 相关 | **允许**：`generated_sql`（仅 `lucy_query` 编译结果）、`query_hash`、脱敏 `query_preview`（raw 场景）。**禁止**：raw query 攻击载荷写入 `generated_sql`、结果行、Token 明文 | AES-GCM 密文（legacy） | 规划中 |

**生成 SQL 如何出现在访问日志**

1. Proxy 对 `lucy_query` 始终向上游合并 `include: ["sql"]`。
2. 上游返回的编译 SQL 写入热库 `generated_sql`。
3. 打开 `/admin/audit` → 调用流水，列表列「生成 SQL」直接可见；CSV 导出含同列。
4. deny 的 raw `sql`/`query` **不会**写入 `generated_sql`（与 `raw_query_forbidden` 执行拦截无关）。

**哈希 vs 生成 SQL**

| | 哈希（`query_hash`） | 生成 SQL（`generated_sql`） |
| --- | --- | --- |
| 能否阅读正文 | 不能 | 能（热库明文） |
| 典型用途 | 去重 / 对照同异 | 运维 review 口径与编译正确性 |

**与质量评测的边界**

| 事实源 | 生成 / 完整 SQL | 说明 |
| --- | --- | --- |
| `.ktx-ui/audit.sqlite` | 是（仅 generated） | Spec 125 运维 review |
| `.ktx-ui/eval/runs.sqlite` | 是（runner 捕获时） | 与审计库隔离 |
| `/eval/security-candidates` | 否（仍基于脱敏摘要） | 安全评测候选不依赖全文 SQL |

Admin API 示例：

```bash
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=50"
curl -s "http://127.0.0.1:5174/api/admin/audit/turns?source=all&lookbackHours=24"
curl -s "http://127.0.0.1:5174/api/admin/audit/sources?hours=24"
```

#### Token 凭据（/admin/tokens）

入口：`/admin/tokens`（全局视图）或 `/admin/agents/:userId` 的 Token 区（按 Agent 视图）。本节聚焦 **Token 本身** 的签发、吊销、过期与配置复制；何时该配 Token 的三层决策见上文「什么时候配置角色、Agent 和 Token」。

**Token 的位置**

Token 是 **Agent 的接入凭证**，不是权限边界；同 Agent 下多个 Token 共享同一份角色绑定与可见 scope。要表达的「权限差异」必须落到 Agent / Role 层，不能用 Token 模拟（详见「什么时候该配 Token」末尾的边界）。`/admin/tokens` 提供「按设备 / 客户端维度」的清单，便于运维快速定位「这个 Key 谁在用」。

#### 签发

- 入口路径：从 `/admin/agents` 选中 Agent → Token 区；或从 `/admin/tokens` 选择 Agent 后一键签发。
- 必填项：`expires_at`（管理页默认 90 天，最长 365 天；空值表示长期有效，**不推荐**，会失去下文 `expires_at` 强制校验的硬拒绝兜底）。
- 可选项：标签 / 设备名（便于人工分辨；写明如 `forrest-mbp-cursor`、`eval-runner-2` 之类，**不要含明文 secret**）。
- 明文 Token **只出现一次**：签发后立刻复制到客户端凭据库 / secret store；不要进仓库、聊天记录、截图或 Wiki。

#### 吊销

- 单 Token 吊销：`/admin/tokens` 行内「撤销 Token」/ `/admin/agents/:userId` Token Tab 行的「撤销」按钮，确认后立即生效（缓存清空，下次请求 401）。
- Agent 全量吊销：Agent 详情 → 「撤销全部 Token」；用于离职 / 轮换场景。
- 过期 Token：**仍建议显式撤销**（即使已过期），避免配置残留与误用——下游脚本若还在引用过期 key 会立刻 401，而不是读到旧值混过去。

**过期强制（Spec 124 / Spec 07）**

Proxy 鉴权链路在 access 决策中**实际比对** `expires_at`，不再只是 metadata：

- 到期、可解析值越界、字段不可解析 → **硬拒绝 401**（Spec 124：`token_expired`），不是软警告。
- 正常解析：ISO-8601（`YYYY-MM-DD` 视作当天 UTC `23:59:59.999`）；不可解析一律按过期处理（fail-closed）。
- 客户端拿到新 Token 必须在配置文件同步替换；不要 reuse 老的 `${LUCY_AGENT_TOKEN}` 占位符值。

#### 复制 MCP 配置

`/admin/tokens` 列表里「复制 MCP 配置」按钮只产出**占位符**模板：

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

不会二次粘贴历史明文；不同客户端的格式细节（Codex / Claude Code / Hermes）见 [4. Agent / 客户端接入指南](#mcp-integration)。

**客户端标识头 `x-lucy-platform`（可选但推荐）**

客户端可在 MCP 请求里携带 `x-lucy-platform: <id>`，Proxy 把该值落到访问日志 `/admin/audit` 的客户端视角列，便于审计区分：

| 取值样例 | 含义 |
| --- | --- |
| `mcp-playground` | Lucy `/admin/mcp-playground` 受控试调 |
| `codex` / `claude-code` / `cursor` | Agent 客户端壳 |
| `hermes` / `claude-code-local` | 其它 HTTP MCP client |
| 缺省 / 未识别 | 落 `unknown`，仍记入访问日志 |

未配置该 header 不影响鉴权；只是审计维度变差。详见 `webui/server/proxy/mcp-proxy.ts` 的 `lucyPlatform` 归一化逻辑。

#### 边界与常见误用

| 误用 | 后果 | 替代做法 |
| --- | --- | --- |
| 用不同 Token 表达不同权限 | 当前模型下同 Agent 同权；Token 无法驱动可见 scope | 需要隔离就拆 Agent + 绑不同 Role |
| 把 Token 当 WebUI 登录密码 | 两套体系，互不登录对方系统 | 控制面看 [「WebUI 管理员登录」](#admin-webui-login) |
| 把 `KTX_INTERNAL_TOKEN` 发给外部 Agent | 上游信任链外泄 | 只用于 Lucy Proxy 调用 KTX upstream |
| 长期不设 `expires_at` | 失去强制轮换与硬拒绝兜底 | 至少 90 天默认；高敏感 30 天并配轮换脚本 |

**关联**

- 上文 [「什么时候配置角色、Agent 和 Token」](#admin-role-agent-token-guide) — 三层决策树
- 上文 [「什么时候该配 Token」](#when-to-configure-token) — 何时新建 / 轮换 / 撤销
- §3.5 [MCP 调试台（/admin/mcp-playground）](#mcp-playground) — 受控试调验证 Token / Role 链路；区分 `callSource=playground`
- §3.11 [MCP 会话与上游连接](#mcp-session-upstream) — Token + `Mcp-Session-Id` 在 MCP 握手层的关系
- §4 [Agent / 客户端接入指南](#mcp-integration) — 各客户端配置模板与 `LUCY_PUBLIC_MCP_URL` 取值

#### MCP 调试台（/admin/mcp-playground）

入口：`/admin/mcp-playground`。访问治理分组下，与访问日志 / 配置审计并列；侧栏位置见 [1.5 WebUI 入口速查](#webui-entry-map)。

调试台是 Agent 接入后的「试调环境」：在不创建正式 Agent / Token 的前提下，预览 ACL 裁决或对允许的工具做一次受控试调。它复用 Proxy 的 `acl.ts` 与 `decisionReasonLabel` 映射——本页得到的裁决结果与生产路径完全一致，仅在**写日志**与**真执行**两个动作上分流。

**两条路径的边界**

| 维度 | ACL 预览 | 受控试调 |
| --- | --- | --- |
| 写访问日志 | 否 | 是（`callSource=mcp-playground`） |
| 真正执行 | 否（仅预览裁决） | 是（仅允许的工具） |
| Token | 不需要；选中 Agent 即生效 | 借用选中 Agent 的 Token（仅会话内存，不落盘） |
| 裁决原因 | 中文主行 + 机器码次行（折叠） | 同左；成功为「{Agent}能连上」/失败为「{Agent}不能连上」 |
| 进入审计 | 否 | 是；通过「在访问日志中查看」按钮下钻 |
| 用途 | 试参数、对比 Role | 真打通本地 MCP endpoint 的最小 live smoke |

**裁决原因中文化**

上游 KTX 的 `decision_reason` 是机器码（`role_resolution_failed` / `tool_forbidden` / `table_forbidden:<name>` / `query_concurrency_exceeded` / `token_expired` 等），调试台在中文主行展示可读原因，次行折叠展示机器码便于精确排查。访问日志调用流水与 Drawer 已升级为同样的双行可读（`DecisionReasonCell`，Spec 99 §6.4）。允许结论不再重复写「允许执行」和 `allowed`；裁决卡用绿 / 红 / 黄三色诊断条表达结果。

**不嵌入 LLM / Token 不落盘**

- 所有裁决逻辑复用 Proxy 一致代码（`acl.ts`、`decisionReasonLabel`）；本页不引入新的裁决分支。
- Token 字段在 UI 仅显示占位符；粘贴的 Token 仅存于会话内存，不写盘、不发回服务端持久化。
- 不引入内嵌 LLM / Copilot；保持 Zero AI（Spec 66 另轨）。
- 受控试调**允许清单**：`tools/list`（必达）、`kx_catalog`；禁止 `lucy_query`、wiki 写、未知工具、用户指定 URL。

**从试调到审计**

受控试调成功后，裁决卡右下出现「查看访问日志」按钮，链到 `/admin/audit?view=calls&callSource=playground`（兼容旧 `?tab=calls`）。这一深链让运维一键把试调记录从真实调用里筛出来，对照 review。试调失败时不展示该按钮。

**常见用法**

| 你要验证的问题 | 走哪条路径 |
| --- | --- |
| 「这个 Agent 能不能调 `lucy_query`？」 | ACL 预览（不写日志，无副作用） |
| 「同一个 Token 调两次，分别能不能查到？」 | 受控试调（写入 `callSource=mcp-playground`） |
| 「换 role 后行为是否变化？」 | 两次 ACL 预览对比，不依赖试调 |
| 「接入后 Token 真的能打通本机 MCP 吗？」 | 受控试调 `tools/list`（必达 smoke） |
| 「denied 行的真实原因码是什么？」 | ACL 预览复制机器码，配合 `/admin/audit` 取证 |

**关联**

- §3.5 [什么时候配置角色、Agent 和 Token](#admin-role-agent-token-guide)：先建角色再建 Agent；调试台是建好 Agent 后的裁决验证面。
- §3.5 [Token 凭据（/admin/tokens）](#agent-tokens)：本台借用 Token 仅会话内存，不写盘；Token 生命周期归 Token 凭据管。
- §3.8 [角色列表与权限预览](#role-list-preview)：权限预览给的是「Role 层能调什么」，本台给的是「这个 Agent 在该 Role 下的具体裁决」。
- §3.11 [MCP 会话与上游连接](#mcp-session-upstream)：上游会话归属决定 `callSource` 在访问日志里的语义。
- §4 [Agent / 客户端接入指南](#mcp-integration)：调试台是接入指南的「试一下」按钮——任何 `tools/list` / `kx_catalog` 失败优先到这里复现。

权威 Spec：`webui/docs/99-mcp-playground-acl-decision-visibility-spec.md`。

### 3.6 质量评测

入口：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 评测用例 | `/eval/cases` | 查看 domain 与用例 |
| 评测用例编辑 | `/eval/cases/:domain/:caseId` | 编辑 YAML 用例，支持 dryRun diff |
| 运行历史 | `/eval/runs` | 查看运行列表 |
| 运行详情 | `/eval/runs/:runId` | 查看逐用例结果、artifact、compare |
| 趋势监控 | `/eval/monitor` | 通过率趋势、没答出来计数、现场区块、阈值 |
| 现场提问 | `/eval/field-questions` | 审定反复出现的业务问法；权限拒绝仍在安全评测候选 |

客户路径是维护套件、离线跑批、上传结果。离线跑批命令：

```bash
npx tsx webui/server/eval/offline-batch-main.ts --suite evals/<domain>/eval/<domain>-eval-cases.yaml --as-of YYYY-MM-DD --role-id <绑定角色> --output result.json
```

评测用例文件约定：

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
| 入库 | `.ktx-ui/eval/runs.sqlite` 或 `LUCY_EVAL_DB`（与审计库隔离；runner 捕获的 `SQL` 可写入 run case。生产访问日志的生成 SQL 见 Spec 125 / [审计热库与冷库（SQL 留存边界）](#审计热库与冷库sql-留存边界)） |
| 产物 | run artifact 和 markdown summary |
| 分类 | `pass`、`logic_regression`、`tool_error`、`schema_drift`、`data_drift` |

#### 现场提问（/eval/field-questions）

本节为 §3.6 第一个 H4 子节。**现场提问**是从访问日志聚类出来的、用户反复问的业务问法，审定后可收成评测用例。它把「用户真实在问什么」反馈回数据治理者，让 `evals/<domain>/eval/<domain>-eval-cases.yaml` 不只依赖离线套件与专家手写，而是被真实访问流量持续校准。详见 [`webui/docs/161-offline-eval-customer-ops-spec.md`](webui/docs/161-offline-eval-customer-ops-spec.md) §8.3、§8.4、§10（事实源：`webui/src/pages/eval/FieldQuestions.tsx`）。

**聚类规则**

- 同一 `query_hash`（语义层编译结果）在 `[lookback_days]` 窗口内重复 ≥ N 次 → 进入候选池。
- 默认窗口 30 天，N = 5；两个值都可在页面顶部「窗口与阈值」过滤器里临时调整（不落库）。
- 分群键是权限快照 `resolved_json.sourceMapVersion` + `shapeHash`（规范化 JSON 的 sha256：指标名、维度字段、过滤字段排序，去掉过滤值、问句、客户版本字符串）+ `failureClass`。
- 聚类只看语义化后的 `query_hash` / `summary`，**不**保存用户原文——保护 PII，也避免 raw 攻击载荷写入 `evidence_json`。
- 推断问询的工具调用数大于 50 时，按 `shapeHash` 拆开再进入分组（同一轮推断问询可能叠了多次查法）；调用数为 0 的推断问询直接丢弃。
- 权限拒绝 / 成功调用都不进入本函数——它们走 `/eval/security-candidates`（deny）或不上榜（success 但未达阈值）。

**三态生命周期**

| 状态 | 含义 | 写入位置 |
| --- | --- | --- |
| `candidate` | 刚聚类出来，未审定 | `.ktx-ui/eval/field_question` 表 |
| `promoted` | 已采纳，已收成评测用例草稿 | `evals/<domain>/eval/<domain>-eval-cases.yaml`（人在编辑器保存） |
| `ignored` | 明确不要这条用例 | 同 `candidate`，仅 `status` 与 `updated_at` 变化 |

**操作路径**

页面顶部固定「窗口与阈值」过滤器（窗口、命中次数下限、domain），下方表格列：`summary`（脱敏摘要，由失败类 + 指标名生成，例如「查 spend 时，这个指标还没绑到数据源」）、`hit_count`、`first_seen_on` / `last_seen_on`、所属 domain 与 `role_ids_json`、相关 source / measure（仅字段名，不带过滤值）、Actions。

每行三个动作：

- **查看访问日志**：深链 `/admin/audit?outcome=success&queryHash=<hash>`，只看命中同一 hash 的成功调用（deny 不会同时上榜）。
- **收成评测用例**：弹预检抽屉，预览将生成的 YAML case（含 `query`（待人写）、`expected_measures`、`expected_dimensions`、`expected_filters` 的字段名），确认后 `POST /api/eval/field-questions/:id/promote` 返回草稿，**不直接写盘**。
- **忽略**：写一行 `note` 即可，不需要 reviewer evidence。

**采纳预检**

- 预览 YAML 草案的字段结构（`query` 留空必须由人写；过滤值与客户版本字符串不出现）。
- 标注目标 domain（自动从语义层解析；解析失败需手工选择 `superstore` / `kx_financial` / `data_agent_poc` 等已注册 domain）。
- 确认后才 `POST /api/eval/field-questions/:id/promote`；服务返回草稿，人在 `/eval/cases/:domain/:caseId` 编辑保存。
- 候选采纳**不**自动触发评测运行；评测用例保存后，需到 `/eval/runs` 手动跑批（离线跑批命令见 §3.6 主体）。

**与 §3.6 评测用例的双向同步**

- 已采纳的 case 自动出现在 `/eval/cases` 对应 domain 下；`from_field_question: true` 标识其来源。
- 在 `/eval/cases` 看到 `from_field_question: true` 的 case，可一键「返回现场提问」——回到原始 `field_question` 行，关闭其在评测套件中的对应条目（不删除评测用例，保留版本历史）。

**边界**

- 现场提问只基于脱敏摘要，**不**保存用户原文、过滤值、客户版本字符串。
- 与安全评测候选共享访问日志源但分流：`outcome = success` + 未达阈值 → 不上榜；`outcome = success` + 达阈值 → 现场提问；`outcome = denied` → 安全评测候选。一条访问最多入选一个池子。
- 候选采纳**不**自动触发评测运行，需到 `/eval/runs` 手动跑。
- `splitInferredTurns` 的阈值（50 次调用）写在服务端常量，页面不提供调节；规则变更须改 Spec 161。

#### 安全评测候选（/eval/security-candidates）

本节是 §3.6 第二个 H4 子节。**安全评测候选**从访问**拒绝**日志里提取权限与数据隔离场景，审定后转为安全评测用例。它和现场提问共享访问日志源但分流：同一访问要么 success 要么 denied，不会同时入选两边。详见 [`webui/docs/65-safe-log-to-eval-spec.md`](webui/docs/65-safe-log-to-eval-spec.md)（事实源：`webui/src/pages/eval/SecurityCandidates.tsx`）。

**聚类规则**

- 同一 `decision_reason`（中文或机器码，例如 `tool_forbidden_global` / `table_forbidden:*` / `raw_query_forbidden` / `sensitive_metadata_forbidden:*` / `unknown_or_forbidden_connection:*`）在 `[lookback_days]` 窗口内重复 ≥ M 次。
- 默认窗口 30 天，M = 3（页面顶部可调，不落库）。
- 提取 `role` / `agent` / `table` / `tool` / `token_hash_prefix` 维度组合作为分群键。
- **不**带原始 `sql` / `query`——deny 路径不存攻击载荷，避免把拒绝事件本身变成新的攻击面。
- Redaction fail-closed：高熵凭据串 / 已知 token、secret、API key 签名 → 候选直接 reject，不进入审阅。

**典型场景**

| 候选类型 | 来源 reason | 风险档 |
| --- | --- | --- |
| forbidden tool 回归 | `tool_forbidden_global` | P0 |
| 越权访问敏感表 | `table_forbidden:*` | P0 |
| 未授权 connection | `unknown_or_forbidden_connection:*` | P0 |
| raw SQL 路径尝试 | `raw_query_forbidden` | P0 |
| 敏感元数据工具越权 | `sensitive_metadata_forbidden:*` | P0 |
| 反复出现的权限相关上游错误 | `upstream_permission_error` 等 | P1 |
| 审阅人标注的可疑成功访问 | 人工标记 | P1 / P0 |

**三态生命周期**

| 状态 | 含义 | 备注 |
| --- | --- | --- |
| `candidate` | 刚抽取出来，等待审阅 | 落 `.ktx-ui/eval/security_eval_candidate` 表 |
| `accepted` | reviewer evidence 已签发，等待晋升 | 走 `POST /api/eval/security-candidates/:id/promote/preview` |
| `promoted` | 已晋升为 P0 安全评测用例 | 写 `evals/<domain>/eval/<domain>-security-cases.yaml` |
| `rejected` | 明确不要这条用例（分 redaction 拒 / 业务拒） | 同 `candidate`，仅 `status` 与 `updated_at` 变化 |

晋升必须先有 `accepted` 状态的 reviewer evidence（`security_eval_candidate_review` 表：审阅人 actor、`permission_boundary_confirmed` / `expected_denial_confirmed` / `business_context_confirmed` 三项勾选与 `note`），否则 promote 接口直接 fail——不接受未审阅候选晋升。

**采纳路径**

- `POST /api/eval/security-candidates/:id/promote/preview` 返回晋升后的 YAML diff（新增 / 改写 / 幂等字段）。
- 确认后再 `POST /api/eval/security-candidates/:id/promote` 写盘，目标文件独立于正常评测用例：`evals/<domain>/eval/<domain>-security-cases.yaml`。
- 与正常 case 走不同 Run 路径：安全 case 走 `gateKind = "security_eval_candidate_extraction"` 的 trace span，失败 → §3.5「MCP 调试台（/admin/mcp-playground）」ACL 预览排查；正常 case 走 `lucy_query` 编译 + 离线跑批。

**与 §3.5 访问治理的关联**

- 一条被采纳的安全 case 进评测后，会触发对应的 ACL 改进建议（关联到 §3.5 角色 / Agent / Token 的边界复核）。
- 安全 case 失败 → 进入 §3.5「MCP 调试台（/admin/mcp-playground）」ACL 预览排查，看同一 `role` + `table` + `tool` 在试调环境里的裁决是否一致。
- 与 §3.5「问询记录与调用流水怎么选、怎么导出」的 `outcome=denied` 视图共享同一审计热库（`.ktx-ui/audit.sqlite`），但本页面只展示脱敏摘要，不展示 raw `sql` / `query`。

**边界**

- 不展示 raw `sql` / `query`；只展示 `decision_reason`（中文）+ `role` / `agent` / `table` / `tool` / `token_hash_prefix`。
- 与 §3.6「现场提问（/eval/field-questions）」互斥——同一访问要么 success 要么 denied，不会同时入选两边。
- Redaction fail-closed：高熵凭据 / 已知 secret 签名 → 候选直接 reject，不进入审阅。
- Trace / Evidence 链路：抽取写 `span_type = "eval_run"` + `metadata.gateKind = "security_eval_candidate_extraction"`；晋升写 `evidence_events.relation = "promoted"`；拒绝写 `relation = "denied_by"`。

### 3.7 YAML 规范与交付验收

本节为人工配置人员、运维人员、Claude Code / Codex 等 Agent 检查者提供统一可执行的 YAML 交付 runbook。事故教训：分析师上传的语义 YAML 文件结构不符合 KTX/Lucy 的 manifest / overlay 合并模型，会让 MCP 侧无法提供正确问答。**`reindex` 成功、单个 `sl validate` 成功都不能单独作为交付成功依据。**

编写动机、推荐工作流、grain / fanout 说明见 [为什么要编写语义 YAML](#semantic-yaml-why)、[推荐编写工作流](#semantic-authoring-workflow)、[grain、join 与 fanout](#semantic-grain-fanout)；本节聚焦**交付分型与验收**。若用编码代理批量生成配置，先看 [配置作者 Skills](#config-author-skills)，再回到本节做验收。

#### 配置作者 Skills

面向分析师与交付侧：用 Claude Code / Codex / Cursor 等**编码代理**生成可导入 Lucy 的语义 YAML、业务 Wiki 与评测用例。本节只做发现入口与边界说明；完整 `SKILL.md`、模板与 lint 脚本以**配置作者 Skills 交付包**为准，不在系统手册内粘贴全文。

| 边界 | 说明 |
| --- | --- |
| 是什么 | 编码代理读取的作者工具包（`SKILL.md` + references + 校验脚本） |
| 不是什么 | 不是 Lucy MCP 问答运行时自动加载的 Skill；也不是 WebUI Skill Editor |
| 权威正文 | 交付包内各 Skill 的 `SKILL.md`；本手册只索引 |
| 验收仍看本章 | 生成成功 ≠ 可交付；必须过 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist) |

**落位（客户配置工程）**

把配置作者 Skills 文件夹放到 Lucy 工程根，与 `semantic-layer/` 平级（交付包 README 通常记为 `skills/`）。将交付包内的 `AGENTS.md` / `CLAUDE.md` 复制到工程根，供编码代理自动读取。开发仓内的对照实现常见于 `.cursor/skills/lucy-*-author`；勿与 MCP 问答运行时 Skill 混为一谈——按当次交付包 README 的目录约定放置。

```text
<lucy-project>/
  semantic-layer/
  wiki/
  evals/
  skills/                 ← 配置作者 Skills 包（以交付 README 为准）
    lucy-semantic-layer/
    lucy-semantic-author/
    lucy-wiki-author/
    lucy-eval-author/
    lucy-config-package/
```

**Skill 与产物**

| Skill | 写出 |
| --- | --- |
| `lucy-semantic-layer` | `semantic-layer/<connection>/` |
| `lucy-semantic-author` | 语义 YAML 契约细则（常与上一行一起用） |
| `lucy-wiki-author` | `wiki/global/`（或交付约定的 Wiki 目录） |
| `lucy-eval-author` | `evals/<domain>/eval/` |
| `lucy-config-package` | 上述全部的一键编排 |

**调用示例**

在工程根打开编码代理后：

```text
读取 skills/lucy-config-package/SKILL.md，
按 Lucy 规范一次生成语义 + Wiki + 评测用例，写完跑全包发布前检查。
```

只改语义层时：

```text
读取 skills/lucy-semantic-layer/SKILL.md，
按 Lucy 规范生成/更新 semantic-layer/<连接名>/ 下的 YAML，写完跑 lint。
```

**生成后必跑发布前检查（退出码非 0 不得声称完成）**

```bash
python3 skills/lucy-semantic-author/scripts/lint-semantic-yaml.py semantic-layer/<connectionId>
```

一次生成完整配置包时：

```bash
python3 skills/lucy-config-package/scripts/validate-lucy-package.py \
  --project-root . --connection-id <connectionId> --domain <domain>
```

发布前检查通过后，仍须按 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist) 完成 `sl read`、真实 query、`MCP smoke` 等运行时验收。禁止把密码写入任何 YAML；`semantic-layer/`、`wiki/`、`evals/` 是产物目录，不要塞进 Skills 包本身。

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
| 评测用例 | `evals/<domain>/eval/*-eval-cases.yaml` | 问答质量回归用例 | 测试 / 数据维护者 | 可以，但必须跑质量评测 |
| Access config | `webui/config/access.yaml` | Role、Agent、Token hash、ACL | 管理员 | 谨慎，必须确认权限快照 |

通用上传安全规则：

| 规则 | 说明 |
| --- | --- |
| 禁止上传真实凭据 | 手册、示例、commit message 严禁出现真实 host、username、password、token、cookie；统一用 `<CHANGE-ME-HOST>`、`<CHANGE-ME-USERNAME>`、`<CHANGE-ME-TOKEN>` |
| 走 `fs-safe` 允许清单 | 任何 WebUI 写入都走 `webui/server/fs-safe.ts`；手工 `cat > ...` 也要保证目标在允许目录内 |
| 不要混目录 | manifest 文件只能在 `_schema/`，overlay 只能在 `semantic-layer/<conn>/`；不要把 overlay 写进 `_schema/`，也不要新建一个存放语义表的目录 |
| 默认产物不写进 `webui/config/data-qa-instructions.md` | 数据问答运行时指导由 `webui/config/data-qa-instructions.md` 单独维护，与本节交付规则解耦 |
| 默认产物不写进 `CLAUDE.md` / `AGENTS.md` | 开发治理规则由 `AGENTS.md` 与 `docs/governance/DEVELOPMENT.md` 承载，运行时数据问答规则由 Proxy initialize 注入 |

最小安全示例（使用脱敏占位符，不含真实凭据）：

```yaml
# ktx.yaml —— 项目级配置（脱敏示例，password 指向 secret 文件）
connections:
  <connection-id>:
    driver: mysql
    enabled_tables:
      - <schema>.<table_or_view>
    host: <CHANGE-ME-MYSQL-HOST>
    port: 3306
    database: <CHANGE-ME-DATABASE>
    username: <CHANGE-ME-USERNAME>
    password: file:<CHANGE-ME-ABS-PATH-TO-PROJECT>/.ktx/secrets/<connection-id>-password
    schemas:
      - <schema>
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
table: <schema>.<physical_table>  # ⚠ 显式声明 table: 会把语义推向「新建 source」
grain:
  - <primary_time_column>
measures:
  - name: <measure_name>
    expr: <sql_expression>
```

```yaml
# webui/config/access.yaml —— ACL 片段（roles 是映射式，键为角色标识）
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
            - <source-name>          # 必须显式覆盖目标 source
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
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
| 物理列结构变化重新扫描 | 不要手改物理列结构来「绕过」扫描；改完仍要走 Reload Catalog |

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
| 默认不写 `table:` | 已有 source 不需要再声明物理表；写 `table:` 会把语义推向「新建 source」 |
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

判断标准：交付包中出现以下任意一项，**必须**先怀疑是「误把 overlay 写成 new source」：

| 可疑信号 | 说明 |
| --- | --- |
| `name` 与 manifest source name 不一致 | 例如 `international_country_metrics` vs `ai_metric_international_country_daily` |
| 显式写 `table:` | 已存在 manifest 时，写 `table:` 通常意味着想新建 |
| 目标业务是「给同一物理表补指标」 | 这种场景默认应走 overlay（3.7.3），不是 new source |

如果确实需要 new source，必须同时满足：

| 条件 | 说明 |
| --- | --- |
| 业务理由 | 文档化「为什么不能合并到原 source」 |
| ACL 同步 | `access.yaml` 的 `tableSelectors` 必须覆盖新 source |
| Wiki / 评测同步 | Wiki 说明何时选哪个 source；评测用例覆盖选源与查询 |
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

本节分四步：

1. 3.7.6.1 静态文件检查 —— 路径、文件名、`name` / `table:`、描述字段、表达式引用
2. 3.7.6.2 KTX 合并与索引检查 —— `admin reindex --force`、`sl validate`、`sl read` 与合并结果
3. 3.7.6.3 真实语义查询 + MCP smoke —— 真实 query、ACL、Catalog 与问答表现
4. 3.7.6.4 最终门槛 —— GO / NO-GO 判定与不通过时的回退

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
| Agent 选到错误 source | 同一物理表出现多个业务 source 且口径不清 | 合并到原 source 或补 Wiki / 评测 / ACL 指导（参见 3.7.4） |
| `MANIFEST_PARSE_FAILED` | YAML 语法或 manifest shape 错误 | 先用 `ktx sl validate` 复现；修 YAML parse 后再回到 3.7.6.2 |
| `eval` 跑出 `tool_error` | smoke 选源失败或 ACL 不通过 | 先确认 3.7.6.2 + 3.7.6.3 通过；再回到质量评测 |
| `No join path` / join graph 未连通 | Manifest/overlay 未声明 `joins`，或未 reindex | 见 [6.10 `lucy_query` 报 No join path / 跨表失败](#lucy-query-no-join-path) |
| fanout / Aggregate locality | measure 与 filter 路径经 `one_to_many` 扇出 | 见 [6.11 fanout / Aggregate locality 拒绝查询](#lucy-query-fanout-locality)、[grain、join 与 fanout](#semantic-grain-fanout) |
| Wiki reindex `NOT NULL ... summary` | Wiki frontmatter 缺非空 `summary` | 见 [6.14 改了 Manifest / Wiki，MCP 仍旧或 reindex 失败](#manifest-wiki-reindex-sync) |

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
| 6.1 为什么提示「未发现本地 manifest」？ | 增补「`reindex` 成功不代表 overlay 合并正确」，按 3.7.6.2 重跑 |
| 6.3 配置文件改动后什么时候生效？ | 区分 `access.yaml` 缓存、KTX reindex、Reload Catalog 的生效时机 |
| 6.7 为什么启用表范围保存失败？ | 增补 ACL / source 新增风险（参见 3.7.4） |
| 6.9 最小健康检查清单 | 增补 `sl read`、真实 query、MCP smoke 步骤（参见 3.7.6） |
| 6.10–6.14 语义查询 / 评测 / 生效排障 | join 图、fanout、`order_by.direction`、复杂分析边界、Manifest/Wiki 生效 |

#### 3.7.8 Agent 自检协议

Claude Code / Codex 等 Agent 在检查客户 YAML 交付包时必须按以下协议执行，**不得**只凭单个 `validate` 结论给 GO。

本节分四步：

1. 3.7.8.1 输入清单 —— 复核前必须准备的文件与目标环境信息
2. 3.7.8.2 输出模板 —— 结论、阻断项、必须修改与验收命令的固定格式
3. 3.7.8.3 Agent 硬约束 —— 不得做的事与原因
4. 3.7.8.4 Agent 必须检查的最小项 —— 逐条检查清单

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
| 忽略 ACL / Wiki / 评测同步 | new source 缺一不可（参见 3.7.4） |
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
9. 若新增 source，ACL、Wiki、评测是否同步（3.7.4）。
10. 任何文件、命令、log 都不含真实凭据（3.7.1 / 3.7.6.1）。

### 3.8 访问治理 · 角色列表与权限预览

入口：`/admin/roles`。本节说明 Spec 154 改版后的列表页形态。

#### 角色列表与筛选

角色列表是**唯一的角色集合呈现**：列表使用统一的数据表格，不再在表格下方重复渲染一份角色卡片。旧版的卡片集合与重复的详情预览入口已移除。

页面顶部保留四张静态 KPI（角色总数、启用数、Agent 绑定数、解析异常数）。其中「解析异常」统计的是正式 `Role` 权限解析失败的数量；当该数大于 0 时，表格上方会给出提示，说明可通过筛选「待修复」查看。

筛选区分两层：

| 层级 | 控件 | 用途 |
| --- | --- | --- |
| 常驻 | 搜索框 + 角色范围筛选 | 高频操作，默认展开 |
| 高级 | 按连接 / 按 `MCP` 工具 / 按表名 | 低频权限维度，收在「高级筛选」内 |

搜索框按角色标识、说明、连接、工具与表名匹配。高级筛选收起时显示已选条件数量（如「高级筛选（2）」），便于记住当前收起了哪些条件。筛选生效后表格下方显示「当前筛选」摘要，并提供「清除筛选」回到全量。

点击表格行的快捷详情会在右侧打开抽屉，展示该角色的完整配置。详情对真实 API 响应做运行时校验：即使遇到异常数据，也只降级抽屉本身，不会导致列表页白屏。

**边界**：新建与编辑角色在独立页面完成，不在抽屉内；本节不涉及服务端 API 与权限裁决逻辑。

### 3.9 接入向导

入口：`/overview`，也可从连接概览的卡片「继续配置向导」进入。

#### 接入向导六步流程

接入向导是与各专业工作台**并行**的引导流程，不替代它们。目的是让首次接入按顺序走完必要步骤，而不是在多个工作台之间自己拼装顺序。

| 步骤 | 名称 | 性质 | 可跳过 |
| --- | --- | --- | --- |
| 1 | 连接数据库 | 必需 | 否 |
| 2 | 上传 Schema Manifest | 必需 | 否 |
| 3 | 选择启用表 | 必需 | 否 |
| 4 | 丰富业务语义 | 可选增强 | 是，跳过后使用基础字段投影与直通统计 |
| 5 | 注入业务知识 | 可选增强 | 是，跳过时不创建任何 Wiki 文档 |
| 6 | 连接 Agent 客户端 | 闭环验证 | 否 |

**双轨关系**：向导负责「按顺序做对」，工作台负责「深入修改」。跳过第 4、5 步不会阻断后续步骤，业务仍可通过 `/catalog`、`/wiki` 等工作台补齐。

第 6 步是终点验证：提供 Cursor / Claude Code / Codex 的 `MCP` 配置一键复制，以及首问验证提示词。配置格式详见 [4. Agent / 客户端接入指南](#4-agent--客户端接入指南)。

向导支持**断点续配**：中途离开后从连接概览的卡片继续，状态按连接保留，不必从头再来。

#### 接入向导六步流程（按实现映射）

下列映射把每一步落到具体组件、接口与 Spec，便于排障与扩展。重在「每个 Step 背后是哪个文件 / 哪个 API」。

| 步骤 | 实现组件 / 接口 | 行为关键点 | 详见 |
| --- | --- | --- | --- |
| 1 | `webui/src/components/onboarding/Step1ConnectDb.tsx` + `webui/src/components/CreateConnectionDrawer.tsx` | 走「创建连接抽屉」路径；不再隐式提示 SQLite / Athena 写密码文件（参 [运维 Runbook](#database-connection-operations-runbook)）。连接创建即同步创建 `connectionId`，作为后续 Step 的状态保留键。 | §3.2 |
| 2 | `POST /api/catalog/reload`（或等价语义层刷新接口） | 上传 `manifest.yaml` 后立即触发本地目录刷新；与 §3.2 [「刷新本地目录」](#catalog-reload) 对齐——这一步不通过、不发布。 | §3.2、§3.7.2 |
| 3 | `ktx.yaml` 的 `enabled_tables` 写入 | Wizard 只写 `enabled_tables` 段；与「启用表范围保存失败」错配兜底见 §6.7。 | §3.2、§5.2 |
| 4 | `/catalog` / 语义层工作台 | 跳过去后只读基础字段；后续可以从「连接概览 → 业务语义」入口继续。 | §3.3 |
| 5 | `/wiki` 工作台 | 跳过去后无任何 Wiki 文档被创建；后续从「业务 Wiki」入口补齐。 | §3.4 |
| 6 | `/overview` 终点页 + `/admin/agents` 一键签发 | 占位符 MCP 配置复制（含 `<LUCY_PUBLIC_MCP_URL>` / `${LUCY_AGENT_TOKEN}`）+ 首问验证提示词。详见 §4 与 §3.5 Token 凭据。 | §3.5、§4 |

要确认「这一步在哪里改」，先打开连接概览的「继续配置向导」卡片，按当前步骤号选对应的工作台入口，再回到本页对照实现落点。

#### 与各工作台的双轨关系

向导与各专业工作台**永远并行存在**，不是替代关系。下表把每一步和它「深入修改版」的工作台连起来：

| Step | 向导入口 | 工作台入口 | 何时切到工作台 |
| --- | --- | --- | --- |
| 1 | `/overview` Step 1（抽屉） | `/catalog`（语义资产） | 改 measure / dimension / join、grain 校准 |
| 2 | Step 2（Manifest 上传） | `/catalog` → Schema Tab | 改 overlay、union schema、按 Spec 07 强约束修列 |
| 3 | Step 3（启用表范围） | `ktx.yaml` `enabled_tables` 直编 / `/connections/enabled-tables` 双向同步 | 大批量增删、跨连接批量维护 |
| 4 | Step 4（业务语义） | `/catalog` → 语义工作台（§3.3） | 写 measure / dimension / join、grain 校准、fanout 决策 |
| 5 | Step 5（业务知识） | `/wiki`（§3.4） | 维护 Wiki 目录、回填历史 Q&A、术语表 |
| 6 | Step 6（MCP 客户端） | `/admin/agents` + `/admin/tokens`（§3.5） | 多 Token 管理、过期与轮换、调试台验证 |

**核心约定**：

- 跳过 Step 4 / 5 不会阻断 Step 6；业务通过对应工作台补齐语义或 Wiki 后再回到 Step 6 验证一次。
- Step 1 的连接配置最终写入 `ktx.yaml`（含密码文件引用），职责边界见 §3.2「WebUI 与 ktx.yaml 的职责边界」；凭据明文不进 YAML。
- 工作台里做的修改只在该 connectionId 下生效；其他连接的语义 / Wiki 不受影响。
- 中途离开向导后，从连接概览的「继续配置向导」卡片按 `connectionId` 找回——不依赖浏览器会话；下次登入仍能续配。
- Wizard 不替代发布工作台（见 §1.5 的「发布工作台」与 `/publish/workbench`）；Step 4 写完语义只是「编辑器内完成」，还要走 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist)。

#### 配置 MCP endpoint

Step 6 输出的 MCP 配置是**占位符 + 环境变量**，**不写明文**。客户端粘贴配置前的关键点：

- **不要**抄写「本地 7879 端口」或容器 publish 端口——以 WebUI 展示的 **Public MCP endpoint（Advertise）** 为准，由 `LUCY_PUBLIC_MCP_URL` 配置（详见 §4.1）。
- 配置模板只含 `<LUCY_PUBLIC_MCP_URL>` 与 `${LUCY_AGENT_TOKEN}` 两个占位符；接入方先把 Token 注入环境变量，再让客户端读 `${LUCY_AGENT_TOKEN}`，避免明文进 `.mcp.json` / 客户端配置文件。
- 终端执行态验证：

  ```bash
  # Claude Code：确认鉴权与 endpoint 通
  claude auth status

  # 任意 MCP client：手探一次
  curl -s "${LUCY_PUBLIC_MCP_URL}" \
    -H "Authorization: Bearer ${LUCY_AGENT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  ```

- 验证通过再做「首问验证」：在客户端用 `lucy_catalog` / `lucy_explain_query` 试一次（不要上来就 `lucy_query`）；失败优先到 §3.5 MCP 调试台复现。
- 详情 / 各客户端格式见 §4 接入指南。

### 3.10 访问治理 · 行级策略

入口：`/admin/roles` 的角色详情（行级策略编辑区）与 `/admin/agents` 的 Agent 详情。面向需要按行限制数据可见范围的管理员。

#### 行级策略（行授予与最终行约束）

行级策略是**静态**的表选择器级配置：它挂在角色的表选择器上，用结构化谓词声明「这张表里哪些行对该角色可见」。

| 配置 | 含义 |
| --- | --- |
| `row_access: all` | 该表全部行可见（默认），**不得**携带 `row_policy` |
| `row_access: scoped` | 按 `row_policy.predicates` 限行，**必须**至少有一条谓词 |

谓词字段只支持两种操作：**等于**（`eq`）与**属于**（`in`）。字段必须是该源的普通列或行级维度，**禁止**绑定到度量（measure）名。

多角色叠加时，同源多个角色的行授予取**并集**；再与 Agent 强制约束求交，得到**最终行约束**（Final Rows）。配置保存前可用 dryRun 预览最终行约束的摘要与 `digest`。

**重要边界——当前取数能力受上游证明开关约束**：

行级策略依赖上游对强制谓词的拼接能力。该能力默认**未证明**（`LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 不应设置）。在未证明状态下：

- 受行级策略保护的表通过 `lucy_query` 取数会返回 `row_policy_upstream_unproven`，这是**预期的安全拒绝，不是故障**；
- 受保护表上的 `lucy_read_source` / `lucy_freshness` / `entity_details` 会被 `row_policy_requires_wrapped_tool` 拒绝，只允许走已包装的查询路径；
- `lucy_explain_query` 始终可在本地执行，用于诊断。

**不要**为了「恢复业务」而把强制条件手写进用户查询的 `filters` 字符串——代理自动前置的条件与用户可写的过滤条件是两回事，手写会绕过裁决。

误配与恢复的完整排查路径见 [`access-control/runbook-row-policy.md`](access-control/runbook-row-policy.md)。

**这不是什么**：行级策略**不是**动态 RLS、不是多租户隔离、也不是数据库原生行级安全。按人或按 Token 动态变化的策略尚未立项。

### 3.11 访问治理 · MCP 会话与上游连接

面向接入 `Agent` 客户端的开发者与运维。

#### 客户端为何要回传 `Mcp-Session-Id`

KTX 把 MCP session 视为**传输状态**，不是简单的请求标识。在客户端成功发出 `initialize` 之前到达的任何 session 流量，都会被上游硬拒绝（`400 MCP initialize request is required before session traffic.`）。理解这一点对排障很关键：

- **本地服务不受影响**：`lucy_catalog` 等只读本地目录的工具不走上游，即使客户端没回传 `Mcp-Session-Id` 也能成功。
- **取数路径必须走上游**：`lucy_query` / `lucy_read_source` / `lucy_freshness` 都需要 KTX 把请求与既有的 MCP 传输会话绑定；session 漏了 → 取数 400。
- 用户**看到**目录能查、点查询失败，常被误判成数据库问题；**实际**是 session 握手层被截断。

Lucy Proxy v1.6 起接管这部分：双向透传客户端 `mcp-session-id`，并把缺失 header 的请求补上代理持有的上游会话值。这意味着**客户端必须正确实现 MCP 协议、把 `Mcp-Session-Id` 在每次请求里回传**——STDIO 客户端（如多数官方 SDK）天然做到；HTTP / SSE 实现的私有客户端要确认 SDK 会话管理正确处理。

#### 上游会话复用与限流

KTX 上游会话**不是按客户端 session 持有**，而是按 Lucy 的 `userId` 持有：

| 维度 | 持有粒度 | 影响 |
| --- | --- | --- |
| 上游传输会话 | `userId`（= Lucy Agent 的审计身份） | 同 Agent 下多 Token / 多客户端共用同一条上游传输 |
| 并发限流 | `userId` | 同 Agent 的所有并发 `lucy_query` 共享配额（`query_concurrency_exceeded` 是用户级） |
| 会话失效 | `userId` 级，Token 触发 401 可能归因到该 Agent 的整条上游传输 | 详见「排障速查」 |

**对调用的影响**：

- **多脚本共用**：同一用户从两台笔记本并发跑同一个 Agent（两个 Token），它们**共用**同一条上游传输会话。这意味着：上游侧一旦断流（KTX restart / Token revoke / 上游强制关闭），**两条客户端链路同时**回到「走不动上游」状态。
- **限流瓶颈**：`lucy_query` / `lucy_read_source` 与上游单会话是**串行走单连接**——并发查询超过该 userId 的配额时返回 `query_concurrency_exceeded`，**与本地 Lucy 的并发无关**。这是为什么用「单 Agent + 多并行客户端」做压测时容易撞线。
- **会话合并**：Lucy Proxy 内已实现 KTX 上游会话按 userId 合并（典型 Spec 132 / 后续「upstream session merge」规则），新客户端起 handshake 时会**沿用**已有的上游会话，而不是开第二条。

调优建议：

- 把并发高的批跑任务**单独拆 Agent**（例如 `eval-runner-agent`），不要压在日常交互 Agent 上，避免共享会话拥挤。
- 同一 Token 多次失败时优先 `restart Proxy` 或「撤销全部 Token」让 Proxy 走冷启；不要手动改 client session id。

#### 排障速查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `400 MCP initialize request is required before session traffic.` | 请求早于 `initialize` 握手，或客户端没回传 `Mcp-Session-Id` | 检查客户端 SDK 是否在每条请求回传 session header；先发 `initialize` 再发工具调用 |
| 客户端 session 看起来正常，但 `lucy_query` / `lucy_read_source` 全失败 | 上游传输会话没被 Proxy 持有（KTX 端先断了） | 看 Proxy 日志；`restart Proxy` / 检查 KTX upstream 健康，参考 [§6.6 KTX upstream 不可用](#ktx-upstream-unavailable) |
| 多脚本共享会话时某脚本 `expires_at` 触发 401 | 同 Agent 下多 Token；其中一个 Token 过期 / 撤销会让 Proxy 走 401 路径，共用会话的其他客户端也被影响 | 确认哪个 Token 失效；过期后**显式撤销**避免共用会话残留（详见 §3.5 Token 凭据「吊销」） |
| `query_concurrency_exceeded` 偶发 | 同 Agent 并发跑批，与本地 Lucy 并发无关 | 拆 Agent、降低并发或错峰；这是用户级限流 |
| 客户端拿到的 `mcp-session-id` 每次都不同 / Proxy 不复用 | 客户端每次自己生成新 ID，Proxy 透传不覆盖 | 让客户端使用首次 `initialize` 服务端给的 ID，并在后续请求回传 |
| 上游会话语义看似中断，但 `lucy_catalog` 仍能返回 | 取数 vs 本地目录分流——`lucy_catalog` 不走上游 | 误以为数据库故障时优先看这一步；如果只有 catalog 失败而 query 成功，反过来也按此规律定位 |

如果以上都不是，再回到 §3.5 MCP 调试台的受控试调做最小重现，能把「我客户端的问题」与「Lucy 上游的故障」分开。

#### MCP 会话保持与上游连接归属

Proxy 在终结身份、ACL 与工具改写的同时，**持有到 KTX 上游的传输会话**。这是 v1.6 起的行为。

**为什么需要**：KTX 把 MCP session 视为传输状态——任何在成功 `initialize` 之前到达的 session 流量都会被拒绝（`400 MCP initialize request is required before session traffic.`）。早期 Lucy 只做 `Mcp-Session-Id` 双向透传，于是「能不能取数」取决于客户端是否回传该 header：本地服务的 `lucy_catalog` 照常工作，而必须走上游的 `lucy_query` / `lucy_read_source` 失败——用户会**看得到目录、查不了数**，并把故障误判成数据库问题。

**归属规则**：

- `mcp-session-id` **双向透传**，代理不生成新的 session ID；
- 客户端请求**自带**该 header 时一律透传，代理不覆盖；仅在缺失时补上代理持有的值；
- 上游会话按 Lucy 的 `userId` 持有，**不是**按客户端 session——同一用户的多个脚本共用一条上游传输会话；
- 审计归因仍以 `lucySessionId` / `lucyTurnId` 为准，不受此影响。

排查连接问题时，先确认客户端是否在 `initialize` 之后回传 `Mcp-Session-Id`；若看到 `400 MCP initialize request is required before session traffic.`，说明该请求早于初始化握手。详细 Spec 见 `webui/docs/07-mcp-auth-proxy-spec.md` 与 KTX 上游 session merge 内部记录；当前 Lucy 端的双向透传与按 userId 持有的实现见 `webui/server/proxy/mcp-proxy.ts` 的 `lucyPlatform` / 上游会话缓存逻辑。

### 3.12 业务上下文 · 业务 Skill

「业务 Skill」是与语义资产、业务 Wiki 并列的受治理上下文资产，供 `Agent` 在数据问答中调用的分析规程。术语口径见 [3.7 配置作者 Skills](#config-author-skills) 的边界说明——两者是不同东西，不要混用。

入口：`/skills`。页面采用「左侧领域与 Skill 浏览器 + 右侧主工作区」双栏结构，与 [3.4 业务上下文 · Wiki](#business-wiki) 的阅读模式一致，但不复制 Wiki 的文件治理能力。

#### 业务 Skill 治理工作台

页面有三种状态：**治理总览**、**阅读态**、**编辑态**。阅读与编辑在右侧主区完成，不再使用抽屉承载详情。

| URL | 状态 |
| --- | --- |
| `/skills` | 全量治理总览（全部领域） |
| `/skills?domain=<domain>` | 指定领域的治理总览 |
| `/skills?skill=<domain>/<name>` | Skill 阅读态；领域由 Skill 自动确定 |
| `/skills?new=1` | 新建 Skill；可叠加 `domain` 预填领域 |

编辑态是页面本地状态，**不写入 URL**：取消编辑后回到同一 Skill 的阅读态，从详情返回时进入所属领域的总览。

治理总览列展示名称、域、状态、版本、**负责人**与校验结果；摘要列表不携带正文，详情在前端选中后懒加载。无效 `domain` 显示空领域总览；无效 `skill` 显示详情加载失败并保留左侧浏览器，便于改选其他条目。

阅读态展示 frontmatter 元数据、触发词与渲染后的正文；正文存在多个二、三级标题时显示页内目录。

**负责人**（治理标签，不是账户）：`owner` 写在 frontmatter 里，用于标记这条 Skill 由谁负责维护，可填人员或团队名称。缺省显示「未指定」，既有 Skill 不迁移、不批量回填。编辑态在「元数据」区填写，辅助说明为「可填写人员或团队；不影响访问权限」。

负责人**不参与授权**——不改变 `roles_allowed`、可访问角色、发布状态与 MCP 读取结果；它也不是登录账户、邮箱或通知订阅。声明损坏时总览显示「声明无效」、阅读态显示「负责人声明无效，请编辑修复」，此时必须显式填写合法值或清空后才能保存，不会被另一次保存静默抹掉；损坏声明不阻断 Agent 读取既有 Skill。

**授权口径**（`roles_allowed` 是授权事实源）：

| 值 | 含义 |
| --- | --- |
| `[]` | 无人可见 |
| `["<role>", ...]` | 指定角色可见 |
| `["*"]` | 所有角色可见（通配授权） |

**从非通配进入 `["*"]` 必须二次确认**：预检会显示预计影响的角色数与 `Agent` 数，确认后才写入。

**保存预检**：编辑态下 `Cmd/Ctrl+S` 只打开预检抽屉，不直接写文件。预检披露内容校验问题、状态迁移（如草稿 → 已发布）、角色集合变化、**负责人前后值**、预计影响范围与 diff。已发布 Skill 的内容校验问题**不阻止保存**，但必须在预检中醒目披露。

写入约束：更新与删除都带 `expected_version`，版本不匹配即拒绝；编辑时 `domain` 与 `name` 不可变，需要改名只能新建。

Skill 状态（草稿 / 已发布 / 已停用）只是 frontmatter 字段，**不进入语义发布工作台**——语义发布管的是语义资产与 Wiki，见 [3.7 YAML 规范与交付验收](#yaml-delivery-standard) 的交付流程。

本工作台**不提供**：文件上传替换、目录增删改、跨领域移动、版本历史与恢复、语义发布与索引同步。需要这些能力时改用语义资产与发布工作台路径。

## 4. Agent / 客户端接入指南

### 4.1 接入地址

接入地址以 WebUI 展示的 Public MCP endpoint（Advertise）为准。部署方通过
`LUCY_PUBLIC_MCP_URL` 配置该值。

| 层 | 含义 | 勿混淆 |
| --- | --- | --- |
| Listen | `LUCY_PROXY_HOST`:`LUCY_PROXY_PORT`（容器内默认 `7879`） | 勿写给 Agent |
| Publish | compose 宿主端口 / Ingress | remap 宿主端口时须同步 Advertise |
| Advertise | `LUCY_PUBLIC_MCP_URL` | WebUI / Agent 唯一事实源 |

未配置时 WebUI 显示本地开发 fallback，状态为 `fallback`，**不计** MCP 就绪。

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
| `lucy_read_source` | 读取一个授权 semantic source | 上游内部工具名为 `sl_read_source`；Agent 侧只能调 `lucy_read_source` |
| `lucy_query` | 运行授权语义查询 | 上游内部工具名为 `sl_query`；禁止 raw SQL |
| `lucy_explain_query` | 解释同一参数会如何被授权/限流，不执行查询 | 排障用，不是常规 dry-run |
| `lucy_freshness` | 返回 source 的语义层更新时间与物理 freshness 可用性 | 当前物理数据 freshness 不可用时显式说明 |
| `lucy_begin_question` | 可选，上报自然语言问题，便于审计关联 | 可用 `LUCY_ENABLE_QUESTION_TOOL=false` 关闭 |

兼容/辅助工具可能包括 `kx_catalog`、`wiki_search`、`wiki_read`、`connection_list`、`entity_details` 等。是否可见完全由 role 的 `allow.tools` 和全局 defaults 决定。

`sl_query` 与 `sl_read_source` 是上游 KTX 的内部工具名，**不是 Agent 可见工具**：Proxy 对它们一律返回 `AbsoluteDeny`，与 role 的 `allow.tools` 无关。Agent 直连调用必然被拒；对应能力只能通过 `lucy_query` / `lucy_read_source` 使用。

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
        # Proxy 鉴权强制拒绝已过期或不可解析的 expires_at；缺省则永不过期。

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
    host: <CHANGE-ME-MYSQL-HOST>
    port: 3306
    database: dataforai
    username: <CHANGE-ME-USERNAME>
    password: file:<CHANGE-ME-ABS-PATH-TO-PROJECT>/.ktx/secrets/mysql-aliyun-password
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
    host: <CHANGE-ME-STARROCKS-HOST>
    port: 9030
    database: dataforai
    username: <CHANGE-ME-STARROCKS-READONLY-USERNAME>
    password: env:LUCY_DB_PASSWORD_STARROCKS_R1
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
| `enabled_tables` | WebUI 启用表范围和 MCP 暴露基础范围 |
| `schemas` | 配置态 schema；manifest 是否存在由 Catalog reload 检查 |
| `password` | 推荐 `file:` 或 `env:`；不要 inline 明文 |
| `storage.state` / `storage.search` | 本地状态库和全文索引实现 |
| `storage.git.author` | KTX/Lucy 产生变更时使用的 Git author 标识 |

### 5.3 环境变量

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `KTX_PROJECT_ROOT` | 向上查找 `ktx.yaml` | 指定 Lucy/KTX 项目根 |
| `KTX_INTERNAL_TOKEN` | 卷内 `.ktx-ui/ktx-internal-token` | Lucy Proxy 转发到 KTX upstream 时使用的内部 Bearer。平滑升级复用该文件 |
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
| `LUCY_AUDIT_QUERY_KEY` | （未设置） | 启用查询原文加密冷存（Spec 124）；未设置则不写冷存 |
| `LUCY_AUDIT_COLD_DIR` | `.ktx-ui/audit-cold/query-artifacts` | 覆盖查询原文冷存目录 |
| `LUCY_EVAL_DB` | `.ktx-ui/eval/runs.sqlite` | 覆盖评测运行库 |
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
| `LUCY_SMTP_PROFILE_FILE` | 无 | 邮件通知的 profile 文件路径（只读）。未设置即邮件通知关闭，不产生任何出网连接 |
| `LUCY_SMTP_PASSWORD_FILE` | 无 | 邮件通知的 SMTP 密码文件路径（只读）。只有配置了用户名时才需要；未设置时该文件不会被读取 |
| `LUCY_SMTP_CA_FILE` | 无 | 邮件通知的可选私有 CA 文件路径（只读）。只追加信任，不关闭证书校验 |

Docker 常用宿主映射变量：

| 变量 | 用途 |
| --- | --- |
| `LUCY_WEBUI_HOST_PORT` | 宿主机映射到容器 `5174` |
| `LUCY_PROXY_HOST_PORT` | 宿主机映射到容器 `7879` |
| `KTX_VERSION` | 构建镜像时安装的 KTX 版本 |
| `LUCY_EXPECTED_KTX_VERSION` | smoke/health 期望版本 |

### 5.4 邮件通知（可选 SMTP 通知）

邮件通知是**可选能力，默认关闭**。它只承载部署方选定的通知，不改变登录账户、认证、恢复流程或审计事实源。当前批次只有两类邮件：**审计健康提醒**（审计账本不可用／恢复）和**测试邮件**。没有忘记密码、验证码、部署许可或业务数据通知。

**术语边界**：`queued` 表示已加入**通知队列**，不表示 SMTP 已接受、也不表示收件箱已送达；`sending`／`sent`／`dead` 同理。HTTP 202 的文案是「测试邮件已加入发送队列」，**不得**写成「发送成功」。

#### 5.4.1 配置文件

profile 只从 `LUCY_SMTP_PROFILE_FILE` 指向的文件读取；密码只从 `LUCY_SMTP_PASSWORD_FILE` 指向的独立 Secret 文件读取；可选私有 CA 从 `LUCY_SMTP_CA_FILE` 读取。**profile 内不允许出现 `password`／`pass`／`secret` 字段**，出现即整份配置被判为不可用。

```yaml
# profile.yaml —— 非敏感，可放 ConfigMap
enabled: true
host: smtp.customer.internal
port: 587
security: starttls        # 只允许 tls（直连 TLS）或 starttls（原地升级）
from: lucy@customer.internal
username: lucy-notifier   # 可选；设置时必须同时提供密码文件
recipients:               # 1-20 个；只出现在 Bcc，收件人互相看不到
  - data-ops@customer.internal
notifications:
  auditHealth: true
```

| 字段 | 规则 |
| --- | --- |
| `host` | 主机名或 IP；不含 scheme、路径、端口、用户信息；最长 253 |
| `port` | 1–65535，必须显式配置，不从安全模式推断 |
| `security` | 仅 `tls` 或 `starttls`；**不支持明文 SMTP**，升级失败即终止，不降级 |
| `from` | 单一邮箱地址，不带显示名，不含换行；最长 254 |
| `username` | 可选，最长 256；设置时必须有非空密码文件；未设置时密码文件不会被读取 |
| `recipients` | 1–20 个去重地址；启用时必填 |
| `notifications.auditHealth` | 布尔，缺省 false；只控制审计账本事故／恢复提醒，不控制测试邮件 |

配置在**启动时读取一次并缓存**，文件变更不热加载，**需要重启才生效**。

#### 5.4.2 Helm 接线

```yaml
# values.yaml
smtp:
  enabled: true
  host: smtp.customer.internal
  port: 587
  security: starttls
  from: lucy@customer.internal
  username: lucy-notifier
  recipients:
    - data-ops@customer.internal
  auditHealth: true
  existingSecret: customer-smtp-secret   # 客户自有的 Kubernetes Secret，只按名字引用
  passwordKey: password
```

密码与可选 CA **只能**来自客户自有的 Kubernetes Secret，Chart 只读挂载、只传文件路径，**不会**渲染任何 SMTP Secret。`smtp.enabled=false`（默认）时，渲染产物里**没有** SMTP ConfigMap、没有挂载、没有环境变量，也没有任何网络行为。

以下情况 **render 直接失败**（不会产出装不起来的 Deployment）：`smtp.password` 等内联密码字段；设置了 `username` 却缺 `existingSecret`／`passwordKey`；`security` 不是 `tls`／`starttls`；`port` 越界；`host` 含 scheme／端口／路径；`from` 或 `recipients` 不是合法地址或含控制字符；`recipients` 为空或超过 20 个；`extraEnvFrom` 试图用 `LUCY_SMTP` 前缀覆盖，或把 SMTP 密码 Secret 投影成环境变量。

#### 5.4.3 运维操作

```bash
# 查通知状态（仅所有者；不返回 host、用户名、发件地址、收件人与任何秘密）
curl -H "Authorization: Bearer $TOKEN" https://lucy.example.com/api/admin/notifications/status

# 提交一封测试邮件：202 表示已加入发送队列，不表示已发送
curl -X POST -H "Authorization: Bearer $TOKEN" https://lucy.example.com/api/admin/notifications/test

# 查看单条通知的状态（不返回 payload 与收件人）
curl -H "Authorization: Bearer $TOKEN" https://lucy.example.com/api/admin/notifications/12
```

#### 5.4.4 排障

| 现象 | 排查 |
| --- | --- |
| 状态为 `disabled` | 未设置 `LUCY_SMTP_PROFILE_FILE`，或 profile 里 `enabled: false` |
| 状态为 `unavailable` | 看 `errorCode`：`smtp_profile_invalid` 查 profile 形状；`smtp_secret_unavailable` 查密码文件是否存在且非空；`smtp_ca_unavailable` 查 CA 文件是否为 PEM；`smtp_auth_incomplete` 查是否配了用户名却没给密码文件 |
| 通知一直 `queued` | worker 未运行（配置不可用时 worker 不启动）；或 SMTP 服务器不可达，错误码见 `lastErrorCode` |
| 通知 `dead` | `last_error_code` 为 `smtp_rejected` 表示服务端永久拒绝（5xx）；`expired` 表示超过 7 天有效期不再投递 |
| 客户 SMTP 需要自签 CA | 把 CA 放进客户自有 Secret，配置 `smtp.ca.enabled=true` 与 `smtp.ca.existingSecret`；CA **只追加信任**，证书校验不会被关闭 |

SMTP 服务器接受信件**不等于**最终投递到收件箱；Lucy 只记录 SMTP 提交结果，不追踪退信、阅读或外部投递回执。

#### 5.4.5 禁用与回滚

把 `smtp.enabled` 改回 `false` 并重启即停止新投递，已排队的行保留但不投递。回滚到不识别 `notification_outbox` 表的旧版本前，按 Chart 的 `UPGRADE.md`／`ROLLBACK.md`「Optional SMTP notifications (chart 0.2.8+)」段处理该表——**默认保留**（旧版本不读写它），清理是可选项。禁用与回滚都不影响登录账户、审计账本、权限与恢复密钥；密码不会进入备份明文附件。

## 6. FAQ 与排障指南

### 6.1 为什么提示「未发现本地 manifest」？

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

> **关联：YAML 交付与验收**
>
> - 交付包存在但 `admin reindex` 仍报「未发现本地 manifest」：先按 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist) 跑 `sl read`，再回到本节。
> - 如果是 overlay 文件名 / `name` 与 manifest source 不一致导致新生成 source：参考 [3.7.3 Manifest augmentation overlay 规范](#yaml-augmentation-overlay) 与 [3.7.7 常见错误与诊断 Runbook](#yaml-common-errors)。

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
| `ktx.yaml` 新连接或凭据 | WebUI 保存后执行层尚未加载；在 MCP 调试台点「重载执行层」使其生效（只重启 KTX 执行进程，不重启 Pod）；至少运行 `ktx connection test <connId>` |
| `webui/config/data-qa-instructions.md` | Proxy 当前实现一次性加载；修改后重启 WebUI/Proxy 才稳妥 |

> **关联：YAML 交付与验收**
>
> - `admin reindex` 成功不等于 YAML 已合并到目标 source，详见 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist)。
> - 若 new semantic source 已新增，ACL 缓存需要等 Proxy 30 秒或重启；ACL 同步动作见 [3.7.4 New semantic source 规范](#yaml-new-semantic-source)。

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

### 6.7 为什么启用表范围保存失败？

`PUT /api/connections/:connId/enabled-tables` 会拒绝：

| 错误 | 含义 |
| --- | --- |
| `INVALID_ENABLED_TABLE` | 表名不是 `schema.table` 或含非法字符 |
| `DUPLICATE_ENABLED_TABLE` | 重复表 |
| `TABLE_NOT_SCANNED` | 表不在本地 manifest |
| `CONNECTION_NOT_FOUND` | `ktx.yaml` 没有该 connection |

处理：先补齐/刷新 `semantic-layer/<conn>/_schema/*.yaml`，再运行 Reload Catalog。

> **关联：YAML 交付与验收**
>
> - 若启用表范围指向的 source 是交付包中新生成的 source，先确认是否属于「误把 overlay 写成 new source」。判定标准见 [3.7.4 New semantic source 规范](#yaml-new-semantic-source)。
> - 如果确实需要 new source，记得同步 `access.yaml` 的 `tableSelectors`，详见 [3.7.4 New semantic source 规范](#yaml-new-semantic-source) 与 [3.7.7 常见错误与诊断 Runbook](#yaml-common-errors)。

### 6.8 安全边界速查

| 边界 | 当前实现 |
| --- | --- |
| 可写目录 | `semantic-layer/`、`evals/`、`skills/`、`wiki/`、`.ktx-ui/`、`webui/config/` |
| 可写单文件 | `ktx.yaml` |
| 禁止写 | `.ktx/secrets/`、`raw-sources/`、`.git/`、允许目录外路径 |
| 禁止读返回 | `.ktx/secrets/**` |
| secret 预览 | `ktx.yaml` diff 会剥离 password/token/secret 类键 |
| token 明文 | 只在创建 token 的 HTTP 响应出现一次 |
| Role tools wildcard | `role.allow.tools` 为空或包含 `*` 会让整个 role fail-closed，返回 `role_resolution_failed:<role>` |
| 外部 Agent | 只拿 Agent token，不拿 `KTX_INTERNAL_TOKEN` |
| 原始 SQL | `lucy_query` raw `query`/`sql` 默认拒绝 |
| 审计热库 SQL 留存 | 热库可存 `generated_sql`（仅 `lucy_query` 编译结果，Spec 125）；调用流水列表直展。仍禁止 raw query 攻击载荷 / 结果行 / Token 明文。详见 [审计热库与冷库（SQL 留存边界）](#admin-audit-hot-cold-store) |
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

> **关联：YAML 交付与验收**
>
> - 上述清单覆盖「健康」层面；要确认 YAML 交付包**业务语义合并正确**，必须按 [3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist) 全量跑过。
> - 完整交付前请至少额外执行 `ktx sl read`、真实 `ktx sl query` 与 Agent MCP smoke，具体步骤见 3.7.6.3 真实语义查询 + MCP smoke。
> - Agent 自动复核协议见 [3.7.8 Agent 自检协议](#yaml-agent-self-check)。

### 6.10 `lucy_query` 报 No join path / 跨表失败

含义：语义编译器在 **join 图**里找不到从 measure source 到 dimension/filter source 的安全路径。常见文案含 `No join path`、`not connected in the join graph`。

这与「物理库里有外键 / 表已启用」不是一回事：`lucy_query` 只认 Manifest / overlay 里声明的 `joins`。

| 检查项 | 做法 |
| --- | --- |
| 是否声明 join | 在 `semantic-layer/<conn>/_schema/<schema>.yaml`（或相关 overlay）为相关表写 `joins`：`to`、`on`（source 限定列名）、`relationship`、`source: formal` |
| relationship 是否合法 | 仅用 `many_to_one` / `one_to_many` / `one_to_one`；禁止 `many_to_many`。桥表拆成两条 `many_to_one` 指向两端 |
| 索引是否更新 | 改 YAML 后执行 `ktx admin reindex`（或 WebUI 语义资产全量重建）；Docker 卷部署还须先把文件同步进容器数据卷 |
| 是否读到合并结果 | `ktx sl read <source> --connection-id <conn>` 确认 joins 已出现在合并模型中 |

概念说明见 [grain、join 与 fanout](#semantic-grain-fanout)。YAML 写法见 [3.7 YAML 规范与交付验收](#yaml-delivery-standard)。

### 6.11 fanout / Aggregate locality 拒绝查询

含义：join 路径可能存在，但编译器认为沿 `one_to_many` 做 filter/dimension 会 **扇出放大** 聚合，或 measure 源无法安全到达目标维度。常见文案含 `fanout`、`Aggregate locality cannot safely reach`。

处理原则：

1. **换 measure 源**：尽量从「多对一」指向维度的事实/桥表发起 `count`/`sum`，再挂 `many_to_one` 维度。  
2. **少用跨 o2m 的 filter**：若过滤维度只能经 `one_to_many` 到达，先单独查出允许的键集合，再在第二步用 `in` 过滤（半连接式两步查询）。  
3. **补反向边要谨慎**：为连通性增加 `one_to_many` 可能引入多路径歧义（`Ambiguous join path`）；优先保证业务主路径清晰。  
4. **不要用「先 join 再聚合」的直觉硬刚**：语义层会改写预聚合策略；错误 `grain`/`relationship` 会导致拒查或静默错数。详见 [grain、join 与 fanout](#semantic-grain-fanout)。

### 6.12 `order_by` 排序无效或排反

`lucy_query` 的 `order_by` 项必须是对象，且降序/升序字段名为 **`direction`**（取值 `desc` / `asc`）。

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
| 单表/已声明 join 的聚合可查，但窗口函数、NTILE 分箱、回归、复杂中位数链路失败 | 薄语义层（缺专用 measure/segment/派生列）表达力不足 | 补业务 measure/segment，或接受评测用例走受控 SQL / 旁路口径；**默认 MCP 拒绝 raw SQL**（见 [6.8 安全边界速查](#security-boundaries)） |
| Case 标注需要 raw SQL fallback，但 Agent 只有 `lucy_*` | 产品面与评测元数据不一致 | 扩工具授权须走治理；Pilot/内测可用独立 SQL 旁路评分，不得假装 `lucy_query` Pass |
| 换引擎或重装载后数值与旧 gold 不一致 | gold 引擎漂移（分位数、时区、类型映射） | 在目标库重算并更新 `evals/**/gold`；对不稳定算法放宽 `numeric_tolerance`，并在校准说明中登记 |

质量评测入口见 [3.6 质量评测](#quality-evaluation)。交付验收勿用「单次 query 碰巧有数」代替 [GO / NO-GO](#yaml-go-no-go-checklist)。

### 6.14 改了 Manifest / Wiki，MCP 仍旧或 reindex 失败

| 症状 | 高概率原因 | 处理 |
| --- | --- | --- |
| 仓库 YAML 已改，MCP / `sl read` 仍是旧模型 | 进程读的是 Docker 数据卷或另一 `PROJECT_ROOT` | 同步文件到实际项目根，再 `admin reindex` / 语义资产「同步索引」 |
| `Visible Scope` 仍无新表 | ACL 未扩 `tableSelectors`，或仍在用旧 MCP session | 更新 `access.yaml` role；**新开** session 再 `initialize` |
| Agent 绑定 role 失败 / 配置不生效 | 用户字段误用复数 `roles` | 使用单数 `role: <roleId>` |
| Wiki reindex 报 `NOT NULL ... summary` | frontmatter 缺非空 `summary` | 补 `summary` 后重新上传/commit，再 reindex |
| reindex 部分 scope 失败、部分成功 | 日志里看清失败 scope（如仅 `wiki/global`） | 先修失败 scope，不要假设「有 failed=1 就等于语义层未更新」——以 `sl/<conn> scanned=…` 行为准 |

生效时机总表见 [6.3 配置文件改动后什么时候生效？](#config-change-effective-timeline)。
