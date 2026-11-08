# 问题类型口径绑定 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.9**（已获开发授权；实现中） |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-1**；需求池 **REQ-030-027** / **P0** |
| 状态 | **v0.9，终稿已确权；O1／O2（R3）已闭合；开发授权（R4）已授予（委托人 2026-11-08：授权 Claude Code 实现、Cursor Agent 做 code review）**；实现进行中。本条不表示可上线 |
| 授权边界 | R2-F＋R3＋R4 已闭合（R4：2026-11-08）。授权范围＝本 Spec／Plan 实现与测试；**不**表示可上线／发布取证。实现由 Claude Code；Cursor Agent 做 code review。 |
| 决策来源 | 2026-11-06 CFO 误报事故 ＋ 2026-11-07 客户沟通实录（翊总／田总）：「固定口径，不再让 AI 自行加工」；手工改语义文件已复测通过 |
| 需求来源 | [需求池 REQ-030-027](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.9 G9](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-1](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：内容根发布资产 ＋ MCP Proxy 运行时门禁。不改 KTX 源码；不把语义裁判塞进 ACL |
| 配套 Plan | [lucy-20261107-question-type-caliber-binding-plan.md](../plans/lucy-20261107-question-type-caliber-binding-plan.md) |
| 评审记录 | [批次 R1](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[Codex 对抗式评审](../reviews/2026-11-07-question-type-caliber-binding-codex-review.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不吞并。** 表级歧义门闩属 REQ-030-024／P0-3（选哪张表）；本条只管「命中绑定后不得自行加工口径」。Skill `prerequisites` 今日只作建议暴露；**首期不解析 Skill 上的 binding 引用**（D8 延期）。ACL／行权限合同不改 |

## 闭口层级

- 层级：功能合同
- 本条承诺：运维可为「问题类型」发布**唯一表 + 固定口径**绑定；当一次问询旅程命中该绑定后，Agent 在该旅程内对 `lucy_query`／`lucy_explain_query` 的偏离（错表或越出口径集合）被 Proxy **本机拒绝且零上游执行**；未命中绑定的问询行为不变。
- 本条出口：SC-01–SC-30（见 §7；O1／O2 相关条目在委托人闭合前不得标关闭）。纯函数／装载／Proxy 门禁自动化；夹具上游证明偏离请求零上游执行；真实进程内局部存储故障注入（仅本条持久化边界）；`lint:spec-docs` 通过。
- 不在本条出口：浏览器作者面完整 UX（可为 YAML 先行）、表级多表先问门闩（P0-3）、答复可核对块（P0-4）、Eval 选表断言（P0-6）、客户现场五域全量绑定内容本身、Skill frontmatter 双向引用编辑、镜像／部署／上线。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Question Type Binding：协议／资产名 `caliber_binding`，中文主称「问题类型口径绑定」。指人发布的声明式资产：问题类型（触发词／显式 id）→ **唯一 Source** + **固定口径集合**。
- Bound Caliber：中文主称「固定口径」。绑定内允许的 measures／dimensions／filters／segments 约束集合（**首期不含 grain／granularity**，见 D7／D9）；运行时不得由 Agent 另行拼装超出集合的口径。
- Active Binding：中文主称「生效绑定」。一次问询旅程内处于强制状态的那一条绑定（权威存储见 D5）。
- Caliber Binding Violation：拒绝码 `caliber_binding_violation`，中文主称「偏离固定口径」。命中生效绑定后查数参数违反 Bound Caliber。
- Caliber Binding Unresolved：拒绝码 `caliber_binding_unresolved`，中文主称「口径绑定无法解析」。已开题且应有绑定，但权威作用域无法可靠解析（≠「未 begin」）。

Forbidden:

- 把「问题类型口径绑定」写成 ACL／行权限——那是授权层，本条是语义／口径层。
- 把「固定口径」写成模型 instructions 软约定——本条要求 Proxy 硬门禁。
- 把「生效绑定」写成跨问询持久全局状态——绑定作用域以问询旅程为界。
- 用「指标绑定」「自动口径推断」作主术语。
- 把审计 turn 低置信推断当作强制门禁状态源。

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
- [ ] 拒绝响应形状沿用 Proxy 既有结构化拒绝（reason／failureDimension／可见对象），不发明第二套错误 JSON；**拒绝载荷须经既有 deny allow-list 裁剪**（见 F-04／D10）。
- [ ] 工具名、source 限定名保持 `translate="no"` 语义。
- [ ] 不引入仪表盘式卡片堆砌；本条无营销面。

### Exceptions (If Any)

- 首期无 WebUI 新页面：作者通过内容根 YAML + 既有发布工作台同步生效（若发布种类需扩展，见 O1）。

### Follow-up Needed

- WebUI 绑定编辑器、与 Skill 工作台的双向链接 UI → 另立 Spec（含原 D8）。
- 与 P0-3 表级门闩的「触发词命中多绑定」交互联测 → 两 Spec 收口后的组合用例；**来源身份规范化必须与 P0-3 共用同一合同**（D7）。

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
| E5 | `lucy_query`／`lucy_explain_query` 入参**无 `source` 字段**；有 `connectionId`、measures／dimensions／filters／segments／`order_by`｜`orderBy`；dimension 可带 `granularity`；filters／measures 含字符串与对象形 | `mcp-proxy.ts:958-1018` `semanticQueryInputProperties` |
| E6 | 行权限在 ACL 通过后注入 `forced_filters` 并前插 `filters[]` | `mcp-proxy.ts:4180-4184`；`row-policy.ts` |
| E7 | begin 先写 conversation turn、再 budget.begin、再 supersede；写失败／预算失败有独立失败分支 | `mcp-proxy.ts:4761-4865` |
| E8 | 发布扫描现行只覆盖 semantic-layer 与 wiki；内容镜像无 `caliber-bindings/` | `publish-workbench-state.ts`；`content-mirror.ts` |

### 1.3 取证缺口（不得当事实）

- 客户现场已写死的「资产类」语义约束的确切 YAML 形状：不在本仓，未取证。
- KTX 是否消费自定义顶层键：未核实 → **绑定资产不得塞进 KTX overlay 顶层未约定键**（见 D2）。

---

## 2. 目标

1. 提供可发布的 **Question Type Binding** 资产：人定义、发布生效、版本随内容根。
2. 问询旅程可 **命中至多一条** 生效绑定（显式 id 或唯一触发匹配）。
3. 生效绑定期间，`lucy_query`／`lucy_explain_query` 必须遵守 Bound Caliber；偏离 → **本机拒绝、零上游执行**。
4. 未命中绑定：本条不改变任何查数行为。
5. 与 ACL／行权限正交：先 ACL，再口径绑定（在行权限注入**之前**），绑定不得授予越权表。

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
| 首期强制 grain／granularity | 见 D9；避免空头承诺 |
| 首期解析／保存 Skill.`caliberBindingId` | 见 D8 延期 |

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 绑定是 **Lucy 内容根发布资产**，不是 ACL，不是 instructions 软文 | **冻结** |
| **D2** | 落盘路径：`caliber-bindings/<bindingId>.yaml`（内容根下新目录）。**不**写入 KTX overlay 未约定键。发布／索引是否扩展 `semanticKind`：见 **O1** | **冻结路径**；发布接线见 O1 |
| **D3** | 资产最小字段：`bindingId`、`title`、`triggers[]`、`connectionId`（钉死连接）、`source`（logical `sourceName`）、`caliber`（`measures`／`dimensions`／`segments`／`filterFields`；可选 `requireMeasures`）、`status: draft\|published`。**不含 grain**。加载／发布校验时将 `(connectionId, source)` 解析为不可变 **`boundKey: CanonicalSourceKey`**；解析失败 → 资产拒绝加载（fail-closed） | **冻结**（2026-11-07 委托人裁定） |
| **D4** | 激活：① `lucy_begin_question` 可选参数 `caliberBindingId`；或 ② 对 `intentSummary`＋可选 `question` 做触发匹配且**恰好一条** published 绑定命中 → 写入本旅程 Active Binding。0 条→无强制；≥2 条→拒绝激活并返回候选 id／title（fail-closed 激活，不静默挑一条） | **冻结** |
| **D5** | **BindingSession**（不得用审计低置信 turn 当门禁源）：键＝`identityKey`＋`sessionId`。成功 begin 写入 `{turnId, generation, commitPhase, bindingId\|null, boundKey?, caliberSnapshot?}`。**在途强制内容＝begin 时深拷贝的 `caliberSnapshot`＋`boundKey`**，查询**禁止**按 bindingId 热读最新资产。四态：`never_begun`／`begun_no_hit`／`begun_bound`／`lost_or_conflict`（含 `commitPhase≠committed`、指针损坏、代次冲突、过期应有却缺失、重启读到未完成提交）。`lost_or_conflict` → **`caliber_binding_unresolved`，禁止当 null 放行**。预算关闭／legacy 不改变四态。跨 Token／会话不共享 | **冻结**（2026-11-07 委托人裁定） |
| **D6** | 门禁点：`lucy_query`、`lucy_explain_query`。校验顺序：**ACL →（若有可解析 Active Binding）口径集合（基于注入前原始 Agent 入参＋快照）→ 行权限注入／既有 guardrails**。偏离 → `caliber_binding_violation`，**不转发上游**。`lucy_explain_query` 须断言本条拒绝码与「未进入后续本地 explain 成功体」 | **冻结** |
| **D7** | **Source 比较（钉死目标）**：① 资产侧：`boundKey` 在加载／激活时由资产 `connectionId`＋`source` 经 sourceMap 解析并**固化**；查询**不得**用请求 `connectionId` 重解析绑定侧。② 请求侧：只解析请求参数得到 `reqKeys`（采集键集＝ACL 对 query／explain 的同集：`sourceName`｜`source`｜`table` 等别名、`measures`、`dimensions[].field`、`filters`／`segments`／`order_by`｜`orderBy`，以及 D12 列出的禁键若出现则先按 D12 处理）。③ `reqKeys` 必须**恰好等于** `{boundKey}`；跨连接同名 logical source → violation（SC-07）。④ `{expr,name}` measure、无法解析的字符串 filter → violation。⑤ 允许集 ⊆／`requireMeasures` ⊇ 在规范化字段键上比较，**对照 `caliberSnapshot`**。⑥ 注入前快照；行权限按谓词来源排除。⑦ 禁止字符串前缀拼接代替 CanonicalSourceKey | **冻结**（2026-11-07 委托人裁定） |
| **D8** | Skill 可选声明 `caliberBindingId`：**首期延期** | **延期（非首期出口）** |
| **D9** | **grain／granularity 不在首期 Bound Caliber** | **冻结（首期排除）** |
| **D10** | **响应时可见性**：按**当前** ACL 裁剪拒绝载荷；不可见则不回显 source／允许集对象 | **冻结** |
| **D11** | **共同提交与恢复**：锁覆盖 ① turn 持久化 → ②（可选）budget.begin → ③ supersede → ④ 写 BindingSession（含 `commitPhase` 与快照）。持久化字段 `commitPhase: preparing\|committed`；仅 ④ 成功后标 `committed`。重启：非 `committed` → `lost_or_conflict`。预算已提交但 ④ 失败／进程中断同此。失败 begin（激活错／①②失败）→ **旧 BindingSession 不变**。查询只读 `commitPhase=committed` 的已发布快照（读侧发布点＝④ 完成） | **冻结**（2026-11-07 委托人裁定） |
| **D12** | **额外参数 fail-closed（首期）**：除工具契约主路径已列且本条显式校验的键外，请求若出现 `where`／`having`／`groupBy`／`group_by`／`joins`／`join`／`sort`／`sorts`（以及未来新增、未写入本条允许集映射的同族旁路键）→ **一律 `caliber_binding_violation`**，不做逐字段映射。`filters`／`order_by`｜`orderBy`／`dimensions`／`segments`／`measures` 仍走 D7 允许集。完整语义映射若需要，另开修订升版 | **冻结**（2026-11-07 委托人裁定） |
| **O1** | 发布／加载种类与接线。**冻结裁定**见 **§4.1**（Codex O1／O2 R1–R3 PASS；委托人 2026-11-07 全采纳闭合包） | **已闭合**（2026-11-07 委托人裁定） |
| **O2** | 触发匹配算法。**冻结裁定**见 **§4.2**（同上） | **已闭合**（2026-11-07 委托人裁定） |
| **O3** | `filters` 是否允许绑定「固定等值」（必须带某 filter）还是仅「允许字段集」——首期 Spec 默认**仅允许字段集**；固定等值若需要升为 O3 扩展 | **首期默认冻结；扩展另议** |

> **开放决策守卫（本条统一，2026-11-07）**：O 项在闭合前不得实现对应分支。**O1／O2 已于 2026-11-07 由委托人书面闭合**（选项「1」＝全采纳 Codex R3 闭合包）；**O3 扩展仍另议**。闭合 ≠ 开发授权；未获 R4 即改运行代码，视为越权实现。

### 4.1 O1 冻结裁定 — 发布／加载（委托人 2026-11-07 闭合）

1. **语义种类（first-class）**：`caliber-bindings/<bindingId>.yaml` 纳入一等发布种类 **`caliber_binding`**，参与工作台待发布扫描、内容摘要、消费快照、删除差异、发布记录与生效基线。由 **Lucy 直接消费权威内容根的提交快照**。**首期不**加入 KTX 内容镜像名单、**不**从项目根 sibling 旧副本回退读取、**不以** KTX reindex／catalog reload／daemon 重启成功代替绑定加载成功。**禁止**把绑定字段镜像进 KTX overlay／manifest 未约定键。
2. **成功生效点（新 begin 可见）**：在同一发布协调窗口内：完整读取候选并保存解析字节／摘要 → 拒绝扫描错误／截断 → 校验 schema、唯一 `bindingId`、O2 触发词、唯一 `boundKey`（记录 sourceMap 版本）→ 构建完整不可变候选注册表 → 整批其他适用消费者成功且内容／依赖无漂移 → 在与 begin 提交**互斥**的区间内：① **原子持久化**指向完整注册表快照与消费回执的 **`activeGeneration` 提交凭据**（候选 prepared **不**构成 committed）→ ② 切换内存注册表 generation → ③ 以同一凭据完成基线及终态登记。① 完成前不得放行新 begin；任一步失败保留未决，**不得**以旧注册表恢复新 begin 服务。该 **generation 切换（在凭据已提交之后）**＝新旅程可见的生效点。提交凭据至少关联 `releaseId`／`attemptId`／注册表 `generation`／消费摘要／sourceMap 版本／完整消费回执。**注册表 generation** 与 **BindingSession generation** 分别命名、分别解释。禁止逐文件热替换运行中注册表。
3. **失败合同**：解析／读取／重复 id／sourceMap 失败／内容漂移／持久化／热加载失败 → 结构化错误＋运维可见状态；**不得**转换为「空注册表放行」。重载失败、同步未决或生效记录不一致期间：**新** `lucy_begin_question` → **`caliber_binding_unresolved`**，**不修改**旧 BindingSession；**禁止**继续用旧资产注册表为新旅程匹配。已有 `committed` BindingSession 的 query／explain 继续遵守 D5 快照＋当前 ACL。失败不得宣称已回滚已经发生的 KTX 索引变化。
4. **撤销／删除／下线**：成功同步后 draft／缺失资产不进入新注册表；显式 id 不可再激活，触发不再命中。直接改盘／降 draft／删除后，新 begin 须核验当前绑定内容与已提交版本；差异或无法核验 → 先拒绝 begin，直至成功同步（不得靠 watcher／缓存过期窗口继续命中旧资产）。有效空目录与读取失败必须区分；删到零条只能经成功同步提交为空注册表。
5. **在途与并发**：「新请求不可命中」＝**新 begin 的激活**；旧旅程续查仍用 begin 时 `boundKey`／`caliberSnapshot`，禁止热读资产。begin 准备阶段记录注册表 `generation`。进入任何 D11 写入前：须在 **`registryActivationCommitExclusion`**（与注册表激活提交互斥；**不仅** `identityKey`＋`sessionId` 锁）内同时复核：准备阶段 generation、**当前绑定文件集合＋内容摘要＋ sourceMap 解析依赖的完整核验**（`verifyCurrentBindingContentAndDependencies`）。`registry.usable` **不得**仅表示上次加载成功；扫描错误、截断、依赖读取／解析失败、与已提交版本不符、同步未决 → 均不可用。sourceMap 核验**不得**把缓存命中、last-known-good 回退或跳过损坏文件视为本次核验成功。失败 → `caliber_binding_unresolved`，旧 BindingSession 不变；**禁止**撤销后／改盘后提交旧选择。本检查只约束新 begin，不得迁入旧旅程 query／explain（D5）。
6. **启动与恢复**：恢复以持久化 **`activeGeneration` 提交凭据**为权威：凭据已提交且引用完整 → 恢复同一 generation，并幂等补齐未完成登记；只有 prepared、凭据缺失或引用不完整 → 拒绝新 begin。不得仅凭 KTX 成功补写绑定 committed；不得把恢复解释为回滚 KTX。不把当前作者目录自动视为已发布。无历史且能证明未配置绑定 → 可空注册表；有候选但无提交证据／恢复不确定 → 拒绝新 begin。
7. **与整批同步关系**：首期沿用整批同步，不引入按绑定单独自动生效。绑定单独变更也走该流程；混合批次任一适用消费者失败 → 不得宣称整批成功。绑定加载失败不得借 KTX 成功推进绑定基线；KTX 失败也不得先激活候选绑定。所有推进含绑定路径消费基线的入口（含启动补偿）执行同一合同。
8. **加载校验**：`(connectionId, source)` → `boundKey`；失败 → 该资产拒绝进入 published 候选。`status≠published` → 不参与触发与显式激活成功路径。

### 4.2 O2 冻结裁定 — 触发匹配（委托人 2026-11-07 闭合）

1. **算法**：确定性**规范化字面子串**匹配；**不**采用分词、正则、模糊匹配或语义推断。
2. **规范化函数（Normative；唯一）**：
   ```ts
   N(s) = s.normalize("NFKC")
           .toLowerCase()
           .replace(/\p{White_Space}+/gu, " ")
           .trim()
   ```
   大小写转换**固定**采用 ECMAScript `String.prototype.toLowerCase()`；**不**采用 Unicode full casefold，**不**采用 locale-sensitive 转换。对 trigger、`intentSummary`、可选 `question` 使用同一 `N`。保留内部标点；不做简繁转换、同义词、停用词删除或否定识别。
3. **分别匹配，禁止跨字段拼接**：
   ```text
   bindingHit(b) := ∃ t ∈ normalizedTriggers(b):
     N(intentSummary).includes(t) OR N(question ?? "").includes(t)
   ```
   **禁止**先拼接两字段再匹配（避免 `资产`+`台数` 伪造成 `资产台数`）。
4. **触发词校验**：每个条目必须为字符串；`N(t)` 后至少含 **4 个 Unicode 字母或数字码点**（`\p{L}`｜`\p{N}`，按码点计；纯中文即至少四字；空白／标点不计长度）。中英文同一门槛。非法触发词 → **候选发布失败**，不得静默丢弃。同绑定内规范化后重复词去重。`triggers: []` → 仅支持显式 `caliberBindingId` 激活。
5. **命中计数（与 D4 一致）**：仅扫描 published 且通过加载校验的绑定的 `triggers`（**不**扫 title／bindingId／描述）。先命中 → 再按当前 ACL 排除不可见 → 按 `bindingId` 去重后计数：0 → `begun_no_hit`；1 → 可激活；≥2 → `caliber_binding_ambiguous`（只回可见候选；不按最长词／词频／顺序择一；不改旧 Session）。
6. **显式 `caliberBindingId`**：优先于触发；不回退触发匹配；仍受 O1 注册表可见性与 D3 约束。
7. **已知边界**：子串不保证理解否定、引用或英文词边界；此类输入仍严格按上述规则。短词场景用显式 id 或更完整触发短语。

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
connectionId: mysql-aliyun          # 钉死连接；加载时与 source 合成 boundKey
source: asset_finance.fact_asset_count
caliber:
  measures:
    - asset_finance.fact_asset_count.asset_count
  dimensions: []
  segments: []
  filterFields:
    - asset_finance.fact_asset_count.company_code
  requireMeasures:
    - asset_finance.fact_asset_count.asset_count
```

**规范等值示例（Normative）** — 假设加载后 `boundKey` 已固定为连接 `mysql-aliyun` 上该 source 的 CanonicalSourceKey：

| 请求片段 | 请求 connectionId | 结果 |
|---|---|---|
| 合规 measures／filters ⊆ 快照 | `mysql-aliyun` | 通过（若其余 ⊆） |
| 同上，另 `order_by: [{field:"other_src.x"}]` | `mysql-aliyun` | **violation**（多 key） |
| `measures: [{expr:"sum(1)", name:"x"}]` | 任意 | **violation** |
| 合规 measures，但 connectionId＝另一连接（即使同名 logical source） | 另一连接 | **violation**（reqKeys≠{boundKey}） |
| 出现 `where`／`groupBy`／`joins`／`sort` 等 D12 禁键 | 任意 | **violation**（D12） |

加载规则：

1. 仅 `status: published` 参与匹配与门禁。
2. `bindingId` 全局唯一；冲突 → 加载失败关闭（实例启动或热加载失败须可观测；**不得**把失败当成「无绑定」而放行本应强制的旅程——见 O1 失败合同）。
3. `connectionId`＋`source` 必须能解析为唯一 `boundKey`；调用者可见性按 `boundKey` 判断。**两条路径分开**：
   - **触发匹配命中、但对调用者不可见** → 视为**未命中**（无侧信道）；
   - **显式 `bindingId` 命中、但对调用者不可见** → `invalid_or_invisible_binding`。

---

## 6. 核心流程（伪代码）

```text
# ---- begin：prepare → 互斥临界区 commit ----
on lucy_begin_question(args, identity, session):
  bindings := loadPublishedBindings()          # 加载失败 → 可观测错误；见 O1
  chosen := null
  activateError := null
  if args.caliberBindingId:
    b := bindings.byId(args.caliberBindingId)
    if b is null OR not visible(b.source, identity):
      activateError := invalid_or_invisible_binding
    else:
      chosen := b
  else:
    hits := matchTriggers(args.intentSummary, args.question, bindings)  # O2
    hits := filterVisible(hits, identity)      # 隐藏绑定不进入 hits（无侧信道）
    if len(hits) >= 2:
      activateError := caliber_binding_ambiguous(candidates=publicIds(hits))
    else if len(hits) == 1:
      chosen := hits[0]

  if activateError != null:
    return error activateError                 # 不改 BindingSession

  regGen := bindings.generation                # O1：准备阶段记录注册表代次

  with registryActivationCommitExclusion:      # 与注册表激活提交互斥（O1）
    with lock(identityKey, sessionId):         # D11
      proof := verifyCurrentBindingContentAndDependencies(bindings)
      if registry.generation != regGen
         OR registry.syncPending
         OR not proof.complete
         OR not proof.matchesCommitted:
        return error caliber_binding_unresolved  # 禁止提交旧选择；旧 Session 不变
      turnId := newTurnId()
      writeBindingSession({ ..., commitPhase: preparing, registryGeneration: regGen })
      if not persistConversationTurn(turnId, ...):
        clearPreparingOrKeepPrior()
        return error persist_failed
      if budgetEnabled:
        begun := budget.beginQuestion(...)
        if not begun.ok:
          clearPreparingOrKeepPrior()
          return error budget_failed
      supersedeTurnPointers(turnId)
      snapshot := chosen == null ? null : deepCopy({
        bindingId: chosen.bindingId,
        boundKey: chosen.boundKey,               # 资产加载时已固化
        caliber: chosen.caliber
      })
      commitBindingSession({
        turnId,
        bindingId: chosen?.bindingId ?? null,
        boundKey: snapshot?.boundKey,
        caliberSnapshot: snapshot?.caliber,
        generation: nextGeneration(),
        commitPhase: committed
      })                                         # 失败／中断 → lost_or_conflict
  return ok { activeBindingId: chosen?.bindingId ?? null, turnId }

# ---- query / explain：ACL → caliber(on snapshot) → inject → rest ----
on lucy_query | lucy_explain_query(args, identity, requestMeta):
  rawArgs := snapshot(args)
  aclDecision := acl.check(...)
  if aclDecision.denied: return aclDenial

  sess := readCommittedBindingSession(identityKey, sessionId)  # 只读 committed
  match sess.state:
    case never_begun | begun_no_hit:
      goto after_caliber
    case lost_or_conflict | commitPhase != committed:
      return deny(caliber_binding_unresolved)
    case begun_bound:
      boundKey := sess.boundKey                # 不用请求 connection 重解析绑定
      caliber := sess.caliberSnapshot          # 禁止热读资产

  if not currentlyVisible(boundKey, identity):
    return denyInvisibleBinding()

  if hasForbiddenExtraKeys(rawArgs):           # D12: where/having/groupBy/joins/sort*
    return denyViolation(redacted=true)

  reqKeys := resolveCanonicalKeys(rawArgs)     # 仅请求侧；失败 → violation
  if reqKeys != { boundKey }:
    return denyViolation(redacted=true)

  if not subset(normalizeFields(rawArgs.measures), caliber.measures): denyViolation...
  if not subset(fields(rawArgs.dimensions), caliber.dimensions): denyViolation...
  if not subset(rawArgs.segments, caliber.segments): denyViolation...
  if caliber.requireMeasures and not superset(...): denyViolation...
  agentFilterFields := fieldsOfAgentFilters(rawArgs.filters)
  if not subset(agentFilterFields, caliber.filterFields): denyViolation...

after_caliber:
  apply row-policy injection / guardrails / upstream-or-local-explain
```

关键失败分支均须映射到 §7 SC。

---

## 7. 验收（SC-01–SC-30）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | published 可加载；draft 不参与；`(connectionId,source)` 无法解析唯一 boundKey → 加载失败；触发词非字符串／规范化后字母数字码点 &lt;4／空串 → **候选发布失败**（不得静默丢弃） | 单测 |
| SC-02 | 显式激活成功；BindingSession 含 `boundKey`＋`caliberSnapshot`＋`commitPhase=committed` | Proxy 单测 |
| SC-03 | 显式 id 不可见／不存在 → 拒绝；失败 begin 不改旧 Session | 单测 |
| SC-04 | 触发唯一命中 → 激活；覆盖 NFKC／`toLowerCase`／全角／连续空白；**`Straße` vs `STRASSE` 不命中**（非 full casefold）；内部标点保留（`资产台数` vs `资产，台数` 不命中）；两字段**分别**匹配；同绑定多 trigger 去重为 1；不可见不参与 | 单测 |
| SC-05 | 触发 ≥2（跨绑定重叠／相同规范化 trigger／输入顺序变化）→ ambiguous；不按最长词／顺序择一；失败不改旧 Session | 单测 |
| SC-06 | 真零命中 → `begun_no_hit`，查数与基线一致；不得靠静默跳过短 trigger 伪装零命中；`triggers: []` 仅显式 id | 单测 |
| SC-07 | `begun_bound` 时 reqKeys≠{boundKey}（含**双连接同名 logical source**、跨物理表）→ violation；query 上游计数 0；explain 无成功体 | 夹具／单测 |
| SC-08 | 越出快照允许集 → 同 SC-07（参数化） | 夹具 |
| SC-09 | 缺 `requireMeasures` → 同 SC-07 | 夹具 |
| SC-10 | 合规请求 → 不因本条拒绝 | 单测 |
| SC-11 | 行权限注入不误伤；Agent 同字段仍校验 | 单测 |
| SC-12 | `never_begun` 不施加绑定 | 单测 |
| SC-13 | 拒绝文案中文主称；不可见对象不回显 | 单测 |
| SC-14 | `lint:spec-docs` 退出 0 | 门禁 |
| SC-15 | `{expr}` measure、不可解析 filter、跨源 order_by → violation | 单测 |
| SC-15b | 出现 `where`／`having`／`groupBy`／`joins`／`sort*` → violation（D12；即使同源） | 单测 |
| SC-16 | `lost_or_conflict`／`commitPhase≠committed` → unresolved，不得放行 | 单测 |
| SC-17a | 首次 begin：①②失败 → 仍 `never_begun` | 单测 |
| SC-17b | 已有 Session 时激活错／①②失败 → **旧 committed 状态不变** | 单测 |
| SC-17c | ④ 失败或进程在 preparing 中断 → 重启后 unresolved，不得放行 | 真实进程局部故障 |
| SC-18 | 激活后撤权再查 → 拒绝且不泄密 | 单测 |
| SC-19 | 重复 id／加载失败可观测；已 bound 不得因加载失败静默放行 | 单测／夹具 |
| SC-20 | supersede 替换 generation／快照；并发唯一权威 | 单测 |
| SC-21 | query／explain 对拒绝分支同码同口径 | 单测 |
| SC-22 | O1：generation 切换后新 begin 可读；绑定独立变更与混合整批同步；绑定消费失败不得因 KTX 成功推进绑定基线；O1 未闭合前不得收口 | 夹具（O1 后） |
| SC-23 | 撤销／删除后新 begin（显式 id＋触发）不可命中；旧 begin 准备结果跨 generation 失效；在途续查仍用 begin 快照 | 夹具／单测 |
| SC-24 | 读取失败／扫描截断／重复 id／sourceMap 失败／漂移：新 begin → unresolved 且旧 Session 不变；已 bound 续查仍受快照约束；不得空注册表放行 | 夹具（O1 后） |
| SC-25 | 预算关闭时四态仍成立 | 单测 |
| SC-26 | 物理表别名／sourceMap 正向：请求引用归一后等于 boundKey → 通过 | 单测 |
| SC-27 | 续查／同 session 后续工具调用保持同一 committed 快照 | 单测 |
| SC-28 | begin 后改／删磁盘资产：在途仍按快照强制；新 begin 不可再命中已删；begin 提交前 generation 过期不得提交旧选择 | 单测／夹具 |
| SC-29 | 暂停于 begin 准备完成、D11 写入前；**保持注册表 generation 不变**，分别改／删／降 draft 资产、制造扫描失败及解析依赖读取失败；恢复 begin → unresolved，旧 Session 不变；已 bound 续查仍按原快照＋当前 ACL | 夹具／单测 |
| SC-30 | 真实进程局部故障：候选持久化失败、凭据写入前中断、凭据提交后内存切换前中断、内存切换后基线／终态登记失败及重启；断言恢复 generation、新 begin 拒绝、基线与回执关联、恢复幂等；缺完整证据不得激活候选。**独立于 SC-17c** | 真实进程局部故障 |

全部 SC **未执行**。本条收口不表示可上线。

---

## 12. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.9 | 2026-11-08 | 委托人授予 R4：Claude Code 实现、Cursor Agent code review；未宣称可上线 |
| v0.8 | 2026-11-07 | 委托人确认闭合 O1／O2（选项 1＝全采纳闭合包）；R3 闭合；仍待 R4；未授权实现 |
| v0.7 | 2026-11-07 | O1／O2 对抗 R2：内容有效性证明、activeGeneration 提交／恢复、`toLowerCase` 唯一算法、SC-29／30、伪代码互斥核验 |
| v0.6 | 2026-11-07 | O1／O2 对抗 R1：完整写入 §4.1／§4.2（含失败拒绝新 begin、generation 互斥、非 KTX 镜像、NFKC 子串与禁止跨字段拼接）；扩充 SC-01／04–06／22–24／28；草案≠闭合 |
| v0.5 | 2026-11-07 | 委托人确认定稿：1A–4A；状态→终稿已确权；O1／O2／开发授权仍开放 |


## 8. 风险

| 风险 | 缓解 |
|---|---|
| 绑定过宽锁死探索性问询 | 仅命中后强制；未配置触发的问题不受影响 |
| 触发词误伤 | O2 闭合前不得实现；≥2 命中 fail-closed |
| 与 P0-3 双重拒绝码混淆 | 本条专用 `caliber_binding_violation`／`caliber_binding_ambiguous`／`caliber_binding_unresolved`；表歧义码归 P0-3 |
| 发布种类未接线导致绑定不生效 | O1 闭合＋SC-22；失败合同禁止静默空集 |
| 审计 turn 误作门禁源 | D5：权威作用域独立；解析失败 fail-closed |
| 行权限字段名豁免被绕过 | D6／D7：注入前快照＋按来源区分 |

---

## 9. 关联

- 清单：P0-1；下一批 P0-2／P0-A；串联 P0-3（共用 Source normalize）
- Plan：`docs/plans/lucy-20261107-question-type-caliber-binding-plan.md`
- Codex 评审：`docs/reviews/2026-11-07-question-type-caliber-binding-codex-review.md`
