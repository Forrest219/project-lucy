# 错题：客户 K8s 平滑升级后 event loop 卡顿，readyz 超时摘端点，入口 502／503

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-17 |
| 标签 | `ops-delivery` `gate-gap` `ux-regression` `sev-high` |
| 环境 | 客户 K8s 站点 `lucyadm.matrixback.com`；目标版本 **Lucy 0.30.0**，构建 `abb389133356`；平滑升级后回滚。Pod 例：`lucy-5c655c9f77-nnnxx`（Running、RestartCount=0，Ready=False） |
| 相关 | 前序错题 [2026-11-13-audit-read-blocks-event-loop](2026-11-13-audit-read-blocks-event-loop.md)（P1-21）；总账 **P1-39／REQ-030-060**（本事故入池）；延伸线 P1-21／P1-31／P1-32／P1-33；Chart 探针 `deploy/k8s/helm/lucy/values.yaml`（`readinessProbe`→`/api/readyz`，`timeoutSeconds: 3`）；MCP 探针 `webui/server/admin/mcp-runtime.ts`（`KTX MCP probe timed out after ${timeoutMs}ms`，预算 1500ms） |
| 状态 | `open`（**根因已定位（本机受控限速复现）**：`inferred-turn-maintainer` 启动 `scanFull` 同步全索引扫描，慢盘＋冷缓存下超 Fastify 10s `onReady` 超时致启动崩溃，0.25.0／r1 无此维护器；**启动幸存时**重建页单页同步 2.7–5.9 秒致 livez 反复数秒、进程不死（与现场同形，未逐条归因）；Spec／Plan／测试台已起草，终稿未确权、开发未授权；已回滚；见 §3 末「升级演练复现」与「修正与第二个机制」） |

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
| **实现（主因）** | Lucy WebUI **Node.js 事件循环持续被同步工作占住**（现场 p99 ≈ 2.2s）。`/api/livez` 无库／外调仍排队 1.5s+，证明阻塞在本进程。**具体是哪段代码在堵：首次登记时未知；2026-11-17 夜起已定位为 `inferred-turn-maintainer` 启动 `scanFull`＋（`abb38913`）轮询 `OR` 查询的同步全索引扫描，见本节末「升级演练复现」**（本机受控限速复现，非客户现场直接证据）。 |
| **合同／探针** | P1-21 已拆 `/api/livez` 与 `/api/readyz`，避免「深度健康」杀进程；但 **readiness 仍假设 readyz 能在 3s 内返回**。客户现场 readyz 常 >3s → 摘流量而非杀 Pod（故 RestartCount=0，却对外不可用）。 |
| **误报放大** | 问数 MCP 探针预算 **1500ms** ＜ event loop p99 **2210ms** → 把「循环卡顿」标成「KTX MCP unavailable／health degraded」，掩盖真因并造成 ok↔degraded 抖动。 |
| **数据／规模** | Demo 夹具曾把 livez p99 压到约 **359ms**（P1-21 SC-14）；客户升级现场 **2210ms**。夹具绿 ≠ 客户升级负载下绿。 |
| **环境／交付** | 平滑升级本身把新镜像滚进流量；若新版本在客户规模下循环仍堵，滚动中 Ready 起不来就会出现持续 502／503。回滚正确。 |
| **可排除** | KTX／策略未就绪；单纯「Helm 配错导致进程起不来」；`data-qa-instructions.md` ENOENT 为主因。超时偏紧会放大症状，但 **livez 已 1.5s+** 说明先有应用侧阻塞。 |

**2026-11-17 晚 A/B 已排除项（不改上表「主因未知」的结论）**：

- 失败构建 `abb38913`（镜像 `customer-amd64-0.30.0-20261117-abb38913`）部署到云端演示机：稳态 10 分钟、269 样本，livez p95 99ms、readyz p95 45ms、eventLoop p99 22ms，**未复现**。客户现网 0.25.0（`6d2664b3fc7d`）稳态事件循环空闲（404 对照只有 1 个网络往返），其 `/api/health` 每次约 1.1–1.8s 来自 0.25 无缓存的 `ktx admin runtime status` 子进程（异步，不堵循环）。
- 本机宽目录沙箱（320 来源、20 Agent、容器限 2 核）对 `c84e6d7d`／`28cad205`／`be34e05a` 各跑握手压力：initialize 顺序 p50 91／94／**7**ms，并发 60 全部完成 5568／5570／**304**ms，eventLoop p99 96／118／31ms。限 0.5 核时 `be34e05a` 的 eventLoop p99 仍只有 42–76ms。**握手／目录宽度／低 CPU 三条路径在 `be34e05a` 上都不能产生 2.2s**，也不是 `c84e6d7d..be34e05a` 的回归。
- 因此 2.2s 阻塞仍待定位，嫌疑缩到：客户规模审计库的启动补算与读取、客户 K8s 环境（CPU 节流、存储）、`be34e05a` 之后的 `f947aa18`／`abb38913` 仅文档（可排除）。需要客户侧只读证据：`/sys/fs/cgroup/cpu.stat` 的 `nr_throttled`、`kubectl top pod`、升级后 0–10 分钟的 `/api/health` `eventLoop` 时间序列。
- **日志架构升级嫌疑（委托人提出，部分成立）**：`r1(3a9f0711)..abb38913` 在 `getDb()` 首次打开审计库时**同步**执行：`idx_al_lucy_turn_id`／`idx_al_effective_turn_id`／`idx_al_original_turn_id`／`idx_ital_access_log`／`uq_al_trace_v2p5_2` 建索引、`PRAGMA foreign_key_check`、`foreign_keys=ON`，并为 `access_log` 每次写入追加 span 行（P1-36）。本机用真实 schema 造 20 万行／893MB 审计库，热缓存下这些语句合计约 **1.1s**（526+217+177+0+148ms，`foreign_key_check` 1ms）——**一次性**启动冻结，慢盘冷缓存下可放大到数十秒，但**不能**单独解释持续 18 分钟的 p99 2.2s。持续阻塞若与日志有关，只能是每次调用的同步写（WAL＋`synchronous` 默认 FULL，每次提交一次 fsync）在客户 PVC 上变慢；本机 SSD 无法复现。判别证据：容器内 `dd if=/dev/zero of=/data/lucy/.fsync-probe bs=4k count=200 oflag=dsync` 的耗时（用后删除）、`.ktx-ui/audit.sqlite*` 三个文件大小、故障 Pod 启动后 5 分钟的 `[lucy-proxy]` 日志（含是否出现 `pre-existing foreign key violation` 与 listen 时间点）。
- **升级演练复现（2026-11-17 夜，本机 Docker，容器限 2 核；基线＝客户上一次平滑升级 `20261111-r1`＝0.25.0／`9c78b0e3`）**：同一份 20 万行／883MB 旧 schema 审计库，0.25.0 与 0.30.0（`be34e05a`）在**正常盘**上都能启动（0.30 的事件循环 max 520ms，无 readyz>3s）。把盘改成**慢盘＋冷页缓存**（`--device-read-bps/--device-write-bps 30mb`、读 300／写 100 IOPS、`drop_caches`）后：**0.25.0 正常启动（33s 健康）；0.30.0 在 `onReady` 阶段崩溃（`FST_ERR_HOOK_TIMEOUT`／`AVV_ERR_READY_TIMEOUT`，退出码 1）**；库先在正常盘上迁移完（4 个新索引已建好）再上慢盘，**仍然崩溃**，故主因**不是**升级时的一次性索引构建。
- **定位**：`211f2d64`（11-14，r1`3a9f0711` 里没有）新增的 `inferred-turn-maintainer`（`webui/server/index.ts` 的 `onReady` 钩子）在启动时执行 `scanFull`：`SELECT DISTINCT user_id FROM access_log WHERE ts >= <30 天前>`，执行计划是 `SCAN access_log USING COVERING INDEX idx_al_user_ts`（整条索引全扫描），**同步**执行；慢冷盘上耗时 **12.4s**，超过 Fastify 默认 10s 钩子超时，进程退出。其后每 10s 的 `pollOnce` 用 `ts > ? OR (ts = ? AND id > ?)`，执行计划**同样是整条索引全扫描**（`OR` 用不上 `ts` 范围）：热缓存 8–13ms，冷缓存首次 12.8s——扫描代价随**全部历史行数**线性增长，与 30 天窗口无关。这与「平滑升级以前没出过」吻合（0.25 与 r1 都没有该维护器），也与「慢盘／冷缓存才暴露」吻合；客户现场未崩溃（RestartCount=0）但可能处于「略低于 10s」的边缘，持续 2.2s 与否仍待客户侧 fsync／IO 证据。**本结论是本机在受控限速下的复现，不是客户现场的直接证据。**
- 候选修复方向（**未授权，不改运行代码**）：启动路径不做同步全表扫描（`scanFull` 延后到 listen 之后、分片 `yieldToEventLoop`；或用 `idx_al_ts` 的 `ts >= ?` 范围查询加 `GROUP BY user_id` 的增量水位）；轮询把 `OR` 改写成可走 `idx_al_ts` 的 `ts >= ? AND (ts > ? OR id > ?)`；必要时显式设置 Fastify `pluginTimeout`／`onReady` 不阻塞 listen。门禁补一条「慢盘＋冷缓存＋大审计库冷启动」。
- **修正与第二个机制（2026-11-17 夜，测试台 `UAT-SUITE-COLD-START-SLOW-DISK` 改前基线）**：
  - 上一条「候选修复方向」里把轮询当成已被 `79db4352` 修好的部分，**不对**：用产品自带 SQLite 3.53.2 对 HEAD 的轮询 `SELECT DISTINCT user_id FROM access_log WHERE id > ?` 做 `EXPLAIN QUERY PLAN`，仍是 `SCAN … USING COVERING INDEX idx_al_user_ts`（整条索引）。去掉 `DISTINCT`、在代码里去重才走 `SEARCH … INTEGER PRIMARY KEY (rowid>?)`（0.02ms 对 2.2ms）。热缓存下几毫秒，所以开发机与 CI 看不出。
  - HEAD `7b882c7c` 在同一台限速冷启动台上：旧库首次升级与已迁移库重启**都** `FST_ERR_HOOK_TIMEOUT` 崩溃；0.25.0 对照 30.8 秒就绪。
  - **启动幸存时**（已迁移库、限速盘、启动不清缓存）：13 秒就绪、进程不死、重启 0，但就绪后 `/api/livez` 反复 1.6–9.9 秒。原因方向：启动 `scanFull` 把窗口内全部用户标脏，每次启动对每个用户做 30 天整段重建；重建页读取是宽列、非覆盖索引，在限速冷盘上**单页 400 行同步 2.7–5.9 秒**（热缓存 1–2 毫秒）。这与客户现场「livez 1.5–2.2 秒、不崩溃、RestartCount=0」同形。归因边界：没有把每次卡顿逐条对到语句，只证明量级与时段强相关。
  - 举一反三：「400 行一页」是条数上界，不是时间上界；同步读取的代价取决于磁盘延迟，而不是行数。热缓存单测与 CI 测不到这一类。
  - 证据：[基线跑次](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-17-cursor-docker-baseline.md)；Spec [冷启动审计扫描](../specs/lucy-20261117-cold-start-audit-scan-spec.md) §1.3／§1.4。
- 原始数据：`inbox/rehearsal-*.csv|.log`、`inbox/abb38913-run1.csv`、`inbox/ab-*-sampler.csv`、`inbox/ab-*-handshake.json`、`inbox/cloud-handshake-abb38913.json`（临时文件，可删）。

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
| 写 Spec／Plan／测试台（残余 event loop × 升级探针） | 已起草（v0.2-draft） | [Spec](../specs/lucy-20261117-cold-start-audit-scan-spec.md)、[Plan](../plans/lucy-20261117-cold-start-audit-scan-plan.md)、[测试台](../qa/uat/suites/cold-start-slow-disk/suite.md)；改前基线 FAIL；**终稿未确权、开发未授权** |
| 升级门禁：客户或等价负载下 livez／readyz／eventLoop | 测试台已建（`npm run uat:cold-start`），改后跑次待补 | 补 gate／UAT；与 P2-4／P2-5 相邻但本条先盯产品侧阻塞 |
| 复评内部 MCP 探针 1500ms 与 degraded 语义 | 未开 | 避免循环卡顿误报为 KTX 挂 |
| 关闭本错题（`closed`） | 未开 | 须客户升级窗复测通过且根因处置闭合 |

## 7. 证据指针

- 现场诊断截图（会话附件，未入库）：Pod NotReady＋readyz 超时统计；health 90s 采样表；event loop p99≈2210ms；容器内 livez／readyz 手测。
- Chart 探针默认：`deploy/k8s/helm/lucy/values.yaml`（startup／readiness→`/api/readyz`，liveness→`/api/livez`，`timeoutSeconds: 3`）。
- MCP 探针超时文案：`webui/server/admin/mcp-runtime.ts`。
- event loop 快照：`webui/server/runtime/event-loop-delay.ts`（经 `/api/health` 等暴露）。
- 前序减负合同与夹具证据：[P1-21 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md)；[性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md)；[UAT EVENT-LOOP](../qa/uat/suites/event-loop-relief/suite.md)。
- 总账延伸：P1-31／32／33；真实环境不稳追加证据见总账变更 v0.96。
