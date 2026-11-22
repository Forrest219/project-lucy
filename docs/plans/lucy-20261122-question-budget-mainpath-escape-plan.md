# 问询预算主路径逃生 Implementation Plan

> **For agentic workers:** 本 Plan **尚未获开发授权**。Spec 已终稿确权；须委托人**另发开发授权**后按任务落地。本条不表示可上线。

**Goal:** 在保留 60／300 runaway 防火墙的前提下，使零绑定（begin 不可用）／无 session 纯 MCP 用户在额度触顶后仍能通过显式 `lucy_continue_question`（多档 `mode=continue`＋硬停后 `mode=new_question`）完成长问询与新开问询；把预算终止与 ACL deny 分列；本仓 compat 对 Wave D 类场景端到端成交。

**Architecture:** 按问询生命周期快照的 `continuationPolicy` 分支 `maxContinuations`（active=1，inactive=5）；停机软信封＋`next_step`；`lucy_continue_question` 两段式声明／消费；`mode=new_question` 预算专用重开；D7 逃生工具对计费问数身份可达；initialize 指导与本仓 compat／UAT 按 reason 分列。不恢复 inactive begin 的预算副作用。

**Tech Stack:** Lucy MCP Proxy（`question-experience.ts`／`mcp-proxy.ts`）、`data-qa-instructions.md`、vitest、scripts/e2e MCP compat、Docker demo MCP。

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v1.1** / 2026-11-22 |
| 主 Spec | [lucy-20261122-question-budget-mainpath-escape-spec.md](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md)（**v1.1**） |
| 编号 | **REQ-030-095／P1-74** |
| 状态 | S5｜**v1.1；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）**。实现已提交（`72d47cb0`）；实现 CR **APPROVE**（[reviews/2026-11-22-p174-budget-escape-implementation-cr](../reviews/2026-11-22-p174-budget-escape-implementation-cr.md)）；UAT＝PASS WITH GAPS（[2026-11-22-kimi-p174-budget-escape](../qa/uat/suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md)；BESC-07／10A／Wave D 全量入收口范围另案）。不入核心分母。≠ 可上线 |
| 终审记录 | [终稿审阅](../reviews/2026-11-22-question-budget-mainpath-escape-final-review.md)：文档设计闭环通过；[实现 CR](../reviews/2026-11-22-p174-budget-escape-implementation-cr.md)：**APPROVE**；UAT PASS WITH GAPS |
| 授权边界 | 开发授权（inbox/20261122-1434-p1-74-kimi-dev-prompt.md）已执行：Lane A/B/C 落地＋CR＋平滑升级 UAT；**未授权 push／发布／客户出包／`--fresh`** |
| 验收 | Spec SC-E1–E10（含 SC-E9b）↔ UAT-BESC-01–12＋组件恢复证据；须同时覆盖「触顶」「触顶后续查成交」「硬停后 new_question」「compat 成交」 |
| 优先级 | P1（主路径可用性）；**不挡**原 P0 核心分母宣称以外的排期，但与问数体验直接相关 |
| 实施主体 | Lucy；不改 KTX |

## Global Constraints

- 不改 `QUESTION_BUDGET_MAX_CALLS=60`／`MAX_BUSY_MS=300000` 默认。
- 不改 settled busy、稳定 `bq:identity:session`、旁路纳管、失败四维度。
- 不违反 P1-60：inactive begin 仍 `begin_not_available` 且无预算 reset 副作用。
- 平滑升级；禁止把 `--fresh` 当本功能前置。
- 术语：预算终止／可继续／新问询重开；禁止把预算写成权限拒绝。
- D8：不强制预算停机 `result.isError=true`。
- D7：允许为逃生可达调整 `lucy_continue_question` 可见性／授予；不改行权限。

---

## 1. 目标

1. inactive 实况下触顶 → 显式续查可多档换窗（默认 5），长问询可继续成交。
2. 续查档用尽 → `mode=new_question` 同 Token／无 session 再开并成交。
3. active 实况回归：续查 1 档＋begin 换窗不变。
4. 本仓判定器／指导不再把 budget 记成 deny；reason 三类分列。
5. compat 成交链修复（D9）；双覆盖＋硬停再开自动化。

---

## 2. 开工前置

- [x] Spec D1–D9 终稿确权（委托人 2026-11-22 批准 1A–6A 并定稿）
- [x] 委托人另发**开发授权**（可按 Task 分批）
- [x] 入池 REQ-030-095／P1-74
- [x] 测试台挂套件 [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/suite.md)（含 BESC-11／12；INDEX＝NOT RUN；实跑另授）

---

## 3. 风险

| 风险 | 处理 |
|---|---|
| 加档／new_question 被指「废掉防火墙」 | 每档仍须显式调用；上界写入 Spec §5.1；SC-E1 必验触顶 |
| 与 P1-60 回归冲突 | SC-E8 锁住 begin_not_available 无副作用 |
| Agent 仍不懂 continue／new_question | D5 改指导；硬停 `next_step.mode=new_question` |
| 两段式写错成同步 consume | Task 1 锁伪代码；禁止在 continue handler 内直接换窗 |
| 多窗幂等撞车 | Task 1b：幂等键含 windowId＋generation |
| compat 只改分类仍不出数 | Task 4b 成交链；SC-E10／BESC-12 |
| reason 通配误诊 | Task 4 按 exhausted／concurrency／unavailable 分列 |

---

## 4. 文件落点（授权后）

| 区域 | 文件 |
|---|---|
| 续查档数／声明消费／new_question／快照策略／凭证 | `webui/server/proxy/question-experience.ts` |
| 新状态持久化、幂等键与恢复 | `webui/server/proxy/audit.ts`（既有迁移机制；禁止手工改库） |
| begin 参与态读口／停机组装／软信封／旧归属清理 | `webui/server/proxy/mcp-proxy.ts`、`webui/server/proxy/turn-correlation.ts` |
| 指导 | `webui/config/data-qa-instructions.md` |
| 合同数字短注 | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` §7.2（授权后短注） |
| 逃生工具可达（D7） | Proxy tools/list 过滤或 Role／Agent 默认授予（择一；验收以可达为准） |
| compat 分列＋成交链 | `scripts/e2e/lib/mcp-compatibility-client.mjs` 及判定聚合处 |
| 测试 | `webui/server/__tests__/question-budget*.test.ts`（escape／reopen／幂等） |
| **明确不改** | KTX；行权限编译；60／300 常量；WebUI 页面；强制 `isError=true` |

---

## 5. 任务

### Task 0: 文档定稿（本批）

- [x] Spec／Plan → **v1.1**（闭合 B0／B1 及终审映射／恢复／原子性；D1–D9 冻结）
- [x] 总账 P1-74／需求池 REQ-030-095 同句
- [x] `docs/README.md`／`docs/plans/README.md`／e2e-ledger／UAT 用例（BESC-11／12）
- [x] 终稿确权（委托人批准建议并定稿）

### Task 1: 单元／组件 — inactive 多档续查＋两段式（授权后）

- [x] 写失败测试：inactive 下续查第 2…5 窗可准入；第 6 次续查硬停且提示 new_question
- [x] 实现 `continuationPolicy` 快照＋`maxContinuationsFor`＋常量默认 5
- [x] **禁止**在 `onLucyContinueQuestion` 内直接 consume／换窗；消费仅在下一计费工具
- [x] 跑通相关 vitest

### Task 1b: 多窗凭证／幂等（授权后）

- [x] 幂等键含 `windowId`＋`generation`＋round＋token
- [x] 每窗轮换 `presentedToken`；同 turn 多窗连续续查回归

### Task 1c: 持久化、恢复与作用域锁（授权后；SC-E9b）

- [x] 通过既有迁移机制持久化 `continuationPolicy`、`generation`、`pendingReopen`；恢复字段清单与幂等键同事务
- [x] 旧行缺策略时只按持久 turnId 推导一次并落库；不得在同生命周期重启后重新读取当前参与态改档
- [x] begin、continue、new_question、consume、settle 共用作用域锁；两类 pending 互斥，同 token 同代重试幂等，不同 pending 拒绝，旧窗口凭证不得跨代兑现
- [x] 真实代理恢复：new_question 声明后重启，下一数据工具仍兑现；崩溃不恢复在途占用，未核实提交走既有 recover

### Task 2: `mode=new_question`＋停机载荷（授权后）

- [x] inactive 硬停：`next_step.mode=new_question`；active 硬停仍指向 begin；软信封（D8）
- [x] new_question 仅接受 inactive 已硬停状态；校验 presentedToken、pending 互斥和非法 mode
- [x] 声明→下一数据工具：calls／busy／continuations 归零，round／window／generation 前进；**换窗与本次准入同一事务**，审计在提交后；旧在途票据归档，不失锁
- [x] 不写 conversation turn／BindingSession；清除旧预算 turnId 与仍为当前值的 reported-turn 指针，不新建上报归属
- [x] 审计区分 `budget_reopen_declared`／`budget_reopened`；预算停止仍为 `budget_stop`／`budget_stopped`，不写 denied

### Task 3: 指导文本＋D7 可达（授权后）

- [x] `data-qa-instructions.md`：按 `continuable`／`next_step.mode` 分支；禁止报 ACL
- [x] 指导不得宽于代理档数／上界
- [x] 计费问数身份可调用 `lucy_continue_question`（tools/list 或授予）；验收 SC-E2／E9
- [x] legacy 未显式授予 continue 的身份在平滑升级后可见逃生工具；旧客户端仅传 token 时仍默认 `mode=continue`
- [x] D7 只赋予预算生命周期能力，不增加任何 connection／source／行数据权限

### Task 4: compat／UAT 分列（授权后）

- [x] `question_budget_exhausted` → `budget_exhausted`（不得 `new deny`）
- [x] `question_budget_concurrency_exceeded`／`question_budget_unavailable` **分列**；unavailable 归平台／存储错误
- [x] expected ACL deny 反例：见到 budget 字样不得假绿
- [x] 套件已挂：`UAT-SUITE-BUDGET-ESCAPE`（SC-E1–E10 ↔ BESC-01–12）
- [x] 改前基线按真实结果保留 FAIL，不得以 SKIPPED 掩盖 → 修复后 BESC-R0／01–12 复跑须全绿；INDEX 更新

### Task 4b: compat 成交链（授权后；D9／SC-E10）

- [x] initialize 并保存／发送 `mcp-session-id`（客户端支持时）；另保留显式无 session 对照
- [x] 先读 tools/list：begin 不可见时直接走 N，不制造预期外 begin 错误；强制 begin 失败测试另计，且不得携带陈旧 `turnId`
- [x] 触顶且 `continuable=true`：调用 `mode=continue`＋重试数据工具，核对真实成交而非仅换窗
- [x] inactive 硬停且提示 new_question：携带硬停凭证调用 `mode=new_question`＋重试；active 硬停走 begin
- [x] 同 Token 连续两跑：Wave D 预算命中的目标合法 allow 案须成交；JOIN chasm／ACL-03b／Agent 墙钟等另案独立保留，不得借本项修绿
- [x] 分类修复**不能**单独勾选为事故修复完成

### Task 5: 回归 P1-60／P1-12（授权后）

- [x] SC-E7／E8；既有 question-budget 与 begin-zero-binding 相关 vitest／冒烟不回退
- [x] 本机 demo Docker 平滑升级后纯 MCP 抽检：触顶→continue→再查；硬停→new_question→再查

### Task 6: 收口文档（授权后且证据齐）

- [x] Spec／Plan 状态与总账同句；实现 CR；**本条收口不表示可上线**

---

## 6. 完成定义

- SC-E1–E10（含 SC-E9b）有自动化、真实代理恢复或 Docker MCP／compat 证据；双覆盖＋硬停再开＋compat 成交成立。
- P1-60 无副作用合同未回退。
- 总账／需求池／索引／Spec 头部状态同句。
- 未获上线／客户交付授权。

---

## 7. 验收

以 Spec §7 为准。缺 SC-E2／E3／E9／E9b／E10 的「只验拦住」「只改分类」或「只换窗未成交」不得主张功能合同收口。

---

## 8. 变更纪要

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1-draft | 2026-11-22 | 首稿；对抗审阅后退回 |
| v1.0 | 2026-11-22 | 闭合 B0-1／B0-2／B1；Task 1b／2／4b；D7–D9；终稿确权；开发未授权 |
| **v1.1** | 2026-11-22 | 终审闭环：补 audit 持久化／turn 归属落点与 Task 1c；明确 new_question 硬停／凭证／锁／active begin；legacy continue 可达；compat 目标案与另案分列；开发未授权 |
| v1.1-impl | 2026-11-22 | Task 1–6 实现已落地（未提交）＋CR APPROVE；平滑升级后 UAT PASS WITH GAPS（BESC-07／10A 环境 BLOCKED）；≠ 完整 PASS；≠ 可上线 |
