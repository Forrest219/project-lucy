# Lucy 0.30 功能清单池

| 元数据 | 内容 |
|---|---|
| 文档类型 | **0.30 完整功能清单与跟进池**。不是功能 Spec；**单条仍不构成开发授权** |
| 版本 / 日期 | v0.10 / 2026-11-08 |
| 状态 | **生效跟进**。产品线 `lucy-v0.30` / `0.30.0`。**P0 立项已批准**（原 P0-1…P0-7＋P0-A）。**P0-1／P0-2／P0-A／P0-3 已获 R2-F＋R4（按条）**；其余原 P0／P1／P2 仍冻结。**2026-11-08 追加 P0-B／P1-8／P1-9；同日再追加 P1-10（概念注册表，仅入池；Spec 草案已有、Plan 未开；未授权实现）**。**终稿确权**＝Codex CLI 终审，或委托人明示确权（§2.2）。未授权条目禁止改运行代码 |
| 受众 | 本仓库所有在 `lucy-v0.30` / `0.30` 上工作的人与 agent |
| 授权边界 | **立项 ≠ 改代码**；**写 Spec ≠ 可实现**；**过程对抗 ≠ 终稿确权**；**终稿确权 ≠ 开发授权**；**入池 ≠ 立项**。改代码须：终稿确权 → 委托人 **另发开发授权**。本池不代替 Spec／Plan |
| 事实源分工 | **方向** → [核心方向](lucy-20261107-lucy-0-30-core-direction.md)；**缺口正文与来源** → [需求池](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；**本文件** → 优先级、立项状态、跟进序、agent 遵从规则 |
| 维护规则 | 只追加或改状态／优先级；不得静默删条目。状态变更须写「变更」行。与需求池 REQ ID 双向可追 |

## 变更

| 版本 | 日期 | 内容 |
|---|---|---|
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

1. **先读本池 + [核心方向](lucy-20261107-lucy-0-30-core-direction.md)**，再动 Spec／代码／排期。
2. **主线优先于辅线**：与 P0 抢带宽时，辅线（P2）与非阻塞 P1 让路。
3. **不得把立项／写 Spec／过程对抗当成终稿或开发授权**：无该条 **终稿确权（§2.2）+ 明确开发授权** 前，禁止改运行代码、禁止「顺手落地」、禁止写实现 PR。
4. **现行阶段只做规格**：允许写／改／过程评审 Spec 与 Plan；**暂时一律不开工落地**（§2.2），直至委托人按条授权。
5. **新想法先入池**：不得在对话里开旁路功能却不登记；先追加本池条目（并回写需求池 REQ），再开 Spec。
6. **状态只改本池镜像列 + 需求池／Spec 头部**：收口、授权、Deferred 以 Spec 头部为功能事实源；本池「跟进状态」须同句对齐，禁止两套现值。过程评审深度与终稿确权分列，禁止混成一句「评审通过」。
7. **P0 七项 + P0-A 未齐前**，不得宣称「0.30 核心升级完成」（判据见核心方向 §9）。**P0-B／P1-8／P1-9／P1-10 为 2026-11-08 追加入池项**：主线四闸收口时若缺 P0-B，须在发布说明显式登记；P1-8／P1-9／P1-10 **不挡**原 P0 收口，但不得旁路开做。

---

## 2. P0 立项批准

| 项 | 内容 |
|---|---|
| 批准日 | 2026-11-07 |
| 批准范围 | 下表 **P0-1…P0-7** 与伴生 **P0-A**；授权进入「澄清 → Spec → Plan」流水线 |
| 追加入池（未立项） | **P0-B**（028）、**P1-8**（029）、**P1-9**（030）、**P1-10**（031）——2026-11-08 入池；**不**自动进入上列立项包；须另澄清／立项后才开实现（P1-10 已有 Spec 草案，仍须 Plan＋终稿确权＋开发授权） |
| 明确未授权 | 实现代码、客户出包、上线、把辅线抬成主线；**入池条目不得顺手实现** |
| 建议实施序 | P0-1 → P0-2∥P0-A → P0-3 → P0-4∥P0-5 → P0-6（含 019／020 最小面）→ P0-7 |
| 已有先行 Spec | P0-5＝REQ-030-018（Spec／Plan 已立，待评审）；P0-A＝REQ-030-012（Spec／Plan 已立，待评审）；P0-6 的 019／020 已有 Spec／Plan（最小面纳入 P0，完整体验见 P1） |
| Spec 设计批准 | **2026-11-07** 批准按 §2.1 **分批建立 Spec／Plan**（详细规格设计）。仍 **≠ 开发授权** |
| 落地冻结 | **2026-11-07**：委托人裁定 **暂时都不开工落地**；本阶段带宽只用于 Spec／Plan 的严格验收与评审（§2.2） |

### 2.1 Spec 分批计划（agent 必须按批；本阶段禁止实现）

| 批次 | 清单项 | 动作 | 状态 |
|---|---|---|---|
| **S1** | P0-1（027） | Spec＋Plan | **v0.9；R2-F＋R3＋R4 已闭合；实现中（Claude Code）** |
| **S2** | P0-2（023）∥ P0-A（012） | Spec＋Plan | **R2-F＋R4 已闭合（2026-11-08）；实现中（Cursor）** |
| **S3** | P0-3（024） | Spec＋Plan | **R2-F＋R4 已闭合（2026-11-08）；实现中（Cursor）** |
| **S4** | P0-4（022）∥ P0-5（018） | Spec＋Plan | 草案齐；批次 R1 已修订；018 过程对抗已记；**终稿未确权**；冻结落地 |
| **S5** | P0-6（025＋019／020 最小面） | Spec＋Plan | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地 |
| **S6** | P0-7（026） | Spec＋Plan | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地 |

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

## 3. 完整清单总表

图例：**跟进状态**＝本池跟进用（过程深度可分叉；**终稿确权**统一见 §2.2）；功能合同收口仍以各 Spec 为准。

| 清单 ID | 优先级 | 标题 | REQ | 闸 / 轨 | 跟进状态 | Spec／Plan |
|---|---|---|---|---|---|---|
| **P0-1** | P0 | 问题类型 → 唯一表 + 固定口径绑定 | REQ-030-027 | 约束 | **v0.9；R4 已授予（2026-11-08）；实现中（Claude Code／Cursor review）**；不表示可上线 | [Spec](../specs/lucy-20261107-question-type-caliber-binding-spec.md) · [Plan](lucy-20261107-question-type-caliber-binding-plan.md) · [评审](../reviews/2026-11-07-question-type-caliber-binding-codex-review.md) |
| **P0-2** | P0 | Catalog 业务语义暴露 | REQ-030-023 | 约束 | **v0.6；R2-F＋R3（O1–O3）＋R4 已闭合（2026-11-08）；实现中（Cursor）**；不表示可上线 | [Spec](../specs/lucy-20261107-catalog-business-semantics-spec.md) · [Plan](lucy-20261107-catalog-business-semantics-plan.md) · [评审](../reviews/2026-11-08-catalog-business-semantics-codex-review.md) |
| **P0-3** | P0 | 多表命中先问 + 表级歧义门闩 | REQ-030-024 | 约束 | **v0.5；R2-F＋R3（O1／O2／O4）＋R4 已闭合（2026-11-08）；实现中（Cursor）**；不表示可上线 | [Spec](../specs/lucy-20261107-source-ambiguity-gate-spec.md) · [Plan](lucy-20261107-source-ambiguity-gate-plan.md) · [评审](../reviews/2026-11-08-source-ambiguity-gate-codex-review.md) |
| **P0-4** | P0 | 答复可核对块（来源／口径／截止期强制露出） | REQ-030-022 | 呈现 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；未授权实现 | [Spec](../specs/lucy-20261107-answer-verifiability-spec.md) · [Plan](lucy-20261107-answer-verifiability-plan.md) |
| **P0-5** | P0 | 空结果结构化下一步指导 | REQ-030-018 | 呈现 | v0.4；过程对抗已记；**终稿未确权**（待 Codex 或委托人）；D3 待确认；冻结落地；未授权实现 | [Spec](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) · [Plan](lucy-20261107-empty-result-next-step-guidance-plan.md) |
| **P0-6** | P0 | Eval 选表正确性 + 真实问句日跑骨架（含 019／020 **最小面**） | REQ-030-025；最小面挂 019／020 | 检出 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；未授权实现 | [Spec](../specs/lucy-20261107-eval-source-selection-correctness-spec.md) · [Plan](lucy-20261107-eval-source-selection-correctness-plan.md)；另 [019 Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)／[019 Plan](lucy-20261107-eval-tool-assertion-authoring-plan.md)／[020 Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)／[020 Plan](lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| **P0-7** | P0 | 存量用户体感最小仪表盘 + 主动告警 | REQ-030-026 | 运营 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；未授权实现 | [Spec](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) · [Plan](lucy-20261107-stored-user-experience-dashboard-alerts-plan.md) |
| **P0-A** | P0 伴生 | Source 级业务字段暴露裁剪 | REQ-030-012 | 约束伴生 | **v0.7；R2-F＋R4 已闭合（2026-11-08）；实现中（Cursor）**；不表示可上线 | [Spec](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) · [Plan](lucy-20261107-semantic-source-field-exposure-plan.md) · [评审](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md) |
| **P0-B** | P0 伴生 | 物理新鲜度合同（答复截止期真源） | REQ-030-028 | 呈现伴生 | **2026-11-08 入池**；待需求澄清与立项开 Spec；**未授权实现**；不挡原 P0 开 Spec，但 P0-4 若无真源须登记缺口 | 未开（强化 [P0-4／022](../specs/lucy-20261107-answer-verifiability-spec.md)） |
| P1-1 | P1 | 语义层孤儿路径治理 | REQ-030-015 | 约束深化 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；**不挡 P0** | [Spec](../specs/lucy-20261107-semantic-orphan-path-governance-spec.md) · [Plan](lucy-20261107-semantic-orphan-path-governance-plan.md) |
| P1-2 | P1 | 行权限编译门禁 + 各面拒绝码统一 | REQ-030-013／016 | 正确性辅线 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地；可与 P0 并行 | [Spec](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) · [Plan](lucy-20261107-row-policy-compile-gate-deny-code-plan.md) |
| P1-3 | P1 | `lucy_explain_query` 诊断形状合同 | REQ-030-017 | 正确性辅线 | 草案齐；批次 R1 已修订；**终稿未确权**；冻结落地 | [Spec](../specs/lucy-20261107-explain-diagnostic-shape-contract-spec.md) · [Plan](lucy-20261107-explain-diagnostic-shape-contract-plan.md) |
| P1-4 | P1 | Eval 路径断言编排（完整 WebUI 面） | REQ-030-019 | 检出完整面 | 草案齐；批次 R1 已修订；**终稿未确权**；P0-6 只用最小面 | [Spec](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md) · [Plan](lucy-20261107-eval-tool-assertion-authoring-plan.md) |
| P1-5 | P1 | 审计旅程 → Eval 草稿（完整回流） | REQ-030-020 | 检出完整面 | 草案齐；批次 R1 已修订；**终稿未确权**；P0-6 只用最小面 | [Spec](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md) · [Plan](lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| P1-6 | P1 | 失败 → 工具面／Skill 反哺队列 | REQ-030-021 | 运营深化 | 草案齐；批次 R1 已修订；**终稿未确权**；**P0 不做自动改工具面** | [Spec](../specs/lucy-20261107-eval-failure-to-tool-surface-feedback-spec.md) · [Plan](lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md) |
| P1-7 | P1 | 行权限模板展开保留 templateRefs | REQ-030-014 | 正确性辅线 | 遗留验收排期；须 PM 批准重开已收口 Spec | [遗留验收 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| P1-8 | P1 | 语义发布 → Eval 门禁（发布后必跑／失败阻断或告警） | REQ-030-029 | 检出闸强化 | **2026-11-08 入池**；待需求澄清与立项开 Spec；**未授权实现**；**不挡**原 P0；依赖 P0-6 日跑／发布跑骨架 | 未开（前身思路见 [2026-08-26 闭环 Plan](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)） |
| P1-9 | P1 | 质量域 safe-log → Eval 候选回流 | REQ-030-030 | 检出／运营 | **2026-11-08 入池**；挂接既有质量域 Spec（未落地）；待澄清与 0.30 跟进对齐；**未授权实现**；与 P1-5／P1-6 并列质量轴 | 既有 [safe-log-to-quality-eval Spec](../specs/lucy-20261014-safe-log-to-quality-eval-spec.md)（功能合同未收口）· [WO](wo-20261014-safe-log-to-quality-eval.md) |
| P1-10 | P1 | 轻量概念注册表（ontology-lite；CLI 先） | REQ-030-031 | 约束深化／内容治理 | **2026-11-08 入池**；头脑风暴 Spec v0.2-draft 已有；Plan 未开；**终稿未确权**；冻结落地；**不挡**原 P0；未授权实现；交付序＝CLI→效果门→WebUI→MCP | [Spec](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md) · Plan 未开 |
| P2-1 | P2 辅线 | 发布工作台分文件勾选发布 | REQ-030-001 | UX 辅线 | 草案齐；批次 R1 已修订；**终稿未确权**；**不定义 0.30 成败** | [Spec](../specs/lucy-20261107-publish-workbench-per-file-selection-spec.md) · [Plan](lucy-20261107-publish-workbench-per-file-selection-plan.md) |
| P2-2 | P2 辅线 | 帮助中心体验 | REQ-030-002 | UX 辅线 | Deferred／开线对齐既有 Spec | 既有 Spec |
| P2-3 | P2 辅线 | 运维控制面 W-B（语义发布） | REQ-030-004 | 运维辅线 | Deferred；阻塞条件见既有 Spec | 既有 Spec |
| P2-4 | P2 取证 | 客户升级 E2E 自动化 | REQ-030-005 | 发布取证 | Deferred；不进产品闭口分母 | 既有 Spec |
| P2-5 | P2 取证 | 升级候选验证环境 | REQ-030-006 | 发布取证 | Deferred；不进产品闭口分母 | 既有 Spec |
| P2-6 | P2 工程 | E2E 主线与旁线优化 | REQ-030-007 | harness | Deferred；工程向 | 既有 Spec |
| P2-7 | P2 验收 | 访问关系图 Spec 187 验收矩阵 | REQ-030-008 | 遗留验收 | 已排期遗留验收 Plan | [遗留验收 Plan](lucy-20261107-lucy-0-30-deferred-acceptance-execution-plan.md) |
| P2-8 | P2 验收 | OIDC 功能合同验收 | REQ-030-009 | 遗留验收 | 已排期遗留验收 Plan | 同上 |
| P2-9 | P2 验收 | 语义整批恢复 SRR 验收 | REQ-030-010 | 遗留验收 | 已排期遗留验收 Plan | 同上 |
| P2-10 | P2 验收 | 运维控制面 W-A VOPS 验收 | REQ-030-011 | 遗留验收 | 已排期遗留验收 Plan | 同上 |
| — | 已收口 | 访问关系图与访问日志口径对齐 | REQ-030-003 | — | **功能合同已收口**（2026-11-04）；不表示可上线 | 既有 Spec |

---

## 4. P0 功能说明（跟进用摘要）

> 缺口细节、证据与非目标以需求池对应 REQ 正文为准；此处只锁**出口与边界**，避免 agent 扩 scope。

### P0-1｜口径绑定（REQ-030-027）

- **出口**：问题类型（或等价业务键）可绑定唯一 source + 固定口径；运行时偏离 → 拒绝或强制澄清。
- **决策**：O1／O2 已闭合；R4 已授予（2026-11-08；Claude Code 实现）。
- **不做**：用更长 instructions 代替绑定；把 ACL 改成语义裁判。

### P0-2｜Catalog 语义暴露（REQ-030-023）

- **出口**：`lucy_catalog` 可见表携带业务描述（及仓内已有同义词／粒度／适用域类资产）；按业务相关排序优于纯字母序。
- **不做**：把 catalog 做成自由文本搜索引擎；泄露不可见 source 的描述（须按可见性裁剪）。

### P0-3｜表级歧义门闩（REQ-030-024）

- **出口**：多表命中不得静默成交；限定名错表也能拦。
- **不做**：只改 instructions、不加运行时门禁。

### P0-4｜答复可核对（REQ-030-022）

- **出口**：来源表／口径／数据截止期在正常客户端强制可见（不依赖审计台）。
- **不做**：重造 provenance 数据结构（优先露出已有 `_meta.lucy` 资产）。

### P0-5｜空结果下一步（REQ-030-018）

- **出口**：`lucy_query` 0 行 → 结构化 `next_step`（合同位 + 模型可见）。
- **边界**：以已立 Spec 为准；D1＝结构化、D2＝只提示不阻断。

### P0-6｜Eval 选表可测 + 日跑骨架（REQ-030-025 + 019／020 最小面）

- **出口**：① 禁金标表名喂 prompt；② 必选／禁选表断言可用；③ 五域骨架可日更；④ 可日跑或发布后跑。
- **最小面**：能编排路径断言、能从审计旅程导出草稿即够 P0；完整 WebUI 体验归 P1-4／P1-5。
- **不做**：把 Eval 当自动修复器；P0 不要求 021 自动改工具面。

### P0-7｜体感 + 告警（REQ-030-026）

- **出口**：最小仪表盘（首次成功率／空结果率／关键失败率等）+ 跌破阈值主动告警（复用既有通知通道）。
- **不做**：一次性建成完整运营中台或用户反馈社交产品。

### P0-A｜字段暴露裁剪（REQ-030-012）

- **出口**：Catalog 与 Query 双面裁剪，未暴露列点名 fail-closed（以已立 Spec 为准）。
- **关系**：与 P0-2 同波次优先；不得阻塞 P0-1／P0-3 开 Spec。

### P0-B｜物理新鲜度合同（REQ-030-028）

- **出口**：`lucy_query`／可核对块的「数据截止期」有可声明的物理（或等价业务）新鲜度真源；禁止长期以语义文件 mtime 冒充业务截止期而不登记。
- **关系**：呈现闸伴生，强化 P0-4；**2026-11-08 仅入池**，待澄清与立项；不自动并入 2026-11-07 P0 立项包。
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

- **出口（一期）**：从 semantic-layer／Wiki 扫描概念候选与冲突；CLI 可 list／定 canonical／summary／reject；试点「收入／资产」可复核；**WebUI 零变更**；不改 MCP 热路径。
- **关系**：约束闸／内容治理辅线；为人审权威面与冲突发现服务；可反哺 P0-1／P0-2／P0-3，**不替代**它们。**不挡**原 P0 收口。
- **交付序**：CLI → 效果门 → WebUI 人审页 → MCP 注入。
- **不做**：形式化知识图谱／OWL；独立指标计算平台；一期 WebUI／MCP；机器自动裁定权威。

---

## 5. P0 收口检查清单（版本主线）

全部勾上才允许称「0.30 核心主线功能合同层完成」（仍 ≠ 可上线）：

- [ ] P0-1 Spec 收口且行为断言通过
- [ ] P0-2 Spec 收口且 catalog 契约通过
- [ ] P0-3 Spec 收口且门闩断言通过
- [ ] P0-4 Spec 收口且客户端可见核对块通过
- [ ] P0-5 Spec 收口且 0 行 next_step 通过
- [ ] P0-6 Spec 收口：选表可测 + 五域骨架 + 日跑／发布跑通路
- [ ] P0-7 Spec 收口：仪表盘最小集 + 告警通路
- [ ] P0-A Spec 收口（伴生；主线四闸已齐时若仅缺 A，须在发布说明中显式登记缺口）
- [ ] P0-B Spec 收口或发布说明显式登记「物理新鲜度缺口」（伴生；**入池后须立项才开 Spec**；未立项时不得假装已覆盖）

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
| [概念注册表 Spec](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md) | P1-10／REQ-030-031（v0.2-draft；Plan 未开） |

---

## 7. 本池自身验收

- 清单覆盖需求池 REQ-030-001–031（含已收口 003），无孤儿 REQ。
- P0 立项范围与 §2／§3 一致；**P0-B／P1-8／P1-9／P1-10 为追加入池，不自动继承 2026-11-07 P0 立项**；agent 规则可被本分支会话引用。
- **不构成任何功能验收或上线许可。**
