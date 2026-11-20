# MCP执行层热重载在途保护与统一截止 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1-draft |
| 功能编号 / 优先级 | P1-69／REQ-030-090；不入核心分母 |
| 台账号 | 无 |
| 日期／基线 | 2026-11-20／7dded5478a05e256aa23d33567b49beb3820ec3b |
| 状态 | v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| 授权边界 | 用户已批准执行CA-00–09；本任务只交合同材料，CA-06须先有正式合同与G2记录；不push／发布／改客户环境 |
| 需求／计划／测试台 | [总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) · [Plan](../plans/lucy-20261120-runtime-reload-drain-plan.md) · [UAT](../qa/uat/suites/core-availability/suite.md) |
| 验收 | 本Spec末尾SC-01–12验收矩阵；功能合同出口，不倒挂完整R-CAV |

## 闭口层级

- 层级：功能合同
- 本条承诺：单实例配置重载在有界总截止内保护既有、授权仍有效的正常短MCP在途，切换时新请求得到明确可重试拒绝，真实失败与恢复不伪造。
- 本条出口：SC-01–12的真实HTTP／MCP、真实KTX进程、在途终态、失败恢复、授权收紧与截止反例；组件测试补边角。
- 不在本条出口：任意长查询零中断、任意不可中断内核I/O硬终止、多副本切换、KTX源码改动、旧会话保留、整库Agent旅程、客户现场readyz根因或发布取证。
- 上线关系：本条收口不表示可上线。

## 已有合同与差集

| 承诺 | 现有归属 | 本轮决定 |
|---|---|---|
| supervisor唯一子进程owner、requestId／digest、全局single-flight、迟到回执不串单、超时查真实通道 | Spec191 §4–6／现有实现 | 复用并回归，不另造控制器／协议通道 |
| 配置已保存不回滚；进程成功与配置核验分层；失败可重试 | Spec191／P1-64 | 保留；错误不可改写磁盘提交事实；runtimeAck仍为Policy兼容别名 |
| 整实例TERM drain-first与真实MCP句柄／response gate终态 | P1-63／已有修复 | 复用工作登记，不改变20／40／45秒关停合同 |
| 热重载前保全短在途，新请求有界拒绝，超时不误杀 | 未被Spec191或P1-63覆盖 | **新合同差集**，先入账再实施；不能借旧TERM PASS代签 |
| drain／stop／start／核验共用调用级60秒总截止 | 现有60秒只约束receipt，直接模式逐段20秒 | **新合同差集**；具名修订Spec191截止描述并保持其原回执与失败语义 |
| 同digest自动跳过／合并已完成请求 | 现有无可靠完整语义 | 本轮不引入已完成请求去重；自动请求继续串行／single-flight，手动相同digest仍是真实重载。内容代次不在ktx digest内，不可仅凭digest跳过Manifest影响 |
| 上传Manifest自动KTX重启 | 实际只有静态reloadCatalog | 不新增；测试区分上传目录更新与启用表自动重载 |

## 决策与预算

1. **选择新请求立即拒绝，不进行队列等待。** reload owner持有可逆MCP准入屏障；新RPC收到HTTP503、既有错误信封，code=`EXECUTION_RUNTIME_RELOADING`，message=`执行层正在重载，请在重载完成后重试。系统不会自动重试本次请求。`。不添加固定Retry-After，因失败时无法保证下一秒恢复；不返回成功tools/result。屏障前已受理RPC继续原授权／预算／审计。
2. **保护范围是正常短在途，20秒排空上限。** 通过MCP专属真实settle集合等待，包含handler、全部实际upstream close及durable response gate终态。客户端close不等于实际完成；闲置GET/SSE不占排空计数。reload不能等待自己的管理员HTTP／保存请求。到20秒仍有工作，**在stop之前失败退出**，不杀KTX，不自动重放；新配置已保存但未加载时保留真实stale／pending，当前旧进程仍在不意味着旧权限可用。
3. **调用级总预算60秒，不扩大原receipt上界。** 自调用入口计时（直接模式排队也计），所有前置、排空、请求传递、stop／端口释放、start、连接核验／收尾共用同一deadline。阶段上限为排空20秒、stop＋端口释放合计10秒、启动就绪20秒、连接核验10秒；每一步实际超时都取`min(阶段上限, 总剩余)`。这些是上限，不能相加后重置额外时间；前置／排队消耗会削减后续剩余。
4. 20秒沿用已确权P1-63的短在途排空额度，SC用真实10秒查询证明；stop10秒沿用现有supervisor默认；start20秒沿用直接模式原单步额度，现有注释给冷启动通常2–6秒；verify10秒沿用已有核验上界。总60秒沿用Spec191现行receipt等待额度，但改为真实总额度。默认参数不足时失败，不放宽budget凑绿。自定义stop／测试override不得突破总额度。
5. **deadline必须约束真正执行层。** supervisor请求增加可验证的绝对过期时间／剩余预算字段，发送前与消费后都检查；过期未消费请求不得稍后重启KTX。被消费后supervisor各循环使用同一剩余额度，不能只让Node停止等回执。Node检查真实busy与结果；仍有真实执行则屏障不能按客户端超时假释放，后续触发按Spec191报告already_running并核对旧requestId。测试需证明实际子进程终态，不以docker客户端退出代替。
6. 停止／启动失败按已有Spec191如实报告，保留已保存配置，不自动回滚、不造成功observation。清理／通道事实证明旧工作终结后可退出临时屏障，由原execution-stale门禁继续失败关闭；路径恢复后同一合法身份新会话重试原查询必须能成交。不能一直要求人工重启整个Lucy。
7. **TERM最高优先。** 处于整实例DRAINING／STOPPING／STOPPED时不能新建reload；在排空或切换期间收到TERM，未发请求不再发，未消费请求取消自己的requestId，已消费由真实通道收尾及原关停owner接管。reload的finally只能撤自己的可逆标记，不能将整实例恢复SERVING或恢复被吊销身份。
8. 自动与手动均复用现有owner与single-flight，不建立第二套调度器。supervisor能力存在走原通道；明确unsupported才允许原自动写路径走CLI兜底，其他失败不得转兜底绕开状态。无supervisor的显式管理员API仍按Spec191返回unsupported。直接CLI使用同一屏障／总deadline，不能在reloadChain无界等待或每段重置20秒；成功须区分端口与真实配置核验证据。
9. 授权收紧／吊销优先于保全查询。只有授权仍有效的请求享受排空完成承诺；原currentAuthorizationSequence、upstream／response barrier、预算和审计完全生效，不能缓存旧权限放行。若配置变化使原输入不再合法，返回具体原门禁原因；其拒绝不能伪装成reload成功或免验恢复。
10. 本轮不改页面、表单或按钮，沿已有错误呈现；新增机器码与恢复提示在正式Spec的术语小节登记。如实现需要改变WebUI保存反馈，撤销豁免并补前台浏览器＋计时，不用API代签页面。

SC-03取证字段：拒绝的既有error信封携带同一真实屏障owner的`requestId`、`deadlineAt`（Unix epoch毫秒）及同步准入拒绝时捕获的`rejectedAt`（Unix epoch毫秒）。它们仅定位这次拒绝，不携带身份凭据、问句或DSN；不新增公开路由。已有reload owner以有界工程事件记录acquire／release及实际终态，拒绝按owner精确闭包归属，不能按客户端响应晚到或宽泛重载时间窗免除失败。自然窗后同身份／同session显式恢复单独计数，不能回填自然吞吐。

## 核心流程（伪代码）

```text
# lifecycle primitive放在既有MCP真实工作登记接缝；requestId和控制归原reload owner
admitMcpRpc():
  synchronously:
    if wholeInstanceNotServing: return original SERVICE_DRAINING
    if reloadBarrierOwned: return EXECUTION_RUNTIME_RELOADING with explicit retry
    register existing real RPC settle in MCP-specific set
  execute original authentication/ACL/budget/upstream/response path exactly once
  retire only when handler + accepted upstream close + response gate actually settle

existingReloadOwner(input):
  invocationDeadline = now + min(configuredTotal, 60s)
  apply existing global inflight and real-channel reconciliation
  reject unsupported using original route/fallback contract
  read current disk digest and expected config with remaining deadline
  synchronously acquire reversible MCP barrier if instance still SERVING
  try:
    wait MCP-specific actual work settle for min(20s, remaining)
    if not drained: return failed; DO NOT stop KTX or publish a restart request
    if instance shutting down or deadline expired: return failed, no new restart
    publish existing requestId/digest/requestedAt + shared expiration
    # supervisor owns actual stop/start; CLI owner uses same expiration directly
    stop/release/start/verify all receive remaining deadline (never reset)
    reconcile real receipt + connection-level evidence + current disk generation
    persist original separate process/configuration/activation facts
    return truthful original reload result
  finally:
    cancel only this unconsumed request when needed
    release temporary barrier only once real destructive execution is terminal
    never change whole-instance phase; TERM cannot be undone

supervisorConsume(request):
  atomically consume original request file
  if expired: write matching failed receipt; DO NOT stop/start KTX
  stop and wait actual child using shared deadline; no unbounded zombie assumption
  start at most once; await actual readiness within same remaining budget
  write matching actual receipt; original bounded BACKOFF remains an independent fact
```

`real destructive execution terminal`指实际stop/start阶段已完成／关闭，不能用timeout Promise已reject代替；任意不可中断内核I/O不作硬保证，须如实记录未终结／不可用，不能伪造恢复。

## 受影响画像

| 画像 | 变更前→变更后 | 判定 | 可核对依据 | 补偿 |
|---|---|---|---|---|
| 问数方 | 重载可能中途断查询→短在途有排空；新查询暂时明确拒绝 | 问数面↓／报告面＝；按最差判↓ | SC-01／02／03／04／07／10；报告路径未触碰 | 同一合法Token在切换结束后新initialize并重试同一只读原问题成功，SC-10；无需WebUI、person、宿主attestation，不自动重放。有限拒绝且有纯MCP恢复，不构成无逃生主路径禁用 |
| 治理方 | 保存可能直接截断业务→保存等待有总截止，提交／运行事实真实 | 语义口径面↓／权限授权面＝；按最差判↓ | SC-05／07／09；Policy ack与授权规则未改 | 保存已提交不重复写，按原状态／回执核对，再显式重载恢复；SC-09／10；若UI改变增加浏览器计时 |
| 运维方 | 回执超时可能仍在重启→真实执行与调用共同受限 | 运行观察面↑／交付运维面＝ | SC-05／06／08／11；不改交付拓扑或出包 | 不增加客户kill进程步骤；失败事实与已有重试入口真实 |
| 管理层 | 局部TERM成功被误当重载无中断→有独立SC与失败分母 | 口径质量面↑／业务结果面＝ | SC-09／12；不改业务指标 | 只报告实际覆盖，完整F62／F63／R-CAV及客户根因仍分开 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- `EXECUTION_RUNTIME_RELOADING`：API机器码；中文沿用“执行层重载”，提示明确完成后重试且无自动重放。不得写“查询成功”或泛化为“Schema不可判定”。
- 临时reload barrier、deadline、inflight是工程实现术语，不新增产品模块／导航。
- 内部requestId、digest、文件路径的用户可见DOM若被新增呈现，按术语标准添加浏览器翻译防御；本轮不新增DOM节点。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；本条仅改变服务器MCP生命周期与既有错误信封，不新建按钮／表单／导航。
- 不改变：现有保存事实、Policy/Catalog/Execution ack分工及恢复入口。若实现改变WebUI反馈，须撤销该豁免，纳入前台浏览器＋计时验证。

## 正式落盘与开工前置

M先在现行0.30总账／REQ登记真实新差集（不入核心分母也要有行），再落同名Spec／Plan、docs索引与core-availability suite用例。具名修订Spec191：热重载保护由新合同补充，不修改P1-63整实例生命周期边界；60秒解释改为本条统一deadline，不保留相互矛盾的逐段重置承诺。终稿由Codex CLI终审或委托人明示确权；运行增量开发授权与用户已批准执行的范围一并记录G2。合同本身不自动变PASS。

## 验收标准

| 编号 | 反例／约束生效 | 合法用户／恢复证明 | 必须证据／归属 |
|---|---|---|---|
| SC-01 | 屏障关闭与新RPC并发≥100次，无屏障后的新upstream受理；业务不自动重放 | 屏障前真实10秒查询在授权仍有效条件下只执行一次且结果4／100 | 组件竞态＋真实HTTP/MCP／MySQL sleep已受理标记；原P1-63登记基础不替代本条 |
| SC-02 | 活跃RPC客户端断开、handler启动后抛错、durable response gate未结束时不能提前退票 | 实际upstream与response gate结束后才允许stop；闲置GET/SSE不阻止切换 | 真实句柄／HTTP流回归＋KTX stop时间线，组件测试补边角 |
| SC-03 | 切换新RPC明确HTTP503 EXECUTION_RUNTIME_RELOADING且无数据执行／预算消耗；不设置假恢复时刻 | 同一合法Token无需WebUI可重新initialize→tools/list→原只读问题4／100；吊销者仍拒绝 | 原始MCP回执／预算前后事实／唯一执行计数；所有拒绝保留失败分母 |
| SC-04 | 超过20秒仍有真实RPC：stop请求与KTX PID变化均为0，不能用全局HTTP计数自等 | 旧查询按原合同终结；配置未加载保持stale；原owner可随后显式重载并恢复 | 有限>20秒真实任务、实际PID／通道未发、caller失败＋工作终态分列；不延长查询预算 |
| SC-05 | 总60秒从入口计，直接链排队／前置／drain／stop+端口／start／verify均消费同deadline；各段无重置 | 正常10秒任务＋正常start/verify可完成，轻载probe原预算不退化 | 短override组件截止＋真实默认上界测量；实际子进程close/exit证明；caller超时不能当owner停止 |
| SC-06 | 截止后未消费请求不能迟到stop/start；已消费未真实结束不得释放slot／屏障或再发第二次 | 原requestId真实终态确认后有界撤自己的屏障，原身份恢复；旧回执不得完成新请求 | supervisor真实过期请求、late receipt／busy状态／启动计数；同digest与不同digest均覆盖 |
| SC-07 | 收紧／吊销发生于drain、upstream或response阶段，旧权威代次不能放行 | 未受收紧影响的合法身份仍可恢复原问题；被吊销身份始终拒绝 | 原authorization sequence／response barrier回归＋真实MCP两身份对照 |
| SC-08 | 在drain、stop/start、verify阶段与TERM竞争，TERM后无新reload、无重开SERVING | 原P1-63 drain-first、20／40／45秒预算和重启原卷恢复仍成立 | 实际TERM、Node/KTX PID、退出码及新RPC拒绝；≥3类阶段交错；TERM旧跑次不能代签 |
| SC-09 | 存储不可用、启动失败、核验失败、磁盘digest变化都不伪报current／success、不回滚已保存配置 | 修复路径后同一合法身份重新连接成交；未知写结果按既有回执处理，禁止自动重放 | 进程事实／requestedActualCurrent digest／配置核验分列，原P1-64 ack语义回归 |
| SC-10 | 手动相同digest仍发真实重载；自动重载不能凭无关旧证据吞请求；并发均使用原single-flight | 有效自动写保存与显式重载后新短名读取及普通查询正确；12轮正式周期另归FUP-01 | 自动与手动、同／不同digest、旧会话失效后同身份新会话的真实回执 |
| SC-11 | 无supervisor时自动CLI兜底有相同排空／deadline；显式API仍unsupported且无副作用；能力存在但失败不绕到CLI | 直接模式正常短在途、新准入拒绝和同身份恢复通过 | 直接CLI真实process／HTTP测试＋supervisor Docker对照；TCP成功不能代替配置证据 |
| SC-12 | 所有失败／拒绝／超时／截尾及真实执行中状态有完整记录；组件绿不可冒充真实跑次 | 每个↓补偿都有相同身份／相同问题恢复证据，原FAIL保留 | run记录、原始JSONL、hash、镜像／工具身份、SC逐项判定；未跑标NOT RUN |


## 关联

- 需求／计划：P1-69／REQ-030-090已登记，见头部总账、需求池及Plan链接。
- 测试台：UAT-SUITE-CORE-AVAILABILITY；新增用例归本Spec，既有FAIL／GAP不被覆盖。
- Spec191 §4–6具名增补：热重载不调用整实例shutdown；调用级60秒与真实owner终态分别记录。
