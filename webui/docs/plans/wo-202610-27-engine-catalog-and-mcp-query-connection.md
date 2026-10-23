# WO-202610-27 新建连接支持 Amazon Athena

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-27 |
| 标题 | 新建连接显式支持 KTX `driver: athena` |
| 状态 | **待审阅，未批准**。实现随 Spec 176 v0.3，不标已批准 |
| 来源 Spec | `webui/docs/176-engine-catalog-and-mcp-query-connection-spec.md` v0.3 |
| 撰写日期 | 2026-10-18 |

v0.2 的引擎目录和 MCP 查询连接已撤回。本工单只让 WebUI 写出的连接配置和 KTX 0.16.0 Athena 驱动一致。

## 已落地

- 新建连接与接入向导第 1 步增加数据库类型 Amazon Athena。
- 确认写入 `region`、`s3_staging_dir`、`workgroup`、`catalog`、`database`、`databases`。
- 不写主机、端口、用户名、密码、`engine`、`wire_protocol`、`schemas`。
- 读取、添加、移除 Schema 对 Athena 使用 `databases`。
- 端点软门禁跳过 Athena。
- 连接卡片引擎名显示 Athena。

## 未做

- Athena 库内目录发现（Glue `GetDatabases`）。创建时手填的 `databases` 仍是 KTX 扫描范围。
- Redshift 驱动、Redshift MCP、Doris 三段表名。
