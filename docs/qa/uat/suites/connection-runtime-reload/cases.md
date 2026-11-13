# Cases — UAT-SUITE-CONN-RELOAD

| ID | 标题 | 层级 | 自动化指针 |
|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health + capability |
| UAT-CONN-RELOAD-C01 | 进程级 canary | 脚本 | `VERIFY-191-C01` |
| UAT-CONN-RELOAD-E2E-07 | UI 新建后执行层加载 | Playwright live | `E2E-CON-07` |
| UAT-CONN-RELOAD-E2E-02 | 手动重载同协议 | Playwright live | `E2E-MCP-02` |
| UAT-CONN-RELOAD-01 | 手工／API 等价新建 | 手工 | 同 E2E-CON-07 |
| UAT-CONN-EDIT-01 | 编辑连接成功面 ack | 手工／可选 | Edit dialog |
| UAT-CONN-RELOAD-02 | 失败可观测 | 可选 | — |

---

## UAT-R0 — 环境门禁

### 步骤

1. `docker compose -f deploy/compose/docker-compose.demo.yml ps` → lucy／demo-db healthy  
2. `curl -sS http://127.0.0.1:55176/api/health` → `ok`；记录 `gitSha`／`lucyVersion`  
3. `docker exec compose-lucy-1 cat /data/lucy/.ktx-ui/ktx-reload.capability` → `state=idle`（或可恢复）  
4. 同路径 `ktx-reload.state.json` → 优先 `activation=current`；若 `reload_required`，先经 MCP 调试台「重载执行层」回到 current  

### 期望

Supervisor 通道可用；WebUI 可登录（凭据文件见 fixtures）。

---

## UAT-CONN-RELOAD-C01 — 进程级 canary

### 步骤

跑 fixtures 中 `verify-ktx-reload-lifecycle.sh --container` 命令。

### 期望

退出 0；`VERIFY-191-C01` pass；canary 经 supervisor 进入 `connection_list`；脚本恢复 `ktx.yaml`；无整容器 restart。

---

## UAT-CONN-RELOAD-E2E-07 — UI 新建后执行层加载

### 步骤

`cd webui && npm run e2e:live:connection-reload`（含本条与 E2E-02，串行）。

### 期望

- 创建提交 `executionRuntimeAck=true`，`test.status=ok`  
- 成功面含「已加载新连接」，不含「尚未确认加载」  
- ≤60s `activation=current`，新 id 不在 unknown／missing  
- 测后 remove 清理  

---

## UAT-CONN-RELOAD-E2E-02 — 手动重载同协议

### 步骤

同 live 套件：制造或等待 `reload_required` → MCP 调试台点「重载执行层」。

### 期望

响应分字段 `reloadStatus`／`configVerification`；无模糊单一 `ok`；成功后 `activation=current`；文案不含「重启 Pod」。

---

## UAT-CONN-RELOAD-01 — 手工等价

### 步骤

1. 确保库 `e2e_conn_reload` 存在（`bash scripts/uat/seed-catalog-scan-fixtures.sh` 或手工 CREATE）  
2. WebUI `/connections` 新建 `uat-reload-<ts>` → host=`demo-db`，database=`e2e_conn_reload`  
3. 端点闸若出现 →「仍要新建连接」  
4. 观察成功面执行层三段事实  
5. 查 runtime status；**不** docker restart  
6. 删除连接  

### 期望

与 E2E-07 同口径。

---

## UAT-CONN-EDIT-01 — 编辑（可选）

编辑已有非关键连接的显示字段或允许的端点字段 → 成功面 `executionRuntimeAck` 诚实。

---

## UAT-CONN-RELOAD-02 — 失败可观测（可选）

人为破坏重载或依赖历史失败日志 → UI 不得伪报已加载；保留「重载执行层」。
