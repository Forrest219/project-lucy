# UAT 套件总表（测试台 SOT）

> 规则：[`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」。勾连总账：[`docs/governance/e2e-ledger.md`](../../governance/e2e-ledger.md)。本文件是 **UAT 结果唯一真实来源**；不改写 Spec 合同状态。约定见 [`CONVENTIONS.md`](CONVENTIONS.md)。

> **P0 问数六套件（2026-11-14 升级后复跑）**：本机 Mac mini／demo 已 `demo:upgrade`（容器 `gitSha=9d59337d`；≠ 上午 Wave A 的 `3aa402c9`）；新增必做 `UAT-R0-UPGRADE`；Plan [`lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md`](../../plans/lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)。上午 Wave A 跑次仍保留作对照。**≠ 可上线**。

| Suite | 总账 ID | 路径 | 必做环境 | 最近跑次 | 结果 |
|---|---|---|---|---|---|
| `UAT-SUITE-MCP-INQUIRY-PERF` | **P1-78／REQ-030-099**（题组来源 P1-79／REQ-030-100） | [suites/mcp-inquiry-performance](suites/mcp-inquiry-performance/suite.md) | 本机隔离 Docker＋真实 KTX／数据库＋Public MCP＋≥1 真实 Agent；正式全局档先过规模基线 §1.1 MCP-PERF profile（语义取自 P1-54，长链取自 P1-79，数据取自全局规模基线／P1-34） | 尚无（[设计](suites/mcp-inquiry-performance/suite.md)已落盘） | **NOT RUN**（v0.3-draft；R0／01–15 全部必做，含 `SOAK` 持续压力与 `LONG_FOLLOW` 长追问。终稿未确权、测试基建开发与跑次未授权；SEED_ONLY／FAIL／BLOCKED／NOT RUN 均不得作为出包／升级性能 PASS） |
| `UAT-SUITE-ROW-POLICY-AUTO` | P1-72／REQ-030-093 | [suites/row-policy-automatic-enforcement](suites/row-policy-automatic-enforcement/suite.md) | 隔离本机 Docker＋真实 MCP／KTX／MySQL | [2026-11-20-codex-default-row-policy](suites/row-policy-automatic-enforcement/runs/2026-11-20-codex-default-row-policy.md) | **PASS**（39 项真库；286＋97 自动化；既有扩展回归／全仓门禁缺口单列；不是 P1-28 全套 PASS；≠ 可上线） |
| `UAT-SUITE-STORAGE-READINESS` | P1-71／REQ-030-092 | [suites/storage-readiness](suites/storage-readiness/suite.md) | 下一期另行授权后的隔离 Docker＋合成数据＋真实 SQLite／PostgreSQL；0.30 不执行 | 尚无 | **NOT RUN**（仅用例设计；0.30 不开发；材料在需求池作下一期目标；终稿未确权；未获开发授权；不升级、不操作客户实例） |
| `UAT-SUITE-OPS-STEP` | P1-68／REQ-030-089 | [suites/ops-step](suites/ops-step/suite.md) | 独立本机 Docker，前台 Chrome 1920×1080，真实 MySQL／Doris → Hive | [前台复测](suites/ops-step/runs/2026-11-22-codex-ops-step-foreground.md)；[历史跑次](suites/ops-step/runs/2026-11-22-cursor-ops-step.md) | **FAIL（前台补跑，`8fe7cebc`）**。双入口及 51／52 表对号、503 后同卷历史查询通过；SC-11／E4 单次读失败未显示错误提示；行数上限下晚到终态在文件可读、管理页查不到。其余原矩阵缺口见跑次。 |
| `UAT-SUITE-AGENT-ROSTER-SUMMARY` | P1-66／REQ-030-087 | [suites/agent-roster-summary](suites/agent-roster-summary/suite.md) | 隔离 Docker 原生专用卷＋真实 MySQL；前台 Chrome；BAL／SKEW × B109／W2／W5 | [2026-11-20 执行记录](suites/agent-roster-summary/runs/2026-11-20-codex-p166-docker.md) | **PASS WITH GAP（仅F66-A）**：本批BA-01–07收口，最小Docker／前台／MCP通过；[批次A记录](suites/agent-roster-summary/runs/2026-11-20-codex-p166-batch-a.md)。原F66完整矩阵FAIL保留，冷／首访／扩展规模暂停；≠ 可上线 |
| `UAT-SUITE-CORE-AVAILABILITY` | P1-61／P1-62／P1-63／P1-69／P1-70；REQ-030-082／REQ-030-083／REQ-030-084／REQ-030-090／REQ-030-091 | [suites/core-availability](suites/core-availability/suite.md) · [标准复测](suites/core-availability/retest.md) · [交接校准](suites/core-availability/runs/2026-11-22-codex-cav-retest-standard.md) | 本机隔离Docker／合成MySQL；非WebUI与客户交付 | [KSCC 正式 30 分钟](suites/core-availability/runs/2026-11-22-kscc-cav-formal.md)；[2026-11-22 prepack 定向](suites/core-availability/runs/2026-11-22-cursor-prepack-cav-directed.md)；[r6正式30分钟](suites/core-availability/runs/2026-11-20-codex-followup-r6-1800.md)；[旧合入复测](suites/core-availability/runs/2026-11-20-codex-availability-merge-recheck.md) | **STD 正式档 FAIL／证据 VALID**（`8fe7cebc`，livez max 1215.47ms 超 1000ms；其余 STD 用例通过）。历史 r6 FAIL 保留，完整矩阵／R-CAV 未签。**出包前定向**（候选 `prepack-8e3e3f24`／`8e3e3f24`）：CAV-01／CAV-02-fault／control＝**定向 PASS WITH GAP**（诊断真实停止／TERM 排空）；≠ 整套 PASS；≠ 可上线；见 [prepack 就绪评审](../../reviews/2026-11-22-prepack-readiness-review.md)。 |
| `UAT-SUITE-SOURCE-SHORTNAME-CONFLICT` | P1-64／REQ-030-085 | [suites/source-shortname-conflict](suites/source-shortname-conflict/suite.md) | 独立Docker Lucy＋真实MySQL＋前台Chrome；API／MCP／WebUI | [2026-11-20合并最终候选](suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md) | **PASS**：30ec4ae0同镜像R0／01–12共13项及前台浏览器六组计时；候选全库TypeScript0错误，782＋29回归通过；历史FAIL保留；整包结论见独立最终评审 |
| `UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION` | P1-65／REQ-030-086 | [suites/wiki-upload-acl-adoption](suites/wiki-upload-acl-adoption/suite.md) | 本机 demo Docker＋真实前台 Chrome 1920×1080；28 个独立浏览器计时；逐写入严格 MCP | [2026-11-20-codex-closure-recheck](suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md) | **PASS（本轮收口复核）**：四项缺口已整改；51 个独立验收 ID、153 份角色检查／306 条工具断言通过；API／容器文件／Token／Agent 零残留；历史基线 FAIL 与中间失败保留；≠ 可上线 |
| `UAT-SUITE-BEGIN-ZERO-BINDING` | P1-60／REQ-030-081 | [suites/begin-zero-binding](suites/begin-zero-binding/suite.md) | 原生Docker卷／真实MySQL／普通MCP；RC1 CodexCLI0.165.0 | [2026-11-20合并候选完整R](suites/begin-zero-binding/runs/2026-11-20-codex-combined-final.md)；[2026-11-22 prepack smoke](../../../inbox/prepack-closure-20261122/05-p160-smoke/) | **PASS**（功能合同仍以 30ec4ae0 完整 R 为准）。出包前同 digest `prepack-8e3e3f24` smoke＝**SMOKE_PASS**（R0／01／02）；≠ 可上线；≠ 出包。 |
| `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` | P1-58／REQ-030-079；P1-59／REQ-030-080 | [suites/roles-agent-concurrency-scale](suites/roles-agent-concurrency-scale/suite.md) | 首批B1：本机隔离Docker＋真实前台Chrome；完整模块／规模矩阵延期第二批 | [2026-11-20首批归档](suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md) | **PASS WITH GAP（仅B1）**（必要回归及真实前台读／写／冲突／回执／删除主路径通过）；完整F58／F59未PASS，2×／5×及剩余矩阵DEFERRED；R NOT RUN；当前倍率未校准；≠完整功能合同收口；≠可上线。既有独立跑次保留。 |
| `UAT-SUITE-FDE-PACKCHECK` | **P1-55**／REQ-030-076；**P1-56**／REQ-030-077；**P1-57**／REQ-030-078 | [suites/fde-packcheck-3b1c62af](suites/fde-packcheck-3b1c62af/suite.md) | 独立Docker候选ff8e9c05／gitDirty=false／image b19486c2…；旧demo与四基线模式另存 | [2026-11-19-codex-p157](suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md) | **FAIL（原完整范围实测，保持）**：FIX-01正式完整CSV／ZIP409。**D7客户测试范围裁决：可按限定范围进行，排除正式完整导出**（委托人2026-11-19明示延期，待另行安排）。R1／R2及其余本轮必做通过，02／03／04的D5受控降级边界保留；缺陷未关闭，不记为整套UAT PASS／可上线。见[Plan §13](../../plans/lucy-20261119-fde-acceptance-remediation-plan.md) |
| `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` | **P1-53**／REQ-030-074；**P1-54**／REQ-030-075 | [suites/mcp-upgrade-compatibility](suites/mcp-upgrade-compatibility/suite.md) | 被测候选＋Public MCP＋≥1 真实 Agent；**CompatConfigProfile 前置**；客户 capture／POST；双证据；Ops W0／W1／W2 | [P1-53 X_REL 四入口（2026-11-22）](suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md)；[certifyCandidate](suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md)；[P1-54 严口径（历史）](suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)；[Wave D FAIL（历史）](suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-wave-d-candidate.md) | **PASS**（四入口全真：candidate／capture／upgrade／ROLLBACK_VERIFY；[X_REL 跑次](suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md)。P1-53＝X_REL。≠ 可上线；≠ 自动出包） |
| `UAT-SUITE-SOURCE-AMBIGUITY` | P0-3／REQ-030-024 | [suites/source-ambiguity-gate](suites/source-ambiguity-gate/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-18-cursor-sag-hardline-post-rebuild](suites/source-ambiguity-gate/runs/2026-11-18-cursor-sag-hardline-post-rebuild.md) | **PASS**（R0／R0-UPGRADE／SAG-01 v3 硬线；证据挂 [ESCAPE post-rebuild](suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md)；SAG-02 **NOT RUN**；`gitSha=7ebedd4e`）。历史 [2026-11-14](suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) 保留。≠ 可上线 |
| `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` | P1-35／REQ-030-056（纯 MCP 逃生；伴生 P0-3） | [suites/source-ambiguity-mcp-escape](suites/source-ambiguity-mcp-escape/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-18-cursor-sag-escape-post-rebuild](suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md) | **PASS**（重建后 `gitSha=7ebedd4e`／`gitDirty=false`；R0／ESC-01～10＝28/28＋新增 ESC-11 WorkBuddy 会员收入同形；夹具已还原）。上一绿 [v0.4](suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)。评估见 [capability](../../reviews/2026-11-18-workbuddy-member-income-uat-capability-assessment.md)。≠ 客户 COMPAT-09；≠ 可上线 |
| `UAT-SUITE-CALIBER-BINDING` | P0-1／REQ-030-027 | [suites/question-type-caliber-binding](suites/question-type-caliber-binding/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS WITH GAP**（R0-UPGRADE＋CALIBER-01 PASS；CALIBER-02 **Wave B 推迟**） |
| `UAT-SUITE-FIELD-EXPOSURE` | P0-A／REQ-030-012 | [suites/semantic-source-field-exposure](suites/semantic-source-field-exposure/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/semantic-source-field-exposure/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS WITH GAP**（R0-UPGRADE＋EXPOSURE-01 PASS；EXPOSURE-02 **Wave B 推迟**） |
| `UAT-SUITE-ANSWER-VERIFIABILITY` | P0-4／REQ-030-022 | [suites/answer-verifiability](suites/answer-verifiability/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/answer-verifiability/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋AV-01／AV-02；cutoff=`not_checked`） |
| `UAT-SUITE-EMPTY-NEXT-STEP` | P0-5／REQ-030-018 | [suites/empty-result-next-step](suites/empty-result-next-step/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-14-claude-macmini-p0-post-upgrade](suites/empty-result-next-step/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | **PASS**（R0-UPGRADE＋EMPTY-01／EMPTY-02） |
| `UAT-SUITE-CATALOG-SEMANTICS` | P0-2／REQ-030-023 | [suites/catalog-business-semantics](suites/catalog-business-semantics/suite.md) | 本机 demo Docker + MCP `:57881` | [2026-11-22 kscc 定向跑次](suites/catalog-business-semantics/runs/2026-11-22-codex-kscc-catsem-01.md) | **PASS**（本次 R0／R0-UPGRADE／CATSEM-01，3 条源均有业务描述且状态为 `present`）；可选 CATSEM-02 见 [2026-11-14 套件跑次](suites/catalog-business-semantics/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) |
| `UAT-SUITE-CONN-RELOAD` | P1-15／REQ-030-036 | [suites/connection-runtime-reload](suites/connection-runtime-reload/suite.md) | 本机 demo Docker + supervisor | [2026-11-13-claude-gate-reload-cross](suites/connection-runtime-reload/runs/2026-11-13-claude-gate-reload-cross.md)（交叉复跑 GATE-01／RELOAD-02；Cursor 同批见 [cursor-gate-reload](suites/connection-runtime-reload/runs/2026-11-13-cursor-gate-reload.md)） | **PASS**（交叉复跑两条仍 PASS；此前整套 PASS） |
| `UAT-SUITE-CATALOG-SCAN` | P1-16／REQ-030-037；**P1-20**／REQ-030-041 | [suites/catalog-scan-read-path](suites/catalog-scan-read-path/suite.md) | demo Docker + `uat_wide_scan` 种子；MySQL 矩阵见 fixtures；P1-20 本机 Doris／Hive 双目录 lab | [2026-11-19-cursor-hive-jd-ext-rerun](suites/catalog-scan-read-path/runs/2026-11-19-cursor-hive-jd-ext-rerun.md)（最新：`gitSha=3b1c62af`；SIM／KTX／MYSQL＋**EXT-03-DUAL＋EXT-05 lab PASS**）；对照 [2026-11-18-cursor-hive-jd-ext-dual](suites/catalog-scan-read-path/runs/2026-11-18-cursor-hive-jd-ext-dual.md)；CASE／DIFF 仍见 [claude-case-diff-cross](suites/catalog-scan-read-path/runs/2026-11-13-claude-case-diff-cross.md) | **P1-16：PASS WITH GAP**。**P1-20：替身有效＋lab live PASS**（DUAL：`hive.dw`／`hive_jd.app`；EXT-05 缺表→`not_in_library`，SelectDB `Unknown table`）；EXT-04 SKIPPED（lab 无中文表）；客户生产 SelectDB 兼容验收归发布取证。≠ 可上线 |
| `UAT-SUITE-ACCESS-MAP` | P1-17／REQ-030-038；**P1-19**／REQ-030-040 | [suites/access-map-sankey-empty](suites/access-map-sankey-empty/suite.md) | 本机 demo Docker + WebUI + MCP | [2026-11-14-claude-macmini-p119-access-map](suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md) | **PASS**（必做 R0／01–03 PASS；可选 04 实跑 PASS——P1-19 关闭 F-1：`accessPaths` 0→2、`deniedCalls` 未抬、ribbon 0→5；容器 `gitSha=9d59337d`） |
| `UAT-SUITE-ROLES-AGENT-PERF` | P1-13／REQ-030-034 | [suites/roles-agent-page-perf](suites/roles-agent-page-perf/suite.md) | 本机 Docker＋前台 Chrome | [2026-11-22 Agent 定向复测](suites/roles-agent-page-perf/runs/2026-11-22-codex-agent-foreground-retest.md)；[2026-11-13 全套历史跑次](suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md) | **PASS（本次 R0／AGENT-01／02）**：干净构建 `8fe7cebc`，浏览器冷进入 121.6 ms，摘要 API 13.8 ms；打开新建弹窗前 Roles 请求 0 次，打开后 1 次。本次只复测 Agent 选择器。 |
| `UAT-SUITE-PAGE-DOM-SCALE` | 横向评估（方法学回链 P1-58/59；结果分链各页对应套件） | [suites/page-dom-scale](suites/page-dom-scale/suite.md) | 本机 Docker＋前台 Chrome 1920×1080 | [2026-11-22 kscc 5,000／10,000 条审计复测](suites/page-dom-scale/runs/2026-11-22-kscc-token-audit-5k-10k.md)；[前次审计对照](suites/page-dom-scale/runs/2026-11-22-kscc-token-audit-history.md)；[凭据规模复测](suites/page-dom-scale/runs/2026-11-22-codex-token-foreground-retest.md)；[2026-11-20 batch3 汇总](suites/page-dom-scale/runs/2026-11-20-kimi-batch3-page-dom-scale.md)；[batch2](suites/page-dom-scale/runs/2026-11-20-kimi-batch2-page-dom-scale.md)；[batch1](suites/page-dom-scale/runs/2026-11-20-kimi-batch1-page-dom-scale.md) | **PASS（本次 PDS-R0／01 审计历史对照）**：干净构建 `8fe7cebc`，固定 202 条凭据，0／1,500／5,000／10,000 条真实访问审计。站内最大 355.8 ms，最高档列表 API 最大 80.8 ms，四档未复现卡顿，清理恢复 2 条。原多页面汇总 **PASS WITH GAP**，发布记录及评测历史 BLOCKED、R-5 待定性。 |
| `UAT-SUITE-EVENT-LOOP-RELIEF` | P1-21／REQ-030-042 | [suites/event-loop-relief](suites/event-loop-relief/suite.md) | 候选构建跑规模脚本；demo Docker 跑概览／探针 | [2026-11-13-cursor-demo-event-loop](suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md) | **PASS**（R0／01–04）。LOOP-05 归发布取证。≠ 可上线 |
| `UAT-SUITE-COLD-START-SLOW-DISK` | **P1-39**／REQ-030-060 | [suites/cold-start-slow-disk](suites/cold-start-slow-disk/suite.md) | 本机 Docker Desktop；blkio 限速（读写 30MB/s、读 300／写 100 IOPS、2 核）＋宿主 `drop_caches`；`npm run uat:cold-start`；旧 schema 20 万行审计库快照 | [2026-11-19-codex-p157](suites/cold-start-slow-disk/runs/2026-11-19-codex-p157-ff8e9c05.md) | **PASS**：R0／01–05，ff8e9c05；首次升级111.3秒就绪，livez max210／p99 202ms；重启31.5秒，max8／p99 7ms；认领、MCP握手真实通过。产品侧范围为 R0／01–05；COLD-06 归发布取证。≠可上线 |
| `UAT-SUITE-COPY-FAKE-SUCCESS` | **P1-40**／REQ-030-061 | [suites/copy-fake-success](suites/copy-fake-success/suite.md) | 本机 demo 用**局域网 IP**（非回环明文 HTTP）；`npm run uat:copy-probe`；回环无判定力 | [2026-11-17-cursor-copy-probe-hardened](suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-hardened.md)（改前基线：[first FAIL](suites/copy-fake-success/runs/2026-11-17-cursor-copy-probe-first.md)） | **PASS WITH GAP**（R0／01／02a–02j／03 PASS）。开发台 **S5 scoped**（2026-11-22；不含公网 04／helper-only）。≠ 可上线） |
| `UAT-SUITE-BUTTON-FEEDBACK` | **P1-42**／REQ-030-063 | [suites/button-feedback](suites/button-feedback/suite.md) | 本机 demo Docker（回环可用）；`npm run uat:button-feedback`；失败只用真实失败 | [2026-11-17-cursor-button-feedback-after-fix](suites/button-feedback/runs/2026-11-17-cursor-button-feedback-after-fix.md)（改前基线：[FAIL](suites/button-feedback/runs/2026-11-17-cursor-button-feedback-baseline.md)） | **PASS WITH GAP**：改前 07 对账导出 DOWNLOAD-FAILED（界面静默）→ 改后 HONEST-FAILURE（Toast 说明 409 原因）；01–06、08–10 REAL；S01／S02 REAL；G1 PASS。缺口：6 入口 NOT-RUN；07 在 demo 上从未导出成功；低权限／网络失败仅单测；修复未提交 |
| `UAT-SUITE-ACCESS-MAP-SANKEY` | **P1-41**／REQ-030-062 | [suites/access-map-sankey-design](suites/access-map-sankey-design/suite.md) | Docker 种子沙箱（确定性种子 5 profile）；旧码 `6d2664b3` 对 HEAD 的隔离沙箱 A/B 用于基线 | [沙箱跑次](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-restoration-run.md)；[Docker 种子容器全真跑次](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-docker-seeded-run.md)；[demo 容器改编复验](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-demo-docker-run.md)（改前基线见 [probe-baseline](suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-probe-baseline.md)） | **PASS WITH GAP**（Docker 种子必做 PASS；SANKEY-06 沿用旧码 A/B 基线，本次未在 Docker 重跑）。SANKEY-07 归发布取证。≠ 可上线 |
| `UAT-SUITE-CONTEXT-CONTENT` | **P1-30**／REQ-030-051 | [suites/context-content](suites/context-content/suite.md) | 本机 demo Docker + MCP；宿主＝Claude Code CLI + Cursor Agent CLI | [claude](suites/context-content/runs/2026-11-15-claude-ctx-content.md)／[cursor-cli](suites/context-content/runs/2026-11-15-cursor-cli-ctx-content.md) | **PASS WITH GAP**（必做 R0／R0-SEED／WIKI-01…04／SKILL-01…04 PASS；WIKI-01S **BLOCKED**=GAP-2；`gitSha=9d59337d`；判定 JSON `inbox/uat-ctx-content-2026-11-15/verdict-cases.json`）。≠ 可上线 |
| `UAT-SUITE-OPS-CONCEPTS` | **P1-11**／REQ-030-032；**P1-27**／REQ-030-048 | [suites/ops-concepts](suites/ops-concepts/suite.md) | 本机 demo Docker + WebUI + MCP `:57881` | [2026-11-15-cursor-p1-27-ops-retest](suites/ops-concepts/runs/2026-11-15-cursor-p1-27-ops-retest.md)（首跑 FAIL 对照：[claude-macmini-p1-11-ops](suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)） | **PASS**（P1-27 复测：R0／R0-FIX／01／02／03；`gitSha=d64414d6…`、`gitDirty=false`；未补卷 `scripts/`；list／summary／scan preview 业务成功。GAP-UAT-P1-11-RUNTIME 关闭）。≠ 可上线 |
| `UAT-SUITE-ROW-POLICY` | **P1-28**／REQ-030-049；**P1-29**／REQ-030-050（ROW-07 单列；**X_DEF｜下一期**） | [suites/row-policy-finance-scenario](suites/row-policy-finance-scenario/suite.md) | 本机 demo Docker；自造 `uat_row_policy_` 两表；WebUI `:55176`；MCP `:57881` | [2026-11-22-cursor-row-policy-decouple-retest](suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md)（对照 [2026-11-15 retest FAIL](suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md)） | **PASS**（计入核心分母必做 R0／01–06／08 全绿；ROW-07 单列 FAIL＝GAP-VALUE／P1-29，不计入；P1-29 已延期下一期）。`gitSha=88b2e9ea`。≠ 可上线；≠ 核心升级完成 |
| `UAT-SUITE-PAGE-SWEEP` | **P1-31**／REQ-030-052；整改 **P1-32**／REQ-030-053、**P1-33**／REQ-030-054 | [suites/page-event-loop-sweep](suites/page-event-loop-sweep/suite.md) | 本机沙箱（首跑 demo `docker cp` 副本；整改后复跑复用该副本）+ Chromium；合成审计账本夹具 | [2026-11-16-claude-page-sweep-after-rebuild](suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-rebuild.md)（重建后从干净状态完整跑；前一跑次 [after-fix](suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-fix.md)；首跑 [2026-11-15 FAIL](suites/page-event-loop-sweep/runs/2026-11-15-claude-page-sweep-first.md)） | **PASS WITH GAP**（02 零越线；25 未测含 v2 导出）。P1-32／33 开发台 **S5 scoped**（2026-11-22）。≠ 可上线） |
| `UAT-SUITE-EQUIV-GUARD` | **P1-32**／REQ-030-053；**P1-33**／REQ-030-054 | [suites/audit-scale-equivalence-guard](suites/audit-scale-equivalence-guard/suite.md) | 本机 vitest＋better-sqlite3 真库；冻结旧实现与改前金样本；性能面引 `UAT-SUITE-PAGE-SWEEP` | [2026-11-16-claude-equiv-first](suites/audit-scale-equivalence-guard/runs/2026-11-16-claude-equiv-first.md) | **PASS WITH GAP**（71 等价绿；`daily-question-kpi` 变异未实跑）。开发台 **S5 scoped**（2026-11-22）。≠ 可上线） |
| `UAT-SUITE-LARGE-SCHEMA` | **P1-34**／REQ-030-055 | [suites/large-schema-ingestion](suites/large-schema-ingestion/suite.md) | 本机 demo Docker + `lucy-uat-hive`（Doris→Hive 元数据）+ demo-db 大库夹具；**规模下限不得降低** | [2026-11-19-codex-p157](suites/large-schema-ingestion/runs/2026-11-19-codex-p157-ff8e9c05.md) | **PASS（本跑次）**：R0／01–10全部通过；MySQL1201表、Hive605表，实际产出6000／18000字段；旧SCALE-09偶发171秒未归因记录保留，不据此宣称长期稳定。可选11／12未跑。≠可上线 |
| `UAT-SUITE-QUESTION-BUDGET` | **P1-12**／REQ-030-033 | [suites/question-budget](suites/question-budget/suite.md) | 本机 demo Docker + MCP `:57881`；BUDGET-04 另需带 `lucy_continue_question` 的临时身份（需 WebUI 管理员口令） | [2026-11-16-cursor-p1-12-budget-uat-rerun](suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat-rerun.md)（Docker 重建后复跑，`299de2c9`；首跑见 [2026-11-16-cursor-p1-12-budget-uat](suites/question-budget/runs/2026-11-16-cursor-p1-12-budget-uat.md)） | **PASS**（R0／01／02／03／04 全 PASS；第二次续查被拒 `NOT RUN`，由单测覆盖。多轮跑次中有被并发 KTX 重载或脚本参数污染者，均已作废重跑。≠ 可上线） |
| `UAT-SUITE-BUDGET-ESCAPE` | **P1-74**／REQ-030-095 | [suites/budget-escape](suites/budget-escape/suite.md) | 本机 demo Docker＋真实 MCP／compat／Agent；无 session／稳定 session／legacy 身份分列；BESC-07 另需 begin active | [2026-11-22-kimi-p174-budget-escape](suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md) | **PASS WITH GAPS**（功能轴 R0／01–06／08／09／10B／11／12 PASS；BESC-07／10A 环境 BLOCKED；Wave D 全量另案）。开发台 **S5 scoped**（2026-11-22）。≠ 完整 UAT PASS；≠ 可上线） |
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
# 夹具：同目录 fixtures.md（自造 uat_row_policy_；P1-72 起默认自动执行，无需 proven 切换）
# 最近判定：PASS（2026-11-22-cursor-row-policy-decouple-retest；ROW-07 单列 FAIL 不计入）
# 复跑前确认没有 uat-row-policy-* / uat_row_policy_ 残留；无需 proven 切换（P1-72）

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


## 核心可用性F69增量

| Suite／子集 | 归属 | 用例 | 最近跑次 | 判定 |
|---|---|---|---|---|
| UAT-SUITE-CORE-AVAILABILITY／F69 | P1-69／REQ-030-090 | [cases F69](suites/core-availability/cases.md) | [r6定向](suites/core-availability/runs/2026-11-20-codex-followup-r6-directed.md) | SCOPED PASS WITH GAP（r6 core10／25及直接CLI定向）；v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| UAT-SUITE-CORE-AVAILABILITY／FUP校准3 | CA-01／08工程校准 | [后续Plan](../../plans/lucy-20261120-core-availability-followup-plan.md) | [候选3短校准](suites/core-availability/runs/2026-11-20-codex-followup-r3-calibration.md) | FAIL；7次重载拒绝缺少完整所有者／恢复证明，工具时间解析缺陷待全新跑次复验；正式30分钟尚未通过。 |
| UAT-SUITE-CORE-AVAILABILITY／FUP校准4 | CA-01／08工程校准 | [后续Plan](../../plans/lucy-20261120-core-availability-followup-plan.md) | [候选4短校准](suites/core-availability/runs/2026-11-20-codex-followup-r4-calibration.md) | FAIL；独立证据完整性VALID，7次重载拒绝与原身份恢复闭包通过，1次正常写入期semantic_recovery_required仍为真实业务失败；正式30分钟尚未执行。 |
| UAT-SUITE-CORE-AVAILABILITY／FUP校准5 | CA-01／08工程校准 | [后续Plan](../../plans/lucy-20261120-core-availability-followup-plan.md) | [候选5短校准](suites/core-availability/runs/2026-11-20-codex-followup-r5-calibration.md) | FAIL；CLI发现2项P2后主控中止后置取证，2次恢复完成／6次中断；不改写为正常产品失败或PASS。 |
| UAT-SUITE-CORE-AVAILABILITY／FUP校准6 | CA-01／08工程校准 | [后续Plan](../../plans/lucy-20261120-core-availability-followup-plan.md) | [候选6短校准](suites/core-availability/runs/2026-11-20-codex-followup-r6-calibration.md) | CALIBRATION PASS／独立VALID；120秒／2轮、7次精确拒绝恢复与203055条审计闭包通过；不代签正式30分钟。 |
| UAT-SUITE-CORE-AVAILABILITY／FUP正式r6 | CA-08／09工程组合 | [后续Plan](../../plans/lucy-20261120-core-availability-followup-plan.md) | [r6正式30分钟](suites/core-availability/runs/2026-11-20-codex-followup-r6-1800.md) | 独立严格FAIL／证据VALID；生产者PASS WITH GAP原样保留。1800秒／12轮、业务与性能、32原身份恢复及233481条审计闭包通过；进度采集1超时＋2漏采保留缺口，不签完整组合PASS。 |
| UAT-SUITE-CORE-AVAILABILITY／STD 正式 | STD-01～05 | [复测手册](suites/core-availability/retest.md) | [KSCC 正式 30 分钟](suites/core-availability/runs/2026-11-22-kscc-cav-formal.md) | **FAIL／证据 VALID**。1800 秒、12 轮变更及 39 次合同内 MCP 恢复通过；STD-02 直连 livez max 1215.47ms 超 1000ms，STD-01／03／04／05 通过。 |
| UAT-SUITE-CORE-AVAILABILITY／F70 | P1-70／REQ-030-091 | [cases F70](suites/core-availability/cases.md) | [r6定向](suites/core-availability/runs/2026-11-20-codex-followup-r6-directed.md)五项实际及独立SQL验证完成；P170局部功能收口，原夹具FAIL与正式组合严格FAIL保留 | v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 |
