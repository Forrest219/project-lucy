# 问询预算主路径逃生 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v1.1** |
| 日期 | 2026-11-22 |
| 功能编号 / 优先级 | **REQ-030-095／清单 P1-74**；修订 Spec 162 §7.2 与窗口 Spec 的**逃生档数／可达性／新问询通道** / P1（主路径可用性） |
| 阶段 | S4 |
| 状态 | S4｜**v1.1**。**实现已落地**（Lane A/B/C 入工作树，未提交；开发授权已执行；实现 CR **APPROVE**，见 [reviews/2026-11-22-p174-budget-escape-implementation-cr](../reviews/2026-11-22-p174-budget-escape-implementation-cr.md)）；**待验收**——平滑升级后 UAT [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md)＝**PASS WITH GAPS**（R0／01–06／08／09A-B-C／10B／11／12 功能轴 PASS；**BESC-07／10A 环境 BLOCKED**；全量 Wave D 分母因 fixture token 轮换另案）；≠ 完整 PASS；≠ 功能合同收口；≠ 可上线 |（Lane A Proxy 核心／Lane B compat／Lane C 指导；实现 CR **APPROVE**，见 [reviews/2026-11-22-p174-budget-escape-implementation-cr](../reviews/2026-11-22-p174-budget-escape-implementation-cr.md)）；平滑升级后 UAT [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md)＝**PASS WITH GAPS**（R0／01–06／08／09A-B-C／10B／11／12 功能轴 PASS；**BESC-07／10A 环境 BLOCKED**；全量 Wave D 分母因 fixture token 轮换另案）；≠ 完整 PASS；≠ 功能合同收口；≠ 可上线 |
| 终审记录 | [Spec／Plan／UAT 终稿审阅](../reviews/2026-11-22-question-budget-mainpath-escape-final-review.md)：文档设计闭环通过；事故修复与 UAT 未执行 |
| 决策来源 | 2026-11-22 委托人：合法用户额度用尽后必须有 fallback；不得因异常拦截误伤正常长问询体感。同日批准修订建议并定稿。取证见 [`inbox/2026-11-22-question-budget-pm-scenario-report.md`](../../inbox/2026-11-22-question-budget-pm-scenario-report.md)、[`docs/lessons/2026-11-22-question-budget-exhausted-recurring.md`](../lessons/2026-11-22-question-budget-exhausted-recurring.md) |
| 与既有 Spec 的关系 | **修订** Spec 162 §7.2 的续查档数与「再问」可达性，以及窗口 Spec（`lucy-20261029-question-budget-window-optimization-spec`）在 **begin 不可用** 时的逃生合同。**不改** 60／300 默认阈值（REQ-030-033）、settled busy、稳定作用域键、失败四维度、旁路纳管。与 P1-60（零绑定隐藏 begin／`begin_not_available`）**正交互补**：P1-60 保证无绑定可直接问数；本条保证问数过程中触顶后仍有主路径逃生，且硬停后可**显式新开问询** |
| 实施主体 | Lucy（Proxy 问询预算层 + initialize 指导 + 本仓 MCP compat／UAT 判定）；不修改 KTX 源码 |
| 台账号 | 无（挂 0.30 总账 P1-74，非 v0.25 登记册） |
| 部署实况 | **纯 MCP**（Cursor／Claude／Codex／WorkBuddy 等经 Bearer 接入）。不得默认有 WebUI person／宿主 attestation。零绑定（begin 隐藏）与有绑定（begin 可用）两种实况均须验收；**无 session 客户端**须能走新开通道，不得依赖 `new_mcp_session` 作唯一自救 |

## 闭口层级

- 层级：功能合同
- 本条承诺：runaway 防火墙仍生效；额度用尽后合法用户在声明的纯 MCP 实况下仍有可达 fallback（**同一问询续查**＋**硬停后新开问询**）；预算终止不得被产品面／门禁误报为权限拒绝；本仓 compat 对 Wave D 类场景须能端到端成交（不只改分类文案）。
- 本条出口：SC-E1–E10（须同时覆盖「触顶」与「触顶后成交」与「硬停后再开」）。
- 不在本条出口：客户镜像／现场交付、整包发布取证、再放宽 60／300、恢复 inactive begin 写预算副作用。
- 上线关系：本条收口不表示可上线。

---

## 1. 问题

问询预算防火墙（60 次数据工具／300s settled busy）对 runaway Agent **仍有必要**。但现行组合在真实 MCP 问数上把合法长问询逼进无逃生死角：

1. **换窗依赖成功的 `lucy_begin_question`**（窗口 Spec：「新问询即新额度」）。
2. **P1-60 零绑定**下 begin 隐藏，强制调用返回 `begin_not_available` 且**不重置预算**——这是 P1-60 合同，不是本条要推翻的。
3. 续查默认仅 **1** 档。续查用尽后，同 identity＋无／同 session 桶上后续 `lucy_query` 稳定 `question_budget_exhausted`。
4. 即便把续查加到 5 档，硬停后仍无「开始新业务问询」通道；无 session 客户端无法靠新 session 自救 → 「五续即死」。
5. 门禁／Agent 常把预算终止说成「权限拒绝／new deny」，误诊放大体感伤害。
6. 本仓 MCP compat runner 缺 session／不 continue／begin 失败仍带陈旧 turn → Wave D 即便改分类也难成交。

2026-11-22 Wave D 证据：同跑次 41／41 begin 失败；`allow_readonly` 大量 `question_budget_exhausted`；其他 identity 仍可出数——证明是**桶耗尽＋逃生不可达**，不是 Proxy 宕机。

**一句话根因**：约束生效路径完整，**合法用户触顶后的 fallback（含硬停后新开）在零绑定／无 session 实况下合同失效**。违反 [`DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「主路径可用性优先」。

---

## 2. 目标与非目标

### 2.1 目标

1. **保留防火墙**：单窗仍先到为准触顶；触顶仍返回 `question_budget_exhausted`／`budget_stop`（不是 ACL deny）。
2. **同一问询 fallback**：在纯 MCP、含零绑定实况下，合法用户触顶后仍能通过显式 `lucy_continue_question`（默认 `mode=continue`）多档续查完成长问询（inactive 默认 5 档）。
3. **新问询 fallback**：续查档用尽硬停后，同一 Token、无 session 亦可经显式 `lucy_continue_question` **`mode=new_question`** 重置窗与续查计数后再成交；**不**恢复 begin 写副作用。
4. **有绑定实况不回退**：begin 可用时仍「新问询即新额度」；续查默认 1 档可保持（见 D2）。
5. **语义分列**：产品指导、停机载荷与本仓判定器不得把预算终止写成权限拒绝；`exhausted`／`concurrency_exceeded`／`unavailable` 分列。
6. **双覆盖＋硬停再开验收**：UAT／自动化必须同时验「触顶拦得住」「触顶后续查成交」「硬停后 new_question 再成交」。
7. **compat 成交链**：本仓 runner 修复 session／begin N 路径／continue＋重试，使 Wave D 类场景可端到端出数（见 Plan Task 4／4b）。

### 2.2 非目标

- 不取消问询预算，不关闭 `LUCY_QUESTION_BUDGET`。
- 不在本条再次放宽 60／300（已由 REQ-030-033 完成）。
- 不自动、静默在无用户／Agent 动作时清零额度（禁止 idle 自动换窗冒充逃生）。
- 不要求用户打开 WebUI、重签 Token 作为**唯一**逃生（重签可作运维对照，不得写进用户主路径合同）。
- 不改行权限／失败四维度定义。**允许**为预算逃生调整 `lucy_continue_question` 工具可见性／授予（见 D7）；不借机改写一般 ACL 产品面。
- 不改 KTX；不授权客户镜像／上线。
- 不强制把预算停机改成 MCP `result.isError=true`（见 D8）。

---

## 3. 术语 Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 中文主术语 | 约束 |
|---|---|---|
| Budget escape | 预算逃生 | 额度用尽后、仍属同一防火墙合同内的**可达继续路径**；含续查与新开；禁止写成「自动续跑无上限」 |
| Hard budget stop | 预算硬停 | 续查档数用尽后的停机；`continuable=false`（续查意义下）；须给可执行 `mode=new_question` 下一步；仍禁止写成权限拒绝 |
| New question reopen | 新问询重开 | `lucy_continue_question` 的 `mode=new_question`：预算专用重置窗＋续查计数；无 begin 副作用 |

既有词条沿用：「问询预算」「可继续」「预算终止」。`question_budget_exhausted` 出现在 DOM／协议字段时保持 `translate="no"`。

---

## 4. 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 零绑定下长问询触顶后常无可达 continue／换窗；硬停后无新开；Agent 误报权限 | 触顶可见预算终止；多档续查；硬停后 `mode=new_question` 同 Token 再开；指导不引导报 ACL | ↑ | SC-E1–E4、SC-E7、SC-E9–E10 | — |
| P2 治理方 | 不直接消费预算门禁 | 可为逃生可达性调整 continue 工具授予；不改行权限产品面 | ＝ | D7 范围窄 | — |
| P3 运维方 | UAT／compat 假红成 deny；重签 Token 成唯一自救 | 门禁分列；compat 可成交；重签不再是唯一手段 | ↑ | SC-E5、SC-E6、SC-E10 | — |
| P4 管理层 | 无直接面 | 无直接面 | ＝ | 不改概览／审计摘要合同 | — |

---

## 5. 决策表（已冻结）

| 编号 | 决策 | 选项 | 冻结 | 状态 |
|---|---|---|---|---|
| **D1** | 单窗额度 | (a) 保持 60／300 (b) 再放宽 | **(a)** | **已冻结** |
| **D2** | 续查档数 | (a) begin **active**：`maxContinuations=1`；begin **inactive／不可用**：`maxContinuations=5`（常量可配置，默认 5）(b) 一律 5 (c) inactive 无限 | **(a)** | **已冻结** |
| **D3** | 逃生动作 | (a) **必须**显式调用 `lucy_continue_question`（含 `mode`）才换窗／重开 (b) 下一次 `lucy_query` 自动换窗 | **(a)** | **已冻结** |
| **D4** | 硬停语义 | (a) 续查意义下 `continuable=false`＋结构化 `next_step` 指向 **`mode=new_question`**（运维清桶／新 session 仅作次要对照）；文案禁 ACL (b) 仅 reason 码 | **(a)** | **已冻结** |
| **D5** | 指导与门禁 | (a) initialize 指导写清 continue／new_question 分支；本仓 compat／UAT 按 reason **分列**，禁止记成 deny (b) 只改指导 | **(a)** | **已冻结** |
| **D6** | 与 P1-60 | (a) **不**恢复隐藏期 begin 写预算副作用；逃生只走 continue 加档＋`mode=new_question` (b) inactive 下允许 begin 偷偷 reset | **(a)** | **已冻结** |
| **D7** | 新问询通道与可达性 | (a) 扩展 `lucy_continue_question`：`mode=continue`（默认）／`mode=new_question`；凡可调用计费数据工具的身份在预算开启时**必须**能调用该工具（数据问数能力隐含逃生可达，或等价授予）；不另开独立工具 (b) 新独立工具 (c) 硬停后只靠新 Token／session | **(a)** | **已冻结** |
| **D8** | MCP `isError` | (a) **保持软信封**：停机结果以 JSON＋`reason` 表达；**不**强制 `result.isError=true` (b) 改为 `isError=true`＋旧客户端合同 | **(a)** | **已冻结** |
| **D9** | Plan／Wave D 范围 | (a) **本 Plan 含** compat runner 成交链修复（session／begin N／continue＋重试／禁陈旧 turn／同 Token 两跑成交）(b) runner 另开 REQ | **(a)** | **已冻结** |

### D2 推荐理由（已采纳）

- begin **active** 时「再问＝begin＝新额度」仍成立，1 次续查足够窗口 Spec 原合同。
- begin **inactive** 时换窗通道被 P1-60 合法关闭；若不加档，防火墙变成无逃生硬门禁。
- 每档仍须显式 continue → 非静默穿透；**但** Agent 可自动连点 continue，故上界须写明（见 §5.1），不得假装「显式＝人工」。
- 反对无限续查：次数上限名存实亡。

### D7 理由（已采纳）

- 拆开「同一问询续查」与「开始新问询」；闭合对抗审阅 B0-1。
- 不新开工具面；`mode=new_question` 清零窗与续查计数，**禁止**恢复 begin 写副作用。
- 无 session／长期零绑定不得依赖 `new_mcp_session`／`await_begin_active` 作主路径。

### D8 理由（已采纳）

- 现行预算停机已是软信封；强制 `isError=true` 属静默协议变更。判定器／指导按 `reason` 分列即可。

### §5.1 资源上界（须披露）

| 量 | 口径 |
|---|---|
| 单窗 | 60 次计费数据工具；或 settled busy ≥ 300s（先到为准） |
| inactive 同一问询最多窗数 | `1 + 5 = 6`（初始窗＋5 次续查换窗） |
| 同一问询调用上界 | 约 **360** 次计费调用（非无限） |
| 多窗 Lucy 等待上界 | 按既有阈值 Spec 派生，约从单窗量级放大到约 **4680s** 量级（实现／运维须知情；本条接受该代价以换主路径可达） |
| `mode=new_question` | 开启**新的**问询生命周期；再次适用上述上界；仍须显式调用，禁止 idle 自动重开 |

「显式工具调用」≠「人工确认」。runaway Agent 也能连点 continue／new_question；防火墙仍提供**有界**停机信号与审计，而不是靠「显式」否定放大。

---

## 6. 核心流程（伪代码）

```text
# 新增持久字段：continuationPolicy、generation、pendingReopen。
# pendingToken 即 pendingContinuation；所有声明、消费、结算、begin 共用同一作用域锁。
# 参与态只在新生命周期建立时读取并冻结；unknown／读失败按 inactive 并审计。
# 旧行缺 continuationPolicy 时仅按持久 turnId 推导一次（有 turn=active，否则 inactive）并落库；
# 不得在同一生命周期重启后按当前参与态重新快照。

function maxContinuationsFor(state):
  return state.continuationPolicy == "active" ? 1 : INACTIVE_MAX_CONTINUATIONS  # 默认 5

function onBudgetStop(state, capability):
  creditLeft = state.continuations < maxContinuationsFor(state)
  canContinue = creditLeft and capability.canCallBudgetEscapeTool()
  canReopen = not creditLeft and (
    state.continuationPolicy == "active"
      ? capability.canCallBeginQuestion()
      : capability.canCallBudgetEscapeTool()
  )
  payload = {
    reason: "question_budget_exhausted",
    outcome: "budget_stop",          # legacy outcome；执行结论另记 budget_stopped
    continuable: canContinue,        # 只表示 mode=continue 的剩余额度与能力
    continueToken: canContinue || (canReopen && state.continuationPolicy != "active")
      ? state.presentedToken : omit_field,
    next_step: canContinue
      ? { action: "lucy_continue_question", mode: "continue", then: "retry_data_tool" }
      : canReopen && state.continuationPolicy == "active"
        ? { action: "lucy_begin_question", then: "retry_data_tool" }
        : canReopen
          ? { action: "lucy_continue_question", mode: "new_question", then: "retry_data_tool" }
          : { action: "hard_budget_stop", hints: ["ops_clear_scope"] }
  }
  audit(budget_stop, payload)
  return soft_tool_result(payload)   # D8：不强制 result.isError=true

function onLucyContinueQuestion(args):
  mode = args.mode ?? "continue"
  token = args.token
  if mode not in {"continue", "new_question"}: return invalid_arguments
  withScopeSerialization(scopeKey):
    state = loadState(scopeKey)       # 含恢复；不可用则 question_budget_unavailable

    if mode == "new_question":
      if state.continuationPolicy == "active": return use_begin_question
      if not isExhausted(state) or state.continuations < maxContinuationsFor(state):
        return not_hard_stopped       # 不得用新开绕过同一问询剩余续查档
      if token != state.presentedToken: return mismatch
      if pendingReopenMatches(state, token, round, windowId, generation):
        return ok_idempotent_reopen
      if hasPending(state): return pending_exists
      candidate = clone(state)
      candidate.pendingReopen = { token, round, windowId, generation }
      commit(candidate, "reopen:<round>:<windowId>:<generation>:<token>")
      audit(budget_reopen_declared)
      return ok_declared_reopen       # 本调用不换窗

    if state.continuations >= maxContinuationsFor(state):
      return hard_stop_payload_with_reopen_hint()
    if not isExhausted(state): return not_exhausted
    if token != state.presentedToken: return mismatch
    if state.pendingToken == token: return ok_idempotent_continue
    if hasPending(state): return pending_exists
    candidate = clone(state)
    candidate.pendingToken = token
    commit(candidate, "declare:<round>:<windowId>:<generation>:<token>")
    audit(budget_continuation_declared)
    return ok_declared               # 本调用不换窗

function onNextBilledDataTool():
  withScopeSerialization(scopeKey):
    state = loadState(scopeKey)
    candidate = clone(state)
    rolloverEvent = null
    oldTurnId = state.turnId
    if state.pendingReopen:
      archiveCurrentWindowBusy(candidate)
      candidate.round += 1
      candidate.windowId += 1
      candidate.generation += 1
      candidate.calls = 0; candidate.busyMs = 0; candidate.continuations = 0
      candidate.turnId = null          # 不生成上报 turn；预算行解除旧归属
      candidate.continuationPolicy = "inactive"
      candidate.startedAt = now; candidate.originStartedAt = now
      candidate.pendingReopen = null; candidate.pendingToken = null
      rotatePresentedToken(candidate)
      rolloverEvent = budget_reopened
    else if state.pendingToken:
      archiveCurrentWindowBusy(candidate)
      candidate.windowId += 1; candidate.generation += 1
      candidate.calls = 0; candidate.busyMs = 0; candidate.continuations += 1
      candidate.pendingToken = null; candidate.pendingReopen = null
      rotatePresentedToken(candidate)
      rolloverEvent = budget_continued
    decision = admit_or_stop(candidate)
    published = commit(candidate + decision.admission, decision.idempotencyKey)
    if not published: return question_budget_unavailable
    if rolloverEvent == budget_reopened:
      clearReportedTurnPointerIfCurrent(scopeKey, oldTurnId) # 提交后、上游执行前；不得清新指针
    if rolloverEvent: audit(rolloverEvent, published, decision.requestId)
    return decision                  # 换窗与本次准入同一事务；旧在途票据按原窗归档

function onLucyBeginQuestion_when_active:
  withScopeSerialization(scopeKey):
    reset_window_and_continuations_to_zero()
    state.pendingToken = null; state.pendingReopen = null
    state.continuationPolicy = "active"
    state.generation += 1
```

**恢复与并发不变式：**`continuationPolicy`、`generation`、`pendingReopen` 与既有 pendingToken 均须持久化并参与恢复；声明与消费共用作用域锁。两类 pending 互斥，旧窗口凭证不得跨代兑现。崩溃恢复不恢复在途占用；未核实提交沿用既有 recover 合同。

**不变式**

1. 触顶仍发生（SC-E1）；逃生不得取消第一次停机信号。
2. inactive begin **不得**因本条重新获得写预算／reset 副作用（SC-E8，对齐 P1-60）。
3. 判定器：`reason=question_budget_exhausted` ⇒ 归类 `budget_exhausted`，**不是** `deny`（SC-E5）。`question_budget_concurrency_exceeded`／`question_budget_unavailable` **不得**与 exhausted 混为一类（SC-E5b）。
4. 两段式：`lucy_continue_question` 永不直接 `consume_and_open`；消费只在下一计费数据工具。
5. 多窗凭证：每窗轮换 `presentedToken`／`windowId`／generation；幂等键必须含 window／代次，禁止仅 `declare:<round>:<token>`。
6. 原子性：续查／新开换窗与紧随其后的数据调用准入同一事务提交；审计在提交后记录。reported-turn 旧指针只在提交后且仍等于旧值时清除，不得影响新问询指针。

---

## 7. 验收（功能合同）

| ID | 实况 | 期望 |
|---|---|---|
| SC-E1 | 任意 | 单窗第 61 次数据工具（busy 未超）→ `question_budget_exhausted`，`outcome=budget_stop` |
| SC-E2 | begin inactive | 第一次触顶后 `continuable=true`；`lucy_continue_question`（默认 continue）声明成功后，**下一**数据工具进入新窗并可成交 |
| SC-E3 | begin inactive | 连续显式续查直至第 5 次换窗仍可成交；第 6 次续查拒绝或续查意义硬停 `continuable=false`，且 `next_step.mode=new_question` |
| SC-E4 | begin inactive | 硬停载荷非 ACL；`next_step` 指向 `mode=new_question`；指导／文案不含「无权限／ACL deny」 |
| SC-E5 | 本仓 compat／UAT | 故意触顶的 allow 案不得记 `new deny`；须分列 `budget_exhausted` |
| SC-E5b | 本仓判定器 | `concurrency_exceeded`／`unavailable` 不得标成 `budget_exhausted`；expected ACL deny 不得因见到 budget 字样假绿 |
| SC-E6 | 纯 MCP | 健康／RTT 正常不能否定问数触顶；报告须能从 attempt.reason 读到预算码 |
| SC-E7 | begin active | `maxContinuations=1` 不变；成功 begin 后额度归零（回归窗口 Spec） |
| SC-E8 | begin inactive | 强制 `lucy_begin_question` 仍 `begin_not_available`，且不 reset 预算（P1-60 不回退） |
| SC-E9 | begin inactive＋无 session | 续查档用尽后 `mode=new_question`（携带硬停凭证）→ 声明成功 → 下一数据工具新窗成交；**不换 Token**；active 硬停仍走 begin |
| SC-E9b | 持久化／恢复 | continuationPolicy、generation、pendingReopen 跨代理重启恢复；旧行只按持久 turnId 推导一次策略；声明后重启仍由下一数据工具兑现；同 token 同代重试幂等，不同 pending 拒绝；同 turn 多窗幂等键不碰撞 |
| SC-E10 | 本仓 compat | 同 Token 连续两跑：initialize／session、begin 不可见走 N、触顶且可续则 continue＋重试、硬停后 new_question＋重试、禁止陈旧 turn；目标合法 allow 须成交（Wave D 闭环） |

只验 SC-E1 不验 SC-E2／E3／E9／E9b／E10 ⇒ **不得收口**。

### 7.1 测试台映射

| Spec | UAT |
|---|---|
| SC-E1 | UAT-BESC-01＋UAT-BESC-10（次数与 busy 分列） |
| SC-E2 | UAT-BESC-02 |
| SC-E3 | UAT-BESC-03 |
| SC-E4 | UAT-BESC-04 |
| SC-E5／E5b | UAT-BESC-05 |
| SC-E6 | UAT-BESC-06 |
| SC-E7 | UAT-BESC-07 |
| SC-E8 | UAT-BESC-08 |
| SC-E9 | UAT-BESC-09（含无 session、稳定 session、legacy 未显式授予 continue 的升级可达性） |
| SC-E9b | Plan Task 1c 组件／真实代理恢复证据；BESC-09 跨 runner 不替代代理重启恢复 |
| SC-E10 | UAT-BESC-12（同 Token 两次真实 compat） |
| 第一性原理看守 | UAT-BESC-09（出门必做；含硬停后 new_question）＋UAT-BESC-11（真实 Agent） |

套件：[`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/suite.md)。P1-74 落地前允许必做项按真实结果记 FAIL 作改前基线，不得以 SKIPPED 掩盖；落地后 BESC-R0／01–12 必须全绿。互补 [`UAT-SUITE-QUESTION-BUDGET`](../qa/uat/suites/question-budget/suite.md)（P1-12）。

---

## 8. 交互合同

本条不触及 WebUI 用户可见面（无新路由／无页面交互）。  
**豁免**：[`lucy-20261107-ui-interaction-contract-gate-spec.md`](lucy-20261107-ui-interaction-contract-gate-spec.md) — 非 WebUI；验证走纯 MCP／进程内自动化，不强制浏览器。

---

## 9. 落盘清单自检

| # | 项 | 本条 |
|---|---|---|
| 1 | 路径／文件名 | `docs/specs/lucy-20261122-question-budget-mainpath-escape-spec.md` |
| 2 | 伪代码 | §6 |
| 3 | 元数据状态 | 头部表 |
| 7 | 索引 | 入 `docs/README.md` |
| 11 | 闭口层级 | 功能合同 |
| 14 | 总账／需求池 | P1-74／REQ-030-095 |
| 15 | 测试台 | [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/suite.md)；INDEX＝NOT RUN |
| 16 | 主路径双覆盖 | §2.1／§7／UAT-BESC-09／11 |
| 17 | 受影响画像 | §4 |
| 18 | 浏览器 | §8 豁免（非 WebUI） |

---

## 10. 开放问题（定稿后仅运维／实现细节）

| ID | 问题 | 默认假设 |
|---|---|---|
| OQ-1 | inactive 续查默认 5 的环境变量名 | `QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_INACTIVE`；合同默认 5（D2 已冻） |
| OQ-2 | 硬停后「新 sessionId」自动新桶 | 已是既有作用域语义；指导可强调；**主路径**以 D7 `mode=new_question` 为准 |
| OQ-3 | compat 分列是否扩到客户侧第三方 runner | 本期只约束本仓 scripts／UAT（D9 已含本仓成交链） |

---

## 11. 变更纪要

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1-draft | 2026-11-22 | 首稿：inactive 加档、分列 budget≠deny；对抗审阅后退回 |
| v1.0 | 2026-11-22 | 委托人批准 1A–6A：D7 `mode=new_question`、D8 软信封、D9 compat 成交链、参与态快照、两段式伪代码、多窗幂等、reason 分列、资源上界披露；终稿确权；开发未授权 |
| **v1.1** | 2026-11-22 | 终审闭环修订：active 硬停走 begin；inactive new_question 校验硬停与凭证；统一锁／pending 互斥／旧票据归档；新增 SC-E9b 持久恢复；修正 BESC-09／11／12 映射。D1–D9 不变；开发未授权 |
| v1.1-impl | 2026-11-22 | **实现已落地**（未提交）：Lane A 引擎／持久化／D7 可达、Lane B compat 分列＋成交链、Lane C 指导；实现 CR＝APPROVE（[reviews/2026-11-22-p174-budget-escape-implementation-cr](../reviews/2026-11-22-p174-budget-escape-implementation-cr.md)）。UAT＝PASS WITH GAPS（BESC-07／10A 环境 BLOCKED）。≠ 完整 PASS；≠ 可上线 |
