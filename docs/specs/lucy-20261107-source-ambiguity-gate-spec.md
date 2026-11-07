# 多表命中先问 + 表级歧义门闩 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-3**；需求池 **REQ-030-024** / **P0** |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。分批 Spec 已批准撰写；委托人裁定本阶段**暂不开工实现**。须过对抗式评审 + 开工前 O 项闭合 + **另授开发授权** 后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。现行阶段只接受评审与修订。实施须：§评审门禁 R1–R4（见功能清单池 §2.2）全部通过 |
| 决策来源 | 2026-11-06 CFO 误报事故 ＋ 误报防线 G2／G3：instructions 丢弃「问询范围确认」；字段歧义护栏对限定名错表零触发 |
| 需求来源 | [需求池 REQ-030-024](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.2–4.3](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-3](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：动态 role-aware instructions 合并多表先问条文 ＋ MCP Proxy 在 `lucy_query`（及约定的姊妹工具）前做表级歧义硬门禁。不改 KTX；不改 ACL 裁决口径 |
| 配套 Plan | [lucy-20261107-source-ambiguity-gate-plan.md](../plans/lucy-20261107-source-ambiguity-gate-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 与 P0-1（REQ-030-027）口径绑定：**024 选表，027 定口径**——有 Active Binding 时本门闩让位（见 D8）。与 P0-2 catalog 描述暴露串联：候选清单宜展示描述（若已接线）。既有字段级 `ambiguousFieldHint` 保留；本条新增 **source 级**门闩，不删除字段歧义路径 |

## 闭口层级

- 层级：功能合同
- 本条承诺：当一次查数请求所依据的业务词命中 **≥2 个 ACL 可见 source** 时，Proxy 在转发上游前 **stop**，返回经 `denialAllowList`／`buildRepairClosure` 裁剪的候选表清单（含各自度量覆盖摘要）；Agent 即使用限定名点了其中一张表，只要同词仍多表命中且未经确认，仍可被拦住。instructions 侧把「问询范围确认」扩展到多表命中并并入动态 role-aware 文本（不再整节丢弃）。
- 本条出口：SC-01–SC-14（见 §7）。instructions 装配断言；门禁纯函数／Proxy 单测；夹具证明歧义请求零上游执行；`lint:spec-docs` 通过。
- 不在本条出口：自动选表；跨角色推荐；新造白名单；改 ACL／行权限语义；仅改 instructions 不上 tool 门闩；口径集合强制（P0-1）；catalog 描述接线本身（P0-2）；镜像／上线。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Source Ambiguity Gate：协议拒绝码建议 `source_ambiguity_gate`，中文主称「表级歧义门闩」。业务词命中 ≥2 可见 source 时，在 `lucy_query` 前停止并要求显式确认。
- Multi-Source Ask-First：中文主称「多表命中先问」。instructions 层要求：多表都可能回答时先澄清再查；与指代／双意图的「问询范围确认」同族扩展。
- Ambiguity Candidate List：中文主称「歧义候选表清单」。门闩响应中的 ACL 裁剪候选（source 限定名 ＋ 度量覆盖摘要 ＋ 可选描述），不得含越权表。
- Source Confirmation：中文主称「选表确认」。解除门闩所需的显式信号（见 D5／O1）。

Forbidden:

- 把「表级歧义门闩」写成 ACL 拒绝——ACL 仍只管授权；本条是语义选表层。
- 把「多表命中先问」仅写成模型自觉、无 tool 硬拦——需求池写明 instructions 单独上线价值有限。
- 用「自动选表」「静默挑最高分表」作主行为。
- 新造平行于 `denialAllowList`／`buildRepairClosure` 的白名单通道。

落位：本条术语属 **语义层／MCP 查数门禁**，落术语标准 **§4.8「访问权限升级（Access Control Upgrade / AC-P0 + AC-P1 + AC-P1.5）」** 分区登记（实现前补标准条目）；用户可见拒绝文案用中文主称。⚠️ 术语标准存在**两个 `### 4.8`**（`:807`「MCP 调试台 / ACL 裁决可见性」、`:824`「访问权限升级」），本条按**后者**登记；标准内 §4.8 重号属**待消歧**事项（不在本条范围，另记）。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`（修复提示闭环／allow-list）
- `webui/docs/00-product-terminology-standard.md`
- `docs/specs/lucy-20261107-question-type-caliber-binding-spec.md`（串联：选表 vs 口径）

### What This Change Follows

- [ ] 拒绝响应形状沿用 Proxy 既有结构化拒绝（reason／failureDimension／repair closure），不发明第二套错误 JSON。
- [ ] 候选 source 名保持 `translate="no"` 语义。
- [ ] 修复文案走既有 `buildRepairClosure` 文本通道；不引入营销面或仪表盘卡片。
- [ ] instructions 变更保持 Markdown 章节可读，不堆砌 pill／stat。

### Exceptions (If Any)

- 无新 WebUI 页面；确认信号首期走 MCP 工具参数／问询旅程字段（见 D5）。

### Follow-up Needed

- 与 P0-1 Active Binding、P0-2 描述字段的组合联测用例（两／三 Spec 收口后）。
- Eval 跨表歧义用例属 P0-6，本条只提供运行时门禁合同。

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
| E4 | 安全裁剪闭环已存在：`denialAllowList`／`buildRepairClosure` | `webui/server/proxy/question-experience.ts:1027-1037`；需求池 REQ-030-024 非目标／硬约束 |
| E5 | 沟通实录：错表为有权表上的语义误报，非 ACL 越权 | 需求池事故定性；误报计划 G4 |

### 1.3 取证缺口（不得当事实）

- 客户现场「资产／收入／成本」等业务词与表的完整映射表：属 P0-6／内容工作，本条只定门禁机制。
- Agent 客户端是否展示 repair 文本：属客户端能力；本条保证工具响应携带 ACL 安全候选。

---

## 2. 目标

1. **Instructions**：将「问询范围确认」扩展为含「多表命中先问」，并 **并入动态 role-aware instructions**（有可见 source 时也能读到）。
2. **Tool gate**：业务词命中 ≥2 个可见 source 时，在 `lucy_query` 转发上游前 **stop**，返回 Ambiguity Candidate List（表 ＋ 度量覆盖摘要 ＋ 可选描述）。
3. **限定名错表仍可拦**：不得因字段已限定或 source 已写死而跳过 source 级歧义判定。
4. **安全**：候选必须经 `denialAllowList`／`buildRepairClosure`（或严格等价封装）；不新造白名单；不泄漏越权表。
5. **不自动选表**；不改 ACL 语义。
6. 与 P0-1 串联：本条解决选哪张表；口径绑定解决表上算什么。

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

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 双层同批：instructions（fail-open 建议）＋ tool gate（fail-closed 硬拦）。禁止只交付其中一层作为本条收口 | **冻结** |
| **D2** | Instructions：在 `webui/config/data-qa-instructions.md` 扩展「问询范围确认」至多表命中；并在 `mcp-proxy.ts` 动态拼装分支**显式插入**等价条文（修复 `:1838`／`:1907-1909` 丢弃问题）。条文须写明：多表可能命中时先澄清；**不得**再写「代理不实现任何选表门闩」——改为「工具面可能返回表级歧义拒绝，须按候选确认后重试」 | **冻结** |
| **D3** | 门禁点：`lucy_query` 必做；`lucy_explain_query` **同口径**（避免 explain 绕过选表）。`lucy_read_source` 首期 **不**拦（发现／阅读仍可用），见 O2 | **冻结 query／explain**；read_source 见 O2 |
| **D4** | 触发：从问询旅程 `intentSummary`＋可选 `question`（若无 begin，则从本请求可观测的业务词来源见 O3）提取业务词／短语；与可见 source 的 `sourceName`／`table`／（若 P0-2 已接线）`descriptionDb`/`descriptionAi`／度量名做命中。命中可见 source 数 **≥ 2** → 触发门闩 | **冻结阈值与信号源骨架**；词表／算法见 O3 |
| **D5** | 解除：显式选表确认后本旅程内对**该确认 source**放行。确认信号首期冻结为以下之一（实现只保留一种合同，见 O1）：① `lucy_begin_question`／旅程字段 `confirmedSource`（限定名）；或 ② `lucy_query` 可选 `sourceConfirmation: <qualifiedSource>` 且必须等于本请求解析出的 source。确认后仍受 ACL 与（若有）P0-1 Active Binding 约束 | **冻结「须显式确认」**；载体见 O1 |
| **D6** | 候选响应：`failureDimension` 归语义选表；reason 码 `source_ambiguity_gate`；中文主称「表级歧义／请先确认来源表」；`candidates[]` 含 `source` 限定名、`measures` 名称摘要（来自既有 schema 遍历，截断上限见 O4）、可选 `description*`；**全部**先经调用者 permissions 过滤，再 `denialAllowList` 约束可点名集合，文案经 `buildRepairClosure`（或以其 `usableTargets` 为唯一可引用集合） | **冻结** |
| **D7** | 与字段歧义关系：source 级门闩在 ACL 通过后、上游前执行；若同时存在字段歧义，可一并返回，但 **source 级 ≥2 时必须以 stop 为主**（不得只给字段 hint 却放行上游） | **冻结** |
| **D8** | 与 P0-1 串联：若问询旅程存在 **Active Binding**（口径绑定已唯一钉表），**跳过**本 source 歧义门闩（选表已由绑定完成）；随后仍走口径集合校验。无 Active Binding 时本门闩生效。两拒绝码不得混用：`source_ambiguity_gate` vs `caliber_binding_violation`／`caliber_binding_ambiguous` | **冻结** |
| **D9** | 不改 ACL；不把选表正确性写入 `access.yaml` | **冻结** |
| **O1** | 确认载体：旅程 `confirmedSource` vs query 参数 `sourceConfirmation`（或两者兼备时的优先级） | **开工前必答** |
| **O2** | `lucy_read_source` 是否纳入同门闩 | **开工前必答**；默认建议否 |
| **O3** | 无 `lucy_begin_question` 时业务词来源：仅 skip 门闩（与「要强制选表确认需 begin」对齐）vs 从 measures／filters 字面启发式抽取 | **开工前必答**；推荐与 P0-1 一致：**要硬拦须有 begin（或等价确认 API）**，否则仅 instructions 软约束——须在评审中明示，避免「无 begin 则门闩永不触发」的空洞 |
| **O4** | 度量覆盖摘要最大条数／截断策略 | **开工前可默认为 8**；可评审微调 |
| **O5** | 业务词命中是否使用可发布「歧义词 → 表」资产，或首期纯文本命中 source／描述 | **开工前必答**；首期建议纯文本＋描述，资产表可后置以免阻塞 |

---

## 5. 数据模型（Normative）

```ts
// 门闩拒绝载荷 — 示意（贴合既有 repair 形状，不另起炉灶）
{
  reason: "source_ambiguity_gate",
  failureDimension: "source_selection", // 或既有枚举之语义维扩展
  message: "表级歧义：请先确认来源表",
  candidates: Array<{
    source: string;          // 候选标识；形状见下方「候选 source 的形状」
    measures: string[];      // 截断后的度量名摘要
    descriptionDb?: string | null;
    descriptionAi?: string | null;
  }>,
  repair: ReturnType<typeof buildRepairClosure> // 或等价嵌入 text/usableTargets
}
```

**候选 `source` 的形状（本条必须写死，否则实现无从落笔）**：

- `denialAllowList({ connections, sources })` 的 `sources` 元素是
  **`source.sourceName || source.table`**（`webui/server/proxy/question-experience.ts:1033-1037`），
  **不含 connectionId／schema**。
- 而 ACL 侧的 `EffectiveSource` 是**四元组**
  `{ connectionId, schema, sourceName, table }`（`webui/server/proxy/acl.ts:752-757`）。
- ⇒ **两者形状不闭合**：`source.connectionId + "." + source.schema + "." + source.sourceName`
  这种「限定名」**不在** `denialAllowList.sources` 里，照 §5.1 原措辞实现就自相矛盾。
- **本条裁定**：`candidate.source` **＝ `denialAllowList` 输出的元素本身**
  （即 `sourceName || table` 字符串），**不做** connection.schema.source 拼接。
  候选来源仍从 `effectivePermissions.sources` 的四元组取（用于算 measures 摘要与描述），
  但**对外暴露的标识取白名单形态**，两侧天然可对齐。
- 若将来要改成 `connection.schema.source` 形态，那是**白名单通道扩展**，
  必须**显式声明并另取授权**（`denialAllowList` 是共享组件，改它影响面超出本条）。

候选构造规则：

1. 只纳入 `effectivePermissions.sources` 中命中业务词者。
2. 对外标识取 `denialAllowList({ connections, sources }).sources` 的元素形态
   （`sourceName || table`），不自行拼接限定名（见上）。
3. `buildRepairClosure` 的 candidate targets 只能来自上述集合；`availableCandidates` 同纪律。
4. 禁止把不可见表以「相似推荐」形式塞进 rejected／factualError 原文。

---

## 6. 核心流程（伪代码）

```text
# --- instructions 装配 ---
buildRoleAwareInstructions(identity):
  catalog := lucyCatalog(identity)
  skills := filterAccessibleSkills(...)
  if empty(catalog) and empty(skills):
    return fallbackIncludingAskFirstSection()  # today
  body := dynamicBodyWithoutAskFirst()         # today bug: drops section
  body := body + renderAskFirstSection(multiSource=true)  # NEW: always merge
  body := body + visibleScope(catalog)
  return body

# --- tool gate ---
on lucy_query | lucy_explain_query(args, identity, journey):
  aclDecision := acl.check(...)
  if aclDecision.denied: return aclDenial  # unchanged

  if journey.activeBinding != null:           # P0-1 series
    continue caliber binding checks          # skip this gate
    # ... then existing pipeline

  terms := resolveBusinessTerms(journey, args)  # per O3
  if terms is empty:
    continue existing pipeline               # soft-only via instructions

  hits := matchVisibleSources(terms, identity)  # ACL-visible only
  hits := enrichMeasuresAndDescriptions(hits)

  if len(hits) < 2:
    continue existing field-ambiguity / guardrails / upstream

  confirmed := journey.confirmedSource OR args.sourceConfirmation  # per O1
  if confirmed and confirmed in hits.sources and confirmed == resolveSource(args):
    continue existing pipeline  # disambiguated

  allow := denialAllowList(permissions)
  candidates := trim(hits, allow)             # no extras outside allow
  closure := buildRepairClosure({
    failureDimension: "source_selection",
    candidates: toRepairTargets(candidates),
    availableCandidates: allow.sources
  })
  return deny(source_ambiguity_gate, candidates, closure)  # NO upstream

# qualified wrong table: even if args.source is set and fields are dotted,
# still compute hits from terms; if ≥2 and not confirmed → deny (D7)
```

关键失败分支均须映射到 §7 SC。

---

## 7. 验收（SC-01–SC-14）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 动态 role-aware instructions（有可见 source 时）包含扩展后的「问询范围确认／多表命中先问」条文 | 单测字符串装配（对照今日 `mcp-proxy.ts:1838` 丢弃缺口） |
| SC-02 | fallback 空目录路径仍包含问询范围确认；两路径条文不互相矛盾 | 单测 |
| SC-03 | 业务词命中 ≥2 可见 source 且未确认 → `lucy_query` 返回 `source_ambiguity_gate`，上游执行计数 0 | 夹具上游计数 |
| SC-04 | 同条件对 `lucy_explain_query` 同等 stop | 夹具 |
| SC-05 | Agent 使用限定名／已选 source 但同词仍 ≥2 命中且未确认 → 仍 stop（限定名不豁免） | 单测（对照 `query-guardrails.ts:201` 旧行为） |
| SC-06 | 命中 0／1 个可见 source → 本门闩不触发，行为与基线一致 | 单测 |
| SC-07 | 确认信号生效后，对确认 source 的合规查询可过本门闩 | 单测 |
| SC-08 | 候选列表无越权表；点名集合 ⊆ `denialAllowList`；文案经 `buildRepairClosure` 纪律 | 单测（双角色） |
| SC-09 | 不存在第二套平行白名单模块；门禁代码路径调用既有 `denialAllowList`／`buildRepairClosure` | 静态／单测 spy |
| SC-10 | 有 Active Binding（P0-1）时跳过本门闩；错口径仍由口径绑定拒绝码处理 | 单测（可与 P0-1 夹具联立或 mock binding） |
| SC-11 | 无自动选表：门闩响应不把某一候选标为「已选定成交」 | 合同单测 |
| SC-12 | 候选含度量覆盖摘要（可截断）；若 P0-2 已接线则可含描述且仍经可见性裁剪 | 单测 |
| SC-13 | 拒绝文案含中文主称「表级歧义」或等价主称；无不可见表名 | 单测 |
| SC-14 | `lint:spec-docs` 对本 Spec／Plan 退出码 0；术语小节形状合规 | 门禁 |

全部 SC **未执行**。本条收口不表示可上线。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| O3 选「无 begin 不硬拦」导致门闩空洞 | 评审明示；Eval（P0-6）强制 begin；产品说明「要硬拦须 begin」 |

> **开放决策守卫（本条统一，2026-11-07）**：本条所有 **O 项（开工前必答）在闭合前不得实现对应分支**——缺省一律 fail-closed（该分支不实现、依赖它的 SC 保持未关闭、不得以「评审已通过」当作已闭合）。闭合须由**委托人（PM）**在**开发授权前**书面裁定，并回写本表 O 行的状态格；**评审通过 ≠ O 项闭合**；未闭合即开工的，视为越权实现。

| 与 P0-1 双重拒绝混淆 | D8 码表分离；有 binding 跳过本门闩 |
| 业务词过宽误伤探索性问询 | O5／O3 收紧；≥2 才拦；确认后放行 |
| 只上 instructions 被当成完工 | D1／闭口：双层同批才收口 |
| 候选泄漏 | SC-08／SC-09 硬绑 allow-list 闭环 |

---

## 9. 关联

- 清单：P0-3；串联 P0-1（口径）、P0-2（描述增强候选）
- Plan：`docs/plans/lucy-20261107-source-ambiguity-gate-plan.md`
- 既有模块：`source-ambiguity.ts`（字段级保留）、`query-guardrails.ts`、`question-experience.ts`
