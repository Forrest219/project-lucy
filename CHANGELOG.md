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

### Changed
- **文档口径**：`ktx.yaml` 新连接或凭据的生效说明从「可能需要重启 KTX MCP daemon」改为
  「在 MCP 调试台点『重载执行层』」；`McpRuntimeStatusPanel` 的待确认提示不再指向人工重启。

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
