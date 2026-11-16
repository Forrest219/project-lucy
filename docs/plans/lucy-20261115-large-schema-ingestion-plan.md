# 大 Schema 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.2；开发授权已获得（2026-11-15，委托人「授权 spec 定稿，进入落地开发」，含终稿确权）；实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（共 5 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）**：Task 1–5、7 已落地并通过 vitest；Task 6 已于 2026-11-16 复跑 4 次，必做 11 条在第 1、3、4、5 次全 PASS，第 2 次 SCALE-09 异常 FAIL 未定位（可选 11／12 未执行）。功能合同逐条收口另行判定；≠ 可上线 |
| 主 Spec | [`docs/specs/lucy-20261115-large-schema-ingestion-spec.md`](../specs/lucy-20261115-large-schema-ingestion-spec.md) **v0.2** |
| 总账 | **P1-34**／REQ-030-055；**不入核心分母**；P1-16、P1-20 的续作 |
| 授权边界 | 只改「准备表结构」的读字段通道：服务端 `schema-structure`／`catalog-show`／`live-discovery` 与前端库层 `prepareSchemaStructure`。不改 KTX、不改问数、不改页面组件、不做浏览器测试、不改写入链路（O3 另议） |
| 验收 | Spec LS-01–LS-15（vitest）；规模下限由测试台 `UAT-SCALE-01…10` 承担，两者**不互相替代** |

## 1. 目标

在不低于 [测试台规模下限](../qa/uat/suites/large-schema-ingestion/suite.md) 的环境下，「准备表结构」勾选 600 张表，60 秒内读完全部字段；任一 HTTP 响应不超过 20 秒；1500–5000 列的宽表不再被整张拒绝；客户端累积 600 张×30 列不超过 5 秒；个别表失败不丢弃已读结果，并在一次错误里列出全部失败表。

**Architecture:** 服务端新增有界「批量读」：一次请求读 1…50 张表，**一次调用只开一条元数据直连**。普通 MySQL 用一条 `information_schema.columns … IN (…)` 取代每表两次 `ktx sql`；外部目录在同一条连接上沿用 P1-20 的 `DESC → SHOW COLUMNS → DESCRIBE` 探针，调用有总预算，超预算的表以 `deferred` 返回由客户端续读。客户端 `readCheckedTableColumns` 改为按 50 张分批、线性累积、汇总失败。单表请求保持原契约。

**Tech Stack:** 现有 Vitest、`mysql2` 直连适配器（`catalog-show.ts` 已用）、`yaml`。

## 2. 开工前置

- [x] Spec 终稿确权＝委托人明示确权（2026-11-15）
- [x] 决策点 O1–O6 闭合（Spec §9）；O2 客户网关超时无法取得，沿用 20 秒假设（委托人认定本机规模接近客户真实用量）
- [x] 开发授权已获得（2026-11-15，同句），Spec 头部状态行与本 Plan 同句
- [x] 总账 P1-34、需求池 REQ-030-055 跟进状态与 Spec 头部同句镜像
- [ ] Global Constraints 已确认：
  - 不修改 KTX 源码，不升级 KTX
  - 单表请求（`tables.length === 1`）的成功响应与失败 400 文案与改前**逐字一致**（LS-08）
  - 外部目录失败不得回退到 `information_schema`（沿用 P1-20）
  - 密码不得进入错误文本、日志、审计和测试快照（LS-15）
  - 任何一次调用里同一张表不重复读；`columns`／`rejections`／`deferred` 对请求表集构成划分（LS-07）
  - 不得静默截断字段；触顶必须折半重试或 `too_wide` 明示
  - 提供回滚开关 `LUCY_SCHEMA_READ_LEGACY=1`（LS-14）

## 3. 文件地图与任务

| 文件 | 职责 | LS |
|---|---|---|
| `webui/server/metadata-channel.ts`（新） | 类型化直连元数据通道：开一条连接、`run(sql, {maxRows, timeoutMs})`、必关、脱敏。从 `catalog-show.ts` 抽出共用的连接／脱敏部分，**不改 `runCatalogShow` 的对外行为** | LS-01／04／15 |
| `webui/server/schema-structure.ts` | 新增 `readTablesBatch`；普通 MySQL 分块查询、折半、归因；外部目录同连接探针；调用预算；`COLUMN_READ_ROW_LIMIT` 改 10000；回滚开关 | LS-01–09／14 |
| `webui/server/catalog-database.ts` | 新增 `columnsOfTablesSql(schema, tables)`；`CATALOG_TABLE_NAME_LIMIT` 保持 200000 | LS-02 |
| `webui/server/index.ts` | 路由 `POST /api/connections/:connId/schema-structure` 接受 1…50 张表，响应加 `rejections?`／`deferred?` | LS-08／09 |
| `webui/server/admin/live-discovery.ts` | 结构差异改走批量读，不再逐表起 `ktx sql` | LS-13 |
| `webui/src/lib/prepareSchemaStructure.ts` | `readCheckedTableColumns` 分批、续读、线性累积、汇总失败；`mergeManifestTables` 不改语义 | LS-10／11／12 |
| `webui/server/__tests__/schema-structure-batch.test.ts`（新） | LS-01–09／14 的服务端用例 | — |
| `webui/server/__tests__/live-discovery-batch.test.ts`（新） | LS-13 | — |
| `webui/src/__tests__/prepare-schema-structure.test.ts` | 扩展 LS-10／11／12 | — |
| `scripts/uat/run-large-schema-ingestion.mts` | 契约改后核对 runner 的 `readTables` 批量分支（已内建兼容） | — |

### Task 0：基线取证（只测不改）

不依赖授权就能做；产出写进跑次，作为 O1／O2／O3 的决策证据。**需要本机 demo 管理员口令**（当前 BLOCKED）。

- [ ] **Step 1（可选，已降级）：补齐 HTTP 基线。**不再是开工前置；实现后 Task 6 的复跑取代它。取得口令后执行 `cd webui && LUCY_E2E_WEBUI_ADMIN_ID=<id> npx tsx ../scripts/uat/run-large-schema-ingestion.mts --out ../inbox/uat-large-schema-$(date +%F)`。预期 SCALE-03／04／07／09 FAIL，01／02／05／06 PASS，08／10 取数。把 `result.json` 摘要写入新跑次文件。
- [ ] **Step 2：写入链路基线（O3）。** 对 600×30 列 Manifest 在隔离环境测 `validate`、`upload`、`reload` 耗时（UAT-SCALE-11）。记录，不判定。
- [ ] **Step 3：`LOWER(table_name) IN` 对比。** 在 `mysql:5.7`／`8.0`／`8.4` 上对 1200 张表的 Schema，比较 `LOWER(table_name) IN (…)` 与「先用 `information_schema.tables` 解析物理表名、再用精确 `IN`」两种写法的执行计划与耗时。选者写入 Task 2。
- [ ] **Step 4：网关超时取证（O2）。** 向客户侧索取反向代理／网关的空闲与总超时；取不到则维持 20 秒假设并在 Spec 注明。

### Task 1：元数据直连通道

**Files:** Create `webui/server/metadata-channel.ts`；Modify `webui/server/catalog-show.ts`（仅抽出共用函数，行为不变）；Test `webui/server/__tests__/schema-structure-batch.test.ts`。

接口：

```ts
export type MetadataChannel = {
  run(sql: string, opts: { maxRows: number; timeoutMs: number }): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }>;
  close(): Promise<void>;
};
export class MetadataChannelUnavailable extends Error {}   // 驱动不支持该连接的选项（LS-14）
export async function openMetadataChannel(
  projectRoot: string, connectionId: string, deps?: DriverDeps
): Promise<MetadataChannel>;
```

- [ ] **Step 1：写失败测试。** `LS-04：外部目录一次调用只建立 1 条连接`：注入计数的 `createConnection`，对 3 张表调用 `openMetadataChannel` 后连续 `run` 3 次，断言 `createConnection` 调用数＝1，`close` 调用数＝1，且 `run` 抛错时仍关连接。
- [ ] **Step 2：运行确认失败。** `cd webui && npx vitest run server/__tests__/schema-structure-batch.test.ts -t "LS-04"`；预期：模块不存在。
- [ ] **Step 3：实现。** 复用 `catalog-show.ts` 的 `.ktx/secrets/<name>-password` 解析与脱敏；连接选项含驱动不支持项时抛 `MetadataChannelUnavailable`。
- [ ] **Step 4：回归。** `npx vitest run server/__tests__/catalog-show.test.ts server/__tests__/doris-external-catalog.simulation.test.ts`；预期原用例全绿（LS-05）。

### Task 2：服务端 `readTablesBatch`

**Files:** Modify `webui/server/schema-structure.ts`、`webui/server/catalog-database.ts`；Test `webui/server/__tests__/schema-structure-batch.test.ts`。

接口：

```ts
export const MAX_TABLES_PER_CALL = 50;
export const MYSQL_IN_CHUNK = 100;
export const CALL_BUDGET_MS = 10_000;
export const PER_TABLE_TIMEOUT_MS = 8_000;
export type BatchRejection = { table: string; reason: "missing"|"permission"|"timeout"|"ambiguous"|"too_wide"|"unreadable"; message: string };
export type BatchRead = { columns: ColumnRow[]; rejections: BatchRejection[]; deferred: string[] };
export async function readTablesBatch(
  projectRoot: string, connection: ConnectionRecord, schema: string, tables: string[],
  deps?: { openChannel?: typeof openMetadataChannel; now?: () => number }
): Promise<BatchRead>;
```

按下列顺序逐条「先红后绿」，每条一个测试名：

- [ ] **LS-01** 普通 MySQL 读 40 张表：断言驱动只收到 1 条 `information_schema.columns` 语句，`runSql`（`ktx sql`）调用数＝0。
- [ ] **LS-02** 大小写与歧义：`Bar`／`bar` 同时存在 → `ambiguous`；不存在 → `missing`（回归 EE54）。
- [ ] **LS-03** 行数触顶：注入返回 `truncated=true`，断言折半重试，结果不丢行；单表仍触顶 → `too_wide`。
- [ ] **LS-06** 单表 9999 字段读出；10000 字段 → `too_wide`，文案含表名与数字。把 `COLUMN_READ_ROW_LIMIT` 改为 10000。
- [ ] **LS-07** 注入时钟使第 N 张之后超 `CALL_BUDGET_MS`：断言 `columns`／`rejections`／`deferred` 对输入表集构成划分，且 `deferred` 保序。
- [ ] **LS-14** `openChannel` 抛 `MetadataChannelUnavailable` 或 `LUCY_SCHEMA_READ_LEGACY=1`：走改前路径，输出与改前快照一致。
- [ ] **LS-15** 密码进不了任何错误文本、日志、快照（扩展既有脱敏断言）。
- 每一条之后运行：`cd webui && npx vitest run server/__tests__/schema-structure-batch.test.ts`。全部绿后再运行回归集（Task 3 末尾的命令）。
- 实现注意：Task 0 Step 3 的结论决定 `columnsOfTablesSql` 用哪种写法；两种写法都必须过 LS-02。

### Task 3：路由合同

**Files:** Modify `webui/server/index.ts`；Test `webui/server/__tests__/schema-structure-batch.test.ts`。

- [ ] **LS-09** 请求 51 张表 → 400 `BAD_REQUEST`，断言无任何源库访问（`openChannel` 调用数＝0）。
- [ ] **LS-08** 请求 1 张表：成功响应形态与改前一致；失败仍 400＋原文案（用 P1-20 的快照）。
- [ ] 请求 2…50 张表：响应在 `SchemaStructurePreview` 上加可选 `rejections`、`deferred`；`yaml`／`tableCount` 只含读成功的表。
- [ ] **回归集：**

```bash
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/schema-structure-batch.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts \
  server/__tests__/live-catalog.test.ts
```

预期全绿（含 LS-05 的 P1-20 EC-01–EC-13）。

### Task 4：结构差异走批量读

**Files:** Modify `webui/server/admin/live-discovery.ts`；Test `webui/server/__tests__/live-discovery-batch.test.ts`。

- [ ] **LS-13** 对 20 张表：MySQL 只开 1 条连接、发 1 条字段查询，`runSql` 零调用；`MAX_STRUCTURE_DIFF_TABLES = 20` 保持（Spec 190 不动）。
- [ ] 运行 `npx vitest run server/__tests__/live-discovery-batch.test.ts server/__tests__/live-tables.test.ts`，预期全绿。

### Task 5：客户端库层

**Files:** Modify `webui/src/lib/prepareSchemaStructure.ts`；Test `webui/src/__tests__/prepare-schema-structure.test.ts`。

- [ ] **LS-10** mock 服务读 600 张：请求数＝⌈600/50⌉＋续读次数；`deferred` 的表最终被读到；`onProgress` 回调形态不变。
- [ ] **LS-11** 累积 600 张×30 列：YAML 解析次数 ≤ 批次数＋1，序列化 1 次；单步 ≤ 200 毫秒、总计 ≤ 5 秒（墙钟＋计数双断言）。
- [ ] **LS-12** 600 张里 3 张失败：读完其余 597 张，只抛一次错误，文案列出 3 张表与各自原因。
- [ ] 不变量测试：`deferred` 非空时 `done` 不前进；构造「每次都 deferred」的服务端，断言循环有界（每轮至少读完一张，否则抛错而不是死循环）。
- [ ] 运行 `cd webui && npx vitest run src/__tests__/prepare-schema-structure.test.ts`，预期全绿。

### Task 6：测试台复跑（真实环境）

- [x] **Step 1：** 受测镜像重建。按仓库规则平滑升级：`npm run demo:upgrade`，核对 `/api/health` 的 `gitSha` 等于实现提交且 `gitDirty=false`。回复里带出 WebUI／MCP 地址。前 4 次跑时容器 `gitDirty=true`（工作区含其他会话在途改动）；2026-11-16 委托人重建后第 5 次在干净提交 `299de2c9`、`gitDirty=false` 上跑，已满足。
- [x] **Step 2（部分满足）：** 夹具必须来自当次 `bash scripts/uat/seed-large-schema-fixtures.sh all`。**实际**：当次跑了该脚本自检，库已存在，脚本跳过造数，夹具为 2026-11-15 从零造出的同一批。
- [x] **Step 3：** 跑 runner（命令同 Task 0 Step 1）。目标：R0／01…10 全部 PASS。任何一条 FAIL 或 BLOCKED 都不得宣称收口。**结果**：共 5 次完整跑，第 1、3、4、5 次 11 条全 PASS，第 2 次 SCALE-09 一次异常 FAIL（原因未定位），按此不宣称「稳定 PASS」。
- [x] **Step 4（部分）：** 写入新的跑次文件、更新 INDEX 与 e2e-ledger（GAP-UAT-P1-34 已改为剩余项，未关闭），Spec 头部状态与总账同句。

### Task 7：回滚开关与文档同句

- [ ] 确认 `LUCY_SCHEMA_READ_LEGACY=1` 在 demo compose 的环境变量里可设，并在 runbook 一行说明（不新增文档文件，写进 Spec §3 回滚段）。
- [ ] 运行 `npm run lint:spec-docs` 与 `npm run lint:e2e-ledger`，预期无新增告警。

## 4. 验收

按 Spec LS-01–LS-15（vitest）。本机命令：

```bash
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/schema-structure-batch.test.ts \
  server/__tests__/live-discovery-batch.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts \
  server/__tests__/live-catalog.test.ts \
  src/__tests__/prepare-schema-structure.test.ts
```

规模验收：`UAT-SCALE-R0／01…10` 在 `UAT-SUITE-LARGE-SCHEMA` 里 PASS，INDEX 为准。**vitest 绿不得写成 UAT PASS。**

## 浏览器验证

不适用：本条只改服务端读字段通道与前端库层的请求与累积方式，不改变用户可见 WebUI 表面（无新增文案之外的页面变化）；验收以 vitest 与测试台 HTTP 用例为准。

## 5. 完成定义

- 功能合同：LS-01–LS-15 全绿；回归集（含 P1-20 EC-01–EC-13）全绿；单表请求契约逐字不变。
- 文档：Spec 头部、本 Plan、总账 P1-34、需求池 REQ-030-055 同句。
- 测试台：Task 6 的复跑记录挂 INDEX；规模下限未被降低。
- **不含：** 客户现场 live、UAT PASS 的主张（除非测试台 INDEX 已 PASS）、可上线。

## 6. 风险与回滚

- `LOWER(table_name) IN` 可能放弃索引：Task 0 Step 3 三版本实测后选写法；LS-02 守语义。
- 直连通道与 KTX 连接选项不一致：LS-14 回退，不失败。
- 预算截断使客户端不收敛：每次调用至少读完一张表；Task 5 不变量测试。
- 单表 8 秒超时比原 120 秒更严：以 O2 取证为准；超时有独立 `timeout` 原因。
- 紧急回退：设置 `LUCY_SCHEMA_READ_LEGACY=1` 恢复改前读法；代码级回退为还原 Task 2／3／5 的改动。回退后大库仍慢，但不会比改前更坏。

## 7. 非本 Plan

写入链路（校验、上传、热重载）的优化（O3，Task 0 先量化，超 B6 另立条目）；部分成功的页面交互（O4，另立交互合同 Spec）；客户现场 live 必测；Hive HS2 直连晋级；字段注释读取；浏览器 UAT。
