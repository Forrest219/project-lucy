# Run — 2026-11-19 — cursor-hive-jd-ext-rerun

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN`（P1-16 Gate ＋ **P1-20** lab live／EXT-03-DUAL／EXT-05） |
| Agent | Cursor |
| 环境 | WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`；容器 `compose-lucy-1`；Doris FE `doris-lab-2014-fe-1`（2.0.14）；catalog `hive`（无 Kerberos）＋`hive_jd`（Kerberos） |
| `git rev-parse HEAD`（工作区） | `3b1c62af32af7b6d045caef7fa10ccc92300ae97` |
| 工作区脏 | **是**（仅无关 `Dockerfile` 本地改动；本轮未改运行代码） |
| health `gitSha` | `3b1c62af32af7b6d045caef7fa10ccc92300ae97`（`gitDirty=true`） |
| `/app/BUILD_REVISION` | `3b1c62af32af7b6d045caef7fa10ccc92300ae97-dirty` |
| 等价源码自检 | `COLUMNS FROM` in 容器 `catalog-show.ts` = **1**；host／容器 md5 一致 |
| 登录 | demo 管理员 `xingchen`（口令不入库）；Doris lab `uat_lucy`（口令仅环境变量） |
| 开始／结束 | 2026-11-19 11:17–11:20 +0800 |
| P1-16 判定 | **PASS WITH GAP**（SEED／MYSQL／SIM／KTX 全绿） |
| P1-20 判定 | **替身有效 ＋ lab live PASS**（SIM＋KTX-GUARD；**EXT-03-DUAL PASS**；**EXT-05 PASS**）；**客户生产 SelectDB 仍 NOT VERIFIED** |
| 总判定（套件） | **PASS WITH GAP**（lab 双目录＋缺表 diff；≠ 客户生产；≠ 可上线） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| 跑前升级／自检 | PASS | 委托人已重建镜像；health／BUILD＝`3b1c62af`；Doris 网已 connect；两路 `DESC` 成功 |
| UAT-SCAN-SEED | PASS | tables=200 column_rows=1200（已存在跳过重建） |
| UAT-SCAN-SIM | PASS | vitest 5 files／**76/76** |
| UAT-SCAN-KTX-GUARD | PASS | `@kaelio/ktx 0.16.0`；18 行 OK；`RESULT: PASS` |
| UAT-SCAN-MYSQL-01／02 | PASS | wideTableCount=200；单表 columnCount=6；`executionRuntimeAck=true`。注：与并行清理竞态导致 remove 一次 404，功能四步已绿；残留随后已清 |
| UAT-SCAN-EXT-03-DUAL | **PASS** | `hive.dw`／`dw_sim_001_i_h`：tables=129、columnCount=60、12ms；`hive_jd.app`／`app_ad_sim_001_stat_i_d`：tables=177、columnCount=120、17ms；cleanup ok |
| UAT-SCAN-EXT-05 | **PASS** | `T=app_ad_sim_001_stat_i_d` → `status=ok`、120 列；`M=uat_missing_table_ext05` → `status=not_in_library`；HTTP 200。日志 stderr：`errCode = 2, detailMessage = Unknown table 'uat_missing_table_ext05'`（单次 DESC 探针即归类） |
| UAT-SCAN-EXT-04 | SKIPPED | lab 无中文表 |
| UAT-SCAN-MYSQL-VER／CASE／DIFF | 本轮不做 | 既有 PASS 维持 |

## 备注

- 是否使用 `docker restart`：**否**
- **lab ≠ 客户生产** SelectDB
- 口令未写入本跑次
- 对照上一轮 [2026-11-18-cursor-hive-jd-ext-dual](2026-11-18-cursor-hive-jd-ext-dual.md)：本轮在新镜像 `3b1c62af` 上复绿，并关闭 EXT-05 缺口
