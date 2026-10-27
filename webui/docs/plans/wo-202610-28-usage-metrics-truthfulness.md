# WO-202610-28 用量统计真实性与跨页面口径统一实施计划

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-28 |
| 来源 Spec | `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` v1.1 |
| 状态 | **已批准（v1.1 复审通过）；未开始实施** |
| 撰写日期 | 2026-10-26；2026-10-27 按交叉审阅复核裁决修订；2026-10-27 按 v1.1 复审结论修订计划（N1–N4） |
| 优先级 | P0 |
| 实施边界 | 统计读取、API 派生指标与既有 UI 文案；不改 MCP 授权算法和原始审计写入，Access Governance Gate 仅固定 Raw Business 输入口径 |
| 审阅记录 | `webui/docs/plans/review-spec189-wo-202610-28.md`（首轮 v1.0 审阅 + v1.1 复审，结论 PASS） |

**Goal：** 消除握手、工具／提示发现、资源枚举、服务发现和默认视图排除的评测探针对 Agent／Token 业务活跃与调用量的虚高，同时保留真实技能内容读取、完整审计事实和既有页面人口边界。

**Architecture：** 以 Lucy 侧共享用量分类模块为唯一事实源，明确 Raw Audit Record → Raw Business Tool Call → Default Usage Call 三层口径。SQL 聚合与 TypeScript 分类共用同一规则并通过一致性夹具验证；各页面和 API 只选择记录层级与资产人口，不再各自维护同语义协议名单。原始 `access_log` 不改写，旧 API 字段保留但明确数值迁移，新 UI 使用语义明确的 `usage*` 字段。准入集合与协议集合通过穷尽分类覆盖测试对齐，而非断言集合相等。

**Tech Stack：** TypeScript、Fastify、SQLite / JSON1、React、TanStack Query、Vitest、Testing Library。

---

## 实施顺序与依赖

```text
T1 契约、数值基线与失败夹具
  → T2 共享分类、准入覆盖及 SQL/TS 一致性
  → T3 Agent、治理门禁输入与对象详情
  → T4 使用概况、Governance API 与 Token
  → T5 调用监控、访问日志、评测现场、访问关系图与治理证据
  → T6 跨页对账、文档与交付验证
```

T3–T5 都依赖 T2；不得先在单个页面复制一份新的协议列表。每个阶段只修改对应读取与展示路径，不重写整个页面或 API 包。

## Task 1：固化契约、采集基线并先补失败用例

**Files：**

- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `webui/docs/64-tiered-publish-gate-spec.md`
- Modify: `webui/docs/128-enterprise-kpi-contract-spec.md`
- Modify: `webui/docs/171-governed-skill-system-and-context-transpass-spec.md`
- Modify: `webui/docs/155-agent-admin-usage-truthfulness-remediation-spec.md`
- Modify: `webui/docs/161-offline-eval-customer-ops-spec.md`
- Modify: `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- Modify: `webui/docs/187-access-relation-sankey-spec.md`
- Modify: `webui/src/lib/kpiContracts.ts`
- Test: `webui/src/__tests__/kpi-contracts.test.ts`
- Test: `webui/server/__tests__/admin-governance-observability.test.ts`
- Test: `webui/server/__tests__/admin-agents.test.ts`
- Test: `webui/server/__tests__/call-monitor.test.ts`
- Test: `webui/server/__tests__/access-governance-gate.test.ts`
- Test: `webui/src/__tests__/tokens-page.test.tsx`
- Test: `webui/src/__tests__/object-detail-drawer.test.tsx`
- Create: `webui/server/__tests__/usage-mixed-fixture.ts`（确定性混合夹具 + 改动前基线声明；纯数据，不含分类器）
- Create: `webui/server/__tests__/usage-baseline.test.ts`（真实审计库 + 真实 Agent API 的基线锁定与目标断言）
- Create: `webui/server/__tests__/eval-monitor-field.test.ts`（评测现场 Role 绑定夹具；T5 继续扩充）

**Steps：**

- [x] 在术语标准登记“默认用量业务调用”和“近 N 业务活跃 Token”，修订业务调用量、协议请求量、最近业务使用的定义；同步 `kpiContracts.ts` 的活跃 Agent、活跃 Token、业务调用量、ACL 拒绝和 P95 帮助文案，保留 D4 锚点。
- [x] 清理 `kpiContracts.ts` 中无页面对应卡片的陈旧 `calls` 注册项并同步测试；不删除 Governance API 的 `usage.calls` 字段，也不把该清理当作修改 API 的理由。
- [x] 在上游 Spec 增加指向 Spec 189 的修订说明，不删除历史决策记录；特别登记 Spec 171（原 131）的技能内容读取、Spec 161 的现场用量及 Spec 64 的 Raw Business 高流量输入，冲突口径以 Spec 189 为最新实现基线。
- [x] 在改动前保存确定性混合夹具中各 Agent 的 `callsLast7d`、`businessCallsLast7d`、`protocolCallsLast7d`、`lastBusinessUse` 与高流量阈值对照基线。若合法可用，再对同一现有审计快照采集前后对照；不要求生产数据，不记录敏感参数。
- [x] 为 9 个具名协议方法及 `server/unknown` 建立协议专属 Agent／Token 夹具，先断言当前错误页面会虚高；另为 11 个准入方法建立覆盖矩阵，并明确 `tools/call`、`resources/read`、`prompts/get` 是业务访问而非协议噪音。
- [x] 增加显式评测探针、仅名称命中但未标记、真实 `ok/error/denied`、历史身份、prefix 碰撞、评测现场 Role 绑定和治理阈值两侧夹具。
- [x] 将 SC-01～SC-18 映射到具体测试文件与断言，确认没有只做实现而没有验收入口的条款；SC-18 明确归属 T6。

> **T1 落盘说明（2026-10-27）**
>
> - 夹具与基线落在 `server/__tests__/usage-mixed-fixture.ts` + `server/__tests__/usage-baseline.test.ts`，**跑真实审计库与真实 Agent API**（不 mock 审计模块），系统时钟固定在 `2026-10-27T08:00:00Z`，基线可重放。
> - 改动前基线（当前实现的真实数值）已锁定：协议专属 Agent 的 `businessCallsLast7d` 对 `ping`／`resources/list`／`resources/templates/list`／`prompts/list`／`notifications/cancelled`／`server/discover`／`server/unknown` **全部为 1**（虚高），评测探针 Agent 为 **2**，`resources/read`／`prompts/get`／`lucy_skill_read` 为 **1**（不应被误排除）。
> - 目标断言用 `it.fails(...)` 表达：套件保持绿色，实现落地后**自动转红**，提醒删除 `.fails` 标记。T6 必须把全部 `it.fails` 转为普通 `it`，并删除夹具中的 `LEGACY_PROTOCOL_METHODS_BEFORE_SPEC_189` 与基线断言块。
> - 治理门禁阈值两侧、`P1 warn` 不变、纯协议不计、评测业务调用仍计已落在 `access-governance-gate.test.ts`；评测现场 Role 绑定与空态已落在 `eval-monitor-field.test.ts`。
> - SC 映射见下方「SC 验收映射表」。

**Done when：** 契约、数值迁移和三层口径无歧义，关键失败用例已存在且能区分 Raw／Business／Default Usage，基线可重放且不依赖生产数据。

## Task 2：实现唯一用量分类、准入覆盖与 SQL/TS 一致性

**Files：**

- Create: `webui/server/proxy/usage-classification.ts`
- Modify: `webui/server/proxy/mcp-request-classification.ts`
- Modify: `webui/server/admin/agents.ts`（统计 SQL 改用共享协议条件）
- Modify: `webui/server/admin/audit.ts`（4 处协议消费点改用共享协议条件）
- Modify: `webui/server/admin/reconciliation.ts`（协议判定改用共享模块）
- Modify: `webui/server/__tests__/audit-reconciliation-routes.test.ts`（顺带修复硬编码时间戳夹具）
- Modify: `webui/server/proxy/audit-classification.ts`
- Modify: `webui/server/proxy/question-experience.ts`
- Modify: `webui/server/proxy/admission.ts`（仅暴露只读准入集合供覆盖测试，或提供等价检查；不改准入成员与行为）
- Create: `webui/server/__tests__/usage-classification.test.ts`
- Test: `webui/server/__tests__/mcp-request-classification.test.ts`
- Test: `webui/server/__tests__/mcp-admission-all-methods.test.ts`
- Test: `webui/server/__tests__/audit-trust/audit-trust-classification.test.ts`
- Test: `webui/server/__tests__/usage-default-view.test.ts`

**Steps：**

- [x] 在新模块定义独立的握手集合、包含 `prompts/list` 的协议全集、`server/*` 判断、评测探针与 Default Usage 分类；明确 `resources/read`、`prompts/get` 为真实技能内容读取。
- [x] 保留 `mcp-request-classification.ts` 的兼容导出或迁移全部内部引用；不得留下可独立漂移的同语义协议名单。重写该测试第 6 行的精确三元素数组断言，改为逐方法分类、握手／探测边界和 `tools/call` 非协议断言，而非只把新数组改到绿。
- [x] 增加 `ALLOWED_RPC_METHODS` 分类覆盖测试：11 个现有方法各有一种明确分类，新增准入方法若未裁决必须失败；禁止断言准入集合等于协议集合。
- [x] `audit-classification.ts` 改用显式握手集合推导 `transport_sub_type`，确保 `ping`、`prompts/list` 是 `probe` 而非 `handshake`，技能内容读取不被误标为纯发现。
- [x] 将 `defaultUsageExcluded` / `isEvalProbeCall` 的权威实现迁入共享模块；原文件仅保留必要兼容重导出。
- [x] 生成支持表别名的 SQLite 条件与参数，覆盖 `server/*`、integer `eval_mark=1`、JSON 参数键和大小写规则；TS 侧归一为 boolean，SQLite 用 `instr(lower(value), marker)` 等等价形式复刻小写包含语义，不依赖 `LIKE` 隐式大小写。非法／空 `args_summary` 必须安全落到未命中，而非让整次统计失败。
- [x] 用同一混合记录数组分别运行 TS 分类和 SQLite 聚合，断言 Raw Business、Default Usage、Protocol、Eval Probe 四类数量及恒等式完全一致。
- [x] 增加 >5000 条记录测试，证明聚合不经过兼容限流器，也不全窗物化到 JavaScript。

> **T2 落盘说明（2026-10-27）**
>
> - 新增 `webui/server/proxy/usage-classification.ts`：**唯一用量分类事实源**。导出 `MCP_HANDSHAKE_METHODS`（3）、`MCP_PROBE_METHODS`（5，含 `prompts/list`）、`MCP_SERVER_METHODS`（`server/discover`）、`MCP_PROTOCOL_METHODS`（全集）与 `server/*` 前缀规则；导出 `classifyUsage`（`protocol` / `eval_probe` / `default_usage`）、`isEvalProbeCall`、`defaultUsageExcluded`、`isRawBusinessCall`；导出带表别名的 SQL 条件生成器 `protocolConditionSql` / `evalProbeConditionSql` / `defaultUsageConditionSql` / `rawBusinessConditionSql`。
> - **SQL 语义修正**（计划外但必须）：`eval_mark` 为 NULL 时 `eval_mark = 1` 求值为 NULL，`NOT NULL` 仍是 NULL，会把**所有未标记行**从默认用量集合里悄悄剔除。条件改为 `COALESCE(eval_mark, 0) = 1`。
> - **协议名单收敛**：`mcp-request-classification.ts` 改为共享模块的兼容重导出；`audit-classification.ts` 改用显式握手／探测集合（不再用数组下标推导）；`question-experience.ts` 的 `hasProbeName` / `isEvalProbeCall` / `defaultUsageExcluded` 迁入共享模块并保留重导出；`proxy/audit.ts` 的 `PROBE_TOOLS` / `HANDSHAKE_TOOLS` 改为派生。
> - **SQL 消费方同步迁移**（超出 T2 原文件清单，但属于"唯一事实源"的必要一步）：`admin/agents.ts`、`admin/audit.ts`（**全部 4 处**）、`proxy/audit.ts`、`admin/reconciliation.ts` 改用共享条件。具名 IN 列表无法表达 `server/*` 前缀规则，若只换名单，TS 与 SQL 会在 `server/*` 上分叉。
> - **N1 修复**：`readR1AuditObservability` 的评测探针判定改为"先分类再拆分"，不再用 `defaultUsageExcluded(...) && !protocolTools.has(...)` 二次反推（该式把协议行计成评测探针）。
> - `admission.ts` 改为 `export const ALLOWED_RPC_METHODS`（只读导出，准入成员与行为不变）。
> - 新增 `server/__tests__/usage-classification.test.ts`：逐方法分类、握手／探测边界、准入 11 方法穷尽覆盖矩阵（并显式断言准入集合 ≠ 协议集合）、TS↔SQLite 计数一致性、非法／空 `args_summary` 容错、integer `eval_mark` 归一、>5000 条不分页。
> - 重写 `mcp-request-classification.test.ts` 的精确三元素断言为逐方法断言。
> - **T2 造成的数值迁移（已对账）**：Agent API 的 `businessCallsLast7d` 现在等于 **Raw Business Tool Call**；`protocolCallsLast7d` 等于协议事件数。`callsLast7d = business + protocol` 恒等式成立。`usage-baseline.test.ts` 已改为按迁移规则断言：基线差额必须**恰好**等于此前被误计为业务调用的协议行数。
> - **顺带修复（计划外）**：`server/__tests__/audit-reconciliation-routes.test.ts` 的 D-20／D-26 夹具硬编码 `2026-10-19T12:00:00Z`，该时间戳在 2026-10-20 后落到对账 7 天窗口之外，导致这两个用例自 2026-10-20 起必然失败（与本 Spec 无关的既有时间炸弹）。改为相对当前时间生成。

**Done when：** SC-08～SC-13 的分类层断言通过；11 个准入方法分类完整，握手子分类与技能内容读取无回归。

## Task 3：迁移 Agent API、治理门禁输入、Agent 页面与共用详情

**Files：**

- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/src/components/ObjectDetailDrawer.tsx`
- Test: `webui/server/__tests__/admin-agents.test.ts`
- Test: `webui/server/__tests__/access-governance-gate.test.ts`
- Test: `webui/src/__tests__/agent-list.test.tsx`
- Test: `webui/src/__tests__/agent-detail.test.tsx`
- Test: `webui/src/__tests__/object-detail-drawer.test.tsx`

**Steps：**

- [x] 在同一 7 天窗口和同一批量聚合中输出每 Agent 与服务端 `buildAgentsSummary` 的 `usageCallsLast7d`、`usageActiveAgentCountLast7d`、`evalProbeCallsLast7d`，保留旧字段及其兼容语义；前端 `summarizeAgents` 只作为旧响应缺少 summary 时的兼容计算路径。
- [x] 断言 `calls = business + protocol`、`business = usage + evalProbe`，不可用状态仍把所有审计派生窗口字段置为 `null`；与 T1 基线逐项对账，差异只能来自协议重分类或评测探针拆分。
- [x] Agent 主 KPI、活跃筛选、最近业务使用改用 `usage*`；协议请求卡使用协议全集；“近 N 使用过的凭据”继续读取全量访问指标。
- [x] 删除 `AgentList.tsx:150`、`:398`、`:427`、`:693` 等路径用 `callsLast7d` 或 `businessCallsLast7d` 回退冒充 Default Usage 的逻辑；缺少 `usage*` 时按兼容策略显示不可用或旧版提示，不伪造 0。行号仅作当前定位，完成后检查全部消费者。
- [x] Agent 修改／删除的 `buildAgentGateInput.callsLast7d` 固定读取 Raw Business `businessCallsLast7d`，不得改成 Default Usage 或全量 calls；增加纯协议不计、真实评测业务调用仍计、阈值两侧及 P1 `warn` 不变的测试，不修改阈值和裁决算法。
- [x] Agent 详情 Token 的“最近使用”改为“最近 MCP 访问”；若增加最近业务使用，必须读取独立业务时间，不能复用 `last_used`。
- [x] 对象详情抽屉改为“近 7 天业务调用量”并读取 `usageCallsLast7d`。

**Done when：** SC-02、SC-06、SC-10、SC-11、SC-14、SC-15 的 Agent 与 Gate 路径通过，基线差异有分类证据。

## Task 4：迁移使用概况、Governance API 与 Token 业务活跃

**Files：**

- Modify: `webui/server/admin/governance-observability.ts`
- Modify: `webui/server/admin/agents.ts`（新增业务使用时间映射，与既有 `getLastUsedMap` 同居，供 Token 清单与 Agent 详情共用）
- Modify: `webui/server/admin/tokens.ts`
- Modify: `webui/src/pages/admin/GovernanceOverview.tsx`
- Modify: `webui/src/pages/admin/Tokens.tsx`
- Modify: `webui/src/lib/types.ts`
- Test: `webui/server/__tests__/admin-governance-observability.test.ts`
- Test: `webui/src/__tests__/admin-governance-observability.test.tsx`
- Test: `webui/src/__tests__/tokens-page.test.tsx`
- Create: `webui/server/__tests__/usage-governance.test.ts`（真实审计库上的 Governance 路径口径验收）

**Steps：**

- [x] `queryActiveAgentCount`、`queryActiveTokenCount`、`queryAgentWindowStats`、`queryTokenCallCounts` 改用共享 Default Usage 条件，保持 SQL 聚合与统一窗口。
- [x] `queryCallStats`、`queryP95LatencyMs`、`queryAgentP95LatencyMs`、`queryAgentTopDeniedReasons`、`queryHighDenialAgentCount` 全部使用同一 Default Usage 集合；overview 的 calls、结果率、平均延迟、P95、每 Agent 拒绝原因和高拒绝 Agent 数不得保留全量旁路，故障不得归零。
- [x] `/api/admin/governance/denials` 的 reason、tool、trend 改用 Default Usage，表访问来源仍读 `access_log_sources`；`/api/admin/governance/roles` 的审计派生 `usageCount` 改用全窗 SQL 默认用量聚合，配置用户计数不变，移除用量路径的 5000 行兼容截断。`matched_role_id` 单次拒绝归属只在 R1 路径守卫，不误植到 roles 响应。
- [x] Agent／Token 排行与对应活跃卡使用同一记录集合；活跃 Token 与“使用过的凭据”不得共用谓词。
- [x] Token 清单聚合最近 MCP 访问和最近业务使用两个时间；KPI 只按后者判定近 7 天业务活跃。**归属约定**：业务使用时间映射与既有 `getLastUsedMap` 同居 `server/admin/agents.ts`（如 `getLastBusinessUseMap`），由 `/api/admin/tokens` 与 Agent 详情共用，不得在两处各写一份；该映射按 Default Usage 过滤，`last_used` 继续表示最近 MCP 访问且不改变语义。
- [x] Token 页主标签改为“近 7 天业务活跃 Token”，帮助文案说明排除协议与默认视图排除的评测探针；`/admin/usage` 当前不渲染 calls／P95／ACL 卡片的既有布局及断言保持不变。
- [x] 保留历史日志身份与当前配置资产的人口边界；活跃率分子大于分母时继续 `partial`，不截断、不静默过滤历史事实。
- [x] 界面使用视图及其 `ui_page_views` 查询保持字节级语义不变。

> **T4 落盘说明（2026-10-27）**
>
> - **Governance 聚合全部改用 Default Usage**（`server/admin/governance-observability.ts`）：`queryCallStats`、`queryP95LatencyMs`、`queryActiveAgentCount`、`queryActiveTokenCount`、`queryHighDenialAgentCount`、`queryAgentWindowStats`、`queryAgentP95LatencyMs`、`queryAgentTopDeniedReasons`、`queryAgentActiveTokenCounts`、`queryActiveTokenPrefixes`、`queryTokenCallCounts`，以及 denials 的 reason／tool／trend。共享条件由 `defaultUsageConditionSql()` 生成，模块内不再有第二份名单。
> - **移除 5000 行兼容截断**：新增 `queryRoleUsageCounts()` —— 全窗口 SQL 聚合（`json_each` + `json_valid` 保护），roles 的 `usageCount` 不再经过 `recentAuditRows` 的 5000 行截断。`recentAuditRows`、`AuditRow`、`safeJsonArray` 与 `COMPAT_AUDIT_ROW_LIMIT` 常量一并删除；`compatTruncation.auditRowsLimit` 改为 `null`（如实表示"不再截断"），对应测试同步更新。
> - **Token 业务活跃**：`server/admin/agents.ts` 新增 `getLastBusinessUseMap()`（与 `getLastUsedMap` 同居但**独立**的来源，只取 Default Usage 行）；`server/admin/tokens.ts` 的 Token 清单同时给出 `last_used`（最近 MCP 访问）与 `last_business_use`（最近业务使用），**KPI「近 7 天业务活跃 Token」只按后者判定**。
> - **页面**：`/admin/tokens` 主标签改为「近 7 天业务活跃 Token」（帮助文案写明排除协议与评测探针），列表主时间改为最近业务使用，最近 MCP 访问降为技术上下文副行（并补 `translate="no"` 翻译防御）；`/admin/usage` 的 Agent／Token 卡片帮助文案改为业务活跃口径并说明人口边界。
> - **人口边界保持**（SC-16）：活跃分子可以大于当前配置分母（历史日志身份），此时 `agentActiveRatePartial = true` 且 `agentActiveRate = null`，**不截断、不静默过滤历史事实**。
> - **新增验收**（`server/__tests__/usage-governance.test.ts`，真实审计库）：overview 的 calls／denied／errors 与活跃 Agent／Token 只计 Default Usage；Agent 排行与 Token 排行同集合；denials 只计默认用量拒绝；roles 用量计数 = 55（评测探针的 2 行同角色但**不计入**）；活跃分子 21 > 配置分母 20 时进入 `partial`。
> - **夹具增强**：混合夹具新增 `role_ids` 绑定与 13 个已下线身份（`legacy_identity_*`），用于同时验证"评测探针不计入角色用量"与"活跃分子超分母 → partial"。
> - **全量回归记录**：T4 后连续三次全量跑，第 1 次有 2 个失败（`admin-roles`、`api.semantic-asset-export`）、第 2 次有 2 个失败（`admin-agents` 的 D4 用例、`display-permission-runtime`）、第 3 次**全绿**（349 文件 / 4202 通过 / 0 失败 / 1 expected-fail）。失败集合逐次不同且每次单独跑都通过，判定为**既有的并行负载敏感 flaky**（涉及 access 配置缓存 30s TTL 等时序因素），与本 Spec 的用量口径改动无关。T6 终检若遇到同类失败，必须**单独复跑确认**再判定，不得直接写成回归。


**Done when：** SC-01、SC-03、SC-04、SC-08～SC-10、SC-13～SC-16 在使用概况、Governance API 和 Token 路径通过。

## Task 5：迁移调用监控、访问日志、评测现场、访问关系图与治理证据

**Files：**

- Modify: `webui/server/proxy/audit.ts`
- Modify: `webui/server/admin/audit.ts`
- Modify: `webui/server/admin/access-map.ts`
- Modify: `webui/server/admin/reconciliation.ts`（协议／业务划分随协议集合扩大而改变，须登记并加回归断言）
- Modify: `webui/server/eval/monitor.ts`
- Modify: `webui/server/admin/risk-review.ts`
- Modify: `webui/server/admin/release-readiness-package.ts`
- Modify: `webui/server/admin/audit.ts`（CSV 字段元数据补 `prompts/list` 为 probe）
- Modify: `webui/src/pages/ops/CallMonitor.tsx`（仅必要文案）
- Modify: `webui/src/pages/eval/Monitor.tsx`（仅必要口径说明）
- Test: `webui/server/__tests__/call-monitor.test.ts`
- Test: `webui/server/__tests__/admin-audit.test.ts`
- Test: `webui/server/__tests__/r1-observability.test.ts`
- Test: `webui/server/__tests__/role-denial-comparison.test.ts`
- Test: `webui/server/__tests__/question-budget.test.ts`
- Test: `webui/server/__tests__/usage-default-view.test.ts`
- Test: `webui/server/__tests__/p1-access-map-conservation.test.ts`
- Test: `webui/server/__tests__/reconciliation.test.ts`
- Create: `webui/server/__tests__/eval-monitor-field.test.ts`
- Test: `webui/server/__tests__/eval-field-questions.test.ts`
- Test: `webui/server/__tests__/admin-risk-review.test.ts`
- Test: `webui/server/__tests__/admin-release-readiness-package.test.ts`
- Test: `webui/src/__tests__/call-monitor.test.tsx`
- Test: `webui/src/__tests__/monitor.test.tsx`
- Test: `webui/src/__tests__/audit.test.tsx`
- Test: `webui/src/__tests__/admin-audit-turns.test.tsx`

**Steps：**

- [x] `readCallMonitorSnapshot` 读取分类所需字段，并让所有 KPI、折线、工具排行、最近失败与拒绝共享同一 Default Usage 集合。
- [x] `readR1AuditObservability` 以当前 8 方法加探针排除实现为参考迁入共享模块，删除本地协议集合和重复默认用量判断，保持现有 Actor 与 Role 拒绝口径；运行 `role-denial-comparison.test.ts` 和 `question-budget.test.ts`，确认 `matched_role_id` 单次归属及 Actor 分组不回归。**评测探针必须改为"先分类再拆分"**：用共享模块的分类结果判定 `class == EVAL_PROBE`，不得沿用现有 `defaultUsageExcluded(...) && !protocolTools.has(row.tool)` 的二次反推——该式用 3 元素协议集排除，会把 `ping`、`resources/list`、`resources/templates/list`、`server/discover`、`notifications/cancelled` 误计为评测探针，与 SC-12 的四类可区分要求冲突。
- [x] 访问日志改用协议全集 SQL 条件。**必须覆盖 `admin/audit.ts` 的全部 4 处协议名单消费点，不止默认筛选**：默认流水筛选、turn-scoped 调查回捞协议行、数据承载调用统计、审计汇总的 `protocol_calls`／`business_calls`／`data_bearing_calls`。其中审计汇总的 `business_calls` 若仍按 3 方法名单计算，会继续把协议事件计成业务调用，直接违反 §6 同页同口径。`includeProtocol=true`、调试台来源和 turn-scoped 调查继续返回所需原始记录，`/api/observability/logs` 保持 Raw Audit 检索与脱敏行为。
- [x] 将 `audit.ts` 的 `PROBE_TOOLS` / `HANDSHAKE_TOOLS` 改为从共享模块导入或派生，保留 Spec 172／173 的纯探测不形成问询语义但删除名单副本；`prompts/list` 不独立形成问询，`resources/read`、`prompts/get` 作为真实业务内容读取处理，评测探针仍不因默认用量排除而删除真实问询。
- [x] 登记并回归 `server/admin/reconciliation.ts` 的协议／业务划分：该文件派生自协议名单，协议集合扩大后 `ping`、`resources/list` 等会从 `tool_call` 翻转为 `protocol_request`，对账输出的"协议事件不进入业务问询分母"计数随之上升。须在 `reconciliation.test.ts` 增加断言，锁定划分符合共享分类，且 `resources/read`、`prompts/get` 仍归 business。
- [x] `/api/eval/monitor/field` 改用 Default Usage Call，calls、errors、denies 和比率共享同一集合；保持 domain 绑定 Role 的人口、client family、空态、黄线／红线不受影响，并补协议及评测探针对照 API 测试。
- [x] 访问关系图的授权面、`access_log_sources` 主体、调用 ID 去重和守恒算法不改；只把 Token 清单窗口调用改为 Default Usage。
- [x] Risk Review 的高拒绝风险输入使用 Raw Business，保留真实评测业务调用的风险贡献和原始证据；Release Readiness 的调用、拒绝与就绪用量使用 Default Usage，原始附件和日志引用保持完整。两者分别补协议与探针对照，不共用错误层级。
- [x] 检查 CSV／证据包 Manifest 的协议包含说明与实际筛选一致；原始导出不得被默认用量过滤静默截断。

> **T5 落盘说明（2026-10-27）**
>
> - **调用监控**（`server/proxy/audit.ts`）：`readCallMonitorSnapshot` 的 SELECT 增加 `eval_mark`／`args_summary`，`businessRows` 改用共享 `classifyUsage(...) === "default_usage"`。所有 KPI、24 个折线桶、工具排行、最近失败与最近拒绝**共用同一集合**。
> - **评测现场**（`server/eval/monitor.ts`）：`/api/eval/monitor/field` 改用 `defaultUsageConditionSql()`；domain 绑定的 Role 人口、client family 聚合、空态与黄线／红线不变。T1 留下的 `it.fails` 目标断言已转为普通断言并补两条反向断言（被排除的行**仍留在原始审计库**、Role 人口不变）。
> - **访问关系图**（`server/admin/access-map.ts`）：只把**凭证清单的窗口调用数**改为 Default Usage；授权面、`access_log_sources` 访问主体、调用 ID 去重与守恒算法未动。
> - **治理证据**：`admin/risk-review.ts` 的高拒绝风险输入用 **Raw Business**（协议排除、真实评测业务调用仍计入风险贡献），且用条件聚合实现，`last_seen`／`last_used`／`active_tokens` 等「最近 MCP 访问」字段**不被用量口径过滤**；`admin/release-readiness-package.ts` 的业务调用、拒绝与就绪用量用 **Default Usage**，原始附件与日志引用保持完整。
> - **证据包自述口径**：release readiness 的 Markdown 证据包新增「Usage evidence scope: Default Usage Calls…」一行，`KNOWN_LIMITATIONS` 同步登记该边界。
> - **CSV 字段元数据**：审计 CSV 的 `transport_sub_type` 说明补上 `prompts/list`（它现在是 probe，与实际分类一致）。
> - **新增断言**：`call-monitor.test.ts` 新增用例 —— 10 个协议方法（`initialize`／`notifications/initialized`／`tools/list`／`ping`／`resources/list`／`resources/templates/list`／`prompts/list`／`notifications/cancelled`／`server/discover`／`server/unknown`）+ 1 个显式评测探针 + 1 个真实业务调用，结果只有业务调用进入 KPI、折线、工具排行与最近失败。
> - **顺带修复**：`admin-risk-review.test.ts` 的审计 mock 按 SQL 文本匹配 `COUNT(*) AS calls`，风险输入改成条件聚合后匹配失效（候选集为空）；改为按结果形态（`AS calls` + `AS active_tokens`）匹配。
> - **顺带修复（夹具对齐列契约）**：`p1-access-map.test.ts`（2 处）、`p1-access-map-contract.test.ts`、`p1-access-map-conservation.test.ts` 自建的是**精简 `access_log` schema**（没有 `tool`／`eval_mark`／`args_summary`）。共享的 Default Usage 条件需要这三列（生产库由 `ACCESS_LOG_COLUMNS` 迁移保证存在），精简夹具因此报 `no such column` 并让整个 provider 退化为 `unavailable`。已把三列补进夹具 schema（`tool` 默认 `lucy_query`，其余可空），4 个用例恢复。
> - **T5 终检**：全量 `349 文件 / 4205 通过 / 0 失败 / 0 expected-fail`（T1 留下的最后一个 `it.fails` 已在 T5 随评测现场落地一并转为普通断言）；`lint:terminology`、`lint:ia-boundary`、`npm run build` 全通过；`tsc --noEmit` 仍为改动前基线的 68 处同一集合，本次文件 0 新增。
> - **全量回归记录（T5）**：连续多次全量跑，失败集合**逐次不同**且每次单独跑都通过（已逐个单独复跑确认，含本轮改动过的 `admin-risk-review` 与 `admin-tokens`，前者连跑 3 次全过）。涉及 `admin-roles`、`api.semantic-asset-export`、`admin-agents` 的 D4 用例、`display-permission-runtime`、`admin-risk-review` 的 reviewerId、`admin-tokens` 的 DELETE gate。共同点是**都走审计库 / Access Governance Gate / 展示权限链路**，且仓库自身的 `test/setup.ts` 已记录"测试文件共享进程、环境变量会串"这一结构性风险。判定为**既有的并行负载敏感 flaky**，与本 Spec 的用量口径改动无关；T6 终检必须逐个单独复跑确认后再判定。


**Done when：** SC-04、SC-05、SC-07～SC-10、SC-17 通过，访问关系守恒、审计原始性、现场 Role 边界和治理证据层级无回归。

## Task 6：跨页对账、文档同步与交付验证

**Files：**

- Create: `webui/server/__tests__/usage-metrics-cross-page.test.ts`
- Modify: `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md`（仅填写真实验证记录与状态）
- Modify: `webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md`（勾选实际完成项）
- Modify: `CHANGELOG.md`（记录旧字段数值迁移、高流量输入和下游看板注意事项）
- Modify: `webui/docs/README.md`、`webui/docs/plans/README.md`（仅按真实结果更新状态）

**Steps：**

- [x] 用同一审计夹具分别请求 Agent、Governance overview／agents／tokens／denials／roles、Token、Call Monitor、R1、Audit、Eval Field、Access Map、Risk Review 和 Release Readiness API，核对 SC-01～SC-17，而非只验证各模块自己的理想输入。
- [x] 明确断言允许不同的原因只剩记录层级与人口边界：Default Usage、Raw Business、Raw Audit、真实表访问，以及当前配置资产／历史日志身份；不得用“页面定义不同”掩盖同层指标差异。
- [x] 检查全部旧字段消费者，确认没有新 UI 继续读取 `callsLast7d` 或 `businessCallsLast7d` 冒充 Default Usage 活跃或业务调用；旧客户端兼容字段仍按约定返回。
- [x] 检查 KPI 注册表、术语、翻译防御、`null/partial/unavailable` 渲染及 API 兼容响应；保留 `/admin/usage` 已移除 calls／P95／ACL 卡片的断言。
- [x] 对照 T1 基线解释每个数值变化，并在 `CHANGELOG.md` 明确 `businessCallsLast7d` 可能下降、`protocolCallsLast7d` 可能上升、高流量计数可能下降及下游阈值注意事项。
- [x] 先确认 Node 与 `better-sqlite3` ABI 匹配；若不匹配，记录环境阻断并修复测试环境后执行，不将 SQLite 测试跳过写成通过。
- [x] 运行相关测试、术语 lint 和构建；按实际结果填写 Spec 验证记录，未执行项保持未验收。
- [x] 把 T1 留下的目标断言从 `it.fails(...)` 转为普通 `it(...)`：逐条确认目标行为已实现（转红即未实现），删除夹具中的 `LEGACY_PROTOCOL_METHODS_BEFORE_SPEC_189` 与基线断言块，并把 `usage-baseline.test.ts` 的基线数字改写为迁移后的目标值。

> **T6 落盘说明（2026-10-27）**
>
> - **跨页对账**（新建 `server/__tests__/usage-metrics-cross-page.test.ts`，8 条）：同一套混合夹具、真实审计库，逐个请求 Agent／Governance overview・agents・tokens／Token／Call Monitor／Eval Field／Release Readiness／Audit 等表面，核对 SC-01～SC-17，并断言**允许不同的原因只剩记录层级与人口边界**：
>   - Default Usage 层（全量身份）= **73**：Governance overview `usageOverview.calls` == 调用监控 `traffic.businessCalls`；
>   - Default Usage 层（当前配置资产）= **59**：Governance Agent 排行 == Agent API `Σ usageCallsLast7d` == Governance Token 排行 == 发布就绪 `Σ callsLastWindow`；
>   - Raw Business 层 = Default Usage + 2（评测探针）：审计默认视图 75 == overview 73 + 2；配置资产口径 61 == 59 + 2；
>   - Raw Audit 层 = Raw Business + 12（协议事件）：`includeProtocol=true` 87；
>   - 人口边界：全量身份 73 − 配置资产 59 = **14**（历史／未配置身份的行仍在审计里，但不是当前资产）；`/admin/usage` 活跃分子 21 > 配置分母 20 → `agentActiveRatePartial = true` 且费率为 `null`。
> - **旧字段消费者排查**：`src/` 全量检索 `callsLast7d` / `businessCallsLast7d` —— 新 UI 只读 `usage*`；`AgentList.tsx` 中剩余的旧字段引用全部在 `summarizeAgents` 的**兼容路径**内（旧响应缺 `usage*` 时返回 `null` 而非伪造 0），不再用于任何默认用量展示。服务端 `businessCallsLast7d` 的唯一生产消费点是 Access Governance Gate 输入（按 Spec 固定为 Raw Business）。
> - **遗留清理**：夹具中的 `LEGACY_PROTOCOL_METHODS_BEFORE_SPEC_189` 与"改动前基线断言块"已删除，`usage-baseline.test.ts` 改为断言**迁移后**的目标值；仓库内已无 `it.fails`。
> - **环境核验**：Node `v24.14.1` + `better-sqlite3@12.11.1`，原生绑定可加载并实际执行 SQL（`node -e` 建表插入计数通过），**ABI 匹配**，SQLite 断言均为真实执行，无跳过。
> - **CHANGELOG**：已登记协议集合扩展、受影响页面、`businessCallsLast7d` 可能下降 / `protocolCallsLast7d` 可能上升 / 高流量计数可能下降，以及「原始日志不改写、最近 MCP 访问与使用过的凭据保持全量语义、不可用为 `null`」的不变量。
> - **终检**：**独占运行**的全量 `350 文件 / 4212 通过 / 0 失败`（含新增跨页对账文件）；`lint:terminology`、`lint:ia-boundary`、`npm run build` 全通过；`tsc --noEmit` 与改动前基线同一集合（68 处），本次文件 0 新增。
> - **全量跑的既有 flaky（必须照实记录）**：T6 阶段多次全量跑，失败数为 0–3 个不等，**集合逐次不同**（`display-permission-runtime`、`admin-audit` 的 generatedSql 用例、`api.semantic-assets.reindex`、`admin-tokens` 的 DELETE gate、`admin-risk-review` 的 reviewerId、`admin-roles` 的 override 用例等），且**每一个单独复跑都通过**（本轮改动过的 `admin-audit` 连跑 3 次、`admin-tokens` 连跑 4 次均全过）。共同点是都走审计库 / Access Governance Gate / 展示权限链路，仓库 `test/setup.ts` 已记录"测试文件共享进程、环境变量会串"的结构性风险。**判定：既有的并行负载敏感 flaky，与本 Spec 的用量口径改动无关**；T6 终检若遇同类失败必须单独复跑确认，不得写成回归。
>
>   **根因（已定位到具体机制）**：这些用例都写**固定路径**的产物 —— 例如发布就绪证据包固定写 `inbox/202608-governance-release-readiness.md`（`server/admin/release-readiness-package.ts:881`），`resolveProjectRoot()` 在 `KTX_PROJECT_ROOT` 未设置时回落到仓库根目录，于是**并行跑的多个 vitest 进程会写同一个文件**；仓库 `test/setup.ts` 也已记录"测试文件共享进程、环境变量会串"的结构性风险。**独占运行**（不与其它 vitest 进程并发）的全量跑为 `350 文件 / 4212 通过 / 0 失败`。本次审阅中曾因我在后台全量跑的同时又单独跑该文件，复现过一次同源失败 —— 这是并发造成的，不是实现缺陷。**不得保留任何 `it.fails` 交付。**

**Done when：** SC-01～SC-18 均有执行证据，其中 SC-18 的术语、KPI 契约、前后端测试与构建全部实际通过；文档状态与结果一致。

**建议验证命令：**

```bash
cd webui
npx vitest run --maxWorkers=1 \
  server/__tests__/usage-classification.test.ts \
  server/__tests__/usage-metrics-cross-page.test.ts \
  server/__tests__/mcp-request-classification.test.ts \
  server/__tests__/mcp-admission-all-methods.test.ts \
  server/__tests__/audit-trust/audit-trust-classification.test.ts \
  server/__tests__/admin-agents.test.ts \
  server/__tests__/access-governance-gate.test.ts \
  server/__tests__/admin-governance-observability.test.ts \
  server/__tests__/call-monitor.test.ts \
  server/__tests__/admin-audit.test.ts \
  server/__tests__/r1-observability.test.ts \
  server/__tests__/role-denial-comparison.test.ts \
  server/__tests__/question-budget.test.ts \
  server/__tests__/usage-default-view.test.ts \
  server/__tests__/p1-access-map-conservation.test.ts \
  server/__tests__/reconciliation.test.ts \
  server/__tests__/eval-monitor-field.test.ts \
  server/__tests__/eval-field-questions.test.ts \
  server/__tests__/admin-risk-review.test.ts \
  server/__tests__/admin-release-readiness-package.test.ts

npx vitest run --maxWorkers=1 \
  src/__tests__/kpi-contracts.test.ts \
  src/__tests__/agent-list.test.tsx \
  src/__tests__/agent-detail.test.tsx \
  src/__tests__/object-detail-drawer.test.tsx \
  src/__tests__/tokens-page.test.tsx \
  src/__tests__/admin-governance-observability.test.tsx \
  src/__tests__/call-monitor.test.tsx \
  src/__tests__/monitor.test.tsx \
  src/__tests__/audit.test.tsx \
  src/__tests__/admin-audit-turns.test.tsx

npm run lint:terminology
npm run build
```

**默认不做：** 浏览器测试、移动窄屏测试、Docker 重建和客户包发布。只有用户另行明确要求时才加入对应验证。

## SC 验收映射表（T1 固化）

每条 SC 必须有**具体测试文件 + 可执行断言**。`it.fails` 表示目标行为尚未实现（套件仍绿，实现落地后转红）；`—` 表示尚未建立验收入口，**不得**在 T6 前标记为已验收。

| SC | 验收入口（测试文件） | 断言要点 | 状态 |
|---|---|---|---|
| SC-01 | `server/__tests__/usage-baseline.test.ts`、`server/__tests__/usage-governance.test.ts` | 9 个协议方法 + `server/unknown` 各自的协议专属 Agent；目标 `usageCallsLast7d = 0`，`/admin/usage` 活跃 Agent 为 0 | ✅（T3 字段层 + T4 usage-overview 活跃 Agent 只计默认用量） |
| SC-02 | `server/__tests__/usage-baseline.test.ts` | `usageCallsLast7d=0`、`usageActiveAgentCountLast7d=0`、协议请求数上升；最近 MCP 访问更新、最近业务使用不更新 | ✅（T3：字段落地 + 协议专属 Agent 目标断言 + 业务活跃集合排除协议／探针 Agent） |
| SC-03 | `src/__tests__/tokens-page.test.tsx`、`server/__tests__/admin-tokens.test.ts`、`server/__tests__/usage-governance.test.ts` | 业务活跃 Token=0；最近 MCP 访问可更新但不得据此判定业务活跃 | ✅（T4：Token KPI 改按最近业务使用判定；最近 MCP 访问独立保留） |
| SC-04 | `server/__tests__/call-monitor.test.ts`、`server/__tests__/admin-governance-observability.test.ts`、`server/__tests__/usage-governance.test.ts` | 调用量为 0；比率／延迟／P95／每 Agent 拒绝原因／高拒绝 Agent 数不出现协议或探针构造的分子分母 | ✅（T4 Governance 侧 + T5 `/ops/calls`：10 个协议方法 + 显式评测探针 + 1 个业务调用 → 只有业务调用进入 KPI／折线／工具排行／最近失败） |
| SC-05 | `server/__tests__/admin-audit.test.ts`、`server/__tests__/observability.test.ts` | 默认流水不含协议全集；`includeProtocol=true` 与调试台仍可见；`/api/observability/logs` 不过滤 | ✅（T2 迁移 4 处协议消费点 + T5 复核：`server/discover` 默认隐藏、`includeProtocol=true` 全部可见、导出包仍含握手行） |
| SC-06 | `src/__tests__/object-detail-drawer.test.tsx` | 抽屉读 `usageCallsLast7d`，不再显示全量 `callsLast7d` | ✅（T3） |
| SC-07 | `server/__tests__/p1-access-map-conservation.test.ts`、`server/__tests__/p1-access-map.test.ts`、`server/__tests__/p1-access-map-contract.test.ts` | Token 窗口调用不累计纯协议记录；真实表访问路径与原始调用守恒不因本修复改变 | ✅（T5：只改凭证清单窗口调用数；授权面／`access_log_sources` 主体／去重／守恒算法未动） |
| SC-08 | `server/__tests__/eval-monitor-field.test.ts`、`server/__tests__/usage-baseline.test.ts`、`server/__tests__/usage-governance.test.ts`、`server/__tests__/admin-risk-review.test.ts`、`server/__tests__/admin-release-readiness-package.test.ts` | 探针退出所有默认用量 KPI；仍可在原始审计、导出、问询关联、风险治理 Raw Business 输入与真实表访问中查到 | ✅（T4 Governance 路径 + T5 评测现场／治理证据：探针不进默认用量，但 Risk Review 的 Raw Business 风险输入**仍计**其风险贡献；被排除的行仍留在原始审计库） |
| SC-09 | `server/__tests__/usage-baseline.test.ts`、`server/__tests__/usage-classification.test.ts` | 仅名称命中未标记的调用仍进默认用量；不得凭 UA／`token_label`／`actor_kind` 排除 | ✅ |
| SC-10 | `server/__tests__/usage-baseline.test.ts`、`server/__tests__/access-governance-gate.test.ts` | `ok/error/denied` 均形成业务活跃并分入正确指标；协议不进入任何一项；Gate 只排除协议、仍计评测业务调用，保持 P1 `warn` 与原阈值 | ✅（T3 追加门禁端到端：dryRun PATCH 下协议／探针 Agent 不触发，51 次调用触发 P1 `warn`） |
| SC-11 | `server/__tests__/usage-baseline.test.ts` | `calls = business + protocol`、`business = usage + evalProbe`；基线差异可由分类迁移解释 | ✅（T3：`usage*` 字段落地，两条恒等式在 Agent API 与 summary 上均已断言） |
| SC-12 | `server/__tests__/usage-classification.test.ts`、`server/__tests__/usage-mixed-fixture.ts` | 11 个准入方法穷尽分类且新增方法失败；TS 与 SQLite 对同一夹具输出一致 | ✅（T2：覆盖矩阵 + 分类优先拆分 + 计数一致 + 非法 args 容错 + integer eval_mark 归一） |
| SC-13 | `server/__tests__/usage-classification.test.ts`、`server/__tests__/usage-governance.test.ts` | >5000 条窗口记录仍完整排除；roles 不经 5000 行限流器 | ✅（T2 5200 条不分页 + T4 roles 改全窗口 SQL 聚合，`compatTruncation.auditRowsLimit = null`） |
| SC-14 | `server/__tests__/usage-baseline.test.ts`（碰撞 `partial`）、`server/__tests__/admin-governance-observability.test.ts`（`unavailable`） | 不可用 → `null`；碰撞 → `partial`；均不渲染成 0 | ✅（T3 Agent 侧 + T6 Governance 侧：审计库不可用时 `calls`／`denied`／`errors`／`p95`／`avg`／活跃 Agent／活跃 Token／活跃表／高拒绝 Agent 数全部为 `null`，`metricsState = "unavailable"`，无一被折成 0） |
| SC-15 | `src/__tests__/kpi-contracts.test.ts`、`src/__tests__/agent-list.test.tsx` | 最近 MCP 访问可晚于最近业务使用；使用过的凭据可多于业务活跃 Token；不混称；D4 锚点不丢 | ✅（T3：Token「最近 MCP 访问」＋凭据卡保持全量访问口径） |
| SC-16 | `server/__tests__/usage-baseline.test.ts`、`server/__tests__/usage-governance.test.ts` | 历史 Agent／Token 与当前配置资产的差异符合 §6；活跃率 >100% 仍 `partial` | ✅（T4：活跃分子 21 > 配置分母 20 → `agentActiveRatePartial = true` 且费率为 `null`） |
| SC-17 | `call-monitor`、`p1-access-map-conservation`、`admin-risk-review`、`admin-release-readiness-package`、`role-denial-comparison`、`question-budget`、`eval-monitor-field` | 24h／7d、四种调用监控窗口、三种访问关系图窗口、导出筛选不回归；Risk Review 用 Raw Business、Release Readiness 用 Default Usage；Role 拒绝归属与现场 Role 边界不变 | ✅（T5：调用监控与访问关系图窗口行为回归通过；两个治理证据端点分别锁定 Raw Business / Default Usage；Role 拒绝归属与现场 Role 边界用例通过） |
| SC-18 | T6 执行：`npm run lint:terminology`、`kpi-contracts`、全部相关前后端测试、`npm run build` | 未执行项不得标记为已验收 | ✅（T6：术语 lint 997 文件通过、IA lint 通过、build 通过、全量 349 文件 / 4205 通过 / 0 失败、`tsc` 与基线同一集合；Node v24.14.1 + better-sqlite3 12.11.1 ABI 匹配，SQLite 断言真实执行） |

## 最终交付门禁

- [x] SC-01～SC-18 均有执行结果和证据，失败项未被删除或改写为宽松断言。
- [x] 协议专属 Agent 在所有默认用量页面均为不活跃，原始协议日志仍可审计；`resources/read`、`prompts/get` 真实内容读取未被误排除。
- [x] 默认用量排除评测探针，但原始业务审计、问询关联、风险治理 Raw Business 输入与真实表访问事实仍完整。
- [x] 不存在可独立漂移的同语义协议名单或另一套默认用量判断；握手、准入等不同语义集合有明确边界，11 个准入方法分类覆盖完整。
- [x] 无 5000 条截断、无全窗 JavaScript 物化、无故障归零。
- [x] 旧 API 字段仍可用且数值迁移已发布，新 UI 不消费全量或 Raw Business 字段冒充 Default Usage，高流量 Gate 保持 Raw Business 与 P1 `warn`。
- [x] 不存在遗留的 `it.fails` 目标断言与 `LEGACY_PROTOCOL_METHODS_BEFORE_SPEC_189` 历史基线常量。
- [x] 文档状态、测试记录和实际执行结果一致。
