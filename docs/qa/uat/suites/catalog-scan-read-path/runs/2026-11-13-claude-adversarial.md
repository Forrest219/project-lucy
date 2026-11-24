# Run — 2026-11-13 — claude-adversarial

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN` |
| Agent | Claude（对抗性全真复跑；相对 Cursor 跑次另造路径） |
| 环境 | 同 CONN-RELOAD 跑次（`compose-lucy-1`／`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`／`RestartCount=0`）；种子库 `uat_wide_scan_adv` **250 tables／1500 column_rows**（本次对抗新增）；对照库 `uat_wide_scan` **200／1200**（未改动） |
| 开始／结束 | 2026-11-13 12:52–13:02（同日会话） |
| 总判定 | **PASS WITH GAP**（必做全绿；外部目录 live **BLOCKED**，替身 vitest PASS） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SCAN-SEED | PASS | `UAT_WIDE_DB=uat_wide_scan_adv UAT_WIDE_TABLE_COUNT=250 bash scripts/uat/seed-catalog-scan-fixtures.sh` → tables=**250** column_rows=**1500**；stock 种子幂等复跑 → `uat_wide_scan` tables=200 column_rows=1200 |
| UAT-SCAN-MYSQL-01 | PASS | `live-schemas?refresh=1&purpose=manual` → 200，`uat_wide_scan_adv` tableCount=**250**（≈500ms），与 MySQL `information_schema` 真值**逐个相等**；返回 5 个 schema：`dataforai(3)`／`e2e_conn_reload(1)`／`repro_tmp(1)`／`uat_wide_scan(200)`／`uat_wide_scan_adv(250)` |
| UAT-SCAN-MYSQL-02 | PASS | 新连接 id `uat-scan-adv-mweibqk8`（`executionRuntimeAck=true`）；namesOnly 清单 `tableCount=250` `namesOnly=true`（≈480ms）；单表 `uat_t0001`／`uat_t0250` 均 `columnCount=6` `namesOnly=false`（≈466／485ms）；测后 ktx **0** 残留，`demo-db:3306` MySQL 连接数回到 1 |
| UAT-SCAN-SIM | PASS | `npx vitest run` 4 files／**34 tests** passed（catalog-show／doris-external-catalog.simulation／schema-structure／live-tables-wide-schema） |
| UAT-SCAN-EXT-01 | **BLOCKED** | demo 无 `catalog.database` 形态连接（见下「BLOCKED 项」） |
| UAT-SCAN-EXT-02 | **BLOCKED** | 同上 |

## 对抗加码（相对 Cursor 跑次新造，均全真执行）

| # | 对抗动作 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| S1 | **换宽度**：另建 `uat_wide_scan_adv`（250 表）而非复用 200 表库 | API 回的是**实时表数**而非常量 | API `tableCount=250` ≡ MySQL 真值 250；namesOnly 同样 250 | PASS |
| S2 | **换连接 id**：`uat-scan-adv-*`／`uat-scan-adv-ctl-*` | 新 id 全程可用 | create `executionRuntimeAck=true`；两次 create／remove 均 200 | PASS |
| S3 | **换增量区间表**：单表取**宽表清单最后一张** `uat_t0250`（200 表库里根本没有这张表） | 增量区表可取字段 | `columnCount=6` ≡ MySQL 真值 6；耗时 485ms **不慢于** 首表 `uat_t0001`（466ms） | PASS |
| S4 | **SQL 层证伪「每表一条 columns」**（Cursor 跑次未做）：开 `performance_schema.events_statements_history_long`，按请求窗口数 MySQL **实际收到**的语句 | 宽 Schema 只 1 次 `information_schema.columns` | ①namesOnly(250 表)：`columns` 调用 **0** 次、`information_schema.tables` **1** 次；②单表 `uat_t0001`：`columns` 调用 **恰好 1** 次；③单表 `uat_t0250`（末尾）：**同样 1** 次；④对照 200 表库单表：**同样 1** 次 → **调用数不随宽度增长**。该列 SQL 全文为 `... FROM information_schema.columns c JOIN information_schema.tables t ... WHERE c.table_schema = 'uat_wide_scan_adv' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name, c.ordinal_position) ... limit 10000` → **无按表名谓词**，是 Schema 宽一次读、进程内再过滤；`limit 10000` 即 SC-07 行数上限 | PASS |
| S5 | **多表请求边界**：一次请求多张表 | 记录真实契约 | 400 `BAD_REQUEST`「一次只读取一张表的字段。」→ API 层**主动拦住**逐表 columns 的客户端契约 | PASS（观察，见下） |
| S6 | **错误不泄密**：不存在的 schema | 错误体无口令明文 | 响应无明文口令（`negative-no-plaintext-password` PASS） | PASS |
| S7 | **无 restart／无残留** | 容器身份不变；ktx 无残留 | `StartedAt` 全程不变、`RestartCount=0`；`ktx.yaml` 中 `uat-scan-adv-` 出现 **0** 次 | PASS |

## BLOCKED 项（须委托人独立授权才能降级）

- **UAT-SCAN-EXT-01／EXT-02（外部目录 live）= BLOCKED。**
  demo 四条连接的 `database` 实测为 `dataforai`／`invest`／`dataforai`／`/data/lucy/.ktx-ui/audit.sqlite` —— **无任何 `catalog.database` 形态（点号目录）连接**，容器内也没有可达的 SelectDB／Hive 现场。
  - **UAT-SCAN-SIM 的 vitest 是「外部目录合同**替身**」，不是外部目录 live。** 本跑次**未**、也**不得**把 vitest 34/34 写成 EXT live PASS。
  - 要真正关闭 EXT，需要二者之一：**(a)** 委托人提供／授权一个容器内可达的真实外部目录连接（凭据**仅**给路径）+ 连接 id；**(b)** 委托人**独立书面授权**，明确接受「以 vitest 替身／书面 GAP」作为 EXT 结论。
  - 未获上述任一授权，本套件对外只能主张 **PASS WITH GAP**，且 GAP 名称为「外部目录 live 未验证」。

## 备注

- 是否使用 `docker restart`：**否**（容器 `StartedAt` 不变、`RestartCount=0`）。
- 清理是否完成：**是**。临时连接全部删除；`ktx.yaml` 无 `uat-scan-adv-` 残留；`demo-db:3306` 上 MySQL 连接数回到 1。
- **观察（非 FAIL，不在 SC-01–SC-14 合同内）**：对**不存在**的 schema 调 `schema-structure` 返回 `ok:true`／`readable:true`／`tableCount:0`／`yaml:"tables: {}"`，没有「schema 不存在」的显式信号（`readable` 语义是「读取无异常」，MySQL 对不存在 schema 返回 0 行且不报错）。UI 的「已有连接看不到该 Schema」另走 live-schemas 通道（实测 absent schema 不出现在 live-schemas 列表里）。**需产品/规格裁定**，本跑次不主张其为缺陷。
- **本跑次自身脚本缺陷（先排除自身、再判定产品）**：首轮曾以「一次请求 20 张表」为对抗动作并记 FAIL；查实 API 合同是「一次只读取一张表」（S5），该探针本身超出合同，已改为**合法**的「首表 vs 末表 + SQL 调用计数」对抗（S3／S4）。
- 原始日志（gitignored `inbox/uat-claude-adv-2026-11-13/`）：`adv-scan.log`、`scan-stock-wide-api.log`、`scan-sim-vitest.log`、`probe-scan.log`、`probe-sqlcount.log`
