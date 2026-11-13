# Run — 2026-11-13 — claude-adversarial

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CONN-RELOAD` |
| Agent | Claude（对抗性全真复跑；相对 Cursor 跑次另造路径） |
| 环境 | WebUI `http://127.0.0.1:55176`；容器 `compose-lucy-1`；`lucyVersion=0.30.0`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`；`gitDirty=false`；容器 `StartedAt=2026-11-13T04:00:12.439734509Z`／`RestartCount=0`（跑次前后一致） |
| 开始／结束 | 2026-11-13 12:31–12:52（同日会话） |
| 总判定 | **PASS** |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | PASS | `docker compose ps` → lucy／demo-db 均 healthy；`/api/health` `ok=true`；`ktx-reload.capability` `state=idle`（supervisorPid=193，heartbeat 04:46:05）；`ktx-reload.state.json` `activation=current`／`verification=verified` |
| UAT-CONN-RELOAD-C01 | PASS | `verify-ktx-reload-lifecycle.sh --container` → **PASSED: 25 checks**（含 VERIFY-191-C01 canary：写入 canary → supervisor receipt succeeded → `connection_list` 含 canary id → 还原 ktx.yaml） |
| UAT-CONN-RELOAD-E2E-07 | PASS | `npm run e2e:live:connection-reload` → E2E-CON-07 **5.5s**；跑次末复跑 **5.7s**（2 passed） |
| UAT-CONN-RELOAD-E2E-02 | PASS | 同命令 → E2E-MCP-02 **2.6s**；跑次末复跑 **2.3s** |
| UAT-CONN-RELOAD-01 | PASS（**对抗**） | 另造新 id `uat-adv-reload-mwei5w8i` → demo-db/`e2e_conn_reload`；见下「对抗加码」A1–A4 |
| UAT-CONN-EDIT-01 | SKIPPED | 可选（编辑成功面 ack），本跑次未单独做 |
| UAT-CONN-RELOAD-02 | SKIPPED | 可选（失败可观测），本跑次未单独做 |

## 对抗加码（相对 Cursor 跑次新造，均全真执行）

| # | 对抗动作 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| A1 | 用**新** connectionId `uat-adv-reload-<ts>` 经 API 新建到 `demo-db`／`e2e_conn_reload`（非复用 Cursor 的 `e2e-conn-reload-*`） | `executionRuntimeAck=true` | HTTP 200，`written=true`，`test.status=ok`，`executionRuntimeAck=true`，`executionRuntimeStatus=ok`，`executionDecisionReason=allowed`，响应体无口令明文 | PASS |
| A2 | **不依赖 WebUI API** 证明执行层真的加载：在容器内直连 KTX MCP（`127.0.0.1:7878/mcp`）调 `connection_list` | 新 id 出现在执行层连接表 | `["demo-mysql","invest-db","lucy-ops","mysql-aliyun","uat-adv-reload-mwei5w8i","_ktx_federated"]` | PASS |
| A3 | **对问数可见**（Cursor 跑次未做）：用新连接 id 在执行层跑 `sql_execution` 真实取数 | 能真实读到数据 | `SELECT id,label,amount FROM uat_reload_probe` → `rows=[[1,"uat-claude-adv",42]]`，`isError=false` | PASS |
| A4 | **脏激活态写入**：先制造 `activation=reload_required`，再新建连接 | 写入不失败且 ack 诚实 | HTTP 200，`executionRuntimeAck=true`；**未做任何人工重载即自动回到 `activation=current`** 且新 id 进入 `loadedConnectionIds`；执行层 `connection_list` 含新 id；新 id 上 `sql_execution` 同样可取数 | PASS |
| A5 | **手动重载同协议**：与 UI「重载执行层」同一端点 `POST /api/admin/mcp-runtime/reload` | 响应分字段、无模糊单一 ok | `reloadStatus=succeeded`／`configVerification=verified`／`mcpReachable=reachable`；payload 键=`[requestId,reloadStatus,configVerification,mcpReachable,requestedDigest,actualDigest,detail,startedAt,finishedAt,durationMs]`（**无** `ok`／`success` 键）；响应文本无「重启 Pod／请重启」 | PASS |
| A6 | **端点闸对抗**：`demo-db:3306` 上同时存在 2 条 MySQL 连接时再建第 3 条 | 记录真实闸行为 | 409 `ENDPOINT_ALREADY_CONNECTED`，`detail.reason=multiple`，`matches=2`；**同时传 `acknowledgeSeparateConnection` 与 `acknowledgeDifferentDatabase` 均无法绕过**（按设计：UI 该分支让用户「选择已有连接 → 添加到所选连接」，不是新建逃生口） | 观察（设计行为，非缺陷） |

## 备注

- 是否使用 `docker restart`：**否**。容器 `StartedAt` 全程不变、`RestartCount=0`（跑次首尾各 `docker inspect` 取证）。
- 未使用 `docker restart`／`npm run demo:upgrade -- --fresh`。
- 清理是否完成：**是**。全部临时连接已删；容器内 `ktx.yaml` 中 `uat-adv-` 出现次数 = **0**；执行层 `connection_list` 无 `uat-adv-*` 残留；`demo-db:3306` 上 MySQL 连接数回到 **1**（仅 `demo-mysql`），端点闸前置条件复原。
- 跑次末环境健康复检：重跑 `npm run e2e:live:connection-reload` → **2 passed**（8.5s）。
- 登录文件：`/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（live-e2e 默认；`/Users/forrest/Desktop/lucywebui logi.txt` 本机**不存在**）。口令仅从文件读入进程内存，**未**写入仓库／本跑次／日志。
- 原始日志（gitignored `inbox/uat-claude-adv-2026-11-13/`）：`e2e-live-connection-reload.log`、`verify-191-c01.log`、`adv-reload.log`、`probe.log`、`probe-409.log`、`e2e-live-connection-reload-postrun.log`

## 本跑次自身的脚本缺陷（先排除自身、再判定产品）

对抗首轮曾出现 9 条断言失败，**逐条查证后确认全部是本跑次脚本缺陷，不是产品缺陷**（记录在此以免后续跑次重复踩）：

1. `POST /api/admin/mcp-runtime/reload` 必须带 JSON body；空 body → 400 `FST_ERR_CTP_EMPTY_JSON_BODY`。→ 脚本补 body 后 200。
2. `e2e_conn_reload` 当时 **0 张表**，`live-schemas` 只列有表的 schema，故该 schema 不出现是正确行为，不是功能缺陷。→ 种子库加 `uat_reload_probe`（1 行）后读路径可证。
3. A2 首跑 409 实为**端点闸** `ENDPOINT_ALREADY_CONNECTED`（`reason=multiple`），**不是**「reload_required 阻断写入」。→ 确认在 `activation=reload_required` 下写入其实 **200 + ack=true**，且自动重载（见 A4）。
