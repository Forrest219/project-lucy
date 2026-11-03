> **后续处置（2026-10-29）**：N01–N12 已写入当时的 Spec v0.4 / Plan v0.7。本文件仍是第 2 轮对 v0.3 / v0.6 的结论。
> **第 3 轮（2026-10-30）**：见 [`2026-10-30-question-budget-round3-final.md`](2026-10-30-question-budget-round3-final.md)。结论是定稿 v1.0。本文件的退回结论不因此改写。

1. **退回修订。阻塞 3 条、高 7 条、中 2 条、低 0 条，共 12 条。**

本结论针对 Spec v0.3 / Plan v0.6 的推荐方案和伪代码，不以 D1–D9 未签字或缺少台账号作为退回理由。

已阅读两份待审文档、第 1 轮报告、Spec 162 §7.2，并核对指定源码的相关路径；大型源码文件未通读无关部分。全程只读，未修改文件、未提交、未运行测试、构建或服务。以下是静态设计结论。

2. **第 1 轮 R01–R14 闭合表**

| 编号 | 判定 | 理由 |
|---|---|---|
| R01 | 闭合 | `pendingToken` 已进入持久状态，声明和消费共用作用域锁，确实存在从工具声明到下一次数据调用的传递路径。 |
| R02 | 部分闭合 | 已改为上游结束结算并要求生命周期开始时安装协调器，但绝对时限与“取消不可行则继续计时”的关系仍未解决。 |
| R03 | 部分闭合 | 准入只看已结算 `busyMs` 的软上限语义已明确，但单问询 600 秒结论错误，执行时限也不足以证明资源上界。 |
| R04 | 部分闭合 | 票据和旧窗口晚结算分流已补上，但换窗时已有结算耗时没有归档，`ticket.round` 也未参与结算归属。 |
| R05 | 未闭合 | 虽已统一调用 `commit`，重复幂等键仍会发布未经本次持久提交的候选态，失败后的核实路径也不完整。 |
| R06 | 部分闭合 | 稳定作用域解决预算换桶，但恢复的 `turnId` 如何进入现有准入归属冻结和慢问询观测，尚无流程。 |
| R07 | 闭合 | 新作用域和取代流程均明确包含认证身份，同名及空会话不会跨身份取代。 |
| R08 | 部分闭合 | begin 之间串行、握手事务内重检已规定，但 begin 与消费、结算没有明确共用同一把锁。 |
| R09 | 部分闭合 | ACL、known tools、角色迁移已有 Plan 动作，但新工具仍会撞上现有 `connection_required` 入参闸，Wiki 专用角色分支也缺少确定分类。 |
| R10 | 部分闭合 | 两条入口已纳入范围，但伪代码遗漏非 ALLOW 分支，且消费位置早于内部源授权。 |
| R11 | 闭合 | 已撤回服务端默认 `outcome=ok` 的错误归因，保留显式筛选，并明确四桶与八桶的不同职责。 |
| R12 | 部分闭合 | 阶段顺序与回滚表已改善，但若干阶段退出条件依赖后续阶段，尚不能独立验收。 |
| R13 | 部分闭合 | SC 已补表格维度，但仍存在单位、观测时点和“被拦下却记额度”的矛盾。 |
| R14 | 闭合 | 三条术语修订、有效章节引用及“不计预算的本地工具”表述均已有明确落点。 |

3. **新发现列表**

以下使用 N01–N12，与第一轮编号区分。

**N01｜阻塞｜重复幂等键成功后直接发布候选态，仍会造成内存与持久态分叉**

- **位置：** [Spec §6.4，369–381 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:369)，§6.3 的 `stop:` 键；Plan §3.1、S2、S3。
- **问题：** `persistence.save` 对重复键“不再写入、视为成功”，随后却无条件 `publish(candidate)`。存在正常路径反例：同一 turn 首次停机写入 `stop:T`；续查将 `presentedToken` 清空；第二个窗口耗尽后再次生成 T，重用 `stop:T`，磁盘不更新而内存发布了新凭证。若同一结算键通过另一张未标记 settled 的票据重放，重新计算的增量候选态也可能只在内存双计。另一个缺口是 catch 中再次 `load` 若失败，会在设置不可用之前抛出。
- **影响：** “候选态 → 幂等落库 → 再发布”不能成立；重放和不确定提交可能丢更新或双计。现有 [BudgetPersistence](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:89) 只有普通 load/save，Plan 所称“接口不变”也未承载这些能力。
- **最小修复：** 提交接口返回权威提交结果及版本；重复键发布已提交状态，不能发布重算候选态。键绑定作用域、轮次、窗口及操作；核实失败也进入不可用状态。补提交前失败、提交成功但返回失败、独立票据重放及连续两窗口停机的 SC。

**N02｜阻塞｜begin 与 consume / settle 的锁边界不同，仍可覆盖彼此提交**

- **位置：** [Spec §6.5，394–407 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:394)，§6.2、§6.3；Plan S7。
- **问题：** begin 使用 `withIdentitySessionSerialization`，消费和结算使用 `withScopeSerialization`，正文只保证 begin 之间串行，没有规定两者共用锁。begin 读旧状态后等待提交时，消费或结算仍可基于同一旧态生成另一份全量候选态。
- **影响：** 后提交者可能覆盖新轮次、调用计数或耗时；两个并发 begin 的 SC-33 无法发现该问题。
- **最小修复：** 所有预算写操作进入同一个 scope 队列，并规定归属登记的线性化点与锁顺序。补 begin × consume、begin × settle 的并发 SC，核对预算、活跃 turn 和已准入请求归属。

**N03｜阻塞｜首次 begin 不写预算态，后续 begin 也可能永远无法取代**

- **位置：** [Spec §6.5，396–407 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:396)；Plan S7。
- **问题：** 新轮次候选态和 commit 全部位于 `previousTurn != null` 分支内。全新作用域的 `turnId=null`，首次 begin 只登记注册表，没有保存 `turnId`；§6.3 consume 也不补写它，因此之后的 begin 仍可能看到 null。已有轮次的取代候选态还遗漏清除 `presentedToken`，并沿用旧轮次时间起点。
- **影响：** 新问询建轮、持久归属、预算刷新和凭证生命周期均无法按设计工作；旧凭证还可能被新轮次继续接受。
- **最小修复：** 每次 begin 都构造并提交完整新轮次，只有归档前轮次是条件分支；明确重置凭证与新问询时间起点，保留真实在途占用。补首次 begin、无 begin 已消费后首次 begin、旧凭证跨轮次失效的 SC。

这里**不把显式 begin 获得新额度本身判为漏洞**：Spec 162 §7.2 的“由客户端决定是否再问”、本 Spec §6.5 和 Plan S7 已共同表达“新问询即新额度”。稳定预算身份防止的是同一轮次因空闲、归属缓存过期或重启换桶，并未定义跨问询累计配额。

**N04｜高｜换窗会丢失此前已结算耗时，跨轮次晚结算也缺少归档目标**

- **位置：** [Spec §6.3，310–316 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:310)，§6.2、§6.5；Plan S3、S5、S7。
- **问题：** 续查直接将 `busyMs=0`，没有先把旧窗口已有 `busyMs` 转入归档；settle 只归档晚到的增量。例如换窗前已结算 110 秒、换窗后旧请求再结算 10 秒，归档只得到 10 秒。轮次取代的 `archiveRound(state)` 又发生在 commit 之前，settle 虽携带 round 却完全不使用。
- **影响：** 总处理时长与轮次归档计数不可完整追溯；SC-12 只检查晚到增量，不覆盖已经结算的部分。
- **最小修复：** 在同一提交中完整归档旧窗口，再清零当前窗口；归档键包含轮次和窗口，晚结算更新原轮次。补“已有结算量＋晚结算量”和“取代后旧请求完成”的 SC，并明确归档存储落点。

**N05｜高｜600 秒是单窗口上界，不能写成单问询上界**

- **位置：** [Spec D1 推荐理由，168 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:168)，§6.1 的 227 行。
- **问题：** 一次续查将 busy 和调用次数归零，因此一个问询可以获得两个窗口。即使每次执行严格不超过 120 秒，也可以每窗口先结算 110 秒，再准入四个各执行 120 秒的请求，两个窗口合计 1180 秒。
- **影响：** “单问询最坏 600 秒”的资源承诺被自身续查算法直接推翻。
- **最小修复：** 将 600 秒明确为单窗口上界；在绝对时限确实成立的前提下，单问询保守上界改为两个窗口合计 1200 秒。增加覆盖续查的总量 SC。若坚持单问询 600 秒，须另设不随续查归零的总量约束。

**N06｜高｜发出取消请求不等于在绝对时限内结束，有限资源上界仍未证明**

- **位置：** [Spec §6.2，263–267 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:263)；Plan S3；[mcp-proxy.ts:254](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:254)、[291](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:291)、[386](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:386)、[5490](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:5490)。
- **问题：** §6.2 一方面允许取消不可行时继续处理到自然结束，另一方面将 `ABS_EXEC_MS` 当作最长处理时间。现有 socket timeout 无法限制持续输出进度的流，缓冲读取、会话恢复握手和重试也没有共享绝对 deadline；销毁连接本身不能证明引擎执行已经结束。
- **影响：** 无法证明每个在途请求最多占用 120 秒，600/1200 秒推导的前提仍不成立。
- **最小修复：** 定义该上界约束的是 Lucy 等待时长还是上游真实执行资源；明确覆盖所有读取、握手、重试及内部查询的同一个 deadline、取消确认和未确认处置。SC-14 补持续进度流、取消无确认及内部查询路径，并断言期限和占用。

**N07｜高｜旁路伪代码遗漏非 ALLOW 分支，且预算消费早于实际源授权**

- **位置：** [Spec §6.6，420–428 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:420)；Plan S6；[mcp-proxy.ts:3446](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3446)、[3538](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3538)、[5494](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:5494)。
- **问题：** 这里只处理 STOP，未处理 §6.3 的 UNAVAILABLE、REJECT_CONCURRENCY，也没有从 ALLOW 提取 ticket。照此执行，非 ALLOW 仍会进入内部查询。其次，现有路由源检查及内部 `lucy_query` 授权发生在专用处理器内，直接在外层 consume 会先扣额度，再发现源授权失败，违反 SC-09。
- **影响：** 存储故障或并发拒绝可能继续执行；无权执行的路由可能消耗预算甚至消费 pending。SC-35/36 只覆盖耗尽和成功，抓不到这些分支。
- **最小修复：** 明确顺序为解析路由／模板、完成源授权、唯一一次 consume、仅 ALLOW 执行；内部上下文携带同一张服务端票据，所有退出汇入统一结算。补非 ALLOW、源拒绝、异常退出及无双扣 SC。现有代码未显示客户端可伪造内部上下文，本条不作该项漏洞判断。

**N08｜高｜新续查工具仍缺少实际入口的参数与授权分流契约**

- **位置：** Plan S5、§3.3；[mcp-proxy.ts:1466](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:1466)、[3342](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3342)；[acl.ts:2423](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:2423)。
- **问题：** token-only 的 `lucy_continue_question` 按现有统一参数校验会被要求提供 connection，尚未到工具处理器就失败。Plan 列了注册和 ACL，但未规定该参数闸的分流。仅 Wiki 角色方面，“分类入既有集合”也未明确如何避开普通 `lucy_*` 的数据能力要求。
- **影响：** 可出现工具已登记、角色已授予、响应称可继续，但真实调用仍不可达。
- **最小修复：** 明确新工具 schema、参数校验分支及工具分类，既免除 connection 要求又保留 token 校验。补真实 MCP 链路的仅 Wiki、无 begin、受限角色和错误参数 SC，不能只注入 `capability.canContinue=true` 验证。

**N09｜高｜稳定预算恢复尚未接入既有归属冻结与问询年龄读取**

- **位置：** Spec §6.1、§6.4、SC-03/04；Plan S2；[mcp-proxy.ts:3290](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3290)、[turn-correlation.ts:90](/Users/forrest/GitHub/project-lucy/webui/server/proxy/turn-correlation.ts:90)、[question-experience.ts:340](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:340)、[567](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:567)。
- **问题：** 现有归属在预算加载之前由纯内存注册表解析并冻结。恢复预算行中的 `turnId=T`，不会自动使请求审计归属恢复为 T。问询年龄读取又仅凭 turnId 查旧 `turn:` 键，切换为 stable 键后没有定义新的读取映射。
- **影响：** 预算可以连续，审计归属却仍为空；SC-03/04 的“归属仍为 T”和“慢标记不变”没有完整实现路径。
- **最小修复：** 定义持久活跃绑定的恢复、验证和读取时序，在归属冻结前接入，并保留显式 turn 冲突规则；补按轮次读取问询年龄的映射。Plan 明列这些调用点，SC 同时断言预算键、原始／有效归属和慢标记。

**N10｜高｜故障后的阻断、恢复与重试未形成完整状态转换**

- **位置：** [Spec §6.4，356–387 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:356)，§6.2 settle；Plan S2、S3。
- **问题：** load 失败没有伪代码分支设置不可用并返回规范响应；commit 失败后允许后台结算重试，但未规定“不确定提交尚未核实”期间其他 settle 能否写入。成功重试后解除不可用只见于散文，正常 `publish(candidate)` 是否保留或清除该标记也未定义。
- **影响：** 无法确定故障后哪些写操作被阻断、何时恢复；全量候选态写入可能覆盖尚未核实的已提交增量，或使作用域永久不可用。
- **最小修复：** 明确可用、提交待核实、不可用及恢复的转换；未核实提交前禁止其他全量覆盖写入，所有重试经同一队列处理权威持久态。补 load、admit-save、settle-save、核实读取失败和恢复成功的 SC；SC-05 目前只覆盖首次不可读。

**N11｜中｜SC 仍有不确定断言，阶段退出条件依赖后续阶段**

- **位置：** [Spec §7](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:448)；Plan S1、S2、S4、S5。
- **问题：** SC-06 两次各一秒却在“第二次准入时”断言 `busyMs=2`，单位与时点都不成立；SC-35 写“被预算拦下（记 1 次额度）”，与停止分支不增加 calls 冲突。S1 要 SC-29 四项事实通过，却说明后两项来源在 S5；S2 要 SC-01 的 settled 长间隔行为通过，却声明尚未改变时间判定，settled 到 S4 才实现。
- **影响：** 用例可能测错或无法确定通过；阶段不能按声明独立验收。
- **最小修复：** SC-06 改为第二次结算后 `busyMs=2000`；SC-35 断言 calls 不变。把后续阶段依赖项移至对应阶段，或明确定义联合验收。补 N01–N10 所列关键分支的追踪行。

**N12｜中｜HTTP 头路径只兼容“先停机再继续”，缩窄了现有契约**

- **位置：** [Spec §6.3，303–307 行](/Users/forrest/GitHub/project-lucy/docs/specs/lucy-20261029-question-budget-window-optimization-spec.md:303)、§8.1；[question-experience.ts:277](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:277)。
- **问题：** 现有实现只需头部值等于 turnId，在首次耗尽的那次调用即可续查；新算法要求它匹配之前停机才写入的 `presentedToken`。若调用者预先带 turnId，首次耗尽时仍会先 STOP。现有升级 E2E 先发不带续查头的停机请求，不能证明这一分支兼容。
- **影响：** “HTTP 头契约保留”的声明不完整。新的 token 生成规则本身已避免直接返回 identityKey/scopeKey，但兼容性仍有变化。
- **最小修复：** 有合法 turn 时保留原头部兑现条件，或明确宣布新增“先获取停机凭证”前置条件；分别增加预先带头、停机后带头、无 turn 不透明凭证的 SC，并与 N03 的跨轮次失效规则一致。

4. **定稿前文字级问题**

不适用：本轮退回原因包含状态机、提交协议和验收依赖缺陷，不能仅靠文字润色定稿。