# Run — 2026-11-14 — claude-macmini-p0-post-upgrade — UAT-SUITE-CATALOG-SEMANTICS

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SEMANTICS`（Catalog 业务语义 P0-2） |
| Agent | Claude Code（Claude Opus，macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime.status=ready`；`policy.healthy=true`；`execution.activation=current` |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；**未**写入本跑次正文或任何仓库文件 |
| 连接／期望样例源 | `demo-mysql`；`superstore_orders`／`superstore_people`／`superstore_returns` |
| 开始／结束 | 2026-11-14T12:38Z ／ 2026-11-14T12:43Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-post-upgrade-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-post-upgrade-2026-11-14/evidence.json)（`catsem01`／`sag02_catsem02` 段；无 secret） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-UPGRADE／UAT-CATSEM-01 全 PASS；A-opt UAT-CATSEM-02 亦 PASS） |

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
| UAT-CATSEM-01 | **PASS** | `lucy_catalog` 非 error；6 条源中 3 条 `demo-mysql`／`superstore_*` 全带非空业务描述；`descriptionState=present`（全部 6 条均 `present`） |
| UAT-CATSEM-02 | **PASS**（A-opt） | 可见连接集合＝`{demo-mysql, mysql-aliyun}`；`connection_list` 同集合且 `filteredBy=effective_permissions`；越权连接 `invest-db`／`lucy-ops` 查询被拒（`unknown_or_forbidden_connection`） |

### UAT-CATSEM-01 复现步骤（无 secret）

1. MCP `initialize` → `notifications/initialized`
2. `lucy_catalog`（空参）

实际响应关键字段：

```json
{ "isError": null,
  "connections": ["demo-mysql","mysql-aliyun"],
  "sources": [
    { "connectionId": "mysql-aliyun", "schema": "chatbi", "sourceName": "ai_intl_ad_daily",
      "table": "chatbi.ai_intl_ad_daily", "description": "AI 国际化广告日指标表。",
      "descriptionState": "present" },
    { "connectionId": "mysql-aliyun", "schema": "chatbi", "sourceName": "ai_intl_country_daily",
      "table": "chatbi.ai_intl_country_daily", "description": "AI 国际化国家日经营指标表。",
      "descriptionState": "present" },
    { "connectionId": "mysql-aliyun", "schema": "chatbi", "sourceName": "ai_intl_retention_daily",
      "table": "chatbi.ai_intl_retention_daily", "description": "AI 国际化留存日指标表。",
      "descriptionState": "present" },
    { "connectionId": "demo-mysql", "schema": "dataforai", "sourceName": "superstore_orders",
      "table": "dataforai.superstore_orders", "description": "Demo 超市订单 ODS 明细表",
      "descriptionState": "present" },
    { "connectionId": "demo-mysql", "schema": "dataforai", "sourceName": "superstore_people",
      "table": "dataforai.superstore_people", "description": "Demo 超市区域人员表",
      "descriptionState": "present" },
    { "connectionId": "demo-mysql", "schema": "dataforai", "sourceName": "superstore_returns",
      "table": "dataforai.superstore_returns", "description": "Demo 超市退货表",
      "descriptionState": "present" } ],
  "examples": [] }
```

### UAT-CATSEM-01 期望逐条核对

| 期望 | 实测 | 判定 |
|---|---|---|
| 至少一条 `demo-mysql`／`superstore_*` 源 | 3 条（orders／people／returns） | PASS |
| `description` 含可读业务文案（如「Demo 超市订单…」） | 「Demo 超市订单 ODS 明细表」「Demo 超市区域人员表」「Demo 超市退货表」 | PASS |
| `descriptionState` 为 `present`（若字段存在） | 6/6 条均 `present` | PASS |

### UAT-CATSEM-02（A-opt）范围裁剪

| 观测 | 结果 |
|---|---|
| `lucy_catalog` 可见连接 | `["demo-mysql","mysql-aliyun"]` |
| `connection_list` 可见连接 | `["demo-mysql","mysql-aliyun"]`，`filteredBy=effective_permissions` |
| 两集合是否相同 | 是（裁剪后一致） |
| `lucy_query` 越权连接 `invest-db`（`fact_company.market_cap`） | `isError=true`；`Access denied: unknown_or_forbidden_connection:invest-db 可用连接：demo-mysql、mysql-aliyun。…` |
| `lucy_query` 越权连接 `lucy-ops`（`ops_calls.call_id`） | `isError=true`；`Access denied: unknown_or_forbidden_connection:lucy-ops 可用连接：demo-mysql、mysql-aliyun。…` |

> 说明：容器 `ktx.yaml` 里配了 `invest-db`／`lucy-ops`／`mysql-aliyun` 等连接，但本 token 的可见集合被 ACL 裁剪到 `{demo-mysql, mysql-aliyun}`，且越权访问被显式拒绝 → 范围裁剪生效。

## 套件判定

**PASS** — 必做 UAT-R0／UAT-R0-UPGRADE／UAT-CATSEM-01 全绿；A-opt UAT-CATSEM-02 亦全绿。

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15Z`。
- 清理是否完成：**是**。仅只读 catalog／连接列表查询与两次越权拒绝探测（无写副作用）；未写入台账／内容根／catalog；证据 JSON 已脱敏（64 位 hex 全量扫描＝0 命中）。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 判定来自真实 MCP `tools/call` 响应。
