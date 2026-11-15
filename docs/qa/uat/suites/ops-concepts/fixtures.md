# Fixtures — UAT-SUITE-OPS-CONCEPTS

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:55176` | 以当次端口为准 |
| Health | `http://127.0.0.1:55176/api/health` | 记录 `gitSha`／`gitDirty` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` | |
| Compose | `deploy/compose/docker-compose.demo.yml` | |
| Lucy 容器 | `compose-lucy-1` | |
| 内容根（KTX_PROJECT_ROOT） | `/data/lucy` | 数据卷；**不得**为过 UAT 而拷入 `scripts/` |
| 代码根（概念核心） | `/app`（`scripts/concepts/*.mjs`） | P1-27 修复后动态 import 锚点 |
| WebUI 登录凭据 | `/Users/forrest/Desktop/lucywebui logi.txt` | 路径 only；若缺则用本机既有回退路径（跑次写路径，不写密码） |
| 问数 MCP Bearer | `/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`） | 无 `allow.ops` |
| 临时 Role id | `uat-ops-concept-role` | 测后删除 |
| 临时 Agent id | `uat-ops-concept-agent` | 测后删除 |
| 临时 Token label | `uat-ops-concept` | 吊销后删 Agent |
| Role `allow.ops` 最小工具集 | `lucy_ops_concept_list`、`lucy_ops_concept_show`、`lucy_ops_concept_summary`、`lucy_ops_concept_scan` | 可读＋scan；本波可不授 set_canonical／reject |
| Admin API | `POST/GET/DELETE /api/admin/roles`；`POST/DELETE /api/admin/agents`；`POST .../tokens` | 见 `webui/docs/03-api-spec.md` |
| 证据目录（建议） | `inbox/uat-ops-concepts-<YYYY-MM-DD>/` | 无 secret；可含 health JSON 摘录、tools/list 名列表 |
| 首跑 FAIL 对照 | [runs/2026-11-15-claude-macmini-p1-11-ops.md](runs/2026-11-15-claude-macmini-p1-11-ops.md) | `gitSha=9d59337d…`；02＝502／`ERR_MODULE_NOT_FOUND` |
| P1-27 复测跑次命名 | `runs/YYYY-MM-DD-<agent>-p1-27-ops-retest.md` | 过 R0-FIX 后再写 INDEX |

## 复跑探针（无 secret）

```bash
# 健康与脏树门禁（R0-FIX）
curl -sS http://127.0.0.1:55176/api/health | tee /tmp/uat-ops-health.json
# 期望：ok；gitDirty=false；gitSha＝本波修复提交

# 拆卷前提仍在
docker exec compose-lucy-1 sh -c 'test ! -e /data/lucy/scripts && echo NO_VOLUME_SCRIPTS'
docker exec compose-lucy-1 sh -c 'ls /app/scripts/concepts/store.mjs /app/scripts/concepts/scan.mjs && echo CODE_ROOT_OK'
```

## 禁止

- 把 Bearer／密码／token 明文写入 runs／INDEX／inbox  
- 用 vitest／CR／脏树书面确认冒充本套件 PASS  
- 留下 `uat-ops-concept-*` 临时 Role／Agent 不清理  
- 为绿往 `/data/lucy` 播种 `scripts/` 或 `node_modules`  
