# 冷启动审计库整表扫描消除 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.3** |
| 日期 / 目标版本 | 2026-11-17／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-39**／REQ-030-060／**P1**（事故修复）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | **v0.3。冷启动后的同步读取不再随历史总行数或磁盘延迟失控：启动补算与稳态轮询都不再整条扫描 access_log（启动补算改为按用户逐个探测，轮询改为不带 DISTINCT 的 id 水位范围读取并在代码里去重）；启动不再把窗口内全部用户一律标脏后做 30 天整段重建，只补算有未处理新行的用户，补算每一页同步读取按时间预算收敛；审计库两个连接的打开与迁移（含 foreign_key_check）在 app.listen 之前完成。本机慢盘冷缓存台实测：HEAD 7b882c7c 旧库首次升级与已迁移库重启都在 onReady 阶段 FST_ERR_HOOK_TIMEOUT 崩溃；启动幸存时就绪后 livez 反复 1.6–9.9 秒且进程不死，补算单页（400 行）同步读取 2.7–5.9 秒（热缓存 1–2 毫秒）；0.25.0 对照 30.8 秒就绪。测试台 UAT-SUITE-COLD-START-SLOW-DISK 已建。终稿已确权、开发已授权（委托人 2026-11-18「授权定稿，进入开发」；不含新增持久化表等 schema 变更，不含线上升级）。代码已实现，vitest 守卫通过。测试台最新跑次（2026-11-18，P1-45／47 落地后的候选镜像 `p145-p147`，工作树 dirty、arm64 本机构建）**PASS**：R0／01／02／03／04／05 全 PASS（02 按放宽门槛 PASS，livez max 548ms／p99 468ms，readyz p99 307ms，110 秒就绪；03 重启后 livez max 7ms、26 秒就绪；04 livez max 3ms；05 管理员认领与 MCP 握手通过）。先前 801b9c02 跑次的 03／04 FAIL（重启时最新行距上次重算不足 15 分钟的用户被整窗口重算、DELETE 不分片）在同一夹具下转 PASS，与 P1-45 重建状态水位判定（不再用 15 分钟余量）及 P1-47 DELETE 分块一致；06 客户侧证据仍 BLOCKED。不入核心分母。≠ 可上线** |
| 决策来源 | 2026-11-17 客户站点升到 `0.30.0`（构建 `abb389133356`）后回滚。本机受控复现：同一份 20 万行／943MB 旧 schema 审计库，慢盘（读写 30MB/s、读 300／写 100 IOPS）＋冷页缓存下，0.25.0（`9c78b0e3`，即客户上一次平滑升级 `20261111-r1`）33 秒健康，0.30.0 在 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT` 退出码 1。委托人 2026-11-17 要求推进修复，起草 Spec、Plan 并预先设计 UAT |
| 需求来源 | 客户管理入口 502／503、升级失败回滚。复盘见 [`docs/lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md`](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) |
| 实施主体 | WebUI 服务端：`webui/server/admin/inferred-turn-maintainer.ts`（启动补算、轮询）、`webui/server/index.ts`（启动顺序）、`webui/server/proxy/audit.ts` 与 `webui/server/admin/audit.ts`（审计库打开与迁移的预热入口）。不改 Helm 探针、不改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 [P1-21](lucy-20261113-heavy-read-path-and-probe-relief-spec.md)（读路径与探针）与 [P1-38](lucy-20261117-inferred-turn-rebuild-yield-spec.md)（补算切片）。P1-38 只切**单个用户的重建**，不覆盖本条的启动扫描与轮询。不改 30 天回看、聚类间隙、问询编号规则 |
| 实施计划 | [`docs/plans/lucy-20261117-cold-start-audit-scan-plan.md`](../plans/lucy-20261117-cold-start-audit-scan-plan.md) |
| 测试台 | [`UAT-SUITE-COLD-START-SLOW-DISK`](../qa/uat/suites/cold-start-slow-disk/suite.md)；脚本 `npm run uat:cold-start` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.3 | 2026-11-18 委托人「授权定稿，进入开发」：终稿确权＋开发授权（不含 schema 变更、不含线上升级）。OQ-1 收口为「不新增表」：用户是否需补算，比较窗口内最新一行 `ts` 与该用户最近一次推断问询重建的 `updated_at`（减 15 分钟安全余量），两条查询均为 `SEARCH`；窗口内有行却没有任何推断问询的用户一律补算。§4.4 与 §5 中「比较最大 `access_log.id`」以此为准（`inferred_turn_access_logs` 不含探针／协议行，不能代表覆盖范围）。补算首页 50 行起步，按上一页耗时在 25–400 行间收敛。开发期实测后调整：目标 100 毫秒、单步最多放大 1.5 倍；写入分片首片 8 个簇、2–25 收敛；较长同步段后占空比让出；首轮扫描等监听之后才启动（SC-16／SC-17）。实现已在工作树，改后跑次 FAIL（差一项）：见 [跑次](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-18-cursor-docker-after-fix.md)。 |
| v0.2-draft | 纳入第二个机制：启动全量标脏后的 30 天整段重建，单页同步读取在慢盘冷缓存下 2.7–5.9 秒；新增 G6／G7、§4.4、SC-13／SC-14。改前基线（HEAD `7b882c7c`）已跑：02／03／05 崩溃，04 用 `--warm-start` 证明启动幸存时稳态仍卡。终稿未确权。开发未授权 |
| v0.1-draft | 初稿。依据 2026-11-17 本机慢盘冷启动演练与 SQLite 执行计划实测起草。终稿未确权。开发未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：审计库在慢盘、冷页缓存、客户规模（约 20 万行、67 个用户、近 30 天）下冷启动时，进程不退出，`/api/readyz` 在预算内转 200，转 200 之后 `/api/livez`、`/api/readyz` 不再被同步 SQL 拖过探针预算；启动补算与后台轮询对 `access_log` 的读取代价与**新增行数**而不是**历史总行数**成正比；重启时没有新行的用户不重建；每一次同步读取的耗时受时间预算约束而不只是行数上界；合法用户（管理员认领、MCP 握手）在冷启动之后仍可用。
- 本条出口：SC-01–SC-17（SC-16 首轮扫描等监听、SC-17 占空比让出为 v0.3 开发期新增）。
- 不在本条出口：客户现场再升级与复测（归发布取证）、`synchronous`／fsync 策略、Helm 探针与超时、worker 线程、审计库迁移的分块或可取消化、其他同步 SQLite 路径（安全投影追赶、导出、概览）、页面文案。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

本条不新增用户可见文案。日志行里的 `schema ready` 是运维日志，不进 WebUI。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 不新增页面、按钮、颜色或间距
- [ ] 只改服务端启动顺序与审计库读取方式
- [ ] 不新增用户可见错误文案

### Exceptions (If Any)

- None

### Follow-up Needed

- 迁移与 `foreign_key_check` 仍是监听前的同步工作。冷慢盘上它可能占去数十秒，这段时间进程不监听，探针连接被拒。是否需要把它分块、可取消或改成后台，由 UAT-COLD-02 的实测耗时决定，另立条目

## 交互合同豁免

- 原因：本条只改服务端启动与后台读取，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/admin/audit/*` 既有字段含义；`/api/livez`、`/api/readyz`、`/api/health` 的路径、超时与响应字段；Chart 的探针参数

## 1. 问题陈述

### 1.1 现象

客户升级到 `0.30.0` 后事件循环 p99 约 2.2 秒，`/api/readyz` 常超过 Helm 的 3 秒，Pod Ready=False，网关 502／503，回滚。

### 1.2 本机复现与根因（受控限速；非客户现场直接证据）

同一份旧 schema 审计库，0.25.0 与 0.30.0 在正常盘上都能启动；慢盘＋冷页缓存下 0.25.0 33 秒健康，0.30.0 在 `onReady` 阶段崩溃。崩溃点是 `211f2d64` 新增的 `inferred-turn-maintainer` 在 `start()` 里同步跑的启动补算：

```sql
SELECT DISTINCT user_id FROM access_log WHERE ts >= ?
```

### 1.3 执行计划实测（产品自带 SQLite 3.53.2／better-sqlite3 12.11.1；20 万行；无 `sqlite_stat1`，与生产一致）

| 语句 | 来源 | 计划 | 热缓存耗时 |
|---|---|---|---|
| `SELECT DISTINCT user_id … WHERE ts >= ?` | 现网启动 `scanFull` | `SCAN … COVERING INDEX idx_al_user_ts`（整条索引） | 5.2ms |
| `SELECT DISTINCT user_id … WHERE ts > ? OR (ts = ? AND id > ?)` | `abb38913` 轮询 | 同上整条索引扫描 | 5.4ms |
| `SELECT DISTINCT user_id … WHERE id > ?` | **HEAD 轮询（`79db4352`）** | **同上整条索引扫描，没有走主键** | 2.2ms |
| `SELECT user_id … WHERE id > ?`（不加 `DISTINCT`） | 本条方案 | `SEARCH … INTEGER PRIMARY KEY (rowid>?)` | 0.02ms |
| `SELECT user_id … WHERE user_id > ? ORDER BY user_id LIMIT 1` | 本条方案（跳到下一个用户） | `SEARCH … COVERING INDEX idx_al_user_ts (user_id>?)` | 微秒级 |
| `SELECT 1 … WHERE user_id = ? AND ts >= ? LIMIT 1` | 本条方案（该用户窗口内是否有行） | `SEARCH … COVERING INDEX idx_al_user_ts (user_id=? AND ts>?)` | 微秒级 |

热缓存下前三条只差几毫秒，所以开发机和 CI 看不出来。冷盘上整条索引要从盘上读，复盘里 `scanFull` 实测 12.4 秒，超过 Fastify `onReady` 钩子默认的 10 秒。`79db4352` 把 `OR` 改成 `id > ?`，但因为带 `DISTINCT user_id`，规划器仍选整条覆盖索引，代价依旧随历史总行数线性增长。

### 1.4 第二个机制：启动后的整段重建（对应「不崩溃的持续卡顿」）

本机限速冷盘台、已迁移库上的事实：

- 启动补算 `scanFull` 把回看窗口内的**全部**用户（演练库 67 个）标脏，维护器随即对每个用户做 30 天整段重建。**每次启动都做**，不看这些用户自上次重建以来有没有新行。
- 重建每页读 `SELECT id, ts, tool, tables, args_summary, … FROM access_log WHERE user_id = ? … ORDER BY ts, id LIMIT 400`。这是宽列、非覆盖索引读取；同一用户的行在表页里与其他用户交错，几乎每行一次随机读。
- 单页同步耗时（`pagecost` 诊断，同一用户同一条 SQL）：

| 条件 | 4 页各自耗时（毫秒） |
|---|---|
| 限速盘＋冷页缓存 | 2695、5902、5005、4091 |
| 限速盘＋缓存已热 | 2、1、2、2 |
| 不限速＋冷页缓存 | 29、23、23、21 |

- 单页就超过探针的 3 秒预算。[P1-38](lucy-20261117-inferred-turn-rebuild-yield-spec.md) 的「400 行一页」是条数上界，该 Spec 自己写明它不是时间保证。
- 观测：HEAD 启动幸存（已迁移库、限速盘、启动不清缓存）时，`/api/readyz` 13 秒转 200，之后 `/api/livez` 反复 1.6–9.9 秒（2224、1574、7297、1694、1849、1783、9901 毫秒），进程不退出，`RestartCount=0`。这与客户现场「`livez` 1.5–2.2 秒、不崩溃」同形。
- 估算（**未整程实测**）：67 个用户 × 约 8 页 × 数秒 ≈ 半小时量级的反复同步停顿。
- 归因边界：本条没有把每一次 `livez` 卡顿逐一对到某条语句，只证明 (a) 重建页读取在该盘上单页就是数秒，(b) 同一时段 `livez` 出现同量级的数秒停顿。两者强相关，不是逐条归因。

### 1.5 第三个未量化的同步大块

`proxy/audit.ts` 的 `getDb()` 每次打开都会跑 `enableForeignKeysWithInventory`，里面是 `PRAGMA foreign_key_check`。它扫描所有指向 `access_log` 的子表（`access_log_sources` 等）逐行回查父行，**每次启动都跑，不是只在首次迁移**。该连接首次被调用的位置不固定：`ops-evidence` 的视图重建、MCP 代理启动时的 `ensureSkillAuditReady`、首个审计写入、维护器首轮重建都会走到。是否每条路径都在监听之前，本条起草时**未逐一核实**，由实现阶段核实并以 §4.3 的显式预热兜底。本机演练库的子表几乎为空，所以这项代价**没有被量化**，客户库的子表更大。另有 `admin/audit.ts` 的 `getAuditDb()` 已在监听前被投影游标恢复调用，两个连接各自做一遍同类 DDL。

### 1.6 已排除

握手路径（`be34e05a` 比基线快 12 倍）、320 源宽目录、低 CPU（0.5 核）、升级时一次性建索引（暖盘约 1.1 秒）、云端 `abb38913` 稳态。

### 1.7 未证实

客户现场持续 2.2 秒 p99 且 `RestartCount=0`：形态上与 §1.4 的「启动幸存后稳态卡顿」一致，**不是**与 §1.2 的崩溃一致。但本机盘速是复盘值的复现，客户盘的真实随机读延迟未知。要确认是同一机制，需要客户侧证据：容器内 `dd … oflag=dsync` 的 fsync 延迟、`audit.sqlite*` 三个文件大小、故障 Pod 启动五分钟的日志。本条按已证实的启动与轮询扫描修复，不宣称它解释了全部现场症状。

## 2. 目标

- G1：启动补算的读取量只与**用户数**成正比，不与历史行数成正比。
- G2：后台轮询的读取量只与**新增行数**成正比。
- G3：审计库的打开、迁移与 `foreign_key_check` 在 `app.listen` 之前完成，且耗时可在日志里看到。
- G4：`onReady` 阶段不再执行任何随历史行数增长的同步语句。
- G5：上述变化有可重复的慢盘冷启动演练作为门禁，而不只靠热缓存单测。
- G6：重启时，自上次补算以来没有新行的用户不重建。
- G7：补算每一次同步读取的耗时有时间预算，而不只有行数上界。

## 3. Non-Goals

- 不改 `synchronous`、`journal_mode`、`wal_autocheckpoint`。fsync 对客户盘的影响没有证据，待客户侧 `dd` 数据。
- 不改 Helm 探针、不改 Fastify `pluginTimeout`。放宽超时只是把崩溃改成长时间卡顿。
- 不引入 worker 线程。迁移与写入会争锁，worker 不能让主线程免于阻塞。**若 §4.4 的时间预算与「只补算未覆盖用户」落地后，UAT-COLD-02／04 仍过不了，再评估把补算的读取放到只读 worker，须另批。**
- 不把迁移分块、不把索引改成可选或后台建。本条只把它挪到监听之前并量化。
- 不改 P1-38 的补算切片、聚类规则、问询编号规则。
- 不改 `access_log` 的列与索引。方案只使用已有的 `idx_al_user_ts` 与主键。

## 4. 设计

### 4.1 启动补算：逐用户探测

用索引的有序性跳到下一个用户，再问该用户在回看窗口内是否有**未覆盖的新行**（§4.4）。每一步都是 `SEARCH`。每探测 64 个用户让出一次事件循环。探测到的「窗口内有行的用户」集合与旧语句相同；进入脏集的只是其中有未覆盖新行的子集。

用户数是历史上出现过的**全部**用户，不是窗口内用户。代价是 `O(用户数 × log 行数)`。

### 4.2 轮询：id 水位范围读取

按 `id > watermark ORDER BY id LIMIT 2000` 读 `(id, user_id)`，不加 `DISTINCT`，在代码里去重。每页之后水位推进到该页最大 `id`，不满一页即结束。页与页之间让出。不用 `NOT INDEXED` 提示，避免把一条查询绑死在某个执行计划上。冷启动后的第一次水位仍由 `MAX(id)` 取得（`SEARCH`）。

### 4.3 审计库预热移到监听前

`main()` 在 `app.listen` 之前、与 `recoverSemanticJournals` 等恢复步骤同一阶段，依次打开并迁移 `admin/audit.ts` 与 `proxy/audit.ts` 两个连接，各自导出一个只做打开与迁移的预热入口。预热完成后输出一行日志：

```
[lucy-audit] schema ready in <总耗时>ms (foreign_key_check <耗时>ms)
```

此后维护器与首轮重建拿到的是已就绪连接，不再执行 DDL。`onReady` 钩子里的维护器启动只剩调度，**首轮扫描与轮询等服务开始监听之后才启动**（v0.3 开发期实测：首轮补算与 `onReady` 里其余钩子争同一块冷盘，会把某个钩子拖过 10 秒；SC-06）。

监听前的同步工作不会被探针看到：此时端口未监听，探针连接被拒，计入 `startupProbe` 的失败次数。Chart 0.2.9 的 `startupProbe` 约 5 分钟（周期 5 秒、失败 60 次），liveness 在 startup 成功之前不生效。旧 Chart 0.2.8 没有 `startupProbe`，liveness 约 60＋3×30 秒，因此本条把首次升级的就绪预算定为 **150 秒**，由 UAT-COLD-02 实测。

### 4.4 补算范围与时间预算

- **谁需要补算**：启动时只有「回看窗口内存在尚未被推断问询覆盖的新行」的用户才进入脏集；没有新行的用户不重建。判定依据由实现选择，**优先不改表结构**（v0.3 定稿：比较该用户窗口内最新一行 `ts` 与其最近一次推断问询重建的 `updated_at` 减 15 分钟安全余量；见 OQ-1 收口）。若实现必须新增持久水位表，那是 schema 变更，须另批（见 OQ-1）。
- **首次升级**：从 0.25.0 升上来时没有覆盖信息，仍要补算一次。这一次必须在后台、受时间预算约束、不影响探针。它的总时长是未知数，由 UAT-COLD-02 用 `--window-s` 加长窗口实测。
- **时间预算分页**：补算每页行数不再固定 400。以上一页实测毫秒自适应，目标每页同步耗时 ≤ 100 毫秒（v0.3 开发期由 200 收紧；见 OQ-2）；首页 50 行，之后在 25 到 400 行之间按 `行数 × 目标毫秒 / 上一页毫秒` 调整，单步最多放大 1.5 倍（翻倍在随机读抖动时会冲过目标）。写入分片同理：首片 8 个簇，在 2 到 25 之间按同一规则收敛。较长的同步段（≥20 毫秒）之后空出相当的时间（上限 250 毫秒，占空比约 50%），让需要好几跳才能答完的请求（readyz）在空窗里答完（SC-17）。页内读取不可中断，所以预算只是目标，上限由 SC-13 在限速冷盘台上验证。
- **读取列不变**：本条不改重建读取的列与聚类规则。

### 4.5 守卫

- 计划守卫：测试里对维护器启动补算与轮询**实际准备的每条语句**跑 `EXPLAIN QUERY PLAN`，在**没有统计信息**的库上，计划不得含对 `access_log` 的 `SCAN`。以后谁再把 `DISTINCT` 加回去，红灯。
- 等价守卫：新旧语义在边界样本上逐一比较（见 §6）。
- 演练守卫：`npm run uat:cold-start`（UAT-COLD-02…05），在候选构建上必跑。

### 4.6 备选方案与取舍

| 方案 | 取舍 |
|---|---|
| 放宽 Fastify `pluginTimeout` 或 Helm 探针 | 症状外移。事件循环仍被占住，livez 仍超时。拒绝 |
| 启动时 `ANALYZE` 让规划器改走跳跃扫描 | 实测有统计信息时 `scanFull` 的计划会变成 `SEARCH … (ANY(user_id) AND ts>?)`，但 `ANALYZE` 本身整表扫描，且计划依赖统计信息，脆弱。拒绝 |
| 迁移与扫描放到监听之后 | 迁移期间事件循环被占住，正是要消除的现象。拒绝 |
| worker 线程跑迁移 | 与写者争锁，主线程仍要等。本条不引入 |
| 轮询加 `NOT INDEXED` | 能走主键，但把计划绑死，且仍带 `DISTINCT` 的临时 B 树。采用不带 `DISTINCT` 的写法更简单 |
| 保持启动全量重建，只缩小页 | 单页变小，但 67 个用户每次启动都要把 30 天读一遍，半小时量级的低占空比阻塞仍在。拒绝单独采用 |
| 只读 worker 跑补算读取 | 能让主线程免于等盘，但引入线程边界与连接管理，P1-21 明确「未达标不扩 worker」。本条先做 §4.4，仍不过再另批 |
| **逐用户探测＋id 范围轮询＋预热移到监听前＋只补算未覆盖用户＋时间预算分页（采用）** | 只用已有索引与主键；改动面限于维护器、重建分页与启动顺序 |

## 5. 核心流程（伪代码）

```text
startup():
  recoverSemanticJournals(); recoverOpsControlPlane(); ...      # 既有，监听前
  t = now()
  adminHandle = openAndMigrate(admin/audit)                      # 新增：监听前
  proxyHandle = openAndMigrate(proxy/audit)                      # 新增：监听前，含 foreign_key_check
  log("[lucy-audit] schema ready in {now()-t}ms (foreign_key_check {fk}ms)")
  await app.listen()                                             # onReady 里不再有 DDL 与整表扫描
  # onReady：maintainer.start({ after: listening }) 只创建定时器；首轮扫描等 listening 事件

needsRebuild(user):                            # §4.4
  newest = SELECT ts FROM access_log WHERE user_id = :user AND ts >= :cutoff ORDER BY ts DESC LIMIT 1   # SEARCH
  built  = SELECT updated_at FROM inferred_turns WHERE user_id = :user ORDER BY started_at DESC LIMIT 1 # SEARCH
  return newest is not none and (built is none or newest > built - 15min)

rebuildPages(user):                            # §4.4，替换固定 LIMIT 400
  size = 50; lastMs = none
  loop:
    if lastMs is not none: size = clamp(min(size * 100 / max(lastMs, 1), size * 1.5), 25, 400)
    t = now(); rows = loadPage(user, cursor, LIMIT size); lastMs = now() - t
    yield to event loop

scanFull():                                    # 启动补算，替换 SELECT DISTINCT … ts >= ?
  cutoff = now() - lookbackHours
  cursor = ""
  n = 0
  loop:
    row = SELECT user_id FROM access_log WHERE user_id > :cursor ORDER BY user_id LIMIT 1
    if row is none: break
    cursor = row.user_id
    if needsRebuild(cursor):                   # 内含窗口内是否有行：windowMax 为空即无
      touch(cursor)
    n += 1
    if n % 64 == 0: yield to event loop
  watermark = SELECT COALESCE(MAX(id), 0) FROM access_log
  scanned = true

pollOnce():                                    # 替换 SELECT DISTINCT … WHERE id > ?
  loop:
    rows = SELECT id, user_id FROM access_log WHERE id > :watermark ORDER BY id LIMIT 2000
    for r in rows: touch(r.user_id)            # Set 去重
    if rows is empty: break
    watermark = rows.last.id
    if rows.length < 2000: break
    yield to event loop
```

## 6. 验收

| 编号 | 承诺 | 打假 |
|---|---|---|
| SC-01 | 维护器启动补算与轮询准备的每条语句，在无统计信息、20 万行的库上，计划不含对 `access_log` 的 `SCAN` | vitest 计划守卫：对每条被 `prepare` 的 SQL 跑 `EXPLAIN QUERY PLAN`；先在 HEAD 上确认红灯，再在修复后转绿 |
| SC-02 | 逐用户探测得到的用户集合与旧语句 `SELECT DISTINCT user_id … ts >= ?` 相同；最终进入脏集的用户是该集合的子集，且包含每一个有未覆盖新行的用户 | vitest 等价守卫：`ts` 恰等于 cutoff 的行包含；只有窗口外旧行的用户不包含；窗口内外混合的用户包含；用户数 ≥ 130，跨两次让出；再叠加覆盖状态断言子集与不漏 |
| SC-03 | 轮询结果与旧 `DISTINCT … id > ?` 相同；超过 2000 行时分页不漏不重，水位等于最大 `id`；没有新行时不触碰任何用户 | vitest：造 4,500 个新行跨三页，断言被标脏的用户集合与水位 |
| SC-04 | 启动补算与轮询分页期间，排队的宏任务先于下一段同步工作运行 | vitest：与 P1-38 SC-01 同一手法，超过 64 个用户 |
| SC-05 | 预热入口执行之后，维护器与首轮重建不再执行 DDL | vitest：预热后对两个连接计数 `exec`，维护器启动与一轮重建期间为 0 |
| SC-06 | `app.listen` 之前完成预热，并输出 `schema ready` 日志 | UAT-COLD-02 的容器日志：该行出现在监听日志之前，且含两个耗时。总耗时自监听前第一批审计相关恢复步骤起算（开发期实测：打开与迁移常在 `recoverSemanticJournals`／`recoverOpsControlPlane` 里就已发生，只量预热这一步会恒为 0 毫秒） |
| SC-07 | 旧库首次升级、慢盘冷缓存：进程不退出，无 `FST_ERR_HOOK_TIMEOUT`，重启次数 0，`/api/readyz` ≤ 150 秒转 200；转 200 之后 120 秒内 `livez` max ≤ 2000ms、p99 ≤ 1000ms（首次升级补算窗口专用，2026-11-18 委托人批准放宽；探针超时 3 秒、liveness 连续失败 6 次才重启，p99 1000ms 仍留 3 倍余量；修复前为 1.6–9.9 秒，仍能拦住回退。重启与稳态 SC-08/09 仍为 max ≤ 1000ms、p99 ≤ 400ms），`readyz` p99 ≤ 1500ms，全部 200 | UAT-COLD-02 |
| SC-08 | 已迁移库再次冷启动（Pod 重启）：`/api/readyz` ≤ 60 秒，稳态门槛为 `livez` max ≤ 1000ms、p99 ≤ 400ms，`readyz` p99 ≤ 1500ms，全 200（不随 SC-07 放宽） | UAT-COLD-03 |
| SC-09 | 稳态下页缓存被冲掉后 60 秒内，门槛同 SC-08（不随 SC-07 放宽） | UAT-COLD-04 |
| SC-10 | 冷启动之后合法用户主路径可用：管理员认领、会话读取、MCP 握手与 `tools/list`，每步 ≤ 5 秒 | UAT-COLD-05 |
| SC-11 | 不退化：P1-21 SC-14、P1-38 SC-01–SC-10、P1-37 既有 vitest 保持通过；Chart 探针参数不变 | 既有测试集；`git diff` 无 `deploy/k8s/` 改动 |
| SC-12 | 演练台本身有判定力：同一限速冷启动台上，0.25.0 必须能起来 | UAT-COLD-01 PASS；否则 02–05 的结论作废 |
| SC-13 | 补算每页同步读取的耗时受时间预算约束：上一页慢则下一页变小，页大小始终在 25–400（单步最多放大 1.5 倍）；限速冷盘台上补算期间探针不被单页拖过预算 | vitest：注入假时钟与慢页，断言页大小收敛并有上下界；系统级由 UAT-COLD-02／03／04 的稳态门槛承担（改前基线 HEAD 不过） |
| SC-16 | 首轮扫描与轮询等服务开始监听之后才启动：监听之前不碰数据库、不重建 | vitest：`start({ after })` 门未开时 `getDb`／`rebuild` 调用 0 次，门开后补算发生 |
| SC-14 | 重启时没有新行的用户不重建；有新行的用户重建一次 | vitest：桩 `rebuild`，库中所有用户已覆盖时启动后调用 0 次；一个用户在覆盖之后新增一行时只对它调用 1 次。系统级由 UAT-COLD-03 承担：预迁移须用 `--premigrate-wait-s` 等首次补算跑完，重启后稳态门槛全过 |

## 7. 风险

| 风险 | 处理 |
|---|---|
| 监听前的迁移与 `foreign_key_check` 在冷慢盘上仍可能占去数十秒到数分钟 | 日志量化；UAT-COLD-02 的 150 秒是硬门槛。超过则本条不收口，另立条目做分块或后台化，不得回退为监听后同步执行 |
| 监听前进程不响应，旧 Chart 0.2.8 的 liveness 可能在迁移期间杀死 Pod | 150 秒预算对齐 0.2.8 的 liveness。客户 Chart 版本须在发布取证核对。≠ 本条出口 |
| 逐用户探测在用户数很大时变慢 | 每 64 个用户让出；`O(用户数 × log 行数)`，67 个用户是微秒级。用户数到万级另评 |
| `id` 水位范围读取依赖 `id` 单调递增 | `access_log.id` 是 `INTEGER PRIMARY KEY AUTOINCREMENT`，单调。行删除不影响水位 |
| 首次升级的整段补算总时长未知，120 秒窗口盖不住 | UAT-COLD-02 用 `--window-s` 加长窗口实测并写入跑次；补算受时间预算约束，不要求 120 秒内完成，只要求期间探针门槛不破 |
| 「已覆盖」的判定依据若需持久水位表，涉及 schema 变更 | OQ-1 已收口为不新增表（v0.3）。残余风险：只有探针／协议行的用户每次启动都会重建一次（无推断问询可比），可接受 |
| 本机限速演练不等于客户盘 | 限速值取自复盘。客户侧 `dd` 数据回来后校准；演练台按环境变量可调 |
| 客户现场症状与本机机制不同 | §1.6。本条不宣称解释全部症状；客户侧证据缺口保持在总账 |

## 8. 开放问题

| 编号 | 问题 | 处理 |
|---|---|---|
| OQ-1（v0.3 已收口：不新增表，用 `ts` 对 `inferred_turns.updated_at`） | 「某用户已被推断问询覆盖到哪个 `access_log.id`」从 `inferred_turn_access_logs`／`inferred_turns` 反推是否足够便宜且正确，还是必须新增持久水位表 | 实现阶段先在演练库上量化反推查询的计划与耗时（须 `SEARCH`）。必须新增表则暂停并向委托人申请 schema 变更授权 |
| OQ-2 | 时间预算的目标值 200 毫秒是否合适 | **已决（2026-11-18 委托人批准）**：UAT-COLD-02（首次升级补算窗口）livez 放宽为 max ≤ 2000ms、p99 ≤ 1000ms；03／04 保持 max ≤ 1000ms、p99 ≤ 400ms。400ms 原是由 UAT 结果反推而非探针预算；放宽依据见 SC-07 |
| OQ-3 | 客户 Chart 实际版本（0.2.8 还是 0.2.9） | 发布取证核对，决定监听前迁移的预算是 150 秒还是更宽 |
| OQ-4 | 重启时「最新行距上次重算不足 15 分钟」的已建用户会被整窗口重算，其中 `DELETE` 不分片，限速冷盘上 livez 停顿 1.5–8 秒（2026-11-18 取证跑次 03／04 FAIL，见 `runs/2026-11-18-cursor-docker-fix-801b9c02.md`）。如何处置 | **已解除（2026-11-18）**：P1-45 把覆盖判定改为重建状态水位（不再用 15 分钟余量），P1-47 把整窗口 DELETE 分块；`p145-p147` 候选镜像在同一夹具复跑，03／04 PASS（见 `runs/2026-11-18-cursor-docker-p145-p147.md`）。「重启时有已建用户需重算」的专用用例仍未建，由 P1-45 的 IRR 套件覆盖中断恢复 |
