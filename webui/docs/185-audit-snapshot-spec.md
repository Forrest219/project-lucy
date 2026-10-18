# 审计一致快照 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 185 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | T13。用 SQLite backup 取得审计库快照，并让导出区分空工具与编译失败 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 8 |

## 1. 保持不变

- 不修改运行中的 Docker、配置卷或数据。
- 不把复制审计主库文件当作快照。
- 不开始 T14 或配置恢复。
- 不改现有 CSV 列的含义。`outcome` 与 `decision_reason` 继续是区分口径。

## 2. 快照

提供 `snapshotAuditDatabase(source, destination)`。`source` 是已经打开的 `better-sqlite3` 数据库。实现调用它的 `backup` 方法写入 `destination`，然后返回该文件的 sha256。

快照完成后，源库再写入的行不得出现在已经生成的快照里。

## 3. 导出

访问日志 CSV 里，一次合法的空 `tools/list` 是 `outcome=ok`。一次编译失败的 `tools/list` 是 `outcome=denied`，并且 `decision_reason` 保留机器原因。两行不能被导出成同一种结果。

## 4. 测试

使用临时数据库，不读本机审计库。

- 快照之后再插入一行，重新打开快照文件时看不到这行，并且返回的 sha256 对应该文件。
- 构造一行 `ok` 的空工具和一行 `denied` 的编译失败，CSV 同时包含这两种 `outcome` 和编译失败的 `decision_reason`。
