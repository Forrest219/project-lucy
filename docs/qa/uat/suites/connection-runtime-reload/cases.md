# Cases — UAT-SUITE-CONN-RELOAD

| ID | 标题 | 层级 | 自动化指针 |
|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health + capability |
| UAT-CONN-RELOAD-C01 | 进程级 canary | 脚本 | `VERIFY-191-C01` |
| UAT-CONN-RELOAD-E2E-07 | UI 新建后执行层加载 | Playwright live | `E2E-CON-07` |
| UAT-CONN-RELOAD-E2E-02 | 手动重载同协议 | Playwright live | `E2E-MCP-02` |
| UAT-CONN-RELOAD-01 | 手工／API 等价新建 | 手工 | 同 E2E-CON-07 |
| UAT-CONN-EDIT-01 | 编辑连接成功面 ack | 手工／可选 | Edit dialog |
| UAT-CONN-RELOAD-02 | 失败可观测 | 全真／可恢复注入 | `run-zhaomin-local-gaps.mjs reload` |
| UAT-CONN-GATE-01 | 另一个外部目录确认闸 | 全真 API | `run-zhaomin-local-gaps.mjs gate` |

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

## UAT-CONN-GATE-01 — 另一个外部目录先确认

### 前置

`demo-db:3306` 上已有至少一条连接（`demo-mysql`）。不要带确认标志。

### 步骤

`POST /api/connections`，`dryRun=false`，`host=demo-db`，`database=hive.dw`（点号目录形态），不传 `acknowledgeDifferentDatabase`。

### 期望

- 409
- 文案为「这是另一个外部目录，不会加到已有连接。确认后将新增一张连接卡片。」
- `ktx.yaml` 不出现本次 id
- 不继续做「确认后真连接」：本机没有接受 `目录.库` 的服务器

### 清理

无写入则无需删除。

---

## UAT-CONN-RELOAD-02 — 失败可观测

### 前置

Lucy 容器 supervisor 健康。只短暂停住 supervisor，并把它发布的通道标成 `reloading`，让这一次写配置的重载失败。请求一结束就 `SIGCONT` 并还原能力文件。

### 步骤

1. 快照 `/data/lucy/.ktx-ui/ktx-reload.capability`
2. 将 `state` 写成 `reloading`（心跳保持新鲜、pid 仍是活着的 supervisor），然后 `SIGSTOP` 该 pid
3. `POST /api/connections` 新建到 `demo-db`／`e2e_conn_reload`，`dryRun=false`，并带 `acknowledgeSeparateConnection=true`（避开与 `demo-mysql` 的用户名闸）
4. 立刻 `SIGCONT` 并写回能力文件
5. 删除这次若已落盘的连接，再看 `/api/health`

### 期望

- 步骤 3：503，`code=EXECUTION_RUNTIME_NOT_LOADED`，文案含「配置已保存，但执行层未加载」
- 响应不得是 `executionRuntimeAck=true`
- 清理后 health `ok`，临时 id 不留在 `ktx.yaml`，supervisor 已继续跑

### 清理

无论断言成败，`finally` 里 `SIGCONT`、还原能力文件、删除临时连接。
