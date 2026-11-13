# Fixtures — UAT-SUITE-ACCESS-MAP

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176`（`LUCY_DEMO_WEBUI_HOST_PORT` 可覆盖） |
| Health | `http://127.0.0.1:55176/api/health` |
| 页面 | `/admin/access-map` |
| Access-map API | `GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all` |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| Audit DB | 容器内 `/data/lucy/.ktx-ui/audit.sqlite` |
| WebUI 登录文件（本机 demo） | `/Users/forrest/Desktop/lucywebui logi.txt`；若缺则 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` |
| MCP（可选触表） | 本机 Proxy `http://127.0.0.1:57881`（容器映射 `7879`）；或 Cursor MCP `user-lucy-local-docker` |

## 空态判定线索

- `counts.accessPaths == 0` 且 `counts.grantPaths > 0`、边多为 `dormant` → 进入空桑基修复验收面。
- 画布期望：SVG 内存在 `data-testid`／id 形如 `access-map-backbone-*` 的连通带，或目视 Agent→角色→连接 闲置骨干；**不是**仅闲置 stub 而无连通带。
- 图例含「连通骨干」或等价「不撑使用刻度」披露。

## 禁止

- 把密码／token 写入 runs／INDEX／截图说明  
- 用 vitest／CR 冒充本套件 PASS  
- `trust=include_candidate` 放开访问面  
