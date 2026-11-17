# 推断问询补算让出事件循环 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-17／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-38**／REQ-030-059／**P1**（事故修复）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | **v0.2-draft。推断问询补算按 400 行一页读取、按 25 个问询一片写入。读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前各让出一次事件循环，已排队的宏任务先于下一段同步工作运行。本次读取冻结到开始时该用户回看窗口内的最大 access_log.id。问询编号在该删除事务内按簇顺序分配，已有 correlation_key 沿用。来源查询按 500 个 id 一段。重算先按即将写入的 inferred_turn_id 删除残留行。补算期间再次标脏的用户留到下一轮。400 行和 25 簇是条数上界，单段仍可能超过探针的 3 秒。工作区已有实现与 vitest。终稿未确权。测试台 not_registered。不入核心分母。≠ 可上线** |
| 决策来源 | 2026-11-17 客户站点升到 `0.30.0`（构建 `abb389133356`）后再回滚。约 90 秒采样：`/api/health` 在 ok 与 degraded 之间来回，耗时 3.4–5.9 秒；degraded 原因为 `KTX MCP probe timed out after 1500ms`；`/api/livez` 稳定 1.5–1.7 秒；`/api/readyz` 三次为 2.4／3.8／5.5 秒。事件循环 p99 约 2.2 秒。问数进程已加载 9 个连接，策略与 KTX 运行时健康。委托人要求补算不影响健康检查 |
| 需求来源 | 客户管理入口间歇 503／502；本仓库 `rebuildInferredTurns` 在 P1-21 之后仍按用户整段同步重建 |
| 实施主体 | WebUI 服务端 `webui/server/proxy/audit.ts`（`rebuildInferredTurns`）。不改 Helm 探针超时，不改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 [P1-21](lucy-20261113-heavy-read-path-and-probe-relief-spec.md)：读路径默认不重建，后台维护器仍按用户调用 `rebuildInferredTurns`。本条只把**单个用户**的重建从一次同步事务改成分页与分片。不改 Spec 172 的 30 天回看、聚类间隙、问询编号稳定性。不改 Chart 探针路径与超时。不启用 worker |
| 实施计划 | [`docs/plans/lucy-20261117-inferred-turn-rebuild-yield-plan.md`](../plans/lucy-20261117-inferred-turn-rebuild-yield-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.2-draft | 闭合过程对抗 R1。条数分片不再写成时间保证；读取冻结最大 id；编号在删除事务内一次分配；来源查询按 500 个 id 分段；按即将写入的 id 删除残留；补算期间再次标脏的用户留到下一轮。终稿未确权 |
| v0.1-draft | 初稿。补记 2026-11-17 已落入工作区的分页读取与分片写入。终稿未确权。测试台 not_registered |

## 闭口层级

- 层级：功能合同
- 本条承诺：后台补算近 30 天推断问询时，单个用户的重建在读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前让出事件循环，已排队的宏任务先于下一段同步工作运行。本次读取冻结到开始时的最大 `access_log.id`。问询编号在该删除事务内按簇顺序分配，已有 correlation_key 沿用。来源查询按 500 个 id 一段。重算会先删掉即将写入的 `inferred_turn_id`。补算期间再次标脏的用户留到下一轮。400 行和 25 簇是条数上界，单段仍可能超过探针的 3 秒。
- 本条出口：SC-01–SC-10。
- 不在本条出口：客户现场再升级、网关 502／503 的现场复测、Helm 超时调整、worker 线程、访问日志页面文案、其他同步 SQLite 路径（安全投影追赶、导出、概览）。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

本条不新增用户可见文案。探针路径与超时保持 P1-21 已交付的值。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 不新增页面、按钮、颜色或间距
- [ ] 只改推断问询后台重建的服务端调度
- [ ] 不新增用户可见错误文案

### Exceptions (If Any)

- None

### Follow-up Needed

- 单个用户补算的删除与写回之间，访问日志上该用户窗口内的推断问询会短暂缺一截。补完即恢复。是否在页面上提示「问询补算中」，另立 UX 条目

## 交互合同豁免

- 原因：本条只改服务端推断问询补算的分片，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/admin/audit/turns` 既有字段的含义；`/api/livez`、`/api/readyz`、`/api/health` 的路径、超时和响应字段

## 1. 问题陈述

P1-21 把推断问询重建移出读请求，改由后台维护器按用户调用 `rebuildInferredTurns`。用户与用户之间会让出事件循环。**单个用户内部仍是一次同步工作**：读出该用户回看窗口内的全部 `access_log`，在内存里聚类，再在一个 `better-sqlite3` 事务里删除并重写该窗口的推断问询。

客户规模下，这一个用户的事务会长到约 2 秒。事件循环被占住时：

| 观察 | 原因 |
|---|---|
| `/api/livez` 约 1.5–1.7 秒才返回 `{ ok: true }` | 请求在队列里等当前事务结束。Chart 存活探针超时 3 秒，Pod 尚未被杀掉 |
| `/api/readyz` 出现 3.8 秒、5.5 秒 | 排队之外还要读项目配置与执行层状态。超过就绪探针 3 秒的次数会把 Pod 移出 Service，入口返回 503 |
| `/api/health` 在 ok 与 degraded 之间来回，degraded 写着 KTX 探针 1500 毫秒超时 | 后台探针每 5 秒向本机 KTX 发 `initialize`、`notifications/initialized`、`tools/list`，整段预算 1500 毫秒。循环正被占住时闹钟先到期。下一次落在空档里则回到 ok |
| 问数进程本身正常 | 同一窗口内执行层重载已加载连接；策略与 KTX 运行时为健康。循环空着时三次探针能在预算内回来 |

因此同一构建再升级一次，只会把近 30 天的用户重新排队，入口空窗会再出现。

## 2. 目标

1. 单个用户的重建按固定页读取调用记录，按固定片写入问询。读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前各让出一次。
2. 每次让出先放行已经排队的宏任务，再开始下一段同步工作。存活探针、就绪探针和 KTX 探针属于这类宏任务。400 行和 25 簇只限制条数，不保证每一段短于 3 秒。
3. 本次读取冻结到开始时该用户回看窗口内的最大 `access_log.id`。此后新插入的行不进入这一次重建，由维护器留到下一轮。
4. 问询编号在删除事务内按簇顺序一次分配。已有 `correlation_key` 沿用。事务提交之后、片与片之间再出现的新编号不会插进这一批已经分好的号。
5. 读路径默认仍不重建。环境变量 `LUCY_TURN_REBUILD_ON_READ=1` 仍只作为事故回退。
6. 不改探针超时，不引入 worker，不改 KTX。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 加长 Helm 探针超时 | 超时短于占用只是症状。加长超时不能让入口在补算时保持可应答 |
| 默认引入 worker | P1-21 的 O1 仍有效。本条用分片让出解决这一处占用 |
| 改变 30 天回看、120 秒聚类间隙或问询编号分配规则 | Spec 172 与问询序号合同不变 |
| 在删除旧问询之前先写新问询再交换 | 本条接受「先删窗口、再分片写回」。中途进程退出时，维护器下次仍会把该用户标脏并重算 |
| 客户现场 503／502 复测作为本条出口 | 归发布取证。测试台当前 not_registered |
| 治理安全投影、导出、概览等其他同步 SQLite | 那些路径各自有 P1-32／P1-33。本条只覆盖推断问询补算 |

## 4. 设计

### 4.1 读取

开始时记下该用户回看窗口内的 `MAX(id)`。分页条件是 `user_id = ? AND ts >= 回看起点 AND id <= 该上限`，按 `(ts, id)` 升序键集。每页 `INFERRED_REBUILD_LOG_PAGE = 400` 行。第一页之前不让出；此后每一页之前让出一次。读完后再让出一次。空页结束。

上限之后新插入的行留到下一轮。页内列与改前一次 `SELECT` 相同：`id`、`ts`、`tool`、`tables`、`args_summary`、`policy_version`、`permission_snapshot_hash`、`lucy_session_id`、`lucy_turn_id`、`client`、`client_version`、`user_agent`。

### 4.2 聚类

全部页读完并让出之后，仍用现有规则聚类：协议方法与已带 `lucy_turn_id` 的行不进业务簇；业务行按会话与间隙拆簇；握手行挂到该会话最早的业务簇；只有握手的会话单独成访次。聚类是一段连续的内存工作。聚类后再让出一次。

### 4.3 写入

1. 一个短事务：补齐问询序号回填；删除该用户回看窗口内的 `inferred_turn_access_logs` 与 `inferred_turns`；再按即将写入的 `inferred_turn_id` 各删一次，覆盖 `started_at` 已经掉出窗口、主键却还在的残留行；按簇顺序为每个 id 做 `lookup`，没有则 `allocate`。
2. 该事务提交后再让出一次。
3. 按 `INFERRED_REBUILD_CLUSTER_SLICE = 25` 个簇一片写入。第一片紧接上一次让出；此后每片之前再让出一次。每一片是自己的事务，使用已经分好的编号。
4. 来源查询按 `INFERRED_REBUILD_SOURCE_CHUNK = 500` 个 `access_log.id` 一段，避免单个 `IN` 撞上 SQLite 变量上限。
5. `better-sqlite3` 的事务回调不能中途 `await`。让出只发生在已提交的事务之外。

`yieldToEventLoop` 在 `MessageChannel` 回调里再排一次 `setImmediate`，已经排队的宏任务先于下一段同步工作运行。Vitest 假时钟会吞掉 `setImmediate`，假时钟下仍在回调里结束等待。

### 4.4 维护器

启动时扫描回看窗口内的用户，用户之间让出，每 10 秒把水位之后有新调用的用户标脏。一次重建开始时记下该用户的脏标记代次。重建成功后，只有代次没变才清除脏标记。重建期间的轮询或 `markDirty` 会增加代次，该用户留到下一轮。失败仍保留脏标记并退避。

## 5. 核心流程（伪代码）

```text
rebuild(userId, lookback):
  cutoff = now - lookback
  ceiling = max id of access_log where user_id = userId and ts >= cutoff
  rows = []
  cursor = (ts: "", id: 0)
  pageIndex = 0
  loop:
    if pageIndex > 0: yield          # 已排队的宏任务先运行
    page = select access_log
            where user_id = userId and ts >= cutoff and id <= ceiling
              and (ts > cursor.ts or (ts = cursor.ts and id > cursor.id))
            order by ts, id
            limit 400
    if page is empty: break
    append page to rows
    cursor = last row of page
    if page.length < 400: break
    pageIndex = pageIndex + 1
  yield

  clusters = cluster(rows)
  yield

  transaction:
    ensure inquiry backfill
    delete links and turns for userId where started_at >= cutoff
    for cluster in clusters:
      delete residual rows with this inferred_turn_id
      inquiry[id] = lookup(id) or allocate(id)
  yield

  for start in 0, 25, 50, ... while start < clusters.length:
    if start > 0: yield
    transaction:
      for cluster in clusters[start : start+25]:
        write cluster using inquiry[id]
        sources are queried 500 ids at a time

  return written count
```

失败分支：某一页或某一片抛错时，函数把错误抛给维护器。维护器保持该用户为脏，下一轮重算。已提交的删除不会回滚。重算按当前 `access_log` 和即将写入的 id 再删再写。补算期间新出现的调用不进本次的 `ceiling`，代次变化会把该用户留到下一轮。

## 6. 验收

| 编号 | 承诺 | 打假 |
|---|---|---|
| SC-01 | 调用行数超过 400 时，调用前排队的宏任务在重建结束前运行，并且先于让出之后的下一段同步工作 | `webui/server/__tests__/proxy-audit.test.ts`：`rebuildInferredTurns yields between pages so a queued macrotask runs before the rebuild finishes` |
| SC-02 | 冻结输入上的问询条数、关联行数与一次聚类一致；再次重建的 `inferred_turn_id` 集合不变 | 同一测试断言 401 行、1 个问询、关联行数等于行数、二次重建 id 相同。既有聚类用例保持通过 |
| SC-03 | 问询编号在删除事务内按簇顺序分配；已有 correlation_key 沿用；片间新编号不插进这一批 | `rebuildInferredTurns ignores rows inserted after the id ceiling and keeps inquiry numbers across a slice yield`：26 个新簇得到 1–26，片间插入的编号是 27 |
| SC-04 | 条数上界是一页 400 行或一片 25 个簇。这不是 3 秒时间保证。聚类、单页读取、单簇插入仍各是一段连续同步工作 | 常量 `INFERRED_REBUILD_LOG_PAGE`、`INFERRED_REBUILD_CLUSTER_SLICE`。读完、聚类后、删除事务后、后续每片前都有让出 |
| SC-05 | 读路径默认不因本条恢复逐用户重建 | `LUCY_TURN_REBUILD_ON_READ` 未设置时，`listAuditTurnEntries` 不调用 `rebuildInferredTurnsDebounced`。本条不改这个开关 |
| SC-06 | 探针预算保持 P1-21 | 不改 `/api/livez`、`/api/readyz` 的路径，不改 Chart 的 period、timeout、failureThreshold，不改 KTX 探针 1500 毫秒预算 |
| SC-07 | 上限之后插入的行不进本次重建，下一次重建会带上 | 上表同一测试：让出时插入的行本次关联数为 0，第二次重建后关联数为 1 |
| SC-08 | `started_at` 已掉出回看窗口、问询 id 仍落在窗口内时，重算替换该行，不撞主键 | `rebuildInferredTurns replaces a turn whose started_at has left the lookback but whose id is still in it` |
| SC-09 | 来源查询按 500 个 id 一段 | 常量 `INFERRED_REBUILD_SOURCE_CHUNK`。单簇超过 SQLite 变量上限时不再因一条 `IN` 失败 |
| SC-10 | 补算期间再次标脏的用户在成功结束后仍然待补算，下一轮会再跑 | `webui/server/__tests__/event-loop-relief.test.ts`：`keeps a user dirty when a newer call is polled during that user's rebuild` |

## 7. 风险

| 风险 | 处理 |
|---|---|
| 先删后写的窗口里，该用户的推断问询短暂不可见 | 接受。补完即恢复。页面提示另立条目 |
| 进程在片与片之间退出 | 维护器下次重算。编号已写入 `inquiry_correlation_serial` 的键沿用。残留主键按即将写入的 id 删除 |
| 单页、单簇插入或聚类本身仍可能长于 3 秒 | 接受。条数上界不是时间保证。现场仍超时则另立条目 |
| 上限之后的新调用要等下一轮 | 接受。维护器代次把该用户留在脏集合里 |
