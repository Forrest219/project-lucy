# Run — 2026-11-28 — kscc-budget-analyst-ux — UAT-SUITE-BUDGET-ANALYST-UX

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-BUDGET-ANALYST-UX` **v1.1**（Spec §10.3 同步版） |
| 总账 / Spec | **REQ-0122** · [Spec](../../../../specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md) v1.0-r8（SC-01–SC-12＋SC-02b＋SC-07b） |
| Agent | kscc（Claude Code 1.3.8）——MCP 臂为脚本化真实 HTTP＋Bearer 客户端；BA-12A／12B／并发补充臂为**真实 Claude Code 会话**（`kscc -p --mcp-config`，stream-json 轨迹落盘） |
| 环境 | 本机 demo Docker（`compose-lucy-1`，`project-lucy:demo` 重建于 2026-11-27 23:39，gitSha `5c5ce3ee`，gitDirty=true）；MCP `:57881`；WebUI `:55176`；BA-11 独立栈 `ba-rollback`（`:56176`／`:58881`） |
| 慢源夹具 | demo MySQL 新建库 `slow_gauge`：`gauge_fact`（5 行，oracle 合计 569.85）＋四个单行标定视图 `v_sleep_45/60/90/200`（标量子查询模式，实测 45s 档全链路 45.4–45.6s）；经新连接 `slow-mysql`（`query_timeout_ms=300000`，绕开 KTX 默认 30s 查询超时——这是 Lucy 配置层参数，不修改 KTX 源码）注册为 4 个语义源；`ba_uat_role` 授权 |
| 身份 | 15 个新建身份（`ba_zero_01–05`／`ba_active_01`／`ba_inactive_01`／`ba_cc_main`／`ba_rollback_01`／`ba_busy_01`／`ba_fail_01`／`ba_pool_01–04`），全部新 Token＝预算零态；绑定 `ba_uat_orders_count`（published）于 17:53 经 `/api/semantic-assets/reindex` 发布，此后 begin 全局可见 |
| 证据 | [`inbox/uat-ba-20261127/evidence/*.jsonl`](../../../../../inbox/uat-ba-20261127/evidence/)（逐事件）· [`cc-12a/`／`cc-12b/`／`cc-12-conc/`](../../../../../inbox/uat-ba-20261127/)（Claude Code 轨迹） |
| PRE-01 | **只引用** [`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../../../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)，未重抓包（R0 登记） |
| 勾连 | UAT-IMC-03（REQ-0119）：本跑次仅登记指针，未执行（integration 身份不冒充） |
| 总判定 | **PASS WITH FINDINGS**（15/15 臂 PASS；BA-12 并发补充臂 PARTIAL；F1／F2／F3 均已修复并回归验证关闭，详见 FINDINGS 表与文末补充节）。≠ 功能合同收口；≠ 可上线 |

## 结果

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-BA-R0 | **PASS** | health ok（capacity 8/16/32/48 新档生效）；15 身份 MCP initialize／tools/list 正常；D7 指令核查全绿（无 `"stop looping"`、60 query-tier／900s、并发 8＋缩并发引导、静默逃生指引）；45s 档标定 45.4s＝oracle 569.85；预算零态确认；PRE-01 引用登记；IMC-03 指针登记 |
| UAT-BA-01 | **PASS** | 零态连续 `lucy_query`：第 61 次返回 `question_budget_exhausted`＋`continuable:true`＋`continueToken`＋`next_step(lucy_continue_question/continue)`；审计 `budget_stop`，snapshot `exhaustedBy=calls, calls=60, maxCalls=60, maxBusyMs=900000`（D3 新默认在快照可见） |
| UAT-BA-02 | **PASS** | `lucy_read_source` 前 200 次放行、第 201 次触独立上限；停机快照 `calls=0, busyMs=0, exhaustedBy=meta`——轻工具不占主桶（两次独立会话复跑一致） |
| UAT-BA-02b | **PASS** | 敌对臂：8 个窗口每窗 201 触顶；inactive 5 档续查在第 6 窗前耗尽→`continuable:false`→按 `next_step` `mode=new_question` 重开成功（`reopen:true`，既有硬停再开语义）；全程 reason 均为 `question_budget_exhausted`，**无** `metaCallsLifetime`／速率护栏 reason。正臂：换窗后 `lucy_read_source` 成交 |
| UAT-BA-03 | **PASS** | 8 轻＋8 重并行全放行（分池互不干扰）；第 9 路重查询被拒，完整信封 `data:{reason, retryable:true, retryAfterMs:1000, next_step:{reduce_concurrency_and_retry, max_inflight:8}}`＋`_meta.lucy` 同形；第 17 路轻工具被元数据池拒绝（max_inflight:16）。「拒绝不扣 calls」子点经 F1 修复＋回归闭合（修复前发现见 FINDINGS） |
| UAT-BA-04 | **PASS** | 槽释放后缩并发（1 路）重发合法查询成交，返回行集正常 |
| UAT-BA-05 | **PASS** | 45s 慢查询不被 30s 掐断：实测 45.35s 成交，`busyMs` 全额结算（预算态 busy≈45s／call），oracle 569.85，`answer_verifiability` 携带 |
| UAT-BA-06 | **PASS** | 15×60s（8＋7 两波，settled busy 累计 900s）全放行；第 16 次触顶 `continuable:true`；`lucy_continue_question(continue)` 换窗后快速查询成交（兼 BESC-10A 主臂语义） |
| UAT-BA-07 | **PASS** | 4×`v_sleep_200`（被 120s 绝对执行时限掐断）全部记账为 `failedKind=timed_out, rawDeltaMs=120000, billedBusyMs=30000`（封顶 30s）；第 5 次正常成交；`no_data` 对照臂不封顶（正常空结果返回）。审计 settlement 四行齐全 |
| UAT-BA-07b | **PASS** | 单窗靠 busy 截停为 `question_budget_exhausted`（非连败 N reason）；inactive 5 档续查逐窗消耗：第 5 档尽后 `continuable:false`＋`next_step mode=new_question`，按指引重开成功（`reopen:true`，既有硬停再开）；重开窗继续有界耗尽；全程 `failedKind=timed_out` 与 raw（120s）／billed（30s）可区分（审计 344 条 timed_out settlement＋80 条 budget_stop，无「连续失败 N 次」独立 reason） |
| UAT-BA-08 | **PASS** | 8 路慢查询在途时客户端断开（模拟 Esc），断开后 ~6.2s／6.9s 两次新查询均准入成交（D5 5s 冻结生效，不再锁 30s） |
| UAT-BA-09 | **PASS** | 4 Token×8 路共 32 路全放行（connection 32 新档）；第 33 路按 `scope=connection` 拒绝，完整信封含 `retryable:true`、`retryAfterMs:2000`、`next_step.max_inflight:32`；槽释放后缩并发重试成交且 oracle 569.85。「拒绝不扣 calls」子点经 F1 修复＋回归闭合（33 路 token calls=0 实测） |
| UAT-BA-10 | **PASS** | begin 建立问询（turnId 下发）；active 作用域连续 3 档续查成交；第 4 窗 `continuable:false` 且 `next_step={action:lucy_begin_question}`（D6 3 档硬停；兼 BESC-07 回归） |
| UAT-BA-11 | **PASS**（范围说明） | 独立栈 `ba-rollback`（同镜像＋SC-11 环境变量）：health `mcpCapacity.limits=4/8/16/24` 精确回退；initialize 指令回退为「60 query-tier／300 seconds／defaults to 4」（无 900s 残留）；12 路并发实测 4 过 8 拒（`scope=token, max=4`）。取消冻结 30s 与上游超时 30s/90s 未做容器级慢源行为复测（该栈无慢源夹具；以单测＋env 注入为准），如实记范围 |
| UAT-BA-12A | **PASS** | 真实 Claude Code：任务起始主动 `lucy_begin_question`；369 次 `lucy_query`（30 轮×region 轮巡）；6 次触顶全部静默处理——4 次 `lucy_continue_question(continue)`、active 档尽后按 `next_step` **重新 `lucy_begin_question`**（新 turn）续跑；零中断、零求助、零缩范围；最终答复含 30 轮一致数字＋`answer_verifiability` 披露。轨迹 [`cc-12a/trajectory.jsonl`](../../../../../inbox/uat-ba-20261127/cc-12a/)（386 工具调用） |
| UAT-BA-12B | **PASS** | 真实 Claude Code（零绑定实况，绑定发布**前**执行）：406 次 `lucy_query`（45 轮×9 组合）；11 次触顶——10 次 `continuable=true` 静默 `lucy_continue_question(continue)` 补齐、1 次 `continuable=false` 按 `next_step` **同 token `mode=new_question` 重开**后补齐；全程未中断未求助；最终输出含轮次统计＋数字表。轨迹 [`cc-12b/trajectory.jsonl`](../../../../../inbox/uat-ba-20261127/cc-12b/)（435 工具调用，3.1MB） |
| BA-12 并发补充臂 | **PARTIAL** | 真实 Claude Code 11 路并行快查询未触发 `query_concurrency_exceeded`（快查询完成快于排队，时序未撞 8 路闸）；agent 侧缩并发重试证据以 BA-03／04／09 harness 臂为准（结构化信封＋缩并发成交已在 12A 指令遵循面验过）。三次尝试登记于此，不造假绿 |
| 勾连 UAT-IMC-03 | **NOT RUN**（指针） | 归 REQ-0119 套件；本跑次 interactive 身份未冒充 integration |

### BA-07b 判定细节（两次执行）

- 首跑（17:27）：8 路并行失败批第 5 轮全停（busy 900s 截停，非连败 N reason）→ `continue(continue)` 逐窗消耗（窗 1→2→3）。**执行中断点**：17:51 操作员为 BA-10 前置发布绑定触发 mcp-runtime reload，预算持久化状态受重载影响，第 4 窗后未再按预期停机——该次在此截断，作废后续窗判定。
- 复跑（17:53，独立会话）：同型 5 轮触顶→续查窗 1→2→3→4→5 推进；第 5 档尽 `continuable:false`→`mode=new_question` 重开（`reopen:true`）→重开窗（窗 6）继续有界耗尽（`continuable:true` 重新计档）。**敌对臂完整梯级 PASS**：跨窗受 D6／P1-74 总档约束，硬停再开语义与 BA-02b 一致。
- 审计维度两跑合计：`timed_out` settlement 344 条（raw 120s／billed 30s 全部可区分）、`budget_stop` 80 条，无「连续失败 N 次」独立 reason。

## 发现（需收口裁定）

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| **F1** | ~~并发拒绝不退账~~ → **已修复（2026-11-28）**：capacity 层拒绝发生前，预算层已 consume 且拒绝后无 refund——每次拒绝多扣 1 次 `calls`（query 桶）或 `metaCalls` | `question_budget_state`：`bq:ba_zero_03|…:d0611d2d` calls=18（审计实际成交 17 ok＋1 denied）、meta_calls=25（24＋1）；`…:2b2e7fc5` calls=9（8＋1）。busyMs 不受影响（无 settle 不入账） | **修复与验证**：`refundQueryAdmission`／`refundMetaAdmission` 对称退账（幂等键 `refund:<ticket.requestId>`／`refund-meta:<uuid>`，已退 ticket 置 settled 防双退，窗口已滚动不退）；单测 `question-budget-refund.test.ts`＋定向回归 11 文件 98 用例全绿；demo 镜像 2026-11-28T01:04Z 重建后实机回归：query 臂第 9 路拒绝后 calls=8、meta 臂 metaCalls=16、connection 臂 4 token 各 calls=8＋第 33 路 token calls=0。SC-03「不扣 calls」子点闭合 |
| **F2** | ~~预算层 inflight 记账并发失真~~ → **已修复（2026-11-28）**：根因＝生产持久化表无 `inflight` 列，`commit()` 用 DB 回读行覆盖内存缓存致每次 admit 后 inflight 洗零，预算层并发闸永不触发 | 同上快照＋单测红绿验证 | **修复与验证**：`commit()` publish 前从 candidate 补回进程本地 `inflight`/`currentConcurrency`；单测 `question-budget-inflight-roundtrip.test.ts` 红绿双向；实机 8 路并发后 peak=8、第 9 路预算层拒（`question_budget_concurrency_exceeded`）、calls 停在 8。关闭 |
| **F3** | ~~reason 码与 Spec D2 不一致~~ → **已修复（2026-11-28）**：capacity 层 query 池 reason 统一为 `question_budget_concurrency_exceeded`（与 D2 伪码及 D7 instructions 承诺一致；meta 池保留专名） | BA-03／09 拒绝载荷 | 配套 trace-span budget_stopped 分支按 outcome 收窄、UI 标签增新码留旧码、4 个测试文件 9 处断言同步；实机拒绝行 reason 已为新码。关闭 |

## 环境备注

1. `data-qa-instructions` health 字段显示 `source=missing` 为懒加载态（role-aware 指令路径不读该 md 回退文件），实际 `initialize` 指令内容含全部 D7 要点——非缺陷，登记避免误读。
2. KTX 连接默认 `query_timeout_ms=30s` 与 D3 的代理层超时（idle 90s／hard 120s）是两层独立超时；慢源夹具连接需显式放宽 `query_timeout_ms`，否则 45s 查询在 KTX 层先被掐断（本次以 `300000` 配置）。
3. BA-07 实测超时由**绝对执行时限 120s** 触发（idle 90s 未先触发，上游有响应字节活动），failedKind=timed_out 记账路径与 Spec OQ-4 一致。
4. 绑定发布使全实例参与态翻转为 active：既有 inactive 作用域按快照策略不受影响（BA-07b 复跑期间交叉验证）；BA-12B 必须在发布**前**执行（本跑次已按此顺序）。

## 复跑建议

- F1 修复已带实机回归（见 FINDINGS 表 F1 行）：后续如再触碰 capacity 拒绝路径，重跑 BA-03／09 拒绝臂并复查 `question_budget_state` 计数即可。
- F2／F3 裁定后如改实现：重跑 BA-03／09 拒绝臂核对 reason 码与信封，并同步 instructions 文案与单测断言。
- BA-13（hive-jd 客户环境补跑）保持可选未跑。

## 附：F1 修复回归（2026-11-28，同跑次补充）

- 代码：`question-experience.ts` 新增 `refundQueryAdmission(ticket)`／`refundMetaAdmission(scopeKey)`；`mcp-proxy.ts` capacity 拒绝分支在响应前 `await` 退账。
- 单测：`question-budget-refund.test.ts`（3 用例）＋预算／容量定向回归 11 文件 98 用例全绿；`tsc --noEmit` 干净。
- 实机：demo 镜像 `2026-11-28T01:04:52Z` 重建（volume 保留）后回归三臂——query 臂第 9 路拒绝后 `calls=8`（修复前为 9）；meta 臂第 17 路拒绝后 `metaCalls=16`；connection 臂 4 token 各 `calls=8`、第 33 路拒绝所在 token `calls=0`。
- 结论：SC-03「拒绝不扣 calls/busyMs」子点闭合；SC-09 同点闭合。

## 附：F2／F3 修复回归（2026-11-28，同跑次补充二）

- **F2**：根因＝生产持久化表 `question_budget_state` 无 `inflight` 列，`commit()` 用 DB 回读行经 `publish()` 覆盖内存缓存，每次 admit 后 inflight 洗零，预算层并发闸永不触发（防护退化）。修复：`commit()` publish 前从 candidate 补回 `inflight`/`currentConcurrency`（进程本地计数，跨进程重启仍由 loadState 归零）。单测 `question-budget-inflight-roundtrip.test.ts` 红绿双向（撤修复→2 用例红）。
- **F3**：capacity 层 query 池 reason `query_concurrency_exceeded` → `question_budget_concurrency_exceeded`（与 D2 伪码／D7 instructions 一致；meta 池保留 `meta_concurrency_exceeded`）。配套：`audit-trace-span` budget_stopped 分支按 outcome≠denied 收窄（capacity 拒绝归 timeout 桶）；`decisionReasonLabels` 增新码标签保留旧码（历史审计行）；分类器既有新码分支已覆盖。
- 定向回归：15 文件 151 用例全绿＋`tsc` 干净。mcp-proxy-smoke 的 3 个 P1-82 失败为**存量**（基线对照一致，D2 元数据池改造 vs P1-82 旧期望的既有账），不在本次范围。
- 实机（demo 镜像 2026-11-28T01:5x 重建后）：8 路并发后快照 `peak=8, calls=8`；第 9 路审计 `error/question_budget_concurrency_exceeded`（预算层先拒）；calls 停在 8；释放后重试成交。
- 结论：SC-03 的预算层闸与 reason 命名两子点闭合；SC-09 同步闭合。
