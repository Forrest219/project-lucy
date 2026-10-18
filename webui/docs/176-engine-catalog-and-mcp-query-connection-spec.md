# 新建连接：Amazon Athena

| 元数据 | 内容 |
|---|---|
| 文档名称 | 新建连接：Amazon Athena |
| 文档类型 | Product / Connection Spec |
| Spec 编号 | 176 |
| 版本 | v0.3 |
| 撰写日期 | 2026-10-18 |
| 委托人 | xingchen |
| 状态 | **待审阅，未批准**。v0.3 取代 v0.2。实现已按本文落地，批准前不把本文标成已批准 |
| 适用范围 | 新建连接和接入向导第 1 步显式支持 KTX 已有的 `driver: athena` |
| 关联工单 | `webui/docs/plans/wo-202610-27-engine-catalog-and-mcp-query-connection.md` |
| 上游 | KTX 0.16.0 `dist/connectors/athena`；Spec 124 新建连接 |
| 术语 | `webui/docs/00-product-terminology-standard.md` §4.1「Amazon Athena」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.3 | 撤回 v0.2。本文件只定义一种新增连接类型：Amazon Athena。不新增 Redshift 驱动，不新增 MCP 查询连接，不处理 Doris 引擎目录或三段表名 |
| v0.2 | 引擎目录与 MCP 查询连接。范围被判定为资源层，整版撤回 |
| v0.1 | 初稿。随 v0.2 撤回 |

## 1. 要加的类型

Lucy 已有 MySQL 与 Doris。国际表走 KTX 内核里已经存在的 Athena 驱动，新建连接把它显式列出来。

写出的 `ktx.yaml` 只使用 KTX Athena 连接自己的键：

```yaml
moji-intl:
  driver: athena
  readonly: true
  region: eu-west-1
  s3_staging_dir: s3://<bucket>/athena-results/
  workgroup: primary
  catalog: AwsDataCatalog
  database: da_moji
  databases:
    - da_moji
    - idm
  enabled_tables: []
```

不写 `host`、`port`、`username`、`password`、`engine`、`wire_protocol`，也不把 Glue 数据库写进 `schemas`。`databases` 才是 KTX 扫描 Glue 的范围。

凭据走 AWS SDK 默认链（`AWS_PROFILE`、实例角色或本机凭证）。表单不收集数据库密码，也不落密码文件。

## 2. 表单

数据库类型标签为 **Amazon Athena**。

| 表单 | 写入 |
|---|---|
| 区域，必填，形如 `eu-west-1` | `region` |
| 结果目录，必填，`s3://` 前缀 | `s3_staging_dir` |
| 工作组，预填 `primary`，可清空 | `workgroup`；清空则不写，KTX 默认 `primary` |
| 数据目录，预填 `AwsDataCatalog`，可清空 | `catalog`；清空则不写，KTX 默认 `AwsDataCatalog` |
| 默认数据库，必填 | `database` |
| 初始 Glue 数据库，可选 | `databases` |

主机、端口、用户名、数据库密码和高级引擎字段不出现。接入向导第 1 步使用同一套字段。

添加 Schema、移除 Schema 在 `driver: athena` 上读写 `databases`。读连接时，卡片上的 Schema 列表来自 `databases`，不把 `enabled_tables` 的第一段当成 Schema。

端点软门禁跳过 Athena。Athena 没有主机和端口。

## 3. 不做

- 不新增 Redshift 驱动，不接 Redshift MCP，不改 KTX 源码。
- 不把 Doris Hive 外表、三段表名、MCP 问数执行器放进本类型。
- 库内目录仍走 MySQL `information_schema`。Athena 的 Glue 库列表发现留到后续；创建时写入的 `databases` 已经是 KTX 的扫描范围。
