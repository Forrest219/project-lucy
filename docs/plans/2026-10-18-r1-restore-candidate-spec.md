# 配置恢复候选 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 188 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | R1。写出恢复候选差异，审查通过前不应用 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](../../webui/docs/00-product-terminology-standard.md) |
| 依据 | [串行计划](2026-10-18-mcp-audit-serial.md) 批次 11，决定 D1、D3 |

## 1. 保持不变

- 不修改运行中的 Docker、配置卷、数据库或工作区里的真实配置。
- 不把候选写进 `ktx.yaml`、角色、语义目录或镜像。
- 不开始 R2、R3 或真实客户端验收。
- 候选不输出密码、完整 token 或完整 token hash。

## 2. 候选

提供 `buildRestoreCandidate(current, target)`。`current` 是 R0 清单里的连接和内容指纹。`target` 必须同时满足：

- 连接 id 是 `mysql-aliyun`
- `tables` 恰好两张，形式为 `schema.table`
- 表名或 source 名包含 `uid` 时拒绝

候选列出前后差异，且 `apply` 为 false：

- 连接 id
- 内容根里要保留的 Schema Manifest 物理表，只含这两张
- 要保留的 overlay 相对路径，只含这两张表对应的文件
- 角色 selector 的 `connection` 应写成 `mysql-aliyun`
- 镜像里旧目录只记为 `mirror_only`，不声明删除

Manifest 里多出来的表留在 `droppedManifestTables`，不能因为它们存在就把目标扩成四张。

## 3. 测试

用内存夹具。

- 八张 Manifest 表、目标两张：保留两张，丢掉六张，`apply` 为 false。
- 目标表不是两张、连接 id 不是 `mysql-aliyun`、或表名含 `uid` 时拒绝。
- 返回 JSON 不含密码。
