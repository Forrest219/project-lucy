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

GET  /api/wiki
GET  /api/wiki/:key
PUT  /api/wiki/:key

GET  /api/diff
POST /api/validate-changed

GET  /api/joins/candidates                       # .ktx-ui sidecar
PUT  /api/joins/candidates

GET  /api/connections
GET  /api/connections/:connId/tables
PUT  /api/connections/:connId/enabled-tables     # default dryRun
POST /api/connections/:connId/test
POST /api/connections/:connId/ingest

GET    /api/eval/domains
GET    /api/eval/domains/:domain
GET    /api/eval/cases/:domain
GET    /api/eval/cases/:domain/:caseId
POST   /api/eval/cases/:domain
PUT    /api/eval/cases/:domain/:caseId
DELETE /api/eval/cases/:domain/:caseId
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

GET    /api/admin/agents
POST   /api/admin/agents
GET    /api/admin/agents/:userId
PATCH  /api/admin/agents/:userId
DELETE /api/admin/agents/:userId
GET    /api/admin/agents/:userId/effective-permissions
POST   /api/admin/agents/:userId/tokens
DELETE /api/admin/agents/:userId/tokens/:label
GET    /api/admin/roles
GET    /api/admin/config-audit
GET    /api/admin/config-audit/export.csv
GET    /api/admin/audit
GET    /api/admin/audit/sources
GET    /api/admin/audit/export
GET    /api/admin/mcp-tools

POST /mcp                                      # MCP proxy, port 7879
```

## 3. 端点细节

### `GET /api/project`
返回项目根、连接列表（**剥离 password 值**）、schema 列表。
```jsonc
{ "ok": true, "data": {
  "root": "/Users/forrest/Projects/project-lucy",
  "connections": [{ "id": "mysql-aliyun", "driver": "mysql", "passwordSource": "file", "schemas": ["dataforai"] }],
  "ktxAvailable": true
}}
```

### `GET /api/sources`
扫描全部 `_schema/*.yaml`，返回逐表目录摘要（供 Catalog）。
```jsonc
{ "ok": true, "data": { "tables": [{
  "conn": "mysql-aliyun", "schema": "dataforai", "table": "superstore_orders",
  "filePath": "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
  "columnCount": 8, "hasTableDesc": true, "hasGrain": false,
  "measureCount": 0, "joinCount": 2, "wikiRefCount": 0,
  "completion": "partial", "mtime": "2026-06-15T08:00:00Z"
}]}}
```

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

### `POST /api/sources/:conn/:schema/:table/validate`
```jsonc
{ "ok": true, "data": { "ok": true, "exitCode": 0, "stdout": "...", "issues": [] } }
```
后端调用约定：`execFile('ktx', ['sl', 'validate', table, '--connection-id', conn], { cwd: projectRoot })`。
`table` 必须是 `ktx sl --connection-id <conn>` 列表中的短 `name`；不要传 `schema.table` 或 `conn/table`。
若同一 connection 下出现短名冲突，返回 `409 BAD_REQUEST` 并提示人工处理。

CLI 不可用 → `KTX_CLI_ERROR`（区别于 `VALIDATION_FAILED`）。

### `GET /api/wiki` / `GET /api/wiki/:key` / `PUT /api/wiki/:key`
- `key` 为相对 `wiki/` 的路径（如 `global/revenue.md`），服务端经 `fs-safe` 校验。
- frontmatter 字段：`summary` `tags` `sl_refs` `refs` `usage_mode` + 正文 markdown。
- `PUT` 同样支持 `dryRun` 预览 diff。

### `GET /api/diff`
返回白名单目录（`semantic-layer/`、`wiki/`、`.ktx-ui/`）下的 `git diff`（name-status + 可选 patch）。非 git 仓库时回退会话写入记录。

### `POST /api/validate-changed`
对本次会话改动涉及的 source 批量 validate，返回逐表结果数组。

### `GET/PUT /api/joins/candidates`
读写 `.ktx-ui/join-candidates.json`（candidate/rejected join），不写正式 YAML（ADR-02 写入策略）。

## 4. 当前扩展端点

### 数据库连接

`GET /api/connections` 返回 `ConnectionInfo[]`，字段见 `04-data-model.md`。

`GET /api/connections/:connId/tables` 从 `semantic-layer/<connId>/_schema/*.yaml` 返回已扫描表名：

```jsonc
{ "ok": true, "data": { "tables": ["dataforai.superstore_orders"] } }
```

`PUT /api/connections/:connId/enabled-tables` 默认 `dryRun:true`。`enabledTables` 必须是已扫描物理表清单中的 `schema.table`，拒绝空串、路径字符、重复项和未扫描表。

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
  "newEnabledTables": ["dataforai.superstore_orders"]
}}
```

`dryRun:false` 写 `ktx.yaml` 并记录 `config_change_log`：

```jsonc
{ "ok": true, "data": { "written": true, "auditId": 1, "oldEnabledTables": [], "newEnabledTables": ["dataforai.superstore_orders"] }}
```

错误码：`CONNECTION_NOT_FOUND` `INVALID_ENABLED_TABLE` `DUPLICATE_ENABLED_TABLE` `TABLE_NOT_SCANNED`。

`POST /api/connections/:connId/test` 调用连接测试；`POST /api/connections/:connId/ingest` 触发 schema 扫描。两者返回 `{ exitCode, stdout, stderr }` 风格结果。

### Eval / 质量评测

`GET /api/eval/domains` 返回 domain 列表与最近运行摘要；`GET /api/eval/domains/:domain` 返回单个 domain。

`GET /api/eval/cases/:domain` / `GET /api/eval/cases/:domain/:caseId` 读取 eval case。`POST /api/eval/cases/:domain` 新增 case；`PUT /api/eval/cases/:domain/:caseId` 更新 case，默认 dryRun；`DELETE` 删除 case。

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

常见错误码：`RUNNER_BUSY` `RUN_NOT_FOUND` `RUNNER_PRECHECK_FAILED` `NO_CASES_SELECTED` `UNSUPPORTED_SELECTION_MODE`。

### Admin / 访问治理

Agent 列表与详情：

- `GET /api/admin/agents`
- `GET /api/admin/agents/:userId`
- `GET /api/admin/agents/:userId/effective-permissions`

写入路径已是 role-first：

- `POST /api/admin/agents`：必须传 `agent.role`，拒绝 `agent.allow`；当 role id 来自内置模板时，后端先展开为完整 yaml role 再写入，不保存 `role-template` / `templateId` 指针字段。
- `PATCH /api/admin/agents/:userId`：只允许 `name`、`note`、`enabled`、`role`；role 可引用 yaml 中已有 role 或内置模板。
- `DELETE /api/admin/agents/:userId`：删除 agent 前先撤销 token。

新建请求：

```jsonc
{ "dryRun": true, "agent": { "id": "wangwu", "name": "王五", "note": "市场部分析助理", "role": "kx_readonly" }}
```

PATCH 请求：

```jsonc
{ "dryRun": true, "version": "mtime-hash", "patch": { "role": "kx_readonly", "enabled": true }}
```

拒绝：

- `agent.allow` / `patch.allow` → `LEGACY_ALLOW_READONLY`
- 缺 role → `ROLE_REQUIRED`
- 无效 role → `INVALID_ROLE`
- 启用 legacy wildcard agent 且未分配 role → `LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`

Token：

- `POST /api/admin/agents/:userId/tokens` 只在响应中返回一次明文 token，yaml/audit 只保存 hash。
- `DELETE /api/admin/agents/:userId/tokens/:label` 先写 `revoked_tokens`，再更新 yaml。

Roles：

- `GET /api/admin/roles?includeTemplates=true` 返回 yaml role 与内置模板合并后的列表、工具、连接、展开 source 数与 warnings；返回项含 `source: "yaml" | "template"`，id 冲突时 yaml role 优先。`includeTemplates=false` 时只返回 yaml role。
- `GET /api/admin/agents/:userId/effective-permissions` 返回 role 展开后的 `tools`、`connections`、`sources`、`snapshotHash`、`sourceMapVersion`。

Audit：

- `GET /api/admin/config-audit`
- `GET /api/admin/config-audit/export.csv`
- `GET /api/admin/audit`
- `GET /api/admin/audit/sources`
- `GET /api/admin/audit/export`
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

响应：

```jsonc
{ "ok": true, "data": {
  "connections": [{ "connection": "audit-derived", "calls": 3 }],
  "schemas": [{ "schema": "dataforai", "calls": 3 }],
  "topTables": [{ "table": "dataforai.superstore_orders", "calls": 3, "denied": 1 }],
  "deniedTables": [{ "table": "dataforai.superstore_orders", "calls": 3, "denied": 1 }]
}}
```

`GET /api/admin/audit` 查询 MCP access log；支持按 user、tool、outcome、时间范围、tableSearch、sessionId、turnId、platform 过滤。默认不包含协议类工具调用；传 `includeProtocol=true` 可包含 `tools/list`、`initialize`、`notifications/initialized`。

`GET /api/admin/audit/export` 使用与 `/api/admin/audit` 相同过滤条件导出 CSV，并对 spreadsheet formula 前缀做转义。

`GET /api/admin/mcp-tools` 返回当前已知 MCP tool 列表，并标记全局 deny 状态。

### MCP Proxy

`POST /mcp` 在 7879 端口运行，使用 Bearer token 识别 agent，执行 ACL 裁决并写访问日志。代理工具包括 KTX MCP 上游工具和 `kx_catalog` 本地目录工具。

## 5. 通用约定

- 所有 `:conn/:schema/:table` 段做白名单存在性校验，不存在 → `404 SOURCE_NOT_FOUND`。
- 写类端点统一支持 `dryRun`，默认 `true`（安全优先：必须显式 `false` 才落盘）。
- 不存在任何返回 `.ktx/secrets/` 内容的端点。

---
_架构设计 by Claude (architect) · 2026-06-15_
