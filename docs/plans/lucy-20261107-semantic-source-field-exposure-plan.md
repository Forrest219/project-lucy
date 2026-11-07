# Lucy 语义层 Source 级字段暴露裁剪 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立，待 PM 指派台账号后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。S0–S7 全部未开工 |
| 授权边界 | **不授权改代码。** 本 Plan 只定义步骤、验收与完成定义；开工须先取得本条的开工授权（PM 评审 Spec 与本 Plan 后明示） |
| 验收 | S0–S7 各自出口见 §4；本条总出口＝Spec 的 SC-01–SC-15 全部关闭 |
| 对应 Spec | [lucy-20261107-semantic-source-field-exposure-spec.md](../specs/lucy-20261107-semantic-source-field-exposure-spec.md) |
| 需求池条目 | REQ-030-012 |

---

## 目标

把 REQ-030-012 登记的四条期望方向（澄清已认可路线 1）落成可实现、可打假的功能合同：

1. **库存 ≠ 暴露（基础结构）**：Manifest／扫描保留全量物理库存；另维护 Source 级暴露台账，全实例同一套采用集，存量无显式配置等价全库存暴露。
2. **运行时 A1**：未暴露列在发现面（`lucy_read_source`）不可见；查数面（`lucy_query` / `lucy_explain_query`）点名未暴露列一律本机拒绝（fail-closed，零上游执行）。
3. **发布 B1**：`grain` / `measure` / `segment` / `join` / 派生列 引用未暴露列 → 发布硬失败并点名引用方。
4. **操作面 D1**：表语义工作台字段列表维护暴露／取消暴露，取消暴露的列仍可见可恢复，变更进待发布。

同时把需求池的「**半通禁令**」做成可断言的不变量：发现面不可见列集合 **==** 查数面被拒列集合，两面携带同一暴露集摘要。

不做：列级 ACL／脱敏／按 Role 异列；不改 KTX 上游与「全物理列」合同；不改库表结构；不从 Manifest 物理删列；不替代合规用 VIEW。

---

## 开工前置

开工前必须全部满足，缺一项即停：

1. **开工授权**：PM 评审通过本 Spec 与本 Plan 并明示授权实现。**未授权前 S0–S7 全部不得开始**——S0 虽不是改运行代码，但它是**真实写操作**（改写 `webui/docs/00-product-terminology-standard.md` 登记新机器码 ＋ 冻结三处固定文案），不得以「先登记术语」为由在未授权状态下落盘。PM 明示授权后才从 S0 起。
2. **术语登记先行**：`field_exposure`、`field_not_exposed`、`field_exposure_unavailable` 三个新码先按 `webui/docs/00-product-terminology-standard.md` §5 登记（§4.2 语义建模分区）。新机器码不先登记就实现属术语违规。
3. **KTX loader 行为确认（Spec §1.3 未核实项 1）**：确认 KTX 侧是否会把 `semantic-layer/<conn>/_exposure/`（或任何新增下划线目录）下的 yaml 当作语义 source 加载。确认结果决定台账落点：落 `semantic-layer/<conn>/_exposure/` 还是内容根下的独立目录（后者需扩 `webui/server/paths.ts:20` 的 `CONTENT_DIR_NAMES` 与 `webui/server/publish-workbench-state.ts:189-204` 的扫描根）。**未确认前不得落盘台账文件。**
4. **上游返回体形状固化（Spec §1.3 未核实项 2）**：用真实上游返回体固化 `lucy_read_source` 的列数组形状与键名，作为裁剪实现的输入契约。
5. **发现面穷尽性确认（Spec §1.3 未核实项 4，本条新增硬前置）**：`entity_details` / `sl_validate`（`acl.ts:86-93` 的 `DATA_PLANE_TOOLS`）、`dictionary_search` / `discover_data`（`acl.ts:180` 的 `DEFAULT_SENSITIVE_METADATA_TOOLS`）**不在 Proxy 本地执行集内**，是直转上游的 Agent 入口，返回体在本仓无任何列级过滤。开工前须用真实上游确认这四个入口**是否返回列／字段名**：若返回，则本条必须一并裁剪，否则「发现面已裁」是假的——池硬约束#2「A1 必须覆盖所有 Agent 查数／发现入口」未闭环。**确认结果若为「会返回」，须回评审补 SC**，不得在实现里临时决定。
6. **台账格式冻结**：Spec D2／D5 的候选格式（`version` / `source` / `excluded_columns` / `updated_at`）经 PM 与 FDE 确认后冻结；冻结后改格式须回评审。
7. **与既有合同的冲突点处理结论**（逐条已定，不在实现里临时决定）：
   - 与 semantic-author「standalone source 必须含全部物理列」的规则：规则**不改**（`.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147`）；只在文档与提示里补「暴露裁剪 ≠ 删列，库存仍须全量」（Spec D17）。
   - 与发布扫描的种类分类：**真正决定「什么被当 overlay 上传给 KTX」的是四处判定点**——`semantic-assets.ts:1714-1718` 的 `kindForPendingPath`（不含 `/_schema/` 一律 `semanticSource`）、`semantic-assets.ts:637-726` 的 `classifyYaml`（无 `tables:`／`name:` 一律 `UNKNOWN_SHAPE` **硬失败**，`:726`）、`publish-workbench-state.ts:169-172` 的 `semanticKind()`（只判 `parts[0]==="_schema"`）、`publish-workbench-state.ts:752-757` 的 `kindForLogicalPath()`（才按 `parts[2]==="_schema"` 判）。**台账 yaml 会落 `classifyYaml` 的 `UNKNOWN_SHAPE` 硬失败**，不是「被当成 overlay 上传」→ **四处都要改**，新增台账种类且台账不参与 KTX 上传（Spec D4）。
   - 与发布门禁的不可豁免判定：现行 `NON_WAIVABLE_CHECKS` 是**精确字符串集合**（`publish-gate.ts:19-22`），判定用 `Set.has`（`:130`）、豁免侧用 `checkIds.includes`（`:98`）——**无前缀族机制**；只塞字面量 `"exposure.*"` 对动态 id 无效。须新增 `NON_WAIVABLE_PREFIXES` 并改判定（Spec D12／§3.4）。
   - 与 `access.yaml` 的 ACL 模型：暴露集**不进** Role／Agent 配置，也不参与 `policyVersion` 计算；它是 Source 级、全实例同一套（Spec D6）。
   - 与内容根四目录常量：仅当第 3 项结论选「内容根独立目录」时才扩 `CONTENT_DIR_NAMES`（`webui/server/paths.ts:20`）。
   - 与既有 reason code 体系：只新增两个码，不改既有码的含义与触发时机（Spec D13）。
8. **基线取证**：在本机保存改动前的证据——`lucy_read_source` 返回**全量物理列**、`lucy_query` 点名任意列不被本机拒绝。作为红基线，验收时用于证明行为确实被改变且只改变应改变的部分。
9. **归属确认**：本条要改 `webui/server/proxy/{acl,mcp-proxy}.ts`、新增 `webui/server/proxy/field-exposure.ts`、`webui/server/{publish-gate,semantic-assets,publish-workbench-state}.ts`、`webui/server/paths.ts`、`webui/src/pages/TableEditor.tsx`。开工前对照 `0.30` 批次地图确认无他人同时在写这些文件。

---

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 术语与口径登记：登记 `field_exposure` / `field_not_exposed` / `field_exposure_unavailable`；冻结三处固定文案「业务暴露裁剪 ≠ 列级安全」（工作台 / 帮助 / 发布说明） | 术语标准更新 ＋ 文案清单 | SC-14 |
| S1 | 台账格式与读取器：实现 `webui/server/proxy/field-exposure.ts`；三态（missing＝未配置＝全暴露 / configured / unavailable＝故障）；排除集编码；产出内容摘要 digest；单元覆盖三态与归一化 | 读取器 ＋ 单元 | SC-01、SC-02、SC-10、SC-11 |
| S2 | 落点与发布接线：按前置第 3 项的结论落台账目录；发布扫描新增台账种类（**四处判定点：`semanticKind`／`kindForLogicalPath`／`kindForPendingPath`／`classifyYaml`**，台账不参与 KTX 上传）；台账随发布批次进入运行内容根；浏览器本地状态不参与判定 | 发布扫描扩展 ＋ 内容根接线 ＋ 单元 | SC-01、SC-02 |
| S3 | 发现面裁剪：在 `writeLucySemanticResponse` 的 `lucy_read_source` 分支裁掉未暴露列，写入暴露集状态／版本／摘要；台账不可用 → fail-closed 拒绝 | Proxy 发现面裁剪 ＋ 单元 | SC-03、SC-11 |
| S4 | 查数面门禁：在 `authorizeAndRewrite`（`identity, toolName, args`）的 `lucy_query` / `lucy_explain_query` 分支加字段级门禁；**插入点＝`acl.ts:3121-3122` 的 `hasRawQueryArg` 检查之后、早于 `protectedSources` 分支（`:3193`）——此处对两个工具无条件执行**（挂在 protectedSources 下会漏掉无行策略 Source 与持通配表权限的 agent）；覆盖 `dimensions` / `filters` / `order_by｜orderBy` / `measures` / `segments` 全部载体；源限定名解析；判定在请求上行之前（零上游执行） | Proxy 查数面门禁 ＋ 单元 | SC-04、SC-05、SC-06 |
| S5 | 发布门禁 B1：新增 `checkExposureReferenceContract`（grain / measure / segment / join / 派生列五类引用方）；**新增 `NON_WAIVABLE_PREFIXES = ["exposure."]` 并把 `applyPublishExemption` 的可豁免判定改为「精确命中 或 前缀命中」**（现行只有精确匹配，塞字面量 `"exposure.*"` 无效）；并入既有发布门禁；错误明细点名引用方与列名 | 发布门禁检查 ＋ 豁免判定改动 ＋ 单元 ＋ 发布管线自动化 | SC-08、SC-09 |
| S6 | 工作台：字段列表（全量库存）每行增「暴露状态」与开关；取消暴露的列仍在列表里可恢复；变更进待发布（不直接改运行内容根）；补三处固定文案 | 工作台改动 ＋ 组件测试 | SC-13、SC-14 |
| S7 | 跨面一致性与收口：跨面一致性自动化（发现面不可见列集合 == 查数面被拒列集合；两面同一摘要）；未裁剪路径回归对照；跑 lint 与全量测试；写收口记录 | 一致性自动化 ＋ 绿证据 ＋ 收口记录 | SC-07、SC-12、SC-15、SC-01–SC-14 |

**步骤依赖**：S0 → S1 → S2；S3、S4 依赖 S1（共用读取器）；S5 依赖 S1（同一排除集口径）与 S2（台账随发布进内容根）；S6 依赖 S1（暴露状态来源）与 S2（变更进待发布）；S7 依赖全部。S3 与 S4 可并行，但**同一工作区不并行写同一文件**（S3 写 `mcp-proxy.ts`，S4 写 `acl.ts`，S6 写 `TableEditor.tsx`）。

---

## 验收

### 4.1 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 三个新码与主术语已登记进术语标准；三处固定文案成文 |
| S1 | 读取器单元通过：missing → 全暴露、configured → 排除集生效、unavailable → 故障态；digest 稳定 |
| S2 | 台账随发布进入运行内容根的自动化断言通过；发布扫描把台账识别为台账（不当作 overlay）；未跟踪浏览器状态时判定结果不变 |
| S3 | SC-03、SC-11 通过：未暴露列不出现在 `lucy_read_source` 返回体；台账不可用时拒绝且零上游取数 |
| S4 | SC-04、SC-05、SC-06 通过：五个载体逐个被拒；拒绝码 = `field_not_exposed`；上游执行 = 0 |
| S5 | SC-08、SC-09 通过：五类引用各一条构造用例均硬失败且错误明细点名引用方；带豁免仍失败 |
| S6 | SC-13、SC-14 通过：字段列表含已取消暴露的列；开关变更进待发布；三处文案到位 |
| S7 | SC-01–SC-15 全部通过；跨面一致性断言通过；未裁剪路径不回归；lint 与测试全绿 |

### 4.2 证据等级

- 本条收口证据以**本机自动化**（单元／组件／真实进程内 Proxy 自动化）＋**CI job** 两级为准。
- 真实客户环境、真实 Agent 客户端、镜像构建与客户交付**不在本条出口**；需要时按 `docs/governance/DEVELOPMENT.md` 归发布取证层处理。
- 不得用 mock 冒充「零上游执行」：该断言必须由 loopback observer 的执行计数给出（与 REQ-030-013 的取证纪律同口径）。
- 不得用 mock 冒充「台账随发布进入内容根」：该断言必须跑真实的发布流程（发布 → 内容根读取）。

### 4.3 门禁

| 命令 | 期望 |
|---|---|
| `npm run lint:spec-docs` | exit 0（本 Spec 与本 Plan 需在 `docs/README.md` / `docs/plans/README.md` 登记） |
| `npm run lint:spec` | exit 0 |
| `npm run lint:terminology` | exit 0（新 reason code 与主术语已登记） |
| `npm run lint:ia-boundary` | exit 0 |
| 受影响测试文件 | 全绿 |

---

## 完成定义

- [ ] Spec 的 SC-01–SC-15 全部关闭，逐条落点写进 Spec §4 与收口记录。
- [ ] 暴露台账随发布进入运行内容根；运行面判定不依赖浏览器本地状态。
- [ ] 存量无显式配置的 Source 行为不变（发现面全量、查数面不新增拒绝）。
- [ ] 发现面与查数面使用同一暴露集与同一摘要；跨面不可见／被拒集合完全相等。
- [ ] 查数面五个字段载体逐个被拒，且零上游执行。
- [ ] 发布门禁对五类引用方硬失败并点名引用方与列名；`exposure.*` 不可豁免。
- [ ] 新物理列默认暴露；取消暴露的列在工作台仍可见可恢复；变更进待发布。
- [ ] 台账存在但不可用时 fail-closed，有独立 reason code；未配置 Source 不受影响。
- [ ] 暴露集不按 Role／Agent 异列；`lucy_catalog` 的 source 列表不因暴露集变化。
- [ ] 三个新码与主术语已登记进术语标准；三处固定文案写明「业务暴露裁剪 ≠ 列级安全」。
- [ ] 未改动 KTX 上游、未改 semantic-author 的「全物理列」规则、未改库表结构、未从 Manifest 删列、未改既有 reason code 与行策略口径。
- [ ] 状态镜像改齐：Spec 头部「状态」行（本条事实源）、本 Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9；需求池 REQ-030-012 状态同步为「已开 Spec/Plan，待评审」。
- [ ] 收口记录写入 `docs/reviews/`，并注明「本条收口不表示可上线」。

---

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 半通：发现面已裁、查数面仍通 | 两面各读一份暴露集或各自实现裁剪时会出现不一致 | 单一读取器 + 单一 digest；SC-07 跨面一致性断言为必过项 |
| 查数面误杀合法查询 | 字段限定名解析或排除集归一化不一致会拦掉合法过滤 | 源限定名解析与 `normalizeRef` 口径统一；SC-02／SC-15 锁住未裁剪路径不回归 |
| 台账损坏导致批量拒绝 | fail-closed 只作用在「已配置」的 Source，但配置面可能很大 | 未配置 Source 不受影响（SC-02）；故障态独立 reason code（SC-11）便于定位 |
| 发布门禁误杀存量 | B1 若对存量 overlay 立即生效，历史数据可能大面积失败 | 仅当该 Source 存在排除集时生效；SC-08 覆盖五类引用构造用例 |
| KTX 侧行为未核实 | 台账落点依赖 KTX loader 对新目录的处理（Spec §1.3） | 开工前置第 3 项写死验证步骤；两条候选落点的改动面均可在本仓指认 |
| 与「全物理列」叙事冲突 | 交付方可能误以为暴露裁剪＝删列 | D17 ＋ 术语小节 Forbidden terms ＋ 三处固定文案 |
| 暴露裁剪被误当安全能力交付 | 客户可能据此认为数据已脱敏 | 工作台／帮助／发布说明三处固定文案（SC-14）；术语小节禁止「列级脱敏」表述 |
| 与 `0.30` 其他批次争同一文件 | 本条改 `acl.ts` / `mcp-proxy.ts` / `publish-gate.ts` / `semantic-assets.ts` / `paths.ts` / `TableEditor.tsx` | 开工前置第 9 项对照批次地图；同一文件同一时刻只允许一个写入方 |
| 索引与发布窗口耦合 | 台账随发布进入内容根需与既有 reindex／发布窗口协同（`publish-coordinator.ts`） | S2 只扩种类分类与落点，不改发布窗口时序；S2 后单独复跑发布管线 |

---

## 回滚

- S1–S5 均为服务端判定与门禁改动，回滚＝还原对应提交，无数据迁移。
- S2 的台账落点若已产生文件，回滚＝随内容根版本回退（台账是内容，不进运行态缓存）。
- S6 的工作台改动回滚＝还原前端提交；已提交的待发布变更按既有发布恢复流程处理。
- 术语标准登记项在回滚时同步撤回。

---

## 出处

- 需求池：[`REQ-030-012`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（背景／期望方向 A1·B1·C2·D1／非目标／已知硬约束／关联）
- 对应 Spec：[`lucy-20261107-semantic-source-field-exposure-spec.md`](../specs/lucy-20261107-semantic-source-field-exposure-spec.md)（设计决策 D1–D17、核心流程 §3.1–§3.6、验收 SC-01–SC-15）
- 上位合同：
  - [`docs/governance/DEVELOPMENT.md`](../../docs/governance/DEVELOPMENT.md) §「新增 Spec / Plan 的落盘清单」（`:192-253`）、§「语义层（semantic-layer）分层」（`:344-394`）
  - [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.2（`:67-86`）、§4.4（`:113-125`）、§6.2（`:555-588`）
  - [`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`](../../webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md) §Table Semantic Workbench Requirements（`:188-256`）
  - [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §5 新术语登记流程（`:1007-1016`）
  - [`docs/governance/vision.md`](../../docs/governance/vision.md) `:139`、`:219`
- 实现证据（前置项与步骤引用，均已实际打开确认）：
  - `webui/server/proxy/acl.ts:86-93`、`:152-159`、`:1986-2035`、`:3062`、`:3197-3200`
  - `webui/server/proxy/mcp-proxy.ts:958-1019`、`:1214-1240`、`:1576-1620`、`:1647-1689`、`:2827-2846`、`:4456-4506`、`:5594-5599`、`:5990-6009`
  - `webui/server/proxy/row-policy.ts:407-455`
  - `webui/server/proxy/row-policy-catalog.ts:50-53`、`:289-304`、`:337-413`、`:437-507`
  - `webui/server/semantic-layer.ts:102-166`、`:271-275`、`:320-331`、`:377-408`、`:578-601`、`:646-660`
  - `webui/server/publish-gate.ts:19-22`、`:60-92`、`:110-141`、`:155-176`、`:209-226`
  - `webui/server/publish-workbench-state.ts:41`、`:61`、`:169-172`、`:189-234`
  - `webui/server/publish-coordinator.ts:33`、`:391-430`
  - `webui/server/semantic-assets.ts:3056-3129`
  - `webui/server/index.ts:2406-2443`、`:2664-2686`
  - `webui/server/ktx.ts:186-211`
  - `webui/server/paths.ts:20`、`:41-53`、`:85-123`
  - `webui/src/pages/TableEditor.tsx:102-115`、`:139-147`、`:163`、`:440-448`
  - `.cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py:120-147`
