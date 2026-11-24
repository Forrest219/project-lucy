# 问询预算主路径逃生 · 对抗审阅报告

| 元数据 | 内容 |
|---|---|
| 文档类型 | Spec／Plan 对抗审阅（不是实现 CR） |
| 日期 | 2026-11-22 |
| 评审人 | Kimi Code |
| 工作项 | P1-74／REQ-030-095 |
| 评审对象 | [Spec v0.1-draft](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md)；[Plan v0.1-draft](../plans/lucy-20261122-question-budget-mainpath-escape-plan.md) |
| 评审方法 | 只读核对 Spec／Plan、现行 Proxy 与 compat runner、既有 UAT、总账与 e2e-ledger；未改运行代码，未执行实现测试 |
| 评审结论 | **退回修订；可继续文档设计，不可交付运行代码开发** |
| 授权边界 | 本报告不构成终稿确权、开发授权、功能合同收口或上线批准 |

## 1. 裁决

当前方案方向正确，但尚未闭合两条关键链路：

1. inactive 下 5 次续查用尽后，合法用户仍没有可达的“新问询”出口；无 session 客户端尤其无法依赖 `new_mcp_session` 自救。
2. Plan 只改变 compat 的结果分类，没有修复其缺少 session 管理、忽略 begin 失败、不执行 continue 的行为，因此原事故场景仍不能端到端成交。

续查状态机、凭证幂等、参与态切换及 MCP 协议兼容也有未决项。直接开发可能出现“文档承诺多档、实现仍在旧窗口停机”或新的客户端兼容回归。

**交付判定：文档修订可继续；运行代码开发暂不交付。** 完成本报告阻塞项后，再进入终稿确权；开发仍须委托人另行授权。

## 2. 认同项及理由

| 编号 | 认同项 | 理由 |
|---|---|---|
| A1 | 保持 60／300、settled busy，不再单纯放宽阈值 | 原事故的关键是生命周期无出口；放大阈值只能推迟触顶，不能恢复主路径 |
| A2 | 禁止 idle 自动换窗，不要求 WebUI／重签 Token 作为唯一逃生 | 保留 runaway 停机信号，同时符合纯 MCP 部署实况 |
| A3 | 区分 begin active／inactive，且不回退 P1-60 的 inactive 无副作用合同 | 避免把零绑定问数重新耦合到可选上报／口径绑定状态 |
| A4 | 逃生需要显式动作，下一次 query 不自动清零 | 防止忽略停机信号的 Agent 无边界执行；但“显式工具调用”不等于人工确认，见 R1 |
| A5 | budget 与 ACL deny 分列，验收同时覆盖“触顶”与“触顶后成交” | 可消除 `new deny` 误诊，并落实主路径可用性优先 |
| A6 | 总账、需求池、Spec／Plan、e2e-ledger 状态一致 | 当前均为 draft／未授权／not_registered，没有流程旁路；not_registered 本身不是设计阻塞项 |

## 3. 阻塞项

### B0-1：增加续查档数仍未闭合新问询生命周期

Spec D2 在 inactive 下提供 5 次续查，SC-E3 规定第 6 次硬停；D4 的后续提示为新 session、等待 begin active、运维清桶（Spec §5、§6、§7）。

反例仍然存在：

- 无 session 客户端无法执行 `new_mcp_session`。
- 持续零绑定部署中，`await_begin_active` 可能永远不发生。
- 多个独立业务问题不应消耗“同一问询”的续查档数。

因此该方案只是把“一续即死”改成“五续即死”，没有回答硬停后合法新问询如何成交。

**修订要求：**拆开“同一问询续查”与“开始新问询”。inactive／无 session 下也必须有显式新问询通道；若不恢复 inactive begin 的预算 reset，则需提供等价的预算专用机制。否则不得声称满足主路径底线。

### B0-2：Plan 未修复原事故的 runner 行为链

Plan Task 4 仅要求 compat 不再把 budget 聚合成 `new deny`。当前 runner 同时存在以下行为：

- 不 initialize、不保存或发送 `mcp-session-id`：`scripts/e2e/lib/mcp-compatibility-client.mjs:168`。
- begin 失败后仍继续 query：同文件 `:265`。
- 不调用 `lucy_continue_question`。
- begin 失败时保留旧 `turnId`：同文件 `:225`。

按当前 Plan 落地后，原 Wave D 场景可能只是从 `new deny` 变成 `budget_exhausted`，合法 allow 案仍不出数。

**修订要求：**Plan 增加 runner 行为修复：完整 initialize／session 生命周期；begin 不可用时走明确的 N 路径；触顶且 `continuable=true` 时执行 continue＋重试；begin 失败不得携带陈旧 turn；同一 Token 连续跑两次须证明合法 allow 案能恢复成交。分类修复不能替代成交修复。

### B1-1：续查伪代码与既有“两段式”合同矛盾

Spec §6 先声明“既有声明—消费两段式不变”，随后又在 `onLucyContinueQuestion` 中直接执行 `consume_pending_and_open_new_window()`。

现行实现实际是：

1. `lucy_continue_question` 只写 `pendingToken`：`webui/server/proxy/question-experience.ts:431`。
2. 下一次数据调用才消费 pending、换窗并放行：同文件 `:675`。

两种语义的审计时点、并发行为、重启恢复及“续查生效”归属不同。

**修订要求：**明确保留“声明→下一数据调用消费”，并写清多档情况下 `declareContinuation`、`consume`、`stopFrom` 如何统一使用同一额度策略。

### B1-2：多窗凭证与幂等键设计不足

当前声明幂等键为 `declare:<round>:<token>`，不含 `windowId`：`webui/server/proxy/question-experience.ts:442`。续查换窗后会清空 `presentedToken`；有 turn 时下一窗可能再次发出同一 turnId 作为 token：同文件 `:687`、`:699`。

若同一 round/token 被用于多窗再次声明，旧幂等键可能使命令看似成功，实际却没有写入新的 pending，下一数据调用仍停在旧窗。

**修订要求：**明确每窗凭证轮换规则；幂等键与轮次＋窗口语义对齐；增加“同 turn 多窗连续续查”回归测试。Plan 当前未覆盖该风险。

### B1-3：额度存在不代表 continue 通道可达

SC-E2 只在调用者可见 continue 工具时要求 `continuable=true`，Plan 又明确不改 ACL。既有预算 UAT 已承认无 continue 的 `demo_readonly` 需另造临时角色：`docs/qa/uat/suites/question-budget/cases.md:86`。

因此，有数据权限但未授予 `lucy_continue_question` 的合法角色仍无逃生。

**修订要求：**把 continue 可达性纳入所有数据问数角色的迁移与验收，或提供不依赖该工具授予的新问询通道。否则须把合同缩窄为“已授予 continue 的合法用户”，不得按全量 P1 主路径收口。

### B1-4：动态参与态会使额度语义跨窗口跳变

`maxContinuationsFor(scope)` 按当前 `beginParticipation` 返回 1 或 5，但未定义：

- active→inactive、inactive→active 在问询中途发生时如何处理；
- unknown／分类读取异常使用哪档；
- 进程重启后按哪个时点重算；
- 已用 3 次续查后切到 active 是否立即硬停；
- 参与态读取与预算作用域锁如何避免阻塞或死锁。

**修订要求：**明确参与态读取时点、unknown 语义和切换规则。更稳妥的方向是将本问询采用的额度策略固定在轮次／窗口状态里，而非每次停机时读取可能变化的外部状态。

### B1-5：草案静默改变 MCP 协议行为

Spec §6 新增硬停时 `continueToken: null`，并返回 `tool_result(isError=true)`。当前预算停止响应没有显式 `isError=true`，`continueToken` 类型也是字符串：`webui/server/proxy/mcp-proxy.ts:5827`、`webui/server/proxy/question-experience.ts:90`。

这些变化可能合理，但属于真实的客户端兼容变化，不是无副作用的载荷增强。

**修订要求：**明确是否确需改变；若需要，写入兼容合同与旧客户端测试。不得在没有解释的情况下同时把 budget 定义为“非失败／非拒绝”，又改变工具错误语义。

### B1-6：`question_budget_*` 不能统一归为一类

Plan Task 4 使用 `question_budget_*` 通配，但至少包含三种不同事实：

| 原因 | 正确事实类别 |
|---|---|
| `question_budget_exhausted` | 正常预算触顶 |
| `question_budget_concurrency_exceeded` | 并发限制 |
| `question_budget_unavailable` | 预算存储故障／平台错误；当前为 503 |

统一写成 `budget_exhausted` 会制造新的误诊。

**修订要求：**按 reason 分列；unavailable 仍归平台／存储错误。增加 expected deny 反例：遇到 budget stop 不得把“预期拒绝”判成 PASS，因为没有证明 ACL 拒绝实际发生。

## 4. 需显式接受的资源风险

“必须显式 continue”不等于人工确认。runaway Agent 也能自动调用 continue，因此本方案实际把最大调用量从 60 次提高到约 360 次，而不是只让真人合法通过。

按既有阈值 Spec 的派生口径，6 个窗口还会把 Lucy 等待上界从约 1560 秒扩大到约 **4680 秒**。这不必然否决方案，但 Spec 应写明资源代价及选择 5 的证据，不能仅以“每档显式调用”推导出 runaway 不会放大。

## 5. 建议的收敛方向

1. **同一问询：**保留有界、显式续查。
2. **新问询：**提供 inactive／无 session 也可达的显式新开机制，并重置续查计数。
3. **compat runner：**补齐 session、begin 失败处置、continue＋重试，再分离 budget／ACL／平台错误。
4. **状态机：**保持声明—消费两段式；统一多窗额度读口；明确凭证轮换、幂等键、参与态快照及重启恢复。
5. **协议：**显式评审 `isError` 与可空 `continueToken` 的兼容性，不在伪代码中静默改变。

最低新增闭环：

```text
inactive＋无 session
  → 第 61 次触顶
  → 显式续查后合法出数
  → 续查档数耗尽
  → 显式开始新问询
  → 不换 Token 再次合法出数
```

最后一步缺失，是当前不可交付开发的最主要原因。

## 6. 开发交付前置条件

- [ ] 闭合 B0-1／B0-2 与全部 B1 项，Spec 与 Plan 同步修订。
- [ ] 明确续查与新问询的生命周期边界、unknown／参与态切换、凭证幂等和协议兼容。
- [ ] 验收同时覆盖 runaway 不自动穿透、合法用户成交、expected deny 不被 budget 假绿。
- [ ] compat 增加同 Token 连续跑次的行为证据，不只检查报告文案。
- [ ] Spec D1–D6 完成终稿确权；Plan 与总账／需求池／e2e-ledger 同句更新。
- [ ] 委托人另发开发授权；测试台按授权后的 Plan 注册并初始化为 NOT RUN。

在上述条件完成前，**不得改运行代码、常量、指导或判定器，也不得宣称功能合同收口或可上线。**

---

## 7. 修订回执（2026-11-22）

委托人批准阻塞项复核建议（1A–6A）并授权落盘定稿。Spec／Plan 已升 **v1.0**（终稿确权）：闭合 B0-1（`mode=new_question`）、B0-2（Plan Task 4b）、B1-1…B1-6、§4 资源上界。**开发仍未授权**；测试台仍 NOT RUN。本报告 §1「退回修订」对 **v0.1-draft** 仍成立；对 **v1.0** 以 Spec／Plan／总账现值为准。

后续 [终稿审阅](2026-11-22-question-budget-mainpath-escape-final-review.md) 已将 Spec／Plan 修订至 **v1.1**、UAT 设计定稿至 v1.0，结论为**文档设计闭环通过**；事故修复和持续验证仍未执行。
