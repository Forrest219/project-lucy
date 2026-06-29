# Customer Headless Delivery Signoff

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-06-29 |
| 范围 | 客户交付不包含 WebUI；标准路径为 Docker Compose + KTX runtime + Lucy MCP Proxy + Agent MCP client |
| Builder | Codex |

## 1. Signoff Summary

本轮已完成客户 headless 交付口径收口、本地 gate、真实库 smoke、release artifact 生成和干净目录 dry-run。

结论：本地客户 headless 交付证据 **PASS**。CI 触发信息待本轮分支 push / workflow_dispatch 后补充。

## 2. Customer Delivery Scope

客户主路径只依赖：

- Docker Compose 部署 Lucy/KTX runtime。
- `/data/lucy/ktx.yaml`、secret 文件、`semantic-layer/`、`wiki/` 和 `webui/config/access.yaml`。
- Lucy MCP Proxy `/mcp` endpoint。
- Bearer token + ACL。
- Agent MCP client config。
- smoke/eval/audit 证据。

明确不作为本次客户交付承诺：

- WebUI 管理台。
- Admin / Eval / Connections / Onboarding UI。
- Skill Editor / Skill 版本化 UI。
- MCP endpoint 生命周期管理 UI。
- Kubernetes / Helm。
- 系统 metrics、告警、日志聚合、对象存储归档。

## 3. Evidence

| 项 | 结果 | 证据 |
|---|---:|---|
| 客户文档 headless 口径 | PASS | `docs/customer-deployment-guide.md`, `docs/deployment-docker.md`, `docs/agent-integration-guide.md`, `docs/admin-guide.md`, `docs/user-guide.md`, `docs/product-docs-index.md` |
| Release gate 口径拆分 | PASS | `docs/test-layers-and-release-gates.md`, `scripts/release-artifacts.mjs` |
| Headless local gate | PASS | `inbox/headless-delivery-gate-2026-06-29.md` |
| MCP Proxy 主链路 | PASS | `tools/list` 过滤后不含 `sql_execution`; `sl_read_source` OK; `sl_query` OK; bearer token OK; audit sqlite 写入 |
| 客户真实库路径 | PASS | `npm run smoke:p0:customer` against local `mysql-aliyun` read-only path |
| Release artifact | PASS | `inbox/headless-release-artifacts-2026-06-29/` |
| 干净目录 dry-run | PASS | `inbox/headless-delivery-dry-run-2026-06-29.md` final verification / accepted summary |

## 4. Local Gates

已执行并通过：

- `npm run security:baseline`
- `npm run smoke:p0:docker`
- `npm run smoke:p0:demo`
- `npm run smoke:p0:postgres-demo`
- `npm run smoke:p0:business-eval`
- `npm run smoke:p0:customer`

备注：首次执行 Docker gate 时 Docker daemon 未启动；启动 Docker Desktop 后整组重跑，最终报告为 PASS。

## 5. CI

待补充：

- 分支/提交。
- GitHub Actions run URL。
- `lucy-release.yml` headless jobs 状态。
- WebUI/spec jobs 状态：只作为仓库质量门禁，不作为客户使用路径。

## 6. Known Limitations And Follow-ups

- Full LLM/agent business eval 仍依赖客户或 CI secret 环境中的 agent/model 凭据；本轮交付 catalog smoke 和运行方法。
- P1 semantic-layer/wiki/headless client evidence 可继续拆成单独证据文件；本轮 gate/dry-run 已覆盖 demo semantic-layer 可见性、reindex、validate、query、MCP client JSON-RPC。
- 真实客户生产环境仍需现场复验数据库网络、secret 挂载和客户实际 agent client。

