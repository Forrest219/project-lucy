# Lucy Version Matrix

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Version Matrix |
| 文档类型 | Release Metadata / Compatibility Matrix |
| 版本 | v0.6 |
| 撰写日期 | 2026-06-21；2026-07-06；2026-08-03（增补：Helm/K8s single-replica supported baseline）；2026-09-02（拆分 Lucy 产品版本与 KTX；基线 0.17.0）；2026-10-19（批准切线到 `2.0.0`）；2026-10-21（§4 Database Matrix 状态值改为引用 `docs/governance/database-support-matrix.md`，补齐 StarRocks / Doris / SQL Server / Oracle / SQLite / Athena）；2026-10-24（产品版本由 `2.0.0` 经 `0.2.0` 更正为 `0.20.0`；§1.1.1 改为同一版本线按数值递增；登记产品版本与部署制品解耦原则）；2026-10-29（客户镜像 CI 改为原生 linux/amd64 单架构，不再写 QEMU 多架构清单） |
| 适用范围 | Lucy release、Docker image、bundled KTX runtime 和 MCP client 兼容性追踪 |

## 1. Current Baseline

| Component | Current Baseline | Evidence |
|---|---|---|
| **Lucy product version** | **`0.20.0`** | repo-root `VERSION`, `Chart.yaml` `appVersion`, `/api/health.data.lucyVersion`, WebUI 版本信息页 |
| Lucy source | `main` at the v0.20.0 release commit | see `docs/releases/README.md` for the per-version commit and digest ledger |
| Lucy package | `project-lucy-eval@0.20.0` | `package.json` (aligned with product version) |
| WebUI package | `webui@1.0.0` | `webui/package.json` (npm package only; not customer-facing) |
| Bundled KTX npm package | `@kaelio/ktx@0.16.0` | `Dockerfile`, `docker-compose.yml`, `npm run smoke:p0:docker` |
| KTX Python runtime | `0.16.0`, feature `core` | `Dockerfile` runs `ktx admin runtime install --yes --feature core` |
| Node runtime | `node:22-bookworm-slim` | `Dockerfile` |
| Docker deployment | Single-node Docker Compose for development, demo and upgrade validation; not a validated customer delivery form | `docker-compose.yml`, `deploy/compose/docker-compose.demo.yml`, `deploy/compose/docker-compose.postgres-demo.yml` |
| Headless customer config | `customer-config/` bind mount to `/data/lucy` | `deploy/compose/docker-compose.customer-config.yml`, `customer-config.example/`, `npm run smoke:p0:headless-config` |
| Demo DB | `mysql:8.4`, `postgres:16-alpine` | `deploy/compose/docker-compose.demo.yml`, `deploy/compose/docker-compose.postgres-demo.yml` |
| Customer DB path | MySQL validated locally | `npm run smoke:p0:customer` |
| Kubernetes / Helm deployment | Single-replica only; `Recreate` strategy; RWO PVC at `/data/lucy`; customer image is linux/amd64 | `deploy/k8s/helm/lucy/`, `docs/runbooks/customer-k8s-deployer-quickstart.md`, `.github/workflows/lucy-release.yml` |
| Image architecture baseline | Customer CI image is linux/amd64 only, built natively on `ubuntu-24.04`. Metadata and layer ELF must match. Local Apple Silicon demos still build linux/arm64 for that host. | `Dockerfile` (`TARGETPLATFORM` + `TARGETARCH`), `scripts/release/assert-image-elf-arch.sh`, `.github/workflows/lucy-release.yml` |
| MCP endpoint | Lucy MCP Proxy on container `7879` | `docs/runbooks/deployment-docker.md`, `docs/runbooks/customer-k8s-deployer-quickstart.md`, `npm run smoke:p0:demo` |
| Release CI | GitHub Actions on `ubuntu-24.04`. Pull requests and `main` run headless gates. Tag and manual runs promote one linux/amd64 digest to GHCR. | `.github/workflows/lucy-release.yml`, `docs/governance/release-ci.md` |

## 1.1 When to bump Lucy product version

`VERSION` / `appVersion` / image tag **product segment** change only when shipping a **customer-visible delivery**. Everyday `main` commits do **not** auto-bump.

| Trigger | Bump | Example |
|---|---|---|
| Customer delivery package / offline image / K8s tar that the customer will deploy | **Increment the second component by 1** (`0.20.0` → `0.21.0`) | ACL fix + audit hardening shipped as next tar |
| Large capability jump, breaking config/migration, or bundled KTX major change | **Increment the second component by 10** (`0.20.0` → `0.30.0`) | New permission model; HA chart; KTX 0.17+ with breaking MCP |
| Docs-only handbook refresh with **same** image digest | **No** product bump; package name may still use date (`20260903-v1`) | README / RELEASE_NOTES only |
| Internal CI / demo rebuild, no customer handoff | **No** bump | `npm run demo:upgrade` |
| Bundled KTX upgrade alone | Bump `bundledKtxVersion` / `KTX_VERSION`; **also** bump Lucy product version (customer must tell builds apart) | KTX `0.16.0` → `0.17.0` and Lucy `0.21.0` |

### 1.1.1 Active product lines use numeric ordering

**Versions within one Lucy product line increase numerically.** The active `0.x` line is ordered `0.20.0 > 0.17.0 > 0.2.0`; a later release must not reuse a lower number to represent newer contents.

Two consequences:

- **Use product-version ordering within the active line** when expressing release succession and upgrade paths. Do not introduce a lower current version and then declare that version numbers have no ordering.
- **Use the build revision** (§1.2) — the 40-hex commit — to identify the exact build and compare it with `main`. This supplements product-version ordering; it does not permit version regression.

The erroneous `2.0.0` product cut was retired on 2026-10-24. The short-lived correction from `2.0.0` to `0.2.0` was then corrected to `0.20.0` because `0.2.0 < 0.17.0`. The `v2.0.0` and `v0.2.0` tags and GitHub Releases remain historical facts; the retired `2.0.0` cut is not the baseline of the active `0.x` line. A genuinely new product or version line requires explicit approval and a clearly documented naming and succession boundary.

Lucy versions use numeric `X.Y.Z` syntax so npm, Helm, and container tooling can parse them, but the bump policy is a Lucy release-train policy rather than SemVer compatibility signaling. The current `0.20.Z` line keeps `Z` at `0` until this matrix defines a separate repack/hotfix policy. The next major (`1.0.0`) needs the same kind of explicit approval.

Product versions and deployment artifacts are independently versioned. Docker, Helm Chart, pure Manifest and other delivery paths for the same product contents share one Lucy product version; Chart, image tag, delivery-package revision and bundled KTX identities do not fork that product line. Each artifact records its own support and gate status. See `AGENTS.md` “部署方式与版本制品解耦（全局原则）”.

**SSOT:** edit repo-root `VERSION` first, then align `package.json` + `package-lock.json`, `Dockerfile` `ARG LUCY_VERSION` default, Helm `appVersion` + `lucy.version` + default `image.tag`, and the guarded WebUI fallbacks. Run `npm run lint:version`; release/build jobs must fail when any projection, image tag, or embedded image environment differs. Customer image tag format:

`project-lucy:customer-amd64-<LUCY_VERSION>-<YYYYMMDD>-<gitSha>`

Do **not** put KTX version in the product segment of the tag. KTX remains in `/api/health.data.bundledKtxVersion` and Helm `lucy.bundledKtxVersion`.

## 1.2 Build revision (not a product version)

The 版本信息 page and `/api/health` show the source commit that was built. `/api/health` keeps the full 40-hex commit; the 版本信息 page shows its first 12 characters and keeps the full value in the copy action. That value is how an upgrade is matched to `main`. It is not chosen in `VERSION`, Helm, or `LUCY_VERSION`. The sidebar footer does not show it.

| Field | Meaning |
|---|---|
| `/api/health.data.gitSha` | Full 40-hex commit, or `unknown` |
| `/api/health.data.gitDirty` | `true` when the stamped tree had uncommitted changes |
| WebUI `/admin/version` | Product version, the first 12 characters of `gitSha` (the full value stays in `title` and the copy action), a Chinese workspace sentence, and bundled KTX version. The page does not show the word `dirty` |

Normative resolution, stamp file, and the rule that runtime env cannot replace it: [`docs/specs/lucy-20261020-build-revision-identity-spec.md`](../specs/lucy-20261020-build-revision-identity-spec.md). Image builds pass `LUCY_GIT_SHA` only as a Docker build arg because `.dockerignore` excludes `.git`. The image stores the result in `/app/BUILD_REVISION` and does not keep `LUCY_GIT_SHA` in the runtime environment.

## 2. Runtime Compatibility

| Surface | Required Version / Behavior | Gate |
|---|---|---|
| KTX CLI | `ktx --version` returns `@kaelio/ktx 0.16.0` | `npm run smoke:p0:docker` |
| KTX Python runtime | `ktx sl query --execute` runs without interactive install | `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo` |
| KTX semantic layer validate | CLI `ktx sl validate` works | `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer` |
| KTX MCP tools | `connection_list`, `sl_read_source`, `sl_query`, `wiki_search` are available | `npm run smoke:p0:demo`, `npm run smoke:p0:postgres-demo`, `npm run smoke:p0:customer` |
| `sl_validate` MCP tool | Not exposed by KTX `0.16.0` MCP `tools/list` | validate via CLI gate |
| Lucy MCP Proxy | Bearer auth, ACL filtering, `kx_catalog`, `sl_read_source`, `sl_query` | `npm run smoke:p0:demo` |
| KTX candidate upgrade | Candidate version must pass Docker/demo/business gates | `npm run compat:ktx-upgrade -- --candidate <version>` |

## 3. Supported Deployment Matrix

| Deployment | Status | Notes |
|---|---|---|
| Docker Compose single node | supported baseline | P0 release baseline |
| Docker Compose customer config package | supported baseline | maintain `customer-config/`, bind mount to `/data/lucy`, run `smoke:p0:headless-config` |
| Docker Compose demo DB | supported smoke/demo path | MySQL demo DB + Lucy |
| Docker Compose external MySQL | supported with customer config package | edit `customer-config/ktx.yaml`, use `file:/data/lucy/.ktx/secrets/<name>` |
| Docker Compose external PostgreSQL | supported with customer config package | edit `customer-config/ktx.yaml`, use `file:/data/lucy/.ktx/secrets/<name>` |
| Kubernetes / Helm (single-replica) | supported baseline | `deploy/k8s/helm/lucy/`, `Recreate` strategy, RWO PVC; HA not supported yet |
| Hosted SaaS / multi-tenant | not supported | future product line |

## 4. Database Matrix

Customer-facing summary of the release verified matrix. **The authoritative support status for every database type — including evidence requirements and known protocol differences — lives in `docs/governance/database-support-matrix.md`.** This section must not grow its own status list; update that document instead.

| Database | Status | Gate |
|---|---|---|
| MySQL demo (`mysql:8.4`) | verified | `npm run smoke:p0:demo` |
| Aliyun RDS MySQL | verified locally | `npm run smoke:p0:customer` |
| PostgreSQL demo (`postgres:16-alpine`) | verified | `npm run smoke:p0:postgres-demo` |
| SQLite | verified for local file use only | `npm run smoke:p0:demo` |
| StarRocks | gated — not in the verified matrix until live certification evidence exists | `npm run smoke:p1:starrocks-certification` (blocked without a real config) |
| Apache Doris | gated — R1 target; evidence required per environment | `npm run r1:doris-smoke`, `npm run r1:readiness:strict` |
| SQL Server | experimental — connection type available, no live evidence | — |
| Amazon Athena | experimental — connection type available, no live evidence | — |
| Oracle | roadmap — not started | — |
| ClickHouse | not verified for Lucy P0 | future compatibility gate |
| Snowflake | not verified for Lucy P0 | future compatibility gate |

StarRocks and Apache Doris reuse the `mysql` driver over the MySQL wire protocol. Engines that do not accept `max_execution_time` need an image that carries the compatibility patch — see `docs/governance/database-support-matrix.md` §4 for the symptom, the triage command, and the residual risk.

## 5. MCP Client Matrix

| Client | Status | Notes |
|---|---|---|
| Generic HTTP MCP client | verified by script | `scripts/smoke/p0-demo-docker-smoke.mjs` uses JSON-RPC over HTTP |
| Claude Code | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用。2026-08-20：Streamable HTTP 有限 SSE / progress 帧选择与 Cursor 同类问题，见 Spec 07 §4.3 / §6.1.0 |
| Codex | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Openclaw | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用（对有限 SSE / progressToken 较宽松，不易复现 Cursor/Claude Code 超时） |
| Hermes | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用 |
| Cursor | verified manually | 2026-06-24 Forrest 验收：可通过 Lucy MCP Proxy 完成 `tools/list` 与 `sl_read_source`/`sl_query` 基础调用。后续实锤：有限 SSE + progress 首帧误判 → `-32001`；修复见 Spec 07 §4.3 / §6.1.0 |
| Claude Desktop stdio | documented for local KTX in development docs | Not a Docker P0 customer path |
| Cloud-hosted agent | not verified | Requires public URL, TLS, and access control |

## 6. Release Metadata Template

Every Lucy release should record:

```yaml
lucy:
  version: "0.20.0"
  git_commit: <git-sha>
  docker_image: <registry/image:tag>
ktx:
  npm_package: "@kaelio/ktx"
  npm_version: "0.16.0"
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

- Lucy **product** version (`VERSION` / `appVersion`) or git commit used for a customer delivery.
- Docker base image.
- Bundled KTX version.
- KTX Python runtime feature level.
- Supported database or MCP client.
- Required release gates.
- Supported deployment topology (e.g. when K8s/Helm graduates from single-replica to HA).
