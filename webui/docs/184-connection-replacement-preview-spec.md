# 连接替换差异 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 184 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | T11。替换连接前展示对象差异 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 7 |

## 1. 保持不变

- 本 Spec 只做预览，不写入 `ktx.yaml`、角色、语义目录或 Wiki。
- 不修改运行中的 Docker、配置卷或数据。
- 不开始 T13、T14 或配置恢复。
- 连通测试成功的文案继续表示连通测试本身。不得写成「权限已恢复」或「问数已恢复」。
- 预览不输出密码或完整凭据。

## 2. 候选

提供 `planConnectionReplacement(projectRoot, connectionId, candidate)`。`candidate` 只接受 `database`、`schemas`、`enabledTables`。传入密码字段时拒绝，并且不读出现有密码。

预览列出当前值与候选值：

- 数据库名
- Schema 列表
- 启用表范围
- 该连接在 Schema Manifest 与 Wiki `sl_refs` 中的引用是否仍指向这个连接 id
- 受影响身份的 source 名称前后集合。能力差异在临时副本上编译。编译失败的身份记机器原因，不把它算成授权增加。

主机名相同不表示是同一个对象。`sameHost` 可以单独标出，但 `sameObject` 只在数据库名、Schema 列表和启用表范围都相同的时候为 true。

## 3. 测试

使用临时目录，不读本机真实配置。

- 数据库名变化时，即使主机相同，`sameObject` 为 false，并列出数据库名、Schema 和启用表范围的前后值。
- 预览结果里没有密码。
- 启用表范围变窄后，能力差异能看出被去掉的 source。
- 连通测试成功文案不包含「权限已恢复」或「问数已恢复」。
