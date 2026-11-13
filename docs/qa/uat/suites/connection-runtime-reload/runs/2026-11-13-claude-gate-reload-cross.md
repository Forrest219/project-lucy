# Run — 2026-11-13 — claude-gate-reload-cross

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CONN-RELOAD` |
| Cases | `UAT-CONN-GATE-01`、`UAT-CONN-RELOAD-02` |
| Agent | Claude（独立交叉验证；相对 Cursor 跑次另造路径，另造 id） |
| 环境 | WebUI `http://127.0.0.1:55176`；容器 `compose-lucy-1`／`compose-demo-db-1`；`lucyVersion=0.30.0`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`；`gitDirty=false` |
| 命令 | `node inbox/xgate-xreload-cross.mjs`（自建脚本，gitignored；不复用 Cursor 的 `scripts/uat/run-zhaomin-local-gaps.mjs`） |
| 原始证据 | `inbox/xgate-xreload-cross.out.json`（本文件所有数字的来源） |
| 本跑次 id | `uat-xgate-mwepjbds-a`／`-b`／`-c`；`uat-xreload-mwepjbds-fail`；`uat-xreload-ok-mwepjbds` |
| 起止 | 2026-11-13 08:21:02Z → 08:21:11Z（容器内时钟） |
| 总判定 | **PASS**（两条用例的用例正文断言全部成立）；**另有一处对抗探针的文案预期与产品实际分支不符**，见「偏离与发现」D1 |

| Case | 结果 | 证据 |
|---|---|---|
| UAT-CONN-GATE-01 | **PASS** | `POST /api/connections`，`id=uat-xgate-mwepjbds-a`，`host=demo-db`／`port=3306`／`database=ods.fact`，`dryRun=false`，**不传** `acknowledgeDifferentDatabase` → **409**，`code=SAME_SERVER_DIFFERENT_DATABASE`，文案逐字为「这是另一个外部目录，不会加到已有连接。确认后将新增一张连接卡片。」（`error.detail.matches=[demo-mysql]`，`requestedDatabase=ods.fact`）；`ktx.yaml` 内该 id 出现 **0** 次；`.ktx/secrets/` 内该 id 的口令文件 **不存在** |
| UAT-CONN-RELOAD-02 | **PASS** | 能力文件置 `state=reloading`＋新鲜心跳后，对 supervisor pid **193** 发 `SIGSTOP`（`/proc/193/stat` 第 3 字段实测 `T`＝已停）→ `POST /api/connections`（`id=uat-xreload-mwepjbds-fail`，`demo-db`／`e2e_conn_reload`，`dryRun=false`，`acknowledgeSeparateConnection=true`）→ **503**，`code=EXECUTION_RUNTIME_NOT_LOADED`，文案「配置已保存，但执行层未加载。」，响应体**无** `executionRuntimeAck` 字段（≠ `true`）；耗时 575ms。`finally`：`SIGCONT`（实测 `/proc/193/stat`＝`S`）＋ 能力文件按原字节写回（`state=idle`，心跳回到 `2026-11-13T08:21:03.000Z`）→ 删除已落盘连接（HTTP 200）→ 残留 **0** |

## 对抗加码（本跑次新造，均全真执行）

| # | 对抗动作 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| A1 | 新 id `uat-xgate-mwepjbds-a`，`database=ods.fact`（点号形态），不带任何确认 | 409 `SAME_SERVER_DIFFERENT_DATABASE`＋「另一个外部目录」文案 | 409，code 与文案逐字相符，`ktx.yaml` 命中 0，口令文件未生成 | PASS |
| A2 | 新 id `uat-xgate-mwepjbds-b`，**无点号**新库名 `uat_plain_x`，同一 `demo-db:3306`，同样不带任何确认 | 应为「另一个 database」文案，**不得**为「另一个外部目录」；不许落盘 | 409 `ENDPOINT_ALREADY_CONNECTED`（`detail.reason=username_differs`），文案「已有连接使用另一用户名。默认不复用该连接。」——**不是**「另一个外部目录」✓，**也不是**「另一个 database」✗；`ktx.yaml` 命中 0，口令文件未生成 | **部分偏离**，见 D1 |
| A3 | 新 id `uat-xgate-mwepjbds-c`，同样 `uat_plain_x`，但用户名改用 `demo-mysql` 已有的 `lucy`（补齐 A2 的另一条分支） | 记录真实闸行为 | 409 `ENDPOINT_ALREADY_CONNECTED`（`detail.reason=reuse_existing_credentials`），文案「主机端口已有连接。添加 Schema 将使用已有凭据，新输入的密码不会保存。」；`ktx.yaml` 命中 0 | 观察（见 D1） |
| A4 | 能力文件改写后 **重新断言** 一次再发请求 | 防 supervisor 心跳（约 5s 一次）覆盖伪造的 `reloading` | `SIGSTOP` 生效（proc=`T`）后重写，回读 `state=reloading`／心跳 `2026-11-13T08:21:04.451Z` | PASS |
| A5 | 恢复后再建一条 `uat-xreload-ok-mwepjbds` 到同一库 | `executionRuntimeAck=true`（证明暂停没有把执行层留在失败态） | HTTP 200，`written=true`，`test.status=ok`，`executionRuntimeAck=true`，`executionRuntimeStatus=ok`，`executionDecisionReason=allowed`；随后删除 HTTP 200，残留 0 | PASS |
| A6 | 跑次末环境复原核对 | health ok／`activation=current`／能力文件 `state=idle`／supervisor 存活／两个临时 id 都不在 `ktx.yaml` | health `ok=true`、`activation=current`、`verification=verified`、`loadedConnectionIds=[demo-mysql,invest-db,lucy-ops,mysql-aliyun]`；能力文件 `state=idle`；pid 193 proc=`S`；`ktx.yaml` 内 `uat-x` 命中 **0**；`ktx.yaml` sha256 跑次前后**逐字节相同**（`b8ee0562…f38`） | PASS |

## 偏离与发现

**D1（文案预期与实际分支不符，非数据安全缺陷）** — 对抗探针 A2 期望无点号新库名命中「同一主机端口上的另一个 database 将新增一张连接卡片。」，实测命中的是更早的**端点闸**分支（409 `ENDPOINT_ALREADY_CONNECTED`）。原因（读码定位，非执行证据）：`webui/server/connection-endpoint-gate.ts:119-130` 规定「纯 MySQL 按 host+port 匹配」，仅当某一侧带 `catalog.database` 形态时才比目录名；`demo-mysql` 存的库名是纯名 `dataforai`，因此无点号请求被判为**同一端点**，直接进入 `:205-238` 的用户名／Schema 复用分支，而 `:184-198` 的 `SAME_SERVER_DIFFERENT_DATABASE` 分支根本走不到。该分支的「另一个 database」文案只有在**已存连接的库名本身是 `catalog.database` 形态**、而新请求是纯名时才会出现——当前 demo 栈 4 条连接（`demo-mysql`/`dataforai`、`invest-db`/`invest`、`mysql-aliyun`/`dataforai`、`lucy-ops`/sqlite）**没有**这种形态，故该文案在本栈不可达。

安全性质不受影响：两条路径都要求显式确认（`acknowledgeSeparateConnection`／`acknowledgeDifferentDatabase`）才会新增同服第二条连接，两条探针均未落盘，文案也**没有**把纯名库错标成「外部目录」。用例正文（cases.md）断言全部成立，故本跑次判 PASS；此条仅说明「另一个 database」文案在当前 demo 配置下为死分支（文案选择不精确／未覆盖），建议登记为文案与覆盖度议题，不在本跑次改产品代码。

**D2（残留观察，非本跑次产生）** — `POST /api/connections/{id}/remove` 删除连接后**不删** `.ktx/secrets/{id}-password`（本跑次 `secretFileAfterRemove=true`，脚本已按 id 精确删除自己产生的两个口令文件）。同类残留可见于上一跑次遗留的 `uat-reload-fail-mwep6qrk-password`。属既有行为，本跑次未改产品代码，也未清理他人跑次残留。

## 清理与环境复原

- 未做「确认后真连接」（cases.md 明确不做；本机没有接受 `目录.库` 的服务器）。未 `docker restart`／`npm run demo:upgrade -- --fresh`。
- `demo-db` 侧：`CREATE DATABASE IF NOT EXISTS e2e_conn_reload` 为幂等 no-op（该库及表 `uat_reload_probe` 跑次前已存在）；**未新建、未删除任何库**。
- 临时连接 3 条（`uat-xgate-mwepjbds-a/-b/-c` 未落盘；`uat-xreload-mwepjbds-fail`、`uat-xreload-ok-mwepjbds` 已删）→ `ktx.yaml` 内 `uat-x` 命中 **0**；口令文件无 `uat-x*` 残留。
- 能力文件按跑次前原字节写回；`ktx-reload.state.json` `activation=current`／`verification=verified`；supervisor pid 193 存活（proc=`S`，非 `T`）。
- 登录口令与数据库口令仅从文件／环境变量读入进程内存，**未**写入本文件、仓库或日志（脚本内置 redactor，输出中同串替换为 `[redacted]`）。

## 本跑次自身的脚本缺陷（先排除自身、再判定产品）

首轮曾因本跑次脚本里一处变量名笔误（报告组装时引用了未定义变量）导致**报告未能生成**；该轮的执行动作已实际发生。处置：① 独立复核该轮后的环境（health `ok`／`activation=current`／能力文件 `idle`／supervisor 存活／`uat-x` 残留 0）确认复原无误；② 修正脚本后**换新 id 整轮重跑**，上表所有数字均取自重跑结果（`inbox/xgate-xreload-cross.out.json`），首轮结果不作为判定依据。
