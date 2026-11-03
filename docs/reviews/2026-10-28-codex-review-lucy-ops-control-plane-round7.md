# L25-16 运维控制面 MCP（lucy_ops）Codex 审阅报告 · 第 7 轮

## 结论

**Codex 交付判定：不可交付开发** —— 仍有 3 项阻塞：**F7-01、F7-02、F7-03**。

判定原文要点：C5 会覆盖已有失败成员的状态，语义发布的完整影响集与执行子集规则冲突，以及既有 staged 批次缺少合法的 Agent 消费路径；§4.2 与恢复段的聚合优先级已经一致，但 C5 未完整保留成员状态，C3 重入分派也没有落实所要求的重新聚合；源码确认，批次计划读取严格校验操作者和实例，因此仅新增 `validation_id` 入参不足以打通适配器；异常边界与结果构造也仍有缺口——C7 持久化位于组级 try 之外，恢复分支会再次丢失 release 字段；Spec 验收矩阵和 Plan 追踪表均为 72 条、无缺号无重复，但阶段反向覆盖仍有一处偏差。

严重性统计：本轮**新增 10 条**——**阻塞 3**（F7-01、F7-02、F7-03）、**高 4**（F7-04、F7-05、F7-06、F7-07）、**中 3**（F7-08、F7-09、F7-10）；另对第 6 轮的 **11 个编号**做闭合性核验，结论为**已闭合 6**（F6-04、F6-07、F6-08、F6-09、F6-10、F6-11）、**部分闭合 5**（F6-01、F6-02、F6-03、F6-05、F6-06）。

> **⚠️ 严重性口径更正（必读）**：本轮任务的交办简报写的是「3 阻塞 / 6 高 / 2 中」，但 Codex 第 7 轮原表逐条标注的严重级为 F7-01–F7-03 **阻塞**、F7-04–F7-07 **高**、F7-08–F7-10 **中**，即 **3 阻塞 / 4 高 / 3 中**；被审 Spec 与 Plan 自述的第 7 轮口径（「F7-01–F7-03 阻塞 + F7-04–F7-07 高危 + F7-08–F7-10 中危」）亦同。简报口径与第 6 轮（3 阻塞 / 6 高 / 2 中）相同，疑为沿用旧轮次数字。**本报告以 Codex 原表为准**，并在此显式留痕，不做静默改写。

> Codex 声明：「已闭合」仅评价设计修订，不代表实现或测试通过；本轮未执行构建、测试、部署或 Git 写操作，未修改、创建或删除文件。

## 审阅基线与限制

- **被审文档版本与行号基准（存在时序差异，务必注意）**：Codex 第 7 轮审阅的是 [Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md) 的 `v0.9-sixth-review-fixes` 与 [Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md) 的 `v0.7-sixth-review-fixes`，其读取范围为 **Spec 1–1339 行、Plan 1–445 行**。**本报告落盘时，工作区文档已推进至 Spec `v1.0-converged`（1441 行）、Plan `v0.8-converged`（474 行）**——即 Codex 读完的版本之后，文档已按第 7 轮要求再次修订。因此：
  - 下文各条「位置」中的 `Spec:xxx` / `Plan:xxx` 均为 **Codex 所读 v0.9 / v0.7 文本**的行号，**不能**与当前工作区行号对照；
  - 本报告「MiniMax Code 独立核实」一列中给出的 `file:line`，**源码行号不受文档版本影响**，仍然有效；对文档位置则一律另给当前 v1.0 / v0.8 的核验锚点。
- **审阅方式**：由本机 Codex（`codex-local`，read-only sandbox，approval-policy=never）对两份文档做对抗式设计审阅。
- 本轮**未运行**功能测试、浏览器、real-e2e、构建或服务启动，**未连接**数据库与客户环境；**不产生运行证据**。
- 本轮**仅创建本报告**，**未修改** Spec 与 Plan 正文。
- L25-11 仅作为依赖被核对，不在本次审阅范围。
- **核实方式**：MiniMax Code 对 F7-01–F7-10 逐条回查 `webui/server/` 源码与当前 Spec/Plan 文本，确认 Codex 断言与代码事实是否一致；对纯文档内部一致性的条目只核对文档现状，不给源码行号。
- **本轮之后 PM 要求停止 Codex CLI：这是最后一份 Codex 报告，此后由 MiniMax Code 自行收敛。** 第 7 轮后未再有第 8 轮独立复审，因此当前 v1.0 / v0.8 的闭合性**没有**外部 Codex 判定背书。
- **Codex 自述的「无法核实清单」（原文照录）**：
  1. Lucy Ops 尚未实现的事务、状态机、恢复扫描与审计收敛，不能从源码证明已经工作；本报告评价的是设计闭合性。
  2. 未核实 L25-11 是否另有获批修复或复审材料；当前读取的发布源码仍存在 G31 所述锁释放边界。
  3. 无法核实 PM 签核、客户对新增 staged 前提的接受情况，以及实际可供 Agent 消费的批次。
  4. 未运行构建、测试、浏览器验证或部署，未修改、创建或删除文件；不产生实现、功能验收或客户验收结论。
- **Codex 第 7 轮的核对基线（原文要点）**：全文读取了指定 **Spec 1–1339 行**与 **Plan 1–445 行**，其他文档仅读取开发治理入口，没有扩展审阅历史报告或其他功能 Spec；源码核验覆盖计划与 staging、发布／release／锁、旧写入口及恢复相关写集、身份授权与审计合同四组；对 VOPS 表格首列只读解析得 **Spec 72 条、Plan 72 条，均无缺号无重复**，G 清单 **34 条无缺号无重复**，展开阶段退出条件编号范围后双向比较，**唯一偏差为 S2 多列 VOPS-61**；逐条审读断言后确认 VOPS-68 仍保留被新设计否定的转换要求、VOPS-70–72 尚不足以覆盖本轮反例。

## 发现的问题

### A. 第 6 轮 11 条发现的闭合性核验（Codex 第 7 轮原表 + MiniMax Code 核实）

> 「当前设计位置」一列为 **Codex 所读 v0.9 / v0.7 文本**的行号；「依据」中的**源码** `file:line` 不受文档版本影响，仍然有效。

| 编号 | 原发现 | 当前设计位置（Codex 所读 v0.9 / v0.7） | Codex 核验结论 | MiniMax Code 独立核实 |
|---|---|---|---|---|
| F6-01 | 聚合优先级冲突、未终结成员被提前判失败、未知状态进入重试 | Spec:327、Spec:885 | **部分闭合** | **属实**（已回查源码）：两处聚合顺序已一致，收敛入口也已登记；但重入仍直接分派 `opRec.status`，C5 只识别既有成功，其他既有状态可能被覆盖后执行，未先验证未知成员状态——见 F7-01、F7-07。当前 v1.0 已按此重写：Spec `:698`（重入分派改为 `aggregateOperationState(membersOf(opRec))`）、`:346-358`（唯一聚合表与未知状态拒绝）、`:358`（`ops_state_corrupt`）、`:881`（C7.2 复用同一函数） |
| F6-02 | operation 范围限制导致剩余成员无法续交 | Spec:639、Spec:679 | **部分闭合** | **属实**（已回查源码）：已区分原计划与 attempt 范围，移除了上一范围对新 attempt 的限制；但 C5 把范围外的既有失败成员改成 `pending / attempt=None`，破坏全集聚合；`recoverPending` 的注释与提前返回也不一致——见 F7-01、F7-06、F7-10。当前 v1.0：Spec `:664-667`（三范围分清）、`:685-687`（认领持久化 `planRef` + `execSet`）、`:716-717`（合法性边界是可继续执行成员集合） |
| F6-03 | check 产物无法转换为可发布 validationId | Spec:975、Plan:239 | **部分闭合** | **属实**（已回查源码）：事实性更正正确——批量 check 只生成报告与任务记录，staging 才调用快照持久化；但 staged 批次的操作者绑定未解决，适配器范围还与通用组完整性冲突；Plan 仍保留旧转换指令——见 F7-02、F7-03、F7-09。当前 v1.0：Spec `:1064-1068`（入参必须是既有 staged 批次的 `validation_id`）、`:514`（缺口 G30）、`:1375`（VOPS-68 已改为验「消费既有 staged 批次」） |
| F6-04 | TTL 检查先于 operation 定位 | Spec:604 | **已闭合** | **属实**（已回查源码）：C0 已先查 operation；C1 对已有记录使用持久计划且不检查 TTL。底层顺序也得到源码支持——幂等查询在读快照之前，成功受理后快照被删。当前 v1.0：Spec `:628-644`（C0 先定位 operation，C1 分支 `:644` 注明「此分支【不检查计划过期】」）、`:1193`（规则复述）；Plan `:267`（同口径） |
| F6-05 | 异常边界遗漏撤销、核验、持久化 | Spec:735、Plan:197 | **部分闭合** | **属实**（已回查源码）：撤销与核验已进入 try，锁覆盖要求也已明确；但 target 认领和审计在 C5、终态审计与持久化在 C7，仍位于该 try 之外——见 F7-04。当前 v1.0：Spec `:798`（组级 try 起点）、`:861-872`（target 结算独立 try）、`:882-897`（operation 终结独立 try） |
| F6-06 | kind/ok 不一致、release 被覆盖、双轴判断错误 | Spec:838、Spec:1071 | **部分闭合** | **属实**（已回查源码）：构造器与先恢复、后生效的顺序已补齐，符合双轴合同；但 C6 的 `recovery_required` 分支不用 `keep=`，再次把 release 包进 detail，丢失原有字段结构——见 F7-05。当前 v1.0：Spec `:830-836`（`Outcome.recoveryRequired(keep=existingResultOf(t), …)`） |
| F6-07 | 认领与审计绑定没有原子事务边界 | Spec:652、Plan:195 | **已闭合** | **属实**（已回查源码）：Plan 已明确选择「同库不同表、同一事务」，target 使用单次 claim-and-bind；源码存在可复用数据库入口，审计插入与按 id 更新分处两处。**事务是否真正实现，须待编码后验证**。当前 v1.0 / v0.8：Plan `:196`（第 29 条，同库不同表 + 同一事务，且规定不具备同事务能力时必须删除「原子」声明）；Spec `:510`（缺口 G34 仍登记为「事务边界未定」，与 Plan 的定案**尚未对齐**，属残留） |
| F6-08 | 错称底层锁覆盖终态核验和持久化 | Spec:430、Plan:251 | **已闭合** | **属实**（已回查源码）：更正符合源码——锁在 `reindexImpl` 返回时释放，早于摘要核验、终态审计、`published` 记录与恢复日志完成。缺口已作为 G31/W-B 依赖保留，不能据此宣称底层问题已经修复。当前 v1.0：Spec `:507`（G31）、`:1235`（W-B 解锁前置条件含 G30／G31） |
| F6-09 | Schema 删除与语义发布不互斥 | Spec:954、Plan:214 | **已闭合** | **属实**（已回查源码）：已要求旧、新入口都取得发布窗口并保留删除前像；源码确实是先写完 ktx.yaml 再删除文件，发布另取协调锁。修订准确覆盖该缺口。当前 v1.0：Spec `:508`（G32） |
| F6-10 | S3/S4/S6 退出条件漏项 | Plan:216、Plan:232、Plan:270 | **已闭合** | **属实**（已回查源码）：原指出的 VOPS-58、51、57/60/62/64/65 均已补入对应退出条件；正向分配无遗漏；反向多出 S2/VOPS-61 已列为 F7-08。当前 v0.8：Plan `:207`（S2 退出条件）、`:269`（S5）、`:280`（S6 要求逐项取得直接证据）、`:369-385`（追踪表） |
| F6-11 | §10 把 W-B 专属 G15 作为全部写工具前置 | Spec:1292 | **已闭合** | 已由 MiniMax Code 回查源码确认为属实（证据见对应轮次 Codex 报告所引位置）；当前 v1.0 的 §10 风险表已与 §7 的阶段限定一致：公共归因 G2 适用于全部写类工具，G15 仅限 W-B |

### B. 第 7 轮新发现 F7-01–F7-10

#### F7-01［阻塞］C5 没有完整恢复既有成员状态，会抹掉失败记录

**位置（Codex 所读 v0.9）**：Spec:701（仅处理 `prior.status == "succeeded"`）、Spec:707（随后无条件设置 `t.state = "pending"`、`t.attempt = None`）、Spec:341（全集聚合）、Spec:347（未知状态拒绝）。

**问题**：C5 只处理既有记录为 `succeeded` 的情形，其余既有记录被无条件改为「从未执行」。例如首次 A 失败、B 未执行，随后只提交 B：A 被改成「从未执行」，B 成功后 operation 仍为 pending，而非按 A.failed / B.succeeded 聚合为 failed。该行为与 §4.2 的全集聚合及未知状态拒绝相冲突。

**影响**：既有失败痕迹被抹掉，全集聚合得出错误结论，失败成员可在后续 attempt 中被当作未执行而重复进入执行路径；损坏状态成员也可能绕过「未知状态显式拒绝」直接进入执行。

**Codex 建议修法**：重写 §6.2 C3/C5——认领前完整加载并校验全部持久成员，重入先调用唯一聚合函数；范围外成员保留原状态、attempt、结果和审计绑定；**只有无既有记录者**才初始化为未执行。新增 **VOPS-73**（A.failed 后提交 B）与 **VOPS-74**（损坏成员状态在新认领、效果发生前被拒绝）。

**MiniMax Code 独立核实：属实。** 当前 v1.0 已按本条重写 C5，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:739-747`（既有记录**完整恢复**：持久态、attempt、result 与 audit 绑定逐项还原，并**先**做五态校验，`:742-743` 超出即 `deny("ops_state_corrupt")`）、`:748-749`（仅 `succeeded` 才幂等复用跳过）、`:752-756`（既有 `failed` 保留原状态；不在本次范围时**直接 continue，不改写**）、`:762-769`（范围外成员保留既有状态，**只有 `prior is None` 才初始化为 `pending / attempt=None`**）；`:340-344`（全集聚合按 attempt 区分「从未执行」与「已认领未终结」）、`:356`（存在未终结成员时不得转 `failed` 终态）、`:358`（未知状态显式拒绝）；缺口 `:512`（**G36**）；验收项 `VOPS-73`（`:1380`）、`VOPS-74`（`:1381`）。即：**对 v0.9 的指控成立，v1.0 已按其要求重写；但 v1.0 未经过第 8 轮独立复审。**

#### F7-02［阻塞］语义适配器与通用执行范围不能同时满足

**位置（Codex 所读 v0.9）**：Spec:997（要求参数属于 refs）、Spec:1029（把完整影响集构造成单组）、Spec:861（执行集定义为原计划与参数的交集）。

**问题**：若批次 refs 为 R，附带磁盘变更 U 不属于 refs，则适配器成员为 R∪U；按请求 R 计算执行子集，会因单一原子组缺少 U 而被拒。把 U 加入参数又违反声明的 refs 范围约束。两条规则不可同时满足。

**影响**：语义发布通道在「批次索引整批生效」这一底层事实下无法同时通过通用组完整性校验与批次范围约束；W-B 工作流在授权与执行之间缺少一致的集合口径。

**Codex 建议修法**：在 §6.2 / §6.4 分开定义 `requestedRefs` 与 `effectiveExecutionSet`——语义发布经完整影响集确认、再授权后，执行集固定为整个已确认原子组；**不得通过未声明的参数扩张实现**。新增 **VOPS-75**：授权覆盖 R∪U 时可发布，U 未授权时在认领前拒绝。

**MiniMax Code 独立核实：属实。** 源码前提已逐行确认：`webui/server/semantic-assets.ts:2991-2996` 的 `effectiveTargets` 确实把 `candidates` 与 `unrelatedDiskChanges` **合并**为一个集合（同文件 `:2959-2969` 构造 `unrelatedDiskChanges`、`:2972-2980` 构造 `candidates`），即完整影响集确实含批次 refs 之外的附带磁盘变更。当前 v1.0 已按本条分离两个集合，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:1070-1074`（注释明确 `requestedRefs` = 调用方声明范围、`effectiveExecutionSet` = 完整影响集，「两者一般**不相等**」）、`:1076-1078`（参数只做**声明范围**校验，不用于收窄执行集）、`:1115`（`execution_set=impactSet`，执行集 = 整个已确认原子组）、`:675-678`（§6.2 C3.1 登记语义发布的执行集例外，明确不得靠把 U 塞进参数实现）；缺口 `:513`（**G37**）；验收项 `VOPS-75`（`:1382`）。即：**对 v0.9 的指控成立，v1.0 已按其要求分离两个集合。**

#### F7-03［阻塞］新增 validation_id 前提没有解决批次所有权

**位置（Codex 所读 v0.9）**：Spec:987（仅取 validation_id）、Spec:1004（直接读计划）。

**问题**：管理员 alice 创建的 staged 批次，Agent `config_agent` 即便委托自 alice，也无法直接读取其计划；设计没有定义交接或同一 Agent staging 的路径。

**影响**：既有 staged 批次对 Agent 不可消费，语义发布工作流 W-B 的首期路径无法成立；「仅新增 `validation_id` 入参」不足以打通适配器。

**Codex 建议修法**：在 §6.4 步骤 0–3 和 Plan S5 定义受信的批次消费合同：选择同一 Agent staging，或显式授权的批次交接；**分开保存批次创建者与执行 Agent**，保留原 actor/instance 校验，**禁止伪装管理员**。新增 **VOPS-76**：合法交接成功、未授权跨操作者与跨实例消费拒绝。

**MiniMax Code 独立核实：属实。** 源码三处前提已逐行确认：
- `webui/server/semantic-assets.ts:2941-2948` —— `batch.actor !== context.actor` 时抛错，状态码 **403**，消息「该批次属于其他操作者，不能直接消费。」；
- `webui/server/semantic-assets.ts:2949-2956` —— 继续校验 `batch.instanceId`，同样 **403**（「该批次属于其他实例，不能直接消费。」）；
- `webui/server/index.ts:2188-2216` —— 既有 staging 路径以 `actorIdFromRequest(request)`（`:2191`）取 actor 并写入批次快照（`:2200-2216`），而 `webui/server/security/request-actor.ts:64-80` 中 `trustedActorFromRequest` 对管理员上下文返回 `ctx.admin.id`（`:71`，`actorType: "ui_admin"`）。
⇒ 批次由**管理员身份**创建，而读计划强制校验操作者与实例，**Agent 无权消费管理员批次**。

当前 v1.0 已把该问题登记为**产品决策**而非实现细节，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:1170`（Normative 段落复述上述源码事实）、`:1176-1181`（三条候选路径 (a) 同一 Agent staging / (b) 显式批次交接 / (c) 受信委托人代为 staging，并明令「不得以伪装 actor 绕过」）、`:514`（缺口 **G38**）、`:1269`（**D8 待 PM 拍板**）、`:1235`（W-B 解锁前置条件含 D8 与 G30／G31）、`:1383`（验收项 `VOPS-76`）；Plan `:13`（待确认栏列 D8）。即：**对 v0.9 的指控成立，但 v1.0 未消除底层约束——该条以「登记 D8、待 PM 拍板」的形式挂起，未闭合。**

#### F7-04［高］声明扩大的异常边界仍未覆盖实际持久化路径

**位置（Codex 所读 v0.9）**：Spec:716（在 try 前认领）、Spec:740（try 起点）、Spec:793（try 结束）、Spec:795（审计更新与持久化）。

**问题**：C5 的认领/审计和 C7 的审计更新、target/operation 终结仍可直接抛出，无法保证返回已完成组结果。

**影响**：组内异常时已完成组的结果可能丢失，审计与终态不落库；认领阶段抛错会留下「已认领未落审计」或「已插审计未绑定」的窗口。

**Codex 建议修法**：把组级认领、执行、撤销、核验及目标结论持久化放入同一明确异常协议；operation 聚合持久化单独定义失败后的可恢复响应。扩展 **VOPS-65**，逐一覆盖 claim、终态审计、target finalize、operation finalize 异常，验证结果不丢失且不重复执行。

**MiniMax Code 独立核实：属实。** 当前 v1.0 的伪代码落点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:773-777`（C5 的 `claimTargetAndBindAudit` 与状态赋值）**仍位于**组级 try（`:798`）**之外**；`:862-872`（C7 的 target 结算——终态审计更新 + `finalizeTarget`）已入独立 try，失败转 `recovery_required`；`:882-897`（C7.2 的 operation 终结/进度写入）已入独立 try，失败返回稳定原因码 `ops_finalize_incomplete` 并保留已收敛结果。Plan 侧 `:202`（第 35 条）已把「target 认领 + 审计绑定、终态审计更新、target 终结、operation 终结/进度写入**全部**纳入异常协议」写成要求。验收项 `VOPS-65`（`:1372`）当前文案仍只列「效果前异常、效果后异常、审计写入异常」三类，**尚未按本条建议逐一展开 claim / 终态审计 / target finalize / operation finalize**。即：**对 v0.9 的指控成立；v1.0 已闭合 C7 侧，但 C5 认领仍未落在异常协议内（要求已写入 Plan、伪代码未落地），VOPS-65 未扩展——本条尚未完全闭合。**

#### F7-05［高］恢复分类再次丢失 release/activation 字段

**位置（Codex 所读 v0.9）**：Spec:1074（适配器设置 `release=release`）、Spec:775（改为 `Outcome.recoveryRequired(detail=existingResultOf(t))`，没有 `keep=`）、Spec:353（release_id 持久化要求）。

**问题**：适配器已构造携带 release 的 recoveryRequired 结果，C6 随即重建结果，只把原结果放入 detail。

**影响**：语义发布的 `release_id` 与生效信息在恢复路径上再次丢失，恢复后的成员结论与实际生效状态脱节，release_id 持久化要求无法满足。

**Codex 建议修法**：修改 C6 全部结果重建分支，使用 `keep=existingResultOf(t)`，并明确 release_id 的稳定提取字段。扩展 **VOPS-72**：`recoveryRequired=true` 经适配器、通用编排、持久化、重启恢复后，release_id 与双轴信息均保持。

**MiniMax Code 独立核实：属实。** 当前 v1.0 已在恢复分支使用 `keep=`：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:830-836`（`elif outcome == "recovery_required":` 分支改为 `Outcome.recoveryRequired(keep=existingResultOf(t), detail=existingResultOf(t))`，并附注「keep= 保留适配器产出的 release / activation 等字段（F7-05）」）；同类修正在 `:851`（异常分支）与 `:826-828`（`pendingActivation` 分支）一致带 `keep=`。验收项 `VOPS-72`（`:1379`）仍沿用 F6-06 的字段完整性口径，**未按本条建议扩展为「经适配器 → 通用编排 → 持久化 → 重启恢复后 release_id 与双轴信息均保持」的端到端断言**。**相邻残留（非本条指控本身）**：组回滚未完成分支 `:813` 仍写作 `Outcome.recoveryRequired(detail=rollback)`，无 `keep=`——但其来源是组回滚结果而非适配器 release，不构成 F7-05 的指控。即：**对 v0.9 的指控成立，v1.0 已在 C6 恢复分支落地 `keep=`；VOPS-72 的端到端扩展尚未写入。**

#### F7-06［高］分次提交留下无法收敛的旧 operation 审计

**位置（Codex 所读 v0.9）**：Spec:660、Spec:696（每 attempt 创建审计）、Spec:813（仅终结、更新当前 `opAuditId`）、Spec:349（禁止全集完成前写终态审计）。

**问题**：attempt 1 只执行 A 后，全集 operation 保持 pending；attempt 2 新建另一条 operation 审计，最终仅更新当前 `opAuditId`，前一次审计没有闭合规则。

**影响**：原计划分多次提交时，历史 attempt 的 operation 级审计行会长期停留在 `pending`，且没有任何收敛规则能解释或关闭它们，审计不可解释。

**Codex 建议修法**：在 §4.2 / §4.4 明确逻辑 operation 与 attempt 审计的关系，持久化每次 attempt 的范围、结果和 auditId，并定义所有历史 pending 行的收敛规则。新增 **VOPS-77**：A/B 分两次完成及中途重启后，全部审计行可解释、无永久悬挂 pending。

**MiniMax Code 独立核实：属实。** 当前 v1.0 已把 operation 与 attempt 的审计关系写成 Normative：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:371-376`（一次调用 = 一个 attempt = 1 条 operation 级审计 + N 条 target 级审计；多 attempt 各有各的 operation 级审计行，`audit_key` 含 attempt 天然唯一；attempt 级审计行**随该 attempt 收敛**；attempt 之间**不得互相改写**对方的审计行；**悬垂 `pending` 行不得存在**）、`:378`（operation 记录与 attempt 记录分离，二者不共用一行）；`:861`（C7 只结算 `t.attempt == attempt` 的成员）、`:884-886`（按 `opAuditId` 更新本次 attempt 的审计行）。验收项 `VOPS-77`（`:1384`）已按本条建议新增。来源前提亦成立：审计同键重插被 `ON CONFLICT(idempotency_key) DO NOTHING` 静默丢弃（`webui/server/admin/audit.ts:802`，见 Spec `:367`）。即：**对 v0.9 的指控成立，v1.0 已按其要求定义 attempt 级审计的收敛规则并新增 VOPS-77。**

#### F7-07［高］执行态、持久态和聚合输入仍未统一

**位置（Codex 所读 v0.9）**：Spec:333（允许 skipped）、Spec:347（拒绝五态外值）、Spec:716（认领仅返回 auditId，随后设置 claimed）、Spec:331（attempt 为空一律视为 pending）。

**问题**：`skipped` 一处被允许归一化、一处又属于五态外错误；新认领成员只设置 `claimed`，没有给聚合所依赖的 `t.attempt` 赋值。

**影响**：同一状态值在两处得到相反判定；聚合输入缺少 attempt 标记，无法区分「从未执行」与「已认领未终结」，恢复流程会把已认领未终结的成员误判为未执行而重复执行。

**Codex 建议修法**：在 §4.2 / §6.2 增加明确的状态映射：claimed 仅为执行态，持久态为 pending；认领返回并设置完整成员记录及当前 attempt；移除 skipped 残留或明确定义合法归一化顺序。扩展 **VOPS-70/71**，验证首次全成功能够终结、认领后重启可识别。

**MiniMax Code 独立核实：属实。** 当前 v1.0 已按本条分离两层词汇：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:329-338`（**执行态** `claimed` 不落库，持久态为 `pending`；`:336` 明定「target 被认领时，**持久态写 `pending`** 且 `attempt` 取**本次 attempt 号**」；`:337` 明定「此前残留的 `skipped` / `reused` **一律废止**——不得出现在伪代码、持久化字段或验收断言中」；`:338` 聚合只接受持久态，遇到执行态 `claimed` 即抛错转 `ops_state_corrupt`）、`:340-344`（聚合输入按 `attempt` 区分「从未执行」与「已认领未终结」）、`:776-777`（C5 认领后同时设置 `t.state = "claimed"` 与 **`t.attempt = attempt`**，并附注「★ 聚合依赖它，必须赋值（F7-07）」）；缺口 `:511`（**G35**）；验收项 `VOPS-74`（`:1381`，损坏状态在认领前被拒）、`VOPS-70`（`:1377`）、`VOPS-71`（`:1378`）。即：**对 v0.9 的指控成立，v1.0 已废止 `skipped` / `reused` 残留并补齐 attempt 赋值。**

#### F7-08［中］追踪表与退出条件仍未双向一致

**位置（Codex 所读 v0.7）**：Plan:199（S2 退出条件含 `VOPS-59–VOPS-62`）、Plan:361（追踪表中 VOPS-61 只分配给 S5）。

**问题**：S2 退出要求 VOPS-61，但追踪表只将其分配给 S5。只读展开范围后的集合比较确认，其余阶段双向一致。

**影响**：VOPS-61（语义发布授权覆盖完整影响集）在 S2 的退出条件里被提前要求，而 S2 并不负责该断言，阶段门禁与责任归属不符。

**Codex 建议修法**：将 S2 写成 VOPS-59、60、62；或在追踪表明确增加 S2 的框架证据责任，并与 S5 实际发布证据区分。**无需新增 VOPS 编号。**

**MiniMax Code 独立核实：属实。** 当前 v0.8 已按第一种方案修正：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:207`（S2 退出条件逐项列出 **VOPS-59、VOPS-60、VOPS-62**，**不含 VOPS-61**）、`:269`（S5 退出条件含 VOPS-61）、`:371`（追踪表 `VOPS-61` 仍只分配给 **S5**）、`:369`（VOPS-59 分配给 S2、S5）。即：**对 v0.7 的指控成立，v0.8 已双向对齐。**

#### F7-09［中］旧的不可实现转换仍留在实施指令与验收中

**位置（Codex 所读 v0.7）**：Plan:98（文件职责仍要求转换）、Plan:135（修改清单仍要求等待 check 后定位 validationId）、Spec:1279 与 Plan:368（保留旧转换断言）、Plan:439（残留 G29/VOPS69 与第 6 轮待审叙述）。

**问题**：新 S5 已否定 check→validationId，但文件职责和修改清单继续要求这条转换；Plan 尾部还残留上一版计数与复审轮次。

**影响**：实施者按文件职责与修改清单照做，会去实现一条底层不可能存在的转换（批量 check 只产出校验报告与任务记录），并对不存在的产物写验收断言。

**Codex 建议修法**：统一改成「消费既有且获准消费的 staged 批次」；VOPS-68 改验合法 validation_id、普通 check/taskId 拒绝、快照可读可消费。删除尾部重复旧版本叙述。

**MiniMax Code 独立核实：属实。** 当前 v0.8 / v1.0 的清理情况：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md:136`（`semantic-batch-routes.ts` 已改为「**不改造**：批量校验端点的产物**只是校验报告**，**不得**作为可发布计划来源」——**原「提供批量校验终态查询入口」的要求已删除**）、`:107`（适配器单测要求 `taskId ≠ validationId`）、`:247-255`（S5 第 2 项重写为「必须消费【既有 staged 批次】的 `validation_id`」并逐条否定 check 产物）；Spec `:1375`（**VOPS-68 已改验**「preview 的 `plan_id` 必须是合法 staged 批次的 `validationId`；以普通 `taskId` / `operationId` 或不存在的 `validation_id` 调用一律拒绝；合法 `validation_id` 可读出计划并被 publish 消费」）；Plan §7 尾部（`:461-474`）已重写为第 1–7 轮落修表，**不再残留** G29/VOPS69 的旧版计数与第 6 轮待审叙述。
**残留（一处）**：Plan `:246` 仍保留旧链简写「包装 L25-11 既有批量服务（**scope → check → plan → publish**）」；虽其紧邻的第 2 项（`:247`）已明确「取代此前『scope → check → validationId → plan』的表述」，不构成实施指令，但措辞仍可能被误读。即：**对 v0.7 的指控成立，v0.8 / v1.0 已清理主要残留，Plan `:246` 尚存一处旧链简写。**

#### F7-10［中］recoverPending 的返回合同仍有两种叙述

**位置（Codex 所读 v0.9）**：Spec:681（注释写「恢复完成后再由本次 attempt 继续」）、Spec:689（`return recoverPending(...)`，下一行要求再次提交）。

**问题**：注释称恢复后由本次 attempt 继续剩余成员；实际代码提前 return，并要求调用方再次提交。

**影响**：恢复路径存在两种互斥合同：实现者按注释实现会「恢复即继续执行剩余成员」，按代码实现则「恢复后必须再次提交」；前者会在调用方未请求的范围内产生副作用。

**Codex 建议修法**：选定一种合同并统一注释、返回信封与 Plan S2。若保留提前返回，应明确返回恢复后的全集状态、尚未提交范围及需要再次提交；**恢复本次不得偷偷执行新范围**。新增 **VOPS-78**：恢复 A 后首次调用不执行 B，再次提交 B 才执行并聚合。

**MiniMax Code 独立核实：属实。** 当前 v1.0 已统一为「恢复只收敛、剩余成员必须再次提交」这一种合同，核验锚点：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md:710-722`（C3.3 注释明定恢复**只收敛**、**绝不执行任何新的范围**，并给出返回信封 `{ operation_state, recovered, still_unfinished, next_submit_required, next_submit_hint }`）、`:723-726`（`if hasUnfinishedClaimedTargets(opRec): return recoverPending(...)` 为**唯一返回路径**，其后即 `:727-729` 的合法性边界与新 attempt 开启，**不再有「恢复后继续执行剩余成员」的分支**）；Plan `:205`（第 38 条「恢复合同单一化」，同口径的返回信封与「剩余成员必须由调用方**再次提交**才执行」）、`:178`（四分支收敛，不得静默重跑）；验收项 `VOPS-78`（`:1385`）已按本条建议新增。即：**对 v0.9 的指控成立，v1.0 / v0.8 已统一为单一合同并新增 VOPS-78。**

## 处置台账

### 第 7 轮 10 条新发现的落点与当前状态

| 编号 | 严重性 | 修订落点（Spec／Plan／验收） | 截至本报告落盘时的状态（v1.0 / v0.8） |
|---|---|---|---|
| F7-01 | 阻塞 | Spec §6.2 C5 完整恢复既有成员状态（持久态/attempt/result/audit 绑定 + 先做五态校验）；缺口 G36；验收 VOPS-73 / VOPS-74 | **已闭合**：Spec `:739-747`、`:748-749`、`:752-756`、`:762-769`；`:512`（G36）；`:1380-1381`（VOPS-73/74）。**未经第 8 轮独立复审** |
| F7-02 | 阻塞 | Spec §6.4 分离 `requestedRefs` 与 `effectiveExecutionSet`，执行集固定为整个已确认原子组；§6.2 C3.1 执行集例外；缺口 G37；验收 VOPS-75 | **已闭合**：Spec `:1070-1078`、`:1115`、`:675-678`；`:513`（G37）；`:1382`（VOPS-75）。**未经第 8 轮独立复审** |
| F7-03 | 阻塞 | Spec §6.4 步骤 0–3 受信批次消费合同（同一 Agent staging / 显式交接 / 受信委托人三选一）；缺口 G38；**新增 D8 待 PM 拍板**；W-B 解锁挂起；验收 VOPS-76 | **未闭合（挂起待 PM 拍板）**：底层约束仍在（`semantic-assets.ts:2941-2956` 强校验 actor/instance，staging 走管理员 actor）；Spec `:1170`、`:1176-1181`、`:514`、`:1269`（D8 ⏳）、`:1235`（W-B 未解锁）、`:1383`（VOPS-76） |
| F7-04 | 高 | Plan §2 第 35 条要求「认领 + 审计绑定、终态审计更新、target 终结、operation 终结/进度写入」全部纳入异常协议；Spec §6.2 C7 / C7.2 各自入 try；扩展 VOPS-65 | **部分闭合**：C7 侧已入独立 try（Spec `:861-872`、`:882-897`）；**C5 认领仍在组级 try（`:798`）之外**（`:773-777`）；**VOPS-65 未按建议扩展**（`:1372` 仍只列三类异常） |
| F7-05 | 高 | Spec §6.2 C6 恢复分支改用 `keep=existingResultOf(t)`；扩展 VOPS-72 端到端断言 | **部分闭合**：Spec `:830-836`（`keep=` 已落地）、`:851`、`:826-828`；**VOPS-72 仍是 F6-06 口径，未扩展为端到端 release_id / 双轴保持断言**（`:1379`） |
| F7-06 | 高 | Spec §4.2 定义 operation 与 attempt 的审计关系（attempt 级行随 attempt 收敛、不得互相改写、无悬垂 pending）；验收 VOPS-77 | **已闭合**：Spec `:371-376`、`:378`、`:861`、`:884-886`；`:1384`（VOPS-77） |
| F7-07 | 高 | Spec §4.2 执行态 / 持久态分离（`claimed` 不落库、`skipped` / `reused` 废止）、认领补 attempt 赋值；缺口 G35；验收 VOPS-70 / 71 / 74 | **已闭合**：Spec `:329-338`、`:340-344`、`:776-777`；`:511`（G35）；`:1377-1381` |
| F7-08 | 中 | Plan S2 退出条件改为 VOPS-59、60、62；追踪表 VOPS-61 只归 S5；无需新增编号 | **已闭合**：Plan `:207`（S2 不含 VOPS-61）、`:269`（S5 含 VOPS-61）、`:369`、`:371` |
| F7-09 | 中 | Plan §3.2 文件职责与 §3.3 修改清单统一为「消费既有 staged 批次」；VOPS-68 改验合法 validation_id / taskId 拒绝 / 快照可读可消费；删除尾部重复旧版叙述 | **基本闭合，一处残留**：Plan `:136`（`semantic-batch-routes.ts` 改为「不改造」，旧「终态查询入口」要求已删）、`:247-255`、`:461-474`（尾部已重写）；Spec `:1375`（VOPS-68 已改验）；**残留 Plan `:246` 仍写「scope → check → plan → publish」旧链简写** |
| F7-10 | 中 | Spec §6.2 C3.3 恢复合同单一化（注释 / 返回信封 / 提前返回一致）；Plan 第 38 条同口径；验收 VOPS-78 | **已闭合**：Spec `:710-722`、`:723-726`、`:727-729`；Plan `:205`、`:178`；`:1385`（VOPS-78） |

### 仍需 PM / 客户拍板的开放项（Codex 第 7 轮原文要点）

| 开放项 | Codex 说明 | 阻塞性 |
|---|---|---|
| **D7 同写集原子组是否接受** | 共享文件决定技术约束，但「组内全成全败」改变了已确认的逐对象部分成功体验，审阅方不能代替 PM 接受产品语义收窄（依据 Spec:1174、Plan:56） | **开工阻塞** |
| **staged 批次由谁准备、如何授权 Agent 消费** | 选择新增 Agent staging 能力，或由其他操作者准备并显式交接，会改变首期范围及身份安全合同，不能由审阅方通过伪装 actor 或删除所有权校验解决（依据 Plan:242、`semantic-assets.ts:2941`） | **W-B 阻塞**；v1.0 已登记为 **D8**（Spec `:1269`）待 PM 拍板 |
| **控制面是否开放 deleteManifest / deleteOverlays** | 文档仍将其写成条件项；开放删除会扩大工具写集、恢复责任及客户可执行动作，属于产品范围选择（依据 Spec:438、Plan:214） | **对应删除能力的合同冻结阻塞**；应明确支持并完整设计，或首期显式拒绝 |
| **D6 后续期工具清单是否保留** | 后续范围与优先级选择（依据 Spec:1175） | **不阻塞当前首期设计修订** |

### 第 7 轮判定之后仍未闭合的项

- **3 项阻塞**：F7-01（既有成员状态被覆盖，失败痕迹被抹掉）、F7-02（适配器与通用执行范围不可同时满足）、F7-03（staged 批次归属，Agent 无权消费）——按 Codex 判定均为**不可交付开发**的前置项。
  - F7-01、F7-02 已在 v1.0 落修并新增 VOPS-73–75，**但未经第 8 轮独立复审**；
  - **F7-03 未闭合**：底层约束未变，已转为 **D8 待 PM 拍板**，D8 未决前 **W-B 保持未解锁**。
- **2 项部分闭合**：F7-04（C5 认领仍未纳入异常协议、VOPS-65 未扩展）、F7-05（`keep=` 已落地但 VOPS-72 未扩展为端到端断言）。
- **1 处措辞残留**：F7-09 的 Plan `:246`「scope → check → plan → publish」旧链简写（其后紧邻项已明确取代，不构成实施指令，但可能被误读）。
- **前序轮残留**：F6-07 虽被判已闭合，**Spec `:510` 的 G34 仍登记为「事务边界未定」**，与 Plan `:196` 的定案（同库不同表 + 同一事务）尚未对齐。
- **本报告不判定第 8 轮结果**：第 7 轮后 PM 要求**停止 Codex CLI**，故不存在第 8 轮外部复审；当前 v1.0 / v0.8 的闭合性由 MiniMax Code 自行回查源码得出，**不得据此宣称「已可交付开发」**。开工前仍须：D7 与 D8 的 PM 签字、需求审查签核、实施授权、W-B 另需 L25-11 审阅通过（G30／G31 由 L25-11 维护者关闭）。

## 关联文档

- 被审 Spec：[L25-16 运维控制面 MCP（lucy_ops）Spec](../specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)
- 被审 Plan：[L25-16 实施 Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)
- 第 1 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane.md](2026-10-28-codex-review-lucy-ops-control-plane.md)
- 第 2 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round2.md](2026-10-28-codex-review-lucy-ops-control-plane-round2.md)
- 第 3 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round3.md](2026-10-28-codex-review-lucy-ops-control-plane-round3.md)
- 第 4 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round4.md](2026-10-28-codex-review-lucy-ops-control-plane-round4.md)
- 第 5 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round5.md](2026-10-28-codex-review-lucy-ops-control-plane-round5.md)
- 第 6 轮审阅报告：[2026-10-28-codex-review-lucy-ops-control-plane-round6.md](2026-10-28-codex-review-lucy-ops-control-plane-round6.md)

## 本轮审阅交付的实际范围

本报告是第 7 轮 Codex 审阅结论的落盘件，**未修改 Spec 与 Plan 正文**，未修改任何运行代码、测试、运行配置、客户资产、数据库、镜像或部署，**未执行任何功能验证、浏览器验证、UAT、real-e2e 或发布**。本批文档产出**不构成实现授权**，也不产生验收证据；VOPS- 验收项状态不因本报告自动上调。第 7 轮的交付判定为**不可交付开发**，该判定在本报告落盘时**仍然有效**。

**第 7 轮之后 PM 要求停止 Codex CLI，本报告是最后一份 Codex 审阅报告**；此后由 MiniMax Code 自行收敛第 7 轮发现并逐条回查源码，因**未经第 8 轮独立复审**，任何一方均不得据本报告宣称「设计已闭合、可交付开发」。
