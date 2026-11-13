# UAT 套件总表（测试台 SOT）

> 规则：[`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」。勾连总账：[`docs/governance/e2e-ledger.md`](../../governance/e2e-ledger.md)。本文件是 **UAT 结果唯一真实来源**；不改写 Spec 合同状态。

| Suite | 总账 ID | 路径 | 必做环境 | 最近跑次 | 结果 |
|---|---|---|---|---|---|
| `UAT-SUITE-SOURCE-AMBIGUITY` | P0-3／REQ-030-024 | [suites/source-ambiguity-gate](suites/source-ambiguity-gate/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-13-cursor-docker-p0-qa](suites/source-ambiguity-gate/runs/2026-11-13-cursor-docker-p0-qa.md) | **PASS**（UAT-SAG-01 多表词 deny；可选宿主确认未跑） |
| `UAT-SUITE-CALIBER-BINDING` | P0-1／REQ-030-027 | [suites/question-type-caliber-binding](suites/question-type-caliber-binding/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-13-cursor-docker-p0-qa](suites/question-type-caliber-binding/runs/2026-11-13-cursor-docker-p0-qa.md) | **PASS WITH GAP**（零绑定不强制 PASS；可选偏离 deny **BLOCKED**——缺 published 绑定夹具） |
| `UAT-SUITE-FIELD-EXPOSURE` | P0-A／REQ-030-012 | [suites/semantic-source-field-exposure](suites/semantic-source-field-exposure/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-13-cursor-docker-p0-qa](suites/semantic-source-field-exposure/runs/2026-11-13-cursor-docker-p0-qa.md) | **PASS WITH GAP**（未配置全暴露基线 PASS；可选 `field_not_exposed` **BLOCKED**——缺台账夹具） |
| `UAT-SUITE-ANSWER-VERIFIABILITY` | P0-4／REQ-030-022 | [suites/answer-verifiability](suites/answer-verifiability/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-13-cursor-docker-p0-qa](suites/answer-verifiability/runs/2026-11-13-cursor-docker-p0-qa.md) | **PASS**（成功查数 text＋`_meta` 含 `answer_verifiability`；cutoff=`not_checked`） |
| `UAT-SUITE-EMPTY-NEXT-STEP` | P0-5／REQ-030-018 | [suites/empty-result-next-step](suites/empty-result-next-step/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-13-cursor-docker-p0-qa](suites/empty-result-next-step/runs/2026-11-13-cursor-docker-p0-qa.md) | **PASS**（0 行事实 → `next_step.kind=empty_result`） |
| `UAT-SUITE-CATALOG-SEMANTICS` | P0-2／REQ-030-023 | [suites/catalog-business-semantics](suites/catalog-business-semantics/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-13-cursor-docker-p0-qa](suites/catalog-business-semantics/runs/2026-11-13-cursor-docker-p0-qa.md) | **PASS**（`superstore_*` 带 `description`／`descriptionState=present`） |
| `UAT-SUITE-CONN-RELOAD` | P1-15／REQ-030-036 | [suites/connection-runtime-reload](suites/connection-runtime-reload/suite.md) | 本机 demo Docker + supervisor | [2026-11-13-claude-gate-reload-cross](suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md)（交叉复跑 GATE-01／RELOAD-02；Cursor 同批见 [cursor-gate-reload](suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md)） | **PASS**（交叉复跑两条仍 PASS；此前整套 PASS） |
| `UAT-SUITE-CATALOG-SCAN` | P1-16／REQ-030-037 | [suites/catalog-scan-read-path](suites/catalog-scan-read-path/suite.md) | demo Docker + `uat_wide_scan` 种子；MySQL 矩阵见 fixtures | [2026-11-13-claude-case-diff-cross](suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md)（CASE-01／DIFF-01 交叉 **PASS**；Cursor 复跑见 [case-diff-rerun](suites/catalog-scan-read-path/runs/2026-11-13-cursor-case-diff-rerun.md)） | **PASS WITH GAP**（CASE-01／DIFF-01 交叉 **PASS**；矩阵 5.7／8.0／8.4 仍 PASS；EXT live 仍 BLOCKED） |
| `UAT-SUITE-ACCESS-MAP` | P1-17／REQ-030-038 | [suites/access-map-sankey-empty](suites/access-map-sankey-empty/suite.md) | 本机 demo Docker + WebUI | [2026-11-13-claude-adversarial](suites/access-map-sankey-empty/runs/2026-11-13-claude-adversarial.md)（对抗全真；同场另有 [cursor-docker-sankey](suites/access-map-sankey-empty/runs/2026-11-13-cursor-docker-sankey.md)） | **PASS WITH GAP**（必做空态骨干／图例／confirmed-only **PASS**；可选 begin 触表 **FAIL**——关联写入 confirmed 已达成，但访问面 band E 仍用旧 `outcome='allow'` 词表，usage 流带不可达，见跑次「发现 F-1」） |
| `UAT-SUITE-ROLES-AGENT-PERF` | P1-13／REQ-030-034 | [suites/roles-agent-page-perf](suites/roles-agent-page-perf/suite.md) | 本机 demo Docker + WebUI | [2026-11-13-cursor-docker-page-perf](suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | **PASS**（必做 Roles／Agent 网络合同与 API 墙钟；可选 release-baseline **SKIPPED**） |

## 一键入口（本机）

```bash
# P0 问数六套件（方案 B）：MCP 全真；Bearer 只从本机 token 文件读入进程
# 证据示例：inbox/uat-p0-qa-mainpath-2026-11-13/evidence.json
# 套件：source-ambiguity-gate／question-type-caliber-binding／semantic-source-field-exposure／
#       answer-verifiability／empty-result-next-step／catalog-business-semantics

# 宽表／临时库种子（幂等）
bash scripts/uat/seed-catalog-scan-fixtures.sh

# MySQL 5.7／8.0／8.4 矩阵（全真）
bash scripts/uat/run-mysql-version-matrix.sh

# 连接热重载
LUCY_RELOAD_VERIFY_IMAGE=project-lucy:demo \
LUCY_RELOAD_VERIFY_CONTAINER=compose-lucy-1 \
LUCY_RELOAD_VERIFY_HEALTH_URL=http://127.0.0.1:55176/api/health \
bash scripts/verify/verify-ktx-reload-lifecycle.sh --container

cd webui && npm run e2e:live:connection-reload

# 扫表：替身 + 宽表 live API
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts

node scripts/uat/run-catalog-scan-wide-api.mjs

# Roles／Agent 页性能体感（P1-13）
# 浏览器：http://127.0.0.1:55176/admin/roles 与 /admin/agents
# Network 合同见 suites/roles-agent-page-perf/cases.md
# 可选发布取证 runner：
# npm run perf:release-baseline -- --tier ci-small --skip-build --output inbox/perf-baselines/uat-roles-agent

# 三台勾连兜底
npm run lint:e2e-ledger
```

回链：首次落地 Plan [`docs/plans/lucy-20261113-connection-reload-and-catalog-scan-docker-uat-plan.md`](../../plans/lucy-20261113-connection-reload-and-catalog-scan-docker-uat-plan.md)（**长期以本 UAT 树为准**）。

兜底检查：`npm run lint:e2e-ledger`（或 `node scripts/uat/check-e2e-ledger.mjs`）。

WebUI：`http://127.0.0.1:55176`
