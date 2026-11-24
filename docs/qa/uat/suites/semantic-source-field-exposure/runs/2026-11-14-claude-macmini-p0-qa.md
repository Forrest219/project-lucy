# 2026-11-14-claude-macmini-p0-qa — UAT-SUITE-FIELD-EXPOSURE

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-FIELD-EXPOSURE` |
| 总账 | P0-A／REQ-030-012 |
| 环境 | 本机 demo Docker `compose-lucy-1`（healthy）+ MCP Proxy `http://127.0.0.1:57881/mcp` |
| Health | lucyVersion=0.30.0；gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690；gitDirty=true；ktxRuntime=ready；policy.healthy=true；execution.loadedConnectionIds=[demo-mysql, invest-db, lucy-ops, mysql-aliyun] |
| Agent | claude |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（指纹 `8e0ae3055cef`）；未写入本跑次正文或任何仓库文件 |
| 跑序 | P0-A（第 3 个） |
| 证据 JSON | [`inbox/uat-p0-macmini-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-macmini-2026-11-14/evidence.json) |

> 版本口径：容器内 gitSha `3aa402c9…` 与仓库 HEAD `9d59337d…` 不一致；委托人 2026-11-14 批准「以当前 demo 原样跑（不 upgrade）」，本跑次验的是**容器内版本**。

## 环境门禁（UAT-R0）

同 `source-ambiguity-gate` 跑次：`compose-lucy-1` healthy；`/api/health` HTTP 200 `ok=true`；MCP `initialize` HTTP 200 带回 `mcp-session-id`（`serverInfo={ktx, 0.16.0}`）。

## 前置确认（暴露台账状态）

| 检查 | 观测 |
|---|---|
| `docker exec compose-lucy-1 ls -la /data/lucy/.ktx-ui/field-exposure/` | rc=2；`No such file or directory` → **demo 无 field-exposure 台账**（全暴露基线，符合 UAT-EXPOSURE-01 前置） |

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | demo／MCP 可用 |
| UAT-EXPOSURE-01 | **PASS** | 查询成功 `rows=[[1000]]`／`totalRows=1`；全响应无 `field_not_exposed`；无无故拒绝 |
| UAT-EXPOSURE-02 | **NOT INCLUDED（Wave B 推迟）** | 委托人 2026-11-14 批准 Wave B 推迟；本波未纳入（需 field-exposure 台账夹具落盘） |

### UAT-EXPOSURE-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单数是多少」，`intentSummary`=「查 demo-mysql 的 superstore_orders 订单数（暴露基线）」
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

实际响应（截取）：

```json
{ "isError": false,
  "answer_verifiability": { "sources": [ { "connectionId": "demo-mysql", "schema": "dataforai",
                   "sourceName": "superstore_orders" } ],
    "caliber": { "measures": ["superstore_orders.order_count"],
                 "segments": ["superstore_orders.active_rows"],
                 "caliberBinding": { "status": "none" } },
    "cutoff": { "status": "not_checked" } },
  "headers": ["order_count"], "rows": [[1000]], "totalRows": 1 }
```

对照断言：

| 断言 | 观测 | 结论 |
|---|---|---|
| 成功返回数值 | `rows=[[1000]]`、`totalRows=1`、`isError=false` | ✅ |
| 不得因暴露台账无故拒绝 | 整段 MCP 响应（`content`＋`structuredContent`＋`_meta`）全文检索 **无** `field_not_exposed` | ✅ |
| 前置：demo 无暴露台账 → 全暴露 | `/data/lucy/.ktx-ui/field-exposure/` 不存在 | ✅ |

> 注意：本条断言以「合法查询成功 + 无 `field_not_exposed`」为 PASS，未用「列不存在」类上游错误冒充 `field_not_exposed` 命中。

## 套件判定

**PASS**（必做 UAT-R0／UAT-EXPOSURE-01 全绿；UAT-EXPOSURE-02 按审批「Wave B 推迟／未纳入」登记，未降级为 PASS）

## 禁止项确认

- 未用 vitest／CR／读代码冒充 PASS —— 判定全部来自真实 MCP `tools/call` 响应
- 未把 Bearer／密码写入本文件、证据 JSON 或任何仓库文件
- 未改产品代码／Spec 合同状态；未改 `docs/qa/uat/INDEX.md`
- 未把「列不存在」上游错误冒充 `field_not_exposed` PASS
