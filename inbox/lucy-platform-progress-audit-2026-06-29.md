# Lucy MCP Platform Progress Audit

| 元数据  | 内容                                                                                           |
| ---- | -------------------------------------------------------------------------------------------- |
| 审计日期 | 2026-06-29 09:49 CST                                                                         |
| 审计范围 | 对照 `docs/lucy-platform-goal-checklist.md` v0.3 及相关产品化、WebUI、release gate 文档，检查当前仓库实现和本地可复验状态 |
| 输出位置 | `inbox/lucy-platform-progress-audit-2026-06-29.md`                                           |
| 审计方式 | 文档对照 + 代码/路由/API 证据检查 + 轻量本地门禁命令                                                             |
| 结论等级 | 接近产品化闭环，但当前 release gate 不全绿                                                                 |

## 1. Executive Summary

Lucy 当前已经从早期本地 POC 进入「单机 Docker Compose 产品化候选」形态：Docker/KTX runtime、WebUI 主模块、MCP proxy、Auth/ACL/audit、Admin、Eval 管理、demo 数据库、release CI 与产品文档体系均有落点。

但截至本次审计，**不能把当前工作区判定为 release-ready**。主要原因不是核心代码缺失，而是：

1. `npm run lint:spec` 失败，说明实现/API 与 `webui/docs/03-api-spec.md` 有漂移。
2. 当前默认 Node 22 与本机已编译的 `better-sqlite3` ABI 不一致，导致默认 `npm --prefix webui test` 失败；切到 Node 24 后 WebUI 全量测试通过。
3. `docs/webui-feature-map.md` 仍停留在较早状态，和 `docs/webui-impl-status.md` / `docs/project-overview.md` 对 Admin、Eval、Audit 的判断冲突。
4. checklist 中仍有 5 个 `partial` 能力：Semantic layer management、Wiki/context management、Skill management、MCP endpoint management、Business eval。它们不是空白，但还未完全满足各自 acceptance criteria。

## 2. Capability Checklist 对照

| Capability                  | Checklist 状态 |                          本次审计判断 | 证据与说明                                                                                    |
| --------------------------- | -----------: | ------------------------------: | ---------------------------------------------------------------------------------------- |
| Goal checklist spec         |  implemented |                  保持 implemented | `docs/lucy-platform-goal-checklist.md` 存在且结构完整                                           |
| Product boundary            |  implemented |                  保持 implemented | `docs/project-overview.md` 明确 Lucy 不 fork KTX，Docker image 内置 KTX runtime                |
| Docker deploy               |     verified |                      证据存在，未本次重跑 | `Dockerfile`、`docker-compose.yml`、release CI 和 smoke 脚本存在；本次因 `lint:spec` 失败未重跑 P0 smoke |
| Bundled KTX runtime         |     verified |                      证据存在，未本次重跑 | `Dockerfile` / compose pin `@kaelio/ktx@0.13.0`                                          |
| Runtime healthcheck         |     verified |                      证据存在，未本次重跑 | `scripts/docker-healthcheck.sh`、Docker `HEALTHCHECK` 存在                                  |
| Database connection         |     verified |                     保持 verified | MySQL / PostgreSQL demo compose、customer smoke 脚本、连接 WebUI 页面均存在                         |
| Schema scan/read            |     verified |                     保持 verified | `semantic-layer/`、demo project templates、`sl_read_source` smoke 证据存在                     |
| Semantic layer management   |      partial |               保持 partial，代码强于状态 | Table catalog/editor/join/review 已实现并测试；acceptance 中 reindex 闭环和完整产品化体验仍未在本次复验           |
| Wiki/context management     |      partial |               保持 partial，代码强于状态 | `WikiEditor` 与 API 已实现；KTX wiki 检索命中未本次复验                                                |
| Skill management            |      partial |                      保持 partial | `skills/` 有内容，缺 WebUI Skill Editor / 版本化 / eval 回归闭环                                     |
| MCP endpoint management     |      partial |                      保持 partial | Proxy 与 onboarding 配置复制存在；缺 endpoint 生命周期管理/状态控制                                         |
| Auth / ACL / audit          |     verified | 代码证据支持 verified，但 API spec 漂移需修 | Admin/API/proxy/audit 代码和测试存在；`lint:spec` 指出新 audit endpoints 未写入 API spec               |
| Agent onboarding            |     verified |                     保持 verified | `/onboarding`、Agent/token 页面、MCP config 入口存在                                             |
| MCP client compatibility    |     verified |                     仅文档验收，未本次复验 | checklist 标注 2026-06-24 人工验收 Claude Code/Codex/Openclaw/Hermes/Cursor；本次未重跑五客户端          |
| Business eval               |      partial |                      保持 partial | `npm run smoke:p0:business-eval` 通过，覆盖 catalog 可读；完整 LLM/agent eval 仍依赖外部环境              |
| Runtime compatibility tests |     verified |          证据存在，未本次重跑 Docker/demo | smoke 脚本存在；当前 P0 local smoke 会被 `lint:spec` 阻断                                           |
| Platform smoke tests        |     verified |                    降为「当前工作区不全绿」 | WebUI build/test 可通过，但 `lint:spec` 失败，故 release gate 当前失败                                |
| Release gates               |     verified |                   降为「定义完整但当前失败」 | `.github/workflows/lucy-release.yml` 存在；`spec-and-webui` 第一段会因 `lint:spec` 失败阻断          |
| Version matrix              |  implemented |                  保持 implemented | `docs/version-matrix.md` 存在，但 MCP client matrix 比 checklist 窄，需同步                        |
| Upgrade compatibility       |  implemented |                  保持 implemented | `scripts/ktx-upgrade-compat.mjs` 与 CI job 存在                                             |

计数按 checklist 原状态：11 verified、4 implemented、5 partial、0 missing。按本次“当前工作区可复验”口径：核心实现大多存在，但 release-ready 状态被 `lint:spec` 阻断。

## 3. 本地验证结果

| 命令                                                                                             |   结果 | 说明                                                              |
| ---------------------------------------------------------------------------------------------- | ---: | --------------------------------------------------------------- |
| `npm run security:baseline`                                                                    | PASS | `0 warning(s)`                                                  |
| `npm run smoke:p0:business-eval`                                                               | PASS | Superstore 17 case、KX Financial 26 case catalog 可读              |
| `PATH=/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:$PATH npm --prefix webui test`      | PASS | 31 test files / 186 tests passed                                |
| `PATH=/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:$PATH npm --prefix webui run build` | PASS | Vite build 通过；有 chunk >500KB warning                            |
| `npm run lint:spec`                                                                            | FAIL | `webui/docs/03-api-spec.md` 缺 4 个 Admin Audit endpoints         |
| `npm --prefix webui test`（默认 Node 22）                                                          | FAIL | 本机 `better-sqlite3` 原生模块用 Node ABI 137 编译，默认 Node 22 需要 ABI 127 |
| `curl http://127.0.0.1:5174/api/health`                                                        | PASS | 当前本机后端健康；返回 `ok:true`                                           |
| `curl http://127.0.0.1:5173/`                                                                  | PASS | 当前本机 Vite 前端可访问                                                 |

`lint:spec` 缺失的 API spec 条目：

- `GET /api/admin/audit/:id/sources`
- `GET /api/admin/audit/turns`
- `GET /api/admin/audit/turns/:turnId`
- `POST /api/admin/audit/conversation-turns/purge`

代码中这些端点已存在于 `webui/server/admin/audit.ts`，并且在 Node 24 测试环境下相关测试通过。因此这是**文档/spec 漂移**，不是已观察到的实现缺失。

## 4. 文档一致性审计

### 4.1 可信度较高的当前状态文档

- `docs/lucy-platform-goal-checklist.md`：产品化验收主合同，状态粒度清楚。
- `docs/project-overview.md`：当前模块索引较新，反映 Admin/Eval 已实现。
- `docs/webui-impl-status.md`：列出了当前 WebUI 前后端文件、API、测试覆盖。
- `docs/test-layers-and-release-gates.md`：测试分层与 gate 命令清晰。
- `docs/release-ci.md`：CI job 与 release artifact 描述和 workflow 对齐。
- `docs/access-governance-design.md`：权限治理现状与剩余边界较完整。

### 4.2 已明显过期或需标记历史态的文档

- `docs/webui-feature-map.md`：仍称 Admin、Eval、Audit 多项缺失，但当前代码已有 `/admin/agents`、`/admin/audit`、`/eval/cases`、`/eval/runs`、`/eval/monitor` 等路由和测试。建议改名为历史缺口分析，或按当前实现重写。
- `webui/docs/codex/progress.md`：更新时间是 2026-06-16，仅覆盖 M0-M5，不应再作为当前完整 WebUI 范围依据。
- `docs/version-matrix.md`：MCP Client Matrix 写得比 checklist 保守；checklist 称五个 MCP client 已人工验收，version matrix 仍写 Codex/Claude Code “project-local usage exists”、cloud-hosted agent “not verified”。两者需统一。
- `inbox/lucy-platform-productization-todo-2026-06-21.md`：主体状态是推进日志，可作历史证据；其中末尾仍保留某些 P1 进行中描述，需和 `docs/access-governance-design.md` 的 DC1/DC2/DC3 决策保持同步。

## 5. 当前能力成熟度判断

| 模块 | 成熟度 | 判断 |
|---|---:|---|
| Docker / bundled KTX / demo DB | 高 | 文件、脚本、CI、文档齐；本次未重跑 Docker gate |
| WebUI 基础治理工作台 | 高 | 主要页面、API、测试都已存在；Node 24 环境全量测试通过 |
| Auth / ACL / Audit | 中高 | 实现和测试充分；API spec 漂移需修；reload/≤2s revoke 已明确延期 |
| Eval 管理与监控 | 中高 | WebUI 管理、运行历史、趋势监控存在；完整 LLM/agent eval 仍外部依赖 |
| Semantic layer / Wiki 管理 | 中高 | UI/API 已成熟；checklist acceptance 里 reindex / search 命中仍需产品验收证据 |
| Skill management | 中低 | 目录资产存在，但管理闭环不足 |
| MCP endpoint lifecycle | 中 | Proxy 和配置复制可用；端点启停/状态/生命周期管理仍偏运维脚本形态 |
| Release readiness | 中 | Gate 定义完整，但当前 `lint:spec` 失败，默认 Node 环境也有本机可复验问题 |

## 6. 风险与阻塞

### P0: Release gate 当前失败

`npm run lint:spec` 失败会阻断 `scripts/p0-smoke.mjs` 和 GitHub Actions `spec-and-webui` job。建议立即补 `webui/docs/03-api-spec.md` 中缺失的 4 个 Admin Audit endpoints，然后重跑：

```bash
npm run lint:spec
PATH=/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:$PATH npm --prefix webui test
PATH=/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:$PATH npm --prefix webui run build
```

### P1: 本机 Node 版本与原生依赖 ABI 不一致

默认 `node` 是 v22.22.2（ABI 127），但 `webui/node_modules/.../better_sqlite3.node` 是 Node 24 ABI 137。用 Node 24 放到 PATH 前面测试全绿。建议二选一：

- 统一本机开发 Node 到 Node 24；或
- 用 Node 22 重新安装/rebuild `webui` 依赖，使本机与 CI 的 Node 22 对齐。

CI 使用 `actions/setup-node@v4 node-version: 22` 并执行 fresh `npm ci`，理论上不受本机 ABI 污染影响。

### P1: 文档状态漂移

`docs/webui-feature-map.md` 和 `webui/docs/codex/progress.md` 会误导后续 agent 低估当前实现。建议在正式文档索引中标注它们的历史性质，或刷新为当前版。

### P2: partial 能力需要验收证据补齐

Semantic layer、Wiki、Skill、MCP endpoint management、Business eval 仍应按 checklist acceptance criteria 补证据或改状态。尤其 Skill management 目前更像“资产存在”而非“平台管理能力”。

## 7. 建议下一步

1. 修复 API spec 漂移：补 `webui/docs/03-api-spec.md` 4 个 Admin Audit endpoints，使 `npm run lint:spec` 回绿。
2. 统一本机 Node 验证姿势：明确本仓库当前推荐 Node 22 还是 Node 24，并处理 `better-sqlite3` rebuild/install。
3. 重跑 release baseline 的轻量段：`lint:spec`、`security:baseline`、WebUI test/build、business eval catalog。
4. 若 Docker daemon 可用，再重跑 `npm run smoke:p0:docker`、`npm run smoke:p0:demo`、`npm run smoke:p0:postgres-demo`。
5. 刷新或降级旧文档：重点是 `docs/webui-feature-map.md`、`webui/docs/codex/progress.md`、`docs/version-matrix.md` MCP client matrix。
6. 对 checklist 5 个 partial 项逐一补“验收证据”：能升 verified 的升，不能升的明确剩余缺口。

## 8. 附：本次审计读取的主要证据

- `docs/lucy-platform-goal-checklist.md`
- `docs/project-overview.md`
- `docs/webui-impl-status.md`
- `docs/webui-feature-map.md`
- `docs/test-layers-and-release-gates.md`
- `docs/release-ci.md`
- `docs/version-matrix.md`
- `docs/product-docs-index.md`
- `docs/access-governance-design.md`
- `docs/design-eval-monitoring.md`
- `inbox/lucy-platform-productization-todo-2026-06-21.md`
- `webui/src/app/App.tsx`
- `webui/server/admin/*`
- `webui/server/eval/*`
- `webui/server/proxy/*`
- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/lucy-release.yml`
- `scripts/p0-smoke.mjs`
- `scripts/security-baseline.mjs`
- `scripts/p0-business-eval-smoke.mjs`
