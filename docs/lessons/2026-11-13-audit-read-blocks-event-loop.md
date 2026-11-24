# 错题：7 天访问日志占住事件循环，存活探针把 Pod 杀掉

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 标签 | `gate-gap` `ops-delivery` `ux-regression` `sev-high` |
| 环境 | 客户实例 `0.25.0`（`http://10.69.95.109:8276`）。不是 `0.30` 回归。开发机复测用合成夹具：30 天、115,000 条调用、67 个用户、183 张表 |
| 相关 | [Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md)（P1-21／REQ-030-042）；[Plan](../plans/lucy-20261113-heavy-read-path-and-probe-relief-plan.md)；[性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md)；[UAT](../qa/uat/suites/event-loop-relief/suite.md)（INDEX＝PASS；LOOP-05 BLOCKED） |
| 状态 | `mitigated`（2026-11-13 功能合同收口，p99 门槛调整为 400ms。客户实例未复测，UAT 未跑，故未写 `closed`） |

## 1. 症状与影响

- 打开访问日志的 7 天窗时，`GET /api/admin/audit/turns?hours=168` 超过 90 秒不返回。同期 `/api/health` 连续超时。
- Pod 被 liveness 杀掉（退出码 143），现场看到多次重启。
- 系统概览「系统状态／待处理事项」显示「页面数据暂时无法完成刷新」（`DISPLAY_SNAPSHOT_BUSY`）。`/api/diff` 约 27 秒。
- 主路径不可用：管理面打不开，进程被探针当死进程回收。

## 2. 复现要点

客户规模的 `audit.sqlite` 上，在读请求线程里同步跑 `better-sqlite3`：

1. 每次读访问日志，对近 30 天有调用的用户调用 `rebuildInferredTurns`。
2. 问询补充字段按行查询。
3. kubelet 的 startup、readiness、liveness 都打 `/api/health`，而这条路径还会去探依赖。
4. 事件循环被占住后，展示快照的元数据核对超过 3 秒，概览接口返回 `DISPLAY_SNAPSHOT_BUSY`。

开发机合成夹具上，改完后的读路径 p95 为 105ms。60 秒并发负载下 `/api/livez` max 487ms、p99 359ms，BUSY＝0。原门槛 p99 ≤ 300ms 未过；委托人把门槛调整为 400ms 后，这一跑按通过记。

## 3. 根因

- **实现：** 审计库是同步 SQLite，没有把重读放到请求之外。读访问日志会重建推断问询，并在分页前逐条补字段。投影追赶也曾在读请求上跑。
- **合同：** 存活探针和深度健康检查共用 `/api/health`。进程在做合法重活时不应答探针，kubelet 就把它杀掉。展示快照把「3 秒内没完成核对」定义成 BUSY，所以事件循环一长，概览就红。
- **数据：** 小库上看不见。客户是 30 天、约 11 万条调用、几十个长尾用户。
- **交付耦合：** Chart `0.2.9` 的存活探针改打 `/api/livez`。`0.25` 镜像没有这条路由。探针和镜像必须成套，不能先改 Chart。

## 4. 为何漏检

- 既有测试的审计库很小，读路径在毫秒级返回。同步 SQLite 把事件循环占住这件事，没有放进任何门禁。
- 门禁只断言探针路径是 `/api/health`，没有断言「重读进行时，存活探针仍然很快」。
- 本进程第一次规模测量全是 401。外壳继承了客户部署模式，未登录的拒绝被当成查询耗时。强制 `LUCY_WEBUI_AUTH=off` 且 `LUCY_DEPLOYMENT_MODE=development` 之后，才量到真实读路径。
- 维护器在 `app.ready()` 里等待 `setImmediate`。Vitest 假时钟吞掉 `setImmediate`，跨页用量测试整组超时。这不是生产事故，但是同一条让出事件循环的写法，在假时钟下会把测试挂死。
- 口头把 p99 收成 350ms 时，实测是 359ms。低于样本的门槛不能把这一跑写成通过。

## 5. 举一反三

1. **存活探针必须是无 I/O 的短路径。** 深度健康检查、依赖探测、SQLite 重读不能挂在 liveness 上。startup／readiness 可以看预热，liveness 只回答进程还在。
2. **读接口不重建派生数据。** 推断问询、投影追赶放在后台分片。读路径只查询，并暴露是否还在追（`inferredRebuild.complete`）。
3. **同步 SQLite 的性能门禁用客户量级夹具。** demo 种子或几十行单测通过，不能证明 7 天访问日志安全。持续看守用 `UAT-LOOP-01` 的 115,000 条夹具。
4. **耗时样本先看状态码。** 401／503 的毫秒数不是查询性能。规模脚本必须断言 200，并确认写出了推断问询。
5. **宣布通过的门槛不得低于所引用的样本。** 359ms 不能收成 350ms 再写过关；门槛写进 Spec，和证据同一天改。
6. **新探针路径和镜像一起交付。** 旧镜像没有新路由时，保持旧的探针值。先升 Chart 会把 Pod 打成持续失败。
7. **假时钟测试不能等待会被 mock 掉的 `setImmediate`。** 生产仍用 `setImmediate` 让出事件循环；只在 `VITEST` 下用微任务解开挂起。
8. **功能合同收口和开发机 JSON 都不是 UAT。** 客户 7 天访问日志不在业务高峰打。0.25 未升级前，UAT-LOOP-05 记 BLOCKED。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 读路径不再重建；补充字段改批量；`/api/diff` 一次扫描；探针拆 `/api/livez`、`/api/readyz` | 完成 | 功能合同已收口。未启用 worker |
| p99 门槛 300ms → 400ms | 完成 | 委托人确认实测 359ms 的这一跑通过 |
| 持续 UAT `UAT-SUITE-EVENT-LOOP-RELIEF` | 必做已开 | INDEX＝PASS（[2026-11-13-cursor-demo-event-loop](../qa/uat/suites/event-loop-relief/runs/2026-11-13-cursor-demo-event-loop.md)）。每个 0.30 候选构建仍跑规模脚本；客户 LOOP-05 待含 livez 镜像的维护窗 |
| 客户实例复测 | 未开 | 仅在含 `/api/livez` 的镜像上、维护窗执行。登记 ≠ 授权现在去打客户 |
| worker 线程 | 未开 | 400ms 门槛下不启用。再越门槛另决 |

## 7. 证据指针

- 合同与门槛：[重读路径 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) SC-13／SC-14。
- 开发机数字：[性能证据](../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md)；原始 JSON `inbox/event-loop-relief-perf.json`。
- 规模夹具：`webui/tests/performance/fixtures/audit-scale-fixture.ts`；入口 `npm --prefix webui run perf:event-loop-relief`。
- 看守用例：[UAT 套件](../qa/uat/suites/event-loop-relief/suite.md)。
- Chart：`deploy/k8s/helm/lucy` `0.2.9`；升级说明见 `deploy/k8s/helm/lucy/UPGRADE.md`（0.25 不要改挂 `/api/livez`）。
