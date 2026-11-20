# 重任务跨模块容量控制与许可生命周期 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1-draft |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 / 优先级 | P1-62／REQ-030-083；建议 P1 第二批；不入核心分母 |
| 台账号 | 无 |
| 状态 | v0.1-draft。终稿已确权（委托人 2026-11-20 明示本提示词确权）；开发授权已获得；实现完成（本机 Vitest／Node 单元与组件测试通过）；测试台 NOT RUN；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 委托人授权按本合同实施运行代码、配套 Vitest、API 文档同步；不撤销正式完整导出延期，不新增 schema；禁止提交／推送／发布／客户升级；禁止执行真实 UAT／压测／Docker 故障演练（须另行授权） |
| 需求 / 计划 | [总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Plan](../plans/lucy-20261119-heavy-work-capacity-control-plan.md) |
| 测试台 | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md)，F62；无跑次 |

## 闭口层级

- 层级：功能合同
- 本条承诺：列入范围的重任务以有界的总容量和真实许可生命周期执行，排队、超时及取消不会造成超额执行或隐形重放。
- 本条出口：SC-01–10 的容量、许可、结果与恢复检查。
- 不在本条出口：全站零503、所有业务查询全局调度、各模块算法整改、正式完整导出修复、跨模块MCP旅程/网关/升级取证、多副本。
- 上线关系：本条收口不表示可上线

## 1. 复用与差集

见 [去重核对](../reviews/2026-11-19-core-availability-gap-assessment.md)。Spec174已有探测并发2/排队64/公平/超时/取消，Spec190的表探测有独立配额；P1-47已有重建worker；问数已有预算与并发门禁。**本条不重做这些能力。**

差集为审计重建、审计导出、批量表结构发现三类执行单元跨类别并行时，缺少可核对的总容量与统一许可接缝。此为静态范围核对，不等于证明这些任务已经导致本次客户503。F62须先冻结真实调用图，不能只验一个未接线的调度类。

## 2. 范围与设计决策

| 类别 | 许可执行单元 | 保留的原归属 |
|---|---|---|
| audit_rebuild | 一个用户的现有重建调用；沿用原持久化水位和worker | P1-38／39／45／47／50；不再次拆写事务 |
| audit_export | 当前可用审计导出请求的一次完整执行；许可保持到生成/输出终结 | P1-32及审计导出原合同；D7延期项不得被本条复活 |
| schema_discovery | 一次现有批量字段发现请求；内部缩批/重试共用许可 | P1-20／34；既有有限收敛、终态与时长预算不变 |

1. 三类总running上限2，每类running≤1；最多16个waiting票据；等待截止5秒。这是草案默认值，需先冻结改前基线再确权，不能临时调大资源或改阈值凑PASS。
2. 登录/会话读取、普通只读管理请求、MCP initialize/tools/list与合法问数、livez/readyz均不进入重任务队列，原鉴权、权限与预算继续执行。自动连通/表列表探测保留独立原队列，不重复获取本条总许可；不改变Spec190独立配额。
3. 执行单元必须在任何昂贵预处理、DB打开或结果构建之前获得许可。原子决定是否可同时满足总配额与类别配额，禁止占住总许可再等待另一个本地许可形成死锁。现有模块更紧的限制继续生效，适配器需建立唯一获取顺序。
4. 按类别轮转、同类FIFO；同类同身份最多4个waiting，其余拒绝，不让单个调用方占满全部等待位。后台重建只能保留1个调度票据，原dirty用户集合/恢复事实仍归维护器，不把每个历史用户展开成队列闭包。只对既有可安全合并任务复用结果，不合并导出或写请求。
5. HTTP排队拒绝/超时使用既有错误信封，拟新增 `WORKLOAD_CAPACITY_BUSY`、HTTP429、`Retry-After:1`；提示“任务较多，请稍后重试。”，不透内部路径。后台维护器保留dirty状态，每次准入失败后至少间隔5秒再试，直到原维护器成功处理或按原合同停止；不丢用户、不制造任务洪泛。既有PROBE_QUEUE_FULL等局部错误码不改。
6. 5秒排队计入原端到端截止，不能为新排队额外延长旧模块预算。运行超时/取消使用原模块合同，取消等待项可立即结算；**运行许可直到底层执行真实终结且子进程、DB连接与输出句柄等资源关闭后才释放**。事务安全停止点只决定领域终态与恢复，不是提前释放资源许可的理由。启动适配器必须在任何底层工作启动后、首个await或异常出口前登记真实settle句柄；启动后抛错但工作已受理时仍走同一句柄，不得按“未启动”释放许可。请求返回超时不代表后台已停；不可取消任务占用许可，禁止先释放再接受同类新任务。
7. 有请求身份/配置代次的任务在运行前及发布结果前重验既有屏障；等待期间吊销或变更按原门禁拒绝，后台维护任务沿用原代次检查。容量拒绝不能执行副作用或审计成成功；已提交事实不因随后撤权被改写成未提交，原合同有回执的操作在丢响应后仍按原回执查询，不自动重放写入，也不为无回执模块新造job API。
8. 不新建持久化队列表或公开job API；当前HTTP请求仍按原同步/流式响应合同结束。进程退出时只记录已有领域恢复事实；重建用原恢复协议，导出失败后由用户显式重试，不能宣称队列跨重启“恰好一次”。
9. 指标采用固定类别标签：running、waiting、oldestWaitMs、queueFull、queueTimeout、cancelPending、executionMs、queueMs；不以用户ID/Token/连接名产生高基数标签，不日志输出数据行。截止未能停止的任务必须可见。

## 状态与许可不变量

等待项可转为RUNNING、EXPIRED、CANCELLED或REJECTED；后三者不启动工作。RUNNING收到取消请求只转CANCEL_PENDING并继续持有许可；确认底层执行真实终结且资源关闭后才能转CANCELLED并释放许可，事务安全终态只供原领域恢复使用。已经提交成功则按原回执转SUCCEEDED，不伪装撤销。正常运行可转SUCCEEDED/FAILED。每个任务仅一个终态；未启动即授权失效/截止也必须释放已预留许可。等待票据是进程内状态，不替代领域持久化事实。

## 核心流程（伪代码）

```text
submit(task):
  authenticateAndValidateExistingContract(task)
  if not registeredHeavyEntry(task): return existingPath()
  if alreadyCancelledOrDeadlineSpent(): return existingCancelOrTimeout()
  if perIdentityQueueFull() or globalQueueFull(): return capacityBusyWithoutSideEffect()
  enqueueWithOriginalDeadline(task)              # 后台只一个pump票据
  dispatchByClassRoundRobinAndFifo()

dispatch(task):
  if waitingExpired(): removeWaitingAndSettleBusy(); return
  permit = tryAtomicallyReserveGlobalAndClassPermit()
  if permit == none: return                      # 留在waiting，无占用
  removeWaiting(task)
  operation = none
  try:
    revalidateIdentityAndGeneration()
    if cancelledOrDeadlineSpent(): settleWithoutStarting(); return
    operation = startExistingOperationWithCancellationAndOriginalDeadline()
    # 启动后、首个await/异常出口前必须登记真实settle句柄
    await operation.result
  finally:
    if operation != none:
      await operation.actuallySettledAndResourcesClosed()  # 事务安全点不提前释放资源许可
    permit.releaseExactlyOnce(); dispatchNext()

cancel(task):
  if waiting: removeAndSettle()
  if running: requestExistingCancel(); keepPermitUntilActualSettlementAndResourcesClosed()
```

## 受影响画像

为设计目标，尚无行为证据；[画像规范](../governance/user-personas.md)。

| 画像 | 变更前 → 变更后 | 判定 | 依据 | 补偿路径 |
|---|---|---|---|---|
| 问数方 | 后台工作资源竞争 → 普通MCP不新增本队列门禁 | ↑ | SC-07；系统共存另归R-CAV | 不要求WebUI身份；保留原问数预算 |
| 治理方 | 可立即尝试重任务 → 可能等待或429拒绝 | ↓ | SC-01／02／08 | 有界等待、Retry-After、明确失败且无隐形执行；容量释放后同入口合法重试完成，SC-08 |
| 运维方 | 分散限制难核对 → 总容量和取消持许可可观测 | ↑ | SC-03／09 | 不新增部署组件或手工清队列步骤 |
| 管理层 | 任务拥堵表现不明确 → 失败/繁忙与成功分开 | ↑ | SC-06／08／09 | 不把拒绝请求计性能成功 |

## 3. 验收标准

| 编号 | 可打假的标准 |
|---|---|
| SC-01 | 真实三类入口同时提交≥80次，running≤2、每类≤1、waiting≤16、同身份同类waiting≤4；内部重试和嵌套请求不绕过配额 |
| SC-02 | 等待耗时上界5秒加调度容差100ms；原总截止更短时取更短；未准入请求未打开重任务DB、未写领域结果、未启动worker工作 |
| SC-03 | 多轮取消/超时后实际未结束任务继续占许可；底层执行真实终结且子进程、DB连接与输出句柄关闭后只释放一次；包含“客户端已断开而子进程未退”“已到事务安全点但进程未退”及“启动后抛错但工作已受理”反例 |
| SC-04 | 饱和负载释放许可时类别轮转/同类FIFO生效；无死锁；已可执行的最老其他类别不被持续同类新请求插队 |
| SC-05 | 等待时权限撤回、配置换代，执行前拒绝且旧结果不得回填；导出金样本/批量发现终态/重建水位仍符合原合同 |
| SC-06 | 已提交事实不被后续撤权改写；原合同有回执的操作丢响应后可查且不自动重放，无回执模块不新造job API；重建dirty状态未丢、恢复复用P1-45／50；D7延期范围无运行逻辑变更 |
| SC-07 | 直接检查核心路由无重任务permit获取；模块饱和窗内真实轻量HTTP鉴权读取及不带WebUI Cookie的纯MCP `initialize`→`tools/list`→合法轻量数据查询均成交且结果正确；不新增纯MCP预算、工具暴露或身份前置 |
| SC-08 | 429含结构化code与Retry-After且无副作用；容量恢复后用相同合法输入显式重试成功，不能只证明拒绝；至少两个身份 |
| SC-09 | 真实执行记录中running/waiting等计数守恒，关闭/失败不泄漏票据；等待元数据内存随历史任务数不增长；日志无凭据/业务行 |
| SC-10 | Spec174／190的独立配额及取消释放测试、现有重建/发现/可用导出等价检查保持通过；接线清单覆盖全部三类，不以未接线调度器测试冒充完成 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- `WORKLOAD_CAPACITY_BUSY` 为本稿拟新增API机器码，用户提示为“任务较多，请稍后重试。”；不复用登录失效/无权限文案，不新增WebUI入口。实现前需同步API错误合同和既有通用错误呈现回归；若新增页面交互，须先撤销本稿交互豁免并补合同。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；不新增按钮或交互流程，仅由既有通用错误呈现承接服务端繁忙响应。
- 不改变：页面、导航、组件、表单草稿、确认流程、既有手动重试入口；不自动重放写请求。

## 4. 待决与非目标

优先选现有队列外的薄容量协调层；每模块各自调大阈值无法保证总上界，另建分布式任务系统则超出现单实例范围。默认2/16/5秒与适配接缝须终稿确认；若无法保持原模块截止/事务边界，回到本稿评审而非绕过模块合同。任何新的worker、索引、schema、KTX改动均须另行明确授权；本条不能靠限流掩盖原模块算法退化。
