# Static Catalog Loading Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Static Catalog Loading Spec |
| 文档类型 | Product / UX / API Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-29 |
| 适用范围 | Lucy WebUI 数据库接入模块：`/connections`、`/connections/whitelist`、`AddSchemaDrawer`、本地 Catalog 刷新 API |
| 架构决议 | Zero AI Dependency for Core Pipeline；静态 YAML 文件为 Source of Truth；废弃 WebUI 自动触发 `ktx ingest` CLI 子进程 |
| 事实源 | `ktx.yaml`、`semantic-layer/**/*.yaml`、`.ktx-ui/**` sidecar |
| 关联文档 | `webui/docs/10-deployment-connection-ux-refresh.md`、`webui/docs/11-connection-whitelist-test-ux-refresh.md`、`webui/docs/16-ingest-first-class-ux-spec.md`、`webui/docs/03-api-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

M13 把 Ingest 做成了一等入口，但生产验证暴露了一个更底层的架构问题：WebUI 通过后端触发 CLI `ktx ingest <connection>` 时，KTX 当前扫描链路会进入 enrichment / embeddings 配置路径。在未配置 LLM 或 embedding provider 的私有化环境中，核心数据库接入流程会因 AI 能力缺失而失败：

```text
failed · demo-mysql cannot be ingested: enrichment is not configured (scan enrichment mode, scan embeddings)
```

这与 Lucy 的企业私有化交付目标冲突。数据库接入、表白名单、语义层 YAML 读取属于核心数据管道，必须做到 Zero AI Dependency。AI enrichment 可以是可选增强，但不能成为 Catalog 可见性、Schema 管理、白名单维护的前置条件。

因此 M14 作出架构调整：

1. WebUI 不再自动触发 `ktx ingest` CLI 子进程。
2. WebUI Catalog 只从本地静态文件读取：`ktx.yaml` 与 `semantic-layer/**/*.yaml`。
3. 原 `Ingest` 产品语言降级为历史兼容；面向用户改为 `Reload Catalog` / `刷新本地表目录`。
4. `POST /api/catalog/reload` 成为新的核心刷新端点：重新读取本地 YAML 资产、重建 WebUI 内存/查询缓存视图，并返回结构化统计与 warning。
5. `/api/connections/:connId/ingest` 保留为兼容端点，但必须安全降级为 no-op / alias，不再执行 CLI。

## 2. 问题根因

### 2.1 技术根因

旧链路：

```text
WebUI button
  -> POST /api/connections/:connId/ingest
  -> server/ktx.ts runIngest()
  -> execFile("ktx", ["ingest", connId])
  -> KTX scan + enrichment + embeddings
```

当环境没有配置 enrichment 或 embeddings 时，CLI 以非 0 exit code 失败。即使物理数据库本身可连接、`ktx.yaml` 已配置、`semantic-layer` 已存在，本地 Catalog 仍然会被 CLI 的 AI enrichment 前置依赖阻断。

### 2.2 产品根因

M13 的产品抽象把 `Ingest` 当作元数据同步一等动作，但没有区分两类完全不同的动作：

| 动作 | 依赖 | 是否应成为核心管道 |
|---|---|---|
| 静态 Catalog Reload | 本地 YAML 文件系统 | 是 |
| 物理库扫描 / enrichment / embeddings | KTX CLI、DB 权限、可选 AI/embedding 配置 | 否，必须是可选增强 |

企业 SaaS / 私有化部署中，核心管理页面必须在无第三方 LLM、无公网、无 embedding provider 的环境中稳定可用。

## 3. 架构决议

### 3.1 Zero AI Dependency For Core Pipeline

以下 WebUI 核心能力不得依赖 LLM、embedding、enrichment 或外部 AI API：

- 读取连接概览。
- 展示配置态 schemas。
- 展示本地 semantic-layer 中已存在的表清单。
- 维护 `enabled_tables` 白名单。
- 打开表目录与语义 YAML 编辑页。
- 读取/刷新本地 Catalog 状态。

AI enrichment 只能作为显式、可选、可失败的增强流程出现，不得由这些核心页面隐式触发。

### 3.2 静态文件为 Source Of Truth

WebUI 的 Catalog 事实源：

```text
ktx.yaml
semantic-layer/<connection>/_schema/<schema>.yaml
semantic-layer/<connection>/<table>.yaml
wiki/**/*.md
.ktx-ui/**/*.json
```

对数据库接入模块而言，最小事实源是：

- `ktx.yaml connections.<conn>.schemas`
- `ktx.yaml connections.<conn>.enabled_tables`
- `semantic-layer/<conn>/_schema/*.yaml` 中的 `tables`
- `semantic-layer/<conn>/<table>.yaml` overlay

任何运行时刷新都只应重新读取这些文件，不应主动访问物理数据库或启动 KTX CLI。

### 3.3 废弃 WebUI 自动 CLI Ingest

后端不再执行：

```ts
execFile("ktx", ["ingest", connId])
```

废弃范围：

- `/connections` 的 `触发 Ingest` 按钮。
- Schema 行内 `重新扫描` CLI 语义。
- `/connections/whitelist` 的 `触发 Schema 扫描` CLI 语义。
- Add Schema 抽屉的 `现在 ingest` 尾部动作。
- 自动保存白名单后触发 CLI 的任何残留逻辑。

兼容策略：

- 旧 API `/api/connections/:connId/ingest` 不删除，避免前端旧 bundle 或外部脚本 404。
- 但该 API 必须安全降级为 `POST /api/catalog/reload` 的 connection-scoped alias，返回 `deprecated: true`，且不执行 CLI。

## 4. 页面与组件规格

### 4.1 `/connections` 连接概览

#### 目标

连接概览应展示“当前本地 YAML 资产中的连接、schema、enabled tables 与最近一次本地 reload 状态”。它不负责动态扫描物理数据库。

#### 删除

移除或改名以下 CLI 语义：

- `触发 Ingest`
- schema 行内 `重新扫描`
- `当前 KTX 仅支持连接级 ingest...`
- `Ingest 失败` 作为主错误语言

#### 新增主动作

每个 Connection Card 操作区增加：

```text
[重新加载本地资产]
```

页面级 header 或工具区可提供全局按钮：

```text
[重新加载本地资产 (Reload Catalog)]
```

行为：

1. 点击后按钮进入 loading。
2. 调用 `POST /api/catalog/reload`。
3. 如果在 connection card 内触发，body 带 `{ connectionId }`。
4. 完成后刷新 TanStack Query：
   - `project`
   - `connections`
   - `sources`
   - `connectionTables(connectionId)` 或所有 connection tables
   - `catalogReloads`
5. 成功 toast：`本地 Catalog 已重新加载：demo-mysql · 3 张表 · 1 个 schema。`
6. warning 时展示非阻断提示，例如 manifest 缺失、schema 已配置但没有 `_schema/<schema>.yaml`。

#### Schema 展示

Schema 行/Chip 保留，但不再提供 CLI 扫描按钮。

建议形态：

```text
Schemas
[dataforai]  已有本地 manifest · 3 张表
[openclaw_db] 未发现本地 manifest · 可稍后放入 semantic-layer/demo-mysql/_schema/openclaw_db.yaml
```

如果仍提供行内按钮，文案必须是：

```text
[刷新本地目录]
```

不得使用 `扫描` / `Ingest` / `重新扫描物理库` 等会暗示访问数据库的词。

### 4.2 `/connections/whitelist` 表白名单

#### 保存动作

白名单保存仅写入：

```yaml
connections:
  <conn>:
    enabled_tables:
      - <schema>.<table>
```

规则：

- `保存变更` 不触发 CLI。
- 保存后只 invalidate `connections` 和相关本地 table/source queries。
- 页面可以提示用户需要时点击“刷新本地表目录”，但不能自动 reload 除非实现者明确认为 UI 需要读回本地文件变更。

#### 工具栏常驻动作

工具栏增加：

```text
[刷新本地表目录]
```

行为：

- 单连接时调用 `POST /api/catalog/reload`，body 可带 `{ connectionId }`。
- schema filter 非 `全部 Schema` 时可带 `{ connectionId, schema }`，但语义仍是过滤 reload 结果/统计，不是物理 schema scan。
- 多连接时打开 chooser 或调用全局 reload。M14 推荐全局 reload，因为静态文件读取成本低且无外部副作用。

#### 空 Schema 引导

当 `ktx.yaml` 已配置 schema，但 `semantic-layer/<conn>/_schema/<schema>.yaml` 不存在或没有 tables：

```text
openclaw_db 已在连接配置中启用，但本地 semantic-layer 尚未提供表清单。
请将 manifest 文件放入 semantic-layer/demo-mysql/_schema/openclaw_db.yaml，或在具备 KTX/数据库权限的离线环境中生成后提交。
[刷新本地表目录]
```

这段文案必须是非阻断引导，不要显示为错误。

### 4.3 `AddSchemaDrawer`

#### Step 3 改造

旧 Step 3：

```text
确认并 ingest
现在 ingest
```

新 Step 3：

```text
确认并完成
```

保存成功后展示：

```text
已添加 schema：openclaw_db
WebUI 将从本地 semantic-layer YAML 读取表清单。若该 schema 的 manifest 尚未存在，可稍后添加文件并点击“刷新本地表目录”。
[刷新本地表目录] [完成]
```

规则：

- 移除 `现在 ingest` CLI 按钮。
- 不再展示 CLI stdout/stderr 面板作为主流程的一部分。
- 可以保留静态 reload 成功/警告面板。
- `写入 schema` 仍可在提交前做连接测试，前提是该测试不引入 LLM 依赖；如果连接测试也可能触发 AI 依赖，则降级为可选或移除。

### 4.4 共享组件命名

M13 新增的 ingest 组件需要重命名或废弃：

| 旧组件 | M14 处理 |
|---|---|
| `useIngestRun` | 替换为 `useCatalogReload` |
| `IngestActionButton` | 替换为 `CatalogReloadButton` |
| `IngestDiagnosticsDrawer` | 替换为 `CatalogReloadResultPanel` 或只保留 deprecated 兼容 |
| `IngestLastRunBadge` | 替换为 `CatalogReloadLastRunBadge` |
| `IngestResultPanel` | 删除或改为 reload result panel |

保留 deprecated re-export 可以降低一次性改动风险，但 UI 层不得再出现 `Ingest` 文案。

## 5. API 契约

### 5.1 `POST /api/catalog/reload`

Request：

```json
{
  "connectionId": "demo-mysql",
  "schema": "openclaw_db"
}
```

字段：

- `connectionId` 可选。缺省表示全局 reload。
- `schema` 可选。只用于统计/过滤 warning，不表示扫描物理 schema。

Response：

```json
{
  "ok": true,
  "data": {
    "id": "rel_20260729_103000_123",
    "status": "success",
    "startedAt": "2026-07-29T02:30:00.000Z",
    "finishedAt": "2026-07-29T02:30:00.045Z",
    "durationMs": 45,
    "requestedConnectionId": "demo-mysql",
    "requestedSchema": "openclaw_db",
    "connections": 1,
    "configuredSchemas": 2,
    "manifestSchemas": 1,
    "tables": 3,
    "enabledTables": 3,
    "warnings": [
      {
        "code": "SCHEMA_MANIFEST_MISSING",
        "connectionId": "demo-mysql",
        "schema": "openclaw_db",
        "message": "openclaw_db 已配置，但 semantic-layer/demo-mysql/_schema/openclaw_db.yaml 不存在。"
      }
    ],
    "source": "static-yaml"
  }
}
```

状态：

- `success`：本地文件读取成功，可能带 warnings。
- `failed`：YAML 解析失败或文件系统读取失败。仍应返回结构化错误，不应吞掉路径上下文。

### 5.2 `GET /api/catalog/reloads`

可选但推荐，用于展示最近一次 reload：

```json
{
  "ok": true,
  "data": {
    "runs": [],
    "last": null,
    "lastByConnection": {}
  }
}
```

持久化位置：

```text
.ktx-ui/catalog-reloads.json
```

约束：

- 最近 20 条。
- 只记录本地文件统计与 warning。
- 不记录 secrets。
- 不记录 CLI stdout/stderr，因为不再执行 CLI。

### 5.3 `/api/connections/:connId/ingest` 安全降级

旧端点保留，但行为改为：

```text
POST /api/connections/:connId/ingest
  -> internally call static catalog reload with { connectionId: connId, deprecatedIngestAlias: true }
```

Response：

```json
{
  "ok": true,
  "data": {
    "deprecated": true,
    "replacement": "/api/catalog/reload",
    "message": "WebUI no longer executes ktx ingest. Static catalog reload completed.",
    "reload": {}
  }
}
```

规则：

- 不调用 `runIngest`。
- 不执行 `execFile`。
- 不返回 CLI exitCode/stdout/stderr。
- 测试必须 mock/spy `runIngest` 未被调用。

## 6. 数据读取规则

### 6.1 表目录来源

`/api/connections/:connId/tables` 继续读取：

```text
semantic-layer/<connId>/_schema/*.yaml
```

返回 `schema.table` 列表。

### 6.2 configured schema 与 manifest schema

Reload 时需要同时统计：

- configured schemas：来自 `ktx.yaml connections.<conn>.schemas` 与 enabled table 推导。
- manifest schemas：来自 `semantic-layer/<conn>/_schema/*.yaml`。

差异生成 warnings：

| code | 条件 |
|---|---|
| `SCHEMA_MANIFEST_MISSING` | schema 已配置，但 `_schema/<schema>.yaml` 不存在 |
| `SCHEMA_MANIFEST_EMPTY` | manifest 存在但没有 `tables` |
| `ENABLED_TABLE_NOT_SCANNED` | `enabled_tables` 中的表不在本地 manifest |
| `MANIFEST_PARSE_FAILED` | manifest YAML 无法解析 |

Warnings 是产品提示，不阻断页面。

## 7. 验收标准

1. 后端不再从 WebUI 路径执行 `ktx ingest` CLI。
2. `POST /api/catalog/reload` 可在无 LLM / 无 embedding / 无 KTX enrichment 配置时成功读取本地 YAML。
3. `/api/connections/:connId/ingest` 安全降级，不调用 `runIngest`，并返回 deprecated alias 响应。
4. `/connections` 不再显示 `触发 Ingest`，改为 `重新加载本地资产`。
5. `/connections` schema 行不再承诺物理库扫描，只展示本地 manifest 状态。
6. `/connections/whitelist` 保存 `enabled_tables` 不触发 CLI，不触发 ingest alias。
7. `/connections/whitelist` 工具栏常驻 `刷新本地表目录`。
8. 配置态空 schema 展示非阻断引导，说明需要本地 manifest 文件。
9. `AddSchemaDrawer` Step 3 不再出现 `现在 ingest`，改为保存完成 + 静态载入说明。
10. Vitest 覆盖后端 reload、ingest alias 降级、Add Schema 文案、连接概览按钮、白名单解耦。
11. `npm run build` 通过。

## 8. 非目标

- 不实现 KTX 上游 CLI 修复。
- 不实现物理数据库 DDL 扫描。
- 不实现 enrichment / embeddings 配置 UI。
- 不实现后台任务队列或 WebSocket 进度。
- 不删除 `semantic-layer` 既有 YAML。
- 不修改 `.ktx/secrets/**`。

## 9. 迁移说明

M14 是对 M13 的架构收敛，不是简单 UI 改名：

- Product language：`Ingest` -> `Reload Catalog` / `刷新本地表目录`。
- Runtime behavior：CLI subprocess -> static YAML read.
- Failure model：CLI exit code / stderr -> local file warnings / parse errors.
- Core guarantee：无 LLM 配置也能完成数据库接入模块核心操作。
