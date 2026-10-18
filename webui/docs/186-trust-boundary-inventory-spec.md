# 信任边界只读清单 Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 186 / v0.1 |
| 日期 | 2026-10-18 |
| 状态 | 已实现 |
| 范围 | T14。只读核对客户入口、内部凭据和数据库授权清单 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |
| 依据 | [串行计划](../../docs/plans/2026-10-18-mcp-audit-serial.md) 批次 9 |

## 1. 保持不变

- 不连接运行中的数据库，不执行 `GRANT` 或 `REVOKE`。
- 不修改 Helm、compose、代理或数据库账号。
- 不把内部 token 或客户 token 写进日志、错误或返回值。
- 不开始配置恢复。

## 2. 发布端口

提供 `collectPublishPortInventory()`。它只读仓库里的 Helm Service 模板和 demo compose。

客户入口发布的端口只有 WebUI 和 MCP Proxy `7879`。`7878` 可以出现在容器内部上游变量里，但不能出现在 Service 端口或 compose 的主机端口映射里。

## 3. 凭据分离

提供 `tokensAreDistinct(clientToken, internalToken)`。返回值只有是否不同，不回显任何一个 token。客户代理 token 与 `KTX_INTERNAL_TOKEN` 相同时报 `distinct: false`。空字符串也报 `distinct: false`。

## 4. 数据库授权清单

提供 `summarizeSqlGrants(statements)`。输入是调用方给的 `SHOW GRANTS` 文本。输出按账号列出权限语句，不连接数据库，不提出修改。

## 5. 测试

不读本机真实配置，不打印 token。

- Helm Service 与 demo compose 的发布端口不含 `7878`。
- 两个不同的假 token 得到 `distinct: true`；相同或空 token 得到 `distinct: false`，返回值里没有 token 原文。
- 一段夹具 `GRANT` 文本能列出账号和语句。
