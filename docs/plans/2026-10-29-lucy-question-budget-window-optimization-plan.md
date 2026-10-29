# 问询预算窗口与预算终止可观测性优化实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.6** / 2026-10-29 |
| 目标版本 / 优先级 | v0.25（修订线）/ **P0**（S2–S5）+ P1（S1、S6）+ P2（S7） |
| 主 Spec | [问询预算窗口与预算终止可观测性优化 Spec](../specs/lucy-20261029-question-budget-window-optimization-spec.md)（**v0.3**） |
| 需求来源 | 2026-10-29 生产事故（用户 liuzongxuan / `codex-mcp-client`）：零次数据工具调用即被 `question_budget_exhausted` 拦下，客户侧无法自行恢复 |
| 状态 | **v0.6 作者定稿基线，未批准**。第 1 轮 Codex 审阅（4 阻塞 / 8 高 / 1 中 / 1 低）已落盘；本版与 Spec v0.3 对齐。**第 2 轮未进行** |
| 授权边界 | **无。** 不授权 S1–S9 任何阶段的编码、不授权测试执行、不授权治理文件变更、不授权浏览器验证、镜像、部署或 git 提交 |
| 验收 | SC-01–SC-41 **全部未执行** |
| 实施主体 | Lucy（Proxy 问询预算层 + Admin 审计导出层）；不修改 KTX 源码 |
| 已拍板决策 | **无**。Spec §4 的 D1–D9 全部待 PM 拍板 |
| 待确认 | **D1–D9 全部未拍板**。D1（墙钟口径）、D3（续查兑现通道）、D9（旁路纳管）为开工阻塞项；其余可同批拍板但不得由实现侧代决 |
| 本版修订 | **v0.6（2026-10-29，作者定稿）**：与 Spec v0.3 对齐，不改阶段顺序、不改 D1–D9 推荐、不授权开发。① S3/S5 写明 `settle` 与 `consume` 走同一 `commit` 与同一把作用域锁；② S2 状态字段补 `presentedToken`（停机凭证，禁止回传 `scopeKey`）与 `archivedBusyMsByWindow`；③ S8 / 术语验收改为三条词条，含「可继续」；④ 审阅基线改为 Spec v0.3 / 本 Plan v0.6。**v0.3（2026-10-29）**：据第 1 轮审阅 14 条发现重排。**R12** → 阶段重排为「**可观测性先行**」，原 S2 拆为 **S2 稳定预算身份与持久化正确性 / S3 统一结算与窗口票据 / S4 墙钟口径**三个独立可验收单元，S5 续查与 S8 治理文本**同批启用**（避免指导指向不可见工具）；**R01/R04/R05** → S5 增「持久化待兑现状态 + 落库先行」；**R02/R03** → S3 增「结算协调器 + 并发上限 + 绝对执行时限」；**R06** → S2 增「作用域键脱离 turn 注册表 + 全字段恢复 + 真实重启验收」；**R07/R08** → S7 增「身份隔离 + 同会话串行 + 事务内重检」；**R09** → S5 增 `acl.ts` / known tools / 角色授予 / 迁移；**R10** → S6 新增旁路入口纳管；**R11** → S1 把导出发起侧拆为独立排查项、不再宣称服务端默认值；**R14** → S8 增术语标准修订与章节引用修正。**v0.4（2026-10-29，PM 授权代改 Spec 162 + 自查补漏）**：Spec 162 升 v0.4 并落**修订声明**（顶部 callout + §7.2「修订后口径（尚未实现）」小节 + §10 SC-4 口径说明），**不写现行已实现语义**，新口径自本 Spec SC 全部执行并发布后生效；§3.3 补 `scripts/lint-spec.mjs`（新增工具的 `classifiedRoleTools` 硬编码白名单，不同步则 `lint:spec` 失败）与 `webui/config/access.yaml`（治理类文件）两个实施落点，并补 `docs/README.md`／`docs/governance/project-overview.md` 两处登记册；§3.2 补术语标准第三条词条「可继续 Continuable」；修正 `turn-correlation.ts` 引用行号与「跨进程」措辞（触部署拓扑红线边界）。**v0.5（2026-10-29，形态门禁落地后补勾销 + 权威登记册登记项）**：新增 §9「落盘清单勾销」，逐条勾销 `docs/governance/DEVELOPMENT.md`「新增 Spec / Plan 的落盘清单」10 条（第 6 条 Design System 四段式与第 8 条新增命令登记标**不适用并写明理由**，第 9 条功能编号标**待 PM 指派**）；S9 补「编号指派后须在权威登记册登记」。**注**：并发会话同期新增了形态门禁 `lint:spec-docs`（`scripts/lint-spec-docs.mjs`），本 Spec／Plan 已通过该门禁（120 files scanned）。**v0.1、v0.2 见文末。** |

---

## 1. 目标与实施原则

把问询预算从「惩罚 agent 思考」的闸门，改回「数据侧资源额度」的闸门，并让预算终止**可被观测、可被自助恢复**。

六个交付物：

1. **稳定预算身份**（S2）——预算作用域由「身份 + 会话」确定，脱离 turn 注册表的 10 分钟过期。
2. **统一结算与窗口票据**（S3）——结算点从 `res.close` 改为上游真正结束；耗时按窗口归档。
3. **墙钟口径改写**（S4）——第二维度改为「已结算数据处理时长」，空闲不计入，并给出可证明的有界超支。
4. **`continuable` 真实性**（S5）——重新定义为「该调用者是否仍有**可达**的继续通道」。
5. **续查兑现通道**（S5）——新增 `lucy_continue_question`，以持久化待兑现状态打通「声明 → 消费」。
6. **预算终止可观测性**（S1）——汇总层补「预算终止次数」并修正恒等式；记录续查呈现事实。

另含两项：旁路入口纳管（S6）、同会话重开问询的显式取代（S7）。

实施原则：

- **先看见，再放宽**：可观测性（S1）排在最前，**不得**让新行为先上线、审计与模型指导随后补（R12）。
- **不新增第三个预算维度**：`calls`（20 次）与 `busyMs`（120 秒已结算处理时长）两个维度封顶，不引入独立的问询超时机制。
- **续查是「换窗」不是「加额度」**：续查把 `calls` 与 `busyMs` 同时归零，不产生净增额度；同一问询至多一次。
- **落库纪律统一**：任何状态变更一律「候选态 → 落库 → 发布内存 + 发审计」；落库失败保留旧态并标记作用域不可用。
- **可回退粒度**：每类行为改动一个独立开关，见 §7。
- **改他条目须有授权**：2026-10-29 PM 明确授权代改 Spec 162，故 §7.2 的修订声明已落地（见 §3.3、S9）；**除该授权范围外**不代改他人条目——本 Plan 只触碰 Spec §4 决策表与本 Plan 自身。
- **指导文本与新通道同批**：S5 与 S8 是一个发布单元——指导若先于新工具生效，会把模型导向不可见工具（R09）。
- **任何实现完成声明均不自动等于 SC 验收通过。**

---

## 2. 开工前置

### S0 开工裁决（**未进行**）

开工前置：**PM 拍板 D1–D9**。其中：

- **D1（墙钟口径）**——阻塞 S3、S4。口径决定「有界超支」的因子取值。
- **D3（续查兑现通道）**——阻塞 S5。通道形态决定待兑现状态的结构、工具 schema 与 ACL 落点。
- **D9（旁路纳管）**——阻塞 S6。
- D2、D4、D5、D6、D7、D8 可与上述同批拍板，但不得由实现侧代决。

审阅基线：**Spec v0.3 / 本 Plan v0.6**（作者定稿）。第 1 轮 Codex 结论与逐条回应见 [`docs/reviews/2026-10-29-codex-review-question-budget-window-optimization.md`](../reviews/2026-10-29-codex-review-question-budget-window-optimization.md) 与 Spec §10。第 2 轮尚未覆盖 v0.3 / v0.6。

**退出条件（待满足）**：D1–D9 全部裁定并回写 Spec §4；PM 在 §4 签字栏留下裁定结论。

**开工后仍须遵守**：

- 预算终止**不是**权限拒绝：`execution = not_executed` + `primary_status = budget_stopped`（`webui/server/proxy/audit-classification.ts:385`），不得改写为 `denied` / `error`。
- D-24 并发封顶语义不得放宽：同一作用域的「装载 → 判定 → 落库」仍必须串行（`webui/server/proxy/question-experience.ts:134`）。
- 持久层不可读时仍 fail closed，返回 `question_budget_unavailable`，**不得**记为预算终止。
- 新增工具走既有工具可见性与 ACL 机制，不新增授权面。
- 指导文本与术语标准属治理类文件，走 Plan Mode，与 S8 同批验收。

---

## 3. 现状依赖与文件落点

### 3.1 复用边界

| 复用 | 位置 | 说明 |
|---|---|---|
| 预算判定与状态机 | `webui/server/proxy/question-experience.ts` | 改造既有 `QuestionBudget`，**不新建并行预算实现** |
| 持久层接口 | `webui/server/proxy/question-experience.ts:83-96` | `BudgetPersistence` 接口不变；装载时机与字段扩展 |
| 持久层实现 | `webui/server/proxy/audit.ts:1112` | `question_budget_state` 表扩列与迁移 |
| 预算闸与停机响应 | `webui/server/proxy/mcp-proxy.ts:3829-3928` | 响应形状不变；改 `continuable` 取值、续查入口与结算挂载点 |
| 工具注册与可见性 | `webui/server/proxy/mcp-proxy.ts:1166-1180`、`mcp-proxy.ts:1466-1482` | 新工具按既有模式登记 |
| 工具分类与角色授权 | `webui/server/proxy/acl.ts:99-136`、`acl.ts:2396` | 新工具须分类入既有集合并纳入角色授予（**v0.3 新增**） |
| 预算分类 | `webui/server/proxy/audit-classification.ts:385`、`audit-classification.ts:519` | `budget_stopped` 分类不变 |
| 问询汇总 | `webui/server/admin/audit.ts:1918-1990`、`admin/audit.ts:2193-2260` | 新增「预算终止次数」列并修正恒等式 |
| 审计包导出 | `webui/server/admin/audit.ts:225` | **只做「有参才筛」**；无筛选与显式筛选两种情形分别验收 |
| 导出发起侧 | `webui/src/pages/admin/Audit.tsx:1480`、`Audit.tsx:1846`、`Audit.tsx:703` | **v0.3 新增**：前端导出入口的参数来源列为独立排查项 |
| turn 归属注册表 | `webui/server/proxy/turn-correlation.ts:57-160` | 增加取代能力，不改证据顺序；**预算作用域不再依赖它** |
| 认证路由 / 报表模板 | `webui/server/proxy/mcp-proxy.ts:3992`、`mcp-proxy.ts:5490` | 纳入统一预算边界（**v0.3 新增**） |

### 3.2 计划新增文件

| 文件 | 用途 | 阶段 |
|---|---|---|
| `webui/server/__tests__/question-budget-scope-identity.test.ts` | 稳定预算身份、10 分钟过期不换桶、真实重启恢复 | S2 |
| `webui/server/__tests__/question-budget-settlement.test.ts` | 统一结算、窗口票据、并发上限、绝对执行时限 | S3 |
| `webui/server/__tests__/question-budget-window-mode.test.ts` | `settled` / `elapsed` 两口径对照 | S4 |
| `webui/server/__tests__/question-budget-continuation.test.ts` | 声明—消费两段式、双路径并发去重、`continuable` 能力语义 | S5 |
| `webui/server/__tests__/question-budget-bypass-scope.test.ts` | 认证路由 / 报表模板的记账与防递归 | S6 |
| `webui/server/__tests__/question-budget-turn-supersede.test.ts` | 身份隔离、同会话串行、握手回绑重检 | S7 |
| `webui/server/__tests__/question-budget-incident-regression.test.ts` | 事故等价复现（可控时钟，Spec SC-10） | S4 |

### 3.3 计划修改文件

| 文件 | 改动 | 阶段 |
|---|---|---|
| `webui/server/proxy/question-experience.ts` | 作用域键语义、`BudgetState` 扩字段、装载时机、判定式、`continuable` 派生、待兑现状态 | S2、S4、S5 |
| `webui/server/proxy/mcp-proxy.ts` | 结算协调器挂载点、续查工具注册与处理、`begin_question` 取代、旁路入口纳管 | S3、S5、S6、S7 |
| `webui/server/proxy/audit.ts` | `question_budget_state` 扩列与迁移；续查声明 / 生效事件写入 | S2、S5 |
| `webui/server/proxy/acl.ts` | **新增工具分类、known tools 登记、角色授予与升级迁移** | S5 |
| `scripts/lint-spec.mjs` | **新增工具的 `classifiedRoleTools` 硬编码白名单**——未同步会使 `npm run lint:spec` 以「allow.tools contains unclassified tool」失败 | S5 |
| `webui/config/access.yaml` | **治理类文件**（走 Plan Mode）：`defaults.known_tools` 登记与角色 `allow.tools` 授予 | S5 |
| `webui/server/proxy/audit-classification.ts` | 续查事件与并发超限的分类与维度归口 | S5 |
| `webui/server/proxy/turn-correlation.ts` | 增加 `supersede` 与按身份+会话的活跃查询 | S7 |
| `webui/server/admin/audit.ts` | 问询汇总新增「预算终止次数」列并修正恒等式；字段说明文案 | S1 |
| `webui/src/pages/admin/Audit.tsx` | **导出入口参数来源排查与修正**；非零桶展示 | S1 |
| `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` | §7.2 口径与续查通道的**修订声明**（**PM 授权代改，已完成 v0.4**）；**只写修订条款，不改现行已实现语义**——运行时仍以 §7.2 现行文本为准，新口径自新 Spec SC 全部执行并发布后生效 | S9 |
| `webui/config/data-qa-instructions.md` | **治理类文件**，走 Plan Mode，与 S5 同批 | S8 |
| `webui/docs/00-product-terminology-standard.md` | **治理类文件**，修订「问询预算」「关联调用数」「可继续」三条既有词条 | S8 |
| `docs/specs/lucy-20261029-question-budget-window-optimization-spec.md` | D1–D9 裁定回写 | S0 |
| `docs/plans/README.md` | 索引行 | S9 |
| `docs/README.md` | **文档地图登记**：§2 设计区加 Spec 行、§3 复核区加审阅结论行、§9 计划区加 Plan 行 | S9 |
| `docs/governance/project-overview.md` | **仓库关键文档索引登记**（§9 索引表 + 顶部版本更新行；版本号为跨会话共享计数器，写前须实读顶部版本行取 current+1） | S9 |

---

## 4. 分阶段实施

> **阶段顺序原则**（据 R12 重排）：可观测性先行 → 地基（作用域与持久化）→ 结算 → 口径 → 通道 → 旁路 → 归属 → 治理文本。每阶段**独立可验收、独立可回退**（见 §7）。

### S1 预算终止可观测性先行（P1）

**范围**：Spec D4（汇总层部分）。**本阶段不改任何额度语义**，可独立上线、独立回退（回退＝隐藏新增列）。

**关键动作**

1. 问询汇总新增独立可见列「预算终止次数」；**legacy outcome 四桶**扩为「成功 / 拒绝 / 错误 / **预算终止**」，恒等式改为**关联调用数 = 四桶之和**；同步修订字段说明文案（现说明与实际口径矛盾）。
2. 执行结论**仍以八桶主状态为准**（`succeeded` / `failed` / `denied` / `budget_stopped` / `cancelled` / `timeout` / `indeterminate` / `unknown`）；四桶不得被当作执行结论呈现。
3. 预算终止审计行补记续查呈现事实：`continuationPresented` / `continuationMatched` / `continuationCreditLeft` / `canContinueByCapability`（后两项在 S5 才有真实来源，S1 先落列位与占位语义）。
4. **导出发起侧排查（独立立项，不预设结论）**：核实前端导出入口的 `outcome` 参数来源与默认行为；**不得**预设服务端默认值为 `ok`——服务端只做「有参才筛」（`webui/server/admin/audit.ts:225`）。分别验收「无 `outcome` 参数」与「显式 `outcome=ok`」两种情形。

**退出条件**：SC-25、SC-26、SC-27、SC-28、SC-29 通过。

**回滚**：新增列是纯增量；回退＝前端隐藏该列，无需回退数据库。

---

### S2 稳定预算身份与持久化正确性（P0，地基）

**范围**：Spec D5 + D6 的作用域部分 + R06。**本阶段不改额度判定语义**，只换作用域身份与装载纪律。

**关键动作**

1. **作用域键语义变更**：`scopeKey` 由 `turn:<turnId>` 改为 `bq:<identityKey>:<sessionId>`，与 turn 注册表**解耦**。`identityKey` 沿用 `turn-correlation.ts` 的 `userId|tokenHashPrefix` 口径；无会话时为 `-`。
2. `BudgetState` 扩字段：`round`、`turnId`、`windowId`、`busyMs`、`inflight`、`pendingToken`、`presentedToken`、`archivedBusyMsByWindow`。`presentedToken` 在 S5 才写入；S2 只建列，停机响应仍不得回传 `scopeKey`。
3. **装载时机修正**：内存已有该键**不等于**已装载；`loaded` 标志控制持久层装载（R05 纪律）。恢复**全部**累计字段；**在途占用不恢复**（崩溃前在途的进程已死）。
4. **落库纪律统一**：候选态 → 落库 → 发布内存 + 发审计；落库失败保留旧态并**标记作用域不可用**，后续准入一并拒绝。
5. 持久层表扩列与**幂等**迁移，列含 `presented_token` 与旧窗口归档耗时；旧键（`turn:*` / `scope:*`）的行保留只读，**不**迁移计数（避免跨问询额度继承）。

**退出条件**：SC-01、SC-02、SC-03、SC-04、SC-05 通过。其中 **SC-04 必须经真实代理重启后经 MCP 发起调用**，直接调函数的写法视为不通过。

**回滚**：`LUCY_QUESTION_BUDGET_SCOPE=legacy` 回到旧作用域键语义；新键的行保留不删。

---

### S3 统一结算与窗口票据（P0）

**范围**：Spec D1 的结算部分 + R02 + R03 + R04。依赖 S2 的作用域与持久化。

**关键动作**

1. **结算协调器**：在请求生命周期**开始**时创建票据（`scopeKey` / `windowId` / `round` / `requestId` / `startMonoMs` / `settled`）。结算点 = **上游真正结束**或**确认取消完成**；`res.close` 仅作为「客户端断开」信号 → 触发取消上游 → 取消确认后结算；若取消不可行则继续计时。调用方只有收到 `ALLOW` 之后才向上游发起调用。
2. **幂等结算**：结算走 Spec §6.4 的 `commit`，幂等键是 `requestId`，与 `busyMs` 或旧窗口归档同一事务。`ticket.settled` 只在 `commit` 成功后置真。全部失败出口（正常结束、超时、取消、异常）汇入同一结算函数，且与 `consume` 共用作用域锁。`commit` 失败时内存保持旧态，作用域在本进程内不可用，并按同一 `requestId` 重试。
3. **窗口票据**：结算按票据的 `windowId` 归口；窗口已换则**归档**旧窗口耗时，**不污染**新窗口。
4. **并发上限**：准入时 `inflight >= MAX_INFLIGHT` 则以「并发超限」拒绝，**不**消耗 `calls`、**不**累计 `busyMs`、单独记账。
5. **绝对执行时限**：数据调用超过 `ABS_EXEC_MS` 主动取消上游并按实际已耗时结算，审计标记超时。
6. 结算进入**作用域串行队列**，与消费同锁（R05）。

**退出条件**：SC-11、SC-12、SC-13、SC-14 通过。

**回滚**：结算协调器为新增层，可整体退回现状的 `res.once("close")` 释放路径（但会带回 R02 的少计/漏计——回滚窗口应尽量短）。

---

### S4 墙钟口径改写（P0）

**范围**：Spec D1。依赖 S3 的结算口径 `busyMs`。

**关键动作**

1. 判定式改为：`calls >= MAX_CALLS` 或 `busyMs >= MAX_BUSY_MS`（**已结算**口径）。
2. **问询年龄彻底退出额度判定**：`originStartedAt` / `wallClockMs` 只保留作「慢问询」观测（Spec §5）。
3. 开关 `LUCY_QUESTION_BUDGET_WALL_MODE=settled|elapsed`，默认 `settled`；`elapsed` 分支保留现状流逝时间判定，仅切换**时间判定**，其余修复（装载、结算、续查、归属、旁路）**不随其回退**。
4. 事故等价复现用例：用**可控时钟**复刻同一 turn 的 catalog → 318 秒空闲 → 首次读，**同一用例内对照** `settled` 放行 / `elapsed` 拒绝。

**退出条件**：SC-06、SC-07、SC-08、SC-09、SC-10、SC-37 通过。

**回滚**：`LUCY_QUESTION_BUDGET_WALL_MODE=elapsed`（**注意**：回到现状语义即回到事故口径，仅作应急窗口，不可作为长期形态）。

---

### S5 续查兑现通道与 `continuable` 真实性（P0）

**范围**：Spec D2 + D3。**与 S8 同批启用**（指导不得先于新工具生效）。依赖 S2（持久化）与 S4（`busyMs` 归零语义）。

**关键动作**

1. **待兑现状态**：预算状态行使用 `pendingToken` 与 `presentedToken`，实现「声明 → 消费」两段式。`consume`、声明与结算进入**同一把作用域锁**，写路径一律是 Spec §6.4 的 `commit`：
   - 声明（工具路径）：在锁内校验（幂等 / 已有 pending / 无额度 / 未用尽 / 与 `presentedToken` 不一致），`commit` 成功后才发审计；
   - 消费（数据工具路径）：`consume` 内检查 `pendingToken` 或匹配的头部凭证，与本次放行**同一次 `commit`** 完成「归零 + 换窗 + 消费」；只有收到 `ALLOW` 之后才向上游发起调用。
2. **头部路径保留**为次要路径。停机凭证是 `presentedToken`：有 turn 时等于既有 `turnId`，否则为不透明随机值，**禁止**回传 `scopeKey` 或 `identityKey`。两条路径汇入同一次 `consume`，`continuations < 1` 为**唯一**闸门 ⇒ 并发双路径不会把额度加两次。已落库的 `pendingToken` 优先于头部。
3. **`continuable` 重定义为「可执行能力」**：代理按**当前调用者的可见工具集合**计算——`lucy_continue_question` 对其可见且已授权才为 `true`。
4. **ACL 落点（v0.3 新增）**：新工具须分类入既有工具集合（`webui/server/proxy/acl.ts:99-136`）、登记 known tools、纳入**角色授予**并提供**升级迁移**；**不得**只登记不授权。覆盖仅 Wiki 角色、无 `begin_question`、受限角色。
5. 新工具**不计入数据额度、不累计 `busyMs`**；其审计分类与使用量归口明确（不得误改协议方法分类来豁免预算）。

**退出条件**：SC-15～SC-24 通过。

**回滚**：撤下 `lucy_continue_question` 的工具可见性（保留 HTTP 头路径）；`pendingToken` 状态列保留不影响既有路径。

---

### S6 旁路入口纳管（P1）

**范围**：Spec D9 + R10。依赖 S2–S4。

**关键动作**

1. `lucy_certified_route` / `lucy_report_template` 纳入统一 `consume`：**一次外部调用记 1 次额度**。
2. 内部源查询以**内部执行上下文**标记，**不再进入** `consume`（防递归），其处理时长计入 `busyMs` 但**不重复记次数**。
3. 纳管开关 `LUCY_QUESTION_BUDGET_BYPASS=on|off`，默认 `on`；`off` 时回到现状（不消耗预算）。

**退出条件**：SC-35、SC-36 通过。

**回滚**：`LUCY_QUESTION_BUDGET_BYPASS=off`。

---

### S7 同会话重开问询的显式取代（P2）

**范围**：Spec D6 + R07 + R08。依赖 S2（作用域含 `round` / `turnId`）。

**关键动作**

1. `begin_question` 在**同身份+会话**的作用域内建新轮次：`round += 1`、计数归零、`windowId` 递增、`turnId` 切换；旧轮次计数**归档**保留可见。
2. **身份隔离**：作用域键含 `identityKey`；两个身份即使提交**相同或空**的 session 也分属不同作用域，互不可取代；无会话桶按身份隔离。
3. **并发串行**：同一身份+会话的 `begin_question` 全流程（建轮次 → 取代 → 登记 → 握手回绑）进入**同一把会话队列**。
4. **握手回绑事务内重检**：在事务内重新检查「仍未归属」后再更新，且**只为实际更新的行**记录前像。
5. **不回改历史行**：取代只切换后续调用的归属与预算。

**退出条件**：SC-31～SC-34 通过。

**回滚**：撤回 `supersede`，恢复冲突记录行为（但回到「重开问询即打断归属」的既有问题）。

---

### S8 指导文本与术语标准同步（P0，与 S5 同批）

**范围**：Spec D8 + R14。**治理类文件，走 Plan Mode**。

**关键动作**

1. `webui/config/data-qa-instructions.md` 同步新口径：「20 次数据工具调用，或累计 120 秒数据处理时长（**不含思考时间**）」；写明遇 `question_budget_exhausted` 时按 `continuable` 分支处置（`true` → 调 `lucy_continue_question`；`false` → 直接交付部分结果并说明缺口，**不要重试**）；删去已失效的「不要在 catalog 之后长时间不查数」类表述。
2. 指导文本**不得宽于**代理预算，也不得把 `true` 一律导向**该调用者不可见**的工具。
3. `webui/docs/00-product-terminology-standard.md` **修订三条既有词条**（不新增）：「问询预算」口径定义；「关联调用数」恒等式；「可继续」改为可达的继续通道。验收为 SC-41。
4. 修正 Spec 内部章节引用（SC-40 指向 §4 D8 与 Plan S8；v0.1 的失效引用随 SC 全表重写一并消解）。

**退出条件**：SC-40、SC-41 通过；与 S5 同一发布单元。

**回滚**：与 S5 一并回滚（指导先于工具是禁止状态）。

---

### S9 文档、证据与状态回写（P2）

**范围**：Spec 162 修订协同、索引与状态。

**关键动作**

1. **Spec 162 修订（PM 已授权代改，已完成）**：`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` 升 **v0.4**，落三处修订声明——① 顶部 callout 块（仿既有「Spec 189 修订」块形态）写明修订来源、**未实现**事实与生效条件；② §7.2 追加「修订后口径（尚未实现）」小节（三处变更 + 生效条件 + SC-4 同期改写要求）；③ §10 追加 SC-4 口径说明。**不写现行已实现语义**——该 Spec 状态为「已实现（lucy-v2.0）」，改写其运行时语义会与代码不符；修订声明与生效条件是唯一诚实的写法。
   **权威登记册登记（待编号）**：本条目功能编号**待 PM 指派**（建议 L25-17）。按 `docs/governance/DEVELOPMENT.md`「新增 Spec / Plan 的落盘清单」第 9 条，编号指派后须在权威登记册 `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` 登记；**编号未定前不登记**（登记册条目均已指派编号，无「待指派」位）。
   **登记的下游联动项（不在本次改）**：`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §登记行硬编码了「问询预算引擎（Spec 162，20 次数据工具或 120 秒，先到先停）」——**在新口径生效前该描述仍为真**，故不改；新口径生效时须同步。
2. **三处登记册同步**（本次自查发现，原 v0.3 漏登记）：`docs/plans/README.md` 增 Plan 行；`docs/README.md` §2 增 Spec 行、§3 增审阅结论行、§9 增 Plan 行；`docs/governance/project-overview.md` §9 索引表增条目并按「跨会话共享计数器」纪律写顶部版本更新行。
   **归属边界**：本条目为新编号（L25-17 建议），不属 L25-16 维护会话独占登记范围（`project-overview.md` v1.39 行约定），可独立登记。
3. 同步 `docs/specs/…-spec.md` §4 决策表与本 Plan §1 决策摘要。

**退出条件**：Spec 162 v0.4 修订声明已落地；四处登记册（`docs/README.md` §2／§3／§9、`docs/plans/README.md`、`docs/governance/project-overview.md`）就位；两边口径一致且**未实现事实**表述一致。

---

## 5. 验收追踪

| 阶段 | 验收项 | 依赖 |
|---|---|---|
| S1 | SC-25、SC-26、SC-27、SC-28、SC-29 | D4 |
| S2 | SC-01、SC-02、SC-03、SC-04、SC-05、SC-38、SC-39 | D5、D6（作用域部分）、D7 |
| S3 | SC-11、SC-12、SC-13、SC-14 | D1（结算因子） |
| S4 | SC-06、SC-07、SC-08、SC-09、SC-10、SC-37 | D1、D7 |
| S5 | SC-15、SC-16、SC-17、SC-18、SC-19、SC-20、SC-21、SC-22、SC-23、SC-24、SC-30 | D2、D3、D5 |
| S6 | SC-35、SC-36 | D9 |
| S7 | SC-31、SC-32、SC-33、SC-34 | D6 |
| S8 | SC-40、SC-41 | D8 |
| S9 | 文档一致性（无编号验收项） | — |

**当前状态：SC-01–SC-41 全部未执行。**

---

## 6. 完成定义与非目标复核

### 6.1 实现完成

- S1–S8 的代码改动就位，对应单元与集成测试通过；
- `settled` / `elapsed`、stable / legacy 两组开关均有回归覆盖；
- 治理文件与 Spec 162 的修订按各自流程完成；
- **不构成** SC 验收通过。

### 6.2 功能验收

SC-01–SC-41 逐条留证（用例、输入、实际输出），并由独立审阅方核对。**未留证的项视为未通过。**

### 6.3 不变边界复核

以下在本次改造中**不得**发生：

- 预算终止被改写为权限拒绝或错误；
- `question_budget_exhausted` / `question_budget_unavailable` 两个原因码语义变更；
- 次数上限 20 被静默调整；
- 历史审计行被回改；
- D-24 并发封顶被放宽；
- 新增工具带来新的授权面；
- 认证路由 / 报表模板在纳管后出现**嵌套双扣**；
- KTX 源码被修改。

---

## 7. 回滚矩阵

| 行为 | 开关 / 手段 | 回退后语义 | 备注 |
|---|---|---|---|
| 时间判定 | `LUCY_QUESTION_BUDGET_WALL_MODE=elapsed` | 回到现状流逝时间判定 | **仅切时间判定**，其余修复不随之回退；回到事故口径，仅作应急 |
| 作用域键 | `LUCY_QUESTION_BUDGET_SCOPE=legacy` | 回到 `turn:` / `scope:` 旧键 | 仅用于新旧口径对照 |
| 旁路纳管 | `LUCY_QUESTION_BUDGET_BYPASS=off` | 认证路由 / 报表模板不消耗预算 | 回到现状 |
| 预算整体 | `LUCY_QUESTION_BUDGET=off` | 预算整体关闭 | 既有行为不变 |
| 续查通道 | 撤下 `lucy_continue_question` 的工具可见性 | 仅剩 HTTP 头路径 | 指导文本须同批回退 |
| 结算协调器 | 退回 `res.once("close")` 释放路径 | 带回 R02 的少计/漏计 | 回滚窗口应尽量短 |
| 可观测性 | 隐藏新增列 | 汇总回到三桶 | 纯增量，无数据回退成本 |
| 归属取代 | 撤回 `supersede` | 回到「重开问询即打断归属」 | 与 S7 同批 |
| 持久化纪律 | 撤回装载时机改动 | 回到「内存已有即跳过装载」 | 与 S2 同批 |

---

## 8. 本次文档交付的实际范围

本次交付：Spec v0.3、Plan v0.6，作为作者定稿基线。第 1 轮 Codex 审阅结论仍是退回修订；v0.3 / v0.6 收口的是作者侧口径冲突，**不是**第 2 轮通过，也**不是**开工授权。

**本轮已做（v0.6）**：Spec 升 v0.3、Plan 升 v0.6，收口软上限表述、`commit` 落库顺序、停机凭证不得回传作用域键，以及「可继续」进入 SC-41 / S8。Spec 162 的修订声明仍只指向尚未实现的新口径，版本指针改为 v0.3。

**此前已做（v0.4）**：按 PM 授权代改 `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` 的**修订声明**（v0.4）；同步四处登记册；补 `scripts/lint-spec.mjs`、`webui/config/access.yaml` 两个实施落点；修正术语标准第三条词条、引用行号与部署拓扑措辞。

**未做**：未修改任何生产代码、未执行任何测试、未改动 `webui/config/data-qa-instructions.md` 与术语标准**本体**（其修订在 S8）、未提交 git、未构建镜像、未部署。

---

## 9. 落盘清单勾销

> 依据 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」逐条勾销。
> **「不适用」均写明理由，不适用 ≠ 遗漏。** 机器门禁全绿**不等于**合规，本表是形态自查的证据。

| # | 要求 | 本次落点 | 状态 |
|---|---|---|---|
| 1 | Spec 落 `docs/specs/`、Plan 落 `docs/plans/`，命名 `lucy-YYYYMMDD-<slug>-spec.md` / `YYYY-MM-DD-lucy-<slug>-plan.md` | `docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`；`docs/plans/2026-10-29-lucy-question-budget-window-optimization-plan.md` | ✅ 符合 |
| 2 | Spec 含「核心流程（伪代码）」/「Core Algorithm」，或显式豁免 | Spec §6「核心流程（伪代码）」（§6.1–§6.7） | ✅ 符合 |
| 3 | Spec 头部含「文档类型 / 版本」与「状态」；Plan 头部含「状态」「授权边界」「验收」 | Spec 元数据表；Plan 元数据表 | ✅ 符合 |
| 4 | Plan 含 目标 / 开工前置 / 验收 / 完成定义 / 风险 五类小节 | 目标=§1；开工前置=§2；验收=§5；完成定义=§6；风险=§7（回滚矩阵，含风险与回滚） | ✅ 符合 |
| 5 | 含 `Terminology Compliance` 小节 ⇒ 必须含 `This feature follows …` 与 `New terms:` | Spec §11 | ✅ 符合 |
| 6 | 含 `Design System Compliance` 小节 ⇒ 必须用规定模板四段式 | **本次无 WebUI 视觉/组件变更**，Spec 与 Plan 均**不含**该小节 ⇒ 规则不触发 | ⚪ **不适用**（非遗漏：未新增 UI 文案、无组件改动，故无 Design System 合规项） |
| 7 | Spec / Plan 必须登记进对应索引 | `docs/README.md` §2（Spec 行）、§3（审阅结论行）、§9（Plan 行）；`docs/plans/README.md`（Plan 行） | ✅ 符合 |
| 8 | 新增命令 / CI job 必须在测试门禁文档登记 | **本次未新增任何命令或 CI job** ⇒ 不适用（并发会话同期新增的 `lint:spec-docs` 属另一条目，不在本条目范围） | ⚪ **不适用**（非遗漏：本条目只交付文档，零代码、零脚本、零 workflow 改动） |
| 9 | 功能编号待 PM 指派，由权威登记册登记 | 编号**待 PM 指派**（建议 L25-17）；**尚未**登记权威登记册 `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` | ⏳ **待 PM 指派**（登记册条目均已指派编号，无「待指派」位；指派后由 S9 登记） |
| 10 | 落盘后跑一遍机器门禁并逐条勾销本表；不得以「门禁全绿」替代形态自查 | v0.5 时 `lint:spec-docs`／`lint:spec`／`lint:terminology`／`lint:ia-boundary` 均为 PASS。v0.6 复跑 `lint:spec-docs`：本 Spec 与本 Plan **不在**违规列表。当时全量失败来自另一条目的 `docs/specs/lucy-ci-restoration-spec.md` 与 `docs/plans/2026-10-29-ci-restoration-plan.md`，不在本条目范围。**本表即为逐条勾销** | ✅ 符合 |

**门禁覆盖范围说明**：`lint:spec-docs` 覆盖 index / ds-shape / term-shape / pseudocode / plan-parts / metadata 六类**机器可判定**形态项；它**不覆盖**决策表完整性、证据等级标注、状态陈述真实性与文档间口径一致性——后者由本表的人工勾销与 Codex 审阅承担。
