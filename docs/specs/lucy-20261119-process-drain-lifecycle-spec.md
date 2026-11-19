# 进程关停准入关闭与在途请求排空 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1-draft |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 / 优先级 | P1-63／REQ-030-084；建议 P2 第三批；不入核心分母 |
| 台账号 | 无 |
| 状态 | v0.1-draft。仅文档；终稿未确权；开发未授权；测试台 NOT RUN；不入核心分母；≠ 可上线。 |
| 授权边界 | 只写文档；旧Spec191顺序仍生效，本稿是待审增量；未授权不改入口脚本/信号/配置/测试执行器 |
| 需求 / 计划 | [总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [Plan](../plans/lucy-20261119-process-drain-lifecycle-plan.md) |
| 测试台 | [UAT-SUITE-CORE-AVAILABILITY](../qa/uat/suites/core-availability/suite.md)，F63；无跑次 |

## 闭口层级

- 层级：功能合同
- 本条承诺：可捕获的整实例关停先关闭新业务准入，在有界排空期间保留在途请求所需依赖，然后清理退出，不能把未完成操作记为成功。
- 本条出口：SC-01–09的真实进程信号、准入竞态、依赖顺序与终态不变量。
- 不在本条出口：零中断升级、实际网关摘端点传播时间、节点故障/SIGKILL/OOM无损、跨模块Agent旅程、多副本HA。
- 上线关系：本条收口不表示可上线

## 1. 既有合同与差集

已有 `docker-entrypoint.sh` 清理函数、有限等待、孤儿KTX清理；Spec191 §4.2.3／§4.4 **显式要求先停supervisor/KTX**。`index.ts` 有onClose资源清理，但没有跨Web/MCP的新请求准入关闭与整实例在途排空合同。发布重索引中的局部 `DRAINING` 不等同进程退出，不能复用其状态文件作退出状态。

本稿建议新增“先通知Lucy停止新准入并排空，再进入原supervisor清理”的整实例协议；这会改变旧合同顺序，**必须在终稿确认时同次批准Spec191对应段落的具名修订**。本轮不修改旧正文、不声称已兼容或已修复事故。启动和监听就绪仍归P1-39／46，重建中断恢复归P1-45／50。

## 2. 生命周期与顺序

| 状态 | 新业务请求 | 就绪/存活 | 离开条件 |
|---|---|---|---|
| BOOTING | 依原启动门禁 | readyz503；可监听后livez200 | 原预热及两监听完成 |
| SERVING | 依原鉴权准入 | readyz200/livez200 | 已确认整实例TERM/INT |
| DRAINING | Web与MCP原子关闭新准入；既有在途继续 | readyz503/livez200，直到服务关闭 | 在途全终结或20秒排空截止 |
| STOPPING | 拒绝新工作，不回SERVING | 接口关闭后无响应，不造200 | 原supervisor/KTX有界清理 |
| STOPPED | 无 | 无 | 终态；新进程重新BOOTING |

1. 父entrypoint是整实例关停owner，重复TERM/INT/EXIT加入同一个关停过程；内部受控信号/已有进程通信确认Lucy已进入DRAINING，不新增公开HTTP关停接口，不把普通执行层reload误认整实例关停。
2. Web/MCP业务入口共用生命周期准入屏障：同步检查SERVING与登记在途计数必须是一个不可分割步骤。Lucy观察到整实例关停通知前已登记的请求算在途；屏障原子关闭后的业务请求只能拒绝，不能先检查后异步登记制造漏单。父entrypoint收到外部TERM/INT到Lucy确认DRAINING之间是显式交接窗，此间已受理请求也必须纳入在途，验收不得把外部信号发送时刻误当屏障已关闭。livez/readyz/health沿P1-61的诊断路径，不加入业务在途登记；DRAINING时health仍按原诊断语义回应，不能被这个屏障一概拒绝成503。
3. DRAINING不抢先终止KTX；流式SSE以一个已受理业务RPC到终态为计数单位，不能等待永不关闭的空闲会话；空闲连接可通知/关闭。客户端断开不等于后端任务终结。业务适配器必须在底层工作启动后、首个await或异常出口前登记真实settle句柄；启动后抛错但工作已受理时不得按未启动注销。已受理后台工作同样登记；停止新调度后，未启动的等待项结算且不执行，原dirty/恢复事实保留，不得把后台等待项漏出排空计数。
4. 运行中的只读查询在20秒内可完成；重任务取消到既有事务安全点决定领域恢复，资源许可仍按P1-62在实际执行终结且资源关闭后释放。到期尚未完成的操作按原持久化回执/不确定结果处理，不伪造成功或自动重放；只有原合同已有回执的操作才要求查原回执，不新造通用job API。重建用P1-45／50续跑，不新增恢复库。
5. 新HTTP业务请求用现有503错误信封，拟机器码 `SERVICE_DRAINING`；不返回固定 `Retry-After`，因为单实例停止后1秒并不构成可执行的恢复时间。MCP HTTP/RPC错误按当前传输允许的信封返回同一可诊断原因，不伪造成功tools/result或清空权限。提示服务恢复后显式重试，写请求不得自动重放。
6. 整实例预算草案：排空≤20秒，取消通知与剩余状态记录包含在这20秒内，不另加无界等待；随后supervisor/KTX清理默认10秒，孤儿清理≤5秒，Lucy关闭与其余收尾共用剩余5秒，总退出≤40秒。外部stop/grace必须≥45秒才承诺完整预算；标准Docker demo的Compose配置须在同一实现中显式提供至少45秒，否则只能声明定制测试台通过，不能声明默认Docker路径具备完整排空。已有stop超时配置大于10秒时，先校验总预算并明确冲突，不能暗中缩短旧超时。SIGKILL/OOM/节点故障不保证排空，仍依原恢复协议。
7. 只有在途计数归零/达到截止并记录剩余状态后，父进程才进入依赖清理；Lucy子进程结束不应让父 `wait -n` 路径跳过有界清理。观察日志包括drain开始、准入关闭、在途数、deadline、KTX停止、退出原因，使用固定标签，不记录业务内容。
8. 生命周期内存单向转移，诊断后台更新不得将DRAINING覆盖为SERVING。关闭期间仍执行原授权/提交屏障，不新增缓存权限宽限。关停非终态不作为跨启动持久事实，领域操作仍按其原协议恢复。

## 核心流程（伪代码）

```text
admitRequest(request):
  atomically:
    if lifecycle != SERVING: return transportCompatibleDrainingFailure()
    registerInFlight(request)                 # 已受理业务RPC，不是空闲SSE连接
  try:
    operation = startExistingAuthorizedOperationWithSettleHandle()
    # 启动后、首个await/异常出口前必须登记真实settle句柄
    await operation
  finally: unregisterOnlyWhenOperationActuallySettles()

onInstanceShutdown(signal):
  if shutdownPromiseAlreadyExists(): return existingShutdownPromise
  createSingleShutdownPromiseOwner()
  atomicallySetLifecycle(DRAINING)             # 含readyz与两入口准入
  acknowledgeDrainToParent()
  stopNewBackgroundScheduling()
  settleWaitingWorkWithoutStartingIt()             # 保留原dirty/恢复事实
  waitForSettledOperationsOr20sDeadlineWhileKtxStillAlive(
    onDeadline: requestSafeCancellationWithoutExtendingDrainBudget()
  )
  recordOnlyExistingDomainOutcomes()                # 不新建通用不确定结果表
  setLifecycle(STOPPING)
  parentStopsSupervisorAndKtxUsingExistingCleanup()
  closeLucyAndAllTimersWithinRemainingBudget()
  setLifecycle(STOPPED)
```

## 受影响画像

为设计目标，未取行为证据；[画像规范](../governance/user-personas.md)。

| 画像 | 变更前 → 变更后 | 判定 | 依据 | 补偿路径 |
|---|---|---|---|---|
| 问数方 | 关停可能直接断依赖 → 已受理请求有排空机会，但新请求明确拒绝 | ↓（按最差子面） | SC-01–04／08 | 重启后不带WebUI Cookie的纯MCP重新连接并完成原合法只读查询；有原回执的写操作按原身份/入口查询，不新增WebUI依赖，SC-08 |
| 治理方 | 直接断连 → 短期503且不丢已证明提交结果 | ↓（按最差子面） | SC-03／05／08 | 明确draining错误与服务恢复后重试提示；保留原失败恢复/回执入口，恢复后同输入合法完成，禁止自动重放，SC-08 |
| 运维方 | 快速停依赖 → 退出最长40秒、要求足够grace且过程可观测 | ↓ | SC-06／07 | 输出预算冲突、截止与剩余任务；保留有界强制清理，不无限等待 |
| 管理层 | 退出时成功/中断难区分 → 完成与不确定分开 | ↑ | SC-05／07 | 不承诺单副本零中断 |

## 3. 验收标准

| 编号 | 可打假的标准 |
|---|---|
| SC-01 | 真实TERM与新HTTP/MCP请求竞态≥100轮，无任何屏障关闭后新受理；不靠睡眠推断信号已生效 |
| SC-02 | DRAINING readyz503、仍监听时livez200、health保持原诊断语义；迟到诊断/监听回调不恢复Ready；原P1-46启动先后不回退 |
| SC-03 | 用真实有限延迟依赖构造10秒在途查询，TERM后KTX继续存活直到结果终结；操作仅执行一次，无提前上游断连 |
| SC-04 | 空闲长SSE不阻塞排空；已受理RPC、客户端断开或启动后抛错但底层仍运行的工作被正确计数；后台等待项不启动且原dirty事实保留；重复信号不双释放或双提交 |
| SC-05 | 超过20秒的任务不伪成功；原合同有回执的操作提交成功但响应丢失仍能查原回执，无回执模块不新造job API；未完成重建保留原可恢复状态 |
| SC-06 | 排空/依赖清理/总退出预算均满足，取消通知与剩余状态记录不额外延长20秒；标准Docker demo渲染配置的stop grace≥45秒；无TERM可杀不净孤儿；grace不足或自定义stop超时冲突不宣称有界排空通过 |
| SC-07 | 正常、失败与强制退出的日志可关联且无凭据；原entrypoint退出码与supervisor崩溃清理合同仍成立 |
| SC-08 | 恢复启动后原合法HTTP主任务成交；无WebUI Cookie的纯MCP `initialize`→`tools/list`→合法轻量数据查询成交且结果正确；有原回执的未知写结果先查回执再处理，无自动重放 |
| SC-09 | Spec191顺序修订有明确确权记录；只读数据查询的结果/授权、执行层reload及原恢复水位不被本条改写 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- `SERVICE_DRAINING` 为拟新增API机器码，提示“服务正在停止接收新请求，请在服务恢复后重试。”；不使用固定 `Retry-After` 暗示尚未确定的恢复时间。生命周期状态仅工程术语。正式API文档和现有错误呈现兼容在授权后更新；本轮不增加WebUI操作。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；仅新增进程生命周期和既有错误呈现可承接的服务端响应。
- 不改变：页面、按钮、表单草稿、导航与既有恢复入口；不增加公开关停入口。

## 4. 决策与范围

推荐先排空再依赖清理；仅加preStop睡眠缺少准入屏障和完成证据，不采用。多副本切换不是本合同。旧Spec191顺序、内部通信方式与20/40/45秒预算均待确权；未经确认不能开始脚本改动。内部通信必须限定本实例且可验证接收确认，不能依靠公开无鉴权管理端点。新增通信文件或信号约定不得携带凭据；不改KTX源码。
