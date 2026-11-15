# Run — 2026-11-15 — claude-large-schema-baseline

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-LARGE-SCHEMA` |
| Agent | Claude |
| 环境 | 本机 demo `http://127.0.0.1:55176`；容器 `compose-lucy-1` healthy；`lucyVersion=0.30.0`；`gitSha=d64414d68a19bd2ade981c74a2c8b23e56a5893b`；`gitDirty=false`（来自未登录的 `/api/health`）；仓库 `git rev-parse HEAD`＝同值 |
| 夹具 | `seed-large-schema-fixtures.sh` 从零造出并通过自检：MySQL `uat_scale_mysql` 1201 张表；Hive `uat_scale_hive` 605 张表（含 5 张宽表）；Doris `hive_scale` 目录看到 605 张。Doris 用本机实验环境 `doris-lab-2014-fe-1`（2.0.14），不是仓库内 2.1.7 的 compose |
| 开始／结束 | 2026-11-15 ≈23:30–23:35 CST |
| 总判定 | **FAIL**（UAT-SCALE-09 **FAIL**；R0 与其余 HTTP 用例 **BLOCKED**——登录 401，本机 demo 管理员口令未取得） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SCALE-09 | **FAIL** | 10 秒内只合并 144/600 张表（预算总计 5 秒、600/600），单步最慢 146 毫秒。证据 `inbox/uat-large-schema-2026-11-15/result.json`。真实 `mergeManifestTables`，不依赖登录与夹具 |
| UAT-SCALE-R0 | **BLOCKED** | `POST /api/auth/login` 返回 401。`lucy-docker-login.txt` 里的地址是另一个 IP 的实例，口令很可能不属于本机 demo。登录有失败次数限制，4 次运行各试 1 次（含改解析方式和改管理员 id）后停止，没有继续猜 |
| UAT-SCALE-01…08、10 | **BLOCKED** | 依赖 R0 |
| UAT-SCALE-11、12 | **NOT RUN** | 可选，未执行 |

## 诊断证据（不是 UAT 判定）

下表来自 2026-11-15 的本机诊断（进程内直接调用服务端模块，真实 KTX、真实 MySQL／Doris／Hive，库名不同于本套件夹具、规模相同）。**诊断不得写成 UAT 结果**：它没有经过 HTTP 层与登录，且夹具已拆除。登录问题解决后须重跑本套件取代它。详见 [`inbox/hive-lab/REPORT.md`](../../../../../../inbox/hive-lab/REPORT.md)。

| 对应用例 | 诊断值 | 若按本套件预算判 |
|---|---|---|
| SCALE-01 | MySQL 1201 张表 0.47 秒 | 会 PASS |
| SCALE-02 | 单表 10 列 0.92 秒；1000 列 0.95 秒 | 会 PASS |
| SCALE-03 | 结构差异风格逐表读 10 张 9.5 秒；30 张 28.4 秒（20 张约 19 秒） | 会 FAIL（预算 5 秒） |
| SCALE-04 | MySQL 逐表约 0.93 秒/张，600 张约 9 分钟 | 会 FAIL（预算 60 秒） |
| SCALE-05／06 | 外部目录 604 张表 18 毫秒；逐表读 600 张 2.7 秒（本机无网络延迟） | 会 PASS |
| SCALE-07 | 1500、1999 列通过；**2000、3000 列整张表被拒绝（`too_large`）** | 会 FAIL |
| SCALE-09 | 100 张 4.8 秒，200 张 19.6 秒（二次方） | 本次真跑已 FAIL |

## 备注

- 是否使用 `docker restart`：**否**
- 清理：runner 创建连接前就在登录处停止，没有创建任何 `uat-scale-*` 连接；未改 `admins.yaml`，未绕过认证
- 登录问题的两条出路都需要委托人：提供本机 demo 管理员口令的文件路径，或对「进程内诊断驱动」单独授权降级。后者按 [CONVENTIONS](../../../CONVENTIONS.md) 第一性原则第 3 条，未获授权不得主张已验证
- 本次顺带验证了夹具脚本：从零造库、幂等再跑、网络接入、Doris 目录与授权均成功；脚本里修了三处（`pipefail`＋`grep -q`、容器内文件权限、标签式登录文件）
- **≠ 可上线**；**≠** 功能合同收口
