# Run — 2026-11-14 — claude-macmini-p0-post-upgrade — UAT-SUITE-CALIBER-BINDING

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CALIBER-BINDING`（口径绑定 P0-1） |
| Agent | Claude Code（Claude Opus，macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime.status=ready`；`policy.healthy=true`；`execution.activation=current` |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；**未**写入本跑次正文或任何仓库文件 |
| 连接／度量 | `demo-mysql`；`superstore_orders.order_count`；segment `superstore_orders.active_rows` |
| 开始／结束 | 2026-11-14T12:38Z ／ 2026-11-14T12:43Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-post-upgrade-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-post-upgrade-2026-11-14/evidence.json)（`caliber01` 段；无 secret） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-UPGRADE／UAT-CALIBER-01 全 PASS） |

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
| UAT-CALIBER-01 | **PASS** | 非 `isError`；`rows=[[1000]]`、`totalRows=1`、`headers=["order_count"]`；`answer_verifiability.caliber.caliberBinding.status === "none"`；`caliber.omissions={}`；上游真实 SQL 计数命中 1000 |
| UAT-CALIBER-02 | **SKIPPED（Wave B，本波不做）** | Plan §Wave 范围明确「CALIBER-02（Wave B）」推迟执行；本跑次未执行、未主张结论 |

### UAT-CALIBER-01 复现步骤（无 secret）

1. `lucy_begin_question`：`question`=「订单数是多少」（单表词，避免歧义门闩），`intentSummary`=「单表词查询订单数，绑定零绑定不强制」
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

实际响应关键字段：

```json
{ "isError": null,
  "headers": ["order_count"],
  "rows": [[1000]],
  "totalRows": 1,
  "sql": "SELECT COUNT(DISTINCT CASE WHEN superstore_orders.is_deleted = 0 THEN superstore_orders.order_id END) AS order_count FROM dataforai.superstore_orders AS superstore_orders LIMIT 100",
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
    "carriers": { "structuredContent": "projected" } } }
```

- 期望①「成功载荷（非 `isError`）」→ `isError` 缺省即非错误，且有数值行 → 满足
- 期望②「`caliberBinding.status === "none"`」→ `"none"` → 满足
- 期望③「有数值行（如 `order_count`）」→ `rows=[[1000]]` → 满足

### 前置核对（零绑定态）

`/data/lucy/config/` 内容根**无** `caliber-bindings/` 目录；容器 `/data/lucy/.ktx-ui/caliber-binding/` 下**仅**有 `sessions/`（会话态），**无** published 绑定资产 → 符合 UAT-CALIBER-01 前置「demo 内容根无命中本问句的 published `caliber-bindings`」，本跑次验的正是「零绑定不强制」。

## 套件判定

**PASS** — 必做 UAT-R0／UAT-R0-UPGRADE／UAT-CALIBER-01 全绿；UAT-CALIBER-02 属 Wave B，按 Plan 本波不做，不计入判定。

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15Z`。
- 清理是否完成：**是**。仅只读查询；MCP 会话随进程丢弃；未写入任何台账／内容根／catalog；证据 JSON 已脱敏。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 判定来自真实 MCP `tools/call` 响应。
