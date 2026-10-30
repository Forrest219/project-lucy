# 问询预算窗口第 3 轮评审与定稿

## 结论：定稿 v1.0

2026-10-30 用户授权本次评审并完成定稿。审阅对象是第 2 轮之后的 Spec v0.4 / Plan v0.7，并对照第 2 轮 N01–N12、Spec 162 §7.2，以及 `question-experience.ts`、`mcp-proxy.ts` 中预算、归属和旁路的现有路径。本轮没有运行测试、构建或服务，没有修改生产代码。

**N01–N12 在 v0.4 中已有落点，不能再按第 2 轮的原文退回。** 对照伪代码和 Plan 之后，仍有五处会使实现与验收分叉。这五处已写入 Spec v1.0 / Plan v1.0，本轮据此定稿。

D1–D9 按 Spec §4 的推荐项冻结。D3 的冻结形态是 `lucy_continue_question` 主路径，HTTP 头保留为次要路径。

本定稿不授权开发、测试执行、治理文件变更、浏览器验证、镜像、部署或提交。SC-01–SC-48 全部未执行。

## 第 2 轮条目

| 编号 | 对 v0.4 的判定 | 理由 |
|---|---|---|
| N01 | 闭合 | `commit` 只发布权威行；停机键含轮次和窗口；重复键不覆盖磁盘。SC-42 |
| N02 | 闭合 | begin、消费、结算共用 `withScopeSerialization`。SC-43 |
| N03 | 闭合，并补 F02 | 每次 begin 都提交完整轮次。v0.4 在 `turnId` 为空时不归档 begin 前的 `busyMs`，v1.0 改为有消费则先归档。SC-44 |
| N04 | 闭合 | 续查先归档已结算时长；晚结算按票据的轮次和窗口进入归档；缺键按 0 计。SC-12 |
| N05 | 闭合 | 600 秒是单窗口 Lucy 等待上界，一次续查后问询上界 1200 秒 |
| N06 | 闭合，并补 F03 | Spec 已把上界定义为 Lucy 停止等待。Plan S3 仍写「取消不可行则继续计时」和「按实际已耗时结算」，v1.0 改为到点封顶。SC-14 |
| N07 | 闭合，并补 F04 | 顺序已是解析、授权、一次 `consume`、非 ALLOW 不执行。成功路径之外的结算改到 `finally`。SC-35、SC-46 |
| N08 | 闭合 | Plan S5 规定 schema 只有 token，参数闸不要求 connection，分类对齐 `lucy_begin_question`。现有 `validateLucyToolArgs` 对未豁免的 `lucy_*` 要求 connection，所以这项必须按 Plan 分流。SC-47 |
| N09 | 闭合，并补 F05 | Spec 要求在归属冻结前恢复 `turnId`。Plan v0.7 没有点名现有调用点。v1.0 点名 `reportedTurns.resolve`、`ensureTurn`、`wallClockMs` / `usageSlowMark`。SC-03、SC-04 |
| N10 | 未闭合，见 F01 | v0.4 设了 `commitUnverified`，但一旦置位，后续 `commit` 直接返回，核实路径不再执行。SC-48 所写的恢复没有实现步骤 |
| N11 | 闭合 | SC-06 的时点与单位已改；SC-35 不再要求停机时记次数；SC-01 归 S4；SC-29 的能力字段归 S5 |
| N12 | 闭合 | 活跃 turn 的头部可在首次耗尽的那次调用上续查。SC-45 |

## 本轮写入定稿的残余缺口

**F01｜阻塞｜未核实提交无法再次核实**

v0.4 的 `commit` 在 `commitUnverified` 为真时立即返回。失败分支把标志写上之后，下一次调用进不了 `load`。作用域会永久不可用，SC-48 的「核实后恢复」没有步骤。失败时也没有记下待核实的幂等键。

v1.0：`save` 与幂等键同事务提交。失败时记下 `unverifiedKey`，不发布候选态。下一次进入作用域锁时 `loadState` 调用 `recover`。核实读取失败则保持不可用；键已落库则发布磁盘行；键不存在则确认写入未落地，回到磁盘旧行。

**F02｜高｜未核实期间的结算增量，以及 begin 前的已结算时长，会被丢掉**

`settle` 在看到未核实标志时直接返回，票据却可能再也不会被调用。`begin` 在 `turnId` 为空时归零 `busyMs`，不归档。`begin_question` 是可选的，begin 前的消费是正常路径。归档缺键时 `+=` 会得到非数字。

v1.0：恢复失败时票据保持未结算，调用方稍后重试同一张票据。有消费的 begin 先归档再归零。归档缺键按 0 计。

**F03｜高｜Plan S3 与 Spec 的绝对时限矛盾**

Spec §6.2 写的是到点后 Lucy 停止等待并封顶记账，不证明上游引擎已停止。Plan S3 仍写取消不可行则继续计时，并按实际已耗时结算。按 Plan 实现会重新打开 N06。

v1.0 的 Plan S3 改为与 Spec、SC-14 相同的封顶规则，并覆盖内部查询。

**F04｜中｜旁路只在成功路径结算**

§6.6 把 `settle` 放在内部查询成功之后。异常退出会留下在途槽。v1.0 改为 `finally` 结算同一张票据。

**F05｜中｜Plan 没有把 N09 的调用点写到可实施的程度**

归属冻结今天发生在 `mcp-proxy.ts` 的 `reportedTurns.resolve`（约 3290 行），早于预算准入。`ensureTurn`（约 3309 行）会按 turn 键建桶。慢标记读取在 `wallClockMs`（约 340 行）和 `usageSlowMark`（约 567 行）。S7 还另写了一把「会话队列」。v1.0 点名这些调用点，并把 begin、消费、结算收成同一把作用域锁。

## 冻结的决策

| 编号 | 冻结项 |
|---|---|
| D1 | 结算口径软上限。单窗口 Lucy 等待上界 600 秒；一次续查后同一问询上界 1200 秒 |
| D2 | `continuable` 表示额度与通道同时可达 |
| D3 | 新增 `lucy_continue_question`；HTTP 头保留为次要路径 |
| D4 | 汇总层补预算终止次数，并分开记录续查呈现事实。导出是否带 `outcome` 仍按有参才筛，发起侧继续单列排查 |
| D5 | 稳定作用域、候选态经 `commit` 后才发布、全字段恢复；在途占用不恢复 |
| D6 | 同身份同会话的新 `begin_question` 显式取代旧轮次 |
| D7 | `LUCY_QUESTION_BUDGET_WALL_MODE` 默认 `settled`；`LUCY_QUESTION_BUDGET_SCOPE` 默认 `stable` |
| D8 | 指导文本改为 20 次数据工具调用，或累计 120 秒数据处理时长，不含思考时间 |
| D9 | 本期纳管 `lucy_certified_route` 与 `lucy_report_template` |

## 定稿边界

- 权威文本是 Spec v1.0 与 Plan v1.0。
- Spec 162 仍描述现行运行时。它指向的新口径版本改为 v1.0，生效条件改为 SC-01–SC-48 全部执行并发布。运行时行为不变。
- 没有新增生产代码，没有执行 SC-01–SC-48。
- 实现授权不在本次范围内。
