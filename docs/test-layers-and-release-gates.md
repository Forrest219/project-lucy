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
| `npm run smoke:p0:headless-config` | customer config | verifies the recommended `/data/lucy` config package shape, secret references, semantic-layer/wiki/eval/access parseability, and compose override |
| `npm run smoke:p0:demo` | runtime + platform + customer path | demo DB, KTX connection/reindex/validate/query, Lucy MCP Proxy bearer token, `sl_read_source`, `sl_query` |
| `npm run smoke:p0:postgres-demo` | runtime + platform + customer path | PostgreSQL demo DB, KTX connection/reindex/validate/query, Lucy MCP Proxy bearer token, `sl_read_source`, `sl_query` |
| `npm run smoke:p0:business-eval` | business eval catalog | verifies core eval suites can be read by runner |
| `npm run smoke:p0:customer` | customer/manual | verifies configured real DB path on this machine |
| `npm run smoke:p1:context` | context governance | semantic-layer inventory/readability and key wiki playbook evidence; optional KTX/proxy runtime checks |
| `npm run smoke:p1:skills` | skill governance | `SKILL.md` frontmatter, dependency references, runtime boundary, and eval `skill_version` coverage |
| `npm run smoke:p1:endpoint` | MCP lifecycle | authenticated proxy precheck, `initialize`, `tools/list`, and `lucy_read_source` forwarding metadata |
| `npm run smoke:p1:observability` | observability | generic `/api/observability` evidence; reports blocked if WebUI service is not reachable |
| `npm run e2e:agent` | agent database E2E | database-backed Lucy MCP control path plus main/Hermes/moz agent final-answer assertions; missing local tokens or agent adapters returns blocked evidence |
| `npm run e2e:agent:ceo-one-report` |主题级 agent E2E | CEO 一眼报类 SOW 可信 Eval/UAT gate 占位；当前跑 `data_agent_poc` suite，输出 trace/context/score artifact |
| `npm run e2e:agent:local-hermes` | real local Hermes E2E | repeatable local harness for Hermes workhorse + moz: generates runtime-only token hashes, starts KTX/WebUI/proxy, calls real Hermes, runs agent assertions, then cleans up |
| `npm run e2e:sow-trust-standard` | SOW trust E2E standard | runs real local Hermes E2E with default local trace links, then packages strict READY evidence for external SOW review |
| `npm run smoke:p1:agent-e2e` | compatibility alias | legacy command name for `e2e:agent`; do not treat stub/unit coverage as E2E acceptance |
| `npm run smoke:p1:agent-e2e:local-hermes` | compatibility alias | legacy command name for `e2e:agent:local-hermes` |
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
npm run smoke:p0:headless-config
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
npm run e2e:agent
npm run e2e:agent:ceo-one-report
npm run smoke:p1:business-eval-full -- --require-mcp-token
npm run smoke:p1:release-readiness
```

`e2e:agent` expects `LUCY_E2E_MAIN_TOKEN`, `LUCY_E2E_HERMES_TOKEN`, `LUCY_E2E_MOZ_TOKEN`, `LUCY_E2E_MOZ_EXPECTED_ROLE`, and `LUCY_E2E_AGENT_COMMANDS` on machines that validate all three local agent paths. It writes canonical machine evidence to `inbox/p1-agent-e2e-evidence.json`, a human-readable report to `inbox/p1-agent-e2e-report.html`, and redacted agent/MCP artifacts to `inbox/p1-agent-e2e-artifacts/`. The `smoke:p1:agent-e2e` name remains only as a compatibility alias.

On Forrest's local machine, the repeatable Hermes/moz path is:

```bash
npm run e2e:agent:local-hermes
npm run package:sow-trust-evidence -- --strict
```

That wrapper generates one-run tokens in memory, writes only their hashes to ignored `inbox/p1-agent-e2e-local-access.yaml`, starts KTX MCP and Lucy WebUI/proxy with `LUCY_ACCESS_CONFIG_PATH`, runs `e2e:agent -- --profile hermes --profile moz`, writes canonical evidence to `inbox/p1-agent-e2e-hermes-moz-evidence.json`, writes the human report to `inbox/p1-agent-e2e-hermes-moz-report.html`, writes wrapper evidence to `inbox/p1-agent-e2e-local-hermes-run.json`, and stops services it started. Hermes profile configs must reference `LUCY_E2E_HERMES_TOKEN` and `LUCY_E2E_MOZ_TOKEN`; the wrapper does not read or print `.ktx/secrets/` contents. Its evidence declares `gateKind: e2e`, `agentRuntime: hermes`, `stub: false`, and runtime profiles for workhorse/moz.

### 3.1 SOW Trust E2E Standard

CEO 一眼报 / SOW 可信 Eval/UAT 对外展示必须使用以下可复跑标准：

```bash
npm run e2e:sow-trust-standard
```

展开后等价于：设置默认 `LUCY_E2E_TRACE_BASE_URL=http://127.0.0.1:5174/api/observability/logs?traceId={traceId}`，执行 `npm run e2e:agent:local-hermes`，再执行 `npm run package:sow-trust-evidence -- --strict`。需要接入其他 trace UI 时，可显式覆盖 `LUCY_E2E_TRACE_BASE_URL`。

标准输出物：

| Artifact | Path | Standard |
|---|---|---|
| Machine evidence | `inbox/ceo-one-report-sow-trust-evidence-package/real-hermes-moz-evidence.json` | `status=pass`, `stub=false`, `agentRuntime=hermes-local-real` |
| Human report | `inbox/ceo-one-report-sow-trust-evidence-package/real-hermes-moz-report.html` | Summary 以 `100% (x/y)` 展示 rate 与样本量 |
| Manifest | `inbox/ceo-one-report-sow-trust-evidence-package/manifest.json` | `status=READY` |
| Per-case artifacts | `inbox/ceo-one-report-sow-trust-evidence-package/real-hermes-moz-artifacts/*.json` | 含 `traceId`, `score`, `failureClassification`, `semanticQueries`, `wikiContextEvidence`, `lucyMeta`, `finalAnswer` |

机器验收条件：

- `package:sow-trust-evidence -- --strict` 返回 0，且 manifest `status` 为 `READY`。
- Run summary 必须包含 rate 的分子、分母和值：`passedChecks/totalChecks/passRate`、`scorePassCases/scoreTotalCases/scorePassRate`、`tracedCases/agentCaseCount/traceCoverageRate`、`uniqueTraces/agentCaseCount/traceUniquenessRate`、`artifactCompleteCases/artifactTotalCases/artifactCompleteness`。
- Access control 必须包含 `allowPass/allowTotal/allowPassRate` 与 `denyPass/denyTotal/denyPassRate`。
- HTML Summary 必须展示 `通过率 100% (34/34 checks)`、`评分通过率 100% (2/2 cases)`、`Trace 覆盖 100% (2/2 cases)`、`Deny 拦截率 100% (12/12 hits)`、`Allow 放行率 100% (8/8 hits)` 这一类带基数形态；具体数字随 case 数变化，但格式不能退化为裸百分比。
- 若设置 `LUCY_E2E_TRACE_BASE_URL`，artifact 摘要里的 traceId 必须渲染为可点击链接；未设置时仅展示 traceId。
- `context_required` case 必须有 `wikiContextEvidence`；当前 local Hermes KX gate 没有 context-required case 时，summary 应显示 `contextRequiredCases=0` 且 `contextEvidenceCoverage=true`，不得伪造非空 context evidence。

该标准是对外 SOW 证据标准；`npm run e2e:agent:test`、stub proxy 单测、dry-run 和 smoke test 只能证明 harness，不可替代真实 Agent + Lucy/KTX MCP E2E。

### 3.2 Headless Customer Config Package Standard

客户 Docker headless 交付默认采用 **标准 Lucy image + `customer-config/` bind mount 到 `/data/lucy`**。部署 readiness 必须能说明同一份 `/data/lucy` 配置事实源覆盖数据库连接、semantic-layer、wiki、eval、skills、agent access 和 runtime state。

静态 gate：

```bash
npm run smoke:p0:headless-config -- --root customer-config.example
```

客户真实配置包 gate：

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```

机器验收条件：

- `docker-compose.customer-config.yml` 将 `./customer-config` bind mount 到 `/data/lucy`。
- `ktx.yaml` 不含 `CHANGE-ME`，连接密码只使用 `file:` secret 引用；真实客户包加 `--require-secret-files` 时 secret 文件必须存在。
- `semantic-layer/` 至少包含一个 `_schema` manifest 与一个 overlay YAML。
- `wiki/` 至少包含一个 Markdown context 文档。
- `evals/` 至少包含一个可解析且非空的 `*-eval-cases.yaml`。
- `webui/config/access.yaml` 至少包含一个 role 和一个 user，token 只允许 `sha256:` hash，不允许明文 token 字段。

该 gate 只证明客户配置包可交付；它不能替代数据库 `connection test`、`admin reindex`、`sl validate`、ACL smoke 或 SOW trust E2E。

Agent E2E acceptance requires real agent runtime execution. Unit tests such as `npm run e2e:agent:test` and proxy smoke tests can protect the harness and ACL logic, but they do not satisfy the database-to-agent E2E standard.

If the machine lacks agent/model secrets, a running WebUI service, Lucy proxy token, local agent adapters, or StarRocks live config, the relevant P1 gate must write `blocked` evidence rather than returning a fake pass. `npm run smoke:p1:release-readiness -- --allow-blocked` is only for collecting a pre-release evidence bundle while known external dependencies are still unavailable.

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
| headless-config | `npm run smoke:p0:headless-config` |
| demo-e2e | `npm run smoke:p0:demo` |
| postgres-demo-e2e | `npm run smoke:p0:postgres-demo` |
| business-eval-catalog | `npm run smoke:p0:business-eval` |
| p1-context | `npm run smoke:p1:context -- --strict-runtime` in a prepared KTX/proxy environment |
| p1-skills | `npm run smoke:p1:skills` |
| p1-endpoint | protected secret environment: `npm run smoke:p1:endpoint -- --proxy-url <url> --token <token>` |
| p1-observability | service environment: `npm run smoke:p1:observability -- --url <url>/api/observability` |
| p1-agent-e2e | protected local agent environment: `npm run e2e:agent` |
| p1-agent-e2e-local-hermes | Forrest local protected agent environment: `npm run e2e:agent:local-hermes` |
| sow-trust-e2e-standard | Forrest local protected agent environment: `npm run e2e:sow-trust-standard` |
| p1-business-eval-full | protected model/MCP secret environment: `npm run smoke:p1:business-eval-full -- --require-mcp-token` |
| p1-release-readiness | `npm run smoke:p1:release-readiness` |
| ktx-diff-audit | `npm run audit:ktx-diff -- --out inbox/ktx-lucy-diff-$(date +%F).md` |
| ktx-upgrade-compat | `npm run compat:ktx-upgrade -- --candidate <version>` |
| customer-real-db | manual or protected secret environment: `npm run smoke:p0:customer` |

GitHub Actions implementation: `.github/workflows/lucy-release.yml`.

For customer signoff, treat `security-baseline`, `docker-smoke`, `headless-config`, `demo-e2e`, `postgres-demo-e2e`, and `business-eval-catalog` as the headless gate set. `spec-and-unit` / WebUI checks can remain required for repository release hygiene, but customer documentation and release notes must describe them as internal quality gates rather than customer operation steps.
