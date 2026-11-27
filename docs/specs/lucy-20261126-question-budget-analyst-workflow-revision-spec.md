# 问询预算面向分析师高频工作流与慢数仓（hive-jd）体验修订 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能修订 Spec（问询预算分析师工作流与慢数仓体验）／**v1.0-r8** |
| 日期 | 2026-11-26（v0.2-draft）／2026-11-27（v1.0 定稿；r8＝开发授权） |
| 功能编号 / 优先级 | **REQ-0122**／**P0／主路径体验严重缺陷修复**；修订 Spec 162 §7.2、窗口优化 Spec、P1-12、P1-74 与 P1-82 默认并发／超时耦合 |
| 阶段 | S3 |
| 状态 | S3｜v1.0-r8。终稿已确权（D1–D8／OQ-4／OQ-6）；PRE-01／§10.3 UAT 设计已闭合；**开发授权已获得（委托人 2026-11-27 明示「授权开发」）**；配对 [Plan](../plans/lucy-20261127-question-budget-analyst-workflow-revision-plan.md)；**Tasks 0–4 运行代码／单测已落地**（Task 5 定向 vitest 绿；demo 镜像重建本机 BuildKit 挂起未完成）；测试台 NOT RUN；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 台账号 | 挂常青需求池 `REQ-0122` |
| 决策来源 | 2026-11-26 委托人审阅反馈：当前预算规格上线会频繁干扰重度使用 Claude Code ＋ Lucy MCP 的数据分析师，且客户强依赖 `hive-jd`，定性为严重用户体验 Bug，指示起草正式预算规格修订 Spec。2026-11-27 委托人裁定：D1–D8 全案采纳推荐案 (a)，并明示确权本 Spec 终稿；同日重裁 OQ-4／OQ-6＝A、闭合 PRE-01／§10.3；同日明示 **开发授权** |
| 与既有 Spec 的关系 | **修订** [`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md) §7.2、[`lucy-20261029-question-budget-window-optimization-spec.md`](lucy-20261029-question-budget-window-optimization-spec.md)（并发与计费工具集）、[`lucy-20261111-question-budget-threshold-relax-spec.md`](lucy-20261111-question-budget-threshold-relax-spec.md)（忙时上限与可配置性）、[`lucy-20261122-question-budget-mainpath-escape-spec.md`](lucy-20261122-question-budget-mainpath-escape-spec.md)（active 续查档数与停机引导），并**协同调整** P1-82 执行容量默认档位（`webui/server/runtime/mcp-execution-capacity.ts`）与代理上游超时／取消冻结默认值（`webui/server/proxy/mcp-proxy.ts`）。**保留** runaway 防火墙、settled busy 口径、稳定作用域键、两段式续查／`mode=new_question` 逃生、软信封与 ACL 边界；**r1 跨 Spec 基线（对照 [REQ-0119](lucy-20261127-integration-mcp-capacity-backpressure-spec.md)）**：本条 D2 四层默认（8/16/32/48）为两 Spec 共同基线（REQ-0119 OQ-global 冻结解除、borrowMax 与 global×0.5 解耦初始 12）；本条 D2 轻工具元数据独立并发池仍受 REQ-0119 workload 门覆盖（integration 身份全部调用计入 `integrationActive`，不得借独立池绕过 `borrowMax`）；D7 文案面向 interactive，integration 静态极简指引归 REQ-0119 OQ-7／SC-11、不随本条更新；**排期：本条（P0）先落地，REQ-0119（P1）压测校准随后** |
| 实施主体 | Lucy（Proxy 问询预算层 + 执行容量层 + 上游超时配置 + `initialize` 指导）；不修改 KTX 源码 |
| 部署实况 | **纯 MCP**（以 Claude Code 为典型代表，兼容 Cursor／Codex 等经 Bearer 接入的客户端），重点覆盖**慢分析型外部目录**（如 SelectDB／Doris 外部 Hive Catalog `hive-jd`）与零绑定（begin 隐藏）／有绑定（begin 可用）两种实况 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在保留 runaway Agent 问询预算防火墙的前提下，重度使用 Claude Code ＋ Lucy MCP 并在慢分析型外部目录（如 `hive-jd`）上进行并发探索、多轮下钻与中断重试的数据分析师，不再被 4 路硬并发、轻元数据同桶计费、30 秒空闲超时叠加忙时耗尽、取消后 30 秒槽位冻结或保守停机文案频繁打断主路径。
- 本条出口：SC-01–SC-12＋SC-07b＋SC-02b（必须同时覆盖「防火墙仍有效拦住 runaway」与「并发 6–8 路探索／慢查询多轮下钻／中断重问／长会话逃生在纯 MCP 下端到端成交」；SC-07b＝OQ-4 持续失败有界；SC-02b＝OQ-6 轻工具跨窗有界）。
- 不在本条出口：客户环境现场交付、离线镜像发布取证、跨副本分布式限流、修改 KTX 源码、取消问询预算防火墙。
- 上线关系：本条收口不表示可上线

---

## 1. 问题与根因（严重用户体验 Bug 定性）

既有演进（窗口优化 `settled busyMs`、P1-12 放宽至 60 次／300s、P1-74 主路径逃生）解决了「思考时间耗尽预算」与「触顶后无逃生死角」，但**假设背景仍是单路串行、亚秒级 MySQL 轻量问数**。面对**重度依赖 Claude Code ＋ Lucy MCP 且强依赖 `hive-jd`（SelectDB／Doris 外部 Hive Catalog）**的典型数据分析师，现行规格与默认参数叠加形成五个高频干扰点：

1. **双重 `4` 路并发硬闸门与 Claude Code 并行工具调用强冲突**
   - 预算层写死 `QUESTION_BUDGET_MAX_INFLIGHT = 4`（`webui/server/proxy/question-experience.ts:13`），容量舱壁层默认 `token: 4`（`webui/server/runtime/mcp-execution-capacity.ts:19`）。
   - Claude Code 习惯在单轮推理中并发发起 5–8 个工具调用（例如并行 `lucy_read_source` 探查多张表，或并行 `lucy_query` 对比多维度／多期间）。超出 4 路的调用直接返回 `isError: true` 且无 `next_step` 指导，且 `initialize` 指导中未披露并发上限，导致模型误判缺数或反复撞墙。
2. **轻元数据／Wiki 工具与重数仓查询同桶争抢额度与并发槽**
   - 当前 `DATA_TOOLS` 将 `lucy_read_source`、`lucy_freshness`、`lucy_explain_query`、`wiki_search`、`wiki_read` 与 `lucy_query` 等权计入 60 次上限、300s 忙时和 4 路并发（`webui/server/proxy/question-experience.ts:63–70`）；同时 `lucy_read_source` 位于 `UPSTREAM_SEMANTIC_TOOLS`（`webui/server/proxy/field-exposure.ts:49`），在代理层与 `lucy_query` 共享同一套 `McpExecutionCapacity` `token: 4` 并发槽（`mcp-proxy.ts:7770`）。
   - `hive-jd` 存在大量宽表与多表关联，分析师前期探索表结构与业务口径即消耗大量额度，甚至并发读 5 张表的 `lucy_read_source` 就会触发并发拒绝。
3. **慢数仓（`hive-jd`）遭遇 `30s` 空闲超时 + 失败耗时全额计入 `300s busyMs` 的连环打断**
   - 代理默认 `UPSTREAM_TIMEOUT_MS = 30_000`（socket 空闲超时，`mcp-proxy.ts:236`）、`UPSTREAM_HARD_DEADLINE_MS = 90_000`（`mcp-proxy.ts:248`），而预算层 `QUESTION_BUDGET_MAX_BUSY_MS = 300_000` 硬编码且不可配置。
   - `hive-jd` 外部目录查询冷启动或大表聚合常需 15–45 秒。不仅极易触发 30s 空闲超时，而且**超时／失败未出数的耗时仍全额结算进 `busyMs`**，几轮正常下钻加失败重试即可耗尽 300s 窗口。
4. **中断重问锁槽 30 秒 + 单连接 16 路成为团队瓶颈**
   - `CANCEL_UNCONFIRMED_HOLD_MS = 30_000`（`mcp-proxy.ts:242`）：分析师在 Claude Code 见查询较慢按 `Esc` 中断并立刻换条件重问时，被中断的并发槽会继续锁死 30 秒，紧接着的新查询被连续拒绝。
   - 容量层 `connection: 16`（`mcp-execution-capacity.ts:19`）：全员强依赖 `hive-jd` 时，仅 4–5 位分析师同时并发查数就会打满单连接上限，触发全员限流。
5. **长会话逃生摩擦力与 `begin active` 不对称硬停**
   - `initialize` 指导与 `webui/config/data-qa-instructions.md` 面对 `question_budget_exhausted` 首句仍写 `"stop looping"`（`问询预算用尽时停止循环`），在长上下文下易诱发 Claude 提前收口或停下来向分析师二次确认，打断心流。
   - 一旦启用口径绑定（`begin active`），续查档数被锁死为 **1 档**（对比 `inactive` 的 5 档），分析师在同一主题下连续追问而模型未重调 `lucy_begin_question` 时更易意外硬停。

**一句话根因**：预算、并发舱壁与上游超时三层默认值均未针对「并行 Agent（Claude Code）＋ 慢分析型外部目录（`hive-jd`）」校准，且轻重工具未分层，导致合法高频分析工作流频繁被内部保护机制误伤。违反 [`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「主路径可用性优先」。

---

## 2. 目标与非目标

### 2.1 目标

1. **轻重工具分层计费**：将仅读元数据／文档的轻工具从主查询预算桶和 4 路查询并发限流中剥离，主桶聚焦真正打上游数仓引擎的查询工具；轻工具保留独立高阈值防死循环保护与独立元数据并发池。
2. **适配 Claude Code 并发与多分析师共用 `hive-jd`**：放宽单作用域／单 Token、单 Agent、单连接与全局并发默认上限；并发超限时返回结构化 `retryable: true` 与 `next_step`；缩短取消未确认的名额冻结时长。
3. **适配慢分析型数仓（`hive-jd`）的超时与忙时口径**：将 `busyMs` 上限放宽并环境变量化；将上游空闲超时与硬时限对齐慢查询特征；对超时／失败未出数的调用做 `busyMs` 单次结算封顶，避免上游抖动迅速打空预算。
4. **降低长会话逃生打断感**：优化 `initialize` 指导文案，引导模型在可逃生时静默完成续查／重开并继续分析；适度放宽 `begin active` 续查档数。
5. **保留防火墙与向后兼容**：runaway Agent 仍有明确有界停机与审计；所有新默认值均可通过环境变量回退或按部署调优，不破坏既有协议字段名与 reason 码。

### 2.2 非目标

- 不取消问询预算，不默认关闭 `LUCY_QUESTION_BUDGET`。
- 不修改 KTX 源码或引入多副本分布式限流。
- 不改变 ACL、行级策略、表级歧义门闩、口径绑定、失败四维度定义。
- 不恢复 `begin inactive` 下 `lucy_begin_question` 的写预算副作用（保持 P1-60／P1-74 合同）。
- 不在本条新增 WebUI 页面、导航或前端配置表单（运维配置继续走环境变量）。

---

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 中文主术语 | 约束 |
|---|---|---|
| Query-tier tool | 重查询工具 | 触发上游数仓查询引擎、计入主问询预算与查询并发槽的工具集合（`lucy_query`、`lucy_certified_route`、`lucy_report_template`） |
| Metadata/context tool | 轻元数据与上下文工具 | 仅读取语义元数据、新鲜度、诊断或 Wiki 的工具集合（`lucy_read_source`、`lucy_freshness`、`lucy_explain_query`、`wiki_search`、`wiki_read`）；走独立防死循环高阈值与独立元数据并发池，不占主查询并发与 `busyMs` |

既有词条沿用：「问询预算」「可继续」「预算终止」「预算逃生」「预算硬停」「新问询重开」。协议标识 `question_budget_exhausted`、`question_budget_concurrency_exceeded`、`question_budget_unavailable` 保持 `translate="no"`。

---

## 4. 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | P1·问数面：Claude Code 并发 5+ 工具即报错；读多张表消耗主预算；`hive-jd` 慢查询 30s 超时且失败吃满 300s 忙时；Esc 中断后槽位锁死 30s；停机文案易致提前收口。P1·报告面：未触碰 | P1·问数面：并发 8 路内平滑放行，超限可按 `next_step` 自动缩并发重试；轻工具不挤占主查询额度；慢查询 90s 内正常返回且失败记账有封顶；中断后 5s 内可重问；可逃生时模型静默续跑。**已知权衡（G3）**：全局空闲超时 30s→90s 后，MySQL 等快源上真正挂起无首字节的异常查询会多等 60s 才报超时（本期接受此权衡，二期按连接配置 OQ-1 消除）。P1·报告面：未触碰（不改 Live Report 路径） | **P1·问数面 ↑／P1·报告面 ＝** | SC-01–SC-10、SC-12；`webui/server/proxy/question-experience.ts`、`mcp-proxy.ts`、`mcp-execution-capacity.ts` | — |
| P2 治理方 | 未触碰 WebUI 治理控制台与语义／ACL 配置面 | 保持不变；不新增配置入口或心智模型，不改行权限与口径绑定语义 | **＝** | 未改 WebUI 前端治理面源码与 `acl.ts` 授权逻辑；SC-11 | — |
| P3 运维方 | P3·运行观察面：单连接 16 路与 30s 超时导致 `hive-jd` 高峰频繁报警；`busyMs` 硬编码无法按客户调优。P3·交付运维面：放宽默认并发与忙时上限后，单实例上游峰值等待上界上升 | P3·运行观察面：新增轻重分层与失败封顶审计字段，阈值全量环境变量可调。P3·交付运维面：单连接并发默认提至 32、全局 48，且轻工具设独立元数据并发池，极端 runaway 峰值占用高于旧版 | **P3·运行观察面 ↑／P3·交付运维面 ↓** | SC-03、SC-07、SC-08、SC-11；§5.1 资源上界表 | **补偿路径（纯 MCP／容器部署实况可达）**：① 全量上限可通过环境变量一键回调至旧档（含 `token/agent/connection/global` 四档容量变量与超时／预算变量，见 SC-11）；② `UPSTREAM_HARD_DEADLINE_MS` 与 `QUESTION_BUDGET_ABS_EXEC_MS` 仍保持 120s 硬封顶，轻重工具均有独立并发与次数封顶，runaway 防火墙仍生效（SC-01、SC-02、SC-03） |
| P4 管理层 | 审计概览与使用指标口径未变 | 保持不变；预算终止仍独立于四类失败维度，不扭曲成功率与业务结果口径 | **＝** | 未改 `admin/audit.ts` 概览汇总合同；SC-10 | — |

**产品级复核（对齐 `user-personas.md` §4.4）**：P3·交付运维面的 `↓` 源于默认并发与忙时放宽带来的上游资源峰值上界提升，**不构成**对「主路径可用性优先」的违反；相反，本修订直接修复了 P1·问数面在 Claude Code ＋ `hive-jd` 上的严重可用性缺陷，且运维方保有全量环境变量回退开关与硬超时封顶作为补偿（SC-01、SC-02、SC-11）。

---

## 5. 已裁定决策表（D1–D8）

| 编号 | 决策项 | 选项 | 推荐 | 状态 |
|---|---|---|---|---|
| **D1** | 工具计费分层 | (a) **轻重分层**：主预算桶（60 次／忙时／查询并发槽）仅计重查询工具（`lucy_query`、`lucy_certified_route`、`lucy_report_template`）；轻工具（`lucy_read_source`、`lucy_freshness`、`lucy_explain_query`、`wiki_search`、`wiki_read`）走独立轻量计数上限（默认 **200 次／窗**，不占 `busyMs` 与查询并发槽）<br>(b) 维持全部 6 类工具同桶，仅把总次数放到 150 | **(a)** | **已裁定（采纳 a，2026-11-27）**；**跨窗总界见 OQ-6＝A（2026-11-27）** |
| **D2** | 并发上限、轻工具容量池与超限语义 | (a) **重查询**：预算层 `QUESTION_BUDGET_MAX_INFLIGHT` 默认 **4 → 8**（环境变量可配）；容量层 `DEFAULT_CAPACITY_LIMITS` 默认调整为 **`token: 8 / agent: 16 / connection: 32 / global: 48`**。<br>**轻元数据工具（闭合 G1）**：`lucy_read_source` 保留在 `UPSTREAM_SEMANTIC_TOOLS`（不破坏 Strat-B DRAIN 排空语义），但从重查询容量池拆出、接入独立的**元数据并发池**（默认 **`token: 16 / global: 64`**，环境变量 `LUCY_MCP_META_TOKEN_MAX_INFLIGHT`／`LUCY_MCP_META_GLOBAL_MAX_INFLIGHT` 可配），不裸奔绕过容量层。<br>**超限载荷**：增加 `retryable: true`、`retryAfterMs` 与结构化 `next_step: { action: "reduce_concurrency_and_retry", max_inflight }`（仍保持结构化可识别）<br>(b) 仅放宽到 8，轻工具仍与重查询共享 8 路槽且不补结构化重试指引 | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D3** | 慢数仓 `busyMs` 与上游超时对齐 | (a) 单窗 `QUESTION_BUDGET_MAX_BUSY_MS` 默认 **300s → 900s**（环境变量可配）；`LUCY_PROXY_UPSTREAM_TIMEOUT_MS`（socket 空闲超时）默认 **30s → 90s**；`LUCY_PROXY_UPSTREAM_HARD_DEADLINE_MS` 默认 **90s → 120s**（与 `QUESTION_BUDGET_ABS_EXEC_MS = 120s` 对齐）<br>(b) 维持 300s／30s，仅在客户现场手动配环境变量 | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D4** | 失败／超时调用的 `busyMs` 记账口径 | (a) **失败封顶记账**：上游超时、断连或未返回事实数据的错误调用，结算计入 `busyMs` 时单次封顶 `QUESTION_BUDGET_FAILED_CALL_CAP_MS`（默认 **30_000ms**），原始耗时仍如实记入 `budgetSettlement` 审计字段；成功调用仍全额结算<br>(b) 失败调用完全不计 `busyMs`（易被故意发慢错查询绕过忙时）<br>(c) 维持全额计入 | **(a)** | **已裁定（采纳 a，2026-11-27）**；**精确 outcome／持续失败边界见 OQ-4（2026-11-27 重裁闭合）** |
| **D5** | 取消未确认的名额冻结时长 | (a) `LUCY_MCP_CANCEL_HOLD_MS` 默认 **30s → 5s**（可配置，设 0 为不保留），避免 Claude Code 按 `Esc` 中断慢查询后立刻重问时槽位锁死 30 秒<br>(b) 维持 30s | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D6** | `begin active` 续查档数 | (a) `begin active` 下 `maxContinuations` 默认 **1 → 3**（环境变量 `QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_ACTIVE` 可配）；`begin inactive` 保持 **5 档** ＋ 硬停 `mode=new_question`<br>(b) 维持 `active = 1` | **(a)** | **已裁定（采纳 a，2026-11-27）** |
| **D7** | `initialize` 停机与并发引导文案 | (a) 修订 `webui/config/data-qa-instructions.md` 与 `mcp-proxy.ts` 的 **interactive 动态／降级指引**：① 移除首句易诱发提前放弃的 `"stop looping"`，改为优先指导模型在 `continuable=true` 或 `mode=new_question` 时静默完成逃生并重试继续分析，仅在 `hard_budget_stop` 或陷入无效循环时停机交付部分结果；② 明确写入单作用域并发上限与 `question_budget_concurrency_exceeded` 缩并发重试规则。**不修改 integration 静态极简指引**，后者以 REQ-0119 OQ-7／SC-11／13 为事实源<br>(b) 保持现有文案不变 | **(a)** | **已裁定（采纳 a，2026-11-27）；r3 仅把 r1 已授权的 interactive 边界回填到本行，不改裁定** |
| **D8** | 兼容与回退开关 | (a) 所有新默认值均可由环境变量覆盖；旧环境变量（`LUCY_QUESTION_BUDGET=off`、`WALL_MODE`、`SCOPE`、`BYPASS`）语义不变；协议原因码不变<br>(b) 仅改常量不加环境变量 | **(a)** | **已裁定（采纳 a，2026-11-27）** |

### §5.1 资源上界披露（修订前后对照）

| 维度 | 现行默认值 | 拟修订默认值（D1–D6） | 说明 |
|---|---|---|---|
| 主预算单窗次数（重查询） | 60 次（含轻重全部工具） | **60 次**（仅重查询） | 防止元数据探索挤占查数额度 |
| 轻工具独立计数与并发池（G1） | 与重查询共享 60 次／`token 4` 槽 | **200 次／窗**（`inactive` 6 窗上界约 **1200 次**）；独立元数据并发池 **`token 16 / global 64`** | 避免批量 `lucy_read_source` 撞查询并发锁，同时保持上游压力有界不裸奔 |
| 主预算单窗忙时 `busyMs` | 300s（硬编码） | **900s**（环境变量可配） | 适配 `hive-jd` 单次 15–45s 慢查询的多轮下钻 |
| 失败／超时调用单次 `busyMs` 封顶 | 120s（全额） | **30s**（原始耗时仍全量审计） | 防止上游抖动／超时重试迅速打空窗口 |
| 单作用域并发上限 `MAX_INFLIGHT` | 4（含轻重全部工具） | **8**（仅重查询） | 匹配 Claude Code 并行工具调用习惯 |
| 重查询容量舱壁默认档位 | `token 4 / agent 8 / conn 16 / global 24` | **`token 8 / agent 16 / conn 32 / global 48`** | 支撑多名分析师同时共用 `hive-jd` |
| 上游空闲超时／硬时限（含 G3 权衡） | 30s / 90s | **90s / 120s** | 避免 SelectDB 扫 Hive 外表首字节未回即断连；**权衡**：MySQL 等快源上真正挂起的异常查询将多等 60s 才报超时（二期 OQ-1 按连接配置可消除） |
| 取消未确认名额冻结 | 30s | **5s** | 避免 Esc 中断后立刻改问撞并发锁 |
| `begin active`／`inactive` 续查档数 | 1 档 / 5 档 | **3 档 / 5 档** | 减少长会话连续追问意外硬停 |
| 单窗口重查询 Lucy 等待上界 | `300 + 4×120 = 780s` | **`900 + 8×120 = 1860s`** | 有界可证明；运维可通过环境变量收紧 |

---

## 6. 核心流程（伪代码）

```text
# ── 1. 工具分层（D1）──────────────────────────────────────────
QUERY_TIER_TOOLS    = {"lucy_query", "lucy_certified_route", "lucy_report_template"}
METADATA_TIER_TOOLS = {"lucy_read_source", "lucy_freshness", "lucy_explain_query", "wiki_search", "wiki_read"}

function classifyBudgetTier(toolName):
  if toolName in QUERY_TIER_TOOLS:    return "query"
  if toolName in METADATA_TIER_TOOLS: return "metadata"
  return "none"                        # catalog / skill / begin / continue 不占预算

# ── 2. 准入判定（D1 / D2 / D3 / D6）──────────────────────────────
function consumePersisted(scopeKey, toolName, now, options):
  tier = classifyBudgetTier(toolName)
  if tier == "none": return ALLOW(noTicket)

  return withScopeSerialization(scopeKey, async () => {
    state = loadState(scopeKey)
    if state.processUnavailable: return UNAVAILABLE("question_budget_unavailable")

    # 轻工具分支：不占 query inflight，不计 busyMs，仅受独立高阈值防死循环约束
    if tier == "metadata":
      if state.metaCalls >= MAX_META_CALLS_PER_WINDOW:   # 默认 200
        return STOP(reason="question_budget_exhausted", tier="metadata",
                    continuable=canEscape(state, options), nextStep=...)
      candidate = clone(state)
      candidate.metaCalls += 1
      commit(scopeKey, candidate, "admit-meta:" + requestId)
      return ALLOW(noQueryTicket)

    # 重查询分支：并发上限先于次数／忙时判定
    if state.inflight >= MAX_INFLIGHT:                   # 默认 8（环境变量可配）
      return REJECT_CONCURRENCY(
        reason       = "question_budget_concurrency_exceeded",
        retryable    = true,
        retryAfterMs = 1000,
        next_step    = { action: "reduce_concurrency_and_retry", max_inflight: MAX_INFLIGHT }
      )

    # 续查／重开兑现（沿用 P1-74 两段式；active 最大续查档数改为默认 3，inactive 保持 5）
    maxCont = state.continuationPolicy == "active"
      ? ACTIVE_MAX_CONTINUATIONS                         # 默认 3（D6）
      : INACTIVE_MAX_CONTINUATIONS                       # 默认 5
    maybeApplyPendingReopenOrContinuation(state, maxCont)  # 换窗同步清零 calls / busyMs / metaCalls

    if state.calls >= MAX_CALLS or state.busyMs >= MAX_BUSY_MS:  # 60 / 900_000ms
      return buildStopEnvelope(state, options)

    ticket = admitQuery(scopeKey, state)                 # calls += 1, inflight += 1
    return ALLOW(ticket)
  })

# ── 3. 结算（D4 + OQ-4：窄失败封顶）──────────────────────────
# failedKind ∈ { timed_out, upstream_disconnect, tool_is_error } → 可封顶
# failedKind = no_data（合法空结果）→ 不走失败封顶
function settle(ticket, endMonoMs, outcomeFlags):
  withScopeSerialization(ticket.scopeKey, async () => {
    rawDelta = min(ABS_EXEC_MS, max(0, endMonoMs - ticket.startMonoMs))
    capEligible = outcomeFlags.failedKind in ("timed_out", "upstream_disconnect", "tool_is_error")
    billedDelta = capEligible
      ? min(rawDelta, FAILED_CALL_BUSY_CAP_MS)           # 默认 30_000ms（D4）
      : rawDelta
    recordBudgetSettlementAudit({
      rawDeltaMs: rawDelta,
      billedBusyMs: billedDelta,
      failedKind: outcomeFlags.failedKind,              # OQ-4：机读可诊断
      ...outcomeFlags
    })
    addBusyMsToTicketWindow(ticket, billedDelta)
    decrementInflight(ticket.scopeKey)
    commit(ticket.scopeKey, candidate, "settle:" + ticket.requestId)
  })

# ── 4. 容量舱壁分池与上游超时／取消冻结（D2 / D3 / D5）────────────
# 重查询（lucy_query 等）→ McpExecutionCapacity 主池：token 8 / agent 16 / conn 32 / global 48
# 轻元数据上游工具（lucy_read_source）→ 仍留在 UPSTREAM_SEMANTIC_TOOLS 参与 Strat-B DRAIN，
#   但接入独立元数据并发池：token 16 / global 64（不占用重查询 token/conn 槽，也不裸奔）
# UPSTREAM_TIMEOUT_MS        = env("LUCY_PROXY_UPSTREAM_TIMEOUT_MS", 90_000)
# UPSTREAM_HARD_DEADLINE_MS  = env("LUCY_PROXY_UPSTREAM_HARD_DEADLINE_MS", 120_000)
# CANCEL_UNCONFIRMED_HOLD_MS = env("LUCY_MCP_CANCEL_HOLD_MS", 5_000)
```

**不变式**

1. 换窗（`mode=continue`、`mode=new_question` 或 `lucy_begin_question`）在清零 `calls` 与 `busyMs` 时同步清零 `metaCalls`，避免轻工具计数跨窗粘连。
2. `lucy_read_source` 保留在 `UPSTREAM_SEMANTIC_TOOLS` 中以维持 Strat-B DRAIN 排空不变式，但在容量舱壁层路由至独立的元数据并发池（默认 `token: 16 / global: 64`），既不阻塞也不被阻塞于重查询并发槽，且上游并发压力仍有界可控（闭合 G1）。**跨 Spec 不变式（r1）**：元数据池不免除 REQ-0119 workload 判定——`workloadClass=integration` 的轻工具调用同样计入 `integrationActive`（borrowMax 前置闸对全部工具类的 integration 调用生效，元数据池不构成绕过路径）。
3. 失败封顶只改变计入 `busyMs` 的增量，**不得**掩盖真实 `durationMs` 与 `rawDeltaMs` 审计记录；settlement 必须机读写出 `failedKind`（OQ-4）。合法空结果（`no_data`）**不得**冒充失败封顶。
4. `UPSTREAM_HARD_DEADLINE_MS` 不得超过 `QUESTION_BUDGET_ABS_EXEC_MS`（默认同为 120s），保证容量舱壁与预算记账边界一致。
5. **OQ-4**：不另设「连续失败 N 次」硬停 reason；单窗持续失败仅由 `calls≤60`／`busyMs≤900s` 截停，停机语义仍为 `question_budget_exhausted`。跨窗失败有界沿用既有续查／`mode=new_question` 总档（D6／P1-74），失败类不另开跨窗配额。
6. **OQ-6＝A**：单窗 `metaCalls=200` 硬顶保留（D1）；换窗仍清零窗内 `metaCalls`；跨窗 runaway 总界＝与重查询**共用**既有续查／`mode=new_question` 总档（D6／P1-74）。**不**另设 `metaCallsLifetime`、**不**另设轻工具速率护栏、**不**新增独立停机 reason——档尽硬停语义与查数路径一致（`question_budget_exhausted`／既有硬停再开）。

---

## 7. 验收标准

| 编号 | 初态 | 输入 | 模式 | 观测时点 | 验收 |
|---|---|---|---|---|---|
| SC-01 | 全新作用域 | 单窗连续发起 61 次 `lucy_query`（忙时未超） | settled | 第 61 次准入时 | 返回 `question_budget_exhausted`（防火墙仍生效），`outcome=budget_stop` |
| SC-02 | 全新作用域 | 轻工具（`lucy_read_source`／`wiki_search`）连续调用 201 次 | settled | 第 201 次准入时 | 独立轻工具防死循环上限生效，返回 `question_budget_exhausted`；前 200 次均放行且 `calls=0`、`busyMs=0` |
| SC-02b | 同 SC-02 轻工具夹具（OQ-6＝A） | 单窗触顶 200 后 `continue`／`new_question` 换窗清零并再刷；循环直至续查总档尽 | settled | 跨窗循环与档尽硬停时 | 敌对臂：换窗可恢复窗内 200 额度，但总档尽后硬停（与查数共用档，无 `metaCallsLifetime`／速率 reason）；正臂：合法换窗后继续 `lucy_read_source` 成交 |
| SC-03 | 全新作用域 | 同时并发提交 8 次 `lucy_read_source` ＋ 8 次 `lucy_query`；另测单 Token 并发 17 次 `lucy_read_source` | settled | 准入与响应时 | 8 次 `lucy_read_source` 与 8 次 `lucy_query` 全部互不干扰放行；第 9 次并发 `lucy_query` 返回 `question_budget_concurrency_exceeded`，含 `retryable: true`、`retryAfterMs` 与 `next_step.max_inflight=8` 且不扣 `calls`/`busyMs`；第 17 次并发 `lucy_read_source` 被独立元数据并发池（`token: 16`）拒绝并返回同等可执行重试信号。**跨 Spec 必做回归**：REQ-0119 SC-03／UAT-IMC 对多 integration Agent 的轻元数据调用验证合计计入 `integrationActive` 并在 `borrowMax` 触顶，作为本条元数据池不绕过 workload 的组合证据 |
| SC-04 | 已有 8 路在途 `lucy_query` | 再发起第 9 路被拒后，待部分请求完成、客户端缩并发重发 | settled | 重试完成时 | 合法重试成功出数（主路径双覆盖：既验拦住，也验缩并发成交） |
| SC-05 | 模拟慢源（单次查询 45 秒首字节） | 发起 `lucy_query` | settled | 上游响应时 | 不会在 30 秒被 `UPSTREAM_TIMEOUT_MS` 掐断，45 秒正常返回事实数据并结算 `busyMs=45000` |
| SC-06 | 模拟慢源（单次 60 秒） | 连续成功执行 14 次 `lucy_query`（累计 840s < 900s），再执行第 15、16 次 | settled | 第 16 次准入时 | 前 15 次（累计达 900s）全放行；第 16 次触发 `question_budget_exhausted`；经 `lucy_continue_question` 换窗后第 16 次重试成交 |
| SC-07 | 模拟上游超时／失败（每次耗时 90s 超时失败） | 连续 4 次超时失败后发起第 5 次正常查询 | settled | 第 5 次准入与审计时 | 每次失败计入 `busyMs` 封顶 30s（4 次合计 120s < 900s），第 5 次正常查询放行成交；审计 `budgetSettlement` 同时记录 `failedKind=timed_out`、`rawDeltaMs≈90000` 与 `billedBusyMs=30000`。对照臂：合法空结果须标 `failedKind=no_data`（或不走失败封顶路径），不得按 30s 封顶 |
| SC-07b | 同 SC-07 超时夹具（OQ-4 敌对臂） | 单窗持续超时失败直至触顶；换窗后继续失败直至续查档尽 | settled | 单窗触顶与跨窗硬停时 | 单窗最终以 `question_budget_exhausted` 停机（靠 `calls`／`busyMs` 上界，**无**独立连败 N reason）；跨窗仍受 D6／P1-74 续查总档约束后硬停；全程结算可区分 `failedKind` 与 raw／billed |
| SC-08 | 8 路慢查询在途 | 客户端主动断开模拟 `Esc` 中断，等待 5.5 秒后发起新 `lucy_query` | settled | 新查询准入时 | 不再锁死 30 秒；5s 冻结期满后新查询正常准入成交 |
| SC-09 | 容量舱壁默认配置 | 4 个不同 Token 同时各自并发 8 路访问同一连接（如 `hive-jd`，合计 32 路） | settled | 准入与重试完成时 | 32 路全部放行（不撞旧 `connection: 16` 上限）；第 33 路按 `connection` 维度拒绝，并与 D2 已裁信封一致地返回 `retryable:true`、`retryAfterMs`、`next_step.action=reduce_concurrency_and_retry` 与可执行 `max_inflight`；待槽位释放后缩并发重试成交且匹配 oracle。若实现需要改变 D2 已裁 reason／字段语义，必须升 OQ 重裁 |
| SC-10 | `begin active` 实况 | 连续耗尽 3 档续查 | settled | 第 1–3 次续查与第 4 次触顶时 | 前 3 次 `lucy_continue_question` 均成功换窗并成交；第 4 次续查前硬停，`next_step` 指向 `lucy_begin_question`，预算终止不计入四类失败维度 |
| SC-11 | 环境变量覆盖旧值（闭合 G2） | 同时设置 `QUESTION_BUDGET_MAX_INFLIGHT=4`、`QUESTION_BUDGET_MAX_BUSY_MS=300000`、`QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_ACTIVE=1`、`LUCY_QUERY_MAX_INFLIGHT=4`、`LUCY_MCP_AGENT_MAX_INFLIGHT=8`、`LUCY_MCP_CONNECTION_MAX_INFLIGHT=16`、`LUCY_MCP_GLOBAL_MAX_INFLIGHT=24`、`LUCY_MCP_CANCEL_HOLD_MS=30000`、`LUCY_PROXY_UPSTREAM_TIMEOUT_MS=30000`、`LUCY_PROXY_UPSTREAM_HARD_DEADLINE_MS=90000` | settled | 准入、容量快照与超时时 | `resolveCapacityLimits()` 精确回到 `4/8/16/24`，预算并发／忙时／active 续查／超时／取消冻结全部行为精确回退至修订前口径 |
| SC-12 | 真实纯 MCP Agent（Claude Code）＋ 慢查询夹具 | 分两臂触发预算触顶与并发超限：A＝begin 可见／`continuable=true`；B＝begin 不可见／续查档耗尽后 `mode=new_question` | settled | 最终答复与轨迹 | A 臂静默调 `lucy_continue_question` 后继续成交；B 臂按结构化 `next_step` 以同一 `continueToken`＋`mode=new_question` 重开预算后继续成交；两臂均自动缩并发重试、完成全部子问题、不因 `"stop looping"` 提前放弃，结果与 oracle 一致。integration 静态极简指引不参与本条 D7 文案验收 |

---

## 8. 交互合同

本条不触及 WebUI 用户可见面（无新路由、无页面或导航变更）。  
**豁免**：[`lucy-20261107-ui-interaction-contract-gate-spec.md`](lucy-20261107-ui-interaction-contract-gate-spec.md) — 非 WebUI；验证走纯 MCP、进程内自动化与真实 Claude Code UAT，不强制浏览器测试。

---

## 9. 落盘清单自检

| # | 项 | 本条状态 |
|---|---|---|
| 1 | 路径／文件名 | `docs/specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md`（合规） |
| 2 | 伪代码 | §6（已含） |
| 3 | 元数据与阶段码 | 头部表含「文档类型 / 版本」「阶段: S2」「状态」 |
| 5 | Terminology Compliance | §3（已含） |
| 7 | 索引登记 | 已随 v0.2-draft 提交同批登记进 `docs/README.md`（lint index 规则要求文件被跟踪即登记，故先于确权执行）；终稿确权后同批更新索引行状态 |
| 11 | 闭口层级 | 头部下方（层级＝功能合同，含五要素） |
| 13 | 交互合同 | §8 显式豁免（非 WebUI） |
| 14 | 常青需求池入账 | 已入账 **REQ-0122**（P0，2026-11-27，随 v1.0 定稿同批登记 [`docs/backlog/README.md`](../backlog/README.md) 与 `entries/REQ-0122-question-budget-analyst-workflow-ux.md`；入池 ≠ 开发授权） |
| 15 | 测试台 | [`UAT-SUITE-BUDGET-ANALYST-UX`](../qa/uat/suites/budget-analyst-ux/suite.md) **v1.1**（§10.3 六项已同步；NOT RUN；含 SC-02b／07b／12 双臂；勾连 IMC-03 混合臂；BESC-07／10A 回归臂） |
| 16 | 主路径可用性优先 | §1、§7（SC-03/04/06/07/08/12 双覆盖约束与成交） |
| 17 | 受影响画像 | §4（4 画像逐行判定＋子面复合判定＋P3 负向补偿路径） |

---

## 10. 开工前置门禁与开放问题

### 10.1 开发开工前置门禁（原 OQ-2 升级，闭合 G4）

- **PRE-01（Claude Code `mcp-session-id` 实测抓包）**：**已闭合（2026-11-27）**。证据见 [`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)。三种真实 Claude Code 模式（单窗口／多终端并行／Subagent）均未出现请求侧 literal `-`，post-init 的 `tools/list`／`tools/call` 均携带稳定 UUID；多终端为**两个不同** session（未合并进一桶）。**OQ-5 未触发**。客户端披露（不改 D2）：Subagent 复用父会话 `mcp-session-id`（同预算并发桶）——属同会话协作语义，不是多窗口 `-` 退化。正式 UAT R0 只引用本证据；§10.3 已同步（v1.0-r7）。

### 10.2 开放问题

| ID | 问题 | 默认假设（待拍板） |
|---|---|---|
| OQ-1 | 是否需要支持**按连接维度**单独覆盖 `UPSTREAM_TIMEOUT_MS`／`MAX_BUSY_MS`（例如仅为 `hive-jd` 配 120s／900s，MySQL 保持 30s／300s）？ | 本期先通过全局默认放宽＋全局环境变量快速止血（接受 G3 中快源挂起多等 60s 的权衡）；若现场存在异构库强隔离诉求，在二期引入 per-connection 配置 |
| OQ-3 | `lucy_explain_query` 归轻工具还是重工具？ | **已闭合（随 D1(a) 裁定，2026-11-27）**：`lucy_explain_query` 不执行上游数仓查询（仅编译＋门禁诊断），归入轻工具集合；若未来出现编译耗时过长，可纳入独立元数据并发池约束 |
| OQ-4 | D4 失败封顶允许哪些精确 outcome；“未返回事实数据”如何机读判定；持续失败是否必须在单窗由 calls／busy 上界最终截停，续查总档数如何保持有界？ | **已闭合（委托人 2026-11-27 重裁）**：（1）**窄封顶**——仅 `failedKind ∈ {timed_out, upstream_disconnect, tool_is_error}` 可走 30s 封顶；合法空结果标 `no_data`，**不**走失败封顶；（2）settlement 机读写出 `failedKind`＋`rawDeltaMs`＋`billedBusyMs`；（3）持续失败＝**方案 A**：单窗只靠 `calls≤60`／`busyMs≤900s` 截停，**不**另加连败 N 硬停；（4）跨窗有界＝沿用既有续查／`new_question` 总档，失败不另开跨窗配额。验收：SC-07／SC-07b；UAT **BA-07／BA-07b**（v1.1 已同步） |
| OQ-5 | PRE-01 若发现无 session 桶 `-`，是否需要改变作用域键／桶隔离／D2 并发语义？ | **已关闭（未触发，2026-11-27）**：PRE-01 三模式均无 `-` 桶退化；多终端独立 session。仅回填客户端披露（Subagent 复用父 session），**不**改变作用域键／D2 |
| OQ-6 | 轻工具 `metaCalls=200/窗` 在 `continue`／`mode=new_question` 清零后，runaway 是否可无限跨窗重置；跨窗总界应采用续查总档数、作用域生命周期还是速率护栏？ | **已闭合（委托人 2026-11-27 重裁＝方案 A）**：跨窗总界与重查询共用既有续查／`mode=new_question` 总档；单窗 `metaCalls=200` 硬顶保留；不另设 `metaCallsLifetime`／速率护栏／独立停机 reason。验收：SC-02／SC-02b；UAT **BA-02／BA-02b**（v1.1 已同步） |

### 10.3 测试台同步门禁（R2）

**已同步（2026-11-27）** → [`UAT-SUITE-BUDGET-ANALYST-UX` v1.1](../qa/uat/suites/budget-analyst-ux/suite.md)（取代 v1.0 旧映射；v1.0 **不得**再执行或判 PASS）。勾连 [`UAT-IMC-03`](../qa/uat/suites/integration-mcp-capacity/cases.md) 轻／重混合臂（integration-mcp-capacity v1.0-r4）。

| # | 门禁项 | 落位 |
|---|---|---|
| 1 | OQ-4／BA-07 | `UAT-BA-07`＋`UAT-BA-07b` |
| 2 | IMC-03 轻／重混合 | `UAT-IMC-03` 扩写＋本套件勾连 |
| 3 | BA-09 全信封＋释放成交 | `UAT-BA-09` |
| 4 | BA-12 begin 双臂 | `UAT-BA-12A`／`UAT-BA-12B` |
| 5 | PRE-01 移出执行链 | `UAT-BA-R0` 只引用 [`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md) |
| 6 | OQ-6／SC-02b | `UAT-BA-02b` |

测试台仍 **NOT RUN**（实现未落地）。本节关闭 ≠ 开发授权 ≠ UAT PASS。

---

## 11. 变更纪要

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1-draft | 2026-11-26 | 首稿草案：针对 Claude Code ＋ Lucy MCP ＋ 慢分析型外部目录（`hive-jd`）场景，提出 D1–D8 修订方案、资源上界对照、核心流程伪代码与 SC-01–SC-12 验收标准；待委托人裁定与需求池入账 |
| v0.2-draft | 2026-11-26 | 闭合首轮审阅缺口 G1–G4 与行号校对：① D2／§5.1／不变式 2／SC-03 明确轻工具接入独立元数据并发池（`token 16 / global 64`）并保留 `UPSTREAM_SEMANTIC_TOOLS` 不破 Strat-B 排空，补齐轻工具资源上界（G1）；② SC-11 补全四档容量及硬超时／active 续查回退环境变量（G2）；③ §4 P1 行与 §5.1 显式披露快源挂起多等 60s 权衡（G3）；④ OQ-2 升级为开工前置门禁 PRE-01（G4）；⑤ 修正 `question-experience.ts:13`／`:63–70` 与 `mcp-execution-capacity.ts:19` 三处行号 |
| v0.2-draft（补订） | 2026-11-26 | 复核 N1 修订：§4 P2 行依据改为不含字面 WebUI 源码目录路径的等价表述，消除 lint:spec-docs 交互合同门禁误触发（本条不触达 WebUI 用户可见面，§8 豁免口径不变）；§9 第 7 项随本次 git 提交更新为已登记 `docs/README.md`；版本与状态不变 |
| v1.0 | 2026-11-27 | 定稿确权：委托人裁定 **D1–D8 全案采纳推荐案 (a)** 并明示确权终稿；§5 决策表 8 项状态改为「已裁定」，OQ-3 随 D1(a) 闭合（OQ-1 留二期）；入账常青需求池 REQ-0122（P0）；§9 第 14／15 项更新；新建测试台 `UAT-SUITE-BUDGET-ANALYST-UX`（v1.0，NOT RUN）。阶段 S1→S2；**开发授权未获得**，PRE-01 抓包仍为开工前置门禁 |
| v1.0-r1 | 2026-11-27 | 跨 Spec 冲突消解（委托人授权，对照 [REQ-0119](lucy-20261127-integration-mcp-capacity-backpressure-spec.md)，两 Spec 同日 v1.0 终稿互不引用）：① 明确本条 D2 四层默认（8/16/32/48）为两 Spec 共同基线——REQ-0119 OQ-global 冻结解除（C1 案 A），其 borrowMax 与 global×0.5 解耦（初始 12）、Task 0／T1–T5 于本条落地后基线校准；② §6 不变式 2 增补：轻工具元数据独立并发池仍受 REQ-0119 workload 门覆盖（integration 全部调用计入 integrationActive）；③ D7 文案修订范围显式限定 interactive 身份（integration 静态极简指引归 REQ-0119 OQ-7／SC-11，不随本条更新）。决策 D1–D8 不变，验收 SC-01–SC-12 不变。开发授权未获得，PRE-01 仍为开工前置门禁 |
| v1.0-r2 | 2026-11-27 | Codex CLI 三轮对抗过程评审 R1 修订：不改变 D1–D8；补强 SC-03 跨 Spec workload 回归、SC-09 全信封＋释放后成交、SC-12 begin 可见／不可见双臂；PRE-01 前移为 Plan 前门禁；D4 持续失败 runaway 边界升 OQ-4 待委托人重裁，PRE-01 触发语义变化时升 OQ-5。开发未授权；NOT RUN；≠ 功能合同收口／UAT PASS／可上线 |
| v1.0-r3 | 2026-11-27 | Codex CLI 对抗 R2 修订：D7 本行回填 interactive／integration 边界；轻工具跨窗重置风险升 OQ-6；登记测试台同步门禁，明确当前 UAT v1.0 旧映射不可执行／不可判 PASS；修正阶段自检 S1→S2。不改变 D1–D8；开发未授权 |
| v1.0-r4 | 2026-11-27 | 委托人重裁 **OQ-4 闭合**：窄 `failedKind` 封顶；`no_data` 不封顶；单窗靠 calls／busy 截停（无连败 N）；跨窗沿用既有续查档；补 SC-07b／伪代码／不变式 5。**OQ-6 仍待裁**；PRE-01 未执行；开发未授权；UAT 仍不可执行／不可 PASS |
| v1.0-r5 | 2026-11-27 | 委托人重裁 **OQ-6＝A 闭合**：轻工具跨窗总界＝共用既有续查／`new_question` 档；单窗 200 保留；无终身／速率护栏；补 SC-02b／不变式 6。OQ-4／OQ-6 均闭合；**下一阻塞＝PRE-01**；开发未授权；UAT 仍不可执行／不可 PASS |
| v1.0-r6 | 2026-11-27 | **PRE-01 闭合**：真实 Claude Code 三模式抓包（[证据](../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)）；无 `-` 桶退化；多终端独立 session；Subagent 复用父 session（客户端披露，不改 D2）。**OQ-5 未触发已关闭**。下一阻塞＝§10.3 UAT 升版；开发未授权 |
| v1.0-r7 | 2026-11-27 | **§10.3 UAT 设计六项同步**：`UAT-SUITE-BUDGET-ANALYST-UX` → v1.1（BA-02b／07／07b／09／12A／12B；R0 只引 PRE-01）；IMC-03 轻／重混合臂（v1.0-r4）。测试台仍 NOT RUN。**下一阻塞＝开发授权／Plan**；≠ UAT PASS／功能合同收口／可上线 |
| v1.0-r8 | 2026-11-27 | **开发授权已获得**（委托人明示「授权开发」）；阶段 S2→S3；配对 Plan；开始改运行代码。≠ 功能合同收口／UAT PASS／可上线 |
