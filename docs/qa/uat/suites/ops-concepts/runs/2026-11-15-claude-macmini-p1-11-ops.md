# Run — 2026-11-15 — claude-macmini-p1-11-ops — UAT-SUITE-OPS-CONCEPTS

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-OPS-CONCEPTS`（概念运维工具／Ops MCP） |
| 总账 | P1-11／REQ-030-032 |
| Agent | Claude Code（macOS Darwin 27.0.0） |
| 环境 | `gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1`；`KTX_PROJECT_ROOT=/data/lucy`；ContentRoot `/data/lucy/config` |
| 容器状态 | healthy；`StartedAt=2026-11-14T07:16:15.41952696Z`；`RestartCount=0`（本跑次未重启、未重建） |
| Health | `lucyVersion=0.30.0`；`gitSha=9d59337de500c778a6cee773f1bdeb41c7af837e`；`gitDirty=true`；`bundledKtxVersion=0.16.0`；`ktxRuntime={status:ready, ready:true}`；`policy.healthy=true`；`policy.degradedGlobal=false`；`execution.activation=current`；`contentRoot=/data/lucy/config` |
| 凭据 | WebUI 口令：桌面 `/Users/forrest/Desktop/lucywebui logi.txt` **本机不存在** → 用回退路径 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（admin id `xingchen`／owner；口令 sha256 前 12 位 `a81adb12421a`）。问数 MCP Bearer：`/Users/forrest/Desktop/lucy token.txt`（sha256 前 12 位 `8e0ae3055cef`）。**口令／Bearer／临时 ops Token 明文均未写入本跑次正文、证据 JSON 或任何仓库文件** |
| 临时资源 | Role `uat-ops-concept-role`／Agent `uat-ops-concept-agent`／Token label `uat-ops-concept`（前缀 `uat-ops-concept-`／`uat-ops-concept`）；本跑次全部已删除，见「清理」 |
| 开始／结束 | 2026-11-15T03:32Z ／ 2026-11-15T03:38Z（UTC） |
| 证据 JSON | [`inbox/uat-p1-11-12-14-2026-11-15/p1-11/evidence.json`](../../../../../inbox/uat-p1-11-12-14-2026-11-15/p1-11/evidence.json)（`webui_login`／`pre_*`／`create_*`／`ops_*`／`delete_*`／`residue_check`／`recheck_ask_data_token` 段；无 secret） |
| 总判定 | **FAIL**（必做 UAT-R0 PASS／UAT-OPS-CONCEPT-01 PASS／**UAT-OPS-CONCEPT-02 FAIL**／UAT-OPS-CONCEPT-03 PASS） |

> **一句话结论**：P1-11 的**授权面已全真走通**（问数 Token 看不见 `lucy_ops_concept_*` 且被显式拒绝；带 `allow.ops` 的临时 Agent 可见 4 个 `lucy_ops_concept_*` 工具），但**运行时面在容器化 demo 部署里完全不可用**——适配器把概念纯计算核心的模块解析锚在 `KTX_PROJECT_ROOT=/data/lucy`（数据卷），而该卷既没有 `scripts/concepts/`，也没有可解析裸依赖 `yaml` 的 `node_modules`，导致 `list`／`summary` 502、`scan` `ERR_MODULE_NOT_FOUND`。

---

## UAT-R0 — 环境门禁

| 步骤 | 观测 | 结果 |
|---|---|---|
| `docker ps` | `compose-lucy-1` healthy（Up 20 hours；`55176→5174`、`57881→7879`）；`compose-demo-db-1` healthy；另有 uat-mysql57／80、`openclaw-gateway` | PASS |
| `GET http://127.0.0.1:55176/api/health` | HTTP 200；`ok=true`；`status=ok`；`insecureTestProfile=true`；`policy.healthy=true`；`degradedAgents=[]` | PASS |
| 记 `gitSha` | `9d59337de500c778a6cee773f1bdeb41c7af837e`（与 brief 预期 `9d59337d…` 一致）；`lucyVersion=0.30.0`；`ktxRuntime.ready=true` | PASS |
| WebUI 登录 | `POST /api/auth/login` → HTTP 200；`me.id=xingchen`、`role=owner`、`enabled=true`；`GET /api/auth/me` → HTTP 200 `mode=required` | PASS |
| 问数 MCP `initialize` | HTTP 200；`content-type=application/json`；`mcp-session-id` 已取回；`protocolVersion=2025-03-26`；`serverInfo={name:ktx, version:0.16.0}`；`instructions` 7747 字符 | PASS |

**环境门禁 PASS。** 容器 `compose-lucy-1` **已含** `lucy_ops_concept_*` 工具登记表（见 01／02 的 `tools/list` 实测），故 brief 中「容器无登记表 → BLOCKED 并申请 upgrade」这一分支**不触发**；本波的问题不在版本，在运行时装配。

---

## UAT-OPS-CONCEPT-01 — 问数 Token 无概念运维工具

前置：UAT-R0 PASS。凭据：**问数** Bearer（`/Users/forrest/Desktop/lucy token.txt`，指纹 `8e0ae3055cef`＝access.yaml 中 `zhangxingchen` 的 `macmini-cursor` token），**非**本波创建的 ops Token。

### 步骤 1 — `tools/list`

```json
{ "httpStatus": 200, "toolCount": 11,
  "toolNames": ["connection_list","wiki_search","wiki_read","lucy_catalog",
                "lucy_read_source","lucy_query","lucy_explain_query",
                "lucy_freshness","lucy_skill_search","lucy_skill_read",
                "lucy_begin_question"],
  "opsConceptToolsVisible": [],
  "anyToolContainingOps": [] }
```

### 步骤 2 — `tools/call lucy_ops_concept_list`（空参数）

```json
{ "httpStatus": 200,
  "result": { "isError": true,
              "content": [{ "type": "text",
                            "text": "Access denied: ops_not_granted:lucy_ops_concept_list" }] } }
```

### 期望逐条对照

| 期望 | 观测 | 结论 |
|---|---|---|
| 工具列表中不出现任何 `lucy_ops_concept_*` | 11 个工具，**0** 个 `lucy_ops_concept_*`；含 `ops` 字样的工具 **0** 个 | ✅ |
| 强调时失败（授权／不可见／`isError` 或等价拒绝） | `isError=true`；`Access denied: ops_not_granted:lucy_ops_concept_list` | ✅ |
| **不得**返回概念清单成功载荷 | 响应无 `concepts`／无 `rows`／无 `totalRows`，仅拒绝文本 | ✅ |

### 耐久审计证据（容器 `/data/lucy/.ktx-ui/audit.sqlite` → `access_log`）

```json
{ "id": 6256, "ts": "2026-11-15T03:35:48.315Z",
  "user_id": "zhangxingchen", "token_label": "macmini-cursor",
  "tool": "lucy_ops_concept_list",
  "outcome": "denied",
  "decision_reason": "ops_not_granted:lucy_ops_concept_list",
  "args_summary": "{}" }
```

> 对应 Spec SC-05「仅问答 Token（无 `allow.ops`）不可调任何 concept 工具」——**全真 PASS**。

**UAT-OPS-CONCEPT-01 = PASS**

---

## UAT-OPS-CONCEPT-02 — 临时 allow.ops Agent 可 list／scan

### 步骤 1 — 建 Role `uat-ops-concept-role`

`POST /api/admin/roles`（`dryRun=false`），载荷：

```json
{ "roleId": "uat-ops-concept-role",
  "role": { "description": "UAT P1-11 temporary ops concept role (delete after UAT)",
            "permission_model_version": 2,
            "allow": { "ops": [ { "tools": ["lucy_ops_concept_list","lucy_ops_concept_show",
                                            "lucy_ops_concept_summary","lucy_ops_concept_scan"],
                                  "asset_kinds": ["governance"] } ] } } }
```

实测：HTTP 200；`ok=true`；`gate.decision=allow`；`policyVersion=129a1d48c755963b0fe74f7b76780e039b32bbaf7561b7ba7eddd7fb9a6843e3`；`policyRuntimeAck` 已落。
（`allow.ops` 需 owner，`xingchen` 为 owner → 未被 `requireOwnerForOps` 拦。）

### 步骤 2 — 建 Agent `uat-ops-concept-agent`

`POST /api/admin/agents`（`dryRun=false`），`agent={id:"uat-ops-concept-agent", name:"UAT Ops Concept Agent", roles:["uat-ops-concept-role"]}`。
实测：HTTP 200；`ok=true`；`gate.decision=allow`；回写 `roles=["uat-ops-concept-role"]`。

### 步骤 3 — 签 Token label `uat-ops-concept`

`POST /api/admin/agents/uat-ops-concept-agent/tokens` `{label:"uat-ops-concept", device_name:"macmini-uat", expires_in:"30d"}`。
实测：HTTP 200；`ok=true`；明文 token **仅**落 `/tmp/uat-ops-concept-work/ops-token.txt`（`chmod 600`，跑次末删除），指纹 sha256 前 12 位 `ed66660b5f88`。

> 备注：首次调用漏传 `expires_at`／`expires_in` → HTTP 400 `EXPIRES_AT_REQUIRED`（现行策略要求新 Token 显式期限）；补 `expires_in:"30d"` 后成功。

### 步骤 4 — 该 Token MCP `initialize` → `tools/list`

```json
{ "httpStatus": 200, "protocolVersion": "2025-03-26",
  "serverInfo": {"name":"ktx","version":"0.16.0"},
  "tokenSha12": "ed66660b5f88",
  "toolCount": 4,
  "toolNames": ["lucy_ops_concept_list","lucy_ops_concept_show",
                "lucy_ops_concept_summary","lucy_ops_concept_scan"],
  "opsConceptVisible": ["lucy_ops_concept_list","lucy_ops_concept_show",
                        "lucy_ops_concept_summary","lucy_ops_concept_scan"] }
```

`lucy_ops_concept_scan` 的 `inputSchema` 实测：

```json
{ "type": "object",
  "properties": { "dry_run": {"type":"boolean"}, "whitelist_ref": {"type":"string"},
                  "idempotency_key": {"type":"string"}, "plan_id": {"type":"string"},
                  "confirm_digest": {"type":"string"} },
  "additionalProperties": false }
```

> ✅ **可见性 PASS**：带 `allow.ops` 的 Agent 可见 4 个 `lucy_ops_concept_*`；未授的 `lucy_ops_connection_tables`／`lucy_ops_source_import`／`set_canonical`／`reject` **不可见**（逐条 grant 生效，未按角色名放行）。
> 该 Agent 的 `effective-permissions`：`tools=[]`（纯控制面角色，数据面能力为空）、`legacyAllow=false`、`roleIds=["uat-ops-concept-role"]`。

### 步骤 5 — `lucy_ops_concept_list`（空参数）

```json
{ "httpStatus": 502,
  "error": "Proxy error",
  "detail": "Upstream unavailable" }
```

### 步骤 6 — `lucy_ops_concept_summary`（空参数）

```json
{ "httpStatus": 502,
  "error": "Proxy error",
  "detail": "Upstream unavailable" }
```

### 步骤 7 — `lucy_ops_concept_scan`（`dry_run=true`，停在 preview）

```json
{ "httpStatus": 200,
  "result": { "isError": true,
              "content": [{ "type": "text", "text":
                "{\n  \"code\": \"ERR_MODULE_NOT_FOUND\",\n  \"message\": \"Cannot find module '/data/lucy/scripts/concepts/scan.mjs' imported from /app/webui/server/ops/concepts-adapter.ts\"\n}" }],
              "data": { "code": "ERR_MODULE_NOT_FOUND",
                        "message": "Cannot find module '/data/lucy/scripts/concepts/scan.mjs' imported from /app/webui/server/ops/concepts-adapter.ts" } } }
```

### 期望逐条对照

| 期望 | 观测 | 结论 |
|---|---|---|
| ops Token 的 `tools/list` 可见至少一个 `lucy_ops_concept_*` | 可见 **4** 个（list／show／summary／scan） | ✅ |
| `lucy_ops_concept_list` **业务成功**（读 `operation_state`／载荷，勿只看协议 ok） | HTTP 502 `{"error":"Proxy error","detail":"Upstream unavailable"}`；**无** `operation_state`、无 `concepts` 载荷 | ❌ **FAIL** |
| `scan` 达到「可观察的控制面受理」（成功 list 计划／preview／或明确的空库结果） | `isError=true`；`data.code=ERR_MODULE_NOT_FOUND`；**既非**计划／preview，**也非**明确空库结果 | ❌ **FAIL** |
| 不得静默当问数工具失败 | 失败是显式 `isError`＋`ERR_MODULE_NOT_FOUND`，未伪装成成功 | ✅（形态合规，但业务未受理） |
| 磁盘上未因本波误 commit 产生未清理的权威写 | `/data/lucy/config/concepts` **仍不存在**；`ops_plans`／`ops_operations`／`ops_targets` 中 `uat-ops-concept%` **0 行** | ✅（无权威写、无计划行残留） |

**UAT-OPS-CONCEPT-02 = FAIL**（可见性／授权 PASS，业务受理 FAIL）

### 根因定位（全真实测，非读码推断）

**症状 1 — `list`／`summary` 502。** 适配器 `webui/server/ops/concepts-adapter.ts` 的 `importConceptModule(projectRoot, "scripts/concepts/*.mjs")` 解析成 `path.join(projectRoot, rel)`；容器内 `projectRoot` = `KTX_PROJECT_ROOT` = `/data/lucy`。只读路径 `webui/server/ops/concepts-read.ts` 的 `importFromProject()` 同理。该 import 抛出的 `ERR_MODULE_NOT_FOUND` 未被工具层收敛，沿 `mcp-proxy.ts:7690` 顶层 catch 变成通用 502（`detail` 被抹成 `Upstream unavailable`，真实原因不可见）。

**症状 2 — `scan` 结构化 `isError`。** 写路径 `ops-tools.ts` 把异常收敛成 `isError` 信封，`data.code=ERR_MODULE_NOT_FOUND`，并**直接点名缺失文件** `/data/lucy/scripts/concepts/scan.mjs`。

**容器内事实（实测）**

| 事实 | 实测命令／结果 |
|---|---|
| `projectRoot` 下没有 `scripts/` | `docker exec compose-lucy-1 ls -d /data/lucy/scripts` → `No such file or directory` |
| `projectRoot` 下没有 `node_modules` | `ls -d /data/lucy/node_modules` → `No such file or directory`；`NODE_PATH` 为空；`/node_modules` 不存在 |
| 镜像里有 `scripts/concepts/`，但不在 `projectRoot` | `/app/scripts/concepts/` 存在（含 `scan.mjs`／`store.mjs`／`plan.mjs`／`apply.mjs`／`seed-whitelist.yaml`） |
| 概念核心依赖裸包 `yaml` | `scripts/concepts/store.mjs:4`、`scan.mjs:3` → `import … from "yaml"`；唯一可解析处 `/app/node_modules/yaml` |
| 容器内直接复现同一 import | `docker exec compose-lucy-1 node -e "import(pathToFileURL('/data/lucy/scripts/concepts/store.mjs').href)"` → `IMPORT_FAILED code=ERR_MODULE_NOT_FOUND` |

> **两个独立阻塞点**（任一单独修好都不够）：
> ① `scripts/concepts/` **不在** `KTX_PROJECT_ROOT` 下 → 文件找不到；
> ② 即使把它拷进 `/data/lucy/scripts/`，`import "yaml"` 仍会失败——Node 从**模块自身目录**向上找 `node_modules`，`/data/lucy` 及其祖先都没有可解析 `yaml` 的 `node_modules`。
> 即：当前实现把**代码根**（镜像 `/app`，与 `node_modules` 同级）与**内容根**（数据卷 `/data/lucy/config`）混为一谈，把纯计算核心锚在 `projectRoot` 上；而容器化部署里 `projectRoot` 是数据卷。
> 另：`examples/docker-demo/project-template/`（容器 `LUCY_TEMPLATE_ROOT`）也不含 `scripts/`，entrypoint 的 `sync_template_tree` 因此永远不会把它播种进 `/data/lucy`。

**旁证（只读探针，已清理）**：把概念核心放到容器内 `/tmp/uat-ops-concept-probe/scripts/concepts` 并让其 `node_modules` 可解析后，对**真实**内容根 `/data/lucy/config` 调纯计算核心：

| 探针 | 结果 | 说明 |
|---|---|---|
| `store.resolveFencedConceptsDir(contentRoot,{create:false})` | `/data/lucy/config/concepts`（不存在） | 围栏解析正常 |
| `store.listConceptIds(dir)` | `[]` | **list 本应返回空概念集**（SC-16 语义），且不建目录 |
| `planScan({contentRoot, whitelistPath})` | **成功**，`targets` **2 个**（`revenue` 等），`stats` 齐全 | **scan 本应产出非空 preview 计划**（可观察受理） |
| 探针前后 `/data/lucy/config/concepts` | **始终不存在** | 纯计算与 preview **不写**业务文件（SC-12） |

> 探针结论：**唯一阻塞是模块解析（装配问题）**，纯计算核心与内容根、围栏、空库语义、preview 不落盘语义在容器内均正常。探针目录 `/tmp/uat-ops-concept-probe` 已 `rm -rf` 删除（已验证不存在）。
> **注意**：该探针**不改变本条 FAIL 判定**——按 CONVENTIONS §3，不得用人工补件后的环境冒充交付环境 PASS。

### 附带发现（非本套件期望，供修复方参考）

1. **可观测性缺口**：`lucy_ops_concept_list`／`lucy_ops_concept_summary` 两次失败**没有留下任何 `access_log` 行**（`access_log` id 从 6259（`tools/list`）直接跳到 6260（`scan`）），因为异常在审计写入之前抛出；而 `scan` 留下了 `outcome=error`／`decision_reason=ERR_MODULE_NOT_FOUND`。读路径的失败在审计里**不可见**。
2. **错误可诊断性**：读路径失败被抹成通用 `502 {"error":"Proxy error","detail":"Upstream unavailable"}`，真实原因（模块缺失）不出现在响应体里，排障需翻容器。

---

## UAT-OPS-CONCEPT-03 — 清理临时资源

| 步骤 | 观测 | 结果 |
|---|---|---|
| 删 Token | `DELETE /api/admin/agents/uat-ops-concept-agent/tokens/uat-ops-concept` → HTTP 400 `FST_ERR_CTP_EMPTY_JSON_BODY`（本次请求未带 body；**该端点未被调用成功**） | ⚠️ 见下 |
| 删 Agent | `DELETE /api/admin/agents/uat-ops-concept-agent`（`dryRun=false`）→ HTTP 200；`ok=true`；`written=true`；`policyRuntimeAck` 已落 | PASS |
| 删 Role | `DELETE /api/admin/roles/uat-ops-concept-role`（`dryRun=false`）→ HTTP 200；`ok=true`；`written=true`；`policyRuntimeAck` 已落 | PASS |
| Token 已被耐久吊销 | `revoked_tokens` 新行：`token_hash=sha256:ed66660b5f88…`、`revoked_at=2026-11-15T03:37:30.933Z`、`reason=agent_deleted`（删 Agent 时连带吊销） | PASS |
| 临时 Token 实测已死 | 用该明文 token 再打 MCP `initialize` → **HTTP 401** `{"error":{"code":-32001,"message":"Unauthorized"}}`；`tools/list` → 同样 401 | PASS |
| Admin 列表无 `uat-ops-concept-*` 残留 | roles=`[demo_readonly, lucy_admin, chatbi-analyst, invest_uat_readonly, lucy_ops_reader]`；agents=`[demo_agent, zhangxingchen, invest_uat, hehe]`；`GET /api/admin/agents/uat-ops-concept-agent` → **404 `AGENT_NOT_FOUND`**；`GET /api/admin/tokens` 响应体不含 `uat-ops-concept` | PASS |
| 容器 `access.yaml` 无残留 | `grep -c uat-ops-concept /data/lucy/webui/config/access.yaml` → **0** | PASS |
| 问数 Token 再抽查（OPS-CONCEPT-01 复跑） | `tools/list` → 200；11 个工具；`lucy_ops_concept_*` **0** 个；`tools/call lucy_ops_concept_list` → `isError=true`，`Access denied: ops_not_granted:lucy_ops_concept_list` | PASS |
| 无遗留权威写 | `/data/lucy/config/concepts` 不存在；`ops_plans`／`ops_operations`／`ops_targets` 中 `uat-ops-concept%` **0 行** | PASS |

**UAT-OPS-CONCEPT-03 = PASS**

> 关于首行 Token 删除 400：`DELETE .../tokens/:label` 因本次请求带 `Content-Type: application/json` 且 body 为空被 Fastify 拒。**实际吊销由删 Agent 路径完成**（`reason=agent_deleted`），并已用「明文 token 再调 MCP → 401」实证，效力不低于显式吊销；无残留 token 留在 `access.yaml` 或 `revoked_tokens` 之外。

---

## UAT-OPS-CONCEPT-04 — 人审写 commit

**SKIPPED**（本波默认不做；brief 明令「禁止对本波做 set_canonical／reject commit」）。且在 02 FAIL 的前提下不具备执行前提。

---

## 结果

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | `compose-lucy-1` healthy（`RestartCount=0`）；health 200 `ok=true` `gitSha=9d59337d…` `ktxRuntime=ready`；WebUI 登录 `xingchen`(owner)；问数 MCP initialize 200＋`mcp-session-id`＋`serverInfo={ktx,0.16.0}` |
| UAT-OPS-CONCEPT-01 | **PASS** | 问数 Token `tools/list` 11 工具／`lucy_ops_concept_*` **0**；显式调用 → `isError=true` `Access denied: ops_not_granted:lucy_ops_concept_list`；审计 id 6256 `outcome=denied` |
| UAT-OPS-CONCEPT-02 | **FAIL** | 可见性 PASS：ops Token `tools/list` 见 **4** 个 `lucy_ops_concept_*`（未授者不可见）；业务受理 FAIL：`list`/`summary` → **502** `Proxy error / Upstream unavailable`；`scan(dry_run=true)` → `isError=true` `data.code=ERR_MODULE_NOT_FOUND`（`Cannot find module '/data/lucy/scripts/concepts/scan.mjs'`）。根因：`projectRoot=/data/lucy` 下既无 `scripts/concepts/`、也无 `node_modules`（裸依赖 `yaml` 不可解析） |
| UAT-OPS-CONCEPT-03 | **PASS** | Token 耐久吊销（`reason=agent_deleted`；明文再调 → 401）；Agent／Role 删除 200；Admin 列表 roles 5／agents 4，无 `uat-ops-concept-*`；`access.yaml` 命中 0；问数 Token 复跑仍无 ops 工具且显式拒绝 |
| UAT-OPS-CONCEPT-04 | **SKIPPED** | 本波默认不做（禁止 set_canonical／reject commit） |

**套件判定：FAIL** —— 必做项 UAT-OPS-CONCEPT-02 失败（授权面 PASS、运行时面 FAIL）；UAT-R0／01／03 全 PASS。

### FAIL 复现步骤（无 secret）

**前置**：容器 `compose-lucy-1` healthy；WebUI `http://127.0.0.1:55176`（管理员登录）；MCP `http://127.0.0.1:57881/mcp`。

1. `curl -s http://127.0.0.1:55176/api/health` → 记 `gitSha`（本波 `9d59337de500c778a6cee773f1bdeb41c7af837e`）。
2. `docker exec compose-lucy-1 ls -d /data/lucy/scripts` → **No such file or directory**；`docker exec compose-lucy-1 ls -d /data/lucy/node_modules` → **No such file or directory**；`docker exec compose-lucy-1 ls /app/scripts/concepts` → **有** `scan.mjs`／`store.mjs`／`plan.mjs`／`apply.mjs`／`seed-whitelist.yaml`。
3. 管理员建 Role（`POST /api/admin/roles`，`dryRun=false`）：

   ```json
   { "roleId": "uat-ops-concept-role",
     "role": { "description": "UAT", "permission_model_version": 2,
               "allow": { "ops": [ { "tools": ["lucy_ops_concept_list","lucy_ops_concept_show",
                                               "lucy_ops_concept_summary","lucy_ops_concept_scan"],
                                     "asset_kinds": ["governance"] } ] } } }
   ```

4. 建 Agent（`POST /api/admin/agents`，`dryRun=false`）：`{"agent":{"id":"uat-ops-concept-agent","name":"UAT","roles":["uat-ops-concept-role"]}}`。
5. 签 Token（`POST /api/admin/agents/uat-ops-concept-agent/tokens`）：`{"label":"uat-ops-concept","expires_in":"30d"}` → 明文仅留在本机进程／临时文件。
6. 用该 Token 调 MCP：`initialize` → `notifications/initialized` → `tools/list` → **可见 4 个 `lucy_ops_concept_*`**（授权面正常）。
7. `tools/call lucy_ops_concept_list {}` → **HTTP 502** `{"error":"Proxy error","detail":"Upstream unavailable"}`。
8. `tools/call lucy_ops_concept_scan {"dry_run":true}` → `isError=true`，`data.code=ERR_MODULE_NOT_FOUND`，message 含 `Cannot find module '/data/lucy/scripts/concepts/scan.mjs'`。
9. 容器内最小复现（不需 WebUI／Token）：

   ```bash
   docker exec compose-lucy-1 node -e "const p=require('node:path'),{pathToFileURL}=require('node:url');\
     import(pathToFileURL(p.join('/data/lucy','scripts/concepts/store.mjs')).href)\
     .then(()=>console.log('IMPORT_OK')).catch(e=>console.log('IMPORT_FAILED',e.code,e.message))"
   # → IMPORT_FAILED ERR_MODULE_NOT_FOUND Cannot find module '/data/lucy/scripts/concepts/store.mjs'
   ```

10. 清理：`DELETE /api/admin/agents/uat-ops-concept-agent`（连带吊销 token）→ `DELETE /api/admin/roles/uat-ops-concept-role` → 复跑问数 Token 的 `tools/list` 应仍无 `lucy_ops_concept_*`。

### 移交修复方的定位要点（本波不改正则代码）

适配器把**代码根**与**内容根**混为一谈：`webui/server/ops/concepts-adapter.ts` 的 `importConceptModule()`／`webui/server/ops/concepts-read.ts` 的 `importFromProject()` 都以 `projectRoot` 为锚解析 `scripts/concepts/*.mjs`，而 `projectRoot` 在容器化部署里是数据卷 `/data/lucy`（无 `scripts/`、无 `node_modules`）；核心又依赖裸包 `yaml`，只能从与 `node_modules` 同级的代码根（如镜像 `/app`）加载。修复方向需在「代码根／内容根解耦」与「核心依赖自包含（打包 `yaml` 或改为相对依赖）」之间取舍，并补一条**部署态**（容器内、真实 `KTX_PROJECT_ROOT`）的验收，而非只靠把 `scripts/concepts` 拷进临时 `projectRoot` 的 vitest 夹具——现有夹具 `webui/server/ops/__tests__/ops-concepts.test.ts` 会 `cp` `scripts/concepts` 到临时 `projectRoot`，恰好制造了容器里并不存在的前提。

---

## 清理

| 项 | 状态 |
|---|---|
| Role `uat-ops-concept-role` | ✅ 已删除（`DELETE /api/admin/roles/uat-ops-concept-role` → 200） |
| Agent `uat-ops-concept-agent` | ✅ 已删除（`DELETE /api/admin/agents/uat-ops-concept-agent` → 200；连带吊销 token，`reason=agent_deleted`） |
| Token label `uat-ops-concept` | ✅ 已吊销（`revoked_tokens` 有行；明文再调 MCP → 401） |
| 容器 `access.yaml` 残留 | ✅ 0 命中 |
| Admin 列表残留 | ✅ roles 5／agents 4，均无 `uat-ops-concept-*`；`GET .../agents/uat-ops-concept-agent` → 404 |
| 容器 `/data/lucy/scripts` | ✅ 不存在（从未创建） |
| 容器 `/data/lucy/config/concepts` | ✅ 不存在（未产生权威写） |
| `ops_plans`／`ops_operations`／`ops_targets` | ✅ `uat-ops-concept%` 0 行 |
| 容器临时探针 `/tmp/uat-ops-concept-probe` | ✅ 已 `rm -rf` 删除（已验证不存在） |
| 本机临时目录 `/tmp/uat-ops-concept-work`（脚本＋ops token 明文） | ✅ 已删除（见下「跑后清理」） |
| 证据目录 | `inbox/uat-p1-11-12-14-2026-11-15/p1-11/evidence.json`（无 secret；`inbox/` 已被 `.gitignore:59` 忽略） |

**清理是否完成：是。**

---

## 备注

- **是否使用 `docker restart`**：**否**。`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-14T07:16:15.41952696Z`（与 2026-11-14 同实例）。本跑次**未**重启／未重建容器、未改 compose／Dockerfile／产品代码。
- **未用 vitest／CR／读代码冒充 PASS**：所有 PASS 判定来自真实 MCP `tools/list`／`tools/call` 响应、真实 HTTP 状态码、容器 `access_log`／`revoked_tokens` 耐久行、以及容器内 `node` 直接 import 复现。根因分析中的代码引用仅用于**定位**，不作为 PASS 依据。
- **未改** `docs/qa/uat/INDEX.md`、`docs/governance/e2e-ledger.md`、`docs/qa/uat/suites/ops-concepts/cases.md`／`fixtures.md`／`suite.md`、`docs/specs/**`、产品代码；**未**对概念库做 set_canonical／reject commit。
- **凭据处理**：WebUI 口令只从本机文件读入进程内存（`sha256` 前 12 位 `a81adb12421a`），问数 Bearer 与临时 ops Token 明文只落 `/tmp`（`chmod 600`）并在跑后删除；**未**写入本跑次正文、证据 JSON、仓库文件或回复文本。`/Users/forrest/Desktop/lucywebui logi.txt` 本机不存在，已用回退路径 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（与 2026-11-13／2026-11-14 同类跑次一致）。
- **停表依据**：brief「01／02／03 任一 FAIL → 停；尽量完成清理」——02 FAIL 后未再继续任何写动作，仅执行 03 清理与只读复查；未越界到 04（commit）。
- **本跑次不改 INDEX**：结果由委托人／Wave 汇总方按本跑次文件登记。
