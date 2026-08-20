# 09 · Lucy R1 MCP Tool Contract

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy R1 MCP Tool Contract |
| 文档类型 | Runtime Contract |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-02 |
| 适用范围 | Lucy MCP Proxy R1 tool surface、Agent 接入、contract eval、审计与发布门禁 |

## 1. 设计原则

Lucy R1 对 Agent 暴露少而硬的 MCP 工具面。Agent 不需要知道底层 KTX upstream tool 名、数据库 driver、Doris FE 地址或数据库凭据。

R1 发布 token 的 `tools/list` 必须是 exact tool surface：只暴露 6 个 R1 `lucy_*` 工具，不得额外暴露 `sl_query`、`sl_read_source`、`kx_catalog`、`wiki_search` 或其他非 R1 工具。这些兼容工具可以继续作为 proxy 内部上游适配目标或 legacy token 兼容面存在，但不能成为 R1 Agent 可直接调用的工具面。

安全边界：

- `tools/list` 必须 role-aware。
- `tools/call` 必须再次执行 Policy Runtime。
- instructions 只做行为引导，不作为授权边界。
- 不可见 connection/source/table/view 不得出现在 catalog、instructions 或 error detail 中。
- 直接 raw SQL 工具默认不暴露；即使内部存在，也必须被 `defaults.deny_tools` 和 ACL 拦截。

## 2. 工具面

R1 稳定工具集：

| Tool | 类型 | 上游关系 | 作用 |
|---|---|---|---|
| `lucy_catalog` | proxy-local | 无 | 返回当前 role 可见 connection/source/catalog 摘要 |
| `lucy_read_source` | proxy wrapper | `sl_read_source` | 读取单个已授权 source 的字段、指标、语义和限制 |
| `lucy_query` | proxy wrapper | `sl_query` | 执行受控语义查询，并附加 Lucy R1 metadata |
| `lucy_explain_query` | proxy-local | 无执行 | 解释同一参数会如何被 Policy / Guardrail / source resolver 处理 |
| `lucy_freshness` | proxy-local | 无 | 返回单个已授权 source 的 freshness metadata |
| `lucy_begin_question` | proxy-local | 无 | 标记一次业务问题，用于 question-level audit trace |

兼容工具如 `sl_query`、`sl_read_source`、`kx_catalog`、`wiki_search` 可以继续存在，但 R1 发布 token 只能暴露上表 6 个 `lucy_*` 稳定工具契约；legacy token 是否继续暴露旧工具不属于 R1 发布证据。

## 3. 统一返回约定

所有 tool call 保持 MCP JSON-RPC envelope：

```jsonc
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {
    "content": [{ "type": "text", "text": "{...}" }],
    "_meta": {
      "lucy": {
        "contract": "lucy-r1-controlled-data-service"
      }
    }
  }
}
```

`lucy_query` 和 `lucy_read_source` 需要在返回 `_meta.lucy` 中包含：

```jsonc
{
  "contract": "lucy-r1-controlled-data-service",
  "tool": "lucy_query",
  "upstreamTool": "sl_query",
  "sources": [],
  "guardrails": {
    "rawSqlAllowed": false,
    "writeOperationsAllowed": false,
    "defaultLimit": 100,
    "maxLimit": 1000,
    "maxConcurrentQueries": 4,
    "effectiveLimit": 100
  },
  "result": {
    "rowCount": 10,
    "columnCount": 3,
    "truncated": false
  },
  "provenance": {
    "connectionId": "doris-r1",
    "sourceName": "ceo_metric_snapshot",
    "measures": ["ceo_metric_snapshot.revenue"],
    "dimensions": [{ "field": "ceo_metric_snapshot.biz_date" }],
    "filters": [{ "field": "ceo_metric_snapshot.biz_date", "op": ">=", "value": "2026-07-01" }],
    "segments": ["ceo_metric_snapshot.active_rows"],
    "orderBy": [{ "field": "ceo_metric_snapshot.revenue", "direction": "desc" }],
    "sourceResolution": "acl_source_map",
    "freshness": {
      "status": "not_checked",
      "tool": "lucy_freshness",
      "note": "Call lucy_freshness for metadata freshness before presenting freshness-sensitive answers."
    },
    "truncation": "reported from upstream response"
  }
}
```

## 4. 错误码与拒绝 reason

MCP 层错误：

| 场景 | 行为 |
|---|---|
| 未认证 | HTTP 401，JSON-RPC `-32001` |
| `tools/list` 过滤失败 | JSON-RPC `-32003`，fail-closed |
| upstream 不可用且本地 fallback 可用 | 返回本地 initialize/tools-list/wiki fallback，并写 audit reason |
| `tools/call` upstream 超时 | JSON-RPC `-32003`，reason=`source_timeout`，写 source-aware audit |
| upstream 不可用且不可 fallback | JSON-RPC `-32003` 或 HTTP 502，reason=`upstream_unavailable` |

Policy / Guardrail 拒绝以 MCP tool result 的 `isError: true` 返回，并写 audit：

| Reason | 含义 |
|---|---|
| `tool_forbidden` | 当前 token/role 未授权该 tool |
| `tool_forbidden_global` | 全局 deny tool |
| `agent_disabled` | Agent 被禁用 |
| `invalid_arguments:<tool>:<field>` | Lucy 工具参数结构不满足 R1 契约，Proxy 层 fail-closed，且不得转发到上游 |
| `raw_query_forbidden` | 参数包含 `query` / `sql` raw string |
| `table_forbidden:<table>` | 命中未授权表 |
| `unknown_or_forbidden_connection:<connection>` | 连接不可见或未授权 |
| `explicit_table_required:<table>` | 敏感 metadata 需要显式表级授权 |
| `sensitive_metadata_forbidden:<scope>` | 敏感 metadata 工具被限制 |
| `role_resolution_failed:<role>` | role 解析失败 |
| `query_concurrency_exceeded` | 当前 token 同时执行的 `lucy_query` 超过 `LUCY_QUERY_MAX_INFLIGHT` |
| `source_timeout` | 上游查询超时 |
| `upstream_unavailable` | 上游不可用且无本地 fallback |

这些 reason 必须进入 `access_log.decision_reason` 或 `error_detail`，供 audit/export/observability 使用。

## 5. Tool 细节

### `lucy_catalog`

输入：

```json
{}
```

输出：

- `connections`: 当前 role 可见 connection id。
- `sources`: 当前 role 可见 source，含 `connectionId`、`schema`、`sourceName`、`table`。
- `examples`: 可安全展示给 Agent 的查询例子。
- `filteredBy`: `effective_permissions`。

不得返回不可见 source/table/view。

### `lucy_read_source`

输入：

```jsonc
{
  "connectionId": "doris-r1",
  "sourceName": "ceo_metric_snapshot"
}
```

行为：

- Proxy 先校验参数结构；缺少 `connectionId` / `sourceName` 或类型错误时返回 `invalid_arguments:*`。
- Policy Runtime 校验 tool、connection、source/table。
- Proxy 改写为 upstream `sl_read_source`。
- 返回 `_meta.lucy`。
- audit 写入 source refs、duration、response bytes。

### `lucy_query`

输入：

```jsonc
{
  "connectionId": "doris-r1",
  "sourceName": "ceo_metric_snapshot",
  "measures": ["ceo_metric_snapshot.revenue"],
  "dimensions": [{ "field": "ceo_metric_snapshot.biz_date" }],
  "filters": [
    { "field": "ceo_metric_snapshot.region", "op": "contains", "value": "华南" }
  ],
  "segments": [],
  "order_by": [{ "field": "ceo_metric_snapshot.biz_date", "direction": "asc" }],
  "limit": 100
}
```

Guardrail：

- Proxy 先校验参数结构；缺少 `connectionId`、查询 shape 为空或类型错误时返回 `invalid_arguments:*`，不得转发到 Doris/目标源。
- `query` / `sql` raw string 一律拒绝。
- `filters` 对外支持 string filter 和 `{field, op, value/values}` 结构化 filter；Proxy 转发上游 `sl_query` 前会规范化为 KTX 接受的 string filters。
  - `op` 使用白名单归一化：`eq`/`equals`/`is` → `=`，`neq`/`not_equals`/`is_not` → `!=`，`gt`/`gte`/`lt`/`lte` → `>`/`>=`/`<`/`<=`，`include`/`includes`/`match`/`matches` → `contains`，`startswith`/`prefix` → `starts_with`，`endswith`/`suffix` → `ends_with`。
  - 未知或模糊 `op` 继续 fail closed，返回 `invalid_arguments:*:filters_op_unsupported`。
- `limit` 默认 `LUCY_QUERY_DEFAULT_LIMIT`，上限 `LUCY_QUERY_MAX_LIMIT`。
- 并发默认每 token 最多 `LUCY_QUERY_MAX_INFLIGHT=4` 个 in-flight `lucy_query`，超限返回 `query_concurrency_exceeded` 并写 denied audit。
- DDL/DML 不得通过 Lucy 暴露。
- 参数中 source/table refs 必须都在当前 role 的 allowlist 内。
- 结果 row/column/truncation 写入 `_meta.lucy.result`，并由 audit best-effort 记录。

### `lucy_explain_query`

输入同 `lucy_query`。

输出：

- `allowed`: 仅表示当前 explain call 已通过 ACL；不代表未来执行一定成功。
- `requestedSources`: source resolver 命中的 source refs。
- `guardrails`: raw SQL、write operation、limit、truncation 策略。
- `policy`: role ids、connections、source map version、permission snapshot hash。
- `provenance`: 决策说明。

该工具不得执行查询。

### `lucy_freshness`

输入：

```jsonc
{
  "connectionId": "doris-r1",
  "sourceName": "ceo_metric_snapshot"
}
```

输出：

- `mode: metadata_only`。
- `semanticLayerUpdatedAt`。
- `physicalDataUpdatedAt: null`，当物理 freshness 不在当前 source contract 中时必须显式为空。
- 不得伪造物理更新时间。

### `lucy_begin_question`

输入：

```jsonc
{
  "intentSummary": "CEO wants revenue trend by business date",
  "question": "最近 30 天收入趋势如何？",
  "entities": ["revenue", "biz_date"]
}
```

行为：

- 写入 `conversation_turns`。
- 返回 `turnId`。
- 后续同 identity 的 tool call 会在 attach window 内自动关联该 turn。
- `question` 做 PII/sensitive redaction 后才可存 preview。
- 缺少 `intentSummary` 返回 `isError: true`。
- **Recommended when available / never blocking**：工具可选但推荐；有用户原话时优先填 `question`。漏调或写库失败不得阻断后续 catalog / query 等业务工具。

## 6. Contract Eval 要点

必须覆盖：

- `tools/list` 只暴露当前 role 可见 tools。
- R1 token 的 `tools/list` 是 exact tool surface：6 个 R1 `lucy_*` 工具必须齐全，`checkDetails.toolSurface.extraTools` 必须为空。
- 每个 R1 tool 必须有稳定 `inputSchema`；contract smoke evidence 的 `checkDetails.toolSchemas.schemaMissing` 与 `checkDetails.toolSchemas.invalidSchemas` 必须为空，并保留 `expectedRequired`。
- R1 token 的 `tools/list` 不暴露 `sl_query` / `sl_read_source`。
- `lucy_catalog` 不泄露不可见 source。
- contract smoke 必须包含禁止工具、不可见 source、禁止 measure/table 三类负样本。
- contract smoke evidence 必须由 `scripts/lucy-r1-mcp-contract-smoke.mjs` 生成，并保留 `checkDetails`：三类负样本、上游语义工具隐藏列表、隐藏工具列表、禁止工具直调拒绝 reason、catalog 泄露列表、禁止 measure/table 拒绝 reason、`runtimeArgumentValidation.probes`、limit cap 数值和 Lucy metadata 判断。
- 直接调用禁止工具必须返回 `tool_forbidden` 或 `tool_forbidden_global`。
- `lucy_query` 访问禁止 measure/table 必须返回 `table_forbidden:*` 或等价拒绝 reason。
- `lucy_query` malformed arguments probe 必须返回 `invalid_arguments:*`，且不能打到 Doris/目标源。
- `lucy_query` raw SQL 拦截。
- `lucy_query` limit capped。
- `lucy_query` 成功响应的 `_meta.lucy.guardrails.effectiveLimit <= maxLimit`。
- `lucy_query` 成功响应的 `_meta.lucy.result` 包含 `rowCount`、`columnCount`、`truncated`。
- `lucy_query` 上游超时必须返回 `source_timeout`，并写入带 source attribution 的 audit。
- `lucy_read_source` 成功响应必须包含 `_meta.lucy.contract`。
- `lucy_read_source` / `lucy_query` upstream rewrite 正确。
- `_meta.lucy.contract == "lucy-r1-controlled-data-service"`。
- denied call 写 audit reason。
- `lucy_begin_question` 与后续 call 绑定；Hermes benchmark 每题必须有唯一 Lucy trace，且每个 benchmark case 只能提交一次。
- `/api/r1/observability` 能读取 denied/source/eval/Hermes 信号。

## 7. 版本兼容

R1 contract 的兼容规则：

- 可以新增 `_meta.lucy` 字段。
- 不得删除现有 `lucy_*` tool。
- 不得放宽 raw SQL / DDL / DML guardrail。
- 不得让不可见资产进入 `tools/list`、catalog 或 initialize instructions。
- `lucy_query` 默认 limit 和 max limit 可以收紧，放宽必须重新跑安全回归和 Hermes benchmark。
