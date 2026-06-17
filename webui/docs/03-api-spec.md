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

## 4. 通用约定

- 所有 `:conn/:schema/:table` 段做白名单存在性校验，不存在 → `404 SOURCE_NOT_FOUND`。
- 写类端点统一支持 `dryRun`，默认 `true`（安全优先：必须显式 `false` 才落盘）。
- 不存在任何返回 `.ktx/secrets/` 内容的端点。

---
_架构设计 by Claude (architect) · 2026-06-15_
