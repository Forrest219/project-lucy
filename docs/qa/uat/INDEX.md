# UAT 套件总表（测试台 SOT）

> 规则：[`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」。勾连总账：[`docs/governance/e2e-ledger.md`](../../governance/e2e-ledger.md)。本文件是 **UAT 结果唯一真实来源**；不改写 Spec 合同状态。

| Suite | 总账 ID | 路径 | 必做环境 | 最近跑次 | 结果 |
|---|---|---|---|---|---|
| `UAT-SUITE-CONN-RELOAD` | P1-15／REQ-030-036 | [suites/connection-runtime-reload](suites/connection-runtime-reload/suite.md) | 本机 demo Docker + supervisor | [2026-11-13-claude-adversarial](suites/connection-runtime-reload/runs/2026-11-13-claude-adversarial.md)（对抗全真；同场另有 [cursor-docker-midstate](suites/connection-runtime-reload/runs/2026-11-13-cursor-docker-midstate.md)） | **PASS** |
| `UAT-SUITE-CATALOG-SCAN` | P1-16／REQ-030-037 | [suites/catalog-scan-read-path](suites/catalog-scan-read-path/suite.md) | demo Docker + `uat_wide_scan` 种子；MySQL 矩阵见 fixtures | [2026-11-13-mysql-version-matrix-57](suites/catalog-scan-read-path/runs/2026-11-13-mysql-version-matrix-57.md)（5.7／8.0／8.4 **PASS**；另有 [claude-adversarial](suites/catalog-scan-read-path/runs/2026-11-13-claude-adversarial.md)） | **PASS WITH GAP**（矩阵 **5.7＋8.0＋8.4 PASS**；EXT live 仍 BLOCKED，委托人选择暂不补跑） |
| `UAT-SUITE-ACCESS-MAP` | P1-17／REQ-030-038 | [suites/access-map-sankey-empty](suites/access-map-sankey-empty/suite.md) | 本机 demo Docker + WebUI | [2026-11-13-claude-adversarial](suites/access-map-sankey-empty/runs/2026-11-13-claude-adversarial.md)（对抗全真；同场另有 [cursor-docker-sankey](suites/access-map-sankey-empty/runs/2026-11-13-cursor-docker-sankey.md)） | **PASS WITH GAP**（必做空态骨干／图例／confirmed-only **PASS**；可选 begin 触表 **FAIL**——关联写入 confirmed 已达成，但访问面 band E 仍用旧 `outcome='allow'` 词表，usage 流带不可达，见跑次「发现 F-1」） |
| `UAT-SUITE-ROLES-AGENT-PERF` | P1-13／REQ-030-034 | [suites/roles-agent-page-perf](suites/roles-agent-page-perf/suite.md) | 本机 demo Docker + WebUI | [2026-11-13-cursor-docker-page-perf](suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | **PASS**（必做 Roles／Agent 网络合同与 API 墙钟；可选 release-baseline **SKIPPED**） |

## 一键入口（本机）

```bash
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
