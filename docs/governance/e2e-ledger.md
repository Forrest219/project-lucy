# 端到端台账勾连（lucy-v0.30 现行）

| 元数据 | 内容 |
|---|---|
| 角色 | **三台勾连表＋基准线追评**（不是第四套「总状态」）。规则正文在 [`DEVELOPMENT.md`](DEVELOPMENT.md)「端到端三台账」 |
| 产品线 | `0.30.0`／`lucy-v0.30` |
| 日期 | 2026-11-15 |
| 维护 | 只改指针与缺口；UAT 判定只改 [`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)；合同状态只改 Spec 头部 |

## 0. 测试台第一性原则（全局）

规则正文亦见 DEVELOPMENT「端到端三台账」第 4 条与 [`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)。

| 原则 | 含义 |
|---|---|
| 全真优先 | 对抗／交叉验证必须在真实 demo Docker／WebUI／API／supervisor 上**构造并执行**用例 |
| 禁止 CR 冒充 | Code Review、读代码评论**不是** UAT，不得写入 INDEX 为 PASS |
| 降级须独立授权 | 做不到全真 → 跑次 `BLOCKED`＋上报委托人；获独立授权前不得用 mock／替身／CR 主张验证 |

## 1. 三台 SOT 指针

| 台 | SOT | 现行路径 |
|---|---|---|
| 需求台 | 产品线执行总账＋需求池正文 | [清单池](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 开发台 | Spec 头部「状态」 | 各 `docs/specs/…-spec.md`／`webui/docs/191-…`（镜像：总账「跟进状态」、plans README） |
| 测试台 | UAT INDEX＋套件 runs | [`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md) |

## 2. 勾连表（本文件为勾连 SOT）

| 清单 ID | REQ | 开发台 Spec | 测试台 Suite | 最近 UAT | 备注 |
|---|---|---|---|---|---|
| P0-3 | REQ-030-024 | [歧义门闩 Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) | [`UAT-SUITE-SOURCE-AMBIGUITY`](../qa/uat/suites/source-ambiguity-gate/suite.md)＋[`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) | 拦得住：[2026-11-14 升级后 PASS](../qa/uat/suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md)；**逃生**：[2026-11-16 retest PASS](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-retest.md) | SAG-02 BLOCKED；逃生缺口已关（P1-35）。SAG-01 v2 伴生 deny PASS。≠ 可上线 |
| P1-35 | REQ-030-056 | [纯 MCP 逃生 Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) | [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) | [2026-11-16 v0.4 PASS](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md) | Spec **v0.4**（委托人明示确权＋授权开发，免 Codex；容错三档 D10–D15 已实现）；ESCAPE INDEX＝**PASS**（R0／ESC-01～10）；GAP-UAT-P0-3-ESCAPE **关闭**。**≠ D5／功能合同收口 ≠ 可上线** |
| P1-36 | REQ-030-057 | [trace 级流水 Spec](../specs/lucy-20261116-trace-span-ledger-spec.md) | [`UAT-SUITE-TRACE-LEDGER`](../qa/uat/suites/trace-span-ledger/suite.md) | **PASS WITH GAP**（沙箱 Tier-A；TRC-07/08/09 NOT RUN；GAP-UAT-P1-36 保持开启） | **终稿确权（委托人 2026-11-17 授权代理修正后定稿，免 Codex 终审）；v1.0；已获开发授权（委托人 2026-11-17「授权开发落地」）；代码已落地（span 表、同事务写入、spans.csv 与 spanCoverage、`/api/admin/audit/status`），vitest 回归无新增失败，本机 demo 已平滑升级并取证；测试台 `UAT-SUITE-TRACE-LEDGER`＝**PASS WITH GAP**（2026-11-17 宽目录沙箱 Tier-A 跑次 `docs/qa/uat/suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md`；TRC-01/02/03/04/05/06/10/11 有证据，TRC-07/08/09 NOT RUN，不是整套 PASS）；登记发现 F-1～F-5，其中 F-2（正式完整导出 `mode=complete` 因既有 F-02 失败关闭，`spans.csv` 只在诊断包验证）与 F-3（SC-06 与 §6.2 口径冲突）待委托人裁定。≠ UAT PASS；≠ 可上线** |
| P1-38 | REQ-030-059 | [推断问询补算 Spec](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md) | not_registered | not_registered | **v0.2-draft。推断问询补算按 400 行一页读取、按 25 个问询一片写入。读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前各让出一次事件循环，已排队的宏任务先于下一段同步工作运行。本次读取冻结到开始时该用户回看窗口内的最大 access_log.id。问询编号在该删除事务内按簇顺序分配，已有 correlation_key 沿用。来源查询按 500 个 id 一段。重算先按即将写入的 inferred_turn_id 删除残留行。补算期间再次标脏的用户留到下一轮。400 行和 25 簇是条数上界，单段仍可能超过探针的 3 秒。工作区已有实现与 vitest。终稿未确权。测试台 not_registered。不入核心分母。≠ 可上线**。缺口 GAP-UAT-P1-38 |
| P1-37 | REQ-030-058 | [MCP 体验韧性 Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md) | [`UAT-SUITE-MCP-UX-RESILIENCE`](../qa/uat/suites/mcp-ux-resilience/suite.md) | **PASS WITH GAP**（沙箱 Tier-A；MCPX-09／10 BLOCKED；GAP-UAT-P1-37 保持开启） | **终稿确权（委托人 2026-11-17 授权代理修正后定稿，免 Codex 终审）；v1.0；已获开发授权（委托人 2026-11-17「授权开发落地」）；部分落地：U1（描述索引按文件指纹缓存；宽目录沙箱复现长尾后修复，**偏离 Spec 的 instructions 缓存设计**）、U2、U3a、U4（拒绝与门闩路径跳过逐 Agent 权限编译）已实现；U3b 按委托人决定不实现（MCPX-09／10＝BLOCKED）；M1–M6 取数脚本与宽目录沙箱夹具已交付并通过 MCPX-12 核对；vitest 回归无新增失败，本机 demo 已平滑升级；测试台 `UAT-SUITE-MCP-UX-RESILIENCE`＝**PASS WITH GAP**（2026-11-17 宽目录沙箱 Tier-A 跑次 `docs/qa/uat/suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md`；MCPX-09／10 BLOCKED，其余缺口见跑次，不是整套 PASS）。≠ UAT PASS；≠ 可上线**；MCPX-03 依赖 P1-36；MCPX-09／10 为 U3b 伴生（夹具待 O7，不阻塞本条收口） |
| P0-1 | REQ-030-027 | [口径绑定 Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) | [`UAT-SUITE-CALIBER-BINDING`](../qa/uat/suites/question-type-caliber-binding/suite.md) | [2026-11-14 升级后 PASS WITH GAP](../qa/uat/suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋CALIBER-01；CALIBER-02 Wave B 推迟 |
| P0-A | REQ-030-012 | [字段暴露 Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) | [`UAT-SUITE-FIELD-EXPOSURE`](../qa/uat/suites/semantic-source-field-exposure/suite.md) | [2026-11-14 升级后 PASS WITH GAP](../qa/uat/suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋EXPOSURE-01；EXPOSURE-02 Wave B 推迟 |
| P0-4 | REQ-030-022 | [可核对 Spec](../specs/lucy-20261107-answer-verifiability-spec.md) | [`UAT-SUITE-ANSWER-VERIFIABILITY`](../qa/uat/suites/answer-verifiability/suite.md) | [2026-11-14 升级后 PASS](../qa/uat/suites/answer-verifiability/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋AV-01／02 |
| P0-5 | REQ-030-018 | [空结果 Spec](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) | [`UAT-SUITE-EMPTY-NEXT-STEP`](../qa/uat/suites/empty-result-next-step/suite.md) | [2026-11-14 升级后 PASS](../qa/uat/suites/empty-result-next-step/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋EMPTY-01／02 |
| P0-2 | REQ-030-023 | [Catalog 语义 Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) | [`UAT-SUITE-CATALOG-SEMANTICS`](../qa/uat/suites/catalog-business-semantics/suite.md) | [2026-11-14 升级后 PASS](../qa/uat/suites/catalog-business-semantics/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋CATSEM-01／02 |
| P1-15 | REQ-030-036 | [Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md) | [`UAT-SUITE-CONN-RELOAD`](../qa/uat/suites/connection-runtime-reload/suite.md) | [Claude 交叉 2026-11-13 PASS](../qa/uat/suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md) | GATE-01／RELOAD-02 交叉仍 PASS；Cursor 同批见 [cursor-gate-reload](../qa/uat/suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md) |
| P1-16 | REQ-030-037 | [catalog-scan Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) | [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md) | [Cursor Gate A 2026-11-13](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-p120-uat.md)；CASE／DIFF 见 [Claude 交叉](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md) | Gate A：SEED／MYSQL／SIM／KTX **PASS**；EXT-01／02 **BLOCKED**；矩阵／CASE／DIFF 维持既有 PASS；字段续作见 P1-20 |
| P1-20 | REQ-030-041 | [external-catalog-column-read Spec](../specs/lucy-20261113-external-catalog-column-read-spec.md) | [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md)（同套件 SIM／KTX-GUARD／EXT-03…05） | [Cursor Gate A 2026-11-13](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-p120-uat.md) | 实现 `97fe7ee8`；**替身合同有效**（SIM 76/76＋KTX-GUARD `@kaelio/ktx 0.16.0` PASS）；现场 **NOT VERIFIED**（EXT-03…05 BLOCKED——无外部目录库密码）；降级须对 P1-20 单独授权；≠ 可上线 |
| P0-6／7／B | 025／026／028 | draft／冻结 | **`n/a`（未授权实现）** | — | 无交付主张前不强制 UAT |
| P1-11 | REQ-030-032 | [概念→Ops Spec](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md) | [`UAT-SUITE-OPS-CONCEPTS`](../qa/uat/suites/ops-concepts/suite.md) | [2026-11-15 P1-27 复测 PASS](../qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md)（首跑 FAIL 对照：[claude-macmini-p1-11-ops](../qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)） | 复测关 GAP-UAT-P1-11-RUNTIME。≠ 可上线 |
| P1-27 | REQ-030-048 | [代码根运行时修复 Spec](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md) | [`UAT-SUITE-OPS-CONCEPTS`](../qa/uat/suites/ops-concepts/suite.md)（同套件；复测必做 R0-FIX／01／02／03） | [2026-11-15 cursor-p1-27-ops-retest PASS](../qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md) | 关 GAP-UAT-P1-11-RUNTIME；`gitSha=d64414d6…`、`gitDirty=false`；**不入核心分母**；≠ 可上线 |
| P1-12 | REQ-030-033 | [问询预算阈值 Spec](../specs/lucy-20261111-question-budget-threshold-relax-spec.md) | [`UAT-SUITE-QUESTION-BUDGET`](../qa/uat/suites/question-budget/suite.md) | [2026-11-16 rerun PASS](../qa/uat/suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat-rerun.md) | R0／01／02／03／04 全 PASS（修复提交 `299de2c9`；BUDGET-01 已含 60／300；BUDGET-04 `lucy_continue_question` 端到端可用）。此前 2026-11-15 复测 FAIL 已被本跑次取代。≠ 可上线 |
| P1-14 | REQ-030-035 | [预算复盘审计 Spec](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md) | [`UAT-SUITE-BUDGET-AUDIT`](../qa/uat/suites/budget-audit/suite.md) | [2026-11-15 retest PASS](../qa/uat/suites/budget-audit/runs/2026-11-15-cursor-p1-14-audit-retest.md) | 真实 `budget_stop`＋`maxCalls=60`；v1／v2 metadata 形状 PASS。≠ 可上线 |
| P1-13 | REQ-030-034 | [发版性能基线 Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) | [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md) | [2026-11-13 PASS](../qa/uat/suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | Roles／Agent 页体感 UAT；发布取证仍见 acceptance，≠ 可上线 |
| P1-17 | REQ-030-038 | [空桑基 Spec／closure](../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md) | [`UAT-SUITE-ACCESS-MAP`](../qa/uat/suites/access-map-sankey-empty/suite.md) | [2026-11-14 Claude Mac mini PASS](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) | 必做空态 PASS；与 P1-19 同套件同跑次 |
| P1-19 | REQ-030-040 | [允许词表 Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) | [`UAT-SUITE-ACCESS-MAP`](../qa/uat/suites/access-map-sankey-empty/suite.md)（UAT-04） | [2026-11-14 Claude Mac mini PASS](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) | F-1 关闭；`ok` 进 band E；≠ 可上线 |
| P1-18 | REQ-030-039 | Skill closure | **`n/a`（工程向）** | — | 中间态 CLOSED；工程向入口，不强制客户场景 UAT |
| P1-21 | REQ-030-042 | [重读路径 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) | [`UAT-SUITE-EVENT-LOOP-RELIEF`](../qa/uat/suites/event-loop-relief/suite.md) | [2026-11-13 PASS](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md) | 必做 R0／01–04 PASS；可选 LOOP-05 BLOCKED（客户 0.25 无 livez）。≠ 可上线 |
| P1-40 | REQ-030-061 | [Spec 192 §13.5](../../webui/docs/192-clipboard-non-secure-context-fallback-spec.md)（事故修复记录）＋错题 [clipboard-http-fake-success](../lessons/2026-11-17-clipboard-http-fake-success.md)；**修复已落工作树（委托人 2026-11-17「授权修复」），未提交** | [`UAT-SUITE-COPY-FAKE-SUCCESS`](../qa/uat/suites/copy-fake-success/suite.md) | [2026-11-17 修复后 PASS WITH GAP](../qa/uat/suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-after-fix.md)（改前基线 [FAIL](../qa/uat/suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-first.md)） | 同一探针改前 FAIL → 改后 R0／01／02／03 PASS：helper 3/3、7/7 可点入口 REAL。缺口见 GAP-UAT-P1-40。≠ 可上线 |
| P1-31 | REQ-030-052 | [Plan](../plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md)＋[排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)（无运行代码 Spec） | [`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md) | [2026-11-16 重建后 PASS WITH GAP](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md)（首跑 [FAIL](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-15-claude-page-sweep-first.md)） | 整改后路由 02：0 越线／0 失败，96 通过、25 未测；页面 01 40／43 通过；门禁 03 通过、基线 `tracked` 清零。夹具盲区仍为未测。门禁只判退化。≠ 可上线 |
| P1-32 | REQ-030-053 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)（开发授权已获得，实现已落地，待终稿复核） | [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md)（等价守卫）＋[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（UAT-SWEEP-02：F-1／F-6） | [EQUIV 2026-11-16 PASS WITH GAP](../qa/uat/suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md)／[SWEEP 2026-11-16 重建后 PASS WITH GAP](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md) | F-1 inquiry-pack 115 秒→约 0.8 秒、livez 不越线；F-6 不再撞变量上限，v2 导出完整路径夹具缺失仍未测。**不入核心分母**；≠ 可上线 |
| P1-33 | REQ-030-054 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)（同 P1-32） | [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md)＋[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（UAT-SWEEP-02：F-2／F-3／F-4／F-5／F-7） | [EQUIV 2026-11-16 PASS WITH GAP](../qa/uat/suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md)／[SWEEP 2026-11-16 重建后 PASS WITH GAP](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md) | 六条路由全部不越线；`governance/overview` p99 386ms 贴线（余量 14ms）。**不入核心分母**；≠ 可上线 |
| P1-34 | REQ-030-055 | [大 Schema 接入 Spec](../specs/lucy-20261115-large-schema-ingestion-spec.md)（v0.2；开发授权已获得；实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（同日起 5 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）） | [`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md)（必做 R0／01…10；规模下限不得降低） | [2026-11-16 PASS](../qa/uat/suites/large-schema-ingestion/runs/2026-11-16-claude-large-schema-after-impl.md) | 必做 R0／01…10 共 11 条 **PASS**（共 5 次完整跑，第 2 次 SCALE-09 异常 FAIL 未定位；可选 11／12 未执行；SCALE-09 测量对象已更换；第 5 次在干净提交 `gitDirty=false` 上复跑全绿）。承接 P1-16／P1-20 的规模缺口。**不入核心分母**；功能合同收口另行判定；≠ 可上线 |
| P1-30 | REQ-030-051 | 设计 [context-content](../design/design-2026-11-15-uat-context-content-wiki-skill.md)（测试台合同；无运行代码 Spec） | [`UAT-SUITE-CONTEXT-CONTENT`](../qa/uat/suites/context-content/suite.md) | [2026-11-15 Claude](../qa/uat/suites/context-content/runs/2026-11-15-claude-ctx-content.md)／[Cursor CLI](../qa/uat/suites/context-content/runs/2026-11-15-cursor-cli-ctx-content.md) | **PASS WITH GAP**（WIKI-01S BLOCKED＝GAP-2）。**不入核心分母**；≠ 可上线 |
| P1-28 | REQ-030-049 | 无独立 Spec（不改既有行权限 Spec 状态） | [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md) | [2026-11-15 retest FAIL](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md) | **入核心分母**。ROW-02／03／05 仍 BLOCKED（歧义门闩）。≠ 可上线 |
| P1-29 | REQ-030-050 | 无实现 Spec | [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md)（UAT-ROW-07） | [2026-11-15 retest FAIL](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md) | 取值存在性缺口。**不入核心分母**。≠ 可上线 |
| 其余 P1／P2 | … | 见总账 | **`not_registered` 或 `n/a`** | — | 出门前按 DEVELOPMENT 兜底扫 |

取值约定：

| 测试台单元格 | 含义 |
|---|---|
| Suite ID＋链接 | 已挂测试台 |
| `not_registered` | 需求／开发台有行或主张，测试台尚无套件（**缺口，须补或降叙事**） |
| `n/a` | 明确不要求客户场景 UAT（冻结未实现、纯工程向且叙事已标工程向） |

## 3. 兜底队列（现行缺口）

| ID | 缺口 | 建议动作 | 优先级 |
|---|---|---|---|
| GAP-UAT-P0 | ~~P0-1…5／A 无 UAT 套件~~ | **已挂六套**（方案 B）。**2026-11-14 升级后复跑**：[Plan](../plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)；跑次 `…-p0-post-upgrade`；容器 `gitSha=9d59337d`（≠ 上午 Wave A `3aa402c9`）。必做含 `UAT-R0-UPGRADE`：P0-3／4／5／2 **PASS**；P0-1／A **PASS WITH GAP**（Wave B 仍推迟）；SAG-02 **BLOCKED**。≠ 可上线；≠ 核心升级完成 | P1 |
| GAP-UAT-P0-3-ESCAPE | P0-3／P1-35 纯 MCP 逃生未通 | **已关闭（2026-11-16 夜，v0.4）**：v2 必做 ESC-07／08 在 v0.3 构建 FAIL（[fidelity](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-fidelity.md)）→ v0.4 实现后 ESC-01～10 全绿，INDEX＝PASS（[v0.4 跑次](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)）。≠ D5／功能合同收口 ≠ 可上线 | P0 |
| GAP-UAT-P1-13 | ~~P1-13 无客户场景 UAT~~ | **已挂** [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md)；发布取证 acceptance 仍独立，≠ 可上线 | P2 |
| GAP-UAT-P1-17 | ~~空桑基 04／F-1~~ | **已关闭（2026-11-14）**：P1-19 落地后 [claude-macmini-p119](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) 必做＋04 **PASS**。遗留观察：`deniedCalls` 页面未呈现（可观测性，另单）。≠ 可上线 | P2 |
| GAP-UAT-P1-18 | Skill 入口 CLOSED，工程向 | 勾连表已标 `n/a`（工程向）；保持工程向叙事 | P2 |
| GAP-UAT-P1-36 | P1-36 trace 级流水无跑次 | 套件已挂（NOT RUN）。实现授权后先跑**改前基线**（TRC-01／06／07／09），再实现；基线 FAIL 入账，不得写 PASS | P1 |
| GAP-UAT-P1-38 | P1-38 推断问询补算尚无客户场景套件 | 测试台 not_registered。关闭条件：另立套件并有跑次，INDEX 有判定。本缺口不把 vitest 写成 UAT PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-40 | P1-40 复制按钮假成功：修复后 **PASS WITH GAP** | 缺口：①审计对账复制按钮在 demo 禁用（NOT-RUN）；②8 个 helper-only 入口未逐个点（由 01 承载）；③公网演示实例未升级、UAT-COPY-04 未跑；④修复在工作树未提交；⑤对话框内复制路径无探针独立实证；⑥`clipboard-fallback.spec.ts` 仍打桩跑回环。关闭条件：修复提交合入＋公网实例升级后跑 04（或等价非回环 HTTP 实例）＋有数据的实例补点对账入口。不得靠放宽探针翻绿。≠ 可上线 | P1 |
| GAP-UAT-P1-37 | P1-37 体验韧性无跑次 | 套件已挂（NOT RUN）。实现授权后先跑**改前基线**（MCPX-01／02／04～08）；MCPX-03 待 P1-36；MCPX-09／10 为 U3b 伴生，夹具待 O7（持续失效），不阻塞本条收口；404 形态待 O6 取证 | P1 |
| GAP-UAT-EXT | P1-16 EXT-01／02 与 P1-20 EXT-03…05 live **BLOCKED**（无外部目录库密码／无 `catalog.database` 凭据路径；vitest／KTX-GUARD 不得写成 EXT live PASS） | Gate A 已复跑（[cursor-p120-uat](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-p120-uat.md)）：替身＋KTX **PASS**。**P1-20 现场仍 NOT VERIFIED**。要关闭：提供容器内可达的真实外部目录连接（凭据仅给路径）后补跑 EXT-03…05，或委托人对 P1-20 书面授权以替身收口 | P1 |
| GAP-UAT-MYSQL-VER | P1-16 矩阵自 5.7 | **已关闭（2026-11-13）**：`mysql:5.7` 拉取成功后矩阵 **5.7.44／8.0.46／8.4.13 PASS**。见 [补跑](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-mysql-version-matrix-57.md)。跑次镜像 `gitSha=ea4ef839`，不含其后的 `aa559a1c` | P2 |
| GAP-LINK-POOL | 总账行未普遍挂 Suite 列 | 以本勾连表为准；总账 Spec／Plan 列逐步回链 | P2 |
| GAP-UAT-P1-21 | ~~套件尚未执行~~；可选客户维护窗 LOOP-05 仍 BLOCKED | **必做已 PASS**（[2026-11-13-cursor-demo-event-loop](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)）。客户升到含 `/api/livez` 后维护窗再跑 LOOP-05；高峰禁止 `hours=168`。≠ 可上线 | P2 |
| GAP-UAT-P1-11-RUNTIME | ~~P1-11 业务受理 FAIL（代码根装配）~~ | **已关闭（2026-11-15）**：P1-27 复测 [cursor-p1-27-ops-retest](../qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md) R0-FIX／01／02／03 **PASS**；INDEX＝PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-31 | 全页面／全 GET 路由事件循环看守：首跑 **FAIL**；整改后复跑（2026-11-16）**PASS WITH GAP**——0 越线／0 失败，25 路由与 3 页面未测 | 整改已落地、基线 `tracked` 已清零、`SWEEP_STRICT=1` 对本次报告回放通过。**剩余缺口＝夹具盲区**：评测运行、语义资产操作、完整性合法的 v2 导出（`export-v2`／`export-pack-v2` 现为 409 `integrity_or_relation_failed`）、`export-pack`（413）、宿主无 ktx；另 `governance/overview` livez p99 372ms 贴线。关闭条件：补齐夹具使「未测」转「已测」且无缺口，INDEX＝PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-34 | 必做 R0／01…10 已 PASS（2026-11-16，PASS WITH GAP）；**剩余**：**第 2 次完整跑 SCALE-09 耗时 171 秒原因未定位**（之后 6 次单跑未复现）；可选 SCALE-11（写入与热重载）、12（12000 表）未执行；SCALE-09 测量对象更换后须评审认可；demo 自带内联口令连接的回退路径规模未测 | 规模下限不得降低；缩小夹具只能记 SKIPPED。≠ 功能合同收口；≠ 可上线 | P1 |
| GAP-UAT-P1-28 | 行级隔离场景未过 | 关闭条件：必做全部达到期望且 INDEX＝PASS。当前 [retest](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md) 仍 **FAIL**（ROW-02／03／05 BLOCKED：begin 后空候选／`caliber_binding_unresolved`）。≠ 可上线 | P1 |
| GAP-UAT-P1-28-VALUE | 配错取值仍能保存 | 归 **P1-29／REQ-030-050**。UAT-ROW-07 在现行代码上预期 FAIL。关闭条件：保存被拒绝或出现「取值不存在」警告，且 INDEX 中该条不再 FAIL。未授权实现 | P1 |

机器兜底：

```bash
node scripts/uat/check-e2e-ledger.mjs
```

## 4. 基准线追评（2026-11-13）

### 4.1 已立住的

1. **需求台**：清单池已升格为产品线执行总账（v0.51+），含差集补录 P1-15…18；先入账再叙事有口令。  
2. **开发台**：Spec 头部唯一现值＋镜像纪律长期存在；`stale-status` 有机器牙。  
3. **测试台唯一 SOT**：[`docs/qa/uat/`](../qa/uat/README.md)（判定＝[`INDEX.md`](../qa/uat/INDEX.md)）。旧 [`docs/uat/`](../uat/README.md) 已降为历史归档。现行套件含 P0 问数六套＋P1 连接／扫表／桑基／性能／event-loop 等（以 INDEX 为准）。
4. **规则层**：DEVELOPMENT 已写总账 SOT；本文件补齐三台勾连与测试台兜底。

### 4.2 仍弱的（基准线缺口）

1. **测试台覆盖极窄**：P0 主线问数合同已收口，但 **UAT 套件数＝2**，相对总账行数严重不足；「收口」易被误读成「测过」。  
2. **发布取证与测试台边界**：P1-13 已挂客户场景套件 `UAT-SUITE-ROLES-AGENT-PERF`；发布取证 acceptance 仍独立一层，禁止把 UAT 绿写成可上线。  
3. **总账表尚未结构化「测试台」列**：靠本勾连表＋人工，易再次漂移。  
4. **机器兜底偏软**：`check-e2e-ledger.mjs` 只验链接存在，不验跑次是否过期、不验与 Spec 状态逻辑一致。  
5. **历史债**：大量「功能合同已收口」行默认 `not_registered`，出门若无差集扫描会再次漏登。

### 4.3 基准线判定（一句话）

> **需求台／开发台基准可用；测试台已覆盖 P0 问数六件套（方案 B）＋既有 P1 四套。可主张场景 UAT 的范围仍窄于总账行数——P0-1／A 与 P1-16／17 带 GAP；冻结／未实现条目不得声称 UAT 完成；≠ 可上线。**

### 4.4 下一刀（不在本文件自动开工）

1. 为 P0-1…5／A 各定：补 UAT 套件 **或** 显式 `n/a`＋理由。  
2. 总账 §3 增加「测试台」指针列（或稳定外链本表）。  
3. 将 `check-e2e-ledger.mjs` 挂到可选 npm script／出门 checklist。  
4. 明确发布取证与测试台的边界句（仍禁止混写可上线）。

## 5. 变更

| 日期 | 内容 |
|---|---|
| 2026-11-17 | **P1-40 修复落地（工作树）＋复跑 PASS WITH GAP**：委托人「授权修复」（事故修复授权）；`clipboard.ts` 降级路径改为聚焦并全选 textarea、确认选区后才调用 `execCommand`；同一探针改前 FAIL → 改后 helper 3/3、7/7 可点入口 REAL。更新 GAP-UAT-P1-40。**未提交；≠ 可上线** |
| 2026-11-17 | **入池 P1-40／REQ-030-061**：明文 HTTP 下复制按钮假成功（错题 clipboard-http-fake-success）。委托人授权调研并收敛 UAT／机制：挂 `UAT-SUITE-COPY-FAKE-SUCCESS`（首跑 **FAIL**）＋`lint:copy-surfaces` 登记门禁；开 GAP-UAT-P1-40。**修复 `clipboard.ts` 未授权**。不入核心分母。**≠ 可上线** |
| 2026-11-17 | **入池 P1-38／REQ-030-059**：推断问询补算让出事件循环。勾连 Spec，测试台 not_registered，开 GAP-UAT-P1-38。终稿未确权。**≠ 可上线** |
| 2026-11-17 | **P1-36／P1-37 沙箱 Tier-A UAT 跑次**：两套件 INDEX＝**PASS WITH GAP**（TRC-07/08/09 NOT RUN；MCPX-09／10 BLOCKED）；U1／U4 由宽目录沙箱实证后修复；登记发现 F-1～F-5（F-2 正式完整导出既有 F-02 失败关闭；F-3 SC-06 与 §6.2 口径冲突待委托人裁定）。**≠ UAT 整套 PASS；≠ 可上线**。跑次 `docs/qa/uat/suites/*/runs/2026-11-17-claude-wide-sandbox-tierA.md` |
| 2026-11-17 | **P1-36／P1-37 开发落地**：委托人「授权开发落地」；P1-36 代码落地；P1-37 仅 U2／U3a（U1／U4 无证据未改，U3b 不实现）。两套件仍 NOT RUN，GAP-UAT-P1-36／P1-37 保持开启。[取证记录](../reviews/2026-11-17-p1-36-p1-37-implementation-evidence.md)。**≠ UAT PASS；≠ 可上线** |
| 2026-11-16 | **P1-36／P1-37 入池并挂测试台**：调用流水 trace 级可追溯与存档（REQ-030-057）；MCP 体验韧性（REQ-030-058）。套件 `UAT-SUITE-TRACE-LEDGER`／`UAT-SUITE-MCP-UX-RESILIENCE` 先于实现登记，INDEX＝NOT RUN；开 GAP-UAT-P1-36／GAP-UAT-P1-37。仅文档；**≠ 开发授权；≠ 可上线** |
| 2026-11-16 | **P1-35 v0.4 实现＋ESCAPE UAT PASS**：委托人免 Codex 确权并授权开发；容错三档（放行＋`sourceSelection` 披露＋审计 JSONL）落地；跑次 [v0.4](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md) R0／ESC-01～10 全绿；INDEX＝PASS；关闭 GAP-UAT-P0-3-ESCAPE。SAG-01 升 v3（硬线仍拦）。**≠ D5／功能合同收口 ≠ 可上线** |
| 2026-11-16 | **P1-35 Spec v0.4-draft**：委托人批准方向 B＋容错披露三档（选表歧义降为披露＋审计；披露载体＝响应字段；审计只记录）；新增 D10–D15、§4.5 支持矩阵、SC-E20–E30；UAT 修订 ESC-06／07／08 并新增 ESC-09／10（NOT RUN）。**待 Codex 终审与开发授权；≠ 可上线**
| 2026-11-16 | **P1-35 ESCAPE UAT v2 升必做并 FAIL**：委托人以「分析师群体通用性」为标准，ESC-04～08 升必做；全真跑次 [fidelity](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-fidelity.md) ESC-07／08 FAIL；INDEX＝FAIL；重开 GAP-UAT-P0-3-ESCAPE。≠ 开发授权；≠ 可上线 |
| 2026-11-16 | **P1-35 ESCAPE UAT PASS**：复测 [cursor-sag-escape-retest](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-retest.md)；INDEX＝PASS；关闭 GAP-UAT-P0-3-ESCAPE；SAG-01 v2 伴生 deny PASS。**≠ D5／功能合同收口 ≠ 可上线** |
| 2026-11-16 | **P1-35／REQ-030-056 Spec／Plan 落盘**：纯 MCP 逃生持久修复（钉选放行＋五项证据）；勾连逃生 UAT 与 GAP-UAT-P0-3-ESCAPE。**待 R2-F／R4**；≠ 可上线 |
| 2026-11-16 | **P0-3 纯 MCP 逃生 UAT 基线 FAIL**：挂 [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)；跑次 [claude-sag-escape-baseline](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-claude-sag-escape-baseline.md)；开 GAP-UAT-P0-3-ESCAPE。≠ 开发授权；≠ 可上线 |
| 2026-11-16 | **P1-34 测试台复跑**：用本机 demo 管理员登录，在新实现上跑 `UAT-SUITE-LARGE-SCHEMA` 必做 R0／01…10＝11 条全 PASS，跑次 [claude-large-schema-after-impl](../qa/uat/suites/large-schema-ingestion/runs/2026-11-16-claude-large-schema-after-impl.md)。UAT-SCALE-09 测量对象由旧的逐张合并改为真实客户端读取路径，预算不变。可选 11／12 未执行 |
| 2026-11-16 | **P1-12 问询预算复跑 PASS**（Docker 重建后，修复提交 `299de2c9`）：跑次 [cursor-p1-12-budget-uat-rerun](../qa/uat/suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat-rerun.md)；R0／01／02／03／04 全 PASS——BUDGET-01 已由 `299de2c9` 修复（initialize instructions 含 60 次／300 秒），BUDGET-03 第 61 次 `question_budget_exhausted` 成立，BUDGET-04 `lucy_continue_question` 续查端到端可用；INDEX＝PASS（此前 2026-11-15 复测 FAIL 记录被本跑次取代）。≠ 可上线 |
| 2026-11-15 | **P1-34 大 Schema 接入测试台登记**：挂 `UAT-SUITE-LARGE-SCHEMA`（规模下限：MySQL 1200 表＋1000 列宽表；外部目录 600 表＋1500–5000 列宽表；一次勾选 600 张）；基线跑次 [claude-large-schema-baseline](../qa/uat/suites/large-schema-ingestion/runs/2026-11-15-claude-large-schema-baseline.md)＝**FAIL**（SCALE-09 FAIL；其余 BLOCKED）；开 GAP-UAT-P1-34；Spec／Plan 已落盘、开发未授权。≠ 可上线 |
| 2026-11-15 | **P1-12／P1-14 复测**：P1-12 [budget-retest](../qa/uat/suites/question-budget/runs/2026-11-15-cursor-p1-12-budget-retest.md)＝**FAIL**（BUDGET-03 PASS；BUDGET-01 仍 FAIL）；P1-14 [audit-retest](../qa/uat/suites/budget-audit/runs/2026-11-15-cursor-p1-14-audit-retest.md)＝**PASS**。证据 `inbox/uat-p1-12-14-retest-2026-11-15/`。≠ 可上线 |
| 2026-11-15 | **P1-12／P1-14 测试台首跑 FAIL**：INDEX 挂两套；跑次 [p1-12-budget](../qa/uat/suites/question-budget/runs/2026-11-15-cursor-p1-12-budget.md)／[p1-14-audit](../qa/uat/suites/budget-audit/runs/2026-11-15-cursor-p1-14-audit.md)。Plan [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)。≠ 可上线 |
| 2026-11-15 | **P1-27 复测 PASS**：跑次 [cursor-p1-27-ops-retest](../qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md)；关闭 GAP-UAT-P1-11-RUNTIME；Plan [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)。≠ 可上线 |
| 2026-11-15 | **P1-28／P1-29 测试台首跑 FAIL**：挂 `UAT-SUITE-ROW-POLICY`；跑次 [cursor-row-policy-first](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-first.md)；ROW-02／03／05 BLOCKED；ROW-07 预期 FAIL（GAP-UAT-P1-28-VALUE）；ROW-08 已清理且 proven 恢复未设置。≠ 可上线 |
| 2026-11-15 | **P1-11／P1-27 测试台登记**：INDEX 挂 `UAT-SUITE-OPS-CONCEPTS`＝**FAIL**（[claude-macmini-p1-11-ops](../qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)）；勾连 P1-11＋P1-27；开 GAP-UAT-P1-11-RUNTIME；cases 落盘 `UAT-R0-FIX`／强化 02 供复跑；**复测 NOT RUN、不重建**；≠ 可上线 |
| 2026-11-15 | **P1-30／REQ-030-051 首跑 PASS WITH GAP**：挂 `UAT-SUITE-CONTEXT-CONTENT`；双宿主 CLI；WIKI-01S BLOCKED（GAP-2）；证据 `inbox/uat-ctx-content-2026-11-15/`；≠ 可上线 |
| 2026-11-14 | **P0 六套升级后复跑**：Claude＋Cursor；新增 `UAT-R0-UPGRADE`；INDEX／本表／lint 指 `2026-11-14-claude-macmini-p0-post-upgrade`；`gitSha=9d59337d`。Plan [`lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md`](../plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)。≠ 可上线 |
| 2026-11-14 | **P1-19／ACCESS-MAP UAT 复跑 PASS**：Claude Mac mini；[跑次](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md)；F-1 关闭；P1-19 退出 `not_registered`；GAP-UAT-P1-17 关闭。Plan [`lucy-20261114-p1-19-access-map-uat-multi-agent-plan.md`](../plans/lucy-20261114-p1-19-access-map-uat-multi-agent-plan.md)。≠ 可上线 |
| 2026-11-14 | **测试台唯一 SOT 对齐**：明文 [`docs/qa/uat/`](../qa/uat/README.md)／[`INDEX.md`](../qa/uat/INDEX.md) 为唯一 UAT SOT；旧 [`docs/uat/`](../uat/README.md) 降为历史归档＋文件头提示；`check-e2e-ledger` P0 latestRun 对齐 `2026-11-14-claude-macmini-p0-qa` |
| 2026-11-14 | **P0 问数六套件 Mac mini 复跑（Wave A）**：Claude 全真；INDEX／本勾连表已指 `2026-11-14-claude-macmini-p0-qa`；Plan [`lucy-20261114-p0-mac-mini-uat-cursor-claude-plan.md`](../plans/lucy-20261114-p0-mac-mini-uat-cursor-claude-plan.md)。P0-3／4／5／2 PASS；P0-1／A PASS WITH GAP（Wave B 推迟）；SAG-02 BLOCKED。容器 `3aa402c9`。**≠ 改 Spec 合同；≠ 可上线** |
| 2026-11-13 | P1-20 Gate A 复跑（[cursor-p120-uat](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-p120-uat.md)）：SIM 76/76＋KTX-GUARD PASS＝替身有效；EXT-03…05 BLOCKED（无外部目录库密码）→ 现场 NOT VERIFIED；≠ 可上线 |
| 2026-11-13 | **P0 问数六套件（方案 B）**：挂 SOURCE-AMBIGUITY／CALIBER-BINDING／FIELD-EXPOSURE／ANSWER-VERIFIABILITY／EMPTY-NEXT-STEP／CATALOG-SEMANTICS；Cursor demo MCP 跑次；GAP-UAT-P0 降为夹具债 |
| 2026-11-13 | CASE-01／DIFF-01 在升级后的 demo 复跑 PASS，Claude 交叉（`Bar`／`bar`、双缺表）仍 PASS。EXT live 仍 BLOCKED |
| 2026-11-13 | 本机补跑 zhaomin 缺口：GATE-01／RELOAD-02 PASS；CASE-01／DIFF-01 当时 FAIL（镜像 `ea4ef839`） |
| 2026-11-13 | P1-16 矩阵补跑：5.7／8.0／8.4 PASS；EXT live 仍 BLOCKED。关闭 GAP-UAT-MYSQL-VER |
| 2026-11-13 | 挂 P1-13 ↔ `UAT-SUITE-ROLES-AGENT-PERF`（Roles／Agent 页体感） |
| 2026-11-13 | 首立：三台指针、勾连表、兜底队列、基准线追评；挂 P1-15／P1-16 |
