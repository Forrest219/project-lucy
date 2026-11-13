# 连接热重载 — W2 中间态书面收口（默认降级）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 对象 | [连接创建后执行层热重载 Plan](../plans/lucy-20261112-connection-create-execution-runtime-reload-plan.md) |
| 依据 | [landed 收口 Plan](../plans/lucy-20261113-landed-middev-closure-batch-plan.md) Task W2-2；审计 [W2-1 report](../../.superpowers/sdd/task-w2-1-report.md) |
| 性质 | **书面中间态收口**。**不**登记「发布取证缺陷关闭」；**不**表示可上线 |

## 结论

**默认路径 A（书面降级）：** 主机写路径、Vitest 与容器进程级门禁 **已收口**；浏览器 live E2E 与经 WebUI 的完整 UAT **仍为已知债**，**不挡**本波 W2 文档收口；**挡**发布取证清单勾选与「运维缺陷关闭」声明。

## 已收口（本中间态认定 CLOSED）

| 范围 | 证据 |
|---|---|
| Task 1–2 supervisor 写路径 | `reloadThroughSupervisor` → `reloadExecutionRuntime`；Plan §4 Task 1–2 `[x]` |
| Task 3 create 诚实成功面 | Create API／Drawer 三段事实；Plan L112–114 |
| Task 4 Spec 191 NG2 | Spec 191 v0.3；Plan Task 4 `[x]` |
| **UT-RELOAD-01/02、UT-CONN-01** | `webui/server/__tests__/ktx-mcp-reload.test.ts`、`api.create-connection.test.ts`；changelog 2026-11-13 |
| **VERIFY-191-C01** | `scripts/verify/verify-ktx-reload-lifecycle.sh --container`；Plan Progress／changelog：**25/25 PASSED**（2026-11-13） |

## 已知债（仍 OPEN；不挡 W2 文档收口）

| ID | 层级 | 关闭条件 |
|---|---|---|
| **E2E-CON-07** | Playwright live-e2e | `webui/tests/` 落地用例；新建连接后执行层可见断言绿；登记于 QA 套件 §11.5 |
| **E2E-MCP-02** | Playwright live-e2e | live-e2e 落地 §11.6 用例绿 |
| **UAT-CONN-RELOAD-01** | 手工／容器 UAT | 本机 `demo:upgrade` 后容器 WebUI 含 supervisor 写路径；经 **WebUI POST create** 全链路取证通过（Plan L127） |

**附带 OPEN（非本表 P0 三块，仍随缺陷未关）：** edit 成功面三段事实（`EditConnectionDialog`）；UAT-CONN-RELOAD-02；Task 6 发布取证清单勾选；运行中 demo 镜像与主机代码对齐（环境）。

## 边界

- **≠ 可上线**；**≠** QA 套件浏览器层全绿；**≠** `docs/qa` 发布取证「本缺陷已关闭」。
- 关闭已知债后须：补 E2E／UAT 绿证 → 更新 Plan Task 5／6 勾选 → 方可在发布取证清单关缺陷。

## 回链

| 文档 | 链接 |
|---|---|
| Implementation Plan | [lucy-20261112-connection-create-execution-runtime-reload-plan.md](../plans/lucy-20261112-connection-create-execution-runtime-reload-plan.md) |
| Spec 191 | [191-execution-runtime-reload-spec.md](../../webui/docs/191-execution-runtime-reload-spec.md) |
| W2 批次 Plan | [lucy-20261113-landed-middev-closure-batch-plan.md](../plans/lucy-20261113-landed-middev-closure-batch-plan.md) |
