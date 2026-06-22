# Lucy MCP Platform Goal Checklist

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy MCP Platform Goal Checklist |
| 文档类型 | Goal / Acceptance Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-21 |
| 适用范围 | Lucy 从本地 POC / 内测工程形态走向可部署 MCP 服务管理平台的产品化验收 |

## 1. Goal

Lucy 的目标是成为位于数据库和 agents 之间的 MCP 服务管理平台。

最终用户应能够：

1. 通过 Docker 部署 Lucy。
2. 在 Lucy 中接入数据库。
3. 扫描或读取数据库 schema。
4. 配置、校验并重建 semantic layer / wiki / related context。
5. 启动或管理 MCP endpoint。
6. 在 agents 平台配置 MCP endpoint/token。
7. 让 agent 通过 Lucy 安全访问数据能力。

## 2. Product Boundary

Lucy 的产品边界如下：

- Lucy repo 是 MCP 服务管理平台仓库，不 fork / vendor KTX 源码。
- Lucy Docker image 是客户交付物，必须内置固定版本 KTX runtime。
- KTX 是 Lucy 的 bundled runtime dependency，负责底层 CLI、MCP server、semantic-layer runtime 等能力。
- Lucy 负责配置管理、WebUI、权限、审计、MCP 管理、eval 验收、部署体验和产品化交付。
- 客户不应被要求自行安装 KTX、Node、Python、pnpm 或 uv 才能完成标准部署。

推荐表达：

```text
Lucy repo = Lucy platform source
KTX = bundled runtime dependency
Lucy Docker image = Lucy platform + pinned KTX runtime
```

## 3. Scope

本 checklist 覆盖：

- Docker 部署。
- KTX runtime 集成。
- 数据库接入。
- semantic layer / wiki 管理。
- MCP endpoint / token / agent 接入。
- WebUI onboarding。
- 权限、ACL 与 audit。
- smoke / eval / release gate。
- 版本矩阵、升级与兼容性。

## 4. Non-goals

以下不属于 Lucy 当前产品化目标：

- 在 Lucy repo 中复制、维护或长期 fork KTX 源码。
- 重新实现 KTX semantic-layer engine、KTX CLI 或 KTX MCP server。
- 让客户直接操作 KTX monorepo、pnpm workspace、uv runtime 或上游发布脚本。
- 在首个 Docker 产品化闭环中同时覆盖所有数据库、所有 MCP client 和所有部署平台。
- 用业务 eval 替代 runtime compatibility tests 或 platform smoke tests。

## 5. Capability Checklist

| Capability | Status | Evidence | Acceptance Criteria |
|---|---|---|---|
| Goal checklist spec | implemented | `docs/lucy-platform-goal-checklist.md` | 产品 goal、边界、scope、non-goals、capability checklist、release gates、open risks 已明确 |
| Product boundary | implemented | 本文 §2 | 文档明确 Lucy repo 不 fork KTX；Lucy Docker image 内置 pinned KTX runtime |
| Docker deploy | verified | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/docker-entrypoint.sh`, `docs/deployment-docker.md`; `npm run smoke:p0:docker`; `.github/workflows/lucy-release.yml` | `docker compose up` 后 WebUI `/api/health` 可访问，MCP proxy 端口可响应，容器内 `ktx --version` 可执行 |
| Bundled KTX runtime | verified | `Dockerfile` pins `@kaelio/ktx@0.13.0`; `npm run smoke:p0:docker` | 镜像内 `ktx --version` 与 `/api/health.data.bundledKtxVersion` 均验证为 `0.13.0` |
| Runtime healthcheck | verified | `scripts/docker-healthcheck.sh`; `Dockerfile` `HEALTHCHECK`; `npm run smoke:p0:docker` | healthcheck 覆盖 KTX CLI、Lucy server、MCP endpoint 基础可用性；容器运行验证已通过 |
| Database connection | verified | `ktx.yaml`, `ktx.yaml.example`, `docker-compose.demo.yml`, `docker-compose.postgres-demo.yml`, `examples/docker-demo/`, `examples/postgres-demo/`; `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer` | Demo Docker MySQL、Demo Docker PostgreSQL 与本机真实 MySQL 连接均有验证路径；WebUI 配置向导属于后续体验增强 |
| Schema scan/read | verified | `semantic-layer/`, `examples/docker-demo/project-template/semantic-layer/`, `examples/postgres-demo/project-template/semantic-layer/`; `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo` | Demo gate 经 Lucy MCP Proxy 调用 `sl_read_source` 读取语义/schema 内容；KTX 0.13.0 无顶层 `scan` 命令，P0 以 manifest/read/reindex 覆盖 |
| Semantic layer management | partial | `semantic-layer/`, `webui/server/semantic-layer.ts`, `webui/src/pages/TableEditor.tsx` | 用户可编辑、保存、diff、validate、reindex semantic-layer overlay |
| Wiki/context management | partial | `wiki/`, `webui/server/wiki.ts`, `webui/src/pages/WikiEditor.tsx` | 用户可维护 wiki/context，并让 KTX wiki 检索命中 |
| MCP endpoint management | partial | `.mcp.json`, `webui/server/proxy/*`, `webui/src/pages/Onboarding.tsx`, `webui/docs/07-mcp-auth-proxy-spec.md` | 用户可获得 agents 平台可用的 MCP endpoint/token 配置 |
| Auth / ACL / audit | verified | `webui/config/access.yaml`, `webui/server/proxy/*`, `webui/server/admin/*`, `docs/security-guide.md`, `scripts/security-baseline.mjs`; `npm run security:baseline` | token、role/ACL、audit log 可配置、可验证、可追溯 |
| Agent onboarding | verified | `webui/src/pages/Onboarding.tsx`, `webui/src/__tests__/onboarding.test.tsx`, `docs/deployment-docker.md`; `npm run smoke:p0:demo`, `npm run smoke:p0:customer` | MCP 配置文档已有；demo gate 使用 bearer token 经 Lucy MCP Proxy 完成 `sl_read_source` 与 `sl_query`；WebUI 已提供上线检查和 MCP config 复制入口 |
| Business eval | partial | `evals/`, `scripts/eval-runner.mjs`, `scripts/p0-business-eval-smoke.mjs`; `npm run smoke:p0:business-eval` | 核心 eval suite 可被 runner 读取；完整 LLM/agent eval 执行仍依赖外部 agent/model 环境 |
| Runtime compatibility tests | verified | `scripts/p0-smoke.mjs`, `scripts/p0-demo-docker-smoke.mjs`, `scripts/p0-postgres-demo-smoke.mjs`, `scripts/p0-customer-path-smoke.mjs`; `npm run smoke:p0:docker`, `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer` | 内置 KTX 的 version、Python runtime、MCP tools/list、semantic-layer validate/query 基础能力已有 MySQL/PostgreSQL smoke gate |
| Platform smoke tests | verified | `scripts/p0-smoke.mjs`, `scripts/p0-demo-docker-smoke.mjs`, `scripts/p0-postgres-demo-smoke.mjs`; `npm run smoke:p0`, `npm run smoke:p0:docker`, `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo` | WebUI build/test、API health、static SPA、Docker compose、MCP proxy auth/ACL 关键路径已覆盖 |
| Release gates | verified | `.github/workflows/lucy-release.yml`; `docs/release-ci.md`; `npm run smoke:p0`, `npm run security:baseline`, `npm run smoke:p0:docker`, `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer`, `npm run smoke:p0:business-eval`, `npm run audit:ktx-diff`, `npm run compat:ktx-upgrade`; `inbox/lucy-p0-security-baseline-2026-06-21.md` | P0 自动化 release baseline 已有可复验命令；P1 已补 KTX diff audit、WebUI onboarding、PostgreSQL gate、release artifacts 与 Docker secrets 示例；完整 LLM business eval 仍依赖外部 agent/model 环境 |
| Version matrix | implemented | `docs/version-matrix.md` | Lucy version、bundled KTX version、Node/Python/runtime、数据库、MCP client 兼容性可追踪 |
| Upgrade compatibility | implemented | `scripts/ktx-upgrade-compat.mjs`, `docs/release-ci.md`, `.github/workflows/lucy-release.yml` | KTX 升级前后自动验证 CLI/MCP/semantic-layer/config 兼容性 |

Status 定义：

- `missing`：尚无可验证实现。
- `partial`：已有代码或文档基础，但尚未形成完整产品闭环。
- `implemented`：已有明确实现或正式文档，但未必经过 release gate。
- `verified`：已通过对应 acceptance criteria 和证据验证。

## 6. Release Gates

首个可交付 Docker 版本至少需要通过以下 P0 gates：

| Gate | Required Evidence | Pass Criteria |
|---|---|---|
| Docker smoke | 本地命令或 CI 日志 | image 可构建；`docker compose up` 可启动；healthcheck 通过 |
| KTX compatibility smoke | smoke 日志 | 镜像内 `ktx --version`、MCP `tools/list`、基础 semantic-layer validate/query 命令可用 |
| Lucy platform smoke | smoke 日志 | WebUI/API/proxy/auth/audit P0 路径可访问且返回预期结果 |
| Customer main path smoke | e2e 日志或录屏 | 配数据库、读 schema、validate/reindex、启 MCP、agent 查询数据可复验 |
| Business eval smoke | eval report | 核心 eval suite 可被 runner 读取；完整 LLM/agent eval 在具备 agent/model secret 的环境运行 |
| Security baseline | checklist / test report | secrets 不写入镜像；token/ACL/audit 基础路径可验证；日志不泄露明文密码 |

## 7. Test Layers

Lucy 的测试与 eval 分三层，不能互相替代：

| Layer | 目的 | 示例 |
|---|---|---|
| Runtime compatibility tests | 验证 bundled KTX runtime 在 Lucy 镜像中可用 | `ktx --version`、`ktx status`、MCP tools list、semantic-layer validate |
| Platform tests | 验证 Lucy 自身管理平台行为 | WebUI/API/proxy/auth/audit/config save/reindex |
| Business evals | 验证 agent 在业务语义和 wiki 加持下能回答真实问题 | `evals/superstore/*`、`evals/kx_financial/*` |

现有 `evals/` 属于 business eval / product acceptance 层，不替代 runtime compatibility tests 或 platform tests。

## 8. Evidence Links

| 主题 | Evidence |
|---|---|
| KTX vs Lucy diff 审计 | `inbox/ktx-lucy-diff-2026-06-21.md` |
| 产品化动态 todo | `inbox/lucy-platform-productization-todo-2026-06-21.md` |
| Docker 部署 | `docs/deployment-docker.md` |
| 项目概览 | `docs/project-overview.md` |
| 开发治理 | `docs/DEVELOPMENT.md` |
| WebUI 当前状态 | `docs/webui-impl-status.md` |
| MCP Auth Proxy | `webui/docs/07-mcp-auth-proxy-spec.md` |
| DB 接入设计 | `docs/design-db-connection.md` |
| Eval 约定 | `docs/eval-quiz-conventions.md` |

## 9. Open Risks / Pending Questions

| Question | Current Position | Required Decision |
|---|---|---|
| Bundled KTX pinning source | 首版 Dockerfile 使用 npm release `@kaelio/ktx@0.13.0` | 正式 release policy 是否允许只 pin npm release，还是还要记录 git SHA / SBOM |
| 首版部署形态 | 已按单机 Docker Compose 起步 | 后续是否增加 Kubernetes/Helm 路径 |
| 首版数据库范围 | MVP 明确支持 MySQL + PostgreSQL；StarRocks 转 roadmap candidate | StarRocks 是否启动 DB-4 协议兼容 spike |
| MCP endpoint 暴露方式 | 首版 Docker 采用 Lucy proxy 对外统一暴露；KTX upstream 只在容器内使用 | 是否需要支持高级用户直连 KTX upstream |
| P0 smoke 数据源 | 已新增 demo MySQL compose；本机客户主链路也已用真实 MySQL 验证 | demo DB 作为可重复 CI gate，真实库作为人工验收补充 |
| secrets 管理 | 首版支持 `/data/lucy/.ktx/secrets/*` 文件路径；已补 `docker-compose.secrets.yml` 作为 Docker secrets override 示例 | 是否继续补 env var / WebUI secret onboarding |
| `sl_validate` MCP tool | KTX 0.13.0 MCP `tools/list` 不暴露 `sl_validate`；CLI `ktx sl validate` 可用 | docs / ACL / eval 假设是否要按当前 KTX tool surface 校准 |

## 10. Update Rule

每次完成产品化推进项，应同步更新：

1. 本文 `Capability Checklist` 的 `Status`、`Evidence`、`Acceptance Criteria`。
2. `inbox/lucy-platform-productization-todo-2026-06-21.md` 的 todo 状态、进度日志和待决问题。
3. 如涉及正式模块状态，更新 `docs/project-overview.md` 或对应模块 spec。
