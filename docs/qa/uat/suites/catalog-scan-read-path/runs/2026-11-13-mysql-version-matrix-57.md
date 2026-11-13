# Run — 2026-11-13 — mysql-version-matrix（5.7 补跑）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN`／`UAT-SCAN-MYSQL-VER` |
| Agent | Cursor |
| 环境 | `compose-lucy-1` healthy；WebUI `http://127.0.0.1:55176`；容器 `gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`（含 `026db5a3` 合并）。工作区 tip `e2ca2ca7` 另有 `aa559a1c`（schema-wide／per-table 分读），**本跑次镜像未包含该提交** |
| 开始／结束 | 2026-11-13 15:19–15:24（15:24 将 5.7 宽库从 80 补到 200 并复跑 API） |
| 总判定 | **PASS**（5.7／8.0／8.4 三档 API 全真绿）。套件级仍 **PASS WITH GAP**：外部目录 live 按委托人当次选择保持未跑 |

| Case / 档 | 版本（实测） | 结果 | 证据摘要 |
|---|---|---|---|
| mysql-8.4-demo | **8.4.13**（`demo-db`） | PASS | 已有宽表 200（目标 80，跳过重种）；live-schemas `wideTableCount=200` 512ms；namesOnly `tableCount=200`；单表 `columnCount=6`；`executionRuntimeAck=true`；测后 remove |
| mysql-8.0 | **8.0.46**（`uat-mysql80`） | PASS | 已有 80 表；live-schemas 80／484ms；namesOnly 80；单表 columns=6；ack=true；remove |
| mysql-5.7 | **5.7.44**（`mysql:5.7` amd64，`uat-mysql57`） | PASS | 矩阵档先种 80 表并通过。随后按套件默认宽库补到 **200 表／1200 column rows**：live-schemas `wideTableCount=200`／688ms；namesOnly `tableCount=200`／879ms；单表 `uat_t0001` `columnCount=6`／988ms；`executionRuntimeAck=true`；remove 200。连接 id `uat-scan-wide-mwenjck8` |

相对上一跑次 [2026-11-13-mysql-version-matrix](2026-11-13-mysql-version-matrix.md)：5.7 由 **BLOCKED**（镜像拉取）改为 **PASS**。`docker pull --platform linux/amd64 mysql:5.7` 成功后执行 `bash scripts/uat/run-mysql-version-matrix.sh`，脚本打印 `MATRIX PASS (5.7 / 8.0 / 8.4)`。

日志：`inbox/uat-mysql-matrix-20261113-151937.jsonl`。5.7 宽库补齐命令：`UAT_DEMO_DB_SERVICE=uat-mysql57 UAT_WIDE_TABLE_COUNT=200` 种子后，`UAT_DB_HOST=uat-mysql57 UAT_WIDE_TABLE_COUNT=200 node scripts/uat/run-catalog-scan-wide-api.mjs`，verdict **PASS**。测后 `ktx.yaml` 无 `uat-scan-wide-` 残留；`uat-mysql57` 上 `uat_wide_scan` 仍为 200 表。

未改外部目录 live。UAT-SCAN-EXT-01／02 仍 **BLOCKED**。
