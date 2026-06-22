# Lucy Release CI

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Release CI |
| 文档类型 | Release / CI Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-22 |
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
| `ktx_version` | `0.13.0` | Candidate bundled `@kaelio/ktx` version |
| `release_tag` | empty | Optional image/release tag for manual release package |

## 2. Required Gates

| Job | Commands / Coverage |
|---|---|
| `spec-and-webui` | `npm run lint:spec`; `npm run security:baseline`; `webui npm test`; `webui npm run build` |
| `business-eval-catalog` | `npm run smoke:p0:business-eval` |
| `ktx-diff-audit` | clones upstream KTX and runs `npm run audit:ktx-diff` |
| `docker-smoke` | `npm run smoke:p0:docker` |
| `demo-e2e` | `npm run smoke:p0:demo` |
| `postgres-demo-e2e` | `npm run smoke:p0:postgres-demo` |
| `ktx-upgrade-compat` | manual candidate version only; runs `npm run compat:ktx-upgrade` |
| `release-package` | tag/manual only; builds tagged Docker image and uploads release metadata, notes, and SBOM |

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

- `lucy-release-metadata.json`: Git commit, Docker image id, bundled KTX version, verified database matrix, required gates, and root/WebUI `npm audit --json` summaries with exit codes.
- `lucy-release-notes.md`: concise customer-facing release summary.
- `lucy-sbom.json`: local CycloneDX-lite runtime dependency inventory for the Lucy root package, WebUI package, base image, and bundled KTX runtime. Development-only dependencies marked `dev: true` in package-lock files are omitted; remaining npm components are labeled as `production`, `peer`, `optional`, or `bundled` from package-lock metadata.

## 5. Registry Publishing

Current CI builds and tags the image inside the workflow runner. Registry push is intentionally not enabled until the target registry, image namespace, and credentials policy are decided.

Candidate registry policies:

| Registry | Status | Notes |
|---|---|---|
| GHCR | planned | Natural default for GitHub releases |
| Private customer registry | planned | Requires customer-specific credentials and retention policy |
| Docker Hub | not selected | Requires namespace and token policy |
