# Lucy Release CI

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Release CI |
| 文档类型 | Release / CI Spec |
| 版本 | v0.5 |
| 撰写日期 | 2026-06-22；2026-07-06；2026-09-02 v0.3 最终 digest 门禁与 Required checks；2026-10-29 v0.4 日常门禁钉 ubuntu-24.04、PR 取消并发，并修正 registry 与单架构口径；2026-10-29 v0.5 日常／发布／类型检查分层为三个 workflow，并修正 compose source bundle 的交付边界 |
| 适用范围 | GitHub Actions 日常门禁与 release gates、Docker image build、KTX upgrade compatibility |

## 1. CI Workflow

Workflow files:

| File | Lifecycle | Triggers |
|---|---|---|
| `.github/workflows/lucy-ci.yml` | 日常验证（daily verification） | 所有 pull request；push 到 `main` 和 `lucy-v0.25`；`workflow_dispatch` |
| `.github/workflows/lucy-typecheck.yml` | 类型检查（独立结论） | 与日常验证相同 |
| `.github/workflows/lucy-release.yml` | 客户发布 / 诊断 | 仅 `v*` tag；显式手动（需先选 mode） |

`lucy-v0.25` 的 push 触发是**临时入口**：该分支并入 `main`、或不再作为集成分支时必须删除该触发。
pull request 与 push 使用不同的 concurrency group，互相不取消。

Manual inputs (`lucy-release.yml`):

| Input | Default | Purpose |
|---|---|---|
| `mode` | `diagnostics` | `diagnostics`（只读诊断，安全默认）/ `ktx-compat`（仅兼容验证）/ `customer-candidate`（进入有写权限的候选链） |
| `ktx_version` | `0.16.0` | Candidate bundled `@kaelio/ktx` version |
| `release_tag` | empty | Optional image/release tag for manual release package |

`release_tag` 经环境变量传入脚本，不直接插进 shell。

## 2. Required Gates

> ⚡ **Customer Image / Package Delivery Gate**: Any release involving Docker or K8s delivery to customers must strictly follow [`docs/runbooks/customer-delivery-preflight-checklist.md`](../runbooks/customer-delivery-preflight-checklist.md) and pass G0–G8, K1–K6, and **H1–H5**. CI enforces **H1** (`k8s-static`)、**H3/H4**（真实 N-1 `k8s-upgrade-gate` on kind）、以及 release 路径上对**最终 registry digest** 的 G2/G4b/G8。H5 仍需在 lucy-test 或等价集群归档证据后才可发「可直接原地升级」包。

| Job | Workflow | Commands / Coverage |
|---|---|---|
| `spec-and-webui` | daily | `npm run lint:spec`; `npm run security:baseline`; `webui npm test`; `webui npm run build` |
| `workflow-contracts` | daily | actionlint（固定版本 + 校验和）；`npm run test:ci-workflow-contracts`（DAG / 权限 / 聚合反例 / root 测试登记）；`npm run test:root-contracts` |
| `business-eval-catalog` | daily | `npm run smoke:p0:business-eval` |
| `ktx-diff-audit` | daily | 固定上游 commit SHA 后 checkout upstream KTX 并运行 `npm run audit:ktx-diff`；**不是** Required check |
| `docker-smoke` | daily | `npm run smoke:p0:docker` |
| `k8s-static` | daily | **H1** — `npm run gate:k8s-static`（含 MCP URL 负例矩阵） |
| `k8s-upgrade-gate` | daily | **H3 + H4** — `npm run gate:k8s-kind-h3`（N-1 baseline ref ≠ HEAD；Pod `imageID`；UID 0 / 10001 fixtures；sentinel 保留） |
| `headless-config` | daily | `npm run smoke:p0:headless-config` |
| `demo-db-smoke` | daily | `npm run smoke:p0:demo`（原名 `demo-e2e`，仅数据库/演示冒烟） |
| `postgres-demo-db-smoke` | daily | `npm run smoke:p0:postgres-demo`（原名 `postgres-demo-e2e`） |
| `ci-required` | daily | 聚合本 workflow 全部日常 job 的 `needs.*.result`；`if: always()`；**不解析测试总数**；任一依赖不是 `success` 即失败。**尚未**纳入分支保护 |
| `typecheck` | typecheck | `tsc --noEmit --incremental false -p webui/tsconfig.json`；独立 workflow，失败不改变日常 workflow 的结论，也不进入 `ci-required` |
| `customer-amd64-native` | release | tag/manual `mode=customer-candidate`；原生 amd64 **单架构**构建候选镜像（`candidate-amd64-…` tag），G1/G2/G3/G4/G4b/G8 结果按候选 digest 记录 |
| `real-e2e` | release | tag/manual `mode=customer-candidate`；`[self-hosted, lucy-protected]` runner：同一 digest 部署到隔离单副本 K8s，执行 security / 浏览器 / 真实客户端并签名归档；无该 runner 即不可调度（BLOCKED，不退化为 headless） |
| `customer-release-readiness` | release | **Required check**：独立复验证据与签名归档；`npm run gate:customer-release` |
| `ktx-upgrade-compat` | release | manual `mode=ktx-compat` only; runs `npm run compat:ktx-upgrade` |
| `release-package` | release | tag/manual `mode=customer-candidate` only；依赖 `customer-release-readiness`；**只 promote 已测试的候选 digest**（`imagetools create`，不重建、不创建 builder）→ 对 `${IMAGE}@${DIGEST}` 复跑 G1/G2/G4b/G8 → 写 identity metadata；**禁止 gate 后再 build**；客户镜像只有 linux/amd64 单架构 |

日常 job 在 `lucy-ci.yml` 里跑；发布链在 `lucy-release.yml` 里**在同一个 SHA 上重跑**所需的日常与交付门禁，不从最近一次任意成功 run 推定通过，也不通过 `workflow_run` 跨信任边界启动发布。发布 workflow 里与日常 workflow 同名的 job 使用 `release / ` 前缀的显示名，两个 workflow 不会产生同名 check。

Hosted jobs use `ubuntu-24.04` and Node 22. 每个日常 job 都有 `timeout-minutes`。pull request 的新提交取消同一 PR 的旧 run；push 到 `main` / `lucy-v0.25` 取消该 ref 上过时的日常 run；pull request 与 push 互不取消；**发布运行不自动取消**。

`demo-db-smoke` and `postgres-demo-db-smoke` run on every pull request and on `main`. They are not branch-protection required checks until one green run is recorded; do not mark a red workflow as accepted by ignoring them.

### Branch protection Required checks

Currently enforced on `main`:

- `spec-and-webui`
- `docker-smoke`
- `k8s-static`
- `k8s-upgrade-gate`

这四个检查名由 `.github/workflows/lucy-ci.yml` 产出，job 名与检查名保持一致。

`ci-required` 已存在但**尚未**加入 Required checks；迁移需要另一次明确批准，且必须先并存、再移除旧四项，不得清空保护。

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

- `lucy-docker-source-bundle.tar.gz`: Docker Compose **source bundle**. It is a source/reference bundle for review and customization — **not** a customer-deployable artifact. The single-host compose stack is a development/demo and upgrade-verification environment; the verified customer delivery form is the Helm Chart plus the linux/amd64 image (see [`AGENTS.md`](../../AGENTS.md)). A customer deployment package is assembled by the supplier packaging flow, which this workflow does not automate.
- `lucy-release-metadata.json`: Git commit, Docker image id, bundled KTX version, verified database matrix, required gates, and root/WebUI `npm audit --json` summaries with exit codes.
- `lucy-release-notes.md`: concise customer-facing release summary.
- `lucy-sbom.json`: local CycloneDX-lite runtime dependency inventory for the Lucy root package, WebUI package, base image, and bundled KTX runtime. Development-only dependencies marked `dev: true` in package-lock files are omitted; remaining npm components are labeled as `production`, `peer`, `optional`, or `bundled` from package-lock metadata.
- `lucy-customer-deployment-guide.md`, `lucy-deployment-docker.md`, `lucy-admin-guide.md`, `lucy-agent-integration-guide.md`, `lucy-security-guide.md`, `lucy-troubleshooting-guide.md`, `lucy-product-docs-index.md`, `lucy-version-matrix.md`, `lucy-test-layers-and-release-gates.md`, `lucy-test-cases.md`: customer-facing deployment, continuous configuration, security, integration, troubleshooting, compatibility, release gate, and test documentation copied from `docs/`.

StarRocks R1 P1 note:

- StarRocks is not added to the default verified database matrix until live certification evidence exists.
- StarRocks evidence uses `LUCY_R1_STARROCKS_EVIDENCE` and an explicit StarRocks target gate; missing StarRocks evidence must not fail the default Doris R1 release path.

## 5. Registry Publishing

Tag runs and manual `mode=customer-candidate` runs push one linux/amd64 image to GHCR with `GITHUB_TOKEN`. The image name is `ghcr.io/<namespace>/project-lucy`, where `<namespace>` is `vars.LUCY_IMAGE_NAMESPACE` or, when that variable is unset, the repository owner in lowercase. Pull requests, pushes to `main` and pushes to `lucy-v0.25` do not push.

`packages: write` 只授予两个 job：`customer-amd64-native`（推 `candidate-` 标签）和 `release-package`（promote 已测试的 digest）。日常 workflow 与类型检查 workflow 一律 `contents: read`，没有任何 registry 写权限。

Leave `LUCY_IMAGE_NAMESPACE` unset unless the token can write that namespace. The old default `kaelio` is denied for this repository.

| Registry | Status | Notes |
|---|---|---|
| GHCR | tag and manual `mode=customer-candidate` | `packages: write` only on the candidate and promote jobs; namespace defaults to the repository owner |
| Private customer registry | not wired | Needs a customer credential and a `LUCY_IMAGE_REGISTRY` override |
| Docker Hub | not selected | Needs a namespace and token policy |
