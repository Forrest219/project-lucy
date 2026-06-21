# KTX vs Lucy 差异审计

- 生成时间：2026-06-21（Asia/Shanghai）
- 原版 KTX：`/Users/forrest/projects/ktx/ktx`，git `e550091a` / branch `main`
- Lucy：`/Users/forrest/Projects/project-lucy`，git `75ecb6e` / branch `main`
- 对比口径：文件路径 + SHA-256 内容哈希。为避免本地状态和敏感信息污染，排除 `.git/`、`node_modules/`、`inbox/`、`temp/`、`.DS_Store`、`.ktx/secrets/`、`.ktx/cache/`、`.ktx/logs/`、`.ktx/runtime/`、`.ktx-ui/*.sqlite*`、`webui/dist/` 等运行/生成物；未读取 secrets 内容。

## 总览

| 指标 | 数量 |
|---|---:|
| KTX 纳入对比文件 | 1,573 |
| Lucy 纳入对比文件 | 239 |
| 同路径同内容 | 0 |
| 同路径但内容不同 | 5 |
| KTX 有、Lucy 无 | 1,568 |
| Lucy 有、KTX 无 | 234 |

## 功能性差异

- **仓库定位改变**：KTX 原仓库是 `ktx-workspace` monorepo，包含 CLI、MCP server、Python semantic layer/daemon、文档站、发布与测试流水线；Lucy 是业务项目仓库，依赖外部 KTX 安装，不包含 KTX 本体实现。
- **运行能力来源改变**：KTX 的核心运行时代码位于 `packages/cli`、`python/ktx-sl`、`python/ktx-daemon`；Lucy 缺失这些目录，运行 KTX 能力需要本机安装的 `ktx` CLI/MCP。
- **数据问答上下文新增**：Lucy 新增 `ktx.yaml`、`ktx.yaml.example`、`semantic-layer/mysql-aliyun/`、`wiki/global/`、`CLAUDE.md`，用于连接 MySQL、语义层 overlay/manifest、业务 wiki 和数据问答 prompt。
- **治理与协作规则替换**：KTX 的 `AGENTS.md` 是上游开发规则，且 `CLAUDE.md`/`GEMINI.md` 指向它；Lucy 的 `AGENTS.md` 只保留项目开发入口，`CLAUDE.md` 变成 KTX 数据问答运行时上下文，另增 `docs/DEVELOPMENT.md` 与 `AGENT_PIPELINE.md`。
- **Web 管理界面新增**：Lucy 新增 `webui/`，包含语义层/维表编辑、wiki、审核、eval 监控、MCP auth proxy、ACL/audit/token 管理等服务端与前端代码；KTX 原仓库无对应目录。
- **评测体系新增**：Lucy 新增 `evals/`、`tests/golden/` 和根级 `scripts/eval-runner.mjs` 等，用 Claude Code/KTX MCP 跑业务评测；KTX 原仓库的测试集中在 CLI/Python runtime 与发布脚本。
- **文档体系替换**：KTX 的 `docs/` 只有术语、代码设计、release 文档，并另有 `docs-site/`；Lucy 的 `docs/` 是项目治理、权限、WebUI、评测、UAT、用户指南等业务/项目文档，且删除了 `docs-site/`。
- **构建/发布链路删除**：Lucy 删除 KTX 的 `pnpm` workspace、semantic-release、Biome/Knip/codecov/pre-commit、artifact build、public benchmark、release smoke 等脚本和配置；Lucy 根 `package.json` 仅保留 eval 与 spec lint。

### package.json 脚本差异

- KTX scripts：`artifacts:build`, `artifacts:build-runtime`, `artifacts:check`, `artifacts:live-db-smoke`, `artifacts:verify`, `artifacts:verify-demo`, `artifacts:verify-manifest`, `build`, `check`, `dead-code`, `dead-code:biome`, `dead-code:fix`, `dead-code:knip`, `dead-code:knip:production`, `deps:upgrade`, `docs`, `ktx`, `link:dev`, `native:rebuild`, `relationships:acquire-public-fixtures`, `relationships:build-adventureworks-oltp`, `relationships:rebuild-public-snapshots`, `relationships:verify-orbit`, `release:codex-backend-smoke`, `release:local-embeddings-smoke`, `release:published-smoke`, `release:readiness`, `release:update-version`, `semantic-release`, `semantic-release:debug`, `semantic-release:dry-run`, `setup:dev`, `smoke`, `test`, `test:coverage`, `test:coverage:py`, `test:coverage:ts`, `test:slow`, `type-check`
- Lucy scripts：`eval`, `eval:list`, `lint:spec`

## KTX 一级文件夹差异表

| KTX 一级文件夹 | Lucy 类型 | 状态 | KTX 文件 | Lucy 同前缀文件 | 相同 | 修改 | KTX-only | Lucy-only |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `.github` | missing | missing in lucy | 7 | 0 | 0 | 0 | 7 | 0 |
| `assets` | missing | missing in lucy | 5 | 0 | 0 | 0 | 5 | 0 |
| `docs` | dir | replaced / name-only overlap | 3 | 36 | 0 | 0 | 3 | 36 |
| `docs-site` | missing | missing in lucy | 93 | 0 | 0 | 0 | 93 | 0 |
| `examples` | missing | missing in lucy | 14 | 0 | 0 | 0 | 14 | 0 |
| `packages` | missing | missing in lucy | 1,179 | 0 | 0 | 0 | 1,179 | 0 |
| `python` | missing | missing in lucy | 183 | 0 | 0 | 0 | 183 | 0 |
| `scripts` | dir | replaced / name-only overlap | 63 | 5 | 0 | 0 | 63 | 5 |
| `skills` | dir | replaced / name-only overlap | 3 | 10 | 0 | 0 | 3 | 10 |

## KTX 二级文件夹差异表

| KTX 二级文件夹 | KTX 类型 | Lucy 类型 | 状态 | KTX 文件 | Lucy 同前缀文件 | 相同 | 修改 | KTX-only | Lucy-only |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| `.github/ISSUE_TEMPLATE` | dir | missing | missing in lucy | 3 | 0 | 0 | 0 | 3 | 0 |
| `.github/workflows` | dir | missing | missing in lucy | 4 | 0 | 0 | 0 | 4 | 0 |
| `docs-site/app` | dir | missing | missing in lucy | 12 | 0 | 0 | 0 | 12 | 0 |
| `docs-site/components` | dir | missing | missing in lucy | 20 | 0 | 0 | 0 | 20 | 0 |
| `docs-site/content` | dir | missing | missing in lucy | 38 | 0 | 0 | 0 | 38 | 0 |
| `docs-site/lib` | dir | missing | missing in lucy | 3 | 0 | 0 | 0 | 3 | 0 |
| `docs-site/public` | dir | missing | missing in lucy | 8 | 0 | 0 | 0 | 8 | 0 |
| `docs-site/tests` | dir | missing | missing in lucy | 4 | 0 | 0 | 0 | 4 | 0 |
| `examples/local-warehouse` | dir | missing | missing in lucy | 5 | 0 | 0 | 0 | 5 | 0 |
| `examples/orbit-relationship-verification` | dir | missing | missing in lucy | 2 | 0 | 0 | 0 | 2 | 0 |
| `examples/package-artifacts` | dir | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `examples/postgres-historic` | dir | missing | missing in lucy | 5 | 0 | 0 | 0 | 5 | 0 |
| `packages/cli` | dir | missing | missing in lucy | 1,179 | 0 | 0 | 0 | 1,179 | 0 |
| `python/ktx-daemon` | dir | missing | missing in lucy | 34 | 0 | 0 | 0 | 34 | 0 |
| `python/ktx-sl` | dir | missing | missing in lucy | 149 | 0 | 0 | 0 | 149 | 0 |
| `skills/ktx` | dir | missing | missing in lucy | 3 | 0 | 0 | 0 | 3 | 0 |

## KTX 一级路径差异表（含根文件）

| KTX 一级路径 | KTX 类型 | Lucy 类型 | 状态 | KTX 文件 | Lucy 同前缀文件 | 相同 | 修改 | KTX-only | Lucy-only |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| `.github` | dir | missing | missing in lucy | 7 | 0 | 0 | 0 | 7 | 0 |
| `.gitignore` | file | file | modified | 1 | 1 | 0 | 1 | 0 | 0 |
| `.pre-commit-config.yaml` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `.releaserc.cjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `AGENTS.md` | file | file | modified | 1 | 1 | 0 | 1 | 0 | 0 |
| `CLAUDE.md` | symlink | file | modified | 1 | 1 | 0 | 1 | 0 | 0 |
| `CONTRIBUTING.md` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `GEMINI.md` | symlink | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `LICENSE` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `README.md` | file | file | modified | 1 | 1 | 0 | 1 | 0 | 0 |
| `SECURITY.md` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `assets` | dir | missing | missing in lucy | 5 | 0 | 0 | 0 | 5 | 0 |
| `biome.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `codecov.yml` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `conductor.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs` | dir | dir | replaced / name-only overlap | 3 | 36 | 0 | 0 | 3 | 36 |
| `docs-site` | dir | missing | missing in lucy | 93 | 0 | 0 | 0 | 93 | 0 |
| `examples` | dir | missing | missing in lucy | 14 | 0 | 0 | 0 | 14 | 0 |
| `knip.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `package.json` | file | file | modified | 1 | 1 | 0 | 1 | 0 | 0 |
| `packages` | dir | missing | missing in lucy | 1,179 | 0 | 0 | 0 | 1,179 | 0 |
| `pnpm-lock.yaml` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `pnpm-workspace.yaml` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `pyproject.toml` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `python` | dir | missing | missing in lucy | 183 | 0 | 0 | 0 | 183 | 0 |
| `release-policy.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts` | dir | dir | replaced / name-only overlap | 63 | 5 | 0 | 0 | 63 | 5 |
| `skills` | dir | dir | replaced / name-only overlap | 3 | 10 | 0 | 0 | 3 | 10 |
| `skills.sh.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `tombi.toml` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `tsconfig.base.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `uv.lock` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |

## KTX 二级路径差异表（含二级文件）

| KTX 二级路径 | KTX 类型 | Lucy 类型 | 状态 | KTX 文件 | Lucy 同前缀文件 | 相同 | 修改 | KTX-only | Lucy-only |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| `.github/ISSUE_TEMPLATE` | dir | missing | missing in lucy | 3 | 0 | 0 | 0 | 3 | 0 |
| `.github/workflows` | dir | missing | missing in lucy | 4 | 0 | 0 | 0 | 4 | 0 |
| `assets/ktx-lockup.svg` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `assets/ktx-mascot-dark.svg` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `assets/ktx-mascot.svg` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `assets/launch-video-thumb.png` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `assets/star-history.svg` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs/code-design.md` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs/release.md` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs/terminology.md` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/.gitignore` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/app` | dir | missing | missing in lucy | 12 | 0 | 0 | 0 | 12 | 0 |
| `docs-site/components` | dir | missing | missing in lucy | 20 | 0 | 0 | 0 | 20 | 0 |
| `docs-site/content` | dir | missing | missing in lucy | 38 | 0 | 0 | 0 | 38 | 0 |
| `docs-site/lib` | dir | missing | missing in lucy | 3 | 0 | 0 | 0 | 3 | 0 |
| `docs-site/next-env.d.ts` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/next.config.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/package.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/postcss.config.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/proxy.ts` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/public` | dir | missing | missing in lucy | 8 | 0 | 0 | 0 | 8 | 0 |
| `docs-site/source.config.ts` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `docs-site/tests` | dir | missing | missing in lucy | 4 | 0 | 0 | 0 | 4 | 0 |
| `docs-site/tsconfig.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `examples/README.md` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `examples/local-warehouse` | dir | missing | missing in lucy | 5 | 0 | 0 | 0 | 5 | 0 |
| `examples/orbit-relationship-verification` | dir | missing | missing in lucy | 2 | 0 | 0 | 0 | 2 | 0 |
| `examples/package-artifacts` | dir | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `examples/postgres-historic` | dir | missing | missing in lucy | 5 | 0 | 0 | 0 | 5 | 0 |
| `packages/cli` | dir | missing | missing in lucy | 1,179 | 0 | 0 | 0 | 1,179 | 0 |
| `python/ktx-daemon` | dir | missing | missing in lucy | 34 | 0 | 0 | 0 | 34 | 0 |
| `python/ktx-sl` | dir | missing | missing in lucy | 149 | 0 | 0 | 0 | 149 | 0 |
| `scripts/acquire-public-benchmark-fixtures.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/acquire-public-benchmark-fixtures.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/adventureworks-oltp-source.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/adventureworks-oltp-source.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/anti-fixture-conditional.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/build-adventureworks-oltp-fixture.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/build-benchmark-snapshot.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/build-benchmark-snapshot.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/build-evidence-fusion-adversarial-fixtures.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/build-python-runtime-wheel.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/build-python-runtime-wheel.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/check-boundaries.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/check-boundaries.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/ci-artifact-upload.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/codex-backend-live-smoke.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/codex-backend-live-smoke.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/conductor-run.sh` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/conductor-scripts.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/conductor-setup.sh` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/examples-docs.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/installed-live-database-smoke.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/installed-live-database-smoke.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/ktx-reset.sh` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/link-dev-cli.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/link-dev-cli.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/local-embeddings-runtime-smoke.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/local-embeddings-runtime-smoke.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/normalize-lcov-paths.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/normalize-lcov-paths.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/package-artifacts.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/package-artifacts.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/pglite-hybrid-search-spike.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/pglite-owner-process-prototype.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/pglite-sl-search-prototype.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/prepare-cli-bin.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/public-benchmark-manifest.json` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/public-npm-release-metadata.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/public-npm-release-metadata.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/published-package-smoke-config.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/published-package-smoke.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/published-package-smoke.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/refresh-uv-manifest.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/refresh-uv-manifest.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/relationship-benchmark-report.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/relationship-orbit-verification.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/relationship-orbit-verification.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/release-readiness.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/release-readiness.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/release-workflow.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/run-ktx.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/run-ktx.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/semantic-release-config.cjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/semantic-release-config.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/setup-dev.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/setup-dev.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/standalone-ci-workflow.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/test-tiering.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/update-public-release-version.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/update-public-release-version.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/upgrade-dependencies.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/upgrade-dependencies.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/validate-llm-debug-jsonl.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `scripts/validate-llm-debug-jsonl.test.mjs` | file | missing | missing in lucy | 1 | 0 | 0 | 0 | 1 | 0 |
| `skills/ktx` | dir | missing | missing in lucy | 3 | 0 | 0 | 0 | 3 | 0 |

## Lucy 新增一级路径（KTX 不存在）

| Lucy 一级路径 | 类型 | Lucy 文件数 | 说明 |
|---|---|---:|---|
| `.claude` | dir | 1 | 本地 Claude 配置 |
| `.codex` | dir | 1 | 本地 Codex 配置 |
| `.ktx` | dir | 8 | KTX 项目本地状态/配置/索引，secrets 内容未纳入 |
| `.ktx-ui` | dir | 3 | Lucy WebUI 本地运行状态/脚本，sqlite/log 未纳入内容哈希 |
| `.mcp.json` | file | 1 | MCP 连接配置 |
| `AGENT_PIPELINE.md` | file | 1 | agent 协作/流程文档 |
| `evals` | dir | 4 | 业务 eval case |
| `ktx.yaml` | file | 1 | Lucy KTX 项目配置 |
| `ktx.yaml.example` | file | 1 | Lucy KTX 配置模板 |
| `lucy-skills` | dir | 1 | Lucy skill/MCP 相关文档 |
| `package-lock.json` | file | 1 | npm lockfile |
| `raw-sources` | dir | 31 | 原始数据源素材 |
| `semantic-layer` | dir | 4 | Lucy 业务语义层 |
| `tests` | dir | 1 | Lucy golden tests |
| `webui` | dir | 119 | Lucy Web 管理界面 |
| `wiki` | dir | 5 | Lucy 业务知识库 |

## KTX 一级路径变动样例

| KTX 一级路径 | 修改样例 | KTX-only 样例 | Lucy-only 同前缀样例 |
|---|---|---|---|
| `.github` | 无 | `.github/ISSUE_TEMPLATE/bug_report.yml`<br>`.github/ISSUE_TEMPLATE/config.yml`<br>`.github/ISSUE_TEMPLATE/feature_request.yml`<br>`.github/workflows/ci.yml`<br>`.github/workflows/release.yml`<br>`.github/workflows/star-history.yml`<br>`.github/workflows/triage-issues.yml` | 无 |
| `.gitignore` | `.gitignore` | 无 | 无 |
| `.pre-commit-config.yaml` | 无 | `.pre-commit-config.yaml` | 无 |
| `.releaserc.cjs` | 无 | `.releaserc.cjs` | 无 |
| `AGENTS.md` | `AGENTS.md` | 无 | 无 |
| `CLAUDE.md` | `CLAUDE.md` | 无 | 无 |
| `CONTRIBUTING.md` | 无 | `CONTRIBUTING.md` | 无 |
| `GEMINI.md` | 无 | `GEMINI.md` | 无 |
| `LICENSE` | 无 | `LICENSE` | 无 |
| `README.md` | `README.md` | 无 | 无 |
| `SECURITY.md` | 无 | `SECURITY.md` | 无 |
| `assets` | 无 | `assets/ktx-lockup.svg`<br>`assets/ktx-mascot-dark.svg`<br>`assets/ktx-mascot.svg`<br>`assets/launch-video-thumb.png`<br>`assets/star-history.svg` | 无 |
| `biome.json` | 无 | `biome.json` | 无 |
| `codecov.yml` | 无 | `codecov.yml` | 无 |
| `conductor.json` | 无 | `conductor.json` | 无 |
| `docs` | 无 | `docs/code-design.md`<br>`docs/release.md`<br>`docs/terminology.md` | `docs/DEVELOPMENT.md`<br>`docs/design-agent-permissions.md`<br>`docs/design-db-connection.md`<br>`docs/design-eval-monitoring.md`<br>`docs/design-webui-ui-refresh.md`<br>`docs/eval-quiz-conventions.md`<br>`docs/kx-security-guardrail-test-process.md`<br>`docs/mysql-comment-maintenance.md`<br>... +28 more |
| `docs-site` | 无 | `docs-site/.gitignore`<br>`docs-site/app/(home)/layout.tsx`<br>`docs-site/app/(home)/page.tsx`<br>`docs-site/app/api/search/route.ts`<br>`docs-site/app/diagram-studio/page.tsx`<br>`docs-site/app/docs/[[...slug]]/page.tsx`<br>`docs-site/app/docs/layout.tsx`<br>`docs-site/app/global.css`<br>... +85 more | 无 |
| `examples` | 无 | `examples/README.md`<br>`examples/local-warehouse/README.md`<br>`examples/local-warehouse/ktx.yaml`<br>`examples/local-warehouse/semantic-layer/warehouse/orders.yaml`<br>`examples/local-warehouse/source/orders/orders.json`<br>`examples/local-warehouse/wiki/global/revenue.md`<br>`examples/orbit-relationship-verification/README.md`<br>`examples/orbit-relationship-verification/ktx.yaml`<br>... +6 more | 无 |
| `knip.json` | 无 | `knip.json` | 无 |
| `package.json` | `package.json` | 无 | 无 |
| `packages` | 无 | `packages/cli/assets/demo/orbit/demo.db`<br>`packages/cli/assets/demo/orbit/links/provenance.json`<br>`packages/cli/assets/demo/orbit/manifest.json`<br>`packages/cli/assets/demo/orbit/raw-sources/bi/account_retention.view.lkml`<br>`packages/cli/assets/demo/orbit/raw-sources/bi/arr_daily.view.lkml`<br>`packages/cli/assets/demo/orbit/raw-sources/bi/customer_health.view.lkml`<br>`packages/cli/assets/demo/orbit/raw-sources/bi/procurement_activity.view.lkml`<br>`packages/cli/assets/demo/orbit/raw-sources/bi/retention_exec_q1.dashboard.lookml`<br>... +1171 more | 无 |
| `pnpm-lock.yaml` | 无 | `pnpm-lock.yaml` | 无 |
| `pnpm-workspace.yaml` | 无 | `pnpm-workspace.yaml` | 无 |
| `pyproject.toml` | 无 | `pyproject.toml` | 无 |
| `python` | 无 | `python/ktx-daemon/README.md`<br>`python/ktx-daemon/pyproject.toml`<br>`python/ktx-daemon/src/ktx_daemon/__init__.py`<br>`python/ktx-daemon/src/ktx_daemon/__main__.py`<br>`python/ktx-daemon/src/ktx_daemon/app.py`<br>`python/ktx-daemon/src/ktx_daemon/code_execution.py`<br>`python/ktx-daemon/src/ktx_daemon/database_introspection.py`<br>`python/ktx-daemon/src/ktx_daemon/embeddings.py`<br>... +175 more | 无 |
| `release-policy.json` | 无 | `release-policy.json` | 无 |
| `scripts` | 无 | `scripts/acquire-public-benchmark-fixtures.mjs`<br>`scripts/acquire-public-benchmark-fixtures.test.mjs`<br>`scripts/adventureworks-oltp-source.json`<br>`scripts/adventureworks-oltp-source.test.mjs`<br>`scripts/anti-fixture-conditional.test.mjs`<br>`scripts/build-adventureworks-oltp-fixture.mjs`<br>`scripts/build-benchmark-snapshot.mjs`<br>`scripts/build-benchmark-snapshot.test.mjs`<br>... +55 more | `scripts/eval-runner.mjs`<br>`scripts/eval-runner.test.mjs`<br>`scripts/lint-spec.mjs`<br>`scripts/render-quiz.mjs`<br>`scripts/run-eval.sh` |
| `skills` | 无 | `skills/ktx/SKILL.md`<br>`skills/ktx/agents/openai.yaml`<br>`skills/ktx/troubleshooting.md` | `skills/.gitkeep`<br>`skills/analysis/discount-analysis.md`<br>`skills/analysis/profit-decomposition.md`<br>`skills/domains/superstore/discount-policy.md`<br>`skills/domains/superstore/domain.md`<br>`skills/domains/superstore/pitfalls.md`<br>`skills/reviewer/SKILL.md`<br>`skills/warehouse/SKILL.md`<br>... +2 more |
| `skills.sh.json` | 无 | `skills.sh.json` | 无 |
| `tombi.toml` | 无 | `tombi.toml` | 无 |
| `tsconfig.base.json` | 无 | `tsconfig.base.json` | 无 |
| `uv.lock` | 无 | `uv.lock` | 无 |

## 完整清单：同路径内容不同

- `.gitignore`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `package.json`

## 完整清单：KTX 有、Lucy 无

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/star-history.yml`
- `.github/workflows/triage-issues.yml`
- `.pre-commit-config.yaml`
- `.releaserc.cjs`
- `CONTRIBUTING.md`
- `GEMINI.md`
- `LICENSE`
- `SECURITY.md`
- `assets/ktx-lockup.svg`
- `assets/ktx-mascot-dark.svg`
- `assets/ktx-mascot.svg`
- `assets/launch-video-thumb.png`
- `assets/star-history.svg`
- `biome.json`
- `codecov.yml`
- `conductor.json`
- `docs-site/.gitignore`
- `docs-site/app/(home)/layout.tsx`
- `docs-site/app/(home)/page.tsx`
- `docs-site/app/api/search/route.ts`
- `docs-site/app/diagram-studio/page.tsx`
- `docs-site/app/docs/[[...slug]]/page.tsx`
- `docs-site/app/docs/layout.tsx`
- `docs-site/app/global.css`
- `docs-site/app/layout.config.tsx`
- `docs-site/app/layout.tsx`
- `docs-site/app/llms-full.txt/route.ts`
- `docs-site/app/llms.mdx/docs/[[...slug]]/route.ts`
- `docs-site/app/llms.txt/route.ts`
- `docs-site/components/code-block.tsx`
- `docs-site/components/context-review-loop.tsx`
- `docs-site/components/copy-button.tsx`
- `docs-site/components/diagram-studio/flows.ts`
- `docs-site/components/diagram-studio/mascot.tsx`
- `docs-site/components/diagram-studio/nodes.tsx`
- `docs-site/components/diagram-studio/studio.tsx`
- `docs-site/components/docs-page-actions.tsx`
- `docs-site/components/flow-canvas.tsx`
- `docs-site/components/git-icon.tsx`
- `docs-site/components/github-icon.tsx`
- `docs-site/components/github-stars.tsx`
- `docs-site/components/logo.tsx`
- `docs-site/components/product-mechanics.tsx`
- `docs-site/components/product-runtime.tsx`
- `docs-site/components/scroll-reveal.tsx`
- `docs-site/components/semantic-layer-flow.tsx`
- `docs-site/components/slack-icon.tsx`
- `docs-site/components/terminal-preview.tsx`
- `docs-site/components/theme-toggle.tsx`
- `docs-site/content/docs/cli-reference/ktx-admin.mdx`
- `docs-site/content/docs/cli-reference/ktx-completion.mdx`
- `docs-site/content/docs/cli-reference/ktx-connection.mdx`
- `docs-site/content/docs/cli-reference/ktx-ingest.mdx`
- `docs-site/content/docs/cli-reference/ktx-mcp.mdx`
- `docs-site/content/docs/cli-reference/ktx-setup.mdx`
- `docs-site/content/docs/cli-reference/ktx-sl.mdx`
- `docs-site/content/docs/cli-reference/ktx-sql.mdx`
- `docs-site/content/docs/cli-reference/ktx-status.mdx`
- `docs-site/content/docs/cli-reference/ktx-wiki.mdx`
- `docs-site/content/docs/cli-reference/ktx.mdx`
- `docs-site/content/docs/cli-reference/meta.json`
- `docs-site/content/docs/community/ai-resources.mdx`
- `docs-site/content/docs/community/contributing.mdx`
- `docs-site/content/docs/community/meta.json`
- `docs-site/content/docs/community/support.mdx`
- `docs-site/content/docs/community/telemetry.mdx`
- `docs-site/content/docs/concepts/cross-database-federation.mdx`
- `docs-site/content/docs/concepts/meta.json`
- `docs-site/content/docs/concepts/semantic-layer-internals.mdx`
- `docs-site/content/docs/concepts/the-context-layer.mdx`
- `docs-site/content/docs/concepts/wiki-retrieval.mdx`
- `docs-site/content/docs/configuration/ktx-yaml.mdx`
- `docs-site/content/docs/configuration/meta.json`
- `docs-site/content/docs/getting-started/introduction.mdx`
- `docs-site/content/docs/getting-started/meta.json`
- `docs-site/content/docs/getting-started/quickstart.mdx`
- `docs-site/content/docs/guides/building-context.mdx`
- `docs-site/content/docs/guides/llm-configuration.mdx`
- `docs-site/content/docs/guides/meta.json`
- `docs-site/content/docs/guides/reviewing-context.mdx`
- `docs-site/content/docs/guides/serving-agents.mdx`
- `docs-site/content/docs/guides/writing-context.mdx`
- `docs-site/content/docs/integrations/agent-clients.mdx`
- `docs-site/content/docs/integrations/context-sources.mdx`
- `docs-site/content/docs/integrations/meta.json`
- `docs-site/content/docs/integrations/primary-sources.mdx`
- `docs-site/content/docs/meta.json`
- `docs-site/lib/docs-markdown.ts`
- `docs-site/lib/llm-docs.ts`
- `docs-site/lib/source.ts`
- `docs-site/next-env.d.ts`
- `docs-site/next.config.mjs`
- `docs-site/package.json`
- `docs-site/postcss.config.mjs`
- `docs-site/proxy.ts`
- `docs-site/public/brand/ktx-mascot-dark.svg`
- `docs-site/public/brand/ktx-mascot.svg`
- `docs-site/public/icons/dbt.svg`
- `docs-site/public/icons/metabase.svg`
- `docs-site/public/icons/notion.svg`
- `docs-site/public/icons/postgresql.svg`
- `docs-site/public/images/ingestion-flow.png`
- `docs-site/public/images/mcp-runtime-flow.png`
- `docs-site/source.config.ts`
- `docs-site/tests/docs-index-route.test.mjs`
- `docs-site/tests/docs-search-behavior.test.mjs`
- `docs-site/tests/product-mechanics-content.test.mjs`
- `docs-site/tests/product-runtime-content.test.mjs`
- `docs-site/tsconfig.json`
- `docs/code-design.md`
- `docs/release.md`
- `docs/terminology.md`
- `examples/README.md`
- `examples/local-warehouse/README.md`
- `examples/local-warehouse/ktx.yaml`
- `examples/local-warehouse/semantic-layer/warehouse/orders.yaml`
- `examples/local-warehouse/source/orders/orders.json`
- `examples/local-warehouse/wiki/global/revenue.md`
- `examples/orbit-relationship-verification/README.md`
- `examples/orbit-relationship-verification/ktx.yaml`
- `examples/package-artifacts/README.md`
- `examples/postgres-historic/README.md`
- `examples/postgres-historic/docker-compose.yml`
- `examples/postgres-historic/init/001-schema.sql`
- `examples/postgres-historic/scripts/generate-workload.sh`
- `examples/postgres-historic/scripts/smoke.sh`
- `knip.json`
- `packages/cli/assets/demo/orbit/demo.db`
- `packages/cli/assets/demo/orbit/links/provenance.json`
- `packages/cli/assets/demo/orbit/manifest.json`
- `packages/cli/assets/demo/orbit/raw-sources/bi/account_retention.view.lkml`
- `packages/cli/assets/demo/orbit/raw-sources/bi/arr_daily.view.lkml`
- `packages/cli/assets/demo/orbit/raw-sources/bi/customer_health.view.lkml`
- `packages/cli/assets/demo/orbit/raw-sources/bi/procurement_activity.view.lkml`
- `packages/cli/assets/demo/orbit/raw-sources/bi/retention_exec_q1.dashboard.lookml`
- `packages/cli/assets/demo/orbit/raw-sources/bi/revenue_daily.view.lkml`
- `packages/cli/assets/demo/orbit/raw-sources/bi/revenue_exec.dashboard.lookml`
- `packages/cli/assets/demo/orbit/raw-sources/dbt/dbt_project.yml`
- `packages/cli/assets/demo/orbit/raw-sources/dbt/models/marts/mart_arr_daily.sql`
- `packages/cli/assets/demo/orbit/raw-sources/dbt/models/marts/mart_customer_health.sql`
- `packages/cli/assets/demo/orbit/raw-sources/dbt/models/marts/mart_revenue_daily.sql`
- `packages/cli/assets/demo/orbit/raw-sources/dbt/schema.yml`
- `packages/cli/assets/demo/orbit/raw-sources/dbt/sources.yml`
- `packages/cli/assets/demo/orbit/raw-sources/notion/activation-policy-decision-record.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/analyst-onboarding.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/arr-and-contract-reporting-notes.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/customer-health-playbook.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/retention-and-nrr-definition-notes.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/revenue-reporting-policy.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/sales-ops-segmentation-guide.md`
- `packages/cli/assets/demo/orbit/raw-sources/notion/support-escalation-runbook.md`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/accounts.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/arr_movements.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/contracts.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/invoices.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/plans.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/purchase_requests.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/support_tickets.csv`
- `packages/cli/assets/demo/orbit/raw-sources/warehouse/users.csv`
- `packages/cli/assets/demo/orbit/replay.memory-flow.v1.json`
- `packages/cli/assets/demo/orbit/reports/seeded-demo-report.json`
- `packages/cli/assets/demo/orbit/semantic-layer/.gitkeep`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/int_activation_policy_windows.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/int_active_contract_arr.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/int_customer_health_signals.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/int_parent_account_arr_movements.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/int_procurement_qualifying_actions.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/int_revenue_components.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_account_activity.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_account_segments.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_arr_daily.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_customer_health.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_nrr_quarterly.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_procurement_activity.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_retention_movement_breakout.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/mart_revenue_daily.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_account_hierarchy.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_account_owners.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_accounts.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_activation_events.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_approval_events.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_arr_movements.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_contract_discount_terms.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_contracts.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_invoice_line_items.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_invoices.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_plan_segment_mapping.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_plans.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_purchase_orders.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_purchase_requests.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_refunds.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_sessions.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_subscriptions.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_supplier_onboarding_events.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_suppliers.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_support_tickets.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/dbt-main/stg_users.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/_schema/orbit_analytics.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/_schema/orbit_raw.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/large_contract_requesters.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_account_activity.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_account_segments.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_arr_daily.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_customer_health.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_nrr_quarterly.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_procurement_activity.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_retention_movement_breakout.yaml`
- `packages/cli/assets/demo/orbit/semantic-layer/postgres-warehouse/mart_revenue_daily.yaml`
- `packages/cli/assets/demo/orbit/wiki/global/.gitkeep`
- `packages/cli/assets/demo/orbit/wiki/global/customer-communication-policy.md`
- `packages/cli/assets/demo/orbit/wiki/global/new-hire-onboarding-policy.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-activation-kpi-glossary.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-activation-policy-change-jan-2026.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-arr-contract-first-definition.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-company-overview.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-customer-health-risk-definition.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-customer-stakeholder-needs.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-customers-source.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-dbt-exposures.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-dbt-project-overview.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-how-we-work.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-known-product-gaps.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-account-activity.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-account-segments.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-arr-daily.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-nrr-quarterly.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-procurement-activity.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-retention-movement-breakout.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-mart-revenue-daily.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-metabase-sql-library-patterns.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-nrr-discount-expiration-treatment.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-plan-segment-normalization.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-procurement-qualifying-actions.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-product-design-principles.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-product-review-checklist.md`
- `packages/cli/assets/demo/orbit/wiki/global/orbit-revenue-gross-to-net-reconciliation.md`
- `packages/cli/assets/demo/orbit/wiki/global/sales-ops-cs-handoff-process.md`
- `packages/cli/package.json`
- `packages/cli/scripts/build-demo-assets.mjs`
- `packages/cli/scripts/copy-runtime-assets.mjs`
- `packages/cli/src/admin-reindex.ts`
- `packages/cli/src/admin.ts`
- `packages/cli/src/bin.ts`
- `packages/cli/src/clack.ts`
- `packages/cli/src/claude-code-prompt-caching.ts`
- `packages/cli/src/cli-program.ts`
- `packages/cli/src/cli-runtime.ts`
- `packages/cli/src/command-schemas.ts`
- `packages/cli/src/command-tree.ts`
- `packages/cli/src/commands/completion-commands.ts`
- `packages/cli/src/commands/connection-commands.ts`
- `packages/cli/src/commands/connection-selection.ts`
- `packages/cli/src/commands/ingest-commands.ts`
- `packages/cli/src/commands/knowledge-commands.ts`
- `packages/cli/src/commands/mcp-commands.ts`
- `packages/cli/src/commands/runtime-commands.ts`
- `packages/cli/src/commands/setup-commands.ts`
- `packages/cli/src/commands/sl-commands.ts`
- `packages/cli/src/commands/sql-commands.ts`
- `packages/cli/src/commands/status-commands.ts`
- `packages/cli/src/community-cta.ts`
- `packages/cli/src/completion/complete-engine.ts`
- `packages/cli/src/completion/completion-scripts.ts`
- `packages/cli/src/completion/dynamic-candidates.ts`
- `packages/cli/src/connection-drivers.ts`
- `packages/cli/src/connection-recovery.ts`
- `packages/cli/src/connection.ts`
- `packages/cli/src/connectors/bigquery/connector.ts`
- `packages/cli/src/connectors/bigquery/dialect.ts`
- `packages/cli/src/connectors/bigquery/live-database-introspection.ts`
- `packages/cli/src/connectors/clickhouse/connector.ts`
- `packages/cli/src/connectors/clickhouse/dialect.ts`
- `packages/cli/src/connectors/clickhouse/live-database-introspection.ts`
- `packages/cli/src/connectors/duckdb/federated-attach.ts`
- `packages/cli/src/connectors/duckdb/federated-executor.ts`
- `packages/cli/src/connectors/mysql/connector.ts`
- `packages/cli/src/connectors/mysql/dialect.ts`
- `packages/cli/src/connectors/mysql/live-database-introspection.ts`
- `packages/cli/src/connectors/postgres/connector.ts`
- `packages/cli/src/connectors/postgres/dialect.ts`
- `packages/cli/src/connectors/postgres/historic-sql-query-client.ts`
- `packages/cli/src/connectors/postgres/live-database-introspection.ts`
- `packages/cli/src/connectors/shared/string-reference.ts`
- `packages/cli/src/connectors/snowflake/connector.ts`
- `packages/cli/src/connectors/snowflake/dialect.ts`
- `packages/cli/src/connectors/snowflake/historic-sql-query-client.ts`
- `packages/cli/src/connectors/snowflake/identifiers.ts`
- `packages/cli/src/connectors/snowflake/live-database-introspection.ts`
- `packages/cli/src/connectors/snowflake/sdk-logger.ts`
- `packages/cli/src/connectors/sqlite/connector.ts`
- `packages/cli/src/connectors/sqlite/dialect.ts`
- `packages/cli/src/connectors/sqlite/live-database-introspection.ts`
- `packages/cli/src/connectors/sqlserver/connector.ts`
- `packages/cli/src/connectors/sqlserver/dialect.ts`
- `packages/cli/src/connectors/sqlserver/live-database-introspection.ts`
- `packages/cli/src/context-build-view.ts`
- `packages/cli/src/context/connections/bigquery-identifiers.ts`
- `packages/cli/src/context/connections/connection-type.ts`
- `packages/cli/src/context/connections/dialect-helpers.ts`
- `packages/cli/src/context/connections/dialects.ts`
- `packages/cli/src/context/connections/drivers.ts`
- `packages/cli/src/context/connections/federation.ts`
- `packages/cli/src/context/connections/local-warehouse-descriptor.ts`
- `packages/cli/src/context/connections/notion-config.ts`
- `packages/cli/src/context/connections/project-sql-executor.ts`
- `packages/cli/src/context/connections/query-executor.ts`
- `packages/cli/src/context/connections/read-only-sql.ts`
- `packages/cli/src/context/connections/resolve-connection.ts`
- `packages/cli/src/context/core/abort.ts`
- `packages/cli/src/context/core/config-reference.ts`
- `packages/cli/src/context/core/config.ts`
- `packages/cli/src/context/core/embedding.ts`
- `packages/cli/src/context/core/file-store.ts`
- `packages/cli/src/context/core/git-env.ts`
- `packages/cli/src/context/core/git.service.ts`
- `packages/cli/src/context/core/redaction.ts`
- `packages/cli/src/context/core/session-worktree.service.ts`
- `packages/cli/src/context/daemon/semantic-layer-compute.ts`
- `packages/cli/src/context/index-sync/reindex.ts`
- `packages/cli/src/context/index-sync/types.ts`
- `packages/cli/src/context/ingest/action-identity.ts`
- `packages/cli/src/context/ingest/adapters/dbt-descriptions/parse-schema.ts`
- `packages/cli/src/context/ingest/adapters/dbt/chunk.ts`
- `packages/cli/src/context/ingest/adapters/dbt/dbt.adapter.ts`
- `packages/cli/src/context/ingest/adapters/dbt/detect.ts`
- `packages/cli/src/context/ingest/adapters/dbt/fetch.ts`
- `packages/cli/src/context/ingest/adapters/dbt/parse.ts`
- `packages/cli/src/context/ingest/adapters/fake/fake.adapter.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/bigquery-query-history-reader.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/buckets.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/chunk-unified.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/connection-dialect.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/detect.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/errors.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/evidence-tool.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/evidence.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/historic-sql.adapter.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/pattern-inputs.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/postgres-pgss-reader.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/projection.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/query-history-filter-picker.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/redaction.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/scope-floor.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/scope-membership.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/skill-schemas.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/snowflake-query-history-reader.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/stage-unified.ts`
- `packages/cli/src/context/ingest/adapters/historic-sql/types.ts`
- `packages/cli/src/context/ingest/adapters/live-database/chunk.ts`
- `packages/cli/src/context/ingest/adapters/live-database/daemon-introspection.ts`
- `packages/cli/src/context/ingest/adapters/live-database/live-database.adapter.ts`
- `packages/cli/src/context/ingest/adapters/live-database/manifest.ts`
- `packages/cli/src/context/ingest/adapters/live-database/stage.ts`
- `packages/cli/src/context/ingest/adapters/live-database/types.ts`
- `packages/cli/src/context/ingest/adapters/looker/chunk.ts`
- `packages/cli/src/context/ingest/adapters/looker/client.ts`
- `packages/cli/src/context/ingest/adapters/looker/daemon-table-identifier-parser.ts`
- `packages/cli/src/context/ingest/adapters/looker/detect.ts`
- `packages/cli/src/context/ingest/adapters/looker/evidence-documents.ts`
- `packages/cli/src/context/ingest/adapters/looker/factory.ts`
- `packages/cli/src/context/ingest/adapters/looker/fetch-report.ts`
- `packages/cli/src/context/ingest/adapters/looker/fetch.ts`
- `packages/cli/src/context/ingest/adapters/looker/local-looker.adapter.ts`
- `packages/cli/src/context/ingest/adapters/looker/local-runtime-store.ts`
- `packages/cli/src/context/ingest/adapters/looker/looker.adapter.ts`
- `packages/cli/src/context/ingest/adapters/looker/mapping.ts`
- `packages/cli/src/context/ingest/adapters/looker/reconcile.ts`
- `packages/cli/src/context/ingest/adapters/looker/scope.ts`
- `packages/cli/src/context/ingest/adapters/looker/target-connections.ts`
- `packages/cli/src/context/ingest/adapters/looker/tools/looker-query-to-sl.tool.ts`
- `packages/cli/src/context/ingest/adapters/looker/types.ts`
- `packages/cli/src/context/ingest/adapters/lookml/chunk.ts`
- `packages/cli/src/context/ingest/adapters/lookml/detect.ts`
- `packages/cli/src/context/ingest/adapters/lookml/fetch-report.ts`
- `packages/cli/src/context/ingest/adapters/lookml/fetch.ts`
- `packages/cli/src/context/ingest/adapters/lookml/graph.ts`
- `packages/cli/src/context/ingest/adapters/lookml/lookml-parser.d.ts`
- `packages/cli/src/context/ingest/adapters/lookml/lookml.adapter.ts`
- `packages/cli/src/context/ingest/adapters/lookml/parse.ts`
- `packages/cli/src/context/ingest/adapters/lookml/pull-config.ts`
- `packages/cli/src/context/ingest/adapters/metabase/card-references.ts`
- `packages/cli/src/context/ingest/adapters/metabase/chunk.ts`
- `packages/cli/src/context/ingest/adapters/metabase/client-port.ts`
- `packages/cli/src/context/ingest/adapters/metabase/client.ts`
- `packages/cli/src/context/ingest/adapters/metabase/detect.ts`
- `packages/cli/src/context/ingest/adapters/metabase/fanout-planner.ts`
- `packages/cli/src/context/ingest/adapters/metabase/fetch-scope.ts`
- `packages/cli/src/context/ingest/adapters/metabase/fetch.ts`
- `packages/cli/src/context/ingest/adapters/metabase/local-metabase.adapter.ts`
- `packages/cli/src/context/ingest/adapters/metabase/local-source-state-store.ts`
- `packages/cli/src/context/ingest/adapters/metabase/mapping.ts`
- `packages/cli/src/context/ingest/adapters/metabase/metabase.adapter.ts`
- `packages/cli/src/context/ingest/adapters/metabase/serialize-card.ts`
- `packages/cli/src/context/ingest/adapters/metabase/source-state-port.ts`
- `packages/cli/src/context/ingest/adapters/metabase/types.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/chunk.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/deep-parse.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/detect.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/fetch.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/graph.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/import-semantic-models.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/metricflow.adapter.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/parse.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/projection-config.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/pull-config.ts`
- `packages/cli/src/context/ingest/adapters/metricflow/semantic-models.ts`
- `packages/cli/src/context/ingest/adapters/notion/chunk.ts`
- `packages/cli/src/context/ingest/adapters/notion/cluster.ts`
- `packages/cli/src/context/ingest/adapters/notion/detect.ts`
- `packages/cli/src/context/ingest/adapters/notion/fetch.ts`
- `packages/cli/src/context/ingest/adapters/notion/local-state-store.ts`
- `packages/cli/src/context/ingest/adapters/notion/normalize.ts`
- `packages/cli/src/context/ingest/adapters/notion/notion-client.ts`
- `packages/cli/src/context/ingest/adapters/notion/notion.adapter.ts`
- `packages/cli/src/context/ingest/adapters/notion/pull-config.ts`
- `packages/cli/src/context/ingest/adapters/notion/types.ts`
- `packages/cli/src/context/ingest/artifact-gates.ts`
- `packages/cli/src/context/ingest/canonical-pins.ts`
- `packages/cli/src/context/ingest/clustering/kmeans.ts`
- `packages/cli/src/context/ingest/constrained-repair.ts`
- `packages/cli/src/context/ingest/context-candidates/candidate-dedup.service.ts`
- `packages/cli/src/context/ingest/context-candidates/context-candidate-carryforward.service.ts`
- `packages/cli/src/context/ingest/context-candidates/curator-pagination.service.ts`
- `packages/cli/src/context/ingest/context-candidates/embedding-text.ts`
- `packages/cli/src/context/ingest/context-candidates/store.ts`
- `packages/cli/src/context/ingest/context-candidates/types.ts`
- `packages/cli/src/context/ingest/context-evidence/context-evidence-index.service.ts`
- `packages/cli/src/context/ingest/context-evidence/sqlite-context-evidence-store.ts`
- `packages/cli/src/context/ingest/context-evidence/store.ts`
- `packages/cli/src/context/ingest/context-evidence/types.ts`
- `packages/cli/src/context/ingest/dbt-shared/project-vars.ts`
- `packages/cli/src/context/ingest/dbt-shared/schema-files.ts`
- `packages/cli/src/context/ingest/diff-set.service.ts`
- `packages/cli/src/context/ingest/final-gate-repair.ts`
- `packages/cli/src/context/ingest/finalization-scope.ts`
- `packages/cli/src/context/ingest/git-env.ts`
- `packages/cli/src/context/ingest/historic-sql-probes.ts`
- `packages/cli/src/context/ingest/historic-sql-probes/bigquery-runner.ts`
- `packages/cli/src/context/ingest/historic-sql-probes/postgres-runner.ts`
- `packages/cli/src/context/ingest/historic-sql-probes/snowflake-runner.ts`
- `packages/cli/src/context/ingest/ingest-bundle.runner.ts`
- `packages/cli/src/context/ingest/ingest-profile.ts`
- `packages/cli/src/context/ingest/ingest-trace.ts`
- `packages/cli/src/context/ingest/isolated-diff/git-patch.ts`
- `packages/cli/src/context/ingest/isolated-diff/patch-integrator.ts`
- `packages/cli/src/context/ingest/isolated-diff/textual-conflict-resolver.ts`
- `packages/cli/src/context/ingest/isolated-diff/work-unit-executor.ts`
- `packages/cli/src/context/ingest/local-adapters.ts`
- `packages/cli/src/context/ingest/local-bundle-runtime.ts`
- `packages/cli/src/context/ingest/local-ingest.ts`
- `packages/cli/src/context/ingest/local-mapping-reconcile.ts`
- `packages/cli/src/context/ingest/local-stage-ingest.ts`
- `packages/cli/src/context/ingest/memory-flow/events.ts`
- `packages/cli/src/context/ingest/memory-flow/interaction.ts`
- `packages/cli/src/context/ingest/memory-flow/interactive-render.ts`
- `packages/cli/src/context/ingest/memory-flow/known-errors.ts`
- `packages/cli/src/context/ingest/memory-flow/live-buffer.ts`
- `packages/cli/src/context/ingest/memory-flow/render.ts`
- `packages/cli/src/context/ingest/memory-flow/schema.ts`
- `packages/cli/src/context/ingest/memory-flow/summary.ts`
- `packages/cli/src/context/ingest/memory-flow/types.ts`
- `packages/cli/src/context/ingest/memory-flow/view-model.ts`
- `packages/cli/src/context/ingest/memory-flow/visuals.ts`
- `packages/cli/src/context/ingest/page-triage/page-triage.service.ts`
- `packages/cli/src/context/ingest/parsed-target-table.ts`
- `packages/cli/src/context/ingest/ports.ts`
- `packages/cli/src/context/ingest/raw-sources-paths.ts`
- `packages/cli/src/context/ingest/repo-fetch.ts`
- `packages/cli/src/context/ingest/report-snapshot.ts`
- `packages/cli/src/context/ingest/reports.ts`
- `packages/cli/src/context/ingest/semantic-layer-target-policy.ts`
- `packages/cli/src/context/ingest/source-adapter-registry.ts`
- `packages/cli/src/context/ingest/sqlite-bundle-ingest-store.ts`
- `packages/cli/src/context/ingest/sqlite-local-ingest-store.ts`
- `packages/cli/src/context/ingest/stages/build-reconcile-context.ts`
- `packages/cli/src/context/ingest/stages/build-wu-context.ts`
- `packages/cli/src/context/ingest/stages/stage-1-stage-raw-files.ts`
- `packages/cli/src/context/ingest/stages/stage-3-work-units.ts`
- `packages/cli/src/context/ingest/stages/stage-4-reconciliation.ts`
- `packages/cli/src/context/ingest/stages/stage-index.types.ts`
- `packages/cli/src/context/ingest/stages/validate-wu-sources.ts`
- `packages/cli/src/context/ingest/tools/emit-artifact-resolution.tool.ts`
- `packages/cli/src/context/ingest/tools/emit-conflict-resolution.tool.ts`
- `packages/cli/src/context/ingest/tools/emit-eviction-decision.tool.ts`
- `packages/cli/src/context/ingest/tools/emit-unmapped-fallback.tool.ts`
- `packages/cli/src/context/ingest/tools/eviction-list.tool.ts`
- `packages/cli/src/context/ingest/tools/read-raw-file.tool.ts`
- `packages/cli/src/context/ingest/tools/read-raw-span.tool.ts`
- `packages/cli/src/context/ingest/tools/stage-diff.tool.ts`
- `packages/cli/src/context/ingest/tools/stage-list.tool.ts`
- `packages/cli/src/context/ingest/tools/tool-call-logger.ts`
- `packages/cli/src/context/ingest/tools/tool-transcript-summary.ts`
- `packages/cli/src/context/ingest/tools/verification-ledger.tool.ts`
- `packages/cli/src/context/ingest/tools/warehouse-verification/create-warehouse-verification-tools.ts`
- `packages/cli/src/context/ingest/tools/warehouse-verification/discover-data.tool.ts`
- `packages/cli/src/context/ingest/tools/warehouse-verification/entity-details.tool.ts`
- `packages/cli/src/context/ingest/tools/warehouse-verification/sql-execution.tool.ts`
- `packages/cli/src/context/ingest/types.ts`
- `packages/cli/src/context/ingest/wiki-body-refs.ts`
- `packages/cli/src/context/ingest/wiki-sl-ref-repair.ts`
- `packages/cli/src/context/llm/ai-sdk-runtime.ts`
- `packages/cli/src/context/llm/claude-code-env.ts`
- `packages/cli/src/context/llm/claude-code-models.ts`
- `packages/cli/src/context/llm/claude-code-runtime.ts`
- `packages/cli/src/context/llm/codex-exec-events.ts`
- `packages/cli/src/context/llm/codex-isolation.ts`
- `packages/cli/src/context/llm/codex-mcp-runtime-server.ts`
- `packages/cli/src/context/llm/codex-models.ts`
- `packages/cli/src/context/llm/codex-runtime-config.ts`
- `packages/cli/src/context/llm/codex-runtime.ts`
- `packages/cli/src/context/llm/codex-sdk-runner.ts`
- `packages/cli/src/context/llm/debug-request-recorder.ts`
- `packages/cli/src/context/llm/embedding-port.ts`
- `packages/cli/src/context/llm/local-config.ts`
- `packages/cli/src/context/llm/rate-limit-governor.ts`
- `packages/cli/src/context/llm/runtime-port.ts`
- `packages/cli/src/context/llm/runtime-tools.ts`
- `packages/cli/src/context/mcp/context-tools.ts`
- `packages/cli/src/context/mcp/local-project-ports.ts`
- `packages/cli/src/context/mcp/server.ts`
- `packages/cli/src/context/mcp/types.ts`
- `packages/cli/src/context/memory/capture-signals.ts`
- `packages/cli/src/context/memory/local-memory-runs.ts`
- `packages/cli/src/context/memory/local-memory.ts`
- `packages/cli/src/context/memory/memory-agent.service.ts`
- `packages/cli/src/context/memory/memory-runs.ts`
- `packages/cli/src/context/memory/types.ts`
- `packages/cli/src/context/project/config.ts`
- `packages/cli/src/context/project/driver-schemas.ts`
- `packages/cli/src/context/project/local-git-file-store.ts`
- `packages/cli/src/context/project/local-state-db.ts`
- `packages/cli/src/context/project/mappings-yaml-schema.ts`
- `packages/cli/src/context/project/project.ts`
- `packages/cli/src/context/project/setup-config.ts`
- `packages/cli/src/context/prompts/prompt.service.ts`
- `packages/cli/src/context/scan/constraint-discovery.ts`
- `packages/cli/src/context/scan/credentials.ts`
- `packages/cli/src/context/scan/data-dictionary.ts`
- `packages/cli/src/context/scan/description-generation.ts`
- `packages/cli/src/context/scan/embedding-text.ts`
- `packages/cli/src/context/scan/enabled-tables.ts`
- `packages/cli/src/context/scan/enrichment-state.ts`
- `packages/cli/src/context/scan/enrichment-summary.ts`
- `packages/cli/src/context/scan/enrichment-types.ts`
- `packages/cli/src/context/scan/entity-details.ts`
- `packages/cli/src/context/scan/local-enrichment-artifacts.ts`
- `packages/cli/src/context/scan/local-enrichment.ts`
- `packages/cli/src/context/scan/local-scan.ts`
- `packages/cli/src/context/scan/local-structural-artifacts.ts`
- `packages/cli/src/context/scan/relationship-benchmark-report.ts`
- `packages/cli/src/context/scan/relationship-benchmarks.ts`
- `packages/cli/src/context/scan/relationship-budget.ts`
- `packages/cli/src/context/scan/relationship-candidates.ts`
- `packages/cli/src/context/scan/relationship-composite-candidates.ts`
- `packages/cli/src/context/scan/relationship-diagnostics.ts`
- `packages/cli/src/context/scan/relationship-discovery.ts`
- `packages/cli/src/context/scan/relationship-formal-metadata.ts`
- `packages/cli/src/context/scan/relationship-graph-resolver.ts`
- `packages/cli/src/context/scan/relationship-llm-proposal.ts`
- `packages/cli/src/context/scan/relationship-locality.ts`
- `packages/cli/src/context/scan/relationship-name-similarity.ts`
- `packages/cli/src/context/scan/relationship-profiling.ts`
- `packages/cli/src/context/scan/relationship-scoring.ts`
- `packages/cli/src/context/scan/relationship-validation.ts`
- `packages/cli/src/context/scan/sqlite-local-enrichment-state-store.ts`
- `packages/cli/src/context/scan/table-ref.ts`
- `packages/cli/src/context/scan/type-normalization.ts`
- `packages/cli/src/context/scan/types.ts`
- `packages/cli/src/context/scan/warehouse-catalog.ts`
- `packages/cli/src/context/search/discover.ts`
- `packages/cli/src/context/search/hybrid-search-core.ts`
- `packages/cli/src/context/search/pglite-owner-process.ts`
- `packages/cli/src/context/search/query.ts`
- `packages/cli/src/context/search/rrf.ts`
- `packages/cli/src/context/search/types.ts`
- `packages/cli/src/context/skills/skills-registry.service.ts`
- `packages/cli/src/context/sl/description-normalization.ts`
- `packages/cli/src/context/sl/descriptions.ts`
- `packages/cli/src/context/sl/dictionary-search.ts`
- `packages/cli/src/context/sl/local-query.ts`
- `packages/cli/src/context/sl/local-sl.ts`
- `packages/cli/src/context/sl/pglite-sl-search-prototype.ts`
- `packages/cli/src/context/sl/ports.ts`
- `packages/cli/src/context/sl/schemas.ts`
- `packages/cli/src/context/sl/semantic-layer.service.ts`
- `packages/cli/src/context/sl/sl-dictionary-profile.ts`
- `packages/cli/src/context/sl/sl-search.service.ts`
- `packages/cli/src/context/sl/sl-validator.port.ts`
- `packages/cli/src/context/sl/source-files.ts`
- `packages/cli/src/context/sl/sqlite-sl-sources-index.ts`
- `packages/cli/src/context/sl/tools/base-semantic-layer.tool.ts`
- `packages/cli/src/context/sl/tools/connection-id-schema.ts`
- `packages/cli/src/context/sl/tools/sl-discover.tool.ts`
- `packages/cli/src/context/sl/tools/sl-edit-source.tool.ts`
- `packages/cli/src/context/sl/tools/sl-read-source.tool.ts`
- `packages/cli/src/context/sl/tools/sl-rollback.tool.ts`
- `packages/cli/src/context/sl/tools/sl-validate.tool.ts`
- `packages/cli/src/context/sl/tools/sl-warehouse-validation.ts`
- `packages/cli/src/context/sl/tools/sl-write-source.tool.ts`
- `packages/cli/src/context/sl/types.ts`
- `packages/cli/src/context/sql-analysis/dialect.ts`
- `packages/cli/src/context/sql-analysis/http-sql-analysis-port.ts`
- `packages/cli/src/context/sql-analysis/ports.ts`
- `packages/cli/src/context/tools/action-raw-paths.ts`
- `packages/cli/src/context/tools/action-target-connection.ts`
- `packages/cli/src/context/tools/authors.ts`
- `packages/cli/src/context/tools/base-tool.ts`
- `packages/cli/src/context/tools/context-candidate-mark.tool.ts`
- `packages/cli/src/context/tools/context-candidate-write.tool.ts`
- `packages/cli/src/context/tools/context-evidence-ids.ts`
- `packages/cli/src/context/tools/context-evidence-neighbors.tool.ts`
- `packages/cli/src/context/tools/context-evidence-read.tool.ts`
- `packages/cli/src/context/tools/context-evidence-search.tool.ts`
- `packages/cli/src/context/tools/context-evidence-tool-store.ts`
- `packages/cli/src/context/tools/context-ingest-metadata.ts`
- `packages/cli/src/context/tools/sql-edit-replacer.ts`
- `packages/cli/src/context/tools/tool-session.ts`
- `packages/cli/src/context/tools/touched-sl-sources.ts`
- `packages/cli/src/context/wiki/keys.ts`
- `packages/cli/src/context/wiki/knowledge-search-text.ts`
- `packages/cli/src/context/wiki/knowledge-wiki.service.ts`
- `packages/cli/src/context/wiki/local-knowledge.ts`
- `packages/cli/src/context/wiki/ports.ts`
- `packages/cli/src/context/wiki/sqlite-knowledge-index.ts`
- `packages/cli/src/context/wiki/tools/wiki-list-tags.tool.ts`
- `packages/cli/src/context/wiki/tools/wiki-read.tool.ts`
- `packages/cli/src/context/wiki/tools/wiki-remove.tool.ts`
- `packages/cli/src/context/wiki/tools/wiki-search.tool.ts`
- `packages/cli/src/context/wiki/tools/wiki-write.tool.ts`
- `packages/cli/src/context/wiki/types.ts`
- `packages/cli/src/context/wiki/wiki-ref-validation.ts`
- `packages/cli/src/database-tree-picker.ts`
- `packages/cli/src/demo-assets.ts`
- `packages/cli/src/demo-metrics.ts`
- `packages/cli/src/doctor.ts`
- `packages/cli/src/embedding-resolution.ts`
- `packages/cli/src/error-message.ts`
- `packages/cli/src/errors.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/ingest-query-executor.ts`
- `packages/cli/src/ingest-report-file.ts`
- `packages/cli/src/ingest.ts`
- `packages/cli/src/io/buffered-command-io.ts`
- `packages/cli/src/io/logger.ts`
- `packages/cli/src/io/mode.ts`
- `packages/cli/src/io/print-list.ts`
- `packages/cli/src/io/symbols.ts`
- `packages/cli/src/io/tty.ts`
- `packages/cli/src/knowledge.ts`
- `packages/cli/src/links.ts`
- `packages/cli/src/llm/embedding-health.ts`
- `packages/cli/src/llm/embedding-provider.ts`
- `packages/cli/src/llm/message-builder.ts`
- `packages/cli/src/llm/model-health.ts`
- `packages/cli/src/llm/model-provider.ts`
- `packages/cli/src/llm/repair.ts`
- `packages/cli/src/llm/types.ts`
- `packages/cli/src/local-adapters.ts`
- `packages/cli/src/local-scan-connectors.ts`
- `packages/cli/src/managed-local-embeddings.ts`
- `packages/cli/src/managed-mcp-daemon.ts`
- `packages/cli/src/managed-python-command.ts`
- `packages/cli/src/managed-python-daemon.ts`
- `packages/cli/src/managed-python-http.ts`
- `packages/cli/src/managed-python-runtime.ts`
- `packages/cli/src/managed-uv-release.ts`
- `packages/cli/src/mcp-http-server.ts`
- `packages/cli/src/mcp-server-factory.ts`
- `packages/cli/src/mcp-stdio-server.ts`
- `packages/cli/src/memory-flow-hud.tsx`
- `packages/cli/src/memory-flow-interactive.ts`
- `packages/cli/src/memory-flow-tui.tsx`
- `packages/cli/src/next-steps.ts`
- `packages/cli/src/notion-page-picker.ts`
- `packages/cli/src/print-command-tree.ts`
- `packages/cli/src/progress-port-adapter.ts`
- `packages/cli/src/project-resolver.ts`
- `packages/cli/src/prompt-navigation.ts`
- `packages/cli/src/prompts/memory_agent_backfill.md`
- `packages/cli/src/prompts/memory_agent_bundle_ingest_reconcile.md`
- `packages/cli/src/prompts/memory_agent_bundle_ingest_work_unit.md`
- `packages/cli/src/prompts/memory_agent_external_ingest.md`
- `packages/cli/src/prompts/memory_agent_research.md`
- `packages/cli/src/prompts/skills/light_extraction.md`
- `packages/cli/src/prompts/skills/page_triage_classifier.md`
- `packages/cli/src/proxy-env.ts`
- `packages/cli/src/public-ingest-copy.ts`
- `packages/cli/src/public-ingest.ts`
- `packages/cli/src/release-version.ts`
- `packages/cli/src/reveal-password-prompt.ts`
- `packages/cli/src/runtime-requirements.ts`
- `packages/cli/src/runtime.ts`
- `packages/cli/src/scan.ts`
- `packages/cli/src/setup-agents.ts`
- `packages/cli/src/setup-banner.ts`
- `packages/cli/src/setup-context.ts`
- `packages/cli/src/setup-databases.ts`
- `packages/cli/src/setup-demo-tour.ts`
- `packages/cli/src/setup-embeddings.ts`
- `packages/cli/src/setup-interrupt.ts`
- `packages/cli/src/setup-models.ts`
- `packages/cli/src/setup-project.ts`
- `packages/cli/src/setup-prompts.ts`
- `packages/cli/src/setup-ready-menu.ts`
- `packages/cli/src/setup-runtime.ts`
- `packages/cli/src/setup-secrets.ts`
- `packages/cli/src/setup-sources.ts`
- `packages/cli/src/setup.ts`
- `packages/cli/src/skills/_shared/identifier-verification.md`
- `packages/cli/src/skills/analytics/SKILL.md`
- `packages/cli/src/skills/dbt_ingest/SKILL.md`
- `packages/cli/src/skills/historic_sql_patterns/SKILL.md`
- `packages/cli/src/skills/historic_sql_table_digest/SKILL.md`
- `packages/cli/src/skills/ingest_triage/SKILL.md`
- `packages/cli/src/skills/live_database_ingest/SKILL.md`
- `packages/cli/src/skills/looker_ingest/SKILL.md`
- `packages/cli/src/skills/lookml_ingest/SKILL.md`
- `packages/cli/src/skills/metabase_ingest/SKILL.md`
- `packages/cli/src/skills/metricflow_ingest/SKILL.md`
- `packages/cli/src/skills/notion_synthesize/SKILL.md`
- `packages/cli/src/skills/sl/SKILL.md`
- `packages/cli/src/skills/sl_capture/SKILL.md`
- `packages/cli/src/skills/wiki_capture/SKILL.md`
- `packages/cli/src/sl.ts`
- `packages/cli/src/source-mapping.ts`
- `packages/cli/src/sql.ts`
- `packages/cli/src/star-prompt/cache.ts`
- `packages/cli/src/star-prompt/star-count.ts`
- `packages/cli/src/star-prompt/star-line.ts`
- `packages/cli/src/startup-profile.ts`
- `packages/cli/src/status-project.ts`
- `packages/cli/src/telemetry/command-hook.ts`
- `packages/cli/src/telemetry/demo-detect.ts`
- `packages/cli/src/telemetry/emitter.ts`
- `packages/cli/src/telemetry/events.schema.json`
- `packages/cli/src/telemetry/events.ts`
- `packages/cli/src/telemetry/exception.ts`
- `packages/cli/src/telemetry/identity.ts`
- `packages/cli/src/telemetry/index.ts`
- `packages/cli/src/telemetry/project-snapshot.ts`
- `packages/cli/src/telemetry/redaction-secrets.ts`
- `packages/cli/src/telemetry/schema-writer.ts`
- `packages/cli/src/telemetry/scrubber.ts`
- `packages/cli/src/text-ingest.ts`
- `packages/cli/src/tree-picker-state.ts`
- `packages/cli/src/tree-picker-tui.tsx`
- `packages/cli/src/update-check/cache.ts`
- `packages/cli/src/update-check/channel.ts`
- `packages/cli/src/update-check/registry.ts`
- `packages/cli/src/update-check/update-check.ts`
- `packages/cli/src/viz-fallback.ts`
- `packages/cli/test/admin-reindex.test.ts`
- `packages/cli/test/admin.test.ts`
- `packages/cli/test/clack.test.ts`
- `packages/cli/test/cli-program-telemetry.test.ts`
- `packages/cli/test/cli-program.test.ts`
- `packages/cli/test/cli-runtime.test.ts`
- `packages/cli/test/command-tree.test.ts`
- `packages/cli/test/commands/mcp-commands.test.ts`
- `packages/cli/test/commands/sql-commands.test.ts`
- `packages/cli/test/commands/wiki-sl-read-commands.test.ts`
- `packages/cli/test/community-cta.test.ts`
- `packages/cli/test/completion/complete-engine.test.ts`
- `packages/cli/test/completion/completion-scripts.test.ts`
- `packages/cli/test/completion/dynamic-candidates.test.ts`
- `packages/cli/test/connection-list-federated.test.ts`
- `packages/cli/test/connection-recovery.test.ts`
- `packages/cli/test/connection.test.ts`
- `packages/cli/test/connectors/bigquery/connector.test.ts`
- `packages/cli/test/connectors/bigquery/dialect.test.ts`
- `packages/cli/test/connectors/clickhouse/connector.test.ts`
- `packages/cli/test/connectors/clickhouse/dialect.test.ts`
- `packages/cli/test/connectors/duckdb/federated-attach.test.ts`
- `packages/cli/test/connectors/duckdb/federated-executor.test.ts`
- `packages/cli/test/connectors/duckdb/federated-join.integration.test.ts`
- `packages/cli/test/connectors/mysql/connector.test.ts`
- `packages/cli/test/connectors/mysql/dialect.test.ts`
- `packages/cli/test/connectors/postgres/connector.test.ts`
- `packages/cli/test/connectors/postgres/dialect.test.ts`
- `packages/cli/test/connectors/postgres/historic-sql-query-client.test.ts`
- `packages/cli/test/connectors/shared/string-reference.test.ts`
- `packages/cli/test/connectors/snowflake/connector.test.ts`
- `packages/cli/test/connectors/snowflake/dialect.test.ts`
- `packages/cli/test/connectors/snowflake/identifiers.test.ts`
- `packages/cli/test/connectors/snowflake/sdk-logger.test.ts`
- `packages/cli/test/connectors/sqlite/connector.test.ts`
- `packages/cli/test/connectors/sqlite/dialect.test.ts`
- `packages/cli/test/connectors/sqlserver/connector.test.ts`
- `packages/cli/test/connectors/sqlserver/dialect.test.ts`
- `packages/cli/test/context-build-view.test.ts`
- `packages/cli/test/context/connections/bigquery-identifiers.test.ts`
- `packages/cli/test/context/connections/dialects.test.ts`
- `packages/cli/test/context/connections/drivers.test.ts`
- `packages/cli/test/context/connections/federation.test.ts`
- `packages/cli/test/context/connections/local-warehouse-descriptor.test.ts`
- `packages/cli/test/context/connections/notion-config.test.ts`
- `packages/cli/test/context/connections/project-sql-executor.integration.test.ts`
- `packages/cli/test/context/connections/project-sql-executor.test.ts`
- `packages/cli/test/context/connections/read-only-sql.test.ts`
- `packages/cli/test/context/connections/resolve-connection.test.ts`
- `packages/cli/test/context/core/abort.test.ts`
- `packages/cli/test/context/core/config-reference.test.ts`
- `packages/cli/test/context/core/git.service.assert-worktree-clean.test.ts`
- `packages/cli/test/context/core/git.service.delete-directories.test.ts`
- `packages/cli/test/context/core/git.service.init-identity.test.ts`
- `packages/cli/test/context/core/git.service.patch.test.ts`
- `packages/cli/test/context/core/git.service.repo-isolation.test.ts`
- `packages/cli/test/context/core/git.service.reset-hard.test.ts`
- `packages/cli/test/context/core/git.service.test.ts`
- `packages/cli/test/context/core/session-worktree.service.test.ts`
- `packages/cli/test/context/daemon/semantic-layer-compute.test.ts`
- `packages/cli/test/context/index-sync/reindex.nested-git-root.test.ts`
- `packages/cli/test/context/index-sync/reindex.test.ts`
- `packages/cli/test/context/ingest/action-identity.test.ts`
- `packages/cli/test/context/ingest/adapters/dbt-descriptions/parse-schema.test.ts`
- `packages/cli/test/context/ingest/adapters/dbt/chunk.test.ts`
- `packages/cli/test/context/ingest/adapters/dbt/dbt.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/dbt/fetch.test.ts`
- `packages/cli/test/context/ingest/adapters/dbt/parse.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/bigquery-query-history-reader.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/buckets.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/chunk-unified.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/connection-dialect.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/detect.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/evidence-tool.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/evidence.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/historic-sql.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/local-ingest-acceptance.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/pattern-inputs.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/postgres-pgss-reader.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/projection.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/query-history-filter-picker.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/redaction.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/scope-floor.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/scope-membership.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/skill-schemas.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/snowflake-query-history-reader.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/stage-unified.test.ts`
- `packages/cli/test/context/ingest/adapters/historic-sql/types.test.ts`
- `packages/cli/test/context/ingest/adapters/live-database/chunk.test.ts`
- `packages/cli/test/context/ingest/adapters/live-database/daemon-introspection.test.ts`
- `packages/cli/test/context/ingest/adapters/live-database/live-database.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/live-database/manifest.test.ts`
- `packages/cli/test/context/ingest/adapters/live-database/stage.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/chunk.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/client-boundary.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/client.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/daemon-table-identifier-parser.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/detect.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/evidence-documents.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/factory.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/fetch-report.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/fetch.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/local-runtime-store.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/looker.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/mapping.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/reconcile.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/scope.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/target-connections.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/tools/looker-query-to-sl.tool.test.ts`
- `packages/cli/test/context/ingest/adapters/looker/types.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/chunk.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/detect.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/fetch-report.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/fetch.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/graph.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/lookml.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/parse.test.ts`
- `packages/cli/test/context/ingest/adapters/lookml/pull-config.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/card-references.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/chunk.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/client-boundary.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/client-port.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/client.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/detect.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/fanout-planner.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/fetch-scope.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/fetch.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/local-metabase.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/local-source-state-store.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/mapping.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/metabase.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/serialize-card.test.ts`
- `packages/cli/test/context/ingest/adapters/metabase/types.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/chunk.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/deep-parse.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/detect.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/fetch.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/graph.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/import-semantic-models.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/metricflow.adapter.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/parse.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/pull-config.test.ts`
- `packages/cli/test/context/ingest/adapters/metricflow/semantic-models.test.ts`
- `packages/cli/test/context/ingest/adapters/notion/cluster.test.ts`
- `packages/cli/test/context/ingest/adapters/notion/fetch.test.ts`
- `packages/cli/test/context/ingest/adapters/notion/local-state-store.test.ts`
- `packages/cli/test/context/ingest/adapters/notion/normalize.test.ts`
- `packages/cli/test/context/ingest/adapters/notion/notion-client.test.ts`
- `packages/cli/test/context/ingest/adapters/notion/notion.adapter.test.ts`
- `packages/cli/test/context/ingest/artifact-gates.test.ts`
- `packages/cli/test/context/ingest/canonical-pins.test.ts`
- `packages/cli/test/context/ingest/clustering/kmeans.test.ts`
- `packages/cli/test/context/ingest/context-candidates/candidate-dedup.service.test.ts`
- `packages/cli/test/context/ingest/context-candidates/context-candidate-carryforward.service.test.ts`
- `packages/cli/test/context/ingest/context-candidates/curator-pagination.service.test.ts`
- `packages/cli/test/context/ingest/context-candidates/embedding-text.test.ts`
- `packages/cli/test/context/ingest/context-candidates/store.test.ts`
- `packages/cli/test/context/ingest/context-evidence/context-evidence-index.service.test.ts`
- `packages/cli/test/context/ingest/context-evidence/sqlite-context-evidence-store.test.ts`
- `packages/cli/test/context/ingest/context-evidence/store.test.ts`
- `packages/cli/test/context/ingest/dbt-shared/project-vars.test.ts`
- `packages/cli/test/context/ingest/dbt-shared/schema-files.test.ts`
- `packages/cli/test/context/ingest/diff-set.service.test.ts`
- `packages/cli/test/context/ingest/final-gate-repair.test.ts`
- `packages/cli/test/context/ingest/finalization-scope.test.ts`
- `packages/cli/test/context/ingest/historic-sql-probes.test.ts`
- `packages/cli/test/context/ingest/historic-sql-probes/bigquery-runner.test.ts`
- `packages/cli/test/context/ingest/historic-sql-probes/postgres-runner.test.ts`
- `packages/cli/test/context/ingest/historic-sql-probes/snowflake-runner.test.ts`
- `packages/cli/test/context/ingest/ingest-bundle.runner.isolated-diff.test.ts`
- `packages/cli/test/context/ingest/ingest-bundle.runner.test.ts`
- `packages/cli/test/context/ingest/ingest-profile.test.ts`
- `packages/cli/test/context/ingest/ingest-prompts.test.ts`
- `packages/cli/test/context/ingest/ingest-runtime-assets.test.ts`
- `packages/cli/test/context/ingest/ingest-trace.test.ts`
- `packages/cli/test/context/ingest/isolated-diff/git-patch.test.ts`
- `packages/cli/test/context/ingest/isolated-diff/patch-integrator.test.ts`
- `packages/cli/test/context/ingest/isolated-diff/textual-conflict-resolver.test.ts`
- `packages/cli/test/context/ingest/isolated-diff/work-unit-executor.test.ts`
- `packages/cli/test/context/ingest/local-adapters.test.ts`
- `packages/cli/test/context/ingest/local-bundle-ingest.test.ts`
- `packages/cli/test/context/ingest/local-bundle-runtime.test.ts`
- `packages/cli/test/context/ingest/local-embedding-provider.integration.test.ts`
- `packages/cli/test/context/ingest/local-mapping-reconcile.test.ts`
- `packages/cli/test/context/ingest/local-metabase-ingest.test.ts`
- `packages/cli/test/context/ingest/local-stage-ingest.test.ts`
- `packages/cli/test/context/ingest/manifest-federated-join.test.ts`
- `packages/cli/test/context/ingest/memory-flow/acceptance-fixtures.ts`
- `packages/cli/test/context/ingest/memory-flow/acceptance.test.ts`
- `packages/cli/test/context/ingest/memory-flow/events.test.ts`
- `packages/cli/test/context/ingest/memory-flow/interaction.test.ts`
- `packages/cli/test/context/ingest/memory-flow/interactive-render.test.ts`
- `packages/cli/test/context/ingest/memory-flow/live-buffer.test.ts`
- `packages/cli/test/context/ingest/memory-flow/render.test.ts`
- `packages/cli/test/context/ingest/memory-flow/schema.test.ts`
- `packages/cli/test/context/ingest/memory-flow/summary.test.ts`
- `packages/cli/test/context/ingest/memory-flow/view-model.test.ts`
- `packages/cli/test/context/ingest/memory-flow/visuals.test.ts`
- `packages/cli/test/context/ingest/page-triage/page-triage.service.test.ts`
- `packages/cli/test/context/ingest/raw-sources-paths.test.ts`
- `packages/cli/test/context/ingest/repo-fetch.test.ts`
- `packages/cli/test/context/ingest/report-snapshot.test.ts`
- `packages/cli/test/context/ingest/reports.test.ts`
- `packages/cli/test/context/ingest/semantic-layer-target-policy.test.ts`
- `packages/cli/test/context/ingest/source-adapter-registry.test.ts`
- `packages/cli/test/context/ingest/sqlite-bundle-ingest-store.test.ts`
- `packages/cli/test/context/ingest/sqlite-local-ingest-store.test.ts`
- `packages/cli/test/context/ingest/stages/build-reconcile-context.context-candidates.test.ts`
- `packages/cli/test/context/ingest/stages/build-reconcile-context.test.ts`
- `packages/cli/test/context/ingest/stages/build-wu-context.test.ts`
- `packages/cli/test/context/ingest/stages/stage-1-stage-raw-files.test.ts`
- `packages/cli/test/context/ingest/stages/stage-3-work-units.test.ts`
- `packages/cli/test/context/ingest/stages/stage-4-reconciliation.test.ts`
- `packages/cli/test/context/ingest/stages/validate-wu-sources.test.ts`
- `packages/cli/test/context/ingest/tools/emit-reconciliation-records.tool.test.ts`
- `packages/cli/test/context/ingest/tools/eviction-list.tool.test.ts`
- `packages/cli/test/context/ingest/tools/read-raw-file.tool.test.ts`
- `packages/cli/test/context/ingest/tools/read-raw-span.tool.test.ts`
- `packages/cli/test/context/ingest/tools/stage-diff.tool.test.ts`
- `packages/cli/test/context/ingest/tools/stage-list.tool.test.ts`
- `packages/cli/test/context/ingest/tools/tool-call-logger.test.ts`
- `packages/cli/test/context/ingest/tools/tool-transcript-summary.test.ts`
- `packages/cli/test/context/ingest/tools/warehouse-verification/discover-data.tool.test.ts`
- `packages/cli/test/context/ingest/tools/warehouse-verification/entity-details.tool.test.ts`
- `packages/cli/test/context/ingest/tools/warehouse-verification/sql-execution.tool.test.ts`
- `packages/cli/test/context/ingest/wiki-body-refs.test.ts`
- `packages/cli/test/context/ingest/wiki-sl-ref-repair.test.ts`
- `packages/cli/test/context/llm/ai-sdk-runtime.test.ts`
- `packages/cli/test/context/llm/claude-code-env.test.ts`
- `packages/cli/test/context/llm/claude-code-models.test.ts`
- `packages/cli/test/context/llm/claude-code-runtime.test.ts`
- `packages/cli/test/context/llm/codex-exec-events.test.ts`
- `packages/cli/test/context/llm/codex-isolation.test.ts`
- `packages/cli/test/context/llm/codex-mcp-runtime-server.test.ts`
- `packages/cli/test/context/llm/codex-models.test.ts`
- `packages/cli/test/context/llm/codex-runtime-config.test.ts`
- `packages/cli/test/context/llm/codex-runtime.test.ts`
- `packages/cli/test/context/llm/codex-sdk-runner.test.ts`
- `packages/cli/test/context/llm/debug-request-recorder.test.ts`
- `packages/cli/test/context/llm/embedding-port.test.ts`
- `packages/cli/test/context/llm/local-config.test.ts`
- `packages/cli/test/context/llm/rate-limit-governor.test.ts`
- `packages/cli/test/context/llm/runtime-local-config.test.ts`
- `packages/cli/test/context/llm/runtime-tools.test.ts`
- `packages/cli/test/context/mcp/__snapshots__/mcp-tools-list.json`
- `packages/cli/test/context/mcp/connection-list-federated.test.ts`
- `packages/cli/test/context/mcp/local-project-ports-federated.integration.test.ts`
- `packages/cli/test/context/mcp/local-project-ports.test.ts`
- `packages/cli/test/context/mcp/server.test.ts`
- `packages/cli/test/context/memory/local-memory.test.ts`
- `packages/cli/test/context/memory/memory-agent.service.ingest.test.ts`
- `packages/cli/test/context/memory/memory-agent.service.test.ts`
- `packages/cli/test/context/memory/memory-runs.test.ts`
- `packages/cli/test/context/memory/memory-runtime-assets.test.ts`
- `packages/cli/test/context/project/config.test.ts`
- `packages/cli/test/context/project/driver-schemas.test.ts`
- `packages/cli/test/context/project/local-git-file-store.test.ts`
- `packages/cli/test/context/project/mappings-yaml-schema.test.ts`
- `packages/cli/test/context/project/project.test.ts`
- `packages/cli/test/context/project/setup-config.test.ts`
- `packages/cli/test/context/prompts/prompt.service.test.ts`
- `packages/cli/test/context/scan/constraint-discovery.test.ts`
- `packages/cli/test/context/scan/credentials.test.ts`
- `packages/cli/test/context/scan/data-dictionary.test.ts`
- `packages/cli/test/context/scan/description-generation.test.ts`
- `packages/cli/test/context/scan/embedding-text.test.ts`
- `packages/cli/test/context/scan/enrichment-state.test.ts`
- `packages/cli/test/context/scan/enrichment-summary.test.ts`
- `packages/cli/test/context/scan/enrichment-types.test.ts`
- `packages/cli/test/context/scan/entity-details.test.ts`
- `packages/cli/test/context/scan/local-enrichment-artifacts.test.ts`
- `packages/cli/test/context/scan/local-enrichment-federated-join.test.ts`
- `packages/cli/test/context/scan/local-enrichment.test.ts`
- `packages/cli/test/context/scan/local-scan.test.ts`
- `packages/cli/test/context/scan/local-structural-artifacts.test.ts`
- `packages/cli/test/context/scan/relationship-benchmark-report.test.ts`
- `packages/cli/test/context/scan/relationship-benchmarks.test.ts`
- `packages/cli/test/context/scan/relationship-budget.test.ts`
- `packages/cli/test/context/scan/relationship-candidates.test.ts`
- `packages/cli/test/context/scan/relationship-composite-candidates.test.ts`
- `packages/cli/test/context/scan/relationship-diagnostics.test.ts`
- `packages/cli/test/context/scan/relationship-discovery.test.ts`
- `packages/cli/test/context/scan/relationship-formal-metadata.test.ts`
- `packages/cli/test/context/scan/relationship-graph-resolver.test.ts`
- `packages/cli/test/context/scan/relationship-llm-proposal.test.ts`
- `packages/cli/test/context/scan/relationship-locality.test.ts`
- `packages/cli/test/context/scan/relationship-name-similarity.test.ts`
- `packages/cli/test/context/scan/relationship-profiling.test.ts`
- `packages/cli/test/context/scan/relationship-scoring.test.ts`
- `packages/cli/test/context/scan/relationship-validation.test.ts`
- `packages/cli/test/context/scan/table-ref.test.ts`
- `packages/cli/test/context/scan/type-normalization.test.ts`
- `packages/cli/test/context/scan/types.test.ts`
- `packages/cli/test/context/scan/warehouse-catalog.test.ts`
- `packages/cli/test/context/search/backend-conformance.test-utils.test.ts`
- `packages/cli/test/context/search/backend-conformance.test-utils.ts`
- `packages/cli/test/context/search/discover.test.ts`
- `packages/cli/test/context/search/hybrid-search-core.test.ts`
- `packages/cli/test/context/search/pglite-owner-process.test.ts`
- `packages/cli/test/context/search/pglite-runtime-boundary.test.ts`
- `packages/cli/test/context/search/pglite-spike.test.ts`
- `packages/cli/test/context/search/query.test.ts`
- `packages/cli/test/context/search/rrf.test.ts`
- `packages/cli/test/context/skills/skills-registry.service.test.ts`
- `packages/cli/test/context/sl/description-normalization.test.ts`
- `packages/cli/test/context/sl/dictionary-search.test.ts`
- `packages/cli/test/context/sl/local-query-federated.integration.test.ts`
- `packages/cli/test/context/sl/local-query-federated.test.ts`
- `packages/cli/test/context/sl/local-query.test.ts`
- `packages/cli/test/context/sl/local-sl-federated.test.ts`
- `packages/cli/test/context/sl/local-sl.test.ts`
- `packages/cli/test/context/sl/pglite-sl-search-prototype.test.ts`
- `packages/cli/test/context/sl/schemas.contract.test.ts`
- `packages/cli/test/context/sl/semantic-layer.service.test.ts`
- `packages/cli/test/context/sl/sl-dictionary-profile.test.ts`
- `packages/cli/test/context/sl/sl-search.service.test.ts`
- `packages/cli/test/context/sl/sl-source-seeding.test-utils.ts`
- `packages/cli/test/context/sl/source-files-reserved.test.ts`
- `packages/cli/test/context/sl/source-files.test.ts`
- `packages/cli/test/context/sl/sqlite-sl-sources-index.test.ts`
- `packages/cli/test/context/sl/tools/connection-id-schema.test.ts`
- `packages/cli/test/context/sl/tools/sl-discover.tool.test.ts`
- `packages/cli/test/context/sl/tools/sl-edit-source.tool.test.ts`
- `packages/cli/test/context/sl/tools/sl-read-source.tool.session.test.ts`
- `packages/cli/test/context/sl/tools/sl-rollback.tool.test.ts`
- `packages/cli/test/context/sl/tools/sl-validate.tool.test.ts`
- `packages/cli/test/context/sl/tools/sl-warehouse-validation.test.ts`
- `packages/cli/test/context/sl/tools/sl-write-source.tool.test.ts`
- `packages/cli/test/context/sql-analysis/dialect.test.ts`
- `packages/cli/test/context/sql-analysis/http-sql-analysis-port.test.ts`
- `packages/cli/test/context/test/make-local-git-repo.ts`
- `packages/cli/test/context/tools/context-evidence-tools.test.ts`
- `packages/cli/test/context/tools/touched-sl-sources.test.ts`
- `packages/cli/test/context/wiki/knowledge-wiki.service.test.ts`
- `packages/cli/test/context/wiki/local-knowledge.test.ts`
- `packages/cli/test/context/wiki/sqlite-knowledge-index.test.ts`
- `packages/cli/test/context/wiki/tools/wiki-list-tags.tool.test.ts`
- `packages/cli/test/context/wiki/tools/wiki-read.tool.test.ts`
- `packages/cli/test/context/wiki/tools/wiki-remove.tool.test.ts`
- `packages/cli/test/context/wiki/tools/wiki-search.tool.test.ts`
- `packages/cli/test/context/wiki/tools/wiki-write.tool.test.ts`
- `packages/cli/test/context/wiki/wiki-ref-validation.test.ts`
- `packages/cli/test/database-tree-picker.test.ts`
- `packages/cli/test/demo-assets.test.ts`
- `packages/cli/test/demo-metrics.test.ts`
- `packages/cli/test/doctor.test.ts`
- `packages/cli/test/embedding-resolution.test.ts`
- `packages/cli/test/example-smoke.test.ts`
- `packages/cli/test/fixtures/lookml/extends-chain/orders.model.lkml`
- `packages/cli/test/fixtures/lookml/extends-chain/views/base.view.lkml`
- `packages/cli/test/fixtures/lookml/extends-chain/views/orders.view.lkml`
- `packages/cli/test/fixtures/lookml/extends-chain/views/orders_ext.view.lkml`
- `packages/cli/test/fixtures/lookml/multi-model/marketing.model.lkml`
- `packages/cli/test/fixtures/lookml/multi-model/orders.model.lkml`
- `packages/cli/test/fixtures/lookml/multi-model/views/campaigns.view.lkml`
- `packages/cli/test/fixtures/lookml/multi-model/views/orders.view.lkml`
- `packages/cli/test/fixtures/lookml/multi-model/views/shared_dims.view.lkml`
- `packages/cli/test/fixtures/lookml/single-model/orders.model.lkml`
- `packages/cli/test/fixtures/lookml/single-model/views/customers.view.lkml`
- `packages/cli/test/fixtures/lookml/single-model/views/orders.view.lkml`
- `packages/cli/test/fixtures/lookml/three-churn/billing.model.lkml`
- `packages/cli/test/fixtures/lookml/three-churn/customers.model.lkml`
- `packages/cli/test/fixtures/lookml/three-churn/support.model.lkml`
- `packages/cli/test/fixtures/lookml/three-churn/views/billing/billing_churn_risk.view.lkml`
- `packages/cli/test/fixtures/lookml/three-churn/views/customers/customer_churn_risk.view.lkml`
- `packages/cli/test/fixtures/lookml/three-churn/views/support/support_churn_risk.view.lkml`
- `packages/cli/test/fixtures/metabase/card-ref/cards/10.json`
- `packages/cli/test/fixtures/metabase/card-ref/cards/11.json`
- `packages/cli/test/fixtures/metabase/card-ref/collections/5.json`
- `packages/cli/test/fixtures/metabase/card-ref/databases/42.json`
- `packages/cli/test/fixtures/metabase/card-ref/sync-config.json`
- `packages/cli/test/fixtures/metabase/multi-collection/cards/1.json`
- `packages/cli/test/fixtures/metabase/multi-collection/cards/2.json`
- `packages/cli/test/fixtures/metabase/multi-collection/cards/3.json`
- `packages/cli/test/fixtures/metabase/multi-collection/collections/5.json`
- `packages/cli/test/fixtures/metabase/multi-collection/collections/6.json`
- `packages/cli/test/fixtures/metabase/multi-collection/databases/42.json`
- `packages/cli/test/fixtures/metabase/multi-collection/sync-config.json`
- `packages/cli/test/fixtures/metabase/simple/cards/1.json`
- `packages/cli/test/fixtures/metabase/simple/cards/2.json`
- `packages/cli/test/fixtures/metabase/simple/collections/5.json`
- `packages/cli/test/fixtures/metabase/simple/databases/42.json`
- `packages/cli/test/fixtures/metabase/simple/sync-config.json`
- `packages/cli/test/fixtures/metricflow/dbt-mixed/dbt_project.yml`
- `packages/cli/test/fixtures/metricflow/dbt-mixed/models/orders.yml`
- `packages/cli/test/fixtures/metricflow/extends-chain/metrics/orders_final.yml`
- `packages/cli/test/fixtures/metricflow/extends-chain/models/orders.yml`
- `packages/cli/test/fixtures/metricflow/extends-chain/models/orders_ext.yml`
- `packages/cli/test/fixtures/metricflow/multi-component/models/marketing/campaigns.yml`
- `packages/cli/test/fixtures/metricflow/multi-component/models/sales/orders.yml`
- `packages/cli/test/fixtures/metricflow/single-model/models/orders.yml`
- `packages/cli/test/fixtures/relationship-benchmarks/abbreviated_old_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/abbreviated_old_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/abbreviated_old_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/abbreviated_old_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/adventureworks_oltp_with_declared_metadata/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/adventureworks_oltp_with_declared_metadata/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/adventureworks_oltp_with_declared_metadata/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/adventureworkslt_with_declared_metadata/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/adventureworkslt_with_declared_metadata/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/adventureworkslt_with_declared_metadata/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/analytical_warehouse_no_naming_convention/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/analytical_warehouse_no_naming_convention/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/analytical_warehouse_no_naming_convention/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/analytical_warehouse_no_naming_convention/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/chinook_with_declared_metadata/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/chinook_with_declared_metadata/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/chinook_with_declared_metadata/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/composite_keys_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/composite_keys_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/composite_keys_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/composite_keys_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_declared_metadata/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_declared_metadata/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_declared_metadata/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_declared_metadata/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/demo_b2b_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/mixed_case_within_schema_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/mixed_case_within_schema_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/mixed_case_within_schema_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/mixed_case_within_schema_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/natural_keys_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/natural_keys_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/natural_keys_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/natural_keys_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/non_english_naming_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/non_english_naming_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/non_english_naming_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/non_english_naming_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/northwind_with_declared_metadata/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/northwind_with_declared_metadata/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/northwind_with_declared_metadata/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/orbit_style_product_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/orbit_style_product_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/orbit_style_product_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/orbit_style_product_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/plan_code_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/plan_code_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/plan_code_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/plan_code_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/polymorphic_partial_overlap_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/polymorphic_partial_overlap_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/polymorphic_partial_overlap_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/polymorphic_partial_overlap_no_declared_constraints/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/sakila_with_declared_metadata/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/sakila_with_declared_metadata/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/sakila_with_declared_metadata/snapshot.json`
- `packages/cli/test/fixtures/relationship-benchmarks/scale_stress_no_declared_constraints/data.sqlite.gz`
- `packages/cli/test/fixtures/relationship-benchmarks/scale_stress_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/scale_stress_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/scale_stress_no_declared_constraints/snapshot.json.gz`
- `packages/cli/test/fixtures/relationship-benchmarks/semantic_embedding_aliases_no_declared_constraints/column-embeddings.json`
- `packages/cli/test/fixtures/relationship-benchmarks/semantic_embedding_aliases_no_declared_constraints/data.sqlite`
- `packages/cli/test/fixtures/relationship-benchmarks/semantic_embedding_aliases_no_declared_constraints/expected-links.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/semantic_embedding_aliases_no_declared_constraints/fixture.yaml`
- `packages/cli/test/fixtures/relationship-benchmarks/semantic_embedding_aliases_no_declared_constraints/snapshot.json`
- `packages/cli/test/index.test.ts`
- `packages/cli/test/ingest-query-executor-federated.test.ts`
- `packages/cli/test/ingest-query-executor.test.ts`
- `packages/cli/test/ingest-report-file.test.ts`
- `packages/cli/test/ingest-viz.test.ts`
- `packages/cli/test/ingest.test-utils.ts`
- `packages/cli/test/ingest.test.ts`
- `packages/cli/test/io/logger.test.ts`
- `packages/cli/test/io/mode.test.ts`
- `packages/cli/test/io/print-list.test.ts`
- `packages/cli/test/io/tty.test.ts`
- `packages/cli/test/knowledge.test.ts`
- `packages/cli/test/llm/embedding-health.test.ts`
- `packages/cli/test/llm/embedding-provider.test.ts`
- `packages/cli/test/llm/message-builder.test.ts`
- `packages/cli/test/llm/model-health.test.ts`
- `packages/cli/test/llm/model-provider.test.ts`
- `packages/cli/test/llm/repair.test.ts`
- `packages/cli/test/local-adapters.test.ts`
- `packages/cli/test/local-scan-connectors.test.ts`
- `packages/cli/test/managed-local-embeddings.test.ts`
- `packages/cli/test/managed-mcp-daemon.test.ts`
- `packages/cli/test/managed-python-command.test.ts`
- `packages/cli/test/managed-python-daemon.test.ts`
- `packages/cli/test/managed-python-http.test.ts`
- `packages/cli/test/managed-python-runtime.test.ts`
- `packages/cli/test/mcp-http-server.test.ts`
- `packages/cli/test/mcp-server-factory.test.ts`
- `packages/cli/test/memory-flow-interactive.test.ts`
- `packages/cli/test/memory-flow-tui.test.tsx`
- `packages/cli/test/next-steps.test.ts`
- `packages/cli/test/notion-page-picker.test.ts`
- `packages/cli/test/print-command-tree.test.ts`
- `packages/cli/test/progress-port-adapter.test.ts`
- `packages/cli/test/project-dir.test.ts`
- `packages/cli/test/project-resolver.test.ts`
- `packages/cli/test/prompt-navigation.test.ts`
- `packages/cli/test/proxy-env.test.ts`
- `packages/cli/test/public-ingest-copy.test.ts`
- `packages/cli/test/public-ingest.test.ts`
- `packages/cli/test/reveal-password-prompt.test.ts`
- `packages/cli/test/runtime-requirements.test.ts`
- `packages/cli/test/runtime.test.ts`
- `packages/cli/test/scan.test.ts`
- `packages/cli/test/setup-agents.test.ts`
- `packages/cli/test/setup-banner.test.ts`
- `packages/cli/test/setup-context.test.ts`
- `packages/cli/test/setup-databases-federation-notice.test.ts`
- `packages/cli/test/setup-databases.test.ts`
- `packages/cli/test/setup-demo-tour.test.ts`
- `packages/cli/test/setup-embeddings.test.ts`
- `packages/cli/test/setup-interrupt.test.ts`
- `packages/cli/test/setup-models.test.ts`
- `packages/cli/test/setup-project.test.ts`
- `packages/cli/test/setup-prompts-tab-toggle.test.ts`
- `packages/cli/test/setup-prompts.test.ts`
- `packages/cli/test/setup-ready-menu.test.ts`
- `packages/cli/test/setup-runtime.test.ts`
- `packages/cli/test/setup-secrets.test.ts`
- `packages/cli/test/setup-sources-notion.test.ts`
- `packages/cli/test/setup-sources.test.ts`
- `packages/cli/test/setup.test.ts`
- `packages/cli/test/sl.test.ts`
- `packages/cli/test/source-mapping.test.ts`
- `packages/cli/test/sql-federated.integration.test.ts`
- `packages/cli/test/sql.test.ts`
- `packages/cli/test/standalone-smoke.test.ts`
- `packages/cli/test/star-prompt/cache.test.ts`
- `packages/cli/test/star-prompt/star-count.test.ts`
- `packages/cli/test/star-prompt/star-line.test.ts`
- `packages/cli/test/status-project.test.ts`
- `packages/cli/test/telemetry/command-hook.test.ts`
- `packages/cli/test/telemetry/demo-detect.test.ts`
- `packages/cli/test/telemetry/emitter.test.ts`
- `packages/cli/test/telemetry/events.snapshot.test.ts`
- `packages/cli/test/telemetry/events.test.ts`
- `packages/cli/test/telemetry/exception-payload.test.ts`
- `packages/cli/test/telemetry/exception.test.ts`
- `packages/cli/test/telemetry/identity.test.ts`
- `packages/cli/test/telemetry/index.test.ts`
- `packages/cli/test/telemetry/project-snapshot.test.ts`
- `packages/cli/test/telemetry/redaction-secrets.test.ts`
- `packages/cli/test/telemetry/schema-writer.test.ts`
- `packages/cli/test/telemetry/scrubber.test.ts`
- `packages/cli/test/text-ingest.test.ts`
- `packages/cli/test/tree-picker-state.test.ts`
- `packages/cli/test/tree-picker-tui.test.tsx`
- `packages/cli/test/update-check/cache.test.ts`
- `packages/cli/test/update-check/channel.test.ts`
- `packages/cli/test/update-check/cli-program.test.ts`
- `packages/cli/test/update-check/registry.test.ts`
- `packages/cli/test/update-check/update-check.test.ts`
- `packages/cli/test/viz-fallback.test.ts`
- `packages/cli/tsconfig.json`
- `packages/cli/tsconfig.test.json`
- `packages/cli/vitest.config.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `pyproject.toml`
- `python/ktx-daemon/README.md`
- `python/ktx-daemon/pyproject.toml`
- `python/ktx-daemon/src/ktx_daemon/__init__.py`
- `python/ktx-daemon/src/ktx_daemon/__main__.py`
- `python/ktx-daemon/src/ktx_daemon/app.py`
- `python/ktx-daemon/src/ktx_daemon/code_execution.py`
- `python/ktx-daemon/src/ktx_daemon/database_introspection.py`
- `python/ktx-daemon/src/ktx_daemon/embeddings.py`
- `python/ktx-daemon/src/ktx_daemon/lookml.py`
- `python/ktx-daemon/src/ktx_daemon/semantic_layer.py`
- `python/ktx-daemon/src/ktx_daemon/source_generation.py`
- `python/ktx-daemon/src/ktx_daemon/sql_analysis.py`
- `python/ktx-daemon/src/ktx_daemon/table_identifier.py`
- `python/ktx-daemon/src/ktx_daemon/telemetry/__init__.py`
- `python/ktx-daemon/src/ktx_daemon/telemetry/daemon_lifecycle.py`
- `python/ktx-daemon/src/ktx_daemon/telemetry/emitter.py`
- `python/ktx-daemon/src/ktx_daemon/telemetry/events.py`
- `python/ktx-daemon/src/ktx_daemon/telemetry/events.schema.json`
- `python/ktx-daemon/src/ktx_daemon/telemetry/exception.py`
- `python/ktx-daemon/src/ktx_daemon/telemetry/identity.py`
- `python/ktx-daemon/tests/test_app.py`
- `python/ktx-daemon/tests/test_cli.py`
- `python/ktx-daemon/tests/test_code_execution.py`
- `python/ktx-daemon/tests/test_database_introspection.py`
- `python/ktx-daemon/tests/test_embeddings.py`
- `python/ktx-daemon/tests/test_exception_payload.py`
- `python/ktx-daemon/tests/test_exception_telemetry.py`
- `python/ktx-daemon/tests/test_lookml.py`
- `python/ktx-daemon/tests/test_package.py`
- `python/ktx-daemon/tests/test_semantic_layer.py`
- `python/ktx-daemon/tests/test_source_generation.py`
- `python/ktx-daemon/tests/test_sql_analysis.py`
- `python/ktx-daemon/tests/test_telemetry.py`
- `python/ktx-daemon/tests/test_telemetry_schema_sync.py`
- `python/ktx-sl/AGENTS.md`
- `python/ktx-sl/CLAUDE.md`
- `python/ktx-sl/README.md`
- `python/ktx-sl/demos/complex_cte_join.yaml`
- `python/ktx-sl/demos/run_complex_cte_join.sh`
- `python/ktx-sl/pyproject.toml`
- `python/ktx-sl/scripts/gen_b2b_saas_model.py`
- `python/ktx-sl/scripts/slquery.py`
- `python/ktx-sl/scripts/tpch_runner.py`
- `python/ktx-sl/semantic_layer/__init__.py`
- `python/ktx-sl/semantic_layer/__main__.py`
- `python/ktx-sl/semantic_layer/cli.py`
- `python/ktx-sl/semantic_layer/duplicate_check.py`
- `python/ktx-sl/semantic_layer/engine.py`
- `python/ktx-sl/semantic_layer/generator.py`
- `python/ktx-sl/semantic_layer/graph.py`
- `python/ktx-sl/semantic_layer/loader.py`
- `python/ktx-sl/semantic_layer/manifest.py`
- `python/ktx-sl/semantic_layer/models.py`
- `python/ktx-sl/semantic_layer/parser.py`
- `python/ktx-sl/semantic_layer/planner.py`
- `python/ktx-sl/semantic_layer/sql_table_extractor.py`
- `python/ktx-sl/semantic_layer/table_identifier_parser.py`
- `python/ktx-sl/sources/b2b_saas/abm_engagements.yaml`
- `python/ktx-sl/sources/b2b_saas/account_intent_signals.yaml`
- `python/ktx-sl/sources/b2b_saas/accounts.yaml`
- `python/ktx-sl/sources/b2b_saas/activities.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_accounts.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_ad_stats.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_campaigns.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_creative_stats.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_creatives.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_groups.yaml`
- `python/ktx-sl/sources/b2b_saas/ad_stats.yaml`
- `python/ktx-sl/sources/b2b_saas/ads.yaml`
- `python/ktx-sl/sources/b2b_saas/ap_bills.yaml`
- `python/ktx-sl/sources/b2b_saas/approvals.yaml`
- `python/ktx-sl/sources/b2b_saas/attribution_credits.yaml`
- `python/ktx-sl/sources/b2b_saas/budgets.yaml`
- `python/ktx-sl/sources/b2b_saas/calls.yaml`
- `python/ktx-sl/sources/b2b_saas/campaign_members.yaml`
- `python/ktx-sl/sources/b2b_saas/campaigns.yaml`
- `python/ktx-sl/sources/b2b_saas/card_transactions.yaml`
- `python/ktx-sl/sources/b2b_saas/cash_balances.yaml`
- `python/ktx-sl/sources/b2b_saas/charges.yaml`
- `python/ktx-sl/sources/b2b_saas/churn_risk.yaml`
- `python/ktx-sl/sources/b2b_saas/contacts.yaml`
- `python/ktx-sl/sources/b2b_saas/content_assets.yaml`
- `python/ktx-sl/sources/b2b_saas/content_touches.yaml`
- `python/ktx-sl/sources/b2b_saas/contracts.yaml`
- `python/ktx-sl/sources/b2b_saas/crm_notes.yaml`
- `python/ktx-sl/sources/b2b_saas/currencies.yaml`
- `python/ktx-sl/sources/b2b_saas/departments_hr.yaml`
- `python/ktx-sl/sources/b2b_saas/disputes.yaml`
- `python/ktx-sl/sources/b2b_saas/email_events.yaml`
- `python/ktx-sl/sources/b2b_saas/email_sends.yaml`
- `python/ktx-sl/sources/b2b_saas/employees.yaml`
- `python/ktx-sl/sources/b2b_saas/etl_runs.yaml`
- `python/ktx-sl/sources/b2b_saas/fiscal_calendar.yaml`
- `python/ktx-sl/sources/b2b_saas/forecast_snapshots.yaml`
- `python/ktx-sl/sources/b2b_saas/fx_rates.yaml`
- `python/ktx-sl/sources/b2b_saas/ga4_event_params.yaml`
- `python/ktx-sl/sources/b2b_saas/ga4_events.yaml`
- `python/ktx-sl/sources/b2b_saas/gl_accounts.yaml`
- `python/ktx-sl/sources/b2b_saas/identities.yaml`
- `python/ktx-sl/sources/b2b_saas/identity_links.yaml`
- `python/ktx-sl/sources/b2b_saas/invoice_lines.yaml`
- `python/ktx-sl/sources/b2b_saas/invoices.yaml`
- `python/ktx-sl/sources/b2b_saas/journal_entries.yaml`
- `python/ktx-sl/sources/b2b_saas/journal_lines.yaml`
- `python/ktx-sl/sources/b2b_saas/keyword_rankings.yaml`
- `python/ktx-sl/sources/b2b_saas/lead_status_history.yaml`
- `python/ktx-sl/sources/b2b_saas/leads.yaml`
- `python/ktx-sl/sources/b2b_saas/meeting_bookings.yaml`
- `python/ktx-sl/sources/b2b_saas/open_roles.yaml`
- `python/ktx-sl/sources/b2b_saas/opportunities.yaml`
- `python/ktx-sl/sources/b2b_saas/opportunity_contact_roles.yaml`
- `python/ktx-sl/sources/b2b_saas/opportunity_line_items.yaml`
- `python/ktx-sl/sources/b2b_saas/opportunity_stage_history.yaml`
- `python/ktx-sl/sources/b2b_saas/payment_intents.yaml`
- `python/ktx-sl/sources/b2b_saas/payments.yaml`
- `python/ktx-sl/sources/b2b_saas/payroll_runs.yaml`
- `python/ktx-sl/sources/b2b_saas/pricebook_entries.yaml`
- `python/ktx-sl/sources/b2b_saas/pricebooks.yaml`
- `python/ktx-sl/sources/b2b_saas/product_costs.yaml`
- `python/ktx-sl/sources/b2b_saas/product_usage.yaml`
- `python/ktx-sl/sources/b2b_saas/products.yaml`
- `python/ktx-sl/sources/b2b_saas/quotas.yaml`
- `python/ktx-sl/sources/b2b_saas/quote_line_items.yaml`
- `python/ktx-sl/sources/b2b_saas/quotes.yaml`
- `python/ktx-sl/sources/b2b_saas/refunds.yaml`
- `python/ktx-sl/sources/b2b_saas/revenue_schedules.yaml`
- `python/ktx-sl/sources/b2b_saas/reverse_etl_jobs.yaml`
- `python/ktx-sl/sources/b2b_saas/sales_reps.yaml`
- `python/ktx-sl/sources/b2b_saas/sales_teams.yaml`
- `python/ktx-sl/sources/b2b_saas/search_console_stats.yaml`
- `python/ktx-sl/sources/b2b_saas/sequence_enrollments.yaml`
- `python/ktx-sl/sources/b2b_saas/sequence_steps.yaml`
- `python/ktx-sl/sources/b2b_saas/sequence_touches.yaml`
- `python/ktx-sl/sources/b2b_saas/sequences.yaml`
- `python/ktx-sl/sources/b2b_saas/stage_weights.yaml`
- `python/ktx-sl/sources/b2b_saas/subscription_items.yaml`
- `python/ktx-sl/sources/b2b_saas/subscriptions.yaml`
- `python/ktx-sl/sources/b2b_saas/support_tickets.yaml`
- `python/ktx-sl/sources/b2b_saas/target_accounts.yaml`
- `python/ktx-sl/sources/b2b_saas/touchpoints.yaml`
- `python/ktx-sl/sources/b2b_saas/vendors.yaml`
- `python/ktx-sl/sources/b2b_saas/web_events.yaml`
- `python/ktx-sl/sources/b2b_saas/web_sessions.yaml`
- `python/ktx-sl/sources/b2b_saas/webinar_attendance.yaml`
- `python/ktx-sl/sources/b2b_saas/webinar_registrations.yaml`
- `python/ktx-sl/sources/b2b_saas/webinars.yaml`
- `python/ktx-sl/sources/ecommerce/churn_risk.yaml`
- `python/ktx-sl/sources/ecommerce/customers.yaml`
- `python/ktx-sl/sources/ecommerce/order_items.yaml`
- `python/ktx-sl/sources/ecommerce/orders.yaml`
- `python/ktx-sl/sources/ecommerce/products.yaml`
- `python/ktx-sl/sources/ecommerce/regions.yaml`
- `python/ktx-sl/sources/tpch/customer.yaml`
- `python/ktx-sl/sources/tpch/lineitem.yaml`
- `python/ktx-sl/sources/tpch/nation.yaml`
- `python/ktx-sl/sources/tpch/orders.yaml`
- `python/ktx-sl/sources/tpch/part.yaml`
- `python/ktx-sl/sources/tpch/partsupp.yaml`
- `python/ktx-sl/sources/tpch/region.yaml`
- `python/ktx-sl/sources/tpch/supplier.yaml`
- `python/ktx-sl/tests/__init__.py`
- `python/ktx-sl/tests/conftest.py`
- `python/ktx-sl/tests/test_aggregate_locality.py`
- `python/ktx-sl/tests/test_cli.py`
- `python/ktx-sl/tests/test_computed_columns.py`
- `python/ktx-sl/tests/test_corner_case_regressions.py`
- `python/ktx-sl/tests/test_coverage_gaps.py`
- `python/ktx-sl/tests/test_duplicate_check.py`
- `python/ktx-sl/tests/test_engine.py`
- `python/ktx-sl/tests/test_generator.py`
- `python/ktx-sl/tests/test_graph.py`
- `python/ktx-sl/tests/test_loader.py`
- `python/ktx-sl/tests/test_manifest.py`
- `python/ktx-sl/tests/test_models.py`
- `python/ktx-sl/tests/test_parser.py`
- `python/ktx-sl/tests/test_planner.py`
- `python/ktx-sl/tests/test_segments.py`
- `python/ktx-sl/tests/test_snowflake.py`
- `python/ktx-sl/tests/test_sql_join_coverage.py`
- `python/ktx-sl/tests/test_table_identifier_parser.py`
- `python/ktx-sl/tests/test_tpch.py`
- `python/ktx-sl/tests/test_tsql_filter_alias_regression.py`
- `python/ktx-sl/tests/test_validator.py`
- `release-policy.json`
- `scripts/acquire-public-benchmark-fixtures.mjs`
- `scripts/acquire-public-benchmark-fixtures.test.mjs`
- `scripts/adventureworks-oltp-source.json`
- `scripts/adventureworks-oltp-source.test.mjs`
- `scripts/anti-fixture-conditional.test.mjs`
- `scripts/build-adventureworks-oltp-fixture.mjs`
- `scripts/build-benchmark-snapshot.mjs`
- `scripts/build-benchmark-snapshot.test.mjs`
- `scripts/build-evidence-fusion-adversarial-fixtures.mjs`
- `scripts/build-python-runtime-wheel.mjs`
- `scripts/build-python-runtime-wheel.test.mjs`
- `scripts/check-boundaries.mjs`
- `scripts/check-boundaries.test.mjs`
- `scripts/ci-artifact-upload.test.mjs`
- `scripts/codex-backend-live-smoke.mjs`
- `scripts/codex-backend-live-smoke.test.mjs`
- `scripts/conductor-run.sh`
- `scripts/conductor-scripts.test.mjs`
- `scripts/conductor-setup.sh`
- `scripts/examples-docs.test.mjs`
- `scripts/installed-live-database-smoke.mjs`
- `scripts/installed-live-database-smoke.test.mjs`
- `scripts/ktx-reset.sh`
- `scripts/link-dev-cli.mjs`
- `scripts/link-dev-cli.test.mjs`
- `scripts/local-embeddings-runtime-smoke.mjs`
- `scripts/local-embeddings-runtime-smoke.test.mjs`
- `scripts/normalize-lcov-paths.mjs`
- `scripts/normalize-lcov-paths.test.mjs`
- `scripts/package-artifacts.mjs`
- `scripts/package-artifacts.test.mjs`
- `scripts/pglite-hybrid-search-spike.mjs`
- `scripts/pglite-owner-process-prototype.mjs`
- `scripts/pglite-sl-search-prototype.mjs`
- `scripts/prepare-cli-bin.mjs`
- `scripts/public-benchmark-manifest.json`
- `scripts/public-npm-release-metadata.mjs`
- `scripts/public-npm-release-metadata.test.mjs`
- `scripts/published-package-smoke-config.mjs`
- `scripts/published-package-smoke.mjs`
- `scripts/published-package-smoke.test.mjs`
- `scripts/refresh-uv-manifest.mjs`
- `scripts/refresh-uv-manifest.test.mjs`
- `scripts/relationship-benchmark-report.mjs`
- `scripts/relationship-orbit-verification.mjs`
- `scripts/relationship-orbit-verification.test.mjs`
- `scripts/release-readiness.mjs`
- `scripts/release-readiness.test.mjs`
- `scripts/release-workflow.test.mjs`
- `scripts/run-ktx.mjs`
- `scripts/run-ktx.test.mjs`
- `scripts/semantic-release-config.cjs`
- `scripts/semantic-release-config.test.mjs`
- `scripts/setup-dev.mjs`
- `scripts/setup-dev.test.mjs`
- `scripts/standalone-ci-workflow.test.mjs`
- `scripts/test-tiering.test.mjs`
- `scripts/update-public-release-version.mjs`
- `scripts/update-public-release-version.test.mjs`
- `scripts/upgrade-dependencies.mjs`
- `scripts/upgrade-dependencies.test.mjs`
- `scripts/validate-llm-debug-jsonl.mjs`
- `scripts/validate-llm-debug-jsonl.test.mjs`
- `skills.sh.json`
- `skills/ktx/SKILL.md`
- `skills/ktx/agents/openai.yaml`
- `skills/ktx/troubleshooting.md`
- `tombi.toml`
- `tsconfig.base.json`
- `uv.lock`

## 完整清单：Lucy 有、KTX 无

- `.claude/settings.json`
- `.codex/config.toml`
- `.ktx-ui/eval/latest.json`
- `.ktx-ui/eval/latest.md`
- `.ktx-ui/run-lucy-webui.sh`
- `.ktx/.gitignore`
- `.ktx/db.sqlite`
- `.ktx/db.sqlite-shm`
- `.ktx/db.sqlite-wal`
- `.ktx/mcp.json`
- `.ktx/prompts/.gitkeep`
- `.ktx/prompts/warehouse-knowledge.md`
- `.ktx/setup/state.json`
- `.mcp.json`
- `AGENT_PIPELINE.md`
- `docs/DEVELOPMENT.md`
- `docs/design-agent-permissions.md`
- `docs/design-db-connection.md`
- `docs/design-eval-monitoring.md`
- `docs/design-webui-ui-refresh.md`
- `docs/eval-quiz-conventions.md`
- `docs/kx-security-guardrail-test-process.md`
- `docs/mysql-comment-maintenance.md`
- `docs/project-overview.html`
- `docs/project-overview.md`
- `docs/review-module1-agent-permissions.md`
- `docs/review-module2-eval-monitoring.md`
- `docs/uat-agent-permissions.md`
- `docs/uat-module2-eval-monitoring.md`
- `docs/user-guide/asking-better.html`
- `docs/user-guide/assets/user-guide.css`
- `docs/user-guide/concepts.html`
- `docs/user-guide/data-sources.html`
- `docs/user-guide/eval-meta-governance-training.html`
- `docs/user-guide/getting-started.html`
- `docs/user-guide/glossary.html`
- `docs/user-guide/index.html`
- `docs/user-guide/mcp-reference.html`
- `docs/user-guide/permissions.html`
- `docs/user-guide/product-intro.html`
- `docs/user-guide/quickstart-admin.html`
- `docs/user-guide/release-notes.html`
- `docs/user-guide/skills.html`
- `docs/user-guide/troubleshooting.html`
- `docs/user-guide/trust.html`
- `docs/user-guide/webui-guide.html`
- `docs/user-guide/workflows.html`
- `docs/vision.md`
- `docs/webui-feature-map.md`
- `docs/webui-impl-status.md`
- `docs/webui-module-guide.md`
- `evals/kx_financial/eval/kx_financial-eval-cases.yaml`
- `evals/kx_financial/kx_financial-quiz-cases.html`
- `evals/superstore/eval/superstore-eval-cases.yaml`
- `evals/superstore/superstore-quiz-cases.html`
- `ktx.yaml`
- `ktx.yaml.example`
- `lucy-skills/docs/01-spec.md`
- `package-lock.json`
- `raw-sources/.gitkeep`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/connection.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/enrichment/descriptions.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/enrichment/embeddings.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/enrichment/relationship-diagnostics.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/enrichment/relationship-profile.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/enrichment/relationships.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/foreign-keys.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/scan-report.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/tables/Xw.ZGF0YWZvcmFp.c3VwZXJzdG9yZV9vcmRlcnM.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/tables/Xw.ZGF0YWZvcmFp.c3VwZXJzdG9yZV9wZW9wbGU.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/tables/Xw.ZGF0YWZvcmFp.c3VwZXJzdG9yZV9yZXR1cm5z.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-18-055107-local-mqj30fex/warnings.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/connection.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/enrichment/descriptions.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/enrichment/embeddings.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/enrichment/relationship-diagnostics.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/enrichment/relationship-profile.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/enrichment/relationships.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/foreign-keys.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/scan-report.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.a3hfZGltX2NvbXBhbnk.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.a3hfZGltX2ZpbmFuY2lhbF9pdGVt.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.a3hfZmFjdF9maW5hbmNpYWxfYW1vdW50.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.a3hfdndfY2FzaF9mbG93X3N0YXRlbWVudF9kZXRhaWw.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.a3hfdndfYmFsYW5jZV9zaGVldF9kZXRhaWw.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.a3hfdndfaW5jb21lX3N0YXRlbWVudF9kZXRhaWw.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.c3VwZXJzdG9yZV9vcmRlcnM.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.c3VwZXJzdG9yZV9wZW9wbGU.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/tables/Xw.ZGF0YWZvcmFp.c3VwZXJzdG9yZV9yZXR1cm5z.json`
- `raw-sources/mysql-aliyun/live-database/2026-06-20-080147-local-mqm2k69r/warnings.json`
- `scripts/eval-runner.mjs`
- `scripts/eval-runner.test.mjs`
- `scripts/lint-spec.mjs`
- `scripts/render-quiz.mjs`
- `scripts/run-eval.sh`
- `semantic-layer/.gitkeep`
- `semantic-layer/mysql-aliyun/_schema/dataforai.yaml`
- `semantic-layer/mysql-aliyun/kx_fact_financial_amount.yaml`
- `semantic-layer/mysql-aliyun/superstore_orders.yaml`
- `skills/.gitkeep`
- `skills/analysis/discount-analysis.md`
- `skills/analysis/profit-decomposition.md`
- `skills/domains/superstore/discount-policy.md`
- `skills/domains/superstore/domain.md`
- `skills/domains/superstore/pitfalls.md`
- `skills/reviewer/SKILL.md`
- `skills/warehouse/SKILL.md`
- `skills/warehouse/references/metrics-policy.md`
- `skills/warehouse/references/table-routing.md`
- `tests/golden/superstore.yaml`
- `webui/.gitignore`
- `webui/README.md`
- `webui/config/access.yaml`
- `webui/docs/01-architecture.md`
- `webui/docs/02-arch-spec.md`
- `webui/docs/03-api-spec.md`
- `webui/docs/04-data-model.md`
- `webui/docs/05-task-list.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/README.md`
- `webui/docs/codex/README.md`
- `webui/docs/codex/progress.md`
- `webui/docs/codex/wo-M0-scaffold.md`
- `webui/docs/codex/wo-M1-readonly-catalog.md`
- `webui/docs/codex/wo-M2-fix-linewidth.md`
- `webui/docs/codex/wo-M2-table-editor-diff.md`
- `webui/docs/codex/wo-M3-save-validate.md`
- `webui/docs/codex/wo-M4-measures-segments-joins.md`
- `webui/docs/codex/wo-M5-wiki.md`
- `webui/docs/user-guide.html`
- `webui/index.html`
- `webui/package-lock.json`
- `webui/package.json`
- `webui/scripts/api-acceptance.ts`
- `webui/server/README.md`
- `webui/server/__tests__/admin-agents.test.ts`
- `webui/server/__tests__/admin-audit.test.ts`
- `webui/server/__tests__/admin-tokens.test.ts`
- `webui/server/__tests__/api.save.test.ts`
- `webui/server/__tests__/completion.test.ts`
- `webui/server/__tests__/eval-api-contract.test.ts`
- `webui/server/__tests__/eval-cases.test.ts`
- `webui/server/__tests__/eval-runner-contract.test.ts`
- `webui/server/__tests__/eval-runs.test.ts`
- `webui/server/__tests__/fs-safe.test.ts`
- `webui/server/__tests__/joins-sidecar.test.ts`
- `webui/server/__tests__/ktx.test.ts`
- `webui/server/__tests__/kx-acl.test.ts`
- `webui/server/__tests__/mcp-proxy-acl.test.ts`
- `webui/server/__tests__/mcp-proxy-smoke.test.ts`
- `webui/server/__tests__/proxy-audit.test.ts`
- `webui/server/__tests__/semantic-layer.measures.test.ts`
- `webui/server/__tests__/semantic-layer.read.test.ts`
- `webui/server/__tests__/semantic-layer.roundtrip.test.ts`
- `webui/server/__tests__/wiki.test.ts`
- `webui/server/admin/agents.ts`
- `webui/server/admin/audit.ts`
- `webui/server/admin/mcp-tools.ts`
- `webui/server/admin/tokens.ts`
- `webui/server/completion.ts`
- `webui/server/diff.ts`
- `webui/server/eval/cases.ts`
- `webui/server/eval/db.ts`
- `webui/server/eval/monitor.ts`
- `webui/server/eval/runner.ts`
- `webui/server/fs-safe.ts`
- `webui/server/index.ts`
- `webui/server/joins-sidecar.ts`
- `webui/server/ktx.ts`
- `webui/server/model.ts`
- `webui/server/overlay.ts`
- `webui/server/project.ts`
- `webui/server/proxy/acl.ts`
- `webui/server/proxy/audit.ts`
- `webui/server/proxy/identity.ts`
- `webui/server/proxy/mcp-proxy.ts`
- `webui/server/semantic-layer.ts`
- `webui/server/wiki.ts`
- `webui/src/README.md`
- `webui/src/__tests__/agent-detail.test.tsx`
- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/audit.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/monitor.test.tsx`
- `webui/src/__tests__/new-token.test.tsx`
- `webui/src/__tests__/review.test.tsx`
- `webui/src/__tests__/table-editor.test.tsx`
- `webui/src/app/.gitkeep`
- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- `webui/src/app/main.tsx`
- `webui/src/components/.gitkeep`
- `webui/src/components/DiffViewer.tsx`
- `webui/src/components/FrontmatterForm.tsx`
- `webui/src/components/MeasureForm.tsx`
- `webui/src/components/SegmentForm.tsx`
- `webui/src/components/SelectField.tsx`
- `webui/src/components/StatusBadge.tsx`
- `webui/src/components/YamlPreview.tsx`
- `webui/src/lib/.gitkeep`
- `webui/src/lib/apiClient.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/types.ts`
- `webui/src/pages/.gitkeep`
- `webui/src/pages/Catalog.tsx`
- `webui/src/pages/JoinEditor.tsx`
- `webui/src/pages/Review.tsx`
- `webui/src/pages/TableEditor.tsx`
- `webui/src/pages/WikiEditor.tsx`
- `webui/src/pages/admin/AgentDetail.tsx`
- `webui/src/pages/admin/AgentList.tsx`
- `webui/src/pages/admin/Audit.tsx`
- `webui/src/pages/admin/AuditSources.tsx`
- `webui/src/pages/admin/ConfigAudit.tsx`
- `webui/src/pages/admin/NewToken.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/ConnectionTest.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/eval/CaseEditor.tsx`
- `webui/src/pages/eval/CaseList.tsx`
- `webui/src/pages/eval/Monitor.tsx`
- `webui/src/pages/eval/RunDetail.tsx`
- `webui/src/pages/eval/RunList.tsx`
- `webui/src/vite-env.d.ts`
- `webui/tsconfig.json`
- `webui/tsconfig.node.json`
- `webui/vite.config.ts`
- `webui/vitest.config.ts`
- `wiki/global/discount-policy.md`
- `wiki/global/kx-financial-analysis-playbook.md`
- `wiki/global/profit-rule.md`
- `wiki/global/return-semantics.md`
- `wiki/global/superstore-analysis-playbook.md`
