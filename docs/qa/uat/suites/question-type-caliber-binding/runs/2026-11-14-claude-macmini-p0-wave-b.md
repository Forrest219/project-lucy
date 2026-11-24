# Run — 2026-11-14 — claude-macmini-p0-wave-b — UAT-SUITE-CALIBER-BINDING

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CALIBER-BINDING`（口径绑定 P0-1） |
| 总账 | P0-1／REQ-030-024 |
| Agent | Claude Code（macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1`；ContentRoot `/data/lucy/config` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15.41952696Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime={status:ready, ready:true}`；`policy.healthy=true`；`execution.activation=current`；`contentRoot=/data/lucy/config` |
| 凭据 | Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入进程内存（sha256 前 12 位指纹 `8e0ae3055cef`）；**未**写入本跑次正文、证据 JSON 或任何仓库文件 |
| 连接／度量 | `demo-mysql`；`superstore_orders.order_count`；segment `superstore_orders.active_rows` |
| 开始／结束 | 2026-11-14T13:13Z ／ 2026-11-14T13:22Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-wave-b-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-wave-b-2026-11-14/evidence.json)（`caliber02`／`r0_all`／`r0_upgrade`／`cleanup` 段；无 secret） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-UPGRADE／UAT-CALIBER-02 全 PASS） |

> 版本口径：本波 `gitSha=9d59337d…` **≠** 前次 Wave A 跑次 [`2026-11-14-claude-macmini-p0-qa`](2026-11-14-claude-macmini-p0-qa.md) 的 `gitSha=3aa402c9…`；验的是**容器内实测版本**。

## UAT-R0 — 环境门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `docker ps` | `compose-lucy-1` healthy（Up 6 hours；55176→5174、57881→7879）；`compose-demo-db-1` healthy；另有 uat-mysql57／80 | PASS |
| `GET http://127.0.0.1:55176/api/health` | HTTP 200；`ok=true`；`status=ok`；`contentLayout.contentRoot=/data/lucy/config` | PASS |
| `POST http://127.0.0.1:57881/mcp`（initialize） | HTTP 200；`mcp-session-id` 存在；`serverInfo={name:ktx, version:0.16.0}`；`protocolVersion=2025-03-26`；`instructions` 7747 字符 | PASS |

**WebUI／MCP 同实例可用。**

## UAT-R0-UPGRADE — 升级后镜像门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `GET /api/health` → `data.gitSha`／`lucyVersion`／`ktxRuntime` | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`lucyVersion=0.30.0`；`ktxRuntime={status:ready, ready:true}` | PASS |
| 与前次 Wave A 跑次对照 | 前次 `3aa402c9bd657cbf7e72a68b6fa271540da29690`；本波 `9d59337d…` → **不以 `3aa402c9` 为前缀** | PASS |
| 记录本波完整 `gitSha` | 已记录（见上表「环境」行） | PASS |

**结论：升级后镜像门禁 PASS。**

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | demo healthy；health HTTP 200 `ok=true`；MCP initialize 200＋`mcp-session-id`＋`serverInfo={ktx,0.16.0}` |
| UAT-R0-UPGRADE | **PASS** | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；非 `3aa402c9` 前缀；`ktxRuntime=ready` |
| UAT-CALIBER-02 | **PASS** | 绑定已安装并提交（registry `generation=1`、`fileCount=1`、`phase=committed`）；begin 返回 `activeBindingId=uat_wave_b_order_count`（会话态 `begun_bound`）；故意偏离查询 `isError=true`，`data.reason=caliber_binding_violation`、`dimension=source`、`bindingId=uat_wave_b_order_count`；**无 `rows`／无 `totalRows`**（上游 0） |

### UAT-CALIBER-02 复现步骤（无 secret）

**前置生效（夹具安装 → 提交注册表）**

1. `docker exec compose-lucy-1 mkdir -p /data/lucy/config/caliber-bindings`
2. `docker cp docs/qa/uat/suites/question-type-caliber-binding/fixtures/uat_wave_b_order_count.yaml compose-lucy-1:/data/lucy/config/caliber-bindings/uat_wave_b_order_count.yaml`
3. 管理员会话 `POST /api/semantic-assets/reindex`，body `{"force":true}` → HTTP 200

实际响应关键字段：

```json
{ "ok": true,
  "data": { "id": "idx_20261114_131406_004_8d0e199b", "force": true,
            "reindex": { "ok": true, "exitCode": 0,
                         "stdout": "reindex\tscopes=6\tscanned=39\trebuilt=39\tdeleted=0\tembeddings=-\tduration_ms=182\n" },
            "baselineState": "ready", "baselineGeneration": 1 } }
```

绑定注册表提交凭据（容器 `/data/lucy/config/caliber-bindings/.caliber-binding/active-generation.json`）：

```json
{ "phase": "committed", "generation": 1,
  "releaseId": "idx_20261114_131406_004_8d0e199b",
  "digest": "8fcc15f77dc201eb4380c30309862ab14786812a746c9cedcac8a5bab2672b53",
  "fileCount": 1,
  "receipts": [{ "consumer": "lucy_mcp_proxy", "fileCount": 1 }],
  "committedAt": "2026-11-14T13:14:06.010Z" }
```

> `phase=committed`＋`fileCount=1` 是「注册表已提交」的耐久证据（非仅落盘）；对应 cases.md 前置第 2 项。

**执行（故意偏离）**

1. `lucy_begin_question`：`question`＝「请按 UAT订单数口径绑定 回答订单数」，`intentSummary`＝「激活 Wave B 口径绑定（UAT订单数口径绑定），随后故意偏离查询以验证 deny」
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`，**故意偏离** `dimensions=[{field:"superstore_people.region"}]`（reqKeys≠`{superstore_orders}`；未用歧义词「超市」）

实际响应：

```json
{ "isError": true,
  "content": [{ "type": "text",
    "text": "Access denied: caliber_binding_violation（偏离固定口径）：查询的来源与固定口径不一致" }],
  "data": { "reason": "caliber_binding_violation",
            "failureDimension": "口径绑定",
            "dimension": "source",
            "bindingId": "uat_wave_b_order_count" } }
```

begin 响应（绑定确实被激活，非零绑定静默放行）：

```json
{ "turnId": "lucy_dff2596d-bf0e-4627-8182-9d71f80dc9ae",
  "activeBindingId": "uat_wave_b_order_count" }
```

会话态（容器 `/data/lucy/.ktx-ui/caliber-binding/sessions/session-*.json`）：

```json
{ "state": "begun_bound", "bindingId": "uat_wave_b_order_count",
  "generation": 1, "commitPhase": "committed",
  "boundKey": { "connectionId": "demo-mysql", "schema": "dataforai",
                "sourceName": "superstore_orders",
                "physicalTable": "dataforai.superstore_orders" },
  "caliberSnapshot": { "measures": ["superstore_orders.order_count"], "dimensions": [],
                       "segments": ["superstore_orders.active_rows"], "filterFields": [],
                       "requireMeasures": ["superstore_orders.order_count"] } }
```

### 期望逐条对照

| 期望 | 观测 | 结论 |
|---|---|---|
| `result.isError === true` | `isError=true` | ✅ |
| 文本／`data.reason` 含 `caliber_binding_violation` | 文本「Access denied: caliber_binding_violation（偏离固定口径）：查询的来源与固定口径不一致」；`data.reason="caliber_binding_violation"` | ✅ |
| 不得返回成功 `rows` | 响应无 `rows`／无 `totalRows`／无 `sql`（上游 0） | ✅ |
| 不得静默成交 | 绑定会话态 `begun_bound`＋`activeBindingId` 非空；偏离源 `superstore_people` 在闸第 ④ 步（`dimension="source"`）被拒，未进入上游 | ✅ |
| 缺夹具／未提交注册表 → BLOCKED | 不适用：夹具已安装且注册表 `phase=committed`（`fileCount=1`） | ✅ |

> 复测：清理动作完成后**再次**执行同一 begin＋偏离查询，响应一致（`isError=true`／`reason=caliber_binding_violation`／`bindingId=uat_wave_b_order_count`），确认结论非一次性偶发。

## 套件判定

**PASS** — 必做 UAT-R0／UAT-R0-UPGRADE／UAT-CALIBER-02 全绿。

> UAT-CALIBER-01（零绑定不强制）本波为可选冒烟，在**清理后**执行并 PASS（见「备注」）。

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15.41952696Z`（升级后实例，非本跑次拉起）。夹具生效一律走 `validate`／`publish`／`reindex`。
- 清理是否完成：**是**。删除 `/data/lucy/config/caliber-bindings/uat_wave_b_order_count.yaml` 后再 `POST /api/semantic-assets/reindex {"force":true}`（HTTP 200；`reindex ok=true`；`scopes=6 scanned=39 rebuilt=39`），published 绑定集回到**空**：注册表 `generation=6`、`fileCount=0`、`digest=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（＝sha256 of 空集合，与 `loadCaliberBindingCandidate` 的空目录分支一致）。
- 清理后冒烟（可选）：`lucy_begin_question`「订单数是多少」＋`lucy_query` `order_count`/`active_rows` → 成功，`rows=[[1000]]`、`totalRows=1`、`answer_verifiability.caliber.caliberBinding.status === "none"` → **UAT-CALIBER-01 PASS**（零绑定不强制仍成立）。
- 本套件跑次期间 `demo-mysql` 曾因**另一套件（EXPOSURE-02）的夹具**而短暂不可查；已由该套件跑次记录根因与恢复过程，本套件的 PASS 判定均取自该窗口**之外**的两次独立实测。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 判定全部来自真实 MCP `tools/call` 响应、真实 HTTP 状态码与容器内耐久凭据文件。
