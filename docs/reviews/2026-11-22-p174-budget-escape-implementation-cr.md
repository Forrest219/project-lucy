# P1-74／REQ-030-095 实现 Code Review —— 问询预算主路径逃生

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现代码审阅（Wave 2 门禁；UAT 前强制） |
| 日期 | 2026-11-22 |
| 评审人 | Kimi Code（实现代理自审；按开发提示词 §3 允许自审但须出书面报告） |
| 评审对象 | Lane A（`question-experience.ts`／`audit.ts`／`mcp-proxy.ts`）、Lane B（`mcp-compatibility-client.mjs`／`mcp-compatibility.mjs`）、Lane C（`data-qa-instructions.md`／Spec 162 §7.2） |
| 评审方式 | 全量 diff 逐段审查＋vitest 定向回归（134 用例，133 过；唯一失败 `mcp-proxy-instructions` soft-nudge 为改动前已存在，经 stash 对照证实） |
| 结论 | **APPROVE**（无 blocker；2 项假设／边界记录如下） |

## 1. CR 必查项逐条结论

| # | 必查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | §6 两段式／原子换窗是否被破坏 | **通过** | `declareContinuation` 只写 `pendingToken`／`pendingReopen`，永不换窗；换窗＋准入在 `decideConsume` 内对同一 candidate 一次 `commit`（幂等键 `admit:<requestId>`），审计在提交后由代理侧记录 |
| 2 | active／inactive 硬停通道是否错用 | **通过** | `mode=new_question` 前置校验 `continuationPolicy==="active"` → `use_begin_question`；`stopFrom` 的 `next_step` active 指向 `lucy_begin_question`、inactive 指向 `mode=new_question`；active 不得靠 new_question 绕过 begin（测试「SC-E7」「SC-E9 前置校验」） |
| 3 | 幂等／代次／pending 互斥／锁 | **通过** | 幂等键 `declare|reopen|stop:<round>:<windowId>:<generation>:<token>`；每窗轮换 `presentedToken`；两类 pending 写路径互斥（同一事务只写一个）；同 token 同代重试幂等、不同 pending 拒绝、旧窗凭证跨代 `mismatch`；全部声明／消费走 `withScopeSerialization` 作用域锁 |
| 4 | D7 是否泄漏额外数据权限 | **通过** | 仅向 `visibleTools` 增加 `lucy_continue_question` 并放行该工具本体的 ACL 闸门；`allowedToolNames`／connection／source／行权限编译零改动；wiki-only 身份仍被拒（SC-47 测试回归通过） |
| 5 | D8 是否误加 `isError=true` | **通过** | 停机响应仍走软信封（JSON＋`reason`），未设 `result.isError`；测试「D8 exhaustion stop … soft envelope」断言 `isError !== true` |
| 6 | compat 是否「只改分类」 | **通过（且按 D9 超出分类属授权范围）** | 分类分列（Task 4）之外，成交链（Task 4b：session／tools-list 预检／N 路径／continue＋重试／new_question＋重试／禁陈旧 turn）在 Plan D9 授权内；JOIN chasm／ACL-03b 等另案未触碰 |
| 7 | 60／300／P1-60 是否回退 | **通过** | `QUESTION_BUDGET_MAX_CALLS=60`／`MAX_BUSY_MS=300_000` 未动；settled busy 未动；inactive `lucy_begin_question` 仍 `begin_not_available` 且无预算副作用（begin handler 零改动，SC-E8／begin-hide-inactive 回归通过） |
| 8 | 与 Spec SC-E1–E10／E9b 逐条映射 | **通过** | 见 §2 映射表；E1／E6／E10 依赖 Wave 3 全真 UAT（本报告不冒充 UAT） |

## 2. SC 映射（组件级证据；全真证据待 Wave 3）

| Spec | 组件证据（vitest） | 全真证据（Wave 3 待跑） |
|---|---|---|
| SC-E1 触顶 | escape 套件「SC-E2/03」前置停机断言（`reason=question_budget_exhausted`、`continuable`、`notExecuted` 代理级） | UAT-BESC-01 |
| SC-E2 首续查成交 | 「SC-E2」声明→下一工具换窗放行 | UAT-BESC-02 |
| SC-E3 5 换窗＋第 6 次硬停 | 「SC-E3」6 窗循环、`no_credit`、硬停 `next_step` | UAT-BESC-03 |
| SC-E4 非 ACL | 「SC-E4」reason／classifyFailure 断言 | UAT-BESC-04 |
| SC-E5／E5b 分列 | mcp-compat-budget-escape.test.mjs 5 条 judgeFunctional 用例 | UAT-BESC-05／12 |
| SC-E6 健康绿 | —（attempt.reason 可读预算码） | UAT-BESC-06 |
| SC-E7 active 回归 | 「SC-E7」active 1 档＋硬停指向 begin | UAT-BESC-07 |
| SC-E8 begin 无副作用 | begin handler 未动＋既有套件回归 | UAT-BESC-08 |
| SC-E9 硬停后再开 | 「SC-E9」「SC-E9 前置校验」＋代理级 D7 用例 | UAT-BESC-09 |
| SC-E9b 持久恢复 | 「声明后重启」「旧行 policy 推导」「幂等跨代」＋audit.ts 迁移列 | 组件证据；代理重启级由 Wave 3 平滑升级验证 |
| SC-E10 compat 成交 | 「escape chain」2 条（mock fetch） | UAT-BESC-12 同 Token 两跑全真 |

## 3. 发现的非阻断问题与处置

| 项 | 严重度 | 处置 |
|---|---|---|
| certified-route 旁路停机响应初版缺 `next_step`（与数据工具停机口径不一致） | 中 | CR 中发现并已修复（`respond` 增加 `next_step`）；tsc＋回归通过 |
| `mcp-proxy-instructions`「soft nudge」用例失败 | —（预先存在） | 经 `git stash` 对照证实与本条无关；不在本条范围修 |
| 既有 8 个测试文件失败（empty-result／audit-export-n26／smoke 等） | —（预先存在） | stash 对照证实改动前即失败（工作树先有问题）；本条零新增回归 |

## 4. 假设与边界（供委托人复核）

1. **D7「计费问数身份」口径**：实现取「可见任一数据面计费工具（`lucy_query`／`lucy_read_source`／`lucy_freshness`／`lucy_explain_query`）」为可达条件；wiki-only 身份不获得逃生工具（否则 SC-47「wiki 角色不可达」旧合同被破坏）。Spec 字面「计费数据工具」含 wiki 工具，但与 SC-47／既有测试冲突，按「问数方画像」窄解释。
2. **显式 `deny_tools` 与 D7 的优先级**：若某角色在 `deny_tools` 显式拒绝 `lucy_continue_question`，当前实现仍按 D7 放行（逃生可达优先）。demo 默认 `deny_tools: []` 不受影响；如治理上要求 deny 优先，需另开小条。
3. **`next_step` 字段命名**：MCP 响应 JSON 用 `next_step`（对齐 Spec §6），TS 类型为 `BudgetNextStep`；旧客户端忽略该字段不受影响。
4. **inactive 无 begin 生命周期一律按快照给 5 档**：即便该身份实际有 active 参与态，只要未调用 begin 即按 inactive 快照（Spec §6「参与态只在生命周期建立时读取并冻结」的推论）。

## 5. 判定

**APPROVE**。上述 4 项假设均不违反 D1–D9 冻结决策；可按编排进入 Wave 3（平滑 `demo:upgrade` → vitest 回归 → UAT-SUITE-BUDGET-ESCAPE 全真）。
