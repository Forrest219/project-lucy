# 2026-11-14-claude-macmini-p0-qa — UAT-SUITE-ANSWER-VERIFIABILITY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ANSWER-VERIFIABILITY` |
| 总账 | P0-4／REQ-030-022 |
| 环境 | 本机 demo Docker `compose-lucy-1`（healthy）+ MCP Proxy `http://127.0.0.1:57881/mcp` |
| Health | lucyVersion=0.30.0；gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690；gitDirty=true；ktxRuntime=ready；policy.healthy=true；execution.loadedConnectionIds=[demo-mysql, invest-db, lucy-ops, mysql-aliyun] |
| Agent | claude |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（指纹 `8e0ae3055cef`）；未写入本跑次正文或任何仓库文件 |
| 跑序 | P0-4（第 4 个） |
| 证据 JSON | [`inbox/uat-p0-macmini-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-macmini-2026-11-14/evidence.json) |

> 版本口径：容器内 gitSha `3aa402c9…` 与仓库 HEAD `9d59337d…` 不一致；委托人 2026-11-14 批准「以当前 demo 原样跑（不 upgrade）」，本跑次验的是**容器内版本**。

## 环境门禁（UAT-R0）

同 `source-ambiguity-gate` 跑次：`compose-lucy-1` healthy；`/api/health` HTTP 200 `ok=true`；MCP `initialize` HTTP 200 带回 `mcp-session-id`（`serverInfo={ktx, 0.16.0}`）。

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | demo／MCP 可用 |
| UAT-AV-01 | **PASS** | 非 error；`rows` 存在；`content[0].text` JSON 顶层含 `answer_verifiability`（sources／caliber／cutoff 三段齐）；`_meta.lucy.answer_verifiability` 存在；`cutoff.status=not_checked` |
| UAT-AV-02 | **PASS** | text／structuredContent／`_meta.lucy` 三载体 `answer_verifiability` 逐字段深比对**无差异** |

### UAT-AV-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单数是多少」，`intentSummary`=「查 demo-mysql 的 superstore_orders 订单数（可核对块）」
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

`content[0].text` 解析后的顶层结构：

```json
{ "answer_verifiability": {
    "schema_version": "1",
    "sources": [ { "connectionId": "demo-mysql", "schema": "dataforai",
                   "sourceName": "superstore_orders", "table": "dataforai.superstore_orders",
                   "display": "demo-mysql.dataforai.superstore_orders" } ],
    "caliber": { "measures": ["superstore_orders.order_count"], "dimensions": [],
                 "segments": ["superstore_orders.active_rows"], "orderBy": [],
                 "userFilters": [], "systemConstraints": [],
                 "caliberBinding": { "status": "none" }, "omissions": {} },
    "cutoff": { "status": "not_checked", "note": "数据截止期未校验" },
    "carriers": { "structuredContent": "projected" } },
  "connectionId": "demo-mysql", "dialect": "mysql",
  "headers": ["order_count"], "rows": [[1000]], "totalRows": 1 }
```

对照断言：

| 断言 | 观测 | 结论 |
|---|---|---|
| 非 error；有 `rows` | `isError=false`；`rows=[[1000]]` | ✅ |
| `content[0].text` JSON 含顶层 `answer_verifiability` | 有（与 `rows`/`totalRows` 同级） | ✅ |
| 块内含 `sources` | 1 条：`demo-mysql.dataforai.superstore_orders` | ✅ |
| 块内含 `caliber` | 有（measures／dimensions／segments／orderBy／userFilters／systemConstraints／caliberBinding／omissions） | ✅ |
| 块内含 `cutoff` | 有，`status=not_checked`（首期允许），`note=数据截止期未校验` | ✅ |
| `_meta.lucy.answer_verifiability` 存在 | 存在 | ✅ |

### UAT-AV-02 三载体一致性（深检）

对同一响应分别取 `content[0].text`→JSON、`structuredContent.answer_verifiability`、`_meta.lucy.answer_verifiability` 三份块，按 key 递归深比对：

| 比对 | 结果 |
|---|---|
| text vs structuredContent | **完全相等** |
| text vs `_meta.lucy` | **完全相等** |
| structuredContent vs `_meta.lucy` | **完全相等** |
| 递归差异清单（key 缺失／类型不同／值不等） | `none` |

顶层键集合亦一致：`['answer_verifiability','connectionId','dialect','headers','rows','sql','totalRows']`（text 与 structuredContent 相同）。

## 套件判定

**PASS**（UAT-R0／UAT-AV-01／UAT-AV-02 全绿；AV-02 为 A-opt 且已实际执行通过）

## 禁止项确认

- 未用 vitest／CR／读代码冒充 PASS —— 判定全部来自真实 MCP `tools/call` 响应
- 未把 Bearer／密码写入本文件、证据 JSON 或任何仓库文件
- 未改产品代码／Spec 合同状态；未改 `docs/qa/uat/INDEX.md`
