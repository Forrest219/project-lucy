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
| P0-3 | 补 Docker 交付骨架 | partial | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/docker-entrypoint.sh`, `scripts/docker-healthcheck.sh`, `docs/deployment-docker.md` | 文件已落地；`npm run build`、`npm test`、脚本语法检查通过；待 Docker daemon 可用后验证 `docker compose up` 后 WebUI 和 MCP endpoint 可访问 |
| P0-4 | 内置并锁定 KTX runtime | partial | `Dockerfile` pins `@kaelio/ktx@0.13.0`; `docs/deployment-docker.md` | 镜像构建逻辑已锁定 bundled KTX；待 Docker build 后验证镜像内 `ktx --version` 与 `/api/health` bundledKtxVersion |
| P0-5 | 打通客户部署主链路 | pending | planned smoke/e2e | `docker compose up -> 配数据库 -> 扫 schema -> 配 semantic-layer -> validate/reindex -> 启 MCP -> agents 可查询数据` 可复验 |
| P0-6 | 建立 P0 质量门禁 | pending | planned tests/evals | Docker smoke、KTX compatibility smoke、Lucy platform smoke、business eval smoke 均可运行并产出结果 |

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
- 首个 P0 smoke 使用真实数据库、demo 数据库，还是二者都需要？
- secrets 管理是否补 Docker secrets / env var / WebUI secret onboarding？
- Docker daemon 当前未运行，Batch 2/3A 的 image build / compose up 验证待补。

## Progress Log

- 2026-06-21：完成 KTX vs Lucy diff 审计，报告为 `inbox/ktx-lucy-diff-2026-06-21.md`。
- 2026-06-21：确认产品边界方向：Lucy repo 不 fork KTX；Lucy Docker image 内置 pinned KTX runtime。
- 2026-06-21：建立本产品化 todo，作为后续推进的动态上下文。
- 2026-06-21：完成 Batch 1。新增正式 goal checklist spec：`docs/lucy-platform-goal-checklist.md`；更新 `docs/project-overview.md` 到 v1.2 并注册该 spec；P0-1、P0-2 标记为 done。
- 2026-06-21：完成 Batch 2 文档与代码骨架。新增 Dockerfile、compose、entrypoint、healthcheck、Docker 部署文档；WebUI server 支持生产静态资源和 env host/port。`webui npm run build` 通过，`webui npm test` 通过（28 files / 152 tests），脚本 `bash -n` 通过，`docker compose config` 通过。Docker CLI 存在但 daemon 未运行，image build 未验证，因此 P0-3、P0-4 标记为 partial。
- 2026-06-21：完成 Batch 3A/3B。3A 再次检查 Docker daemon，仍无法连接 `/Users/forrest/.docker/run/docker.sock`，Docker build / compose up 实测继续待补。3B 修复 `webui/docs/03-api-spec.md` 的既有 API spec 漂移，补 `/api/admin/audit/sources`、`/api/admin/config-audit`；`npm run lint:spec` 全部 PASS；定向测试 `server/__tests__/admin-audit.test.ts`、`server/__tests__/eval-api-contract.test.ts` 通过（2 files / 4 tests）。

## Update Rule

每完成一个 item，应更新：

- 对应 `Status`。
- `Evidence` 路径或命令。
- `Acceptance Criteria` 是否满足。
- `Progress Log`。
- 新增或关闭 `Pending Questions`。
