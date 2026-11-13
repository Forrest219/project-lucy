# Fixtures — UAT-SUITE-CATALOG-SCAN

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Lucy 容器 | `compose-lucy-1` |
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

## 自动化入口

```bash
# 本地宽表种子（可反复执行，幂等）
bash scripts/uat/seed-catalog-scan-fixtures.sh

# MySQL 小版本矩阵（5.7 / 8.0 / 8.4）全真
bash scripts/uat/run-mysql-version-matrix.sh

# 外部目录合同替身（无 SelectDB 时必做；≠ EXT live）
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts
```

## 可选外部目录 live

仅当存在可从容器访问、且 `database` 形如 `catalog.database` 的连接时填写下表：

| 键 | 值 |
|---|---|
| connectionId | （填） |
| database | 例 `hive.dw` |
| 凭据存放 | 路径 only |
