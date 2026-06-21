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
| Docker deploy | partial | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/docker-entrypoint.sh`, `docs/deployment-docker.md` | `docker compose up` 后 WebUI 与 MCP endpoint 可访问；待 Docker daemon 可用后验证 |
| Bundled KTX runtime | partial | `Dockerfile` pins `@kaelio/ktx@0.13.0`; `docs/deployment-docker.md` | 镜像内 `ktx --version` 可运行；Lucy version 与 bundled KTX version 可追踪；待 image build 验证 |
| Runtime healthcheck | partial | `scripts/docker-healthcheck.sh`; `Dockerfile` `HEALTHCHECK` | healthcheck 覆盖 KTX CLI、Lucy server、MCP endpoint 基础可用性；待容器运行验证 |
| Database connection | partial | `ktx.yaml`, `ktx.yaml.example`, `webui/` | 用户可配置数据库连接，并在 WebUI/API 中验证连通性 |
| Schema scan/read | partial | `semantic-layer/mysql-aliyun/_schema/`, WebUI connection module | 用户可扫描或读取 schema，并在 UI/API 中看到结果 |
| Semantic layer management | partial | `semantic-layer/`, `webui/server/semantic-layer.ts`, `webui/src/pages/TableEditor.tsx` | 用户可编辑、保存、diff、validate、reindex semantic-layer overlay |
| Wiki/context management | partial | `wiki/`, `webui/server/wiki.ts`, `webui/src/pages/WikiEditor.tsx` | 用户可维护 wiki/context，并让 KTX wiki 检索命中 |
| MCP endpoint management | partial | `.mcp.json`, `webui/server/proxy/*`, `webui/docs/07-mcp-auth-proxy-spec.md` | 用户可获得 agents 平台可用的 MCP endpoint/token 配置 |
| Auth / ACL / audit | partial | `webui/config/access.yaml`, `webui/server/proxy/*`, `webui/server/admin/*` | token、role/ACL、audit log 可配置、可验证、可追溯 |
| Agent onboarding | missing | planned deployment docs / WebUI flow | 用户能按文档或 UI 将 MCP 配置复制到 agents 平台并完成一次数据查询 |
| Business eval | partial | `evals/`, `scripts/eval-runner.mjs` | 至少一组核心业务 eval 可运行并产出结果 |
| Runtime compatibility tests | missing | planned tests | 内置 KTX 的 CLI/MCP/semantic-layer 基础能力有 smoke gate |
| Platform smoke tests | missing | planned tests | Lucy WebUI/API/proxy/auth/audit 的 P0 路径有 smoke gate |
| Release gates | missing | 本文 §6 | 发布镜像前必须通过 Docker smoke、KTX compatibility smoke、Lucy platform smoke、business eval smoke |
| Version matrix | missing | planned release metadata / docs | Lucy version、bundled KTX version、Node/Python/runtime、数据库、MCP client 兼容性可追踪 |
| Upgrade compatibility | missing | planned smoke/eval gates | KTX 升级前后自动验证 CLI/MCP/semantic-layer/config 兼容性 |

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
| KTX compatibility smoke | smoke 日志 | 镜像内 `ktx --version`、`ktx status`、基础 MCP/semantic-layer 命令可用 |
| Lucy platform smoke | smoke 日志 | WebUI/API/proxy/auth/audit P0 路径可访问且返回预期结果 |
| Customer main path smoke | e2e 日志或录屏 | 配数据库、读 schema、改 semantic-layer、validate/reindex、启 MCP、agent 查询数据可复验 |
| Business eval smoke | eval report | 至少一个核心 eval suite 可运行，结果有记录 |
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
| 首版数据库范围 | 倾向先打通当前 MySQL 路径 | 是否 P0 支持多数据库 |
| MCP endpoint 暴露方式 | 首版 Docker 采用 Lucy proxy 对外统一暴露；KTX upstream 只在容器内使用 | 是否需要支持高级用户直连 KTX upstream |
| P0 smoke 数据源 | 未决 | 使用真实数据库、demo 数据库，还是二者都需要 |
| secrets 管理 | 首版文档使用 `/data/lucy/.ktx/secrets/*` 文件路径 | 是否补 Docker secrets / env var / WebUI secret onboarding |

## 10. Update Rule

每次完成产品化推进项，应同步更新：

1. 本文 `Capability Checklist` 的 `Status`、`Evidence`、`Acceptance Criteria`。
2. `inbox/lucy-platform-productization-todo-2026-06-21.md` 的 todo 状态、进度日志和待决问题。
3. 如涉及正式模块状态，更新 `docs/project-overview.md` 或对应模块 spec。
