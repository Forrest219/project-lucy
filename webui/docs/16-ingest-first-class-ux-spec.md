# Ingest First-Class UX Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Ingest First-Class UX Spec |
| 文档类型 | Product / UX / API Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-28 |
| 适用范围 | Lucy WebUI 数据库接入模块：`/connections`、`/connections/whitelist`、Add Schema ingest 闭环 |
| 事实源 | `ktx ingest <connection>`、`semantic-layer/<connection>/_schema/*.yaml`、`ktx.yaml connections[].schemas/enabled_tables` |
| 关联文档 | `webui/docs/10-deployment-connection-ux-refresh.md`、`webui/docs/11-connection-whitelist-test-ux-refresh.md`、`webui/docs/03-api-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 结论

我认同把 Ingest 升级为一等功能，而不是继续藏在“添加 Schema”抽屉尾部或白名单保存副作用里。

在 Cube.dev、dbt Cloud、Databricks Unity Catalog 等产品范式中，Catalog Refresh / Schema Ingestion 是连接物理 DDL 与上层语义定义的关键动作。Lucy WebUI 当前已经有 `POST /api/connections/:connId/ingest`，但它的入口、状态、日志和后续刷新都不够产品化，导致用户在出现 `openclaw_db` 这类“配置存在但扫描产物缺失”的状态时，只能靠 CLI 或猜测排查。

M13 的目标是把 Ingest 建成一个可见、可重试、可诊断、可复用的业务能力：

1. `/connections` 提供连接级主入口。
2. `/connections` 中每个 schema 提供局部扫描入口或能力受限提示。
3. `/connections/whitelist` 提供常驻扫描入口，与保存白名单解耦。
4. Add Schema 抽屉继续保留“刚添加后立即 ingest”的就地动作，但统一使用同一套状态与日志组件。

## 2. 立场与取舍

### 2.1 认同

- Ingest 应该是数据库接入模块的一等动作。
- Ingest 不应该只在有白名单变更时被触发。
- Ingest 失败必须展示 stderr/stdout，而不是只显示 `退出码 1`。
- 连接概览应展示最近一次 Ingest 时间和结果，否则用户无法判断 schema/table inventory 是否新鲜。
- 白名单页应允许“我只是想刷新上游物理表列表”，不强迫用户改 `enabled_tables`。

### 2.2 有条件认同

Schema 级“精准重新扫描”是正确的目标体验，但当前 WebUI 后端只调用：

```ts
ktx ingest <connId>
```

也就是说，现有能力是 connection-scoped ingest，不是 schema-scoped ingest。

因此 M13 要采用能力探测与渐进交付：

| 能力 | M13 行为 |
|---|---|
| KTX 支持 schema-scoped ingest | 后端传入 schema 参数，UI 文案为 `重新扫描此 Schema`。 |
| KTX 暂不支持 schema-scoped ingest | UI 仍允许从 schema 行触发，但必须明确提示“当前将扫描整个连接，并在完成后刷新该 schema 的表清单”。 |

禁止在不支持 schema 参数时，把全连接扫描伪装成真正局部扫描。

### 2.3 反对

- 反对 hover-only 微型入口。企业级管理后台不能把关键动作只藏在 hover 中；可以 hover 增强，但必须有键盘可达、可见按钮或菜单。
- 反对将 Ingest 与“保存白名单”强绑定。保存是写 `enabled_tables`，ingest 是刷新物理元数据，两者可以串联，但不能互相依赖。
- 反对无限保存 stdout/stderr 原文。日志可能包含连接字符串、路径或供应商错误细节，必须做脱敏、截断和仅保留最近 N 条。

## 3. 现状问题

### 3.1 配置态与扫描态混淆

`/connections` 展示的是配置态：

- `ktx.yaml connections.<conn>.schemas`
- `enabled_tables` 推导出的 schema

`/connections/whitelist` 展示的是扫描态：

- `semantic-layer/<conn>/_schema/*.yaml`
- 每个 manifest `tables:` 下的物理表

当 `openclaw_db` 写入 `schemas` 但 `ktx ingest demo-mysql` 失败或没有生成 `_schema/openclaw_db.yaml` 时，概览能看到 schema，白名单看不到表。这个状态本身合理，但 UI 必须讲清楚“已配置，未扫描到表”。

### 3.2 Ingest 入口缺失

当前显性入口不足：

- Add Schema 抽屉尾部有 `现在 ingest`，但用户离开抽屉后很难找到。
- 白名单保存时会触发扫描，但只有未保存变更时才出现。
- 连接概览没有独立 Ingest CTA。
- 没有最近一次 Ingest 状态。

### 3.3 诊断闭环不足

Ingest 失败时应展示：

- exit code
- stderr
- stdout
- 命令上下文
- 失败分类提示
- 重试入口

Add Schema 抽屉已经开始补齐失败日志展示，但这个能力应抽成共享组件，在所有 Ingest 入口复用。

## 4. 信息模型

### 4.1 IngestRun

新增前后端共享类型：

```ts
export type IngestScope = "connection" | "schema";

export type IngestRunStatus = "running" | "success" | "failed";

export type IngestRun = {
  id: string;
  connectionId: string;
  schema?: string;
  requestedScope: IngestScope;
  executedScope: IngestScope;
  schemaScopedSupported: boolean;
  status: IngestRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  command: string[];
  scannedTableCount?: number;
  scannedSchemas?: string[];
  hint?: string;
};
```

字段说明：

- `requestedScope`：用户点击的是连接级还是 schema 级入口。
- `executedScope`：后端实际执行范围。KTX 不支持 schema 参数时，schema 入口会执行 connection scope。
- `schemaScopedSupported`：前端必须据此展示能力提示。
- `scannedTableCount`：执行完成后从 `/api/connections/:connId/tables` 或 manifest 重新统计。
- `stdout` / `stderr`：必须脱敏、截断后返回。

### 4.2 IngestState

连接对象可以增加最近一次状态：

```ts
export type ConnectionInfo = {
  // existing fields...
  lastIngest?: IngestRun;
};
```

或者单独提供：

```text
GET /api/connections/ingest-runs
```

M13 推荐单独接口，避免把日志字段塞进 `/api/connections` 的常规列表响应；前端再按 `connectionId` 聚合最近一次记录。

### 4.3 持久化位置

推荐新增 `.ktx-ui/ingest-runs.json` 作为 WebUI sidecar：

```json
{
  "runs": []
}
```

约束：

- 只保留最近 20 条 run。
- 每条 stdout/stderr 最多保留 16KB。
- 写入前做基础脱敏：password、token、secret、Authorization、DSN password 参数。
- 不写 `.ktx/secrets/**`。
- 不修改 `ktx.yaml`。

## 5. API 设计

### 5.1 触发 Ingest

```text
POST /api/connections/:connId/ingest
```

Request：

```json
{
  "schema": "openclaw_db"
}
```

Response：

```json
{
  "ok": true,
  "data": {
    "id": "ing_20260728_183000_demo_mysql",
    "connectionId": "demo-mysql",
    "schema": "openclaw_db",
    "requestedScope": "schema",
    "executedScope": "connection",
    "schemaScopedSupported": false,
    "status": "failed",
    "startedAt": "2026-07-28T10:30:00.000Z",
    "finishedAt": "2026-07-28T10:30:01.245Z",
    "durationMs": 1245,
    "exitCode": 1,
    "stdout": "",
    "stderr": "Unknown database 'openclaw_db'",
    "command": ["ktx", "ingest", "demo-mysql"],
    "scannedTableCount": 3,
    "scannedSchemas": ["dataforai"],
    "hint": "物理库 openclaw_db 不存在或当前账号缺少访问权限。"
  }
}
```

规则：

- 非 0 exit code 仍返回 `ok: true`，`data.status = "failed"`，以便前端展示完整日志。
- CLI 启动失败（如 `ktx` 不存在）才返回 `ok: false`。
- 成功或失败都要记录 run。

### 5.2 查询 Ingest Run

```text
GET /api/connections/ingest-runs
GET /api/connections/:connId/ingest-runs
```

Response：

```json
{
  "ok": true,
  "data": {
    "runs": [],
    "lastByConnection": {}
  }
}
```

M13 最小可只实现 `GET /api/connections/ingest-runs`。

### 5.3 能力探测

M13 最小策略：

- 后端默认 `schemaScopedSupported = false`。
- 如果后续 KTX CLI 支持 schema 参数，再在 `runIngest` 中探测或配置启用。

可选策略：

- 启动时执行 `ktx ingest --help` 解析是否存在 `--schema`。
- 或通过环境变量 `LUCY_KTX_SCHEMA_INGEST_SUPPORTED=1` 显式打开。

## 6. 页面设计

### 6.1 `/connections` 连接概览

#### 连接卡片主入口

每个 Connection Card 操作区增加：

```text
[触发 Ingest]
```

行为：

1. 点击后按钮进入 loading。
2. 调用 `POST /api/connections/:connId/ingest`。
3. 完成后刷新：
   - `connections`
   - `sources`
   - `connectionTables(connId)`
   - `ingestRuns`
4. 成功 toast：`demo-mysql Ingest 成功，已同步 3 张表元数据。`
5. 失败打开 Ingest 诊断抽屉。

#### 上次 Ingest 状态

卡片内展示：

```text
上次 Ingest：2026-07-28 18:30 · 成功 · 3 张表
```

失败态：

```text
上次 Ingest：2026-07-28 18:30 · 失败 · 退出码 1
```

从未运行：

```text
上次 Ingest：未运行
```

#### Schema 行内入口

当前 Connection Card 中 `schemas` 不应只是一段逗号文本。M13 改为 schema chips 或小表格：

```text
Schemas
[dataforai] [重新扫描]
[openclaw_db] [重新扫描]
```

规则：

- 按钮必须可见且键盘可达，不只在 hover 时出现。
- 如果 `schemaScopedSupported = false`，按钮 tooltip / 说明文案为：`当前 KTX 将扫描整个连接，完成后刷新此 schema 的表清单。`
- 点击 schema 入口时 request body 带 `{ schema }`，即使后端最终执行 connection-scoped ingest，也保留用户意图。

### 6.2 `/connections/whitelist` 表白名单

#### 顶部 Action Bar

在搜索与 schema 筛选工具栏右侧增加常驻按钮：

```text
[触发 Schema 扫描]
```

行为：

- 如果当前只有一个 connection，默认扫描该 connection。
- 如果当前 schema filter 不是 `全部 Schema`，默认带上该 schema。
- 如果存在多个 connection 或 `全部 Schema` 会造成歧义，点击后打开 `IngestScopeDialog` 让用户选择 connection/schema。

#### 保存动作解耦

当前 floating bar：

```text
[重置] [预览 YAML] [保存并触发扫描]
```

改为：

```text
[重置] [预览 YAML] [保存变更]
```

保存成功后显示状态条：

```text
白名单已保存。需要刷新物理表元数据时，可点击“触发 Schema 扫描”。
```

可以提供轻量 CTA：

```text
[立即扫描]
```

但不能让保存按钮默认强绑定 ingest。

#### 配置态空 schema

当 schema 已在 `ktx.yaml schemas` 中配置，但没有扫描到表时，继续展示空状态：

```text
openclaw_db 已在连接配置中启用，但尚未扫描到可加入白名单的表。
[触发 Schema 扫描] [查看最近日志]
```

### 6.3 Add Schema 抽屉

保留 `现在 ingest`，但改为复用统一的 `IngestResultPanel` / `IngestDiagnosticsDrawer`。

成功后：

- 自动刷新 connection overview 和 whitelist table inventory。
- 显示 table count。

失败后：

- 展示同一套 exit code / stderr / stdout / hint / retry。

## 7. 共享组件

### 7.1 `IngestActionButton`

职责：

- 接收 `connectionId`、可选 `schema`、`variant`。
- 触发 mutation。
- 管理 loading state。
- 通过 callback 返回 `IngestRun`。

### 7.2 `IngestDiagnosticsDrawer`

内容：

- 标题：`Ingest 失败`
- Scope：connection / schema
- Exit Code badge
- Hint
- stderr/stdout tabs 或 details
- command
- startedAt / duration
- Actions：
  - `重试`
  - `复制日志`
  - `关闭`
  - `查看文档`（可先链接到本地 user guide 或留 disabled）

### 7.3 `IngestLastRunBadge`

用于 connection card：

- success / failed / running / never
- 展示相对时间或本地时间。

## 8. 失败提示分类

复用 Add Schema 已有 hint 逻辑，并提升到共享工具：

| 日志特征 | 用户提示 |
|---|---|
| `Unknown database` / `does not exist` | 物理库可能不存在，或 schema 名写错。 |
| `Access denied` / `permission denied` / `privilege` | 当前账号可能缺少 SHOW TABLES 或读 schema 权限。 |
| `Connection "<id>" is not configured` | 当前 WebUI 指向的项目根与连接配置不一致。 |
| `no tables` / `0 tables` | 该 schema 下没有可见表，或权限只能看到 0 张表。 |
| 其他非 0 | 展开 stderr/stdout 查看 ktx 原始日志。 |

## 9. 验收标准

1. `/connections` 每个连接卡片有可见 `触发 Ingest` 按钮。
2. `/connections` 能展示最近一次 Ingest 成功/失败状态。
3. `/connections` 的 schema 项有可达的 `重新扫描` 入口，并清楚说明是否为真实 schema-scoped ingest。
4. `/connections/whitelist` 顶部有常驻 `触发 Schema 扫描`，白名单无变更时也可用。
5. `/connections/whitelist` 保存按钮改为 `保存变更`，不默认强绑定 ingest。
6. 任一 Ingest 失败时，都能看到 exit code、stderr、stdout 和 hint。
7. 成功或失败后自动刷新 `connections`、`sources`、`connectionTables`、`ingestRuns`。
8. stdout/stderr 不无限落盘，且做基础脱敏。
9. Vitest 覆盖连接概览入口、白名单常驻入口、失败日志抽屉、schema-scoped unsupported 提示。

## 10. 非目标

- 不在 M13 修改 KTX 上游 CLI。
- 不实现后台长任务队列或 WebSocket 进度推送。
- 不实现定时自动 ingest。
- 不实现跨用户审计权限模型。
- 不修改 `.ktx/secrets/**`。

## 11. 后续演进

- KTX 支持 schema-scoped ingest 后，切换 `executedScope` 为 `schema`。
- 增加定时 Catalog Refresh。
- 增加 schema/table diff：新增表、删除表、字段变更。
- 增加 freshness SLA：展示 manifest 更新时间与物理库 DDL 变更差异。
- 增加 audit log：谁在什么时候触发了哪个 connection/schema 的 ingest。
