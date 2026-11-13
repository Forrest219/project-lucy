# 连接热重载 — 中间态 → B 轨收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 对象 | [连接创建后执行层热重载 Plan](../plans/lucy-20261112-connection-create-execution-runtime-reload-plan.md) |
| 依据 | W2 书面收口；[B 轨 Plan](../plans/lucy-20261113-connection-reload-live-e2e-uat-plan.md) |
| 性质 | **B 轨已关闭 E2E／UAT-01 已知债**。**≠ 可上线**（整包发布仍按 DEVELOPMENT 取证） |

## 结论

W2 书面降级时登记的 P0 三块已知债（`E2E-CON-07`／`E2E-MCP-02`／`UAT-CONN-RELOAD-01`）已由 B 轨关闭：`npm run e2e:live:connection-reload` **2/2 PASSED**（本机 demo `http://127.0.0.1:55176`）。进程级 C01 与单测仍保持 CLOSED。

## 已收口

| 范围 | 证据 |
|---|---|
| Task 1–4／C01／UT | 同 W2 middev 表 |
| **E2E-CON-07** | `webui/tests/live-e2e/connection-execution-reload.spec.ts`；UI 新建 → `executionRuntimeAck=true` → `activation=current` |
| **E2E-MCP-02** | 同文件；bump digest → remediation →「重载执行层」→ `reloadStatus`／`configVerification` 分字段 |
| **UAT-CONN-RELOAD-01** | 同上 live 跑绿；API 探测同等路径亦曾 `ack=true`；无 `docker restart` |

## 仍 OPEN（不挡本缺陷主关闭）

| ID | 说明 |
|---|---|
| EditConnectionDialog 三段事实 | Task 3 残留 |
| UAT-CONN-RELOAD-02 | 失败可观测（可选） |

## 边界

- **≠ 可上线**；Edit／UAT-02 未做不阻止「创建→重载」主缺陷关闭声明。
- 回链：[B 轨 Plan](../plans/lucy-20261113-connection-reload-live-e2e-uat-plan.md) · Spec 191 · 父 Plan Task 5／6。
