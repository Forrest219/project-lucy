# Schema Manifest 按表追加与覆盖门禁逃生修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Schema Manifest 按表追加与覆盖门禁逃生修复 Spec |
| 文档类型 / 版本 | Spec（纯 API 功能合同）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-25／产品线 `0.35.0`（`lucy-v0.35`；总账与需求池暂挂 `0.30` 池） |
| 功能编号 / 优先级 | **P1-90**／REQ-030-111／**P1（治理主路径可用性）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账（P1-90） |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。仅登记与起草；**终稿未确权**；**开发未授权**；测试台 not_registered；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 2026-11-25 客户现场 Bug 报告 [`inbox/Lucy语义层新表接入_覆盖门禁死锁_Bug报告.md`](../../inbox/Lucy语义层新表接入_覆盖门禁死锁_Bug报告.md)（平台 v0.25.0 实测：向已有 100 表的 `BIDW` Schema 新增 1 表，四条 API 路径全部走不通，只能 SSH 改服务器文件）＋ 本仓库 v0.25.0 tag 与 `lucy-v0.35` 工作树代码核查 |
| 实施主体 | Lucy 服务端（`webui/server/semantic-layer.ts`、`webui/server/semantic-assets.ts`、`webui/server/semantic-batch-routes.ts`、`webui/server/index.ts`）；不改 KTX 源码；不改 WebUI 运行导航 |
| 配对计划 | [`docs/plans/lucy-20261125-schema-manifest-table-append-plan.md`](../plans/lucy-20261125-schema-manifest-table-append-plan.md) |
| 测试台 | not_registered（待终稿确权后立套件；预定编号 `UAT-SUITE-SCHEMA-TABLE-APPEND`／用例 `UAT-STA-*`） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft（补充） | 2026-11-25 经委托人批准补充：§2.1 新端点响应惯例对齐 P1-89／REQ-030-110（`writtenFiles`／`noChanges`／合同外字段 400）；Plan 风险表补「与 P1-89 同文件协调」行。仅文档对齐，不改承诺与验收编号；仍 S1、终稿未确权、开发未授权。 |
| v0.1-draft | 2026-11-25 初稿。依据客户 Bug 报告与代码核查落盘：主承诺＝新增 create-only 按表追加端点；配套契约修复＝import 指引、publish 门禁阻断不删 snapshot、plans 错误码区分、schema 名归一化。仅登记与起草，终稿未确权，开发未授权。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：治理方经公开 API 向**已有 Schema Manifest**（`semantic-layer/<conn>/_schema/<schema>.yaml` 已存在）追加一张新表全程可走通——存在 create-only 的按表合并追加端点（不整文件替换、既有表零影响），追加后新表进入 catalog 对 Agent 可见；且该场景链路上每个拒绝（表已存在、import 未登记、覆盖门禁阻断、plans 预览不适用、schema 名大小写不符）都返回可执行的下一步，不再形成死锁。
- 本条出口：SC-01–SC-08 的本机自动化测试、实现审查，以及终稿确权后所立测试台套件（预定 `UAT-STA-*`）在隔离 Docker demo 上的全真跑次。
- 不在本条出口：物理库新表自动发现与自动写 Manifest（Spec 190 已列非目标，另案）；per-table overlay 纳入 catalog 的架构变更；维护包（maintenance package）内 Schema Manifest 的 readonly 语义；`catalog/assets/upload` 整文件受控替换语义；WebUI「新增表」入口（涉导航 IA 独立确认，另案）；多写者／多副本拓扑。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None。端点名 `POST /api/schema-manifests/:conn/:schema/tables` 与错误码 `TABLE_ALREADY_EXISTS`／`SCHEMA_MANIFEST_NOT_FOUND`／`AMBIGUOUS_SCHEMA`／`PLAN_PREVIEW_NOT_AVAILABLE` 为 API 工程契约，不新增 WebUI 界面术语；文档正文继续使用「Schema Manifest」英文原词（禁止译作「清单／舱单」）。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条仅新增／调整服务端 API 端点、错误码与拒绝文案，并修订 `webui/docs/03-api-spec.md` 与 `docs/SYSTEM_HANDBOOK.md` 的流程说明。
- 不改变：WebUI 页面、导航、组件、按钮、表单及现有 WebUI 错误提示。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | **问数面**：MCP 提问、拒绝与逃生路径由 `webui/server/proxy/**` 承载；**报告面**：Live Report 固定 URL | 两条子面路径均未触碰；新表进入 catalog 是治理动作的结果，查询机制、拒绝语义与报告渲染不变 | P1·问数面 ＝／P1·报告面 ＝ | 问数面：未改 `webui/server/proxy/**`（SC-07 审计断言不含 proxy 路径变更）；报告面：不涉及 Live Report 路由与渲染 | — |
| P2 治理方 | **语义口径面**：向既有 Schema 新增表无 API 通道——import 为 update-only（`semantic-layer.ts:1089-1092`）、publish overlay 不进 catalog、维护包 Manifest readonly、覆盖门禁确认链断裂，只能 SSH 改服务器文件；**权限授权面**：角色／ACL／行策略／Token | **语义口径面**：create-only 追加端点按表合并写入，dryRun 可见 diff，追加后 catalog 可见；链路上每个拒绝带可执行下一步。**权限授权面**：未触碰 | P2·语义口径面 ↑／P2·权限授权面 ＝ | 语义口径面：SC-01／SC-02／SC-03／SC-05／SC-06；权限授权面：未改 `webui/config/access.yaml` 模型与 ACL 裁决路径 | — |
| P3 运维方 | **交付运维面**：客户现场接入新表需登服务器手工替换 `_schema/*.yaml` 再手工 reindex，无 runbook 且易误删既有表；**运行观察面**：health／version／日志／审计 | **交付运维面**：现场经 API 完成追加，写盘走恢复日志与审计，误操作可经 release 恢复链回滚；**运行观察面**：追加动作落 config change 审计，可观测 | P3·交付运维面 ↑／P3·运行观察面 ＝ | 交付运维面：SC-02／SC-07；运行观察面：health／version 字段未变（SC-07 仅新增审计记录类型） | — |
| P4 管理层 | 不触碰业务指标口径与概览／审计展示面 | 业务口径、数据范围与审计聚合行为不变 | ＝ | 未触碰概览与审计聚合逻辑（SC-07 审计为新增记录类型，不改既有聚合） | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。既有表查询、import 更新既有表、`catalog/assets/upload` 整文件上传、publish 维护包流程语义均不变；publish 覆盖门禁阻断后保留 snapshot 只是恢复「确认后可重试」的既有设计意图（`confirmOverwrite` 参数自 v0.25.0 已存在于路由与门禁分支） |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。新增拒绝仅 `TABLE_ALREADY_EXISTS`／`SCHEMA_MANIFEST_NOT_FOUND`／`AMBIGUOUS_SCHEMA`，均为纯 API 部署实况可达，且响应携带下一步端点；纳入 SC-03／SC-05 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。SC-03／SC-04／SC-05 验约束触发；SC-01／SC-02／SC-06 验合法路径成交 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。全部验收为服务端 API 自动化与 Docker demo 全真跑次，无浏览器／宿主凭据前置 |

## 1. 背景与已核实事实

以下来自 2026-11-25 对客户 Bug 报告的逐条代码核查（v0.25.0 tag 与 `lucy-v0.35` 工作树一致，除特别注明外）：

| # | 事实 | 代码 / 证据锚点 | 问题影响 |
|---|---|---|---|
| F1 | catalog 表清单只遍历各 Schema Manifest 的 `tables`；per-table overlay（`semantic-layer/<conn>/<table>.yaml`）仅作为已登记表的 enrichment 被读取，未登记表永不出现 | `webui/server/semantic-layer.ts:489-505`（`listSourcesWithManifests`）；overlay 读取 `:331-342` | publish overlay 落盘成功但 `/api/sources` 与 MCP 永远不含新表（报告路径 A） |
| F2 | import 为 update-only：目标表键已存在于 Manifest 才允许导入，否则 `SOURCE_NOT_FOUND`；schema 路径按入参原样拼接，无大小写归一化，小写 schema 名直读不存在文件抛 ENOENT（HTTP 500） | `webui/server/semantic-layer.ts:1089-1092`、`schemaRelPath:272-276` | 全新表无法经 import 登记（报告路径 B 循环依赖）；`bidw` vs `BIDW` 大小写 500 |
| F3 | enabled-tables 新增表必须已在扫描到的 Manifest 中，否则 `TABLE_NOT_SCANNED` | `webui/server/enabled-tables.ts:259-261` | 白名单不能作为新表入口（报告路径 C），属文档化行为 |
| F4 | publish 对非 batch 快照、目标文件已存在且未确认时抛 `VALIDATION_GATE_FAILED`（409），**并在抛错前删除 validation snapshot**；`confirmOverwrite` 参数路由层已接收（`body.confirmOverwrite === true`）且门禁分支已识别 | `webui/server/semantic-assets.ts:3474-3507`（删除在 `:3494`）；`webui/server/index.ts:2862` | 首次 409 后该 validationId 上一切确认重试必然失败；「需先确认覆盖」的提示指向一条对已删快照不可用的通道（报告路径 D 死锁核心） |
| F5 | `GET /api/semantic-assets/plans/:validationId` 只服务维护包（batch）快照；对普通 zip validate 产生的 legacy 快照（或已被 F4 删除的快照）一律抛 `VALIDATION_SNAPSHOT_NOT_FOUND` | `webui/server/semantic-batch-routes.ts:351`；`describeSemanticBatchPlan` `webui/server/semantic-assets.ts:4378-4390` | 错误码误导：快照新鲜存在却报「已失效」，使用户误判 plans 接口损坏（报告根因 3 的不准之处） |
| F6 | 维护包通道中 Schema Manifest 为 `readonly_context`，内容被修改即整包拒绝 | `webui/server/semantic-batch-service.ts:539-556` | 受控批量通道同样不能新增表 |
| F7 | 已存在受控整文件上传通道 `POST /api/catalog/assets/validate|upload`（含 `confirmOverwrite` 重试、恢复日志、写后 catalog reload），WebUI AddSchemaDrawer／接入向导使用 | `webui/server/catalog-assets.ts:202,989`；`webui/server/index.ts:2638-2674`；`webui/src/lib/catalog-assets.ts:24` | 整文件替换可行但需提交全量定义，误删风险高（报告根因 4）；缺「按表合并」的细粒度通道 |
| F8 | 「库内新增表不会被感知……运维只能人工重跑一次全量流程」；「自动写 Schema Manifest（追加新表）」为 Spec 190 明示非目标（依赖 L25-11，另立 Spec） | `webui/docs/190-live-table-discovery-and-continuous-sync-spec.md:44,99` | 本缺口是已登记的产品能力空白，本条即该「另立 Spec」的承接候选 |
| F9 | Manifest 的列模型（KTX `ManifestColumn`）不接受 `expr`／`role`；误写入 Manifest 的派生列会被静默丢弃，`validate` 不报错但运行时 `Unknown column` | `docs/governance/DEVELOPMENT.md`「语义层（semantic-layer）分层」gotcha | 追加端点必须显式拒绝这类键，不得静默落盘 |

**报告与代码的一处矛盾（待取证）**：报告称 publish 加 `confirmOverwrite:true`「仍 409（参数被忽略）」。v0.25.0 tag 的路由与门禁分支均已识别该参数（F4）；更可能的解释是首次 409 后 snapshot 已删、后续重试撞上其他 409（如 TOCTOU 复验门禁同码不同消息），或标志未以布尔 `true` 送达。本条 F4 修复（阻断不删 snapshot）消除该歧义类别；原始请求 payload 取证登记为 OQ-5。

## 2. 需求摘要

### 2.1 功能需求

1. **新增 create-only 按表追加端点** `POST /api/schema-manifests/:conn/:schema/tables`：
   - 请求体：`{ table: string, yaml: string, dryRun?: boolean }`；`dryRun` 默认 `true`。
   - `yaml` 可以是单表 YAML 片段（含 `table`／`columns` 等键）或含 `tables.<table>` 的片段；服务端抽取且仅抽取路径指定表名的节点，片段物理表名（`table:` 值）与路径 `{table}` 不一致时拒绝（防错绑）。
   - **create-only**：`tables[<table>]` 已存在 → `409 TABLE_ALREADY_EXISTS`，响应携带「更新既有表请走 `POST /api/sources/:conn/:schema/:table/import`」的下一步；不写盘。
   - **按表合并**：在既有 Manifest 文档上仅 `setIn(["tables", <table>], …)` 新增节点，其余表节点逐字节不动；禁止整文件替换语义。
   - **内容校验**：表节点键限于既有 `TABLE_KEYS` 白名单；`columns[]` 内含 `expr`／`role` 等 overlay-only 键 → 拒绝并说明「派生列请落 per-table overlay」（F9）；空表名／非法段／YAML 解析失败 → 400／422。
   - **schema 名归一化**：在 `semantic-layer/<conn>/_schema/` 下按大小写不敏感匹配既有 `<schema>.yaml`；无匹配 → `404 SCHEMA_MANIFEST_NOT_FOUND`（不得 500）；大小写不敏感匹配到多个文件 → `409 AMBIGUOUS_SCHEMA`。
   - **写入管线**：正式写复用 L25-16 既有管线（`withKtxYamlWriteLock` → display write barrier → `withPublishCoordinator` → release＋recovery journal → `auditedWriteFile` → `closeContentBatch`），写后执行静态 catalog reload 使 `/api/sources` 可见；响应含 `validation`、`writtenFiles`（本请求实际写入清单）、`changedFiles` 与下一步提示（enabled-tables／reindex）。
   - **响应惯例对齐 P1-89**：请求体含合同外字段 → 400 并指明正确字段；响应加法扩展 `writtenFiles`／`noChanges`（本端点 create-only，dryRun 恒有 diff，`noChanges` 恒为 `false`，仅为惯例一致而保留字段），与 P1-89／REQ-030-110 确立的写接口诚实性惯例一致；两条 Spec 落地时以同一套响应惯例为准（响应形态断言随 SC-02 覆盖）。
   - **审计**：记录 config change（actor、conn/schema/table、diff 摘要、来源端点），不含凭据。
2. **配套契约修复（同一承诺的「拒绝必须有可执行下一步」）**：
   - F-a import：`SOURCE_NOT_FOUND` 响应 message 与 `data` 携带追加端点指引；schema 名归一化与端点共用同一解析函数；Manifest 文件不存在返回 404（不得 500 ENOENT）。
   - F-b publish：`VALIDATION_GATE_FAILED` 覆盖门禁阻断（未写盘）路径**不再删除 validation snapshot**；snapshot 保留至既有 opportunistic prune 清理；同一 validationId 可经 `confirmOverwrite:true` 重试成交。幂等回放不受影响（幂等键检查在 snapshot 读取之前，`:3311-3337`）；TOCTOU 由既有 `runValidateGate` 重跑兜底（`:3510`）。
   - F-c plans：`describeSemanticBatchPlan` 对「snapshot 存在但非 batch」返回新错误码 `PLAN_PREVIEW_NOT_AVAILABLE`（HTTP 409，message 说明 legacy validate 快照无批量计划、可经 publish `confirmOverwrite` 确认或重新 validate），与「snapshot 不存在／已过期」的 `VALIDATION_SNAPSHOT_NOT_FOUND`（404）区分。
   - F-d 文档：`webui/docs/03-api-spec.md` 登记新端点契约与「向既有 Schema 新增表」流程段（追加／import 更新／upload 整文件替换三者分工）；`docs/SYSTEM_HANDBOOK.md` 数据接入节补同一句指引。

### 2.2 非功能需求

| 维度 | 要求 |
|---|---|
| 安全 | 不放宽任何既有门禁；追加端点要求与 import 相同的认证与授权面；审计不含凭据与绝对路径 |
| 性能 | 追加为单文档 read-modify-write，复用既有写锁与缓存失效；不新增物理库连接或上游请求 |
| 兼容 | import／publish／plans／upload 既有成功路径行为不变；F-b／F-c 只改失败路径语义；`TABLE_KEYS` 白名单与 import 一致 |
| 部署实况 | 纯 API 能力，单实例单副本边界不变；不依赖 WebUI 或宿主 |

## 3. 核心流程（伪代码）

```text
// 0. schema 名归一化（新端点与 import 共用）
function resolveSchemaManifestPath(conn, schema):
  dir = "semantic-layer/<conn>/_schema"
  matches = listFiles(dir).filter(f => f.name.equalsIgnoreCase(schema + ".yaml"))
  if matches.length == 0: throw 404 SCHEMA_MANIFEST_NOT_FOUND("Schema Manifest 不存在：<conn>/<schema>")
  if matches.length > 1: throw 409 AMBIGUOUS_SCHEMA("存在大小写歧义的 Schema Manifest：" + matches)
  return dir + "/" + matches[0]

// 1. POST /api/schema-manifests/:conn/:schema/tables
function appendTableToSchemaManifest(conn, schema, body, actor):
  assertSafeSegment(conn); assertSafeSegment(schema); assertSafeSegment(body.table)
  relPath = resolveSchemaManifestPath(conn, schema)          // 归一化，见 0
  node = extractSingleTableNode(body.yaml, expectedTable = body.table)
       // 支持单表片段或 tables.<table> 片段；物理表名不一致 → 422 TABLE_NAME_MISMATCH
  assertKeysSubset(node, TABLE_KEYS)                          // 白名单，同 import
  for col in node.columns ?? []:
    if col has "expr" or "role":
      throw 422 OVERLAY_ONLY_KEY("派生列／role 属 overlay 职责，写入 Manifest 会被静默丢弃；请落 per-table overlay")

  doc = readYamlDocument(relPath)
  if doc.tables[body.table] exists:
    throw 409 TABLE_ALREADY_EXISTS(
      message  = "表已存在于 Schema Manifest；更新既有表请走 import",
      data.nextEndpoint = "POST /api/sources/<conn>/<schema>/<table>/import")

  merged = doc.setIn(["tables", body.table], node)            // 仅新增节点，其余表逐字节不动
  if body.dryRun != false:
    return { diff: previewDiff(doc.text, merged.text), proposedYaml: merged.text,
             noChanges: false }                                        // 不落盘

  // 正式写：复用 L25-16 管线（与 writeSourceYamlImport 同一锁序与恢复语义）
  withKtxYamlWriteLock(() =>
    withDisplayWriteBarrier(["D"], token =>
      withPublishCoordinator("semantic_table_append", async () =>
        release = openPromotingContentRelease(targets=[{ relPath, assetKind: "manifest" }])
        journal = createRecoveryJournal(release, targets=[{ relPath, newContent: merged.text }])
        auditedWriteFile(relPath, merged.text,
          changeType: "semantic_table_append", actor, diff, source: "schema_manifest_append_api")
        markRecoveryJournalFilesSaved(journal)
        closeContentBatch(release, journal))))
  reloadCatalog(projectRoot)                                  // 静态目录重载，/api/sources 立即可见
  recordConfigChange(actor, conn, schema, body.table, diffDigest)   // 审计，不含凭据
  return { written: true, noChanges: false, writtenFiles: [relPath],
           validation, changedFiles,
           nextSteps: ["PUT /api/connections/<conn>/enabled-tables", "POST /api/semantic-assets/reindex"] }

// 2. F-b：publish 覆盖门禁阻断不再消费 snapshot（semantic-assets.ts）
if (!snapshot.batch && overwriteSet.size > 0 && request.confirmOverwrite !== true):
  appendReleaseRecord(status: "blocked")
  releasePublishLock()
  // 删除既有 deleteSnapshot 调用：snapshot 保留，confirmOverwrite:true 重试或重新预览可用
  throw 409 VALIDATION_GATE_FAILED("存在已存在的目标文件，需先确认覆盖（confirmOverwrite:true 重试）")

// 3. F-c：plans 错误码区分（describeSemanticBatchPlan）
snapshot = readSnapshot(validationId)
if (!snapshot):            throw 404 VALIDATION_SNAPSHOT_NOT_FOUND("validationId 已失效或不存在")
if (!snapshot.batch):      throw 409 PLAN_PREVIEW_NOT_AVAILABLE(
                             "该 validationId 来自普通校验（非维护包），无批量计划可预览；"
                             + "覆盖确认请直接以 confirmOverwrite:true 重试 publish，或重新 validate")
```

关键分支 ↔ 验收映射：归一化三分支 → SC-05；create-only 拒绝 → SC-03；overlay-only 键拒绝 → SC-04；合并写入与既有表不动 → SC-01／SC-02；F-b 保留 snapshot 与重试成交 → SC-06；F-c 两错误码分流 → SC-06；写管线与审计 → SC-07。

## 4. 验收（SC）

| ID | 合同 | 对应 UAT（预定，套件待立） |
|---|---|---|
| SC-01 | dryRun 返回的 diff 仅含新增表节点、不落盘；同一 payload 重复 dryRun 结果一致 | UAT-STA-01 |
| SC-02 | 正式追加后：Manifest 仅新增该表节点（既有全部表节点摘要逐一比对不变）；`/api/sources?conn=<conn>` 含新表；enabled-tables 可将新表加入白名单；MCP `discover_data`／`lucy_read_source` 可见新表 | UAT-STA-02 |
| SC-03 | 对已存在表追加返回 `409 TABLE_ALREADY_EXISTS`，`data.nextEndpoint` 指向 import；Manifest 字节不变 | UAT-STA-03 |
| SC-04 | 含 overlay-only 键（column `expr`／`role`）、物理表名与路径不一致、非法 YAML、非白名单键的追加分别返回 422／422／422／400，均不落盘、不静默丢弃 | UAT-STA-04 |
| SC-05 | import 对未登记表返回 `SOURCE_NOT_FOUND` 且携带追加端点指引；`bidw` 与 `BIDW` 大小写不一致时归一化命中既有 Manifest；schema 不存在时 import 与追加端点均返回 404（非 500） | UAT-STA-05 |
| SC-06 | publish 覆盖门禁阻断后：同一 validationId 以 `confirmOverwrite:true` 重试成交且文件落盘；plans 对该 validationId 返回 `PLAN_PREVIEW_NOT_AVAILABLE`（409）；对不存在 validationId 仍返回 `VALIDATION_SNAPSHOT_NOT_FOUND`（404） | UAT-STA-06 |
| SC-07 | 追加写入经 ktx.yaml 写锁＋发布窗口＋恢复日志；模拟写盘中断后恢复核验不留半份文件；审计记录含 actor／端点／diff 摘要且不含凭据 | UAT-STA-07 |
| SC-08 | `webui/docs/03-api-spec.md` 与 `docs/SYSTEM_HANDBOOK.md` 已登记新端点与「追加／更新／整文件替换」分工（文档审查） | 文档审查 |

## 5. 非目标

- 物理库新表自动发现、自动或受控批量写 Manifest（Spec 190 非目标另案；本条只提供单表追加 API）。
- per-table overlay 纳入 catalog 表清单的架构变更；Schema Manifest 仍是结构事实源。
- 维护包内 Schema Manifest readonly 语义、`catalog/assets/upload` 整文件替换语义、publish 文件级替换语义的变更。
- WebUI「新增表」入口与任何导航 IA 变更（如需，按「导航信息架构变更：委托人独立确认」另案）。
- enabled-tables `TABLE_NOT_SCANNED` 语义变更（新表经本条进入 Manifest 后自然可启用）。
- 多写者／多副本拓扑支持。

## 6. 开放项

| ID | 问题 | 草案倾向 / 去向 |
|---|---|---|
| OQ-1 | 端点形态：新建 `POST /api/schema-manifests/:conn/:schema/tables`（create-only）vs 扩展 import 为 upsert | 草案选新建：create-only 与 import 的 update-only 互补、语义互不污染；待评审裁定 |
| OQ-2 | F-b 保留 snapshot 后是否需显式 TTL／容量上限（现为 opportunistic prune） | 待评审；倾向沿用既有 prune，不新增机制 |
| OQ-3 | `PLAN_PREVIEW_NOT_AVAILABLE` 的 HTTP 状态（409 vs 400） | 草案选 409（状态冲突类）；待评审裁定 |
| OQ-4 | 是否同批把 WebUI「新增表」入口接入新端点 | 默认不在本条；涉导航 IA 独立确认，另案 |
| OQ-5 | 客户现场 `confirmOverwrite:true`「仍 409」的原始请求 payload 取证 | 向报告人索取；F-b 落地后该歧义类别消除，取证仅作闭环确认 |
