# Lucy Docker Demo (POC)

Self-contained POC stack: **independent database**, **YAML context**, **eval suite**, and **smoke gates** — not part of the default `docker-compose.yml` customer path.

See `docs/lucy-poc-demo-isolation-spec.md` for the full boundary between customer default and POC demo.

## Contents

| Path | Purpose |
|---|---|
| `docker-compose.demo.yml` | Runs Lucy plus demo MySQL |
| `examples/docker-demo/mysql/01-init.sql` | Seeds Superstore-style demo data |
| `examples/docker-demo/mysql/_baseline.json` | Numeric gold for smoke / demo eval |
| `examples/docker-demo/project-template/ktx.yaml` | Demo KTX project (`demo-mysql` → `demo-db`) |
| `examples/docker-demo/project-template/semantic-layer/` | Demo-only semantic layer |
| `examples/docker-demo/project-template/wiki/` | Demo-only wiki |
| `examples/docker-demo/project-template/evals/` | Demo-only eval (`demo_superstore`, aligned to `_baseline.json`) |
| `examples/docker-demo/project-template/webui/config/access.yaml` | Demo ACL / agent token |

**Do not** mount repo-root `evals/superstore/` here — that suite is calibrated for Aliyun 10,194-row snapshots.

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

### Listen / Publish / Advertise

| 层 | Demo 默认 | 说明 |
|---|---|---|
| Listen | 容器内 `7879` (`LUCY_PROXY_PORT`) | Proxy 绑定；勿写给 Agent |
| Publish | 宿主 `57881→7879` | `LUCY_DEMO_PROXY_HOST_PORT` |
| Advertise | `http://127.0.0.1:57881/mcp` (`LUCY_PUBLIC_MCP_URL`) | WebUI `/overview` 与 Agent 复制的唯一 URL |

`docker-compose.demo.yml` 默认注入的 `LUCY_PUBLIC_MCP_URL` 与宿主 `57881` 对齐。若改 `LUCY_DEMO_PROXY_HOST_PORT`，必须同时设置 `LUCY_PUBLIC_MCP_URL=http://127.0.0.1:<新端口>/mcp`（或你的反代 URL）。`npm run smoke:p0:demo` 会断言 `GET /api/project.mcpEndpoint` 与宿主 proxy 端口一致。

## Template Root

`LUCY_TEMPLATE_ROOT` points Lucy at the demo project template baked into the
Docker image. It is a **demo-only** bootstrap setting. Customers editing their own
compose file should remove this variable; Lucy will fall back to the on-disk
`/data/lucy` project root after the first initialization.

## Eval

POC eval lives under `project-template/evals/demo_superstore/`. Compose bind-mounts
`./examples/docker-demo/project-template/evals` → `/data/lucy/evals` (read-only).

Regenerate data baseline after changing seed/rows:

```bash
node examples/docker-demo/scripts/gen-demo-data.mjs
# then update demo_superstore-eval-cases.yaml gold to match _baseline.json
```

## KTX Candidate Version

To test a candidate bundled KTX version:

```bash
KTX_VERSION=<version> LUCY_EXPECTED_KTX_VERSION=<version> npm run smoke:p0:demo
```

For the full upgrade compatibility gate:

```bash
npm run compat:ktx-upgrade -- --candidate <version>
```
