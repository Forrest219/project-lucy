# Fixtures — UAT-SUITE-QUESTION-BUDGET

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:55176` | |
| Health | `http://127.0.0.1:55176/api/health` | |
| MCP Proxy | `http://127.0.0.1:57881/mcp` | |
| MCP Bearer | `/Users/forrest/Desktop/lucy token.txt` | 路径 only |
| 连接 | `demo-mysql` | |
| 推荐查询 | `lucy_query`：`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]` | 计为 1 次数据工具 |
| 备选 | `lucy_read_source` 短读 `superstore_orders` | 亦计 1 次 |
| 不计预算 | `lucy_catalog`、`lucy_begin_question`、`lucy_continue_question`、协议 `initialize`／`tools/list` | 不得用这些充「第 N 次数据工具」 |
| 期望文案 | `60` 次；`300` 秒 | initialize instructions |
| WebUI 登录凭据 | `/Users/forrest/Desktop/lucywebui logi.txt`（缺失则 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`；本机 Docker 回退 `/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-login.txt`） | 路径 only；三行：地址／账号／口令；仅 BUDGET-04 建临时身份用 |
| 临时身份（BUDGET-04） | Role `uat-budget-continue-role`；Agent `uat-budget-continue-agent`；Token label `uat-budget-continue` | 克隆 `demo_readonly` + `lucy_continue_question`；测后必须删 |

## 禁止

- 改 `QUESTION_BUDGET_MAX_*` 常量或临时 patch  
- 把 token 写入 runs  
- 用 vitest 冒充本套件 PASS  
