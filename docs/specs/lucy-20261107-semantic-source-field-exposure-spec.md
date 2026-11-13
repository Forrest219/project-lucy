# Lucy 语义层 Source 级字段暴露裁剪 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.7**（功能合同已收口） |
| 日期 / 目标版本 | 2026-11-07（修订 2026-11-08） / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立，待 PM 指派台账号后再登记 |
| 需求池条目 | REQ-030-012（语义层宽表字段暴露裁剪），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 状态 | **v0.7；R2-F＋R4 已闭合（2026-11-08）；实现已合入；SC-01–SC-30 证据关闭（2026-11-13，见 [证据审计](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md)）。功能合同已收口（2026-11-13）。本条收口不表示可上线** |
| 授权边界 | R2-F＋R4 已闭合（R4：2026-11-08）。授权范围＝本 Spec／Plan 实现与测试；**不**表示可上线。实现由 Cursor coder；Cursor reviewer 做 code review。 |
| 配套 Plan | [lucy-20261107-semantic-source-field-exposure-plan.md](../plans/lucy-20261107-semantic-source-field-exposure-plan.md)（**v0.7-draft**） |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[Codex 对抗评审（过程）](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md)（**过程对抗 ≠ 终稿确权**） |
| 上位合同 | [`docs/governance/DEVELOPMENT.md`](../../docs/governance/DEVELOPMENT.md)「语义层（semantic-layer）分层」、[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.2／§4.4、[`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`](../../webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md)、[`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)、[`docs/governance/vision.md`](../../docs/governance/vision.md) |

### 变更行（v0.7-draft triage · Codex R3c）

| Finding | 严重度 | 本版闭合动作 |
|---|---|---|
| F-R2-04 | major 残留 | 修订 D26／§3.3 `resolvePassthroughScope`／SC-30：`entity_details`／`sl_validate` **无 Source 或抽取结果为空** → 归类为 `INSTANCE_WIDE`（与敏感 Meta 同保守语义），**禁止** `involved=[]` 落入空循环得 `touchesTrimmed=false` 放行；实例存在 trimmed／期望故障 → 拒绝；SC-30 补「已通过 ACL 的身份 + 空作用域」逐工具零上游用例，并保留无 trimmed／故障实例兼容对照；Plan S3c 同步 |
| F-R2-01／02／03 | — | R3c 确认 F-R2-01 设计层已闭；02／03 过程已闭；**本版不回退** |
| 版本漂移 | — | Spec／Plan／评审头部统一 **v0.7-draft** |
| 门禁声明 | — | R3c＝CONDITIONAL；本版闭合上述残留后建议 **R3d** 核验正文贯通；**非** R2-F／R4／PASS |

### 变更行（v0.6-draft triage · Codex R3b）

| Finding | 严重度 | 本版闭合动作 |
|---|---|---|
| F-R2-01 | blocker | 扩 D23／§3.1b／§3.1c／S2b／SC-25／SC-26：**实际上游 KTX 执行**必须绑定或隔离到与 `ServingGeneration` 同代；无法保持旧代上游时强制 `STOP_ADMISSION`→排空在途→等待恢复／回滚；**禁止**「索引已跑新定义 + serving 仍旧代 + 准入开放」；验收须观察实际消费定义，不得只核快照标签 |
| F-R2-04 | major | 修订 D26／§3.3／SC-30：四透传门禁接到**各自授权通过后的必经路径**，**不得**嵌在仅含 `tableTouchingTools` 的分支（`dictionary_search`／`discover_data` ∈ `sensitiveMetadataTools`）；明确 `scope.unavailable` 保守裁决；逐工具零上游＋未裁剪对照。**v0.7 另补空抽取 INSTANCE_WIDE**（见上表） |
| 版本漂移 | — | Spec／Plan／评审头部统一 **v0.6-draft**（送审稿固定） |
| F-R2-02／03 | — | R3b 已确认设计合同闭合；本版不回退 |

### 变更行（v0.4-draft triage · Codex R2 · 保留）

| Finding | 严重度 | 本版闭合动作 |
|---|---|---|
| F-R2-01 | blocker | 新增 D23／§3.1c：`ActivatedSnapshot` 绑定完整**执行代次**（台账＋期望集合＋语义定义视图＋索引消费版本）；切换期新请求／在途请求规则；索引失败／激活失败／重启恢复读取行为；SC-25／SC-26；Plan S2b。**v0.6 补：上游执行绑定／隔离**（见上表） |
| F-R2-02 | major | 新增 D24／修订 §3.3／§3.4：统一查询与 B1 的解析适用范围；显式三态 `unconfigured`／`full_expose`／`trimmed`；区分合法零列、解析失败、无法消歧；未裁剪 Source 不新增硬拒；SC-29；Plan S4／S5 |
| F-R2-03 | major | 新增 D25／修订 §3.1／§3.7：期望集合可信初始化 vs 不可用态；禁止加载失败退化为空集合；代次不匹配同失败关闭；SC-27／SC-28；Plan S1／S2c。期望集合文件落点仍开放 |
| F-R2-04 | major | 新增 D26／修订 §1.3／发现面矩阵／RES-07：四透传工具仓内无载荷证据 → 逐项「取证待办 + 首期 fail-closed」合同；A1 不含四工具直至取证裁决；SC-30；Plan S3c。**v0.6 补：必经路径／scope.unavailable／逐工具零上游**；**v0.7 补：空抽取→INSTANCE_WIDE**（见 v0.7 变更行） |

### 变更行（v0.3-draft triage · Codex R1 · 保留）

| Finding | 严重度 | 本版闭合动作 |
|---|---|---|
| F-01 | blocker | B1 改为检查**发布候选完整状态**及**受影响引用闭包**；覆盖上传与工作台保存／索引生效入口；补「只改台账」与「合法纯台账发布」SC-16／SC-17 |
| F-02 | blocker | 明确草稿／候选／已激活边界；保存未发布不生效；单请求固定快照；两面 digest；失败恢复；Plan 后端任务 S2b／S6b |
| F-03 | major | 跨 Source 引用解析为完整身份＋列；检查**目标**暴露集；无法解析表达式 fail-closed；错误定位引用方与目标（SC-08 扩） |
| F-04 | major | 门禁顺序改为先对象授权再业务暴露；越权 source 保持原 ACL 码、不泄露暴露信息（SC-18） |
| F-05 | major | 不得把 scoped `validateProtectedLucyQueryArgs` 全局化；兼容存量字符串 filter／`{expr,name}` measure；澄清 D10（SC-15／SC-19） |
| F-06 | major | 先确定涉及 Source 并检查台账可用性，再字段检查；**trimmed 作用域内**解析失败 fail-closed（SC-20；v0.4 由 F-R2-02 收紧适用范围） |
| F-07 | major | 发现面矩阵补 `catalog.examples`、`initialize`、Hive 路径；统一读取器与 SC-21；catalog 表列表可不变但字段载体要裁；四透传见 F-R2-04／D26 |
| F-08 | major | 区分上行前台账准入 vs 下行裁剪；解析／裁剪失败绝不原文透传；零上游断言落在上行前（SC-22） |
| F-09 | major | 台账丢失保护落实为独立期望集合 ＋ Plan S2c ＋ SC-23／SC-24；期望集合自身故障见 F-R2-03／D25 |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：一个 Source 的字段暴露裁剪配置一旦**发布激活**生效，Agent 在发现面看不到被取消暴露的物理列、在查数面点名该列一律被本机拒绝；发现面与查数面使用同一份**已激活**暴露集，不会出现一面已裁一面仍通。
- 本条出口：能打假这些检查——本机自动化（暴露集读取与**执行代次**绑定、发现面裁剪含已核实字段载体、查数面 fail-closed、发布门禁硬失败、新列默认暴露、跨面裁剪集合一致性、台账丢失保护、期望集合故障关闭、激活边界与切换／故障恢复、未裁剪路径不新增硬拒、四透传首期 fail-closed）。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级；**四透传工具取证完成前不宣称 A1 全入口闭环**（D26）
- 上线关系：本条收口不表示可上线

---

## 1. 背景与取证

### 1.1 需求来源

需求池 REQ-030-012（[需求池 §REQ-030-012](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)）的澄清结论（2026-11-05 产品对话，路线 1 已认可）：

- 要的是 **Source 级业务暴露裁剪**（全实例同一套采用集），**不是**列级 ACL；
- 倾向 **Lucy 门面闸**（库存与暴露分离，不改 KTX「全物理列」合同、不手删 Manifest 列）；
- **库存 ≠ 暴露**：Manifest／扫描保留全量物理库存；另维护本 Source 的暴露集供 Agent 数据面使用；
- 运行时 A1：未暴露列在发现面不可见；查数点名未暴露列 → 拒绝（fail-closed）；闸落在 Lucy MCP Proxy 等 Agent 入口，禁止半通；
- 发布 B1：grain／measure／segment／join／派生列仍引用未暴露列 → 发布／生效硬失败并指出引用方；
- 新列 C2：扫描到的新物理列默认自动进入暴露集；裁剪靠事后在工作台收敛；
- 操作面 D1：表语义工作台字段列表维护暴露／取消暴露；变更进待发布；工作台仍能看到「已取消暴露」库存以便恢复；
- 存量无显式配置的 Source 等价「全库存暴露」。

### 1.2 现行行为取证（本节每条均已打开对应文件确认）

| 编号 | 事实 | 位置 |
|---|---|---|
| E1 | `lucy_catalog` / `kx_catalog` **sources 列表不返回列数组**：返回体有 `connections` / `sources`（connectionId、schema、sourceName、table）/ `examples` | `webui/server/proxy/acl.ts:1986-2035`（`lucyCatalog`）、`webui/server/proxy/acl.ts:2037-2054`（`kxCatalog`） |
| E1b | **`catalog.examples` 含字段名载体**：示例字符串内嵌 `poc_ad_revenue_daily.dt`、`company_name`、`period/year` 等；且进入 `initialize` instructions（`catalog.examples.map`） | `webui/server/proxy/acl.ts:2131-2142`、`webui/server/proxy/mcp-proxy.ts:1869` |
| E2 | 目录类工具由 Proxy **本地**服务：`lucy_catalog` / `kx_catalog` / `connection_list` 在 Proxy 内构建并直接回写 JSON-RPC | `webui/server/proxy/mcp-proxy.ts:4456-4506` |
| E3 | 列级发现面实际是 `lucy_read_source`：Proxy 把它改写成上游 `sl_read_source` 转发给 KTX；响应体经 `writeLucySemanticResponse`，**现行不做列级过滤**；解析／改写异常时现行会**恢复原始 body**（对本条裁剪不可继承） | `webui/server/proxy/mcp-proxy.ts:5594-5596`、`:2827-2896`、`:5990-6009` |
| E3b | **Hive 分流**可在拟定通用裁剪出口之前直接返回，成功载荷可含 `columns` | `webui/server/proxy/mcp-proxy.ts:4611`／`:5828` 一带；`webui/server/hive/execution.ts:142` |
| E4 | 查数面 `lucy_query` 同样被改写成上游 `sl_query`；Proxy 侧只有**形状**门禁（禁 raw SQL、禁形状键、`filters` 禁字符串与禁用树键、`measures[].expr` 禁），**没有字段级门禁**。**注意形状门禁的嵌套位置**：`validateProtectedLucyQueryArgs` 只在「非通配表权限 → 有 scoped 行策略 → 仅 `lucy_query`」三层嵌套内被调用（`acl.ts:3272` → `:3302` → `:3306-3309`），**不得**对本条新门禁全局化该函数；`lucy_query`／`lucy_explain_query` 唯一无条件执行的形状检查是 `hasRawQueryArg`（约 `:3229`） | `webui/server/proxy/mcp-proxy.ts:5597-5599`、`webui/server/proxy/row-policy.ts:407-455`、`webui/server/proxy/acl.ts:3229`、`:3272-3325` |
| E5 | 查数参数形状：`connectionId` / `measures` / `dimensions` / `filters` / `segments` / `order_by`｜`orderBy` / `limit`；字段引用是**源限定名**（形如 `<source>.<column>`）；现有 Proxy 参数校验**接受字符串 filter**与 **`{expr,name}` measure** | `webui/server/proxy/mcp-proxy.ts:958-1019`、`:1491` 一带、`webui/server/proxy/acl.ts:2024` |
| E6 | 数据面工具集合：`lucy_query` / `lucy_read_source` / `lucy_explain_query` / `lucy_freshness` / `entity_details` / `sl_validate`；`lucy_freshness` 只返回来源身份与 mtime，**不返回列** | `webui/server/proxy/acl.ts:86-93`、`webui/server/proxy/mcp-proxy.ts:1647-1689` |
| E7 | `lucy_explain_query` 是**本地**诊断（`executionMode: "plan_only"`、`executed: false`），但承接与 `lucy_query` 同形的字段入参 | `webui/server/proxy/mcp-proxy.ts:1576-1620`、`webui/server/proxy/row-policy.ts:457-459` |
| E8 | 旧 `sl_query` / `sl_read_source` 默认在 `deny_tools` 里，默认不可授予；`deny_tools` 命中即硬拒（优先于授予） | `webui/server/proxy/acl.ts:152-159`、`webui/server/proxy/acl.ts:3062` |
| E9 | 语义层是 **manifest／overlay 双层**：`_schema/<schema>.yaml` 是 manifest（仓库物理表结构，ktx 扫描 warehouse 自动生成），`<table>.yaml` 是 overlay（grain、columns 含 `expr` 派生列、measures、segments、joins） | `docs/governance/DEVELOPMENT.md:344-357`、`webui/server/semantic-layer.ts:271-275`（manifest 路径）、`webui/server/semantic-layer.ts:320-331`（overlay 路径） |
| E10 | 「全物理列」合同的实际落点是 semantic-author lint：standalone source（带 `table:`）**必须声明全部物理列**（"With table:, include ALL physical columns — KTX will not merge Manifest"）；只有派生列会被判错 | `.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147` |
| E11 | 表语义工作台的字段列表取自 **manifest 物理列**（`modelFromTable` 从 manifest 的 `tables[<table>].columns` 建 `model.columns`；overlay 只贡献 grain／measures／segments／joins） | `webui/server/semantic-layer.ts:377-408`、`webui/server/semantic-layer.ts:578-601`、`webui/src/pages/TableEditor.tsx:102-115`、`:139-147`、`:440-448`、`:163`（「字段」分区标签） |
| E12 | 工作台字段的正常维护动作是**改描述**，写回的是 manifest 的 `columns[].descriptions.human`（增量补丁），不改列本身 | `webui/server/semantic-layer.ts:646-660`、`webui/src/pages/TableEditor.tsx:146-147` |
| E12b | **现行工作台保存会写入内容文件**，随后才校验（`semantic-layer.ts` 保存路径 ≈ `:776`；`index.ts` 校验 ≈ `:884`）。对本条暴露台账，**不得**沿用「先写运行内容根再校验」——见 D18 | `webui/server/semantic-layer.ts` 保存路径、`webui/server/index.ts` 校验路径 |
| E13 | 发布扫描的内容根与种类只有三类：`semantic_overlay` / `schema_manifest` / `wiki`；**注意有四个不同的判定点**：`publish-workbench-state.ts:169-172` 的 `semanticKind()` 只把 `_schema` 目录（`parts[0]`）判为 manifest；同文件 `:752-757` 的 `kindForLogicalPath()` 才按 `semantic-layer/<conn>/_schema`（`parts[2]`）判 manifest；`semantic-assets.ts:1714-1718` 的 `kindForPendingPath()` 只认 `filePath.includes("/_schema/")`，其余一律 `semanticSource`；`semantic-assets.ts:637-726` 的 `classifyYaml()` 对既非 manifest 又非 overlay 的 yaml 返回 `UNKNOWN_SHAPE` **硬失败**（`:726`） | `webui/server/publish-workbench-state.ts:169-172`、`webui/server/publish-workbench-state.ts:752-757`、`webui/server/semantic-assets.ts:1714-1718`、`webui/server/semantic-assets.ts:637-726` |
| E14 | 「待发布」＝当前内容根与 baseline 之间的差异（baseline 落在 `.ktx-ui/publish-workbench/baseline.json`）；发布 = 校验 → 门禁 → 提升到内容根 → 重建索引 | `webui/server/publish-workbench-state.ts:41`、`:105`（`PublishBaseline`）、`:214-234`（`scanPublishContent`） |
| E15 | 发布硬失败已有落点：门禁不通过时写 `blocked` 发布记录并抛 `SemanticAssetValidationError("VALIDATION_GATE_FAILED")`，错误明细按 `code`/`message`/`filePath` 逐条给出；上传快照在无 changed source 时也可能直接失败——**不能**假定「只改台账」天然可走通 | `webui/server/semantic-assets.ts:2338`、`:3056-3129` |
| E16 | 门禁检查项可登记、不可豁免（`NON_WAIVABLE_CHECKS`），豁免是**限时带审计**的单项 waiver，且永不豁免 `ALL_CHECKS` 与 `contract_presence` | `webui/server/publish-gate.ts:19-22`、`:60-92`、`:110-141`、`:209-226` |
| E17 | 列类型合同检查已有同族实现（`checkColumnTypeContract` → `columns.<i>.type`），可作为新增暴露引用的模板 | `webui/server/publish-gate.ts:155-176`、`webui/server/semantic-assets.ts:3063-3076` |
| E18 | 索引重建：`POST /api/semantic-assets/reindex` 在发布协调窗口内执行 `ktx admin reindex`；发布窗口由 coordinator 独占；**manual reindex 不调用上传门禁段**——本条须另定生效入口检查 | `webui/server/index.ts:2664-2702`、`webui/server/ktx.ts:186-211`、`webui/server/publish-coordinator.ts:33`、`:391-430` |
| E19 | 内容根解析：`LUCY_CONTENT_ROOT` 或 `ktx.yaml paths.content_root` → `ContentPaths`，其下固定四目录 `semantic-layer` / `wiki` / `evals` / `skills` | `webui/server/paths.ts:20`、`:41-53`、`:85-102`、`:107-123` |
| E20 | 现有物理列清单的权威读取器：读 `semantic-layer/<conn>/_schema/<schema>.yaml`，按 `tables[<table>].columns[].name` 取列，失败按 `resolve`/`read`/`parse`/`catalog` 四阶段归因，**三种结局都 fail-closed** | `webui/server/proxy/row-policy-catalog.ts:50-53`、`:289-304`、`:337-413`、`:437-507` |
| E21 | 现行治理口径：表级 ACL 为基线，**不做列级脱敏**，不承诺列级 masking | `docs/governance/vision.md:139`、`:219` |
| E22 | 合规侧「库内不可见」的既有兜底是 VIEW-as-pseudo-table（物理 VIEW + 独立 semantic source + tableSelector），不是产品化「勾选删列」 | `docs/access-control/design-governance-baseline.md:158-170`、`docs/access-control/design-upgrade.md:649-651` |

### 1.3 取证缺口（写明「未核实」，不得当作事实）

- **KTX 上游 loader 是否忽略 `semantic-layer/<conn>/` 下除 `_schema` 外的下划线目录**：未核实（KTX 上游不在本仓，`node_modules/@kaelio/ktx` 不含 Python loader 源码）。这直接决定暴露台账的落点（见 D2 与 Plan「开工前置」）。
- **KTX `sl_read_source` 返回体的确切字段形状**（列数组的键名与层级）：未核实（本仓只看到 Proxy 的改写与转发，见 E3）。裁剪实现须在开工前以真实上游返回体固化形状。
- **KTX 是否接受语义层 overlay 顶层新键**：未核实。因此暴露集**不**放进 overlay 文件（见 D2）。
- **四个上游透传入口的返回体是否含列／字段名**（F-R2-04／D26）：`entity_details` / `sl_validate`（`acl.ts:86-93` 的 `DATA_PLANE_TOOLS`）、`dictionary_search` / `discover_data`（`acl.ts:180` 的 `DEFAULT_SENSITIVE_METADATA_TOOLS`）**不在 Proxy 本地执行集内**——本地执行点只有 `mcp-proxy.ts:4456`（`connection_list`／`lucy_catalog`／`kx_catalog`）与 `:4579-4581`（`lucy_explain_query`／`lucy_freshness`）；专用语义响应出口（`mcp-proxy.ts` ≈ `:6246`）仅接管 `lucy_query`／`lucy_read_source`，**不能**证明四工具已覆盖。仓内仅有 ACL／审计／参数表抽取取证，**无真实成功载荷样本证明是否含字段名**。逐项合同见 D26／SC-30；**首期默认对 trimmed 作用域 fail-closed（零上游），不得假装 A1 已闭环**。取证完成后：含字段名 → 纳入统一读取器并补 SC；不含 → 登记证据与适用版本后可改为放行。
- **真实 MCP 响应载体全集**（纯 JSON-RPC、SSE、文本／未知 content-type）：未在本条穷尽实测。下行裁剪关闭策略必须以开工前核对结果冻结（见 §3.2b／SC-22）。
- 需求池 REQ-030-012 引用的 `webui/docs/48` 系列「表语义工作台既有 Spec」已核实为 `webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`（E11/E12 涉及的实现面在其 §「Table Semantic Workbench Requirements」）。

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | **库存与暴露分离**：Manifest／扫描保留全量物理库存（不改 KTX「全物理列」合同、不手删 Manifest 列、不改库表结构）；暴露集是 Lucy 侧**另册**，只作用于 Agent 数据面 | 需求池方向；E9/E10/E22 表明「删列」路径要么违反上游合同要么退化成 VIEW 兜底 |
| D2 | **暴露台账是内容根内的版本化文件**，仅随**成功发布激活**进入运行内容根；浏览器本地状态**不参与**判定。运行面只读**已激活**台账，不把「内容根里任意文件＝已发布」当作充分条件——须满足 D18 激活边界 | 硬约束①。内容根由发布提升（E14），台账随成功激活批次走即版本化；读取口是 `loadContentPaths()`（E19），与发布写集同源 |
| D3 | **落点候选**：`semantic-layer/<conn>/_exposure/<source>.yaml`；**若 KTX loader 会把该目录当 source 加载**（未核实），改落 `<contentRoot>/exposure/<conn>/<source>.yaml`，并扩 `CONTENT_DIR_NAMES`（E19 的四个目录是硬编码常量）与发布扫描根（E13） | 两条候选路径的改动面都可在本仓指认；KTX 侧行为未核实，故列为 Plan 前置而非既成事实 |
| D4 | **发布扫描必须新增台账种类，且要改的是四处判定点**：真正决定「什么被当 overlay 上传给 KTX」的**不是** `semanticKind()`，而是 `semantic-assets.ts` 的 `kindForPendingPath`（不含 `/_schema/` 一律 `semanticSource`，`:1714-1718`）与 `classifyYaml`（无 `tables:`／`name:` 一律 `UNKNOWN_SHAPE` **硬失败**，`:637-726`）；`semanticKind()`（`publish-workbench-state.ts:169-172`）只判 `parts[0] === "_schema"`，在现行布局 `semantic-layer/<conn>/_schema/<schema>.yaml` 下**匹配不到 manifest**（`kindForLogicalPath` 才按 `parts[2] === "_schema"` 判，`:752-757`）。**台账 yaml 会落 `classifyYaml` 的 `UNKNOWN_SHAPE` 硬失败**——这不是「被当成 overlay 上传」，因此新增种类必须同时改：`semanticKind`／`kindForLogicalPath`／`kindForPendingPath`／`classifyYaml` 四处 | 新增 `field_exposure` 种类，且该种类**不**参与 KTX 上传；⚠️ 只改 `semanticKind` 不改其余三处 → 台账要么被判 `semanticSource` 上传，要么在 `classifyYaml` 硬失败，两条都不是本条要的行为 |
| D5 | **台账以「排除集」编码**：`excluded_columns`（未暴露物理列），暴露集 = 库存 − 排除集 | 直接满足 C2（新物理列默认暴露，无需在扫描时改台账）与「存量无显式配置 = 全库存暴露」（排除集为空／无台账文件）两个口径，且不需要在扫描管线里插入写操作 |
| D6 | **暴露粒度 = Source，跨实例一致**：暴露集按 Source 唯一（`connectionId` + `schema` + `sourceName`）定义，**不按 Role／Agent 异列**；所有实例看同一套采用集 | 需求池「全实例同一套采用集」；这是本条与列级 ACL 的分界 |
| D7 | **暴露集只覆盖物理列**：overlay 派生列（`columns[].expr`）、measures、segments、joins **不在**暴露集内；它们只能**引用**暴露列 | 派生列不是物理库存；把它们纳入排除集会与 B1（引用一致性）语义打架 |
| D8 | **失败关闭：台账「不存在」且期望集合可信且未登记该 Source 是配置态，fail-open（= 全暴露）；台账「存在但不可用」或「期望已登记但文件丢失」或「期望集合自身不可用」是故障态，fail-closed（拒绝）** | 缺失且从未配置＝该 Source 未做裁剪＝存量默认；存在却解析失败／版本不受支持／期望登记后丢失／期望集合加载失败＝运行面无法确定权威集合，若放行等于静默恢复被裁掉的列 → 拒绝。期望集合自身故障见 D25；不得把期望集合加载失败当成空集合 |
| D9 | **半通禁令**：发现面与查数面必须使用**同一份已激活暴露集、同一版本、同一 digest**，且**裁剪集合完全相等**——发现面不可见的列集合 == 查数面被拒的列集合 | 需求池硬约束②。可打假的检查见 §3.6 与 SC-07 |
| D10 | **查数面判定覆盖全部字段载体**，且**兼容现行合法参数形状**：`dimensions[].field` / `filters`（**对象** `{field,…}` **与存量字符串 filter**）/ `order_by｜orderBy[].field` / `measures[]`（**字符串语义键**或 **`{expr,name}` 对象**）/ `segments[]`。字段引用按**源限定名**解析（取 `<source>.<column>` 的列名部分，归一化小写）。对 `{expr,name}`：暴露检查解析 `expr` 内列引用，不把「仅有 `{name}`、无非空 `expr`」当作合法 ad hoc 形状（现行要求非空 `expr`）。**不得**为做本条检查而全局调用 `validateProtectedLucyQueryArgs`（该函数拒绝字符串 filter 与对象 expr measure，仅属 scoped 行策略专用） | E5；REQ-030-013 教训；Codex R1 F-05 |
| D11 | **`lucy_explain_query` 同样受查数面判定约束**（本地诊断、不执行上游） | E7；否则 Agent 可用 explain 探知未暴露列的名字，绕开发现面裁剪 |
| D12 | **B1 硬失败且不可豁免**：新增 `exposure.*` 检查族，并入既有发布门禁（E15/E17）。**机制要求（不可豁免判定必须支持前缀族）**：现行 `NON_WAIVABLE_CHECKS` 是**精确字符串集合**，豁免判定为 `!NON_WAIVABLE_CHECKS.has(violation.checkId)`（`publish-gate.ts:19-22`、`:130`），豁免侧 `exemption.checkIds.includes(violation.checkId)`（`:98`）同样是精确匹配——**不存在任何前缀族机制**。故本条必须**新增前缀判定**（如 `NON_WAIVABLE_PREFIXES = ["exposure."]`），并把 `applyPublishExemption` 的「是否可豁免」判定改为「精确命中 **或** 前缀命中」；若不引入该机制而只往字面量集合塞 `"exposure.*"`，§3.4 实际产出的 `exposure.unavailable` / `exposure.grain.<col>` / `exposure.measure.<name>.<col>` 等动态 id **一个都不匹配**，全部仍可被限时豁免 | 豁免会重新造出「一面已裁一面仍通」的半通态；且需求池写明「硬失败」。⚠️ 前缀族机制属**实现改动面**（`publish-gate.ts`），不是零成本声明 |
| D13 | **拒绝码分两个**：`field_not_exposed`（点名了未暴露列）、`field_exposure_unavailable`（台账不可用／期望丢失／期望集合自身不可用／代次不可解析／四透传首期 trimmed 阻断）。二者都只进机器码与审计，**对外不承诺隐藏字段存在性** | 本条**不是**安全边界（D15），因此不为「存在性保密」付代价；但两个码必须分开，否则运维无法区分「用错字段」与「配置／代次坏了」 |
| D14 | **工作台字段列表 = 全量库存 + 暴露开关**：取消暴露的列**仍在列表里**（可恢复），变更进**草稿／待发布**（D18），不直接激活 | D1（库存保留）；需求池 D1；E11/E12（字段列表已由 manifest 物理列驱动） |
| D15 | **交付口径必须写明「业务暴露裁剪 ≠ 列级安全」**：工作台文案、帮助文案、发布说明三处都写；本条**不**提供列级 ACL／脱敏／按 Role 异列，**不**替代合规用 VIEW | 需求池硬约束④；E21 现行口径已声明不做列级脱敏；E22 合规兜底仍是 VIEW |
| D16 | **不改 KTX 上游源码**：闸门只落在 Lucy 侧（Proxy 门面 + 发布门禁 + 工作台） | 需求池「不改 KTX 全物理列合同作为主路径」；本仓是 Lucy 仓，KTX 是外部依赖 |
| D17 | **不手改 semantic-author 的「全物理列」规则**，只在文档与提示里补一句「暴露裁剪 ≠ 删列；库存仍须全量」 | E10：该规则是上游合并合同，改它等于改 KTX 合同 |
| D18 | **激活边界（草稿／候选／已激活）**：① **草稿（draft）**：工作台保存／编辑产生的待发布变更，**不得**被 Proxy 运行面读取为生效暴露集；② **候选（candidate）**：进入发布／生效校验的完整合并状态（baseline＋待发布，含台账与全部 overlay／manifest）；③ **已激活（activated）**：发布门禁通过且索引／激活步骤成功后，确认一个新的**执行代次**（D23），供运行面 pin。校验失败、索引失败、激活确认失败、重启、回滚 → 运行面**保持上一成功已确认执行代次**（不得因磁盘已提升文件而混读新定义＋旧台账）。单次 MCP／HTTP 请求在入口固定一份 `ActivatedSnapshot`（＝该执行代次），发现面与查数面共用，禁止中途换代 | Codex R1 F-02；Codex R2 F-R2-01；E12b／E18 |
| D19 | **独立期望台账集合（expected ledger set）**：在台账文件之外持久化「哪些 Source **曾配置／应存在**暴露台账」。首次对某 Source 做裁剪发布成功时登记；显式「恢复全暴露」发布成功时从期望集合移除并删除／清空台账；Source 删除时同步移除期望项；回滚到无该 Source 配置的内容根版本时期望集合随内容根／旁路期望文件一并回退。标记**不得**只放在台账自身（文件丢失后无法区分）。期望已登记但文件缺失／不可读 → `unavailable`（SC-23／SC-24）。期望集合**自身**缺失／损坏／版本不匹配的故障语义见 D25（禁止退化为空集合） | Codex R1 F-09；Codex R2 F-R2-03；原 RES-06 |
| D20 | **查数门禁顺序：先对象授权，再业务暴露**：在 `authorizeAndRewrite` 内，本条字段暴露检查必须发生在**连接授权 + 表／capability 授权已完成后**，且**不得**被行策略提前 `return` 绕过（对已授权的 `lucy_query`／`lucy_explain_query`）。对**未通过**对象授权的请求，直接返回原有 ACL reason，**禁止**改写为 `field_not_exposed`／`field_exposure_unavailable`，也不得在错误体中泄露暴露配置状态。通配表权限（`tables:["*"]`）在通过对象授权后**仍须**做暴露检查 | Codex R1 F-04；E4 |
| D21 | **发现面字段载体统一读取器**：凡 Agent 可见的字段名载体（`lucy_read_source` 列数组、`catalog.examples`、注入 `initialize` 的 examples、Hive 成功载荷 `columns`）必须经同一 `loadExposureSet`／同一 digest 裁剪或改写。`lucy_catalog`／`kx_catalog` 的 **sources 表列表**可不因暴露集变化（SC-12）；但其中 **examples 等字段载体必须裁**。四透传工具**不**纳入本统一读取器，直至取证裁决「含字段名」；取证前走 D26 首期 fail-closed，**不得**以「开工前再确认」推迟合同 | Codex R1 F-07；Codex R2 F-R2-04；E1b／E3b |
| D22 | **上行前准入 vs 下行裁剪**：台账可用性（含期望丢失／期望集合不可用）检查必须在**转发上游取数之前**完成（可断言零上游）；列裁剪发生在上游响应返回后。下行路径上 JSON／SSE／文本／未知形状／裁剪异常 → **fail-closed 拒绝或安全空结果**，**绝不**恢复／透传原始全量 body（不得继承 E3 现行降级） | Codex R1 F-08 |
| D23 | **执行代次一致性（ExecutionGeneration）＝ Proxy 视图 ∧ 实际上游执行**：运行面每一次请求必须 pin 同一代次的完整视图，至少包含：`generationId`、暴露台账集与 digest、期望集合与 digest、**该代次的语义定义视图**（manifest／overlay／派生定义，供暴露检查与 B1 同源解析）、**索引消费／激活确认版本**（与发布消费证据对齐）、以及 **`upstreamExecutionGenerationId`**（实际上游 KTX／索引当前被允许消费的代次；开放准入时必须与 `generationId` 相等）。仅证明两面暴露 digest 相同或 Proxy 快照内部标签相等**不足以**排除「V1 台账 + V2 定义」混代，也不足以排除「Proxy 仍 pin V1 但上游已按 V2 执行」。切换窗口内：新请求绑定**当前已确认 serving generation**；在途请求保持入口 pin。磁盘文件已提升但索引失败／激活未确认 → serving generation **不变**。**上游绑定／隔离（F-R2-01 必选其一，Plan 前置冻结）**：① **代次隔离上游**：staging 索引／内容指针，仅在激活确认时原子切到新代，旧代上游在切换前持续服务；或 ② **无法保持旧代上游时强制隔离流程**：`STOP_ADMISSION`（停止会触达语义上游执行的新请求准入）→ `DRAIN`（排空在途上游绑定请求）→ 再改共享索引 → 若激活确认失败则 **先回滚上游到旧代或保持 STOP**，成功后再 `RESUME_ADMISSION`。**硬禁令**：索引成功而激活确认失败时，**不得**出现「上游已消费 V2 定义 + `ServingGeneration` 仍为 V1 + 准入开放」。重启后从耐久激活记录恢复 serving 与上游绑定；记录缺失／损坏 → 故障关闭（D25），不得 silently 读裸磁盘混拼 | Codex R2／R3b F-R2-01；E18；`semantic-assets.ts` 先提升文件再异步索引 |
| D24 | **暴露作用三态与解析适用范围**：对每个 Source 在可信期望集合下区分：① `unconfigured`（从未配置）；② `full_expose`（已配置且 `excluded_columns` 为空＝显式全暴露）；③ `trimmed`（已配置且排除集非空）。**仅 `trimmed` Source（及其作为目标的引用）触发本条字段暴露硬拒与 B1 `exposure.*` 违规**（含 `exposure.unparseable.*`）。`unconfigured`／`full_expose` **不得**因本条新增「解析失败／无法消歧」硬拒——存量字符串 filter、`{expr,name}`、无关 overlay 保持既有行为。另区分：合法零列库存或合法「排除后零可见列」≠ 解析失败 ≠ 无法消歧；后两者只在 trimmed 作用域（或引用闭包触及 trimmed 目标）fail-closed | Codex R2 F-R2-02 |
| D25 | **期望集合可信初始化与不可用态**：期望集合必须有显式加载状态 `ready`｜`unavailable`，**禁止**把「读失败／损坏／版本不支持／与执行代次不匹配」当成 `ready(∅)`。可信空集合只允许来自：① 功能尚未启用时的耐久哨兵（`expectedSetRequired=false` 且激活记录认可「无期望制品」）；或 ② 已成功写入的版本化空文档（有 schema version + digest）。一旦某次暴露激活将 `expectedSetRequired=true`，此后缺失／不可读／损坏／unsupported version／与 `generationId` 不匹配 → `unavailable`；此时**所有** `loadExposureSet` 返回 `state=unavailable`（reason=`expected_set_*`），数据面 fail-closed，**不得**退化为「全 Source 未配置＝全暴露」。落点／文件名仍开放（Plan 前置），故障语义本条闭合 | Codex R2 F-R2-03 |
| D26 | **四透传工具首期合同（取证前）**：对 `entity_details`／`sl_validate`／`dictionary_search`／`discover_data`，仓内**无**成功载荷字段名证据（§1.3）。首期默认：① **不宣称 A1 覆盖这四入口**；② 当请求作用域触及任一 `trimmed` Source（或敏感元数据工具／空抽取路径在实例上存在任一 trimmed Source 且无法证明载荷无字段名）→ **上行前 fail-closed**（`field_exposure_unavailable` 或登记专用码），**零上游**，禁止原文透传；③ `unconfigured`／`full_expose` 作用域、且实例**无** trimmed／期望故障时，不因本条新增拒绝。**控制流硬约束（R3b）**：门禁必须挂在**各工具既有授权通过之后、转发上游之前的必经路径**——`entity_details`／`sl_validate` 在 `tableTouchingTools` 授权通过后；`dictionary_search`／`discover_data` 在 `sensitiveMetadataTools` 授权通过后（源码默认二者**不在** `DEFAULT_TABLE_TOUCHING_TOOLS`，见 `acl.ts:170-181`）。**禁止**把四工具检查嵌在「仅 `if tableTouchingTools.has(toolName)`」分支内，否则后两者永远不执行。**空作用域硬约束（R3c）**：`entity_details`／`sl_validate` 无 Source 参数、或 `extractPassthroughSources`／既有 `extractTables` 结果为空集合时，**必须**归类为 `INSTANCE_WIDE`（不得落入 `involved=[]` 空循环直接 `touchesTrimmed=false` 放行）。源码抽查：空表 ACL 分支仅在**同时**具备通配 `tables:["*"]` **与**「全敏感表显式授权」（及其余准入）时才可越过空表拒绝（`acl.ts` 抽取器 ≈ `:1970`／空表授权 ≈ `:3249-3266`；仅通配或仅全敏感显式仍会 `explicit_table_required:<empty>`），**不得**依赖 ACL 自动堵住该路径。`scope.unavailable` 裁决见 §3.3 `resolvePassthroughScope`（保守：无法证明安全则拒）。取证待办（Plan S3c）：逐工具抓载荷；含字段名→纳入 D21；不含→登记后解除 fail-closed。**实现期不得临时决定** | Codex R2／R3b／R3c F-R2-04 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：暴露集读取与版本化来源（对应 D2／D5／D8／D18／D19／D23／D25）

```text
# 位置：新增 webui/server/proxy/field-exposure.ts（读取器，纯函数 + 文件读）
# 目标：暴露集只来自「已确认执行代次」视图；浏览器本地／草稿不参与
#
# 台账格式（候选；格式在开工前冻结，见 Plan 前置）：
#   semantic-layer/<conn>/_exposure/<source>.yaml
#     version: 1
#     source: {connectionId: <conn>, schema: <schema>, sourceName: <source>}
#     excluded_columns: [<物理列名>, ...]
#     updated_at: <iso8601>
#
# 期望集合（独立于台账文件；落点候选见 Plan S2c，开工前冻结）：
#   例如 contentRoot 旁路 `.ktx-ui/field-exposure/expected-ledgers.json`
#   或随发布提升的独立期望清单文件——不得仅写在台账 yaml 内
#   加载必须返回 ExpectedSetLoad{ state: ready|unavailable, ... }（D25）
#
# 语义：暴露集 = 该 Source 的物理库存 − excluded_columns
#       排除集为空且已配置 ⇔ full_expose（仍属 configured）
#       无台账且期望可信未登记 ⇔ unconfigured（从未配置）

enum ExposureState:
    unconfigured      # 台账不存在且期望可信未登记：从未配置（配置态）
    configured        # 台账存在且可读（再由 excluded 空／非空分为 full_expose / trimmed）
    unavailable       # 台账损坏／版本不受支持／串源；
                      # 或期望已登记但台账缺失／不可读；
                      # 或期望集合自身 unavailable（D25）

enum ExposureMode:    # D24 三态（仅 state==configured|unconfigured 时有意义）
    unconfigured
    full_expose       # configured ∧ excluded == ∅
    trimmed           # configured ∧ excluded ≠ ∅

# 执行代次 + 单请求固定快照（D18／D23）：
#   ServingGeneration = last successfully confirmed ExecutionGeneration
#   ExecutionGeneration = {
#     generationId,
#     exposureLedgersBySource, exposureDigestPerSource,
#     expectedSetLoad,           # ready|unavailable + digest
#     semanticDefinitionView,    # manifest/overlay/派生定义的代次绑定视图（非「磁盘最新」）
#     indexConsumptionVersion,   # 与发布消费／激活确认对齐
#     upstreamExecutionGenerationId,  # 实际上游允许消费的代次；OPEN 时 == generationId
#     activatedAt
#   }
#   在 MCP tools/call（或等价入口）开始时：
#     先检查 AdmissionMode（§3.1c）；再 snapshot = pin(ServingGeneration)
#   同请求内发现面与查数面必须读 snapshot，禁止中途 reload／禁止改读磁盘最新
#   ⚠️ pin 快照内部一致 ≠ 上游已绑定同代；开放准入还须上游绑定不变量成立

function loadExpectedSet(snapshot) -> ExpectedSetLoad:
    # 实现读耐久制品；此处只定语义
    if artifact is TRUSTED_EMPTY_SENTINEL:          # expectedSetRequired=false 或版本化空文档
        return ExpectedSetLoad(state = ready, set = ∅, digest = knownEmptyDigest)
    if artifact MISSING or UNREADABLE or CORRUPT
       or version unsupported
       or artifact.generationId != snapshot.generationId:
        return ExpectedSetLoad(state = unavailable, reason = ...)
        # ⚠️ 禁止：return ready(∅)   ← F-R2-03 反例
    return ExpectedSetLoad(state = ready, set = parsed, digest = sha256(...))

function loadExposureSet(conn, schema, sourceName, snapshot) -> ExposureSet:
    if snapshot.expectedSetLoad.state == unavailable:
        return ExposureSet(excluded = ∅, state = unavailable, mode = null,
                           digest = null, reason = snapshot.expectedSetLoad.reason)
        # 全体 Source 进入故障关闭；不得按「空期望」走 unconfigured 全暴露

    expected = snapshot.expectedSetLoad.set.contains(conn, schema, sourceName)
    ledger = snapshot.readLedgerFile(conn, sourceName)
        # 必须来自 pin 的 semantic/exposure 代次视图，不是「内容根此刻文件」

    if ledger is MISSING:
        if expected:
            return ExposureSet(excluded = ∅, state = unavailable, mode = null,
                               digest = "missing-after-expected", reason = "expected_ledger_missing")
        return ExposureSet(excluded = ∅, state = unconfigured, mode = unconfigured,
                           version = null, digest = null)

    parsed = parseYaml(ledger.text)
    if parsed is INVALID:
        return ExposureSet(excluded = ∅, state = unavailable, mode = null, ...)
    if parsed.version is not SUPPORTED_VERSION:
        return ExposureSet(excluded = ∅, state = unavailable, mode = null, ...)
    if parsed.source does not match (conn, schema, sourceName):
        return ExposureSet(excluded = ∅, state = unavailable, mode = null, ...)

    excluded = normalizeColumnNames(parsed.excluded_columns)
    mode = (excluded is empty) ? full_expose : trimmed
    return ExposureSet(excluded = excluded, state = configured, mode = mode,
                       version = parsed.version, digest = sha256(ledger.text))
```

```text
# 失败关闭口径（D8）——单点判定，所有面向共用
function exposureDecision(exposureSet, toolName, sourceRef):
    if exposureSet.state == unavailable:
        return deny(reason = "field_exposure_unavailable", source = sourceRef)
    if exposureSet.mode == unconfigured or exposureSet.mode == full_expose:
        return allow(fullInventory = true, mode = exposureSet.mode)
    return allow(fullInventory = false, excluded = exposureSet.excluded, mode = trimmed)
```

### 3.1b 激活边界与失败恢复（对应 D18／D23／F-02／F-R2-01）

```text
# 草稿：工作台保存暴露开关 → 只写入待发布／草稿区（或 pending diff），
#       不更新 ServingGeneration；Proxy 仍 pin 上一已确认执行代次
# 候选：publish / 生效入口组装 CandidateState =
#       merge(baseline, pending)  # 含全部 overlay/manifest/台账/期望集合
# 已激活：门禁通过 ∧ 上游执行代次已与新代对齐（或隔离流程完成）∧ 激活确认成功
#       → 原子发布新的 ExecutionGeneration 并切换 ServingGeneration
#       （台账、期望集合、语义定义视图、indexConsumptionVersion、
#         upstreamExecutionGenerationId 同代切换）
#
# 上游执行绑定策略（D23；Plan 前置二选一冻结，不得实现期临时改口）：
#   Strat-A 代次隔离上游：候选索引／内容在 staging；serving 旧代 KTX 继续服务；
#            激活确认时原子切指针，使上游与 Proxy 同刻切到 V2。
#   Strat-B 共享上游不可保持旧代时 → 强制隔离流程（见 §3.1c）：
#            STOP_ADMISSION → DRAIN → mutate shared index →
#            成功则确认激活并 RESUME；失败则 rollback 上游到旧代（或保持 STOP）后再 RESUME。
#
# 失败恢复（磁盘提升 ≠ 运行代次切换；索引成功 ≠ 可开放准入）：
#   - 门禁失败 / 校验失败 → 不切换；草稿可保留供修正；上游不动
#   - 文件已提升但索引失败 → ServingGeneration 不变；上游仍旧代；激活未确认
#   - 索引成功但激活确认失败 → ServingGeneration 不变；
#       **必须**保证：要么上游仍旧代，要么准入保持 STOP 直至上游回滚到旧代或完成 V2 激活；
#       **禁止**「上游已跑 V2 + serving 仍 V1 + 准入开放」
#   - 中途重启 → 从耐久激活记录恢复 ServingGeneration 与上游绑定状态；
#       若记录显示「过渡中／上游代次 ≠ serving」→ 启动时保持 STOP 直至恢复完成
#   - 回滚发布 → ServingGeneration 与上游绑定一并回退到目标执行代次（含期望集合）
#
# 并发：同一发布窗口由 publish-coordinator 串行化；
#       请求中已 pin 的 snapshot 不因并发发布中途换代（SC-25／SC-26）
```

### 3.1c 切换期请求规则与混代禁令（对应 D23／F-R2-01）

```text
# 反例（必须用验收打死；观察实际消费定义，不只快照标签）：
#   V1：trimmed，隐藏物理列 secret；某 measure M 引用公开列
#   V2：恢复暴露 secret，并把 M 改为引用 secret（或新增派生引用 secret）
#   切换窗口若 Proxy pin V1 台账／定义视图，但上游 KTX 已按 V2 索引执行 →
#     同名 measure 实际算出「含 secret 的 V2 语义」，暴露门禁却按 V1 放行／裁剪 → 半通
#   「两面 exposure digest 相同」「snapshot 内部 generationId 彼此相等」
#   都不能单独作为通过条件——须断言上游实际消费定义代次

enum AdmissionMode:
    OPEN                 # 正常：upstreamExecutionGenerationId == ServingGeneration.generationId
    STOP_ADMISSION       # 过渡／故障：拒绝新的会触达语义上游执行的请求
                         # （至少：lucy_query／lucy_read_source／四透传／Hive 等价取数；
                         #  本地-only 如 lucy_explain_query／catalog 仍 pin 旧 snapshot）
    DRAINING             # 已 STOP；等待在途上游绑定请求结束（或超时取消）

onToolsCallEntry():
    if AdmissionMode in {STOP_ADMISSION, DRAINING}:
        if requestWouldHitUpstreamSemanticExecution(toolName):
            return deny("field_exposure_unavailable")   # 或登记 generation_transition 码
    if ServingGeneration is UNRESOLVABLE:          # 激活记录损坏等
        pin snapshot with expectedSetLoad=unavailable  # 全面 fail-closed
    else:
        pin snapshot = ServingGeneration
        # snapshot 必须携带 upstreamExecutionGenerationId（开放准入时 == generationId）

# 切换期间 — Strat-A（隔离上游）：
#   - 新请求：pin 旧 ServingGeneration；上游仍执行旧代索引／内容
#   - 在途请求：保持各自入口 pin
#   - 原子切换点：激活确认 ∧ 上游指针切到 V2 同事务／同屏障后，
#                 ServingGeneration := newGeneration；此后新请求才 pin V2 全套

# 切换期间 — Strat-B（共享上游将被迫改到 V2 时）：
#   1) STOP_ADMISSION
#   2) DRAIN 在途上游绑定请求（超时 → 取消并记审计）
#   3) 才允许重建／切换共享 KTX 索引到 V2
#   4a) 激活确认成功 → ServingGeneration := V2；upstreamExecutionGenerationId := V2；RESUME
#   4b) 激活确认失败 → 必须 rollback 上游索引／内容到 V1（或等价旧代），
#       成功后 Serving 保持 V1 且 RESUME；若回滚失败 → 保持 STOP，不得 OPEN
#   硬禁令：步骤 3 之后、4a／4b 完成之前，AdmissionMode 不得回到 OPEN

assertForAnyRequest(snapshot):                    # Proxy 内部一致性（必要但不充分）
    snapshot.exposureGenerationId
      == snapshot.definitionGenerationId
      == snapshot.indexConsumptionVersion.boundGenerationId
      == snapshot.expectedSetLoad.generationId   # when ready
    if AdmissionMode == OPEN:
        snapshot.upstreamExecutionGenerationId == snapshot.generationId

# SC-25／SC-26 额外观察点（充分条件）：
#   构造 V1／V2 同名 measure 语义分叉（如上 secret 反例）；
#   在切换窗与「索引成功+激活失败」窗内发起实际上游查询，
#   断言返回语义 ∈ 当前 OPEN 代次的定义，**不得**出现 V2 执行结果配 V1 serving 门禁。
```

### 3.2 流程 2：发现面裁剪——上行前准入 + 下行裁剪（对应 D9／D21／D22）

```text
# === 上行前准入（零上游可断言）===
# 位置：转发 lucy_read_source / Hive 等价取数 / 其他需上游字段载荷的工具之前
function admitSourceForDiscovery(src, snapshot):
    exposure = loadExposureSet(src.conn, src.schema, src.sourceName, snapshot)
    decision = exposureDecision(exposure, toolName, src)
    if decision is deny:
        return writeToolDenial(requestId, decision.reason)   # 零上游
    return {exposure, decision}

# === 下行裁剪（上游已返回后）===
# 位置：writeLucySemanticResponse；以及 Hive 分流成功出口；不得只改一处
function applyDiscoveryTrim(payload, exposure, decision, carrierKind):
    if decision.fullInventory:
        return annotateMeta(payload, exposure)
    trimmed = stripUnexposedFieldCarriers(payload, decision.excluded, carrierKind)
    # carrierKind ∈ { read_source_columns, hive_columns, ... }
    if trimmed is PARSE_OR_TRIM_FAILURE:
        return denyOrSafeEmpty(reason = "field_exposure_unavailable")
        # ⚠️ 禁止 restoreOriginalBody / 原文透传（D22；不得继承 E3 降级）
    return annotateMeta(trimmed, exposure)

# catalog.examples / initialize（本地，无上游取数）：
function buildCatalogForAgent(identity, snapshot):
    catalog = lucyCatalog(identity)           # sources 列表按既有表级授权，不变（SC-12）
    catalog.examples = rewriteExamples(catalog.examples, snapshot)
    #   示例中点名未暴露列 → 删除该示例或改写为仅含已暴露列的合法示例
    #   不得把未暴露列名留在 examples / initialize instructions 中
    return catalog

# 统一读取器：strip / rewrite / admit 全部经 loadExposureSet(snapshot)
```

```text
# 发现面入口／响应载体矩阵（F-07；实现与 SC 必须逐行覆盖）
#
# | 入口 | 字段载体 | 处理 |
# |---|---|---|
# | lucy_read_source → writeLucySemanticResponse | columns[] 等列数组 | 上行前 admit + 下行 strip |
# | Hive 分流成功载荷 | columns（及同类） | 与上同一读取器；不得在分流 early-return 绕过 |
# | lucy_catalog / kx_catalog | sources 列表 | 不裁表；SC-12 |
# | lucy_catalog / kx_catalog | examples 字符串内字段名 | rewriteExamples |
# | initialize instructions | 注入的 catalog.examples | 与 examples 同源 rewrite |
# | lucy_freshness | 无列 | 不裁 |
# | entity_details | 仓内无成功载荷字段名证据 | 取证待办；首期：触及 trimmed → 上行前 fail-closed（D26／SC-30）；A1 未含本入口 |
# | sl_validate | 同上 | 同上 |
# | dictionary_search | 同上 | 同上（敏感 Meta；存在任一 trimmed 且无法证明无字段名 → fail-closed） |
# | discover_data | 同上 | 同上 |
#
# 「catalog 没有列数组」≠「catalog 无字段发现面」。
# 「四工具在 DATA_PLANE／敏感 Meta 清单」≠「A1 已覆盖其载荷」。
```

### 3.3 流程 3：查数面点名未暴露列 → fail-closed（对应 D10／D11／D20／D24／F-05／F-06／F-R2-02）

```text
# 位置：webui/server/proxy/acl.ts 的 authorizeAndRewrite
# 顺序（被断言，SC-04／SC-18）：
#   1) 既有工具级拒绝
#   2) 既有连接授权
#   3) 既有表／capability 对象授权（含通配 tables:["*"] 的通过路径）
#   4) 【新增】字段暴露检查（仅对已通过 2–3 的 lucy_query / lucy_explain_query）
#   5) 既有 scoped 行策略形状门禁 validateProtectedLucyQueryArgs（保持原嵌套，不外提）
#   6) 既有行策略注入
#
# ⚠️ 插入点：对象授权循环完成之后、protectedSources 行策略块的提前 return 之前。
#    禁止插在 hasRawQueryArg 之后、连接／表授权之前（F-04）。
# ⚠️ 禁止：为暴露检查而调用 validateProtectedLucyQueryArgs（F-05）。
# ⚠️ D24：未裁剪 Source（unconfigured／full_expose）不得因本条解析硬拒而新增拒绝。

function authorizeAndRewrite(identity, toolName, args):
    ...  # 既有：工具级拒绝（失败 → 原 ACL 码，结束）

    # ── 路径 A：sensitive-metadata（默认含 dictionary_search／discover_data）──
    # 源码：acl.ts DEFAULT_SENSITIVE_METADATA_TOOLS；**不在** DEFAULT_TABLE_TOUCHING_TOOLS
    if policy.sensitiveMetadataTools.has(toolName):
        ...  # 既有 sensitive_metadata_forbidden 等授权（失败 → 原 ACL 码，结束）
        # 【新增·必经】敏感元数据授权**已通过之后**、返回 allow／转发上游之前：
        if toolName in {dictionary_search, discover_data}:
            pt = admitPassthroughForExposure(toolName, args, snapshot)
            if pt is deny: return deny(pt.reason)
        # 注意：不得把上述检查挪进下方 tableTouching 分支——本路径根本不会进入该分支

    # ── 路径 B：table-touching（默认含 entity_details／sl_validate／lucy_*）──
    if policy.tableTouchingTools.has(toolName):
        ...  # 既有 hasRawQueryArg
        ...  # 既有连接授权（失败 → 原 ACL 码，结束）
        ...  # 既有表／capability 授权（失败 → 原 ACL 码，结束）

        # 【新增】仅当对象授权已全部通过：
        if toolName == "lucy_query" or toolName == "lucy_explain_query":
            exposureVerdict = validateQueryFieldsAgainstExposure(args, runtime.sourceMap, snapshot)
            if exposureVerdict.denyReason != null:
                recordAuditAttribution(exposureVerdict.attribution)
                return deny(exposureVerdict.denyReason)

        # 【新增·必经】table-touching 授权通过后、行策略／转发前：
        if toolName in {entity_details, sl_validate}:
            pt = admitPassthroughForExposure(toolName, args, snapshot)
            if pt is deny: return deny(pt.reason)

        ...  # 既有 protectedSources / validateProtectedLucyQueryArgs / forcedFilters（不动）

    # ⚠️ D26／R3b：四工具检查**禁止**只写在路径 B 内；路径 A／B 各自授权通过后的必经点都要接。
    #    等价实现：抽出 afterAuthHook(toolName)，在两条路径 return allow 前统一调用亦可，
    #    但 hook 必须对 sensitiveMetadata 与 tableTouching 两条出口都可见。

function anyTrimmed(sources, snapshot) -> bool:
    for src in sources:
        exp = loadExposureSet(src..., snapshot)
        if exp.state == unavailable: return DENY_UNAVAILABLE
        if exp.mode == trimmed: return true
    return false

function validateQueryFieldsAgainstExposure(args, sourceMap, snapshot) -> Verdict:
    # F-06 + D24：先 Source 态，再按作用域解析字段
    involved = resolveInvolvedSources(args, sourceMap)
    #   含：显式 connectionId+source、字段限定名归属、以及仅 source 参数构成的 query shape
    if involved is EMPTY and queryTouchesDataPlane(args):
        # 无法确定涉及 Source：仅当本条需要裁剪裁决时才硬拒
        # 若全局无任何 trimmed／unavailable 期望故障，不新增拒绝（交既有 ACL／上游）
        if snapshotHasAnyTrimmedOrExpectedFault(snapshot):
            return deny("field_exposure_unavailable", attribution("unresolvable_sources"))
        return allow()   # 未裁剪实例：不新增硬拒（SC-29）

    trimmedScope = false
    for src in involved:
        exposure = loadExposureSet(src.conn, src.schema, src.sourceName, snapshot)
        decision = exposureDecision(exposure, "lucy_query", src)
        if decision is deny:
            return deny(decision.reason, attribution("exposure_unavailable", src))
        if decision.mode == trimmed:
            trimmedScope = true

    refs = collectNamedFieldRefs(args)
    # D10 载体：dimensions[].field；filters 对象 .field 与字符串 filter 内列引用；
    #          order_by|orderBy[].field；measures 字符串键与 {expr,name}.expr 内列引用；segments[]
    for ref in refs:
        resolved = resolveRefToIdentityAndColumn(ref, sourceMap, args.connectionId, snapshot.definitionView)
        # resolved =
        #   IDENTITY_COLUMN | UNPARSEABLE | AMBIGUOUS | LEGAL_ZERO_COLUMN_SOURCE
        if resolved is LEGAL_ZERO_COLUMN_SOURCE:
            continue   # 合法零列库存：不是解析失败；点名具体列仍按下方 trimmed 规则
        if resolved is AMBIGUOUS:
            if trimmedScope or targetCouldBeTrimmed(ref, snapshot):
                return deny("field_exposure_unavailable", attribution("ambiguous_ref", ref))
            continue   # 未裁剪作用域：不新增消歧硬拒
        if resolved is UNPARSEABLE:
            if trimmedScope or targetCouldBeTrimmed(ref, snapshot):
                return deny("field_not_exposed", attribution("unresolvable_ref", ref))
                # trimmed 作用域 fail-closed（F-06）；不得交给上游猜
            continue   # unconfigured／full_expose 全集：不新增解析硬拒（F-R2-02／SC-29）

        exposure = loadExposureSet(resolved.conn, resolved.schema, resolved.sourceName, snapshot)
        decision = exposureDecision(exposure, "lucy_query", resolved)
        if decision is deny:
            return deny(decision.reason, ...)
        if decision.fullInventory:          # unconfigured 或 full_expose
            continue
        if normalizeRef(resolved.column) in decision.excluded:
            return deny("field_not_exposed",
                        attribution(carrier = ref.carrier, column = resolved.column, source = resolved))
    return allow()

function resolvePassthroughScope(toolName, args, snapshot) -> PassthroughScope:
    # 显式定义 scope.unavailable（R3b／R3c：不得依赖未定义标志；空抽取不得空循环放行）
    # PassthroughScope = {
    #   unavailable: bool,          # true → 必须 deny（保守）
    #   touchesTrimmed: bool,
    #   involved: SourceRef[] | INSTANCE_WIDE | UNKNOWN
    # }
    if snapshot.expectedSetLoad.state == unavailable
       or ServingGeneration is UNRESOLVABLE
       or AdmissionMode != OPEN:                 # 过渡期也不得透传上游
        return PassthroughScope(unavailable = true)

    involved = extractPassthroughSources(toolName, args, snapshot)
    #   dictionary_search／discover_data：通常无表参数 → involved = INSTANCE_WIDE
    #   entity_details／sl_validate：从既有 extractTables／参数表抽取。
    #   ⚠️ R3c：无 Source 参数、或抽取结果为空集合（involved == []／EMPTY）
    #      → **必须**归一为 INSTANCE_WIDE，与「无法证明作用域安全」同语义。
    #      源码：sl_validate／entity_details 抽取器可返回空表；须通配 ∧ 全敏感表显式授权
    #      （及其余准入）才可越过空表 ACL 拒绝（acl.ts ≈ :1970／:3249-3266）——不得依赖 ACL 堵洞。
    #   禁止：把 EMPTY 交给下方 for-loop，得到 touchesTrimmed=false 直接放行。
    if involved is EMPTY or involved is []:
        involved = INSTANCE_WIDE

    if involved is INSTANCE_WIDE:
        # 实例宽／空抽取：无法证明载荷不含字段名时，
        # 存在任一期望故障 → unavailable；存在任一 trimmed → touchesTrimmed
        if snapshotHasAnyExpectedFault(snapshot):
            return PassthroughScope(unavailable = true, involved = INSTANCE_WIDE)
        return PassthroughScope(
            unavailable = false,
            touchesTrimmed = snapshotHasAnyTrimmed(snapshot),
            involved = INSTANCE_WIDE)

    if involved is UNRESOLVABLE:                 # 声称有源但无法消歧／抽取失败（非空抽取）
        # 保守：实例存在 trimmed 或期望故障 → unavailable；否则不新增拒绝
        if snapshotHasAnyTrimmedOrExpectedFault(snapshot):
            return PassthroughScope(unavailable = true)
        return PassthroughScope(unavailable = false, touchesTrimmed = false, involved = ∅)

    # 仅非空、可解析 Source 列表进入逐源循环
    assert involved is non-empty SourceRef[]
    touches = false
    for src in involved:
        exp = loadExposureSet(src..., snapshot)
        if exp.state == unavailable:
            return PassthroughScope(unavailable = true)
        if exp.mode == trimmed:
            touches = true
    return PassthroughScope(unavailable = false, touchesTrimmed = touches, involved = involved)

function admitPassthroughForExposure(toolName, args, snapshot) -> Admit:
    # D26 首期：无载荷证据前，保守阻断 trimmed／不可用作用域上游
    # 调用点：见 authorizeAndRewrite 路径 A／B 各自授权通过后的必经钩子（不得嵌套遗漏）
    # 取证登记 evidenceNoFieldNames(toolName)=true 后，该工具可跳过 touchesTrimmed 拒绝（S3c）
    scope = resolvePassthroughScope(toolName, args, snapshot)
    if scope.unavailable:
        return deny("field_exposure_unavailable")   # 零上游
    if scope.touchesTrimmed and not evidenceNoFieldNames(toolName):
        return deny("field_exposure_unavailable")   # 零上游；INSTANCE_WIDE 敏感 Meta 的「存在任一 trimmed」已折入 touchesTrimmed
    return allow()   # 仅 unconfigured／full_expose／无 trimmed 实例，或已登记无字段名证据；不新增拒绝
```
### 3.4 流程 4：发布时对引用未暴露列的硬失败（对应 D12／D7／D24／F-01／F-03／F-R2-02）

```text
# 位置：
#   - 上传发布：webui/server/publish-gate.ts + semantic-assets.ts publishSemanticAssets 门禁段
#   - 工作台发布／生效：同一 checkExposureReferenceContract，挂在工作台 publish 协调路径
#   - 任何使候选内容变为已激活的入口（含「保存后索引生效」若存在）在激活前必须跑同一检查
#   - manual reindex（E18）若可能激活未门禁内容 → 必须先跑或拒绝激活；不得绕过 B1
#
# 检查对象 = 发布候选完整状态 CandidateState，而非「仅 snapshot 中变更的 semanticSource」：
#   candidateOverlays = 合并后全部相关 overlay（含未改文件的当前已激活版本）
#   candidateLedgers  = 合并后全部暴露台账
#   affectedClosure   = 因台账排除集变化而可能受影响的引用闭包
#                     （本 Source overlay + 所有 join／跨源引用指向本 Source 排除列的外部 overlay）
#
# D24：exposure.*（含 unparseable）仅在目标（或可判定闭包）为 trimmed 时触发；
#      未裁剪 Source／无关存量 overlay 不得因本条新增硬拒。

function checkExposureReferenceContract(candidate: CandidateState) -> PublishGateViolation[]:
    violations = []
    for srcFile in candidate.allSemanticSources:
        src = parseSemanticSource(srcFile.content)
        for (refKind, refName, exprOrCols) in enumerateRefs(src):
            # refKind ∈ grain|measure|segment|join|derived
            for rawRef in referencedColumns(exprOrCols):
                target = resolveCrossSourceRef(rawRef, src, candidate)
                # target = IDENTITY_COLUMN | UNPARSEABLE | AMBIGUOUS | LEGAL_ZERO_COLUMN

                if target is LEGAL_ZERO_COLUMN:
                    continue   # 合法零列 ≠ 解析失败

                if target is UNPARSEABLE or target is AMBIGUOUS:
                    # 仅当引用闭包可能触及 trimmed 目标时硬失败
                    if candidate.closureMayTouchTrimmed(src, rawRef):
                        violations.push({
                          checkId: `exposure.unparseable.${refKind}.${refName}`,
                          filePath: srcFile.targetPath,
                          message: `${refKind} ${refName} 含无法解析／无法消歧的列引用；引用方=${src.identity}`
                        })
                    # else: 目标侧均为 unconfigured／full_expose → 跳过（与风险表一致）
                    continue

                exposure = candidate.exposureFor(target.conn, target.schema, target.sourceName)
                if exposure.state == unavailable:
                    violations.push({checkId: "exposure.unavailable", filePath: srcFile.targetPath,
                      message: `无法校验：目标 ${target.sourceName} 暴露台账／期望集合不可用；引用方=${refKind} ${refName}`})
                    continue
                if exposure.mode == unconfigured or exposure.mode == full_expose:
                    continue   # 目标未裁剪：不触发 exposure.*
                # trimmed：
                if normalizeRef(target.column) in exposure.excluded:
                    violations.push({
                      checkId: `exposure.${refKind}.${refName}.${target.sourceName}.${normalizeRef(target.column)}`,
                      filePath: srcFile.targetPath,
                      message: `${refKind} ${refName} 引用了未暴露列 ${target.sourceName}.${target.column}（引用方文件=${srcFile.targetPath}；目标列=${target.column}）`
                    })
    return violations

# 只改台账、未改引用方 overlay：仍必须用 candidate 完整状态跑上述检查
# 合法纯台账发布：candidate 中引用闭包全部合法（无 violations）→ 允许发布激活
# publish 门禁并入与不可豁免前缀：NON_WAIVABLE_PREFIXES = ["exposure."]
```

### 3.5 流程 5：新列默认进入暴露集（对应 D5／C2）

```text
# 位置：扫描 / 索引重建路径（webui/server/ktx.ts:186-211 的 ktx admin reindex；E18）
# 目标：新扫描到的物理列默认暴露；裁剪靠事后在工作台收敛

function onManifestRegenerated(connectionId, schema, newManifest):
    inventory = readPhysicalColumns(newManifest)
    ledger = readActivatedLedgerFile(connectionId, sourceName)
    if ledger is MISSING:
        return                                        # 无台账 ⇒ 全库存暴露（若期望未登记）
    excluded = normalizeColumnNames(ledger.excluded_columns)
    assert newColumns ∩ excluded == ∅                 # 新列不会被历史排除集误伤
    return

function workbenchFieldList(sourceModel, draftExposureSet):
    # 列表 = 全量物理库存；开关反映草稿态（可与已激活不同）
    return sourceModel.columns.map(col => ({...col, exposed: not (normalizeRef(col.name) in draftExposureSet.excluded)}))
```

### 3.6 流程 6：半通禁令的可打假检查（对应 D9／SC-07／F-02）

```text
case CROSS_SURFACE_CONSISTENCY(source, excludedColumns):
    snapshot = pinActivatedSnapshot()
    exposure = loadExposureSet(source.conn, source.schema, source.sourceName, snapshot)

    # 面①：发现面
    readRes = lucyReadSource(source)
    visibleColumns = extractColumnNames(readRes.payload)
    assert readRes.payload._meta.lucy.exposure.digest == exposure.digest

    # 面②：查数面——必须断言查数路径也绑定同一 digest（审计或 _meta／测试探针）
    hidden = [c for c in inventoryColumns(source) if c not in visibleColumns]
    for c in hidden:
        q = lucyQuery(source, {dimensions: [{field: `${source.sourceName}.${c}`}]})
        assert denied(q) and q.reason == "field_not_exposed"
        assert q.exposureDigest == exposure.digest   # 两面 digest

    for c in visibleColumns:
        q = lucyQuery(source, {dimensions: [{field: `${source.sourceName}.${c}`}]})
        assert not denied(q)
        assert q.exposureDigest == exposure.digest
    assert set(hidden) == set(columnsRejectedByQueryFace)
```

### 3.7 流程 7：期望台账集合（对应 D19／D25／F-09／F-R2-03）

```text
# 可信初始化（D25）：
#   - 功能未启用：耐久哨兵 expectedSetRequired=false → ready(∅) 合法
#   - 首次启用／首次暴露激活：写入版本化期望制品（可为空文档）并 expectedSetRequired=true
#   - 此后缺失／损坏／unsupported／generation 不匹配 → unavailable，禁止当成 ready(∅)

# 首次配置：Source 从 unconfigured → 发布成功含台账 → expectedSet.add(sourceKey)
# 恢复全暴露：工作台清除排除并选择「移除裁剪配置」→ 发布成功 → 删除台账文件 + expectedSet.remove
#   （仅 excluded_columns=[] 但保留文件 = full_expose，仍留在 expectedSet）
# Source 删除：同步 expectedSet.remove
# 回滚：期望集合与执行代次一起回退
# 运行面：
#   expectedSetLoad.unavailable → 全体 Source unavailable（SC-27／SC-28）
#   expected ∧ missing ledger → unavailable（SC-23）
#   ready ∧ !expected ∧ missing ledger → unconfigured（SC-24）
```

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 暴露台账随**成功发布激活**进入运行内容根；运行面读取的是已确认执行代次，**不读浏览器本地／草稿**；台账缺失且期望可信未登记时等价「全库存暴露」 | 单元（读取器三态＋期望丢失态）＋ 发布后读取的进程内自动化 |
| SC-02 | 存量无显式配置的 Source 行为不变：发现面仍返回全量物理列，查数面不新增拒绝；存量字符串 filter／`{expr,name}` measure 在未配置暴露时不被本条误杀 | 单元＋进程内自动化（对照 Source） |
| SC-03 | 发现面裁剪：被取消暴露的物理列不出现在 `lucy_read_source` 返回体；已暴露列与 measures／segments／joins 不受影响 | 进程内自动化（真实 MCP `tools/call`） |
| SC-04 | 查数面 fail-closed：`lucy_query` 点名未暴露列 → 本机拒绝，reason code = `field_not_exposed`，**上游执行 = 0**（断言落在上行前）。门禁在对象授权之后对 `lucy_query`／`lucy_explain_query` 执行；**不依赖** scoped 行策略；通配表权限 agent 同样被拒 | 进程内自动化（loopback 上游执行计数）＋ 单元；用例含：① 无 scoped 行策略 Source；② `tables:["*"]` agent |
| SC-05 | 查数面覆盖全部字段载体：`dimensions` / `filters`（对象与字符串）/ `order_by｜orderBy` / `measures`（字符串键与 `{expr,name}`）/ `segments` 任一载体点名未暴露列都被拒 | 单元（逐载体参数化断言） |
| SC-06 | `lucy_explain_query` 点名未暴露列同样被拒（本地诊断、不执行上游） | 单元＋进程内自动化 |
| SC-07 | **半通检查**：同一 Source 同一已激活暴露集版本下，「发现面不可见列集合」== 「查数面被拒列集合」，且**两面携带同一暴露集 digest**。覆盖无 scoped 行策略 Source 与通配表权限 agent | 跨面一致性自动化（§3.6） |
| SC-08 | 发布 B1：`grain` / `measure` / `segment` / `join`／派生列引用**trimmed 目标**未暴露列 → 硬失败；**含跨 Source 引用**（目标侧取消暴露、跨源同名列、间接派生）；引用闭包触及 trimmed 时无法解析／无法消歧 → 硬失败（`exposure.unparseable.*`）；目标均为 `unconfigured`／`full_expose` 时不因本条新增硬拒（见 SC-29）；错误明细点名**引用方与目标列** | 发布管线自动化（五类引用＋跨源＋不可解析各至少一条；另含未裁剪对照） |
| SC-09 | `exposure.*` 检查**不可豁免**：动态 `checkId` + 限时豁免仍失败；断言绑定前缀族机制 | 单元＋发布管线自动化 |
| SC-10 | 新列默认暴露：新增物理列后不做任何裁剪，该列出现在发现面且可查 | 单元＋进程内自动化 |
| SC-11 | 台账存在但不可用（损坏／版本不受支持／串源）→ fail-closed：`field_exposure_unavailable` | 单元＋进程内自动化 |
| SC-12 | 暴露集**不按 Role／Agent 异列**；`lucy_catalog` 的 **sources 表列表**不因暴露集变化（裁剪 ≠ 隐藏表） | 单元＋进程内自动化 |
| SC-13 | 工作台：字段列表可见全量库存；可切换暴露；**保存未发布不生效**（Proxy 仍见上一已激活版本）；变更进草稿／待发布 | WebUI 组件测试＋发布工作台状态断言＋Proxy 对照 |
| SC-14 | 交付口径：三处文案写明「业务暴露裁剪 ≠ 列级安全」；新 reason code 与主术语已登记 | 术语标准登记核对＋文案断言 |
| SC-15 | 未裁剪 Source 与未启用本条的其余行为**不回归**；既有 reason code 与对象授权判定顺序不变；**未**把 `validateProtectedLucyQueryArgs` 全局化 | 既有测试全绿＋回归对照＋静态／单测锁插入点 |
| SC-16 | **只改台账、未改引用方**：取消暴露某列且既有 measure／grain／… 仍引用该列 → 发布硬失败，检查走候选完整状态与引用闭包（不依赖 overlay 出现在 changed files） | 发布管线自动化 |
| SC-17 | **合法纯台账发布**：仅台账变更且引用闭包全部合法 → 发布激活成功；运行面随后按新排除集裁剪 | 发布管线自动化 |
| SC-18 | **越权 source**：无权连接／表的调用者猜测字段或触发台账故障 → **仍返回原 ACL 码**，不出现 `field_not_exposed`／`field_exposure_unavailable`，错误体不含暴露配置信息 | 进程内自动化（无权身份对照） |
| SC-19 | **参数兼容**：无 scoped 行策略时，存量字符串 filter 与 `{expr,name}` measure 在已配置暴露集下：合法已暴露列引用放行；点名未暴露列拒绝；不因形状函数误杀 | 单元＋进程内自动化 |
| SC-20 | **Source 优先（trimmed 作用域）**：source-only query shape；跨连接同名 source；在 `trimmed`／期望故障作用域内无法归属／无法解析／无法消歧 → 本机 fail-closed，不交给上游。未裁剪作用域见 SC-29 | 单元＋进程内自动化 |
| SC-21 | **发现面矩阵**：`catalog.examples` 与 `initialize` instructions 不含未暴露列名；Hive 成功载荷列被裁；与 `lucy_read_source` 同一读取器／digest | 进程内自动化 |
| SC-22 | **下行关闭**：模拟 JSON 解析失败、未知形状、裁剪异常 → **不得**原文透传全量响应；台账不可用拒绝的零上游断言仅落在上行前准入 | 单元＋进程内自动化（spy 原始 body 未写出） |
| SC-23 | **曾配置后丢失**：期望集合**可信 ready**且已登记但台账文件缺失／不可读 → `field_exposure_unavailable`，两面拒绝，不静默全暴露 | 单元＋进程内自动化 |
| SC-24 | **从未配置**：期望**可信 ready**且未登记、无台账 → 全暴露（与 SC-02 一致）；迁移验收必须同时跑 SC-23 与 SC-24 对照 | 单元＋进程内自动化 |
| SC-25 | **切换期代次绑定（含实际上游）**：发布提升进行中／激活未确认时，新请求 pin 旧 ServingGeneration；在途不换代。**开放准入时** `upstreamExecutionGenerationId == ServingGeneration.generationId`。构造 V1／V2 同名 measure 语义分叉（V1 隐藏 `secret`、V2 恢复并改引用），在切换窗发起实际上游 `lucy_query`（或等价），断言**返回语义属于当前 OPEN 代次定义**——不得只核快照标签／digest。Strat-B 下过渡期触达上游的新请求须 STOP（`field_exposure_unavailable`） | 进程内并发自动化（发布窗口＋并行 tools/call＋上游结果／执行代次探针） |
| SC-26 | **索引／激活失败与重启（含上游隔离）**：索引失败 → serving 与上游均保持旧代且可 OPEN。**索引成功但激活确认失败** → 不得出现「上游已跑 V2 + serving 仍 V1 + 准入开放」：须回滚上游到旧代后 OPEN，或保持 STOP 直至恢复；用 SC-25 同分叉 measure 观察**实际消费定义**。进程重启若处于过渡／绑定不一致 → 启动保持 STOP 直至恢复；激活记录损坏 → fail-closed 而非裸盘混读 | 管线故障注入＋上游代次探针＋重启恢复自动化 |
| SC-27 | **期望集合自身故障**：制品缺失（在 `expectedSetRequired=true` 后）、不可读、损坏、unsupported version → `expectedSetLoad.unavailable`；全体 Source 数据面 `field_exposure_unavailable`；**不得**退化为空集合全暴露 | 单元＋进程内自动化 |
| SC-28 | **期望集合代次不匹配**：期望制品 `generationId`／digest 与 ServingGeneration 不一致 → 同 SC-27 失败关闭 | 单元＋进程内自动化 |
| SC-29 | **未裁剪路径不新增硬拒**：`unconfigured`／`full_expose` Source 上，存量无法被本条解析器识别的合法／半合法引用（字符串 filter、无关 overlay 表达式等）**不**因 `exposure.*`／`field_not_exposed` 新增拒绝；合法零列库存 ≠ 解析失败；仅 `trimmed` 目标触发 B1／查数暴露硬拒。对照：同请求在改为 trimmed 后才拒绝 | 回归单元＋发布管线对照 |
| SC-30 | **四透传首期合同（必经路径＋空作用域＋逐工具零上游）**：四工具在取证完成前，触及 `trimmed`／`scope.unavailable`（含：期望故障、INSTANCE_WIDE 存在 trimmed、**空抽取／无 Source 归一 INSTANCE_WIDE 且实例有 trimmed／故障**、声称有源但不可解析且实例有 trimmed／故障）→ 上行前拒绝。断言：**逐工具** loopback 上游执行＝0——① 显式触及 trimmed／unavailable 各至少一条；② **`entity_details`／`sl_validate` 另各至少一条「已通过对象 ACL 的身份（通配 `tables:["*"]` ∧ 全敏感表显式授权 ∧ 其余准入）＋无 Source／空抽取作用域」**，在实例存在任一 trimmed 或期望故障时拒绝且上游＝0（证明不依赖空表 ACL 拒绝、也不因 `involved=[]` 空循环放行）。另：**逐工具**未裁剪对照（实例**无** trimmed／期望故障；作用域 unconfigured／full_expose **或** 空抽取归一 INSTANCE_WIDE）不新增拒绝。静态／单测锁插入点：`dictionary_search`／`discover_data` 的门禁在 `sensitiveMetadataTools` 授权通过后执行，**不**仅嵌在 `tableTouchingTools` 分支；`resolvePassthroughScope` 对 EMPTY→INSTANCE_WIDE 有单测锁。收口记录逐工具标注「取证待办／含字段名已裁／不含已登记」。**不得**在四工具未裁决时宣称 A1 全入口闭环 | 进程内自动化（四工具×拒绝／放行／空作用域）＋插入点锁＋取证清单门禁 |

### 4.1 出口与不在出口

- 本条出口＝SC-01–SC-30 全部关闭（其中 SC-30 允许以「取证待办 + 首期 fail-closed 已断言」关闭，**不等于**四工具发现面裁剪已实现）。
- 客户端环境、Agent 路径、整库旅程、客户环境证据不在本条出口；按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线；四透传取证完成前不宣称 A1 全入口闭环。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `field_exposure` — 机器概念名（Lucy 侧字段暴露台账）。UI 主术语：**字段暴露**；台账中的未暴露列在用户可见文案里称**未暴露字段**（不用「禁用」「隐藏」「脱敏」——后者在现行口径里另有含义，见 `docs/governance/vision.md:219`）。须按 `webui/docs/00-product-terminology-standard.md` §5「新术语登记流程」在 §4.2 语义建模分区登记后方可实现。
- `field_not_exposed` — 机器 reason code（查数面拒绝：点名了未暴露字段）。**不新造用户可见译名**，映射到既有「访问控制」分区的裁决码呈现规则。
- `field_exposure_unavailable` — 机器 reason code（台账存在但不可用、期望登记后丢失、期望集合自身不可用／代次不匹配、执行代次不可解析、或四透传首期 trimmed 阻断时的 fail-closed 拒绝）。与 `field_not_exposed` 分开，便于运维区分「用错字段」与「配置／代次坏了」。

Forbidden terms:

- 不得用「列级权限」「列级脱敏」「按角色分列」描述本条能力（现行口径不做列级脱敏，`docs/governance/vision.md:139`、`:219`）。
- 不得把业务暴露裁剪表述为安全边界；交付文案必须写明「业务暴露裁剪 ≠ 列级安全」。

本条不新增产品概念之外的用户可见译名；`lucy_catalog` / `lucy_read_source` / `lucy_query` 是既有 tool name，登记信息不变。

---

## 6. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/README.md`（Governance：状态与错误码呈现规则）
- `webui/docs/00-product-terminology-standard.md`（reason code → 用户可见文案映射）
- `webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`（表语义工作台：字段列表、变更摘要、Header 主操作）
- `webui/docs/112-publish-workbench-flow-and-gate-ia-spec.md`（发布工作台流程与门禁呈现）

### What This Change Follows

- 工作台字段列表沿用既有「字段」分区（`webui/src/pages/TableEditor.tsx:163`），**只增**一行「暴露状态」与一个开关，不新增视觉模式、不改布局、不改交互骨架。
- 暴露开关的文案与状态词走既有术语标准；拒绝码沿用既有 reason code → 文案映射机制（新增两个码走既有登记流程，不新造文案）。
- 变更预览沿用既有「变更摘要优先、原始 Diff 折叠」（Spec 48 §Change Preview Requirements）；暴露状态变更作为一类变更组进入摘要。
- 本条不涉及浏览器窄屏或移动端表现的新增规则。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 两个新 reason code 与「字段暴露／未暴露字段」主术语需登记进 `webui/docs/00-product-terminology-standard.md`（Plan S0 前置项）。
- 若后续 `lucy_catalog`／`kx_catalog` 增加列预览（当前 sources 不返回列数组，见 §1.2 E1），必须复用同一暴露集读取器，不得另起一套裁剪口径。
- `catalog.examples`／`initialize`／Hive 已纳入本条矩阵（SC-21），不再视为「无列故排除」。

---

## 7. 非目标

- 不做列级 ACL、列级脱敏、按 Role／Agent 异列；暴露集是 Source 级、全实例同一套（D6）。
- 不替代合规用 VIEW／拆表兜底（E22）；不提供「库内不可见」能力。
- 不改库表结构；不从 Manifest 物理删除列；不改 KTX「全物理列」合同作为主路径（D1、D16、D17）。
- 不改 KTX 上游源码；不改 `access.yaml` 的 ACL 模型与既有 reason code（本条只**新增**两个码，不改写既有码含义）。
- 不做派生列／measure／segment／join 自身的暴露开关（只覆盖物理列，D7）。
- 不把 scoped 专用的 `validateProtectedLucyQueryArgs` 提升为全局查询形状门禁（D10／D20）。
- 不改 `sl_read_source`／`sl_query` 的默认 deny 口径（E8）；旧工具若被显式放开，作为已知残余处理。

---

## 8. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | 旧 `sl_query`／`sl_read_source` 若被显式放开（默认在 `deny_tools`，E8），不经 Lucy 门面闸 | 现行默认口径已挡住；本条不扩到旧工具 | 后续条目，需与「旧工具是否整体退役」一并评估 |
| RES-02 | 字段存在性不构成安全承诺：`field_not_exposed` 会告诉调用方「该字段存在但未暴露」 | 本条不是安全边界（D15）；为运维可诊断性保留 | 与「是否需要存在性保密」一并评估 |
| RES-03 | KTX `sl_read_source` 返回体的确切列形状未核实，裁剪实现依赖开工前固化的真实形状（§1.3） | 影响实现细节，不影响本条承诺 | 开工前置项 |
| RES-04 | 派生列／measure／segment 自身不可被裁剪（D7） | 若业务需要隐藏某个派生指标，本条不覆盖 | 后续条目 |
| RES-05 | 暴露集与内容根的绑定依赖发布激活流程；若内容根被绕过发布窗口直接改写，运行面读到的是未门禁台账 | 与既有「发布即生效」口径同源；本条要求凡激活入口必须跑 B1（§3.4），仍无法防文件系统直改 | 随发布管线一并评估 |
| RES-06 | ~~台账丢失与「从未配置」不可区分~~ | **已由 D19／SC-23／SC-24／Plan S2c 收口为合同**；本行保留作废指向，避免旧评审引用悬空 | 已闭合（v0.3-draft） |
| RES-07 | 四个上游透传工具真实载荷是否含字段名仍未取证 | **合同已由 D26／SC-30 闭合为「取证待办 + 首期 trimmed 作用域 fail-closed」**；取证完成前 **A1 不含四入口**；含字段名须补裁剪 SC，不含则登记证据后解除 fail-closed | Plan S3c；证据开放不阻塞过程对抗再开一轮，但阻塞「A1 全入口闭环」宣称 |
| RES-08 | 台账／期望集合／草稿存储的具体文件落点与格式 | 故障与代次语义已闭合（D23／D25）；路径／schema 仍开放，须 Plan 前置冻结 | 开工前置；不阻塞 F-R2 合同闭合 |
| RES-09 | 上游代次绑定实现形态（Strat-A staging 指针 vs Strat-B STOP／DRAIN／回滚） | **合同语义已由 D23／§3.1b／§3.1c／SC-25／SC-26 闭合**；具体机制与耐久记录 schema 仍须 Plan 前置冻结 | 开工前置；不阻塞 R3b 合同闭合 |

---

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 半通：发现面已裁、查数面仍通 | 两面若各自读一份暴露集或各自实现裁剪，会出现不一致 | 单一读取器 + 单请求执行代次 snapshot + 两面 digest（SC-07） |
| 混代：台账与语义定义／索引不同代 | 仅对齐 exposure digest 仍可能用 V1 台账处理 V2 定义；或 Proxy pin V1 但共享 KTX 已索引 V2 | D23／§3.1c（上游绑定或 STOP→DRAIN→回滚）＋ SC-25／SC-26（观察实际消费定义） |
| 索引成功＋激活失败半通 | 上游已跑新定义而 serving／门禁仍旧代且准入开放 | §3.1b 硬禁令；失败须回滚上游或保持 STOP |
| 查数面误杀合法查询 | 字段限定名解析或排除集归一化不一致，或对未裁剪路径全局硬拒 | D24；源限定名解析与 `normalizeRef` 口径统一；SC-02／SC-15／SC-19／SC-29 |
| 台账损坏导致大面积拒绝 | D8 的 fail-closed 作用在 configured／期望丢失／期望集合故障 | 从未配置不受影响（SC-02／SC-24）；故障态独立 reason code（SC-11／SC-23／SC-27） |
| 台账丢失／漏提升 ⇒ 静默恢复全暴露 | 仅「文件缺失＝未配置」不可区分曾配置后丢失 | **独立期望集合**（D19）＋ SC-23／SC-24＋ Plan S2c |
| 期望集合读失败 ⇒ 空集合全暴露 | 把损坏／缺失当成 ready(∅) | D25＋ SC-27／SC-28；禁止退化 |
| 发布门禁误杀存量 | B1 若对未裁剪目标也做 unparseable 硬拒，历史 overlay 大面积失败 | D24：仅 trimmed 目标触发；SC-17／SC-29 |
| 草稿提前生效 | 沿用现行「保存即写内容根」会使未发布台账被 Proxy 读到 | D18＋ SC-13＋ Plan S2b／S6b 后端暂存／激活合同 |
| 下行裁剪继承原文透传 | 解析失败恢复原始 body → 全量泄漏 | D22＋ SC-22；禁止 restoreOriginalBody |
| 越权泄漏暴露状态 | 暴露检查早于对象授权会覆盖 ACL 码 | D20＋ SC-18 |
| 四透传未取证却宣称 A1 闭环 | 专用语义出口未接管四工具，载荷未知 | D26／SC-30；首期 trimmed fail-closed；取证前不宣称 A1 全覆盖 |
| 四透传门禁嵌错分支 | `dictionary_search`／`discover_data` 不在 tableTouching，嵌在该分支＝永不执行 | D26／§3.3 路径 A／B 分接；SC-30 插入点锁 |
| 四透传空抽取放行 | `entity_details`／`sl_validate` 无源／空表 → `involved=[]` 空循环 `touchesTrimmed=false`；ACL 须通配 ∧ 全敏感表显式才可越过空表拒绝 | D26／`resolvePassthroughScope`：EMPTY→`INSTANCE_WIDE`；实例有 trimmed／故障则拒；SC-30 已过 ACL＋空作用域用例 |
| KTX 侧行为未核实 | 台账落点依赖 KTX loader 对下划线目录的处理（§1.3） | Plan 前置项写死验证步骤；两条候选落点均可在本仓实现 |
| 与既有「全物理列」叙事冲突 | 交付方可能误以为暴露裁剪＝删列 | D17 + 术语小节 Forbidden terms + D15 交付口径三处写明 |
| 暴露裁剪被误当安全能力交付 | 客户可能据此认为数据已脱敏 | 工作台／帮助／发布说明三处固定文案（SC-14） |

---

## 10. 出处

- 需求池：[`REQ-030-012`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（背景／期望方向／非目标／已知硬约束／关联）
- 评审：[`docs/reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md`](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[`docs/reviews/2026-11-08-semantic-source-field-exposure-codex-review.md`](../reviews/2026-11-08-semantic-source-field-exposure-codex-review.md)；过程 findings 原文 `inbox/2026-11-08-p0-a-codex-r1-last.txt`、`inbox/2026-11-08-p0-a-codex-r2-last.txt`、`inbox/2026-11-08-p0-a-codex-r3-last.txt`、`inbox/2026-11-08-p0-a-codex-r3b-last.txt`
- 上位合同：
  - [`docs/governance/DEVELOPMENT.md`](../../docs/governance/DEVELOPMENT.md) §「语义层（semantic-layer）分层」（`:344-394`）
  - [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.2 请求生命周期（`:67-86`）、§4.3（`:88-101`）、§6.2 `kx_catalog` 返回合同（`:555-588`）
  - [`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`](../../webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md) §Table Semantic Workbench Requirements（`:188-256`）
  - [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §3 全局固定术语表（`:128-283`）、§5 新术语登记流程（`:1007-1016`）
  - [`docs/governance/vision.md`](../../docs/governance/vision.md) `:139`、`:219`
  - [`docs/access-control/design-governance-baseline.md`](../../docs/access-control/design-governance-baseline.md) `:158-170`
- 实现证据（本 Spec §1.2 已逐条打开确认）：
  - `webui/server/proxy/acl.ts:86-93`、`:152-159`、`:1986-2035`、`:2131-2142`、`:3062`、`:3229`、`:3272-3325`
  - `webui/server/proxy/mcp-proxy.ts:930-956`、`:958-1019`、`:1576-1620`、`:1647-1689`、`:1869`、`:2827-2896`、`:4456-4506`、`:4611`、`:5594-5599`、`:5828`、`:5990-6009`
  - `webui/server/proxy/row-policy.ts:407-455`
  - `webui/server/proxy/row-policy-catalog.ts:50-53`、`:289-304`、`:337-413`、`:437-507`
  - `webui/server/hive/execution.ts:142`
  - `webui/server/semantic-layer.ts:102-166`、`:271-275`、`:320-331`、`:377-408`、`:578-601`、`:646-660`、`:776`
  - `webui/server/publish-gate.ts:19-22`、`:60-92`、`:110-141`、`:155-176`、`:209-226`
  - `webui/server/publish-workbench-state.ts:41`、`:61`、`:105`、`:169-172`、`:189-234`
  - `webui/server/publish-coordinator.ts:33`、`:391-430`
  - `webui/server/semantic-assets.ts:2338`、`:3056-3129`
  - `webui/server/index.ts:884`、`:2406-2443`、`:2664-2702`
  - `webui/server/ktx.ts:186-211`
  - `webui/server/paths.ts:20`、`:41-53`、`:85-123`
  - `webui/src/pages/TableEditor.tsx:102-115`、`:139-147`、`:163`、`:440-448`
  - `.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147`
