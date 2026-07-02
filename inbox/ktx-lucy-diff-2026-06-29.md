# KTX vs Lucy Diff Audit

| Metadata | Value |
|---|---|
| Generated At | 2026-06-29T03:40:21.652Z |
| KTX Root | /Users/forrest/projects/ktx/ktx |
| KTX Git | main@e550091a |
| Lucy Root | /Users/forrest/Projects/project-lucy |
| Lucy Git | main@1478d7f |
| Exclusions | .git, .DS_Store, node_modules, dist, coverage, .venv, __pycache__, .pytest_cache, .mypy_cache, .turbo, .next, .nuxt, .cache; inbox/, temp/, tmp/, .ktx/secrets/, .ktx/cache/, .ktx/logs/, .ktx/runtime/, .ktx-ui/ |

## Summary

| Metric | Count |
|---|---:|
| KTX files scanned | 1573 |
| Lucy files scanned | 332 |
| Same files | 0 |
| Modified files | 5 |
| KTX-only files | 1568 |
| Lucy-only files | 327 |

## Functional Difference Notes

- 以下为基于目录、配置与脚本差异的静态推断，不等同于运行时行为证明。
- Lucy 新增顶层路径：.claude, .codex, .dockerignore, .ktx, .mcp.json, AGENT_PIPELINE.md, Dockerfile, docker-compose.demo.yml, docker-compose.postgres-demo.yml, docker-compose.secrets.yml, docker-compose.yml, evals, ktx.yaml, ktx.yaml.example, lucy-skills, package-lock.json, raw-sources, release, semantic-layer, tests, webui, wiki。
- KTX 上游独有顶层路径：.pre-commit-config.yaml, .releaserc.cjs, CONTRIBUTING.md, GEMINI.md, LICENSE, SECURITY.md, assets, biome.json, codecov.yml, conductor.json, docs-site, knip.json, packages, pnpm-lock.yaml, pnpm-workspace.yaml, pyproject.toml, python, release-policy.json, skills.sh.json, tombi.toml, tsconfig.base.json, uv.lock。
- Lucy 增加 WebUI/API/MCP proxy 管理面，用于承载数据库接入、agent 配置、审计与平台运维流程。
- Lucy 增加业务语义层目录，目标是把客户数据库暴露为可治理的数据问答能力。
- Lucy 增加业务 eval/验收资产，用于验证 agent 面向业务问题的回答质量。
- Lucy 增加 Docker 交付面，镜像内置 pinned KTX runtime，而不是在仓库内 vendor KTX 源码。
- 上游 KTX 的 CI/release/质量发布资产未在 Lucy 仓库等价保留；Lucy 需要以自身 release gates 覆盖产品交付质量。
- 两边 package scripts 已分化：Lucy 增加 eval、spec lint、Docker smoke、business eval 等产品化门禁。

## package.json Script Diff

| script | ktx | lucy | status |
| --- | --- | --- | --- |
| artifacts:build | node scripts/package-artifacts.mjs build |  | ktx-only |
| artifacts:build-runtime | node scripts/package-artifacts.mjs build-runtime |  | ktx-only |
| artifacts:check | node scripts/package-artifacts.mjs check |  | ktx-only |
| artifacts:live-db-smoke | node scripts/installed-live-database-smoke.mjs |  | ktx-only |
| artifacts:verify | node scripts/package-artifacts.mjs verify |  | ktx-only |
| artifacts:verify-demo | node scripts/package-artifacts.mjs verify-demo |  | ktx-only |
| artifacts:verify-manifest | node scripts/package-artifacts.mjs verify-manifest |  | ktx-only |
| audit:ktx-diff |  | node scripts/ktx-lucy-diff-audit.mjs | lucy-only |
| build | pnpm --filter './packages/*' run build |  | ktx-only |
| check | node scripts/check-boundaries.mjs && node --test scripts/*.test.mjs && pnpm --filter './packages/*' run build && pnpm --filter './packages/*' run test |  | ktx-only |
| compat:ktx-upgrade |  | node scripts/ktx-upgrade-compat.mjs | lucy-only |
| dead-code | pnpm run dead-code:biome && pnpm run dead-code:knip && pnpm run dead-code:knip:production |  | ktx-only |
| dead-code:biome | biome ci . --formatter-enabled=false --assist-enabled=false |  | ktx-only |
| dead-code:fix | biome check . --formatter-enabled=false --assist-enabled=false --write && knip --fix --format |  | ktx-only |
| dead-code:knip | knip --reporter compact |  | ktx-only |
| dead-code:knip:production | knip --production --reporter compact |  | ktx-only |
| deps:upgrade | node scripts/upgrade-dependencies.mjs |  | ktx-only |
| docs | kill $(lsof -ti:3000) 2>/dev/null; pnpm --filter ktx-docs run dev |  | ktx-only |
| eval |  | node scripts/eval-runner.mjs | lucy-only |
| eval:list |  | node scripts/eval-runner.mjs --list-cases | lucy-only |
| ktx | node scripts/run-ktx.mjs |  | ktx-only |
| link:dev | node scripts/link-dev-cli.mjs |  | ktx-only |
| lint:spec |  | node scripts/lint-spec.mjs | lucy-only |
| native:rebuild | pnpm -r rebuild better-sqlite3 |  | ktx-only |
| relationships:acquire-public-fixtures | node scripts/acquire-public-benchmark-fixtures.mjs |  | ktx-only |
| relationships:build-adventureworks-oltp | node scripts/build-adventureworks-oltp-fixture.mjs |  | ktx-only |
| relationships:rebuild-public-snapshots | node scripts/build-benchmark-snapshot.mjs --rebuild-all |  | ktx-only |
| relationships:verify-orbit | node scripts/relationship-orbit-verification.mjs |  | ktx-only |
| release:artifacts |  | node scripts/release-artifacts.mjs | lucy-only |
| release:codex-backend-smoke | node scripts/codex-backend-live-smoke.mjs |  | ktx-only |
| release:local-embeddings-smoke | node scripts/local-embeddings-runtime-smoke.mjs --require-opt-in |  | ktx-only |
| release:published-smoke | node scripts/published-package-smoke.mjs --require-config |  | ktx-only |
| release:readiness | node scripts/release-readiness.mjs |  | ktx-only |
| release:update-version | node scripts/update-public-release-version.mjs |  | ktx-only |
| security:baseline |  | node scripts/security-baseline.mjs | lucy-only |
| semantic-release | semantic-release |  | ktx-only |
| semantic-release:debug | semantic-release --dry-run --debug |  | ktx-only |
| semantic-release:dry-run | semantic-release --dry-run --no-ci |  | ktx-only |
| setup:dev | node scripts/setup-dev.mjs |  | ktx-only |
| smoke | pnpm run build && pnpm --filter @kaelio/ktx run smoke |  | ktx-only |
| smoke:p0 |  | node scripts/p0-smoke.mjs | lucy-only |
| smoke:p0:business-eval |  | node scripts/p0-business-eval-smoke.mjs | lucy-only |
| smoke:p0:customer |  | node scripts/p0-customer-path-smoke.mjs | lucy-only |
| smoke:p0:demo |  | node scripts/p0-demo-docker-smoke.mjs | lucy-only |
| smoke:p0:docker |  | node scripts/p0-smoke.mjs --docker | lucy-only |
| smoke:p0:postgres-demo |  | node scripts/p0-postgres-demo-smoke.mjs | lucy-only |
| test | node --test scripts/*.test.mjs && pnpm --filter './packages/*' run test |  | ktx-only |
| test:coverage | pnpm run test:coverage:ts && pnpm run test:coverage:py |  | ktx-only |
| test:coverage:py | uv run pytest --cov=python/ktx-sl/semantic_layer --cov=python/ktx-daemon/src/ktx_daemon --cov-report=xml:coverage/python.xml --cov-report=term |  | ktx-only |
| test:coverage:ts | pnpm --filter './packages/*' run build && pnpm --filter './packages/*' run test --coverage --coverage.reporter=lcov --coverage.exclude='dist/**' && node scripts/normalize-lcov-paths.mjs packages/*/coverage/lcov.info |  | ktx-only |
| test:slow | pnpm --filter @kaelio/ktx run test:slow |  | ktx-only |
| type-check | pnpm --filter './packages/*' run type-check |  | ktx-only |


## KTX First-Level Folder Diff

| path | ktx type | lucy type | ktx files | lucy files | same | modified | ktx-only | lucy-only | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .github | dir | dir | 7 | 1 | 0 | 0 | 7 | 1 | mostly missing/replaced |
| assets | dir | missing | 5 | 0 | 0 | 0 | 5 | 0 | missing in lucy |
| docs | dir | dir | 3 | 53 | 0 | 0 | 3 | 53 | mostly missing/replaced |
| docs-site | dir | missing | 93 | 0 | 0 | 0 | 93 | 0 | missing in lucy |
| examples | dir | dir | 14 | 17 | 0 | 0 | 14 | 17 | mostly missing/replaced |
| packages | dir | missing | 1179 | 0 | 0 | 0 | 1179 | 0 | missing in lucy |
| python | dir | missing | 183 | 0 | 0 | 0 | 183 | 0 | missing in lucy |
| scripts | dir | dir | 63 | 16 | 0 | 0 | 63 | 16 | mostly missing/replaced |
| skills | dir | dir | 3 | 10 | 0 | 0 | 3 | 10 | mostly missing/replaced |


## KTX Second-Level Folder Diff

| path | ktx type | lucy type | ktx files | lucy files | same | modified | ktx-only | lucy-only | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .github/ISSUE_TEMPLATE | dir | missing | 3 | 0 | 0 | 0 | 3 | 0 | missing in lucy |
| .github/workflows | dir | dir | 4 | 1 | 0 | 0 | 4 | 1 | mostly missing/replaced |
| docs-site/app | dir | missing | 12 | 0 | 0 | 0 | 12 | 0 | missing in lucy |
| docs-site/components | dir | missing | 20 | 0 | 0 | 0 | 20 | 0 | missing in lucy |
| docs-site/content | dir | missing | 38 | 0 | 0 | 0 | 38 | 0 | missing in lucy |
| docs-site/lib | dir | missing | 3 | 0 | 0 | 0 | 3 | 0 | missing in lucy |
| docs-site/public | dir | missing | 8 | 0 | 0 | 0 | 8 | 0 | missing in lucy |
| docs-site/tests | dir | missing | 4 | 0 | 0 | 0 | 4 | 0 | missing in lucy |
| examples/local-warehouse | dir | missing | 5 | 0 | 0 | 0 | 5 | 0 | missing in lucy |
| examples/orbit-relationship-verification | dir | missing | 2 | 0 | 0 | 0 | 2 | 0 | missing in lucy |
| examples/package-artifacts | dir | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| examples/postgres-historic | dir | missing | 5 | 0 | 0 | 0 | 5 | 0 | missing in lucy |
| packages/cli | dir | missing | 1179 | 0 | 0 | 0 | 1179 | 0 | missing in lucy |
| python/ktx-daemon | dir | missing | 34 | 0 | 0 | 0 | 34 | 0 | missing in lucy |
| python/ktx-sl | dir | missing | 149 | 0 | 0 | 0 | 149 | 0 | missing in lucy |
| skills/ktx | dir | missing | 3 | 0 | 0 | 0 | 3 | 0 | missing in lucy |


## KTX First-Level Path Diff

| path | ktx type | lucy type | ktx files | lucy files | same | modified | ktx-only | lucy-only | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .github | dir | dir | 7 | 1 | 0 | 0 | 7 | 1 | mostly missing/replaced |
| .gitignore | file | file | 1 | 1 | 0 | 1 | 0 | 0 | modified |
| .pre-commit-config.yaml | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| .releaserc.cjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| AGENTS.md | file | file | 1 | 1 | 0 | 1 | 0 | 0 | modified |
| CLAUDE.md | symlink | file | 1 | 1 | 0 | 1 | 0 | 0 | type changed: symlink -> file |
| CONTRIBUTING.md | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| GEMINI.md | symlink | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| LICENSE | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| README.md | file | file | 1 | 1 | 0 | 1 | 0 | 0 | modified |
| SECURITY.md | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| assets | dir | missing | 5 | 0 | 0 | 0 | 5 | 0 | missing in lucy |
| biome.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| codecov.yml | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| conductor.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs | dir | dir | 3 | 53 | 0 | 0 | 3 | 53 | mostly missing/replaced |
| docs-site | dir | missing | 93 | 0 | 0 | 0 | 93 | 0 | missing in lucy |
| examples | dir | dir | 14 | 17 | 0 | 0 | 14 | 17 | mostly missing/replaced |
| knip.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| package.json | file | file | 1 | 1 | 0 | 1 | 0 | 0 | modified |
| packages | dir | missing | 1179 | 0 | 0 | 0 | 1179 | 0 | missing in lucy |
| pnpm-lock.yaml | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| pnpm-workspace.yaml | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| pyproject.toml | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| python | dir | missing | 183 | 0 | 0 | 0 | 183 | 0 | missing in lucy |
| release-policy.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts | dir | dir | 63 | 16 | 0 | 0 | 63 | 16 | mostly missing/replaced |
| skills | dir | dir | 3 | 10 | 0 | 0 | 3 | 10 | mostly missing/replaced |
| skills.sh.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| tombi.toml | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| tsconfig.base.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| uv.lock | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |


## KTX Second-Level Path Diff

| path | ktx type | lucy type | ktx files | lucy files | same | modified | ktx-only | lucy-only | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| .github/ISSUE_TEMPLATE | dir | missing | 3 | 0 | 0 | 0 | 3 | 0 | missing in lucy |
| .github/workflows | dir | dir | 4 | 1 | 0 | 0 | 4 | 1 | mostly missing/replaced |
| assets/ktx-lockup.svg | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| assets/ktx-mascot-dark.svg | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| assets/ktx-mascot.svg | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| assets/launch-video-thumb.png | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| assets/star-history.svg | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/.gitignore | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/app | dir | missing | 12 | 0 | 0 | 0 | 12 | 0 | missing in lucy |
| docs-site/components | dir | missing | 20 | 0 | 0 | 0 | 20 | 0 | missing in lucy |
| docs-site/content | dir | missing | 38 | 0 | 0 | 0 | 38 | 0 | missing in lucy |
| docs-site/lib | dir | missing | 3 | 0 | 0 | 0 | 3 | 0 | missing in lucy |
| docs-site/next-env.d.ts | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/next.config.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/package.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/postcss.config.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/proxy.ts | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/public | dir | missing | 8 | 0 | 0 | 0 | 8 | 0 | missing in lucy |
| docs-site/source.config.ts | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs-site/tests | dir | missing | 4 | 0 | 0 | 0 | 4 | 0 | missing in lucy |
| docs-site/tsconfig.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs/code-design.md | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs/release.md | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| docs/terminology.md | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| examples/README.md | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| examples/local-warehouse | dir | missing | 5 | 0 | 0 | 0 | 5 | 0 | missing in lucy |
| examples/orbit-relationship-verification | dir | missing | 2 | 0 | 0 | 0 | 2 | 0 | missing in lucy |
| examples/package-artifacts | dir | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| examples/postgres-historic | dir | missing | 5 | 0 | 0 | 0 | 5 | 0 | missing in lucy |
| packages/cli | dir | missing | 1179 | 0 | 0 | 0 | 1179 | 0 | missing in lucy |
| python/ktx-daemon | dir | missing | 34 | 0 | 0 | 0 | 34 | 0 | missing in lucy |
| python/ktx-sl | dir | missing | 149 | 0 | 0 | 0 | 149 | 0 | missing in lucy |
| scripts/acquire-public-benchmark-fixtures.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/acquire-public-benchmark-fixtures.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/adventureworks-oltp-source.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/adventureworks-oltp-source.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/anti-fixture-conditional.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/build-adventureworks-oltp-fixture.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/build-benchmark-snapshot.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/build-benchmark-snapshot.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/build-evidence-fusion-adversarial-fixtures.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/build-python-runtime-wheel.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/build-python-runtime-wheel.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/check-boundaries.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/check-boundaries.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/ci-artifact-upload.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/codex-backend-live-smoke.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/codex-backend-live-smoke.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/conductor-run.sh | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/conductor-scripts.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/conductor-setup.sh | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/examples-docs.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/installed-live-database-smoke.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/installed-live-database-smoke.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/ktx-reset.sh | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/link-dev-cli.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/link-dev-cli.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/local-embeddings-runtime-smoke.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/local-embeddings-runtime-smoke.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/normalize-lcov-paths.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/normalize-lcov-paths.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/package-artifacts.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/package-artifacts.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/pglite-hybrid-search-spike.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/pglite-owner-process-prototype.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/pglite-sl-search-prototype.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/prepare-cli-bin.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/public-benchmark-manifest.json | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/public-npm-release-metadata.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/public-npm-release-metadata.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/published-package-smoke-config.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/published-package-smoke.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/published-package-smoke.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/refresh-uv-manifest.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/refresh-uv-manifest.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/relationship-benchmark-report.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/relationship-orbit-verification.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/relationship-orbit-verification.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/release-readiness.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/release-readiness.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/release-workflow.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/run-ktx.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/run-ktx.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/semantic-release-config.cjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/semantic-release-config.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/setup-dev.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/setup-dev.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/standalone-ci-workflow.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/test-tiering.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/update-public-release-version.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/update-public-release-version.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/upgrade-dependencies.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/upgrade-dependencies.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/validate-llm-debug-jsonl.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| scripts/validate-llm-debug-jsonl.test.mjs | file | missing | 1 | 0 | 0 | 0 | 1 | 0 | missing in lucy |
| skills/ktx | dir | missing | 3 | 0 | 0 | 0 | 3 | 0 | missing in lucy |


## Lucy Added First-Level Paths

| path | lucy type |
| --- | --- |
| .claude | dir |
| .codex | dir |
| .dockerignore | file |
| .ktx | dir |
| .mcp.json | file |
| AGENT_PIPELINE.md | file |
| Dockerfile | file |
| docker-compose.demo.yml | file |
| docker-compose.postgres-demo.yml | file |
| docker-compose.secrets.yml | file |
| docker-compose.yml | file |
| evals | dir |
| ktx.yaml | file |
| ktx.yaml.example | file |
| lucy-skills | dir |
| package-lock.json | file |
| raw-sources | dir |
| release | dir |
| semantic-layer | dir |
| tests | dir |
| webui | dir |
| wiki | dir |


## Modified File Samples

| path |
| --- |
| .gitignore |
| AGENTS.md |
| CLAUDE.md |
| README.md |
| package.json |


## KTX-Only File Samples

| path |
| --- |
| .github/ISSUE_TEMPLATE/bug_report.yml |
| .github/ISSUE_TEMPLATE/config.yml |
| .github/ISSUE_TEMPLATE/feature_request.yml |
| .github/workflows/ci.yml |
| .github/workflows/release.yml |
| .github/workflows/star-history.yml |
| .github/workflows/triage-issues.yml |
| .pre-commit-config.yaml |
| .releaserc.cjs |
| CONTRIBUTING.md |
| GEMINI.md |
| LICENSE |
| SECURITY.md |
| assets/ktx-lockup.svg |
| assets/ktx-mascot-dark.svg |
| assets/ktx-mascot.svg |
| assets/launch-video-thumb.png |
| assets/star-history.svg |
| biome.json |
| codecov.yml |
| conductor.json |
| docs-site/.gitignore |
| docs-site/app/(home)/layout.tsx |
| docs-site/app/(home)/page.tsx |
| docs-site/app/api/search/route.ts |
| docs-site/app/diagram-studio/page.tsx |
| docs-site/app/docs/[[...slug]]/page.tsx |
| docs-site/app/docs/layout.tsx |
| docs-site/app/global.css |
| docs-site/app/layout.config.tsx |
| docs-site/app/layout.tsx |
| docs-site/app/llms-full.txt/route.ts |
| docs-site/app/llms.mdx/docs/[[...slug]]/route.ts |
| docs-site/app/llms.txt/route.ts |
| docs-site/components/code-block.tsx |
| docs-site/components/context-review-loop.tsx |
| docs-site/components/copy-button.tsx |
| docs-site/components/diagram-studio/flows.ts |
| docs-site/components/diagram-studio/mascot.tsx |
| docs-site/components/diagram-studio/nodes.tsx |
| docs-site/components/diagram-studio/studio.tsx |
| docs-site/components/docs-page-actions.tsx |
| docs-site/components/flow-canvas.tsx |
| docs-site/components/git-icon.tsx |
| docs-site/components/github-icon.tsx |
| docs-site/components/github-stars.tsx |
| docs-site/components/logo.tsx |
| docs-site/components/product-mechanics.tsx |
| docs-site/components/product-runtime.tsx |
| docs-site/components/scroll-reveal.tsx |
| docs-site/components/semantic-layer-flow.tsx |
| docs-site/components/slack-icon.tsx |
| docs-site/components/terminal-preview.tsx |
| docs-site/components/theme-toggle.tsx |
| docs-site/content/docs/cli-reference/ktx-admin.mdx |
| docs-site/content/docs/cli-reference/ktx-completion.mdx |
| docs-site/content/docs/cli-reference/ktx-connection.mdx |
| docs-site/content/docs/cli-reference/ktx-ingest.mdx |
| docs-site/content/docs/cli-reference/ktx-mcp.mdx |
| docs-site/content/docs/cli-reference/ktx-setup.mdx |
| docs-site/content/docs/cli-reference/ktx-sl.mdx |
| docs-site/content/docs/cli-reference/ktx-sql.mdx |
| docs-site/content/docs/cli-reference/ktx-status.mdx |
| docs-site/content/docs/cli-reference/ktx-wiki.mdx |
| docs-site/content/docs/cli-reference/ktx.mdx |
| docs-site/content/docs/cli-reference/meta.json |
| docs-site/content/docs/community/ai-resources.mdx |
| docs-site/content/docs/community/contributing.mdx |
| docs-site/content/docs/community/meta.json |
| docs-site/content/docs/community/support.mdx |
| docs-site/content/docs/community/telemetry.mdx |
| docs-site/content/docs/concepts/cross-database-federation.mdx |
| docs-site/content/docs/concepts/meta.json |
| docs-site/content/docs/concepts/semantic-layer-internals.mdx |
| docs-site/content/docs/concepts/the-context-layer.mdx |
| docs-site/content/docs/concepts/wiki-retrieval.mdx |
| docs-site/content/docs/configuration/ktx-yaml.mdx |
| docs-site/content/docs/configuration/meta.json |
| docs-site/content/docs/getting-started/introduction.mdx |
| docs-site/content/docs/getting-started/meta.json |

_Only first 80 of 1568 rows shown._


## Lucy-Only File Samples

| path |
| --- |
| .claude/settings.json |
| .codex/config.toml |
| .codex/hooks.json |
| .dockerignore |
| .github/workflows/lucy-release.yml |
| .ktx/.gitignore |
| .ktx/db.sqlite |
| .ktx/db.sqlite-shm |
| .ktx/db.sqlite-wal |
| .ktx/mcp.json |
| .ktx/prompts/.gitkeep |
| .ktx/setup/state.json |
| .mcp.json |
| AGENT_PIPELINE.md |
| Dockerfile |
| docker-compose.demo.yml |
| docker-compose.postgres-demo.yml |
| docker-compose.secrets.yml |
| docker-compose.yml |
| docs/DEVELOPMENT.md |
| docs/README.md |
| docs/access-governance-design.md |
| docs/admin-guide.md |
| docs/agent-integration-guide.md |
| docs/customer-deployment-guide.md |
| docs/deployment-docker.md |
| docs/design-agent-permissions.md |
| docs/design-db-connection.md |
| docs/design-eval-monitoring.md |
| docs/design-eval-tool-budget.md |
| docs/design-webui-ui-refresh.md |
| docs/eval-quiz-conventions.md |
| docs/kx-security-guardrail-test-process.md |
| docs/lucy-platform-goal-checklist.md |
| docs/lucy-test-cases.md |
| docs/mysql-comment-maintenance.md |
| docs/product-docs-index.md |
| docs/project-overview.md |
| docs/release-ci.md |
| docs/review-ktx-llm-switch-to-minimax.md |
| docs/review-module1-agent-permissions.md |
| docs/review-module2-eval-monitoring.md |
| docs/security-guide.md |
| docs/test-layers-and-release-gates.md |
| docs/troubleshooting-guide.md |
| docs/uat-agent-permissions.md |
| docs/uat-module2-eval-monitoring.md |
| docs/uat-mysql-aliyun-data-qa.md |
| docs/user-guide.md |
| docs/user-guide/asking-better.html |
| docs/user-guide/assets/user-guide.css |
| docs/user-guide/concepts.html |
| docs/user-guide/data-sources.html |
| docs/user-guide/eval-meta-governance-training.html |
| docs/user-guide/getting-started.html |
| docs/user-guide/glossary.html |
| docs/user-guide/index.html |
| docs/user-guide/mcp-reference.html |
| docs/user-guide/permissions.html |
| docs/user-guide/product-intro.html |
| docs/user-guide/quickstart-admin.html |
| docs/user-guide/release-notes.html |
| docs/user-guide/skills.html |
| docs/user-guide/troubleshooting.html |
| docs/user-guide/trust.html |
| docs/user-guide/webui-guide.html |
| docs/user-guide/workflows.html |
| docs/version-matrix.md |
| docs/vision.md |
| docs/webui-feature-map.md |
| docs/webui-impl-status.md |
| docs/webui-module-guide.md |
| evals/kx_financial/eval/kx_financial-eval-cases.yaml |
| evals/kx_financial/kx_financial-quiz-cases.html |
| evals/superstore/eval/superstore-eval-cases.yaml |
| evals/superstore/superstore-quiz-cases.html |
| examples/docker-demo/README.md |
| examples/docker-demo/mysql/01-init.sql |
| examples/docker-demo/mysql/_baseline.json |
| examples/docker-demo/project-template/ktx.yaml |

_Only first 80 of 327 rows shown._


## Reproduction

```bash
npm run audit:ktx-diff -- --ktx /Users/forrest/projects/ktx/ktx --lucy /Users/forrest/Projects/project-lucy --out /Users/forrest/Projects/project-lucy/inbox/ktx-lucy-diff-2026-06-29.md
```
