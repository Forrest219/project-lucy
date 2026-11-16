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
| 临时身份（BUDGET-04） | Role `uat-budget-continue-role-<后缀>`；Agent `uat-budget-continue-agent-<后缀>`；Token label `uat-budget-continue` | 克隆 `demo_readonly` + `lucy_continue_question`；测后必须删。**已删除的 Role id 永久保留，再建同名返回 409 `ROLE_ID_RETIRED`**，每跑一次换新后缀（已用 `-b`、`-c`；旧无后缀名已退役） |
| Admin API 写入要点（BUDGET-04） | `POST /api/admin/roles` `{dryRun:false,roleId,role}`；`POST /api/admin/agents` `{dryRun:false,agent:{id,name,roles:[…]}}`；`POST …/tokens` 必须带 `expires_at`；`DELETE …/agents/:id` 须带 JSON 体 `{}`；`DELETE …/roles/:id` 须带 `{dryRun:false}`（默认只预演） | 口令由委托人在会话内给出，只走环境变量，不入库 |

## 禁止

- 改 `QUESTION_BUDGET_MAX_*` 常量或临时 patch  
- 把 token 写入 runs  
- 用 vitest 冒充本套件 PASS  
