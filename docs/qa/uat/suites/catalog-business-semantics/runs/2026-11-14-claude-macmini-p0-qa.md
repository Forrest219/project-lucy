# 2026-11-14-claude-macmini-p0-qa — UAT-SUITE-CATALOG-SEMANTICS

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SEMANTICS` |
| 总账 | P0-2／REQ-030-023 |
| 环境 | 本机 demo Docker `compose-lucy-1`（healthy）+ MCP Proxy `http://127.0.0.1:57881/mcp` |
| Health | lucyVersion=0.30.0；gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690；gitDirty=true；ktxRuntime=ready；policy.healthy=true；execution.loadedConnectionIds=[demo-mysql, invest-db, lucy-ops, mysql-aliyun] |
| Agent | claude |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（指纹 `8e0ae3055cef`）；未写入本跑次正文或任何仓库文件 |
| 跑序 | P0-2（第 6 个，末位） |
| 证据 JSON | [`inbox/uat-p0-macmini-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-macmini-2026-11-14/evidence.json) |

> 版本口径：容器内 gitSha `3aa402c9…` 与仓库 HEAD `9d59337d…` 不一致；委托人 2026-11-14 批准「以当前 demo 原样跑（不 upgrade）」，本跑次验的是**容器内版本**。

## 环境门禁（UAT-R0）

同 `source-ambiguity-gate` 跑次：`compose-lucy-1` healthy；`/api/health` HTTP 200 `ok=true`；MCP `initialize` HTTP 200 带回 `mcp-session-id`（`serverInfo={ktx, 0.16.0}`）。

## 结果

| Case | 结果 | 备注 |
|---|---|---|
| UAT-R0 | **PASS** | demo／MCP 可用 |
| UAT-CATSEM-01 | **PASS** | `lucy_catalog` 返回 3 张 `superstore_*` 源，`description` 非空且 `descriptionState="present"` |
| UAT-CATSEM-02 | **PASS** | catalog 仅含当前 token 可见连接／源：`connections=[demo-mysql, mysql-aliyun]`；`connection_list.filteredBy=effective_permissions` 一致；执行层加载的 `invest-db`／`lucy-ops` 未出现在 catalog |

### UAT-CATSEM-01 复现步骤（无 secret）

1. MCP `initialize` → `notifications/initialized`
2. `lucy_catalog`（空参）

实际响应（`demo-mysql` 部分）：

```json
{ "connections": [ "demo-mysql", "mysql-aliyun" ],
  "sources": [
    { "connectionId": "mysql-aliyun", "schema": "chatbi", "sourceName": "ai_intl_ad_daily",
      "table": "chatbi.ai_intl_ad_daily", "description": "AI 国际化广告日指标表。",
      "descriptionState": "present" },
    { "connectionId": "demo-mysql", "schema": "dataforai", "sourceName": "superstore_orders",
      "table": "dataforai.superstore_orders", "description": "Demo 超市订单 ODS 明细表",
      "descriptionState": "present" },
    { "connectionId": "demo-mysql", "schema": "dataforai", "sourceName": "superstore_people",
      "table": "dataforai.superstore_people", "description": "Demo 超市区域人员表",
      "descriptionState": "present" },
    { "connectionId": "demo-mysql", "schema": "dataforai", "sourceName": "superstore_returns",
      "table": "dataforai.superstore_returns", "description": "Demo 超市退货表",
      "descriptionState": "present" } ] }
```

（`mysql-aliyun` 另有 `ai_intl_country_daily`／`ai_intl_retention_daily` 两条，同为 `present`；catalog 源总数 6。）

对照断言：

| 断言 | 观测 | 结论 |
|---|---|---|
| 至少一条 `demo-mysql`／`superstore_*` 源 | 3 条 | ✅ |
| `description` 含可读业务文案 | 「Demo 超市订单 ODS 明细表」「Demo 超市区域人员表」「Demo 超市退货表」 | ✅ |
| `descriptionState` 为 `present` | 3 条均 `present` | ✅ |

### UAT-CATSEM-02 范围裁剪抽查（可选，已执行）

| 观测面 | 值 |
|---|---|
| `lucy_catalog` → `connections` | `["demo-mysql", "mysql-aliyun"]` |
| `lucy_catalog` → 源的 `connectionId` 全集 | `{demo-mysql, mysql-aliyun}` —— **无**越权连接 |
| `connection_list` → `connections` | `["demo-mysql", "mysql-aliyun"]` |
| `connection_list` → `filteredBy` | `effective_permissions` |
| health → `execution.loadedConnectionIds`（执行层实际加载） | `["demo-mysql", "invest-db", "lucy-ops", "mysql-aliyun"]` |
| 越权源泄漏抽查 | `invest-db`／`lucy-ops` 的源**未出现**在 catalog 中（0 条） |

判定：catalog 覆盖面严格等于本 token 的 `effective_permissions`（2 个连接），执行层加载的另外 2 个连接未泄漏 → 范围裁剪成立。

## 套件判定

**PASS**（UAT-R0／UAT-CATSEM-01／UAT-CATSEM-02 全绿；CATSEM-02 为 A-opt 且已实际执行通过）

## 禁止项确认

- 未用 vitest／CR／读代码冒充 PASS —— 判定全部来自真实 MCP `tools/call` 响应
- 未把 Bearer／密码写入本文件、证据 JSON 或任何仓库文件
- 未改产品代码／Spec 合同状态；未改 `docs/qa/uat/INDEX.md`
