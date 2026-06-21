# Lucy MCP Platform Productization Todo

生成日期：2026-06-21

## Goal

Lucy 的最终目标是成为位于数据库和 agents 之间的 MCP 服务管理平台：

- 用户可以通过 Docker 部署 Lucy。
- Lucy 镜像内置固定版本 KTX runtime。
- 用户接入数据库、配置语义层，即可在 agents 平台配置 MCP endpoint/token 接入数据能力。
- Lucy repo 不 fork / vendor KTX 源码；Lucy Docker image 负责集成 pinned KTX runtime。

## Current Assessment

当前 Lucy 更接近本地 POC / 内测工程形态，已经具备平台化底座：

- `webui/`：管理界面与 server/API/proxy/auth/audit 雏形。
- `semantic-layer/`：业务语义层。
- `wiki/`：业务知识库。
- `evals/`：业务问答验收。
- `ktx.yaml` / `.mcp.json`：KTX 项目配置与 MCP 接入配置。

距离客户可部署产品形态的主要差距：

- 尚无 Docker 交付骨架。
- 尚无 bundled KTX runtime 版本锁定与验证。
- 尚无客户部署主链路的端到端验收。
- 尚无平台级 smoke / compatibility / release gate。
- 尚无正式 goal checklist spec。

## P0 Todo

| ID | Item | Status | Evidence | Acceptance Criteria |
|---|---|---|---|---|
| P0-1 | 新增 Goal Checklist Spec | done | `docs/lucy-platform-goal-checklist.md` | spec 明确 goal、scope、non-goals、capability checklist、release gates、evidence links、open risks |
| P0-2 | 明确产品边界 | done | `docs/lucy-platform-goal-checklist.md` §2；`docs/project-overview.md` | 文档明确 Lucy repo 不 fork KTX；Lucy Docker image 内置 pinned KTX runtime |
| P0-3 | 补 Docker 交付骨架 | done | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/docker-entrypoint.sh`, `scripts/docker-healthcheck.sh`, `docs/deployment-docker.md`; `npm run smoke:p0:docker` | 文件已落地；Docker image 可构建；`docker compose up` 后 WebUI `/api/health` 可访问，MCP proxy 端口可响应，容器可执行 `ktx --version` |
| P0-4 | 内置并锁定 KTX runtime | done | `Dockerfile` pins `@kaelio/ktx@0.13.0`; `npm run smoke:p0:docker` verifies `/api/health.data.bundledKtxVersion` and `ktx --version` | 镜像构建逻辑已锁定 bundled KTX；镜像内 `ktx --version` 与 `/api/health` bundledKtxVersion 均验证为 `0.13.0` |
| P0-5 | 打通客户部署主链路 | done | `docker-compose.demo.yml`, `examples/docker-demo/`, `scripts/p0-demo-docker-smoke.mjs`; `npm run smoke:p0:demo`, `npm run smoke:p0:customer` | Demo Docker 路径已验证：MySQL demo DB、Lucy 镜像、KTX runtime、连接测试、reindex、SL validate/query、Lucy MCP Proxy bearer token、`sl_read_source`、`sl_query`；本机真实 MySQL 路径也已验证 |
| P0-6 | 建立 P0 质量门禁 | done | `scripts/p0-smoke.mjs`, `scripts/p0-demo-docker-smoke.mjs`, `scripts/p0-customer-path-smoke.mjs`, `scripts/p0-business-eval-smoke.mjs`; `npm run smoke:p0`, `npm run smoke:p0:docker`, `npm run smoke:p0:demo`, `npm run smoke:p0:customer`, `npm run smoke:p0:business-eval` | P0 自动化 release baseline 已形成；完整 LLM/agent business eval 与 WebUI onboarding 体验升级转 P1/P2 |

## P1 Todo

| ID | Item | Status | Evidence | Acceptance Criteria |
|---|---|---|---|---|
| P1-1 | 将 diff 审计固化为持续监控脚本 | pending | current report: `inbox/ktx-lucy-diff-2026-06-21.md` | 可重复生成 KTX vs Lucy 一级/二级目录和文件差异 |
| P1-2 | 完善 WebUI onboarding | pending | `webui/` | 数据库连接、语义层编辑、validate/reindex、MCP 配置复制形成完整 UI 流程 |
| P1-3 | 补客户部署文档 | pending | planned docs | 包含 compose、env、持久化、数据库连接、agents MCP 配置、升级/回滚 |
| P1-4 | 建立版本矩阵 | pending | planned docs/release metadata | Lucy version、bundled KTX version、Node/Python/runtime、数据库、MCP client 兼容性可追踪 |
| P1-5 | 区分三层测试 | pending | planned tests | 明确 runtime compatibility tests、platform tests、business evals 的边界 |

## P2 Todo

| ID | Item | Status | Evidence | Acceptance Criteria |
|---|---|---|---|---|
| P2-1 | 镜像发布 CI | pending | planned CI | 自动 build image、跑 smoke/eval、打 tag、输出 release notes |
| P2-2 | 安全与权限体系强化 | pending | `webui/server/proxy/*` | token 生命周期、ACL、audit、secrets 挂载和脱敏策略可验证 |
| P2-3 | KTX 升级兼容机制 | pending | planned smoke/eval gates | KTX 升级前后自动验证 CLI/MCP/semantic-layer/config 兼容性 |
| P2-4 | Demo 数据库与示例项目 | pending | planned example compose | 无需客户生产库即可试用、演示、跑 CI smoke |
| P2-5 | 产品文档体系 | pending | planned docs | Admin guide、User guide、Agent integration guide、Troubleshooting guide、Security guide |

## Decisions

- Docker 镜像由 Lucy 产品方准备，客户不负责安装 KTX。
- Lucy Docker image 内置 KTX runtime；Lucy repo 不复制 KTX 源码。
- 首版 Dockerfile 使用 npm release `@kaelio/ktx@0.13.0` 作为 bundled runtime。
- 首版部署形态按单机 Docker Compose 起步。
- 首版外部 MCP endpoint 由 Lucy MCP Proxy 统一暴露；KTX MCP upstream 默认只绑定容器内 `127.0.0.1:7878`。
- 当前新增 eval 属于 business eval / product acceptance 层，不替代 KTX runtime compatibility tests 或 Lucy platform tests。
- `docs/` 适合放稳定 spec；`inbox/` 适合放阶段性 todo、审计报告和推进上下文。

## Pending Questions

- 正式 release policy 是否只 pin npm release，还是还要记录 KTX git SHA / SBOM？
- Docker 后续是否增加 Kubernetes/Helm 路径？
- 首版客户部署是否必须支持多数据库，还是先以当前 MySQL 路径打通闭环？
- 是否需要支持高级用户直连 KTX MCP upstream？
- P0 smoke 数据源策略：已新增 demo MySQL compose，作为可重复 CI/release gate；真实 MySQL 仍作为人工验收补充。
- secrets 管理是否补 Docker secrets / env var / WebUI secret onboarding？
- KTX 0.13.0 MCP `tools/list` 当前不暴露 `sl_validate`；P0 smoke 以 CLI `ktx sl validate` 覆盖 validate，MCP gate 只要求 `connection_list`、`sl_read_source`、`sl_query`、`wiki_search`。

## Progress Log

- 2026-06-21：完成 KTX vs Lucy diff 审计，报告为 `inbox/ktx-lucy-diff-2026-06-21.md`。
- 2026-06-21：确认产品边界方向：Lucy repo 不 fork KTX；Lucy Docker image 内置 pinned KTX runtime。
- 2026-06-21：建立本产品化 todo，作为后续推进的动态上下文。
- 2026-06-21：完成 Batch 1。新增正式 goal checklist spec：`docs/lucy-platform-goal-checklist.md`；更新 `docs/project-overview.md` 到 v1.2 并注册该 spec；P0-1、P0-2 标记为 done。
- 2026-06-21：完成 Batch 2 文档与代码骨架。新增 Dockerfile、compose、entrypoint、healthcheck、Docker 部署文档；WebUI server 支持生产静态资源和 env host/port。`webui npm run build` 通过，`webui npm test` 通过（28 files / 152 tests），脚本 `bash -n` 通过，`docker compose config` 通过。Docker CLI 存在但 daemon 未运行，image build 未验证，因此 P0-3、P0-4 标记为 partial。
- 2026-06-21：完成 Batch 3A/3B。3A 再次检查 Docker daemon，仍无法连接 `/Users/forrest/.docker/run/docker.sock`，Docker build / compose up 实测继续待补。3B 修复 `webui/docs/03-api-spec.md` 的既有 API spec 漂移，补 `/api/admin/audit/sources`、`/api/admin/config-audit`；`npm run lint:spec` 全部 PASS；定向测试 `server/__tests__/admin-audit.test.ts`、`server/__tests__/eval-api-contract.test.ts` 通过（2 files / 4 tests）。
- 2026-06-21：完成 Batch 4 P0 smoke。修复 Dockerfile build cwd 问题；新增 `scripts/p0-smoke.mjs` 与 `scripts/p0-customer-path-smoke.mjs`。`npm run smoke:p0` 通过；`npm run smoke:p0:docker` 通过，验证 image build、compose up、WebUI health、MCP proxy 响应、镜像内 `@kaelio/ktx 0.13.0`；`npm run smoke:p0:customer` 通过，验证真实 MySQL 连接、SL validate、KTX CLI 查询、临时 MCP tools/list、MCP `sl_query` 返回 3 行。发现 KTX 0.13.0 MCP tools/list 不暴露 `sl_validate`，validate gate 改由 CLI 覆盖。
- 2026-06-21：完成 Batch 5 P0 尾巴。新增 `docker-compose.demo.yml` 与 `examples/docker-demo/`，提供可重复 MySQL demo DB 与 demo KTX project template；Docker image 预装 `git` 与 KTX Python runtime，避免容器内 `sl query --execute` 交互安装。新增 `npm run smoke:p0:demo`，验证 demo DB、Lucy health、connection test、`admin reindex --force`、SL validate/query、Lucy MCP Proxy bearer token、`sl_read_source`、`sl_query`。新增 `npm run smoke:p0:business-eval`，验证 superstore/kx_financial eval case catalog 可读取。新增 security baseline 报告 `inbox/lucy-p0-security-baseline-2026-06-21.md`。P0-5、P0-6 标记为 done。

## Update Rule

每完成一个 item，应更新：

- 对应 `Status`。
- `Evidence` 路径或命令。
- `Acceptance Criteria` 是否满足。
- `Progress Log`。
- 新增或关闭 `Pending Questions`。
