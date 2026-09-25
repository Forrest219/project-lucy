# 仓库目录重组计划（2026-09-25）

| 元数据 | 内容 |
|---|---|
| 文档类型 | Plan |
| 日期 | 2026-09-25 |
| 状态 | 已批准（3 项决策已确认） |
| 范围 | project-lucy 一级、二级目录重组 |

## 背景与目标

随功能迭代，仓库根目录平铺了 ktx 项目内容、spec、webui、skill、inbox 临时目录、k8s 交付物等 30+ 条目。
目标：在不影响 Lucy 正常启动、不影响客户平滑升级的前提下，重组一级与二级目录。

## 硬约束（不动的条目）

1. **仓库根 = 开发态 KTX 项目根**：`webui/server/project.ts` 向上查找 `ktx.yaml`；
   `webui/server/fs-safe.ts:4-5` 硬编码 `ALLOW = [semantic-layer, evals, skills, wiki, .ktx-ui, webui/config]`、
   `DENY = [.ktx/secrets, raw-sources, .git]`。
   → `semantic-layer/ wiki/ skills/ evals/ raw-sources/ .ktx/ ktx.yaml.example` 保留根目录。
2. **镜像构建契约**：`Dockerfile` COPY `scripts/`（entrypoint/healthcheck/patch 三件）、
   `customer-config.example/`（客户种子 → `/app/project-template`）、`webui/`、`package*.json`、`VERSION`。
3. **客户升级路径与仓库结构无关**（运行时全在 `/data/lucy` 卷与镜像内）；影响面仅开发者与 CI，
   每阶段内原子更新引用即可。
4. 主 `docker-compose.yml`、`Dockerfile`、`package*.json`、`VERSION`、`README/AGENTS/CLAUDE.md`、
   `.env.example` 保留根目录。

## 已确认决策

1. scripts/ **全量**迁入 7 个二级分组。
2. `agents/` 目录不存在 → **删除** `AGENT_PIPELINE.md`、`AGENTS.md`、`docs/governance/DEVELOPMENT.md` 中的相关引用。
3. docs/ 二级分类**纳入本期**（Phase 3）。
4. `agent-chat/` 本期不动（自包含可选 sidecar，收益低）。

## 一级目录变更

| 条目 | 去向 | 需同步更新 |
|---|---|---|
| 10 个非主 `docker-compose.*.yml` | `deploy/compose/` | package.json 3 条、upgrade-lucy.sh、assemble-upgrade-uat-config.sh、.dockerignore、相关 docs |
| `scratch/`（2 个 HTML） | 并入 `inbox/`，删除 scratch/ | .gitignore |
| `lucy-skills/docs/01-spec.md` | `docs/specs/lucy-skills-mcp-spec.md`，删除 lucy-skills/ | .mcp.json 注释、README |
| `tests/golden/superstore.yaml` | `evals/golden/superstore.yaml`，删除 tests/ | docs/webui/webui-snapshot-product.md:32 |
| `AGENT_PIPELINE.md` | `docs/agent-pipeline.md` | README、AGENTS.md |

## 二级目录变更

### scripts/（114 项 → 7 组）

- `runtime/`：docker-entrypoint.sh、docker-healthcheck.sh、patch-ktx-mysql-starrocks-compat.js（+测试）——镜像契约
- `gates/`：k8s-*、helm-lucy-gate、g8-image-*、verify-k8s-package、p0-smoke、p1-release-readiness 等
- `eval/`：eval-runner、lucy-eval-runner、render-quiz、spider2-lite-*（现有 eval/ 子目录保留）
- `smoke/`：p0-*-smoke、p1-*-smoke、fast-smoke、headless-config-smoke、lucy-r1-*
- `release/`：release-artifacts、lucy-version-governance、security-baseline、ktx-lucy-diff-audit、ktx-upgrade-compat、build-customer-amd64-image、assert-image-elf-arch、license-*
- `demo/`：rebuild-*、sync-demo-skills-template、lucy-dev-up、init-e2e-fixture
- `upgrade/`：upgrade-lucy.*、upgrade-uat-*、assemble-upgrade-uat-config
- `launchd/`：保留

### docs/（71 项 → 前缀归拢）

- `governance/`：DEVELOPMENT.md、project-overview、eval-quiz-conventions、test-layers-and-release-gates、release-ci、version-matrix、product-docs-index
- `design/`：design-*.md（9 篇）
- `specs/`：lucy-*-spec/plan 类（约 12 篇）
- `runbooks/`：*runbook*、deployment-docker、customer-*、troubleshooting-guide、admin-guide
- `reviews/`：review-*.md
- `uat/`：uat-*.md
- 既有 6 个子目录（access-control/、licensing/、plans/、qa/、ui-ux-feedback/、user-guide/）不动

## 阶段与验收

| 阶段 | 内容 | 风险 |
|---|---|---|
| Phase 0 | scratch→inbox、lucy-skills→docs、tests/golden→evals/golden、AGENT_PIPELINE→docs、删 agents/ 断链 | 零 |
| Phase 1 | 10 个 compose → deploy/compose/ | 低 |
| Phase 2 | scripts/ 7 组迁移 + package.json/Dockerfile/CI/互引更新 | 中 |
| Phase 3 | docs/ 二级分类 + release-artifacts.mjs 打包清单 + 互链更新 | 低-中 |

每阶段验收：`npm run lint:spec`、`lint:version`、`smoke:fast` 通过；受影响 smoke 子集通过；
Phase 2 起 `docker build` 验证；全仓库 grep 旧路径残留为零；
`.dockerignore`/`.gitignore`/README 目录表/AGENTS.md/DEVELOPMENT.md 同步更新。
所有移动使用 `git mv` 保留历史。
