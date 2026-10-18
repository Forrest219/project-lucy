# 运行实例只读快照 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 187 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | R0。为运行实例准备只读快照清单，本批不执行它 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md) |
| 依据 | [串行计划](../plans/2026-10-18-mcp-audit-serial.md) 批次 10 |

## 1. 保持不变

- 不启动、不进入、不修改运行中的 Docker、配置卷或数据库。
- 不覆盖知识库里的原报告和证据。
- 不输出密码、完整 token 或完整 token hash。
- 不开始 R1、R2 或真实客户端验收。

## 2. 清单

提供 `buildReadonlySnapshotPlan(input)`。输入是调用方已经读到的只读材料：连接清单、每个连接的启用表、内容文件相对路径和 sha256、审计库快照文件的 sha256。函数不读磁盘、不连数据库。

输出一份 JSON 计划，包含：

- `decisions`：D1 为两张业务表且不含 UID；D2 为启用表范围交集；D3 为连接 id `mysql-aliyun`。
- `connections`：连接 id、数据库名、启用表范围。不含密码。
- `contentFingerprints`：相对路径和 sha256。
- `auditSnapshotSha256`：调用方给出的快照哈希。没有快照时为空字符串。
- `writes`：空数组。计划本身不声明任何写操作。

## 3. 测试

用内存夹具。确认计划不含密码字段，`writes` 为空，并且 D1–D3 与上面的文字一致。
