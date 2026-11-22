# 角色权限与 Agent 列表读取响应 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.1 |
| 日期 / 目标版本 | 2026-11-19 / 0.30.0 |
| 功能编号 / 优先级 | P1-58／REQ-030-079；P1，第一批 |
| 台账号 | 无；挂 0.30 产品线执行总账 |
| 阶段 | S4 |
| 状态 | S4｜v1.1。委托人2026-11-20批准分批交付并提交本进程；本轮实现与证据归档收口；首批主路径结果见测试台；完整F58／F59、2×／5×长测及剩余故障矩阵延期第二批，未计PASS；R未执行；不入核心分母；≠ 完整功能合同收口；≠ 可上线。 |
| 授权来源 | 委托人2026-11-20明示授权补齐实现缺口、冻结候选并完成F58／F59和前台浏览器UAT，通过后按仓库规范收口；不做发布上线。 |
| 需求与总账 | [执行总账 P1-58](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[需求池 REQ-030-079](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 实施计划 | [配对 Plan](../plans/lucy-20261119-roles-agent-read-responsiveness-plan.md) |
| 测试台 | [UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE](../qa/uat/suites/roles-agent-concurrency-scale/suite.md)；最新判定只见 [INDEX](../qa/uat/INDEX.md) |
| 落位依据 | [DEVELOPMENT](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」 |
| 设计评审 | [Cursor意见处理与终稿确权记录](../reviews/2026-11-19-roles-agent-design-finalization.md)；委托人明示免Codex CLI终审，不主张CLI审阅通过 |

## 2026-11-20 分批交付决议（本轮执行边界）

委托人批准“暂停长测，收敛当前优化，分批继续”，并明确“收口，commit本进程”。本次收口对象是**本轮实现与证据归档**；完整功能合同仍保留SC-01–12，没有因测试耗时删除验收、不将未执行项计PASS。

- 首批：冻结本进程已实现的统计减负／有界worker／两条已授权索引、对象级提交与草稿／回执恢复；短回归、类型检查、真实前台查看／新建／编辑／删除及冲突恢复。范围、候选指纹和实际结果以[正式跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)为准。
- 第二批（本轮延期，不自动执行）：完整F58／F59、B／2×／5×三轮、固定窗口历史增长、双身份每类百对授权写、全部DEP与剩余局部故障矩阵、精确改前对照及索引完整成本。仍沿用原预算与判定器。
- 本次增量不包含其他进程的P1-66或核心可用性改动；共用文件保留已提交P1-66父版本，其他未提交任务排除。现网502／503具体原因未取得运维证据，不能因本轮优化宣称已定位或消除。
- 发布取证R、发布、上线均未执行；本次提交不构成面向用户更新的放行签字。后续用户试用前仍须按其候选核对必要验收和交付授权。

## 闭口层级

- 层级：功能合同
- 本条承诺：在声明的单实例规模内，治理方能够及时打开、筛选角色权限和 Agent 名册，统计慢或失败时仍可使用已核实的名册，展示复用不改变权限与统计含义。
- 本条出口：SC-01–SC-12；通过本模块真实接口、查询计划、组件交互及局部失败证明。
- 不在本条出口：整库旅程、跨模块与系统级故障演练、纯 MCP 完整业务旅程、线上网关故障归因、部署升级和交付签字。组合负载与纯 MCP 共存场景归共享 UAT 与既有 P1-13 发布取证。
- 上线关系：本条收口不表示可上线

## 1. 开工前事实、缺口与边界

1. 当前代码 `webui/server/admin/agents.ts` 的 `getStatsMap` 仅在聚合表达式中限制时间，主查询按用户读取全部历史；`getLastUsedMap` 对历史执行窗口排序。
2. `better-sqlite3` 同步查询运行于请求线程；外层 Promise.all 不提供线程隔离。
3. 角色列表已经做到一次请求共用一个 AdminPermissionContext，Agent 首屏也已延迟拉取角色选择数据；本条不将已实现优化重复登记为新成果。
4. [2026-11-18 版本核实回传](../../inbox/20261118-1549-customer-lucy-version-check-response/20261118-1549-customer-lucy-version-check-response.md) 为 0.30.0／3a9f0711／KTX 0.16.0。2026-11-19 21:44–21:52 网关返回 HTML 502／503，未取得当日构建与后端日志；不认定该故障已经由本条解释。
5. 拓扑为单 WebUI／MCP Proxy 进程、单容器副本；默认在隔离 Docker 环境验证。不改 KTX 源码，不新增部署方式，不扩大到分布式缓存。

## 2. 决策与优先级

| 决策 | 方案 | 约束与代价 |
|---|---|---|
| D1 第一批 | 窗口聚合与全部历史最近使用查询分离 | 保持现有半开时间窗、协议／业务／默认使用／评测探针分类、凭据碰撞含义 |
| D2 第一批 | 角色展示接入现有版本化快照与同版本构建合并 | 不另造 TTL 权限事实源；复用 Spec 174／195 的失效、核对与写屏障 |
| D3 第一批 | 错误分类与固定名分段耗时 | HTML 网关页不得继续呈现为 JSON 解析错误；不记录 Cookie、Token、SQL 参数 |
| D4 第二批 | Agent 名册与动态统计分区读取、分区失败 | 现有默认完整列表 API 保持兼容；新名册查询和统计端点属于待实现合同 |
| D5 第二批 | 统计可使用不超过 5 秒的短期展示复用 | 必须携带统计时间；手动刷新绕过已完成结果缓存；不缓存鉴权结论；失败不生成假零 |
| D6 条件项（已触发） | 剖析后纳入最多2个只读worker／排队8键；见Plan D6 | 不新增统计持久化表；仅D7明确授权的两条覆盖索引；完整规模预算延期第二批 |

与P1-13／Spec 174的关系：保留批量权限与既有性能基线，本条增加跨请求复用和统计分区。D5是对动态统计展示新鲜度的显式修订，不把统计长期塞进权限快照。相关实现已纳入首批候选；行为判定以本次正式跑次为准。

### 2.1 分期与收口边界

W1 为 D1／D2／D3，先交付算法减负、展示复用与错误分类；W2 为 D4／D5，后交付分区 API 与新鲜度补偿。W1 完成只记阶段结果，不宣称本 Spec 收口；SC-01–12 仍全部是完整合同出口。W2 若需独立延期或拆项，先修订合同范围并入账，再变更收口判据；不由实施者自行删减 SC。

模块验收使用共享 UAT 的 F58 选择器，不要求先完成 60 分钟组合稳定性、系统重启或全真 MCP 旅程。完整 2×／5× 组合压力仍为 R 发布取证选择器的必做，未运行不能宣称组合通过。具体映射只有 [suite「验收分层矩阵」](../qa/uat/suites/roles-agent-concurrency-scale/suite.md#验收分层矩阵) 一份。

### 2.2 性能预算决策

保留 fixtures §5 的 B／2×／5× 绝对预算，性质为明确硬件与夹具上的验收目标，不是已测能力或客户 SLA。开发前必须先冻结改前有效响应基线；改后同时满足绝对线和同档相对不回退：p95 同时恶化超过 20% 且超过 50ms 即失败，沿用 P1-13 的噪声带。SQL 窗口外历史敏感性另按 UAT-RACS-02 验证。

改前只有错误或超时的分组不能算快基线，也不能计算虚构改善百分比；改后仍必须满足绝对线与正确性。预算达不到时按 FAIL 回设计，后续改变阈值须具名评审、版本记录与委托人明确接受，不追随结果抬线；5× 不降为“只观察”。

## 3. 统计减负与等价性

### 3.1 查询拆分

- 所选窗口统计采用 `WHERE user_id IN (...) AND ts >= start AND ts < end` 后再分组；所有计数共用一次窗口与只读事务快照。
- `lastSeen`、`lastBusinessSeen` 继续表示全部历史的最新时间，单独查询，不能随窗口裁短。业务最近一次仍使用既有 Default Usage 分类。
- 配置凭据的最后使用信息优先按 `(user_id, token_hash_prefix)` 定位最新行，排序为 `ts DESC, id DESC`；准备语句复用，按配置凭据数量有界执行。与全历史窗口排序比较实际计划和耗时后选型，不能仅凭 SQL 写法声称更快。
- 共享／碰撞前缀、吊销与到期凭据、未知用户、无访问历史等沿用现有语义。全局活跃凭据与 Agent 范围统计分别计算，不混用分母。
- 每组统计响应记录同一窗口与观察水位；不能把不同时间读取的计数拼成同一快照。发现等价性失败先修正拆分，不通过改口径获得性能。

### 3.2 角色展示复用

快照键包含规范项目身份、内容根、访问配置路径、P/C 代次、来源映射版本、启用表摘要、模板／分类版本、是否含参考模板。按登录身份裁剪的结果另含身份与权限版本。键材料来自既有 reconciler 已核实的摘要，不为计算缓存键重新逐文件构建 source map。

所有请求先鉴权；同键只允许一个在途构建，其他请求等候同一个 Promise。成功后发布不可变结果；失败清除在途状态并保持既有失败退避；读写跨代次的结果不得回填。文件外部编辑、写入回滚、参考模板变化同样触发核对。不得把无法核实的旧权限显示为当前有效。

### 3.3 Agent 分区与 API 兼容设计

以下接口已实现，完整规模预算仍待第二批验证：

| 接口 | 内容 | 新鲜度 |
|---|---|---|
| 现有 `GET /api/admin/agents`（默认） | 维持完整 envelope、字段及 range 默认行为 | 继续完整读取；不得因新 UI 拆分破坏既有调用方 |
| `GET /api/admin/agents?view=roster` | 名称、状态、配置凭据信息、已核实权限摘要及配置版本 | 使用现有 P/C 展示核对；不读取历史统计 |
| `GET /api/admin/agents/statistics?range=7d` | 统计及摘要，另支持既有 14d／30d；返回配置版本、窗口、generatedAt、统计时间 | 5 秒上界的展示复用；手动刷新使用 `refresh=true` |
| 现有 `GET /api/admin/roles` | 维持现有响应形态，可复用验证过的展示快照 | 权限代次与核对健康约束，无陈旧权限宽限期 |

统计的静态路由须早于 `:userId` 注册；详情、dryRun、保存校验继续 fresh。新字段以可选扩展兼容默认完整 API；实现在 `webui/docs/03-api-spec.md` 同步登记。

统计缓存键含项目、身份裁剪边界、range、配置版本和分类版本；固定观察时刻asOf，窗口终点等于该时刻，不能对旧结果伪造新时间。TTL从读取开始算，过期在途结果不能重置TTL。5秒约束是展示缓存复用上界，不是SQL硬超时：新查询耗时超过5秒但仍在该请求正常预算内，允许向原请求返回正确结果与真实asOf，明确统计时间，不进入缓存、不宣称5秒内新鲜；禁止因TTL到期反复丢弃重算形成无逃生。强制刷新仅合并同一刷新批次的在途请求，不复用先前已完成结果。

页面先呈现名册，统计独立显示加载／不可用；配置版本不匹配的统计不拼接到新名册。涉及统计的筛选在统计可用前明确不可用，其他搜索、浏览与进入详情仍可用。权限未经核实时不得据旧展示执行授权决定；用户能重试或进入 fresh 详情，不能只剩死路。

调用次数／活跃凭据等统计与当前权限状态分区显示；统计时间只修饰统计区，不修饰权限区。保存、签发或撤销等动作不能因“统计显示可用”而放行，仍由服务端 fresh 校验决定；不新增一句工程化免责声明代替这条机制。

## 4. 请求、错误与观测

- API 客户端按状态码和 Content-Type 识别 HTML 502／503，不显示原始 HTML、解析异常、路径或堆栈；页内提示服务暂不可用，并提供重试和请求编号。
- 区分 401 登录失效、403 无权、409 配置冲突、JSON DISPLAY_SNAPSHOT_BUSY、HTML 网关故障；无关 503 不能被解释为“账号在别处登录”。
- 两个列表的读取最多自动重试一次，仅用于DISPLAY_SNAPSHOT_BUSY或明确可恢复的502／503；遵从Retry-After，增加随机退避；401／403／409／普通校验失败不重试。额外重试与退避总预算5秒，取消即停止，初次有效查询不因缓存TTL被中止；单次HTTP预算见fixtures。共享apiClient只做错误分类，不把此重试策略全局施加到其他页面。写请求禁止自动重放。
- 使用统一查询键与 AbortSignal；统计展示 freshTime 上限 5 秒，不增加后台高频轮询；切换页面后停止无消费者请求。权限保存成功立即失效相关展示，禁止保留一个仅靠 TTL 才失效的授权摘要。
- 复用 Server-Timing 的固定指标 `access`、`permissions`、`stats`、`total` 与 hit/miss；补齐角色路径计时、返回条数、构建／合并次数和错误分类。请求编号可关联服务日志，但不写凭据或完整用户数据。

## 核心流程（伪代码）

```text
readRoles(request):
  authenticateAndAuthorize(request)                  # 每次请求都执行
  inputs = captureVerifiedDisplayInputs(P, C, templates, classifier)
  if unverified(inputs): return retryableBusyWithoutPermissionPayload()
  result = singleFlight(inputs.key, compileAllRolesOnce(inputs))
  if generationChanged(inputs) or writePending(): discard(result); boundedReread()
  return immutableVerifiedList(result)

readAgentStatistics(request):
  authenticateAndAuthorize(request)
  config = captureAccessSnapshot()
  key = (project, principalScope, range, config.version, classifier)
  if not forceRefresh and completedCacheWithin5s(key): return withOriginalAsOf()
  return singleFlight(key, forceRefreshBatch, () =>:
    beginReadSnapshot()
    asOf, ceilingId = captureAuditBoundary()
    counts = aggregateWithinHalfOpenWindow(asOf, range, ceilingId)
    latest = latestAllHistoryAtBoundary(config.credentials, ceilingId)
    result = composeWithoutChangingMetricMeaning(counts, latest, config.version)
    endReadSnapshot()
    if configChanged(): discard(result); boundedReread()
    if auditUnavailable(): return unavailableWithNulls()
    if cacheAgeWithin5s(result): publishCacheWithOriginalAsOf(result)
    else: doNotCache(result)           # 不因TTL超时丢弃原请求的正确结果
    return result)

renderAgentPage():
  startRosterAndStatisticsIndependently()
  showVerifiedRosterEvenIfStatisticsPendingOrFailed()
  joinOnlyMatchingConfigVersions(); showOriginalStatisticsTime()
  onManualRefresh(): bypassCompletedStatsCache(); retainUsableRoster()
```

## 受影响画像

判定为设计目标，未执行证据；依据 [画像规范](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| 问数方 | 治理重读可能占住同进程 | 统计读取减负，纯 MCP 授权语义不变 | ＝ | SC-02／05；组合共存见 UAT-RACS-12 | 不改变纯 MCP 入口；不得要求 WebUI 登录 |
| 治理方 | 名册等待统计；统计按请求时刻读 | 名册更快，但统计结果可额外复用至读取开始后5秒，真实时间可见 | ↓（按最差子面） | SC-06／07／08 | 统计时间可见，立即刷新绕过缓存；慢查询完成后可返回正确结果，不因TTL永久丢弃；UAT-RACS-07／08 |
| 运维方 | 网关错误伪装成解析错误 | 分段耗时、请求编号、准确错误分类 | ↑ | SC-09／10 | 无负向；不要求新部署渠道 |
| 管理层 | 指标失败或零值容易误读 | 不可用不造零，窗口与统计时间可核对 | ↑ | SC-02／06 | 无负向 |

治理方统计新鲜度的 ↓ 有同页可达补偿，不能以缓存为理由阻断合法配置，不违反主路径可用性原则；若补偿未验通不得收口。

## 5. 验收

| 编号 | 本条可打假检查 |
|---|---|
| SC-01 | 固定窗口、增加窗口外历史的真库执行计划与访问量证明窗口聚合不再随全部历史线性扫描；最新记录路径单独量化 |
| SC-02 | 原始调用金样本逐项核对 7d／14d／30d、最新时间、同时间戳、边界、碰撞、协议／评测分类；结果完全等价 |
| SC-03 | 同键 25 个并发读取只构建一次；改变键则不错误共享；失败、取消、无消费者均释放在途状态 |
| SC-04 | 配置／来源／模板变化及回滚、外部文件变动使旧结果失效，禁止旧权限回填 |
| SC-05 | 展示缓存不得参与运行时授权、dryRun 与保存校验；收紧权限后的授权结果仍符合原合同 |
| SC-06 | 缓存复用不超过读取开始后5秒，原始asOf／窗口不改写；强制刷新取新边界；耗时大于5秒但小于单次HTTP预算的正确结果仍返回原请求、不可缓存，失败才为unavailable／null |
| SC-07 | 新旧 API 兼容；不同配置版本的名册与统计不得拼接；统计路由不被 :userId 吞掉 |
| SC-08 | 统计等待／失败时名册仍可搜索、进详情；统计筛选明确状态，刷新可恢复，无草稿被刷新清空 |
| SC-09 | 真实 HTML 502／503 与应用 JSON BUSY 分开呈现；401／403／409 不误重试；读重试有界、写请求不重放 |
| SC-10 | 真实进程输出可关联的固定名耗时和构建数，无凭据；错误响应不计性能成功 |
| SC-11 | F58 模块接口在 fixtures 的 B／2×／5× 对应数据档上同时满足绝对预算与同档相对不回退；冻结有效改前基线，错误组不得冒充快基线；不倒挂 R 组合发布选择器 |
| SC-12 | 下列元素清单均有桌面浏览器证据；逐编号覆盖真实加载、空、过滤、部分失败和恢复 |

模块性能用例仅压本模块；系统探针、MCP 并行旅程和故障恢复作为共享 UAT 组合观察，不偷塞本条出口。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None. 使用既有「角色权限」「Agent」「统计时间」「加载中」「重试」；single-flight、asOf、快照键仅为工程术语，不进入用户流程。错误正文不透内部码；可展开详情显示请求编号。专业英文、对象名、路径与 URL 节点保留翻译防御。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/12-components-metric-card.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- 分区加载／失败在区内呈现；错误带重试；保留可用内容；指标不可用不用假零。
- 沿用列表、指标卡与按钮；每个 action group 最多一个 primary，不增加后台操作入口。

### Exceptions (If Any)

- 无，不新增视觉模式。

### Follow-up Needed

- 实现前完成下列交互评审与授权，运行后按元素编号保留证据。

## 交互合同

- 路由：/admin/roles、/admin/agents
- 基准页：/admin/agents
- 一件事：先读取可信名册，统计失败可恢复且不冒充实时结果。
- 状态：首访：名册入口可识别；空：无配置有创建入口；加载：名册与统计独立；错误：区内原因与重试；0 条：筛选无命中可清除；成功：名册可进入详情；部分：名册可用而统计不可用有时间与原因
- 主动作：沿用既有新建入口为 primary；重试与刷新为次要，不做多个同组 primary。
- 决定信息：名称、状态、已核实权限范围、统计时间、不可用原因。
- 术语：已登记，沿用 Terminology Compliance。
- 台账：无新台账
- 状态维度：名册与统计分区标明，同一状态维度不得互相否定。

## 元素清单

- E1｜/admin/roles｜首访｜页头与列表｜可识别角色权限主任务
- E2｜/admin/roles｜空｜列表｜无角色时有原因与创建入口
- E3｜/admin/roles｜加载｜列表｜加载状态可感知
- E4｜/admin/roles｜错误｜列表｜网关或刷新失败有原因与重试
- E5｜/admin/roles｜0 条｜筛选区｜无命中能清除筛选
- E6｜/admin/roles｜成功｜列表｜可信角色可进入详情
- E7｜/admin/roles｜部分｜列表｜个别无效角色有警告其余可用
- E8｜/admin/roles｜主动作｜页头｜既有新建入口层级正确
- E9｜/admin/roles｜决定信息｜列表｜权限核实状态与原因可见
- E10｜/admin/agents｜首访｜页头与列表｜可识别 Agent 名册主任务
- E11｜/admin/agents｜空｜列表｜无配置时有创建入口
- E12｜/admin/agents｜加载｜列表与指标｜名册与统计独立加载
- E13｜/admin/agents｜错误｜指标或列表｜失败区可重试不清空其他区域
- E14｜/admin/agents｜0 条｜筛选区｜区分无配置和筛选无命中
- E15｜/admin/agents｜成功｜列表｜可搜索并进入详情
- E16｜/admin/agents｜部分｜指标｜统计不可用不造零并保留名册
- E17｜/admin/agents｜主动作｜页头｜新建为 primary 刷新为次要
- E18｜/admin/agents｜决定信息｜指标与列表｜统计时间与配置状态不混淆

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 7. 修订与设计评审记录

2026-11-19 吸收 Cursor 评审中关于分期、预算基线与验收层级的建议；保留全部 2×／5× 用例及硬正确性。六问为本稿的设计审阅：页头入口、分区状态、决定信息、组件和术语均已在合同逐项定义，不表示浏览器已执行。E1–E18 编号保持稳定；修订期望须版本留痕，历史证据不得回写。

## 2026-11-20 D7：覆盖索引条件方案（委托人已授权）

委托人已在本次聊天明确回复“授权纳入两条索引”。不再受本次早期“无新增schema”实施选择限制；只允许下列两个既有审计表索引，不新增表、列、持久统计库或KTX改动。

- `idx_al_agent_window_cover(user_id, ts, token_hash_prefix, tool, outcome, eval_mark, args_summary, tables, client_ip)`：覆盖窗口分类、热门表及凭据IP。
- `idx_al_ts_token(ts, token_hash_prefix)`：覆盖全局窗口活跃凭据。

在已有监听前审计库warmup完成`CREATE INDEX IF NOT EXISTS`，复用既有初始化入口；不把首次建索引放入HTTP请求或onReady钩子。索引只改变物理读取，不改变统计、权限、写入、未知结果或数据格式合同。分类仍来自usage-classification同一事实源。

真实废弃专用卷实验：500万历史、100万窗口、500 Agent／1500凭据、2CPU／4GiB；两索引后7／14／30日读取约1.81／1.22／1.54秒，构建约47秒，约0.85GB索引空间。该实验不是完整F58 PASS。具体原始取证和方案见`inbox/p1-58-59-finalization-20261120/covering-index-decision.md`。正式候选须记录dbstat索引实际字节、重入、既有数据完整性、初始化耗时及增量写入成本；绝对预算不变。发布和上线仍未授权。
