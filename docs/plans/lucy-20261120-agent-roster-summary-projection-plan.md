# Agent 名册摘要投影与单对象详情按需读取 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v0.3（委托人批准分批） |
| 日期 / 产品线 | 2026-11-20 / 0.30.0 |
| 功能 / 需求 | P1-66／REQ-030-087；不入核心分母 |
| 状态 | S5｜v0.3。委托人2026-11-20批准分批收敛及本进程commit；批次A功能合同已收口；本机Docker最小验收PASS WITH GAP；批次B暂停，原v0.2完整矩阵FAIL保留；本批增量提交；未推送／发布；不入核心分母；本批收口不表示可上线。 |
| 授权边界 | 委托人2026-11-20确认 v0.2 定稿并授权 T1–T7 开发及 Docker 浏览器验证，完整覆盖旧接口、按需详情和六组权限夹具；不提交、推送、发布，不升级 109 |
| 验收 | [Spec SC-01–SC-12](../specs/lucy-20261120-agent-roster-summary-projection-spec.md#6-验收)；[测试台](../qa/uat/INDEX.md) UAT-SUITE-AGENT-ROSTER-SUMMARY；执行进度与失败证据见测试台配套 run |
| 关联 | [Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [总账 P1-66](lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [需求池](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |

## 目标

2026-11-20 委托人批准按分批决议收口并 commit 本进程。当前批次按 Spec §0 的 BA-01–07 做最小验证；不恢复六组长矩阵，不扩大编译器优化，不推送／发布。下方 T1–T7 是原完整计划和实现溯源，未完成的冷／大规模／完整写入故障部分转后续批次，不作为本批已经执行的声明。当前执行记录以批次 A run 为准，原 v0.2 FAIL 保留。

给新名册增加显式摘要表示，保留旧完整列表／旧 roster 调用契约；名称打开的详情抽屉按 ID 读取，编辑保留完整 fresh 权限；用相同 Docker 数据与资源证明响应缩小、页面变快和合法主路径不受损。

## 方案与架构

采用 Spec 方案 A：显式摘要 API、独立前端 DTO／查询键；服务端沿用同一个 agent-permissions 快照槽，以原完整 payload＋小 sidecar 原子发布。摘要与 statistics 均只 parse sidecar 并沿用原 snapshotVersion；旧完整消费者仍读原 payload。冷态保留一次完整序列化的兼容成本，不能宣称服务端只存在摘要。凭据计数由响应时刻配置生成，统计晚到不覆盖；单对象 detail 按需 HTTP 读取。

技术栈沿用 Fastify／TypeScript、React Query、现有 display snapshot、一致性写屏障、better-sqlite3、Docker compose、桌面 Chrome；本条不增加依赖、线程、数据库表或部署渠道。

本轮过程评审：[8 项发现与修订](../reviews/2026-11-20-p1-66-spec-plan-strict-review.md)；之后委托人明示 v0.2 定稿并授权开发／执行。

## 开工前置

1. Spec／Plan 经过过程审阅、Codex CLI 终审或委托人明示终稿确权；取得本条明确开发授权。Docker 造数／浏览器执行范围须在该次授权列明。
2. 重读最新 `agents.ts`、对象版本与快照实现；共享工作区存在其他会话未提交改动，不能覆盖或把其成果混作本条。冻结改前候选 gitSha、dirty diff 摘要、镜像 ID，避免用只有旧 109 的结果冒充同构基线。
3. 根据 fixtures 生成隔离 compose 项目／卷、独立端口和虚构凭据；禁止写共享 demo／109／现有配置卷。确认 Docker Desktop 配额，正常盘固定 2 CPU／4 GiB；若无法提供该资源，先具名调整设计并记录，不跑完再改阈值。
4. 摘要白名单、legacy adapter、Token 有效性规则、详情窗口、查询键隔离与名册主体兼容由 Spec §3 唯一定义；不由实施者为方便删字段／变更默认。
5. 夹具有效性和分布清单先达标，再冻结有效改前基线；缺失现场分布只标为未知，B109 是保持已知下限的合成样本。

## 实施步骤（未来执行）

### T1 — 冻结兼容金样本与计数 oracle

- 修改测试：`webui/server/__tests__/admin-agents.test.ts`；新增 `webui/server/__tests__/agent-roster-summary.test.ts`；复用 `roles-agent-concurrent-edit.test.ts`。
- 先对原默认／range／roster／单对象／effective-permissions 请求冻结完整字段与空／异常 envelope；单元／接口受控时钟固定边界，Docker 使用 fixtures 的实时时钟和边界空带；数组顺序与集合语义分别核对，跨容器不比较包含路径／mtime 的 opaque 版本值。
- 冻结有效／过期／吊销／禁用凭据、角色冲突、legacyWildcard、合法零权限、解析失败、跨连接同名表、OR Role 与个人行限制样本；独立 oracle 从原完整响应计算计数，不能复用被测新摘要函数。
- 对 `projection=summary` 的禁带字段、新 DTO、错误参数和先后路由写先红检查；每个更改只实现使其转绿的必要步骤，不改全局 helper。
- 未来聚焦命令：`cd webui` 后 `npx vitest run server/__tests__/admin-agents.test.ts server/__tests__/agent-roster-summary.test.ts server/__tests__/roles-agent-concurrent-edit.test.ts`。新文件尚不存在，当前不运行该命令。
- 验收映射：SC-01／02／05；证据为原 fixture 与独立 expected 摘要，不是只断言键名存在。

### T2 — 同槽双表示与统计轻量版本读取

- 修改：`webui/server/admin/agents.ts`；使用已有 `webui/server/display-snapshot.ts` 的 `{payload,sidecar}` 支持，若需调整只限类型／共享读句柄；不改 Proxy 编译算法、SQL 分类或访问配置。
- 先把“取得 agent-permissions 槽”和“parse 原完整 payload”拆开；一次 PermissionBatch 构建返回原完整 JSON 与 schemaVersion=1 的摘要／policyInputs sidecar。保持原 key 名、extraKey、原 body 字段和公开 snapshotVersion 算法。
- 摘要 route 验参数，只读小 sidecar；**readAgentStatisticsDisplay 同步迁移为小 sidecar 取版本**，保持旧 HTTP envelope／缓存 TTL／asOf／原统计语义；不能调用旧 agentPermissionSection 后才取 policyInputs。

```ts
const slot = await readVerifiedAgentPermissionSlot(inputs, budget, async () => {
  const batch = await existingPermissionBatch(inputs);
  return { payload: serializeOriginalSection(batch),
           sidecar: serializeSummaryAndPolicyInputs(batch, 1) };
});
const small = parseValidatedSummarySidecar(slot.sidecar);
const joinedVersion = originalAgentListVersion(slot.version, small.policyInputs);
// 摘要：组合配置字段和当前凭据数；statistics：沿用原统计读取和 TTL。
// 两条轻读路径不 JSON.parse(slot.payload)；旧完整路径仍 parse 原 payload。
```

- 补“同一代下摘要／旧 roster／statistics 版本三者相等且统计实际可 join”的正例；改 P/C／失败／部分 sidecar 发布为负例；10 并发只一次共享构建。摘要 DTO 与完整 DTO 互不覆盖，但不要再建一个 section 名直接当配对版本。
- 热态全旅程追踪摘要和统计两请求：完整 payload parse 次数=0；冷态共享构建完整序列化一次，不隐瞒既有 prewarmer 的工作和驻留内存。sidecar 缺失／坏 schema 先以 section＋捕获的槽实例标识（incarnation／内部引用）条件淘汰整对坏槽，必要时在 display-snapshot 内补仅供内部使用的 CAS 失效入口；同请求最多重建一次且并发合并，共用既有预算，失败报错，不静默 parse 大 JSON 兜底。
- 验收映射：SC-02／03／06／09；只检查摘要 URL、漏掉 statistics 内部 parse 的测程不合格。

### T3 — 独立类型、查询键与旧端适配

- 修改：`webui/src/lib/types.ts`、`webui/src/lib/displayQueryOptions.ts`、必要的 `queryKeys.ts`；新增 `webui/src/lib/agentRosterSummary.ts`及对应聚焦测试。
- 原 Agent／AgentsRosterResponse／adminAgentsQueryOptions 保留。新增摘要 row／response、独立查询 helper，使用 `roster,summary,v1,range` 后缀，请求附带相同 range 以保证旧端统计窗口；新端 section 不因此重编译；保持项目／身份 epoch 和 display-write invalidation。
- legacy adapter 只接收已知旧完整 envelope：从一次响应归一字段，缺计数标 null，携带原统计窗口和 fallback 分类；不第二次读取全量列表，不冒充服务端 summary 标记。
- 按 Spec §3.2 实现 summary-v1／legacy-roster／legacy-full 读取状态机：新端严格 version join，legacy-roster 保留原标识配对；legacy-full 仅用同 body 且窗口正确的统计，本轮不再发 statistics。仅已识别旧端的精确 statistics JSON 404 可记能力缺席；未知错误不误降级。手动刷新、窗口变化和身份变化的迁移逐条有测试。
- 验收映射：SC-03／07。新旧端矩阵由真实旧容器与候选容器验证，受控 malformed 响应用组件测试补边界，不冒充全真成功。

### T4 — 名册与详情入口迁移

- 修改：`webui/src/pages/admin/AgentList.tsx`、`webui/src/components/ObjectDetailDrawer.tsx`；回归 `webui/src/pages/admin/AgentDetail.tsx`；E11／13 的独立详情错误分支增加返回名册和重试，只有已验证 AGENT_NOT_FOUND 404 才写不存在，不改写协议。
- AgentList 改用摘要 DTO；新增摘要专用汇总与可用性 helper，不把摘要传给依赖 tokens[] 的 summarizeAgents／configuredTokenCount／activeTokenCount。逐行及顶卡 configured／available 始终从 credentialSummary 读取，旧端未知显示不可用，不用 stat.availableTokens 盖回旧值；现有搜索、角色／状态筛选、活跃分档、业务统计、旧通配提示与名称／编辑／新建入口保持。统计未知时禁用依赖统计的筛选并解释，配置筛选继续可用。
- AgentDetailBody 只在抽屉打开时调用单 ID detail，使用 [...queryKeys.adminAgents,"detail",id,"7d"]、agents displayRead／AbortSignal；纳入 Role／Agent／来源／Token 写失效和身份 epoch 隔离。显式 7d 保留原标签，不复用编辑缓存或 A 对象 placeholder；关闭／A→B 取消旧请求，晚到不得填回。仅真实 AGENT_NOT_FOUND 判不存在，其他错误按分类显示／重试，关闭保留名册上下文。
- 禁止从摘要初始化编辑 Agent、预填 `tokens: []`／`constraints: null`，禁止列表 mount／hover／滚动预取全体 detail。草稿基线、dryRun、保存 fresh 与 operationId 保持 P1-59。
- 聚焦测试：`src/__tests__/agent-list.test.tsx`；定位既有 ObjectDetailDrawer 测试后补请求次数、ID／窗口、403／404／503、关闭恢复；新增摘要适配单测。执行命令与原始结果记录在配套 run。
- 验收映射：SC-04–07／11；网络断言必须检出“名称点击又调用完整列表”的负控。

### T5 — 同步接口与用户合同

- 修改：`webui/docs/03-api-spec.md`、`webui/server/admin/openapi-document.ts`、`webui/server/__tests__/admin-openapi-discoverability.test.ts`；摘要投影为可选表示，旧默认仍完整。
- 更新本 Spec／Plan、测试台 fixture 校准值和消费者盘点；不把工程投影术语放入页面文案。现有名册／Token 术语与权限拒绝不另造定义。
- 兼容 smoke 覆盖 NewToken、Onboarding／Step6ConnectAgent、McpPlayground、Audit；既有 helper 仍返回完整类型。文档与实际响应逐条对照。
- 验收映射：SC-01／07；动态新增命令若成为 package script／CI，按 DEVELOPMENT 登记测试门禁。本条脚本通过显式 node 命令执行，不隐含已挂 CI。

### T6 — Docker 同规模改前改后与前台浏览器

- 新增：`scripts/uat/agent-roster-summary.mjs`（真实夹具／API／裁判）、`scripts/uat/agent-roster-summary-browser.mjs`（前台探针），必要的 runner 自检测试。执行器已按本计划创建，实际结果见测试台 run。
- 复用 compose／既有种子公共机制；业务配置经 Lucy 接口或隔离预置文件导入、真实编译；审计数据仅写专用测试库，受控造数记录分类与时间水位。
- 先 ARS-R0；候选 B 测量前冻结 BAL／SKEW 两种合成分布及其 B109／W2／W5 独立复制图谱、字节与编译指纹。每组改前→改后同 seed，换向再跑一轮排除热机偏差；按 fixtures 的实时时钟／边界空带对照，不冻结产品 Date.now 或改写日志时间。任何请求失败进入结果；先报告无有效基线，不计算虚构倍率。
- 模块功能／浏览器执行 ARS-01–12；局部失败需真实进程故障或可证明网络故障，夹具／响应 mock 仅用于裁判负控；不能 mock 成功权限响应来凑规模。
- 证据：`docs/qa/uat/suites/agent-roster-summary/runs/<date>-<candidate>/` 下 manifest、per-agent-scale、API／browser JSON、request trace、截图、verdict、清理核对；凭据留仓库外。
- 验收映射：全部 SC。完整 RACS-R、系统压力／重启仍沿前序发布取证，不混成本模块已过。

### T7 — 评审、清理与现值同步

- 先验证新产生的全部相对链接、状态同句、SC↔ARS、E 清单映射与失败样本；再提交给终审／委托人，禁止自称 CLI 已审。
- 独立卷按 fixtures 清理或具名保留；复核 demo／109 无写入，无遗留 Token、进程或高频探针。
- 状态变更一次同步 Spec、Plan、总账、需求池、docs 与 plans 索引、project-overview；测试结论只以 INDEX 为准，e2e-ledger 改指针与 GAP，不重写历史。
- 验收映射：SC-12；实现提交／推送／发布另按授权，当前没有执行这些操作。

## 浏览器验证

- 路由：/admin/agents、/admin/agents/:userId
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16、E17、E18
- 证据：未执行

## 浏览器计时方法

详细执行定义在 [cases](../qa/uat/suites/agent-roster-summary/cases.md) 与 [fixtures](../qa/uat/suites/agent-roster-summary/fixtures.md)，本节不复制第二套预算。要求每轮真实前台焦点＋`visibilityState=visible`；浏览器 primaryReady、statsReady、drawerReady、permissionReady 与 API 分列。冷／热／刷新分开，导航起点即时计时；新指纹对应行／计数才算 ready，保留旧行的缓存命中不能替代新内容成交。默认不测移动窄屏。

## 验收与完成定义

- 当前文档交付：P1-66／REQ-030-087 入账、Spec／Plan／suite／cases／fixtures、索引与三台勾连完成；状态同句；文档门禁无本条新增违规。此定义不包含实现和 UAT PASS。
- 未来功能出口：SC-01–12、ARS-R0／01–12 与 E1–E18 全部有证据，摘要字段／权限／凭据计数等价、旧消费者与纯 MCP 合法路径保留，各档预算与相对闸通过，完整详情可达。缺前台计时不能整套 PASS；夹具不到下限不能称保留现场规模。
- 本条收口不表示可上线；不覆盖 P1-58、P1-59 或 RACS-R 尚缺的验收。

## 风险与回退

| 风险 | 控制与回退 |
|---|---|
| 新旧缓存同形异义导致权限或 Token 清空 | 独立 DTO／查询键；摘要不写入 Agent 编辑缓存；原完整入口始终保留 |
| 开抽屉仍下载整册 | ARS-05 请求计数与路径断言；失败时回退前端到原完整消费者即可，新摘要入口为可选，不改服务端默认 |
| 只剪 HTTP，内部仍大 JSON parse／stringify | 同槽小 sidecar，摘要＋statistics 整旅程 parse 计数与宽度 sweep；冷态完整 payload 兼容成本如实列出，未满足 SC-03 不收口 |
| 冷编译仍慢或全历史统计争用 | 单列冷读和统计时间；越线如实 FAIL；另回 P1-58／容量条目评估，不暗改权限算法或加 worker |
| 详情新增请求失败降低体验 | 局部加载／重试、名册上下文保留、直接编辑入口；画像 ↓ 的补偿必须真实验通 |
| 现场分布不全或造数不足 | 只主张已知总规模；BAL／SKEW 均含共享与分散角色子组，倍率用互不相交复制保留每人宽度；真实图谱／去重／字节均过闸，功能边角不占性能样本；敏感现场文件不导入公共夹具 |
| 共享工作区／Docker 干扰 | 独立 compose 项目、卷、端口；冻结候选与资源；另会话重建／改配置则该轮失效重跑 |

## 文档落盘自查

命名／配对、元数据、五类 Plan 小节、闭口层级、4 画像及负向补偿、Terminology／Design System、交互合同与 E1–E18、前台计时、需求与开发测试三台、同句状态和未授权边界均已设计。新增命令／依赖／CI／客户制品为不适用（本轮未新增）。机器门禁仅证明文档结构；不代替内容评审或终稿确权。

## 执行补记（2026-11-20；不调整 v0.2 门槛）

- 完整旧接口、同槽 sidecar、独立摘要适配和单 ID 抽屉已实现。独立同构服务端回归 113 项、前端聚焦回归 91 项、旧消费者／缓存隔离 94 项通过；这些是不同测试批，原始日志及重复关系由 run 说明，不能据此替代 Docker UAT。
- 与并行工作共享文件时，P1-66 测试使用冻结 A 加本条差集的候选；独立写窗口、草稿拦截和全局 displayRead 超时改动不计入本条 A/B 效果，原工作区保留。
- 夹具 6 个数据工具下，来源下限不足以形成单人 2,000 capability，故每副本实际 724／720 来源；BAL 15,240、SKEW 15,060 capability。增加真实来源，不使用响应 padding。WIDTH-L 约 1/3 授权宽度，H 不改批准下限。
- 归一化完整编译 AST 校验 OR／AND 分组，逐人 HTTP 另与原始编译结果核对 source-bound grant 摘要；仅移除副本命名引起的 hash 差异不能充当语义等价证明。
- 首轮冷读已观察到 10s 请求超时，候选后台构建恢复仍需额外等待。等待仅隔离样本，不扩大读预算；冷编译缺口如实记 FAIL，不在本条擅自优化 Proxy 编译器。
- 最终 SC／ARS／E 覆盖和清理证明以 [执行记录](../qa/uat/suites/agent-roster-summary/runs/2026-11-20-codex-p166-docker.md) 为准。
