# WebUI Entry Performance Spec

| 元数据 | 内容 |
|---|---|
| Spec 编号 / 版本 | 174 / v1.2 |
| 日期 / 作者 | 2026-10-13 / Codex |
| 委托人 | zhangxingchen |
| 状态 | Implemented · Verified on anonymous fixture（2026-10-13，PERF-01–10 / SC-01–24，见[执行报告](plans/wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md)）；目标环境未部署 |
| 授权 | 用户于 2026-10-13 同意进入卡顿优化方案，要求生成 Spec 与 Cursor 实施、验证工单 |
| 工单 | [WO-20261013-174](plans/wo-20261013-webui-entry-performance.md) |
| 范围 | Lucy WebUI 服务、前端与构建产物；单进程、单实例；桌面浏览器 |
| 治理 | [DEVELOPMENT](../../docs/governance/DEVELOPMENT.md)、[术语标准](00-product-terminology-standard.md) |

编号沿革：main审阅时暂编号161；第一次转到lucy-v2.0时暂顺延163。2026-10-13拉取到e189346后，161–173均有既有Spec，因此正式交付编号174，旧161/163链接仅为历史名称，不保留同号别名。

本次重评基线：`e189346`（lucy-v2.0）；恢复来源：stash对象`765374648b4cb4fa18d00b22b3b8ada79f1eb95a`，名称`wip before pull lucy-v2.0 20261013-1529`。仅恢复本工单的三份文档，最新README/项目索引按当前分支增量登记，原stash保留。

v1.1 审阅修正：补写前/写中屏障、两套 access 回滚、catalog_bound 输入、响应整体版本、运行时隔离、前端时效与基线/cold 测量合同。授权范围不变，仍待实现与验收。

## 1. 问题、证据与目标

进入 `/catalog`、刷新 `/connections` 和打开 `/overview` 时，数据准备会阻塞主内容。`App.tsx` 静态导入所有页面；`/api/sources` 分别解析目录与 Manifest 摘要；每个 Agent 的 Admin 展示解析又独立读取 access 与 fresh source map。连接概览用 project/sources 的联合 loading 提前 return，一条慢请求因此隐藏标题、操作区和全部卡片。

2026-10-13 目标环境 `http://10.69.95.109:8276`（v0.17.0）记录：浏览器冷缓存刷新 JS 405 ms、auth/status 15 ms、sources 12,230 ms（等待响应 12,170 ms，下载 64.31 ms）；独立 sources 请求 3,986–4,585 ms；JS/CSS 响应体合计 1,653,470 B，本地 gzip 试算 387,474 B。环境为开放模式，未测试密码提交。

这些是排查样本，不能当作 P95 或主线程 profile。连接页较独立请求更慢与并发探测相伴，资源竞争需新增计时验证。完整排查暂存于 `inbox/20261013-webui-entry-stutter-review-and-plan.md`；本 Spec 自包含必要事实，实施不依赖 inbox 保留。

目标：减少重复计算，让真实数据与操作进入毫秒量级；慢连通探测只影响自己的状态区。骨架出现不等于真实内容可操作。

## 2. 范围与既有契约关系

| 涉及对象 | 本次变更 |
|---|---|
| `/catalog`、`/connections`、`/overview` | 分区加载、查询缓存、局部错误、后台更新 |
| Agent 列表 | 批量权限上下文、显示性能；不改授权决策 |
| `/api/sources` | 单次语义读取派生 tables/manifestSchemas，版本化显示快照 |
| `/api/admin/agents` | 一批一次上下文；动态审计统计仍独立查询 |
| live-schemas / connection test | 合并进行中任务、配置版本失效、服务端限并发 |
| 静态资产与 App | 预压缩、协商缓存、路由 lazy、chunk 失败恢复 |

不变：路由与首页重定向、字段搜索、enabled 范围、权限算法、deny 码、政策提交/生效顺序、KTX CLI/API、数据库配置、密码算法、CSRF、MCP 指导内容、健康阈值。

本 Spec **仅替代 Spec 108 §2 第 2 项的无限制“并行”调度**，改为内容首帧后排队、全局有限并发；保留每次进页探一次、Drawer 同源、失败隔离、不挡首屏。Spec 108 §3“本轮不做浏览器验证”不适用于本单。本单明确需要桌面浏览器验证。

Spec 107 的只读查询、10 分钟成功结果缓存和 `refresh=1` 保留；增加进行中合并与配置变化失效。健康完成结果不跨页复用，不能用旧“通”冒充本次探测。

不引入 Redis/新持久化读库、分布式锁、多副本承诺；不修改 KTX 源码。不降低密码校验成本，不把数据库探测绑到 liveness。不包含客户发布、生产数据库压测或客户镜像制作。

### 2.1 拉取最新 v2.0 后的适配结论（v1.2）

本次以e189346代码评估，历史浏览器样本来自旧部署；没有将旧12.23秒样本宣称为最新commit性能，也没有运行应用优化代码。

| 最新契约/代码 | 对本单的约束 |
|---|---|
| Spec163连接卡收纳、Spec164表结构下一步 | 保留卡抬头“添加Schema/更多”、接入进度入口、列表至多一条问数提示；不得恢复四层徽章、页脚按钮或canary调用。延迟状态只按现有列表提示规则显示 |
| Spec168 Agent多角色 | 保留roles数组、单角色兼容role、双声明错误与declaredRole(s)、正式目录顺序、参考模板拒绝；详情dryRun与门禁继续真实preview，不使用显示cache |
| Spec131与acl::resolveCatalogConnections | lucy_admin跟随所有已配置连接（即使allow.connections旧列表或为空）；非lucy_admin的catalog_bound wildcard继续拒绝。context的连接Map须包括零enabled表连接，不可只从Manifest反推连接集合 |
| Spec170 Skill/Wiki开放 | 当前CONTEXT_TOOLS列举/裁决及发布状态规则不变；只优化展示，不恢复旧对象/角色授权、不根据展示capabilities重新限制上下文工具 |
| paths.ts已按projectRoot/env缓存 | 不重复实现这项已落地修复；保留现有cachedKey。仍需ktx.yaml paths.content_root变更时显式失效、watcher迁移以及隔离测试 |
| project::createConnection已改为后续audit异常回滚 | 屏障覆盖整个事务及rollbackWrittenConnection，含secret清理（不读取内容做指纹）；不得恢复旧的“已写配置即永不回滚”行为 |
| 新readChangedSourceColumnContracts/publish-gate | 轻量summary缓存不得用于替代校验读原始columns；保留float等不合法原值被拦截的门禁 |
| Spec172/173审计会话/问询分层 | 性能fixture与动态统计使用真实当前schema、session/turn/source映射；只缓存权限派生，不能冻结或退回旧问询归因/协议调用计数 |

结论：性能瓶颈路径仍在，但stash v1.1不能原样落地；本v1.2是以上衔接后的执行事实源。已有Spec163–173不在本单覆盖范围；只在必要处补引用，不重写其已实现行为。

## 3. 后端读模型与权限展示

### 3.1 一批一次上下文

新增内部 `resolveEffectivePermissionsBatchForAdmin`（或等价命名）与只读请求上下文。一次读取新鲜 access 配置、policy、source map，逐 Agent 调用既有 resolver。上下文固定 projectRoot、resolved content root、configVersion、sourceMapVersion，结果保留原有逐 Agent ok/deny/permissionWarnings。

还必须固定 `enabledTablesByConnection/ enabledTablesDigest` 与 `TOOL_CLASSIFICATION_VERSION`；`compileRole` 的 catalog_bound 当前会自行调用 `loadEnabledTablesByConnection`，批处理必须把这份输入显式透传，不能每角色读取磁盘。同批的 sources.enabled 与 catalog_bound 权限使用同一启用表快照。

Agent 列表的 users、字段、响应 version、权限、summary 的用户集合必须来自同一个 access 快照；不能先 `readAccessYaml` 得到 A，再批量读取 B 并把两者拼装。动态统计可单独查询，但返回前检查输入代次，Agent 增删/启停期间应整批有限重试。

缓存首次 miss 使用一次新鲜输入，命中使用经失效验证的展示快照；“一次新鲜”不要求每个热请求重读 YAML。展示构建从纯读取/纯派生函数取输入，不能调用会更新 `identity.configCache`、`sourceMapState` 或 `effectivePolicyRef` 的 loader 来预热。可提取共用纯 parser，但单 Agent fresh 与运行时 loader 行为不改。

必须解析真实 access 路径：Admin 当前通常读 project 内 access，而 Proxy 支持 `LUCY_ACCESS_CONFIG_PATH`。两路径不同且内容不一致时，禁止拼接两份 users/permissions；保留原列表基础字段，权限展示增加既有 permissionWarnings，sources 引用标记 unavailable。不得静默改 Admin 写入目标或环境配置。相同路径/内容时按正常一致上下文执行。

`computeAuthorizedAgentCounts` 与 Agent 列表不得在循环内调用默认 fresh 的单 Agent API。单 Agent编辑/保存预览、dryRun、Proxy 实际授权保持既有 fresh 语义；不得全局修改 fresh 默认值。

目录 summaries 与 manifestSchemas 共享语义解析结果。目录与 source map 若共用已解析 Manifest，须对规范化规则、重复 source 检测、未知字段、坏 YAML 路径验证等价；否则先各一次解析，仍禁止随 Agent 数重复扫描。

编辑/导入/round-trip 路径保留 AST/CST 与 YAML 注释、引号、作者桶、顺序。摘要是否换轻量 parser 必须用等价测试与 profile 证明；不要顺便重写编辑器。

### 3.2 显示缓存与版本

仅缓存展示派生数据。运行时授权与保存校验不读取这个缓存。Agent 的审计次数、最近调用等动态统计不得长期缓存到权限快照。

内部版本向量：`projectRoot + contentRoot + resolvedAccessPath + schemaGen + overlayGen + connectionGen + accessGen + classifierVersion + principalScope`，以及以下写入屏障的 epoch。维持整数单调代次；没有 principal 过滤的数据层可共用，任何按登录账户裁剪的结果必须加身份/权限版本。冷热缓存命中都先经过现有 auth/角色门禁；共享底层数据不能缓存或共享 HTTP 鉴权结论。

| 变更 | 失效读模型 |
|---|---|
| Manifest 保存/上传/删除；Schema 删除；目录重载 | 目录摘要、Manifest 摘要、source map 派生展示、Agent 引用 |
| overlay 保存/导入/恢复 | 语义摘要、更新时间；不重复扫描不相关 Manifest |
| 连接/Schema/启用范围/内容根变更 | project、目录、source map 派生展示；对应 live-schemas 与探测任务配置代次 |
| Agent 启停、角色、权限或约束变更 | 权限展示与 Agent 引用 |
| Token/审计动态变化 | 现有查询失效逻辑；动态统计不能被快照冻结 |
| 外部文件编辑/删除/替换 | 通过 watcher + 对账映射到以上变更 |

所有写入路径包含无审计分支、导入、恢复、批量操作；不只挂 API success callback。磁盘成功写入后立即失效，必须早于成功响应及可能失败的后续审计记录；即使落盘后接口因后续步骤失败，也不能保留旧显示缓存。dryRun/失败且未落盘不得使新内容可见。

**写前也必须建立屏障**：现有 `fs-safe.ts::safeWrite` 直接 writeFile，并非原子写。为每个受影响 scope 维护 pendingWrites + epoch；开始真实落盘前先递增 epoch、标记 pending 并丢弃旧命中，finally 再递增并清除 pending。写中不提供/发布该 scope 的成功快照；不读到截断或部分写文件后当作完整成功。写失败但可能已改磁盘也必须失效，不能只依赖 success hook。未改变文件的 dryRun 不进入屏障。屏障只保护展示读模型，不改变运行时授权/写入序列；没有理由全局改所有文件为原子写。

access 的屏障范围包含持久化→policy commit/ack→必要 rollback→最终 policy 状态。`admin/access-config.ts::writeAccessYaml` **与** `admin/agents.ts` 的本地同名实现都包含直接 writeFile 回滚，必须在回滚前后失效并禁止展示未 ack 的中间版本。连接创建失败后 `project.ts` 恢复 ktx.yaml、多文件保存部分成功同样处理；每个已触碰文件失效，不能把 API 返回失败等同“磁盘未变”。一个上层屏障使用可重入计数，底层通知不提前释放外层屏障。

进行中构建按完整 key 合并。构建前后代次及内容指纹一致才可发布；写入期间旧构建完成不能覆盖新结果。读取受并发变更影响时最多重试 3 次，持续变化则返回现有错误 envelope 的可重试读错误，不无限递归。

缓存完整/空目录结果；构建失败不进入成功缓存，释放 Promise 并短退避 1 秒避免错误风暴，显式重试可绕过退避。每层只保留当前完整版本和有界进行中版本，不堆积历史 AST。启动/关闭必须安装/清理 watcher、timer、任务队列；测试可 reset。

具体上限：每project同时显示构建≤4个，超过用DISPLAY_SNAPSHOT_BUSY；需要按principal缓存的完整槽位≤32，LRU淘汰，旧generation失效立刻去掉引用。同版本请求共享Promise，不为每订阅复制AST。处理器可返回投影/序列化副本，但消费者不得修改缓存Map/Set/Document；Object.freeze不能使Map/Set不可变，测试必须尝试污染再验证后续结果。

外部变更检测：watcher 加 1 秒 metadata 对账；删除、原子替换、同大小文件必须覆盖；每 30 秒完整内容摘要对账兜底，相同 mtime/size 改写最迟 31 秒发现。普通 watcher/metadata 变更目标 2 秒内失效。热请求不得全盘读取 YAML 来查缓存版本。对账异常时停用受影响层缓存并披露读取错误，不能把看不见的变化当作“无变化”。

上述窗口约束**后端检测**，不意味着其他浏览器立刻收到推送。前端展示 TTL 为30秒：同页 mutation 后下一次刷新不得使用写前结果；其他客户端/外部写入在下一次请求时由服务端验证。跨页静止界面的自动变化传播不在本单承诺内；不能宣称显示权限实时生效。外部多文件编辑不具备事务原子性，仅保证读到稳定的文件版本并显式记录窗口。

对账任务不重叠执行，记录lastCompletedAt；full digest逾31秒仍未完成时，受影响缓存不得继续当已验证命中，进入明确busy/error直到恢复。这样超载/文件不可读不会静默突破承诺窗口；本单不保证外部批量编辑的全局事务快照。

内容根变化同时调用/协调现有 `invalidateContentPathsCache`，重新解析路径、迁移 watcher 并清理旧根缓存；不能用旧 cached paths 构建新根 key。对账包括 access override 路径、ktx.yaml 和实际内容根，忽略 upload tmp/history/sidecar 等非当前语义资产，避免事件自激。

### 3.3 API 兼容与失败状态

现有 `ok/data.tables/data.manifestSchemas`、Agent 列表字段保持兼容；保留 `columnNames` 的字段搜索用途，不以删字段达标。

允许 sources 新增 `data.meta`：

```ts
type SourcesDisplayMeta = {
  snapshotVersion: string; // 不包含 secret/绝对路径
  generatedAt: string;
  authorizedCountsState: 'ok' | 'partial' | 'unavailable';
  runtimeConsistency: 'matched' | 'unconfirmed';
};
```

已存在的异常权限计数回退数值可保留兼容，但新 UI 遇 partial/unavailable 时用 `—` 与局部错误/重试表示未知，不能把回退 0 渲染为确定“0 个”。坏目录本体使用原有错误码和 envelope，不制造空成功。默认不返回跨代次 stale 快照，以减少一致性歧义。

计数状态：稳定且可解析 access、所有 enabled Agent 成功解析为 ok（零 enabled Agent 是确定0）；部分 enabled Agent 失败为 partial；access缺失/损坏、路径不一致或全部 enabled Agent解析失败为 unavailable。disabled Agent拒绝不算计数失败。countState是展示完整性，不修改 resolver 的 deny。

`runtimeConsistency` 通过现有只读 policy 状态对比 access/source/启用表/classifier tuple，匹配且非 degraded 才为 matched；只读取不能触发 commit。Agent 列表可添加同结构 meta。unconfirmed 时提示“权限生效状态待确认”，不得将磁盘展示快照当作已生效政策；运行时自身降级/deny 按现有契约处理。HTTP data meta、ETag若使用必须随整个响应所依赖版本更新，不能把动态统计伪装 immutable。

## 4. 页面就绪契约

### 4.1 分区呈现

1. 鉴权通过、路由 chunk 可用后立即呈现 PageHeader、稳定主区与操作区，标题不依赖业务数据。
2. `/connections`：project 完成就展示连接 ID/引擎/基本配置。sources 只影响本地目录统计；reloads/runtime/物理库目录/健康结果各自更新。
3. `/overview`：保持 Spec 142 的系统状态、待处理事项、MCP 接入结构；不同数据区独立就绪，不把四个 useQuery isLoading 作为整页门禁。权限或事实尚未确认的动作保持 disabled。
4. `/catalog`：工具栏与表格区域占位先出现，数据完成才出现真实行与计数；搜索、树选择、enabled 默认范围不变。
5. 无数据加载时保持占位尺寸；已有数据后台刷新保留内容、滚动位置、筛选与选择。错误仅覆盖依赖模块，提供重试；首次失败与成功空数据分开。
6. 请求超过 120 ms 再显示局部加载文字；占位本身立即展示且不动画。缓存命中不闪占位。`aria-busy` 只用于对应区域，不重复播报每张卡。

runtime请求pending/error时，连接卡照常可操作，按Spec163不额外显示问数提示；execution unknown/ok不提示，stale/unavailable/error仍仅列表一条。页面分区实现不能把通用“加载失败/重试”套在该例外上，也不能把四层runtime状态重新放回每张卡。

准备表结构复用Spec164的SchemaStructurePrep/prepareSchemaStructure链路：preview只读不改变D/P，writeMinimalManifest通过原upload确认后立即使D/P失效，reload完成后的sources refetch/getQueryData须使用同一新query epoch与scope。读出表再打开启用范围，不自动启用、不重新打开接入向导。

sources仍pending/error时不能把空fallback推断为“缺Manifest”，进而误开读取/覆盖流程；卡片基本身份可先显示，但依赖Manifest存在性选择的主动作必须等事实就绪。此状态门禁在Spec164回归测试中覆盖。

页面存在不等于所有动作已获授权；不通过预渲染受保护数据绕过 RequireAuth。延后 chunk 不卸载 AppFrame。

### 4.2 查询策略

project/sources 的共享 query options：`staleTime=30_000`、`gcTime=300_000`，mount/focus 按 stale 默认重新获取，移除无条件 `refetchOnMount: 'always'`。Agent复合接口的动态统计保持 staleTime=0 与既有刷新方式，仅服务端权限子结果缓存；不要给整个含审计统计的响应统一套30秒。写后精准 invalidate，包括写入成功但审计后续失败的需要重新核对路径。

不要全局改变 QueryClient 的鉴权、审计或实时监控行为。queryKey 必须兼顾登录账户边界；退出/换账号清除受保护查询并避免旧请求回填。不得持久化 Agent/Token 数据到 localStorage。品牌显示可沿用既有策略，不加入首屏硬门禁。

固定两层客户端防护：authEpoch在登录开始/退出/身份变化时递增，撤销旧请求；写入的affectedQueryEpoch在提交开始和结束时递增。queryFn把React Query signal传给apiGet/apiPost，旧epoch结果即使忽略abort也不得回填。需更新共享 `queryKeys.ts` 和全部消费/失效点，避免新key与旧invalidate错位；公开Help/branding不清除成认证依赖。写请求开始清理受影响快照的可操作状态；最终不论成功或失败都核对磁盘结果并invalidate。401立即清受保护缓存，403按既有权限错误处理；不缓存角色门禁结果。失败重试≤1次且遵守Retry-After，AbortError不自动重试。

只读query可有限重试；所有写mutation保持现有不自动重试语义，禁止因为可能“写成功但回包失败”重复提交。epoch失配/abort不以ApiSuccess或空数据完成；前端action重新读真实状态后才可重新启用。

## 5. 后台探测

初次主内容 commit 后调度 live-schemas 与健康任务；全服务单进程共用自动 KTX 调度器，默认执行并发 2，排队上限 64 个去重 key。限流只作用本单的后台探测，不占用正常数据问答的全局执行许可。

key 为 `project/content/config generation + connectionId + taskKind`；test 与 live-schemas 不互相冒充结果。相同配置的进行中任务可以共享；健康已完成结果仍在本页生命周期内使用，每次重新进入重新探测。live-schemas 保留 10 分钟成功缓存。

可见卡片先排队，其余按顺序；手动探测优先级高，保留公平性（连续最多 3 个手动任务后取一个等待自动任务），不可抢占已运行子进程。队列满返回明确可重试模块状态，不创建无限子进程。

页面离开取消未启动的客户端请求意图；运行中任务存在其他订阅者时保留共享执行。配置变化后取消未启动旧任务、已启动结果不进入新配置缓存/页面。30 秒子进程 timeout 保留；排队等待独立计量，HTTP 生命周期覆盖排队失败，不悬空。

排队截止为60秒，超时沿用503 PROBE_QUEUE_FULL并提供重试。旧配置订阅必须结算为可重试失效结果/取消，不能只丢结果不settle Promise。共享任务每订阅独立AbortSignal与auth scope；原生Fastify请求完成事件不等于客户端断开，使用response premature close/aborted可靠判断。许可只在实际子进程关闭/退出后释放，避免timeout请求已返回但子进程仍占资源时超并发。

当前 latencyMs 为整个 KTX 命令执行时间，保留其语义；新增日志 queueMs/executionMs/totalMs，不能将 queueMs 写进数据库响应延时并误导健康阈值。调度可能增加最后一张卡完成时间，验收关注主页面不受阻、任务公平和慢卡隔离。

优先级的兼容协议：test body 可选 `purpose: 'automatic' | 'manual'`；live-schemas query 可选同名字段，默认 manual。连接页自动请求明确传 automatic，手动重试传 manual；值校验不放宽既有鉴权/Owner 门禁。HTTP 请求可通过客户端 AbortSignal 取消；取消某个订阅不能使其他共享订阅失败。

持续构建竞态返回 `503 DISPLAY_SNAPSHOT_BUSY`（“页面数据暂时无法完成刷新，请稍后重试。”）；队列满返回 `503 PROBE_QUEUE_FULL`（“连通探测请求较多，请稍后重试。”），沿用现有 error envelope，带 `Retry-After: 1`。这两个工程错误码不是新增产品概念；UI只在对应模块展示，不能触发自动请求风暴。

## 6. 构建与静态资源

- `npm run build` 必须在 Vite 产物后预生成 `.gz` 与可选 `.br`，开发服务器不作为性能交付环境。Docker 已执行该 build，应自然包含压缩产物；不要求新增 Ingress 配置。
- 只对存在且带构建哈希的 JS/CSS 设置 `public, max-age=31536000, immutable`；HTML 为 `no-cache`，带验证器。
- Accept-Encoding 按 q 值协商，尊重 `gzip;q=0`，无支持时 identity；所有变体带 `Vary: Accept-Encoding`，Content-Type 指向原始文件。GET/HEAD、ETag/304、Content-Length 与编码字节一致。
- assets 缺失/路径越界/编码异常返回正确 4xx，不能 SPA HTML 回退后 immutable；正常 SPA 深链仍返回 index.html。API 和品牌上传资源不使用该策略。
- App 保留鉴权、壳层、轻导航；业务页与大型编辑抽屉 lazy。首屏必需 chunk 与 query 可并行，按 hover/focus 意图预取，不一次预取所有页面。
- Suspense 局限内容区；共享 CommandPalette/ObjectDetailDrawer 等不得把全部重依赖重新拖回主包。
- chunk load 失败时保留壳层；本标签会话最多自动刷新一次，第二次展示重试，不无限刷新。缓存 HTML 不跨版本长期固化。验证旧页导航遇到旧 hash 404 的恢复，不承诺单 Pod 回滚/重启期间无中断。

## 7. 核心流程（伪代码）

```text
adminBatch(ids):
  for attempt in 1..3:
    if affectedScopeHasPendingWrite(): return busy503()
    before = captureGenerationAndFreshInputsWithoutRuntimeSideEffects()
    context = buildReadonlyContext(before.access, before.manifests,
                                   before.policy, before.enabledTables)
    results = ids.map(id => existingResolver(id, context))
    if inputsStable(before) and noPendingWrite(): return results
  throw retryableReadErrorUsingExistingEnvelope()
  # 原有 compileError/deny 不改为成功；不是实际 runtime 授权缓存

getSnapshot(keyScope):
  requireExistingAuthForThisRequest() # 即使 cache hit / inFlight attach
  if affectedScopeHasPendingWrite(): return busy503()
  key = currentVersion(keyScope)
  if validCache(key): return cache[key]
  if inFlight(key): return await inFlight[key]
  ownerPromise = buildExactKeyOnce(key) # 不嵌套3次重试，不发布不同key的结果
  inFlight[key] = ownerPromise
  try:
    result = await ownerPromise
    if noPendingWrite() and key == currentVersion(keyScope) and fingerprintStillMatches(result):
      publishImmutable(result)
      return result
    throw changedDuringBuild()
  catch error:
    recordFailureAndBoundedBackoff(key)
    throw error # 不以零/空目录冒充成功
  finally:
    if inFlight[key] == ownerPromise: delete inFlight[key]

writeAsset():
  existingValidateAndAuthorize()
  beginDisplayWriteBarrier() # 写前 epoch++ / pending++ / discard old cache
  try:
    persistUsingExistingWriteMechanism() # 当前部分路径不是atomic
    bumpAffectedGenerationAndDropDerivedCache() # 落盘后审计终结前
    existingAuditAndPolicyCommitSequence()
      # 如需rollback，before/after rollback均通知；不改变原有policy顺序
    return existingResponse()
  finally:
    invalidateTouchedScopesEvenOnPartialFailure()
    endDisplayWriteBarrier() # epoch++ / pending--，之后方可读新快照

enqueueProbe(request):
  authenticateAndCheckConnection()
  key = (scope, configGeneration, connection, kind)
  if matchingInFlight(key): attachSubscriber()
  else if queueFull: return retryableModuleError()
  else enqueueBounded(key, priority, cancellation)
  onPermit: runExistingKtxCommandWithTimeout()
  onCompletion:
    if generationStillMatches(key): deliverAndCacheAccordingToTaskKind()
    else discardFromNewGeneration()
    releasePermitInFinally()

enterRoute():
  keepAuthenticationGate()
  renderPageIdentityAndStableRegions()
  requestIndependentModules()
  renderEachModuleWhenReadyWithoutRemountingOthers()
  afterPrimaryCommit: requestBackgroundProbes()
  onError: showOnlyAffectedRegionErrorAndRetry()
  onRefetch: retainCurrentDataAndScroll()
```

请求最外层负责changedDuringBuild/busy的**总共最多3次尝试**（包含首次），不能在adminBatch、snapshot和handler各叠3次。cache hit/inFlight返回后，handler在序列化并发送前再次核对版本/写屏障；后端旧结果已开始传输时无法撤回，客户端auth/query epoch仍拒绝写前请求回填。该合同不宣称网络中的既发字节可被取消。

## 8. 性能预算与测量合同

默认性能 fixture：7 个配置连接、8 份 Manifest、60 表、1,786 字段、45 已启用表、13 Agent（12 enabled），包含角色/约束、overlay；Manifest 字节数写入 fixture manifest。全部生成假数据，KTX 用确定 stub；另有慢/失败探测情景。不得复制内网 YAML、secret、生产审计数据库。冷构建按T1纯输入重读所有当前语义/配置材料；不能复用启动policy里的预解析sourceMap来伪装cold display。

固定seed=161，字段/描述/overlay内容与审计统计都须非空（每enabled Agent生成200条匿名审计事件并覆盖成功/拒绝/协议调用），列出角色集合/constraints/catalog_bound覆盖。事件按manifest记录的UTC anchor生成并置于7天窗口中段，baseline/after复用同anchor/fixture快照；统计查询使用正常服务时钟。不得冻结全局Date.now（它也用于KTX执行延时），性能使用真实单调时钟。仅KTX外部执行被stub，Fastify、YAML/权限解析、SQLite统计与页面渲染使用真实代码；不得mock sources/agents API或缓存命中来获取性能成绩。慢失败功能测试可route mock，必须与PERF数据组分开。

正式测试使用**生产 Vite build + Lucy static server**，禁止用 Vite dev 时间达标。桌面 Chromium 1440×900，无节流；同机器 baseline/after，固定服务器 CPU/内存与浏览器版本，另在目标环境做低频只读核对。HTTP 回环成绩与目标内网成绩分别报告。

| 验收 ID | P95 上限或硬限制 | 起止 / 条件 |
|---|---:|---|
| PERF-01 | 50 ms | 点击到可见反馈后的绘制帧 |
| PERF-02 | 100 ms | 同会话有完整缓存，点击到真实主内容绘制 |
| PERF-03 | 500 ms | shell 已加载、目标路由无 query 缓存，点击到主内容真实数据可操作；读快照 warm |
| PERF-04 | 500 ms | 硬刷新 navigationStart 到 shell/页级导航可操作 |
| PERF-05 | 800 ms | 浏览器冷资源、服务 warm，navigationStart 到真实主要内容可操作 |
| PERF-06 | 100 / 200 ms | sources 热 HTTP / Agent 列表热 HTTP，到完整响应 |
| PERF-07 | 500 ms | cold 目录读模型构建，不允许预热后标记 cold |
| PERF-08 | 200 / 50 KiB gzip | 初始 JS / CSS 必需资源总和；含共享/路由 chunk |
| PERF-09 | CLS ≤0.05 | 页面占位到真实内容及后台更新全过程 |
| PERF-10 | 无 ≥50 ms 业务长任务 | 初次渲染、导航、筛选 trace；浏览器/扩展噪声分类单列 |

前端模块标记同时要满足 DOM、数据与动作 enabled；记录模块 commit 后第二个 requestAnimationFrame 作为可见绘制近似，并用 trace 复核。禁止仅检测 skeleton/PageHeader、DOMContentLoaded、load、networkidle 来代表 PERF-05。对不存在相关主操作的页面使用明确控件可交互断言。正式计时标记不得包含对象名/SQL/用户信息，不新增外部遥测。

每路由 primary-ready 条件固定：connections 的真实连接卡、本地 Manifest/启用范围统计与授权允许的页级动作；catalog 的真实范围树/表行/计数及可用搜索；overview 的系统状态、真实待处理事项与 MCP 接入（按 Spec142），数据来自本轮或版本有效缓存；Agent 列表的真实列表/统计与可用筛选。fixture均非空，不能用空白布局过门禁。局部模块仍可更早就绪；primary-ready 不包含实时连通健康和物理库目录探测完成。

每场景 5 次 warm-up（不计结果）后至少 30 样本，nearest-rank P95=`sorted[ceil(0.95*n)-1]`，报告 P50/P95/max、失败数及原始值。cold 场景每样本清除对应缓存/重启，不能沿用 warm-up 的缓存。不可过滤慢样本、默认重试覆盖失败或事后更换测试条件；失败样本必须记录并使场景失败。

### 8.1 必须实现的情景与重置

| scenario | 清理 / 准備 | 测量与门禁 |
|---|---|---|
| browser-cold | 每样本新BrowserContext，无HTTP/query/模块缓存；服务显示快照warm | 四目标路由各≥30样本；PERF04/05/08/09/10 |
| browser-warm-refresh | 同context已加载该页，再常规reload；query内存重新创建，HTTP保持 | 四目标路由各≥30样本；PERF04/05，资源实际命中另记 |
| route-warm | 同session四页都访问过且query有效；固定配对往返 | 每路由≥30样本；PERF01/02/09/10 |
| route-query-cold | shell已载，删除目标query，服务快照warm；不要清全部HTTP缓存 | 每路由≥30；PERF03；lazy模块是否warm单列，不能隐藏下载 |
| api-warm | sources与完整Agent响应各预热，真实统计查询仍运行 | 每接口≥30；PERF06，client request-start→body完整读完 |
| display-cold | fixture子进程IPC清空所有展示缓存/读取派生cache/进行中任务，保留已建立的runtime policy，禁止自动预热 | 每次确认buildCount从0开始且hit=false；≥30，PERF07构建total与HTTPtotal分别记 |
| service-cold | 每样本停止本runner服务并新进程启动，所有单例清空 | ≥30；进程→socket/policy/displayReady分列，仅对应构建应用PERF07 |
| login-required | fixture开启正常鉴权；新context，正常scrypt账户，服务warm | ≥30；密码提交记录，login成功响应→primaryReady按PERF05 |
| probe-load | 7连接全发自动test/live请求，成功各50ms；单独慢卡3秒情景 | 每路由≥30；真实sources/agents/页面PERF预算仍适用，慢卡completion单列 |
| mutation-race | 真实fixture写入、回滚、外部编辑、登录切换、chunk404 | SC功能测试，记录count/状态，**不混入正常PERF的P95** |

PERF04只需shell适用页面；Agent列表也纳入PERF05/08/09/10。每行/每路由独立统计，不能汇总四页掩盖慢页。浏览器计时起点为page内实际pointer/keyboard事件，不能用自动化命令发送时间；navigation/response/rAF统一performance.timeOrigin相对时钟。trace用于验证两次rAF与可见绘制，不混用Node墙钟与页面时钟。

baseline/after使用**相同DOM就绪谓词和同样scenario runner**；baseline没有新增ready mark时由runner观察真实DOM+数据+动作，不阻塞等待尚不存在的标记。after的ready mark只作交叉证据，未满足相同DOM谓词不算ready。baseline记录可以不达预算，采集失败仍非零；after必须全部达标。

display-cold的reset是fixture子进程IPC/进程内测试hook，不能新增production HTTP reset端点；请求携带真实非空数据，reset/ready判断不计构建时长。runner使用独立fixture-server启动入口，在显示预热禁用情景不调用预热；测量正常startup情景保持真实预热顺序。baseline无显示缓存时同样记录解析次数和miss。HAR/trace中没有授权cookie样本须仍检查脱敏。

服务冷启动另测进程启动→display snapshot ready，总启动时间与 cold 构建分列；800 ms 预算不声称覆盖进程启动。预热失败只降级显示读模型，不能改变既有 policy readiness/liveness 语义。登录 fixture 拆分密码提交与登录成功→真实页面就绪，后者按 PERF-05；密码提交记录而不设置未经测量的 scrypt 预算。

## 9. 功能与一致性验收

| ID | 必须证明 |
|---|---|
| SC-01 | Agent 批量上下文与既有 resolver 的成功/deny/约束结果一致，每批只构建一次 source map |
| SC-02 | 目录字段、排序、empty Manifest、启用范围、mtime、columnNames 与原行为一致；坏数据状态不伪装成功 |
| SC-03 | 同版本并发冷请求合并；空目录缓存；构建失败释放任务后可重试 |
| SC-04 | 构建中落盘变更不能发布旧代次；落盘后审计失败也即时失效；dryRun 不发布新数据 |
| SC-05 | 全部 mutation 与外部文件变化按 §3.2 失效；同 mtime/size 变化在兜底窗口发现 |
| SC-06 | project 快/sources 慢仍显示连接卡；overview 局部就绪；背景 refetch 保留滚动/筛选 |
| SC-07 | modules 的错误、未知值、空成功分离；partial/unavailable 引用计数不显示为确定 0 |
| SC-08 | 登出/换账号无旧数据或旧请求回填；RequireAuth 与现有权限门禁不放宽 |
| SC-09 | 自动探测总并发≤2、队列有界、任务合并/公平/超时/取消释放许可，旧配置结果不能回填 |
| SC-10 | 每次进页仍探测；Drawer 同源；慢探测不阻塞其他区域，latencyMs 不混排队时间 |
| SC-11 | encoding/q=0/identity/HEAD/304/Vary/MIME 正确；missing asset 与越界不回退缓存 HTML |
| SC-12 | lazy 深链可用、登录/公开 Help 正常；chunk 404 一次恢复且无刷新循环 |
| SC-13 | watcher/timer/队列 reset/close 释放资源；不同 project/content root 无缓存串用 |
| SC-14 | 所有性能原始样本、环境、前后版本、资源列表、功能命令退出码及 trace 可复核 |
| SC-15 | 写前/写中/部分失败及两套access与ktx回滚屏障；旧结果不能在response或client回填 |
| SC-16 | users/version/权限/enabled_tables同批一致；catalog_bound与override路径差异覆盖；runtime缓存未被展示预热污染 |
| SC-17 | 来源权限matched/unconfirmed与计数partial/unavailable正确；不自动policy commit或把预览宣称生效 |
| SC-18 | 所有新query key的消费/invalidate一致，写前请求/登出/401旧响应拒绝，Agent动态统计未冻结 |
| SC-19 | baseline同DOM谓词，cold reset真实且不预热，HTTP/DOM时钟统一；每情景/路由独立≥30 |
| SC-20 | 队列截止/旧配置/取消全部Promise结算，子进程结束前不释放许可；onClose清空无悬空 |
| SC-21 | 保留Spec163/164卡片收纳、runtime提示及表结构下一步；缺Manifest→确认写入→目录可见，不引入canary/旧页脚 |
| SC-22 | Spec168 roles数组读写/兼容/双声明错误/顺序/门禁不回归；非数据字段更新不隐式迁移角色 |
| SC-23 | lucy_admin新增连接自动跟随、其他catalog_bound wildcard拒绝；Spec170上下文工具开放与发布约束不被缓存优化改回旧模型 |
| SC-24 | 原始列类型校验与publish gate保持；Spec172/173问询/协议统计不混成旧schema，动态审计不可因permission缓存冻结 |

## 10. 交付、回退与风险

交付 Spec、工单、实现代码、必要测试、生产构建验证脚本、可生成的匿名 fixture、正式执行报告。临时 trace/截图/样本落 inbox，报告保留证据摘要与复现命令，不提交 HAR 的 Cookie/Authorization 或私有正文。

阶段依次交付：基线与观测→批量解析→分区呈现→显示缓存→静态资产/拆包→后台调度→总验收。指标失败需继续定位与修复，不能把 skeleton 作为达标或在执行报告自行放宽预算。环境无法满足预算应记录未达标及证据，不谎报通过。

代码回退按阶段提交逆序 revert；部署回退使用已知旧镜像/资源，无数据 schema 迁移。缓存随进程重启清空。若做客户镜像交付，另遵守 amd64 G1–G4/ELF 与现有客户交付清单；本单不主动发布/覆盖 `10.69.95.109:8276`。

主要风险：遗漏 mutation、构建竞态、旧 chunk、限并发导致尾卡更晚。分别由 SC-04/05、SC-03/04、SC-12、SC-09/10 和原始性能样本门禁约束。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None（meta 字段、计时标记与代次仅为内部工程概念）。界面沿用连接概览、语义资产、系统概览、Agent、连通健康、探测中、响应延时、Schema Manifest；专业英文、路径/对象 DOM 继续 `translate="no"` + `notranslate`。

## Design System Compliance

遵循 `design-system/00-principles.md`、`20-patterns-page-layout.md`、`12-components-metric-card.md`、`11-components-data-grid.md`。复用 PageHeader/MetricCard/Data Grid 与 existing tokens，保持 Spec 142 信息架构；加载不改变布局层级。静态占位、120 ms 延迟局部指示作为本单限定模式，在 `99-governance.md` 登记后实现，不引入动效或移动重排。
