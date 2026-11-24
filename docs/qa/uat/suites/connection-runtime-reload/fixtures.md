# Fixtures — UAT-SUITE-CONN-RELOAD

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176`（`LUCY_DEMO_WEBUI_HOST_PORT` 可覆盖） |
| Health | `http://127.0.0.1:55176/api/health` |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| 镜像 | `project-lucy:demo` |
| demo-db | 服务名 `demo-db`；host 端口 `53306`；容器内 host=`demo-db` port=`3306` |
| demo-db root 用户 | `root`（口令见 compose `MYSQL_ROOT_PASSWORD`，**不写入本文件**） |
| 临时库 | `e2e_conn_reload`（种子脚本可确保存在） |
| 临时连接 id 前缀 | `uat-reload-` 或 live-e2e 的 `e2e-conn-reload-` |
| capability | 容器内 `/data/lucy/.ktx-ui/ktx-reload.capability` |
| reload state | `/data/lucy/.ktx-ui/ktx-reload.state.json` |
| WebUI 登录文件（规则／手工） | `/Users/forrest/Desktop/lucywebui logi.txt` |
| WebUI 登录文件（live-e2e 默认） | `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` |
| live-e2e 另需 | `/Users/forrest/Projects/config-for-agents/mysql-aliyun.txt`（存在性门禁；本套件创建连 demo-db 时主要用 DEMO_DB 常量） |

## 自动化入口

```bash
# 进程级（含 VERIFY-191-C01）
LUCY_RELOAD_VERIFY_IMAGE=project-lucy:demo \
LUCY_RELOAD_VERIFY_CONTAINER=compose-lucy-1 \
LUCY_RELOAD_VERIFY_HEALTH_URL=http://127.0.0.1:55176/api/health \
bash scripts/verify/verify-ktx-reload-lifecycle.sh --container

# 浏览器 live
cd webui && npm run e2e:live:connection-reload
```

## 禁止

- 用 `docker restart compose-lucy-1` 让新连接生效  
- `npm run demo:upgrade -- --fresh`（会清运行时配置）  
- 把密码写入 runs／聊天／截图说明  
