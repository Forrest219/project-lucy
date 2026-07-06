# Lucy Troubleshooting Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Troubleshooting Guide |
| 文档类型 | Product / Troubleshooting Guide |
| 版本 | v0.2 |
| 撰写日期 | 2026-06-22；2026-07-06 |
| 适用范围 | Docker deployment、WebUI、KTX runtime、MCP Proxy、agent access |

## 1. Fast Checks

```bash
docker compose ps
docker compose logs lucy
curl -fsS http://127.0.0.1:5174/api/health
curl -fsS "http://127.0.0.1:5174/api/r1/observability?hours=24&slowMs=30000"
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
npm run security:baseline
```

## 2. Common Issues

| Symptom | First Check | Likely Fix |
|---|---|---|
| WebUI unavailable | host port mapping | change `LUCY_WEBUI_HOST_PORT` |
| MCP returns 401 | bearer token missing or revoked | create a new Agent token |
| MCP returns 403 | role/table/tool ACL | update role table selectors or tools |
| KTX version mismatch | `/api/health.data.bundledKtxVersion` | rebuild image with intended `KTX_VERSION` |
| Query asks to install runtime | KTX Python runtime missing | rebuild image; Dockerfile should run runtime install |
| Demo DB fails | MySQL healthcheck/logs | rerun `npm run smoke:p0:demo` after cleanup |
| Semantic validate fails | source/table mismatch | run WebUI review and `ktx sl validate` |
| Customer config not visible in container | bind mount path | run `docker compose -f docker-compose.yml -f docker-compose.customer-config.yml config` and confirm `./customer-config:/data/lucy` |
| Reindex fails on wiki summary | wiki frontmatter | add `title` and `summary` frontmatter to every wiki Markdown file |
| New table not available to agent | config package not reindexed or ACL missing | run `ktx admin reindex --force`, `ktx sl validate`, and update `webui/config/access.yaml` role selectors |

## 3. Release Gate Failures

| Gate | Debug Command |
|---|---|
| spec lint | `npm run lint:spec` |
| security baseline | `npm run security:baseline` |
| Docker smoke | `npm run smoke:p0:docker` |
| Headless config | `npm run smoke:p0:headless-config -- --root customer-config --require-secret-files` |
| Demo E2E | `npm run smoke:p0:demo` |
| Business eval catalog | `npm run smoke:p0:business-eval` |
| KTX candidate | `npm run compat:ktx-upgrade -- --candidate <version>` |
| R1 readiness | `npm run r1:readiness:strict` |

## 4. Escalation Packet

When escalating an issue, include:

- Lucy git commit.
- bundled KTX version.
- Docker image tag.
- command that failed.
- redacted logs.
- WebUI `/api/health` response.
- relevant Agent id and token label, not token plaintext.
