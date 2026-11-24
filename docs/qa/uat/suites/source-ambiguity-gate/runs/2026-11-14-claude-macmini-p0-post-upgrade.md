# Run — 2026-11-14 — claude-macmini-p0-post-upgrade — UAT-SUITE-SOURCE-AMBIGUITY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY`（表级歧义门闩 P0-3） |
| 总账 | P0-3／REQ-030-024 |
| Agent | Claude Code（Claude Opus，macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime.status=ready`（`ready=true`）；`policy.healthy=true`；`execution.activation=current`；`execution.loadedConnectionIds=[demo-mysql]` |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；**未**写入本跑次正文、证据 JSON 或任何仓库文件 |
| 连接／源 | `demo-mysql`；`superstore_orders`／`superstore_people`／`superstore_returns`（`dataforai` schema） |
| 开始／结束 | 2026-11-14T12:38Z ／ 2026-11-14T12:43Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-post-upgrade-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-post-upgrade-2026-11-14/evidence.json)（`sag01_begin`／`sag01_query`／`sag02_catsem02`／`r0_all` 段；无 secret） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-UPGRADE／UAT-SAG-01 全 PASS；UAT-SAG-02 为 Plan 明确批准的 BLOCKED，不降级为 PASS） |

> 版本口径：本波 `gitSha=9d59337d…` **≠** 前次 Wave A 跑次 [`2026-11-14-claude-macmini-p0-qa`](2026-11-14-claude-macmini-p0-qa.md) 的 `gitSha=3aa402c9…`；容器 `gitSha` 与仓库 HEAD `51efa80727c0712aeae4d4341e8f5a4f96a1e41d` 不同源（容器为镜像内 git 快照，`gitDirty=true`），本跑次验的是**容器内实测版本**。

## UAT-R0 — 环境门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `docker compose -f deploy/compose/docker-compose.demo.yml ps` | `compose-lucy-1` healthy（Up 5 hours，端口 55176→5174、57881→7879）；`compose-demo-db-1` healthy；另有 uat-mysql57／80 | PASS |
| `GET http://127.0.0.1:55176/api/health` | HTTP 200；`ok=true`；`status=ok`；见上表 Health | PASS |
| `POST http://127.0.0.1:57881/mcp`（initialize） | HTTP 200；`mcp-session-id` 头存在（36 字符）；`serverInfo={name:ktx, version:0.16.0}`；`protocolVersion=2025-03-26`；`instructions` 7747 字符 | PASS |

**WebUI／MCP 同实例可用**（同一 `compose-lucy-1` 容器同时暴露 55176 与 57881）。

## UAT-R0-UPGRADE — 升级后镜像门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `GET /api/health` → 解析 `data.gitSha`／`lucyVersion`／`ktxRuntime` | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`lucyVersion=0.30.0`；`ktxRuntime={status:ready, ready:true}` | PASS |
| 与前次 Wave A 跑次对照 | 前次 `3aa402c9bd657cbf7e72a68b6fa271540da29690`；本波 `9d59337d…` → **不以 `3aa402c9` 为前缀** | PASS |
| 记录本波完整 `gitSha` 到跑次元数据 | 已记录（见上表「环境」行） | PASS |

**结论：升级后镜像门禁 PASS**（health `ok`；`ktxRuntime` ready；`gitSha` 已换；未沿用旧跑次文件冒充）。

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | demo healthy；health HTTP 200 `ok=true`；MCP initialize 200＋`mcp-session-id` |
| UAT-R0-UPGRADE | **PASS** | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；非 `3aa402c9` 前缀；`ktxRuntime=ready` |
| UAT-SAG-01 | **PASS** | `isError=true`；文本 `Access denied: source_ambiguity_gate（表级歧义：请先确认来源表）`；`data.reason=source_ambiguity_gate`；`data.failureDimension=source_selection`；候选 3 张（superstore_orders／superstore_people／superstore_returns，各带完整 `sourceKey`＋`description`＋`descriptionState=present`）；无 `rows`／`totalRows` |
| UAT-SAG-02 | **BLOCKED** | 本机 `access.yaml` 全体 token 均无 `actor_kind: person`（`grep -c actor`＝0），无 person actor Bearer ＋宿主 attestation 凭据；宿主确认接口两次均 403 `host_confirm_requires_person`；Plan §Wave 范围已批准此状态记 BLOCKED、不停整波 |

### UAT-SAG-01 复现步骤（无 secret）

1. MCP `initialize` → `notifications/initialized`
2. `lucy_begin_question`：`question`=「超市最近怎么样」，`intentSummary`=「未选表概况：询问超市业务最近状况，未指定来源表」
3. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`

实际响应（脱敏后完整摘录）：

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
              "description": "Demo 超市订单 ODS 明细表", "descriptionState": "present" },
              { "sourceKey": { "connectionId": "demo-mysql", "schema": "dataforai",
                "sourceName": "superstore_people", "physicalTable": "dataforai.superstore_people" },
                "description": "Demo 超市区域人员表", "descriptionState": "present" },
              { "sourceKey": { "connectionId": "demo-mysql", "schema": "dataforai",
                "sourceName": "superstore_returns", "physicalTable": "dataforai.superstore_returns" },
                "description": "Demo 超市退货表", "descriptionState": "present" } ] } }
```

**门闩未被绕过**：无成功 `rows`／`totalRows` 成交；候选身份完整（`connectionId`＋`schema`＋`sourceName`＋`physicalTable`），宿主可据此确认。

### UAT-SAG-02 BLOCKED 依据

| 观测 | 结果 |
|---|---|
| 本机 `access.yaml`（`/data/lucy/webui/config/access.yaml`）token 列表 | `demo_agent`／`zhangxingchen`／`invest_uat`／`hehe` 共 7 个 token，`grep -c actor`＝**0** → 无人带 `actor_kind: person`；代理侧 `actorFromToken()` 要求 token 同时有 `actor_id` 与 `actor_kind=person` 才产出 person 身份 |
| `POST /mcp/host/source-ambiguity/confirm`（本机 MCP Bearer，**无** attestation 头） | HTTP **403** `{"error":"Forbidden","reason":"host_confirm_requires_person","detail":"Source confirmation requires actorKind=person and x-lucy-host-attestation"}` |
| 同上 **＋** `x-lucy-host-attestation` 头 | HTTP **403** 同一 `host_confirm_requires_person`（准入先判 `actorKind=person`） |
| 403 之后同会话重发 `lucy_query` | 仍 `isError=true`「Access denied: source_ambiguity_gate」；无 `rows` — 门闩未被绕过 |

缺 person actor Bearer 与宿主 attestation 凭据 → 用例前置不满足；按 Plan §Wave 范围标 **BLOCKED**，**不**降级为 PASS、**不**用替身单测凑绿。

## 套件判定

**PASS** — 必做 UAT-R0／UAT-R0-UPGRADE／UAT-SAG-01 全绿；UAT-SAG-02 为 Plan 明确批准允许的 BLOCKED（缺 person 凭据，非产品缺陷结论）。

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15Z`（升级后实例，非本跑次拉起）。
- 清理是否完成：**是**。无状态残留需求——MCP 会话随进程丢弃；本跑次仅做只读查询与一次 403 探测；未写入 catalog／台账／内容根；证据 JSON 已脱敏（64 位 hex 全量正则扫描＝0 命中）。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 全部判定来自真实 MCP `tools/call` 响应与真实 HTTP 状态码。
