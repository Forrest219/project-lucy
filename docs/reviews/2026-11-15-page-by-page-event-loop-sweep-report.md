# 全页面事件循环与探针风险排查报告（P1-31）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 全页面事件循环与探针风险排查报告 |
| 文档类型 | Review |
| 版本 | v1.2 |
| 撰写日期 | 2026-11-15 |
| 撰写人 | Claude（Cursor） |
| 委托人 | xingchen |
| 基于材料 | [排查 Plan](../plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md)；`webui/scripts/page-event-loop-sweep.mts` 三轮运行（全量、补测、UI 使用记录补灌）及 2026-11-15 夜间补账本夹具后的两次完整复跑（空基线、`sweep:event-loop:gate`）；`inbox/page-event-loop-sweep*.json`；[O1 复评](2026-11-15-p1-21-o1-worker-thread-reassessment.md)；[P1-21 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) |
| 适用范围 | P1-31／REQ-030-052 的只读排查结论与越线清单。**不含开发授权，不是 UAT** |
| 输出位置 | `docs/reviews/2026-11-15-page-by-page-event-loop-sweep-report.md` |

## 1. 结论

> **v1.2（2026-11-16）整改后复跑**：委托人 2026-11-15 23:47 授权开发落地（P1-32／P1-33）。下文 v1.1 的数字是**整改前**的事实，保留作对照；整改后同一把尺子复跑（`UAT-SUITE-PAGE-SWEEP` 跑次 [2026-11-16-claude-page-sweep-after-fix](../qa/uat/suites/page-event-loop-sweep/runs/2026-11-16-claude-page-sweep-after-fix.md)）：125 路由 **96 通过、0 越线、0 失败、25 未测**；43 页 40 通过、3 未测。F-1 单次 115 秒→约 0.8 秒；F-6 不再撞 SQLite 变量上限，改为夹具缺派生列的 409，转入未测；`governance/overview` p99 372ms 贴线。输出等价由 [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md) 守。Spec：[lucy-20261115-audit-export-scale-and-equivalence-guard-spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)。**≠ 可上线；复跑复用了此前拷出的项目副本，不是现拷。**

> **v1.1（2026-11-15 夜）**：委托人批准补账本夹具后，v1.0 的最大盲区被打开，**新发现两条**（F-6、F-7）。下列数字是补夹具后的**两次完整复跑**，结论一致，已取代 v1.0 的「5 越线／28 未测」。

P1-21 修好的访问日志重建与探针拆分**站得住**。在客户规模审计夹具（11.5 万条调用、67 用户、合成账本）上，**40 个页面加载期间 `/api/livez` 都没有越线**，没有任何页面出现红字「页面数据暂时无法完成刷新」，另有 3 个页面因夹具局限未测。

但接口层有 **9 个越线或失败的路由**，其中 **`export-inquiry-pack` 能把 Pod 杀掉，且页面上没有入口**，只能经 API 触发；**v2 导出在全量范围下直接失败**。另有 23 个路由未测，不能按通过计。

| 范围 | 总数 | 通过 | 越线／失败 | 未测 | 排除 |
|---|---|---|---|---|---|
| WebUI 页面（页面加载口径） | 43 | 40 | 0 | 3 | 0 |
| GET 路由（含并发压测口径） | 125 | 89 | 9（7 越线＋2 失败） | 23 | 4 |

页面通过但背后的接口越线的有 `/admin/access-map`（F-2）、`/admin/usage`（F-3、F-5）、`/admin/audit` 的导出按钮（F-4）。原因是页面加载是单用户、单次请求，而接口越线是在并发 2 路连续请求下量到的。**页面通过不等于接口没有风险。**

> 口径说明：页面通过＝加载期间 livez max ≤ 1000ms（样本 ≥ 200 个时另加 p99 ≤ 400ms）、无红字、无 5xx。页面加载样本太少时 p99 就是 max，会随采样数在 100–520ms 间波动，所以样本不足 200 只用 max 线。路由通过＝顺序 5 次均 200 且最大 ≤ 3000ms；顺序最大 ≥ 40ms 的再并发压 5 秒，livez p99 ≤ 400ms 且 max ≤ 1000ms；未登记的路由须在第二个窗口再次越线才记越线。

## 2. 越线清单

| 编号 | 接口 | 页面入口 | 实测 | 严重度 |
|---|---|---|---|---|
| **F-1** | `GET /api/admin/audit/export-inquiry-pack` | **无**（仅 API，Spec 172） | **单次 114 秒**；kubelet 模拟 44 次探测失败 37 次，**连续失败约 111 秒**；子进程内存峰值约 1.4GB | **高** |
| F-2 | `GET /api/admin/access-map` | `/admin/access-map` | 单次 1.65 秒，全仓页面接口最慢；并发压测 livez p99 491–527ms（三次运行均越线）；页面单次加载 livez max 500–516ms，未越页面门槛 | 中 |
| F-3 | `GET /api/admin/governance/overview` | `/admin/usage` | 单次约 215–250ms；压测 livez p99 419–465ms，贴线；页面 4 个调用并发合计约 1050ms | 低（边缘） |
| F-4 | `GET /api/admin/audit/turns/export`、`GET /api/admin/audit/export` | `/admin/audit` 的导出按钮 | 压测（并发 2）livez max 1477ms、1801ms，超过 1000ms 的 max 门槛；单次导出约 0.6 秒，**无探测失败** | 低 |
| F-5 | `GET /api/admin/ui-usage/overview` | `/admin/usage`（由 `GovernanceOverview` 调用） | 30 万行页面访问记录下单次约 210–230ms，并发压测 livez p99 396–656ms；页面加载本身不越线（livez max 248–315ms）。**灌数据量是我按客户规模估的，不是事故实测**。代码里该接口把窗口内全部时间戳取进 JS 数组再分桶 | 低（观察） |
| **F-6** | `GET /api/admin/audit/export-v2`、`export-pack-v2` | 无 | 默认全量范围与 ≥14 天窗口返回 409 `EXPORT_FAILED: too many SQL variables`（`audit-as-of-proof.ts` 里按范围行数展开 `IN (?,?,…)`）。2 天、7 天窗口越过这一关，落在 `integrity_or_relation_failed`——合成行没有派生列，**不能据此判断完整性路径**。**功能失败，不是性能**：客户规模下正式 v2 导出不可用 | **中高** |
| F-7 | `GET /api/admin/audit/reconciliation/export` | `/admin/audit-reconciliation` 的导出 | 单次约 2.0–2.2 秒；并发压测 livez 最大 1.8–4.0 秒；剖析 `selectAccessLogRows` 一处 SQL 占 42% | 中 |

### F-1 详情（唯一能杀 Pod 的）

- **现象**：对 7 天窗口导出问询包，单个请求占满事件循环约 111 秒。Chart 0.2.9 的存活探针是每 10 秒一次、超时 3 秒、连续失败 6 次即重启（约 60 秒），本次探测连续失败 37 次，**会触发重启**。
- **根因（已剖析，见 [O1 复评](2026-11-15-p1-21-o1-worker-thread-reassessment.md)）**：对真实处理器做 CPU 剖析，117.2 秒里 96% 是一条原生 SQLite 语句。`export-inquiry-pack` 用 `paginate:false` 取出窗口内全部问询（7 天 6,732 个），展开成 `IN (@turn0…@turnN)` 并在同一语句里写两遍；`inferred_turn_access_logs` 的主键是 `(inferred_turn_id, access_log_id)`，按 `access_log_id` 查没有索引；调用查询只认 `since`、不认 `hours`，不传 `since` 就没有时间下限，于是 11.5 万行逐行对 6,732 个 ID 探一遍。同批 26,580 行，集合式写法（ID 灌临时表一次连接）实测 **0.30 秒**。同族的 `export-pack` 有 1 万行与字节上限（`LUCY_AUDIT_EXPORT_MAX_ROWS`），这条**没有任何上限**。
- **暴露面**：前端没有入口（页面导出用的是 `turns/export`、`export`、`export-pack`）。可被运维脚本、curl、或任何拿到管理员会话的 API 客户端触发。
- **不是**：不是页面一点就中；不是我最初怀疑的"内存溢出崩溃"——单独跑它进程没有死，正常返回了 9.9MB 的 zip。

### F-2 详情

`/admin/access-map` 单次 1.65 秒是全仓最慢的页面接口。三次独立运行并发压测 livez p99 都在 491–527ms，稳定越线；页面单次加载没越线，所以风险主要在多人同时打开或刷新时叠加。未做根因剖析。

## 3. 未测项（不得写成通过）

补账本夹具后，原「缺审计账本」一类已不再是盲区：`reconciliation/usage`、`reconciliation/inquiries/:turnId` 转为通过，`reconciliation/export` 暴露为 F-7，`export-v2`／`export-pack-v2` 暴露为 F-6。仍未测的 23 个路由：

| 类别 | 数量 | 路由 | 原因与补测条件 |
|---|---|---|---|
| 夹具里没有对象 | 14 | 评测运行 4 个（`eval/runs/:runId` 及 `artifact`／`compare`／`results`）、语义资产操作／发布／导出／计划详情 7 个、Wiki 版本与批次 2 个、来源版本 1 个 | 夹具里没有这些对象，返回 404／409 或缺 ID。需灌数据后补测 |
| 参数或鉴权 | 8 | `query-artifacts`、`notifications/status`、`notifications/:id`、`branding/logo`、`schema-manifest`、`table-structure-diff`、`help/diagrams/:id`、`publish-workbench/evidence` | 404／401／403／400：需要真实 ID 或会话，对性能判断影响小 |
| 设计上限 | 1 | `audit/export-pack` | 返回 413 `ERR_AUDIT_EXPORT_TOO_LARGE`：超过 1 万行即拒绝，是有意保护。拒绝前耗时约 450ms |

页面另有 3 个未测：`/connections`、`/publish/workbench`（宿主无 `ktx` 命令行：`POST /api/connections/*/test`、`POST /api/validate-changed` 返回 503 `ktx CLI was not found in PATH`，需对 demo 容器补测）和 `/eval/runs/:runId`。

另有 4 个排除：`/api/auth/*` 三个、`eval/runs/:runId/stream`（SSE）。

### 夹具覆盖不到

- 审计库之外的大表只灌了 `ui_page_views`／`ui_catalog_navigation_events`；安全账本只有 2,000 条**合成**事件，投影、追踪证据、通知、配置变更日志**没有按客户量级灌数据**。合成行没有 `primary_status` 等派生列，v2 导出的完整性路径因此无法判断。
- 页面全部用单个用户加载；多个管理员同时打开多页的叠加没有测。
- 全部数字来自开发机（Apple Silicon），不是客户 amd64 现场。绝对值不可直接外推，相对排序可参考。
- 请求窗口参数：`/audit/export` 前端只传 `since`／`until`，本次传的是 `hours`／`range`，导出路由是否按窗口收窄未逐一核实。

## 4. 逐页结果（43 页）

列：该页加载时实际发出的 API 个数、其中最慢一次、各调用耗时合计、加载期间 `/api/livez` 的 p99／max（毫秒）。

| 页面 | API 数 | 最慢一次 | 耗时合计(ms) | livez p99 / max | 判定 | 备注 |
|---|---|---|---|---|---|---|
| `/overview` | 6 | 208ms | 383 | 3 / 131 | 通过 |  |
| `/ops/calls` | 2 | 8ms | 11 | 2 / 3 | 通过 |  |
| `/connections` | 15 | 31ms | 215 | 2 / 5 | 未测 | 夹具局限：`POST /api/connections/*/test` 返回 503 `ktx CLI was not found in PATH`（宿主无 KTX）。其余 13 个调用正常 |
| `/connections/enabled-tables` | 5 | 7ms | 18 | 3 / 4 | 通过 |  |
| `/connections/test` | 3 | 3ms | 6 | 2 / 2 | 通过 |  |
| `/catalog` | 3 | 11ms | 18 | 2 / 2 | 通过 |  |
| `/catalog/:conn/:schema/:table` | 3 | 8ms | 16 | 2 / 2 | 通过 |  |
| `/joins/:conn/:schema/:table` | 4 | 5ms | 13 | 1 / 2 | 通过 |  |
| `/publish/workbench` | 5 | 66ms | 87 | 4 / 4 | 未测 | 夹具局限：`POST /api/validate-changed` 503，同上（宿主无 KTX） |
| `/publish/history` | 3 | 6ms | 12 | 2 / 3 | 通过 |  |
| `/wiki` | 4 | 17ms | 40 | 3 / 3 | 通过 |  |
| `/skills` | 2 | 7ms | 11 | 2 / 3 | 通过 |  |
| `/admin/usage` | 4 | 343ms | 1063 | 3 / 327 | 通过（关联 F-3、F-5） | 同页 4 个调用并发合计约 1063ms，最慢 `governance/overview` 343ms；灌满 UI 使用记录后重测 livez max 248–285ms |
| `/admin/agents` | 3 | 212ms | 225 | 2 / 204 | 通过 |  |
| `/admin/agents/:userId` | 4 | 39ms | 89 | 7 / 15 | 通过 |  |
| `/admin/agents/:userId/tokens/new` | 2 | 3ms | 4 | 2 / 2 | 通过 |  |
| `/admin/tokens` | 2 | 7ms | 9 | 2 / 2 | 通过 |  |
| `/admin/tokens/new` | 3 | 90ms | 93 | 2 / 84 | 通过 |  |
| `/admin/roles` | 2 | 12ms | 14 | 2 / 2 | 通过 |  |
| `/admin/roles/new` | 5 | 8ms | 25 | 3 / 3 | 通过 |  |
| `/admin/roles/:roleId` | 8 | 103ms | 184 | 3 / 27 | 通过 |  |
| `/admin/row-policies` | 3 | 25ms | 39 | 3 / 3 | 通过 |  |
| `/admin/row-policy-templates` | 2 | 17ms | 18 | 3 / 4 | 通过 |  |
| `/admin/access-map` | 2 | 363ms | 611 | 102 / 515 | 通过（关联 F-2） | 页面加载 livez max 500–516ms（三次重测），未越页面门槛；接口并发压测越线，见 F-2 |
| `/admin/authorization-summary` | 1 | 2ms | 2 | 3 / 9 | 通过 |  |
| `/admin/audit?range=7d` | 3 | 200ms | 312 | 79 / 100 | 通过 |  |
| `/admin/audit-reconciliation` | 2 | 138ms | 139 | 4 / 115 | 通过（关联 F-7） | 补账本夹具后可测；页面本身不越线，导出接口 `reconciliation/export` 并发压测越线 |
| `/admin/audit-sources` | 3 | 193ms | 297 | 80 / 102 | 通过 |  |
| `/admin/mcp-playground` | 3 | 94ms | 188 | 3 / 83 | 通过 |  |
| `/admin/config-audit` | 3 | 6ms | 13 | 2 / 2 | 通过 |  |
| `/admin/branding` | 1 | 2ms | 2 | 2 / 2 | 通过 |  |
| `/admin/accounts` | 2 | 2ms | 3 | 3 / 3 | 通过 |  |
| `/admin/version` | 2 | 8ms | 11 | 3 / 3 | 通过 |  |
| `/eval/cases` | 4 | 5ms | 9 | 3 / 4 | 通过 |  |
| `/eval/cases/:domain` | 4 | 5ms | 11 | 3 / 3 | 通过 |  |
| `/eval/cases/:domain/new` | 1 | 3ms | 3 | 2 / 2 | 通过 |  |
| `/eval/cases/:domain/:caseId` | 2 | 3ms | 6 | 3 / 3 | 通过 |  |
| `/eval/runs` | 3 | 4ms | 8 | 2 / 2 | 通过 |  |
| `/eval/runs/:runId` | 0 | - | 0 | 0 / 0 | 未测 | 夹具无评测运行记录（`/api/eval/runs` 为空） |
| `/eval/monitor` | 7 | 7ms | 20 | 2 / 8 | 通过 |  |
| `/eval/field-questions` | 2 | 6ms | 6 | 2 / 4 | 通过 |  |
| `/eval/security-candidates` | 2 | 2ms | 3 | 2 / 3 | 通过 |  |
| `/help` | 2 | 4ms | 6 | 3 / 3 | 通过 |  |

## 5. 对 P1-21 门禁的修正建议

1. **压测的"概览负载"曾空转**：P1-21 压测脚本的临时项目没有 `webui/config/access.yaml`，`/api/admin/agents` 一直是 1ms 的 500，`displaySnapshotBusy=0` 对它不构成证据。补上配置后 agents 实测 80–150ms，仍通过。建议脚本对每个负载接口断言状态码为 200。
2. **门槛的覆盖面**：P1-21 的 SC-14 只压了 `turns`、`/api/diff` 和三个概览接口。本次发现的 F-1 到 F-4 都在其外。
3. 脚本本身已升格为门禁（2026-11-15，委托人批准）：`npm --prefix webui run sweep:event-loop:gate`，测试台 [`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)，基线只减不增。

## 6. 排查过程中的更正（如实记录）

- 第一次全量运行时，服务与压测同进程，遇到 `export-inquiry-pack` 后进程"消失"，我起初怀疑是内存溢出被系统杀掉。单独隔离后证伪：进程正常返回，是我用 `&` 起的后台任务被工具环境回收。随后把服务改成独立子进程，崩溃或卡死不再拖垮排查。
- 第一轮把 `/connections`、`/publish/workbench` 判成 `FAIL(5xx)`，后查明是宿主无 KTX 的夹具局限，已改为未测。
- 页面上以为能点出来的"导出问询包"其实不存在，已据此把 F-1 的暴露面从"页面可达"改为"仅 API"。

## 7. 委托人决定与落地（2026-11-15）

| 决定 | 落地 |
|---|---|
| 为 F-1 立整改条目 | 已立 **P1-32／REQ-030-053**（F-1＋F-6）；**2026-11-15 委托人授权开发，已落地** |
| F-2…F-5 是否立条目 | 已立 **P1-33／REQ-030-054**（F-2／F-3／F-4／F-5／F-7 合并），先剖析再定方案；**2026-11-15 委托人授权开发，已落地**，未引入 worker |
| 补测账本回放路径 | 已补合成账本夹具；盲区打开，新发现 F-6、F-7；v2 导出的完整性路径仍需带派生列的夹具 |
| 是否引入 worker 线程 | 已复评：[建议维持不默认引入](2026-11-15-p1-21-o1-worker-thread-reassessment.md)。F-1 集合式写法 0.30 秒 vs 现状 113.6 秒；只上 worker 治标（主线程延迟最大 5ms）但请求仍占核 114 秒 |
| 扫描脚本升格为持续看守 | 已升格为门禁并挂测试台，首跑 FAIL（越线未整改）；整改后基线 `tracked` 清零，未测路由 25、页面 3 |

仍需委托人另行决定：P1-32／P1-33 的**终稿确权与开发授权**；以及是否补带派生列的账本夹具以测 v2 导出完整性路径。

**≠ UAT PASS；≠ 可上线；不含客户现场数据。**
