# 问询预算窗口与预算终止可观测性优化 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.2** |
| 日期 / 目标版本 | 2026-10-29 首版 / v0.1 按第 1 轮 Codex 审阅修订 / 目标 v0.25（修订线） |
| 功能编号 / 优先级 | **待 PM 指派**（建议 L25-17）/ **P0**（预算窗口语义 + 续查可达）、P1（可观测性）、P2（归属与恢复正确性） |
| 状态 | **v0.2 待审阅，未批准**。第 1 轮审阅未通过（4 阻塞 / 8 高 / 1 中 / 1 低），本版据其修订并回应；**第 2 轮审阅未进行**。不授权开发、浏览器验证或客户交付。 |
| 评审状态 | **第 1 轮 Codex 审阅结论：退回修订**，14 条发现逐条回应见 §10 与 [`docs/reviews/2026-10-29-codex-review-question-budget-window-optimization.md`](../reviews/2026-10-29-codex-review-question-budget-window-optimization.md)。**第 2 轮未进行。** |
| 决策来源 | 2026-10-29 PM 指示：基于 2026-10-29 09:19–09:24 UTC 生产事故（用户 liuzongxuan / 客户端 `codex-mcp-client`）设计优化 Spec 与 Plan，交付 Codex 审阅并落盘审阅结论；后指示「综合 codex 审阅意见，修正 spec 和 plan」。 |
| 需求来源 | 生产事故：一次问询在**零次数据工具调用**的情况下被 `question_budget_exhausted` 拦下，客户侧无法自行恢复。 |
| 实施主体 | Lucy（Proxy 问询预算层 + Admin 审计导出层）；不修改 KTX 源码 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级跨模块设计落 `docs/`；本文修订 `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` §7.2（问询预算）的口径与续查通道 |
| 与既有 Spec 的关系 | **修订 Spec 162 §7.2 的墙钟口径与续查兑现通道**；Spec 162 其余条款、失败四维度、使用分析口径不变。§7.2 的权威事实源在本次修订后指向本文 §6–§9。 |
| 本版修订 | **v0.2（2026-10-29）**：据第 1 轮审阅 14 条发现修订。**R01** → §6.3 引入持久化 `pendingToken` 声明—消费机制，续查意图有了真实传递通道；**R02** → §6.2 统一结算协调器 + 窗口票据，`res.close` 不再充当结算点；**R03** → §5 D1 明确 120 秒为**结算口径软上限**，给出可证明的有界超支与绝对执行时限；**R04** → §6.2 票据携带 `windowId`，旧窗口耗时归档不污染新窗口；**R05** → §6.4 全链路改为「候选态 → 落库 → 发布内存 + 审计」；**R06** → §6.1 引入**稳定预算身份**（身份+会话，脱离 turn 注册表过期），修「10 分钟后换桶逃逸」；**R07** → §6.5 作用域键含身份，取代天然隔离；**R08** → §6.5 取代与握手回填纳入同会话串行 + 事务内重检；**R09** → §6.3 `continuable` 重新定义为「**可执行能力**」并补 ACL 落点；**R10** → §2.3 / §6.6 纳管 `lucy_certified_route` / `lucy_report_template` 两条旁路；**R11** → §1.4 C **撤回**「导出服务端写死 outcome=ok」的错误归因，改为待查证的发起侧带参；**R12** → Plan 阶段重排，可观测性先行、S2 拆三单元；**R13** → §7 全部 SC 补初态/输入/模式/观测时点；**R14** → §3.2 与 §9 修订术语标准两条既有词条、修正章节引用、「协议方法」改称「不计预算的本地工具」。 |

> 本文件是**设计基线**。第 2 轮审阅未闭环、决策未拍板之前，不授权实现。

---

## 1. 事故复盘与根因

### 1.1 现象

用户 liuzongxuan（客户端 `codex-mcp-client 0.165.0-alpha.1.2`）在 Codex 中询问「查询最新的 2026 年财报损益预测，按 Q1—Q4 列示实际＋预测和重点损益表科目」。Agent 在 LUCY 目录中发现新增源 `dwd_ksc_all_pnl_metric_company`，读取该源时返回 `question_budget_exhausted`；按返回的续查标识重试仍失败。Agent 最终交付部分结果并声明「当前阻塞是 LUCY 读取额度限制」。

### 1.2 取证口径与证据等级

取证来源：2026-10-29 09:41 UTC 导出的审计包（`access_log.csv` 358 行 + `audit-turns-*.csv` 82 行）。

| 等级 | 事实 | 出处 |
|---|---|---|
| **直接** | 会话 `db471e45` 在 08:47:18.995Z `initialize`、09:19:16.101Z `lucy_begin_question`、09:19:17.354Z `lucy_catalog`（1ms）、09:24:28.702Z `lucy_skill_search`（10909ms） | `access_log.csv` |
| **直接** | 问询 `lucy_ed29af56` 的「关联调用数 = 8，成功 6，拒绝 0，错误 0」 | `audit-turns-*.csv` |
| **直接** | 问询时长 338920ms；总调用耗时 11575ms；最大单次 10909ms；慢调用 1 | `audit-turns-*.csv` |
| **直接** | 该导出 manifest 的 filter 为 `outcome: "ok"` | 审计包 `manifest.json` |
| **推断** | 08:47 三个握手行的 `turn_attribution_mode = session_bound` **是事后回填**，非实时归属 | 回填实现见 `webui/server/proxy/audit.ts:2475`；`bindPriorSessionCalls` 调用点见 `webui/server/proxy/mcp-proxy.ts:4206` |
| **推断** | 8 = 6 + 0 + 0 + **2 次预算终止**；这 2 次即两次 `lucy_read_source` | 计数口径见 `webui/server/admin/audit.ts:2196` 与 `webui/server/proxy/audit.ts:1560`；耗时交叉验证：6 次成功合计 10934ms，总耗时 11575ms，差额 641ms ≈ 2 次被预算拦下的代理侧开销 |
| **推断** | 首次 `lucy_read_source` 被拒时**数据工具调用数为 0** | 上条推断 + §1.3 锚点推导 |
| **待查证** | 该次导出**为何**带上 `outcome=ok` 参数——服务端只做「有参才筛」，参数由导出请求发起侧提供 | 服务端行为见 `webui/server/admin/audit.ts:225`；发起侧见 `webui/src/pages/admin/Audit.tsx:1480`、`Audit.tsx:1846`。**缺当次导出请求或客户端操作证据**，本项不下结论 |

> **待补直接证据**：需按 `outcome` 重新导出（含 `budget_stop`）或直查 `access_log` 表，以坐实 2 次预算终止行及其时间戳。本文 §1.2 最后三行在补证前按「推断／待查证」对待，不作为门禁事实。

### 1.3 根因

**问询的 120 秒墙钟在第一次数据调用之前就已经耗尽，而耗尽它的是 agent 的推理空闲时间。**

推导链（三段，均可在代码中定位）：

1. **墙钟锚点建在一次「不消耗额度」的工具调用上。**
   `ensureTurn`（`webui/server/proxy/mcp-proxy.ts:3309`）对**每一次** `tools/call` 执行；只要能解析出 turn，就创建预算作用域并把 `startedAt` 钉在该请求的时刻。而 `lucy_catalog` / `lucy_skill_search` 都不在数据工具集合 `DATA_TOOLS` 内（`webui/server/proxy/question-experience.ts:10-17`）——**它们不消耗额度，却会启动倒计时**。本案锚点 = 09:19:17.354Z（`lucy_catalog`）。
2. **墙钟度量的是流逝时间，包含 agent 的思考空闲。**
   判定式 `now - state.startedAt >= QUESTION_BUDGET_MAX_WALL_MS`（`webui/server/proxy/question-experience.ts:277`）比较的是两次工具调用的墙钟间隔。本案 09:19:17 → 09:24:28 之间约 5 分 11 秒是 agent 推理与选路，其中仅 10.9 秒是工具执行时间。
3. **第一次数据调用因此在 `calls = 0` 时被直接拒绝。**
   首次 `lucy_read_source`（约 09:24:35Z）触发判定：elapsed ≈ 318 秒 > 120 秒 → `question_budget_exhausted`；该源**一次都没被读到**。

**结论**：不是「查得太多把额度用完」，而是**额度语义把 agent 的思考时间当成了资源消耗**。这构成负向激励：推理越充分的 agent，越早失去查数资格。

### 1.4 同一次事故暴露的伴生缺陷

| 编号 | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| **A** | 停机响应里的 `continuable: true` 是**硬编码**（`webui/server/proxy/question-experience.ts:297`、`webui/server/proxy/mcp-proxy.ts:3883`），哪怕那一档续查额度已用光 | 实测：第二次带同一 token 续查 → 仍然 `stop`，payload 仍称 `continuable: true` | 模型被持续引导去重试一条**永远不可能成功**的路径 |
| **B** | 续查只在 HTTP 头 `x-lucy-question-continue` 中兑现（`webui/server/proxy/mcp-proxy.ts:3836`），且值必须**逐字等于**本次解析出的 turnId（`webui/server/proxy/question-experience.ts:283`） | 全仓无任何客户端代码回传该头；Codex 经 `.mcp.json` **静态 headers** 接入（`webui/docs/07-mcp-auth-proxy-spec.md` 接入章节） | 「续查标识」对标准 MCP 客户端是**死代码**；且审计**从不记录**该头是否呈现，无法判定模型是否真的试过 |
| **C** | 预算终止（`budget_stop`）在问询汇总的「成功／拒绝／错误」三桶中被整类丢弃（`webui/server/proxy/audit.ts:1560`、`webui/server/proxy/audit.ts:3033`） | 字段说明「成功+拒绝+错误等于本列」（`webui/server/admin/audit.ts:2196`）与实际 8 ≠ 6+0+0 自相矛盾 | 预算终止**在汇总层不可观测**：现场只能靠客户端截图反推 |

> ⚠️ **v0.2 更正（对应 R11）**：v0.1 曾把该缺陷表述为「审计包导出 filter 写死 `outcome:"ok"`」。**该归因错误并已撤回**——服务端导出只在调用方带参时才加筛选（`webui/server/admin/audit.ts:225`），事故 manifest 中出现 `"outcome":"ok"` 只说明**当次导出请求带了该参数**，其来源在导出请求发起侧。真实成因尚待查证（§1.2 待查证行），修复点因此分为「汇总层」（本条，确证）与「导出发起侧」（待查证，Plan S1 立项排查）。

### 1.5 不属于本次根因、但会妨碍自救或与本次改造强相关的既有缺陷

| 编号 | 缺陷 | 证据 |
|---|---|---|
| **D** | 持久化预算对 turn 级实际不生效：`ensureTurn` 先行把内存态预置好，`consumePersisted` 见「内存里已有」即**跳过持久层装载**（`webui/server/proxy/question-experience.ts:225`） | 实测：持久层预置 `calls = 20`，`ensureTurn` + `consumePersisted` 仍放行。B16「重启不丢」不成立 |
| **E** | 同一会话内重开问询会打断归属：10 分钟窗口内（`LUCY_REPORTED_TURN_ATTACH_WINDOW_MS` 默认 600000，`webui/server/proxy/mcp-proxy.ts:131`）出现第二个 turn 时，会话候选变为 2 个 → `unassigned + attribution_session_candidate_ambiguous`（`webui/server/proxy/turn-correlation.ts:122`） | 后续调用丢失 turn 归属、掉进凭证／会话级兜底桶。**「重开问询」这个最自然的自救手段本身带副作用** |
| **F** | turn 归属注册表是**纯内存**且按 10 分钟窗口 `purge`（`webui/server/proxy/turn-correlation.ts:165`），候选集合完全来自该 Map | 问询空闲超 10 分钟后归属丢失 → 预算作用域从 `turn:<id>` 切到 `scope:<hash>:<session>` → **计数从零开始**，构成预算逃逸路径 |
| **G** | `lucy_certified_route` / `lucy_report_template` 不在预算工具集合，却会执行真实查询（`webui/server/proxy/mcp-proxy.ts:3992` → `forwardAuthorizedLucyQuery`，`mcp-proxy.ts:5490`） | 普通查询预算耗尽后，可经这两条入口继续取数，绕过两个维度 |

---

## 2. 范围

### 2.1 本期包括

1. **稳定预算身份**：预算作用域不再依赖 turn 注册表（可缓存过期），改由**身份 + 会话**确定，并持久化轮次与归属（§6.1）——修 D、F。
2. **墙钟口径改写**：第二维度由「问询年龄流逝时间」改为「**已结算数据处理时长**」，空闲不计入，并配**有界在途超支**与**绝对执行时限**（§5 D1、§6.2）。
3. **`continuable` 重新定义为「可执行能力」**：如实反映该调用者是否还有**可达**的续查通道（§5 D2、§6.3）。
4. **续查兑现通道**：新增 `lucy_continue_question`，以**持久化待兑现状态**打通「声明 → 消费」（§5 D3、§6.3）。
5. **统一结算**：结算点从 `res.close` 改为**上游真正结束／确认取消**，以窗口票据保证幂等与跨窗口归属正确（§6.2）。
6. **预算终止可观测性**：汇总层补「预算终止次数」并修正恒等式；记录续查呈现事实；导出发起侧排查立项（§5 D4、§6.7）。
7. **旁路入口纳管**：`lucy_certified_route` / `lucy_report_template` 纳入统一预算边界（§6.6）——修 G。
8. **持久化装载顺序与恢复契约修正**（§5 D5、§6.1）。
9. **同会话重开问询的归属显式取代**，带身份隔离与并发串行（§5 D6、§6.5）——修 E。
10. **模型侧指导文本与术语标准同步**（§10）——治理类文件，走 Plan Mode。

### 2.2 本期不包括

- 不改变数据面查询语义、行级策略语义、ACL 语义、失败四维度定义；
- 不改变问询预算的**次数**上限（20 次数据工具调用）；
- 不引入独立的「问询超时」机制（见 §2.4）；
- 不改变 `question_budget_exhausted` / `question_budget_unavailable` 两个原因码；
- 不动 KTX 源码；
- 不回改历史审计行（既有行的口径保持原样，新口径自生效起适用）；
- 不实现「按身份+会话」的预算共享给跨会话协作场景（同一身份不同会话仍是独立预算）。

### 2.3 预算旁路入口的盘点结论

本版**纳管**以下两类此前不受预算约束的入口（修 G）：

| 入口 | 现状 | 本期口径 |
|---|---|---|
| `lucy_certified_route` | 执行已发布认证路由的真实查询，不消耗预算 | 一次外部调用记 **1 次数据额度**；其内部源查询的**处理时长**计入 `busyMs`，但**不重复记次数**（避免嵌套双扣） |
| `lucy_report_template` | 执行已发布报表模板的真实查询，不消耗预算 | 同上 |

**实现约束**：这两类工具内部触发的源查询**不得**再次进入额度判定（否则递归），须以「内部执行上下文」显式标记（实现细节见 Plan S2c）。

### 2.4 与「不惩罚思考」的关系（口径选择的边界）

本文只解决**预算不得因 agent 思考而阻断查数**。用户等待时长的治理不属于预算职责：若要约束「用户等太久」，应另立机制（例如客户端 turn 超时或交付纪律），**不得**通过重新把流逝时间塞回预算门禁来实现——那会恢复本次事故的根因。

---

## 3. 术语与用户可见口径

### 3.1 沿用词条

| 标准术语 | 英文 / 字段 | 含义 | 禁止文案 |
|---|---|---|---|
| 问询预算 | Question Budget | 同一问询的数据工具次数上限与数据处理时长上限 | 「turn budget」「8 分钟上限」 |
| 可继续 | Continuable | 问询预算用尽后，**该调用者是否仍有一条可达的继续通道** | 「自动续跑」 |
| 预算终止 | `budget_stopped` | 预算用尽导致调用未执行（`execution = not_executed`） | 「被拒绝」「权限拒绝」 |

`question_budget_exhausted` 作为协议字段值出现时保持 `translate="no"`。

### 3.2 本版需修订的既有词条（对应 R14）

以下三条**既有**词条的定义与本次口径冲突，须在术语标准中**修订**（不是新增）：

| 词条 | 现定义 | 修订为 |
|---|---|---|
| 问询预算（`00-product-terminology-standard.md:620`） | 「同一问询的数据工具次数或墙钟上限」 | 「同一问询的数据工具次数上限与**数据处理时长**上限；**不含 agent 思考等空闲时间**」 |
| 关联调用数（`00-product-terminology-standard.md:635` 附近） | 「成功+拒绝+错误等于本列」 | 「成功 + 拒绝 + 错误 + **预算终止** = 本列」（legacy outcome 四桶口径；执行结论以八桶主状态为准） |
| 可继续（`00-product-terminology-standard.md:621`） | 「问询预算用尽后的一次继续」 | 「问询预算用尽后，**该调用者是否仍有一条可达的继续通道**」（额度 **与** 通道可达性两个条件） |

---

## 4. 决策表（待 PM 拍板）

> 本节是**签字载体**。每个决策给出推荐与备选；PM 裁定后，本节与 §6–§9 的正文同步改写，**先只改决策纸并单独提交**，再把裁定内容分发给各条目 owner。
>
> ⚠️ **v0.2 已回应第 1 轮审阅的全部 14 条发现（§10），可提交拍板。** 但 D1 的推荐口径在 v0.1 基础上**已变更**（不再是单纯的「累计处理时长」，而是「结算口径软上限 + 有界超支 + 绝对执行时限」），请按 v0.2 文本裁定。

| 编号 | 决策 | 选项 | 推荐 | 状态 |
|---|---|---|---|---|
| **D1** | 墙钟口径 | (a) **结算口径软上限**：已结算数据处理时长上限 120 秒，配**有界在途超支**（≤ 并发上限 × 绝对执行时限）与**绝对执行时限**（单次数据调用硬性最长处理时间）<br>(b) 硬上限：在途预估预占计入准入判定<br>(c) 保留流逝时间语义，仅放大阈值 | **(a)** | 待拍板 |
| **D2** | `continuable` 语义 | (a) **可执行能力**（额度 + 该调用者确有可达通道）<br>(b) 纯额度（`continuations < 1`）<br>(c) 维持硬编码 | **(a)** | 待拍板 |
| **D3** | 续查兑现通道 | (a) **新增 `lucy_continue_question` 工具**（主路径，持久化待兑现状态）<br>(b) 给每个数据工具加 `continueToken` 入参<br>(c) 仅保留 HTTP 头 + 补文档<br>(d) (a)+(c) 并存 | **(a)**，(c) 保留为次要路径 | 待拍板 |
| **D4** | 预算终止可观测性 | (a) 汇总层补「预算终止次数」+ 修正恒等式 + 记录续查呈现事实；**导出发起侧另立排查项**<br>(b) 仅补汇总列 | **(a)** | 待拍板 |
| **D5** | 持久化与恢复 | (a) **修正**：装载不再以「内存已有」为跳过条件；候选态 → 落库 → 发布；补稳定预算身份与全字段恢复<br>(b) 维持现状并在文档标注限制 | **(a)** | 待拍板 |
| **D6** | 同会话重开问询归属 | (a) **显式取代**：同一身份+会话的活跃问询被新 `begin_question` 取代，轮次 +1，归属与预算同步切换<br>(b) 维持冲突并记录，不改归属 | **(a)** | 待拍板 |
| **D7** | 灰度开关 | (a) 新增 `LUCY_QUESTION_BUDGET_WALL_MODE=settled\|elapsed`（默认 `settled`）+ `LUCY_QUESTION_BUDGET_SCOPE=stable\|legacy`（默认 `stable`）<br>(b) 直接切换不设开关 | **(a)** | 待拍板 |
| **D8** | 指导文本口径 | (a) 同步改为「20 次数据工具调用，或累计 120 秒数据处理时长（不含思考时间）」，并写明遇 `question_budget_exhausted` 时按 `continuable` 分支处置<br>(b) 只改数值不动结构 | **(a)** | 待拍板 |
| **D9** | 旁路入口纳管 | (a) **本期纳管** `lucy_certified_route` / `lucy_report_template`<br>(b) 另立工作项，本期只登记 | **(a)** | 待拍板 |

### D1 推荐理由（v0.2 修订）

- **语义对齐**：预算管的是「数据侧资源额度」。20 次调用是资源上限；思考时间不是资源消耗。把它计进额度是语义错配。
- **方向性**：现状构成负向激励——推理越充分的 agent 越早失去查数资格，直接压低长链路分析类问询的完成率。
- **上限不是无限**：口径 (a) 下给出**可证明的有限上界**——单问询数据处理总时长 ≤ `MAX_BUSY_MS` + `并发上限 × 绝对执行时限`。按 120 秒 / 并发 4 / 单次绝对时限 120 秒计，**最坏 600 秒**。
- **不牺牲「用户等太久」**：该诉求归属 §2.4，不通过预算门禁实现。

### D1 备选 (b) 为何不推荐

硬上限要求在准入时**悲观预占**在途请求的耗时上限，会让并发密集场景几乎无法准入（20 次调用的目标因而不可达）。且「预占额度」在上游耗时不可预知时只是另一种猜测。(a) 用「软上限 + 显式有界超支 + 绝对执行时限」达到同等可证明性，且不牺牲可用性。

### D1 备选 (c) 为何不推荐

见 §1.3：流逝时间语义就是事故根因。放大阈值只是把「5 分钟思考」换成「25 分钟思考」再拒一次，不解决语义错配。

---

## 5. 范围外声明：预算与问询年龄的分离

**问询年龄（`originStartedAt`）在本版之后只作观测，不作门禁。** 代理保留既有 `wallClockMs` 指标用于「慢问询」标记与运营观测，但任何额度判定都**不得**使用它。唯一例外：`question_budget_unavailable`（存储故障）仍 fail closed，不受此影响。

---

## 6. 核心流程（伪代码）

> 本节命中 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「核心流程（伪代码）」触发条件（多步状态机 + 分支顺序决定正确性），须可执行地描述控制流。

### 6.1 稳定预算身份与状态模型（D5 / R06）

```text
# ── 作用域键：与 turn 注册表解耦 ──────────────────────────────
# 注册表是「可缓存过期」的归属候选缓存，不能当预算生命周期。
identityKey = `${userId}|${tokenHashPrefix}`     # 与 turn-correlation.ts 的 identityKey 同口径
sessionId  = 客户端会话标识；无会话时为 `-`
scopeKey   = `bq:${identityKey}:${sessionId}`     # 新语义（stable）
# 旧语义 `turn:<turnId>` / `scope:<hash>:<session>` 保留只读（见 §8.2 迁移）

type BudgetState = {
  scopeKey: string
  round: number              # 轮次：每次 begin_question 取代时 +1
  turnId: string | null      # 审计归属（可空；预算不依赖它）
  windowId: number           # 窗口版本：每次续查生效时 +1
  calls: number              # 已放行的数据工具调用数          ← 门禁维度 1
  busyMs: number             # 已结算的数据处理时长            ← 门禁维度 2
  inflight: number           # 当前在途的数据调用数
  attempts: number
  peakConcurrency: number
  currentConcurrency: number
  continuations: number      # 已用续查额度（≤ 1）
  pendingToken: string|null  # 待兑现的续查声明（持久化，见 §6.3）
  startedAt: number
  originStartedAt: number    # 问询年龄（观测用，不作门禁）
  loaded: boolean
}

MAX_CALLS        = 20
MAX_BUSY_MS      = 120_000    # 已结算数据处理时长上限（D1）
MAX_INFLIGHT     = 4          # 同作用域并发数据调用上限（D1 有界超支的第二个因子）
ABS_EXEC_MS      = 120_000    # 单次数据调用的绝对执行时限（D1 有界超支的第三个因子）
```

**有界超支的可证明上界**：准入条件只看已结算的 `busyMs`；准入后到结算前，最多有 `MAX_INFLIGHT` 个在途请求，每个最长 `ABS_EXEC_MS`。故单问询数据处理总时长 ≤ `MAX_BUSY_MS + MAX_INFLIGHT × ABS_EXEC_MS` = **600 秒**。空闲时间**永不计入**。

### 6.2 统一结算与窗口票据（D1 / R02 / R04）

```text
# ── 票据：在请求生命周期开始时创建 ────────────────────────────
type Ticket = {
  scopeKey: string
  windowId: number       # 准入时的窗口版本（R04：旧请求不得记入新窗口）
  round: number
  requestId: string
  startMonoMs: number    # 单调时钟
  settled: boolean
}

# 结算点 = 上游真正结束，或确认取消完成。
# res.close 只表示「客户端断开」，不作为结算点（R02）。
function settle(ticket, endMonoMs):
  if ticket.settled: return              # 幂等：同一票据只结算一次
  ticket.settled = true
  withScopeSerialization(ticket.scopeKey, async () => {
    state = loadState(ticket.scopeKey)
    delta = endMonoMs - ticket.startMonoMs
    if state.windowId === ticket.windowId:
      state.busyMs += delta               # 记入当前窗口
    else:
      archiveWindowCost(ticket.windowId, delta)   # 旧窗口：归档，不污染新窗口（R04）
    state.inflight = max(0, state.inflight - 1)
    state.currentConcurrency = max(0, state.currentConcurrency - 1)
    persist(state)
  })
```

**挂载点**：`settle` 挂在**上游处理结束**处，而非 `res.once("close")`。客户端断开 → 触发取消上游 → 取消确认后结算；若取消不可行，则**继续计时**直至上游自然结束（此时仍计费，但计入的是真实处理时长）。

**并发上限**：准入时若 `state.inflight >= MAX_INFLIGHT`，本次调用**不进入预算判定**，直接以 `并发超限` 拒绝并单独记账（不消耗 `calls`、不累计 `busyMs`）。

**绝对执行时限**：数据工具调用超过 `ABS_EXEC_MS` 仍未结束时，主动取消上游并按超时结算（计入实际已耗时）。

### 6.3 续查：声明 — 消费（两段式，持久化待兑现）（D2 / D3 / R01 / R05 / R09）

```text
# ── 路径一：工具声明 ────────────────────────────────────────
function declareContinuation(scopeKey, token, identity, sessionId):
  # 全程在作用域队列内串行；**先落库，后发布内存与审计**（R05）
  withScopeSerialization(scopeKey, async () => {
    state = loadState(scopeKey)
    if state.pendingToken == token: return OK(idempotent=True)       # 同 token 重复声明：幂等
    if state.pendingToken != null:   return REJECT(pending_exists)   # 一个作用域只能有一个待兑现
    if state.continuations >= 1:     return REJECT(no_credit)        # 续查额度已用尽
    if not exhausted(state):          return REJECT(not_exhausted)    # 未用尽时无需续查
    candidate = { ...state, pendingToken: token }
    persist(candidate)                 # ← 落库先行
    publish(candidate)                 # ← 再发布内存
    audit(budget_continuation_declared, {scopeKey, token, windowId: state.windowId})
    return OK(declared=True)
  })

# ── 路径二：数据工具调用时消费 ────────────────────────────────
function consume(scopeKey, turnId, headerToken, now, capability):
  state = loadState(scopeKey)
  exhausted = state.calls >= MAX_CALLS or state.busyMs >= MAX_BUSY_MS

  token, trusted = pickToken(state, headerToken, turnId, scopeKey)
    # 头部路径：headerToken 非空时，trusted = (headerToken == (turnId ?? scopeKey))
    # 工具路径：state.pendingToken 非空时，trusted = true（同作用域声明，天然可信）

  if exhausted and token != null and trusted and state.continuations < 1:
    state.calls = 0
    state.busyMs = 0
    state.windowId += 1                 # 换窗（R04：旧窗口耗时归档）
    state.continuations += 1
    state.pendingToken = null           # 消费即清除
    # 续查生效事实与本次放行**同批落库**（R05）

  stillExhausted = state.calls >= MAX_CALLS or state.busyMs >= MAX_BUSY_MS
  if stillExhausted:
    return STOP(
      reason        = "question_budget_exhausted",
      partial       = true,
      continueToken = turnId ?? scopeKey,
      continuable   = capability.canContinue and state.continuations < 1   # ← D2 / R09：可执行能力
    )

  state.calls += 1
  state.attempts += 1
  state.inflight += 1
  state.currentConcurrency += 1
  persist(state)                        # 与放行同批落库
  return ALLOW(ticket = {scopeKey, windowId: state.windowId, round: state.round, ...})
```

**关键点**

- **两条路径汇入同一次 `consume`**，`state.continuations < 1` 是**唯一**闸门 ⇒ 并发双路径不会把续查额度加两次（R01）。
- **声明与消费是持久化的两段式**：`pendingToken` 存在预算状态行里，**代理重启后仍可恢复**，并发安全由作用域串行队列保证；工具声明后即使代理重启，待兑现状态仍在（R01）。
- **续查生效与数据调用放行同批落库** ⇒ 不存在「审计已称续查生效、实际没放行」的窗口（R05）。
- **`continuable` 是「可执行能力」**：代理在生成停机响应时按**当前调用者的可见工具集合**计算 `capability.canContinue`（`lucy_continue_question` 对该调用者可见且已授权）。旧客户端看不到该工具 ⇒ `continuable=false` ⇒ 模型不会重试一条不可达的路径（R09）。
- **头部路径保留**为次要路径，其 token 仍须逐字匹配（既有契约不变）。

### 6.4 装载、落库与发布顺序（D5 / R05）

```text
function loadState(scopeKey):
  state = memory.get(scopeKey)
  if state == null:
    state = freshState(scopeKey)
    memory.set(scopeKey, state)
  if persistence != null and not state.loaded:
    persisted = persistence.load(scopeKey)      # 失败 → question_budget_unavailable（fail closed）
    if persisted != null: state = merge(state, persisted)   # 恢复**全部**累计字段（R06）
    state.loaded = true
  return state
```

**落库纪律（全程适用）**：任何状态变更一律 **候选态 → 落库 → 发布内存 + 发审计**。落库失败时**保留旧态**，不发布、不发审计。作用域在落库失败后**标记为不可用**，后续准入一律拒绝（避免内存与持久态分叉）。

**恢复字段清单**：`calls`、`busyMs`、`continuations`、`pendingToken`、`windowId`、`round`、`turnId`、`attempts`、`peakConcurrency`、`originStartedAt`、`startedAt`。**在途占用不恢复**（崩溃前在途的进程已死，不得盲目恢复为活跃并发）。

### 6.5 同会话重开问询的显式取代（D6 / R07 / R08）

```text
on lucy_begin_question:
  turnId = newUuid()
  withIdentitySessionSerialization(identityKey, sessionId, async () => {
    scopeKey = scopeKeyFor(identityKey, sessionId)
    state = loadState(scopeKey)
    previousTurn = state.turnId
    if previousTurn != null and previousTurn != turnId:
      archiveRound(state)                       # 旧轮次计数归档，保留审计可见性
      candidate = { ...state, round: state.round + 1, turnId: turnId,
                    calls: 0, busyMs: 0, windowId: state.windowId + 1,
                    continuations: 0, pendingToken: null }
      persist(candidate); publish(candidate)
      audit(turn_superseded, {from: previousTurn, to: turnId, scopeKey})
    bindPriorSessionCalls(turnId, ...)         # 现状保留，但见下方并发约束
    reportedTurns.record(identity, sessionId, turnId)
  })
```

**身份隔离（R07）**：作用域键含 `identityKey`。`activeTurnFor` / `supersede` 的作用域**始终**按身份+会话限定；两个身份即使提交**相同或空**的 session 标识，也**分属不同作用域**，互不可见、互不可取代。**无会话（`-`）时同身份共享一个无会话桶**，这是无法区分的既成事实，写入验收。

**并发串行（R08）**：同一身份+会话的 `begin_question` 全流程（建轮次 → 取代 → 登记 → 握手回填）进入**同一把会话队列**。握手回填在**事务内重新检查「仍未归属」**条件后再更新，且**只为实际更新的行**记录前像——杜绝「两个并发 begin 抢同一批握手行」。

**不回改历史行**：取代只切换**后续**调用的归属与预算；被取代轮次的归档计数保留可见，不修改任何已写入的审计行。

### 6.6 旁路入口的统一记账（D9 / R10）

```text
on lucy_certified_route / lucy_report_template:
  # 与普通数据工具走**同一次** consume（记 1 次额度）
  decision = consume(scopeKey, turnId, headerToken, now, capability)
  if decision is STOP: return stop response
  # 内部触发的源查询**不再**进入 consume（避免递归），改用内部执行上下文
  withInternalExecutionContext(async () => {
      result = forwardAuthorizedLucyQuery(identity, gate.query)   # 其处理时长计入 busyMs
      settle(ticket, nowMono())                                    # 由内部查询的实际结束点结算
  })
```

**记账口径**：一次外部调用 = **1 次数据额度**；内部源查询**只计时长、不重复记次数**。

### 6.7 可观测性（D4 / R11）

**汇总层（确证）**

| 层级 | 口径 |
|---|---|
| legacy outcome 四桶 | 成功 / 拒绝 / 错误 / **预算终止**；恒等式：**关联调用数 = 四桶之和** |
| 八桶主状态（既有） | `succeeded` / `failed` / `denied` / `budget_stopped` / `cancelled` / `timeout` / `indeterminate` / `unknown`——**执行结论以此为准**，四桶不得被当作执行结论 |

**导出发起侧（待查证）**：事故导出为何带 `outcome=ok` 尚无证据（§1.2）。本期先**分离规定两种情形的期望结果**：无 `outcome` 参数的导出**必须**包含预算终止行；显式 `outcome=ok` 的导出**只含 ok 行**（不得破坏调用方显式筛选语义）。前端导出入口 `webui/src/pages/admin/Audit.tsx` 的参数来源列为**独立排查项**（Plan S1）。

**续查呈现事实**：每条预算终止行记录：`continuationPresented`（是否呈现凭证）、`continuationMatched`（是否匹配）、`continuationCreditLeft`（额度是否还在）、`canContinueByCapability`（该调用者是否有可达通道）。

---

## 7. 验收标准

> 每条 SC 均标注 **初态 / 输入 / 模式 / 观测时点**（R13）。模式：`settled` = D1 口径（A），`elapsed` = 现状口径（C），用于回滚兼容验证。全部 SC 默认在 `stable` 作用域模式下验证；另有一组 SC 专测 `legacy` 模式。

### 7.1 稳定预算身份与恢复（D5 / R06）

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-01 | 全新作用域，计数全 0 | 同一身份+会话连续 12 次数据调用，间隔各 90 秒 | settled | 第 12 次放行时 | **全部放行**；`calls=12`，`busyMs` 只含处理时长（不含 90 秒间隔） |
| SC-02 | 全新作用域 | 同一问询空闲 **15 分钟**（> 注册表 10 分钟窗口）后发起数据调用 | settled | 该次调用准入时 | **仍属同一作用域**（`scopeKey` 不变、`round` 不变、`calls` 连续），**不得**因注册表过期而换桶或计数归零 |
| SC-03 | 持久层预置 `calls=18, busyMs=0, continuations=0, windowId=3, round=2, turnId=T` | 进程重启后同身份+会话发起数据调用 | settled | 该次调用准入时 | 恢复全部累计字段：`calls=19`（18+1）、`windowId=3`、`round=2`、归属 turn 仍为 T；**不得**从 0 开始 |
| SC-04 | 持久层预置同上 | 代理进程**真实重启**后经 MCP 发起数据调用（非直接调函数） | settled | 该次调用准入时 | 与 SC-03 同口径；**该用例是 SC-03 的验收主体**，直接调函数的写法视为不通过 |
| SC-05 | 持久层不可读 | 发起数据调用 | settled | 响应生成时 | 返回 `question_budget_unavailable`；**不得**记为预算终止；作用域标记不可用，后续准入一并拒绝 |

### 7.2 墙钟口径与结算（D1 / R02 / R03 / R04）

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-06 | 全新作用域 | 两次数据调用间隔 300 秒（空闲），两次处理各 1 秒 | settled | 第 2 次准入时 | **放行**；`busyMs=2`（不含 300 秒空闲） |
| SC-07 | 全新作用域 | 数据调用处理时长累计 ≥ 120 秒 | settled | 下一次准入时 | `question_budget_exhausted` |
| SC-08 | 全新作用域 | 数据调用次数达到 20 | settled | 第 21 次准入时 | `question_budget_exhausted`（与处理时长无关） |
| SC-09 | 全新作用域 | 协议方法 / `lucy_catalog` / `lucy_skill_search` / 被 ACL 拒绝的调用 | settled | 其后首个数据调用准入时 | 四类均**不**累计 `calls` / `busyMs`，且**不**创建或重置窗口 |
| SC-10 | 全新作用域 | 事故等价复现：同一 turn 先 `lucy_catalog` → 空闲 318 秒 → 首次 `lucy_read_source` | settled + elapsed 对照 | 首次读准入时 | `settled` **放行**；`elapsed` **拒绝**；两口径在同一用例内对照。**用可控时钟构造，不需要真实等待 318 秒** |
| SC-11 | `busyMs=0`，有一个数据调用在途（未结算） | 此刻再发起 4 个并发数据调用 | settled | 第 5 个并发准入时 | 第 5 个被 `并发超限` 拒绝；**不**消耗 `calls`、**不**累计 `busyMs` |
| SC-12 | 旧窗口已有在途请求 A | A 未完成时发生续查，B 进入新窗口 | settled | A 结算时 | A 的耗时**归档到旧窗口**；新窗口 `busyMs` **不受影响**；A 的结算**幂等**（重复调用只生效一次） |
| SC-13 | 一个数据调用处理中 | 客户端提前断开连接 | settled | 结算时 | 触发取消上游；取消确认后结算已耗时；**不因 `res.close` 而提前少计** |
| SC-14 | 一个数据调用处理中 | 处理时长超过 `ABS_EXEC_MS` | settled | 结算时 | 主动取消上游；按实际已耗时结算；审计标记超时 |

### 7.3 续查（D2 / D3 / R01 / R05 / R09）

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-15 | 预算刚用尽，`continuations=0` | 首次触发停机 | settled | 响应生成时 | `continuable=true`（该调用者**可见且已授权** `lucy_continue_question`）；`continueToken` 有效 |
| SC-16 | 同上，但该调用者**不可见**该工具 | 首次触发停机 | settled | 响应生成时 | `continuable=false`；模型不得被引导重试不可达路径 |
| SC-17 | 预算用尽，`continuations=0` | 调用 `lucy_continue_question(token)`，随后发起数据调用 | settled | 数据调用准入时 | 声明被接受；该次数据调用获得**归零后**的窗口（准入后 `calls=1`、`busyMs=0`、`windowId` +1）；续查生效事实与该次放行**同批落库** |
| SC-18 | 续查额度已用尽（`continuations=1`） | 再调用 `lucy_continue_question` | settled | 响应生成时 | 被拒绝（`no_credit`）；**不得**重置窗口 |
| SC-19 | 已有一个 `pendingToken` | 再以**不同** token 声明 | settled | 响应生成时 | 被拒绝（`pending_exists`）；原 pending 保持有效 |
| SC-20 | 已有一个 `pendingToken` | 以**相同** token 重复声明 | settled | 响应生成时 | 幂等返回成功；**不得**产生第二条 pending |
| SC-21 | 预算用尽 | 头部路径与工具路径**并发**提交续查 | settled | 两者结算后 | 续查额度**只被加一次**、窗口**只被重置一次** |
| SC-22 | 预算用尽 | 以**无效 / 错配** token 声明或用头部回传 | settled | 响应生成时 | 被拒绝；**不得**重置窗口；审计记录 `continuationMatched=false` |
| SC-23 | 预算用尽 | 声明续查后**进程重启**，再发起数据调用 | settled | 数据调用准入时 | `pendingToken` 从持久层恢复并被消费；续查生效 |
| SC-24 | 预算用尽 | 声明续查后**换问询**（新的 `begin_question`），再发起数据调用 | settled | 数据调用准入时 | 旧 pending **不跨轮次生效**；新轮次按新预算判定 |

### 7.4 可观测性（D4 / R11）

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-25 | 一条预算终止审计行 | 导出**不带** `outcome` 参数 | settled | 导出产物 | 导出**包含**该预算终止行 |
| SC-26 | 同上 | 导出**显式**带 `outcome=ok` | settled | 导出产物 | 导出**只含 ok 行**（显式筛选语义不被破坏）；manifest 原样记录该参数 |
| SC-27 | 任一问询 | 查看问询汇总 | — | 汇总渲染时 | 存在独立可见列「预算终止次数」；**关联调用数 = 成功 + 拒绝 + 错误 + 预算终止** |
| SC-28 | 同一问询 | 查看汇总与执行视图 | — | 渲染时 | 执行结论仍以**八桶主状态**为准；四桶不得被当作执行结论呈现 |
| SC-29 | 任一预算终止行 | 读取该行 | — | 行落盘时 | 记录 `continuationPresented` / `continuationMatched` / `continuationCreditLeft` / `canContinueByCapability` 四项事实 |
| SC-30 | 任一续查事件 | 读取审计 | — | 事件落盘时 | 续查声明与续查生效为**两条可区分事实**，且续查生效与对应数据调用可关联 |

### 7.5 归属、身份与旁路（D6 / D9 / R07 / R08 / R10）

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-31 | 身份 A 与身份 B 使用**相同** session 标识 | B 在同会话 `begin_question` | settled | B 取代完成时 | A 的作用域**不受影响**；A 的活跃 turn 仍为 A 的；**不得**跨身份取代 |
| SC-32 | 身份 A 无 session | A 使用空 session | settled | 作用域创建时 | 归属 A 的**无会话桶**；**不得**与任何其他身份的桶共享 |
| SC-33 | 同一身份+会话 | 两个**并发** `begin_question` | settled | 两者完成后 | 作用域最终只有一个活跃 turn；**无重复轮次**；握手回填**不重复绑定**同一行（事务内重检） |
| SC-34 | 某轮次已被取代 | 查看历史审计行 | — | 渲染时 | 被取代轮次的行**不被改写**；轮次归档计数可见 |
| SC-35 | 预算已用尽 | 调用 `lucy_certified_route` / `lucy_report_template` | settled | 准入时 | **被预算拦下**（记 1 次额度）；不再执行真实查询 |
| SC-36 | 预算充足 | 调用 `lucy_certified_route` / `lucy_report_template` | settled | 结算时 | 记 **1 次**额度；内部源查询的时长计入 `busyMs` 但**不重复记次数** |

### 7.6 兼容、指导与灰度（D7 / D8 / R14）

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-37 | 任意 | `LUCY_QUESTION_BUDGET_WALL_MODE=elapsed` | elapsed | 各次准入时 | **仅**时间判定回到现状流逝时间语义；§7.2 之外的修复（装载、续查、归属、旁路）**仍然生效**，不随此开关回退 |
| SC-38 | 任意 | `LUCY_QUESTION_BUDGET_SCOPE=legacy` | settled | 各次准入时 | 作用域键回到旧语义；用于新旧口径对照，不作为生产形态 |
| SC-39 | 任意 | `LUCY_QUESTION_BUDGET=off` | — | 各次准入时 | 预算整体关闭，既有行为不变 |
| SC-40 | 任意 | 读取 `webui/config/data-qa-instructions.md` | — | 文件内容 | 与 §4 D8 及 Plan S8 的新口径一致；指导文本**不得宽于**代理预算；写明遇 `question_budget_exhausted` 时按 `continuable` 分支处置 |
| SC-41 | 任意 | 读取术语标准两条词条 | — | 文件内容 | 「问询预算」与「关联调用数」两条词条定义已按 §3.2 修订 |

---

## 8. 兼容、迁移与风险

### 8.1 兼容

- **协议响应形状不变**：`reason` / `partial` / `continueToken` / `continuable` 四字段与取值域不变，仅 `continuable` 的取值更严格。
- **原因码不变**：仍是 `question_budget_exhausted`；存储故障仍是 `question_budget_unavailable`。
- **新增工具是增量**：旧客户端不调用即无影响；工具可见性受既有 ACL 管辖。
- **HTTP 头路径保留**：既有 e2e 用例（`webui/tests/upgrade-e2e/upgrade-features.spec.ts:306`）不破。
- **审计表结构**：需新增列与「轮次 / 窗口」概念，走既有迁移机制，不得手工改库。

### 8.2 迁移

- `question_budget_state` 新增列：`busy_ms`、`round`、`turn_id`、`identity_key`、`session_id`、`window_id`、`pending_token`、`status`。
- **旧键语义**（`turn:<turnId>` / `scope:<hash>:<session>`）的行**保留只读**，不被新逻辑命中；新语义另起键 `bq:<identityKey>:<sessionId>`。
- **存量行不回填业务语义**：存量 `calls` 无法映射到新作用域，**新作用域从零开始**；这是刻意的——把旧 turn 的计数迁移到新桶会造成跨问询额度继承。
- 迁移脚本须幂等；存量 `question_budget_state` 行不删除（保留审计追溯）。

### 8.3 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 作用域键语义变更影响既有 e2e / 集成用例 | 高 | `LUCY_QUESTION_BUDGET_SCOPE=legacy` 保留旧语义用于对照；§7.6 专项验收 |
| 预算上限退化为软上限 | 中 | 有界超支界限可证明（§4 D1）；绝对执行时限 + 并发上限两个因子均显式化并纳入验收 |
| 续查通道可达后可能被用于反复重试 | 中 | 续查额度仍为 1 次/问询；续查只换窗不加额度；`continuable` 按调用者能力如实返回 |
| 新工具需 ACL 登记与角色迁移，遗漏则**不可见** | 高 | Plan S3 显式列出 `acl.ts`、known tools、角色授予与升级迁移；SC-16 覆盖不可见场景 |
| 导出默认口径变化影响既有消费方 | 中 | 无筛选与显式筛选两种情形分别验收（SC-25 / SC-26）；导出发起侧列为独立排查项 |
| 指导文本与术语标准变更属治理类文件 | 中 | 走 Plan Mode；与 S4 同批验收 |
| 旁路入口纳管可能影响既有认证路由使用 | 中 | SC-35 / SC-36 双向验收；纳管按「一次外部调用记一次额度」 |

---

## 9. 交付判定

- **本文状态**：设计基线 v0.2，**待第 2 轮审阅**。第 1 轮结论已落盘（见页首「评审状态」）。
- **决策状态**：D1–D9 全部**待拍板**。未拍板不得进入实现。
- **验收状态**：SC-01–SC-41 **全部未执行**。
- **授权状态**：**不授权**开发、浏览器验证、客户交付、镜像或部署。
- 后续阶段划分与门禁见 [`docs/plans/2026-10-29-lucy-question-budget-window-optimization-plan.md`](../plans/2026-10-29-lucy-question-budget-window-optimization-plan.md)。

---

## 10. 对第 1 轮 Codex 审阅 14 条发现的逐条回应

| 发现 | 严重性 | v0.2 的处置 | 落点 |
|---|---|---|---|
| R01 续查意图无传递通道 | 阻塞 | 引入**持久化 `pendingToken`** 的声明—消费两段式；头部与工具两路径汇入同一次 `consume`，`continuations < 1` 为唯一闸门 | §6.3、SC-17～SC-24 |
| R02 `res.close` ≠ 处理结束 | 阻塞 | 改用**统一结算协调器**，结算点=上游真正结束/确认取消；单调时钟；幂等；全部失败出口走同一结算 | §6.2、SC-12～SC-14 |
| R03 120 秒封顶不成立 | 高 | 明确为**结算口径软上限**，配**有界在途超支**（≤ 并发上限 × 绝对执行时限 = 600 秒）与**绝对执行时限**；在途计入准入 | §4 D1、§6.1、§6.2、SC-07、SC-11、SC-14 |
| R04 释放无窗口版本 | 高 | 引入**窗口票据**（含 `windowId`），结算按票据归档旧窗口耗时；结算进作用域队列 | §6.2、SC-12 |
| R05 审计先于持久提交 | 阻塞 | 全链路改为**候选态 → 落库 → 发布内存 + 发审计**；续查生效与数据调用放行同批落库；落库失败保留旧态并标记作用域不可用 | §6.3、§6.4、SC-05、SC-17、SC-30 |
| R06 恢复不足致换桶逃逸 | 高 | 引入**稳定预算身份**（身份+会话，脱离注册表过期）；补全字段恢复；SC-04 要求经真实代理重启验证 | §6.1、§6.4、SC-02、SC-03、SC-04 |
| R07 取代丢失身份隔离 | 阻塞 | 作用域键含 `identityKey`；取代只作用于同身份同会话；无会话桶按身份隔离 | §6.5、SC-31、SC-32 |
| R08 并发 begin 突破不回改 | 高 | 同身份+会话的 begin 全流程串行；握手回填事务内重检「仍未归属」；只为实际更新行记录前像 | §6.5、SC-33、SC-34 |
| R09 工具授权落点缺失 | 高 | `continuable` 重定义为**可执行能力**；Plan S3 显式列出 `acl.ts`/known tools/角色授予/迁移 | §6.3、SC-15、SC-16、§3.1 |
| R10 旁路入口绕过预算 | 高 | `lucy_certified_route` / `lucy_report_template` 纳入统一 consume，内部查询以内部执行上下文免重复记账 | §2.3、§6.6、SC-35、SC-36 |
| R11 导出归因错误 | 高 | **撤回**「服务端写死 outcome=ok」；改为「导出请求发起侧带参」且列为**待查证**；分离规定无筛选与显式筛选两种期望；补前端落点 | §1.2、§1.4 C、§6.7、SC-25、SC-26 |
| R12 阶段顺序与回滚 | 高 | Plan 重排：**可观测性先行**；S2 拆为持久化正确性/统一结算/时间算法三单元；SC-37 缩为「仅时间判定兼容」 | Plan §4、§7.6 |
| R13 SC 不可验证 | 中 | 全部 SC 重写为「初态/输入/模式/观测时点」五列表；SC-10 用可控时钟构造 | §7 |
| R14 术语与引用未完成 | 低 | §3.2 明确修订两条既有词条（问询预算口径、关联调用数恒等式）；v0.1 的失效章节引用随 SC 全表重写一并消解（SC-40 改指 §4 D8 与 Plan S8）；「协议方法」改称「不计预算的本地工具」 | §3.2、§7.6、Plan S8 |

---

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

**既有词条修订**（详见 §3.2）：「问询预算」口径定义、「关联调用数」恒等式。修订在术语标准中进行，不新增术语。

协议字段 `question_budget_exhausted` 保持 `translate="no"`。新增工具名 `lucy_continue_question` 为协议标识符（英文），不进入用户可见文案，不适用翻译。
