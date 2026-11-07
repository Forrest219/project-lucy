# Lucy 语义层 Source 级字段暴露裁剪 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立，待 PM 指派台账号后再登记 |
| 需求池条目 | REQ-030-012（语义层宽表字段暴露裁剪），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只登记设计与验收口径，不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 配套 Plan | [lucy-20261107-semantic-source-field-exposure-plan.md](../plans/lucy-20261107-semantic-source-field-exposure-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 上位合同 | [`docs/governance/DEVELOPMENT.md`](../../docs/governance/DEVELOPMENT.md)「语义层（semantic-layer）分层」、[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.2／§4.4、[`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`](../../webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md)、[`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)、[`docs/governance/vision.md`](../../docs/governance/vision.md) |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：一个 Source 的字段暴露裁剪配置一旦发布生效，Agent 在发现面看不到被取消暴露的物理列、在查数面点名该列一律被本机拒绝；发现面与查数面使用同一份暴露集，不会出现一面已裁一面仍通。
- 本条出口：能打假这两条的检查——本机自动化（暴露集读取与版本绑定、发现面裁剪、查数面 fail-closed、发布门禁硬失败、新列默认暴露、跨面裁剪集合一致性）。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级
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
| E1 | `lucy_catalog` / `kx_catalog` **不返回列**：返回体只有 `connections` / `sources`（connectionId、schema、sourceName、table）/ `examples` | `webui/server/proxy/acl.ts:1986-2035`（`lucyCatalog`）、`webui/server/proxy/acl.ts:2037-2054`（`kxCatalog`） |
| E2 | 目录类工具由 Proxy **本地**服务：`lucy_catalog` / `kx_catalog` / `connection_list` 在 Proxy 内构建并直接回写 JSON-RPC | `webui/server/proxy/mcp-proxy.ts:4456-4506` |
| E3 | 列级发现面实际是 `lucy_read_source`：Proxy 把它改写成上游 `sl_read_source` 转发给 KTX，**响应体不做列级过滤** | `webui/server/proxy/mcp-proxy.ts:5594-5596`（改写）、`webui/server/proxy/mcp-proxy.ts:2827-2846`（响应改写出口 `writeLucySemanticResponse`）、`webui/server/proxy/mcp-proxy.ts:5990-6009`（`lucy_query` / `lucy_read_source` 共用该出口） |
| E4 | 查数面 `lucy_query` 同样被改写成上游 `sl_query`；Proxy 侧只有**形状**门禁（禁 raw SQL、禁形状键、`filters` 禁字符串与禁用树键、`measures[].expr` 禁），**没有字段级门禁**。**注意形状门禁的嵌套位置**：它只在「非通配表权限 → 有 scoped 行策略 → 仅 `lucy_query`」三层嵌套内被调用（`acl.ts:3163` → `:3193` → `:3197-3200`），`lucy_explain_query` 根本不经过它；`lucy_query`／`lucy_explain_query` 唯一无条件执行的形状检查是 `acl.ts:3121-3122` 的 `hasRawQueryArg` | `webui/server/proxy/mcp-proxy.ts:5597-5599`、`webui/server/proxy/row-policy.ts:407-455`、`webui/server/proxy/acl.ts:3121-3122`、`webui/server/proxy/acl.ts:3163`、`webui/server/proxy/acl.ts:3193`、`webui/server/proxy/acl.ts:3197-3200` |
| E5 | 查数参数形状：`connectionId` / `measures` / `dimensions` / `filters` / `segments` / `order_by`｜`orderBy` / `limit`；字段引用是**源限定名**（形如 `<source>.<column>`，见目录示例 `poc_ad_revenue_daily.dt`） | `webui/server/proxy/mcp-proxy.ts:958-1019`、`webui/server/proxy/acl.ts:2024` |
| E6 | 数据面工具集合：`lucy_query` / `lucy_read_source` / `lucy_explain_query` / `lucy_freshness` / `entity_details` / `sl_validate`；`lucy_freshness` 只返回来源身份与 mtime，**不返回列** | `webui/server/proxy/acl.ts:86-93`、`webui/server/proxy/mcp-proxy.ts:1647-1689` |
| E7 | `lucy_explain_query` 是**本地**诊断（`executionMode: "plan_only"`、`executed: false`），但承接与 `lucy_query` 同形的字段入参 | `webui/server/proxy/mcp-proxy.ts:1576-1620`、`webui/server/proxy/row-policy.ts:457-459` |
| E8 | 旧 `sl_query` / `sl_read_source` 默认在 `deny_tools` 里，默认不可授予；`deny_tools` 命中即硬拒（优先于授予） | `webui/server/proxy/acl.ts:152-159`、`webui/server/proxy/acl.ts:3062` |
| E9 | 语义层是 **manifest／overlay 双层**：`_schema/<schema>.yaml` 是 manifest（仓库物理表结构，ktx 扫描 warehouse 自动生成），`<table>.yaml` 是 overlay（grain、columns 含 `expr` 派生列、measures、segments、joins） | `docs/governance/DEVELOPMENT.md:344-357`、`webui/server/semantic-layer.ts:271-275`（manifest 路径）、`webui/server/semantic-layer.ts:320-331`（overlay 路径） |
| E10 | 「全物理列」合同的实际落点是 semantic-author lint：standalone source（带 `table:`）**必须声明全部物理列**（"With table:, include ALL physical columns — KTX will not merge Manifest"）；只有派生列会被判错 | `.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147` |
| E11 | 表语义工作台的字段列表取自 **manifest 物理列**（`modelFromTable` 从 manifest 的 `tables[<table>].columns` 建 `model.columns`；overlay 只贡献 grain／measures／segments／joins） | `webui/server/semantic-layer.ts:377-408`、`webui/server/semantic-layer.ts:578-601`、`webui/src/pages/TableEditor.tsx:102-115`、`:139-147`、`:440-448`、`:163`（「字段」分区标签） |
| E12 | 工作台字段的正常维护动作是**改描述**，写回的是 manifest 的 `columns[].descriptions.human`（增量补丁），不改列本身 | `webui/server/semantic-layer.ts:646-660`、`webui/src/pages/TableEditor.tsx:146-147` |
| E13 | 发布扫描的内容根与种类只有三类：`semantic_overlay` / `schema_manifest` / `wiki`；**注意有四个不同的判定点**：`publish-workbench-state.ts:169-172` 的 `semanticKind()` 只把 `_schema` 目录（`parts[0]`）判为 manifest；同文件 `:752-757` 的 `kindForLogicalPath()` 才按 `semantic-layer/<conn>/_schema`（`parts[2]`）判 manifest；`semantic-assets.ts:1714-1718` 的 `kindForPendingPath()` 只认 `filePath.includes("/_schema/")`，其余一律 `semanticSource`；`semantic-assets.ts:637-726` 的 `classifyYaml()` 对既非 manifest 又非 overlay 的 yaml 返回 `UNKNOWN_SHAPE` **硬失败**（`:726`） | `webui/server/publish-workbench-state.ts:169-172`、`webui/server/publish-workbench-state.ts:752-757`、`webui/server/semantic-assets.ts:1714-1718`、`webui/server/semantic-assets.ts:637-726` |
| E14 | 「待发布」＝当前内容根与 baseline 之间的差异（baseline 落在 `.ktx-ui/publish-workbench/baseline.json`）；发布 = 校验 → 门禁 → 提升到内容根 → 重建索引 | `webui/server/publish-workbench-state.ts:41`、`:105`（`PublishBaseline`）、`:214-234`（`scanPublishContent`） |
| E15 | 发布硬失败已有落点：门禁不通过时写 `blocked` 发布记录并抛 `SemanticAssetValidationError("VALIDATION_GATE_FAILED")`，错误明细按 `code`/`message`/`filePath` 逐条给出 | `webui/server/semantic-assets.ts:3056-3129` |
| E16 | 门禁检查项可登记、不可豁免（`NON_WAIVABLE_CHECKS`），豁免是**限时带审计**的单项 waiver，且永不豁免 `ALL_CHECKS` 与 `contract_presence` | `webui/server/publish-gate.ts:19-22`、`:60-92`、`:110-141`、`:209-226` |
| E17 | 列类型合同检查已有同族实现（`checkColumnTypeContract` → `columns.<i>.type`），可作为新增暴露引用的模板 | `webui/server/publish-gate.ts:155-176`、`webui/server/semantic-assets.ts:3063-3076` |
| E18 | 索引重建：`POST /api/semantic-assets/reindex` 在发布协调窗口内执行 `ktx admin reindex`；发布窗口由 coordinator 独占 | `webui/server/index.ts:2664-2686`、`webui/server/ktx.ts:186-211`、`webui/server/publish-coordinator.ts:33`、`:391-430` |
| E19 | 内容根解析：`LUCY_CONTENT_ROOT` 或 `ktx.yaml paths.content_root` → `ContentPaths`，其下固定四目录 `semantic-layer` / `wiki` / `evals` / `skills` | `webui/server/paths.ts:20`、`:41-53`、`:85-102`、`:107-123` |
| E20 | 现有物理列清单的权威读取器：读 `semantic-layer/<conn>/_schema/<schema>.yaml`，按 `tables[<table>].columns[].name` 取列，失败按 `resolve`/`read`/`parse`/`catalog` 四阶段归因，**三种结局都 fail-closed** | `webui/server/proxy/row-policy-catalog.ts:50-53`、`:289-304`、`:337-413`、`:437-507` |
| E21 | 现行治理口径：表级 ACL 为基线，**不做列级脱敏**，不承诺列级 masking | `docs/governance/vision.md:139`、`:219` |
| E22 | 合规侧「库内不可见」的既有兜底是 VIEW-as-pseudo-table（物理 VIEW + 独立 semantic source + tableSelector），不是产品化「勾选删列」 | `docs/access-control/design-governance-baseline.md:158-170`、`docs/access-control/design-upgrade.md:649-651` |

### 1.3 取证缺口（写明「未核实」，不得当作事实）

- **KTX 上游 loader 是否忽略 `semantic-layer/<conn>/` 下除 `_schema` 外的下划线目录**：未核实（KTX 上游不在本仓，`node_modules/@kaelio/ktx` 不含 Python loader 源码）。这直接决定暴露台账的落点（见 D2 与 Plan「开工前置」）。
- **KTX `sl_read_source` 返回体的确切字段形状**（列数组的键名与层级）：未核实（本仓只看到 Proxy 的改写与转发，见 E3）。裁剪实现须在开工前以真实上游返回体固化形状。
- **KTX 是否接受语义层 overlay 顶层新键**：未核实。因此暴露集**不**放进 overlay 文件（见 D2）。
- **四个上游透传入口的返回体是否含列／字段名**：`entity_details` / `sl_validate`（`acl.ts:86-93` 的 `DATA_PLANE_TOOLS`）、`dictionary_search` / `discover_data`（`acl.ts:180` 的 `DEFAULT_SENSITIVE_METADATA_TOOLS`）**不在 Proxy 本地执行集内**——本地执行点只有 `mcp-proxy.ts:4456`（`connection_list`／`lucy_catalog`／`kx_catalog`）与 `:4579-4581`（`lucy_explain_query`／`lucy_freshness`）；这四个是**直转上游**的 Agent 入口，返回体在本仓**无任何列级过滤**。其返回体形状与是否含未暴露列名：**未核实**。→ 池硬约束#2「A1 必须覆盖所有 Agent 查数／发现入口」在本条**未闭环**，须在 Plan 开工前置中固化为验证项。
- 需求池 REQ-030-012 引用的 `webui/docs/48` 系列「表语义工作台既有 Spec」已核实为 `webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`（E11/E12 涉及的实现面在其 §「Table Semantic Workbench Requirements」）。

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | **库存与暴露分离**：Manifest／扫描保留全量物理库存（不改 KTX「全物理列」合同、不手删 Manifest 列、不改库表结构）；暴露集是 Lucy 侧**另册**，只作用于 Agent 数据面 | 需求池方向；E9/E10/E22 表明「删列」路径要么违反上游合同要么退化成 VIEW 兜底 |
| D2 | **暴露台账是内容根内的版本化文件**，随发布批次一起进入运行内容根；浏览器本地状态**不参与**判定 | 硬约束①。内容根由发布提升（E14），台账随内容根走即天然版本化；读取口是 `loadContentPaths()`（E19），与发布写集同源 |
| D3 | **落点候选**：`semantic-layer/<conn>/_exposure/<source>.yaml`；**若 KTX loader 会把该目录当 source 加载**（未核实），改落 `<contentRoot>/exposure/<conn>/<source>.yaml`，并扩 `CONTENT_DIR_NAMES`（E19 的四个目录是硬编码常量）与发布扫描根（E13） | 两条候选路径的改动面都可在本仓指认；KTX 侧行为未核实，故列为 Plan 前置而非既成事实 |
| D4 | **发布扫描必须新增台账种类，且要改的是四处判定点**：真正决定「什么被当 overlay 上传给 KTX」的**不是** `semanticKind()`，而是 `semantic-assets.ts` 的 `kindForPendingPath`（不含 `/_schema/` 一律 `semanticSource`，`:1714-1718`）与 `classifyYaml`（无 `tables:`／`name:` 一律 `UNKNOWN_SHAPE` **硬失败**，`:637-726`）；`semanticKind()`（`publish-workbench-state.ts:169-172`）只判 `parts[0] === "_schema"`，在现行布局 `semantic-layer/<conn>/_schema/<schema>.yaml` 下**匹配不到 manifest**（`kindForLogicalPath` 才按 `parts[2] === "_schema"` 判，`:752-757`）。**台账 yaml 会落 `classifyYaml` 的 `UNKNOWN_SHAPE` 硬失败**——这不是「被当成 overlay 上传」，因此新增种类必须同时改：`semanticKind`／`kindForLogicalPath`／`kindForPendingPath`／`classifyYaml` 四处 | 新增 `field_exposure` 种类，且该种类**不**参与 KTX 上传；⚠️ 只改 `semanticKind` 不改其余三处 → 台账要么被判 `semanticSource` 上传，要么在 `classifyYaml` 硬失败，两条都不是本条要的行为 |
| D5 | **台账以「排除集」编码**：`excluded_columns`（未暴露物理列），暴露集 = 库存 − 排除集 | 直接满足 C2（新物理列默认暴露，无需在扫描时改台账）与「存量无显式配置 = 全库存暴露」（排除集为空）两个口径，且不需要在扫描管线里插入写操作 |
| D6 | **暴露粒度 = Source，跨实例一致**：暴露集按 Source 唯一（`connectionId` + `schema` + `sourceName`）定义，**不按 Role／Agent 异列**；所有实例看同一套采用集 | 需求池「全实例同一套采用集」；这是本条与列级 ACL 的分界 |
| D7 | **暴露集只覆盖物理列**：overlay 派生列（`columns[].expr`）、measures、segments、joins **不在**暴露集内；它们只能**引用**暴露列 | 派生列不是物理库存；把它们纳入排除集会与 B1（引用一致性）语义打架 |
| D8 | **失败关闭：台账「不存在」是配置态，fail-open（= 全暴露）；台账「存在但不可用」是故障态，fail-closed（拒绝）** | 缺失＝该 Source 未做裁剪＝存量默认，全暴露是合同内的合法态；存在却解析失败／版本不受支持＝运行面无法确定权威集合，若放行等于静默恢复被裁掉的列，且两面无法一致 → 拒绝该 Source 的数据面。理由详见 §3.1 |
| D9 | **半通禁令**：发现面与查数面必须使用**同一份暴露集、同一版本**，且**裁剪集合完全相等**——发现面不可见的列集合 == 查数面被拒的列集合 | 需求池硬约束②。可打假的检查见 §3.6 与 SC-07 |
| D10 | **查数面判定覆盖全部字段载体**：`dimensions[].field` / `filters[].field` / `order_by｜orderBy[].field` / `measures[]`（字符串或 `{name}`）/`segments[]`；字段引用按**源限定名**解析（取 `<source>.<column>` 的列名部分，归一化小写） | E5；REQ-030-013 的教训是「只判 `filters[].field`」会留缺口（见该 Spec §1.3 R1） |
| D11 | **`lucy_explain_query` 同样受查数面判定约束**（本地诊断、不执行上游） | E7；否则 Agent 可用 explain 探知未暴露列的名字，绕开发现面裁剪 |
| D12 | **B1 硬失败且不可豁免**：新增 `exposure.*` 检查族，并入既有发布门禁（E15/E17）。**机制要求（不可豁免判定必须支持前缀族）**：现行 `NON_WAIVABLE_CHECKS` 是**精确字符串集合**，豁免判定为 `!NON_WAIVABLE_CHECKS.has(violation.checkId)`（`publish-gate.ts:19-22`、`:130`），豁免侧 `exemption.checkIds.includes(violation.checkId)`（`:98`）同样是精确匹配——**不存在任何前缀族机制**。故本条必须**新增前缀判定**（如 `NON_WAIVABLE_PREFIXES = ["exposure."]`），并把 `applyPublishExemption` 的「是否可豁免」判定改为「精确命中 **或** 前缀命中」；若不引入该机制而只往字面量集合塞 `"exposure.*"`，§3.4 实际产出的 `exposure.unavailable` / `exposure.grain.<col>` / `exposure.measure.<name>.<col>` 等动态 id **一个都不匹配**，全部仍可被限时豁免 | 豁免会重新造出「一面已裁一面仍通」的半通态；且需求池写明「硬失败」。⚠️ 前缀族机制属**实现改动面**（`publish-gate.ts`），不是零成本声明 |
| D13 | **拒绝码分两个**：`field_not_exposed`（点名了未暴露列）、`field_exposure_unavailable`（台账不可用）。二者都只进机器码与审计，**对外不承诺隐藏字段存在性** | 本条**不是**安全边界（D15），因此不为「存在性保密」付代价；但两个码必须分开，否则运维无法区分「用错字段」与「配置坏了」 |
| D14 | **工作台字段列表 = 全量库存 + 暴露开关**：取消暴露的列**仍在列表里**（可恢复），变更进待发布 | D1（库存保留）；需求池 D1；E11/E12（字段列表已由 manifest 物理列驱动） |
| D15 | **交付口径必须写明「业务暴露裁剪 ≠ 列级安全」**：工作台文案、帮助文案、发布说明三处都写；本条**不**提供列级 ACL／脱敏／按 Role 异列，**不**替代合规用 VIEW | 需求池硬约束④；E21 现行口径已声明不做列级脱敏；E22 合规兜底仍是 VIEW |
| D16 | **不改 KTX 上游源码**：闸门只落在 Lucy 侧（Proxy 门面 + 发布门禁 + 工作台） | 需求池「不改 KTX 全物理列合同作为主路径」；本仓是 Lucy 仓，KTX 是外部依赖 |
| D17 | **不手改 semantic-author 的「全物理列」规则**，只在文档与提示里补一句「暴露裁剪 ≠ 删列；库存仍须全量」 | E10：该规则是上游合并合同，改它等于改 KTX 合同 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：暴露集读取与版本化来源（对应 D2／D5／D8）

```text
# 位置：新增 webui/server/proxy/field-exposure.ts（读取器，纯函数 + 文件读）
# 目标：暴露集只来自「随发布进入运行内容根」的台账；浏览器本地状态不参与
#
# 台账格式（候选；格式在开工前冻结，见 Plan 前置）：
#   semantic-layer/<conn>/_exposure/<source>.yaml
#     version: 1
#     source: {connectionId: <conn>, schema: <schema>, sourceName: <source>}
#     excluded_columns: [<物理列名>, ...]
#     updated_at: <iso8601>
#
# 语义：暴露集 = 该 Source 的物理库存 − excluded_columns
#       排除集为空 ⇔ 全库存暴露

enum ExposureState:
    unconfigured      # 台账不存在：该 Source 未做裁剪（配置态，非失败态）
    configured        # 台账存在且可读
    unavailable       # 台账存在但损坏 / 版本不受支持（故障态）

function loadExposureSet(conn, schema, sourceName) -> ExposureSet:
    ledger = readLedgerFile(conn, sourceName)      # 内容根内；不经浏览器、不经 access.yaml
    if ledger is MISSING:
        # D8：存量无显式配置的 Source 等价「全库存暴露」——这是合同内的合法态
        return ExposureSet(excluded = ∅, state = unconfigured, version = null, digest = null)

    parsed = parseYaml(ledger.text)
    if parsed is INVALID:
        return ExposureSet(excluded = ∅, state = unavailable, version = null, digest = sha256(ledger.text))
    if parsed.version is not SUPPORTED_VERSION:
        return ExposureSet(excluded = ∅, state = unavailable, version = parsed.version, digest = sha256(ledger.text))
    if parsed.source does not match (conn, schema, sourceName):
        return ExposureSet(excluded = ∅, state = unavailable, ...)     # 台账串源 = 损坏

    excluded = normalizeColumnNames(parsed.excluded_columns)   # trim + 小写 + 去重
    return ExposureSet(excluded = excluded, state = configured,
                       version = parsed.version, digest = sha256(ledger.text))
    # digest 随审计与响应 meta 落地：两个面必须携带同一 digest（D9 的可打假凭据）
```

```text
# 失败关闭口径（D8）——单点判定，所有面向共用
function exposureDecision(exposureSet, toolName, sourceRef):
    if exposureSet.state == unavailable:
        # 故障态：运行面无法确定权威集合 ⇒ 拒绝（fail-closed），零上游执行
        return deny(reason = "field_exposure_unavailable", source = sourceRef)
    if exposureSet.state == unconfigured:
        # 配置态：等价全库存暴露，不做任何列级裁剪
        return allow(fullInventory = true)
    return allow(fullInventory = false, excluded = exposureSet.excluded)
```

### 3.2 流程 2：发现面裁剪（对应 D9／D11 之外的发现侧）

```text
# 位置：webui/server/proxy/mcp-proxy.ts 的 writeLucySemanticResponse（lucy_query / lucy_read_source 共用改写出口，E3）
# 目标：未暴露列在发现面不可见；发现面与查数面读同一份暴露集

function writeLucySemanticResponse(identity, upstream, upstreamBody, res, requestId, toolName, toolArgs, ...):
    ...                                     # 既有：上游失败归类 / SSE 归一 / _meta 注入
    payload = parseJsonRpcPayload(body)

    if toolName == "lucy_read_source":
        src = resolveSourceIdentity(toolArgs)          # connectionId + sourceName（+ schema）
        exposure = loadExposureSet(src.conn, src.schema, src.sourceName)
        decision = exposureDecision(exposure, toolName, src)
        if decision is deny:
            return writeToolDenial(requestId, decision.reason)      # fail-closed，零上游取数
        if decision.fullInventory:
            pass                                       # 未裁剪：行为与现状完全一致
        else:
            payload = stripUnexposedColumns(payload, decision.excluded)
            #   只裁「列」这一层：columns[] 里的未暴露列被移除；
            #   measures / segments / joins / grain 不在此步裁（D7），它们的一致性由 B1 保证

        payload._meta.lucy.exposure = {state: exposure.state, version: exposure.version, digest: exposure.digest}
        #   ↑ 发现面携带暴露集版本/摘要，供跨面一致性断言（D9 / SC-07）

    writeJsonRpcResponse(res, requestId, payload)

# 注：**已核实的**列级发现面只有 read_source——现行 lucy_catalog / kx_catalog 不返回列（E1），
#     catalog 的 source 列表属于表级授权面，不受暴露集影响——
#     「裁剪 ≠ 隐藏表」必须在验收里断言（SC-12）。
#
# ⚠️ 但「已核实」不等于「已穷尽」：entity_details / sl_validate（DATA_PLANE_TOOLS，acl.ts:86-93）
#    与 dictionary_search / discover_data（sensitive metadata tools，acl.ts:180）**不在 Proxy 本地执行集内**
#    （本地执行点只有 mcp-proxy.ts:4456 的 connection_list/lucy_catalog/kx_catalog 与 :4579-4581 的
#    explain/freshness），是**直转上游**的 Agent 入口，返回体在本仓无任何列级过滤。
#    这四个入口是否返回未暴露列名＝未核实（§1.3），裁剪只做 read_source 面即等于只做了一半。
```

### 3.3 流程 3：查数面点名未暴露列 → fail-closed（对应 D10／D11）

```text
# 位置：webui/server/proxy/acl.ts 的 authorizeAndRewrite（identity, toolName, args）——
#      判定必须发生在请求上行之前 ⇒ 零上游执行
# 顺序：既有形状门禁 → 本条字段级门禁 → 既有行策略注入（顺序本身是被断言的）
#
# ⚠️ 插入点必须是「对 lucy_query / lucy_explain_query 无条件执行」的位置，
#    不能挂在既有 protectedSources 分支下（那是「非通配表权限 + 有 scoped 行策略」才进的嵌套块，
#    且 validateProtectedLucyQueryArgs 只在 toolName == "lucy_query" 分支里被调用）。
#    正确插入点：acl.ts:3121-3122 的 hasRawQueryArg 形状检查之后（同样在 tableTouchingTools 块内），
#    早于 protectedSources 分支（acl.ts:3193）——此处对两个工具无条件执行。

function authorizeAndRewrite(identity, toolName, args):
    ...                                          # 既有：工具级 / 连接级 / 表级 / capability 判定（E4 位置）
    if toolName == "lucy_query" or toolName == "lucy_explain_query":
        shapeDeny = validateProtectedLucyQueryArgs(args)      # 既有形状门禁，顺序与码不变
        if shapeDeny != null:
            return deny(shapeDeny)

        # 【新增】字段级门禁：点名了未暴露列 ⇒ 本机拒绝，零上游执行
        exposureVerdict = validateQueryFieldsAgainstExposure(args, runtime.sourceMap)
        if exposureVerdict.denyReason != null:
            recordAuditAttribution(exposureVerdict.attribution)   # carrier + 列名（进审计，不进对外文案）
            return deny(exposureVerdict.denyReason)               # field_not_exposed / field_exposure_unavailable

    ...                                      # 既有行策略注入（FinalRows / forcedFilters）逻辑不动


function validateQueryFieldsAgainstExposure(args, sourceMap) -> Verdict:
    refs = collectNamedFieldRefs(args)
    #   覆盖全部载体（D10）：dimensions[].field / filters[].field / order_by|orderBy[].field
    #                       / measures[]（字符串或 {name}）/ segments[]
    #   字段引用是源限定名（E5）；列名部分 = 最后一个 "." 之后的片段
    for ref in refs:
        src = resolveSourceOfRef(ref, sourceMap)          # 无法归属到 Source 的引用不判（交由既有上游语义处理）
        if src == null:
            continue
        exposure = loadExposureSet(src.conn, src.schema, src.sourceName)
        decision = exposureDecision(exposure, "lucy_query", src)
        if decision is deny:
            return deny(decision.reason, attribution("exposure_unavailable"))
        if decision.fullInventory:
            continue
        if normalizeRef(columnOf(ref)) in decision.excluded:
            return deny("field_not_exposed", attribution(carrier = ref.carrier, column = columnOf(ref)))
    return allow()
```

### 3.4 流程 4：发布时对引用未暴露列的硬失败（对应 D12／D7）

```text
# 位置：webui/server/publish-gate.ts（新增检查函数，与 checkColumnTypeContract 同族，E17）
#      webui/server/semantic-assets.ts 的 publishSemanticAssets（并入既有门禁判定，E15）
# 目标：grain / measure / segment / join / 派生列 引用未暴露列 ⇒ 发布硬失败并指出引用方

function checkExposureReferenceContract(files, exposureResolver) -> PublishGateViolation[]:
    violations = []
    for file in files where file.kind == "semanticSource":
        src = parseSemanticSource(file.content)
        #   形状：name / table / grain[] / measures[{name,expr,filter}] / segments[{name,expr}]
        #         joins[{to,on,relationship}] / columns[{name,expr}]（派生列）—— 见 E9 与 normalize* 实现
        exposure = exposureResolver.forSource(src.conn, src.schema, src.sourceName)
        if exposure.state == unavailable:
            violations.push({checkId: "exposure.unavailable", filePath: file.targetPath,
                             message: `${src.sourceName} 的暴露台账不可用，无法校验引用`})
            continue
        excluded = exposure.excluded
        if excluded is empty:
            continue

        for col in src.grain:                                  # 引用方①：grain
            if normalizeRef(col) in excluded:
                violations.push({checkId: `exposure.grain.${normalizeRef(col)}`, filePath: file.targetPath,
                                 message: `grain 引用了未暴露列 ${col}`})

        for m in src.measures:                                 # 引用方②：measure
            for ref in referencedColumns(m.expr) ∪ referencedColumns(m.filter):
                if normalizeRef(ref) in excluded:
                    violations.push({checkId: `exposure.measure.${m.name}.${normalizeRef(ref)}`, filePath: file.targetPath,
                                     message: `measure ${m.name} 引用了未暴露列 ${ref}`})

        for s in src.segments:                                 # 引用方③：segment
            for ref in referencedColumns(s.expr):
                if normalizeRef(ref) in excluded:
                    violations.push({checkId: `exposure.segment.${s.name}.${normalizeRef(ref)}`, filePath: file.targetPath,
                                     message: `segment ${s.name} 引用了未暴露列 ${ref}`})

        for j in src.joins:                                    # 引用方④：join
            for ref in referencedColumns(j.on):
                if normalizeRef(ref) in excluded:
                    violations.push({checkId: `exposure.join.${j.to}.${normalizeRef(ref)}`, filePath: file.targetPath,
                                     message: `join ${j.to} 引用了未暴露列 ${ref}`})

        for c in src.columns where c.expr != null:             # 引用方⑤：派生列
            for ref in referencedColumns(c.expr):
                if normalizeRef(ref) in excluded:
                    violations.push({checkId: `exposure.derived.${c.name}.${normalizeRef(ref)}`, filePath: file.targetPath,
                                     message: `派生列 ${c.name} 引用了未暴露列 ${ref}`})
    return violations


# publishSemanticAssets 内的既有门禁段（E15，semantic-assets.ts:3063-3113）并入：
    contractViolations = [...列类型合同违规..., ...checkExposureReferenceContract(snapshot.files, resolver)]
    gateVerdict = evaluatePublishGate(contractViolations, exemption, now())
    if not (gate.ok and gateVerdict.allowed):
        → 写 blocked 发布记录（既有 semantic-assets.ts:3084-3112 路径）
        → 抛 SemanticAssetValidationError（既有 :3113-3129 路径，code "VALIDATION_GATE_FAILED"）
           errors = 逐条 {code:"CONTRACT_VIOLATION", message, filePath}
        #   message 必须点名「引用方 + 列名」，运维据此定位是 grain/measure/segment/join/派生列哪一处

# 不可豁免（D12）——必须新增前缀判定，不能只塞字面量：
    NON_WAIVABLE_CHECKS 保持精确集合（现有 "contract_presence" 不变）
    新增 NON_WAIVABLE_PREFIXES = ["exposure."]
    applyPublishExemption 的可豁免判定改为：
        waivable = not (NON_WAIVABLE_CHECKS.has(violation.checkId)
                        or any(prefix ∈ NON_WAIVABLE_PREFIXES
                               if violation.checkId.startsWith(prefix)))
                    and covers(exemption, violation)
    # ⚠️ 只往 NON_WAIVABLE_CHECKS 塞字面量 "exposure.*" 是无效的：
    #    判定用 Set.has（精确）与 checkIds.includes（精确），动态 id 一个都不匹配
```

### 3.5 流程 5：新列默认进入暴露集（对应 D5／C2）

```text
# 位置：扫描 / 索引重建路径（webui/server/ktx.ts:186-211 的 ktx admin reindex；E18）
# 目标：新扫描到的物理列默认暴露；裁剪靠事后在工作台收敛

function onManifestRegenerated(connectionId, schema, newManifest):
    #   新物理列进入库存（manifest 侧）：ktx 扫描重生成 manifest（E9）
    inventory = readPhysicalColumns(newManifest)              # 复用 E20 的读取口径
    ledger = readLedgerFile(connectionId, sourceName)
    if ledger is MISSING:
        return                                        # 无台账 ⇒ 全库存暴露，新列自然暴露（D5）
    # 有台账：排除集按列名显式列出，新列不在排除集里 ⇒ 默认暴露，无需任何写操作
    excluded = normalizeColumnNames(ledger.excluded_columns)
    assert newColumns ∩ excluded == ∅                 # 断言：新列不会被历史排除集误伤
    return

# 工作台侧（D14）：
function workbenchFieldList(sourceModel, exposureSet):
    #   列表 = 全量物理库存（E11），每行带「已暴露 / 已取消暴露」状态
    #   已取消暴露的列**仍在列表里**，以便恢复（D14）
    return sourceModel.columns.map(col => ({...col, exposed: not (normalizeRef(col.name) in exposureSet.excluded)}))
```

### 3.6 流程 6：半通禁令的可打假检查（对应 D9／SC-07）

```text
# 位置：webui/server/__tests__/ 下的跨面一致性自动化（本条专属断言）
# 目标：两面的裁剪集合必须完全相等；两面必须携带同一暴露集版本/摘要

case CROSS_SURFACE_CONSISTENCY(source, excludedColumns):
    exposure = loadExposureSet(source.conn, source.schema, source.sourceName)

    # 面①：发现面
    readRes = lucyReadSource(source)
    visibleColumns = extractColumnNames(readRes.payload)
    assert readRes.payload._meta.lucy.exposure.digest == exposure.digest

    # 面②：查数面
    hidden = [c for c in inventoryColumns(source) if c not in visibleColumns]
    for c in hidden:
        q = lucyQuery(source, {dimensions: [{field: `${source.sourceName}.${c}`}]})
        assert denied(q) and q.reason == "field_not_exposed"

    # 半通检测：若某个列在面①不可见、却在面②被放行 ⇒ 断言失败
    for c in visibleColumns:
        q = lucyQuery(source, {dimensions: [{field: `${source.sourceName}.${c}`}]})
        assert not denied(q)                        # 面②不得比面①更宽
    assert set(hidden) == set(columnsRejectedByQueryFace)
```

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 暴露台账随发布进入运行内容根；运行面读取的是内容根当前版本的台账，**不读浏览器本地状态**；台账缺失时等价「全库存暴露」 | 单元（读取器三种态：missing／configured／unavailable）＋ 发布后读取的进程内自动化 |
| SC-02 | 存量无显式配置的 Source 行为不变：发现面仍返回全量物理列，查数面不新增拒绝 | 单元＋进程内自动化（对照 Source） |
| SC-03 | 发现面裁剪：被取消暴露的物理列不出现在 `lucy_read_source` 返回体；已暴露列与 measures／segments／joins 不受影响 | 进程内自动化（真实 MCP `tools/call`） |
| SC-04 | 查数面 fail-closed：`lucy_query` 点名未暴露列 → 本机拒绝，reason code = `field_not_exposed`，**上游执行 = 0**。门禁对 `lucy_query`／`lucy_explain_query` **无条件执行**（不依赖是否有 scoped 行策略、不依赖是否持通配表权限） | 进程内自动化（loopback 上游执行计数）＋ 单元；**用例须含两条对照**：① **无 scoped 行策略的 Source**（暴露台账已配置但该 Source 无行策略）；② **持通配表权限（`tables:["*"]`）的 agent**——两者都必须被拒 |
| SC-05 | 查数面覆盖全部字段载体：`dimensions` / `filters` / `order_by｜orderBy` / `measures` / `segments` 任一载体点名未暴露列都被拒 | 单元（逐载体参数化断言） |
| SC-06 | `lucy_explain_query` 点名未暴露列同样被拒（本地诊断、不执行上游） | 单元＋进程内自动化 |
| SC-07 | **半通检查**：同一 Source 同一暴露集版本下，「发现面不可见列集合」== 「查数面被拒列集合」，且两面携带同一暴露集摘要。用例须覆盖**无 scoped 行策略的 Source**与**持通配表权限的 agent**——这两类若被查数面绕过，半通禁令即失效 | 跨面一致性自动化（§3.6 用例） |
| SC-08 | 发布 B1：`grain` / `measure` / `segment` / `join` / 派生列 引用未暴露列 → 发布硬失败（`VALIDATION_GATE_FAILED`），错误明细**点名引用方与列名** | 发布管线自动化（构造五类引用各一条） |
| SC-09 | `exposure.*` 检查**不可豁免**：带限时豁免的发布同样失败。断言必须绑定**前缀族机制**：构造一个 `checkId` 为 `exposure.grain.<某列>` 的动态违规（不是字面量 `"exposure.*"`）＋ 一条带 `checkIds:["exposure.grain.<某列>"]` 的有效限时豁免 → 仍必须失败 | 单元（豁免单测，**必须用动态 id**）＋发布管线自动化 |
| SC-10 | 新列默认暴露：新增物理列后不做任何裁剪，该列出现在发现面且可查 | 单元（排除集语义）＋ 进程内自动化 |
| SC-11 | 台账存在但不可用（损坏／版本不受支持／串源）→ **fail-closed**：该 Source 数据面拒绝，reason code = `field_exposure_unavailable`，不静默放行 | 单元（三种故障态注入）＋进程内自动化 |
| SC-12 | 暴露集**不按 Role／Agent 异列**：不同 Role 看到同一暴露集；`lucy_catalog` 的 source 列表不因暴露集变化（裁剪 ≠ 隐藏表） | 单元（多 Role 对照）＋进程内自动化 |
| SC-13 | 工作台：字段列表可见**全量库存**（含已取消暴露的列），可切换暴露／取消暴露，变更进待发布（不直接改运行内容根） | WebUI 组件测试＋发布工作台状态断言 |
| SC-14 | 交付口径：工作台文案、帮助文案、发布说明三处写明「业务暴露裁剪 ≠ 列级安全」；两个新 reason code 与「暴露集」主术语已登记进术语标准 | 术语标准登记核对＋文案断言 |
| SC-15 | 未裁剪 Source 与未启用本条的其余行为**不回归**：既有测试全绿；既有 reason code 与判定顺序不变 | 既有测试全绿＋回归对照 |

### 4.1 出口与不在出口

- 本条出口＝SC-01–SC-15 全部关闭。
- 客户端环境、Agent 路径、整库旅程、客户环境证据不在本条出口；按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `field_exposure` — 机器概念名（Lucy 侧字段暴露台账）。UI 主术语：**字段暴露**；台账中的未暴露列在用户可见文案里称**未暴露字段**（不用「禁用」「隐藏」「脱敏」——后者在现行口径里另有含义，见 `docs/governance/vision.md:219`）。须按 `webui/docs/00-product-terminology-standard.md` §5「新术语登记流程」在 §4.2 语义建模分区登记后方可实现。
- `field_not_exposed` — 机器 reason code（查数面拒绝：点名了未暴露字段）。**不新造用户可见译名**，映射到既有「访问控制」分区的裁决码呈现规则。
- `field_exposure_unavailable` — 机器 reason code（台账存在但不可用时的 fail-closed 拒绝）。与 `field_not_exposed` 分开，便于运维区分「用错字段」与「配置坏了」。

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

- 两个新 reason code 与「字段暴露 / 未暴露字段」主术语需登记进 `webui/docs/00-product-terminology-standard.md`（Plan S0 前置项）。
- 若后续 `lucy_catalog` / `kx_catalog` 增加列预览（当前不返回列，见 §1.2 E1），必须复用同一暴露集读取器，不得另起一套裁剪口径。

---

## 7. 非目标

- 不做列级 ACL、列级脱敏、按 Role／Agent 异列；暴露集是 Source 级、全实例同一套（D6）。
- 不替代合规用 VIEW／拆表兜底（E22）；不提供「库内不可见」能力。
- 不改库表结构；不从 Manifest 物理删除列；不改 KTX「全物理列」合同作为主路径（D1、D16、D17）。
- 不改 KTX 上游源码；不改 `access.yaml` 的 ACL 模型与既有 reason code。
- 不做派生列／measure／segment／join 自身的暴露开关（只覆盖物理列，D7）。
- 不改 Row Policy 的字段绑定口径与行策略注入顺序；本条的字段级门禁在既有形状门禁之后、既有行策略注入之前（D8 流程 3 的顺序即被断言）。
- 不改 `sl_read_source` / `sl_query` 的默认 deny 口径（E8）；旧工具若被显式放开，作为已知残余处理。

---

## 8. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | 旧 `sl_query` / `sl_read_source` 若被显式放开（默认在 `deny_tools`，E8），不经 Lucy 门面闸 | 现行默认口径已挡住；本条不扩到旧工具 | 后续条目，需与「旧工具是否整体退役」一并评估 |
| RES-02 | 字段存在性不构成安全承诺：`field_not_exposed` 会告诉调用方「该字段存在但未暴露」 | 本条不是安全边界（D15）；为运维可诊断性保留 | 与「是否需要存在性保密」一并评估 |
| RES-03 | KTX `sl_read_source` 返回体的确切列形状未核实，裁剪实现依赖开工前固化的真实形状（§1.3） | 影响实现细节，不影响本条承诺 | 开工前置项 |
| RES-04 | 派生列／measure／segment 自身不可被裁剪（D7） | 若业务需要隐藏某个派生指标，本条不覆盖 | 后续条目 |
| RES-05 | 暴露集与内容根的绑定依赖发布提升流程；若内容根被绕过发布窗口直接改写，运行面读到的是未发布台账 | 与既有「发布即生效」口径同源，非本条新增风险 | 随发布管线一并评估 |
| RES-06 | **台账丢失与「从未配置」不可区分**：台账被误删／漏提升时该 Source 静默恢复全暴露，且两面一致（D9／SC-07）不会报错 | §9 风险表的缓解要求发布门禁记录「期望台账集合」，台账消失即发布失败（可自动检测） | 随本条实现落地；不得以「运维注意」收口 |

---

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 半通：发现面已裁、查数面仍通 | 两面若各自读一份暴露集或各自实现裁剪，会出现不一致 | 单一读取器 + 单一摘要（SC-07 跨面一致性断言） |
| 查数面误杀合法查询 | 字段限定名解析或排除集归一化不一致，会把合法过滤拦掉 | 源限定名解析与 `normalizeRef` 口径统一；SC-02／SC-15 锁住未裁剪路径不回归 |
| 台账损坏导致大面积拒绝 | D8 的 fail-closed 只作用在「已配置」的 Source | 未配置 Source 不受影响（SC-02）；故障态有独立 reason code（SC-11）便于定位 |
| **台账丢失／漏提升 ⇒ 静默恢复全暴露** | D8 的「台账不存在＝未配置＝全暴露」在**台账本应存在**时不可区分：台账被误删、或新增 Source 漏提升台账时，该 Source 静默回到全暴露，D9 两面一致性与 SC-07 **不会报任何错**（两面看到的是同一份「全暴露」） | 缓解必须是**可判定**的落地，不能只写「注意」：①发布门禁记录「每个 Source 期望的台账集合」，台账消失即**发布失败**；②台账内加 `configured` 标记，区分「从未配置」与「已配置但丢失」。本条要求实现至少落 ①（可自动检测），并在 Plan 前置固化验证步骤 |
| 发布门禁误杀存量 | B1 若对存量 overlay 立即生效，历史数据可能大面积失败 | 门禁只在「该 Source 有排除集」时生效；存量默认无排除集即不触发（SC-08 覆盖五类引用） |
| KTX 侧行为未核实 | 台账落点依赖 KTX loader 对下划线目录的处理（§1.3） | Plan 前置项写死验证步骤；两条候选落点均可在本仓实现 |
| 与既有「全物理列」叙事冲突 | 交付方可能误以为暴露裁剪＝删列 | D17 + 术语小节 Forbidden terms + D15 交付口径三处写明 |
| 暴露裁剪被误当安全能力交付 | 客户可能据此认为数据已脱敏 | 工作台／帮助／发布说明三处固定文案（SC-14） |

---

## 10. 出处

- 需求池：[`REQ-030-012`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（背景／期望方向／非目标／已知硬约束／关联）
- 上位合同：
  - [`docs/governance/DEVELOPMENT.md`](../../docs/governance/DEVELOPMENT.md) §「语义层（semantic-layer）分层」（`:344-394`）
  - [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.2 请求生命周期（`:67-86`）、§4.3（`:88-101`）、§6.2 `kx_catalog` 返回合同（`:555-588`）
  - [`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`](../../webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md) §Table Semantic Workbench Requirements（`:188-256`）
  - [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §3 全局固定术语表（`:128-283`）、§5 新术语登记流程（`:1007-1016`）
  - [`docs/governance/vision.md`](../../docs/governance/vision.md) `:139`、`:219`
  - [`docs/access-control/design-governance-baseline.md`](../../docs/access-control/design-governance-baseline.md) `:158-170`
- 实现证据（本 Spec §1.2 已逐条打开确认）：
  - `webui/server/proxy/acl.ts:86-93`、`:152-159`、`:1986-2035`、`:3062`、`:3197-3200`
  - `webui/server/proxy/mcp-proxy.ts:930-956`、`:958-1019`、`:1214-1240`、`:1576-1620`、`:1647-1689`、`:2827-2846`、`:4456-4506`、`:5594-5599`、`:5990-6009`
  - `webui/server/proxy/row-policy.ts:407-455`
  - `webui/server/proxy/row-policy-catalog.ts:50-53`、`:289-304`、`:337-413`、`:437-507`
  - `webui/server/semantic-layer.ts:102-166`、`:271-275`、`:320-331`、`:377-408`、`:578-601`、`:646-660`
  - `webui/server/publish-gate.ts:19-22`、`:60-92`、`:110-141`、`:155-176`、`:209-226`
  - `webui/server/publish-workbench-state.ts:41`、`:61`、`:105`、`:169-172`、`:189-234`
  - `webui/server/publish-coordinator.ts:33`、`:391-430`
  - `webui/server/semantic-assets.ts:3056-3129`
  - `webui/server/index.ts:2406-2443`、`:2664-2686`
  - `webui/server/ktx.ts:186-211`
  - `webui/server/paths.ts:20`、`:41-53`、`:85-123`
  - `webui/src/pages/TableEditor.tsx:102-115`、`:139-147`、`:163`、`:440-448`
  - `.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147`
