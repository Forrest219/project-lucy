# Fixtures — UAT-SUITE-READYZ-MCP-LISTEN

| 项 | 约定 |
|---|---|
| 环境 | 本机 Docker／demo 或客户额度等价容器；Web 与 MCP 端口映射已知 |
| 采样 | 启动前即开始；间隔 ≤100ms；保留原始时间戳 JSON |
| MCP | 直连 `http://127.0.0.1:<MCP_PORT>/mcp`（或产品实际 path）；initialize JSON-RPC |
| Token | 仓库外 Agent Token 文件路径；禁写内容 |
| 输出 | `inbox/uat-readyz-mcp-listen-YYYY-MM-DD/` |

可写：端口、镜像 revision、采样 JSON 路径。禁写：Token 正文。
