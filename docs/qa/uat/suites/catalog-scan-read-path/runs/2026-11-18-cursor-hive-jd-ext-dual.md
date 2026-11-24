# Run — 2026-11-18 — cursor-hive-jd-ext-dual

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN`（P1-16 Gate 复跑 ＋ **P1-20** lab live／EXT-03-DUAL） |
| Agent | Cursor |
| 环境 | WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`；容器 `compose-lucy-1`；Doris FE `doris-lab-2014-fe-1`（2.0.14，宿主机 `19030`）；无 Kerberos catalog `hive`；Kerberos catalog `hive_jd`（`lucy-krb-hms`＋`kdc-lab`） |
| `git rev-parse HEAD`（工作区） | `0620036b0f51990ebc03a2cfa3c8666c19506887` |
| 工作区脏 | **是**（含本套件 cases／fixtures／suite 与 `scripts/uat/run-catalog-scan-ext-dual.mjs`；P1-20 修复代码已在容器祖先，本轮**未改**运行代码） |
| health `gitSha` | `af473997d831da90670b7507522cd40d3567f0e1`（`gitDirty=true`） |
| `/app/BUILD_REVISION` | `af473997d831da90670b7507522cd40d3567f0e1-dirty` |
| 等价源码自检 | `COLUMNS FROM` in 容器 `catalog-show.ts` = **1**；host／容器 md5 一致 |
| 登录 | 本机 demo 管理员 `xingchen`（口令不入库）；Doris lab 用户 `uat_lucy`（口令仅环境变量） |
| 开始／结束 | 2026-11-18 23:13–23:18 +0800 |
| P1-16 判定 | **PASS WITH GAP**（SEED／MYSQL／SIM／KTX 本轮复绿；EXT-01／02 未单独记，并由 DUAL 覆盖双目录列表） |
| P1-20 判定 | **替身有效 ＋ lab live PASS**（SIM 76/76＋KTX-GUARD PASS；**EXT-03-DUAL PASS**）；**客户生产 SelectDB live 仍 NOT VERIFIED** |
| 总判定（套件） | **PASS WITH GAP**（lab 关闭双目录缺口；≠ 客户生产；≠ 可上线） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| 跑前升级／自检 | PASS | 容器已重建且 healthy；`COLUMNS FROM`=1；Lucy 已 `docker network connect doris-lab-2014_doris_lab`；Doris 侧两路 `DESC` 成功 |
| UAT-SCAN-SEED | PASS | `seed-catalog-scan-fixtures.sh` → tables=200 column_rows=1200（已存在跳过重建） |
| UAT-SCAN-SIM | PASS | vitest 5 files／**76/76**；EC 抽查含 Chinese names、`hive-1 dim.dim_bidding_block_ad_id_2025`、SHOW COLUMNS 回退、三探针失败 |
| UAT-SCAN-KTX-GUARD | PASS | `verify-ktx-readonly-guard.sh` 退出 0；`ktx: @kaelio/ktx 0.16.0`；18 行 OK；末行 `RESULT: PASS` |
| UAT-SCAN-MYSQL-01／02 | PASS | `run-catalog-scan-wide-api.mjs` verdict PASS：`executionRuntimeAck=true`；wideTableCount=200；单表 `uat_t0001` columnCount=6；测后 remove ok |
| UAT-SCAN-EXT-03-DUAL | **PASS** | `run-catalog-scan-ext-dual.mjs`：`hive.dw`／`dw_sim_001_i_h` → tables=129、columnCount=60、9–12ms；`hive_jd.app`／`app_ad_sim_001_stat_i_d` → tables=177、columnCount=120、10–11ms；两路 `namesOnly=false`；测后 `ktx.yaml` 无 `uat-ext-hive` 残留 |
| UAT-SCAN-EXT-03（单路） | 被 DUAL 覆盖 | 同构证据见上；事故表名 `dim_bidding_block_ad_id_2025` 在 lab 未种子，用 `dim_sim_*`／`dw_sim_*`／`app_ad_sim_*` 等价 |
| UAT-SCAN-EXT-04 | SKIPPED | lab 无中文表 |
| UAT-SCAN-EXT-05 | NOT RUN | 本轮聚焦客户读字段症状；缺表 diff 取证未做 |
| UAT-SCAN-MYSQL-VER／CASE／DIFF | 本轮不做 | 既有 PASS 维持 |

## 备注

- 是否使用 `docker restart`：**否**
- 清理：临时宽表连接与双目录连接均 `dryRun=false` 删除；脚本已修正 remove 默认 dryRun 陷阱
- **lab ≠ 客户生产**：本机 Kerberos 模拟 `hive_jd`，不是客户 `m-4-21`／`MOJI.COM` SelectDB
- 客户回退基线 `3a9f0711` 对照仍见错题／inbox 交叉验证（本轮未再打旧容器）
- demo-mysql **不能**冒充外部目录 live
- 口令未写入本跑次

## 对出镜像评估的输入（本跑次能证明／不能证明）

| 能证明 | 不能证明 |
|---|---|
| 当前 demo 镜像含 P1-20 直连读字段；KTX 仍拒绝 `DESC` | 客户生产 FE／Kerberos／ACL 下仍成功 |
| 无 Kerberos `hive` 与 Kerberos `hive_jd` **同构**可读字段 | 「0.30 核心升级完成」或整包可上线 |
| 客户截图同形路径（能列表 → 准备表结构读字段）在 lab 已绿 | 回退前 `abb38913` 上「仅 hive_jd 失败」专属根因 |