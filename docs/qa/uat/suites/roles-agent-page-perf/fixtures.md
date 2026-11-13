# Fixtures — UAT-SUITE-ROLES-AGENT-PERF

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176`（`LUCY_DEMO_WEBUI_HOST_PORT` 可覆盖） |
| Health | `http://127.0.0.1:55176/api/health` |
| Roles 页 | `/admin/roles` |
| Agent 页 | `/admin/agents`（或导航「Agent」等价路由） |
| Roles 列表 API | `GET /api/admin/roles`（含 `?includeTemplates=false`） |
| Agents 列表 API | `GET /api/admin/agents`（及统计 query 变体） |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| WebUI 登录文件（本机 demo） | `/Users/forrest/Desktop/lucywebui logi.txt`；若缺则 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` |
| 发布取证 runner（可选） | 仓库根 `npm run perf:release-baseline -- --tier ci-small`／`--tier release-medium` |

## 网络合同线索

- **Roles 冷进页**：应出现 **恰好 1** 次（或同一次会话刷新 1 次）`GET /api/admin/roles`（可带 query）；**不得**出现按 Role 的 `GET /api/admin/roles/:roleId` 列表拼装风暴。  
- **Agent 冷进页**：首屏就绪前 **不得** 请求 `/api/admin/roles`；打开「新建 Agent」弹窗后允许拉 Roles。  
- 列表 API 墙钟：demo 夹具下期望秒级内返回（参考 Spec RPB-W3 API ≤200ms／RPB-W2 页 ≤500ms；demo 负载不同时记录实测，不得用 CR 改期望）。

## 禁止

- 把密码／token 写入 runs／INDEX／截图说明  
- 用 vitest／CR 冒充本套件 PASS  
- 把可选 `perf:release-baseline` 绿当成浏览器体感已测  
