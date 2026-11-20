# 核心可用性三问题整改与同候选验证 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 跨合同实施与验收 Plan / v0.1-draft |
| 日期 | 2026-11-20 |
| 状态 | 委托人2026-11-20明确安排下次开发；本轮只合入既有修复并复验，不执行本计划Task0–4，不启动热点／热重载新整改或约1h长跑；原FAIL与GAP保留 |
| 授权边界 | 本次只将已完成修复合入lucy-v0.30并跑现有修复回归；本计划放下次开发。不得借本轮合入启动后续工具／热点／热重载实现；不push、不发布、不改客户环境 |
| 基线 | codex/readyz-drain-checkpoint-20261120上的f98deeb9；父提交18b63d01。原共享分支／暂存区未切换或清理；执行前重新核对漂移与其他任务边界 |
| 验收 | 预算正常写争用无非预期503，真实故障失败关闭并可恢复；同步段与探针沿原预算；重载在途／失败／恢复按先行确权合同验证；1883表约1h同候选组合证据齐全，不自动签完整R-CAV或发布PASS |
| 归属 | [总账工作包](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；复用P1-60／64、P1-61／62／63、P1-47／13及展示快照隔离。工程工作包，不新造产品SC或改变Spec现值 |
| 前序证据 | [阶段提交复核](../reviews/2026-11-20-core-availability-checkpoint-review.md) · [1883表约1h补验](../qa/uat/suites/core-availability/runs/2026-11-20-codex-fde-1883-soak.md) · [测试台](../qa/uat/INDEX.md) |

**Goal:** 在同一可追溯候选中消除已确认预算争用失败，缩短造成主路径迟滞的剩余同步工作，并按明确合同保护配置重载期间的业务与恢复。

**Architecture:** 沿用单实例Lucy／KTX、权威权限代次、既有预算持久化、展示快照和重建worker。先量化再定点改，不重新搬迁已有worker写片。进程TERM与KTX配置重载分别建模，复用真实工作登记，不把全局关停状态当可逆重载开关。

**Tech Stack:** Node22／TypeScript、better-sqlite3、Vitest／Node测试、本机Docker与合成MySQL；不改KTX源码，不扩展部署形态。

## 目标与完成顺序

1. **已有预算修复组合复验**：18b63d01已修，不重新实现预算逻辑。
2. **主线程热点／同步等待定点整改**：区分CPU、同步文件／SQLite等待、采样开销和配额节流，不按函数热度直接认定根因。
3. **热重载中断整改**：先明确自动／手动重载、在途请求、授权收紧和恢复的合同边界，再实现最小保护。
4. **同候选组合验收**：约1h、12个变更周期，与完整F61／F62／F63／R-CAV剩余项分开记账。

普通HTTP、纯MCP合法成交与拒绝／失败关闭必须同时验。客户readyz长期挂起尚未确证，本计划不把本机应用层503写成客户摘流型503已经解决。

## 开工前置与去重核对

- 从上述隔离检查点开始，不复制原共享工作区全部dirty内容。记录gitSha、dirty清单、镜像ID、12份运行／测试快照hash及实际Node／KTX版本；新候选不能借用旧镜像PASS。
- P1-60预算争用修复与P1-64短名／运行时确认已有独立验收；P1-61真实取消、P1-63真实MCP／Node PID排空已有局部Docker证据。完整矩阵仍缺，不重复立项这些能力。
- P1-47的write_slice、delete_window、PASSIVE已有worker；新剖析只找尚在主线程的读／分组／解析等剩余片段。[展示快照隔离](../specs/lucy-20261030-display-snapshot-invalidation-isolation-spec.md)已有去重、scope和代次，不另造授权缓存。
- 与当前总账P1-66名册摘要、P1-67统一性能门禁、P1-68运维步骤账划清边界；本包不并入其在途实现、不新建CI／通用MCP SLO／日志产品功能。需要相关能力时先对齐其合同与授权。
- 先修正测试工具的终止／采集边界：现有soak入口要求7200秒，不能传3600后声称已运行；下一轮执行前让参数明确支持事先冻结的约1h窗口和独立故障控制，并保留计划／实际到达量。
- 不再启动连续CPU profiler作为性能基线。短栈采样另设具名诊断窗；全窗原始失败和慢样本均保留。工具总体截止必须终结真实执行进程，不能只超时Docker客户端。

## 方案取舍

| 方案 | 取舍 | 本包选择 |
|---|---|---|
| 复用现有修复、缓存／worker，定点减负并补重载生命周期 | 改动小、可回退、能沿既有合同取证；须实测每个剩余段 | 推荐 |
| 仅放宽超时、调大资源或加缓存TTL | 无法证明同步段被消除，授权代次与响应预算可能失真 | 不作为修复验收 |
| 全量worker化或另建并行执行实例切换 | 可能改善隔离，但增加配置、资源和恢复协议，超出现有能力边界 | 不默认纳入；必要时另立合同 |

## Task 0：冻结候选与修正验证工具

**Files:** `scripts/uat/core-availability-1883-soak.py`、`scripts/uat/readyz-diagnostic-repro.py`；现有core-availability的fixtures／cases／runs。

1. 核对f98deeb9确含18b63d01预算修复与9个可用性修复文件；生成差异与白名单，拒绝把他人工作树整体当候选。
2. 给工具补明确的3600秒窗口、可选独立I/O控制与采样开关；固定到达计划，记录实际发起、成功、拒绝、超时、停止时在途，禁止把尝试总数标成成功。
3. 增加受控停止路径：先停新负载，结算或明确截尾在途，再采集、清理；停止后的人工暂停耗时不能记成自然业务延迟。
4. 审计验证按索引友好、有界分页读取原始行与有效关联，核对用户、孤儿／重复和水位；复用现有满量验证器。保留采集超时与实际进程终态，不伪造complete。
5. 用短工具校准证明周期统计、失败分母、停止与清理正确，再冻结正式约1h参数；短校准不算长跑通过。

**Exit:** FUP-01；工具与候选身份明确、停止可控、计数可独立重算。不得把合成审计种入记录当成真实RPC。

## Task 1：预算503已有修复的组合复验

**Files:** `webui/server/proxy/audit.ts`、`webui/server/proxy/question-experience.ts`（先核对、不预设修改）；`webui/server/__tests__/budget-state-sqlite-contention.test.ts`、`webui/server/__tests__/question-budget-window-mode.test.ts`、`webui/server/__tests__/mcp-proxy-execution-stale.test.ts`。

1. 运行既有真实WAL争用和失败原子回滚反例，确认immediate取锁、幂等键与预算／ACL规则未变。
2. 同时观测主线程与探针：同步等待写锁可能减少503却引入长尾，必须与合法查询、响应预算一起判定。
3. 在1883表配置和实际审计writer同窗验证普通查询、新短名读取与恢复；每次核对4／100，不以握手成功代替查询。
4. 区分正常短锁争用与真实存储不可用。后者继续失败关闭；解除故障后核对同一合法身份／原问题重试，不通过新建身份绕开失败状态。
5. 若现有修复已满足全部条件，只登记复验；只有新的具体反例才按既有P1-60合同补修，不重复实现已收口逻辑。

**Run:** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/budget-state-sqlite-contention.test.ts server/__tests__/question-budget-window-mode.test.ts server/__tests__/mcp-proxy-execution-stale.test.ts`。

**Exit:** FUP-02；正常争用场景无非预期question_budget_unavailable，真实失败零副作用且可恢复，探针／业务预算同时满足。

## Task 2：主线程同步段定点整改

**Candidate files:** `webui/server/display-snapshot.ts`、`webui/server/source-name-registry.ts`、`webui/server/semantic-assets.ts`、`webui/server/proxy/audit.ts`、`webui/server/admin/inferred-turn-maintainer.ts`、`webui/server/admin/audit-inquiry-serial.ts`。这些是定位入口，不是全部必改清单。

1. 对同一条慢请求建立时间关联：准入／权限与元数据／KTX执行／审计持久化／响应；结合已有指标、短CPU样本、主线程CPU／wchan和容器节流。采样另窗，不把包含栈占时相加当精确CPU秒。
2. 分别量化全量YAML解析次数、文件核对数量、同代缓存命中、同步SQLite读／分组及单段耗时；确认每个段是计算、存储等待还是排队。
3. 先写能稳定触发该段的失败反例，再只改对应函数。优先已有版本缓存／去重、集合操作、有限分片与既有worker接缝；不重新搬迁已经off-thread的写片，不放宽权限或把陈旧快照当权威。
4. 核对单次昂贵SQL／解析本身的上界，不能只在它之后加yield；实测不能达到既有预算时回到对应合同评审，不延长探针截止凑绿。
5. 运行对应display-snapshot、source registry、rebuild预算／水位／恢复金样本，再验证无CPU profiler的普通HTTP和纯MCP成交。

**Run:** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/display-snapshot.test.ts server/__tests__/rebuild-probe-budget-allocate-chunking.test.ts server/__tests__/rebuild-probe-budget-wal.test.ts server/__tests__/inferred-turn-watermark-snapshot.test.ts`；涉及源映射时追加既有source-name-registry及P1-64回归。

**Exit:** FUP-03；具体反例被消除，原权限／代次／水位不退化，普通HTTP与纯MCP能完成原任务。MCP全链路p50／p95／p99／max必须报告；通用SLO仍归其现有合同，不在本包临时造门槛或借p99掩盖失败。

## Task 3：热重载保护先补合同，再实现最小改动

**Files:** `webui/server/ktx-mcp-reload.ts`、`webui/server/admin/mcp-runtime-reload.ts`、`webui/server/runtime/mcp-process-work.ts`、`webui/server/proxy/mcp-proxy.ts`、`scripts/runtime/docker-entrypoint.sh`；测试`webui/server/__tests__/ktx-mcp-reload.test.ts`、`webui/server/__tests__/mcp-runtime-reload.test.ts`、`webui/server/__tests__/source-shortname-runtime-ack.test.ts`及既有MCP生命周期测试。

1. 先画实际调用链，区分Manifest上传、启用表保存的自动重载和用户显式重载；已有reloadChain、inflight、requestId／digest和回执必须复用，不另建平行控制器。
2. 新增热重载语义若未被现行Spec191／P1-63／P1-64覆盖，先在总账与REQ补差集并制定功能Spec，明确受影响画像、成功／失败／超时／恢复及验收SC。工程Plan不能替代这一合同。
3. 合同必须选择：正常在途短查询如何终结、切换窗新请求是有限等待还是明确可重试拒绝、超预算怎么收敛、强制手动重载与相同digest自动请求如何区别。不得把正常强制请求静默吞掉，也不得无界排队或自动重放业务。
4. 复用真实在途工作登记，但不能调用不可逆的整实例beginInstanceShutdown冒充可逆重载。重载排空、stop／start和核验共用已确权的总deadline，不逐段重置为更长预算。
5. 覆盖权限收紧／吊销、配置代次变化、启动失败、回执迟到、并发重载和TERM竞争；权限不确定仍失败关闭。失败时保存事实、执行层事实、未确认状态必须真实，不能假ack或回填旧结果。
6. 合同确定后补真实HTTP／MCP与Docker反例，再实施最小保护；正常短在途不得因重载被静默截断，切换后同一合法身份能恢复查询。单实例不承诺任意长查询／任意故障零中断。

**Run:** `cd webui && npx vitest run --maxWorkers=1 server/__tests__/ktx-mcp-reload.test.ts server/__tests__/mcp-runtime-reload.test.ts server/__tests__/source-shortname-runtime-ack.test.ts server/__tests__/mcp-proxy-execution-stale.test.ts`；真实Docker查询／回执／PID为必需补充，组件替身不替代。

**Exit:** FUP-04／05；先有有效功能合同，再有成功／拒绝／截止／恢复的真实证据。TERM三轮PASS不能代签配置热重载。

## Task 4：同候选1883表组合复验与交接

1. 冻结一个含上述实际修复的镜像、源码差异、测试工具与参数；原约1hFAIL保留为对照，不能拼接不同镜像的PASS。
2. 固定1883–1884张真实物理表／Manifest／启用表，12个合法MCP身份，67历史用户合成审计维护；每5分钟一个真实短名／保存／重载周期，约1h至少12个完整周期。表列数、会话聚类、审计文本宽度及查询数据形状明确，不等同客户全环境。
3. 三探针各1Hz、普通鉴权HTTP1Hz；普通MCP固定计划每5秒一次并记录实际发起率，不能由响应慢退成闭环低速后签吞吐PASS。预期容量拒绝、计划切换和稳态失败分别统计且均留分母。
4. 主性能窗不启动连续CPU profiler；另设真实诊断I/O超时／仅恢复路径控制，证明真实子进程退出、单在途与fresh恢复，控制窗不冒充自然复发。
5. 审计核对全部当前窗口原始行与唯一有效关联、用户／孤儿／重复和真实水位。未收敛或诊断采集超时保持GAP，不以状态complete自报替代。
6. 更新测试台INDEX、suite、runs、e2e和各Spec现值镜像；只清理本任务资源。未完成F62三类别、F63完整分支和原R-CAV高档时不签整套PASS，不发布或改客户环境。

**Formal command（仅Task0完成参数支持及校准后）:** `python3 scripts/uat/core-availability-1883-soak.py --image <冻结镜像ID> --out inbox/core-availability-followup --seconds 3600 --cycle-seconds 300`。采样默认关闭，独立I/O控制与停止由Task0明确选项；不可直接用当前仍要求7200秒的旧入口宣称执行此命令成功。

**Exit:** FUP-01–06及每个实际被消费Spec的对应SC证据；完整发布结论另按原门禁处理。

## 验收矩阵

| 工作包ID | 必须证据与门槛 | 原归属 |
|---|---|---|
| FUP-01 | 精确同候选、约1h实际时长、至少12完整周期、三重表计数≥1883、计划／实际／截尾分母可复算 | R-CAV-FDE-1883；不是新产品SC |
| FUP-02 | 正常真实写争用下预算相关非预期503为0；真实存储失败仍拒绝且原子，恢复后合法原任务可成交；权限与预算不绕过 | P1-60／64 |
| FUP-03 | 重负载livez p99≤400ms／max≤1000ms、readyz p99≤1500ms，普通HTTP每次3秒截止内正确；纯MCP正确、无稳态非预期失败／超时。全量延迟／失败保留，F61轻档原预算不放宽 | P1-13／47／61及展示快照隔离 |
| FUP-04 | 正常短在途、自动／手动／并发重载、真实KTX切换及TERM竞争按先行Spec验证，无静默截断／假成功／自动重放 | 热重载合同差集，先登记确权 |
| FUP-05 | 切换窗约束有同一合法用户可达的重试／恢复，窗口有界；授权收紧不陈旧放行；存储／启动失败不会永久挂住 | 对应功能Spec新增／继承SC，不凭本表代签 |
| FUP-06 | 1883表真实诊断I/O截止、真实结束、仅恢复路径自动fresh；完整有效审计闭包与水位；F62／63未覆盖项逐条留GAP | P1-61／62／63、P1-45／47及原R-CAV |

## 受影响画像与体验目标

| 画像 | 目标 | 风险与验收 |
|---|---|---|
| 问数方 | ↑：维护和配置变更期间合法纯MCP查询更稳定 | 若切换窗引入等待／拒绝，属↓风险；先在热重载Spec写明补偿与SC，FUP-04／05必须验同一身份恢复 |
| 治理方 | ↑：短名保存与实际配置一致，反馈真实 | 不引入第二套保存模型；触及WebUI反馈须补真实前台浏览器与计时，不能用API通过代替 |
| 运维方 | ↑：真实截止、工作终态、回执与恢复可核对 | 不要求客户手工杀进程；现场与本机结论分开，不承诺未验证部署路径 |
| 管理层 | ↑：能区分已修、待验与客户已恢复 | 不把阶段commit／组件绿／局部PASS写成用户更新放行 |

本轮只制定计划，无WebUI实现变更，不执行浏览器；未来若改用户可见交互，按仓库规则补对应浏览器验证及时间证据。

## 完成定义

每个任务有实际差异、反例、同候选结果和恢复证据；已存在修复不重复开发，新增语义有先行合同。测试／需求／开发三台账一致，失败和未覆盖项明确，阶段提交与后续改动可分别审阅／回退。功能合同收口、整套UAT PASS、可发布、客户现场已解决分别判定。

## 风险与控制

- immediate事务仍可能同步等待写锁：同时测探针和合法任务，不只看503数量。
- CPU采样及验证SQL本身干扰服务：诊断另窗、有界采集、保留观测开销，不剔除慢样本造PASS。
- 缓存优化误放陈旧权限：权威代次和拒绝／合法恢复双向回归，不放宽ACL。
- 热重载与全局TERM状态混用：分开生命周期、总deadline与实际资源终态，不用全局关停API做临时暂停。
- 共享工作区漂移：隔离分支、文件白名单和实际镜像hash；不纳入他人dirty实现或变更客户环境。
- 新组合仍继承基线5处另一Plan的文档门禁问题：提交复核已附纯基线对照；按该原任务修复整合后再签全仓门禁，不在本包假绿或增加豁免。

## 2026-11-20本轮合入处置

委托人明确本次修复先合入0.30，后续计划放下次开发。本次只消费已完成的修复与现有真实I/O／MCP排空复测入口；本计划的工具改造、预算满量组合复验、热点与热重载新实现均未启动。后续开发从届时明确的0.30提交重新冻结，不把当前计划当已完成或整包放行。
