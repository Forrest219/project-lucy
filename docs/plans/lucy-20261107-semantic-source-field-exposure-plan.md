# Lucy 语义层 Source 级字段暴露裁剪 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划／**v0.7**（已获开发授权；实现中） |
| 日期 / 目标版本 | 2026-11-07（修订 2026-11-08） / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立，待 PM 指派台账号后再登记 |
| 状态 | **v0.7；终稿已确权；R4 已授予；实现已合入；功能合同已收口（2026-11-13）**（SC-01–SC-30；见证据审计）。不表示可上线 |
| 授权边界 | **不授权改代码。** 本 Plan 只定义步骤、验收与完成定义；开工须先取得本条的终稿确权 **与** 委托人明示开工授权 |
| 验收 | 各步骤出口见 §4；本条总出口＝Spec 的 **SC-01–SC-30** 全部关闭 |
| 对应 Spec | [lucy-20261107-semantic-source-field-exposure-spec.md](../specs/lucy-20261107-semantic-source-field-exposure-spec.md)（**v0.7-draft**） |
| 评审记录 | [第 1 轮](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[Codex 过程对抗](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md) |
| 需求池条目 | REQ-030-012 |


### 变更行（v0.7-draft triage · Codex R3c）

| Finding | 本 Plan 闭合动作 |
|---|---|
| F-R2-04 | S3c／前置第 5 项／SC-30：`resolvePassthroughScope` 将 `entity_details`／`sl_validate` 无 Source／空抽取归一为 `INSTANCE_WIDE`；实例有 trimmed／故障则拒；禁止空循环放行；补「已通过 ACL（通配 ∧ 全敏感表显式 ∧ 其余准入）＋空作用域」逐工具零上游用例；保留无 trimmed／故障兼容对照 |
| F-R2-01／02／03 | 不回退 |
| 版本漂移 | Spec／Plan／评审统一 **v0.7-draft** |
| 门禁声明 | R3c＝CONDITIONAL；建议 **R3d** 核验；**非** R2-F／R4／PASS |

### 变更行（v0.6-draft triage · Codex R3b）

| Finding | 本 Plan 闭合动作 |
|---|---|
| F-R2-01 | S1／S2b／前置 §8：补 `upstreamExecutionGenerationId`；Strat-A 隔离上游或 Strat-B `STOP_ADMISSION`→`DRAIN`→索引变更→失败回滚／保持 STOP；SC-25／SC-26 必须观察实际消费定义 |
| F-R2-04 | S3c：四透传挂在路径 A（`sensitiveMetadataTools`）与路径 B（`tableTouchingTools`）各自授权通过后的必经钩子；`resolvePassthroughScope`／`scope.unavailable`；SC-30 逐工具零上游＋未裁剪对照＋插入点锁。**v0.7 另补空抽取** |
| 版本漂移 | Spec／Plan／评审统一 **v0.6-draft** |
| F-R2-02／03 | R3b 已确认闭合；本版不回退 |

### 变更行（v0.4-draft triage · Codex R2 · 保留）

| Finding | 本 Plan 闭合动作 |
|---|---|
| F-R2-01 | S1／S2b：`ExecutionGeneration` 含台账＋期望集合＋语义定义视图＋索引消费版本；切换期新请求／在途 pin；索引失败／激活失败／重启保持上一 serving；SC-25／SC-26。**v0.6 补上游绑定** |
| F-R2-02 | S4／S5：先判暴露三态再决定是否硬拒；合法零列 vs 不可解析／无法消歧；未裁剪不新增硬拒；SC-29 |
| F-R2-03 | S1／S2c：期望集合 `ready`｜`unavailable`；禁止失败→空集合；代次匹配；SC-27／SC-28 |
| F-R2-04 | 新增 **S3c**：四透传取证裁决；实现期默认 D26 fail-closed／零上游；矩阵／前置去掉「开工前再确认再决定」；SC-30。**v0.6 补必经路径**；**v0.7 补空抽取→INSTANCE_WIDE** |
### 变更行（v0.3-draft triage · Codex R1 · 保留）

| Finding | 本 Plan 闭合动作 |
|---|---|
| F-01 | S5 改为候选完整状态＋引用闭包；覆盖上传与工作台／激活入口；SC-16／SC-17 |
| F-02 | 新增 S2b（激活边界后端）与 S6b（保存不激活）；单请求 snapshot；失败恢复；SC-13 强化 |
| F-03 | S5 跨源解析；trimmed 作用域不可解析 fail-closed；SC-08 扩 |
| F-04 | S4 插入点改为对象授权之后；SC-18 |
| F-05 | S4 禁止全局化 `validateProtectedLucyQueryArgs`；SC-19；对齐 Spec D10 |
| F-06 | S4 Source 优先算法（trimmed 作用域）；SC-20 |
| F-07 | S3／S3b 发现面矩阵（examples／initialize／Hive）；SC-21；四透传见 S3c／D26 |
| F-08 | S3 拆分上行前准入与下行裁剪；禁止原文透传；SC-22 |
| F-09 | 新增 S2c 期望台账集合；SC-23／SC-24；期望集合自身故障见 F-R2-03 |

---

## 目标

把 REQ-030-012 登记的四条期望方向（澄清已认可路线 1）落成可实现、可打假的功能合同：

1. **库存 ≠ 暴露（基础结构）**：Manifest／扫描保留全量物理库存；另维护 Source 级暴露台账，全实例同一套采用集，存量无显式配置等价全库存暴露；**曾配置后丢失**由独立期望集合检出并 fail-closed；期望集合自身故障不得退化为空集合全暴露。
2. **运行时 A1**：未暴露列在发现面（含 `lucy_read_source`、Hive 列载荷、`catalog.examples`／`initialize` 字段载体）不可见；查数面（`lucy_query`／`lucy_explain_query`）点名未暴露列一律本机拒绝（fail-closed；零上游断言仅落在上行前准入）。**四透传工具首期不宣称 A1 覆盖**（D26／SC-30）。
3. **发布 B1**：对**发布候选完整状态**及受影响引用闭包，`grain`／`measure`／`segment`／`join`／派生列引用 **trimmed 目标**未暴露列（含跨 Source）→ 硬失败并点名引用方与目标；支持合法纯台账发布；未裁剪目标不新增硬拒。
4. **操作面 D1**：表语义工作台字段列表维护暴露／取消暴露；**保存未发布不生效**；取消暴露的列仍可见可恢复；变更进草稿／待发布，经发布激活后生效。
5. **执行代次**：运行面 pin 完整 `ExecutionGeneration`（含 `upstreamExecutionGenerationId`）；切换期与故障恢复不得混代；开放准入时实际上游消费定义与 serving 同代（SC-25／SC-26）。

同时把需求池的「**半通禁令**」做成可断言的不变量：发现面不可见列集合 **==** 查数面被拒列集合，两面携带同一已激活暴露集 digest，且与定义／索引／**实际上游执行**代次同代。

不做：列级 ACL／脱敏／按 Role 异列；不改 KTX 上游与「全物理列」合同；不改库表结构；不从 Manifest 物理删列；不替代合规用 VIEW；不把 scoped `validateProtectedLucyQueryArgs` 全局化。

---

## 开工前置

开工前必须全部满足，缺一项即停：

1. **开工授权**：委托人终稿确权本 Spec／Plan 后**另**明示授权实现。**未授权前 S0–S7 全部不得开始**——S0 虽不是改运行代码，但它是**真实写操作**（改写术语标准 ＋ 冻结文案），不得以「先登记术语」为由在未授权状态下落盘。
2. **术语登记先行**：`field_exposure`、`field_not_exposed`、`field_exposure_unavailable` 三个新码先按 `webui/docs/00-product-terminology-standard.md` §5 登记（§4.2 语义建模分区）。
3. **KTX loader 行为确认（Spec §1.3 未核实项 1）**：确认 KTX 侧是否会把 `semantic-layer/<conn>/_exposure/`（或任何新增下划线目录）下的 yaml 当作语义 source 加载。确认结果决定台账落点。**未确认前不得落盘台账文件。**
4. **上游返回体形状固化（Spec §1.3 未核实项 2）**：用真实上游返回体固化 `lucy_read_source` 的列数组形状与键名；同步核对 Hive 成功载荷 `columns` 形状。
5. **四透传工具合同（Spec D26／SC-30；不得含糊推迟）**：
   - **实现默认（取证完成前强制）**：`entity_details`／`sl_validate`／`dictionary_search`／`discover_data` 按 Spec D26——触及 `trimmed`／`scope.unavailable`（含空抽取归一 `INSTANCE_WIDE` 且实例有 trimmed／故障）→ 上行前 fail-closed、零上游；实例无 trimmed／故障时不新增拒绝；**不宣称 A1 覆盖四入口**。
   - **控制流**：`entity_details`／`sl_validate` 挂在 `tableTouchingTools` 授权通过后；`dictionary_search`／`discover_data` 挂在 `sensitiveMetadataTools` 授权通过后（二者默认**不在** table-touching）。**禁止**只嵌在 `if tableTouchingTools` 分支。
   - **空作用域（R3c）**：`entity_details`／`sl_validate` 无 Source／抽取为空 → `resolvePassthroughScope` 归 `INSTANCE_WIDE`；**禁止** `involved=[]` 空循环放行；不得依赖 ACL 空表拒绝（须通配 ∧ 全敏感表显式授权及其余准入才可越过）。
   - **取证裁决（S3c，可与实现并行但须在宣称 A1 前完成）**：逐工具抓真实成功载荷；「含字段名」→ 纳入 D21 统一读取器并补 SC；「不含」→ 登记证据与适用版本后解除该工具首期 fail-closed。
   - **禁止**：把「开工前再确认是否含字段名」当作可跳过合同或实现期临时决定的开口。
6. **真实 MCP 响应载体核对（Spec §1.3／D22）**：核对 JSON-RPC、SSE、文本／未知 content-type 在 `writeLucySemanticResponse` 与 Hive 出口的实际路径；冻结「解析／裁剪失败绝不原文透传」的实现策略。
7. **台账格式与期望集合格式冻结**：Spec D2／D5 台账候选格式，以及 D19／D25 期望集合落点／schema／`expectedSetRequired` 哨兵语义，经 PM 与 FDE 确认后冻结；冻结后改格式须回评审。故障语义已闭合，不阻塞过程对抗。
8. **激活边界与执行代次方案冻结（Spec D18／D23／§3.1c）**：明确草稿存储落点、候选合并、`ExecutionGeneration` 耐久激活记录（含 `upstreamExecutionGenerationId`）、**Strat-A 或 Strat-B** 上游绑定／隔离、原子切换与失败回滚；**不得**沿用「工作台保存直接写运行内容根再校验」；**不得**在索引未确认时按磁盘最新混拼台账与定义；**不得**在「索引成功＋激活失败」后开放准入且上游仍跑新定义（E12b／E18）。
9. **与既有合同的冲突点处理结论**（逐条已定，不在实现里临时决定）：
   - 与 semantic-author「standalone source 必须含全部物理列」：规则**不改**；只补文档提示（Spec D17）。
   - 与发布扫描种类分类：**四处判定点都要改**，新增 `field_exposure`，台账不参与 KTX 上传（Spec D4）。
   - 与发布门禁不可豁免：新增 `NON_WAIVABLE_PREFIXES`（Spec D12）。
   - 与上传「无 changed source 即失败」（`semantic-assets.ts:2338`）：必须扩展以允许**合法纯台账发布**（SC-17），或提供等价工作台生效入口且跑同一 B1。
   - 与 `access.yaml`：暴露集不进 Role／Agent，不参与 `policyVersion`（Spec D6）。
   - 与内容根四目录常量：仅当第 3 项选独立目录时才扩 `CONTENT_DIR_NAMES`。
   - 与既有 reason code：只新增两个码（Spec D13）。
   - 与 scoped 形状门禁：`validateProtectedLucyQueryArgs` **保持**仅在 scoped 嵌套内调用（Spec D10／D20）。
   - 与查数／B1 解析：仅 `trimmed` 作用域新增暴露硬拒（Spec D24／SC-29）。
10. **基线取证**：保存改动前证据——`lucy_read_source` 全量列、`lucy_query` 点名任意列不被本机拒绝、catalog.examples 含字段名原文。
11. **归属确认**：本条要改 `webui/server/proxy/{acl,mcp-proxy}.ts`、新增 `webui/server/proxy/field-exposure.ts`、`webui/server/{publish-gate,semantic-assets,publish-workbench-state,semantic-layer}.ts`、`webui/server/index.ts`（保存／reindex／激活）、`webui/server/paths.ts`、`webui/src/pages/TableEditor.tsx`，以及期望集合／执行代次持久化模块。开工前对照 `0.30` 批次地图确认无他人同时在写这些文件。

---

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 术语与口径登记：登记三码；冻结三处固定文案「业务暴露裁剪 ≠ 列级安全」 | 术语标准更新 ＋ 文案清单 | SC-14 |
| S1 | 读取器与执行代次 pin：`field-exposure.ts`；暴露三态＋期望集合 `ready`｜`unavailable`；**禁止失败→空集合**；digest；`pin(ServingGeneration)`＝完整 `ExecutionGeneration`（台账＋期望＋定义视图＋索引消费版本＋`upstreamExecutionGenerationId`）；`AdmissionMode` 门闩 | 读取器 ＋ 单元 | SC-01、SC-02、SC-10、SC-11、SC-23、SC-24、SC-27、SC-28 |
| S2 | 落点与发布接线：按前置第 3 项落台账目录；四处判定点新增 `field_exposure` 种类（不参与 KTX 上传）；台账仅随**成功激活**进入运行内容根 | 发布扫描扩展 ＋ 内容根接线 ＋ 单元 | SC-01、SC-02 |
| S2b | **激活边界＋执行代次＋上游绑定（F-02／F-R2-01／R3b）**：草稿与运行内容根分离；候选合并；按冻结的 Strat-A（staging 上游）或 Strat-B（`STOP_ADMISSION`→`DRAIN`→改共享索引→失败回滚／保持 STOP）保证开放准入时上游＝serving；门禁∧上游对齐∧激活确认后**原子**切换；切换期新请求 pin 旧代／Strat-B 下 STOP；在途不换代；索引成功＋激活失败不得「上游 V2＋serving V1＋OPEN」；重启恢复绑定状态；禁止只核快照标签 | 暂存／激活／代次／上游隔离后端 ＋ 单元／管线 | SC-01、SC-13、SC-07、SC-25、SC-26 |
| S2c | **期望台账集合（F-09／F-R2-03）**：独立持久化；`expectedSetRequired` 哨兵与版本化空文档；首次配置登记、恢复全暴露移除、Source 删除同步、回滚；加载失败／代次不匹配 → unavailable | 期望集合模块 ＋ 单元 | SC-23、SC-24、SC-27、SC-28、SC-01 |
| S3 | 发现面：上行前 `admitSourceForDiscovery`；下行 `applyDiscoveryTrim`（禁止 restoreOriginalBody）；`lucy_read_source` 与 **Hive** 共用读取器 | Proxy 发现面 ＋ 单元 | SC-03、SC-11、SC-22 |
| S3b | **发现面矩阵补全（F-07）**：`rewriteExamples`；`initialize` 同源；与 read_source／Hive 同一 digest | examples／initialize 改写 ＋ 自动化 | SC-12、SC-21 |
| S3c | **四透传首期合同＋取证（F-R2-04／R3b／R3c）**：实现 `resolvePassthroughScope`＋`admitPassthroughForExposure`；挂接点＝路径 A（`sensitiveMetadataTools` 授权后，覆盖 `dictionary_search`／`discover_data`）与路径 B（`tableTouchingTools` 授权后，覆盖 `entity_details`／`sl_validate`）；**禁止**只嵌 tableTouching 分支；`scope.unavailable` 保守裁决；**空抽取／无 Source → `INSTANCE_WIDE`**（禁空循环放行）；SC-30：逐工具零上游＋**已过 ACL＋空作用域**用例＋无 trimmed／故障兼容对照＋插入点锁＋EMPTY 归一单测；取证清单与裁决落盘；含字段名→纳入 D21；不含→登记后解除。**取证前不得宣称 A1 覆盖四入口** | Proxy 透传门禁 ＋ 插入点锁 ＋ 取证记录 ＋ 自动化 | SC-30 |
| S4 | 查数面门禁：对象授权之后、行策略提前 return 之前；禁止全局化 `validateProtectedLucyQueryArgs`；**先判三态再解析**；兼容字符串 filter 与 `{expr,name}`；仅 trimmed／期望故障作用域硬拒；越权保持原 ACL 码 | Proxy 查数面 ＋ 单元 | SC-04、SC-05、SC-06、SC-15、SC-18、SC-19、SC-20、SC-29 |
| S5 | 发布门禁 B1：`checkExposureReferenceContract(CandidateState)`；跨源；**仅 trimmed 目标**触发 `exposure.*`（含 unparseable）；合法纯台账发布；`NON_WAIVABLE_PREFIXES`；多入口＋manual reindex 不得绕过 | 门禁 ＋ 豁免改动 ＋ 多入口接线 ＋ 自动化 | SC-08、SC-09、SC-16、SC-17、SC-29 |
| S6 | 工作台 UI：全量库存＋暴露开关；取消暴露仍可见；变更进草稿；三处文案 | 工作台 ＋ 组件测试 | SC-13、SC-14 |
| S6b | **保存未发布不生效（F-02）**：工作台保存只写草稿；发布激活前 Proxy 仍读旧代；与 S2b 对接 | 保存路径改造 ＋ 自动化 | SC-13、SC-07 |
| S7 | 跨面一致性与收口：两面同一 digest＋同代；矩阵回归；未裁剪路径；四透传首期；lint／全测；收口记录 | 一致性自动化 ＋ 绿证据 ＋ 收口记录 | SC-07、SC-12、SC-15、SC-01–SC-30 |

**步骤依赖**：S0 → S1 →（S2 ∥ S2c）→ S2b；S3／S3b／S4 依赖 S1；S3c 依赖 S1（可与 S3／S4 并行写不同关注点，但 **mcp-proxy.ts／acl.ts 热点串行**）；S5 依赖 S1＋S2＋S2c；S6 依赖 S1；S6b 依赖 S2b＋S6；S7 依赖全部。

**禁止并行写入的热点文件**：`acl.ts`、`mcp-proxy.ts`、`publish-gate.ts`、`semantic-assets.ts`、`semantic-layer.ts`、`index.ts`、`field-exposure.ts`、`TableEditor.tsx`。

---

## 验收

### 4.1 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 三码与主术语已登记；三处固定文案成文 |
| S1 | 读取器：missing+!expected→全暴露；configured→排除集；unavailable（损坏／期望丢失／期望集合故障）→故障；digest 稳定；ExecutionGeneration pin（含上游代次字段）单测通过；失败不退化空集合 |
| S2 | 台账种类识别正确；仅激活后进入运行内容根；不读浏览器状态 |
| S2b | 草稿≠已激活；门禁／上游对齐／激活失败不 OPEN 混代；切换期新请求／在途不混代；索引成功＋激活失败隔离；SC-25／SC-26（观察实际消费定义） |
| S2c | 期望集合 CRUD／回滚；SC-23／SC-24／SC-27／SC-28 对照 |
| S3 | SC-03、SC-11、SC-22：裁剪生效；上行前零上游；下行失败不原文透传 |
| S3b | SC-21：examples／initialize／Hive 与 read_source 一致裁剪 |
| S3c | SC-30：四工具×拒绝／放行／空作用域（已过 ACL）；EMPTY→INSTANCE_WIDE 单测；敏感 Meta 插入点锁；取证清单逐项状态可审计 |
| S4 | SC-04–06、SC-18–20、SC-29：五载体＋兼容形状；越权原 ACL；三态后再硬拒 |
| S5 | SC-08、SC-09、SC-16、SC-17、SC-29：跨源＋只改台账；未裁剪不误杀；多入口 B1 |
| S6 | SC-13、SC-14：列表含已取消暴露列；文案到位 |
| S6b | 保存后、发布前 Proxy 行为不变；发布激活后新排除集生效 |
| S7 | **SC-01–SC-30** 全部通过；lint 与测试全绿 |

### 4.2 证据等级

- 本条收口证据以**本机自动化**（单元／组件／真实进程内 Proxy 自动化）＋**CI job** 两级为准。
- 真实客户环境、真实 Agent 客户端、镜像构建与客户交付**不在本条出口**。
- 不得用 mock 冒充「零上游执行」：该断言必须由 loopback observer 的执行计数给出，且**仅针对上行前准入路径**（Spec D22／D26）。
- 不得用 mock 冒充「台账随发布激活进入内容根」：必须跑真实发布／激活流程。
- 不得用「上传门禁已有 blocked 落点」冒充工作台 B1 已闭环：SC-16／SC-17 必须在工作台／纯台账入口各跑通。
- 不得用「两面 exposure digest 相同」或「快照内部 generationId 相等」冒充代次一致：SC-25／SC-26 必须构造定义／台账／上游切换反例，并观察**实际上游消费定义**（同名 measure 语义分叉）。
- 不得用「只在 tableTouching 分支挂了四工具检查」冒充 SC-30：必须证明 `dictionary_search`／`discover_data` 在 sensitive-metadata 路径上也被门禁。
- 不得用「空表 ACL 已拒绝」冒充空作用域已闭：SC-30 必须用「通配 ∧ 全敏感表显式授权 ∧ 其余准入」身份构造空抽取用例，证明门禁仍拒且零上游。

### 4.3 门禁

| 命令 | 期望 |
|---|---|
| `npm run lint:spec-docs` | exit 0（本 Spec 与本 Plan 需在 `docs/README.md`／`docs/plans/README.md` 登记） |
| `npm run lint:spec` | exit 0 |
| `npm run lint:terminology` | exit 0（新 reason code 与主术语已登记） |
| `npm run lint:ia-boundary` | exit 0 |
| 受影响测试文件 | 全绿 |

---

## 完成定义

- [ ] Spec 的 **SC-01–SC-30** 全部关闭，逐条落点写进 Spec §4 与收口记录。
- [ ] 暴露台账仅随成功发布激活进入运行内容根；草稿保存不生效；运行面判定不依赖浏览器本地状态。
- [ ] 单请求固定完整 `ExecutionGeneration`；发现面与查数面同一 digest 且同代定义／索引／上游执行。
- [ ] 切换期／索引失败／激活失败／重启无混代；开放准入时上游＝serving；SC-25／SC-26 观察实际消费定义。
- [ ] 期望集合可信初始化与不可用态；失败不退化为空集合（SC-27／SC-28）。
- [ ] 存量无显式配置／显式全暴露路径不因本条新增解析硬拒（SC-29）。
- [ ] 四透传首期 fail-closed 已断言（路径 A／B 必经；逐工具零上游＋已过 ACL 空作用域＋未裁剪／无故障对照；EMPTY→INSTANCE_WIDE）；取证裁决已登记；未裁决前不宣称 A1 全入口闭环（SC-30）。
- [ ] 发现面矩阵覆盖 read_source、Hive、catalog.examples、initialize；sources 表列表不因暴露集隐藏表。
- [ ] 查数面：对象授权先于暴露检查；越权保持原 ACL 码；先三态再字段；五载体＋兼容形状；零上游断言在上行前。
- [ ] 下行解析／裁剪失败绝不原文透传。
- [ ] B1 检查候选完整状态与引用闭包（含跨源）；仅 trimmed 目标触发；合法纯台账发布成功；`exposure.*` 不可豁免；上传与工作台／激活入口均覆盖。
- [ ] 独立期望台账集合落地；SC-23／SC-24 区分从未配置与曾配置后丢失。
- [ ] 新物理列默认暴露；取消暴露列在工作台仍可见可恢复。
- [ ] 三码与主术语已登记；三处文案写明「业务暴露裁剪 ≠ 列级安全」。
- [ ] 未改动 KTX 上游、未改 semantic-author「全物理列」规则、未改库表结构、未从 Manifest 删列、未全局化 `validateProtectedLucyQueryArgs`、未改既有 ACL reason code 含义。
- [ ] 状态镜像改齐：Spec 头部「状态」行、本 Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9；需求池 REQ-030-012 同步。
- [ ] 收口记录写入 `docs/reviews/`，并注明「本条收口不表示可上线；过程对抗 ≠ 终稿确权」。

---

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 半通 | 两面各读一份暴露集 | 单一读取器 + ExecutionGeneration pin + SC-07 |
| 混代 | 磁盘已提升但 serving 未切；或上游已 V2 而 serving 仍 V1 | S2b（Strat-A／B）＋SC-25／SC-26（实际消费定义） |
| 索引成功＋激活失败半通 | 上游跑新定义且准入仍开 | S2b 硬禁令：回滚上游或保持 STOP |
| 查数误杀 | 未裁剪路径全局硬拒或误用 scoped 形状函数 | D24／SC-29；禁止全局化 validateProtectedLucyQueryArgs |
| 草稿提前生效 | 沿用保存写内容根 | S2b／S6b＋SC-13 |
| 台账丢失静默全暴露 | 文件缺失＝未配置不可区分 | S2c＋SC-23／SC-24 |
| 期望集合读失败→空集合 | 损坏当 ready(∅) | D25＋SC-27／SC-28 |
| 下行原文透传 | 继承 writeLucySemanticResponse 降级 | S3＋SC-22 |
| 越权码被覆盖 | 暴露检查过早 | S4＋SC-18 |
| B1 漏入口／漏闭包 | 只扫 changed overlay | S5＋SC-16／SC-17 |
| 四透传假装已闭环 | 无载荷证据却宣称 A1 | S3c＋D26＋SC-30 |
| 四透传嵌错分支 | sensitive Meta 工具永不进门禁 | S3c 路径 A／B＋SC-30 插入点锁 |
| 四透传空抽取放行 | 无源／空表 → `involved=[]` 放行；ACL 通配可越过空表拒绝 | S3c：EMPTY→INSTANCE_WIDE；SC-30 已过 ACL＋空作用域 |
| KTX 侧行为未核实 | 台账落点 | 开工前置第 3 项 |
| 与 `0.30` 争文件 | 热点文件多 | 前置第 11 项；串行热点 |
| 索引与发布窗口耦合 | reindex 绕过门禁 | S5 明确激活入口必跑 B1 |

---

## 回滚

- S1–S5／S2b／S2c／S3b／S3c 均为服务端判定与门禁改动，回滚＝还原对应提交；期望集合／执行代次记录随内容根版本回退。
- S2 台账落点若已产生文件，回滚＝随内容根版本回退。
- S6／S6b 回滚＝还原前端与保存路径提交；已提交草稿按既有发布恢复流程处理。
- 术语标准登记项在回滚时同步撤回。

---

## 出处

- 需求池：[`REQ-030-012`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 对应 Spec：[`lucy-20261107-semantic-source-field-exposure-spec.md`](../specs/lucy-20261107-semantic-source-field-exposure-spec.md)（v0.7-draft：D1–D26、§3.1–§3.7 含 §3.1c 上游绑定与空抽取 INSTANCE_WIDE、SC-01–SC-30）
- 过程 findings：`inbox/2026-11-08-p0-a-codex-r1-last.txt`、`inbox/2026-11-08-p0-a-codex-r2-last.txt`、`inbox/2026-11-08-p0-a-codex-r3-last.txt`、`inbox/2026-11-08-p0-a-codex-r3b-last.txt`、`inbox/2026-11-08-p0-a-codex-r3c-last.txt`；评审链 [`docs/reviews/2026-11-08-semantic-source-field-exposure-codex-review.md`](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md)
- 上位合同：
  - [`docs/governance/DEVELOPMENT.md`](../../docs/governance/DEVELOPMENT.md) §「新增 Spec / Plan 的落盘清单」（`:192-253`）、§「语义层（semantic-layer）分层」（`:344-394`）
  - [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.2（`:67-86`）、§4.4（`:113-125`）、§6.2（`:555-588`）
  - [`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`](../../webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md) §Table Semantic Workbench Requirements（`:188-256`）
  - [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §5（`:1007-1016`）
  - [`docs/governance/vision.md`](../../docs/governance/vision.md) `:139`、`:219`
- 实现证据（前置与步骤引用，均已实际打开确认）：
  - `webui/server/proxy/acl.ts:86-93`、`:152-159`、`:1986-2035`、`:2131-2142`、`:3062`、`:3229`、`:3272-3325`
  - `webui/server/proxy/mcp-proxy.ts:958-1019`、`:1576-1620`、`:1647-1689`、`:1869`、`:2827-2896`、`:4456-4506`、`:4611`、`:5594-5599`、`:5828`、`:5990-6009`、`:6246`、`:6313`
  - `webui/server/proxy/row-policy.ts:407-455`
  - `webui/server/hive/execution.ts:142`
  - `webui/server/semantic-layer.ts:377-408`、`:646-660`、`:776`
  - `webui/server/publish-gate.ts:19-22`、`:60-92`、`:110-141`、`:155-176`、`:209-226`
  - `webui/server/publish-workbench-state.ts:41`、`:61`、`:169-172`、`:189-234`
  - `webui/server/publish-coordinator.ts:33`、`:391-430`
  - `webui/server/semantic-assets.ts:2338`、`:3056-3129`、`:3475`、`:3531`
  - `webui/server/index.ts:884`、`:2406-2443`、`:2664-2702`
  - `webui/server/ktx.ts:186-211`
  - `webui/server/paths.ts:20`、`:41-53`、`:85-123`
  - `webui/src/pages/TableEditor.tsx:102-115`、`:139-147`、`:163`、`:440-448`
  - `.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147`
