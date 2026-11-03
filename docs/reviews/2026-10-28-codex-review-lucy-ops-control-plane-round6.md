# L25-16 运维控制面 MCP（lucy_ops）Codex 审阅报告 · 第 6 轮

## 结论

**Codex 交付判定：不可交付开发** —— 仍有 3 项阻塞：**F6-01、F6-02、F6-03**。

判定原文要点：五态聚合表、重入分支和恢复后聚合规则仍不一致，合法子集执行后也存在 operation 无法继续提交剩余对象的路径；源码确认批量 check 只生成任务及报告，不生成发布所需的批量快照，因此适配器中的 `resolveBatchValidationId(scope, outcome)` 仍缺少真实生产链路；四类结果、异常边界和幂等重放顺序均有修订痕迹，但尚未完整落实到核心算法；VOPS-01–69 在两个验收表中均无缺号、无重复，但阶段退出条件仍有漏项。

严重性统计：本轮**新增 11 条**——**阻塞 3**（F6-01、F6-02、F6-03）、**高 6**（F6-04–F6-09）、**中 2**（F6-10、F6-11）；另对第 5 轮的 **13 个编号**做闭合性核验，结论为**已闭合 6**（Q03、F5-01、F5-04、F5-05、Q06、Q07）、**部分闭合 6**（Q01、Q02、F5-02、F5-03、F5-07、Q05）、**未闭合 1**（F5-06）。

> Codex 声明：「已闭合」仅评价设计修订，不代表实现或测试通过；本轮未执行构建、测试、部署或 Git 写操作，未修改、创建或删除文件。

## 审阅基线与限制

- **被审文档版本与行号基准（存在时序差异，务必注意）**：Codex 第 6 轮审阅的是 [Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md) 的 `v0.8-fifth-review-fixes` 与 [Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md) 的 `v0.6-fifth-review-fixes`，其读取范围为 **Spec 1–1220 行、Plan 1–420 行**。**本报告落盘时，工作区文档已推进至 Spec `v0.9-sixth-review-fixes`（1339 行）、Plan `v0.7-sixth-review-fixes`（445 行）**——即 Codex 读完的版本之后，文档已按第 6 轮要求再次修订。因此：
  - 下文各条「位置」中的 `Spec:xxx` / `Plan:xxx` 均为 **Codex 所读 v0.8 / v0.6 文本**的行号，**不能**与当前工作区行号对照；
  - 本报告「MiniMax Code 独立核实」一列中给出的 `file:line`，**源码行号不受文档版本影响**，仍然有效；对文档位置则一律另给当前 v0.9 / v0.7 的核验锚点。
- **审阅方式**：由本机 Codex（`codex-local`，read-only sandbox，approval-policy=never）对两份文档做对抗式设计审阅。
- 本轮**未运行**功能测试、浏览器、real-e2e、构建或服务启动，**未连接**数据库与客户环境；**不产生运行证据**。
- 本轮**仅创建本报告**，**未修改** Spec 与 Plan 正文。
- L25-11 仅作为依赖被核对，不在本次审阅范围。
- **核实方式**：MiniMax Code 对 F6-01–F6-11 逐条回查 `webui/server/` 源码与当前 Spec/Plan 文本，确认 Codex 断言与代码事实是否一致；对纯文档内部一致性的条目只核对文档现状，不给源码行号。
- **Codex 自述的「无法核实清单」（原文照录）**：①历史「12 条」的精确编号与分组——题面未完整列出，本轮没有读取历史审阅报告；②PM 实际签字、需求签核及 L25-11 当前复审是否通过——文档状态自述不能替代这些审批或复审证据；③尚未实现的控制面恢复、事务、阻断和验收行为——本轮只能判断设计是否闭合，不能确认运行效果。

## 发现的问题

### A. 第 5 轮 13 个编号的闭合性核验（Codex 第 6 轮原表 + MiniMax Code 核实）

> 「当前设计位置」一列为 **Codex 所读 v0.8 文本**的行号；「依据」中的**源码** `file:line` 不受文档版本影响，仍然有效。

| 编号 | 原发现 | 当前设计位置（Codex 所读 v0.8） | Codex 核验结论 | MiniMax Code 独立核实 |
|---|---|---|---|---|
| Q01 | 受理态被当作失败并整组撤销 | Spec:698–770、954–972；Plan:185 | 部分闭合 | **属实**（已回查源码）：`pending_activation` 已改为 `kind`、`ok:null`；但 Spec:677 仍生成无 `kind` 结果，恢复分支只改 `state`，成功分支还覆盖掉 `release`——见 F6-06。受理态确为 `activationStatus:"unconfirmed"` 组合：`webui/server/semantic-assets.ts:2685-2689`（`reindex_failed` 时 `recoveryRequired:false` + `unconfirmed`）、`:2731-2735`（`promote_failed` 时 `recoveryRequired:true` + `unconfirmed`），两处独立取值证明 `activationStatus` 与 `recoveryRequired` 是两条轴 |
| Q02 | operation 五态、重入及非终态持久化不完整 | Spec:327–344、627–647、741–757、815 | 部分闭合 | **属实**（已回查源码）：恢复后的优先级与聚合表不一致；两种非终态重入只返回拒绝，未给出控制面收敛调用链——见 F6-01、F6-02。审计可被独立改写且无存储层兜底：`webui/server/admin/audit.ts:802-833`（同键 `ON CONFLICT(idempotency_key) DO NOTHING`）、`:835-861`（按 id 更新） |
| Q03 | 错用 `candidates`，假设底层有 `groups/perTarget` | Spec:906–935；Plan:233–234 | 已闭合 | 已由 MiniMax Code 回查源码确认为属实（证据见第 6 轮 Codex 报告所引位置）；底层计划读取确以快照 `batch` 段为前提：`webui/server/semantic-assets.ts:2931-2939` |
| F5-01 | 外层与底层发布锁自冲突 | Spec:416–420、859–863、946–954；Plan:239 | 已闭合 | **属实**（已回查源码）：底层发布直接取 coordinator 锁 `webui/server/semantic-assets.ts:1501-1512`；高层封装在回调退出时释放 `webui/server/publish-coordinator.ts:326-330`。取消外层取锁消除了该冲突；另有时序事实错误，见 F6-08 |
| F5-02 | 子集未绑定 attempt、恢复越界、非法子集先认领 | Spec:609–647、803–806；Plan:189 | 部分闭合 | **属实**（已回查源码）：非法子集校验已前移，`pending` 分支直接返回恢复；但首次认领没有写入执行范围的明确步骤，且成功子集与整份计划聚合冲突——见 F6-02。代码前提成立：幂等查询刻意置于读快照之前 `webui/server/semantic-assets.ts:2192-2223`，成功受理后快照被删除 `:2657-2658` |
| F5-03 | 异常绕过回滚和统一终结 | Spec:680–696、781–787；Plan:190 | 部分闭合 | **属实**（已回查源码）：`try/catch` 实际仅包住 `executeGroup`；target 审计、`rollbackGroup`、终态审计和持久化仍在边界外——见 F6-05。审计确为真实数据库写入：`webui/server/admin/audit.ts:802-833`、`:835-861`；窗口占用时抛错 `webui/server/publish-coordinator.ts:319-323`，既有实现只有 `try/finally` 释放锁、无效果层收敛 `:326-330` |
| F5-04 | 旧 Schema 移除写集超出临界区 | Spec:421–424、867–871；Plan:207 | 已闭合 | **属实**（已回查源码）：路由确实接受删除选项 `webui/server/index.ts:1955-1971`；`removeSchema` 先 `writeKtxYaml`、**返回之后**才删除 Manifest/Overlay `webui/server/project.ts:947-963`，即删除在锁外。与发布窗口的协调另见 F6-09 |
| F5-05 | 历史版本裁剪不在组事务中 | Spec:425、873–877；Plan:223 | 已闭合 | **属实**（已回查源码）：`pruneVersions` 逐个 `safeRemove` 被裁剪版本的快照文件 `webui/server/table-yaml-history.ts:279-294`，保留上限 `TABLE_YAML_VERSION_RETENTION_LIMIT`，即先删旧快照再谈组回滚已来不及 |
| F5-06 | 缺少 scope/check 到可发布计划的转换 | Spec:886–904；Plan:232 | **未闭合** | **属实**（已回查源码）：`runSemanticBatchTask` 只创建报告和任务记录 `webui/server/semantic-batch-tasks.ts:335-379`；真正创建批量快照的是维护包 staging 路径 `webui/server/index.ts:2188-2217` → `persistSemanticBatchSnapshot` `webui/server/semantic-assets.ts:1096-1152`。等待 check 不能产生文档假定的快照——见 F6-03 |
| F5-07 | TTL 与幂等重放优先级冲突 | Spec:584–607、982–987；Plan:169–170、241 | 部分闭合 | **属实**（已回查源码）：新增散文规则正确，但 C1 仍先加载计划、C3 才查 operation；Plan S2 仍写「过期即拒」——见 F6-04。底层顺序为先幂等后快照 `webui/server/semantic-assets.ts:2192-2223` |
| Q05 | 认领与 operation 审计绑定不原子 | Spec:617–647、805；Plan:188 | 部分闭合 | **属实**（已回查源码）：`claimIdempotency` 与 `claimAndBindAudit` 仍为两个调用；target 仍先写审计、后认领。原子性承诺与算法不一致——见 F6-07。源码前提：同键插入被去重 `webui/server/admin/audit.ts:802-807`，按 id 更新的接口为 `:835-861` |
| Q06 | 整组撤销后仍保留成员成功结果 | Spec:705–716；Plan:335 | 已闭合 | **属实**（已回查源码）：撤销完成后对全部 claimed 成员统一覆盖为 `kind:"failed"`、`ops_group_rolled_back`，不再保留原成功结果。回滚抛异常的问题另见 F6-05 |
| Q07 | 空 claimed 组仍执行 | Spec:667–671 | 已闭合 | **属实**（已回查源码）：明确执行 `if claimed is empty: continue`，全 reused/skipped 的组不会再次执行 |

### B. 第 6 轮新发现 F6-01–F6-11

#### F6-01［阻塞］五态仍未形成一致、可退出的状态机

**位置（Codex 所读 v0.8）**：Spec:331–335、632–646、747–757、815–817；关键原文「含 `pending_activation` 成员时取 `pending_activation`」。既有 release 状态接口只是返回记录：`webui/server/index.ts:2409–2422`，不会更新控制面 operation。

**问题**：聚合表允许「存在 failed、同时还有 pending」时终结为 failed；恢复段却规定存在未收敛成员就变为 `recovery_required`，并在含 `pending_activation` 时优先取它，**逆转了表中 `recovery_required` 的优先级**。两种非终态重入仅拒绝，没有明确的控制面恢复/监听入口。未知状态也会落入重试。

**影响**：operation 状态机的终止条件与恢复优先级不一致，成员在两条路径下会得到不同的 operation 状态；非终态没有收敛入口则永久停留在非终态，未知状态被当作失败重试会静默改写成员结论。

**Codex 建议修法**：重写 Spec §4.2、§6.2 C3.2/C7.2 及恢复段，统一使用一个聚合函数；未终结成员存在时不得转失败终态。明确启动恢复扫描、release 监听者、排他所有权及审计更新步骤；未知状态显式拒绝。扩展 VOPS-60，新增 VOPS-70 覆盖混合状态及重启后最终收敛。

**MiniMax Code 独立核实：属实。** Codex 引述的 v0.8 原文与本条描述一致（**本报告不自行补 v0.8 行号**）；当前 v0.9 已按本条重写为唯一聚合函数，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:327`（**只允许一个聚合函数** `aggregateOperationState(members)`，C3.2 / C7.2 / 恢复收敛三处共用）、`:338-343`（聚合表：`recovery_required` > `pending_activation` > `failed` > `succeeded`）、`:345`（**存在未终结成员时不得转失败终态**）、`:347`（未知状态抛 `ops_state_corrupt`，不得当作失败重试）、`:670-675`（重入分派穷尽拒绝分支）、`:811`（C7.2 调用同一聚合函数）、`:885-890`（恢复后**必须**重新调用同一聚合函数）、`:897-898`（恢复扫描入口与 release 收敛入口）、`:489`（缺口 G33）；验收项 `VOPS-70`（`:1281`）。即：**本条对 v0.8 的指控成立，v0.9 已按其要求重写，但闭合与否仍须第 7 轮复审确认。**

#### F6-02［阻塞］执行范围与 operation 生命周期不相容

**位置（Codex 所读 v0.8）**：Spec:612–622、641–646、650–659、747、806；全成功条件见 Spec:334；关键调用 `aggregateOperationState(plan.perTarget)`。

**问题**：原计划含 A/B，本次仅提交 A，A 成功后 B 被标 `skipped`；C7 却按整个 `plan.perTarget` 聚合，不能得到全成功。随后提交 B 又不属于旧 attempt 的 A 范围，被拒绝，**合法剩余提交没有闭合路径**。首次认领也未明确保存 `execSet/groupIds`。

**影响**：同一原计划被拆成多次提交时，第二次提交会被 `ops_operation_scope_mismatch` 拒绝；operation 在第一次成功提交后就卡在无法终结的状态。

**Codex 建议修法**：在 Spec §4.2/§6.2 明确区分逻辑 operation 与 attempt 的范围、状态和完成条件；结束 A attempt 后须允许原计划内 B 建立后续 attempt，且不执行未请求对象。将完整计划、`execSet/groupIds` 显式传入原子认领。新增 VOPS-71：A 成功后提交 B；扩展 VOPS-64 验证首次认领后立即崩溃。

**MiniMax Code 独立核实：属实。** 当前 v0.9 已按本条改写，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:639-643`（三范围分清：`plan.perTarget` = 原计划全集 / `execSet` = 本次 attempt 执行范围 / `opRec.execSet` = 上一 attempt 范围）、`:685-686`（**合法性边界始终是 `plan.perTarget`（原计划全集），不是上一 attempt 的 `execSet`**——否则「本次只提交 A、之后补交 B」的合法路径会被误拒）、`:707-709`（未被任何 attempt 认领执行的成员状态为 `pending`（未执行），**不是 `skipped`，也不是失败**）、`:657-659`（认领时一并持久化 `planRef` 与 `execSet`）、`:811`（C7.2 按 `plan.perTarget` 聚合，与 operation 成员集合一致）；验收项 `VOPS-71`（`:1282`）、`VOPS-64` 扩展（`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:364`、`:371`）。即：**指控对 v0.8 成立，v0.9 已按其要求重写，须第 7 轮复审确认。**

#### F6-03［阻塞］七步适配器仍包含不存在的数据转换

**位置（Codex 所读 v0.8）**：Spec:895–904；Plan:232。

**问题**：check 结果中没有发布快照或 validationId；`resolveBatchValidationId(scope, outcome)` **无可消费的数据来源**。当前算法无法建立首个可发布计划。

**影响**：语义发布工作流 W-B 的第一步（取得可发布计划）无法落地，preview 拿不到可被 publish 消费的计划对象。

**Codex 建议修法**：重写 Spec §6.4 步骤 2–4 及 Plan S5.2：明确工具究竟消费既有 staged validation，还是由 Lucy 构建候选并调用快照持久化服务；逐项定义候选来源和输入映射。复用已有 operations 查询，不把新增查询入口当成转换修复。扩展 VOPS-68，要求从真实 preview 输入走到 publish，禁止 mock 一个凭空出现的 validationId。

**MiniMax Code 独立核实：属实（且为事实性更正）。** 逐项回查源码确认：
- 批量 check 端点返回体为 `{operationId, taskId, scopeId, status:"queued", selectedCount, dependencyCount}`，**没有 validationId**——响应构造实际落在 `webui/server/semantic-batch-routes.ts:323-334`（Codex 记为 `:318-333`，含其前一行 `.catch` 段，起止偏移 1 行以内）；
- 任务结构 `SemanticBatchTask` **不含 validationId 字段**：`webui/server/semantic-batch-tasks.ts:59-79`；
- 任务结束只写报告与任务记录：`webui/server/semantic-batch-tasks.ts:335-379`；
- 批量快照由**维护包 staging 路径**创建：`webui/server/index.ts:2188-2217` 调用 `persistSemanticBatchSnapshot`，后者需要候选内容、摘要、目标前像等完整输入：`webui/server/semantic-assets.ts:1096-1152`；
- 读计划强制要求快照带 `batch` 段，否则抛 `VALIDATION_SNAPSHOT_NOT_FOUND`：`webui/server/semantic-assets.ts:2931-2939`。

**因此适配器中的 `resolveBatchValidationId(scope, outcome)` 确无任何可消费的数据来源。** 当前 v0.9 已把适配器改为「入参必须携带既有 staged 批次的 `validationId`」，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:975-991`（步骤 0 及其源码事实注记）、`:486`（缺口 G30）；Plan 侧 `docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:239-243`（S5 第 2 项：**语义发布工具必须消费既有 staged 批次的 `validation_id`**，并逐条列出「不得把 check 产物当计划、不得凭空构造 validationId、首期不在控制面内自建 batch 快照」）、`:74`（既有 staged 批次快照条目）、`:259`（S5 退出条件含 `VOPS-68`）。

#### F6-04［高］TTL 优先级只修了说明，未修主算法

**位置（Codex 所读 v0.8）**：Spec:584–607、982–987；Plan:169–170、241。

**问题**：在查到 operation 前，C1 就可能返回找不到计划；新提交路径也没有明确 TTL 判断。Plan S2 的无条件过期拒绝与 S5 的重放例外冲突。

**影响**：已成功的同键重放在计划过期后不可达，幂等重放能力被 TTL 检查截断。

**Codex 建议修法**：修改 Spec §6.2：先定位并核验 operation，已有记录用持久化计划再授权；无记录才加载计划并检查 TTL。规定计划保留期及 failed attempt 重放政策，同步 Plan S2 和 VOPS-12/69；将 VOPS-69 的通用责任补给 S2。

**MiniMax Code 独立核实：属实。** 底层顺序已核实：发布对同一幂等键的既有 release 查询**刻意置于读取快照之前**（`webui/server/semantic-assets.ts:2192-2223`，注释写明「首次发布会消费快照，重放若在读快照之后就会被 refused with snapshot not found」），而成功受理后快照被删除（`:2657-2658`）。即设计若坚持「先加载计划再查幂等」，原本可用的重放会被改写成「快照不存在」，Codex 判断与源码事实一致。当前 v0.9 已把 TTL 优先级前置到 operation 定位，核验锚点：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:257`（**计划过期拒绝只适用于「尚未发生任何执行」的新提交**）、`:369`（`VOPS-69`）。

#### F6-05［高］异常与回滚边界仍不完整，回滚的锁所有权也未定义

**位置（Codex 所读 v0.8）**：Spec:660–663、680–706、734–757。

**问题**：target 审计/认领、回滚、最终审计和持久化都能绕过唯一的 catch；后续组及已完成结果仍可能被丢弃。算法只注明 `executeGroup` 在锁内，没有明确回滚仍持有该锁。

**影响**：组内异常时已完成组的结果丢失、审计与终态不落库，且回滚可能在锁外执行造成竞态。

**Codex 建议修法**：重构 Spec §6.2 C5–C7：按组覆盖 prepare/claim/execute/verify/rollback/persist，明确锁覆盖到回滚核验；终态审计故障进入可恢复路径并保留已完成结果。扩展 VOPS-65/57，注入 target 认领审计、rollback、终态审计和进度持久化异常。

**MiniMax Code 独立核实：属实。** 审计写入确为真实数据库操作：`webui/server/admin/audit.ts:802-833`（`INSERT … ON CONFLICT(idempotency_key) DO NOTHING`）与 `:835-861`（按 id 的 `UPDATE`）；协调器在回调退出时释放锁，且**没有**任何效果层的异常收敛：`webui/server/publish-coordinator.ts:319-323`（窗口被占用即抛 `PublishCoordinatorBusyError`）、`:326-330`（只有 `try/finally` 释放锁）。即「target 审计/认领、回滚、终态审计与持久化都在 catch 边界之外」成立，Codex 判断与源码事实一致。当前 v0.9 已把边界扩到撤销与核验：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:197`（**try 边界覆盖「执行 → 撤销 → 核验 → 结论持久化」整条组内链；锁必须覆盖到撤销与核验完成**）。

#### F6-06［高］四分类未做到逐字段一致

**位置（Codex 所读 v0.8）**：Spec:677、693–695、708–710、723–730、965–972。

**问题**：预检失败结果缺 `kind`；多个恢复分支只改 `state`，可能保留旧成功结果；通用成功分支把适配器的 `release` 覆盖掉。语义适配器只判断 `activationStatus`，未处理独立的 `recoveryRequired`。

**影响**：结果对象可能出现 `kind` 与 `ok` 不成对、状态与结果矛盾、`release` 字段被覆盖丢失；恢复义务与生效状态被混为一谈会误判成功。

**Codex 建议修法**：在 Spec §6.2 定义唯一 Outcome 构造/校验函数，所有分支同时设置 `state` 和 `result`；保留 `release/id`、activation、原因码。§6.4 及后续 release 收敛映射须**先判断恢复义务，再判断生效状态**。新增 VOPS-72，覆盖字段完整性、恢复态优先级及成功重放保留原 release。

**MiniMax Code 独立核实：属实。** release 确为**两个独立轴**，源码注释即明示二者互不相干：`webui/server/semantic-release-status.ts:10-20`（「`recoveryRequired` 与 `activationStatus` 是两条独立事实」），类型定义 `:29-37`（`SemanticActivationStatus` / `SemanticRecoveryRequiredState` / `SemanticReleaseActivationState`）。且源码中确实存在 `recoveryRequired:true` 与 `unconfirmed` 的组合：`webui/server/semantic-assets.ts:2731-2735`（`promote_failed` → `recoveryRequired:true` + `activationStatus:"unconfirmed"`）；对照 `:2685-2689`（`reindex_failed` → `recoveryRequired:false` + `unconfirmed`）可见两者确实独立取值。故「只判断 `activationStatus` 会漏掉恢复义务」成立——**受理态不等于生效确认**，收敛必须等 release 终态。当前 v0.9 已补唯一 `Outcome` 构造器与「先判恢复义务、再判生效状态」：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:1095`（差异第 5 条）、`:1283`（`VOPS-72`）。

#### F6-07［高］「原子认领并绑定审计」仍是名称承诺

**位置（Codex 所读 v0.8）**：Spec:620–625、645–647、660–663、805；Plan:188。

**问题**：operation 认领与审计绑定分离，target 更是先插审计再认领；没有统一说明跨这些步骤的事务边界，以及 target 崩溃窗口如何补建绑定。

**影响**：「原子」二字在设计层没有存储层保证；崩溃窗口下可能出现已插审计未绑定的孤儿行，或认领先于审计落库导致意图丢失。

**Codex 建议修法**：在 Spec §4.2/§6.2 和 Plan S2 明确存储方案，例如同一 SQLite 数据库内独立业务表与审计表共用事务；operation/target 均使用真正的 claim-and-bind。若采用恢复协议替代原子事务，应删除原子性声明并完整定义每个窗口。扩展 VOPS-62 至两级认领及所有中断点。

**MiniMax Code 独立核实：属实（且为设计层仍未闭合项）。** 源码前提已核实：审计插入使用 `ON CONFLICT(idempotency_key) DO NOTHING`（`webui/server/admin/audit.ts:802-807`），同键回查与按 id 更新分别为 `:829-832` 与 `:835-861`——即「补建绑定」只能按审计键查回既有行、再按 id 收敛，**不存在**能覆盖「认领 + 插审计 + 绑定」的单条原子调用。当前 v0.9 现状：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:657-660` 仍是 `claimIdempotency(...)` 与 `claimAndBindAudit(...)` **两个调用**（`:661` 以 normative 注释要求后者必须是单次原子操作），`:490` 登记缺口 **G34**（「须明确业务幂等存储与审计表同库同事务，或改为完整的恢复协议并删除原子性声明」）。即：**原子性要求已写入设计，但存储层方案仍未定案，本条在设计层尚未闭合**，须第 7 轮复审给出结论。

#### F6-08［高］「底层持锁至索引终态」的源码事实不准确

**位置（Codex 所读 v0.8）**：Spec:418、863、950–951；Plan:71、239。

**问题**：当前锁在 `reindexImpl` 返回时释放，随后才核验摘要、记录终态审计及 `published`、完成恢复日志。文档据此作出的整个发布生命周期排他承诺不能成立。

**影响**：设计对发布通道的排他性承诺宽于源码实际保证，终态核验与持久化窗口内可被其他协调写插入。

**Codex 建议修法**：修正 Spec §4.5/§6.3 和 Plan 的既有行为描述，把「锁覆盖终态核验及持久化」登记为 W-B 解锁前必须由 L25-11 维护者证明关闭的依赖，不能宣称已经具备。扩展 VOPS-63，在 reindex 返回与终态持久化之间暂停并尝试其他协调写。

**MiniMax Code 独立核实：属实（且为事实性更正）。** 源码顺序逐点核实无误：锁在 `finally` 中于 `reindexImpl` 返回时释放（`webui/server/semantic-assets.ts:2692-2694`），**早于**终态摘要核验（`:2718`，`verifyFinalTargetDigests`）、终态审计写入（`:2743`，`recordConfigChange`）、`published` 记录（`:2764`，`updateReleaseRecord`）、恢复日志完成（`:2779`，`completeRecoveryJournal`）。故「锁覆盖到索引终态」及「发布窗口覆盖整个发布生命周期」的说法**不成立**，Codex 更正正确。当前 v0.9 已按此更正：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:432-433`（明确「覆盖范围止于 reindex 返回（F6-08）」，并登记为 W-B 对 L25-11 的依赖）、`:487`（缺口 G31）。

#### F6-09［高］Schema 删除与语义发布仍使用不相交的互斥机制

**位置（Codex 所读 v0.8）**：Spec:838–842、861–870；Plan:207、239。

**问题**：新方案让旧删除入口取得 ktx 锁，但语义发布只取发布锁；删除 Manifest/Overlay 仍可与发布或后台索引交错。

**影响**：删除操作可在语义发布或后台 reindex 期间删掉正在被发布/索引的文件，产生半写与残留。

**Codex 建议修法**：修改 Spec §6.3 和 Plan S3：凡删除语义内容文件，旧 REST 与控制面入口均按固定顺序取得发布窗口，并保留文件前像用于失败恢复。扩展 VOPS-66，加入与语义发布及 reindex 并发的拒绝/排他断言。

**MiniMax Code 独立核实：属实。** 两个互斥机制确实不相交：语义发布取的是**发布协调窗口**（`webui/server/semantic-assets.ts:1501-1512`，`acquirePublishCoordinatorLock(projectRoot, "batch_import", …)`），而删除侧只持 ktx 写锁——路由接受 `deleteManifest` / `deleteOverlays`（`webui/server/index.ts:1955-1971`），实际删除发生在 `writeKtxYaml` **返回之后**（`webui/server/project.ts:947-963`），即在 ktx 锁之外。Codex 判断与源码事实一致。当前 v0.9 已要求删除语义内容文件时按 `withKtxYamlWriteLock → withDisplayWriteBarrier → withPublishCoordinator → 删文件` 取得发布窗口：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:957`、`:488`（缺口 G32）；Plan 侧 `docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:214`、`:216`（`VOPS-66`）。

#### F6-10［中］阶段退出条件未覆盖全部分配项

**位置（Codex 所读 v0.8）**：Plan:209 未列分配给 S3 的 `VOPS-58`（分配见 :342）；Plan:225 未列分配给 S4 的 `VOPS-51`（:335）；S6 退出条件 :254 未逐项列出 `VOPS-57/60/62/64/65`（:341、344、346、348–349）。Plan:355 明确要求逐项对应。

**问题**：编号完整不等于阶段门禁完整。

**影响**：验收项在追踪表里有归属，但对应阶段的退出条件未列，验收项可在阶段结束时被静默跳过。

**Codex 建议修法**：补齐 Plan §4 对应退出条件；S6 应明确要求这些断言**取得证据**，而非仅要求「有执行记录」。无需新增编号。

**MiniMax Code 独立核实：属实。** 当前 v0.7 已按本条补齐，核验锚点：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:199`（S2 退出条件含 `VOPS-58`）、`:216`（S3 退出条件含 `VOPS-58`、`VOPS-66`）、`:232`（S4 退出条件含 `VOPS-51`）、`:270`（S6 退出条件要求 `VOPS-57` / `VOPS-60` / `VOPS-62` / `VOPS-64` / `VOPS-65` / `VOPS-70`–`72` **逐项取得直接证据**（不接受「仅有一份执行记录」））、`:357-365`（追踪表分配）、`:374`（「阶段退出条件与本表必须逐项对应」）。即：**指控对 v0.6 成立，v0.7 已补齐，须第 7 轮复审确认。**

#### F6-11［中］G15 的阶段限定仍有相反规定

**位置（Codex 所读 v0.8）**：Spec:456、997、1032–1039，与 Spec:1173「G2 + G15 后再实现任何写类工具」冲突。

**问题**：§7 允许 W-A 不依赖 G15，§10 却要求 G2+G15 后才能实现任何写工具。

**影响**：按 §10 读，G15 会成为 W-A 两个写类工具族的前置门禁，与 D5 分流（W-A 先行）相抵触。

**Codex 建议修法**：修改 Spec §10 为公共归因 G2 适用于全部写工具、G15 只适用于 W-B；检查 Plan 的相关完成定义，保持 D5 分流一致。无需新增编号。

**MiniMax Code 独立核实：属实。** 当前 v0.9 已消除该矛盾：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:471`（G15 标注**适用阶段限定为 W-B**，「W-A 的两个工具族不走发布服务，不得因此阻塞 W-A 先行（D5）」）、`:1292`（§10 风险表「审计归因失真」一行改为「**公共归因 G2 适用于全部写类工具**（控制面来源值）；**G15 仅限 W-B 的发布链路**，不得作为 W-A 写类工具的前置（与 §7 的阶段限定一致，见 §7.2）」）。即：**指控对 v0.8 成立，v0.9 已改写，须第 7 轮复审确认。**

## 处置台账

### 第 6 轮 11 条新发现的落点与当前状态

| 编号 | 严重性 | 修订落点（Spec／Plan／验收） | 截至本报告落盘时的状态 |
|---|---|---|---|
| F6-01 | 阻塞 | Spec §4.2 唯一聚合函数 `aggregateOperationState`、C3.2 重入分派、C7.2 终结、恢复收敛段统一调用；缺口 G33；验收 VOPS-70 | 已写入 v0.9（Spec `:327`、`:338-347`、`:811`、`:885-890`、`:897-898`）；**是否闭合须第 7 轮复审确认** |
| F6-02 | 阻塞 | Spec §6.2 区分 `plan.perTarget` / `execSet` / `opRec.execSet`，认领持久化 `planRef` + `execSet`，未认领成员为 `pending`；验收 VOPS-71，扩展 VOPS-64 | 已写入 v0.9（Spec `:639-643`、`:657-659`、`:685-686`、`:707-709`）；**须第 7 轮复审确认** |
| F6-03 | 阻塞 | Spec §6.4 步骤 0–1 改为**消费既有 staged 批次的 `validationId`**；缺口 G30；Plan S5 第 2 项与退出条件；扩展 VOPS-68 | 已写入 v0.9（Spec `:975-991`、`:486`）与 v0.7（Plan `:239-243`、`:74`、`:259`）；**须第 7 轮复审确认** |
| F6-04 | 高 | Spec §6.2 TTL 判断前置到 operation 定位；Plan S2/S5 顺序；VOPS-69 通用责任补给 S2 | 已写入 v0.9 / v0.7（Plan `:257`、`:369`）；**须第 7 轮复审确认** |
| F6-05 | 高 | Spec §6.2 C5–C7 逐组覆盖 prepare/claim/execute/verify/rollback/persist，锁覆盖到撤销与核验；Plan S2 第 31 项；扩展 VOPS-65 / VOPS-57 | 已写入 v0.7（Plan `:197`）；**须第 7 轮复审确认** |
| F6-06 | 高 | Spec §6.2 唯一 `Outcome` 构造/校验函数；§6.4 release 收敛**先判恢复义务、再判生效状态**；验收 VOPS-72 | 已写入 v0.9（Spec `:1095`、`:1283`）；**须第 7 轮复审确认** |
| F6-07 | 高 | Spec §4.2/§6.2 与 Plan S2 明确原子认领的**存储方案**；缺口 G34；扩展 VOPS-62 至两级认领与全部中断点 | **未闭合**：v0.9 已把原子性要求写进 §6.2 normative 注释与缺口 G34，但**存储层方案（同库同事务 or 完整恢复协议）仍未定案**（Spec `:657-661`、`:490`） |
| F6-08 | 高 | Spec §4.5 规则 12 / §6.3 更正「发布窗口覆盖范围止于 reindex 返回」，登记为 W-B 对 L25-11 的依赖；缺口 G31；扩展 VOPS-63 | 已写入 v0.9（Spec `:432-433`、`:487`）；**须第 7 轮复审确认** |
| F6-09 | 高 | Spec §6.3 与 Plan S3：删除语义内容文件须按固定顺序取得发布窗口并保留文件前像；缺口 G32；扩展 VOPS-66 | 已写入 v0.9（Spec `:957`、`:488`）与 v0.7（Plan `:214`、`:216`）；**须第 7 轮复审确认** |
| F6-10 | 中 | Plan §4 补齐 S2/S3/S4/S6 退出条件，S6 要求逐项取得直接证据；无需新增编号 | 已写入 v0.7（Plan `:199`、`:216`、`:232`、`:270`）；**须第 7 轮复审确认** |
| F6-11 | 中 | Spec §10 风险表改为「公共归因 G2 适用于全部写工具、G15 只适用于 W-B」；缺口 G15 标注 W-B 阶段限定；无需新增编号 | 已写入 v0.9（Spec `:471`、`:1292`）；**须第 7 轮复审确认** |

### 第 5 轮 13 个编号的闭合性核验总表（Codex 第 6 轮原表 + MiniMax Code 核实）

| 编号 | 第 5 轮原发现 | 第 6 轮核验结论 | MiniMax Code 独立核实 | 落点 |
|---|---|---|---|---|
| Q01 | 受理态被当作失败并整组撤销 | 部分闭合 | **属实** | 转 F6-06 |
| Q02 | operation 五态、重入及非终态持久化不完整 | 部分闭合 | **属实** | 转 F6-01、F6-02 |
| Q03 | 错用 `candidates`，假设底层有 `groups/perTarget` | 已闭合 | **属实** | 已在 v0.9 修正（改用 `effectiveTargets`） |
| F5-01 | 外层与底层发布锁自冲突 | 已闭合 | **属实** | 已在 v0.9 修正（取消外层取锁） |
| F5-02 | 子集未绑定 attempt、恢复越界、非法子集先认领 | 部分闭合 | **属实** | 转 F6-02 |
| F5-03 | 异常绕过回滚和统一终结 | 部分闭合 | **属实** | 转 F6-05 |
| F5-04 | 旧 Schema 移除写集超出临界区 | 已闭合 | **属实** | 已在 v0.9 修正；与 F6-09 的发布窗口协调是**另一处** |
| F5-05 | 历史版本裁剪不在组事务中 | 已闭合 | **属实** | 已在 v0.9 修正（延后裁剪或纳入恢复日志） |
| F5-06 | 缺少 scope/check 到可发布计划的转换 | **未闭合** | **属实** | 转 F6-03 |
| F5-07 | TTL 与幂等重放优先级冲突 | 部分闭合 | **属实** | 转 F6-04 |
| Q05 | 认领与 operation 审计绑定不原子 | 部分闭合 | **属实** | 转 F6-07 |
| Q06 | 整组撤销后仍保留成员成功结果 | 已闭合 | **属实** | 已在 v0.9 修正（统一覆盖为 `ops_group_rolled_back`） |
| Q07 | 空 claimed 组仍执行 | 已闭合 | **属实** | 已在 v0.9 修正（`if claimed is empty: continue`） |

### 仍需 PM / 客户拍板的开放项（Codex 第 6 轮原文要点）

| 开放项 | Codex 说明 | 阻塞性 |
|---|---|---|
| **D7 同写集原子组对 D3 的收窄** | 这是批量成功与失败的产品合同，审阅方可以确认共享文件的技术约束，不能代替 PM 接受合同变化（依据 Spec:365–380、1059；Plan:48、56） | **阻塞实施授权** |
| **首期 Schema 移除是否开放 `deleteManifest/deleteOverlays`，默认值是什么** | 删除资产与只移出配置范围的后果不同，不能由实现者自行选择；当前文档仍使用「若支持」，没有明确答案（Spec:423、870；Plan:207） | **阻塞该工具入参合同冻结** |
| **D6 后续工具清单，以及客户是否需要额外 HTTP/巡检能力** | 涉及范围、优先级和客户承诺，不能从源码推导（Spec:1060、1064–1067） | **不阻塞已确定的首期范围**；已拍板的 D1–D5 无需因本轮审阅重新表决 |

### 第 6 轮判定之后仍未闭合的项

- **3 项阻塞**：F6-01（状态聚合不唯一、未终结成员可被提前判失败）、F6-02（分次提交无闭合路径）、F6-03（适配器消费不存在的数据来源）——按 Codex 判定均为**不可交付开发**的前置项。
- **1 项设计层未闭合**：F6-07（原子认领与审计绑定的**存储方案**未定案）——v0.9 只写入了 normative 要求与缺口 G34，尚未给出存储层答案。
- **阶段责任漂移**：F6-10 的退出条件漏项在 v0.7 已补齐，待第 7 轮确认。
- **本报告不判定第 7 轮结果**：当前工作区修订稿已吸收第 6 轮的修订要求（Spec 已至 `v0.9-sixth-review-fixes`，缺口扩至 G1–G34、验收扩至 VOPS-01–72；Plan 已至 `v0.7-sixth-review-fixes` 并收录 VOPS-70–72 的阶段映射），**但「吸收」不等于「闭合」**，闭合与否须由下一轮审阅给出结论。

## 关联文档

- 被审 Spec：[L25-16 运维控制面 MCP（lucy_ops）Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)
- 被审 Plan：[L25-16 实施 Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)
- 第 1 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane.md](2026-10-28-codex-review-lucy-ops-control-plane.md)
- 第 2 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round2.md](2026-10-28-codex-review-lucy-ops-control-plane-round2.md)
- 第 3 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round3.md](2026-10-28-codex-review-lucy-ops-control-plane-round3.md)
- 第 4 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round4.md](2026-10-28-codex-review-lucy-ops-control-plane-round4.md)
- 第 5 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round5.md](2026-10-28-codex-review-lucy-ops-control-plane-round5.md)

## 本轮审阅交付的实际范围

本报告是第 6 轮 Codex 审阅结论的落盘件，**未修改 Spec 与 Plan 正文**，未修改任何运行代码、测试、运行配置、客户资产、数据库、镜像或部署，**未执行任何功能验证、浏览器验证、UAT、real-e2e 或发布**。本批文档产出**不构成实现授权**，也不产生验收证据；VOPS- 验收项状态不因本报告自动上调。第 6 轮的交付判定为**不可交付开发**，该判定在本报告落盘时**仍然有效**。
