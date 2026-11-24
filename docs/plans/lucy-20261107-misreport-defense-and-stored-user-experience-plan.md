# Lucy 0.30 分支计划：误报防线与存量用户体感保障

| 元数据 | 内容 |
|---|---|
| 文档类型 | 分支实施计划（**不是**功能 Spec，**不授权**实现） |
| 版本 / 日期 | v0.1 / 2026-11-07 |
| 状态 | **草案，待拍板**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只做事故定性、差距登记与顺序裁决；实现须各自另立 Spec 并获授权 |
| 授权边界 | **只登记、不实现**。本文不改动任何运行代码，不开 Spec，不改现行协议 |
| 验收 | 本条验收＝① 事故根因逐条带 `file:line` 证据；② 缺口各自登记进 `0.30` 需求池；③ Plan 五类小节齐备且机器门禁通过。**不构成任何功能验收，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 2026-11-07 产品对话：①「0.30 重点提升 Eval 与平台运维，已有 100 用户，C-level 体感最关键」；② **2026-11-06 事故：CFO 询问资产数量，其 Agent 选错表并作答，严重误报**；③ **2026-11-07 事故沟通实录（客户：翊总 / 田总），见 §1.4** |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「新增 Spec / Plan 的落盘清单」 |
| 关联需求池 | [`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（REQ-030-022…027） |
| 核心方向 | [`lucy-20261107-lucy-0-30-core-direction.md`](lucy-20261107-lucy-0-30-core-direction.md)（0.30 投入标准与主线／辅线排序；本分支计划是主线的事故级展开） |
| 功能清单池 | [`lucy-20261107-lucy-0-30-feature-inventory-pool.md`](lucy-20261107-lucy-0-30-feature-inventory-pool.md)（**跟进主表**；P0 立项已批准；REQ-030-022–027 映射 P0-1…P0-7） |

## 1. 目标

### 1.1 一句话抽象

> 0.30 的重心不是「让 Agent 更能干」，而是**让 Agent 答错时能被当场识破、答对时能被当场信任**：把「选表正确性」和「答复可核对性」从缺失变成产品能力，同时给 100 个存量用户装上一张**日常体感仪表盘**。

### 1.2 结论先行

用户的判断方向是对的，但**优先级要翻转**：在 100 人规模下，最贵的不是「答不出来」，是**「答错了而且没人知道」**。2026-11-06 的 CFO 事故正是这一类——它不是能力问题，是**可核对性缺口**。

因此本计划给出三条排序结论：

1. **事故定性（已定，见 §1.4）**：2026-11-07 客户沟通实录确认——Agent 取的是 **GPU 计提成本表**（CFO 角色**有权访问**的表），被问的是**资产类问题**。⇒ **这是语义误报，ACL 越权已排除**。代码侧的机制解释完全成立：ACL 只判权限不判语义（`acl.ts:3029-3224`），权限内的错表必然放行。原 §3.3 现场取证清单保留为**留档与复核**，不再决定路线。
2. **事故有两个独立故障轴**：① **选错表** ② **口径被 AI 自行加工**。第一轮沟通原文明写「口径也是 AI 自行加工的」。原计划只覆盖了选表轴 —— **口径轴是本轮新增缺口 G9**（见 §1.4.2）。只在表层设防，仍会漏。
3. **止血已落地，剩下的是防复发**：修复走的是**语义层硬约束**（指定表 + 固定口径），且**已用客户真实账号验证通过**（第三轮）。这条路径**当场生效、当天可验、成本最低**，应作为「逐题固化」的并行轨继续用；但它是**逐条人工配置**，无法覆盖 100 人 × 未知问题 ⇒ 0.30 要交付的是**可复用的系统能力**：G3 表级门闩 + G5 答复可核对 + G6 Eval 选表断言 + G7 体感告警。
4. **0.30 的投入标准被沟通实录重新定义**：公司已对客户承诺「**每天跑测评、每天迭代**」「**发现问题当天修正**」——而这两条**目前完全靠人力盯后台**。0.30 的 Eval 与运维投入，本质是**把这两条人工承诺变成系统保证**。这比「把 Eval 做漂亮」强得多，也是全部排序的最终依据（§1.5）。
5. **Eval 是这条链的「检出器」，不是「修复器」**：现行 Eval **在结构上不可能测出选表错误**——`composeQuestion` 把正确答案的表名直接写进 prompt（`scripts/eval/eval-runner.mjs:1424-1433`）。修好它，选表缺陷才**能**在发布前被拦住。

### 1.3 三条线对拍：用户诉求 ↔ 现状

| # | 用户诉求 | Lucy 现状 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | **选表不能错**（CFO 事故） | `lucy_catalog` 每张表只给 `connectionId/schema/sourceName/table` **四个字段，无业务描述、无同义词、无粒度**，且**纯字母序**排列 | `webui/server/proxy/acl.ts:1986-1990`、`:2007-2015` | **真缺口 G1** |
| 2 | 同上 | 表级描述**在语义层已存在**（`_schema/*.yaml` 的 `descriptions.db/ai`），但**从不被 catalog 读取**——Agent 无从知道哪张表是「资产」 | `semantic-layer/mysql-aliyun/_schema/dataforai.yaml:169-171` vs `acl.ts:2007-2015` | **真缺口 G1**（资产已在仓） |
| 3 | 同上 | instructions 对「多张表都可能命中时怎么办」**零规定**；且动态 role-aware instructions **整节丢弃**了 fallback 里的「问询范围确认」 | `webui/config/data-qa-instructions.md:45-49` vs `webui/server/proxy/mcp-proxy.ts:1838`、`:1867-1906` | **真缺口 G2** |
| 4 | 同上 | 唯一的歧义护栏只管**同名字段跨源**，且**字段带点即跳过**——Agent 用限定名选了错表时完全不触发 | `webui/server/proxy/source-ambiguity.ts:105`、`webui/server/proxy/query-guardrails.ts:201` | **真缺口 G3** |
| 5 | 同上 | ACL 逐表裁决只答「在不在我的权限里」，**全文无语义正确性判据** | `webui/server/proxy/acl.ts:3029-3224`、`:3163-3168` | **真缺口 G4**（边界澄清，非缺陷） |
| 6 | **CFO 能当场核验** | provenance 在工具结果里有，但**埋在 `_meta.lucy`**，MCP 客户端默认不展示；自然语言 provenance 是**纯 instructions 约定、无强制** | `webui/server/proxy/mcp-proxy.ts:2701-2718`；`webui/config/data-qa-instructions.md:34`、`:43` | **真缺口 G5** |
| 7 | 同上 | `freshness.status` **恒为 `not_checked`**，物理时效**恒 `null`**——CFO 拿到的数不知道截止到哪天 | `webui/server/proxy/mcp-proxy.ts:2710-2714`、`:1682-1687` | **真缺口 G5** |
| 8 | **Eval 要能拦住这类错** | Eval prompt **把正确答案的表名喂给 Agent** ⇒ 选表正确性**在结构上不可测** | `scripts/eval/eval-runner.mjs:1424-1433` | **真缺口 G6** |
| 9 | 同上 | `required_tool_input_regex` / `forbidden_tool_input_regex` **已实现且零使用**——「必须查某张表」的原语已在仓 | `scripts/eval/eval-runner.mjs:751-761`；`evals/` 内 0 命中 | **真缺口 G6**（资产已在仓） |
| 10 | 同上 | 122 条用例**无一来自真实生产问询**；`agent_reliability` 全 5 例 `expected_measures: []`、无数值断言 | `evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:145,178,207,236,268` | **真缺口 G6** |
| 11 | **100 人每天的体感要可见** | 无 per-user 体感分、无「首次问询成功率」、无 DAU 趋势、无 per-role 活跃人数 | `webui/server/admin/daily-question-kpi.ts:40-53`；`webui/server/admin/governance-observability.ts:962-988` | **真缺口 G7** |
| 12 | 同上 | **无任何主动告警**：唯一 SMTP 事件是「审计账本挂了」，与用户体感无关；Eval 侧无 alert 表、无连续跌破判定、无 webhook | `webui/server/notifications/health-events.ts:22-49`；`webui/server/eval/db.ts:9-94` | **真缺口 G7** |
| 13 | 同上 | **无用户反馈入口**；`docs/ui-ux-feedback/` 是人工台账，反馈→需求池管道纯手工单向 | `docs/ui-ux-feedback/README.md:26-34`、`:282-289` | **真缺口 G7** |
| 14 | **发布后要有回归** | Publish 后**无任何 Eval 被触发**；`postPublishEvalDomains` 仍把表名当 domain；且 `/eval/runs?domain=` 的 query **无人消费**（按钮既不触发也不筛选） | `webui/src/pages/publish/PublishWorkbench.tsx:415-416`、`:1206-1217`；`webui/src/pages/eval/RunList.tsx:34` | **真缺口 G8** |
| 15 | 同上 | `trigger` 写死 `'manual'`；CI 只校验 YAML 可解析（**不跑一条 Eval**）；`post_save_hook` 代码零实现 | `webui/server/eval/runner.ts:311`；`scripts/smoke/p0-business-eval-smoke.mjs:38-42` | **真缺口 G8** |

### 1.4 事故沟通实录（2026-11-07，客户：翊总；相关干系人：田总）

以下为事故发生后的三轮客户沟通原文要点。**这是本计划最重要的一手证据**——它把事故定性、修复口径和后续承诺都锁死了。

**第一轮（查后台后回复翊总）**
> 「我看了后台监控，您之前问的资产类问题，AI 取数取错了表，用的是 **GPU 计提成本表**，口径也是 **AI 自行加工**的，所以资产相关的回答不准，以资产看板为准。……我这边会在**语义层加约束：资产类问题只能从指定的资产表取数，并固定口径，不再让 AI 自行加工**。改完后我先自测一轮资产问答场景，确认准确后再跟您说。目前问数测评正在进行，您后面使用时我会同步盯后台回复，发现问题当天修正。」

**第二轮（解释根因与在建工作）**
> 「之前我们主要是把数据接进来，现在正在做的是让 AI 把数问对。**表一多，AI 自己不知道该选哪张，这次就是选错了**。我们现在在**梳理问题清单，给每类问题定好用哪张表、什么口径**，同时优化 skill，**每天跑测评、每天迭代**。预计下周能把常见的**损益、资金、资产、Token、GPU** 相关问题跑完一轮评测，到时候想跟您和田总对齐汇报一下，也收集一下您和田总想了解的场景，看能不能都覆盖住。我今天先把您账号对应的**资产台数等取数口径语义给 AI 优化好**。」

**第三轮（修复后回报）**
> 「我修改了语义文件，我这边**用您账号测试了一下**，您的角色权限下，后续问资产台数信息，我看回答的**表单是对的了**。您可以也在试试，后续如果使用上有问题，您随时找我。」

#### 1.4.1 沟通实录确立的六条事实（此前未知）

| # | 事实 | 对计划的影响 |
|---|---|---|
| **F1** | **错表已定性**：Agent 取的是 **GPU 计提成本表**，被问到的是**资产类问题**（资产台数） | **R9（真越权）可排除**。GPU 计提成本表是 CFO 角色**有权访问**的表，但业务语义完全不对 ⇒ 事故是**语义误报**，不是 ACL 越权。§3.2 的 R9 降级为「已排除」 |
| **F2** | **这是两个独立故障，不是一个**：① 选错表 ② **口径被 AI 自行加工** | 本计划 §4.1–4.4 只覆盖「选表」轴，**漏了「口径」轴**。Agent 选对了表也可能自行拼 measure／filter／粒度。**必须补一条口径约束缺口**（见新增 G9） |
| **F3** | **修复已落在语义层**（改语义文件），且**修复机制是「指定表 + 固定口径」的硬约束** | 验证了 §4.3（G3 表级门闩）的**同类思路可行**，但落点不同：不是在 Proxy 加门闩，而是**在语义层把口径写死**。这是**更便宜、已验证、当场生效**的路径 → 计划顺序须调整（§5 W1.5） |
| **F4** | **修复已用客户真实账号验证通过**（第三轮：表单对了） | 事故**已闭环止血**。剩余工作是**防复发**，不是**救火**。计划重心从「止损」转向「把人工承诺变成系统能力」 |
| **F5** | **已对客户做出两项持续承诺**：①「**每天跑测评、每天迭代**」②「**同步盯后台回复，发现问题当天修正**」 | 这两项**目前完全靠人力**（无自动触发、无告警、无 per-user 体感分——§4.7 G7）。**0.30 的 Eval 与运维投入，本质是把这两条人工承诺变成系统保证**。这是 0.30 投入的**最强商业理由**，也把 G7 从「锦上添花」升级为「**承诺兑现的载体**」 |
| **F6** | **已确立五类业务域作为评测覆盖范围**：损益、资金、资产、Token、GPU；且正在**梳理「问题清单 → 每类问题用哪张表、什么口径」** | 这份「问题清单」是 REQ-030-025（Eval 选表正确性）的**现成骨架**，也直接对应 REQ-030-023（选表语义暴露）的**绑定对象**。下一轮评测的覆盖面**已经有验收口径**，不再是开放式 |

#### 1.4.2 沟通实录暴露的新缺口（此前计划未覆盖）

| # | 缺口 | 证据 | 归入 |
|---|---|---|---|
| **G9** | **口径层无护栏**：只约束「选哪张表」不够；Agent 仍可在正确表上**自行加工 measure／filter／粒度／期间**。沟通实录明写「口径也是 AI 自行加工的」「不再让 AI 自行加工」 | 第一轮原文；现行护栏只管**字段歧义**与**用量**，无语义口径校验 | 新增 **REQ-030-027** |

#### 1.4.3 沟通实录带来的两处计划修正（**结论被翻转**）

1. **事故定性从「未决」改为「已定」**：F1 显示错表（CFO 有权的 GPU 成本表）⇒ **语义误报**，**ACL 越权排除**。原 D1「两条线并行取证」→ **收敛为单一产品防线线**；现场取证清单从「决定路线」降级为「留档与复核」。
2. **第一刀的排序变了**：原 §1.2 结论「第一刀是答复可核对性（G5）」**部分翻转**——
   - F3+F4 证明**语义层硬约束**是当场生效、当天验证、成本最低的止血手段，且**已经落地**；
   - 但 F3 也暴露它的**边界**：它是**逐条人工配置**的，**无法覆盖 100 人 × 未知问题**；
   - 因此正确结论是：**语义层硬约束是「立即止血 + 逐题固化」的并行轨，0.30 的系统能力（G3 门闩 + G5 可核对 + G6 Eval + G7 体感）才是「从人工到自动」的收敛轨**。两者不是二选一，**并行推进**。

### 1.5 本计划与客户承诺的对应关系

| 已对客户的承诺 | 现状 | 0.30 要交付的系统能力 | 池条目 |
|---|---|---|---|
| 「资产类问题只能从指定的资产表取数，并固定口径」 | **已手工落地**（改语义文件），逐题配置 | 泛化为「问题类型 → 唯一表 + 固定口径」的**可复用绑定机制** | REQ-030-023 / 027 |
| 「每天跑测评、每天迭代」 | **全靠人力**，无自动触发 | 发布即回归 + 选表断言 + 每日跑批 | REQ-030-025 |
| 「同步盯后台回复，发现问题当天修正」 | **全靠人力盯后台** | per-user 体感分 + 空结果率/慢标记/拒绝率**主动告警** | REQ-030-026 |
| 「下周跑完损益/资金/资产/Token/GPU 一轮评测」 | 五类域已定，**评测集尚不存在** | 五域问题清单 → Eval 用例（含选表断言与数值断言） | REQ-030-025 |
| 「跟翊总和田总对齐汇报、收集想了解的场景」 | 人工收集 | 场景 → 问题清单 → 用例 的回流通道 | REQ-030-025 / 026 |

> **0.30 的投入标准由此改变**：不是「把 Eval 做漂亮」，而是**「让公司已经对客户承诺的『每天迭代、当天修正』不再依赖某个人一直盯着后台」**。这是本计划全部排序的最终依据。

## 2. 已做且必须坚持的（不重复投入）

1. **ACL 是真裁决层**——安全判定在 `acl.check()`，instructions 永远只是建议层。`webui/server/proxy/acl.ts:3029-3224`；`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:25`
2. **修复提示的 ACL 内闭环（B15）**——提示目标须过 Schema／编译能力／对象存在／主体可见／可调用五项校验。**表级消歧必须复用这条闭环**，不得新造白名单。`webui/server/proxy/question-experience.ts:842-859`、`:1164-1240`
3. **结构化 provenance 已存在**——`connectionId/sourceName/measures/dimensions/filters/segments/orderBy/sourceResolution/truncation` 全在 `_meta.lucy.provenance`。G5 是**把它显式呈现给人**，不是重新造。`webui/server/proxy/mcp-proxy.ts:2643-2723`、`:2701-2718`
4. **审计侧表名溯源已存在**——`access_log_sources.physical_table` + 审计故事线「意图＝表＋维度＋指标」。G5 只差「暴露给终端用户」。`webui/server/proxy/mcp-proxy.ts:5482`；`docs/specs/lucy-20261104-audit-call-storyline-spec.md:140`
5. **问询旅程与失败预算**——`lucy_begin_question`／`lucy_continue_question`、20 次／120 秒预算、turn 归因。G8 的「发布即回归」与 G7 的「体感分」都复用它。`webui/server/proxy/question-experience.ts:9-12`
6. **真实问询口径已收口**——`conversation_turns` 按 `question_source ∈ {reported, reported_tool}` 去重。G7 直接复用，不新造口径。`webui/server/admin/daily-question-kpi.ts:183-191`
7. **唯一已跑通的主动通道是 SMTP**——outbox + 去重机制在，G7 的告警扩类复用它。`webui/server/notifications/health-events.ts:22-49`；`webui/server/notifications/outbox.ts:18-21`

## 3. 事故定性（2026-11-06 CFO 选表误报）

### 3.1 已实锤的因果链

```text
CFO：「资产的数量」
  │
  ├─ Agent 拿到 catalog：5 个 source，只有表名，无描述、无同义词、无粒度、纯字母序
  │    → 只能按**表名字符串相似度**猜表（asset / assets / asset_finance 都像「资产」）
  │    证据：webui/server/proxy/acl.ts:1986-1990、:2007-2015
  │
  ├─ instructions 对「多表命中先问用户」零规定；
  │    且对简单事实题主动推动最短路径（catalog → query → answer）
  │    → 「资产的数量」正是简单事实题，走最短路径 = 不澄清
  │    证据：webui/config/data-qa-instructions.md:30、:45-49；webui/server/proxy/mcp-proxy.ts:1874
  │
  ├─ 动态 role-aware instructions 整节丢弃了 fallback 的「问询范围确认」
  │    （fallback 只在角色什么都看不到时才返回 —— CFO 正常可见若干 source ⇒ 永远拿不到这一节）
  │    证据：webui/server/proxy/mcp-proxy.ts:1838、:1907-1909
  │
  ├─ ACL 逐表裁决只答「在不在我的权限里」，全文无语义判据 → 权限内的错表必然放行
  │    证据：webui/server/proxy/acl.ts:3029-3224、:3163-3168
  │
  ├─ 唯一歧义护栏只管同名字段跨源，且字段带限定名即跳过 → 限定名选错表完全不触发
  │    证据：webui/server/proxy/source-ambiguity.ts:105；webui/server/proxy/query-guardrails.ts:201
  │
  ├─ 错表恰好有同名字段/度量 → 查询静默成功，返回错误数字（这才是「严重误报」的形态；
  │    若错表没有该度量，上游会报 unknown measure 而失败，不会误报）
  │    证据：docs/SYSTEM_HANDBOOK.md:2677（现仅作人工 UAT 检查项）
  │
  └─ 答复侧：provenance 埋在 _meta.lucy，MCP 客户端不展示；自然语言 provenance 无强制；
       且 instructions 要求「先直接回答、再补口径」并「不要让 provenance 压过主答案」
       → CFO 一眼看不到表名，误报不可当场识破
        证据：webui/server/proxy/mcp-proxy.ts:2701-2718；webui/config/data-qa-instructions.md:34、:43、:69-75
  │
  └─ 【口径轴·第二条独立故障链】即使表选对，Agent 仍可自行加工口径：
       现行护栏只覆盖「字段歧义」（同名跨源）与「用法」（count(*)、聚合表达式），
       没有任何一处校验「这个 measure 组合／filter／粒度／期间是否就是业务口径」
       → 沟通实录第一轮：口径也是 AI 自行加工的
        证据：webui/server/proxy/query-guardrails.ts:295-344；webui/server/proxy/source-ambiguity.ts:97-114
```

### 3.2 根因候选清单（按可能性排序）

| # | 根因候选 | 能否解释本次事故 | 证据强度 |
|---|---|---|---|
| R1 | catalog 不携带业务语义 → Agent 只能按表名字符串相似度猜表 | **能**解释「为什么会选错表」；不能解释「为什么没被拦下」 | **实锤**：`acl.ts:1986-1990`、`:2007-2015`；`mcp-proxy.ts:930-940`（catalog `inputSchema.properties = {}`，**不能传查询词**，无法当检索用） |
| R2 | instructions 对多表命中零规定，且对简单事实题推动最短路径 | **能**解释「为什么直接答而不澄清」 | **实锤**：`data-qa-instructions.md:30`、`:45-49`；`mcp-proxy.ts:1871-1874` |
| R3 | ACL 只判权限不判语义 | **能**解释「误报为何能走到 CFO 面前」；**不能**解释越权（越权会被 deny） | **实锤**：`acl.ts:3029-3224`、`:283-292` |
| R4 | 歧义护栏只对未限定字段生效 | **能**解释「为什么现有防歧义没拦住」 | **实锤**：`source-ambiguity.ts:97-114`；`query-guardrails.ts:196-225` |
| R5 | 答案侧无强制 provenance、终端无核对入口 | **能**解释「为什么无人当场发现／纠正」 | **实锤**：`mcp-proxy.ts:2701-2718`；`data-qa-instructions.md:34`、`:43` |
| R6 | 选表正确性从未被 Eval 覆盖，且 eval prompt 直接把表名喂给 Agent | **不能**解释事故本身；解释**为什么这个缺陷能存活到 2026-11-06** | **实锤**：`eval-runner.mjs:1382-1435`；`evals/` 内 `required_tool_input_regex` 0 使用 |
| R7 | 表级描述在语义层存在却从不外露 | **能**解释（与 R1 同源），也是「补描述成本低、收益高」的论证 | **实锤**：`dataforai.yaml:169-171` vs `acl.ts:2007-2015` |
| R8 | 领域 Skill 里已有 intent→source 映射（`skills/domains/asset_finance/oi-bridge.skill.md:5-14`），但 instructions 只输出 title/description，**不输出 triggers 与 prerequisites.sources** | **部分能**解释——若 Agent 找到该 Skill 本可避免瞎猜 | **实锤**：`oi-bridge.skill.md:5-14`；`mcp-proxy.ts:1849-1851` |
| R9 | ~~**真越权**：若 CFO 角色是 `source_scope: catalog_bound` 或宽 `tableSelectors`，则 catalog 会列出大量表，Agent 选了**有权但业务上不该问**的表~~ | **已排除**（2026-11-07 沟通实录 F1）：错表是 GPU 计提成本表，CFO 角色**有权访问**，属业务语义错误 | **已排除**：客户沟通实录第一轮 |
| **R10** | **口径轴独立失守**：Agent 在表层之外**自行加工口径**——自造 measure／filter／粒度／期间组合，而非使用已发布语义 | **能**解释「口径也是 AI 自行加工的」（F2）。选对表也可能口径错 | **实锤**（客户沟通实录）：第一轮原话；现行护栏只覆盖字段歧义与用量，无语义口径校验 |

### 3.3 现场取证的最小清单（本仓不可达，必须现场取）

**这三条决定事故定性与后续处置优先级，不要跳过：**

1. **事故当次 `access_log` 行**的 `outcome` / `decision_reason` / `tables` / `access_log_sources.physical_table`
   - `outcome=denied` + `decision_reason` 属 `unknown_or_forbidden_connection:*` / `explicit_table_required:*` / `tool_forbidden*` / `sensitive_*` ⇒ **ACL 越权**，走安全缺陷线
   - `outcome=ok` + `decision_reason=allowed` + 目标表**在** capability 内 ⇒ **语义误报**，走产品防线线
   - 证据：`webui/server/proxy/mcp-proxy.ts:5482`（审计写入 `tables`）；`webui/server/__tests__/mcp-proxy-smoke.test.ts:405-411`（`outcome`/`decision_reason`/`tables`）、`:466-478`（`access_log_sources.physical_table`）
2. **客户侧 `access.yaml`** 中 CFO 角色的 `tableSelectors` / `source_scope` —— 确认可见表数量与是否 `catalog_bound`。口径见 `customer-config.example/webui/config/access.yaml:5-12`、`:33`
3. **客户侧 `semantic-layer/<connection>/_schema/<schema>.yaml`** 的 `descriptions` 覆盖率 —— 补齐仓库口径（本仓 30/30 非空）之外的现场口径

### 3.4 本仓取证边界（诚实声明）

- 客户现场的 `asset_finance` 语义层、当时的 `access.yaml`、2026-11-06 的审计库**都不在本仓**。本仓语义层只有 `demo-mysql` / `lucy-ops` / `mysql-aliyun(superstore)`。
- 因此「这次具体选错了哪张表」「是越权还是语义误报」**尚未定案**；但从 §3.1 看，**语义误报路径在代码上完全畅通（无任何拦截点）**，越权则必然留 deny 痕迹。
- KTX 上游行为（`sl_read_source` 是否返回 `_schema` 描述、错表同名字段的上游报错行为）**不在本仓，未取证**。Proxy 只做透传：`webui/server/proxy/mcp-proxy.ts:5594-5595`。
- **因此本计划把两条线都登记进池**（REQ-030-022 含 ACL 误报漏检的口径复核），不预判事故定性。

## 4. 九个真缺口

### 4.1 G1 选表语义暴露（资产已在仓，缺的是接线）

**现状**：`lucy_catalog` 每张表只返回 `connectionId / schema / sourceName / table`，**无描述、无同义词、无粒度、无业务域**，排序只有 `sourceName.localeCompare`（纯字母序）。`webui/server/proxy/acl.ts:1986-1990`、`:2007-2015`

**但描述已经存在**：`_schema/*.yaml` 的 `tables.<name>.descriptions.db/ai` 本仓实测 30/30 非空。`semantic-layer/mysql-aliyun/_schema/dataforai.yaml:169-171`

**落法（池内草案）**：把描述（＋建议新增：中文名、同义词、业务域、grain）接进 `lucyCatalog` 的 `sources[]`，并按业务词命中排序。**描述须按 source 绑定可见性裁剪**——`docs/specs/lucy-20261014-concept-dictionary-spec.md:13` 已提示元数据侧信道风险。

**可复用资产**：① `_schema` 描述（本仓已 30/30）；② `webui/server/live-tables.ts:73-81` 已在采集 DB `table_comment`（可作兜底描述源）；③ `webui/server/proxy/query-guardrails.ts:72-153` 已有现成 YAML 遍历器（**但其 `SourceYaml` 类型连 description 字段都没定义**，见 `:42-46`）。

**不做**：不新增 synonyms 字段到 KTX 合同；不把「知识图谱式选表」当 0.30 目标（`wo-20261014-concept-dictionary.md:50-52` 已预见同一根因，其 `full/alias_only/none` 三档门控与 "Ignorance is Bliss" 是**后续方向**，不进 0.30）。

### 4.2 G2 多表命中先问（instructions 层，最便宜）

**现状**：instructions 对「多张表都可能命中」**零规定**。唯一的「先问」规则只覆盖**指代与双意图**，且明写「代理不实现确认门闩」。`webui/config/data-qa-instructions.md:45-49`

**更糟**：动态 role-aware instructions **整节丢弃**了这一节——fallback 只在 `catalog.connections.length === 0 && catalog.sources.length === 0 && accessibleSkills.length === 0` 时返回。`webui/server/proxy/mcp-proxy.ts:1838`、`:1907-1909`

**落法（池内草案）**：把「问询范围确认」扩展到「多表命中」，并**并入动态 instructions**（现成条文可直接搬，无需新写）。

**不做**：**只改 instructions 不加 tool 面门闩仍是软约束**——G2 单独上线价值有限，必须与 G3 同批。

### 4.3 G3 表级歧义门闩（tool 面，唯一的硬拦截点）

**现状**：唯一的歧义机制是 `ambiguousFieldHint`——收集**跨源的同名字段**，候选 < 2 个就不提示（`:105`）；且 `query-guardrails.ts:201` **字段带点即跳过**，所以 Agent 用限定名（instructions **要求**用限定名）选了错表时，护栏完全不触发。`webui/server/proxy/source-ambiguity.ts:56-79`、`:97-114`；`webui/server/proxy/query-guardrails.ts:196-225`、`:295-344`

**落法（池内草案）**：当业务词命中 ≥2 个可见 source 时，`lucy_query` 前返回**候选表清单＋各自度量覆盖**，要求显式确认；Agent 用限定名选了表但同词命中多表时，给 `stop` + 候选清单。

**安全硬约束**：候选表必须复用 `denialAllowList` / `buildRepairClosure` 的 ACL 裁剪闭环，**保证候选不泄漏越权表**。`webui/server/proxy/question-experience.ts:1027-1037`

**不做**：不做跨角色推荐；不自动选表（**选择权留给人/Agent**，门闩只提供依据）；不改 ACL 裁决口径。

### 4.4 G4 ACL 边界澄清（不是缺陷，是口径）

**现状**：ACL 粒度到「表/source + 行级谓词」，**无列级、度量级、语义级判据**。`webui/server/proxy/acl.ts:283-292`、`:3029-3224`；`webui/server/proxy/row-policy.ts:55-64`

**结论**：**ACL 拦得住越权，拦不住权限内的语义错报**——这不是 bug，是职责边界。**绝不能**把「选表正确性」塞进 ACL（那是授权层，不是语义层）；但也**不能**因此认为 ACL 失效。

**落法（池内草案）**：把这条边界**写进口径文档并对外说清**——「数据权限正确」≠「答案正确」，两者是不同保证，避免客户把 ACL 通过误读为数据可信。

### 4.5 G5 答复可核对性（第一优先，CFO 侧的止损）

**现状三缺**：

| 缺什么 | 证据 |
|---|---|
| provenance 埋在 `_meta.lucy`，MCP 客户端默认不展示 → CFO 看不到表名 | `webui/server/proxy/mcp-proxy.ts:2701-2718` |
| 自然语言 provenance 只是 instructions 约定，**无 schema 校验、无 Eval 断言、无运行时检查**；且 instructions 要求「先直接回答、再补口径」「不要让 provenance 压过主答案」→ 鼓励把口径埋在末尾 | `webui/config/data-qa-instructions.md:34`、`:43`、`:69-75` |
| `freshness.status` **恒 `not_checked`**，物理时效**恒 `null`**；受保护源上 `lucy_freshness` 还被直接拒 | `webui/server/proxy/mcp-proxy.ts:2710-2714`、`:1682-1687`；`webui/server/proxy/acl.ts:2944-2948` |

**落法（池内草案）**：① 把 provenance 从「instructions 约定」升级为**结构化合同**（答复必须带 source＋measure＋filters＋数据截止期）；② 把 `_meta.lucy.provenance` **显式呈现给终端用户**；③ 给 CFO 一个只读核对入口（问询 ID → 查了哪张表／什么口径），复用审计侧已有的「意图＝表＋维度＋指标」派生与 `access_log_sources.physical_table`。

**不做**：不改 ACL；不改数值本身；不做「自动纠错」——**可核对不等于自动正确**，CFO 的自证权不可被收走。

### 4.6 G6 Eval 选表正确性（检出器）

**现状（三个结构性缺陷）**：

1. **eval prompt 把正确答案喂给 Agent**：`composeQuestion` 把 `expected_measures` 拼成 `superstore_orders.<measure>` 进 prompt，**表名被直接告知 ⇒ 选表正确性不可能被测出**。`scripts/eval/eval-runner.mjs:1424-1433`
2. **无跨表歧义用例**：122 条用例无一来自真实生产问询；`agent_reliability` 全 5 例 `expected_measures: []`、无 SQL 断言、无数值断言。`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:145,178,207,236,268`
3. **能力已在仓但零使用**：`required_tool_input_regex` / `forbidden_tool_input_regex` 可断言「用了哪个 source」，`evals/` 内 **0 命中**。`scripts/eval/eval-runner.mjs:751-761`

**附带发现（独立缺陷，同批可修）**：`composeQuestion` 只对 `domain === 'kx_financial'` 分支（`:1414`），`chatbi_intl` 100 例落进 superstore 分支，**prompt 里被告知 `superstore_orders.*`（错误表名）** ⇒ 该套件 100 例的选表结论**均不可信**。

**落法（池内草案）**：① 先修 `composeQuestion` 的表名泄漏（把「告知正确表」改成「列候选表让 Agent 自己选」）；② 用 `required_tool_input_regex` 断言「必须用 source X」＋`forbidden_tool_input_regex` 断言「禁止用 source Y」；③ 新增跨表歧义问题（「资产的数量」这类）；④ 真实问句回灌（走 REQ-030-020 的审计旅程→用例草稿通道）。

**不做**：不自动改工具面；不把客户原始问句直接落 YAML（沿用 `evals/agent_reliability` 的脱敏合成约定）。

### 4.7 G7 存量用户体感仪表盘（100 人的那 100 分）

**现状**：有一堆**全局**指标，**没有一个 per-user 体感分**。

| 缺 | 证据 |
|---|---|
| 无 per-user 顺畅度（成功率／空结果率／慢标记率／拒绝率合成单分） | `webui/server/admin/daily-question-kpi.ts:40-53`（KPI 全集）；`webui/server/admin/governance-observability.ts:962-988`（每 Agent 只有 calls/denied/errors） |
| 无「首次问询成功率」 | 全仓无 `first_question` 类字段 |
| 无 DAU 趋势（`dailyQuestions` 是问询量，不是人数） | `webui/server/admin/daily-question-kpi.ts:310-322` |
| 按角色只到**调用数**，不到**活跃人数** | `webui/server/admin/governance-observability.ts:786-822` |
| **无任何主动告警**：唯一 SMTP 事件是「审计账本挂了」；Eval 侧无 alert 表、无连续跌破判定、无 webhook | `webui/server/notifications/health-events.ts:22-49`；`webui/server/eval/db.ts:9-94`；`webui/server/eval/monitor.ts:19-26`（`consecutiveFailThreshold` 只存取、无判定） |
| **无用户反馈入口** | `webui/src` 无反馈组件；`docs/ui-ux-feedback/README.md:26-34`、`:282-289` 为人工台账 |
| **「界面使用视图」统计错对象**：`visitorCount` 是 WebUI 操作员（`COUNT(DISTINCT admin_id)`），**不是 100 个业务用户**——C-level 走 MCP 客户端，不产生 `ui_page_views` | `webui/server/admin/ui-usage.ts:546-594` |

**落法（池内草案）**：① **per-user 体感分**（真实问询数＋空结果率＋慢标记率＋拒绝率）落成聚合视图，在 `/admin/usage` 数据访问视图给一列——**复用 `daily-question-kpi.ts` 的 session 聚合范式，不新造表**；② SMTP outbox 扩事件类（问询成功率跌破阈值、某用户连续 N 次空结果）——**复用现有去重机制，改造成本最低**；③ 一个最小用户反馈入口。

**不做**：不做 per-user 排名或绩效化用途（这是运维观测，不是考核工具）；不把四张卡加总成一个数（沿用既有口径纪律）。

### 4.8 G8 发布即回归（Eval 侧的最后一公里）

**现状**：`trigger` 写死 `'manual'`；CI 只校验 YAML 可解析（**不跑一条 Eval**、只覆盖 superstore、门槛 1 条 case）；`post_save_hook` **代码零实现**；Publish 后**无任何 Eval 被触发**；`postPublishEvalDomains` 仍把表名当 domain；`/eval/runs?domain=` 的 query **无人消费**——那个「触发 Run」按钮**既不触发也不筛选**。`webui/server/eval/runner.ts:311`；`scripts/smoke/p0-business-eval-smoke.mjs:38-42`；`webui/src/pages/publish/PublishWorkbench.tsx:415-416`、`:1206-1217`；`webui/src/pages/eval/RunList.tsx:34`

**落法（池内草案）**：发布成功后 enqueue 受影响 domain 的 smoke 回归；修 domain 映射（表名≠domain）；让 RunList 消费 `?domain=`。

**不做**：不因 smoke FAIL 自动回滚 Publish（P0 咨询性）；不在 CI 里塞 LLM full eval。

### 4.9 G9 口径固化（沟通实录新增的第二条故障轴）

**现状**：现行护栏覆盖的是**字段歧义**（同名跨源）与**用法**（`count(*)` 无源、聚合表达式误用），**没有任何一处校验「这个 measure 组合／filter／粒度／期间是否就是业务口径」**。`webui/server/proxy/query-guardrails.ts:295-344`；`webui/server/proxy/source-ambiguity.ts:97-114`

**客户原话**：「口径也是 **AI 自行加工**的」「固定口径，**不再让 AI 自行加工**」。⇒ **选对表也可能口径错**——只在表层设防会漏。

**已验证的手工路径（F3）**：改语义文件，把资产类问题的表与口径**写死在语义层**，客户真实账号复测通过。这条路径**当场生效、当天可验、成本最低**，应继续作为「逐题固化」的并行轨使用。

**落法（池内草案）**：把这套手工固化**泛化为可复用的绑定机制**——「问题类型／意图 → 唯一表 + 固定口径」的声明式绑定，由语义层发布、Proxy 消费；Agent 命中绑定时直接取已发布口径，不允许自由拼装 measure／filter／粒度。

**与 G3 的分工**：G3 解决「选哪张表」（多表命中时门闩），G9 解决「在这张表上按什么口径算」（命中后不得自行加工）。**两者串联才完整**——只做 G3，Agent 会在正确表上自行造口径；只做 G9，它连表都选不对。

**不做**：不改已发布语义层的数值定义；不做运行时自动推断口径（口径必须是人定的，不是算出来的）；不把口径绑定塞进 ACL（那是授权层）。

## 5. 实施顺序（建议）

> **排序依据已由沟通实录改写**（§1.4.3、§1.5）：事故**已止血**（F3+F4），剩余工作是**防复发**；且 0.30 的投入标准是**把「每天迭代、当天修正」的人工承诺变成系统保证**。

> **两个顺序，别混用**（2026-11-07 对齐）：
> - **Spec／Plan 撰写批次** → 以 [功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md) §2.1 的 **S1–S6** 为准（那是跟进主表，已批准分批）。
> - **实现波次（本表 W1–W7）** → 以本表为准；两者**不冲突**，因为本波次落在「落地冻结」期之前尚不存在，撰写批次服务于评审、实现波次服务于将来授权后的施工顺序。
> - 差异点只有一处：清单池把 **023（Catalog 语义暴露）** 排在 **022（答复可核对）** 之前，本表相反。**撰写阶段按清单池走（S2 已开 023）；实现阶段建议按本表走（022 先于 023）**——理由是 022 让误报当场可识破，是止损；023 是降发生率。若委托人另有裁定，以裁定为准并回写本表。

| 波次 | 缺口 | 理由 | 依赖 |
|---|---|---|---|
| **W0** | ~~事故定性~~ **已完成**（F1：语义误报，ACL 越权排除）＋ 现场取证**留档** | 定性已由沟通实录完成；审计行保留作复核与后续监控基线 | 无 |
| **W1** | **并行轨 A：语义层硬约束**（G9 手工路径，已落地） | **已在跑**：逐题固化「资产 → 指定表 + 固定口径」。继续推进至五域（损益/资金/资产/Token/GPU）全覆盖 | 无 |
| **W2** | **G5 答复可核对性** | **系统轨第一优先**。即便选表仍会错，误报**当场可识破**；且这是把「每天盯后台」变「系统自动看」的必要条件 | 无 |
| **W3** | **G9 口径绑定的可复用化** ＋ **G3 表级门闩** ＋ **G2 instructions 合并** | 把 W1 的手工路径泛化；硬拦截点 + 软约束须同批 | 依赖 W2 的 provenance 形状稳定 |
| **W4** | **G1 选表语义暴露** | 资产已在仓，接线成本低；给 G3 提供「哪些表算命中」的依据 | 可与 W3 并行（文件不重叠） |
| **W5** | **G6 Eval 选表正确性 + 口径断言**（五域：损益/资金/资产/Token/GPU） | 检出器；**已有验收口径**（F6：下周跑完一轮）。前置是 W3、W4 | 建议在 W3、W4 之后 |
| **W6** | **G7 体感仪表盘 + 主动告警** | 把「发现问题当天修正」从人力变系统；per-user 体感分复用 W2 的 provenance 与既有 KPI 聚合 | 依赖 W2 |
| **W7** | **G8 发布即回归** | 最后一公里；把 W5 的选表断言变成发布前的闸门 | 依赖 W5 |

W1（手工逐题固化）与 W2–W7（系统能力建设）**并行推进**：前者覆盖已知高频问题，后者覆盖 100 人 × 未知问题。W2／W4 可并行（答复面 vs 目录面）。

## 6. 开工前置

任何条目从需求池进入实施前，必须依次满足（沿用需求池 §开工前置）：

1. **需求澄清**：与委托人确认诉求边界、与现行约束冲突项与不做项，结论写回池条目。
2. **独立 Spec**：另立 `docs/specs/lucy-YYYYMMDD-<slug>-spec.md`，含「核心流程（伪代码）」与「闭口层级」。
3. **Plan**：另立 `docs/plans/lucy-YYYYMMDD-<slug>-plan.md`，登记进 [`docs/plans/README.md`](README.md)。
4. **开发授权**：获得明确开工授权后，才可改代码。

未满足上述四步时，条目状态保持 Deferred。

**本计划特有的前置约束**：

- **W0 未完成前，不开 G3／G5 的 Spec**——事故若定性为真越权（§3.3 信号一），则优先级要重排：ACL 侧口径复核必须先行于产品防线。
- G1／G3 涉及 MCP 响应与目录形状变更 → 须同步核对 `webui/docs/07-mcp-auth-proxy-spec.md` 与客户端兼容面（Claude Code / Codex / Cursor）。
- G5 涉及答复面 → 须走 WebUI 设计规范四段式（`webui/docs/design-system/30-pr-compliance-template.md`）。
- G6／G8 产出用例与回归 → 须先确认脱敏口径，沿用 `docs/governance/eval-quiz-conventions.md`（**注：该文档现无脱敏条款，是缺口，见 REQ-030-026**）。
- **全部缺口不得把「可核对」表述成安全边界**：instructions 是 fail-open 建议层，裁决始终在 Proxy + ACL。
- **全部缺口不得把「体感分」表述成考核指标**：per-user 观测只服务运维定位。

## 7. 验收

- **本条（Plan 级）验收**：§1.3 对拍表每行都有 `file:line` 证据；**八个缺口**各自登记为池条目（REQ-030-022…027）且状态为 Deferred；§1.4 沟通实录确立的事实与暴露的缺口已逐条映射；Plan 五类小节齐备；`npm run lint:spec-docs` 通过。
- **条目级验收**：在各自 Spec 中完成，**不在本计划内验收**。
- **本计划不产出功能验收结论**，也不作为任何版本的发布取证。

## 8. 完成定义

- 本文件存在、可被索引登记、五类小节齐备。
- **八个缺口**各有池条目，来源可追到本文、事故、**客户沟通实录**与取证结论。
- §1.4 的六条事实已写入本计划并映射到具体缺口；事故定性（F1）**已定**，现场取证清单降级为留档复核。
- §1.5 的**五项客户承诺**逐项对应到具体池条目与系统能力，无「无对应条目」的承诺。
- 拍板结论写回 §10 对应条目；被否决的方向写明「不做」，不回抄成待办。
- 本轮**不改任何运行代码**，不改现行协议形状，不改 `0.30` 以外的版本范围。

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| ~~**把未定性当成已定性**~~ | ~~越权与语义误报两条线优先级不同~~ | **已消解**：F1 确认错表为 CFO 有权访问的 GPU 计提成本表 ⇒ 语义误报，ACL 越权排除 |
| **只修表层、漏了口径轴** | Agent 选对表仍可自行加工口径（客户原话） | G9 独立成条；G3（选表）与 G9（口径）串联才完整 |
| **语义层硬约束被当成 0.30 的全部** | 手工逐题固化无法覆盖 100 人 × 未知问题 | W1（并行轨 A）与 W2–W7（系统轨）并行；G9 的可复用化列为 W3 |
| **人工承诺兑现依赖个人** | 「每天跑测评、当天修正」目前靠人力盯后台，人一走就断 | G7 的 per-user 体感分 + 主动告警是兑现载体；0.30 投入标准据此重定义（§1.5） |
| **只做 instructions 不做门闩** | instructions 是 fail-open 建议层，软约束挡不住误报 | G2 与 G3 同批；G5 先落地，把「可核对」变成硬要求 |
| **候选表泄漏越权名** | 候选来自可见域，配置漂移可能夹带越权表 | 候选必须复用 `denialAllowList` / `buildRepairClosure` 既有闭环，不新造白名单 |
| **把可核对做成安全边界** | 「告诉你来源」不等于「不给你越权数据」 | 每条非目标写明「可核对 ≠ 自动正确」；裁决始终在 Proxy + ACL |
| **元数据侧信道** | 描述进 prompt 可能泄漏不可见表信息 | 描述按 source 绑定可见性裁剪；沿用 `lucy-20261014-concept-dictionary-spec.md:13` 的警示与 `wo-20261014-concept-dictionary.md:76-81` 的三档门控思路 |
| **Eval 改成候选表模式后现有 122 条用例结论失效** | 去掉表名泄漏会改变 prompt 语义，通过率会变 | 该变更须单独 Spec 授权，并**明确换基线**，不得与新断言混在一次跑批里比较 |
| **`chatbi_intl` 套件结论不可信** | 100 例 prompt 被告知错误表名 | 独立于本事故的既有缺陷；与 G6 同批修，并**声明该套件历史通过率不可引用** |
| **per-user 体感分被当考核工具** | 一旦进入绩效场景，观测会失真 | 写明非目标；不进角色考核流；只服务运维定位 |
| **把「告警扩类」做成噪声源** | SMTP 事件类型只有 3 种，扩类无先例 | 先做一两个高价值事件（成功率跌破、连续空结果），复用现有去重 |
| **事故被当成个案而非模式** | 100 人规模下同类误报会重复发生 | G6 的跨表歧义用例集须覆盖业务高频歧义词（资产／收入／成本／用户） |

## 10. 待拍板决策点

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **D1** | ~~**事故定性与处置优先级**~~ **已定**（F1） | ~~(a) 取证后分流 / (b) 语义误报线 / (c) 只取证~~ | **已消解**：错表 = GPU 计提成本表，CFO 有权访问 ⇒ **语义误报**，ACL 越权排除。取证清单降级为留档复核 |
| **D2** | **第一刀是 G5（可核对）还是 G9+G3（口径＋消歧）** | (a) G5 先；(b) G9+G3 先；(c) G5 与 G9 可复用化并行 | **(c)**——沟通实录证明：语义层硬约束当场生效且已验证（W1 并行轨），但它**逐题手工**、覆盖不了未知问题；而 G5 是把「盯后台」变「系统自动看」的入口。**W1 继续跑，W2（W2 编号冲突时以 §5 波次表为准）起 G5** |
| **D3** | **G3 门闩的强度** | (a) 只提示候选表，不停；(b) 多表命中时 `stop` 要求显式 source | **(b) 与空结果 guidance 的 D2 结论一致**（提示不阻断），但**多表命中是「选错就必错」，与空结果「查得到但没数」不同**——建议 (b)，仍不做跨角色推荐与自动选表 |
| **D4** | **G1 是否同时引入 synonyms 字段** | (a) 只接已有 descriptions；(b) 新增 synonyms 到语义层 | **(a)**——synonyms 需 KTX 侧合同配合，0.30 不碰上游；同义词问题留给后续概念词典方向 |
| **D5** | **G6 的 Eval 改造是否换基线** | (a) 换基线并声明历史不可比；(b) 不换 | **(a)**——prompt 语义变了，不换基线会把「选表变难导致的通过率下降」误读成回归 |
| **D6** | **G7 的体感分是否进 0.30** | (a) 进（G7 是 100 人主线）；(b) 只做 per-user 分，告警延后；(c) 整体延后 | **(a) 且升为最高商业优先级**——G7 是「每天迭代、当天修正」这条**客户承诺**的兑现载体（§1.5）；拆两批：**先做 per-user 分与 SMTP 扩类**（低成本、复用现成机制），反馈入口可后置 |
| **D7** | **本轮是否直接开 G5 的 Spec** | (a) 只留池条目；(b) 同轮开 Spec | **(b)**——事故已止血（不再有「是否走错线」的前置疑问），G5 是系统轨第一优先，同轮开 Spec 省一轮往返 |
| **D8** | **G9 口径绑定的粒度** | (a) 问题类型级绑定（资产类 → 资产表 + 固定口径）；(b) 逐 question 绑定 | **(a) 问题类型级**——与客户承诺的「资产类问题只能从指定资产表取数」一致，且可覆盖 100 人 × 未知具体问法；逐 question 绑定不可扩展 |
| **D9** | **五域评测（损益/资金/资产/Token/GPU）的验收口径** | (a) 只测选表正确；(b) 选表 + 数值 + 口径三层 | **(b)**——F2 证明口径轴同样会错，只测选表会漏；三层都要有断言 |

## 11. 刻意不做

- **不把选表正确性塞进 ACL**——ACL 是授权层，语义正确性是另一层；混在一起会让「权限通过」被误读为「数据可信」。
- **不自动选表**——门闩只提供候选与依据，选择权留给人/Agent。系统替人选表只是把误报换成另一种不可解释的误报。
- **不自动推断口径**——口径必须由人定义并发布，运行时只做「按已发布口径执行」，不做「推断出业务应该算什么」。F2 正是自行加工口径导致的误报。
- **不做「自动纠错」或「自动改表重查」**——可核对 ≠ 自动正确；CFO 的自证权不可被收走。
- **不把体感分做成排名或考核**——这是运维观测，不是人事工具。
- **不搬 AWS/CLI 那套特例**——Lucy 的路径是 Token + Role + Proxy；跨客户端比**同一治理面下的完成率**，不比形态。
- **不碰 KTX 上游合同**——synonyms、概念词典都留后续方向。

## 12. 关联

- 需求池：[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 同日分支计划（Eval 与旅程方向）：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md)
- Eval 运营闭环原始方案（多项未落地）：[`2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md`](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)
- MCP Proxy 合同：[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md)
- 修复提示与失败分类合同：[`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md)
- 审计调用链故事线：[`docs/specs/lucy-20261104-audit-call-storyline-spec.md`](../specs/lucy-20261104-audit-call-storyline-spec.md)
- 概念词典（未实现，方向参考）：[`docs/specs/lucy-20261014-concept-dictionary-spec.md`](../specs/lucy-20261014-concept-dictionary-spec.md)
- Eval / Quiz 约定：[`docs/governance/eval-quiz-conventions.md`](../governance/eval-quiz-conventions.md)
- 运行时指导源：[`webui/config/data-qa-instructions.md`](../../webui/config/data-qa-instructions.md)
