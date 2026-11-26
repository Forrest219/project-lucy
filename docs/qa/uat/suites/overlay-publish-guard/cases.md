# Cases — UAT-SUITE-OVERLAY-PUBLISH-GUARD

> 口径：对齐 Spec v1.0（SC-01–SC-09）。合同回链：Spec [`lucy-20261125-overlay-publish-guard-spec.md`](../../../../specs/lucy-20261125-overlay-publish-guard-spec.md)。
> 推荐执行顺序：`UAT-R0` → `UAT-OPG-01` → `UAT-OPG-02` → `UAT-OPG-03` → `UAT-OPG-04` → `UAT-OPG-05` → `UAT-OPG-06` → `UAT-OPG-07` → `UAT-OPG-08`。
> 本套件夹具需求见 [suite.md 边界](suite.md)：manifest 100 表连接上误发同名 overlay、预置业务合并型 overlay；均用 demo 现成连接构造，跑次结束还原。

| ID | 标题 | 层级 | 合同回链 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | — | demo healthy；API 直连可达；MCP `:57881` 可用 |
| UAT-OPG-01 | overlay 物理名两段／三段 | API 全真 | Spec SC-01 | 三段名 overlay validate 通过且 publish 落盘 `table:` 原样三段、`physicalTable` 一致；两段名 validate→publish 行为与现状逐字节一致（回归）；段数非法仍 `422 OVERLAY_MISSING_TABLE`（文案「两段或三段」） |
| UAT-OPG-02 | 三段名 standalone 引擎可查 | API 全真＋MCP | Spec SC-02 | 三段名 standalone 发布后 `lucy_query` 可执行、`lucy_read_source` 物理表名与落盘一致；引擎实证输入挂 [`inbox/p191-task0/RECORD.md`](../../../../../inbox/p191-task0/RECORD.md) |
| UAT-OPG-03 | 同名 shadow：validate warnings＋publish 409→确认放行 | API 全真 | Spec SC-03 | validate 输出 `MANIFEST_SHADOW` warnings（不置 `valid:false`）；publish 未确认 `409 OVERLAY_MANIFEST_CONFLICT`（`pendingConfirmations`＋`nextSteps`）不落盘、**不删 snapshot**；带 `allowManifestShadow:true` 重试落盘且 release 含 `shadowWarnings` 与清理指引 |
| UAT-OPG-04 | 删除回落 manifest | API 全真＋MCP | Spec SC-04 | 冲突放行或误发 standalone 经删除端点清理后 `lucy_read_source`／`lucy_query` 回落 manifest 定义；展示缓存即时刷新；`/api/sources` 全程行为不变 |
| UAT-OPG-05 | 删除端点安全边界与信封 | API 全真（含中断恢复） | Spec SC-05 | 未知参数 `400 INVALID_OVERLAY_DELETE_QUERY`；非法段／路径穿越 `400 OVERLAY_DELETE_FORBIDDEN`；不存在 `404 OVERLAY_NOT_FOUND`；dryRun 返回 `{ diff, files, noChanges:false, kind, dryRun:true }` 不落盘；正式删除经写锁＋展示读屏障＋发布窗口＋恢复日志，模拟中断不留半份状态；审计含 actor／目标／diff 摘要且不含凭据 |
| UAT-OPG-06 | 覆盖门禁＋plans 409/404＋组合确认 | API 全真 | Spec SC-06 | 覆盖门禁 409 后 snapshot 保留，同 validationId 带 `confirmOverwrite:true` 重试成交；双 409 同命中返回 `pendingConfirmations: ["confirmOverwrite","allowManifestShadow"]` 且带齐两参数单次重试成交；`plans/:validationId` legacy 快照 `409 PLAN_PREVIEW_NOT_AVAILABLE`、不存在快照 `404 VALIDATION_SNAPSHOT_NOT_FOUND` |
| UAT-OPG-07 | 只读盘点＋业务 overlay 防误删 | API 全真 | Spec SC-07 | `GET /api/semantic-assets/overlays?conn=` 正确列出 standalone 与 `merge_overlay` 并标注 `shadowsManifest`；未知查询参数 `400 INVALID_OVERLAY_LIST_QUERY`；对 `merge_overlay` 未确认删除 `409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED` 不删盘，带 `confirmBusinessOverlayDelete=true` 后可删除 |
| UAT-OPG-08 | 回归 | API 全真＋MCP | Spec SC-08 | WebUI 表编辑器 overlay 写读（无 `table:` 合并形态）不变；`catalog/assets/upload` manifest 通道不变；publish batch（维护包）round-trip 不变；既有 zip validate→publish 成功路径与幂等回放不变 |
| （文档审查） | 文档登记审查 | 文档审查 | Spec SC-09 | `webui/docs/03-api-spec.md` 与 `docs/SYSTEM_HANDBOOK.md` 已登记物理名规则、双 409 门禁、plans 409/404、只读列表与受控删除端点及与 P1-90 分工段的交叉引用；SC-09 不设 API 用例，单列本行 |

---

## UAT-R0 — 环境门禁

### 目的

确认隔离 demo 环境就绪，后续用例结果可归因。

### 前置

本机隔离 demo compose 已启动（独立卷，非共享栈）。

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 确认服务健康并记录 `gitSha`、`lucyVersion`、`ktxRuntime`。
2. `curl -sS http://127.0.0.1:55176/api/sources` → 确认 API 直连可达并选定一个含 Schema Manifest 表的可用连接／schema（记录 conn/schema）。
3. 确认 MCP `:57881` 探针可达（后续 SC-02／SC-04 使用）。

### 期望

服务健康、API 直连 200、MCP 端口可用，选定连接／schema 存在。

---

## UAT-OPG-01 — overlay 物理名两段／三段（SC-01）

### 目的

验证 overlay 分类 `table:` 放开为两段或三段，三段名原样记录与落盘，两段名行为不变。

### 前置

UAT-R0 PASS；选定连接上无同名 standalone 文件（避免触发 shadow 路径）。

### 步骤

1. `POST /api/semantic-assets/validate` 提交含三段名（`db.schema.table`）`table:` 的 standalone overlay 包，核对响应 `files[].physicalTable`。
2. `POST /api/semantic-assets/publish` 放行落盘，读取落盘文件核对 `table:` 值。
3. 以两段名 overlay 重复步骤 1–2，并与改动前既有两段名行为对照（回归）。
4. 提交段数非法（单段或四段）的 `table:`，核对错误码与文案。

### 期望

- 三段名 validate 通过，`physicalTable` 原样三段；落盘文件 `table:` 原样三段。
- 两段名行为与现状逐字节一致。
- 段数非法返回 `422 OVERLAY_MISSING_TABLE`，文案含「两段或三段」。

---

## UAT-OPG-02 — 三段名 standalone 引擎可查（SC-02）

### 目的

验证三段名 standalone 发布后引擎读路径正确。

### 前置

UAT-OPG-01 三段名已落盘；MCP `:57881` 可达。

### 步骤

1. `lucy_query` 对该三段名 source 发起度量查询，记录返回值。
2. `lucy_read_source` 读取该 source，核对物理表名。

### 期望

- `lucy_query` 执行成功且数值可对账。
- `lucy_read_source` 返回的 `table:` 与落盘一致（三段原样）。
- 引擎实证输入引用 [`inbox/p191-task0/RECORD.md`](../../../../../inbox/p191-task0/RECORD.md)（Task 0：`sl_query` 142.5、`sl_read_source` 原样返回）。

---

## UAT-OPG-03 — 同名 shadow：validate warnings＋publish 409→确认放行（SC-03）

### 目的

验证同名冲突在 validate 阶段以 warnings 报告、publish 阶段硬阻断且保留 snapshot、确认后放行并携带清理指引。

### 前置

UAT-R0 PASS；使用「manifest 100 表连接上误发同名 overlay」夹具（sourceName 命中 manifest `tables` 键）；记录 validationId 与 snapshot 状态。

### 步骤

1. `POST /api/semantic-assets/validate` 提交与 manifest 表同名的 standalone overlay → 核对 warnings。
2. `POST /api/semantic-assets/publish`（不带 `allowManifestShadow`）→ 核对 409 信封与 snapshot 是否仍存在。
3. 核对磁盘：目标文件未落盘。
4. `POST /api/semantic-assets/publish` 带 `validationId`＋`allowManifestShadow:true` 重试 → 核对成交响应。
5. 核对 release 记录中的 `shadowWarnings`。

### 期望

- validate `warnings` 含 `{ code: "MANIFEST_SHADOW", ... }`，`valid` 不为 `false`。
- publish 返回 `409 OVERLAY_MANIFEST_CONFLICT`，`data.pendingConfirmations: ["allowManifestShadow"]`，`data.nextSteps` 含追加端点／import／组合确认重试／删除清理指引；**snapshot 未被删除**。
- 磁盘无该文件。
- 重试后落盘成交；release 含 `shadowWarnings: [{ code: "MANIFEST_SHADOW", message 含 DELETE /api/semantic-assets/overlay/<conn>/<sourceName> 指引, filePath }]`。

---

## UAT-OPG-04 — 删除回落 manifest（SC-04）

### 目的

验证删除 standalone overlay 后读取回落 Schema Manifest 定义。

### 前置

UAT-OPG-03 已放行落盘（或预置误发 standalone）；记录 manifest 定义基线（物理名／列）。

### 步骤

1. 删除前 `lucy_read_source`／`lucy_query` 该表，记录 standalone 生效下的行为。
2. `DELETE /api/semantic-assets/overlay/<conn>/<sourceName>?dryRun=false`。
3. 删除后 `lucy_read_source`／`lucy_query` 该表，对照 manifest 基线。
4. 全程对照 `GET /api/sources` 行为。

### 期望

- 删除响应 `200 { deleted: true, noChanges: false, deletedFiles: [relPath], kind: "standalone", fallback: "该表读取已回落 Schema Manifest 定义", nextSteps: ["POST /api/semantic-assets/reindex"] }`。
- 删除后读取回落 manifest 定义（物理名与列回到 manifest 版本）。
- `/api/sources` 全程行为不变。

---

## UAT-OPG-05 — 删除端点安全边界与信封（SC-05）

### 目的

验证删除端点参数校验、路径安全、dryRun 信封、写管线与审计。

### 前置

UAT-R0 PASS；选定一个可删除的 standalone 目标。

### 步骤

1. `DELETE ...?unknown=1` → 核对 400 信封。
2. `DELETE /api/semantic-assets/overlay/<conn>/..%2F_schema%2Fx` 与非法段 → 核对 `400 OVERLAY_DELETE_FORBIDDEN`。
3. `DELETE .../不存在的名字` → 核对 `404 OVERLAY_NOT_FOUND`。
4. `DELETE ...（默认 dryRun）` → 核对响应信封与磁盘不变。
5. `dryRun:false` 正式删除；模拟中断恢复，核验不留半份状态。
6. 查询审计记录，核对 actor／目标／diff 摘要。

### 期望

- 步骤 1 → `400 INVALID_OVERLAY_DELETE_QUERY`（含 `data.nextSteps`）。
- 步骤 2 → `400 OVERLAY_DELETE_FORBIDDEN`；步骤 3 → `404 OVERLAY_NOT_FOUND`。
- 步骤 4 → `200 { diff, files: [relPath], noChanges: false, kind, dryRun: true }`，磁盘不变。
- 步骤 5 → 写盘经 ktx.yaml 写锁＋展示读屏障＋发布窗口（`semantic_overlay_delete`）＋恢复日志；中断后无半份状态。
- 步骤 6 → 审计含 actor／目标／diff 摘要，不含凭据与绝对路径。

---

## UAT-OPG-06 — 覆盖门禁＋plans 409/404＋组合确认（SC-06）

### 目的

验证覆盖门禁 snapshot 保留、双 409 同命中组合确认、plans 409/404 区分。

### 前置

UAT-R0 PASS；构造目标文件已存在（覆盖门禁）且 sourceName 命中 manifest 表（同名冲突）的场景。

### 步骤

1. `POST /api/semantic-assets/publish`（目标文件已存在、未带 `confirmOverwrite`）→ 核对 `409 VALIDATION_GATE_FAILED`、`pendingConfirmations: ["confirmOverwrite"]`、snapshot 保留。
2. 同一 validationId 带 `confirmOverwrite:true` 重试 → 成交。
3. 另构造同命中双门禁场景：publish 不带任何确认 → 核对 `409 OVERLAY_MANIFEST_CONFLICT`、`pendingConfirmations: ["confirmOverwrite","allowManifestShadow"]`、`data.nextSteps` 数组。
4. 带齐 `confirmOverwrite:true`＋`allowManifestShadow:true` 单次重试 → 成交，避免连撞两次 409。
5. 对步骤 1 的 legacy validationId 调 `GET /api/semantic-assets/plans/:validationId` → 核对 409。
6. 对随机不存在的 validationId 调 plans → 核对 404。

### 期望

- 步骤 1：`409 VALIDATION_GATE_FAILED`，snapshot 未删，重试成交（步骤 2）。
- 步骤 3：优先返回 `409 OVERLAY_MANIFEST_CONFLICT`（组合场景优先级），`pendingConfirmations` 一次列齐两项。
- 步骤 4：单次带齐两参数重试成交。
- 步骤 5：`409 PLAN_PREVIEW_NOT_AVAILABLE`，`data.nextSteps` 含 `confirmOverwrite:true` 重试与重新 validate。
- 步骤 6：`404 VALIDATION_SNAPSHOT_NOT_FOUND`。

---

## UAT-OPG-07 — 只读盘点＋业务 overlay 防误删（SC-07）

### 目的

验证只读列表端点分类正确、业务合并型 overlay 防误删保护生效。

### 前置

UAT-R0 PASS；连接上同时存在 standalone 与预置业务合并型 overlay（无 `table:`/`sql:`）。

### 步骤

1. `GET /api/semantic-assets/overlays?conn=<conn>` → 核对 items 分类与标注。
2. `GET /api/semantic-assets/overlays?unknown=1` → 核对 400。
3. 对 `merge_overlay` 调 `DELETE ...（默认 dryRun）` → 核对 409。
4. 带 `confirmBusinessOverlayDelete=true` 重试 → 核对可删除。

### 期望

- 步骤 1：items 含 `{ connectionId, sourceName, filePath, kind: "standalone"|"merge_overlay", physicalTable, shadowsManifest, manifestPath? }`；standalone（含 `table:`/`sql:`）与 merge_overlay 分类正确；`shadowsManifest` 标注正确；非法 YAML 存量按 standalone 上报 `physicalTable: null`；排除 `_schema/` 子目录与隐藏文件。
- 步骤 2：`400 INVALID_OVERLAY_LIST_QUERY`。
- 步骤 3：`409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`，`data.kind: "merge_overlay"`，`data.nextSteps` 指引 `confirmBusinessOverlayDelete=true`；磁盘不变。
- 步骤 4：删除成功，`fallback: "该表业务合并口径已清除"`。

---

## UAT-OPG-08 — 回归（SC-08）

### 目的

验证护栏与生命周期改动不破坏既有路径。

### 前置

UAT-R0 PASS。

### 步骤

1. WebUI 表编辑器形态的 merge_overlay（无 `table:`）经 `PUT`/`import` 写读路径回归。
2. `POST /api/catalog/assets/upload` manifest 通道整文件替换回归。
3. publish batch（维护包）round-trip 回归。
4. 既有 zip validate→publish 成功路径与幂等回放回归。

### 期望

- 四条既有路径行为均不变；batch 通道不被 shadow 冲突硬阻断（validate 报 warnings）。
