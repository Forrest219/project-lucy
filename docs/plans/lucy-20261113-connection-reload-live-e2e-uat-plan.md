# B 轨：连接热重载 Live E2E／UAT 收口 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development. Checkbox tasks track progress.

**Goal:** 关闭连接创建→执行层重载缺陷的浏览器与 UAT 已知债：`E2E-CON-07`、`E2E-MCP-02`、`UAT-CONN-RELOAD-01`，使发布取证可勾选本缺陷关闭。

**Architecture:** 对运行中本机 demo（`compose-lucy-1`，默认 WebUI `http://127.0.0.1:55176`）跑 Playwright `live-e2e`：真实登录、真实 `POST /api/connections`／抽屉创建、真实 supervisor `ktx-reload` 通道。无 `page.route` 状态桩。进程级门禁 `VERIFY-191-C01` 已绿，本轨补浏览器与经 WebUI 的取证。

**Progress (2026-11-13 · 已收口):** `npm run e2e:live:connection-reload` **2/2 PASSED**（E2E-MCP-02 2.9s；E2E-CON-07 9.7s）。UAT-CONN-RELOAD-01：本机 demo `http://127.0.0.1:55176`，经 UI／POST create（`acknowledgeSeparateConnection`）→ `executionRuntimeAck=true`，`activation=current`，`verification=verified`，全程无 `docker restart`。未做 `--fresh` upgrade（运行中镜像已含 supervisor 写路径）。

**Tech Stack:** Playwright live-demo config、外部凭据文件（`config-for-agents`）、demo-db MySQL、Spec 191 supervisor

**Parent:** [lucy-20261112-connection-create-execution-runtime-reload-plan.md](lucy-20261112-connection-create-execution-runtime-reload-plan.md) Task 5／6；[middev 收口](../reviews/2026-11-13-connection-reload-middev-closure.md)

---

## 0. 范围

| ID | 层级 | 关闭条件 |
|---|---|---|
| **E2E-CON-07** | live-e2e | UI 新建唯一连接 → ≤60s `activation=current`；新 id 不在 unknown／missing；成功面不得在 ack=false 时伪报已加载 |
| **E2E-MCP-02** | live-e2e | 待重载态 remediation 口径正确；Owner「重载执行层」→ outcome 分字段；成功后 `activation=current` |
| **UAT-CONN-RELOAD-01** | 取证 | 同路径证据（API 或 UI）写入本 Plan／changelog；无需 `docker restart` |

**非目标：** UAT-CONN-RELOAD-02；EditConnectionDialog 三段事实；`demo:upgrade --fresh`（当前镜像已含写路径）。

---

## 1. 环境前置

- [x] `compose-lucy-1` healthy；WebUI `http://127.0.0.1:55176`
- [x] capability 有效（`state=idle`／心跳新鲜）
- [x] 登录文件：`/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（live-e2e 默认路径）
- [x] 临时库：`demo-db` / `e2e_conn_reload`（root／容器内口令，不入库）
- [x] 与 `demo-mysql` 同主机端口 → 创建须走端点闸「仍要新建连接」／`acknowledgeSeparateConnection`

---

## 2. 实现任务

### Task 1：live-e2e 用例

- [x] `webui/tests/live-e2e/connection-execution-reload.spec.ts`：`@live-demo` 串行覆盖 `E2E-MCP-02` → `E2E-CON-07`
- [x] npm script `e2e:live:connection-reload`
- [x] 测后 `POST .../remove`（`dryRun:false`）清理临时连接

### Task 2：跑绿与 UAT 取证

- [x] Playwright 对 `:55176` 绿灯（2/2）
- [x] 将 UAT-CONN-RELOAD-01 证据记入本 Plan Progress 与父 Plan／changelog
- [x] 更新 middev 收口：三块已知债 CLOSED

### Task 3：文档镜像

- [x] 父 Plan Task 5／6 勾选
- [x] QA 套件 §11.5／§11.6 标注 live-e2e 落点
- [x] `docs/qa/changelog.md` 一节

---

## 3. 验收

1. `cd webui && npm run e2e:live:connection-reload` 退出 0
2. 全程无 `docker restart`／整 Pod 重启
3. 父 Plan 可声明浏览器债关闭；发布取证清单可勾本缺陷（仍须按 DEVELOPMENT 流程）

---

## 4. 风险

| 风险 | 缓解 |
|---|---|
| 端点闸挡住新建 | 断言并点击 `endpoint-gate-separate` |
| 执行层已是 `current` 时 MCP-02 无 remediation | 先 bump `ktx.yaml` 注释行制造 `reload_required`（容器内，测后随 reload 消化） |
| 系统代理挡 `demo:upgrade` | 本轨不强制 upgrade；镜像已含 fix |
