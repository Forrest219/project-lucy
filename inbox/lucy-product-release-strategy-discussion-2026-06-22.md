# Lucy Product / Release Strategy Discussion Draft

生成日期：2026-06-22

用途：给架构师汇报与确认产品/发布策略。本文是讨论稿，不是最终发布政策。

## 1. 背景与目标

Lucy 的产品目标是成为位于数据库和 agents 之间的 MCP 服务管理平台：

- 客户通过 Docker 部署 Lucy。
- Lucy 镜像内置 pinned KTX runtime。
- 客户接入数据库、配置语义层。
- 客户在 agents 平台配置 Lucy MCP endpoint/token 后即可接入数据能力。
- Lucy repo 不 fork / vendor KTX 源码；Lucy Docker image 负责集成 KTX runtime。

P0-P2 工程底座已完成：

- Docker Compose 部署骨架。
- 内置 `@kaelio/ktx@0.13.0`。
- Demo MySQL E2E smoke。
- P0/P1/P2 release gates。
- WebUI `/onboarding` 上线检查。
- GitHub Actions release workflow。
- KTX diff audit、KTX upgrade compatibility、security baseline。
- 产品文档体系。

本文讨论首个客户可交付版本的产品/发布策略。

## 2. 建议结论总览

| 议题 | 建议结论 | 需确认点 |
|---|---|---|
| Release policy | 首版记录 Lucy git commit、Docker image tag/digest、KTX npm version；已补 release metadata 与 SBOM artifact | 是否把 SBOM 作为客户交付包必填 |
| 部署形态 | 首版正式承诺 Docker Compose single-node；Kubernetes/Helm 进 roadmap | Helm 优先级和目标客户场景 |
| 数据库支持 | 首版 must-support MySQL + PostgreSQL；其他 DB 进入 candidate/roadmap | 是否要求外部真实 PostgreSQL 客户环境验收，还是 demo PostgreSQL CI gate 即可 |
| KTX MCP upstream | 客户默认只开放 Lucy MCP Proxy；KTX upstream 只作开发/诊断模式 | 是否允许 enterprise support 场景临时启用 upstream |
| Secrets 策略 | 首版支持 mounted secret files；已补 Docker secrets compose override；WebUI secret onboarding 暂缓 | 是否继续支持 env var secret source |
| `sl_validate` 兼容 | KTX `0.13.0` 下继续用 CLI validate gate；MCP `sl_validate` 出现后再纳入 MCP gate | 是否要求向 KTX upstream 提 issue/PR |

## 3. Release Policy

### 建议

首版 release metadata 必填：

- Lucy release version。
- Lucy git commit。
- Docker image tag。
- Docker image digest。
- Bundled KTX npm package/version：`@kaelio/ktx@0.13.0`。
- Node base image：`node:22-bookworm-slim`。
- Required gates 执行结果。

增强项：

- KTX upstream git SHA。
- SBOM。
- image signing / provenance。

### 优点

- 足够支撑客户问题定位：能知道 Lucy 代码、镜像和 KTX npm runtime。
- 不阻塞首版交付，符合当前 Docker CI 已有能力。
- KTX npm version 是实际安装来源，比“只写 upstream repo commit”更贴近运行时事实。
- 后续可平滑增加 SBOM 和签名，不破坏现有流程。

### 缺点 / 风险

- 不记录 KTX git SHA 时，无法精确对应上游源码快照。
- 没有 SBOM 时，企业安全审查可能要求补材料。
- 若 npm package 与上游 GitHub tag 存在偏差，排查链路会变长。

### 建议架构师确认

- 首版是否接受 “npm version + image digest” 作为 release traceability baseline。
- SBOM 是首版必填，还是 enterprise/customer-requested 后补。

## 4. 部署形态

### 建议

首版正式支持：

- Docker Compose single-node。
- Docker Compose demo DB。
- Docker Compose external DB。

暂不正式支持：

- Kubernetes / Helm。
- Hosted SaaS / multi-tenant。

Kubernetes/Helm 进入 roadmap，不进入首版 release 承诺。

### 优点

- 部署路径清晰，客户试用和排障成本低。
- 与当前 release gates 完全对齐：`smoke:p0:docker`、`smoke:p0:demo`。
- 避免为了 Helm 提前引入 ingress、TLS、secret store、PVC、multi-replica 等复杂问题。
- 首版能更快验证 “数据库 -> Lucy -> Agent” 主链路价值。

### 缺点 / 风险

- 企业客户如果标准化在 Kubernetes 上，可能认为部署形态不完整。
- 后续迁移 Helm 时，需要重新审视 healthcheck、volume、secret、network policy。
- 单节点 Compose 不天然覆盖 HA、滚动升级和横向扩展。

### 建议架构师确认

- 首版客户是否能接受 Docker Compose 作为正式部署方式。
- Helm 是 P3 还是更早进入 roadmap。

## 5. 数据库支持范围

### 建议

首版 must-support：

- MySQL。
- PostgreSQL。

当前状态建议定义为：

| Database | Product Status | Engineering Status | Release Requirement |
|---|---|---|---|
| MySQL | must-support | verified | 保留现有 demo + smoke |
| PostgreSQL | must-support | verified | 已补 PostgreSQL demo compose、sample project、smoke gate、release CI job；`npm run smoke:p0:postgres-demo` 已在本机通过；KTX upstream 已有现成 `connectors/postgres/` 连接器，属于"接现有能力"而非"造新能力" |
| StarRocks | **2026-06-22 决策：退出首版 MVP 范围**，转 roadmap candidate | 未实现：KTX upstream 无 `connectors/starrocks/`，仅 `docs/vision.md` 记录"走 MySQL Wire Protocol、不开发专用驱动"的设计意图，未经任何代码/测试验证 | 重新评估前必须先跑通一次独立 spike：用真实 StarRocks 容器验证 `driver: mysql` 复用是否在 KTX 现有 SQL 生成路径（含 join / measure / 派生列）下产出正确结果，而不是直接套用 PostgreSQL 的"接现有能力"工作量估算 |
| ClickHouse | candidate | not verified | 不写 supported，按客户需求排期 |
| Snowflake | candidate | not verified | 不写 supported，按客户需求排期 |

换句话说：产品策略上 MySQL + PostgreSQL 是首版必须项；工程发布上，PostgreSQL 不能只写文档承诺，必须有 CI gate 才能标为 verified/supported。2026-06-22 已补 PostgreSQL demo/CI gate 路径。StarRocks 评估后判定风险与 PostgreSQL 不在同一量级（无现成连接器、协议兼容假设未验证），**主动退出首版范围**，不计入 MVP 时间线。

> **文档漂移处理记录**：`docs/vision.md` 已于 2026-06-22 同步更新，MVP 数据库范围改为 MySQL + PostgreSQL，StarRocks 改为 roadmap candidate，待 DB-4 spike 通过后再重新评估。

### PostgreSQL 工程项

2026-06-22 已新增：

- `docker-compose.postgres-demo.yml`。
- `examples/postgres-demo/`。
- PostgreSQL seed SQL。
- PostgreSQL KTX project template。
- `scripts/p0-postgres-demo-smoke.mjs`。
- npm script：`smoke:p0:postgres-demo`。
- Release CI job：`postgres-demo-e2e`。
- Version matrix 将 PostgreSQL 状态从 `not verified` 改为 `verified`。

最低验收：

- PostgreSQL demo DB 启动并健康。
- Lucy image 启动。
- `ktx connection test` 通过。
- `ktx admin reindex --force` 通过。
- `ktx sl validate` 通过。
- `ktx sl query --execute` 返回 rows。
- Lucy MCP Proxy `sl_read_source` / `sl_query` 对 PostgreSQL demo path 通过。

### 优点

- MySQL + PostgreSQL 覆盖最常见客户私有化部署数据库。
- PostgreSQL 是企业数据栈和 SaaS 产品中非常高频的 baseline，首版支持有商业价值。
- 用 demo + smoke gate 支撑支持声明，避免“销售支持、工程未验证”的坑。
- 未来 ClickHouse/Snowflake 可以复制同一套 compatibility pattern。

### 缺点 / 风险

- PostgreSQL 会拉高 P2 后续工作量，至少需要新增 demo 数据、KTX config、smoke、CI。
- KTX 对 PostgreSQL 的具体 SQL dialect/driver 行为需要实测，可能暴露 KTX runtime 兼容问题。
- 同时支持 MySQL/PostgreSQL 后，文档、排障、connection secret 示例都需要双路径维护。
- 如果 demo schema 与 MySQL demo 不一致，eval 和 onboarding 口径会变复杂。

### 建议架构师确认

- PostgreSQL 支持范围是 “Docker demo verified” 还是也要接真实外部 PostgreSQL 验收。
- 当前已复用 Superstore 语义；是否需要新增更小、更稳定的 PostgreSQL 专属 demo schema。

## 6. KTX MCP Upstream 暴露策略

### 建议

客户部署默认只开放：

- Lucy WebUI/API。
- Lucy MCP Proxy。

KTX MCP upstream 默认只绑定容器内 `127.0.0.1:7878`，不对客户/agent 外部暴露。

KTX upstream 直连仅作为：

- 本地开发模式。
- 故障诊断模式。
- 临时 support 模式。

不得作为正式客户接入路径。

### 优点

- 所有外部 agent 访问都经过 Lucy auth/ACL/audit。
- 避免客户绕过 Lucy Proxy 直接拿到 KTX 原生工具能力。
- 产品边界清晰：Lucy 是服务管理平台，不只是 KTX 打包器。
- 安全审计口径简单。

### 缺点 / 风险

- 高级用户调试 KTX 原生 MCP 时会多一步。
- 如果 Lucy Proxy 有 bug，不能让客户快速绕过代理继续服务。
- support 场景需要明确临时开放 upstream 的操作和风险。

### 建议架构师确认

- 是否允许 documented break-glass upstream access。
- 如果允许，是否必须绑定 localhost + explicit env flag + audit notice。

## 7. Secrets 策略

### 建议

首版支持：

- mounted secret files。
- `.ktx/secrets/*`。
- Docker secrets compose override。
- Docker volume 持久化。
- 文档化 token/DB secret 分离。

下一阶段支持：

- env var secret source。

暂缓：

- WebUI secret onboarding。

### 优点

- mounted files 与 KTX 当前项目结构一致。
- 不把 DB 密码烤进 image。
- 不需要 WebUI 处理敏感凭据生命周期，降低首版风险。
- 与 `.dockerignore`、`security:baseline` 和客户部署文档已经对齐。

### 缺点 / 风险

- 客户首次配置体验没有完整 UI 化。
- env var secret source 如果不支持，部分企业平台可能需要额外适配。
- mounted file 权限、路径、备份策略需要客户运维配合。

### 建议架构师确认

- Docker secrets 已进入首版示例路径；是否继续补 env var secret source。
- WebUI secret onboarding 是否明确不进首版 scope。

## 8. `sl_validate` 兼容策略

### 背景

KTX `0.13.0` MCP `tools/list` 当前不暴露 `sl_validate`。P0/P1/P2 gates 已使用 CLI 覆盖 validate：

```bash
ktx sl validate <source> --connection-id <conn>
```

MCP gate 当前要求：

- `connection_list`
- `sl_read_source`
- `sl_query`
- `wiki_search`

### 建议

短期维持：

- validate 由 CLI gate 覆盖。
- MCP gate 不要求 `sl_validate`。
- KTX upgrade compatibility 持续检查 tools/list。

当 KTX MCP 暴露 `sl_validate` 后：

- 将 `sl_validate` 纳入 MCP Proxy allowed/filtered tools。
- 将 demo smoke 增加 MCP `sl_validate` call。
- 更新 version matrix 和 release gates。

### 优点

- 不阻塞当前 `@kaelio/ktx@0.13.0` 产品化。
- validate 能力仍有自动化覆盖，不是空缺。
- 与 KTX upstream 行为保持兼容，不在 Lucy 里伪造工具。

### 缺点 / 风险

- Agent 无法通过 MCP 直接调用 validate，只能通过 Lucy/WebUI/CLI 流程触发。
- 文档需要解释 “CLI validate gate != MCP validate tool”。
- 如果客户要求 agent 自助 validate，需要等待 KTX upstream 或 Lucy 增加 proxy-side adapter。

### 建议架构师确认

- 是否接受 CLI validate 作为首版 release gate。
- 是否向 KTX upstream 提 issue/PR 跟踪 MCP `sl_validate`。

## 9. 建议决策清单

建议本次架构师会确认以下事项：

1. Release metadata 首版是否必须包含 SBOM。
2. 首版部署形态是否只正式承诺 Docker Compose。
3. PostgreSQL demo CI gate 已补齐；是否追加真实外部 PostgreSQL 验收。
4. KTX upstream 是否允许 break-glass 诊断入口。
5. 首版 secrets 已支持 mounted files + Docker secrets override；是否追加 env var secret source。
6. CLI `sl_validate` gate 是否可作为首版正式 validate 策略。

## 10. 建议后续 Todo

若本文策略被确认，建议新增下一批 P3/P2.5 todo：

| ID | Item | Priority | Acceptance Criteria |
|---|---|---|---|
| DB-1 | PostgreSQL demo project | done | `docker-compose.postgres-demo.yml`, `examples/postgres-demo/`, PostgreSQL seed SQL, KTX `driver: postgres` project template |
| DB-2 | PostgreSQL smoke gate | done | `npm run smoke:p0:postgres-demo` 已通过，验证 PostgreSQL demo DB、KTX CLI validate/query、Lucy MCP Proxy `sl_read_source` / `sl_query` |
| DB-3 | Version matrix update | done | `docs/version-matrix.md` 已将 PostgreSQL demo 改为 verified，并纳入 required gates |
| REL-1 | Release metadata artifact | done | `npm run release:artifacts` 生成 `lucy-release-metadata.json` 与 `lucy-release-notes.md`，记录 commit、image id、KTX npm version、verified DBs、required gates |
| REL-2 | Optional SBOM | done | `npm run release:artifacts` 生成 `lucy-sbom.json`，CI release-package 上传 `lucy-release-artifacts` |
| SEC-1 | Docker secrets support | done | `docker-compose.secrets.yml` + `docs/deployment-docker.md` / `docs/customer-deployment-guide.md` / `docs/security-guide.md`；`npm run security:baseline` 纳入文件存在校验 |
| OPS-1 | Break-glass upstream policy | P2 | 若允许，必须显式 env flag、localhost bind、文档风险提示 |
| DB-4 | StarRocks 协议兼容性 spike | Roadmap（不阻塞 MVP，2026-06-22 已确认退出首版范围） | 真实 StarRocks 容器 + `driver: mysql` 验证 KTX 现有 SQL 生成路径（join / measure / 派生列）结果正确；spike 报告作为是否启动正式工程化的前置依据 |
| DOC-1 | 同步 `docs/vision.md` 多数据源接入状态 | done | 已把 StarRocks 从"P0 当前支持"改为"roadmap candidate，待 DB-4 spike 结果"，MVP 数据库范围同步为 MySQL + PostgreSQL |

## 11. 2026-06-22 执行记录

本轮已完成 P0/P1 release productization 尾项：

- P0 DB-1/DB-2/DB-3：新增 PostgreSQL demo compose、seed SQL、KTX project template、`smoke:p0:postgres-demo`、release CI `postgres-demo-e2e`，并更新 version matrix。
- P1 REL-1/REL-2：新增 `npm run release:artifacts`，生成 release metadata、release notes、SBOM，并由 release CI 上传 `lucy-release-artifacts`。
- P1 SEC-1：新增 `docker-compose.secrets.yml`，文档化 `/run/secrets/*` 引用方式，并将 secrets override 纳入 security baseline 文件存在校验。
- Post-review blocker fix：PostgreSQL demo 已移除 `ktx.yaml` 明文密码；`demo-postgres` 改为 `password: file:/run/secrets/postgres_password`；`docker-compose.postgres-demo.yml` 为 `postgres-db` 和 `lucy` 同时挂载 `postgres_password` secret，Postgres 使用 `POSTGRES_PASSWORD_FILE`；smoke 脚本自动创建临时 secret 文件并在结束后清理。
- Post-review blocker fix：PostgreSQL smoke 不再手写 required tools；`scripts/p0-postgres-demo-smoke.mjs` 直接读取 `examples/postgres-demo/project-template/webui/config/access.yaml` 中 `demo_agent` 绑定 role 的 `allow.tools`，并要求 MCP `tools/list` 与 role allow.tools 精确一致，同时确认 `defaults.deny_tools` 未暴露。
- Post-review recommendation fix：`release-artifacts.mjs` 已记录 root/WebUI `npm audit --json` exit code、severity 计数和漏洞包摘要；当前策略为 release artifact 可见但不阻塞，是否将 high/critical 设为强阻塞需后续依赖治理决策。
- Post-review recommendation fix：MySQL/PostgreSQL demo README 均已补 `LUCY_TEMPLATE_ROOT` 说明，明确这是 demo-only bootstrap setting，客户自定义 compose 应删除该变量并回落到 `/data/lucy`。

已执行验证：

- `node --check scripts/p0-postgres-demo-smoke.mjs scripts/release-artifacts.mjs scripts/ktx-upgrade-compat.mjs scripts/security-baseline.mjs`
- `docker compose -f docker-compose.postgres-demo.yml config`
- `docker compose -f docker-compose.yml config`
- `docker compose -f docker-compose.yml -f docker-compose.secrets.yml config`
- `npm run release:artifacts -- --tag local-check --out /tmp/lucy-release-artifacts-check`
- GitHub Actions workflow YAML parse。
- `npm run security:baseline`
- `npm run lint:spec`（仅保留既有 disabled legacy wildcard user warning）
- `npm run compat:ktx-upgrade -- --candidate 0.13.0 --skip-docker --skip-demo --skip-postgres-demo`
- `npm run smoke:p0:postgres-demo`

`npm run smoke:p0:postgres-demo` 覆盖结果：

- PostgreSQL `postgres:16-alpine` demo DB healthcheck 通过。
- Lucy image 启动并健康。
- `/api/health.data.bundledKtxVersion` 验证为 `0.13.0`。
- `ktx connection test demo-postgres` 通过。
- `ktx admin reindex --force` 通过。
- `ktx sl validate superstore_orders --connection-id demo-postgres` 通过。
- `ktx sl query --execute` 对 PostgreSQL 返回 4 行 region 汇总。
- Lucy MCP Proxy `tools/list`、`sl_read_source`、`sl_query` 通过，且 denied `sql_execution` 未暴露。
