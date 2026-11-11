# 存量用户体感仪表盘与主动告警 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.3-draft** |
| 日期 / 目标版本 | 2026-11-07（v0.3 修订 2026-11-09）/ 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-7**；需求池 **REQ-030-026** / **P0** |
| 状态 | **v0.3-draft；Cursor 过程对抗已修订（2026-11-09）；终稿未确权；冻结落地；未授权实现**。批次 R1 已修订。本版闭合合同缺口（空窗不得写成 0、读取接口不得入队、O1 未闭合时体感分保持不可用）。**不是** R2-F。须 Codex CLI 终审或委托人明示确权，并闭合 O1–O6、另授开发授权后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。现行阶段只接受评审与修订。实施须：§评审门禁 R1–R4（见功能清单池 §2.2）全部通过 |
| 决策来源 | 2026-11-07 产品对话（100 用户 / C-level 体感）；客户沟通实录两项持续承诺：「每天跑测评、每天迭代」「同步盯后台回复，发现问题当天修正」——目前靠人力；本条是把「发现问题当天修正」变成系统可观测＋可告警的载体 |
| 需求来源 | [需求池 REQ-030-026](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线 §4.7 G7](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池 P0-7](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[核心方向](../plans/lucy-20261107-lucy-0-30-core-direction.md) |
| 实施主体 | Lucy：Admin 读取聚合（`daily-question-kpi` 范式）＋ SMTP outbox 事件类扩展。不改 KTX 源码；不新造体感统计表 |
| 配套 Plan | [lucy-20261107-stored-user-experience-dashboard-alerts-plan.md](../plans/lucy-20261107-stored-user-experience-dashboard-alerts-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[2026-11-09 过程推进](../reviews/2026-11-09-p0-6-p0-7-p0-b-spec-advance.md)（过程修订，**不是** R2-F） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **复用，不另造第二套真实问询口径。** 真实问询／会话类／问询活跃 Agent 沿用 Spec 194（[`lucy-20261030-access-grade-and-daily-question-kpi-spec.md`](lucy-20261030-access-grade-and-daily-question-kpi-spec.md)）已收口的 `conversation_turns`＋`access_log` 读取派生。空结果审计标记沿用 Spec 162 `result_empty`。SMTP outbox／去重沿用 L25-05 通知合同；`health-events.ts` 今日只接审计账本健康，本条**扩展事件类**，不替换账本通道。界面使用 `visitorCount`（Spec 148「近 N 访问账户」）继续只表示 WebUI 操作员，**不得**与本条 MCP／问询 DAU 混称 |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.2-draft | 批次 R1：补审计库不可用分支；`is_slow_call` 不自定阈值 |
| v0.3-draft | **Cursor 过程对抗**：空窗率与人数禁止写成 0；Admin 读取不得入队；O1 未闭合时体感分只允许不可用。O1–O6 补建议包 E，**未闭合**。开放决策守卫移出风险表。**不构成 R2-F／R4** |

## 闭口层级

- 层级：功能合同
- 本条承诺：运维在数据访问视图可见最小体感面——窗口内 **per-user 体感分**（读取时聚合，不新表；O1 未闭合时为不可用）、**首次成功率／空结果率／拒绝率**可见、**按日问询活跃人数趋势**与 **按角色活跃人数**（不是调用次数）；当配置的体感阈值跌破或某用户连续空结果达到阈值时，经既有 SMTP outbox＋去重发出主动邮件。反馈入口见 **O4**。
- 本条出口：SC-01a／SC-01b ＋ SC-02–SC-17（见 §7）。聚合纯函数／API 单测；告警 enqueue／dedupe 单测；术语与对象混称禁令断言；`lint:spec-docs` 通过。
- 不在本条出口：完整运营中台、per-user 排名／绩效 HR 用途、把多张卡加总成一个 vanity 总分、Eval 跌破 webhook（Eval 侧另条）、浏览器签字／Playwright／移动窄屏、镜像／部署／上线、改 Spec 194 真实问询分子定义。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- User Experience Score：协议／字段名 `experienceScore`，中文主称「体感分」。指对单一 `user_id` 在窗口内、基于真实问询会话聚合派生的 **0–100 观测分**（或 `null`/`unavailable`）。**运维定位用，不是考核分。**
- First Success Rate：字段名 `firstSuccessRate`，中文主称「首次成功率」。窗口内「该用户本窗第一次带查数的真实问询旅程是否一次得到非空成功结果」的比率（精确分子分母见 §5／O1）。
- Empty Result Rate：字段名 `emptyResultRate`，中文主称「空结果率」。窗口内查数成功且 `result_empty` 的问询占比（沿用 Spec 162 标记，不另造空结果定义）。
- Denial Rate：字段名 `denialRate`，中文主称「拒绝率」。窗口内问询旅程中出现 `outcome=denied` 的比率（口径见 §5；不含认证失败 `auth_error`）。
- Question DAU：字段名 `questionDau`，中文主称「近 N 问询活跃人数」／按日「问询 DAU」。窗口或上海日内至少产生 1 条 Spec 194 原文真实问询（或纳入问询活跃人口的未上报查数会话——与 Spec 194「问询活跃 Agent」同一人口边界）的去重 `user_id` 人数。**不是** `dailyQuestions` 问询条数，也**不是**界面使用「近 N 访问账户」。
- Role Active Users：字段名 `roleActiveUsers`，中文主称「按角色活跃人数」。某角色在窗口内落入问询活跃人口的去重人数。**禁止**用调用次数（`usageCount`）冒充。
- Experience Alert：事件类前缀 `experience_*`，中文主称「体感告警」。经 SMTP outbox 投递的阈值跌破／连续空结果等事件；与 `audit_ledger_*` 并列，不互相替代。

Forbidden:

- 把「体感分」写成绩效、排名、KPI 考核、HR 用途文案或按分排序的排行榜主视图。
- 把多张体感相关 Metric Card **加总／加权合成一张 vanity 总分卡**对外展示（卡片保持分列；体感分是 **per-user 列／行级字段**，不是全局一张「平台健康总分」）。
- 把界面使用 `visitorCount`／「近 N 访问账户」写成业务用户 DAU、MCP 用户数或「100 个用户」的分子。
- 把 `dailyQuestions`（问询条数）写成「人数」或 DAU。
- 把治理概览角色 `usageCount`（调用数／配置拼装）写成「按角色活跃人数」。
- 另起第二套「真实问询」口径（禁止绕开 Spec 194 `conversation_turns` 原文条件）。
- 把体感告警塞进安全账本真源；outbox 仍是「应发通知」队列，不是审计事实源。

落位：本条术语属 **使用概况／运行状态**面，落术语标准 **§4.5（访问治理 / 使用概况）**；实现前补标准条目。用户可见卡名用中文主称。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- Spec 194：`docs/specs/lucy-20261030-access-grade-and-daily-question-kpi-spec.md`
- Spec 148／166：界面使用与页面访问折线（明确本条不改该视图对象）
- Spec 162：`result_empty`／问询体验证据
- L25-05 SMTP／outbox（`webui/server/notifications/`）
- `webui/docs/00-product-terminology-standard.md`

### What This Change Follows

- [ ] 落在既有 `/admin/usage` **数据访问**视图；不新开顶级导航；不改 `?view=interface` 的对象语义。
- [ ] 体感相关指标用既有 Metric Card／表格式样；**分列展示**，不加「平台总分」大卡。
- [ ] per-user 体感以表格列或可展开行呈现；**默认不按体感分排序为排行榜**（可按问询数或时间；排序若开放须无「绩效」文案）。
- [ ] Agent／`user_id`／工具名／角色 id 在 DOM 上 `translate="no"`。
- [ ] 告警本身无营销面；邮件文案中文、事实型、含窗口与阈值，不含用户隐私原文问句（见 D8）。

### Exceptions (If Any)

- 首期可不做独立「体感」子路由；全部挂在数据访问视图扩展区。
- 最小反馈入口若 O4＝P0-min：允许一个轻量入口（如页脚／问询侧「反馈」链到已有台账或单字段 POST），不做成社交产品。

### Follow-up Needed

- 反馈入口完整产品化、Eval 连续跌破告警、Webhook／IM 通道 → 另立 Spec。
- 与 P0-4 答复可核对块的「当天修正」工单联动 UI → 两 Spec 收口后组合。

---

## 1. 背景与取证

### 1.1 承诺升级

已对客户承诺「发现问题当天修正」「每天跑测评、每天迭代」，今日无 per-user 体感分、无问询成功率跌破告警、无连续空结果告警——运维只能人肉盯后台。本条是 G7／REQ-030-026 的功能合同，把观测与主动通知最小落地。

### 1.2 现行缺口（已核实）

| # | 事实 | 证据 |
|---|---|---|
| E1 | KPI 全集无 per-user 顺畅度／体感分 | `webui/server/admin/daily-question-kpi.ts` 导出字段；误报计划 §4.7 |
| E2 | 无「首次问询成功率」字段 | 全仓无 `first_question`／`firstSuccess` 类聚合 |
| E3 | `dailyQuestions` 是问询量不是人数 | `daily-question-kpi.ts` 按日行 |
| E4 | 治理角色侧到调用数，不到活跃人数 | `governance-observability.ts` `usageCount` |
| E5 | SMTP 唯一业务事件类是审计账本健康；`health-events.ts` 只订 `onAuditHealthTransition` | `notifications/health-events.ts`；`NotificationEventType` 仅 `audit_ledger_*`／`smtp_test` |
| E6 | 无用户反馈产品入口 | **无用户反馈产品入口**（`webui/src` 内的 "feedback" 字样均指复制／文案反馈，如 `webui/src/pages/Onboarding.tsx:460,495`）；`docs/ui-ux-feedback/README.md` 为人工台账 |
| E7 | 界面使用 `visitorCount`＝`COUNT(DISTINCT admin_id)`，不是 MCP 业务用户 | `ui-usage.ts`；C-level 走 MCP 不产生 `ui_page_views` |

### 1.3 取证缺口（不得当事实）

- 客户现场「100 用户」与当前 `access.yaml` 配置人数是否一一对应：未取证；本条人口以审计日志出现的 `user_id` 为准（与 Spec 194 问询活跃人口同纪律）。
- 连续空结果的业务可接受 N、成功率阈值：见 **O2／O3**，开工前必答。

---

## 2. 目标

1. **读取时派生** per-user 体感分与三项率（首次成功／空结果／拒绝），挂到 `/admin/usage` 数据访问视图——**复用 `daily-question-kpi` session 聚合范式，不新造表、不回写 `access_log`／`conversation_turns`。**
2. 提供 **问询 DAU** 按日人数趋势，以及 **按角色活跃人数**（去重 `user_id`），与调用次数分列。
3. 扩展 SMTP **outbox 事件类**（至少：窗口成功率／体感相关阈值跌破；某用户连续 N 次空结果），复用既有 enqueue／dedupe／worker；账本健康通道保持不变。
4. （可选，O4）最小用户反馈入口，使「用户反馈 → 需求／台账」不再纯靠线下。
5. 文案与 API 字段纪律：永不混淆界面操作员 UV 与问询 DAU；永不把体感分表述为考核。

---

## 3. 非目标

| 不做 | 原因 |
|---|---|
| per-user 排名榜、绩效化、HR 用途 | 运维观测，不是考核工具（REQ／G7 明文） |
| 把多张指标卡加总成一个 vanity 平台总分 | 沿用既有口径纪律；体感分只在用户行 |
| 第二套真实问询口径 | 复用 Spec 194 `conversation_turns` |
| 新统计表／定时物化汇总表 | 与 Spec 194／189 一样读取派生；规模允许时用 SQL 聚合 |
| 改界面使用 `visitorCount` 语义去「冒充」业务 DAU | 对象不同；应新增问询 DAU，不重定义访问账户 |
| 替换或关闭 `audit_ledger_*` 告警 | 只扩展事件类 |
| Eval 连续失败 webhook／alert 表 | 误报计划另缺口；本条只做用户体感事件类 |
| 完整反馈社区／工单系统 | P0 最小或延期（O4） |
| 改 KTX／改 ACL 裁决语义 | 本条只读观测＋通知 |

---

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 全部体感指标 **读取时聚合**；不新造 `experience_*` 表；不回写审计行 | **冻结** |
| **D2** | 真实问询分子／会话类／问询活跃人口 **严格复用 Spec 194**；本条只在该人口上叠加结果态（空／拒绝／首次成功）与 per-user 滚动 | **冻结** |
| **D3** | UI 挂载点：`/admin/usage` 默认 **数据访问**视图；`?view=interface` 不请求、不展示本条字段 | **冻结** |
| **D4** | 全局面：分列卡——首次成功率、空结果率、拒绝率、问询 DAU（人数）；**禁止**第四张「加权总分」全局卡 | **冻结** |
| **D5** | per-user 面：表列 `experienceScore` ＋ 三项率微文／副列；默认排序不得以「绩效」为名；**不提供「体感排行榜」主模式** | **冻结** |
| **D6** | 按角色：新增 `activeUserCount`（问询活跃去重人数）；保留既有 `usageCount` 若仍有治理用途则改标签避免「活跃」歧义，或分列展示 | **冻结方向**；标签文案见术语 |
| **D7** | 告警通道：扩展 `NotificationEventType`（建议 `experience_threshold_breach`、`experience_consecutive_empty`）；新建 `experience-events`（或等价）适配器订阅聚合判定，**调用既有** `enqueueNotification`／`notificationDedupKey`；**不**把判定写进 `health-events.ts` 账本订阅 | **冻结** |
| **D8** | 告警 payload：含 `user_id`（可哈希展示策略见 O5）、窗口、指标名、阈值、观测值、`incidentId`；**禁止**原文问句、生成 SQL、行级业务数据 | **冻结** |
| **D9** | SMTP profile：新增独立开关（建议 `notifications.experienceAlerts`），与 `auditHealth` 正交；关则只算仪表盘不入队 | **冻结方向**；键名见 O6 |
| **D10** | 空结果定义：查数工具成功且审计 `result_empty=1`（Spec 162）；不得把 denied／error 算进空结果率分子 | **冻结** |
| **D11** | 拒绝率：默认用量业务调用或问询旅程上 `outcome=denied`；**不含** `auth_error`；评测探针排除纪律同 Spec 189／194 | **冻结** |
| **D12** | Admin 读取接口只计算并返回指标，**不得**调用 `enqueueNotification`。入队只发生在 `experienceMonitorTick` | **冻结** |
| **D13** | O1 未闭合时，`experienceScore` 只能是 `null`，`experienceState` 只能是 `unavailable`。禁止实现者自选权重。首次成功率、空结果率、拒绝率、问询 DAU 不依赖 O1 | **冻结** |
| **O1** | 体感分公式：输入权重（真实问询数门槛、空结果率、慢标记率、拒绝率、首次成功）与缺失时 `unavailable` 规则 | **开工前必答** |
| **O2** | 阈值跌破：全局首次成功率／空结果率／拒绝率的默认阈值与窗口（如 24h／7d） | **开工前必答** |
| **O3** | 连续空结果 N（建议默认 3）与去重键粒度（per-user per-day vs per-incident streak id） | **开工前必答** |
| **O4** | 最小反馈入口：**P0-min**（单入口写入本地台账或 admin-only API）vs **本版延期** | **开工前必答**；范围紧时允许 defer 并在清单池登记 |
| **O5** | 邮件是否全文暴露 `user_id` 明文，或仅 token_hash_prefix／角色 | **开工前必答** |
| **O6** | profile JSON 键名与热加载是否沿用现网 SMTP profile 解析 | **开工前必答** |

> **开放决策守卫**：O1–O6 闭合前不得实现对应分支。缺省 fail-closed。闭合须由委托人在开发授权前书面裁定。评审通过不等于 O 项闭合。

### 4.1 建议裁定（未闭合）

建议包 E。委托人可整包采纳；未采纳前 O1–O6 仍是开工前必答。

| 项 | 建议 |
|---|---|
| O1 | `realQuestions < 1` 时分为不可用。否则 `score = clamp(0, 100, round(100 - 40×空结果率 - 30×拒绝率 - 20×慢标记率 - 10×(首次成功 ? 0 : 1)))`。某一率的分母为 0 时，该项惩罚按 0 计，不把缺样本当成 100% 失败。`round` 为四舍五入，恰好 .5 向正无穷 |
| O2 | 默认滚动 24 小时。仅当该率状态为可用时告警：首次成功率低于 0.5，或空结果率高于 0.4，或拒绝率高于 0.2。`no_data`／`unavailable` 不告警。回到阈值内时入队一次恢复事件，去重键含指标与窗口桶 |
| O3 | N＝3。同一 `user_id` 最近的成功查数若尾部连续 `result_empty=1` 达到 3，中间出现非空成功则打断。去重键按用户加上海日期，同一天只入队一次 |
| O4 | **延期**。反馈入口不在本条出口。若以后改为最小入口，须另升版本补验收 |
| O5 | 邮件只含角色 id 与 `user_id` 的 sha256 前 8 位。不含明文用户 id、问句、SQL、行级业务值 |
| O6 | 键名 `notifications.experienceAlerts`，布尔，缺省 false。解析与热加载与现网 `notifications.auditHealth` 同级且互不影响 |

---

## 5. 数据模型（Normative）

### 5.1 读取聚合（无新表）

输入（只读）：

- `conversation_turns`：Spec 194 原文真实问询（`question_source ∈ {reported_tool, reported}`）
- `access_log`：访问等级、查数行、`outcome`、`result_empty`、`is_slow_call`、`user_id`、`lucy_session_id`／`lucy_turn_id`、`role_ids`
  - ⚠️ **`is_slow_call` 的口径不在本条自定**：依 `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:329`——`lucy_query` 的 `duration_ms >= 5000`，或问询墙钟 `>= 120000`。本条只**读取**该字段，不得另定阈值。

输出形状（示意）：

```ts
// 全局窗口摘要（挂 overview）
type ExperienceOverview = {
  firstSuccessRate: QuestionMetric;   // Spec 194 QuestionMetric 形状
  emptyResultRate: QuestionMetric;
  denialRate: QuestionMetric;
  questionDau: QuestionMetric;        // 人数，不是问询条数
  dailyQuestionDau: Array<{ date: string; partialDay: boolean; activeUsers: number }>;
  // 禁止：platformScore / totalExperience 一类全局加总字段
};

// per-user 行
type UserExperienceRow = {
  userId: string;
  realQuestions: number;
  experienceScore: number | null;     // 0–100 or null
  experienceState: QuestionMetricState;
  firstSuccess: boolean | null;       // 本窗是否存在「首次成功」；无问询则 null
  emptyResultRate: number | null;
  denialRate: number | null;
  slowMarkRate: number | null;        // 可选副指标；进 O1 公式。口径依 Spec 162 :329（duration_ms>=5000 或问询墙钟>=120000），本条不自定阈值
};

// 按角色
type RoleActiveUsersRow = {
  roleId: string;
  activeUserCount: number;            // 问询活跃去重人数
  // usageCount 若保留：不得在 UI 标成「活跃人数」
};
```

### 5.2 首次成功（已冻结；权重仍属 O1）

对每个问询活跃人口中的 `user_id`：

1. 取该用户窗口内按时间排序的**第一次**查数归属问询旅程。
2. 「成功」＝该旅程存在查数 `outcome=ok` 且 **非** `result_empty`，且该旅程没有 `outcome=denied`。不满足则为 false。
3. `firstSuccessRate`＝`firstSuccess===true` 的用户数／问询活跃用户数。分母 0 → `no_data`，**不得**写成 0。
4. 体感分权重只在 O1。O1 未闭合时按 D13 返回不可用，不影响本款布尔值。

### 5.3 告警事件类

| eventType | 触发 | incidentId／dedupe 建议 |
|---|---|---|
| `experience_threshold_breach` | 全局某率越过 O2 阈值（含恢复事件是否成对：见 O2） | `exp-threshold:{metricId}:{windowKey}:{bucket}` |
| `experience_consecutive_empty` | 同一 `user_id` 连续 N 次空结果查数（O3） | `exp-empty:{userKey}:{streakId}` |
| 既有 `audit_ledger_*`／`smtp_test` | 不变 | 不变 |

判定只在 `experienceMonitorTick`。Admin 读取路径禁止入队（D12）。入队必须走 outbox，不得同步 SMTP I/O 挡 Admin API（沿用 L25-05 D04）。O2／O3 未闭合时 tick 直接返回，不自选阈值。

---

## 6. 核心流程（伪代码）

```text
# —— 仪表盘读取（Admin API）——
on GET /api/admin/governance/overview?hours=...  (or dedicated experience fields):
  window := buildMetricWindow(hours)          # 同 Spec 194
  # ⚠️ 审计库不可用是**独立于空库的第三态**，必须先判：
  #    空库（库可读但窗口内无数据）→ no_data；库不可用（读失败）→ unavailable。
  #    既有实现已备好 unavailableQuestionKpi(win, "audit_db_unavailable")
  #    （webui/server/admin/daily-question-kpi.ts:131），本条直接复用。
  if not auditDbAvailable():
      emit unavailable_metrics(reason = "audit_db_unavailable")   # 不得回落成 0／no_data
      return
  turns := loadReportedTurns(window)          # Spec 194 D2
  logs := loadAccessLog(window)               # exclude eval probes per Spec 189/194
  if turns is empty and logs is empty:
      emit no_data_metrics()                  # 空库态（SC-01a）
      return

  population := questionActiveUserIds(turns, logs)   # Spec 194 问询活跃人口

  for userId in population:
    userTurns := turns.filter(userId)
    userLogs := logs.filter(userId)
    firstOk := computeFirstSuccess(userTurns, userLogs)     # §5.2 / O1
    emptyRate := countEmptyQueries(userLogs) / countQueries(userLogs)
    denialRate := countDenied(userLogs) / countDefaultUsage(userLogs)
    slowRate := countSlow(userLogs) / countQueries(userLogs)
    score := composeExperienceScore(...)   # O1 未闭合 → null / unavailable（D13）
    emit UserExperienceRow(...)
    # MUST NOT enqueueNotification on this read path（D12）

  overview.firstSuccessRate := count(firstSuccess == true) / count(population)   # 分母 0 → no_data（口径见 §5.2）
  overview.emptyResultRate := globalEmptyRate(logs)
  overview.denialRate := globalDenialRate(logs)
  overview.questionDau := |population|
  overview.dailyQuestionDau := shanghaiDailyDistinctUsers(population, turns, logs)
  overview.roles[*].activeUserCount := distinctUsersPerRole(population, role_ids)
  # MUST NOT emit platform vanity total
  # MUST NOT reuse ui-usage.visitorCount

# —— 体感告警（适配器；非账本 health-events）——
on experienceMonitorTick(now):
  view := getSmtpRuntimeView()
  if not view.enabled or view.profile.notifications.experienceAlerts != true: return

  overview := computeExperienceOverview(defaultWindow)  # same pure functions as API
  for metric in [firstSuccessRate, emptyResultRate, denialRate]:
    if breaches(metric, thresholds):                     # O2
      enqueueNotification({
        eventType: "experience_threshold_breach",
        incidentId: dedupeId(metric, window),
        payload: redact(metric, thresholds),             # D8: no question text
        recipients: view.profile.recipients
      })

  for userId in population:
    streak := consecutiveEmptyTail(userId)               # O3
    if streak >= N:
      enqueueNotification({
        eventType: "experience_consecutive_empty",
        incidentId: dedupeId(userId, streak),
        payload: redactUser(userId, streak),             # O5
        recipients: view.profile.recipients
      })

# health-events.ts 继续只处理 audit_ledger_* —— 本条不得把体验判定塞进该订阅
```

关键失败／`unavailable` 分支须映射到 §7 SC。

---

## 7. 验收（SC-01a／SC-01b ＋ SC-02–SC-17）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01a | **空库窗口**：三项率与问询 DAU 为 `no_data`，数值不得为 0，且无抛错 | 单测 |
| SC-01b | **审计库不可用窗口**：各项指标为 `unavailable`（带 `reason = "audit_db_unavailable"`），**不得**回落成 0 或 `no_data`，且无抛错 | 单测（复用既有 `unavailableQuestionKpi`，`webui/server/admin/daily-question-kpi.ts:131`） |
| SC-02 | 仅原文真实问询计入人口；推断问询／会话访问不进问询 DAU | 单测（对齐 Spec 194） |
| SC-03 | 全局空结果率分子只含 `result_empty` 成功查数；denied／error 不计入空结果分子 | 单测 |
| SC-04 | 拒绝率不含 `auth_error`；评测探针不计入 | 单测 |
| SC-05 | 首次成功率分母＝问询活跃人数；分子＝首次非空成功用户数；分母 0 → `no_data` | 单测 |
| SC-06 | O1 闭合后，per-user `experienceScore` 由该公式得出。O1 未闭合时分数只能是 `null`／`unavailable`，夹具若出现其他分数即失败 | 单测 |
| SC-07 | API／UI 契约**不存在**全局 vanity 加总字段（无 `platformScore`／等价） | 契约单测 |
| SC-08 | `dailyQuestionDau[].activeUsers` 是去重人数；同日两问同一用户计 1 | 单测 |
| SC-09 | `roleActiveUsers`／`activeUserCount` 是去重人数，不等于调用次数夹具 | 单测 |
| SC-10 | `?view=interface` 路径不请求本条 experience 字段；`visitorCount` 语义不被本条改写 | 前端或 API 契约测 |
| SC-11 | `experience_threshold_breach` 入队走 outbox；同 incidentId＋eventType 去重 `duplicate=true` | outbox 单测 |
| SC-12 | `experience_consecutive_empty` 在 N 次空结果后入队；N-1 不入队 | 单测 |
| SC-13 | `notifications.experienceAlerts!=true` 或 SMTP 未启用时：仪表盘仍可读，**零**体验事件入队 | 单测 |
| SC-14 | `health-events` 仍只处理账本事件；体验入队不经过账本 transition 订阅 | 单测／静态边界 |
| SC-15 | 告警 payload 无问句原文、无 SQL、无行级业务值 | 单测 |
| SC-16 | `lint:spec-docs` 对本 Spec／Plan 退出码 0；术语小节形状合规 | 门禁 |
| SC-17 | Admin 读取路径零次 `enqueueNotification`；同一窗口的 tick 在阈值闭合且跌破时才会入队 | 单测 |

全部 SC **未执行**。O1 未闭合时 SC-06 只断言「不可用」。O2／O3 未闭合时 SC-11／SC-12 保持未关闭。O4 未闭合时不存在反馈入口验收。本条收口不表示可上线。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 体感分被当成考核 | 术语 Forbidden＋UI 无排行榜主模式；文档与帮助文案明示「运维观测」 |
| 与界面 UV 混读导致「100 用户」误判 | SC-10；卡片标题强制「问询活跃人数」 |
| O1 公式争议阻塞 | D13：未闭合时分数不可用；建议包 E 可整包采纳 |
| 告警风暴 | 去重＋独立开关；读取路径不入队（D12） |
| 读取聚合变慢 | 窗口有界；禁止无窗口全表扫描；必要时后续另立物化 Spec |
| 反馈入口拖垮 P0 | O4 建议延期；未裁定前不做入口 |

---

## 9. 关联

- 清单：P0-7；依赖波次上建议在 P0-4（可核对）之后（误报计划 W6），**本阶段只开 Spec／Plan，不实现**
- Plan：`docs/plans/lucy-20261107-stored-user-experience-dashboard-alerts-plan.md`
- 上游：Spec 194；Spec 162 `result_empty`；L25-05 outbox
- 明确非对象：Spec 148 `visitorCount`／访问账户
