# P1-21 O1「是否启用 worker 线程」复评

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-21 O1「是否启用 worker 线程」复评 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-15 |
| 撰写人 | Claude |
| 委托人 | xingchen |
| 基于材料 | [P1-21 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) O1；[P1-31 排查报告](2026-11-15-page-by-page-event-loop-sweep-report.md)；`inbox/o1-worker-experiment.mts`、`inbox/o1-profile-inquiry-pack.mts`（临时脚本，不入库）；`webui/server/admin/audit.ts` `export-inquiry-pack` 处理器 |
| 适用范围 | 回答委托人「把 O1 拿出来重新评估」：全页面排查出新的重路由后，原决策「O1＝未达标不启用 worker」是否要改。**只给评估与建议，不改 P1-21 Spec 状态，不改运行代码** |
| 输出位置 | `docs/reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md` |

## 1. 结论

**建议维持 O1 现决策：不默认引入 worker 线程。** 先做算法减负，再用全页面门禁复测，仍超线的路由再按条引入只读 worker。

依据有三条，数字都是本机实测：

1. **最重的 F-1 是一条 SQL 的算法问题，不是「要不要多线程」的问题。** 同一批 26,580 行，原写法 113.6 秒，改成「把问询 ID 灌进临时表再连接」后 0.30 秒，约 380 倍，仍在主线程执行。
2. **只上 worker 治标不治本。** 把原写法放进 worker：主线程定时器延迟最大 5ms、p99 1ms，探针不再被占住，Pod 不会被杀；但这条请求仍然独占一个核心 113.6 秒，Pod 的 CPU 上限是 2 核。
3. **其余越线路由是 0.2–2 秒级的同步读，才是 worker 的候选。** 它们没有 F-1 那样的单点算法病灶，见 §3。是否上 worker，应等 F-1 修完、门禁复测后按剩余越线逐条定。

## 2. F-1 实验

环境：本机，夹具＝30 天、115,000 条调用、67 用户（与 P1-21 同尺子）。实验在审计库的拷贝上做，只读，不触碰运行代码。7 天窗内问询 ID 共 6,732 个，命中调用行 26,580 行。

| 写法 | 执行位置 | SQL 耗时 | 主线程定时器最大延迟 |
|---|---|---|---|
| 现状：`IN (@turn0…@turn6731)` 写两遍，对未建索引的 `access_log_id` 做 `EXISTS` | worker | **113,616ms** | 5ms（p99 1ms，10,446 个样本） |
| 集合式：问询 ID 灌入临时表，一次连接 | 主线程 | **302ms** | 同步执行，期间无定时器样本；阻塞时长＝302ms |

交叉印证：对真实处理器做 CPU 剖析（进程内 `app.inject`），总计 117.2 秒，其中 **96%（112.5 秒）是一个匿名函数的自身时间**，也就是 `database.prepare(...).all()` 的原生 SQLite 执行。剩下的重建推断问询、CSV 渲染、`presentCallRows` 加起来不到 2%。

成因：`inferred_turn_access_logs` 的主键是 `(inferred_turn_id, access_log_id)`，按 `access_log_id` 查没有索引；处理器的调用查询只认 `since`／`until` 参数、不认 `hours`；不传 `since` 时没有时间下限，所以全部 115,000 行都要对 6,732 个 ID 逐个探一遍（实验里加上 7 天时间下限后同一条 SQL 为 14.2 秒，去掉才复现 113.6 秒）。复杂度是行数乘 ID 数。

> **未做的核对：** 两种写法的行数相同（26,580），但没有逐行比对 ID 集合。正式整改时必须补等价性测试。

## 3. 其他越线路由

| 路由 | 实测 | 主要耗时 | 是否 worker 候选 |
|---|---|---|---|
| `audit/reconciliation/export`（F-7） | 单次 1.9–2.1 秒；并发压测期间 livez 最大 1.8–4.0 秒 | 剖析总计 4.2 秒，`selectAccessLogRows` 一处原生 SQL 占 **42%**；其余分散在 `prepare`、`ensureColumn`、`rebuildInferredTurns` | 是，或先改这条 SQL |
| `access-map`（F-2） | 单次 1.65 秒（压测场景）；进程内冷启动单次 0.4 秒 | 没有单点：`rebuildInferredTurns`、`sourcesFor`、`prepare`／`ensureColumn` 各占 5–17% | 先查为什么压测下比冷启动慢 4 倍 |
| `audit/export`、`audit/turns/export`（F-4）、`governance/overview`（F-3）、`ui-usage/overview`（F-5） | 单次 0.2–0.6 秒；并发压测 livez 最大 465–1,751ms | 未做剖析 | 视门禁复测 |

F-3／F-4／F-5 和 F-2 在压测里的数字比单次大得多，说明问题不在单次，而在**连续同步读把事件循环排满**——这是 worker 能解决的那一类。**这一点还只是推断，没有对它们剖析。**

## 4. 为什么不是「一开始就上 worker」

- worker 要为审计库再开只读连接，要处理结果的结构化克隆回主线程（本实验里 26,580 行一次性返回，未单独量克隆耗时，不能当作零成本），要做取消和超时。这是一块新的运行时机制，不是一行改动。
- F-1 不需要它：算法修好后是 0.3 秒。
- P1-21 Spec 的 O1 本来就写的是「未达标时再上 worker」，当前证据与该决策一致。

## 5. 建议的顺序

1. **F-1 先走算法整改**（P1-32）：集合式连接，让调用查询跟随 `hours` 窗口（现在只认 `since`），补等价性测试。预期从 114 秒到亚秒。
2. **整改后跑一次 `sweep:event-loop:gate`**，把 F-1／F-6 从基线里划掉。
3. 对 F-2／F-3／F-4／F-5／F-7（P1-33）**逐条剖析**，剩下仍超 livez 线的，再单独开 O1 复评，那时才有理由引入只读 worker。
4. 不对 P1-21 Spec 头部状态做任何改动；本文是复评输入，不是 Spec 变更。

## 6. 局限

- 实验与剖析都在 Apple Silicon 开发机、单进程、合成夹具上；客户 amd64 与真实并发下的绝对数字会不同，但 F-1 的复杂度结论与机器无关。
- worker 实验只测了「主线程是否被占」，没有测 worker 数量、内存、取消。
- 本文不构成开发授权。
