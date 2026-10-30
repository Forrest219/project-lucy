# Spec 189 — 用量统计真实性与跨页面口径统一

| 元数据 | 内容 |
|---|---|
| 文档名称 | 用量统计真实性与跨页面口径统一 Spec |
| 版本 | v1.1（吸收交叉审阅复核裁决） |
| 日期 | 2026-10-27 |
| 状态 | **已实施（WO-202610-28 T1～T6 已完成）；未验收**。浏览器与 Docker 验证未执行。§10 的全量数字是历史声称，不是当前 HEAD 的验收证据 |
| 优先级 | P0（统计真实性） |
| 委托人 | Forrest |
| 适用范围 | `/admin/usage`、`/admin/agents`、`/admin/agents/:userId`、`/admin/tokens`、`/admin/audit`、`/ops/calls`、`/admin/access-map`、`/eval/monitor`、共用 Agent 对象详情抽屉，以及 §5.3 列明的审计派生 API |
| 关联 Spec | 64、128、171、143、155、161、162、165、172、173、187 |
| 实施计划 | `webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md` |
| 审阅记录 | `webui/docs/plans/review-spec189-wo-202610-28.md`；首轮审阅（v1.0）的阻断结论已在本版吸收，并按复核证据修正技能内容读取、评测现场和治理门禁口径；v1.1 复审结论为 **PASS**，附 4 条计划侧修订，已落入 WO-202610-28 |

> **交叉引用（2026-10-30）**：本文的三层分类、恒等式和「近 N 活跃 Agent」保持不变。每天的真实问询数由 [`docs/specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md`](../../docs/specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md) 定义，单位是已落库的原文问询，不是业务调用量。该指标已在源码中另计，不改本文数字。
>
> **名册呈现（2026-10-30）**：`/admin/agents` 的卡片和列由 [`docs/specs/lucy-20261030-agent-roster-spec.md`](../../docs/specs/lucy-20261030-agent-roster-spec.md) 规定。本文 §6 里该页的用量口径不变：活跃 Agent、业务调用量和最近业务使用仍只认默认用量业务调用。名册不再渲染协议请求卡、使用过的凭据和主表上的最近 MCP 访问。该呈现已按名册 Spec v1.2 落地；本文的用量口径不变。

---

## Terminology Compliance

本功能遵循 `webui/docs/00-product-terminology-standard.md`。`webui/src/lib/kpiContracts.ts` 是 KPI 标签与帮助文案的注册点，必须与本文同步；`webui/src/__tests__/kpi-contracts.test.ts` 必须守卫新定义及 Spec 128 的 D2／D4 锚点，不能只改文档或页面副本。

### 既有术语修订

| Canonical Term | UI 主术语 | 本 Spec 口径 |
|---|---|---|
| Business Call Volume | 近 N 业务调用量 | 默认用量指标：排除全部协议事件及符合 Spec 162 条件的评测探针；包含真实业务工具或受权限保护内容读取的成功、错误与拒绝尝试 |
| Protocol Request Volume | 近 N 协议请求量 | 全部握手、工具／提示发现、资源枚举、取消通知、服务发现及 `server/*` 协议方法，不再只有 3 种握手 |
| Active Agent | 近 N 活跃 Agent | 窗口内至少有 1 次默认用量业务调用的去重 Agent；是否只含当前配置 Agent 按 §6 页面人口口径确定 |
| Last MCP Access | 最近 MCP 访问 | 全量访问日志的最后时间，协议事件也会更新；保持 Spec 155 定义 |
| Last Business Use | 最近业务使用 | 全历史最后一次默认用量业务调用；协议事件与默认视图排除的评测探针不更新 |
| Used Credential Count | 近 N 使用过的凭据 | 全量访问日志中的去重 hash prefix；保持 Spec 128 / 155 定义，不改名为业务活跃 |

### 新增术语

| Canonical Term | UI 主术语 | 定义 | 禁止混淆 |
|---|---|---|---|
| Default Usage Call | 默认用量业务调用（技术口径；不新增卡片标题） | 非协议业务工具调用或真实内容读取，且不是 Spec 162 定义的默认视图排除评测探针 | 全部 access_log、协议请求、原始非协议调用 |
| Business Active Token | 近 N 业务活跃 Token | 当前配置 Token 中，窗口内至少有 1 次默认用量业务调用的 Token | 可用 Token、近 N 使用过的凭据、仅发生握手的 Token |

### Protected DOM

`Agent`、`Token`、`MCP`、`P95`、`eval_mark`、`server/*`、工具名、数据库对象名、文件名、路径与 URL 继续使用 `translate="no"` + `notranslate`。

---

## 1. 背景与问题

当前系统已经保留完整 MCP 审计流水，也已经在部分页面区分协议请求与业务调用，但分类规则和消费方式不统一：

1. `/admin/usage` 的活跃 Agent、活跃 Token、Agent 排行和 Token 排行直接聚合全部 `access_log`，仅握手也会形成“活跃”；同 API 的 calls、延迟和拒绝聚合也未进入统一口径。
2. `/admin/agents` 与 `/admin/audit` 只排除 `initialize`、`notifications/initialized`、`tools/list`。调用监控还有两条不同读路径：`readR1AuditObservability` 已通过 `defaultUsageExcluded` 排除既有 8 方法及评测探针，是新共享模块的参考实现；真正供 `/ops/calls` 使用的 `readCallMonitorSnapshot` 才只排除 3 方法且不排除评测探针。
3. `/admin/tokens` 以任意日志的最近时间判定“近 7 天活跃”，Agent 详情的 Token“最近使用”和对象详情抽屉也会把协议访问展示成使用或调用。
4. `/admin/access-map` 的数据访问主体来自 `access_log_sources`，不受纯协议噪音影响；但 Token 清单的窗口调用数仍统计全部日志。
5. `/eval/monitor` 的“现场”面板按 client family 统计全部 `access_log`，没有协议或评测探针过滤；该面板属于 Spec 161 的真实现场使用观察，不是原始评测探针监控。
6. 网关准入有 11 个 JSON-RPC 方法，现有 8 方法默认用量集合未覆盖 `prompts/list`、`prompts/get`、`resources/read`。后两者与 `lucy_skill_read` 共用受权限保护的技能内容读取路径，不能因使用 JSON-RPC 方法名就误判为协议噪音。
7. Spec 162 已有“协议与评测探针退出默认用量 KPI”的规则，但调用监控等页面未复用；代码中握手、探测、准入和默认用量名单可独立漂移，形成同一日志在不同页面得到不同业务结论。

统计真实性不能靠各页面分别补 `NOT IN` 解决。必须建立唯一分类事实源，并明确原始审计、原始业务工具调用、默认用量指标之间的边界。

## 2. 目标

1. 任一 Agent 只有连接、重连、握手、工具／提示发现、资源枚举、取消通知或服务发现时，不被任何“业务活跃”或“业务调用量”指标判为活跃；真实技能内容读取不属于上述纯发现行为。
2. 同一日志记录在所有默认用量页面使用同一个分类结果；协议与评测探针规则只维护一份，准入方法必须具有穷尽的用量分类。
3. 原始审计记录完整保留，协议事件仍可按审计需要查看；不以修复统计为由删除、改写或隐藏原始行。
4. 保留“最近 MCP 访问”和“近 N 使用过的凭据”的全量访问语义，同时让“最近业务使用”“业务活跃 Token”只由默认用量业务调用驱动。
5. 保留现有时间窗、不可用／部分可信状态、Token prefix 碰撞处理和 API 向后兼容策略；字段名保留不代表数值不变，所有预期漂移必须显式发布。

## 3. Non-Goals

| 不做 | 原因 |
|---|---|
| 修改 MCP 运行时授权、工具暴露、权限拒绝或请求转发算法 | 本 Spec 改变统计读取与展示；Access Governance Gate 的输入口径变化按 §6 单独约束，不修改阈值和裁决算法 |
| 删除、回填或重写历史 `access_log` | 分类在读取时确定性派生，原始审计是不可变事实源 |
| 仅凭 `event_type` 判断历史数据 | 历史行可能为空或来自旧分类版本；必须以工具名和显式评测标记重算默认用量口径 |
| 把所有“使用”文案都改成业务使用 | “最近 MCP 访问”和“近 N 使用过的凭据”本来就表达全量访问，保留其含义 |
| 将评测探针从访问日志、导出、问询关联或访问关系图主体删除 | 评测探针可能是真实工具调用与真实表访问；它只退出默认用量 KPI |
| 把 `/api/observability/logs` 改成聚合或默认用量视图 | 该端点是原始日志检索，保持 Raw Audit Record 与既有筛选、脱敏语义 |
| 强制所有页面的活跃数绝对相等 | 页面的人口边界不同：当前配置资产与历史日志身份不是同一集合，见 §6 |
| 新增数据库表、统计快照或定时聚合任务 | 当前规模继续基于审计库实时聚合；改动前基线只是一次性对照证据，不是运行时制品 |
| 默认新增浏览器、移动窄屏或 Docker 验证 | 遵循 `docs/governance/DEVELOPMENT.md` 的验证约束 |

## 4. 统一分类模型（Normative）

### 4.1 三层记录口径

| 层级 | 定义 | 主要用途 |
|---|---|---|
| Raw Audit Record | `access_log` 全量记录，不按工具或结果删除 | 原始审计、原始日志检索、导出、最近 MCP 访问、使用过的凭据 |
| Raw Business Tool Call | 非协议事件的真实业务工具调用或受权限保护内容读取，包含 `ok`、`error`、`denied`、`budget_stop`；包含评测探针 | 原始业务审计、问询关联、权限与执行分析、Access Governance Gate 高流量输入 |
| Default Usage Call | Raw Business Tool Call 中，再排除符合 Spec 162 条件的评测探针 | 业务调用量、业务活跃、调用监控、现场使用、业务用量排行、Token 业务活跃 |

“业务调用量”UI 默认使用第三层。若接口同时返回 Raw Business Tool Call 与 Default Usage Call，必须使用不同字段，不得复用一个 `businessCalls` 字段表达两种口径。技术名称沿用 Raw Business Tool Call 以保持 API 兼容，但其规范含义明确包括 `resources/read` 与 `prompts/get` 的真实技能内容读取。

### 4.2 协议事件全集与准入覆盖

协议事件包括：

```text
握手与工具发现：
- initialize
- notifications/initialized
- tools/list

探测、资源／提示发现与取消：
- ping
- resources/list
- resources/templates/list
- prompts/list
- notifications/cancelled
- server/discover

其他服务协议方法：
- 任何以 server/ 开头的方法
```

实现必须分开维护 `MCP_HANDSHAKE_METHODS` 与 `MCP_PROTOCOL_METHODS`。禁止直接把原三元素数组扩展后继续用数组下标推导 `transport_sub_type=handshake`，否则会把 `ping` 等错误标成握手。`prompts/list` 属于发现／探测子类，不属于握手。

`admission.ts` 的 `ALLOWED_RPC_METHODS` 是准入集合，不是协议集合，二者不得断言相等。必须用覆盖测试证明每个准入方法都有且只有一个用量分类：

| 准入方法 | 用量分类 |
|---|---|
| `initialize`、`ping`、`notifications/initialized`、`notifications/cancelled`、`tools/list`、`resources/list`、`resources/templates/list`、`prompts/list` | Protocol |
| `tools/call` | 按实际业务工具调用进入 Raw Business，再按评测规则决定是否进入 Default Usage |
| `resources/read`、`prompts/get` | 真实技能内容读取，进入 Raw Business；默认没有评测探针标记时进入 Default Usage |

新增准入方法时，覆盖测试必须失败，直到分类得到显式裁决；不得默认落入 Default Usage。`server/*` 是审计中可能出现的服务协议补充规则，不要求加入准入集合。

### 4.3 评测探针

沿用 Spec 162，不扩大推断规则：

- Token 的 `eval_mark` 必须显式为真；不从 `actor_kind`、`token_label` 或 User-Agent 推断。
- 同时要求参数或连接名命中既有探针名称规则。
- 只命中名称但未显式标记的记录仍是 Default Usage Call。
- 评测探针只退出 Default Usage Call；仍是 Raw Business Tool Call，并保留在原始日志、审计导出、问询关联和真实表访问中。

### 4.4 结果状态

默认用量业务调用包含真实业务访问的 `ok`、`error`、`denied` 与 `budget_stop`：

- `ok` 进入成功率和成功业务使用。
- `error` 进入错误率，仍代表一次真实业务调用尝试。
- `denied` 进入拒绝率，仍代表一次真实业务访问尝试。
- `budget_stop` 不丢失；按现有主状态映射处理，不伪装为成功。

本 Spec 不把“活跃”改成“只有成功执行才活跃”。如未来需要“成功使用 Agent”，应另立指标，不复用本指标。

## 5. 唯一实现事实源与 API 兼容

### 5.1 共享分类模块

在 Lucy 侧建立唯一用量分类模块，至少提供：

- 握手方法集合、协议方法集合与 `isMcpProtocolMethod(tool)`。
- `isEvalProbeCall(row)` 与 `defaultUsageExcluded(row)`。
- 供 SQL 聚合使用的协议／默认用量条件生成器，支持表别名和参数化探针标记。
- 准入方法分类覆盖测试，以及 TypeScript 与 SQLite 两条路径的分类一致性测试。

SQL 与 TypeScript 必须复刻同一数据类型和字符串语义：SQLite 的 `eval_mark` 以 integer `1` 表示真，TypeScript 输入转换为 boolean；探针名称判断使用 `instr(lower(value), marker)` 等等价形式复刻小写包含语义，不依赖 `LIKE` 的隐式大小写行为。JSON 参数键匹配及非法／空 `args_summary` 的容错也必须一致。

所有用量 SQL 必须继续使用统一时间窗，不得经过 `COMPAT_AUDIT_ROW_LIMIT=5000`，不得为复用分类而把全窗日志无界物化到 JavaScript。`event_type`、`transport_sub_type` 可参与诊断和导出，但历史默认用量统计不得只依赖这些字段。

### 5.2 Agent API 字段与数值迁移

保留：

- `callsLast7d`：全量访问记录。
- `businessCallsLast7d`：Raw Business Tool Call。
- `protocolCallsLast7d`：全部协议事件。
- `activeAgentCountLast7d` / `businessActiveAgentCountLast7d`：基于 Raw Business Tool Call 的兼容字段。
- `activeTokensLast7d` / `usedCredentialsLast7d`：全量访问凭据语义，保持 Spec 155。

新增并供新 UI 使用：

- `usageCallsLast7d`：每个当前配置 Agent 的 Default Usage Call，以及服务端 summary 的合计。
- `usageActiveAgentCountLast7d`：服务端 `buildAgentsSummary` 在当前配置 Agent 集合上统计 `usageCallsLast7d > 0` 的数量；前端 `summarizeAgents` 仅是旧响应缺少 summary 时的兼容计算路径，不是权威数据源。
- `evalProbeCallsLast7d`：从默认用量排除的评测探针数，用于对账。

恒等式：

```text
callsLast7d = businessCallsLast7d + protocolCallsLast7d
businessCallsLast7d = usageCallsLast7d + evalProbeCallsLast7d
```

字段名和恒等式保留，但数值会按新分类预期变化：在同一不可变日志集合与窗口上，`businessCallsLast7d` 单调不增，`protocolCallsLast7d` 单调不减；只有具有新增协议分类记录的 Agent 才必然变化。`lastBusinessUse` 也可能向过去移动。实施前必须保存确定性混合夹具基线；如能合法访问现有审计库，再对同一快照采集改动前后对照，但不要求读取生产数据。发布说明必须提示下游看板、阈值和外部消费方。

旧 UI 或旧客户端继续读取旧字段时，不得因为新字段缺失而收到伪造的 0。新 UI 不得回退到 `callsLast7d` 或 `businessCallsLast7d` 计算 Default Usage 活跃或调用量，因为前者包含协议，后者包含默认视图排除的评测探针；缺少 `usage*` 时必须按兼容策略显示不可用或旧版提示。

### 5.3 Token、Governance 与审计派生 API

- `/api/admin/governance/overview` 的 `activeAgentCount`、`activeTokenCount` 改用 Default Usage Call。
- 同 API 的 `usage.calls`、`denied`、`errors`、`avgLatencyMs`、`errorRate`、`deniedRate`、`p95LatencyMs`，以及每 Agent calls、结果计数、平均延迟、P95、Top 拒绝原因和高拒绝 Agent 数，全部由 Default Usage Call 聚合。对应实现包括 `queryCallStats`、`queryP95LatencyMs`、`queryAgentWindowStats`、`queryAgentP95LatencyMs`、`queryAgentTopDeniedReasons`、`queryHighDenialAgentCount`。即使当前页面不渲染部分卡片，API 也不得在同窗口暴露相反口径。
- `/api/admin/governance/agents` 与 `/tokens` 的排行 `calls` 改用 Default Usage Call；响应可增加 `protocolCalls`、`evalProbeCalls` 供诊断，但不要求新增排行卡。
- `/api/admin/governance/denials` 的 reason、tool、trend 使用 Default Usage Call；真实表访问来源继续按 `access_log_sources` 统计。`/api/admin/governance/roles` 的审计派生 `usageCount` 使用 Default Usage Call，配置用户计数保持不变；不得再经 5000 行兼容限流器计算用量。Role 拒绝只归属 `matched_role_id` 的规则适用于 R1 observability，不误植到该 roles 响应。
- `/api/admin/tokens` 增加业务使用时间字段；近 7 天业务活跃只由该口径驱动，原有最近 MCP 访问字段保留。
- `/api/ops/call-monitor` 的 `traffic.businessCalls` 明确为 Default Usage Call，成功率、错误率、拒绝率、P95、慢调用、工具排行共用同一记录集合。`/api/r1/observability` 对齐同一共享分类，保留既有 Role 拒绝只归属 `matched_role_id`、Actor 和评测证据语义。
- `/api/eval/monitor/field` 的 calls、errors、denies 及比率使用 Default Usage Call，domain 与 Role 绑定人口不变；未绑定 Role 时仍不得展示全量访问日志。
- `/api/admin/governance/risk-review` 的高拒绝风险输入使用 Raw Business Tool Call，保留真实评测调用对治理风险的贡献；最近 MCP 访问和原始证据字段不被默认用量过滤。`/api/admin/governance/release-readiness-package` 的业务调用、拒绝和就绪证据使用 Default Usage Call，原始附件与日志引用保持完整。
- `/api/admin/audit` 保留原始审计语义：默认隐藏协议事件，`includeProtocol=true` 显示全部；评测探针不因默认用量规则从审计流水删除。`/api/observability/logs` 始终是 Raw Audit 检索，不新增用量过滤。

## 6. 页面口径与人口边界

| 页面 / 组件 | 修改后规则 | 人口边界 |
|---|---|---|
| `/admin/usage` 数据访问 | 活跃 Agent、活跃 Token、Agent／Token 排行只计 Default Usage Call；表活跃与表排行保持真实表访问口径 | 活跃计数可含历史日志身份；排行仍只含当前配置资产。活跃率分子大于当前配置分母时继续 `partial`，不静默截断 |
| `/admin/usage` 界面使用 | 不变，继续使用 `ui_page_views` | WebUI 登录账户，与 MCP Agent 无关 |
| `/admin/agents` | 近 7 天活跃 Agent、业务调用量、活跃筛选和最近业务使用改用 `usage*`；协议请求卡覆盖协议全集；使用过的凭据保持全量访问 | 仅当前配置 Agent |
| `/admin/agents/:userId` | Token 的“最近使用”改为“最近 MCP 访问”；如展示“最近业务使用”，必须来自 Default Usage Call | 当前 Agent 的当前配置 Token |
| `/admin/tokens` | KPI 改为“近 7 天业务活跃 Token”；列表主时间使用最近业务使用，技术上下文可保留最近 MCP 访问 | 仅当前配置 Token；不可用状态不参与伪活跃 |
| `/admin/audit` | 默认调用流水排除协议全集；包含协议时显示全部；问询关联保持 Raw Business Tool Call，评测探针不删除 | 原始审计人口，不转为当前配置资产 |
| `/ops/calls` | 全部 KPI、折线、工具排行、最近失败与拒绝使用同一 Default Usage Call 集合 | 全部可识别日志身份，不与当前配置资产率混算 |
| `/admin/access-map` | 授权面、访问路径和真实表访问主体不变；Token 清单“窗口内调用”改为 Default Usage Call | 访问关系按既有 confirmed／candidate 口径；不过滤真实评测表访问 |
| `/eval/monitor` “现场” | calls、errors、denies 及比率只计 Default Usage Call；不改变趋势黄线／红线，也不把现场报错占比变成评测门禁 | domain 绑定的 Role 及其日志身份；未绑定 Role 时保持空态 |
| Agent 对象详情抽屉 | “近 7 天调用”改为“近 7 天业务调用量”，读取 `usageCallsLast7d`；不再读取全量 `callsLast7d` | 当前配置 Agent |

### 跨页面对账原则

- 同一页面、同一窗口、同一人口集合内，活跃数、调用量和排行必须使用同一 Default Usage Call 集合。明确声明为 Raw Audit 或 Raw Business 的治理／诊断表面不强行与 Default Usage 数字相等，但字段名、帮助文案和导出说明必须标明层级。
- `/admin/agents` 与 `/admin/usage` 可以因历史 Agent 是否进入分子而不同；必须在接口测试和帮助文案中说明人口边界，不得为追求数字相等而删除历史事实。
- “近 N 使用过的凭据”允许大于“业务活跃 Token”，因为前者包含协议访问。
- “最近 MCP 访问”允许晚于“最近业务使用”。

### Access Governance Gate 输入边界

Agent 修改与删除的 `buildAgentGateInput.callsLast7d` 继续读取 `businessCallsLast7d`，即 Raw Business Tool Call，而不是 Default Usage Call。这样纯协议访问不再抬高“高流量”计数，真实评测业务调用仍保留治理保护。`HIGH_TRAFFIC_TARGET` 是 P1 `warn`，阈值和裁决算法不变；不得把它描述成 P2 拦截，也不得借本 Spec 改成全量 `callsLast7d` 或默认用量字段。必须增加阈值两侧及纯协议／评测探针对照测试，并在发布说明中提示高流量计数可能预期下降。

## 7. 核心流程（伪代码）

```text
function classifyAllowedRpcMethod(method):
  assert method in ALLOWED_RPC_METHODS
  if method in MCP_PROTOCOL_METHODS:
    return PROTOCOL
  if method in {"tools/call", "resources/read", "prompts/get"}:
    return BUSINESS
  fail "new admitted method requires explicit usage classification"

function classifyUsage(row):
  # 1. 工具名优先重算协议分类，兼容历史空 event_type。
  if row.tool in MCP_PROTOCOL_METHODS or row.tool startsWith "server/":
    return PROTOCOL

  # 2. 非协议行先属于原始业务；resources/read 与 prompts/get 也走这里。
  # 3. SQLite eval_mark=1 先归一成 TS evalMark=true；两侧名称匹配语义相同。
  if row.evalMark === true and matchesEvalProbeName(row.args, row.connectionName):
    return EVAL_PROBE

  return DEFAULT_USAGE

function aggregateWindow(window, rowsOrSql):
  assert window.startIso and window.endIso built once by metric-window

  for each record in [window.startIso, window.endIso):
    class = classifyUsage(record)
    allAccessCount += 1
    lastMcpAccess = max(lastMcpAccess, record.ts)

    if class == PROTOCOL:
      protocolCount += 1
      continue

    rawBusinessCount += 1
    rawBusinessOutcomes[record.outcome] += 1
    if class == EVAL_PROBE:
      evalProbeCount += 1
      continue

    usageCount += 1
    lastBusinessUse = max(lastBusinessUse, record.ts)
    usageOutcomeCounts[record.outcome] += 1
    usageDurations.add(record.duration_ms)
    usageAgentSet.add(record.user_id) when non-empty
    usageTokenSet.add(record.token_hash_prefix) when non-empty

  assert allAccessCount == rawBusinessCount + protocolCount
  assert rawBusinessCount == usageCount + evalProbeCount

function readMetric(source, population, window, layer):
  try:
    aggregate = aggregateWindow(window, source)
    return applyPopulation(selectLayer(aggregate, layer), population) with state ok/no_data
  catch auditReadFailure:
    return value null with state unavailable
  if tokenPrefixCollision:
    return credential value null with state partial

function readGovernanceUsageMetrics(source, population, window):
  # calls、结果率、平均延迟、P95、Agent 拒绝原因和高拒绝 Agent 共用同一集合。
  return readMetric(source, population, window, DEFAULT_USAGE)

function readEvalFieldMetrics(source, boundRoles, window):
  # 现场不是评测探针监控；只改变记录层级，不扩大 Role 人口。
  return readMetric(source, boundRoles, window, DEFAULT_USAGE)

function buildHighTrafficGateInput(auditSource, agent, window):
  # 治理保护保留真实评测业务调用，只排除协议噪音；阈值和 P1 warn 算法不变。
  return readMetric(auditSource, {agent}, window, RAW_BUSINESS).count

function auditDefaultView(filter):
  # 审计不是默认用量 KPI：只控制协议可见性，不删除评测业务行。
  if filter.includeProtocol or filter.callSource == playground or filter.turnScoped:
    return matchingRawAuditRows(filter)
  return matchingRawAuditRows(filter) excluding PROTOCOL
```

关键顺序不可交换：先识别协议，再区分原始业务与评测探针，最后按表面声明的层级聚合；不能先把 `error`／`denied` 删除，也不能用全量 `lastSeen` 代替 `lastBusinessUse`。准入覆盖是穷尽分类检查，不要求准入集合等于协议集合。

## 8. UI 与 Design System Compliance

引用：

- `webui/docs/design-system/12-components-metric-card.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

遵循点：

1. 不新增视觉模式、卡片布局或排行结构，只修正指标数据与必要文案。
2. MetricCard tooltip 写清默认用量口径；副文继续表达窗口、资产人口或状态，不与 tooltip 逐字重复。
3. `partial`／`unavailable` 继续显示 `—`，不得用 `?? 0` 把故障伪装成无调用。
4. 专业术语、工具名和技术标识保留翻译防御。
5. 默认不增加浏览器验收要求；组件行为由 Vitest / Testing Library 验证。

## 9. 验收标准

| ID | 优先级 | 验收断言 |
|---|---|---|
| SC-01 | P0 | 对协议全集中的每种方法及一个 `server/unknown` 夹具，只有协议记录时，`/admin/usage` 活跃 Agent 为 0，Agent／Token 业务排行为空；`prompts/list` 必须有独立夹具 |
| SC-02 | P0 | 同一夹具下，`/admin/agents` 的 `usageCallsLast7d=0`、服务端 `usageActiveAgentCountLast7d=0`，协议请求数增加；最近 MCP 访问更新，最近业务使用不更新 |
| SC-03 | P0 | 同一夹具下，`/admin/tokens` 业务活跃 Token 为 0；最近 MCP 访问可更新，但不得据此判定业务活跃 |
| SC-04 | P0 | 同一夹具下，`/ops/calls` 和 Governance overview 的调用量为 0；成功率／错误率／拒绝率、平均延迟、P95、每 Agent 拒绝原因及高拒绝 Agent 数不出现由协议或默认排除探针构造的分子或分母 |
| SC-05 | P0 | `/admin/audit` 默认调用流水不显示协议全集；`includeProtocol=true` 和调试台来源仍能查看原始协议记录，`/api/observability/logs` 原始检索不过滤协议或评测行 |
| SC-06 | P0 | Agent 对象详情抽屉读取 `usageCallsLast7d`，不再把全量 `callsLast7d` 显示为业务调用 |
| SC-07 | P0 | `/admin/access-map` Token 窗口调用不累计纯协议记录；真实表访问路径与原始调用守恒不因本修复改变 |
| SC-08 | P0 | `eval_mark=true` 且名称命中的 `lucy_query` 退出所有 Default Usage KPI，包含 `/eval/monitor` 现场、Governance denials／roles 和发布就绪用量；仍可在原始审计、导出、问询关联、风险治理 Raw Business 输入和真实表访问中查到 |
| SC-09 | P0 | 同样名称但未设置 `eval_mark` 的调用仍进入默认用量；不得凭 User-Agent、`token_label` 或 `actor_kind` 排除 |
| SC-10 | P0 | 真实业务工具及 `resources/read`、`prompts/get` 的 `ok`、`error`、`denied` 均形成业务活跃；成功／错误／拒绝分别进入正确指标，协议事件不进入任何一项。高流量 Gate 只排除协议、仍计真实评测业务调用，且保持 P1 `warn` 与原阈值 |
| SC-11 | P0 | Agent API 满足 `calls = business + protocol` 与 `business = usage + evalProbe`；新 UI 不回退到 `callsLast7d` 或 `businessCallsLast7d` 冒充 Default Usage，改动前后基线差异均可由分类迁移解释 |
| SC-12 | P0 | 11 个准入方法均有穷尽分类且新增方法会触发失败；TypeScript 与 SQLite 对同一混合夹具输出完全一致，integer `eval_mark`、小写包含匹配、`server/*` 和非法／空 `args_summary` 不导致漂移或查询失败 |
| SC-13 | P0 | 超过 5000 条窗口记录时，协议与评测排除仍完整生效，Governance roles 等用量也不经兼容限流器；无静默截断、无全窗 JavaScript 物化替代 |
| SC-14 | P0 | 审计库不可用时窗口指标为 `null / unavailable`；prefix 碰撞继续使用 `partial`，均不渲染成 0 |
| SC-15 | P1 | 最近 MCP 访问可以晚于最近业务使用；使用过的凭据可以多于业务活跃 Token，UI 与 `kpiContracts.ts` 不将二者混称，D4 锚点不丢失 |
| SC-16 | P1 | 历史 Agent／Token 与当前配置资产的跨页面差异符合 §6 人口边界；活跃率超过 100% 时仍按 Spec 128 进入 `partial` |
| SC-17 | P1 | 现有 24h／7d、调用监控四种窗口、访问关系图三种窗口和导出筛选行为不回归；Risk Review 使用 Raw Business，Release Readiness 使用 Default Usage，Role 拒绝归属和现场 Role 绑定边界不变 |
| SC-18 | P1 | `lint:terminology`、`kpi-contracts` 及全部相关前后端测试、TypeScript 构建通过；未执行的项目不得标记为已验收 |

## 10. 验证记录（2026-10-27，WO-202610-28 T1～T6）

| 验证项 | 命令／入口 | 结果 |
|---|---|---|
| 全量测试 | `npx vitest run --maxWorkers=1` | 历史声称，**不是当前 HEAD 的证据**：一处写 350 文件 / 4213 通过 / 0 失败，同节噪声说明写 350 文件 / 4212 通过 / 0 失败，工单 SC-18 写 349 文件 / 4205 通过 / 0 失败。三组数字不能同时作为同一次全量。未在当前 HEAD 重跑之前，不引用其中任何一组作为验收通过 |
| 术语 lint | `npm run lint:terminology` | 通过（997 files scanned） |
| IA 边界 lint | `npm run lint:ia-boundary` | 通过 |
| 前端构建 | `npm run build` | 通过 |
| 类型检查 | `npx tsc --noEmit` | 与改动前基线同一集合（68 处既有问题），本次涉及文件 0 新增 |
| SQLite 环境 | Node `v24.14.1` + `better-sqlite3@12.11.1` | 原生绑定可加载并执行 SQL，**ABI 匹配**；SQLite 断言真实执行，无跳过 |
| 跨页对账 | `server/__tests__/usage-metrics-cross-page.test.ts` | Default Usage 73（全量身份）／59（配置资产）；Raw Business = Default Usage + 2；Raw Audit = Raw Business + 12；人口边界 14；活跃分子 21 > 分母 20 → `partial` |
| 不可用语义 | `server/__tests__/admin-governance-observability.test.ts` | 审计库不可用时使用概况的全部窗口指标为 `null` 且 `metricsState = "unavailable"`（含高拒绝 Agent 数），无一被折成 0（SC-14） |

**跨页对账结论**：同层同人口的数值在所有表面完全一致；允许的差异只剩**记录层级**（Default Usage／Raw Business／Raw Audit／真实表访问）与**人口边界**（当前配置资产／历史日志身份），且每个差异都被断言为精确数值。

**未执行项（保持未验收）**：浏览器验证、移动窄屏验证、Docker 镜像重建、客户包发布 —— 按计划默认不做。

**已知环境噪声**：与其它 vitest 进程**并发**跑全量时会出现 0–3 个既有 flaky（失败集合逐次不同、每个单独复跑均通过，集中在审计库／Access Governance Gate／展示权限／语义资产链路）。已定位到具体机制：这些用例写**固定路径**产物（如发布就绪证据包固定写 `inbox/202608-governance-release-readiness.md`，`resolveProjectRoot()` 在 `KTX_PROJECT_ROOT` 未设置时回落到仓库根目录），并行进程会写同一文件；仓库 `test/setup.ts` 亦记录了"测试文件共享进程、环境变量会串"的结构性风险。历史独占运行记录与上表全量数字不一致，见上表，不作为当前 HEAD 的通过证据。判定流程：出现此类失败必须**单独复跑确认**后再判定，不得直接写成回归。

## 11. 实施与交付边界

- 先保存确定性混合夹具基线并补失败断言，再改共享分类和各 API；真实审计快照对照是可选项，不得暴露客户敏感数据。
- 按“共享分类 → Agent／Token → 使用概况及 Governance API → 调用监控／审计／现场／访问关系图与治理证据 → 跨页对账”顺序实施。
- 每阶段保留原始日志与旧字段兼容，不以全量重写 API 响应替代定点修改；协议集合扩大造成的旧字段数值变化必须在发布说明中显式列出。
- 自动化环境若存在 Node 与 `better-sqlite3` ABI 不匹配，应先记录并修复测试环境再执行 SQLite 验证；不得把未运行写成通过，也不得为赶进度静默跳过后端统计断言。
- 完成后同步 Spec 64、128、155、161、162、171、187 的交叉引用、KPI 注册表与术语标准。当前状态与文首一致：「已实施（T1～T6 已完成）；未验收」。浏览器与 Docker 验证未执行。实现完成不等于验收通过。
