# UAT-SUITE-ACCESS-WRITE-WINDOW — fixtures

> 凭据只写文件路径，不写内容（CONVENTIONS）。

## 环境

| 项 | 值 |
|---|---|
| 隔离栈编排 | `node scripts/uat/access-write-window-stack.mjs up|down|status` |
| compose 项目 | `lucy-req0117-uat`（卷 `lucy-req0117-uat_lucy-demo-data`） |
| WebUI | `http://127.0.0.1:55386` |
| MCP Proxy | `http://127.0.0.1:57995/mcp` |
| MySQL（宿主端口） | 54326（容器 `lucy-req0117-uat-demo-db-1`，root 密码见 compose demo 默认） |
| bootstrap token | `/private/tmp/lucy-req0117-private/webui-bootstrap-token`（0600） |
| 管理员凭据缓存 | `/private/tmp/lucy-req0117-private/admin.json`（0600，栈重建后删除重 claim） |

## 夹具

| 项 | 值 |
|---|---|
| 夹具脚本 | `node scripts/uat/access-write-window-fixture.mjs up|role <id> <tables>|clean` |
| 物理表 | MySQL schema `req0117`，2000 张（`t0001..t2000`，3 列） |
| manifest | `semantic-layer/demo-mysql/_schema/req0117.yaml`（经 `POST /api/catalog/assets/upload`） |
| 启用表 | 2003 张（demo 3 张 + req0117 2000 张；经 `PUT /api/connections/demo-mysql/enabled-tables`） |
| 规模水位 | `UAT_LUCY_CONTAINER=lucy-req0117-uat-lucy-1 LUCY_DEMO_WEBUI_HOST_PORT=55386 node scripts/uat/seed-scale-access.mjs`（200 角色／500 Agent×3 凭据） |
| 宽角色 Agent | 角色 `req0117_wide_role`（绑定 2000 表）＋30 个 Agent（`req0117_wagent_*`）绑定之；合计 530 Agent |
| 测量脚本 | `node scripts/uat/access-write-window-profile.mjs baseline|profile|attribution|timeouts` |
| 证据落盘 | `inbox/req0117-dev/`（baseline/profile/attribution/timeouts JSON＋state.json） |

## 幂等与清理

- roleId 一律一次性（删除过的 id 被 tombstone，复用报 `ROLE_ID_RETIRED`）。
- 清理：`fixture.mjs clean`（删夹具角色→恢复启用表→`schemas/remove` 删 manifest→重载→drop schema）；水位回滚用 `seed-scale-access.mjs` 重灌或重建栈（`down`+`up` 即全新卷）。
- 共享 demo（`compose-lucy-1`）与本栈无共享卷/网络；禁止对共享栈执行本套件任何写操作。
