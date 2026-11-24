# MCP 数据面执行舱壁与跨 Agent 故障隔离 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v0.1-draft** |
| 日期 / 功能编号 | 2026-11-24／**P1-82**／REQ-030-103 |
| 状态 | S1｜v0.1-draft。终稿未确权；开发未授权；仅设计与登记，不执行实现或跑次；测试台 NOT RUN。≠ 功能合同收口；≠ 可上线 |
| 授权边界 | 本次只落盘 Spec／Plan／UAT 设计。任何运行代码、测试脚本、`package.json`、部署配置、镜像构建和正式 UAT 执行，均须在 Spec 终稿确权后另获开发授权；多副本、K8s、外置存储和 KTX 源码变更不在本 Plan 内 |
| 验收 | Spec SC-01–SC-08；同一最终候选完成 `UAT-MCPHA-R0／01–08` 必做项及实现审查 |
| 关联 | [Spec](../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md) · [UAT](../qa/uat/suites/mcp-data-plane-ha/suite.md) · [测试台 INDEX](../qa/uat/INDEX.md) |

## 目标

在当前 Docker 单实例、单副本内建立 Agent／Token／连接／全局四层 MCP 执行舱壁，使单 Agent 的多 Token、多 Session 和混合工具调用不能耗尽全部问数资源，并保证取消、断连、异常和响应超限都有真实、可核查的资源结算。

**架构：** 新建独立容量协调器，在现有 ACL 之后、任何上游执行之前做同步准入。继续复用 MCP Proxy、KTX 和安全账本，不改 KTX 源码；首期不拆 WebUI／MCP 进程、不引入多副本，以最小变化先证明跨 Agent 故障隔离。

**技术栈：** Node.js 22、TypeScript、现有 `node:http` MCP Proxy、Vitest、better-sqlite3、真实 KTX／MySQL、Docker Compose、前台 Chromium。

## 开工前置

1. 阅读并遵守 [Spec](../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md)、[UAT 夹具](../qa/uat/suites/mcp-data-plane-ha/fixtures.md)、[DEVELOPMENT「主路径可用性优先」](../governance/DEVELOPMENT.md) 和 [UAT 约定](../qa/uat/CONVENTIONS.md)。
2. 终稿裁定 Spec OQ-1–OQ-5：容量数值、是否允许短队列、响应内存上限、重试幂等、现有每 Token 4 的保留关系。未裁定前不得把草案数值写进生产配置。
3. 取得开发授权。共享工作树已有其他任务改动，实施前记录 `git rev-parse HEAD`、`git status --short`，只修改本任务文件，不清理或回退他人改动。
4. 在改前候选执行 `UAT-MCPHA-R0／01–08` 作为基线。允许记录真实 FAIL；不得先改断言或缩夹具取得假绿。
5. 明确相邻边界：
   - P1-75／P1-78 负责读路径和问询性能，不在这里重写。
   - P1-81 负责通用假活自愈，本条只提供容量指标与跨 Agent 场景，不重复实现 watchdog。
   - P1-62 负责重任务容量，本条只管 MCP 上游语义执行。
   - P1-63／69／70 负责关停、重载和读写等待，本条不修改其状态机。
   - 审计进程拆分、KTX worker 池、多副本与存储迁移另立 Spec。

## 任务分解

### Task 0：冻结改前证据与容量预算

**Files:**
- Test: `docs/qa/uat/suites/mcp-data-plane-ha/runs/`
- Modify: `docs/specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md`（仅裁定 OQ 后）
- Modify: `docs/plans/lucy-20261124-mcp-data-plane-isolation-ha-plan.md`（仅同步实际裁定）

**Steps:**

1. 用隔离 Docker、真实 KTX、两个独立只读合成连接和全局规模夹具运行 R0，保存镜像摘要、`gitSha/gitDirty`、数据库镜像、资源限制与独立 SQL 核对值。
2. 运行改前 `UAT-MCPHA-01／02／03／04／05／06／07／08`，分别记录首失败、真实在途、请求关联和清理结果。未命中目标故障记 `BLOCKED`，不能记产品 FAIL 或 PASS。
3. 从实际数据计算容量候选：数据库最大只读连接、KTX 峰值、Node RSS／事件循环、每连接与全局安全在途。证明 `agent < connection <= global`，并给同连接至少一个其他 Agent 留容量。
4. 将裁定值、理由和测量环境写回 Spec OQ；若数值未获确认，保持实现阻断。

**Expected:** 改前反例可复算，容量配置不是拍脑袋；没有运行时代码变更。

### Task 1：以 TDD 建立独立容量协调器

**Files:**
- Create: `webui/server/runtime/mcp-execution-capacity.ts`
- Test: `webui/server/__tests__/mcp-execution-capacity.test.ts`

**Steps:**

1. 先写失败测试：Agent 跨 Token／Session 汇总、Token／Session 独立上限、连接与全局上限、`agent < connection <= global` 配置拒绝、不同连接互不占额、超额不执行 `run`、无等待队列、每作用域重试建议。
2. 写生命周期失败测试：成功、明确失败、取消中、取消已确认、最终截止、重复 `release`、异常后释放、异步退出顺序。断言只有 `markUpstreamClosed()` 或 `expireAtFinalDeadline()` 能释放，不允许 `markResponseClosed()` 释放。
3. 运行并确认按预期失败：

   ```bash
   npm --prefix webui test -- server/__tests__/mcp-execution-capacity.test.ts
   ```

4. 实现最小协调器。提供 `tryAcquire()`、`trackUpstream()`、`markUpstreamClosed()`、`cancel()`、`expireAtFinalDeadline()`、`snapshotMetrics()`；租约持有一次性释放闭包，指标不包含明文 Token 或查询正文。
5. 重跑上述测试及类型检查：

   ```bash
   npm --prefix webui test -- server/__tests__/mcp-execution-capacity.test.ts
   npm --prefix webui run typecheck
   ```

**Expected:** 单元层证明四层容量与真实生命周期，不需要网络或替身数据库。

### Task 2：接入全部上游语义工具与 MCP 协议拒绝

**Files:**
- Modify: `webui/server/proxy/mcp-proxy.ts`
- Modify: `webui/server/proxy/field-exposure.ts`（仅在工具分类事实源需要补全时）
- Create: `webui/server/runtime/mcp-execution-lease.ts`
- Test: `webui/server/__tests__/mcp-execution-capacity-http.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-smoke.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-ux-resilience.test.ts`
- Test: `webui/server/__tests__/mcp-admission-all-methods.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-upstream-failure.test.ts`

**Steps:**

1. 新写 HTTP 失败测试：同一 Agent 多 Token、多 Session、混合 `lucy_query`／`lucy_read_source` 及另一个上游语义工具，验证 Agent 汇总限额；B 同连接、C 其他连接分别成交。超额请求的上游计数必须为 0。
2. 断言拒绝继续采用 HTTP 200＋MCP JSON-RPC `isError`，复用 `query_concurrency_exceeded`，带 `capacityScope`、`retryAfterMs` 和请求关联；不得出现第二套拒绝码或泄露内部 Token。
3. 运行新测试确认失败，再接入协调器：保留现有 ACL／Row Policy／预算顺序，在授权后、Hive 分流或任何 KTX／本地执行前获取租约；删除旧的 `lucyQueryInflight` 单一实现，不保留双计数。
4. 将容量租约绑定到 `trackMcpUpstreamWork()`、客户端断连取消和 `bindQuestionBudgetSettlement()` 的真实生命周期。下游 `response.finish/close` 不得直接归还执行租约。
5. 运行定向回归：

   ```bash
   npm --prefix webui test -- \
     server/__tests__/mcp-execution-capacity-http.test.ts \
     server/__tests__/mcp-proxy-smoke.test.ts \
     server/__tests__/mcp-proxy-ux-resilience.test.ts \
     server/__tests__/mcp-admission-all-methods.test.ts \
     server/__tests__/mcp-proxy-upstream-failure.test.ts
   npm --prefix webui run typecheck
   ```

**Expected:** 所有上游语义执行共用一套容量，旧每 Token 行为由新分层合同显式覆盖；合法主路径与权限语义不变。

### Task 3：补齐取消、截止与响应内存背压

**Files:**
- Modify: `webui/server/proxy/mcp-proxy.ts`
- Modify: `webui/server/proxy/question-budget-lifecycle.ts`（仅确需共享结算时）
- Create: `webui/server/proxy/upstream-body-limit.ts`
- Test: `webui/server/__tests__/upstream-body-limit.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-upstream-session.test.ts`
- Test: `webui/server/__tests__/mcp-reload-inflight.test.ts`

**Steps:**

1. 为 `readUpstreamBody()` 先写流式超限失败测试：分块输入不超过上限、恰好上限、上限＋1、持续分块、读取中取消、读取中最终截止。断言在上界＋1 到达时立即停止，而非完整读完后才报错。
2. 写全局内存背压测试：多个未超限响应合计越过预算时，后续请求快速繁忙；单请求超限不影响其他 Agent 的小查询；敏感结果正文不进入错误日志。
3. 写断连与不确定执行测试：客户端断连后只发起一次取消，在上游未结束时容量保持；真实 close 后释放；响应丢失但执行状态未知时不得自动重试。
4. 运行测试确认失败，再实现有界读取、剩余截止传播和全局内存租约。默认单响应值与既有 `ResponseGate` 对齐，最终数值以 OQ-3 为准。
5. 运行：

   ```bash
   npm --prefix webui test -- \
     server/__tests__/upstream-body-limit.test.ts \
     server/__tests__/mcp-execution-capacity-http.test.ts \
     server/__tests__/mcp-proxy-upstream-session.test.ts \
     server/__tests__/mcp-reload-inflight.test.ts
   ```

**Expected:** 上游流、请求内存和真实工作生命周期都有上界，不削弱现有响应提交屏障。

### Task 4：增加容量观测与故障分类，不重复 P1-81

**Files:**
- Create: `webui/server/runtime/mcp-execution-metrics.ts`
- Modify: `webui/server/index.ts`（仅在既有 `/api/health` 增加只读字段时）
- Modify: `webui/server/proxy/audit-classification.ts`（仅映射既有分类不足时）
- Test: `webui/server/__tests__/mcp-execution-metrics.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-audit-meta.test.ts`
- Test: `webui/server/__tests__/mcp-runtime-status.test.ts`

**Steps:**

1. 先写字段与脱敏失败测试：按 Agent／Token／connectionId／全局记录当前占用、峰值、拒绝作用域、取消中、真实释放与恢复时间；无原始 Token、密码、问题或结果行。
2. 写故障分类测试：容量拒绝、权限拒绝、审计不可用、上游不可用、`indeterminate` 不可互相冒充；HTTP 200 的错误信封不能被统计为问数成功。
3. 运行测试确认失败，再实现只读指标。不要新增 watchdog、自动重启或通用假活状态机，那些归 P1-81；这里只提供它可消费的容量事实。
4. 运行：

   ```bash
   npm --prefix webui test -- \
     server/__tests__/mcp-execution-metrics.test.ts \
     server/__tests__/mcp-proxy-audit-meta.test.ts \
     server/__tests__/mcp-runtime-status.test.ts
   ```

**Expected:** 运维可区分“单 Agent 过载”与“平台共享依赖失败”，不需要读取私有日志正文。

### Task 5：实现确定性 UAT 测程与负控

**Files:**
- Create: `scripts/uat/mcp-data-plane-ha.mjs`
- Create: `scripts/uat/mcp-data-plane-ha.test.mjs`
- Modify: `package.json`
- Modify: `docs/governance/test-layers-and-release-gates.md`
- Modify: `docs/qa/uat/suites/mcp-data-plane-ha/cases.md`（仅当实际入口需要补充，不改判据）

**Steps:**

1. 先写测程负控：假成功、错误 SQL 值、客户端假并发、未命中慢查询、容量占用不归零、把下游 close 当上游 close、把 `indeterminate` 当成功、缺前台计时、缺故障交叠均须判失败。
2. 实现 `calibrate`、`r0`、`case <id>`、`judge <receipt>` 和 `clean` 子命令。逐次记录计划、实际发出、服务端接纳、容量获取／拒绝、上游 close、响应、独立 SQL、浏览器和清理，禁止只写汇总百分比。
3. 在 `package.json` 增加 `uat:mcp-ha` 与 `uat:mcp-ha:test`，并在测试门禁文档的 Current Commands 和 CI Mapping 写明“本机人工 UAT，不进 PR CI；测程单测不代替真实跑次”。
4. 运行：

   ```bash
   node --test scripts/uat/mcp-data-plane-ha.test.mjs
   npm run uat:mcp-ha -- calibrate
   ```

5. 用改前候选跑 R0／01–08，证明测程能检出已知缺陷；不能用替身 KTX 或手工修改业务响应代替真实故障。

**Expected:** 测程本身可证伪，原始证据可独立复算，凭据只从仓库外私有路径读取。

### Task 6：同候选回归、UAT 与文档闭环

**Files:**
- Test: 上述全部运行与测试文件
- Modify: `docs/qa/uat/suites/mcp-data-plane-ha/runs/YYYY-MM-DD-<agent>-<short>.md`
- Modify: `docs/qa/uat/INDEX.md`
- Modify: `docs/governance/e2e-ledger.md`
- Modify: `docs/specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md`
- Modify: `docs/plans/lucy-20261124-mcp-data-plane-isolation-ha-plan.md`

**Steps:**

1. 运行完整相关回归和类型检查：

   ```bash
   npm --prefix webui test -- \
     server/__tests__/mcp-execution-capacity.test.ts \
     server/__tests__/mcp-execution-capacity-http.test.ts \
     server/__tests__/upstream-body-limit.test.ts \
     server/__tests__/mcp-execution-metrics.test.ts \
     server/__tests__/mcp-proxy-smoke.test.ts \
     server/__tests__/mcp-proxy-ux-resilience.test.ts \
     server/__tests__/mcp-admission-all-methods.test.ts \
     server/__tests__/mcp-proxy-upstream-failure.test.ts \
     server/__tests__/mcp-proxy-upstream-session.test.ts \
     server/__tests__/mcp-reload-inflight.test.ts \
     server/__tests__/mcp-proxy-audit-meta.test.ts \
     server/__tests__/mcp-runtime-status.test.ts
   npm --prefix webui run typecheck
   node --test scripts/uat/mcp-data-plane-ha.test.mjs
   ```

2. 在同一最终镜像执行 `npm run uat:mcp-ha -- all`，完成 R0／01–08，保留改前对照、首失败、恢复和清理证据。缺真实前台、真实故障或精确释放证据的对应项记 `BLOCKED`，不得降低为单元测试通过。
3. 做实现审查：重点检查四层容量是否可绕过、审计／撤权是否变弱、是否有未纳管工具、是否重复执行不确定查询、是否泄露敏感信息。
4. 全量文档检查：

   ```bash
   npm run lint:spec-docs
   npm run lint:status-vocab
   npm run lint:status-funnel
   npm run lint:inventory-stage
   npm run lint:spec
   npm run lint:terminology
   npm run lint:ia-boundary
   npm run lint:e2e-ledger
   ```

5. 按实际结果更新 INDEX 和缺口，再决定是否请求功能合同收口。提交、推送、发布、客户部署均另行授权，不在本 Plan 默认动作中。

**Expected:** SC-01–SC-08 均有代码级与真实产品证据；功能合同、UAT 和可上线三者仍分别登记。

## 后续阶段（只登记，不执行）

1. **B1 Spec：** 独立单写者 audit writer、WebUI／MCP 进程隔离、版本化配置和撤权传播。须证明 WebUI 进程退出不影响 MCP，并保持审计 fail-closed。
2. **B2 Spec：** Lucy 路由下的 KTX worker 池、Session 粘滞与新版本 canary／切流／旧版本排空。不得修改 KTX 源码来隐式扩大范围。
3. **C Spec（发布取证）：** MCP 数据面多副本。先解决强一致 Token／Role／预算／审计／撤权、Session 漂移、后台任务单例和共享存储，再设计故障切换；不得直接修改 `replicaCount` 或共享 RWO SQLite。

每个阶段必须另有独立 Spec／Plan／UAT、终稿确权和开发授权。本条不为其预留实现分支或宣称支持。

## 浏览器验证

不适用：不改变用户可见 WebUI 表面。仅 `UAT-MCPHA-03` 观察既有页面错误与恢复，必须使用真实前台桌面 Chromium（默认 1920×1080），逐次记录导航→错误提示可见、故障解除→正确内容可见的即时计时，并与同窗口 API 状态／耗时分列；保存焦点、网络回执和截图。其他用例为纯 MCP／API／进程与数据库故障注入，不强制浏览器。只有 API 或后台标签证据时，03 记 `BLOCKED`，不得主张 WebUI 面通过。

## 验收

1. Task 1–5 的定向测试、类型检查与测程负控全部通过。
2. 同一最终候选完成 `UAT-MCPHA-R0／01–08`：多层容量生效，其他合法 Agent 仍成交，真实释放和恢复可核查，无重复不确定执行。
3. ACL、Row Policy、Token 撤权、审计持久化与现有 MCP 客户端兼容不回归。
4. 测试台 INDEX 按实际结果更新；GAP-UAT-P1-82 仅在必做证据齐全后关闭。
5. 文档门禁通过且没有新增运行文件落到任务范围之外；提交／发布另行授权。

## 完成定义

- Spec、实现和 UAT 三者一致，SC-01–SC-08 有可复查证据。
- 四层容量不是纸面配置：跨 Token／Session、混合工具、连接和全局对抗均真实命中。
- 取消、断连、响应丢失和超限不会提前归还容量；恢复后无残留占用。
- 未把局部检查写成完整 HA，未把单实例结果外推为多副本或客户环境通过。
- 完成以上后才可请求委托人验收；功能合同收口 ≠ UAT PASS ≠ 可上线。

## 风险

| 风险 | 处理 |
|---|---|
| 阈值过严伤害合法问数 | 先全局规模实测，再裁定；保留快速重试和其他 Agent 正向对照，不靠加大阈值追绿 |
| 新工具绕过容量 | 以 `requestWouldHitUpstreamSemanticExecution()` 为唯一判定并做分类覆盖测试 |
| 数据库已执行但客户端未知 | 标记 `indeterminate`，不自动重放；保留 operation／attempt 与数据库侧证据 |
| 指标或日志泄露敏感信息 | 字段白名单和脱敏负控；不记录原始 Token、密码、问题或结果正文 |
| 测试构造只打中客户端而未打中真实资源 | R0 校验真实在途、数据库进程与容量事件；未命中记 BLOCKED |
| 当前阶段被误读为进程／多副本 HA | 非目标、总账、INDEX 与跑次均明确单实例边界；后续阶段另立 Spec |
