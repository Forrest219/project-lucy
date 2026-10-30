# 03 · API 契约

REST over HTTP，仅 `127.0.0.1`。所有响应为 JSON，遵循统一 envelope。

## 1. 统一响应 envelope（硬约束 · ADR-09）

成功：
```jsonc
{ "ok": true, "data": { /* ... */ } }
```
失败：
```jsonc
{ "ok": false, "error": { "code": "FORBIDDEN_PATH", "message": "...", "detail": {} } }
```

> 前端 `apiClient` **必须**先判 `ok===false` 并处理 `error`，再使用 `data`。
> 禁止在 `ok:false` 时回退渲染空/假数据（历史 bug 教训）。

错误码：`PROJECT_NOT_FOUND` `SOURCE_NOT_FOUND` `WIKI_NOT_FOUND` `FORBIDDEN_PATH`
`VALIDATION_FAILED` `KTX_CLI_ERROR` `YAML_PARSE_ERROR` `BAD_REQUEST` `INTERNAL`。

## 2. 端点总览

> 地址粒度按 ADR-02 修正：表 = `connectionId + schema + table`（README 旧版用 `connectionId/sourceName`，已废弃）。

```text
GET  /api/health
GET  /api/project
GET  /api/sources
GET  /api/sources/:conn/:schema/:table
PUT  /api/sources/:conn/:schema/:table         # body.dryRun 控制预览/落盘
POST /api/sources/:conn/:schema/:table/validate
POST /api/sources/:conn/:schema/:table/import
GET  /api/sources/:conn/:schema/:table/versions
GET  /api/sources/:conn/:schema/:table/versions/:versionId
POST /api/sources/:conn/:schema/:table/versions/:versionId/restore/preview
POST /api/sources/:conn/:schema/:table/versions/:versionId/restore

GET  /api/wiki
GET  /api/wiki/:key
GET  /api/wiki/:key/raw
PUT  /api/wiki/:key
POST /api/wiki/upload/preview
POST /api/wiki/upload/commit
GET  /api/wiki/directories
POST /api/wiki/directories
POST /api/wiki/directories/rename/preview
POST /api/wiki/directories/rename
DELETE /api/wiki/directories/:path
DELETE /api/wiki/:key
POST /api/wiki/:key/move/preview
POST /api/wiki/:key/move
GET  /api/wiki/:key/versions
GET  /api/wiki/:key/versions/:versionId
POST /api/wiki/:key/versions/:versionId/restore/preview
POST /api/wiki/:key/versions/:versionId/restore
GET  /api/wiki/:key/access
POST /api/wiki/:key/access/preview
PUT  /api/wiki/:key/access
POST /api/wiki/access/batch/preview
POST /api/wiki/access/batch/commit
GET  /api/wiki/access/batches/:operationId

GET  /api/diff
POST /api/validate-changed

GET  /api/joins/candidates                       # .ktx-ui sidecar
PUT  /api/joins/candidates

GET  /api/connections
POST /api/connections                            # Spec 124 Phase A: create connection (dryRun:true default; one-shot secret write)
GET  /api/connections/:connId/tables
GET  /api/connections/:connId/live-schemas       # Owner on-demand read-only DB catalog (Spec 107)
PUT  /api/connections/:connId/enabled-tables     # default dryRun
POST /api/connections/:connId/remove             # Spec 127: delete connection (dryRun:true default; optional deleteSecret/deleteAssets)
POST /api/connections/:connId/schemas            # add schema metadata to existing connection
POST /api/connections/:connId/schemas/remove     # remove schema from connection (dryRun:true default; prunes enabled_tables prefix; optional deleteManifest/deleteOverlays)
POST /api/connections/:connId/test
POST /api/connections/:connId/ingest
GET  /api/connections/ingest-runs
POST /api/connections/:connId/schema-structure
GET  /api/connections/:connectionId/import-scope
GET  /api/connections/:connId/live-tables         # Spec 190: Schema-level live table list
GET  /api/connections/:connId/table-diff          # Spec 190: reconciliation state + change events
GET  /api/connections/:connId/table-structure-diff # Spec 190: on-demand column-level deep check
GET  /api/connections/:connId/discovery           # Spec 190: continuous discovery status
PUT  /api/connections/:connId/discovery           # Spec 190: owner-only discovery configuration

POST /api/catalog/reload
GET  /api/catalog/reloads
POST /api/catalog/assets/validate
POST /api/catalog/assets/upload
GET  /api/catalog/assets/uploads
GET  /api/catalog/assets/schema-manifest

GET    /api/eval/domains
GET    /api/eval/domains/:domain
GET    /api/eval/cases/:domain
GET    /api/eval/cases/:domain/:caseId
POST   /api/eval/cases/:domain
PUT    /api/eval/cases/:domain/:caseId
DELETE /api/eval/cases/:domain/:caseId
POST   /api/eval/cases/:domain/:caseId/confirm-review
POST   /api/eval/suites/import
GET    /api/eval/suites/:domain/download
POST   /api/eval/results/import
POST   /api/eval/runs
GET    /api/eval/runs
GET    /api/eval/runs/:runId
GET    /api/eval/runs/:runId/results
GET    /api/eval/runs/:runId/artifact
GET    /api/eval/runs/:runId/compare
POST   /api/eval/runs/:runId/cancel
GET    /api/eval/runs/:runId/stream
GET    /api/eval/monitor/trend
GET    /api/eval/monitor/top-failures
GET    /api/eval/monitor/drift-distribution
GET    /api/eval/monitor/config
PUT    /api/eval/monitor/config
GET    /api/eval/monitor/threshold
PUT    /api/eval/monitor/threshold
GET    /api/eval/monitor/field
GET    /api/eval/security-candidates
POST   /api/eval/security-candidates/extract
POST   /api/eval/security-candidates/:id/review
POST   /api/eval/security-candidates/:id/promote/preview
POST   /api/eval/security-candidates/:id/promote

GET    /api/eval/field-questions
POST   /api/eval/field-questions/extract
POST   /api/eval/field-questions/:id/promote

POST   /api/connections/probe

GET    /api/skills
GET    /api/skills/:domain/:name
POST   /api/skills/preview
POST   /api/skills/:domain/:name/preview
POST   /api/skills/validate
POST   /api/skills/reload
POST   /api/skills/export

GET    /api/admin/tokens
GET    /api/admin/audit/query-artifacts
GET    /api/eval/runs/summary
GET    /api/r1/observability
GET    /api/help/handbook
GET    /api/help/search
GET    /api/help/diagrams/:id

POST   /api/semantic-assets/validate
POST   /api/semantic-assets/publish
GET    /api/semantic-assets/releases
GET    /api/semantic-assets/releases/export.csv
GET    /api/semantic-assets/releases/:id/status
GET    /api/semantic-assets/releases/export.csv
POST   /api/semantic-assets/export
GET    /api/semantic-assets/exports/:exportId/download
POST   /api/semantic-assets/reindex
POST   /api/semantic-assets/scopes
POST   /api/semantic-assets/check
GET    /api/semantic-assets/operations/:id
POST   /api/semantic-assets/operations/:id/cancel
GET    /api/semantic-assets/operations/:id/report.csv
GET    /api/semantic-assets/plans/:validationId

GET    /api/admin/agents
POST   /api/admin/agents
GET    /api/admin/agents/:userId
PATCH  /api/admin/agents/:userId
DELETE /api/admin/agents/:userId
GET    /api/admin/agents/:userId/effective-permissions
POST   /api/admin/agents/:userId/tokens
DELETE /api/admin/agents/:userId/tokens/:label
GET    /api/admin/roles
GET    /api/admin/roles/:roleId
POST   /api/admin/roles/_preview
POST   /api/admin/roles/preview-row-policy
POST   /api/admin/roles/:roleId/copy
GET    /api/admin/config-audit
GET    /api/admin/config-audit/export.csv
GET    /api/admin/audit
GET    /api/admin/audit/sources
GET    /api/admin/audit/:id/sources
GET    /api/admin/audit/export
GET    /api/admin/audit/export-metadata
GET    /api/admin/audit/export-pack
GET    /api/admin/audit/turns
GET    /api/admin/audit/turns/export
GET    /api/admin/audit/turns/:turnId
POST   /api/admin/audit/conversation-turns/purge
POST   /api/admin/audit/args-summary/scrub
GET    /api/admin/audit/:id/effective-association
GET    /api/admin/audit/association-revisions
POST   /api/admin/audit/association-revisions
GET    /api/admin/audit/export-inquiry-pack
GET    /api/admin/audit/v2/export-metadata
GET    /api/admin/audit/export-v2
GET    /api/admin/audit/export-pack-v2
GET    /api/admin/audit/reconciliation/inquiries/:turnId
GET    /api/admin/audit/reconciliation/usage
GET    /api/admin/audit/reconciliation/export
GET    /api/admin/trace/events
POST   /api/agent-audit/events
GET    /api/admin/mcp-tools
POST   /api/admin/mcp-playground/acl-preview
POST   /api/admin/mcp-playground/live-smoke
GET    /api/admin/mcp-runtime/status
POST   /api/admin/mcp-runtime/canary
POST   /api/admin/mcp-runtime/reload
GET    /api/admin/governance/overview
GET    /api/admin/governance/agents
GET    /api/admin/governance/roles
GET    /api/admin/governance/tokens
GET    /api/admin/governance/denials
GET    /api/admin/governance/risk-review
POST   /api/admin/governance/risk-review/:id/review
GET    /api/admin/governance/release-readiness-package
GET    /api/admin/ui-usage/overview
POST   /api/admin/ui-usage/page-view
GET    /api/admin/ui-usage/catalog-navigation
POST   /api/admin/ui-usage/catalog-navigation-event
GET    /api/ops/call-monitor
GET    /api/admin/governance/overview
GET    /api/admin/governance/agents
GET    /api/admin/governance/roles
GET    /api/admin/governance/tokens
GET    /api/admin/governance/denials
GET    /api/admin/policy-runtime

GET    /api/eval/security-candidates
POST   /api/eval/security-candidates/extract
POST   /api/eval/security-candidates/:id/review
POST   /api/eval/security-candidates/:id/promote/preview
POST   /api/eval/security-candidates/:id/promote

POST /mcp                                      # MCP proxy, port 7879
```

## 3. 端点细节

### `GET /api/project`
返回项目根、连接列表（**剥离 password 值**）、schema 列表，以及 public MCP endpoint runtime 配置。
```jsonc
{ "ok": true, "data": {
  "root": "/Users/forrest/Projects/project-lucy",
  "connections": [{ "id": "mysql-aliyun", "driver": "mysql", "passwordSource": "file", "schemas": ["dataforai"] }],
  "ktxAvailable": true,
  "mcpEndpoint": {
    "url": "https://lucy.example.com/mcp",
    "status": "configured",
    "source": "env",
    "configured": true,
    "diagnostics": []
  }
}}
```

`mcpEndpoint` 字段是 M18 起所有 WebUI 页面渲染和复制 MCP 配置片段的唯一事实源。前端禁止从 `window.location`、`Host` header 或其他浏览器信号推断 endpoint。

| `status` | 含义 | `url` | UI 表现 |
|---|---|---|---|
| `configured` | `LUCY_PUBLIC_MCP_URL` 存在且合法（http/https，可解析） | 配置值 | 正常展示，允许复制 endpoint 与 MCP config；可选带 `MCP_PATH_RECOMMENDED` diagnostic（pathname 不以 `/mcp` 结尾） |
| `fallback` | 未设置 `LUCY_PUBLIC_MCP_URL` | `http://127.0.0.1:7879/mcp`（本地开发默认） | 展示本地默认，附带 `MISSING_PUBLIC_MCP_URL` diagnostic；允许复制供本地 npm 开发，但 **不计** MCP / 部署就绪；onboarding 与 token 页面标明不可用于客户交付 |
| `invalid` | `LUCY_PUBLIC_MCP_URL` 存在但非法（非绝对 URL / 非 http/https） | `null` | 不生成可复制 MCP config；展示 diagnostic 提示修复 runtime 配置 |

`diagnostics` 是诊断数组，元素结构为 `{ code, message }`。常见 code：

- `MISSING_PUBLIC_MCP_URL`
- `INVALID_PUBLIC_MCP_URL`
- `UNSUPPORTED_PUBLIC_MCP_PROTOCOL`
- `MCP_PATH_RECOMMENDED`（仅 informational，status 仍为 `configured`）

后端不会从 `Host` / `X-Forwarded-*` 推断 endpoint；只读取环境变量 `LUCY_PUBLIC_MCP_URL`，未设置时使用 `http://127.0.0.1:7879/mcp` 作为本地开发 fallback。`LUCY_PROXY_HOST` / `LUCY_PROXY_PORT` 控制的是 MCP proxy 的内部监听地址，与 `LUCY_PUBLIC_MCP_URL` 是不同的两个变量。

### `GET /api/sources`
扫描全部 `_schema/*.yaml`，返回逐表目录摘要（供 Catalog）与本地 Schema Manifest 文件摘要。
```jsonc
{ "ok": true, "data": {
  "tables": [{
    "conn": "mysql-aliyun", "schema": "dataforai", "table": "superstore_orders",
    "qualifiedName": "dataforai.superstore_orders",
    "filePath": "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    "columnCount": 8, "hasTableDesc": true, "hasGrain": false,
    "measureCount": 0, "joinCount": 2, "wikiRefCount": 0,
    "completion": "partial", "mtime": "2026-06-15T08:00:00Z",
    "enabled": true,
    "authorizedAgentCount": 3,
    "semanticUpdatedAt": "2026-07-01T10:30:00Z",
    "semanticUpdatedAtSource": "overlay"
  }],
  "manifestSchemas": [{
    "conn": "mysql-aliyun", "schema": "dataforai",
    "filePath": "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    "tableCount": 3, "mtime": "2026-06-15T08:00:00Z"
  }]
}}
```

- `mtime`：该表所在 Schema Manifest 文件的文件修改时间，保留兼容；不要在 UI 中直接命名为“最近更新”。
- `qualifiedName`：Manifest 中声明的物理表名；连接概览用它与 `ktx.yaml enabled_tables` 对齐。
- `enabled`：该表是否出现在对应 Connection 的 `enabled_tables`。语义覆盖 / Catalog 默认范围只统计 `enabled === true`（Spec 104）；本接口仍返回 Manifest 全量。
- `manifestSchemas`：本地实际存在并可解析的 Schema Manifest 文件列表；用于连接概览按第一手文件事实统计 `缺 Manifest 的 Schema` 与 `本地表目录`。
- `authorizedAgentCount`：启用 Agent 中，有效权限包含当前 Source 的 Agent 数量。禁用 Agent 不计入，只返回数量。
- `semanticUpdatedAt`：该表语义资产更新时间，取 Schema Manifest 与表级 semantic overlay 文件修改时间中的较晚者；overlay 不存在时取 Schema Manifest。
- `semanticUpdatedAtSource`：`semanticUpdatedAt` 的来源，取值为 `manifest` 或 `overlay`。

### `GET /api/sources/:conn/:schema/:table`
```jsonc
{ "ok": true, "data": {
  "model": { /* TableModel，见 04-data-model.md */ },
  "rawYaml": "tables:\n  superstore_orders:\n    ...",
  "completion": "partial"
}}
```

### `PUT /api/sources/:conn/:schema/:table`
请求：
```jsonc
{ "patch": { /* TablePatch */ }, "dryRun": true }
```
- `dryRun:true` → 不落盘，返回 `{ diff, proposedYaml }`；
- `dryRun:false` → 经 `fs-safe` 写回，自动 validate，返回 `{ written:true, validation, changedFiles }`。

非法路径 → `403 FORBIDDEN_PATH`；YAML 解析失败 → `422 YAML_PARSE_ERROR`。

### `POST /api/sources/:conn/:schema/:table/import`
导入当前表的 YAML 片段，供表语义资产工作台的 `导入 YAML -> dry-run -> 保存` 主链路使用。

请求：
```jsonc
{ "yaml": "table: dataforai.superstore_orders\n...", "dryRun": true }
```

- `yaml` 可以是单表 YAML 片段，也可以是包含 `tables.<table>` 的 Schema YAML。
- `dryRun:true`（默认）→ 不落盘，返回 `{ diff, proposedYaml, files }`；
- `dryRun:false` → 只替换当前 `{conn}/{schema}/{table}` 对应的 Schema Manifest 节点，经 `fs-safe` 写回并自动 validate，返回 `{ written:true, validation, changedFiles }`。

约束：

- 该接口只处理当前表在 Schema Manifest 中的节点；不导入、不覆盖其他表。
- `grain` / `measures` / `segments` 等表级 semantic overlay 完整导入仍走后续专用契约；当前接口不得猜测 overlay 归属。
- 空 YAML → `400 INVALID_IMPORT_YAML`。
- 导入 YAML 不包含当前表 → `404 SOURCE_NOT_FOUND`。
- YAML 解析失败 → `422 YAML_PARSE_ERROR`。

### `POST /api/sources/:conn/:schema/:table/validate`
```jsonc
{ "ok": true, "data": { "ok": true, "exitCode": 0, "stdout": "...", "issues": [] } }
```
后端调用约定：`execFile('ktx', ['sl', 'validate', table, '--connection-id', conn], { cwd: projectRoot })`。
`table` 必须是 `ktx sl --connection-id <conn>` 列表中的短 `name`；不要传 `schema.table` 或 `conn/table`。
若同一 connection 下出现短名冲突，返回 `409 BAD_REQUEST` 并提示人工处理。

CLI 不可用 → `KTX_CLI_ERROR`（区别于 `VALIDATION_FAILED`）。

### Table YAML 版本记录与恢复（M54）

`PUT /api/sources/:conn/:schema/:table` 和 `POST /api/sources/:conn/:schema/:table/import` 在 `dryRun:false` 落盘后，会先把写完后的 YAML 快照追加到 `.ktx-ui/table-yaml-history/`，再返回新版快照摘要。保留最近 5 个版本，按 `versionId` 倒序，最新写入的版本即 cover current state。

> 历史目录故意不放在 `semantic-layer/` 下：KTX `admin reindex` 会把 `semantic-layer/` 顶层目录当成 connection id，`.lucy-history` 会触发 `Unsafe connection id`。启动 validate/reindex 前若仍发现遗留的 `semantic-layer/.lucy-history`，会自动迁到 `.ktx-ui/table-yaml-history/`。

`GET /api/sources/:conn/:schema/:table/versions` 返回最近 5 个版本的摘要列表：

```jsonc
{ "ok": true, "data": {
  "key": "mysql-aliyun/dataforai/superstore_orders",
  "retentionLimit": 5,
  "versions": [
    { "versionId": "20260803T...-abcd1234", "key": "...", "createdAt": "2026-08-03T...",
      "operation": "save", "contentHash": "sha256:...",
      "affectedFiles": ["semantic-layer/mysql-aliyun/_schema/dataforai.yaml"] }
  ]
}}
```

`operation` 取值：
- `save`：来自 `PUT .../sources/...`，可附 `restoredFromVersionId` 表示由恢复动作产生。
- `import`：来自 `POST .../sources/.../import`，可附 `sourceFileName`（上传文件名）。
- `restore`：来自 `POST .../versions/:versionId/restore`，必附 `restoredFromVersionId`。

`GET /api/sources/:conn/:schema/:table/versions/:versionId` 返回该版本的 `rawYaml` 全量文本和与当前默认 YAML 的 diff（`diffFromCurrent`）。

`POST /api/sources/:conn/:schema/:table/versions/:versionId/restore/preview` 预览恢复效果（diff vs. 当前），不落盘。

`POST /api/sources/:conn/:schema/:table/versions/:versionId/restore` 把指定版本作为新的 save 写入：返回 `key` / `restoredFromVersionId` / `rawYaml` / `diff`，并把这次写入本身登记进历史（`operation:"restore"`, `restoredFromVersionId` 指向被恢复的那个版本）。

错误码：`VERSION_NOT_FOUND` `SOURCE_NOT_FOUND` `INVALID_VERSION`。

### `GET /api/wiki` / `GET /api/wiki/:key` / `PUT /api/wiki/:key`
- `key` 为相对 `wiki/` 的路径（如 `global/revenue.md`），服务端经 `fs-safe` 校验。
- frontmatter 字段：`summary` `tags` `sl_refs` `refs` `usage_mode` + 正文 markdown。
- `PUT` 同样支持 `dryRun` 预览 diff。

`GET /api/wiki/:key/raw` 以 `text/markdown; charset=utf-8` 返回原始 Markdown，并带 `Content-Disposition` 下载文件名，供业务 Wiki 编辑器下载当前页面。

`POST /api/wiki/upload/preview` 预览 Markdown 上传，不落盘；`POST /api/wiki/upload/commit` 在预览通过后写入目标 Wiki 页面并登记本次写入记录。

请求：

```jsonc
{ "key": "global/revenue.md", "markdown": "# Revenue", "mode": "create" }
```

响应：

```jsonc
{ "ok": true, "data": { "key": "global/revenue.md", "filePath": "wiki/global/revenue.md", "diff": "...", "frontmatter": {}, "content": "# Revenue" }}
```

错误码：`BAD_REQUEST` `FORBIDDEN_PATH` `WIKI_NOT_FOUND` `WIKI_FRONTMATTER_UNSUPPORTED`。

文档属性（frontmatter）仅支持 YAML（V-08，Spec §4.6）：首行 `---` 后的语言标记去空白并转小写后，只有为空或 `yaml` 才会被解析；`js`、`javascript`、`json` 等其它标记（含大小写与空格变体）一律拒绝，服务端不执行、不写盘。
- 上传预览 / 上传提交 / `PUT` 保存 / 版本恢复 / 移动：`400 WIKI_FRONTMATTER_UNSUPPORTED`，文案「仅支持 YAML 格式的文档属性。」
- `GET`（读取已在磁盘上的非法文件）：`422 WIKI_FRONTMATTER_UNSUPPORTED`，需先修复该文档。

### Wiki 目录治理与版本记录（M51 / M53 / M56）

业务 Wiki 顶层目录是一等资源：空目录持久化在 `wiki/.lucy-directories.json`，删除 / 重建不走目录是否存在 md 文件的副作用判断。

`GET /api/wiki/directories` 返回当前租户业务 Wiki 的目录树与每条目录的元数据（创建时间、文档数、是否为空）。

`POST /api/wiki/directories` 创建顶层目录。请求：

```jsonc
{ "path": "global/finance", "mode": "create" }
```

`mode` 取值：`create`（不存在则创建，存在返回 `409 WIKI_DIRECTORY_EXISTS`）、`create_or_get`（不存在则创建，存在则直接返回已有的目录）。

`DELETE /api/wiki/directories/:path` 删除目录。目录非空（仍残留文档） → `409 WIKI_DIRECTORY_NOT_EMPTY`；目录不存在 → `404 WIKI_DIRECTORY_NOT_FOUND`。

`DELETE /api/wiki/:key` 删除已保存 Markdown 文档（Spec 118）。成功返回 `{ key, deleted: true, filePath }`，并清理该 key 的版本历史索引与快照。文档不存在 → `404 WIKI_NOT_FOUND`。

`POST /api/wiki/directories/rename/preview` 预览同父级目录重命名（只改最后一段）。请求：

```json
{ "sourcePath": "m56-msbye4tr-top", "newName": "playbooks" }
```

返回源/目标路径、将改写的文档与子目录列表、`conflicts` / `warnings`。

`POST /api/wiki/directories/rename` 提交重命名：物理目录树改名、前缀文档 key 与版本历史跟随、`wiki/.lucy-directories.json` 同步。目标冲突 → `409 WIKI_DIRECTORY_CONFLICT`；根桶 → `400 WIKI_DIRECTORY_RENAME_ROOT`；源不存在 → `404 WIKI_DIRECTORY_NOT_FOUND`。

`POST /api/wiki/:key/move/preview` 预览把 `key` 对应文档移动到 `targetPath`（相对 `wiki/` 的新路径），返回 diff。

`POST /api/wiki/:key/move` 实际移动文档；目录变更同步写入 `wiki/.lucy-directories.json`。目标路径已被占用 → `409 WIKI_DOCUMENT_EXISTS`；路径非法 → `400 BAD_REQUEST`。

Wiki Markdown 版本记录与 Table YAML 版本记录对齐：保留最近 5 个版本，存放在 `wiki/.lucy-history/`。

`GET /api/wiki/:key/versions` 返回最近 5 个版本摘要（`operation` 取 `save | upload | restore`）。

`GET /api/wiki/:key/versions/:versionId` 返回该版本 `rawMarkdown` 与 `diffFromCurrent`。

`POST /api/wiki/:key/versions/:versionId/restore/preview` 预览恢复，不落盘。

`POST /api/wiki/:key/versions/:versionId/restore` 把指定版本作为新 save 写入，返回 `key` / `restoredFromVersionId` / `rawMarkdown` / `diff`，并把这次写入本身登记进历史（`operation:"restore"`, `restoredFromVersionId` 指向被恢复的那个版本）。

错误码：`WIKI_DOCUMENT_NOT_FOUND` `WIKI_VERSION_NOT_FOUND` `WIKI_DIRECTORY_EXISTS` `WIKI_DIRECTORY_NOT_EMPTY` `WIKI_DIRECTORY_NOT_FOUND` `WIKI_DOCUMENT_EXISTS` `FORBIDDEN_PATH` `BAD_REQUEST`。

### `GET /api/diff`
返回白名单目录（`semantic-layer/`、`wiki/`、`.ktx-ui/`）下的 `git diff`（name-status + 可选 patch）。非 git 仓库时回退会话写入记录。

### `POST /api/validate-changed`
对本次会话改动涉及的 source 批量 validate，返回逐表结果数组。

### `GET/PUT /api/joins/candidates`
读写 `.ktx-ui/join-candidates.json`（candidate/rejected join），不写正式 YAML（ADR-02 写入策略）。

## 4. 当前扩展端点

### 数据库连接

`GET /api/connections` 返回 `ConnectionInfo[]`，字段见 `04-data-model.md`。

`POST /api/connections`（Spec 124 Phase A）新建连接配置：默认 `dryRun:true`；确认写入时创建 `.ktx/secrets/<id>-password`（0600，拒绝覆盖），并在 `ktx.yaml` 追加 `connections.<id>`（`password` 仅 `file:` 引用）与 `setup.database_connection_ids`。写入后执行 `ktx connection test`；失败则回滚 yaml 与 secret。响应与审计 diff **永不包含明文密码**。通用 `fs-safe` 对 `.ktx/secrets/**` 仍 DENY；仅专用写通道可创建约定文件名。本 Phase **无 UI**。

`POST /api/connections/:connId/remove`（Spec 127）删除连接配置：默认 `dryRun:true`；确认写入时删除 `connections.<id>` 并从 `setup.database_connection_ids` prune。可选 `deleteSecret`（仅约定 `.ktx/secrets/<id>-password`）与 `deleteAssets`（`semantic-layer/<id>/` 下 YAML）。**不**改 `access.yaml`、**不**删 Wiki、**不**触碰物理库。响应与审计 diff 脱敏。

`GET /api/connections/:connId/live-schemas`（Spec 107）经 `ktx sql --json` 只读聚合账号可见 Schema 及 BASE TABLE 数量。Query `refresh=1` 跳过进程内 TTL（默认 10 分钟）。成功 / 连通失败均返回 HTTP 200 + `data.status`（与 connection test 同构，便于分连接 UI）；连接不存在返回 404。字段见 Spec 107 §6。

`POST /api/connections/:connId/schema-structure` 预览指定 schema 的物理表结构，请求体 `{ schema }`；缺 `schema` 返回 `BAD_REQUEST`。`GET /api/connections/:connectionId/import-scope`（Spec 183）只读返回已发现物理表的导入范围分布。Spec 190 起该端点新增 `discoverySource`（`manual` / `continuous` / `none`）：未传 `discovered` 时改读 `.ktx-ui/live-table-snapshots.json` 中当前代次的成功快照，**不**为填满 `discovered` 而连库。

`GET /api/connections/:connId/live-tables`（Spec 190）只读返回单个 Schema 的库内表清单（表名、表类型、列数、注释）。Query：`schema`（**必填**，标识符白名单）、`refresh=1`（绕过面向人工的 10 分钟 TTL）、`purpose`（`manual` / `automatic`，两套缓存互不命中）。成功与失败均返回 HTTP 200 + `data.status`；失败时 `data.reason` 取封闭词表（`PROTOCOL_UNSUPPORTED` / `TABLE_LIST_UNSUPPORTED` / `CONNECTION_FAILED` / `AUTH_FAILED` / `SCHEMA_NOT_FOUND` / `SCHEMA_NOT_VISIBLE` / `TABLE_LIST_TOO_LARGE` / `QUERY_FAILED` / `PROBE_QUEUE_FULL` / `PROBE_QUEUE_TIMEOUT` / `GENERATION_INVALIDATED` / `PROVIDER_UNAVAILABLE`）。缺 `schema` 或 schema 非法返回 400，连接不存在返回 404。

`GET /api/connections/:connId/table-diff`（Spec 190）只读返回**当前对账状态**（按最新成功快照 + Schema Manifest + `enabled_tables` 每次重算，不累积）与**表清单差异**（本轮库 vs 上一份快照）。Query：`schema`（可选，缺省=全部 Schema）、`includeEvents=1`（附带变更事件历史）。连接不存在返回 404 `CONNECTION_NOT_FOUND`；Manifest 与库表的 Schema / 表名比较大小写不敏感（与 Spec 183 的 `normalizeRef` 同口径）。

`GET /api/connections/:connId/table-structure-diff`（Spec 190）按需深查列级差异，Query：`schema`（必填）、`tables`（必填，逗号分隔，单次最多 20 张）。基线为本地 Schema Manifest 的列定义，逐表独立失败（`ok` / `error` / `not_in_library`）。每次调用都真实只读查库，不读快照；库表名比较大小写不敏感。

`GET /api/connections/:connId/discovery`（Spec 190）返回持续感知状态：连接级聚合 `ok` / `partial` / `error` / `paused` / `never_run`、每 Schema 的最近状态与原因、差异计数。连接不存在返回 404 `CONNECTION_NOT_FOUND`。`PUT /api/connections/:connId/discovery` 请求体 `{ enabled, intervalMs }`，**owner 限定**，`enabled` 必须是布尔值（缺失或类型错返回 400，配置不变），`intervalMs` 取白名单（5 分钟 / 15 分钟 / 30 分钟 / 1 小时 / 6 小时 / 24 小时，默认 1 小时），越界返回 400 且配置不变；写入后重置该连接的失败计数与暂停态。

`GET /api/connections/:connId/tables` 从 `semantic-layer/<connId>/_schema/*.yaml` 返回已扫描表名：

```jsonc
{ "ok": true, "data": { "tables": ["dataforai.superstore_orders"] } }
```

`PUT /api/connections/:connId/enabled-tables` 默认 `dryRun:true`。

**写入门禁（Spec 116）：**

- `enabledTables` 项必须是合法 `schema.table`（拒绝空串、路径字符、重复项）。
- **新增**到列表中的表必须出现在本地已扫描 Manifest；否则 `400 TABLE_NOT_SCANNED`。
- **已存在**于当前 `ktx.yaml` `enabled_tables`、但本地 Manifest 已缺失的表（无效启用）允许暂时保留；响应 `warnings[]` 中给出 `ENABLED_TABLE_NOT_SCANNED`（不阻塞保存）。
- 空列表、仅删除（含移出无效启用）始终允许。

请求：

```jsonc
{ "dryRun": true, "enabledTables": ["dataforai.superstore_orders"] }
```

dryRun 响应：

```jsonc
{ "ok": true, "data": {
  "diff": "...",
  "proposedYaml": "...",
  "oldEnabledTables": [],
  "newEnabledTables": ["dataforai.superstore_orders"],
  "warnings": []
}}
```

保留无效启用时 `warnings` 示例：

```jsonc
{ "ok": true, "data": {
  "diff": "...",
  "proposedYaml": "...",
  "oldEnabledTables": ["demo_finance.ads_finance_revenue_day"],
  "newEnabledTables": ["demo_finance.ads_finance_revenue_day", "ai.ksc_income_statement_detail"],
  "warnings": [{
    "code": "ENABLED_TABLE_NOT_SCANNED",
    "table": "demo_finance.ads_finance_revenue_day",
    "message": "Table 'demo_finance.ads_finance_revenue_day' is enabled but not present in scanned semantic-layer schema"
  }]
}}
```

`dryRun:false` 写 `ktx.yaml` 并记录 `config_change_log`：

```jsonc
{ "ok": true, "data": { "written": true, "auditId": 1, "oldEnabledTables": [], "newEnabledTables": ["dataforai.superstore_orders"], "warnings": [] }}
```

错误码：`CONNECTION_NOT_FOUND` `INVALID_ENABLED_TABLE` `DUPLICATE_ENABLED_TABLE` `TABLE_NOT_SCANNED`。

`POST /api/connections/:connId/test` 调用连接测试；`POST /api/connections/:connId/ingest` 触发 schema 扫描。两者返回 `{ exitCode, stdout, stderr }` 风格结果。

`POST /api/connections/:connId/schemas` 只在已有 connection 下登记 schema 元数据，默认 `dryRun:true`，写入目标是 `ktx.yaml`，不创建物理数据库连接、不触发扫描、不写语义层 overlay。

`GET /api/connections/ingest-runs` 返回历史 ingest / catalog reload 记录 sidecar，用于兼容旧入口与运维状态面板。

### Catalog Reload 与 Manifest 上传

`POST /api/catalog/reload` 触发静态目录重载，生成 catalog reload 运行记录；`GET /api/catalog/reloads` 返回最近重载历史。

`POST /api/catalog/assets/validate` 校验待上传 Schema Manifest。请求使用规范字段 `assetKind: "schema_manifest"`；兼容旧客户端 `assetType: "schemaManifest"`。其他 asset kind 必须走对应语义资产入口，不能混用。

`POST /api/catalog/assets/upload` 在校验通过后写入 `semantic-layer/<connection>/_schema/<schema>.yaml`，目标路径由系统根据 connection/schema 计算，不接受客户端任意路径。

容量契约（2026-10-30 修订）：上述 Manifest 校验、上传接口与 `POST /api/semantic-assets/validate` 的 HTTP 请求体上限为 32 MiB；单 YAML 文件上限为 8 MiB，按 UTF-8 字节数计算。超出请求体上限返回 HTTP 413、`FST_ERR_CTP_BODY_TOO_LARGE` 及中文说明；目录 Manifest 文件超限返回既有 `FILE_TOO_LARGE` 校验错误。上传、导出与维护包导入统一引用 `server/semantic-limits.ts`，包总量及数量上限不变。只传引用的发布、批量校验等接口维持默认 HTTP 上限。

`GET /api/catalog/assets/uploads` 返回 Schema Manifest 上传审计记录。

`GET /api/catalog/assets/schema-manifest` 返回当前 connection + schema 的 Schema Manifest 内容（用于资产工作台读取物理表结构）。`conn` / `schema` 走 query string；目标路径服务端按 `semantic-layer/<conn>/_schema/<schema>.yaml` 解析，不接受客户端任意路径。Manifest 缺失 → `404 SCHEMA_MANIFEST_NOT_FOUND`。

### 语义资产发布与导出

`POST /api/semantic-assets/validate` 校验语义资产包或 semantic overlay，执行 secret hard block、结构校验和发布前 gate。

`POST /api/semantic-assets/publish` 发布通过校验的语义资产，写入 release 记录；`GET /api/semantic-assets/releases` 查询 release 列表；`GET /api/semantic-assets/releases/:id/status` 查询单个 release 状态。

`POST /api/semantic-assets/export` 生成语义资产导出任务；`GET /api/semantic-assets/exports/:exportId/download` 下载指定导出产物。

`POST /api/semantic-assets/reindex` 手动触发 semantic-layer 索引重建，并把结果写入发布历史，供发布工作台和历史页展示。

### 语义资产批量维护（L25-11）

`POST /api/semantic-assets/scopes` 把一组**完整表身份**（`connectionId` / `schema` / `table` 三元组）解析成不可变的范围快照：服务端按模型关系解析目标、派生只读依赖闭包并记录基线摘要。客户端不提供任何落盘路径；歧义或缺失身份整批阻断。快照绑定操作者与实例，30 分钟过期。

`POST /api/semantic-assets/check` 对一个范围快照启动**独立批量校验**（4 并发、单表 30 秒、任务 10 分钟），任务在后台执行、报告持久化；返回 `operationId`。`GET /api/semantic-assets/operations/:id` 轮询任务状态与逐表 verdict（`passed` / `failed` / `not_run` / `stale`），**不会重跑检查**；`POST /api/semantic-assets/operations/:id/cancel` 取消运行中的任务（已完成的检查结果保留）；`GET /api/semantic-assets/operations/:id/report.csv` 下载 CSV 报告（公式注入已转义）。

`POST /api/semantic-assets/export` 在 `packageKind=semantic-maintenance-package/v1` 且带 `scopeId` 时生成**语义维护包**：可编辑覆盖层 + 只读 Schema Manifest 上下文，服务端同时留存导出基线记录（7 天有效）。`POST /api/semantic-assets/validate` 上传该维护包时按服务端原记录逐项核验（entry 全集、role、主／共享身份、路径、target/base/baseline 摘要），只读内容被改、身份被改绑或跨实例一律整包拒绝；未改动的包导回为「无变化」，不创建发布、不索引其他待处理变更。

`GET /api/semantic-assets/plans/:validationId` 返回该批次的**完整计划**：本次导入候选 + 既有待同步磁盘变更 + 精确覆盖集合 + `planDigest`。索引是整批同步，不能按 Catalog 勾选伪装为局部生效。

`POST /api/semantic-assets/publish` 接受 `validationId`、`planDigest`、精确覆盖集合与幂等键。服务端在发布窗口内重建完整计划并重算摘要：目标或依赖在预览后被改动、覆盖集合变化、或摘要不匹配，一律 `409 SEMANTIC_PLAN_DIGEST_MISMATCH`，必须重新预览确认。同一幂等键 + 同一计划返回同一个 release 且不重复写盘或索引；同一幂等键 + 不同计划返回 `409 SEMANTIC_IDEMPOTENCY_CONFLICT`。

请求：

```jsonc
{ "force": false }
```

响应：

```jsonc
{ "ok": true, "data": { "force": false, "reindex": { "ok": true, "exitCode": 0, "stdout": "...", "stderr": "" }, "release": { "id": "manual-reindex-..." } }}
```

若 `.ktx-ui/semantic-publish.lock` 存在，返回 `409 REINDEX_IN_PROGRESS`。

### Eval / 质量评测

`GET /api/eval/domains` 返回 domain 列表与最近运行摘要；`GET /api/eval/domains/:domain` 返回单个 domain。

`GET /api/eval/cases/:domain` / `GET /api/eval/cases/:domain/:caseId` 读取 eval case。`POST /api/eval/cases/:domain` 新增 case；`PUT /api/eval/cases/:domain/:caseId` 更新 case，默认 dryRun；`DELETE` 删除 case。`POST /api/eval/cases/:domain/:caseId/confirm-review` 将该 case 的 `review_status` 置为 `active`，并把当前 `sourceMapVersion` 记入 `semantic_version_seen`（语义版本变更后需重新确认）。

`POST /api/eval/suites/import` 导入 Eval Suite YAML，默认 `dryRun:true`；`GET /api/eval/suites/:domain/download` 以 YAML 附件下载当前 domain 的 canonical suite，并在响应头返回 suite id/hash 与 runner command；`POST /api/eval/results/import` 导入离线 Result JSON，默认 `dryRun:true`，可选归档本地变体。

Suite 导入请求：

```jsonc
{ "filename": "kx_financial-eval-suite.yaml", "content": "metadata:\n  domain: kx_financial\n", "dryRun": true }
```

Result 导入请求：

```jsonc
{ "content": "{ \"run_id\": \"...\" }", "dryRun": true, "archiveLocalVariant": false }
```

常见错误码：`VALIDATION_FAILED` `RESULT_VALIDATION_FAILED` `BAD_REQUEST`。

`POST /api/eval/runs` 创建运行：

```jsonc
{ "domain": "superstore", "caseSelection": { "mode": "all" }, "ktxMcpUrl": "http://127.0.0.1:7879/mcp", "triggeredBy": "local-admin" }
```

运行查询：

- `GET /api/eval/runs`
- `GET /api/eval/runs/:runId`
- `GET /api/eval/runs/:runId/results`
- `GET /api/eval/runs/:runId/artifact?type=json|md`
- `GET /api/eval/runs/:runId/compare?with=<runId>`
- `GET /api/eval/runs/:runId/stream`（SSE）
- `POST /api/eval/runs/:runId/cancel`

Monitor：

- `GET /api/eval/monitor/trend?domain=&days=`
- `GET /api/eval/monitor/top-failures?domain=&days=&limit=`
- `GET /api/eval/monitor/drift-distribution?domain=&days=`
- `GET/PUT /api/eval/monitor/config`
- `GET/PUT /api/eval/monitor/threshold`
- `GET /api/eval/monitor/field?domain=&days=`（按 domain 绑定角色统计 access_log 调用 / 错误 / 拒绝，按 client family 分桶）

Field Questions：

- `GET /api/eval/field-questions`（返回 `field_question` 表全部记录，按 `updated_at` 倒序）
- `POST /api/eval/field-questions/extract`（请求体为现场提问包；抽取分组后落库，拒绝抽取时返回 `422`，成功返回 `data.inserted`）
- `POST /api/eval/field-questions/:id/promote`（返回用例草稿 `data.draft`；⚠️ 当前只返回内存草稿，**不写入 eval case**，用例仍需人工落地）

常见错误码：`RUNNER_BUSY` `RUN_NOT_FOUND` `RUNNER_PRECHECK_FAILED` `NO_CASES_SELECTED` `UNSUPPORTED_SELECTION_MODE`。

### R1 Observability

`GET /api/r1/observability?hours=24&slowMs=30000` 返回 Lucy R1 受控数据服务层的最小排障信号。该端点只读，不创建新的状态；数据来自 audit sqlite、eval runs sqlite 和 `LUCY_R1_HERMES_ACCURACY_REPORT` 指向的外部 Hermes 准确率报告。

响应摘要：

```jsonc
{ "ok": true, "data": {
  "generatedAt": "2026-07-02T00:00:00.000Z",
  "audit": {
    "traffic": {
      "businessCalls": 20,
      "okCalls": 18,
      "errorCalls": 1,
      "deniedCalls": 1,
      "successRate": 0.9,
      "errorRate": 0.05,
      "deniedRate": 0.05
    },
    "latency": { "p50Ms": 120, "p95Ms": 2000, "slowCalls": 1, "slowQueries": [] },
    "denials": [
      { "reason": "table_denied", "count": 1 },
      { "reason": "query_concurrency_exceeded", "count": 1 }
    ],
    "sourceErrors": [{ "source": "doris-r1.mart.ceo_metric_snapshot", "outcome": "error", "count": 1 }],
    "usage": { "tools": [], "roles": [], "tokens": [] }
  },
  "eval": {
    "latestRun": { "domain": "r1_doris_smoke", "passRate": 0.95 },
    "recent": { "runs": 3, "passRate": 0.96 }
  },
  "hermesQa": {
    "status": "passed",
    "agent": "hermes",
    "target": "lucy-mcp-proxy",
    "generatedBy": "scripts/smoke/lucy-r1-hermes-report.mjs",
    "dataset": "r1_doris_benchmark",
    "caseDataset": "r1_doris_benchmark",
    "accuracy": 0.96,
    "coreMetricAccuracy": 1,
    "securityPassRate": 1,
    "totalQuestions": 30,
    "minQuestions": 30,
    "tracedQuestions": 30,
    "uniqueTraces": 30,
    "lucyControlledQuestions": 30,
    "lucyMetadataQuestions": 29,
    "lucyRejectionQuestions": 1,
    "agentIdentityGatePassed": true,
    "targetIdentityGatePassed": true,
    "datasetIdentityGatePassed": true,
    "caseDatasetIdentityGatePassed": true,
    "perCaseIdentityGatePassed": true,
    "traceUniquenessGatePassed": true,
    "lucyControlledEvidenceGatePassed": true,
    "noDuplicateCasesGatePassed": true,
    "generatedByGatePassed": true,
    "threshold": 0.95
  },
  "releaseSignals": {
    "trafficObservable": true,
    "deniedReasonsObservable": true,
    "sourceErrorsObservable": true,
    "evalObservable": true,
    "hermesQuestionCountGatePassed": true,
    "hermesAccuracyGatePassed": true,
    "hermesCoreMetricGatePassed": true,
    "hermesSecurityGatePassed": true,
    "hermesTraceCoverageGatePassed": true,
    "hermesTraceUniquenessGatePassed": true,
    "hermesNoDuplicateCasesGatePassed": true,
    "hermesEvidenceCompletenessGatePassed": true,
    "hermesLucyControlledEvidenceGatePassed": true,
    "hermesPerCaseIdentityGatePassed": true,
    "hermesReportGatePassed": true
  }
}}
```

用途：回答 R1 runbook 中的核心问题：业务请求量、成功/错误/拒绝率、p50/p95、慢查询、source 失败分布、token/role 使用、Eval pass rate、Hermes QA accuracy，以及 Hermes 逐题结果是否具备 Lucy `_meta.lucy` provenance 或 policy/guardrail 受控拒绝证据。`trafficObservable` 只代表 `businessCalls > 0`，不把 MCP 握手或 `tools/list` 单独算作业务流量；`evalObservable` 代表最新 `r1_*` eval 已成功且 `passRate >= 0.95`，不只是存在 eval run。

### Help

`GET /api/help/handbook` 返回系统手册内容和元数据，供 WebUI 帮助入口展示。该端点只读，不暴露 secret 文件。

`GET /api/help/search` 在手册正文中做只读检索，返回命中章节的 id、标题与片段。

`GET /api/help/diagrams/:id` 返回一张产品架构图（HTML）。`:id` 只能取已登记的两个值之一：`lucy-architecture-diagram`（产品架构图）与 `lucy-docs-flows`（文档流转图）。未知 id 返回 404 `ERR_HELP_DIAGRAM_NOT_FOUND`；路径穿越尝试同样返回 404。该端点只读。

### Admin / 访问治理

Agent 列表与详情：

- `GET /api/admin/agents`
- `GET /api/admin/agents/:userId`
- `GET /api/admin/agents/:userId/effective-permissions`

写入路径是 Role Set（Spec 168）：

- `POST /api/admin/agents`：必须传 `agent.roles`（至少一个正式角色），拒绝 `agent.allow`。只传 `agent.role` 时当成单元素数组。参考模板不可直接绑定。
- `PATCH /api/admin/agents/:userId`：允许 `name`、`note`、`enabled`、`roles`、`constraints`。只传 `patch.role` 时当成单元素数组。写入角色集合时落盘删除 `role`。
- `GET` 返回解析后的 `roles`。恰好一个角色时附带 `role`。`role` 与 `roles` 同时存在于磁盘时返回 `roleResolutionError`。
- 角色变更的 dryRun 返回服务端 `effectivePermissions`。
- `DELETE /api/admin/agents/:userId`：删除 agent 前先撤销 token。

新建请求：

```jsonc
{ "dryRun": true, "agent": { "id": "wangwu", "name": "王五", "note": "市场部分析助理", "roles": ["kx_readonly"] }}
```

PATCH 请求：

```jsonc
{ "dryRun": true, "version": "mtime-hash", "patch": { "roles": ["kx_readonly", "analyst"], "enabled": true }}
```

拒绝：

- `agent.allow` / `patch.allow` → `LEGACY_ALLOW_READONLY`
- 缺角色，或空 `roles` 且没有旧 ACL → `ROLE_REQUIRED`
- 同时传 `role` 与 `roles` → `ROLE_AND_ROLES`
- 无效 role → `INVALID_ROLE`
- 参考模板 → `REFERENCE_TEMPLATE_NOT_ASSIGNABLE`
- 启用 legacy wildcard agent 且未分配 role → `LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`

Token：

- `POST /api/admin/agents/:userId/tokens` 只在响应中返回一次明文 token，yaml/audit 只保存 hash。
- `DELETE /api/admin/agents/:userId/tokens/:label` 先写 `revoked_tokens`，再更新 yaml。

Roles：

- `GET /api/admin/roles?includeTemplates=true` 返回 yaml role 与内置模板合并后的列表、工具、连接、展开 source 数与 warnings；返回项含 `source: "yaml" | "template"`，id 冲突时 yaml role 优先。`includeTemplates=false` 时只返回 yaml role。
- `GET /api/admin/roles/:roleId` 返回单个 role 详情。
- `POST /api/admin/roles/_preview` dryRun 预览 role 写入结果和权限展开。
- `POST /api/admin/roles/:roleId/copy` 基于已有 role 复制新 role，默认 dryRun。
- `GET /api/admin/agents/:userId/effective-permissions` 返回 role 展开后的 `tools`、`connections`、`sources`、`snapshotHash`、`sourceMapVersion`。

Audit：

- `GET /api/admin/config-audit`
- `GET /api/admin/config-audit/export.csv`
- `GET /api/admin/audit`
- `GET /api/admin/audit/sources`
- `GET /api/admin/audit/:id/sources`
- `GET /api/admin/audit/export`
- `GET /api/admin/audit/export-metadata`
- `GET /api/admin/audit/export-pack`
- `GET /api/admin/audit/turns`
- `GET /api/admin/audit/turns/export`
- `GET /api/admin/audit/turns/:turnId`
- `POST /api/admin/audit/conversation-turns/purge`
- `POST /api/admin/audit/args-summary/scrub`
- `GET /api/admin/audit/:id/effective-association`
- `GET /api/admin/audit/association-revisions`
- `POST /api/admin/audit/association-revisions`
- `GET /api/admin/audit/export-inquiry-pack`
- `GET /api/admin/audit/v2/export-metadata`
- `POST /api/agent-audit/events`（受控客户端 observation 上报；凭据取自 `X-Agent-Audit-Token` 头并由服务端解析，不依赖 admin session；缺失或无效返回 `401 CREDENTIAL_INVALID`）
- `GET /api/admin/mcp-tools`

`GET /api/admin/config-audit` 查询 `config_change_log`，用于追踪 WebUI 对 `ktx.yaml`、`webui/config/access.yaml` 等治理配置的写入记录。

Query：

- `targetId`：按目标 ID 精确过滤，例如 agent id 或 connection id。
- `filePath`：按文件路径模糊过滤。
- `limit`：默认 `50`，最大 `500`。
- `offset`：默认 `0`。

响应：

```jsonc
{ "ok": true, "data": {
  "total": 1,
  "actorMode": "single_local_admin",
  "actorNotice": "当前为单管理员模式，actor=local-admin 仅表示本机管理入口，不具备多人问责语义。",
  "entries": [{
    "id": 1,
    "ts": "2026-06-21T10:00:00.000Z",
    "actor": "local-admin",
    "sessionId": "session-1",
    "filePath": "webui/config/access.yaml",
    "changeType": "agent_patch",
    "targetId": "workhorse",
    "oldSummary": {},
    "newSummary": {},
    "diff": "...",
    "requestId": "req-1"
  }]
}}
```

`GET /api/admin/config-audit/export.csv` 使用与 `/api/admin/config-audit` 相同的 `targetId` / `filePath` 过滤条件导出 CSV；响应带 UTF-8 BOM 与 `Content-Disposition: attachment; filename="config-audit-YYYYMMDD.csv"`。

`GET /api/admin/audit/sources` 从访问日志中聚合被 MCP tool 触达的表，供审计来源筛选和治理面板使用。协议类工具调用不计入统计。

Lucy v0.25 / P0-4 §3.4：表以**完整身份** `连接.Schema.表` 标识。同名表在不同连接上**不合并**——两个连接可以各自持有同一个 `Schema.表`。有来源记录（`access_log_sources`）的调用按其真实连接计数；没有来源记录的历史调用归入显式的 `unknown` 连接，不编造连接名。

响应：

```jsonc
{ "ok": true, "data": {
  "connections": [{ "connection": "conn_a", "calls": 3 }],
  "schemas": [{ "schema": "dataforai", "calls": 3 }],
  "topTables": [{ "table": "conn_a.dataforai.superstore_orders", "calls": 3, "denied": 1 }],
  "deniedTables": [{ "table": "conn_a.dataforai.superstore_orders", "calls": 3, "denied": 1 }]
}}
```

`GET /api/admin/audit/:id/sources` 返回单条 access log 解析出的来源表明细。`:id` 为正整数 `access_log.id`；无来源记录时返回空数组，非法 id 返回 `400`。

响应：

```jsonc
{ "ok": true, "data": {
  "accessLogId": 1,
  "sources": [{
    "id": 1,
    "ts": "2026-06-29T10:00:00.000Z",
    "userId": "workhorse",
    "tool": "sl_read_source",
    "connectionId": "mysql-aliyun",
    "schemaName": "dataforai",
    "sourceName": "superstore_orders",
    "physicalTable": "dataforai.superstore_orders",
    "extractionMethod": "semantic-layer",
    "confidence": "high",
    "createdAt": "2026-06-29T10:00:00.000Z"
  }]
}}
```

`GET /api/admin/audit` 查询 MCP access log；支持按 user、tool、outcome、时间范围、tableSearch、sessionId、turnId、platform 过滤。默认不包含协议类工具调用；传 `includeProtocol=true` 可包含 `tools/list`、`initialize`、`notifications/initialized`。

## Lucy v0.25 新增端点

### 行级策略预览（只读）

`POST /api/admin/roles/preview-row-policy`

在不落盘的前提下预览行级策略草稿的**最终行约束**。请求体含 `roleId` 与 `tables`；响应给出每个表的预览、字段目录装载状态与候选摘要。预览走与运行时**同一条编译路径**，并把 Agent 个人行限制一并纳入。

- 只读端点，**不进入发布协调器**，不写任何配置或审计终态。
- 响应含 `candidateDigest`（候选摘要）与 `basePolicyVersion`（基线版本），供确认前比对。
- 目录不可用、能力未知或预览失败时，响应给出可归因原因，**不得**用「全部行」掩盖运维故障。

### 审计正式导出（v2）

`GET /api/admin/audit/export-v2` 与 `GET /api/admin/audit/export-pack-v2`

L25-09 S06／§12.5 的正式导出路径。账本上界 `S` 由服务端从 canonical ledger 的已提交上界取得，**不得**取投影自身序号。导出须同时满足「投影追上 S」与「能给出 as-of S 的正确视图」，否则失败而不静默换用较新数据。

导出包清单含 `exported_by` / `export_reason` / `export_approval_ref` 与跨文件关系声明；清单校验重算每个文件的 sha256 并校验跨文件关联键，**不以哈希字符串长度代替内容校验**。

### 审计只读对账视图

`GET /api/admin/audit/reconciliation/inquiries/:turnId`、`GET /api/admin/audit/reconciliation/usage`、`GET /api/admin/audit/reconciliation/export`

L25-02、L25-03 的只读对账展示。所有响应携带同一 `reconciliationContext`：规范化筛选、时区、账本上界 `watermarkSeq=S`、快照、计量单位与规则版本。**请求超过 S 的新事件不得混入当前页面或导出。**

- 问询详情给出完整表清单（`连接.Schema.表`，同名表不合并）、轮次、调用与尝试、耗时、预算状态与归属质量。
- 用法对账给出配置 Token 数（启用／停用分列）与窗口内活跃 Token 数，以及四类差异集合；**只有真实 `budget_stopped` 凭据**才判定「问询预算已用尽」。
- 比率同时给出 N／D；D=0 或不可观测时**不得**显示 0% 或 100% 的确定结论。
- CSV 导出与页面同源，保留空值与空值原因、防公式注入、不导出凭据。

`GET /api/admin/audit/export` 使用与 `/api/admin/audit` 相同过滤条件导出**调用流水** CSV，并对 spreadsheet formula 前缀做转义。可选 `bom=1` 前缀 UTF-8 BOM。文件名为 `audit-calls-YYYYMMDD-HHmmss-000001.csv`，按 `Asia/Shanghai` 精确到秒并带流水号；CSV 保留原始 `ts`（UTC），并新增 `ts_local`（`YYYY-MM-DD HH:mm:ss`）用于人工阅读和 Excel 解析。用户可见名称不得称为「审计证据」。权威契约见 Spec 137 与 Spec 141。

`GET /api/admin/audit/export-metadata?kind=calls|turns` 下载 CSV 字段说明 JSON。响应 `schemaVersion="audit-csv-field-metadata/v1"`，包含 `timezone`、`filenamePattern`、`generatedAt` 与按 CSV 列顺序排列的 `fields[]`，每个字段说明 `name` / `label` / `format` / `description` / `trigger`。非法 `kind` 返回 `400 ERR_INVALID_AUDIT_METADATA_KIND`。

`GET /api/admin/audit/export-pack` 导出**审计证据包** zip（文件名 `audit-pack-YYYYMMDDTHHMMSSZ-<8hex>.zip`）。包内含 `access_log.csv`、`access_log_sources.csv`、`permission_snapshots.jsonl`、`auth_failure_log.csv`、`audit_maintenance_log.jsonl` 与 `manifest.json`。Manifest 记录标准化后的有效筛选、逐文件 `filterScope`、产品 VERSION、rowCount/SHA-256、容量上限和 snapshot/source 完整性缺口。默认最多 10000 行/64 MiB，超限返回 `413 ERR_AUDIT_EXPORT_TOO_LARGE`；下载响应 `Cache-Control: private, no-store`。SHA 仅用于完整性自检，不是防篡改签名。见 Spec 137。

`POST /api/admin/audit/args-summary/scrub` 删除历史 `access_log.args_summary` 中的 `question` / `questionPreview` / `intentSummary`。请求体 `{ dryRun?: boolean, reason?: string }`，默认 dry-run；apply 时 reason 必填，并在同一事务追加不含原文的 maintenance 事件。见 Spec 137 §7。

`GET /api/admin/audit/turns` 返回问答轮次视图，合并 inferred turns 与客户端显式上报的 conversation turns。支持 `user`、`since`、`until`、`source=inferred|reported|all`、`lookbackHours`、`limit`、`offset`；默认 `source=all`、`limit=50`，最大 `500`。响应额外包含当前筛选窗口的 `summary`：`reportedCount` / `inferredCount` / `reportedShare`（上报占比，0–1），便于观察可选原文上报覆盖率；漏报不是错误。

`GET /api/admin/audit/turns/export` 使用同一轮次筛选契约导出访问问询 CSV；可选 `bom=1`。文件名为 `audit-turns-YYYYMMDD-HHmmss-000001.csv`。导出保持 inferred/reported 来源标签，不把推断问题当作已上报原文；「开始时间」「结束时间」为本地时间，「开始时间 UTC」「结束时间 UTC」保留原始值。

响应：

```jsonc
{ "ok": true, "data": {
  "total": 1,
  "summary": { "reportedCount": 0, "inferredCount": 1, "reportedShare": 0 },
  "entries": [{
    "id": "inf_20260629_001",
    "source": "inferred",
    "userId": "workhorse",
    "startedAt": "2026-06-29T10:00:00.000Z",
    "endedAt": "2026-06-29T10:00:05.000Z",
    "businessCallCount": 2,
    "questionSummary": "查询销售额",
    "confidence": "medium",
    "tools": ["sl_read_source", "sl_query"],
    "sources": [{ "physicalTable": "dataforai.superstore_orders" }]
  }]
}}
```

`GET /api/admin/audit/turns/:turnId` 返回单个轮次详情。`inf_` 前缀查询 inferred turn，否则查询 reported conversation turn；不存在时返回 `404`。响应包含关联 access logs、sources、question summary/preview，以及 inferred turn 的 evidence。

`POST /api/admin/audit/conversation-turns/purge` 手动触发 conversation turn retention 清理。请求体支持 `retentionDays` 与 `dryRun`；返回删除计数与 cutoff 等清理结果。

请求：

```jsonc
{ "retentionDays": 30, "dryRun": true }
```

`GET /api/admin/trace/events` 查询 Trace / Evidence Kernel 的只读事件流。必须传 `traceId` 或 `turnId`；可选 `spanType`、`status`、`limit`。响应只返回已脱敏 metadata、policy decision、artifact hashes 与 evidence refs，不返回物理结果集明细、原始 SQL AST、未脱敏 Token/secret 或完整原始问题。

响应：

```jsonc
{ "ok": true, "data": {
  "events": [{
    "id": 1,
    "traceId": "trace_8b9d...",
    "spanId": "mcp_tools_call:lucy_query:trace_8b9d...",
    "spanType": "mcp_tools_call",
    "actorKind": "agent",
    "status": "ok",
    "startedAt": "2026-08-03T10:00:00.000Z",
    "requestId": "1",
    "metadata": { "tool_name": "lucy_query" }
  }],
  "evidence": [{
    "id": 1,
    "traceId": "trace_8b9d...",
    "evidenceKind": "access_policy",
    "evidenceRef": "lucy_query",
    "relation": "used"
  }]
}}
```

`GET /api/admin/mcp-tools` 返回当前已知 MCP tool 列表，并标记全局 deny 状态。

`GET /api/admin/mcp-runtime/status` 返回 Config、Catalog、Policy Runtime 与常驻 KTX MCP Execution Runtime 的分层状态；Catalog 同时返回 `lastByConnection` 的最近 reload 摘要。响应只包含 `ktx.yaml` 的 SHA-256 摘要和连接 ID，不返回密码、Token 或 `.ktx/secrets/**` 内容。执行层状态为 `unknown | ok | stale | unavailable | error`；MCP 上游可达但无法证明某连接已加载时必须返回 `unknown`，不得把独立 `ktx connection test` CLI 的成功当作运行时确认。

`POST /api/admin/mcp-runtime/canary` 请求体为 `{ connectionId, agentId?, sourceName?, mode? }`，其中 `mode` 为 `connection | tools_list | catalog | query`。响应逐项返回 `config`、`catalog`、`policy`、`execution_tools_list`、`execution_query` 检查及 `executionRuntimeAck`。当当前 KTX 版本无连接加载自省且当前配置摘要没有成功查询证据时，返回 `status="blocked"`、`executionRuntimeAck=false`、`decisionReason="execution_canary_blocked"`；上游不可达返回 `execution_runtime_unavailable`。

`POST /api/admin/mcp-runtime/reload` 请求体为 `{ connectionId?, reason? }`，均可选，`connectionId` 缺省表示全部连接。仅所有者可调用，且鉴权模式先于 owner 校验：鉴权模式非 `required` 返回 400 `AUTH_NOT_CONFIGURED`，未登录返回 401 `AUTH_REQUIRED`，非 owner 返回 403 `OWNER_REQUIRED`。成功返回 `{ ok: true, data: { requestId, reloadStatus, configVerification, mcpReachable?, requestedDigest, actualDigest?, startedAt, finishedAt?, durationMs?, detail? } }`，其中 `reloadStatus` 为 `succeeded | failed | already_running | unsupported`，`configVerification` 为 `verified | failed | unverified`——进程重启成功与配置连接级验证为**正交**两轴，不得互相替代。失败如实报告并允许修复后重试，**不回滚 `ktx.yaml`**。权威契约见 Spec 191 §6–§8。

### 界面使用（Spec 148）

`POST /api/admin/ui-usage/page-view` 记录一次 WebUI 页面打开。请求体 `{ "pathname": "/catalog" }`。走现有 WebUI 管理员鉴权；required 且未登录返回 401。成功 `{ ok: true, data: { recorded: true | false } }`（跳转路径可为 `recorded: false`）。非法路径返回 400，错误文案不回显路径。

`GET /api/admin/ui-usage/overview?hours=24|168` 返回界面使用聚合：`pageViews`、`visitorCount`、`activeMenuCount`、`unmappedViews`，以及 `groups` / `menus` / `pages` 排行（`{ id, label, visits }`）。仅接受 24 与 168，缺省或其他值按 168。`pageViewSeries` 只拆开 `pageViews`，见 Spec 166。权威契约见 Spec 148 与 Spec 166。

`POST /api/admin/ui-usage/catalog-navigation-event` 记录 `/catalog` P0 的匿名交互事件。请求体 `{ visitId, eventType, contextLevel? }`；只接受 Spec 152 定义的事件与层级枚举。事件只写本机审计库，不保存账户、URL、查询串、搜索词或业务对象名。成功返回 `{ ok: true, data: { recorded: true | false } }`；非法请求返回 `400 CATALOG_NAVIGATION_EVENT_INVALID`。

`GET /api/admin/ui-usage/catalog-navigation?hours=24|168` 返回 Spec 152 的聚合访问数、结果访问数、首个结果前语义操作分位数、动作计数与树选择层级；不返回事件明细或 `visitId`。窗口规则与界面使用聚合一致。

### 调用监控（Spec 143）

`GET /api/ops/call-monitor?range=1h|24h|7d|30d&slowMs=` 返回 MCP 业务工具调用的准实时聚合，以及同一窗口的分桶序列：吞吐、成功率 / 错误率 / 拒绝率、多数请求耗时（P95）、慢于多数请求计数、SLO 违规、Top 工具（≤10）、最近失败与拒绝短表（≤20）和 `series`。事实源为 `audit.sqlite` access_log，排除协议工具；响应不得包含 Eval / Hermes 字段。权威契约见 Spec 143 与 Spec 165。

### MCP Proxy

`POST /mcp` 在 7879 端口运行，使用 Bearer token 识别 agent，执行 ACL 裁决并写访问日志。代理工具包括 KTX MCP 上游工具和 `kx_catalog` 本地目录工具。

### 部署模式与首个所有者引导（企业安全 V-01 · A0 最小版）

`LUCY_DEPLOYMENT_MODE=customer|development`，缺省 `customer`，其他取值拒绝启动。`customer` 下 `GET /api/auth/status` 的 `mode` 永不为 `open`（无启用管理员 → `bootstrap`），`LUCY_WEBUI_AUTH=off` 不生效；`development` 保持原行为。

`POST /api/auth/bootstrap` 在 `customer` 模式下还需请求头 `X-Lucy-Bootstrap-Token`，对照 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE` 指向的 Secret 文件（`timingSafeEqual`）。新增错误码：

| 状态码 | 错误码 | 含义 |
|---|---|---|
| 503 | `BOOTSTRAP_NOT_PROVISIONED` | 未配置 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE`，或文件不可读 / 为空 |
| 401 | `BOOTSTRAP_TOKEN_INVALID` | 缺少或不匹配 `X-Lucy-Bootstrap-Token` |

持久限速、并发互斥与持久引导状态见企业安全 Spec §3.1 / T02。

### Wiki / Skill 对象授权与并发（企业安全 T05 / T06，取代 Spec 170 的全开放）

**授权事实源：** Skill frontmatter `roles_allowed`、Wiki frontmatter `allowed_roles`。缺失或 `[]` 无人可见；精确 `["*"]` 表示所有有效已分配 Role（不是匿名公开）；`*` 与 Role 混用、非数组、非字符串元素为损坏声明，保存 / 导入返回 `400 CONTEXT_ACL_INVALID`（Skill 为 `400 skill_roles_invalid`），运行时对象拒绝。`sl_refs`、Skill prerequisites、`visibility`、目录名均不授权。Agent 侧同一 Role 须同时匹配对象授权与通道（`wiki_search` / `wiki_read` / `lucy_skill_search` / `lucy_skill_read`）。

**Wiki 版本保护：**

| 端点 | 变更 |
|---|---|
| `GET /api/wiki/:key` | 响应增加 `file_version`（`sha256:<hex>`，文件字节）与 `acl`（`missing` / `empty` / `all` / `roles` / `corrupt`）；`frontmatter.allowed_roles` 仅在声明合法时返回 |
| `PUT /api/wiki/:key`（`dryRun:false`） | 页面已存在时必须带 `expected_version`：缺失 `428 wiki_expected_version_required`，过期 `409 wiki_write_conflict`；`frontmatter.allowed_roles` 为空值之外的合法数组才改写授权，否则保留现有声明 |
| `POST /api/wiki/upload/preview` | 响应增加 `currentFileVersion`；新页面无 ACL 时 `warnings` 提示无人可见 |
| `POST /api/wiki/upload/commit` | 覆盖已存在页面须带 `expected_version`（428 / 409 同上）；上传内容未声明 `allowed_roles` 时沿用页面当前授权 |
| `POST /api/wiki/:key/versions/:versionId/restore` | 恢复正文与属性，但**保留当前** `allowed_roles`，不复活历史上更宽的授权 |

Skill 写入沿用 `expected_version`（428 `skill_expected_version_required` / 409 `skill_write_conflict`）；`POST /api/skills`、`PUT /api/skills/:domain/:name` 现在写入请求中的 `roles_allowed`，新建缺省写 `roles_allowed: []`。

**Role 管理：**

| 状态码 | 错误码 | 含义 |
|---|---|---|
| 409 | `ROLE_REFERENCED_BY_CONTEXT` | 删除 Role 时仍有 Wiki / Skill 授权指向它；`error.detail` 为 `{ skills: [...], wiki: [...] }`（仅对象标识） |
| 409 | `ROLE_ID_RETIRED` | 已删除的 Role 标识永久退役（`role_id_tombstones`），创建 / 复制不可复用 |
| 409 | `ROLE_ID_HAS_CONTEXT_REFERENCES` | 新 Role 标识已出现在历史 ACL 中；清理引用，或在请求体显式带 `acknowledgeContextReferences:true` 后才创建 |
| 503 | `SECURITY_STORE_UNAVAILABLE` | 无法读取 / 写入退役状态，拒绝删除或创建 |

`GET /api/admin/roles/:roleId` 增加只读的 `wikiAccess`（与 `skillAccess` 同形）和 `contextPolicyVersion`。

**MCP 外部响应：** 对按 key / URI 指定的未授权、不存在、草稿、停用对象，`resources/read`、`prompts/get` 返回 JSON-RPC error `-32003`，`message` 与 `data.reason` 均为 `context_not_available`；`lucy_skill_read`、`wiki_read` 返回 `isError:true`，文本为 `context_not_available`。无正式 Role 的 legacy direct-allow Agent 返回 `context_role_required`。具体内部原因只进入受保护审计。

**管理侧导出：** `POST /api/semantic-assets/export` 在包含 Wiki / Skill 时向安全账本写入操作者记录（账本不可用返回 `503 SECURITY_STORE_UNAVAILABLE`）；它不是 Agent 通道。

**迁移工具：** `cd webui && npx tsx ../scripts/security/migrate-context-acl.mts --project-dir <dir> --dry-run` 输出仅含元数据的迁移报告（`inventoryDigest`、保留 / 显式全角色 / 待确认 / legacy Agent）；`--apply --owner <id> --expected-digest <digest> --decisions <file> --backup-dir <dir>` 仅 owner 可执行，整批预检通过后才写入，带加密备份与持久 journal。先在合成 fixture 上运行；对客户私有配置执行属部署授权范围。

### 业务 Wiki 访问权限管理（Spec 193 / Plan M66）

**授权事实源不变：** 业务 Wiki 的对象授权仍然只有文档 frontmatter `allowed_roles`。本节新增的端点**只**改写这一份声明：正文逐字保留，未知 frontmatter 字段及其值语义保留，不经过完整正文草稿往返。

#### 新增端点

```text
GET  /api/wiki/:key/access
POST /api/wiki/:key/access/preview
PUT  /api/wiki/:key/access
POST /api/wiki/access/batch/preview
POST /api/wiki/access/batch/commit
GET  /api/wiki/access/batches/:operationId
```

`GET /api/wiki/:key/access` → `data` 为授权摘要：

```ts
type WikiAccessSummary = {
  key: string;
  file_version: string;          // sha256:<hex>，文件字节
  acl: ObjectAcl;                // missing | empty | all | roles | corrupt
  declared_role_count: number | null;  // roles 取声明数；all/corrupt 为 null；missing/empty 为 0
  role_effects: Array<{
    role_id: string;
    known: boolean;              // 未知 Role 保留为 known=false，不映射同名新 Role
    discover_enabled: boolean;   // 该 Role 是否开通 wiki_search
    read_enabled: boolean;       // 该 Role 是否开通 wiki_read
    assigned_agent_count: number; // 实际绑定该正式 Role 的已启用 Agent 数
    assigned_agent_ids: string[];
  }>;
  declared_without_discover: number;
  declared_without_read: number;
  role_channel_version: string;  // 全局 Role/通道/Agent 绑定版本
  pending_change?: { operation_id: string; state: "pending" | "needs_review" };
};
```

`POST /api/wiki/:key/access/preview` 请求 `{ allowed_roles, expected_version }`，返回旧/新 ACL、`direction`（`narrow` / `widen` / `neutral`）、`noop`、Role 通道效果、`role_channel_version` 与 `preview_digest`。摘要绑定 key、当前 `file_version`、规范化候选 ACL 与全局 `role_channel_version`。

`PUT /api/wiki/:key/access` 请求 `{ allowed_roles, expected_version, preview_digest }`。服务端在共享写入队列内重算候选并核对摘要，不信任客户端回传的 direction。规范化后 ACL 无变化 → 返回 `status: "noop"`，不写文件、不新增版本、不写审计。

`POST /api/wiki/access/batch/preview` 请求 `{ items: [{ key, expected_version }], action }`，返回逐篇 `old/new/direction/noop`、汇总、`role_channel_version`、`plan_digest` 与 `operation_id`。`action` 只有两种：

```ts
type WikiBatchAccessAction =
  | { mode: "add"; role_ids: string[] }        // 并集；至少一个 Role；不接受 "*"
  | { mode: "replace"; allowed_roles: string[] }; // 精确值；可 [] 或 ["*"]，各自需独立确认
```

`POST /api/wiki/access/batch/commit` 请求 `{ operation_id, plan_digest, idempotency_key, items, action, confirmed_empty?, confirmed_all? }`。返回逐篇结果（`applied` / `noop` / `conflict` / `failed` / `not_run` / `needs_review`）。批量**不是**跨文件事务：已成功的文档不回滚。

`GET /api/wiki/access/batches/:operationId` 按 operation id 还原批量结果，页面刷新或断网后可恢复查看。

#### `GET /api/wiki` 的聚合授权字段

`GET /api/wiki` 在**一次**聚合响应中为每篇文档返回 `access`（`file_version`、规范化 `acl`、缺通道计数、pending 状态），并在响应顶层返回 `role_channel_version`。Role / Agent 配置在该请求内只读取一次；列表不嵌入正文、完整 Agent id 清单或逐 Role 效果明细，前端不得为每行再调用 access API。

#### 上传授权选择（`POST /api/wiki/upload/preview` / `commit`）

上传预检的 `data.access` 段包含：`current_acl`（目标不存在时为 `null`）、`uploaded_acl`、`final_acl`、`suggested_selection`、`direction`、`role_effects`、`declared_role_count`、缺通道计数、`role_channel_version`、`preview_digest` 与 `issues`。

提交必须携带**原始 Markdown**、明确的 `access` 选择、`confirmed_empty` / `confirmed_all`（按最终值）、`expected_version`（覆盖已有文档时）与 `preview_digest`：

```ts
type WikiUploadAccessSelection =
  | { mode: "preserve_current" }              // 仅覆盖已存在文档；逐字保留当前声明（含损坏声明）
  | { mode: "use_uploaded" }                  // 要求文件内声明合法
  | { mode: "set"; allowed_roles: string[] }; // 总是用规范化后的值替换
```

**不再接受**把预检返回的 `proposedMarkdown` 当作下一次上传源；缺少 `access` → `400 wiki_upload_access_required`（不提供静默沿用旧客户端行为的兼容分支）。

#### 既有写路径的并发基线

| 端点 | 变更 |
|---|---|
| `PUT /api/wiki/:key` | 已存在文档缺 `expected_version` → `428 wiki_expected_version_required`，过期 → `409 wiki_write_conflict`；同时改写 `allowed_roles` 时走统一的安全写入原语 |
| `POST /api/wiki/upload/commit` | 覆盖已存在页面须带 `expected_version`（428 / 409 同上）**以及** `access` 与 `preview_digest`；`mode=create` 要求目标不存在、`mode=replace` 要求目标存在且版本匹配，否则 `409 wiki_write_conflict`（不会自动互相转换） |
| `POST /api/wiki/:key/versions/:versionId/restore` | 须带 `expected_version`（428 / 409）；恢复正文但**保留当前** `allowed_roles`，不复活历史更宽授权 |
| `POST /api/wiki/:key/move` | 须带 `expected_version`（428 / 409） |
| `DELETE /api/wiki/:key` | 须带查询参数 `expected_version`（428 / 409） |
| `POST /api/wiki/directories/rename` | 预检返回逐文档 `fileVersion` 与 `preview_digest`；提交可带 `expected_versions` 与 `preview_digest`，队列内逐篇重验 |

#### 稳定错误码

| 状态码 | code | 含义 |
|---|---|---|
| 400 | `wiki_upload_access_required` | 上传 commit 缺少明确 access selection；零写入 |
| 400 | `wiki_batch_empty` | 服务端去重后没有文档 key |
| 400 | `wiki_batch_limit_exceeded` | 去重后超过 100 篇 |
| 400 | `wiki_batch_blocked` | 批量计划存在阻断性校验问题（例如 add 遇到损坏 ACL）；零写入 |
| 400 | `wiki_access_frontmatter_invalid` | 文档 frontmatter 无法解析或无法写回；零写入 |
| 400 | `CONTEXT_ACL_INVALID` | ACL 声明损坏或请求值非法（沿用既有契约） |
| 409 | `wiki_upload_preview_stale` | 上传候选、目标版本或授权效果已变化；零写入 |
| 409 | `wiki_expected_version_required` | 已存在文档的写操作缺少 `expected_version`（HTTP 428） |
| 409 | `wiki_access_preview_stale` | 单篇授权预检已过期 |
| 409 | `wiki_batch_preview_stale` | 批量提交前至少一项或角色图已过期；零写入、零 journal |
| 409 | `wiki_batch_idempotency_conflict` | 幂等 key 已绑定另一份 plan |
| 409 | `wiki_access_change_pending` | 对象存在未决扩权操作；该 key 的 Agent 搜索与读取继续拒绝，其他写路径被阻断 |
| 409 | `wiki_write_conflict` | 文档版本或目标存在状态冲突（沿用现有 Wiki 并发契约） |
| 503 | `config_audit_unavailable` | 配置审计 intent/terminal 不可用；不得返回成功 |
| 503 | `SECURITY_STORE_UNAVAILABLE` | 安全操作或 hold 投影不可用；保持拒绝 |

#### 扩权 hold 与批量 journal

* 任何 `direction=widen` 的授权变更先写 durable security operation，再写文档；hold 由 `.ktx-ui/security.sqlite` 的 per-key 投影派生。hold 存在或投影不可读时，该 Wiki key 的 Agent 搜索与读取**全部**拒绝。
* 目标字节已落盘但安全状态未提交时，恢复为 `needs_review` 并继续 hold；系统不自动重放扩权写入，也不自动确认扩权。
* 批量 journal 与幂等记录复用 `.ktx-ui/security.sqlite`（FULL 持久化、0600 权限），不另建含 ACL 明细的 JSON sidecar。journal 仅记录 key、版本、ACL 摘要、状态、actor、时间与稳定错误码，**不写正文、凭据或绝对主机路径**。
* access 端点与 journal 均不返回或存储 Markdown 正文与 Token。

#### 已知边界

* 队列与 hold 只覆盖 Lucy 支持的单实例、单副本部署；直接编辑 Wiki 文件、多个 WebUI 进程共享写入同一内容目录属于不支持的多写者拓扑，不提供跨进程 CAS 或分布式事务保证。
* 目录权限继承、Skill 批量授权、定时授权、审批流与移动目录时的权限重算不在本轮范围。

## Lucy v0.25 P1 梯队新增端点

本节登记 v0.25 P1 梯队（P1-1…P1-4）新增的 Admin 端点。权威契约见
[P1-1 行策略模板与按表反查 Spec](../../docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md)、
[P1-2 授权摘要 Spec](../../docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md)、
[P1-3 访问关系图 Spec](187-access-relation-sankey-spec.md)、
[P1-4 Hive 直连 Spec](../../docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md)。

四组端点共享同一套口径硬约束：

- **只读面不写配置**：`GET` 端点不进入发布协调器，不写任何配置或审计终态。
- **同源快照**：每个响应都发布 `configVersion` / `policyVersion` / `sourceMapVersion` / `capabilityDigest` 四元组；一次响应内不得混用两个世代。
- **计数口径唯一**：授权路径数（去重 `(Agent, Role, Connection, Schema, Table)`）与去重表数（规范源键四元组）是两个不同的数，任何字段不得互相冒充。
- **降级显式**：配置不可读 / 非法 / 路径不一致时返回 `unavailable` 与可归因原因，**不得**用空集合或 0 冒充「没有授权」。

### 行策略模板与按表反查（P1-1）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/admin/row-policy/templates` | GET | 模板读取模型。Query：`connectionId` / `schema` / `sourceName`（三者齐全才做按表可用性判定）。响应含模板目录、引用关系、**不可绑定项及其原因**（原因在选择时即披露，不等到保存）、目录级 issue。 |
| `/api/admin/row-policy/templates/validate` | POST | 候选校验，**不落盘**。请求体 `{ operation }`。 |
| `/api/admin/row-policy/templates` | POST | 新建模板。请求体 `{ name, description?, predicates, dryRun?, version?, candidateDigest? }`。默认 dryRun。 |
| `/api/admin/row-policy/templates/:name` | PATCH | 改名 / 改定义。请求体 `{ name?, description?, predicates, dryRun?, version?, candidateDigest? }`。默认 dryRun。 |
| `/api/admin/row-policy/templates/:name` | DELETE | 删除模板。**有引用时拒绝且零写入**；无引用可经 dry-run 保存。请求体 `{ dryRun?, version?, candidateDigest? }`。 |
| `/api/admin/row-policy/views/tables` | GET | 按表反查清单。Query：`connectionId` / `schema` / `sourceName` / `roleId` / `agentId` / `restricted`。表集合按**规范源键**去重，同名不同连接 / Schema 不合并。 |
| `/api/admin/row-policy/views/table` | GET | 单表反查。Query：`connectionId` / `schema` / `sourceName`（三者齐全才定位单表）。响应含逐 Role 分支、Agent 个人行限制与最终行约束。 |

写入端点的共同约定：

- **候选摘要失效**：草稿变更后旧 `candidateDigest` 作废，必须重新 dry-run 才能正式保存。
- **回滚即失败**：写被回滚（`rolledBack === true`）时返回 `500 ROW_POLICY_TEMPLATE_WRITE_ROLLED_BACK`，**绝不**返回 `written: true`。
- **目录级与选择器级分离**：目录级 issue 降为 `templateWarnings` 不阻断写入；选择器级非法引用返回 `400`。
- 角色写入路径对模板引用的校验口径与本组端点一致（引用不可解析 → 400）。

### 授权摘要（P1-2）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/admin/authorization-summary/agent/:userId` | GET | Agent 的**已提交**授权摘要。Agent 不存在返回 `404 AGENT_NOT_FOUND`。 |
| `/api/admin/authorization-summary/role/:roleId` | GET | Role 的已提交授权摘要。Role 不存在返回 `404 ROLE_NOT_FOUND`。 |
| `/api/admin/authorization-summary/agent/:userId/preview` | POST | Agent **草稿候选**摘要。请求体 `{ name?, enabled?, role?, roles?, constraints? }`。草稿只在内存里 overlay，不落盘、不换已提交策略。 |
| `/api/admin/authorization-summary/role/:roleId/preview` | POST | Role 草稿候选摘要。请求体 `{ role }`。 |

- 响应为 `{ summary, candidateDigest }`；`candidateDigest` 是失效令牌：草稿一变，上一份候选摘要即失效，不得用于确认新草稿。
- 摘要内 `headline.grantPathCount`（授权路径数）与 `headline.tableCount`（去重表数）**分别表达**；`enabledTableCount` 在分母不可证明时为 `null`，**不是 0**。
- 行边界保留 `OR-of-AND` 结构：两个受限 Role 仍是两个 OR 分支，不折叠成 AND；Role 摘要不冒充 Agent 的 `FinalRows`。
- 授权摘要**不占独立侧栏导航位**：它是 Agent 详情页与 Role 详情页的只读投影，独立路由仅 URL 可达。

### 访问关系图（P1-3）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/admin/access-map` | GET | 授权骨架 ＋ 访问内核的只读关系图。Query：`agent` / `role` / `token` / `table` / `connection` / `window` / `layer` / `trust` / `view` / `focus`。 |

- **非法参数值 → 400**，且**不**静默纠正成默认值（被悄悄改写的分享链接会让用户误以为「这个 Agent 没有授权路径」）。
- 响应含 `meta.grant`（授权面状态与四元组快照身份）、`meta.access`（访问面状态与口径）、`meta.counts`（`grantPaths` / `tables` / `accessPaths` / `grantUsers` 等，**四种计数分别表达**）、`meta.signals`（`dormantEdges` / `needsReviewEdges` / `confirmedUnauthorizedEdges`）、`meta.snapshotCoverage`（可关联快照数 / 需复核记录数 / 缺失或无效数 / 覆盖率）。
- **流守恒**：Role / Connection / Schema 等中间节点的入流授权路径数 ＝ 出流授权路径数（误差 0）；Agent 是源点、Table 是汇点、Token 是凭证叶（零流）。守恒自检失败返回 `500 ACCESS_MAP_BUILD_FAILED`，**不返回空图冒充正常结果**。
- **两档信号措辞**：需复核档文案**不得**出现「越权」二字；确凿越权档必须标注判定来源为**调用当时**的授权快照（`permission_snapshot_hash` 关联 `permission_snapshots`）。快照缺失、损坏或身份不一致时只保留「需复核」，不得升级为确凿越权，也不得把低覆盖率解释为低越权率。
- 端点为纯 GET：POST / PUT / DELETE 一律 404（只读旁路，不改配置、不改运行时授权）。

### Hive 直连配置面（P1-4，本轮仅编译侧与配置面）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/admin/hive/connections` | GET | Hive 连接读取模型，并给出与 `ktx.yaml` 合并后的统一连接视图。配置不可读返回 `500 HIVE_CONFIG_UNREADABLE`；连接 id 冲突返回 `409 HIVE_CONNECTION_ID_CONFLICT`（**失败关闭**，不得靠隐藏一侧来消解冲突）。 |
| `/api/admin/hive/connections` | POST | 新建或整体替换一个连接。请求体 `{ connection }`。非法输入返回 `400 BAD_REQUEST`。 |
| `/api/admin/hive/connections/:id` | DELETE | 删除一个连接。连接不存在返回 `404 hive_connection_not_found`。 |

- Hive 连接的读改写**整体在写锁内**完成，读到的旧值不得被并发写覆盖。
- 连接项校验含值级校验：LDAP url 携带明文口令等形态直接拒绝。
- **规范源名格式** `<schema>_<table>`（如 `finance_orders`）：Manifest 键与 overlay 文件名须遵循，不符即 `hive_source_name_mismatch` 显式报错。
- 编译侧（只编译、不连库）已可用；**JDBC 执行与 MCP 入口接入本轮未实施**，相关验收（V03–V17）记 `blocked_environment`。

## Lucy v0.25 P2 梯队新增端点

### 可选 SMTP 通知（L25-05，S1／S2）

权威契约见 [可选 SMTP 通知 Spec](../../docs/specs/lucy-20261025-v0p25-smtp-notifications-spec.md) §7。

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/admin/notifications/status` | GET | 通知运行状态。**owner-only**，非 owner 返回 `403 OWNER_REQUIRED`，未登录返回 `401`。响应含 `enabled`、`state`（`disabled`／`unavailable`／`ok`／`degraded`）、`auditHealth`、`recipientCount`、队列计数与最近封闭错误码。**不返回 host、username、from、收件人或任何 secret**。 |
| `/api/admin/notifications/test` | POST | 提交一封测试邮件。**owner-only**，非 owner 返回 `403 OWNER_REQUIRED`，未登录返回 `401`。不需要请求体收件人——收件人固定为当前缓存 profile 的全部 `recipients`。配置有效且 enabled 时返回 `202 {ok:true,notificationId,status:"queued"}`，主文案为「测试邮件已加入发送队列」：只表示**已加入通知队列**，不表示 SMTP 已接受，也不表示收件箱已送达。配置不可用返回 `503 NOTIFICATION_UNAVAILABLE`；配置可用但通知队列暂不能收行返回 `503 NOTIFICATION_QUEUE_UNAVAILABLE`。 |
| `/api/admin/notifications/:id` | GET | 单条通知记录的状态。**owner-only**，非 owner 返回 `403 OWNER_REQUIRED`，未登录返回 `401`。返回 `id`、`eventType`、`status`（`queued`／`sending`／`sent`／`dead`）、`attempts`、各时间字段与 `lastErrorCode`。**不返回 payload 或收件人原文**。id 非正整数或记录不存在，均返回 `404 NOTIFICATION_NOT_FOUND`。 |

- 该路径**不进入公开 API 白名单**，也不在登录页出现；通知不是认证条件。
- 本端点不改变 `/api/health` 的主服务健康定义：`degraded` 只表示通知队列或发信异常。
- S2 起具备发送能力：投递由 outbox worker 异步执行，**本轮请求不等待 SMTP**。SMTP 服务器接受信件**不等于**最终送达收件箱——Lucy 只记录 SMTP 提交结果，不追踪退信、阅读或外部投递回执。
- 不提供重新发送同一行的写接口；owner 通过状态接口与单行查询观察 `queued`／`sending`／`sent`／`dead`。
