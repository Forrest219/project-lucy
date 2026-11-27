# 语义层 overlay 发布通道冲突护栏与生命周期修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 语义层 overlay 发布通道冲突护栏与生命周期修复 Spec |
| 文档类型 / 版本 | Spec（纯 API 功能合同）／**v1.2** |
| 日期 / 目标版本 | 2026-11-25／产品线 `0.35.0`（`lucy-v0.35`；总账与需求池暂挂 `0.30` 池） |
| 功能编号 / 优先级 | **P1-91**／REQ-030-112／**P1（治理主路径可用性／事故修复）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账（P1-91） |
| 阶段 | S5 |
| 状态 | S5｜v1.2。**功能合同已收口**（2026-11-28，[收口记录](../reviews/2026-11-28-p191-s5-closure-record.md)：SC-01–SC-09 全部关闭；测试台 `UAT-SUITE-OVERLAY-PUBLISH-GUARD` **PASS**——R0／OPG-01–08 全绿，GAP-OPG-08-BATCH 于 2026-11-27 补跑关闭，GAP-OPG-02-ENGINE 于 2026-11-28 隔离栈＋Doris 引擎补验关闭（`lucy_query` 三段名全链路 `rows=[[142.5, 142.5]]`，委托人 2026-11-27 亦明示接受 Task 0 实证口径））；终稿已确权（委托人 2026-11-26，OQ-1～OQ-6 已裁）；开发授权已获得（2026-11-26）；不入核心分母；≠ 可上线 |
| 需求来源 | 2026-11-25 客户现场报告 [`inbox/Lucy新表接入_overlay与schema冲突_问题报告.md`](../../inbox/Lucy新表接入_overlay与schema冲突_问题报告.md)（平台 v0.25.0，`sql_server`／`BIDW`：publish 发出的 per-table 文件两段名顶掉 manifest 三段名定义，`lucy_query` 报 `Invalid object name`，API 无法删除，SSH 清理后恢复）及同日前序报告 [`inbox/Lucy语义层新表接入_覆盖门禁死锁_Bug报告.md`](../../inbox/Lucy语义层新表接入_覆盖门禁死锁_Bug报告.md) 的 `semantic-assets/publish` 覆盖门禁删除 snapshot 与 `plans` 错误码误导部分（v0.2 从 P1-90 归口至本条）＋ 本仓库与上游 `@kaelio/ktx@0.16.0` npm 包逐条代码核查 |
| 实施主体 | Lucy 服务端（`webui/server/semantic-assets.ts`、`webui/server/semantic-batch-routes.ts`、`webui/server/index.ts`，提案新增 `webui/server/semantic-overlay-lifecycle.ts`）、`webui/docs/03-api-spec.md`、`docs/SYSTEM_HANDBOOK.md`；不改 KTX 源码；不改 WebUI 运行导航；不触碰 `webui/server/proxy/**`（OQ-3 另案） |
| 配对计划 | [`docs/plans/lucy-20261125-overlay-publish-guard-plan.md`](../plans/lucy-20261125-overlay-publish-guard-plan.md) |
| 测试台 | PASS（[UAT-SUITE-OVERLAY-PUBLISH-GUARD](../qa/uat/suites/overlay-publish-guard/suite.md)／`UAT-OPG-01`–`08`；[主跑次](../qa/uat/suites/overlay-publish-guard/runs/2026-11-26-claude-p19x-isolated.md)＋[batch 收口](../qa/uat/suites/overlay-publish-guard/runs/2026-11-27-claude-opg08-batch.md)＋[引擎面补验](../qa/uat/suites/overlay-publish-guard/runs/2026-11-28-claude-opg02-engine-doris.md)） |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.2 | 2026-11-28 **功能合同收口（S4 → S5）**：SC-01–SC-09 全部关闭（[收口记录](../reviews/2026-11-28-p191-s5-closure-record.md)）；测试台套件 PASS——GAP-OPG-08-BATCH 于 2026-11-27 补跑关闭，GAP-OPG-02-ENGINE 于 2026-11-28 隔离栈＋Doris 引擎补验关闭（`lucy_query` 三段名 `internal.p191eng.t_orders` 全链路 `rows=[[142.5, 142.5]]`；委托人 2026-11-27 亦明示接受 Task 0 实证口径）。≠ 可上线。 |
| v1.1 | 2026-11-26 Task 0 引擎实证通过（方案 A 成立，记录 [`inbox/p191-task0/RECORD.md`](../../inbox/p191-task0/RECORD.md)）；委托人明示开发授权（P1-89 → P1-90 → P1-91 串行落地）；测试台套件 `UAT-SUITE-OVERLAY-PUBLISH-GUARD`（`UAT-OPG-01`–`08`）建立并挂勾连；状态行更新。≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| v1.0 | 2026-11-26 **终稿确权**（委托人明示「逐项拍板，完成终稿确权（S1 → S2）」）：OQ-1＝设计冻结方案 A，Task 0 改挂开发授权前置；OQ-2＝列表 API 为主；OQ-3＝explain 冲突另案；OQ-4＝方案 A；OQ-5＝validate warnings＋`allowManifestShadow`＋batch 不硬阻断；OQ-6＝路径参数 DELETE＋既有 prune。阶段 S2；开发未授权；测试台 not_registered；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。材料：[确权材料](../reviews/2026-11-26-p1-89-90-91-ratification-brief.md)。 |
| v0.2-draft | 2026-11-25 委托人授权跨 Spec（P1-89／P1-90／P1-91）MECE 边界优化：1) **独占 `semantic-assets` 通道收口**：整体承接原 P1-90 F-b（publish 覆盖门禁 409 阻断不删 validation snapshot）与 F-c（`plans/:validationId` 非 batch 快照返回 `409 PLAN_PREVIEW_NOT_AVAILABLE`），消除两份 Spec 双头改 `semantic-assets.ts`；2) **定义双 409 门禁组合确认语义**：同一次 publish 同时命中覆盖门禁与同名 shadow 冲突时返回 `data.pendingConfirmations` 列表，支持一次带齐 `confirmOverwrite:true`＋`allowManifestShadow:true` 重试成交；3) **修复 DELETE 误删安全合并型 overlay 风险**：按文件内容区分 standalone（含 `table:`/`sql:`）与业务合并型 overlay（不含 `table:`/`sql:`），默认仅允许直接删 standalone，删业务合并型 overlay 需显式 `confirmBusinessOverlayDelete=true`；补齐 `withDisplayWriteBarrier(["D"])` 与 `reloadCatalog`；4) **补齐只读可发现性端点**：新增 `GET /api/semantic-assets/overlays?conn=` 消除盲删缺口；5) **对齐 P1-89 D8 写接口信封**：补齐 `deleted`/`noChanges`/`deletedFiles`、未知参数 400 与 `data.nextSteps` 数组；SC 扩至 SC-01–SC-09。仍 S1、终稿未确权、开发未授权。 |
| v0.1-draft | 2026-11-25 初稿。依据客户修正版报告与 Lucy／上游 KTX 逐条代码核查落盘。仅登记与起草，终稿未确权，开发未授权。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：治理方经 `POST /api/semantic-assets/validate + publish` 发布 per-table source 文件时，系统要么产出**物理表名可正确表达**（含 `db.schema.table` 三段名）且**不与既有 Schema Manifest 静默冲突**的文件，要么在写盘前显式拒绝并保留 validation snapshot、给出可执行的下一步（覆盖门禁与同名冲突双门禁支持单次组合确认重试；`plans` 对非 batch 快照诚实区分 409 与 404）；已落盘的 per-table 文件可经公开 API **只读发现并受控删除清理**（保护 WebUI 合法业务合并型 overlay 不被误删），删除后该表读取回落 Schema Manifest 定义并即时刷新展示缓存，不再只能 SSH 改服务器文件。
- 本条出口：SC-01–SC-09 的本机自动化测试、实现审查、OQ-1 引擎实证记录，以及终稿确权后所立测试台套件（预定 `UAT-OPG-*`）在隔离 Docker demo 上的全真跑次。
- 不在本条出口：Schema Manifest 单表追加端点与 schema 名大小写归一化（归 **P1-90**）；既有 `PUT`/`import` 零写入诚实化与 WebUI 提示（归 **P1-89**）；per-table overlay 纳入 catalog 表清单的架构变更；KTX 上游行为变更（按 AGENTS.md KTX 边界，护栏全部落 Lucy 侧）；存量冲突文件的自动迁移／自动删除（OQ-2）；`lucy_explain_query` 冲突可见性（OQ-3 另案）；WebUI 语义资产发布界面变更与导航 IA；多写者／多副本拓扑。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None。端点名 `GET /api/semantic-assets/overlays`、`DELETE /api/semantic-assets/overlay/:conn/:sourceName` 与错误码 `OVERLAY_MANIFEST_CONFLICT`／`OVERLAY_NOT_FOUND`／`OVERLAY_DELETE_FORBIDDEN`／`OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`／`PLAN_PREVIEW_NOT_AVAILABLE` 为 API 工程契约（OQ-5／OQ-6 已冻结命名），不新增 WebUI 界面术语；文档正文继续使用「Schema Manifest」英文原词与既有「per-table overlay」工程称谓（禁止译作「清单／舱单」）。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条仅新增／调整服务端 API 端点、校验规则、错误码与拒绝文案，并修订 `webui/docs/03-api-spec.md` 与 `docs/SYSTEM_HANDBOOK.md`。
- 不改变：WebUI 页面、导航、组件、按钮、表单及现有 WebUI 错误提示；MCP 工具面输出（explain 冲突可见性另案，OQ-3）。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | **问数面**：MCP 提问、拒绝与逃生路径由 `webui/server/proxy/**` 承载；**报告面**：Live Report 固定 URL | 两条子面路径均未触碰；护栏与删除端点是治理侧写路径变化——治理方不再能静默制造「explain 说可查、query 必然失败」的冲突态，属间接收益，按 P1-90 同口径判 ＝ | P1·问数面 ＝／P1·报告面 ＝ | 问数面：未改 `webui/server/proxy/**`（SC-08 回归断言不含 proxy 路径变更）；报告面：不涉及 Live Report 路由与渲染 | — |
| P2 治理方 | **语义口径面**：publish overlay 通道强制两段物理名（三段名 `OVERLAY_MISSING_TABLE` 拒绝）、与 manifest 同名零冲突检查静默落盘 standalone、覆盖门禁 409 删除 snapshot 导致确认链死锁、plans 误报 404、落盘后无 API 发现与清理；**权限授权面**：角色／ACL／行策略／Token | **语义口径面**：三段名可表达或被显式拒绝；同名冲突与覆盖门禁保留 snapshot 且支持一次组合确认；plans 区分 409/404；可经列表 API 发现孤立/冲突文件并安全删除回落 manifest，且保护合法业务 overlay 不误删。**权限授权面**：未触碰 | P2·语义口径面 ↑／P2·权限授权面 ＝ | 语义口径面：SC-01／SC-02／SC-03／SC-04／SC-06／SC-07；权限授权面：未改 `webui/config/access.yaml` 模型与 ACL 裁决路径 | — |
| P3 运维方 | **交付运维面**：现场误发 overlay 后唯一清理方式是 SSH 登服务器删文件，无 runbook 且不可经 API 盘点；**运行观察面**：health／version／日志／审计 | **交付运维面**：孤立 overlay 可经 API 盘点并删除，走写锁＋展示屏障＋恢复日志＋审计，误删可经 release 恢复链回滚；**运行观察面**：删除动作落 config change 审计，可观测 | P3·交付运维面 ↑／P3·运行观察面 ＝ | 交付运维面：SC-04／SC-05／SC-07；运行观察面：health／version 字段未变（SC-05 仅新增审计记录类型） | — |
| P4 管理层 | 不触碰业务指标口径与概览／审计展示面 | 业务口径、数据范围与审计聚合行为不变 | ＝ | 未触碰概览与审计聚合逻辑 | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。Schema Manifest 通道（`catalog/assets/upload`）、WebUI 表编辑器 overlay 写入（无 `table:` 键的合并型 overlay）、publish 维护包（batch）流程、既有 zip validate→publish 成功路径语义均不变；publish 覆盖门禁保留 snapshot 只是恢复「确认后可重试」的既有设计意图 |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。冲突拒绝与覆盖门禁均保留 snapshot 并通过 `data.nextSteps` 与 `data.pendingConfirmations` 给出下一步；列表与删除端点提供可发现的清理逃生；均为纯 API 部署实况可达，纳入 SC-03／SC-04／SC-05／SC-06／SC-07 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。SC-03／SC-05／SC-06／SC-07 验约束触发；SC-01／SC-02／SC-04／SC-06 验合法路径成交；SC-08 验既有路径回归 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。全部验收为服务端 API 自动化与 Docker demo 全真跑次；OQ-1 引擎实证在可用引擎（Doris external catalog 三段名场景或 SQL Server UAT 环境）执行，引擎缺席时以编译层断言替代并登记缺口，不作 BLOCKED |

## 1. 背景与已核实事实

以下来自 2026-11-25 对两份客户报告的逐条代码核查（本仓库 `lucy-v0.35` 工作树＋上游 `@kaelio/ktx@0.16.0` npm 包只读取证）：

| # | 事实 | 代码 / 证据锚点 | 问题影响 |
|---|---|---|---|
| F1 | publish overlay 分类强制 `table:` 恰好两段（`QUALIFIED_TABLE_RE`＝`^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$`），三段名报 `OVERLAY_MISSING_TABLE` | `webui/server/semantic-assets.ts:482`、`:600-605`（`parseTableRef`）、`:760-774` | SQL Server 的 `db.schema.table` 三段物理名**无法**经 publish 通道表达（报告根因 2） |
| F2 | schemaManifest 通道不约束表 `table:` 值段数，三段名合法 | `webui/server/catalog-assets.ts:530-560` | 同一物理表在两条通道一过一拒，格式要求互相矛盾 |
| F3 | 上游 KTX 将 `_schema/` 之外**含 `table:`／`sql:`** 的 per-table 文件按 standalone source 处理并**整体替换**同名 manifest 投影（仅服务端 warn 日志）；**不含** `table:` 的文件才走 `composeOverlay` 合并 | `@kaelio/ktx@0.16.0` `dist/context/sl/local-sl.js`（`loadSingleConnectionSourceRecords` 第二遍 `sources.set(name, …)`）、`dist/context/sl/semantic-layer.service.js:249-253`（npm 包只读取证，2026-11-25） | publish 产物在上游眼中**必然**是 standalone；与 manifest 同名即静默顶掉该表全部定义，物理名取 overlay 两段 `table:` → SQL Server `Invalid object name` |
| F4 | Lucy 自家 WebUI 表编辑器写 overlay **不含** `table:`（只写 `name`／grain／measures／segments，即 F3 的安全合并形态）；publish 通道却**强制**含 `table:` | `webui/server/overlay.ts:49-53`（`applyOverlayUpdate`）；安全形态实例 `semantic-layer/demo-mysql/superstore_orders.yaml` | 同一目录两种语义；删除端点必须按文件内容区分，避免误删安全合并型业务口径 |
| F5 | publish validate／publish 链路**无**「sourceName 与 manifest 表同名」冲突检查 | `webui/server/semantic-assets.ts:750-782`（classify）；`:3300-3507`（发布链路） | 冲突静默落盘，validate 返回 `valid: true` |
| F6 | KTX standalone schema 为 `.strict()` 且物理关系仅取 `table`／`sql`；多余键（如 `qualifiedName`）被忽略 | `@kaelio/ktx@0.16.0` `dist/context/sl/schemas.js:109-140` | 「两段名＋`qualifiedName`」补救不可能生效 |
| F7 | 语义层文件无任何 DELETE 或 per-table 只读列表端点（服务端仅有两个 wiki DELETE 路由）；catalog 只遍历 Manifest，孤立文件管理面不可见 | `webui/server/index.ts:1494`、`:1507`；`webui/server/semantic-layer.ts:489-505` | 孤立 overlay 落盘后 API 既看不到也删不掉，只能 SSH |
| F8 | publish 对非 batch 快照、目标文件已存在且未确认时抛 `VALIDATION_GATE_FAILED`（409），**并在抛错前删除 validation snapshot**；`confirmOverwrite` 参数路由层与门禁分支均已识别 | `webui/server/semantic-assets.ts:3474-3507`（删除在 `:3494`）；`webui/server/index.ts:2862` | 首次 409 后该 validationId 上一切确认重试必然失败（原 P1-90 F4，v0.2 归口本条） |
| F9 | `GET /api/semantic-assets/plans/:validationId` 只服务维护包（batch）快照；对普通 zip validate 产生的 legacy 快照一律抛 `404 VALIDATION_SNAPSHOT_NOT_FOUND` | `webui/server/semantic-batch-routes.ts:351`；`describeSemanticBatchPlan` `webui/server/semantic-assets.ts:4378-4390` | 快照新鲜存在却报「已失效」，误导排查（原 P1-90 F5，v0.2 归口本条） |
| F10 | `lucy_query`／`lucy_read_source` 走 KTX 解析；`lucy_explain_query` 走 Lucy 本地 manifest catalog | `webui/server/proxy/mcp-proxy.ts:7848-7849`、`:6496` 起 | 同名冲突时 plan 与 execute 分裂（explain 冲突可见性另案，OQ-3） |
| F11 | 三段名物理表名是既有产品场景（客户 `sql_server` 100 表＋Doris external catalog） | 客户报告 §一；`webui/server/__tests__/doris-external-catalog.simulation.test.ts` | overlay 通道放开三段名与产品既有事实一致；standalone 三段名运行时行为仍需实证（OQ-1） |

**与 P1-89／P1-90 的边界（MECE 分工）**：
- 本条独占 `semantic-assets` 通道全部改动（`semantic-assets.ts`、`semantic-batch-routes.ts`、`semantic-overlay-lifecycle.ts`），与 P1-89（`PUT`/`import`）、P1-90（`schema-manifests/.../tables` + 归一化）在核心业务代码文件上零交叉。
- 推荐落地序：**P1-89 → P1-90 → P1-91**（确保本条 `data.nextSteps` 指向的 P1-90 追加端点已上线；若单独先落本条，则 `nextSteps` 先指向 `POST /api/catalog/assets/upload` 与 `import`，待 P1-90 落地后再切换）。

## 2. 需求摘要

### 2.1 功能需求

1. **overlay 物理名契约（D1，OQ-4 已裁＝方案 A）**：
   - **已裁方案 A**：overlay 分类的 `table:` 校验放开为**两段或三段**（新增 overlay 专用解析，**不改**共享 `parseTableRef` 语义）；三段名 `physicalTable` 原样记录与落盘；两段名既有行为逐字节不变。
   - 方案 B／C 不采用（仅在 Task 0 实证推翻 A 时升版改判）。
   - validate 响应必须如实反映「该 `table:` 值将原样成为查询物理表名」。
2. **publish 覆盖门禁确认链修复＋manifest 同名冲突双门禁协同（D2，合并原 P1-90 F-b）**：
   - **validate 阶段（OQ-5）**：检出 `sourceName` 命中该连接任一 Schema Manifest 的 `tables` 键 → 响应以 **`warnings`** 携带冲突信号（不因该冲突单独置 `valid:false`），说明「落盘后将整体替换 manifest 定义（standalone shadow），catalog 不显示该文件」。
   - **publish 窗口内双门禁复验（TOCTOU，与既有 `runValidateGate` 同层）**：
     - 同步检查两类待确认项：① 目标文件已存在且 `confirmOverwrite !== true`；② `shadow.conflict` 且 `allowManifestShadow !== true`。
     - **保留 snapshot（原 P1-90 F-b）**：任一门禁阻断（未写盘）均**不再删除 validation snapshot**（snapshot 留待既有 opportunistic prune 清理），幂等回放与 TOCTOU 复验不受影响。
     - **优先级与组合确认**：若两项均未确认，优先返回 `409 OVERLAY_MANIFEST_CONFLICT`（严重度更高），并在 `data.pendingConfirmations: ["confirmOverwrite", "allowManifestShadow"]` 中一次列齐全部待确认项；仅命中覆盖门禁返回 `409 VALIDATION_GATE_FAILED`（`data.pendingConfirmations: ["confirmOverwrite"]`）；仅命中同名冲突返回 `409 OVERLAY_MANIFEST_CONFLICT`（`data.pendingConfirmations: ["allowManifestShadow"]`）。调用方可一次带齐所需确认布尔值重试成交，避免连撞两次 409。
     - 响应 `data.nextSteps` 指向正确通道（P1-90 追加端点／`import`／`catalog/assets/upload`）及显式确认参数；放行落盘后响应含 shadow 警示与清理指引（删除端点）。
     - **护栏作用面（OQ-5 已裁）**：硬阻断仅非 batch 的 zip validate→publish 通道；维护包（batch）round-trip **不阻断**，但 validate 仍报告冲突 warnings。
3. **`plans/:validationId` 非 batch 错误码区分（D3，合并原 P1-90 F-c）**：
   - `describeSemanticBatchPlan` 对「snapshot 存在但非 batch」返回 `409 PLAN_PREVIEW_NOT_AVAILABLE`（message 说明 legacy validate 快照无批量计划，可带确认参数重试 publish 或重新 validate，附 `data.nextSteps`），与「snapshot 不存在／已过期」的 `404 VALIDATION_SNAPSHOT_NOT_FOUND` 明确区分。
4. **per-table overlay 只读发现与受控删除生命周期（F-a，消除盲删与误删）**：
   - **只读列表端点**：`GET /api/semantic-assets/overlays?conn=<conn>`（`conn` 可选，缺省列全连接）——扫描 `semantic-layer/<conn>/<name>.yaml`（排除 `_schema/`），返回 `{ items: [{ connectionId, sourceName, filePath, kind: "standalone" | "merge_overlay", physicalTable?, shadowsManifest: boolean, manifestPath? }] }`，要求与 publish 相同的管理员鉴权，闭环「盘点 → 清理」与 OQ-2 存量冲突排查。
   - **受控删除端点（OQ-6 已裁）**：`DELETE /api/semantic-assets/overlay/:conn/:sourceName`——
     - 仅允许 `semantic-layer/<conn>/<sourceName>.yaml` per-table 文件；非法路径段／`_schema/` → `400 OVERLAY_DELETE_FORBIDDEN`；文件不存在 → `404 OVERLAY_NOT_FOUND`；查询参数含合同外键（允许 `{ dryRun, confirmBusinessOverlayDelete }`）→ `400 INVALID_OVERLAY_DELETE_QUERY`（对齐 P1-89 D8）。
     - **业务合并型 overlay 防误删保护**：读取目标文件判定 `kind`：若为 `standalone`（含 `table:` 或 `sql:`），允许直接删除；若为 `merge_overlay`（不含 `table:`/`sql:`，属 WebUI/`PUT`/`import` 维护的业务指标口径），未传 `confirmBusinessOverlayDelete=true` 时返回 `409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`（说明删除将清空该表 grain/measures/segments，附 `data.nextSteps`），显式确认后才允许删除。
     - **写管线与响应信封（对齐 P1-89 D8）**：`dryRun`（默认 `true`）返回 `200 { diff, files: [relPath], noChanges: false, kind, dryRun: true }`；正式删除复用完整 L25-16 管线（`withKtxYamlWriteLock → withDisplayWriteBarrier(["D"]) → withPublishCoordinator → release + recovery journal → auditedDeleteFile → closeContentBatch`），删后执行 `reloadCatalog(projectRoot)` 与审计记录，返回 `200 { deleted: true, noChanges: false, deletedFiles: [relPath], kind, fallback, nextSteps: ["POST /api/semantic-assets/reindex"] }`。
5. **文档登记（F-b）**：
   - `webui/docs/03-api-spec.md` 登记 overlay 物理名规则、双 409 门禁与组合确认、`plans` 409/404 区分、`GET /api/semantic-assets/overlays` 与 `DELETE /api/semantic-assets/overlay/:conn/:sourceName` 契约；`docs/SYSTEM_HANDBOOK.md` 数据接入节与 P1-90 分工段交叉引用（publish overlay＝发布独立命名 source，不是新表接收入口）。

### 2.2 非功能需求

| 维度 | 要求 |
|---|---|
| 安全 | 不放宽任何既有门禁；列表与删除端点要求与 publish 相同的认证与授权面；路径段白名单校验，禁止 `_schema/` 与路径穿越；审计不含凭据与绝对路径 |
| 性能 | 冲突检查与列表端点复用既有 catalog 缓存与轻量顶层键解析；不新增物理库连接或上游请求 |
| 兼容 | manifest 通道、WebUI overlay 写入、batch publish、既有 zip validate→publish 成功路径行为不变；`parseTableRef` 共享语义不变；两段名 overlay 行为逐字节不变；完全解耦 `semantic-layer.ts` 写逻辑 |
| 部署实况 | 纯 API 能力，单实例单副本边界不变；不依赖 WebUI 或宿主 |

## 3. 核心流程（伪代码）

```text
// 1. overlay 分类（semantic-assets.ts classifyYamlText 的 semanticSource 分支）
function parseOverlayTableRef(table):
  segments = table.split(".")
  if segments.length == 2 or segments.length == 3:
    if all segments match SAFE_TABLE_SEGMENT: return { physicalTable: table }
  return null   // → 422 OVERLAY_MISSING_TABLE（文案补「两段或三段」）

// 2. publish 窗口内双 409 门禁复验（保留 snapshot，支持单次组合确认）
pending = []
if (!snapshot.batch && overwriteSet.size > 0 && request.confirmOverwrite !== true):
  pending.push("confirmOverwrite")
if (!snapshot.batch && shadow.conflict && request.allowManifestShadow !== true):
  pending.push("allowManifestShadow")

if pending.length > 0:
  appendReleaseRecord(status: "blocked")
  releasePublishLock()                                                // 关键：不再删除 snapshot
  if pending.includes("allowManifestShadow"):
    throw 409 OVERLAY_MANIFEST_CONFLICT(
      message = "sourceName 与 Schema Manifest 表同名：落盘后将整体替换 manifest 定义（standalone shadow）",
      data = { pendingConfirmations: pending,
               nextSteps: ["POST /api/schema-manifests/<conn>/<schema>/tables",
                           "POST /api/sources/<conn>/<schema>/<table>/import",
                           "或携带 " + pending.join(" + ") + "=true 重试 publish"] })
  throw 409 VALIDATION_GATE_FAILED(
    message = "存在已存在的目标文件，需先确认覆盖（confirmOverwrite:true 重试）",
    data = { pendingConfirmations: pending,
             nextSteps: ["POST /api/semantic-assets/publish with { validationId, confirmOverwrite: true }"] })

// 3. plans 错误码区分（describeSemanticBatchPlan）
snapshot = readSnapshot(validationId)
if (!snapshot):       throw 404 VALIDATION_SNAPSHOT_NOT_FOUND("validationId 已失效或不存在")
if (!snapshot.batch): throw 409 PLAN_PREVIEW_NOT_AVAILABLE(
                        "该 validationId 来自普通校验（非维护包），无批量计划可预览",
                        data = { nextSteps: ["POST /api/semantic-assets/publish with confirmOverwrite:true"] })

// 4. per-table overlay 分类辅助 + 只读列表 + 受控删除（semantic-overlay-lifecycle.ts）
function classifyPerTableFile(relPath):
  parsed = parseYaml(readFile(relPath))
  kind = (parsed has "table" or parsed has "sql") ? "standalone" : "merge_overlay"
  return { kind, physicalTable: parsed.table ?? null }

function deleteOverlaySource(conn, sourceName, query, actor):
  assertAllowedKeys(query, {dryRun, confirmBusinessOverlayDelete}, "INVALID_OVERLAY_DELETE_QUERY", ...)
  assertSafeSegment(conn); assertSafeSegment(sourceName)              // 非法段 → 400 OVERLAY_DELETE_FORBIDDEN
  relPath = "semantic-layer/<conn>/<sourceName>.yaml"
  if not exists(relPath): throw 404 OVERLAY_NOT_FOUND
  info = classifyPerTableFile(relPath)
  if info.kind === "merge_overlay" && query.confirmBusinessOverlayDelete !== true:
    throw 409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED(
      message = "目标为业务合并型 overlay（不含 table/sql），删除将清空该表业务口径（grain/measures/segments）",
      data = { kind: info.kind, nextSteps: ["确认清空业务口径请传 confirmBusinessOverlayDelete=true 重试"] })
  if query.dryRun !== false:
    return 200 { diff, files: [relPath], noChanges: false, kind: info.kind, dryRun: true }

  withKtxYamlWriteLock(() =>
    withDisplayWriteBarrier(["D"], token =>
      withPublishCoordinator("semantic_overlay_delete", async () =>
        release = openPromotingContentRelease(...)
        journal = createRecoveryJournal(...)
        auditedDeleteFile(relPath, changeType: "semantic_overlay_delete", actor)
        closeContentBatch(release, journal))))
  reloadCatalog(projectRoot)
  recordConfigChange(actor, conn, sourceName, diffDigest)
  return 200 { deleted: true, noChanges: false, deletedFiles: [relPath], kind: info.kind,
               fallback: info.kind === "standalone" ? "该表读取已回落 Schema Manifest 定义" : "该表业务合并口径已清除",
               nextSteps: ["POST /api/semantic-assets/reindex"] }
```

## 4. 验收（SC）

| ID | 合同 | 对应 UAT（预定，套件待立） |
|---|---|---|
| SC-01 | 三段名（`bidw.dbo.x` 形态）overlay validate 通过且 publish 落盘后文件 `table:` 原样三段、`physicalTable` 一致；两段名 overlay validate→publish 行为与现状逐字节一致（回归） | UAT-OPG-01 |
| SC-02 | 三段名 standalone 发布后在可用引擎实证 `lucy_query` 可执行且 `lucy_read_source` 物理表名与落盘一致；引擎缺席时以编译层断言替代并在跑次记录中登记缺口（OQ-1 实证记录为本 SC 输入） | UAT-OPG-02 |
| SC-03 | `sourceName` 命中 manifest 表：validate 响应含冲突信号与后果说明；publish 未确认返回 `409 OVERLAY_MANIFEST_CONFLICT`（含 `data.pendingConfirmations` 与 `data.nextSteps`）、不落盘、**不删 snapshot**；带确认参数重试落盘且响应含 shadow 警示与清理指引 | UAT-OPG-03 |
| SC-04 | 冲突放行或误发 standalone 经删除端点清理后：`lucy_read_source` 与 `lucy_query` 回落 manifest 定义（物理名与列回到 manifest 版本）；展示缓存经写屏障与 `reloadCatalog` 即时刷新；`/api/sources` 全程行为不变 | UAT-OPG-04 |
| SC-05 | 删除端点安全边界与信封：未知参数 → `400 INVALID_OVERLAY_DELETE_QUERY`，非法段／路径穿越 → `400 OVERLAY_DELETE_FORBIDDEN`，不存在 → `404 OVERLAY_NOT_FOUND`；正式删除经写锁＋展示读屏障＋发布窗口＋恢复日志，模拟中断恢复核验不留半份状态；审计含 actor／目标／diff 摘要且不含凭据；dryRun 返回 `{ diff, files, noChanges: false, kind, dryRun: true }` 不落盘 | UAT-OPG-05 |
| SC-06 | 覆盖门禁与 plans 收口（原 P1-90 F-b/F-c）：publish 覆盖门禁 409 阻断后 snapshot 保留，同一 validationId 带 `confirmOverwrite:true` 重试成交；同时命中覆盖门禁与同名冲突时一次返回 `data.pendingConfirmations: ["confirmOverwrite", "allowManifestShadow"]` 且带齐两参数单次重试成交；`plans/:validationId` 对 legacy 快照返回 `409 PLAN_PREVIEW_NOT_AVAILABLE`、对不存在快照仍返回 `404 VALIDATION_SNAPSHOT_NOT_FOUND` | UAT-OPG-06 |
| SC-07 | 只读发现与业务 overlay 防误删：`GET /api/semantic-assets/overlays?conn=` 正确列出 standalone 与 `merge_overlay` 并标注 `shadowsManifest`；对 `merge_overlay`（无 `table:`/`sql:`）调用 DELETE 未确认返回 `409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED` 不删盘，带 `confirmBusinessOverlayDelete=true` 后可删除 | UAT-OPG-07 |
| SC-08 | 回归：WebUI 表编辑器 overlay 写读（无 `table:` 合并形态）不变；`catalog/assets/upload` manifest 通道不变；publish batch（维护包）round-trip 不变；既有 zip validate→publish 成功路径与幂等回放不变 | UAT-OPG-08 |
| SC-09 | `webui/docs/03-api-spec.md` 与 `docs/SYSTEM_HANDBOOK.md` 已登记物理名规则、双 409 门禁、plans 409/404、只读列表与受控删除端点及与 P1-90 分工段的交叉引用（文档审查） | 文档审查 |

## 5. 非目标

- Schema Manifest 单表追加端点与 schema 名大小写归一化（归 **P1-90**）。
- 既有 `PUT`/`import` 零写入假成功与描述写入陷阱修复（归 **P1-89**）。
- per-table overlay 纳入 catalog 表清单的架构变更；Schema Manifest 仍是结构事实源。
- 修改 KTX 源码或要求上游变更 standalone／overlay 语义（AGENTS.md KTX 边界；护栏全部落 Lucy 侧）。
- 存量冲突文件的自动迁移／自动删除（OQ-2 盘点后另定处置）。
- `lucy_explain_query` 冲突可见性（OQ-3 另案，本条不触碰 `webui/server/proxy/**`）。
- WebUI 语义资产发布界面变更与任何导航 IA 变更（如需，按「导航信息架构变更：委托人独立确认」另案）。
- 多写者／多副本拓扑支持。

## 6. 已闭合裁定

| ID | 问题 | 裁定结论 |
|---|---|---|
| OQ-1 | KTX standalone `table:` 三段名的运行时实证（隔离 Docker demo：Doris external catalog 三段名场景或 SQL Server UAT 环境） | **设计冻结方案 A**；Task 0 实证改挂**开发授权前置**（推翻则升版改判后再授权，不带病进 S3） |
| OQ-2 | 存量部署 overlay×manifest 同名冲突盘点：已有 `GET /api/semantic-assets/overlays` 后，是否还需附带启动日志告警或只读 CLI 脚本 | **以列表 API 为主**；启动日志／CLI／自动处置另案 |
| OQ-3 | `lucy_explain_query` 冲突可见性（explain 输出 `sourceConflict` 加法字段）纳入本条 vs 另案 | **另案**（本条纯写路径、不触碰 proxy；画像 P1 维持 ＝） |
| OQ-4 | D1 方案裁定：A 放开三段名／B 引擎感知／C 仅显式拒绝 | **方案 A**＋D2 护栏兜底 |
| OQ-5 | 冲突信号级别（validate errors vs warnings）、显式确认参数命名（`allowManifestShadow`?）、护栏作用面是否含 batch 通道 | validate＝**warnings**；确认参数＝**`allowManifestShadow`**；硬阻断仅非 batch zip；**batch 不硬阻断**（仍报 warnings） |
| OQ-6 | 删除端点形态：`DELETE /api/semantic-assets/overlay/:conn/:sourceName`（路径参数）vs 通用 `DELETE /api/semantic-assets/file?path=`；snapshot TTL；客户 `confirmOverwrite:true` 原始 payload 取证 | **路径参数 DELETE**；snapshot 沿用既有 opportunistic prune；客户原始 payload 随验证阶段取证闭环 |
