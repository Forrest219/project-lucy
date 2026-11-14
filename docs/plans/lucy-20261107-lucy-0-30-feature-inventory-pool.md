# Lucy 0.30 功能清单池

| 元数据 | 内容 |
|---|---|
| 文档类型 | **`0.30.0`／`lucy-v0.30` 产品线执行总账（SOT）**。完整跟踪本产品线新功能、旧功能修复、尚未开发／冻结／结案。不是功能 Spec；**单条仍不构成开发授权** |
| 版本 / 日期 | v0.69 / 2026-11-14 |
| 状态 | **生效跟进**。产品线 `lucy-v0.30` / `0.30.0`。**中间态已出口（2026-11-13）**见 [盘点](../reviews/2026-11-13-025-to-030-midstate-inventory.md)／[执行 Plan](lucy-20261113-midstate-exit-closure-plan.md)。**P0-1…5／A 已收口**；半成品四项 CLOSED；**P0-6／7／B 仍冻结**；**P1-15…18 差集补录**；**端到端三台账**已立（测试台挂 P0-1／2／3／4／5／A＋P1-15／16／13／17）。**≠ 可上线；≠ 核心升级完成**。未授权条目禁止改运行代码 |
| 受众 | 本仓库所有在 `lucy-v0.30` / `0.30` 上工作的人与 agent |
| 授权边界 | **立项 ≠ 改代码**；**写 Spec ≠ 可实现**；**过程对抗 ≠ 终稿确权**；**终稿确权 ≠ 开发授权**；**入池 ≠ 立项**。改代码须：终稿确权 → 委托人 **另发开发授权**。本池不代替 Spec／Plan |
| 事实源分工 | **仓库级 SOT 规则** → [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「产品线执行总账（SOT）」；**方向** → [核心方向](lucy-20261107-lucy-0-30-core-direction.md)；**缺口正文** → [需求池](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；**本文件** → 本产品线工作项全集、优先级、核心分母属性、跟进序 |
| 维护规则 | 只追加或改状态／优先级／分母属性；不得静默删条目。状态变更须写「变更」行。与需求池 REQ ID 双向可追。**「不入核心分母」仍须有行** |

## 变更

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.69 | 2026-11-14 | **入池 P1-25／REQ-030-046**：行权限能力评审（面向约 100 用户、其中 30–40 人行级受限）。委托人 2026-11-14 授权审阅既有行权限 Spec（主 Spec、模板与视图、展示、P1-2 编译门禁草案、ADR）、核对已落地代码并做浏览器实地探查，输出认同／反对意见。同日 [评审报告 v1.0](../reviews/2026-11-14-row-policy-capability-assessment.md) 已出。**仅评审，不含开发授权**；不改任何 Spec 状态。UAT not_registered；**不入核心分母**；**不挡**原 P0；≠ 可上线 |
| v0.69 | 2026-11-14 | **P1-24 Spec／Plan 升 v0.2：纳入浏览器盘点**（委托人指示「用浏览器探查，只做优化的 Spec 和 Plan，不做开发」）。新增 UXR-10–15（对比度、小字号、点击目标、无标签输入、行权限哈希被裁、1280×800 容器内溢出）与裁决项 D-1–D-4；UXR-07 经浏览器核实为假阳性，已关闭；UXR-02 补浏览器证据（`新建 Agent`、`续期`、`吊销` 浮层无名称／不响应 `Esc`／焦点不进入）。批次改为 B1–B5。**仍无开发授权**，仅文档。≠ 可上线 |
| v0.68 | 2026-11-14 | **入池 P1-24／REQ-030-045**：WebUI 存量 UI/UX 整改（逐页）。委托人 2026-11-14 同意「提出整改意见、落盘为新 Spec、后期逐页修改」＝立项；**不含开发授权**。[Spec v0.1-draft](../specs/lucy-20261114-webui-uiux-remediation-spec.md) 登记 UXR-01–09、批次 B1–B4；进度唯一现值在该 Spec §7。同时更正 v0.67 所述存量数：手写 Drawer 17、`pl-modal-*` 7（不含测试文件口径），`pl-wiki-preflight-*` 仍为 8。UAT not_registered；**不入核心分母**；≠ 可上线 |
| v0.67 | 2026-11-14 | **P1-23：浮层收敛方向裁决**。委托人批准：行为基座统一 Radix Dialog，样式保留 `pl-drawer-*`／`pl-dialog-*` 两族；`15-components-overlay.md` 升 v1.1，TD-20261114-01 升格归档。**存量迁移（手写 Drawer 18、`pl-modal-*` 9、`pl-wiki-preflight-*` 8）是运行代码改动，未获开发授权，不在本次范围**，须另入总账行并取得授权。仅文档；≠ 可上线 |
| v0.66 | 2026-11-14 | **P1-23 门禁落地**（委托人「加门禁」）：`lint:spec-docs` 新增 `ds-index`／`ds-meta`／`ds-td-expiry`／`ds-ref` 四条，附 4 个单测。仅改 `scripts/lint-spec-docs.mjs` 与测试，不触运行代码。仓库既有 87 条存量违规未变（基线本就为红，非本次引入）。≠ 可上线 |
| v0.65 | 2026-11-14 | **P1-23 推进**：委托人批准后续步骤；新增设计系统 `15-components-overlay.md`、`16-patterns-states.md`，`DEVELOPMENT.md` 改为「WebUI UI/UX 标准总入口」，`99-governance.md` 登记 TD-20261114-01（浮层类名族收敛，待委托人裁决）。**未新增 lint 门禁**（待另行确认）。仅文档；≠ 可上线 |
| v0.64 | 2026-11-14 | **入池 P1-23／REQ-030-044**：UI/UX 标准收敛并与 DEVELOPMENT 绑定（设计系统过期核对、临时决策清账、缺章补齐、总入口表）。委托人 2026-11-14 批准核对与「先登记、清临时决策」两步，范围**仅文档**，不含运行代码／`app.css`／组件改动。核对报告 `inbox/20261114-0130-uiux-standard-audit.md`。UAT not_registered；**不入核心分母**；**不挡**原 P0；≠ 可上线 |
| v0.63 | 2026-11-14 | **入池 P1-22／REQ-030-043**：Doris／SelectDB 多版本对比环境（客户现网 2.0.14 → 4.x，具体版本不详）。委托人 2026-11-14 同句「我决定以你为准，构建长期测试对比环境」＝立项＋测试环境搭建授权，范围**仅**对比环境、版本探测与证据，**不含**适配代码改动。Spec／Plan 待补；UAT not_registered；**不入核心分母**；**不挡**原 P0；≠ 可上线 |
| v0.62 | 2026-11-13 | **P1-21／REQ-030-042 测试台首跑 PASS**（[`2026-11-13-cursor-demo-event-loop`](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)；必做 R0／01–04；可选 LOOP-05 BLOCKED）。不改功能合同收口句的合同结论。≠ 可上线 |
| v0.61 | 2026-11-13 | **P1-21／REQ-030-042 测试台挂套件** `UAT-SUITE-EVENT-LOOP-RELIEF`。INDEX＝NOT RUN。不改功能合同收口句的合同结论。≠ 可上线 |
| v0.60 | 2026-11-13 | **P1-21／REQ-030-042 功能合同已收口**。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。UAT not_registered。**不入核心分母**。≠ 可上线 |
| v0.59 | 2026-11-13 | **P1-21／REQ-030-042 终稿确权＋开发授权，实现已落地，SC-14 未过**。`/turns?hours=168` p95 105ms。`/api/livez` p99 359ms（门槛 300ms），max 487ms，BUSY＝0。按 O1 不启用 worker，待委托人决定。O2 只改本分支。UAT not_registered。**不入核心分母**。≠ 可上线 |
| v0.58 | 2026-11-13 | **P1-20／REQ-030-041 实现落地**：委托人「批准修复」＝终稿确权＋开发授权。外部目录单表字段改走直连 `DESC`→`SHOW COLUMNS`→`DESCRIBE`；根因已在 KTX 0.16.0 验证（只读校验禁止 `Describe`）。vitest 5 文件 76/76；客户 live 未验；**不入核心分母**；≠ 可上线 |
| v0.57 | 2026-11-13 | **入池 P1-21／REQ-030-042**（事故修复）：客户规模审计数据下，访问日志等读接口同步重算长时间占住事件循环，致 Pod 被 liveness 误杀、系统概览报「页面数据暂时无法完成刷新」。方案 Spec／Plan 已落盘；**待终稿确权＋O1／O2 裁决＋开发授权**；**不入核心分母**；UAT not_registered；≠ 可上线 |
| v0.56 | 2026-11-13 | **入池 P1-20／REQ-030-041**：外部目录单表读字段（P1-16 续作）。准备表结构能列表、选中表报「没有读到字段」。方案 Spec／Plan 已落盘；**待终稿确权＋开发授权**；**不入核心分母**；≠ 可上线 |
| v0.55 | 2026-11-13 | **P0 问数六套件 UAT（方案 B）**：测试台挂 P0-3／1／A／4／5／2；INDEX 必做 PASS（P0-1／A PASS WITH GAP）。Plan [`lucy-20261113-p0-qa-uat-six-suites-plan.md`](lucy-20261113-p0-qa-uat-six-suites-plan.md)。**≠ 改跟进状态合同句；≠ 可上线** |
| v0.54 | 2026-11-13 | **立项并授权实现 P1-19／REQ-030-040**：访问关系图允许词表对齐（`ok`＋历史 `allow` 进 band E）。来源＝空桑基 UAT F-1。**不入核心分母**；≠ 可上线 |
| v0.53 | 2026-11-13 | **P1-13 测试台回链**：Spec 列挂 [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md)；INDEX **PASS**（Roles／Agent 页体感）。**≠ 改跟进状态句；≠ 可上线** |
| v0.52 | 2026-11-13 | **端到端三台账**：DEVELOPMENT 增「需求台／开发台／测试台」；勾连＋基准线追评见 [e2e-ledger](../governance/e2e-ledger.md)；测试台 SOT＝[`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)。P1-15／P1-16 Spec 列回链 UAT Suite。**≠ 可上线；≠ 核心升级完成** |
| v0.51 | 2026-11-13 | **SOT 升格＋差集补录**：本文件明确为产品线执行总账；对齐 DEVELOPMENT「产品线执行总账（SOT）」；补登记 **P1-15…18／REQ-030-036…039**（连接热重载、库内扫表、空桑基、MCP Skill 入口）；§1 增补入账／兜底；§5 勾选对齐 P0-4／5／A 已收口。**≠ 可上线；≠ 核心升级完成** |
| v0.50 | 2026-11-13 | **中间态已出口**：[盘点](../reviews/2026-11-13-025-to-030-midstate-inventory.md)／[执行 Plan](lucy-20261113-midstate-exit-closure-plan.md)。Edit／桑基／扫表／Skill 半成品 CLOSED；P0-6／7／B 仍冻结。**≠ 可上线；≠ 核心升级完成** |
| v0.49 | 2026-11-13 | **中间态出口收口盘点**（执行前）：规则与半成品清单登记。**≠ 可上线；≠ 核心升级完成** |
| v0.48 | 2026-11-13 | **W1 P1-13 路径 A**（[landed 收口 Plan](lucy-20261113-landed-middev-closure-batch-plan.md) Task W1-4）：书面「发布取证 acceptance 代替实现 CR」；回链 [acceptance](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md)＋[登记](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md)；镜像 Spec／Plan／需求池。**无**实现 CR PASS。**≠ 可上线** |
| v0.47 | 2026-11-13 | **W1 P1-14 CR 落盘**（[landed 收口 Plan](lucy-20261113-landed-middev-closure-batch-plan.md) Task W1-3）：实现 CR PASS；vitest retrospective snapshot＋csv **11/11** 复核；镜像 Spec／需求池。**≠ 可上线** |
| v0.46 | 2026-11-13 | **W1 P1-12 CR 落盘**（[landed 收口 Plan](lucy-20261113-landed-middev-closure-batch-plan.md) Task W1-2）：实现 CR PASS；vitest question-budget 三文件 44/44 复核；镜像 Spec／需求池。**≠ 可上线** |
| v0.45 | 2026-11-13 | **W1 P1-11 CR 落盘**（[landed 收口 Plan](lucy-20261113-landed-middev-closure-batch-plan.md) Task W1-1）：实现 CR PASS；vitest `ops-concepts` 20/20＋`concepts:test` 29/29 复核；镜像 Spec／Plan §3 链接列。**≠ 可上线** |
| v0.44 | 2026-11-13 | **Wave B O 闭合镜像收束**（治理 Plan Task 13）：P0-6／7／B「O 已闭合；待 R2-F」同步 `docs/README.md`／`plans/README.md`／project-overview §9／需求池 REQ-030-025／026／028。头部状态句同句。**不是** R2-F／R4；不可功能合同收口 |
| v0.43 | 2026-11-13 | **P0-B／REQ-030-028** 委托人会话批准整包采纳建议包 F；**O1–O3 已闭合（2026-11-13）**。Spec／Plan v0.1-draft 同句。**待 R2-F；终稿未确权；冻结落地；未授权实现**。**不改 P0-4 `not_checked`**。**不是** R2-F／R4；不可功能合同收口 |
| v0.42 | 2026-11-13 | **P0-7／REQ-030-026** 委托人会话批准整包采纳建议包 E；**O1–O6 已闭合（2026-11-13）**。Spec／Plan v0.4-draft 同句。**待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4；不可功能合同收口 |
| v0.41 | 2026-11-13 | **P0-6／REQ-030-025** 委托人会话批准整包采纳建议包 S；**O1–O3 已闭合（2026-11-13）**。Spec／Plan v0.4-draft 同句。**待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4；不可功能合同收口 |
| v0.40 | 2026-11-13 | **P0-B／REQ-030-028**（[O1–O3 决策纸](../reviews/2026-11-13-p0-b-o1-o3-decision-package.md) 推荐整包 F；**不改 P0-4 `not_checked`**）。**终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4；O1–O3 未闭合前不可功能合同收口 |
| v0.39 | 2026-11-13 | **P0-7／REQ-030-026**（[O1–O6 决策纸](../reviews/2026-11-13-p0-7-o1-o6-decision-package.md) 推荐整包 E）。**终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4；O1–O6 未闭合前不可功能合同收口 |
| v0.38 | 2026-11-13 | **Wave A 收束**（[治理优化 Plan](lucy-20261113-p0-governance-optimization-plan.md) Task 5）：四份实现 CR 链接可达；P0-5 镜像 project-overview／需求池 REQ-030-018；`docs/README`／`plans/README` 补 CR 链。**≠ 可上线** |
| v0.37 | 2026-11-13 | **Wave A P0-5 CR 落盘**（[治理优化 Plan](lucy-20261113-p0-governance-optimization-plan.md) Task 4）：实现 CR PASS；vitest 空结果 33/33 复核；消「Approve with nits」无附件状态句。镜像 Spec／Plan §3 链接列。**≠ 可上线** |
| v0.36 | 2026-11-13 | **Wave A P0-4 CR 落盘**（[治理优化 Plan](lucy-20261113-p0-governance-optimization-plan.md) Task 3）：实现 CR PASS；vitest `answer-verifiability` 26/26 复核；消「C1／C2／M5」无附件状态句。镜像 Spec／Plan §3 链接列。**≠ 可上线** |
| v0.35 | 2026-11-13 | **Wave A P0-A CR 落盘**（[治理优化 Plan](lucy-20261113-p0-governance-optimization-plan.md) Task 2）：实现 CR PASS；vitest field-exposure 五文件 75/75 复核。镜像 Spec／Plan §3 链接列。**≠ 可上线** |
| v0.34 | 2026-11-13 | **Wave A P0-2 CR 落盘**（[治理优化 Plan](lucy-20261113-p0-governance-optimization-plan.md) Task 1）：实现 CR PASS；vitest `catalog-business-semantics` 23/23 复核。镜像 Spec／Plan §3 链接列。**≠ 可上线** |
| v0.33 | 2026-11-13 | **登记 P1-14／REQ-030-035**（问询预算复盘审计字段；交付面 A）。Claude R1／R2 CONDITIONAL → 文档修订；**委托人 R2-F＋R4**；**实现已落地**（`budgetSnapshot`＋`calls.csv` 表尾；v2 排除）。**不挡**原 P0；≠ 可上线。§7 覆盖扩至 REQ-030-001–035 |
| v0.32 | 2026-11-13 | **P0-6／REQ-030-025** Spec／Plan 升 **v0.4-draft**（Cursor 过程对抗：D13 对齐 `review_status`；[O1–O3 决策纸](../reviews/2026-11-13-p0-6-o1-o3-decision-package.md) 推荐整包 S）。**终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4；O1–O3 未闭合前不可功能合同收口 |
| v0.31 | 2026-11-13 | **P0-A／REQ-030-012 功能合同已收口**：SC-01–SC-30 证据关闭（vitest 5 files／75 passed；含 SC-04／06／12／13／17／18／25）。见 [证据审计](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md)。**≠ 可上线** |
| v0.30 | 2026-11-13 | **P0-1／REQ-030-027 功能合同已收口**：SC-01–SC-30 证据关闭（vitest 80/80；含 SC-22）。见 [证据审计](../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md)。委托人批准补测收口。**≠ 可上线** |
| v0.29 | 2026-11-13 | **P0-1／REQ-030-027 SC 审计**：SC-29／30 自动化已补；仍 **OPEN SC-22**（混合整批／绑定基线失败夹具）。见 [证据审计](../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md)。**未**收口。**≠ 可上线** |
| v0.28 | 2026-11-13 | **P0-2／REQ-030-023 功能合同已收口**：SC-01–SC-17 证据关闭（vitest `catalog-business-semantics` 23/23；见 [证据审计](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md)）。**P0-A** 审计见 [证据审计](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md)（OPEN SC-04／06／12／13／17／18／25 → **仍待功能合同收口**）。镜像 Spec／Plan／README／本池仅升 P0-2。**≠ 可上线** |
| v0.27 | 2026-11-13 | **P0-3／REQ-030-024 功能合同已收口**：SC-01–SC-26 证据关闭（vitest 48/48；见 [证据审计](../reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md)）。镜像 Spec／Plan／README／本池。残余 SUGGEST ASK_FIRST 双写不挡收口。**≠ 可上线** |
| v0.26 | 2026-11-13 | **P0-1／P0-2／P0-A 状态镜像**：Spec／Plan／清单／README 由「实现中」改为 **实现已合入；待功能合同收口**（对齐代码与 P0-1 CR PASS）。消掉 §2「实现已提交」与 §3「实现中」分叉。**≠ 可上线** |
| v0.25 | 2026-11-13 | **P1-13／REQ-030-034**：**发布取证出口证据齐（SC-01–SC-16）**；RPB-W2 release-medium pass（acceptance-w2）。镜像 Spec／Plan／README／需求池。**不挡**原 P0；≠ 可上线 |
| v0.24 | 2026-11-13 | **P1-13／REQ-030-034**：R2-F＋R4（委托人明示）；**Wave 0–2 已实现**（Roles／Agent 列表债、release-perf runner、发版列车 P4-9／formal 种子）。**不挡**原 P0；≠ 可上线。§7 覆盖扩至 REQ-030-001–034 |
| v0.23 | 2026-11-13 | **四轨收口并行写回**：P0-3 独立复验 PASS（待功能合同收口）；P0-4／P0-5 **功能合同已收口**（夹具债／SC-01–30 证据齐）；P1-10 仍 **委托人结案**（效果门卷宗仅 inbox 参考，不重开）。镜像 Spec／Plan／README |
| v0.22 | 2026-11-13 | **P1-10／REQ-030-031 委托人结案**：本分支不做 ontology-lite CLI／WebUI／效果门跟进；产品交付只走 **P1-11 Ops MCP**。镜像 Spec／Plan／需求池／README |
| v0.21 | 2026-11-11 | **补登记 P1-12／REQ-030-033**（问询预算默认阈值放宽：20／120s → 60／300s；续查仍 1 次）。委托人批准方案二并已实现于本分支（`2032e970`）；**不挡**原 P0；≠ 可上线。§7 覆盖扩至 REQ-030-001–033 |
| v0.20 | 2026-11-09 | **P0-6／P0-7** Spec／Plan 升 **v0.3-draft**（Cursor 过程对抗，建议包 S／E，**未闭合 O 项**）；**P0-B** 立项开 Spec／Plan **v0.1-draft**（建议包 F）。**均非 R2-F／R4**；冻结落地；未授权实现 |
| v0.19 | 2026-11-09 | **P1-11／REQ-030-032**：功能合同层收口（SC-01–SC-22 自动化证据）；**≠ 可上线**；不挡原 P0 |
| v0.18 | 2026-11-09 | **P1-11／REQ-030-032**：**R4 开发授权**；实现中（Cursor）；不挡原 P0 |
| v0.17 | 2026-11-09 | **P1-11／REQ-030-032**：**R2-F** 认可 Spec／Plan v0.5；**O2＝B** 书面跳过效果门；**仍待 R4**；未授权实现；不挡原 P0 |
| v0.16 | 2026-11-09 | **正式立项 P1-11／REQ-030-032**（概念注册表→Lucy Ops）；Spec／Plan v0.1-draft；路径 A（Ops 优先于 WebUI）；**未授权实现**；不挡原 P0 |
| v0.15 | 2026-11-09 | **P1-10／REQ-030-031**：**R4 开发授权**（委托人明示）；一期 CLI 实现中（Cursor）；头部／§2／§6 镜像同句 |
| v0.14 | 2026-11-09 | 头部状态镜像：P1-10 **R2-F 已确权、待 R4**（与 §3／变更 v0.12 行对齐） |
| v0.13 | 2026-11-09 | **P0-4／REQ-030-022**：Spec／Plan 升 **v0.4-draft**（Codex R2＝BLOCK 后闭合 AV-08／03／06／09＋错位引用）；评审记录 v0.3；待 Codex R2 复验；**终稿未确权**；**未授权实现**；不代裁定 O1／O2 |
| v0.12 | 2026-11-09 | **P0-4／REQ-030-022**：Spec／Plan 升 **v0.3-draft**（Codex R1＝BLOCK 后 AV-01…AV-10 文档闭合）；评审记录 v0.2；待 Codex R2；**终稿未确权**；**未授权实现** |
| v0.12 | 2026-11-09 | **P1-10／REQ-030-031**：**R2-F 终稿确权**（委托人明示认可 Spec v0.6／Plan v0.4）；**仍待 R4**；未授权实现；**不挡**原 P0 |
| v0.11 | 2026-11-09 | **P1-10／REQ-030-031**：配套 Plan 已开（v0.1-draft）；Spec 升 v0.3-draft。仍待评审／终稿确权；**未授权实现**；**不挡**原 P0 |
| v0.10 | 2026-11-08 | 委托人确认登记：**P1-10**（REQ-030-031 轻量概念注册表／ontology-lite）。**仅入池**；头脑风暴 Spec 草案已有；Plan 未开；**不挡**原 P0；未授权实现。§7 覆盖扩至 REQ-030-001–031 |
| v0.9 | 2026-11-08 | 委托人选定 3 条入池：**P0-B**（REQ-030-028 物理新鲜度合同）、**P1-8**（REQ-030-029 语义发布→Eval 门禁）、**P1-9**（REQ-030-030 质量域 safe-log→Eval）。**仅登记**；未立项开 Spec；未授权实现。§7 覆盖范围扩至 REQ-030-001–030 |
| v0.8 | 2026-11-08 | P0-2／P0-A／P0-3：**委托人明示 R2-F 定稿＋R4 开发授权**（Cursor coder 实现；Cursor reviewer CR）；P0-2 O1／O2／O3 与 P0-3 O1／O2／O4 随授权闭合。其余 P0／P1／P2 仍冻结 |
| v0.7 | 2026-11-08 | P0-1：**R4 开发授权**（Claude Code 实现；Cursor Agent code review）；Spec／Plan 升 v0.9。其余 P0 仍冻结 |
| v0.6 | 2026-11-07 | P0-1／REQ-030-027：**O1／O2（R3）委托人闭合**（选项「1」＝全采纳 Codex 三轮闭合包）；Spec／Plan 升 v0.8。仍待 R4 开发授权；未授权实现 |
| v0.5 | 2026-11-07 | 委托人裁定**终稿确权口径**：终点＝**Codex CLI 终审**；无 Codex 时委托人明示确权亦可。其他对抗性评审只记过程，不得确权（除非委托人另确认）。同步 §2.2／§2.3／§3 跟进状态，废止「暂缓对抗」过时句 |
| v0.4 | 2026-11-07 | 委托人裁定：**先写齐 P0 Spec／Plan，暂缓对抗式评审**；落地仍冻结。登记 §2.3（已被 v0.5 进度句取代，本行仅作史） |
| v0.3 | 2026-11-07 | 委托人裁定：**暂时都不开工落地**；本阶段只对 Spec／Plan 做严格验收与评审，**评审通过并另授开发授权后才可开实现**。登记 §2.2 评审门禁 |
| v0.2 | 2026-11-07 | 委托人批准 **分批建立 Spec**；登记 §2.1 批次表；Batch S1 开出 P0-1 Spec／Plan（v0.1-draft，待评审、未授权实现） |
| v0.1 | 2026-11-07 | 首立。委托人批准 **P0 立项**；按核心方向落地完整 P0／P1／P2 功能清单池，供本分支 agent 遵从跟进 |

---

## 1. Agent 遵从规则（本分支强制）

凡在 `lucy-v0.30`、产品线 `0.30.0`、或声称「做 0.30」的会话，开工前必须：

1. **先读本池（执行总账 SOT）+ [核心方向](lucy-20261107-lucy-0-30-core-direction.md)**，再动 Spec／代码／排期。仓库级口径见 [`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「产品线执行总账（SOT）」。
2. **主线优先于辅线**：与 P0 抢带宽时，辅线（P2）与非阻塞 P1 让路。
3. **不得把立项／写 Spec／过程对抗当成终稿或开发授权**：无该条 **终稿确权（§2.2）+ 明确开发授权** 前，禁止改运行代码、禁止「顺手落地」、禁止写实现 PR。
4. **现行阶段只做规格**：允许写／改／过程评审 Spec 与 Plan；**暂时一律不开工落地**（§2.2），直至委托人按条授权。**已获授权或事故修复授权的条目除外**（须在总账有行）。
5. **先入总账再动手／再叙事**：新功能、旧功能修复、事故修复、尚未开发项——先追加本池行（并回写需求池 REQ），再开 Spec 或改代码。**禁止无行旁路。**「不入核心分母」只写在「核心分母」列，不得省略入账。
6. **状态只改本池镜像列 + 需求池／Spec 头部**：收口、授权、Deferred 以 Spec 头部为功能事实源；本池「跟进状态」须同句对齐，禁止两套现值。过程评审深度与终稿确权分列，禁止混成一句「评审通过」。
7. **P0 七项 + P0-A 未齐前**，不得宣称「0.30 核心升级完成」（判据见核心方向 §9）。不入核心分母的已落地项（如 P1-15…18）**不替代**该判据，但仍须在本池跟踪。
8. **兜底差集**：中间态出口或 `user-facing`／发版叙事定稿出门前，用事实面减本池；**事实有、池没有 → 当日补行**；**池有、事实无却已主张交付 → 改状态或撤回主张**（细则见 DEVELOPMENT）。
9. **三台账**：本池＝需求台 SOT；Spec 头部＝开发台；[`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)＝测试台。主张 UAT 须挂测试台；勾连见 [`e2e-ledger.md`](../governance/e2e-ledger.md)。**功能合同收口 ≠ UAT PASS**。

---

## 2. P0 立项批准

| 项 | 内容 |
|---|---|
| 批准日 | 2026-11-07 |
| 批准范围 | 下表 **P0-1…P0-7** 与伴生 **P0-A**；授权进入「澄清 → Spec → Plan」流水线 |
| 追加入池／跟进立项 | **P0-B**（028）待 R2-F。**P1-8／9** 待立项。**P1-10** 结案；**P1-11…14** 已落地／收口。**P1-15…18**（036…039）**差集补录（不入核心分母）**。**P1-19**（040）访问面允许词表，委托人授权实现 |
| 明确未授权 | 实现代码、客户出包、上线、把辅线抬成主线；**入池条目不得顺手实现** |
| 建议实施序 | P0-1 → P0-2∥P0-A → P0-3 → P0-4∥P0-5 → P0-6（含 019／020 最小面）→ P0-7 |
| 已有先行 Spec | P0-4／P0-5＝S4 已落地（功能合同已收口）；P0-A＝REQ-030-012（**功能合同已收口（2026-11-13）**）；P0-6 的 019／020 已有 Spec／Plan（最小面纳入 P0，完整体验见 P1） |
| Spec 设计批准 | **2026-11-07** 批准按 §2.1 **分批建立 Spec／Plan**（详细规格设计）。仍 **≠ 开发授权** |
| 落地冻结 | **2026-11-07**：委托人裁定 **暂时都不开工落地**；本阶段带宽只用于 Spec／Plan 的严格验收与评审（§2.2） |

### 2.1 Spec 分批计划（agent 必须按批；本阶段禁止实现）

| 批次 | 清单项 | 动作 | 状态 |
|---|---|---|---|
| **S1** | P0-1（027） | Spec＋Plan | **v0.9；功能合同已收口（2026-11-13）**；SC-01–SC-30 证据关闭。**≠ 可上线** |
| **S2** | P0-2（023）∥ P0-A（012） | Spec＋Plan | P0-2＝**功能合同已收口（2026-11-13）**。P0-A＝**功能合同已收口（2026-11-13）**（SC-01–SC-30）。均 **≠ 可上线** |
| **S3** | P0-3（024） | Spec＋Plan | **v0.5；R2-F＋R4 已闭合；功能合同已收口（2026-11-13）**；SC-01–SC-26 证据关闭。**≠ 可上线** |
| **S4** | P0-4（022）∥ P0-5（018） | Spec＋Plan＋实现 | P0-4＝**v0.4；功能合同已收口；实现 CR PASS（2026-11-13）**。P0-5＝**v0.8；功能合同已收口；实现 CR PASS（2026-11-13）**。均 **≠ 可上线** |
| **S5** | P0-6（025＋019／020 最小面） | Spec＋Plan | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O3 已闭合（2026-11-13）＝建议包 S；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口** |
| **S6** | P0-7（026） | Spec＋Plan | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口** |

规则：同一时刻以当前批次主角 Spec／评审为带宽优先；下一批须等本批 Spec 至少进入「待评审」或委托人明示并行。**任何批次在终稿确权 + 开发授权之前不得改运行代码。**

### 2.2 Spec／Plan 评审门禁（本阶段唯一主路径）

> **现行裁定（2026-11-08 更新）**：已授权条目（P0-1／P0-2／P0-A／P0-3）可按各自 Spec／Plan 实现；**未授权条目仍冻结**。其余条目继续 Spec／Plan 评审与终稿确权。

#### 三层进度（禁止混写）

| 层 | 含义 | 可否分叉 |
|---|---|---|
| **过程评审** | 批次形式合规＋事实性、Claude Code／其他对抗等——可记、可改稿 | **允许**单条深浅不同 |
| **终稿确权** | 该条 Spec／Plan 被承认为可进入签核／授权前的终稿 | **统一门槛**（见下） |
| **开发授权** | 委托人另发；允许改运行代码 | **统一**；确权 ≠ 可改代码 |

#### 终稿确权（唯一承认的终点）

满足**任一**即构成该条终稿确权：

1. **Codex CLI 终审完成**（阻断项清零或 triage 闭合，修订回写版本号，结论落 `docs/reviews/` 并回链 Spec／Plan 头部）；或  
2. **委托人明示确权**——适用于当时**没有** Codex 终审、或委托人选择直接确权的情形。

**不构成终稿确权**（除非委托人另行明示同意升格）：Claude Code、批次 R1、同伴互评、对话里的「看起来可以了」、仅修订到更高 draft 版本号。此类工作**必须登记**为过程，状态不得写成「评审通过」「终稿」「可交付开发」。

#### 进入开发授权前的门禁序

| 步 | 门禁 | 通过标准 |
|---|---|---|
| R1 | 形态验收 | `npm run lint:spec-docs` 对该 Spec／Plan 无新增阻塞；落盘清单 12 条可人工勾销（不得以「门禁全绿」代替内容评审） |
| R2 | 过程对抗评审 | 可多轮、可多工具；阻断项逐条 triage；修订回写版本号；**只记过程，不确权** |
| R2-F | **终稿确权** | **Codex CLI 终审**，或**委托人明示确权**（无 Codex 时亦可）。通过后才可把头部状态改为终稿类现值 |
| R3 | 决策闭合 | Spec 内「开工前必答」（如 O1／O2）已由委托人裁定并落笔；无悬空二选一 |
| R4 | 开发授权 | 终稿确权之后，委托人**另发明确开发授权**；无授权不得改代码 |

**禁止**：

- 以「P0 立项」「Batch 已开 Spec」「Plan 已写」「做过对抗」「版本升到 v0.x」为由开始实现或提交实现 PR
- 把非 Codex、非委托人确权的过程评审写成终稿或「评审通过」
- 未终稿确权／未获开发授权就改 `webui/server`／语义运行时／Eval runner 等生产路径
- 把评审记录只留在对话里——须落 `docs/reviews/` 或 `inbox/` 并回链 Spec 头部

**本阶段允许**：继续写／改 Spec／Plan；做过程评审与修订；登记评审发现与决策纸；按条推进 Codex 终审或请委托人确权。

### 2.3 当前执行序（2026-11-07）

1. **批次共同起点已齐**：P0（含 P0-A）Spec＋Plan 草案落盘；批次 R1（形式合规＋事实性）主路径已修订（c13 缺口见 round1 记录，须补跑或显式登记）。  
2. **过程对抗可继续**；深度允许分叉；**一律不升格为终稿**，直至 Codex 终审或委托人确权。  
3. **仍禁止**任何实现／改运行代码，直至单条 R1 → R2-F → R3 → R4 闭合。

**下一步**：按条做 Codex CLI 终审（或委托人确权）；仍禁止实现。

---

## 3. 完整清单总表（执行总账 SOT）

图例：**跟进状态**＝本池跟进用（过程深度可分叉；**终稿确权**统一见 §2.2）；功能合同收口仍以各 Spec 为准。**核心分母**＝是否进入「0.30 核心升级完成」判据（否 ≠ 可不跟踪）。

| 清单 ID | 优先级 | 标题 | REQ | 闸 / 轨 | 核心分母 | 跟进状态 | Spec／Plan |
|---|---|---|---|---|---|---|---|
| **P0-1** | P0 | 问题类型 → 唯一表 + 固定口径绑定 | REQ-030-027 | 约束 | 是 | **v0.9；R2-F＋R3＋R4 已闭合；功能合同已收口（2026-11-13）**。SC-01–SC-30 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) · [Plan](lucy-20261107-question-type-caliber-binding-plan.md) · [评审](../reviews/2026-11-07-question-type-caliber-binding-codex-review.md) · [CR](../reviews/2026-11-08-p0-1-caliber-binding-code-review.md) · [证据审计](../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-CALIBER-BINDING`](../qa/uat/suites/question-type-caliber-binding/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| **P0-2** | P0 | Catalog 业务语义暴露 | REQ-030-023 | 约束 | 是 | **v0.6；R2-F＋R3（O1–O3）＋R4 已闭合；功能合同已收口（2026-11-13）**。SC-01–SC-17 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) · [Plan](lucy-20261107-catalog-business-semantics-plan.md) · [评审](../reviews/2026-11-08-catalog-business-semantics-codex-review.md) · [CR](../reviews/2026-11-13-p0-2-catalog-business-semantics-code-review.md) · [证据审计](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-CATALOG-SEMANTICS`](../qa/uat/suites/catalog-business-semantics/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-3** | P0 | 多表命中先问 + 表级歧义门闩 | REQ-030-024 | 约束 | 是 | **v0.5；R2-F＋R3（O1／O2／O4）＋R4 已闭合；功能合同已收口（2026-11-13）**。SC-01–SC-26 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) · [Plan](lucy-20261107-source-ambiguity-gate-plan.md) · [Codex 评审](../reviews/2026-11-08-source-ambiguity-gate-codex-review.md) · [实现复审／独立复验](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md) · [证据审计](../reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-SOURCE-AMBIGUITY`](../qa/uat/suites/source-ambiguity-gate/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-4** | P0 | 答复可核对块（来源／口径／截止期强制露出） | REQ-030-022 | 呈现 | 是 | **v0.4；R2-F＋R3＋R4 已闭合；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。vitest `answer-verifiability` 26/26。O1＝A／O2＝A。**本条收口不表示可上线** | [Spec](../specs/lucy-20261107-answer-verifiability-spec.md) · [Plan](lucy-20261107-answer-verifiability-plan.md) · [Codex 评审](../reviews/2026-11-09-answer-verifiability-codex-review.md) · [实现 CR](../reviews/2026-11-13-p0-4-answer-verifiability-code-review.md) · **测试台** [`UAT-SUITE-ANSWER-VERIFIABILITY`](../qa/uat/suites/answer-verifiability/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-5** | P0 | 空结果结构化下一步指导 | REQ-030-018 | 呈现 | 是 | **v0.8；R2-F＋R4 已闭合；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。vitest 空结果 33/33。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) · [Plan](lucy-20261107-empty-result-next-step-guidance-plan.md) · [Codex 评审](../reviews/2026-11-09-empty-result-next-step-codex-review.md) · [实现 CR](../reviews/2026-11-13-p0-5-empty-result-next-step-code-review.md) · [证据审计](../reviews/2026-11-13-empty-result-next-step-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-EMPTY-NEXT-STEP`](../qa/uat/suites/empty-result-next-step/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-6** | P0 | Eval 选表正确性 + 真实问句日跑骨架（含 019／020 **最小面**） | REQ-030-025；最小面挂 019／020 | 检出 | 是 | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O3 已闭合（2026-11-13）＝建议包 S；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口** | [Spec](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) · [Plan](lucy-20261107-eval-source-selection-correctness-plan.md) · [决策纸](../reviews/2026-11-13-p0-6-o1-o3-decision-package.md)；另 [019 Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)／[019 Plan](lucy-20261107-eval-tool-assertion-authoring-plan.md)／[020 Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)／[020 Plan](lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| **P0-7** | P0 | 存量用户体感最小仪表盘 + 主动告警 | REQ-030-026 | 运营 | 是 | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口** | [Spec](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) · [Plan](lucy-20261107-stored-user-experience-dashboard-alerts-plan.md) · [决策纸](../reviews/2026-11-13-p0-7-o1-o6-decision-package.md) |
| **P0-A** | P0 伴生 | Source 级业务字段暴露裁剪 | REQ-030-012 | 约束伴生 | 是 | **v0.7；R2-F＋R4 已闭合；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。SC-01–SC-30 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) · [Plan](lucy-20261107-semantic-source-field-exposure-plan.md) · [评审](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md) · [CR](../reviews/2026-11-13-p0-a-semantic-source-field-exposure-code-review.md) · [证据审计](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-FIELD-EXPOSURE`](../qa/uat/suites/semantic-source-field-exposure/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| **P0-B** | P0 伴生 | 物理新鲜度合同（答复截止期真源） | REQ-030-028 | 呈现伴生 | 是 | **v0.1-draft；O1–O3 已闭合（2026-11-13）＝建议包 F；待 R2-F；终稿未确权；冻结落地；未授权实现**。不改 P0-4 已冻结的 `not_checked`。**不是** R2-F，**不是** R4，**不可功能合同收口** | [Spec](../specs/lucy-20261109-physical-freshness-contract-spec.md) · [Plan](lucy-20261109-physical-freshness-contract-plan.md) · [决策纸](../reviews/2026-11-13-p0-b-o1-o3-decision-package.md) · [过程记录](../reviews/2026-11-09-p0-6-p0-7-p0-b-spec-advance.md) |
| P1-1 | P1 | 语义层孤儿路径治理 | REQ-030-015 | 约束深化 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；**不挡 P0** | [Spec](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md) · [Plan](lucy-20261107-semantic-orphan-path-governance-plan.md) |
| P1-2 | P1 | 行权限编译门禁 + 各面拒绝码统一 | REQ-030-013／016 | 正确性辅线 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；可与 P0 并行 | [Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) · [Plan](lucy-20261107-row-policy-compile-gate-deny-code-plan.md) |
| P1-3 | P1 | `lucy_explain_query` 诊断形状合同 | REQ-030-017 | 正确性辅线 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地 | [Spec](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md) · [Plan](lucy-20261107-explain-diagnostic-shape-contract-plan.md) |
| P1-4 | P1 | Eval 路径断言编排（完整 WebUI 面） | REQ-030-019 | 检出完整面 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；P0-6 只用最小面 | [Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) · [Plan](lucy-20261107-eval-tool-assertion-authoring-plan.md) |
| P1-5 | P1 | 审计旅程 → Eval 草稿（完整回流） | REQ-030-020 | 检出完整面 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；P0-6 只用最小面 | [Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) · [Plan](lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| P1-6 | P1 | 失败 → 工具面／Skill 反哺队列 | REQ-030-021 | 运营深化 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；**P0 不做自动改工具面** | [Spec](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md) · [Plan](lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md) |
| P1-7 | P1 | 行权限模板展开保留 templateRefs | REQ-030-014 | 正确性辅线 | 否 | 遗留验收排期；须 PM 批准重开已收口 Spec | [遗留验收 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| P1-8 | P1 | 语义发布 → Eval 门禁（发布后必跑／失败阻断或告警） | REQ-030-029 | 检出闸强化 | 否 | **2026-11-08 入池**；待需求澄清与立项开 Spec；**未授权实现**；**不挡**原 P0；依赖 P0-6 日跑／发布跑骨架 | 未开（前身思路见 [2026-08-26 闭环 Plan](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)） |
| P1-9 | P1 | 质量域 safe-log → Eval 候选回流 | REQ-030-030 | 检出／运营 | 否 | **2026-11-08 入池**；挂接既有质量域 Spec（未落地）；待澄清与 0.30 跟进对齐；**未授权实现**；与 P1-5／P1-6 并列质量轴 | 既有 [safe-log-to-quality-eval Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md)（功能合同未收口）· [WO](wo-20261014-safe-log-to-quality-eval.md) |
| P1-10 | P1 | 轻量概念注册表（ontology-lite；上游合同） | REQ-030-031 | 约束深化／内容治理 | 否 | **委托人结案（2026-11-13）**：本分支不做 CLI／WebUI／效果门跟进；交付只走 **P1-11 Ops MCP**；保留上游数据／语义合同。**不挡**原 P0。本条不表示可上线 | [Spec](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md) · [Plan](lucy-20261108-concept-registry-ontology-lite-plan.md) · [评审](../reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md) |
| P1-11 | P1 | 概念注册表接入 Lucy Ops 控制面 | REQ-030-032 | 配置运维／控制面 | 否 | **v0.5；功能合同层已收口（SC-01–SC-22）；实现 CR 已落盘（PASS，2026-11-13）**。vitest `ops-concepts` 20/20＋`concepts:test` 29/29。**本分支概念注册表唯一产品交付面＝Ops MCP**（P1-10 CLI／WebUI 已结案不做）；本版 Ops／下版 WebUI（D2b）；**不挡**原 P0。本条不表示可上线 | [Spec](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md) · [Plan](lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md) · [Codex 评审](../reviews/2026-11-09-concept-registry-lucy-ops-control-plane-codex-review.md) · [实现 CR](../reviews/2026-11-13-p1-11-concept-registry-ops-code-review.md) |
| P1-12 | P1 | 问询预算默认阈值放宽（60 次／300s） | REQ-030-033 | 体验修调 | 否 | **v1.0；委托人批准方案二并已实现（2026-11-11，本分支）；实现 CR 已落盘（PASS，2026-11-13）**。vitest question-budget 三文件 44/44；续查仍 1 次；**不挡**原 P0；≠ 可上线／客户交付 | [Spec](../specs/lucy-20261111-question-budget-threshold-relax-spec.md) · [实现 CR](../reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md) |
| P1-13 | P1 | 发版性能基线与相对不回退（WebUI＋MCP；含 Roles 列表债） | REQ-030-034 | 发布取证／harness | 否 | **v0.2；R2-F＋R4；发布取证出口证据齐（SC-01–SC-16；2026-11-13）；书面登记「发布取证 acceptance 代替实现 CR」**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) · [Plan](lucy-20261113-release-perf-baseline-gate-plan.md) · [acceptance](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md) · [W1-4 A](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md) · **测试台** [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| P1-14 | P1 | 问询预算复盘审计字段（交付面 A） | REQ-030-035 | 运营复盘／可观测 | 否 | **v1.0；R2-F＋R4；实现已落地（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。vitest retrospective **11/11**；`budgetSnapshot`＋`calls.csv` 表尾；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md) · [Plan](lucy-20261113-question-budget-retrospective-audit-plan.md) · [实现 CR](../reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md) |
| P1-15 | P1 | 连接写路径 → 执行层热重载 + 成功面诚实 ack | REQ-030-036 | 连接／WebUI | 否 | **已落地（2026-11-13）**：create＋C01＋live E2E／UAT-01；Edit 成功面三段事实 CLOSED。**不挡**原 P0；≠ 可上线 | [Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md) · [父 Plan](lucy-20261112-connection-create-execution-runtime-reload-plan.md) · [B 轨](lucy-20261113-connection-reload-live-e2e-uat-plan.md) · [middev 收口](../reviews/2026-11-13-connection-reload-middev-closure.md) · **测试台** [`UAT-SUITE-CONN-RELOAD`](../qa/uat/suites/connection-runtime-reload/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| P1-16 | P1 | 库内扫表读法（Doris 外部目录 Hive + 普通 MySQL） | REQ-030-037 | 连接／事故修复 | 否 | **功能合同已收口（2026-11-13）**；SC-01–SC-14。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) · [Plan](lucy-20261111-catalog-scan-read-path-plan.md) · [证据审计](../reviews/2026-11-13-catalog-scan-read-path-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| P1-17 | P1 | 访问关系图空桑基修复 | REQ-030-038 | WebUI 修复 | 否 | **CLOSED（2026-11-13）** 中间态出口。**不挡**原 P0；≠ 可上线 | [closure](../reviews/2026-11-13-access-map-sankey-empty-fix-closure.md) · [Plan](lucy-20261113-access-map-sankey-empty-fix-plan.md) |
| P1-18 | P1 | MCP 客户端 Skill 入口镜像（改挂 `/mcp`） | REQ-030-039 | 工程／接入 | 否 | **CLOSED（2026-11-13）** 中间态出口；工程向。**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) · [Plan](lucy-20261111-mcp-client-skill-endpoint-fix-plan.md) · [closure](../reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md) |
| P1-19 | P1 | 访问关系图允许词表对齐（`ok`／`allow`） | REQ-030-040 | WebUI 修复 | 否 | **实现已落地（2026-11-13）**。vitest access-map 三文件 **76/76**。UAT 未复跑。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) |
| P1-20 | P1 | 外部目录单表读字段（直连 DESC／SHOW COLUMNS） | REQ-030-041 | 连接／事故续作 | 否 | **开发授权已获得（2026-11-13，委托人同句「批准修复」）；实现已落地（2026-11-13）**。根因＝KTX 只读校验禁止 `DESC`。vitest 5 文件 76/76；客户 live 未验，UAT 未复跑。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-external-catalog-column-read-spec.md) · [Plan](lucy-20261113-external-catalog-column-read-plan.md) |
| P1-21 | P1 | 重读路径与探针减负（访问日志后台重建＋健康探针拆分） | REQ-030-042 | WebUI 稳定性／事故修复 | 否 | **功能合同已收口（2026-11-13）**。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（必做 R0／01–04；可选 LOOP-05 BLOCKED——客户 0.25 无 livez）。≠ 可上线 | [Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) · [Plan](lucy-20261113-heavy-read-path-and-probe-relief-plan.md) · [性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md) · **测试台** [`UAT-SUITE-EVENT-LOOP-RELIEF`](../qa/uat/suites/event-loop-relief/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)；跑次 [2026-11-13-cursor-demo-event-loop](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)） |
| P1-22 | P1 | Doris／SelectDB 多版本对比环境（2.0.14 基线 vs 4.0.8；高频分析路径回归＋版本探测） | REQ-030-043 | 连接／发布取证 | 否 | **入池（2026-11-14）**。委托人同句「我决定以你为准，构建长期测试对比环境」＝立项＋测试环境搭建授权；范围**仅**对比环境、版本探测与证据，**不含**适配代码改动（改代码须另行终稿确权＋开发授权）。行权限在 Doris 上的专项验证暂缓（客户未启用）；客户 SelectDB 版本串暂缺。Spec／Plan 待补；UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | 待补（与 P2-5 `升级候选验证环境` 相邻但对象不同：本条是数据库引擎版本，P2-5 是 Lucy 升级候选） |
| P1-23 | P1 | UI/UX 标准收敛并与 DEVELOPMENT 绑定（设计系统 `webui/docs/design-system/` 清账、补缺章、DEVELOPMENT 总入口表） | REQ-030-044 | 文档治理 | 否 | **入池（2026-11-14）**。委托人批准：只读核对（已出报告）＋登记＋清理 `99-governance.md` 临时决策。**范围仅文档**；补缺章、改 DEVELOPMENT 总入口、新增 lint 门禁须各自另获委托人确认；不含运行代码。UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [核对报告](../../inbox/20261114-0130-uiux-standard-audit.md)（临时文件，定稿后迁入 `docs/reviews/`） |
| P1-24 | P1 | WebUI 存量 UI/UX 整改（逐页；UXR-01–09，批次 B1–B4） | REQ-030-045 | WebUI 整改 | 否 | **入池／立项（2026-11-14），Spec／Plan v0.2-draft（已含浏览器盘点）待委托人确认范围、批次与 D-1–D-4**。**不含开发授权，本阶段只做优化方案**：各批改运行代码须各自入子 Plan、终稿确权、委托人另发开发授权。UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261114-webui-uiux-remediation-spec.md) |
| P1-25 | P1 | 行权限能力评审（100 用户／30–40 人行级受限目标） | REQ-030-046 | 评审／正确性辅线 | 否 | **评审报告 v1.0 已出（2026-11-14），待委托人裁决**。结论：安全内核实测成立；默认部署不可用（proven 全局开关）、BY-01／BY-18 回归为红、取值无校验、受限用户工具面缩水，提出 P0 四项建议。**仅评审，不含开发授权**；不改 P1-2／P1-7 及已收口 Spec 状态。UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [评审报告](../reviews/2026-11-14-row-policy-capability-assessment.md) |
| P2-1 | P2 辅线 | 发布工作台分文件勾选发布 | REQ-030-001 | UX 辅线 | 否 | 草案齐；批次 R1 已修订；**终稿未确权**；**不定义 0.30 成败** | [Spec](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md) · [Plan](lucy-20261107-publish-workbench-per-file-selection-plan.md) |
| P2-2 | P2 辅线 | 帮助中心体验 | REQ-030-002 | UX 辅线 | 否 | Deferred／开线对齐既有 Spec | 既有 Spec |
| P2-3 | P2 辅线 | 运维控制面 W-B（语义发布） | REQ-030-004 | 运维辅线 | 否 | Deferred；阻塞条件见既有 Spec | 既有 Spec |
| P2-4 | P2 取证 | 客户升级 E2E 自动化 | REQ-030-005 | 发布取证 | 否 | Deferred；不进产品闭口分母 | 既有 Spec |
| P2-5 | P2 取证 | 升级候选验证环境 | REQ-030-006 | 发布取证 | 否 | Deferred；不进产品闭口分母 | 既有 Spec |
| P2-6 | P2 工程 | E2E 主线与旁线优化 | REQ-030-007 | harness | 否 | Deferred；工程向 | 既有 Spec |
| P2-7 | P2 验收 | 访问关系图 Spec 187 验收矩阵 | REQ-030-008 | 遗留验收 | 否 | 已排期遗留验收 Plan | [遗留验收 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| P2-8 | P2 验收 | OIDC 功能合同验收 | REQ-030-009 | 遗留验收 | 否 | 已排期遗留验收 Plan | 同上 |
| P2-9 | P2 验收 | 语义整批恢复 SRR 验收 | REQ-030-010 | 遗留验收 | 否 | 已排期遗留验收 Plan | 同上 |
| P2-10 | P2 验收 | 运维控制面 W-A VOPS 验收 | REQ-030-011 | 遗留验收 | 否 | 已排期遗留验收 Plan | 同上 |
| — | 已收口 | 访问关系图与访问日志口径对齐 | REQ-030-003 | — | 否 | **功能合同已收口**（2026-11-04）；不表示可上线 | 既有 Spec |

---

## 4. P0 功能说明（跟进用摘要）

> 缺口细节、证据与非目标以需求池对应 REQ 正文为准；此处只锁**出口与边界**，避免 agent 扩 scope。

### P0-1｜口径绑定（REQ-030-027）

- **出口**：问题类型（或等价业务键）可绑定唯一 source + 固定口径；运行时偏离 → 拒绝或强制澄清。
- **决策**：O1／O2 已闭合；R4 已授予（2026-11-08；Claude Code 实现）。
- **跟进**：Spec／Plan **v0.9**；**功能合同已收口（2026-11-13）**；SC-01–SC-30 证据关闭（见 [证据审计](../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md)）。≠ 可上线。
- **不做**：用更长 instructions 代替绑定；把 ACL 改成语义裁判。

### P0-2｜Catalog 语义暴露（REQ-030-023）

- **出口**：`lucy_catalog` 可见表携带业务描述（及仓内已有同义词／粒度／适用域类资产）；按业务相关排序优于纯字母序。
- **跟进**：Spec／Plan **v0.6**；R2-F＋R3＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-01–SC-17 证据关闭（见 [证据审计](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md)）。首期排序仍为字母序（D7）。≠ 可上线。
- **不做**：把 catalog 做成自由文本搜索引擎；泄露不可见 source 的描述（须按可见性裁剪）。

### P0-3｜表级歧义门闩（REQ-030-024）

- **出口**：多表命中不得静默成交；限定名错表也能拦。
- **跟进**：Spec／Plan **v0.5**；R2-F＋R3＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-01–SC-26 证据关闭（见 [证据审计](../reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md)）。残余 SUGGEST ASK_FIRST 双写不挡收口。本条收口不表示可上线。
- **不做**：只改 instructions、不加运行时门禁。

### P0-4｜答复可核对（REQ-030-022）

- **出口**：纳入路径成功 `lucy_query` 强制带 `answer_verifiability`（来源／口径／截止期披露）；首期截止期诚实 `not_checked`（物理真源见 P0-B）。
- **跟进**：Spec／Plan **v0.4**；R2-F＋R3＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-16／17／21／22 夹具证据已补全。O1＝A／O2＝A。截止期真源见 P0-B（v0.1-draft，未授权，不得回写本条 cutoff）。本条收口不表示可上线。
- **不做**：重造 provenance 同义结构；静默成功无块；未授权前接真实 freshness；默认不做 WebUI 核对页（O1）。

### P0-5｜空结果下一步（REQ-030-018）

- **出口**：`lucy_query` 严格 0 行 → 结构化 `next_step`（已存在承载位一致；模型可读 MCP content）。
- **跟进**：Spec／Plan **v0.8**；R2-F＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-01–SC-30 证据关闭。D1＝结构化、D2＝只提示不阻断、**D3＝A**；与 P0-4 共存合同已齐。本条收口不表示可上线。

### P0-6｜Eval 选表可测 + 日跑骨架（REQ-030-025 + 019／020 最小面）

- **出口**：① 禁金标表名喂 prompt；② 必选／禁选表断言可用；③ 五域骨架可日更；④ 可日跑或发布后跑。
- **跟进**：Spec／Plan **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O3 已闭合（2026-11-13）＝建议包 S；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口**。`review_status: needs_review` 不进 smoke；`trigger=publish_smoke` 已冻结。
- **最小面**：能编排路径断言、能从审计旅程导出草稿即够 P0；完整 WebUI 体验归 P1-4／P1-5。
- **不做**：把 Eval 当自动修复器；P0 不要求 021 自动改工具面。

### P0-7｜体感 + 告警（REQ-030-026）

- **出口**：最小仪表盘（首次成功率／空结果率／关键失败率等）+ 跌破阈值主动告警（复用既有通知通道）。
- **跟进**：Spec／Plan **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口**。空窗不得写成 0；读取接口不得入队；R2-F 前仍不实现。
- **不做**：一次性建成完整运营中台或用户反馈社交产品。

### P0-A｜字段暴露裁剪（REQ-030-012）

- **出口**：Catalog 与 Query 双面裁剪，未暴露列点名 fail-closed（以已立 Spec 为准）。
- **跟进**：Spec／Plan **v0.7**；**功能合同已收口（2026-11-13）**；SC-01–SC-30 证据关闭（见 [证据审计](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md)）。≠ 可上线。
- **关系**：与 P0-2 同波次优先；不得阻塞 P0-1／P0-3 开 Spec。

### P0-B｜物理新鲜度合同（REQ-030-028）

- **出口**：`lucy_query`／可核对块的「数据截止期」有可声明的物理（或等价业务）新鲜度真源；禁止长期以语义文件 mtime 冒充业务截止期而不登记。
- **跟进**：Spec／Plan **v0.1-draft；O1–O3 已闭合（2026-11-13）＝建议包 F；待 R2-F；终稿未确权；冻结落地；未授权实现**。不改 P0-4 已冻结的 `cutoff.status=not_checked`（D8／SC-08）。**不是** R2-F，**不是** R4，**不可功能合同收口**。
- **关系**：呈现闸伴生，强化 P0-4。
- **不做**：不要求一次建成全库 CDC；允许按 connection／source 声明「未配置」并 fail-visible。

### P1-8｜语义发布 → Eval 门禁（REQ-030-029）

- **出口**：语义发布／reindex 成功后，对约定 suite 触发跑批；失败可阻断晋升或至少强制告警（策略待澄清）。
- **关系**：检出闸强化；依赖 P0-6 骨架；**不挡**原 P0 收口。
- **不做**：不把 Eval 当自动修复器；不替代 P0-1／P0-3 运行时约束。

### P1-9｜质量域 safe-log → Eval（REQ-030-030）

- **出口**：质量误报（错表／错口径等）可从安全日志范式进入质量候选池，经人工补全 `executable` 后晋升可跑用例。
- **关系**：与 P1-5（旅程草稿）／P1-6（工具面反哺）并列；挂接既有 2026-10-14 Spec（尚未落地）。
- **不做**：不从日志自动推导 ground truth；不重开安全域出口。

### P1-10｜轻量概念注册表（REQ-030-031）

- **出口（结案后）**：**本分支无独立交付出口**；保留 Concept／Binding／纯计算上游合同，供 P1-11 复用。
- **关系**：约束闸／内容治理辅线上游；可反哺 P0-1／P0-2／P0-3，**不替代**它们。**不挡**原 P0 收口。
- **结案（2026-11-13）**：本分支明确**不做** CLI／WebUI／效果门跟进；产品交付只走 **P1-11 Ops MCP**。
- **不做**：本分支 CLI 产品面；本分支 WebUI；形式化知识图谱／OWL；独立指标计算平台；机器自动裁定权威。

### P1-11｜概念注册表接入 Lucy Ops（REQ-030-032）

- **出口**：运维经 `lucy_ops_concept_*` 完成概念 scan／人审写；`allow.ops`＋审计；**本分支唯一**概念注册表产品交付面。
- **关系**：P1-10 数据／语义上游；L25-16 控制面通道；用户模型＝**配置治理**（≠ 问数）。**不挡**原 P0；**不依赖** W-B。
- **交付序**：R2-F→R3→R4 → **本版 Ops 检查完毕** → **下一产品版本再评估 WebUI**（D2b）。P1-10 CLI／效果门已结案不做。
- **决策**：R2-F／O1＝A／O2＝B／R4 已闭合；**功能合同层已收口（SC-01–SC-22）；实现 CR 已落盘（PASS，2026-11-13）**；≠ 可上线。
- **不做（本条）**：本版 WebUI 概念页；问数热路径自动注入；并进 `lucy_ops_reader`；机器自动升权威；不以 P1-10 CLI 作客户交付。

### P1-12｜问询预算默认阈值放宽（REQ-030-033）

- **出口**：单问默认额度 **60 次数据工具** 或 **300s 已结算忙时**（先到为准）；续查仍 1 次；settled／并发 4／ABS 120s 不变。
- **关系**：修订 Spec 162 §7.2 默认数字；防火墙语义保留。面向高频分析用户体验；**不挡**原 P0。
- **决策**：2026-11-11 委托人选方案二并批准实现；本分支已落地（`2032e970`）；**实现 CR 已落盘（PASS，2026-11-13）**。
- **不做**：不增续查档数；不做按角色配额；不改 Eval tool-budget。

### P1-13｜发版性能基线与相对不回退（REQ-030-034）

- **出口**：`perf:release-baseline`（Roles／MCP／相对 D6）；发版列车 P4-9 勾选；`formal/LATEST` 可被下一候选引用。
- **关系**：扩展 Spec 174，不替代；Wave 0 清 Roles／Agent 列表债。
- **决策**：2026-11-13 委托人明示 R2-F＋R4；Wave 0–2 已实现；**发布取证出口证据齐（SC-01–SC-16）**；landed W1-4 **路径 A**——[acceptance 代替实现 CR](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md)（**非**实现 CR PASS）。
- **不做**：不宣称可上线；不以客户机手点代替基线。

### P1-15｜连接热重载 + 成功面诚实 ack（REQ-030-036）

- **出口**：新建／编辑连接后，有 supervisor 时写路径走执行层重载；UI／API 诚实回报 `executionRuntimeAck`（及失败可观测面）。
- **关系**：**不入核心分母**；WebUI／连接体验高优先；挂 Spec 191 续作。
- **跟进**：create＋C01＋live E2E／UAT-01；Edit 三段事实 CLOSED（2026-11-13）。UAT-CONN-RELOAD-02 可选未纳入。

### P1-16｜库内扫表读法（REQ-030-037）

- **出口**：Doris／SelectDB 外部目录（`catalog.database`／Hive 类连接）列库／列表走直连 `SHOW`；普通 MySQL 准备表结构一次读完 `information_schema.columns`。
- **关系**：**不入核心分母**（事故修复）；**不挡**原 P0；直接影响连接配置用户。
- **跟进**：功能合同已收口（2026-11-13）；SC-01–SC-14。字段侧续作见 **P1-20**。

### P1-20｜外部目录单表读字段（REQ-030-041）

- **出口**：外部目录准备表结构**选中单表**时，字段经直连 `DESC` → `SHOW COLUMNS` → `DESCRIBE` 读出；不再经 `ktx sql`。
- **关系**：**不入核心分母**（P1-16 续作）；**不挡**原 P0。
- **跟进**：开发授权已获得（2026-11-13，委托人同句「批准修复」）；实现已落地（2026-11-13）；EC-01–EC-13；客户 live 未验，UAT 未复跑。

### P1-21｜重读路径与探针减负（REQ-030-042）

- **出口**：推断问询重建、审计投影追赶移到后台分片；问询补充字段批量查询；`/api/diff` 一次扫描；探针拆 `/api/livez`／`/api/readyz`，Chart 默认改挂。客户规模下 `/turns?hours=168` p95 ≤ 3s、`/api/livez` max ≤ 1s、概览 BUSY＝0；接口返回与改前一致。
- **关系**：**不入核心分母**（事故修复，客户实例 0.25.0 即存在，非 0.30 回归）；**不挡**原 P0。
- **跟进**：功能合同已收口（2026-11-13）。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（必做 R0／01–04；可选 LOOP-05 BLOCKED——客户 0.25 无 livez）。≠ 可上线。现场临时缓解见 Spec §8。持续看守见该套件。

### P1-19｜访问关系图允许词表（REQ-030-040）

- **出口**：成功调用 `outcome=ok` 进入访问路径；历史 `allow` 仍进入；拒绝／错误／预算停止不进。
- **关系**：**不入核心分母**；不改空桑基几何；不回填历史 audit。
- **授权**：委托人 2026-11-13「立项修一下」。

### P1-17｜访问关系图空桑基（REQ-030-038）／P1-18｜MCP Skill 入口（REQ-030-039）

- **出口**：空桑基不再误判故障；Skill 入口改挂主面 `/mcp`。
- **关系**：中间态 CLOSED；**不入核心分母**；P1-18 工程向。

---

## 5. P0 收口检查清单（版本主线／核心分母）

全部勾上才允许称「0.30 核心主线功能合同层完成」（仍 ≠ 可上线）。**不入核心分母的总账行（如 P1-15…18）不在此勾选。**

- [x] P0-1 Spec 收口且行为断言通过（功能合同已收口 2026-11-13；≠ 可上线）
- [x] P0-2 Spec 收口且 catalog 契约通过（功能合同已收口 2026-11-13；≠ 可上线）
- [x] P0-3 Spec 收口且门闩断言通过（功能合同已收口 2026-11-13；≠ 可上线）
- [x] P0-4 Spec 收口且可核对块合同通过（功能合同已收口 2026-11-13；实现 CR PASS；宿主 UI 强制渲染仍按 O1＝不做；≠ 可上线）
- [x] P0-5 Spec 收口且 0 行 next_step 通过（功能合同已收口 2026-11-13；实现 CR PASS；≠ 可上线）
- [ ] P0-6 Spec 收口：选表可测 + 五域骨架 + 日跑／发布跑通路
- [ ] P0-7 Spec 收口：仪表盘最小集 + 告警通路
- [x] P0-A Spec 收口（功能合同已收口 2026-11-13；实现 CR PASS；≠ 可上线）
- [ ] P0-B Spec 收口或发布说明显式登记「物理新鲜度缺口」（伴生；待 R2-F；未授权实现）

---

## 6. 与其他文档的指针

| 文档 | 关系 |
|---|---|
| [核心方向](lucy-20261107-lucy-0-30-core-direction.md) | 为什么；主线／辅线；四闸 |
| [需求池](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) | REQ 正文、来源、澄清记录 |
| [误报防线分支计划](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) | 事故因果与 G1–G9 |
| [MCP next-step 分支计划](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) | 018–021 差距对拍 |
| [遗留验收执行 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) | P2 验收类排期 |
| [Eval 闭环与变更触发回归（前身）](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md) | P1-8 相关前身思路 |
| [Safe-log→质量 Eval Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md) | P1-9 既有 Spec（未落地） |
| [概念注册表 Spec](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md) · [Plan](lucy-20261108-concept-registry-ontology-lite-plan.md) | P1-10／REQ-030-031（**委托人结案 2026-11-13**：本分支不做 CLI／WebUI；交付只走 P1-11） |
| [概念→Ops Spec](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md) · [Plan](lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md) | P1-11／REQ-030-032（**功能合同层已收口；实现 CR PASS；≠ 可上线**） |
| [问询预算阈值放宽 Spec](../specs/lucy-20261111-question-budget-threshold-relax-spec.md) · [实现 CR](../reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md) | P1-12／REQ-030-033（**已实现；实现 CR PASS；≠ 可上线**） |
| [发版性能基线 Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) · [Plan](lucy-20261113-release-perf-baseline-gate-plan.md) · [W1-4 A](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md) | P1-13／REQ-030-034（**发布取证出口证据齐；acceptance 代替实现 CR；≠ 可上线**） |
| [问询预算复盘审计 Spec](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md) · [实现 CR](../reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md) | P1-14／REQ-030-035（**实现 CR PASS；≠ 可上线**） |
| [Spec 191 执行层重载](../../webui/docs/191-execution-runtime-reload-spec.md) · [连接热重载 Plan](lucy-20261112-connection-create-execution-runtime-reload-plan.md) | P1-15／REQ-030-036（**已落地；不入核心分母**） |
| [库内扫表 Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) · [证据审计](../reviews/2026-11-13-catalog-scan-read-path-sc-evidence-audit.md) | P1-16／REQ-030-037（**功能合同已收口；不入核心分母**） |
| [空桑基 closure](../reviews/2026-11-13-access-map-sankey-empty-fix-closure.md) | P1-17／REQ-030-038 |
| [MCP Skill Spec](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) · [closure](../reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md) | P1-18／REQ-030-039 |
| [重读路径减负 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) · [Plan](lucy-20261113-heavy-read-path-and-probe-relief-plan.md) · [性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md) · [UAT](../qa/uat/suites/event-loop-relief/suite.md) | P1-21／REQ-030-042（**功能合同已收口；测试台必做 PASS，可选 LOOP-05 BLOCKED；不入核心分母**） |
| [`DEVELOPMENT.md` 产品线执行总账（SOT）](../governance/DEVELOPMENT.md) | 仓库级 SOT／差集补录规则正文 |

---

## 7. 本池自身验收

- 本文件是 `0.30` **执行总账 SOT**（见 DEVELOPMENT）；清单覆盖需求池 REQ-030-001–046（含已收口 003），无孤儿 REQ。
- P0 立项范围与 §2／§3 一致；**P0-B O1–O3 已闭合（建议包 F），待 R2-F**；**P1-8／P1-9 仍待立项**；**P1-10 委托人结案**；**P1-11…14 已落地／收口**；**P1-15…18 差集补录（不入核心分母）**；agent 规则可被本分支会话引用。
- **不构成任何功能验收或上线许可。**
