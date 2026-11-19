# UAT 套件总表（测试台 SOT）

> 规则：[`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」。勾连总账：[`docs/governance/e2e-ledger.md`](../../governance/e2e-ledger.md)。本文件是 **UAT 结果唯一真实来源**；不改写 Spec 合同状态。约定见 [`CONVENTIONS.md`](CONVENTIONS.md)。

> **P0 问数六套件（2026-11-14 升级后复跑）**：本机 Mac mini／demo 已 `demo:upgrade`（容器 `gitSha=9d59337d`；≠ 上午 Wave A 的 `3aa402c9`）；新增必做 `UAT-R0-UPGRADE`；Plan [`lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md`](../../plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)。上午 Wave A 跑次仍保留作对照。**≠ 可上线**。

| Suite | 总账 ID | 路径 | 必做环境 | 最近跑次 | 结果 |
|---|---|---|---|---|---|
| `UAT-SUITE-FDE-PACKCHECK` | **P1-55**／REQ-030-076；**P1-56**／REQ-030-077；**P1-57**／REQ-030-078 | [suites/fde-packcheck-3b1c62af](suites/fde-packcheck-3b1c62af/suite.md) | 独立Docker候选ff8e9c05／gitDirty=false／image b19486c2…；旧demo与四基线模式另存 | [2026-11-19-codex-p157](suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) | **FAIL（原完整范围实测，保持）**：FIX-01正式完整CSV／ZIP409。**D7客户测试范围裁决：可按限定范围进行，排除正式完整导出**（委托人2026-11-19明示延期，待另行安排）。R1／R2及其余本轮必做通过，02／03／04的D5受控降级边界保留；缺陷未关闭，不记为整套UAT PASS／可上线。见[Plan §13](../../plans/lucy-20261119-fde-acceptance-remediation-plan.md) |
| `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` | **P1-53**／REQ-030-074；**P1-54**／REQ-030-075 | [suites/mcp-upgrade-compatibility](suites/mcp-upgrade-compatibility/suite.md) | 被测候选＋Public MCP＋≥1 真实 Agent；**CompatConfigProfile 前置**；客户 capture／POST；双证据；Ops W0／W1／W2 | 尚无 | **NOT RUN**（门禁 v1.1；题库 **v1.0 终稿确权**；有题无配置＝BLOCKED）。开发未授权（明示暂不开发）；≠ 可上线 |
| `UAT-SUITE-SOURCE-AMBIGUITY` | P0-3／REQ-030-024 | [suites/source-ambiguity-gate](suites/source-ambiguity-gate/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-18-cursor-sag-hardline-post-rebuild](suites/source-ambiguity-gate/runs/2026-11-18-cursor-sag-hardline-post-rebuild.md) | **PASS**（R0／R0-UPGRADE／SAG-01 v3 硬线；证据挂 [ESCAPE post-rebuild](suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md)；SAG-02 **NOT RUN**；`gitSha=7ebedd4e`）。历史 [2026-11-14](suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) 保留。≠ 可上线 |
| `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` | P1-35／REQ-030-056（纯 MCP 逃生；伴生 P0-3） | [suites/source-ambiguity-mcp-escape](suites/source-ambiguity-mcp-escape/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-18-cursor-sag-escape-post-rebuild](suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md) | **PASS**（重建后 `gitSha=7ebedd4e`／`gitDirty=false`；R0／ESC-01～10＝28/28＋新增 ESC-11 WorkBuddy 会员收入同形；夹具已还原）。上一绿 [v0.4](suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)。评估见 [capability](../../reviews/2026-11-18-workbuddy-member-income-uat-capability-assessment.md)。≠ 客户 COMPAT-09；≠ 可上线 |
| `UAT-SUITE-CALIBER-BINDING` | P0-1／REQ-030-027 | [suites/question-type-caliber-binding](suites/question-type-caliber-binding/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS WITH GAP**（R0-UPGRADE＋CALIBER-01 PASS；CALIBER-02 **Wave B 推迟**） |
| `UAT-SUITE-FIELD-EXPOSURE` | P0-A／REQ-030-012 | [suites/semantic-source-field-exposure](suites/semantic-source-field-exposure/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS WITH GAP**（R0-UPGRADE＋EXPOSURE-01 PASS；EXPOSURE-02 **Wave B 推迟**） |
| `UAT-SUITE-ANSWER-VERIFIABILITY` | P0-4／REQ-030-022 | [suites/answer-verifiability](suites/answer-verifiability/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/answer-verifiability/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋AV-01／AV-02；cutoff=`not_checked`） |
| `UAT-SUITE-EMPTY-NEXT-STEP` | P0-5／REQ-030-018 | [suites/empty-result-next-step](suites/empty-result-next-step/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/empty-result-next-step/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋EMPTY-01／EMPTY-02） |
| `UAT-SUITE-CATALOG-SEMANTICS` | P0-2／REQ-030-023 | [suites/catalog-business-semantics](suites/catalog-business-semantics/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/catalog-business-semantics/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋CATSEM-01／CATSEM-02） |
| `UAT-SUITE-CONN-RELOAD` | P1-15／REQ-030-036 | [suites/connection-runtime-reload](suites/connection-runtime-reload/suite.md) | 本机 demo Docker + supervisor | [2026-11-13-claude-gate-reload-cross](suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md)（交叉复跑 GATE-01／RELOAD-02；Cursor 同批见 [cursor-gate-reload](suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md)） | **PASS**（交叉复跑两条仍 PASS；此前整套 PASS） |
| `UAT-SUITE-CATALOG-SCAN` | P1-16／REQ-030-037；**P1-20**／REQ-030-041 | [suites/catalog-scan-read-path](suites/catalog-scan-read-path/suite.md) | demo Docker + `uat_wide_scan` 种子；MySQL 矩阵见 fixtures；P1-20 EXT live（现场必验）＋本机 Doris／Hive 双目录 lab | [2026-11-19-cursor-hive-jd-ext-rerun](suites/catalog-scan-read-path/runs/2026-11-19-cursor-hive-jd-ext-rerun.md)（最新：`gitSha=3b1c62af`；SIM／KTX／MYSQL＋**EXT-03-DUAL＋EXT-05 lab PASS**）；对照 [2026-11-18-cursor-hive-jd-ext-dual](suites/catalog-scan-read-path/runs/2026-11-18-cursor-hive-jd-ext-dual.md)；CASE／DIFF 仍见 [claude-case-diff-cross](suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md) | **P1-16：PASS WITH GAP**。**P1-20：替身有效＋lab live PASS**（DUAL：`hive.dw`／`hive_jd.app`；EXT-05 缺表→`not_in_library`，SelectDB `Unknown table`）；**客户生产 SelectDB 仍 NOT VERIFIED**；EXT-04 SKIPPED。≠ 可上线 |
| `UAT-SUITE-ACCESS-MAP` | P1-17／REQ-030-038；**P1-19**／REQ-030-040 | [suites/access-map-sankey-empty](suites/access-map-sankey-empty/suite.md) | 本机 demo Docker + WebUI + MCP | [2026-11-14-claude-macmini-p119-access-map](suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) | **PASS**（必做 R0／01–03 PASS；可选 04 实跑 PASS——P1-19 关闭 F-1：`accessPaths` 0→2、`deniedCalls` 未抬、ribbon 0→5；容器 `gitSha=9d59337d`） |
| `UAT-SUITE-ROLES-AGENT-PERF` | P1-13／REQ-030-034 | [suites/roles-agent-page-perf](suites/roles-agent-page-perf/suite.md) | 本机 demo Docker + WebUI | [2026-11-13-cursor-docker-page-perf](suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | **PASS**（必做 Roles／Agent 网络合同与 API 墙钟；可选 release-baseline **SKIPPED**） |
| `UAT-SUITE-EVENT-LOOP-RELIEF` | P1-21／REQ-030-042 | [suites/event-loop-relief](suites/event-loop-relief/suite.md) | 候选构建跑规模脚本；demo Docker 跑概览／探针；客户实例仅维护窗 | [2026-11-13-cursor-demo-event-loop](suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md) | **PASS**（必做 R0／01–04；可选 LOOP-05 **BLOCKED**——客户 0.25 无 `/api/livez`。≠ 可上线） |
| `UAT-SUITE-COLD-START-SLOW-DISK` | **P1-39**／REQ-030-060 | [suites/cold-start-slow-disk](suites/cold-start-slow-disk/suite.md) | 本机 Docker Desktop；blkio 限速（读写 30MB/s、读 300／写 100 IOPS、2 核）＋宿主 `drop_caches`；`npm run uat:cold-start`；旧 schema 20 万行审计库快照 | [2026-11-19-codex-p157](suites/cold-start-slow-disk/runs/2026-11-19-codex-p157-ff8e9c05.md) | **PASS**：R0／01–05，ff8e9c05；首次升级111.3秒就绪，livez max210／p99 202ms；重启31.5秒，max8／p99 7ms；认领、MCP握手真实通过。06客户现场不在本轮Docker范围。≠可上线 |
| `UAT-SUITE-COPY-FAKE-SUCCESS` | **P1-40**／REQ-030-061 | [suites/copy-fake-success](suites/copy-fake-success/suite.md) | 本机 demo 用**局域网 IP**（非回环明文 HTTP）；`npm run uat:copy-probe`；回环无判定力 | [2026-11-17-cursor-copy-probe-hardened](suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-hardened.md)（改前基线：[first FAIL](suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-first.md)） | **PASS WITH GAP**（R0／01／02a–02j／03 PASS：helper 3/3、十个可点入口全 REAL，含真实签发＋吊销 Token、真实 MCP 审计数据、抽屉内复制；缺口：6 个 helper-only 入口不可达未点、公网实例未升级 UAT-COPY-04 NOT-RUN。≠ 可上线） |
| `UAT-SUITE-BUTTON-FEEDBACK` | **P1-42**／REQ-030-063 | [suites/button-feedback](suites/button-feedback/suite.md) | 本机 demo Docker（回环可用）；`npm run uat:button-feedback`；失败只用真实失败 | [2026-11-17-cursor-button-feedback-after-fix](suites/button-feedback/runs/2026-11-17-cursor-button-feedback-after-fix.md)（改前基线：[FAIL](suites/button-feedback/runs/2026-11-17-cursor-button-feedback-baseline.md)） | **PASS WITH GAP**：改前 07 对账导出 DOWNLOAD-FAILED（界面静默）→ 改后 HONEST-FAILURE（Toast 说明 409 原因）；01–06、08–10 REAL；S01／S02 REAL；G1 PASS。缺口：6 入口 NOT-RUN；07 在 demo 上从未导出成功；低权限／网络失败仅单测；修复未提交 |
| `UAT-SUITE-ACCESS-MAP-SANKEY` | **P1-41**／REQ-030-062 | [suites/access-map-sankey-design](suites/access-map-sankey-design/suite.md) | 宿主隔离沙箱（确定性种子 5 profile；旧码 `6d2664b3` 对 HEAD A/B）；线上实例需登录 | [沙箱跑次](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-restoration-run.md)；[Docker 种子容器全真跑次](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-docker-seeded-run.md)；[demo 容器改编复验](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-demo-docker-run.md)（改前基线见 [probe-baseline](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-probe-baseline.md)） | **PASS WITH GAP**（Docker 种子容器全真执行：必做 R0／01／02／04／05 与 03 通过；06 沿用基线沙箱 A/B；仅 07 线上未跑）；**07 BLOCKED**（无线上凭据，线上未升级）。≠ UAT 对线上通过；≠ 可上线 |
| `UAT-SUITE-CONTEXT-CONTENT` | **P1-30**／REQ-030-051 | [suites/context-content](suites/context-content/suite.md) | 本机 demo Docker + MCP；宿主＝Claude Code CLI + Cursor Agent CLI | [claude](suites/context-content/runs/2026-11-15-claude-ctx-content.md)／[cursor-cli](suites/context-content/runs/2026-11-15-cursor-cli-ctx-content.md) | **PASS WITH GAP**（必做 R0／R0-SEED／WIKI-01…04／SKILL-01…04 PASS；WIKI-01S **BLOCKED**=GAP-2；`gitSha=9d59337d`；判定 JSON `inbox/uat-ctx-content-2026-11-15/verdict-cases.json`）。≠ 可上线 |
| `UAT-SUITE-OPS-CONCEPTS` | **P1-11**／REQ-030-032；**P1-27**／REQ-030-048 | [suites/ops-concepts](suites/ops-concepts/suite.md) | 本机 demo Docker + WebUI + MCP `:57881` | [2026-11-15-cursor-p1-27-ops-retest](suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md)（首跑 FAIL 对照：[claude-macmini-p1-11-ops](suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)） | **PASS**（P1-27 复测：R0／R0-FIX／01／02／03；`gitSha=d64414d6…`、`gitDirty=false`；未补卷 `scripts/`；list／summary／scan preview 业务成功。GAP-UAT-P1-11-RUNTIME 关闭）。≠ 可上线 |
| `UAT-SUITE-ROW-POLICY` | **P1-28**／REQ-030-049；**P1-29**／REQ-030-050 | [suites/row-policy-finance-scenario](suites/row-policy-finance-scenario/suite.md) | 本机 demo Docker；自造 `uat_row_policy_` 两表；WebUI `:55176`；MCP `:57881` | [2026-11-15-cursor-row-policy-retest](suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md)（对照 [first](suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-first.md)） | **FAIL**（R0／ROW-01／04／06／08 PASS；**ROW-02／03／05 BLOCKED**——begin 后仍 `source_ambiguity_gate`／空候选，另见 `caliber_binding_unresolved`；**ROW-07 FAIL**＝预期 GAP-VALUE）。`gitSha=d64414d6`。≠ 可上线；≠ 核心升级完成 |
| `UAT-SUITE-PAGE-SWEEP` | **P1-31**／REQ-030-052；整改 **P1-32**／REQ-030-053、**P1-33**／REQ-030-054 | [suites/page-event-loop-sweep](suites/page-event-loop-sweep/suite.md) | 本机沙箱（首跑 demo `docker cp` 副本；整改后复跑复用该副本）+ Chromium；合成审计账本夹具 | [2026-11-16-claude-page-sweep-after-rebuild](suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md)（重建后从干净状态完整跑；前一跑次 [after-fix](suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-fix.md)；首跑 [2026-11-15 FAIL](suites/page-event-loop-sweep/runs/2026-11-15-claude-page-sweep-first.md)） | **PASS WITH GAP**（01 40/43 通过；02 **0 越线／0 失败**，96 通过、25 未测——含 `export-v2`／`export-pack-v2`（夹具缺派生列）；03 门禁 PASS、基线 `tracked` 清零；04 对本次报告回放 PASS。`governance/overview` livez p99 386ms 贴线（余量 14ms）。≠ 可上线） |
| `UAT-SUITE-EQUIV-GUARD` | **P1-32**／REQ-030-053；**P1-33**／REQ-030-054 | [suites/audit-scale-equivalence-guard](suites/audit-scale-equivalence-guard/suite.md) | 本机 vitest＋better-sqlite3 真库；冻结旧实现与改前金样本；性能面引 `UAT-SUITE-PAGE-SWEEP` | [2026-11-16-claude-equiv-first](suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md) | **PASS WITH GAP**（必做 R0／01／02／03 PASS：71 条等价用例全绿；04 变异自检 8 类全部被拦下，`daily-question-kpi` 变异未实跑；等价守卫拦不住纯性能回退，靠 EQ-03。≠ 可上线） |
| `UAT-SUITE-LARGE-SCHEMA` | **P1-34**／REQ-030-055 | [suites/large-schema-ingestion](suites/large-schema-ingestion/suite.md) | 本机 demo Docker + `lucy-uat-hive`（Doris→Hive 元数据）+ demo-db 大库夹具；**规模下限不得降低** | [2026-11-19-codex-p157](suites/large-schema-ingestion/runs/2026-11-19-codex-p157-ff8e9c05.md) | **PASS（本跑次）**：R0／01–10全部通过；MySQL1201表、Hive605表，实际产出6000／18000字段；旧SCALE-09偶发171秒未归因记录保留，不据此宣称长期稳定。可选11／12未跑。≠可上线 |
| `UAT-SUITE-QUESTION-BUDGET` | **P1-12**／REQ-030-033 | [suites/question-budget](suites/question-budget/suite.md) | 本机 demo Docker + MCP `:57881`；BUDGET-04 另需带 `lucy_continue_question` 的临时身份（需 WebUI 管理员口令） | [2026-11-16-cursor-p1-12-budget-uat-rerun](suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat-rerun.md)（Docker 重建后复跑，`299de2c9`；首跑见 [2026-11-16-cursor-p1-12-budget-uat](suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat.md)） | **PASS**（R0／01／02／03／04 全 PASS；第二次续查被拒 `NOT RUN`，由单测覆盖。多轮跑次中有被并发 KTX 重载或脚本参数污染者，均已作废重跑。≠ 可上线） |
| `UAT-SUITE-BUDGET-AUDIT` | **P1-14**／REQ-030-035 | [suites/budget-audit](suites/budget-audit/suite.md) | 本机 demo Docker + WebUI Admin 审计导出 | [2026-11-15-cursor-p1-14-audit-retest](suites/budget-audit/runs/2026-11-15-cursor-p1-14-audit-retest.md)（对照 [首跑](suites/budget-audit/runs/2026-11-15-cursor-p1-14-audit.md)） | **PASS**（R0／AUDIT-01／02／03；本波 `budget_stop` 行含 `budgetSnapshot.maxCalls=60`）。≠ 可上线 |
| `UAT-SUITE-TRACE-LEDGER` | **P1-36**／REQ-030-057（调用流水 trace 级可追溯与存档） | [suites/trace-span-ledger](suites/trace-span-ledger/suite.md) | 宽目录沙箱 `lucy-uat-wide`（独立容器／volume／库）＋ demo 只读取数 + 审计库 | [2026-11-17-claude-wide-sandbox-tierA](suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md) | **PASS WITH GAP**（TRC-01/02/03/04/05/06/10/11 有证据；TRC-07/08/09 **NOT RUN**；TRC-05 因既有 F-02 只能用诊断导出读 `spans.csv`；F-3 SC-06 口径冲突待裁定；无改前基线跑次）。≠ 整套 PASS；≠ 开发授权；≠ 可上线 |
| `UAT-SUITE-MCP-UX-RESILIENCE` | **P1-37**／REQ-030-058（MCP 握手、失败信息、会话恢复、快速失败） | [suites/mcp-ux-resilience](suites/mcp-ux-resilience/suite.md) | 宽目录沙箱 `lucy-uat-wide`（320 Source、20 Agent）＋ 本机 demo Docker + MCP `:57881` | [2026-11-17-claude-wide-sandbox-tierA](suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md) | **PASS WITH GAP**（R0／MCPX-01、04、07、11、12 **PASS**；02、05、06、08 **PASS WITH GAP**；03 伴生 PASS；**MCPX-09／10 BLOCKED**；无改前基线跑次，修复前后对照取自沙箱同目录）。≠ 整套 PASS；≠ 开发授权；≠ 可上线 |
| `UAT-SUITE-PAGE-OPEN` | **P1-44**／REQ-030-065（事故修复：渲染崩溃被兜底页伪装成版本问题） | [suites/page-open-exceptions](suites/page-open-exceptions/suite.md) | 本机 demo Docker + WebUI；`npx tsx scripts/uat/page-open-probe.mts`（管理员凭据从仓库外文件读入） | [2026-11-18-cursor-page-open-after-fix](suites/page-open-exceptions/runs/2026-11-18-cursor-page-open-after-fix.md) | **PASS WITH GAP**（R0／PO-01 27 个页面、PO-02 28 个页签全部 PASS，55/55；PO-03 详情页 NOT-RUN；修复前负控未实跑，由判定器自检与单测覆盖。修复未提交。≠ 可上线） |
| `UAT-SUITE-INFERRED-REBUILD-RECOVERY` | **P1-45**／REQ-030-066（前方报告 P0-02：重建中断后自动恢复） | [suites/inferred-turn-rebuild-recovery](suites/inferred-turn-rebuild-recovery/suite.md) | 真实进程／容器中断 + 同卷审计库；可选客户额度慢盘 | [2026-11-19-codex-p157](suites/inferred-turn-rebuild-recovery/runs/2026-11-19-codex-p157-ff8e9c05.md) | **PASS**：R0／01–04，ff8e9c05；真实20000调用SIGKILL，407条持久残留→20000完整，退出137；04完成时间／水位／120条关联不变。未杀到的兜底不计02通过。05可选未跑。≠可上线 |
| `UAT-SUITE-READYZ-MCP-LISTEN` | **P1-46**／REQ-030-067（前方报告 P0-03：readyz 与 MCP listen 一致） | [suites/readyz-mcp-listen](suites/readyz-mcp-listen/suite.md) | 冷启动容器；直连 MCP 端口 + `/api/readyz` 高频采样 | [2026-11-18-cursor-rml-p145-p147](suites/readyz-mcp-listen/runs/2026-11-18-cursor-rml-p145-p147.md) | **PASS**（R0／01–03；3／3 冷启动首次 Ready 即 initialize）。≠ 可上线 |
| `UAT-SUITE-REBUILD-PROBE-BUDGET` | **P1-47**／REQ-030-068（前方报告 P0-01：满量重建探针预算） | [suites/rebuild-probe-budget](suites/rebuild-probe-budget/suite.md) | 满量推断夹具 + 慢盘限速容器；客户 3s 观察器 | [2026-11-19-codex-p157](suites/rebuild-probe-budget/runs/2026-11-19-codex-p157-ff8e9c05.md) | **PASS（默认3/3）**：ff8e9c05，当前窗口≥20万调用已完整唯一有效关联；full-2／3／4，livez max12／20／93ms，p99 10／16／59ms，streak0，117–118次同窗已鉴权业务全200；3163行大用户闭包完成。暂停05–07另PASS；旧不完整夹具不计PASS。≠可上线 |

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
# 最近判定：PASS（2026-11-15-cursor-p1-27-ops-retest；R0-FIX＋01–03）
# 勿手工补 /data/lucy/scripts；测后清理 uat-ops-concept-* Role／Agent

# 大 Schema 接入（P1-34）— 最近跑次 2026-11-16-claude-large-schema-after-impl（PASS WITH GAP：第 2 次 SCALE-09 异常，原因未定位）
# 造数据：bash scripts/uat/seed-large-schema-fixtures.sh all
# 跑套件：cd webui && LUCY_E2E_WEBUI_ADMIN_ID=<管理员 id> npx tsx ../scripts/uat/run-large-schema-ingestion.mts --out ../inbox/uat-large-schema-$(date +%F)
# 规模下限（不得降低）与用例：docs/qa/uat/suites/large-schema-ingestion/{suite,cases,fixtures}.md

# 行级隔离（P1-28／P1-29）
# 用例：docs/qa/uat/suites/row-policy-finance-scenario/cases.md
# 夹具：同目录 fixtures.md（自造 uat_row_policy_；proven 用同一 compose project 重建）
# 最近判定：FAIL（2026-11-15-cursor-row-policy-retest；仍 BLOCKED 于歧义门闩／可用性）
# 复跑前确认 printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN 未设置，且没有 uat-row-policy-* / uat_row_policy_ 残留

# 全页面／全 GET 路由事件循环看守（P1-31；整改 P1-32／P1-33）— 最近判定：PASS WITH GAP（2026-11-16-claude-page-sweep-after-rebuild；首跑 FAIL）
# 全量：npm --prefix webui run sweep:event-loop（约 8–15 分钟，自行 docker cp＋vite build）
# 门禁：npm --prefix webui run sweep:event-loop:gate（新增越线／新增未测即退出码 1；基线 webui/scripts/page-event-loop-sweep.baseline.json 只减不增）
# 严格：SWEEP_STRICT=1 npm --prefix webui run sweep:event-loop:gate（已登记越线清零后预期 0；基线 tracked 已于 2026-11-16 清零）
# 用例：docs/qa/uat/suites/page-event-loop-sweep/cases.md

# 审计与概览读路径等价守卫（P1-32／P1-33；防旧病复发）— 最近判定：PASS WITH GAP（2026-11-16-claude-equiv-first）
# 改动受守卫文件必跑（秒级）：npm --prefix webui run test:equivalence
# 用例：docs/qa/uat/suites/audit-scale-equivalence-guard/cases.md（含变异自检 UAT-EQ-04）

# 三台勾连兜底
npm run lint:e2e-ledger
```

回链：首次落地 Plan [`docs/plans/lucy-20261113-connection-reload-and-catalog-scan-docker-uat-plan.md`](../../plans/lucy-20261113-connection-reload-and-catalog-scan-docker-uat-plan.md)（**长期以本 UAT 树为准**）。

兜底检查：`npm run lint:e2e-ledger`（或 `node scripts/uat/check-e2e-ledger.mjs`）。

WebUI：`http://127.0.0.1:55176`
