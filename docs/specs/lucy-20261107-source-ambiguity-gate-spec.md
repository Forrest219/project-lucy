# 多表命中先问 + 表级歧义门闩 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.5**（已获开发授权；实现已合入；复审 BLOCK／CHANGE 已修；独立复验 PASS） |
| 日期 / 目标版本 | 2026-11-07（本稿修订 2026-11-08；状态镜像 2026-11-13）/ 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-3**；需求池 **REQ-030-024** / **P0** |
| 状态 | **v0.5；R2-F＋R3（O1／O2／O4）＋R4 已闭合（2026-11-08）；实现已合入（本分支）；复审 BLOCK／CHANGE 已修；独立复验 PASS（2026-11-13，含 SC-17 HTTP／SC-25 生产装配）；待功能合同收口；本条不表示可上线** |
| 授权边界 | R2-F＋R3＋R4 已闭合（R4：2026-11-08）。授权范围＝本 Spec／Plan 实现、测试与复审 BLOCK／CHANGE 修复；**不**表示可上线。 |
| 决策来源 | 2026-11-06 CFO 误报事故 ＋ 误报防线 G2／G3：instructions 丢弃「问询范围确认」；字段歧义护栏对限定名错表零触发 |
| 需求来源 | [需求池 REQ-030-024](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.2–4.3](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-3](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：动态 role-aware instructions 合并多表先问条文 ＋ MCP Proxy 在 `lucy_query`（及约定的姊妹工具）前做表级歧义硬门禁。不改 KTX；不改 ACL 裁决口径 |
| 配套 Plan | [lucy-20261107-source-ambiguity-gate-plan.md](../plans/lucy-20261107-source-ambiguity-gate-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[Codex 对抗评审](../reviews/2026-11-08-source-ambiguity-gate-codex-review.md)（R1／R2／R3 BLOCK → 本稿修订；**≠ 终稿确权／开发授权**）；[实现复审 BLOCK](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md)（2026-11-13） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 与 P0-1（REQ-030-027）口径绑定：**024 选表，027 定口径**——仅 `begun_bound` 且 `commitPhase=committed` 时本门闩让位（见 D8）。与 P0-2 catalog 描述暴露串联：命中与候选展示消费投影字段 `description`／`descriptionState`（见 D4／D12）。既有字段级 `ambiguousFieldHint` 保留；本条新增 **source 级**门闩，不删除字段歧义路径 |

## 闭口层级

- 层级：功能合同
- 本条承诺：当一次查数请求所依据的业务词命中 **≥2 个 ACL 可见 source**（按完整身份去重）时，Proxy 在转发上游／进入 explain 本地成功体前 **stop**，返回经 `denialAllowList`／`buildRepairClosure` 裁剪的候选表清单（含完整身份、展示名、度量覆盖摘要）；Agent 即使用限定名点了其中一张表，只要同词仍多表命中且未经可信确认，仍可被拦住。无 begin／上下文缺失／目录读取失败**不得**静默放行核心事故路径（见 D10）。instructions 侧把「问询范围确认」扩展到多表命中并并入动态 role-aware 文本（不再整节丢弃）。
- 本条出口：SC-01–SC-26（见 §7）。instructions 装配断言；门禁纯函数／Proxy 单测；夹具证明歧义请求零上游执行／explain 未进本地成功体；`lint:spec-docs` 通过。**因 O1／O2 未闭合而不能关闭的 SC 见 §7.1。**
- 不在本条出口：自动选表；跨角色推荐；新造白名单；改 ACL／行权限语义；仅改 instructions 不上 tool 门闩；口径集合强制（P0-1）；catalog 描述接线本身（P0-2）；镜像／上线。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Source Ambiguity Gate：协议拒绝码建议 `source_ambiguity_gate`，中文主称「表级歧义门闩」。业务词命中 ≥2 可见 source 时，在 `lucy_query`／`lucy_explain_query` 前停止并要求显式确认。
- Multi-Source Ask-First：中文主称「多表命中先问」。instructions 层要求：多表都可能回答时先澄清再查；与指代／双意图的「问询范围确认」同族扩展。
- Ambiguity Candidate List：中文主称「歧义候选表清单」。门闩响应中的 ACL 裁剪候选（**完整 source 身份** ＋ 展示名 ＋ 度量覆盖摘要 ＋ 可选 `description`），不得含越权表。
- Source Confirmation：中文主称「选表确认」。解除门闩所需的、由用户意图驱动的可信显式信号（见 D5／D11／O1）。
- Source Identity：中文主称「来源完整身份」。与 ACL `EffectiveSource`／`CanonicalSourceKey` 同构的四元组身份；命中计数、去重、确认比较均以此为准，**不得**仅用展示名。

Forbidden:

- 把「表级歧义门闩」写成 ACL 拒绝——ACL 仍只管授权；本条是语义选表层。
- 把「多表命中先问」仅写成模型自觉、无 tool 硬拦——需求池写明 instructions 单独上线价值有限。
- 用「自动选表」「静默挑最高分表」作主行为。
- 新造平行于 `denialAllowList`／`buildRepairClosure` 的白名单通道。
- 用展示名／`sourceName||table` 单独充当确认对象身份。

落位：本条术语属 **语义层／MCP 查数门禁**，落术语标准 **§4.8「访问权限升级（Access Control Upgrade / AC-P0 + AC-P1 + AC-P1.5）」** 分区登记（实现前补标准条目）；用户可见拒绝文案用中文主称。⚠️ 术语标准存在**两个 `### 4.8`**（`:807`「MCP 调试台 / ACL 裁决可见性」、`:824`「访问权限升级」），本条按**后者**登记；标准内 §4.8 重号属**待消歧**事项（不在本条范围，另记）。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`（修复提示闭环／allow-list）
- `webui/docs/00-product-terminology-standard.md`
- `docs/specs/lucy-20261107-question-type-caliber-binding-spec.md`（串联：选表 vs 口径；BindingSession 四态）
- `docs/specs/lucy-20261107-catalog-business-semantics-spec.md`（串联：`description`／`descriptionState` 投影）

### What This Change Follows

- [ ] 拒绝响应形状沿用 Proxy 既有结构化拒绝（reason／failureDimension／repair closure），不发明第二套错误 JSON。
- [ ] 候选 source 展示名与内部身份字段保持 `translate="no"` 语义。
- [ ] 修复文案走既有 `buildRepairClosure` 文本通道；不引入营销面或仪表盘卡片。
- [ ] instructions 变更保持 Markdown 章节可读，不堆砌 pill／stat。

### Exceptions (If Any)

- 无新 WebUI 页面；确认**载体**首期走 MCP 工具参数／问询旅程字段（见 D5／O1），但**用户参与证据**须走宿主／Proxy 可核验通道（见 §4.4），不得仅凭 Agent 工具自述。

### Follow-up Needed

- 与 P0-1 BindingSession、P0-2 描述字段的组合联测用例（两／三 Spec 收口后）。
- Eval 跨表歧义用例属 P0-6，本条只提供运行时门禁合同。
- `denialAllowList.sources` 短名形态扩展为含 connection／schema 的共享通道改动——**超出本条授权**，见 O6（defer）。

---

## 1. 背景与取证

### 1.1 事故与承诺

CFO 在权限内被 Agent 选到业务上错误的表并直接作答。既有护栏只管**同名字段跨源**，且**限定名直接跳过**；instructions 对多表命中零规定，动态 role-aware 路径还整节丢弃了 fallback 中的「问询范围确认」。

### 1.2 现行缺口（已核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | instructions「问询范围确认」只覆盖指代与双意图，并写明代理不实现确认门闩 | `webui/config/data-qa-instructions.md:45-49`；需求池 REQ-030-024；误报计划 §4.2 |
| E2 | 动态 role-aware instructions 在有可见 catalog 时走拼装分支，**不包含**该节；fallback 在**正常路径**下仅于连接／source／skill 全空时返回，**异常路径（catch）同样返回 fallback** | `webui/server/proxy/mcp-proxy.ts:1838`、`:1867-1906`、`:1907-1909`（catch 分支）；需求池 REQ-030-024 |
| E3 | `ambiguousFieldHint` 候选 < 2 不提示；字段含 `.` 即跳过 → 限定名错表不触发 | `webui/server/proxy/source-ambiguity.ts:105`；`query-guardrails.ts:201`、`:196-225`、`:295-344`；需求池 REQ-030-024；误报计划 §4.3 |
| E4 | 安全裁剪闭环已存在：`denialAllowList`／`buildRepairClosure`（五项证据） | `webui/server/proxy/question-experience.ts:1027-1037`、`:1154-1221`；需求池 REQ-030-024 非目标／硬约束 |
| E5 | 沟通实录：错表为有权表上的语义误报，非 ACL 越权 | 需求池事故定性；误报计划 G4 |
| E6 | `lucy_explain_query` 在共享 query guard（约 `:5648`，现行仅接 query／read_source）**之前**本地返回（约 `:4607`） | `mcp-proxy.ts:4607-4669`、`:5648-5651` |
| E7 | P0-1 BindingSession 四态与 `caliber_binding_unresolved` 已成权威合同 | P0-1 Spec D5；`caliber-binding.ts` 状态装配 |
| E8 | P0-2 目录投影字段为 `description`／`descriptionState`（首期只取 `descriptions.db`） | P0-2 Spec D2／D3／D5／D6 |

### 1.3 取证缺口（不得当事实）

- 客户现场「资产／收入／成本」等业务词与表的完整映射表：属 P0-6／内容工作，本条只定门禁机制与确定性匹配算法。
- Agent 客户端是否展示 repair 文本：属客户端能力；本条保证工具响应携带 ACL 安全候选与闭环证据。

---

## 2. 目标

1. **Instructions**：将「问询范围确认」扩展为含「多表命中先问」，并 **并入动态 role-aware instructions**（有可见 source 时也能读到）；条文事实源与同步机制见 D13。
2. **Tool gate**：业务词命中 ≥2 个可见 source（完整身份去重）时，在 `lucy_query` 转发上游前、以及 `lucy_explain_query` 进入本地成功体前 **stop**，返回 Ambiguity Candidate List。
3. **限定名错表仍可拦**：不得因字段已限定或 source 已写死而跳过 source 级歧义判定。
4. **无 begin 不得静默放行事故路径**：区分上下文缺失／零命中／读取失败（D10）。
5. **安全**：候选必须经 `denialAllowList`／`buildRepairClosure`（或严格等价封装）；不新造白名单；不泄漏越权表；repair 输出全受可见性约束（D6／D14）。
6. **不自动选表**；不改 ACL 语义。
7. 与 P0-1 串联：本条解决选哪张表；口径绑定解决表上算什么；仅有效 `begun_bound` 跳过本门闩（D8）。

---

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 只改 instructions、不加 tool 门闩 | 需求池／误报 §4.2：单独上线价值有限 |
| 自动选表／静默最高分成交 | 选择权留人／Agent；门闩只提供依据 |
| 跨角色推荐不可见表 | 安全硬约束 |
| 新造白名单绕过 `denialAllowList`／`buildRepairClosure` | 需求池非目标 |
| 修改 ACL／行权限裁决口径 | G4：授权 ≠ 语义正确 |
| 替代字段级 `ambiguousFieldHint` | 保留；本条是 source 级 |
| 替代 P0-1 口径集合强制 | 串联：024 选表，027 定口径 |
| 实现知识图谱选表 | 与 P0-2 同属非 0.30 方向 |
| 扩展 `denialAllowList` 短名通道为含 connection／schema | 共享组件改动超出本条授权（O6 defer） |

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 双层同批：instructions（fail-open 建议）＋ tool gate（fail-closed 硬拦）。禁止只交付其中一层作为本条收口 | **冻结** |
| **D2** | Instructions：在 `webui/config/data-qa-instructions.md` 扩展「问询范围确认」至多表命中；并在 `mcp-proxy.ts` 动态拼装分支**显式插入**等价条文（修复 `:1838`／`:1907-1909` 丢弃问题）。条文须写明：多表可能命中时先澄清；**不得**再写「代理不实现任何选表门闩」——改为「工具面可能返回表级歧义拒绝，须按候选确认后重试」。同步修订 `lucy_begin_question` 工具描述中与本条冲突的旧「可省略／无门闩」承诺（见 D13） | **冻结** |
| **D3** | 门禁点：`lucy_query` 必做；`lucy_explain_query` **同口径**（避免 explain 绕过选表）。**插入点见 §6.1**（explain 必须接在本地成功体之前，不得只挂共享 guard）。`lucy_read_source` 是否纳入见 **O2**（互斥待决，**无默认执行**） | **冻结 query／explain**；read_source＝O2 |
| **D4** | 触发与匹配：从问询旅程 `intentSummary`＋可选 `question`（及 D10 规定的无 begin 回退词源）提取业务词／短语；与可见 source 的匹配字段做确定性命中（算法见 **§4.1**，含中文整句 CJK n-gram）。命中可见 source 数（按 **Source Identity** 去重）**≥ 2** → 触发门闩。描述字段对齐 P0-2：只消费投影 `description`（源自 `descriptions.db`），**不**读 `descriptionAi`／`descriptions.ai`／`human`；**描述读取健康态**见 D12／§4.6，不得把读取失败吞成 `missing` 后零／单命中放行 | **冻结** |
| **D5** | 解除：显式选表确认后，仅在本旅程内对**该确认 Source Identity**放行，且请求**全部** source 引用集合必须与该身份一致（§4.5）。确认载体首期 **O1 互斥待决**（旅程字段 **或** query／explain 参数之一；**禁止**伪代码用 `OR` 默认兼备）。确认比较、命中集合成员判定一律用完整身份，不得只用展示名。确认后仍受 ACL 与（若有）P0-1 口径快照约束。可信语义见 **D11**／**§4.4** | **冻结「须显式确认＋身份比较＋引用集合一致」**；载体＝O1 |
| **D6** | 候选响应：`failureDimension` 归语义选表；reason 码 `source_ambiguity_gate`；中文主称「表级歧义／请先确认来源表」；`candidates[]` 含完整身份、展示名、`measures` 名称摘要（截断上限见 O4）、可选 `description`（P0-2 投影）；**全部**先经调用者 permissions 过滤，再经 `denialAllowList` 约束可点名短名集合，文案与可重试集合经 `buildRepairClosure`（`usableTargets` 为唯一可引用重试集合）。五项证据见 **D14**。**安全边界＝对象级**（候选条目身份／allow-list／usableTargets 不得含不可见表）；**不**承诺候选 `description`／`repair.text` 全文零出现受限表名字面（对齐 P0-2 D4b；见 D15） | **冻结** |
| **D7** | 与字段歧义关系：source 级门闩在 ACL 通过后、上游／explain 成功体前执行；若同时存在字段歧义，可一并返回，但 **source 级 ≥2 时必须以 stop 为主**（不得只给字段 hint 却放行）。选表确认后，字段级护栏仍须生效 | **冻结** |
| **D8** | 与 P0-1 串联：权威状态＝`readCommittedBindingSession` 的 BindingSession 四态，**禁止**用 `journey.activeBinding != null` 二分或审计 turn 冒充。映射见 **§4.2**。仅 `begun_bound`＋`commitPhase=committed` 跳过本门闩；随后仍走口径集合校验。`lost_or_conflict` → `caliber_binding_unresolved`，**禁止**当无绑定放行。两拒绝码族不得混用：`source_ambiguity_gate` vs `caliber_binding_*` | **冻结** |
| **D9** | 不改 ACL；不把选表正确性写入 `access.yaml` | **冻结** |
| **D10** | **无 begin／词源运行时合同（fail-closed）**：不得以「无 begin 则跳过门闩」静默放行核心事故路径。词源与分态见 **§4.3**。与产品「先问」一致：**上下文缺失**与**目录／匹配读取失败**均 fail-closed（强制澄清或拒绝）；**真实零命中**不触发本门闩。P0-6 强制 begin **不能替代**本条合同 | **冻结**（原 O3 主路径闭合为 D10；残余见 O3′） |
| **D11** | **确认可信语义**：确认主体＝终端用户意图；Agent 不得自证确认。解除门闩除 O1 载体上的身份值外，**必须**另有独立于 Agent 自述／Agent 可写「确认提交记录」／拒绝 nonce 回传的**用户参与证据**及 Proxy 核验路径（见 **§4.4**）。候选快照与 BindingSession `generation`、提交失败／supersede 仍适用 | **冻结** |
| **D12** | **描述对齐 P0-2**：命中与候选展示消费 `description`＋`descriptionState`。`missing`（**仅**资产确实无描述）→ 描述不参与匹配；`truncated` → 仅对已投影截断文本做匹配（不回读未截断原文、不回退 ai）；`present` → 用投影全文。**另须传入门闩的描述读取健康态**（§4.6）：投影层把解析失败记成 `missing` 时，本门闩**不得**据此当作「真 missing」而把多命中压成零／单命中放行。权威读取：优先消费与 P0-2 同一套可见 source 语义投影装配＋健康态；若 P0-2 尚未接线，允许同构直读（字段名、missing／truncated 与健康态语义必须可测）。**SC-25／SC-26 必验**，不得因「P0-2 未接线」skip；SC-12 描述字段接线子句可按真实接线状态断言 | **冻结** |
| **D13** | **instructions 事实源**：`webui/config/data-qa-instructions.md` 中扩展后的「问询范围确认／多表命中先问」节为**条文事实源**。动态拼装、空目录 fallback、异常 catch fallback **必须**通过同一渲染函数／同一常量片段插入，禁止两处手写漂移。验收覆盖四路径：有可见 catalog 动态拼装、仅 skill／连接、全空 fallback、异常 fallback；并断言 begin 工具描述不再承诺「可无门闩省略」 | **冻结** |
| **D14** | **repair 五项证据装配合同**：对每个**歧义命中**候选按 **§4.7** 装配 `RepairTargetEvidence`（五项来源、身份关联、本次参数合法性）。仅五项全通过者进入 `usableTargets`（唯一可引用重试集合）。集合关系：`usableTargets` ⊆ `candidates`（命中∩可见∩allow-list）⊆ 可见 source。**五项未全通过的命中对象不得**进入 `availableCandidates`，也不得出现在「可用候选：…」文案中（与 `usableTargets` 口径一致；失败对象只进 `rejected`＋原因）。**禁止**把完整可见 allow-list 原样塞入 `availableCandidates`。全体五项失败 → `usableTargets=[]` 且 `availableCandidates=[]`，仍 **stop**；`factualError`／`rejected` 说明不可用原因 | **冻结** |
| **D15** | **候选描述安全边界（对象级）**：与 P0-2 D4b 对齐。硬保证＝（1）不可见 source **不得**作为 `candidates[]`／`usableTargets`／`rejected` 目标条目出现；（2）allow-list／五项检查按完整身份过滤。**不**保证可见候选的 `description` 原文或由其拼入的 `repair.text` 不含不可见表名字面。SC 不得用「响应全文无任何受限表名」作绝对断言；内容抑制 defer 发布侧／语义层治理（非本条首期） | **冻结** |
| **O1** | 确认载体二选一（互斥）：① 旅程字段 `confirmedSourceKey`（完整身份序列化）；或 ② `lucy_query`／`lucy_explain_query` 可选参数 `sourceConfirmationKey`（同形）。**禁止**未裁定前用 `OR` 兼备或默认优先级 | **已闭合（2026-11-08）**＝**① 旅程字段 `confirmedSourceKey`**（互斥；不实现参数载体） |
| **O2** | `lucy_read_source` 是否纳入同门闩 | **已闭合（2026-11-08）**＝**否**（首期不纳入；不实现拦／不拦以外的默认） |
| **O3′** | D10 已冻结 fail-closed 主合同。残余：无 begin 且请求**未断言任何 source／限定字段**的纯探索调用，是否仍要求 begin 才允许继续——产品边角 | **开工前可选答**；未答前伪代码对「未断言 source」走真实零命中／单命中规则，**不得**对「已断言 source」放行 |
| **O4** | 度量覆盖摘要最大条数／截断策略 | **已闭合（2026-11-08）**＝**8** |
| **O5** | 是否后置可发布「歧义词 → 表」资产以增强命中 | **开工前可答**；**首期算法已冻结为 §4.1 纯文本**，资产表不阻塞首期；未闭合不得实现资产分支 |
| **O6** | 是否授权扩展共享 `denialAllowList.sources` 为含 connection／schema 的形态 | **defer（非首期出口）**；首期短名仅作 allow-list 成员检查，身份与确认仍用四元组 |

> **开放决策守卫（本条统一，2026-11-08）**：所有 **O 项在闭合前不得实现对应分支**——缺省一律 fail-closed（该分支不实现、依赖它的 SC 保持未关闭、不得以「评审已通过」当作已闭合）。**禁止**把示意伪代码、历史「默认建议」或 Plan 措辞当成已授权决策。闭合须由**委托人（PM）**在**开发授权前**书面裁定并回写 O 行；**评审通过 ≠ O 项闭合 ≠ 终稿确权 ≠ 开发授权**。

### 4.1 业务词命中算法（Normative；F-04／F-R2-02）

**权威数据源（按优先级）**

1. 当前调用者 `effectivePermissions.sources`（ACL 可见四元组）——命中宇宙的唯一边界。
2. 与每个可见 source 关联的匹配文本字段：
   - `sourceName`、`table`（物理表名）
   - 度量名／维度名：来自该 source 已发布语义模型的名称枚举（与现有 schema 遍历同源；读取失败见分态）
   - `description`：按 D12／P0-2 投影；仅当 `descriptionState ∈ {present, truncated}` **且** 该条描述健康态＝`ok`（§4.6）时参与
3. **禁止**以预注入的 `hits` 数组作为验收输入；验收必须从**原始问句／旅程字段／请求字面**＋**真实形状目录**出发。

**规范化（与 P0-1 O2 对齐的唯一函数）**

```ts
N(s) = s.normalize("NFKC")
        .toLowerCase()
        .replace(/\p{White_Space}+/gu, " ")
        .trim()
```

固定使用 ECMAScript `String.prototype.toLowerCase()`；不做分词库、正则模糊、简繁转换、同义词或语义推断。中文覆盖靠下方 **CJK 连续 n-gram**，不依赖空白分词。

**短语提取 `extractTerms(journey, args, mode)`**

1. 收集字符串池：`journey.intentSummary`、`journey.question`（若有）；D10／§4.3 **允许进入 `terms_from_request` 时**另含请求内可观测字面；若分态已裁定为 `context_missing`，**不得**再从此处提词放行。
2. 对每个非空字符串 `S`：令 `T = N(S)`；若 `T` 长度 ≥ 1，则：
   - 将整个 `T` 作为一条短语；
   - 再按空白切开，保留长度 ≥ 2 的 token；
   - **CJK 连续 n-gram（Normative；关闭 F-R2-02）**：在 `T` 中找出每个极大 CJK 连续段 `R`（字符满足 Unicode 属性 `\p{Script=Han}` 或常用扩展区；实现夹具固定同一判定）。对每个 `R`，加入所有长度 `L ∈ [2, min(8, |R|)]` 的连续子串作为短语。例：`今年收入是多少` → 含 `收入`、`今年`、`多少` 等。
3. 去重后得到 `terms[]`。若结果为空 → 交由 §4.3 分态，**不**假装零命中放行已断言 source 的请求。

**产品承诺（本算法边界）**

- **承诺覆盖**：无空格中文整句业务问句中，长度 ≥ 2 的 CJK 子串与可见 source 匹配字段的双向包含（见下）——含固定反例「今年收入是多少」对「销售收入金额」「营业收入金额」类描述的多表命中。
- **不承诺**：简繁转换、同义词、拼音、英文词干、语义近义；超出 n-gram 窗口（>8）的超长专名需出现在空白 token、整句或字段反向包含中。

**命中关系 `sourceHit(source, terms)`**

```text
fields := [source.sourceName, source.table]
if descriptionHealthy(source) and descriptionState in {present, truncated} and description != null:
  fields += [description]
fields += measureNames(source) + dimensionNames(source)   # 读取失败 → 该 source 标记 read_partial

sourceHit := ∃ t ∈ terms, ∃ f ∈ fields:
  N(f).includes(t) OR (t.length >= 2 AND N(f).length >= 2 AND t.includes(N(f)))
```

- **同一业务词命中多表**：同一 `t` 命中多个 Source Identity → 计入多命中（门闩触发）。
- **不同意图短语分别命中不同表**：只要去重后的命中身份 ≥ 2，同等触发（不按「用户可能只想一张」静默挑选）。
- **去重键**：`CanonicalSourceKey`＝`{connectionId, schema, sourceName, physicalTable}`（与 ACL 一致；`table`↔`physicalTable`）。展示名碰撞**不得**合并身份。

**失败分支**

| 情况 | 分态 | 行为 |
|---|---|---|
| 权限／可见 source 列表读取失败 | `catalog_read_failure` | **deny** `source_ambiguity_gate`（或专用子码若实现时扩展）；**禁止**当成零／单命中放行 |
| 语义模型／度量枚举部分失败 | `read_partial` | 失败的字段不参与匹配；若其余字段仍使命中 ≥2 → 照常 stop；若因失败导致「看起来 <2」但存在未读完的候选宇宙 → **fail-closed deny**（不可判定） |
| 描述投影读取失败／健康态非 ok（§4.6） | `description_read_unreliable`（归入 `read_partial` 不可判定族） | **fail-closed deny**；**禁止**把失败条当 `missing` 后按零／单命中放行 |
| 坏 YAML 跳过单文件 | 同现有装载器 | 被跳过的 source **不得**计入「已证明唯一」；若跳过导致宇宙不完整 → `catalog_read_failure` |
| 真实扫描成功、健康态全 ok、且无短语命中任何可见 source | `zero_hits` | 本门闩不触发 |

### 4.2 BindingSession 四态衔接（Normative；F-07）

| BindingSession 态 | P0-3 行为 |
|---|---|
| `never_begun` | 本门闩**生效**；词源／分态走 D10 |
| `begun_no_hit` | 本门闩**生效**（无有效钉表） |
| `begun_bound`（且 `commitPhase=committed`） | **跳过**本门闩；继续 P0-1 口径快照校验 |
| `lost_or_conflict`（含 `commitPhase≠committed`、指针损坏、代次冲突等） | 返回 **`caliber_binding_unresolved`**；**禁止**当作无绑定而进入 P0-3 放行路径；**不**发 `source_ambiguity_gate` 冒充 |

查询／explain 合同测试必须装配**实际** BindingSession 状态机组件（或与其同契约的测试替身），**禁止**仅 mock `activeBinding` 存在性。

### 4.3 无 begin／词源分态（Normative；F-01／F-R2-01／D10）

分态**互斥**；按下表**唯一优先级**裁定（从上到下，命中即停，不得再落入更低优先级）：

| 优先级 | 分态 | 定义 | 行为 |
|---|---|---|---|
| P0 | `catalog_read_failure`／`read_partial`／`description_read_unreliable` 不可判定 | 见 §4.1／§4.6 | fail-closed deny；query／explain **零执行** |
| P1 | `context_missing` | BindingSession＝`never_begun`（或等价无旅程），且请求**已断言**任一 source／限定字段（含顶层 source、dotted measure／dimension、filter 内可解析 source 引用）——**无论**能否从请求字面提出 `terms` | **fail-closed**：`source_ambiguity_gate`（需 begin 或可信确认）；**禁止**落入 `terms_from_request`；**上游／explain 成功体执行计数＝0** |
| P2 | `terms_from_request` | 无 begin，且请求**未**断言任何 source／限定字段（O3′ 边角／纯探索），但可从请求其它字面提取 `terms` | 走 §4.1；≥2 命中且未确认 → stop |
| P3 | 有 begin（`begun_no_hit` 或旅程可读） | 词源＝旅程 `intentSummary`＋可选 `question`（为主）；请求字面可补充但不得覆盖用户确认语义 | 正常门闩 |
| P4 | `zero_hits` | 词已提取且完整可见宇宙＋健康态 ok 上真实零命中 | 本门闩不触发 |

**硬裁决（关闭 F-R2-01）**：无 begin ＋ 限定名／已选错表 ＋ 即便从请求词只得到**单命中** → 仍属 **P1 `context_missing`**，**不得**按单命中放行；SC 必须断言 `lucy_query` 与 `lucy_explain_query` 执行计数均为 0。这与 O3′「未答前不得对已断言 source 放行」一致。

**禁止**：`if terms empty: continue`；禁止在已断言 source 时用 `terms_from_request` 覆盖 `context_missing`。

### 4.4 确认状态机（Normative；F-05／F-R2-03／D11）

**确认主体**：终端用户。Agent 是代填通道，不是确认权威。

**核验者**：MCP Proxy 门闩在放行前同步核验（纯服务端）；不得依赖客户端「已展示过澄清」的自述。

**两层合同（须同时满足；与 O1 载体互斥待决兼容）**

| 层 | 含义 | 不是什么 |
|---|---|---|
| **A. 确认载体（O1）** | 确认身份值落在旅程字段 **或** query／explain 参数之一（互斥；伪代码不得 `OR`） | 载体有值 **≠** 用户已参与 |
| **B. 用户参与证据（本条硬要求）** | Proxy 可独立核验「拒绝之后、终端用户确实参与了选表」的依据 | **不得**用 Agent 自述、Agent 可写提交记录、或拒绝 nonce 回传充当本层 |

**可采信信号（A＋B＋身份／引用约束；缺任一 → deny）**

1. **载体（A）**：信号落在 O1 裁定的唯一载体上；值为某一完整 Source Identity，且 ∈ **本旅程当前 `generation` 绑定的候选快照**。
2. **引用集合**：请求的**全部** source 引用集合（§4.5）恰好等于 `{确认身份}`（单元素；冲突／不可解析 → deny）。
3. **用户参与证据（B）——独立可核验依据（Normative）**  
   Proxy 必须从**非 Agent tools/call 自述**的通道取得证据，并在放行前完成核验。首期允许扩展**既有**宿主／会话通道之一（实现择一并在 SC 固定；**不**提前裁定 O1），合同形状统一为：

   ```text
   UserParticipationEvidence := {
     sessionKey: identityKey + sessionId,
     generation: 与候选快照／BindingSession 同代,
     selectedIdentity: SourceIdentity,   // ∈ 该代候选快照
     attestedAt: 时间戳（须晚于该代 source_ambiguity_gate 拒绝 issuedAt）,
     sourceChannel: 宿主通道标识
   }
   ```

   **允许的 `sourceChannel`（可扩展既有实现，任选其一写入 Plan／SC；不得并行默认可信）**：
   - **WebUI／宿主用户回合写入**：由 Lucy WebUI（或同等宿主）经**非 MCP tools/call** 的既有会话／审计用户消息写入路径，把用户澄清回合落到 Proxy 可读存储（键＝`identityKey`＋`sessionId`）；内容须可映射到 `selectedIdentity`（完整身份或与快照内唯一候选的可逆映射）。**Agent 不得**经 tools/call 伪造该存储行。
   - **宿主确认提交 API**：由宿主 UI 调用 Proxy 既有／扩展的确认写入入口（非 `lucy_query`／`lucy_explain_query`／`lucy_begin_question` 工具参数），写入与 `generation` 绑定的 attested 确认；门闩只**读**该记录。

   **核验路径（Proxy 放行前必做）**：
   1. 按 `sessionKey`＋`generation` 读取 attested 证据；缺失 → deny。
   2. `attestedAt > snapshot.issuedAt`；否则视为无新用户回合 → deny。
   3. `selectedIdentity` ∈ 该代候选快照，且与载体（A）身份相等。
   4. 证据 `sourceChannel` ∈ 已登记宿主通道集合；来自 tools/call 参数／begin `question`／Agent 自写字段 → **一律无效**。

4. **明确不构成用户参与证据（禁止清单）**：
   - Agent 工具参数自述（含 `lucy_begin_question.question`／`intentSummary`、确认字段字面值）。
   - 仅由 Agent 经 tools/call 写入、且无宿主 attested 标记的「确认提交记录」／`commitPhase`。
   - 门闩拒绝响应中的 `confirmationNonce`／等价票据被**同一 Agent 回传**（nonce 至多作审计关联，**不得**单独或与 Agent 自填组合冒充用户确认）。
   - 「上一轮拒绝后 Agent 立刻重试」本身。

5. **禁止**下列冒充（SC-17 固定反例）：
   - 同一 tools/call 内「首次歧义命中同时自带确认」；
   - **拒绝后立即自填**：上一 tools/call 刚返回 `source_ambiguity_gate`，同一 Agent 在**没有**经上述核验路径通过的 `UserParticipationEvidence` 时，立刻用候选身份／回传 nonce 重试并声称已确认 → **deny**。

**候选快照与 BindingSession `generation`**

- 每次返回 `source_ambiguity_gate` 时，服务端须持久化（或与旅程同寿命存储）`{generation, candidateIdentities[], issuedAt}`，其中 `generation`＝当前已提交 BindingSession 的 `generation`（`never_begun` 时用会话级「无绑定代次」哨兵，夹具固定；成功 begin／supersede 后哨兵失效）。
- 确认核验：`confirmation.generation === snapshot.generation === sess.generation === evidence.generation`（有绑定会话时）；代次不符 → 确认无效。
- 并发新 begin／supersede 提升 `generation` 后，旧快照、旧确认与旧用户证据一律失效；持旧确认提交 → **提交失败**（结构化错误，不得放行）。

**旅程边界**：键＝`identityKey`＋`sessionId`（与 P0-1 BindingSession 对齐）；确认、快照与用户证据均绑定 `generation`；`turnId` 可选仅作审计，**不得**单独充当代次。

**提交**

- 宿主 attested 确认写入须在门闩放行前由核验者可读。
- 拒绝响应**不**清除候选快照，但**不得**把未确认写成已确认；**不得**把 nonce 颁发解释为用户已确认。
- 提交失败（代次冲突、快照缺失、身份∉快照、引用集合冲突、用户证据缺失／未通过核验）→ deny／结构化失败；**禁止**降级为「无确认继续放行」。

**失效／supersede**

- 新的成功 `lucy_begin_question`（新 turn／supersede、`generation`++）→ 旧确认、旧候选快照与旧用户证据失效。
- 会话切换／Token 切换／进程重启且 attested 状态未持久化或未提交成功 → 失效。
- 用户／Agent 改选导致引用集合 ≠ `{已确认身份}` → 旧确认不适用；若仍多命中且无新用户证据 → stop。
- 跨会话重放旧确认／旧证据 → 无效。

### 4.5 请求 source 引用集合（Normative；F-R2-04）

**采集**：与 ACL／P0-1 同源，调用 `collectCanonicalSourceKeys(toolName, args)`（或严格等价封装），覆盖顶层 source／table／connection 限定、measures／dimensions／**filters**／**order_by** 等全部请求侧引用；**禁止**只读单一 `resolveRequestSourceKey` 作为放行条件。

**共享采集器修订范围（关闭 F-R2-04）**：现行 `acl.collectTableRefs`／`addTableRefsFromText(..., { fallbackUnknown: false })` 对未知字符串**静默丢弃**，导致后续 `unresolved` 无法恢复（反例：确认 A，顶层及度量引用 A，过滤字段 `ghost.amount` → 采集仍可能 `{keys:[A], unresolved:[]}`）。本条**授权并要求**修订共享采集路径（Plan 写作「修订 `acl.collect*`」），使未知 filter／order_by（及其他同等字符串引用）**保留**为 `unresolved` 字面，**不得**因 `fallbackUnknown:false` 丢弃。允许在共享封装内增加「保留未知引用」选项或等价分支；**禁止**在门闩模块另写平行采集器绕过共享路径。

令：

- `requestKeys`＝采集得到的 `CanonicalSourceKey[]`（去重）
- `unresolved`＝无法解析到已知 source／物理表的引用字面（**含**曾被 `fallbackUnknown:false` 丢弃的未知 filter／order_by 引用）

**裁决（放行前）**

| 情况 | 结果 |
|---|---|
| `unresolved.length > 0` | **deny**（fail-closed；不得放行本门闩） |
| 未进入确认放行分支 | 不因本表单独放行；继续歧义／分态逻辑 |
| 确认放行：`confirmedKey != null` | 仅当 `requestKeys.length === 1` 且 `canonicalSourceKeyEquals(requestKeys[0], confirmedKey)` → 才可通过本门闩的确认分支 |
| 确认 A，但顶层写 A、度量／过滤引用 B（`requestKeys` 含 A 与 B） | **冲突** → deny；不得因「主解析返回 A」放行 |
| 确认 A，顶层／度量引用 A，但 filter／order_by 含未知字面（如 `ghost.amount`）→ `unresolved` 非空 | **deny**（不可解析引用；不得静默丢弃后当单元素放行） |
| 确认 A，但 `requestKeys` 为空（无任何可解析引用）却参数自带确认 | **deny**（确认无所指） |

SC-16 必须覆盖：双连接同名；多 source 引用冲突；**未知 filter／order_by 保留并 unresolved deny**（含 `ghost.amount` 反例）。

### 4.6 描述读取健康态（Normative；F-R2-06；串联 P0-2）

P0-2 合同允许单文件解析失败记 `descriptionState=missing`、整根不存在返回空索引——投影层**不区分**「资产真无描述」与「读取失败」。本门闩**额外**要求装配方传入（或同构直读时自行计算）每条可见 source 的：

```ts
type DescriptionReadHealth =
  | { status: "ok" }                         // 真 missing／present／truncated 均可信
  | { status: "read_failed"; reason: string } // 本应参与匹配的描述不可用
  | { status: "index_unreliable" };          // 整根／索引不可用
```

**规则**

1. `status=ok` 且 `descriptionState=missing` → 描述字段不参与匹配（真缺失）。
2. `status=read_failed` 或 `index_unreliable` → 整次匹配结果视为 **不可判定**（`description_read_unreliable`／`read_partial`），**deny**，query／explain 零执行。
3. **禁止**将 `read_failed` 降级为 `missing` 后再因「只剩一表命中」放行。
4. SC-25 固定串联反例：两表本应均因描述命中；其中一表描述读取失败被投影成 `missing` → 门闩仍须 deny，不得单命中放行。

### 4.7 repair 五项证据装配（Normative；F-R2-05／D14）

对每个歧义命中候选 `id: SourceIdentity`，装配：

| # | 字段 | 读取来源（Normative） | 合法判定 |
|---|---|---|---|
| ① | `schemaExists` | 与现网 repair 同源的真实 Schema／sourceMap 探测；不可探测 → `null` | `true` 才继续；`null`／`false` → 不可入 usable |
| ② | `visibleToPrincipal` | 当前调用者 `effectivePermissions.sources` 含该完整身份 | 必须 `true` |
| ③ | `compiled` | 该 source 语义模型编译完成态；**仅** `completion=done` 为真；`partial`／失败 → `false` | 必须 `true` |
| ④ | `parameterShapeValid` | 相对**本次** query／explain `args`：目标身份与 §4.5 `requestKeys` 相容（确认前可为「候选可被该类参数指向」的形态检查）；不得只检查「目标是否存在某一度量」 | 必须 `true` |
| ⑤ | `callable` | 工具入口对当前主体可调用（既有 callable／allow 工具表） | 必须 `true` |

**身份关联**：`RepairTargetEvidence` 必须携带或可逆映射到 `SourceIdentity`；短名仅用于现行 allow-list 成员检查与文案，不得作为五项判定的唯一键。

**集合合同**

```text
hitIds          := 歧义命中 SourceIdentity[]（§4.1）
visibleHits     := hitIds ∩ visible(permissions)
allowHits       := visibleHits 中 allowListName ∈ denialAllowList.sources 者
candidates[]    := allowHits 的对外展示行（含 description 投影，受 D15）
evidences       := toRepairTargetEvidence(allowHits, args)   # 上表五项
usableTargets   := evidences 中五项全 true 的目标   # 唯一可引用重试集合
rejected        := evidences 中未全 true 者（附 reason）
availableCandidates :=
  # 与 usableTargets 口径一致：五项失败对象不得称为「可用」
  []     # 当 usableTargets 为空时必须为空
  # 当 usableTargets 非空时：不进入「无合法目标」分支（既有 buildRepairClosure 行为）
  # 禁止：把 allowHits 中未过五项者塞进 availableCandidates
  # 禁止：visibleAllowListNamesOnly(完整 allow-list) 冒充
```

**文案纪律（关闭 F-R2-05）**：`buildRepairClosure` 在 `usableTargets` 为空时若 `availableCandidates` 非空会拼接「可用候选：…」。因此五项失败命中**不得**传入 `availableCandidates`；失败原因只经 `rejected`／`factualError`（「当前没有可用的合法目标：…」）。禁止同时出现「没有可用的合法目标」与「可用候选：A、B」。

全体不可用仍返回 `source_ambiguity_gate` 且 stop；`usableTargets=[]` 且 `availableCandidates=[]`。

---

## 5. 数据模型（Normative）

```ts
// Source Identity — 与 ACL EffectiveSource / CanonicalSourceKey 同构
type SourceIdentity = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string; // EffectiveSource.table
};

// 门闩拒绝载荷 — 示意（贴合既有 repair 形状，不另起炉灶）
{
  reason: "source_ambiguity_gate",
  failureDimension: "source_selection",
  message: "表级歧义：请先确认来源表",
  candidates: Array<{
    sourceKey: SourceIdentity;   // 内部唯一身份；确认／去重／比较用此
    displayName: string;         // 展示名 = sourceName || physicalTable
    allowListName: string;       // 现行 denialAllowList 元素形态（短名）；仅作成员检查
    measures: string[];          // 截断后的度量名摘要
    description?: string | null; // P0-2 投影；勿用 descriptionDb/descriptionAi
    descriptionState?: "present" | "missing" | "truncated";
  }>,
  repair: RepairClosure          // buildRepairClosure 结果；usableTargets 为可重试集合
}
```

**展示名 vs 身份（F-02）**

- `denialAllowList({ connections, sources }).sources` 现行元素是 **`sourceName || table` 短名**（`question-experience.ts:1033-1037`），**不含** connectionId／schema。
- ACL `EffectiveSource` 为四元组。短名在双连接同名表时**不能**唯一指向确认对象。
- **本条裁定**：
  1. 命中计数、去重、候选关联、确认比较 → **仅** `SourceIdentity`／`CanonicalSourceKey`。
  2. `displayName`／`allowListName` → 人读与现行 allow-list 成员检查；**不得**单独用作确认相等条件。
  3. 双连接均有 `orders` → 两个候选，身份不同；确认连接 A 不得放行连接 B。
  4. **不**新造平行白名单。扩展短名通道含 connection／schema → **O6 defer**，须另授共享组件授权。

候选构造规则：

1. 只纳入 `effectivePermissions.sources` 中按 §4.1 命中者（身份去重）；描述健康态非 ok 时整次匹配不可判定（§4.6），不构造「假单命中」候选后放行。
2. 对每个命中构造完整 `sourceKey`＋`displayName`＋`allowListName`。
3. allow-list 成员检查：`allowListName ∈ denialAllowList(...).sources`；未通过者不得进入对外候选。
4. `buildRepairClosure` 按 §4.7：`usableTargets` ⊆ 命中∩五项通过；全体不可用时 `availableCandidates` 必须为 `[]`（**不得**＝完整可见 allow-list，也**不得**＝五项失败命中集）；响应不得含「可用候选：」指向失败对象。
5. 禁止把不可见表以「相似推荐」形式塞进 `candidates[]`／`usableTargets`／`rejected.target`（**对象级**；D15）。`description` 原文透传可能导致受限表名字面出现在文本中——**不**视为违反本条对象级保证。

---

## 6. 核心流程（伪代码）

### 6.1 门禁插入点（Normative；F-08）

| 工具 | 插入点（现行代码方位） | 必须断言 |
|---|---|---|
| `lucy_query` | ACL 通过之后、共享 query guard／上游转发之前（与既有 guardrails 同段可组合；source 级先于或并列字段歧义，但 source≥2 时必须 stop） | `reason=source_ambiguity_gate`；上游执行计数 0 |
| `lucy_explain_query` | **本地 explain 成功体之前**（`mcp-proxy.ts` 约 `:4607` 分支内、调用 `lucyExplainQuery` 之前）；**不得**只挂在约 `:5648` 的共享 guard（现行该处不接 explain，会漏） | 同拒绝码＋候选；**未进入**本地 explain 成功体 |
| `lucy_read_source` | **O2 未闭合前不实现**；伪代码不写入默认拦／不拦 | — |

### 6.2 伪代码

```text
# --- instructions 装配（D13：单一事实源）---
ASK_FIRST_SECTION := renderFromCanonicalMd("问询范围确认／多表命中先问")

buildRoleAwareInstructions(identity):
  try:
    catalog := lucyCatalog(identity)
    skills := filterAccessibleSkills(...)
    if empty(catalog) and empty(skills) and empty(connections):
      return fallbackIncluding(ASK_FIRST_SECTION)
    body := dynamicBodyWithoutAskFirst()
    body := body + ASK_FIRST_SECTION          # NEW: always merge same fragment
    body := body + visibleScope(catalog)
    return body
  catch:
    return fallbackIncluding(ASK_FIRST_SECTION)  # 异常路径同等条文

# begin 工具描述：删除「可省略且无选表门闩」类旧承诺；改为与 D2 一致

# --- tool gate ---
on lucy_query | lucy_explain_query(args, identity, session):
  aclDecision := acl.check(...)
  if aclDecision.denied: return aclDenial

  sess := readCommittedBindingSession(identityKey, sessionId)  # P0-1 权威
  switch sess.state:
    case lost_or_conflict:
      return deny(caliber_binding_unresolved)   # 禁止当 null 放行
    case begun_bound:
      continue caliber binding checks           # 跳过本 gate；仍校验快照
    case never_begun | begun_no_hit:
      pass                                      # 进入本 gate

  # §4.3 互斥优先级：已断言 source 的无 begin → context_missing（P1），禁止 terms_from_request
  termOutcome := resolveBusinessTermsByPriority(sess, args)
  switch termOutcome.kind:
    case context_missing:
      return deny(source_ambiguity_gate, need_begin_or_confirm)  # 零执行；含「错表单命中」
    case catalog_read_failure | read_partial_indeterminate | description_read_unreliable:
      return deny(source_ambiguity_gate, catalog_unreliable)     # 零执行
    case zero_hits:
      continue existing field-ambiguity / guardrails / upstream-or-explain
    case terms_ready:
      terms := termOutcome.terms

  matchOutcome := matchVisibleSources(terms, identity)  # §4.1＋§4.6 健康态
  if matchOutcome.kind in {catalog_read_failure, description_read_unreliable, read_partial_indeterminate}:
    return deny(source_ambiguity_gate, catalog_unreliable)

  hits := matchOutcome.hits  # SourceIdentity[] 去重后
  hits := enrichMeasuresAndDescriptions(hits)  # D12；健康态非 ok 已在上分支拒绝

  if len(hits) < 2:
    continue existing field-ambiguity / guardrails / upstream-or-explain

  collected := collectCanonicalSourceKeys(tool, args)   # §4.5；acl.collect* 须保留未知 filter／order_by → unresolved
  if collected.unresolved.length > 0:
    return deny(source_ambiguity_gate, unresolved_source_refs)

  # O1 互斥待决：实现时只保留一种；此处用 PENDING_CARRIER 占位，禁止 OR 默认
  # 不得从本伪代码推导旅程字段或参数方案谁优先
  confirmedKey := readConfirmation(PENDING_CARRIER)  # journey XOR args — 未裁定不实现
  evidence := readUserParticipationEvidence(sess)     # §4.4 层 B；宿主 attested；非 Agent 自述／nonce
  if confirmedKey != null \
     and identityIn(confirmedKey, hits) \
     and identityIn(confirmedKey, snapshotFor(sess.generation)) \
     and requestKeysEqualSingleton(collected.keys, confirmedKey) \
     and verifyUserParticipation(evidence, confirmedKey, sess.generation):  # 禁止 nonce／Agent 提交冒充
    # 选表已确认；字段级护栏仍继续（D7）
    continue existing field-ambiguity / guardrails / upstream-or-explain

  allow := denialAllowList(permissions)
  candidates := trimByAllowListAndVisibility(hits, allow)
  evidences := toRepairTargetEvidence(candidates, args)  # §4.7 五项
  closure := buildRepairClosure({
    failureDimension: "source_selection",
    candidates: evidences,
    # 五项失败不得进入 availableCandidates／「可用候选」文案；与 usableTargets 一致
    availableCandidates: []
  })
  persistCandidateSnapshot(sess.generation, candidates)  # §4.4
  # usableTargets ⊆ hits ∩ 五项通过；对象级不得回显隐藏表（D15）
  return deny(source_ambiguity_gate, candidates, closure)
  # lucy_query: NO upstream
  # lucy_explain_query: NO lucyExplainQuery success body

# 无 begin + 限定错表：即便请求词仅单命中 → context_missing，零执行（F-R2-01）
# 有 begin + 限定错表 + 同词 ≥2：未可信确认 → deny（D7）
```

关键失败分支均须映射到 §7 SC。**O1／O2 未闭合前，依赖确认载体或 read_source 的实现分支不得落地；伪代码不得默认选边。**

---

## 7. 验收（SC-01–SC-26）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 动态 role-aware instructions（有可见 catalog）包含事实源全文规则：多表先问、指代、双意图、工具面可能拒绝；与 md 事实源一致 | 单测：完整规则断言（非仅标题包含） |
| SC-02 | 四路径均含等价条文且不互相矛盾：① 动态 catalog ② 仅 skill／连接 ③ 全空 fallback ④ 异常 catch fallback；begin 工具描述无「可无门闩省略」旧承诺 | 单测 |
| SC-03 | 业务词命中 ≥2 可见身份且未确认 → `lucy_query` 返回 `source_ambiguity_gate`，上游执行计数 0；输入＝原始问句＋真实形状目录 | 夹具上游计数 |
| SC-04 | 同条件对 `lucy_explain_query`：返回 `source_ambiguity_gate`＋候选；**未进入**本地 explain 成功体 | 夹具（插入点约 `:4607` 前） |
| SC-05 | Agent 使用限定名／已选 source 但同词仍 ≥2 命中且未确认 → 仍 stop（限定名不豁免） | 单测 |
| SC-06 | 真实零命中或单身份命中（健康态 ok）→ 本门闩不触发；**读取失败不得伪装成零／单命中** | 单测＋故障注入 |
| SC-07 | 可信确认信号生效后（O1 载体身份 **且** §4.4 宿主 attested 用户参与证据均通过），对确认 **Source Identity** 且引用集合单元素等于该身份的合规查询可过本门闩 | 单测（**O1 闭合前本 SC 不可关闭**；用户证据通道可先固定） |
| SC-08 | 候选条目无越权表（对象级）；allow-list 成员检查通过；repair 经 `buildRepairClosure`；`usableTargets`／`rejected.target` 均可见性约束 | 单测（双角色） |
| SC-09 | 不存在第二套平行白名单模块；路径调用既有 `denialAllowList`／`buildRepairClosure` | 静态／单测 spy |
| SC-10 | BindingSession：`begun_bound` 跳过本门闩且口径校验仍运行；`lost_or_conflict` → `caliber_binding_unresolved`；`never_begun`／`begun_no_hit` 走本门闩。须用实际状态装配，禁止仅 mock 存在性 | 合同单测 |
| SC-11 | 无自动选表：响应不把某一候选标为「已选定成交」 | 合同单测 |
| SC-12 | 候选含度量摘要；描述字段为 P0-2 `description`／`descriptionState`；真 `missing`（健康态 ok）不参与匹配；`truncated` 仅匹配截断文本；描述字段接线子句须检测真实接线状态（未接线则该子句显式 skip，不得因读错 `descriptionDb` 长期假绿）；**不**免除 SC-25／SC-26 | 单测 |
| SC-13 | 拒绝文案含中文主称「表级歧义」或等价；**对象级**：`candidates[]`／`usableTargets`／`rejected.target` 无不可见表身份；**不**断言 `description`／`repair.text` 全文零受限表名字面（D15／P0-2 D4b） | 单测（F-R2-07） |
| SC-14 | `lint:spec-docs` 对本 Spec／Plan 退出码 0；术语小节形状合规 | 门禁 |
| SC-15 | **无 begin**＋请求断言限定名／错表：一律 `context_missing`（即便请求词仅单命中）→ `source_ambiguity_gate`；`lucy_query` 与 `lucy_explain_query` 成功体计数均为 0；不得走 `terms_from_request` 放行 | 夹具（F-01／F-R2-01） |
| SC-16 | 双连接同名：命中／去重／确认按完整身份；确认 A 不放行 B；**多 source 引用**（顶层 A＋度量／过滤 B）→ 冲突 deny；**未知 filter／order_by 引用**（如确认 A＋`ghost.amount`）须保留进 `unresolved` 并 deny，不得被 `fallbackUnknown:false` 静默丢弃后放行；不得仅凭单一 `resolveRequestSourceKey` 放行 | 单测（F-02／F-R2-04） |
| SC-17 | 确认反例：同请求自填、**拒绝后立即自填（无宿主 attested 用户证据）**、**仅回传拒绝 nonce**、**仅 Agent 可写提交记录／begin.question**、旧旅程／旧 `generation` 重放、并发 begin supersede 后旧确认提交失败、换表、跨会话、冲突确认 → 均不得放行；正例须证明 Proxy 经 §4.4 核验路径读到宿主用户证据 | 单测（F-05／F-R2-03；**依赖 O1 载体裁定后关主路径；用户证据通道与 O1 正交且必验**） |
| SC-18 | repair：§4.7 五项来源与身份关联；`completion=partial` 不得冒充 compiled；无 usableTargets 时 `availableCandidates=[]` 且响应文案**无**「可用候选：」；五项失败对象只在 `rejected`／`factualError`；隐藏同名表不得进对象集合；失败仍 stop | 单测（F-06／F-R2-05） |
| SC-19 | D7 共存：source 歧义＋字段歧义同时存在 → 以 source stop 为主且可带字段信息；选表确认后字段护栏仍可拦 | 单测（F-08） |
| SC-20 | 命中算法：宽词多表、中英混排、同词多表 vs 不同词分表；**固定反例**：原始问句／intentSummary＝「今年收入是多少」，两可见 source 描述＝「销售收入金额」「营业收入金额」、名称与度量均为英文 → 命中 ≥2 并触发门闩；禁止预注入 hits | 纯函数单测（F-04／F-R2-02） |
| SC-21 | `lucy_read_source` 纳入／不纳入的行为与 O2 裁定一致 | **O2 闭合前不可关闭** |
| SC-22 | instructions 优先级：工具拒绝优先于「模型自觉放行」旧表述；两路径无互相矛盾的放行条文 | 单测（F-10） |
| SC-23 | explain 插入点回归：仅挂共享 guard 的实现视为失败；必须在本地成功体前拦截 | 架构／单测（F-08） |
| SC-24 | 部分目录装载失败 → 不得伪装零／单命中放行（`catalog_read_failure`／不可判定） | 故障注入 |
| SC-25 | **P0-2 串联（必验，禁止因接线状态 skip）**：两表描述本应双命中；其一描述读取失败被投影成 `missing` 但健康态＝`read_failed` → 门闩 deny（不可判定），不得单命中放行；query／explain 零执行。P0-2 未接线时用同构直读夹具仍须跑通本条 | 夹具（F-R2-06） |
| SC-26 | **必验，禁止因接线状态 skip**：可见候选 `description` 原文含不可见表名字面时：对象级集合仍合规；SC **不得**因文本侧信道失败；与 D15／P0-2 D4b 一致；未接线时同构直读夹具仍须跑通 | 单测（F-R2-07） |

### 7.1 因 O 未闭合而不能关闭的 SC

| O 项 | 阻塞的 SC |
|---|---|
| O1（确认载体互斥未决） | SC-07 主路径；SC-17 中依赖具体载体字段名的用例（**用户参与证据通道与 O1 正交，反例清单仍可测**） |
| O2（read_source） | SC-21 |
| O3′（未断言 source 的边角） | 无强制阻塞 SC；不得倒写 D10／§4.3 P1 |
| O5（词表资产） | 无；首期 §4.1 纯文本＋CJK n-gram 可测 |
| O6（allow-list 形态扩展） | 无首期 SC；双连接同名由 SC-16 在身份层覆盖 |

全部 SC **未执行**。本条收口不表示可上线。**本稿不宣称终稿确权，不授权实现。**

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 无 begin 静默放行事故路径 | D10／§4.3 P1／SC-15；禁止 empty→continue 与 terms 覆盖 |
| 短名确认串门（双连接同名） | D5／§5 身份分离；SC-16 |
| 多引用冲突／未知 filter 被丢弃后放行 | §4.5／acl.collect* 修订／SC-16 |
| 拒绝后立即自填／nonce 回传冒充确认 | §4.4 层 B／SC-17；宿主 attested；generation 绑定快照 |
| O1／O2 被默认执行 | 开放决策守卫；伪代码互斥待决；§7.1 |
| 与 P0-1 双重拒绝混淆 | D8 四态表；`caliber_binding_unresolved` 不冒充本门闩 |
| 业务词过宽误伤 | ≥2 才拦；CJK n-gram 有界；确认后放行；SC-06／SC-20 |
| 只上 instructions 被当成完工 | D1／闭口：双层同批才收口 |
| 候选泄漏／五项失败冒充「可用候选」／假 allow-list | D14／§4.7／SC-08／SC-18 |
| explain 漏挂 | §6.1／SC-04／SC-23 |
| 描述读取失败吞成 missing | D12／§4.6／SC-25 |
| 全文无受限名与原文透传冲突 | D15／SC-13／SC-26 |
| instructions 双源漂移 | D13／SC-01／SC-02／SC-22 |

> **开放决策守卫**见 §4 表下注释（2026-11-08）。

---

## 9. 关联

- 清单：P0-3；串联 P0-1（口径／BindingSession）、P0-2（`description` 投影）
- Plan：`docs/plans/lucy-20261107-source-ambiguity-gate-plan.md`
- Codex 评审：`docs/reviews/2026-11-08-source-ambiguity-gate-codex-review.md`
- 既有模块：`source-ambiguity.ts`（字段级保留）、`query-guardrails.ts`、`question-experience.ts`、`caliber-binding-session.ts`、`mcp-proxy.ts`

---

## 10. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.5（状态镜像） | 2026-11-13 | 实现已合入（`c1043fae`／`91a9dfc3`）；独立复审 **BLOCK**（宿主确认可被 Agent Bearer 自证；描述单文件读失败 fail-open 等）。现值改「实现已合入；复审 BLOCK；待修」；**不表示可上线**。评审见 [implementation-review](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md) |
| v0.5-draft | 2026-11-08 | Codex R3（BLOCK；major 4）修订：**F-R2-03** §4.4 拆载体（O1）与宿主 attested **用户参与证据**＋核验路径；明确禁止 Agent 自述／Agent 可写提交记录／拒绝 nonce 回传冒充确认（SC-17）；**F-R2-04** §4.5 授权修订 `acl.collect*`，未知 filter／order_by 保留进 unresolved 并 deny（SC-16 `ghost.amount`）；**F-R2-05** §4.7／D14 五项失败对象不得进 `availableCandidates`／「可用候选」文案，与 usableTargets 一致（SC-18）；**F-R2-06** SC-25／SC-26 必验、禁止接线状态 skip（D12）。O1／O2 仍互斥待决。状态：冻结落地；未授权实现；终稿未确权 |
| v0.4-draft | 2026-11-08 | Codex R2（BLOCK）修订：**F-R2-01**…**F-R2-07**（见该版说明）。状态：冻结落地；未授权实现；终稿未确权 |
| v0.3-draft | 2026-11-08 | Codex R1（BLOCK）修订：**F-01**–**F-11**（见该版说明）。状态：冻结落地；未授权实现；终稿未确权 |
| v0.2-draft | 2026-11-07 | 第 1 轮形式／事实性评审修订：候选短名与白名单对齐；异常 fallback 取证 |
| v0.1-draft | 2026-11-07 | 初稿 |
