# Lucy v0.25 L25-16 运维控制面 MCP（lucy_ops）独立审阅

## 结论：退回修订

PM 授权的设计审阅，日期为 2026-10-28（Asia/Shanghai）。审阅范围为 L25-16 的 Spec 与 Plan 两份设计文档；发现 **2 项阻塞、11 项高、2 项中、1 项低**，另有审阅方补充发现 3 项。结论为**退回修订**：当前设计尚不足以作为实施基线。

该结论不撤销 D1–D5 五项已拍板决策，也不建议改变首期范围与「首期拆两个工作流」的处置。这些决策本身经审阅认为成立；退回针对的是**合同细节与代码事实的对应关系**，其中 6 项属设计文档自身写错，7 项属对既有代码的实际行为描述有误或遗漏。

### 审阅基线与限制

- 设计：[Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)（v0.3-decisions-closed）、[Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)（v0.1-draft）；章节、行号均以本次读取版本为准。
- 审阅方式：**由本机 Codex（`codex-local`，read-only sandbox，approval-policy=never）对两份文档做对抗式设计审阅**；MiniMax Code 随后对全部 16 条发现逐条回查源码独立核实，并在本报告中标注核实结论与证据。
- 依据：[开发治理](../governance/DEVELOPMENT.md)、生产调用链、既有静态检查与安全缺陷台账。
- 本轮**没有运行**功能测试、浏览器、real-e2e、构建或服务启动，没有连接数据库与客户环境；不新增运行证据。审阅对象是设计合同及其与源码的对应关系，不是实现。
- 本轮**仅创建本报告并更新 `docs/README.md` 索引**。Spec 与 Plan 正文**未修改**，VOPS-01–VOPS-30 状态仍全部为「未执行」。
- L25-11 仅作为依赖被核对（当前状态、发布与幂等合同），其历史 Spec 与既有审阅报告不在本次审阅范围。

---

## 发现的问题

> 每条含：问题、影响、最小修复建议、**核实结论**。核实结论由审阅方回查源码得出，标注了具体 `file:line` 证据。

### R01［阻塞］提交可执行未经当前授权核对的对象

**位置**：Spec §6.1（授权判定）、§6.2（commit 段）

授权检查针对调用方提交的 `args.targets`，执行针对加载后的 `plan.perTarget`；二者之间没有一致性检查，commit 段未对计划内对象重新鉴权，也未把工具名与调用方确认的摘要绑定。

**影响**：同一 Agent 原有 B 目标权限、事后只剩 A 权限时，可用 `args.targets=A` 提交旧的 B 计划。计划 actor 检查与基线检查都不能替代授权检查。

**修复建议**：commit 加载计划后，以计划内工具、动作与全部对象重新鉴权；比对调用方确认摘要，拒绝参数与计划不一致。最终授权复核与正式效果置于同一临界区。

**核实结论：属实。** Spec §6.2 的 commit 段（`plan = load(planId)` 起）依次只做 plan 过期、digest、actor、blockers 与基线检查，**无任何按 `plan.perTarget` 的重新授权分支**。

### R02［阻塞］ktx.yaml 分支在实际写入前即记录成功

**位置**：Spec §6.2（执行段）

ktx.yaml 分支只缓存补丁，随后立即写 target 级 `committed` 审计并提交幂等结果，最后才 `flushKtxYaml(buffer)`；该 flush 位于逐目标异常处理之外。该顺序也遗漏了 §4.5 要求的 catalog 重载与策略提交。

**影响**：写盘失败或进程在 flush 前退出会留下「已成功」的目标记录；重放可能直接复用成功结果，而配置从未生效。

**修复建议**：缓存阶段只记 prepared/pending；合并写与运行时确认完成后才终结目标与幂等状态；为 flush、激活、审计失败明确恢复分支。

**核实结论：属实。** Spec §6.2 中 `writeAudit(target_level, ..., writeStatus="committed")` 与 `commitIdempotency(...)` 位于 `flushKtxYaml(buffer)` **之前**，且 flush 行在逐目标 try/except 之外；全段无 catalog 重载与策略提交步骤。

### R03［高］grant 可被跨条拼接

**位置**：Spec §3.2.2 规则 3、§6.1

域约束只要求**某一条** grant 满足，而连接范围却从**全部**同名工具 grant 取并集，未限定为同一条完整满足条件的 grant。

**影响**：不满足域条件的 grant 仍能贡献连接范围，违反「逐条匹配、任一条满足」的合同与 fail-closed 要求。

**修复建议**：对每个对象判断是否存在**一条**完整满足工具、域、连接条件的 grant；运行时拒绝损坏 grant，不依赖离线 lint 才能保证安全。

**核实结论：属实。** Spec §6.1 中域判定为「任一 matched grant 的 `asset_kinds` 覆盖工具域」，连接却取「全部 matched grant 中带 `connections` 者的并集」，两者不同源。

### R04［高］委托的签发与凭据管理没有权限边界

**位置**：Spec §3.2.2 规则 7、§6.1；Plan §3.3、§4 S1

设计只验证被指向的管理员是 enabled owner，但**委托本身的创建、变更、撤销**，以及相关角色赋权、Agent 修改与 Token 签发，没有 owner 门禁。

**影响**：普通 operator 可通过为已有 owner 委托的 Agent 签发 Token，或经未受限制的委托/角色变更取得 owner-only 能力。首期不开放 owner-only 工具不能补齐该授权模型。

**修复建议**：明确委托创建、变更、撤销与角色赋权、Agent 修改、Token 签发的 owner 门禁；把相关入口纳入 Plan 与负向验收。

**核实结论：属实。** `webui/server/admin/tokens.ts` 全文**无 `requireOwner`** 调用；`:408` 注释为「Generate token — plaintext never written anywhere except the HTTP response」，`:452` 返回 `token: plainToken`。

### R05［高］语义发布包装没有消费已预览的计划

**位置**：Spec §4.1、§6.3；Plan §4 S5

包装流程在一次调用内重新 scope→check→plan→publish，没有消费先前 preview 的计划与调用方确认摘要。

**影响**：该工具可凭新算出的计划直接发布，「整批阻断例外」被错误地扩张为「两段式例外」。

**修复建议**：分开定义 semantic preview 与 commit；commit 只能消费已预览的 validation/plan 与确认摘要，不能现场生成确认依据后直接发布。

**核实结论：属实。** `webui/server/semantic-assets.ts:2266-2290`：批量发布在发布窗口内重建计划并与 `request.planDigest` 比对，缺 planDigest 时抛 `SEMANTIC_PLAN_DIGEST_MISMATCH`（「批量发布必须携带预览时的 planDigest。」）。Spec §6.3 未携带 planDigest，与 §4.1 的两段式承诺自相矛盾。

### R06［高］控制面与既有 MCP 入口的分流合同不完整

**位置**：Spec §6.1；Plan §3.3

实际调用先走 `aclCheck`；既有 helper 将非 DataPlane/Meta 工具判为未分类，发现路径读取数据面权限，且对 `lucy_*` 前缀要求数据能力。新伪代码又没有全局 `deny_tools` 检查。

**影响**：保留旧链路则纯运维 Agent 无法发现或调用工具；直接绕开旧链路则可能遗漏全局禁用门禁。

**修复建议**：明确 `tools/list`、`tools/call` 的控制面分支与顺序；同步更新 helper、默认注册集合与发现逻辑；控制面独立判权但仍执行全局 deny。

**核实结论：属实，三处均可验证。**
(a) `webui/server/proxy/acl.ts:118-121`：`absoluteDenyOrUnclassifiedReason` 对非 DataPlane/Meta 返回 `tool_unclassified`；`allowedToolNames`（`:2259`）据此过滤 → 新工具不会进入 `tools/list`。
(b) `acl.ts:2264-2266`：`tool.startsWith("lucy_")` 要求 `wildcardTables || capabilities.length > 0` → `lucy_ops_*` 会命中数据面能力门槛，纯运维 Agent 看不到该工具。
(c) 全局 `deny_tools` 检查位于 `acl.ts:2902-2904`，Spec §6.1 无对应分支。

### R07［高］基线检查在锁外，且遗漏真实的 ktx.yaml 写锁

**位置**：Spec §4.5、§6.2；Plan §4 S3

显示写屏障只是计数与代际管理，并非写互斥；既有配置写使用另一把 `withKtxYamlWriteLock`，新建连接也使用它。

**影响**：同一进程中批量操作与既有连接写入口仍可交错；一次合并写不能防止覆盖检查之后出现的新改动。

**修复建议**：把重读、基线比较、补丁生成与写入放进同一配置写锁；统一相关旧入口的互斥范围；明确锁顺序与非重入调用方式。

**核实结论：属实。** `webui/server/ktx-yaml-write-lock.ts` 提供进程内队列式真锁 `withKtxYamlWriteLock`（注释自述「Single-process only」）；`webui/server/project.ts:445-452` 的既有顺序为 `withKtxYamlWriteLock → withDisplayWriteBarrier → 写`。`webui/server/display-generation.ts:72-95` 仅维护计数与代际，**不提供互斥**。Spec §4.5 与 §6.2 既未取 ktx 锁，嵌套顺序也与既有实现相反。

### R08［高］幂等意图未先于正式效果持久化

**位置**：Spec §4.2、§6.2；Plan §4 S2

正文要求幂等意图先于正式效果持久化，但伪代码只有先查询，执行后才提交幂等；查询还在锁外，没有 pending 键占用或重启恢复分支。

**影响**：目标写完、结果持久化前崩溃，重试无法判断副作用是否发生；并发同键请求也没有原子认领依据。

**修复建议**：在临界区内原子认领持久化的 operation/target 意图，绑定操作者、工具与计划；定义 pending 的恢复、核验与终结规则。

**核实结论：属实。** Spec §6.2 中 `lookupIdempotency` 出现在执行之前、`commitIdempotency` 出现在执行之后，两者之间是真实写入；无任何 pending 认领动作，且 §6.2 的幂等查询在 `withDisplayWriteBarrier` 之外。

### R09［高］重放查询晚于基线检查，幂等复用分支不可达

**位置**：Spec §4.2、§4.3、§6.2；Plan §4 S2

重放查询晚于计划过期与全部目标基线检查。成功目标已经改变自身基线，因此原请求重试会先在 `ops_target_conflict` 退出，到不了复用成功结果的分支。

**影响**：「同键复用结果」与「部分成功可重放」按当前顺序无法成立；计划过期后也无法靠已保存结果重放原提交。

**修复建议**：先定位并验证已有幂等操作，对已完成目标返回原结果；只对尚未执行的目标检查基线与计划有效性；明确子集重放的身份与摘要算法。

**核实结论：属实。** Spec §6.2 中基线检查循环位于幂等复用循环**之前**；成功目标写盘后其 `currentBaselineDigest` 已不等于预览时的 `baselineDigest`，原请求重试必然先命中 `ops_target_conflict`。

### R10［高］业务幂等键与审计事件键混用

**位置**：Spec §4.2、§4.3、§6.2；Plan §4 S2

配置审计表对同键执行 `ON CONFLICT ... DO NOTHING`，因此失败后用同一 `target_key` 不能追加成功行。此外执行循环没有重新计算 `targetKey`，引用的是前一循环变量。

**影响**：重放成功审计被去重，或多个目标串用同一审计键；无法满足「不覆盖失败痕迹」与 N 条目标审计。

**修复建议**：区分稳定的业务幂等键与含 attempt/event 身份的审计键；逐目标保存自己的 key；状态更新使用明确 auditId，重放另建审计事件。

**核实结论：属实。** `webui/server/admin/audit.ts:802` 为 `ON CONFLICT(idempotency_key) DO NOTHING` → 同键第二行不会落库，Spec §4.3「重放成功追加 target 级审计」在现有表结构下不可实现。另 Spec §6.2 的 `targetKey` 在前一个循环内计算，执行循环直接引用，循环结束后取到的是**最后一个**目标的键。

### R11［高］「逐目标隔离文件集合」不符合实际文件模型

**位置**：Spec §4.5、§7.2；Plan §4 S4

导入按 Schema 读取 Manifest，再替换其中一张表并返回整个文件内容；同 Schema 多表共享文件。计划允许「半写后标 pending」，却没有恢复前的读写门禁与恢复算法。

**影响**：无法证明失败目标不影响成功目标；整文件回滚、共享文件补丁与进程中断的处理均悬空，「标 pending」不等于无半写。

**修复建议**：定义共享 Manifest 的合并与目标级撤销规则，把快照与版本索引纳入恢复范围；明确恢复完成前哪些读写被阻断；补同 Schema 多表失败验收。

**核实结论：属实。** `webui/server/semantic-layer.ts:862-897`：按 `schemaRelPath(conn, schema)` 读取**整份 schema YAML**，取出 `tables` map，用 `doc.setIn(["tables", table], ...)` 改动单表后 `serialize(doc)` 输出**整份文件**。同 Schema 的多张表因此共享同一 Manifest 文件。

### R12［高］access schema 的副本不止两份，正式角色保存路径会拒绝 `allow.ops`

**位置**：Spec §5 G3；Plan §3.3、§4 S1

角色路由实际导入的是 `admin/access-config.ts` 中的类型；该文件另有 `YamlUser/YamlRole/YamlAccessConfig`。角色校验明确拒绝 `allow` 下的未知键，规范化输出也只保留旧字段。两个文件均未列入修改清单。

**影响**：按 Plan 仅改代理侧与管理侧类型后，正式角色保存仍无法接受控制面授权，管理侧类型与规范化链路也不完整。

**修复建议**：补入 `admin/access-config.ts`、`admin/roles.ts` 及对应保存/预览回归，统一 schema 与授权字段的保留、验证语义。

**核实结论：属实。** `webui/server/admin/access-config.ts:48,92,103` 确有第三份 `YamlUser`/`YamlRole`/`YamlAccessConfig`；`webui/server/admin/roles.ts:18-34` 从该文件导入类型；`roles.ts:498-502` 对 `allow` 的键做白名单校验，**不在 `connections`/`tableSelectors`/`tools`/`source_scope` 之列的键一律拒绝** → `allow.ops` 会被正式角色保存路径拒绝。

### R13［高］仅扩展总审计枚举不能修正复用服务的归因

**位置**：Spec §5 G2；Plan §3.3、§4 S5

实际发布服务只接收 `actor` 字符串，内部审计硬编码 `actorType:"ui_admin"` 与 `source:"publish_workbench_api"`；相关服务审计模块与前端类型也保留封闭枚举，未列入计划。

**影响**：包装层增加正确审计后，底层仍可能留下错误来源记录，不满足 VOPS-22 的「不落成 ui_admin」。

**修复建议**：让复用服务接收并贯穿受信操作者上下文；同步服务审计、相关类型与展示映射，明确底层审计与 operation/target 审计的关联及计数范围。

**核实结论：属实。** `webui/server/semantic-assets.ts:2637-2644`：`recordConfigChange({ ..., actorType: "ui_admin", source: "publish_workbench_api", ... })` 为**硬编码字面量**。

### R14［中］版本 restore 被误当作正式写入口

**位置**：Spec §2.4、§3.3；Plan §2 S0、§4 S4

源码中的 restore 只读取版本并返回 YAML 草稿，不落盘；WebUI 随后调用 import 才保存。

**影响**：直接包装 restore 会报告执行成功却没有恢复落盘；版本快照与恢复归因也可能漏接。

**修复建议**：将 restore 定义为「读取指定版本候选 → 预检 → 确认后走 import 写服务」，明确 `restoredFromVersionId`、校验与快照步骤。

**核实结论：属实。** `webui/server/index.ts:1020-1026` 的 restore 路由只调用 `restoreTableYamlVersionDraft`（`webui/server/table-yaml-history.ts:412-426`），返回 `{ key, restoredFromVersionId, rawYaml, diff }`，**无任何写操作**。

### R15［中］「ktx.yaml 是全部连接配置的唯一载体」已不成立

**位置**：Spec §2.4、§7.2；Plan §4 S3

源码另有 `webui/config/hive-connections.yaml`，统一连接视图合并 KTX 与 Hive 两种来源。设计未限定首期的连接来源。

**影响**：对「批量连接表配置」的支持范围产生歧义；不能把所有连接都交给 ktx.yaml 补丁器处理。

**修复建议**：明确首期仅支持哪些 connection origin；不支持的来源在 preview 时给稳定拒绝码。

**核实结论：属实。** `webui/server/hive/config.ts:31-32`：`HIVE_CONNECTIONS_REL_PATH = "webui/config/hive-connections.yaml"`。

### R16［低］两处基线说明不准确

**位置**：Spec §2.4、§5 G6

`semantic-assets.ts:2617-2618` 是 release 的 id/createdAt，`assetKind:"publish"` 实际在 `:2640`；「不扩展用量分类，新工具调用量就消失」也不符合现有兜底。

**影响**：引用无法逐字支持结论，并可能引导不必要的统计分类改动。

**修复建议**：修正行号；把 G6 改为验证现有计量与嵌套 targets 的评测分类是否适用，而非声称默认不计数。

**核实结论：属实。** `webui/server/proxy/usage-classification.ts:130-138`：`classifyUsage` 对非协议、非评测探针的行返回 `default_usage` → 新工具**不会**凭空消失。

---

## 补充发现（审阅方，非 Codex 列出）

以下 3 条为审阅方在回查 Codex 发现时另行发现，Codex 未列为独立条目。

### S01［中］Spec 伪代码使用了不存在的协调器 API，且语义描述错误

**位置**：Spec §6.2

伪代码写作 `withPublishCoordinatorLock(holder, ...)`，该函数不存在。真实入口为 `withPublishCoordinator(kind, fn, options)`，且它**可重入**（`isInsidePublishCoordinator()`），窗口被占用时**抛 `PublishCoordinatorBusyError` 而不是排队等待**。

**影响**：实现者照抄会写错调用；「占用即抛错」与「排队」两种语义会导致不同的重试策略设计。

**修复建议**：改用真实签名，并在 §4.5 明确控制面在窗口被占用时的处置（拒绝并返回 busy 原因码，不自旋重试）。

**核实结论：属实。** `webui/server/publish-coordinator.ts:302` 为 `withPublishCoordinator`；`:308-311` 为重入分支；`:322-326` 占用时抛错。

### S02［中］未写明 `role` 与 `roles` 同时声明会被解析拒绝

**位置**：Spec §3.2.2 规则 3

设计只写「多角色取并集」，未写 `role` 与 `roles` 同时非空时角色解析直接失败。

**影响**：配置侧误填（同时写 `role` 与 `roles`）会导致该 Agent 的全部权限解析失败，表现为「工具不可见」而非配置报错，排查成本高。

**修复建议**：在 §3.2.2 补一条：多角色只经 `roles` 表达；`role` 与 `roles` 同时非空时按 `role_resolution_failed` 拒绝，并要求管理侧保存时给出明确校验错误。

**核实结论：属实。** `webui/server/proxy/acl.ts:1469-1471`：`role` 与 `roles` 同时非空 → `role_resolution_failed:role_and_roles`。

### S03［低］`schema_remove` 的审计 `targetId` 形式未记录

**位置**：Spec §2.4

表中只记了 `changeType`，未记 `targetId`。

**影响**：批量目标标识设计需要知道审计侧的实际键形态。

**修复建议**：补记 `targetId` 为 `${connId}:${schema}`。

**核实结论：属实。** `webui/server/project.ts:967`：`targetId: \`${connId}:${schema}\``。

---

## 逐项核查结果

| 方向 | 结论 | 说明 |
|---|---|---|
| A. 事实核对 | 有问题（R12–R16、S01–S03） | 工具分类、身份解析、dryRun、审计字段等主要引用成立；schema 副本数量、restore 写语义、连接配置载体、协调器 API 名与部分行号不成立 |
| B. 安全 | 有问题（R01、R03–R06） | 计划对象再授权、完整 grant 匹配、委托签发边界、既有 MCP 门禁接线均需补齐 |
| C. 数据丢失与并发 | 有问题（R02、R07–R11） | 合并写不等于互斥；幂等、审计与实际效果的先后顺序存在明确冲突 |
| D. 依赖与顺序 | 通过 | W-B 受 L25-11 退回状态约束与仓库事实一致；W-A / W-B 分别有阶段退出条件。Plan §6.2 的全量验收应理解为完整首期，不得由 W-A 完成替代 |
| E. Plan 完整性 | 有问题（R04、R07、R12–R14） | 缺真实角色配置链路、配置写锁与受信操作者贯穿等必要落点 |
| F. 仓库治理一致性 | 通过 | 已有固定伪代码与 Terminology Compliance 小节；授权边界与状态分离明确；VOPS- 前缀未被冒充为冻结安全目录中的 `verifiedBy` ID |
| G. 需求覆盖 | 无法核实 | 三个首期工具族与已拍板决策一致；客户是否另需巡检、角色/Token 治理及 HTTP 入口，缺原始确认记录（Spec §8.1 仍列为待确认） |

---

## 已核实无误的引用

以下引用由审阅方实际打开并确认，可作为下游复核的既证基线：

- `webui/server/auth/guard.ts:73-118,140-160`：管理会话鉴权与 owner 分级确实存在；全局 hook 注册于 `webui/server/index.ts:748`。
- `webui/server/proxy/identity.ts:45-69,302-354`：现有角色/用户结构、Bearer 匹配、吊销与过期检查与 Spec 引用基本一致。
- `webui/server/proxy/acl.ts:54,110-114`：工具分类确为三态，未分类工具默认 `AbsoluteDeny`。
- `webui/server/proxy/acl.ts:1463-1477`：`role`/`roles` 解析规则（含 R16/S02 所述拒绝分支）。
- `webui/server/proxy/mcp-proxy.ts:1160-1175`：13 个固定本地工具 + 条件注册的 `lucy_begin_question`。
- `webui/server/admin/mcp-tools.ts:13-38`：硬编码候选工具清单共 24 项。
- `scripts/lint-spec.mjs:295-329`：禁止角色 `allow.tools` 使用 `*`，并检查绝对拒绝与未分类工具。
- `webui/server/index.ts:929-959,1782-1827`：source import 与 enabled-tables 均默认 dryRun；后者使用显示写屏障与 `governance` 域审计。
- `webui/server/project.ts:947-973`：Schema 移除确实修改 ktx.yaml，`changeType` 为 `schema_remove`，`targetId` 为 `${connId}:${schema}`。
- `webui/server/admin/audit.ts:278-280,749-767,802`：资产域、操作者类型、写状态、审计输入字段与 `ON CONFLICT(idempotency_key) DO NOTHING` 均存在。
- `webui/server/admin/config-audit-write.ts:272-314`：`auditedWriteFile` 支持 intent 与 `requireIntent`。
- `webui/server/publish-coordinator.ts:302-329`：真实入口为 `withPublishCoordinator`，支持异步上下文内重入，占用时抛 busy，不排队等待。
- `webui/server/display-generation.ts:18,72-95`：显示 scope 与写屏障存在，但屏障本身不提供写互斥。
- `webui/server/ktx-yaml-write-lock.ts`：`withKtxYamlWriteLock` 是 ktx.yaml 的真实写锁（进程内队列，单进程）。
- `webui/server/wiki-access-batch.ts:53`、`webui/server/index.ts:1355,1377,1400`：Wiki 批量上限 100，具备 preview、commit 与结果查询入口。
- `docs/README.md:53`、L25-11 Spec §1.3、独立审阅报告「结论」节：L25-11 当前退回、Wave 0b 未解锁、`blocked_delivery` 的判断有据；只读 `git log` 确认 Spec §7.1 所列三个提交的时间顺序。
- `docs/governance/DEVELOPMENT.md:24-31,61-64,93-110,127-140`：Plan Mode、文档落位、核心流程与术语小节要求与本次核查依据一致。
- `scripts/e2e/__tests__/case-catalog.test.mjs:113`、`scripts/e2e/verify-evidence.mjs:493-497`：安全缺陷 `verifiedBy` 必须属于冻结目录并具本次 release 的通过证据；独立 VOPS 编号不能直接替代。

---

## 未核实项

- 未执行测试、构建、服务启动、故障注入或客户环境验证；因此并发交错、崩溃恢复与真实 Agent 调用没有新增运行证据。本报告评价的是设计合同及其与源码的对应关系。
- 未核实客户口头需求的完整原始记录；待审文件的转述不足以证明三个首期工具覆盖客户全部运维诉求。
- 新控制面文件均为计划项，无法验证未来实现是否会自行补齐上述遗漏；**不得以「实现时可能会补」视为设计已经闭合**。
- L25-11 仅核对被本设计引用的发布、幂等、审计合同与当前状态，未重新审阅其历史 Spec 或既有审阅报告的内容质量。
- 未检查私有 access/admins/连接配置与客户实际授权，不判断现网是否已存在特定误配或越权实例。

---

## 复审准入建议

1. **先修阻塞项，再谈其他。** R01（commit 再授权）与 R02（ktx 写入与成功记录顺序）必须先修，并同步改写 §6.1 与 §6.2 的伪代码。修复后的伪代码须能逐行读出「授权 → 意图认领 → 执行 → 效果确认 → 终结审计」的先后关系。
2. **把代码事实错误一次性改净。** R05、R07、R11、R12、R13、R14、R15、R16、S01、S02、S03 均为可逐字核对的事实性偏差，建议在 Spec 升版时一并修订，并复核 Spec 内所有 `file:line` 引用。
3. **补齐 Plan 的文件落点。** R12（`admin/access-config.ts` + `admin/roles.ts`）、R13（服务审计与前端类型）、R07（`ktx-yaml-write-lock.ts` 纳入互斥范围）、R04（Token 签发路径纳入 owner 门禁与负向验收）四组落点必须写进 §3.3 与对应阶段，否则 S1 的退出条件无法达成。
4. **重排 §4.5 的锁顺序。** 以既有 `withKtxYamlWriteLock → withDisplayWriteBarrier → 写` 为准，明确控制面批量在同一把锁内完成重读、基线比较、补丁生成与写入，并写明协调窗口与配置写锁的嵌套次序与不可重入点。
5. **把幂等与审计键拆成两层。** 业务幂等键（operation/target 维度，跨重放稳定）与审计事件键（含 attempt/event 身份）必须分开定义，否则 §4.3 的「追加失败痕迹之外的成功记录」在 `ON CONFLICT(idempotency_key) DO NOTHING` 下无法实现。
6. **明确首期连接来源与 restore 语义。** R15 与 R14 需要在 §2.4 与 §4.5 落成明确边界：哪些 connection origin 属首期支持范围、restore 为何必须走 import 写服务。
7. **补委派与 Token 的负向验收。** 在 §9 增补委托签发/撤销、operator 越权签发 Token、委托指向已停用管理员等断言，并补同 Schema 多表失败（共享 Manifest）的验收场景。
8. **保持证据与状态分离。** 本报告不构成需求审查签核、UAT、real-e2e、客户验收或发布批准；VOPS-01–VOPS-30 继续保持「未执行」，Spec 与 Plan 的状态不得因本报告自动上调。

---

## 本次审阅交付的实际范围

本轮由本机 Codex 以只读方式对 L25-16 的 Spec 与 Plan 做对抗式设计审阅，MiniMax Code 对全部 16 条 Codex 发现加 3 条补充发现逐条回查源码核实后形成本报告。**未修改 Spec 与 Plan 正文，未修改任何运行代码、测试、运行配置、客户资产、数据库、镜像或部署，未执行任何功能验证、浏览器验证、UAT、real-e2e 或发布。** 本报告不产生验收证据。
