# Fixtures — UAT-SUITE-BUDGET-AUDIT

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:55176` | |
| Health | `http://127.0.0.1:55176/api/health` | |
| WebUI 登录 | `/Users/forrest/Desktop/lucywebui logi.txt` | Admin |
| MCP | `http://127.0.0.1:57881/mcp` | 若需自跑耗尽 |
| MCP Bearer | `/Users/forrest/Desktop/lucy token.txt` | |
| 调用流水导出 | `GET /api/admin/audit/export` | `calls.csv`（v1） |
| 字段说明 v1 | `GET /api/admin/audit/export-metadata` | 须含预算扁平列 |
| 字段说明 v2 | `GET /api/admin/audit/v2/export-metadata` | **不得**含本条新列 |
| 扁平列（表尾） | `budget_event_kind`、`budget_exhausted_by`、`budget_calls`、`budget_busy_ms`、`budget_elapsed_ms`、`budget_attempts`、`budget_max_calls`、`budget_max_busy_ms`、`budget_max_wall_ms`、`budget_wall_mode`、`budget_window_id`、`budget_continuations` | 非事件行为空 |
| 证据目录 | `inbox/uat-p1-11-12-14-2026-11-15/p1-14/` | 可放 csv 摘录；禁 cookie／token |

## 禁止

- 用 vitest／夹具 CSV 冒充本套件 PASS  
- 改源码常量加速耗尽  
- 把登录 cookie／token 写入 runs  
