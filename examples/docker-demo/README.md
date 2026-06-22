# Lucy Docker Demo

This demo lets a customer or CI runner try Lucy without a production database.

## Contents

| Path | Purpose |
|---|---|
| `docker-compose.demo.yml` | Runs Lucy plus demo MySQL |
| `examples/docker-demo/mysql/01-init.sql` | Seeds Superstore-style demo data |
| `examples/docker-demo/project-template/ktx.yaml` | Demo KTX project config mounted into Lucy |

## Run

From the repository root:

```bash
npm run smoke:p0:demo
```

The smoke test validates:

- Demo MySQL health.
- Lucy WebUI `/api/health`.
- Bundled KTX version.
- `ktx connection test`.
- `ktx admin reindex --force`.
- `ktx sl validate`.
- `ktx sl query --execute`.
- Lucy MCP Proxy bearer-token path with `sl_read_source` and `sl_query`.

## Ports

| Service | Default Host Port | Override |
|---|---:|---|
| Lucy WebUI/API | `55176` | `LUCY_DEMO_WEBUI_HOST_PORT` |
| Lucy MCP Proxy | `57881` | `LUCY_DEMO_PROXY_HOST_PORT` |
| Demo MySQL | `53306` | `LUCY_DEMO_MYSQL_HOST_PORT` |

## KTX Candidate Version

To test a candidate bundled KTX version:

```bash
KTX_VERSION=<version> LUCY_EXPECTED_KTX_VERSION=<version> npm run smoke:p0:demo
```

For the full upgrade compatibility gate:

```bash
npm run compat:ktx-upgrade -- --candidate <version>
```
