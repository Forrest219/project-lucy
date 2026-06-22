# Lucy PostgreSQL Demo

This demo verifies Lucy against PostgreSQL as an MVP-supported database.

## Contents

| Path | Purpose |
|---|---|
| `docker-compose.postgres-demo.yml` | Runs Lucy plus PostgreSQL |
| `examples/postgres-demo/postgres/01-init.sql` | Seeds Superstore-style demo data in schema `dataforai` |
| `examples/postgres-demo/project-template/ktx.yaml` | Demo KTX project config for `driver: postgres` |

## Run

From the repository root:

```bash
npm run smoke:p0:postgres-demo
```

The smoke script creates a temporary Docker secret file for the PostgreSQL
password and removes it after the compose stack is torn down.

The smoke test validates:

- PostgreSQL health.
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
| Lucy WebUI/API | `55177` | `LUCY_POSTGRES_DEMO_WEBUI_HOST_PORT` |
| Lucy MCP Proxy | `57882` | `LUCY_POSTGRES_DEMO_PROXY_HOST_PORT` |
| PostgreSQL | `55432` | `LUCY_DEMO_POSTGRES_HOST_PORT` |

## Template Root

`LUCY_TEMPLATE_ROOT` points Lucy at the demo project template baked into the
Docker image. It is a demo-only bootstrap setting. Customers editing their own
compose file should remove this variable; Lucy will fall back to the on-disk
`/data/lucy` project root after the first initialization.

## Secrets

The demo does not store the PostgreSQL password directly in `ktx.yaml`.
`examples/postgres-demo/project-template/ktx.yaml` references the mounted Docker
secret:

```yaml
password: file:/run/secrets/postgres_password
```

For manual compose runs, create the secret file before starting the stack:

```bash
mkdir -p secrets
printf '%s' '<postgres-password>' > secrets/postgres-password
docker compose -f docker-compose.postgres-demo.yml up -d --build
```

To keep the secret outside the repository, point the compose file at another
directory:

```bash
LUCY_POSTGRES_DEMO_SECRET_DIR=/path/to/demo-secrets \
docker compose -f docker-compose.postgres-demo.yml up -d --build
```

## KTX Candidate Version

To test a candidate bundled KTX version:

```bash
KTX_VERSION=<version> LUCY_EXPECTED_KTX_VERSION=<version> npm run smoke:p0:postgres-demo
```
