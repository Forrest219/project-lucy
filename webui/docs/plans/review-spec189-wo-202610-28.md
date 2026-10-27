# Spec 189 / WO-202610-28 Cross-Review — Reviewer Notes (2026-10-26)

> **作者**: Mavis（MiniMax Code 交叉审阅；页面覆盖盘点由只读子任务并行执行）
> **审阅对象**: `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` v1.0 + `webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md`
> **状态**: 🔴 3 条 / 🟡 4 条 / 🟢 4 条
> **结论**: **CONDITIONAL FAIL** — 方向正确、诊断属实，但需先修 3 个阻断项再开工

> ⚠️ **本文件含两轮审阅记录**。上方为 v1.0 首轮审阅（结论 CONDITIONAL FAIL），下方
> [「复审：Spec 189 v1.1 + WO-202610-28（2026-10-27）」](#复审spec-189-v11--wo-202610-282026-10-27)
> 为 v1.1 复审（结论 **PASS**，已批准实施）。首轮记录按"不删除历史决策记录"原则原样保留。

---

## TL;DR

- **CONDITIONAL FAIL**：Spec 189 的三层口径模型（Raw Audit → Raw Business → Default Usage）选对了，目标协议集合也选对了，**虚高诊断经逐条代码复核全部属实**。但存在 3 个会直接影响实现一致性或验收可跑性的 blocker。
- 🔴 1：§4.2 的"协议事件全集"不完整 —— 网关实际放行 11 个 JSON-RPC 方法，Spec 只覆盖 8 个 + `server/*`；`prompts/list`／`prompts/get` 属纯发现行为，按 §4.2 会算作**业务调用**，与 Spec 自己的 §2.1 目标直接矛盾。
- 🔴 2：`/api/admin/governance/overview` 的 `calls`／`p95LatencyMs`／`avgLatencyMs`／每 Agent P95／每 Agent 拒绝原因未进入 §5.3 的口径裁决，留下一套"同窗口、语义相反"的调用量。
- 🔴 3：KPI 契约注册表 `webui/src/lib/kpiContracts.ts` 在两份文档里**完全没出现**。它当前写的"活跃 Agent = 访问日志出现过的去重 Agent 数"等 5 条 help 文案在新口径下变成假话，且它是 `lint:terminology` 与 `kpi-contracts.test.ts` 的守卫点 —— **这是最可能让 WO-202610-28 在 T6 卡住的一条**。
- ✅ 全部 25 个声明文件路径、8 份上游 Spec、全部具名符号均核实存在，**无虚构引用**。

---

## 零、已核实的现状基线（原问题的答案）

原任务问"有几个页面有用量统计、当前规则是什么、是否虚高"。本次审阅把这条基线逐条复核过，结论如下。**"虚高"判定来自 SQL／读路径证据，未运行应用取真实数字。**

### 0.1 有用户可见用量统计的表面：10 个（Spec 列出 9 个，漏 1 个）

| # | 表面 | 当前统计规则 | 证据 | 虚高 |
|---|---|---|---|---|
| 1 | `/admin/usage` 数据访问视图 | 活跃 Agent／Token／表 = 全量 `access_log` 去重计数，无任何协议过滤 | `admin/governance-observability.ts:286-292`、`:303-308`、`:316-330` | **是** |
| 2 | `/admin/usage` Agent／Token 排行 | 全量行计数 | 同上 `:428-441`、`:595-601` | **是** |
| 3 | `/admin/usage` 界面使用视图 | `ui_page_views`，与 MCP Agent 无关 | `admin/ui-usage.ts` | 否（口径不同，非缺陷） |
| 4 | `/admin/agents` | 调用量／活跃筛选用 `tool NOT IN (3 方法)`；`active_tokens`／`last_seen`／Token last-used **无过滤** | `admin/agents.ts:312-317`、`:315-317`、`:427-444` | **部分**（调用量是，Token 活跃是） |
| 5 | `/admin/agents/:userId` | API 返回 `agent.stats`，**页面不渲染任何用量统计** | `admin/agents.ts:1346`；`src/pages/admin/AgentDetail.tsx` | API 是／页面无 |
| 6 | `/admin/tokens` | "近 7 天活跃"由 `last_used` 判定，取每 token 最新行，**不看 tool** | `admin/agents.ts:427-444`（`getLastUsedMap`） | **是**（纯握手 token 显示"已使用"） |
| 7 | `/admin/audit` | 默认流水排除协议事件，但只用 3 方法名单 | `admin/audit.ts:256-260` | **是**（`ping`／`resources/*` 泄漏） |
| 8 | `/ops/calls` | 只排除 3 方法，**且完全不套用 eval 探针排除** | `proxy/audit.ts:1428-1431` | **是**（含探针） |
| 9 | `/admin/access-map` | 授权面／访问路径按 `access_log_sources` 关联，隐式不含协议；但**凭证明细的窗口调用数**统计全量 | `admin/access-map.ts:1915-1920` | **是**（凭证明细） |
| 10 | Agent 对象详情抽屉 | "近 7 天调用"直接读全量 `callsLast7d` | `src/components/ObjectDetailDrawer.tsx:246` | **是**（最 blatant 的一处） |
| **11** | **`/eval/monitor` "现场"面板** | 按 client family 统计 calls／errors／denies，**无协议过滤、无 eval 过滤** | `server/eval/monitor.ts:259-263` | **是 —— Spec 完全遗漏** |

另有 5 个**仅 API、无 WebUI 消费方**的同类聚合端点，同样无协议过滤：`/api/admin/governance/denials`（`governance-observability.ts:1026-1061`）、`/api/admin/governance/roles`（`:973`，且经 `COMPAT_AUDIT_ROW_LIMIT` 截断）、`/api/admin/governance/risk-review`（`risk-review.ts:172-180`、`:423-428`）、`/api/admin/governance/release-readiness-package`（`:216-222`、`:444-469`）、`/api/observability/logs`（`observability.ts:571`）。

### 0.2 代码库现存 9 套协议／探针词表（漂移已实际发生）

| | 位置 | 成员 | 用途 |
|---|---|---|---|
| A | `proxy/mcp-request-classification.ts:6-10` | 3 个 | 唯一的 SQL 级排除，供 `admin/agents.ts`、`admin/audit.ts`、`admin/reconciliation.ts` |
| B | `proxy/audit-classification.ts:101-105` | A[0..2]（**下标推导**） | 推导 `transport_sub_type=handshake` |
| C | `proxy/audit-classification.ts:107-112` | 4 个 probe | `transport_sub_type=probe` |
| D | `proxy/audit-classification.ts:147` | 内联 `server/*` | `transport_sub_type=unknown_method` |
| E | `proxy/question-experience.ts:27-36` | 8 个 | **← Spec §4.2 的目标集合** |
| F | `proxy/audit.ts:1827-1833` | 5 个 | Spec 172／173 问询规则 |
| G | `proxy/audit.ts:1835` | 3 个 | 同上 |
| H | `proxy/admission.ts:28-40` | **11 个** | 网关放行的 JSON-RPC 方法全集 |
| I | `proxy/mcp-request-classification.ts:19-21` | 由 A 派生 | SQL 字面量列表 |

Spec 的诊断（"不统一""各自补 `NOT IN`"）**属实且比预期更严重**。

---

## 🔴 必须改

### 🔴 1. §4.2 的"协议事件全集"不完整，且与 Spec 自己的 §2.1 目标矛盾

**位置**: Spec 189 §4.2（协议事件全集，lines 90-111）、§2.1（目标 1，line 59）

**证据**:

网关放行的 JSON-RPC 方法全集是 11 个 —— `webui/server/proxy/admission.ts:28-40`：

```ts
const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "ping",
  "notifications/initialized",
  "notifications/cancelled",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",     // ← Spec §4.2 未覆盖
  "prompts/list",       // ← Spec §4.2 未覆盖
  "prompts/get"         // ← Spec §4.2 未覆盖
]);
```

Spec §4.2 只列了 8 个具名方法 + `server/*` 前缀规则。

**问题**:

1. `prompts/list` / `prompts/get` 是**纯发现行为**。Spec §2.1 目标 1 写的是"任一 Agent 只有连接、重连、握手、**工具发现**、资源探测或服务发现时，不被任何'业务活跃'或'业务调用量'指标判为活跃"。按 §4.2，这两个方法会落入 Default Usage Call → **一个只做 prompt 发现的 Agent 会被判为"业务活跃"**。这正是 Spec 要消灭的那类虚高，只是换了个方法名。
2. `resources/read` 需要单独裁决：它是真实的数据读取行为，但不属于 `lucy_*` 业务工具语义，算不算"业务调用"目前无口径。
3. Spec §4.2 的小节标题是"**全集**"，但实际不全集 —— 而"唯一事实源"上线第一天就漏，会立刻产生 Spec 本身要防的那种漂移（`admission.ts` 的 H 名单与共享模块各说各话）。

**建议**:

- §4.2 补入 `prompts/list`、`prompts/get`；
- `resources/read` 明确归类：建议列入协议全集（它是资源枚举／读取的协议层行为，不是 Lucy 业务工具调用），或明确写"视为 Raw Business Tool Call"并给出理由；
- §4.2 增加一句约束：**协议全集必须与 `admission.ts` 的 `ALLOWED_RPC_METHODS` 对齐**，并在 Task 2 增加一条断言（新增 JSON-RPC 方法时两处必须同步），否则 H 名单会成为第 10 套漂移源。

---

### 🔴 2. `/api/admin/governance/overview` 的 calls／P95／拒绝原因未进入 §5.3 的口径裁决

**位置**: Spec 189 §5.3（Token 与 Governance API，lines 173-179）

**证据**:

§5.3 只列了 `activeAgentCount`、`activeTokenCount` 和排行 `calls` 改用 Default Usage Call。但同一份 API 还暴露以下**无条件计数**的字段：

| 字段 | 产生位置 | 当前口径 |
|---|---|---|
| `usage.calls` / `usage.denied` / `usage.errors` / `usage.avgLatencyMs` / `usage.errorRate` / `usage.deniedRate` | `admin/governance-observability.ts:230-238`（`queryCallStats`） | `COUNT(*)` 全量 |
| `usage.p95LatencyMs` | `admin/governance-observability.ts:259-280`（`queryP95LatencyMs`） | 全量行 P95 |
| 每 Agent `avgLatencyMs` / `p95LatencyMs` | `:452-492`（`queryAgentP95LatencyMs`） | 全量行 P95 |
| 每 Agent 拒绝原因 Top1 | `:494-526`（`queryAgentTopDeniedReasons`） | 全量 `outcome='denied'` |

这些字段在 `governance-observability.ts:883-886`、`:901-917` 进入 API 响应。

**问题**:

修复后 `/admin/usage` 会同时存在两套同窗口、语义相反的调用量：活跃数排除协议流量，总调用量／P95 仍包含。这**直接违反 Spec 自己在 §6 的跨页对账原则**："同一页面、同一窗口、同一人口集合内，活跃数、调用量和排行必须使用同一 Default Usage Call 集合"（Spec line 197）。也违反 §1 开篇要消灭的"同一日志在不同页面得到不同业务结论"。

不裁决的后果不是"少修一个页面"，而是**新引入**一处口径分裂 —— 讽刺的是比现状更糟，因为现状是"全部虚高"（至少自洽），修完会变成"一半真一半假"。

**附带事实**（降低 UI 冲击面，但不改变 API 结论）: `/admin/usage` 目前**刻意没有**渲染调用量／P95／ACL 拒绝次数卡片 —— `src/__tests__/admin-governance-observability.test.tsx:175-181` 明确断言 `metric-calls` / `metric-p95-latency` / `metric-acl-denied` / "多数请求耗时" **不存在于文档中**，页面改为链到 `/ops/calls`。所以 UI 侧影响小，但 API 字段与 KPI 契约的冲突是真的（见 🔴 3）。

**建议**:

§5.3 显式裁决以下二选一，并写进 §7 伪代码：

- **(a) 跟随 Default Usage Call**（推荐，与 Spec 全文口径一致）：`queryCallStats` / `queryP95LatencyMs` / `queryAgentP95LatencyMs` / `queryAgentTopDeniedReasons` 全部套用共享默认用量条件；则 §5.3 需补写这 4 个函数的改动，并补 SC 断言。
- **(b) 明确保留为全量原始诊断**：则在 §5.3 写明"这些字段是原始访问诊断，不是业务调用量"，并在 API 字段命名上与 `usage.*` 区分（如 `rawCalls`），避免消费方误用。

无论选哪条，**必须留痕**，不能沉默留空。

---

### 🔴 3. KPI 契约注册表两份文档都没提 —— 最可能让 WO-202610-28 在 T6 卡住

**位置**: Spec 189 Terminology Compliance（lines 17-41，未提及）；WO-202610-28 Task 1 Files（lines 37-46，未提及）

**证据**:

`webui/src/lib/kpiContracts.ts` 是 KPI 标签与 help 文案的**权威注册表**，且被两处守卫：

- `webui/src/__tests__/kpi-contracts.test.ts`（88 行，断言 id 唯一、必填字段、D2／D4 文案锚点）
- `npm run lint:terminology`

它当前的内容在新口径下**逐条变成假话**：

| id | 行 | 当前 help | 问题 |
|---|---|---|---|
| `active-agent-count` | `:75` | "当前时间窗内**访问日志出现过**的去重 Agent 数。" | 新口径只认业务调用 → 假话 |
| `active-token-count` | `:92` | "当前时间窗内**访问日志出现过**的去重 token_hash_prefix 数。" | 同上 |
| `calls-7d` / `calls` | `:126` | "当前时间窗内经 MCP Proxy 记录的**所有调用次数**（含成功、拒绝、错误）。" | 与 §2 的"业务调用量"口径冲突 |
| `acl-denials` | `:135` | "…`outcome='denied'` 的记录数…" | 需同步是否排除协议 |
| `p95-latency` | `:144` | "…基于**所有**有 duration_ms 记录的调用行计算。" | 同 🔴 2 |

**问题**:

Spec 的 Terminology Compliance 一节只提到 `webui/docs/00-product-terminology-standard.md`；WO 的 Task 1 Files 只列了 `00-product-terminology-standard.md` + 4 份上游 Spec 文档。**两处都没有 `webui/src/lib/kpiContracts.ts`，也没有 `webui/src/__tests__/kpi-contracts.test.ts`**。

后果有二：

1. `kpi-contracts.test.ts` 断言 `active-token-count` 的 help 必须含 `"D4"`（`:28-32`）—— 只要文案被改写且未保留 D4 锚点就会红；
2. 改完口径后注册表仍宣称"访问日志出现过"，**用户看到的 tooltip 与实际数字不符** —— 这是一个"统计真实性"Spec 反而制造出的新的不实。

**建议**:

- Spec Terminology Compliance 一节增加一条，指明 `kpiContracts.ts` 是 KPI 文案的注册点，必须同步；
- WO Task 1 Files 增加 `webui/src/lib/kpiContracts.ts` 与 `webui/src/__tests__/kpi-contracts.test.ts`；
- Task 1 步骤补：改写 `active-agent-count` / `active-token-count` / `calls-7d` / `calls` / `acl-denials` / `p95-latency` 的 help 文案，并保留 `active-token-count` 的 D4 锚点；
- **顺手清理一条陈旧契约**：`calls`（`:123-129`）登记的 `pages: ["/admin/governance/overview"]`，但该页面已刻意移除"调用量"卡片（`admin-governance-observability.test.tsx:179` 断言其不存在）—— 注册表与 UI 已经不一致，属同源漂移，一并在 T1 修掉或明确标注为"仅 API 契约"。

---

## 🟡 建议改

### 🟡 1. 漏了一个真实展示调用量的表面：`/eval/monitor` "现场"面板

**位置**: Spec 189 §适用范围（line 11）、§6 页面口径表（lines 183-193）、§9 SC-08（line 289）；WO Task 5（lines 131-157）

**证据**:

`webui/server/eval/monitor.ts:259-263`：

```ts
const calls = auditDb.prepare(`
  SELECT user_agent, outcome
  FROM access_log
  WHERE ts >= ? AND (${placeholders})
`).all(since, ...params) as Array<{ user_agent: string | null; outcome: string | null }>;
```

按 `client_family` 聚成 calls／errors／denies，**无协议过滤、无 eval 探针过滤**，由 `src/pages/eval/Monitor.tsx` 的"现场"面板渲染。

**问题**:

1. 这是唯一被 Spec 的 9 表面清单**完全遗漏**的用户可见调用量表面；
2. 更关键：**SC-08 写的是"退出所有默认用量 KPI"**（Spec line 289）。`/eval/monitor/field` 计入探针调用 → **按字面就已经违反 SC-08**。这不是"漏了一个页面"，而是"有一条验收标准当前无法通过"。

**建议**:

§6 页面口径表增加 `/eval/monitor` 行；WO Task 5 Files 增加 `webui/server/eval/monitor.ts` 与 `webui/src/pages/eval/Monitor.tsx`，并在 Task 5 步骤中明确该端点采用 Default Usage Call。若决定不纳入（理由：评测监控本身就要看全量），则必须改写 SC-08 的措辞，明确"默认用量 KPI"不含评测监控类端点 —— 两种都可以，但不能既不纳入、又不改 SC-08。

### 🟡 2. 存量字段的数值会变，但 Spec 把它写成"保留"

**位置**: Spec 189 §5.2（lines 148-171）

**证据**:

`businessCallsLast7d` / `protocolCallsLast7d` **已经存在且已被消费**（`admin/agents.ts:376-383`、`:849-852`、`:886-896`；`src/pages/admin/AgentList.tsx:150-155`、`:398-399`、`:693-694`、`:774-784`）。

协议集合从 3 扩到 8+ 后：

- `businessCallsLast7d` **下降**（`ping`／`resources/list`／`resources/templates/list`／`notifications/cancelled`／`server/discover` 被移出）
- `protocolCallsLast7d` **上升**（同样这批方法被移入）
- `lastBusinessUse`（`agents.ts:317`）同步前移

**问题**:

§5.2 把这几个字段写在"**保留**"标题下，读者会理解为"语义与数值都不变"。实际上**数值必然变**。恒等式 `calls = business + protocol` 仍成立（划分是穷尽的），这点没问题；但任何按旧数字建立的阈值、看板、外部消费方会**静默漂移**。`/admin/agents` 的"近 7 天业务调用量"卡片（`AgentList.tsx:549-557`）就是直接受影响面。

**建议**:

- §5.2 显式写明"字段名保留、**数值会变**：协议集合扩大后 `businessCallsLast7d` 单调不增、`protocolCallsLast7d` 单调不减"，并说明这是预期行为而非回归；
- §10 增加一条"存量数值迁移说明"，要求在发布说明中提示下游看板；
- WO Task 1 增加一步：**改动前采一份存量数值基线**（各 Agent 的 `businessCallsLast7d` / `protocolCallsLast7d`），作为 T3 的回归对照。

### 🟡 3. Access Governance Gate 的"高流量"阈值会静默变化，Spec 未提

**位置**: Spec 189 §3 Non-Goals（lines 65-76）、§6；WO Task 3

**证据**:

`admin/agents.ts:1503` 与 `:1614`：

```ts
callsLast7d: stats.businessCallsLast7d ?? 0
```

两处都把 `businessCallsLast7d` 喂给 `buildAgentGateInput`，用于 P2 级"删除高流量 Agent"的拦截决策（`evaluateAccessGovernanceGate`）。

**问题**:

新口径下这个计数变小 → **被拦截的 Agent 变少**。方向上这大概是对的（纯握手的 Agent 本就不该算"高流量"），但它是**治理语义变更**，Spec 从未提及。而 §3 Non-Goals 写的是"不修改 MCP 运行时授权、工具暴露、权限拒绝或请求转发"，读者容易误以为治理门禁这块没动。

**建议**:

在 §6 或 §10 增加一行明确交代：治理门禁的"高流量"判据随口径变化，方向为"更少误拦"，并说明这是预期结果；若认为不可接受，则需把门禁单独锚定到 `callsLast7d`（全量）而非业务口径。

### 🟡 4. 9 套词表不会被真正收敛，最终门禁按现分解法过不了

**位置**: WO Task 2 Files / Steps（lines 60-81）、Task 5 Steps（lines 148-156）、最终交付门禁（line 212："不存在第二份协议名单或另一套默认用量判断"）

**证据**:

见 §0.2 的 9 套词表。WO 的 Task 2 覆盖 A／B／C／D／E；**F／G 落在 Task 5**，但 Task 5 步骤只写"访问日志默认筛选改用协议全集 SQL 条件"（line 152）与"保留 Spec 172／173 的纯探测不形成问询规则"（line 153），**没有要求 F／G 从共享模块派生**。

**问题**:

按现分解法实施完，`proxy/audit.ts:1827-1833`（`PROBE_TOOLS`）与 `:1835`（`HANDSHAKE_TOOLS`）仍是两套可独立漂移的名单 → 最终门禁"不存在第二份协议名单"**过不了**。而 F／G 承载的是 Spec 172／173 的"纯探测不形成问询"语义，与 §4.2 的协议全集是**同一语义域**（都是"什么算协议／探测"），天然应当同源。

**建议**:

- Task 5 步骤 3 改为显式要求：`proxy/audit.ts` 的 `PROBE_TOOLS` / `HANDSHAKE_TOOLS` 改为从共享模块导入或由共享模块派生，保留 Spec 172／173 的**语义**但删除**名单副本**；
- Task 2 步骤增一条：把 `admission.ts` 的 `ALLOWED_RPC_METHODS` 与共享模块的协议全集做**一次性对账**，并把对账结论写进 Task 2 Done-when（对应 🔴 1）；
- 顺带：`audit-classification.ts:101-105` 的下标推导改成显式集合（Spec §4.2 已正确指出该风险，需在 Task 2 步骤中点名，否则容易被当作无关重构略过）。

---

## 🟢 Nits

- **Spec §1 背景对 `/ops/calls` 的描述不够精确**（line 50）。实际上有两条读路径：`readR1AuditObservability`（R1/observability API）**已经**通过 `defaultUsageExcluded` 排除完整 8 方法集合 + 探针（`proxy/audit.ts:1161-1175`）；而喂 `/ops/calls` 的 `readCallMonitorSnapshot` 才是只排 3 方法且不排探针的那个（`proxy/audit.ts:1428-1431`）。§5.3 的修法（改 `readCallMonitorSnapshot`）**是对的**，但背景应区分两条路径 —— 而且 **R1 observability 那条正是新共享模块应当对齐的参考实现**。
- **Spec §5.2 字段描述措辞不准**（line 161）。`usageActiveAgentCountLast7d` 是"当前配置 Agent 集合上聚合 per-agent `usageCallsLast7d > 0`"的结果，由 `src/pages/admin/AgentList.tsx:150-151` 在**前端**汇总，不是"由 `usageCallsLast7d > 0` 驱动"（读起来像服务端单字段判定）。建议改写，并说明服务端 `businessActiveAgentCountLast7d`（`admin/agents.ts:886`）作为兼容字段保留。
- **WO Task 3 步骤 4 应点名删掉前端回退**（line 102）。Spec 的"新 UI 不得回退到 `callsLast7d`"在代码里只有一个实际落点：`AgentList.tsx:150` 与 `:427` 的 `agent.stats?.businessCallsLast7d ?? agent.stats?.callsLast7d ?? 0`。建议在 Task 3 步骤中直接引用这两个行号，避免实现时漏改。
- **WO 内部不一致**：(a) Task 1 步骤 4 写"将 SC-01～SC-16 映射到…"（line 54），但 Spec 有 SC-01…**SC-18**；(b) SC-18 未分配给任何任务的 Done-when，只出现在 T6 步骤与最终门禁；(c) `usage-classification.test.ts` 是新文件却标 `Test:`（line 66），而同类的 `usage-metrics-cross-page.test.ts` 标 `Create:`（line 163），标注不一致。
- **WO 未列受影响测试**：`server/__tests__/role-denial-comparison.test.ts`（多处断言 `readR1AuditObservability().usage.roles`）与 `server/__tests__/question-budget.test.ts`（`:175` 消费 `readR1AuditObservability`）都依赖受影响的读路径，但不在任何任务的 Files 里。建议在 Task 5 / Task 6 增加"确认是否受影响"的步骤，而不是默认它不受影响。
- **`mcp-request-classification.test.ts:6` 断言的是精确三元素数组**（`expect(MCP_PROTOCOL_METHODS).toEqual(["tools/list", "initialize", "notifications/initialized"])`）。该文件虽已在 Task 2 清单内，但这条断言必须**显式重写**（而非顺带改到绿），建议在 Task 2 步骤中点名。
- **SQL/TS 一致性实现细节**（Task 2 步骤 5，line 77）建议补两条：`eval_mark` 在 DB 侧是 integer（读路径用 `=== 1`），TS 侧是 boolean；`hasProbeName` 的小写包含语义在 SQLite 侧需用 `instr(lower(x), marker)` 复刻，不能依赖 `LIKE` 的隐式 ASCII 大小写行为。`question-experience.ts:509` 的 `PROBE_NAME_MARKERS = ["probe-", "rds-test", "demo-mysql"]` 均为小写。
- **两份文档均未登记到索引**：`webui/docs/README.md` 的 Spec 表与 `webui/docs/plans/README.md` 的工单表都没有 189 / WO-202610-28 的行。参照 `190-live-table-discovery-and-continuous-sync-spec.md` 的先例（以"**待审阅，未授权实现**"状态登记），待审阅文档同样应登记。已随本次审阅补上（见文末"落盘动作"）。

---

## 维度核查

1. **事实准确性（引用与符号）**：**PASS**
   证据：25 个声明文件路径全部核实存在（含 `usage-classification.ts` 为新建）；8 份上游 Spec（128／143／155／162／165／172／173／187）全部存在；全部具名符号真实存在（`MCP_PROTOCOL_METHODS`、`isMcpProtocolMethod`、`defaultUsageExcluded`、`isEvalProbeCall`、`transport_sub_type`、`COMPAT_AUDIT_ROW_LIMIT`、`queryActiveAgentCount`、`queryActiveTokenCount`、`queryAgentWindowStats`、`queryTokenCallCounts`、`readCallMonitorSnapshot`、`readR1AuditObservability`）。**无虚构引用**。

2. **问题诊断真实性（虚高是否真存在）**：**PASS**
   证据：§0.1 全部 10 个表面逐条给出 `file:line` 与过滤条件原文；核心判定为 SQL／读路径静态推导，**未运行应用取真实数字** —— 结论可靠，但落地前建议用真实审计库做一次基线对照（对应 🟡 2 的"存量数值基线"步骤）。

3. **口径模型正确性**：**PASS**
   证据：三层口径（§4.1）与 Spec 162 已落地的 `defaultUsageExcluded`（`question-experience.ts:626-633`）语义一致；目标协议集合（§4.2）= 现有 `PROTOCOL_TOOL_SET`（`question-experience.ts:27-36`）+ `server/*` 前缀（`audit-classification.ts:147`）—— 选得对，不是新发明。

4. **范围完整性（表面覆盖）**：**FAIL**
   证据：漏 `/eval/monitor` "现场"面板（`server/eval/monitor.ts:259-263`）；漏 5 个无 WebUI 消费方的同类 API 端点。另有 5 个仅 API 端点未在 §3 明确排除。见 🟡 1。

5. **唯一事实源可达成性**：**FAIL**
   证据：§4.2 协议全集不完整（🔴 1）；WO 的任务分解不会消除 `proxy/audit.ts` 的 F／G 两套名单，最终门禁"不存在第二份协议名单"按现分解法不可满足（🟡 4）。

6. **跨页口径自洽性**：**FAIL**
   证据：§5.3 遗漏 overview 的 calls／P95／拒绝原因口径，修复后同一页面会并存两套调用量语义，直接违反 Spec §6 自订的对账原则（🔴 2）。

7. **术语与 KPI 文案合规**：**FAIL**
   证据：`webui/src/lib/kpiContracts.ts` 的 5 条 help 文案在新口径下成为假话，且该文件在两份文档的改动清单中缺席（🔴 3）。

8. **向后兼容性与变更可见性**：**FAIL with caveat**
   证据：恒等式 `calls = business + protocol` 在协议集合扩大后仍成立（划分穷尽），兼容字段保留策略正确；但存量字段**数值必然变化**而 Spec 写作"保留"，未提示下游（🟡 2）。治理门禁阈值同样静默变化（🟡 3）。

9. **验收可执行性**：**FAIL**
   证据：SC-08 的"退出所有默认用量 KPI"按字面已被 `/eval/monitor/field` 违反（🟡 1）；SC-18 未分配 Done-when；WO 内部 SC 编号与文件标注不一致（🟢 段）。其余 SC-01…SC-17 均有具体断言与测试文件映射。

10. **非目标与边界守住**：**PASS**
    证据：§3 Non-Goals（lines 65-76）明确不改 MCP 运行时授权／工具暴露／权限拒绝，不删改历史 `access_log`，不新增表或定时聚合；§9 SC-14 保留 `partial`／`unavailable` 不归零；§10 禁止把未运行写成通过。与 §10 的"不修改统计代码"现状一致。

11. **非破坏性设计原则**：**PASS**
    证据：§4.1 保留 Raw Audit Record 全量、§3 不删改历史行、§5.3 `/api/admin/audit` 保留原始审计语义并支持 `includeProtocol=true`、§6 保留"最近 MCP 访问"与"近 N 使用过的凭据"的全量语义 —— 这些边界判断都正确，与 Spec 155／128 既有决策不冲突。

12. **文档索引同步**：**FAIL（本次审阅已修）**
    证据：`webui/docs/README.md` Spec 表与 `webui/docs/plans/README.md` 工单表均无 189 / WO-202610-28 / 本审阅记录。参照 Spec 190 的先例（以"待审阅，未授权实现"登记），已在本次审阅中补齐。

---

## ✅ 已确认（PASS）

- Spec 与 WO 引用的**全部文件路径真实存在**；`usage-classification.ts` 与 `usage-metrics-cross-page.test.ts` 为 WO 声明的新建文件，命名与位置与仓库既有惯例一致。
- WO 引用到的既有测试文件全部存在：`admin-agents.test.ts`、`admin-governance-observability.test.ts`、`call-monitor.test.ts`、`tokens-page.test.tsx`、`object-detail-drawer.test.tsx`、`admin-audit.test.ts`、`r1-observability.test.ts`、`usage-default-view.test.ts`、`p1-access-map-conservation.test.ts`、`audit-trust/audit-trust-classification.test.ts`、`agent-list.test.tsx`、`agent-detail.test.tsx`、`admin-governance-observability.test.tsx`、`call-monitor.test.tsx`、`audit.test.tsx`、`admin-audit-turns.test.tsx`。
- 协议事件确实以 JSON-RPC 方法名写入 `access_log.tool`（`server/proxy/question-experience.ts:509` 与 `server/__tests__/usage-default-view.test.ts:42-45`、`:125` 均以 `"tools/list"` / `"ping"` / `"resources/list"` 作为 `tool` 值构造夹具）—— **Spec 走"按工具名重算协议分类"的路线在数据层可行**。
- 评测探针规则与实现一致且够克制：`isEvalProbeCall`（`question-experience.ts:609-623`）要求显式 `eval_mark` + 名称命中，且 `evalMarkFromToken`（`:505-507`）严格判定 `=== true`（`"yes"` / `1` 都不算）—— 与 Spec §4.3 "不从 `actor_kind`、`token_label` 或 User-Agent 推断"完全对应。
- 非法／空 `args_summary` 的容错口径在 WO Task 2 步骤 5 已被覆盖（"必须安全落到未命中"），与 `defaultUsageExcluded` 对非对象 `args` 返回 `false`（`question-experience.ts:617`）的现有行为一致。
- `COMPAT_AUDIT_ROW_LIMIT = 5000` 确实存在且已被自带警告标注"**Do not use for usage KPIs**"（`admin/governance-observability.ts:83`、`:182`）—— Spec §5.1 "不得经过 `COMPAT_AUDIT_ROW_LIMIT`" 的约束指向的是真实的既有陷阱。
- `audit-classification.ts:101-105` 确实以**数组下标**从 `MCP_PROTOCOL_METHODS` 推导握手集合 —— Spec §4.2 的这条警告是真实的，不是假想风险。
- `/admin/agents` 页面的卡片文案与结构已经是 Spec 目标形态（`AgentList.tsx:517-523` "近 7 天活跃 Agent"、`:549-557` "近 7 天业务调用量"、`:558-563` "近 7 天协议请求量"）—— **Spec 的页面改造方向与现有设计意图一致**，不是推倒重来。
- 审计页默认隐藏协议事件、`includeProtocol=true` / 调试台来源返回全部，现有实现符合 Spec §5.3 的描述（`admin/audit.ts:256-260`）。

---

## 落盘动作（本次审阅执行）

按仓库既有惯例（`webui/docs/plans/review-spec40-m37.md`）落盘，**未修改 Spec 189 与 WO-202610-28 的正文，未修改任何统计代码**：

1. 新增本审阅记录：`webui/docs/plans/review-spec189-wo-202610-28.md`。
2. `webui/docs/README.md` Spec 表补登记 189。
3. `webui/docs/plans/README.md` 工单表补登记 WO-202610-28。

---

## 审阅者未触发 worktree 变更声明

除上述落盘动作外，本次审阅**只执行只读检查**：未修改 Spec 189 正文、未修改 WO-202610-28 正文、未修改任何统计实现代码、未修改任何测试文件、未运行测试套件与构建。审阅结论中"虚高"的判定基于 SQL 与读路径静态证据，**未运行应用取真实审计数字**。

`git status --porcelain` 输出（落盘后）：

```text
 M webui/docs/00-product-terminology-standard.md
 M webui/docs/README.md
 M webui/docs/plans/README.md
?? docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md
?? webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md
?? webui/docs/190-live-table-discovery-and-continuous-sync-spec.md
?? webui/docs/191-execution-runtime-reload-spec.md
?? webui/docs/plans/review-spec189-wo-202610-28.md
?? webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md
?? webui/docs/plans/wo-20261026-live-table-discovery-and-continuous-sync.md
```

> 注：`00-product-terminology-standard.md` 与 `docs/README.md` 的既有改动属于 **Spec 190（库表发现与持续感知）** 的工作，不在本次审阅范围内，本次未触碰其内容。

**已执行的验证命令**（仅针对本次落盘的文档改动）：

```bash
cd webui && npm run lint:terminology
# → Terminology lint passed (986 files scanned).
```

本审阅**未运行** Vitest 测试套件与 `npm run build` —— 本次没有改动任何实现代码，测试与构建验证属于 WO-202610-28 的 T6 范畴。

---
---

# 复审：Spec 189 v1.1 + WO-202610-28（2026-10-27）

> **作者**: Mavis（MiniMax Code 代码复审）
> **复审对象**: `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` **v1.1** + `webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md`（按 v1.1 同步修订版）
> **状态**: 🔴 1 条 / 🟡 2 条 / 🟢 1 条
> **结论**: **PASS（附 4 条必须随计划落地的修订）** — 首轮 11 条发现全部闭环；新发现 4 条，均为**计划侧**修订，不改变 Spec 的口径模型与实施范围。
> **本次范围**: 只做 code review（规格／计划复审 + 代码事实核对）。**未实施** T1–T6、**未重建 Docker**、**未运行** Vitest／build。

## TL;DR

- **PASS**：Spec 189 v1.1 已实质吸收首轮 3 条阻断项，**不存在口径自相矛盾**，三层模型（Raw Audit → Raw Business → Default Usage）与准入覆盖设计自洽。Spec 与 WO 可以进入实施。
- 首轮 🔴1／🔴2／🔴3 与 🟡1–🟡4 **全部闭环**，且 v1.1 在两处**修正了首轮审阅自身的错误**（见下文"首轮错误修正"）。
- 新发现 **4 条**，全部是**实施计划侧的漏洞**（不是 Spec 口径错误）：
  - 🔴 N1：`readR1AuditObservability` 把协议行误计为评测探针，而 WO T5 步骤 2 要求"保持现有评测探针口径"——会把缺陷固化，与 SC-12 冲突。
  - 🟡 N2：`admin/audit.ts` 有 **4 处**协议名单消费点，WO T5 步骤 3 只覆盖默认筛选 1 处，其余 3 处留在 3 方法名单上。
  - 🟡 N3：`server/admin/reconciliation.ts` 是第 10 个协议分类消费点，**未登记在 WO 任何任务里**，行为会静默改变且无回归断言。
  - 🟢 N4：§5.3 要求的新增"业务使用时间"没有指定归属模块，存在被重复实现的风险。
- 上述 4 条已**同步修订进 WO-202610-28**（见文末"落盘动作"），修订后 WO 可直接执行。

---

## 一、首轮发现闭环核对（11 / 11）

| # | 首轮发现 | 闭环 | 复审证据（`file:line`） |
|---|---|---|---|
| 🔴1 | §4.2 协议事件全集不完整，与 §2.1 自相矛盾 | ✅ 关闭 | Spec §4.2 补齐为 9 个具名方法 + `server/*` 前缀规则；**准入集合与协议集合明确不等**（Spec §4.2 "二者不得断言相等"）。`webui/server/proxy/admission.ts:28-40` 实际放行 **11 个方法**，与 Spec §4.2 覆盖表逐项一致（含 `prompts/list`→Protocol、`resources/read`／`prompts/get`→Raw Business）。WO T2 步骤 3 要求覆盖测试，并要求 `admission.ts` "仅暴露只读准入集合供覆盖测试"——已识别 `ALLOWED_RPC_METHODS` 当前**未 export**（`admission.ts:28`），WO 步骤已覆盖该改法。 |
| 🔴2 | Governance overview 的 calls／P95／拒绝原因未进入口径裁决 | ✅ 关闭 | Spec §5.3 已点名 6 个实现：`queryCallStats`／`queryP95LatencyMs`／`queryAgentWindowStats`／`queryAgentP95LatencyMs`／`queryAgentTopDeniedReasons`／`queryHighDenialAgentCount`，并要求"即使当前页面不渲染部分卡片，API 也不得在同窗口暴露相反口径"。逐个核实存在：`webui/server/admin/governance-observability.ts:224/259/423/452/494/344` ✅ |
| 🔴3 | `kpiContracts.ts` 在两份文档中缺席 | ✅ 关闭 | Spec Terminology Compliance 已把它列为 KPI 文案注册点，并要求 `kpi-contracts.test.ts` 守卫。WO T1 Files 已列出两个文件。实测 5 条 help 文案在新口径下确实成为假话：`src/lib/kpiContracts.ts:75`（活跃 Agent "访问日志出现过"）、`:92`（活跃 Token，含 D4 锚点）、`:126`（calls "所有调用次数"）、`:131`（acl-denied）、`:144`（p95 "基于所有有 duration_ms 记录的调用行"）。D4 锚点在 `src/__tests__/kpi-contracts.test.ts:28-31` 有硬断言 ✅ |
| 🟡1 | 漏了 `/eval/monitor` "现场"面板 | ✅ 关闭 | Spec §6 新增该行，SC-08 显式点名"包含 `/eval/monitor` 现场"，WO T5 覆盖 `server/eval/monitor.ts` + `src/pages/eval/Monitor.tsx` + 新建 `eval-monitor-field.test.ts`。实测缺陷属实：`server/eval/monitor.ts:259-263` 按 client family 聚合全量 `access_log`，无协议过滤、无探针过滤 ✅ |
| 🟡2 | 存量字段数值会变但被写成"保留" | ✅ 关闭 | Spec §5.2 已写明"字段名和恒等式保留，但数值会按新分类预期变化"，并给出单调方向（`businessCallsLast7d` 单调不增、`protocolCallsLast7d` 单调不减、`lastBusinessUse` 可能前移）；WO T1 步骤 4 要求改动前保存确定性夹具基线，T6 步骤 5 要求 CHANGELOG 发布 ✅ |
| 🟡3 | 治理门禁"高流量"阈值静默变化未交代 | ✅ 关闭 **且首轮审阅本身有误** | Spec §6 已专设"Access Governance Gate 输入边界"，固定 `buildAgentGateInput.callsLast7d` 读 **Raw Business**（`businessCallsLast7d`），并声明阈值与裁决算法不变。见"首轮错误修正"第 1 条 ✅ |
| 🟡4 | 9 套词表不会真正收敛 | ✅ 关闭 | WO T5 步骤 4 已要求 `proxy/audit.ts` 的 `PROBE_TOOLS`／`HANDSHAKE_TOOLS` 改为从共享模块导入或派生并删除名单副本。实测这两份副本确实独立存在：`server/proxy/audit.ts:1827-1833`（PROBE_TOOLS，5 项）、`:1835`（HANDSHAKE_TOOLS，3 项）✅ |
| 🟢 | 首轮 §1 背景未区分两条调用监控读路径 | ✅ 关闭 | Spec §1 第 2 点已明确区分 `readR1AuditObservability`（已用 `defaultUsageExcluded` 排除 8 方法＋探针）与 `readCallMonitorSnapshot`（只排 3 方法、不排探针）。实测属实：`server/proxy/audit.ts:1161-1175` vs `:1428-1431`，两者共用同一个 3 元素 `PROTOCOL_TOOLS`（`proxy/audit.ts:18` 导入）✅ |
| 🟢 | §5.2 `usageActiveAgentCountLast7d` 措辞不准 | ✅ 关闭 | Spec §5.2 已改为"服务端 `buildAgentsSummary` 在当前配置 Agent 集合上统计 `usageCallsLast7d > 0` 的数量；前端 `summarizeAgents` 仅是旧响应缺少 summary 时的兼容计算路径"。实测服务端聚合点存在：`server/admin/agents.ts:800`（`buildAgentsSummary`）、`:855`（`stats.businessCallsLast7d > 0` 判定）；前端兼容路径在 `src/pages/admin/AgentList.tsx:128-151` ✅ |
| 🟢 | WO 需点名前端回退落点 | ✅ 关闭 | WO T3 步骤 3 点名 `AgentList.tsx:150`／`:398`／`:427`／`:693`。**行号全部准确**，实测四处均为 `businessCallsLast7d ?? callsLast7d ?? 0` 形态 ✅ |
| 🟢 | `mcp-request-classification.test.ts:6` 精确三元素断言须显式重写 | ✅ 关闭 | WO T2 步骤 2 明确"重写该测试第 6 行的精确三元素数组断言，改为逐方法分类…而非只把新数组改到绿"。实测 `:6` 为 `expect(MCP_PROTOCOL_METHODS).toEqual(["tools/list", "initialize", "notifications/initialized"])` ✅ |

### 首轮错误修正（v1.1 纠正了首轮审阅本身）

1. **治理门禁严重级别**：首轮写"P2 级『删除高流量 Agent』的拦截决策"，**错误**。实测 `webui/server/access-governance-gate.ts:320-326` 的 `HIGH_TRAFFIC_TARGET` 是 `tier: "P1"`，且 `:380-381` 的裁决映射为 `P1 → decision = "warn"`（只有 P0 才 `override_required`）。v1.1 §6 写的"P1 `warn`"**正确**，并额外禁止把它描述成 P2 拦截——这一条比首轮更准确。
2. **首轮"全部 25 个声明文件路径"核查未发现 `mcp-admission-all-methods.test.ts` 已存在**。该文件已存在且是**准入鉴权**集成测试（起真实 HTTP 上游，覆盖 11 个方法的 403／401／404／405 行为），与 WO 要求的"用量分类覆盖矩阵"是两种语义。WO T2 把它标为 `Test:`（修改）而非 `Create:` 是**正确**的，但实施者需注意：分类矩阵更适合落在新建的 `usage-classification.test.ts`，不要把纯分类断言塞进这个重量级集成测试。

---

## 二、本轮新发现（4 条，均为计划侧）

### 🔴 N1：`readR1AuditObservability` 把协议行误计为评测探针，WO T5 会把缺陷固化

**位置**: `webui/server/proxy/audit.ts:1173-1177`

```ts
const protocolTools = new Set<string>(PROTOCOL_TOOLS);   // 3 元素
const businessRows = rows.filter((row) => !protocolTools.has(row.tool));
const defaultRows   = businessRows.filter((row) => !defaultUsageExcluded({...}));
const evalProbeRows = businessRows.filter((row) => defaultUsageExcluded({...})
                                                && !protocolTools.has(row.tool));
```

**问题**: `defaultUsageExcluded` 对 **8 方法协议集**（`server/proxy/question-experience.ts:27-36`）返回 `true`，而 `protocolTools` 只有 **3 元素**（`proxy/audit.ts:18` 导入 `MCP_PROTOCOL_METHODS`）。两集合之差 —— `ping`、`resources/list`、`resources/templates/list`、`server/discover`、`notifications/cancelled` —— **全部落入 `evalProbeRows`**，即协议事件被当成评测探针计数。

**为什么是阻断**: WO T5 步骤 2 写的是"`readR1AuditObservability`…**保持现有评测探针**、Actor 与 Role 拒绝口径"。照此实施＝把缺陷固化；而 SC-12 要求四类（Raw Business／Default Usage／Protocol／Eval Probe）**可区分**，"协议被计成评测探针"正是不可区分。

**要求**: R1 路径必须**先分类再拆分**——用共享模块的分类结果判定 `class == EVAL_PROBE`，而不是用 `defaultUsageExcluded(...) && !protocolTools.has(...)` 这种二次反推。共享模块的 `isEvalProbeCall` 语义（`question-experience.ts:609-624`）已经正确：要求**显式 `eval_mark` 为真**（`evalMarkFromToken` 严格 `=== true`，`:506-507`）**且**参数／连接名命中探针标记（`PROBE_NAME_MARKERS`，`:509`）。协议行根本不该进入探针判定。

### 🟡 N2：`admin/audit.ts` 有 4 处协议名单消费点，WO 只覆盖 1 处

**位置**: `webui/server/admin/audit.ts`

| 行 | 用途 | 现口径 | WO 是否覆盖 |
|---|---|---|---|
| `:91` | `PROTOCOL_TOOL_LIST` 定义（来自 3 元素 `MCP_PROTOCOL_METHODS`） | 3 方法 | — |
| `:260` | 访问日志**默认筛选** `tool NOT IN (...)` | 3 方法 | ✅ T5 步骤 3 |
| `:1726` | turn-scoped 调查回捞协议行 `WHERE tool IN (...)` | 3 方法 | ❌ |
| `:2782` | 数据承载调用 `tool NOT IN (...) AND tables IS NOT NULL` | 3 方法 | ❌ |
| `:2934` | 审计汇总 `protocol_calls` / `business_calls` / `data_bearing_calls` | 3 方法 | ❌ |

**为什么是 🟡**: `:2934` 的 `business_calls` 会继续把 `ping`／`resources/list` 计成业务调用 → 与 Spec §5.3／§6 的审计口径矛盾，且 §6"跨页对账原则"要求同页面同口径。最终门禁"不存在可独立漂移的同语义协议名单"按现分解法过不了。

**要求**: T5 步骤 3 必须扩展为"**`admin/audit.ts` 全部 4 处协议名单消费点统一改用共享模块的协议全集条件**"，而不是只改默认筛选。

### 🟡 N3：`server/admin/reconciliation.ts` 未登记在 WO 任何任务

**位置**: `webui/server/admin/reconciliation.ts:28`（import）、`:245`（`PROTOCOL_TOOL_SET`）、`:379`（`unitKind: "protocol_request" | "tool_call"`）、`:836-839`（`protocol_events_excluded_from_business_denominator`）

**问题**: 这是第 10 个协议分类消费点。它**派生自** A 名单（不是独立副本），所以不会"漂移"，但**行为会静默改变**：`ping`／`resources/list` 等在协议集合扩大后会从 `tool_call` 翻转为 `protocol_request`，对账输出的"协议事件不进入业务问询分母"计数会上升。它承载 Spec 162 的问询分母语义。

**为什么是 🟡**: Spec §5.3 与 WO **都没有提到 reconciliation**。这不是"实现错了"，而是**行为变更未被登记、无回归断言**——T6 步骤 3"检查全部旧字段消费者"也扫不到它。

**要求**: 登记为 T5 的受影响面，并补一条回归断言（协议集合扩大后，对账的 protocol/business 划分符合共享分类；`resources/read`／`prompts/get` 仍属 business）。

### 🟢 N4：§5.3 新增"业务使用时间"未指定归属模块

**位置**: Spec §5.3 "`/api/admin/tokens` 增加业务使用时间字段"；WO T4 步骤 4"Token 清单聚合最近 MCP 访问和最近业务使用两个时间"；WO T3 步骤 5"不能复用 `last_used`"

**问题**: `/api/admin/tokens` 的现有时间来源是 `getLastUsedMap`（`webui/server/admin/agents.ts:416`），它返回每个 token 的**任意 tool** 最新行 —— 这正是"协议访问被显示成使用"的根因。实现"最近业务使用"必须新增一个按 Default Usage 过滤的时间映射，但 WO 只说了"要两个时间"，没说这个映射**放在哪个模块**。`getLastUsedMap` 在 `agents.ts`，却被 `/api/admin/tokens`（`server/admin/tokens.ts:134`→`:150`）与 Agent 详情共用；T4 的 Files 列表里只有 `admin/tokens.ts`，没有 `admin/agents.ts`。

**要求**: 在 T4 明确"业务使用时间映射与 `getLastUsedMap` 同居 `server/admin/agents.ts`（如 `getLastBusinessUseMap`），由 `admin/tokens.ts` 与 Agent 详情共用"，避免两处各写一遍。

---

## 三、复核通过项（v1.1 原有判断已复核成立）

- **三层口径与 Spec 162 语义一致**：`defaultUsageExcluded`（`question-experience.ts:626-633`）对非对象 `args` 返回 `false`，与 WO T2 步骤 5"非法／空 `args_summary` 必须安全落到未命中"一致 ✅
- **`eval_mark` 双侧语义可复刻**：TS 侧 `evalMarkFromToken` 严格 `=== true`；SQL 侧 `access_log.eval_mark` 为 integer（`proxy/audit.ts:1159` 读取 `eval_mark === 1`），WO T2 步骤 6 的"integer `eval_mark=1` → boolean 归一 + `instr(lower(value), marker)`"与现状吻合 ✅
- **协议事件确实以 JSON-RPC 方法名写入 `access_log.tool`**：SC-01 的夹具路线在数据层可行 ✅
- **`COMPAT_AUDIT_ROW_LIMIT = 5000` 真实存在且已自带警告**：`admin/governance-observability.ts:83`、`:182`，并已在 `:980-981` 以 `compatTruncation` 对外暴露 ✅
- **`audit-classification.ts` 以数组下标推导握手集合**：`:101-105` 确实写死 `[0]/[1]/[2]`，Spec §4.2 的警告是真实风险，WO T2 步骤 4 已点名 ✅
- **SC 编号闭合**：Spec v1.1 为 SC-01…SC-18；WO T1 步骤 5 已写 SC-01～SC-18 并把 SC-18 明确归属 T6 ✅
- **WO 文件清单可执行性**：64 条文件条目逐一核对，**仅 4 条缺失且全部是声明新建**（`proxy/usage-classification.ts`、`__tests__/usage-classification.test.ts`、`__tests__/eval-monitor-field.test.ts`、`__tests__/usage-metrics-cross-page.test.ts`），**无虚构引用** ✅

---

## 四、维度核查（v1.1）

| 维度 | 结论 | 依据 |
|---|---|---|
| 事实准确性（引用与符号） | **PASS** | 64 条文件条目、11 个准入方法、6 个 governance 聚合函数、9 条协议方法、门禁 tier 与裁决映射，全部核实存在 |
| 问题诊断真实性 | **PASS** | 11 个用户可见表面的虚高路径逐条复核属实（`admin/governance-observability.ts:286-330`、`:428-441`、`:595-601`；`admin/agents.ts:312-317`、`:416-444`；`admin/audit.ts:91/260`；`proxy/audit.ts:1428-1431`；`admin/access-map.ts:1913-1921`；`admin/tokens.ts:226-230`；`src/components/ObjectDetailDrawer.tsx:246`；`eval/monitor.ts:259-263`） |
| 口径模型正确性 | **PASS** | 三层模型与 Spec 162 落地实现语义一致；协议集合 = 现有 8 方法集 + `prompts/list` + `server/*` |
| 范围完整性 | **PASS**（补 N3 后） | 11 个准入方法全覆盖；`/eval/monitor` 已纳入；reconciliation 已补登记 |
| 唯一事实源可达成性 | **PASS**（补 N2 后） | 握手／协议／准入三集合边界清晰，分类覆盖测试可达成；4 处审计消费点统一后无残留名单 |
| 跨页口径自洽性 | **PASS** | §5.3 已裁决 overview 全量字段；§6 明确人口边界与允许差异项 |
| 术语与 KPI 文案合规 | **PASS** | Spec 已把 `kpiContracts.ts` 登记为注册点，T1 有明确步骤，D4 锚点有测试守卫 |
| 向后兼容与变更可见性 | **PASS** | 旧字段保留、数值迁移方向明确、发布说明要求已写入 T6 |
| 验收可执行性 | **PASS** | SC-01…SC-18 均有断言与测试映射，SC-18 归属 T6 |
| 非目标与边界守住 | **PASS** | §3 Non-Goals 与 §10 一致；不改授权算法、不删历史行、不新增表 |
| 文档索引同步 | **PASS**（本次已修） | `webui/docs/README.md:157`、`webui/docs/plans/README.md:75` 原登记停留在"v1.0／待审阅，未批准"，已随本次复审更新为 v1.1 与已批准 |

---

## 五、落盘动作（本次复审执行）

本次**只做 code review**，执行以下文档动作，**未改动任何统计实现代码、未运行 Vitest／build、未重建 Docker**：

1. 本文件追加 v1.1 复审章节（本节）。
2. `webui/docs/plans/wo-202610-28-usage-metrics-truthfulness.md`：按 N1–N4 修订计划（补 R1 分类优先拆分、审计 4 处协议消费点、登记 reconciliation、明确业务使用时间归属模块），并把 `reconciliation.test.ts` 纳入 T5／T6 验证命令。新建测试文件的 `Create:` 标注经复核已全部正确，未作改动。
3. `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md`：状态改为 **已批准（v1.1），未实施，未验收**。
4. `webui/docs/README.md`／`webui/docs/plans/README.md`：登记状态由"待审阅，未批准"更新为"已批准，实施中"。

**未验证项（保持未验收）**：T1–T6 全部实施内容、Vitest 套件、`lint:terminology`、`npm run build`、Node 与 `better-sqlite3` ABI 匹配性。按 WO T6 步骤 6，ABI 不匹配时必须先修环境再执行，不得把 SQLite 测试跳过写成通过。

## 六、审阅者未触发 worktree 变更声明

除上述 4 项文档动作外，本次复审**只执行只读检查**：未修改任何实现代码、未修改任何测试文件、未运行测试套件与构建、未重建 Docker。结论基于 SQL／读路径静态证据 + 已存在文件的符号核对，**未运行应用取真实审计数字**。
