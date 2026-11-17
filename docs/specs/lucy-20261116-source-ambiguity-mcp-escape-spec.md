# 表级歧义门闩：纯 MCP 逃生与拒绝载荷持久修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.4**（委托人 2026-11-16 夜明示免 Codex 终审、授权定稿与开发；O3 已闭合）。v0.3 已合入实现 |
| 日期 / 目标版本 | 2026-11-16／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无 |
| 功能编号 / 优先级 | 清单 **P1-35**；需求池 **REQ-030-056**／**P1**（P0-3／REQ-030-024 伴生持久修复；**不入核心分母**） |
| 状态 | **v0.4；委托人明示确权＋授权进入开发（2026-11-16 夜，免 Codex 终审）：选表歧义由强拦降为「放行＋披露＋审计」（D10–D15）；v0.4 已实现并全真复测，ESCAPE UAT INDEX＝PASS（R0／ESC-01～10，[v0.4 跑次](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)）；GAP-UAT-P0-3-ESCAPE 关闭。≠ D5／功能合同收口 ≠ 可上线** |
| 授权边界 | v0.3 范围已授权并合入。**v0.4（D10–D15）：委托人 2026-11-16 夜明示「不用 Codex 终审，授权定稿、开发」＝终稿确权＋开发授权**（仓库规则：无 Codex 时委托人明示确权）。授权范围＝v0.4 实现、测试、UAT 与文档镜像；**不**表示可上线。 |
| 决策来源 | 客户 WorkBuddy 报障；错题 [`2026-11-16-source-ambiguity-gate-deadlock`](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；评估 [`2026-11-16-source-ambiguity-gate-availability-assessment`](../reviews/2026-11-16-source-ambiguity-gate-availability-assessment.md)；UAT [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md) 基线 FAIL；委托人确认「持久修复、非临时应付」；Codex R1／R2 [`inbox/2026-11-16-p1-35-codex-r1.txt`](../../inbox/2026-11-16-p1-35-codex-r1.txt)／[`inbox/2026-11-16-p1-35-codex-r2.txt`](../../inbox/2026-11-16-p1-35-codex-r2.txt) |
| 父合同 | [P0-3 表级歧义门闩 Spec v0.5](lucy-20261107-source-ambiguity-gate-spec.md)（REQ-030-024）。本条**修订**父合同中导致纯 MCP 死路的条款；未声明修订处仍以父 Spec 为准 |
| 配套 Plan | [lucy-20261116-source-ambiguity-mcp-escape-plan.md](../plans/lucy-20261116-source-ambiguity-mcp-escape-plan.md) |
| 测试台 | [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)（INDEX 基线 **FAIL**；本条出口须翻绿）；父套件 [`UAT-SUITE-SOURCE-AMBIGUITY`](../qa/uat/suites/source-ambiguity-gate/suite.md)：**SAG-01 用例合同须按 §5.2 修订**后再验「未形成 D1 钉选仍拦」 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「端到端三台账」「第一性原理：主路径可用性优先」 |
| 评审记录 | [Codex 过程对抗](../reviews/2026-11-16-source-ambiguity-mcp-escape-codex-review.md)（v0.3 范围）；**v0.4 免 Codex，由委托人确权** |

## 闭口层级

- 层级：功能合同
- 本条承诺：纯 MCP 客户端在「旅程业务词多表命中、但请求已钉唯一可见 Source Identity」时**可以查数成交**；拒绝时不得结构性给出「缺少真实 Schema 证据」假元数据故障且空 `usableTargets`；**不以** kill switch／只改问法／只改 instructions 作为本条出口；保留「未形成 D1 钉选的多表歧义须先确认」；宿主 confirm HTTP 的伪造门（父 SC-17 之 403 部分）不得削弱
- 本条出口：SC-E01–SC-E19（见 **§5**）；相关 vitest；收紧后 `UAT-SAG-ESC-01` 翻绿且 ESC-02／03 不回退；修订后的父 UAT-SAG-01 仍 deny；套件 INDEX＝**PASS**（必做全绿；本条**不**以 PASS WITH GAP 关 GAP）
- **v0.4 定位修订（委托人 2026-11-16 夜）**：Lucy 用户是数据／商业／财务分析师等高强度用 Agent 消费数据的人；**选表歧义**由「强拦」降为「**放行＋披露＋审计**」（接受一定容错率，换主路径体验）。**硬线不放松**（ACL／行权限／字段暴露／口径绑定／未知引用／目录健康失败／宿主 confirm 403／跨连接）。容错必须**可度量**（审计记录；阈值先不定，只记录）。见 D10–D15、§4.5
- 不在本条出口：放弃多表先问主防线（**v0.4 起改为：不放弃硬线；选表歧义不再强拦，见 D10**）；改 ACL／行权限语义；客户现场出包；以环境变量旁路作为正式修复；WebUI 新页面必做（可选增强）；消灭「命中集内错表钉选」的全部误报风险（见 D9 已接受残余）
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **Source Pin Allow（来源钉选放行）**：请求经 `collectCanonicalSourceKeys` 得到**恰好一个** ACL 可见 Source Identity，且满足 §4.2 D1 条件时，表级歧义门闩**放行**该次 `lucy_query`／`lucy_explain_query`，**不**要求 person 宿主 attested。中文主称「来源钉选放行」。钉选放行**不是**「MCP 可达确认」的同义词。
- **放行并披露**（v0.4 D10／D13）：选表歧义不再强拦，放行该次查询并在 `answer_verifiability.sourceSelection` 披露所用来源；对应运行时指导里的用户可见主称。`status=tolerated` 与 `reason` 取值（`multi_hit_unconfirmed`／`pin_outside_hits`／`unjoined_multi_source`）是机器字段值，不是面向用户的中文主称。
- **集外钉选**：请求钉选的来源不在业务词命中集内（`pin_outside_hits`）。
- **未连通的多来源**：同连接多个来源之间没有被语义层已声明的 join 连成一个整体（`unjoined_multi_source`）。
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
| **D10** | **容错定位（v0.4）**：选表歧义（词命中≥2、钉选集外、多来源）**不再作为强拦理由**；改为「放行＋披露＋审计」。门闩只在**硬线**（D11）上 deny。本条**修订父 P0-3 的「强门禁」定位**（P0-3 状态不变，修订指针见父 Spec 头部）。D9 的残余风险范围随之扩大，缓解＝披露＋审计（D13／D14），**不得**写成「已消灭」 | **冻结（委托人 2026-11-16 夜）** |
| **D11** | **三档裁决**：①**放行**（无披露）；②**放行并披露**；③**拦截**（硬线，必须给 MCP 可达下一步）。归档见 §4.5。**硬线**＝未知／无法解析引用、目录／描述健康失败、跨连接多来源、来源数超上限、既有 ACL／行权限／字段暴露／口径绑定／宿主 confirm 403 | **冻结（委托人 2026-11-16 夜）** |
| **D12** | **join 连通放行（方向 B）**：同连接、全部可见、（`hits<2` 或全部 ∈ `termHits`）、且被语义层**已声明**的 `joins`（读 overlay `semantic-layer/<conn>/<table>.yaml` 与 `_schema/<schema>.yaml` 两处；`source=candidate` 的候选 join **不算**；**任一端声明即可**——对端无 yaml 也算；可经中间表**传递连通**）连成**一个连通整体** → 档①放行。**节点＝完整 Source Identity（`connectionId`＋`schema`＋`sourceName`）**：同名不同 schema 的表是两个节点；无 schema 限定的 `to` 视作与声明方同 schema，跨 schema 须显式写 `schema.table`。两端均未声明（如 demo 的 returns＋people，不含 orders）→ 落档② | **冻结（委托人 2026-11-16 夜）** |
| **D13** | **披露载体＝响应结构化字段**：在既有 `answer_verifiability` 内**加性**新增 `sourceSelection`（不发明第二套错误 JSON；不依赖 Agent 文本自觉）。字段至少：`status`（固定 `tolerated`）、`reason`（`multi_hit_unconfirmed`／`pin_outside_hits`／`unjoined_multi_source`）、`usedSources[]`（完整身份）、`termHits[]`（完整身份，若有）。档①**不带该字段**。**仅 `lucy_query` 成功响应携带**（`lucy_explain_query` 不产 `answer_verifiability`，档②只写审计）。`schema_version` 保持 `"1"`（加性字段） | **冻结（委托人 2026-11-16 夜）** |
| **D14** | **审计只记录不定阈值**：档②每次放行写审计事件（`reason`、`usedSources`、`termHits`、工具、会话、时间；**不含**取值与凭据）。存储＝状态目录 `.ktx-ui/source-ambiguity/tolerated-events.jsonl`（append-only，一行一事件；与 journey 同目录，免 sqlite 迁移）。**本波不设收紧阈值**；观察期满（建议 1 周）后由委托人另定，回写 Spec。无审计则容错不可度量，**不得**上线声称「已接受容错」 | **冻结（委托人 2026-11-16 夜）** |
| **D15** | **跨连接与来源数上限**：多来源跨连接 → 拦截；来源数 `>4`（草案值，**O3**）→ 拦截。拦截载荷须按 §4.4 给 usable 单来源改写（H1）或诚实说明 | **冻结（委托人 2026-11-16 夜）** |
| **O1** | 是否另增 `sourceConfirmationKey` 工具参数 | **闭合＝本波不做**（2026-11-16）；D1 不依赖 O1 |
| **O2** | 五项探测失败时是否降级「仅可见性＋callable」进 usableTargets | **闭合＝否**；不可探测则诚实 `catalog_unreliable`／探测失败 detail，非假 Schema 文案 |

| **O3** | 来源数上限＝**4**；连通＝**传递连通**；披露字段名＝**`sourceSelection`**；`schema_version` 不升 | **闭合（委托人 2026-11-16 夜授权定稿）** |

> **开放决策守卫**：O1／O2／O3 已闭合如上。**评审通过 ≠ R2-F ≠ R4**。

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
| **D4／§4.1 ≥2 命中即强拦（v0.4）** | **修订（D10）** | 命中≥2 不再 deny；按 §4.5 三档 |
| SC-E02／E05／E10／E14（v0.3） | **修订（D10）** | 多表／集外钉选从「deny」改「放行并披露」；仍 deny 的只有硬线 |
| 父 SAG-01 v2（多身份 deny） | **修订** | 夹具改为硬线（未知引用／跨连接／超上限）；见 §5.2 |
| SC-10／16／18／19／24／25 | **保留** | 放行后仍验；拒绝零上游；五项失败不进 usable（SC-E15…E18） |

---

## 4. 核心流程（伪代码）

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

**v0.4 修订（D10–D12）**：第 5–8 步改为按 §4.5 三档裁决；第 1–4 步（BindingSession、健康、unresolved）为**硬线，不变**；`never_begun` 且 **无任何钉选**（`keys.length==0`）仍 `context_missing`（请求本身未显式，不属选表歧义容错）。**`never_begun`＋多钉选（词源命中集为空＝无可比对象，视作无歧义）且已声明 join 连通＝档①，不披露、不写审计——委托人 2026-11-17 确权维持**：无业务词则「未经确认」无参照，披露的 `termHits` 恒空；若记为 tolerated 会以无歧义的正常查询稀释 D14 的容错率度量；硬线先于本条裁决。若日后要观察「未 begin 的连通多表」，另立只记审计、不进响应的计数，须另行授权。

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

> **v0.4 伪代码（取代下方 v0.3 第 5–8 步；硬线前缀不变）**
>
> ```text
> // 前缀：binding／健康／unresolved 同上（硬线，deny）
> keys = collected.keys
> if keys.length == 0:
>   return journey.never_begun ? deny(context_missing) : v0_3_behavior()  // 请求未显式，非容错范围；begun 无钉选仍由 explicit_table_required 另门处理
> if crossConnection(keys) or keys.length > CAP(=4): return deny(source_ambiguity_gate, repair=H1)  // D15
> if not all visible(keys): return deny(acl)               // 既有 ACL，不变
> inHits = all(k in termHits.hits for k in keys) or termHits.hits.length < 2
> connected = joinConnected(keys)                           // D12：语义层声明 joins，传递连通
> if keys.length == 1 and inHits: return allow()           // 档①：无披露字段
> if keys.length > 1 and connected and inHits: return allow()  // 档①
> // 其余＝选表歧义 → 容错
> reason = keys.length==1 ? pin_outside_hits : (connected ? multi_hit_unconfirmed : unjoined_multi_source)
> auditTolerated(reason, keys, termHits)                    // D14
> return allow(status=tolerated, reason=reason)             // D13 披露
> ```

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

### 4.5 支持矩阵（Normative；唯一正文）

> `data-qa-instructions.md` 只放简短版并指回本节；UAT 每行挂用例。「暂不支持」≠ 死路：拦截必须给 MCP 可达下一步（通常＝拆成单来源查询）。

| # | 场景 | 档位 | 判据 | SC-E | UAT |
|---|---|---|---|---|---|
| M1 | 单来源；词命中<2 或来源∈命中集 | ①放行 | D1 | E01／E03 | ESC-01／02／04／05 |
| M2 | never_begun＋单钉选 | ①放行 | D3 | E06 | ESC-06 |
| M3 | explain 与 query 同规则 | ①放行 | D7 | E16 | ESC-06 |
| M4 | 同连接多来源，全部∈命中集（或命中<2），语义层 join 传递连通 | ①放行 | D12 | E21／E22 | ESC-07 |
| M5 | 单来源但**∉命中集**（集外钉选） | ②放行并披露 `pin_outside_hits` | D10 | E24 | ESC-06 |
| M6 | 多来源，命中≥2，**join 未连通**（两端均未声明；对端无 yaml 不影响「任一端声明即连通」）；或同连接多来源但 join 连通而某来源∉命中集（M7） | ②放行并披露 `unjoined_multi_source`（未连通）／`multi_hit_unconfirmed`（连通但含集外来源）；上游自行拒绝时（如一对多聚合不安全）返回上游错误，不再套 `source_ambiguity_gate` | D10／D12 | E23／E30 | ESC-07 |
| M8 | 未知／无法解析引用（含幽灵 filter／order_by） | ③拦截 | 硬线 | E15 | ESC-05 |
| M9 | 目录／描述健康失败 | ③拦截 | 硬线（§4.1-3） | E19 | （vitest＋F1 文案） |
| M10 | 跨连接多来源 | ③拦截＋下一步＝按连接拆分 | D15 | E28 | ESC-10（夹具待造：第二连接） |
| M11 | 来源数＞上限（草案 4） | ③拦截＋H1 usable 单来源改写 | D15 | E29 | ESC-08 |
| M12 | 无任何钉选（`keys=0`） | ③`context_missing`／`explicit_table_required` | 请求未显式 | E06 | ESC-06 |
| M13 | 即席 SQL 手写 join／表名只在非限定表达式 | 按 ACL／`explicit_table_required` 既有裁决（本条不改） | — | — | — |

---

## 5. 验收矩阵（SC-E）

| ID | 断言 | 层级 |
|---|---|---|
| SC-E01 | begin 含「超市」＋**首次** `lucy_query` 唯一钉选 `measures=["superstore_orders.order_count"]` → **直接 allow**／成交或合法空结果（对齐收紧后 ESC-01；**禁止**以「先 deny 再重试／MCP 确认通道」作为本条 PASS） | 必做 |
| SC-E02 | 同 ESCAPE 夹具但**未形成** D1（`keys.length≠1`，见 §5.2）→ 仍 `source_ambiguity_gate`；query／explain 上游成功体计数＝0 | **〔v0.4 修订：见 E23／E28／E29；多来源不再一律 deny〕** 必做 |
| SC-E03 | 窄意图单命中对照：首次 query **成交或合法空结果**（ESC-02；**禁止**「业务拒绝但非 ambiguity」凑绿） | 必做 |
| SC-E04 | 非 person `POST .../source-ambiguity/confirm` 仍 403（ESC-03；SC-17 HTTP 部分） | 必做 |
| SC-E05 | 钉选身份 ∉ termHits 且 termHits≥2 → 仍 deny | **〔v0.4 取代：E24〕** 必做 |
| SC-E06 | never_begun＋单钉选可见 → allow；never_begun＋**未钉选**（`keys=0`）→ `context_missing`（非 ambiguity 旁路）。**〔v0.4 修订：never_begun＋双／多钉选不再 `context_missing`；词源命中集为空（视作无歧义），按 §4.5 三档裁决——已声明 join 连通→档①放行，未连通→档②放行＋披露＋审计 `unjoined_multi_source`；健康失败、未知引用、跨连接、超上限仍为硬线，先于本条裁决。见 §4.1 v0.4 修订句、M2／M12、SC-E21／E23〕** | 必做 |
| SC-E07 | **H1／H2**：多表 deny 且探测通路可用时，对已收录可见候选，`rejected` **不得**全员仅 `schema_evidence_unavailable`；禁止假 Schema 刷屏 | 必做 |
| SC-E08 | **H1 专用**：前置「≥1 候选五项全真」→ `usableTargets` **非空**且可按 §4.4 重试规则改写为单身份请求；五项失败对象不得进 usable。**H2**（全员合法失败）允许空 usable，但须逐项失败原因 | 必做 |
| SC-E09 | **F1**：探测整体失败 → 允许 null／空 usable；诚实探测失败文案；下一步不得写成「仅钉选即可越过目录健康门」 | 必做 |
| SC-E10 | 修订后父 UAT-SAG-01：多表词＋未形成 D1 → deny、零上游（§5.2） | **〔v0.4 修订：夹具改硬线，见 §5.2〕** 必做 |
| SC-E11 | `lucy_read_source` 仍不纳入本门闩（父 O2） | 必做 |
| SC-E12 | vitest：D1／D3／D5／优先级表；Proxy 插入点对 query／explain 分支分别计数 | 必做 |
| SC-E13 | **D9 文档化行为**：多表 deny 后，Agent 立即以集内唯一钉选重试 → **allow**（无宿主 confirm）；证明主路径可达，非漏洞漏写 | 必做 |
| SC-E14 | deny 后立即钉选集外 → 仍 deny | **〔v0.4 取代：E24〕** 必做 |
| SC-E15 | D1 allow 后：未知 filter／order_by（父 SC-16 形）仍拒绝且零上游；ACL／行权限夹具仍生效 | 必做 |
| SC-E16 | `lucy_explain_query` 与 `lucy_query` 同优先级表；拒绝零执行、放行可解释 | 必做 |
| SC-E17 | `lint:spec-docs`；术语／索引；ESCAPE suite 回链本 Spec | 必做 |
| SC-E18 | `partial` completion、跨连接同名短表、错误字段／filter／order 不得因 D5 接线误进 usable | 必做 |
| SC-E19 | never_begun＋唯一可见钉选，但 catalog／描述健康失败 → **deny**（§4.1-3），零执行；不得因空 hits 走 D1 allow（query＋explain） | 必做 |
| **SC-E20**（v0.4） | M1：与 SC-E01 同；响应**无** `tolerated` 披露 | 必做 |
| **SC-E21**（v0.4） | M4：begin「超市」＋`measures=[superstore_orders.order_count]`＋`dimensions=[{field:superstore_returns.returned}]`（orders 已声明 join→returns）→ 档① allow，响应无 `tolerated`（ESC-07） | 必做 |
| **SC-E22**（v0.4） | M4 传递连通：orders＋returns＋people（星型，经 orders）→ 档① allow | 必做 |
| **SC-E23**（v0.4） | M6：未连通多来源（夹具＝demo 的 `superstore_returns`＋`superstore_people`，二者互无声明 join、且 query 不含 orders）→ 档② allow＋`reason=unjoined_multi_source`；若上游拒绝，按上游错误，**不得**再套 `source_ambiguity_gate` | 必做 |
| **SC-E24**（v0.4） | M5：begin 命中 returns／people，钉选 orders → 档② allow＋`pin_outside_hits`（**取代 SC-E05／E14**） | 必做 |
| **SC-E25**（v0.4） | 披露载体：档②成功响应含 `answer_verifiability.sourceSelection{status=tolerated,reason,usedSources,termHits}`；档①不含 `tolerated`；与 Agent 文本无关 | 必做 |
| **SC-E26**（v0.4） | 审计：档②每次放行写一条审计事件（字段见 D14；不含取值／凭据）；档①不写；本波**无**阈值逻辑 | 必做 |
| **SC-E27**（v0.4） | 硬线回归：unresolved／健康失败／行权限／ACL／字段暴露／宿主 confirm 403 全部不回退（复用 E04／E15／E19） | 必做 |
| **SC-E28**（v0.4） | M10：跨连接多来源 → 拒绝；载荷下一步＝按连接拆分；零执行 | 必做 |
| **SC-E29**（v0.4） | M11：来源数＞上限 → 拒绝；`usableTargets` 非空且可改写为单来源（H1）；**夹具须自造 ≥5 个同词来源**（`uat_sag_*`，可写） | 必做 |
| **SC-E30**（v0.4） | 语义层仅**单端**声明 join 亦算连通（demo：orders 声明→returns／people，对端无 yaml 亦连通）；`source=candidate` 的 join 不算 | 必做 |

### 5.2 父 UAT-SAG-01 用例合同修订（Normative）

| 项 | 内容 |
|---|---|
| 历史 | 2026-11-13／14 跑次步骤＝begin「超市」＋`measures=["superstore_orders.order_count"]` → 当时 deny **PASS**。在 D1 下该步骤＝**钉选放行**，与 ESC-01 **同构**，不得再要求 deny |
| 现行合同 | SAG-01 改为：begin「超市」后，`lucy_query` **故意不形成** D1——推荐夹具：同一请求 `measures` **同时**引用 ≥2 个可见超市相关 Source Identity（如 `superstore_orders.order_count`＋`superstore_returns` 上存在的度量／或第二处完整身份引用），使 `keys.length≥2`；期望仍 `source_ambiguity_gate`、零成交 |
| 历史对照 | 旧步骤迁入 ESC-01（期望 allow）；旧跑次保留为 pre-D1 证据，INDEX／suite 注明「SAG-01 v2」 |
| Plan 约束 | **允许**为对齐本条而修订 cases／suite 文；禁止为迁就失败而把 ESC-01 改回「期望 deny」 |
| **v0.4 再修订** | SAG-01 的「多身份 measures→deny」在 D10／D12 下不再成立（orders＋returns 已声明 join＝档①）。**SAG-01 v3** 改为验**硬线仍拦**：`filters` 含幽灵 dotted 引用 → `unresolved_source_refs`；跨连接／超上限见 ESC-08／10。多表词本身不再作为 deny 夹具。历史 SAG-01／v2 跑次保留为 pre-v0.4 证据 |

---

## 6. 非目标与风险

| 风险 | 缓解 |
|---|---|
| Agent 在命中集内钉错表仍成交 | **D9 已接受**；`S∈termHits`；Eval／P0-6；不得假装已消灭 |
| 被误读为「关闭门闩」 | D6；硬线（D11）＋SC-E27／E28／E29 |
| **容错放大误选表（v0.4）** | D13 披露＋D14 审计；上游一对多聚合安全检查已兜底（demo 实测）；阈值观察期后定；**不得**宣称「选表风险已消灭」 |
| 披露字段破坏既有消费者 | 仅**加性**扩展 `answer_verifiability`；`schema_version` 是否升级由评审定（O3） |
| 传递连通过宽 | O3；上限 4；SC-E22／E30 固定正反例 |
| 五项探测成本／KTX DESC 坑 | §4.4；禁止为探测发真实取数；对齐 P1-20 经验 |
| 只改文案假装 D5 | SC-E07／E08：**H1** 强制非空 usable；**H2** 可空但原因须齐全 |

---

## 7. 出口与状态

- **功能合同出口（P1-35 全量）**：SC-E01–SC-E19 证据关闭（含 D5 的 H1／H2／F1 与 SC-E07–09／E18／E19）＋ESCAPE INDEX＝**PASS**＋SAG-01 v2 回归 deny。**不以** PASS WITH GAP 关闭。
- **`GAP-UAT-P0-3-ESCAPE` 范围（逃生缺口）**：关闭条件＝收紧后 ESC-01～08 必做全绿（v2 于 2026-11-16 夜升必做）且 INDEX＝**PASS**，另加 SAG-01 v2 deny；2026-11-16 夜 ESC-07／08 在 v0.3 FAIL 曾重开，v0.4 实现后 ESC-01～10 全绿（[v0.4 跑次](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-cursor-sag-escape-v04.md)），缺口已关闭。**关闭本 GAP ≠ D5 已证 ≠ P1-35 功能合同已收口**；D5 证据属功能合同出口，须另挂 vitest／UAT 拒绝载荷断言（SC-E07–09），不得用 GAP 关闭叙事代替。
- **v0.4 出口**：SC-E20–E30 证据关闭＋ESC-01～09 必做全绿（INDEX＝PASS）＋D14 审计到位。v0.4 已获委托人开发授权（2026-11-16 夜）；出口证据：vitest（tolerance／join-graph／gate／answer-verifiability）＋ESCAPE v0.4 跑次 28/28。
- **R2-F／R4 未闭合前不得改运行代码。**
- 本条收口 ≠ 发布取证 ≠ 可上线。

## 变更

| 版本 | 内容 |
|---|---|
| v0.1-draft | 2026-11-16｜首落盘：D1–D8；委托人认可持久方向 |
| v0.2-draft | 2026-11-16｜Codex R1：D9；D3／§4.4；SAG-01 v2；O1／O2 闭合 |
| v0.3-draft | 2026-11-16｜Codex R2：健康与空 hits 分离；H1／H2／F1＋重试参数构造；ESC cases 收紧；GAP≠D5；SAG-02 期望拆分；R3＝PASS WITH GAP；R3-01 摘要措辞修正 |
| v0.4-draft | 2026-11-16 夜｜全真复核 ce8610f7（ESC-07／08 FAIL）；委托人以「分析师群体通用性」升 v2 必做，并批准方向 B＋容错披露三档（选表歧义降为披露＋审计；披露载体＝响应字段；审计只记录）；新增 D10–D15、§4.5 支持矩阵、SC-E20–E30、O3；SC-E02／E05／E10／E14 修订；**待 Codex 终审与开发授权** |
| v0.4 | 2026-11-16 夜｜委托人明示免 Codex 终审、授权定稿与开发；O3 闭合（上限 4／传递连通／`sourceSelection`／`schema_version` 不升）；D12 补读 overlay＋manifest 两处 join 且排除 candidate、对端无 yaml 亦连通；D13 仅 `lucy_query` 带披露；D14 存储＝JSONL；SC-E23／E30 夹具按 demo 实测修正 |
| v0.4 实现 | 2026-11-16 夜｜按授权实现：`source-join-graph.ts`／`source-selection-tolerance.ts` 新增；门闩 keys≥1 走三档；`argsReferencesIdentity` 删除；`sourceSelection` 披露＋`tolerated-events.jsonl` 审计；跨连接／超上限拒绝 message 直写下一步；ASK_FIRST／data-qa-instructions 改「放行并披露」；UAT 夹具 `uat_sag_*`／`demo-mysql-b` 用后已还原；ESCAPE v0.4 跑次 PASS（观察：KTX 对未连通多来源必拒，M6 披露不可达，取证靠审计）；D13 `status` 固定 `tolerated` |
| v0.4 复核修订 | 2026-11-17｜代码审查（[P1-35／36／37 审查记录](../reviews/2026-11-17-p1-35-p1-36-p1-37-code-review.md)）后的文字与实现对齐，不改 D10–D15 决策：SC-E06 标注 v0.4 修订（never_begun＋多钉选按三档，与 §4.1 修订句／M2／M12 一致）；D12 补节点身份＝完整 Source Identity；§4.4 argsShape 的度量存在性按候选真实度量名核验（生产探针不再用通配）；Terminology Compliance 补登「放行并披露」「集外钉选」「未连通的多来源」；运行时指导与 `lucy_begin_question` 描述补列「无来源限定引用」拦截面，上限引用 `SOURCE_COUNT_CAP`；委托人 2026-11-17 确权 CR-01：`never_begun`＋连通多钉选维持档①（见 §4.1 v0.4 修订句） |
