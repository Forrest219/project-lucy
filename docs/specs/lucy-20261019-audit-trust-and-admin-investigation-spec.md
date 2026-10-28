# Lucy 审计可信度与管理员调查优化 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | Cross-module Product / Security / Audit Spec |
| 版本与日期 | v0.1，2026-10-19，Asia/Shanghai |
| 状态 | 设计交付；**主体运行时骨架已实施**（2026-10-19-r1／2026-10-25 r2 批次，见 `docs/reviews/2026-10-28-l25-09-audit-trust-stage1-implementation-record.md`）；**管理员第一现场（§5）已于 2026-10-28 接入 Audit 页与 P0-4 使用概况页**。**现场验收（EA 矩阵）仍未执行**，本状态不表示验收已通过 |
| 委托人 | Forrest |
| 设计与验收 | Codex |
| 计划实施 | Claude Code；逐批提交实施证据后由 Codex 评审验收 |
| 范围 | Lucy Proxy、安全账本与审计投影、管理员访问日志、导出、受控客户端审计接入契约 |
| Plan | [实施计划](../plans/2026-10-19-audit-trust-and-admin-investigation-plan.md) |
| Acceptance | [验收矩阵](../qa/audit-trust-and-admin-investigation-acceptance.md) |
| 依据 | 用户批准 `inbox/codex-cross-review-claude-lucy-audit-2026-10-19.md`；下文保留必要事实，临时文件删除不改变本契约 |
| 部署边界 | 单实例、单副本；开发 Mac arm64，客户 linux/amd64 Kubernetes；只改 Lucy，不改 KTX |

## 1 目标与证据基线

管理员应能够从一次访问回答：谁的凭证、哪个客户端、用了什么权限、执行了什么动作、返回了多少数据、问询关联是否可信、证据覆盖到哪里。执行成功不能被展示成授权意图充分、归属已验证或结果没有外发。

本次已经核实的回归基线如下。保留数值作为测试断言；正式仓库仅使用脱敏、合成夹具，不提交原始业务结果、问询原文、凭据或个人目录。

| 事实 | 回归断言 |
|---|---|
| 调用 CSV | 105 条数据记录，表头另计；105 条 tool 全部非空 |
| 调用构成 | 103 次工具调用＋2 次 server/discover 协议拒绝；四端分别 8、11、46、38 |
| 证据包 | 119 条访问记录＝105 条筛选记录＋14 条关联握手；五个文件哈希均匹配 |
| 问询列表 | 7 个分组中有2个仅握手；1/7约14%算术正确，但不代表真实用户问询覆盖率 |
| 错误归属 | 第二轮登记2078及2079–2082共5次；错误关联还含2070、2072、2076、2077及1912、1914、1916 |
| 并发与请求ID | request_id=8跨三个会话出现，不是全局事件主键 |
| 权限快照 | 两条按权限内容重算均匹配；不包含时间窗，同内容可复用 |
| 客户端身份 | client=workbuddy、reported_client=lucy、User-Agent=WorkBuddy/5.8.3；识别家族不等于软件认证 |
| 排障行为 | WorkBuddy九次同类聚合错误；MiniMax最终1995查询去掉此前尝试中的日期过滤，返回5行4列 |

未获证实的“38个空tool”“同IP证明没有代理信任链”“维护空日志证明没开启审计”不得进入缺陷清单或发布阻断条件。

## 2 生效关系与非目标

本 Spec 是已有能力的增量修订。Claude 在 T00 更新下列原规范的修订表及测试映射，禁止维护互相冲突的两套行为；本次设计交付不直接覆盖这些已有未提交文件。

| 既有规范 | 保持内容 | 本次明确替代或补充 |
|---|---|---|
| Spec 08 / 138 / 162 / 172 / 173 | begin可选、未登记仍可按ACL查数、原文最小记录、现有归因枚举 | 取消仅凭120秒近邻批量向前补绑及写完成时重新归属；不再将会话候选视为高可信问询关联；仅握手不进入业务问询分母 |
| Spec 131 / 182 | lucy_admin特例、普通角色连接边界、启用表范围交集 | 增加可读授权投影、扩权证据导航；不改变授权代数，不自动增授权 |
| Spec 137 / 140 / 141 / 185 | 现有导出端点、大小限制、SQLite backup、字段说明 | 固定同一序列上界与快照，解释补入事件、分页、延迟和完整性边界；保留原始导出重放能力 |
| 20261018企业安全Spec §5与ADR | 持久安全账本、先持久后释放、幂等投影、最小记录、受控恢复 | 复用eventId/operationId；新增关联修订和审计管理动作覆盖，不另建竞争性事实源 |
| 术语标准 §4.7 | 问询、调用流水、事件ID、归因方式等主术语 | 修订工具调用数的旧“触达物理表”定义；新增候选关系、采集范围等术语见本Spec登记 |
| Spec 125 / 网格设计规范 | 生成SQL仍可直接查阅，允许局部横向滚动 | 默认列可调整；不得撤掉既有授权SQL调查入口，也不以整页无滚动作为安全指标 |

本期不修改运行中的demo、客户配置、真实数据库授权或历史原始日志；不重建镜像或部署服务；不建设多副本架构；不修改任意外部商业客户端源码；不承诺全设备监控或模型内部思维审计。既有客户发版门禁保持，功能验收通过不自动授权发布。

## 3 交付范围与安全声明

| 范围 | 必交内容 | 不可替代的证据 |
|---|---|---|
| Lucy本体 | 本Spec全部本体AC；未接入端如实显示后续不可见 | HTTP/Proxy集成、迁移回归、管理员桌面操作证据 |
| 受控客户端 | 本体＋T06审计接收与至少一个参考适配器，覆盖前置拒绝、结果接收、产物或目的地事件 | 一个真实受控客户端的完整旅程；模拟发送器只能证明接口合同 |
| 客户外部保全 | 按客户冻结profile额外要求SIEM/WORM/独立签名或受保护归档 | 本候选版本到外部接收端的真实回执与验签/只读保全证据；缺环境为blocked |

这些范围不删减全量需求，只决定哪些能力可以被宣称已验收。T06没有真实客户端时，本体可单独验收，但不得标记“端到端审计闭环完成”。高敏数据接入前仍需既定凭证、脱敏及网络出口控制；客户端自报去向事件不构成防外发措施。

## 4 统一数据契约

下列为逻辑合同。优先复用现有安全事件、API及响应元数据；确需新增列/事件类型时，T00提交精确的类型、接口及幂等迁移清单，Codex核对符合本合同后再实施。禁止将拟议字段描述成已经存在。

### 4.1 事件身份与关联

- 全局事件身份复用安全账本eventId，操作过程复用operationId；审计投影自增id只在实例与该投影内有效。保留instanceId/启动代次、sessionId、RPC request_id、traceId、attemptId及可选parentAttemptId。
- 凭证使用服务端持久标识或内部完整摘要关联；展示短hash仅供定位，不用于安全比较。token_label是备注，不是使用人或唯一身份。
- 显式问询使用已有 `x-lucy-turn-id`，服务端验证同一主体、凭证及绑定会话；验证失败仅拒绝关联，业务调用沿既有兼容/ACL策略处理，不能获得额外权限。
- 保留mode枚举 explicit/session_bound/identity_inferred/unassigned、confidence枚举high/low/none；新增独立关联状态 confirmed/candidate/unassigned/conflict/legacy_unverified。confirmed仅来自合法显式关联或begin自身。
- 自动会话归属只形成candidateTurnId及low置信候选，不混入已确认调用数；无唯一候选为unassigned。没有session的身份近邻最多是候选，不能确认为真实问询。
- 记录请求准入时的关联判断及所用规则版本；响应完成不重新按最新问询归属。旧mode和旧turnId保留原貌；新读取投影分开给出originalAssociation与effectiveAssociation。
- 历史更正以受认证管理员的追加修订事件记录原值、新值、理由、依据、版本及操作者；不能直接UPDATE原始账本。旧高置信auto关联默认legacy_unverified，不能静默升级为confirmed。

### 4.2 身份与权限

返回凭证主体Agent、显式使用人actor（允许未知）、客户端家族、原始自报客户端/版本、识别依据、实例标识及其可信来源。受控适配器身份绑定凭证范围，自报不自动转为可信。

保留socket peer、forwarded chain和经可信代理边界验证后的来源地址；对端不在可信网段或入口不能保证剥离外来头时，不接受转发头作为可信来源。展示原始转发头不得影响ACL。多个客户端共享NAT地址合法。

生效权限快照按既有内容算法计算，时间独立存储。可读授权投影列出角色、连接、来源、工具、行权限及命中原因，受管理员可见性限制。lucy_admin明确提示覆盖全部已配置连接并随重编译扩展，普通catalog_bound不扩展到未声明连接。展示policy_scope_expanded对应配置审计证据；高权限访问只作审查线索。

### 4.3 事件与结果字典

同源分类函数提供API、UI、CSV与证据包，附classificationVersion，不能由各前端独立推断。汇总主状态统一引用 [L25-09 S01](lucy-20261020-v2p5-audit-increment-spec.md#43-数据契约) 的八桶枚举、完整派生顺序与 `derivationVersion=v2p5-1`；本规范不再维护第二套主状态规则，旧 `outcome` 继续保留为历史事实。

| 维度 | 固定取值或规则 |
|---|---|
| 事件类型 | tool_call、protocol、client_observation、audit_management；协议类别另标handshake/probe/unknown_method/other |
| transportStatus | succeeded/failed/unknown；明确指Lucy与其直接通信对端观察，不证明用户已收到 |
| authorizationStatus | allowed/denied/not_evaluated/unknown |
| executionStatus | succeeded/failed/not_executed/interrupted/unknown |
| usabilityStatus | usable/empty/partial/metadata_missing/not_applicable/unknown |
| 关联质量 | confirmed/candidate/unassigned/conflict/legacy_unverified；独立于执行结果 |

旧outcome和decision_reason继续保留，不偷偷改写历史。scan_missing可为execution succeeded、usability metadata_missing；字段歧义通常归用法与语义，不自动称权限拦截；server/discover未知方法为protocol。四个状态维度不得合并成只有四个取值的单一outcome，也不替换Spec162既有失败维度。

### 4.4 计量与空值

- 工具调用数＝事件类型tool_call，包括目录、元数据、问询登记、查询及失败；不因没有表名而排除。
- 新口径以classificationVersion和版本化API/CSV字段生效。旧v1中“工具调用数”的触表语义保持可读并标注legacy；新UI使用新计数，旧数据访问计数若仍有用途另列，不能悄悄更改旧列含义。
- 关联事件数另列工具、握手和其他协议事件；配置“含协议”只改变展示范围，不改变工具分类。
- 用户问询只显示已登记原文或明确标注的推断问询；仅握手进入独立会话访问入口，默认不占业务问询列表或覆盖率分母。
- 用“原文登记分组占比”而非“真实问询覆盖率”；展示分子、分母、仅握手排除数和推断未知。已确认关联覆盖率按工具事件算，单独展示候选数。
- 问询时长仅在已知起止时提供；另列调用观测跨度、累计工具耗时和最大调用耗时。并发可导致累计耗时大于历时。
- 行数、列数、字节数、截断及SQL缺失统一使用 L25-09 U2 冻结的六值空值原因：not_applicable/not_collected/redacted/parse_failed/unknown/not_supported；不能把未知写成0或false。生成前失败可无SQL，历史空白默认 unknown/legacy_unverified，不能无证据推定为 not_collected。

### 4.5 返回摘要与客户端事件

复用response_prepared的响应摘要，区分“已准备并允许发送”“服务端发送结束”“客户端报告接收”；禁止把prepared解释为已送达。对账摘要覆盖实际交付的结果、元数据及截断口径，并带digestVersion。采用固定规范化（对象键排序，保留数组/结果行顺序、NULL、类型和数值精度）与明确字节边界；不对排序不同结果悄悄声称等价。

普通日志和导出只提供不可逆或按现有隐私策略保护的摘要引用；低熵敏感值需使用现有受保护摘要或HMAC能力，不新增裸值hash泄露通道。接收摘要不能证实结果未被转发；相同数据得相同摘要属于正常结果。

受控客户端事件类型固定为preflight_rejected/result_received/artifact_created/egress_observed/heartbeat，含clientEventId、已认证适配器标识、父事件引用、客户端观察时间、服务端接收时间及脱敏内容摘要。上报中的actor、权限、验证等级不可信，不能覆盖服务端事实。离线补传保持两种时间；按适配器与clientEventId幂等去重，重复ID不同内容为冲突，超出可见范围的父事件不得枚举。

`clientEventId` 仅是适配器侧观测身份，不是 `client_call_id`、Lucy 入口事件或内部操作 ID。调用关联分别保存可选 `client_call_id`、已提交 received 的 `ingress_event_id`、`operationId` 与 `attemptId`；只有 received 持久化成功后才可通过 `x-lucy-event-id` 等已协商载体回传对应 ID。重连或实际重试分配新入口事件、操作与尝试，`retry_of` 指原入口事件、`parent_attempt_id` 只指原尝试；不得用 RPC request_id 去重或跨层复用 ID。

接收入口固定为独立 `POST /api/agent-audit/events`，不伪装成已到达Lucy的MCP工具调用、不转发KTX。使用受控适配器专用、可撤销且限定主体/实例的凭证，不复用管理员Cookie或传入的任意用户ID；事件1至100条、请求不超过1MiB，429/413及安全账本不可用时503均为明确失败。没有普通业务凭证则不能查询数据；观测凭证不授予任何数据面能力。精确错误与逐事件ack字段在T00接口表冻结。

## 5 管理员第一现场

首屏结构沿用PageHeader、摘要、筛选、主网格和详情区域。审计质量事项与访问控制线索分类显示，视觉可用一块列表或分组，不能硬编码两栏。执行成功不自动使关联或证据覆盖显示绿色已完成。

- 问询列表突出时间、凭证主体、客户端、脱敏摘要及来源、已确认/候选工具数、执行结果、归因状态与涉及数据；长ID可短显示但完整复制和详情仍可达。
- 原Agent列保留产品Agent含义并加“凭证主体”说明；显式使用人沿用actor，不直接用token备注替换。新增名词按Terminology Compliance登记后统一更新标准。
- 调用列表保留事件、工具、目标、访问上下文、裁决、执行结果、耗时和返回规模；生成SQL保留默认可发现入口与选列，不必每个空单元格常驻占宽。
- 详情先摘要与关键决策，再按身份、权限、关联修订、查询与返回、客户端对账、证据提供标签或分组；一次调查保留筛选、时间、滚动位置，并能返回原列表。
- 顶部显示固定起止时间、时区、统计时间、刷新/暂停状态、审计同步延迟。暂停固定筛选和序列上界，不能后台换范围。
- 显示高权限使用、重复错误、待核验关联和客户端采集覆盖；没有客户端证据显示“后续动作不可见”，不能显示“未外发”。仅根据User-Agent显示的客户端家族不能写“身份已验证”。

## 6 证据保全与导出

沿用企业安全Spec的canonical ledger和幂等投影。查看敏感审计详情、列表查询、导出、清理、关联修订、权限变更均记录可信actor、动作、对象或脱敏筛选摘要、operationId及结果；批量分页可按调查operation关联，避免自我审计无限递归。记录meta-audit失败不得释放敏感内容。

安全事件的既定默认保留180天沿用20261018安全Spec，不把问询原文、会话或所有日志延长到180天；按既有分类型策略及客户冻结profile执行，未投影事件、未完成操作和调查保留不得被普通清理删除。维护日志允许合法空窗，不为了验收造记录。

SQLite backup生成一致快照；导出同一固定筛选、固定事件序列上界S，先使投影到达S，再从冻结快照生成所有文件。期间新事件>S不混入；关联握手只补入同一上界内可解释记录，去重并列明补入原因。分页附nextCursor和范围完整性，不能把“本页完整”写成“全部匹配完整”。

综合completeness.complete保留投影、权限快照和来源关联检查；另外明确dataScope、associationQuality、clientCoverage、integrityVerification。不能只用projection.complete替换综合完整性。lag=0但存储不可用、complete=false时仍不完整。

v0.25 新增独立 `auditCoverage` 六项检查，完整定义与判定统一引用 [L25-09 S05](lucy-20261020-v2p5-audit-increment-spec.md#82-数据契约)：入口接收覆盖、处理终态覆盖、投影追平、关联依赖齐全、跨端匹配、导出覆盖。各项独立取 `pass / fail / unknown / not_applicable`，必须携带计量单位、N/D、独立证据源、截止位置、差异 ID 集合与理由；D=0 或无法建立独立预期集合时不得记 100% 或 pass，禁止用同侧投影自证入口无漏记。旧 `complete / combined_complete` 与上述四子域含义不变，六项检查不得静默覆盖旧字段，也不替代关联质量或文件 hash 校验。

正式完整导出在无法达到S、超时或快照失败时明确失败/可重试；诊断性不完整导出须由管理员显式选择并标记不足，继承权限和隐私规则。现有端点/v1读取保持兼容；新增正式模式与版本化字段通过T00公开API表明确，不改变旧字段含义而不升级版本。新UI默认请求完整模式，旧v1诊断导出继续允许complete=false并显示说明。

本体提供文件摘要、范围、来源版本、导出人与operationId的证据；独立签名、归档或WORM只有在客户profile要求且真实接通后才能宣称验证。缺独立设施时标注未接入，不用本地hash自检代替。对导出任一文件或受保护关联进行修改必须被校验器发现；抵御控制宿主机者重写所有文件不属于本地保证。

## 7 重试 预算 元数据与新鲜度

复用Spec162预算，不另立竞争计数器。没有begin仍适用凭证/会话级资源上限；不能凭“缺问询”无限发起请求。预算耗尽沿用可继续语义，不能伪装授权拒绝；继续权限不授予更大数据范围。

同一受控任务的重试保留attemptId、父尝试及参数差异摘要。删除过滤、扩大时间或结果上限、切换连接形成scope_change待核验事件；不记录过滤敏感值。Lucy对当前请求独立执行ACL和已配置强制谓词，不从用户自然语言或自报理由推导授权。客户端不可观察时不臆造完整重试链，也不替其保证用户约束。

错误提示只返回该主体授权的候选字段/来源；受限主体与未授权对象作负例，不能拿lucy_admin可见对象当越权证明。物理数据截止、装载/采集时间、语义更新时间独立作为结果级元数据，来源明确、未知允许null，不要求每行伪造last_updated。不自动修改私有语义资产或扩大授权来修复示例。

## 核心流程（伪代码）

```text
on request admitted:
  authenticate and authorize through existing admission; allocate existing operationId/eventId
  capture admission timestamp, session, credential identity, policy version
  if begin_question: persist new reported turn; confirm this begin event only
  else if explicit turn belongs to identity + credential + bound session and is valid:
    freeze confirmed association at admission
  else if explicit turn was supplied but invalid: freeze conflict/unassigned reason
  else if exactly one valid session candidate: freeze candidate/low only
  else: freeze unassigned (ambiguous when several candidates)
  never backbind old events by elapsed time alone
  enforce ACL, canonical args and existing budgets; execute if allowed
  persist prepared result and frozen association before releasing sensitive content
  on finish: append terminal; do not resolve association again using latest begin

on association correction:
  verify admin actor + scope + expected revision
  append correction(original, effective, reason, references); no original ledger mutation
  reproject idempotently; retain before/after and rule version

on list/count:
  classify every row by one versioned server dictionary
  tool_count = count(tool_call); protocol_count = count(protocol)
  inquiry numerator/denominator exclude handshake-only visits
  confirmed and candidate association counts remain separate

on export(requireComplete):
  freeze filter/time bounds and ledger upper sequence S; persist export intent
  catch projection up to S within bounded deadline
  if unavailable/timeout or cannot freeze snapshot:
    reject complete mode; permit only explicitly requested incomplete diagnostic mode
  take SQLite consistent backup; read all files and linked events from that snapshot <= S
  preserve legacy completeness checks; report scope/paging/association/client coverage separately
  scrub and bound output; append durable export prepared; release bytes then terminal event
  fail closed on protected audit failure; no fallback to unaudited sensitive output

on client observation:
  authenticate adapter, validate size/schema, actor scope and parent visibility
  if duplicate ID with same content: return prior ack
  if duplicate ID with changed content: record conflict and reject
  append client_observation with receivedAt and untrusted observedAt; acknowledge durable record
  correlate only with visible matching server event; absent match remains client-only
  update coverage from authenticated heartbeats; gap/unknown never implies no egress
```

## 8 迁移 回滚与兼容

新增schema为幂等additive迁移，版本化投影与导出元数据；在临时N-1库上验证升级及再启动。历史值不批量伪装成显式关联。原始历史导出保持119/105等事实，修订后的调查投影另标版本、修订和口径；不能修改原包来凑新统计。

回滚优先关闭新UI或可选客户端采集入口并保留已追加事件；旧程序不识别新字段时拒绝不兼容启动或使用已验证兼容路径。不能恢复旧权限、会话或原始数据库来撤销已发生的安全收窄，不能丢弃新审计事件。具体schema最低版本和投影重建策略由T00冻结，未验证不部署。

性能沿用企业安全Spec已有耐久开销预算，不以放弃审计达标。常规列表与导出使用现有上限、批量查询和索引；外部归档不可用是否阻断按冻结客户profile，不得运行时静默降级。

## 9 验收与完成定义

EA-01至EA-36及执行层级见[验收矩阵](../qa/audit-trust-and-admin-investigation-acceptance.md)。每个需求关联具体测试和证据；新增contract、集成和真实客户端证据不能互替。旧四端材料只作事实基线，不作新版本运行证明。

状态分别记录：未实现、已实现、本地通过、目标环境通过、Codex评审结果。开发者自报完成不等于验收；同一候选commit/image/config必须贯穿所选交付范围的required用例。缺真实客户端或目标环境为blocked，不能写passed或把required改成可选。

本轮文档交付不运行浏览器；实施验收的UI部分明确要求隔离fixture上的桌面浏览器1440×900与1280×800，移动窄屏不在范围。客户发布继续执行既有linux/amd64单副本K8s门禁，不以本Spec新建一套替代门禁。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`。以下为本Spec登记的增量或修订，T00同步主标准后才使用新UI文案。

| Canonical term | UI主术语 | 定义及禁止混淆 |
|---|---|---|
| Credential principal | 凭证主体 | 对现有Agent列补充身份层说明，不替换显式使用人actor |
| Confirmed association | 已确认关联 | 仅有效显式关联或begin自身；不等于用户授权意图证明 |
| Candidate association | 候选关联 | 现有归因方式的补充状态；不用“关联成功”掩盖推断 |
| Association review | 归属待核验 | 包括冲突或历史未核验；不自动等于越权 |
| Client coverage | 客户端采集范围 | 已接入/中断/未知及后续动作不可见；不称“未外发” |
| Tool call count | 工具调用数 | tool_call全部，替代旧触达物理表定义；原data-access计数另命名、版本化 |
| Reported group ratio | 原文登记分组占比 | 非真实问询覆盖率；明确分母 |
| Audit integrity verification | 证据校验 | 分文件hash、独立签名和外部保全；不把hash自检称为防篡改签名 |

沿用“审计同步延迟”“Manifest”“会话访问”“问询记录”“调用流水”“裁决原因”。ID、SQL、物理表、Role、Token、Manifest及机器码DOM使用translate="no"与notranslate。文案不得把操作权限、业务结果、归属和证据质量合并成一个安全结论。

## Design System Compliance

遵循`webui/docs/design-system/01-foundations-color.md`、`11-components-data-grid.md`、`12-components-metric-card.md`和`20-patterns-page-layout.md`。复用语义色、pl-data-grid、有界单层滚动、PageHeader与详情结构。摘要若使用指标卡必须提供口径说明；不强制新增卡片或两栏。普通成功色不覆盖警告状态，状态同时提供文本。无新增视觉模式时不修改全局设计体系；确需新增先按99-governance登记。
