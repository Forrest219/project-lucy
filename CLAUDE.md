# KTX Project — Claude Code Context

本仓库的开发约束见 [`AGENTS.md`](AGENTS.md)。

数据问答指导已迁移至 Lucy MCP Proxy 的 `initialize` instructions 注入（内容来源 [`webui/config/data-qa-instructions.md`](webui/config/data-qa-instructions.md)，机制说明见 [`webui/docs/07-mcp-auth-proxy-spec.md`](webui/docs/07-mcp-auth-proxy-spec.md) §4.4）。任何走 `:7879`（Bearer token 鉴权）连接的客户端——Codex、Cursor、Claude Code（含本地仓库开发会话）——在 MCP session 建立时都会拿到该指导，不再依赖本文件。

本文件不再承载任何运行时数据问答规则；如发现又被写入查询优先级、表路由、指标口径等内容，视为回归。
