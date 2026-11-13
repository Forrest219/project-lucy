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
