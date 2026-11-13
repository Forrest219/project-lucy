# 库内扫表读法 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.3** |
| 日期 / 目标版本 | 2026-11-11／不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P1**（客户现场库内表清单与准备表结构）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **功能合同已收口（2026-11-13）**（SC-01–SC-14 证据关闭）。**不入 0.30 产品分母**（事故修复；功能编号无）。本条收口不表示可上线 |
| 决策来源 | 2026-11-11 现场：`hive-1` / `hive-jd` 的 `information_schema` 在 SelectDB 外部目录上不存在；`SHOW` 已在同一台 SelectDB 返回库名和表名；`ktx sql` 不能发送 `SHOW`。`marketingapi` 表清单已返回，准备表结构因逐表查字段超时 |
| 需求来源 | 客户现场升级到 `9c78b0e3` 之后，库内表清单与准备表结构仍失败 |
| 实施主体 | WebUI 服务端：`live-catalog`、`live-tables`、`schema-structure`。外部目录的列库、列表新增一条不经过 `ktx sql` 的 MySQL 读法 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 修正当前外部目录扫表对 `catalog.information_schema` 的假设。不改问数、不改 KTX、不改普通 MySQL 的库内表清单语句 |
| 实施计划 | [`docs/plans/lucy-20261111-catalog-scan-read-path-plan.md`](../plans/lucy-20261111-catalog-scan-read-path-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿。外部目录列库、列表改走直连 `SHOW`。普通 MySQL 准备表结构改为一次读取 `information_schema.columns` |
| v0.2 | 补齐三处合同：每库表数来自直连 `SHOW TABLES` 的行数；生产适配器从连接配置解析 `file:` 密钥并由驱动替身验证；连接与语句 30 秒超时，成功和失败都关闭连接。同日按该合同改服务端读法，本机单测通过，尚未出客户镜像 |
| v0.3 | SC-06／07：普通 MySQL 准备表结构恢复 Schema 宽一条 `information_schema.columns`，达 10000 行 fail-closed、不退回逐表。SC-14：超时与现有 `ktx sql` 默认 `timeoutMs`／`CATALOG_SCAN_TIMEOUT_MS` 对齐为 **120 秒**（修正 v0.2 误写的 30 秒）。功能合同收口；本条收口不表示可上线 |

## 闭口层级

- 层级：功能合同
- 本条承诺：外部目录连接的库内表清单能列出该目录里已经验证存在的库和表，且每个库的张数等于该库 `SHOW TABLES` 的行数；普通 MySQL 连接的准备表结构用一次字段查询返回列，不再按表逐次查询。
- 本条出口：SC-01–SC-14。验收用注入的 SQL 执行器与驱动替身，复现现场已观察到的成功语句和失败语句，并覆盖生产适配器的连接参数、超时和关闭。
- 不在本条出口：问数链路、客户环境再升级、浏览器测试、移动窄屏、Hive Metastore Kerberos、HDFS 缺块、外部目录全库逐表 `DESC` 是否在网关超时前结束。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

本条不新增页面文案。既有「库内表清单」「准备表结构」「读取表结构失败」保持原词。不把 Schema 写成架构、模式或清单。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 不新增页面、按钮、颜色或间距
- [ ] 库内表清单与准备表结构沿用现有呈现；本条只改变服务端读法
- [ ] 不新增用户可见错误文案
- [ ] 专业标识符沿用现有 `translate="no"` 节点，本条不新增 DOM

### Exceptions (If Any)

- None

### Follow-up Needed

- 外部目录准备表结构若在逐表 `DESC` 时超过网关时间，另开一条，不把 `information_schema` 加回外部目录。

## 1. 现场事实

2026-11-11，线上 Lucy `0.25.0`，`gitSha` `9c78b0e3`，KTX `0.16.0`。

| 连接 | database | 已观察到的结果 |
|---|---|---|
| hive-1 | `hive.dw` | `GET /api/connections/hive-1/live-schemas` 执行 `SELECT schema_name FROM \`hive\`.\`information_schema\`.\`schemata\``，SelectDB 返回 `Unknown database 'default_cluster:information_schema'`。`live-tables?schema=dim` 与 `schema=dw` 为 `SCHEMA_NOT_FOUND`、0 张表 |
| hive-jd | `hive_jd.app` | 同一失败，目录名为 `` `hive_jd` ``。`live-tables?schema=app` 为 `SCHEMA_NOT_FOUND`、0 张表 |
| marketingapi | `jipaas_poc` | `live-tables` 约 1.2 秒返回 148 张表。`POST /schema-structure` 25 秒内无响应体 |
| tblu | `tblu` | 库内目录报告 789 张表。`live-tables` 返回 789 张表。`POST /schema-structure` 20 秒内无响应体。这是升级前可以一次读完字段、升级后逐表查询走不完的库 |
| doris-main 等无点号库名 | 例如 `chatbi` | 问数已取数成功。本条不改这些连接的扫表语句 |

同一台 SelectDB 上已经执行成功的语句：

| 语句 | 结果 |
|---|---|
| `SHOW DATABASES FROM hive` | 21 个库，含 `dim`、`dw` |
| `SHOW TABLES FROM hive.dim` | 44 张表 |
| `SHOW TABLES FROM hive.dw` | 129 张表 |
| `SHOW TABLES FROM hive_jd.app` | 169 张表 |
| `DESC hive.dim.dim_app_pid_info` | 返回字段 |

`ktx sql` 在 KTX 0.16.0 中拒绝 `SHOW`，报错形态为 `SQL contains read/write operation: Show`。因此 `SHOW` 不得再交给 `ktx sql`。

普通 MySQL 的准备表结构在升级后改为先列出表名，再按表各发一条 `information_schema.columns`。`tblu.tblu` 有 789 张表，`marketingapi` 的 `hzero_platform` 有 324 张，`jipaas_poc` 有 148 张。表清单接口仍然成功。准备表结构的轮次变成表的张数，网关在字段返回前断开。一次读完字段的语句还在 `sqlFor` 中，MySQL 分支已经不再调用它。

## 2. 目标

1. 库名含且仅含一个点、形如 `catalog.database` 的 MySQL 协议连接，列库使用 `SHOW DATABASES FROM catalog`，每个库的张数使用 `SHOW TABLES FROM catalog.schema` 的行数，列表使用同一条 `SHOW TABLES`。
2. 这些 `SHOW` 由 Lucy 自己的 MySQL 协议发送，不调用 `ktx sql`。
3. 无点号库名的 MySQL 连接，库内表清单仍走现有 `information_schema.tables` 语句和 `ktx sql`。
4. 无点号库名的 MySQL 准备表结构，字段用一条 `information_schema.columns` 读完该 Schema，再加上至多一条表名查询。禁止再按表循环。
5. 外部目录上已知表名的字段读取仍用现有 `DESC`，并仍走 `ktx sql`。
6. 问数、Postgres、SQL Server、Oracle 的语句不变。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 修改 KTX 源码或放行 `ktx sql` 的 `SHOW` | KTX 保持 0.16.0 |
| 把 `SHOW` 重新交给 `ktx sql` | 现场约束，语句到不了数据库 |
| 用 `catalog.information_schema` 作为外部目录的成功路径 | 现场已证伪。带目录与不带目录都解析成 `default_cluster:information_schema` |
| 改普通 MySQL 的库内表清单 SQL | `marketingapi` 的 148 张表已经返回 |
| 改问数、语义层、MCP | 7 个连接问数已取数成功 |
| 承诺外部目录全部表的 `DESC` 在一次网关超时内结束 | 表清单是本条承诺。逐表 `DESC` 的耗时另计 |
| 客户镜像、Helm、浏览器测试、移动窄屏 | 不在本条出口 |
| 打印或落盘连接密码 | 现有密钥红线 |

## 4. 读法分支

只按连接的 `database` 是否匹配 `catalog.database` 分支。`chatbi`、`jipaas_poc` 不匹配。`hive.dw`、`hive_jd.app` 匹配，目录名分别是 `hive`、`hive_jd`。

| 动作 | 外部目录连接 | 普通 MySQL 连接 |
|---|---|---|
| 库内目录 | 直连 `SHOW DATABASES FROM catalog`；每个库再直连 `SHOW TABLES FROM catalog.schema`，`tableCount` 为该语句行数 | 现有 `ktx sql` + `information_schema.tables` 聚合 |
| 库内表清单 | 直连 `SHOW TABLES FROM catalog.schema` | 现有 `ktx sql` + `information_schema.tables` 左连接字段 |
| 准备表结构的表名 | 与库内表清单同一条 `SHOW` | 至多一条 `information_schema.tables` |
| 准备表结构的字段 | 既有 `DESC catalog.schema.table`，走 `ktx sql` | 一条 `information_schema.columns`，走 `ktx sql` |

外部目录的表清单不附带字段个数，保持当前「一次列名不得变成逐表扫字段」。这里的字段个数和库内目录的 `tableCount` 是两个数：前者保持 0，后者是该库的表张数。普通 MySQL 列清单的字段个数查询保持原样。

`listLiveSchemas` 的每一行仍是 `{ schema, tableCount }`。选择 Schema 时页面显示「库名（N 张表）」。

- 库名取 `SHOW DATABASES FROM catalog` 的首列，并继续滤掉系统库。
- `tableCount` 取同一条直连上 `SHOW TABLES FROM catalog.schema` 的行数。每个非系统库一条语句。
- 现有 `countExternalCatalogTables` 经由 `ktx sql` 查询 `information_schema` 的实现删除。表数不得再进入 `runSql`。
- 任一库的 `SHOW TABLES` 失败时，整次列库失败。不得把该库的 `tableCount` 写成 0 后当作成功。

直连参数不从 `ConnectionInfo` 读取。该类型只有 `passwordSource`，没有用户名，也没有 `file:` 路径。生产适配器读取该连接在 `ktx.yaml` 中的 `host`、`port`、`username`，以及 `password` 字段。`password` 必须是 `file:` 相对路径，字节由现有 `safeReadSecretPasswordBytesIfExists` 读取。缺文件、`inline`、`env` 在连接前失败，不打开连接。

握手不传 `database`。`hive.dw` 这类带点号的库名不得作为默认库。语句本身已经带目录和库名。

连接超时 120 秒，单条语句超时 120 秒，与现有 `ktx sql` 的默认 `timeoutMs`（`CATALOG_SCAN_TIMEOUT_MS = 120_000`）相同。成功、认证失败、查询异常、查询挂起超时，都关闭连接。超时后不得把连接留在后台。

密码字节只供这次握手使用。驱动异常若包含密码字节，交给现有失败分类之前必须去掉。错误、日志、审计和测试快照不得包含密码字节。

`information_schema`、`mysql`、`performance_schema`、`sys` 仍从库内目录结果中滤掉。这不改变外部目录的表清单。

字段行数达到现有上限 `10000` 时，准备表结构返回现有的超限失败。不得截断后当成成功，也不得退回逐表查询。

## 核心流程（伪代码）

```text
function listSchemas(conn):
  if conn is external catalog:
    rows = directMysql(conn, "SHOW DATABASES FROM " + quote(conn.catalog))
    schemas = filterSystemSchemas(firstColumn(rows))
    for schema in schemas:
      tableRows = directMysql(conn, "SHOW TABLES FROM " + quote(conn.catalog) + "." + quote(schema))
      schema.tableCount = rowCount(tableRows)
    return schemas
  return ktxSql(existingSchemaAggregateSql(conn))

function listTables(conn, schema):
  if conn is external catalog:
    rows = directMysql(conn, "SHOW TABLES FROM " + quote(conn.catalog) + "." + quote(schema))
    return namesOnly(firstColumn(rows))
  return ktxSql(existingMysqlOrPostgresTableListSql(conn, schema))

function readStructure(conn, schema):
  if conn is external catalog:
    names = listTables(conn, schema)
    for table in names:
      columns[table] = ktxSql("DESC " + quote(conn.catalog) + "." + quote(schema) + "." + quote(table))
    return columns
  if conn is mysql:
    names = ktxSql(tableNamesSql(schema))          # 至多这一条表名查询
    columns = ktxSql(allColumnsSql(schema))        # 一条，禁止按 table 循环
    if rowCount(columns) >= 10000:
      fail too_large
    return columns
  return existingProtocolSql(conn, schema)

function directMysql(conn, sql):
  assert sql starts with SHOW
  params = readDirectParams(conn)
  connect(params) without default database
  timeout connect 120s and this statement 120s
  close the connection on success, auth failure, query error, and timeout
  never pass sql to ktx sql
  on failure return the driver error with password bytes removed
  never fall back to information_schema

function readDirectParams(conn):
  read host, port, username, password from that connection in ktx.yaml
  password must be file:<relative path>
  bytes = safeReadSecretPasswordBytesIfExists(projectRoot, relative path)
  if the file is missing, or password is inline or env:
    fail before connect
```

失败顺序：

1. 外部目录直连失败时，库内目录整次失败，库内表清单沿用现有 `classifyLiveTableFailure`。不得改走 `information_schema`，也不得把失败的库写成 0 张表。
2. 普通 MySQL 字段查询失败时，返回现有读取失败。不得按表重试。
3. `ktx sql` 收到 `SHOW` 视为本条缺陷，测试必须失败。

## 5. 验收

| ID | 承诺 | 证据等级 |
|---|---|---|
| SC-01 | 外部目录列库的语句是 `SHOW DATABASES FROM catalog`，执行器不是 `ktx sql` | 本机单测 |
| SC-02 | 外部目录列表的语句是 `SHOW TABLES FROM catalog.schema`，表名来自首列，字段个数为 0，执行器不是 `ktx sql` | 本机单测 |
| SC-03 | 替身把带目录的 `information_schema` 返回为 `Unknown database 'default_cluster:information_schema'`。测试不得把该语句写成成功 | 本机单测 |
| SC-04 | `ktx sql` 的调用参数里不出现 `SHOW` | 本机单测 |
| SC-05 | 无点号 MySQL 的库内表清单 SQL 与改前一致，仍走 `ktx sql` | 本机单测 |
| SC-06 | 无点号 MySQL 的准备表结构对 `information_schema.columns` 只调用一次，表名查询至多一次 | 本机单测 |
| SC-07 | 字段行数达到 `10000` 时失败为超限，不截断，不退回逐表查询 | 本机单测 |
| SC-08 | 直连握手不使用带点号的 `database` 作为默认库 | 本机单测 |
| SC-09 | 错误文本、日志夹具和 SQL 结果对象不含密码 | 本机单测 |
| SC-10 | 外部目录已知表的字段语句仍是 `DESC`，并走 `ktx sql` | 本机单测 |
| SC-11 | `chatbi` 这类无点号库名不进入 `SHOW` 分支 | 本机单测 |
| SC-12 | 外部目录 `listLiveSchemas` 的 `schema` 为 `SHOW DATABASES` 首列，`tableCount` 等于该库 `SHOW TABLES` 行数。替身至少返回 `hive.dim=44`、`hive.dw=129`、`hive_jd.app=169`。失败的计数不会变成 0。`runSql` 中没有这些 `SHOW`，也没有 `information_schema` 计数语句 | 本机单测 |
| SC-13 | 生产适配器在驱动工厂被替换时，从 `ktx.yaml` 解析 `host`、`port`、`username` 和 `file:` 路径并读出夹具密码。握手参数不含 `database`。`inline` 与 `env` 不调用驱动。驱动异常含密码时，返回文本不含密码 | 本机单测 |
| SC-14 | 生产适配器的连接超时和单条语句超时都是 120 秒（与 `CATALOG_SCAN_TIMEOUT_MS`／`ktx sql` 默认一致）。成功、认证失败、查询异常、语句挂起四条路径都关闭连接 | 本机单测 |

客户现场复测不在本条出口。本机通过不得写成客户环境通过。

## 6. 落盘自查

| # | 要求 | 本文件 |
|---|---|---|
| 1 | Spec / Plan 编号 | `lucy-20261111-catalog-scan-read-path` |
| 2 | 核心流程（伪代码） | 有 |
| 3 | 状态元数据 | 头部「状态」 |
| 4 | Plan 五类小节 | 见配对 Plan |
| 5 | Terminology Compliance | 有，`New terms:` 为 None |
| 6 | Design System Compliance | 四段式 |
| 7 | 索引 | `docs/README.md`、`docs/plans/README.md` |
| 8 | 新命令 | 无 |
| 9 | 台账号 | 无 |
| 11 | 闭口层级 | 功能合同 |
| 12 | 已作废状态句 | 未使用 |
