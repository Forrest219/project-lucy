# 2026-11-14-claude-macmini-p0-qa — UAT-SUITE-CALIBER-BINDING

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CALIBER-BINDING` |
| 总账 | P0-1／REQ-030-027 |
| 环境 | 本机 demo Docker `compose-lucy-1`（healthy）+ MCP Proxy `http://127.0.0.1:57881/mcp` |
| Health | lucyVersion=0.30.0；gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690；gitDirty=true；ktxRuntime=ready；policy.healthy=true；execution.loadedConnectionIds=[demo-mysql, invest-db, lucy-ops, mysql-aliyun] |
| Agent | claude |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（指纹 `8e0ae3055cef`）；未写入本跑次正文或任何仓库文件 |
| 跑序 | P0-1（第 2 个） |
| 证据 JSON | [`inbox/uat-p0-macmini-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-macmini-2026-11-14/evidence.json) |

> 版本口径：容器内 gitSha `3aa402c9…` 与仓库 HEAD `9d59337d…` 不一致；委托人 2026-11-14 批准「以当前 demo 原样跑（不 upgrade）」，本跑次验的是**容器内版本**。

## 环境门禁（UAT-R0）

同 `source-ambiguity-gate` 跑次：`compose-lucy-1` healthy；`/api/health` HTTP 200 `ok=true`；MCP `initialize` HTTP 200 带回 `mcp-session-id`（`serverInfo={ktx, 0.16.0}`）。

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | demo／MCP 可用 |
| UAT-CALIBER-01 | **PASS** | 非 error；`caliberBinding.status="none"`；`rows=[[1000]]`；`totalRows=1`；`cutoff.status=not_checked` |
| UAT-CALIBER-02 | **NOT INCLUDED（Wave B 推迟）** | 委托人 2026-11-14 批准 Wave B 推迟；本波未纳入（需 published caliber-binding 夹具落盘 demo contentRoot） |

### UAT-CALIBER-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单数是多少」（单表词，避免歧义门闩），`intentSummary`=「查 demo-mysql 的 superstore_orders 订单数（单表词）」
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

实际响应（截取）：

```json
{ "isError": false,
  "answer_verifiability": {
    "sources": [ { "connectionId": "demo-mysql", "schema": "dataforai",
                   "sourceName": "superstore_orders", "table": "dataforai.superstore_orders" } ],
    "caliber": { "measures": ["superstore_orders.order_count"],
                 "dimensions": [], "segments": ["superstore_orders.active_rows"],
                 "orderBy": [], "userFilters": [], "systemConstraints": [],
                 "caliberBinding": { "status": "none" }, "omissions": {} },
    "cutoff": { "status": "not_checked", "note": "数据截止期未校验" } },
  "headers": ["order_count"], "rows": [[1000]], "totalRows": 1 }
```

对照断言：

| 断言 | 观测 | 结论 |
|---|---|---|
| 成功载荷（非 `isError`） | `isError=false` | ✅ |
| `answer_verifiability.caliber.caliberBinding.status === "none"` | `"none"` | ✅ |
| 有数值行 | `headers=["order_count"]`、`rows=[[1000]]`、`totalRows=1` | ✅ |

事实来源 SQL（响应回传，非本跑次自造）：

```sql
SELECT COUNT(DISTINCT CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.order_id END)
AS order_count FROM dataforai.superstore_orders AS superstore_orders LIMIT 100
```

> 备注：demo 内容根当前无命中本问句的 published `caliber-bindings`（现行 demo 常态），符合 UAT-CALIBER-01 前置「零绑定不强制」。

## 套件判定

**PASS**（必做 UAT-R0／UAT-CALIBER-01 全绿；UAT-CALIBER-02 按审批「Wave B 推迟／未纳入」登记，未降级为 PASS）

## 禁止项确认

- 未用 vitest／CR／读代码冒充 PASS —— 判定全部来自真实 MCP `tools/call` 响应
- 未把 Bearer／密码写入本文件、证据 JSON 或任何仓库文件
- 未改产品代码／Spec 合同状态；未改 `docs/qa/uat/INDEX.md`
- 未把 Wave B 推迟的用例写成 PASS
