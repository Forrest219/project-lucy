# 2026-11-14-claude-macmini-p0-qa — UAT-SUITE-EMPTY-NEXT-STEP

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-EMPTY-NEXT-STEP` |
| 总账 | P0-5／REQ-030-018 |
| 环境 | 本机 demo Docker `compose-lucy-1`（healthy）+ MCP Proxy `http://127.0.0.1:57881/mcp` |
| Health | lucyVersion=0.30.0；gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690；gitDirty=true；ktxRuntime=ready；policy.healthy=true；execution.loadedConnectionIds=[demo-mysql, invest-db, lucy-ops, mysql-aliyun] |
| Agent | claude |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（指纹 `8e0ae3055cef`）；未写入本跑次正文或任何仓库文件 |
| 跑序 | P0-5（第 5 个） |
| 证据 JSON | [`inbox/uat-p0-macmini-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-macmini-2026-11-14/evidence.json) |

> 版本口径：容器内 gitSha `3aa402c9…` 与仓库 HEAD `9d59337d…` 不一致；委托人 2026-11-14 批准「以当前 demo 原样跑（不 upgrade）」，本跑次验的是**容器内版本**。

## 环境门禁（UAT-R0）

同 `source-ambiguity-gate` 跑次：`compose-lucy-1` healthy；`/api/health` HTTP 200 `ok=true`；MCP `initialize` HTTP 200 带回 `mcp-session-id`（`serverInfo={ktx, 0.16.0}`）。

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | demo／MCP 可用 |
| UAT-EMPTY-01 | **PASS** | `rows=[]`；`totalRows=0`；`next_step.kind="empty_result"`，含 `suggestions`(3)＋`next_tools`(2)＋`hint`；同时含 `answer_verifiability` |
| UAT-EMPTY-02 | **PASS** | 聚合对照：`rows=[[0]]`／`totalRows=1`；**无** `next_step`；含 AV —— 与 EMPTY-01 合同区分成立，未被当作 EMPTY-01 替身 |

### UAT-EMPTY-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单明细行」，`intentSummary`=「查 demo-mysql superstore_orders 订单明细行（空结果路径）」
2. `lucy_query`：
   - `connectionId=demo-mysql`
   - `dimensions=[{"field":"superstore_orders.order_id"}]`
   - `filters=[{"field":"superstore_orders.order_id","op":"eq","value":"__uat_no_such_order_xyz__"}]`
   - `measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

实际响应（截取）：

```json
{ "isError": false,
  "answer_verifiability": { "sources": [ { "connectionId": "demo-mysql", "schema": "dataforai",
                   "sourceName": "superstore_orders" } ],
    "cutoff": { "status": "not_checked" } },
  "headers": ["order_count"], "rows": [], "totalRows": 0,
  "next_step": {
    "kind": "empty_result",
    "summary": "本次查询返回 0 行事实数据。",
    "query": { "connectionId": "demo-mysql", "sourceName": "superstore_orders",
               "measures": ["superstore_orders.order_count"],
               "dimensions": [{ "field": "superstore_orders.order_id" }],
               "filters": { "kind": "list", "count": 1,
                            "items": [{ "kind": "structured",
                                        "field": "superstore_orders.order_id",
                                        "op": "eq", "valueCount": 1 }] } },
    "suggestions": [ "放宽过滤条件（公司 / 产品线 / 时间范围）后重查",
                     "确认目标期间落在该 source 的数据可用周期内",
                     "确认问题的时间粒度与该 source 的粒度一致" ],
    "next_tools": [ "lucy_read_source", "lucy_freshness" ],
    "hint": "在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。" } }
```

对照断言：

| 断言 | 观测 | 结论 |
|---|---|---|
| `rows` 空数组且 `totalRows=0` | `rows=[]`；`totalRows=0` | ✅ |
| 载荷含 `next_step`（`kind=empty_result`） | 有，`kind=empty_result` | ✅ |
| 含 `suggestions`／`next_tools` | `suggestions` 3 条；`next_tools=[lucy_read_source, lucy_freshness]` | ✅ |

### UAT-EMPTY-02 聚合 0 对照（边界）

同一不可能命中的 filter，但**不带 dimensions**（聚合路径）：

| 观测 | 值 |
|---|---|
| `rows` | `[[0]]` |
| `totalRows` | `1` |
| `next_step` | **不存在**（text 与 `_meta.lucy` 均无） |
| `answer_verifiability` | 存在；`caliber.caliberBinding.status="none"`；`cutoff.status=not_checked` |

判定：空事实（`rows=[]`／`totalRows=0` ＋ `next_step`）与聚合 0（`rows=[[0]]`／`totalRows=1`／无 `next_step`）在本实现中**可区分**；本跑次未以聚合 0 冒充 EMPTY-01 PASS，两条各自独立取证。

## 套件判定

**PASS**（UAT-R0／UAT-EMPTY-01／UAT-EMPTY-02 全绿；EMPTY-02 为 A-opt 且已实际执行通过）

## 禁止项确认

- 未用 vitest／CR／读代码冒充 PASS —— 判定全部来自真实 MCP `tools/call` 响应
- 未把 Bearer／密码写入本文件、证据 JSON 或任何仓库文件
- 未改产品代码／Spec 合同状态；未改 `docs/qa/uat/INDEX.md`
- 未用「聚合 count=0 单行」冒充 UAT-EMPTY-01 PASS
