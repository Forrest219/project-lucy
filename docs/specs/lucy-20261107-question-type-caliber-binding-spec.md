# 问题类型口径绑定 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-1**；需求池 **REQ-030-027** / **P0** |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。分批 Spec 已批准撰写；委托人裁定本阶段**暂不开工实现**。须过对抗式评审 + O1／O2 闭合 + **另授开发授权** 后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。现行阶段只接受评审与修订。实施须：§评审门禁 R1–R4（见功能清单池 §2.2）全部通过 |
| 决策来源 | 2026-11-06 CFO 误报事故 ＋ 2026-11-07 客户沟通实录（翊总／田总）：「固定口径，不再让 AI 自行加工」；手工改语义文件已复测通过 |
| 需求来源 | [需求池 REQ-030-027](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.9 G9](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-1](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：内容根发布资产 ＋ MCP Proxy 运行时门禁。不改 KTX 源码；不把语义裁判塞进 ACL |
| 配套 Plan | [lucy-20261107-question-type-caliber-binding-plan.md](../plans/lucy-20261107-question-type-caliber-binding-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 表级歧义门闩属 REQ-030-024／P0-3（选哪张表）；本条只管「命中绑定后不得自行加工口径」。Skill `prerequisites` 今日只作建议暴露（`mcp-proxy.ts` instructions 不输出 triggers／prerequisites.sources——见误报计划 R8）；本条把可发布绑定升级为**硬门禁**。ACL／行权限合同不改 |

## 闭口层级

- 层级：功能合同
- 本条承诺：运维可为「问题类型」发布**唯一表 + 固定口径**绑定；当一次问询旅程命中该绑定后，Agent 在该旅程内对 `lucy_query`／`lucy_explain_query` 的偏离（错表或越出口径集合）被 Proxy **本机拒绝且零上游执行**；未命中绑定的问询行为不变。
- 本条出口：SC-01–SC-14（见 §7）。纯函数／装载／Proxy 门禁自动化；夹具上游证明偏离请求零上游执行；`lint:spec-docs` 通过。
- 不在本条出口：浏览器作者面完整 UX（可为 YAML 先行）、表级多表先问门闩（P0-3）、答复可核对块（P0-4）、Eval 选表断言（P0-6）、客户现场五域全量绑定内容本身、镜像／部署／上线。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Question Type Binding：协议／资产名 `caliber_binding`，中文主称「问题类型口径绑定」。指人发布的声明式资产：问题类型（触发词／显式 id）→ **唯一 Source** + **固定口径集合**。
- Bound Caliber：中文主称「固定口径」。绑定内允许的 measures／dimensions／filters／segments／grain 约束集合；运行时不得由 Agent 另行拼装超出集合的口径。
- Active Binding：中文主称「生效绑定」。一次问询旅程（自 `lucy_begin_question` 至结算）内处于强制状态的那一条绑定。
- Caliber Binding Violation：拒绝码 `caliber_binding_violation`，中文主称「偏离固定口径」。命中生效绑定后查数参数违反 Bound Caliber。

Forbidden:

- 把「问题类型口径绑定」写成 ACL／行权限——那是授权层，本条是语义／口径层。
- 把「固定口径」写成模型 instructions 软约定——本条要求 Proxy 硬门禁。
- 把「生效绑定」写成跨问询持久全局状态——绑定作用域以问询旅程为界。
- 用「指标绑定」「自动口径推断」作主术语。

落位：本条术语属 **语义层／MCP 查数门禁**面，落术语标准 **§4.8（MCP 调试台 / ACL 裁决可见性）** 分区登记（实现前补标准条目）；用户可见拒绝文案用中文主称。⚠️ 术语标准存在**两个 `### 4.8`**（`:807`「MCP 调试台 / ACL 裁决可见性」、`:824`「访问权限升级」），本条按**前者**登记；标准内 §4.8 重号属**待消歧**事项（不在本条范围，另记）。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`（问询旅程／修复提示闭环）
- `webui/docs/00-product-terminology-standard.md`

### What This Change Follows

- [ ] 首期允许 **YAML 资产先行、无新导航页**；若后续加 WebUI 作者面，须另立 Spec 并补 IA／Design System。
- [ ] 拒绝响应形状沿用 Proxy 既有结构化拒绝（reason／failureDimension／可见对象），不发明第二套错误 JSON。
- [ ] 工具名、source 限定名保持 `translate="no"` 语义。
- [ ] 不引入仪表盘式卡片堆砌；本条无营销面。

### Exceptions (If Any)

- 首期无 WebUI 新页面：作者通过内容根 YAML + 既有发布工作台同步生效（若发布种类需扩展，见 D3）。

### Follow-up Needed

- WebUI 绑定编辑器、与 Skill 工作台的双向链接 UI → 另立 Spec。
- 与 P0-3 表级门闩的「触发词命中多绑定」交互联测 → 两 Spec 收口后的组合用例。

---

## 1. 背景与取证

### 1.1 事故与承诺

沟通实录确立：错表轴之外存在**独立口径轴**——即使用户有权访问某表，Agent 仍可自行加工 measure／filter／粒度／期间。止血路径是「语义层指定表 + 固定口径」，已用客户真实账号复测通过，但逐题手工、不可规模化。

### 1.2 现行缺口（已核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | 护栏只管字段歧义与用量，无「是否业务口径」校验 | `webui/server/proxy/query-guardrails.ts`；误报计划 G9 |
| E2 | Skill 可声明 `prerequisites.sources`／`measures`／`triggers`，但动态 instructions **不输出** triggers 与 prerequisites.sources | `skills/domains/asset_finance/oi-bridge.skill.md:9-22`；误报计划 R8；`mcp-proxy.ts` skill 摘要装配 |
| E3 | ACL 只答「有没有权」，不答「语义对不对」 | `webui/server/proxy/acl.ts` 裁决路径；误报计划 G4 |
| E4 | `lucy_begin_question` 已存在问询旅程锚点（`intentSummary` 必填），跳过不阻断查数 | `webui/server/proxy/mcp-proxy.ts` tool schema |

### 1.3 取证缺口（不得当事实）

- 客户现场已写死的「资产类」语义约束的确切 YAML 形状：不在本仓，未取证。
- KTX 是否消费自定义顶层键：未核实 → **绑定资产不得塞进 KTX overlay 顶层未约定键**（见 D2）。

---

## 2. 目标

1. 提供可发布的 **Question Type Binding** 资产：人定义、发布生效、版本随内容根。
2. 问询旅程可 **命中至多一条** 生效绑定（显式 id 或唯一触发匹配）。
3. 生效绑定期间，`lucy_query`／`lucy_explain_query` 必须遵守 Bound Caliber；偏离 → **本机拒绝、零上游执行**。
4. 未命中绑定：本条不改变任何查数行为。
5. 与 ACL／行权限正交：先 ACL，再口径绑定；绑定不得授予越权表。

---

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 运行时自动推断口径 | 沟通实录要求人定义；推断会回到玄学 |
| 把绑定塞进 ACL／access.yaml | 职责边界（G4） |
| 本条交付完整 WebUI 作者台 | 可 YAML 先行；UI 另立 |
| 替代 P0-3 表级门闩 | 选表轴另条；本条是口径轴 |
| 修改已发布数值定义／改 KTX | 只约束 Agent 入参集合 |
| 跨问询「记住上次口径」的用户记忆层 | 作用域=问询旅程 |

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 绑定是 **Lucy 内容根发布资产**，不是 ACL，不是 instructions 软文 | **冻结** |
| **D2** | 落盘路径：`caliber-bindings/<bindingId>.yaml`（内容根下新目录）。**不**写入 KTX overlay 未约定键。发布／索引是否扩展 `semanticKind`：见 **O1** | **冻结路径**；发布接线见 O1 |
| **D3** | 资产最小字段：`bindingId`、`title`、`triggers[]`、`source`（唯一 source 限定名）、`caliber`（`measures`／`dimensions`／`segments` 允许集；`filters` 允许字段集；可选 `requireMeasures`）、`status: draft\|published` | **冻结** |
| **D4** | 激活：① `lucy_begin_question` 可选参数 `caliberBindingId`；或 ② 对 `intentSummary`＋可选 `question` 做触发匹配且**恰好一条** published 绑定命中 → 写入本旅程 Active Binding。0 条→无强制；≥2 条→拒绝激活并返回候选 id／title（fail-closed 激活，不静默挑一条） | **冻结** |
| **D5** | Active Binding 绑定在问询旅程（与 `lucy_begin_question` 同一 turn／question 作用域）；旅程结算或无 begin 则无 Active Binding。本条**不**因跳过 begin 而全局禁查——与现网「begin 可选」相容；**要强制口径必须 begin（或后续授权的等价激活 API）** | **冻结** |
| **D6** | 门禁点：`lucy_query`、`lucy_explain_query`。校验顺序：ACL →（若有 Active Binding）口径集合 → 既有 guardrails／row-policy。偏离 → `caliber_binding_violation`，**不转发上游** | **冻结** |
| **D7** | 口径集合语义：请求的 source 必须等于绑定 `source`；measures／dimensions／segments 必须 ⊆ 允许集；若存在 `requireMeasures`，则必须 ⊇；filters 中出现的字段必须 ⊆ 允许字段集。**行权限注入的强制谓词不计入「Agent 自行加工」**，不触发本拒绝码。**「请求的 source」的解析规则（本条必须写死，否则无法判定）**：`lucy_query`／`lucy_explain_query` 的入参**没有 `source` 字段**（`webui/server/proxy/mcp-proxy.ts:957-1018` 的 `semanticQueryInputProperties` 只有 `connectionId`／`measures`／`dimensions`／`filters`／`segments`／`order_by`／`orderBy`／`limit`），所以「请求的 source」只能**从字段引用反推**：① 从 `measures[]`（字符串形 `source.measure` 或对象 `{name,expr}`）与 `dimensions[].field`／`filters[].field`／`segments[]` 的**源限定名前缀**（最后一个 `.` 之前的部分）取集合；② 集合**必须恰好等于**绑定 `source`（多 source 即越界）；③ **任一 measure 无 source 前缀**（如 `{expr,name}` 的自由表达式）→ 视为**越界**，拒绝（不猜它指向哪张表） | **冻结** |
| **D8** | Skill 可可选声明 `caliberBindingId` 指向本资产；本条不把 Skill `prerequisites` 自动升格为唯一硬门禁（避免无声明即全库锁死）。迁移路径：为关键 Skill 补 binding 文件 | **冻结** |
| **O1** | 发布工作台／reindex 是否将 `caliber-bindings/` 纳为第一类发布种类，或首期「随内容根文件存在即加载、靠整批同步生效」 | **开工前必答** |
| **O2** | 触发匹配算法：规范化小写后的子串命中 vs 分词；中文触发的最小长度 | **开工前必答** |
| **O3** | `filters` 是否允许绑定「固定等值」（必须带某 filter）还是仅「允许字段集」——首期 Spec 默认**仅允许字段集**；固定等值若需要升为 O3 扩展 | **首期默认冻结；扩展另议** |

> **开放决策守卫（本条统一，2026-11-07）**：本条所有 **O 项（开工前必答）在闭合前不得实现对应分支**——缺省一律 fail-closed（该分支不实现、依赖它的 SC 保持未关闭、不得以「评审已通过」当作已闭合）。闭合须由**委托人（PM）**在**开发授权前**书面裁定，并回写本表 O 行的状态格；**评审通过 ≠ O 项闭合**；未闭合即开工的，视为越权实现。


---

## 5. 数据模型（Normative）

```yaml
# caliber-bindings/asset_count.yaml  — 示意，非客户真值
bindingId: asset_count
title: 资产台数
status: published
triggers:
  - 资产台数
  - 资产的数量
  - 有多少台资产
source: mysql-aliyun.asset_finance.<bound_table>   # 唯一 Source 限定名
caliber:
  measures:
    - <bound_table>.<measure>
  dimensions: []          # 空数组 = 不允许任何 dimension
  segments: []
  filterFields:           # 允许出现在 filters[].field 的限定名
    - <bound_table>.company_code
  requireMeasures:        # 可选；若存在则请求必须包含
    - <bound_table>.<measure>
```

加载规则：

1. 仅 `status: published` 参与匹配与门禁。
2. `bindingId` 全局唯一；冲突 → 加载失败关闭（实例启动或热加载失败须可观测）。
3. `source` 必须是调用者 ACL 可见的 source。**两条路径分开**（与 §6 伪码、SC-03 对齐）：
   - **按业务词／触发匹配命中、但绑定的 source 对该调用者不可见** → 对该调用者视为**未命中**（不侧信道提示存在隐藏表）——与 catalog 描述裁剪同纪律；
   - **按显式 `bindingId` 命中、但绑定的 source 对该调用者不可见** → 返回 `invalid_or_invisible_binding`（显式指名要一个自己看不见的绑定，与「按词猜到」不同：前者是调用者主动指名，返回错误码不构成侧信道——错误码本身只说「这个绑定不可用」，不泄露其 source 是否存在）。
   ⚠️ 两条路径**必须显式区分**，否则实现者只能二选一，与 §5／§6／SC-03 三处不能同时成立。

---

## 6. 核心流程（伪代码）

```text
on lucy_begin_question(args, identity, journey):
  bindings := loadPublishedBindings()
  chosen := null
  if args.caliberBindingId:
    b := bindings.byId(args.caliberBindingId)
    if b is null OR not visible(b.source, identity):
      return error invalid_or_invisible_binding
    chosen := b
  else:
    hits := matchTriggers(args.intentSummary, args.question, bindings)
    hits := filterVisible(hits, identity)
    if len(hits) >= 2:
      return error caliber_binding_ambiguous(candidates=hits)
    if len(hits) == 1:
      chosen := hits[0]
  journey.activeBinding := chosen  # may be null
  persist begin_question as today
  return ok { activeBindingId: chosen?.bindingId ?? null }

on lucy_query | lucy_explain_query(args, identity, journey):
  aclDecision := acl.check(...)
  if aclDecision.denied: return aclDenial  # unchanged

  b := journey.activeBinding
  if b is null:
    continue existing pipeline  # 本条无动作

  # Bound source
  if resolveSource(args) != b.source:
    return deny(caliber_binding_violation, "偏离固定口径：Source 必须为绑定表",
                expected=b.source)  # NO upstream

  # Measures / dimensions / segments ⊆ allow-list
  if not subset(args.measures, b.caliber.measures): deny...
  if not subset(args.dimensions.fields, b.caliber.dimensions): deny...
  if not subset(args.segments, b.caliber.segments): deny...
  if b.caliber.requireMeasures and not superset(args.measures, b.caliber.requireMeasures):
    deny...

  # Agent filters' fields ⊆ filterFields；row-policy 注入字段跳过本检查
  agentFilterFields := fieldsOf(args.filters) minus rowPolicyInjectedFields
  if not subset(agentFilterFields, b.caliber.filterFields): deny...

  continue existing guardrails / row-policy / upstream
```

关键失败分支均须映射到 §7 SC。

---

## 7. 验收（SC-01–SC-14）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | published 绑定可被加载；draft 不参与匹配 | 单测 |
| SC-02 | `caliberBindingId` 显式激活成功并写入旅程 | Proxy 单测 |
| SC-03 | 显式 id 不可见／不存在 → 拒绝激活，无 Active Binding 泄漏 | 单测 |
| SC-04 | 触发唯一命中 → 激活 | 单测 |
| SC-05 | 触发 ≥2 命中 → `caliber_binding_ambiguous`，不静默挑选 | 单测 |
| SC-06 | 无命中 → Active Binding 为空，查数行为与基线一致 | 单测 |
| SC-07 | 有 Active Binding 时错 Source → `caliber_binding_violation` 且上游执行计数 0 | 夹具上游计数 |
| SC-08 | 越出 measures 允许集 → 同 SC-07 | 夹具 |
| SC-09 | 缺少 `requireMeasures` → 同 SC-07 | 夹具 |
| SC-10 | 合规请求（Source＋口径在集合内）→ 不因本条拒绝，可到达既有后续管道 | 单测 |
| SC-11 | 行权限注入字段不触发 filterFields 违规 | 单测 |
| SC-12 | 跳过 `lucy_begin_question` 时本条不施加绑定（与现网可选 begin 相容） | 单测 |
| SC-13 | 拒绝响应含中文主称「偏离固定口径」与 expected source／允许集摘要（无越权对象） | 单测 |
| SC-14 | `lint:spec-docs` 对本 Spec／Plan 退出码 0；术语小节形状合规 | 门禁 |

全部 SC **未执行**。本条收口不表示可上线。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 绑定过宽锁死探索性问询 | 仅命中后强制；未配置触发的问题不受影响 |
| 触发词误伤 | O2 闭合前不得实现；≥2 命中 fail-closed |
| 与 P0-3 双重拒绝码混淆 | 本条专用 `caliber_binding_violation`／`caliber_binding_ambiguous`；表歧义码归 P0-3 |
| 发布种类未接线导致绑定不生效 | O1 闭合；验收含「发布后加载」或「内容根热加载」明示路径 |

---

## 9. 关联

- 清单：P0-1；下一批 P0-2／P0-A；串联 P0-3
- Plan：`docs/plans/lucy-20261107-question-type-caliber-binding-plan.md`
