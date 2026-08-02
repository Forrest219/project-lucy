# Trace / Evidence Kernel API Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Trace / Evidence Kernel API Spec |
| 文档类型 | Architecture / API / Data Contract Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-03；v0.2 更新 2026-08-03（补充 SQLite 并发与测试数据库隔离要求） |
| 关联蓝图 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| 关联总控 | `docs/lucy-202608-upgrade-execution-control.md` |
| 关联工单 | `webui/docs/plans/wo-202608-01-trace-evidence-kernel.md` |
| 适用范围 | append-only trace / evidence event store、MCP Proxy 基础写入、后续 Publish Gate / Eval / Copilot 共用数据契约 |

## 1. Background

Lucy 已有 `access_log`、`access_log_sources`、`conversation_turns`、`inferred_turns` 等审计与问题追踪能力，但 202608 需要把这些能力收敛成统一 `Trace / Evidence Kernel`。本 spec 不废弃既有审计表，而是新增一套 append-only event contract，让 MCP Proxy、semantic publish、Eval、FDE Copilot 和 Dynamic RLS POC 都能写入同一语义。

## 2. Goals

1. 建立 append-only `trace_events` 和 `evidence_events`。
2. 提供服务端 helper，所有模块通过 helper 写事件，不直接拼 SQL。
3. MCP Proxy 在 `tools/call`、policy decision、error / denied 路径写入基础 trace event。
4. 事件只存 hash / metadata；不默认保存原始结果样本。
5. 提供非浏览器自检脚本证明事件不可覆盖、policy decision 可追溯。

## 3. Non-goals

- 不做完整 Visual Debugger UI。
- 不保存完整 SQL AST 原文或结果明细。
- 不替代现有 `access_log` 查询页面。
- 不引入 Kafka、OpenTelemetry collector 或外部 Event Store。
- 不改变 MCP Proxy ACL 判定结果。

## 4. Data Contract

### 4.1 `trace_events`

```sql
CREATE TABLE IF NOT EXISTS trace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  span_type TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  request_id TEXT,
  policy_decision_json TEXT,
  artifact_hashes_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

Indexes:

- `idx_trace_events_trace` on `(trace_id, created_at)`
- `idx_trace_events_turn` on `(turn_id, created_at)`
- `idx_trace_events_type_status` on `(span_type, status, created_at)`

### 4.2 `evidence_events`

```sql
CREATE TABLE IF NOT EXISTS evidence_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_event_id INTEGER,
  trace_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  evidence_version TEXT,
  evidence_hash TEXT,
  relation TEXT NOT NULL,
  reviewer_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(trace_event_id) REFERENCES trace_events(id)
);
```

`relation` values:

- `observed`
- `used`
- `denied_by`
- `superseded`
- `reviewer_override`
- `promoted`

### 4.3 TypeScript Contract

```ts
export type LucySpanType =
  | "reindex"
  | "mcp_initialize"
  | "mcp_tools_list"
  | "mcp_tools_call"
  | "policy_decision"
  | "ktx_retrieval"
  | "sql_plan"
  | "sql_execute"
  | "eval_run"
  | "publish_gate"
  | "copilot_candidate";
```

## 5. Storage Decision

MVP 使用现有 `.ktx-ui/audit.sqlite`，开启 WAL。不得新建第二套审计数据库。若未来迁移到独立 event store，迁移必须保持 event append-only 语义。

SQLite 并发约束：

- `webui/server/trace/evidence.ts` 打开 SQLite 连接时必须设置 `busyTimeout: 5000` 或提供等效 retry 逻辑。
- Trace / Evidence 写入 helper 必须能在短暂 writer lock 下重试或等待，不应立刻把 `SQLITE_BUSY` 暴露给调用者。
- 测试和自检脚本必须使用 `:memory:` 或独立 temp SQLite 文件，禁止写真实 `.ktx-ui/audit.sqlite`。
- 并行 subagent 执行时，不得共享同一个 test DB path。

## 6. API And Helper Surface

Create `webui/server/trace/evidence.ts`:

- `ensureTraceEvidenceSchema(database)`
- `writeTraceEvent(event): Promise<number>`
- `writeEvidenceEvents(traceEventId, traceId, evidenceRefs)`
- `listTraceEvents(filter)`
- `hashArtifact(value)`

Optional admin API:

- `GET /api/trace/events?traceId=<id>`
- `GET /api/trace/events?turnId=<id>`

The admin API is read-only in MVP.

## 7. MCP Proxy Integration

`webui/server/proxy/mcp-proxy.ts` must write:

- `mcp_tools_call` span for each `tools/call`.
- `policy_decision` event when ACL allows / denies / warns.
- Evidence refs for `access_policy`, `semantic_yaml_node` when already available through `access_log_sources`.
- `result_snapshot_hash` metadata only when response row / column count is known.

Failure to write trace must not break MCP request handling, but must be logged server-side and counted by self-validation script.

## 8. Safety Rules

- Do not store token plaintext.
- Do not store full result rows by default.
- Do not overwrite event rows.
- Do not update event rows except SQLite internal indexes; correction uses new `superseded` or `reviewer_override` event.
- Do not expose raw args containing secrets through `metadata_json`.

## 9. Acceptance Criteria

- Schema migration is idempotent.
- WAL mode is enabled.
- Inserting the same logical event twice creates two event rows, not an overwrite.
- A denied MCP call creates a trace event with policy decision.
- Trace lookup by `traceId` returns ordered events and evidence refs.
- Existing `access_log` behavior remains compatible.
- Concurrent test execution does not touch the production audit SQLite file.

## 10. Self-validation Script

The work order must create:

```text
scripts/verify-202608-trace-evidence.mjs
```

The script must:

1. Use a temp SQLite database.
2. Run schema setup twice.
3. Insert two events with same `traceId` and assert two rows exist.
4. Insert `access_policy` and `result_snapshot_hash` evidence refs.
5. Assert no column exists for raw token or raw result payload.
6. Assert `busyTimeout` or retry behavior is configured.
7. Assert the script does not create or modify `.ktx-ui/audit.sqlite`.

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `Trace Event`: append-only event row for a platform operation span.
- `Evidence Event`: append-only evidence ref attached to a trace.

Protected terms: `Trace`、`Evidence`、`Agent`、`MCP`、`KTX`、`Eval`、`SQL AST`、`Token`、`access.yaml`、`semantic-layer`。
