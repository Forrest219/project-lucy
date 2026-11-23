# Lucy 0.30.0 需求池

| 元数据 | 内容 |
|---|---|
| 文档类型 | 候选需求池。**不是**功能 Spec，**不授权**实现 |
| P1-71 本轮变更 | v0.133（2026-11-22）：REQ-030-092／P1-71 委托人明示本 Spec 不开发、明确移入需求池作下一期开发目标；0.30 不实施；终稿未确权；未获开发授权；测试台 NOT RUN。 |
| P1-68 本轮变更 | v0.131（2026-11-20）：REQ-030-089／P1-68 运维步骤账经委托人明示定稿后，按“授权你拆分多 agent 执行的任务，完成落地和 code review，暂不进行 docker 重建”完成工作树实现与两轮独立代码评审，评审缺陷已修复；未执行 Docker 重建、真实前台浏览器与 UAT，测试台 NOT RUN。 |
| P1-67 本轮变更 | v0.127（2026-11-20）：新增 REQ-030-088／P1-67 用户旅程性能门禁设计（API／WebUI 交互／MCP 问询三维度、CI 接入、gitSha 绑定、部署对账）；仅授权登记与 Spec／Plan 设计，不授权实现或执行。 |
| P1-66 开发授权 | v0.125（2026-11-20）：委托人确认 v0.2 定稿，授权按 Plan 开发及 Docker 浏览器完整验收；不提交、推送或发布。 |
| P1-66 严格评审 | v0.124（2026-11-20）：严格过程评审修订至 v0.2-draft，8 项设计问题已修订；未确权、开发未授权、UAT NOT RUN。 |
| P1-66 本轮变更 | v0.123（2026-11-20）：新增 REQ-030-087／P1-66，授权优化方案、Spec／Plan、保留现场权限展开规模的 Docker 浏览器验证设计；不授权实现或执行。 |
| P1-73 本轮变更 | v0.140（2026-11-22）：P1-73＋P1-35 → **S5 功能合同已收口**（编排 Plan 执行完成）。v0.139：P1-73 开发授权；S2→S3。v0.137：终稿确权 S2。v0.136：伞含 `status-vocab`。v0.135：入池 REQ-030-094。 |
| P1-74 本轮变更 | v0.141（2026-11-22）：Spec／Plan v1.1 终审闭环修订，D1–D9 不变；UAT 设计 v1.0，BESC-R0／01–12 全必做；开发未授权，仍 NOT RUN。v0.140：终稿确权；v0.139：挂测试台；v0.138：入池。 |
| 版本 / 日期 | v0.154 / 2026-11-23 |
| 版本 / 日期 | v0.157 / 2026-11-23 |
| P1-79 本轮变更 | v0.157（2026-11-23）：新增 REQ-030-100，长追问题组（性能专用，≥20 轮单进程长链，独立 packDigest）；P1-78 升 v0.3-draft 并消费该题组；50 路压测身份与持续压力下限登记进全局规模基线 §1.1 MCP-PERF profile。镜像总账 v2.51。 |
| P1-78 本轮变更 | v0.155（2026-11-23）：REQ-030-099 升 v0.2-draft，来源收敛为只消费 P1-54 题库与全局规模基线／P1-34 初始化数据；新增 `SOAK` 持续压力与 `LONG_FOLLOW` 长追问场景及 SC-14／SC-15；依赖缺失 BLOCKED。镜像总账 v2.47。 |
| P1-78 本轮变更 | v0.154（2026-11-23）：新增 REQ-030-099，独立 MCP 问询端到端性能基准与持续门禁；只做性能测试与判定，优化由其他 Spec 执行。委托人授权新建 Spec／Plan／UAT 设计；P0 核心体验／发布底线，不改变既有核心分母；镜像总账 v2.46。 |
| P1-75／P1-77 合同修订 | v0.153（2026-11-23）：委托人批准 v1.1 合同修订及并行任务批次。G1／G2 先验 P1-75，P1-77 叠加后验质量、速度和同窗可用性。镜像总账 v2.45。 |
| P1-75 终稿确权 | v0.152（2026-11-23）：REQ-030-096 依委托人授权优化并定稿，Spec／Plan v1.0，S2。开发待授权。镜像总账 v2.44。 |
| P1-77 终稿确权 | v0.151（2026-11-23）：REQ-030-098 Spec 经委托人明示批准定稿 → **v1.0、阶段 S2**；开发未授权；镜像总账 v2.43。 |
| P1-77 本轮变更 | v0.150（2026-11-23）：REQ-030-098 Spec 按评审 R1 修订 → v0.2 草案（根因假设化＋归因对照、口径两阶段、子结论兜底、取证关联化、预算可判定）；镜像总账 v2.42。 |
| P1-77 本轮变更 | v0.149（2026-11-23）：新增 REQ-030-098，数据问答默认主动采用业务上下文（口径前置核对＋规程引导＋诚实兜底）；委托人指示落盘 Spec 与 UAT；镜像总账 v2.41。 |
| P1-75 本轮变更 | v0.148（2026-11-23）：新增 REQ-030-096，先起草优化 Spec 与 UAT；镜像总账 v2.38。 |
| P1-29 下一期 | v0.147（2026-11-22）：REQ-030-050／P1-29 委托人明示「放在需求池，下一次迭代在优化」→ `X_DEF｜Deferred；下一期`；0.30 不开发；ROW-07／GAP 仍开；不挡 P1-28。镜像总账 v2.37。 |
| P1-58／59／42／44 S5 | v0.146（2026-11-22）：REQ-030-079／080／063／065 → **S5｜功能合同已收口（scoped）**；A1／B1 已勾选；42／44 lite Spec／Plan 已立；镜像总账 v2.32／[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。**收口 ≠ 可上线**。 |
| P1-36／37 S5 | v0.145（2026-11-22）：REQ-030-057／058 → **S5｜功能合同已收口（scoped）**；裁定包推荐默认已勾选；镜像总账 v2.31／[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。**收口 ≠ 可上线**。 |
| 立刻文档收口 | v0.144（2026-11-22）：**REQ-030-071／P1-50 → X_SUP｜被取代（并入 REQ-030-066／P1-45）**；**REQ-030-036／P1-15 → S5｜功能合同已收口（漏斗镜像）**。补登 REQ-030-071 表行（此前总账有、需求池缺号）。镜像总账 v2.30。**收口 ≠ 可上线**。 |
| S5 收口镜像 | v0.143（2026-11-22）：**补登记 REQ-030-056 表行＋分节**（此前仅有总账 P1-35，需求池缺号）；与 Spec／总账同句 **S5｜功能合同已收口**。REQ-030-094 已 S5。镜像总账 v2.27／[收口记录](../reviews/2026-11-22-p173-p135-s5-closure-record.md)。**收口 ≠ 可上线**。 |
| S1／S2 纠偏 | v0.142（2026-11-22）：委托人批准状态一致性修复。REQ-030-074／075 表行与 Spec 同句（S3｜开发已授权／实现进行中）；REQ-030-072／043 显式 S1｜（≠ 误标 S2）；REQ-030-063／065 升 S4｜（实现已落工作树）。镜像总账 v2.26。 |
| 状态 | **已开线**。跟进主表＝[功能清单池／执行总账 SOT](lucy-20261107-lucy-0-30-feature-inventory-pool.md)（v1.25）。**REQ-030-062**／P1-41 访问关系图桑基还原：D0＝C，终稿确权，开发授权已获得（不含线上升级），功能已实现并提交；测试台 Docker 种子容器全真 PASS WITH GAP（缺口见测试台 INDEX）。**REQ-030-061**／P1-40 明文 HTTP 复制按钮假成功：已授权修复并落工作树，测试台改前 FAIL → 改后 PASS WITH GAP（未提交）。**REQ-030-060**／P1-39 客户 K8s 升级 event loop／readyz 事故：**S5 功能合同已收口（2026-11-22 漏斗底端分批收口·批次 1）**——终稿确权＋开发授权＋实现落地；出口 SC-01–SC-17 通过（冷启动慢盘台 2026-11-18 跑次 R0／01–05 全 PASS）。**REQ-030-042**／P1-21 重读路径与探针减负功能合同已收口（2026-11-13；SC-14 p99 门槛 400ms）。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（R0／01–04）。**REQ-030-041**／P1-20 外部目录单表读字段开发授权已获得、实现已落地；本机 UAT 见测试台 INDEX。**REQ-030-040**／P1-19 **S5 已收口**（实现落地＋测试台复跑 PASS 2026-11-14）。**REQ-030-036…039** 差集补录（**不入核心分母**）。**可信证据未开工项不进本池**——见 [post-0.30 TE 池](lucy-20261115-post-030-trust-evidence-requirement-pool.md)。其余 P0／P1 现值同清单池。本条不表示可上线  **P1-57的G6正式完整导出已由委托人D7延期，本轮客户功能测试排除此项，可按限定范围进行；原FAIL保留。** |
| 授权边界 | **只登记、不实现**。条目进入实施前须：需求澄清 → 独立 Spec → Plan → 开发授权；本池自身不构成其中任一步。**P0 立项 ≠ 开发授权**；**入池 ≠ 立项** |
| 验收 | 本池自身的验收＝条目结构完整（ID／标题／来源／优先级／状态齐备）＋ 来源可追。**不构成任何功能验收** |
| 目标版本 | 产品线 **`0.30.0`**（已开线；池内条目仍须 Spec→Plan→授权后才实现） |
| 核心方向 | [Lucy 0.30 升级核心方向](lucy-20261107-lucy-0-30-core-direction.md)（v0.6）：辅线＝现有 UX；**主线＝存量用户每日可信交互，加上行级隔离**（ROW-07 不挡核心分母） |
| P1-28 解耦变更 | v0.134（2026-11-22）：REQ-030-050 明确不挡 P1-28 套件 PASS；方向／suite／e2e 同句；测试台已复跑 PASS（ROW-07 单列 FAIL）。 |
| 功能清单池 | [lucy-20261107-lucy-0-30-feature-inventory-pool](lucy-20261107-lucy-0-30-feature-inventory-pool.md)——**本产品线执行总账（SOT）**（见 DEVELOPMENT）；REQ 与之双向可追 |
| 维护规则 | 只追加条目；开工前须另立 Spec／Plan 并获授权。不得把本文件当作默认可实施依据。优先级／立项状态与功能清单池对齐。**事故修复／旁路落地也须有 REQ＋总账行** |
| 本次P1-60复审 | v0.126（2026-11-20）：原四项与77e2ad84完整R取证；12 PASS／预算项FAIL；RC1实际4／100；预算另行处理，未推送／发布，不作用户更新批准。 |
| P1-64 本轮变更 | v0.121（2026-11-20）：R1–R3整改、169＋5回归与Docker／真实前台浏览器复验完成；测试台R0／01–12 PASS；SC-09全库49条基线诊断未关闭，≠ 功能合同收口／可上线。 |
| P1-64 SC-09变更 | v0.122（2026-11-20）：49→0，SC-09通过；413＋29回归及最终候选Docker／前台浏览器PASS；不外推整包更新放行。 |
| 最新变更 | v0.120（2026-11-20）：P1-60／REQ-030-081 T1–T5 已实现并 commit（vitest 109 PASS；demo 冒烟）；测试台 NOT RUN；T6／R 另授；≠ 功能合同收口；≠ 可上线。 |
| 前次变更 | v0.116（2026-11-20）：P1-60／REQ-030-081 终稿确权＋开发授权 T1–T5；T6／commit 另授；实现进行中；测试台 NOT RUN；≠ 功能合同收口；≠ 可上线。 |
| 前次变更 | v0.114（2026-11-20）：P1-60／REQ-030-081 按新定位复审收缩为 N＋隐藏面＋D2 无副作用；Spec／Plan v0.7-draft、UAT v0.5-draft；复用现有参与事实，未来 B／D／事务／C1／C2 移出本条；预算／ACL／continue 保持。终稿未确权、开发未授权；测试台 NOT RUN；≠ 可上线。 |
| 前次变更 | v0.109（2026-11-20）：P1-60／REQ-030-081 复审修订 Spec／Plan v0.5-draft、UAT v0.3-draft；OQ-1／OQ-2 文档方案闭合，参与代次复用 committed registry generation，预算＋有效归属同事务并补 C1／C2 恢复；OQ-3 数值待采样前冻结。终稿未确权、开发未授权；13 项全部 NOT RUN，≠ 可上线。 |
| 前次变更 | v0.108（2026-11-20）：REQ-030-085／P1-64 修复 Spec／Plan v0.1-draft 与改后 R0／01–09 用例落盘；终稿未确权、开发未授权，测试台保留 FAIL，改后复测 NOT RUN。 |
| 前次变更记录 | v0.107（2026-11-19）：新增REQ-030-082／083／084，对应P1-61／62／63，仅文档草案；去重核对见核心可用性评审；终稿未确权、开发未授权、测试台NOT RUN。 |
| 前次变更记录 | v0.106（2026-11-19）：P1-60／REQ-030-081 按评审决议修订 Spec／Plan v0.4-draft、UAT v0.2-draft：保留 D6 新问询轮次，补 G1–G6、N／B／D 单一矩阵、画像任务补偿、RC1 与正式控制入口。待复审、未确权、开发未授权；13 项全部 NOT RUN，≠ 可上线。 |
| P1-60 前次文档落盘历史 | v0.105（2026-11-19）：REQ-030-081／P1-60 配对 Spec／Plan v0.3-draft 与独立零绑定 UAT 已起草，测试台 NOT RUN；错题核实测试覆盖遗漏及已发现错误独立跟进不足。仅文档，终稿未确权、开发未授权。 |
| P1-60 v0.104 历史 | v0.104（2026-11-19）：REQ-030-081／P1-60 v0.1 方案未获认可；v0.2 先评估 begin 价值，以零绑定默认直接问数、旧客户端调用 begin 也不新增阻断为第一段，有绑定发布一致性另段。仅文档，终稿未确权、开发未授权，测试台 not_registered。 |
| v0.105 变更 | v0.105（2026-11-19）：REQ-030-079／080 Wave1–3 实现完成并经 code review APPROVE；待 F58／F59／浏览器；测试台 NOT RUN；≠ 功能收口／UAT PASS／可上线。 |
| v0.104 变更 | v0.104（2026-11-19）：REQ-030-079／080 开发授权。委托人明示「授权开启执行」；Wave1–3 实现；本轮仅 vitest＋code review，禁止 docker／UAT；实现进行中（Wave1）；测试台 NOT RUN；≠ 收口／可上线。 |
| v0.103 变更 | v0.103（2026-11-19）：REQ-030-079／080文档v1.0定稿，按委托人明示确权免Codex CLI终审；补依赖矩阵、审计回执及验收层级。开发未授权、测试台NOT RUN；2×／5×保留，当前负载缺测仍不主张已覆盖。 |
| v0.102 变更 | v0.102（2026-11-19）：新增 REQ-030-081／P1-60，普通 WebUI 发布与口径绑定注册表一致提交、纯 MCP begin 主路径修复；仅修复方案与验收设计，终稿未确权、开发未授权，测试台 not_registered。v0.101 的 REQ-030-079／080 登记保留。 |
| v0.100 变更 | 2026-11-19：委托人D7明确将REQ-030-078／P1-57-G6正式完整导出基线缺口延期、待另行安排。原完整范围FAIL保持；本轮客户功能测试排除此项、限定范围可进行。没有运行代码或部署变更。 |
| 变更 | v1.25（2026-11-22）：**漏斗底端分批收口·批次 1 镜像**——REQ-030-033／035／040／048／060／066／067／068 八条 → **S5 功能合同已收口**（证据＝实现 CR PASS／测试台 PASS；REQ-030-060 的 UAT-COLD-06 客户侧证据 BLOCKED 归发布取证、不在出口）；表行＋分节与 Spec 头部同句；**收口 ≠ UAT PASS ≠ 可上线**。v0.99（2026-11-19）：**REQ-030-077 终稿确权＋整批开发授权（委托人 2026-11-19 12:35「整批授权」「无需复审，整批定稿」）**——按委托人明示确权记录 P1-20 §8、P1-34 §11、v2p5 §18.19 N26、P1-38 §8；Codex 首轮终审（未确权）必改项已采纳，未复审；整改 [Plan v1.0](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md) Task 1–7 两批均生效；O3 延后未授权；实现未开始；≠ UAT PASS；≠ 可上线。v0.98（2026-11-19）：**REQ-030-077 按 Codex 首轮终审修订 4 份 Spec 与整改 Plan 并定稿（仅文档）**——P1-34 §11 的 BLOCK（原伪代码使单次响应约 30 秒）已改回候选硬上界；其余必改项已修订；生效条件改为按批（第一批 P1-20 §8／N26／P1-38 §8，第二批 P1-34 §11）；P1-34 O7「服务端计终态」一半作废；终稿未确权，待回送复审；≠ UAT PASS；≠ 可上线。v0.97（2026-11-19）：**REQ-030-077 委托人批准整改建议（仅文档）**——决策点 P1-34 O7–O10、P1-38 O1／O2 闭合，O3 待 SC-14；UAT 受控降级口径授权，amd64 模拟不授权；整改分两批；开发授权按批生效（见 v0.98）；≠ UAT PASS；≠ 可上线。v0.96（2026-11-19）：**REQ-030-077 本机 L1 复现成立＋契约修订草案＋整改 Plan（仅文档）**——5 项均在候选 `3b1c62af` 受控替身复现（非 UAT）；修订草案落 P1-20 §8／P1-34 §11／v2p5 §18.19 N26／P1-38 §8，整改 [Plan](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)；均未终稿确权、开发未授权；≠ 开发授权；≠ 可上线。v0.95（2026-11-19）：**入池 REQ-030-076／077（FDE 3b1c62af 打包前检查）**——076＝本机复现 UAT 任务（Plan v0.2，D1–D4 已确认）；077＝FDE 报告候选缺陷补录（F01／F02／F03／F04／AUDIT-01，待复现确认，不预判缺陷成立）；≠ 开发授权；≠ 可上线。v0.94（2026-11-19）：**REQ-030-002 MD 标配**——委托人明示「Copy as Markdown 很有用，以后 md 就是标配了」→ 新增 D21（复制 Markdown 成为标准动作，覆盖四处载体页；解除 D6 整本导出限制）与 SC-26，出口扩到 SC-01–SC-26；Spec／Plan 升 v0.5-draft；≠ 终稿确权 ≠ 开发授权；≠ 可上线。v0.93（2026-11-19）：**REQ-030-002 首页形态裁决 ＋ 两项候选纳入**——委托人明示帮助首页参照 `https://www.kimi.com/code/docs/` 与 `https://docs.kaelio.com/ktx/docs/getting-started/quickstart` 采用概览内容页形态（D17 已裁决），并明示**纳入**「错误参考」章（D19）与「未覆盖位置逃逸出口」（D20），新增 SC-24／SC-25，出口扩到 SC-01–SC-25；Spec／Plan 升 v0.4-draft；≠ 终稿确权 ≠ 开发授权；≠ 可上线。v0.92（2026-11-19）：**REQ-030-075／P1-54 Spec／Plan → v1.0 终稿确权**：委托人批准对抗复审修订并定稿（identities、D7a、frozen 02c、COMPAT-02 四题、行级③＋03b-gate、gov filters、OPS-05／05b、Plan 归属）；开发未授权（明示暂不开发）；共享测试台 NOT RUN；**终稿确权 ≠ 开发授权**；≠ 可上线。v0.91（2026-11-19）：**REQ-030-002 对标对象修正**——委托人把现行对标由 `https://www.kimi.com/help` 改为 `https://www.kimi.com/code/docs/`（Kimi Code 文档站）；Spec／Plan 升 v0.3-draft，新增 D16–D18／SC-22–SC-23；首页形态 D17 待评审裁决；≠ 终稿确权 ≠ 开发授权；≠ 可上线。v0.90（2026-11-18）：**REQ-030-074 → Spec v1.1 终稿补丁；REQ-030-075 → Spec／Plan v0.2-draft**：收编题库正本／Ops；明示 CompatConfigProfile 为全真落地前置；闭合多库／行权限／gov；测试台仍 NOT RUN；**≠ 开发授权**。v0.89（2026-11-18）：**入池 REQ-030-075／P1-54（独立多场景题库）**：委托人授权访问真实系统并起草涵盖 Lucy Ops 的题库 Spec；已盘点真实连接、Source、Role 与 ACL；独立问、连续追问、单表／多表、权限、多库及 Ops W0／W1／W2，含独立 oracle 和时区／人口口径。[Spec](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) v0.1-draft；测试台共享，NOT RUN；**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线。v0.88（2026-11-18）：**REQ-030-074／P1-53 Spec／Plan → v1.0 终稿确权**：委托人授权修订定稿（闭合 T1–T10）；测试台仍 NOT RUN；**终稿确权 ≠ 开发授权（明示暂不开发）**；≠ 可上线。v0.87（2026-11-18）：**REQ-030-074／P1-53 Spec／Plan → v0.2-draft**：委托人批准审阅修订落入（D20 拆分、耗时分档、双入口、D21、D6 分层等）；测试台仍 NOT RUN；**≠ 终稿确权 ≠ 开发授权**；≠ 可上线。v0.86（2026-11-18）：**入池 REQ-030-074／P1-53（MCP 升级兼容底线与全真用户旅程门禁）**：委托人批准通用事故回归＋客户真实基线、完整全真 Agent 题库、用户端到端耗时记录与绝对＋相对双门禁；无基线不升级，必做项不接受 PASS WITH GAP；本任务不重建 Docker。[Spec](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)／[Plan](lucy-20261118-mcp-upgrade-compatibility-plan.md) v0.1-draft；测试台 NOT RUN；**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线。v0.85（2026-11-18）：**入池 REQ-030-073／P1-52（客户镜像升级可靠性分层门禁）**：委托人认可 digest／Chart／values／N-1 数据基线绑定、客户数据量级覆盖与三层环境等价折中；授权只生成 Spec／Plan，评审前不开发、不执行 UAT；测试台 not_registered；**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线。v0.84（2026-11-18）：**入池 REQ-030-072／P1-51（版本轴分工与命名规约）**：委托人确认 `rc.N`＋交付主键、候选号自动分配、私有化分叉追溯；Spec／Plan v0.3-draft；补登此前未入池；测试台 not_registered；**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线。v0.83（2026-11-18）：**入池 REQ-030-069／P1-48（多步流程状态机合同门禁）**：委托人确认典型问题并授权起草 Spec／Plan、暂时不开发；[Spec](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md)／[Plan](lucy-20261118-multi-step-state-machine-contract-gate-plan.md) v0.1-draft；测试台 not_registered；**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线。v0.82（2026-11-18）：**入池 REQ-030-066／067／068（清单 P1-45／46／47；前方升级测试报告 LUCY-TR-20261118-01 v1.2 三则 P0）**：各配 Spec 与测试台套件；其后 P1-47 复核与暂停开关等进展见清单池 v1.29–v1.37。**不入核心分母**；≠ 可上线。；v0.81（2026-11-18）：**入池 REQ-030-070／P1-49（`lucy_ops_reader` 无头可问治理面 ACL）**：委托人确认连接启用多表而 Role 仅 W0、未开放表对无头运维有用；授权起草 Spec／Plan、暂时不开发；推荐规范 W0 指纹 heal；编号避让工作树未提交的 REQ-030-066…069；[Spec](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md)／[Plan](lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md) v0.1-draft；测试台 not_registered；**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线。v0.80（2026-11-17）：**REQ-030-060／P1-39 起草 Spec／Plan／测试台**（[Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md)、[Plan](lucy-20261117-cold-start-audit-scan-plan.md)、`UAT-SUITE-COLD-START-SLOW-DISK`；新事实：HEAD 轮询 `id > ? DISTINCT` 计划仍是整条索引全扫描，HEAD `7b882c7c` 慢盘冷启动台实测仍 `FST_ERR_HOOK_TIMEOUT` 崩溃；终稿未确权，开发未授权；≠ 可上线）。v0.79（2026-11-17）：**REQ-030-060／P1-39 根因定位登记**（本机升级演练复现：同一份 20 万行审计库，慢盘＋冷缓存下 0.25.0 `9c78b0e3` 正常启动、0.30.0 `onReady` 超时崩溃；元凶 `inferred-turn-maintainer` 启动 `scanFull`＋`abb38913` 轮询 `OR` 查询均为全索引扫描；`79db4352` 轮询去了 `OR` 但计划仍是整条索引全扫描、`scanFull` 未改、HEAD 已于 v0.80 实测仍崩溃；非客户现场直接证据；仍仅登记，≠ 开发授权；≠ 可上线）。v0.78（2026-11-17）：**REQ-030-062／P1-41 终稿确权＋开发授权＋实现已提交**（D0＝C；不含线上升级；Docker 种子容器全真 R0／01～05 PASS WITH GAP，07 BLOCKED；已提交；≠ 可上线）。v0.77（2026-11-17）：**入池 REQ-030-063／P1-42**（按钮级成功反馈真实性；仅按钮级；C 档授权；UAT 只用真实失败）。v0.76（2026-11-17）：**入池 REQ-030-062／P1-41**（访问关系图桑基还原；探查＋设计，不含开发授权；测试台 `UAT-SUITE-ACCESS-MAP-SANKEY` 基线 FAIL；不入核心分母；≠ 可上线）。v0.75（2026-11-17）：**REQ-030-061／P1-40 UAT 加固**（真实签发＋吊销 Token、真实审计数据、子用例 02a–02j、`uat:copy-probe`；PASS WITH GAP；修复已提交 `65f40847`）。v0.74（2026-11-17）：**REQ-030-061／P1-40 修复落地**（委托人「授权修复」；工作树；测试台 PASS WITH GAP）。v0.73（2026-11-17）：**入池 REQ-030-061／P1-40**（明文 HTTP 复制按钮假成功；挂 `UAT-SUITE-COPY-FAKE-SUCCESS` 首跑 FAIL；登记门禁 `lint:copy-surfaces`；修复 helper 未授权；不入核心分母）。v0.72（2026-11-17）：**入池 REQ-030-060／P1-39**（客户 K8s 平滑升级残余 event loop → readyz 超时／502／503；错题已登记；**仅入池，≠ 立项 ≠ 开发授权**；不入核心分母；≠ 可上线）。v0.71（2026-11-17）：**REQ-030-059／P1-38 修订为 v0.2-draft**（过程对抗 R1）。跟进状态与 Spec 头部同句。终稿未确权。≠ 可上线。v0.70（2026-11-17）：**入池 REQ-030-059／P1-38**（推断问询补算让出事件循环）。跟进状态与 Spec 头部同句。测试台 not_registered。终稿未确权。不入核心分母。≠ 可上线。v0.69（2026-11-17）：**REQ-030-002／P2-2 方案 B**——保持 P2；Spec／Plan 升 v0.2-draft（D15／SC-21：门户／快速入门深链「直连 vs Lucy」+ 语义配置杠杆）；≠ 开发授权；≠ 可上线。v0.68（2026-11-17）：**P1-37 U1／U4 由宽目录沙箱实证后补做；P1-36／P1-37 测试台＝PASS WITH GAP**（见各 Spec 状态与 [沙箱跑次](../qa/uat/suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md)）。v0.67（2026-11-17）：**REQ-030-057／058（P1-36／P1-37）已获开发授权，代码落地**（P1-37 仅 U2／U3a；U1／U4 无证据未改；U3b 不实现）；详见 [取证记录](../reviews/2026-11-17-p1-36-p1-37-implementation-evidence.md)；UAT＝NOT RUN。v0.66（2026-11-16）：**入池 REQ-030-057／058（P1-36／P1-37，仅文档）**：调用流水 trace 级可追溯与存档（方案 B，span 表）；MCP 体验韧性（U1–U4）。Spec [trace-span-ledger](../specs/lucy-20261116-trace-span-ledger-spec.md)／[mcp-ux-resilience](../specs/lucy-20261116-mcp-ux-resilience-spec.md)；测试台 `UAT-SUITE-TRACE-LEDGER`／`UAT-SUITE-MCP-UX-RESILIENCE`（NOT RUN）。**未获开发授权；不入核心分母；≠ 可上线**。v0.65（2026-11-16）：**REQ-030-053／054（P1-32／P1-33）开发授权已获得，实现已落地**（委托人 2026-11-15 23:47，按明示确权＋开发授权处理）；Spec [lucy-20261115-audit-export-scale-and-equivalence-guard-spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)；新增测试台 `UAT-SUITE-EQUIV-GUARD`；`UAT-SUITE-PAGE-SWEEP` 复跑 PASS WITH GAP；不入核心分母；≠ UAT PASS；≠ 可上线。v0.64（2026-11-15）：**REQ-030-055／P1-34 开发授权已获得**（委托人明示确权＋授权），实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（共 5 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）；不入核心分母；≠ UAT PASS；≠ 可上线。v0.63（2026-11-15）：**入池 REQ-030-055／P1-34**（大 Schema 接入：宽表与多表），**立项、Spec／Plan 与测试台已落盘、不含开发授权**；不入核心分母；≠ 可上线。v0.62（2026-11-15）：**入池 REQ-030-053／P1-32**（审计导出路径规模整改）与 **REQ-030-054／P1-33**（并发压测越线接口整改），均**立项、不含开发授权**；REQ-030-052 补账本夹具、`UAT-SUITE-PAGE-SWEEP`、门禁、O1 复评。不入核心分母；≠ 可上线。v0.61（2026-11-15）：REQ-030-052 只读排查完成，报告已出；5 越线、28 未测；整改待委托人决定，不含开发授权。v0.60（2026-11-15）：**入池 REQ-030-052／P1-31**。全页面事件循环与探针风险排查（P1-21 全局化）；只读排查授权，不含开发授权；不入核心分母；≠ 可上线。v0.59（2026-11-15）：**入池 REQ-030-049／P1-28、REQ-030-050／P1-29**。行级隔离场景与取值存在性缺口。测试台判定见 INDEX，本池不代替测试台。无实现 Spec，未授权实现。≠ 可上线。v0.58（2026-11-15）：**可信证据两类拆分镜像**——设计口径吸收 REQ-030-022／018／028（见 [split](lucy-20261115-trust-evidence-capability-split.md)）；未开工 **REQ-TE-*** 进 [post-0.30 池](lucy-20261115-post-030-trust-evidence-requirement-pool.md)，**不新增本池 REQ**；≠ 可上线。v0.57（2026-11-15）：**REQ-030-032 测试台 FAIL 入账**＋**入池 REQ-030-048／P1-27**（Ops 概念代码根运行时装配；GAP-UAT-P1-11-RUNTIME；复测 NOT RUN；≠ 可上线）。v0.56（2026-11-15）：**REQ-030-051／P1-30 测试台首跑 PASS WITH GAP**（`UAT-SUITE-CONTEXT-CONTENT`；WIKI-01S BLOCKED＝GAP-2；≠ 可上线）。v0.55（2026-11-14）：**入池 REQ-030-046**（P1-25 行权限能力评审；仅评审不含开发授权；不入核心分母）。v0.54（2026-11-14）：**入池 REQ-030-045**（P1-24 WebUI 存量 UI/UX 整改；Spec v0.1-draft；不含开发授权；不入核心分母）。v0.53（2026-11-14）：**入池 REQ-030-044**（P1-23 UI/UX 标准收敛并与 DEVELOPMENT 绑定；仅文档；不入核心分母）。v0.52（2026-11-14）：**入池 REQ-030-043**（P1-22 Doris／SelectDB 多版本对比环境；委托人同句「我决定以你为准，构建长期测试对比环境」＝立项＋测试环境搭建授权，不含适配代码改动；不入核心分母）。v0.51（2026-11-13）：**REQ-030-042／P1-21 测试台首跑 PASS**（必做 R0／01–04；可选 LOOP-05 BLOCKED）。v0.50（2026-11-13）：**REQ-030-042／P1-21 测试台挂套件** `UAT-SUITE-EVENT-LOOP-RELIEF`，INDEX＝NOT RUN。v0.49（2026-11-13）：**REQ-030-042／P1-21 功能合同已收口**——委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms，实测 359ms 通过。v0.48（2026-11-13）：**REQ-030-042／P1-21 镜像**——终稿确权＋开发授权，实现已落地；SC-13 通过；SC-14 livez p99 359ms 未过 300ms 门槛，按 O1 不启用 worker。v0.47（2026-11-13）：**入池 REQ-030-042**（P1-21 重读路径与探针减负；事故修复，不入核心分母）。v0.45（2026-11-13）：**差集补录 REQ-030-036…039**（P1-15…18）；对齐清单池 SOT 升格与 DEVELOPMENT「产品线执行总账」。v0.44（2026-11-13）：**REQ-030-034／P1-13 镜像对齐 Spec 现值**——landed W1-4 **路径 A**；[acceptance 代替实现 CR](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md)；**无**实现 CR PASS；≠ 可上线。v0.43（2026-11-13）：**REQ-030-035／P1-14 镜像对齐 Spec 现值**——**实现 CR 已落盘（PASS）**；vitest retrospective snapshot＋csv 11/11 复核；≠ 可上线。v0.42（2026-11-13）：**REQ-030-033／P1-12 镜像对齐 Spec 现值**——**实现 CR 已落盘（PASS）**；vitest question-budget 三文件 44/44 复核；≠ 可上线。v0.41（2026-11-13）：**REQ-030-032／P1-11 镜像对齐 Spec 现值**——**实现 CR 已落盘（PASS）**；vitest `ops-concepts` 20/20＋`concepts:test` 29/29 复核；≠ 可上线。v0.40（2026-11-13）：**REQ-030-025／026／028 Wave B O 闭合镜像**——P0-6／7／B **O 已闭合；待 R2-F**；索引行同清单池；**不是** R2-F／R4。v0.39（2026-11-13）：**REQ-030-018／P0-5 镜像对齐 Spec 现值**——**功能合同已收口（2026-11-13）**；**实现 CR 已落盘（PASS）**；去除 **Approve with nits** 分叉；≠ 可上线。v0.38（2026-11-13）：**REQ-030-022／P0-4 镜像对齐 Spec 现值**——**功能合同已收口（2026-11-13）**；**实现 CR 已落盘（PASS）**；去除 **Approve with nits** 分叉；≠ 可上线。v0.37（2026-11-13）：**登记 REQ-030-035／P1-14**（问询预算复盘审计字段；交付面 A）；R2-F＋R4；实现已落地；**不挡**原 P0；≠ 可上线。v0.36（2026-11-13）：**REQ-030-034／P1-13 发布取证出口证据齐（SC-01–SC-16）**；RPB-W2 release-medium pass。v0.35（2026-11-13）：**登记 REQ-030-034／P1-13**（发版性能基线与相对不回退；Wave 0–2 已实现）；**不挡**原 P0；≠ 可上线。v0.34（2026-11-13）：**REQ-030-031／P1-10 委托人结案**——本分支明确不做 ontology-lite CLI／WebUI／效果门跟进；产品交付只走 **REQ-030-032／P1-11 Ops MCP**；P1-10 保留上游数据／语义合同。v0.33（2026-11-11）：**补登记 REQ-030-033／P1-12**（问询预算默认阈值放宽 20／120s → 60／300s；续查仍 1）。委托人批准方案二；本分支已实现；**不挡**原 P0；≠ 可上线。v0.32（2026-11-09）：**REQ-030-025／026** Spec／Plan 升 **v0.3-draft**（Cursor 过程对抗；建议包 S／E 未闭合）；**REQ-030-028** 立项开 [物理新鲜度合同](../specs/lucy-20261109-physical-freshness-contract-spec.md) **v0.1-draft**。三条均 **终稿未确权、未授权实现**，且不改 P0-4 已冻结的 `not_checked`。v0.31（2026-11-09）：REQ-030-018／022 镜像对齐 Spec 现值——**R2-F＋R4、实现已落地、复审 Approve with nits**（未宣称可上线）。v0.30（2026-11-09）：REQ-030-032 **R4 开发授权**；实现中（Cursor）。v0.29（2026-11-09）：REQ-030-032 **R2-F＋O2＝B** 闭合（Spec／Plan v0.5）。v0.28（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.8-draft**（P0-5 共存修订）；**不表示可上线**。v0.27（2026-11-09）：**委托人正式立项**——REQ-030-032（概念注册表接入 Lucy Ops 控制面／清单 P1-11）。运维＝配置治理主线；交付序修订为效果门后 **Ops MCP 优先**（路径 A）；Spec／Plan v0.1-draft；**未授权实现**；**不挡**原 P0。v0.26（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.7-draft**（Codex R3 BLOCK 残留闭合：R2-02 `upstreamHttpStatus` 必传／收口 SC-30／**D3＝A 已确认**；**不构成 R2-F／R4**；冻结落地；未授权实现）。v0.25（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.6-draft**（Codex R2 BLOCK 闭合 R2-01／02／03，**D3 仍待委托人书面确认**；**R2-F 前必须确认 D3**；冻结落地；未授权实现）。v0.24（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.5-draft**（Codex R1 BLOCK 闭合 F01…F12，**D3 仍待委托人书面确认**；**R2-F 前必须确认 D3**；冻结落地；未授权实现）。v0.23（2026-11-09）：REQ-030-031 **配套 Plan 已开**（[concept-registry-ontology-lite-plan](lucy-20261108-concept-registry-ontology-lite-plan.md) v0.1-draft）；Spec 升 v0.3-draft；仍待评审／终稿确权；**未授权实现**。v0.22（2026-11-08）：**委托人确认入池**——REQ-030-031（轻量概念注册表 ontology-lite／清单 P1-10）。头脑风暴 Spec 草案已有；Plan 未开；交付序 CLI→效果门→WebUI→MCP；**不挡**原 P0；**未授权实现**。v0.21（2026-11-08）：**委托人选定 3 条入池**——REQ-030-028（物理新鲜度合同／清单 P0-B）、REQ-030-029（语义发布→Eval 门禁／清单 P1-8）、REQ-030-030（质量域 safe-log→Eval／清单 P1-9）。只登记缺口与期望方向；**未立项、未开新 Spec（030 挂接既有质量域 Spec）、未授权实现**。v0.20（2026-11-08）：REQ-030-027 **R4 开发授权**（Claude Code 实现）。v0.19（2026-11-07）：**REQ-030-027 O1／O2（R3）闭合**——委托人明示选项「1」＝全采纳闭合包；Spec／Plan 升 v0.8；仍待 R4；未授权实现。v0.18（2026-11-07）：**0.30 状态镜像统一 ＋ 文档版本升 v0.2-draft**——35 份 `0.30` 文档状态值统一为 `v0.2-draft，待严格评审／验收；冻结落地；未授权实现`（REQ-030-018 为 `v0.4，…`，版本号不随本轮变动）；同步落点＝Spec 头部、Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9、本池 REQ 条目；统一追加阶段子句「已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审」。**代码改动未授权。** v0.17（2026-11-07）：**第 1 轮评审（形式合规 ＋ 事实性）完成**——全部 35 份 `0.30` 文档经 Claude Code 只读分块评审（13 块），累计 findings **115 条**，逐条独立复核源码后 triage：**已修 110 条**（含 8 条「照此实现会踩坑」级：字段级门禁插入点错误、`NON_WAIVABLE_CHECKS` 无前缀族机制、PUT 默认 `dryRun=true`、失败关闭打挂整域列表 GET、runner 回落规则与字段合同相反、发布分类判定点指错、reindex 调用点漏枚举、ADR 定位漂移）；**5 条归他人未跟踪文件不代改**（清单池文件名 ＋ 缺 4 类 Plan 小节 ＋ 头部验收行 ＋ §2.2 已被取代标记）；c13 首跑撞 429，重跑中。第 2 轮对抗式评审待做。评审记录见 [0.30 批次第 1 轮评审记录](2026-11-07-lucy-0-30-spec-plan-review-round1.md)。**全部条目仍未授权实现。** v0.16（2026-11-07）：P0 全量 Spec／Plan 草案齐（022–027 等）。v0.15（2026-11-07）：**Batch S2 开 Spec/Plan（待评审、未授权实现）**——REQ-030-023 开 [Catalog 业务语义暴露](../specs/lucy-20261107-catalog-business-semantics-spec.md) Spec／Plan（装配语义层既有表级描述进目录响应；描述缺失显式标注、体积硬上限截断不丢条目、不可见 source 描述不泄漏；与 012 列级裁剪不冲突，本条不返回列）。v0.14（2026-11-07）：分批 Spec 批准；REQ-030-027 开 [question-type-caliber-binding](../specs/lucy-20261107-question-type-caliber-binding-spec.md) Spec／Plan。v0.13（2026-11-07）：**P0 立项批准**；挂接功能清单池；索引表优先级改为 P0／P1／P2。v0.12（2026-11-07）：**Batch 2–4 开 Spec/Plan（待评审、未授权实现）**——REQ-030-012 开 [语义层 Source 级业务暴露裁剪](../specs/lucy-20261107-semantic-source-field-exposure-spec.md)（双面裁剪禁半通）；REQ-030-001 开 [发布工作台分文件勾选发布](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md)（**显式修订 21 条既有约定，须 PM 批准**）；REQ-030-015 开 [语义层孤儿路径治理](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md)；REQ-030-019／020／021 开 [Eval 路径断言编排](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)／[审计旅程→Eval 草稿](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)／[批量工具反哺通道](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md)；REQ-030-008／009／010／011／014 排期进 [0.30 遗留验收执行 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md)；REQ-030-002／004 既有 Spec 开线对齐。**取证纠错两处**：runner 侧断言实为 **8 型**（分支计划「7 型」口径有误）；`review_status` **挡不住** CLI runner，「不自动进跑批」须靠路径隔离＋人工确认。v0.11（2026-11-07）：**按 2026-11-07 事故沟通实录（客户：翊总 / 田总）追加 REQ-030-027**（口径固化：问题类型 → 唯一表 + 固定口径绑定），并把沟通实录确立的事实回填至 REQ-030-022–026：**① 事故定性已定**——错表为 GPU 计提成本表（客户有权访问）⇒ **语义误报，ACL 越权排除**；② **事故有两条独立故障轴**（选错表 ＋ 口径被 AI 自行加工）；③ **止血已落地**（改语义文件、客户真实账号复测通过）；④ **已对客户承诺「每天跑测评、每天迭代」「发现问题当天修正」**——目前全靠人力，0.30 的 Eval 与运维投入即该承诺的系统化载体。v0.10（2026-11-07）：**按 2026-11-06 CFO 选表误报事故 +「0.30 重点提升 Eval 与平台运维、已有 100 用户、C-level 体感最关键」产品对话追加 REQ-030-022–026**（答复可核对性 / 选表语义暴露 / 多表命中先问 / 表级歧义门闩 / Eval 选表正确性与真实问句回灌 / 存量用户体感仪表盘与主动告警），只登记缺口，不授权实现；差距对拍、根因清单与现场取证最小清单见 [分支计划](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)。v0.9（2026-11-07）：**Batch 1 开 Spec/Plan（待评审、未授权实现）**——REQ-030-013＋016 合并为 [行权限编译门禁与各面拒绝码统一 Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md)（两组 SC：SC-01–06 对 013、SC-07–10 对 016）；REQ-030-017 开 [explain 本地诊断形状合同 Spec](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md)（SC-01–08）。取证结论：BY-19 实锤**缺的是字段级门禁**（只有形状门禁，`filters[].field` 未做字段判定），BY-06/17 实锤**工具级判定先于行策略判定**导致同语义两码；REQ-030-017 的真根因不是「少个 `summary`」，而是 ADR §2.1 的 E1–E5 编号在 ADR／实现／e2e harness 三处互斥，且 harness 断言了 ADR 未定义字段。v0.8（2026-11-07）：按 The New Stack《Why MCP servers should tell agents what to do next》（Matthew Burns 记 AWS James Ward，2026-11-07）追加 REQ-030-018–021（空结果下一步指导 / 路径断言编排面 / 审计旅程→Eval 用例草稿 / 批量工具反哺通道），只登记缺口，不授权实现；差距对拍与顺序见 [分支计划](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md)。v0.7（2026-11-07）：产品线 `lucy-v0.30` 已开线，状态改为已开线；仍不授权实现。v0.6（2026-11-05）：复核实跑归因——REQ-030-013 五合一拆分为编译门禁单条（BY-19），新增 REQ-030-016（各面拒绝码统一）/017（explain E5 形状）；BY-05 改判口径争议（Spec 99 §6 strip-then-inject 合规、harness 更严）移出池归 debug，确认收紧后再入池。v0.5（2026-11-05）：按 row-policy 强度 B 实跑归因（`inbox/row-policy-b-run-notes.md`）追加 REQ-030-013–015，只登记缺陷/能力缺口，不授权实现。v0.4（2026-11-05）：追加 REQ-030-012（语义层宽表字段暴露裁剪；澄清结论已写入条目，仍不授权实现）。v0.3（2026-11-03）：按 [D 剥离记录](../reviews/2026-11-03-product-close-peel-d.md) 追加 REQ-030-008–011。v0.2：按 [A／B](../reviews/2026-11-03-product-close-peel-a-b.md) 追加 REQ-030-002–007 |

## 目标

- 统一登记 `0.30.0` 候选版本的需求，避免散落在 UAT 反馈、对话与临时笔记里。
- 每条需求保留可追的来源（UAT 反馈页、Spec 编号、外部诉求），供开线时做优先级裁决。
- 让「本版不做」有正式落点：本池条目默认不进当前产品线，避免被误读为已承诺交付。

## 与现行版本的关系

- 当前产品线 / `VERSION` 是 **`0.30.0`**（分支 `lucy-v0.30`；见 `docs/governance/version-matrix.md`、`docs/runbooks/lucy-release-train-workflow.md` §2.2）。`lucy-v0.25` / `v0.25.0` 只接 hotfix。
- 本文件是 **`0.30.0` 需求池**。开线≠授权：池内条目默认 Deferred，**不得**因已开线而直接改代码。
- 条目被正式纳入实施前，须：需求澄清 → 独立 Spec → Plan → 开发授权。本池本身不构成其中任一步。

## 条目索引

| 新增 REQ | 标题 | 来源 | 优先级 | 状态 |
|---|---|---|---|---|
| REQ-030-087 | Agent 名册摘要投影与单对象详情按需读取 | 2026-11-20 委托人要求；109 探查：71 Agent／13,815 capability／4.83 MB | P1（清单 P1-66；性能差集） | v0.3。委托人2026-11-20批准分批收敛及本进程commit；批次A功能合同已收口；本机Docker最小验收PASS WITH GAP；批次B暂停，原v0.2完整矩阵FAIL保留；本批增量提交；未推送／发布；不入核心分母；本批收口不表示可上线。 |

新增需求（2026-11-19；先入执行总账，再起草正文）：

| REQ | 需求 | 来源 | 优先级 | 跟进状态 |
|---|---|---|---|---|
| REQ-030-099 | MCP 问询端到端性能基准与持续门禁 | 2026-11-23 委托人认定 MCP 问询体验是用户对 Lucy 的最大体感；静态核查发现完整答复性能无持续门禁、P1-53 相对基线值为 `null` 且样本／预算分档未按场景落地；同日要求只消费既有问题 spec 与初始化数据 spec，不自制题目与夹具 | P0（清单 P1-78；核心体验／发布底线；独立门禁，不改变既有核心分母） | S1｜v0.3-draft。委托人2026-11-23授权新建独立性能测试 Spec／Plan／UAT 设计；终稿未确权；开发未授权；仅设计，不执行性能跑次；不改产品优化代码；≠ 发布取证收口；≠ 可上线。 |
| REQ-030-100 | 长追问题组（性能专用，≥20 轮单进程长链） | 2026-11-23 委托人要求 MCP 问询性能门禁不自制题目；P1-54 现有追问链仅 3 轮量级，且其题库 digest 绑定 P1-53 已收口证据 | P1（清单 P1-79；测试内容；P1-78 依赖；不入核心分母） | S1｜v0.1-draft。委托人2026-11-23授权补充长追问题组并登记；终稿未确权；开发未授权；仅设计与登记；≠ 功能合同收口；≠ 可上线。 |
| REQ-030-098 | 数据问答默认主动采用业务上下文 | 2026-11-23 用户反馈「默认取语义，不取 skill/wiki，除非提示词要求」；同日 KSCC 跑次复现，Kimi 跑次为诊断对照 | P1（清单 P1-77，拟；不入核心分母） | S2｜v1.1 合同修订已获批准，待开发授权。 |
| REQ-030-096 | MCP 握手与 Agent 名册读取长尾治理 | 2026-11-23 现场名册 `DISPLAY_SNAPSHOT_BUSY` 复现与 MCP 握手审计；阶段归因待验证 | P1（清单 P1-75，拟；不入核心分母） | S2｜v1.1 合同修订已获批准，待开发授权。 |
| REQ-030-082 | 存活／就绪探针纯内存响应与诊断隔离 | 同构建 503 排查及探针读盘调用链核对；不预判现场根因 | P1（清单 P1-61；建议第一批） | v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-01真实停止／自动恢复局部复测PASS WITH GAP；完整F61矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| REQ-030-083 | 重任务跨模块容量控制与许可生命周期 | 已有局部队列不能证明不同重任务并行时的总容量有界 | P1（清单 P1-62；建议第二批） | v0.1-draft。终稿已确权（委托人 2026-11-20 明示本提示词确权）；开发授权已获得；实现已落地（本机单元与组件测试通过）；本机 Docker 局部 UAT PASS WITH GAP（仅真实导出入口；完整 F62 未完成）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。  |
| REQ-030-084 | 进程关停准入关闭与在途请求排空 | 已有清理先停 KTX，尚无全进程在途排空承诺；修订须与 Spec 191 同次评审 | P2（清单 P1-63；建议第三批） | v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-02 MCP在途登记／实际Node PID等待局部复测PASS WITH GAP；完整F63矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| REQ-030-086 | Wiki 覆盖上传采用 YAML 授权声明 | 2026-11-20 本机 demo Docker 复现：覆盖上传 `allowed_roles` 差异被默认 `preserve_current` 静默剥掉 | P1（清单 P1-65；事故修复） | v0.2。终稿已确权；开发授权已获得；实现完成；四项验证缺口已整改；改后 Docker UAT＝PASS（见测试台 INDEX）；功能合同已收口；不入核心分母；≠ 可上线。 |
| REQ-030-088 | 用户旅程性能门禁（API／WebUI 交互；MCP 已移交 P1-78） | 2026-11-20 KSC 实例（0.25.0／6d2664b3）实测 roles API 48–73 s、agents 4.8 MB 无分区（错题本）；系统性盘点：性能 runner 存在但 CI 零命中、MCP 问询延迟零预算、被测与部署版本漂移无看守 | P1（清单 P1-67；测试基建；建议） | v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan 设计；终稿未确权；开发未授权；测试台未建；不入核心分母；≠ 功能收口；≠ 可上线。 |
| REQ-030-090 | MCP执行层热重载在途保护与统一截止 | CA-03确认配置重载未消费真实MCP在途，60秒仅为回执等待 | P1（清单P1-69；可用性差集） | v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| REQ-030-091 | 正常语义写入期间MCP读取有界等待 | 候选4正常Manifest写入触发现行D3导致合法查询失败；委托人明示批准补充合同并修复 | P1（清单P1-70；可用性差集） | v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 |
| REQ-030-095 | 问询预算主路径逃生（触顶后可达 fallback） | 2026-11-22 多用户／Wave D：额度触顶后零绑定无 begin 换窗、续查仅 1 档 → 合法长问询失败关闭；门禁误报 deny | P1（清单 P1-74；主路径可用性） | S4｜实现已落地（实现 CR APPROVE）；待验收；平滑升级后 UAT＝PASS WITH GAPS（BESC-07／10A 环境 BLOCKED，非产品 FAIL）；不入核心分母；≠ 功能合同收口；≠ 可上线 | [Spec](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md) · [Plan](lucy-20261122-question-budget-mainpath-escape-plan.md) · [UAT](../qa/uat/suites/budget-escape/suite.md) · [错题](../lessons/2026-11-22-question-budget-exhausted-recurring.md) |
| REQ-030-094 | Spec 开发台状态治理（漏斗＋状态词） | 2026-11-22 状态自由长文不可机读＋英文／中文两套状态词；漏斗与状态词建议书互补一并审阅 | P1（清单 P1-73；文档治理） | S5｜v1.0。功能合同已收口（2026-11-22）。SC-01–SC-15＋实现 CR PASS；全仓 MIG 另授权。本条收口不表示可上线 | [Spec](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) · [Plan](lucy-20261122-spec-status-funnel-gate-plan.md) · [状态词建议书](lucy-20261122-spec-status-vocabulary-chinese-plan.md) |
| REQ-030-093 | 行权限自动强制执行 | FDE 反馈策略保存后被部署 env 阻断；委托人批准取消人工证明、保留隔离并落地 | P1（P1-72） | v1.0。终稿已确权；开发授权已获得；实现与 Codex CLI 代码终审完成；功能合同已收口（定向回归286项、脚本合同97项、隔离Docker39项）；测试台 UAT-SUITE-ROW-POLICY-AUTO PASS；扩展回归与全仓门禁既有缺口单列，远端CI未执行；不入核心分母；≠ 可上线。 | [Spec](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) · [Plan](lucy-20261120-row-policy-automatic-enforcement-plan.md) |
| REQ-030-092 | SQLite 风险防范与 PostgreSQL 迁移准备 | 2026-11-20 继续 SQLite、「只做准备」；2026-11-22 明示本 Spec 不开发、移入需求池作下一期目标 | P1（清单 P1-71；Deferred；下一期） | v0.1-draft。0.30 不开发；准备材料保留在需求池作下一期开发目标。源码盘点、风险差集与 Spec／Plan／UAT 设计已落盘；终稿未确权；未获开发授权；不升级、不迁移、不操作客户实例；测试台 NOT RUN；不入核心分母；≠ 功能合同收口；≠ 可上线。 | [Spec](../specs/lucy-20261120-storage-readiness-spec.md) · [Plan](lucy-20261120-storage-readiness-plan.md) · [UAT](../qa/uat/suites/storage-readiness/suite.md) · [盘点](../reviews/2026-11-20-storage-readiness-inventory.md) |
| REQ-030-089 | 运维步骤账（Lucy 运维与 IT 运维） | 2026-11-13 至 2026-11-20 现场报错：探针与事件循环只能证明卡住，不能指出步骤；准备表结构的原因留在容器日志 | P1（清单 P1-68；运行观察；建议） | S5｜v1.0；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。终稿已确权；开发授权已获得；实现与独立代码评审完成；本机 demo Docker 平滑升级后 UAT-SUITE-OPS-STEP R0／01–08 全真 PASS（gitSha=88b2e9ea；跑次 [2026-11-22-cursor-ops-step](../qa/uat/suites/ops-step/runs/2026-11-22-cursor-ops-step.md)）；设计值重度项写入收口范围。不入核心分母；≠ 可上线。 |
| REQ-030-079 | 角色权限与 Agent 列表读取响应、展示复用与统计减负 | 高频卡顿只读探查；历史日志聚合与角色上下文重复构建 | P1（清单 P1-58；第一批） | S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）。证据＝batch1＋[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。测试台仍 PASS WITH GAP（仅B1）。不入核心分母。≠ 可上线 |
| REQ-030-080 | 角色权限与 Agent 多人编辑的对象级冲突与草稿恢复 | 共用配置版本造成无关对象冲突；多人同账号与独立账号场景 | P1（清单 P1-59；第二批） | S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）。证据＝batch1＋[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。测试台仍 PASS WITH GAP（仅B1）。不入核心分母。≠ 可上线 |
| REQ-030-081 | begin 价值重评与零绑定 MCP 问数不受影响 | 2026-11-19 MCP 故障只读排查；2026-11-20 批准隐藏 begin；同日终稿确权＋T1–T5 开发授权 | P0（清单 P1-60；P0-1 修复） | v0.9；功能合同已收口（SC-01–12通过，P1-60／P1-64同一冻结候选完整复验）；预算持久化锁竞争修复纳入；本轮增量已提交；未推送／发布；不入新增核心分母；本条收口不表示可上线。 |

正文与双向回链见本文末 REQ-030-079／080；现行跟进 SOT 仍为执行总账。

| ID | 标题 | 来源 | 优先级 | 状态 |
|---|---|---|---|---|
| REQ-030-001 | 发布工作台：分文件勾选发布 | 2026-11-02 `/publish/workbench` UAT 反馈 | **P2**（清单 P2-1） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-publish-workbench-per-file-selection](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md) |
| REQ-030-002 | 帮助中心体验（L25-12） | Spec `lucy-20261031-help-center-experience` **v0.5-draft**（含 D15；2026-11-19 对标对象修正 ＋ D17 裁决 ＋ D19／D20 纳入 ＋ D21 MD 标配） | **P2**（清单 P2-2） | Deferred；**2026-11-16 方案 B**：开线时门户／快速入门深链「直连 vs Lucy」+ 配置杠杆；不抬成核心分母 P0。**2026-11-19 修正对标对象**为 `https://www.kimi.com/code/docs/`（＋第二参考站 KTX Quickstart）；**D17 首页形态已裁决**＝概览内容页；**D19 错误参考章 ＋ D20 逃逸出口已纳入**（SC-24／SC-25）；**D21 MD 标配**（复制 Markdown 覆盖四处载体页、解除 D6 整本限制；SC-26） |
| REQ-030-003 | 访问关系图与访问日志口径对齐 | Spec `lucy-20261102-access-map-audit-echo` | 已收口 | **已拉出；功能合同已收口（2026-11-04）**。S1–S3 已落地；SC-14 逐边在出口；SC-12 页序子句已拆出。本条收口不表示可上线。不进 `0.25.0` |
| REQ-030-004 | 运维控制面 W-B（语义发布） | L25-16 W-B；Spec `lucy-20261028-v0p25-lucy-ops-control-plane` | **P2**（清单 P2-3） | Deferred — 不进 `0.25.0` |
| REQ-030-005 | 客户升级 E2E 自动化（L25-07） | Spec `lucy-20261025-v0p25-upgrade-e2e-automation` | **P2**（清单 P2-4） | Deferred — 发布取证；不进 `0.25.0` 产品分母 |
| REQ-030-006 | 升级候选验证环境（L25-13） | Spec `lucy-20261025-v0p25-upgrade-candidate-verification` | **P2**（清单 P2-5） | Deferred — 发布取证；不进 `0.25.0` 产品分母 |
| REQ-030-007 | E2E 主线与旁线优化（harness） | Spec `lucy-20261025-v0p25-e2e-mainline-and-branch-optimization` | **P2**（清单 P2-6） | Deferred — 工程 harness；不进 `0.25.0` 产品分母 |
| REQ-030-008 | 访问关系图 Spec 187 验收矩阵 | `webui/docs/187-access-relation-sankey-spec.md` SC-01–14 | **P2**（清单 P2-7） | **已排期 `0.30` 遗留验收执行 Plan（v0.2-draft，2026-11-07）**，待严格评审；冻结落地；**未授权执行**。见 [lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-009 | OIDC 功能合同验收（L25-06） | Spec `lucy-20261025-v0p25-oidc-single-sign-on` OIDC-01–21／26 | **P2**（清单 P2-8） | **已排期 `0.30` 遗留验收执行 Plan（v0.2-draft，2026-11-07）**，待严格评审；冻结落地；**未授权执行**。见 [lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-010 | 语义整批恢复 SRR 验收（L25-15） | Spec `lucy-20261027-v0p25-semantic-release-restore` SRR | **P2**（清单 P2-9） | **已排期 `0.30` 遗留验收执行 Plan（v0.2-draft，2026-11-07）**，待严格评审；冻结落地；**未授权执行**。见 [lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-011 | 运维控制面 W-A VOPS 验收 | L25-16 W-A；VOPS（除已拆出） | **P2**（清单 P2-10） | **已排期 `0.30` 遗留验收执行 Plan（v0.2-draft，2026-11-07）**，待严格评审；冻结落地；**未授权执行**。见 [lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-012 | 语义层宽表字段暴露裁剪 | 2026-11-05 产品澄清（对话登记） | **P0 伴生**（清单 P0-A） | **P0 立项批准**；**已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-semantic-source-field-exposure](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) |
| REQ-030-013 | 行权限行策略编译门禁（度量/派生列作谓词字段零上游执行） | 2026-11-05 row-policy 强度 B 实跑（BY-19） | **P1**（清单 P1-2） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec/Plan 见 [lucy-20261107-row-policy-compile-gate-deny-code](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) |
| REQ-030-016 | 行权限各面拒绝码统一（row_policy_requires_wrapped_tool） | 2026-11-05 row-policy 强度 B 实跑（BY-06/17） | **P1**（清单 P1-2） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。与 REQ-030-013 合并为同一条 Spec（两组 SC）。Spec 见 [lucy-20261107-row-policy-compile-gate-deny-code](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) |
| REQ-030-017 | lucy_explain_query 诊断形状补全（E5 summary） | 2026-11-05 row-policy 强度 B 实跑（BY-18） | **P1**（清单 P1-3） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-explain-diagnostic-shape-contract](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md) |
| REQ-030-014 | 行权限模板展开保留 templateRefs | 2026-11-05 row-policy 强度 B 实跑（ROW25-V01/V03、RTP25-02） | **P1**（清单 P1-7） | **已排期 `0.30` 遗留验收执行 Plan（2026-11-07），待评审、未授权执行**；归属行权限视图 Spec SC-10，而该 Spec 处于已收口态，**须 PM 批准重开并在尾部追加编号**。见 [lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| REQ-030-015 | 语义层孤儿路径治理（lucy-ops 反查孤儿） | 2026-11-05 row-policy 强度 B 实跑（RTV25-06） | **P1**（清单 P1-1） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-semantic-orphan-path-governance](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md) |
| REQ-030-018 | 空结果（0 行）响应的结构化下一步指导 | 2026-11-07 The New Stack《Why MCP servers should tell agents what to do next》 | **P0**（清单 P0-5） | **v0.8；R2-F＋R4 已闭合（2026-11-09）**；**功能合同已收口（2026-11-13）**；**实现 CR 已落盘（PASS，2026-11-13）**（vitest 空结果 33/33）。**本条收口不表示可上线**。可信证据「只揭示不拦截」吸收见 [split A3](lucy-20261115-trust-evidence-capability-split.md)。见 [lucy-20261107-empty-result-next-step-guidance](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) · [实现 CR](../reviews/2026-11-13-p0-5-empty-result-next-step-code-review.md) |
| REQ-030-019 | Eval 路径断言在 WebUI 侧可编排 | 同上 | **P0 最小面／P1 完整面**（清单 P0-6／P1-4） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-eval-tool-assertion-authoring](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) |
| REQ-030-020 | 审计问询旅程 → Eval 用例草稿导出 | 同上 | **P0 最小面／P1 完整面**（清单 P0-6／P1-5） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-audit-journey-eval-case-draft](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) |
| REQ-030-021 | 循环单查 → 批量/聚合工具反哺通道 | 同上 | **P1**（清单 P1-6） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-eval-failure-to-tool-surface-feedback](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md) |
| REQ-030-022 | 答复可核对性（CFO 当场可核验来源/口径/数据截止期） | 2026-11-06 CFO 选表误报事故 | **P0**（清单 P0-4） | **v0.4；R2-F＋R3＋R4 已闭合（2026-11-09）**；**功能合同已收口（2026-11-13）**；**实现 CR 已落盘（PASS，2026-11-13）**（SC-16／17／21／22 夹具证据已补全；vitest `answer-verifiability` 26/26）。O1＝A／O2＝A。**本条收口不表示可上线**。可信证据分轨原则吸收见 [split A2](lucy-20261115-trust-evidence-capability-split.md)；路径覆盖续作 → [REQ-TE-001](lucy-20261115-post-030-trust-evidence-requirement-pool.md)。见 [answer-verifiability](../specs/lucy-20261107-answer-verifiability-spec.md) · [实现 CR](../reviews/2026-11-13-p0-4-answer-verifiability-code-review.md) |
| REQ-030-023 | 选表语义暴露（catalog 携带表描述） | 同上 | **P0**（清单 P0-2） | **已开 Spec/Plan（v0.2-draft）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。见 [catalog-business-semantics](../specs/lucy-20261107-catalog-business-semantics-spec.md) |
| REQ-030-024 | 多表命中先问 + 表级歧义门闩 | 同上 | **P0**（清单 P0-3） | **已开 Spec/Plan（v0.2-draft）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。见 [source-ambiguity-gate](../specs/lucy-20261107-source-ambiguity-gate-spec.md) |
| REQ-030-025 | Eval 选表正确性断言与真实问句回灌 | 同上 | **P0**（清单 P0-6） | **Spec／Plan v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O3 已闭合（2026-11-13）＝建议包 S；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4。见 [eval-source-selection-correctness](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) |
| REQ-030-026 | 存量用户体感仪表盘与主动告警 | 2026-11-07 产品对话（100 用户 / C-level 体感） | **P0**（清单 P0-7） | **Spec／Plan v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F／R4。见 [stored-user-experience-dashboard-alerts](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) |
| REQ-030-027 | 口径固化（问题类型 → 唯一表 + 固定口径绑定） | 2026-11-06 事故（口径被 AI 自行加工）＋ 2026-11-07 沟通实录 | **P0**（清单 P0-1） | **Spec／Plan v0.9；R4 已授予（2026-11-08）；实现中**；不表示可上线。见 [question-type-caliber-binding](../specs/lucy-20261107-question-type-caliber-binding-spec.md) |
| REQ-030-028 | 物理新鲜度合同（答复截止期真源） | 2026-11-08 能力盘点（模型／语义／Eval）＋ 强化 P0-4 | **P0 伴生**（清单 P0-B） | **Spec／Plan v0.1-draft；O1–O3 已闭合（2026-11-13）＝建议包 F；待 R2-F；终稿未确权；冻结落地；未授权实现**。不改 P0-4 的 `not_checked`。**不是** R2-F／R4。可信证据物理真源口径吸收见 [split A1](lucy-20261115-trust-evidence-capability-split.md)；监控型失败揭示 → [REQ-TE-003](lucy-20261115-post-030-trust-evidence-requirement-pool.md)。见 [physical-freshness-contract](../specs/lucy-20261109-physical-freshness-contract-spec.md) |
| REQ-030-029 | 语义发布 → Eval 门禁 | 2026-11-08 能力盘点；前身见 2026-08-26 变更触发回归 | **P1**（清单 P1-8） | **2026-11-08 入池**；待需求澄清与立项开 Spec；依赖 P0-6 骨架；**不挡**原 P0；**未授权实现** |
| REQ-030-030 | 质量域 safe-log → Eval 候选回流 | 2026-11-08 能力盘点；既有 2026-10-14 质量域 Spec 未落地 | **P1**（清单 P1-9） | **2026-11-08 入池**；挂接既有 [safe-log-to-quality-eval Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md)（功能合同未收口）；待澄清与 0.30 跟进对齐；**未授权实现** |
| REQ-030-031 | 轻量概念注册表（ontology-lite；上游合同） | 2026-11-08 头脑风暴（指标权威面 × KG／本体） | **P1**（清单 P1-10） | **委托人结案（2026-11-13）**：本分支不做 CLI／WebUI／效果门跟进；产品交付只走 **REQ-030-032／P1-11 Ops MCP**；保留上游数据／语义合同；**不挡**原 P0。Spec／Plan／[评审](../reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md) |
| REQ-030-032 | 概念注册表接入 Lucy Ops 控制面 | 2026-11-09 委托人：运维＝配置治理；CLI 不适合长期交付；正式立项并进 Ops；本版 Ops 检查完毕后下版再评估 WebUI | **P1**（清单 P1-11） | **v0.5；功能合同层已收口（SC-01–SC-22）；实现 CR 已落盘（PASS，2026-11-13）**；**测试台 FAIL（2026-11-15）**（授权 PASS／业务受理 FAIL；GAP-UAT-P1-11-RUNTIME；伴生 REQ-030-048）；本条不表示可上线；**不挡**原 P0。Spec／Plan／[实现 CR](../reviews/2026-11-13-p1-11-concept-registry-ops-code-review.md) · [UAT](../qa/uat/suites/ops-concepts/suite.md) |
| REQ-030-048 | Ops 概念核心代码根与运行时装配修复 | 2026-11-15 UAT FAIL：容器拆卷下从 `/data/lucy` 加载 `scripts/concepts` → 502／`ERR_MODULE_NOT_FOUND` | **P1**（清单 P1-27） | **S5｜v0.7；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**。R2-F＋R4 已闭合；开发授权已获得；实现已落地；SC-01–SC-09 通过；测试台复测 PASS；GAP-UAT-P1-11-RUNTIME 已关闭；不入核心分母；≠ 可上线。见 [Spec](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md) · [Plan](lucy-20261115-ops-concept-code-root-runtime-fix-plan.md) · [UAT](../qa/uat/suites/ops-concepts/suite.md) |
| REQ-030-033 | 问询预算默认阈值放宽（60 次／300s） | 2026-11-11 产品对话：高频分析用户体验；保留防火墙、放宽次数与忙时 | **P1**（清单 P1-12） | **S5｜v1.0；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**。委托人批准方案二并已实现（本分支，2026-11-11）；实现 CR 已落盘（PASS，2026-11-13）；vitest question-budget 三文件 44/44；SC-T1–T5 通过；**不挡**原 P0；≠ 可上线。见 [question-budget-threshold-relax](../specs/lucy-20261111-question-budget-threshold-relax-spec.md) · [实现 CR](../reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md) |
| REQ-030-034 | 发版性能基线与相对不回退（WebUI＋MCP） | 2026-11-13 Agent／Roles 卡顿复盘；Spec 174 覆盖缺口 | **P1**（清单 P1-13） | **v0.2；R2-F＋R4；发布取证出口证据齐（SC-01–SC-16；2026-11-13）；书面登记「发布取证 acceptance 代替实现 CR」**；**不挡**原 P0。见 [release-perf-baseline-gate](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) · [acceptance](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md) · [W1-4 A](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md) |
| REQ-030-035 | 问询预算复盘审计字段（交付面 A） | 2026-11-13 产品对话：60／300 放宽后需可复盘调参；审计快照＋calls.csv | **P1**（清单 P1-14） | **S5｜v1.0；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**。R2-F＋R4；开发授权已获得；实现已落地；实现 CR 已落盘（PASS）；SC-R1–R12 通过（vitest retrospective 11/11）；**不挡**原 P0；≠ 可上线。见 [question-budget-retrospective-audit](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md) · [实现 CR](../reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md) |
| REQ-030-036 | 连接写路径 → 执行层热重载 + 成功面诚实 ack | Spec 191 续作；中间态／user-facing「连接与执行层」 | **P1**（清单 P1-15） | **S5｜功能合同已收口（2026-11-22，漏斗镜像·文档收口）**：create＋C01＋live E2E／UAT-01；Edit 成功面三段事实 CLOSED；测试台 `UAT-SUITE-CONN-RELOAD`＝PASS；收口范围不含可选 UAT-CONN-RELOAD-02；**不入核心分母**；**不挡**原 P0；≠ 可上线。见 [Spec 191](../../webui/docs/191-execution-runtime-reload-spec.md) · [Plan](lucy-20261112-connection-create-execution-runtime-reload-plan.md) · [收口](../reviews/2026-11-13-connection-reload-middev-closure.md) |
| REQ-030-037 | 库内扫表读法（Doris 外部目录 Hive + 普通 MySQL） | 2026-11-11 客户现场事故（hive-1／hive-jd／marketingapi／tblu） | **P1**（清单 P1-16） | **功能合同已收口（2026-11-13）**；**不入核心分母**；**不挡**原 P0。字段续作见 REQ-030-041。见 [catalog-scan-read-path](../specs/lucy-20261111-catalog-scan-read-path-spec.md) · [证据审计](../reviews/2026-11-13-catalog-scan-read-path-sc-evidence-audit.md) |
| REQ-030-041 | 外部目录单表读字段（直连） | 2026-11-13：hive-1／dim 能列表、选中表「没有读到字段」 | **P1**（清单 P1-20） | S1｜主体 v0.2 及 §8 v0.4 已确权并实现；本轮真实 Doris→Hive 字段读取及 F02／F03 预算回归通过，指定慢语法拒绝按已授权 D5 受控降级并单列边界。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 [external-catalog-column-read Spec](../specs/lucy-20261113-external-catalog-column-read-spec.md) · [Plan](lucy-20261113-external-catalog-column-read-plan.md) |
| REQ-030-042 | 重读路径与探针减负（访问日志后台重建＋健康探针拆分） | 2026-11-13 客户实例（0.25.0）：系统概览报「页面数据暂时无法完成刷新」、Pod liveness 被杀；实测 `/turns?hours=168` 阻塞 >90s、`/api/diff` 27s | **P1**（清单 P1-21） | **S5｜功能合同已收口（2026-11-13）**。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（R0／01–04）。≠ 可上线。 **不入核心分母**。见 [Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) · [Plan](lucy-20261113-heavy-read-path-and-probe-relief-plan.md) · [性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md) · [UAT](../qa/uat/suites/event-loop-relief/suite.md) · [跑次](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md) |
| REQ-030-038 | 访问关系图空桑基修复 | 中间态出口半成品收口 | **P1**（清单 P1-17） | **CLOSED（2026-11-13）**；**不入核心分母**。见 [closure](../reviews/2026-11-13-access-map-sankey-empty-fix-closure.md) |
| REQ-030-039 | MCP 客户端 Skill 入口镜像（改挂 `/mcp`） | 中间态出口半成品收口 | **P1**（清单 P1-18） | **CLOSED（2026-11-13）**；工程向；**不入核心分母**。见 [Spec](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) · [closure](../reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md) |
| REQ-030-040 | 访问关系图允许词表对齐（`ok`／`allow`） | 空桑基 UAT F-1（2026-11-13） | **P1**（清单 P1-19） | **S5｜v0.1；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**。实现已落地（2026-11-13）；vitest access-map 三文件 76/76；SC-01–SC-03 通过；测试台复跑 PASS（2026-11-14，UAT-04 关闭 F-1）；**不入核心分母**。见 [Spec](../specs/lucy-20261113-access-map-outcome-vocabulary-spec.md) |
| REQ-030-043 | Doris／SelectDB 多版本对比环境（2.0.14 基线 vs 4.0.8） | 2026-11-14：客户现网 Doris 2.0.14 计划升级到 4.x（版本不详）；Lucy 无版本探测、无 Doris 测试环境（支持矩阵 `gated`） | **P1**（清单 P1-22） | S1｜**入池（2026-11-14）**；立项＋测试环境搭建授权，范围仅对比环境、版本探测与证据，**不含**适配代码；Spec／Plan 待补＝**无终稿可确权**；**≠ S2**；**不入核心分母**；≠ 可上线 |
| REQ-030-044 | UI/UX 标准收敛并与 DEVELOPMENT 绑定 | 2026-11-14 核对：设计系统多章停在 2026-08-04 v1.0；`99-governance.md` 五条临时决策对应 Spec 已实现／收口仍未升格；缺 Drawer／Dialog、空状态、加载与错误态等章；DEVELOPMENT 无统一入口 | **P1**（清单 P1-23） | **入池（2026-11-14）**；委托人批准登记＋清临时决策，范围仅文档；补缺章／改 DEVELOPMENT／新增 lint 另行确认；**不入核心分母**；≠ 可上线 |
| REQ-030-045 | WebUI 存量 UI/UX 整改（逐页） | 2026-11-14 对照设计系统盘点 `webui/src/`：手写 Drawer 17 个（13 个无 `Esc`）、Modal 7 个（2 个缺对话框语义）、评测页 3 个文件表格未用 `pl-data-grid`、`lint:url-driven-input`／`lint:terminology` 各有存量红灯 | **P1**（清单 P1-24） | **立项（2026-11-14）**；Spec v0.2-draft 登记 UXR-01–15（含浏览器盘点，UXR-07 已关闭）；**不含开发授权，本阶段只做优化方案**；**不入核心分母**；≠ 可上线 |
| REQ-030-046 | 行权限能力评审（100 用户／30–40 人行级受限） | 委托人 2026-11-14 定为下阶段核心能力；需判断既有行权限 Spec 与落地实现能否支撑约 100 用户、其中 30–40 人按特定权限做行级限制 | **P1**（清单 P1-25） | **评审报告 v1.0 已出（2026-11-14），待委托人裁决**（[报告](../reviews/2026-11-14-row-policy-capability-assessment.md)）；仅评审（Spec 审阅＋代码核对＋浏览器实测），**不含开发授权**；**不入核心分母**；场景验收见 REQ-030-049；≠ 可上线 |
| REQ-030-049 | 行级隔离场景（十几人 × 一批表 × 不同行范围） | 委托人 2026-11-15：行级权限是 0.30 核心能力，要经受典型财务／业务分析场景 | **P1**（清单 P1-28） | **入核心分母**。无独立 Spec，未授权实现，不改既有行权限 Spec 状态。测试台 [`UAT-SUITE-ROW-POLICY`](../qa/uat/suites/row-policy-finance-scenario/suite.md)，判定见 INDEX。≠ 可上线 |
| REQ-030-050 | 行级取值存在性校验 | 同一场景：配错的行取值不能静默当成没有业务发生 | **P1**（清单 P1-29；Deferred；下一期） | **X_DEF｜Deferred；下一期**。委托人 2026-11-22：「放在需求池，下一次迭代在优化」。0.30 不开发；**不入核心分母**；**不挡** P1-28 套件 PASS。无实现 Spec，未授权实现。测试台同一套件 UAT-ROW-07／`GAP-UAT-P1-28-VALUE` 仍开。≠ 可上线 |
| REQ-030-052 | 全页面事件循环与探针风险排查（P1-21 全局化） | 2026-11-15：P1-21 只处理访问日志、`/api/diff` 与探针；服务端约 40 个文件同步 SQLite、无 worker、20 余个带时间窗接口未逐项量化；压测里的概览负载曾因缺 `access.yaml` 空转成 500 | **P1**（清单 P1-31） | **只读排查已完成（2026-11-15）**，[报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)已出；已补账本夹具、门禁 `sweep:event-loop:gate` 与测试台 `UAT-SUITE-PAGE-SWEEP`（首跑 FAIL）；越线整改见 REQ-030-053／054，**不含开发授权**。**不入核心分母**。≠ 可上线 |
| REQ-030-053 | 审计导出路径规模整改 | 2026-11-15 P1-31 排查：F-1 `export-inquiry-pack` 单次约 114–118 秒、Chart 存活探针连续失败 37 次；F-6 v2 导出在全量或 ≥14 天范围返回 409 `too many SQL variables`（合成账本夹具补上后才暴露） | **P1**（清单 P1-32） | **开发授权已获得，实现已落地（2026-11-16）**，Spec 见 v0.65；`UAT-SUITE-EQUIV-GUARD`／`UAT-SUITE-PAGE-SWEEP` PASS WITH GAP。**不入核心分母**。≠ UAT PASS；≠ 可上线 |
| REQ-030-054 | 并发压测越线接口整改 | 2026-11-15 P1-31 排查：F-2 `access-map`、F-3 `governance/overview`、F-4 审计导出两条、F-5 `ui-usage/overview`、F-7 `reconciliation/export` 单次 0.2–2 秒，并发压测期间 livez 超 400ms | **P1**（清单 P1-33） | **开发授权已获得，实现已落地（2026-11-16）**，Spec 见 v0.65；`UAT-SUITE-EQUIV-GUARD`／`UAT-SUITE-PAGE-SWEEP` PASS WITH GAP。**不入核心分母**。≠ UAT PASS；≠ 可上线 |
| REQ-030-055 | 大 Schema 接入（宽表与多表） | 2026-11-15 本机真实规模诊断：外部目录 2000 列起整张表被拒；MySQL 逐表约 0.93 秒、600 张约 9 分钟；客户端累积二次方（600 张×30 列 10 秒内只完成 144 张）；失败即整批终止。客户有「小库很快、大库拉取失败」先例 | **P1**（清单 P1-34） | v0.2.2 主体及 LS-01–18 既有结论保留；§11 v0.5 已由委托人确认并授权实施，R1／R2 修复完成，LS-19–30 本轮本机功能验收通过。真实 MySQL 混合权限按 D5 受控降级，合法字段真实；正常规模套件本跑次通过，历史 SCALE-09 偶发超时未归因记录保留。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。  |
| REQ-030-056 | 表级歧义门闩：纯 MCP 逃生与拒绝载荷持久修复（P0-3 伴生） | 父 P0-3 强门禁后纯 MCP 合法多表／钉选集外无逃生；委托人 2026-11-16 批准钉选放行＋容错披露三档并授权开发 | **P1**（清单 P1-35） | S5｜v0.4。功能合同已收口（2026-11-22，P1-73／P1-35 S5 收口批）。ESCAPE INDEX＝PASS（含 ESC-11）；SC-E 证据＋实现 CR PASS；GAP-UAT-P0-3-ESCAPE 已关。不入核心分母。本条收口不表示可上线 | [Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) · [Plan](lucy-20261116-source-ambiguity-mcp-escape-plan.md) · **测试台** [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) |
| REQ-030-057 | 调用流水 trace 级可追溯与存档 | 2026-11-16 客户全量调用流水（23,687 条）评估：协议请求无 `trace_id`（61%）；`primary_status=unknown` 64%；无阶段耗时无法定位握手长尾；`client_ip` 仅 2 个取值（网关）；`error_detail` 含内网地址与存储路径 | **P1**（清单 P1-36） | S5｜v1.1；功能合同已收口（2026-11-22，scoped；裁定包 F-3=A／F-2=B／TRC=B）。证据＝沙箱 Tier-A＋[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。**不入核心分母**。≠ 可上线 |
| REQ-030-059 | 推断问询补算让出事件循环 | 2026-11-17 客户 `0.30.0`（`abb389133356`）升级后探针来回，站点已回滚 | **P1**（清单 P1-38） | 主体 v0.2-draft 终稿未确权；§8 v0.4 已确权并实现，§8.9 已获委托人确认补验。SC-11–16 本轮证据补齐：完整窗口至少20万调用、三轮默认冷启动通过，含3163行原用户闭包完整收敛。P3 的 ↓ 保留，SC-16 补偿在受测范围通过；O3 存量批量标脏仍未授权。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 [Spec](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md) · [Plan](lucy-20261117-inferred-turn-rebuild-yield-plan.md) |
| REQ-030-058 | MCP 体验韧性（握手、失败信息、会话恢复、快速失败） | 同上流水：`initialize` 日中位数 10 ms→1.6 s、尾部 403 s；门闩拒绝 P95 57 s；177 次原样重试被拒；557 次 404 无退避；业务侧 `lucy_query` 成功率门闩前 92.0%／后 68.1% | **P1**（清单 P1-37） | S5｜v1.1；功能合同已收口（2026-11-22，scoped；裁定包 U1=A／GAP=B）。证据＝沙箱 Tier-A＋[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。测试台仍 PASS WITH GAP。不重复 P1-35；告警挂 P0-7（冻结）。**不入核心分母**。≠ 可上线 |
| REQ-030-060 | 客户 K8s 平滑升级：残余 event loop 卡顿导致 readyz 超时／入口 502／503 | 2026-11-17 客户 `lucyadm.matrixback.com` 升 Lucy 0.30.0（`abb389133356`）：event loop p99≈2210ms；livez 1.5–2.2s；readyz 常超 Helm 3s → Ready=False → 502／503；health MCP 1500ms 探针误报 degraded；KTX 仍 healthy；已回滚。阻塞点函数未定位 | **P1**（清单 P1-39） | S5｜v0.3；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。终稿已确权、开发已授权（不含 schema 变更、不含线上升级）；启动补算与稳态轮询已改为有界读取，审计库打开与迁移在 app.listen 前完成；vitest 守卫及 SC-01–SC-17 出口通过。不入核心分母。≠ 可上线
| REQ-030-061 | 明文 HTTP 复制按钮假成功：共享 helper 谎报「已复制」 | 2026-11-17 公网演示版本页复制无效；本机局域网 IP 复现。`webui/src/lib/clipboard.ts` 降级路径选区为空，`execCommand("copy")` 仍返回 true；15 个调用点共享。单测与 e2e 因 stub／回环一直绿 | **P1**（清单 P1-40；优先级待委托人裁定） | **事故入池 → 修复已落工作树（2026-11-17）**：委托人「授权修复」；测试台 `UAT-SUITE-COPY-FAKE-SUCCESS` 改前 FAIL → 改后 PASS WITH GAP。未提交合入。**不入核心分母**。≠ 可上线 |
| REQ-030-062 | 访问关系图桑基还原：线上镜像缺修复；HEAD 在零访问／多 Agent／全未确认下仍退化 | 2026-11-17 委托人：「当前并没有实现桑基图的效果，严重偏离设计意图」。线上 `gitSha=6d2664b3` 不含 `f3f88837`、`e2ca2ca7`；沙箱 A/B：旧码 `accessPaths=0`，HEAD `20`；HEAD `dense` 76／77 柱高为 0 | **P1**（清单 P1-41） | S5｜v0.2；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。D0＝C；终稿由委托人明示确权；已授权并实现 A2／A3 与 Track B 方案 C，已提交。不入核心分母。≠ 可上线
| REQ-030-063 | 按钮级「成功反馈真实性」排查：下载／保存／导出 | P1-40（复制假成功）同类排查发现：成功反馈是否以动作真实结果为前提是一类缺陷（如 Onboarding 把 `{ ok }` 对象当布尔）。委托人认可扩展到下载、保存、导出，**仅按钮级** | **P1**（清单 P1-42） | S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `f1436556`；lite Spec 已立；测试台仍 PASS WITH GAP。[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。**不入核心分母**。≠ 可上线 |
| REQ-030-064 | Lucy 不透出数据库原始错误：外部目录读字段失败时无法区分成因 | 2026-11-18 客户 `hive_jd` 排障：本机 Kerberos 模拟确认反向解析不一致、时钟偏差、HMS 起不来、HMS 变慢四种成因在页面同为「没有读到字段」，Doris 原文只在容器日志；`SchemaColumnRejection` 仅 `{table, reason}` 枚举。委托人评价「很重要」 | **P1**（清单 P1-43；优先级待委托人裁定） | **仅登记（2026-11-18）**；Spec v0.1-draft 已登记（委托人「先登记 spec 即可，不开发」）；终稿未确权；未获开发授权；不改运行代码。**不入核心分母**。≠ 可上线 |
| REQ-030-065 | 页面渲染崩溃被兜底页伪装成版本问题：访问日志调用流水整页不可用 | 2026-11-18 委托人报「访问日志打不开」：调用流水合并进的 `auth_failure` 行无 `tool`，故事线渲染崩溃；`RouteChunkBoundary` 把所有渲染错误显示为「页面资源加载失败，可能是版本已更新」。`release-ux` 错误判定不含该文案，`PAGE-SWEEP` 不渲染页面，两者都未拦住 | **P1**（清单 P1-44） | S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `c1f54f64`；lite Spec 已立；测试台仍 PASS WITH GAP。[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。不入核心分母。≠ 可上线 |
| REQ-030-066 | 推断问询重建中断后自动恢复（前方报告 P0-02） | 前方 LUCY-TR-20261118-01 v1.2：71e5b941 硬复现中断后残缺推断被判覆盖、重启不补算（2986→610） | **P1**（清单 P1-45） | **S5｜v0.2＋P1-50 水位注记；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**：终稿确权＋开发授权；实现已落地；SC-01–SC-08 通过；`UAT-SUITE-INFERRED-REBUILD-RECOVERY` PASS（2026-11-18-cursor-irr；P1-57-G8 真实 SIGKILL 复验通过）；不入核心分母；≠ 可上线 |
| REQ-030-067 | readyz 与 MCP 监听就绪一致性（前方报告 P0-03） | 同报告：readyz 200 后首次 MCP initialize 失败（启动窗） | **P1**（清单 P1-46） | **S5｜v0.2；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**：终稿确权＋开发授权；实现已落地；SC-01–SC-06 通过；`UAT-SUITE-READYZ-MCP-LISTEN` PASS（2026-11-18-cursor-rml）；不入核心分母；≠ 可上线 |
| REQ-030-068 | 满量重建负载下探针预算内响应（前方报告 P0-01） | 同报告：满量 F 部分复现 readyz 3,004ms；前置同步删除／编号事务待治理 | **P1**（清单 P1-47） | **S5｜v0.7；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）**：终稿确权＋开发授权；削峰已落地（写片 2–8；`write_slice`／窗口 DELETE／PASSIVE off-thread；30 天回看不变）；SC-01–SC-10 通过；`UAT-SUITE-REBUILD-PROBE-BUDGET` PASS（shave2-default RPB-09＝3／3；P1-57-G7／G9 测程纠正后复验通过）；暂停仍为交付安全带；不入核心分母；≠ 可上线 |
| REQ-030-069 | 多步流程状态机合同门禁：Spec 须可解析状态机合同；lint 拦缺项 | 2026-11-18 对话：未显式状态机导致假成功、非终态失忆、死路、规则分叉等典型缺陷；委托人授权起草 Spec／Plan，暂时不开发 | **P1**（清单 P1-48；优先级待委托人裁定） | **入池＋Spec／Plan（2026-11-18）**：v0.1-draft；落地限文档门禁与 `lint:spec-docs`；不改业务运行时；测试台 not_registered。**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线 |
| REQ-030-070 | `lucy_ops_reader` 无头可问治理面 ACL：规范 W0 指纹 heal；demo 种子升全集 | 2026-11-18 对话：Role 表权限仅 W0 两表、连接已启用多表；未开放 W1／W2 对无头运维有用；委托人授权起草 Spec／Plan，暂时不开发 | **P1**（清单 P1-49；优先级待委托人裁定） | **入池＋Spec／Plan（2026-11-18）**：v0.1-draft；推荐 D0＝指纹 heal；修订 D22／§3.2 窄例外；测试台 not_registered。**≠ 终稿确权 ≠ 开发授权**；不入核心分母；≠ 可上线 |
| REQ-030-071 | 重建快照上界与完成水位不一致：并发新增调用未入推断却被标已覆盖（FDE R01） | FDE 打包门槛 R01；水位写 `MAX(ts)` 导致重建中插入且 `id>ceiling` 被误判已覆盖 | **P1**（清单 P1-50） | **X_SUP｜被取代（并入 REQ-030-066／P1-45；2026-11-22 文档收口）**：合同落点＝P1-45 Spec §3.1（`ceilingId`／`covered()` 按 id）；不另开独立 Spec／UAT；随 P1-45 S5 闭合；不入核心分母；≠ 可上线 |
| REQ-030-072 | 版本轴分工与命名规约：候选 `rc.N` 自动分配＋交付主键＋私有化分叉追溯 | 2026-11-18 对话：版本乱／合并前镜像与定稿撞号；委托人确认采纳 `rc.N`＋交付主键（否决候选用 `0.31`）、号码自动分配、后期可追溯与私有化分叉定位；暂不开发 | **P1**（清单 P1-51） | S1｜**入池＋Spec／Plan（2026-11-18）**：v0.3-draft；测试台 not_registered。**≠ 终稿确权 ≠ 开发授权；≠ S2**；不入核心分母；≠ 可上线 |
| REQ-030-073 | 客户镜像升级可靠性分层门禁：同一 digest＋客户数据量级＋A/B 必跑＋C 按边界触发 | 2026-11-18 客户升级 502／503 回滚复盘；委托人认可 digest 等基线绑定、客户数据规模覆盖与「环境等价而非复制客户 K8s」折中，授权只生成 Spec／Plan | **P1**（清单 P1-52） | S1｜**v0.1-draft。仅登记与起草；终稿未确权；未获开发授权；收口终态＝X_REL；≠ 可上线** |
| REQ-030-074 | MCP 升级兼容底线：真实 Agent＋Lucy MCP 批题对照基线→敢不敢部署／升级 | 客户 WorkBuddy 会员收入事故；目标对齐＋T1–T10；2026-11-18 收编题库／配置前置 | **P0 底线**（清单 P1-53） | X_REL｜**v1.1。发布取证已收口（2026-11-22）**；四入口全真＋SC／CR；INDEX PASS；不入核心分母；≠ 可上线 |
| REQ-030-075 | MCP 升级兼容多场景题库＋CompatConfigProfile：业务／Ops／配置前置 | 独立题库；委托人确认全真须配合 Lucy 配置才具备落地条件 | **P0 底线（题库＋配置；清单 P1-54）** | S5｜**v1.1。功能合同已收口（2026-11-22，严口径）**；选项 2：03b＝行隔离成交；共享 INDEX＝PASS（P1-53 candidate）；不入核心分母；≠ 可上线 |
| REQ-030-076 | FDE 3b1c62af 打包前检查本机复现 UAT（L1 原样复现＋L2 全真） | FDE 报告 `Lucy升级检查_3b1c62af_20261119`；委托人 2026-11-19 要求本机按 UAT 规范复现 | **P1（清单 P1-55）** | **Plan v0.2（2026-11-19）**：D1–D4 已确认；测试台 `UAT-SUITE-FDE-PACKCHECK`＝NOT RUN。只涉及测试台与证据，**不改运行代码**；≠ 开发授权；不入核心分母；≠ 可上线 |
| REQ-030-077 | FDE 报告候选缺陷补录：F01 正式导出等待追平、F02 慢合法 Hive 语法回退、F03 单表 defer 披露、F04 宽表整批 deferred 收敛、AUDIT-01 滚动窗口重复归属 | FDE 3b1c62af 打包前检查（4 项 P0＋F03 P1）；差集补录（事实有、池没有） | **P1（清单 P1-56；FDE 标 P0，待本机复现后由委托人定级）** | **本机 L1 复现成立；L2 全真未做；契约修订与整改 Plan v1.0 已定稿；4 份修订已由委托人明示终稿确权，并整批授权运行代码开发（2026-11-19 12:35；Codex 首轮终审意见已全部采纳，未复审）；实现已落地（2026-11-19）：EC-14–17／LS-19–24／N26-1–6／SC-11–16 vitest 36 passed（4 skip 与本批无关）；LS-24 `node --test` 5/5；`lint:spec-docs`＋`lint:e2e-ledger` PASS；demo 容器复核未做；O3 存量批量标脏延后、未授权**。≠ UAT PASS；≠ 可上线 |

---

## 开工前置

条目从本池进入实施前必须依次满足：

1. **需求澄清**：与委托人确认诉求边界、现行约束冲突项与不做项，结论写回本条目。
2. **独立 Spec**：另立或恢复既有 Spec 的开工授权；不得以本池条目代替 Spec。
3. **Plan**：另立或恢复对应 Plan，登记进 `docs/plans/README.md`。
4. **开发授权**：获得明确开工授权后，才可改代码。

未满足上述四步时，条目状态保持 Deferred，不得进入当前版本实施。

## 验收

- 本池级验收：条目 ID／标题／来源／优先级／状态五列齐备；来源可追到 UX 台账条目或 Spec 编号；状态与「本版不做」的表述一致。
- 条目级验收：在该条目的 Spec 中完成，不在本池内验收。
- **本池不产出功能验收结论**，也不作为任何版本的发布取证。

## 完成定义

- 需求池文件存在、可被索引登记、条目结构完整。
- 每个条目都有来源与明确状态（含 Deferred）。
- 条目索引表与正文条目一一对应，无孤儿条目。
- 本版（`0.25.0`）的交付范围不受本池影响。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 被当成实施依据 | 有人把池内条目直接排进 `0.25.0` | 文件头写明不授权实现；条目状态默认 Deferred |
| 版本号漂移 | 池名写死 `0.30.0`，与实际开线版本不一致 | 开线时由需求澄清环节确认并整体改写，不静默沿用 |
| 需求丢失 | 诉求散落各处，池内漏登记 | 登记时必须回填来源；与 Spec 头部 Deferred 句双向可追 |

---

## REQ-030-001：

> **2026-11-07：已开独立 Spec 与 Plan**（`lucy-20261107-publish-workbench-per-file-selection`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**。取证结论：真·分文件生效须把「索引实际影响」与「确认面」对齐，失败一律整批不推进基线；本条**显式修订** Spec 119／123／20261030 等 21 条既有约定（须 PM 批准），不 silently 绕过整批同步合同。发布工作台分文件勾选发布

### 背景

用户在 `/publish/workbench`「待发布变更」看到多条「新增」条目，但无勾选，不知道如何发布。左栏文案写明「本批一并同步 N 项（不可分文件勾选）」。现行 Spec（123、20261030 三栏）约定：**整批同步**，主动作在中栏「生效准备」的「同步索引并生效」。

用户曾倾向「左栏勾选再发布」，经澄清后确认：当前 reindex 消费整内容根，真·分文件生效需改发布/索引管线；本版不做。该项纳入 **`0.30.0` 需求池**，**本版不做优化、不开 Spec、不改代码**。

### 期望方向（池内草案，未冻结）

真·分文件发布：操作者勾选待发布文件；仅勾选范围进入本次生效；未勾选项继续留在待发布，且索引实际影响不得与确认面不一致。

### 已知硬约束（开 Spec 前必须回答）

1. 现行 `POST /api/semantic-assets/reindex` 对内容根做整批索引同步，无法用 UI 勾选静默缩小实际影响（Spec 20261030 明确禁止「本页范围缩小索引实际影响」）。
2. 真·分文件生效至少要回答：未选中的脏文件如何不进索引、与镜像/内容根一致性、校验与确认范围、发布记录与恢复边界。
3. 现行 Spec 123 / 20261030 的「整批同步、不可分文件勾选」须在开线时显式修订或取代，不能 silently 绕过。

### 非目标（本条目当前）

- 不在 `0.25.0` 增加勾选框、半真半假的「选了但不生效」交互。
- 不把「仅审阅聚焦多选」误写成已交付分文件发布。
- 本轮不修同页条目阴影一致性等视觉 polish（见关联反馈；同属本版不做）。

### 关联

- 页面：`/publish/workbench`
- UX 台账：`docs/ui-ux-feedback/pages/publish-workbench.md` → `UX-PUBLISH-WORKBENCH-010`
- 现行约束：`webui/docs/123-publish-workbench-activation-ia-spec.md`；`docs/specs/lucy-20261030-publish-workbench-three-column-spec.md`（不引入分文件选择发布）

### 本版临时用法（给操作者，非产品变更）

有待同步文件时：看中栏「生效准备」→「校验变更」→「同步索引并生效」→ 确认侧栏提交。左栏点击只打开差异，不发布。

---

## REQ-030-002：帮助中心体验（L25-12）

### 背景

L25-12 帮助中心 Spec／Plan 已落盘；2026-11-02 起本版不实施、不评审、不开工。2026-11-03 产品收关将本条正式迁入 `0.30.0` 池。**2026-11-16 委托人选方案 B**：保持本条为 **P2**（不抬成问数核心分母 P0）；价值主张缺口通过「门户／快速入门最显性深链」收口，不另开内容先行条目。**2026-11-19 委托人修正对标对象**：现行对标由 `https://www.kimi.com/help` 改为 `https://www.kimi.com/code/docs/`（Kimi Code 产品文档站），旧对标降为历史记录；**同日裁决 D17**（首页参照 Kimi Code 概览页 ＋ KTX Quickstart 采用概览内容页形态）**并明示纳入 D19／D20**；**再同日明示 MD 标配**（D21）。

### 期望方向

门户 → 分类 → 文章三层 IA；独立「快速入门」；复制／导出 Markdown；浏览器打印（**D21：复制 Markdown 升级为标准动作，覆盖文章页／快速入门页／分类页／全文视图四处；整本手册可导出**）。另：**快速入门与门户首屏必须深链**到手册中「Agent／Claude 直连数据库 vs 经 Lucy」对照表，以及「提高准确率与体验的语义配置杠杆清单」；正文 SSOT 在 `docs/SYSTEM_HANDBOOK.md`（快速入门只写路径，不复述）。开线前须再澄清 IA／导出细节；D15 为内容必达项。**2026-11-19 新增**：D16（对标对象修正，旧结论逐条取舍入 Spec §1.3）、D18（搜索结果升级为锚点级归属路径）、**D17（已裁决**：帮助首页采用概览内容页形态，门户网格与封面图退出本条）、**D19**（手册新增「错误参考」章：H3＝错误类、H4＝单条错误码条目，五要素＝机器码／含义／现象／可执行下一步／兜底路径；机器码只取既有登记册，不新造码）、**D20**（「本期未覆盖」角色页与速查末节必须给站内逃逸出口）。出口扩到 SC-01–SC-25。

### 关联

- Spec：`docs/specs/lucy-20261031-help-center-experience-spec.md`（**v0.5-draft**）
- Plan：`docs/plans/lucy-20261031-help-center-experience-plan.md`（**v0.5**）
- 总账：`docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md` **P2-2**
- 台账：`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.6

---

## REQ-030-003：访问关系图与访问日志口径对齐

### 背景

Spec／Plan v0.3 可定稿（Codex 两轮）。2026-11-03 曾迁入池；**2026-11-04 用户批准拉出实施**（Plan 升 v0.4）；同日 **S1–S3 实施完成**，出口修订把 SC-12 页序子句拆出、SC-14 逐边留在出口，并批准 **功能合同已收口（2026-11-04）**。本条收口不表示可上线。实施笔记：`docs/reviews/2026-11-04-access-map-audit-echo-implementation-notes.md`。

### 期望方向

访问关系图工具条与访问日志共用问询种类／访问等级；关联口径降为弱入口；投影集合 E 可打假。细节以既有 Spec 为准。

### 关联

- Spec：`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`
- Plan：`docs/plans/lucy-20261102-access-map-audit-echo-plan.md`（v0.4）

---

## REQ-030-004：运维控制面 W-B（语义发布）

### 背景

L25-16 W-A（连接表／源表导入）已授权实现；W-B（语义发布控制面）仍不可交付开发，依赖 L25-11 审阅通过与 G31。2026-11-03 将 **W-B 单独**迁入池；W-A 仍留在 `0.25.0` 登记（中间带，本轮不动）。

### 期望方向

`lucy_ops_*` 语义发布包装；消费既有 staged 批次；独立授权与审计归因。开线前须重核 G31／批次消费合同。

### 关联

- Spec：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md`（W-B 段）
- Plan：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md`（S5）

---

## REQ-030-005：客户升级 E2E 自动化（L25-07）

### 背景

整条合同对象是真实旧版→候选的升级取证（Docker／K3s／K8s），不是产品功能闭口。脚本在仓；真实升级未授权（`blocked_delivery`）；非门禁。2026-11-03 剥离出 `0.25.0` 产品分母。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md`
- 上游：`docs/plans/2026-10-19-upgrade-e2e-implementation-plan.md`

---

## REQ-030-006：升级候选验证环境（L25-13）

### 背景

隔离环境备份恢复验证通道，不是交付通道，也不是产品功能闭口。2026-11-03 剥离出 `0.25.0` 产品分母。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md`
- 上游：`docs/plans/2026-10-22-upgrade-candidate-verification-plan.md`

---

## REQ-030-007：E2E 主线与旁线优化（harness）

### 背景

测试组织与证据 harness，不改变任何功能 Spec 的验收语义。2026-11-03 剥离出 `0.25.0` 产品分母。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md`
- Plan：`docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md`

---

## REQ-030-008：

> **2026-11-07：已排期 `0.30` 遗留验收执行 Plan**（`lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan`），待评审、未授权执行。访问关系图 Spec 187 验收矩阵

### 背景

L25-08 访问关系图已实现。本版叠加条（quiet-reading／chart-first／geometry）各自收口或已实施。Spec 187 的 SC-01–14 主验收矩阵仍未执行。2026-11-03 D2：本版产品闭口只认「已实现」与叠加条，主矩阵进池。

### 关联

- Spec：`webui/docs/187-access-relation-sankey-spec.md`

---

## REQ-030-009：

> **2026-11-07：已排期 `0.30` 遗留验收执行 Plan**（`lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan`），待评审、未授权执行。OIDC-22–25 仍归交付层，不在本步执行。OIDC 功能合同验收（L25-06）

### 背景

OIDC 已实施；OIDC-22–25 已拆出归交付。OIDC-01–21 与 OIDC-26 仍未执行。2026-11-03 D2：本版只记「已实施」，正式验收进池。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-oidc-single-sign-on-spec.md`

---

## REQ-030-010：

> **2026-11-07：已排期 `0.30` 遗留验收执行 Plan**（`lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan`），待评审、未授权执行。SRR-22 仍已拆出；真实备份恢复归发布取证层。语义整批恢复 SRR 验收（L25-15）

### 背景

S1–S6 运行代码与定向测试已落地；SRR-22 已拆出。SRR-01–21、SRR-23–24 仍未执行。2026-11-03 D2：本版只记代码已落，SRR 验收进池。

### 关联

- Spec：`docs/specs/lucy-20261027-v0p25-semantic-release-restore-spec.md`

---

## REQ-030-011：

> **2026-11-07：已排期 `0.30` 遗留验收执行 Plan**（`lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan`），待评审、未授权执行。VOPS-27／30 仍已拆出。运维控制面 W-A VOPS 验收

### 背景

W-A 已授权实现；W-B 已是 REQ-030-004。VOPS-27／30 已拆出；其余 VOPS 仍未执行。2026-11-03 D2：本版只记实现授权／代码在仓，W-A VOPS 验收进池。

### 关联

- Spec：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md`

---

## REQ-030-012：

> **2026-11-07：已开独立 Spec 与 Plan**（`lucy-20261107-semantic-source-field-exposure`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**。取证结论：Catalog 与 Query **双面裁剪**才不半通；发布对引用未暴露列须硬失败并指名引用方；不改 KTX「全物理列」合同。语义层宽表字段暴露裁剪

### 背景

宽表接入语义层后，Agent 经 Catalog / 读源 / 查数看到全量物理列，上下文噪音大、易误用字段。现行合同要求 standalone source 含全部物理列；ACL 仅为表级 + Row Policy；列级权限与脱敏不在现行承诺。合规侧「库内不可见」仍靠 VIEW / 拆表兜底，不是产品化「勾选删列」。

2026-11-05 产品澄清：要的是 **Source 级业务暴露裁剪**（全实例同一套采用集），不是列级 ACL；倾向 **Lucy 门面闸**（库存与暴露分离，不改 KTX 全物理列合同、不手删 Manifest 列）。

### 期望方向（池内草案；澄清已写，设计未冻结，不授权实现）

- **库存 ≠ 暴露**：Manifest / 扫描保留全量物理库存；另维护本 Source 的暴露集供 Agent 数据面使用。
- **运行时（A1）**：未暴露列在 `lucy_read_source`（及等价发现面）不可见；`lucy_query`（及等价查数）点名未暴露列 → 拒绝（fail-closed）。闸落在 Lucy MCP Proxy 等 Agent 入口，避免半通。**2026-11-07 取证更正**：池原文写「`lucy_catalog` / `lucy_read_source`」，但 `lucy_catalog` 现行**不返回列**（`acl.ts:1986-1995`），该半句空转 → 实际列级发现面只有 `lucy_read_source`；「发现面」＝发现面（read_source），「查数面」＝查数面（query／explain），二者仍须禁半通。
- **发布（B1）**：grain / measure / segment / join / 派生列仍引用未暴露列 → 发布/生效硬失败并指出引用方。
- **新列（C2）**：扫描到的新物理列默认自动进入暴露集；裁剪靠事后在工作台收敛。
- **操作面（D1）**：表语义工作台字段列表维护暴露/取消暴露；变更进待发布；工作台仍能看到「已取消暴露」库存以便恢复。
- **推荐实现方向**：Lucy 门面闸（路线 1）。存量无显式配置的 Source 等价「全库存暴露」。

### 非目标（本条目当前）

- 列级 ACL / 脱敏 / 按 Role 异列。
- 替代合规用 VIEW；不改库表结构。
- 从 Manifest 物理删除列，或改写 KTX「全物理列」合同作为主路径。
- 本版（`0.25.0`）不优化、不开 Spec、不改代码。

### 已知硬约束（开 Spec 前必须再核）

1. 暴露集须版本化并随发布进入运行内容根；不得只活在浏览器本地状态。
2. A1 必须覆盖所有 Agent 查数/发现入口，禁止 Catalog 已裁、Query 仍通的半通形状。
3. 与现行 semantic-author / 上传 / `sl read` 全物理列叙事的文档与门禁对齐方式（库存保留、暴露另册）。
4. 文案与交付口径必须写清：业务暴露裁剪 ≠ 列级安全。

### 关联

- 澄清来源：2026-11-05 产品对话（路线 1 已认可；本池只登记）
- 相关既有边界：`docs/governance/vision.md`（不做列级脱敏）；`docs/access-control/*`（VIEW-as-pseudo-table 兜底）；表语义工作台既有 Spec（`webui/docs/48` 等）；MCP Proxy Catalog/Query 面（`webui/docs/07-mcp-auth-proxy-spec.md`）
- 开线前须另立独立 Spec／Plan；本条目不构成其中任一步


---

## REQ-030-013：行权限行策略编译门禁（度量/派生列作谓词字段）

### 背景

2026-11-05 row-policy 强度 B 两阶段实跑（`inbox/e2e/final-rds-20261105`，证据
`evidence/phase-on/security.json` 的 SEC-11-BY19）实锤：行策略谓词引用语义度量名
（`total_sales` 作谓词字段，语义编译失败类输入）时，门禁未在编译期拦截，实测上游
执行 1 次。合同口径：编译期拒绝且零上游执行（fail-closed）。

### 期望方向（池内草案；不授权实现）

- 行策略编译校验覆盖「度量/派生列作谓词字段」类输入，拒绝发生在任何上游执行之前。
- 拒绝原因码进入行策略专属命名空间，与 REQ-030-016（各面拒绝码统一）一并设计。

### 非目标（本条目当前）

- 不改冻结 catalog 合同字面量；不动 `--pack row-policy` 的只读边界。
- 不涵盖 forged forced 处理口径（BY-05 归 debug，见收工笔记）。
- **2026-11-07：已开出独立 Spec 与 Plan（`lucy-20261107-row-policy-compile-gate-deny-code`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**（已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审）。** 取证结论：缺口是**字段级门禁缺失**（`validateProtectedLucyQueryArgs` 只做形状门禁，`filters[].field` 未做字段判定），而非形状门禁失效。

---

## REQ-030-016：行权限各面拒绝码统一

### 背景

同一实跑 BY-06／BY-17：entity_details／sl_validate／lucy_freshness 在 scoped source
上的拒绝码实测为 `tool_forbidden`，而浏览器面同场景（ROW25-V17 通过）与单元期望
（row-policy-ac-p1.test.ts「BY-06/07/17」用例）均为 `row_policy_requires_wrapped_tool`。
同一拒绝语义在不同执行面使用不同 reason code，排障与合同断言都会分叉。

### 期望方向（池内草案；不授权实现）

- 同一拒绝语义在各 MCP 工具面与浏览器面使用同一 reason code 命名空间。
- 以单元合同测试固化各面一致；实跑 BY-06/17 作为验收。

### 非目标（本条目当前）

- 不改变拒绝本身的行为（拒绝已发生，只是码不一致）。
- **2026-11-07：已与 REQ-030-013 合并为同一条 Spec 与 Plan（`lucy-20261107-row-policy-compile-gate-deny-code`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**（已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审）。** 取证结论：根因是**工具级判定先于行策略判定**（Agent 是否被显式授予该工具导致落到 `tool_forbidden` / `row_policy_requires_wrapped_tool` 两个码）。

---

## REQ-030-017：lucy_explain_query 诊断形状补全（E5 summary）

### 背景

同一实跑 BY-18：`lucy_explain_query` 的 forced 谓词本地诊断 E1..E4 可用，但 E5
summary=undefined。诊断形状合同不完整。

**2026-11-07 取证更正**：BY-18 的响应 envelope **已被实跑识别**（走 `mcp_result_ok` 分支），E1–E4 四条断言 `passed=true`，失败点只是 E5 的 `summary` 断言；「envelope 不被识别」（`source=mcp_iserror_other`）是 **BY-19** 的失败形态，与本条无关。

### 期望方向（池内草案；不授权实现）

- 补齐 E5 summary 字段并固化形状合同测试；诊断保持本地-only、零上游转发。

### 非目标（本条目当前）

- 不改变 explain 的本地诊断定位；不新增数据返回路径。
- **2026-11-07：已开出独立 Spec 与 Plan（`lucy-20261107-explain-diagnostic-shape-contract`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**（已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审）。** 取证结论：真根因不是「少一个 `summary` 字段」，而是 **E1–E5 编号在 ADR §2.1.1（lines 78–82）、实现注释、e2e harness 三处互斥**（harness 把 `semantics` 当 E1，ADR 是 E5），且 harness 断言了 ADR 未定义、实现也不产出的 `summary`；另 ADR E3 要求的「capability 裁决」在实现里无独立落点。

---

## REQ-030-014：

> **2026-11-07：已排期 `0.30` 遗留验收执行 Plan**（`lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan`），待评审、未授权执行。**归属行权限视图 Spec 当前处于已收口态**——须 PM 批准重开，并在尾部追加验收编号，不得改动既有 SC-01–SC-30 语义。行权限模板展开保留 templateRefs

### 背景

同一实跑浏览器腿维度证据（phase-on v025 条目 `executorResults.B.assertions`）：ROW25-V01／ROW25-V03 与 RTP25-02 的 `allow_control` 断言记录 `refs=[]`——模板展开后 templateRefs 丢失，「最终约束引用了哪个模板」不可追溯。row-policy 实施计划风险表已预告此项属产品缺陷，归**行权限视图 Spec SC-10** 功能闭口。

### 期望方向（池内草案；不授权实现）

- 模板展开为 scoped 条件时保留 templateRefs（模板 id／版本）于预览与运行时证据。
- 视图反查与 digest 比对继续以展开后条件为准，templateRefs 不改变判定语义。

### 非目标（本条目当前）

- 不改变 digest／policyVersion 计算口径。
- 本版（`0.25.0`）不修复；归口功能闭口走其既有授权路径。

---

## REQ-030-015：

> **2026-11-07：已开独立 Spec 与 Plan**（`lucy-20261107-semantic-orphan-path-governance`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**。取证结论：孤儿来源的三选一归因**目前只是候选机制**，实跑证据不在仓内；开工前置＝先取得实跑产物证据。语义层孤儿路径治理（lucy-ops 反查孤儿）

### 背景

同一实跑 RTV25-06（反查与关系图同快照）维度证据：按表反查出现孤儿路径一批，均指向 `lucy-ops::main::ops_*`（`ops_access_paths`／`ops_agent_activity`／`ops_agents`／`ops_call_tables`／`ops_calls`／`ops_edge_signals` 等）。关系图计数与反查路径数因此不一致。性质为语义层/视图数据完整性问题，非用例问题。

### 期望方向（池内草案；不授权实现）

- 清点 `lucy-ops` 语义层孤儿路径来源（残留引用／已删对象／命名漂移三选一归因）。
- 反查与关系图读取同一份快照口径；孤儿不再计入路径数或在两处一致呈现。

### 非目标（本条目当前）

- 不在本条重建语义层对象；不改 RTV25 合同口径。
- **不在本条重建语义层对象**；本条未授权实现。（2026-11-07 起本条目已开独立 Spec 与 Plan，见上方抬头与条目状态）

---

## REQ-030-018：空结果（0 行）响应的结构化下一步指导

### 背景

来源：The New Stack《Why MCP servers should tell agents what to do next》（Matthew Burns 记 AWS James Ward，2026-11-07）。主张是「工具响应要带下一步指导，不只靠 `initialize`」。

对照 Lucy 现状：拒答、过滤下推、结果截断三类**已有**修复提示（`webui/server/proxy/mcp-proxy.ts:4017-4065`、`:2892-2937`、`webui/server/proxy/question-experience.ts:1039`），但**成功且 0 行时只返回裸空结果**——`result_empty=1` 是纯审计标记（`webui/server/proxy/question-experience.ts:1000-1007`、`webui/server/proxy/mcp-proxy.ts:3027`、`webui/server/proxy/audit.ts:1782`；合同口径 `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:329`）。这是原文点名的最糟失败形状：半通（看得到 catalog、查不出数）。而 `webui/config/data-qa-instructions.md:40` 又要求 Agent 区分无记录／字段为空／可推算三类缺失，工具响应此刻却不给任何区分依据。

### 期望方向（池内草案；不授权实现）

- `lucy_query` / `lucy_read_source` 成功且 0 行时返回结构化下一步建议（可查来源候选 + 三类缺失的区分提示）。
- 候选内容只含当前角色 ACL 内的 source / 连接，复用既有修复提示可用性闭环（B15 五项校验），不新造白名单。

### 需求澄清结论（2026-11-07，委托人裁定；第 1 轮对抗式评审后修订）

- **D1＝结构化**：指导以 `next_step` 对象承载（`kind` / `summary` / `query` / `suggestions` / `next_tools` / `hint`），不落自由文本。
- **D2＝提示不阻断**：空结果不拒绝任何后续调用，不改问询预算，不改 ACL 裁决。
- **落点（D3＝A，委托人 2026-11-09 确认）**：**单块内加键**——`content[0].text` 的 JSON 对象内加 `next_step` 键 ＋ `structuredContent` 同步（仅已是对象时）＋ `_meta.lucy.next_step`（合同位）。**不追加 content 块**：追加块会打断 `scripts/eval/eval-runner.mjs:293-300` 的多块 JSON 解析。可验收保证止于 MCP content 承载位已写入。
- **工具可见性（评审修订）**：`next_tools` 用 `allowedToolNames(identity)`（`webui/server/proxy/acl.ts:2397-2431`）而非授予清单 `permissions.tools`；无 `*` 通配语义。
- **filter 回显（评审修订）**：只回显**改写前**的原始用户 filter，且按 `audit-privacy` 口径**去值**；行策略谓词（`row-policy.ts:738` 前插）一律不出现。
- **成因分流（评审修订）**：用 `scopeIntersectionEmpty`（发查询前已算出）分流 `kind`：`empty_result_scope_conflict` 时**不得**给泛化的「放宽过滤条件」建议。
- 范围收窄：**只覆盖 `lucy_query` 的 0 行**；不断言 grain／可用周期／指标清单（代理在响应链路上拿不到，断言即编造），只指向 `lucy_read_source` / `lucy_freshness` 去取。
- 覆盖缺口已登记：`lucy_certified_route` / `lucy_report_template` 绕过本机制（`mcp-proxy.ts:3761-3998`）；分页空页会被判为空结果（`mcp-proxy.ts:861-862`）。

### 非目标（本条目当前）

- 不做门闩：空结果不阻断后续调用（与「部分可回答仍须交付」冲突）。
- 不改 `result_empty` 审计语义；不改 ACL 裁决口径；不替 Agent 下「数据错误」结论。
- **不追加 content 块**；不改变上游数据载荷的值语义（允许在 JSON 对象内加一个兄弟键）。
- 不把「告诉下一步」表述成安全边界：instructions 是 fail-open 的建议层，裁决始终在 Proxy + ACL。
- 不发真实数据查询取证（沿用 Spec 162 §7.3 硬约束）。
- **代码改动未授权**；须走 开工授权 后才可实施。

### 关联

- Spec：[`lucy-20261107-empty-result-next-step-guidance-spec.md`](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) **v0.8-draft**
- 实施 Plan：[`lucy-20261107-empty-result-next-step-guidance-plan.md`](lucy-20261107-empty-result-next-step-guidance-plan.md) **v0.8-draft**
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.1
- 第 1 轮评审与裁定：[`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)
- Codex 过程对抗：[`docs/reviews/2026-11-09-empty-result-next-step-codex-review.md`](../reviews/2026-11-09-empty-result-next-step-codex-review.md)（R3＝BLOCK → v0.7；**D3＝A 已确认**；**不构成 R2-F／R4**）
- 修复提示合同：`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- MCP Proxy 合同：`webui/docs/07-mcp-auth-proxy-spec.md`

---

## REQ-030-019：

> **2026-11-07：已开独立 Spec 与 Plan**（`lucy-20261107-eval-tool-assertion-authoring`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**。取证结论：runner 侧实测为 **8 型**断言（上游分支计划「7 型」口径有误，以 runner 为准）；未知／非法断言类型须在**保存与导出双失败关闭**，不得静默丢弃。Eval 路径断言在 WebUI 侧可编排

### 背景

来源同上（原文主张：Eval 要测「改工具是否真被走」）。

对照 Lucy 现状：路径断言在 runner 侧**已完备**（`scripts/eval/eval-runner.mjs:720-844` 支持 7 型工具断言），`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml` 已在用。但编排面三处缺：前端类型只声明 4 型、漏掉 4 个预算型（`webui/src/lib/types.ts:2081-2086`）；用例编辑器只有 SQL 断言与结果断言两个页签、无 tool_assertions 入口（`webui/src/pages/eval/CaseEditor.tsx:474-660`）；服务端 `EvalCase` 类型无该字段（`webui/server/eval/cases.ts:33-64`）。数据本身**不丢**（legacy→canonical 归一化为整字段展开 `webui/server/eval/suite-import.ts:140-158`；canonicalize 不做白名单过滤 `webui/server/eval/suite-schema.ts:392-412`；WebUI 跑批走 CLI runner `webui/server/eval/runner.ts:322`）。

### 期望方向（池内草案；不授权实现）

- 类型补齐全部 7 型工具断言；用例编辑器增加「工具断言」页签；服务端类型补字段。
- 管理员可自助写「必须调用某工具」「同一 filter 不得重复查」类断言，不必手改 YAML。

### 非目标（本条目当前）

- 不改 runner 断言语义与既有失败文案（`budget: ...` 前缀保持）。
- 不新增断言类型；不引入新的 Eval 跑批引擎。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.2
- Eval / Quiz 约定：`docs/governance/eval-quiz-conventions.md`

---

## REQ-030-020：

> **2026-11-07：已开独立 Spec 与 Plan**（`lucy-20261107-audit-journey-eval-case-draft`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**。取证结论：`review_status` **挡不住** CLI runner 与 WebUI 跑批，「不自动进跑批」只能靠**路径隔离＋人工确认**；题干须合成脱敏（只留指纹）。审计问询旅程 → Eval 用例草稿导出

### 背景

来源同上（原文主张：把用户目标与路径对拍做成一等公民）。

对照 Lucy 现状：审计侧已能读出一段问询的「原话 → 调用序列 → 结果」故事线（`docs/specs/lucy-20261104-audit-call-storyline-spec.md`），Eval 侧也有带 `question` 与 `tool_assertions` 的用例，但**两者之间无桥**：排障时看到「这个 Agent 连续查了 8 次同一个 ID」，只能人工翻译成 YAML。

### 期望方向（池内草案；不授权实现）

- 从审计问询导出 Eval 用例**草稿**：`question` 取用户原话，`tool_assertions` 从调用序列反推（重复输入 → `max_repeated_tool_input`；命中特定工具 → `required_tool` / `forbidden_tool`）。
- 导出为草稿、人工确认后才进 `evals/**`；不自动进池、不自动进跑批。

### 非目标（本条目当前）

- 不自动改工具面；不做从 Eval 反向回放生产审计；不把客户原始问句直接落进 YAML（沿用 `evals/agent_reliability` 的脱敏合成约定）。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.3
- 审计故事线 Spec：`docs/specs/lucy-20261104-audit-call-storyline-spec.md`

---

## REQ-030-021：

> **2026-11-07：已开独立 Spec 与 Plan**（`lucy-20261107-eval-failure-to-tool-surface-feedback`），状态 v0.2-draft，**待严格评审／验收；冻结落地；未授权实现**。取证结论：只登记「批量候选」队列与判定口径，**不自动改工具面**；反推不出时计 `undecidable` 并显式报出。循环单查 → 批量/聚合工具反哺通道

### 背景

来源同上（原文主张：批量与聚合工具由旅程反推）。

对照 Lucy 现状：`max_repeated_tool_input` 能**检出**「对同一 ID 列表反复单查」（`scripts/eval/eval-runner.mjs:794-818`），但检出之后没有任何机制把它变成「升一级批量工具 / 写一条 skill / 改工具描述」。Lucy 侧其实已具备批量表达能力（`lucy_query` 的 `measures` / `dimensions` / `filters` 都是数组，见 `webui/config/data-qa-instructions.md:58-66`），截断时也已有「改为聚合后再取明细」的提示（`webui/server/proxy/question-experience.ts:1039`）。缺的是**把失败模式反哺成工具面改动**的闭环。

### 期望方向（池内草案；不授权实现）

- 跑批失败分类里把 `budget: max_repeated_tool_input` 指向一个「批量候选」队列；人工评审后决定是升工具、补 skill 还是改 instructions。

### 非目标（本条目当前）

- 不自动新增工具、不自动改工具面；不放松白名单 SQL；不让 Agent 临场写任意查询来绕开单查。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.4
- 运行时指导源：`webui/config/data-qa-instructions.md`

---

## REQ-030-022：答复可核对性（CFO 当场可核验来源/口径/数据截止期）

### 背景

来源：2026-11-06 事故——CFO 询问资产数量，其 Agent 选错表并直接作答，属严重误报。**2026-11-07 客户沟通实录已定性**：错表为 **GPU 计提成本表**（客户角色**有权访问**的表），被问的是**资产类问题** ⇒ **语义误报，ACL 越权排除**。取证清单见分支计划 §3.3，现降级为留档复核。

对照 Lucy 现状，三缺：

1. **provenance 埋在 `_meta.lucy`**，MCP 客户端（Claude Code / Cursor / Codex）默认不展示 → CFO 看不到「这个数来自哪张表」。`webui/server/proxy/mcp-proxy.ts:2701-2718`
2. **自然语言 provenance 只是 instructions 约定**，无 schema 校验、无 Eval 断言、无运行时检查；且 instructions 要求「先直接回答用户要的结果，再补口径」并「不要让 provenance 压过主答案」→ 鼓励把口径放在末尾。`webui/config/data-qa-instructions.md:34`、`:43`、`:69-75`
3. **freshness 不进答案**：`freshness.status` 恒为 `not_checked`，物理数据时效恒 `null`；受保护源上 `lucy_freshness` 还被直接拒绝。`webui/server/proxy/mcp-proxy.ts:2710-2714`、`:1682-1687`；`webui/server/proxy/acl.ts:2944-2948`

### 期望方向（池内草案；不授权实现）

- 把答复侧 provenance 从「instructions 约定」升级为**结构化合同**：答复必须带 source／measure／filters／数据截止期。
- 把 `_meta.lucy.provenance` **显式呈现给终端用户**，而不是只留在 `_meta`。
- 给终端用户提供**只读核对入口**（问询 ID → 查了哪张表／什么口径），复用审计侧已有的「意图＝表＋维度＋指标」派生与 `access_log_sources.physical_table`。`docs/specs/lucy-20261104-audit-call-storyline-spec.md:140`；`webui/server/proxy/mcp-proxy.ts:5482`

### 非目标（本条目当前）

- 不改 ACL 裁决口径；不改数值本身；不做「自动纠错」或「自动改表重查」——**可核对 ≠ 自动正确**。
- 不把「可核对」表述成安全边界：instructions 是 fail-open 建议层，裁决始终在 Proxy + ACL。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.5
- 修复提示合同：`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- 审计调用链故事线：`docs/specs/lucy-20261104-audit-call-storyline-spec.md`

---

## REQ-030-023：选表语义暴露（catalog 携带表描述）

### 背景

来源：2026-11-06 CFO 选表误报事故。

对照 Lucy 现状：`lucy_catalog` 每张表只返回 `connectionId / schema / sourceName / table` **四个字段——无业务描述、无同义词、无粒度、无业务域**，排序只有 `sourceName.localeCompare`（纯字母序）。`webui/server/proxy/acl.ts:1986-1990`、`:2007-2015`。catalog 的 `inputSchema.properties = {}`，**不能传查询词**，无法当检索/推荐用。`webui/server/proxy/mcp-proxy.ts:930-940`

⇒ Agent 拿到的是一张「表名清单」，只能按**表名字符串相似度**猜表（asset / assets / asset_finance 都像「资产」）。

**但描述资产已经存在**：`_schema/<schema>.yaml` 的 `tables.<name>.descriptions.db/ai` 本仓实测 30/30 非空。`semantic-layer/mysql-aliyun/_schema/dataforai.yaml:169-171`。缺的只是**接线**——catalog 组装时只读 `permissions.sources`，不读 manifest。

### 期望方向（池内草案；不授权实现）

- 把表级描述接进 `lucy_catalog` 的 `sources[]`，并按业务词命中排序（而非纯字母序）。
- 描述**须按 source 绑定可见性裁剪**——元数据侧信道风险已在 `docs/specs/lucy-20261014-concept-dictionary-spec.md:13` 被提示。

### 非目标（本条目当前）

- 不新增 `synonyms` 字段进 KTX 上游合同（需上游配合，留后续方向）。
- 不做「知识图谱式选表」；概念词典方向（`full/alias_only/none` 三档门控 + "Ignorance is Bliss"）不进 0.30。`docs/plans/wo-20261014-concept-dictionary.md:76-81`
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.1
- 可复用资产：`_schema` 描述（本仓 30/30）；`webui/server/live-tables.ts:73-81`（DB `table_comment` 兜底源）；`webui/server/proxy/query-guardrails.ts:72-153`（现成 YAML 遍历器，其 `SourceYaml` 类型尚无 description 字段，见 `:42-46`）

---

## REQ-030-024：多表命中先问 + 表级歧义门闩

### 背景

来源：2026-11-06 CFO 选表误报事故。

对照 Lucy 现状：

1. **instructions 对「多张表都可能命中」零规定**。唯一的「先问」规则只覆盖**指代与双意图**，且明写「代理不实现确认门闩」。`webui/config/data-qa-instructions.md:45-49`
2. **动态 role-aware instructions 整节丢弃了该节**——fallback 只在 `catalog.connections.length === 0 && catalog.sources.length === 0 && accessibleSkills.length === 0` 时返回；CFO 正常可见若干 source ⇒ 永远拿不到这一节。`webui/server/proxy/mcp-proxy.ts:1838`、`:1907-1909`
3. **唯一的歧义机制只管同名字段跨源，且字段带限定名即跳过**：`ambiguousFieldHint` 候选 < 2 个不提示（`webui/server/proxy/source-ambiguity.ts:105`）；`query-guardrails.ts:201` 的 `field.includes(".")` 直接跳过。而 instructions **要求**用限定名 ⇒ Agent 限定名选错表时护栏完全不触发。`webui/server/proxy/query-guardrails.ts:196-225`、`:295-344`

### 期望方向（池内草案；不授权实现）

- instructions 侧：把「问询范围确认」扩展到「多表命中」，并**并入动态 role-aware instructions**（现成条文可直接搬）。
- tool 侧：当业务词命中 ≥2 个可见 source 时，`lucy_query` 前返回**候选表清单＋各自度量覆盖**，要求显式确认；Agent 用限定名选了表但同词命中多表时，给 `stop` + 候选清单。

### 非目标（本条目当前）

- **候选表必须复用既有 ACL 内闭环**（`denialAllowList` / `buildRepairClosure`），保证不泄漏越权表；不新造白名单。`webui/server/proxy/question-experience.ts:1027-1037`
- 不自动选表（选择权留给人/Agent）；不跨角色推荐；不改 ACL 裁决口径。
- **instructions 单独上线价值有限**——instructions 是 fail-open 建议层，本条须与 tool 面门闩同批。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.2–4.3
- 运行时指导源：`webui/config/data-qa-instructions.md`
- 歧义模块：`webui/server/proxy/source-ambiguity.ts`、`webui/server/proxy/query-guardrails.ts`

---

## REQ-030-025：Eval 选表正确性断言与真实问句回灌

### 背景

来源：2026-11-06 CFO 选表误报事故（**检出缺口**，非事故原因）。**2026-11-07 客户沟通实录已给出评测覆盖范围与验收口径**：

> 「我们现在在**梳理问题清单，给每类问题定好用哪张表、什么口径**，同时优化 skill，**每天跑测评、每天迭代**。预计下周能把常见的**损益、资金、资产、Token、GPU** 相关问题跑完一轮评测。」

⇒ **五域覆盖范围已定**（损益／资金／资产／Token／GPU），**验收口径已定**（每类问题 → 用哪张表 + 什么口径），且「**每天跑测评、每天迭代**」是**已对客户做出的承诺**（目前全靠人力，见 REQ-030-026）。

对照 Lucy 现状，三个结构性缺陷：

1. **eval prompt 把正确答案的表名直接喂给 Agent**：`composeQuestion` 把 `expected_measures` 拼成 `superstore_orders.<measure>` 进 prompt ⇒ **选表正确性在结构上不可能被测出**。`scripts/eval/eval-runner.mjs:1382-1435`（尤其 `:1424-1433`）
2. **无跨表歧义用例**：122 条用例无一来自真实生产问询；`agent_reliability` 全 5 例 `expected_measures: []`、`sql_assertions: []`、无数值断言。`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:145,178,207,236,268`
3. **能力已在仓但零使用**：`required_tool_input_regex` / `forbidden_tool_input_regex` 可断言「用了哪个 source」，`evals/` 内 **0 命中**。`scripts/eval/eval-runner.mjs:751-761`

**附带发现（独立既有缺陷）**：`composeQuestion` 只对 `domain === 'kx_financial'` 分支（`scripts/eval/eval-runner.mjs:1414`），`chatbi_intl` 100 例落进 superstore 分支，prompt 里被告知 `superstore_orders.*`（**错误表名**）⇒ 该套件 100 例的选表结论**均不可信**。

**Eval 侧另两个实锤缺口**（与本事故同批处理）：`trigger` 写死 `'manual'`（`webui/server/eval/runner.ts:311`）；Publish 后无任何 Eval 被触发，且 `postPublishEvalDomains` 仍把表名当 domain（`webui/src/pages/publish/PublishWorkbench.tsx:415-416`、`:1206-1217`）。

### 期望方向（池内草案；不授权实现）

- 先修 `composeQuestion` 的表名泄漏：把「告知正确表」改成「列候选表让 Agent 自己选」。
- 用 `required_tool_input_regex` 断言「必须用 source X」＋`forbidden_tool_input_regex` 断言「禁止用 source Y」。
- 新增跨表歧义问题（「资产的数量」这类），覆盖业务高频歧义词（资产／收入／成本／用户）。
- 真实问句回灌：走 REQ-030-020 的「审计问询旅程 → Eval 用例草稿」通道。
- 发布成功后 enqueue 受影响 domain 的 smoke 回归；修 domain 映射；让 RunList 消费 `?domain=`（现无人消费，链接既不触发也不筛选）。`webui/src/pages/eval/RunList.tsx:34`

### 非目标（本条目当前）

- 不自动改工具面；不把客户原始问句直接落 YAML（沿用 `evals/agent_reliability` 的脱敏合成约定）。
- 不因 smoke FAIL 自动回滚 Publish（P0 咨询性）；不在 CI 里塞 LLM full eval。
- **去掉表名泄漏会改变 prompt 语义、通过率会变**——须明确换基线并声明历史不可比，不得与新断言混在一次跑批里比较。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（**v0.3-draft**；Cursor 过程对抗已修订；终稿未确权；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.6、§4.8
- Eval 运营闭环原始方案（多项未落地）：`docs/plans/2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md`
- Eval / Quiz 约定：`docs/governance/eval-quiz-conventions.md`（**注：该文档现无脱敏/合成条款，是治理缺口**）

---

## REQ-030-026：存量用户体感仪表盘与主动告警

### 背景

来源：2026-11-07 产品对话——「0.30 重点提升 Eval 与平台运维；已有 100 个用户，不是从零到一，怎么确保这 100 个用户每天的使用感受？特别是 C-level 高管的感受至关重要」。

**2026-11-07 客户沟通实录进一步把本条升级为「承诺兑现的载体」**——公司已对客户做出两项持续承诺：

> 「目前问数测评正在进行，您后面使用时我会**同步盯后台回复，发现问题当天修正**。」
> 「……同时优化 skill，**每天跑测评、每天迭代**。」

⇒ 这两条承诺**目前完全靠人力**（无自动触发、无告警、无 per-user 体感分）⇒ **0.30 的 Eval 与运维投入，本质是让「每天迭代、当天修正」不再依赖某个人一直盯着后台**。

对照 Lucy 现状：有一堆**全局**指标，**没有一个 per-user 体感分**。

| 缺 | 证据 |
|---|---|
| 无 per-user 顺畅度（真实问询数＋空结果率＋慢标记率＋拒绝率合成单分） | `webui/server/admin/daily-question-kpi.ts:40-53`；`webui/server/admin/governance-observability.ts:962-988` |
| 无「首次问询成功率」 | 全仓无 `first_question` 类字段 |
| 无 DAU 趋势（`dailyQuestions` 是问询量，不是人数） | `webui/server/admin/daily-question-kpi.ts:310-322` |
| 按角色只到**调用数**，不到**活跃人数** | `webui/server/admin/governance-observability.ts:786-822` |
| **无任何主动告警**：唯一 SMTP 事件是「审计账本挂了」，与用户体感无关；Eval 侧无 alert 表、无连续跌破判定、无 webhook（`consecutiveFailThreshold` 只存取、无判定） | `webui/server/notifications/health-events.ts:22-49`；`webui/server/eval/db.ts:9-94`；`webui/server/eval/monitor.ts:19-26` |
| **无用户反馈入口** | `webui/src` 无反馈组件；`docs/ui-ux-feedback/README.md:26-34`、`:282-289` 为人工台账 |
| **「界面使用视图」统计错对象**：`visitorCount` 是 WebUI 操作员（`COUNT(DISTINCT admin_id)`），**不是 100 个业务用户**——C-level 走 MCP 客户端，不产生 `ui_page_views` | `webui/server/admin/ui-usage.ts:546-594` |

### 期望方向（池内草案；不授权实现）

- **per-user 体感分**落成聚合视图，在 `/admin/usage` 数据访问视图给一列——复用 `daily-question-kpi.ts` 的 session 聚合范式，**不新造表**。
- **SMTP outbox 扩事件类**（问询成功率跌破阈值、某用户连续 N 次空结果）——复用现有 outbox 与去重机制，是唯一已跑通的主动通道，改造成本最低。
- 一个最小用户反馈入口，把「用户反馈 → 需求池」从纯手工单向改为有入口。
- 补 DAU 趋势与按角色活跃人数。

### 非目标（本条目当前）

- **不做 per-user 排名或绩效化用途**——这是运维观测，不是考核工具。
- 不把多张指标卡加总成一个数（沿用既有口径纪律）。
- 不新增第二套「真实问询」口径——沿用 Spec 194 已收口的 `conversation_turns` 口径。
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（**v0.3-draft**；Cursor 过程对抗已修订；终稿未确权；冻结落地；未授权实现）。

### 关联

- 分支计划：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §4.7
- 问询 KPI 上游 Plan：`docs/plans/2026-10-30-lucy-access-grade-and-daily-question-kpi-plan.md`（Spec 194）
- 告警通道：`webui/server/notifications/health-events.ts`、`webui/server/notifications/outbox.ts`
- 反馈台账：`docs/ui-ux-feedback/README.md`

---

## REQ-030-027：口径固化（问题类型 → 唯一表 + 固定口径绑定）

### 背景

来源：2026-11-06 事故 ＋ **2026-11-07 客户沟通实录**（客户：翊总；相关干系人：田总）。事故第一轮沟通原话：

> 「AI 取数取错了表，用的是 **GPU 计提成本表**，**口径也是 AI 自行加工的**，所以资产相关的回答不准，以资产看板为准。……我这边会在**语义层加约束：资产类问题只能从指定的资产表取数，并固定口径，不再让 AI 自行加工**。」

⇒ **事故是两条独立故障轴**：① 选错表 ② **口径被 AI 自行加工**。REQ-030-022–026 覆盖的是选表轴与可核对轴，**口径轴此前无人负责**。

对照 Lucy 现状：现行护栏覆盖的是**字段歧义**（同名跨源）与**用法**（`count(*)` 无源、聚合表达式误用），**没有任何一处校验「这个 measure 组合／filter／粒度／期间是否就是业务口径」**。`webui/server/proxy/query-guardrails.ts:295-344`；`webui/server/proxy/source-ambiguity.ts:97-114`

**已验证的手工路径**：改语义文件，把资产类问题的表与口径写死在语义层；**已用客户真实账号复测通过**（沟通实录第三轮：表单对了）。该路径当场生效、当天可验、成本最低，**但逐题手工配置，无法覆盖 100 人 × 未知问题**。

### 期望方向（池内草案；不授权实现）

- 把上述手工固化**泛化为可复用的声明式绑定机制**：「问题类型／意图 → 唯一表 + 固定口径」，由语义层发布、Proxy 消费。
- Agent 命中绑定时**直接取已发布口径**，不允许自由拼装 measure／filter／粒度／期间。
- 与 REQ-030-024（表级门闩）**串联**：G3 解决「选哪张表」，本条解决「在这张表上按什么口径算」。只做其一都会漏。

### 非目标（本条目当前）

- 不改已发布语义层的数值定义。
- **不做运行时自动推断口径**——口径必须由人定义并发布；运行时只按已发布口径执行。
- 不把口径绑定塞进 ACL（那是授权层，不是语义层）。
- **不授权实现代码**。详细规格见已开 Spec／Plan（下）。

### Spec／Plan（2026-11-07 Batch S1）

- Spec：[`docs/specs/lucy-20261107-question-type-caliber-binding-spec.md`](../specs/lucy-20261107-question-type-caliber-binding-spec.md)（**v0.5，终稿已确权（委托人 2026-11-07）**；待 O1／O2 与开发授权；冻结落地；未授权实现）
- Plan：[`docs/plans/lucy-20261107-question-type-caliber-binding-plan.md`](lucy-20261107-question-type-caliber-binding-plan.md)（同上）
- 评审：[`docs/reviews/2026-11-07-question-type-caliber-binding-codex-review.md`](../reviews/2026-11-07-question-type-caliber-binding-codex-review.md)

### 关联

- 分支计划：[`lucy-20261107-misreport-defense-and-stored-user-experience-plan.md`](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md) §1.4、§4.9
- 相关条目：REQ-030-024（表级门闩）、REQ-030-022（可核对性）、REQ-030-025（Eval 断言）

---

## REQ-030-028：物理新鲜度合同（答复截止期真源）

### 背景

来源：2026-11-08 产品对话——能力盘点（数据模型／语义管理／Evals）后，委托人选定 3 条入池之首。对照现状：

| 缺 | 证据（盘点口径） |
|---|---|
| `lucy_freshness` 以语义资产 mtime 为主，物理新鲜度多为空 | MCP Proxy 本地 freshness 工具；query `_meta` 常 `freshness.status: "not_checked"` |
| P0-4（REQ-030-022）要求「数据截止期」对人强制可见 | 若无物理／业务真源，截止期易退化为语义文件时间或空值，呈现闸空心 |

⇒ **呈现闸（Verify）依赖截止期真源**；本条补的是真源合同，不是再造一套 provenance 结构。

### 期望方向（池内草案；不授权实现）

- 为 connection／source 声明新鲜度策略：物理水位（如 max(业务日期)、批次元数据）或显式「未配置」。
- `lucy_query`／可核对块消费同一真源；未配置时 **fail-visible**（标明不可用），禁止静默用语义 mtime 冒充业务截止期。
- 与 REQ-030-022 串联：022 负责强制露出，本条负责露出内容可信。

### 非目标（本条目当前）

- 不要求一次建成全库 CDC／实时湖仓。
- 不重造 `_meta.lucy.provenance` 骨架（优先接线）。
- **不改 P0-4 已冻结的 cutoff**。Spec／Plan 已于 2026-11-09 开到 v0.1-draft；终稿未确权。
- **未授权实现代码**。

### 关联

- 清单：P0-B（[`lucy-20261107-lucy-0-30-feature-inventory-pool.md`](lucy-20261107-lucy-0-30-feature-inventory-pool.md)）
- Spec／Plan：[物理新鲜度合同](../specs/lucy-20261109-physical-freshness-contract-spec.md) · [Plan](lucy-20261109-physical-freshness-contract-plan.md)（v0.1-draft；终稿未确权；未授权实现）
- 相关条目：REQ-030-022（可核对性）、REQ-030-025（日跑可断言截止期缺失）

---

## REQ-030-029：语义发布 → Eval 门禁

### 背景

来源：2026-11-08 产品对话——能力盘点后选定入池。对照现状：Publish Workbench 的 validate→promote→reindex **成功 ≠** 选表／口径回归通过；P0-6（REQ-030-025）规划「可日跑／发布后跑」，但未把「发布成功」与「约定 suite 通过」绑成门禁。前身思路见 [`2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md`](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)（多项未落地）。

⇒ 「每天测评」若只靠人工记得跑，与客户承诺仍脱节；本条把检出闸接到**语义变更入口**。

### 期望方向（池内草案；不授权实现）

- 语义发布／reindex 成功后，对约定 suite（至少含选表正确性／口径相关 case）触发跑批。
- 失败策略待澄清二选一或分级：**阻断晋升** vs **允许发布但强制告警＋登记缺口**（须与运维通道 REQ-030-026 对齐）。
- 复用既有 offline-batch／eval runner，不另造跑批引擎。

### 非目标（本条目当前）

- 不把 Eval 当自动修复器（修复仍走绑定／Skill／语义修订）。
- 不替代 P0-1／P0-3 运行时约束。
- **不挡**原 P0-1…P0-7 收口；依赖 P0-6 骨架就绪后再深化。
- **未授权实现代码**。

### 关联

- 清单：P1-8
- 相关条目：REQ-030-025（日跑骨架）、REQ-030-026（告警）、REQ-030-019／020（断言与回灌）
- 前身：[`2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md`](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)

---

## REQ-030-030：质量域 safe-log → Eval 候选回流

### 背景

来源：2026-11-08 产品对话——能力盘点后选定入池。对照现状：

- **安全域** safe-log→候选池已发货（`webui/docs/65-safe-log-to-eval-spec.md`／`security-candidates.ts`）。
- **质量域** 已有 Spec [`lucy-20261014-safe-log-to-quality-eval-spec.md`](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md) 与 WO [`wo-20261014-safe-log-to-quality-eval.md`](wo-20261014-safe-log-to-quality-eval.md)，**功能合同未收口、实现未落地**。
- 0.30 已有 P1-5（审计旅程→Eval 草稿）与 P1-6（失败→工具面反哺）；缺的是与安全域对称的**质量候选池晋升管道**（错表／错口径等，需人工补 ground truth）。

⇒ 本条把既有质量域 Spec **挂入 0.30 跟进**，避免与 019／020／021 脱节或被遗忘。

### 期望方向（池内草案；不授权实现）

- 复用安全候选池流转骨架，建立隔离的质量候选池（L1／L2／L3 → `executable` 晋升）。
- **强制人工补全**质量断言与 executable 契约（日志无 ground truth，禁止自动编造期望值）。
- 与 REQ-030-020（旅程草稿）、REQ-030-025（选表断言）、REQ-030-021（工具面反哺）分工：本条专责「日志→质量候选→可跑用例」管道。

### 非目标（本条目当前）

- 不从审计日志自动推导正确答案或金标表名。
- 不重开安全域出口／不合并两池物理存储而不经 Spec。
- 开线时优先**对齐／修订既有 2026-10-14 Spec**，避免平行第二份合同，除非澄清证明必须拆分。
- **未授权实现代码**。

### 关联

- 清单：P1-9
- 既有 Spec：[`docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md`](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md)
- 既有 WO：[`docs/plans/wo-20261014-safe-log-to-quality-eval.md`](wo-20261014-safe-log-to-quality-eval.md)
- 相关条目：REQ-030-020、REQ-030-021、REQ-030-025；安全前身 `webui/docs/65-safe-log-to-eval-spec.md`

---

## REQ-030-031：轻量概念注册表（ontology-lite；上游合同）

### 背景

来源：2026-11-08 产品头脑风暴——讨论「是否要做指标平台／知识图谱／本体论」以提升语义质量、问答准备率与 MCP 效果。对齐结论：

- 最贵失败仍是 **选错表** 与 **口径被临场加工**（与 P0-1／P0-2／P0-3 主线一致）。
- 完整 KG／OWL／独立指标计算平台 **现期不值得**作为建设目标。
- 缺口是：从已有 semantic-layer／Wiki **自动盘点**「收入／资产等概念有几套定义」，并给人 **定权威解释**；一期消费者是人，Agent／MCP 更后。
- 交付序裁定：**先 CLI 跑通并验证效果 → 效果可接受后再上 WebUI 人审页 → 再考虑 MCP 注入**。

⇒ 本条登记为约束深化／内容治理辅线，为人审权威面与冲突发现服务；**不替代**运行时约束闸。

### 期望方向（结案后）

- 保留轻量 Concept／Binding 注册表上游合同（内容根 `concepts/`）与纯计算核心，供 **REQ-030-032 Ops MCP** 复用。
- **本分支不做**独立 CLI 产品交付、不做 WebUI、不做效果门跟进。
- 人审写与客户长期通道＝**REQ-030-032**（`lucy_ops_concept_*`）。
- 可手工反哺 Wiki／overlay／P0-1 绑定候选；不自动改问数 MCP 热路径。

### 非目标（本条目当前）

- 本分支 ontology-lite CLI／WebUI 交付面与效果门跟进。
- 形式化知识图谱、OWL 推理、独立指标平台／统一计算引擎。
- 问数 MCP 注入；机器自动裁定权威。
- 替换 P0-1／P0-2／P0-3。
- **不挡**原 P0 收口；本条结案 **≠ 可上线**。

### 关联

- 清单：P1-10（**委托人结案 2026-11-13**）
- Spec：[`docs/specs/lucy-20261108-concept-registry-ontology-lite-spec.md`](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md)（v0.7）
- Plan：[`docs/plans/lucy-20261108-concept-registry-ontology-lite-plan.md`](lucy-20261108-concept-registry-ontology-lite-plan.md)（v0.5）
- 相关条目：REQ-030-027（口径绑定）、REQ-030-023（catalog 语义）、REQ-030-024（歧义门闩）、**REQ-030-032**（本分支唯一产品交付通道）

## REQ-030-032：概念注册表接入 Lucy Ops 控制面

### 背景

来源：2026-11-09 产品对话。P1-10 一期 CLI 已可用于试点，但独立 CLI 对客户运维复杂度高。委托人明确：

- 运维人员核心目标是**管理配置**（语义、Wiki、连接、概念权威），不是业务问数。
- 长期交付应并进 **Lucy Ops（`lucy_ops_*`）**，而不是再维护一套 shell CLI。
- 正式立项开 Spec／Plan；**立项 ≠ 开发授权**。

### 期望方向（池内；不授权实现）

- 主交付面：`lucy_ops_concept_*` 控制面工具（scan／list／show／set_canonical／reject／summary）。
- 授权：`allow.ops`；与问数 Token／`lucy_ops_reader` 正交。
- 路径 A：本版 Ops 首发；**下一产品版本**再评估 WebUI（友好折衷，D2b）。
- 复用 P1-10 concepts 库；不改问数热路径；不自动裁定权威。
- R4 前置：效果门或委托人书面跳过。**O2＝B** 已跳过；**R4 已授予（2026-11-09）**。

### 非目标（本条目当前）

- **本版** WebUI 概念权威页（下版另议）；问数 MCP 注入 canonical；W-B 语义发布捆绑。
- 实现中（R4 已授予）；**不挡**原 P0；本条不表示可上线。

### 关联

- 清单：P1-11
- Spec：[`docs/specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md`](../specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md)（v0.5）
- Plan：[`docs/plans/lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md`](lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md)（v0.5）
- 上游：REQ-030-031／P1-10；控制面基线：L25-16／REQ-030-011（W-A 验收）／REQ-030-004（W-B，本条不依赖）

## REQ-030-033：问询预算默认阈值放宽（60 次／300s）

### 背景

来源：2026-11-11 产品对话。问询预算（Spec 162）防火墙对 runaway Agent 仍有必要，但默认 **20 次数据工具／120s 已结算忙时** 对高频数据分析用户偏紧；续查 1 次痛点不明显。

委托人选定**方案二**：次数 **60**、忙时 **300s**；续查仍 1 次；settled／并发／绝对时限不变。

### 期望方向（已实现于本分支）

- 只改 Spec 162 §7.2 **默认数字**与 initialize 指导；不改结算口径、续查通道、`continuable`、旁路纳管。
- 指导文案不得宽于代理。
- **不挡**原 P0；本条不表示可上线／客户交付。

### 非目标

- 不增续查档数；不做按角色／租户差异化配额；不改 Eval tool-budget。

### 关联

- 清单：P1-12
- Spec：[`docs/specs/lucy-20261111-question-budget-threshold-relax-spec.md`](../specs/lucy-20261111-question-budget-threshold-relax-spec.md)（v1.0）
- 实现 CR：[`docs/reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md`](../reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md)（PASS，2026-11-13；**不表示可上线**）
- 修订对象：Spec 162 §7.2；优化 Spec `lucy-20261029-question-budget-window-optimization` 的默认数字口径
- 实现提交：`2032e970`（本分支）

## REQ-030-034：发版性能基线与相对不回退（WebUI＋MCP）

### 背景

来源：2026-11-13 Agent／Roles 页卡顿复盘。Spec 174 修了 Agent 列表 batch，但 Roles 仍 N× fresh source map；Agent 页预拉 Roles；MCP 热路径无版本化相对基线。

### 期望方向（发布取证出口证据齐）

- 绝对预算＋相对上版不回退（D6）；Roles／MCP 强制情景；正式基线可引用。
- Wave 0：Roles 列表 batch；Agent 冷进页不拉完整 Roles。
- **不挡**原 P0；本条通过不表示可上线。

### 关联

- 清单：P1-13
- Spec：[`docs/specs/lucy-20261113-release-perf-baseline-gate-spec.md`](../specs/lucy-20261113-release-perf-baseline-gate-spec.md)（v0.2；发布取证出口证据齐；acceptance 代替实现 CR）
- Plan：[`docs/plans/lucy-20261113-release-perf-baseline-gate-plan.md`](lucy-20261113-release-perf-baseline-gate-plan.md)（v0.2）
- 验收：[`docs/reviews/2026-11-13-release-perf-baseline-gate-acceptance.md`](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md)
- landed W1-4 A：[`docs/reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md`](../reviews/2026-11-13-p1-13-acceptance-stands-for-impl-cr.md)

## REQ-030-035：问询预算复盘审计字段（交付面 A）

### 背景

来源：2026-11-13 产品对话。默认配额已放宽为 60 次／300s（REQ-030-033），事后调参需要区分预算终止与续查换窗耗尽、次数／忙时／墙钟维，以及窗口级与问询累计读数。既有 `budget_stop` 行与续查事实不足以支撑导出复盘。

### 期望方向（已落地）

- 交付面 **A**：Proxy 写入 `args_summary.budgetSnapshot`；`calls.csv` 表尾扁平列＋v1 字段说明；**不改**审计页 UI、**不加** MCP 响应体快照、**不改** calls-v2 数据列。
- 两类写触发：预算终止停机行＋续查换窗生效行（换窗前读数）。
- **不挡**原 P0；本条不表示可上线。

### 关联

- 清单：P1-14
- Spec：[`docs/specs/lucy-20261113-question-budget-retrospective-audit-spec.md`](../specs/lucy-20261113-question-budget-retrospective-audit-spec.md)（v1.0）
- Plan：[`docs/plans/lucy-20261113-question-budget-retrospective-audit-plan.md`](lucy-20261113-question-budget-retrospective-audit-plan.md)（v1.0）
- 评审：[`docs/reviews/2026-11-13-question-budget-retrospective-audit-claude-review.md`](../reviews/2026-11-13-question-budget-retrospective-audit-claude-review.md)（过程对抗）
- 实现 CR：[`docs/reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md`](../reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md)（PASS，2026-11-13；**不表示可上线**）

## REQ-030-048：Ops 概念核心代码根与运行时装配修复

### 背景

来源：2026-11-15 [`UAT-SUITE-OPS-CONCEPTS`](../qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md) **FAIL**——`allow.ops` 可见 `lucy_ops_concept_*`，但容器 `KTX_PROJECT_ROOT=/data/lucy` 且卷上无 `scripts/` 时，`list`／`summary` 502、`scan` `ERR_MODULE_NOT_FOUND`。承接 GAP-UAT-P1-11-RUNTIME；清单 **P1-27**。

### 期望方向

- 概念核心动态加载锚在**代码根**（如 `/app`），内容根仍信 `KTX_PROJECT_ROOT`；不得为绿往数据卷播种 `scripts/`。
- 读写加载失败统一 `ops_concept_runtime_unavailable` 且可审计；commit claim 前预加载（Spec D10）。
- 测试台复测：`UAT-R0-FIX`（`gitSha`＝修复提交且 `gitDirty=false`）＋ 01／02／03；关闭 GAP 以 INDEX 为准。

### 关联

- 清单：P1-27（**不入核心分母**）
- Spec：[`docs/specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md`](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md)
- Plan：[`docs/plans/lucy-20261115-ops-concept-code-root-runtime-fix-plan.md`](lucy-20261115-ops-concept-code-root-runtime-fix-plan.md)
- 测试台：[`docs/qa/uat/suites/ops-concepts/suite.md`](../qa/uat/suites/ops-concepts/suite.md)（复测 PASS：cursor-p1-27-ops-retest）

状态：S5｜v0.7；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。

### REQ-030-051 Wiki／Skill 真读真用＋ACL UAT（防假通）

- **总账**：P1-30（不入核心分母）
- **状态／交付**：**PASS WITH GAP**（2026-11-15 首跑；套件 `UAT-SUITE-CONTEXT-CONTENT`；必做用例 PASS；WIKI-01S BLOCKED＝GAP-2；双宿主 Claude Code CLI + Cursor Agent CLI；证据 `inbox/uat-ctx-content-2026-11-15/`；≠ 可上线）
- **测试台**：[`docs/qa/uat/suites/context-content/suite.md`](../qa/uat/suites/context-content/suite.md)
- **设计**：[`docs/design/design-2026-11-15-uat-context-content-wiki-skill.md`](../design/design-2026-11-15-uat-context-content-wiki-skill.md)

## REQ-030-052：全页面事件循环与探针风险排查

P1-21 修了访问日志重建与探针拆分，但同步 SQLite 占事件循环是服务端整体模式。委托人 2026-11-15 批准升级为全局问题并逐页排查。本条只授权**只读排查**，不授权改运行代码；越线接口另立 REQ-030-053／054 与清单行 P1-32／P1-33。

- 清单：P1-31（**不入核心分母**）
- Plan：[`docs/plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md`](lucy-20261115-page-by-page-event-loop-sweep-plan.md)
- 报告：[`docs/reviews/2026-11-15-page-by-page-event-loop-sweep-report.md`](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)
- 测试台：[`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)（首跑 FAIL，越线未整改）。本条不写 UAT PASS。
- 判定：排查报告与越线清单；门禁 `npm --prefix webui run sweep:event-loop:gate`。

## REQ-030-053：审计导出路径规模整改

P1-31 排查的两处高风险：`GET /api/admin/audit/export-inquiry-pack` 单次约 114–118 秒，期间存活探针连续失败 37 次（Chart 阈值 6），会触发 Pod 重启；`export-v2`／`export-pack-v2` 在全量或 ≥14 天范围返回 409 `too many SQL variables`。**授权与落地**：委托人 2026-11-15 23:47 授权开发并要求补测试台与等价测试（按明示确权＋开发授权处理）；实现已落地，见 Spec。

- 清单：P1-32（**不入核心分母**）
- 证据：[排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)；[O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)（F-1 集合式写法实测 0.30 秒 vs 现状 113.6 秒）
- 测试台：`UAT-SUITE-EQUIV-GUARD`（等价）＋`UAT-SUITE-PAGE-SWEEP` 的 UAT-SWEEP-02（整改后 PASS WITH GAP）

## REQ-030-054：并发压测越线接口整改

F-2／F-3／F-4／F-5／F-7 单次 0.2–2 秒，并发压测下 `/api/livez` 超 400ms。是否引入只读 worker 依 O1 复评：先剖析、先减负，仍超线再复评。**授权与落地**：同 REQ-030-053；实现已落地，未引入 worker。

- 清单：P1-33（**不入核心分母**）；排在 P1-32 之后
- 测试台：`UAT-SUITE-EQUIV-GUARD`＋`UAT-SUITE-PAGE-SWEEP` 的 UAT-SWEEP-02（整改后 PASS WITH GAP）

## REQ-030-055：大 Schema 接入（宽表与多表）

客户有列非常多的表、表数非常多的 Schema。2026-11-15 本机用真实 KTX、Doris、Hive、MySQL 复现并量化了四处瓶颈。2026-11-15 委托人明示确权并授权开发，授权范围见 Spec「授权」行；实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（共 5 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）。

- 清单：P1-34（**不入核心分母**）
- Spec／Plan：[Spec](../specs/lucy-20261115-large-schema-ingestion-spec.md)；[Plan](lucy-20261115-large-schema-ingestion-plan.md)
- 测试台：[`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md)，规模下限不得降低；判定见 INDEX

## REQ-030-056：表级歧义门闩纯 MCP 逃生（P0-3 伴生）

父 P0-3／REQ-030-024 强门禁落地后，纯 MCP（无 WebUI 确认）在合法多表 join、钉选集外等多来源场景无逃生，分析师主路径被掐死。委托人 2026-11-16 夜免 Codex 终审、确权并授权开发：钉选放行＋选表歧义「放行＋披露＋审计」（D10–D15）。2026-11-22 S5 收口批闭合 SC-E 证据与实现 CR（相对 Nov-17 FAIL 翻绿）。

- 清单：P1-35（**不入核心分母**）
- Spec／Plan：[Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)；[Plan](lucy-20261116-source-ambiguity-mcp-escape-plan.md)
- 测试台：[`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)；INDEX＝**PASS**（含 ESC-11）
- 跟进：**S5｜v0.4。功能合同已收口（2026-11-22）**；SC-E 证据＋实现 CR PASS；GAP-UAT-P0-3-ESCAPE 已关。本条收口不表示可上线。

## REQ-030-057：调用流水 trace 级可追溯与存档

客户全量调用流水评估暴露的审计证据缺口：协议请求无 `trace_id`、主状态大面积 `unknown`、无阶段耗时、来源 IP 为网关、错误详情含基础设施细节。委托人批准方案 B（新增 span 表、同事务写入）与存档第 1 层（trace 全链路关联＋封存导出，不含防篡改链与外送）。

- 清单：P1-36（**不入核心分母**）
- Spec／Plan：[Spec](../specs/lucy-20261116-trace-span-ledger-spec.md)；[Plan](lucy-20261116-trace-span-ledger-plan.md)
- 测试台：[`UAT-SUITE-TRACE-LEDGER`](../qa/uat/suites/trace-span-ledger/suite.md)；判定见 INDEX（仍 PASS WITH GAP）
- 跟进：S5｜v1.1；功能合同已收口（2026-11-22，scoped）。[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。本条收口不表示可上线。

## REQ-030-058：MCP 体验韧性

客户全量流水暴露的体验短板：握手退化与长尾、拒绝与失败信息不可操作、上游会话丢失后的无退避重试风暴、拒绝类请求耗时过长。本轮纳入 U1–U4；U5 预算终止、U6 口径防呆、U7 能力缺口、U8 语义层契约前置检查登记为后续候选。取证先行；指标 M1–M9 只定义口径，告警接线挂冻结的 P0-7。

- 清单：P1-37（**不入核心分母**）
- Spec／Plan：[Spec](../specs/lucy-20261116-mcp-ux-resilience-spec.md)；[Plan](lucy-20261116-mcp-ux-resilience-plan.md)
- 测试台：[`UAT-SUITE-MCP-UX-RESILIENCE`](../qa/uat/suites/mcp-ux-resilience/suite.md)；判定见 INDEX（仍 PASS WITH GAP）
- 跟进：S5｜v1.1；功能合同已收口（2026-11-22，scoped）。[收口记录](../reviews/2026-11-22-p136-p137-s5-closure-record.md)。本条收口不表示可上线。

## REQ-030-059：推断问询补算让出事件循环

客户升到含 P1-21 的 `0.30.0` 后，后台仍按用户整段同步重建近 30 天推断问询，事件循环一次占用约 2 秒，存活探针、就绪探针和 KTX 探针轮流超时，入口出现 503／502。站点已回滚。本条把单个用户的重建改成分页读取和分片写入。

- 清单：P1-38（**不入核心分母**）
- Spec／Plan：[Spec](../specs/lucy-20261117-inferred-turn-rebuild-yield-spec.md)；[Plan](lucy-20261117-inferred-turn-rebuild-yield-plan.md)
- 测试台：not_registered。缺口 `GAP-UAT-P1-38`
- 跟进：**v0.2-draft。推断问询补算按 400 行一页读取、按 25 个问询一片写入。读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前各让出一次事件循环，已排队的宏任务先于下一段同步工作运行。本次读取冻结到开始时该用户回看窗口内的最大 access_log.id。问询编号在该删除事务内按簇顺序分配，已有 correlation_key 沿用。来源查询按 500 个 id 一段。重算先按即将写入的 inferred_turn_id 删除残留行。补算期间再次标脏的用户留到下一轮。400 行和 25 簇是条数上界，单段仍可能超过探针的 3 秒。工作区已有实现与 vitest。终稿未确权。测试台 not_registered。不入核心分母。≠ 可上线**

## REQ-030-060：客户 K8s 升级残余 event loop／readyz 超时

2026-11-17 客户站点平滑升级至 0.30.0 后，WebUI 进程 event loop 持续约 2.2s 级延迟，readiness 系统性超时摘端点，入口 502／503；现场已回滚。与 REQ-030-042（P1-21）同族但场景不同：彼时偏 liveness 杀 Pod，本次偏 readiness 摘流量且阻塞点未定位。已起草 [Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md)、[Plan](lucy-20261117-cold-start-audit-scan-plan.md) 与测试台 [`UAT-SUITE-COLD-START-SLOW-DISK`](../qa/uat/suites/cold-start-slow-disk/suite.md)，**终稿未确权、未授权实现**。

**根因定位（2026-11-17 夜，本机受控限速复现；非客户现场直接证据）**：同一份 20 万行／883MB 旧 schema 审计库，慢盘＋冷页缓存下，客户上一次平滑升级版本 `20261111-r1`（0.25.0／`9c78b0e3`）正常启动，0.30.0（`be34e05a`）在 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT` 崩溃；库先迁移完仍崩，排除一次性建索引。元凶＝`211f2d64` 新增 `inferred-turn-maintainer` 启动 `scanFull`（`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`，整条 `idx_al_user_ts` 覆盖索引全扫描，同步，慢冷盘 12.4s）；`abb38913` 每 10s 轮询 `OR` 查询同为全索引扫描。`79db4352`（P1-38）把轮询改成 `id > ?`，`scanFull` 未改，HEAD 已实测仍崩溃（见 v0.80）。持续 p99 2.2s 与客户磁盘的关系待客户侧 fsync／IO 证据。

- 清单：P1-39（**不入核心分母**）
- 错题：[2026-11-17-k8s-upgrade-event-loop-readiness-timeout](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md)
- 前序：REQ-030-042／052／053／054
- 状态：S5｜v0.3；功能合同已收口（2026-11-22，漏斗底端分批收口·批次 1）。终稿已确权、开发已授权（不含 schema 变更、不含线上升级）；启动补算与稳态轮询已改为有界读取，审计库打开与迁移在 app.listen 前完成；vitest 守卫及 SC-01–SC-17 出口通过。不入核心分母。≠ 可上线

## REQ-030-061：明文 HTTP 复制按钮假成功

明文 HTTP（内网／公网演示）是 Lucy 的支持形态，此时 `navigator.clipboard` 不存在，所有复制入口走 `execCommand` 降级。降级路径隐藏 textarea 未 `focus()`／`select()`，选区为空，`execCommand("copy")` 仍返回 true，界面提示「已复制」而剪贴板未写入：不严重，但对用户欺骗性强，且新建 Token 明文、MCP 配置等高价值复制都受影响。委托人 2026-11-17 授权调研并收敛 UAT／机制，不含修复授权。

- 清单：P1-40（**不入核心分母**）
- 错题：[2026-11-17-clipboard-http-fake-success](../lessons/2026-11-17-clipboard-http-fake-success.md)
- 测试台：[`docs/qa/uat/suites/copy-fake-success/suite.md`](../qa/uat/suites/copy-fake-success/suite.md)；判定见 INDEX，本条不写 PASS／FAIL 现值。
- 前序：Spec 192（剪贴板非安全上下文降级）
- 委托人 2026-11-17「授权修复」（事故修复授权）：`webui/src/lib/clipboard.ts` 已修（工作树）；Spec 192 §13.5 记录；测试台改后 PASS WITH GAP。未提交；≠ 可上线。

## REQ-030-062：访问关系图桑基还原

访问关系图（`/admin/access-map`）应是授权面与访问面叠加的桑基。线上镜像缺 `f3f88837`（允许词表）与 `e2ca2ca7`（空桑基修复），HEAD 在零访问、多 Agent、全未确认下仍退化为文字与发丝。委托人 2026-11-17 授权探查与设计，约束「暂不开发」。

- 清单：P1-41（**不入核心分母**）
- 状态：S5｜v0.2；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。D0＝C；终稿由委托人明示确权；已授权并实现 A2／A3 与 Track B 方案 C，已提交。不入核心分母。≠ 可上线
- Spec：[lucy-20261117-access-map-sankey-restoration-spec](../specs/lucy-20261117-access-map-sankey-restoration-spec.md)
- 错题：[2026-11-17-access-map-sankey-regression](../lessons/2026-11-17-access-map-sankey-regression.md)
- 测试台：[`docs/qa/uat/suites/access-map-sankey-design/suite.md`](../qa/uat/suites/access-map-sankey-design/suite.md)；判定见 INDEX，本条不写 PASS／FAIL 现值。
- 已裁定：D0＝C（委托人 2026-11-17「批准方案 C，授权定稿开发」）。Plan：[lucy-20261117-access-map-sankey-restoration-plan](lucy-20261117-access-map-sankey-restoration-plan.md)。

## REQ-030-063：按钮级「成功反馈真实性」排查（下载／保存／导出）

P1-40 同类排查证明：界面成功反馈与动作真实结果不一致是一类缺陷，不限于复制。本条把同一问题扩展到下载、保存、导出，**仅限按钮级**：只查成功反馈是否以可观察结果为前提，不查导出内容对错与业务功能。委托人 2026-11-17 授权盘查、修复、建机制；UAT 失败场景只用真实失败。

- 清单：P1-42（**不入核心分母**）
- 状态：S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `f1436556`；≠ 可上线
- Spec／Plan：[Spec](../specs/lucy-20261122-button-feedback-honesty-spec.md)；[Plan](lucy-20261122-button-feedback-honesty-plan.md)
- 前序：REQ-030-061／P1-40；Spec 14 §0.3（写入类成功仅当 `runtimeAck === true`）
- 测试台：`UAT-SUITE-BUTTON-FEEDBACK`；判定见 INDEX。

## REQ-030-065：页面渲染崩溃被兜底页伪装成版本问题

调用流水合并 `auth_failure` 行导致故事线崩溃；路由兜底把普通渲染错误伪装成版本问题。委托人授权登错题、建 UAT、修正兜底边界。

- 清单：P1-44（**不入核心分母**）
- 状态：S5｜v1.0；功能合同已收口（2026-11-22，scoped；B1）。实现已提交 `c1f54f64`；≠ 可上线
- Spec／Plan：[Spec](../specs/lucy-20261122-page-open-error-boundary-spec.md)；[Plan](lucy-20261122-page-open-error-boundary-plan.md)
- 错题：[2026-11-18-audit-calls-render-crash-misreported](../lessons/2026-11-18-audit-calls-render-crash-misreported.md)
- 测试台：`UAT-SUITE-PAGE-OPEN`；判定见 INDEX。

## REQ-030-064：Lucy 不透出数据库原始错误

客户 `hive_jd` 读不到字段的排障暴露：外部目录读字段失败时，页面只给「没有读到字段」，Doris 原文只进容器日志，握手失败、元数据服务慢、元数据服务起不来在页面上无法区分，现场排障必须登录容器翻日志。本条**仅登记**，不授权改运行代码，也不是客户 `hive_jd` 的根因结论。

- 清单：P1-43（**不入核心分母**）
- 事实：`SchemaColumnRejection` 仅 `{table, reason}`；`rejectionMessage` 对 `unreadable` 一律同文；单表读取 8 秒×三条探针；单表路径超时文案走不到。**未验证**：表列表读取、连接测试等其他路径。
- 设计约束：原文须脱敏并限定可见范围；不得改变既有成功／失败判定；合法用户主路径不受影响。
- Spec：[lucy-20261118-db-original-error-surfacing-spec](../specs/lucy-20261118-db-original-error-surfacing-spec.md)（v0.1-draft）
- 错题：[2026-11-18-db-original-error-not-surfaced](../lessons/2026-11-18-db-original-error-not-surfaced.md)
- 测试台：not_registered；本条不写 PASS／FAIL 现值。

## REQ-030-069：多步流程状态机合同门禁

未显式声明状态机时，多步／门禁／发布／恢复路径易出现布尔冒充终态、非终态不落库、规则分叉、无逃生死路、组级「一败一成」。本条立文档门禁：触发 Spec 须可解析「多步状态机合同」；落地限 `lint:spec-docs` 与治理正文。委托人 2026-11-18 授权起草 Spec／Plan，**暂时不开发**。

- 清单：P1-48（**不入核心分母**）
- Spec／Plan：[lucy-20261118-multi-step-state-machine-contract-gate-spec](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md)／[plan](lucy-20261118-multi-step-state-machine-contract-gate-plan.md)（v0.1-draft）
- 测试台：not_registered；本条不写 PASS／FAIL 现值。
- **≠ 终稿确权 ≠ 开发授权；未授权不改运行代码与 lint**

## REQ-030-071：重建快照上界与完成水位（FDE R01）

- 状态：X_SUP｜被取代（并入 REQ-030-066／P1-45；2026-11-22 文档收口）。
- 合同落点：[P1-45 Spec](../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) §3.1（`ceilingId`；`covered()` 按 id）。
- 不另开独立 Spec／UAT；随 P1-45 S5 闭合。≠ 可上线。

## REQ-030-070：`lucy_ops_reader` 无头可问治理面 ACL

连接 `lucy-ops` 的 `enabled_tables` 已含 W0∪W1∪W2，但正式 Role `lucy_ops_reader`（demo／存量）表选择器常停在 SC-17c 的 `ops_calls`／`ops_call_tables`。可问治理面 Skill／Wiki 已路由 W1／W2，无头 MCP 却因 Role ACL deny。本条推荐对「规范 W0 指纹」做 ensure 幂等 heal，定制 Role 不覆盖；并修订 D22／§3.2「已存在永不扩 names」的窄例外。委托人 2026-11-18 授权起草 Spec／Plan，**暂时不开发**。

- 清单：P1-49（**不入核心分母**）
- Spec／Plan：[lucy-20261118-lucy-ops-reader-headless-governance-acl-spec](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md)／[plan](lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md)（v0.1-draft）
- 测试台：not_registered；本条不写 PASS／FAIL 现值。
- **≠ 终稿确权 ≠ 开发授权；未授权不改运行代码**

## REQ-030-072：版本轴分工与命名规约

0.30 开发期多次出包共用 `VERSION=0.30.0` 与 `customer-` 前缀，与将来定稿撞号；交付仓多包难追溯。委托人确认：合并 main＝产品线大版本；合并前＝自动分配的 `X.Y.Z-rc.N`＋交付主键 `lucy-k8s-integration-YYYYMMDD-rN`（否决候选用 `0.31`／正式 `X.Y.Z`）；号码由出包流水线分配、禁止人工起号；支持后期追溯与私有化分叉定位。**暂时不开发**。

- 清单：P1-51（**不入核心分母**）
- 状态：S1｜v0.3-draft；**≠ S2（终稿未确权）**
- Spec／Plan：[lucy-20261118-version-axis-naming-spec](../specs/lucy-20261118-version-axis-naming-spec.md)／[plan](lucy-20261118-version-axis-naming-plan.md)（v0.3-draft）
- 测试台：not_registered；本条不写 PASS／FAIL 现值。
- **≠ 终稿确权 ≠ 开发授权；未授权不改运行代码、镜像与 CI**

## REQ-030-073：客户镜像升级可靠性分层门禁

客户升级到 0.30.0 后因事件循环卡顿、readyz 超 3 秒和入口 502／503 回滚。委托人认可两项底线：发布门禁必须绑定候选 digest、Chart/values、N-1 版本等基线；测试必须覆盖客户数据量级，不能只用小样本。对难以复制客户 K8s 的问题，采用「环境等价」三层折中，而非宣称本机或通用 kind 等于客户现场。

- 清单：P1-52（**不入核心分母**）
- Spec／Plan：[lucy-20261118-customer-upgrade-reliability-gate-spec](../specs/lucy-20261118-customer-upgrade-reliability-gate-spec.md)／[plan](lucy-20261118-customer-upgrade-reliability-gate-plan.md)（v0.1-draft）
- 层级：发布取证。镜像前只做预检；镜像后 A 层原生 amd64 容器数据／资源压力与 B 层标准 K8s 持续升级为每个候选必跑；C 层客户隔离预演按验证边界触发。
- 测试台：not_registered；本条不写 PASS／FAIL 现值。
- **≠ 终稿确权 ≠ 开发授权；评审前不开发、不执行 UAT；未授权不改运行代码、CI、门禁脚本与测试台**

## REQ-030-074：MCP 升级兼容底线与全真用户旅程门禁

客户 WorkBuddy 既有「会员收入」问数被 `source_ambiguity_gate` 高频阻断。委托人对齐目标（已入 Spec「目标（Normative，防漂移）」）：用至少一个真实 Agent 客户端真实调用 Lucy Public MCP，跑全题库，对照基准线，给出敢不敢给用户部署／升级的三维决策依据。通用事故回归与客户真实成功基线缺一不可；功能／权限零回归；Agent 每轮＞120s＝FAIL（归因不得放行）；无总成本上限；无基线或必做项 FAIL／BLOCKED／NOT RUN 均不得放行。

- 清单：P1-53（**升级放行＝P0 底线；不入核心分母**；编号避让 P1-52／REQ-030-073）
- 状态：S3｜v1.1；终稿补丁确权＋开发已授权；实现进行中（Wave 0）
- Spec／Plan：[lucy-20261118-mcp-upgrade-compatibility-spec](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)／[plan](lucy-20261118-mcp-upgrade-compatibility-plan.md)（**v1.1 终稿补丁**）
- 测试台：`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`，INDEX **PASS**（四入口：[跑次](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md)）
- 题库正本＝REQ-030-075；开跑前须 CompatConfigProfile 指纹（D27）；缺环境／缺配置 BLOCKED。
- **X_REL｜发布取证已收口（2026-11-22）**；≠ 可上线

## REQ-030-075：MCP 升级兼容多场景题库

独立题库＋**Lucy 配置资产包**。委托人确认：全真须配合连接／语义／Role／权限等配置才具备落地条件。覆盖业务、追问、多表、权限、多库与 Ops W0／受控 W1／W2。

- 清单：P1-54（**P0 底线题库＋配置合同；不入核心分母**）
- 状态：**S5｜v1.1。功能合同已收口（2026-11-22，严口径）**；选项 2：QB-ACL-03b-gate＝scoped 行隔离成交（P1-72）
- Spec／Plan：[question-bank-spec](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md)／[plan](lucy-20261118-mcp-upgrade-question-bank-plan.md)（**v1.1**）
- 父合同：REQ-030-074／P1-53 v1.1；提供 `questionBankDigest`＋`configProfileFingerprint`
- 测试台：共享 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`，INDEX **PASS**（P1-53 certifyCandidate；严口径证据：[复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)）
- 证据：SC／CR PASS；零 new deny／零翻转／34／34／三维 PASS。不得改 P1-53 放行判定／发布接线；≠ UAT PASS；≠ 可上线

## REQ-030-076：FDE 3b1c62af 打包前检查本机复现 UAT

委托人要求用本机按 UAT 规范复现 FDE 前方报告的测试场景与结论。两层：L1 原样复现 FDE 脚本（自动化复现，不进测试台）；L2 全真 UAT（进测试台）。

- 清单：P1-55（**不入核心分母**）
- Plan：[fde-3b1c62af-local-repro-uat-plan](lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md)（v0.2）
- 测试台：[`UAT-SUITE-FDE-PACKCHECK`](../qa/uat/suites/fde-packcheck-3b1c62af/suite.md)，现值见 INDEX（BLOCKED）；后续修复复验模式由 P1-57 草案承接。
- 授权：本机复现历史 D1–D4 与后续 12:35 投影进度／缩短窗口授权分开记录；P1-57 本轮仅计划、总账与验收文档，确认前不修复／不重跑，D5 拒绝代理待独立确认。

## REQ-030-077：FDE 3b1c62af 报告候选缺陷补录

登记 FDE 报告结论：F01（正式 CSV／ZIP 导出等待追平后仍 409）、F02（慢合法 Hive 语法被误判超时）、F03（单表 defer 被吞）、F04（宽表整批 deferred 后客户端无进展）、AUDIT-01（滚动窗口重复归属）。旧候选的 L1 复现成立；修复评审已有真实 Docker 局部证据与 BLOCKED 跑次，完整全真复验尚未完成。

- 清单：P1-56（**不入核心分母**；级别待复现后定）
- 关系：F04 触及 P1-34；F02／F03 触及 P1-20；AUDIT-01 触及 P1-45／P1-50；F01 触及 P1-32／P1-36。**不重复这些条目的既有状态**
- 注意：`upgrade-fix-regressions.test.ts` 有 8 个带作者原因的 `it.skip`，需先核对对应用户行为是否仍是 0.30 合同（Plan UAT-FDE-R1）
- **本机 L1 复现（2026-11-19）**：候选 `3b1c62af` 上 5 项均在受控替身复现，非 UAT，未入 INDEX。契约修订草案：F02＝P1-20 §8；F03／F04＝P1-34 §11；F01＝v2p5 §18.19 N26（S06 所在 Spec）；AUDIT-01＝P1-38 §8（重建主 Spec；与 P1-45／P1-50 的关系不变）。整改 [Plan](lucy-20261119-fde-3b1c62af-contract-remediation-plan.md)；[错题本](../lessons/2026-11-19-fde-3b1c62af-defects-missed-by-uat.md)。修订落点的选择（F01 落 v2p5 而非 P1-32／P1-36，AUDIT-01 落 P1-38 而非 P1-45／P1-50）待终审确认。
- **委托人批准（2026-11-19）**：决策点闭合（P1-34 O7–O10；P1-38 O1 接受、O2 否决、O3 待 SC-14）；整改分两批；F01／AUDIT-01 优先移植 84 做法；UAT 受控降级口径授权，amd64 模拟不授权。**上一批4份修订曾确权并获整批授权，实现已提交d8c3f097；Codex复评仍检出R1／R2及验收缺口，后续按P1-57草案待本次确认。O3存量批量标脏仍未授权**

- **复评后现值**：v1.0 上一批实现 d8c3f097 及复评记录保留；混合权限与全局请求上限已由获授权的 P1-57 修复并复验。原完整范围FDE实测FAIL保留；委托人2026-11-19已将G6正式完整导出基线缺口延期，本次客户功能测试排除此项，可按限定范围进行，不声称导出已修复。O3仍未授权，D6未实施；≠ 可上线。

## REQ-030-049：行级隔离场景

委托人 2026-11-15 把「十几个人对一批表按不同行范围问数」定为 0.30 核心能力。本条只登记场景，不代替既有行权限 Spec，也不授权改运行代码。验收只认测试台 `UAT-SUITE-ROW-POLICY` 必做 PASS。数据可以是 demo 上自造的 `uat_row_policy_` 批次。

- 清单：P1-28（**入核心分母**）
- 测试台：[`docs/qa/uat/suites/row-policy-finance-scenario/suite.md`](../qa/uat/suites/row-policy-finance-scenario/suite.md)
- 判定：INDEX。本条不写 PASS／FAIL 现值。

## REQ-030-050：行级取值存在性校验

同一场景里，把行级列配成库中不存在的字面量时，保存应被拒绝，或向管理员显示该取值不存在。现行实现只有字段级校验。本条只登记缺口，不是实现 Spec。

- 清单：P1-29（**不入核心分母**；**Deferred；下一期**）
- 测试台：同一套件 UAT-ROW-07；缺口 `GAP-UAT-P1-28-VALUE`
- 未授权实现。委托人 2026-11-22 解耦：本条 **不挡** P1-28／`UAT-SUITE-ROW-POLICY` 对核心分母的 PASS；INDEX 对 ROW-07 单独跟踪。
- **委托人 2026-11-22 明示**：放在需求池，**下一次迭代再优化**；0.30 **不开发**（总账 `X_DEF`）。



## REQ-030-078：FDE 修复复评的功能阻塞与验收补齐

- 清单：**P1-57**（不入核心分母），承接 P1-56／REQ-030-077；逐项执行子表以总账 P1-57 为准。
- 来源：2026-11-19 Codex 修复评审；原 FDE 混合权限场景仍失败（仅见 t0）；600 表有进展仍在第 101 请求中止。报告的单元／替身结论与 [正式 UAT 跑次](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-fix-review.md) 分层记录。
- 合同复用：P1-34 §11（LS-20、LS-19／24、拟增 LS-26–30）；P1-38 §8（SC-12／15／16）；v2p5 §18.19 N26-6。不另造重复功能 Spec。
- Plan：[FDE 修复复评整改](lucy-20261119-fde-acceptance-remediation-plan.md)，v0.1-draft。**仅授权计划、总账与验收文档；须委托人确认后才修改运行代码／测试、构建 Docker 和重跑 UAT。**12:35 的上一批授权不冒充本次确认。
- 验收：原业务断言不降规模；新增正常／异常／身份过期／失败关闭对照；实际 runner、真实 HTTP 客户端、多级跨界满量与探针预算；详见 Plan AR-01–AR-10。
- 测试台：沿用 `UAT-SUITE-FDE-PACKCHECK`，新增修复候选模式草案；历史模式及跑次保留；本轮未重跑，INDEX 仍 BLOCKED。
- 边界：O3 存量批量标脏、P1-47／50 合同变更、补 demo 审计基线、出包／发布均不在本批默认范围。

## REQ-030-079：角色权限与 Agent 列表读取响应

- 总账：[P1-58](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，P1 第一批，不入核心分母。
- 来源：2026-11-19 高频卡顿只读探查；已核实窗口统计读取全部历史、凭据最新访问窗口排序、角色跨请求重复构建。生产 HTML 502／503 的具体触发原因未取得日志，不能宣称本条已经定位全部事故根因。
- 合同：[Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md)；[Plan](lucy-20261119-roles-agent-read-responsiveness-plan.md)。复用 Spec 174／195 与 P1-13 的既有合同，不重做已实现批量化。
- 跟进状态：S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）。测试台仍 PASS WITH GAP（仅B1）。本条收口不表示可上线。
- 验收：窗口与全历史最新值拆分、统计等价、版本化展示复用、分区失败与 5 秒新鲜度补偿；scoped 出口＝B1；完整 SC-01–12 第二批另期。
- 测试台：[共享 UAT](../qa/uat/suites/roles-agent-concurrency-scale/suite.md)；batch1 跑次。
- 授权边界：第二批不自动执行；不发布上线。

## REQ-030-080：角色权限与 Agent 多人编辑冲突恢复

- 总账：[P1-59](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，P1 第二批，不入核心分母。
- 来源：角色与 Agent 共用整文件版本，无关对象修改可能冲突；同账号独立会话并非单会话互踢。不能把生产网关错误归咎于共用账号。
- 合同：[Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md)；[Plan](lucy-20261119-roles-agent-concurrent-edit-plan.md)。保留既有发布窗口、恢复门禁、运行时确认与审计终态。
- 跟进状态：S5｜v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）。测试台仍 PASS WITH GAP（仅B1）。本条收口不表示可上线。
- 验收：对象版本与真实依赖重检、无关对象安全先后保存、同对象显式冲突、草稿保留、保存结果核对；scoped 出口＝B1；完整 SC-01–13 第二批另期。
- 测试台：[共享 UAT](../qa/uat/suites/roles-agent-concurrency-scale/suite.md)；batch1 跑次。
- 授权边界：第二批不自动执行；不发布上线。

## REQ-030-081：begin 价值重评与零绑定 MCP 问数不受影响

- 总账：[P1-60](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，P0 主路径修复；沿用 P0-1 核心分母，不重复计数。
- 来源：11-19 只读排查与委托人零绑定不受影响要求；v0.1 未获认可 → v0.5 事务方案 → v0.6 批准 inactive 隐藏 begin → **v0.7 按新定位收缩为 N＋隐藏面**（预算／ACL 待商议且不改）。
- 本修复 [Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md)／[Plan](lucy-20261119-webui-publish-caliber-registry-repair-plan.md)；父 P0-1 及审计／预算／ACL 合同本条不借隐藏 begin 改写（OQ-4）。
- 跟进状态：v0.9；功能合同已收口（SC-01–12通过，P1-60／P1-64同一冻结候选完整复验）；预算持久化锁竞争修复纳入；本轮增量已提交；未推送／发布；不入新增核心分母；本条收口不表示可上线。
- 评审：[决议](../reviews/2026-11-19-begin-zero-binding-review-decisions.md)；[隐藏 begin 决议](../reviews/2026-11-20-begin-hide-decision.md)；F-01–07 与 H-01–05 见 Spec §9。
- 验收：F＝SC-01–12；已授权T6完整Docker R，最新[同候选完整跑次](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final.md)；结果见INDEX。
- 复盘：[测试漏检](../lessons/2026-11-19-begin-zero-binding-test-gap.md)。
- 授权边界：本轮已授权剩余整改、必要回归、完整Docker UAT、合并P1-64与类型／浏览器核验、三台账和整包终审；包含SC-05／10必要预算持久化锁竞争修复，不改额度／轮次／ACL；本进程提交已获后续授权；不推送／发布。


## REQ-030-085：同连接跨 Schema 短名冲突与保存运行时确认修复

- 来源：委托人 2026-11-19 提供《Lucy问题反馈.md》，要求排查代码并在 Docker 或指定 WebUI 做一次复现；2026-11-20 要求按仓库规范制定修复方案和验收步骤，暂不改运行代码。
- 清单：P1-64（不入核心分母）。
- 已复现缺陷：扫描单独生成两个 Schema 时同名物理表均生成裸短名，Source Map 却按连接要求短名唯一；Manifest 上传后合法 MCP 请求被 `source_map_compile_failed:duplicate_source_name` 拒绝。启用表保存同时报告 `runtimeAck=true`，与实际可用性分叉。
- 修复合同：[Spec v0.4](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[Plan v0.4](lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md)。新增冲突表确定性别名、有效旧映射保留、最终文件集合校验、发布锁内复核、旧冲突增量修复，以及两条 `ktx.yaml` 写入路径的 Source Map issue ack 负控。
- 跟进状态：v0.4。功能合同已收口（SC-01–10通过；合并候选全库TypeScript0错误，782项Vitest及29项概念模块回归通过，真实前台浏览器计时完成）；本轮增量已提交；未推送／发布；不入核心分母；本条收口不表示可上线。
- 验收：SC-01–10均通过；[最终候选跑次](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md) R0／01–12与前台浏览器PASS；SC-09全库0错误、782项Vitest及29项概念模块回归PASS。
- 授权边界：本轮续授49条类型修复与回归、隔离Docker／浏览器验收、台账同步与最终评审；已执行，本进程提交已另授；不含推送／发布。

## REQ-030-086：Wiki 覆盖上传采用 YAML 授权声明

- 总账：[P1-65](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，不入核心分母。
- 合同：[Spec](../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md)；实施：[Plan](lucy-20261120-wiki-upload-acl-adoption-plan.md)；测试台：[UAT-SUITE-WIKI-UPLOAD-ACL-ADOPTION](../qa/uat/suites/wiki-upload-acl-adoption/suite.md)（历史基线 FAIL 保留）。

- 跟进状态：v0.2。终稿已确权；开发授权已获得；实现完成；四项验证缺口已整改；改后 Docker UAT＝PASS（见测试台 INDEX）；功能合同已收口；不入核心分母；≠ 可上线。

- 本轮整改（v0.124，2026-11-20）：四项验证缺口已实测关闭；SC-01–14／51 个独立验收 ID PASS，153 份角色检查／306 条工具断言，最终零残留；[新跑次](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-codex-closure-recheck.md)；UAT 执行结束时未 commit／push；委托人后续已授权 commit 本任务，不 push。

## REQ-030-082：存活／就绪探针纯内存响应与诊断隔离

- 总账：[P1-61](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，不入核心分母；优先级与先后顺序为草案建议。
- 差集及去重：[核对报告](../reviews/2026-11-19-core-availability-gap-assessment.md)；不重复已实现的worker、恢复、局部探测队列和既有发布门禁，不预判本次现场503根因。
- 合同：[Spec](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md)；实施：[Plan](lucy-20261119-memory-probe-diagnostics-isolation-plan.md)；测试台：[UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) F61。
- 现值：v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-01真实停止／自动恢复局部复测PASS WITH GAP；完整F61矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。

## REQ-030-083：重任务跨模块容量控制与许可生命周期

- 总账：[P1-62](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，不入核心分母；优先级与先后顺序为草案建议。
- 差集及去重：[核对报告](../reviews/2026-11-19-core-availability-gap-assessment.md)；不重复已实现的worker、恢复、局部探测队列和既有发布门禁，不预判本次现场503根因。
- 合同：[Spec](../specs/lucy-20261119-heavy-work-capacity-control-spec.md)；实施：[Plan](lucy-20261119-heavy-work-capacity-control-plan.md)；测试台：[UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) F62。
- 现值：v0.1-draft。终稿已确权（委托人 2026-11-20 明示本提示词确权）；开发授权已获得；实现已落地（本机单元与组件测试通过）；本机 Docker 局部 UAT PASS WITH GAP（仅真实导出入口；完整 F62 未完成）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。

## REQ-030-084：进程关停准入关闭与在途请求排空

- 总账：[P1-63](lucy-20261107-lucy-0-30-feature-inventory-pool.md)，不入核心分母；优先级与先后顺序为草案建议。
- 差集及去重：[核对报告](../reviews/2026-11-19-core-availability-gap-assessment.md)；不重复已实现的worker、恢复、局部探测队列和既有发布门禁，不预判本次现场503根因。
- 合同：[Spec](../specs/lucy-20261119-process-drain-lifecycle-spec.md)；实施：[Plan](lucy-20261119-process-drain-lifecycle-plan.md)；测试台：[UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md) F63。
- 现值：v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-02 MCP在途登记／实际Node PID等待局部复测PASS WITH GAP；完整F63矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。

## REQ-030-087：Agent 名册摘要投影与单对象详情按需读取

- 来源：2026-11-20 委托人明确要求纳入总账并先出方案、Spec／Plan；[109 探查](../../inbox/lag-109-codex-20261120/findings.md)核实 71 Agent 返回 4,833,709 B，完整权限约占 98.08%，展开 13,815 条 capability。
- 清单：[P1-66](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；前序 REQ-030-079／P1-58 已拆名册与统计，本条补摘要投影与详情读取，不重复宣称前序成果。
- 范围：新增显式摘要投影、独立前端 DTO／缓存键、服务端同槽 sidecar；statistics 内部轻读与同代配对，legacy 三模式；保留旧完整列表和旧 roster 默认；名称打开的对象详情抽屉改为读取单个 Agent；编辑与完整权限 fresh 路径保留；保留现场权限展开宽度的 Docker 前台浏览器＋API／体积对照设计。
- 文档：[Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [Plan](lucy-20261120-agent-roster-summary-projection-plan.md) · [UAT-SUITE-AGENT-ROSTER-SUMMARY](../qa/uat/suites/agent-roster-summary/suite.md)。
- 状态：v0.3。委托人2026-11-20批准分批收敛及本进程commit；批次A功能合同已收口；本机Docker最小验收PASS WITH GAP；批次B暂停，原v0.2完整矩阵FAIL保留；本批增量提交；未推送／发布；不入核心分母；本批收口不表示可上线。
- 授权边界：委托人已批准本批实现、最小Docker验证与本进程commit；完整矩阵及编译器后续优化暂停；不推送／发布，不升级109。

## REQ-030-088：用户旅程性能门禁（API／WebUI 交互；MCP 已移交 P1-78）

- 清单：[P1-67](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；前序：性能优化类 P1-13／P1-58／P1-66 修复代码本体，本条只做**系统性测试与门禁**，不重复宣称前序成果、不重修性能。
- 来源：[错题 2026-11-20-ksc-025-roles-agents-stuck-old-build](../lessons/2026-11-20-ksc-025-roles-agents-stuck-old-build.md)（KSC 0.25.0 现场 roles 55 s／agents 4.8 MB 实测）＋ 2026-11-20 系统性盘点结论（`perf:entry`／`perf:release-baseline` 存在但 CI 零命中；MCP 问询端到端延迟零预算零测试；被测构建与部署实例版本漂移无看守）。
- 范围：三维度用户视角性能预算（API 核心读路径／WebUI 前台交互计时／MCP 问询全链路分位延迟）；将既有 runner 接入 CI 硬门禁（ci-small 每跑、release-medium 发版前）；每条性能结论强制绑定 gitSha＋实例指纹；现场部署版本与发版台账对账看守；版本性能特性对照表（0.25.0／3a9f0711／1fb73f72 实测口径）入 runbook。
- 范围：API 核心读路径与 WebUI 前台交互计时；将既有 runner 接入 CI 硬门禁（ci-small 每跑、release-medium 发版前）；每条性能结论强制绑定 gitSha＋实例指纹；现场部署版本与发版台账对账看守；版本性能特性对照表（0.25.0／3a9f0711／1fb73f72 实测口径）入 runbook。**2026-11-23 起 MCP 问询全链路分位、样本、基线和 UAT 改由 REQ-030-099 独立承接，本条不再新建并行 MCP runner。**
- 文档：[Spec](../specs/lucy-20261120-user-journey-performance-gate-spec.md) · [Plan](lucy-20261120-user-journey-performance-gate-plan.md)。
- 状态：v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan 设计；终稿未确权；开发未授权；测试台未建；不入核心分母；≠ 功能收口；≠ 可上线。
- 授权边界：本轮只写设计与登记；不改 workflow／runner 运行代码、不建测试台、不执行任何性能跑次。后续须终稿确权并分别取得开发／执行授权。

## REQ-030-089：运维步骤账（Lucy 运维与 IT 运维）

- 清单：[P1-68](lucy-20261107-lucy-0-30-feature-inventory-pool.md)。读者是 Lucy 运维与 IT 运维。调用流水与阶段记录仍归治理与审计，本条不改它们。
- 来源：2026-11-13 至 2026-11-20 现场材料。就绪检查日志只能证明请求未完成；健康接口给出事件循环延迟但没有同步段名称；准备表结构的原因码只在容器日志里，和界面没有操作号。
- 范围：冻结操作在进入每个命名步骤时先写标准输出；进程还能服务时，管理台用同一操作号读取。记步骤失败不失败问数、探针或重载。
- 文档：[Spec](../specs/lucy-20261120-ops-step-journal-spec.md) · [Plan](lucy-20261120-ops-step-journal-plan.md) · [UAT-SUITE-OPS-STEP](../qa/uat/suites/ops-step/suite.md)。
- 状态：v1.0。终稿已确权（委托人2026-11-20明示“授权你修正，并定稿”）；开发授权已获得（委托人2026-11-20明示“授权你拆分多 agent 执行的任务，完成落地和 code review，暂不进行 docker 重建”）；实现已在工作树落地并完成独立代码评审；测试台 NOT RUN（未执行 Docker 重建、真实前台浏览器与 UAT，SC-01–SC-18 尚未取证）；不入核心分母；≠ 功能收口；≠ 可上线。
- 授权边界：本轮只写设计、评审、修订与定稿登记。不改运行代码，不执行 UAT。开发与执行仍须另行取得授权。

### 核心可用性既有REQ后续执行关联（2026-11-20）

既有REQ-030-081／082／083／084／085及REQ-030-068／034由[三问题后续工作包](lucy-20261120-core-availability-followup-plan.md)串联。该包承接已批准阶段提交和下一步计划，不改变上述功能现值；预算已修复项不重复立项。热重载新增语义若超出现行合同，实施前另行补REQ／Spec及SOT，不旁路编码。


### 核心可用性后续工作包本轮执行（2026-11-20）

委托人批准执行[CA-00–09任务单](lucy-20261120-core-availability-followup-plan.md)，解除历史延期。沿REQ-030-081／082／083／084／085与068／034复用既有合同；新增重载语义另行补行并确权，未完成项及历史FAIL保持。


### REQ-030-090：配置热重载主路径保护

v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 需求正文见[Spec](../specs/lucy-20261120-runtime-reload-drain-spec.md)；先入账、后合同确权及实施。正常短在途受保护，切换新请求有纯MCP同身份恢复；TERM与权限收紧优先。不改变P1-63整实例合同或原完整矩阵缺口。


### REQ-030-091：正常语义写入与并发合法查询

v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 委托人在本轮选择“批准补充合同并修复”，授权先行合同终审后的最小实现与本机Docker验证；不关闭恢复屏障、不放宽权限／预算、不自动重放SQL。孤儿／损坏／失败日志继续失败关闭。正文见[Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md)及[Plan](lucy-20261120-semantic-read-write-settle-plan.md)。原候选4 FAIL保留。


## REQ-030-092：SQLite 风险防范与 PostgreSQL 迁移准备

- 清单：[P1-71](lucy-20261107-lucy-0-30-feature-inventory-pool.md)。优先级 P1（Deferred；下一期）；不入核心分母。
- 来源：委托人 2026-11-20 确认继续 SQLite，关注风险防范及 PostgreSQL 迁移准备，随后明确“暂时不想升级”“对，只做准备”。**2026-11-22 明示：本 Spec 不开发，明确移入需求池，作为下一期开发的目标。**
- 范围：源码存储盘点、已有覆盖与风险差集、分批设计、容量和恢复决策项、未来 Docker 验收设计（均作下一期候选，不在 0.30 实施）。
- 文档：[Spec](../specs/lucy-20261120-storage-readiness-spec.md) · [Plan](lucy-20261120-storage-readiness-plan.md) · [盘点](../reviews/2026-11-20-storage-readiness-inventory.md) · [UAT](../qa/uat/suites/storage-readiness/suite.md)。
- 状态：v0.1-draft。0.30 不开发；准备材料保留在需求池作下一期开发目标。源码盘点、风险差集与 Spec／Plan／UAT 设计已落盘；终稿未确权；未获开发授权；不升级、不迁移、不操作客户实例；测试台 NOT RUN；不入核心分母；≠ 功能合同收口；≠ 可上线。
- 授权边界：仅文档及文档静态检查；**0.30 明确不开发**。不改代码、schema、依赖或配置；不采客户库、不连接客户实例，不运行备份、压测、迁移或 Docker 演练；不推送或发布。下一期开线后须另确权、另发开发授权。

## REQ-030-093：行权限自动强制执行

承接 P1-25 评估；委托人明确批准方案并要求落地。默认配置即可按行域查询，删除全局人工证明依赖，保留强制注入、旁路拒绝、真实路径验证。

状态：v1.0。终稿已确权；开发授权已获得；实现与 Codex CLI 代码终审完成；功能合同已收口（定向回归286项、脚本合同97项、隔离Docker39项）；测试台 UAT-SUITE-ROW-POLICY-AUTO PASS；扩展回归与全仓门禁既有缺口单列，远端CI未执行；不入核心分母；≠ 可上线。

[总账 P1-72](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Spec](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) · [Plan](lucy-20261120-row-policy-automatic-enforcement-plan.md) · [UAT](../qa/uat/suites/row-policy-automatic-enforcement/suite.md)。不改 P1-25 历史评估或 P1-28 既有 FAIL。

## REQ-030-096：MCP 握手与 Agent 名册读取长尾治理

- **来源**：2026-11-23 客户现场 Lucy `322438a2`。Agent 完整名册复现 3 次 `DISPLAY_SNAPSHOT_BUSY`。MCP 原故障窗口有 16 条 `initialize`，其中 5 条超过 30 秒。四条已取阶段的握手主要耗在 Lucy 的指引构建，目录与 Skill 为已量出的两个主要阶段。名册快照的具体失败原因及两者的共同根因待验证。
- **期望**：用同版本的 Docker 基线还原关键现场条件，定位主要等待阶段；降低握手和名册的请求内重读与冷态读取成本，同时保住权限新鲜性、撤权和合法纯 MCP 问数主路径。用浏览器、MCP 客户端及探针的同窗结果检验组合表现。
- **首轮范围**：全局档已复现备注保存同窗的名册 503 与 MCP 20 并发 P50 超线。修订覆盖正常及备注写中首响应成功、核验故障后的限时恢复、动态指引有界等待及纯 MCP 查数。G1／G2 的 SC-01–07 通过后封存候选，供 P1-77 做 A/B。现场归因和历史重档另留证据。
- **状态**：S2｜v1.1 合同修订已获批准，待开发授权。
- **挂接**：[总账 P1-75](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Spec](../specs/lucy-20261123-interactive-read-resilience-spec.md) · [复现 Plan](lucy-20261123-interactive-read-resilience-plan.md) · [UAT](../qa/uat/suites/interactive-read-resilience/suite.md)。

## REQ-030-095：问询预算主路径逃生（触顶后可达 fallback）

- **来源**：2026-11-22 委托人裁定——合法用户额度用尽后必须有 fallback；不得因 runaway 拦截误伤正常长问询。证据：Wave D PM 报告、错题本 `2026-11-22-question-budget-exhausted-recurring`；根合同 Spec 162／窗口 Spec／P1-60／P1-12。对抗审阅后退回；同日批准 1A–6A 定稿。
- **期望**：保留 60／300 与 settled busy；inactive 显式续查加档（默认 5）；硬停后 `lucy_continue_question` **`mode=new_question`** 同 Token 再开；D7 计费问数身份逃生可达；软信封（不强制 `isError=true`）；本仓 compat 成交链（D9）；budget≠deny 且 reason 分列；验收 SC-E1–E10。不回退 P1-60 begin 无副作用。
- **状态**：S4｜实现已落地（Lane A/B/C；实现 CR **APPROVE**，见 [reviews/2026-11-22-p174-budget-escape-implementation-cr](../reviews/2026-11-22-p174-budget-escape-implementation-cr.md)）；平滑升级后 UAT [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md)＝**PASS WITH GAPS**（R0／01–06／08／09A-B-C／10B／11／12 功能轴 PASS；**BESC-07／10A 环境 BLOCKED**，非产品 FAIL）；不入核心分母；≠ 完整 PASS；≠ 功能合同收口；≠ 可上线。
- **挂接**：[Spec](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md) · [Plan](lucy-20261122-question-budget-mainpath-escape-plan.md) · [UAT](../qa/uat/suites/budget-escape/suite.md) · 清单 **P1-74**

## REQ-030-094：Spec 开发台状态治理（漏斗＋状态词）

- 清单：[P1-73](lucy-20261107-lucy-0-30-feature-inventory-pool.md)。优先级 P1（文档治理）；不入核心分母。
- 来源：2026-11-22 状态自由长文不可机读；英文／中文两套状态词并行；委托人确认漏斗与状态词建议书互补一并审阅。
- 范围：双规则——`status-funnel`（阶段 S1–S5＋X_*）＋`status-vocab`（状态行英文禁用词；不报缺状态行）；DEVELOPMENT 唯一口径；Wave A＝vocab（进 PR CI）、Wave B＝funnel（grandfather＋必接 PR CI）。不含业务运行时；阶段全仓迁移另授权。
- 文档：[Spec](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) · [Plan](lucy-20261122-spec-status-funnel-gate-plan.md) · [状态词建议书](lucy-20261122-spec-status-vocabulary-chinese-plan.md) · `inbox/20261122-1123-spec-funnel.md` · [伞评审](../reviews/2026-11-22-p1-73-status-governance-umbrella-review.md)。
- 状态：**S5｜v1.0。功能合同已收口（2026-11-22）。SC-01–SC-15＋实现 CR PASS；全仓 MIG 另授权。本条收口不表示可上线。**
- 授权边界：开发授权已获得（2026-11-22）；落地范围限伞 Spec §8 白名单；阶段全仓迁移（MIG）另授权。

## REQ-030-100：长追问题组（性能专用，≥20 轮单进程长链）
- **期望**：提供独立题组包（独立文件、独立 `packDigest`），语义继承 P1-54：每链首轮之后 ≥20 次语义承接的追问、每轮独立可机检 oracle、单进程同会话可校验；P1-78 的 `LONG_FOLLOW` 按 `questionRef` 与 digest 只读消费。
- **范围**：题组内容、结构、版本与校验口径。性能预算、样本与判定归 P1-78；产品运行时与 P1-53 四入口证据不在本条。
- **挂接**：[总账 P1-79](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Spec](../specs/lucy-20261123-long-followup-question-pack-spec.md) · [Plan](lucy-20261123-long-followup-question-pack-plan.md) · [消费方 UAT](../qa/uat/suites/mcp-inquiry-performance/suite.md)。
## REQ-030-099：MCP 问询端到端性能基准与持续门禁

- **来源**：2026-11-23 委托人明确 MCP 问询体验是用户对 Lucy 最大的体感，要求建立完整、可信、持续运行的「用户提问 → 收到答复」性能基准与优化闭环，并授权按仓库规范新建独立 Spec／Plan／UAT 设计。
- **期望**：用真实 Agent、Public MCP、Lucy 和真实数据库持续测量自然提问到正确完整答复的墙钟；同时以确定性 MCP 对照分解握手、目录、权限、查询和续查阶段。按场景保留全部尝试、真实分位和可比指纹，形成绝对预算、相对回退、负控、每日／发版／升级门禁及公开报告。
- **边界**：本条只拥有测试方法、执行器、基线、预算、判定器、UAT、持续调度和证据，不修改缓存、ACL、指引、查询策略、超时或数据库访问等产品行为。性能 FAIL 转交独立优化 Spec；优化提交不得同批改测试口径或提高预算。
- **边界**：本条只拥有测试方法、执行器、基线、预算、判定器、UAT、持续调度和证据，不修改缓存、ACL、指引、查询策略、超时或数据库访问等产品行为。**自然问题语义归 P1-54，≥20 轮长链归 P1-79，初始化数据与规模下限归全局规模基线（含 §1.1 MCP-PERF profile）与 P1-34；本条不自制题目、造数脚本或第二套规模数字，依赖缺失记 BLOCKED。**性能 FAIL 转交独立优化 Spec；优化提交不得同批改测试口径或提高预算。
- **关系**：P1-67 的 MCP 部分由本条承接；P1-53 保留功能兼容职责并在后续消费统一性能结果；P1-13 保留低层热路径微基准；P1-37／75／77 等优化条目使用本条作改前／改后对照。定位 P0 核心体验／发布底线，独立出包／升级门禁，不改变 0.30 既有核心分母。
- **状态**：S1｜v0.1-draft。委托人2026-11-23授权新建独立性能测试 Spec／Plan／UAT 设计；终稿未确权；开发未授权；仅设计，不执行性能跑次；不改产品优化代码；≠ 发布取证收口；≠ 可上线。
- **挂接**：[总账 P1-78](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Spec](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [Plan](lucy-20261123-mcp-inquiry-performance-baseline-plan.md) · [UAT](../qa/uat/suites/mcp-inquiry-performance/suite.md)。

## REQ-030-098：数据问答默认主动采用业务上下文

- **来源**：2026-11-23 用户反馈「Lucy 的调用默认取了语义，不取 skill 或 wiki，除非提示词要求」。KSCC 自然问句复现，同题显式提示后正确，Kimi 跑次为诊断对照。注入规则、宿主与工具接入分别留待归因。
- **期望**：已治理口径直接查数，必要口径缺失时按需查 Wiki，规程依赖按需读 Skill；同题同依赖限次，读取失败或冲突时交付已验证的子结论。完整与基础指引同源。以通过 G1／G2 的 P1-75 候选为 A，整题速度与追加上下文负载下的原可用性按 SC-01–08 验收。
- **状态**：S2｜v1.1 合同修订已获批准，待开发授权。
- **挂接**：[总账 P1-77](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Spec](../specs/lucy-20261123-default-business-context-adoption-spec.md) · [实施 Plan](lucy-20261123-default-business-context-adoption-plan.md) · [测试台](../qa/uat/INDEX.md#默认使用业务上下文)。

## REQ-030-097：YAML 产物禁 alias 治理

- **来源**：2026-11-23 另一 Agent 合成 catalog manifest 复用列定义对象引用，`yaml.stringify` 序列化为大量 anchor／alias；KTX 以 `yaml` 解析器默认 `maxAliasCount: 100` 读取，报 `Excessive alias count indicates a resource exhaustion attack` 拒读。本仓容器内已复现实证。
- **期望**：写入侧统一防别名出口替换全部 `stringify` 写盘点；静态门禁拦截新增违规；规范明确「YAML 产物禁 anchor／alias、复用须 inline」。不改 KTX 上游、不放宽读取侧。验收 SC-01–SC-05。
- **状态**：S4｜v0.1。终稿已确权（委托人 2026-11-23 明示）；开发授权已获得；实现已落地（统一写出口＋15 处调用点替换＋静态门禁）；SC-01–SC-04 已验证、SC-05 随本次登记闭环；待委托人验收，未做功能合同收口。
- **挂接**：[总账 P1-76](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Spec](../specs/lucy-20261123-yaml-alias-free-artifacts-spec.md) · [Plan](lucy-20261123-yaml-alias-free-artifacts-plan.md)。
