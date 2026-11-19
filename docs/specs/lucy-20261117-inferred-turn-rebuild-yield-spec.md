# 推断问询补算让出事件循环 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-17／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-38**／REQ-030-059／**P1**（事故修复）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | 主体 v0.2-draft 终稿未确权；§8 v0.4 已确权并实现，O3 存量批量标脏延后、未授权。2026-11-19 同镜像真实时钟局部唯一归属满足预期，但 SC-12／15／16 完整出口未齐，SC-16 满量与探针补偿未验，P3 的 ↓ 保留，§8 未收口。§8.9 补验及 P1-57 计划已由委托人确认并授权 Task 1–7（2026-11-19）；实施中，尚未验收。测试台判定见 INDEX；≠ 可上线。 |
| 决策来源 | 2026-11-17 客户站点升到 `0.30.0`（构建 `abb389133356`）后再回滚。约 90 秒采样：`/api/health` 在 ok 与 degraded 之间来回，耗时 3.4–5.9 秒；degraded 原因为 `KTX MCP probe timed out after 1500ms`；`/api/livez` 稳定 1.5–1.7 秒；`/api/readyz` 三次为 2.4／3.8／5.5 秒。事件循环 p99 约 2.2 秒。问数进程已加载 9 个连接，策略与 KTX 运行时健康。委托人要求补算不影响健康检查 |
| 需求来源 | 客户管理入口间歇 503／502；本仓库 `rebuildInferredTurns` 在 P1-21 之后仍按用户整段同步重建 |
| 实施主体 | WebUI 服务端 `webui/server/proxy/audit.ts`（`rebuildInferredTurns`）。不改 Helm 探针超时，不改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 [P1-21](lucy-20261113-heavy-read-path-and-probe-relief-spec.md)：读路径默认不重建，后台维护器仍按用户调用 `rebuildInferredTurns`。本条只把**单个用户**的重建从一次同步事务改成分页与分片。不改 Spec 172 的 30 天回看、聚类间隙、问询编号稳定性。不改 Chart 探针路径与超时。不启用 worker |
| 实施计划 | [`docs/plans/lucy-20261117-inferred-turn-rebuild-yield-plan.md`](../plans/lucy-20261117-inferred-turn-rebuild-yield-plan.md) |
| §8 修订（已确权） | 主体 v0.2-draft 终稿未确权；§8 v0.4 已确权并实现，O3 存量批量标脏延后、未授权。2026-11-19 同镜像真实时钟局部唯一归属满足预期，但 SC-12／15／16 完整出口未齐，SC-16 满量与探针补偿未验，P3 的 ↓ 保留，§8 未收口。§8.9 补验及 P1-57 计划已由委托人确认并授权 Task 1–7（2026-11-19）；实施中，尚未验收。测试台判定见 INDEX；≠ 可上线。 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.4 | 2026-11-19 12:35 §8 定稿：委托人明示终稿确权＋整批开发授权，未做 Codex 复审。本条出口扩为 SC-01–SC-16。O3 仍延后。实现未开始；不是 UAT PASS；≠ 可上线 |
| v0.4-draft | 按 Codex 终审修订 §8：①新增 SC-16 规模与探针门槛（收口前置，复用 P1-47 满量夹具，过不了不收口）；②P3 画像由 ＝ 改为「↓（待实测）」，补偿挂 SC-16；③SC-15 新用例须断言唯一归属／编号沿用／闭包外不动；④受控降级授权口径统一；⑤出口扩展（SC-01–SC-16）留待终稿确权时同步。**仍为草案，终稿未确权** |
| v0.3-draft | 新增 §8：跨回看边界的簇保持同一问询、一次调用至多属于一个问询（I1–I4）、SC-11–SC-15、决策点 O1–O3。**仅文档，未确权，开发未授权。** 不改 SC-01–SC-10 与现行状态行 |
| v0.2-draft | 闭合过程对抗 R1。条数分片不再写成时间保证；读取冻结最大 id；编号在删除事务内一次分配；来源查询按 500 个 id 分段；按即将写入的 id 删除残留；补算期间再次标脏的用户留到下一轮。终稿未确权 |
| v0.1-draft | 初稿。补记 2026-11-17 已落入工作区的分页读取与分片写入。终稿未确权。测试台 not_registered |

## 闭口层级

- 层级：功能合同
- 本条承诺：后台补算近 30 天推断问询时，单个用户的重建在读完、聚类之后、删除并分配编号之后、以及后续每一片写入之前让出事件循环，已排队的宏任务先于下一段同步工作运行。本次读取冻结到开始时的最大 `access_log.id`。问询编号在该删除事务内按簇顺序分配，已有 correlation_key 沿用。来源查询按 500 个 id 一段。重算会先删掉即将写入的 `inferred_turn_id`。补算期间再次标脏的用户留到下一轮。400 行和 25 簇是条数上界，单段仍可能超过探针的 3 秒。
- 本条出口：SC-01–SC-16（SC-11–SC-16 为 §8（2026-11-19）新增；SC-16 规模与探针门槛为收口前置）。
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

## 8. 滚动窗口边界的簇归属（2026-11-19 补记，v0.4；已确权，开发授权已获得；实现未开始）

> 本节是已确权的合同修订（委托人明示终稿确权，2026-11-19），**不改 §1–§7、不改 SC-01–SC-10 的现行验收；开发授权已获得，见头部「状态」行**，实现未开始。本条与 [Spec 172](../../webui/docs/172-audit-session-visit-spec.md) SC-2（同一簇重新过滤后问询 id 不变）同向，是恢复该合同在滚动窗口上的成立，不是新能力。

### 8.1 偏差事实（本机 L1，真实 SQLite＋真实 `rebuildInferredTurns`＋真实 Fastify 路由；时钟为假时钟，不含真实 30 天等待）

场景：同一用户两次调用相隔 40 秒（同会话，小于 120 秒聚类间隙），首次重建把它们聚成一个问询；之后时钟前进 30 秒，使第一次调用越过 30 天回看边界、第二次仍在窗口内；再写入一条新调用并再次重建。

| 代码 | 结果 |
|---|---|
| 候选 `3b1c62af` | **红**。第二次调用同时关联 `inf_rolling_1`（调用数 2）与 `inf_rolling_2`（调用数 1）；两条问询详情接口均 200，问询号分别为 1／2；调用呈现只显示问询 1；重建状态仍标 `complete` |
| 3a9 `3a9f0711`（客户基线） | **红**，现象相同（两条关联、详情均 200）。说明该缺陷不是 0.30 新引入 |
| 84 `84becc34` | **绿**。问询 1 保留调用数 2，第二次调用只关联问询 1，不产生 `inf_rolling_2` |

机制：窗口内重建只读取 `ts >= cutoff` 的调用，并只删除 `started_at >= cutoff` 的旧问询。簇越过边界后，旧簇（`started_at < cutoff`）既不被删也不被重算；窗口内那部分调用被当作新簇再分配一个问询号。结果是同一次调用落在两个问询里。原始调用 `access_log` 三行均保留，缺陷在归属，不在原始数据。

84 的做法是把读取与删除起点按「区间闭包」向前延伸：只要存在 `started_at < cutoff 且 ended_at >= cutoff` 的已有问询，就把 `cutoff` 取到它的 `started_at`，重复到没有跨界问询为止。

证据：`inbox/uat-fde-3b1c62af-2026-11-19/l1/audit01-{cand,3a9,84}.log`；代码 `webui/server/proxy/audit.ts`（`rebuildInferredTurns`：约 2672 行 `cutoff`、2879 行 `started_at >= ?` 的删除范围）；84 对应 `crossingWindow`（约 2635–2644 行）。工作区已有被跳过的同类测试 `webui/server/__tests__/upgrade-fix-regressions.test.ts`「preserves the inquiry and unique links when a cluster straddles the rolling cutoff」（`it.skip`，第 78 行，跳过理由写的是「断言与当前重建不一致」）。

### 8.2 合同

| 编号 | 合同 |
|---|---|
| I1 | **唯一归属**：任一次重建结束后，用户窗口内的每一条 `access_log` 在关联表里至多属于一个推断问询 |
| I2 | **跨界簇整体保留**：窗口内重建遇到跨回看边界的已有问询时，读取与删除的起点同步延伸到该问询的开始（区间闭包，直到没有跨界问询）。该问询沿用原 `correlation_key` 与问询号，窗口内新增成员并入该簇，不新建问询。**不改** 30 天回看参数、120 秒聚类间隙与问询编号规则 |
| I3 | **三处一致**：关联表、问询详情接口、调用呈现对同一次调用给出同一个问询；详情接口不得出现「同一调用 id 同时列在两个问询」 |
| I4 | **原始调用不丢**：重建不删除、不改写 `access_log`；窗口之外只有跨界问询的成员会被重新读取，其他窗口外问询不动 |

边界说明：闭包只处理**已存在**的跨界问询。若旧问询在窗口之外已结束（`ended_at < cutoff`），之后到达的新调用即使与其相距不足 120 秒，也形成新问询。这与「窗口外历史不重新合并」一致，不在本条出口（见 §8.7）。

### 8.3 核心流程（伪代码，只写与 §5 的差异）

```text
rebuildInferredTurns(user):
  cutoff = now - lookbackHours
  # 新增：区间闭包
  loop:
    crossing = min(started_at) over inferred_turns of user
               where started_at < cutoff and ended_at >= cutoff
    if crossing is none: break
    cutoff = crossing            # 严格变小，已有问询有限，必终止
    yield

  ceiling = max(access_log.id) where user and ts >= cutoff      # 冻结，沿用 §4.1
  read pages with ts >= cutoff and id <= ceiling                 # 沿用 400 行页读取
  clusters = cluster(rows, gapMs)
  delete inferred_turns with started_at >= cutoff                # 与读取同一个 cutoff
  assign numbers (reuse existing correlation_key)                # 沿用 §4.3
  write clusters in slices of 25                                 # 沿用 §4.3
```

### 8.4 验收

| 编号 | 承诺 | 打假 |
|---|---|---|
| SC-11 | 跨界簇不产生第二个问询：上述场景重建后，第二次调用只关联 1 个问询，该问询仍是问询 1、调用数 2；窗口内新写入的调用另成问询 | 复活 `upgrade-fix-regressions.test.ts` 第 78 行用例（只按当前重建 API 形状改接线，**不降低断言**）；并以 FDE `audit-rolling-window.mts` 的场景写成假时钟 vitest。红→绿对照候选 |
| SC-12 | 详情接口与调用呈现一致：对关联表里该调用的每个问询 id 请求详情，列出该调用的问询恰为 1 个；调用呈现的问询号等于该问询号 | 同一用例继续断言 HTTP 详情与 `presentCallRows`（候选现状：详情 2 个均 200，呈现只显示 1） |
| SC-13 | 原始调用保留：重建前后 `access_log` 行数与内容不变 | 同一用例断言三行调用均在 |
| SC-14 | 存量重复自愈：把候选 AFTER 状态（`inf_rolling_1` 含调用 1、2，`inf_rolling_2` 含调用 2）作为种子，再重建一次后每个调用至多一条关联、`inf_rolling_2` 消失，幸存问询号不变 | 新增 vitest 以直接种子写入关联表；**自愈是推断，未经实测，须由本用例证实或证伪** |
| SC-15 | 回归：30 天回看、120 秒间隙、问询编号不变；多个相互重叠的跨界问询时闭包终止且不把交错会话切成两半。新用例必须断言唯一归属、编号沿用、闭包外问询不被删，不能只凭函数返回判通过 | SC-01–SC-10 既有用例保持通过；新增交错会话闭包用例（84 没有对应用例，只有 straddle 一条，故为新增） |
| SC-16 | **规模与探针门槛（收口前置，不是批量标脏授权）**：复用 P1-47 现有满量夹具，构造多级跨界与交错会话的闭包，断言：闭包终止、读取集合精确、闭包外问询不被删、既有页预算与写片预算仍生效，并达到 P1-47 的 `livez`／`readyz` 门槛（以该 Spec 现行阈值为准）。**任一门槛不过则不得收口**，回到设计裁决（O2 已否决，需重新评估方案），不得只记慢日志 | 本机 vitest（规模夹具）＋ P1-47 既有探针套件复跑；数值阈值引用 [P1-47 Spec](lucy-20261118-rebuild-probe-budget-spec.md)，不在此另写 |

证据等级：SC-11–SC-16 为本机 vitest（假时钟，**不是 30 天真实等待**），属 L1，**不得写成 UAT PASS**。测试台（`docs/qa/uat/INDEX.md`）有共享套件 `UAT-SUITE-FDE-PACKCHECK`（NOT RUN）。若要真实时钟复现，可用既有 `LUCY_TURN_INFER_LOOKBACK_HOURS` 缩短回看窗口：委托人 2026-11-19 已授权，条件是**先尝试真实构造，做不到再降级，INDEX 标「受控降级」，不与全真 PASS 混写**。

### 8.5 决策点（委托人 2026-11-19 批准建议：O1、O2 已闭合，O3 延后且未授权；终稿已确权）

| 编号 | 问题 | 裁定 |
|---|---|---|
| O1 | I2 会把读取起点延伸到跨界问询的开始，措辞上触及本 Spec §3 Non-Goals「不改 30 天回看」。是否接受「回看窗口决定哪些簇被维护，跨界簇整体保留」这一解释 | **接受（已批准）**：回看参数不变，只保证簇不被腰斩；否则无法满足 I1 |
| O2 | 备选 B：不延伸读取，而是在写入时排除已归属于旧问询的调用 id | **否决（已批准）**：跨界簇的窗口内新成员无法并入原问询，问询调用数与时长失真 |
| O3 | 存量客户库可能已有重复关联。是否在升级后主动标脏全部用户，使其在下一轮维护中自愈 | **待定（已批准的处理方式）**：先由 SC-14 证实自愈成立；同时核查升级后哪些用户会被标脏（现行标脏触发条件）；标脏全部用户会带来一次全量重建，须评估与 P1-39／P1-47 的页预算。两项结论齐备前不做批量修复 |

**实现路径（已批准的方向）**：I2 的实现优先移植 84 的 `crossingWindow` 区间闭包，不整枝合入 84。

### 8.6 受影响画像（事实源 [`user-personas.md`](../governance/user-personas.md)）

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 无直接触点 | 不变 | ＝ | 只改后台重建的归属规则，不触碰问数路径 | — |
| P2 治理方 | 审计页同一次调用可同时出现在两个问询里，问询数与调用数对不上 | 每次调用只属于一个问询，跨回看边界的问询保持原编号 | ↑ | SC-11／SC-12 | — |
| P3 运维方 | 重建「完成」但归属已重复，无告警 | 重建后归属唯一；**后台重建读取范围与工作量在存在跨界问询时变大**（按已有重叠问询的连通块向前延伸，**上界未实测**） | **↓（待实测）** | SC-16（规模与探针门槛）；SC-15（闭包终止）。SC-16 通过并有数据后，再重判为 ＝ 或保留 ↓ | 读路径默认不触发重建（`LUCY_TURN_REBUILD_ON_READ` 未设置，SC-05）；重建只在后台维护器里运行，不在问数主路径上；读取页预算、让出点与 off-thread 写入沿用现状；SC-16 不过不收口 |
| P4 管理层 | 按问询统计取证对象时重复计数 | 统计与调用一一对应 | ↑ | SC-12 | — |

### 8.7 不在本条出口

窗口外已结束问询与新到调用的重新合并；真实 30 天等待的 UAT；客户库存量数据的批量修复与标脏策略（O3 未决前不排期）；访问日志页面文案；客户环境；证据等级。本条收口不表示可上线。

### 8.8 Terminology Compliance 补记

本节不新增用户可见文案。「问询」「调用」沿用 `webui/docs/00-product-terminology-standard.md` 现行用词。


### 8.9 修复复评补验（委托人已确认；不改既有 SC 编号与阈值）

总账 P1-57-G2／REQ-030-078；[整改 Plan](../plans/lucy-20261119-fde-acceptance-remediation-plan.md)。现有 5 条测试绿不等于 SC-11–SC-16 所有出口齐备。真实 35 秒独立 Docker 局部场景满足唯一归属、编号保持、原始调用保留，仍不代替下表全部检验。

| 现有编号 | 必须补齐的检出条件 | 不得作为替代 |
|---|---|---|
| SC-12 | 真实详情 HTTP 对该调用关联的每个问询请求详情，实际出现此调用的详情恰为 1；`presentCallRows` 的问询号与其一致 | 仅注释写编号、只查关联表、只测空库 count=0 |
| SC-15 | 显式预置多个交错会话的现存跨界问询与关联；闭包确实向前扩展多级；唯一归属、沿用编号，闭包外既有问询及其关联逐行保持 | 只插入调用、不插入现存问询；只断言旧调用未新建关联 |
| SC-16 | 固定 P1-47 满量合成夹具规模，不降样本；预置多级跨界问询，校验闭包终止与精确读取集合、闭包外既有问询／关联未删、页与写片预算生效。相同干净候选执行 P1-47 套件至少 3 次独立冷启动，各就绪后 120 秒；门槛沿用其 Spec（livez max≤1000ms／p99≤400ms，readyz p99≤1500ms，3 秒观察器连续失败<6），不改默认维护器 | 6 条小样本、小样本总耗时<10秒、历史旧镜像 RPB PASS、靠暂停默认维护器或增加探针超时求绿 |

本条 SC-16 仍为功能收口前置；本轮已确认并授权实现测试及规模探针，尚未验收。发现运行合同失败只修本条，涉及 P1-47／50 新算法或 O3 批量标脏时返回范围裁决。P3 运维方的 `↓（待实测）` 保留，其补偿仍挂 SC-16；过不了不改判、不收口。其余画像沿用 §8.6，不用小样本通过掩盖负向补偿未验。
