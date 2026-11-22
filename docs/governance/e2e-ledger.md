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
| P1-74 | REQ-030-095 | [问询预算主路径逃生 Spec](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md) · [Plan](../plans/lucy-20261122-question-budget-mainpath-escape-plan.md) | [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/suite.md) | [PASS WITH GAPS](../qa/uat/suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md) | 开发台 S5 scoped（2026-11-22）；实现 `72d47cb0`＋CR APPROVE；UAT 功能轴 PASS WITH GAPS；BESC-07／10A／Wave D 全量入收口范围另案。≠ 完整 UAT PASS；≠ 可上线。 |
| P1-72 | REQ-030-093 | [Spec](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) · [Plan](../plans/lucy-20261120-row-policy-automatic-enforcement-plan.md) | [UAT-SUITE-ROW-POLICY-AUTO](../qa/uat/suites/row-policy-automatic-enforcement/suite.md) | [PASS](../qa/uat/suites/row-policy-automatic-enforcement/runs/2026-11-20-codex-default-row-policy.md) | v1.0。终稿已确权；开发授权已获得；实现与 Codex CLI 代码终审完成；功能合同已收口（定向回归286项、脚本合同97项、隔离Docker39项）；测试台 UAT-SUITE-ROW-POLICY-AUTO PASS；扩展回归与全仓门禁既有缺口单列，远端CI未执行；不入核心分母；≠ 可上线。 |
| P1-71 | REQ-030-092 | [Spec](../specs/lucy-20261120-storage-readiness-spec.md) · [Plan](../plans/lucy-20261120-storage-readiness-plan.md) | [UAT-SUITE-STORAGE-READINESS](../qa/uat/suites/storage-readiness/suite.md) | **NOT RUN** | v0.1-draft。0.30 不开发；准备材料保留在需求池作下一期开发目标。源码盘点、风险差集与 Spec／Plan／UAT 设计已落盘；终稿未确权；未获开发授权；不升级、不迁移、不操作客户实例；测试台 NOT RUN；不入核心分母；≠ 功能合同收口；≠ 可上线。 |
| P1-69 | REQ-030-090 | [Spec](../specs/lucy-20261120-runtime-reload-drain-spec.md) · [Plan](../plans/lucy-20261120-runtime-reload-drain-plan.md) | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) | [r6限定通过](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-directed.md) | v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 GAP-UAT-P1-69。 |
| P1-70 | REQ-030-091 | [Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md) · [Plan](../plans/lucy-20261120-semantic-read-write-settle-plan.md) | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) | [r6定向完成](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-directed.md)；五项实际及独立SQL有效，局部功能收口；原FAIL及正式组合严格FAIL保留 | v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 组合／远端CI缺口独立登记。 |
| P1-68 | REQ-030-089 | [运维步骤账 Spec](../specs/lucy-20261120-ops-step-journal-spec.md) · [Plan](../plans/lucy-20261120-ops-step-journal-plan.md) | [UAT-SUITE-OPS-STEP](../qa/uat/suites/ops-step/suite.md) | **PASS WITH GAP** | 开发台 S5 scoped（2026-11-22）；R0／01–08 PASS（gitSha=88b2e9ea）；设计值重度 GAP 另期。不入核心分母；≠ 可上线。 |
| P1-66 | REQ-030-087 | [名册摘要 Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [Plan](../plans/lucy-20261120-agent-roster-summary-projection-plan.md) | [UAT-SUITE-AGENT-ROSTER-SUMMARY](../qa/uat/suites/agent-roster-summary/suite.md) | PASS WITH GAP（F66-A）；原F66 FAIL保留 | v0.3。委托人2026-11-20批准分批收敛及本进程commit；批次A功能合同已收口；本机Docker最小验收PASS WITH GAP；批次B暂停，原v0.2完整矩阵FAIL保留；本批增量提交；未推送／发布；不入核心分母；本批收口不表示可上线。 GAP-UAT-P1-66；不改变 P1-58／59 现值。 |
| P1-61 | REQ-030-082 | [存活／就绪探针纯内存响应与诊断隔离](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) | [2026-11-22 prepack 定向 PASS WITH GAP](../qa/uat/suites/core-availability/runs/2026-11-22-cursor-prepack-cav-directed.md)；[修复局部](../qa/uat/suites/core-availability/runs/2026-11-20-codex-availability-merge-recheck.md) | 出包前候选 `prepack-8e3e3f24`／`8e3e3f24` 上 CAV-01 定向复验 PASS WITH GAP；F61完整矩阵未完成；前次FAIL／r6 整套 FAIL 保留；R-CAV NOT RUN；GAP-UAT-P1-61保持打开（完整矩阵）。≠ 可上线；≠ 出包。 |
| P1-62 | REQ-030-083 | [重任务跨模块容量控制与许可生命周期](../specs/lucy-20261119-heavy-work-capacity-control-spec.md) | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) | [局部PASS WITH GAP：仅导出](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repro.md) | F62完整矩阵未完成；实现已落地，本次局部执行已授权；R-CAV归P1-13，NOT RUN；GAP-UAT-P1-62保持打开。 |
| P1-63 | REQ-030-084 | [进程关停准入关闭与在途请求排空](../specs/lucy-20261119-process-drain-lifecycle-spec.md) | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) | [2026-11-22 prepack 定向 PASS WITH GAP](../qa/uat/suites/core-availability/runs/2026-11-22-cursor-prepack-cav-directed.md)；[修复局部](../qa/uat/suites/core-availability/runs/2026-11-20-codex-availability-merge-recheck.md) | 出包前同候选 CAV-02 fault／control 定向 PASS WITH GAP（TERM 查询成交＋同卷恢复）；完整 F63 矩阵未完成；前次FAIL／r6 保留；R-CAV NOT RUN；GAP-UAT-P1-63保持打开（完整矩阵）。≠ 可上线；≠ 出包。 |
| P1-64 | REQ-030-085 | [短名唯一性与保存 ack Spec](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md) · [Plan](../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md) | [UAT-SUITE-SOURCE-SHORTNAME-CONFLICT](../qa/uat/suites/source-shortname-conflict/suite.md) | [合并最终候选复验](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md)；判定见INDEX | v0.4。功能合同已收口（SC-01–10通过；合并候选全库TypeScript0错误，782项Vitest及29项概念模块回归通过，真实前台浏览器计时完成）；本轮增量已提交；未推送／发布；不入核心分母；本条收口不表示可上线。 GAP-UAT-P1-64已关闭，SC-09通过。 |
| P1-65 | REQ-030-086 | [Wiki 覆盖上传 YAML 授权采用 Spec](../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) · [Plan](../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md) | [UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION](../qa/uat/suites/wiki-upload-acl-adoption/suite.md) | [本轮收口复核 PASS](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md)；历史基线 FAIL 保留 | v0.2。终稿已确权；开发授权已获得；实现完成；四项验证缺口已整改；改后 Docker UAT＝PASS（见测试台 INDEX）；功能合同已收口；不入核心分母；≠ 可上线。 GAP-UAT-P1-65 已经本轮真实补跑关闭。 |
| P1-60 | REQ-030-081 | [零绑定begin Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md) · [Plan](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) | [UAT-SUITE-BEGIN-ZERO-BINDING](../qa/uat/suites/begin-zero-binding/suite.md) | [合并候选完整R](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final.md)；判定见INDEX | v0.9；功能合同已收口（SC-01–12通过，P1-60／P1-64同一冻结候选完整复验）；预算持久化锁竞争修复纳入；本轮增量已提交；未推送／发布；不入新增核心分母；本条收口不表示可上线。 |
| P1-58 | REQ-030-079 | [读取响应 Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) | [UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) | PASS WITH GAP（仅B1）；完整 F58／2×／5×／R 另期 | **S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1）**；[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。≠ 可上线 |
| P1-59 | REQ-030-080 | [多人编辑 Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md) | [UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) | PASS WITH GAP（仅B1）；完整 F59／DEP／R 另期 | **S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1）**；[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。≠ 可上线 |
| P1-57 | REQ-030-078 | [整改 Plan](../plans/lucy-20261119-fde-acceptance-remediation-plan.md)；复用 P1-34 §11／P1-38 §8／v2p5 N26 | [`UAT-SUITE-FDE-PACKCHECK`](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md)（修复模式） | [FAIL（共享套件；局部通过见跑次）](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) ；D7：正式完整导出延期，本次限定客户功能测试可进行 | v1.2。D1–D5／Task1–7修复复验已执行，R1／R2修复，G7–G9测程缺口已补齐。委托人2026-11-19明示正式完整导出“可以先不修，未来再修”；G6该子项延期、待另行安排。原完整范围UAT实测FAIL保留；本次客户功能测试排除正式CSV／ZIP导出，可按限定范围进行，D5边界保留。D6未授权实施，本次延期仅改登记；不入核心分母；≠ 可上线。 缺口 GAP-UAT-P1-57 |
| P1-55 | REQ-030-076 | [本机复现 Plan](../plans/lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md) | [`UAT-SUITE-FDE-PACKCHECK`](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md) | [BLOCKED](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-fix-review.md) ；新修复模式 [FAIL](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) ；D7：正式完整导出延期，本次限定客户功能测试可进行 | v0.3；旧候选及基线的L1复现已完成，原四基线完整L2未完成，旧复现模式历史BLOCKED保留。P1-57新修复模式原完整范围实测FAIL保留；委托人2026-11-19延期G6正式完整导出，本次客户功能测试排除此项，可按限定范围进行。真实局部结果及D5边界见跑次，本条不另授权运行代码；≠ 可上线。 缺口 GAP-UAT-P1-55 |
| P1-56 | REQ-030-077 | [上一批整改 Plan](../plans/lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)；相关 Spec 现值见各自头部 | [`UAT-SUITE-FDE-PACKCHECK`](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md) | [FAIL（共享套件；局部通过见跑次）](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) ；D7：正式完整导出延期，本次限定客户功能测试可进行 | v1.0 上一批实现 d8c3f097 及复评记录保留；混合权限与全局请求上限已由获授权的 P1-57 修复并复验。原完整范围FDE实测FAIL保留；委托人2026-11-19已将G6正式完整导出基线缺口延期，本次客户功能测试排除此项，可按限定范围进行，不声称导出已修复。O3仍未授权，D6未实施；≠ 可上线。 缺口 GAP-UAT-P1-56 |
| P1-54 | REQ-030-075 | [独立多场景题库 Spec](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) | [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md)（共享） | **PASS**（共享；P1-53 candidate） | **S5｜v1.1。功能合同已收口（2026-11-22）**；严口径证据仍有效；共享 INDEX 由 P1-53 certifyCandidate 升 **PASS**。≠ 可上线。GAP-UAT-P1-54 **关闭（开发台）** |
| P1-53 | REQ-030-074 | [MCP 升级兼容底线 Spec](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) | [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md) | **PASS** | **X_REL｜v1.1。发布取证已收口（2026-11-22）**；四入口全真＋SC／CR；[收口](../reviews/2026-11-22-p1-53-xrel-closure-record.md)。≠ 可上线。GAP-UAT-P1-53 **关闭** |
| P0-3 | REQ-030-024 | [歧义门闩 Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) | [`UAT-SUITE-SOURCE-AMBIGUITY`](../qa/uat/suites/source-ambiguity-gate/suite.md)＋[`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) | 拦得住：[2026-11-14 升级后 PASS](../qa/uat/suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md)；**逃生**：[2026-11-16 retest PASS](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-retest.md) | SAG-02 BLOCKED；逃生缺口已关（P1-35）。SAG-01 v2 伴生 deny PASS。≠ 可上线 |
| P1-35 | REQ-030-056 | [纯 MCP 逃生 Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) | [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) | [2026-11-18 post-rebuild PASS](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md) | **S5｜v0.4。功能合同已收口（2026-11-22）**；ESCAPE INDEX＝**PASS**（含 ESC-11）；SC-E 证据＋实现 CR PASS；GAP-UAT-P0-3-ESCAPE **关闭**。本条收口不表示可上线 |
| P1-36 | REQ-030-057 | [trace 级流水 Spec](../specs/lucy-20261116-trace-span-ledger-spec.md) | [`UAT-SUITE-TRACE-LEDGER`](../qa/uat/suites/trace-span-ledger/suite.md) | **PASS WITH GAP**（沙箱 Tier-A；TRC-07/08/09 NOT RUN） | **S5｜v1.1；功能合同已收口（2026-11-22，scoped）**；[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。GAP-UAT-P1-36 标注残余另期。≠ 可上线 |
| P1-38 | REQ-030-059 | [Spec](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md) | [`UAT-SUITE-FDE-PACKCHECK`](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md)（共享） | [FAIL（共享套件；局部通过见跑次）](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) ；D7：正式完整导出延期，本次限定客户功能测试可进行 | 主体 v0.2-draft 终稿未确权；§8 v0.4 已确权并实现，§8.9 已获委托人确认补验。SC-11–16 本轮证据补齐：完整窗口至少20万调用、三轮默认冷启动通过，含3163行原用户闭包完整收敛。P3 的 ↓ 保留，SC-16 补偿在受测范围通过；O3 存量批量标脏仍未授权。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 |
| P1-39 | REQ-030-060 | [冷启动审计扫描 Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md) | [`UAT-SUITE-COLD-START-SLOW-DISK`](../qa/uat/suites/cold-start-slow-disk/suite.md) | [p145-p147 复跑 PASS](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-p145-p147.md)／[801b9c02 FAIL（03／04）](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-fix-801b9c02.md)／[改前基线 FAIL](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-17-cursor-docker-baseline.md) | **v0.3。冷启动后的同步读取不再随历史总行数或磁盘延迟失控：启动补算与稳态轮询都不再整条扫描 access_log（启动补算改为按用户逐个探测，轮询改为不带 DISTINCT 的 id 水位范围读取并在代码里去重）；启动不再把窗口内全部用户一律标脏后做 30 天整段重建，只补算有未处理新行的用户，补算每一页同步读取按时间预算收敛；审计库两个连接的打开与迁移（含 foreign_key_check）在 app.listen 之前完成。本机慢盘冷缓存台实测：HEAD 7b882c7c 旧库首次升级与已迁移库重启都在 onReady 阶段 FST_ERR_HOOK_TIMEOUT 崩溃；启动幸存时就绪后 livez 反复 1.6–9.9 秒且进程不死，补算单页（400 行）同步读取 2.7–5.9 秒（热缓存 1–2 毫秒）；0.25.0 对照 30.8 秒就绪。测试台 UAT-SUITE-COLD-START-SLOW-DISK 已建。终稿已确权、开发已授权（委托人 2026-11-18「授权定稿，进入开发」；不含新增持久化表等 schema 变更，不含线上升级）。代码已实现，vitest 守卫通过。测试台最新跑次（2026-11-18，P1-45／47 落地后的候选镜像 `p145-p147`，工作树 dirty、arm64 本机构建）**PASS**：R0／01／02／03／04／05 全 PASS（02 按放宽门槛 PASS，livez max 548ms／p99 468ms，readyz p99 307ms，110 秒就绪；03 重启后 livez max 7ms、26 秒就绪；04 livez max 3ms；05 管理员认领与 MCP 握手通过）。先前 801b9c02 跑次的 03／04 FAIL（重启时最新行距上次重算不足 15 分钟的用户被整窗口重算、DELETE 不分片）在同一夹具下转 PASS，与 P1-45 重建状态水位判定（不再用 15 分钟余量）及 P1-47 DELETE 分块一致；06 客户侧证据仍 BLOCKED。不入核心分母。≠ 可上线**。缺口 GAP-UAT-P1-39 |
| P1-45 | REQ-030-066 | [重建中断恢复 Spec](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) | [`UAT-SUITE-INFERRED-REBUILD-RECOVERY`](../qa/uat/suites/inferred-turn-rebuild-recovery/suite.md) | **PASS** | Spec v0.2＋实现；[irr 跑次](../qa/uat/suites/inferred-turn-rebuild-recovery/runs/2026-11-18-cursor-irr-p145-p147.md)。GAP-UAT-P1-45 关闭。≠ 可上线 |
| P1-46 | REQ-030-067 | [readyz／MCP 一致 Spec](../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md) | [`UAT-SUITE-READYZ-MCP-LISTEN`](../qa/uat/suites/readyz-mcp-listen/suite.md) | **PASS** | Spec v0.2＋实现；[rml 跑次](../qa/uat/suites/readyz-mcp-listen/runs/2026-11-18-cursor-rml-p145-p147.md)。GAP-UAT-P1-46 关闭。≠ 可上线 |
| P1-47 | REQ-030-068 | [满量重建探针预算 Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) | [`UAT-SUITE-REBUILD-PROBE-BUDGET`](../qa/uat/suites/rebuild-probe-budget/suite.md) | [当前跑次：2026-11-19](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-19-codex-p157-ff8e9c05.md)；判定见[INDEX](../qa/uat/INDEX.md) | 现行合同以Spec头部为准；2026-11-18默认FAIL／暂停PASS仅历史对照。默认完整夹具三轮证据已在测试台登记，GAP-UAT-P1-47原门槛在受测范围满足；不推定客户现网503已修复。≠ 可上线 |
| P1-48 | REQ-030-069 | [状态机合同门禁 Spec](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md) | not_registered | not_registered | **v0.1-draft。仅登记与起草，不开发。命中多步流程／门禁／发布／恢复语义的新 Spec（及 grandfather 取消后的存量 Spec）须声明可解析的「多步状态机合同」（状态集、合法转移、终态、非终态持久化、逃生边、禁止布尔冒充终态）；`lint:spec-docs` 在获开发授权落地后能拦住缺项；存量高风险路径盘点表只登记指针，不宣称已合规。终稿未确权；未获开发授权；未授权不改运行代码与 lint；测试台 not_registered；不入核心分母；≠ 可上线**。缺口 GAP-UAT-P1-48（文档门禁，默认不挂客户场景 UAT） |
| P1-51 | REQ-030-072 | [版本轴命名 Spec](../specs/lucy-20261118-version-axis-naming-spec.md) | not_registered | not_registered | **v0.3-draft。仅方案落盘：不含运行代码、镜像与 CI 改动；未获开发授权；待 Codex 交叉审阅与委托人终稿确权。测试台 not_registered；不入核心分母；≠ 可上线**。缺口 GAP-UAT-P1-51（发版治理；默认不挂客户场景 UAT） |
| P1-37 | REQ-030-058 | [MCP 体验韧性 Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md) | [`UAT-SUITE-MCP-UX-RESILIENCE`](../qa/uat/suites/mcp-ux-resilience/suite.md) | **PASS WITH GAP**（沙箱 Tier-A；MCPX-09／10 BLOCKED） | **S5｜v1.1；功能合同已收口（2026-11-22，scoped）**；[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。GAP-UAT-P1-37 标注残余另期。≠ 可上线 |
| P0-1 | REQ-030-027 | [口径绑定 Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) | [`UAT-SUITE-CALIBER-BINDING`](../qa/uat/suites/question-type-caliber-binding/suite.md) | [2026-11-14 升级后 PASS WITH GAP](../qa/uat/suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋CALIBER-01；CALIBER-02 Wave B 推迟 |
| P0-A | REQ-030-012 | [字段暴露 Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) | [`UAT-SUITE-FIELD-EXPOSURE`](../qa/uat/suites/semantic-source-field-exposure/suite.md) | [2026-11-14 升级后 PASS WITH GAP](../qa/uat/suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋EXPOSURE-01；EXPOSURE-02 Wave B 推迟 |
| P0-4 | REQ-030-022 | [可核对 Spec](../specs/lucy-20261107-answer-verifiability-spec.md) | [`UAT-SUITE-ANSWER-VERIFIABILITY`](../qa/uat/suites/answer-verifiability/suite.md) | [2026-11-14 升级后 PASS](../qa/uat/suites/answer-verifiability/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋AV-01／02 |
| P0-5 | REQ-030-018 | [空结果 Spec](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) | [`UAT-SUITE-EMPTY-NEXT-STEP`](../qa/uat/suites/empty-result-next-step/suite.md) | [2026-11-14 升级后 PASS](../qa/uat/suites/empty-result-next-step/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋EMPTY-01／02 |
| P0-2 | REQ-030-023 | [Catalog 语义 Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) | [`UAT-SUITE-CATALOG-SEMANTICS`](../qa/uat/suites/catalog-business-semantics/suite.md) | [2026-11-14 升级后 PASS](../qa/uat/suites/catalog-business-semantics/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | R0-UPGRADE＋CATSEM-01／02 |
| P1-15 | REQ-030-036 | [Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md)（S5｜漏斗镜像 2026-11-22） | [`UAT-SUITE-CONN-RELOAD`](../qa/uat/suites/connection-runtime-reload/suite.md) | [Claude 交叉 2026-11-13 PASS](../qa/uat/suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md) | GATE-01／RELOAD-02 交叉仍 PASS；Cursor 同批见 [cursor-gate-reload](../qa/uat/suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md)；开发台 S5 收口范围不含可选 UAT-02 |
| P1-16 | REQ-030-037 | [catalog-scan Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) | [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md) | [Cursor Gate A 2026-11-13](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-p120-uat.md)；CASE／DIFF 见 [Claude 交叉](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md) | Gate A：SEED／MYSQL／SIM／KTX **PASS**；EXT-01／02 **BLOCKED**；矩阵／CASE／DIFF 维持既有 PASS；字段续作见 P1-20 |
| P1-20 | REQ-030-041 | [Spec](../specs/lucy-20261113-external-catalog-column-read-spec.md) | [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md)（同套件 SIM／KTX-GUARD／EXT-03…05／EXT-03-DUAL） | [2026-11-19 hive-jd rerun](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-19-cursor-hive-jd-ext-rerun.md) ；本轮F02／03 [受控降级PASS](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) | 主体 v0.2 及 §8 v0.4 已确权并实现；本轮真实 Doris→Hive 字段读取及 F02／F03 预算回归通过，指定慢语法拒绝按已授权 D5 受控降级并单列边界。客户生产 SelectDB 未验；不改本条探针合同。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 |
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
| P1-40 | REQ-030-061 | [Spec 192 §13.5](../../webui/docs/192-clipboard-non-secure-context-fallback-spec.md)（事故修复记录）＋错题 [clipboard-http-fake-success](../lessons/2026-11-17-clipboard-http-fake-success.md)；修复已提交 `65f40847`（未随发布构建出包） | [`UAT-SUITE-COPY-FAKE-SUCCESS`](../qa/uat/suites/copy-fake-success/suite.md) | [2026-11-17 加固后 PASS WITH GAP](../qa/uat/suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-hardened.md)（改前基线 [FAIL](../qa/uat/suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-first.md)） | 同一探针改前 FAIL → 改后 R0／01／02a–02j／03 PASS：helper 3/3、十个可点入口 REAL（真实 Token、真实 MCP 审计数据、抽屉内复制）。缺口见 GAP-UAT-P1-40。≠ 可上线 |
| P1-42 | REQ-030-063 | [按钮反馈 Spec](../specs/lucy-20261122-button-feedback-honesty-spec.md)；实现 `f1436556` | [`UAT-SUITE-BUTTON-FEEDBACK`](../qa/uat/suites/button-feedback/suite.md) | [2026-11-17 改后 PASS WITH GAP](../qa/uat/suites/button-feedback/runs/2026-11-17-cursor-button-feedback-after-fix.md) | **S5｜v1.0；功能合同已收口（2026-11-22，scoped）**；6 入口 NOT-RUN 等写入收口范围。GAP-UAT-P1-42 标注残余另期。≠ 可上线 |
| P1-44 | REQ-030-065 | [页面打开 Spec](../specs/lucy-20261122-page-open-error-boundary-spec.md)；实现 `c1f54f64` | [`UAT-SUITE-PAGE-OPEN`](../qa/uat/suites/page-open-exceptions/suite.md) | [2026-11-18 改后 PASS WITH GAP](../qa/uat/suites/page-open-exceptions/runs/2026-11-18-cursor-page-open-after-fix.md) | **S5｜v1.0；功能合同已收口（2026-11-22，scoped）**；PO-03 详情页另期。GAP-UAT-P1-44 开。≠ 可上线 |
| P1-41 | REQ-030-062 | [sankey-restoration Spec](../specs/lucy-20261117-access-map-sankey-restoration-spec.md)（v0.2，D0＝C，开发授权已获得，实现在已提交）＋错题 [access-map-sankey-regression](../lessons/2026-11-17-access-map-sankey-regression.md) | [`UAT-SUITE-ACCESS-MAP-SANKEY`](../qa/uat/suites/access-map-sankey-design/suite.md) | [2026-11-17 改后 Docker 种子容器 PASS WITH GAP](../qa/uat/suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-docker-seeded-run.md)（改前基线 FAIL 见 [probe-baseline](../qa/uat/suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-probe-baseline.md)） | 沙箱：零访问 4 个闲置聚合节点、dense 零高柱 0 且可滚动、未确认 175 被披露。线上 SANKEY-07 BLOCKED，线上升级未授权。≠ 可上线 |
| P1-31 | REQ-030-052 | [Plan](../plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md)＋[排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)（无运行代码 Spec） | [`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md) | [2026-11-16 重建后 PASS WITH GAP](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md)（首跑 [FAIL](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-15-claude-page-sweep-first.md)） | 整改后路由 02：0 越线／0 失败，96 通过、25 未测；页面 01 40／43 通过；门禁 03 通过、基线 `tracked` 清零。夹具盲区仍为未测。门禁只判退化。≠ 可上线 |
| P1-32 | REQ-030-053 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)（开发授权已获得，实现已落地，待终稿复核） | [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md)（等价守卫）＋[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（UAT-SWEEP-02：F-1／F-6） | [EQUIV 2026-11-16 PASS WITH GAP](../qa/uat/suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md)／[SWEEP 2026-11-16 重建后 PASS WITH GAP](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md) | F-1 inquiry-pack 115 秒→约 0.8 秒、livez 不越线；F-6 不再撞变量上限，v2 导出完整路径夹具缺失仍未测。**不入核心分母**；≠ 可上线 |
| P1-33 | REQ-030-054 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)（同 P1-32） | [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md)＋[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（UAT-SWEEP-02：F-2／F-3／F-4／F-5／F-7） | [EQUIV 2026-11-16 PASS WITH GAP](../qa/uat/suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md)／[SWEEP 2026-11-16 重建后 PASS WITH GAP](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md) | 六条路由全部不越线；`governance/overview` p99 386ms 贴线（余量 14ms）。**不入核心分母**；≠ 可上线 |
| P1-34 | REQ-030-055 | [Spec](../specs/lucy-20261115-large-schema-ingestion-spec.md) | [`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md)（必做 R0／01…10；规模下限不得降低） | [PASS（本跑次）](../qa/uat/suites/large-schema-ingestion/runs/2026-11-19-codex-p157-ff8e9c05.md)；共享FDE[FAIL](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) | v0.2.2 主体及 LS-01–18 既有结论保留；§11 v0.5 已由委托人确认并授权实施，R1／R2 修复完成，LS-19–30 本轮本机功能验收通过。真实 MySQL 混合权限按 D5 受控降级，合法字段真实；正常规模套件本跑次通过，历史 SCALE-09 偶发超时未归因记录保留。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 |
| P1-30 | REQ-030-051 | 设计 [context-content](../design/design-2026-11-15-uat-context-content-wiki-skill.md)（测试台合同；无运行代码 Spec） | [`UAT-SUITE-CONTEXT-CONTENT`](../qa/uat/suites/context-content/suite.md) | [2026-11-15 Claude](../qa/uat/suites/context-content/runs/2026-11-15-claude-ctx-content.md)／[Cursor CLI](../qa/uat/suites/context-content/runs/2026-11-15-cursor-cli-ctx-content.md) | **PASS WITH GAP**（WIKI-01S BLOCKED＝GAP-2）。**不入核心分母**；≠ 可上线 |
| P1-28 | REQ-030-049 | 无独立 Spec（不改既有行权限 Spec 状态） | [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md) | [2026-11-22 PASS](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md) | **入核心分母**。测试台 PASS（解耦：不含 ROW-07）。≠ 可上线 |
| P1-29 | REQ-030-050 | 无实现 Spec | [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md)（UAT-ROW-07） | [2026-11-22](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md)（ROW-07 单列 FAIL） | 取值存在性缺口。**不入核心分母**；**不挡** P1-28 套件 PASS。GAP-UAT-P1-28-VALUE 仍开。≠ 可上线 |
| 其余 P1／P2 | … | 见总账 | **`not_registered` 或 `n/a`** | — | 出门前按 DEVELOPMENT 兜底扫 |

取值约定：

| 测试台单元格 | 含义 |
|---|---|
| Suite ID＋链接 | 已挂测试台 |
| `not_registered` | 需求／开发台有行或主张，测试台尚无套件（**缺口，须补或降叙事**） |
| `n/a` | 明确不要求客户场景 UAT（冻结未实现、纯工程向且叙事已标工程向） |


## 核心可用性新增缺口（2026-11-19）

| GAP | 归属 | 当前缺口 / 关闭条件 |
|---|---|---|
| GAP-UAT-P1-61 | P1-61／REQ-030-082 | CAV-01已修复，SC-08及真实回收／两轮自动恢复局部通过；真实撤权、代次、全字段与reader计数等完整矩阵补齐后复核。S4→S5 波次 **4c**：最小必做见 `inbox/20261122-1630-core-availability-f61-f69-min-checklist.md`（本波不收口）。 |
| GAP-UAT-P1-62 | P1-62／REQ-030-083 | 仅真实导出入口局部实测，三类别容量／80提交／实际许可终结等完整矩阵待补；不得以局部通过关闭。S4→S5 波次 **4c** 清单同上。 |
| GAP-UAT-P1-63 | P1-63／REQ-030-084 | CAV-02已修复，三轮10秒真实查询TERM及同卷恢复通过；100轮准入竞争、长SSE、>20秒、未知写回执等完整矩阵仍待补。S4→S5 波次 **4c** 清单同上。 |

R-CAV由同候选测试执行者在组合主张前消费，挂P1-13；P1-52客户升级和P1-53／54真实题库边界不变。不将本轮静态核对作为客户503根因证据。

[R-CAV-FDE-1883 标准档正式复测](../qa/uat/suites/core-availability/runs/2026-11-22-kscc-cav-formal.md)挂现有 P1-13／61／69 及 1883 表用例。1800 秒、12 轮，独立 **FAIL／证据 VALID**。STD-02 的 livez max 1215.47ms 超 1000ms，STD-01／03／04／05 通过。子功能现值继续按各 Spec，完整 R-CAV 保持原登记。

## 3. 兜底队列（现行缺口）

| ID | 缺口 | 建议动作 | 优先级 |
|---|---|---|---|
| GAP-UAT-P1-66 | P1-66 batch A BA-01-07 CLOSED; original F66 cold/first-navigation failures retained; full scale/WIDTH/write-fault matrix deferred | Next batch requires user restart, compiler design review and unchanged-budget evidence; not a blocker of accepted batch A | P1 |
| GAP-UAT-P1-64 | **已关闭**：SC-09类型0错误；本轮与P1-60同一冻结候选完整短名及前台浏览器复验通过 | [合并最终跑次](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md)；782项Vitest＋29项概念模块回归；整包独立评审 | P1 |
| GAP-UAT-P1-65 | **本轮整改关闭**（2026-11-20）：前台浏览器／遗漏子例、严格 MCP、夹具清理及状态一致性均通过；[新跑次](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md) | 最终零残留，51 个独立验收 ID PASS；不替代发布取证／可上线 | — |
| GAP-UAT-P1-60 | **已关闭（2026-11-20）**：30ec4ae0完整R／预算可用性／真实RC1完成，功能合同终审收口 | [最终跑次](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final.md)；原始失败保留；整包仍须核对P1-58／59及P1-61／62／63的版本与合同缺口 | P0 |
| GAP-UAT-P1-58 | P1-58 scoped S5（仅B1）已收口；完整F58／2×／5×／历史窗口／R 另期 | 开发台 S5 scoped（2026-11-22）；第二批须另授。≠ 可上线 | P1 |
| GAP-UAT-P1-59 | P1-59 scoped S5（仅B1）已收口；完整F59／百对／DEP／E／R 另期 | 开发台 S5 scoped（2026-11-22）；第二批须另授。≠ 可上线 | P1 |
| GAP-UAT-P0 | ~~P0-1…5／A 无 UAT 套件~~ | **已挂六套**（方案 B）。**2026-11-14 升级后复跑**：[Plan](../plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)；跑次 `…-p0-post-upgrade`；容器 `gitSha=9d59337d`（≠ 上午 Wave A `3aa402c9`）。必做含 `UAT-R0-UPGRADE`：P0-3／4／5／2 **PASS**；P0-1／A **PASS WITH GAP**（Wave B 仍推迟）；SAG-02 **BLOCKED**。≠ 可上线；≠ 核心升级完成 | P1 |
| GAP-UAT-P0-3-ESCAPE | P0-3／P1-35 纯 MCP 逃生未通 | **已关闭（2026-11-16 夜，v0.4）**：v2 必做 ESC-07／08 在 v0.3 构建 FAIL（[fidelity](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-fidelity.md)）→ v0.4 实现后 ESC-01～10 全绿，INDEX＝PASS（[v0.4 跑次](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)）。≠ D5／功能合同收口 ≠ 可上线 | P0 |
| GAP-UAT-P1-13 | ~~P1-13 无客户场景 UAT~~ | **已挂** [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md)；发布取证 acceptance 仍独立，≠ 可上线 | P2 |
| GAP-UAT-P1-17 | ~~空桑基 04／F-1~~ | **已关闭（2026-11-14）**：P1-19 落地后 [claude-macmini-p119](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) 必做＋04 **PASS**。遗留观察：`deniedCalls` 页面未呈现（可观测性，另单）。≠ 可上线 | P2 |
| GAP-UAT-P1-18 | Skill 入口 CLOSED，工程向 | 勾连表已标 `n/a`（工程向）；保持工程向叙事 | P2 |
| GAP-UAT-P1-36 | P1-36 scoped S5 已收口；残余 TRC-07／08／09／正式 complete 导出另期 | 开发台 S5 scoped（2026-11-22）已接受 TRC-01–06／10／11＋诊断包 spans；关闭整套缺口须另授补跑／修 F-02。≠ 可上线 | P1 |
| GAP-UAT-P1-38 | P1-38 推断问询补算尚无客户场景套件 | 测试台 not_registered。关闭条件：另立套件并有跑次，INDEX 有判定。本缺口不把 vitest 写成 UAT PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-39 | 客户侧证据（UAT-COLD-06）未取；候选镜像为 dirty arm64 本机构建 | 冷启动全套已在 P1-45／47 落地后复跑 **PASS**（R0／01–05；03／04 由 FAIL 转 PASS）：[p145-p147 跑次](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-p145-p147.md)。残余：UAT-COLD-06 待客户回传 fsync／文件大小／日志；amd64 客户包与 K8s 升级取证不在本条。本缺口不把 vitest 写成 UAT PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-45 | ~~P1-45 NOT RUN~~ → **已关闭**（2026-11-18 IRR PASS） | 关闭证据：[irr 跑次](../qa/uat/suites/inferred-turn-rebuild-recovery/runs/2026-11-18-cursor-irr-p145-p147.md)。≠ 可上线 | P1 |
| GAP-UAT-P1-46 | ~~P1-46 NOT RUN~~ → **已关闭**（2026-11-18 RML PASS） | 关闭证据：[rml 跑次](../qa/uat/suites/readyz-mcp-listen/runs/2026-11-18-cursor-rml-p145-p147.md)。≠ 可上线 | P1 |
| GAP-UAT-P1-47 | 原默认重建探针预算缺口：受测范围已满足 | 测试台现值见[INDEX](../qa/uat/INDEX.md)与[2026-11-19跑次](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-19-codex-p157-ff8e9c05.md)，完整夹具默认3/3且同窗已鉴权请求通过；原关闭条件在该候选范围满足。历史FAIL保留；不将本结论扩展为客户现场升级放行或本次503根因。 | 受测范围关闭；现场另取证 |
| GAP-UAT-P1-55 | 本机复现套件已挂但未执行 | 关闭条件：R0／R1／05 必做有跑次；其余按授权范围有判定或 `BLOCKED`。降级仅限延迟注入代理；受控投影进度替身未授权 | P1 |
| GAP-UAT-P1-57 | R1／R2及G1–G5、G7–G9证据齐；G6正式完整导出基线缺口仍未修复 | 委托人D7已明示延期、待另行安排；原FIX-01 FAIL保持，不再阻塞排除正式导出的本轮客户功能测试。恢复后仍按原标准真通过才关闭；D6未实施 | P1（正式完整导出缺口；本轮限定测试排除） |
| GAP-UAT-P1-56 | 修复评审已有 BLOCKED 跑次；局部真实时钟满足预期，完整 L2 与功能出口未齐，后续转 P1-57 | 关闭条件：按原缺陷逐项核对真实行为与 FDE 分叉；R1／R2 和补验转 P1-57；不得以旧绿灯关闭 | P1（客户测试准入） |
| GAP-UAT-P1-54 | ~~题库＋配置未过严口径~~ → **已关闭（2026-11-22，开发台）** | 关闭证据：[严口径复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)＋SC／CR。共享 INDEX 随后由 P1-53 candidate 升 PASS。≠ 可上线 | P0 |
| GAP-UAT-P1-53 | ~~四入口／X_REL 未完~~ → **已关闭（2026-11-22）** | 关闭证据：[四入口](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md)＋[SC](../reviews/2026-11-22-p1-53-sc-evidence-audit.md)＋[CR](../reviews/2026-11-22-p1-53-implementation-cr.md)。≠ 可上线 | P0 |
| GAP-UAT-P1-48 | P1-48 状态机合同门禁无客户场景 UAT | 文档／lint 门禁；测试台 not_registered 为预期。关闭条件：委托人若要求客户场景复现则另立套件；否则可在门禁落地收口时将本缺口标为 `n/a`（工程向）。不得把 lint 绿写成 UAT PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-51 | P1-51 版本轴／交付追溯无客户场景 UAT | 发版治理；测试台 not_registered 为预期。关闭条件：开发授权落地后若需客户场景复现则另立套件；否则收口时标 `n/a`（工程向）。不得把文档齐写成 UAT PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-68 | P1-68 运维步骤账：R0／01–08 PASS；设计值重度 GAP | 开发台 S5 scoped（2026-11-22）已接受必做；设计值矩阵另期。≠ 可上线 | P1 |
| GAP-UAT-P1-74 | P1-74 预算逃生：功能轴 PASS WITH GAPS；BESC-07／10A BLOCKED | 开发台 S5 scoped（2026-11-22）已接受功能轴；begin-active／busy／Wave D 全量另期。≠ 可上线 | P1 |
| GAP-UAT-P1-40 | P1-40 复制按钮假成功：加固后 **PASS WITH GAP** | 开发台 S5 scoped（2026-11-22）：demo／局域网 REAL 已接受；公网 04 与 helper-only 另期。≠ 可上线 | P1 |
| GAP-UAT-P1-42 | P1-42 scoped S5 已收口；6 入口 NOT-RUN／BTN-07 成功下文件等另期 | 开发台 S5 scoped（2026-11-22）；实现已提交 `f1436556`。≠ 可上线 | P1 |
| GAP-UAT-P1-44 | P1-44 scoped S5 已收口；PO-03 详情页／修复前负控／线上升级另期 | 开发台 S5 scoped（2026-11-22）；实现已提交 `c1f54f64`；55/55 已接受。≠ 可上线 | P1 |
| GAP-UAT-P1-41 | P1-41 访问关系图桑基：Docker 种子容器全真必做 R0／01／02／04／05 与 03 PASS WITH GAP（06 沿用基线）；**线上未核对（07 BLOCKED）** | 开发台 S5 scoped（2026-11-22）：沙箱必做已接受；线上 SANKEY-07 另期（未授权升级）。≠ 可上线 | P1 |
| GAP-UAT-P1-37 | P1-37 scoped S5 已收口；MCPX-02／05／06／08 残余缺口＋U3b 另期 | 开发台 S5 scoped（2026-11-22）已接受已验主路径；MCPX-09／10 仍 BLOCKED（U3b）。≠ 可上线 | P1 |
| GAP-UAT-EXT | P1-20 **客户生产** SelectDB／`hive_jd` live 仍未验；本机 lab 双目录＋EXT-05 已 PASS（[2026-11-19 rerun](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-19-cursor-hive-jd-ext-rerun.md)） | 要关闭客户生产缺口：现场对 `hive-1`／`hive-jd` 各读一张表字段并回传耗时／页面文案／FE 审计是否出现 Lucy 来源 `DESC`；或委托人书面接受「以 lab＋替身收口出补丁包」 | P1 |
| GAP-UAT-MYSQL-VER | P1-16 矩阵自 5.7 | **已关闭（2026-11-13）**：`mysql:5.7` 拉取成功后矩阵 **5.7.44／8.0.46／8.4.13 PASS**。见 [补跑](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-mysql-version-matrix-57.md)。跑次镜像 `gitSha=ea4ef839`，不含其后的 `aa559a1c` | P2 |
| GAP-LINK-POOL | 总账行未普遍挂 Suite 列 | 以本勾连表为准；总账 Spec／Plan 列逐步回链 | P2 |
| GAP-UAT-P1-21 | ~~套件尚未执行~~；可选客户维护窗 LOOP-05 仍 BLOCKED | **必做已 PASS**（[2026-11-13-cursor-demo-event-loop](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)）。客户升到含 `/api/livez` 后维护窗再跑 LOOP-05；高峰禁止 `hours=168`。≠ 可上线 | P2 |
| GAP-UAT-P1-11-RUNTIME | ~~P1-11 业务受理 FAIL（代码根装配）~~ | **已关闭（2026-11-15）**：P1-27 复测 [cursor-p1-27-ops-retest](../qa/uat/suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md) R0-FIX／01／02／03 **PASS**；INDEX＝PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-31 | 全页面／全 GET 路由事件循环看守：首跑 **FAIL**；整改后复跑（2026-11-16）**PASS WITH GAP**——0 越线／0 失败，25 路由与 3 页面未测 | 整改已落地、基线 `tracked` 已清零、`SWEEP_STRICT=1` 对本次报告回放通过。**剩余缺口＝夹具盲区**：评测运行、语义资产操作、完整性合法的 v2 导出（`export-v2`／`export-pack-v2` 现为 409 `integrity_or_relation_failed`）、`export-pack`（413）、宿主无 ktx；另 `governance/overview` livez p99 372ms 贴线。关闭条件：补齐夹具使「未测」转「已测」且无缺口，INDEX＝PASS。≠ 可上线 | P1 |
| GAP-UAT-P1-34 | 必做 R0／01…10 已 PASS（2026-11-16，PASS WITH GAP）；**剩余**：**第 2 次完整跑 SCALE-09 耗时 171 秒原因未定位**（之后 6 次单跑未复现）；可选 SCALE-11（写入与热重载）、12（12000 表）未执行；SCALE-09 测量对象更换后须评审认可；demo 自带内联口令连接的回退路径规模未测 | 规模下限不得降低；缩小夹具只能记 SKIPPED。≠ 功能合同收口；≠ 可上线 | P1 |
| GAP-UAT-P1-28 | ~~行级隔离场景未过~~ | **已关闭（2026-11-22）**：计入核心分母必做 PASS；证据 [decouple-retest](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md)。ROW-07 仍见 GAP-UAT-P1-28-VALUE。≠ 可上线 | — |
| GAP-UAT-P1-28-VALUE | 配错取值仍能保存 | 归 **P1-29／REQ-030-050**。UAT-ROW-07 在现行代码上预期 FAIL；**不挡** P1-28 套件 PASS。关闭条件：保存被拒绝或出现「取值不存在」警告，且 INDEX 中该条不再 FAIL。未授权实现 | P1 |

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
| 2026-11-22 | **出包前收口（剔出 P1-58／59）**：干净候选 `prepack-8e3e3f24`／BASE_SHA `8e3e3f24`；CAV-01／02 定向 PASS WITH GAP；P1-60 smoke SMOKE_PASS；P1-64 模块等价 allMatch；交付须知与[就绪评审](../reviews/2026-11-22-prepack-readiness-review.md)落盘。闭合 11-20「修复未进候选」阻断（定向范围）；完整 F61／F63／R-CAV 与出包未做。≠ 可上线；≠ 出包授权。 |
| 2026-11-22 | **P1-71／REQ-030-092 明确不开发并留池作下一期目标**：委托人「本 Spec 不开发，明确移入需求池，作为下一期开发的目标」。测试台仍 NOT RUN；终稿未确权；未获开发授权；不入核心分母；≠ 功能合同收口；≠ 可上线 |
| 2026-11-20 | P1-60／P1-64同一30ec4ae0完整验收并功能收口；预算持久化锁竞争修复归原SC-05／10。整包因P1-58／59合同缺口及核心可用性修复版本未对齐而不放行，[最终评审](../reviews/2026-11-20-p160-p164-combined-final-review.md)；不入新增核心分母；不提交／推送／发布。 |
| 2026-11-20 | P1-65 四项验证缺口授权整改后复核 PASS；51 项／153 份角色检查／306 条工具断言，前台浏览器与遗漏子例补齐、最终零残留；重新确认功能合同收口，关闭 GAP-UAT-P1-65；[新跑次](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md)；不 commit／push；≠ 可上线。 |
| 2026-11-20 | **P1-65 改后 Docker UAT＝PASS WITH GAP**：verify 跑次已挂；GAP-UAT-P1-65 收窄为子例穷尽；≠ 可上线。 |
| 2026-11-20 | **P1-65 实现完成待 UAT**：WebUI 声明规范键差异门禁、显式保留／采用／重设与「待选择」摘要，聚焦 vitest 161 PASS；新增 GAP-UAT-P1-65。改后 Docker UAT NOT RUN；≠ UAT PASS；≠ 可上线 |
| 2026-11-22 | **漏斗降熵 A＋B＋C**：一条主漏斗＋分叉终态；总账收口分列；P1-52→S1、P1-53→S4（收口仍 X_REL）。≠ 可上线；未 commit／push |
| 2026-11-22 | **P1-53／REQ-030-074 → X_REL**：四入口全真 PASS＋SC／CR；INDEX PASS；GAP 关闭；[收口](../reviews/2026-11-22-p1-53-xrel-closure-record.md)。≠ 可上线；未 push |
| 2026-11-22 | **P1-53／REQ-030-074 测试台 candidate PASS**：demo `certifyCandidate` 全真 PASS（34／34＋三维；[跑次](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md)）；INDEX→PASS；GAP 收窄（实例入口未跑）；`X_REL` 未完结。≠ 可上线；未 push |
| 2026-11-22 | **P1-54／REQ-030-075 → S5 严口径收口**：选项 2（03b＝行隔离成交）；严口径 candidate PASS（零 new deny／零翻转／34／34／三维；[复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)）；SC／CR PASS；GAP-UAT-P1-54 开发台关闭；共享 INDEX **仍 NOT RUN**。≠ UAT PASS；≠ 可上线；未 push |
| 2026-11-22 | **P1-73＋P1-35 → S5 收口批＋P1-53／54 镜像纠偏**：双功能合同已收口（SC／CR 证据齐）；53／54 开发已授权＋Wave D FAIL＋INDEX NOT RUN。≠ 可上线；未 commit／push |
| 2026-11-20 | **P1-64 修复方案草案（仅文档）**：配对 Spec／Plan v0.1-draft 与改后 R0／01–09 已挂既有 Suite；新增 GAP-UAT-P1-64。终稿未确权、开发未授权；最近跑次 FAIL 保留，改后复测 NOT RUN。≠ UAT PASS；≠ 可上线 |
| 2026-11-19 | **P1-57 D7延期裁决**：用户“这个可以先不修，未来再修”；G6正式完整导出基线缺口延期且仍开放，原完整范围实测FAIL不改。本次客户功能测试排除此项，可按其余已验证范围进行；没有新运行验证或D6实现。 |
| 2026-11-19 | **P1-57授权执行复验完成**：R1／R2修复、G7–G9测程差集纠正；完整夹具默认三轮、真实SIGKILL与完整HTTP滚动通过。最新修复模式FAIL＝G6新实例正式导出409；D6回设计未授权，不能交客户测试。 |
| 2026-11-19 | **P1-57／REQ-030-078 整改方案草案**：委托人要求先计划、确认后修复并重跑；功能合同复用既有 Spec，补列 R1／R2／G1–G6／SK1–SK4；修复模式草案、D5 待独立确认。本轮仅文档，INDEX 保留 BLOCKED。 |
| 2026-11-18 | **P1-47 暂停交付模拟双跑**：默认 FAIL（2693ms）／暂停 PASS（13ms＋MCP＋COLD 全绿）；Helm 0.2.10；Spec v0.3。GAP-UAT-P1-47 仍开（默认）。≠ 可上线 |
| 2026-11-19 | **入池 P1-55／REQ-030-076＋补录 P1-56／REQ-030-077**：FDE 3b1c62af 打包前检查本机复现；新套件 `UAT-SUITE-FDE-PACKCHECK`＝NOT RUN；D1–D4 已确认（延迟注入代理降级、构建 84 镜像；受控投影进度替身与 amd64 仿真未授权）。登记 ≠ 缺陷成立；≠ 开发授权；≠ 可上线 |
| 2026-11-19 | **P1-56 终稿确权＋整批开发授权（委托人 2026-11-19 12:35）**：「整批授权」「无需复审，整批定稿」。四份修订按委托人明示确权记录，Codex 首轮终审必改项已采纳、未复审；整改 Plan v1.0 Task 1–7 两批均生效；O3 延后未授权；实现未开始；INDEX 不变（仍 NOT RUN）。≠ UAT PASS；≠ 可上线 |
| 2026-11-19 | **P1-56 按 Codex 首轮终审修订并定稿（仅文档）**：4 份 Spec 均未确权，必改项已修订（P1-34 §11 改回候选硬上界并增逐响应 ≤20 秒验收；C6、EC-15、N26-5／6、P1-38 SC-16 与 P3 ↓ 待实测、授权口径统一）；生效条件改按批；待回送 Codex 复审。≠ UAT PASS；≠ 可上线 |
| 2026-11-19 | **P1-56 委托人批准整改建议（仅文档）**：决策点闭合；UAT 受控投影进度替身与缩短回看窗口授权（先真实构造，INDEX 标「受控降级」），amd64 模拟不授权；整改分两批；开发授权按批生效（见下一行）。≠ UAT PASS；≠ 可上线 |
| 2026-11-19 | **P1-56 本机 L1 复现成立＋整改文档起草（仅文档）**：候选 `3b1c62af` 上 5 项在受控替身复现（非 UAT；INDEX 不变，仍 NOT RUN）。契约修订草案：P1-20 §8、P1-34 §11、v2p5 §18.19 N26、P1-38 §8（均未确权、开发未授权）；整改 [Plan](../plans/lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)；[错题本](../lessons/2026-11-19-fde-3b1c62af-defects-missed-by-uat.md)。**更正记录**：`UAT-TRC-05`（2026-11-17）跑次 F-5「管理员登录后立即导出撞 `projection_lag_exceeded`——既有行为」与 F01 同一错误码、同一触发场景，高度同型，**根因未复核**；同一跑次的 F-2（`integrity_or_relation_failed`）是另一缺陷，不并案。历史跑次不改写。≠ UAT PASS；≠ 可上线 |
| 2026-11-19 | **P1-54／REQ-030-075 → v1.0 终稿确权**：对抗复审修订定稿；开发未授权（明示暂不开发）；共享测试台 NOT RUN。终稿确权 ≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **P1-53 → v1.1 终稿补丁＋P1-54 → v0.2-draft**：收编题库正本／Ops；CompatConfigProfile 全真落地前置；测试台仍 NOT RUN。≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **P1-53 Spec／Plan → v1.0 终稿确权**：委托人授权修订定稿（闭合 T1–T10）；测试台仍 NOT RUN。终稿确权 ≠ 开发授权（明示暂不开发）；≠ 可上线 |
| 2026-11-18 | **P1-53 Spec／Plan → v0.2-draft**：委托人批准审阅修订落入（D20 拆分、耗时分档、双入口、D21、D6 分层、SC-14／21／22）；测试台仍 NOT RUN。≠ 终稿确权；≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **入池 P1-54／REQ-030-075**：独立多场景题库 Spec v0.1-draft；真实系统盘点含 Lucy Ops 当前 ACL；共享 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`＝NOT RUN；开 GAP-UAT-P1-54。终稿未确权、开发未授权；≠ 可上线 |
| 2026-11-18 | **入池 P1-53／REQ-030-074**：MCP 升级兼容底线与全真用户旅程门禁 Spec／Plan v0.1-draft；测试台 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`＝NOT RUN；开 GAP-UAT-P1-53。架构、题库和耗时阈值已批准。≠ 终稿确权；≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **入池 P1-51／REQ-030-072**：版本轴分工与命名规约 Spec／Plan v0.3-draft；测试台 not_registered；开 GAP-UAT-P1-51。委托人确认方案、暂不开发；补登此前未入池。≠ 终稿确权；≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **入池 P1-48／REQ-030-069**：多步流程状态机合同门禁 Spec／Plan v0.1-draft；测试台 not_registered；开 GAP-UAT-P1-48。委托人授权起草、暂时不开发。≠ 终稿确权；≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **P1-45／46／47 Docker UAT**：RML／IRR PASS；RPB FAIL（01）；关 GAP-UAT-P1-45／46；GAP-UAT-P1-47 改为 RPB-01 门槛未达。≠ 可上线 |
| 2026-11-18 | **入池 P1-45／46／47**：前方报告三则 P0 → Spec v0.1-draft＋测试台三套件 INDEX=NOT RUN；开 GAP-UAT-P1-45／46／47。≠ 开发授权；≠ 可上线 |
| 2026-11-18 | **P1-47 暂停开关＋对照实验**：委托人授权加 `LUCY_INFERRED_MAINTAINER=off`（默认开）。同镜像对照：暂停 RPB-01／02／03 全 PASS（livez max 11ms），不暂停 FAIL（max 2662ms，37／42 个样本 ≥1.5 秒），持续停顿确证来自后台补算维护器；r2 的「单次尖峰」口径更正为持续停顿。P1-47 仍 FAIL（默认配置），GAP-UAT-P1-47 仍开。[对照跑次](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-p147-pause-control.md)。≠ 可上线 |
| 2026-11-18 | **P1-39 冷启动全套复跑 PASS（P1-45／47 落地后）**：`p145-p147` 候选镜像，R0／01–05 全 PASS，03／04 由 FAIL 转 PASS（[跑次](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-p145-p147.md)）；GAP-UAT-P1-39 改写，Spec OQ-4 解除。≠ 可上线 |
| 2026-11-18 | **P1-39 放宽 02 门槛并取证（提交 801b9c02 干净树）**：委托人批准 02 门槛放宽为 livez max ≤ 2000ms／p99 ≤ 1000ms（Spec OQ-2 已决；03／04 不放宽）。取证跑次：R0／01／02／05 PASS，03／04 FAIL，暴露「重启时有已建用户需重算、整窗口 DELETE 不分片」的未覆盖路径，待委托人决定处置。GAP-UAT-P1-39 改写。≠ 可上线 |
| 2026-11-18 | **P1-39 终稿确权＋开发授权并实现、改后跑次**：委托人「授权定稿，进入开发」（不含 schema 变更、不含线上升级）。实现于工作树（未提交）；vitest 守卫通过；`UAT-SUITE-COLD-START-SLOW-DISK` 改后跑次 **FAIL（差一项）**：R0／01／03／04／05 PASS，02 仅 livez p99 609ms 超 400ms。GAP-UAT-P1-39 改写。≠ 可上线 |
| 2026-11-22 | **S4→S5 并行波次·scoped（仅文档）**：P1-74／68／32／33／40／41 → 开发台 S5 scoped；UAT 仍 PASS WITH GAP／GAPS。4c：61–63／69 缺口清单 `inbox/20261122-1630-core-availability-f61-f69-min-checklist.md`。6a：36／37 裁定包 `inbox/20261122-1630-p136-p137-decision-pack.md`（未收口）。GAP-UAT-P1-68／40／41 改为「scoped 已接受，完整矩阵／线上另期」。≠ 可上线；不 push。 |
| 2026-11-17 | **入池 P1-41／REQ-030-062**：访问关系图桑基还原（探查＋设计，不含开发）。挂 `UAT-SUITE-ACCESS-MAP-SANKEY`（改前基线 **FAIL**）；开 GAP-UAT-P1-41。线上镜像缺修复，HEAD 三类退化；D0 待裁定。**未获开发授权**。不入核心分母。**≠ 可上线** |
| 2026-11-17 | **P1-41／REQ-030-062 开发完成（已提交）**：D0＝C，委托人授权 Track A（A2／A3）与 Track B 方案 C，不含线上升级。`UAT-SUITE-ACCESS-MAP-SANKEY` 改后 Docker 种子容器全真 R0／01～05 PASS WITH GAP（06 沿用基线），07 BLOCKED；GAP-UAT-P1-41 保持开启直到线上核对。**≠ 可上线** |
| 2026-11-17 | **入池 P1-42／REQ-030-063**：按钮级成功反馈真实性（下载／保存／导出）；P1-40 同类扩展，C 档授权，UAT 只用真实失败；测试台 `UAT-SUITE-BUTTON-FEEDBACK` 本轮建（当前 not_registered）。**不入核心分母；≠ 可上线** |
| 2026-11-17 | **P1-40 同类排查**：全部 15 个复制调用点逐个读过；`Onboarding.tsx` 把 `{ ok }` 对象当布尔用（复制失败仍提示成功）已修并加单测；门禁新增 R5（调用方必须读 `result.ok`）。全仓库无第二套复制实现。**≠ 可上线** |
| 2026-11-17 | **P1-42 测试台建成并改后复跑**：`UAT-SUITE-BUTTON-FEEDBACK` 登记；改前基线 **FAIL**（07 对账导出 DOWNLOAD-FAILED）→ 本机 demo 平滑升级后改后复跑 **PASS WITH GAP**（07 HONEST-FAILURE）；复跑中发现并修正探针自身缺陷（Toast 快照过晚致 SILENT 误判），判定规则未放宽；`check-e2e-ledger` REQUIRED 加入 P1-42；GAP-UAT-P1-42。修复在工作树未提交。≠ 可上线 |
| 2026-11-17 | **P1-40 UAT 加固**：委托人批准优化。去掉 Token 打桩（真实签发＋吊销）；真实 MCP 查询造审计数据，点到审计 ID／触达表清单／对账（含抽屉内复制）；入口编子用例 02a–02j，登记门禁新增 R4；探针接入 `npm run uat:copy-probe`；原始证据进 `runs/evidence/`。复跑 **PASS WITH GAP**。**≠ 可上线** |
| 2026-11-17 | **P1-40 修复落地（工作树）＋复跑 PASS WITH GAP**：委托人「授权修复」（事故修复授权）；`clipboard.ts` 降级路径改为聚焦并全选 textarea、确认选区后才调用 `execCommand`；同一探针改前 FAIL → 改后 helper 3/3、7/7 可点入口 REAL。更新 GAP-UAT-P1-40。**未提交；≠ 可上线** |
| 2026-11-17 | **入池 P1-40／REQ-030-061**：明文 HTTP 下复制按钮假成功（错题 clipboard-http-fake-success）。委托人授权调研并收敛 UAT／机制：挂 `UAT-SUITE-COPY-FAKE-SUCCESS`（首跑 **FAIL**）＋`lint:copy-surfaces` 登记门禁；开 GAP-UAT-P1-40。**修复 `clipboard.ts` 未授权**。不入核心分母。**≠ 可上线** |
| 2026-11-17 | **入池 P1-38／REQ-030-059**：推断问询补算让出事件循环。勾连 Spec，测试台 not_registered，开 GAP-UAT-P1-38。终稿未确权。**≠ 可上线** |
| 2026-11-17 | **P1-39／REQ-030-060 起草 Spec／Plan／测试台**：勾连 Spec v0.2-draft、测试台 `UAT-SUITE-COLD-START-SLOW-DISK`（改前基线 FAIL），开 GAP-UAT-P1-39。HEAD 轮询计划仍是整条索引全扫描；启动幸存后稳态仍卡。终稿未确权，开发未授权。**≠ 可上线** |
| 2026-11-22 | **P1-58／59／42／44 scoped S5 收口**：委托人勾选 A1（仅B1）＋B1（砍 NOT-RUN＋lite Spec）；42／44 新建 lite Spec／Plan；纠正「未提交」漂移。 [收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。**≠ 整套 UAT PASS；≠ 可上线** |
| 2026-11-22 | **P1-36／P1-37 scoped S5 收口**：委托人勾选裁定包（F-3=A／F-2=B／TRC=B／U1=A／GAP=B）并授权改 Spec／收口；开发台升 S5；测试台仍 PASS WITH GAP；GAP-UAT-P1-36／37 标注残余另期。[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。**≠ 整套 UAT PASS；≠ 可上线** |
| 2026-11-17 | **P1-36／P1-37 沙箱 Tier-A UAT 跑次**：两套件 INDEX＝**PASS WITH GAP**（TRC-07/08/09 NOT RUN；MCPX-09／10 BLOCKED）；U1／U4 由宽目录沙箱实证后修复；登记发现 F-1～F-5（F-2 正式完整导出既有 F-02 失败关闭；F-3 SC-06 与 §6.2 口径冲突待委托人裁定）。**≠ UAT 整套 PASS；≠ 可上线**。跑次 `docs/qa/uat/suites/*/runs/2026-11-17-claude-wide-sandbox-tierA.md` |
| 2026-11-17 | **P1-36／P1-37 开发落地**：委托人「授权开发落地」；P1-36 代码落地；P1-37 仅 U2／U3a（U1／U4 无证据未改，U3b 不实现）。两套件仍 NOT RUN，GAP-UAT-P1-36／P1-37 保持开启。[取证记录](../reviews/2026-11-17-p1-36-p1-37-implementation-evidence.md)。**≠ UAT PASS；≠ 可上线** |
| 2026-11-16 | **P1-36／P1-37 入池并挂测试台**：调用流水 trace 级可追溯与存档（REQ-030-057）；MCP 体验韧性（REQ-030-058）。套件 `UAT-SUITE-TRACE-LEDGER`／`UAT-SUITE-MCP-UX-RESILIENCE` 先于实现登记，INDEX＝NOT RUN；开 GAP-UAT-P1-36／GAP-UAT-P1-37。仅文档；**≠ 开发授权；≠ 可上线** |
| 2026-11-16 | **P1-35 v0.4 实现＋ESCAPE UAT PASS**：委托人免 Codex 确权并授权开发；容错三档（放行＋`sourceSelection` 披露＋审计 JSONL）落地；跑次 [v0.4](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md) R0／ESC-01～10 全绿；INDEX＝PASS；关闭 GAP-UAT-P0-3-ESCAPE。SAG-01 升 v3（硬线仍拦）。**≠ D5／功能合同收口 ≠ 可上线** |
| 2026-11-16 | **P1-35 Spec v0.4-draft**：委托人批准方向 B＋容错披露三档（选表歧义降为披露＋审计；披露载体＝响应字段；审计只记录）；新增 D10–D15、§4.5 支持矩阵、SC-E20–E30；UAT 修订 ESC-06／07／08 并新增 ESC-09／10（NOT RUN）。**待 Codex 终审与开发授权；≠ 可上线**
| 2026-11-16 | **P1-35 ESCAPE UAT v2 升必做并 FAIL**：委托人以「分析师群体通用性」为标准，ESC-04～08 升必做；全真跑次 [fidelity](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-fidelity.md) ESC-07／08 FAIL；INDEX＝FAIL；重开 GAP-UAT-P0-3-ESCAPE。≠ 开发授权；≠ 可上线 |
| 2026-11-16 | **P1-35 ESCAPE UAT PASS**：复测 [cursor-sag-escape-retest](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-retest.md)；INDEX＝PASS；关闭 GAP-UAT-P0-3-ESCAPE；SAG-01 v2 伴生 deny PASS。**≠ D5／功能合同收口 ≠ 可上线** |
| 2026-11-16 | **P1-35／REQ-030-056 Spec／Plan 落盘**：纯 MCP 逃生持久修复（钉选放行＋五项证据）；勾连逃生 UAT 与 GAP-UAT-P0-3-ESCAPE。**待 R2-F／R4**；≠ 可上线 |
| 2026-11-16 | **P0-3 纯 MCP 逃生 UAT 基线 FAIL**：挂 [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)；跑次 [claude-sag-escape-baseline](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-claude-sag-escape-baseline.md)；开 GAP-UAT-P0-3-ESCAPE。≠ 开发授权；≠ 可上线 |
| 2026-11-22 | **P1-28 测试台 PASS（解耦口径）**：跑次 [decouple-retest](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md)；计入必做 R0／01–06／08 全绿；ROW-07 单列 FAIL＝P1-29／GAP-UAT-P1-28-VALUE（不计入）。关闭 GAP-UAT-P1-28。`gitSha=88b2e9ea`。≠ 可上线；≠ 核心升级完成 |
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

R-CAV-FDE-1883：[具名补验与收敛](../qa/uat/suites/core-availability/runs/2026-11-20-codex-fde-1883-soak.md)局部FAIL；委托人约1h止测，实跑59分45秒，12次提交重载／8次完整恢复。冻结候选未含后续18b63d01预算修复，优先同候选整合验证；第一／三批原目标修复判定保留。2h／1883表后置I/O／审计最终闭包仍GAP，完整R-CAV未完成，不新增功能或代签客户根因。

后续执行入口：[三问题整改与同候选验证Plan](../plans/lucy-20261120-core-availability-followup-plan.md)，基线f98deeb9；此计划不改变前次测试FAIL／GAP或各功能Spec现值。新增热重载语义先补合同，不以TERM证据代签。

2026-11-20分期：本次只合入既有可用性修复并复验；[后续Plan](../plans/lucy-20261120-core-availability-followup-plan.md)明确下次开发，不在本次执行。原1883表补验FAIL及未覆盖项保留。

0.30本轮合入：d978f4df后端整合源码已完成[既有可用性局部复测](../qa/uat/suites/core-availability/runs/2026-11-20-codex-availability-merge-recheck.md)，120秒I/O／两轮恢复／三轮TERM及原卷恢复PASS WITH GAP；原1883补验FAIL保留。新热点／热重载及满量组合方案下次开发，不改变完整F61／F62／F63出口。
