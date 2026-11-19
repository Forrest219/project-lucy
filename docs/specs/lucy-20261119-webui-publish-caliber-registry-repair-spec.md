# 零绑定 MCP 问数不受 begin 影响 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.5-draft / 2026-11-20 |
| 状态 | v0.5-draft。复审闭合 OQ-1／OQ-2 文档方案；OQ-3 数值容差待采样前冻结；终稿未确权；开发未授权；测试台 NOT RUN；不入新增核心分母；≠ 可上线。 |
| 功能编号 / 优先级 | P1-60／REQ-030-081；P0 主路径修复；沿用 P0-1 核心分母，不重复计数 |
| 台账号 | 无；挂 0.30 产品线执行总账 |
| 授权边界 | 委托人要求复审并闭合参与事实、预算与有效归属的文档方案；不含运行代码、配置、测试执行器开发或 UAT 执行。v0.1 方案未获认可，v0.2 重新评估，v0.4 按评审决议修订，本版闭合 OQ-1／OQ-2 的载体与事务合同，均不构成开发授权 |
| 总账与需求 | [执行总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 配对 Plan | [实施计划](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) |
| 测试台 | [UAT-SUITE-BEGIN-ZERO-BINDING](../qa/uat/suites/begin-zero-binding/suite.md)；判定只见 [INDEX](../qa/uat/INDEX.md)，尚无跑次 |
| 评审依据 | [评审决议](../reviews/2026-11-19-begin-zero-binding-review-decisions.md)；F-01–07 修订落点见 §9，修订不代表复审通过 |
| 复盘 | [测试漏检与已发现问题未独立跟进](../lessons/2026-11-19-begin-zero-binding-test-gap.md) |
| 适用环境 | Docker 单实例单副本；纯 MCP Token，无 WebUI Session／person／attestation |
| 既有合同 | [P0-1](lucy-20261107-question-type-caliber-binding-spec.md)；[问询审计 173](../../webui/docs/173-audit-one-question-one-inquiry-spec.md)；[问询预算 162](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md)；[冻结预算优化 D6](lucy-20261029-question-budget-window-optimization-spec.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：可证明未启用生效绑定、且无在途强制绑定的普通问询，begin 是可选上报；调用缺席或上报自身失败不新增绑定门禁、查询前置或全库依赖，不绕过既有预算／权限边界。
- 本条出口：SC-01–SC-12 的模块／协议自动化、真实进程局部持久化及并发边界验证。仅证明本条接口不变量，不将完整 Agent 旅程与系统重启压进功能合同出口。
- 不在本条出口：R 选择器的整套 Docker／真实 Agent 组合 UAT、系统升级／重启与负载发布取证；实际有绑定能力的普通发布全生命周期修复；KTX 修改、重名资产治理、出包或线上恢复。
- 上线关系：本条收口不表示可上线；R 的执行触发点为本修复候选准备主张纯 MCP 用户体验恢复时，执行负责人为该候选 UAT 执行者，结果进入 runs／INDEX。R 失败只追被证伪合同，不把模块全体退回。

## 1. begin 的价值与本次取舍

begin 当前承担原问题／意图上报、预算轮次声明、固定口径激活三件事。零绑定时，它没有新增数据查询能力；显式原文关联主要供追溯。既有合同已经允许漏调 begin 后查数，也有无显式问询的预算与审计路径。

本条将**零绑定的默认问数**恢复为 catalog／source 确认后直接 query。兼容仍调用 begin 的旧客户端，服务端也必须不新增阻断。减少默认上报可能降低显式原文覆盖；本稿不代委托人批准无补偿损失。先用 §6 的运维定位／管理判断任务验补偿，未证成的下降保持待决；保留诚实的调用／会话／推断审计，不能伪造用户已上报。

原 v0.1 的“零绑定必须等全局注册表事务就绪”不再作为设计依据。单改 instructions、隐藏工具、关闭预算或绕过 ACL 均不是本条修复。

## 2. 事实与证据边界

- 11 月 13 日 P0-1 审计报告记载 80 个自动化通过，但发布装配证据检查的是 `index.ts` 手动 reindex 源码顺序，不是普通发布后调用 MCP begin 的真实证明。
- 11 月 14 日 CALIBER-01 的环境是绑定目录缺失，未经历普通发布／创建空凭据／再次 begin 的生命周期；展示的是查询成功响应，未单列 begin 响应断言。引用的 inbox 原始 JSON 当前不存在，不能倒推当时 begin 返回值。
- 11 月 15 日 ROW-02 已记录 `caliber_binding_unresolved`，INDEX 为行权限 FAIL／BLOCKED，说明并非从未发现；未形成独立 begin 零绑定 P0 用例与跟进项。无法仅凭仓库判断当时是否另有口头通知。
- 当前源码确认普通发布缺少注册表提交，以及缺失目录／空目录摘要不同；线上 213 次 unresolved 的具体内部原因尚未获得直接状态证据。本条不把实现缺口当成已查明全部事故因果。

## 3. 拟议决策（确权后才能实现）

| ID | 决策 |
|---|---|
| D1 | begin 是可选能力；零绑定默认工具指导不推荐每题先调 begin，工具保留以兼容旧客户端 |
| D2 | 可选上报、预算声明、绑定激活分别处理失败边界；只有真实适用的强制绑定进入绑定事务 |
| D3 | 不用空绑定注册表凭据或全库 source map 作为未启用绑定问数的就绪条件 |
| D4 | 合法零绑定 begin 的可选记录失败采用诚实非阻断降级，不创建半份强制 BindingSession，不产生 lost_or_conflict |
| D5 | 真实已生效绑定、未知强制状态及旧 committed 快照不可被零绑定分支吞掉；查询仍走当前 ACL、行权限与预算 |
| D6 | 默认路径和旧客户端路径分别验；begin 成功与 query 成功分别断言，不再用后者代替前者 |

### 3.1 参与状态与适用范围

这是服务端派生状态，不新增用户配置开关：

| 派生状态 | 证据门槛 | 行为 |
|---|---|---|
| inactive（可信零） | 完整的初始化／正式发布历史证明未启用或已正式撤销最后一条绑定；该会话无应保留的强制旅程 | 走零绑定可选上报；不进入绑定注册表装载、依赖校验与提交 |
| active | 有可信的已发布绑定，或会话已有 committed 强制快照 | 走适用的既有绑定合同，合法成功与偏离拒绝均需验证 |
| unknown | 历史强制绑定、提交或快照确实存在不确定性 | 不转换成 inactive；真实拒绝给安全原因与 trace，恢复归有绑定链 |

不存在目录、draft、读取失败是不同事实。可信 inactive 不因新增未发布 draft 或旧空凭据格式差异变成“需要全库注册表恢复”；文件读取失败也不能把未知强制状态认证为空。

初始化和首次启用／最后撤销由同一发布协调边界维护参与代次；begin 依据可信参与快照选择路径，在最终写入前比较参与代次。inactive 的普通内容发布不写绑定提交凭据、不推进参与代次，也不新设绑定等待条件。

#### 3.1.1 OQ-1 冻结：唯一载体与代次

参与事实复用现有 `caliber-bindings/.caliber-binding/active-generation.json`，**不新增第二份参与配置或第二套计数器**。`participationEpoch` 就是该凭据的 `generation`；新格式字段如下，既有字段继续保留：

| 字段 | 合同 |
|---|---|
| `schemaVersion=2` | 标识支持显式参与状态；旧格式按下表兼容读取 |
| `phase` | `prepared` 不构成生效事实；只有 `committed` 可成为新 begin 的路由依据 |
| `generation` | 每次注册表正式提交递增；同时作为参与代次。inactive 普通内容发布不变更它 |
| `participation` | `inactive`／`active`；由本次 committed 候选的已发布绑定集合计算，不由用户填写 |
| `publishedBindingCount` | 本次候选中已发布绑定数；0 对应 inactive，大于 0 对应 active，与 `participation` 必须一致 |
| `releaseId`／`attemptId`／`digest`／`sourceMapVersion`／`fileCount`／`receipts` | 沿用父 O1 的消费证据；inactive begin 不因此加载全库 source map |

`unknown` 是读取或恢复时的派生分类，不作为一份可提交的当前状态写入。凭据仍用同目录临时文件＋原子 rename；首次启用、绑定内容变更和最后撤销都在现有发布协调窗口＋`registryActivationCommitExclusion` 内完成 prepared→committed→内存切换。committed rename 是耐久生效点，随后的内存切换是当前进程可见点；崩溃后从同一 committed 凭据恢复，不用发布页 confirmed 或作者目录文件存在代替。

#### 3.1.2 读取、旧格式与 scope 合并

全局读取优先解析参与凭据和当前 scope 的 BindingSession，不构建全量 Manifest 或完整注册表。只有无凭据的兼容零需要最小读取绑定作者文件的 `status`；不得解析 source map：

| 全局凭据 | 全局分类 |
|---|---|
| 文件不存在（`ENOENT`） | 无业务绑定文件，或全部作者文件可解析且 `status=draft` 时为 generation 0／inactive；存在 `status=published`、无法读取／解析状态或非目录读取异常时为 unknown。缺失、空目录、内部目录、合法 draft 或无绑定的普通发布未提交不自行变成 active |
| v2 committed，`participation=inactive` 且 `publishedBindingCount=0` | 按凭据 generation 取 inactive；不因 sourceMapVersion 或旧空摘要差异加载全库 |
| v2 committed，`participation=active` 且 `publishedBindingCount>0` | active；随后进入父合同注册表完整校验与激活链 |
| 旧 committed 且 `fileCount=0` | 兼容为 legacy inactive；不补写空提交，不要求 reindex |
| 旧 committed 且 `fileCount>0` | 不能仅凭旧字段证明零，进入 active／unknown 的既有治理链 |
| prepared、JSON 损坏、字段矛盾或非 `ENOENT` 读取失败 | unknown；不得转换成 inactive |

可信 inactive 不把既有 `registry.usable=false`、`syncPending` 或 source map 恢复失败继承为 begin／query 新门禁；这些信号只约束 active／unknown 的既有治理链。启动时可为观测保留注册表恢复异常，但不得覆盖 committed inactive 的可信参与分类。

随后读取 `identityKey=userId＋tokenHashPrefix`＋`sessionId`（缺失按 `-`）对应的 BindingSession：committed 强制快照优先，令该旧会话即使全局已撤销也走 active；never_begun／committed no-hit 沿用全局分类；损坏或不确定快照为 unknown。任何全局或 scope 读取异常都不能被当作可信零。

L0 仅允许以下全部证据同时成立的旧可选 preparing：全局为可信 inactive；当前 preparing 的 `bindingId`／`boundKey`／`caliberSnapshot` 全空；`previousCommitted` 不存在或也是可证明 no-hit；没有其他强制历史。L0 可幂等恢复为 no-hit，不开新预算轮次。任一强制字段非空、previousCommitted 为 bound、摘要冲突或历史不完整均为 L1／unknown，保留原证据，不 catch-all 清会话。

#### 3.1.3 线性化与有限重取

begin 首次读取 `(generation, globalState, scopeState)` 后，按 `registryActivationCommitExclusion → scope_lock` 的固定顺序进入临界区并重新读取比较。代次未变才允许写本次操作；代次已变则先释放两把锁，再按最新快照重新路由。每次外部 begin 最多 **2 次路由尝试（首次＋1 次重取）**，不持 scope 锁等待发布，也不无限排队。

第二次仍遇到代次变化时，begin 返回带 trace 的 `caliber_binding_unresolved`，不写新轮次或有效归属；这不是 query 的 begin-required 门禁，后续 query 仍按当时真实强制状态和既有准入处理。稳定 inactive 的普通发布不推进代次，因此不会耗尽该重取。正式 active／unknown 的真实拒绝不因本分支被吞掉；现行不 begin 不强制激活绑定的合同保持。

旧 committed 绑定即使全局绑定已删到零，仍按其旅程快照执行。迁移分类与真实持久化读回见 SC-11／ZB-11。

### 3.2 身份与授权

begin 仍验证有效 Token、Agent 启停、撤销、工具授予与全局工具拒绝。本地登记仅依赖这些可证明的授权事实，不因无关连接的表级 source map 编译失败新增本地上报拒绝；若工具授予本身无法证明，则不授权。

query／read_source／explain 的 ACL、来源有效性、字段、行权限与原有执行准入继续生效。无关连接故障若已独立影响 query，按不 begin 的对照结果如实登记，不能把数据面全局编译缺陷也算成本条已修复。

### 3.3 MCP 返回与真实记录（修订草案）

沿用 JSON-RPC 工具结果及 `content[0].text` 内 JSON，不删除现有字段。内部响应增量字段如下；兼容性由 SC-12／ZB-12 实测，不能假定旧客户端接受：

| 状态 | recorded / turnId | questionState / budgetStatus | reportingDegraded / isError |
|---|---|---|---|
| 正常记录且有效归属提交 | true／实际持久化 ID | active／committed（预算关闭为 disabled） | false／不标 true |
| G1：turn 实际写失败 | false／null | unrecorded／unchanged | true／不标 true |
| G2／G5：turn 已保存，有效轮次事务未提交 | true／实际持久化 ID | record_only／unchanged | true／不标 true |

上述 inactive 三类返回的 `activeBindingId` 均为 null。`recorded` 仅表示原文／摘要记录确实存在，不代表新预算或有效问询归属已经切换。record_only 的 turn 不作为有效预算／绑定标识，不回填旧调用、不能被客户端用作强制旅程凭据。原会话继续沿用旧有效作用域。正常记录且预算关闭时，预算仍关闭，不伪称提交过预算状态。

G1 提示“本次问询未记录，可继续按现有权限查询”；G2／G5 提示“本次问询已记录，新的问询归属未生效，可继续按现有权限查询”。两者均不要求重试 begin，不伪造 ID／预算／强制状态。普通 MCP 只返回安全分类与 trace，不回传路径、凭据、不可见绑定。

inactive 下显式不存在的 caliberBindingId、缺 intentSummary 等真实参数错误仍拒绝，且不能污染后续合法查询；身份无效按既有授权拒绝。服务不可达不在本条可选上报降级承诺内。G3／G4 与真实强制绑定失败按 §3.5 区分，不能一概套用此表。

### 3.4 预算轮次、重放与事务边界

沿用冻结预算优化 Spec D6，不改变真正新问询的轮次语义：

| 操作 | 预算／归属合同 | SC／R |
|---|---|---|
| N：不 begin；纯 MCP 重连；G1／G2／G5 降级 | 不因这些动作新开轮次或窗口，不清零已用额度／续查；query 正常消费仍记账 | SC-05／06，ZB-05／06 |
| B：成功的真正新 begin（包括第二个问题） | 依 D6 取代旧有效问询、推进轮次与窗口、归档旧耗时并开启新问题预算，归属同步切换 | SC-06，ZB-02／06 |
| 无持久幂等凭据的再次 begin | 仍是独立新调用；成功时按 D6，不承诺协议级重放去重；问句相同、时间相近或 JSON-RPC id 相同都不是跨重连凭据 | SC-06，ZB-06 |
| 同一服务端已受理操作的内部持久化恢复重放 | 复用该操作已有提交标识，提交最多生效一次；不能再生成新轮次。新增客户端持久幂等协议不在本稿范围 | SC-05／06／11，ZB-06／11 |

因此不存在“所有重复 begin 都不清零”的统一判据；也不以协议当前不支持外部幂等为由伪造该保证。降级不得指导客户端重新 begin 来取得新预算。已耗尽预算仍按既有续查合同处理。

turn 可先保存为仅记录；**预算切换＋有效归属（含 supersede／会话关联）是同一物理事务提交**。全部持久化成功后才发布新有效轮次；任一失败，旧预算、旧有效指针和旧强制快照保留，已保存 turn 保持 record_only，不回填旧调用。禁止预算已重置而归属未提交的可观察半状态，也不能仅靠内存回滚满足合同。

#### 3.4.1 OQ-2 冻结：同事务载体与两阶段提交

生产耐久载体统一为现有审计 SQLite；conversation turn、`question_budget_state` 和有效归属不得分别写不同文件或不同数据库。新增内部持久结构如下，均为未来授权后的 additive 迁移，不是本轮已存在实现：

| 载体 | 关键事实 |
|---|---|
| `conversation_turns` 增量列 | `operation_id`、`scope_key`、`participation_generation`、`question_state=record_only|active`；既有行该状态为空，迁移规则见下 |
| `question_scope_attribution` | `scope_key` 主键；`turn_id`、`operation_id`、`round`、`window_id`、`participation_generation`、`updated_at`。这是有效归属的耐久权威，不再只依赖 `reportedTurns` 内存 Map |
| `question_begin_commit` | `(scope_key, operation_id)` 唯一；保存 `turn_id`、已提交 round／window／generation 和 committedAt，是内部恢复重放的提交回执 |
| 既有 `question_budget_state`／`question_budget_idempotency` | 预算开启时在同一事务更新；`turn_id` 与有效指针一致，既有预算 idempotency 约束不删除 |

每个已受理 begin 在进入临界区前生成一次服务端 `operationId` 和 `turnId`，所有内部重取／恢复复用二者；它们不从问句、RPC id 或时间推导。提交分为：

1. **记录阶段**：先按 `(scope_key, operation_id)` 查提交回执；已有回执则直接按 B 重建缓存，不再写 turn 或预算。无回执时单独持久化真实 turn，初态 `record_only`，写 operation／scope／参与代次；同 operation 的既有 record_only 幂等复用。首次写失败即 G1，不进入有效事务。
2. **有效事务**：在一个 `better-sqlite3` 事务内重新载入旧预算与旧有效指针，按 D6 计算候选；预算开启则更新预算及原幂等记录；upsert 有效归属指针；把 turn 从 record_only 改为 active；执行既有握手 attachment 及其 mutation journal；最后写 `question_begin_commit` 回执。任一语句失败，整个有效事务回滚，记录阶段的 record_only 仍真实存在。
3. **提交后发布**：事务返回成功后，才更新 `reportedTurns` 等内存缓存并返回 B。内存缓存只是该表的读缓存；缓存失效或进程重启从有效指针表重建，不得从 record_only 或最近活动 turn 猜测。

若有效事务抛错但提交结果不确定，先按 `(scope_key, operation_id)` 读回提交回执：有回执则按已提交 B 恢复且不得再次推进轮次；无回执且事务确定未提交才走 G2／G5；读回也不可用则走 G3 的真实安全故障，不能按猜测返回降级成功。响应／网络失败不回滚已提交事实。

预算关闭时仍在同一有效事务写有效指针、turn active、握手关联与提交回执，但不写预算候选，响应 `budgetStatus=disabled`。record_only 永远不作为显式有效 turn、预算开题凭据或绑定旅程凭据；客户端后续带该 ID 时按既有无效／未确认归属规则处理，不新增 query 拒绝。

#### 3.4.2 与 query／在途消费及旧数据的关系

同一 scope 的有效指针读取、预算 consume、续查和 settle 与 begin 有效事务共用既有 scope 串行化。query 在准入时冻结归属快照；在途旧轮次仍按票据 round／window 结算到归档，不被新 begin 回写。原子事务不包住上游查询执行，不持 scope 锁等待数据库事实查询完成。

有效指针缓存未命中时读耐久表；读失败只让本次归属降为既有 candidate／unassigned 并记录健康异常，**不得单独新增 query 门禁**。若同一审计库的预算读写也不可用，则按 G3 保留基线 `question_budget_unavailable`，不能借归属降级绕过预算。

升级时，既有 `question_budget_state.turn_id` 只有在对应 conversation turn 确实存在、身份／session 匹配且不是 record_only 时，才可幂等补建有效指针；新表为空且没有这份旧证据时保持无显式归属，不凭历史最近调用重建。record_only 不参与该迁移。此恢复只补有效读取缓存／指针，不开新轮次、不清预算，也不成为合法 query 的前置。

### 3.5 最小故障矩阵（F 必验，R 验代表旅程）

所有格均先记录同身份／会话的不 begin 对照。每格证据包含 begin 载荷、真实 turn、round／window／计数、有效归属、BindingSession、后续 query 事实或独立拒绝、解除故障后的恢复。D 路径指 G1／G2／G5；G3／G4 是独立安全／观察负控，不混称可选写失败。

| 格 | 故障点 | begin 与持久化 | query／旧状态／恢复 | 映射 |
|---|---|---|---|---|
| G1 | 可选 turn 写失败 | 非阻断；recorded=false，无真实 turn，无强制 preparing | 基线合法时成交；旧有效预算／归属／强制快照原样；解除后 B 成功 | SC-05；ZB-05，矩阵 D |
| G2 | turn 成功，预算开题局部提交失败，原预算仍可读写 | 非阻断；recorded=true，record_only，budgetStatus=unchanged；不发布新轮次 | 基线合法时成交并正常消费旧预算；解除后下一次真正新 B 按 D6 仅切一次 | SC-05／06；ZB-05／06 |
| G3 | turn 存储健康，预算存储整体不可用，N 的 query 也拒绝 | turn 保存则 recorded=true／实际 ID／record_only／budgetStatus=unchanged；begin 返回 isError=true、reason=question_budget_unavailable，保留既有安全拒绝，不套普通成功体 | query 保留冻结预算合同的 question_budget_unavailable，不算 begin 增量阻断；恢复后合法成交，旧预算不伪清零 | SC-06；ZB-06 |
| G4 | 普通调用日志／trace 写失败 | 不推定 turn 失败；begin 按实际记录／预算状态响应，不凭泛称“核心审计”新增门禁 | 沿用 recordAudit 的健康异常／丢失披露；N／B／D 基线差异单列；恢复后可核对，不伪称丢失记录已持久化 | SC-08；ZB-08 |
| G5 | turn 成功，supersede／有效归属关联提交失败 | 与 G2 同，逻辑事务整体不发布；已存 turn 为 record_only | 旧预算／旧归属保留，后续合法 query 成交；修复后新 B 原子切换 | SC-05／06；ZB-05／06 |
| G6 | BindingSession commit 失败或强制 preparing | inactive：该调用次数必须 0，不得形成半状态；active／unknown 依父 D11 恢复／真实拒绝 | 不以 inactive 清除旧强制；验证强制恢复后允许口径成交及偏离仍拒绝 | SC-07／09／11；ZB-07／09／11 |

通用 `recordAudit()` 异步写失败与预算存储不可用不是同一安全合同。特殊工具如 Skill 内容审计另有既有拒绝边界，只做受影响回归，不新增“任意审计故障全局拒绝 query”。授权本身无法证明仍按现有 ACL 拒绝，不吞进 reportingDegraded。局部注入必须真实触达存储／提交，不能用全盘写满同时击穿多个依赖冒充单格。

“begin 增量拒绝为 0”的分母是同身份／会话、同数据／预算条件下 N 本可成交的合法 inactive 请求；B／D 不得新增上报错误或查询阻断。无效参数、无权身份及 G3 的基线安全拒绝另列负控，不能当合法组成功，也不能以负控名义移除合法组真实失败样本。

## 4. 核心流程（伪代码）

```text
begin(request):
  authenticate_and_authorize_question_reporting(request.identity)
  validate_shape_and_explicit_binding_reference_without_mutating_scope(request)
  operationId, turnId := server_generated_once_for_this_accepted_call()
  for routeAttempt in 1..2:
    snapshot := read_participation_credential_and_binding_session(identityKey, sessionId)
    if snapshot.global is active_or_unknown OR snapshot.scope has strong_or_unknown_state:
      return existing_governed_activation_or_truthful_denial(request, snapshot)
    with registryActivationCommitExclusion then scope_lock:
      current := reread_same_participation_snapshot()
      if current.generation != snapshot.generation OR current.scopeClassificationChanged:
        release_both_locks()
        continue                         # 唯一一次重取；不得持锁等待发布
      assert no committed_or_L1_strong_state_is_discarded
      priorReceipt := read_question_begin_commit(scopeKey, operationId)
      if priorReceipt exists:
        publish_memory_caches_from_durable_pointer()
        return committed_B_without_writing_again
      turn := persist_record_only_idempotently(operationId, turnId, current.generation)
      if turn.failed:
        return G1_nonblocking_without_new_round
      try:
        db.transaction:                  # 同一审计 SQLite；任一失败全部回滚
          if question_begin_commit contains (scopeKey, operationId):
            return committed_snapshot_without_applying_again
          budgetCandidate := apply_frozen_D6_to_current_budget_if_enabled()
          upsert_question_scope_attribution(operationId, turnId, budgetCandidate, current.generation)
          mark_conversation_turn_active(turnId)
          attach_handshake_and_write_mutation_journal(turnId)
          insert_question_begin_commit(scopeKey, operationId)
        publish_memory_caches_from_durable_pointer()
        return B_with_real_turn_and_actual_budget_status()
      catch commitOutcomeUnknown:
        receipt := read_question_begin_commit(scopeKey, operationId)
        if receipt exists: return committed_B_without_second_transition
        if durable proof of rollback: retain_record_only(); return G2_or_G5_nonblocking
        return G3_truthful_failure_without_guessing_commit_state()
  return caliber_binding_unresolved_with_trace_without_mutating_scope()

recover_participation_and_begin_operations():
  recover_committed_registry_generation_and_memory_registry()
  classify_L0_only_with_all_proofs; preserve_L1_as_unknown()
  for each question_begin_commit: rebuild effective-pointer cache without applying D6 again
  leave_record_only_without_receipt_unchanged()
  never_turn_optional_recovery_into_new_query_admission_gate()

query_or_read_source_or_explain(request):
  with existing scope serialization:
    pointer := read_effective_pointer_or_cache_with_nonblocking_attribution_fallback()
    apply_existing_auth_acl_fields_row_policy_budget_source_and_admission_rules(pointer)
  enforce_real_committed_or_unknown_strong_binding_as_existing_contract
  otherwise_no_begin_required_or_empty_binding_registry_ready_gate
```

§3.1／§3.4 已冻结载体、事务落点、恢复和有限重取；伪代码是待确权实现合同，不是当前实现描述。

## 5. 功能验收 SC（F 选择器）

| SC | 本条接口不变量及负控 | 证据形态 | UAT 映射 |
|---|---|---|---|
| SC-01 | 零绑定 N 无新增拒绝／前置，未授 begin 但授 query 者可用 | 真实 handler／ACL 适配 | ZB-01 |
| SC-02 | B 有真实 ID，inactive 绑定加载／提交／全量 Manifest 调用数 0；有效事务同事务写预算／指针／turn active／回执 | 真实 Proxy、实际调用计数与同一 DB 读回 | ZB-02／03 |
| SC-03 | I0–I3、L0 的可信空表示不降可用性，L1 不按空恢复；参与代次等于 committed registry generation | 实际凭据／历史证据／恢复读回 | ZB-03／11 |
| SC-04 | I4 draft、普通发布前中后 N／B／D 不新增绑定等待 | 参与状态／真实发布临界交错 | ZB-04 |
| SC-05 | G1／G2／G5 响应真实，有效事务任一点失败均整体回滚，无 inactive 强制 preparing；不确定提交先读回执 | 局部真实存储故障、逐语句故障点及原子恢复 | ZB-05／06 |
| SC-06 | D6 合法第二问题、无 begin／降级／重连、独立再次调用、内部恢复重放分别正确；G3 真实安全拒绝 | 实存储预算，round／window／有效 ID／operation 回执；Token／Agent disabled／global deny 负控 | ZB-06 |
| SC-07 | 首次启用／最后撤销代次线性一致；G6 inactive 零调用 | 确定性交错＋正式控制入口读回 | ZB-07 |
| SC-08 | 指导默认可选；G4 写失败诚实；运维定位恢复与管理判断补偿可执行 | 实际协议／日志健康／脱敏任务证据 | ZB-08 |
| SC-09 | inactive 不存在 id／缺必填拒绝后合法查询；A0／U0／L1 防绕过 | 真实调用与未执行证据；read_source／explain 的 ACL／字段／行策略适用分支正反例 | ZB-09；细粒度参数／工具变体在 F 必验 |
| SC-10 | 默认额外工具 0，begin 增量拒绝 0，无绑定全库扫描依赖 | 实际计数＋固定采样方法 | ZB-10 |
| SC-11 | 启动分类 I0–I3／L0／L1／T0／U0 正确；C1 仅 record_only 崩溃不生效、C2 回执已提交未响应崩溃至多生效一次；T0 新旧会话分别验 | 真实局部进程持久化／恢复；有效指针缓存重建不阻断 query | ZB-11 |
| SC-12 | RC1 未修改真实既有客户端处理正常、G1 null、G2／G5 仅记录状态；不伪造兼容 | 固定客户端＋协议变体消费者，证据分开 | ZB-12 |

F 覆盖全部故障格及细粒度工具负控；R 保留 [fixtures 覆盖矩阵](../qa/uat/suites/begin-zero-binding/fixtures.md#统一路径与覆盖矩阵)的组合旅程，不复制整套父合同验收。

## 6. 受影响画像

事实源：[user-personas.md](../governance/user-personas.md)。下表是合同预期，未执行的补偿不是已证成；同画像按最差子面判整体。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 问数面：可选 begin 可被空注册表故障拒绝；报告面沿现有 Live Report | 问数面：N／B／D 均不新增障碍；报告面入口及授权未变 | 问数面 ↑／报告面 ＝，整体 ＝（按最差子面） | SC-01／05／12；报告路径未触碰，归属 Live Report 模块 | — |
| P2 治理方 | 语义口径面：未用绑定也可能需处理注册表；权限授权面由 Token／工具／表行规则决定 | 语义口径面：可信零不需补空提交，已有强制仍在；权限授权面相同规则，本地 begin 不再依赖无关全库编译 | 语义口径面 ↑／权限授权面 ＝，整体 ＝（保守按最差） | SC-03／07／09；SC-06 验工具授予／Agent 启停／global deny，数据面授权不放宽 | — |
| P3 运维方 | 运行观察面有显式问询原文／摘要关联，但 begin 故障影响主路径；交付运维面按既有部署恢复流程 | 运行观察面显式覆盖可能下降，需用 request／trace／身份／版本定位并验恢复；交付运维面不改升级／备份／部署 | 运行观察面 ↓（补偿待验）／交付运维面 ＝，整体 ↓ | SC-08／ZB-08 运维任务；交付路径未触碰，归属部署／恢复 runbook | 纯 MCP 问数无需原文：运维用既有只读日志及版本证据定位夹具故障→解除隔离故障→同 Token 查事实恢复。不得靠新增用户必调 begin；未成功不收口 |
| P4 管理层 | 口径质量面可读显式／推断摘要；业务结果面实际问数可被 begin 阻断 | 口径质量面显式覆盖可能下降，但要求覆盖口径、缺失及质量负控可解释；业务结果面 N／B／D 成交事实可核对 | 口径质量面 ↓（补偿待验）／业务结果面 ↑，整体 ↓ | SC-08／09、ZB-08 管理任务及 ZB-01／05；不以门禁通过冒充业务恢复 | 纯 MCP 测试事实的管理只读摘要：区分显式／推断／缺失，复算分母、逐请求成功与失败，不声称掌握未上报原文；SC-08／ZB-08 必验 |

P3／P4 的补偿完成的是定位恢复／判断承诺兑现，不承诺恢复所有显式原文。未证成的下降保持，不能靠诚实披露一句话过关；若实际原任务确实离不开不可替代原文而补偿失败，由治理规则要求明示批准并指定代价承担方，本稿未取得该批准。禁止恢复每题必调 begin 以追原文覆盖。专项产品级复核未命中 P1·问数面↓或 P3·交付运维面↓，但跨画像最差口径仍适用。

## 7. 兼容关系与范围

| 既有合同 | 本稿处理 | 后续修订边界 |
|---|---|---|
| P0-1 D11／O1 | inactive 脱离统一强制提交；active／unknown 仍约束 | 确权时逐条修正 inactive 条款；不回写历史 CLOSED 为本次结果 |
| Spec 173／162 | 可选记录、有效归属、预算失败分别披露 | 固定 record_only 与归属原子切换；不把推断伪称显式 |
| 冻结预算优化 D6／§6.1／§6.5 | 真正新 begin 仍取代旧问询，不采用“所有重复调用不清零” | 本稿不废止 D6；恢复重放与新调用按 §3.4 区分；事务适配需检验既有预算持久化合同 |

上述是待确权差异清单，不自动修改父合同正文或历史结论。普通 WebUI 有绑定发布缺少完整提交的缺口继续另段；本条首次启用／撤销使用既有 `/api/semantic-assets/reindex` 正式控制入口，见 fixtures 入口表，必须与参与代次同窗。不能把另段缺口倒挂为零绑定恢复前置，亦不能跳过边界防绕过。

## 8. 决策闭合与实施门槛

- **OQ-1（文档方案已闭合）**：§3.1 冻结唯一载体为 committed `active-generation.json`，参与代次等于 registry generation；全局凭据与 scope 强制快照合并分类，旧空格式、L0／L1、原子 rename、锁序和最多 2 次路由尝试均有明确规则。不新增用户开关或第二份参与配置。闭合表示可实现合同已明确，不表示代码已存在或恢复已验证。
- **OQ-2（文档方案已闭合）**：§3.4 冻结记录阶段＋同一审计 SQLite 有效事务；预算、有效指针、turn active、握手关联和提交回执同生共死，record_only、提交结果不确定读回、缓存重建、旧数据迁移及 C1／C2 崩溃恢复均有明确规则。D6 保留，不新增客户端重放幂等承诺。RC1 可执行文件版本已只读核对，尚未验证 MCP 实际启动／兼容；执行缺对象为 BLOCKED，产品不兼容为 FAIL。
- **OQ-3（采样方法已写，数值待冻结）**：按 fixtures 三组、每组每轮 100 问、三轮各算 nearest-rank p95；预热独立、随机交错。硬判据默认额外工具 0、begin 增量拒绝 0、inactive 绑定全库构建 0。实际基线、绝对／相对双容差和资源指纹须性能采样前冻结，不要求开发前已有候选实测，也不能测后放宽。

文档闭合不等于终稿确权／开发授权；OQ-1／OQ-2 不再构成方案空白，但其实现仍须按 SC 证明。OQ-3 数值未冻结只阻断性能采样与 ZB-10 PASS，不阻断其他已明确分支的后续授权评审；测试台仍 NOT RUN。

## 9. 评审处置对照

| Finding | v0.4-draft 修订落点 | 当前边界 |
|---|---|---|
| F-01 | §3.4／§7、SC-06、ZB-06 | 语义已修正；有效事务方案见 §3.4，未实现未测试 |
| F-02 | §3.3–3.5／§4、SC-05／06／08／09、ZB-05／06／08／09 | 矩阵及 OQ-2 耐久事务方案已闭合；未实现未测试 |
| F-03 | §6、SC-08、ZB-08 | 规范表与任务补偿已补，补偿未证成，下降未取消 |
| F-04 | SC-12、fixtures RC1、ZB-12 | 版本及运行入口有本机只读证据，真实 Agent 旅程未跑 |
| F-05 | SC-03／06／09／11、fixtures L0／L1、ZB-09／11 | F 细粒度负控与 R 代表分支均已挂，NOT RUN |
| F-06 | fixtures 单一覆盖矩阵，Plan 引用，cases 逐项路径及独立清理 | 三处同源，未执行 |
| F-07 | §7、fixtures 控制入口表、ZB-07 | 普通内容发布与有绑定控制分开；代次仍必验 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 无新增产品名称。协议草案字段 `recorded`／`reportingDegraded`／`questionState`／`budgetStatus` 分别披露真实记录、降级、有效归属与预算提交状态；`inactive`／`active`／`unknown` 是内部派生状态，不作 UI 产品概念。沿用“可选问询上报”“问题类型口径绑定”“生效绑定”“口径绑定无法解析”。

## 交互合同豁免

- 原因：本条仅修改 MCP 协议、本地服务状态与调用指导，不改变用户可见 WebUI 表面
- 不改变：WebUI 页面路由、组件、按钮、布局与交互；本次不要求浏览器或移动窄屏测试

## Design System Compliance

### Referenced Specs

- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`

### What This Change Follows

沿用 MCP 结果承载位与现有工具名称，不新增 UI；既有工具授权边界保持。

### Exceptions (If Any)

无 WebUI 设计改动，按上述交互合同豁免。

### Follow-up Needed

协议字段形状已冻结，真实 RC1 兼容性仍由 SC-12／ZB-12 验证；若新增管理 UI，另补交互清单与翻译防御。
