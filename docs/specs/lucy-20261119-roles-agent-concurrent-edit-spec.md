# 角色权限与 Agent 多人编辑冲突恢复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.2 |
| 日期 / 目标版本 | 2026-11-19 / 0.30.0 |
| 功能编号 / 优先级 | P1-59／REQ-030-080；P1，第二批 |
| 台账号 | 无；挂 0.30 产品线执行总账 |
| 阶段 | S5 |
| 收口范围 | scoped／仅B1：对象级冲突／草稿／三方比较／回执／删除占用重试；真实前台主路径。不含完整 F59、双身份百对、全部 DEP／E、R |
| 状态 | S5｜**v1.2；功能合同已收口（2026-11-22，scoped／仅B1；A1）**。证据＝[首批跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)＋[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。测试台仍 PASS WITH GAP（仅B1）。不入核心分母。≠ 可上线 |
| 授权来源 | 委托人2026-11-20明示授权补齐实现缺口、冻结候选并完成F58／F59和前台浏览器UAT，通过后按仓库规范收口；不做发布上线。 |
| 需求与总账 | [执行总账 P1-59](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[需求池 REQ-030-080](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 实施计划 | [配对 Plan](../plans/lucy-20261119-roles-agent-concurrent-edit-plan.md) |
| 测试台 | [UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE](../qa/uat/suites/roles-agent-concurrency-scale/suite.md)；最新判定只见 [INDEX](../qa/uat/INDEX.md) |
| 落位依据 | [DEVELOPMENT](../governance/DEVELOPMENT.md)「主路径可用性优先」「新增 Spec / Plan 的落盘清单」 |
| 设计评审 | [Cursor意见处理与终稿确权记录](../reviews/2026-11-19-roles-agent-design-finalization.md)；委托人明示免Codex CLI终审，不主张CLI审阅通过 |

## 2026-11-20 分批交付决议（本轮执行边界）

委托人批准“暂停长测，收敛当前优化，分批继续”，并明确“收口，commit本进程”。**2026-11-22**：委托人勾选 **A1**（仅 B1 → scoped S5）并授权改 Spec／收口。

- 首批（**本条 scoped 出口**）：冻结本进程已实现的对象级提交与草稿／回执恢复；短回归、类型检查、真实前台查看／新建／编辑／删除及冲突恢复。范围、候选指纹和实际结果以[正式跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)为准。
- 第二批（延期，不自动执行；**不在本 scoped 出口**）：完整F58／F59、B／2×／5×三轮、固定窗口历史增长、双身份每类百对授权写、全部DEP与剩余局部故障矩阵、精确改前对照及索引完整成本。仍沿用原预算与判定器。
- 本次增量不包含其他进程的P1-66或核心可用性改动；共用文件保留已提交P1-66父版本，其他未提交任务排除。现网502／503具体原因未取得运维证据，不能因本轮优化宣称已定位或消除。
- 发布取证R、发布、上线均未执行；本条 scoped 收口不构成面向用户更新的放行签字。

## 闭口层级

- 层级：功能合同
- 本条承诺：多人并发维护角色和 Agent 时，无关对象修改可以安全先后完成，相关修改冲突可解释、可保留草稿并重新确认，任何失败或响应丢失都不冒充保存成功。
- 本条出口：scoped v1.2／仅B1 — B1 已验主路径（见收口范围与 batch1 跑次）。完整 SC-01–SC-13 矩阵保留为第二批合同，不因本 scoped 收口计 PASS。
- 不在本条出口：完整 F59；双身份百对；全部 DEP／E；整库旅程；线上事件归因与升级；R。
- 上线关系：本条收口不表示可上线

## 1. 事实与范围

- Role／Agent 均写 `webui/config/access.yaml`，全文件版本会使不同对象的保存互相冲突。
- 既有 publish-coordinator 还协调语义写入和索引激活；占用返回 PUBLISH_COORDINATOR_BUSY，合同明确禁止静默排队。本条保留该边界，不以“解决并发”为理由拆掉全局提交窗口。
- 当前会话实现每次登录独立签发；同账号多电脑不等于共享一份浏览器会话。本条覆盖独立 Cookie 的同账号／不同账号，不修改登录、限流、密码与会话撤销策略。
- 范围为 Role／Agent 的既有创建、编辑、复制、删除，以及结果确认交互；Token 签发／续期／吊销合同不在本条修改范围。Agent 表单不得通过新协议编辑凭据内部字段。
- 单进程、单副本内并发；不设计分布式锁。版本摘要和草稿不是授权依据。

## 2. 决策

| 编号 | 决策 |
|---|---|
| D1 第一批体验 | 所有冲突保留原始快照与本地草稿；区分目标变化、依赖变化、发布占用、保存结果未知 |
| D2 第二批协议 | 在原 API 上增加对象版本与预览凭据；旧调用方的全文件 version 保持原语义，不静默解释成对象版本 |
| D3 安全提交 | 最新基线重读、对象比较、依赖复核、候选重建、门禁、写入、运行时确认与审计终态仍在同一个发布窗口 |
| D4 冲突粒度 | 目标对象未变且预览依赖未变，可把 patch 应用到最新整份配置；同对象修改一律人工比较，不自动合并授权字段 |
| D5 写入边界 | 发布占用立即返回可解释结果；不静默排队，不自动重试 POST／PATCH／DELETE |
| D6 响应未知 | 通过 operationId 只读核对提交终态；无足够持久证据时返回 unknown，不能以“当前值相同”推断自己保存成功 |

本条只承诺减少无关对象的假版本冲突，不承诺并行写盘或无限吞吐。正式提交仍受单发布窗口串行约束；预览可并行，窗外预计算只作建议候选，进入窗口后必须重读、重算最终依赖／效果并重新鉴权。模块验收为 F59，联合吞吐、慢盘、60 分钟与系统重启为 R 发布选择器；[suite 分层矩阵](../qa/uat/suites/roles-agent-concurrency-scale/suite.md#验收分层矩阵) 是映射真源，不能把 R 未跑倒挂为本条所有 SC 未完成。

## 3. 对象版本与预览凭据

### 3.1 规范摘要

对象版本为 `kind + id + canonicalWritableObjectDigest`，摘要含所有影响该对象可写状态与语义的字段；不含审计统计、当前时间、显示派生字段。未知字段不得在规范化时静默丢弃；数组仅对语义为集合的字段做规范化；行策略与有序规则保持顺序。

创建使用不存在标记，并复核同 ID 存在性、模板保留 ID 与退休状态；复制同时校验模板／源对象；删除除对象版本外还复核当前引用与保护规则。对象被删除后，旧草稿只能查看或基于新 ID 显式创建，禁止旧请求使其复活。

### 3.2 与预览绑定

预览凭据绑定目标对象版本、规范化 patch 摘要、实际依赖摘要、候选效果与门禁决定摘要、身份／授权边界。依赖最少包括：引用角色定义、行策略模板、启用表／来源映射、分类版本、默认策略、引用关系及门禁所需最新事实。

提交时重新计算这些输入。其他对象变化不直接使目标冲突；但若改变本次效果、引用、授权或审批门槛，必须重新预览并由用户再次确认。动态调用计数每增加一条不应单独形成假冲突：门禁事实按其决定／风险级别及需确认的影响面绑定，提交仍以最新事实重评，跨阈值或决定变化必须重新确认。禁止把整个 access 文件 hash 伪装成对象依赖，否则无关冲突没有真正减少；也禁止只检查目标而漏掉权限影响面变化。

预览凭据不是扩大权限的通行证：提交时重新鉴权、校验恢复门禁及对象保护；主体被禁用、会话撤销或权限收紧即按现有规则拒绝。

### 3.3 依赖正反例矩阵（规范性）

`previewEffectDigest` 只表示本次目标修改的授权／引用／风险／确认效果；`candidateConfigDigest` 是实际整份配置提交摘要。两者不能混用：后者因无关对象变化而改变，不应单独造成重新预览。当前对象原文的未知字段进对象摘要但不可通过 patch 任意写入，patch 白名单仍沿用现有验证器。

| 键 / 输入变化 | 摘要与重检要求 | 预期裁决 | UAT 子项 |
|---|---|---|---|
| DEP-01 目标可写字段或目标未知字段改变 | 进 baseObjectVersion；未知字段完整保留 | 同对象冲突，不静默覆盖 | 10／11-D01 |
| DEP-02 引用角色、行模板、Agent constraints 改变 | 实际依赖对象摘要与 fresh 效果均重算 | 依赖摘要变化重新预览；不能用同数量掩盖集合变化 | 11-D02 |
| DEP-03 启用表／来源映射／默认策略／分类版本改变 | 重算实际读取到的编译输入闭包 | 命中闭包则重新预览；闭包外且效果不变不得假冲突 | 11-D03 |
| DEP-04 与本目标完全无关的 Role／Agent 描述改变 | 不进依赖，不能退化成整文件 hash | 正常基于新整份配置应用 patch | 09／11-D04 |
| DEP-05 删除 Role 时新增引用、模板 ID／退休状态改变 | 存在性、引用集、保护规则重检 | 有引用／退休则按既有规则拒绝，不允许重预览绕过；其他影响变化重新确认 | 10／11-D05 |
| DEP-06 调用计数增加但决定／风险／影响面不变 | fresh 重评；不把原始计数逐条入 digest | 不仅因计数变化制造冲突 | 11-D06 |
| DEP-07 门禁跨阈值、敏感源集或需确认影响面改变 | 决定、风险级别及确认材料入效果摘要 | 重新预览／既有门禁拒绝，不能复用旧确认 | 11-D07 |
| DEP-08 会话撤销、账户禁用或操作权限变化 | 当前身份始终 fresh 鉴权，不靠摘要放行 | 按当前权限拒绝；其他合法主体继续可用 | 11-D08 |
| DEP-09 仅配置统计、lastSeen、时间改变 | 不进对象摘要；计数仅按 DEP-06／07 处理 | 不改变对象版本，不制造假目标冲突 | 11-D09 |
| DEP-10 对象数组／未知字段规范化 | 明确为集合的字段只比较其集合语义；有序规则保留顺序；未知结构递归稳定编码 | 集合次序变换等价，有序规则或未知值改变不等价；不能丢未知字段 | 10／11-D10 |
| DEP-11 创建／复制目标由缺席变存在或复制源改变 | 缺席标记、源对象与目标 ID 分别绑定 | 已存在目标拒绝；源对象变则重新预览 | 10／11-D11 |

闭包清单从本次 fresh 编译过程实际读取的输入及引用追踪得出；新增一种编译／门禁输入必须先扩展矩阵与正反用例。无法证明某输入在闭包外时不得忽略，返回明确“影响范围待核对”并提供 fresh 重新预览；不得用全文件冲突长期替代依赖识别。

### 3.4 对象摘要金样本

- 正例：对象字段键顺序变化、已由既有语义定义为集合的 tools 重排，不改变对象版本。
- 反例：未知字段值／未知嵌套数组顺序变化、行策略谓词值变化、既有有序规则换序，必须改变版本；不能以序列化前删除未知字段实现“稳定”。
- `role` 与 `roles` 等历史兼容表示按既有运行时等价规则处理，不能自行发明归一化。无规则证明的表示保守判不等价并让用户 fresh 预览。

## 4. API 与结果协议（已实现；完整矩阵待第二批）

现有 Role／Agent 写接口增加可选扩展：`baseObjectVersion`、`previewToken`、`operationId`。新 UI 使用这三个字段；legacy `version` 请求继续走全文件比较；同一请求同时携带互相矛盾的版本依据时拒绝，不猜测调用方意图。默认读取接口保留 `version`，额外返回对象版本，敏感原文不进入通用列表。

| 结果 | 行为 |
|---|---|
| 目标变化／删除 | 409，沿用 VERSION_CONFLICT 或既有对象变化码；详情携带冲突类型、当前对象版本和经脱敏的差异 |
| 依赖变化 | 409，明确重新预览，不复用原确认；本 Spec 登记拟议工程码 PREVIEW_INPUT_CHANGED |
| 发布窗口占用 | 保留现有 PUBLISH_COORDINATOR_BUSY；显示“有变更正在保存，请稍后重试”，保留草稿 |
| 正式提交成功 | 仅 committed 且运行时确认／审计终态满足现有合同后返回成功；返回绑定本次提交的 after 与对象版本 |
| 回滚／恢复未完成 | 维持既有失败与恢复合同，不返回 written=true |
| 客户端超时／断网 | UI 显示“保存结果待确认”，只读查询本次 operationId，不重放写请求 |

拟议 `GET /api/admin/access-write-status/:operationId`：鉴权后仅允许原提交账号或现有所有者权限读取最小状态；请求号不得作为访问凭证。响应只含 committed／not_committed／unknown、目标标识、提交版本及必要恢复提示，不返回 Token、原始 YAML、其他操作者草稿。

终稿前只读代码核查已完成，结论与确定接法见 §4.1；不新增持久表／列／索引。只有完整终态证据才给 committed 或 not_committed；审计不可达、仅有 intent、旧记录缺操作回执或找不到终态均为 unknown。

前端自动只读核对最多 3 次、总计不超过 6 秒；仍 unknown 时保留草稿与请求编号，提供再次核对和读取最新值比较。最新值相同只能提示“当前配置与草稿一致”，不能伪装成本次操作成功；新提交必须重新预览、明确确认并使用新 operationId。operationId 重复时不再次执行已确认提交；证据不足则返回未知，不重新写入。

共用账号时审计只能准确到账号／会话／操作，不能声称识别实际哪位人员；推荐独立账号便于追溯，但不将换账号设为完成合法编辑的前置条件。

### 4.1 审计可关联性核查与接法（只读设计结论，非运行验证）

| 已核实底座 | 代码事实 | 现有缺口与确定处理 |
|---|---|---|
| 持久 intent／terminal | `webui/server/admin/config-audit-write.ts` 在同一 config_change_log 行先 pending 后更新终态 | 继续使用，不另建状态库 |
| 幂等字段与唯一索引 | `webui/server/admin/audit.ts` 已有 request_id、idempotency_key、write_status 与 uq_ccl_idempotency | operationId 不覆盖服务端 requestId；映射为新协议专用 idempotency_key |
| 安全归因 | `webui/server/security/request-actor.ts` 从已验证上下文提供账户、会话和 requestId | 账户不可变 UID 绑定到操作回执，不从 body.actor 取值；显示 ID 重用不继承查询权 |
| 运行时确认次序 | `access-config.ts` 先 evaluateRuntimeAck，再 committed terminal | 保持次序；仅 audit committed 不能取代运行时确认的原合同 |
| summary 扩展 | 非认证配置事件的 new_summary 为 JSON，经 redactAuditSummary 深度脱敏 | 写入最小回执；当前普通 Role／Agent 事件未贯通本协议，不能声称开箱可用 |

新协议确定使用现有行：`idempotency_key = "racs-v1:" + SHA256(operationId)`，operationId 为客户端随机 UUID，服务端验证格式；由既有唯一索引认领。`request_id` 保持可信请求编号，另在 `new_summary.racsReceipt` 存：`schemaVersion`、原账户 UID、对象种类／ID、规范请求摘要、目标对象版本、实际整配置 candidate 摘要及终态所需的最小运行时确认字段。摘要采用脱敏器不会改写的固定十六进制表示；不得存 Cookie、Token、完整 YAML 或完整 after 对象。

intent 写入时已绑定账号、目标和请求摘要；终态更新合并并保留回执，不能用旧 newSummary 覆盖它。同 operationId 请求必须在发布窗口内再次查唯一键：同账号／同请求只回已知结果；不同请求摘要拒绝；不同提交账号不允许将其认领为自己的写入，查询仍只向原 UID 或 owner 开放。数据库唯一键冲突不能仅因返回旧 auditId 就继续落盘；没有成功首次认领就不得执行变更。

连续审计保留是该幂等保证的边界：正常恢复／重启保留原表，不新增 purge。若实例审计被人工清空、恢复到提交前备份或回执版本不可识别，只能报 unknown 并走既有恢复核查，不能声称跨审计丢失仍能去重。只有首次未认领的新操作、且已验证的新预览可以建立新 intent；恢复后未能排除旧操作的请求不得重放。

历史 committed 只证明本次操作当时已提交，查询返回 `committedObjectVersion`／`committedConfigDigest`，不声称该配置至今未被他人修改。after 不从当前文件伪造；响应丢失后只回最小持久回执，如用户需看当前对象，另发 fresh GET，明确当前值与历史提交结果的区别。

未知与失败分开：不存在记录不等于“未提交”；仅 failed／rolled_back 且恢复已确认才可报告 not_committed。rollback 未确认、pending、数据不可达和旧摘要缺失均 unknown。不得把永久 unknown 当成功，也不得允许 unknown 自动触发新写入。若实施时发现上述字段无法无损通过现有序列化／更新链路，视为本设计被证伪，停下修订设计；不在 Task 4 临时改 schema。

## 5. 草稿与冲突交互

草稿默认留在当前页内存，冲突或读取刷新不得覆盖；不把完整权限配置、凭据及其他人员数据新增到 localStorage。离开页面会失去内存草稿时须沿用未保存提示。

冲突区域并列展示基线、本次修改、当前值；所有内容按当前权限脱敏。用户可选择取消保留／重新编辑、读取最新值或重新预览；不提供“强制覆盖他人”按钮。若当前身份已无权读取，保留其可见的原草稿并提示登录或联系有权账号，不通过冲突接口泄露最新对象。

角色详情与 Agent 详情是编辑面；列表上的创建／新建弹窗失败时同样保留当前输入。保存成功只更新本次提交绑定的对象，不在发布窗口外重读并误配其他人的新版本。

## 核心流程（伪代码）

```text
save(request):
  authenticateAndAuthorize(request)
  validatePayloadAndProtocolCombination()
  if knownTerminal(request.operationId): return authorizedBoundOutcome()
  if sameOperationInProgressOrUncertain(): return unknownWithoutReplayingWrite()
  if publishWindowBusy(): return existingBusyWithDraftRecovery()
  withExistingPublishWindow(() =>:
    checkRecoveryGate(); recheckCurrentAuthorization()
    recheckOperationIdDurableStateInsideWindowOrRefuseReplay()
    latest = rereadWholeConfig()
    if legacyProtocol(): compareWholeFileVersionExactly()
    else:
      compareTargetObjectOrAbsence(latest, request.baseObjectVersion)
      if changedOrDeleted: return explicit409WithoutWrite()
      candidate = applyPatchToLatestNotOldSnapshot(latest, request.patch)
      recomputeReferencesAndAllPreviewDependencies(candidate)
      if changed: return repreview409WithoutWrite()
    rerunFreshValidationAndGovernanceGate()
    if refused: return existingActionableRefusal()
    durableIntent(operationId)
    writeAtomically(); commitRuntimeAndRequiredAudit()
    if failed: runExistingRollbackOrRecovery(); return honestFailure()
    captureBoundAfterAndTerminalInsideWindow()
    return committedBoundOutcome())

onClientTimeout(operationId):
  keepDraft(); showPendingConfirmation()
  boundedReadStatus(operationId)    # 不重放原写请求
  if committed: showBoundCommitNotLatestUnrelatedWrite()
  else if not_committed: allowFreshPreviewAndExplicitNewSubmit()
  else: showUnknownWithRecheckAndLatestValueComparison()
```

## 受影响画像

依据 [画像规范](../governance/user-personas.md)，均为待验证设计目标。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| 问数方 | 治理提交仍须按现有规则生效 | 单提交边界与权限收紧维持现有语义 | ＝ | SC-05／07；组合 UAT-RACS-12 | 纯 MCP 不要求 WebUI；合法未受影响查询继续完成 |
| 治理方 | 无关对象冲突、刷新可能丢草稿 | 无关对象可先后提交，同对象可比较；结果未知需多一步核对 | ↓（按最差子面） | SC-01–04／08–11 | 草稿保留、同页结果核对与重新预览；UAT-RACS-09–11／14；不强制换账号 |
| 运维方 | 保存超时难区分提交和失败 | operationId 可核对，未知如实披露 | ↑ | SC-08／09／12 | 无负向，不新增部署依赖 |
| 管理层 | 共用账号操作难精确归因 | 审计绑定操作但不冒称实名归因 | ＝ | SC-12 | 审计可信边界不扩大，不虚构个人身份 |

结果未知时的 ↓ 通过只读核对、草稿和 fresh 重新预览补偿；不得让用户永久停在不可操作状态。补偿未验通不得收口。

## 6. 验收

| 编号 | 本条可打假检查 |
|---|---|
| SC-01 | 两客户端从同一整文件基线编辑不同 Role／不同 Agent／Role 与无关 Agent，先后提交后两项均保留 |
| SC-02 | 同对象并发一成功一明确冲突；禁止覆盖、删除后复活及通过复制绕过退休 ID |
| SC-03 | 原始值／草稿／当前值可比较，刷新不覆盖草稿，重新预览后能合法完成保存 |
| SC-04 | DEP-01–11 的正反例全部成立：相关变化要求确认或拒绝，无关变化不制造冲突；对象摘要金样本覆盖未知／有序／集合／缺席表示 |
| SC-05 | 等待发布窗口期间主体禁用／会话撤销／权限收紧，提交重检拒绝；未受影响主体仍可保存 |
| SC-06 | 发布占用返回现有 BUSY，不静默排队、不盲目重发；空闲后用户显式重试并重新校验可以成功 |
| SC-07 | 真实进程中写入失败、运行时确认失败或审计失败不返回成功；回滚／恢复门禁保留 |
| SC-08 | 提交后仅阻断响应，按 §4.1 现有行回执核对绑定终态；仅报历史提交不冒充当前生效；重启后无终态时如实 unknown |
| SC-09 | 唯一键首次认领、同号不同内容／账号、pending、回执缺失等均按 §4.1 分流，不重复落盘；未知状态有界核对与恢复入口，不自动重放 |
| SC-10 | legacy 全文件 version 行为兼容；新对象版本摘要覆盖未知字段、有序规则与不存在状态 |
| SC-11 | 同账号独立会话与不同账号均覆盖上述成功／冲突；登录不互踢；401／429 不误报成保存成功 |
| SC-12 | 审计、after、对象版本与本次 operationId 一致；状态接口按权限隔离且不泄露敏感配置 |
| SC-13 | 下列全部元素在一个桌面视口有真实浏览器证据，含创建／编辑／删除失败的草稿与恢复 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 「保存结果待确认」：仅用于请求响应丢失而提交终态未核实；禁止写「保存失败」或「保存成功」。
- 「配置已变化」：对象版本冲突，说明需比较并重新预览；禁止含糊提示“系统异常”。
- 「有变更正在保存，请稍后重试」：沿用发布窗口占用语义；不表示排队受理。工程码、版本摘要与 operationId 放可展开详情，不作为主操作文案；对象名、路径和 URL 保留翻译防御。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/13-components-toast.md`
- `webui/docs/design-system/15-components-overlay.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- 冲突与未知结果留在表单／抽屉内，不仅发 Toast；保留输入，失败后恢复操作。
- 复用现有浮层与状态组件，每个 action group 一个 primary；提交中禁止重复点击。

### Exceptions (If Any)

- 无，不新增视觉模式。

### Follow-up Needed

- 实现前完成交互评审；若既有编辑浮层需按规范迁移，只限本条触达范围，不能夹带全站整改。

## 交互合同

- 路由：/admin/roles、/admin/roles/:roleId、/admin/agents、/admin/agents/:userId
- 基准页：/admin/agents
- 一件事：保存角色或 Agent 时能辨明冲突、保留修改并完成明确确认。
- 状态：首访：读取对象与基线；空：不适用：创建未保存对象不属于空名册状态；加载：预览或保存中防重复；错误：冲突或占用有原因与下一步；0 条：不适用：此合同只覆盖编辑事务；成功：本次提交已确认才反馈成功；部分：保存结果待确认可核对且草稿保留
- 主动作：当前步骤的预览或保存或重新预览最多一个 primary；不做强制覆盖与静默自动重发。
- 决定信息：基线、本次修改、当前值、冲突类型与保存确认状态。
- 术语：本条新增文案见 Terminology Compliance，工程字段不作用户主术语。
- 台账：无新台账
- 状态维度：冲突、占用、结果未知分开呈现，同一状态维度不得互相否定。

## 元素清单

- E1｜/admin/roles｜首访｜创建入口｜可进入既有角色创建流程
- E2｜/admin/roles｜加载｜创建流程｜保存期间防重复
- E3｜/admin/roles｜错误｜创建流程｜冲突或占用后输入保留
- E4｜/admin/roles｜成功｜创建流程｜仅已确认提交反馈成功
- E5｜/admin/roles｜部分｜创建流程｜结果未知可核对
- E6｜/admin/roles｜主动作｜创建流程｜当前步骤一个 primary
- E7｜/admin/roles｜决定信息｜创建流程｜目标 ID 与确认状态可见
- E8｜/admin/roles/:roleId｜首访｜编辑区｜对象与基线可识别
- E9｜/admin/roles/:roleId｜加载｜编辑区｜预览和提交状态可辨
- E10｜/admin/roles/:roleId｜错误｜编辑区｜冲突比较且草稿保留
- E11｜/admin/roles/:roleId｜成功｜编辑区｜绑定本次提交的结果
- E12｜/admin/roles/:roleId｜部分｜编辑区｜未知结果能继续核对
- E13｜/admin/roles/:roleId｜主动作｜编辑区｜不提供强制覆盖
- E14｜/admin/roles/:roleId｜决定信息｜编辑区｜三方差异和依赖变化可见
- E15｜/admin/agents｜首访｜新建弹窗入口｜入口沿用名册
- E16｜/admin/agents｜加载｜新建弹窗｜保存中禁止重复提交
- E17｜/admin/agents｜错误｜新建弹窗｜失败不丢表单
- E18｜/admin/agents｜成功｜新建弹窗｜确认后进入新对象
- E19｜/admin/agents｜部分｜新建弹窗｜结果未知先核对
- E20｜/admin/agents｜主动作｜新建弹窗｜当前步骤一个 primary
- E21｜/admin/agents｜决定信息｜新建弹窗｜目标 ID 与确认状态可见
- E22｜/admin/agents/:userId｜首访｜编辑区｜读取 Agent 与版本
- E23｜/admin/agents/:userId｜加载｜编辑区｜预览保存互斥且有状态
- E24｜/admin/agents/:userId｜错误｜编辑区｜冲突或删除失败有恢复
- E25｜/admin/agents/:userId｜成功｜编辑区｜成功对应本次提交
- E26｜/admin/agents/:userId｜部分｜编辑区｜结果未知保留草稿
- E27｜/admin/agents/:userId｜主动作｜编辑区｜重新预览后才可提交
- E28｜/admin/agents/:userId｜决定信息｜编辑区｜三方值与角色依赖可核对

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 8. 修订与设计评审记录

2026-11-19 吸收依赖矩阵、审计核查前移与串行吞吐措辞建议；核查已有配置审计与脱敏更新链路后选定 §4.1，无 schema 决策留待实现中途。六问为合同设计评审通过，不是浏览器已测。E1–E28 编号稳定，草稿只在本页内存，离页提示；跨关页不保留完整权限草稿，用户持有 operationId 可重新登录后核对最小回执。


## 2026-11-20 实现补齐说明

新建Agent由服务端生成不可编辑的`object_generation`，保存在原access.yaml对象中并参与既有规范摘要；旧对象缺少该字段仍兼容。新建请求与patch均不能指定或修改该标记，同ID删除后重建不能让旧草稿的对象版本重新相等（ABA）。它是内部版本事实，不增加用户操作、产品概念、数据库表或Token／登录协议。创建预览绑定用户输入与权限效果，正式提交回执绑定实际对象版本和整配置摘要。
