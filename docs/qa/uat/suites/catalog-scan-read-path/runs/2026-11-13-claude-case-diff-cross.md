# Run — 2026-11-13 — claude-case-diff-cross

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN` |
| Cases | `UAT-SCAN-CASE-01`、`UAT-SCAN-DIFF-01`（合同见 `docs/qa/uat/suites/catalog-scan-read-path/cases.md`） |
| Agent | Claude（独立交叉验证；不复用 Cursor 跑次的脚本／连接 id／库名／表名） |
| 环境 | WebUI `http://127.0.0.1:55176`；容器 `compose-lucy-1`（`StartedAt=2026-11-13T08:28:59.136Z`，`RestartCount=0`）／`compose-demo-db-1`（`StartedAt=2026-11-12T14:30:49Z`，`RestartCount=0`）；`lucyVersion=0.30.0`；`bundledKtxVersion=0.16.0`；`gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690`；`gitDirty=true`；`demo-db` = MySQL **8.4.13** |
| 命令 | `node inbox/xcase-case-diff-cross.mjs`（自建脚本，位于 gitignored 的 `inbox/`；**未**调用 `scripts/uat/run-zhaomin-local-gaps.mjs`） |
| 原始证据 | `inbox/xcase-case-diff-cross.out.json`（本文件所有数字与文案的来源） |
| 本跑次资产 | 库 `uat_xcase`；表 `Bar`／`bar`／`uniq_row`；连接 `uat-xcase-mwepy6qj` |
| 起止 | 2026-11-13 08:32:36.763Z → 08:32:46.260Z（宿主机 UTC，与容器内时钟同源，实测两钟一致） |
| 总判定 | **PASS**（两条用例的用例正文断言全部成立；两条对抗加码同样成立） |

| Case | 结果 | 证据 |
|---|---|---|
| UAT-SCAN-CASE-01 | **PASS** | 前置 `SHOW VARIABLES LIKE 'lower_case_table_names'` = **0**（非 0 则整批 BLOCKED，本跑次未触发）；`information_schema.tables` 实测 **同时**含 `Bar`／`bar`（`BINARY table_name` 复核为 `Bar`／`bar` 两行，大小写互不相同），另含 `uniq_row`。连接 `uat-xcase-mwepy6qj` 创建 **200**，`executionRuntimeAck=true`，`test.status=ok`。请求 `tables:["Bar"]` → **400**，`code=READ_FAILED`，文案逐字为「表名「Bar」对应多张表，无法读取字段。」，响应体**仅** `{"ok":false,"error":{"code":"READ_FAILED","message":"表名「Bar」对应多张表，无法读取字段。"}}`——无 `data`、**无** `columnCount`（正文正则 `"columnCount"\s*:\s*\d` 不命中）、**无** `yaml`／字段清单（不返回可写入 Manifest 的字段列表）、**无**口令明文。对照 `tables:["uniq_row"]` → **200**，`namesOnly=false`，`columnCount=1`，`tableCount=1`，返回可写入 Manifest 的 `yaml` 字段清单 |
| UAT-SCAN-DIFF-01 | **PASS** | `GET /api/connections/uat-xcase-mwepy6qj/table-structure-diff?schema=uat_xcase&tables=uniq_row,ghost_x` → **200**，`ok=true`；`uat_xcase.uniq_row` **status=ok**（`columns.added=[{name:id,type:number,nullable:false,primaryKey:true}]`）；`uat_xcase.ghost_x` **status=not_in_library**（`reason` 为空，**非** `QUERY_FAILED`） |

## 独立性声明（不复用 Cursor 跑次）

| 维度 | Cursor 跑次（对照） | 本跑次（Claude） |
|---|---|---|
| 脚本 | `scripts/uat/run-zhaomin-local-gaps.mjs` | `inbox/xcase-case-diff-cross.mjs`（自建） |
| 连接 id | `uat-case-mwepu1d7` | `uat-xcase-mwepy6qj` |
| 库 | `uat_case_pair` | `uat_xcase` |
| 表 | `Foo`／`foo`／`only_one`／`missing_tbl` | `Bar`／`bar`／`uniq_row`／`ghost_x`／`ghost_y` |
| 歧义触发形式 | 仅 `Foo`（大写） | `Bar`（大写）＋ `bar`（小写，双向各测一次） |
| 缺表探针 | 1 张（`missing_tbl`） | 2 张同批（`ghost_x`＋`ghost_y`） |

库名／表名／连接 id／口令全部另造；口令仅从环境变量 `UAT_DEMO_DB_PASSWORD` 读入进程内存，脚本内置 redactor，所有捕获体在写盘与打印前均做替换；本文件与最终回复中均无口令明文。

## 对抗加码（本跑次新造，均全真执行）

| # | 对抗动作 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| A1 | `tables:["bar"]`（**小写**歧义表；大小写不敏感解析下它与 `Bar` 指向同一对） | 同样 **400** `READ_FAILED`＋「对应多张表」；**不得** 200 把两张表合成一份字段 | **400**，`code=READ_FAILED`，文案逐字为「表名「bar」对应多张表，无法读取字段。」；响应体仅 error，无 `columnCount`、无字段清单、无口令 | PASS |
| A2 | 同一次请求里再加第二张不存在的表（`tables=uniq_row,ghost_x,ghost_y`） | `uniq_row` 仍 **ok**；两张缺表都 **not_in_library**；HTTP 200 | HTTP **200**；`uat_xcase.uniq_row`=**ok**；`uat_xcase.ghost_x`=**not_in_library**；`uat_xcase.ghost_y`=**not_in_library**；两行 `columns.added/removed/changed` 均空 | PASS |
| A3 | 前置闸：`lower_case_table_names` | 必须为 0，否则整批 BLOCKED | 实测 **0**（MySQL 8.4.13），未触发 BLOCKED | PASS |
| A4 | 前置闸：`information_schema` 大小写共存 | 必须同时看到 `Bar` 与 `bar` | `SELECT table_name` 实测三行 `Bar`／`bar`／`uniq_row`；再以 `BINARY table_name` 复核为 `Bar`／`bar` 两行不同值 | PASS |
| A5 | 歧义响应不得携带可写入 Manifest 的字段清单 | 不得出现 `columns`／`fields`／`tables` 数组或 `yaml` | 两个 400 响应体均只有 `ok`＋`error` 两个键；`data` 键不存在 | PASS |
| A6 | 新建连接时带 `acknowledgeSeparateConnection=true`／`dryRun=false`（用户名闸需要） | 连接落盘可用 | **200**，`written=true`，`executionRuntimeAck=true`，`test.status=ok`（671ms），`policyRuntimeAck=true` | PASS |

## 偏离与发现

**D1（既有行为，非本跑次产生，已按 id 精确清理自己的产物）** — `POST /api/connections/{id}/remove` 删除连接后**不删** `.ktx/secrets/{id}-password`。本跑次删除连接后该口令文件仍在（`uat-xcase-mwepy6qj-password`），脚本按 id 精确删除自己产生的这一个文件后复核命中数为 0。同类残留可见于更早跑次遗留的 `uat-case-*`／`uat-scan-wide-*` 口令文件——属既有行为，本跑次**未改产品代码，也未清理他人跑次残留**。该现象与 2026-11-13 同日 `connection-runtime-reload` 跑次记录的 D2 一致。

**D2（无偏离）** — 本跑次两条用例的正文断言（HTTP 状态、`code`、文案关键片段、无 `columnCount` 数字、无口令明文、无字段清单、`namesOnly=false`、`columnCount>=1`、`status=ok`／`not_in_library`、HTTP 200）全部成立，与 Cursor 同构建跑次的结论一致；本次用**完全不同的库名、表名、连接 id 与歧义触发方向**（小写侧）复现，说明结论不依赖上一跑次的特定夹具。

## 清理与环境复原

- `POST /api/connections/uat-xcase-mwepy6qj/remove` → **200**，`ok=true`；删除后 `GET /api/connections` 不再含该 id。
- `DROP DATABASE uat_xcase` 已执行；`SHOW DATABASES LIKE 'uat_xcase'` → **空**。
- `ktx.yaml` 内该连接 id 命中 **0** 次（容器 `/data/lucy/ktx.yaml` 与仓库 `ktx.yaml` 双向核对均为 0）；`uat_xcase` 字样命中同样为 0。
- **配置逐字节复原**：跑次后 `/data/lucy/ktx.yaml` 的 `sha256 = b8ee05627501df35a7795960044f160f28c4a2e4c389f522c1c7c1fff5a00f38`，与本仓 2026-11-13 `claude-gate-reload-cross` 跑次记录的基线摘要**一致**；`GET /api/health` 的 `execution.verification.digest` 同值、`verification.state=verified`、`activation=current`、`reload.state=succeeded`、`ktxRuntime.ready=true`；`loadedConnectionIds=[demo-mysql,invest-db,lucy-ops,mysql-aliyun]`（不含本跑次临时连接）。
- 未 `docker restart`／`npm run demo:upgrade`；未对 supervisor 发 `SIGSTOP`／`SIGCONT`（`compose-lucy-1` `RestartCount=0`，`StartedAt=2026-11-13T08:28:59.136Z` 早于本跑次起点 08:32:36.763Z；`compose-demo-db-1` `StartedAt=2026-11-12T14:30:49Z`）。
- 新建连接触发了执行层一次正常 reload（`startedAt=2026-11-13T08:32:44.726Z` → `finishedAt=2026-11-13T08:32:45.000Z`，`state=succeeded`），为产品自身在写入新连接后的既有行为，非本跑次的进程级干预。
- 本跑次未改产品代码、未改 `docs/qa/uat/INDEX.md`、未 `git commit`；仅新增本文件与 `inbox/` 下两份 gitignored 产物。
