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
| `npm run smoke:p1:context` | context governance | semantic-layer inventory/readability and key wiki playbook evidence; optional KTX/proxy runtime checks |
| `npm run smoke:p1:skills` | skill governance | `SKILL.md` frontmatter, dependency references, runtime boundary, and eval `skill_version` coverage |
| `npm run smoke:p1:endpoint` | MCP lifecycle | authenticated proxy precheck, `initialize`, `tools/list`, and `lucy_read_source` forwarding metadata |
| `npm run smoke:p1:observability` | observability | generic `/api/observability` evidence; reports blocked if WebUI service is not reachable |
| `npm run smoke:p1:business-eval-full` | business eval full run | full Superstore, KX Financial, and Data Agent POC agent eval; requires agent/model/MCP environment |
| `npm run smoke:p1:starrocks-certification` | R1 StarRocks gated support | fail-closed certification wrapper; missing live StarRocks config writes blocked evidence |
| `npm run smoke:p1:release-readiness` | aggregate | runs P1 gates and writes aggregate evidence; use `--allow-blocked` only for pre-release evidence collection |
| `npm run audit:ktx-diff` | governance | regenerates KTX vs Lucy first/second-level directory and file diff audit |
| `npm run compat:ktx-upgrade -- --candidate <version>` | runtime + platform upgrade | validates a candidate bundled KTX version through Docker/demo/business gates |

### 2.1 Local Node / Native Addon Baseline

CI runs fresh installs on Node 22 (`actions/setup-node@v4 node-version: 22`), and local verification should use the same baseline. After switching Node versions or inheriting a stale `webui/node_modules`, run `npm --prefix webui ci` once to rebuild native addons such as `better-sqlite3`; then `npm --prefix webui test` should pass without a custom `PATH`. This was reverified on 2026-06-29 with local Node `v22.22.2`.

## 3. Required P1 Release Baseline

Required before a customer headless Docker release candidate:

```bash
npm run security:baseline
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:postgres-demo
npm run smoke:p0:business-eval
```

Required before promoting P1 governance capabilities to verified:

```bash
npm run smoke:p1:context -- --with-ktx --proxy-url <lucy-mcp-url> --token <token>
npm run smoke:p1:skills
npm run smoke:p1:endpoint -- --proxy-url <lucy-mcp-url> --token <token> --connection <id> --source <source>
npm run smoke:p1:observability -- --url <webui-url>/api/observability
npm run smoke:p1:business-eval-full -- --require-mcp-token
npm run smoke:p1:release-readiness
```

If the machine lacks agent/model secrets, a running WebUI service, Lucy proxy token, or StarRocks live config, the relevant P1 gate must write `blocked` evidence rather than returning a fake pass. `npm run smoke:p1:release-readiness -- --allow-blocked` is only for collecting a pre-release evidence bundle while known external dependencies are still unavailable.

Optional but recommended before customer-facing validation:

```bash
npm run smoke:p0:customer
```

Repository quality gates that may still run in CI, but are not customer headless usage paths:

```bash
npm run smoke:p0
npm run audit:ktx-diff
```

`npm run smoke:p0` includes WebUI build/test/static SPA checks. Those checks protect repository quality and future governance UI work; they do not mean WebUI is a customer standard entry point for this release.

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
npm run eval -- --cases evals/data_agent_poc/eval/data_agent_poc-eval-cases.yaml --format md
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
| p1-context | `npm run smoke:p1:context -- --strict-runtime` in a prepared KTX/proxy environment |
| p1-skills | `npm run smoke:p1:skills` |
| p1-endpoint | protected secret environment: `npm run smoke:p1:endpoint -- --proxy-url <url> --token <token>` |
| p1-observability | service environment: `npm run smoke:p1:observability -- --url <url>/api/observability` |
| p1-business-eval-full | protected model/MCP secret environment: `npm run smoke:p1:business-eval-full -- --require-mcp-token` |
| p1-release-readiness | `npm run smoke:p1:release-readiness` |
| ktx-diff-audit | `npm run audit:ktx-diff -- --out inbox/ktx-lucy-diff-$(date +%F).md` |
| ktx-upgrade-compat | `npm run compat:ktx-upgrade -- --candidate <version>` |
| customer-real-db | manual or protected secret environment: `npm run smoke:p0:customer` |

GitHub Actions implementation: `.github/workflows/lucy-release.yml`.

For customer signoff, treat `security-baseline`, `docker-smoke`, `demo-e2e`, `postgres-demo-e2e`, and `business-eval-catalog` as the headless gate set. `spec-and-unit` / WebUI checks can remain required for repository release hygiene, but customer documentation and release notes must describe them as internal quality gates rather than customer operation steps.
