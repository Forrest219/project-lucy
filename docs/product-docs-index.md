# Lucy Product Docs Index

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Product Docs Index |
| 文档类型 | Product Docs Index |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-22 |
| 适用范围 | 客户交付文档、管理员文档、用户文档、Agent 接入文档 |

## 1. Customer-Facing Guides

| Audience | Guide | Purpose |
|---|---|---|
| Admin | `docs/admin-guide.md` | Deploy, configure, operate, upgrade |
| User | `docs/user-guide.md` | How business users ask governed data questions |
| Agent integrator | `docs/agent-integration-guide.md` | MCP endpoint, bearer token, client config |
| Operator | `docs/troubleshooting-guide.md` | Common failures and escalation packet |
| Security reviewer | `docs/security-guide.md` | Token, ACL, audit, secrets, release gate |

## 2. Deployment And Release

| Guide | Purpose |
|---|---|
| `docs/customer-deployment-guide.md` | End-to-end customer deployment and operations |
| `docs/deployment-docker.md` | Docker Compose details |
| `docs/release-ci.md` | Release CI and KTX upgrade gates |
| `docs/version-matrix.md` | Supported runtime and compatibility matrix |
| `docs/test-layers-and-release-gates.md` | Runtime/platform/business eval gate split |

## 3. WebUI Docs

| Guide | Purpose |
|---|---|
| `docs/webui-impl-status.md` | Current module implementation status |
| `docs/webui-module-guide.md` | WebUI module usage |
| `webui/docs/06-navigation-ia.md` | Navigation and information architecture |
| `webui/docs/07-mcp-auth-proxy-spec.md` | MCP auth proxy technical spec |

## 4. Existing HTML Help Center

The existing HTML help center remains under:

```text
docs/user-guide/
```

The Markdown guides above are the release-facing source of truth for productization work. The HTML help center can be regenerated or refreshed from these docs in a later documentation pass.
