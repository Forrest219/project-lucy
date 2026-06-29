# Lucy Version Matrix

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Version Matrix |
| 文档类型 | Release Metadata / Compatibility Matrix |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-21 |
| 适用范围 | Lucy release、Docker image、bundled KTX runtime 和 MCP client 兼容性追踪 |

## 1. Current Baseline

| Component | Current Baseline | Evidence |
|---|---|---|
| Lucy source | `main` after P0 release baseline | commit `e8863b8` established P0 Docker baseline |
| Lucy package | `project-lucy-eval@0.1.0` | `package.json` |
| WebUI package | `webui@1.0.0` | `webui/package.json` |
| Bundled KTX npm package | `@kaelio/ktx@0.13.0` | `Dockerfile`, `docker-compose.yml`, `npm run smoke:p0:docker` |
| KTX Python runtime | `0.13.0`, feature `core` | `Dockerfile` runs `ktx admin runtime install --yes --feature core` |
| Node runtime | `node:22-bookworm-slim` | `Dockerfile` |
| Docker deployment | Single-node Docker Compose | `docker-compose.yml`, `docker-compose.demo.yml`, `docker-compose.postgres-demo.yml` |
| Demo DB | `mysql:8.4`, `postgres:16-alpine` | `docker-compose.demo.yml`, `docker-compose.postgres-demo.yml` |
| Customer DB path | MySQL validated locally | `npm run smoke:p0:customer` |
| MCP endpoint | Lucy MCP Proxy on container `7879` | `docs/deployment-docker.md`, `npm run smoke:p0:demo` |
| Release CI | GitHub Actions release gates | `.github/workflows/lucy-release.yml`, `docs/release-ci.md` |

## 2. Runtime Compatibility

| Surface | Required Version / Behavior | Gate |
|---|---|---|
| KTX CLI | `ktx --version` returns `@kaelio/ktx 0.13.0` | `npm run smoke:p0:docker` |
| KTX Python runtime | `ktx sl query --execute` runs without interactive install | `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo` |
| KTX semantic layer validate | CLI `ktx sl validate` works | `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer` |
| KTX MCP tools | `connection_list`, `sl_read_source`, `sl_query`, `wiki_search` are available | `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer` |
| `sl_validate` MCP tool | Not exposed by KTX `0.13.0` MCP `tools/list` | validate via CLI gate |
| Lucy MCP Proxy | Bearer auth, ACL filtering, `kx_catalog`, `sl_read_source`, `sl_query` | `npm run smoke:p0:demo` |
| KTX candidate upgrade | Candidate version must pass Docker/demo/business gates | `npm run compat:ktx-upgrade -- --candidate <version>` |

## 3. Supported Deployment Matrix

| Deployment | Status | Notes |
|---|---|---|
| Docker Compose single node | supported baseline | P0 release baseline |
| Docker Compose demo DB | supported smoke/demo path | MySQL demo DB + Lucy |
| Docker Compose external MySQL | supported with manual config | edit `/data/lucy/ktx.yaml` and secret file |
| Docker Compose external PostgreSQL | supported with manual config | edit `/data/lucy/ktx.yaml` and secret file |
| Kubernetes / Helm | not supported | future P2/P3 |
| Hosted SaaS / multi-tenant | not supported | future product line |

## 4. Database Matrix

| Database | Status | Gate |
|---|---|---|
| MySQL demo (`mysql:8.4`) | verified | `npm run smoke:p0:demo` |
| Aliyun RDS MySQL | verified locally | `npm run smoke:p0:customer` |
| PostgreSQL demo (`postgres:16-alpine`) | verified | `npm run smoke:p0:postgres-demo` |
| ClickHouse | not verified for Lucy P0 | future compatibility gate |
| Snowflake | not verified for Lucy P0 | future compatibility gate |

## 5. MCP Client Matrix

| Client | Status | Notes |
|---|---|---|
| Generic HTTP MCP client | verified by script | `scripts/p0-demo-docker-smoke.mjs` uses JSON-RPC over HTTP |
| Claude Code | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Codex | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Openclaw | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Hermes | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Cursor | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Claude Desktop stdio | documented for local KTX in development docs | Not a Docker P0 customer path |
| Cloud-hosted agent | not verified | Requires public URL, TLS, and access control |

## 6. Release Metadata Template

Every Lucy release should record:

```yaml
lucy:
  version: <release-version>
  git_commit: <git-sha>
  docker_image: <registry/image:tag>
ktx:
  npm_package: "@kaelio/ktx"
  npm_version: "0.13.0"
  git_sha: <optional-upstream-sha>
  python_runtime_feature: core
runtime:
  node_image: node:22-bookworm-slim
  docker_compose: v2
databases:
  verified:
    - mysql:8.4-demo
    - postgres:16-alpine-demo
gates:
  required:
    - npm run smoke:p0
    - npm run smoke:p0:docker
    - npm run smoke:p0:demo
    - npm run smoke:p0:postgres-demo
    - npm run smoke:p0:business-eval
    - npm run audit:ktx-diff
  optional_customer:
    - npm run smoke:p0:customer
  ktx_upgrade:
    - npm run compat:ktx-upgrade -- --candidate <ktx-version>
```

## 7. Update Rule

Update this matrix when any of these changes:

- Lucy release version or git commit.
- Docker base image.
- Bundled KTX version.
- KTX Python runtime feature level.
- Supported database or MCP client.
- Required release gates.
