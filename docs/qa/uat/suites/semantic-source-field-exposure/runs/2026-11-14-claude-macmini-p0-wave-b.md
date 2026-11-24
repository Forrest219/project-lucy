# Run — 2026-11-14 — claude-macmini-p0-wave-b — UAT-SUITE-FIELD-EXPOSURE

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-FIELD-EXPOSURE`（字段暴露 P0-A／REQ-030-012） |
| 总账 | P0-A／REQ-030-012 |
| Agent | Claude Code（macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1`；ContentRoot `/data/lucy/config` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15.41952696Z`；`RestartCount=0`（本跑次未重启） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime={status:ready, ready:true}`；`policy.healthy=true`；`execution.activation=current`；`contentRoot=/data/lucy/config` |
| 凭据 | WebUI 管理员会话仅从 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` 读入进程内存（`POST /api/auth/login` → HTTP 200，`me.id=xingchen`／`role=owner`）；MCP Bearer 仅从 `/Users/forrest/Desktop/lucy token.txt` 读入（指纹 `8e0ae3055cef`）。**未**写入本跑次正文、证据 JSON 或任何仓库文件 |
| 连接／源 | `demo-mysql`；`superstore_orders`（`dataforai` schema） |
| 开始／结束 | 2026-11-14T13:14Z ／ 2026-11-14T13:22Z（UTC） |
| 证据 JSON | [`inbox/uat-p0-wave-b-2026-11-14/evidence.json`](../../../../../inbox/uat-p0-wave-b-2026-11-14/evidence.json)（`exposure02`／`cleanup` 段；无 secret） |
| 总判定 | **BLOCKED**（UAT-R0／UAT-R0-UPGRADE PASS；UAT-EXPOSURE-02 因**产品侧 reindex 缺陷**无法进入 trimmed 态 → 按 cases.md 记 **BLOCKED**，不降级为 PASS） |

> 版本口径：本波 `gitSha=9d59337d…` **≠** 前次 Wave A 跑次 [`2026-11-14-claude-macmini-p0-qa`](2026-11-14-claude-macmini-p0-qa.md) 的 `gitSha=3aa402c9…`；验的是**容器内实测版本**。

## UAT-R0 — 环境门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `docker ps` | `compose-lucy-1` healthy（Up 6 hours）；`compose-demo-db-1` healthy | PASS |
| `GET http://127.0.0.1:55176/api/health` | HTTP 200；`ok=true`；`status=ok` | PASS |
| `POST /api/auth/login`（管理员） | HTTP 200；`data.me.id=xingchen`、`role=owner`；会话 cookie `lucy_admin_session` | PASS |
| `POST http://127.0.0.1:57881/mcp`（initialize） | HTTP 200；`mcp-session-id` 存在；`serverInfo={name:ktx, version:0.16.0}`；`protocolVersion=2025-03-26` | PASS |

**WebUI／MCP 同实例可用。**

## UAT-R0-UPGRADE — 升级后镜像门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `GET /api/health` → `data.gitSha`／`lucyVersion`／`ktxRuntime` | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`lucyVersion=0.30.0`；`ktxRuntime={status:ready, ready:true}` | PASS |
| 与前次 Wave A 跑次对照 | 前次 `3aa402c9…`；本波 `9d59337d…` → **不以 `3aa402c9` 为前缀** | PASS |
| 记录本波完整 `gitSha` | 已记录（见上表「环境」行） | PASS |

**结论：升级后镜像门禁 PASS。**

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | demo healthy；health 200 `ok=true`；管理员登录 200；MCP initialize 200＋session id |
| UAT-R0-UPGRADE | **PASS** | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；非 `3aa402c9` 前缀；`ktxRuntime=ready` |
| UAT-EXPOSURE-02 | **BLOCKED** | `validate` HTTP 200 `valid=true`；`publish` HTTP 200 `accepted=true`（release `rel_20261114_131423_803_5b137dda`），但发布批次最终 `status=reindex_failed`、`activationStatus=unconfirmed`、`recoveryRequired=false`；reindex `exitCode=1`，`sl/demo-mysql` 报错 `composeOverlay: overlay for 'superstore_orders' has unhandled keys [version, source, excluded_columns, updated_at]`。台账**从未进入 serving**（`serving-generation.json` `ledgers={}`／`expectedSetRequired=false`），数据面**从未**出现 `field_not_exposed` → 前置不满足，用例无法执行 |

### UAT-EXPOSURE-02 复现步骤（无 secret）

**1. validate（管理员会话）**

```
POST /api/semantic-assets/validate
{ "defaultConnectionId": "demo-mysql",
  "files": [{ "filename": "superstore_orders_exposure.yaml", "content": "<fixtures/uat_wave_b_superstore_orders_exposure.yaml 全文>" }] }
```

实际响应（截取）：

```json
{ "ok": true,
  "data": { "valid": true,
            "validationId": "val_20261114_131423_791_aa0aa14a",
            "files": [{ "originalFilename": "superstore_orders_exposure.yaml",
                        "kind": "fieldExposure",
                        "targetPath": "semantic-layer/demo-mysql/_exposure/superstore_orders.yaml",
                        "exists": false, "sizeBytes": 500,
                        "connectionId": "demo-mysql", "schema": "dataforai",
                        "sourceName": "superstore_orders", "warnings": [] }],
            "changedSources": [], "warnings": [], "errors": [] } }
```

**2. publish**

```
POST /api/semantic-assets/publish
{ "validationId": "val_20261114_131423_791_aa0aa14a", "confirmOverwrite": true }
```

实际响应：`HTTP 200`、`accepted=true`、release `rel_20261114_131423_803_5b137dda`、`actor=xingchen`、初始 `status=reindexing`、`files=[{targetPath: semantic-layer/demo-mysql/_exposure/superstore_orders.yaml, kind: fieldExposure, sha256: 3b1f0954…}]`。

**3. 发布批次终态（`GET /api/semantic-assets/releases/<id>/status`）**

```json
{ "status": "reindex_failed", "activationStatus": "unconfirmed", "recoveryRequired": false,
  "reindex": { "ok": false, "exitCode": 1,
    "stdout": "reindex\tscopes=6\tscanned=36\tupdated=0\tdeleted=0\tembeddings=-\tduration_ms=144\tfailed=1\n",
    "stderr": "…\nsl/demo-mysql\tscanned=0\tupdated=0\tdeleted=0\tembeddings=-\tduration_ms=9\terror=\"semantic-layer/demo-mysql/_exposure/superstore_orders.yaml: composeOverlay: overlay for 'superstore_orders' has unhandled keys [version, source, excluded_columns, updated_at]. Add a compose branch or remove from the schema.\"\n…" } }
```

**4. Serving 态核对（发布后）**

| 制品 | 观测 | 含义 |
|---|---|---|
| `/data/lucy/.ktx-ui/field-exposure/serving-generation.json` | `generationId=gen-idx_20261114_131406_004_8d0e199b`（**发布前**那一代）、`ledgers={}`、`expectedSetRequired=false`、`admissionMode=OPEN` | trimmed 台账**未**进入 serving |
| `/data/lucy/.ktx-ui/field-exposure/expected-ledgers.json` | `expectedSetRequired=false`、`sources=[]` | 期望集合**未**登记 `superstore_orders` |

**5. 数据面探针（发布后台账已在盘上时）**

`lucy_begin_question`「订单客户名分布」＋`lucy_query` `dimensions=[{field:"superstore_orders.customer_name"}]` →

```json
{ "isError": true,
  "content": [{ "type": "text",
    "text": "semantic-layer/demo-mysql/_exposure/superstore_orders.yaml: composeOverlay: overlay for 'superstore_orders' has unhandled keys [version, source, excluded_columns, updated_at]. Add a compose branch or remove from the schema." }] }
```

**未出现** `field_not_exposed`；出现的是 KTX 装载错误 —— 正是 cases.md 禁止的「把上游错误冒充本条 PASS」情形，故**不**主张 PASS、**不**降级。

### 根因定位（可复现实验，非读代码推断）

发布批次失败在 **reindex 阶段**：WebUI 把台账写到 `semantic-layer/demo-mysql/_exposure/superstore_orders.yaml`，而 **KTX（0.16.0）会把 `semantic-layer/<conn>/_exposure/<表名>.yaml` 当作该表的语义 source overlay 装载**，overlay schema 不认台账的 `version`／`source`／`excluded_columns`／`updated_at` 四个键 → `composeOverlay` 失败。

容器内可逆实验（临时文件置于镜像侧 `semantic-layer/demo-mysql/_exposure/`，实验后已删除）：

| 探针文件名 | 是否命中 enabled table | `ktx admin reindex` | 结论 |
|---|---|---|---|
| `zz_probe.yaml`（内容与台账同构） | 否 | **ok=true**（`scanned=39 rebuilt=39`） | KTX **不**装载不匹配任何 enabled table 的文件 |
| `superstore_returns.yaml`（内容与台账同构） | 是（`demo-mysql.enabled_tables` 含 `dataforai.superstore_returns`） | **ok=false**，同一 `composeOverlay` 报错 | KTX **确实**装载 `_exposure/<表名>.yaml` 并按 source overlay 解析 |

→ 归因唯一：**`_exposure/` 下与 enabled table 同名的 yaml 被 KTX 当 source overlay 装载**。文件名不匹配则完全被忽略（说明这不是「所有 `_exposure/` 文件都被拒」，而是**同名**触发）。

这正是 Spec D3 与 Plan「开工前置」第 3 项标注的**未核实项**（"KTX loader 是否忽略 `semantic-layer/<conn>/` 下除 `_schema` 外的下划线目录：未核实"）在 Wave B 被**实测证伪**。当前实现的台账落点 `semantic-layer/<conn>/_exposure/<source>.yaml` 与 KTX 0.16.0 的 loader 行为冲突。

> 该缺陷是**产品侧**落点问题，非夹具内容问题：台账 YAML 内容由仓库 fixture 固定，且 `classifyYaml` 已被实现识别为 `fieldExposure` 种类（`validate` 返回 `kind=fieldExposure`），说明 WebUI 侧分类正确；失败发生在其后 KTX 装载环节。

### 附带影响（必须记录的实况）

台账文件在盘期间，`demo-mysql` 的**全部** `lucy_query` 均返回同一 `composeOverlay` 错误（连 `order_count` 也不能查）——即本夹具的落点缺陷**同时打挂该连接的数据面**，不只是影响本用例。已按下节恢复。

## 清理

| 项 | 动作 | 结果 |
|---|---|---|
| 文档指定的清理路径 | `publish` `uat_wave_b_superstore_orders_exposure_cleanup.yaml`（`excluded_columns: []`） | validate 200 `valid=true`；publish 200 `accepted=true`（release `rel_20261114_132145_476_1d8dc67b`），但终态**仍 `reindex_failed`**（同一 `composeOverlay` 错误）→ **该清理路径在本环境不可用**：文件仍在盘上，demo-mysql 仍不可查 |
| 实际采用的清理路径 | 产品自带恢复接口：`POST /api/semantic-assets/releases/<id>/restore/preview` → `POST /api/semantic-assets/releases/<id>/restore`（管理员会话＋幂等键），执行 2 次把台账文件**删除**（`action=delete`；第二次 restore 的 `files[0].sha256=""`） | 恢复批次自身 `status=reindex_failed`（因台账删除前的索引仍含该文件），但**文件删除已落盘**（内容根与镜像侧 `demo-mysql/_exposure/` 均为空） |
| 索引恢复 | 删除台账后 `POST /api/semantic-assets/reindex {"force":true}` | HTTP 200；`reindex ok=true`、`exitCode=0`、`scopes=6 scanned=39 rebuilt=39 deleted=0`；`sl/demo-mysql scanned=3 rebuilt=3` |
| 残留目录 | `rmdir` 内容根与镜像侧的 `demo-mysql/_exposure/` 空目录 | 两侧 `demo-mysql/` 只剩 `_schema/`＋`superstore_orders.yaml`（与跑次前一致） |
| 最终 Serving 态 | — | `serving-generation.json`：`generationId=gen-idx_20261114_132214_013_9818102c`、`admissionMode=OPEN`、`expectedSetRequired=false`、`ledgers={}`；`expected-ledgers.json`：`expectedSetRequired=false`、`sources=[]` → **回到未配置（未暴露列台账缺席）基线** |

### 清理后验证（冒烟）

| 检查 | 观测 | 结果 |
|---|---|---|
| `lucy_query` `order_count`＋`active_rows` | `rows=[[1000]]`、`totalRows=1`；`caliberBinding.status="none"`；SQL 正常执行 | ✅ 数据面恢复 |
| `lucy_query` `dimensions=[{field:"superstore_orders.customer_name"}]` | 成功；`headers=["customer_name","order_count"]`、`rows` 有数据；**无** `field_not_exposed`、**无** `composeOverlay` | ✅ 回到全暴露基线（UAT-EXPOSURE-01 PASS） |
| `GET /api/health` | HTTP 200；`ok=true`；`ktxRuntime=ready`；`policy.healthy=true`；`execution.activation=current` | ✅ |
| `docker inspect` | `RestartCount=0`、`StartedAt=2026-11-14T07:16:15.41952696Z` | ✅ 未重启容器 |
| `GET /api/semantic-assets/releases?limit=12` | 全部批次 `recoveryRequired=false`；无未决恢复日志 | ✅ 无需人工恢复 |

## 套件判定

**BLOCKED** — UAT-R0／UAT-R0-UPGRADE PASS；UAT-EXPOSURE-02 因**产品侧缺陷**（台账落点与 KTX 0.16.0 loader 冲突 → 发布批次 reindex 失败 → 台账无法进入 serving → 数据面永不进入 trimmed 态）无法执行。

按 [`CONVENTIONS.md`](../../CONVENTIONS.md) 第 3 条「做不到全真时必须停表上报」：本用例**停表记 BLOCKED**，**不**用 CR／vitest／读代码推断凑绿，**不**把 KTX `composeOverlay` 上游错误冒充 `field_not_exposed` PASS。

**复测前置条件（供委托人／Cursor 决策）**：需先解决「台账落点 vs KTX loader」冲突。Spec D3 已给出备选落点 `<contentRoot>/exposure/<conn>/<source>.yaml`（并扩 `CONTENT_DIR_NAMES` 与发布扫描根）；落地后 Wave B 的 validate→publish→trimmed→`field_not_exposed` 链条应可重跑。**该变更属产品代码，本跑次按硬约束未修改。**

## 备注

- 是否使用 `docker restart`：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt` 未变。夹具生效全程走 `validate`／`publish`／`reindex`。
- 清理是否完成：**是**（台账文件已从内容根与镜像侧**删除**并 rmdir 空目录；`demo-mysql` 恢复到跑次前目录形态；数据面与索引均恢复并已冒烟验证；无未决恢复日志）。清理过程中**未**使用 `docker restart`。
- 未改产品代码、Spec 合同、`cases.md` 期望；未改 `docs/qa/uat/INDEX.md`／`e2e-ledger.md`。
- 未用 vitest／CR／读代码冒充 PASS —— 判定来自真实 MCP `tools/call` 响应、真实 HTTP 状态码与真实 `ktx admin reindex` 输出；根因由容器内可逆探针实验实测得出。
