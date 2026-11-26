# UAT-SUITE-ACCESS-WRITE-WINDOW — cases

> 判定口径见 [suite.md](suite.md)；规模口径见 [fixtures.md](fixtures.md)。每个用例记录：步骤、期望、实测（含计时）、证据指针。

## UAT-AWW-R0（环境门禁）

1. `access-write-window-stack.mjs status` → running；`/api/health` ok。
2. 夹具就绪：启用表 2003；Agent 530（500 水位＋30 宽）；manifest 在位。
期望：全部成立，否则后续用例 BLOCKED（写明缺失项）。

## UAT-AWW-01（SC-01 红基线存档）

- 证据：`inbox/req0117-dev/baseline-2026-11-26T06-37-11-204Z.json`（修复前镜像，写窗 10.4s、write_pending 503×1、重叠写 0.555s 503 `PUBLISH_COORDINATOR_BUSY`）＋加重场景实测（30 宽 Agent 下写窗 17.9–21.9s、窗内 503×5，过程记录见 task0-report.md §2）。
期望：两症状在修复前镜像复现并存档。

## UAT-AWW-02（SC-02／SC-08 重叠写成交＋写窗基线）

1. A：发起 2000 表角色创建（RACS 两步）。
2. A 提交进行中（观测到写窗）发起 B：另一 roleId 的 1 表角色创建。
3. 期望：B 在等待上限内取得锁并成交（200）；A、B 均 `written=true`。
4. 记录：写窗总时长（A、B）、pending 子窗口（服务端 displayBusy 口径）、displayBusy 事件数、eventLoopMaxMs。
期望：B 成交；写窗 P50 ≤ 8s 且 pending 子窗口 ≤1.5s（OQ-3 冻结值）；超限率 0/样本数。

## UAT-AWW-03（SC-03 诚实拒绝）

1. 经 env `LUCY_PUBLISH_WAIT_BUDGET_MS=200`（或 `wait:false` 等价路径）在栈上注入极短等待上限，重启 lucy 容器。
2. A 持窗期间发起 B（role_policy_save）。
期望：B 立即 503，响应含 `code=PUBLISH_COORDINATOR_BUSY`、`Retry-After: 5`、`detail.holder`（kind/operationId/acquiredAt）；消息含可重试指引；不假成功。
3. 超队：`LUCY_PUBLISH_MAX_WAITERS=1` 下第三个并发写立即 503。
4. 还原 env 并重启。
5. 抽样：A 持窗期间 `POST /api/catalog/assets/upload`（manifest_upload，其余 7 类代表）→ 立即 503 忙即拒绝不回归。

## UAT-AWW-04（SC-04 同对象 409）

1. 对同一 `roleId` 以同一 `baseObjectVersion`/`previewToken` 发起重叠创建：A 先提交、B 于 A 持窗期间提交。
期望：B 有界等待后取得锁，触发既有 409（`OBJECT_TARGET_CHANGED`／`ROLE_ID_TAKEN` 族）；前端呈现「对象已被修改」提示且编辑内容不丢失（浏览器侧核对，与 UAT-AWW-08 联动）。

## UAT-AWW-05（SC-05／SC-06 读恢复与读己之写，B1 分支）

1. 单写窗：0.1s 裸轮询 `GET /api/admin/roles`＋真实客户端恢复路径（`displayQueryOptions` 语义：1 次补试、15s 旅程顶、pending 非错误）。期望：单写窗内 0 次无指引错误终态；`pending 子窗口超限率 = 0/样本数`。
2. 重叠写（2× 窗口）：同上轮询。期望：无指引错误终态占比 ≤ 硬阈值 **10%**（每窗口 ≤1 次）；承认可能存在、不承诺消除。
3. 读己之写：创建结算完成后下一次列表读取包含新角色；跨写响应拒绝（write-stale）守卫回归单测绿（`webui/src/__tests__` 既有 apiClient/displayQueryOptions 用例）。

## UAT-AWW-06（SC-07 主路径成交）

- 创建关联 2000 表的角色（RACS 两步）：响应 `status=committed`、`written=true`、`runtimeAck=true`；`/api/health` policy 非 degraded；页面无错误终态。
期望：成立；屏障覆盖至 policy ack（`policyRuntimeAck=true` 即证）。

## UAT-AWW-07（SC-09 纯 MCP 不回归）

1. MCP `initialize` + `tools/list`（隔离栈 proxy）：工具清单含数据面工具；无新增/缺失。
2. `lucy_query` 正常返回（superstore 口径任一确定性查询）；越权 token 的拒绝码不变（403/`FORBIDDEN` 语义）。
期望：与修复前口径一致（记录 tools 数量与拒绝码样本）。

## UAT-AWW-08（SC-10 前台浏览器 E1–E18）

- 真实前台 Chrome 1920×1080（Playwright `headless:false, channel:'chrome'`，`bringToFront`＋visibility/focus 断言）。
- 覆盖 `/admin/roles`（E1–E6）、`/admin/roles/:roleId`（E7–E12）、`/admin/agents`（E13–E18）：创建/编辑/保存即时计时（保存提交→列表/详情呈现新状态的前端耗时），与 API 写窗耗时分列；写窗内页面读取不得出现无重试指引错误终态。
- 证据：截图＋计时 JSON 进 `runs/<date>-<agent>-<short>/`。
