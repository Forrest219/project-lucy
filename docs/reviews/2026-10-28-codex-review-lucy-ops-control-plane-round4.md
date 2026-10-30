# L25-16 运维控制面 MCP（lucy_ops）Codex 审阅报告 · 第 4 轮

## 结论

**Codex 交付判定：需再修订。** 判定原文要点：C2 已对计划内对象重新授权，并分别核对授权结果集与调用参数集，这一核心修复成立（Spec §6.2 C2）。但语义发布适配器把底层发布调用返回直接转换为成功，尚未衔接异步生效确认；恢复未完成的成员又会被 C7 写成失败审计（Spec §6.4、§6.2 C7）。两级认领已加入，但 operation 审计绑定的崩溃窗口、失败子集重放及整组撤销后的结果一致性仍未闭合（Spec §6.2 C3–C7）。这些缺口影响实现者应写出的控制流，**必须先修订，不能仅靠后续验收消除歧义**。

严重性统计：本轮**新增 8 条**——**阻塞 3**（Q01、Q02、Q03）、**高 4**（Q04–Q07）、**中 1**（Q08）。

硬线判定：

| 硬线 | 第 4 轮判定 |
|---|---|
| (a) commit 对计划内对象重新授权 | **通过**（以 `plan.perTarget` 已完整构造为前提；语义适配缺口另见 Q03） |
| (b) 写入、生效确认先于成功记录 | **未通过** |
| (c) 两级认领先于效果，且初始化、并发与崩溃路径闭合 | **未通过**（正常路径的认领顺序已修正） |
| (d) 组级失败不会出现成员结果相互矛盾 | **未通过** |

## 审阅基线与限制

- **被审文档**：L25-16 [Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md) 与 [Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md) 的**第 4 轮修订稿**（Codex 位置引用以章节号与 C1–C7 步骤号为准）。当前工作区内 Spec 已推进至 `v0.8-fifth-review-fixes`、Plan 至 `v0.5-fourth-review-fixes` 且仍在持续修订，本报告**不把第 4 轮的行号换算到当前版本**。
- **审阅方式**：由本机 Codex（`codex-local`，read-only sandbox，approval-policy=never）对 Spec 与 Plan 做对抗式设计审阅。
- 本轮**未运行**功能测试、浏览器、real-e2e、构建或服务启动，**未连接**数据库与客户环境；不产生运行证据。
- 本轮**仅创建本报告**，未修改 Spec 与 Plan 正文。
- L25-11 仅作为依赖被核对，不在本次审阅范围。
- **核实方式**：MiniMax Code 对 Q01–Q08 逐条回查 `webui/server/` 源码，确认 Codex 的断言与代码事实是否一致。

## 发现的问题

> 每条含：编号、严重性、位置（Codex 原文）、问题、影响、Codex 建议修法、**MiniMax Code 独立核实结论**。

### Q01［阻塞］语义发布适配器把「发布受理」直接当作生效成功

**位置（Codex）**：Spec §6.4 `executeSemanticGroup`。

**问题**：发布调用返回即设置全部成员 `ok:true`，未区分受理、索引中、生效成功。

**影响**：现有服务异步索引失败时，控制面可能已记成功。

**Codex 建议修法**：明确包装层如何跟踪同一 release；仅在确认终态后进入成功终结，索引中保持 pending。

**核实结论：属实。** 源码返回合同已逐字核实：发布在文件落盘后写入的 release 记录为 `status:"reindexing"`、`activationStatus:"unconfirmed"`（`webui/server/semantic-assets.ts:2615-2635`），随后**异步**启动索引且不等待（`:2662-2674`），索引失败时**保留已写文件**并转 `reindex_failed`、activation 仍为 `unconfirmed`（`:2677-2689`）；函数返回的是 `{ accepted: true, release: reindexingRecord }`（`:2796-2799`）。即「调用返回即受理」而非「已生效」，Codex 判断与源码事实完全一致。

### Q02［阻塞］`recovery_required` 被更新为失败审计并调用终结

**位置（Codex）**：Spec §6.2 C7；Plan §4 S3 第 6 项。

**问题**：`recovery_required` 被更新为失败审计并调用终结；Plan 又无条件要求失败转 `failed`。残留效果未消除却产生失败终态；状态值也超出 §4.2 列出的 pending/succeeded/failed 模型。

**影响**：残留效果未消除却产生失败终态，恢复流程失去入口。

**Codex 建议修法**：明确恢复子状态及 operation 汇总规则；未恢复成员保留 pending 审计，阻止可重试失败终结，同步修改 S3。

**核实结论：属实。** 该条的**代码前提**成立：审计层确实允许把任意写入状态改为 `failed`（`webui/server/admin/audit.ts:835-836` 的 `updateConfigChangeStatus` 接受 `writeStatus`），因此「把恢复中成员写成失败终态」在实现上是**做得到的**、而不是被存储层自动阻止的——这正是需要由设计显式禁止的路径。同键去重约束同样存在（`:802-807` `ON CONFLICT(idempotency_key) DO NOTHING`），「保留 pending 审计、不新插失败行」必须写成规则才有约束力。Codex 判断与源码事实一致。

### Q03［阻塞］计划适配器字段映射错误，且完整影响集来源未定义

**位置（Codex）**：Spec §6.2 preview、§6.4；Plan §3.2/§4 S5。

**问题**：计划适配器使用 `actualImpactSet/groups/perTarget`，未定义其来源、转换及通用摘要衔接；语义幂等如何接入通用两级记录也未说明。不能确认完整影响集进入再授权、认领和审计。

**Codex 建议修法**：写明 preview 的适配器分派、真实字段到受管对象的映射、整批单组、摘要校验方式，以及底层 release 幂等记录与通用记录的关联职责。

**核实结论：属实。** 底层计划的真实字段已核实：服务层类型 `SemanticBatchPlan` 只提供 `candidates` / `unrelatedDiskChanges` / `overwriteSet` / `dependencies` / `effectiveTargets` / `planDigest` / `candidateDigest` / `scopeId` / `batchId` / `validationId`，**没有 `groups`、也没有 `perTarget`**（`webui/server/semantic-batch-service.ts:814-829`）；对外响应类型 `SemanticBatchPlanResponse` 同样只有 `candidates` / `unrelatedDiskChanges` / `overwriteSet` / `effectiveTargets` / `dependencies` / `readonlyDependencies`（`webui/server/semantic-assets.ts:2902-2924`）。且 `effectiveTargets` 实为 `candidates ∪ unrelatedDiskChanges`（`:2988-2996`），**仅取 `candidates` 会漏掉候选之外的待生效变更**。Codex 判断与源码事实一致。

### Q04［高］参数全集相等检查先于子集选择

**位置（Codex）**：Spec §6.2 C2/C4；Plan §4 S2 第 17 项。

**问题**：参数全集相等检查先于子集选择。A 组成功、B 组失败后，仅提交完整 B 组仍被 C2 拒绝，VOPS-15/52 不可达。

**影响**：失败子集重放路径不可达，重放合同形同虚设。

**Codex 建议修法**：区分原始请求范围、完整影响集和本次重放子集；保留完整计划再授权，对重放子集校验归属及组完整性。

**核实结论：属实。** 该条为设计内部顺序问题，其**代码前提**已核实：底层对同一幂等键绑定不同 planDigest 会抛 `SEMANTIC_IDEMPOTENCY_CONFLICT`（`webui/server/semantic-assets.ts:2195-2215`），因此「子集重放必须复用原计划、不得另建计划」是硬约束；而 §6.2 C2 的参数集比较若要求等于计划全集，合法子集确实会在到达复用分支前被拒。Codex 判断与源码事实一致（第 5 轮核实该比较已改为子集判定，见第 5 轮报告 Q04 条）。

### Q05［高］operation 认领与审计创建分离，未持久化绑定新生成的 `opAuditId`

**位置（Codex）**：Spec §6.2 C3、审计绑定条款。

**问题**：初始化期间崩溃后无法照现有步骤恢复完整审计链。

**影响**：认领持久化后、审计创建前崩溃，重启无法判定该补建还是复用审计。

**Codex 建议修法**：定义原子绑定，或明确以业务键+attempt 重建、查询并绑定同一审计行的恢复步骤。

**核实结论：属实。** 审计表行为已核实：同键再插会被 `ON CONFLICT(idempotency_key) DO NOTHING` **静默丢弃**（`webui/server/admin/audit.ts:802-807`），而「按 id 更新」的接口是 `updateConfigChangeStatus`（`:835-836`）——即恢复时若不先**查到**该审计行的 id，就无法按 id 收敛到同一行。Codex 指出的「查回既有行」要求因此是必需的，不是可选优化。

### Q06［高］整组撤销完成只改成员状态，保留此前成功结果

**位置（Codex）**：Spec §6.2 C6.3/C7。

**问题**：可持久化 `status=failed`、`result.ok=true` 的矛盾记录。

**影响**：同一目标既「失败」又「成功」，结果契约自相矛盾。

**Codex 建议修法**：为全部本次 claimed 成员生成统一失败结果，保留原始失败及撤销信息作为明细。

**核实结论：属实。** 该条是设计内部一致性问题（成员状态与成员结果分别存储、终态由 `finalizeTarget` 落库），其**代码前提**已核实：终态与审计均可独立写入同一目标的记录（`webui/server/admin/audit.ts:835-836`），不存在任何存储层约束会阻止「状态=failed 且结果 ok=true」的组合被持久化——因此必须由设计显式规定统一失败结果。Codex 判断成立。

### Q07［高］`claimed=[]` 的组仍调用组执行

**位置（Codex）**：Spec §6.2 C6；§6.4。

**问题**：全部 reused/skipped 的组仍进入执行适配器，未从控制流保证「不再执行」。

**影响**：重放路径可能二次产生副作用。

**Codex 建议修法**：在组执行前跳过空 claimed 组，并定义空 targets 的参数行为。

**核实结论：属实。** 该条是设计内部控制流缺失；其**代码前提**已核实：底层发布对同一幂等键会返回既有 release（`webui/server/semantic-assets.ts:2195-2220`），即「重复执行」在底层部分路径上是幂等安全的，但**控制面自身的源表导入与连接表批量写入并没有这层保护**（走 `withKtxYamlWriteLock` 与审计写入路径，见 `webui/server/project.ts:440-451`、`webui/server/index.ts:1817-1818`），因此「不再执行」必须由控制面显式保证。Codex 判断成立。

### Q08［中］VOPS-51 与 S2/S3 退出条件未同步

**位置（Codex）**：Spec §9 VOPS-51；Plan §4/§5。

**问题**：Spec 的 VOPS-51 未同步运行失败撤销断言；Plan 将 VOPS-22 分配给 S3、VOPS-58 分配给 S2，但对应退出条件没有列入。三方追踪仍存在断言和阶段责任漂移。

**影响**：阶段可按自身退出清单通过，却未覆盖关键验收断言。

**Codex 建议修法**：同步 VOPS-51 的运行失败、撤销失败子断言；补齐阶段退出条件或调整阶段归属。

**核实结论：属实（文档级）。** 截至本报告落盘时的核对结果：Spec §9 的 VOPS-51 已补入「组内任一成员**明确失败**时整组撤销并统一为 `ops_group_rolled_back`」「撤销未完成时整组置 `recovery_required`，不写任何成员终态」两条子断言，**该子项已闭合**；但 Plan §5 追踪表中 VOPS-51 → S2、S4，VOPS-57 → S2、S6，VOPS-58 → S2、S3，而 §4 的 S4、S6、S3 阶段退出条件**仍未列入**这三项，**该子项仍未闭合**。Q08 的判断与文档现状一致。

## 处置台账

### 第 3 轮 F01–F09 的逐条闭合核对（Codex 第 4 轮原表）

| 编号 | 第 4 轮严重性 | 第 4 轮闭合结论 | 依据（Codex 原文摘要） | MiniMax Code 核实 |
|---|---|---|---|---|
| F01 | 阻塞 | 部分闭合 | §6.4 声明走通用门禁，但未完成实际计划字段到 `perTarget/groups` 的映射、摘要衔接及发布终态衔接 | 属实（底层无 `groups`/`perTarget`，见 Q03 条） |
| F02 | 阻塞 | 部分闭合 | §6.2 C6 已增加整组撤销；但只改 `state` 未统一失败 `result`，撤销未完成又进入 C7 终结 | 属实（见 Q06、Q02 条） |
| F03 | 阻塞 | 部分闭合 | §6.2 C3/C5 已增加两级认领及新 attempt 初始化；C3 的 operation 认领与审计创建分开，未把 `opAuditId` 写回持久化记录 | 属实（见 Q05 条） |
| F04 | 高 | **已闭合** | §6.2 C3 明确活跃请求返回 `ops_operation_in_flight`，恢复条款明确先取得排他所有权、按持久化组日志整组核验 | 属实（排他所有权的前提已核实：协调器锁只识别持锁进程死活，见 `publish-coordinator.ts:130-140`） |
| F05 | 高 | **未闭合** | §6.2 C4 与重放规则允许完整组的失败子集，但 C2 先要求参数集等于计划全集，合法子集会提前被拒绝 | 属实（见 Q04 条） |
| F06 | 阻塞 | 部分闭合 | §6.2 恢复条款已区分残留效果；但 C7 将 `recovery_required` 的审计更新为 `failed` 并调用终结，与保持恢复状态相冲突 | 属实（见 Q02 条） |
| F07 | 高 | **已闭合** | §6.3 明确内容文件决定分组、全局索引不参与分组、索引按条目隔离撤销 | 属实（索引为全局单文件且创建快照会重写它，见 `table-yaml-history.ts:13-15`、`:330-339`） |
| F08 | 高 | **已闭合** | §6.3 唯一锁调用树明确源表导入外层取锁、内层必须提供已持锁入口，禁止重复取得非重入锁 | 属实（`ktx-yaml-write-lock.ts:1-11` 非重入；`project.ts:445-451` 已有 `lockHeld:true` 路径） |
| F09 | 中 | 部分闭合 | Plan §4 退出条件合计已覆盖 VOPS-01–58；但 Spec §9 VOPS-51 仍只描述「不可执行时整组不写」 | 属实（截至本轮所审修订稿；当前版本已补子断言，见 Q08 条） |

### 四条硬线的独立验证（Codex 第 4 轮原结论）

| 硬线 | 第 4 轮结论与依据 | MiniMax Code 核实 |
|---|---|---|
| (a) 通过 | §6.2 C2 的三步：调用 `reauthorize(toolName, plan.perTarget, actor)`；要求授权结果集等于计划对象集；另要求调用参数对象集等于计划对象集。后两次比较承担不同职责 | 属实（授权与参数比较职责不同，Codex 明确未把参数集比较误认为再授权缺失） |
| (b) 未通过 | 反例：语义发布先写盘、随后索引失败。§6.4 的 `executeSemanticGroup` 在 `publishWholeBatch` 返回后立即给所有成员设置 `ok:true`，通用 C6 随即置 `succeeded`，C7 写 `committed`；既有服务返回 `status:"reindexing"`、`activationStatus:"unconfirmed"`，之后可进入 `reindex_failed` | **属实**：返回合同与异步索引语义已逐字核实（`webui/server/semantic-assets.ts:2615-2635`、`:2662-2694`、`:2796-2799`） |
| (c) 未通过 | 正面：首次调用由 C3 创建 operation attempt 并认领，C5 为执行目标创建审计并认领，之后才进入 C6。反例：operation 认领持久化后、`writeAudit` 前进程崩溃；已有 pending operation 却没有 operation 审计；即使崩溃发生在审计创建后，C3 也没有将 `opAuditId` 绑定回 operation 记录 | 属实（同键再插被丢弃、按 id 更新需先查到行，见 `admin/audit.ts:802-807`、`:835-836`）；另：锁持有者死亡后的锁回收不能代替效果恢复（`publish-coordinator.ts:130-140`） |
| (d) 未通过 | 反例：组内 A 已返回 `{ok:true}`、B 返回失败，随后组撤销完成。C6.3 只将所有成员的 `state` 改为 `failed`，没有改写 A 的成功 `result`；C7 因而会执行 `finalizeTarget(A, "failed", {ok:true,...})`。若撤销中途失败，成员变为 `recovery_required`，但 C7 又更新其失败审计并调用终结 | 属实（终态与审计均可独立落库，无存储层约束阻止矛盾组合，见 `admin/audit.ts:835-836`） |

### Spec / Plan / 验收矩阵三方一致性核对（Codex 第 4 轮原表结论）

| 核对项 | 第 4 轮结论 |
|---|---|
| 工具清单 | 一致 |
| 阶段退出条件对 VOPS 的编号覆盖 | 一致（VOPS-01–58 均在 §5 且至少出现在一个阶段退出条件中） |
| 阶段责任逐项对应 | **不一致**（VOPS-22→S3、VOPS-58→S2 对应退出条件未列入；S6 对 VOPS-57 的责任只有一般执行记录描述） |
| VOPS 断言内容 | **不一致**（VOPS-51 只明确预检不可执行场景；F06 的恢复未完成状态还需与 VOPS-23 的失败表述区分） |
| G1–G19 文件与阶段落点 | 一致 |
| 本轮新增要求的文件职责覆盖 | **不一致**（语义实际影响集的数据转换、底层异步终态衔接及两套记录关联未分配明确职责） |
| 恢复期间相关读写的阻断接线 | **无法核实**（Spec 要求阻断，但 Plan 未列清哪些读取入口检查哪个持久化组状态、重启后何时恢复服务） |
| 锁调用树与占用语义 | 一致（源码依据 `ktx-yaml-write-lock.ts:4`、`project.ts:445`、`publish-coordinator.ts:302`） |
| 键模型与两级认领 | **不一致**（设计目标一致、顺序正确，但 C3 未完成 operation 审计的持久化绑定） |
| 组级语义 | **不一致**（C6/C7 的撤销结果、恢复终结及空执行组仍与 Normative 规则冲突） |
| 幂等恢复与失败子集 | **不一致**（排他所有权与四分支已写明；子集被 C2 提前拒绝，恢复成员又被 C7 终结） |
| D7 冻结口径 | **不一致**（§4.3/§6.3 与 Plan 已扩为「同写集原子组」，而 §8 D7、Plan §2 S0 仍按「同 Schema 原子组」描述待确认事项） |

### 本轮发现 → 修订落点

| 编号 | 落点（Spec／Plan／验收编号） | 后续轮次处置 |
|---|---|---|
| Q01 | Spec §6.4 语义发布适配器（受理／索引中／生效成功分型）；新增 VOPS-59 | 第 5 轮：**引入新问题**——适配器改为 `pending_activation` 后仍返回 `ok:false`，通用编排据此回滚；第 5 轮另立 F5-01（阻塞，锁所有权自冲突） |
| Q02 | Spec §4.2 恢复子状态与 operation 汇总规则、§6.2 C7；新增 VOPS-60 | 第 5 轮：**部分闭合**（五态表与「不写 failed」分支已补，但非终态未持久化、operation 无聚合规则、重入分支不穷尽） |
| Q03 | Spec §6.4 计划适配器字段映射与摘要衔接；新增 VOPS-61 | 第 5 轮：**部分闭合**（字段已改为 `plan.candidates`，但「完整影响集」解释错误、仍读取底层没有的 `groups/perTarget`）；另立 F5-06（高） |
| Q04 | Spec §6.2 C2/C4 参数集子集判定 | 第 5 轮：**已闭合**（改为 `set(ids(args.targets)).issubset(...)`，再授权仍针对 `plan.perTarget` 全集） |
| Q05 | Spec §6.2 C3 operation 审计原子绑定；新增 VOPS-62 | 第 5 轮：**部分闭合**（首次认领已 `bindAuditToOperation`，但 `restartAttempt` 后未绑定新 `auditId`、「审计已插入、绑定前崩溃」查回路径未明确） |
| Q06 | Spec §6.2 C6.3/C7 整组撤销统一失败结果 | 第 5 轮：**已闭合**（全部 claimed 成员覆盖为 `{ok:false, code:"ops_group_rolled_back"}`） |
| Q07 | Spec §6.2 C6 空 claimed 组跳过、§6.4 空集合保护 | 第 5 轮：**已闭合**（`if claimed is empty: continue`，位于预检与 `executeGroup` 之前） |
| Q08 | Spec §9 VOPS-51 子断言；Plan §4 S2/S3/S4/S6 退出条件与 §5 追踪表 | 第 5 轮：**部分闭合**（Spec 侧子断言已补；阶段退出条件遗漏仍在） |

### 仍然缺失但可留到实现期的项（Codex 第 4 轮原文）

- 将畸形 grant、未知角色及缺失字段统一处理为可读的拒绝结果，落实既定 schema 校验与 fail-closed 要求（Spec §3.2.2、§5 G8；Plan §4 S1）。
- 按 VOPS-12 实现计划期限检查，并明确与已成功操作重放的检查顺序，避免计划清理阻断结果复用（Spec §4.3、§6.2 C1/C3、§9 VOPS-12/39）。
- 为原子认领竞争、单对象退化、全部失败、锁持有者死亡及各关键崩溃点补齐直接验证证据；具体测试组织可在实现时确定（Spec §3.2.2、§4.2、§9 VOPS-38/57/58；Plan §4 S6）。

## 关联文档

- 被审 Spec：[L25-16 运维控制面 MCP（lucy_ops）Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)
- 被审 Plan：[L25-16 实施 Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)
- 第 1 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane.md](2026-10-28-codex-review-lucy-ops-control-plane.md)
- 第 2 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round2.md](2026-10-28-codex-review-lucy-ops-control-plane-round2.md)
- 第 3 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round3.md](2026-10-28-codex-review-lucy-ops-control-plane-round3.md)
- 第 5 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round5.md](2026-10-28-codex-review-lucy-ops-control-plane-round5.md)

## 本轮审阅交付的实际范围

本报告是第 4 轮 Codex 审阅结论的落盘件，**未修改 Spec 与 Plan 正文**，未修改任何运行代码、测试、运行配置、客户资产、数据库、镜像或部署，**未执行任何功能验证、浏览器验证、UAT、real-e2e 或发布**。本批文档产出**不构成实现授权**，也不产生验收证据；VOPS- 验收项状态不因本报告自动上调。
