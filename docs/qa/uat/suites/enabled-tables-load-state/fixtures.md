# Fixtures — enabled-tables-load-state

| 项 | 约定 |
|---|---|
| 环境 | 本机 demo compose（保留 volume 平滑升级后的实例） |
| WebUI | `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}` |
| MCP Proxy | `http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}` |
| 连接 | demo 默认连接（常见 `demo-mysql`）；以页面实际连接 ID 为准 |
| 注入范围 | **仅**浏览器侧改写 `GET /api/connections/:id/tables`；不改 `ktx.yaml`、不改磁盘 Manifest、不 PUT enabled-tables |
| 凭据 | 管理员账号密码不入库；跑次记录只写「已登录管理员」 |
| 视口 | 1920×1080 |
| 禁止 | 点击「移出无效启用」；重传 Manifest 当作验收手段 |
