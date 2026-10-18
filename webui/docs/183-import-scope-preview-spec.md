# 导入范围预览 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 183 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | T6。把发现表、Schema Manifest、启用表范围和角色有效能力分成四份预览 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 6。授权边界以 Spec 182 为准 |

## 1. 保持不变

- 不修改运行中的 Docker、配置卷或数据。
- 不改 Spec 182 的交集规则，不把空的启用表范围退回全表。
- 不改语义发布的写入范围。本批只增加预览，不把未选中的发现表写进 Manifest 或启用表范围。
- 不开始 T11、T13、T14 或配置恢复。
- 术语用「启用表范围」「Schema Manifest」「连接」「角色」。

## 2. 预览

提供 `buildImportScopePreview`。输入是一个连接 id、调用方给出的物理发现表、当前内容根里的 Schema Manifest，以及该连接的 `enabled_tables`。角色有效能力用现有权限编译，不用另一套规则。

返回四份分开的列表，成员都是 `schema.table`：

- `discovered`：调用方传入的物理发现表。未传入时为空，并标记发现未执行。不要连真实数据库。
- `manifest`：该连接 Schema Manifest 里的物理表。多出来的表留在这份列表里。
- `enabled`：该连接的启用表范围。缺省或空数组就是空列表。
- `roles`：每个身份在该连接上的有效 source。编译失败的身份 `sources` 为空，并带上机器原因，不把它算成已授权。

另外给出两份差异，仍用 `schema.table`：

- `manifestNotEnabled`：Manifest 有、启用表范围没有。
- `enabledMissingManifest`：启用表范围有、Manifest 没有。

`publishSources` 只等于 Manifest 与启用表范围的交集。它不是发现表的全集，也不是 Manifest 的全集。

## 3. 敏感级别

只读取 Manifest 或 overlay 里已经写明的 `sensitivity`。没有这个字段时记 `unconfirmed`。不要根据表名、UID 字样或前缀猜测敏感级别。

## 4. 接口

增加管理员只读接口 `GET /api/connections/:connectionId/import-scope`。发现表由查询参数传入。接口返回第 2 节的预览，不写文件。

## 5. 测试

使用临时目录。Manifest 保持八张表，不要为了通过测试删掉其中的表。

- 启用表范围两张，selector 点名四张：`manifest` 为八张，`enabled` 为两张，该角色有效 source 为两张，`manifestNotEnabled` 包含其余 Manifest 表。
- 表名含 UID、但没有 `sensitivity` 字段时，敏感级别是 `unconfirmed`。写了 `sensitivity` 的表显示所写级别。
- 未传入发现表时，`discovered` 为空，且不访问数据库。
