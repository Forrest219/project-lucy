# Fixtures — UAT-SUITE-CATALOG-SCAN

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Lucy 容器 | `compose-lucy-1`（脚本可用 `UAT_LUCY_CONTAINER` 覆盖） |
| demo-db（矩阵 8.4） | `demo-db` / `53306`→`3306`；镜像 `mysql:8.4` |
| 矩阵 8.0 | 服务 `uat-mysql80`；镜像 `mysql:8.0.40`；host 端口 `53380` |
| 矩阵 5.7 | 服务 `uat-mysql57`；镜像 `mysql:5.7.44`（`platform: linux/amd64`）；host 端口 `53357` |
| Compose 叠加 | `deploy/compose/docker-compose.uat-mysql-matrix.yml`（与 demo compose 合并） |
| 种子库 | `uat_wide_scan` |
| 种子规模（默认／矩阵） | 默认 200；矩阵脚本默认 **80**（可用 `UAT_WIDE_TABLE_COUNT`） |
| 种子脚本 | `bash scripts/uat/seed-catalog-scan-fixtures.sh` |
| 版本矩阵一键 | `bash scripts/uat/run-mysql-version-matrix.sh`（5.7＋8.0＋8.4 全真） |
| 已有普通连接 | `demo-mysql`（`database=dataforai`，表少，冒烟用） |
| 宽表验证连接 | 临时 `uat-scan-wide-<ts>` → 各矩阵 host／`uat_wide_scan`，测后删除 |
| 登录凭据 | 同 CONN-RELOAD fixtures（Desktop 或 config-for-agents 路径） |
| 矩阵下限 | **自 MySQL 5.7 起**（授权 2026-11-13）；不含 5.6 及更早，除非另授权 |
| 构建标识 | 不在此写提交号；每个跑次记 `git rev-parse HEAD`＋是否脏＋容器 `/app/BUILD_REVISION`（见 cases「跑前统一前置」） |

## 自动化入口

```bash
# 本地宽表种子（可反复执行，幂等）
bash scripts/uat/seed-catalog-scan-fixtures.sh

# MySQL 小版本矩阵（5.7 / 8.0 / 8.4）全真
bash scripts/uat/run-mysql-version-matrix.sh

# 真实 KTX 只读校验（UAT-SCAN-KTX-GUARD；容器内；退出码 0 PASS／1 FAIL／2 BLOCKED）
bash scripts/uat/verify-ktx-readonly-guard.sh

# 外部目录合同替身（UAT-SCAN-SIM；含 P1-20 EC；≠ EXT live）
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts \
  server/__tests__/live-catalog.test.ts
```

## 可选外部目录 live

仅当存在可从容器访问、且 `database` 形如 `catalog.database` 的连接时填写下表（EXT-01…05 共用）：

| 键 | 值 |
|---|---|
| connectionId | （填） |
| database | 例 `hive.dw` 或 `hive-1` 现场等价 |
| schemaForList | 例 `dim`／`dw`／`app` |
| tableForColumns | 例 `dim_bidding_block_ad_id_2025`（EXT-03） |
| chineseTableForColumns | 例中文表名；无则 EXT-04 SKIPPED |
| missingTableForDiff | 故意不存在的表名（EXT-05；同时用来取证 SelectDB 缺表报错原文） |
| 凭据存放 | 路径 only（禁写口令内容） |

## 本机 Doris／Hive 双目录 lab（EXT-03-DUAL）

用于构造客户「`hive` 能对照、`hive_jd` 读字段失败」同形差集；**≠ 客户生产 SelectDB**。口令为空时勿在 fixtures 写死明文；脚本用环境变量或空串。

| 键 | 值 |
|---|---|
| Doris FE 容器 | `doris-lab-2014-fe-1`（SelectDB／Doris **2.0.14**） |
| FE MySQL（宿主机） | `127.0.0.1:19030` |
| FE MySQL（Lucy 容器） | host=`doris-lab-2014-fe-1` port=`9030`（须 `docker network connect doris-lab-2014_doris_lab compose-lucy-1`） |
| 无 Kerberos 目录 | catalog=`hive`；连接 `database=hive.dw`；表例 `dw_sim_001_i_h`（或 `hive.dim`／`dim_sim_001_stat_i_d`） |
| Kerberos 目录 | catalog=`hive_jd`；连接 `database=hive_jd.app`；表例 `app_ad_sim_001_stat_i_d`（约 177 张模拟表） |
| HMS／KDC | `lucy-krb-hms`、`kdc-lab`（与既有 inbox 交叉验证环境同栈） |
| 对照旧镜像（可选） | 容器 `lucy-old3a9`＝客户回退基线 `3a9f0711`（只读对照，不改其配置） |
| WebUI 登录文件 | 路径 only：`/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt`（格式：第 2 行 adminId、第 3 行口令；禁写入口令） |
| Doris 连接用户 | lab 临时用户 `uat_lucy`（口令仅经环境变量 `UAT_DORIS_PASSWORD` 注入脚本；**禁写入本 fixtures／跑次正文**）。Lucy API 要求非空 password，不可用空口令 root |
| 自动化 | `UAT_DORIS_USER=uat_lucy UAT_DORIS_PASSWORD=… node scripts/uat/run-catalog-scan-ext-dual.mjs` |

跑前自检（Doris 侧，绕开 Lucy）：

```bash
docker exec doris-lab-2014-fe-1 mysql -h127.0.0.1 -P9030 -uroot -e \
  "DESC \`hive\`.\`dw\`.\`dw_sim_001_i_h\`; DESC \`hive_jd\`.\`app\`.\`app_ad_sim_001_stat_i_d\`;"
```

两路 `DESC` 成功后再跑 Lucy EXT；若 Doris 侧已失败，本条记 `BLOCKED`（下游），不要判 Lucy FAIL。
