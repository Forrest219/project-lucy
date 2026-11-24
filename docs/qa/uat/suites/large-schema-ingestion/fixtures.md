# Fixtures — UAT-SUITE-LARGE-SCHEMA

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176`（`LUCY_UAT_WEBUI_URL` 覆盖） |
| Lucy 容器 | `compose-lucy-1`（`UAT_LUCY_CONTAINER` 覆盖） |
| 普通 MySQL | demo compose 的 `demo-db`（MySQL 8.4）；库 `uat_scale_mysql` |
| MySQL 下限 | 1200 张表 × 10 列 ＋ 1 张 1000 列的表（`w_1000`）；表名 `t_00001…t_01200` |
| MySQL XL（可选） | 库 `uat_scale_mysql_xl`：12000 张表 × 3 列（`UAT_SCALE_XL=1`） |
| 外部目录 | Doris FE（默认容器 `lucy-uat-doris-fe`，`UAT_DORIS_FE_CONTAINER` 覆盖；MySQL 口 `19030`）上的 catalog `hive_scale`，指向本机 Hive Metastore |
| Hive | `deploy/compose/docker-compose.uat-hive-local.yml`：`apache/hive:4.0.0`，HMS＋HiveServer2，Derby，只有元数据没有数据文件 |
| Hive 库 | `uat_scale_hive`：600 张表 × 30 列（`t_0001…t_0600`）＋ 宽表 `w_1500／w_1999／w_2000／w_3000／w_5000` |
| 网络 | 固定名 `lucy-uat-hive`，**名字里不得有下划线**（Hive 会用「容器名.网络名」造主机名，下划线触发 `URISyntaxException`）。seed 脚本负责把 Doris FE 与 Lucy 容器接入 |
| 连接数据库名 | 外部目录连接的 `database` 写成 `hive_scale.uat_scale_hive`（`catalog.database`） |
| 登录凭据 | 文件路径 `LUCY_E2E_WEBUI_LOGIN_FILE`（默认 `config_for_agents/lucy-docker-login.txt`）。文件可以是「标签：值」或按行位置两种格式；管理员 id 与文件里的「姓名」不一致时用 `LUCY_E2E_WEBUI_ADMIN_ID` 指定。**禁写口令内容** |
| 构建标识 | 不在此写提交号；每个跑次记 `git rev-parse HEAD`＋是否脏＋`/api/health` 的 `gitSha`／`gitDirty` |
| 夹具口令 | 夹具库账号是一次性实验口令，写在 seed 脚本默认值里，仅限本机；不得复用到任何真实环境 |

## 自动化入口

```bash
# 造数据（幂等；MySQL 约 6 秒，Hive 首次约 3 分钟）
bash scripts/uat/seed-large-schema-fixtures.sh all
# 可选 XL：UAT_SCALE_XL=1 bash scripts/uat/seed-large-schema-fixtures.sh mysql

# 跑套件（必做 R0 与 01…10）
cd webui && LUCY_E2E_WEBUI_ADMIN_ID=<管理员 id> \
  npx tsx ../scripts/uat/run-large-schema-ingestion.mts --out ../inbox/uat-large-schema-$(date +%F)
# 退出码：0 全部 PASS；1 有 FAIL；2 有 BLOCKED
```

使用自己的 Doris 实验环境时，设置 `UAT_DORIS_FE_CONTAINER`、`DORIS_MYSQL_PORT`，让 seed 与 runner 指向同一台。

## 清理

- 夹具库可保留用于复跑。要彻底清掉：`DROP DATABASE uat_scale_mysql`；`docker compose -f deploy/compose/docker-compose.uat-hive-local.yml down`；Doris 侧 `DROP CATALOG hive_scale`、`DROP USER uat_scale_ro`；`docker network disconnect lucy-uat-hive <容器>`。
- runner 自己创建的两条临时连接在 `finally` 里删除；异常退出后检查连接列表里是否残留 `uat-scale-*`。
