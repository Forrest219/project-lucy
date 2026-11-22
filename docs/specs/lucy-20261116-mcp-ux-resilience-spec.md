# MCP 握手、失败信息、会话恢复与快速失败（体验韧性）Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP 握手、失败信息、会话恢复与快速失败（体验韧性）Spec |
| 文档类型 / 版本 | Spec / **v1.0** |
| 日期 / 目标版本 | 2026-11-16／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-37**／REQ-030-058／**P1**（体验修复＋观测指标＋UAT）。**不入 0.30 核心分母** |
| 阶段 | S4 |
| 状态 | **S4｜终稿确权（委托人 2026-11-17 授权代理修正后定稿，免 Codex 终审）；v1.0；已获开发授权（委托人 2026-11-17「授权开发落地」）；部分落地：U1（描述索引按文件指纹缓存；宽目录沙箱复现长尾后修复，**偏离 Spec 的 instructions 缓存设计**）、U2、U3a、U4（拒绝与门闩路径跳过逐 Agent 权限编译）已实现；U3b 按委托人决定不实现（MCPX-09／10＝BLOCKED）；M1–M6 取数脚本与宽目录沙箱夹具已交付并通过 MCPX-12 核对；vitest 回归无新增失败，本机 demo 已平滑升级；测试台 `UAT-SUITE-MCP-UX-RESILIENCE`＝**PASS WITH GAP**（2026-11-17 宽目录沙箱 Tier-A 跑次 `docs/qa/uat/suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md`；MCPX-09／10 BLOCKED，其余缺口见跑次，不是整套 PASS）。≠ UAT PASS；≠ 可上线** |
| 决策来源 | 委托人 2026-11-16 夜：要求「通过历史日期识别 Lucy 在用户体验侧的短板，定向优化，并设置观测指标或 UAT 模拟测试用例」；经澄清选定：本轮交付＝文档＋指标＋UAT 套件；纳入短板＝**U1 握手长尾、U2 拒绝与失败信息可操作、U3 会话恢复与重试限流、U4 拒绝快速返回**；U5 预算终止、U6 口径防呆、U7 能力缺口、U8 语义层契约前置检查为后续候选，不入本轮；委托人批准设计后授权对抗性审阅（过程评审，记录见 [评审记录](../reviews/2026-11-16-p1-36-p1-37-adversarial-review.md)） |
| 需求来源 | 客户全量调用流水分析（2026-11-09 18:54–11-16 18:50，23,687 条；客户材料**未入仓**，见 §1 证据等级） |
| 撰写日期 / 撰写人 / 委托人 | 2026-11-16／Claude（Cursor Agent）／xingchen |
| 基于材料 | 上述流水；`webui/server/proxy/{mcp-proxy,admission,upstream-session,authorization-barrier,acl,source-ambiguity-gate,audit-classification}.ts` 现状摸底（符号与复核行号见 §3） |
| 适用范围 | MCP Proxy（`:7879`／demo `:57881`）的握手、拒绝与失败响应、上游会话恢复、拒绝耗时；以及对应观测指标与 UAT；不改任何运行代码 |
| 实施主体 | WebUI 服务端 `webui/server/proxy/`；测试 `webui/server/__tests__/` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **不重复** [P1-35](lucy-20261116-source-ambiguity-mcp-escape-spec.md)（门闩钉选放行与拒绝载荷，U2 只引用）；**伴生** [P1-36](lucy-20261116-trace-span-ledger-spec.md)（阶段记录；**理由码登记在 P1-36 §5.4**；授权相互独立，P1-36 未授权时 U1／U4 的取证用等价最小计时，见 §6）；指标告警接线挂 [P0-7](lucy-20261107-stored-user-experience-dashboard-alerts-spec.md)（冻结，**本条不解冻**）；`/api/livez`、事件循环门槛沿用 P1-21 |
| 实施计划 | [`docs/plans/lucy-20261116-mcp-ux-resilience-plan.md`](../plans/lucy-20261116-mcp-ux-resilience-plan.md) |
| 测试台 | [`UAT-SUITE-MCP-UX-RESILIENCE`](../qa/uat/suites/mcp-ux-resilience/suite.md)（INDEX：NOT RUN） |
| 输出位置 | `docs/specs/lucy-20261116-mcp-ux-resilience-spec.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 2026-11-17 **终稿确权（委托人授权代理修正后定稿，免 Codex 终审；≠ 开发授权）**：O1–O7 全部闭合；**O7 定稿决策：U3 拆为 U3a（会话恢复，入出口）与 U3b（持续失效短路，设计冻结、不入出口、不随本条实现），SC-09／SC-10 与 UAT-MCPX-09／10 降为伴生**，M5 去掉连续失败上限；O6（KTX 失效响应形态）转 Plan 步骤 0 开工前置。R3 修订**未经第 4 轮复审**，为已知缺口。|
| v0.4-draft | 2026-11-17 对抗性审阅 R3（终轮；GPT 5.6 子代理，**非 Codex CLI**；9 条，逐项状态见评审记录）修订：客户端 `initialize` 与内部恢复握手拆成两套状态机（pending reset，notification 被接受后才清零）；open 期 `initialize` 受频率上限（T=5 s，60 s 总上游调用 ≤ 44）；撤权保密（响应发送前重验 generation，不发旧代内容）；skills 失效＝写入事件＋文件级后台复核（≤ 30 s）；伪代码统一 `guard_key`；全局 LRU 需 ≥ 17 身份；`rejection_fingerprint` 改 HMAC；拒绝清单＝真实 `tools/list` 集合；任一健康上游响应清零（间歇不累计）、短路不刷新窗口并自动半开。|
| v0.3-draft | 2026-11-17 对抗性审阅 R2（GPT 5.6 子代理，**非 Codex CLI**；14 条）修订：`initialize` 永不被短路；恢复失败的显式定义与计数；短路 guard 键冻结；握手成功含 `notifications/initialized` 被上游接受；缓存摘要改为预先维护、命中读盘为 0；M3 改用专用 `rejection_fingerprint`；重复被拒容量验证与规范化函数；工具清单真值来源；Plan／Suite 目标与总账 §P1-37 同步；夹具就绪门禁。O7 仍待委托人决策（终稿确权前置） |
| v0.2-draft | 2026-11-17 对抗性审阅 R1（GPT 5.6 子代理，**非 Codex CLI**；20 条）修订：instructions 缓存键加入有效权限摘要＋容量／失效合同；短路改为「第 N 次恢复失败完成后、第 N+1 个请求起」并定义上游调用上界 4N；本地 fallback 的 `initialize` 不清零计数；未知工具清单限定为当前身份的 `allowedToolNames`；缺 `measures` 前移限定为「只复制 KTX 已有拒绝条件」；重复被拒状态加键／TTL／容量／失效合同；出口拆分（SC-03 伴生、M7／M8／M9 移出出口）；承诺收窄为「上游会话失效与门控拒绝」；SC-12 去掉 P1-35 整套回归；会话失效夹具改为「真实重启 KTX＋持续失效待 O7」；§3 改符号锚点；§1 增证据等级；理由码改引 P1-36 §5.4 |
| v0.1-draft | 2026-11-16 初稿：U1–U4 目标、取证优先、候选修复、指标字典 M1–M9、UAT 映射、开放项 O1–O6；挂测试台 `UAT-SUITE-MCP-UX-RESILIENCE` |

## 闭口层级

- 层级：功能合同
- 本条承诺：MCP 客户端（含纯 MCP、定时任务）在**握手、被拒（门控）与上游会话失效**时，得到**有界延迟与可操作的下一步**，且合法请求不因本条约束而不可用。
- 本条出口：SC-01、SC-02、SC-04–SC-08、SC-11–SC-13（vitest 契约测试＋测试台 `UAT-SUITE-MCP-UX-RESILIENCE` 必做）。**SC-03 为伴生项，不入本条出口**（依赖 P1-36 授权）。**SC-09／SC-10（U3b 持续失效短路）为后续子项，不入本条出口**（O7 定稿决策，见 U3b）。
- 不在本条出口：普通上游连接拒绝／超时／5xx／畸形 JSON-RPC 的统一失败体验（后续候选，未立项）；整库旅程与 Agent 全路径演练；客户现场复测；告警接线（P0-7 冻结）；U5–U8；P1-35 整套逃生套件的回归（归发布取证与持续节奏，不作本条出口）；M7（客户主路径成功率）、M8（trace 质量，属 P1-36）、M9（事件环采样，随 U1 取证交付）的验收；根因取证结论之外的猜测性优化。
- 上线关系：本条收口不表示可上线；**功能合同收口 ≠ UAT PASS ≠ 可上线**。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: **会话丢失**（MCP 上游会话已失效；客户端可见错误码 `session_lost`，禁用「掉线」「断开」混称）。MCP 客户端可见的错误文案（未知工具、缺 `measures`、会话丢失、重复被拒）进入实现前须按术语标准复核，禁止出现内部工具名 `sl_query`。

## 交互合同豁免

- 原因：本条只改 MCP 协议侧响应、服务端缓存与计时，不改变用户可见 WebUI 表面（WebUI 页面、组件、按钮与布局）。
- 不改变：WebUI 路由与组件；既有 `decision_reason`、`error_category` 取值（新增 `session_lost`／`session_shortcircuit` 理由码已登记在 [P1-36 §5.4](lucy-20261116-trace-span-ledger-spec.md)，不得在本 Spec 另立词表）。

## 1. 背景与证据（客户全量流水）

**证据等级**：下表数字来自对客户全量调用流水的分析；客户导出与分析报告在**仓外**（`/Users/zhangxingchen/Projects/Inbox@Projects/20261116-2305-lucy客户日志审计可观测体验评估.md`），仓库内无脱敏证据包、查询或哈希，因此 F1–F8 **全部标「不可核（仓外材料）」**。它们是需求线索，**不作为阈值或验收依据**；本条验收只用 demo 基线（Plan 步骤 1）。

| # | 事实（不可核） | 数字 |
|---|---|---|
| F1 | `initialize` 日中位数：11-09～11-13 为 10–11 ms；11-14 246 ms；11-15 1.66 s；11-16 1.61 s（P90 55 s） | 11-16 有 149 次超过 30 s，最长 403 s |
| F2 | 握手停顿成簇，与负载无关：12 个停顿窗口中 5 个起点与 `policy_version` 变更在 1 分钟内重合，其余 7 个无变更记录 | 例：11-16 13:00 时段仅 4 次调用，initialize 中位 155 s |
| F3 | 门闩拒绝耗时 P50 1.7 s、P95 57 s、P99 192 s、最大 303 s | 446 次门闩拒绝（`lucy_query` 405、`lucy_explain_query` 41） |
| F4 | 拒绝后原样重提：177 次入参完全相同；34 个会话各被拒 ≥ 3 次；单会话最多 33 次 | 门闩拒绝共 405 次（`lucy_query`） |
| F5 | Agent 猜不存在的工具名（`lucy_bind_source`、`lucy_confirm_source`、`lucy_select_source`…），0.4 s 内连发 4 次，被记为 `tool_unclassified` | 8 次 |
| F6 | 入参错误由上游透传：`MCP error -32602 … Invalid arguments for tool sl_query`（`measures` 缺失 35、至少 1 项 28），暴露内部工具名 | 约 76 次入参校验类错误 |
| F7 | 会话丢失：`test-fc` 11-13 16:28–16:54 对 `wiki_search` 发出 557 次，全部 `404 Unknown MCP session`；平台只有 40 次 `upstream_session_recovered`（tools/list 33、read_source 4、wiki_search 2、entity_details 1） | 约 22 次／分钟，无退避 |
| F8 | 主路径成功率：疑似业务侧账号 `lucy_query` 门闩前 92.0%（928／1,009）、后 68.1%（442／649） | 门闩首次出现 11-13 22:05:17 |

以上数字**不等于仓库当前代码的行为**：仓库已将 `invalid_arguments` 映射到 `client_schema_failure`，客户流水却为 0，客户运行版本待确认（O4）。

## 2. 非目标

- 不重写门闩判定与钉选放行（P1-35）。
- 不解冻 P0-7；指标只定义口径与阈值，告警接线另议。
- 不做 U5–U8；不改预算阈值（P1-12 现值保持）。
- 不改 KTX 源码（AGENTS 约束）；所有适配在 Lucy 代理层、配置与文档。
- 不假定根因：**先量后改**，修复须附取证（§6）。
- 不新增任何会让合法请求被拒的条件（U2 的入参前移只复制 KTX 已有的拒绝条件，见 U2）。

## 3. 现状锚点（摸底，复核于 2026-11-17）

> 以符号名为准；`mcp-proxy.ts` 在工作区含未提交改动，行号会漂移，括号内为 2026-11-17 复核值，仅作定位提示。

| 项 | 位置 |
|---|---|
| `initialize` 链 | `mcp-proxy.ts`：上游握手（约 `6803–6808`）；`writeInitializeResponse`→`buildRoleAwareInstructions`（约 `1910–1999`；注入响应约 `6985–7007`）；**按具体 identity** 调用 `lucyCatalog`、`loadAllSkillsFresh`＋`filterAccessibleSkills`、`allowedToolNames`（`acl.ts` 约 `2619–2652`，依赖该身份的有效权限与 capabilities）；KTX 不可达时**本地返回 initialize 200**，审计 outcome 记为 `ok`（约 `6831–6854`） |
| 握手无阶段计时 | 仅总 `duration_ms`；代理为裸 `http.createServer`，无事件环采样；WebUI 有 `/api/health` 的 `eventLoopDelaySnapshot()`（`index.ts` 约 `918–932`），`/api/livez` 只返回 `{ok:true}` |
| 会话与恢复 | `upstream-session.ts`：键 `(agentId,tokenHash,sessionId)`，24 h TTL，进程内；无 `Mcp-Session-Id` 头的客户端共享默认会话；`forwardToKtxWithSession`：**仅**匹配 KTX 400 `initialize request is required`，清会话→重握手→重试 **1 次**；`ping` 走流式透传不恢复（测试 `mcp-proxy-upstream-session.test.ts` 约 `669–705` 钉住该行为）；`wiki_search` 上游抛错时走本地检索，该分支无恢复审计；无同会话重复失败限流 |
| 策略收窄清会话 | `authorization-barrier.ts`：策略提交后调用 `clearUpstreamSessionsMatching`（约 `214–242`）；`acl.ts` 策略 commit 经 barrier 触发；`upstream-session.ts` `clearUpstreamSessionsMatching`（约 `134–148`） |
| 门控真实顺序 | `handlePost`：**入参校验 `validateLucyToolArgs`（约 `1589` 定义，`4250–4297` 调用）先于 ACL（约 `4790–4852`）**→口径→P0-3 门闩；门闩拒绝前有 `resolveProjectRoot`＋`listSources` 磁盘与目录工作（约 `4999–5031`） |
| 未知工具（现状误分类） | `acl.ts` `tool_unclassified:*`（约 `145–161`）。**因入参校验先于 ACL，未登记但以 `lucy_` 开头的工具名在未带 `connectionId` 时先得到 `invalid_arguments`，而不是 `tool_unclassified`**；`DENIAL_REPAIR_TOOLS`（约 `4674–4738`）只控制权限拒绝时的数据来源修复载荷，**不是**工具清单 |
| 内部名与脱敏 | 上游错误体可含 `sl_query`；`security/redaction.ts`（约 `20–43`）无 hdfs／内网地址规则 |
| 既有指标资产 | `access_log.duration_ms／decision_reason`、`is_slow_call`、`admin/daily-question-kpi.ts`、`/api/livez` p99 门槛 400 ms（P1-21） |

## 4. 四项短板

### U1 握手长尾

- **目标（建议值，O1）**：稳态 `initialize` P50 ≤ 200 ms、P99 ≤ 2 s、0 次 > 30 s；策略重载期间 P99 ≤ 5 s。
- **假设（待取证）**：①每次握手同步执行 `loadAllSkillsFresh`（读盘）与角色化 instructions 构造；②策略变更触发会话清空与冷路径；③进程事件循环被其他工作占住（与 P1-21／P1-32 同一类风险）。
- **取证（第 0 步）**：握手加 `skills_load`／`instructions_build`／`catalog_resolve`／`upstream_handshake` 阶段记录（P1-36），或在 P1-36 未授权时加等价最小计时；:7879 代理进程加事件环延迟采样（采样入口随本步交付）。
- **候选修复（须有取证支撑才选）**：缓存 instructions；不在握手路径读盘；策略重载后异步预热；策略收窄只清受影响会话而非整体。
- **instructions 缓存合同（若选此修复）**：
  - **键**＝（身份的**有效权限摘要**〔`allowedToolNames`＋可见 catalog 范围＋skills 允许集的哈希，同角色但 Agent overlay／legacy allow／capability 不同的身份摘要不同〕，`policy_version`，skills 内容哈希）。**不得**只用角色集合。
  - **容量**：LRU，上限与 TTL 在 Plan 里冻结（建议 ≤ 256 项、TTL ≤ 5 min）；只存已构造文本，不存凭据。
  - **失效**：`policy_version` 变化时整体换代（generation），旧代条目一律不再命中；策略 commit 返回**之后**开始的握手必须读到新内容。**撤权保密边界**：commit 完成之后**发出**的任何握手响应都不得含旧代内容（旧 instructions 含已撤回 Source／Skill 的可见信息）——握手在**响应发送前**重验 generation，与构建开始时不同则丢弃已构建内容、按新代重建（至多 1 次；仍变化则返回可重试错误），**收窄与放宽同样处理**（不区分，避免漏判）；commit 前已发出的响应不受约束；旧内容**不得**写回新代。
  - **摘要来源（避免命中前仍做重活）**：有效权限摘要与 skills 内容哈希由**预先维护**的 generation／摘要提供——策略提交、catalog 发布、skills 变更时原子更新并异步预热；握手路径**只读已提交摘要与缓存**，不得为算缓存键而重新 `lucyCatalog`／`loadAllSkillsFresh`／`allowedToolNames`。skills 变更失效 = **写入事件 generation**（经 admin／loader 的写入与显式 reload 路径递增）**＋后台周期复核**（每 ≤ 30 s 一次，按**文件级** mtime＋size＋内容摘要，不在握手路径执行；目录 mtime 对原地改写无效，不得作为兜底）。**最大陈旧窗口＝一个复核周期（≤ 30 s，Plan 冻结并写入）**，只覆盖绕过写入事件的外部直接改文件；经事件路径的变更立即换代。**缓存命中时 catalog／skills 读取次数必须为 0**（SC-01／SC-02 以只读计数断言）。
- **验收**：SC-01、SC-02（SC-03 伴生，不入出口）。

### U2 拒绝与失败信息可操作

- **门闩载荷**：沿用 P1-35，不重复。
- **未知工具名**：未登记工具名一律走 `tool_unclassified:*` 专用分支，**该分支先于入参校验**（修正 §3 的现状误分类）；拒绝响应带**当前身份可见的工具清单**与「请勿猜测工具名」提示。清单＝**同一身份、同一策略版本下真实 `tools/list` 返回的工具名集合**（`allowedToolNames` 只是其上界，**不要求相等**：策略允许但上游当前未提供的工具不在清单内），**不得**出现 absolute-deny、未授权控制面或其他身份的工具；另配 absolute-deny／未授权控制面负样本断言；不得复用 `DENIAL_REPAIR_TOOLS` 的数据来源载荷（SC-04）。
- **入参校验前移**：代理侧补校验，使客户观察到的**特定非法形状**在转发前以 `client_schema_failure` 返回，文案用 **Lucy 工具名**并带示例，**不出现 `sl_query`**（SC-05）。**原则：只复制 KTX 已经必然拒绝的条件，不新增拒绝条件**。哪些形状必然被拒（如缺 `measures` 且无其他可成形的查询要素）由取证第 0 步用 KTX 真实调用确认；合同允许的非空 query 形状（dimensions／filters／segments／order_by／sourceName／`query` 等）必须仍放行，UAT 配合法形状对照。
- **重复被拒**：同会话相同入参在 60 s 内被拒后再次提交，响应附「请勿原样重试」与下一步（SC-06）；指标 M3。状态合同：
  - **键**＝（身份，下游会话作用域，工具名，`rejection_fingerprint`，拒绝理由，`policy_version`）；**只存摘要**，不存原文。
  - **`rejection_fingerprint`**：拒绝行新增的 additive 审计字段，形如 `rf1:<HMAC-SHA256(服务端密钥, canonical 入参) 前 16 位>`——**必须带服务端密钥的 HMAC，不得用无密钥哈希**（过滤值、实体名等低熵数据可被离线字典反推；现有 `args_summary` 刻意去值，新列不得重新提供等价探针）。密钥存于服务端密钥存储、**不入审计库与导出**；轮换时版本前缀递增（`rf2:`…），**M3 只在同一版本前缀内比较**，跨版本不匹配（接受该窗口内的低估，写进跑次）。对 `canonicalizeLucyQueryArgs`（`lucy-query-normalization.ts`）**处理之后**的入参取哈希——对象键排序、`orderBy`／`order_by` 等兼容别名归一、`filters` 字符串形态还原、数组保持语义顺序；非 `lucy_query` 工具用同一套 canonical JSON。**不得**用 `args_summary`／`query_hash` 判定「相同入参」（前者只保留前 8 个键且去值、超长省略，后者只覆盖查询文本）。M3 与 `repeated()` 都只用该字段。该列与 P1-36 迁移互不依赖，若 P1-36 先落地则并入同一次迁移。
  - **TTL** 60 s；LRU 上限（固定：进程内 ≤ 1024 项、单身份 ≤ 64 项；Plan 可调但须写进跑次）；`policy_version` 变化即失效，**策略变化后不得再提示「请勿重试」**。
  - 无会话头的客户端共享默认会话，键中含身份，**不得**跨身份泄露「曾被拒」信息；同一身份内共享是已知行为，在提示文案里只说「相同请求刚被拒绝」，不透露他人细节。
- **会话丢失**：返回结构化 `session_lost`＋「请重新 initialize」提示（见 U3）。
- **验收**：SC-04、SC-05、SC-06。

### U3 会话恢复与重试限流

本条出口只含 **U3a（会话恢复）**；U3b（持续失效短路）见下，不入出口。

- **取证**：对 KTX 真实重启后取 404／400 `Unknown MCP session` 的响应体与头（O6）；客户 404 不在现有恢复匹配里。
- **恢复范围**：把恢复匹配扩到取证确认的 404 形态；覆盖 `ping` 与 `wiki_search` 本地回退分支（后者须有恢复审计）。仍保持**每次请求至多 1 次**恢复握手＋重试。
- **恢复失败的定义（显式结果类型 `RecoveryResult`，不依赖异常路径，任何异常都必须落成结果）**：下列任一即「一次恢复失败」——恢复用 `initialize` 请求抛错／超时／状态 ≥ 400；响应无 session id 或不是 JSON-RPC 形；`notifications/initialized` 抛错、超时或非 2xx；重试后仍为会话类错误或抛错。**每个原请求最多记 1 次**。
- **握手成功的定义（两套状态机，不得混用）**：
  - **内部恢复握手**（代理一次请求内顺序完成两步）：`initialize` 2xx 且带合法 session id 且为 JSON-RPC 形，**并且** `notifications/initialized` 被上游以 2xx 接受；任一步失败都**不得**缓存新会话、**不得**清零计数（现状 `handshakeUpstreamSession` 不检查 notification 结果，属实现变更项）。
  - **客户端主动 `initialize`**：`initialize` 响应先返回，`notifications/initialized` 是客户端随后独立发来的请求，因此此处只**登记待确认清零**（pending reset，键＝guard 键＋新会话作用域，TTL 60 s）；当该会话的 `notifications/initialized` 被上游以 2xx 接受时才按**旧 guard 键**清零。缺失、被拒或超时的 notification 不清零；无 notification 的客户端不会永久受困——失败计数 60 s 无新失败即自然过期（见下「窗口与半开」）。
#### U3b 持续失效短路与限流（**后续子项：设计已冻结，不入本条出口，不随本条实现**）

> 定稿决策（O7，2026-11-17）：持续会话失效（恢复握手本身也失败）在 demo 里无法全真构造，而 U3b 是本条唯一**新增限制**。为不让「新约束无法被真实验证」，U3b 整体移出本条出口：本条只交付 U3a（恢复范围扩展，真实重启 KTX 即可验）；U3b 的启动条件＝O7 夹具闭合（（a）取证后复现真实成因，或（b）委托人书面授权 demo 故障注入入口）**并**另获开发授权。以下规则作为已冻结的设计保留，届时直接使用。

- **计数语义（固定）**：会话失败计数只在**恢复本身失败**时 +1；**任一健康的上游响应**（含恢复成功，以及无需恢复的正常 2xx）即 `record_success`，计数清零——所谓「连续」是指中间没有任何健康响应（间歇故障下失败→成功→失败不累计）。计数窗口 60 s、阈值 N=5（O5）。**第 N 次恢复失败完成后，同会话的第 N+1 个请求起**本地短路：返回 `session_lost`＋重连提示，不再请求上游；短路请求**仍入账**（理由码 `session_shortcircuit`，阶段 `session_guard`，登记见 P1-36 §5.4），不得静默丢弃。**窗口与半开**：短路请求**不刷新**窗口；自最后一次恢复失败起 60 s 无新失败，状态自然关闭，下一个请求重新探测上游（自动恢复，不依赖客户端动作）。
- **上游调用上界（计数口径：上游 HTTP 请求数，原请求、`initialize`、`notifications/initialized`、重试各算 1）**：**普通请求**每个未短路的失败至多 4 次，故障窗口内同会话 ≤ **4N（N=5 时 20 次）**；**`initialize` 另设独立频率上限**：guard open 期间，同 guard 键每 **T=5 s 至多 1 次**真实上游 `initialize` 尝试（含其 notification 共 ≤ 2 个上游请求），超限的 `initialize` 本地返回「上游暂不可用，≥ 5 s 后重试」（理由码 `session_shortcircuit`）；guard 未 open 时 `initialize` 不受此限。因此一个 60 s 窗口内 open 状态下的上游调用总上界＝**4N ＋ 2·⌈60/T⌉＝20＋24＝44**（N、T 见 O5）。
- **guard 键**：（`agentId`，`tokenHash`，下游会话作用域），下游会话作用域＝客户端 `Mcp-Session-Id`，无该头的客户端＝固定值 `default`；**与上游 session id 无关**（恢复时轮换上游 session id 不重置计数）。窗口条目闲置 > 60 s 即清除，条目数受上限约束（与重复被拒状态同一 LRU 策略，进程内 ≤ 1024）。同 Agent 不同 Token、同 Token 不同显式会话互不影响；无头默认会话在同 Token 内共享，属已知行为。
- **`initialize` 不被计数短路但受频率上限**：open 期间 `initialize` 仍会（按 T 间隔）尝试真实上游握手——它是逃生本身；失败不清零、不额外计数；仅「握手成功」（见上，客户端路径＝notification 确认后）才清零。
- **解除短路（逃生）**：握手成功（真实上游握手成功，客户端路径含 notification 确认）或 60 s 无新失败的自然过期才解除。KTX 不可达时代理本地返回的 initialize 降级响应**不得清零**，且在审计里可区分（P1-36 `local_handler(initialize_fallback)`）；故障期间客户端得到的提示是「上游暂不可用，稍后重试」而非「重新 initialize 即可」，避免提示一条走不通的逃生。
- **验收**：U3a＝SC-07、SC-08（入本条出口）；U3b＝SC-09、SC-10（**不入出口**，夹具待 O7；`UAT-MCPX-09／10` 为伴生用例，夹具未闭合时记 BLOCKED 但**不阻塞本条收口**）。

### U4 拒绝快速返回

- **目标（建议值，O1）**：稳态下拒绝类请求 P95 ≤ 500 ms、P99 ≤ 2 s（含大目录夹具）。
- **假设（待取证）**：门闩拒绝前 `resolveProjectRoot`＋`listSources` 的磁盘与目录工作；与 U1 共享的事件循环阻塞。
- **候选修复**：复用已有目录缓存；廉价检查前置；拒绝路径不做可延后的重工作。
- **验收**：SC-11（同时断言钉选后的**合法查询仍放行**，主路径不退化）。

## 核心流程（伪代码）

```text
# A. 会话恢复与短路（U3）——对 tools/call、tools/list、initialize、ping、wiki 本地回退统一适用
forward_with_recovery(req, session):
  gk = guard_key(req)                              # (agentId, tokenHash, downstream scope)，进入时固定；不用易变的上游 session，恢复轮换上游 session id 不影响
  if guard.is_open(gk):
      if req.method != "initialize" or not guard.initialize_slot_available(gk, T = 5s):   # initialize 不被计数短路，但 open 期间每 T 至多 1 次上游尝试
          audit(reason = "session_shortcircuit", stage = "session_guard")                 # 短路请求不刷新窗口
          return error(code = "session_lost", hint = hint_for(upstream_reachable?))      # 不打上游

  resp = upstream(req, session)                    # 上游调用 #1
  if is_session_error(resp):                       # 400 initialize-required，或取证确认的 404 形态
      session = handshake_again(session)           # 上游调用 #2（initialize）＋ #3（notifications/initialized），至多 1 次
      resp = upstream(req, session)                # 上游调用 #4（重试），至多 1 次
      if ok(resp):
          guard.reset(gk)                          # 恢复成功＝健康，清零
          audit(reason = "upstream_session_recovered", stage = "session_recover")
      else:
          guard.record_failure(gk)                 # 仅恢复失败才 +1
          audit(reason = "session_lost", stage = "session_recover")
          return error(code = "session_lost", hint = hint_for(upstream_reachable?))
  if is_healthy(resp): guard.reset(gk)             # 任一健康上游响应清零（间歇故障不累计）
  return resp

# 客户端主动 initialize：响应先返回，清零待 notification 确认
on_client_initialize(req, upstream_result):
  if upstream_result.initialize_ok and upstream_result.valid_session_id:
      guard.register_pending_reset(guard_key(req), new_scope = upstream_result.session, ttl = 60s)
  else:                                               # 本地降级响应：不清零，审计标 initialize_fallback
      audit(local_handler = "initialize_fallback")

on_client_notification_initialized(req, upstream_status):
  if upstream_status is 2xx and guard.has_pending_reset(req.session): guard.reset(guard_key_of_pending)   # 缺失／被拒／超时则不清零

# B. 拒绝路径顺序（U2／U4）——只调整「何时算、算什么」，不改裁决结果；不新增拒绝条件
handle(req):
  if unknown_tool(req.tool): return deny_with_tool_list(req, tools_list_names(identity))   # 先于入参校验；清单＝该身份真实 tools/list 名称集合
  if known_invalid_shape(req):   return client_schema_failure(req, lucy_name, example)    # 仅复制 KTX 必然拒绝的形状
  decision = acl(req)                                                                      # 既有
  if decision.denied:        return deny(decision)
  decision = source_gate(req, use_cached_catalog = true)                                   # SC-11：不做可避免的磁盘工作
  if decision.denied:
      key = (identity, downstream_session, tool, args_digest, decision.reason, policy_version)
      if repeated(key, within = 60s): decision.hint += "相同请求刚被拒绝，请勿原样重试；" + decision.next_step   # SC-06
      remember(key)                                                                        # 摘要、TTL、LRU、policy_version 失效
      return deny(decision)
  ...                                                                                      # 后续不变

# C. 握手（U1）——取证先行，修复择一
initialize(req):
  spans: upstream_handshake, catalog_resolve, skills_load, instructions_build   # 取证
  key = (effective_permission_digest(identity), policy_version, skills_hash)
  instructions = cache.get(key, generation) or build_and_cache(key, generation)
  on_policy_reload(): generation += 1; async prewarm(cache); clear_only_affected_sessions()
```

## 5. 观测指标字典

> 口径来自调用流水与（P1-36 之后）阶段记录。**本条只定义口径、阈值与取数入口；告警接线挂 P0-7（冻结），本条不解冻。** 阈值为建议值，待 O1 闭合。**M1–M6 入本条出口（SC-13）；M7–M9 为发布后／伴生观测，不入出口。**

| ID | 指标 | 口径 | 目标 | 来源 | 出口 |
|---|---|---|---|---|---|
| M1 | 握手延迟 | `initialize` 的 P50／P99 与 > 30 s 次数；按日与按 15 分钟窗 | P50 ≤ 200 ms；P99 ≤ 2 s；> 30 s 为 0 | `access_log.duration_ms`；阶段记录（伴生） | 是 |
| M2 | 拒绝延迟 | 有 `decision_reason` 且 `outcome` 为拒绝的请求 P95／P99 | P95 ≤ 500 ms；P99 ≤ 2 s | `access_log` | 是 |
| M3 | 拒绝后原样重试率 | 同身份、同会话、相同 `rejection_fingerprint`，在被拒后 60 s 内再次提交的次数 ÷ 被拒总数 | 先观测，基线待采；趋势下降 | `access_log.rejection_fingerprint`（新增，U2） | 是 |
| M4 | 未知工具名日次数 | `decision_reason` 以 `tool_unclassified:` 开头的日条数 | 趋近 0 | `access_log` | 是 |
| M5 | 会话类失败 | 会话类失败率；恢复成功率；同会话最大连续失败数 | 先观测（连续失败上限属 U3b，不入出口） | `access_log`；`session_recover`／`session_guard` | 是 |
| M6 | 入参错误占比 | `error_category=client_schema_failure` ÷ 总调用 | 趋势下降；不再有被记为 `upstream_failed` 的入参错误 | `access_log` | 是 |
| M7 | 主路径成功率 | 非测试账号的 `lucy_query` 成功率（账号分类口径见 O3） | 不低于门闩前客户基线 92%（客户基线，非 demo 阈值） | `access_log` | **否**：发布后观测，无本地分母 |
| M8 | trace 质量 | `trace_id` 覆盖率；`unknown` 占比；span 完整性；导出对账 | 100%／趋近 0／0／0 | P1-36 对账 | **否**：属 P1-36 |
| M9 | 事件环延迟 | :7879 代理进程事件环延迟 P99（采样） | 与 `/api/livez` p99 ≤ 400 ms 对齐 | 新增采样 | **否**：采样入口随 U1 取证交付，门槛作为 SC-01 取证附件 |

## 6. 与 P1-36 的依赖与取证闸门

- U1／U4 的根因取证优先使用 P1-36 的阶段记录；**P1-36 未授权时**，用同口径的最小计时（落点与字段由 Plan 步骤 0 提出，**须先入本 Spec 变更**，不得旁路落地）。
- **根因闸门**：每个候选修复在 Plan 中必须附一条取证（阶段耗时分布或事件环采样），证明它命中根因；无证据的修复不进实现。
- U2／U3 不依赖 P1-36 即可实现。新增理由码（`session_lost`、`session_shortcircuit`）已登记在 **P1-36 §5.4**；若 P1-36 迟迟不授权，本条按该登记表使用现有 `decision_reason` 写入路径，不另立词表。

## 7. 成功标准

| ID | 标准 | 验证 |
|---|---|---|
| SC-01 | 稳态 `initialize`：N=200 顺序＋20 并发，P50 ≤ 200 ms、P99 ≤ 2 s、0 次 > 30 s；若采用缓存修复，命中时 catalog／skills 读取次数为 0 | `UAT-MCPX-01` |
| SC-02 | 策略重载（3 次 `policy_version` 变更）期间并发 20 握手，P99 ≤ 5 s，0 次 > 30 s；**同角色集合但有效权限不同的两个身份握手得到不同 instructions；commit 完成之后发出的任何握手响应都不得含旧代内容（含构建开始于 commit 前的握手：发送前重验 generation，不同则重建；撤回的 Source／Skill 名称不得出现）；旧构建不得写入新代；skills 文件原地改写、删除、ACL 收窄三类变更在换代／复核周期内必被新握手读到** | `UAT-MCPX-02` |
| SC-03（伴生，**不入出口**） | 握手各阶段耗时可从阶段记录读出，占比可归因到具体阶段 | `UAT-MCPX-03`（依赖 P1-36；落地前不得标 PASS） |
| SC-04 | 调用不存在的工具名（**无入参**与**带合法数据面入参**两种）：均进入 `tool_unclassified:*`；响应含**当前身份可见**的工具清单与「请勿猜测」提示；两个权限不同的身份得到不同清单，清单＝同一身份真实 `tools/list` 的名称集合（不要求等于 `allowedToolNames`，但必为其子集），且无 absolute-deny／未授权控制面 | `UAT-MCPX-04` |
| SC-05 | `lucy_query` 取证确认必然被拒的非法形状（缺 `measures` 等）：代理侧返回 `client_schema_failure`，文案含示例、不含 `sl_query`，审计 `error_category=client_schema_failure`；**合同允许的合法形状仍放行（对照组）** | `UAT-MCPX-05` |
| SC-06 | 同身份、同会话 60 s 内原样重提被拒调用：响应含「请勿原样重试」与下一步；M3 可计算；**`rejection_fingerprint` 对键序、别名、`filters` 形态变化稳定，对语义不同的请求不碰撞，且审计列不等于公开的 SHA-256(canonical 入参)（HMAC 带密钥）；策略变化后不再提示；不同身份不互相提示；TTL、单身份 64、全局 1024 的 LRU 淘汰次序分别真实生效（全局需 ≥ 17 个测试身份）** | `UAT-MCPX-06` |
| SC-07 | 上游会话失效后，`lucy_query`／`wiki_search`／`lucy_read_source`／`ping` **每个工具、每种失效形态都在各自独立失效的新会话上**无感恢复；审计有 `session_recover`；分别断言原请求、握手、重试次数 | `UAT-MCPX-08` |
| SC-08 | 恢复仍受限：每次请求至多 1 次恢复握手＋1 次重试（上游调用 ≤ 4） | `UAT-MCPX-08` |
| SC-09（U3b，**不入出口**） | 恢复失败的四类（恢复 `initialize` 失败、无合法 session id、`notifications/initialized` 失败、重试仍失效）各自都计一次；同会话第 N 次恢复失败完成后、第 N+1 个请求起短路；**失败→正常成功→失败的交替序列不累计到 N**；短路请求不刷新窗口、60 s 无新失败后自动半开；故障窗口内普通请求上游调用 ≤ 4N，且**短路期间连续 `initialize` 洪泛**时上游 `initialize` 尝试 ≤ 每 5 s 1 次（60 s 总上游调用 ≤ 44）；轮换上游 session id 后计数不重置；每个短路请求仍有调用流水行（`session_shortcircuit`）；guard 键隔离（同 Agent 双 Token、同 Token 双显式会话、无头默认会话） | `UAT-MCPX-09`（夹具待 O7） |
| SC-10（U3b，**不入出口**） | 处于短路 open 状态时 `initialize` 按频率上限**仍会访问上游**（间隔 ≥ 5 s 后必有一次真实尝试）；**客户端 initialize→`notifications/initialized` 被上游接受→工具调用成功**才清零并恢复正常；缺失、被拒的 notification、上游不可达时本地降级的 initialize 都**不清零**（但 60 s 无新失败仍自然半开） | `UAT-MCPX-10`（夹具待 O7） |
| SC-11 | 稳态拒绝类请求 P95 ≤ 500 ms、P99 ≤ 2 s（含大目录夹具，目录规模下限见 fixtures）；**同一部署实况下钉选唯一来源的合法查询成交** | `UAT-MCPX-07` |
| SC-12 | 主路径回归：单表、多表 join、纯 MCP 的合法分析师查询全部成交；钉选后合法成交的最小对照通过。（P1-35 整套回归归发布取证，不入本条出口） | `UAT-MCPX-11` |
| SC-13 | 指标 M1–M6 能从调用流水以文档化口径取数，结果与**本套件自产行的已知值**一致（发送多少条、被拒多少条、未知工具多少条等均由测试台发送清单给出）；M3 只按 `rejection_fingerprint` 取数，并含键序变化与碰撞反例 | `UAT-MCPX-12`（必做） |

## 8. 主路径可用性自检（DEVELOPMENT 四问）

| # | 问 | 答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是，且更好：本条出口**不新增任何拒绝或限制**（U2 入参前移只复制 KTX 已有拒绝；会话短路 U3b 已移出出口，启动前须另获授权并补齐夹具）。U3b 若日后启用，其唯一新增限制是「同会话连续 N 次**恢复失败**后短路」，只作用于已失效且恢复不成的会话。新增风险如实登记：缓存可能读到陈旧权限（缓存键含有效权限摘要＋换代失效，SC-02）；重复被拒状态占内存（TTL＋LRU）。 |
| 2 | 若增加拒绝／门禁，逃生是否同一部署实况可执行且必做？ | 本条出口无新增门禁，不需要逃生。U3b 若启用，其逃生＝客户端重新 `initialize`（open 期每 5 s 至多 1 次真实上游尝试），**握手成功（客户端路径含 notification 确认）才解除，另有 60 s 无新失败的自然半开**（SC-10，必做）；上游不可达期间提示的是「稍后重试」而非无法执行的逃生；该路径不依赖宿主 person。 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是：本条出口内 SC-11（拒绝快速且合法查询成交）、SC-12（主路径回归）、SC-05（合法形状对照）、SC-07／08（恢复后合法请求成交）成对出现；U3b 的 SC-09（短路触发）与 SC-10（重连恢复）成对设计，随 U3b 启动。 |
| 4 | 是否避免把宿主／凭据缺席记成 BLOCKED 掩盖不可用？ | 是：必做用例只用 demo 内置账号；会话失效用真实重启 KTX 构造。做不到全真的持续失效夹具**如实 BLOCKED（O7）**并因此把 U3b 移出出口，不用 mock 冒充，也不靠「BLOCKED 但仍算收口」。 |

## 9. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| （U3b 启用时）短路阈值过严，误伤正常重连 | 计数只在恢复失败时 +1、健康响应清零、窗口有界自动半开；SC-10 随 U3b 必做 |
| 缓存 instructions 导致权限／策略变更后读到旧内容（安全） | 键含有效权限摘要＋`policy_version`＋skills 哈希；换代失效；`UAT-MCPX-02` 含负向断言 |
| 工具清单越权枚举 | 清单＝当前身份真实 `tools/list` 名称集合（`allowedToolNames` 为上界）；`UAT-MCPX-04` 双身份差分 |
| 重复被拒提示成为侧信道 | 键含身份与会话；只存摘要；TTL＋LRU；不跨身份 |
| 根因与假设不符 | 取证闸门：无证据不改；候选修复可被取证推翻 |
| KTX 404 形态与假设不符 | O6 先取证；不改 KTX 源码 |

| ID | 开放问题 | 建议 |
|---|---|---|
| O1 | 各阈值（M1／M2、SC-01／02／11）是否采纳建议值 | **已闭合（定稿决策）**：采纳；稳态指 demo 无人工负载 |
| O2 | 同 P1-36 O2：新增审计理由码的写入失败语义 | **已闭合**：沿用 `access_log` 既有语义 |
| O3 | M7「非测试账号」分类口径 | **已闭合**：M7 已移出出口；发布后若观测，需业务方账号清单，落夹具不写进代码常量 |
| O4 | 客户运行版本与镜像（P1-35 是否已在客户侧；`client_schema_failure` 为 0 的原因） | **已闭合（不阻塞定稿与开发）**：按 AGENTS「Docker 对齐」，功能以 demo／仓库代码为准；客户侧版本核对归发布取证 |
| O5 | 会话短路阈值 N、窗口与 open 期 `initialize` 间隔 T | **已闭合（仅 U3b 使用）**：5 次恢复失败／60 s／T＝5 s |
| O6 | KTX 会话失效后 400／404 的真实响应体与头；是否可由代理稳定识别 | **转开工前置**：Plan 步骤 0 在 demo 真实重启 KTX 取证再实现；不阻塞定稿，阻塞 U3a 实现 |
| O7 | **持续会话失效夹具**：重启 KTX 只能造一次失效，恢复后不再失效；SC-09／SC-10 需要「恢复握手本身也失败」 | **已闭合（定稿决策，委托人授权代理定稿；可撤销）**：取（c）——**U3b（SC-09／SC-10）整体移出本条出口，不随本条实现**；启动条件＝（a）O6 取证后在 demo 真实复现成因，或（b）委托人另行书面授权 demo 故障注入入口，并另获开发授权。`UAT-MCPX-09／10` 降为伴生用例，夹具未闭合记 BLOCKED，**不阻塞本条收口**，亦不得用 mock 冒充 |
