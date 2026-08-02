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

GET  /api/wiki
GET  /api/wiki/:key
GET  /api/wiki/:key/raw
PUT  /api/wiki/:key
POST /api/wiki/upload/preview
POST /api/wiki/upload/commit

GET  /api/diff
POST /api/validate-changed

GET  /api/joins/candidates                       # .ktx-ui sidecar
PUT  /api/joins/candidates

GET  /api/connections
GET  /api/connections/:connId/tables
PUT  /api/connections/:connId/enabled-tables     # default dryRun
POST /api/connections/:connId/schemas            # add schema metadata to existing connection
POST /api/connections/:connId/test
POST /api/connections/:connId/ingest
GET  /api/connections/ingest-runs

POST /api/catalog/reload
GET  /api/catalog/reloads
POST /api/catalog/assets/validate
POST /api/catalog/assets/upload
GET  /api/catalog/assets/uploads

GET    /api/eval/domains
GET    /api/eval/domains/:domain
GET    /api/eval/cases/:domain
GET    /api/eval/cases/:domain/:caseId
POST   /api/eval/cases/:domain
PUT    /api/eval/cases/:domain/:caseId
DELETE /api/eval/cases/:domain/:caseId
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

GET    /api/r1/observability
GET    /api/help/handbook

POST   /api/semantic-assets/validate
POST   /api/semantic-assets/publish
GET    /api/semantic-assets/releases
GET    /api/semantic-assets/releases/:id/status
POST   /api/semantic-assets/export
GET    /api/semantic-assets/exports/:exportId/download
POST   /api/semantic-assets/reindex

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
POST   /api/admin/roles/:roleId/copy
GET    /api/admin/config-audit
GET    /api/admin/config-audit/export.csv
GET    /api/admin/audit
GET    /api/admin/audit/sources
GET    /api/admin/audit/:id/sources
GET    /api/admin/audit/export
GET    /api/admin/audit/turns
GET    /api/admin/audit/turns/:turnId
POST   /api/admin/audit/conversation-turns/purge
GET    /api/admin/mcp-tools

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
| `fallback` | 未设置 `LUCY_PUBLIC_MCP_URL` | `http://127.0.0.1:7879/mcp`（本地开发默认） | 展示本地默认，附带 `MISSING_PUBLIC_MCP_URL` diagnostic；onboarding 与 token 页面提示客户部署需要配置 `LUCY_PUBLIC_MCP_URL` |
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

错误码：`BAD_REQUEST` `FORBIDDEN_PATH` `WIKI_NOT_FOUND`。

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

`POST /api/connections/:connId/schemas` 只在已有 connection 下登记 schema 元数据，默认 `dryRun:true`，写入目标是 `ktx.yaml`，不创建物理数据库连接、不触发扫描、不写语义层 overlay。

`GET /api/connections/ingest-runs` 返回历史 ingest / catalog reload 记录 sidecar，用于兼容旧入口与运维状态面板。

### Catalog Reload 与 Manifest 上传

`POST /api/catalog/reload` 触发静态目录重载，生成 catalog reload 运行记录；`GET /api/catalog/reloads` 返回最近重载历史。

`POST /api/catalog/assets/validate` 校验待上传 Schema Manifest。请求使用规范字段 `assetKind: "schema_manifest"`；兼容旧客户端 `assetType: "schemaManifest"`。其他 asset kind 必须走对应语义资产入口，不能混用。

`POST /api/catalog/assets/upload` 在校验通过后写入 `semantic-layer/<connection>/_schema/<schema>.yaml`，目标路径由系统根据 connection/schema 计算，不接受客户端任意路径。

`GET /api/catalog/assets/uploads` 返回 Schema Manifest 上传审计记录。

### 语义资产发布与导出

`POST /api/semantic-assets/validate` 校验语义资产包或 semantic overlay，执行 secret hard block、结构校验和发布前 gate。

`POST /api/semantic-assets/publish` 发布通过校验的语义资产，写入 release 记录；`GET /api/semantic-assets/releases` 查询 release 列表；`GET /api/semantic-assets/releases/:id/status` 查询单个 release 状态。

`POST /api/semantic-assets/export` 生成语义资产导出任务；`GET /api/semantic-assets/exports/:exportId/download` 下载指定导出产物。

`POST /api/semantic-assets/reindex` 手动触发 semantic-layer 索引重建，并把结果写入发布历史，供发布工作台和历史页展示。

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

`GET /api/eval/cases/:domain` / `GET /api/eval/cases/:domain/:caseId` 读取 eval case。`POST /api/eval/cases/:domain` 新增 case；`PUT /api/eval/cases/:domain/:caseId` 更新 case，默认 dryRun；`DELETE` 删除 case。

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
    "generatedBy": "scripts/lucy-r1-hermes-report.mjs",
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
- `GET /api/admin/audit/turns`
- `GET /api/admin/audit/turns/:turnId`
- `POST /api/admin/audit/conversation-turns/purge`
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

`GET /api/admin/audit/export` 使用与 `/api/admin/audit` 相同过滤条件导出 CSV，并对 spreadsheet formula 前缀做转义。

`GET /api/admin/audit/turns` 返回问答轮次视图，合并 inferred turns 与客户端显式上报的 conversation turns。支持 `user`、`since`、`until`、`source=inferred|reported|all`、`lookbackHours`、`limit`、`offset`；默认 `source=all`、`limit=50`，最大 `500`。

响应：

```jsonc
{ "ok": true, "data": {
  "total": 1,
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

`GET /api/admin/mcp-tools` 返回当前已知 MCP tool 列表，并标记全局 deny 状态。

### MCP Proxy

`POST /mcp` 在 7879 端口运行，使用 Bearer token 识别 agent，执行 ACL 裁决并写访问日志。代理工具包括 KTX MCP 上游工具和 `kx_catalog` 本地目录工具。

## 5. 通用约定

- 所有 `:conn/:schema/:table` 段做白名单存在性校验，不存在 → `404 SOURCE_NOT_FOUND`。
- 写类端点统一支持 `dryRun`，默认 `true`（安全优先：必须显式 `false` 才落盘）。
- 不存在任何返回 `.ktx/secrets/` 内容的端点。

---
_架构设计 by Claude (architect) · 2026-06-15_
