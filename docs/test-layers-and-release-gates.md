# Lucy Test Layers And Release Gates

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Test Layers And Release Gates |
| 文档类型 | Testing / Release Gate Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-21 |
| 适用范围 | Lucy runtime compatibility、platform smoke、business eval 和 release gate 分层 |

## 1. Principle

Lucy 的测试分三层，不能互相替代：

| Layer | Purpose | Owns |
|---|---|---|
| Runtime compatibility tests | 验证 bundled KTX runtime 在 Lucy Docker image 中可用 | KTX CLI、KTX Python runtime、KTX MCP tools、semantic-layer validate/query |
| Platform tests | 验证 Lucy 自身管理平台行为 | WebUI/API、MCP Proxy、auth/ACL/audit、Docker entrypoint/healthcheck |
| Business evals | 验证 agent 能用业务语义、wiki 和口径回答问题 | `evals/` cases、expected SQL/result/text、LLM/agent behavior |

## 2. Current Commands

| Command | Layer | Purpose |
|---|---|---|
| `npm run lint:spec` | platform | spec drift checks for routes/API/skills/evals/access roles |
| `npm run security:baseline` | security + platform | token hash, wildcard ACL, deny tools, audit hooks, secrets exclusion baseline |
| `npm run smoke:p0` | platform | local build/test/spec/WebUI health/static SPA smoke |
| `npm run smoke:p0:docker` | runtime + platform | Docker image build, compose up, `/api/health`, MCP proxy port, bundled KTX version |
| `npm run smoke:p0:demo` | runtime + platform + customer path | demo DB, KTX connection/reindex/validate/query, Lucy MCP Proxy bearer token, `sl_read_source`, `sl_query` |
| `npm run smoke:p0:postgres-demo` | runtime + platform + customer path | PostgreSQL demo DB, KTX connection/reindex/validate/query, Lucy MCP Proxy bearer token, `sl_read_source`, `sl_query` |
| `npm run smoke:p0:business-eval` | business eval catalog | verifies core eval suites can be read by runner |
| `npm run smoke:p0:customer` | customer/manual | verifies configured real DB path on this machine |
| `npm run audit:ktx-diff` | governance | regenerates KTX vs Lucy first/second-level directory and file diff audit |
| `npm run compat:ktx-upgrade -- --candidate <version>` | runtime + platform upgrade | validates a candidate bundled KTX version through Docker/demo/business gates |

### 2.1 Local Node / Native Addon Note

CI runs fresh installs on Node 22 (`actions/setup-node@v4 node-version: 22`). Local checkouts may have `webui/node_modules` compiled under a different Node ABI, especially `better-sqlite3`; if `npm --prefix webui test` fails with a native module ABI mismatch, either rebuild/reinstall `webui` dependencies under the active Node version or run the verification with the Node version that built the current `node_modules`. Do not treat this local ABI mismatch as a release gate failure unless it reproduces after a fresh install.

## 3. Required P1 Release Baseline

Required before a Docker release candidate:

```bash
npm run smoke:p0
npm run security:baseline
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:postgres-demo
npm run smoke:p0:business-eval
npm run audit:ktx-diff
```

Optional but recommended before customer-facing validation:

```bash
npm run smoke:p0:customer
```

Required before changing bundled KTX version:

```bash
npm run compat:ktx-upgrade -- --candidate <version>
```

## 4. Runtime Compatibility Gates

| Gate | Pass Criteria |
|---|---|
| KTX version | image returns expected `@kaelio/ktx <version>` |
| KTX Python runtime | `ktx sl query --execute` runs without interactive runtime install |
| Connection | `ktx connection test <connection-id>` passes |
| Reindex | `ktx admin reindex --force` exits 0 |
| Semantic validate | `ktx sl validate <source> --connection-id <connection>` exits 0 |
| Semantic query | `ktx sl query --execute` returns rows |
| MCP tools | required tools are present in `tools/list` |

Current KTX `0.13.0` MCP `tools/list` does not expose `sl_validate`; validate is covered by CLI.

Candidate KTX versions are injected with `KTX_VERSION` and `LUCY_EXPECTED_KTX_VERSION`; the compatibility wrapper does not edit source files.

## 5. Platform Gates

| Gate | Pass Criteria |
|---|---|
| WebUI build | `webui npm run build` exits 0 |
| WebUI tests | `webui npm test` exits 0 |
| API health | `/api/health` returns `{ ok: true }` |
| Docker compose config | `docker compose config` exits 0 |
| Entrypoint syntax | `bash -n scripts/docker-entrypoint.sh scripts/docker-healthcheck.sh` exits 0 |
| MCP Proxy auth | valid bearer token can initialize an MCP session |
| MCP Proxy ACL | denied tools are hidden from `tools/list` |
| MCP Proxy forwarding | `sl_read_source` and `sl_query` succeed via Lucy Proxy |

## 6. Business Eval Gates

P1 baseline:

- Eval YAML files are parseable.
- Expected case count is non-zero.
- Runner can list Superstore and KX Financial suites.

Full business eval, requiring agent/model credentials:

```bash
npm run eval -- --cases evals/superstore/eval/superstore-eval-cases.yaml --format md
npm run eval -- --cases evals/kx_financial/eval/kx_financial-eval-cases.yaml --format md
```

Full eval should run in an environment with:

- Agent CLI installed and authenticated.
- MCP endpoint reachable.
- Required bearer token available.
- Target DB or demo DB available.

## 7. Failure Triage

| Failure Area | First Check |
|---|---|
| Docker build fails | Dockerfile dependency install, Docker Hub auth, build args |
| Container starts but health fails | `docker compose logs -f lucy` |
| KTX query asks to install runtime | image missed `ktx admin runtime install --yes --feature core` |
| MCP 401/403 | bearer token hash in `access.yaml`, ACL role, token revocation |
| `sl_query` returns no rows | DB seed/config, semantic-layer source, segment/filter |
| Eval catalog fails | YAML schema or runner path drift |

## 8. CI Mapping

Recommended CI jobs:

| Job | Commands |
|---|---|
| spec-and-unit | `npm run lint:spec`; `cd webui && npm test` |
| security-baseline | `npm run security:baseline` |
| docker-smoke | `npm run smoke:p0:docker` |
| demo-e2e | `npm run smoke:p0:demo` |
| postgres-demo-e2e | `npm run smoke:p0:postgres-demo` |
| business-eval-catalog | `npm run smoke:p0:business-eval` |
| ktx-diff-audit | `npm run audit:ktx-diff -- --out inbox/ktx-lucy-diff-$(date +%F).md` |
| ktx-upgrade-compat | `npm run compat:ktx-upgrade -- --candidate <version>` |
| customer-real-db | manual or protected secret environment: `npm run smoke:p0:customer` |

GitHub Actions implementation: `.github/workflows/lucy-release.yml`.
