# Lucy Release CI

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Release CI |
| 文档类型 | Release / CI Spec |
| 版本 | v0.4 |
| 撰写日期 | 2026-06-22；2026-07-06；2026-09-02 v0.3 最终 digest 门禁与 Required checks；2026-10-29 v0.4 日常门禁钉 ubuntu-24.04、PR 取消并发，并修正 registry 与单架构口径 |
| 适用范围 | GitHub Actions release gates、Docker image build、KTX upgrade compatibility |

## 1. CI Workflow

Workflow file:

- `.github/workflows/lucy-release.yml`

Triggers:

- Pull request.
- Push to `main`.
- Push tag `v*`.
- Manual `workflow_dispatch`.

Manual inputs:

| Input | Default | Purpose |
|---|---|---|
| `ktx_version` | `0.16.0` | Candidate bundled `@kaelio/ktx` version |
| `release_tag` | empty | Optional image/release tag for manual release package |

## 2. Required Gates

> ⚡ **Customer Image / Package Delivery Gate**: Any release involving Docker or K8s delivery to customers must strictly follow [`docs/runbooks/customer-delivery-preflight-checklist.md`](../runbooks/customer-delivery-preflight-checklist.md) and pass G0–G8, K1–K6, and **H1–H5**. CI enforces **H1** (`k8s-static`)、**H3/H4**（真实 N-1 `k8s-upgrade-gate` on kind）、以及 release 路径上对**最终 registry digest** 的 G2/G4b/G8。H5 仍需在 lucy-test 或等价集群归档证据后才可发「可直接原地升级」包。

| Job | Commands / Coverage |
|---|---|
| `spec-and-webui` | `npm run lint:spec`; `npm run security:baseline`; `webui npm test`; `webui npm run build` |
| `business-eval-catalog` | `npm run smoke:p0:business-eval` |
| `ktx-diff-audit` | clones upstream KTX and runs `npm run audit:ktx-diff` |
| `docker-smoke` | `npm run smoke:p0:docker` |
| `k8s-static` | **H1** — `npm run gate:k8s-static`（含 MCP URL 负例矩阵） |
| `k8s-upgrade-gate` | **H3 + H4** — `npm run gate:k8s-kind-h3`（N-1 baseline ref ≠ HEAD；Pod `imageID`；UID 0 / 10001 fixtures；sentinel 保留） |
| `headless-config` | `npm run smoke:p0:headless-config` |
| `demo-db-smoke` | `npm run smoke:p0:demo`（原名 `demo-e2e`，仅数据库/演示冒烟） |
| `postgres-demo-db-smoke` | `npm run smoke:p0:postgres-demo`（原名 `postgres-demo-e2e`） |
| `customer-amd64-native` | tag/manual；原生 amd64 **单架构**构建候选镜像（`candidate-amd64-…` tag），G1/G2/G3/G4/G4b/G8 结果按候选 digest 记录 |
| `real-e2e` | tag/manual；`[self-hosted, lucy-protected]` runner：同一 digest 部署到隔离单副本 K8s，执行 security / 浏览器 / 真实客户端并签名归档；无该 runner 即不可调度（BLOCKED，不退化为 headless） |
| `customer-release-readiness` | **Required check**：独立复验证据与签名归档；`npm run gate:customer-release` |
| `ktx-upgrade-compat` | manual candidate version only; runs `npm run compat:ktx-upgrade` |
| `release-package` | tag/manual only；依赖 `customer-release-readiness`；**只 promote 已测试的候选 digest**（`imagetools create`，不重建、不创建 builder）→ 对 `${IMAGE}@${DIGEST}` 复跑 G1/G2/G4b/G8 → 写 identity metadata；**禁止 gate 后再 build**；客户镜像只有 linux/amd64 单架构 |

Hosted jobs use `ubuntu-24.04`. Pull request runs in the same ref cancel the previous in-progress run. Pushes to `main` and tags do not.

`demo-db-smoke` and `postgres-demo-db-smoke` run on every pull request and on `main`. They are not branch-protection required checks until one green run is recorded; do not mark a red workflow as accepted by ignoring them.

### Branch protection Required checks

Currently enforced on `main`:

- `spec-and-webui`
- `docker-smoke`
- `k8s-static`
- `k8s-upgrade-gate`

Add `demo-db-smoke` and `postgres-demo-db-smoke` after they pass on a pull request. Release paths additionally require the final digest gates inside `release-package` and `npm run gate:k8s-package` for an offline package.

Hosted runners do not satisfy `real-e2e`. That job stays on `[self-hosted, lucy-protected, linux, amd64]` and stays unschedulable until that runner exists. Do not replace it with a headless smoke to make a tag green.

## 3. KTX Upgrade Compatibility

Local candidate check:

```bash
npm run compat:ktx-upgrade -- --candidate <ktx-version>
```

This injects:

```bash
KTX_VERSION=<ktx-version>
LUCY_EXPECTED_KTX_VERSION=<ktx-version>
```

into existing smoke gates. It does not edit source files.

The current compatibility surface is:

- Docker image can install candidate KTX npm package.
- `/api/health.data.bundledKtxVersion` reports the candidate version.
- KTX CLI can run `connection test`, `admin reindex`, `sl validate`, and `sl query --execute` against demo MySQL and demo PostgreSQL.
- Lucy MCP Proxy still exposes and forwards `sl_read_source`, `sl_query`, `wiki_search`, and `kx_catalog`.
- Business eval catalogs remain parseable.

## 4. Release Notes Artifact

For tag/manual release runs, `release-package` uploads:

- `lucy-release-artifacts`

The artifact contains:

- `lucy-docker-source-bundle.tar.gz`: customer-installable Docker Compose source bundle. This is the artifact a customer engineer can unpack and run with Docker only.
- `lucy-release-metadata.json`: Git commit, Docker image id, bundled KTX version, verified database matrix, required gates, and root/WebUI `npm audit --json` summaries with exit codes.
- `lucy-release-notes.md`: concise customer-facing release summary.
- `lucy-sbom.json`: local CycloneDX-lite runtime dependency inventory for the Lucy root package, WebUI package, base image, and bundled KTX runtime. Development-only dependencies marked `dev: true` in package-lock files are omitted; remaining npm components are labeled as `production`, `peer`, `optional`, or `bundled` from package-lock metadata.
- `lucy-customer-deployment-guide.md`, `lucy-deployment-docker.md`, `lucy-admin-guide.md`, `lucy-agent-integration-guide.md`, `lucy-security-guide.md`, `lucy-troubleshooting-guide.md`, `lucy-product-docs-index.md`, `lucy-version-matrix.md`, `lucy-test-layers-and-release-gates.md`, `lucy-test-cases.md`: customer-facing deployment, continuous configuration, security, integration, troubleshooting, compatibility, release gate, and test documentation copied from `docs/`.

StarRocks R1 P1 note:

- StarRocks is not added to the default verified database matrix until live certification evidence exists.
- StarRocks evidence uses `LUCY_R1_STARROCKS_EVIDENCE` and an explicit StarRocks target gate; missing StarRocks evidence must not fail the default Doris R1 release path.

## 5. Registry Publishing

Tag and `workflow_dispatch` runs push one linux/amd64 image to GHCR with `GITHUB_TOKEN`. The image name is `ghcr.io/<namespace>/project-lucy`, where `<namespace>` is `vars.LUCY_IMAGE_NAMESPACE` or, when that variable is unset, the repository owner in lowercase. Pull requests and pushes to `main` do not push.

Leave `LUCY_IMAGE_NAMESPACE` unset unless the token can write that namespace. The old default `kaelio` is denied for this repository.

| Registry | Status | Notes |
|---|---|---|
| GHCR | tag and manual release | `packages: write`; namespace defaults to the repository owner |
| Private customer registry | not wired | Needs a customer credential and a `LUCY_IMAGE_REGISTRY` override |
| Docker Hub | not selected | Needs a namespace and token policy |
