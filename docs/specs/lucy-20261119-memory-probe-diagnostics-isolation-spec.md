# 存活／就绪探针纯内存响应与诊断隔离 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1-draft |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 / 优先级 | P1-61／REQ-030-082；建议 P1 第一批；不入核心分母 |
| 台账号 | 无 |
| 阶段 | S4 |
| 状态 | v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-01真实停止／自动恢复局部复测PASS WITH GAP；完整F61矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| 授权边界 | 2026-11-20委托人明示按原合同修复已复现缺口，授权相关运行代码、测试工具及本机隔离Docker全真复测；不改客户环境、不提交、不推送、不发布；完整矩阵不得推定通过 2026-11-20委托人后续批准：本进程已完成修复、回归及取证可作阶段性本地commit；不含push、发布或客户变更，未完成矩阵仍保留GAP。 |
| 需求 / 计划 | [总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Plan](../plans/lucy-20261119-memory-probe-diagnostics-isolation-plan.md) |
| 测试台 | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md)，F61；[修复跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repair.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：生命周期满足既有就绪条件时，探针在不触发诊断 I/O 的路径上回应，诊断变慢不单独阻断可合法服务的实例。
- 本条出口：SC-01–09 的请求路径、代次与真实进程局部失败检查。
- 不在本条出口：全站重负载/MCP 旅程、实际网关摘流量、客户现场 503 根因、全量升级验证、多副本、节点高可用。
- 上线关系：本条收口不表示可上线

## 1. 已有能力与新增差集

去重核对见 [评审](../reviews/2026-11-19-core-availability-gap-assessment.md)。保留 P1-21 的三探针语义及 P1-46 两端口监听约束；不重复实现冷启动或重建 worker。

基线 `6208ea57`：`webui/server/index.ts` 的 readyz 调用 `dependencyStatus(false)`，其中 `readMcpRuntimeStatus` 仍读取项目、配置摘要、stat、catalog reload 和 reload state。已有部分缓存≠整条请求无 I/O。这个调用链是核实的设计差集，**不是已证实的现场故障根因**。

## 2. 设计合同与兼容

1. `/api/livez` 保留免登录与 `{ok:true}`；不得新增文件、SQLite、子进程或依赖请求，不另开“永远绿”的旁路进程。
2. `/api/readyz` 只读当前进程生命周期快照，预热/任一监听未完成返回现有 `503 warming_up`，服务就绪返回 200。P1-63 若未来生效，其 draining 状态优先返回该合同的拒绝；本条不提前实现 drain。
3. `/api/health` 及 readyz 的 `data` 使用同一后台诊断快照；响应不触发刷新。保留现有字段、类型与外层信封。启动时缺诊断不得伪造 healthy：未获事实的子项使用其既有 unknown/unverified 表达，`diagnostics.freshness=unknown`；字段兼容金样本是开工前置。既有 `status` 只保留原依赖汇总语义，不因快照未知或陈旧单独改成 degraded。
4. 在外层信封新增 `data` 的兄弟字段 `diagnostics={observedAt,ageMs,freshness}`，不改 `data` 的既有含义。freshness 为 `unknown/fresh/stale`。后台每 10 秒至多启动一轮，单在途，5 秒截止；距最后完整成功采集超过 30 秒即 stale。age 使用单调时钟，observedAt 为 UTC 墙钟；启动未知时两者为 null。客户端已知字段继续可读，新增字段可忽略。
5. 采集超时或失败保留原 observedAt，不用请求时间冒充采集时间；已有快照立即标记 stale，不等 30 秒，下一成功采集才恢复 fresh。陈旧快照中的 `data.status` 仍表示原采集时点的依赖汇总，freshness 单独说明它不是当前事实，不得通过改写既有 status 制造新语义。无既有快照则维持 unknown。每个 I/O 必须可取消或有真实外层执行上界；超时未产生完整结果不得发布为成功，底层未退出前仍持有单在途许可，禁止每 10 秒泄漏一个采集器。请求不能 await 采集中的 Promise。
6. projectRoot／配置代次变化后，旧采集结果不能发布到新代；同一进程内以不可变记录原子换代。失去依赖只使诊断 degraded；**启动安全校验、运行时授权和每请求拒绝仍按原合同执行**，不得读取诊断缓存作权限判据。
7. 诊断未知/陈旧不单独让全站 Not Ready；实际不能安全服务的条件继续由原启动/授权合同决定。该可用性边界不是“缓存正常即可放行”。

## 核心流程（伪代码）

```text
onProbe(kind):
  life = readLifecycleMemory()                 # 不 resolveProjectRoot、不读配置
  if kind == livez: return 200 {ok:true}
  diag = readPublishedDiagnosticMemory(life.generation)
  meta = freshnessFromMonotonicClock(diag)      # 不刷新、不等待 collector
  if kind == readyz and not existingReadyPredicate(life):
    return existingNotReadyEnvelope(diag, meta)
  return existingEnvelopeWithDiagnosticMetadata(diag, meta)

collectorTick():
  if collectorInFlight: return
  generation = captureGeneration()
  acquireSingleCollectorPermit()
  try:
    result = collectUsingExistingReadersWithRealDeadline(5 seconds)
    if completedSuccessfully and generationStillCurrent(): publishImmutable(result)
  catch failureOrDeadline:
    if generationStillCurrent(): markAttemptFailureInMemoryWithoutAdvancingObservedAt()
  finally:
    releaseOnlyAfterActualCollectorSettled()
```

## 受影响画像

下列为设计目标，当前实现及局部证据见头部和修复跑次；[画像规范](../governance/user-personas.md)。

| 画像 | 变更前 → 变更后 | 判定 | 依据 | 补偿路径 |
|---|---|---|---|---|
| 问数方 | 诊断 I/O 可能影响可达性 → 探针无此耦合；纯 MCP 不要求 WebUI Cookie | ↑ | SC-01／07；组合归 R-CAV | 不增加问数门禁 |
| 治理方 | health 请求触发部分刷新 → 后台周期采集，首次失败立即陈旧且时间明确 | ↓ | SC-03／04 | 明确时间/陈旧状态；采集恢复后自动更新；不用于保存/权限判定，SC-04／07 |
| 运维方 | 探针受诊断路径影响 → 生命周期与诊断分离，但诊断新鲜度变弱 | ↓（按最差子面） | SC-03–06 | 原始采集时间、失败/陈旧状态及自动恢复；SC-04／05；原只读日志仍可达 |
| 管理层 | 健康结果时间含义不清 → 明确最近成功采集时间 | ↑ | SC-03／04 | 不用陈旧结果宣称健康 |

## 3. 验收标准

| 编号 | 可打假的标准 |
|---|---|
| SC-01 | 三个 GET 处理器调用期间文件/SQL/子进程/网络 reader 次数为0；后台采集与请求计数分离，不能只 spy 一个入口 |
| SC-02 | 两监听未完成/预热未完成为503，既有就绪后200；慢/失败诊断不得让已合法就绪实例单独变503；不提前实现 P1-63 |
| SC-03 | 旧响应字段兼容金样本逐字段通过；诊断 unknown/fresh/stale、null与时钟回拨/进程重启边界正确，不造 healthy；既有 `data.status` 不因 freshness 单独改变 |
| SC-04 | collector 首次失败/超时即保留原采集时间并显示stale，持续失败超过30秒仍如此；真实恢复后下一成功周期发布fresh；无用户强制刷新前置 |
| SC-05 | 连续10个tick仍只有1个实际采集器；超时、取消只发起真实停止并继续持许可，实际终结后无遗留子进程/悬空Promise；close等待或如实上报未终结采集，不用Promise.race伪装底层已停止 |
| SC-06 | 采集中切换项目/配置代次与迟到结果不能污染新快照；老Promise不得把新代状态覆盖 |
| SC-07 | 权限收紧/吊销及配置失败关闭不读诊断快照；诊断慢/陈旧期间及合法恢复后，真实HTTP读取与不带WebUI Cookie的纯MCP `initialize`→`tools/list`→合法轻量数据查询均成交且结果正确，被吊销身份仍拒绝，既有纯MCP授权合同不变 |
| SC-08 | 真进程局部慢诊断采集台：120秒、每秒各1次livez/readyz，已就绪窗口全200；各p99≤100ms、max≤500ms（容器内测量，不含公网RTT）；预期启动503单列 |
| SC-09 | collector close幂等；现有P1-21/46相关回归通过；免登录接口不新增敏感字段；不改探针超时或部署拓扑换取通过 |

SC-08为本条轻探针新预算，不改 P1-21／39／47 的重负载门槛；跨模块负载仍归发布取证。单元失败注入可用于开发测试，UAT须真实受控I/O、真实进程；替身降级须独立授权。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- `diagnostics.observedAt/ageMs/freshness` 为拟新增API机器字段；fresh/stale/unknown仅作技术状态，不新增WebUI产品概念。不得把“诊断陈旧”文案当权限过期或登录失效。正式API文档在获授权实现时同步。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；只改探针/诊断服务端响应与内部采集。
- 不改变：页面、路由导航、组件、按钮、空态、错误态与交互文案。

## 4. 决策、范围与风险

推荐内存状态加后台诊断；仅增加TTL不能消除请求刷新，独立“永远健康”的探针进程又会掩盖主进程卡死，均不采用。新增字段及30秒诊断滞后已在终稿确权范围内，本次保持原合同。失去磁盘或CPU仍可能影响业务；本条不承诺任意资源条件下零503。多副本、权限陈旧宽限、KTX源码改动均不在范围。

## 2026-11-20 首轮仅复现（历史）

[首轮跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repro.md)当时仅获复现授权，保留局部FAIL，不回改历史。后续委托人已明示授权按原Spec／Plan修复并本机Docker复测；当前授权及状态见头部。

## 已授权缺口修复与本次结果

诊断目录／文件I/O在独立Node子进程执行，主进程传已有探测、KTX缓存和执行观测证据；策略与授权仍归主进程。已有KTX CLI刷新不在短命读者中重复运行。10秒周期／5秒截止不变，abort／close终止私有进程组，等真实close再释放单在途；旧代／迟到结果不发布。未确认退出不假释放，保留stale。

仅给readFile加Signal不能停止每个底层OS请求，依据[Node22文档](https://nodejs.org/download/release/latest-jod/docs/api/fs.html)。本次用真实FIFO验证可终止执行边界，不外推不可中断内核I/O或任意PVC故障必可自愈。

先补真实FIFO取消／恢复／close回归，再在同一冻结候选做120秒探针采样与两轮路径恢复；恢复时不释放旧FIFO、不重启。

[修复跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repair.md)记录最终镜像、真实I/O／DB／TERM证据、PASS WITH GAP与完整矩阵剩余项。没有客户变更、提交、推送或发布；本次浏览器不适用。
