# Codex 审阅：问询预算窗口与预算终止可观测性优化（Spec v0.1 / Plan v0.1）

## 结论：退回修订

第 1 轮 Codex 审阅结论为**退回修订**：**4 阻塞 / 8 高 / 1 中 / 1 低**，共 14 条发现。

> **后续处置（2026-10-29）**：PM 指示「综合 codex 审阅意见，修正 spec 和 plan」。已据此产出 **Spec v0.2 / Plan v0.3**，14 条发现的逐条回应见 [Spec §10「对第 1 轮 Codex 审阅 14 条发现的逐条回应」](../specs/lucy-20261029-question-budget-window-optimization-spec.md)；Plan 阶段已按 R12 重排为「可观测性先行」并把原 S2 拆为三个独立可验收单元。**第 2 轮 Codex 审阅未进行**——本记录仍是第 1 轮结论。其后作者将定稿基线升至 **Spec v0.3 / Plan v0.6**（收口软上限表述、`commit` 落库顺序、停机凭证与术语验收），该定稿是否闭合 14 条发现**尚未经独立复核**。

主要阻塞是三处设计本身不成立：**续查工具没有把「意图」交给下一次数据调用的状态转换**（R01）、**`res.close` 不能代表数据处理结束且监听器可能挂载过晚**（R02）、**续查审计先于持久提交且写失败后内存状态没有恢复规则**（R05）、**D6 按裸会话标识取代、丢失现有身份隔离边界**（R07）。

另有两条高危项直接指向 Spec 的前提错误：**当前导出并无服务端硬编码的 `outcome=ok` 默认值**（R11，推翻 Spec §1.4 C 的归因）、**认证路径与报表模板仍可执行查询而完全绕过两个预算维度**（R10）。

**另需注意：R01 / R06 / R07 三条直接击穿本文档原稿的设计**——它们不是外部新发现，而是本 Spec §5.3 / §5.5 / §5.6 伪代码自身的缺陷。原稿的「续查声明与生效分离」「桶随问询保持」「同会话显式取代」三处推论均不成立。

## 审阅基线与限制

**Codex 侧基线**：源码基线为当前工作区，HEAD `3d1a01a11f45b8f7675ce6e5701fc0c78e5ab71a`；两份待审文档均为未跟踪文件。

实际阅读范围（Codex 自述）：

- 完整阅读 `question-experience.ts`、`turn-correlation.ts`、`question-budget.test.ts`；
- 阅读 `mcp-proxy.ts` 的工具注册、参数校验、预算闸、释放挂载、`lucy_begin_question`、上游缓冲与超时、认证路径执行、持久化适配及响应提交入口；
- 阅读 `audit.ts` 的预算表、读写接口及握手补绑；`admin/audit.ts` 的导出筛选、问询统计、CSV、字段说明；`audit-classification.ts` 的预算与执行状态分类；
- 阅读 Spec 162 §7.1–§7.2、§8 及相关验收项，指导文本第 51–56 行，术语标准相关词条；
- 阅读 `mcp-proxy-smoke.test.ts` 中预算、续查、会话隔离、准入归属冻结、SSE、超时相关测试；
- 补充阅读治理文件及 `acl.ts`、`usage-classification.ts`、`authorization-barrier.ts`、`response-commit.ts`、`certified-route.ts`、前端 `Audit.tsx` 的相关路径。

**未做**：未通读大型文件的无关部分；未读取既有审阅结论、生产审计原包、上游 KTX 源码；**未修改任何文件、未创建提交、未执行测试、构建或服务启动**。以下均为静态设计审阅结论，不是运行验收结果。

**本会话侧复核**：以下关键结论已由 MiniMax Code 对照源码独立复核（见每条「复核」行）。复核只覆盖结论正确性，未执行任何测试。

---

## 发现列表

### R01｜阻塞｜续查工具没有把「意图」交给下一次数据调用的状态转换

**位置：** Spec §5.3、§5.5；[mcp-proxy.ts:3833](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3833)。

**问题：** §5.5 只解析凭证并返回 `continued:true`，没有写入任何待兑现状态；§5.3 仍要求调用方传入 `continueToken`。当前数据调用的该参数只来自 HTTP 头。按伪代码实现，标准 MCP 客户端调用续查工具后，再发普通数据调用，仍然没有凭证进入 `consume`。

同时，工具没有检查预算是否耗尽、续查是否已使用，也没有串行或去重规则。因此多次并发声明均可返回成功，SC-10 的「第二次续查请求必须被拒绝」没有实现路径。

**影响：** D3 主路径仍不可用；若实现者自行补一个共享变量，又会留下意图被其他并发请求抢占、跨窗口残留和重复声明成功的问题。

**最小修复建议：** 明确定义按身份、会话、预算作用域及窗口版本绑定的 `pendingContinuation`。声明、重复声明判定及消费必须进入同一作用域队列；消费成功落库后清除。返回值区分「声明已接受」和「窗口已重置」，并规定声明后没有数据调用、换问询、重启、双路径并发的处理。

**复核：** 成立。已核对 `mcp-proxy.ts:3836` —— `consumePersisted` 的 `continueToken` **唯一来源**是 HTTP 头，工具入参不在传递路径上。原稿 §5.5「声明与生效分离」的推论错误：分离之后没有任何通道把声明送到 `consume`。

### R02｜阻塞｜`res.close` 不能代表数据处理结束，而且监听器可能挂载过晚

**位置：** Spec §5.4、§7.3；Plan S2；[mcp-proxy.ts:3934](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3934)、[mcp-proxy.ts:402](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:402)、[authorization-barrier.ts:181](/Users/forrest/GitHub/project-lucy/webui/server/proxy/security/authorization-barrier.ts:181)。

**问题：**

1. 客户端提前断开时，`close` 已发生，上游仍可能执行。现有 barrier 的响应关闭处理只删除在途登记，并不调用取消上游的 `cancel()`。
2. 预算监听器在 `await consumePersisted()` 返回后才注册。若连接在装载或落库期间关闭，此后注册的监听器不会补收已经发生的事件。
3. 正常响应关闭还包含响应持久提交、发送等时间；它与「数据工具处理时长」并不等价。当前 `tools/call` 会先缓冲上游完整响应，再输出（[mcp-proxy.ts:4874](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:4874)）。

**影响：** 提前断开会少计，早于监听器挂载的断开会漏计；正常路径又可能计入额外送达耗时。最终 `busyMs` 无法稳定对应同一种资源事实。

**最小修复建议：** 在请求生命周期开始时安装一次性结算协调器，显式区分客户端关闭、取消请求、上游真正结束和响应送达。以处理完成或确认取消完成作为结算点，使用单调时钟；若断开后继续处理，就继续计时。所有失败出口进入同一个幂等结算函数。

**复核：** 成立。已核对 `mcp-proxy.ts:3934` 附近——释放监听器确实挂在 `consumePersisted` **返回之后**的 `res.once("close")` 上，装载/落库期间的断开无法补收。

### R03｜高｜仅累计已完成请求不能支撑「120 秒封顶」，现有超时也未证明绝对时限

**位置：** Spec §4 D1 推荐理由、§5.1–§5.4、§7.3；[question-experience.ts:277](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:277)、[mcp-proxy.ts:4803](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:4803)、[mcp-proxy.ts:254](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:254)。

**问题：** 新判定只读取已完成请求的 `busyMs`。当它为 0 时，20 个数据调用可以先后通过串行准入，然后并行处理；每个处理 30 秒，最终累计可达约 600 秒。D-24 只保证次数准入串行，不能阻止这种耗时超支；当前额外并发限制仅针对 `lucy_query`。

文档以「单次查询仍受超时保护」支撑成本保护，但源码使用上游 socket timeout；`readUpstreamBody` 持续读到流结束（[mcp-proxy.ts:291](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:291)）。响应 gate 的计时又在首次写响应头或内容时才启动（[response-commit.ts:163](/Users/forrest/GitHub/project-lucy/webui/server/proxy/security/response-commit.ts:163)）。持续发送进度、迟迟不结束的上游流没有在这些代码中得到绝对处理时限保证。

**影响：** 120 秒实际是事后停止阈值，不能称为资源硬上限；次数限制也不能限制单个长期在途请求。

**最小修复建议：** 明确选择硬限制或允许有限超支。硬限制须将同窗口在途处理耗时纳入同一个 `busyMs` 维度，并定义剩余额度耗尽时的处理；允许超支则必须给出可证明的最大超支界限和绝对执行超时。保留空闲不计时。

**复核：** 成立。核心逻辑正确：Spec §5.4 只在请求结束时累计，未把**在途**处理时长计入准入判定，因此「120 秒封顶」在并发场景下不成立。这与 Spec §7.3「服务端成本保护未被削弱」的自述**自相矛盾**。

### R04｜高｜释放没有窗口版本，旧请求会把耗时记入续查后的窗口

**位置：** Spec §5.3–§5.4；[question-experience.ts:284](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:284)、[question-experience.ts:309](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:309)。

**问题：** 续查直接清零同一个状态对象；`release(scopeKey,durationMs)` 只按作用域取当前对象，没有请求所属窗口。

可构造：旧窗口达到 20 次，其中 A 仍在途；B 兑现续查并进入新窗口；A 随后结束。A 的全部耗时会累加进新窗口，而不是其准入时的窗口。

此外，§5.3 只要求 `consume` 串行，§5.4 的释放与保存没有进入同一队列。

**影响：** 新窗口被旧请求提前耗尽；窗口前后审计无法解释；D-24 的消费测试不能覆盖此问题。

**最小修复建议：** 准入返回不可变的预算票据，包含 `scopeKey`、`windowId`、`requestId` 和计时起点。释放按票据结算原窗口，且与消费、续查共享作用域串行队列。显式规定旧窗口在途耗时在换窗后的归属。

**复核：** 成立。Spec §5.3 的续查动作直接改写同一个 `state` 对象，§5.4 的 `release` 只带 `scopeKey`，确实没有窗口版本概念。

### R05｜阻塞｜续查审计先于持久提交，写失败后的内存状态没有恢复规则

**位置：** Spec §5.2–§5.4；Plan S0、S2、S3；[question-experience.ts:251](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:251)、[mcp-proxy.ts:3935](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3935)。

**问题：** 伪代码在状态重置时立即 `audit.emit(budget_continued)`，尚未完成预算保存。当前实现也是先原地修改内存，再保存；保存失败返回 `question_budget_unavailable`，但不恢复内存。

因此，续查保存失败可以同时产生：没有数据调用获准执行；内存已经消耗唯一续查额度；持久态仍是旧窗口；已发出「续查生效」审计事实。

释放保存失败目前仅打印日志。新增的主要耗时计数也走这条路径，文档没有规定是否禁止该作用域继续消费、如何重试或恢复。

**影响：** 审计事实与实际放行不一致；内存和持久态分叉；重启后可能恢复成另一份续查状态或丢失已结算耗时。

**最小修复建议：** 用候选状态完成持久提交后再发布内存状态与生效事实；失败时保留旧态或将作用域标记为不可用。对释放失败定义持久重试、阻断后续准入和重启恢复策略；续查生效事件必须关联成功提交的窗口及数据调用。

**复核：** 成立。已核对 `question-experience.ts:251-266`——`applyConsume` 先原地改 `state`，`consumePersisted` 随后才 `persist`；`persist` 抛错时返回 `question_budget_unavailable` 但**不回滚内存**。这是既有实现的既有缺口，但本次改造把「续查生效」这一**关键事实**挂在上面，风险被显著放大。

### R06｜高｜恢复计数仍不足以恢复同一个预算作用域，SC-17 可能测成假通过

**位置：** Spec §5.2、SC-01、SC-17；Plan S2；[turn-correlation.ts:58](/Users/forrest/GitHub/project-lucy/webui/server/proxy/turn-correlation.ts:58)、[turn-correlation.ts:165](/Users/forrest/GitHub/project-lucy/webui/server/proxy/turn-correlation.ts:165)、[mcp-proxy.ts:3832](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3832)。

**问题：** turn 注册表仅在内存保存，并在创建后超过默认 10 分钟时删除。D5 没有恢复或延长这份归属状态。

后果有三种：

- 重启后，旧 turn 无法通过注册表解析，预算访问转入 fallback，持久化的 `turn:<id>` 根本没有被加载；
- 同一问询思考超过 10 分钟后，下一次调用换桶；SC-01 的「任意长间隔」不再是同一预算作用域；
- 无 turn 时，fallback 键包含客户端会话标识；改变会话会改变预算键，不能仅靠表中计数兑现「不因重连重置」。

另一个确定遗漏是 §5.2 只恢复五个字段，没有恢复既有持久化的 `attempts`、`peakConcurrency`；表中确实保存这些字段（[audit.ts:1125](/Users/forrest/GitHub/project-lucy/webui/server/proxy/audit.ts:1125)）。

**影响：** 单测直接调用 `consumePersisted(oldTurnId)` 可以通过，而真实 MCP 重启后仍换桶；预算与观测计数继续漂移。

**最小修复建议：** 补充稳定预算身份及归属恢复契约，区分归属候选缓存过期与预算生命周期。SC-17 必须通过真实代理重启后的调用验证相同 scope。明确恢复全部累计字段，并对崩溃前在途占用单独处理，不能盲目恢复成活跃并发。

**复核：** 成立，且**这是对 D1 承诺最致命的一条**。已核对 `turn-correlation.ts:164-170`——注册表 `purge()` 按 `windowMs`（`LUCY_REPORTED_TURN_ATTACH_WINDOW_MS` 默认 600000，10 分钟）删除条目，且 `resolve` 的候选集合**完全来自这个已清理的 Map**。因此问询空闲超过 10 分钟后：注册表无候选 → 归属 `unassigned` → `lucyTurnId` 为空 → 预算桶从 `turn:<id>` 切到 `scope:<hash>:<session>` → **计数从零开始**。这意味着 D1 承诺的「任意长间隔仍属同一预算作用域」（SC-01）在 10 分钟后不成立，且换桶本身构成预算逃逸路径。

### R07｜阻塞｜D6 按裸会话标识取代，丢失现有身份隔离边界

**位置：** Spec §5.6；Plan S5；[turn-correlation.ts:53](/Users/forrest/GitHub/project-lucy/webui/server/proxy/turn-correlation.ts:53)、[turn-correlation.ts:116](/Users/forrest/GitHub/project-lucy/webui/server/proxy/turn-correlation.ts:116)、[mcp-proxy.ts:702](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:702)。

**问题：** 现有会话候选先按 `userId + tokenHashPrefix` 隔离，再按 session 筛选。新伪代码却调用 `activeTurnFor(sessionId)`、`supersede(previous,...)`，没有身份参数或所有权检查。

会话标识可以直接来自 `x-lucy-session-id`。两个身份提交相同字符串时，若按现文档实现裸 session 索引，后者可以取代前者的活跃 turn。无 session 的 `undefined` 桶也没有隔离定义。

**影响：** 新增跨身份归属状态修改面，破坏会话隔离；可能让另一身份的调用失去 turn 预算绑定。**这不等于已确认能越权读取数据，但已是设计上的隔离缺口。**

**最小修复建议：** 活跃绑定键至少包含认证用户、凭证身份和会话；`activeTurnFor` 与 `supersede` 都验证所有权。明确无会话时不建立共享会话绑定，并补不同身份使用相同或空 session 的验收。

**复核：** 成立。已核对 `turn-correlation.ts:116` —— 现有 `resolve` **先**按 `identityKey === ownerKey` 过滤**再**按 session 筛选，身份隔离是既有实现的硬边界；Spec §5.6 的伪代码把这个边界丢了。原稿 D6 属**设计倒退**，非等价实现。

### R08｜高｜并发 begin 与握手补绑可以突破「不回改被取代问询历史行」

**位置：** Spec §5.6、SC-20；Plan S5；[mcp-proxy.ts:4201](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:4201)、[audit.ts:2438](/Users/forrest/GitHub/project-lucy/webui/server/proxy/audit.ts:2438)、[audit.ts:2475](/Users/forrest/GitHub/project-lucy/webui/server/proxy/audit.ts:2475)。

**问题：** `bindPriorSessionCalls` 先查询未归属握手行，再等待 ledger 序号，最后按选中的 ID 更新；最终 `UPDATE` 不再次检查这些行是否仍未归属。

两个并发 begin 可以同时选中同一批空归属握手行。A 将其绑定到 turn A，B 取代 A 后仍按旧查询结果更新到 B。D6 没有规定 begin、取代、登记和补绑的会话级串行顺序。

**影响：** A 的历史关联行可在被取代后改为 B；补绑前像也可能来自过期读取。仅凭「取代是显式事件」不能排除此竞态。

**最小修复建议：** 对同一身份/会话的 begin 全流程串行；新问询持久化成功后才提交活跃绑定。握手补绑在事务内重新检查未归属条件，并只为实际更新行记录前像。增加两个并发 begin 的专项用例。

**复核：** 成立。与 §1.2 的取证一致——`bindPriorSessionCalls` 是**事后回填**机制，正是事故审计里「08:47 握手行带着 09:19 turn」这一现象的来源；它与并发取代叠加后确有竞态。

### R09｜高｜新增工具的实际授权落点缺失，`continuable` 也没有覆盖通道不可用

**位置：** Spec D2、D3、§7.1、SC-24；Plan §3.3、S3；[acl.ts:95](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:95)、[acl.ts:131](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:131)、[acl.ts:2396](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:2396)。

**问题：** Plan 的修改表没有列出 `acl.ts` 或角色授权迁移。当前未分类工具默认拒绝，可见性还要求 known tool、角色工具授权；一般 `lucy_*` 工具另要求数据能力。

既有 Wiki 专用角色只有 `wiki_search/wiki_read`，而这些调用同样消耗预算，见 [mcp-proxy-smoke.test.ts:38](/Users/forrest/GitHub/project-lucy/webui/server/__tests__/mcp-proxy-smoke.test.ts:38)。照现有规则登记新 `lucy_*` 工具，并不能保证这类调用者可见、可用。

`continuations < 1` 只能证明剩余额度，不能证明调用者有可达续查通道；SC-24 又要求旧客户端等价「无可用续查」，但没有客户端能力判断机制。

**影响：** 可能重新交付「响应说可继续，工具却不可用」的路径——与本次事故要消除的病症同型。

**最小修复建议：** 明列工具分类、known tools、显式角色授予及升级迁移；覆盖仅 Wiki、无 begin、受限角色。定义 `continuable` 表示额度还是可执行能力；指导文本依据实际可见工具处置，不能把所有 `true` 都导向不可见工具。

**复核：** 成立。已核对 `acl.ts:99-136`——`classifyTool` 依赖固定的 `DATA_PLANE_TOOL_SET` / `META_TOOL_SET` / `CONTEXT_TOOL_SET`；新工具落入未分类集合会被 `tool_unclassified:<tool>` 拒绝。Plan §3.3 的修改文件清单确实**没有 `acl.ts` 与角色授权迁移**。

### R10｜高｜认证路径和报表模板仍可执行查询而完全绕过两个预算维度

**位置：** Spec §2、D1 的「资源额度」承诺；Plan S2；[question-experience.ts:10](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:10)、[mcp-proxy.ts:3992](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3992)、[mcp-proxy.ts:3537](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:3537)。

**问题：** `lucy_certified_route`、`lucy_report_template` 不在预算工具集合，却会调用 `forwardAuthorizedLucyQuery`。后者执行授权及上游查询，没有预算消费，见 [mcp-proxy.ts:5490](/Users/forrest/GitHub/project-lucy/webui/server/proxy/mcp-proxy.ts:5490)。

这是既有缺口，但本次声称保留数据资源上限，没有盘点这两条执行入口。有已登记且已授权的 route/template 时，可以在普通查询预算耗尽后继续经它们取数。

**影响：** 次数和处理时长均可绕过；查询执行与预算记账不一致。无法确认生产当前是否登记了此类路径，本结论限定为源码可达条件。

**最小修复建议：** 将这两种查询入口纳入统一预算边界，明确一次外部调用记账一次，避免嵌套双扣；在其实际源授权通过后消费，并记录对应查询执行和结算事实。

**复核：** 成立，**且这是本轮事故取证漏掉的一类入口**。已核对 `mcp-proxy.ts:3992`——`lucy_certified_route` / `lucy_report_template` 的处理分支位于预算闸之后，但因二者不在 `DATA_TOOLS` 内，闸门对其**不生效**；其内部 `forwardAuthorizedLucyQuery` 会真实执行上游查询。属实打实的预算旁路。

### R11｜高｜D4 的导出根因定位错误，新增四桶也未对接当前八桶事实源

**位置：** Spec §1.4 C、D4、SC-13–SC-14；Plan S4；[admin/audit.ts:194](/Users/forrest/GitHub/project-lucy/webui/server/admin/audit.ts:194)、[admin/audit.ts:3258](/Users/forrest/GitHub/project-lucy/webui/server/admin/audit.ts:3258)、[admin/audit.ts:1694](/Users/forrest/GitHub/project-lucy/webui/server/admin/audit.ts:1694)。

**问题：**

- 当前导出没有硬编码默认 `outcome=ok`：只在调用方提供 outcome 时加筛选；Manifest 原样记录该参数。前端也从 URL 读取 outcome，再传给证据包，见 [Audit.tsx:1480](/Users/forrest/GitHub/project-lucy/webui/src/pages/admin/Audit.tsx:1480)、[Audit.tsx:1846](/Users/forrest/GitHub/project-lucy/webui/src/pages/admin/Audit.tsx:1846)。事故 Manifest 中出现 `ok`，不足以证明服务端默认错误。
- 当前已经有八桶 `primaryStatusSummary`，前端问询行也展示非零桶，见 [Audit.tsx:703](/Users/forrest/GitHub/project-lucy/webui/src/pages/admin/Audit.tsx:703)。真正仍缺预算列的是旧 outcome 汇总及 CSV。
- Plan 没列前端文件，却要求新增「独立可见列」；也没有规定新预算计数采用旧 `outcome` 还是 `primary_status`。

**影响：** SC-13 可以在修复前通过；S4 可能改不到事故触发路径，或破坏显式筛选。四桶若被当作执行结论，又会与现有八桶冲突。

**最小修复建议：** 将「默认筛选错误」改为待查证，分别规定无筛选和显式 `outcome=ok` 的结果。将四桶恒等式限定为 legacy outcome 计数，执行结论保留八桶；明确新增 API、CSV、字段说明及前端落点。事故导出参数的产生源目前**无法确认**，还缺原请求或客户端操作证据。

**复核：** **成立，且直接推翻 Spec §1.4 C 的归因。** 已核对 `admin/audit.ts:225` —— `if (params.outcome) baseConditions.push("outcome = @outcome")`，服务端**没有**写死 `outcome=ok` 的默认值，筛选完全由调用方参数驱动；事故 manifest 中出现 `"outcome": "ok"` 只说明**当次导出请求带了该参数**。原 Spec 把「导出默认只含 ok」写成服务端硬编码默认，并据此把修复点指向导出器——**归因层级错误**，真实成因在导出请求的发起侧（前端从 URL 读取 outcome 再下传）。此项须回写 Spec §1.4 C 与 §5 D4。

### R12｜高｜阶段顺序违背自己的门禁，墙钟开关也不能兑现完整行为回滚

**位置：** Plan §1、S2–S4、§7；Spec SC-21；[question-experience.ts:225](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:225)、[question-experience.ts:297](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:297)。

**问题：** Plan L36 要求可观测性先于放宽，实际却在 S2 改预算、S3 开续查，S4 才验收导出与指导文本。

`WALL_MODE=elapsed` 也只能切换时间判定。D5 会恢复原先跳过的持久计数，D2 会改变最终 `continuable`，D3/D6 会改变续查及归属；这些都不受墙钟开关控制。因此 SC-21 的「行为与现状完全一致」与其他修复不能同时成立。

S2 同时包含装载、持久化结算、时间算法和响应变化，但回滚表只写「撤回装载改动」，没有可独立回退的实施单元。

**影响：** 中间阶段可能让新行为先上线、审计和模型指导随后补；回滚时无法判断应保留哪些修复，也无法按 SC-21 判定成功。

**最小修复建议：** 将 S2 拆为持久化正确性、统一结算、时间算法三个独立可验收变更；可观测性先落地，指导与新通道同批启用。将 SC-21 缩为「elapsed 时间判定兼容」，另列各行为开关、待兑现意图及新状态的回退处置。

**复核：** 成立。Plan §1 自列「可观测性先于放宽」为实施原则，但 S4（可观测性）排在 S2（放宽口径）、S3（开续查）之后，与自述原则直接冲突。

### R13｜中｜若干 SC 与算法互相矛盾，现有写法不能形成确定验收

**位置：** Spec SC-02–SC-04、SC-08；Plan S2 风险说明；[question-budget.test.ts:241](/Users/forrest/GitHub/project-lucy/webui/server/__tests__/question-budget.test.ts:241)、[question-experience.ts:323](/Users/forrest/GitHub/project-lucy/webui/server/proxy/question-experience.ts:323)。

**问题：**

- SC-02/03 无条件要求到阈值返回终止，但 §5.3 在有效续查时允许重置并放行。
- SC-04 要求非数据工具不启动窗口；§5.2 却明确保留 `ensureTurn` 预置 `startedAt`，SC-05 又要求 catalog 时「起表」。没有区分观测起点与执行预算起点。
- SC-08 要求下一调用获得归零窗口，但该调用通过 §5.3 后 `calls` 应为 1；缺少断言时点。
- Plan 写「同一作用域并发首消费只放行一次」；既有 D-24 的该断言有明确前提 `calls=19`。从 0 开始则允许 20 次，见 [question-budget.test.ts:260](/Users/forrest/GitHub/project-lucy/webui/server/__tests__/question-budget.test.ts:260)。

**影响：** 实现与验收可以各自选择解释，甚至写出互相排斥的测试。

**最小修复建议：** 给每条 SC 补齐初态、续查输入、模式及观测时点。SC-05 **可以构造**：使用可控时钟复刻同一 turn 的 catalog、318 秒空闲和首次读取，并同时断言旧算法拒绝、新算法放行；不需要真实等待 318 秒。

**复核：** 成立，核对无误。SC-02/03 与续查分支的冲突、SC-04 与 §5.2 的 `ensureTurn` 预置冲突、SC-08 缺断言时点，均属实。R13 关于 SC-05 **可构造**的补充尤其有用——用可控时钟即可，无需真实等待。

### R14｜低｜术语同步与章节引用未完成，指导文本验收指向不存在的章节

**位置：** Spec §3、SC-23、§9；Plan S4；[00-product-terminology-standard.md:620](/Users/forrest/GitHub/project-lucy/webui/docs/00-product-terminology-standard.md:620)、[00-product-terminology-standard.md:635](/Users/forrest/GitHub/project-lucy/webui/docs/00-product-terminology-standard.md:635)、[data-qa-instructions.md:54](/Users/forrest/GitHub/project-lucy/webui/config/data-qa-instructions.md:54)。

**问题：** 标准词条仍定义「次数或墙钟」，关联调用数仍写三桶恒等式；Plan 却写「新增术语 None，仅核对既有词条」，没有明确修订这两项定义。SC-23 引用 Spec §10，但文档实际止于 §9。

另外，§5.5 将新工具称为「协议方法」，而它实际上是 `tools/call` 工具；不消耗预算不等于属于现有协议使用量集合，见 [usage-classification.ts:50](/Users/forrest/GitHub/project-lucy/webui/server/proxy/usage-classification.ts:50)。

**影响：** 指导文本与术语标准继续冲突；验收引用无目标；实现者可能错误修改协议分类来豁免预算。

**最小修复建议：** 明确修订两个现有词条，给出指导文本的规范性替换内容及有效章节引用；将「协议方法」改为「不计预算的本地工具」，另行明确其使用量和审计分类。

**复核：** 成立。已核对术语标准第 620 行——「问询预算」词条仍写「数据工具次数或墙钟上限」，与 D1 新口径冲突；SC-23 指向的 Spec §10 不存在（文档止于 §9）。

---

## 未发现问题的部分

- **D1 的方向修中了事故根因。** 在归属和 scope 保持不变时，停止使用问询年龄作为门禁，确实不会再因 agent 空闲 318 秒而拒绝首次读取。
- **D5 区分「内存预置」和「已装载」是正确方向。** 若异步装载始终位于作用域队列内，`ensureTurn` 仅预置且不修改 `loaded`，预置本身不必产生新的 TOCTOU；缺口在恢复范围及后续状态提交。
- **预算终止分类边界正确。** 当前写路径已有授权通过、未执行凭据，分类为 `budget_stopped`、不进入四个失败维度，有源码支持：[audit-classification.ts:385](/Users/forrest/GitHub/project-lucy/webui/server/proxy/audit-classification.ts:385)。
- **显式 supersede 本身不必违反证据顺序。** 顺序执行时，现有握手补绑只选择未归属协议行，不会直接抢走已绑定的旧问询行。需要修的是身份边界、并发和历史修改例外。
- **保留次数限制及一次续查有意义。** 对稳定作用域、所有执行入口均纳管的前提，最多两个调用窗口；但它不能单独证明处理时间成本封顶。

## 建议的补充验证

以下均建议后续执行，本次未执行：

1. **事故对照：** 同一代理归属下复刻首次读取前空闲、两次读取间空闲，以及超过 10 分钟的空闲；断言 scope 不变，避免「换桶后放行」冒充修复。
2. **结算生命周期：** 在预算 load/save 期间断开、上游执行中断开、上游超时、有限 SSE、持续进度 SSE、响应提交失败；逐项核对最终 busy、并发占用及审计终态。
3. **跨窗口并发：** 旧窗口请求挂起，续查生效后才完成；核对旧耗时归属、幂等释放及新窗口余额。
4. **续查线性化：** 两个工具声明、工具与头部竞争、声明后无调用、另一并发调用先到、声明后 begin、重启及保存失败；断言唯一生效记录和明确消费请求。
5. **持久化恢复：** `ensureTurn` 预置后延迟 load；从 19 次及 0 次分别并发消费；注入 load/save/release-save 故障；通过代理重启验证预算键与全部累计字段。
6. **身份及归属：** 不同身份复用相同/空 session、同凭证双会话、并发 begin、显式旧 turn、已准入旧请求晚完成；核对历史行及 mutation journal。
7. **入口覆盖：** 普通查询预算耗尽后调用已授权 route/template；仅 Wiki 角色及无 begin 的 fallback 作用域完成续查。
8. **审计与回滚：** 无 outcome 筛选、显式 `ok`、四种 legacy outcome、八种主状态及历史 unknown；比对列表、CSV、Manifest 和字段说明，再逐项验证模式切换及各独立变更的回退。

---

## 修订待办（供下一版 Spec 使用）

按 Codex 结论回写，本轮**未改动** Spec / Plan 正文实质内容，仅登记本条审阅结论。待下一版修订时至少覆盖：

| 优先级 | 回写点 | 关联发现 |
|---|---|---|
| 阻塞 | Spec §5.3 / §5.5：续查须有**可被下一次数据调用消费**的显式状态（`pendingContinuation`，绑定身份/会话/作用域/窗口版本），并定义声明→消费→落库的线性化与清理 | R01、R04、R05 |
| 阻塞 | Spec §5.4：改用**统一结算协调器**（区分客户端关闭 / 取消 / 上游结束 / 送达），单调时钟，幂等结算；`release` 纳入作用域队列并携带**窗口票据** | R02、R04 |
| 阻塞 | Spec §5.6：`activeTurnFor` / `supersede` 必须携带身份（`userId` + `tokenHashPrefix` + `sessionId`），补跨身份验收 | R07、R08 |
| 高 | Spec §1.4 C / §5 D4：**撤回「导出默认写死 outcome=ok」的服务端归因**，改为「导出请求发起侧带参」的待查证项；区分 legacy outcome 四桶与八桶主状态；补前端落点 | R11 |
| 高 | Spec §4 D1 / §5：明确 120 秒是**软上限**还是**硬上限**；若为硬上限须把在途处理时长纳入准入判定并定义绝对执行超时 | R03 |
| 高 | Spec §5.2 / SC-17：补**稳定预算身份**与归属恢复契约（区分注册表缓存过期与预算生命周期），恢复全部累计字段；SC-17 必须经真实代理重启验证 | R06 |
| 高 | Spec §7.1 / Plan §3.3：补 `acl.ts`、known tools、角色授予与升级迁移；定义 `continuable` 语义（额度 or 可达能力） | R09 |
| 高 | Spec §2 / Plan S2：盘点并纳管 `lucy_certified_route` / `lucy_report_template` 两条查询入口 | R10 |
| 高 | Plan §4：S2 拆为「持久化正确性 / 统一结算 / 时间算法」三个独立可验收单元；**可观测性先落地**；SC-21 缩为「elapsed 时间判定兼容」 | R12 |
| 中 | Spec §6：逐条补 SC 的初态、续查输入、模式与观测时点，消解 SC-02/03/04/08 的自相矛盾 | R13 |
| 低 | Spec §3 / §9 / Plan S4：修订术语标准两条既有词条；修正 SC-23 的章节引用；「协议方法」改为「不计预算的本地工具」 | R14 |
