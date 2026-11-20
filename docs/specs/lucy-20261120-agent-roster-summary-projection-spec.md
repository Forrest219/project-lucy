# Agent 名册摘要投影与单对象详情按需读取 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.3（委托人批准分批） |
| 日期 / 目标版本 | 2026-11-20 / 0.30.0 |
| 功能编号 / 优先级 | P1-66／REQ-030-087；P1（性能差集；建议）；不入核心分母 |
| 台账号 | 无 |
| 状态 | v0.3。委托人2026-11-20批准分批收敛及本进程commit；批次A功能合同已收口；本机Docker最小验收PASS WITH GAP；批次B暂停，原v0.2完整矩阵FAIL保留；本批增量提交；未推送／发布；不入核心分母；本批收口不表示可上线。 |
| 授权边界 | 委托人 2026-11-20 要求入总账、先出优化方案和 Spec／Plan，设计保留现场权限展开规模的 Docker 浏览器验证；2026-11-20 委托人明示 v0.2 定稿并授权按 Plan 开发及 Docker 浏览器验证，完整覆盖旧接口、按需详情和六组夹具；不提交、推送或发布，不升级 109 |
| 需求 / 总账 | [REQ-030-087](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-087agent-名册摘要投影与单对象详情按需读取) · [P1-66](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 计划 / 测试台 | [Plan](../plans/lucy-20261120-agent-roster-summary-projection-plan.md) · [UAT-SUITE-AGENT-ROSTER-SUMMARY](../qa/uat/suites/agent-roster-summary/suite.md) · [INDEX](../qa/uat/INDEX.md) |
| 前序 | [P1-58](lucy-20261119-roles-agent-read-responsiveness-spec.md)（名册／统计分区）· P1-59（编辑冲突）· Spec 174／195（展示快照、一致性） |
| 设计评审 | [严格过程评审与修订](../reviews/2026-11-20-p1-66-spec-plan-strict-review.md)；8 项发现已在设计层修订；非 Codex CLI 终审；委托人2026-11-20随后明示 v0.2 定稿，已终稿确权 |

## 0. v0.3 分批决议（2026-11-20）

委托人先要求暂停长测、收敛当前优化分批使用，随后明示「批准按以上决议，收口，commit 本进程」。本批允许本地 commit；不推送、不发布、不升级 109。以下批次边界覆盖 v0.2「完整六组全部通过后才能收口」的当前出口；原阈值、失败记录和完整合同逐条保留，不改成 PASS。

| 批次 | 承诺与出口 | 处理 |
|---|---|---|
| A：本次小交付 | 列表摘要、同槽轻读、单对象按需详情、旧完整接口和旧格式兼容；下列 BA-01–07 | 最小真实 Docker／前台浏览器／纯 MCP 检查，加独立提交候选回归；按本批结果收口 |
| B：后续优化 | 冷编译、启动预热、首访／统计预算、六组完整换向矩阵、WIDTH HTTP 对照及完整 E／写入故障矩阵 | 暂停，保留 GAP-UAT-P1-66；委托人启动下一批时重评方案和验证范围，当前不继续开发 |

批次 A 不承诺所有冷热性能预算已过。已知 BAL-K1 冷读五次超过 10s，首访／统计超过 1／2s；反向基线一次 Roles 503、旧 0.25 完整 API 冷探查超时均保留。现有热态改善是同构观测，不证明现场升级或整套 v0.2 UAT PASS。

### 本批 A 验收

| 编号 | 本批必验 |
|---|---|
| BA-01 | 新后端默认完整列表 7d／14d／30d、旧 roster、单对象及完整权限字段兼容；参数错误、坏 sidecar 与 single-flight 回归通过 |
| BA-02 | 摘要白名单／计数正确，凭据时间按响应更新，摘要＋statistics 热读完整 payload parse=0，缓存 DTO 隔离 |
| BA-03 | 真实前台名称点击只取指定 ID／7d；关闭保留搜索及统计窗口；等待、取消、真实网络失败重试、独立详情返回／重试可用 |
| BA-04 | 真实统计失败时名册与详情可用，未知不造零；版本永不匹配的读取有界，恢复可达 |
| BA-05 | 新前端对真实旧完整后端的窗口／刷新／详情及完整消费者可用；旧前端对新后端可用；legacy-roster 与异常 404 边界另由适配回归覆盖 |
| BA-06 | 同候选仅用普通 Agent Bearer，无 WebUI Cookie／宿主，真实读取物理表 oracle=4 行；未授权来源和过期／禁用／已撤销身份拒绝。保持既有 Gate-Off，不设置上游强制谓词已证明开关；受限行取数和 fresh Constraints 保存的完整矩阵留批次 B，不冒充已验 |
| BA-07 | 独立提交候选测试／类型检查、证据归档、仅本进程差集提交和专用资源清理；原失败与后续缺口在三台同句登记 |

选择器 F66-A 只对应本批 BA-01–07；原 F66／SC-01–12 仍未全部完成。测试台可登记本批 PASS WITH GAP，不能改写原矩阵 FAIL。

## 闭口层级

- 层级：功能合同
- 本条承诺：在声明的 Docker 数据规模下，治理方用摘要读取名册并保留搜索、筛选、统计和详情入口；完整权限只在单对象详情／编辑时读取；旧接口调用方继续获得原有完整数据；权限与凭据展示不造零、不改变授权含义。
- 本条出口：当前批次 A 的 BA-01–07；原 SC-01–SC-12 完整出口保留给后续批次，不能叙事为本批已全部通过。
- 不在本条出口：P1-58 全部历史查询整改、跨模块容量治理、虚拟滚动、持续组合压力、客户拓扑升级及发布签字；全系统组合共存仍挂 P1-13／RACS-R，不倒挂到本条。
- 上线关系：本条收口不表示可上线

## 1. 已核实事实与差集

2026-11-20 109 实例身份为 `0.25.0 / 6d2664b3`。独立只读样本：71 Agent，完整响应 4,833,709 B；`effectivePermissions` 紧凑重编码 4,740,771 B（约 98.08%），13,815 条 capability；角色接口总耗时 59.05s，服务端 58.94s。前台 Agent 约 6.56s 内看到 71 行。原始接口与前台测量不是同一请求，不相减推算渲染成本。

证据来源：[探查报告](../../inbox/lag-109-codex-20261120/findings.md)、[API](../../inbox/lag-109-codex-20261120/api-results.json)、[浏览器](../../inbox/lag-109-codex-20261120/browser-observations.json)。这些是问题来源，`inbox/` 可清理；本节已保留必要非敏感事实，后续正式 UAT 原始证据进 runs，不能只引用临时文件。

当前代码已含 P1-58，但 `buildAgentRoster` 仍通过 `userToAgentWithBatchPermissions` 返回全部 `effectivePermissions`；`AgentList` 列表没有直接使用完整 capabilities。另一个入口是 `ObjectDetailDrawer.AgentDetailBody`：点击名册名称打开抽屉后，它仍读取完整 Agent 列表再按 ID 查找。本条同时补这两个入口，避免入口优化后又拉回全量数据。

规模缺口：已知总 capability 和字节，不知道现场每人 p50／p95／max、所有全局来源表、行谓词分布和审计行数。不得把合成分布写成现场复刻，也不得用更多但权限更窄的账号冒充现场规模。

## 2. 方案比较与拟定决策

| 方案 | 收益 | 代价 / 决策 |
|---|---|---|
| A：显式 `view=roster&projection=summary`，独立摘要 DTO／前端键，服务端同槽小 sidecar；原接口保留 | 可逐消费者迁移；旧前端／外部脚本兼容；按请求证明负载下降 | **采用**；两种表示共享核实代次和 single-flight；sidecar 不读回完整 JSON，类型与前端查询键隔离 |
| B：直接删除现有完整列表／roster 的权限字段 | 参数少 | 不采用；未盘点完的外部调用方和缓存可能读到不完整 Agent |
| C：仅 gzip、分页或虚拟滚动 | 可减少传输或 DOM 成本 | 不作为本条方案；仍可能生成／序列化整份权限，且当前问题首先是读路径与大响应；压缩只作额外观测 |

D1：先新增显式摘要投影，再迁移 AgentList 和单对象抽屉；不得全局替换 `adminAgentsQueryOptions`。D2：详情复用现有单对象 API，不新增“点击每行预取权限”。D3：列表摘要仅展示，运行时授权、dryRun、保存和 Token 动作仍走既有 fresh 校验。D4：摘要与 statistics 从同一个 `agent-permissions` 快照槽取得版本和小 sidecar，保留既有统计 envelope／TTL；禁止独立 section 名直接参与跨表示版本比较。

## 3. API 与兼容边界

以下为拟议合同，尚未实现。响应均保留现行 `{ok,data}` envelope、认证和管理员权限边界；摘要投影不扩大访问者范围。

| 请求 / 消费者 | 本条约定 |
|---|---|
| `GET /api/admin/agents`；含已有 7d／14d／30d | **原完整响应保持**，包括 agents 字段、权限、Token 明细、统计与 summary、错误语义；不静默重定向到摘要 |
| `GET /api/admin/agents?view=roster` | **原 roster 默认保持**，不带审计统计但仍有完整权限；原 `AgentsRosterResponse` 不改成摘要类型 |
| `GET /api/admin/agents?view=roster&projection=summary` | 新的显式只读摘要表示；DTO 见 §3.1；客户端附带当前 `range=7d/14d/30d` 兼容旧端；新后端忽略此参数的统计含义，不加入服务端摘要 section 缓存键；统计另读既有 statistics |
| `GET /api/admin/agents/statistics?range=...&refresh=true` | 公共合同保持，7d／14d／30d、原 asOf、snapshotVersion、5 秒展示复用与手动刷新不变；内部改读同槽小 sidecar，不能为取得版本 parse 完整权限 payload |
| `GET /api/admin/agents/:userId?range=...` | 原单对象完整响应保持，包括 effectivePermissions、Token、constraints、version／baseObjectVersion 和窗口统计；抽屉显式 `range=7d`，沿用现有“近 7 天”标签；编辑页继续使用此 fresh 入口及原默认窗口 |
| `GET /api/admin/agents/:userId/effective-permissions` | 原完整权限响应保持；供现有调用方按需调用；抽屉或编辑若已用完整 detail，不重复请求此接口 |
| POST／PATCH／DELETE／Token／dryRun | 输入、ack、并发版本与操作状态协议不变；本条不改写路径 |
| 参数错误 | 新后端对 `projection` 的空值、重复／非字符串值、未知值、或 `projection=summary` 配非 roster 视图，返回现有 400 `BAD_REQUEST` 分类；不把拼错参数悄悄当成完整或摘要响应 |

### 3.1 摘要白名单与准确性

独立新增 `AgentRosterSummaryRow`／`AgentsRosterSummaryResponse`，**不得写成 `Partial<Agent>` 或 `Agent` 再塞 `tokens: []`**。

| 字段 | 必须的含义 |
|---|---|
| `id, name, note, enabled` | 当前名册展示、搜索与备注原值；note 为空沿用现义，不新增截断来凑性能 |
| `roles, role, roleResolutionError, declaredRole, declaredRoles` | 沿用现有角色解析函数的条件字段与语义，冲突不伪装成未绑定 |
| `createdAt, configUpdatedAt` | 沿用既有配置时间线语义；无法取得可缺省，不能改成请求时刻 |
| `legacyWildcard` | 等价于当前列表对旧 allow.tables／allow.tools 的 `*` 判断，不传整份 allow |
| `credentialSummary` | `{state, configured, available, evaluatedAt}`；新端 state=ok、计数为整数；旧端证据不足时 state=unavailable、不能判定的字段为 null。由配置中现存凭据与既有有效性规则计算，不读 access_log；复用 `availableTokenCount`：禁用 Agent 为 0，现存未过期配置行计可用；撤销沿用配置移除语义，不另扫 revoked_tokens 改分母 |
| `permissionSummary` | `{state, sourceCount, connectionCount, toolCount, capabilityCount, snapshotHash, sourceMapVersion}`；成功可为 0，解析失败／未核实计数为 null、摘要 hash 为 null；state 为 ok／partial／unavailable，沿用既有解析结果映射 |
| `permissionWarnings` | 既有警告；保留原因，不在列表投放完整谓词或堆栈 |

计数只能从同一已核实编译结果生成：sourceCount、connectionCount、toolCount 分别按现有 `permissions.sources`、`connections`、`tools` 的相同集合语义计数，capabilityCount 为 `capabilities.length`；不能混用来源映射总表数或 Role 引用数。若编译结果只具有整体失败，则该行 unavailable，不自行编造 partial 成功计数。

**不返回**：`effectivePermissions` 及其 sources／capabilities／rowGrant／finalRows、原始 `allow`、`constraints`、`tokens[]`（含 hash、标签和设备／IP明细）、动态 `stats`。表名、行谓词、Token 明细仍从现有详情取得。服务端序列化白名单，不能先生成完整公开 DTO 再 `delete` 大字段。

`data.version` 与 `meta.snapshotVersion/generatedAt/permissionsState/runtimeConsistency` 保留 P1-58 语义，新增 `meta.projection="summary"`、`meta.projectionVersion=1`。摘要不新增页面 KPI、不把计数或 matched 状态当作授权放行依据。统计仍在匹配 config／snapshot 版本后 join。名册逐行与顶卡的配置类 configured／available 始终取本轮 credentialSummary（顶卡按行聚合）；旧 statistics 中同名配置类值继续兼容返回，但新 UI 不得覆盖最新摘要计数。业务调用／活跃凭据等审计指标才由统计区提供；不能沿用“enabled 就把 configured 当 available”的假设。

配置凭据 available 对时间敏感：权限摘要缓存只存权限字段；每次响应以同一 evaluatedAt 按原逻辑重新计算 credentialSummary。前端沿用已有刷新／重新进入时更新，不新增轮询；过期边界不得因缓存权限摘要而继续显示上次 available。

### 3.2 旧新客户端与后端组合

归一化读取结果必须有内部判别：`summary-v1`／`legacy-roster`／`legacy-full`；不能把它们强制 cast 为同一服务端类型。`summary-v1` 必须同时具有合法投影标记、白名单与非空版本；未知版本或互相矛盾的字段为协议错误，不按 legacy 猜测。

| 组合 / 识别 | 名册、统计及刷新行为 |
|---|---|
| 旧客户端 → 新后端 | 默认完整列表、旧 roster、statistics 和单对象响应保持，原 helper 不迁移；新增 sidecar 不泄漏到旧 HTTP envelope |
| 新客户端 → 新后端，summary-v1 | 按摘要＋statistics 两分区读取；以 config version 和同槽 snapshotVersion 完全匹配后 join，不比较两种 DTO 的 body hash；每次手动刷新两分区，遵守既有预算 |
| 新客户端 → 旧后端，legacy-roster | 已知完整 Agent[]、version 和 roster meta 表明旧端忽略 projection；原完整对象只在适配器内消费，形成独立摘要 DTO；统计仍以该原始 roster 的 config／snapshot 标识匹配，不能凭空生成新版本 |
| 新客户端 → 旧后端，legacy-full（含 109） | 仅接受同一完整响应中已核对的 agents／summary／range／window；把它作为一次成套读取使用，禁止从其他请求拼接。本轮不另启动 statistics；换窗口／刷新重新请求带当前 range 的摘要 URL，旧端仍可返回整套；字节收益记 N/A |
| legacy-roster 的 statistics 确实缺席 | 只允许该已识别旧格式对精确 statistics 路径作一次能力探查；仅该路径的 JSON 404（NOT_FOUND 或旧通配 detail 的 AGENT_NOT_FOUND）标 unsupported。无指标则不可用，名册／详情继续可达；新端 summary-v1 的 404 为异常，不能当成功降级 |
| 认证／网关／参数／结构错误 | 401／403 交给既有身份处理，400 不改写，HTML 404、502／503、未知结构按真实错误处理；不得发起第二次完整列表来“兜底”。重试只按已分类可恢复错误执行，不能把所有错误都说成可重试 |

旧端适配的 configured 在 tokens 数组可验证时才计算；available 必须具有完整现存凭据的有效期／启用证据和可用观察时刻，证据不足为 null，不用 configured 冒充。缺少权限明细时权限计数为 null；adapter 不伪造投影标记、snapshotVersion、统计时间或“优化已启用”。legacy-full 没有版本配对字段时，仅允许使用原子同一 body 内的统计；没有合法窗口则整段统计不可用，不能绕过新端严格版本 join。

原完整列表、摘要、statistics、单对象 query key 分开。摘要键至少含 `roster,summary,v1,range`，请求同样携带当前 range；新端服务端 section 不因此重编译。保留项目／身份 epoch 隔离；旧端能力结论只在该已识别读上下文有效，身份／项目／构建变化须丢弃；不建立全局永不失效的“无统计”标记。

新端成功统计与摘要不匹配时，仅在已有 display request 预算内重新核对／补读，耗尽即统计不可用＋手动重试，保留名册；禁止永久 pending 或自动刷新环。合法权限核实可恢复时能重新成交，不能用缓存门槛锁死主路径。

### 3.3 已盘点消费者与迁移范围

| 位置 | 本条动作 |
|---|---|
| `src/pages/admin/AgentList.tsx` | 改用摘要类型；搜索、角色／状态／活跃筛选、Token 数、旧通配提示、详情／编辑／新建入口保持；统计区按版本 join |
| `src/components/ObjectDetailDrawer.tsx` 的 AgentDetailBody | 从全量列表 find 改为单 ID detail；显式 7d；使用 `[...,adminAgents,detail,userId,7d]` 前缀键和 agents display-read 屏障／AbortSignal，纳入同一配置失效域；真实 AGENT_NOT_FOUND 才显示不存在，错误可重试 |
| `src/pages/admin/AgentDetail.tsx` | 继续单对象 fresh API；补充回归证明完整权限、行限制编辑、Token 操作及 P1-59 草稿恢复不受摘要污染 |
| `NewToken`、`Onboarding`、`Step6ConnectAgent`、`McpPlayground`、`Audit` 及外部完整列表调用方 | **本条不批量迁移**，原完整 API／helper 保留；回归 smoke，防止全局 helper 偷换成摘要 |

详情读取由真实打开触发；滚动、hover、列表 mount、选择筛选不预取全部详情。重复打开同一 ID 可沿用既有展示重读策略，但 Agent／Role／来源／Token 变更必须使其失效，身份变化清理受保护缓存。关闭或 A→B 切换取消无消费者请求，A 的晚响应／旧 placeholder 不得显示成 B；只接受目标 ID／7d 的数据。

Drawer 的展示键不复用编辑页的单数 `admin,agent` 缓存，不用摘要初始化编辑。进入编辑重新获取完整事实；dryRun／保存继续 fresh 和原 P1-59 并发校验。详情失败时仍能关闭 Drawer、搜索名册、重新打开／重试；不增加无消费者后台请求。

## 4. 生成、缓存与一致性

v0.1 的独立 `agent-permission-summary-v1` section 方案撤回：`getDisplaySnapshot` 的 version 由含 section 名称的 key 散列而来，换名称后不能与原 statistics 的 snapshotVersion 匹配。

1. 复用原 `agent-permissions` 槽、extraKey、P/C、访问路径、来源／模板分类版本、核对健康与写屏障。槽一次构建返回 `{payload, sidecar}`：payload 保持现有 CachedAgentPermissionSection 的序列化形状；sidecar 单独包含 `schemaVersion=1`、逐 Agent 摘要、permissionsState 和小型 DisplayPolicyInputs。二者由同一次真实 PermissionBatch 生成并原子发布，同一 single-flight、同一 raw snapshot.version；不建第二个权限事实源。
2. 先拆共享“取得已核实槽句柄”与“解析完整 payload”两个内部入口。旧完整消费者走原 payload parser；摘要只 parse 小 sidecar 并组合配置字段；**readAgentStatisticsDisplay 也只读 sidecar 的 policyInputs 与槽版本**，不得先调用现有会 JSON.parse 完整 payload 的 agentPermissionSection。统计业务 SQL／envelope／asOf／TTL 不变。
3. 三条路径统一复用现有 `agentListSnapshotVersion(slot.version, runtimeConsistencyForInputs(policyInputs))` 等价规则。相同配置／核实代次下摘要、旧 roster 和 statistics 的公开 snapshotVersion 必须相等；range、投影种类、body hash 不加入这一配对值。失败／跨代／pending write 不发布半份 sidecar 或旧权限。
4. 新 builder 总是原子生成带版本 sidecar 的槽；热态 sidecar 缺失／schema 不合法视作内部投影错误，不允许 parse 大 payload 后静默伪装成轻路径。恢复必须先按 section＋捕获的槽实例标识（incarnation／内部对象引用）条件淘汰整对坏槽（CAS，不清其他槽、不改变 P/C），同请求最多重建一次并共用既有总预算；并发共享重建，不能重新命中同一坏 sidecar 反复报错。仍失败提供可重试错误，不无界重算。旧二进制没有 sidecar 的情况走客户端已知 legacy 格式适配。
5. **代价明确**：为保留旧完整 API 和原快照编号，冷构建／既有 full prewarmer 仍可能生成并序列化完整 payload 一次；本条不承诺服务端全量权限不驻留，也不承诺冷成本与宽度无关。收益约束为摘要 HTTP 裁剪、摘要及统计热读不 parse／重投影完整 JSON、Drawer 单对象 HTTP。预热的时间／内存／构建数必须计入观测，不能隐藏后声称“完全没有全量序列化”。
6. sidecar 不存动态统计或凭据 available；每次响应按同一 now 计算 credentialSummary。统计缓存旧配置类值不能覆盖新的 credentialSummary。P/C／外部配置／身份边界变更和保存成功均按原机制失效；未核实权限显示 null／原因，合法路径通过重试／fresh 详情恢复。

## 核心流程（伪代码）

```text
buildSharedSlot(inputs):
  batch = existingPermissionBatch(inputs)
  return atomicPair(
    payload = serializeOriginalCompletePermissionSection(batch),
    sidecar = serializeSummaryCountsAndSmallPolicyInputs(batch, schemaVersion=1))

readAgentSummary(request):
  authenticateAndAuthorize(request); validateExplicitSummaryQuery(request)
  slot = getVerifiedAgentPermissionSlot(existingKeyAndBudget, buildSharedSlot)
  small = parseValidatedSidecarOnly(slot.sidecar)
  version = originalAgentListVersion(slot.version, runtimeConsistency(small.policyInputs))
  return summaryWithConfigAndCredentialsAtOneNow(small, version)

readStatistics(request):
  slot = getVerifiedAgentPermissionSlot(existingKeyAndBudget, buildSharedSlot)
  inputs = parseValidatedSidecarOnly(slot.sidecar).policyInputs
  version = originalAgentListVersion(slot.version, runtimeConsistency(inputs))
  return existingStatisticsAndCache(request, version)  # 不 parse slot.payload

renderRoster(range):
  result = normalizeKnownResponse(readSummaryURL(range))
  if result.kind == legacy-full: useOnlyItsMatchedInlineWindow()
  else: boundedReadStatisticsAndJoinOriginalVersions(); showUnavailableWithRetryOnExhaustion()
  showConfiguredAndAvailableFromCredentialSummaryOnly()
  onNameClick(id): displayReadSingleDetail(id, 7d, agentsScope, signal)
  onEdit(id): readFreshCompleteDetail(id); neverSeedFromSummary()
```

## 5. 性能与证据合同

唯一夹具与预算见 [fixtures](../qa/uat/suites/agent-roster-summary/fixtures.md)。本条使用 B109／W2／W5，不重新命名或替换 RACS 的 B／2×／5×。B109 至少保留 71 Agent、47 正式 Role、13,815 条实际编译 capability 和 4,740,771 B 完整权限投影；其余维度是明确设计下限。声明仅为“保留已知总展开规模的合成压力”，现场逐人分布未知；均衡／偏斜与共享／分散形态按 fixtures 交叉验证，不得写成现场精确复刻。

- 同 Docker 资源／同种子／同配置摘要与审计水位，改前使用本次优化前的当前 0.30 构建，改后只引入本条差异；109 旧版本只作问题来源，不能用于计算本条改善率。
- 摘要响应按 `Accept-Encoding: identity` 的完整 body 字节判定：B109 ≤256 KiB、W2 ≤512 KiB、W5 ≤1280 KiB，且每档 ≤同档原 roster 的 20%；同时断言禁带字段，不以 gzip 达标替代裁剪。
- API 热态 p95 ≤200／300／500 ms；权限快照冷读／失效后首个有效读取 max ≤1000／2000／3000 ms；前台名册 primaryReady p95 ≤1000／1500／2000 ms，正常业务统计 statsReady p95 ≤2000／3000／5000 ms；绝对线及同档相对不回退同时满足。相对失败定义沿用 P1-13：p95 同时恶化 >20% 且 >50ms。
- 前台分别计时 cold navigation、无客户端缓存 SPA、热 SPA、手动刷新、名称打开抽屉、编辑页权限就绪；名册可见与统计可见分列。缓存旧行不代表新配置就绪；API／TTFB／下载／JSON与渲染时间只对同请求关联，不乱减。
- 正常性能组有效请求成功率／字段等价率为 100%；预定 400／403／404／故障注入组按预期行为另判，不能混入正常性能分母；正常组超时／503不得剔除。达不到预算判 FAIL 回设计，不能自动放宽，终稿前可具名裁决预算但必须保留原值与原因。

## 6. 验收

| 编号 | 可打假检查 | UAT |
|---|---|---|
| SC-01 | 原完整列表、range、旧 roster／detail／effective-permissions 与写协议保持；未知 projection 正确拒绝；静态路由不被 :userId 吞掉 | ARS-01／02 |
| SC-02 | 摘要白名单无完整权限／Token 明细；计数、角色冲突、legacyWildcard、凭据过期／吊销／禁用与原事实逐项等价；统计晚到不覆盖新 available，旧端缺证据为 null | ARS-03 |
| SC-03 | 独立前端 DTO／缓存键、服务端同槽 sidecar；摘要／原 roster／statistics 同代版本相等，整个摘要＋统计热旅程不 parse 完整权限，跨代／身份不回填 | ARS-04 |
| SC-04 | 名册首屏不读完整列表／全体 detail；名称抽屉仅单 ID、按需加载；名册和抽屉各自原有统计窗口正确；错误可重试、404 与不可用区分 | ARS-05／06 |
| SC-05 | 单对象详情、行限制编辑、dryRun、Token 动作与 P1-59 对象版本／草稿恢复继续使用完整 fresh 事实；摘要不得伪装 Agent | ARS-07 |
| SC-06 | statistics 慢／失败／版本不符时名册搜索／角色筛选／进入详情可用；恢复与刷新可达，非零／null 不串义 | ARS-08 |
| SC-07 | 新旧组合的 summary-v1／legacy-roster／legacy-full 状态机、刷新与窗口、统计 404 边界及未迁移消费者回归；无版本旧端仅同 body 统计可用 | ARS-09 |
| SC-08 | B109／W2／W5 夹具实际编译计数、权限字节与散布清单满足下限，资源／种子／改前改后身份可追；缩窄权限的负控被测程拒绝 | ARS-R0／10 |
| SC-09 | 各档字节／API／primaryReady 与 statsReady／详情预算和相对闸同时通过，冷／热分列；均衡／偏斜及固定账号数宽度对照均达标 | ARS-10 |
| SC-10 | 配置收紧、失败恢复后展示正确；同一容器对合法纯 MCP 的原工具读取仍成功、未授权范围仍拒绝；无 WebUI 宿主要求 | ARS-11 |
| SC-11 | E1–E18 全部有前台桌面证据及即时计时；详情按需增加的等待可重试、列表上下文保留 | ARS-05–08 |
| SC-12 | 独立卷清理／保留声明、统计窗口与配置指纹、原始结果、失败样本与相对基线完整，回写三台与审计差集 | ARS-12 |

## 受影响画像

按 [画像规范](../governance/user-personas.md)先评估；以下为设计判定，未取得体验通过证据。

| 画像 | 变更前 → 变更后 | 判定 | 依据与补偿 |
|---|---|---|---|
| 问数方 | 纯 MCP 授权和问数接口不变；减少名册大对象投影 | ＝ | 不触碰 Proxy 授权与 Live Report；SC-10／ARS-11 同容器覆盖合法读取与越权拒绝，无 WebUI 身份前置 |
| 治理方 | 名册更轻；名称抽屉由共享列表数据改为额外单对象读取 | 权限授权面 ↓（按最差子面）；语义口径面 ＝ | 名册收益 SC-04／09；详情新增等待的补偿：独立加载、局部错误重试、关闭返回原筛选／滚动上下文、直接编辑 fresh 路径，SC-04／05／11；不改语义口径写入 |
| 运维方 | 增加字节和投影维度，可区分缓存与冷读 | 运行观察面 ↑；交付运维面 ＝ | SC-08／09／12；仅 Docker 验证，不改部署方式或版本轴 |
| 管理层 | 摘要与统计分区，业务调用和可用凭据口径保持 | ＝ | SC-02／06；不改既有业务 KPI、不以性能绿冒充现场升级完成 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None. 沿用 Agent、角色、Token、加载中、重试、统计时间与既有权限文案。`projection`、DTO、capabilityCount、legacy adapter、B109 为工程说明，不进页面主流程。专业英文、ID、路径、URL、表名节点继续 `notranslate`／`translate="no"`。摘要状态失败不得显示「暂无权限」或假 0。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

保留现有列表列、指标卡、对象详情 Drawer 和编辑页；加载／部分失败分区显示，重试为次要动作；筛选控件与语义颜色沿用既有规范，不新增顶卡或工程诊断入口。

### Exceptions (If Any)

无。

### Follow-up Needed

实施中补 E1–E18 前台证据、按钮／焦点／翻译防御回归；实际结果见测试台 run，不从设计推定已通过。

## 交互范围说明

名称触发的 Drawer 是 `/admin/agents` 上的对象详情状态，随 E6／E4／E7 验证；不是新增路由。编辑页动态路由元素单独覆盖，不能只测 Drawer。

## 交互合同

- 路由：/admin/agents、/admin/agents/:userId
- 基准页：/admin/agents
- 一件事：先浏览可信名册，再按需打开单个 Agent 的完整详情。
- 状态：首访：识别名册与详情入口；空：名册无配置或详情对象不存在有下一步；加载：名册与详情分区加载；错误：区域内原因和重试；0 条：筛选无命中可清除，详情内无权限记录可返回；成功：名称详情和编辑可达；部分：统计或权限未核实时保留已核实名册与重试
- 主动作：名册沿用新建 Agent 为 primary，详情沿用现有保存／编辑为 primary；重试为次要；不做：新增同组 primary 或列表全体权限预取。
- 决定信息：身份、角色、配置状态、Token 计数、业务统计状态及详情加载／失败原因。
- 术语：已登记，沿用 Terminology Compliance，不显示工程投影参数。
- 台账：无新台账
- 状态维度：名册配置、权限摘要、统计、单对象详情各自标记；同一状态维度不得互相否定；缺失不转换成零授权。


## 元素清单

- E1｜/admin/agents｜首访｜页头与入口｜用户可开始浏览名册
- E2｜/admin/agents｜空｜名册｜无配置有新建入口
- E3｜/admin/agents｜加载｜名册区域｜摘要读取加载可见
- E4｜/admin/agents｜错误｜名册区域｜失败说明与重试
- E5｜/admin/agents｜0 条｜筛选区域｜无命中可清除
- E6｜/admin/agents｜成功｜名称与编辑入口｜打开指定 Agent
- E7｜/admin/agents｜部分｜统计与权限摘要｜未知不造零且列表可用
- E8｜/admin/agents｜主动作｜新建 Agent｜保留现有按钮层级
- E9｜/admin/agents｜决定信息｜列表列｜计数与状态准确
- E10｜/admin/agents/:userId｜首访｜详情页头｜识别单个 Agent
- E11｜/admin/agents/:userId｜空｜对象不存在｜可返回名册
- E12｜/admin/agents/:userId｜加载｜详情区域｜按需加载状态可见
- E13｜/admin/agents/:userId｜错误｜详情区域｜失败可重试且不伪报不存在
- E14｜/admin/agents/:userId｜0 条｜权限明细｜合法零权限可解释并返回
- E15｜/admin/agents/:userId｜成功｜权限与编辑｜完整来源和行限制可读可编辑
- E16｜/admin/agents/:userId｜部分｜统计或权限区域｜局部失败不清空可用字段
- E17｜/admin/agents/:userId｜主动作｜现有保存动作｜仍使用 fresh 校验
- E18｜/admin/agents/:userId｜决定信息｜详情版本与权限｜不使用摘要冒充完整详情


## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过
