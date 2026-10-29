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

## Unreleased — v0.25（开发线）

> 目标版本：v0.25 开发线。版本号在发版台账统一递增，本节只记录用户可见变化，
> 不代表已切版本。

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
    增删在写入 `ktx.yaml` 后如实回报「执行层尚未加载」，但**不自动触发**重载。
  - 容器入口 `scripts/runtime/docker-entrypoint.sh` 引入 KTX supervisor：进程归属、信号转发、
    退出码、首次启动失败不退化、自发退出的有限退避重启与遗留进程清理全部显式定义。
- **运维问数连接（Spec 149）**：新增只读连接 `lucy-ops`，把审计热库的调用流水做成两张视图
  （`ops_calls`、`ops_call_tables`），授权后的 Agent 可追问「某张表上谁被拒绝、生成 SQL 是什么」
  「某个工具的失败是否集中在一个 Agent」。
  - 连接在**启动时**幂等建立：容器入口在 KTX daemon 启动**之前**完成视图、连接块、内容根资产
    与项目根镜像，并写下 `ktx.yaml` 摘要戳；已有卷第一次补上该连接时状态为「未就绪」，
    需所有者按 Spec 191 确认重载后才可查询，**不自动重载**。
  - 授权只认**显式列出**：只有 `allow.connections` 里写明 `lucy-ops` 的 Role 能看见并查询它；
    `*` 与 `catalog_bound`（含 `lucy_admin`）都不算。
  - 连接不可删除：删除接口在预览与写入时都返回 400 `OPS_EVIDENCE_CONNECTION_PROTECTED`，
    审计库与三类资产保持不动。
  - 本连接只回答**活跃 Agent**：不把 `token_label` 去重称为业务活跃 Token，不回答访问账户，
    `call_day` 是 UTC 日历日，生成 SQL 只在过滤后的明细里取。
  - Docker demo 模板新增演示运维问数 Agent `demo_ops` 与运维问数角色 `lucy_ops_reader`；
    `demo_readonly` 与 `lucy_admin` 的既有权限不变。

### Changed
- **文档口径**：`ktx.yaml` 新连接或凭据的生效说明从「可能需要重启 KTX MCP daemon」改为
  「在 MCP 调试台点『重载执行层』」；`McpRuntimeStatusPanel` 的待确认提示不再指向人工重启。

### Changed
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

### Fixed
- **筛选栏文本输入框的中文输入法**：在访问日志、配置审计、Token 管理、语义资产与发布历史页的
  筛选栏文本输入框中输入中文时，输入法组合不再被打断——候选窗不再逐键消失，拼音缓冲不再被
  追加成 `zhongzhongwen` 一类的拼接乱码，最终上屏为正常中文。键入的末尾空格会原样保留在
  输入框里，筛选结果不受影响。

### 已知限制
- 容器生命周期验收（首次启动失败、自发退出、SIGTERM 无遗留进程、退出码）需在镜像重建后
  执行 `scripts/verify/verify-ktx-reload-lifecycle.sh --container`；本次交付只完成了本地
  进程级实测（`--local`）。

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
