# Fixtures — UAT-SUITE-SOURCE-AMBIGUITY

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Health | `http://127.0.0.1:55176/api/health` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| MCP Bearer 文件（本机） | `/Users/forrest/Desktop/lucy token.txt`（或 `/Users/forrest/Desktop/lucymcp.txt`）；只读路径，**不**把 token 写入仓库／runs |
| 连接 | `demo-mysql` |
| 歧义词 | `超市`（命中 orders／people／returns） |
| 断言度量 | `superstore_orders.order_count` |

## 禁止

- 把 Bearer／密码写入 runs／INDEX  
- 用 vitest／CR 冒充本套件 PASS  
