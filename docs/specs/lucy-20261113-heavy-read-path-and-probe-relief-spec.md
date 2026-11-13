# 重读路径与探针减负（事件循环阻塞事故修复）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-13／产品线 `0.30.0`（是否回补 `lucy-v0.25` 见 O2） |
| 功能编号 / 优先级 | **P1-21**／REQ-030-042／**P1**（事故修复，建议优先排期）。**不入 0.30 核心分母** |
| 状态 | **功能合同已收口（2026-11-13）**。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（必做 R0／01–04；可选 LOOP-05 BLOCKED——客户 0.25 无 livez）。≠ 可上线 |
| 决策来源 | 2026-11-13 客户 K8s 现场：Pod 被 liveness 连续误杀（退出码 143，8 次重启）；系统概览「系统状态／待处理事项加载失败：页面数据暂时无法完成刷新」。同日委托人选择「根治」并要求先写 Spec／Plan |
| 需求来源 | 客户 IT 日志与截图；2026-11-13 对客户实例 `10.69.95.109:8276`（`0.25.0`）的逐个单次只读实测；仓库代码路径核对 |
| 实施主体 | WebUI 服务端（`webui/server/admin/audit.ts`、`proxy/audit.ts`、`security/projector.ts`、`index.ts`、`ktx-runtime.ts`、`admin/mcp-runtime.ts`、`publish-*`）；Helm Chart（`deploy/k8s/helm/lucy/`）与 `deploy/k8s/K8S_CONTRACT.md` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 不改 Spec 172 推断问询的固定回看窗口与编号稳定性；不改审计投影合同（projection 落后时 `complete=false`）；不改 Spec 174／195 展示快照的 BUSY 语义；扩展 [`K8S_CONTRACT.md`](../../deploy/k8s/K8S_CONTRACT.md) 探针表 |
| 实施计划 | [`docs/plans/lucy-20261113-heavy-read-path-and-probe-relief-plan.md`](../plans/lucy-20261113-heavy-read-path-and-probe-relief-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。读路径不再重建推断问询、不再同步追投影；问询补充字段改成按集合批量查询；`/api/diff` 每请求只扫一次内容树；新增 `/api/livez`／`/api/readyz` 与 Chart 探针改挂；健康检查依赖状态改后台缓存；事件循环延迟可观测 |
| v0.1 授权落地 | 2026-11-13 委托人授权终稿并要求落地。O1＝未达标不启用 worker；O2＝只改 `lucy-v0.30`。SC-14 的 livez p99 未过门槛，状态保持开发中 |
| v0.1 门槛调整 | 2026-11-13 委托人将 SC-14 `/api/livez` p99 从 300ms 调整为 400ms，并确认实测 359ms 的这一跑通过。未启用 worker |
| v0.1 测试台 | 2026-11-13 挂 `UAT-SUITE-EVENT-LOOP-RELIEF`。INDEX 为 NOT RUN。功能合同收口不变 |
| v0.2 测试台跑次 | 2026-11-13 Cursor demo 跑次 PASS（必做）；LOOP-05 BLOCKED。功能合同收口不变。≠ 可上线 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在客户规模的审计数据下，打开访问日志（7 天）、治理概览、系统概览等页面，不会让 WebUI 进程卡住到被 liveness 误杀，也不会让系统概览因展示快照核对过期而报「页面数据暂时无法完成刷新」；各接口返回的数据与改前一致。
- 本条出口：SC-01–SC-16（vitest 替身＋客户规模合成夹具上的性能断言＋Chart 渲染检查）。
- 不在本条出口：客户现场复测（归测试台 UAT，当前 `not_registered`）；`/api/admin/agents` 的进一步提速；页面文案或布局改动；KTX 侧性能；多副本部署；审计数据保留策略调整。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

本条不新增用户可见文案。新增接口 `/api/livez`、`/api/readyz` 只供探针与运维使用，响应为机器可读 JSON。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 不新增页面、按钮、颜色或间距
- [ ] 只改服务端读路径、健康接口与部署探针
- [ ] 不新增用户可见错误文案族

### Exceptions (If Any)

- None

### Follow-up Needed

- 推断问询后台重建未完成时，访问日志页是否显示「数据同步中」提示，另立 UX 条目；本条只在 API 增加可读字段

## 交互合同豁免

- 原因：本条只改服务端读路径、健康接口与部署探针，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/admin/audit/turns`、`/api/diff`、`/api/health` 既有响应字段的含义与取值

## 1. 问题陈述

### 1.1 现场实测（2026-11-13，客户实例 `0.25.0`，逐个单次只读调用）

规模：7 天 26,800 次调用；67 个 Agent，70 个 Token，183 张表。

| 接口 | 耗时 | 现象 |
|---|---|---|
| `/api/health`（空闲） | 1.2–1.7s | 本地 demo 0.3s |
| `/api/admin/audit/turns?hours=168` | **> 93s，未返回** | 期间 `/api/health` 连续 4 次 30s 超时，进程无响应 |
| `/api/diff` | **27.3s** | 系统概览「待处理事项」依赖 |
| `/api/admin/agents` | 3.2s | 系统概览「系统状态」依赖 |
| 治理概览／agents／tokens（7 天） | 0.4–1.2s | 非主因 |

原始数据：`inbox/ksc-heavy-baseline-20261113.json`（临时目录；本表为正式记录）。

### 1.2 根因（代码核对）

一个根因、两个症状：**同步的重计算占住 Node 事件循环**（审计库用 `better-sqlite3`，同步执行；服务端无 `worker_threads`）。

| 症状 | 链路 |
|---|---|
| Pod 被误杀 | 事件循环被占 → `/api/health` 超过探针超时 → liveness 连续失败 → SIGTERM（143） |
| 系统概览红字 | 事件循环被占 → 展示快照的元数据核对超过 3s 未完成（`display-snapshot.ts` `METADATA_FRESH_MS`）→ `/api/sources`／`/api/admin/agents` 返回 `DISPLAY_SNAPSHOT_BUSY` → 区块显示「页面数据暂时无法完成刷新」 |

占住事件循环的具体热点：

| # | 位置 | 事实 |
|---|---|---|
| H1 | `admin/audit.ts` `listAuditTurnEntries` | 每次读请求对**近 30 天所有有调用的用户**逐个执行 `rebuildInferredTurnsDebounced`（`SELECT DISTINCT user_id … ts >= 30 天前`），每个用户重建会读出其 30 天全部 `access_log`、在 JS 里聚类、整段删除再插入。页面只看 7 天，却按 30 天×全员重建 |
| H2 | 同上 `enrichTurnEntry` | 对窗口内**每一条**问询单独查询调用明细、指标、工具统计（N+1）；分页在补充字段之后才做 |
| H3 | `admin/audit.ts` `auditProjectionStatus` | 每次读请求调用 `runProjection` 且 `maxBatches` 默认无上限，在请求线程上把安全账本积压一次追完；而 `security/projector.ts` 已有后台调度器（分片＋让出事件循环） |
| H4 | `/api/diff` → `buildPendingChangedFiles` | 对每个待发布文件调用 `readPublishEvidence`，后者**每次都重新扫描并哈希整个内容树**（复杂度＝待发布文件数×内容树大小）；顺序 await |
| H5 | `/api/health` | 每次请求都启动子进程 `ktx admin runtime status`（无缓存）；内容布局遍历无缓存；MCP 执行层探测仅 5s 缓存且过期时在请求线程上探测 |
| H6 | Chart 探针 | startup／readiness／liveness 全部打 `/api/health`，liveness 超时 5s、连续 3 次即杀 |

另：`idx_al_ts`（`access_log(ts)`）只在代理侧建表路径创建，管理侧初始化不保证存在。

## 2. 目标

1. **读路径不做重建、不追投影**：访问日志、访问关系图等读接口不再触发推断问询重建；审计投影只读状态，不在请求线程上追积压。
2. **后台增量维护**：推断问询按「有新调用的用户」增量重建，在后台分片执行并让出事件循环；保持 Spec 172 的 30 天固定回看与编号稳定。
3. **批量查询替代 N+1**：问询补充字段按集合一次查询，结果与改前逐条查询一致。
4. **`/api/diff` 每请求只扫一次内容树**，结果与改前一致。
5. **探针分离**：新增无 I/O 的 `/api/livez`（liveness）与只读缓存的 `/api/readyz`（startup／readiness）；`/api/health` 保留为诊断接口，依赖状态改后台缓存。
6. **可观测**：进程内记录事件循环延迟（p99／max），在 `/api/health` 诊断字段与性能夹具中可读。
7. 不改 KTX；不改页面；不改既有接口字段的含义。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 预聚合汇总表／改指标口径实现 | 多页面共用口径（`kpiContracts.ts`），风险大；本条先去掉无效计算 |
| 默认引入 worker 线程池 | 先做算法减负；达不到 SC-13／14 时按 O1 启用 |
| 改展示快照 3s 新鲜度阈值或 BUSY 语义 | 阈值是正确的诚实降级；根因在事件循环被占 |
| 优化 `/api/admin/agents`（3.2s） | 已是批量查询，不阻塞到误杀级别；另立条目 |
| 改推断问询聚类算法或回看窗口 | Spec 172 合同不变 |
| 改页面、文案、加「同步中」提示 | 见 Design System Follow-up |
| 客户现场复测作为本条出口 | 归测试台 UAT |

## 4. 设计

### 4.1 推断问询：读路径只读，后台增量重建

- 新增后台「推断问询维护器」（与 `createProjectionScheduler` 同一模式：单实例、不重叠、去抖、兜底轮询）。
- **脏用户来源**：水位轮询 `SELECT DISTINCT user_id FROM access_log WHERE ts > @watermark`（依赖 `idx_al_ts`，管理侧初始化补建该索引）；可选同进程写入时直接 `markDirty(userId)` 加速。
- **重建单位**：仍调用现有 `rebuildInferredTurns(userId, { lookbackHours: 720 })`，语义不变；用户之间 `setImmediate` 让出事件循环。
- **启动**：进程启动后做一次全量扫描（30 天内有调用的用户），分片执行。
- **读路径**：`listAuditTurnEntries` 与 `access-map-echo` 的 `defaultEnsureInquiryRebuild` 不再调用重建；响应 `data` 追加字段 `inferredRebuild: { complete, pendingUsers, lastCompletedAt }`（只追加，不改既有字段）。
- **紧急回退开关**：环境变量 `LUCY_TURN_REBUILD_ON_READ=1` 恢复旧的读时重建（仅事故回退）。

### 4.2 问询补充字段：按集合批量查询

- 对窗口内问询集合，用 `json_each(@ids)` 或临时表一次取回：问询→调用 ID 映射、调用指标、工具调用统计、报告型问询的调用与表来源。
- 过滤、排序、`kindCounts`、`total`、分页的顺序与改前相同；只替换取数方式。
- 为报告型问询查找补 `access_log(lucy_turn_id)` 索引。

### 4.3 审计投影：读路径只读状态

- `auditProjectionStatus` 改为：读取 `projectionStatus(store, target)`（不追积压）＋ `scheduler.trigger()`；落后时照旧 `complete=false` 与 `lag`。
- 导出类接口（调用时间线导出等）同样只读状态；若合同要求导出前追平，则以有上限的分片（单次 ≤ 1 片）＋让出执行，超出则返回 `complete=false`，不得无上限同步追。

### 4.4 `/api/diff`：每请求一次扫描

- 请求开始时 `scanPublishContent` 一次，结果传入 `readPublishEvidence`（新增可选参数）；`collectContentLayout` 在同一请求内复用。
- 证据读取改为有界并发（≤ 4）。
- 不加跨请求缓存（避免新的失效问题）；如仍不达标另立条目。

### 4.5 探针与健康接口

| 接口 | 用途 | 行为 |
|---|---|---|
| `GET /api/livez` | liveness | 不做任何 I/O，立即返回 `{ ok: true }`；免登录 |
| `GET /api/readyz` | startup／readiness | 只读内存状态：HTTP 已监听且启动预热完成（或预热超时 60s）→ 200；否则 503。响应体附缓存的依赖状态，**依赖降级不返回 503**（与现行 `/api/health` 降级仍 200 的行为一致，不新增摘流量语义）；免登录 |
| `GET /api/health` | 人与运维诊断 | 字段与语义不变；`ktxRuntime` 改读后台缓存（启动时取一次，此后每 60s 后台刷新）；`contentLayout` 30s 缓存；MCP 执行层探测改后台刷新；追加 `eventLoop: { p99Ms, maxMs, windowSeconds }` |

Chart 默认值（`deploy/k8s/helm/lucy/values.yaml`）：

| 探针 | 路径 | period | timeout | failureThreshold |
|---|---|---|---|---|
| startup | `/api/readyz` | 5 | 3 | 60 |
| readiness | `/api/readyz` | 5 | 3 | 6 |
| liveness | `/api/livez` | 10 | 3 | 6 |

同步：`K8S_CONTRACT.md` 探针表、`scripts/gates/helm-lucy-gate.sh`、`k8s-acceptance.sh`、`UPGRADE.md`（提示：已用自定义 values 覆盖探针路径的客户须改挂）。Chart 版本单独递增（与产品版本解耦）。

### 4.6 事件循环延迟

- 启动时 `perf_hooks.monitorEventLoopDelay({ resolution: 20 })`，按 60s 窗口滚动 p99／max；仅内存，不落盘。

## 5. 核心流程（伪代码）

```text
# 推断问询维护器（后台）
on start:
  ensureIndex(access_log.ts); ensureIndex(access_log.lucy_turn_id)
  dirty := DISTINCT user_id FROM access_log WHERE ts >= now-720h
  watermark := MAX(access_log.ts)
  schedule(pass)

every 10s or on markDirty:
  new := DISTINCT user_id FROM access_log WHERE ts > watermark
  watermark := MAX(ts) seen;  dirty ∪= new;  schedule(pass)

pass (never overlaps; rerun once if triggered during pass):
  for userId in dirty (stable order):
     rebuildInferredTurns(userId, lookback=720h)   # 语义同改前
     dirty.remove(userId); lastCompletedAt := now
     await setImmediate                            # 让出事件循环
  on error(userId): keep userId dirty; backoff; record status.error

# GET /api/admin/audit/turns
if env.LUCY_TURN_REBUILD_ON_READ == "1": legacyRebuildOnRead()   # 事故回退
turns := SELECT … FROM inferred_turns/conversation_turns WHERE window   # 同改前
enriched := bulkEnrich(turns)        # 一次集合查询，替代逐条
filtered := applyFilters(enriched)    # 顺序同改前
page := paginate(filtered)
projection := projectionStatusOnly(); scheduler.trigger()
return { …同改前字段, projection, inferredRebuild: maintainer.status() }

# GET /api/diff
scan := scanPublishContent(once)
snapshot := readPublishPendingSnapshot(scan)
impact := buildPublishImpactSafely(snapshot)
files := mapLimit(snapshot.changes, 4, c -> readPublishEvidence(c, scan))
return 同改前形状

# 探针
GET /api/livez  -> 200 {ok:true}                       # 无 I/O
GET /api/readyz -> warmupDone ? 200 {ok:true, data:cachedStatus}
                              : 503 {ok:false, reason:"warming_up"}
GET /api/health -> 同改前字段，依赖状态取缓存 + eventLoop
```

## 6. 验收（SC）

| ID | 通过标准 | 证据 |
|---|---|---|
| SC-01 | `GET /api/admin/audit/turns`（各 `source`／`hours`）不调用 `rebuildInferredTurns` | vitest spy |
| SC-02 | 访问关系图回显读路径不调用 `rebuildInferredTurns` | vitest spy |
| SC-03 | 维护器：写入新调用后，对应用户在一个轮询周期内被重建；未写入的用户不被重建；重建失败的用户保持待处理且不阻塞其他用户 | vitest（假时钟） |
| SC-04 | **结果等价**：同一夹具上，维护器完成后 `/turns` 的 `entries`／`total`／`kindCounts`／`summary`／`referenceLatency` 与改前读时重建结果逐字段一致（含推断问询 ID），覆盖 `source`×`inquiryKind`×`outcome`×`tableSearch`×`q`×`user` 代表矩阵 | vitest golden |
| SC-05 | `/turns/export`、问询包导出与改前逐字节一致 | vitest golden |
| SC-06 | 补充字段的 SQL 执行次数与问询条数无关（夹具 50 条与 5,000 条下 `prepare/all` 次数相同） | vitest spy |
| SC-07 | `/turns` 与导出路径不以无上限方式调用 `runProjection`；投影落后时返回 `complete=false` 与 `lag`；后台调度器被触发 | vitest spy |
| SC-08 | `LUCY_TURN_REBUILD_ON_READ=1` 时恢复读时重建 | vitest |
| SC-09 | `/api/diff` 单次请求只调用一次 `scanPublishContent`；响应与改前逐字节一致（含 17 个以上待发布文件的夹具） | vitest spy＋golden |
| SC-10 | `/api/livez` 无文件、子进程、网络、SQLite 调用；免登录 | vitest spy |
| SC-11 | `/api/readyz` 预热前 503、预热后 200；依赖降级时仍 200 且体内反映降级；不启动子进程 | vitest |
| SC-12 | `/api/health` 字段集合为改前字段＋`eventLoop`；连续 20 次请求 `ktx admin runtime status` 子进程调用 ≤ 1 次 | vitest spy |
| SC-13 | **客户规模夹具**（30 天 ≈ 115,000 条调用、67 用户长尾分布、183 表）：维护器完成后 `/turns?hours=168` 单次耗时 p95 ≤ 3s（开发机） | perf 测试 |
| SC-14 | **负载场景**（同一夹具，60s：3 路并发 `/turns?hours=168`＋1 路 `/api/diff`＋系统概览三接口循环）：`/api/livez` max ≤ 1,000ms、p99 ≤ 400ms；系统概览三接口 `DISPLAY_SNAPSHOT_BUSY` 次数＝0。2026-11-13 委托人将 p99 从 300ms 调整为 400ms，实测 359ms 按此通过 | perf 测试 |
| SC-15 | Chart 渲染：liveness→`/api/livez`、startup／readiness→`/api/readyz`，参数同 §4.5；`helm-lucy-gate.sh`／`k8s-acceptance.sh` 断言同步；`K8S_CONTRACT.md` 已更新 | `helm template`＋门禁脚本 |
| SC-16 | 管理侧初始化后 `access_log(ts)`、`access_log(lucy_turn_id)` 索引存在 | vitest |

## 7. 待决（交委托人）

| ID | 问题 | 选项 | 推荐 |
|---|---|---|---|
| O1 | SC-13／14 未达标时是否启用 worker 线程 | A：仅在未达标时，把后台重建与 `/turns` 查询移入只读 worker（WAL 支持并发读）；B：一开始就上 worker | **A**（最简，先去无效计算） |
| O2 | 客户实例为 `0.25.0`，是否回补 | A：Chart 探针改挂随 Chart 发布并可单独用于 0.25 客户（需 0.25 镜像先有 `/api/livez`）；代码修复只进 0.30，客户升级获取；B：代码修复同时回补 `lucy-v0.25` hotfix | **A**；客户在升级前继续用放宽的 values 覆盖止血 |

## 8. 现场止血（不改代码，供 IT 现在执行）

- 保留放宽的探针覆盖（`values.m69.yaml`），下次覆盖 Chart 时不得丢失。
- 放宽后 liveness 约容忍 150s 无响应（5 次×30s）。实测单次 `/turns?hours=168` 阻塞超过 90s，单次通常能扛过，但两人先后打开即可能超出。修复上线前，建议避免在业务高峰打开「访问日志」的 7 天视图，优先用 24 小时窗口。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 后台重建落后导致访问日志短时不完整 | `inferredRebuild.complete=false` 可读；改前已有 30s 去抖，同类窗口 |
| 单个重度用户重建本身阻塞数百毫秒 | 2026-11-13 实测 livez p99 359ms，在调整后的 400ms 门槛内通过；未启用 worker |
| 批量查询改写引入结果差异 | SC-04／05／09 golden 逐字段比对 |
| 探针改挂后客户自定义 values 仍指向 `/api/health` | `UPGRADE.md` 提示；`/api/health` 仍可用，只是不再推荐 |
| readiness 语义变化导致摘流量 | `/api/readyz` 依赖降级仍 200，与现行一致（SC-11） |

## 10. 诚实主张

| 可以 | 不可以 |
|---|---|
| 合成夹具证明改前改后结果一致、事件循环不再被长时间占用 | 未授权即改运行代码 |
| 引用 2026-11-13 现场实测作为基线 | 宣称客户现场已验或可上线；测试台当前 `not_registered` |

---

**下一步：** 功能合同已收口。测试台必做已 PASS（[`2026-11-13-cursor-demo-event-loop`](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)）；客户 LOOP-05 仍 BLOCKED。持续看守按套件节奏。本条收口不表示可上线。
