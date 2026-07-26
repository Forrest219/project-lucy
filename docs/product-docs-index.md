# Lucy Product Docs Index

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Product Docs Index |
| 文档类型 | Product Docs Index |
| 版本 | v0.4 |
| 撰写日期 | 2026-06-22；2026-07-06 v0.3；2026-07-24 v0.4（新增 WebUI 模块设计规范索引） |
| 适用范围 | 客户交付文档、管理员文档、用户文档、Agent 接入文档 |

## 1. Customer-Facing Guides

The customer delivery is headless. Customer-facing docs start with Docker Compose or the single-replica Helm path, customer configuration, Lucy MCP Proxy, Agent MCP client config, and smoke/eval evidence.

Lucy 的正式产品定位是 **data agent context compiler + governed MCP runtime**。定位与目标事实源如下：

| Source | Purpose |
|---|---|
| `docs/vision.md` | 产品愿景与长期定位 |
| `docs/project-overview.md` | 当前能力边界、目录索引和交付状态 |
| `docs/lucy-platform-goal-checklist.md` | 产品化验收目标和边界 |

| Audience | Guide | Purpose |
|---|---|---|
| Admin | `docs/admin-guide.md` | Deploy, continuously configure semantic-layer/wiki/evals/access, operate, upgrade |
| User | `docs/user-guide.md` | How business users ask governed data questions |
| Agent integrator | `docs/agent-integration-guide.md` | MCP endpoint, bearer token, client config |
| Operator | `docs/troubleshooting-guide.md` | Common failures and escalation packet |
| Security reviewer | `docs/security-guide.md` | Token, ACL, audit, secrets, release gate |

## 2. Deployment And Release

| Guide | Purpose |
|---|---|
| `docs/customer-deployment-guide.md` | End-to-end customer deployment, headless config package, operations |
| `docs/customer-deployer-quickstart.md` | Minimal customer installer guide for Docker deployment, Doris validation, and future `customer-config` maintenance |
| `docs/customer-k8s-deployer-quickstart.md` | Minimal Helm installer guide for single-replica K8s deployment, Doris validation, persistence, and rollback |
| `docs/customer-ops-deployment-runbook.md` | Customer operations manager deployment, acceptance, monitoring, load-test evidence, rollback, and incident runbook |
| `docs/deployment-docker.md` | Docker Compose details and `customer-config/` bind mount |
| `docs/release-ci.md` | Release CI and KTX upgrade gates |
| `docs/version-matrix.md` | Supported runtime and compatibility matrix |
| `docs/test-layers-and-release-gates.md` | Runtime/platform/business eval gate split |

## 3. WebUI Docs

| Guide | Purpose |
|---|---|
| `docs/webui-impl-status.md` | Repository quality/productization reference; not a customer headless entry |
| `docs/webui-module-guide.md` | Optional WebUI module reference for later productization |
| `webui/docs/06-navigation-ia.md` | Navigation and information architecture reference |
| `webui/docs/07-mcp-auth-proxy-spec.md` | MCP auth proxy technical spec |

## 4. WebUI Module Design Specs

Builder-facing technical designs that gate codex M-tickets. Spec is the source of truth; the WebUI module guide derives from these.

| Spec | Purpose |
|---|---|
| `docs/design-db-connection.md` | WebUI 连接管理模块（连接概览 / 表白名单 / 连通测试） |
| `docs/design-schema-onboarding.md` | WebUI schema onboarding 模块（M6：给已有连接追加 schema，ADR-11） |

## 5. Existing HTML Help Center

The existing HTML help center remains under:

```text
docs/user-guide/
```

The Markdown guides above are the release-facing source of truth for productization work. The HTML help center can be regenerated or refreshed from these docs in a later documentation pass.
