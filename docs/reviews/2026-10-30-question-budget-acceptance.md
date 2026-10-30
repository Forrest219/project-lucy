# 问询预算窗口验收表（SC-01–SC-48）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-10-30 |
| 授权 | 用户批准收口方案四步，并要求提交 |
| 命令 | `cd webui && npx vitest run server/__tests__/question-budget-*.test.ts server/__tests__/data-qa-instructions-contract.test.ts server/__tests__/scope-restatement-instructions.test.ts --maxWorkers=1` → **11 文件 / 87 通过**。另跑 `admin-audit.test.ts` 中 SC-25–SC-28 → **2 通过** |
| 浏览器 | 已登录。`http://127.0.0.1:55176/admin/audit?range=1h` 问询记录表头有「关联调用数」「预算终止次数」。抽到的首行：关联调用数 3、预算终止次数 0，结果列是「执行成功 / 未知」 |

结论列的「通过」指该行实测与 Spec §7 的验收句一致。SC-04 的通过范围写在该行里。

| 编号 | 初态 | 输入 | 实际输出 | 证据 | 结论 |
|---|---|---|---|---|---|
| SC-01 | 新作用域 | 12 次数据调用，间隔各 90 秒 | 全部放行，`calls=12`，`busyMs` 不含间隔 | `question-budget-window-mode.test.ts`「SC-01 / SC-06」 | 通过 |
| SC-02 | 新作用域 | 空闲 15 分钟后再调用 | `scopeKey`、`round`、`calls` 连续，不换桶 | `question-budget-scope-identity.test.ts`「SC-02」 | 通过 |
| SC-03 | 持久层 `calls=18, round=2, windowId=3` | 重启后一次数据调用 | `calls=19`，`round=2`，`windowId=3`，归属恢复为 T | 同文件「SC-03」 | 通过 |
| SC-04 | 同 SC-03 的累计形态，由第一次代理运行写出来 | vitest 内关掉代理、`vi.resetModules()`、再起代理，经 HTTP `tools/call` 读一次 | `calls=19`，`round=2`，`windowId` 不变，`turnId` 恢复，`inflight=0` | 同文件「SC-04」。不是操作系统进程重启，也不是 demo 容器重启 | 通过（进程内） |
| SC-05 | 持久层不可读 | 数据调用 | `question_budget_unavailable`，不记预算终止 | 同文件「SC-05」；窗口模式文件有对照 | 通过 |
| SC-06 | 新作用域 | 两次调用各 1 秒，间隔 300 秒 | 两次放行，`busyMs=2000` | `question-budget-window-mode.test.ts`「SC-01 / SC-06」 | 通过 |
| SC-07 | 新作用域 | 已结算时长达到 120 秒 | 下一次 `question_budget_exhausted` | 同文件「SC-07」 | 通过 |
| SC-08 | 新作用域 | 第 21 次数据调用 | `question_budget_exhausted`，与时长无关 | 同文件「SC-08」 | 通过 |
| SC-09 | 新作用域；另测已有 3 次放行的窗口 | MCP：`resources/list`、`lucy_catalog`、`lucy_skill_search`、ACL 拒绝的 `lucy_read_source`，然后允许的读取 | 四类之后 `calls=0`。第一次放行 `calls=1`。再两次后 `calls=3`。再次 ACL 拒绝后 `calls`、`windowId`、`round`、`busyMs` 不变 | `question-budget-closure.test.ts`「SC-09」 | 通过 |
| SC-10 | 新作用域 | catalog 后空闲 318 秒再读 source，可控时钟 | `settled` 放行，`elapsed` 拒绝 | `question-budget-incident-regression.test.ts`「SC-10」 | 通过 |
| SC-11 | 已有 1 个在途，上限 4 | 再提交 4 个 | 前 3 个放行，第 4 个新请求并发超限，不增加 `calls` / `busyMs` | `question-budget-settlement.test.ts`「SC-11」 | 通过 |
| SC-12 | 旧窗口已结算 110 秒且 A 在途 | 续查后 B 进新窗口，A 再结算 10 秒 | 旧窗口归档 120 秒，新窗口 `busyMs` 不变，重复结算一次 | 同文件「SC-12」 | 通过 |
| SC-13 | 数据调用处理中 | 客户端断开 | 绑定测试：`res.close` 后 199ms 不结算、绝对时限未清；确认时刻时钟 25000，`busyMs` 取该时刻并带 `clientDisconnected`。取消不确认时记账为起点 + 120 秒且 `timeoutUnconfirmed`。代理测试：在途 `currentConcurrency=1`、`busyMs=0`，断开并等到上游关闭后并发回到 0、`calls=1` | `question-budget-closure.test.ts`「SC-13」三条绑定 + 一条代理。结算层旧用例仍在 `question-budget-settlement.test.ts` | 通过 |
| SC-14 | 调用持续到绝对时限且取消未确认 | 等待达到 `ABS_EXEC_MS` | `busyMs` 封顶为 120 秒，在途槽释放，`timeoutUnconfirmed=true` | `question-budget-settlement.test.ts`「SC-14」 | 通过 |
| SC-15 | 预算刚用尽，调用者可见续查工具 | 首次停机 | `continuable=true`，凭证等于 `presentedToken`，不含作用域键 | `question-budget-continuation.test.ts`「SC-15」 | 通过 |
| SC-16 | 同上，调用者看不见该工具 | 首次停机 | `continuable=false` | 同文件「SC-16」 | 通过 |
| SC-17 | 预算用尽，`continuations=0` | `lucy_continue_question` 后一次数据调用 | 新窗口 `calls=1`、`busyMs=0`、`windowId+1`，续查生效与放行同批落库 | 同文件「SC-17」 | 通过 |
| SC-18 | `continuations=1` | 再声明 | `no_credit`，窗口不重置 | 同文件「SC-18」 | 通过 |
| SC-19 | 已有 pending | 不同 token 再声明 | `pending_exists`，原 pending 仍在 | 同文件「SC-19」 | 通过 |
| SC-20 | 已有 pending | 相同 token 再声明 | 幂等成功，没有第二条 pending | 同文件「SC-20」 | 通过 |
| SC-21 | 预算用尽 | 头路径与工具路径并发续查 | 额度只加一次，窗口只重置一次 | 同文件「SC-21」 | 通过 |
| SC-22 | 预算用尽 | 无效或错配 token | 拒绝，窗口不重置，`continuationMatched=false` | 同文件「SC-22」两条 | 通过 |
| SC-23 | 已声明续查 | 进程内重启后再调用 | `pendingToken` 恢复并被消费 | 同文件「SC-23」 | 通过 |
| SC-24 | 已声明续查 | 新的 `begin_question` 后再调用 | 旧 pending 不跨轮次 | 同文件「SC-24」 | 通过 |
| SC-25 | 一条预算终止行和一条 ok 行 | 导出不带 `outcome` | 两行都在 | `admin-audit.test.ts`「SC-25 / SC-26」 | 通过 |
| SC-26 | 同上 | 导出 `outcome=ok` | 只有 ok 行 | 同上 | 通过 |
| SC-27 | 一问询含成功、拒绝、错误、预算终止各 1 | 问询汇总 | `budgetStop=1`，关联调用数 = 4 = 四桶之和。页面表头有「预算终止次数」 | 同上「SC-27 / SC-28」；浏览器见文首 | 通过 |
| SC-28 | 同上 | 汇总与结果列 | `primaryStatusSummary.budget_stopped=1`。页面结果列是执行成功 / 未知，不是四桶本身 | 同上；浏览器见文首 | 通过 |
| SC-29 | 预算终止 | 读该行上的续查事实 | `continuationPresented` / `continuationMatched` / `continuationCreditLeft` / `canContinueByCapability` 都有 | `question-budget-continuation.test.ts`「SC-29」 | 通过 |
| SC-30 | 一次续查 | 读审计 | 声明与生效是两条事实，生效挂在对应数据调用上 | 同文件「SC-30」 | 通过 |
| SC-31 | 身份 A、B 使用相同 session | B `begin_question` | A 的作用域与活跃 turn 不变 | `question-budget-turn-supersede.test.ts`「SC-31」 | 通过 |
| SC-32 | 身份 A 无 session | 空 session | 只进入 A 的无会话桶 | 同文件「SC-32」 | 通过 |
| SC-33 | 同一身份同一会话 | 两个并发 begin | 最终一个活跃 turn，轮次不重复 | 同文件「SC-33」两条 | 通过 |
| SC-34 | 某轮次已被取代 | 看历史 | 旧轮次不被改写，归档计数可见 | 同文件「SC-34」 | 通过 |
| SC-35 | 预算已用尽 | `lucy_certified_route` | 不执行查询，`calls` 不增加 | `question-budget-bypass-scope.test.ts`「SC-35」 | 通过 |
| SC-36 | 预算充足 | 认证路由 | 记 1 次，内部查询时长不重复记次数 | 同文件「SC-36」 | 通过 |
| SC-37 | 任意 | `WALL_MODE=elapsed` | 只回退时间判定；作用域、并发、续查仍在 | `question-budget-incident-regression.test.ts`「SC-37」 | 通过 |
| SC-38 | 任意 | `SCOPE=legacy` | 作用域键回到 `turn:` / `scope:` | 同文件「SC-38」；作用域文件另有一条 | 通过 |
| SC-39 | 任意 | `LUCY_QUESTION_BUDGET=off` | 预算关闭，开题不再被预算存储卡住 | 作用域文件「SC-39」；旁路文件另有一条 | 通过 |
| SC-40 | 任意 | 读 `data-qa-instructions.md` | 「累计 120 秒数据处理时长（不含思考时间）」；`continuable` 分支；不宽于代理 | `data-qa-instructions-contract.test.ts` | 通过 |
| SC-41 | 任意 | 读术语标准三条词条 | 「问询预算」「关联调用数」「可继续」已按新口径 | 同上 | 通过 |
| SC-42 | 同一凭证再次停机 | 续查换窗后第二次停机 | 发布的是该窗口已落库的行 | `question-budget-continuation.test.ts`「SC-42」 | 通过 |
| SC-43 | 有在途调用 | begin 与结算并发 | 后完成者不覆盖对方的轮次或耗时 | `question-budget-turn-supersede.test.ts`「SC-43」两条 | 通过 |
| SC-44 | 新作用域 | 两次 begin；另测 begin 前已有 `busyMs` | 第一次就持久化 `turnId`；第二次轮次 +1，旧凭证失效；已有时长先归档再归零 | 同文件「SC-44」两条 | 通过 |
| SC-45 | 预算已用尽，请求预带头等于活跃 turn | 第一次因此耗尽的调用 | 直接进入新窗口并放行 | `question-budget-continuation.test.ts`「SC-45」 | 通过 |
| SC-46 | 源授权失败 | `lucy_certified_route` | 不执行查询，`calls` 不增加 | `question-budget-bypass-scope.test.ts`「SC-46」 | 通过 |
| SC-47 | 角色已授予续查工具，请求不带 connection | 真实 MCP `tools/call` | 不因缺少 connection 被参数闸拒绝。未授权角色调用不可达 | `question-budget-continuation.test.ts`「SC-47」两条 | 通过 |
| SC-48 | `commit` 已失败且未核实 | 同作用域再消费 | 第二次全量写入被拒绝；核实后按磁盘行恢复 | `question-budget-scope-identity.test.ts`「SC-48」两条 | 通过 |
