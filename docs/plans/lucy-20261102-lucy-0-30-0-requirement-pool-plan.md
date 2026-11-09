# Lucy 0.30.0 需求池

| 元数据 | 内容 |
|---|---|
| 文档类型 | 候选需求池。**不是**功能 Spec，**不授权**实现 |
| 版本 / 日期 | v0.28 / 2026-11-09 |
| 状态 | **已开线**。**原 P0 Spec／Plan 草案全集已齐**（P0-1…P0-7＋P0-A）；**冻结落地**（未授权条目）。**REQ-030-032／P1-11**：**v0.5；R2-F＋R3（O1＝A／O2＝B）＋R4 已闭合；实现中（Cursor）**。跟进主表见 [功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md)。本条不表示可上线 |
| 授权边界 | **只登记、不实现**。条目进入实施前须：需求澄清 → 独立 Spec → Plan → 开发授权；本池自身不构成其中任一步。**P0 立项 ≠ 开发授权**；**入池 ≠ 立项** |
| 验收 | 本池自身的验收＝条目结构完整（ID／标题／来源／优先级／状态齐备）＋ 来源可追。**不构成任何功能验收** |
| 目标版本 | 产品线 **`0.30.0`**（已开线；池内条目仍须 Spec→Plan→授权后才实现） |
| 核心方向 | [Lucy 0.30 升级核心方向](lucy-20261107-lucy-0-30-core-direction.md)（v0.2）：辅线＝现有 UX；**主线＝存量用户每日可信交互** |
| 功能清单池 | [lucy-20261107-lucy-0-30-feature-inventory-pool](lucy-20261107-lucy-0-30-feature-inventory-pool.md)——**本分支 agent 跟进主表**（P0 立项、P0–P2 全表、遵从规则） |
| 维护规则 | 只追加条目；开工前须另立 Spec／Plan 并获授权。不得把本文件当作默认可实施依据。优先级／立项状态与功能清单池对齐 |
| 变更 | v0.31（2026-11-09）：REQ-030-018／022 镜像对齐 Spec 现值——**R2-F＋R4、实现已落地、复审 Approve with nits**（未宣称可上线）。v0.30（2026-11-09）：REQ-030-032 **R4 开发授权**；实现中（Cursor）。v0.29（2026-11-09）：REQ-030-032 **R2-F＋O2＝B** 闭合（Spec／Plan v0.5）。v0.28（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.8-draft**（P0-5 共存修订）；**不表示可上线**。v0.27（2026-11-09）：**委托人正式立项**——REQ-030-032（概念注册表接入 Lucy Ops 控制面／清单 P1-11）。运维＝配置治理主线；交付序修订为效果门后 **Ops MCP 优先**（路径 A）；Spec／Plan v0.1-draft；**未授权实现**；**不挡**原 P0。v0.26（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.7-draft**（Codex R3 BLOCK 残留闭合：R2-02 `upstreamHttpStatus` 必传／收口 SC-30／**D3＝A 已确认**；**不构成 R2-F／R4**；冻结落地；未授权实现）。v0.25（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.6-draft**（Codex R2 BLOCK 闭合 R2-01／02／03，**D3 仍待委托人书面确认**；**R2-F 前必须确认 D3**；冻结落地；未授权实现）。v0.24（2026-11-09）：REQ-030-018 Spec／Plan 升 **v0.5-draft**（Codex R1 BLOCK 闭合 F01…F12，**D3 仍待委托人书面确认**；**R2-F 前必须确认 D3**；冻结落地；未授权实现）。v0.23（2026-11-09）：REQ-030-031 **配套 Plan 已开**（[concept-registry-ontology-lite-plan](lucy-20261108-concept-registry-ontology-lite-plan.md) v0.1-draft）；Spec 升 v0.3-draft；仍待评审／终稿确权；**未授权实现**。v0.22（2026-11-08）：**委托人确认入池**——REQ-030-031（轻量概念注册表 ontology-lite／清单 P1-10）。头脑风暴 Spec 草案已有；Plan 未开；交付序 CLI→效果门→WebUI→MCP；**不挡**原 P0；**未授权实现**。v0.21（2026-11-08）：**委托人选定 3 条入池**——REQ-030-028（物理新鲜度合同／清单 P0-B）、REQ-030-029（语义发布→Eval 门禁／清单 P1-8）、REQ-030-030（质量域 safe-log→Eval／清单 P1-9）。只登记缺口与期望方向；**未立项、未开新 Spec（030 挂接既有质量域 Spec）、未授权实现**。v0.20（2026-11-08）：REQ-030-027 **R4 开发授权**（Claude Code 实现）。v0.19（2026-11-07）：**REQ-030-027 O1／O2（R3）闭合**——委托人明示选项「1」＝全采纳闭合包；Spec／Plan 升 v0.8；仍待 R4；未授权实现。v0.18（2026-11-07）：**0.30 状态镜像统一 ＋ 文档版本升 v0.2-draft**——35 份 `0.30` 文档状态值统一为 `v0.2-draft，待严格评审／验收；冻结落地；未授权实现`（REQ-030-018 为 `v0.4，…`，版本号不随本轮变动）；同步落点＝Spec 头部、Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9、本池 REQ 条目；统一追加阶段子句「已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审」。**代码改动未授权。** v0.17（2026-11-07）：**第 1 轮评审（形式合规 ＋ 事实性）完成**——全部 35 份 `0.30` 文档经 Claude Code 只读分块评审（13 块），累计 findings **115 条**，逐条独立复核源码后 triage：**已修 110 条**（含 8 条「照此实现会踩坑」级：字段级门禁插入点错误、`NON_WAIVABLE_CHECKS` 无前缀族机制、PUT 默认 `dryRun=true`、失败关闭打挂整域列表 GET、runner 回落规则与字段合同相反、发布分类判定点指错、reindex 调用点漏枚举、ADR 定位漂移）；**5 条归他人未跟踪文件不代改**（清单池文件名 ＋ 缺 4 类 Plan 小节 ＋ 头部验收行 ＋ §2.2 已被取代标记）；c13 首跑撞 429，重跑中。第 2 轮对抗式评审待做。评审记录见 [0.30 批次第 1 轮评审记录](2026-11-07-lucy-0-30-spec-plan-review-round1.md)。**全部条目仍未授权实现。** v0.16（2026-11-07）：P0 全量 Spec／Plan 草案齐（022–027 等）。v0.15（2026-11-07）：**Batch S2 开 Spec/Plan（待评审、未授权实现）**——REQ-030-023 开 [Catalog 业务语义暴露](../specs/lucy-20261107-catalog-business-semantics-spec.md) Spec／Plan（装配语义层既有表级描述进目录响应；描述缺失显式标注、体积硬上限截断不丢条目、不可见 source 描述不泄漏；与 012 列级裁剪不冲突，本条不返回列）。v0.14（2026-11-07）：分批 Spec 批准；REQ-030-027 开 [question-type-caliber-binding](../specs/lucy-20261107-question-type-caliber-binding-spec.md) Spec／Plan。v0.13（2026-11-07）：**P0 立项批准**；挂接功能清单池；索引表优先级改为 P0／P1／P2。v0.12（2026-11-07）：**Batch 2–4 开 Spec/Plan（待评审、未授权实现）**——REQ-030-012 开 [语义层 Source 级业务暴露裁剪](../specs/lucy-20261107-semantic-source-field-exposure-spec.md)（双面裁剪禁半通）；REQ-030-001 开 [发布工作台分文件勾选发布](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md)（**显式修订 21 条既有约定，须 PM 批准**）；REQ-030-015 开 [语义层孤儿路径治理](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md)；REQ-030-019／020／021 开 [Eval 路径断言编排](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)／[审计旅程→Eval 草稿](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)／[批量工具反哺通道](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md)；REQ-030-008／009／010／011／014 排期进 [0.30 遗留验收执行 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md)；REQ-030-002／004 既有 Spec 开线对齐。**取证纠错两处**：runner 侧断言实为 **8 型**（分支计划「7 型」口径有误）；`review_status` **挡不住** CLI runner，「不自动进跑批」须靠路径隔离＋人工确认。v0.11（2026-11-07）：**按 2026-11-07 事故沟通实录（客户：翊总 / 田总）追加 REQ-030-027**（口径固化：问题类型 → 唯一表 + 固定口径绑定），并把沟通实录确立的事实回填至 REQ-030-022–026：**① 事故定性已定**——错表为 GPU 计提成本表（客户有权访问）⇒ **语义误报，ACL 越权排除**；② **事故有两条独立故障轴**（选错表 ＋ 口径被 AI 自行加工）；③ **止血已落地**（改语义文件、客户真实账号复测通过）；④ **已对客户承诺「每天跑测评、每天迭代」「发现问题当天修正」**——目前全靠人力，0.30 的 Eval 与运维投入即该承诺的系统化载体。v0.10（2026-11-07）：**按 2026-11-06 CFO 选表误报事故 +「0.30 重点提升 Eval 与平台运维、已有 100 用户、C-level 体感最关键」产品对话追加 REQ-030-022–026**（答复可核对性 / 选表语义暴露 / 多表命中先问 / 表级歧义门闩 / Eval 选表正确性与真实问句回灌 / 存量用户体感仪表盘与主动告警），只登记缺口，不授权实现；差距对拍、根因清单与现场取证最小清单见 [分支计划](lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)。v0.9（2026-11-07）：**Batch 1 开 Spec/Plan（待评审、未授权实现）**——REQ-030-013＋016 合并为 [行权限编译门禁与各面拒绝码统一 Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md)（两组 SC：SC-01–06 对 013、SC-07–10 对 016）；REQ-030-017 开 [explain 本地诊断形状合同 Spec](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md)（SC-01–08）。取证结论：BY-19 实锤**缺的是字段级门禁**（只有形状门禁，`filters[].field` 未做字段判定），BY-06/17 实锤**工具级判定先于行策略判定**导致同语义两码；REQ-030-017 的真根因不是「少个 `summary`」，而是 ADR §2.1 的 E1–E5 编号在 ADR／实现／e2e harness 三处互斥，且 harness 断言了 ADR 未定义字段。v0.8（2026-11-07）：按 The New Stack《Why MCP servers should tell agents what to do next》（Matthew Burns 记 AWS James Ward，2026-11-07）追加 REQ-030-018–021（空结果下一步指导 / 路径断言编排面 / 审计旅程→Eval 用例草稿 / 批量工具反哺通道），只登记缺口，不授权实现；差距对拍与顺序见 [分支计划](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md)。v0.7（2026-11-07）：产品线 `lucy-v0.30` 已开线，状态改为已开线；仍不授权实现。v0.6（2026-11-05）：复核实跑归因——REQ-030-013 五合一拆分为编译门禁单条（BY-19），新增 REQ-030-016（各面拒绝码统一）/017（explain E5 形状）；BY-05 改判口径争议（Spec 99 §6 strip-then-inject 合规、harness 更严）移出池归 debug，确认收紧后再入池。v0.5（2026-11-05）：按 row-policy 强度 B 实跑归因（`inbox/row-policy-b-run-notes.md`）追加 REQ-030-013–015，只登记缺陷/能力缺口，不授权实现。v0.4（2026-11-05）：追加 REQ-030-012（语义层宽表字段暴露裁剪；澄清结论已写入条目，仍不授权实现）。v0.3（2026-11-03）：按 [D 剥离记录](../reviews/2026-11-03-product-close-peel-d.md) 追加 REQ-030-008–011。v0.2：按 [A／B](../reviews/2026-11-03-product-close-peel-a-b.md) 追加 REQ-030-002–007 |

## 目标

- 统一登记 `0.30.0` 候选版本的需求，避免散落在 UAT 反馈、对话与临时笔记里。
- 每条需求保留可追的来源（UAT 反馈页、Spec 编号、外部诉求），供开线时做优先级裁决。
- 让「本版不做」有正式落点：本池条目默认不进当前产品线，避免被误读为已承诺交付。

## 与现行版本的关系

- 当前产品线 / `VERSION` 是 **`0.30.0`**（分支 `lucy-v0.30`；见 `docs/governance/version-matrix.md`、`docs/runbooks/lucy-release-train-workflow.md` §2.2）。`lucy-v0.25` / `v0.25.0` 只接 hotfix。
- 本文件是 **`0.30.0` 需求池**。开线≠授权：池内条目默认 Deferred，**不得**因已开线而直接改代码。
- 条目被正式纳入实施前，须：需求澄清 → 独立 Spec → Plan → 开发授权。本池本身不构成其中任一步。

## 条目索引

| ID | 标题 | 来源 | 优先级 | 状态 |
|---|---|---|---|---|
| REQ-030-001 | 发布工作台：分文件勾选发布 | 2026-11-02 `/publish/workbench` UAT 反馈 | **P2**（清单 P2-1） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-publish-workbench-per-file-selection](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md) |
| REQ-030-002 | 帮助中心体验（L25-12） | Spec `lucy-20261031-help-center-experience` | **P2**（清单 P2-2） | Deferred — 不进 `0.25.0` |
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
| REQ-030-018 | 空结果（0 行）响应的结构化下一步指导 | 2026-11-07 The New Stack《Why MCP servers should tell agents what to do next》 | **P0**（清单 P0-5） | **v0.8-draft；R2-F＋R4 已闭合（2026-11-09）**。实现已落地；复审 **Approve with nits**。未宣称可上线。Spec 见 [lucy-20261107-empty-result-next-step-guidance](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) |
| REQ-030-019 | Eval 路径断言在 WebUI 侧可编排 | 同上 | **P0 最小面／P1 完整面**（清单 P0-6／P1-4） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-eval-tool-assertion-authoring](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) |
| REQ-030-020 | 审计问询旅程 → Eval 用例草稿导出 | 同上 | **P0 最小面／P1 完整面**（清单 P0-6／P1-5） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-audit-journey-eval-case-draft](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) |
| REQ-030-021 | 循环单查 → 批量/聚合工具反哺通道 | 同上 | **P1**（清单 P1-6） | **已开 Spec/Plan（v0.2-draft，2026-11-07）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。Spec 见 [lucy-20261107-eval-failure-to-tool-surface-feedback](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md) |
| REQ-030-022 | 答复可核对性（CFO 当场可核验来源/口径/数据截止期） | 2026-11-06 CFO 选表误报事故 | **P0**（清单 P0-4） | **v0.4-draft；R2-F＋R3＋R4 已闭合（2026-11-09）**。实现已落地；复审 **Approve with nits**。O1＝A／O2＝A。未宣称 SC 全关／可上线。见 [answer-verifiability](../specs/lucy-20261107-answer-verifiability-spec.md) |
| REQ-030-023 | 选表语义暴露（catalog 携带表描述） | 同上 | **P0**（清单 P0-2） | **已开 Spec/Plan（v0.2-draft）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。见 [catalog-business-semantics](../specs/lucy-20261107-catalog-business-semantics-spec.md) |
| REQ-030-024 | 多表命中先问 + 表级歧义门闩 | 同上 | **P0**（清单 P0-3） | **已开 Spec/Plan（v0.2-draft）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。见 [source-ambiguity-gate](../specs/lucy-20261107-source-ambiguity-gate-spec.md) |
| REQ-030-025 | Eval 选表正确性断言与真实问句回灌 | 同上 | **P0**（清单 P0-6） | **已开 Spec/Plan（v0.2-draft）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。见 [eval-source-selection-correctness](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) |
| REQ-030-026 | 存量用户体感仪表盘与主动告警 | 2026-11-07 产品对话（100 用户 / C-level 体感） | **P0**（清单 P0-7） | **已开 Spec/Plan（v0.2-draft）**；已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审；冻结落地；**未授权实现**。见 [stored-user-experience-dashboard-alerts](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) |
| REQ-030-027 | 口径固化（问题类型 → 唯一表 + 固定口径绑定） | 2026-11-06 事故（口径被 AI 自行加工）＋ 2026-11-07 沟通实录 | **P0**（清单 P0-1） | **Spec／Plan v0.9；R4 已授予（2026-11-08）；实现中**；不表示可上线。见 [question-type-caliber-binding](../specs/lucy-20261107-question-type-caliber-binding-spec.md) |
| REQ-030-028 | 物理新鲜度合同（答复截止期真源） | 2026-11-08 能力盘点（模型／语义／Eval）＋ 强化 P0-4 | **P0 伴生**（清单 P0-B） | **2026-11-08 入池**；待需求澄清与立项开 Spec；冻结落地；**未授权实现** |
| REQ-030-029 | 语义发布 → Eval 门禁 | 2026-11-08 能力盘点；前身见 2026-08-26 变更触发回归 | **P1**（清单 P1-8） | **2026-11-08 入池**；待需求澄清与立项开 Spec；依赖 P0-6 骨架；**不挡**原 P0；**未授权实现** |
| REQ-030-030 | 质量域 safe-log → Eval 候选回流 | 2026-11-08 能力盘点；既有 2026-10-14 质量域 Spec 未落地 | **P1**（清单 P1-9） | **2026-11-08 入池**；挂接既有 [safe-log-to-quality-eval Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md)（功能合同未收口）；待澄清与 0.30 跟进对齐；**未授权实现** |
| REQ-030-031 | 轻量概念注册表（ontology-lite；CLI 先） | 2026-11-08 头脑风暴（指标权威面 × KG／本体） | **P1**（清单 P1-10） | **v0.6；R2-F＋R4 已闭合（2026-11-09）；一期 CLI 已落地；待效果门**；**不挡**原 P0。跟进交付通道见 **REQ-030-032**。Spec／Plan／[评审](../reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md) |
| REQ-030-032 | 概念注册表接入 Lucy Ops 控制面 | 2026-11-09 委托人：运维＝配置治理；CLI 不适合长期交付；正式立项并进 Ops；本版 Ops 检查完毕后下版再评估 WebUI | **P1**（清单 P1-11） | **v0.5；功能合同层已收口（SC-01–SC-22）；本条不表示可上线**；**不挡**原 P0。Spec／Plan 见下 |

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

L25-12 帮助中心 Spec／Plan 已落盘为 v0.1-draft；2026-11-02 起本版不实施、不评审、不开工。2026-11-03 产品收关将本条正式迁入 `0.30.0` 池。

### 期望方向

门户 → 分类 → 文章三层 IA；独立「快速入门」；复制／导出 Markdown；浏览器打印。细节以既有 Spec 为准，开线前须再澄清。

### 关联

- Spec：`docs/specs/lucy-20261031-help-center-experience-spec.md`
- Plan：`docs/plans/lucy-20261031-help-center-experience-plan.md`
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
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

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
- 本版（`0.30.0`）不实现；**已开独立 Spec 与 Plan**（v0.2-draft，待严格评审／验收；冻结落地；未授权实现）。

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
- **不自动继承 2026-11-07 P0 立项**；入池后须另澄清 → Spec → 授权。
- **未授权实现代码**。

### 关联

- 清单：P0-B（[`lucy-20261107-lucy-0-30-feature-inventory-pool.md`](lucy-20261107-lucy-0-30-feature-inventory-pool.md)）
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

## REQ-030-031：轻量概念注册表（ontology-lite；CLI 先）

### 背景

来源：2026-11-08 产品头脑风暴——讨论「是否要做指标平台／知识图谱／本体论」以提升语义质量、问答准备率与 MCP 效果。对齐结论：

- 最贵失败仍是 **选错表** 与 **口径被临场加工**（与 P0-1／P0-2／P0-3 主线一致）。
- 完整 KG／OWL／独立指标计算平台 **现期不值得**作为建设目标。
- 缺口是：从已有 semantic-layer／Wiki **自动盘点**「收入／资产等概念有几套定义」，并给人 **定权威解释**；一期消费者是人，Agent／MCP 更后。
- 交付序裁定：**先 CLI 跑通并验证效果 → 效果可接受后再上 WebUI 人审页 → 再考虑 MCP 注入**。

⇒ 本条登记为约束深化／内容治理辅线，为人审权威面与冲突发现服务；**不替代**运行时约束闸。

### 期望方向（池内草案；不授权实现）

- 持久化轻量 Concept／Binding 注册表（建议内容根 `concepts/`）；Conflict 可派生。
- CLI：scan／list／show／set-canonical／reject／summary；扫描只提议 `candidate`，人裁定 canonical。
- 试点至少覆盖「收入」「资产」。
- **一期 WebUI 零变更**；效果门通过后另开／升版做人审页。
- 可手工反哺 Wiki／overlay／P0-1 绑定候选；一期不自动改 MCP 热路径。

### 非目标（本条目当前）

- 形式化知识图谱、OWL 推理、独立指标平台／统一计算引擎。
- 一期 WebUI／MCP 注入；机器自动裁定权威。
- 替换 P0-1／P0-2／P0-3。
- **未授权实现代码**；**不挡**原 P0 收口。

### 关联

- 清单：P1-10
- Spec：[`docs/specs/lucy-20261108-concept-registry-ontology-lite-spec.md`](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md)（v0.6）
- Plan：[`docs/plans/lucy-20261108-concept-registry-ontology-lite-plan.md`](lucy-20261108-concept-registry-ontology-lite-plan.md)（v0.4）
- 相关条目：REQ-030-027（口径绑定）、REQ-030-023（catalog 语义）、REQ-030-024（歧义门闩）、**REQ-030-032**（Ops 控制面跟进）

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
