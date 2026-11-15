# UAT 套件总表（测试台 SOT）

> 规则：[`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」。勾连总账：[`docs/governance/e2e-ledger.md`](../../governance/e2e-ledger.md)。本文件是 **UAT 结果唯一真实来源**；不改写 Spec 合同状态。约定见 [`CONVENTIONS.md`](CONVENTIONS.md)。

> **P0 问数六套件（2026-11-14 升级后复跑）**：本机 Mac mini／demo 已 `demo:upgrade`（容器 `gitSha=9d59337d`；≠ 上午 Wave A 的 `3aa402c9`）；新增必做 `UAT-R0-UPGRADE`；Plan [`lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md`](../../plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)。上午 Wave A 跑次仍保留作对照。**≠ 可上线**。

| Suite | 总账 ID | 路径 | 必做环境 | 最近跑次 | 结果 |
|---|---|---|---|---|---|
| `UAT-SUITE-SOURCE-AMBIGUITY` | P0-3／REQ-030-024 | [suites/source-ambiguity-gate](suites/source-ambiguity-gate/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋SAG-01；SAG-02 **BLOCKED**——无 person／attestation；`gitSha=9d59337d`） |
| `UAT-SUITE-CALIBER-BINDING` | P0-1／REQ-030-027 | [suites/question-type-caliber-binding](suites/question-type-caliber-binding/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS WITH GAP**（R0-UPGRADE＋CALIBER-01 PASS；CALIBER-02 **Wave B 推迟**） |
| `UAT-SUITE-FIELD-EXPOSURE` | P0-A／REQ-030-012 | [suites/semantic-source-field-exposure](suites/semantic-source-field-exposure/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS WITH GAP**（R0-UPGRADE＋EXPOSURE-01 PASS；EXPOSURE-02 **Wave B 推迟**） |
| `UAT-SUITE-ANSWER-VERIFIABILITY` | P0-4／REQ-030-022 | [suites/answer-verifiability](suites/answer-verifiability/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/answer-verifiability/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋AV-01／AV-02；cutoff=`not_checked`） |
| `UAT-SUITE-EMPTY-NEXT-STEP` | P0-5／REQ-030-018 | [suites/empty-result-next-step](suites/empty-result-next-step/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/empty-result-next-step/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋EMPTY-01／EMPTY-02） |
| `UAT-SUITE-CATALOG-SEMANTICS` | P0-2／REQ-030-023 | [suites/catalog-business-semantics](suites/catalog-business-semantics/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/catalog-business-semantics/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋CATSEM-01／CATSEM-02） |
| `UAT-SUITE-CONN-RELOAD` | P1-15／REQ-030-036 | [suites/connection-runtime-reload](suites/connection-runtime-reload/suite.md) | 本机 demo Docker + supervisor | [2026-11-13-claude-gate-reload-cross](suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md)（交叉复跑 GATE-01／RELOAD-02；Cursor 同批见 [cursor-gate-reload](suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md)） | **PASS**（交叉复跑两条仍 PASS；此前整套 PASS） |
| `UAT-SUITE-CATALOG-SCAN` | P1-16／REQ-030-037；**P1-20**／REQ-030-041 | [suites/catalog-scan-read-path](suites/catalog-scan-read-path/suite.md) | demo Docker + `uat_wide_scan` 种子；MySQL 矩阵见 fixtures；P1-20 EXT live（现场必验） | [2026-11-13-cursor-p120-uat](suites/catalog-scan-read-path/runs/2026-11-13-cursor-p120-uat.md)（Gate A：SIM／KTX／MYSQL；CASE／DIFF 仍见 [claude-case-diff-cross](suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md)） | **P1-16：PASS WITH GAP**（SEED／MYSQL／SIM／KTX PASS；EXT-01／02 BLOCKED；矩阵／CASE／DIFF 维持既有 PASS）。**P1-20：替身有效＋现场 NOT VERIFIED**（SIM 76/76＋KTX-GUARD PASS；EXT-03…05 BLOCKED——无外部目录库密码；≠ 可上线） |
| `UAT-SUITE-ACCESS-MAP` | P1-17／REQ-030-038；**P1-19**／REQ-030-040 | [suites/access-map-sankey-empty](suites/access-map-sankey-empty/suite.md) | 本机 demo Docker + WebUI + MCP | [2026-11-14-claude-macmini-p119-access-map](suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) | **PASS**（必做 R0／01–03 PASS；可选 04 实跑 PASS——P1-19 关闭 F-1：`accessPaths` 0→2、`deniedCalls` 未抬、ribbon 0→5；容器 `gitSha=9d59337d`） |
| `UAT-SUITE-ROLES-AGENT-PERF` | P1-13／REQ-030-034 | [suites/roles-agent-page-perf](suites/roles-agent-page-perf/suite.md) | 本机 demo Docker + WebUI | [2026-11-13-cursor-docker-page-perf](suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | **PASS**（必做 Roles／Agent 网络合同与 API 墙钟；可选 release-baseline **SKIPPED**） |
| `UAT-SUITE-EVENT-LOOP-RELIEF` | P1-21／REQ-030-042 | [suites/event-loop-relief](suites/event-loop-relief/suite.md) | 候选构建跑规模脚本；demo Docker 跑概览／探针；客户实例仅维护窗 | [2026-11-13-cursor-demo-event-loop](suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md) | **PASS**（必做 R0／01–04；可选 LOOP-05 **BLOCKED**——客户 0.25 无 `/api/livez`。≠ 可上线） |
| `UAT-SUITE-CONTEXT-CONTENT` | **P1-30**／REQ-030-051 | [suites/context-content](suites/context-content/suite.md) | 本机 demo Docker + MCP；宿主＝Claude Code CLI + Cursor Agent CLI | [claude](suites/context-content/runs/2026-11-15-claude-ctx-content.md)／[cursor-cli](suites/context-content/runs/2026-11-15-cursor-cli-ctx-content.md) | **PASS WITH GAP**（必做 R0／R0-SEED／WIKI-01…04／SKILL-01…04 PASS；WIKI-01S **BLOCKED**=GAP-2；`gitSha=9d59337d`；判定 JSON `inbox/uat-ctx-content-2026-11-15/verdict-cases.json`）。≠ 可上线 |
| `UAT-SUITE-OPS-CONCEPTS` | **P1-11**／REQ-030-032；**P1-27**／REQ-030-048 | [suites/ops-concepts](suites/ops-concepts/suite.md) | 本机 demo Docker + WebUI + MCP `:57881` | [2026-11-15-claude-macmini-p1-11-ops](suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md) | **FAIL**（R0／01／03 PASS；**02 FAIL**——授权可见，业务受理 502／`ERR_MODULE_NOT_FOUND` at `/data/lucy`；见 GAP-UAT-P1-11-RUNTIME）。**P1-27 修复复测＝NOT RUN**（须干净 `demo:upgrade` 且 health `gitDirty=false`＋`gitSha`＝修复提交后再跑；本登记不重建）。≠ 可上线 |

## 一键入口（本机）

```bash
# P0 问数六套件（方案 B）：MCP 全真；Bearer 只从本机 token 文件读入进程
# 最近复跑 Plan：docs/plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md（升级后；gitSha=9d59337d）
# 证据示例：inbox/uat-p0-post-upgrade-2026-11-14/（上午 Wave A：uat-p0-macmini-2026-11-14／3aa402c9）
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

# 扫表：真实 KTX 只读校验（P1-20 KTX-GUARD；容器内）
bash scripts/uat/verify-ktx-readonly-guard.sh

# 扫表：替身（含 P1-20 EC）+ 宽表 live API
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts \
  server/__tests__/live-catalog.test.ts

node scripts/uat/run-catalog-scan-wide-api.mjs

# 重读路径与存活探针（P1-21）— 最近跑次 2026-11-13-cursor-demo-event-loop
# 规模：npm --prefix webui run perf:event-loop-relief
# 用例：docs/qa/uat/suites/event-loop-relief/cases.md
# 客户实例只在含 /api/livez 的镜像上、维护窗执行；高峰禁止 hours=168

# Roles／Agent 页性能体感（P1-13）
# 浏览器：http://127.0.0.1:55176/admin/roles 与 /admin/agents
# Network 合同见 suites/roles-agent-page-perf/cases.md
# 可选发布取证 runner：
# npm run perf:release-baseline -- --tier ci-small --skip-build --output inbox/perf-baselines/uat-roles-agent

# 概念运维 Ops MCP（P1-11／P1-27 复测）
# 用例：docs/qa/uat/suites/ops-concepts/cases.md
# 复测前置：干净 demo:upgrade；health gitSha＝修复提交且 gitDirty=false（UAT-R0-FIX）
# 勿手工补 /data/lucy/scripts；测后清理 uat-ops-concept-* Role／Agent
# 最近判定：FAIL（2026-11-15）；P1-27 修复复测尚未执行

# 三台勾连兜底
npm run lint:e2e-ledger
```

回链：首次落地 Plan [`docs/plans/lucy-20261113-connection-reload-and-catalog-scan-docker-uat-plan.md`](../../plans/lucy-20261113-connection-reload-and-catalog-scan-docker-uat-plan.md)（**长期以本 UAT 树为准**）。

兜底检查：`npm run lint:e2e-ledger`（或 `node scripts/uat/check-e2e-ledger.mjs`）。

WebUI：`http://127.0.0.1:55176`
