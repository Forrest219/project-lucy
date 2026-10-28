# L25-16 运维控制面 MCP（lucy_ops）Codex 审阅报告 · 第 5 轮

## 结论

**Codex 交付判定：不可交付开发** —— 仍有 4 项阻塞：**Q01、Q02、Q03**，以及本轮新发现 **F5-01**。

判定原文要点：发布适配器虽然增加了 `pending_activation`，通用编排仍会因其 `ok:false` 执行组回滚，而源码中的后台索引此时仍在运行。五态模型也未落实为完整的持久化与重入分支，operation 仍可能绕过恢复进入新 attempt。源码确认 `candidates` 不包含全部实际影响对象，当前适配器会遗漏其他待生效变更的授权。独立审查还确认，设计中的外层发布协调窗口会与底层发布服务自行取得的同一把锁冲突。**即使只先行 W-A，通用状态机和恢复范围的问题仍需先修订。**

严重性统计：本轮**新增 7 条**——**阻塞 1**（F5-01）、**高 6**（F5-02–F5-07）；另对第 4 轮的 8 条发现做闭合性核验，结论为**引入新问题 1**（Q01）、**部分闭合 3**（Q02、Q03、Q05）、**已闭合 3**（Q04、Q06、Q07）、**部分闭合 1**（Q08）。

> Codex 声明：「已闭合」仅评价设计修订，不代表实现或测试通过；本轮未运行构建、测试、部署或 Git 变更命令，未修改、创建或删除文件。

## 审阅基线与限制

- **被审文档**：L25-16 [Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md) 与 [Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md) 的**第 5 轮所审版本**。按 Codex 第 5 轮的方法说明，其读取范围为 **Spec 1–997 行、Plan 1–375 行**，本报告沿用该基线并保留其 `file:line` 锚点原样。当前工作区内 Spec 已推进至 `v0.8-fifth-review-fixes`、Plan 至 `v0.5-fifth-review-fixes`，两者的行号与第 5 轮锚点**不再一一对应**，故本报告对第 5 轮的文档位置只按章节号与锚点原样引用。
- **审阅方式**：由本机 Codex（`codex-local`，read-only sandbox，approval-policy=never）对两份文档做对抗式设计审阅。
- 本轮**未运行**功能测试、浏览器、real-e2e、构建或服务启动，**未连接**数据库与客户环境；不产生运行证据。
- 本轮**仅创建本报告**，未修改 Spec 与 Plan 正文。
- L25-11 仅作为依赖被核对，不在本次审阅范围；Codex 明确未把 L25-11 的审阅报告纳入核验。
- **核实方式**：MiniMax Code 对 Q01–Q08 与 F5-01–F5-07 逐条回查 `webui/server/` 源码，确认 Codex 的断言与代码事实是否一致；对文档内部一致性的条目（Q04、Q06、Q07、Q08、F5-02）只核对文档现状，不给源码行号。

## 发现的问题

### A. 第 4 轮 Q01–Q08 的闭合性核验

> 「第 4 轮原发现」与「核验结论」两列取自 Codex 第 5 轮原表；**MiniMax Code 独立核实**一列为本轮回查源码后的结论。

#### Q01［阻塞］发布受理不能当作生效成功

**第 4 轮原发现**：发布调用返回即设置全部成员 `ok:true`，未区分受理、索引中、生效成功。

**Codex 第 5 轮核验结论：引入新问题。** 适配器已写 `t.state="pending_activation"`，但同时返回 `ok:false`；通用流程随后执行 `if any(t.result and not t.result.ok)`，把受理中的发布当作运行失败并回滚。源码 `webui/server/semantic-assets.ts:2662-2674,2783-2798` 确认索引异步执行、立即返回受理态。此外，Spec 的「`reindex_failed → 失败`」未处理源码 `semantic-assets.ts:2677-2688` 明确保留已写文件的情形。**修法**：§6.2 先区分受理、确认成功、无残留失败、需恢复，再决定回滚；§6.4 补 release 跟踪与索引失败的残留处置。新增 VOPS-59，断言受理态不回滚、不终结，后续确认才成功。

**MiniMax Code 独立核实：属实；且确为第 4 轮修订引入的回归。** 源码事实链已逐字核实：发布返回 `{ accepted: true, release }`，而 release 的 `status` 为 `"reindexing"`、`activationStatus` 为 `"unconfirmed"`（`webui/server/semantic-assets.ts:2615-2635`）；索引异步启动且不等待（`:2662-2674`），失败时**保留已写文件**、转 `reindex_failed`、activation 仍 `unconfirmed`（`:2677-2689`）；返回点为 `:2796-2799`。因此「适配器用 `ok:false` 表达受理态」确实会被通用编排的 `not t.result.ok` 分支误判为运行失败并回滚——**这是第 4 轮修订在引入 `pending_activation` 时留下的回归，本报告不掩饰该事实**。当前工作区修订稿已针对性处理：结果分类改用 `result.kind` 四分类而非 `result.ok` 二值判定（Spec §4.6），受理态写 `ok: null` 并附「不得写 `ok:false`，否则会被通用编排误判为运行失败并回滚」的显式约束（Spec §6.4 适配器伪代码），并新增 VOPS-59。该修订是否闭合，仍须第 6 轮复审确认。

#### Q02［阻塞］`recovery_required` 不得记 failed 或终结

**第 4 轮原发现**：`recovery_required` 被更新为失败审计并调用终结；Plan 无条件要求失败转 `failed`。

**Codex 第 5 轮核验结论：部分闭合。** 五态表和「不写 failed」分支已补；但两个非终态都直接 `continue`，跳过 `finalizeTarget`，未定义如何把这些状态及 release 关联持久化到 target 记录。operation 仍无条件调用 `finalizeOperation`，没有聚合规则；重入分支只识别 `pending/succeeded`，其他状态落入注释称为「failed」的新 attempt 路径。**修法**：§4.2/§6.2 补五态的持久化转移、operation 聚合表和穷尽式重入分支；非终态只更新进度，保留 pending 审计。新增 VOPS-60。

**MiniMax Code 独立核实：属实。** 代码前提成立：审计状态可被独立改写（`webui/server/admin/audit.ts:835-836` 的 `updateConfigChangeStatus` 接受 `writeStatus`），同键再插会被 `ON CONFLICT(idempotency_key) DO NOTHING` 丢弃（`:802-807`）——因此「非终态必须保留 pending 审计行」与「operation 必须按聚合规则终结」都只能靠设计显式规定，没有存储层兜底。Codex 判断与源码事实一致。当前工作区修订稿已补五态定义与聚合规则、穷尽式重入分派（Spec §4.2、§6.2）与 VOPS-60。

#### Q03［阻塞］计划适配器字段映射错误，应使用 `plan.candidates`

**第 4 轮原发现**：计划适配器使用 `actualImpactSet/groups/perTarget`，未定义来源、转换及通用摘要衔接。

**Codex 第 5 轮核验结论：部分闭合。** 字段确已改为 `plan.candidates`，但「完整影响集」的解释错误。`webui/server/semantic-batch-service.ts:820-828` 分别定义 `candidates`、`unrelatedDiskChanges`、`effectiveTargets`；实际返回也在 `webui/server/semantic-assets.ts:2988-2996` 合并前两者。适配器还读取底层类型没有的 `plan.groups/plan.perTarget`（`semantic-assets.ts:2902-2924`）。**修法**：§6.4 从 `effectiveTargets` 或两类条目的并集解析全部对象，无法解析即拒绝；显式生成通用 `perTarget` 与一个整批原子组。新增 VOPS-61。

**MiniMax Code 独立核实：属实。** 源码为强证据：服务层类型 `SemanticBatchPlan` 只有 `candidates` / `unrelatedDiskChanges` / `overwriteSet` / `dependencies` / `effectiveTargets` 等字段，**没有 `groups`、没有 `perTarget`**（`webui/server/semantic-batch-service.ts:814-829`，返回体见 `:872`）；对外响应类型 `SemanticBatchPlanResponse` 同样只有 `candidates` / `unrelatedDiskChanges` / `overwriteSet` / `effectiveTargets` / `dependencies` / `readonlyDependencies`（`webui/server/semantic-assets.ts:2902-2924`）；且 `effectiveTargets` 实为 `candidates ∪ unrelatedDiskChanges`（`:2988-2996`），其注释在服务层写明「everything the batch would write — candidates plus unrelated disk changes」（`semantic-batch-service.ts:827`）。故「只取 `candidates` 即完整影响集」在源码层不成立，Codex 判断正确。当前工作区修订稿已改用 `effectiveTargets`（Spec §6.4）并新增 VOPS-61。

#### Q04［高］参数集应为原计划子集，再授权仍针对全集

**第 4 轮原发现**：参数全集相等检查先于子集选择。

**Codex 第 5 轮核验结论：已闭合。** 已实际改为 `set(ids(args.targets)).issubset(...)`；再授权对象仍是 `plan.perTarget` 全集，组完整性另行检查。该比较修订正确；恢复分支丢失子集是本轮独立发现 F5-02。

**MiniMax Code 独立核实：属实。** 底层约束支持该改法：同一幂等键绑定不同 planDigest 会抛 `SEMANTIC_IDEMPOTENCY_CONFLICT`（`webui/server/semantic-assets.ts:2195-2215`），因此「子集重放必须复用原计划」是硬约束，而「参数集取子集、再授权仍针对计划全集」是与之相容的唯一口径。Codex 判断与源码事实一致。

#### Q05［高］operation 认领与审计缺少绑定、恢复补建

**第 4 轮原发现**：operation 认领与审计创建分离，未持久化绑定新生成的 `opAuditId`。

**Codex 第 5 轮核验结论：部分闭合。** 首次认领已调用 `bindAuditToOperation`，恢复分支 0 已补。但 `restartAttempt` 后只创建新审计，没有绑定新 `auditId`；「审计已插入、绑定前崩溃」如何查回既有行也未明确。源码 `webui/server/admin/audit.ts:797-826` 确认同键插入会去重，因此补建必须按审计键核对既有行。**修法**：把首次认领和重试统一为可恢复的 claim-and-bind 协议，明确按 `(opKey,attempt)` 查询、补建、绑定；新增 VOPS-62。

**MiniMax Code 独立核实：属实。** 同键插入被去重已核实（`webui/server/admin/audit.ts:802-807` 的 `ON CONFLICT(idempotency_key) DO NOTHING`），按 id 更新的接口为 `updateConfigChangeStatus`（`:835-836`，入参含 `id`），且同键回查在 `:829-832`——即「先按审计键查到既有行、再按 id 收敛」是唯一可落地的补建路径。Codex 的修法要求成立。

#### Q06［高］整组撤销后仍可能保留 `ok:true`

**第 4 轮原发现**：整组撤销完成只改成员状态，保留此前成功结果。

**Codex 第 5 轮核验结论：已闭合。** 回滚确认完成后，全部 claimed 成员均被覆盖为 `{ok:false, code:"ops_group_rolled_back"}`；原失败仅保存在 detail，成功结果不会残留。

**MiniMax Code 独立核实：属实。** 该条的代码前提是「状态与结果可被分别持久化且无存储层约束阻止矛盾组合」（终态与审计独立写入，见 `webui/server/admin/audit.ts:835-836`），因此必须由设计保证统一失败结果；Codex 记录的设计已作此保证，判断成立。

#### Q07［高］`claimed` 为空的组仍执行

**第 4 轮原发现**：`claimed=[]` 时仍调用组执行。

**Codex 第 5 轮核验结论：已闭合。** 已明确 `if claimed is empty: continue`，位于预检与 `executeGroup` 之前；全部 reused/skipped 的组不进入效果执行。

**MiniMax Code 独立核实：属实。** 该保证必须由控制面自己提供：底层发布路径对同一幂等键会返回既有 release（`webui/server/semantic-assets.ts:2195-2220`），而控制面自身的源表导入与连接表批量写入**不共享这层幂等保护**（走 `withKtxYamlWriteLock` 与审计写入路径，见 `webui/server/project.ts:440-451`、`webui/server/index.ts:1817-1818`）。Codex 判断成立。

#### Q08［中］VOPS-51 与 S2/S3 退出条件未同步

**第 4 轮原发现**：Spec 的 VOPS-51 未同步运行失败撤销断言；Plan 的阶段分配与退出条件不一致。

**Codex 第 5 轮核验结论：部分闭合。** S2/S3 的文字已有修订，Plan 追踪表 VOPS-51 也已加入运行失败回滚与恢复态；**Spec 的 VOPS-51 仍只有「不可执行时整组不写」**。另有阶段对应遗漏：追踪表把 VOPS-51 分配给 S4、VOPS-57 给 S6、VOPS-58 给 S3，但这些阶段退出条件未明确列入。**修法**：统一两表 VOPS-51，补上述退出条件；VOPS-23 同时明确排除保留 pending 的两种非终态。

**MiniMax Code 独立核实：部分闭合（属实）。** 截至本报告落盘时的核对：Spec §9 的 VOPS-51 **已补**「组内任一成员明确失败时整组撤销并统一为 `ops_group_rolled_back`」「撤销未完成时整组置 `recovery_required`，不写任何成员终态」两条子断言，Spec 侧已闭合；但 Plan §5 追踪表仍为 VOPS-51 → S2/S4、VOPS-57 → S2/S6、VOPS-58 → S2/S3，而 §4 的 **S4、S6、S3 阶段退出条件仍未列入**这三项，**阶段责任侧仍未闭合**。Codex 判断与文档现状一致。

### B. 第 5 轮新发现 F5-01–F5-07

#### F5-01［阻塞］语义发布的外层协调窗口会与底层自行取锁冲突

**位置（Codex）**：Spec §6.3 的调用树（`withPublishCoordinator → 底层发布链路`）；Plan S5 第 6 项。

**问题**：高层封装的可重入性不能传递给底层低层取锁 API；按当前调用树，正常发布也会被自己的锁拒绝。

**影响**：语义发布通道在实现后自报 busy，无法进入开发。

**Codex 建议修法**：修订 Spec §6.3 与 Plan S5——语义发布由底层独占锁的取得和释放，控制面不再外包同一把锁，并保留其覆盖后台索引的生命周期；或者显式设计所有权移交接口。新增 **VOPS-63**：真实调用链可受理、不会自报 busy，受理后其他写入仍被排除。

**MiniMax Code 独立核实：属实。** 锁的自冲突路径已完整核实：
- 底层发布自行取锁：`webui/server/semantic-assets.ts:1501-1512` 的 `acquirePublishLock` 直接调用 `acquirePublishCoordinatorLock(projectRoot, "batch_import", …)`；
- 低阶取锁 API **不检查重入上下文**：`webui/server/publish-coordinator.ts:239-264`；
- 重入判断**只存在于高层封装**：`webui/server/publish-coordinator.ts:307-310`（`isInsidePublishCoordinator()`）；
- 锁文件为**独占创建**：`webui/server/publish-coordinator.ts:213-226`，`writeFile(..., { flag: "wx" })`，已存在即 `EEXIST → false`；
- 底层取锁失败即抛错：`webui/server/semantic-assets.ts:2244-2255` 抛 `PUBLISH_IN_PROGRESS`（「已有发布批次正在执行」）。

因此控制面若在外层 `withPublishCoordinator` 持有同一把锁，底层取锁必然失败——**「正常发布会被自己的外层锁拒绝」成立**，Codex 判断与源码事实一致。当前工作区修订稿已补规范条款（Spec §4.5 规则 12、§6.4 锁所有权）与缺口项 G23、VOPS-63。

#### F5-02［高］执行子集未绑定 attempt，恢复可能扩大到本次未请求的对象

**位置（Codex）**：Spec §6.2 的认领—组完整性检查顺序、`recoverPending` 调用与恢复范围。

**问题**：原计划含 A/B 两组，本次只提交 A，A 成功后崩溃，恢复规则会继续「其余未终结目标」，但没有持久化范围排除 B；不完整子集还会先占用 operation。

**影响**：恢复可能执行本次未请求的对象；非法子集遗留 pending operation。

**Codex 建议修法**：§6.2 将子集和组完整性检查前移至认领前；每次 attempt 持久化不可变 `execSet/groupIds`，恢复只能处理该范围，并定义尚未执行组对 operation 结果的影响。Plan S2 增加对应责任；新增 **VOPS-64**。

**MiniMax Code 独立核实：属实（文档级）。** 该条的代码前提成立：幂等重放查询刻意置于读快照之前（`webui/server/semantic-assets.ts:2195-2223`），而发布成功后快照被删除（`:2657-2658`），因此恢复必须以**持久化的执行范围**为唯一依据，不能靠运行期重新推导的计划对象；当前缺少 attempt 级不可变范围即会出现 Codex 所述的扩大风险。判断成立（文档内部一致性问题，不附源码行号）。

#### F5-03［高］异常路径绕过组回滚和统一终结

**位置（Codex）**：Spec §6.2 的组执行段与 §4.6 的结果保留合同。

**问题**：流程只处理返回的失败结果，没有处理 `executeGroup`、取锁或审计调用抛异常；后续组会被中断，已完成结果也无法按合同返回。

**影响**：异常中断后无统一收尾，已完成组结果丢失。

**Codex 建议修法**：§6.2 增加逐组异常边界：无效果的 busy/预检异常转稳定失败；可能已写入的异常进入核验/回滚/恢复；审计失败不得继续产生效果。统一收尾须保留前面组的结果。Plan S2/S6 新增 **VOPS-65**。

**MiniMax Code 独立核实：属实。** 异常确实会发生且是既有公开行为：`webui/server/publish-coordinator.ts:319-323` 在窗口被占用时 `throw new PublishCoordinatorBusyError(...)`；底层发布在锁不可得时抛 `PUBLISH_IN_PROGRESS`（`webui/server/semantic-assets.ts:2248-2254`）。既有实现只有 `try/finally` 释放锁（`webui/server/publish-coordinator.ts:326-330`），**没有**任何效果层的异常收敛。因此「照抄当前流程会在异常时中断后续组并丢失前面组结果」成立，Codex 判断与源码事实一致。

#### F5-04［高］旧 Schema 移除入口没有纳入完整临界区，写集超出 `ktx.yaml`

**位置（Codex）**：Spec §4.5/§6.3 与 Plan §3.3/S3 的旧入口接线清单。

**问题**：旧 Schema 移除可以删除 Manifest/Overlay；仅锁住其中的 YAML 配置写入，不能与控制面源表导入互斥。

**影响**：与控制面批量导入并发时，旧入口可能删除正在被导入的文件。

**Codex 建议修法**：补 `removeSchema` 全链改造及 `project.ts` 落点，统一锁内重读、写配置、删文件和恢复；明确控制面是否支持两个删除选项。新增 **VOPS-66**。

**MiniMax Code 独立核实：属实。** 逐项核实通过：路由确实接受 `deleteManifest` 与 `deleteOverlays`（`webui/server/index.ts:1955-1971`）；`removeSchema` 先 `writeKtxYaml`（该调用自带 ktx 锁），**随后在锁外**删除 Manifest/Overlay 文件（`webui/server/project.ts:947-963`）；ktx 锁的作用范围仅覆盖 `writeKtxYaml` 内部（`webui/server/project.ts:445-450`）。即删除动作不在同一临界区内，Codex 判断与源码事实一致。

#### F5-05［高］版本历史的保留数量裁剪未纳入组事务

**位置（Codex）**：Plan S4 的逐目标快照与组回滚要求、Spec §6.3 的组事务边界。

**问题**：直接复用快照函数时，第六个版本会先删除旧快照；后续成员失败，仅恢复索引条目不能找回已删内容。

**影响**：组失败回滚后，早期版本内容不可恢复。

**Codex 建议修法**：组终结前延迟裁剪，或把被裁剪快照及索引前像纳入恢复日志；计划修改文件表补对应接口。新增 **VOPS-67**。

**MiniMax Code 独立核实：属实。** 裁剪行为已核实：版本保留上限为 **5**（`webui/server/table-yaml-history.ts:18`，`TABLE_YAML_VERSION_RETENTION_LIMIT = 5`）；超限时 `pruneVersions` 逐个 `safeRemove(...version.snapshotPath)` 删除旧快照（`:279-294`）；创建快照的顺序为「写新快照 → 更新索引结构 → 裁剪 → 写索引」（`:330-339`）。即第 6 个版本产生时旧快照**先被删除**，再谈组回滚已来不及，Codex 判断与源码事实一致。

#### F5-06［高］`scope → check → validationId → plan` 缺少实际转换步骤

**位置（Codex）**：Spec §6.4 的候选来源说明、Plan S5 的实现步骤。

**问题**：当前独立批量 check 产出校验任务，不产出发布所需的 staged snapshot，不能直接把其结果当作 `validationId` 接入计划接口。

**影响**：语义 preview 无法产出可读、可被 publish 消费的计划。

**Codex 建议修法**：§6.4 明确候选来源及真实服务调用链：消费已有 staged validation，或构造受控候选并创建批量 snapshot；区分 taskId 与 validationId，明确等待校验终态及失败处理。Plan S5 补实现步骤，新增 **VOPS-68**。

**MiniMax Code 独立核实：属实。** 转换缺口已完整核实：批量 check 路由启动后台任务并返回 `{ operationId: taskId, taskId, scopeId, status: "queued", … }`，**没有 validationId**（`webui/server/semantic-batch-routes.ts:299-334`）；任务结构 `SemanticBatchTask` 也**不含 validationId 字段**（`webui/server/semantic-batch-tasks.ts:59-79`）；而读计划强制要求快照带 `batch` 段，否则抛 `VALIDATION_SNAPSHOT_NOT_FOUND`（`webui/server/semantic-assets.ts:2931-2939`），批量快照由 `persistSemanticBatchSnapshot` 另行创建（`:1096` 起）。即「check 的返回可直接当 validationId」在源码层无对应产出物，必须有显式转换步骤，Codex 判断与源码事实一致。

#### F5-07［高］计划过期与幂等重放的优先级合同冲突

**位置（Codex）**：Spec §4.2/§6.2 的过期与重放条款、Plan S2/S5 的顺序要求。

**问题**：一处要求过期拒绝，一处要求只有未执行对象检查计划有效性；通用流程又必须先加载计划才能复用成功结果。

**影响**：计划过期后的成功重放不可达；底层既有顺序被设计改写。

**Codex 建议修法**：§4.2/§6.2 与 Plan S2/S5 统一为：先定位受信主体绑定的 operation，使用其持久化计划对象重新授权，再复用/恢复；计划 TTL 只限制尚未发生的新执行，不删除恢复依据。新增 **VOPS-69**。

**MiniMax Code 独立核实：属实。** 底层顺序已核实：发布对同一幂等键的既有 release 查询**刻意置于读取快照之前**（`webui/server/semantic-assets.ts:2195-2223`，命中即返回既有 release），而成功受理后快照被删除（`:2657-2658`）——因此「先加载计划再查幂等」会把原本可用的重放变成「快照不存在」。设计若不与底层顺序对齐，重放能力即被破坏，Codex 判断与源码事实一致。

## 处置台账

### 第 4 轮 8 条发现的闭合性核验总表（Codex 第 5 轮原表 + MiniMax Code 核实）

| 编号 | 第 4 轮原发现 | 第 5 轮核验结论 | MiniMax Code 独立核实 |
|---|---|---|---|
| Q01 | 发布受理不能当作生效成功 | **引入新问题**（第 4 轮修订引入的回归） | **属实**（源码事实链完整；当前修订稿已改为 `result.kind` 四分类 + `ok: null`） |
| Q02 | `recovery_required` 不得记 failed 或终结 | **部分闭合** | **属实**（审计可被独立改写、无存储层兜底：`admin/audit.ts:835-836`、`:802-807`） |
| Q03 | 计划适配器字段映射错误，应使用 `plan.candidates` | **部分闭合** | **属实**（底层无 `groups`/`perTarget`：`semantic-batch-service.ts:814-829`、`semantic-assets.ts:2902-2924`） |
| Q04 | 参数集应为原计划子集，再授权仍针对全集 | **已闭合** | **属实**（同键异计划必冲突：`semantic-assets.ts:2195-2215`） |
| Q05 | operation 认领与审计缺少绑定、恢复补建 | **部分闭合** | **属实**（同键插入去重 + 按 id 更新需先查行：`admin/audit.ts:802-807`、`:829-836`） |
| Q06 | 整组撤销后仍可能保留 `ok:true` | **已闭合** | **属实**（无存储层约束阻止矛盾组合，须由设计保证） |
| Q07 | `claimed` 为空的组仍执行 | **已闭合** | **属实**（控制面自写路径无底层幂等保护：`project.ts:440-451`、`index.ts:1817-1818`） |
| Q08 | VOPS-51 与 S2/S3 退出条件未同步 | **部分闭合** | **部分闭合属实**（Spec 侧子断言已补；S3/S4/S6 退出条件仍未列入对应验收项） |

### 第 5 轮新发现的落点与当前状态

| 编号 | 严重性 | 修订落点（Spec／Plan／验收） | 截至本报告落盘时的状态 |
|---|---|---|---|
| F5-01 | 阻塞 | Spec §4.5 规则 12、§6.3/§6.4 锁所有权；缺口 G23；验收 VOPS-63 | 已写入当前修订稿；**是否闭合须第 6 轮复审确认** |
| F5-02 | 高 | Spec §6.2 认领前子集与组完整性校验、attempt 级不可变执行范围；缺口 G24；验收 VOPS-64 | 已写入当前修订稿；**须第 6 轮复审确认** |
| F5-03 | 高 | Spec §6.2 逐组异常边界与统一收尾；验收 VOPS-65 | 已写入当前修订稿；**须第 6 轮复审确认** |
| F5-04 | 高 | Spec §4.5/§6.3 与 Plan §3.3/S3 的 `removeSchema` 全链改造；验收 VOPS-66 | 已写入当前修订稿；**须第 6 轮复审确认** |
| F5-05 | 高 | Spec §6.3 与 Plan S4 的延迟裁剪或恢复日志；验收 VOPS-67 | 已写入当前修订稿；**须第 6 轮复审确认** |
| F5-06 | 高 | Spec §6.4 的候选来源与转换步骤；Plan S5 实现步骤；验收 VOPS-68 | 已写入当前修订稿；**须第 6 轮复审确认** |
| F5-07 | 高 | Spec §4.2/§6.2 与 Plan S2/S5 的过期与重放优先级统一；验收 VOPS-69 | 已写入当前修订稿；**须第 6 轮复审确认** |

### 仍需 PM / 客户拍板的开放项（Codex 第 5 轮原文要点）

| 开放项 | Codex 说明 | 阻塞性 |
|---|---|---|
| **D7 的实际原子组范围** | Spec 的决策台账仍写「同 Schema」，实际合同已包括跨 Schema 共享 Overlay；连接配置又要求整批合并写。技术审阅可以指出物理约束，但不能替 PM 接受对「部分成功可重放」的产品范围收窄。应按最终实际写集确认 D7 | **阻塞**：Plan S0 明确要求确认后开工 |
| 客户是否接受当前首期对象范围、仅 MCP 入口及两段式调用 | Spec §8.1 仍列为客户确认项；仓库中的需求转述不能替代客户确认记录 | 不单独阻塞当前既定范围的设计修订；**客户范围签核尚无法核实** |
| D6：后续期工具清单是否保留 | 属产品范围选择 | **不阻塞 W-A 首期开发** |

### 第 5 轮判定之后仍未闭合的项

- **4 项阻塞**：Q01（受理态回滚回归）、Q02（非终态持久化与 operation 聚合）、Q03（完整影响集字段口径）、F5-01（发布锁所有权自冲突）——按 Codex 判定均为**不可交付开发**的前置项。
- **阶段责任漂移**：Q08 的 S3/S4/S6 退出条件遗漏在第 5 轮结束时仍未闭合。
- **本报告不判定第 6 轮结果**：当前工作区修订稿已吸收第 5 轮的修订要求（Spec 已至 `v0.8-fifth-review-fixes`，缺口扩至 G1–G29、验收扩至 VOPS-01–69；Plan 已至 `v0.5-fifth-review-fixes` 并收录 VOPS-59–69 的阶段映射），**但「吸收」不等于「闭合」**，闭合与否须由下一轮审阅给出结论。

## 关联文档

- 被审 Spec：[L25-16 运维控制面 MCP（lucy_ops）Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)
- 被审 Plan：[L25-16 实施 Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)
- 第 1 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane.md](2026-10-28-codex-review-lucy-ops-control-plane.md)
- 第 2 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round2.md](2026-10-28-codex-review-lucy-ops-control-plane-round2.md)
- 第 3 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round3.md](2026-10-28-codex-review-lucy-ops-control-plane-round3.md)
- 第 4 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round4.md](2026-10-28-codex-review-lucy-ops-control-plane-round4.md)

## 本轮审阅交付的实际范围

本报告是第 5 轮 Codex 审阅结论的落盘件，**未修改 Spec 与 Plan 正文**，未修改任何运行代码、测试、运行配置、客户资产、数据库、镜像或部署，**未执行任何功能验证、浏览器验证、UAT、real-e2e 或发布**。本批文档产出**不构成实现授权**，也不产生验收证据；VOPS- 验收项状态不因本报告自动上调。第 5 轮的交付判定为**不可交付开发**，该判定在本报告落盘时**仍然有效**。
