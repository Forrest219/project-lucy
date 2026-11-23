# MCP 问询端到端性能基准与持续门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 发布取证 Spec / **v0.3-draft** |
| 日期 / 目标版本 | 2026-11-23 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-78／REQ-030-099**；**P0（核心体验／发布底线）**；独立出包／升级门禁，不改变 0.30 既有核心分母 |
| 台账号 | 无 |
| 阶段 | S1 |
| 状态 | S1｜v0.3-draft。委托人2026-11-23授权新建独立性能测试 Spec／Plan／UAT 设计；终稿未确权；开发未授权；仅设计，不执行性能跑次；不改产品优化代码；≠ 发布取证收口；≠ 可上线。 |
| 授权边界 | 仅新建 Spec／Plan／UAT 设计并登记台账。不得新增或修改 runner、workflow、CI job、测试命令、产品运行代码、配置或依赖；不得执行性能跑次、Docker 重建、出包或现场升级。后续终稿确权、测试基建开发和跑次执行分别另授。 |
| 需求 / 总账 | [REQ-030-099](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-099mcp-问询端到端性能基准与持续门禁) · [P1-78](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 计划 / 测试台 | [Plan](../plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md) · [`UAT-SUITE-MCP-INQUIRY-PERF`](../qa/uat/suites/mcp-inquiry-performance/suite.md)（设计已登记，NOT RUN） |
| 实施主体 | `scripts/e2e/` 性能测程、判定器和证据校验器；`scripts/uat/` 隔离 Docker 测程；`.github/workflows/` 持续调度；测试台。不得修改 KTX 源码或 Lucy 产品运行路径。 |
| 关联合同 | [P1-67 用户旅程性能门禁](lucy-20261120-user-journey-performance-gate-spec.md) · [P1-53 升级兼容](lucy-20261118-mcp-upgrade-compatibility-spec.md) · [**P1-54 题库（语义来源）**](lucy-20261118-mcp-upgrade-question-bank-spec.md) · [**P1-79 长追问题组（长链题目来源）**](lucy-20261123-long-followup-question-pack-spec.md) · [P1-34 大 Schema 接入（表夹具来源）](lucy-20261115-large-schema-ingestion-spec.md) · [全局规模基线（初始化数据来源，含 §1.1 MCP-PERF profile）](../qa/uat/scale-baseline.md) · [P1-37 体验韧性](lucy-20261116-mcp-ux-resilience-spec.md) · [P1-75 长尾治理](lucy-20261123-interactive-read-resilience-spec.md) · [P1-36 阶段记录](lucy-20261116-trace-span-ledger-spec.md) |

## 闭口层级

- 层级：发布取证
- 本条承诺：任一被测候选都必须用真实 Agent 自然提问和确定性 Public MCP 对照，产出从用户提问到正确完整答复的可复算性能结果；每个场景有独立样本、绝对预算和可比相对基线，持续调度能发现回退并阻断出包／升级，且全部原始尝试可审计。
- 本条出口：SC-01–SC-15（§10）。
- 不在本条出口：各模块自己的功能合同；语义答案质量的完整评测；自然问题、追问链与 oracle 的编写（归 P1-54）；初始化数据、造数脚本与规模下限的制定（归全局规模基线与 P1-34）；任何缓存、ACL、指引、查询策略、超时、数据库访问或模型参数优化；WebUI 页面与导航变更；客户生产压测、出包、发布签字或现场升级。
- 上线关系：本条通过不表示各模块无问题，更不表示可上线。

## 1. 事实与问题定义

1. **完整用户体感没有持续门禁。** P1-67 §3.3 已设计 `initialize→begin→query→continue→答复`，但仍是草案；现有低层微基准、握手测试和组合负载下的“最终正确”不能回答“用户问一句话多久得到答复”。
2. **既有相对基线存在假绿风险。** P1-53 当前 capture 将 `mcp.p95Ms` 与 `agent.medianMs` 写为 `null`；判定器仅在数值存在时比较，自动捕获的基线不能触发相对回退判定。
3. **整套聚合掩盖场景退化。** P1-53 当前 runner 将 MCP 样本聚合后统一映射为 `simple`，不能替代按场景样本下限以及 `simple／complex／denial` 分档预算。
4. **局部优化不等于完整答复优化。** P1-37 已优化握手和拒绝；P1-75 的阶段证据显示 `catalog_resolve` 与 `skills_load` 是四条慢握手的主要组成，但这些都不能代替真实 Agent 最终答复墙钟。
5. **错误不能成为性能捷径。** 快速拒绝、错误答案、删去超时、重试到正确后只留成功样本，都可能制造“很快”的假象。本条把正确性和全分母作为性能判定的前置条件，而不是另测一份与性能无关的答案质量报告。
6. **题目侧已有 owner，本条不自制。** 自然问题、追问链与 oracle 由 [P1-54 题库](lucy-20261118-mcp-upgrade-question-bank-spec.md) 拥有；其现有 `QB-FOLLOW-01／02／03` 均为 3 轮量级，**尚无 ≥20 轮长追问链**。长链已由 [P1-79 长追问题组](lucy-20261123-long-followup-question-pack-spec.md) 立项登记为独立题组包（独立 `packDigest`，不改 P1-54 与 P1-53 证据）；题组实现与自检证据到位前，`SOAK`／`LONG_FOLLOW` 记 BLOCKED，本条不得代写题目。
7. **初始化数据侧已有 owner，本条不另造。** 人口／角色／凭据／Wiki／Skill／审计行由[全局规模基线](../qa/uat/scale-baseline.md)及其 `uat:scale-baseline:seed:access｜wiki-skills｜audit` 入口拥有，表与宽表夹具由 [P1-34](lucy-20261115-large-schema-ingestion-spec.md) 拥有。本专项的 **50 路压测身份与持续压力 profile 已登记为该 SOT 的 §1.1 MCP-PERF profile**（含精确向量下限与 Wiki／Skill 实读要求）；其机器断言扩展尚需开发授权，未生效前相关用例记 BLOCKED，不得在本套件私造数字或夹具。

## 2. 单一职责与历史关系

### 2.1 本条拥有

- 性能场景、计时口径、样本分母、预算、基线格式、相对判定、测程、证据校验、负控、持续调度与报告。
- 真实 Agent 旅程和确定性 MCP 对照两条测程；二者共享场景 ID、尝试 ID 和候选指纹，但不把直连 MCP 样本冒充真实 Agent 样本。
- 性能 FAIL 的归因报告和优化交接输入。优化后的复测判定仍由本条执行。

### 2.2 本条不做

- 不修改任何产品运行时行为，不以“优化性能”为名调整 Lucy 或 KTX。
- 不改题库语义、功能 oracle、权限规则或答案正确性标准；这些分别由 P1-54 和功能合同拥有。
- 不为让候选通过而缩短问题、减少冷态、降低并发、合并预算档或剔除失败。

### 2.3 与既有 Spec 的唯一口径

| 条目 | 后续关系 |
|---|---|
| P1-67 | 其 MCP 问询部分由本条承接；P1-67 后续仅保留 API／WebUI 交互和部署对账，不再实现 W3 MCP runner。 |
| P1-53 | 保留真实 Agent 全题库、功能兼容、权限与四入口发布流程；其性能轴在本条落地后改为消费本条证据，不再维护第二套样本／预算／相对基线算法。现有 X_REL 记录不被回改，已发现缺口作为本条首批负控。 |
| P1-54 | **自然问题语义与 oracle 写法的 owner。** 本条只按题库 ID 引用，不复制、不改写、不新增题目文本。 |
| P1-79 | **长追问题组（≥20 轮）的 owner。** 独立题组包、独立 `packDigest`；本条只按 `questionRef` 与 digest 引用，题组缺失或 digest 不符记 BLOCKED。 |
| 全局规模基线 ／ P1-34 | **初始化数据的唯一 owner。** 人口／角色／凭据／Wiki／Skill／审计行＝[全局规模基线](../qa/uat/scale-baseline.md)及其三个 seed 入口，其中 §1.1 MCP-PERF profile 承载本专项的 50 路压测身份与持续压力下限；表与宽表夹具＝[P1-34](lucy-20261115-large-schema-ingestion-spec.md)。本条只消费并核对实际视图／运行时口径，不另造夹具，不在本套件私写第二套规模数字。 |
| P1-13 | 保留 `initialize／tools/list／固定业务工具` 低层热路径微基准；不得以其替代完整答复性能。 |
| P1-36 | 提供可用的阶段记录。缺少、重叠或未覆盖的阶段按未知报告，不由本条修改产品补 span。 |
| P1-37／P1-75／P1-77 及后续优化 Spec | 必须使用同一条测程做改前／改后 A/B；不得在自己的优化提交中同时提高预算或改变样本口径。 |

## 3. 决策（Normative）

| ID | 决策 | 合同 |
|---|---|---|
| D1 | 独立性能 SOT | 本条是 MCP 问询端到端性能的唯一合同。测试与优化分离；优化条目只能消费本条的测程和判定。 |
| D2 | 双测程 | **Agent 旅程**＝真实宿主自然问题→Public MCP→Lucy→真实库→最终答复；**MCP 对照**＝确定性 `initialize→notifications/initialized→tools/list→目录／发现→（begin）→query→（continue）`。禁 mock、预置答案、`:7878` 绕过和直连脚本冒充 Agent。 |
| D3 | 正确性是性能前置 | 每次计划尝试均进入分母。错误答复、意外拒绝、空信封、超时、崩溃和缺失证据均保留；快速错误不能 PASS。性能套件只做既定 oracle 的有效性护栏，不扩张为完整语义质量评测。 |
| D4 | 用户与阶段时钟分列 | 记录提问→首个可观测响应、→首 token（宿主支持时）、→首条正确查询结果、→正确完整答复；客户端墙钟、MCP RTT、服务端 `duration_ms`、模型与阶段耗时分列。 |
| D5 | 场景独立 | 每个 `scenarioId×cacheState×client/model×environment×concurrencyGroup` 独立采样和判定。冷／热、简单／复杂／拒绝、单用户／并发不得混合成分位。 |
| D6 | 样本与分位 | PR：MCP≥20／场景、Agent≥3／场景，仅作绝对上限与中位数预警，不声称 Agent P95 正式判定。夜间／出包／升级：MCP≥100／场景、Agent≥20／场景／宿主。分位采用最近秩 `sorted[ceil(p×N)-1]`；N<20 不输出正式 P95，N<100 的 P99 填 `not_estimable`。 |
| D7 | 绝对预算 | 数值唯一真源为 §5。首版数值是**设计值，非已测能力**；baseline-seed 后如需调整，必须由委托人具名冻结，不能追随失败样本抬线。 |
| D8 | 相对回退 | 同场景比较。MCP：P95 增幅 >20% 且 >50ms＝FAIL；Agent：中位数或 P95 增幅 >20% 且 >2s＝FAIL。基线必须直接持久化实际 `p50Ms/p95Ms/p99Ms/medianMs/sampleCount`；必需值为 `null`、缺字段或由当前样本临时反推代替历史值，均为 BLOCKED。 |
| D9 | 可比指纹 | 候选 gitSha／gitDirty／镜像 digest、Lucy／KTX、题库与配置指纹、夹具与资源档、客户端／模型／适配器版本、Token／Role 类别、网络入口、缓存状态必须一致。任一不可比＝BLOCKED，禁止换模型或提权凑绿。 |
| D10 | 原始证据与独立复算 | 保存逐次尝试、逐调用、逐阶段、全部终态和预算／基线摘要。汇总器不得只写顶层 PASS；独立 verifier 重读原始证据，重算分母、分位、预算和总判定，并核对正文摘要与证据 digest。 |
| D11 | 持续节奏 | PR 跑最小真实双测程；每日跑完整矩阵；出包跑完整矩阵并绑定候选 digest；升级跑 PRE／POST；优化条目跑同夹具 A/B。任何 `--skip-*` 都不得产生可发布性能证据。 |
| D12 | 负控先行 | 人为 2× 延迟、只握手无答复、快速错误、丢弃失败、样本不足、基线为 `null`、全部场景映射 `simple`、环境／模型漂移、伪造顶层 PASS 均必须被判定器拒绝。负控只在隔离测试环境，不进入生产。 |
| D13 | 口径变更独立审批 | 题库语义、性能场景、样本量、计时、预算、基线格式或相对阈值的修改必须与产品优化提交分离，并有具名评审和委托人接受记录。优化提交同时改这些文件＝性能证据无效。 |
| D14 | 归因不得虚构 | 不可观测阶段写 `not_available`，覆盖不足写 `unknown`，不得写 0。重叠 span 不得相加；`unattributedMs` 只表示未归因墙钟，不能推断为模型或数据库耗时。 |
| D15 | 判定失败关闭 | 必做场景不接受 PASS WITH GAP。缺样本、缺证据、环境不可比或宿主不可用＝BLOCKED；产品错误、预算越线、正确性失败或回退＝FAIL；两者均不是 PASS。 |
| D16 | 门禁不碰用户主路径 | 本条只阻止候选出包／升级，不拦截在线用户请求。每个拒绝性能场景必须配同身份或同级身份的合法成交对照，证明测程没有把合法路径误判为拒绝。 |
| D17 | 只消费既有 owner，不自制 | 题目、oracle、身份、凭据、Wiki／Skill／审计行和表夹具一律来自 P1-54（语义）、P1-79（长链题组）与全局规模基线／P1-34（数据）。本条新增的自然语言文本、造数脚本和规模数字一律禁止；需要新题或新 profile 时，先在 owner 侧登记并取得独立授权，本条以缺失即 BLOCKED 处理。 |
| D18 | 持续压力与长追问独立成场景 | `SOAK`＝≥1800 秒有效窗口、50 个独立 Agent 身份与真实宿主会话、截断正态到达模型；`LONG_FOLLOW`＝同一宿主进程与会话、≥20 轮后续追问、占场景实例 ≥10%。两者与 20／50 路突发并发分开判定，不得互相替代。 |
| D19 | 依赖缺失失败关闭 | 题库缺长链、基线未登记压测 profile、宿主不支持多轮或真实宿主不可用时，相关用例记 BLOCKED；不得由本条私造题目、降级为直连脚本或删减比例凑绿。 |

## 4. 场景、计时与数据模型

### 4.1 性能场景

场景引用 P1-54 的题目 ID，具体自然问题和 oracle 不在本条复制。

| 场景族 | 内容 | 预算档 | 必测 lane |
|---|---|---|---|
| 简单单表 | 一个确定指标与已知结果 | simple | Agent＋MCP |
| 过滤／时间 | 单表过滤、时间窗与分组 | simple | Agent＋MCP |
| 连续追问 | 同会话多轮，禁止拆成独立问题 | 按对应题档 | Agent＋MCP |
| 多表 join | 已声明关系的复杂查询 | complex | Agent＋MCP |
| 多库 | 分连接查询与比较，禁止发明跨连接 join | complex | Agent＋MCP |
| 权限拒绝＋合法对照 | 预期拒绝快速返回；同级合法问题仍正确成交 | denial＋simple | MCP 必测；Agent 测合法对照 |
| 冷态／代次失效 | Ready 后首轮、真实首次构建或正式代次失效 | simple／complex，冷态独立 | Agent＋MCP |
| 宽目录 | 全局规模夹具与正式角色 | simple／complex | Agent＋MCP |
| 并发公平 | 20／50 个独立 Agent 与角色组同窗问数 | simple／complex，按并发档独立 | Agent＋MCP |
| 持续压力 | 50 个独立 Agent 身份与真实宿主会话，≥1800 秒有效窗口，截断正态到达 | 按被测题档 | Agent（真实宿主）＋MCP 阶段对照 |
| 长追问链 | 同一宿主进程与会话内 ≥20 轮后续追问，语义承接 | 按被测题档 | Agent；MCP 对照只做阶段分解 |

### 4.2 计时里程碑

| 字段 | 定义 |
|---|---|
| `questionStartedAt` | 宿主提交自然语言问题前记录的单调时钟起点；多轮问题逐轮独立计时。 |
| `firstObservableMs` | 起点到宿主首次暴露非 keepalive 的本轮响应事件；工具事件与正文事件类型必须分开。若宿主只暴露最终答复，则等于最终答复并标记 `coarse`。 |
| `firstTokenMs` | 起点到首个最终答复正文 token；工具调用参数不算。宿主不支持时填 `not_available`，不得用 `initialize` 或工具事件冒充。 |
| `firstCorrectResultMs` | 起点到第一条匹配既定 oracle 的真实查询结果；错误查询后继续正确仍保留完整轨迹。 |
| `finalCorrectAnswerMs` | 起点到宿主最终答复完成且通过既定 oracle；只收到工具结果而未形成最终答复不算完成。 |
| `mcpClientRttMs` | 每次 MCP JSON-RPC 从客户端发送到收到并解析完整匹配响应。 |
| `serverDurationMs` | Lucy 审计中的服务端耗时；与客户端 RTT 分列，不相减推断网络。 |
| `turnWallClockMs` | Agent 每轮完整墙钟；超过 120000ms 直接 FAIL，不因供应商归因豁免。 |
| `unattributedMs` | 总墙钟减去可证明且不重叠的已观测区间；剩余只标未归因。 |
| `windowIndex／windowSeconds` | 持续压力窗口编号与实际窗口长度；有效窗口不含准备、预热与清理。 |
| `offeredAt／dispatchLagMs` | 计划到达时刻与实际发出时刻之差。系统变慢时计划到达不得被静默合并或丢弃；未派发即失败并单列。 |
| `chainId／turnIndex` | 长追问链标识与链内轮次；`turnIndex` 在链内严格递增，缺号或重号使该链无效。 |
| `processId／hostSessionId` | 宿主进程与宿主会话标识，用于证明“单进程追问”；进程或会话变化即链失效。 |

所有里程碑来自同一单调时钟域。跨进程记录同时保留 UTC 时间用于关联，不用不同机器的可调墙钟直接计算时延。

### 4.3 尝试与证据最小字段

- 身份：`runId／scenarioId／caseId／attemptId／retryOf／traceId／rpcRequestId`；没有某字段时写缺失原因。
- 输入：题库与配置 digest、预算档、缓存状态、并发组、角色类别、客户端／模型指纹。
- 结果：`outcome／correctness／errorClass／timeoutMs／firstAttempt／finalAttempt`；所有计划重试均有独立记录。
- 计时：§4.2 字段及 `mcpCalls[]／stages[]／unattributedMs`。
- 汇总：每场景样本量、正确／错误／超时数、P50／P95／P99／max、绝对判定、相对基线及判定。
- 指纹：候选、环境、题库、配置、预算、测程版本和证据正文 SHA-256。

公开证据只含合成题 ID、数值和脱敏关联键。Token、Cookie、Session、密码、原始业务行、私有提示词和客户对象名不得进入仓库或公开报告；私有凭据目录 0700、文件 0600。

## 5. 首版绝对预算（设计值，待实测冻结）

> 本表是未来判定输入，**不是当前产品已达到的性能声明**。baseline-seed 只能证明测得多少，不能自动把本表改成实测最大值。PR 与正式跑次使用相同绝对线；样本量按 D6 区分可主张的统计指标。

### 5.1 MCP 对照

| 场景 / 里程碑 | 预算 |
|---|---|
| 暖态 `initialize` | P50≤200ms，P99≤2s，>30s＝0 |
| 预期拒绝 | P95≤500ms，P99≤2s；同级合法查询必须正确成交 |
| simple 首条正确查询结果 | P95≤5s；单次测程截止 15s |
| complex 首条正确查询结果 | P95≤30s；单次测程截止 60s |
| simple 暖态完整 MCP 旅程 | P95≤10s；冷态 P95≤15s |
| complex 暖态完整 MCP 旅程 | P95≤30s；冷态 P95≤45s |

### 5.2 真实 Agent 旅程

| 场景 / 里程碑 | 预算 |
|---|---|
| 首 token（宿主支持时） | P95≤10s；不支持时只报告 `not_available`，不得替代成其他事件 |
| simple 正确完整答复（暖态） | P95≤30s |
| complex 正确完整答复（暖态） | P95≤60s |
| simple 正确完整答复（冷态） | P95≤45s |
| complex 正确完整答复（冷态） | P95≤90s |
| 任意单轮 | `turnWallClockMs≤120s`；越线即 FAIL |

### 5.3 并发与公平性

- 20／50 路分别形成独立场景档，仍适用对应 simple／complex 绝对预算及 120s 单轮硬线。
- 每个角色组分别计算 P50／P95／max；最慢角色组 P95 不得高于最快角色组 P95 的 2 倍＋2s，且不得发生角色饥饿、意外拒绝或跨角色数据泄露。
- 同步点只定义发压目标；必须另证不同 Agent 的实际在途峰值。未形成目标并发不能宣称完成并发测试。

### 5.4 持续压力与长追问

| 场景 | 预算与判定 |
|---|---|
| `SOAK` 有效窗口 | **≥1800 秒**，建议 12 个 150 秒窗口；准备、预热、恢复与清理时间另列，不计入有效窗口 |
| `SOAK` 到达模型 | 固定 seed 的**截断正态**思考时间；记录 μ、σ、截断上下界与实际分布。均匀同发或固定 1Hz 不算正态行为；系统变慢时计划到达不得静默降载 |
| `SOAK` 分母 | 50 个独立 Agent 身份与真实宿主会话全程在窗；每身份至少完成 1 轮且留有可核对轨迹。计划到达与终态必须一一对应，未派发、未终结、超时与失败全部计入分母 |
| `SOAK` 时延 | 每窗口沿用对应题档绝对预算；相邻窗口与首窗／尾窗的比较适用 D8 双阈值（MCP P95 >20% 且 >50ms；Agent 中位数或 P95 >20% 且 >2s＝FAIL） |
| `SOAK` 正确性与公平 | 全窗正确率、无意外拒绝、无角色饥饿；各角色组分别判定，仍适用 §5.3 公平性 |
| `LONG_FOLLOW` 比例 | 按**场景实例数**计：`longFollowUpChains / allScenarioChains ≥10%`，按 `ceil(0.1×N)` 取整，不按总轮次计；`SOAK` 档 50 个身份即至少 **5 条**长链 |
| `LONG_FOLLOW` 轮次 | 每链首轮之后**不少于 20 次后续追问**（链内总轮次≥21），语义承接且逐轮核对 oracle |
| `LONG_FOLLOW` 单进程 | 全链保持同一宿主进程与同一宿主会话；进程重启、换会话、拆成独立问题或链内轮次缺失即该链无效 |
| `LONG_FOLLOW` 时延 | 每轮沿用对应题档预算与 120 秒单轮硬线；链内前 5 轮与后 5 轮的中位数比较适用 D8 双阈值；任一轮正确性失败即整链 FAIL |
| `LONG_FOLLOW` 结论 | 链级结果与逐轮结果分列；链级 FAIL 时保留全部逐轮轨迹，不只报链首或链尾 |

## 6. 基线与证据格式

### 6.1 持久化位置

- 正式基线：`docs/qa/uat/suites/mcp-inquiry-performance/baselines/<questionSetVersion>-<environmentProfile>-<clientModelHash>-<gitSha>.json`。
- 当前接受指针：同目录 `LATEST.json`，只指向已经具名接受的基线，不接受工作目录中“刚刚跑出”的自动晋级。
- 公开原始证据：`docs/qa/uat/suites/mcp-inquiry-performance/evidence/<runId>/summary.json`、`attempts.ndjson`、`negative-controls.json`；跑次叙事放 `runs/`。
- 私有凭据和任何客户材料保存在仓库外，不进入上述目录。

### 6.2 基线记录

每个场景分别保存：

```text
scenarioId, cacheState, concurrencyGroup, budgetClass,
sampleCount, correctCount, failedCount, timeoutCount,
p50Ms, p95Ms, p99Ms | not_estimable, medianMs, maxMs,
questionSetDigest, configDigest, fixtureDigest, budgetDigest,
candidateFingerprint, environmentFingerprint, clientFingerprint,
modelFingerprint, evidenceBodyDigest, acceptedBy, acceptedAt
```

持续压力与长追问场景另记：`windowIndex／windowSeconds／offeredCount／dispatchedCount／arrivalModel{seed,mu,sigma,clipMin,clipMax}／firstWindowStats／lastWindowStats`，以及链级 `chainCount／minTurns／medianTurns／firstFiveMedianMs／lastFiveMedianMs／chainVerdict`。缺少任一必需字段时该场景基线不可用，比较记 BLOCKED。

`p50Ms／p95Ms／medianMs／sampleCount` 是正式相对比较必填数值；`p99Ms` 仅在 N≥100 时为数值。不得保存 `p95Ms:null` 后继续参与相对判定。基线只由原始尝试重算生成，不能手工填写一个无原始证据的数。

### 6.3 总判定

- `PASS`：全部必做分母完整，正确性护栏、绝对预算、相对门禁、并发公平和证据校验全部通过。
- `FAIL`：存在产品错误、错误答复、意外拒绝、预算越线、相对回退、证据篡改或负控未检出。
- `BLOCKED`：缺前置、宿主、样本、基线、可比指纹或必要观测，无法作出真实判定。
- `SEED_ONLY`：首次基线样本有效但尚未被具名接受；只可用于基线评审，不得作为 releaseReady。
- `NOT RUN`：尚未执行；不产生任何通过含义。

## 核心流程（伪代码）

```text
runMcpInquiryPerformance(trigger, candidate, baselinePointer):
  require trigger in {pr, nightly, release, upgrade_pre, upgrade_post, optimization_ab, soak, long_follow}
  require isolatedDocker && realPublicMcp && realDatabase && selectedRealAgent
  freeze candidate, questionSet, config, fixture, budget, client, model fingerprints
  require questionsFromQuestionBankSpec && fixturesFromScaleBaselineSpec  # D17：缺 owner 资产即 BLOCKED

  if trigger includes release or upgrade_post:
    require acceptedBaseline(baselinePointer) else return BLOCKED
    require comparableFingerprints(candidate, baseline) else return BLOCKED

  attempts = []
  for scenario in requiredScenarios(trigger):
    planned = planAttempts(scenario, sampleFloor(trigger), cacheState, concurrency)
    for attempt in planned:
      result = executeRealJourney(attempt)       # Agent 与 MCP 分 lane，不互相冒充
      attempts.append(captureEveryOutcome(result)) # 成功、错误、拒绝、超时、崩溃、缺证均保留

  if trigger includes soak:
    require effectiveWindowSeconds >= 1800 && identitiesInWindow == 50
    require offeredArrivalsUseTruncatedNormalSeedAndAreNeverSilentlyReduced
    require everyOfferedArrivalHasTerminalOutcome
  if trigger includes long_follow:
    require chainRatio >= 0.10 && everyChainTurns >= 21 && chainProcessAndSessionStable

  require independentOracleCheck(attempts)
  require evidenceCoverage(attempts) else return BLOCKED
  summaries = groupByScenarioCacheClientModelEnvironmentConcurrency(attempts)
  require perScenarioSampleFloors(summaries) else return BLOCKED

  for summary in summaries:
    summary.percentiles = nearestRank(summary.allAttemptLatencies)
    verdict.correctness = checkFastWrongAndDenials(summary, attempts)
    verdict.absolute = checkBudget(summary, budgetFor(summary.scenarioId))
    if summary.scenarioId == SOAK:
      verdict.windowTrend = compareAdjacentAndFirstLastWindows(summary)
    if summary.scenarioId == LONG_FOLLOW:
      verdict.chainTrend = compareFirstFiveAndLastFiveTurns(summary)
    if baselinePointer.exists:
      baseline = readAcceptedNumericBaseline(summary.key)
      require baseline.p50Ms && baseline.p95Ms && baseline.medianMs else return BLOCKED
      verdict.relative = compareWithinSameKey(summary, baseline)
    else:
      verdict.relative = SEED_ONLY

  verdict.fairness = checkRoleFairnessAndActualConcurrency(attempts)
  evidence = writeRedactedRawAttemptsAndSummaries(attempts, summaries, verdict)
  recomputed = independentVerifierRereadAndRecompute(evidence)
  require recomputed == verdict else return FAIL(EVIDENCE_MISMATCH)
  return aggregateFailClosed(verdict, evidence.digest)
```

## 7. 持续运行与发布接线

| 触发 | 最小范围 | 结果用途 |
|---|---|---|
| PR | 简单单表、连续追问、多表、权限合法对照；双测程；D6 PR 样本 | 阻断明显绝对退化；Agent 小样本不得伪称正式 P95 |
| 每日 | 全性能场景、冷／热、20 路并发、`SOAK` 持续压力、`LONG_FOLLOW` 长追问、完整正式样本 | 趋势、基线候选和回退告警；同一候选可累计到 P99 所需样本 |
| 出包 | 全性能场景、20／50 路、`SOAK`、`LONG_FOLLOW`、正式样本、绑定候选 digest | 必需 PASS；SEED_ONLY／FAIL／BLOCKED／NOT RUN 均不得放行 |
| 升级 | 同实例／同身份／同题／同环境／同客户端模型 PRE／POST，含 `SOAK` 与 `LONG_FOLLOW` | 必需 PASS；缺 PRE 基线＝BLOCKED；回滚后另验基线恢复 |
| 优化 A/B | 同夹具、同候选族、单变量改前／改后 | 优化 Spec 的必要证据；不得由优化者单独信顶层自报 PASS |

新增命令与 CI job 实现时必须登记 `docs/governance/test-layers-and-release-gates.md` 的 Current Commands 与 CI Mapping。每日任务至少连续两次无人值守产生有效记录，第二次能引用第一次已接受基线，才能声称“持续运行”。

## 8. 优化交接合同

性能 FAIL 报告必须输出：场景、候选与基线指纹、全部原始失败、分位差、首个越线里程碑、可观测阶段、未归因区间及建议排查方向。报告只定位，不在本条实施修复。

优化 Spec 收口必须附：

1. 同一测程版本、题库、配置、夹具、客户端和模型的改前／改后证据 ID。
2. 每个受影响场景的样本量、P50／P95／P99、正确性和全部失败。
3. 未退化场景的对照结果，尤其纯 MCP 合法成交和并发公平。
4. 独立 verifier 的复算结果。
5. 若修改性能口径或预算，另附与优化提交分离的具名批准；没有则证据无效。

## 9. 主路径可用性自检

1. 门禁不改变在线用户请求，不新增拒绝或逃生要求；出包／升级被阻断不等于在线用户被阻断。
2. 权限拒绝测速必须与同级合法查询同窗执行，合法查询错误或不完整时本条 FAIL。
3. 真实 Agent 与纯 MCP 均无 WebUI 会话依赖；不得用 WebUI 管理身份代替普通问数身份。
4. 外部模型或宿主不可用记 BLOCKED，不把跳过、降级脚本或 mock 记成真实用户性能 PASS。

## 10. 验收

| ID | 可打假检查 | UAT |
|---|---|---|
| SC-01 | 隔离 Docker 中真实 Agent 经 Public MCP、Lucy 和真实库完成全部分母；直连 MCP 仅对照，mock／预置答案／`:7878`／高权替代均无效 | UAT-MIP-R0／01 |
| SC-02 | 提问、首可观测响应、首 token（支持时）、首正确结果、最终正确答复及 MCP／服务端／阶段时钟可关联；未知不填 0 | UAT-MIP-02 |
| SC-03 | 每场景、缓存、客户端／模型、环境和并发组独立满足样本量；不足不出正式分位，复杂与拒绝不得统一落入 simple | UAT-MIP-03 |
| SC-04 | 全部尝试进入分母；快速错误、意外拒绝、空信封、超时、只留成功重试均不能 PASS；合法对照仍成交 | UAT-MIP-04 |
| SC-05 | §5 每档绝对预算由判定器逐场景执行；首版数值调整有独立具名冻结，不能随失败自动抬线 | UAT-MIP-05 |
| SC-06 | 正式基线含真实数值与原始证据；`null`／缺字段／手填无证据／指纹不匹配均 BLOCKED；MCP 与 Agent 相对回退均被真实执行 | UAT-MIP-06 |
| SC-07 | 冷／热不混，20／50 路实际在途达标；各角色无饥饿、无越权且公平性达线 | UAT-MIP-07 |
| SC-08 | verifier 重读原始证据并重算分母、分位、相对差和总判定；摘要篡改或 digest 不符即 FAIL；泄露扫描通过 | UAT-MIP-08 |
| SC-09 | D12 全部负控被检出，尤其 2× 延迟、`null` 基线、整套聚合统一 simple、仅 initialize、丢失败及伪造 PASS | UAT-MIP-09 |
| SC-10 | PR／每日／出包／升级接线真实生效；跳过或无证据不能 releaseReady；连续两次无人值守每日跑次形成可比链 | UAT-MIP-10 |
| SC-11 | 优化 A/B 只改一个产品变量；同口径复算；优化与预算／样本／测程改动未分离时证据无效 | UAT-MIP-11 |
| SC-12 | 报告能定位首个越线里程碑、阶段与未归因区间；重叠 span 不相加，供应商延迟只归因不豁免 | UAT-MIP-12 |
| SC-13 | P1-67 不再保留并行 MCP runner 范围；P1-53 性能轴消费本条证据；P1-54 题库与 P1-13 微基准边界清楚，无第二套口径 | UAT-MIP-13 |
| SC-14 | 持续压力：50 个独立 Agent 身份与真实宿主会话，有效窗口 ≥1800 秒、截断正态到达、计划到达与终态一一对应；每窗口及首尾窗口的分位、正确性、公平性达标，无静默降载 | UAT-MIP-14 |
| SC-15 | 长追问：≥10% 场景实例为单进程同会话长链，每链 ≥20 次后续追问、逐轮 oracle 成立、链内轮次与进程／会话证据完整，前 5 轮与后 5 轮比较达标 | UAT-MIP-15 |

## 受影响画像

> 事实源：[Lucy 用户画像](../governance/user-personas.md)。以下为待验证设计目标，不表示当前已经提速。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 完整答复变慢可能直到投诉才被发现；局部握手绿灯不能代表问询体感 | 每次出包／升级都以正确完整答复墙钟、并发、持续压力与长追问结果判定；回退被阻断并有合法成交对照 | P1·问数面 ↑／P1·报告面 ＝ | SC-01／04／05／07／14／15；报告面未触碰 | — |
| P2 治理方 | 语义与授权配置路径不变，但配置对性能的影响缺少统一对照 | 配置操作本身不变；同一题库／配置指纹可解释性能结果，不要求学习新配置入口 | ＝ | SC-01／06／13；不改语义与授权配置路径 | — |
| P3 运维方 | 性能证据分散、基线可能不可比，出包／升级缺少完整答复门禁 | 可按候选、环境和 runId 复查原始证据；FAIL／BLOCKED 有明确排查入口 | P3·运行观察面 ↑／P3·交付运维面 ↑ | SC-08／09／10／12 | — |
| P4 管理层 | 工程微基准或一次 PASS 可能被误读为用户体验 | 管理层看到的是同口径完整答复分位、正确性分母和趋势，不宣称未测宿主或环境 | ↑ | SC-03／06／08／10 | — |

## 交互合同豁免

- 原因：本条只增加工程测程、证据、UAT 与发布门禁，不改变用户可见 WebUI 表面。
- 不改变：主导航、二级菜单、页内 Tab 和任何 WebUI 可见面；纯 MCP 任务不强制浏览器测试。若后续新增 WebUI 性能看板，必须另立功能 Spec、独立确认导航 IA，并执行真实前台浏览器＋计时验收。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 「MCP 问询端到端性能」「首条正确查询结果」「正确完整答复」「性能基线」「相对回退」仅作为工程与测试报告术语，不新增用户可见产品概念。`trace_id`、Token、gitSha、digest、P50／P95／P99 和客户端／模型指纹在报告中保留英文并添加浏览器翻译防御；不得把 `initialize` 称为「问询完成」，不得把工具结果称为「最终答复」。

## 风险与开放项

- 首版绝对预算是设计值，须在正式 baseline-seed 后由委托人确认冻结；该开放项只影响数值，不影响双测程、全分母、按场景判定、证据和负控合同。
- 真实模型存在供应方波动与成本。必须以同客户端／模型指纹比较并保留原始样本，不能删除慢样本；成本只记录，不设缩减必做题的总成本上限。
- 首 token 依赖宿主能力。首版至少选择一个能提供最终答复事件的宿主；流式 token 不支持时如实缺省，完整答复墙钟仍是硬指标。
- 题目依赖已立项、实现未闭合：长链题组由 P1-79 承载（独立题组包与独立 digest，不改 P1-54 与 P1-53 证据）。在 P1-79 完成题组编写、校验与自检前，`LONG_FOLLOW` 及其在 `SOAK` 中的比例要求记 BLOCKED，不得由本条代写题目。
- 初始化数据依赖已登记、断言未闭合：全局规模基线 §1.1 已登记 MCP-PERF profile（50 路压测身份、精确向量下限、Wiki／Skill 实读、`lucy_admin` 运行时绑定），但其机器断言扩展尚需开发授权；断言生效前相关用例记 BLOCKED，不得在本套件私造数字或脚本。
- 本条落地需要测试基建开发与真实跑次授权；当前设计完成不代表门禁已经运行。

## 修订记录

- 2026-11-23 v0.3-draft：依赖补登完成——长链题目由新立项的 [P1-79 长追问题组](lucy-20261123-long-followup-question-pack-spec.md) 承载（独立题组包与独立 digest，不动 P1-54 与 P1-53 已收口证据）；初始化数据的 50 路压测身份与持续压力下限登记进[全局规模基线 §1.1 MCP-PERF profile](../qa/uat/scale-baseline.md)。两项实现证据到位前，相关用例仍记 BLOCKED。
- 2026-11-23 v0.2-draft：按委托人要求改为只消费既有 owner——自然问题与 oracle 取自 P1-54 题库 Spec，初始化数据取自全局规模基线（含三个 seed 入口）与 P1-34 表夹具，本条不自制题目、造数脚本或第二套规模数字。新增 `SOAK` 持续压力与 `LONG_FOLLOW` 长追问场景及 SC-14／SC-15；依赖缺失一律 BLOCKED。
- 2026-11-23 v0.1-draft：独立新建，承接 P1-67 的 MCP 范围；只拥有性能测量、基线、判定、证据与持续门禁，优化由其他 Spec 执行。
