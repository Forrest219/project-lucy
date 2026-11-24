# Run — 2026-11-14 — claude-macmini-p0-post-upgrade — UAT-SUITE-ANSWER-VERIFIABILITY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ANSWER-VERIFIABILITY`（答复可核对块 P0-4） |
| Agent | Claude Code（Claude Opus，macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime.status=ready`；`policy.healthy=true`；`execution.activation=current` |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；**未**写入本跑次正文或任何仓库文件 |
| 连接／度量 | `demo-mysql`；`superstore_orders.order_count`；segment `superstore_orders.active_rows` |
| 开始／结束 | 2026-11-14T12:38Z ／ 2026-11-14T12:43Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-post-upgrade-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-post-upgrade-2026-11-14/evidence.json)（`av01` 段；无 secret） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-UPGRADE／UAT-AV-01 全 PASS；A-opt UAT-AV-02 亦 PASS） |

> 版本口径：本波 `gitSha=9d59337d…` **≠** 前次 Wave A 跑次 [`2026-11-14-claude-macmini-p0-qa`](2026-11-14-claude-macmini-p0-qa.md) 的 `gitSha=3aa402c9…`；验的是**容器内实测版本**。

## UAT-R0 — 环境门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `docker compose -f deploy/compose/docker-compose.demo.yml ps` | `compose-lucy-1` healthy（Up 5 hours）；`compose-demo-db-1` healthy | PASS |
| `GET http://127.0.0.1:55176/api/health` | HTTP 200；`ok=true`；`status=ok` | PASS |
| `POST http://127.0.0.1:57881/mcp`（initialize） | HTTP 200；`mcp-session-id` 存在；`serverInfo={name:ktx, version:0.16.0}`；`protocolVersion=2025-03-26` | PASS |

**WebUI／MCP 同实例可用。**

## UAT-R0-UPGRADE — 升级后镜像门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `GET /api/health` → `data.gitSha`／`lucyVersion`／`ktxRuntime` | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`lucyVersion=0.30.0`；`ktxRuntime={status:ready}` | PASS |
| 与前次 Wave A 跑次对照 | 前次 `3aa402c9…`；本波 `9d59337d…` → **不以 `3aa402c9` 为前缀** | PASS |
| 记录本波完整 `gitSha` | 已记录（见上表「环境」行） | PASS |

**结论：升级后镜像门禁 PASS。**

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | demo healthy；health HTTP 200 `ok=true`；MCP initialize 200＋session id |
| UAT-R0-UPGRADE | **PASS** | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；非 `3aa402c9` 前缀；`ktxRuntime=ready` |
| UAT-AV-01 | **PASS** | 非 error；`rows=[[1000]]`、`totalRows=1`；`content[0].text` JSON 顶层含 `answer_verifiability`；块内含 `sources`／`caliber`／`cutoff`（`cutoff.status=not_checked`，合同允许首期未校验）；`_meta.lucy.answer_verifiability` 存在 |
| UAT-AV-02 | **PASS**（A-opt） | 三载体同块且**逐字段相等**：text `answer_verifiability` ＝ `structuredContent.answer_verifiability` ＝ `_meta.lucy.answer_verifiability`（结构化比较均 `True`） |

### UAT-AV-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单数是多少」，`intentSummary`=「单表词查询订单数，验证答复可核对块」
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

实际响应关键字段：

```json
{ "isError": null,
  "headers": ["order_count"],
  "rows": [[1000]],
  "totalRows": 1,
  "answer_verifiability": {
    "schema_version": "1",
    "sources": [{ "connectionId": "demo-mysql", "schema": "dataforai",
                  "sourceName": "superstore_orders", "table": "dataforai.superstore_orders",
                  "display": "demo-mysql.dataforai.superstore_orders" }],
    "caliber": { "measures": ["superstore_orders.order_count"], "dimensions": [],
                 "segments": ["superstore_orders.active_rows"], "orderBy": [],
                 "userFilters": [], "systemConstraints": [],
                 "caliberBinding": { "status": "none" }, "omissions": {} },
    "cutoff": { "status": "not_checked", "note": "数据截止期未校验" },
    "carriers": { "structuredContent": "projected" } },
  "_meta": { "lucy": { "contract": "lucy-r1-controlled-data-service", "tool": "lucy_query",
    "upstreamTool": "sl_query",
    "sources": [{ "connectionId": "demo-mysql", "schema": "dataforai",
                  "sourceName": "superstore_orders", "physicalTable": "dataforai.superstore_orders",
                  "extractionMethod": "field_ref", "confidence": "high" }],
    "guardrails": { "rawSqlAllowed": false, "writeOperationsAllowed": false,
                    "defaultLimit": 100, "maxLimit": 1000, "maxConcurrentQueries": 4,
                    "effectiveLimit": 100 },
    "result": { "rowCount": 1, "columnCount": 1, "truncated": false },
    "provenance": { "connectionId": "demo-mysql", "sourceName": "superstore_orders",
                    "measures": ["superstore_orders.order_count"],
                    "segments": ["superstore_orders.active_rows"],
                    "sourceResolution": "acl_source_map",
                    "freshness": { "status": "not_checked", "tool": "lucy_freshness",
                                   "note": "Call lucy_freshness for metadata freshness before presenting freshness-sensitive answers." } },
    "answer_verifiability": { "...": "与 text 顶层同块" } } } }
```

### UAT-AV-01 期望逐条核对

| 期望 | 实测 | 判定 |
|---|---|---|
| 非 error；有 `rows` | `isError` 缺省（非 true）；`rows=[[1000]]`、`totalRows=1` | PASS |
| `content[0].text` JSON 含顶层 `answer_verifiability` | `text` 解析后顶层 key 含 `answer_verifiability` | PASS |
| 块内含 `sources`／`caliber`／`cutoff` | 块 key = `['schema_version','sources','caliber','cutoff','carriers']` | PASS |
| 首期 `cutoff.status` 可为 `not_checked` | `cutoff.status="not_checked"`、`note="数据截止期未校验"`（诚实披露，未伪造已校验） | PASS |
| `_meta.lucy.answer_verifiability` 存在 | 存在且与 text 块逐字段相等 | PASS |

### UAT-AV-02（A-opt）三载体一致性

| 载体 | 取值路径 | 与 text 块比较 |
|---|---|---|
| text | `result.content[0].text` → JSON 顶层 `answer_verifiability` | 基准 |
| structuredContent | `result.structuredContent.answer_verifiability` | 结构化相等 → `True` |
| `_meta` | `result._meta.lucy.answer_verifiability` | 结构化相等 → `True` |

`carriers.structuredContent="projected"` 与实测一致。

## 套件判定

**PASS** — 必做 UAT-R0／UAT-R0-UPGRADE／UAT-AV-01 全绿；A-opt UAT-AV-02 亦全绿。

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15Z`。
- 清理是否完成：**是**。仅只读查询；未写入台账／内容根／catalog；证据 JSON 已脱敏（64 位 hex 全量扫描＝0 命中）。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 判定来自真实 MCP `tools/call` 响应。
