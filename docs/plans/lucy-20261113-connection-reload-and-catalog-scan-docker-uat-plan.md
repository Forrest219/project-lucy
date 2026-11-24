# Docker 复现验收：连接热重载 ＋ 库内扫表读法

> **For agentic workers:** 本文件是**验收／模拟复现计划**，不是新功能实现 Plan。执行时用 `executing-plans` 按 Task 勾选；不要改产品代码，除非验收失败后另开缺陷修复授权。

**Goal:** 在当前本机 demo Docker（`compose-lucy-1`）上，用可重复步骤证明两件事已修复：（1）新建／编辑连接后执行层热重载生效；（2）库内扫表读法按 Spec 收敛（普通 MySQL 一次读字段；外部目录走直连 `SHOW`）。

> **长期资产已迁至 UAT 项目：** [`docs/qa/uat/`](../qa/uat/README.md)（套件 `UAT-SUITE-CONN-RELOAD`／`UAT-SUITE-CATALOG-SCAN`）。本 Plan 保留为首次落地指引；**反复复现与 Claude 交叉验证以 UAT 树为准。**

**Architecture:** 三轨串行。Track 0 环境门禁 → Track 1 连接热重载（进程级 ＋ live E2E ＋ 手工 UAT）→ Track 2 扫表读法（Docker 内可做的普通 MySQL 路径必做；外部目录 `catalog.database` 路径因 demo 无该连接，走「可选加连」或「仓内替身单测」双出口）。全程**禁止** `docker restart`／`demo:upgrade --fresh` 作为「修复手段」；升级镜像若需要，只允许验收前一次性平滑 `demo:upgrade`（保留 volume）。

**Tech Stack:** `project-lucy:demo` 容器、`demo-db` MySQL、Playwright `e2e:live:connection-reload`、`verify-ktx-reload-lifecycle.sh --container`、WebUI `http://127.0.0.1:55176`、凭据 `/Users/forrest/Desktop/lucywebui logi.txt`（规则只写路径，不复述密码）

**对照缺陷／合同:**

| # | 对象 | 主证据 |
|---|---|---|
| 1 | 创建／编辑后执行层热重载 | Spec 191；[父 Plan](lucy-20261112-connection-create-execution-runtime-reload-plan.md)；[B 轨](lucy-20261113-connection-reload-live-e2e-uat-plan.md) |
| 2 | 库内扫表读法 | [Spec](../specs/lucy-20261111-catalog-scan-read-path-spec.md) SC-01–SC-14；[Plan](lucy-20261111-catalog-scan-read-path-plan.md) |

## Global Constraints

- 目标环境：当前运行中的 demo stack（已观测：`compose-lucy-1` healthy，WebUI `http://127.0.0.1:55176`，`gitSha` 以 `/api/health` 为准）。
- **平滑升级优先**：若镜像落后于分支 tip，只跑 `BUILDPLATFORM=linux/arm64 npm run demo:upgrade`（**不** `--fresh`），保留账号／ACL／audit。
- 验收过程**不得**用 `docker restart compose-lucy-1` 让新连接「碰巧生效」；若必须重启才能问到新连接 → Track 1 **FAIL**。
- 临时连接 id 一律带前缀 `uat-reload-`／`uat-scan-`；每 Task 结束必须 `remove` 或等价清理。
- 回复与证据里**不写密码**；只写凭据文件路径。
- Track 2 外部目录：当前 `/data/lucy/ktx.yaml` 仅有 `demo-mysql`／`invest-db`／`mysql-aliyun`／`lucy-ops`，**无** `catalog.database` 形态。不得假装 demo 已覆盖 SelectDB 外部目录 live 路径。
- 本计划绿灯 ≠ 可上线；只证明这两类故障在本机 Docker 已复现并通过修复路径。

---

## 0. 范围与非目标

### 必做（本机 Docker 可闭环）

| ID | 断言 |
|---|---|
| **UAT-R0** | 容器 healthy；capability `idle`；`activation=current`（或可经「重载执行层」回到 current） |
| **VERIFY-191-C01** | `--container` Phase C canary：写连接 → supervisor reload → `connection_list` 含 canary |
| **E2E-CON-07** | UI 新建连接 → `executionRuntimeAck=true` → ≤60s `activation=current`；无 Pod 重启 |
| **E2E-MCP-02** | `reload_required` remediation →「重载执行层」→ `reloadStatus`／`configVerification` 分字段 |
| **UAT-CONN-RELOAD-01** | 手工或 API 等价路径与 E2E 同结论 |
| **UAT-SCAN-MYSQL-01** | 对 `demo-mysql`（无点号库名）「重新拉取库内目录」成功；Schema 有「库内表数」 |
| **UAT-SCAN-MYSQL-02** | 对同一连接「准备表结构」在合理时间内返回字段；容器日志／网络中**不得**出现按表循环的 N 次 `information_schema.columns`（允许 1 次 columns ＋至多 1 次 tables） |
| **UT-SCAN-SIM** | 仓内替身：`catalog-show`／`doris-external-catalog.simulation`／`schema-structure` 相关 vitest 绿（覆盖外部目录 `SHOW` 合同，弥补 demo 无外部目录） |

### 可选（有真实外部目录凭据才做）

| ID | 断言 |
|---|---|
| **UAT-SCAN-EXT-01** | 临时写入 `database: hive.dw`（或现场等价）连接后，`GET .../live-schemas` 返回库列表且 `tableCount>0`；请求路径走直连 `SHOW`，**不**查 `information_schema` 成功路径 |
| **UAT-SCAN-EXT-02** | `live-tables?schema=...` 返回表名；失败文案不含密码 |
| **UAT-CONN-EDIT-01** | 编辑已有连接端点后同样 `executionRuntimeAck` 诚实（中间态已收口项；本波可选） |

### 非目标

- UAT-CONN-RELOAD-02（人为破坏重载）
- 宣称 0.30 可上线／客户交付
- `demo:upgrade --fresh`、清 `lucy-demo-data`
- 改 KTX 上游；问数 P0 选表／口径（非本计划）
- 用云端 `124.222…` 代替本机 Docker（除非 Track 2 可选外连失败且委托人改口）

---

## 1. 环境快照（执行前填写）

执行 Track 0 后把实测值填入：

| 项 | 期望／命令 | 实测 |
|---|---|---|
| WebUI | `http://127.0.0.1:55176` | |
| `/api/health` `lucyVersion`／`gitSha` | 与分支 tip 一致或注明差异 | |
| 容器 | `compose-lucy-1` healthy | |
| capability | `/data/lucy/.ktx-ui/ktx-reload.capability` 存在；`state=idle`；心跳新鲜 | |
| reload state | `ktx-reload.state.json` → `activation=current`，`verification.state=verified` | |
| 已有连接 | `demo-mysql`（`dataforai`）等 | |
| 外部目录连接 | 无 → Track 2 外部走 UT-SCAN-SIM；有则填 id | |

---

## 2. 实现／执行任务

### Task 0: 环境门禁（UAT-R0）

**Files:** 无代码改动；只读容器与 health。

- [ ] **Step 1: 确认 stack**

```bash
docker compose -f deploy/compose/docker-compose.demo.yml ps
curl -sS http://127.0.0.1:55176/api/health | python3 -m json.tool | head -80
```

Expected: `lucy`／`demo-db` healthy；`ok: true`；记下 `gitSha`、`lucyVersion`。

- [ ] **Step 2: 确认 supervisor 通道**

```bash
docker exec compose-lucy-1 sh -c 'cat /data/lucy/.ktx-ui/ktx-reload.capability; echo; cat /data/lucy/.ktx-ui/ktx-reload.state.json'
```

Expected: `protocol` 含 `lucy-ktx-reload`；`state=idle`；`activation=current`（若为 `reload_required`，先走 MCP 调试台「重载执行层」回到 current，再继续，并记一笔）。

- [ ] **Step 3: 镜像是否需平滑升级**

若 `gitSha` 明显落后于 `git rev-parse HEAD`，且委托人要求「最新代码」：

```bash
BUILDPLATFORM=linux/arm64 npm run demo:upgrade
```

Expected: 容器 recreate 后仍 healthy；**volume 保留**；WebUI 仍为 `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}`。然后重跑 Step 1–2。

- [ ] **Step 4: 登录可用性**

打开 WebUI → 用 `/Users/forrest/Desktop/lucywebui logi.txt` 登录（本机 demo）。Expected: 进入控制台；回复只写「本机已登录」。

**通过标准:** UAT-R0 勾选；下方「环境快照」表填完。

---

### Task 1: 进程级 canary（VERIFY-191-C01）

**Files:** 只跑 `scripts/verify/verify-ktx-reload-lifecycle.sh`；不改脚本除非脚本本身坏。

- [ ] **Step 1: 跑容器门禁**

```bash
LUCY_RELOAD_VERIFY_IMAGE=project-lucy:demo \
LUCY_RELOAD_VERIFY_CONTAINER=compose-lucy-1 \
LUCY_RELOAD_VERIFY_HEALTH_URL=http://127.0.0.1:55176/api/health \
bash scripts/verify/verify-ktx-reload-lifecycle.sh --container
```

Expected: 退出码 0；输出含 `VERIFY-191-C01` pass；canary 写入后经 supervisor reload，`connection_list` 含 canary；脚本结束恢复 `ktx.yaml`。

- [ ] **Step 2: 确认无整容器重启依赖**

查 Task 时段内未对 `compose-lucy-1` 做 `docker restart`（允许脚本内 daemon 子进程替换）。Expected: 仅 supervisor 子进程轮转。

**通过标准:** VERIFY-191-C01 绿；把末尾摘要贴进 `inbox/` 临时证据文件（可选）。

---

### Task 2: Live E2E（E2E-CON-07 ／ E2E-MCP-02）

**Files:** 只跑已有 `webui/tests/live-e2e/connection-execution-reload.spec.ts`。

- [ ] **Step 1: 确认 live 凭据文件存在**

live-e2e 默认读 agents 凭据路径（见 `webui/tests/live-e2e/helpers/external-secrets.ts`）。若与桌面 `lucywebui logi.txt` 不同，按该 helper 指向的文件准备，**勿把密码写入仓库**。

- [ ] **Step 2: 跑 live 套件**

```bash
cd webui && npm run e2e:live:connection-reload
```

Expected: **2/2 PASSED**；创建路径 `executionRuntimeAck=true`；测后临时连接已 `remove`。

- [ ] **Step 3: 记录**

将命令、退出码、耗时写入本 Plan「3. 证据」表。

**通过标准:** E2E-CON-07、E2E-MCP-02 勾选。

---

### Task 3: 手工／API UAT（UAT-CONN-RELOAD-01）

**Files:** 无；浏览器 + 可选 `curl`（带 session cookie）。

- [ ] **Step 1: 准备临时库（容器网可达）**

在 `demo-db` 创建空库（若已存在可跳过）：

```bash
docker exec compose-demo-db-1 mysql -uroot -plucy_demo_root -e \
  'CREATE DATABASE IF NOT EXISTS e2e_conn_reload;'
```

- [ ] **Step 2: WebUI 新建连接**

1. 打开 `http://127.0.0.1:55176/connections`
2. 新建连接：`connectionId=uat-reload-<timestamp>`；host=`demo-db`；port=`3306`；user=`root`；database／schema=`e2e_conn_reload`；密码用 compose 默认（不入库、不写进本 Plan）
3. 若弹出端点闸（与 `demo-mysql` 同主机），选「仍要新建连接」／`acknowledgeSeparateConnection`
4. 提交后观察成功面：**必须**出现执行层已加载／`executionRuntimeAck` 为真的诚实文案；不得在失败时写「已全部生效」

- [ ] **Step 3: 不重启，验证执行层**

在 MCP 调试台或 `GET /api/admin/mcp-runtime/status`：

- `execution.activation === "current"`
- 新 id **不在** `missingConnections`／`unknownConnections`
- 全程无 `docker restart`

- [ ] **Step 4: 清理**

删除该临时连接（UI 删除或 API `remove`，`dryRun:false`）。

**通过标准:** UAT-CONN-RELOAD-01 勾选；可选补 UAT-CONN-EDIT-01（改一处非密钥字段 → 同样 ack）。

---

### Task 4: 普通 MySQL 扫表（UAT-SCAN-MYSQL-01／02）

**Files:** 无产品改动；可对浏览器 Network／容器日志取证。

前置：登录后打开 `demo-mysql` 连接卡。

- [ ] **Step 1: 库内目录（UAT-SCAN-MYSQL-01）**

1. 连接概览点「重新拉取库内目录」
2. Expected: Schema 列表出现（至少 `dataforai`）；「库内表数」为有限正整数或 0 的诚实值；失败时有可读原因且无密码明文
3. Network: `GET /api/connections/demo-mysql/live-schemas?...` → 2xx

- [ ] **Step 2: 准备表结构（UAT-SCAN-MYSQL-02）**

1. 对 `dataforai`（或页面等价入口）触发「准备表结构」／`POST .../schema-structure`
2. Expected: 在网关超时前返回列信息（demo 仅约 3 张表，应远快于旧逐表路径）
3. 取证二选一：
   - **日志法:** `docker logs compose-lucy-1 2>&1 | rg -i 'information_schema.columns|schema-structure' | tail -40` — 同一次准备中 columns 查询应是**单次 Schema 宽读**，不是每表一条
   - **计时法:** 端到端耗时与表数近似无关的常数级（demo 表少，主要防回归到明显逐表超时）

- [ ] **Step 3: 负向抽查（可选）**

断开 `demo-db` 数秒再点拉取 → 应失败可观测，恢复后可重试；错误不含密码。

**通过标准:** UAT-SCAN-MYSQL-01／02 勾选。  
**说明:** demo 表很少，**不能**单独证明「789 张表不再超时」；宽表压力若要 live，需可选连 `mysql-aliyun` 宽库或客户库（另记）。

---

### Task 5: 外部目录合同 — 仓内替身（UT-SCAN-SIM，必做）

因当前 Docker **无** `hive.*`／`catalog.database` 连接，用已收口单测代替 live SelectDB：

- [ ] **Step 1: 跑扫表相关 vitest**

```bash
cd webui && npx vitest run \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts
```

Expected: 全部 PASS；覆盖直连 `SHOW`、拒绝 `information_schema` 成功路径、宽 Schema 一次 columns、超时／关连接等 SC 点。

- [ ] **Step 2: 在证据表标注**

写明：「外部目录 live 未在 demo 执行；合同由 UT-SCAN-SIM 覆盖」。

**通过标准:** UT-SCAN-SIM 绿 ⇔ Track 2 外部目录**合同**视为本机可证明；**不等于**客户 SelectDB 现场再测免做。

---

### Task 6（可选）: 外部目录 live（UAT-SCAN-EXT-01／02）

**仅当**委托人提供可从 `compose-lucy-1` 出网访问的 SelectDB／Doris 外部目录，且同意写入临时连接时执行。

- [ ] **Step 1: 经 WebUI 新建临时连接**

- `connectionId=uat-scan-ext-<timestamp>`
- `database` 必须形如 `catalog.database`（例如现场 `hive.dw`）
- 密钥走既有 secret 机制；**不**把密码写入 Plan／inbox 明文

- [ ] **Step 2: 列库**

`GET /api/connections/<id>/live-schemas?refresh=1&purpose=manual`

Expected: 2xx；返回多个 schema 且 `tableCount` 来自 `SHOW TABLES` 行数；不得再出现 `Unknown database '...information_schema'` 作为唯一路径。

- [ ] **Step 3: 列表**

`GET .../live-tables?schema=<已存在库>`

Expected: 表名非空；失败可分。

- [ ] **Step 4: 清理**

删除临时连接；确认 `ktx.yaml` 无残留；必要时「重载执行层」回到干净 `current`。

**通过标准:** UAT-SCAN-EXT-01／02 勾选；若跳过，在证据表写 **SKIPPED（无外部目录凭据）**。

---

### Task 7: 汇总与出口

- [ ] **Step 1: 填写 §3 证据表**（命令、结果、是否重启容器）
- [ ] **Step 2: 判定**

| 判定 | 条件 |
|---|---|
| **PASS（Docker 复现关闭）** | Task 0–5 全绿；Task 6 SKIPPED 或绿 |
| **PASS WITH GAP** | Task 0–5 绿，但宽表／外部目录 live 未做且需客户现场补测 |
| **FAIL** | 任一必做 ID 红；或依赖 `docker restart` 才让新连接可见 |

- [ ] **Step 3: 回复用户**

必须带 WebUI 地址：`http://127.0.0.1:55176`（若端口映射变更则以实测为准）。说明 PASS／GAP／FAIL 与未测项。

---

## 3. 证据（执行时填写）

| ID | 命令／操作 | 结果 | 备注 |
|---|---|---|---|
| UAT-R0 | | | |
| VERIFY-191-C01 | | | |
| E2E-CON-07 | | | |
| E2E-MCP-02 | | | |
| UAT-CONN-RELOAD-01 | | | |
| UAT-SCAN-MYSQL-01 | | | |
| UAT-SCAN-MYSQL-02 | | | |
| UT-SCAN-SIM | | | |
| UAT-SCAN-EXT-* | | | SKIPPED／PASS／FAIL |

---

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 端点闸挡住新建 | 点「仍要新建连接」；与 live-e2e 同口径 |
| capability 心跳陈旧／`reload_required` | Task 0 先手动重载到 `current` |
| live-e2e 凭据路径与桌面文件不一致 | 以 `external-secrets.ts` 为准准备文件 |
| demo 表太少，扫表「快」无说服力 | MYSQL-02 用日志证明单次 columns；宽表另开可选 |
| 无外部目录连接 | Task 5 替身单测必做；Task 6 标明 SKIPPED |
| 误跑 `--fresh` | **禁止**；会清 WebUI／ACL 状态 |

---

## 5. 与既有自动化的关系

| 已有资产 | 本计划用法 |
|---|---|
| `npm run e2e:live:connection-reload` | Task 2 直接复用 |
| `verify-ktx-reload-lifecycle.sh --container` | Task 1 直接复用 |
| vitest `catalog-show`／`doris-external`／`schema-structure` | Task 5 直接复用 |
| 本计划新增 | Task 0／3／4／6／7 的 Docker 现场手工与判定矩阵 |

---

## 6. 执行前需委托人确认的一点

**外部目录 live（Task 6）是否纳入本次？**

1. **不纳入（推荐默认）** — Docker 内用 Task 4＋Task 5 关闭扫表验收；外部目录现场另约  
2. **纳入** — 提供可从本机容器访问的 `catalog.database` 连接信息（或授权使用现有密钥），再跑 UAT-SCAN-EXT-*  

确认后按选项执行；未回复前执行方可先做 Task 0–5。
