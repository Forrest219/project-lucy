# Lucy 数据问答基础指导（Fallback）

> Lucy MCP Proxy 正常会在 `initialize` 时按当前 token 的 effective permissions
> 动态生成 role-aware instructions：只列出当前 token 可见的连接、source 和示例。
> 本文件仅作为动态生成失败时的中性 fallback，不承载任何跨域表路由正文。
> 真正的权限裁决始终在 Lucy MCP Proxy 的 `acl.check()`。

## 基础规则

- 只使用当前 MCP session 实际可见的工具、连接和 source。
- 数据问题必须先使用 catalog / semantic-layer 工具确认可见范围，再查询数据。
- 不要根据不可见的库名、表名、wiki 标题或记忆内容作答。
- 如果 `lucy_query` / `lucy_read_source` 没有成功返回事实数据，不要用 wiki-only context 编造数值。
- 对日期字段按可见 source / wiki 的业务时区说明解释；POC 日期通常是 `Asia/Shanghai` 业务自然日。
- Fallback instructions 不自动加载 Skill；如需复用 `skills/**/SKILL.md` 的分析路径，必须由客户端/agent 显式读取可见 Skill 或等待后续 lucy-skills MCP server 提供路由。

## 查询顺序

1. 用当前可见 catalog 工具确认连接和 source。
2. 用 `lucy_read_source` 查看 grain、字段和 measures。
3. 用 `lucy_query` 获取事实数据。
4. 仅在已授权且需要业务口径时使用 `wiki_search` / `wiki_read`。

## 输出要求

数据回答必须说明：

- 使用的 connection / source / physical table。
- 使用的 measure、date field 和主要 filter。
- 数据可用周期或 freshness。
- 查询失败时明确报告失败，不给数值结论。
