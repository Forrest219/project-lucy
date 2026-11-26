# 大目录访问配置写窗口韧性 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 大目录访问配置写窗口韧性 Spec |
| 文档类型 / 版本 | Spec（角色/Agent 写路径与展示读韧性）／**v1.0** |
| 日期 / 目标版本 | 2026-11-26／产品线 `0.35.0` 候选（待委托人挑入 [`v0.35.0-scope.md`](../releases/v0.35.0-scope.md) 拉取清单） |
| 功能编号 / 优先级 | **REQ-0117**／**P1**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0117` |
| 阶段 | S4 |
| 状态 | S4｜v1.0。终稿已确权（委托人 2026-11-26）；开发授权已获得（委托人 2026-11-26，含 acl.ts／permission-display.ts／agents.ts 有限扩权）；**实现已落地，UAT 跑次中断于前台浏览器阶段（AWW-08），待验收**；测试台 [`UAT-SUITE-ACCESS-WRITE-WINDOW`](../qa/uat/suites/access-write-window/suite.md)；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 2026-11-26 用户口头反馈并已于本机 compose demo 复现：2000+ 启用表目录下经 WebUI 表单创建关联 2000+ 表的角色时页面出现 503。取证与根因见 [REQ-0117 正文](../backlog/entries/REQ-0117-create-2000-table-roles-webui-503.md) 与错题本 [2026-11-26-large-catalog-role-write-blocks-display-reads](../lessons/2026-11-26-large-catalog-role-write-blocks-display-reads.md) |
| 实施主体 | `webui/server/publish-coordinator.ts`、`webui/server/display-snapshot.ts`、`webui/server/admin/access-roles-agent-concurrent-edit.ts`、`webui/server/admin/roles.ts`、`webui/src/lib/displayQueryOptions.ts`（读恢复预算与重试策略）、`webui/src/lib/apiClient.ts`（写挂起/跨写守卫）；不改 KTX 源码；不改运行导航 IA |
| 配对计划 | [`docs/plans/lucy-20261126-access-write-window-resilience-plan.md`](../plans/lucy-20261126-access-write-window-resilience-plan.md) |
| 测试台 | `not_registered`（计划随本套件新建 `UAT-SUITE-ACCESS-WRITE-WINDOW`） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-26 初稿落盘。基于 REQ-0117 复现取证，定义发布窗口有界等待、写窗内展示读回退与写窗时长基线三条合同方向；OQ-1～OQ-3 留待终稿确权裁定。 |
| v0.2-draft | 2026-11-26 依委托人反对意见修订：OQ-1 默认改为 B（先压短写窗＋对齐读恢复预算，stale 回退降级为受控备选）；伪代码回归「协调器抛错、路由层映射 503」分层并补并发等待上限；SC-02 限定无版本冲突写、同对象冲突 409 语义单列；交互合同扩至 `/admin/roles`、`/admin/roles/:roleId`、`/admin/agents` 并区分前端防重与后端等待；SC-04 与浏览器体验验收解耦。 |
| v0.3-draft | 2026-11-26 依交叉审阅 R-1～R-8 修订：补「与既有 Spec 的关系」并限定方向 2 仅作用于 `role_policy_save`/`agent_save`（不改其余 7 类语义写入口与 `acquirePublishCoordinatorLock` 直调方）；将 `displayQueryOptions.ts` 的单次补试与 15s 旅程顶约束摆入 OQ-1（B1/B2/B3/A 四选一）；明确 `maxWaiters` 对读侧 `(1 + maxWaiters)×` 写窗的放大并纳入 OQ-2/SC-05；明文禁止通过收窄 `policy ack` 写屏障覆盖面换取 `OQ-3` 指标；Task 0 增补 `pending` 子窗口时长与端到端超时链核实；重写不可证伪的 `SC-05`；修正 `displayQueryOptions.ts` 归属。 |
| v1.0 | 2026-11-26 **定稿**。按二轮对抗审阅 N-1～N-6 修订：修正 `DISPLAY_RECOVERY_WAIT_BUDGET_MS` 归属笔误（服务端单请求预算，非前端）；方向 2 伪代码对齐 `acquirePublishCoordinatorLock` 真实语义（失败返回候选 holder，当前持有者须重读；删除会裸入临界区的 stale 裸 `break`）；`SC-05` 改分支条件式并与 OQ-1 阈值同源；补 `role_policy_save` 同型覆盖删除/行权限保存说明；新增「OQ 裁定记录」。**终稿已确权（委托人 2026-11-26 明示「授权你修复，并定稿」）**：OQ-1＝程序性裁定（B1 优先、B2 备选、B3/A 受控回补）、OQ-2＝`maxWaiters=1`／等待上限 10–15s／`Retry-After` 5s、OQ-3＝起步 P50 ≤8s／`pending` ≤3s 待 Task 1 冻结。未获开发授权。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在 2000+ 启用表的大目录规模下，治理方经 WebUI（或同型 API）创建/编辑角色或 Agent 时，保存主路径在有界时间内可成交，或得到携带重试指引的诚实拒绝（含既有 409 并发冲突语义）；保存进行期间及之后的角色/Agent 页面读取不出现无重试指引的错误终态；提交完成后读己之写成立。单实例部署边界不变。
- 本条出口：`SC-01`–`SC-10`（大目录夹具与基线复现、无冲突重叠写成交、超限/超队诚实拒绝、同对象冲突 409 语义、读路径恢复与压测契约、读己之写、主路径成交、写窗基线门禁、纯 MCP 不回归、前台浏览器验证）。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级；多副本/跨进程一致性（[DEVELOPMENT](../governance/DEVELOPMENT.md)「部署拓扑与并发一致性边界」）。
- 上线关系：本条收口不表示可上线。

## 与既有 Spec 的关系

- [`lucy-20261020-v2p5-semantic-batch-operations-spec.md`](lucy-20261020-v2p5-semantic-batch-operations-spec.md) §7.1/§7.2（D4）与 [`lucy-20261022-v2p5-row-permission-management-spec.md`](lucy-20261022-v2p5-row-permission-management-spec.md) §5.3（D6）：**精确限定修订范围**——仅针对 `kind ∈ {"role_policy_save", "agent_save"}` 在 `withPublishCoordinator` 内将「忙即拒绝」修订为有界等待（含并发等待上限 `maxWaiters`）；其余 7 类语义写入口（`semantic_table_save`、`semantic_table_append`、`semantic_overlay_delete`、`manifest_upload`、`batch_import`、`manual_reindex`、`semantic_restore`）及直接调用 `acquirePublishCoordinatorLock` 的 batch publish 路径**不修订**，维持原「忙即拒绝」合同。
- Spec 174 §3.2/§6 & [`lucy-20261030-display-snapshot-invalidation-isolation-spec.md`](lucy-20261030-display-snapshot-invalidation-isolation-spec.md)（原 Spec 195）§5/§6：**默认不修订**。写屏障覆盖至 `policy ack` 的原子性边界（不发布中间 `access` 版本）**明文禁止收窄**；`OQ-1` 若在终稿确权时裁定为 **B3**（服务端对 `write_pending` 增加有界等待）或 **A**（受控 `committedView` 回退），须在本节显式登记对 Spec 174 §6 / Spec 195 §6 请求预算合同的修订条款后方可进入实现。
- `P1-75` / `REQ-030-096`（[`lucy-20261123-interactive-read-resilience-spec.md`](lucy-20261123-interactive-read-resilience-spec.md)）：**互补不冲突**——P1-75 治理 A 类展示读不 503 与名册/握手长尾；本条治理 `access` 大目录写窗时长、B 类 `write_pending` 恢复可达性与 `PUBLISH_COORDINATOR_BUSY` 重叠写拒绝。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（复用「角色」「Agent」「保存」「重试」「对象已被修改」等既有用户可见术语；「发布窗口」「写屏障」「committed 视图」仅用于实现与 Spec 内部，不出现在用户可见文案）。

## 交互合同

- 路由：/admin/roles、/admin/roles/:roleId、/admin/agents
- 基准页：/admin/agents
- 一件事：治理方在角色/Agent 列表与编辑页创建、编辑并保存，在大目录写窗口内保存仍能成交或得到可重试提示，页面读取不出现无重试指引的错误终态。
- 状态：首访：不适用：本条不改首访、页头结构与主任务入口；空：不适用：本条不改列表空态；加载：大目录写窗口内读取角色/Agent 列表或详情时呈现加载或滞后提示，不出现错误终态，主任务入口保持可用；错误：等待超限或超出并发等待上限的拒绝呈现可重试提示（含重试指引），同对象版本冲突呈现既有「对象已被修改」提示，入口保留，不静默吞错；0 条：不适用：本条不改 0 条态；成功：保存提交完成后列表/详情呈现新状态，加载/滞后提示消失，无错误残留；部分：单用户重复点击由保存按钮提交态直接拦截防重，多标签/多管理员的重叠提交经有界等待后成交或得到可重试提示，不静默丢失保存操作
- 主动作：列表页「创建角色」与编辑页「保存」各自保持所在 action group 唯一 primary；保存进行中由前端提交态防重不做并发二次写，后端只对多标签/多管理员重叠做有界等待。
- 决定信息：用户凭保存进行中的进度/滞后提示与（超限时的）重试指引、（冲突时的）「对象已被修改」提示决定等待、重试或先刷新再改。
- 术语：「角色」「Agent」「保存」「重试」已登记；本条不新增用户可见术语。
- 台账：无新台账
- 状态维度：加载/滞后呈现、错误终态与冲突提示互斥且文案可区分，同一状态维度不得互相否定。

## 元素清单

- E1｜/admin/roles｜加载｜角色列表数据区｜大目录写窗口内读取返回加载或滞后呈现，不出现错误终态，创建入口保持可用
- E2｜/admin/roles｜错误｜角色列表数据区｜等待超限或超队的拒绝呈现可重试提示与重试指引，创建入口保留，不静默吞错
- E3｜/admin/roles｜成功｜角色列表数据区｜保存提交完成后列表出现新角色，加载/滞后提示消失，无错误残留
- E4｜/admin/roles｜部分｜保存动作区｜多标签/多管理员重叠提交经有界等待后成交或得到可重试提示，不静默丢失保存操作
- E5｜/admin/roles｜主动作｜页头动作区｜「创建角色」为唯一 primary；保存进行中由前端提交态防重不做并发二次写
- E6｜/admin/roles｜决定信息｜保存进度/提示区｜展示保存进行中、（超限时的）重试指引与（冲突时的）对象已被修改提示，用户可据此决定等待、重试或先刷新
- E7｜/admin/roles/:roleId｜加载｜角色详情数据区｜大目录写窗口内读取详情返回加载或滞后呈现，不出现错误终态
- E8｜/admin/roles/:roleId｜错误｜角色详情保存提示区｜等待超限或超队的拒绝呈现可重试提示；版本冲突呈现既有「对象已被修改」提示，编辑内容不丢失
- E9｜/admin/roles/:roleId｜成功｜角色详情数据区｜保存提交完成后详情与列表呈现新状态，无错误残留
- E10｜/admin/roles/:roleId｜部分｜保存按钮区｜保存进行中按钮进入提交态拦截重复点击；多管理员重叠经有界等待后成交或得到可重试提示
- E11｜/admin/roles/:roleId｜主动作｜页头动作区｜「保存」为该 action group 唯一 primary；保存进行中不做并发二次写
- E12｜/admin/roles/:roleId｜决定信息｜保存进度/提示区｜展示保存进行中、（超限时的）重试指引与（冲突时的）对象已被修改提示，用户可据此决定等待、重试或先刷新再改
- E13｜/admin/agents｜加载｜Agent 列表数据区｜大目录写窗口内读取返回加载或滞后呈现，不出现错误终态，入口保持可用
- E14｜/admin/agents｜错误｜Agent 列表数据区｜等待超限或超队的拒绝呈现可重试提示与重试指引，不静默吞错
- E15｜/admin/agents｜成功｜Agent 列表数据区｜同锁域保存提交完成后列表呈现新状态，无错误残留
- E16｜/admin/agents｜部分｜保存动作区｜多标签/多管理员重叠提交经有界等待后成交或得到可重试提示，不静默丢失保存操作
- E17｜/admin/agents｜主动作｜页头动作区｜「创建 Agent」为唯一 primary；保存进行中由前端提交态防重不做并发二次写
- E18｜/admin/agents｜决定信息｜保存进度/提示区｜展示保存进行中与（超限/冲突时的）可操作提示，用户可据此决定等待、重试或先刷新

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | **问数面**：大目录下治理写期间事件循环尖峰（实测 ~0.8s）可能拖慢 MCP 问询；**报告面**：未触碰 | **问数面**：MCP 数据面合同不变；写窗时长压短后问询更稳；**报告面**：未触碰 | P1·问数面 ＝／P1·报告面 ＝ | `SC-09`（纯 MCP 不回归）、`SC-08`（事件循环与写窗时长基线） | — |
| P2 治理方 | **语义口径面**：大目录下保存角色 5–12s，期间角色页读取 503、重复提交立即 503，保存看起来像失败；**权限授权面**：授权语义不变 | **语义口径面**：保存有界时间内成交或得到可重试指引，同对象冲突仍走既有 409 语义，页面无无指引错误终态；**权限授权面**：未触碰 | P2·语义口径面 ↑／P2·权限授权面 ＝ | `SC-02`、`SC-03`、`SC-04`、`SC-05`、`SC-07` | 超限/超队拒绝携带 `Retry-After` 与持有者信息（`SC-03`），不假成功 |
| P3 运维方 | **交付运维面**：无新增部署依赖；**运行观察面**：`displayBusy` 忙碌事件集中在写窗，缺写窗时长基线 | **交付运维面**：无新增部署依赖；**运行观察面**：忙碌事件可解释（等待/拒绝语义明确且有并发上限），写窗时长有基线与不回退门槛 | P3·交付运维面 ＝／P3·运行观察面 ↑ | `SC-01`、`SC-03`、`SC-08` | — |
| P4 管理层 | 大客户目录（数千表）下治理操作可用性存疑 | 治理操作在规模放大下仍可用，可用性有可核对门禁 | P4·业务结果面 ＝／P4·口径质量面 ＝ | `SC-07`、`SC-08` | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。本条只把「忙即拒绝」改为有界等待并治理写窗时长，不新增拒绝语义；MCP 数据面合同不变（`SC-09`） |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。超限/超队拒绝携带 `Retry-After` 与重试指引（`SC-03`），同对象冲突走既有 409 语义（`SC-04`），两者均纳入 UAT |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。`SC-02`/`SC-03`/`SC-04` 验等待、超限与冲突，`SC-06`/`SC-07` 验合法保存成交与读己之写 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。夹具只依赖本机 compose demo 与本地 MySQL 造数（`SC-01`），不依赖外部服务 |

## 1. 需求摘要

1. **现状取证（2026-11-26，demo 栈，2005 张启用表）**：
   - 任一 `access.yaml` 写（即使 1 表角色）耗时 5–12s；写窗内以 0.1s 裸轮询 `GET /api/admin/roles` 出现 1–3 次 `503 DISPLAY_SNAPSHOT_BUSY`（`reason=write_pending`，B 类）；`/api/health` 的 `displayBusy.recent` 记录 `name=role-list`、`eventLoopMaxMs≈804–827ms`。
   - 同窗第二个写请求 0.08s 内被 `503 PUBLISH_COORDINATOR_BUSY` 零等待拒绝。
   - 小目录基线（5 张启用表）下同样创建 3.4s、零 503：写窗时长随**启用表目录规模**放大，而非随角色大小（2000 表角色仅额外 ~1.5s）。
   - **暴露面与客户端常量核实**：真实 SPA 的展示读守卫（`apiClient.ts` displayWriteEpoch/pending）拒绝在写挂起期间发起读取、并拒绝跨越写的响应；`displayQueryOptions.ts` 对 B 类 503 至多自动补试 **1 次**（`failureCount < 1`），`DISPLAY_READ_RETRY_BUDGET_MS=5000` 仅是单次 delay 上限，客户端还有 `DISPLAY_READ_JOURNEY_MS=15s` 的旅程硬顶；服务端 `display-snapshot.ts` 的 `waitForRecovery` 明确将 `write_pending` 排除在等待之外（服务端单请求恢复预算 `DISPLAY_RECOVERY_WAIT_BUDGET_MS=1.5s` 对 `write_pending` 不生效）。现状下若 `pending` 子窗口超过 ~2.5s，用户即达错误终态。
2. **方向 1（先行）：写窗时长治理**。写窗根因是大目录下单次角色写触发过重的全量重载/阻塞。先在大目录夹具上 profile 写路径（catalog 重载、策略运行时重载、展示快照重建各自占比，以及 **`pending` 子窗口实际持续时长**）并核实**端到端超时链**（compose / K8s Ingress / Fastify / 浏览器 `fetch`），再做有据的减负（如按变更作用域缩小重载面、分片让出事件循环）。**硬约束：写屏障覆盖至 `policy ack` 的原子性边界（不发布中间 `access` 版本）不可收窄**，只能压短屏障内的工作，禁止以缩短屏障覆盖面凑指标。并把「写窗时长（单写与重叠写）＋`pending` 子窗口时长＋`displayBusy` 事件数＋事件循环最大阻塞」纳入既有性能基线面（`REQ-030-099`／`REQ-030-034` 方向）。
3. **方向 2：发布窗口有界等待（限定 `kind` 范围＋并发上限）**。仅对 `kind ∈ {"role_policy_save", "agent_save"}` 在 `withPublishCoordinator` 内增加有界等待，其余 7 类语义写入口与直接调用 `acquirePublishCoordinatorLock` 的 batch publish 路径**保持现状不排队**。注：`role_policy_save` 同型覆盖角色**删除**与**行权限保存**（同一 `access.yaml` 锁类），有界等待对这些写一并生效；闭口叙事以创建/编辑为主线，删除与行权限保存不新增验收维度（同锁同语义，`SC-02`–`SC-04` 同型适用）。底层原语保持「抛 `PublishCoordinatorBusyError`」语义，等待者在等待上限内取得锁后仍走**既有**版本校验（fresh 读＋`baseObjectVersion`/`previewToken`）；超限或超出进程内最大并发等待数 `maxWaiters` 时抛错并由路由层映射为携带 `Retry-After` 与持有者信息的 503。注意：并发等待会让读侧面临最坏 `(1 + maxWaiters)×` 写窗，需在 `OQ-2` 显式权衡 `maxWaiters=1`（最坏 2× 写窗）与更大队列。
4. **方向 3：写窗内展示读恢复可达性（OQ-1 四选一显式裁定）**。由于 `displayQueryOptions.ts` 的 1 次补试与 15s 旅程顶无法仅靠调 `DISPLAY_READ_RETRY_BUDGET_MS` 横跨 5–12s（及重叠写 `2×`）窗口，不在「对齐」一词下隐含改写预算合同，而是把三条 B 类路径与 A 类备选全部摆到 `OQ-1` 显式裁定（见下表）。
5. **防重分工**：单用户重复点击由前端保存按钮提交态拦截（`webui/src/lib/rolesAgentAccessWrite.ts` 既有保存编排扩展）；后端有界等待只面向多标签/多管理员的真实重叠。
6. **边界**：单实例、单进程并发边界不变；不改 KTX 源码；不改导航 IA；不改权限判定语义（`allow`/行权限编译结果不变）。

## 核心流程（伪代码）

```text
const BOUNDED_WAIT_KINDS = new Set(["role_policy_save", "agent_save"])

// 方向 2：仅对 role/agent 写启用有界等待（其余 7 类与 acquirePublishCoordinatorLock 直调方不变）
// 关键语义：acquirePublishCoordinatorLock 失败时返回的是候选 holder（自身 pid、新时间戳），
// 并非当前锁持有者；凡需当前持有者（503 错误信息、等待对象、waiters 计数键）必须重读锁文件。
async function withPublishCoordinator(kind, fn, { maxWaiters }):
  if isInsidePublishCoordinator(): return coordinatorHeld.run(true, fn)

  { acquired, holder } = await acquirePublishCoordinatorLock(projectRoot, kind)  // holder 仅在 acquired=true 时有效；陈旧锁接管只发生在 acquire 内部，语义不变
  if !acquired:
    if !BOUNDED_WAIT_KINDS.has(kind):
      throw new PublishCoordinatorBusyError(readPublishCoordinatorLock(projectRoot), kind)
    if inProcessWaiters() >= maxWaiters:                                   // 进程内等待计数（单实例边界；键为当前锁，不是候选 holder）
      throw new PublishCoordinatorBusyError(readPublishCoordinatorLock(projectRoot), kind, { retryAfterSeconds: RETRY_AFTER_S })
    deadline = now + WAIT_BUDGET_MS                                        // OQ-2 裁定：10–15s，可配置
    trackInProcessWaiter(+1)
    try:
      loop:
        { acquired, holder } = await acquirePublishCoordinatorLock(projectRoot, kind)  // 持有者崩溃由 acquire 内部接管；无 stale 特判、无裸 break
        if acquired: break
        if now >= deadline:
          throw new PublishCoordinatorBusyError(readPublishCoordinatorLock(projectRoot), kind, { retryAfterSeconds: RETRY_AFTER_S })
        await waitForReleaseOrTimeout(readPublishCoordinatorLock(projectRoot), min(POLL_INTERVAL, deadline - now))
    finally:
      trackInProcessWaiter(-1)
  try:
    await assertSemanticWritesOpen(projectRoot)
    return await fn()                                                      // 原写路径不变：fresh 读＋版本校验先于提交
  finally:
    releasePublishCoordinatorLock(projectRoot, holder)

// 路由层统一映射（既有 runRolesAgentPublishWindow 扩展，不新增第二套出口）
map error PublishCoordinatorBusyError → 503 { code: "PUBLISH_COORDINATOR_BUSY", message, retryAfterSeconds }

// 方向 3：写窗内展示读（按 OQ-1 裁定收窄为单一分支）
function serveDisplayReadDuringWrite(scopes, budget):
  if reason == "write_pending":
    if OQ1 == B3:                                                          // 需显式修订 Spec 174 §6 / Spec 195 §6
      await waitForDisplayWritesSettled(scopes, min(WRITE_PENDING_WAIT_MS, remaining))
    if OQ1 == A:                                                           // 受控备选：仅当方向 1 压不达标
      view = committedView(scopes)                                         // 须满足 committedViewServeValid 一致性前提
      if view != nil: return 200 { data: view, freshness: "stale", pendingWrite: true }
    // B1/B2 保持服务端现行合同：budget 耗尽返回 503 DISPLAY_SNAPSHOT_BUSY（带 Retry-After: 1）
    return 503 { code: "DISPLAY_SNAPSHOT_BUSY", busyReason: "write_pending", retryAfterSeconds: 1 }
  // 读己之写守卫：写结算后 stale 视图不得再被返回
  if servedStale and writeSettledSince(scopes, servedVersion): invalidateAndRebuild(scopes)

// 方向 1：写窗时长基线（禁止收窄 policy ack 屏障覆盖面）
function recordWriteWindow(kind, startedAt, scopes):
  emit({ kind, totalDurationMs, pendingSubWindowMs, busyEvents: countBusyEvents(scopes, startedAt), eventLoopMaxMs })
  gate: pendingSubWindowMs <= PENDING_BUDGET_MS and totalDurationMs <= WRITE_WINDOW_BUDGET_MS   // OQ-3 定值
```

## 开放裁定项（OQ）

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| OQ-1 | 写窗内 `write_pending` 恢复可达性（结合 `displayQueryOptions.ts` 1 次补试 / 15s 旅程顶与服务端不等待现状） | **B1**＝保持客户端 15s 顶与 1 次补试，仅靠方向 1 压短 `pending` 子窗口（承认重叠写 2× 窗口下只能减少、不能承诺消除 B 类 503；`SC-05` 已按分支条件化）；**B2**＝保持 B 类 503 语义，放宽 `displayQueryOptions.ts` 对 `write_pending` 的补试次数与旅程顶以横跨实测 `pending` 子窗口（含重叠写）；**B3**＝服务端 `waitForRecovery` 对 `write_pending` 增加有界等待（须修订 Spec 174 §6 / Spec 195 §6）；**A**＝写窗压不达标时回退 `committedView`（200＋滞后标注，须修订 Spec 174/195 且带读己之写守卫） | 先依 Task 0 测出 `pending` 子窗口实测时长：若方向 1 可将单写 `pending` 压至 ≤ 1.5s，优先 **B1**（零合同修订）；否则在 **B2**（仅调客户端重试策略）与 **B3** 间择一；**A** 仅作最后备选 |
| OQ-2 | 发布窗口有界等待参数（注意读侧面临 `(1 + maxWaiters)×` 写窗放大） | `maxWaiters=1`（最坏 2× 写窗） vs `maxWaiters>1`；等待上限与 `Retry-After`（须满足 `等待上限 + 实测写窗 ≤ Task 0 核实的端到端超时分母`） | 建议 **`maxWaiters=1`**、等待上限 **10–15s**、`Retry-After` **5s**，均入配置；若选 `maxWaiters>1`，`OQ-1`/`OQ-3`/`SC-05` 须按 `(1 + maxWaiters)×` 窗口同步重算 |
| OQ-3 | 大目录写窗时长预算目标（**严禁以收窄 `policy ack` 写屏障范围凑指标**） | 按 Task 0 实测总写窗与 `pending` 子窗口分别定值 | 建议「2000 启用表下单个 `access` 写 P50 ≤ 8s、`pending` 子窗口 P50 ≤ 3s（或按 OQ-1 结论收窄）」为起点，实测后冻结 |

#### OQ 裁定记录（2026-11-26，委托人终稿确权）

- **OQ-1＝程序性裁定（采用建议列）**：以 Task 0/1 实测 `pending` 子窗口时长为分母——方向 1 若能将单写 `pending` 子窗口压至 **B1 阈值**（＝前端补试 delay 实测值＋余量，起步 **1.5s**）则定 **B1**（零合同修订）；压不到则定 **B2**（仅放宽 `displayQueryOptions.ts` 补试策略与旅程顶，仍不动服务端 A/B 类语义）；仅当 B1/B2 均不可达时，经在「与既有 Spec 的关系」回补修订登记后启用 **B3** 或 **A**。
- **OQ-2＝`maxWaiters=1`**；等待上限 **10–15s**（可配置，Task 0 超时链核实后定值）；`Retry-After` **5s**；硬约束「等待上限＋实测写窗 ≤ Task 0 核实的端到端超时分母」由 Task 0 输出核对；读侧最坏窗口按 `(1 + maxWaiters)×`＝2× 写窗标定。
- **OQ-3＝起步目标「2000 启用表下单个 `access` 写 P50 ≤ 8s、`pending` 子窗口 P50 ≤ 3s」**，Task 1 达标结论后收窄冻结；冻结值与 OQ-1 所选分支联动（定 B1 时 `pending` 子窗口预算收紧至 B1 阈值）；**禁止以收窄 `policy ack` 写屏障覆盖面凑指标**。

#### OQ 实测回填（2026-11-26，Task 0/1 实测后冻结；证据以测试台跑次 [UAT-SUITE-ACCESS-WRITE-WINDOW](../qa/uat/suites/access-write-window/runs/2026-11-26-claude-aww-partial.md) 与其 fixtures.md 所指测量脚本输出为准）

- **OQ-1 最终分支＝B1**。实测依据：隔离栈（530 Agent：500 规模水位＋30 个绑定 2000 表角色的 Agent、2003 启用表）——修复前单写 `pending` 子窗口冷进程 1.7–6.6s、宽角色场景 ≥15s（写窗 17.9–21.9s、窗内 5 次 B 类 503）；方向 1（按变更作用域增量重编译策略运行时，委托人 2026-11-26 扩权 `webui/server/proxy/acl.ts` 限 `commitEffectivePolicyUnlocked`，写屏障覆盖面未收窄）后单写 `pending` 子窗口实测 **0 事件（<1.5s B1 阈值）**、写窗小角色 P50≈1.5s／2000 表角色 ≈3.5–3.7s。B1 成立：服务端 A/B 类语义零修订，读侧不动 `displayQueryOptions.ts` 补试与旅程顶合同。
- **OQ-2 定值**：等待上限 **15s**（`LUCY_PUBLISH_WAIT_BUDGET_MS` 可配置；Task 0 超时链核实分母＝Fastify/Node `requestTimeout` 300s，15s＋实测写窗 ≤3.7s ≪ 分母，余量充足）；`maxWaiters=1`（`LUCY_PUBLISH_MAX_WAITERS`）；`Retry-After` 5s（`LUCY_PUBLISH_RETRY_AFTER_SECONDS`）。
- **OQ-3 冻结值**：写窗总时长 **P50 ≤ 8s**（实测 1.5–3.7s，裕量大）；`pending` 子窗口预算随 B1 收紧至 **≤1.5s**（实测 0 事件）；不回退检查按此二值入基线面。

## 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 自动化夹具能在一台本机 demo 上构造 ≥2000 张启用表目录，并在修复前复现两个基线症状：写窗内 `role-list` 读 503（`DISPLAY_SNAPSHOT_BUSY`／`write_pending`）与重叠写立即 503（`PUBLISH_COORDINATOR_BUSY`） |
| SC-02 | 仅限 `kind ∈ {"role_policy_save", "agent_save"}`：无版本冲突的重叠写（如两个不同 `roleId` 的创建）在前一持有者等待上限内完成时正常成交（200）；其余 7 类语义写入口与 `acquirePublishCoordinatorLock` 直调方仍保持原「忙即拒绝」合同不回归 |
| SC-03 | 等待超过上限或超出最大并发等待数 `maxWaiters` 时，由路由层统一返回携带 `Retry-After` 与可操作信息的诚实拒绝，不假成功、不静默丢弃；陈旧锁接管语义与现状一致 |
| SC-04 | 同对象/同版本前置的重叠写在等待后取得锁时，触发既有版本冲突语义（`409` `VERSION_CONFLICT`/`OBJECT_TARGET_CHANGED` 族），不静默覆盖；前端映射为既有「对象已被修改」提示且编辑内容不丢失 |
| SC-05 | 读路径恢复与压测契约：经真实客户端恢复路径（`displayQueryOptions` / `apiClient` 旅程或前台浏览器）读取 `/api/admin/roles`、`/api/admin/agents`，按 OQ-1 裁定分支验收——**B1**：单写窗内 0 次无指引错误终态；重叠写 `(1 + maxWaiters)×` 窗口下承认只能减少、不能承诺消除，错误终态占比 ≤ 硬阈值（数值随 Task 1 达标结论回填，禁止无上限）；**B2/B3/A**：单写窗与重叠写窗口均 0 次无指引错误终态（A 另须满足 `SC-06` 滞后标注在写结算后消失）。0.1s 裸轮询仅作压测辅助指标：B1 下报告 `pending` 子窗口超限率并设硬阈值（随 OQ-3 冻结值同源），B2/B3/A 下不设硬指标 |
| SC-06 | 读己之写：创建提交结算完成后，下一次角色列表读取必须包含新角色；客户端既有跨写响应拒绝（write-stale）守卫不回归；若启用 OQ-1=A，stale 回退不得让已提交变更持续不可见，滞后标注在写结算后消失 |
| SC-07 | 主路径成交：大目录下创建关联 2000 表的角色最终 `written=true` 且策略运行时 ack 成功（写屏障覆盖至 `policy ack` 的原子性边界未收窄），页面无错误终态 |
| SC-08 | 写窗时长、子窗口与超时链基线：夹具输出「写窗总时长／`pending` 子窗口时长／`displayBusy` 事件数／事件循环最大阻塞／端到端超时链分母」，并按 OQ-3 门槛设置不回退检查；优化手段以 Task 0 profile 证据为据 |
| SC-09 | 纯 MCP 入口不回归：上述改动不改变 MCP 数据面工具语义、拒绝码与预算行为 |
| SC-10 | 前台浏览器验证：真实浏览器在 `/admin/roles`、`/admin/roles/:roleId`、`/admin/agents` 执行创建/编辑/保存并即时计时，覆盖元素清单 `E1`–`E18`，期间页面不出现无重试指引的错误终态（与 API 耗时分列记录） |
