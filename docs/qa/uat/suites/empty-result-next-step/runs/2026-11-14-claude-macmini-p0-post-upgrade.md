# Run — 2026-11-14 — claude-macmini-p0-post-upgrade — UAT-SUITE-EMPTY-NEXT-STEP

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-EMPTY-NEXT-STEP`（空结果下一步 P0-5） |
| Agent | Claude Code（Claude Opus，macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime.status=ready`；`policy.healthy=true`；`execution.activation=current` |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；**未**写入本跑次正文或任何仓库文件 |
| 连接／夹具 | `demo-mysql`；维度 `superstore_orders.order_id`；不命中过滤值 `__uat_no_such_order_xyz__`；度量 `superstore_orders.order_count`；segment `superstore_orders.active_rows` |
| 开始／结束 | 2026-11-14T12:38Z ／ 2026-11-14T12:43Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-post-upgrade-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-post-upgrade-2026-11-14/evidence.json)（`empty01`／`empty02` 段；无 secret） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-UPGRADE／UAT-EMPTY-01 全 PASS；A-opt UAT-EMPTY-02 亦 PASS） |

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
| UAT-EMPTY-01 | **PASS** | `rows=[]`、`totalRows=0`；载荷顶层含 `next_step`（`kind=empty_result`），含 `suggestions`（3 条）／`next_tools`（`lucy_read_source`／`lucy_freshness`）；`_meta.lucy.next_step` 同块；**非**「聚合 count=0 单行」 |
| UAT-EMPTY-02 | **PASS**（A-opt） | 无维度聚合对照：`rows=[[0]]`、`totalRows=1`、`headers=["order_count"]`、有 `answer_verifiability`、**无** `next_step` → 与 EMPTY-01 形态正确区分，未被当作 EMPTY-01 替代 |

### UAT-EMPTY-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单明细行」，`intentSummary`=「按订单明细查询，用不可能命中的过滤值验证空结果下一步」
2. `lucy_query`：`connectionId=demo-mysql`，`dimensions=[{"field":"superstore_orders.order_id"}]`，`filters=[{"field":"superstore_orders.order_id","op":"eq","value":"__uat_no_such_order_xyz__"}]`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

实际响应关键字段：

```json
{ "isError": null,
  "headers": ["order_id","order_count"],
  "rows": [],
  "totalRows": 0,
  "sql": "SELECT superstore_orders.order_id AS order_id, COUNT(DISTINCT CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.order_id END) AS order_count FROM dataforai.superstore_orders AS superstore_orders WHERE superstore_orders.order_id = '__uat_no_such_order_xyz__' GROUP BY superstore_orders.order_id ORDER BY 1 LIMIT 100",
  "next_step": {
    "kind": "empty_result",
    "summary": "本次查询返回 0 行事实数据。",
    "query": { "connectionId": "demo-mysql", "sourceName": "superstore_orders",
      "measures": ["superstore_orders.order_count"],
      "dimensions": [{ "field": "superstore_orders.order_id" }],
      "filters": { "kind": "list", "count": 1,
                   "items": [{ "kind": "structured", "field": "superstore_orders.order_id",
                               "op": "eq", "valueCount": 1 }] } },
    "suggestions": ["放宽过滤条件（公司 / 产品线 / 时间范围）后重查",
                    "确认目标期间落在该 source 的数据可用周期内",
                    "确认问题的时间粒度与该 source 的粒度一致"],
    "next_tools": ["lucy_read_source","lucy_freshness"],
    "hint": "在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。" },
  "answer_verifiability": { "schema_version": "1",
    "sources": [{ "connectionId": "demo-mysql", "schema": "dataforai",
                  "sourceName": "superstore_orders", "table": "dataforai.superstore_orders" }],
    "caliber": { "measures": ["superstore_orders.order_count"],
                 "dimensions": ["superstore_orders.order_id"],
                 "segments": ["superstore_orders.active_rows"],
                 "userFilters": [{ "form": "structured", "field": "superstore_orders.order_id",
                                   "op": "eq", "valueRedacted": true, "valueLength": 25 }],
                 "caliberBinding": { "status": "none" }, "omissions": {} },
    "cutoff": { "status": "not_checked", "note": "数据截止期未校验" } } }
```

### UAT-EMPTY-01 期望逐条核对

| 期望 | 实测 | 判定 |
|---|---|---|
| `rows` 为空数组且 `totalRows=0` | `rows=[]`、`totalRows=0` | PASS |
| 载荷含 `next_step`（`kind=empty_result` 或等价） | 顶层 `next_step.kind="empty_result"`；`_meta.lucy.next_step` 同块 | PASS |
| 含 `suggestions`／`next_tools` | `suggestions` 3 条；`next_tools=["lucy_read_source","lucy_freshness"]` | PASS |
| 不得用「聚合 count=0 单行」冒充本条 PASS | 本条 `rows=[]`／`totalRows=0`，`headers=["order_id","order_count"]`（带维度分组），与下方 EMPTY-02 的 `rows=[[0]]`／`totalRows=1` 形态明确不同 | PASS |

### UAT-EMPTY-02（A-opt）聚合 0 对照

同一过滤值、**去掉 dimensions** 后的对照查询：

```json
{ "isError": null,
  "headers": ["order_count"],
  "rows": [[0]],
  "totalRows": 1,
  "sql": "SELECT COUNT(DISTINCT CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.order_id END) AS order_count FROM dataforai.superstore_orders AS superstore_orders WHERE superstore_orders.order_id = '__uat_no_such_order_xyz__' LIMIT 100",
  "answer_verifiability": { "...": "存在（首期 cutoff.status=not_checked）" } }
```

`rows=[[0]]` 有 AV、**无** `next_step` → 聚合 0 与 0 行事实被正确区分，EMPTY-02 未被当作 EMPTY-01 的替代证据。

## 套件判定

**PASS** — 必做 UAT-R0／UAT-R0-UPGRADE／UAT-EMPTY-01 全绿；A-opt UAT-EMPTY-02 亦全绿。

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15Z`。
- 清理是否完成：**是**。仅只读查询（不命中过滤值，无数据副作用）；MCP 会话随进程丢弃；未写入台账／内容根／catalog；证据 JSON 已脱敏（64 位 hex 全量扫描＝0 命中）。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 判定来自真实 MCP `tools/call` 响应。
