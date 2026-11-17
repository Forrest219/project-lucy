# 错题：客户 K8s 平滑升级后 event loop 卡顿，readyz 超时摘端点，入口 502／503

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-17 |
| 标签 | `ops-delivery` `gate-gap` `ux-regression` `sev-high` |
| 环境 | 客户 K8s 站点 `lucyadm.matrixback.com`；目标版本 **Lucy 0.30.0**，构建 `abb389133356`；平滑升级后回滚。Pod 例：`lucy-5c655c9f77-nnnxx`（Running、RestartCount=0，Ready=False） |
| 相关 | 前序错题 [2026-11-13-audit-read-blocks-event-loop](2026-11-13-audit-read-blocks-event-loop.md)（P1-21）；总账 **P1-39／REQ-030-060**（本事故入池）；延伸线 P1-21／P1-31／P1-32／P1-33；Chart 探针 `deploy/k8s/helm/lucy/values.yaml`（`readinessProbe`→`/api/readyz`，`timeoutSeconds: 3`）；MCP 探针 `webui/server/admin/mcp-runtime.ts`（`KTX MCP probe timed out after ${timeoutMs}ms`，预算 1500ms） |
| 状态 | `open`（根因层＝event loop 持续延迟已核实；**阻塞点函数未定位**；已回滚；登记 ≠ 开发授权） |

## 1. 症状与影响

- 客户 K8s **平滑升级到 0.30.0** 后，进程在跑，但健康态抖动；网关间歇返回 **503**（无后端）与 **502**（网关错误页）。
- Pod **Running 且未重启**，但 `Ready`／`ContainersReady=False`；kubelet 对 `/api/readyz` 在约 18 分钟内累计超时失败百余次（`context deadline exceeded`，探针超时 3s）。
- 容器内手测：`/api/livez` → 200，约 **2.17s**；`/api/readyz` → 200 且 `status=degraded`，约 **7.55s**（远超 3s）。
- `/api/health` 约 90s 采样：503／502 与 `200 ok`／`200 degraded`（`KTX MCP probe timed out after 1500ms`）交替；成功时耗时仍常在 **3.4–5.9s**。
- **影响面**：升级窗口内客户主入口不可稳定使用；现场 **回滚**。属客户可感知的升级事故（`sev-high`）。

## 2. 复现要点（现场判定条件，非本机复现脚本）

在升级后的客户 Pod 上，同窗观测同时成立即可判定为本错题类：

1. `eventLoop` p99（健康载荷内）约 **2210ms**。
2. `/api/livez` 仅返回 `{"ok":true}` 仍要 **1.5–2.2s**（说明延迟在进程调度，不在依赖探测）。
3. `/api/readyz` 实测 **2.4–7.5s**，超过 Helm readiness `timeoutSeconds: 3` → Ready=False → Service 无端点 → OpenResty **503**；网关先超时则 **502**。
4. `/api/health` 每约 5s 的 KTX MCP 后台探针（`initialize`＋`notifications/initialized`＋`tools/list`，总预算 **1500ms**）在 event loop 延迟下超时 → `degraded`；下一轮又可能 `ok` → **抖动**。
5. 执行层／KTX runtime 仍报 healthy；17:40 左右 reload 成功加载连接（现场记 9 个）→ **不是「KTX 没起来」**。
6. `ENOENT`：`/data/lucy/webui/config/data-qa-instructions.md` 仅为旁路提示，**不解释**探针超时。

## 3. 根因

分层（能定的定死；未知显式标出）：

| 层 | 结论 |
|---|---|
| **实现（主因）** | Lucy WebUI **Node.js 事件循环持续被同步工作占住**（现场 p99 ≈ 2.2s）。`/api/livez` 无库／外调仍排队 1.5s+，证明阻塞在本进程。**具体是哪段代码在堵：未知**（health 未暴露阻塞栈／函数名）。 |
| **合同／探针** | P1-21 已拆 `/api/livez` 与 `/api/readyz`，避免「深度健康」杀进程；但 **readiness 仍假设 readyz 能在 3s 内返回**。客户现场 readyz 常 >3s → 摘流量而非杀 Pod（故 RestartCount=0，却对外不可用）。 |
| **误报放大** | 问数 MCP 探针预算 **1500ms** ＜ event loop p99 **2210ms** → 把「循环卡顿」标成「KTX MCP unavailable／health degraded」，掩盖真因并造成 ok↔degraded 抖动。 |
| **数据／规模** | Demo 夹具曾把 livez p99 压到约 **359ms**（P1-21 SC-14）；客户升级现场 **2210ms**。夹具绿 ≠ 客户升级负载下绿。 |
| **环境／交付** | 平滑升级本身把新镜像滚进流量；若新版本在客户规模下循环仍堵，滚动中 Ready 起不来就会出现持续 502／503。回滚正确。 |
| **可排除** | KTX／策略未就绪；单纯「Helm 配错导致进程起不来」；`data-qa-instructions.md` ENOENT 为主因。超时偏紧会放大症状，但 **livez 已 1.5s+** 说明先有应用侧阻塞。 |

与 [2026-11-13 错题](2026-11-13-audit-read-blocks-event-loop.md) 的关系：同属 event loop × K8s 探针家族；彼时是 **liveness 杀 Pod**（0.25、`/api/health` 挂重读）；本次是 **P1-21 减负后仍残留阻塞**，表现为 **readiness 摘端点**（0.30 升级、进程不重启但入口不可用）。**不是「P1-21 完全无效」的否定，而是「demo／夹具收口 ≠ 客户升级可上线」的实锤。**

## 4. 为何漏检

1. **UAT／门禁停在 demo 与合成夹具**：`UAT-SUITE-EVENT-LOOP-RELIEF` 必做 PASS、PAGE-SWEEP 整改后夹具无越线；可选客户 LOOP-05 长期 BLOCKED；**没有「客户 K8s 平滑升级后 livez／readyz／eventLoop 同窗门槛」硬门禁**。
2. **功能合同收口被误读成升级安全**：P1-21「功能合同已收口」＋ livez p99 359ms 只证明开发机夹具；总账已写 ≠ 可上线，但客户升级路径未强制再过同一数字。
3. **探针家族只防「杀进程」、未防「摘流量」**：拆 livez 后 RestartCount 可长期为 0，对外仍 503——监控若只看重启会漏报。
4. **health degraded 文案指向 KTX MCP**：运维易先查执行层；真因在 event loop，缺少「阻塞点／栈」字段。
5. **2026-11-16 真实环境不稳证据（总账 v0.96）未升级为升级阻断项**：曾记审计页挂起／health 超时且未区分链路 vs 循环；本次升级仍推进，缺口未闭合。

## 5. 举一反三

1. **客户 K8s 平滑升级验收必须同窗量三条：`/api/livez` 耗时、`/api/readyz` 耗时、`eventLoop.p99Ms`。** 任一经常越过 Chart `timeoutSeconds`（现行 3s）或 P1-21 livez 门槛（p99 ≤ 400ms），不得宣称该构建可升级。
2. **demo／合成夹具 PASS ≠ 客户升级放行。** 夹具绿只能收口功能合同；客户升级另要维护窗或等价负载证据。
3. **Ready=False 且 RestartCount=0 仍是 sev-high。** 摘端点与杀 Pod 对用户一样是不可用；告警不能只盯重启。
4. **内部依赖探针预算不得小于已知 event loop p99。** 否则会把循环卡顿误报成下游挂了，干扰排障。
5. **health／readyz 须能指向「循环延迟」并（在后续实现里）暴露阻塞线索。** 禁止只有 `KTX MCP probe timed out` 而无线索。
6. **改探针路径或减负后，必须回归「升级滚动中 readyz 是否稳定进 Ready」。** 只验单次 curl 200 不够。
7. **登记本错题 ≠ 授权改超时或改代码。** 放宽 `timeoutSeconds`、定位阻塞点、改 MCP 探针语义均须另开 Spec／总账授权。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 现场回滚 | 完成 | 客户侧已回滚；本条不记录回滚步骤细节 |
| 错题本登记（本文件）＋索引 | 完成 | 委托人 2026-11-17 要求复盘入错题本 |
| 入 0.30 总账 **P1-39／REQ-030-060** | 完成 | 事故修复行；**入池 ≠ 立项 ≠ 开发授权** |
| 定位阻塞同步路径（栈／采样／候选热点） | 未开 | 须授权后的只读取证或开发；登记 ≠ 授权 |
| 写 Spec／Plan（残余 event loop × 升级探针） | 未开 | 待委托人立项／确权 |
| 升级门禁：客户或等价负载下 livez／readyz／eventLoop | 未开 | 补 gate／UAT；与 P2-4／P2-5 相邻但本条先盯产品侧阻塞 |
| 复评内部 MCP 探针 1500ms 与 degraded 语义 | 未开 | 避免循环卡顿误报为 KTX 挂 |
| 关闭本错题（`closed`） | 未开 | 须客户升级窗复测通过且根因处置闭合 |

## 7. 证据指针

- 现场诊断截图（会话附件，未入库）：Pod NotReady＋readyz 超时统计；health 90s 采样表；event loop p99≈2210ms；容器内 livez／readyz 手测。
- Chart 探针默认：`deploy/k8s/helm/lucy/values.yaml`（startup／readiness→`/api/readyz`，liveness→`/api/livez`，`timeoutSeconds: 3`）。
- MCP 探针超时文案：`webui/server/admin/mcp-runtime.ts`。
- event loop 快照：`webui/server/runtime/event-loop-delay.ts`（经 `/api/health` 等暴露）。
- 前序减负合同与夹具证据：[P1-21 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md)；[性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md)；[UAT EVENT-LOOP](../qa/uat/suites/event-loop-relief/suite.md)。
- 总账延伸：P1-31／32／33；真实环境不稳追加证据见总账变更 v0.96。
