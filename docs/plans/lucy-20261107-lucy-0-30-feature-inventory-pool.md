# Lucy 0.30 功能清单池

| 元数据 | 内容 |
|---|---|
| 文档类型 | **`0.30.0`／`lucy-v0.30` 产品线执行总账（SOT）**。完整跟踪本产品线新功能、旧功能修复、尚未开发／冻结／结案。不是功能 Spec；**单条仍不构成开发授权** |
| 版本 / 日期 | v2.46 / 2026-11-23 |
| 版本 / 日期 | v2.51 / 2026-11-23 |
| 状态 | **生效跟进**。产品线 `lucy-v0.30` / `0.30.0`。**中间态已出口（2026-11-13）**见 [盘点](../reviews/2026-11-13-025-to-030-midstate-inventory.md)／[执行 Plan](lucy-20261113-midstate-exit-closure-plan.md)。**P0-1…5／A 已收口**；半成品四项 CLOSED；**P0-6／7／B 仍冻结**；**P1-15…18 差集补录**；**端到端三台账**已立（测试台挂 P0-1／2／3／4／5／A＋P1-15／16／13／17）。**可信证据两类拆分已批准**（[split](lucy-20261115-trust-evidence-capability-split.md)）：设计口径吸收进 P0-4／B／5；未开工项进 [post-0.30 TE 池](lucy-20261115-post-030-trust-evidence-requirement-pool.md)，**不入本总账新行**。**财务／销售收入双口径选择**仅为概念，挂 [post-0.30 CAL 概念池](lucy-20261116-post-030-dual-caliber-selection-concept-pool.md)，**不入本总账、不在 0.30 升级**。**P2-2 方案 B／D15 已登记（2026-11-16）**；**P2-2 对标对象已修正、D17 首页形态已裁决、D19／D20 已纳入、D21 MD 标配已登记（2026-11-19，见 v1.54／v1.56／v1.57 行）**。**≠ 可上线；≠ 核心升级完成**。未授权条目禁止改运行代码  **P1-57两处功能阻塞已修复；委托人已延期G6正式完整导出，本轮客户功能测试排除此项，可按限定范围进行。原完整范围FAIL证据保留。** |
| 受众 | 本仓库所有在 `lucy-v0.30` / `0.30` 上工作的人与 agent |
| 授权边界 | **立项 ≠ 改代码**；**写 Spec ≠ 可实现**；**过程对抗 ≠ 终稿确权**；**终稿确权 ≠ 开发授权**；**入池 ≠ 立项**。改代码须：终稿确权 → 委托人 **另发开发授权**。本池不代替 Spec／Plan |
| 事实源分工 | **仓库级 SOT 规则** → [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「产品线执行总账（SOT）」；**方向** → [核心方向](lucy-20261107-lucy-0-30-core-direction.md)；**缺口正文** → [需求池](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；**本文件** → 本产品线工作项全集、优先级、核心分母属性、跟进序 |
| 维护规则 | 只追加或改状态／优先级／分母属性；不得静默删条目。状态变更须写「变更」行。与需求池 REQ ID 双向可追。**「不入核心分母」仍须有行** |

## 变更

| 版本 | 日期 | 内容 |
|---|---|---|
| v2.51 | 2026-11-23 | **入池 P1-79／REQ-030-100＋P1-78 升 v0.3-draft（依赖补登）**：委托人授权补充并登记。新立 P1-79「长追问题组（性能专用）」——独立题组包与独立 `packDigest`，语义继承 P1-54，不改 P1-54 题库与 P1-53 已收口证据；P1-78 的 `LONG_FOLLOW` 改为消费 P1-79。50 路压测身份与持续压力下限登记进[全局规模基线 §1.1 MCP-PERF profile](../qa/uat/scale-baseline.md)（精确向量、Wiki／Skill 实读、`lucy_admin` 运行时绑定），机器断言扩展待测试基建授权。两项实现证据到位前相关用例仍 BLOCKED。终稿未确权，开发未授权，不执行性能跑次。 |
| v2.47 | 2026-11-23 | **P1-78 升 v0.2-draft（来源收敛）**：按委托人要求改为只消费既有 owner——自然问题与 oracle 取自 P1-54 题库 Spec，初始化数据取自全局规模基线（含 `uat:scale-baseline:seed:*`）与 P1-34 表夹具，本条不自制题目、造数脚本或第二套规模数字。新增 `SOAK` 持续压力（50 身份／≥1800 秒／截断正态到达）与 `LONG_FOLLOW` 长追问（≥10% 场景实例／单进程 ≥20 轮）场景及 SC-14／SC-15；依赖缺失一律 BLOCKED。终稿未确权，开发未授权，不执行性能跑次。 |
| v2.46 | 2026-11-23 | **入池 P1-78／REQ-030-099**：新建独立「MCP 问询端到端性能基准与持续门禁」，只做测量、基线、判定、证据和持续门禁，不做产品优化。委托人授权按仓库规范新建 Spec／Plan／UAT 设计；定位 P0 核心体验／发布底线，独立出包／升级门禁，不改变 0.30 既有核心分母。P1-67 的 MCP 部分改由本条承接，P1-53 的已发现性能取证缺口作为设计输入。终稿未确权，开发未授权，不执行性能跑次。 |
| v2.45 | 2026-11-23 | 委托人批准 P1-75／P1-77 合同修订及并行任务落盘。两份 Spec／Plan 升 v1.1，先完成 P1-75 G1／G2，再以通过候选验证 P1-77 的按需指引、整题速度和真实并发上下文负载。见 [并行任务批次](lucy-20261123-interactive-read-resilience-plan.md#并行任务批次)。开发待授权。 |
| v2.44 | 2026-11-23 | **P1-75／REQ-030-096 终稿确权。** 委托人授权优化并进入定稿，Spec／Plan／UAT 设计升 v1.0，阶段 S2。明确纯备注写中的已提交视图、MCP 动态指引降级与合法查数，以及 50 路同窗必做出口。见 [定稿复核](../reviews/2026-11-23-p1-75-interactive-read-resilience-codex-review.md#v10-定稿处理)。开发待授权。 |
| v2.43 | 2026-11-23 | **P1-77／REQ-030-098 终稿确权**：委托人明示「批准定稿 spec」→ Spec **v1.0、阶段 S2**（无 Codex CLI 在场，按委托人明示确权先例）；评审 R1 五项必改＋一项澄清已于 v0.2 处理。**开发未授权**；建议首批开发范围＝SC-01 归因对照实验＋判定器取证重写。 |
| v2.42 | 2026-11-23 | **P1-77／REQ-030-098 Spec → v0.2 草案**：评审 R1（认同方向、五项必改＋一项澄清）逐条处理——根因改「候选根因假设」并新增归因对照实验（同宿主同模型同 MCP 接入、动态与 fallback 分别断言）；C1 改两阶段（已治理口径优先／仅补缺失／冲突不取首个／无通道不降级）；伪代码改按子结论依赖推进＋四态兜底；取证通则（请求／响应／答复关联，检索全文不算读正文）；SC-07 预算与耗时可判定；合同边界收敛为「只承诺 Lucy 下发的指导文本」。评审记录 [R1](../reviews/2026-11-23-p177-spec-review-round1.md)。终稿未确权，开发未授权。 |
| v2.41 | 2026-11-23 | **入池 P1-77／REQ-030-098**：数据问答默认主动采用业务上下文（口径前置核对＋规程引导＋诚实兜底）。实证：用户反馈「默认取语义，不取 skill/wiki，除非提示词要求」＋2026-11-23 双宿主跑次分裂（kscc 复现／kimi 未复现）。委托人指示落盘 Spec 与 UAT；验收挂 `UAT-SUITE-CONTEXT-CONTENT` 默认使用业务上下文组（改前基线已跑：kscc 侧 02/03/04 自然问句 FAIL）。仅登记与起草，不入核心分母。 |
| v2.40 | 2026-11-23 | P1-75／REQ-030-096 草案 v0.2，按全局规模 Docker 已见反例收窄首轮。优先处理备注保存同窗的名册 503，补齐 MCP 分段并按既有并发预算复验。现场规模复跑另按补采进度执行。 |
| v2.48 | 2026-11-23 | **P1-76／REQ-030-097 开发授权（委托人明示）**：Spec／Plan → S3｜v0.1。终稿已确权；开发授权已获得（2026-11-23）；实现进行中。按 Plan 阶段 0–4 实施。 |
| v2.49 | 2026-11-23 | **P1-76／REQ-030-097 实现已落地（S4）**：统一写出口 `webui/server/yaml-safe.ts`＋15 处 `stringify` 调用点替换＋静态门禁 `scripts/lint/yaml-alias-gate.mjs`；存量基线 0 命中、注入样例判 FAIL、webui 类型检查全绿、改动模块定向单测通过、真实 KTX 对照验证（对照组拒读／实验组可读，见 [实现与验收记录](../../reviews/2026-11-23-p176-yaml-alias-implementation-verify.md)）；并行会话在途 P1-75 用例的失败经干净树对照判定归属其实现，非本条回归。待委托人验收；未做功能合同收口；≠ 可上线。 |
| v2.47 | 2026-11-23 | **P1-76／REQ-030-097 终稿确权（委托人明示）**：Spec／Plan → S2｜v0.1。终稿已确权（委托人 2026-11-23 明示）；开发未授权；待开发授权后按 Plan 实施。设计冻结，范围不变（统一写出口＋调用点替换＋静态门禁；不改 KTX、不放宽读取侧）。 |
| v2.39 | 2026-11-23 | **入池 P1-76／REQ-030-097**：合成 manifest 复用列定义经 `yaml.stringify` 产生 >100 别名，KTX（`yaml` 默认 `maxAliasCount=100`）拒读。委托人授权起草 Spec／Plan 待评审。范围＝统一写出口＋调用点替换＋静态门禁；不改 KTX、不放宽读取侧。仅登记与起草，不入核心分母。 |
| v2.38 | 2026-11-23 | **入池 P1-75／REQ-030-096**：现场复现 Agent 名册 `DISPLAY_SNAPSHOT_BUSY`，MCP 握手出现跨客户端长尾。委托人要求先起草 Spec 和 UAT，再在日志齐备后做 Docker 基线模拟和定稿。仅登记与起草，不入核心分母。 |
| v2.37 | 2026-11-22 | **P1-29／REQ-030-050 明确 0.30 不开发、留池作下一期优化**：委托人「放在需求池，下一次迭代在优化」。状态 → `X_DEF｜Deferred；下一期`；缺口与 UAT-ROW-07 预期 FAIL／`GAP-UAT-P1-28-VALUE` 仍开；**不挡** P1-28；无实现 Spec；未授权实现。≠ 可上线。 |
| v2.36 | 2026-11-22 | 依据 [DEVELOPMENT.md「产品侧修复收口」](../governance/DEVELOPMENT.md#产品侧修复收口) 纠正 P1-20／21／39／41 的现行验收和镜像。客户现场项按发布取证或客户交付触发；既有跑次和发布取证判据保留。 |
| v2.35 | 2026-11-22 | **P1-53／REQ-030-074 → X_REL**：四入口全真 PASS＋SC-01–SC-25＋实现 CR；INDEX PASS；GAP-UAT-P1-53 关闭。[收口](../reviews/2026-11-22-p1-53-xrel-closure-record.md)。**≠ 可上线**；不 push。 |
| v2.34 | 2026-11-22 | **P1-53／REQ-030-074 测试台 candidate PASS**：委托人「开跑」；demo `certifyCandidate` 全真 **PASS**（34／34＋三维；[跑次](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md)）；共享 INDEX→**PASS**。未跑 capture／upgrade／ROLLBACK；收口终态仍 `X_REL`（未完结）。**≠ 可上线**；不 push。 |
| v2.33 | 2026-11-22 | **P1-54／REQ-030-075 → S5 严口径收口**：委托人选项 2（03b＝scoped 行隔离成交／P1-72）；ENV Token＋fixture 入容器；JOIN-01／ACL-03a 控制面修正；严口径 candidate **PASS**（零 new deny／零翻转／34／34／三维 PASS；[复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)）；SC＋CR PASS。共享 INDEX **仍 NOT RUN**。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不 push。 |
| v2.32 | 2026-11-22 | **P1-58／59／42／44 → S5 scoped 收口（仅文档）**：委托人勾选 A1（58／59 仅B1）＋B1（42／44 砍 NOT-RUN＋lite Spec）并授权改 Spec／收口。42／44 新建 lite Spec／Plan；纠正「未提交」漂移（实为 `f1436556`／`c1f54f64`）。[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不 push。 |
| v2.31 | 2026-11-22 | **P1-36／37 → S5 scoped 收口（仅文档）**：委托人勾选裁定包推荐默认（F-3=A／F-2=B／TRC=B／U1=A／GAP=B）并授权改 Spec／收口。Spec／Plan → v1.1；[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不 push。 |
| v2.30 | 2026-11-22 | **立刻文档收口候选（仅文档）**：① **P1-50／REQ-030-071 → X_SUP｜被取代（并入 P1-45）**——水位合同已扩注 P1-45 Spec §3.1；P1-45 已 S5；本行不另开独立 Spec／UAT。② **P1-15／REQ-030-036 → S5｜功能合同已收口（漏斗镜像）**——证据＝create＋C01＋live E2E／UAT-01＋Edit 三段事实 CLOSED；测试台 `UAT-SUITE-CONN-RELOAD`＝PASS；收口范围不含可选 UAT-CONN-RELOAD-02。Spec 191／父 Plan／需求池同句。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不 push。 |
| v2.29 | 2026-11-22 | **漏斗降熵 A＋B＋C（委托人选定）**：DEVELOPMENT／P1-73 v1.2 冻结「一条主漏斗＋分叉终态」；总账新增「收口分列」（S5 与 X_REL 禁止混加）；发布取证实施期回 S1–S4（P1-52→S1；P1-53→S4；P1-13 仍 X_REL）。D8／D8b／lint／夹具同步。≠ 可上线；不 push。 |
| v2.28 | 2026-11-22 | **P1-73 v1.1 MIG＋总账阶段一致性 lint（委托人授权）**：0.30 总账主表行补 `CODE｜`；主 Spec／配对 Plan 补／对齐「阶段」；发布取证层强制 `X_REL`；`lint:inventory-stage`＋PR CI；grandfather 移出已迁 Spec。功能合同收口 ≠ UAT PASS ≠ 可上线；不 push。 |
| v2.27 | 2026-11-22 | **P1-73＋P1-35 → S5 收口批＋P1-53／54 镜像纠偏（仅文档）**：[编排 Plan](lucy-20261122-p173-p135-s5-closure-multi-agent-plan.md)。① P1-73／REQ-030-094 → **S5 功能合同已收口**（SC-01–SC-15＋实现 CR PASS；全仓 MIG 另授权）。② P1-35／REQ-030-056 → **S5 功能合同已收口**（SC-E 审计＋实现 CR PASS；ESCAPE INDEX PASS；Nov-17 CR-01／02／03 闭合）。③ P1-53／54 详情跟进与 INDEX／e2e 对齐 Spec：开发已授权；Wave D candidate FAIL；INDEX＝NOT RUN。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不 push。 |
| v2.26 | 2026-11-22 | **S1／S2 漏斗归类纠偏（仅文档）**：委托人批准修复状态一致性。① P1-53／54 总账／`plans/README` 回写 Spec 现值（终稿确权＋**开发已授权**＋实现进行中＝**S3**；纠正总账「开发未授权」漂移）。② P1-51 Spec／Plan／总账／索引显式 **S1｜**（终稿未确权；纠正误标 S2）。③ P1-22 总账／需求池显式 **S1｜**（无 Spec 终稿；环境搭建授权≠S2）。④ P1-42／44 总账／需求池升 **S4｜**（修复已落工作树；测试台 PASS WITH GAP；未提交）。≠ 可上线；不 push。 |
| v2.25 | 2026-11-22 | **S4→S5 并行波次·scoped 收口（仅文档）**：确认默认 1a／2a／3a／4c／5b／6a／7a。[执行 Plan](lucy-20261122-s4-to-s5-parallel-wave-plan.md)。**S5**：P1-74／68／32／33／40／41（各带收口范围）。**4c**：61／62／63／69 缺口清单 → `inbox/20261122-1630-core-availability-f61-f69-min-checklist.md`。**6a**：36／37 裁定包 → `inbox/20261122-1630-p136-p137-decision-pack.md`（未收口）。≠ 可上线；不 push。 |
| v2.24 | 2026-11-22 | **S4→S5 并行波次登记（仅文档／执行闸）**：按确认清单默认 1a／2a／3a／4c／5b／6a／7a 启动。[执行 Plan](lucy-20261122-s4-to-s5-parallel-wave-plan.md)。随后 v2.25 完成 scoped 收口镜像。≠ 可上线；不 push。 |
| v2.23 | 2026-11-22 | **漏斗底端分批收口·批次 1（仅文档）**：P1-12／P1-14／P1-19／P1-27／P1-39／P1-45／P1-46／P1-47 八条 → **S5 功能合同已收口**（收口证据已齐：实现 CR PASS／测试台 PASS；P1-39 的 UAT-COLD-06 客户侧证据 BLOCKED 归发布取证、不在本条出口）。Spec＋配对 Plan＋总账＋README＋需求池镜像同句。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不 push／不发布。 |
| v2.22 | 2026-11-22 | **P1-74 终审闭环修订（仅文档）**：Spec／Plan → **v1.1**，D1–D9 不变；补 active／inactive 硬停分支、new_question 凭证与锁、SC-E9b 持久恢复、audit／turn 归属落点。UAT 设计 v1.0 定为 BESC-R0／01–12 全必做，覆盖真实成交、无 session、legacy 可达、busy／idle、真实 Agent 与同 Token 两次 compat。**开发未授权**；测试台 NOT RUN；≠ 可上线。 |
| v2.21 | 2026-11-22 | **P1-74／REQ-030-095 终稿确权**：委托人批准对抗审阅阻塞项复核建议（1A–6A）并定稿。Spec／Plan → **v1.0**（D7 `mode=new_question`、D8 软信封、D9 compat 成交链、两段式／多窗幂等／参与态快照／reason 分列）。UAT 增 BESC-11／12。**开发未授权**；测试台仍 NOT RUN；不入核心分母；≠ 可上线。 |
| v2.20 | 2026-11-22 | **P1-74 测试台挂套**：委托人要求 UAT 增加预算耗尽场景以看守第一性原理。[`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/suite.md) 已登记 INDEX＝**NOT RUN**（BESC-R0／01–09）；落地前允许 BESC-02／03／09 FAIL 作改前基线。仍终稿未确权、开发未授权；≠ 可上线。 |
| v2.19 | 2026-11-22 | **P1-73 开发授权落地（仅文档；范围限 Spec §8 白名单）**：委托人授予 P1-73／REQ-030-094 开发授权；伞级阶段 **S2→S3**，实现进行中（Wave A `status-vocab` → grandfather → Wave B `status-funnel` → PR CI）。仍 ≠ 功能合同收口；≠ 可上线；阶段全仓迁移另授权。 |
| v2.18 | 2026-11-22 | **入池 P1-74／REQ-030-095（问询预算主路径逃生；仅文档）**：委托人认同「触顶须有 fallback、不得误伤合法长问询」并授权按规范制定方案。新开 [Spec](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md)／[Plan](lucy-20261122-question-budget-mainpath-escape-plan.md) v0.1-draft——保留 60／300 防火墙；begin inactive 时续查加档（默认 5）；分列 budget vs deny；不回退 P1-60。**终稿未确权；开发未授权**；测试台其后挂套见 v2.20；不入核心分母；≠ 可上线。错题 [2026-11-22-question-budget-exhausted-recurring](../lessons/2026-11-22-question-budget-exhausted-recurring.md)。 |
| v2.17 | 2026-11-22 | **P1-73 终稿确权（仅文档）**：委托人批准伞评审反馈并定稿。Spec／Plan／建议书 → **v1.0**；阶段 **S2**；闭合 strip`*`／D4 短语表／D5 否定式／摘 B2 缺状态行／Wave B 必接 PR CI／SC-14＝§8。**未获开发授权；未授权改 lint**；测试台 not_registered；不入核心分母；≠ 可上线。 |
| v2.16 | 2026-11-22 | **P1-73 伞扩展**：委托人确认漏斗与 [状态词中文建议书](lucy-20261122-spec-status-vocabulary-chinese-plan.md) 互补一并审阅；双规则 `status-funnel`＋`status-vocab`；建议书不另开行。Spec／Plan → v0.2-draft；建议书 → v0.4-draft。仍未确权、未授权改 lint。 |
| v2.15 | 2026-11-22 | **入池 P1-73／REQ-030-094（Spec 开发台状态漏斗门禁；仅文档）**：委托人授权按仓库规范设计 Spec／Plan；阶段字典 S1–S5＋X_*；强制面 `lint:spec-docs` 规则草案 `status-funnel`；单 Spec 终态＝合同收口；≠ 系统可上线。[Spec](../specs/lucy-20261122-spec-status-funnel-gate-spec.md)／[Plan](lucy-20261122-spec-status-funnel-gate-plan.md) v0.1-draft。**终稿未确权；未获开发授权；未授权不改 lint；测试台 not_registered；不入核心分母**。 |
| v2.14 | 2026-11-22 | **P1-28／REQ-030-049 测试台 PASS**：解耦口径下复跑 [decouple-retest](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-22-cursor-row-policy-decouple-retest.md)；计入必做全绿；ROW-07 单列 FAIL 归 P1-29。关闭 GAP-UAT-P1-28。≠ 可上线。 |
| v2.13 | 2026-11-22 | **出包前收口（剔出 P1-58／59；不出包）**：干净候选 `prepack-8e3e3f24`／`8e3e3f24`；CAV-01／02 定向 PASS WITH GAP；P1-60 smoke；P1-64 模块等价；须知＋[就绪评审](../reviews/2026-11-22-prepack-readiness-review.md)；编排 [Plan](lucy-20261122-prepack-closure-multi-agent-plan.md)。闭合 11-20「修复未进候选」定向阻断；完整矩阵／出包未做。≠ 可上线；≠ 出包授权。 |
| v2.09 | 2026-11-22 | **P1-71／REQ-030-092 明确不开发并留池作下一期目标**：委托人「本 Spec 不开发，明确移入需求池，作为下一期开发的目标」。状态改为 0.30 不开发；准备材料保留；终稿未确权；未获开发授权；测试台仍 NOT RUN；不入核心分母；≠ 功能合同收口；≠ 可上线。 |
| v2.08 | 2026-11-22 | P1-68／REQ-030-089：委托人批准 commit→平滑 demo:upgrade→UAT-SUITE-OPS-STEP R0／01–08 全真跑次。跑次 PASS WITH GAP（gitSha=88b2e9ea；见测试台跑次）；重度 Linux／16MiB／UID、age_limit 1h、51／52 表、双连接 catalog 仍为设计值 GAP；≠ 功能合同完全收口；≠ 可上线；不 push／不发布。 |
| P1-72完成 | 2026-11-20 | 取消人工证明门槛，统一主路径／内部载体；286＋97自动化与39项真库验证通过，Codex CLI终审收口；扩展回归20项及全仓8条API登记既有缺口单列；未发布。 |
| P1-72授权 | 2026-11-20 | 委托人批准取消行权限人工证明开关并要求落地；REQ-030-093／Spec／Plan v1.0，开发与隔离 Docker 验证已授权；不发布。 |
| v2.07 | 2026-11-20 | 入池 P1-71／REQ-030-092：SQLite 风险防范与 PostgreSQL 迁移准备。委托人明确“暂时不想升级”“对，只做准备”；仅授权源码盘点、风险差集、Spec／Plan 草案与验收设计。禁止实现、运行演练、启动数据库、升级／迁移或操作客户实例；不入核心分母。 |
| v2.06 | 2026-11-20 | P1-68／REQ-030-089 实现落地与独立代码评审：共享写账内核、诊断父子接入、两条保存链、读字段操作号关联、管理读接口与只读页面在工作树落地；两轮独立评审发现的缺陷已修复（stdout 覆盖风险、轮转失败停摆、裁剪拆实例、读模型重复行、非表级错误丢号、Catalog 读失败误记 leave、后台暂停不等空闲、isolated 与生产并发、页面自推状态、读故障未绑定）。未执行 Docker 重建、真实前台浏览器与 UAT；测试台仍 NOT RUN；≠ 功能收口；≠ 可上线。 |
| v2.05 | 2026-11-20 | P1-68／REQ-030-089 运维步骤账：委托人明示“授权你修正，并定稿”，Spec／Plan 升 v1.0 终稿确权；补文件残行隔离、stdout 短写后抑制及 SC-12 stage 禁令。开发未授权；测试台 NOT RUN；≠ 功能收口；≠ 可上线。 |
| P1-58／59分批归档 | 2026-11-20 | 委托人批准暂停长测、分批收敛并commit本进程；本轮实现与必要验证归档，完整功能合同不冒充收口。完整F58／F59、2×／5×及剩余故障矩阵延期第二批，均未计PASS；R未执行；不发布不上线；现值见两Spec与测试台正式首批跑次。 |
| P1-58 D7授权 | 2026-11-20 | 委托人明确“授权纳入两条索引”：既有access_log覆盖索引及监听前初始化迁移纳入P1-58；不新增表／列、不改KTX，预算不变；重冻候选并执行完整F58／F59与前台浏览器UAT，全部出口通过后再收口；不发布上线。具体决策见读取Spec／Plan D7。 |
| v2.03 | 2026-11-20 | 入池 P1-68／REQ-030-089：运维步骤账（Lucy 运维与 IT 运维共用；进入步骤即落标准输出；管理台只读同一操作号）。只授权登记与 Spec／Plan／UAT 设计；终稿未确权；开发未授权；测试台 NOT RUN。 |
| 合并候选复验 | 2026-11-20 | P1-60／P1-64同一30ec4ae0完整验收，功能终审收口；SC-05／10预算持久化锁竞争修复纳入原P1-60；整包有P1-58／59合同缺口及核心可用性修复版本差集，不批准用户更新；[最终评审](../reviews/2026-11-20-p160-p164-combined-final-review.md)；不入新增核心分母；不提交／推送／发布。 |
| v2.02 | 2026-11-20 | 入池 P1-67／REQ-030-088：用户旅程性能门禁（API／WebUI 交互／MCP 问询三维度、CI 接入、gitSha 绑定、部署对账）；承接 KSC 0.25.0 真题与系统性盘点缺口。委托人授权登记与 Spec／Plan 设计；未授权实现或执行。 |
| v2.01 | 2026-11-20 | P1-60／REQ-030-081原四项复核通过，77e2ad84／245项回归；完整R12 PASS／1 FAIL，RC1实际4／100；预算按委托人裁决另行处理；未推送／发布，不作用户更新批准。 |
| v2.04 | 2026-11-20 | P1-66 batch A: user-approved phased closure and local commit; BA-01-07 PASS WITH GAP; original full-matrix FAIL retained; batch B paused; no push or release. |
| v2.00 | 2026-11-20 | P1-66／REQ-030-087：委托人确认 Spec／Plan v0.2 定稿，授权 T1–T7 开发与 Docker 前台浏览器验收，完整覆盖兼容／按需详情／BAL、SKEW 六组；执行中；不提交、推送或发布。 |
| v1.99 | 2026-11-20 | P1-65／REQ-030-086 按委托人授权完成四项验证缺口整改：真实前台浏览器／遗漏子例、严格 MCP、清理及状态一致性；[新跑次](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md) 51 项 PASS，153 份角色检查／306 条工具断言，最终零残留；重新确认功能合同收口；不 commit／push；≠ 可上线。 |
| v1.99 | 2026-11-20 | P1-66／REQ-030-087 严格过程评审修订至 v0.2-draft：同槽 sidecar 与统计版本配对、整旅程轻读、legacy 三模式、详情失效／取消、凭据数防旧统计覆盖、BAL／SKEW 保宽度复制和实时时钟测程。8 项设计发现已修订；终稿未确权、开发未授权、UAT NOT RUN。 |
| v1.98 | 2026-11-20 | 入池 P1-66／REQ-030-087：Agent 名册摘要投影与单对象详情按需读取；承接 109 现场 71 Agent／13,815 capability／4.83 MB 探查。委托人仅授权优化方案、Spec／Plan 和保留权限展开规模的 Docker 浏览器验证设计；未授权实现或执行 UAT。 |
| v1.97 | 2026-11-20 | P1-64 SC-09类型49→0；413＋29回归及最终候选Docker／前台浏览器全套PASS；类型缺口关闭，进入最终评审；不外推整包更新放行。 |
| v1.95 | 2026-11-20 | P1-64／REQ-030-085 R1–R3整改、169＋5回归与Docker／真实前台浏览器复验完成；测试台R0／01–12 PASS；SC-09全库49条基线诊断未关闭，≠ 功能合同收口／可上线。 |
| v1.96 | 2026-11-20 | P1-65／REQ-030-086 GAP 补跑后 Docker UAT＝PASS；功能合同已收口；关闭 GAP-UAT-P1-65；≠ 可上线。 |
| v1.94 | 2026-11-20 | P1-65／REQ-030-086 实现完成＋改后 Docker UAT＝PASS WITH GAP；关闭改后 NOT RUN；GAP-UAT-P1-65 收窄为子例穷尽缺口；≠ 可上线。 |
| v1.92 | 2026-11-20 | P1-65／REQ-030-086 Wiki 覆盖上传 YAML 授权采用：终稿已确权；委托人授权开发实现＋改后 UAT 执行；WebUI 实现完成待 UAT（聚焦 vitest 161 PASS）；Docker 浏览器／MCP 改后 UAT NOT RUN；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| v1.80 | 2026-11-20 | P1-58／59 demo Docker F58-smoke／F59-smoke＝SMOKE_PASS WITH GAP（roster／statistics／5s cache／对象协议＋operationId→committed）；测试台 INDEX／suite／跑次已登记。完整 F58／F59／R／浏览器／2×／5× 造数仍 NOT RUN；≠ 功能收口；≠ 可上线。 |
| v1.91 | 2026-11-20 | P1-60／REQ-030-081 T1–T5 已实现并 commit（Wave A–D；vitest 109 PASS；demo 冒烟隐藏 begin＋`begin_not_available`）；测试台 NOT RUN；T6／R 另授；≠ 功能合同收口；≠ 可上线。 |
| v1.89 | 2026-11-20 | P1-60／REQ-030-081：委托人「确认 spec 可定稿」＝终稿确权；「安排多 agent 并行任务进行落地」＝开发授权 Plan T1–T5；T6 Docker／R／commit／push 另授；实现进行中；测试台 NOT RUN；≠ 功能合同收口；≠ 可上线。 |
| v1.85 | 2026-11-20 | P1-60／REQ-030-081 按新定位复审收缩：Spec／Plan → v0.7-draft，UAT → v0.5-draft；当前仅 N＋隐藏面＋D2 无副作用，复用现有参与事实，继续保留预算／ACL／continue；未来 B／D、事务与 C1／C2 移出本条。终稿未确权、开发未授权；测试台 NOT RUN；≠ 可上线。 |
| v1.84 | 2026-11-20 | P1-60／REQ-030-081：委托人批准 inactive **隐藏** `lucy_begin_question`；预算／ACL 待商议（OQ-4）。Spec／Plan → v0.6-draft，UAT → v0.4-draft；终稿未确权、开发未授权；测试台 NOT RUN；≠ 可上线。 |
| v1.79 | 2026-11-20 | P1-64／REQ-030-085 修复 Spec／Plan v0.1-draft 落盘：新增冲突表确定性避名、有效旧映射保留、最终集合与锁内复核、旧冲突增量修复、Source Map issue 的真实 ack；补全改后 R0／01–09 用例。仅文档，终稿未确权、开发未授权；测试台保留 FAIL，改后复测 NOT RUN。 |
| v1.78 | 2026-11-19 | P1-64／REQ-030-085 独立 Docker 全真复现完成：跨 Schema 扫描生成同名 city，上传／启用表保存接受，MCP 五路径编译拒绝；夹具重命名后同容器恢复。附带确认 runtimeAck=true 与实际拒绝分叉。判定及证据只见测试台 INDEX；修复未授权。 |
| v1.77 | 2026-11-19 | 同构建503设计复核后仅补剩余差集：P1-61／REQ-030-082轻探针诊断隔离、P1-62／083跨类容量、P1-63／084关停排空；已有P1-21／39／45／46／47、Spec174／190、P1-58等不重复立项，组合复用P1-13／52／53。三组Spec／Plan及共享UAT草案，NOT RUN；仅文档、终稿未确权、开发未授权；不入核心分母；≠ 可上线。 |
| v1.78 | 2026-11-20 | P1-60／REQ-030-081 复审修订 Spec／Plan v0.5-draft、UAT v0.3-draft：OQ-1／OQ-2 文档方案闭合，参与代次复用 committed registry generation，预算＋有效归属同事务并补 C1／C2 恢复；OQ-3 数值待采样前冻结。终稿未确权、开发未授权；13 项全部 NOT RUN，≠ 可上线。 |
| v1.76 | 2026-11-19 | P1-60／REQ-030-081 按评审决议修订 Spec／Plan v0.4-draft、UAT v0.2-draft：保留 D6 新问询轮次，补 G1–G6、N／B／D 单一矩阵、画像任务补偿、RC1 与正式控制入口。待复审、未确权、开发未授权；13 项全部 NOT RUN，≠ 可上线。 |
| v1.75 | 2026-11-19 | 入池 P1-64／REQ-030-085：按委托人要求排查同连接跨 Schema 短名冲突并做独立 Docker 全真复现。仅授权代码排查、隔离夹具与复现执行；修复未授权；不入核心分母。测试台新建 UAT-SUITE-SOURCE-SHORTNAME-CONFLICT＝NOT RUN。 |
| v1.74 | 2026-11-19 | P1-58／59 Wave1–3 实现完成；W1／W2／W3 code review 均 APPROVE（inbox 报告）；合并 vitest 通过；未跑 docker／F58／F59／R／浏览器。状态＝实现完成待 F58／F59／浏览器执行授权；≠ 功能收口；≠ UAT PASS；≠ 可上线。 |
| v1.73 | 2026-11-19 | P1-60／REQ-030-081 配对 Spec／Plan v0.3-draft 与独立 UAT-SUITE-BEGIN-ZERO-BINDING 已起草（R0／01–12 全部必做），测试台 NOT RUN；错题核实 11-15 已有 unresolved 记录但覆盖及独立跟进不足。仅文档，终稿未确权、开发未授权；历史结果保留，≠ 可上线。 |
| v1.72 | 2026-11-19 | P1-58／59 开发授权：委托人明示「授权开启执行」。按 inbox 并行任务包 Wave1–3 实现；本轮验证仅 vitest＋code review，禁止 docker／F58／F59／R／浏览器。实现进行中（Wave1）；测试台仍 NOT RUN；不入核心分母；≠ 功能收口；≠ 可上线。 |
| v1.71 | 2026-11-19 | P1-60／REQ-030-081 重新评估：委托人不认可 v0.1，要求即便零绑定也不得因 begin 降低正常 MCP 问答体验。v0.2 以零绑定默认直接问数、旧 begin 调用兼容且不新增阻断为第一段；实际有绑定的发布一致性另段处理，不作为零绑定恢复前置。仅文档，未确权、开发未授权；测试台 not_registered；≠ 可上线。 |
| v1.70 | 2026-11-19 | P1-58／59两份Spec／Plan及共享UAT优化定稿；委托人明示“你修改完就是终稿，不用再交付codex cli”，按明示终稿确权登记，未执行CLI终审。补DEP正反例、既有审计回执接法、F58／F59／R分层、预算基线与总表／已启用分母；保留全部2×／5×组合用例。开发未授权、测试台NOT RUN，不入核心分母，≠可上线。 |
| v1.69 | 2026-11-19 | 入池 P1-60／REQ-030-081（普通 WebUI 发布与口径绑定注册表一致提交、纯 MCP begin 主路径修复）。委托人仅要求修复方案与验收步骤，暂不改代码或配置；已发现普通发布未提交注册表及缺失／空目录摘要不一致的实现缺口。仅方案草案，未确权、开发未授权、测试台 not_registered；不重复 P0-1 核心分母，≠ 可上线。 |
| v1.68 | 2026-11-19 | 入池 P1-58／REQ-030-079（角色权限与 Agent 读取响应）及 P1-59／REQ-030-080（多人编辑冲突恢复）。委托人授权 Spec／Plan 与 2×、5× 负载 UAT 设计落盘；不含运行代码、配置、测试脚本开发或执行。两份功能合同分别起草，共用组合 UAT；当前负载缺失维度使用显式设计下限，不能冒称现网实测。终稿未确权，开发未授权；不入核心分母；≠ 可上线。 |
| v1.67 | 2026-11-19 | **P1-57 D7延期裁决**：委托人明示“这个可以先不修，未来再修”，仅将G6中的正常新实例正式CSV／ZIP完整导出基线缺口延期、待另行安排；原FIX-01 FAIL不改、不关闭缺陷。限定客户功能测试排除此项，不再由其阻塞；候选身份、R1／R2、其他必做与D5边界保持；D6不实施、≠可上线。 |
| v1.66 | 2026-11-19 | **P1-57 修复复验完成、本轮结论FAIL**：D1–D5已授权，R1／R2修复；补录并纠正G7–G9测程假绿风险；完整夹具／真实SIGKILL／正常及受控降级SQL已验。G6新实例正式导出仍409，按D4回设计，不能交客户测试；D6未授权。Spec／Plan／三台账同次同步。 |
| v1.65 | 2026-11-19 | **P1-57／REQ-030-078 立项文档草案**：按委托人要求先制定整改计划，逐行承接 R1 混合权限、R2 全局请求上限及 G1–G6 验收缺口；修复前先确认。P1-56 上轮实现已提交 d8c3f097，复评仍检出 R1／R2；FDE 测试台现值见 INDEX（BLOCKED）。既有授权只记录历史，本次明确等待确认后再实施。 |
| v1.64 | 2026-11-19 | **P1-56 终稿确权＋整批开发授权（委托人 2026-11-19 12:35）**：委托人「整批授权」「无需复审，整批定稿」。按委托人明示确权记录：P1-20 §8、P1-34 §11、v2p5 §18.19 N26、P1-38 §8 四份修订确权；Codex 首轮终审（未确权）的必改项已全部采纳修订，**未做复审**。整批开发授权（整改 [Plan v1.0](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md) Task 1–7，两批均生效，批次仅为建议顺序）。**O3（存量批量标脏）延后，未授权**；amd64 模拟、治理类长期改进、出包发布仍未授权。四份 Spec 的「本条出口」已扩为 EC-01–17／LS-01–24／SC-01–16／S06 含 N26-1–6，各状态行前缀登记「实现未开始、用例未转绿」。P1-38 主体仍标「终稿未确权」（本次只确权 §8）。**实现未开始；≠ UAT PASS；≠ 可上线**。
| v1.63 | 2026-11-19 | **P1-56 按 Codex 首轮终审修订 4 份 Spec 与整改 Plan 并定稿（仅文档）**：Codex 结论＝4 份均未确权（P1-34 §11 的 BLOCK：原伪代码在 50×400、6000ms 下首个终态约 30 秒，违反 B3，已改回候选硬上界并增逐响应 ≤20 秒断言；其余为 C6 调用面、EC-15 收紧、N26-5／N26-6、P1-38 规模门槛 SC-16 与 P3 改 ↓ 待实测、授权口径统一）。**生效条件改为按批**：第一批 P1-20 §8、N26、P1-38 §8 三份确权后即可开工，第二批 P1-34 §11 单独确权。P1-34 O7 的「服务端计终态」一半作废（须委托人知悉）。整改 [Plan v0.3-draft](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)。**修订定稿待回送 Codex 复审，终稿未确权；确权前禁止改运行代码**。≠ UAT PASS；≠ 可上线 |
| v1.62 | 2026-11-19 | **P1-56 委托人批准整改建议（仅文档）**：决策点闭合——P1-34 O7–O10 按草案；P1-38 O1 接受、O2 否决、O3 待 SC-14 证实自愈并核查标脏条件；UAT 受控投影进度替身与缩短回看窗口授权（先真实构造，INDEX 标「受控降级」），**amd64 模拟不授权**；整改分两批（第一批 F02／F01／AUDIT-01，第二批 F04＋F03）；F01／AUDIT-01 优先移植 84 做法；登记 6 个未登记根测试纳入范围。整改 [Plan v0.2-draft](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)。**开发授权有条件发出：4 份 Spec 终稿确权（Codex CLI 终审）通过后生效，确权前禁止改运行代码**。≠ UAT PASS；≠ 可上线 |
| v1.61 | 2026-11-19 | **P1-56 本机 L1 复现成立＋契约修订草案＋整改 Plan（仅文档）**：委托人要求复盘入错题本并授权起草／优化历史 Spec／Plan。候选 `3b1c62af` 上 F01／F02／F03／F04／AUDIT-01 均在受控替身（L1，非 UAT、未入 INDEX）上复现；L2 全真仍未做。已起草（**终稿未确权、开发未授权**）：[P1-20 §8](../specs/lucy-20261113-external-catalog-column-read-spec.md)（F02）、[P1-34 §11](../specs/lucy-20261115-large-schema-ingestion-spec.md)（F03／F04）、[v2p5 §18.19 N26](../specs/lucy-20261020-v2p5-audit-increment-spec.md)（F01）、[P1-38 §8](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md)（AUDIT-01）；整改 [Plan v0.1-draft](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)；[错题本](../lessons/2026-11-19-fde-3b1c62af-defects-missed-by-uat.md)。顺带补两份历史 Plan 的形态并更正 Task 5／6 偏差记录。**不改运行代码；不改各 Spec 现行状态行；不入核心分母；≠ 开发授权；≠ UAT PASS；≠ 可上线** |
| v1.60 | 2026-11-19 | **入池 P1-55／REQ-030-076＋补录 P1-56／REQ-030-077（FDE 3b1c62af 打包前检查）**：委托人要求本机按 UAT 规范复现前方报告。P1-55＝复现任务，[Plan v0.2](lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md)，D1–D4 已确认（授权：入总账／建 suite、延迟注入代理降级、构建 84 镜像；**未授权**：受控投影进度替身、amd64 仿真、修复）；测试台新套件 `UAT-SUITE-FDE-PACKCHECK`＝NOT RUN。P1-56＝FDE 候选缺陷补录（F01／F02／F03／F04／AUDIT-01；FDE 标 4 P0＋1 P1），**待本机复现确认，不预判成立**。**不改运行代码；不入核心分母；≠ 开发授权；≠ 可上线** |
| v1.59 | 2026-11-19 | **登记事实（P1-20 UAT 复跑）**：镜像 `3b1c62af` 上 Gate A＋**EXT-03-DUAL＋EXT-05** lab PASS（`hive.dw`／Kerberos `hive_jd.app`；缺表→`not_in_library`，SelectDB `Unknown table`）。跑次 [hive-jd-ext-rerun](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-19-cursor-hive-jd-ext-rerun.md)。**客户生产 SelectDB 仍 NOT VERIFIED**；不改运行代码；出包须另行授权；≠ 可上线 |
| v1.58 | 2026-11-19 | **P1-47 尖峰削峰落地＋默认 UAT PASS**：委托人批准 30 天回看不变、执行 [write-slice-spike-shave Plan](lucy-20261119-p147-write-slice-spike-shave-plan.md)。实现：撤销 skip；写片 2–8；`write_slice`／窗口 `delete_window`／PASSIVE 经 rebuild worker off-thread。测试台 [shave2-default](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-19-cursor-rpb-shave2-default.md) **RPB-09＝3／3 PASS**（livez max 7–17ms）。Spec → v0.7。暂停仍为客户交付安全带。**模拟台 ≠ 客户现网；≠ 可上线** |
| v1.57 | 2026-11-19 | **P2-2／REQ-030-002 MD 标配（复制 Markdown 成为标准动作）**：委托人明示「Copy as Markdown 很有用，以后 md 就是标配了，建议我们也加上」→ 新增 **D21**：① 「复制 Markdown」按 KTX 的页面级写法落在**标题下方内容区**（`secondary` 文案动作，不占 PageHeader 预算；PageHeader 只留导出／打印，可见动作 = 2）；② 覆盖**文章页／快速入门页／分类页／全文视图**四处；③ 复制与导出产物一律 Markdown、扩展名 `.md`，不提供第二种交换格式；④ **解除 D6 的整本导出限制**（整本＝白名单读取的同一份 `SYSTEM_HANDBOOK.md` 原文；分类页可导出整类；零新增服务端载荷，复用 `markdown` 与 `sectionSpans`）；⑤ 全文视图不得出现「打印成 PDF 才是完整版」话术。新增 **SC-26**，出口扩到 **SC-01–SC-26**。Spec／Plan 升 **v0.5-draft**。**≠ 终稿确权；≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.56 | 2026-11-19 | **P2-2／REQ-030-002 首页形态裁决 ＋ 两项候选纳入**：委托人明示 ① 帮助首页形态参照 `https://www.kimi.com/code/docs/`（概览内容页）与 `https://docs.kaelio.com/ktx/docs/getting-started/quickstart`（任务路径写法）落地 → **D17 已裁决**（概览内容页；门户网格与封面图退出本条）；② **「错误参考」章与「未覆盖位置逃逸出口」两个候选都要拉进来** → 新增 **D19**（手册新增「错误参考」章：H3＝错误类、H4＝单条错误码条目，五要素＝机器码／含义／现象／可执行下一步／兜底路径；机器码须命中术语标准已登记裁决码或 `audit-trace-span.ts` 的 `REASON_CODES`，不新造码；一致性检查并入既有 `lint:handbook-anchors`）与 **D20**（未覆盖角色页与速查末节必须给站内逃逸出口），新增 **SC-24／SC-25**，出口扩到 **SC-01–SC-25**；§3 非目标新增「手册正文可为本主题新增错误参考章」例外（与 D15 同级）。Spec／Plan 升 **v0.4-draft**。**≠ 终稿确权；≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.55 | 2026-11-19 | **P1-54／REQ-030-075 Spec／Plan → v1.0 终稿确权**：委托人批准对抗复审修订并定稿（identities、D7a、frozen 02c、COMPAT-02 四题、行级③＋03b-gate、gov filters、OPS-05／05b、Plan 归属拆分）；开发未授权（明示暂不开发）；共享测试台 NOT RUN。**终稿确权 ≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.54 | 2026-11-19 | **P2-2／REQ-030-002 对标对象修正**：委托人明示把帮助中心体验的**现行对标对象**由 `https://www.kimi.com/help` 改为 `https://www.kimi.com/code/docs/`（Kimi Code 产品文档站）。本版据新对标重做 Spec §1 调查基线（2026-11-19 实机探查：分组侧栏／右侧 On this page／底部分页器／⌘K 锚点级搜索／错误参考页／FAQ 分组），新增 **D16**（对标修正，旧「分类卡网格门户」结论降为可选参考、逐条取舍入 §1.3）、**D17**（帮助首页形态待委托人裁决：选项 A 门户网格／选项 B 概览内容页，两形态共同硬约束＝首屏 D15 深链 + 角色卡不丢）、**D18**（搜索结果升级为锚点级归属路径），新增 **SC-22／SC-23**；错误参考页型与 FAQ 逃逸出口登记为未纳入本期承诺的候选（Spec §1.5）。Spec／Plan 升 **v0.3-draft**。**≠ 终稿确权；≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.53 | 2026-11-18 | **P1-53 → v1.1 终稿补丁＋P1-54 → v0.2-draft**：委托人批准评审建议；收编题库正本／Ops 分母；明示 **CompatConfigProfile（连接／语义／Role／权限）为全真落地前置**（D27／SC-25；题库 Spec §0）；闭合多库禁 admin、行权限 East／Southwest、gov 分立。测试台仍 NOT RUN。**≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.52 | 2026-11-18 | **入池 P1-54／REQ-030-075（独立多场景题库）**：委托人授权访问真实系统并起草涵盖 Lucy Ops 的独立题库 Spec；已盘点 `demo-mysql`／`lucy-ops`、当前 Role 与 ACL。题库覆盖独立问、连续追问、单表／多表、权限、多库、Lucy Ops W0 当前车道及 W1／W2 受控扩展车道，含独立 oracle、时区与人口口径。[Spec](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) v0.1-draft；测试台沿用 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`＝NOT RUN。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.51 | 2026-11-18 | **P1-53／REQ-030-074 Spec／Plan → v1.0 终稿确权**：委托人授权修订定稿（闭合 Kimi T1–T10：双证据文件、四函数拆分、严格 Agent 墙钟＋三维判定、客户端单选、回滚条件必做、无总成本上限、分层负控等）；测试台仍 NOT RUN。**终稿确权 ≠ 开发授权（明示暂不开发）；不入核心分母；≠ 可上线** |
| v1.50 | 2026-11-18 | **登记事实（P1-20 UAT）**：本机 Doris 2.0.14 双目录 lab 复跑——SIM 76/76＋KTX-GUARD PASS；**EXT-03-DUAL PASS**（`hive.dw` 129 表／单表 60 列；Kerberos `hive_jd.app` 177 表／单表 120 列）。测试台 INDEX＝替身有效＋lab live PASS；**客户生产 SelectDB 仍 NOT VERIFIED**。用例补 `UAT-SCAN-EXT-03-DUAL`；跑次 [hive-jd-ext-dual](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-18-cursor-hive-jd-ext-dual.md)；出镜像评估见 `inbox/20261118-2318-hive-jd-field-read-ship-assessment.md`。**不改运行代码；出包须另行授权；≠ 可上线** |
| v1.49 | 2026-11-18 | **P1-53／REQ-030-074 Spec／Plan → v0.2-draft**：委托人批准审阅修订落入合同（D20 环境生命周期拆分、耗时分档＋D16a、出包／升级双入口、D21 通用合成夹具车道、D6 Demo＝ESC-11／客户基线分层、SC-14 固定坏 digest、SC-21／22 等）；测试台仍 NOT RUN。**≠ 终稿确权 ≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.48 | 2026-11-18 | **入池 P1-53／REQ-030-074（MCP 升级兼容底线与全真用户旅程门禁）**：委托人批准通用事故回归＋客户真实基线双层门禁、独立／连续追问／单表／多表／权限／多库全真 Agent 题库，以及绝对上限＋相对退化耗时双门禁；无基线、FAIL、BLOCKED、NOT RUN 均不得放行。[Spec](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)／[Plan](lucy-20261118-mcp-upgrade-compatibility-plan.md) 初稿 v0.1-draft；测试台 NOT RUN。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；不入核心分母；≠ 可上线** |
| v1.47 | 2026-11-18 | **入池 P1-52／REQ-030-073（客户镜像升级可靠性分层门禁；仅发布取证文档）**：委托人认可 digest／Chart／values／N-1 数据基线绑定、客户数据量级覆盖与「环境等价而非复制客户集群」折中，授权只生成 Spec／Plan，评审前不开发、不执行 UAT。方案为镜像前预检＋镜像后 A 层原生 amd64 容器压力＋B 层标准 K8s 持续升级＋按验证边界触发的 C 层客户隔离预演；同一 digest 通过后才晋级。[Spec](../specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md)／[Plan](lucy-20261118-customer-upgrade-reliability-gate-plan.md) v0.1-draft；测试台 not_registered。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；未授权不改运行代码、CI、门禁脚本与测试台；不入核心分母；≠ 可上线** |
| v1.46 | 2026-11-18 | **入池 P1-51／REQ-030-072（版本轴分工与命名规约；仅文档）**：委托人确认采纳 `rc.N`＋交付主键、候选号出包自动分配、私有化分叉可定位；Spec／Plan 升 **v0.3-draft**（交付仓追溯合同、SC-09–SC-13）。补登：此前 Spec／Plan 已落盘但未入总账。测试台 not_registered。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；未授权不改运行代码；不入核心分母；≠ 可上线** |
| v1.45 | 2026-11-18 | **P1-47 F2++（R07 第三轮）**：`wal_autocheckpoint` 50→**25**；写片 INITIAL 3／MAX 12；tiny residual 可跳过 PASSIVE（每 3 片强制一次）。[Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) → v0.6；证据 [inbox/fde-r07-trace.md](../../inbox/fde-r07-trace.md)。`r07-p99-2` livez max 620✓／p99 441✗；**待** `r07-p99-3` 复跑。≠ 可上线 |
| v1.44 | 2026-11-18 | **P1-47 F2+（R07 第二轮）**：`wal_autocheckpoint` 100→**50**；写片后必让出；PASSIVE busy 延后重试；写片 INITIAL 4／MAX 16。[Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) → v0.5；证据 [inbox/fde-r07-trace.md](../../inbox/fde-r07-trace.md)。F3 `r07-default-on` livez max 650✓／p99 500✗；**待** `r07-p99-2` 复跑。≠ 可上线 |
| v1.43 | 2026-11-18 | **P1-47 B 线（FDE R07）落地 `wal_autocheckpoint`／写片预取／片间 PASSIVE**：[Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) → v0.4；证据 [inbox/fde-r07-trace.md](../../inbox/fde-r07-trace.md)。SC 未增删。默认配置 RPB／COLD **待协调者复跑**（历史 FAIL ~2693ms）。暂停仍为逃生阀。≠ 可上线 |
| v1.42 | 2026-11-18 | **P1-34 Spec addendum v0.2.2（FDE R02 字段读超时预算；不新开 P1-51、不并入 P1-43）**：LS-16–18 落地——Hive／catalog 超时按实际 `timeoutMs`＋timed-out 文本分类并停探针；MySQL 首条 columns 后每次（含折半）查预算；`timeoutMs=min(8s, remaining)`。vitest 虚拟时钟 PASS；真实 Hive UAT＝BLOCKED。跟进状态与 Spec 头部同句。**≠ 可上线** |
| v1.41 | 2026-11-18 | **对齐 FDE 打包门槛并行 Plan＋入池 P1-50／REQ-030-071（R01 重建快照与水位）**：委托人「对齐 FDE 打包门槛，可并行计划并推进执行」。新增 [fde-pack-gate-parallel-plan](lucy-20261118-fde-pack-gate-parallel-plan.md)。FDE R03 已由 `dada75c2` 关闭；R01＝P1-50；R07＝P1-47 B 线；R02／R04–R06＝门禁／字段读轨。Wave1 并行开工。**≠ 可上线** |
| v1.40 | 2026-11-18 | **P1-47 暂停交付模拟 UAT 双跑结论（可解 11-17 同形根因；仍不放行生产）**：委托人批准 D1／D2 后执行接力 Plan。Helm Chart **0.2.10** 白名单 `LUCY_INFERRED_MAINTAINER`；P1-47 Spec 升 v0.3（SC-08–10）。同镜像 `p147-pause-uat`（dirty arm64）：默认开 RPB-01 **FAIL** livez max **2693ms**；`off` 时 RPB-05／06／07 **PASS**（livez max **13ms**，MCP OK，`paused:true`）。冷启动暂停配置 R0／01–05 **PASS**（02／03＝COLD-07／08）。跑次：[rpb-pause-uat](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-pause-uat.md)、[cold-pause-off](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-cold-pause-off.md)。**P1-47 默认配置仍 FAIL**；暂停≠修复；模拟≠客户现场；下一步＝提交干净树＋amd64 `*-test`（Task 8）。≠ 可上线 |
| v1.39 | 2026-11-18 | **P1-47 暂停交付接力 Plan（UAT 优先验证 11-17 回滚同形根因）**：新增 [lucy-20261118-p147-pause-uat-relay-plan.md](lucy-20261118-p147-pause-uat-relay-plan.md) v0.1。核心＝同夹具双跑（`LUCY_INFERRED_MAINTAINER=off` vs 默认开）＋ Helm 白名单＋COLD `--env`；通过标准＝暂停侧 RPB-05／06／07＋COLD-07／08 模拟 PASS，且对照侧满量窗仍 FAIL。**待委托人确认 D1（提交）／D2（Chart 白名单）后开工**。不改 P1-47 默认 FAIL；暂停≠修复；模拟≠客户现场。≠ 可上线 |
| v1.38 | 2026-11-18 | **入池 P1-48／REQ-030-069（多步流程状态机合同门禁；仅文档）**：委托人确认「未显式状态机」是典型问题，授权起草 Spec／Plan、**暂时不开发**。[Spec](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md)／[Plan](lucy-20261118-multi-step-state-machine-contract-gate-plan.md) v0.1-draft：命中多步／门禁／发布／恢复的 Spec 须可解析状态机合同（状态集、转移、终态、非终态持久化、逃生边、禁止布尔冒充）；落地限 `lint:spec-docs`＋治理正文；不改业务运行时；测试台 not_registered。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；未授权不改运行代码；不入核心分母；≠ 可上线** |
| v1.37 | 2026-11-18 | **P1-47 暂停交付与根治并行计划（委托人批准方向：先完全暂停让 MCP 回复、再同步根治；优先级＝升级与 MCP 回复第一、日志第二）**：新增 [Plan](lucy-20261118-p147-pause-delivery-and-root-fix-plan.md) v0.1。A 线交付（Spec 入合同→Helm 注入开关∥模拟 UAT→提交与 amd64 待测包→原生升级演练→正式客户包）；B 线根治（分段计时→选手段→复跑→解除暂停演练）。**已授权**：暂停开关、A 线、B1 分段计时。**未授权**：提交 git、B2 具体手段、线上升级。事实：Chart `env:` 只下发白名单，开关目前不会进 Pod（Plan §6 D2）。模拟 UAT 不等于客户现场 PASS。仍不改 P1-47 状态：默认配置 FAIL。≠ 可上线 |
| v1.36 | 2026-11-18 | **P1-47 复核更正＋暂停开关（委托人「1」授权）**：复核 RPB-01 原始样本——42 个 livez 样本中 38 个 ≥1.5 秒、中位数 1967ms、最大 2968ms，约每 3 秒一次贯穿 120 秒窗口，**是持续停顿而非单次尖峰**，与客户现场 p99≈2.2 秒同形；撤回「可接受残余风险」口径（[评估](../reviews/2026-11-18-p145-p147-upgrade-readiness-assessment.md)）。委托人授权：加运维暂停开关 `LUCY_INFERRED_MAINTAINER=off`（默认开，行为不变；关闭时不创建后台补算维护器，`inferredRebuildStatus` 如实返回 `paused`，不报「补算完成」）并以其做对照实验，证明停顿来自该维护器。**不含** OQ-2（`wal_autocheckpoint`／worker）。**结果**：开关已实现，对照实验（同镜像、同夹具）暂停时 RPB-01／02／03 全 PASS（livez max 11ms，119 个样本 0 个 ≥1.5 秒），不暂停仍 FAIL（max 2662ms，37／42 个样本 ≥1.5 秒）——持续停顿确证来自后台补算维护器；暂停只是逃生阀，**不关 P1-47**，默认配置仍 FAIL。[对照跑次](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-p147-pause-control.md)。≠ 可上线 |
| v1.35 | 2026-11-18 | **入池 P1-49／REQ-030-070（`lucy_ops_reader` 无头可问治理面 ACL；仅文档）**：委托人确认连接已启用多表而 Role 仅 W0 两表，未开放表对无头运维有用，授权起草 Spec／Plan、**暂时不开发**。推荐方案 B＝规范 W0 指纹 heal（定制 Role 不覆盖）。[Spec](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md)／[Plan](lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md) v0.1-draft；测试台 not_registered。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；未授权不改运行代码；不入核心分母；≠ 可上线** |
| v1.34 | 2026-11-18 | **P1-39 冷启动全套复跑（P1-45／47 落地后）**：候选镜像 `project-lucy:p145-p147`（工作树 dirty、arm64）在限速冷启动台复跑 `UAT-SUITE-COLD-START-SLOW-DISK`，R0／01／02／03／04／05 **全 PASS**（02 livez max 548ms／p99 468ms；03 重启 livez max 7ms；04 max 3ms）；801b9c02 跑次的 03／04 FAIL 在同一夹具转 PASS。P1-39 Spec OQ-4 解除；GAP-UAT-P1-39 改写（仅余 UAT-COLD-06 客户侧证据）。同时登记升级放行评估（结论：**不放行**，见该文档）。≠ 可上线 |
| v1.33 | 2026-11-18 | **P1-45／46／47 Docker UAT**：`demo:upgrade` 后跑三套件。P1-46 RML＝**PASS**；P1-45 IRR＝**PASS**；P1-47 RPB＝**FAIL**（RPB-01 livez 2968ms；RPB-02／03 PASS；整窗 DELETE 分块后相对 8003ms 改善）。跟进状态与 Spec 同句。**≠ 可上线** |
| v1.32 | 2026-11-18 | **P1-45／46／47 Wave 代码落盘**：Wave1＝[P1-46](../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md)（readyz 等 MCP listen）∥[P1-45](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md)（`inferred_rebuild_state`＋watermark）；Wave2＝[P1-47](../specs/lucy-20261118-rebuild-probe-budget-spec.md)（allocate 分块 25）。协调者聚焦 vitest **39／39**。三测试台仍 **NOT RUN**；**≠ UAT PASS ≠ 可上线** |
| v1.31 | 2026-11-18 | **P1-45／46／47 终稿确权＋开发授权**：委托人「授权定稿」。三 Spec／Plan 升 v0.2；OQ 已闭合（45 含 `inferred_rebuild_state` schema；46 Ready 等 MCP listen；47 前置事务分块）。多 agent 并行：Wave1＝P1-46∥P1-45；Wave2＝P1-47（同改 `audit.ts`）。编排 [lucy-20261118-p145-p147-multi-agent-parallel-plan](lucy-20261118-p145-p147-multi-agent-parallel-plan.md)。**≠ 可上线** |
| v1.29 | 2026-11-18 | **入池 P1-45／46／47（REQ-030-066／067／068）＋Spec＋测试台**：委托人要求按仓库规范为前方升级测试报告 LUCY-TR-20261118-01 v1.2 三则 P0 分别制定 Spec 与 UAT。编号避让产品线既有 P0-1…7，总账用 P1 事故修复序号；标题保留「前方报告 P0-0x」。**P1-45**=报告 P0-02 重建中断自动恢复（硬复现）；**P1-46**=报告 P0-03 readyz／MCP 启动一致（启动窗复现）；**P1-47**=报告 P0-01 满量重建探针预算（部分复现）。Spec v0.1-draft；测试台三套件 INDEX=**NOT RUN**。**入池＋起草 ≠ 终稿确权 ≠ 开发授权；未授权不改运行代码；不入核心分母；≠ 可上线** |
| v1.28 | 2026-11-18 | **登记事实，不改任何条目状态、不入新条目**：客户回退基线 `3a9f0711` 不含 P1-20（REQ-030-041）修复 `97fe7ee8`；本机用从 `3a9f0711` 源码构建的同款镜像对照 `71e5b941`（同一套 Doris 2.0.14、同一批模拟表）复现——`3a9f0711` 读 `hive-1`／`hive-jd` 字段全部失败（`READ_FAILED`，约 0.5 秒，请求被 KTX 本地拒绝，SelectDB 审计无该来源 `DESC`），`71e5b941` 读 129＋177 张表全部成功。P1-20 的「客户 live 未验」口径不变；回退前 `abb38913` 上 hive-jd 专属症状未复现、未解释。错题见 `docs/lessons/2026-11-18-rollback-baseline-lacks-external-catalog-field-fix.md`；补丁包是否出、怎么出由委托人另行决定（出包属交付范围，须授权）。**不改运行代码；≠ 可上线** |
| v1.27 | 2026-11-18 | **入池 P1-44／REQ-030-065（事故修复＋测试台）**：访问日志「调用流水」整页渲染崩溃（合并进来的 `auth_failure` 行无 `tool`），界面却显示「页面资源加载失败，可能是版本已更新」。委托人授权：①登记错题；②新建独立 UAT 检查所有二级页面与页签能否打开；③「授权修正」路由兜底边界。修复：调用流水 `auth_failure` 行单独渲染＋故事线空值防护（同日前序）；`RouteChunkBoundary` 只让 chunk 加载失败显示版本文案，其余显示「本页出错」并保留错误类别，重试只重置边界。测试台 `UAT-SUITE-PAGE-OPEN` 建成，demo 跑次 **PASS WITH GAP**（27 页面＋28 页签 55/55 PASS；详情页 NOT-RUN）。错题 [`2026-11-18-audit-calls-render-crash-misreported`](../lessons/2026-11-18-audit-calls-render-crash-misreported.md)。**修复未提交；线上未升级；不入核心分母；不挡原 P0；≠ 可上线** |
| v1.26 | 2026-11-18 | **入池 P1-43／REQ-030-064（仅登记；Lucy 不透出数据库原始错误）**：客户 `hive_jd`（SelectDB 外部目录、Kerberos HMS）读不到字段的排障中，本机 Kerberos 模拟确认——主机名反向解析不一致、时钟偏差、HMS 起不来、HMS 变慢（最终成功）四种成因在 Lucy「准备表结构」页面都是同一句「表「…」没有读到字段。」，Doris 原文只在容器日志。根因在类型：`SchemaColumnRejection` 仅 `{table, reason}` 七值枚举，无处承载原文。另观察单表读取 8 秒预算×三条探针＝约 24 秒放弃，且单表路径的超时文案走不到。错题 [2026-11-18-db-original-error-not-surfaced](../lessons/2026-11-18-db-original-error-not-surfaced.md)。委托人评价「很重要」（优先级仍待裁定）；随后指示「先登记 spec 即可，不开发」，已登记 [Spec v0.1-draft](../specs/lucy-20261118-db-original-error-surfacing-spec.md)。**入池 ≠ 立项 ≠ 开发授权；未授权不改运行代码；不入核心分母；客户 `hive_jd` 真正根因仍未确认；≠ 可上线** |
| v1.25 | 2026-11-18 | **P1-39／REQ-030-060 终稿确权＋开发授权（不含 schema 变更、不含线上升级）**：委托人「授权定稿，进入开发」。[Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md) v0.3、[Plan](lucy-20261117-cold-start-audit-scan-plan.md) 同步；OQ-1 收口为不新增表（窗口内最新一行 `ts` 对该用户最近一次推断问询重建的 `updated_at`）。改动限 `inferred-turn-maintainer.ts`、`proxy/audit.ts`（补算分页时间预算、外键盘点计时、预热入口）、`admin/audit-warmup.ts`（新）、`admin/page-budget.ts`（新）、`index.ts`（监听前预热）及对应 vitest。实现已在工作树（未提交）；vitest 守卫（SC-01–05／13／14／16／17）通过。测试台改后跑次 **FAIL（差一项）**：R0／01／03／04／05 PASS，02 仅首次升级补算窗口 livez p99 609ms 超门槛 400ms（max 643ms）；剩余手段（只读 worker／分配序号事务分块／`wal_autocheckpoint`）不在本次授权内，等委托人决定。**功能合同收口 ≠ UAT PASS ≠ 可上线** |
| v1.24 | 2026-11-17 | **P1-39／REQ-030-060 起草 Spec／Plan／测试台（仍无终稿确权、无开发授权；≠ 立项完成）**：委托人「推进修复，请起草 spec 和 plan，并提前按 uat 规范，设计好 uat 用例」。新增 [Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md) v0.1-draft、[Plan](lucy-20261117-cold-start-audit-scan-plan.md)、测试台 [`UAT-SUITE-COLD-START-SLOW-DISK`](../qa/uat/suites/cold-start-slow-disk/suite.md)（`UAT-COLD-R0／01–06`，脚本 `npm run uat:cold-start`）。**两项新事实**：（1）产品自带 SQLite 3.53.2 实测，**HEAD 的轮询 `SELECT DISTINCT user_id … WHERE id > ?` 计划仍是 `SCAN … idx_al_user_ts` 整条索引扫描**，`79db4352` 并未让轮询变便宜（去掉 `DISTINCT` 才走 `SEARCH … rowid>?`，0.02ms 对 2.2ms）；（2）`proxy/audit.ts` `getDb()` 每次打开都跑 `PRAGMA foreign_key_check`，代价未量化；（3）**第二个机制**：启动 `scanFull` 把窗口内全部用户标脏，每次启动对每个用户做 30 天整段重建，重建页读取（宽列、非覆盖索引）在限速冷盘上**单页 400 行同步 2.7–5.9 秒**（热缓存 1–2 毫秒）。**改前基线**：HEAD `7b882c7c` 在慢盘冷缓存台上旧库首次升级与已迁移库重启都 `FST_ERR_HOOK_TIMEOUT` 崩溃；启动幸存时就绪后 livez 反复 1.6–9.9 秒且进程不死（与客户「livez 1.5–2.2 秒、不崩溃」同形）；0.25.0 对照 30.8 秒就绪（UAT-COLD-01 PASS）。**未授权不改运行代码**；不入核心分母；≠ 可上线 |
| v1.23 | 2026-11-17 | **P1-39／REQ-030-060 根因定位登记（仍仅登记；≠ 立项 ≠ 开发授权）**：本机升级演练（同一份 20 万行／883MB 旧 schema 审计库；基线＝客户上一次平滑升级 `20261111-r1`＝0.25.0／`9c78b0e3`）复现——正常盘上 0.25.0 与 0.30.0（`be34e05a`）均可启动；**慢盘＋冷页缓存下 0.25.0 正常启动，0.30.0 在 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT` 崩溃**；库先迁移完再上慢盘仍崩，**排除升级时一次性建索引为主因**。定位：`211f2d64` 新增的 `inferred-turn-maintainer` 启动 `scanFull`（`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`，整条 `idx_al_user_ts` 覆盖索引全扫描，同步；慢冷盘 12.4s）；`abb38913` 的每 10s 轮询 `ts > ? OR (ts = ? AND id > ?)` 同为全索引扫描（`79db4352` 把轮询改成 `id > ? DISTINCT`，**计划仍是整条索引全扫描**；`scanFull` 原样保留；HEAD 已于 v1.24 实测，仍崩溃）。该维护器不在 r1（`3a9f0711`）与 0.25.0 中，吻合「以前平滑升级没出现过」。**本结论是本机受控限速复现，不是客户现场直接证据**；客户侧 fsync／IO 证据待取。不改 P1-38 行；**未授权不改运行代码**；不入核心分母；≠ 可上线 |
| v1.22 | 2026-11-17 | **P1-41／REQ-030-062 终稿确权＋开发授权＋实现已提交**：委托人「批准方案 C，授权定稿开发」＝D0＝C、终稿确权（无 Codex）、授权 Track A（A2／A3）与 Track B 方案 C；**不含** A1／D5 线上升级。Spec v0.2、配对 Plan、沙箱 run [2026-11-17-cursor-sankey-restoration-run](../qa/uat/suites/access-map-sankey-design/runs/2026-11-17-cursor-sankey-docker-seeded-run.md)：Docker 种子容器全真必做 R0／01～05 PASS WITH GAP（06 沿用基线），07 BLOCKED。已提交。**≠ 可上线** |
| v1.21 | 2026-11-17 | **入池 P1-42／REQ-030-063（按钮级成功反馈真实性：下载／保存／导出）**：委托人认可 P1-40 同类排查扩展到下载、保存、导出，**仅限按钮级**，授权 C 档（盘查＋修复＋机制），UAT 只用真实失败。测试台 `UAT-SUITE-BUTTON-FEEDBACK` 本轮建。**不入核心分母；≠ 可上线** |
| v1.20 | 2026-11-17 | **入池 P1-41／REQ-030-062（探查＋设计；不含开发）**：委托人称访问关系图「没有实现桑基图的效果，严重偏离设计意图」。探查结论：线上 `http://10.69.95.109:8276`（`gitSha=6d2664b3`）**不含**允许词表（`f3f88837`）与空桑基修复（`e2ca2ca7`），因此没有改善；HEAD 在零访问、多 Agent、全未确认三种数据下仍退化（零访问只有 3px 发丝；dense 77 柱 76 个高度为 0；未确认关联被静默吞掉）。设计 Spec [lucy-20261117-access-map-sankey-restoration-spec](../specs/lucy-20261117-access-map-sankey-restoration-spec.md) v0.1-draft（D0 设计意图待裁定）；测试台 `UAT-SUITE-ACCESS-MAP-SANKEY` 改前基线 **FAIL**；错题 [2026-11-17-access-map-sankey-regression](../lessons/2026-11-17-access-map-sankey-regression.md)。**终稿未确权；未获开发授权；不改运行代码；不入核心分母；线上未登录核对（SANKEY-07 BLOCKED）；≠ 可上线** |
| v1.19 | 2026-11-17 | **P1-40 UAT 加固**（委托人「批准优化」）：Token 改真实签发＋吊销；真实 MCP 查询造审计数据；子用例 02a–02j；登记门禁新增 R4；`npm run uat:copy-probe`；原始证据入 `runs/evidence/`。测试台复跑 **PASS WITH GAP**。修复已提交 `65f40847`。**≠ 可上线** |
| v1.18 | 2026-11-17 | **P1-40／REQ-030-061 修复落地（工作树）**：委托人「授权修复」（事故修复授权）。`webui/src/lib/clipboard.ts` 降级路径修复；`clipboard.test.tsx` 改为调用瞬间读选区；Spec 192 补 §13.5。测试台复跑 `UAT-SUITE-COPY-FAKE-SUCCESS`＝**PASS WITH GAP**（改前 FAIL 基线同探针同环境）。**未提交合入；公网实例未升级；≠ 可上线**。v1.17 行的「修复 helper 未获开发授权」为当时现值，已被本行取代 |
| v1.17 | 2026-11-17 | **入池 P1-40／REQ-030-061（事故修复＋测试台基建）**：明文 HTTP（非安全上下文）下，所有复制按钮经共享 helper `webui/src/lib/clipboard.ts` 的 `execCommand` 降级，选区为空却返回 true，界面提示「已复制」而剪贴板未写入。错题 [`2026-11-17-clipboard-http-fake-success`](../lessons/2026-11-17-clipboard-http-fake-success.md)。委托人授权调研并收敛 UAT／机制：测试台 `UAT-SUITE-COPY-FAKE-SUCCESS` 首跑 **FAIL**；`lint:copy-surfaces` 登记门禁接入 `pretest`；e2e-ledger 勾连并开 GAP-UAT-P1-40。**修复 helper 未获开发授权；未授权不改运行代码；不入核心分母；≠ 可上线**。编号：P1-39 已被客户 K8s 事故占用，本条取 P1-40 |
| v1.16 | 2026-11-17 | **入池 P1-39／REQ-030-060（事故修复；仅登记）**：客户 `lucyadm.matrixback.com` K8s 平滑升级至 Lucy 0.30.0（`abb389133356`）后，event loop p99≈2210ms，`/api/livez` 1.5–2.2s、`/api/readyz` 常超 Helm 3s → Ready=False → 网关 502／503；health 因 KTX MCP 1500ms 探针误报 degraded 抖动；现场已回滚。错题 [`2026-11-17-k8s-upgrade-event-loop-readiness-timeout`](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md)。**阻塞点函数未定位**。**入池 ≠ 立项 ≠ 开发授权；未授权不改运行代码；不入核心分母；≠ 可上线**。P1-21 跟进追加本事故为真实升级失败证据（不改其「功能合同已收口」句）。**编号避让**：v1.14 已把 `P1-38／REQ-030-059` 登记给「推断问询补算让出事件循环」（上游 79db4352），本条按「不得占用已登记编号」顺延为 `P1-39／REQ-030-060` |
| v1.15 | 2026-11-17 | **P1-38 过程对抗 R1＝BLOCK 后修订为 v0.2-draft**。跟进状态与 Spec 头部同句。终稿未确权。测试台 not_registered。**不入核心分母。≠ 可上线** |
| v1.14 | 2026-11-17 | **入池 P1-38／REQ-030-059**：推断问询补算让出事件循环。客户 `0.30.0`（`abb389133356`）升级后探针来回，已回滚。Spec [inferred-turn-rebuild-yield](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md)／[Plan](lucy-20261117-inferred-turn-rebuild-yield-plan.md)。跟进状态与 Spec 头部同句。测试台 not_registered。**终稿未确权。不入核心分母。≠ 可上线** |
| v1.13 | 2026-11-17 | **P1-36／P1-37 沙箱 Tier-A UAT 与 U1／U4 补做**：宽目录沙箱（320 Source、20 Agent）复现握手与拒绝长尾后修复 U1（描述索引按文件指纹缓存，偏离 Spec 的 instructions 缓存设计）与 U4（拒绝／门闩路径跳过逐 Agent 权限编译；宽目录门闩拒绝 P50 568→194 ms）；P1-37 增补 M1–M6 取数脚本；测试台两套件＝**PASS WITH GAP**（TRC-07/08/09 NOT RUN、MCPX-09／10 BLOCKED）。登记发现 F-1～F-5（F-2＝正式完整导出既有 F-02 失败关闭，F-3＝SC-06 口径冲突待裁定）。**≠ 整套 UAT PASS；≠ 可上线；不入核心分母** |
| v1.12 | 2026-11-17 | **P1-36／P1-37 开发落地（委托人「授权开发落地」）**：P1-36 代码落地（span 表、同事务写入、`spans.csv`／`spanCoverage`、`/api/admin/audit/status`）；P1-37 仅 U2、U3a 落地，U1／U4 取证后无根因证据未改，U3b 不实现；已知缺口与 demo 实测见 [取证记录](../reviews/2026-11-17-p1-36-p1-37-implementation-evidence.md)。两套件仍 NOT RUN；**≠ UAT PASS；≠ 可上线；不入核心分母** |
| v1.11 | 2026-11-17 | **P1-36／P1-37 Spec v1.0 终稿确权（免 Codex；≠ 开发授权）**：委托人明示「不需要 codex cli」「授权你修正后定稿」。代理按 R3 修订并闭合开放项：**P1-36** O1–O8 全部闭合（O6 冻结容量门槛：每 trace span 表＋索引平均 ≤ 8 KB、span 与父行同寿命、不新增清理）；**P1-37** O1–O7 闭合，**O7 定稿决策＝U3 拆 U3a／U3b，持续失效短路（SC-09／10、MCPX-09／10）移出出口，不随本条实现**（可由委托人撤销），O6 转开工前置。R3 修订未经第 4 轮复审，已知缺口。**未获开发授权；未授权不改运行代码；不入核心分母** |
| v1.10 | 2026-11-17 | **P1-36／P1-37 Spec／Plan／UAT → v0.4-draft**：委托人授权对抗性审阅；Codex CLI 因网络不可达未能运行，委托人选择改用 GPT 5.6 子代理做过程评审（**非 Codex CLI，不算终稿确权**）。R1＝BLOCK（P1-36 19 条、P1-37 20 条）→ 修订 v0.2；R2＝BLOCK（P1-36 15 条、P1-37 14 条）→ 修订 v0.3；R3（终轮）＝BLOCK（P1-36 8 条、P1-37 9 条）→ 修订 v0.4，未再复审。记录 [评审记录](../reviews/2026-11-16-p1-36-p1-37-adversarial-review.md)。**待委托人决策**：P1-37 O7（持续会话失效夹具）；P1-36 O2／O7／O8。仅文档；**未获开发授权；不入核心分母** |
| v1.09 | 2026-11-16 | **P1-35 Spec v0.4 终稿确权＋授权开发（免 Codex）并实现、UAT 复测 PASS**：委托人明示「不用 Codex 终审，授权定稿、开发」；容错三档（D10–D15）落地；ESCAPE INDEX＝PASS（R0／ESC-01～10，[v0.4 跑次](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)）；GAP-UAT-P0-3-ESCAPE 关闭。跟进状态与 Spec 头部同句。不入核心分母；**≠ D5／功能合同收口 ≠ 可上线** |
| v1.08 | 2026-11-16 | **入池 P1-36／REQ-030-057、P1-37／REQ-030-058**（仅文档）。来源＝客户全量调用流水（2026-11-09 至 11-16，23,687 条）的审计、可观测与体验评估。委托人 2026-11-16 夜批准设计：**P1-36**＝调用流水 trace 级可追溯与存档（方案 B：新增 span 表、同事务写入；存档第 1 层，不含防篡改链与外送）；**P1-37**＝MCP 体验韧性（U1 握手长尾、U2 失败信息可操作、U3 会话恢复与限流、U4 拒绝快速返回；U5 预算终止、U6 口径防呆、U7 能力缺口、U8 语义层契约前置检查为后续候选，**不入本轮**）。[P1-36 Spec](../specs/lucy-20261116-trace-span-ledger-spec.md)／[Plan](lucy-20261116-trace-span-ledger-plan.md)＋测试台 [`UAT-SUITE-TRACE-LEDGER`](../qa/uat/suites/trace-span-ledger/suite.md)（NOT RUN）；[P1-37 Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md)／[Plan](lucy-20261116-mcp-ux-resilience-plan.md)＋测试台 [`UAT-SUITE-MCP-UX-RESILIENCE`](../qa/uat/suites/mcp-ux-resilience/suite.md)（NOT RUN）。**P1-37 不重复 P1-35**（门闩钉选放行与拒绝载荷只引用）；指标告警接线挂 P0-7（冻结，**本次不解冻**）。**终稿未确权；未获开发授权；未授权不改运行代码；不入核心分母；≠ 可上线** |
| v1.07 | 2026-11-16 | **P1-35 Spec v0.4-draft**：容错三档（选表歧义降为披露＋审计；B 方向；披露＝响应字段；审计只记录）；D10–D15／§4.5 支持矩阵／SC-E20–E30。跟进状态与 Spec 头部同句。**待 Codex 终审与开发授权；未授权不改运行代码；不入核心分母；≠ 可上线**。注意：修订父 P0-3「强门禁」定位，P0-3 状态不变 |
| v1.06 | 2026-11-16 | **P1-35 ESCAPE UAT v2 升必做并 FAIL**：ESC-04～08 按分析师主路径通用性升必做；ESC-07（合法多表 join）／ESC-08（拒绝载荷 `usableTargets` 恒空）FAIL；INDEX＝FAIL；GAP-UAT-P0-3-ESCAPE 重开。**≠ 开发授权 ≠ 可上线** |
| v1.05 | 2026-11-16 | **P1-35 ESCAPE UAT PASS**：复测翻绿；GAP-UAT-P0-3-ESCAPE 已关。**≠ 功能合同收口 ≠ 可上线** |
| v1.04 | 2026-11-16 | **P1-35 实现合入**：钉选放行（D1／D3／D9）＋schemaProbe D5＋instructions；vitest 30/30。待 demo 升级后 UAT。**≠ 可上线** |
| v1.03 | 2026-11-16 | **P1-35 R2-F＋R4**：委托人明示「授权进入开发」（2026-11-16）＝终稿确权＋开发授权。Spec／Plan **v0.3**；实现进行中。**不入核心分母**；≠ 可上线 |
| v1.02 | 2026-11-16 | **P1-35 过程对抗三轮收束**：Codex R3＝PASS WITH GAP；R3-01 minor 已随终稿整理修正。Spec／Plan 仍 **v0.3-draft**；**待 R2-F／R4**；未授权改运行代码。**不入核心分母**；≠ 可上线 |
| v1.01 | 2026-11-16 | **P1-35 Spec／Plan → v0.3-draft**：Codex R2＝BLOCK 后修订（健康与空 hits 分离；H1／H2／F1；ESC cases 收紧；GAP≠D5；SAG-02 拆分；SC-E19）。跟进状态与 Spec 头部同句。**待 R3／R2-F／R4**；未授权改运行代码。**不入核心分母**；≠ 可上线 |
| v1.00 | 2026-11-16 | **P1-35 Spec／Plan → v0.2-draft**：Codex 过程对抗 R1＝BLOCK 后修订（D9 安全边界、D3 优先级、D5 装配、SAG-01 v2、出口禁止 PASS WITH GAP 关 GAP）。跟进状态与 Spec 头部同句。**待 R2／R2-F／R4**；未授权改运行代码。**不入核心分母**；≠ 可上线 |
| v0.99 | 2026-11-16 | **入池 P1-35／REQ-030-056**：表级歧义门闩纯 MCP 逃生与拒绝载荷持久修复（P0-3 伴生）。委托人认可持久方案（钉选放行＋五项证据真接线；不以 kill switch 结案）并授权落盘 Spec／Plan。[Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)／[Plan](lucy-20261116-source-ambiguity-mcp-escape-plan.md)；测试台 [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) 基线 FAIL。**不含 R2-F／R4**；未授权改运行代码。**不入核心分母**；≠ 可上线 |
| v0.98 | 2026-11-16 | **财务／销售收入双口径选择：明确不进 0.30**。委托人确认仍为**概念阶段**（未达 Spec），**不在 `lucy-v0.30` 升级或跟进**。概念与同日认同／反对评审意见落盘 [post-0.30 CAL 概念池](lucy-20261116-post-030-dual-caliber-selection-concept-pool.md)（REQ-CAL-001）。**不新增本总账行；≠ 立项；≠ 开发授权；≠ 可上线** |
| v0.97 | 2026-11-16 | **P2-2／REQ-030-002 委托人选方案 B**：保持帮助中心体验为 **P2**（不入问数核心分母、不整包抬成 P0）；开线时**必须**让门户／「快速入门」最显性位深链到手册「Agent 直连库 vs 经 Lucy」对照 +「语义配置杠杆清单」。正文 SSOT 仍在 `SYSTEM_HANDBOOK`（D3 不破）；允许为本主题新增手册 §0 FAQ 与专节（修订原「不扩写手册」非目标）。Spec／Plan 升 **v0.2-draft**（D15／SC-21）。**≠ 开发授权；≠ 可上线** |
| v0.96 | 2026-11-16 | **登记真实环境复测证据（只追加证据，不改任何条目状态）**。委托人在做 `10.69.95.109:8276` 近 30 天访问日志分析时，经 VPN 遇到链路与审计页面不稳定，并确认「这正是 0.30 要修复的内容」。现场事实：① TCP 8276 探测 6 次仅 1 次返回 200，其余超时，ICMP 正常；② 浏览器登录成功（`operator`），但 `/admin/audit?range=30d&outcome=ok&turnSource=reported` 一直停在「加载中」；③ `/api/admin/audit`、`/api/admin/audit/turns` 在 `limit=1`、1 天窗口下仍挂起超过 90 秒；④ 后期连 `/api/auth/status`、`/api/health` 也超时；⑤ 页面顶部同时显示「审计投影未追平」；⑥ 委托人判定当前链路承受不了这样的访问量，已终止本次测试，未取得任何日志数据。**未区分**：链路自身丢包与服务端事件循环被占满两种原因；**未知**：该环境运行的 Lucy 版本是否已含 P1-32／P1-33 实现（总账 P1-21 记客户 0.25 无 `livez`）。归属：**追加到 P1-21／P1-32／P1-33 作真实环境复测证据**，不新增行。分析改为等委托人从 WebUI 导出 CSV 后离线做。**≠ UAT PASS；≠ 可上线**；不入核心分母。 |
| v0.95 | 2026-11-16 | **P1-32／P1-33 开发授权已获得，实现已落地**：委托人 2026-11-15 23:47「授权进行开发落地，并按 UAT模块的规范落地相应的测试用例，未来升级迭代要进行等价测试，防止旧病复发」。本会话无 Codex CLI，**按「委托人明示确权＋开发授权」处理**（先例同 P1-34）；委托人如不认可这一理解，须撤回并走 Codex 终审。F-1…F-7 均已整改，[Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)。新增测试台 [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md)（冻结旧实现＋改前金样本，`npm --prefix webui run test:equivalence`，71 条全绿；变异自检 8 类全拦下，其中 1 类先补强用例后拦下）。`UAT-SUITE-PAGE-SWEEP` 整改后复跑 **PASS WITH GAP**：0 越线／0 失败、96 通过、25 未测；基线 `tracked` 清零，`export-v2`／`export-pack-v2` 因夹具缺派生列转入未测。**未改**：`linkedHandshakeRows` 同类无界 `IN`（Spec 风险）。**功能合同收口 ≠ UAT PASS ≠ 可上线**；不入核心分母。 |
| v0.94 | 2026-11-15 | **P1-34／REQ-030-055 开发授权已获得**：委托人 2026-11-15「授权 spec 定稿，进入落地开发」＝终稿确权（委托人明示确权）＋开发授权；O1–O6 按 Spec 建议值闭合（O2 沿用 20 秒假设）。实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（共 5 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）：MySQL 600 表读完约 0.3 秒（基线约 9 分钟）；外部目录 2000／3000／5000 列宽表可读。测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS，共 5 次完整跑中第 2 次 SCALE-09 异常 FAIL（171 秒）未定位根因，不宣称稳定 PASS；SCALE-09 测量对象已由逐张合并改为真实客户端读取路径（预算不变）。**不入核心分母**；功能合同收口另行判定；≠ 可上线 |
| v0.93 | 2026-11-15 | **入池 P1-34／REQ-030-055**：大 Schema 接入（宽表与多表）。委托人 2026-11-15 要求「把本次真实规模写进 UAT、以后不低于此规模压测」并「制定优化 Spec 与 Plan，顺利接入而不是超时报错」＝立项＋写 Spec／Plan 授权。诊断结论：外部目录 2000 列以上整张表被拒、1500–1999 列勉强通过；普通 MySQL 逐表约 0.93 秒、600 张约 9 分钟；客户端逐表累积二次方，600 张×30 列在 10 秒内只完成 144 张；任一表失败即整批终止。Spec [`lucy-20261115-large-schema-ingestion-spec.md`](../specs/lucy-20261115-large-schema-ingestion-spec.md)（v0.1-draft）与 [Plan](lucy-20261115-large-schema-ingestion-plan.md) 已落盘；测试台 [`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md) 已挂，**规模下限不得降低**。基线跑次 **FAIL**（UAT-SCALE-09 FAIL；其余 BLOCKED，无本机 demo 管理员口令）。**不含开发授权**：Spec 待终稿确权＋O1–O6 决策闭合＋委托人另发开发授权。**不入核心分母**；**不挡**原 P0；≠ 可上线 |
| v0.92 | 2026-11-15 | 委托人对 P1-31 排查的四项建议一并批准（「立；补；拿出来重新评估；升级为门禁，并补充到 UAT」）。**入池 P1-32／REQ-030-053**（审计导出路径规模整改：F-1 `export-inquiry-pack` 单次约 114–118 秒、探针连续失败 37 次；F-6 v2 导出在全量或 ≥14 天范围撞 SQLite 变量上限，409 `too many SQL variables`）与 **P1-33／REQ-030-054**（并发压测越线接口：F-2 `access-map`、F-3 `governance/overview`、F-4 审计导出两条、F-5 `ui-usage/overview`、F-7 `reconciliation/export`）。**P1-31 补做**：合成账本夹具（让正式对账与 v2 导出可测，并因此新发现 F-6／F-7）、[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)、`npm --prefix webui run sweep:event-loop:gate` 门禁（基线只减不增）、[O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)（建议维持不默认引入 worker）。**P1-32／P1-33＝立项，不含开发授权**；须各自终稿确权＋委托人另发开发授权后才可改运行代码。测试台首跑 **FAIL**（越线未整改），≠ UAT PASS；≠ 可上线。均不入核心分母 |
| v0.91 | 2026-11-15 | **P1-31／REQ-030-052 只读排查完成**，[排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)已出。结论：43 页中 39 页加载期间 livez 不越线、4 页夹具局限未测；125 个 GET 路由中 88 通过、**5 越线**、28 未测、4 排除。**F-1** `export-inquiry-pack`（仅 API，无页面入口）单次 114 秒、连续 37 次探测失败，会触发 Chart 存活探针重启。F-2…F-5 为中低。**未立整改条目，待委托人决定；登记 ≠ 开发授权**；未改运行代码。≠ UAT；≠ 可上线 |
| v0.90 | 2026-11-15 | **入池 P1-31／REQ-030-052**：全页面事件循环与探针风险排查（P1-21 全局化）。委托人 2026-11-15 同句「批准升级为全局问题，进行逐个页面的排查」＝立项＋**只读排查**授权；范围＝服务端全部 GET 路由与 WebUI 全部页面的耗时、状态码、对 `/api/livez` 的影响，产出排查报告与越线清单。**不含开发授权**：越线条目另立行，改运行代码须各自终稿确权＋委托人另发开发授权。UAT not_registered；**不入核心分母**；**不挡**原 P0；≠ 可上线 |
| v0.89 | 2026-11-15 | **入池 P1-28／REQ-030-049、P1-29／REQ-030-050**。行级隔离入核心分母；取值存在性不入核心分母。测试台 [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md) 已挂，判定只看 INDEX。无独立实现 Spec，未授权改运行代码。≠ 可上线 |
| v0.88 | 2026-11-15 | **可信证据／认证能力两类拆分（委托人批准）**：第一类设计口径吸收进 **P0-4／P0-B／P0-5／ACL 默认**（见 [split](lucy-20261115-trust-evidence-capability-split.md)）；第二类未开工项 **REQ-TE-001–008** 进 [post-0.30 需求池](lucy-20261115-post-030-trust-evidence-requirement-pool.md)，**不新增本总账行、不改已收口合同、不授权实现**。≠ 可上线 |
| v0.87 | 2026-11-15 | **P1-11 测试台 FAIL 入账＋P1-27／REQ-030-048 入池镜像**：INDEX／e2e 挂 `UAT-SUITE-OPS-CONCEPTS`＝FAIL（[claude-macmini-p1-11-ops](../qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)）；GAP-UAT-P1-11-RUNTIME 开放；cases 落盘 `UAT-R0-FIX` 供复跑；**P1-27 复测 NOT RUN、不重建**；≠ 可上线 |
| v0.86 | 2026-11-15 | **P1-30／REQ-030-051**：挂 `UAT-SUITE-CONTEXT-CONTENT`；首跑 **PASS WITH GAP**（WIKI-01S BLOCKED）；设计 `docs/design/design-2026-11-15-uat-context-content-wiki-skill.md`；≠ 可上线 |
| v0.73 | 2026-11-14 | **P0 六套升级后复跑**：委托人批准；Cursor 新增 `UAT-R0-UPGRADE`＋Plan／brief；Claude 全真。INDEX／e2e／lint 指 [`…-p0-post-upgrade`](../qa/uat/suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md)；容器 `gitSha=9d59337d`（≠ 上午 Wave A `3aa402c9`）。P0-3／4／5／2 PASS；P0-1／A PASS WITH GAP（Wave B 仍推迟）；SAG-02 BLOCKED。Plan [`lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md`](lucy-20261114-p0-post-upgrade-uat-cursor-claude-plan.md)。**≠ 改跟进状态合同句；≠ 可上线** |
| v0.72 | 2026-11-14 | **P1-19／REQ-030-040 测试台复跑 PASS**：主线 A 多 Agent（Cursor 编排＋Claude 全真）。[`UAT-SUITE-ACCESS-MAP`](../qa/uat/suites/access-map-sankey-empty/suite.md) 跑次 [`2026-11-14-claude-macmini-p119-access-map`](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md)：必做＋04 PASS；F-1 关闭（`ok` 进 band E）。INDEX／e2e-ledger 已挂；Spec 状态「UAT 未复跑」已改指针。**≠ 改功能合同收口句为可上线；≠ 可上线**。Plan [`lucy-20261114-p1-19-access-map-uat-multi-agent-plan.md`](lucy-20261114-p1-19-access-map-uat-multi-agent-plan.md) |
| v0.71 | 2026-11-14 | **测试台唯一 SOT 对齐**：委托人要求只保留唯一 UAT SOT。现行＝[`docs/qa/uat/`](../qa/uat/README.md)＋[`INDEX.md`](../qa/uat/INDEX.md)；旧 [`docs/uat/`](../uat/README.md) 改为归档／重定向（文件头提示＋README stub）。**≠ 改功能合同；≠ 可上线** |
| v0.70 | 2026-11-14 | **P0 问数六套件本机 Mac mini 复跑（Wave A）**：委托人批准后 Claude Code 全真执行；Cursor 验收。测试台 INDEX／`e2e-ledger` 已指 [`2026-11-14-claude-macmini-p0-qa`](../qa/uat/suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-qa.md) 等六跑次；Plan [`lucy-20261114-p0-mac-mini-uat-cursor-claude-plan.md`](lucy-20261114-p0-mac-mini-uat-cursor-claude-plan.md)。必做：P0-3／4／5／2 **PASS**（含 AV-02／EMPTY-02／CATSEM-02）；P0-1／A **PASS WITH GAP**（CALIBER-02／EXPOSURE-02 Wave B 推迟）；SAG-02 **BLOCKED**（无 person）。验容器 `gitSha=3aa402c9`（原样、未 upgrade）。**≠ 改跟进状态合同句；≠ 改 Spec 头部；≠ 可上线；≠ P0-6／7／B 已推进** |
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
7. **P0 七项 + P0-A 未齐，或核心方向 §9 第 5 条（行级隔离，P1-28）测试台未 PASS 前**，不得宣称「0.30 核心升级完成」。不入核心分母的已落地项（如 P1-15…18、P1-29）**不替代**该判据，但仍须在本池跟踪。
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

### 3.0 收口分列（禁止混加；A＋B＋C）

| 桶 | 阶段码前缀 | 含义 | 统计 |
|---|---|---|---|
| **功能合同收口** | `S5｜` | 功能合同 Spec 已收口 | 数跟进状态以 `S5｜`／`S5。`／`阶段:S5` 开头的行 |
| **发布取证收口** | `X_REL｜` | 发布取证 Spec 已收口 | 数跟进状态以 `X_REL｜` 开头的行 |

**禁止**把两桶相加冒充「总完成率」或「漏斗完成度」。在途发布取证（P1-52／P1-53 等）走 `S1`–`S4`，**不进** `X_REL` 桶。口径正文见 [`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「不是两套漏斗」。

| 清单 ID | 优先级 | 标题 | REQ | 闸 / 轨 | 核心分母 | 跟进状态 | Spec／Plan |
|---|---|---|---|---|---|---|---|
| P1-78 | P0（核心体验／发布底线） | MCP 问询端到端性能基准与持续门禁（仅测量与判定） | [REQ-030-099](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-099mcp-问询端到端性能基准与持续门禁) | 发布取证／真实 Agent／Public MCP／性能基线／持续门禁 | 否（独立发布门禁） | S1｜v0.3-draft。委托人2026-11-23授权新建独立性能测试 Spec／Plan／UAT 设计；终稿未确权；开发未授权；仅设计，不执行性能跑次；不改产品优化代码；≠ 发布取证收口；≠ 可上线。 | [Spec](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [Plan](lucy-20261123-mcp-inquiry-performance-baseline-plan.md) · [UAT](../qa/uat/suites/mcp-inquiry-performance/suite.md) |
| P1-79 | P1（测试内容；P1-78 依赖） | 长追问题组（性能专用，≥20 轮单进程长链） | [REQ-030-100](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-100长追问题组性能专用) | 测试内容／逐轮 oracle／独立 packDigest | 否 | S1｜v0.1-draft。委托人2026-11-23授权补充长追问题组并登记；终稿未确权；开发未授权；仅设计与登记；≠ 功能合同收口；≠ 可上线。 | [Spec](../specs/lucy-20261123-long-followup-question-pack-spec.md) · [Plan](lucy-20261123-long-followup-question-pack-plan.md) |
| P1-77 | P1 | 数据问答默认主动采用业务上下文（口径前置核对＋规程引导） | [REQ-030-098](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-098数据问答默认主动采用业务上下文) | 体验／缺陷修复级（运行时指导） | 否 | S2｜v1.1 合同修订已获批准，待开发授权。 | [Spec](../specs/lucy-20261123-default-business-context-adoption-spec.md) · [Plan](lucy-20261123-default-business-context-adoption-plan.md) · [UAT](../qa/uat/suites/context-content/suite.md#默认使用业务上下文) |
| P1-76 | P1 | YAML 产物禁 alias 治理（统一写出口＋静态门禁） | [REQ-030-097](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-097yaml-产物禁-alias-治理) | 约束／缺陷修复级加固 | 否 | S4｜v0.1。终稿已确权（委托人 2026-11-23 明示）；开发授权已获得；实现已落地（统一写出口＋15 处调用点替换＋静态门禁）；SC-01–SC-04 已验证、SC-05 随本次登记闭环；待委托人验收，未做功能合同收口。 | [Spec](../specs/lucy-20261123-yaml-alias-free-artifacts-spec.md) · [Plan](lucy-20261123-yaml-alias-free-artifacts-plan.md) |
| P1-75 | P1（主路径可用性，拟） | MCP 握手与 Agent 名册读取长尾治理 | [REQ-030-096](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-096mcp-握手与-agent-名册读取长尾治理) | 事故修复／功能合同，复用 P1-37、P1-66、FUP-03 的边界和门槛 | 否 | S2｜v1.1 合同修订已获批准，待开发授权。 | [Spec](../specs/lucy-20261123-interactive-read-resilience-spec.md) · [Plan](lucy-20261123-interactive-read-resilience-plan.md) · [UAT](../qa/uat/suites/interactive-read-resilience/suite.md) |
| P1-74 | P1（主路径可用性） | 问询预算主路径逃生（触顶后可达 fallback） | REQ-030-095 | Spec 162／窗口 Spec 逃生修订；互补 P1-60／P1-12 | 否 | S5｜v1.1；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。实现已提交（`72d47cb0`）；CR APPROVE；UAT 功能轴 PASS WITH GAPS；收口范围不含 BESC-07／10A／Wave D 全量。不入核心分母；≠ 可上线 | [Spec](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md) · [Plan](lucy-20261122-question-budget-mainpath-escape-plan.md) · [UAT](../qa/uat/suites/budget-escape/suite.md) · [错题](../lessons/2026-11-22-question-budget-exhausted-recurring.md) · [PM 报告](../../inbox/2026-11-22-question-budget-pm-scenario-report.md) |
| P1-73 | P1 | Spec 开发台状态治理（漏斗阶段＋状态词中文） | REQ-030-094 | 文档治理／评审门禁 | 否 | S5｜v1.2。功能合同已收口（2026-11-22，P1-73／P1-35 S5 收口批）。Wave A／B 已落地；v1.1 MIG＋`inventory-stage`；**v1.2 降熵 A＋B＋C**（一条主漏斗＋分叉终态；D8／D8b）。SC-01–SC-15＋实现 CR PASS。伞级事实源＝漏斗 Spec。测试台 not_registered；不入核心分母。本条收口不表示可上线 | [Spec](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) · [Plan](lucy-20261122-spec-status-funnel-gate-plan.md) · [状态词建议书](lucy-20261122-spec-status-vocabulary-chinese-plan.md) · [SC 审计](../reviews/2026-11-22-p1-73-sc-evidence-audit.md) · [实现 CR](../reviews/2026-11-22-p1-73-status-funnel-implementation-cr.md) |
| P1-72 | P1 | 行权限自动强制执行，取消运维人工证明开关 | REQ-030-093 | 行权限可用性修复 | 否 | S5｜v1.0。终稿已确权；开发授权已获得；实现与 Codex CLI 代码终审完成；功能合同已收口（定向回归286项、脚本合同97项、隔离Docker39项）；测试台 UAT-SUITE-ROW-POLICY-AUTO PASS；扩展回归与全仓门禁既有缺口单列，远端CI未执行；不入核心分母；≠ 可上线。 | [Spec](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) · [Plan](lucy-20261120-row-policy-automatic-enforcement-plan.md) · [测试台](../qa/uat/suites/row-policy-automatic-enforcement/suite.md) |
| P1-71 | P1（Deferred；下一期） | SQLite 风险防范与 PostgreSQL 迁移准备 | REQ-030-092 | 存储可靠性／可迁移性 | 否 | X_DEF｜v0.1-draft。0.30 不开发；准备材料保留在需求池作下一期开发目标。源码盘点、风险差集与 Spec／Plan／UAT 设计已落盘；终稿未确权；未获开发授权；不升级、不迁移、不操作客户实例；测试台 NOT RUN；不入核心分母；≠ 功能合同收口；≠ 可上线。 | [Spec](../specs/lucy-20261120-storage-readiness-spec.md) · [Plan](lucy-20261120-storage-readiness-plan.md) · [UAT](../qa/uat/suites/storage-readiness/suite.md) |
| P1-69 | P1（可用性差集） | MCP执行层热重载在途保护与统一截止 | REQ-030-090 | 热重载生命周期／Spec191增量 | 否 | S4｜v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 | [Spec](../specs/lucy-20261120-runtime-reload-drain-spec.md) · [Plan](lucy-20261120-runtime-reload-drain-plan.md) · [UAT](../qa/uat/suites/core-availability/suite.md) |
| P1-70 | P1（可用性差集） | 正常语义写入期间MCP读取有界等待 | REQ-030-091 | 语义发布／恢复屏障增量 | 否 | S5｜v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 | [Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md) · [Plan](lucy-20261120-semantic-read-write-settle-plan.md) · [UAT](../qa/uat/suites/core-availability/suite.md) |
| P1-68 | P1（运行观察；建议） | 运维步骤账（Lucy 运维与 IT 运维） | REQ-030-089 | 运行观察／步骤可定位 | 否 | S5｜v1.0；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。终稿已确权；开发授权已获得；实现与独立代码评审完成；本机 demo Docker 平滑升级后 UAT-SUITE-OPS-STEP R0／01–08 全真 PASS（gitSha=88b2e9ea；跑次 [2026-11-22-cursor-ops-step](../qa/uat/suites/ops-step/runs/2026-11-22-cursor-ops-step.md)）；设计值重度项写入收口范围。不入核心分母；≠ 可上线。 | [Spec](../specs/lucy-20261120-ops-step-journal-spec.md) · [Plan](lucy-20261120-ops-step-journal-plan.md) · [UAT](../qa/uat/suites/ops-step/suite.md) |
| P1-66 | P1（性能差集；建议） | Agent 名册摘要投影与单对象详情按需读取 | REQ-030-087 | P1-58 续作／治理读路径／兼容 | 否 | S5｜v0.3。委托人2026-11-20批准分批收敛及本进程commit；批次A功能合同已收口；本机Docker最小验收PASS WITH GAP；批次B暂停，原v0.2完整矩阵FAIL保留；本批增量提交；未推送／发布；不入核心分母；本批收口不表示可上线。 | [Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [Plan](lucy-20261120-agent-roster-summary-projection-plan.md) · [UAT](../qa/uat/suites/agent-roster-summary/suite.md) |
| P1-67 | P1（测试基建；建议） | 用户旅程性能门禁（API／WebUI 交互；MCP 已移交 P1-78） | REQ-030-088 | 系统性能测试／CI 门禁／部署对账 | 否 | S1｜v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan 设计；终稿未确权；开发未授权；测试台未建；不入核心分母；≠ 功能收口；≠ 可上线。 | [Spec](../specs/lucy-20261120-user-journey-performance-gate-spec.md) · [Plan](lucy-20261120-user-journey-performance-gate-plan.md) |
| P1-64 | P1（事故修复） | 同连接跨 Schema 短名冲突与保存运行时确认修复 | REQ-030-085 | 扫描生成／Manifest 上传／Source Map 编译与保存 ack | 否 | S5｜v0.4。功能合同已收口（SC-01–10通过；合并候选全库TypeScript0错误，782项Vitest及29项概念模块回归通过，真实前台浏览器计时完成）；本轮增量已提交；未推送／发布；不入核心分母；本条收口不表示可上线。 | [Spec](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md) · [Plan](lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md) · [UAT](../qa/uat/suites/source-shortname-conflict/suite.md) |
| P1-65 | P1（事故修复） | Wiki 覆盖上传采用 YAML 授权声明（差异／损坏须显式选择） | REQ-030-086 | Spec 193 §5 增量；治理主路径 | 否 | S5｜v0.2。终稿已确权；开发授权已获得；实现完成；四项验证缺口已整改；改后 Docker UAT＝PASS（见测试台 INDEX）；功能合同已收口；不入核心分母；≠ 可上线。 | [Spec](../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md) · [Plan](lucy-20261120-wiki-upload-acl-adoption-plan.md) · [UAT](../qa/uat/suites/wiki-upload-acl-adoption/suite.md) |
| P1-61 | P1（第一批；建议） | 存活／就绪探针纯内存响应与诊断隔离 | REQ-030-082 | P1-21／46 续作；功能合同 | 否 | S4｜v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-01真实停止／自动恢复局部复测PASS WITH GAP；完整F61矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 | [Spec](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) · [Plan](lucy-20261119-memory-probe-diagnostics-isolation-plan.md) · [UAT](../qa/uat/suites/core-availability/suite.md) |
| P1-62 | P1（第二批；建议） | 重任务跨模块容量控制与许可生命周期 | REQ-030-083 | 复用局部队列；功能合同 | 否 | S4｜v0.1-draft。终稿已确权（委托人 2026-11-20 明示本提示词确权）；开发授权已获得；实现已落地（本机单元与组件测试通过）；本机 Docker 局部 UAT PASS WITH GAP（仅真实导出入口；完整 F62 未完成）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 | [Spec](../specs/lucy-20261119-heavy-work-capacity-control-spec.md) · [Plan](lucy-20261119-heavy-work-capacity-control-plan.md) · [UAT](../qa/uat/suites/core-availability/suite.md) |
| P1-63 | P2（第三批；建议） | 进程关停准入关闭与在途请求排空 | REQ-030-084 | Spec 191 生命周期增量；功能合同 | 否 | S4｜v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-02 MCP在途登记／实际Node PID等待局部复测PASS WITH GAP；完整F63矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 | [Spec](../specs/lucy-20261119-process-drain-lifecycle-spec.md) · [Plan](lucy-20261119-process-drain-lifecycle-plan.md) · [UAT](../qa/uat/suites/core-availability/suite.md) |
| P1-60 | P0（问数主路径事故修复） | begin 价值重评与零绑定 MCP 问数不受影响 | REQ-030-081 | P0-1 修复／零绑定主路径／有绑定发布一致性另段 | 否（沿用 P0-1） | S5｜v0.9；功能合同已收口（SC-01–12通过，P1-60／P1-64同一冻结候选完整复验）；预算持久化锁竞争修复纳入；本轮增量已提交；未推送／发布；不入新增核心分母；本条收口不表示可上线。 | [Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md) · [Plan](lucy-20261119-webui-publish-caliber-registry-repair-plan.md) · [UAT](../qa/uat/suites/begin-zero-binding/suite.md) · [任务包](../../inbox/20261120-1037-p1-60-multi-agent-dev-pack.md) · [决议](../reviews/2026-11-20-begin-hide-decision.md) · [错题](../lessons/2026-11-19-begin-zero-binding-test-gap.md) |
| P1-58 | P1（第一批） | 角色权限与 Agent 列表读取响应、展示复用与统计减负 | REQ-030-079 | 治理主路径／性能 | 否 | S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）。证据＝batch1＋[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。测试台仍 PASS WITH GAP（仅B1）。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) · [Plan](lucy-20261119-roles-agent-read-responsiveness-plan.md) · [UAT](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) |
| P1-59 | P1（第二批） | 角色权限与 Agent 多人编辑的对象级冲突与草稿恢复 | REQ-030-080 | 治理主路径／并发正确性 | 否 | S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）。证据＝batch1＋[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。测试台仍 PASS WITH GAP（仅B1）。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md) · [Plan](lucy-20261119-roles-agent-concurrent-edit-plan.md) · [UAT](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) |
| **P0-1** | P0 | 问题类型 → 唯一表 + 固定口径绑定 | REQ-030-027 | 约束 | 是 | **v0.9；R2-F＋R3＋R4 已闭合；功能合同已收口（2026-11-13）**。SC-01–SC-30 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) · [Plan](lucy-20261107-question-type-caliber-binding-plan.md) · [评审](../reviews/2026-11-07-question-type-caliber-binding-codex-review.md) · [CR](../reviews/2026-11-08-p0-1-caliber-binding-code-review.md) · [证据审计](../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-CALIBER-BINDING`](../qa/uat/suites/question-type-caliber-binding/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| **P0-2** | P0 | Catalog 业务语义暴露 | REQ-030-023 | 约束 | 是 | **v0.6；R2-F＋R3（O1–O3）＋R4 已闭合；功能合同已收口（2026-11-13）**。SC-01–SC-17 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) · [Plan](lucy-20261107-catalog-business-semantics-plan.md) · [评审](../reviews/2026-11-08-catalog-business-semantics-codex-review.md) · [CR](../reviews/2026-11-13-p0-2-catalog-business-semantics-code-review.md) · [证据审计](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-CATALOG-SEMANTICS`](../qa/uat/suites/catalog-business-semantics/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-3** | P0 | 多表命中先问 + 表级歧义门闩 | REQ-030-024 | 约束 | 是 | **v0.5；R2-F＋R3（O1／O2／O4）＋R4 已闭合；功能合同已收口（2026-11-13）**。SC-01–SC-26 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) · [Plan](lucy-20261107-source-ambiguity-gate-plan.md) · [Codex 评审](../reviews/2026-11-08-source-ambiguity-gate-codex-review.md) · [实现复审／独立复验](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md) · [证据审计](../reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-SOURCE-AMBIGUITY`](../qa/uat/suites/source-ambiguity-gate/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-4** | P0 | 答复可核对块（来源／口径／截止期强制露出） | REQ-030-022 | 呈现 | 是 | **v0.4；R2-F＋R3＋R4 已闭合；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。vitest `answer-verifiability` 26/26。O1＝A／O2＝A。**本条收口不表示可上线** | [Spec](../specs/lucy-20261107-answer-verifiability-spec.md) · [Plan](lucy-20261107-answer-verifiability-plan.md) · [Codex 评审](../reviews/2026-11-09-answer-verifiability-codex-review.md) · [实现 CR](../reviews/2026-11-13-p0-4-answer-verifiability-code-review.md) · **测试台** [`UAT-SUITE-ANSWER-VERIFIABILITY`](../qa/uat/suites/answer-verifiability/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-5** | P0 | 空结果结构化下一步指导 | REQ-030-018 | 呈现 | 是 | **v0.8；R2-F＋R4 已闭合；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。vitest 空结果 33/33。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) · [Plan](lucy-20261107-empty-result-next-step-guidance-plan.md) · [Codex 评审](../reviews/2026-11-09-empty-result-next-step-codex-review.md) · [实现 CR](../reviews/2026-11-13-p0-5-empty-result-next-step-code-review.md) · [证据审计](../reviews/2026-11-13-empty-result-next-step-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-EMPTY-NEXT-STEP`](../qa/uat/suites/empty-result-next-step/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| **P0-6** | P0 | Eval 选表正确性 + 真实问句日跑骨架（含 019／020 **最小面**） | REQ-030-025；最小面挂 019／020 | 检出 | 是 | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O3 已闭合（2026-11-13）＝建议包 S；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口** | [Spec](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) · [Plan](lucy-20261107-eval-source-selection-correctness-plan.md) · [决策纸](../reviews/2026-11-13-p0-6-o1-o3-decision-package.md)；另 [019 Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)／[019 Plan](lucy-20261107-eval-tool-assertion-authoring-plan.md)／[020 Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)／[020 Plan](lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| **P0-7** | P0 | 存量用户体感最小仪表盘 + 主动告警 | REQ-030-026 | 运营 | 是 | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口** | [Spec](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) · [Plan](lucy-20261107-stored-user-experience-dashboard-alerts-plan.md) · [决策纸](../reviews/2026-11-13-p0-7-o1-o6-decision-package.md) |
| **P0-A** | P0 伴生 | Source 级业务字段暴露裁剪 | REQ-030-012 | 约束伴生 | 是 | **v0.7；R2-F＋R4 已闭合；功能合同已收口（2026-11-13）；实现 CR 已落盘（PASS，2026-11-13）**。SC-01–SC-30 证据关闭。本条收口不表示可上线 | [Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) · [Plan](lucy-20261107-semantic-source-field-exposure-plan.md) · [评审](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md) · [CR](../reviews/2026-11-13-p0-a-semantic-source-field-exposure-code-review.md) · [证据审计](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-FIELD-EXPOSURE`](../qa/uat/suites/semantic-source-field-exposure/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| **P0-B** | P0 伴生 | 物理新鲜度合同（答复截止期真源） | REQ-030-028 | 呈现伴生 | 是 | **v0.1-draft；O1–O3 已闭合（2026-11-13）＝建议包 F；待 R2-F；终稿未确权；冻结落地；未授权实现**。不改 P0-4 已冻结的 `not_checked`。**不是** R2-F，**不是** R4，**不可功能合同收口** | [Spec](../specs/lucy-20261109-physical-freshness-contract-spec.md) · [Plan](lucy-20261109-physical-freshness-contract-plan.md) · [决策纸](../reviews/2026-11-13-p0-b-o1-o3-decision-package.md) · [过程记录](../reviews/2026-11-09-p0-6-p0-7-p0-b-spec-advance.md) |
| P1-1 | P1 | 语义层孤儿路径治理 | REQ-030-015 | 约束深化 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；**不挡 P0** | [Spec](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md) · [Plan](lucy-20261107-semantic-orphan-path-governance-plan.md) |
| P1-2 | P1 | 行权限编译门禁 + 各面拒绝码统一 | REQ-030-013／016 | 正确性辅线 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；可与 P0 并行 | [Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) · [Plan](lucy-20261107-row-policy-compile-gate-deny-code-plan.md) |
| P1-3 | P1 | `lucy_explain_query` 诊断形状合同 | REQ-030-017 | 正确性辅线 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；冻结落地 | [Spec](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md) · [Plan](lucy-20261107-explain-diagnostic-shape-contract-plan.md) |
| P1-4 | P1 | Eval 路径断言编排（完整 WebUI 面） | REQ-030-019 | 检出完整面 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；P0-6 只用最小面 | [Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) · [Plan](lucy-20261107-eval-tool-assertion-authoring-plan.md) |
| P1-5 | P1 | 审计旅程 → Eval 草稿（完整回流） | REQ-030-020 | 检出完整面 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；P0-6 只用最小面 | [Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) · [Plan](lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| P1-6 | P1 | 失败 → 工具面／Skill 反哺队列 | REQ-030-021 | 运营深化 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；**P0 不做自动改工具面** | [Spec](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md) · [Plan](lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md) |
| P1-7 | P1 | 行权限模板展开保留 templateRefs | REQ-030-014 | 正确性辅线 | 否 | X_DEF｜遗留验收排期；须 PM 批准重开已收口 Spec | [遗留验收 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| P1-8 | P1 | 语义发布 → Eval 门禁（发布后必跑／失败阻断或告警） | REQ-030-029 | 检出闸强化 | 否 | **S1｜2026-11-08 入池**；待需求澄清与立项开 Spec；**未授权实现**；**不挡**原 P0；依赖 P0-6 日跑／发布跑骨架 | 未开（前身思路见 [2026-08-26 闭环 Plan](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)） |
| P1-9 | P1 | 质量域 safe-log → Eval 候选回流 | REQ-030-030 | 检出／运营 | 否 | **S1｜2026-11-08 入池**；挂接既有质量域 Spec（未落地）；待澄清与 0.30 跟进对齐；**未授权实现**；与 P1-5／P1-6 并列质量轴 | 既有 [safe-log-to-quality-eval Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md)（功能合同未收口）· [WO](wo-20261014-safe-log-to-quality-eval.md) |
| P1-10 | P1 | 轻量概念注册表（ontology-lite；上游合同） | REQ-030-031 | 约束深化／内容治理 | 否 | **X_DEF｜委托人结案（2026-11-13）**：本分支不做 CLI／WebUI／效果门跟进；交付只走 **P1-11 Ops MCP**；保留上游数据／语义合同。**不挡**原 P0。本条不表示可上线 | [Spec](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md) · [Plan](lucy-20261108-concept-registry-ontology-lite-plan.md) · [评审](../reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md) |
| P1-11 | P1 | 概念注册表接入 Lucy Ops 控制面 | REQ-030-032 | 配置运维／控制面 | 否 | **X_DEF｜v0.5；功能合同层已收口（SC-01–SC-22）；实现 CR 已落盘（PASS，2026-11-13）**。vitest `ops-concepts` 20/20＋`concepts:test` 29/29。**测试台 FAIL（2026-11-15）**：授权面 PASS、业务受理因代码根装配失败（GAP-UAT-P1-11-RUNTIME；伴生 **P1-27**）。**本分支概念注册表唯一产品交付面＝Ops MCP**（P1-10 CLI／WebUI 已结案不做）；本版 Ops／下版 WebUI（D2b）；**不挡**原 P0。本条不表示可上线 | [Spec](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md) · [Plan](lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md) · [Codex 评审](../reviews/2026-11-09-concept-registry-lucy-ops-control-plane-codex-review.md) · [实现 CR](../reviews/2026-11-13-p1-11-concept-registry-ops-code-review.md) · **测试台** [`UAT-SUITE-OPS-CONCEPTS`](../qa/uat/suites/ops-concepts/suite.md)（INDEX：[FAIL](../qa/uat/INDEX.md)；跑次 [2026-11-15-claude-macmini-p1-11-ops](../qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md)） |
| P1-27 | P1 | Ops 概念核心代码根与运行时装配修复 | REQ-030-048 | 配置运维／事故修复 | 否 | S5｜v0.7；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。R2-F＋R4 已闭合（2026-11-15）；开发授权已获得；实现已落地；SC-01–SC-09 通过（含 vitest、容器拆卷受理、UAT 复测）；测试台复测 PASS（cursor-p1-27-ops-retest）；GAP-UAT-P1-11-RUNTIME 已关闭；不入核心分母；≠ 可上线。**不挡**原 P0 | [Spec](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md) · [Plan](lucy-20261115-ops-concept-code-root-runtime-fix-plan.md) · **测试台** [`UAT-SUITE-OPS-CONCEPTS`](../qa/uat/suites/ops-concepts/suite.md)（INDEX：[PASS 复测](../qa/uat/INDEX.md)） |
| P1-12 | P1 | 问询预算默认阈值放宽（60 次／300s） | REQ-030-033 | 体验修调 | 否 | S5｜v1.0；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。委托人批准方案二并已实现（2026-11-11，本分支）；实现 CR 已落盘（PASS，2026-11-13）；vitest question-budget 三文件 44/44；SC-T1–T5 通过；续查仍 1 次；**不挡**原 P0；≠ 可上线／客户交付 | [Spec](../specs/lucy-20261111-question-budget-threshold-relax-spec.md) · [实现 CR](../reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md) |
| P1-13 | P1 | 发版性能基线与相对不回退（WebUI＋MCP；含 Roles 列表债） | REQ-030-034 | 发布取证／harness | 否 | **X_REL｜v0.2；R2-F＋R4；发布取证出口证据齐（SC-01–SC-16；2026-11-13）；书面登记「发布取证 acceptance 代替实现 CR」**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) · [Plan](lucy-20261113-release-perf-baseline-gate-plan.md) · [acceptance](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md) · [W1-4 A](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md) · **测试台** [`UAT-SUITE-ROLES-AGENT-PERF`](../qa/uat/suites/roles-agent-page-perf/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| P1-14 | P1 | 问询预算复盘审计字段（交付面 A） | REQ-030-035 | 运营复盘／可观测 | 否 | S5｜v1.0；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。R2-F＋R4（委托人明示 2026-11-13）；开发授权已获得；实现已落地（2026-11-13）；实现 CR 已落盘（PASS）；SC-R1–R12 自动化／夹具通过（vitest retrospective 11/11）；交付面 A；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md) · [Plan](lucy-20261113-question-budget-retrospective-audit-plan.md) · [实现 CR](../reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md) |
| P1-15 | P1 | 连接写路径 → 执行层热重载 + 成功面诚实 ack | REQ-030-036 | 连接／WebUI | 否 | S5｜功能合同已收口（2026-11-22，漏斗镜像·文档收口）。create＋C01＋live E2E／UAT-01；Edit 成功面三段事实 CLOSED；测试台＝PASS。收口范围不含可选 UAT-CONN-RELOAD-02。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md) · [父 Plan](lucy-20261112-connection-create-execution-runtime-reload-plan.md) · [B 轨](lucy-20261113-connection-reload-live-e2e-uat-plan.md) · [middev 收口](../reviews/2026-11-13-connection-reload-middev-closure.md) · **测试台** [`UAT-SUITE-CONN-RELOAD`](../qa/uat/suites/connection-runtime-reload/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| P1-16 | P1 | 库内扫表读法（Doris 外部目录 Hive + 普通 MySQL） | REQ-030-037 | 连接／事故修复 | 否 | **S5｜功能合同已收口（2026-11-13）**；SC-01–SC-14。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) · [Plan](lucy-20261111-catalog-scan-read-path-plan.md) · [证据审计](../reviews/2026-11-13-catalog-scan-read-path-sc-evidence-audit.md) · **测试台** [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| P1-17 | P1 | 访问关系图空桑基修复 | REQ-030-038 | WebUI 修复 | 否 | **S5｜CLOSED（2026-11-13）** 中间态出口。**不挡**原 P0；≠ 可上线 | [closure](../reviews/2026-11-13-access-map-sankey-empty-fix-closure.md) · [Plan](lucy-20261113-access-map-sankey-empty-fix-plan.md) |
| P1-18 | P1 | MCP 客户端 Skill 入口镜像（改挂 `/mcp`） | REQ-030-039 | 工程／接入 | 否 | **S5｜CLOSED（2026-11-13）** 中间态出口；工程向。**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) · [Plan](lucy-20261111-mcp-client-skill-endpoint-fix-plan.md) · [closure](../reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md) |
| P1-19 | P1 | 访问关系图允许词表对齐（`ok`／`allow`） | REQ-030-040 | WebUI 修复 | 否 | S5｜v0.1；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。实现已落地（2026-11-13）；vitest access-map 三文件 76/76；SC-01–SC-03 通过；**测试台已复跑 PASS（2026-11-14）**（UAT-04 关闭 F-1）；**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) · **测试台** [`UAT-SUITE-ACCESS-MAP`](../qa/uat/suites/access-map-sankey-empty/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)；跑次 [2026-11-14-claude-macmini-p119-access-map](../qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md)） |
| P1-20 | P1 | 外部目录单表读字段（直连 DESC／SHOW COLUMNS） | REQ-030-041 | 连接／事故续作 | 否 | S1｜主体 v0.2 及 §8 v0.4 已确权并实现；本轮真实 Doris→Hive 字段读取及 F02／F03 预算回归通过，指定慢语法拒绝按已授权 D5 受控降级并单列边界。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 | [Spec](../specs/lucy-20261113-external-catalog-column-read-spec.md) · [Plan](lucy-20261113-external-catalog-column-read-plan.md) · **测试台** [`UAT-SUITE-CATALOG-SCAN`](../qa/uat/suites/catalog-scan-read-path/suite.md)（INDEX：[本机 lab 判定](../qa/uat/INDEX.md)） |
| P1-21 | P1 | 重读路径与探针减负（访问日志后台重建＋健康探针拆分） | REQ-030-042 | WebUI 稳定性／事故修复 | 否 | **S5｜功能合同已收口（2026-11-13）**。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（R0／01–04）。≠ 可上线 | [Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) · [Plan](lucy-20261113-heavy-read-path-and-probe-relief-plan.md) · [性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md) · **测试台** [`UAT-SUITE-EVENT-LOOP-RELIEF`](../qa/uat/suites/event-loop-relief/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)；跑次 [2026-11-13-cursor-demo-event-loop](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)） · 错题 [2026-11-17](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) · 真实环境复测证据（2026-11-16）见变更 v0.96；**2026-11-17 客户 K8s 平滑升级失败（event loop p99≈2210ms／readyz 超时／502／503，已回滚）**见错题与 **P1-39**——不改本条收口句，证明夹具收口 ≠ 客户升级可上线。 |
| P1-31 | P1 | 全页面事件循环与探针风险排查（P1-21 全局化；逐页＋全 GET 路由） | REQ-030-052 | WebUI 稳定性／排查 | 否 | **S5｜只读排查已完成（2026-11-15），已补账本夹具并升格门禁**。补夹具后首跑 125 路由：89 通过、**9 越线／失败**（F-1…F-7）、23 未测；整改（P1-32／P1-33）落地后复跑：96 通过、**0 越线／0 失败**、25 未测；43 页：40 通过、3 未测。UAT＝[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（首跑 FAIL；整改后 **PASS WITH GAP**）。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Plan](lucy-20261115-page-by-page-event-loop-sweep-plan.md) · [排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md) |
| P1-32 | P1 | 审计导出路径规模整改（F-1 inquiry-pack 杀探针；F-6 v2 导出撞 SQLite 变量上限） | REQ-030-053 | WebUI 稳定性／审计导出 | 否 | S5｜功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。实现已落地；EQUIV-GUARD／PAGE-SWEEP PASS WITH GAP；v2／export-pack／linkedHandshakeRows／客户现场入收口范围另账。不入核心分母；≠ 可上线 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md) · [排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md) · [O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md) |
| P1-33 | P1 | 并发压测越线接口整改（F-2／F-3／F-4／F-5／F-7） | REQ-030-054 | WebUI 稳定性 | 否 | S5｜功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。与 P1-32 同 Spec；本机性能／等价证据见 INDEX；夹具盲区入收口范围。不入核心分母；≠ 可上线 | [Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md) · [排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md) · [O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md) |
| P1-34 | P1 | 大 Schema 接入（宽表与多表）：顺利接入，而不是超时报错 | REQ-030-055 | WebUI 稳定性／接入规模 | 否 | S1｜v0.2.2 主体及 LS-01–18 既有结论保留；§11 v0.5 已由委托人确认并授权实施，R1／R2 修复完成，LS-19–30 本轮本机功能验收通过。真实 MySQL 混合权限按 D5 受控降级，合法字段真实；正常规模套件本跑次通过，历史 SCALE-09 偶发超时未归因记录保留。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 | [Spec](../specs/lucy-20261115-large-schema-ingestion-spec.md) · [Plan](lucy-20261115-large-schema-ingestion-plan.md) · **测试台** [`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md)（INDEX） |
| P1-35 | P1 | 表级歧义门闩：纯 MCP 逃生与拒绝载荷持久修复（P0-3 伴生） | REQ-030-056 | 约束／事故修复 | 否 | S5｜v0.4。功能合同已收口（2026-11-22，P1-73／P1-35 S5 收口批）。ESCAPE INDEX＝PASS（含 ESC-11）；SC-E 证据＋实现 CR PASS。GAP-UAT-P0-3-ESCAPE 已关。不入核心分母。本条收口不表示可上线 | [Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) · [Plan](lucy-20261116-source-ambiguity-mcp-escape-plan.md) · [SC-E 审计](../reviews/2026-11-22-p1-35-sc-e-evidence-audit.md) · [实现 CR](../reviews/2026-11-22-p1-35-implementation-cr.md) · **测试台** [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)（INDEX：[PASS](../qa/uat/INDEX.md)） |
| P1-36 | P1 | 调用流水 trace 级可追溯与存档（span 模型；封存导出与对账） | REQ-030-057 | 审计证据／可观测 | 否 | S5｜v1.1；功能合同已收口（2026-11-22，scoped；裁定包 F-3=A／F-2=B／TRC=B）。证据＝沙箱 Tier-A＋[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261116-trace-span-ledger-spec.md) · [Plan](lucy-20261116-trace-span-ledger-plan.md) · [收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md) · **测试台** [`UAT-SUITE-TRACE-LEDGER`](../qa/uat/suites/trace-span-ledger/suite.md) |
| P1-37 | P1 | MCP 体验韧性：握手长尾、失败信息可操作、会话恢复与限流、拒绝快速返回（含观测指标：M1–M6 入出口，M7–M9 为发布后／伴生观测） | REQ-030-058 | 体验修复／可观测 | 否 | S5｜v1.1；功能合同已收口（2026-11-22，scoped；裁定包 U1=A／GAP=B）。证据＝沙箱 Tier-A＋[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md) · [Plan](lucy-20261116-mcp-ux-resilience-plan.md) · [收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md) · **测试台** [`UAT-SUITE-MCP-UX-RESILIENCE`](../qa/uat/suites/mcp-ux-resilience/suite.md) |
| P1-38 | P1 | 推断问询补算让出事件循环（分页读取、分片写入） | REQ-030-059 | WebUI 稳定性／事故修复 | 否 | S1｜主体 v0.2-draft 终稿未确权；§8 v0.4 已确权并实现，§8.9 已获委托人确认补验。SC-11–16 本轮证据补齐：完整窗口至少20万调用、三轮默认冷启动通过，含3163行原用户闭包完整收敛。P3 的 ↓ 保留，SC-16 补偿在受测范围通过；O3 存量批量标脏仍未授权。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 | [Spec](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md) · [Plan](lucy-20261117-inferred-turn-rebuild-yield-plan.md) |
| P1-39 | P1 | 客户 K8s 平滑升级：残余 event loop 卡顿导致 readyz 超时／入口 502／503 | REQ-030-060 | WebUI 稳定性／事故修复／升级 | 否 | S5｜v0.3；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。终稿已确权、开发已授权（不含 schema 变更、不含线上升级）；启动补算与稳态轮询已改为有界读取，审计库打开与迁移在 app.listen 前完成；vitest 守卫及 SC-01–SC-17 出口通过。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md) · [Plan](lucy-20261117-cold-start-audit-scan-plan.md) · [测试台](../qa/uat/suites/cold-start-slow-disk/suite.md) · 错题 [2026-11-17-k8s-upgrade-event-loop-readiness-timeout](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) · 前序 [P1-21](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) |
| P1-40 | P1 | 明文 HTTP 复制按钮假成功：共享 helper 谎报「已复制」（优先级待委托人裁定，错题标 sev-low） | REQ-030-061 | UX 缺陷／事故修复／测试台基建 | 否 | S5｜功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。修复已提交 `65f40847`；helper＋十个可点入口 REAL；收口范围不含公网 COPY-04 与 6 个 helper-only 入口（未授权）。不入核心分母；≠ 可上线 | 错题 [2026-11-17-clipboard-http-fake-success](../lessons/2026-11-17-clipboard-http-fake-success.md) · 测试台 [suite](../qa/uat/suites/copy-fake-success/suite.md) · 前序 [Spec 192](../../webui/docs/192-clipboard-non-secure-context-fallback-spec.md) |
| P1-41 | P1 | 访问关系图桑基还原：线上镜像缺修复；HEAD 在零访问／多 Agent／全未确认下仍退化 | REQ-030-062 | UX 缺陷／呈现修订／测试台基建 | 否 | S5｜v0.2；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。D0＝C；终稿由委托人明示确权；已授权并实现 A2／A3 与 Track B 方案 C，已提交。不入核心分母。≠ 可上线 | Spec [sankey-restoration](../specs/lucy-20261117-access-map-sankey-restoration-spec.md) · 错题 [2026-11-17-access-map-sankey-regression](../lessons/2026-11-17-access-map-sankey-regression.md) · 前序 [P1-17](../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md)／[P1-19](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) |
| P1-42 | P1 | 按钮级「成功反馈真实性」排查：下载／保存／导出（P1-40 同类扩展；仅按钮级） | REQ-030-063 | UX 缺陷／事故修复／测试台基建 | 否 | S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `f1436556`；lite Spec／Plan 已立；测试台仍 PASS WITH GAP。[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261122-button-feedback-honesty-spec.md) · [Plan](lucy-20261122-button-feedback-honesty-plan.md) · 错题 [2026-11-17-button-feedback-silent-failure](../lessons/2026-11-17-button-feedback-silent-failure.md) · **测试台** [`UAT-SUITE-BUTTON-FEEDBACK`](../qa/uat/suites/button-feedback/suite.md) |
| P1-43 | P1 | Lucy 不透出数据库原始错误：外部目录读字段失败时，页面无法区分握手失败、元数据服务慢、元数据服务起不来（优先级待委托人裁定） | REQ-030-064 | 可诊断性／UX 缺陷 | 否 | **S1｜v0.1-draft。仅登记，不开发。外部目录读字段失败时，Lucy 页面与接口应带出脱敏后的数据库错误类别与可展开的技术详情，使握手失败、元数据服务慢、元数据服务起不来可区分；加诊断信息不改变既有成功／失败判定，也不影响合法用户的读取主路径。本稿只含问题、方案选项、伪代码与验收草案，范围限外部目录单表读字段及复用该路径的结构差异检查；表列表读取、连接测试等其他路径未验证。终稿未确权；未获开发授权；未授权不改运行代码；测试台 not_registered；不入核心分母；≠ 可上线**。已核实：`SchemaColumnRejection` 只有 `{table, reason}` 七值枚举，Doris 原文只进容器日志；四种成因（反向解析不一致、时钟偏差、HMS 起不来、HMS 变慢）页面同文；单表读取 8 秒×三条探针＝约 24 秒。设计约束：原文须脱敏并限定可见范围；合法用户主路径不受影响 | [Spec](../specs/lucy-20261118-db-original-error-surfacing-spec.md) · 错题 [2026-11-18-db-original-error-not-surfaced](../lessons/2026-11-18-db-original-error-not-surfaced.md) · 前序 [P1-20／REQ-030-041](../lessons/2026-11-13-external-catalog-column-read-ktx-describe.md) |
| P1-44 | P1 | 页面渲染崩溃被兜底页伪装成版本问题：访问日志调用流水整页不可用；路由兜底边界捕获所有渲染错误 | REQ-030-065 | UX 缺陷／事故修复／测试台基建 | 否 | S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `c1f54f64`；lite Spec／Plan 已立；测试台仍 PASS WITH GAP（55/55；详情页另期）。[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261122-page-open-error-boundary-spec.md) · [Plan](lucy-20261122-page-open-error-boundary-plan.md) · [错题](../lessons/2026-11-18-audit-calls-render-crash-misreported.md) · **测试台** [`UAT-SUITE-PAGE-OPEN`](../qa/uat/suites/page-open-exceptions/suite.md) |
| P1-45 | P1 | 推断问询重建中断后自动恢复（前方报告 **P0-02**；硬复现） | REQ-030-066 | WebUI 稳定性／事故修复／升级 | 否 | S5｜v0.2＋P1-50 水位注记；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。终稿已确权、开发已授权；代码已实现；SC-01–SC-08 通过；测试台＝PASS（2026-11-18-cursor-irr；P1-57-G8 真实 SIGKILL 复验通过）。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) · [Plan](lucy-20261118-inferred-turn-rebuild-recovery-plan.md) · **测试台** [`UAT-SUITE-INFERRED-REBUILD-RECOVERY`](../qa/uat/suites/inferred-turn-rebuild-recovery/suite.md) · 前序 [P1-38](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md)／[P1-39](../specs/lucy-20261117-cold-start-audit-scan-spec.md) |
| P1-46 | P1 | readyz 与 MCP 监听就绪一致性（前方报告 **P0-03**；启动窗复现） | REQ-030-067 | WebUI 稳定性／事故修复／升级 | 否 | S5｜v0.2；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。终稿已确权、开发已授权；代码已实现；vitest 守卫通过；SC-01–SC-06 通过；测试台＝PASS（2026-11-18-cursor-rml）。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md) · [Plan](lucy-20261118-readyz-mcp-listen-consistency-plan.md) · **测试台** [`UAT-SUITE-READYZ-MCP-LISTEN`](../qa/uat/suites/readyz-mcp-listen/suite.md) · 前序 [P1-39](../specs/lucy-20261117-cold-start-audit-scan-spec.md) |
| P1-47 | P1 | 满量重建负载下探针预算内响应（前方报告 **P0-01**；部分复现） | REQ-030-068 | WebUI 稳定性／事故修复／升级 | 否 | S5｜v0.7；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。终稿已确权；开发授权已获得；削峰已落地（写片 2–8；`write_slice`／窗口 DELETE／PASSIVE off-thread；30 天回看不变）；SC-01–SC-10 通过；测试台＝PASS（shave2-default RPB-09＝3／3，livez max 7–17ms／p99 7–10ms；P1-57-G7／G9 测程纠正后复验通过）。暂停仍为交付安全带。不入核心分母。≠ 可上线 | [Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) · [削峰 Plan](lucy-20261119-p147-write-slice-spike-shave-plan.md) · **测试台** [`UAT-SUITE-REBUILD-PROBE-BUDGET`](../qa/uat/suites/rebuild-probe-budget/suite.md) · 错题 [2026-11-17](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) |
| P1-48 | P1 | 多步流程状态机合同门禁（Spec 文法＋`lint:spec-docs`；存量盘点指针） | REQ-030-069 | 文档治理／评审门禁 | 否 | **S1｜v0.1-draft。仅登记与起草，不开发。命中多步流程／门禁／发布／恢复语义的新 Spec（及 grandfather 取消后的存量 Spec）须声明可解析的「多步状态机合同」（状态集、合法转移、终态、非终态持久化、逃生边、禁止布尔冒充终态）；`lint:spec-docs` 在获开发授权落地后能拦住缺项；存量高风险路径盘点表只登记指针，不宣称已合规。终稿未确权；未获开发授权；未授权不改运行代码与 lint；测试台 not_registered；不入核心分母；≠ 可上线** | [Spec](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md) · [Plan](lucy-20261118-multi-step-state-machine-contract-gate-plan.md) · 前序 [交互合同门禁](../specs/lucy-20261107-ui-interaction-contract-gate-spec.md) |
| P1-49 | P1 | `lucy_ops_reader` 无头可问治理面 ACL（规范 W0 指纹 heal；demo 种子升全集） | REQ-030-070 | 运维问数／ACL／无头 MCP | 否 | **S1｜v0.1-draft。仅登记与起草，不开发。** 连接 `lucy-ops` 已启用 W0∪W1∪W2 时，对匹配「规范 W0 指纹」的正式 `lucy_ops_reader` 在 ensure 成功路径幂等扩 `names` 至冻结 sourceName 全集，使无头 MCP 可问治理面 SOP 可达；定制 Role 不覆盖；W0 主路径仍可用。推荐 D0＝方案 B。终稿未确权；未获开发授权；未授权不改运行代码；测试台 not_registered；不入核心分母；≠ 可上线 | [Spec](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md) · [Plan](lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md) · 前序 [可问治理面](../specs/lucy-20261101-ops-evidence-askable-governance-spec.md)／[客户默认系统 Role](../specs/lucy-20261105-customer-default-system-roles-spec.md) |
| P1-50 | P1 | 重建快照上界与完成水位不一致：并发新增调用未入推断却被标已覆盖（FDE R01／P0） | REQ-030-071 | WebUI 审计正确性／事故修复／打包门禁 | 否 | X_SUP｜**被取代（并入 P1-45／REQ-030-066；2026-11-22 文档收口）**。水位合同已扩注 P1-45 Spec §3.1；代码随 P1-45 Track-A 落地；P1-45 已 S5（测试台 PASS）。本行不另开独立 Spec／UAT。不入核心分母；≠ 可上线 | 前序 [P1-45](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) · [fde-pack-gate-parallel-plan](lucy-20261118-fde-pack-gate-parallel-plan.md) · FDE R01 |
| P1-51 | P1 | 版本轴分工与命名规约（候选 `rc.N` 自动分配＋交付主键＋私有化分叉追溯） | REQ-030-072 | 发版治理／交付追溯 | 否 | S1｜**v0.3-draft。仅方案落盘：不含运行代码、镜像与 CI 改动；未获开发授权；待 Codex 交叉审阅与委托人终稿确权。测试台 not_registered；不入核心分母；≠ 可上线**。合并 main＝产品线大版本；合并前＝自动 `X.Y.Z-rc.N`＋`lucy-k8s-integration-YYYYMMDD-rN`；交付仓 index／manifest／`deployPin`；运行时身份支撑私有化分叉定位。OQ-1／OQ-7 已决。**≠ S2（终稿未确权）** | [Spec](../specs/lucy-20261118-version-axis-naming-spec.md) · [Plan](lucy-20261118-version-axis-naming-plan.md) · 交付仓 [lucy-customer-delivery](https://github.com/Forrest219/lucy-customer-delivery) |
| P1-52 | P1 | 客户镜像升级可靠性分层门禁（同一 digest＋客户数据量级＋A/B 必跑＋C 按边界触发） | REQ-030-073 | 发布取证／升级可靠性／客户交付 | 否 | **S1｜v0.1-draft。仅登记与起草；终稿未确权；未获开发授权；测试台 not_registered；不入核心分母；收口终态＝X_REL（非 S5）；≠ 可上线** | [Spec](../specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md) · [Plan](lucy-20261118-customer-upgrade-reliability-gate-plan.md) · 错题 [2026-11-17](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) |
| P1-53 | P0 底线（升级放行） | MCP 升级兼容底线与全真用户旅程门禁（通用题库＋实例真实基线＋功能／权限／耗时门禁） | REQ-030-074 | 发布取证／MCP 问数／真实 Agent／升级兼容 | 否 | X_REL｜**v1.1。发布取证已收口（2026-11-22）**；四入口全真＋SC／CR PASS；INDEX PASS；GAP 关闭；不入核心分母；≠ 可上线 | [Spec](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) · [Plan](lucy-20261118-mcp-upgrade-compatibility-plan.md) · **测试台** [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md) · 错题 [表级歧义死路](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md) |
| P1-54 | P0 底线（题库＋配置合同） | MCP 升级兼容多场景题库＋CompatConfigProfile（业务／Ops／配置前置） | REQ-030-075 | 功能合同／题库／Lucy 配置／真实 Agent／Lucy Ops | 否 | S5｜**v1.1。功能合同已收口（2026-11-22，严口径）**；开发授权已获得；选项 2：03b＝scoped 行隔离成交（P1-72）；SC＋CR PASS；严口径 candidate PASS（零 new deny／零翻转／34／34／三维 PASS；[复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)）。共享测试台 INDEX **PASS**（P1-53 certifyCandidate 2026-11-22；非本条升格）。不入核心分母；≠ UAT PASS；≠ 可上线 | [Spec](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) · [Plan](lucy-20261118-mcp-upgrade-question-bank-plan.md) · 共享 **测试台** [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md) · 父合同 [P1-53](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) |
| P1-55 | P1 | FDE 3b1c62af 打包前检查本机复现 UAT（L1 原样复现＋L2 全真，逐条判定成立／不成立／无法判定） | REQ-030-076 | 测试台／发布取证 | 否 | X_DEF｜v0.3；旧候选及基线的L1复现已完成，原四基线完整L2未完成，旧复现模式历史BLOCKED保留。P1-57新修复模式原完整范围实测FAIL保留；委托人2026-11-19延期G6正式完整导出，本次客户功能测试排除此项，可按限定范围进行。真实局部结果及D5边界见跑次，本条不另授权运行代码；≠ 可上线。 | [Plan](lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md) · **测试台** [`UAT-SUITE-FDE-PACKCHECK`](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md) |
| P1-57 | P1（修复复验；正式完整导出延期） | FDE 修复复评整改：单表拒绝后的合法表续读、按进展收敛与验收补齐 | REQ-030-078 | P1-56 续作／功能修复与验收统筹 | 否 | X_DEF｜v1.2。D1–D5／Task1–7修复复验已执行，R1／R2修复，G7–G9测程缺口已补齐。委托人2026-11-19明示正式完整导出“可以先不修，未来再修”；G6该子项延期、待另行安排。原完整范围UAT实测FAIL保留；本次客户功能测试排除正式CSV／ZIP导出，可按限定范围进行，D5边界保留。D6未授权实施，本次延期仅改登记；不入核心分母；≠ 可上线。 | [整改 Plan](lucy-20261119-fde-acceptance-remediation-plan.md) · P1-34 §11／P1-38 §8／v2p5 N26 · [测试台](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md) |
| P1-56 | P1（FDE 标 P0，待复现后定级） | FDE 3b1c62af 候选缺陷补录：F01 正式导出等待追平／F02 慢合法 Hive 语法回退／F03 单表 defer 披露／F04 宽表整批 deferred 收敛／AUDIT-01 滚动窗口重复归属 | REQ-030-077 | 事故修复候选／打包门禁 | 否 | X_DEF｜v1.0 上一批实现 d8c3f097 及复评记录保留；混合权限与全局请求上限已由获授权的 P1-57 修复并复验。原完整范围FDE实测FAIL保留；委托人2026-11-19已将G6正式完整导出基线缺口延期，本次客户功能测试排除此项，可按限定范围进行，不声称导出已修复。O3仍未授权，D6未实施；≠ 可上线。 | [上一批 Plan](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md) · [后续 P1-57](lucy-20261119-fde-acceptance-remediation-plan.md) · [测试台](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md) |
| P1-30 | P1 | Wiki／Skill 真读真用＋ACL UAT（测试台合同；防假通） | REQ-030-051 | 测试台／正确性辅线 | 否 | **X_REL｜PASS WITH GAP（2026-11-15 首跑）**。必做 R0／R0-SEED／WIKI-01…04／SKILL-01…04 PASS；WIKI-01S **BLOCKED**（GAP-2）。双宿主 Claude Code CLI＋Cursor Agent CLI。**不入核心分母**；≠ 可上线 | [设计](../design/design-2026-11-15-uat-context-content-wiki-skill.md) · [落地 Plan](lucy-20261115-uat-context-content-landing-plan.md) · **测试台** [`UAT-SUITE-CONTEXT-CONTENT`](../qa/uat/suites/context-content/suite.md)（INDEX：[PASS WITH GAP](../qa/uat/INDEX.md)） |
| P1-22 | P1 | Doris／SelectDB 多版本对比环境（2.0.14 基线 vs 4.0.8；高频分析路径回归＋版本探测） | REQ-030-043 | 连接／发布取证 | 否 | S1｜**入池（2026-11-14）**。立项＋**测试环境搭建授权**（范围仅对比环境、版本探测与证据）；**不含**适配代码改动（改代码须另行终稿确权＋开发授权）。Spec／Plan **待补**＝无功能合同终稿可确权。**≠ S2**（环境授权≠终稿确权）。行权限 Doris 专项验证暂缓；客户 SelectDB 版本串暂缺；UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | 待补（与 P2-5 `升级候选验证环境` 相邻但对象不同：本条是数据库引擎版本，P2-5 是 Lucy 升级候选） |
| P1-23 | P1 | UI/UX 标准收敛并与 DEVELOPMENT 绑定（设计系统 `webui/docs/design-system/` 清账、补缺章、DEVELOPMENT 总入口表） | REQ-030-044 | 文档治理 | 否 | **S1｜入池（2026-11-14）**。委托人批准：只读核对（已出报告）＋登记＋清理 `99-governance.md` 临时决策。**范围仅文档**；补缺章、改 DEVELOPMENT 总入口、新增 lint 门禁须各自另获委托人确认；不含运行代码。UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [核对报告](../../inbox/20261114-0130-uiux-standard-audit.md)（临时文件，定稿后迁入 `docs/reviews/`） |
| P1-24 | P1 | WebUI 存量 UI/UX 整改（逐页；UXR-01–09，批次 B1–B4） | REQ-030-045 | WebUI 整改 | 否 | **S1｜入池／立项（2026-11-14），Spec／Plan v0.2-draft（已含浏览器盘点）待委托人确认范围、批次与 D-1–D-4**。**不含开发授权，本阶段只做优化方案**：各批改运行代码须各自入子 Plan、终稿确权、委托人另发开发授权。UAT not_registered。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [Spec](../specs/lucy-20261114-webui-uiux-remediation-spec.md) |
| P1-25 | P1 | 行权限能力评审（100 用户／30–40 人行级受限目标） | REQ-030-046 | 评审／正确性辅线 | 否 | **S1｜评审报告 v1.0 已出（2026-11-14），待委托人裁决**。结论：安全内核实测成立；默认部署不可用（proven 全局开关）、BY-01／BY-18 回归为红、取值无校验、受限用户工具面缩水，提出 P0 四项建议。**仅评审，不含开发授权**；不改 P1-2／P1-7 及已收口 Spec 状态。场景验收见 **P1-28**。**不入核心分母**；**不挡**原 P0；≠ 可上线 | [评审报告](../reviews/2026-11-14-row-policy-capability-assessment.md) |
| P1-28 | P1 | 行级隔离场景（十几人 × 一批表 × 不同行范围） | REQ-030-049 | 正确性／核心分母 | 是 | **S5｜测试台 PASS（2026-11-22）**；合同解耦 ROW-07；无独立 Spec。ROW-07 单列归 P1-29。≠ 可上线 | **测试台** [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md)（INDEX＝PASS） |
| P1-29 | P1（Deferred；下一期） | 行级取值存在性校验 | REQ-030-050 | 正确性缺口 | 否 | **X_DEF｜Deferred；下一期**。委托人 2026-11-22：「放在需求池，下一次迭代在优化」。0.30 不开发；缺口仍开（UAT-ROW-07 预期 FAIL／`GAP-UAT-P1-28-VALUE`）；无实现 Spec；未授权实现；**不挡** P1-28 套件 PASS；不入核心分母；≠ 可上线 | **测试台** [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md)（ROW-07） |
| P2-1 | P2 辅线 | 发布工作台分文件勾选发布 | REQ-030-001 | UX 辅线 | 否 | S1｜草案齐；批次 R1 已修订；**终稿未确权**；**不定义 0.30 成败** | [Spec](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md) · [Plan](lucy-20261107-publish-workbench-per-file-selection-plan.md) |
| P2-2 | P2 辅线 | 帮助中心体验 | REQ-030-002 | UX 辅线 | 否 | **X_DEF｜Deferred；2026-11-16 委托人选方案 B**——保持 P2；开线时门户／快速入门必须深链手册「直连 vs Lucy」+「语义配置杠杆」（D15／SC-21）。**2026-11-19 委托人修正对标对象**为 `https://www.kimi.com/code/docs/`（＋第二参考站 KTX Quickstart）；新增 D16／D18 与 SC-22／SC-23；旧对标 `https://www.kimi.com/help` 降为历史记录。**同日委托人裁决 D17**＝帮助首页采用概览内容页形态（门户网格与封面图退出本条），并明示**纳入 D19 错误参考章 ＋ D20 未覆盖位置逃逸出口**（SC-24／SC-25）。**再同日明示 MD 标配**（D21：复制 Markdown 成为标准动作、解除 D6 整本限制；SC-26，出口扩到 SC-01–SC-26）。Spec／Plan **v0.5-draft**；**终稿未确权；未授权实现**；**不入核心分母**；≠ 可上线 | [Spec](../specs/lucy-20261031-help-center-experience-spec.md) · [Plan](lucy-20261031-help-center-experience-plan.md) |
| P2-3 | P2 辅线 | 运维控制面 W-B（语义发布） | REQ-030-004 | 运维辅线 | 否 | X_DEF｜Deferred；阻塞条件见既有 Spec | 既有 Spec |
| P2-4 | P2 取证 | 客户升级 E2E 自动化 | REQ-030-005 | 发布取证 | 否 | X_DEF｜Deferred；不进产品闭口分母 | 既有 Spec |
| P2-5 | P2 取证 | 升级候选验证环境 | REQ-030-006 | 发布取证 | 否 | X_DEF｜Deferred；不进产品闭口分母 | 既有 Spec |
| P2-6 | P2 工程 | E2E 主线与旁线优化 | REQ-030-007 | harness | 否 | X_DEF｜Deferred；工程向 | 既有 Spec |
| P2-7 | P2 验收 | 访问关系图 Spec 187 验收矩阵 | REQ-030-008 | 遗留验收 | 否 | X_DEF｜已排期遗留验收 Plan | [遗留验收 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| P2-8 | P2 验收 | OIDC 功能合同验收 | REQ-030-009 | 遗留验收 | 否 | X_DEF｜已排期遗留验收 Plan | 同上 |
| P2-9 | P2 验收 | 语义整批恢复 SRR 验收 | REQ-030-010 | 遗留验收 | 否 | X_DEF｜已排期遗留验收 Plan | 同上 |
| P2-10 | P2 验收 | 运维控制面 W-A VOPS 验收 | REQ-030-011 | 遗留验收 | 否 | X_DEF｜已排期遗留验收 Plan | 同上 |
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
- **跟进**：Spec／Plan **v0.5**；R2-F＋R3＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-01–SC-26 证据关闭（见 [证据审计](../reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md)）。残余 SUGGEST ASK_FIRST 双写不挡收口。本条收口不表示可上线。**可用性续作**见 **P1-35／REQ-030-056**（纯 MCP 逃生；不回写本条已收口出口句为「已可用」）。
- **不做**：只改 instructions、不加运行时门禁。

### P1-35｜表级歧义门闩纯 MCP 逃生（REQ-030-056）

- **出口**：钉选唯一可见 Source Identity 可成交；拒绝载荷无假 Schema 刷屏；`UAT-SAG-ESC-01` 翻绿；不以 kill switch 结案。
- **跟进**：S5｜v0.4。功能合同已收口（2026-11-22，P1-73／P1-35 S5 收口批）。ESCAPE INDEX＝PASS（含 ESC-11）；SC-E 证据＋实现 CR PASS。GAP-UAT-P0-3-ESCAPE 已关。**不入核心分母**。本条收口不表示可上线。
- **不做**：全面关闭门闩；削弱 person 宿主 confirm 安全门。

### P1-36｜调用流水 trace 级可追溯与存档（REQ-030-057）

- **出口**：迁移后每条**已落库**的调用流水行（含协议与 wiki）有 `trace_id` 与阶段记录（入口完整性归 S02，本条只在健康测试流量中检出漏记）；流水行与阶段记录同事务；封存包带 `spans.csv` 并可对账（scoped：诊断包即可）；协议与 wiki 主状态不再大面积 `unknown`；审计库不存内网地址与存储路径；热路径开销在门槛内。
- **跟进**：S5｜v1.1；功能合同已收口（2026-11-22，scoped；裁定包 F-3=A／F-2=B／TRC=B）。证据＝沙箱 Tier-A＋[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。**不入核心分母**。本条收口不表示可上线。
- **不做**：防篡改链与外送（第 2、3 层）；历史行回写；采样；正式 `mode=complete`／F-02；TRC-07／08／09。

### P1-37｜MCP 体验韧性（REQ-030-058）

- **出口**：握手稳态 P50 ≤ 200 ms／P99 ≤ 2 s；未知工具名与入参错误给可操作信息；会话失效自动恢复（U3a；持续失效短路 U3b 已移出出口）；拒绝类请求快速返回；合法主路径不退化；M1–M6 取数口径入出口（M7–M9 为发布后／伴生观测）。U1＝描述索引文件指纹缓存。
- **跟进**：S5｜v1.1；功能合同已收口（2026-11-22，scoped；裁定包 U1=A／GAP=B）。证据＝沙箱 Tier-A＋[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。**不入核心分母**。本条收口不表示可上线。
- **不做**：门闩判定改写（P1-35）；解冻 P0-7；U5–U8；改 KTX 源码；MCPX-02／05／06／08 残余缺口补齐；客户现场 >30s 根因复验。

### P1-38｜推断问询补算让出事件循环（REQ-030-059）

- **出口**：单个用户的近 30 天补算按 400 行一页读取、按 25 个问询一片写入，片间让出事件循环；问询编号与聚类与一次算完相同。
- **跟进**：**v0.2-draft。推断问询补算按 400 行一页读取、按 25 个问询一片写入。读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前各让出一次事件循环，已排队的宏任务先于下一段同步工作运行。本次读取冻结到开始时该用户回看窗口内的最大 access_log.id。问询编号在该删除事务内按簇顺序分配，已有 correlation_key 沿用。来源查询按 500 个 id 一段。重算先按即将写入的 inferred_turn_id 删除残留行。补算期间再次标脏的用户留到下一轮。400 行和 25 簇是条数上界，单段仍可能超过探针的 3 秒。工作区已有实现与 vitest。终稿未确权。测试台 not_registered。不入核心分母。≠ 可上线**。
- **不做**：加长探针超时；默认引入 worker；把客户现场复测写进本条出口。

### P0-4｜答复可核对（REQ-030-022）

- **出口**：纳入路径成功 `lucy_query` 强制带 `answer_verifiability`（来源／口径／截止期披露）；首期截止期诚实 `not_checked`（物理真源见 P0-B）。
- **跟进**：Spec／Plan **v0.4**；R2-F＋R3＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-16／17／21／22 夹具证据已补全。O1＝A／O2＝A。截止期真源见 P0-B（v0.1-draft，未授权，不得回写本条 cutoff）。本条收口不表示可上线。
- **可信证据吸收（2026-11-15）**：分轨证据／`not_checked` 诚实披露原则见 [split A2](lucy-20261115-trust-evidence-capability-split.md)；**不回写**已冻 cutoff。路径覆盖（certified_route／report_template）等续作 → [REQ-TE-001](lucy-20261115-post-030-trust-evidence-requirement-pool.md)，不得静默扩已收口出口。
- **不做**：重造 provenance 同义结构；静默成功无块；未授权前接真实 freshness；默认不做 WebUI 核对页（O1）。

### P0-5｜空结果下一步（REQ-030-018）

- **出口**：`lucy_query` 严格 0 行 → 结构化 `next_step`（已存在承载位一致；模型可读 MCP content）。
- **跟进**：Spec／Plan **v0.8**；R2-F＋R4 已闭合；**功能合同已收口（2026-11-13）**；SC-01–SC-30 证据关闭。D1＝结构化、D2＝只提示不阻断、**D3＝A**；与 P0-4 共存合同已齐。本条收口不表示可上线。
- **可信证据吸收（2026-11-15）**：「只揭示不拦截」与 D2 对齐，见 [split A3](lucy-20261115-trust-evidence-capability-split.md)；不因本裁决新增质量阻断。

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
- **可信证据吸收（2026-11-15）**：物理真源／`not_checked`≠正常／禁语义 mtime 冒充见 [split A1](lucy-20261115-trust-evidence-capability-split.md)。监控型管道失败揭示整包 → [REQ-TE-003](lucy-20261115-post-030-trust-evidence-requirement-pool.md)，不塞进本条未授权出口。
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
- **跟进**：S5｜功能合同已收口（2026-11-22，漏斗镜像·文档收口）。create＋C01＋live E2E／UAT-01；Edit 三段事实 CLOSED；测试台 `UAT-SUITE-CONN-RELOAD`＝PASS。收口范围不含可选 UAT-CONN-RELOAD-02。≠ 可上线。

### P1-16｜库内扫表读法（REQ-030-037）

- **出口**：Doris／SelectDB 外部目录（`catalog.database`／Hive 类连接）列库／列表走直连 `SHOW`；普通 MySQL 准备表结构一次读完 `information_schema.columns`。
- **关系**：**不入核心分母**（事故修复）；**不挡**原 P0；直接影响连接配置用户。
- **跟进**：功能合同已收口（2026-11-13）；SC-01–SC-14。字段侧续作见 **P1-20**。

### P1-20｜外部目录单表读字段（REQ-030-041）

- **出口**：外部目录准备表结构**选中单表**时，字段经直连 `DESC` → `SHOW COLUMNS` → `DESCRIBE` 读出；不再经 `ktx sql`。
- **关系**：**不入核心分母**（P1-16 续作）；**不挡**原 P0。
- **跟进**：开发授权已获得（2026-11-13，委托人同句「批准修复」）；实现已落地（2026-11-13）；EC-01–EC-13；**本机 lab live PASS（2026-11-19 复跑 `3b1c62af`：EXT-03-DUAL＋EXT-05）**。出补丁镜像须另行授权。

### P1-21｜重读路径与探针减负（REQ-030-042）

- **出口**：推断问询重建、审计投影追赶移到后台分片；问询补充字段批量查询；`/api/diff` 一次扫描；探针拆 `/api/livez`／`/api/readyz`，Chart 默认改挂。客户规模下 `/turns?hours=168` p95 ≤ 3s、`/api/livez` max ≤ 1s、概览 BUSY＝0；接口返回与改前一致。
- **关系**：**不入核心分母**（事故修复，客户实例 0.25.0 即存在，非 0.30 回归）；**不挡**原 P0。
- **跟进**：功能合同已收口（2026-11-13）。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（R0／01–04）。≠ 可上线。现场临时缓解见 Spec §8。持续看守见该套件。**2026-11-17**：客户 K8s 平滑升级仍因残余 event loop 失败并回滚——证据与续作见 **P1-39**／错题，**不改本条收口句**。

### P1-39｜客户 K8s 升级残余 event loop／readyz 超时（REQ-030-060）

- **出口**：Spec SC-01–SC-17 与本机 Docker 慢盘冷启动 UAT-COLD-R0／01–05。UAT-COLD-06 属发布取证的现场校准，仅在明确要求该项时执行。
- **事实**：2026-11-17 `lucyadm.matrixback.com` 升 0.30.0（`abb389133356`）→ p99≈2210ms、readyz 超时摘端点、502／503、已回滚；KTX 仍 healthy。
- **根因（本机受控限速复现；非客户现场直接证据）**：同一份 20 万行／883MB 旧 schema 审计库；基线＝客户上一次平滑升级 `20261111-r1`＝0.25.0／`9c78b0e3`。正常盘两版均可启动；**慢盘（读写 30MB/s、读 300／写 100 IOPS）＋冷页缓存：0.25.0 33s 健康，0.30.0 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT` 退出码 1**；库先迁移完再上慢盘仍崩。元凶＝`211f2d64` 新增 `webui/server/admin/inferred-turn-maintainer.ts` 启动 `scanFull`（`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`＝`SCAN … USING COVERING INDEX idx_al_user_ts`，同步，慢冷盘 12.4s）；`abb38913` 每 10s 轮询 `ts > ? OR (ts = ? AND id > ?)` 同为全索引扫描，代价随全部历史行数线性增长。**已排除**：握手路径（`be34e05a` 比基线快 12 倍）、宽目录、低 CPU（0.5 核）、升级时一次性建索引、云端 `abb38913` 稳态。**HEAD 现状**：`79db4352` 把轮询改成 `id > ? DISTINCT`，**计划仍是整条索引全扫描**（SQLite 3.53.2 实测，去掉 `DISTINCT` 才走主键范围）；`scanFull` 未改。**HEAD `7b882c7c` 在同一台限速冷启动台上实测仍 `FST_ERR_HOOK_TIMEOUT` 崩溃**。另有 `getDb()` 每次打开跑 `PRAGMA foreign_key_check`，代价未量化。
- **关系**：P1-21／31／32／33 的**客户升级实锤残余**；与 P1-38（`79db4352` 补算切片）同属推断问询维护器线，**P1-38 不覆盖启动 `scanFull`**；**不入核心分母**；**不挡**原 P0。
- **跟进**：**v1.25：终稿确权＋开发授权（不含 schema 变更、不含线上升级），已实现于工作树；v1.34：P1-45／47 落地后复跑冷启动全套 PASS（R0／01–05，03／04 由 FAIL 转 PASS）**——见 [Spec v0.3](../specs/lucy-20261117-cold-start-audit-scan-spec.md)、[Plan](lucy-20261117-cold-start-audit-scan-plan.md)、[最新跑次](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-p145-p147.md)。事故形态已修（不崩、稳态不卡、重启不卡、主路径可用）；02 门槛已放宽（Spec OQ-2）并 PASS。≠ 可上线
- 〔v1.24 历史〕**Spec／Plan／测试台已起草（v1.24）**——[Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md)、[Plan](lucy-20261117-cold-start-audit-scan-plan.md)、[测试台](../qa/uat/suites/cold-start-slow-disk/suite.md)。方向：启动补算逐用户探测、轮询去 `DISTINCT` 走 `id` 水位范围、审计库打开与迁移移到 `app.listen` 之前、启动只补算有未覆盖新行的用户、补算分页按时间预算收敛、慢盘冷启动门禁。**终稿未确权，开发未授权，未授权不改运行代码**。待取客户侧证据：容器内 `dd … oflag=dsync` fsync 延迟、`audit.sqlite*` 三文件大小、故障 Pod 启动五分钟日志（UAT-COLD-06）。≠ 立项完成；≠ 可上线。

### P1-40｜明文 HTTP 复制按钮假成功（REQ-030-061）

- **出口**：非安全上下文下，全部复制入口要么真写入剪贴板，要么明确提示失败；不得出现「已复制」而剪贴板未变。出口只认测试台 `UAT-SUITE-COPY-FAKE-SUCCESS` 的 01／02 全部 `REAL`。
- **事实**：2026-11-17 公网演示 `http://124.222.172.229:5174/admin/version` 用户多次点复制均无效；本机局域网 IP 复现。`execCommand("copy")` 返回 true、选区为空串、粘贴读回仍是旧内容。15 个调用点／13 个文件共享同一 helper。现有单测与 e2e 都 stub 了 `execCommand` 或跑在回环，故一直绿。
- **已落（测试台与门禁，非运行代码）**：套件 [copy-fake-success](../qa/uat/suites/copy-fake-success/suite.md)；探针 `scripts/uat/copy-button-fake-success-probe.mjs`；登记表 `webui/scripts/copy-surfaces.manifest.json`；门禁 `webui/scripts/lint-copy-surfaces.mjs`（新增复制入口不登记即红灯，绕过 helper 直用 `navigator.clipboard`／`execCommand` 即红灯）。
- **关系**：Spec 192 AC-04／AC-05「禁止谎报成功」未被实现满足；**不入核心分母**；**不挡**原 P0。
- **跟进**：委托人 2026-11-17「授权修复」「批准优化」；**修复已提交 `65f40847`**（`clipboard.ts`＋`clipboard.test.tsx`＋Spec 192 §13.5），测试台加固后 **PASS WITH GAP**（`npm run uat:copy-probe`）。待办：公网实例升级后跑 UAT-COPY-04；6 个不可达 helper-only 入口另批后补点；e2e 打桩不作 UAT 证据。登记 ≠ 可上线。

### P1-41｜访问关系图桑基还原（REQ-030-062）

- **出口**：Track A 修复线上缺修复＋HEAD 三类退化；Track B（D0＝C）恢复授权面＋访问面的桑基意图。出口只认测试台 `UAT-SUITE-ACCESS-MAP-SANKEY` 必做全绿，线上另跑 SANKEY-07。
- **事实**：线上 health `gitSha=6d2664b3`，`lucyVersion=0.25.0`；沙箱 A/B 同数据：旧码 `accessPaths=0／deniedCalls=175`，HEAD `20／2`。HEAD 仍有：`grants-only` 0 流带；`dense` 77 柱 76 个高度为 0、SVG 高 1350 无上限；`candidate-only` 175 次调用被静默吞掉。
- **关系**：P1-17／P1-19 的后续；上一轮合同接受「零访问只剩骨干发丝」，与本条设计意图冲突，故需 D0。**不入核心分母**；**不挡**原 P0。
- **跟进**：D0＝C；开发授权已获得（不含线上升级）；实现已提交。产品侧必做通过，SANKEY-06 沿用旧码基线；SANKEY-07 归发布取证。登记 ≠ 可上线。

### P1-42｜按钮级「成功反馈真实性」排查：下载／保存／导出（REQ-030-063）

- **出口**：下载、保存、导出类按钮，界面给出的成功反馈（Toast、状态文案、按钮态）都以动作的可观察结果为前提；失败时明确提示失败，不静默、不提示成功。
- **范围边界**：只查**按钮级反馈与真实结果是否一致**——下载：浏览器是否真收到文件（有文件、非空、文件名对）；保存：请求是否真成功、写入类是否读取 `runtimeAck`（Spec 14 §0.3）才提示成功；失败是否诚实。**不查**导出内容对错、字段完整性、业务逻辑、性能、移动端。
- **授权**：委托人 2026-11-17 授权 C 档（盘查＋修复＋机制）；UAT 失败场景只用真实失败（权限不足、非法输入、真实 4xx），做不到标 NOT-RUN，网络层故障注入只放单测。
- **关系**：P1-40 同类扩展；**不入核心分母**；**不挡**原 P0。
- **跟进**：S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `f1436556`；lite Spec／Plan 已立；测试台仍 PASS WITH GAP。本条收口不表示可上线。

### P1-43｜Lucy 不透出数据库原始错误（REQ-030-064）

- **出口（待定稿）**：外部目录等读取路径失败时，用户（至少管理员）能在页面上看到**脱敏后的原始错误或错误类别**，足以区分握手失败、元数据服务慢、元数据服务起不来，而不必登录容器翻日志。
- **事实**：`SchemaColumnRejection` 仅 `{table, reason}`；Doris 原文只经 `logSchemaStructureFailure` 写容器日志；四种不同成因在页面同为「没有读到字段」；单表读取 8 秒×三条探针＝约 24 秒；单表路径超时文案走不到。证据见错题。
- **范围边界**：目前**仅核实**外部目录单表读字段（`readCatalogTableColumns`）及复用同一路径的结构差异检查。其他读取路径（表列表、连接测试等）**未验证**，核实前不得写入范围。
- **设计约束**：原文须脱敏（内网主机名、SQL、Kerberos principal）并定可见范围；加诊断信息不得改变成功／失败判定；合法用户主路径不受影响（主路径可用性优先）。
- **关系**：前序 P1-20／REQ-030-041、P1-16／REQ-030-037；与客户 `hive_jd` 排障同源，但**本条不是 `hive_jd` 根因结论**。**不入核心分母**；**不挡**原 P0。
- **跟进**：委托人 2026-11-18「先登记 spec 即可，不开发」。Spec [v0.1-draft](../specs/lucy-20261118-db-original-error-surfacing-spec.md) 已登记，开放项 OQ-1 至 OQ-6 待委托人决策；终稿确权与开发授权另发。

### P1-44｜页面渲染崩溃被兜底页伪装成版本问题（REQ-030-065）

- **出口**：侧栏每个二级入口与每个页签都能打开（无未捕获异常、无路由兜底边界、有标题或正文、页面 `/api` 无 5xx）；普通渲染异常显示「本页出错」并给出错误类别，只有 chunk 加载失败才显示「版本已更新」文案。
- **事实**：`GET /api/admin/audit` 按 SC-21 把 `auth_failure` 行合进调用流水，这些行无 `tool`，前端故事线 `tool.startsWith` 崩溃；`RouteChunkBoundary` 捕获所有渲染错误并固定显示版本文案，重试是刷新，对这类 bug 无效。`release-ux` 结构套件的错误判定不含该文案，且已标注未复跑；`UAT-SUITE-PAGE-SWEEP` 不渲染页面。证据见错题。
- **范围边界**：修复只动调用流水的 `auth_failure` 渲染、故事线空值防护与路由兜底边界的分流；不改其它页面内容、不改接口、不改历史数据。
- **设计约束**：兜底页不得把普通渲染错误包装成版本文案；原始错误细节只给错误类别，不透出堆栈或内网信息。
- **关系**：与 P1-43（错误不透出）同属「错误被吞或误导」一类，但本条是渲染崩溃；与 P1-40／P1-42 同属 UX 事故修复＋测试台看守。**不入核心分母**；**不挡**原 P0。
- **跟进**：S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `c1f54f64`；lite Spec／Plan 已立；测试台仍 PASS WITH GAP（55/55；PO-03 另期）。本条收口不表示可上线。

### P1-45｜推断问询重建中断后自动恢复（REQ-030-066；前方 P0-02）

- **出口**：任意提交边界中断后，重启扫描自动补算至完整；残缺结果不得判为已覆盖；完整成功且无新日志时不因 15 分钟余量空转全量重建。
- **事实**：先删后分片写；前方硬复现 2986→610；P1-50／FDE R01 水位改为读快照 `ceilingId`（§3.1）。
- **关系**：承接 P1-38／P1-39 未覆盖的恢复合同；**P1-50 已并入本条（X_SUP）**。**不入核心分母**；**不挡**原问数 P0。
- **跟进**：S5｜v0.2＋P1-50 水位注记；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。SC-01–SC-08；测试台 PASS。≠ 可上线。

### P1-50｜重建快照上界与完成水位（REQ-030-071；FDE R01）

- **出口（并入）**：读页冻结 `ceilingId`；完成水位与 `covered()` 按同一 id；重建中 `id>ceiling` 不得被 ts 水位误判已覆盖。
- **关系**：**X_SUP｜被取代（并入 P1-45）**；合同落点＝P1-45 Spec §3.1；不另开独立 Spec／UAT。
- **跟进**：2026-11-22 文档收口；随 P1-45 S5 闭合。≠ 可上线。

### P1-46｜readyz 与 MCP 监听就绪一致性（REQ-030-067；前方 P0-03）

- **出口**：首次 `readyz` 200 时 MCP `initialize` 必成功；不以稍后重试关单。
- **事实**：`markWebuiWarmupComplete` 在 `app.listen` 后、`proxy.listen` 前；前方启动窗复现 hang up／502。
- **关系**：与 P1-39 启动顺序配套；不解释稳态网关 502。**不入核心分母**。
- **跟进**：Spec v0.1-draft；测试台 NOT RUN；**未授权开发**。

### P1-47｜满量重建探针预算（REQ-030-068；前方 P0-01）

- **出口**：满量／慢盘工况下稳态探针达门槛；客户 3s 观察器连续失败 &lt; 6；不得靠放宽超时或缩数据关单。
- **事实**：前置 DELETE＋全量编号分配仍同步；前方 F 部分复现 1×3004ms。
- **关系**：单独立项承接 P1-39「剩余手段」；与 P1-45 水位方案协调。**不入核心分母**。
- **跟进**：Spec v0.1-draft；测试台 NOT RUN；**未授权开发**。

### P1-48｜多步流程状态机合同门禁（REQ-030-069）

- **出口**：触发且无豁免的 Spec 缺可解析「多步状态机合同」时，`lint:spec-docs`（规则草案 `state-machine-contract`）失败；夹具覆盖 SC-01–SC-12；落地 diff 不进业务运行时代码；附录盘点≠已合规。
- **事实**：未显式状态机时出现布尔冒充终态、非终态不落库、两套规则并行、无逃生死路、组级「一败一成」等模式（证据见 Spec §1 指针）。
- **关系**：治理门禁，形态对齐交互合同门禁；业务路径整改须另立行。**不入核心分母**。
- **跟进**：Spec／Plan v0.1-draft；测试台 not_registered；**终稿未确权；未授权开发（含未授权改 lint）**。

### P1-79｜长追问题组（性能专用）（REQ-030-100）
- **出口**：提供可机检的长追问题组——首轮之后 ≥20 次语义承接的追问、每轮独立 oracle、单进程同会话可校验，独立 `packDigest`；供 P1-78 的 `LONG_FOLLOW` 直接消费。验收挂消费方 [`UAT-SUITE-MCP-INQUIRY-PERF`](../qa/uat/suites/mcp-inquiry-performance/suite.md) 的 `UAT-MIP-15` 与本条自检。
- **关系**：语义继承 P1-54，独立题组包与独立 digest，**不改 P1-54 题库、不改 P1-53 证据**；题组缺失或 digest 不符时 P1-78 的 `LONG_FOLLOW` 记 BLOCKED。**不入核心分母**。
### P1-78｜MCP 问询端到端性能基准与持续门禁（REQ-030-099）
- **出口**：真实 Agent 自然提问到正确完整答复的全链路测量、按场景版本化基线、绝对预算与相对回退判定、原始证据和持续门禁形成同一合同；持续压力（50 身份／≥1800 秒）与长追问（≥10% 场景实例／单进程 ≥20 轮）同为正式分母；基线缺值、样本不足、环境不可比、错误／超时剔除或仅握手无答复均不得 PASS。验收挂 [`UAT-SUITE-MCP-INQUIRY-PERF`](../qa/uat/suites/mcp-inquiry-performance/suite.md)。
- **事实**：P1-53 当前 capture 将相对基线所需数值写为 `null`，MCP 样本按整套聚合并统一走 `simple`；P1-67 的 MCP 全链路门禁仍是草案，现有局部优化不能替代用户完整答复墙钟；P1-54 现有追问链为 3 轮量级（长链由 P1-79 承载），50 路压测身份与持续压力下限已登记进全局规模基线 §1.1 MCP-PERF profile（机器断言扩展待授权）。
- **关系**：本条只做测量与判定，不改产品优化代码。**题目语义取自 P1-54，≥20 轮长链取自 P1-79，初始化数据取自全局规模基线（含 §1.1 MCP-PERF profile 与三个 seed 入口）与 P1-34，本条不自制题目、造数脚本或第二套规模数字，依赖缺失记 BLOCKED。**P1-67 保留 API／WebUI／部署对账；P1-53 保留功能兼容分母，后续性能轴消费本条统一结果；P1-13 保留低层热路径微基准；P1-37／75／77 等优化条目以本条作改前／改后对照。独立 P0 发布底线，**不改变 0.30 既有核心分母**。
### P1-77｜数据问答默认主动采用业务上下文（REQ-030-098）

- **出口**：按 Spec SC-01–08 验证双指引、按需读取、部分作答，以及整题速度和 50 路同窗可用性。验收挂 [`UAT-SUITE-CONTEXT-CONTENT`](../qa/uat/suites/context-content/suite.md#默认使用业务上下文)。
- **事实**：用户反馈默认只取语义。2026-11-23 KSCC 自然题复现「需提示才可用」，Kimi 跑次为诊断对照。指导措辞、宿主和工具接入分别留待归因。
- **关系**：以 P1-75 单独通过的候选为性能 A；动态和基础指引共用静态规则，检索按题触发。**不入核心分母**。
- **跟进**：S2｜v1.1 合同修订已获批准，待开发授权。见 [配对 Plan](lucy-20261123-default-business-context-adoption-plan.md)。

### P1-76｜YAML 产物禁 alias 治理（REQ-030-097）

- **出口**：仓库内一切 YAML 产物无 anchor／alias；统一写出口默认 `aliasDuplicateObjects: false`；静态门禁拦新增。验收 SC-01–SC-05（单测＋门禁跑次＋一次真实 KTX 对照验证）。
- **事实**：2026-11-23 另一 Agent 合成 manifest 复用列定义 → `yaml.stringify` 出 149 别名 → KTX（`yaml` 默认 `maxAliasCount=100`）拒读，容器内已实证。Lucy 服务端约 10 处 `stringify` 写盘点无防护，靠约定性安全。
- **关系**：工程约束／缺陷修复级加固；不改 KTX 源码、不放宽读取侧；造数三件套（字符串模板）无风险不在范围。**不入核心分母**。
- **跟进**：Spec／Plan **v0.1（S4）**；终稿已确权（委托人 2026-11-23 明示）；开发授权已获得；实现已落地（统一写出口＋15 处调用点替换＋静态门禁）；SC-01–SC-04 已验证、SC-05 随本次登记闭环；待委托人验收，未做功能合同收口。

### P1-73｜Spec 开发台状态治理（REQ-030-094）

- **出口**：双规则——（1）`status-funnel`：缺合法阶段码／与状态矛盾／Plan 镜像不一致 → 失败（SC-01–SC-15；grandfather；Wave B 必接 PR CI）；（2）`status-vocab`：状态行英文禁用词／`Status` 表头 → 失败（建议书 §6.2；零本规则基线豁免；**不**报缺状态行）。落地 diff ⊆ Spec §8；阶段迁移附录 ≠ 已迁完。
- **事实**：自由长文不可机读漏斗；英文／中文两套状态词并行；PR CI 缺 `lint:spec-docs`（见建议书 §4.3）。
- **关系**：治理伞；Wave A＝vocab、Wave B＝funnel；单 Spec 终态＝合同收口；系统上线不在本字典。**不入核心分母**。
- **跟进**：Spec／Plan／建议书 **v1.0**（阶段 **S5**）；功能合同已收口（2026-11-22）；SC-01–SC-15＋实现 CR PASS；测试台 not_registered；全仓 MIG 另授权；本条收口不表示可上线。

### P1-52｜客户镜像升级可靠性分层门禁（REQ-030-073）

- **出口**：候选镜像生成后，A 层原生 amd64 容器数据／资源压力与 B 层标准 K8s 持续升级均绑定同一 digest、Chart/values、N-1 数据与运行配置并失败关闭；客户参数超出验证边界时追加 C 层隔离预演；镜像前预检、单次健康 200、小样本热缓存与暂停配置结果均不得替代正式验收。
- **事实**：客户升级事故中 livez 2.17 秒、readyz 7.55 秒并反复摘端点；现有 H3/H4 只看最终 Ready／一次 health，发布 real-e2e 是新装，慢盘套件尚未成为发布聚合必需证据。
- **关系**：发布取证层；复用 P1-39／P1-47 场景与现有 H3/H4，不改这些功能合同，不在本条修业务运行时或放宽探针。**不入核心分母**。
- **跟进**：Spec／Plan v0.1-draft；测试台 not_registered；**终稿未确权；评审前不开发、不执行 UAT；未授权不改运行代码、CI、门禁脚本与测试台**。

### P1-53｜MCP 升级兼容底线与全真用户旅程门禁（REQ-030-074）

- **出口**：四函数＋三维 PASS；全题库（含 COMPAT-OPS）硬约束；消费 P1-54 `questionBankDigest`＋**CompatConfigProfile 指纹**（D27）；缺配置＝BLOCKED；双公开证据文件。
- **事实**：执行器／判定器／双证据／接线已落地；demo 四入口全真 PASS（2026-11-22）。
- **关系**：题库语义正本＝P1-54；与 P1-52／P1-13／P1-35／P1-37 互补。**升级放行＝P0 底线；不入核心分母**。
- **跟进**：Spec／Plan **X_REL｜v1.1。发布取证已收口（2026-11-22）**；INDEX PASS；GAP 关闭。[收口](../reviews/2026-11-22-p1-53-xrel-closure-record.md)。不入核心分母；≠ 可上线。

### P1-54｜MCP 升级兼容多场景题库（REQ-030-075）

- **出口**：版本化题库＋**CompatConfigProfile**（连接／语义／Role／权限／夹具）；§5 COMPAT↔QB 分母完整；有题无匹配配置＝不具备落地条件。
- **事实**：demo 已盘点；W0 仅两表；多库禁 admin；**v1.1**：通用车道含 03b-gate v2 scoped 行隔离成交（P1-72）；frozen W0-only 负例；W1／W2 须夹具＋`gov.*`→`lucy_query.filters[]`。
- **关系**：向 P1-53 提供 digest／fingerprint；YAML 内容／profile 脚本归本条 Create；父 Plan Consume；不依赖 P1-49 heal。**P0 底线题库＋配置合同；不入核心分母**。
- **跟进**：Spec／Plan **S5｜v1.1。功能合同已收口（2026-11-22，严口径）**；开发授权已获得；选项 2＋SC／CR PASS；严口径 candidate PASS（[复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)）。共享测试台 INDEX **PASS**（P1-53 certifyCandidate；非本条升格）。不入核心分母；≠ 可上线。

### P1-55｜FDE 3b1c62af 打包前检查本机复现 UAT（REQ-030-076）

- **出口**：FDE 报告每条结论在本机有判定：成立（全真）／仅替身成立／证据不可重现／无法判定／新增发现；L1 与 L2 分别存放，INDEX 只含 L2。
- **关系**：不入核心分母；消费 P1-56 登记的候选缺陷；复用 P1-45／P1-39／P1-47 既有套件做正向结论复核。
- **跟进**：Plan v0.2，D1–D4 已确认（2026-11-19）；未执行跑次。**不改运行代码；≠ 开发授权；≠ 可上线**。

### P1-57｜FDE 修复复评整改（REQ-030-078）

- **状态**：v1.2。D1–D5／Task1–7修复复验已执行，R1／R2修复，G7–G9测程缺口已补齐。委托人2026-11-19明示正式完整导出“可以先不修，未来再修”；G6该子项延期、待另行安排。原完整范围UAT实测FAIL保留；本次客户功能测试排除正式CSV／ZIP导出，可按限定范围进行，D5边界保留。D6未授权实施，本次延期仅改登记；不入核心分母；≠ 可上线。
- **Plan**：[fde-acceptance-remediation-plan](lucy-20261119-fde-acceptance-remediation-plan.md)。本条是统筹项；功能现值分别取 P1-34、P1-38、v2p5 头部，不另造重复 Spec。
- **证据**：[Codex 修复复评跑次](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-fix-review.md)。L1 失败与 L2 判定分列；不主张 UAT PASS。
- **负责人**：当前 Codex（本轮已执行）；委托人负责范围确认；UAT 证据按测试台维护。

| 执行子项（稳定 ID） | 事实／工作 | 功能验收落点 | 当前跟进 | 负责人／范围 |
|---|---|---|---|---|
| P1-57-R1 | 缩至单表时 t0 拒绝中断，其余 29 张合法表未读 | P1-34 LS-20／LS-26 | 已修复并通过；原断言转绿，真实29表／290字段读齐，指定权限拒绝为D5 | 实施 Agent；保留单表 400，用结构化表级拒绝辨识后汇总 |
| P1-57-R2 | 600 表持续取得进展仍在第 101 请求中止 | P1-34 LS-27／LS-28／LS-29 | 已修复并通过；600表91500字段、154请求全齐，有限收敛守卫通过 | 实施 Agent；按终态与严格缩批证明有限收敛 |
| P1-57-G1 | LS-19 连续三次截断与逐响应时长未验足 | P1-34 LS-19／LS-30 | 已补齐；三次截断树L1检出、真实50×400自然及延迟变体通过 | 实施 Agent；预算上界不改 |
| P1-57-G2 | SC-12 详情／流水与 SC-15／16 闭包满量验收不足 | P1-38 SC-12／SC-15／SC-16 | 已补齐；真实完整entrypoint两条滚动路径、精确闭包及完整夹具三轮通过，含3163行原目标 | 实施 Agent；不授权 O3 批量标脏，不改 P1-47／P1-50 合同 |
| P1-57-G3 | N26-6 普通 caught-up 测试未守住计时起点 | v2p5 N26-6 | 已补齐；捕获S及首次投影成本计入T3，错误起点mutation被4条检出并恢复 | 实施 Agent；优先只补测试，不默认修改运行导出逻辑 |
| P1-57-G4 | LS-24 测试复制判定函数，没有调用实际 runner | P1-34 LS-24 | 已共享实际judge；6个根判定测试通过，正常规模R0／01–10通过，未降低夹具规模 | 实施 Agent；测试自身不得重写实现 |
| P1-57-G5 | 旧回归剩余 skip、空断言及新增类型诊断 | Plan AR-06／AR-07 | 空断言替换；4个skip具名保留，不计行为PASS；本批新增类型诊断清零，存量37条 | 实施 Agent；只修本批新增类型错误，存量 37 条不扩修 |
| P1-57-G6 | 修复候选身份、真实正式导出、完整 L2 路径尚未齐 | UAT-FDE-FIX-R0／01…08 | 身份及其他路径已验；正式完整导出基线缺口由委托人明示延期，待另行安排，缺陷未关闭，原FAIL保留；本轮客户功能测试排除此项 | 本条负责人跟踪；未来恢复时另行设计确认／授权并重跑FIX-01，不补假基线 |
| P1-57-G7 | RPB-03 测程以未鉴权 readyz 代替业务请求，验收假绿风险 | P1-47 既有 RPB-03（同窗至少50次已鉴权项目请求） | 测程已纠正并通过；完整夹具三轮同窗117–118次真实已鉴权项目请求全200 | 实施 Agent；补做同窗真实请求与3次完整冷启动；旧测程结果不冒充业务证据 |
| P1-57-G8 | IRR-02 未杀到进程时用残留兜底；IRR-01仅数turns、IRR-04人工ISO水位且仅比条数，不能证明完整恢复／无空转 | P1-45 既有 IRR-01–04（全调用唯一关联、真实中断与无新日志不重算） | 测程已纠正并通过；真实20000调用SIGKILL，407条持久残留→20000完整；04完成时间／水位不变 | 实施 Agent；使用20000调用、真实部分关联后杀容器，核对137退出与同卷恢复；不改运行合同 |
| P1-57-G9 | RPB预迁移只等待固定60秒，原始20万条不等于完整推断夹具 | P1-47 R0／RPB-01–03 与 P1-38 SC-16 | 守卫已补齐并通过；旧不完整跑次不计PASS，追加9723带负载合成调用，当前窗口至少20万均有效唯一关联 | 实施 Agent；必须67用户complete且当前30天窗口内至少20万调用全部唯一有效关联；旧种子老化时追加真实带负载合成调用，不改旧时间戳／运行时回看，不改产品运行合同／探针门槛 |
| P1-57-SK1 | old-result reads while rebuilding existing window | 既有 P1-39／P1-47 合同 | 具名开放／保留skip；本轮未改原合同参数或移植指定实现，不计该行为PASS | 实施 Agent；若无等价证明，单项保留 skip 并列开放事项，不计 PASS |
| P1-57-SK2 | one-cluster write slice grows again | 既有 P1-47 合同 | 具名开放／保留skip；本轮未改原合同参数或移植指定实现，不计该行为PASS | 实施 Agent；与现行合同冲突则说明差异，保留未完成项 |
| P1-57-SK3 | covered-users probe avoids sorting whole window | 既有 P1-50 合同 | 具名开放／保留skip；本轮未改原合同参数或移植指定实现，不计该行为PASS | 实施 Agent；验证现行等价合同，不另改水位 |
| P1-57-SK4 | bounds large-cluster link inserts/removals | 既有 P1-47／P1-50 合同 | 具名开放／保留skip；本轮未改原合同参数或移植指定实现，不计该行为PASS | 实施 Agent；保留真实差异与后续决策，不冒充已覆盖 |

#### P1-57-G6 延期登记（D7，2026-11-19）

- 委托人原话：“这个可以先不修，未来再修”。对象仅为正常新实例因证明基线缺失导致正式完整CSV／ZIP导出409。
- 状态：延期、待另行安排；缺陷仍开放，未修复，实际FIX-01仍FAIL。未指定未来版本／日期；D6设计建议保留但不启动实现。
- 本次客户功能测试排除正式完整导出，可按其余已验证范围进行；不能对外声称“审计导出可用”“整套原范围UAT全通过”或“全部缺陷已清零”。诊断包仍非正式完整证据。
- 恢复条件：委托人重新明确安排／授权后，按原完整导出合同补齐新实例、旧实例缺证失败关闭、重启幂等、as-of-S与N26回归，FIX-01实际通过后再关闭。

### P1-56｜FDE 3b1c62af 候选缺陷补录（REQ-030-077）

- **出口**：复现确认后按缺陷拆行并定级；每行走终稿确权→委托人开发授权。本条自身不出修复。
- **事实**：FDE 报 F01／F02／F04／AUDIT-01 为 P0、F03 为 P1，均在受控替身上复现；84 不是候选祖先，F01／F04／AUDIT-01 在 84 为绿。8 个 `it.skip` 带作者原因，合同适用性待核（Plan UAT-FDE-R1）。 **复评更新（2026-11-19）**：原 L1 已复现；本轮上游实现 d8c3f097 的 R1／R2 及验收缺口见 P1-57，原「合同适用性待核」不代表本轮发现不存在。
- **跟进**：v1.0 上一批实现 d8c3f097 及复评记录保留；混合权限与全局请求上限已由获授权的 P1-57 修复并复验。原完整范围FDE实测FAIL保留；委托人2026-11-19已将G6正式完整导出基线缺口延期，本次客户功能测试排除此项，可按限定范围进行，不声称导出已修复。O3仍未授权，D6未实施；≠ 可上线。
- **后续已逐项登记**：两处功能阻塞和 G1–G6／SK1–SK4 由 P1-57 子表承接；未把子项标已完成。

### P1-34｜大 Schema 接入（REQ-030-055）

- **出口**：普通 MySQL 单 Schema 1200 张表（外加 1000 列宽表）与外部目录单 Schema 600 张表（外加 1500–5000 列宽表）下，「准备表结构」勾选 600 张表在 60 秒内读完全部字段；任一 HTTP 响应不超过 20 秒；客户端累积 600 张×30 列不超过 5 秒；失败要点名表，且不丢弃已读结果。预算与规模下限见 Spec §4。
- **事实**：外部目录读字段整张表 2000 列起被拒；MySQL 逐表约 0.93 秒（每表两次 `ktx sql`）；客户端每读一张就重新解析整份 YAML（二次方）；失败即整批终止。
- **关系**：P1-16、P1-20 的续作；**不入核心分母**；**不挡**原 P0。**开发授权已获得**（委托人 2026-11-15，含终稿确权），授权范围见 Spec「授权」行。
- **跟进**：实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（共 5 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）；SCALE-09 测量对象已更换（预算不变），第 2 次完整跑 SCALE-09 异常未定位。**Spec v0.2.2（FDE R02：LS-16–18 字段读共享超时预算已落地；vitest 虚拟时钟 PASS；真实 Hive UAT＝BLOCKED）**。功能合同收口 ≠ UAT PASS；≠ 可上线。

### P1-32｜审计导出路径规模整改（REQ-030-053）

- **出口**：`GET /api/admin/audit/export-inquiry-pack` 在客户规模夹具下 `/api/livez` 不越线（p99 ≤ 400ms、max ≤ 1000ms），单次耗时进入亚秒到秒级；v2 导出（`export-v2`／`export-pack-v2`）在全量范围下不再因 SQLite 变量上限失败关闭。判定沿用 P1-21 门槛，由 `UAT-SUITE-PAGE-SWEEP` 的 UAT-SWEEP-02 验收，门禁基线同步划掉。
- **事实**：F-1 单条 SQL 占 98%，复杂度＝行数×问询 ID 数；同批 26,580 行，集合式写法实测 0.30 秒（见 [O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)）。F-6 来自精确 as-of 证明里按范围行数展开的 `IN (?,…)`。
- **关系**：P1-21 的延伸；**不入核心分母**；**不挡**原 P0。**开发授权已获得**（委托人 2026-11-15 23:47，按明示确权＋开发授权处理，见 v0.95）。
- **跟进**：实现已落地；[Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)；测试台 `UAT-SUITE-EQUIV-GUARD`、`UAT-SUITE-PAGE-SWEEP` 均 PASS WITH GAP。≠ UAT PASS；≠ 可上线。

### P1-33｜并发压测越线接口整改（REQ-030-054）

- **出口**：F-2 `access-map`、F-3 `governance/overview`、F-4 `audit/export`／`audit/turns/export`、F-5 `ui-usage/overview`、F-7 `reconciliation/export` 在并发压测下 livez 不越线。是否引入只读 worker 依 [O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)：先剖析、先减负，仍超线再单独复评。
- **关系**：P1-21 的延伸；**不入核心分母**；排在 P1-32 之后。**开发授权已获得**（同 P1-32）。
- **跟进**：实现已落地，剖析与减负后未引入 worker；`governance/overview` p99 372ms 贴线，下一轮继续盯。≠ UAT PASS；≠ 可上线。

### P1-31｜全页面事件循环与探针风险排查（REQ-030-052）

- **出口**：服务端全部 GET 路由、WebUI 全部页面在客户规模夹具下逐项量化（状态码、p95、对 `/api/livez` 的影响）；出具排查报告与越线清单。判定线沿用 P1-21（livez p99 ≤ 400ms；单接口 p95 ≤ 3s；状态码必须 200）。
- **关系**：P1-21 的全局化续作；**不入核心分母**；**不挡**原 P0。**只读排查，不改运行代码**。
- **跟进**：只读排查已完成（2026-11-15），[报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)已出。委托人批准后补做：合成账本夹具（盲区转为已测，新发现 F-6／F-7）、整改行 **P1-32／P1-33**、[O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)、门禁 `sweep:event-loop:gate` 与测试台 [`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（首跑 FAIL，因越线未整改）。≠ 可上线。

### P1-30｜Wiki／Skill 真读真用＋ACL UAT（REQ-030-051）

- **定位**：测试台合同（防假通）；无运行代码 Spec。
- **跟进**：**PASS WITH GAP**（2026-11-15）；WIKI-01S BLOCKED＝GAP-2。
- **套件**：`UAT-SUITE-CONTEXT-CONTENT`；复跑入口见 suite／fixtures；播种 `scripts/uat/seed-context-content.mjs`；判定 `scripts/uat/judge-context-content.mjs`。
- **≠ 可上线**。


### P1-19｜访问关系图允许词表（REQ-030-040）

- **出口**：成功调用 `outcome=ok` 进入访问路径；历史 `allow` 仍进入；拒绝／错误／预算停止不进。
- **关系**：**不入核心分母**；不改空桑基几何；不回填历史 audit。
- **授权**：委托人 2026-11-13「立项修一下」。
- **跟进**：实现已落地（2026-11-13）。**测试台已复跑 PASS（2026-11-14）**——UAT-04 关闭 F-1。≠ 可上线。

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
| [重读路径减负 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) · [Plan](lucy-20261113-heavy-read-path-and-probe-relief-plan.md) · [性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md) · [UAT](../qa/uat/suites/event-loop-relief/suite.md) | P1-21／REQ-030-042（**功能合同已收口；测试台R0／01–04 PASS；不入核心分母**） |
| [`DEVELOPMENT.md` 产品线执行总账（SOT）](../governance/DEVELOPMENT.md) | 仓库级 SOT／差集补录规则正文 |

---

## 7. 本池自身验收

- 本文件是 `0.30` **执行总账 SOT**（见 DEVELOPMENT）。v0.89 补入 REQ-030-049／050。测试台判定只看 INDEX，不写进本表跟进状态代替 INDEX。
- P0 立项范围与 §2／§3 一致；**P0-B O1–O3 已闭合（建议包 F），待 R2-F**；**P1-8／P1-9 仍待立项**；**P1-10 委托人结案**；**P1-11…14 已落地／收口**；**P1-15…18 差集补录（不入核心分母）**；agent 规则可被本分支会话引用。
- **不构成任何功能验收或上线许可。**

### P1-64 SC-09 修复授权补记（2026-11-20）

委托人本轮授权修复49条全库类型诊断并补回归；归属原SC-09与Plan Task 9，不新增产品能力。前次UAT保留为同摘要历史结果；本轮验收完成前不主张新PASS。RACS相关仅修既有类型契约与依赖计算，不扩展权限语义。

### P1-60＋P1-64同候选最终验收授权（2026-11-20）

委托人续授P1-60剩余整改、完整Docker UAT与两项同候选合并、类型／浏览器取证和整包终审。归属现有P1-60／REQ-030-081与P1-64／REQ-030-085，不新增能力；保留历史判定，本轮完整结果前不主张新PASS。

P1-60完整R补记：N性能采样的预算持久化SQLITE_BUSY已在独立真SQLite观测中核实，改前镜像亦出现；本轮补真实写争用及故障零写入回归，修正保存事务取锁时机，预算／ACL规则保持。归属既有SC-05／10，不新增产品能力；未过完整矩阵前不主张PASS。

### R-CAV-FDE-1883具名持续运行补验（2026-11-20）

委托人明示授权：本机Docker构造至少1883张启用表，真实短名修改／保存／配置重载与审计维护并行，区分诊断I/O等待和主线程同步阻塞，回写测试台。复用P1-13组合取证及P1-61／62／63、P1-64相关入口，不新增产品能力或SC，不改客户环境、不提交、不推送、不发布。本轮仅测试工具／夹具／只读性能采集，不默认授权新增产品运行修复。

已按委托人约1h收敛：实跑59分45秒，1883–1884启用表，12次真实提交／重载、8次完整恢复；[补验局部FAIL与收敛评估](../qa/uat/suites/core-availability/runs/2026-11-20-codex-fde-1883-soak.md)。5次预算相关业务503、HTTP超时与观测开销分列，客户入口摘流链路未自然复现；原2h、后置1883表I/O控制及最终全量审计闭包仍GAP。后续先消费18b63d01既有预算／短名修复，与可用性修复整合成同候选，再按[执行Plan](lucy-20261120-readyz-diagnostic-repro-uat-plan.md)核对同步热点和热重载差集；本轮未新增运行实现，不重复立项、不改变功能Spec现值。

### 核心可用性本进程阶段提交授权（2026-11-20）

2026-11-20委托人后续批准：本进程已完成修复、回归及取证可作阶段性本地commit；不含push、发布或客户变更，未完成矩阵仍保留GAP。 提交范围归属既有P1-61／62／63及R-CAV-FDE-1883，不纳入角色／Agent等其他进程改动。先提交已完成部分，再制定三问题后续Plan；不把阶段提交视为整包更新放行。

阶段提交范围／基线对照及未完成出口见[本进程提交复核](../reviews/2026-11-20-core-availability-checkpoint-review.md)；该记录不替代原Spec现值或整包放行。

### 核心可用性三问题后续工作包（2026-11-20）

委托人批准先提交本进程已完成部分，再制定下一步计划。阶段基线为codex/readyz-drain-checkpoint-20261120上的f98deeb9（继承18b63d01预算／短名修复，叠加本进程诊断真实取消、MCP排空及测试证据）。原共享工作区不切分支，不夹带其他进程改动，不push／发布／改客户环境。

后续按[实施与验收Plan](lucy-20261120-core-availability-followup-plan.md)处理：预算既有修复同候选复验→剩余主线程热点／同步等待→配置热重载在途与恢复合同→1883表组合验收。复用P1-60／64、P1-61／62／63、P1-47／13与展示快照隔离；本工程工作包不新增产品能力或SC，不改各Spec现值。若热重载保护超出现行合同，先补对应REQ／Spec并完成范围确权，再动运行代码；不以工程Plan替代功能合同。当前只制定计划，未启动后续运行整改或新长跑。

### 0.30合入与后续计划分期（2026-11-20）

委托人批准本次已完成修复合入lucy-v0.30并复跑现有测试；[后续Plan](lucy-20261120-core-availability-followup-plan.md)放下次开发，本轮不执行Task0–4。保留现有预算／短名修复，整合诊断实际取消及MCP／Node PID排空；只纳入已完成范围，不带入其他任务暂存。不push／发布／改客户环境，验证通过也不代签完整F61／F62／F63或客户根因。

本次合入复验记录：[0.30既有修复复测](../qa/uat/suites/core-availability/runs/2026-11-20-codex-availability-merge-recheck.md)，源码d978f4df、镜像8baa62dc；44项Vitest／32项Node／类型0错，实际I/O恢复与三轮TERM均局部PASS WITH GAP；不签完整矩阵或用户更新。后续开发继续延期。


### 核心可用性后续工作包开工（2026-11-20）

委托人本轮明确“批准执行”已审阅的[多agent任务单](lucy-20261120-core-availability-followup-plan.md)，解除上节历史延期。复用既有REQ／P1合同，先冻结7dded547基线、工具整改、预算复验与重载合同差集；热点只按确证反例实施，新增热重载语义先入REQ／SOT并终稿确权。执行中不借局部证据签整套UAT，不commit／push／发布／改客户环境。

核心可用性工程接线差集：本轮给新增deadline回归接入既有入口时，root-test-registry门禁发现原7dded547已漏登process-drain、agent-roster-summary-oracle、wiki-mcp-assertions三个已跟踪测试，原基线失败日志保留。本轮仅补其deterministic注册并复用既有workflow-contracts命令，不改这些测试或对应产品实现，不扩大P1-66暂停范围／P1-67性能门禁范围，不新增CI job。

本轮发现时差集（历史；当时待合同／授权，后续授权与现值见下方P1-70）：[候选4短校准](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r4-calibration.md)独立证据VALID但严格FAIL。7次热重载拒绝和同身份恢复闭包已证；另1次正常Manifest写入期间查询触发现行D3的semantic_recovery_required，未豁免。若增加真实活跃发布所有者的有界等待读语义，须按后续Plan CA-03式流程明确预算、TERM／ACL／无业务重放及孤儿日志仍关闭的合同，再获该增量开发授权；不把已批准热重载保护或纯热点优化视为该新增语义的授权。正式30分钟尚未执行，其他已批准独立矩阵继续。


上述语义写入差集已获委托人本轮明示“批准补充合同并修复”，正式落P1-70／REQ-030-091；该条Spec头部是现值事实源，先终稿确权再实施。原有P1-69与其他已收口功能不倒退，旧FAIL保持。

CA-01验证工具差集：真实D4-start夹具在产品启动故障注入之前，因MySQL临时初始化socket的ping误判最终数据库就绪而失败，原FAIL保留；隔离v4以同一原绝对就绪预算内的TCP只读SELECT1验证后，从头实测启动失败／恢复通过。主控据此扩工具白名单至共享`verify-begin-zero-binding.py`原DB就绪轮询，最小改为最终TCP实际查询就绪，保留原截止、不重放CREATE或业务SQL，不修改产品逻辑。旧候选／旧driver与FAIL均不回写，新候选冻结独立helper hash。

CA-01正确性判定器差集：独立审计发现原query oracle对返回数值排序后比4／100，不能区分列值倒置；已读真实原始样本列名与值均正确，不能据此把它们改判为产品失败。最终工具须按headers／命名键绑定order_count与amount_sum，共享夹具与soak口径一致；独立09审计器另行实现以保留独立性。新增倒置、错／缺／重复列与额外值负例，保留原各版本和报告，不扩大性能／正确性阈值或新增产品功能。
