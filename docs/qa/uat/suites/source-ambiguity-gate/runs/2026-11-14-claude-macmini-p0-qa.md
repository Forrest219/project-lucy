# 2026-11-14-claude-macmini-p0-qa — UAT-SUITE-SOURCE-AMBIGUITY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY` |
| 总账 | P0-3／REQ-030-024 |
| 环境 | 本机 demo Docker `compose-lucy-1`（healthy，Up 23 hours）+ MCP Proxy `http://127.0.0.1:57881/mcp` |
| Health | lucyVersion=0.30.0；gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690；gitDirty=true；ktxRuntime=ready；bundledKtxVersion=0.16.0；policy.healthy=true；execution.loadedConnectionIds=[demo-mysql, invest-db, lucy-ops, mysql-aliyun]；execution.activation=current |
| Agent | claude |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；未写入本跑次正文或任何仓库文件 |
| 跑序 | P0-3（第 1 个） |
| 证据 JSON | [`inbox/uat-p0-macmini-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-macmini-2026-11-14/evidence.json) |

> 版本口径：容器内 gitSha `3aa402c9…` 与仓库 HEAD `9d59337d…` 不一致；委托人 2026-11-14 批准「以当前 demo 原样跑（不 upgrade）」，本跑次验的是**容器内版本**。

## 环境门禁（UAT-R0）

| 步骤 | 观测 |
|---|---|
| `docker compose -f deploy/compose/docker-compose.demo.yml ps` | `compose-lucy-1` healthy（Up 23 hours）；`compose-demo-db-1` healthy；另有 uat-mysql57／80 |
| `GET http://127.0.0.1:55176/api/health` | HTTP 200；`ok=true`；`status=ok`；见上表 Health |
| `POST http://127.0.0.1:57881/mcp`（initialize） | HTTP 200；`mcp-session-id` 头存在；`serverInfo={name:ktx, version:0.16.0}`；`protocolVersion=2025-03-26` |

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | demo healthy；health ok；MCP initialize 200 + session id |
| UAT-SAG-01 | **PASS** | `isError=true`；文本含 `source_ambiguity_gate`；`data.reason=source_ambiguity_gate`；`failureDimension=source_selection`；候选 3 张（superstore_orders／superstore_people／superstore_returns，各带完整 sourceKey 与 description）；无成功 rows |
| UAT-SAG-02 | **BLOCKED** | 本机无 person actor token 且无宿主 attestation 凭据；委托人已批准记 BLOCKED、不停整波 |

### UAT-SAG-01 复现步骤（无 secret）

1. MCP `initialize` → `notifications/initialized`
2. `lucy_begin_question`：`question`=「超市最近怎么样」，`intentSummary`=「未选表概况：询问超市业务最近状况，未指定来源表」
3. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`

实际响应：

```json
{ "isError": true,
  "content": [{ "type": "text",
    "text": "Access denied: source_ambiguity_gate（表级歧义：请先确认来源表）" }],
  "data": { "reason": "source_ambiguity_gate",
            "failureDimension": "source_selection",
            "message": "表级歧义：请先确认来源表",
            "candidates": [ { "sourceKey": { "connectionId": "demo-mysql", "schema": "dataforai",
              "sourceName": "superstore_orders", "physicalTable": "dataforai.superstore_orders" },
              "displayName": "superstore_orders", "allowListName": "superstore_orders",
              "measures": ["total_sales","total_profit","profit_margin","order_count"],
              "description": "Demo 超市订单 ODS 明细表", "descriptionState": "present" } ] } }
```

无 `rows`／`totalRows`；候选身份完整（connectionId＋schema＋sourceName＋physicalTable），宿主可据此确认。

### UAT-SAG-02 BLOCKED 依据

| 观测 | 结果 |
|---|---|
| `POST /mcp/host/source-ambiguity/confirm`（本机 MCP Bearer，无 attestation 头） | HTTP **403** `{"error":"Forbidden","reason":"host_confirm_requires_person"}` |
| 同上 + `x-lucy-host-attestation` 头 | HTTP **403** `host_confirm_requires_person`（准入先判 `actorKind=person`） |
| 403 之后同会话重发 `lucy_query` | 仍 `isError=true`「Access denied: source_ambiguity_gate」——门闩未被绕过 |

缺 person actor Bearer 与宿主 attestation 凭据 → 用例前置不满足；按 Plan §1 标 **BLOCKED**，不降级为 PASS。

## 套件判定

**PASS**（必做 UAT-R0／UAT-SAG-01 全绿；UAT-SAG-02 为委托人批准允许的 BLOCKED）

## 禁止项确认

- 未用 vitest／CR／读代码冒充 PASS —— 全部判定来自真实 MCP `tools/call` 响应
- 未把 Bearer／密码写入本文件、证据 JSON 或任何仓库文件（已全仓扫描确认无 token 字面量）
- 未改产品代码／Spec 合同状态；未改 `docs/qa/uat/INDEX.md`
- 未把 BLOCKED 降级为替身 PASS
