# 连接 id 一致变更 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 181 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | T4。一次候选里改连接 id 及其直接引用 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 4 |

## 1. 保持不变

- 本 Spec 不修改运行中的 Docker、配置卷或数据。
- 不实现启用表范围与普通 selector 的交集。那是 T7。
- 不删除镜像里的旧目录。镜像只按 Spec 180 从内容根单向复制。
- 不把数据库名变化当成连接 id 变更。本批只改连接 id 字符串。
- 预览和审计不输出密码或完整凭据。
- 术语用「连接」「角色」「启用表范围」。

## 2. 候选

提供 `planConnectionIdChange(projectRoot, fromId, toId)`。`fromId` 与 `toId` 都必须符合现有连接 id 规则。`toId` 已存在于 `ktx.yaml` 时，候选的 `ok` 为 false，原因码 `connection_id_taken`，且不写任何文件。

候选列出将要修改的位置：

- `ktx.yaml` 里该连接的 key
- `access.yaml` 里角色 `allow.connections` 与 `tableSelectors[].connection`
- 内容根下 `semantic-layer/<fromId>` 目录改名为 `semantic-layer/<toId>`
- Wiki `sl_refs` 中等于 `fromId` 或以 `fromId/` 开头的项，改成对应的 `toId` 前缀

默认不落盘。

## 3. 能力差异

在临时副本上应用候选后编译受影响身份。返回每个受影响身份的 source 名称前后集合：`added` 与 `removed`。编译失败时该身份记 `compile: "failed"` 和机器原因，不把它算成授权增加。

## 4. 提交与回退

`applyConnectionIdChange` 只在调用方显式要求写入时落盘。写入顺序为 `access.yaml`、内容根目录改名、Wiki 引用、最后 `ktx.yaml`。任一步失败，已写入的文件恢复到调用前的内容，目录改名恢复原名。失败不记 `write_status=committed`。

成功后调用现有 `syncContentToProjectRoot`。镜像里残留的旧目录留在原地，由 Spec 180 报成 `mirror_only`。

## 5. 测试

使用临时目录，不读本机真实配置。

- `toId` 已存在时不改文件。
- 显式写入后，角色 selector、语义目录名和 Wiki `sl_refs` 与新 id 一致，旧目录名不再出现在内容根。
- 在写入 Wiki 前注入失败时，`ktx.yaml`、`access.yaml` 和语义目录都回到原状。
- 能力差异能看出 source 名称集合的增减。
