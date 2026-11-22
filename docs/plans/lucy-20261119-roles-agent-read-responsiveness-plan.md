# 角色权限与 Agent 列表读取响应 Implementation Plan

> 实施者按仓库 AGENTS.md → DEVELOPMENT 逐任务执行；可选用 executing-plans 技能。开发及分批提交已获委托人2026-11-20明确授权，当前执行边界见下节。

**Goal:** 让高频、多会话访问下的角色权限和 Agent 名册及时可用，保持授权与统计含义。

**Architecture:** 先拆分历史聚合，再复用已核实的展示快照；Agent 名册与统计分区，统计只允许明确披露的短期展示复用。继续使用单实例发布屏障与既有 ACL 编译器。

**Tech Stack:** TypeScript、Fastify、better-sqlite3、React Query、Docker；不改 KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v1.1 |
| 日期 / 产品线 | 2026-11-19 / 0.30.0 |
| 功能编号 | P1-58／REQ-030-079 |
| 状态 | S4｜v1.1。委托人2026-11-20批准分批交付并提交本进程；本轮实现与证据归档收口；首批主路径结果见测试台；完整F58／F59、2×／5×长测及剩余故障矩阵延期第二批，未计PASS；R未执行；不入核心分母；≠ 完整功能合同收口；≠ 可上线。 |
| 授权边界 | 委托人2026-11-20已授权实现与隔离验证，现批准暂停长测、分批归档并commit本进程；当前只完成首批必要验证，第二批不自动执行；不发布上线、不改KTX；索引仅P1-58 D7两条，不新增表／列。 |
| 验收 | [Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) SC-01–12；组合判定仅见 [UAT INDEX](../qa/uat/INDEX.md) |
| 需求与测试 | [总账](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[共享 suite](../qa/uat/suites/roles-agent-concurrency-scale/suite.md) |

## 2026-11-20 分批交付决议（本轮执行边界）

委托人批准“暂停长测，收敛当前优化，分批继续”，并明确“收口，commit本进程”。本次收口对象是**本轮实现与证据归档**；完整功能合同仍保留SC-01–12，没有因测试耗时删除验收、不将未执行项计PASS。

- 首批：冻结本进程已实现的统计减负／有界worker／两条已授权索引、对象级提交与草稿／回执恢复；短回归、类型检查、真实前台查看／新建／编辑／删除及冲突恢复。范围、候选指纹和实际结果以[正式跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)为准。
- 第二批（本轮延期，不自动执行）：完整F58／F59、B／2×／5×三轮、固定窗口历史增长、双身份每类百对授权写、全部DEP与剩余局部故障矩阵、精确改前对照及索引完整成本。仍沿用原预算与判定器。
- 首批不包含其他进程的P1-66摘要投影或核心可用性改动。现网502／503具体原因未取得运维证据，不能因本轮优化宣称已定位或消除。
- 发布取证R、发布、上线均未执行；本次提交不构成面向用户更新的放行签字。后续用户试用前仍须按其候选核对必要验收和交付授权。

## 目标

第一批依次完成统计查询减负、角色展示复用、错误与耗时分类；第二批实现名册／统计分区及短期展示新鲜度补偿。每个任务保持原有 API 与度量口径可对照，不以展示缓存绕过权限校验。

## 开工前置

1. 终稿由委托人明示确权（本次修订即终稿、免Codex CLI终审）；交互Q1–Q6已完成设计评审，不是浏览器已测。委托人已授权实现及必要验证；本次按分批决议停止长测。
2. 冻结改前commit／候选镜像摘要、fixture seed、资源限制、计数金样本及负载向量。预算已定为可证伪目标，开发前补测有效改前响应；改后同时过绝对与相对闸，无有效基线的错误组不得计算虚构改善。已有0.30构建不能仅靠版本名视为相同候选。
3. 共用 UAT fixtures 是负载值唯一真源：校准后按 `max(设计下限, 实测当前基线)` 放大 2×、5×，不改结果阈值追样本。
4. 现有 P1-13／Spec 174／195 及 P1-47 已落地部分先核实，不重复开发；本条不重开其合同状态。
5. 新索引、worker 或统计表若被证明必要，先补决策与授权；不由实施者顺带扩展 schema。

## 实施任务（已授权；按分批决议登记实际完成与延期）

### Task 1：冻结统计等价金样本与改前成本

- Test：`webui/server/__tests__/admin-agents.test.ts`；拟新增 `webui/server/__tests__/agent-statistics-worker.test.ts`。
- Step 1：用固定 seed 生成真 SQLite，独立计算窗口、分类、凭据碰撞、最新时间预期；不调用被测聚合函数生成预期。
- Step 2：对现有路由取改前响应、查询计划、stats 耗时和峰值阻塞，记录失败基线；不改时间戳以凑窗口。
- Step 3：新增“窗口内固定、窗口外历史增至 5×”用例，证明现有读取成本；性能与计数分别断言。
- 授权后验证命令：`cd webui && npx vitest run server/__tests__/admin-agents.test.ts server/__tests__/agent-statistics-worker.test.ts`。真库统计测试实际落在 `agent-statistics-worker.test.ts`；首批已执行的命令与结果见正式跑次。
- 出口：SC-01／02 的改前证据与可重复金样本。

### Task 2：窗口聚合与最近使用分离

- Modify：`webui/server/admin/agents.ts`，只触及 `getStatsMap`、`getLastUsedMap` 和响应组合。
- Step 1：将计数时间窗移入 WHERE；全部历史最近使用另查；共用事务快照、asOf 与 ceilingId。
- Step 2：评估已有索引下按配置凭据定位最新行，记录冷／热 EXPLAIN 与实耗，不先加索引。
- Step 3：运行 Task 1 真库等价测试及边界用例；失败即停，不通过更改指标意义解决。
- 出口：SC-01／02／10；再做性能差值，不将错误响应时间计为查询耗时。

### Task 3：角色展示快照与在途构建合并

- Modify：`webui/server/admin/roles.ts`、`webui/server/display-snapshot.ts`（仅必要适配）、`webui/server/admin/permission-display.ts`、`webui/server/entry-performance-timing.ts`。
- Test：`webui/server/__tests__/admin-roles.test.ts`、`admin-permission-batch.test.ts`、`display-invalidation.test.ts`、`display-rollback-races.test.ts`。
- Step 1：写 25 并发同键／不同键、失败重试、外部文件变动、回滚和权限收紧的负例。
- Step 2：优先接入现有快照／reconciler，不建立第二套失效机制；构建结果跨代次即丢弃。
- Step 3：确认所有 HTTP 请求仍鉴权，dryRun／保存／运行时不读展示缓存，释放失败和取消在途状态。
- 授权后命令：`cd webui && npx vitest run server/__tests__/admin-roles.test.ts server/__tests__/admin-permission-batch.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-rollback-races.test.ts`。
- 出口：SC-03–05／10。

### Task 4：名册与统计分区、5 秒新鲜度补偿

- Modify：`webui/server/admin/agents.ts`、`webui/src/lib/displayQueryOptions.ts`、`webui/src/lib/types.ts`、`webui/src/pages/admin/AgentList.tsx`、`webui/src/pages/admin/RoleList.tsx`、`webui/docs/03-api-spec.md`。
- Test：`webui/src/__tests__/agent-list.test.tsx`、`admin-roles.test.tsx`、`display-query-isolation.test.tsx`，服务端 `admin-agents.test.ts`。
- Step 1：先测试默认完整 API 兼容、新统计路由匹配、混合配置版本拒拼接。
- Step 2：实现 roster 与 statistics 分区，统计失败不阻断名册；时间窗以响应原始 asOf 为准。
- Step 3：限定短期统计结果复用与用户可见统计时间，手动刷新绕过已完成缓存；新增写入立即失效，禁止用 TTL 保护权限。
- Step 4：覆盖筛选依赖、取消与快速切页、部分失败、刷新恢复；不新增后台频繁轮询。
- 出口：SC-06–08／12；治理方 ↓ 的补偿必须可实测。

### Task 5：统一错误分类与有界读重试

- Modify：`webui/src/lib/apiClient.ts`、`webui/src/lib/displayQueryOptions.ts`、对应两页失败呈现；复用已有 Server-Timing。
- Test：`webui/src/__tests__/api-client-abort.test.ts`；拟新增 `api-client-http-errors.test.ts`。
- Step 1：测试 HTML 502／503、JSON BUSY、401／403／409、取消与写请求不重放。
- Step 2：先判状态与内容类型；保留接口结构化错误，HTML 不透原文；只读重试最多一次且总预算 5 秒。
- Step 3：验证单次用户读取不会因多层重试相乘；共享调用方回归，不只验两个列表。
- 出口：SC-09／10；与 P1-59 未知写结果状态对齐。

W1完成Task 1–3／5只记阶段结果，W2的Task 4与其SC仍是完整合同要求。未完成W2不能宣布P1-58收口；如需独立交付，先具名修订范围和登记后续项。

### Task 6：模块验收与组合 UAT

- Module：真库等价、计时与固定配置的接口负载，对应 SC-01–12；代码审阅不代替 UAT。
- Shared runner 已落盘：`scripts/uat/roles-agent-concurrency-scale.mts`；由 P1-58 与 P1-59 共用，不能各写一套分母与判定器；本轮暂停完整长测，保留脚本供第二批复用。
- 实现该 runner 时先在 `docs/governance/test-layers-and-release-gates.md` 的 Current Commands／CI Mapping 登记实际可执行入口；未实现前不把拟议命令写成现有能力。
- 先在独立Docker fixture执行suite分层矩阵的F58，证明本模块SC；共享R保留完整2×／5×单维与组合、慢盘、MCP和长稳态，作为组合发布取证另记。F58通过不替代R，R未跑不倒挂全部SC未完成。
- 算法减负后仍越线：提交热点与读量剖析，评审只读 worker；不得擅自修改探针预算或增加副本。

## 浏览器验证

- 路由：/admin/roles、/admin/agents
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16、E17、E18
- 证据：[2026-11-20首批跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)；只认该记录实际覆盖，未覆盖E项延期，不主张全矩阵通过。

## 验收与本轮完成定义

本轮按委托人分批决议归档实现、必要回归和真实前台主路径证据，并commit本进程；正式判定见[首批跑次](../qa/uat/suites/roles-agent-concurrency-scale/runs/2026-11-20-codex-racs-batch1.md)。首批归档不等于原完整SC-01–12合同收口；未跑、失败与缺口逐项保留，不抬预算，不把旧候选证据移算为新候选PASS。第二批待委托人明确继续后执行。

## 风险

| 风险 | 应对 |
|---|---|
| 拆查询改变全历史最近时间／分类 | 固定金样本与独立 oracle，最新记录另查 |
| 短期统计展示滞后 | 5 秒上界、统计时间、立即刷新与失败补偿；未验通不收口 |
| 快照键遗漏或后台核对超时 | 复用现有依赖代次与失败关闭；权限不设陈旧宽限 |
| 负载基线未知 | 显式设计下限；客户倍率主张须补当前实测，缺失维度不能写已覆盖 |
| worker 掩盖低效 SQL | 先算法和查询计划，再按剩余热点独立决策 |

## 落盘清单核对（本次两份 Spec／Plan 共用）

依据 DEVELOPMENT「新增 Spec / Plan 的落盘清单」逐项自查；只证明文档形态与登记，不证明功能已实现。

| 项 | 本次结果 |
|---|---|
| 1 文件名与落位 | 已核对：两组同日期、同 slug 的 Spec／Plan，分别位于 docs/specs 与 docs/plans |
| 2 核心流程 | 两份 Spec 均有成功、冲突、失败与恢复的伪代码 |
| 3 元数据 | 类型／版本／状态、Plan 授权边界／验收齐全 |
| 4 Plan 五类小节 | 两份均有目标、开工前置、验收、完成定义、风险 |
| 5 术语 | 两份均有固定格式；并发文案在 Spec 内登记，未修改全局标准 |
| 6 设计系统 | 两份均按四段式引用真实章节，不新增视觉模式 |
| 7 索引 | docs README、plans README 与概览 §9 已登记 |
| 8 命令／CI | 首批命令已落盘并登记 Current Commands；无新增 CI；完整长测脚本未执行通过 |
| 9 身份 | 文件名为 Spec 唯一身份，台账号无，P1-58／59 为总账行而非第二套文件编号 |
| 10 门禁与形态 | 2026-11-19 lint:spec-docs、lint:spec、lint:terminology、lint:ia-boundary、e2e-ledger 检查均 exit 0；另对新文件直接调用形态／交互检查，返回零违规 |
| 11 闭口层级 | 两份均为功能合同；组合探针／MCP／系统故障演练留共享 UAT／发布取证 |
| 12 现值 | 状态镜像同句；没有将设计、未执行或旧 PASS 写为本条已交付 |
| 13 交互合同 | 两份合同／元素／六问与配对浏览器四行均齐；六问为本次设计评审通过，浏览器未执行，不回写历史证据 |
| 14 入账 | 先入总账 P1-58／59，再起草；需求池 REQ-030-079／080 双向回链 |
| 15 三台勾连 | suite／cases／fixtures／runs 目录、INDEX NOT RUN、e2e 指针与 GAP 均已登记；现有硬编码 checker 未枚举新行，另行核对新文件和回链存在性 |
| 16 主路径 | 同时设计拒绝生效与恢复后合法成交；含不带 WebUI Cookie 的纯 MCP 共存 |
| 17 用户画像 | 两份四画像完整；治理方按最差子面 ↓，补偿路径挂 SC 与 UAT 编号 |

门禁现有非阻塞提示：总账 metadata 有一条 STALE 基线项；lint:spec 有既有 eval paired_quiz 与 demo_readonly 权限版本警告。本次未修改这些无关项或豁免基线。新文件相对链接已逐项核对存在，未以未跟踪文件只告警的机制掩盖违规。

## 定稿变更与验收层级

本次在委托人明示免Codex CLI终审的授权下定稿；[评审处理记录](../reviews/2026-11-19-roles-agent-design-finalization.md)记载采纳、部分采纳与事实纠正。保留2×／5×硬负载，预算按有效改前基线＋绝对上限＋相对不回退；模块F58和共享R分开判定，现场倍率17缺口单列。当前没有运行行为证据，不写功能合同收口或UAT PASS。

## 2026-11-20 补齐执行计划

1. 补齐服务端实际编译输入闭包、窗内身份／恢复／门禁重检、操作回执与创建删除恢复边界；补统计失败与慢查询逃生回归。
2. 执行聚焦回归与类型检查，保留原始输出；独立Docker候选冻结源码清单、构建标识与镜像摘要，不覆盖共享demo。
3. 按suite F58／F59映射执行B／2×／5×、独立oracle、并发与局部真实失败，不以smoke替代。
4. 真实前台浏览器1920×1080逐E编号验收，页面计时与API分列；全部SC通过后同步现值、INDEX与e2e，R仍单列。

当前执行记录与证据：`inbox/p1-58-59-finalization-20261120/`；正式跑次在共享suite的runs落盘。

## 2026-11-20 D6 条件触发：有界只读统计 worker

本次委托人授权补齐实现并完成验收。固定2 CPU／4 GiB、独立Docker命名卷的真实窗口剖析：合并分类与热门表后B档7d约198–271ms、30d约432–591ms，仍超200ms热态目标；原主线程探针出现普通窗口503。证据见`inbox/p1-58-59-finalization-20261120/profile-rc2.jsonl`及read-probe，不抬预算、不以诊断探针冒充完整F58。

方案选择：保留现有SQL与索引，使用最多2个只读worker、最多8个排队键。每个worker以readonly方式打开既有审计库；共享原分类／统计实现，不新增表、索引或KTX改动。展示统计按项目、已核实配置／权限代次、可见Agent集合、range合并，身份鉴权与响应裁剪每次重新执行；写入、dryRun、运行时授权和治理门禁不读统计展示缓存。

请求触发有界预取7d／14d／30d；缓存年龄按原始asOf计算，最多5秒；接近过期时请求触发后台刷新，禁止周期性HTTP轮询。手动刷新不读已完成缓存；超过5秒的正确查询返回原始观察时间但不缓存。代次改变后旧任务不得回填新键，队列有界，关闭进程时结束worker。完整默认Agent API复用同一只读统计观察水位，保持字段／口径并公开原始统计时间。

必须补证：真实SQLite等价；只读文件打开；慢查询5–10秒仍能完成且不缓存；失败／取消／代次切换与关闭清理；固定资源B／2×／5×三轮预算；前台页面与API计时分列。R仍是独立发布取证，本次不执行。


Worker增量求值边界：仅当同一只读连接、文件身份未变、真实读事务内`data_version`与MAX(id)均未变，且旧／新窗口首尾差集经时间索引查询确认没有任何行时，精确计算零增量的新观察；每次重新计算凭据可用性及窗口。UPDATE／DELETE、补写旧时间行、窗口边界经过记录、文件替换或强制刷新均走完整SQL；事务内取得的版本与结果成套保存，禁止事务后读版本给旧结果背书。这不是给旧展示缓存重置TTL；旧展示缓存仍原asOf且最多5秒。必须有边界正反例与真库测试，不能只测静态小库。

## 2026-11-20 D7 实施与验收

委托人明确授权两条覆盖索引，方案和成本见对应Spec D7；先前仅无新增schema的实施口径由本次明确授权更新。只有既有access_log上的`idx_al_agent_window_cover`与`idx_al_ts_token`，不扩展持久统计表。

实施入口：`webui/server/admin/audit.ts`既有监听前初始化；`CREATE INDEX IF NOT EXISTS`重入，真实旧库／新库均验证。共享只读SQL继续用原分类与半开窗口；只读worker使用每连接16MiB页缓存和内存临时集，受单容器4GiB上限约束，预取最多占一个worker，为显式请求保留容量。否决的大临时集合并、重复流式分类和逐凭据IP seek不作为交付方案。

验收：冻结含D7的候选；记录索引dbstat体积、首次初始化时长、幂等重开、原数据保持及增量写入成本；F58原始计数／窗口／最新字段与查询计划、B／2×／5×全部预算重新执行。F59、前台浏览器使用同一候选，全部合同出口通过才收口；此前诊断跑次不能转记PASS。
