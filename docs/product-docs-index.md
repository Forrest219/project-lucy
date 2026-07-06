# Lucy Product Docs Index

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Product Docs Index |
| 文档类型 | Product Docs Index |
| 版本 | v0.2 |
| 撰写日期 | 2026-06-22；2026-07-06 |
| 适用范围 | 客户交付文档、管理员文档、用户文档、Agent 接入文档 |

## 1. Customer-Facing Guides

The first customer delivery is headless. Customer-facing docs should start with Docker Compose, configuration files, Lucy MCP Proxy, Agent MCP client config, and smoke/eval evidence. WebUI docs below are repository/productization references, not the standard customer entry point.

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

## 4. Existing HTML Help Center

The existing HTML help center remains under:

```text
docs/user-guide/
```

The Markdown guides above are the release-facing source of truth for productization work. The HTML help center can be regenerated or refreshed from these docs in a later documentation pass.
