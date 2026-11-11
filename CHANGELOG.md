# Changelog

All notable user-visible changes to Lucy ship here. Versions follow `<major>.<minor>.<patch>`; the current development line is M31.

> Conventions: `**Breaking**` = action required on upgrade; `**Deprecated**` = still works, will be removed; `**Added**` / `**Changed**` / `**Fixed**` are self-describing.

---

## 0.20.0

Correct the active Lucy product line from `0.2.0` to `0.20.0` on 2026-10-24, restoring numeric order relative to the earlier `0.17.0` release. The erroneous `2.0.0` cut is retired and remains only as release history. Customer-facing label is `v0.20.0`. Chart package version is `0.2.7`; bundled KTX stays `0.16.0`. Product versions and deployment artifacts are independently versioned, and every delivery path records its own support and gate status.

---

## 0.2.0

Short-lived product-version correction from `2.0.0` to `0.2.0` on 2026-10-24, superseded by `0.20.0` because `0.2.0` is numerically lower than the earlier `0.17.0`. The `v0.2.0` tag, Release, commit and gate evidence remain unchanged as historical fact.

---

## 2.0.0

Product line cut from `0.17.0` to `2.0.0` on 2026-10-19. Customer-facing label is `v2.0.0`. Bundled KTX stays `0.16.0`. Chart package version is `0.2.6`: `security.access` is `https` or intranet `http`. Customer delivery verifies archive config/manifest/index identities, includes private CA files, and provides one instance deployment entry with durable baseline backups and executable recovery instructions.

---

## 0.25.0

Formal annotated tag `v0.25.0` on 2026-11-06 at commit `e84c9ed4`（产品版本自 2026-11-01 对齐为 `0.25.0`）。Customer-facing label is `v0.25.0`. Chart package version stays `0.2.8`; bundled KTX stays `0.16.0`. GitHub Release 已创建；发版台账见 `docs/releases/v0.25.0.json`。本版**无**客户交付包／`productionReady`：main Required checks 通过，tag 跑批总体失败（含 `release/spec-and-webui` 与 `customer-amd64-native`），GitHub 客户放行链未完成。相对上一 tagged 客户版 `v0.20.0`。

### Added
- **执行层重载（Spec 191）**：WebUI 写 `ktx.yaml` 后，所有者可在 MCP 调试台点「重载执行层」，
  只重启 KTX 执行进程使其重新读取最新连接配置——**不重启 Pod、容器或 WebUI**。
  - 新增 `POST /api/admin/mcp-runtime/reload`（owner-only；open / bootstrap 模式返回 400
    `AUTH_NOT_CONFIGURED`，未登录 401，非 owner 403）。成功、失败、拒绝与超时路径均写审计
    （`changeType: execution_runtime_reload`）。
  - 新增 `GET /api/admin/mcp-runtime/status` 的三维状态：`activation`（配置生效状态）、
    `reload`（一次重载操作的状态）、`verification`（连接级证据状态），三者不合并为一个「成功」。
  - 新增重载通道能力握手：supervisor 发布 `ktx-reload.capability`（协议版本 + 心跳 + 在途状态），
    无有效 supervisor 时快速返回 `unsupported` 且不产生任何文件或进程副作用。
  - 新增写路径响应字段 `executionRuntimePending`：连接创建、启用表范围调整与 Schema
    增删在写入 `ktx.yaml` 后**自动尝试**重载执行层；成功则 `false`，失败／跳过则标
    pending 并由所有者确认重试。
  - 容器入口 `scripts/runtime/docker-entrypoint.sh` 引入 KTX supervisor：进程归属、信号转发、
    退出码、首次启动失败不退化、自发退出的有限退避重启与遗留进程清理全部显式定义。
- **运维问数连接（Spec 149）**：新增只读连接 `lucy-ops`，把审计热库的调用流水做成两张视图
  （`ops_calls`、`ops_call_tables`），授权后的 Agent 可追问「某张表上谁被拒绝、生成 SQL 是什么」
  「某个工具的失败是否集中在一个 Agent」。
  - 连接在**启动时**幂等建立：容器入口在 KTX daemon 启动**之前**完成视图、连接块、内容根资产
    与项目根镜像，并写下 `ktx.yaml` 摘要戳；已有卷第一次补上该连接时状态为「未就绪」，
    首次补齐后若写路径自动重载未成功，需所有者按 Spec 191 确认重试后才可查询。
  - 授权只认**显式列出**：只有 `allow.connections` 里写明 `lucy-ops` 的 Role 能看见并查询它；
    `*` 与 `catalog_bound`（含 `lucy_admin`）都不算。
  - 连接不可删除：删除接口在预览与写入时都返回 400 `OPS_EVIDENCE_CONNECTION_PROTECTED`，
    审计库与三类资产保持不动。
  - 本连接只回答**活跃 Agent**：不把 `token_label` 去重称为业务活跃 Token，不回答访问账户，
    `call_day` 是 UTC 日历日，生成 SQL 只在过滤后的明细里取。
  - Docker demo 模板新增演示运维问数 Agent `demo_ops` 与运维问数角色 `lucy_ops_reader`；
    `demo_readonly` 与 `lucy_admin` 的既有权限不变。
- **访问关系图（本波收口）**：usage-first 几何与 scope 重投影；闲置授权文案与边悬停；
  固定已确认关联；小时明细表；与访问日志口径对齐的故事线 Spec 与功能合同。
- **访问日志调用链故事线**：一笔问询可按调用链读完轮次／调用／尝试，不再只剩摘要碎片。
- **系统手册核心章节**：补齐导航与非导航路由章节、工具面与章节锚定门禁；修正过时事实并重排接入章。
- **客户默认系统正式 Role**：正式交付路径下默认系统 Role 功能合同收口（含存量 demo
  `lucy_admin` 补授 `lucy_continue_question`）。
- **lucy-ops Manifest 升级自愈**：存量卷升级时幂等补齐 ops 连接／资产，避免「升级后运维问数 silently 缺席」。
- **默认 asset_finance Skill**：四份财务规程（杜邦／收支桑基／经营利润桥／对照利润表）收为默认业务 Skill。
- **row-policy 强度 B 证据**：共享 RDS 真实审判包与 v025 harness 增量；对应验收与需求登记进
  `0.30` 池（本版主张「有强度 B 证据包」，不主张正式生产放行矩阵已闭合）。

### Changed
- **文档口径**：`ktx.yaml` 新连接或凭据的生效说明从「可能需要重启 KTX MCP daemon」改为
  「在 MCP 调试台点『重载执行层』」；`McpRuntimeStatusPanel` 的待确认提示不再指向人工重启。
- **用量统计口径统一（Spec 189）**：Agent／Token 的「业务活跃」与「业务调用量」不再把协议流量
  和评测探针算作业务使用。协议事件集合扩展为**完整集合**——握手（`initialize`、
  `notifications/initialized`、`tools/list`）＋探测（`ping`、`resources/list`、
  `resources/templates/list`、`prompts/list`、`notifications/cancelled`）＋ 任何 `server/*`
  方法。评测探针（Token 显式 `eval_mark` 为真**且**参数／连接名命中探针标记）退出默认用量
  指标，但仍保留在原始审计、导出、问询关联与真实表访问中。
  - **受影响页面**：使用概况（`/admin/usage` 数据访问视图）、Agent 管理（`/admin/agents`）、
    Agent 详情、Token 管理（`/admin/tokens`）、调用监控（`/ops/calls`）、访问日志
    （`/admin/audit` 默认视图）、评测现场（`/eval/monitor`）、访问关系图（`/admin/access-map`）、
    治理门禁与发布就绪证据包。
  - **⚠️ 存量数值会变化（下游看板／阈值请复核）**：
    - `businessCallsLast7d`（Agent API）**可能下降** —— 之前把协议流量算作业务调用。
    - `protocolCallsLast7d` **可能上升** —— 之前只识别 3 种握手方法。
    - 「近 N 业务活跃 Token」**可能下降** —— 之前仅按最近 MCP 访问判定（含协议流量）。
    - Access Governance Gate 的**高流量计数可能下降** —— 输入口径固定为 Raw Business
      （协议流量排除、真实评测业务调用仍计入），阈值（50）与 P1 `warn` 裁决**不变**。
    - 旧字段名与恒等式（`calls = business + protocol`）保持不变，但数值按新口径迁移；
      新增 `usageCallsLast7d`、`evalProbeCallsLast7d`、`usageActiveAgentCountLast7d`
      供新 UI 使用，旧客户端继续读取旧字段。
  - **不变量**：原始 `access_log` 不改写；「最近 MCP 访问」与「近 N 使用过的凭据」保持全量
    访问语义；审计库不可用时窗口指标为 `null`（渲染「—」），Token 前缀碰撞仍为 `partial`。
- **角色连接卡与新建默认业务问答**：治理台连接卡与默认问答路径收口，降低「先配 YAML 才能问」的摩擦。
- **0.30 需求池登记**：帮助中心重做、升级 E2E／候选验证、W-B 语义发布、SRR／OIDC／AccessMap SC
  等验收项明确进池，避免本版叙述越界。

### Fixed
- **筛选栏文本输入框的中文输入法**：在访问日志、配置审计、Token 管理、语义资产与发布历史页的
  筛选栏文本输入框中输入中文时，输入法组合不再被打断——候选窗不再逐键消失，拼音缓冲不再被
  追加成 `zhongzhongwen` 一类的拼接乱码，最终上屏为正常中文。键入的末尾空格会原样保留在
  输入框里，筛选结果不受影响。
- **启用表范围列宽与编辑连接字段标签对齐**。
- **访问关系图合流门禁**：修复 tip CI 上 AccessMap 重复键／URL 驱动输入、ops-questioning 资产路径与
  e2e-harness，使 `lucy-v0.25` Required checks 可绿。

### 已知限制
- 容器生命周期验收（首次启动失败、自发退出、SIGTERM 无遗留进程、退出码）需在镜像重建后
  执行 `scripts/verify/verify-ktx-reload-lifecycle.sh --container`；本次交付只完成了本地
  进程级实测（`--local`）。
- **无 GitHub 客户放行链**：仓库无 `lucy-protected` self-hosted runner，`real-e2e` →
  `customer-release-readiness` → `release-package` 链不可在 GitHub Actions 完成；本版不得宣称
  经自动化客户发布链验证的制品身份。
- **本版不主张**：帮助中心体验重做（L25-12）；客户升级 E2E 自动化／升级候选验证环境
  （L25-07／13）；运维控制面语义发布 W-B（L25-16）；正式生产放行（`productionReady`）在无 UX
  走查证据与无交付包身份时不得置真。
- **验收仍在 `0.30` 池**：SRR 正式验收矩阵、OIDC 验收矩阵、AccessMap SC 矩阵等；代码或证据包
  落地不等于对应正式验收已闭合。

---

## Unreleased — M31 / A2 — Configurable Content Root

> Target release: M31 (post-0.17.0). WebUI loads `semantic-layer/`, `wiki/`,
> `evals/`, `skills/` from a configurable root instead of treating them as
> siblings of `ktx.yaml`.

### Added
- **Resolver**: `webui/server/paths.ts` — `resolveContentPaths()`, `loadContentPaths()` (cached), `invalidateContentPathsCache()`, `ensureContentDirs()`. Reads `LUCY_CONTENT_ROOT` env first, then `ktx.yaml` `paths.content_root`, then defaults to `<projectRoot>/config/`.
- **`ktx.yaml` override**: top-level `paths.content_root` (string, relative or absolute).
- **Env override**: `LUCY_CONTENT_ROOT` — absolute or relative to project root.
- **Tests**: `webui/server/__tests__/paths.test.ts` (resolver unit), `webui/server/__tests__/fs-safe.config-root.test.ts` (dynamic ALLOW across both layouts).
- **E2E fixture**: `scripts/demo/init-e2e-fixture.sh` now seeds `config/{semantic-layer,wiki}/`; `webui/playwright.config.ts` webServer env adds `LUCY_CONTENT_ROOT=$PROJECT_DIR/config`.
- **Migration guide**: `docs/plans/M31-config-subdir-migration.md`.
- **Docker entrypoint**: `scripts/runtime/docker-entrypoint.sh` resolves `LUCY_CONTENT_ROOT`, seeds into the resolved root, and mirrors to `<projectRoot>/runtime/` so `@kaelio/ktx`'s sibling view keeps working.
- **Smoke**: `scripts/smoke/headless-config-smoke.mjs` honours `LUCY_CONTENT_ROOT` (default `./config`); CI can run legacy + new layout from one script.
- **`customer-config.example/` migrated**: 4 content dirs now under `customer-config.example/config/`.

### Changed
- **`fs-safe.ts` ALLOW list is dynamic**: split into `CONTENT_PREFIXES` (semantic-layer/evals/skills/wiki) resolved from the content root, and `ROOT_PREFIXES` (.ktx-ui/webui/config) at project root. No behaviour change for legacy layout.
- **Demo compose files** bind mounts target `<configRoot>/evals`:
  `deploy/compose/docker-compose.demo.yml`, `docker-compose.postgres-demo.yml`, `docker-compose.executive-poc.yml`. All three also export `LUCY_CONTENT_ROOT=${LUCY_CONTENT_ROOT:-/data/lucy/config}`.
- **`ktx.yaml.example`**: documents the `paths.content_root` override.

### **Breaking** for direct dev checkouts (M30 → M31)
- After upgrading, a project that still has `semantic-layer/`, `wiki/`, `evals/`, `skills/` as siblings of `ktx.yaml` will appear empty in the WebUI. Resolution: either `mv <dir> config/`, or set `LUCY_CONTENT_ROOT=.` (env) / `paths.content_root: .` (`ktx.yaml`).
- The `customer-config.example/` fixture tree changed shape: 4 content dirs now under `customer-config.example/config/`. Any script or doc that `cp -R`'d `customer-config.example/{semantic-layer,wiki,evals,skills}` into a deliverable needs updating — see `docs/plans/M31-config-subdir-migration.md` and the updated cp snippets in `docs/plans/wo-202608-07-customer-amd64-delivery.md`.

### Migration
- Recommended: `mkdir -p config && mv semantic-layer wiki evals skills config/` (or `git mv` if tracked) + restart Lucy.
- Legacy escape hatch: `export LUCY_CONTENT_ROOT=.` (env) or `paths.content_root: .` (ktx.yaml). Supported through at least M32 / M33.
- Full guide: `docs/plans/M31-config-subdir-migration.md`.

### Out of scope (this release)
- `@kaelio/ktx` itself is unchanged. The sibling view is preserved via the runtime mirror populated by `docker-entrypoint.sh`. Direct `ktx mcp start` outside Docker against a non-sibling layout will still complain — the mirror is a Docker-time concern.
- `webui/config/access.yaml`, `.ktx/secrets/`, `.ktx-ui/` remain at project root. Not part of the content root.
- The `webui/` directory tree (config code) is unchanged.

---

## 0.17.0

Pre-2.0.0 line. Content dirs are siblings of `ktx.yaml`. No `LUCY_CONTENT_ROOT` env, no `paths.content_root` in `ktx.yaml`, no resolver.
