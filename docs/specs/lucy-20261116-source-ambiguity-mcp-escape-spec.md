# 表级歧义门闩：纯 MCP 逃生与拒绝载荷持久修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.3**（Codex 过程对抗收束；**R2-F＋R4 已闭合**；实现进行中） |
| 日期 / 目标版本 | 2026-11-16／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无 |
| 功能编号 / 优先级 | 清单 **P1-35**；需求池 **REQ-030-056**／**P1**（P0-3／REQ-030-024 伴生持久修复；**不入核心分母**） |
| 状态 | **v0.3；R2-F＋R4 已闭合（2026-11-16）；实现已合入；ESCAPE UAT INDEX＝PASS（cursor-sag-escape-retest）；GAP-UAT-P0-3-ESCAPE 已关。≠ D5／功能合同收口 ≠ 可上线** |
| 授权边界 | R2-F＋R4 已闭合（2026-11-16）。授权范围＝本 Spec／Plan 实现、测试与复审修复；**不**表示可上线。 |
| 决策来源 | 客户 WorkBuddy 报障；错题 [`2026-11-16-source-ambiguity-gate-deadlock`](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；评估 [`2026-11-16-source-ambiguity-gate-availability-assessment`](../reviews/2026-11-16-source-ambiguity-gate-availability-assessment.md)；UAT [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) 基线 FAIL；委托人确认「持久修复、非临时应付」；Codex R1／R2 [`inbox/2026-11-16-p1-35-codex-r1.txt`](../../inbox/2026-11-16-p1-35-codex-r1.txt)／[`inbox/2026-11-16-p1-35-codex-r2.txt`](../../inbox/2026-11-16-p1-35-codex-r2.txt) |
| 父合同 | [P0-3 表级歧义门闩 Spec v0.5](lucy-20261107-source-ambiguity-gate-spec.md)（REQ-030-024）。本条**修订**父合同中导致纯 MCP 死路的条款；未声明修订处仍以父 Spec 为准 |
| 配套 Plan | [lucy-20261116-source-ambiguity-mcp-escape-plan.md](../plans/lucy-20261116-source-ambiguity-mcp-escape-plan.md) |
| 测试台 | [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)（INDEX 基线 **FAIL**；本条出口须翻绿）；父套件 [`UAT-SUITE-SOURCE-AMBIGUITY`](../qa/uat/suites/source-ambiguity-gate/suite.md)：**SAG-01 用例合同须按 §5.2 修订**后再验「未形成 D1 钉选仍拦」 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「端到端三台账」「第一性原理：主路径可用性优先」 |
| 评审记录 | [Codex 过程对抗](../reviews/2026-11-16-source-ambiguity-mcp-escape-codex-review.md)（进行中；**≠ R2-F／R4**） |

## 闭口层级

- 层级：功能合同
- 本条承诺：纯 MCP 客户端在「旅程业务词多表命中、但请求已钉唯一可见 Source Identity」时**可以查数成交**；拒绝时不得结构性给出「缺少真实 Schema 证据」假元数据故障且空 `usableTargets`；**不以** kill switch／只改问法／只改 instructions 作为本条出口；保留「未形成 D1 钉选的多表歧义须先确认」；宿主 confirm HTTP 的伪造门（父 SC-17 之 403 部分）不得削弱
- 本条出口：SC-E01–SC-E19（见 **§5**）；相关 vitest；收紧后 `UAT-SAG-ESC-01` 翻绿且 ESC-02／03 不回退；修订后的父 UAT-SAG-01 仍 deny；套件 INDEX＝**PASS**（必做全绿；本条**不**以 PASS WITH GAP 关 GAP）
- 不在本条出口：放弃多表先问主防线；改 ACL／行权限语义；客户现场出包；以环境变量旁路作为正式修复；WebUI 新页面必做（可选增强）；消灭「命中集内错表钉选」的全部误报风险（见 D9 已接受残余）
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **Source Pin Allow（来源钉选放行）**：请求经 `collectCanonicalSourceKeys` 得到**恰好一个** ACL 可见 Source Identity，且满足 §4.2 D1 条件时，表级歧义门闩**放行**该次 `lucy_query`／`lucy_explain_query`，**不**要求 person 宿主 attested。中文主称「来源钉选放行」。钉选放行**不是**「MCP 可达确认」的同义词。
- **MCP-reachable confirmation（MCP 可达确认）**：与候选快照同代、且不依赖 `actorKind=person`＋WebUI-only 宿主头的**显式确认**路径。本波 **O1＝不做**；正式主路径是钉选放行，不是参数确认。

Forbidden:

- 把本条写成「关闭表级歧义门闩」或「kill switch 即修复」。
- 把「缺少真实 Schema 证据」继续当作可见已发布表在探测健康时的默认拒绝文案。
- 用 Agent 空口自证绕过 person 宿主 confirm **HTTP API** 的安全门（父 SC-17 之 403 仍成立）。
- 把「钉选放行」表述成「已完成用户参与确认」。

落位：语义层／MCP 查数门禁；延续父 Spec 术语分区登记。实现前若新增用户可见中文主称，补术语标准或本小节即可。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- `webui/docs/00-product-terminology-standard.md`
- `docs/specs/lucy-20261107-source-ambiguity-gate-spec.md`（父）
- `docs/specs/lucy-20261107-question-type-caliber-binding-spec.md`（BindingSession 串联不变）

### What This Change Follows

- [ ] 拒绝／放行形状沿用既有 Proxy 结构化结果，不发明第二套错误 JSON。
- [ ] 无新 WebUI 营销面；可选宿主 confirm 增强不挡本条 MCP 主路径出口。
- [ ] 修复文案走 `buildRepairClosure`；禁止误导性「Schema 不可判定」作为探测健康时的默认全员拒绝原因。

### Exceptions (If Any)

- 本条修订父 Spec「限定名不豁免」的**部分**适用范围（见 D1／D2）；须在 SC 中固定正反例，避免误读为全面取消错表拦截。
- 本条**显式收窄**父「查数成交须用户参与证据」范围（见 D9）；不得再声称完整父 SC-17／D11 语义不变。

### Follow-up Needed

- 父 Spec 头部状态行增加「修订指针」镜像（本条收口后）。
- 评估材料方向 B 的「全面跳过」**不采纳**；本条 D1 为**收窄后的钉选放行**。

---

## 1. 问题（已核实）

| 项 | 内容 |
|---|---|
| 现象 | WorkBuddy／纯 MCP：`lucy_query` 一律或高频 `source_ambiguity_gate`；候选全员「缺少真实 Schema 证据，无法判定」；`usableTargets=[]`；catalog／read_source 正常；已写限定表仍拦；宿主 confirm 需 person＋attestation，工具面不可达 |
| 根因 | 父 Spec：触发只看旅程词命中 ≥2；请求钉表不参与触发；放行依赖宿主 attested；实现上 `buildRepairEvidenceForGate` 硬编码 `schemaExists=null` |
| 漏检 | UAT 必做只验「拦得住」；放行通道可选且 BLOCKED 仍记功能合同已收口 |
| 定性 | **设计＋验收口径缺陷导致的可用性事故**，非「某日升级收紧」；本机 ESC-01／02／03 与客户拒绝形态同构 |

---

## 2. 设计决策（Normative）

| ID | 裁定 | 状态 |
|---|---|---|
| **D1** | **来源钉选放行（主修复）**：在父门闩本将因词命中 ≥2 而 deny 之前（及 D3 例外路径），若 `collectCanonicalSourceKeys` 成功且 `keys.length===1`，记该身份为 `S`，且 `S` 对调用者 ACL **可见**，且（`termHits.hits.length < 2` **或** `S ∈ termHits.hits`）→ **本门闩 allow**（继续后续口径／ACL／上游）。若 `keys.length===1` 但 `termHits.hits.length≥2` 且 `S ∉ termHits.hits` → **仍 deny**（集外钉选拦截）。若 `keys.length≠1` 或有 unresolved → 不走本放行 | **冻结（委托人 2026-11-16）** |
| **D2** | **修订父「限定名不豁免」**：父 D4／§4.5「请求引用不参与是否触发」对 **D1 钉选放行**让位；其余多引用／未钉选情形仍按父合同触发 | **冻结** |
| **D3** | **never_begun＋单钉选**：父 §4.3 P1 `context_missing`（无 begin 且已断言 source）在 **D1 条件满足**时**不**再强制 deny。**词源**：`never_begun` 时不读取旅程文本；`termHits.hits` 视为**空集**（不得伪造命中）。因此 D1 在 never_begun 下仅凭「唯一可见钉选」放行。无钉选、多钉选、unresolved、或钉选不满足 D1 → **仍** `context_missing`（不得落入「命中＜2 即 allow」旁路） | **冻结** |
| **D4** | **MCP 可达**：D1 即为正式 MCP 逃生主路径，**不**再把 person＋`x-lucy-host-attestation` 宿主 HTTP 当作查数成交的唯一前提。宿主 confirm API **可保留**作 UI 增强 | **冻结** |
| **D5** | **五项证据真接线（拒绝载荷）**：见 §4.4；禁止对探测健康且 sourceMap 已收录的可见候选默认 `schemaExists=null` 并刷「缺少真实 Schema 证据」 | **冻结** |
| **D6** | **明确非目标**：kill switch／环境变量旁路**不得**作为本条功能合同出口；只改 instructions／客户问法**不得**作为出口；不得为逃生而删除多表先问硬门闩 | **冻结** |
| **D7** | **父子串联**：`begun_bound`＋committed 仍跳过本门闩（父 D8）；`lost_or_conflict` 仍 `caliber_binding_unresolved`；O2 仍＝`lucy_read_source` 不纳入；放行后仍受未知 filter／order_by、字段护栏、ACL／行权限约束 | **冻结** |
| **D8** | **测试台**：本条功能合同出口绑定 ESCAPE 套件 INDEX＝**PASS**（ESC-01／02／03 必做全绿）；修订后父 SAG-01 回归必做；历史 SAG-01 跑次保留为对照，**不**再作为现行「未钉选仍拦」合同 | **冻结** |
| **D9** | **安全边界收窄（显式）**：承认 D1 允许 Agent 在 `termHits` **集内**自选唯一钉选成交，**无**用户参与证据。父 D5／D7／D11「仅 attested 确认可放行查数」及父 SC-17 中「拒绝后无用户参与不得成交」条款，对 **D1 钉选放行路径**让位。父 SC-17 **保留范围**＝非 person／缺 attestation 调用宿主 confirm **HTTP** → **403**。集内错表误报＝**已接受残余风险**；缓解＝`S∈termHits`、instructions、Eval／P0-6 另线——**不得**再写「SC-17 完整语义不变」 | **冻结（回应 Codex F-01）** |
| **O1** | 是否另增 `sourceConfirmationKey` 工具参数 | **闭合＝本波不做**（2026-11-16）；D1 不依赖 O1 |
| **O2** | 五项探测失败时是否降级「仅可见性＋callable」进 usableTargets | **闭合＝否**；不可探测则诚实 `catalog_unreliable`／探测失败 detail，非假 Schema 文案 |

> **开放决策守卫**：O1／O2 已闭合如上。**评审通过 ≠ R2-F ≠ R4**。

---

## 3. 与父 Spec 的修订关系

| 父条款 | 本条动作 | 新预期（摘要） |
|---|---|---|
| D4／§4.1「≥2 命中即触发」 | **保留**为默认；D1 在触发判定后、deny 前插入钉选放行 | 未形成 D1 仍 deny |
| §4.5「请求引用不参与是否触发」 | **修订** | D1 用请求引用集合判定钉选放行 |
| §4.3 P1 `context_missing` | **修订** | D1 满足时 never_begun 可 allow；否则仍 context_missing |
| D5／D7／D11／§4.4「用户参与证据才放行」 | **修订（D9）** | 查数主路径＝D1；attested 降为可选 UI |
| SC-17 全文 | **拆分** | HTTP 403 **保留**；「拒绝后无用户参与不得成交」对 D1 **让位** |
| D14／§4.7 五项证据 | **补实现债（D5）** | 更严于现网短表名／`partial` 当 done；见 §4.4 |
| SC-03 | **保留语义** | 未形成 D1 钉选 → deny（测试合同改步骤，见 §5.2） |
| SC-05 | **修订** | 钉选∈命中集 → **allow** |
| SC-15 | **修订** | never_begun＋单钉选可见 → **allow** |
| SC-10／16／18／19／24／25 | **保留** | 放行后仍验；拒绝零上游；五项失败不进 usable（SC-E15…E18） |

---

## 4. 核心流程

### 4.1 互斥优先级（Normative）

按序唯一命中；前者成立则不得落入后者：

1. BindingSession `lost_or_conflict` → `caliber_binding_unresolved`
2. BindingSession `begun_bound`＋committed 本门闩 skip（父 D8）
3. **目录／catalog／描述读取健康裁定**（与是否 begun **无关**）失败 → 父对应 deny（零执行；**不得**被空 hits 覆盖）
4. `collected.unresolved.length > 0` → `unresolved_source_refs`
5. **D1 钉选放行**（含 never_begun；词源见 D3）→ allow
6. `journeyState === never_begun` → `context_missing`（D1 未满足时；**禁止**再因 `hits<2` allow）
7. `termHits.hits.length < 2` → allow
8. 否则 → `source_ambiguity_gate`＋§4.4 真实 repair 证据

`lucy_query` 与 `lucy_explain_query` 共用本表；拒绝分支均须上游／explain 成功体执行计数＝0（SC-E15）。

**词源 vs 健康（Normative）**：`never_begun` 只决定「不读旅程文本 → hits 为空」；**不**等于「目录健康＝ok」。健康裁定必须在构造空 hits **之前或并行、且独立于 hits** 完成；健康失败时禁止进入 D1 allow。

### 4.2 伪代码

```text
function checkSourceAmbiguityGate_vEscape(input):
  if binding.lost_or_conflict: return deny(caliber_binding_unresolved)
  if binding.begun_bound_and_committed: return allow  // skip gate

  catalogHealth = assessCatalogHealth(...)  // 独立于旅程；父 §4.1 分态
  if catalogHealth.kind in {catalog_unreliable, description_unreadable, ...}:
    return deny(parent_catalog_state)  // 零执行；不得被空 hits 覆盖

  collected = collectCanonicalSourceKeys(tool, args)

  if journey.never_begun:
    termHits = { hits: [] }  // 仅「无旅程词」；健康已在上方裁定
  else:
    termHits = matchVisibleSources(journeyText, catalogHealth, ...)

  if collected.unresolved.length > 0:
    return deny(unresolved_source_refs)

  if collected.keys.length == 1:
    S = collected.keys[0]
    if visible(S) and (termHits.hits.length < 2 or S in termHits.hits):
      return allow  // D1（含 never_begun）

  if journey.never_begun:
    return deny(context_missing)  // D3：D1 未满足不得旁路

  if termHits.hits.length < 2:
    return allow

  return deny(source_ambiguity_gate, candidates, repairEvidenceWired)
```

### 4.3 钉选放行后仍生效的约束

D1 allow **只**解除本门闩。随后仍须：

- 未知／幽灵 `filter`／`order_by` → 父 SC-16 拒绝（零上游）
- 字段护栏、口径失效、ACL、行权限 → 既有门禁
- 跨连接同名短表 → 以完整 Source Identity 为准；不得因短名误放行集外表

### 4.4 五项证据装配（D5，Normative）

| 证据项 | 权威读取入口 | 键 | 失败值 | 进 usableTargets |
|---|---|---|---|---|
| schemaExists | sourceMap／与 catalog 同源只读探测（完整身份） | 完整 Source Identity | 探测整体不可用 → `null`；未收录 → false／rejected | 仅 `true` |
| semanticCompletion | 语义层 completion 状态 | 完整身份 | 非 `done`（含 `partial`）→ 失败 | 仅 `done` |
| visible | ACL permissions | 完整身份 | false | 须 true |
| callable | 既有 callable 判定 | 完整身份 | false | 须 true |
| argsShape | **相对本次** `args` 校验（度量／维度／filter／order 字段是否相对该候选合法） | 完整身份＋本次 args | 不合法 → rejected | 须合法 |

调用链：`mcp-proxy` 在构造 gate 输入时**必须**传入 sourceMap 可靠性标志、按完整身份索引的探测结果、以及本次 `args`（不得再写「若需」）。`buildRepairEvidenceForGate` 签名须能接收上述输入；禁止默认全体 `schemaExists=null`。

复用现网 `collectRepairEvidence` 时须**抬严**到本表：禁止短表名关联；禁止 `partial` 当 compiled／done；禁止「目标有任意度量」代替相对本次 args 校验。探测禁止真实取数。

**三类拒绝夹具（Normative）**：

| 夹具 | 条件 | usableTargets | 文案／下一步 |
|---|---|---|---|
| H1 健康成功 | 探测通路可用，且**至少一个**候选五项全真 | **必须非空**；含该候选完整身份 | 禁止假 Schema 刷屏；见 SC-E07／E08 |
| H2 健康全拒 | 探测通路可用，但候选均因 completion≠done／argsShape／callable 等**合法失败** | **允许空** | 逐候选 `rejected` 写明五项中哪项失败；禁止假 Schema 唯一原因 |
| F1 探测失败 | schema／目录探测整体不可用 | 允许空；`schemaExists` 可 null | `detail`／`factualError`／`repair.text`＝探测失败类；下一步＝稍后重试或待目录恢复；**不得**暗示「钉选即可立刻过 §4.1 健康门」 |

**候选重试参数构造（Normative）**：当 deny 且 H1 给出 `usableTargets=[T,…]` 时，纯 MCP 重试请求＝保留原 `connectionId` 与业务意图字段，将 `measures`／`dimensions`／`filters`／`order_by` 中**所有 Source Identity 引用改写为仅 `T`**（删除或替换指向其他候选的引用；不得保留多身份）。`argsShape` 校验的是「相对候选 T 的重试形态」是否合法，**不是**要求原多身份 args 对每个候选都合法。示例：原 `measures=[orders.m, returns.m]` deny → usable 含 orders → 重试 `measures=[orders.m]`（完整身份限定）。

---

## 5. 验收矩阵（SC-E）

| ID | 断言 | 层级 |
|---|---|---|
| SC-E01 | begin 含「超市」＋**首次** `lucy_query` 唯一钉选 `measures=["superstore_orders.order_count"]` → **直接 allow**／成交或合法空结果（对齐收紧后 ESC-01；**禁止**以「先 deny 再重试／MCP 确认通道」作为本条 PASS） | 必做 |
| SC-E02 | 同 ESCAPE 夹具但**未形成** D1（`keys.length≠1`，见 §5.2）→ 仍 `source_ambiguity_gate`；query／explain 上游成功体计数＝0 | 必做 |
| SC-E03 | 窄意图单命中对照：首次 query **成交或合法空结果**（ESC-02；**禁止**「业务拒绝但非 ambiguity」凑绿） | 必做 |
| SC-E04 | 非 person `POST .../source-ambiguity/confirm` 仍 403（ESC-03；SC-17 HTTP 部分） | 必做 |
| SC-E05 | 钉选身份 ∉ termHits 且 termHits≥2 → 仍 deny | 必做 |
| SC-E06 | never_begun＋单钉选可见 → allow；never_begun＋双钉选／未钉选 → `context_missing`（非 ambiguity 旁路） | 必做 |
| SC-E07 | **H1／H2**：多表 deny 且探测通路可用时，对已收录可见候选，`rejected` **不得**全员仅 `schema_evidence_unavailable`；禁止假 Schema 刷屏 | 必做 |
| SC-E08 | **H1 专用**：前置「≥1 候选五项全真」→ `usableTargets` **非空**且可按 §4.4 重试规则改写为单身份请求；五项失败对象不得进 usable。**H2**（全员合法失败）允许空 usable，但须逐项失败原因 | 必做 |
| SC-E09 | **F1**：探测整体失败 → 允许 null／空 usable；诚实探测失败文案；下一步不得写成「仅钉选即可越过目录健康门」 | 必做 |
| SC-E10 | 修订后父 UAT-SAG-01：多表词＋未形成 D1 → deny、零上游（§5.2） | 必做 |
| SC-E11 | `lucy_read_source` 仍不纳入本门闩（父 O2） | 必做 |
| SC-E12 | vitest：D1／D3／D5／优先级表；Proxy 插入点对 query／explain 分支分别计数 | 必做 |
| SC-E13 | **D9 文档化行为**：多表 deny 后，Agent 立即以集内唯一钉选重试 → **allow**（无宿主 confirm）；证明主路径可达，非漏洞漏写 | 必做 |
| SC-E14 | deny 后立即钉选集外 → 仍 deny | 必做 |
| SC-E15 | D1 allow 后：未知 filter／order_by（父 SC-16 形）仍拒绝且零上游；ACL／行权限夹具仍生效 | 必做 |
| SC-E16 | `lucy_explain_query` 与 `lucy_query` 同优先级表；拒绝零执行、放行可解释 | 必做 |
| SC-E17 | `lint:spec-docs`；术语／索引；ESCAPE suite 回链本 Spec | 必做 |
| SC-E18 | `partial` completion、跨连接同名短表、错误字段／filter／order 不得因 D5 接线误进 usable | 必做 |
| SC-E19 | never_begun＋唯一可见钉选，但 catalog／描述健康失败 → **deny**（§4.1-3），零执行；不得因空 hits 走 D1 allow（query＋explain） | 必做 |

### 5.2 父 UAT-SAG-01 用例合同修订（Normative）

| 项 | 内容 |
|---|---|
| 历史 | 2026-11-13／14 跑次步骤＝begin「超市」＋`measures=["superstore_orders.order_count"]` → 当时 deny **PASS**。在 D1 下该步骤＝**钉选放行**，与 ESC-01 **同构**，不得再要求 deny |
| 现行合同 | SAG-01 改为：begin「超市」后，`lucy_query` **故意不形成** D1——推荐夹具：同一请求 `measures` **同时**引用 ≥2 个可见超市相关 Source Identity（如 `superstore_orders.order_count`＋`superstore_returns` 上存在的度量／或第二处完整身份引用），使 `keys.length≥2`；期望仍 `source_ambiguity_gate`、零成交 |
| 历史对照 | 旧步骤迁入 ESC-01（期望 allow）；旧跑次保留为 pre-D1 证据，INDEX／suite 注明「SAG-01 v2」 |
| Plan 约束 | **允许**为对齐本条而修订 cases／suite 文；禁止为迁就失败而把 ESC-01 改回「期望 deny」 |

---

## 6. 非目标与风险

| 风险 | 缓解 |
|---|---|
| Agent 在命中集内钉错表仍成交 | **D9 已接受**；`S∈termHits`；Eval／P0-6；不得假装已消灭 |
| 被误读为「关闭门闩」 | D6；修订后 SAG-01／SC-E02／E05 |
| 五项探测成本／KTX DESC 坑 | §4.4；禁止为探测发真实取数；对齐 P1-20 经验 |
| 只改文案假装 D5 | SC-E07／E08：**H1** 强制非空 usable；**H2** 可空但原因须齐全 |

---

## 7. 出口与状态

- **功能合同出口（P1-35 全量）**：SC-E01–SC-E19 证据关闭（含 D5 的 H1／H2／F1 与 SC-E07–09／E18／E19）＋ESCAPE INDEX＝**PASS**＋SAG-01 v2 回归 deny。**不以** PASS WITH GAP 关闭。
- **`GAP-UAT-P0-3-ESCAPE` 范围（逃生缺口）**：关闭条件＝收紧后 ESC-01／02／03 必做全绿且 INDEX＝**PASS**，另加 SAG-01 v2 deny。**关闭本 GAP ≠ D5 已证 ≠ P1-35 功能合同已收口**；D5 证据属功能合同出口，须另挂 vitest／UAT 拒绝载荷断言（SC-E07–09），不得用 GAP 关闭叙事代替。
- **R2-F／R4 未闭合前不得改运行代码。**
- 本条收口 ≠ 发布取证 ≠ 可上线。

## 变更

| 版本 | 内容 |
|---|---|
| v0.1-draft | 2026-11-16｜首落盘：D1–D8；委托人认可持久方向 |
| v0.2-draft | 2026-11-16｜Codex R1：D9；D3／§4.4；SAG-01 v2；O1／O2 闭合 |
| v0.3-draft | 2026-11-16｜Codex R2：健康与空 hits 分离；H1／H2／F1＋重试参数构造；ESC cases 收紧；GAP≠D5；SAG-02 期望拆分；R3＝PASS WITH GAP；R3-01 摘要措辞修正 |
