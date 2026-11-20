# 核心可用性三问题整改与同候选验证 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 跨合同实施与验收 Plan / v0.3（本轮执行交接） |
| 日期 | 2026-11-20 |
| 状态 | v0.3本轮执行及失败跑次交接完成。预算复验、热点最小修复与重载保护已实施；P1-70局部功能收口，P1-69完整矩阵仍有GAP；30分钟组合独立严格FAIL，采集缺口另列后续任务；未签整套UAT或发布结论 |
| 授权边界 | 委托人2026-11-20本轮明示“批准执行”，授权按CA-00–09开展隔离工作树内工具、既有合同修复与本机Docker验证；新增热重载合同先确权再实施；不push、不发布、不改客户环境；本地commit已获委托人后续“commit 本任务”授权，仅提交本隔离分支 |
| 基线 | 历史检查点为f98deeb9／父提交18b63d01，已合入lucy-v0.30；本次只读核查HEAD为7dded5478a05e256aa23d33567b49beb3820ec3b，工作树干净。实际开发从届时确认的0.30提交重新冻结，不能倒退到旧隔离分支 |
| 本次任务 | 委托人先要求检查遗留计划并制定多 agent 可执行 task，随后明确批准执行；本轮按CA-00–09推进，新增热重载合同已经Codex CLI终审通过，功能与UAT结论按实测分别登记 |
| 验收 | 预算正常写争用无非预期503，真实故障失败关闭并可恢复；同步段与探针沿原预算；重载在途／失败／恢复按先行确权合同验证；1883表30分钟／12周期同候选组合证据齐全，不自动签完整R-CAV或发布PASS |
| 归属 | [总账工作包](lucy-20261107-lucy-0-30-feature-inventory-pool.md)；复用P1-60／64、P1-61／62／63、P1-47／13及展示快照隔离。工程工作包，不新造产品SC或改变Spec现值 |
| 前序证据 | [阶段提交复核](../reviews/2026-11-20-core-availability-checkpoint-review.md) · [1883表约1h补验](../qa/uat/suites/core-availability/runs/2026-11-20-codex-fde-1883-soak.md) · [测试台](../qa/uat/INDEX.md) |

**Goal:** 在同一可追溯候选中消除已确认预算争用失败，缩短造成主路径迟滞的剩余同步工作，并按明确合同保护配置重载期间的业务与恢复。

**Architecture:** 沿用单实例Lucy／KTX、权威权限代次、既有预算持久化、展示快照和重建worker。先量化再定点改，不重新搬迁已有worker写片。进程TERM与KTX配置重载分别建模，复用真实工作登记，不把全局关停状态当可逆重载开关。

**Tech Stack:** Node22／TypeScript、better-sqlite3、Vitest／Node测试、本机Docker与合成MySQL；不改KTX源码，不扩展部署形态。

## 目标与完成顺序

1. **已有预算修复组合复验**：18b63d01已修，不重新实现预算逻辑。
2. **主线程热点／同步等待定点整改**：区分CPU、同步文件／SQLite等待、采样开销和配额节流，不按函数热度直接认定根因。
3. **热重载中断整改**：先明确自动／手动重载、在途请求、授权收紧和恢复的合同边界，再实现最小保护。
4. **同候选组合验收**：30分钟、12个变更周期，与完整F61／F62／F63／R-CAV剩余项分开记账。

普通HTTP、纯MCP合法成交与拒绝／失败关闭必须同时验。客户readyz长期挂起尚未确证，本计划不把本机应用层503写成客户摘流型503已经解决。

## 开工前置与去重核对

- 从届时确认的lucy-v0.30提交冻结隔离候选，并确认包含上述历史检查点，不复制原共享工作区全部dirty内容。记录gitSha、dirty清单、镜像ID、12份运行／测试快照hash及实际Node／KTX版本；新候选不能借用旧镜像PASS。
- P1-60预算争用修复与P1-64短名／运行时确认已有独立验收；P1-61真实取消、P1-63真实MCP／Node PID排空已有局部Docker证据。完整矩阵仍缺，不重复立项这些能力。
- P1-47的write_slice、delete_window、PASSIVE已有worker；新剖析只找尚在主线程的读／分组／解析等剩余片段。[展示快照隔离](../specs/lucy-20261030-display-snapshot-invalidation-isolation-spec.md)已有去重、scope和代次，不另造授权缓存。
- 与当前总账P1-66名册摘要、P1-67统一性能门禁、P1-68运维步骤账划清边界；本包不并入其在途实现、不新建CI／通用MCP SLO／日志产品功能。需要相关能力时先对齐其合同与授权。
- 历史核查发现旧soak入口要求7200秒，不能传3600后声称已运行。本轮已修为显式正式／校准模式，依委托人最新指令冻结1800秒／150秒，并保留计划／实际到达量与独立故障控制。
- 不再启动连续CPU profiler作为性能基线。短栈采样另设具名诊断窗；全窗原始失败和慢样本均保留。工具总体截止必须终结真实执行进程，不能只超时Docker客户端。

## 方案取舍

| 方案 | 取舍 | 本包选择 |
|---|---|---|
| 复用现有修复、缓存／worker，定点减负并补重载生命周期 | 改动小、可回退、能沿既有合同取证；须实测每个剩余段 | 推荐 |
| 仅放宽超时、调大资源或加缓存TTL | 无法证明同步段被消除，授权代次与响应预算可能失真 | 不作为修复验收 |
| 全量worker化或另建并行执行实例切换 | 可能改善隔离，但增加配置、资源和恢复协议，超出现有能力边界 | 不默认纳入；必要时另立合同 |

## Task 0：冻结候选与修正验证工具

**Files:** `scripts/uat/core-availability-1883-soak.py`、`scripts/uat/readyz-diagnostic-repro.py`；现有core-availability的fixtures／cases／runs。

1. 核对届时0.30基线包含f98deeb9、18b63d01预算修复与9个可用性修复文件；生成差异与白名单，拒绝把他人工作树整体当候选。
2. 给工具补明确的1800秒窗口、可选独立I/O控制与采样开关；固定到达计划，记录实际发起、成功、拒绝、超时、停止时在途，禁止把尝试总数标成成功。
3. 增加受控停止路径：先停新负载，结算或明确截尾在途，再采集、清理；停止后的人工暂停耗时不能记成自然业务延迟。
4. 审计验证按索引友好、有界分页读取原始行与有效关联，核对用户、孤儿／重复和水位；复用现有满量验证器。保留采集超时与实际进程终态，不伪造complete。
5. 用短工具校准证明周期统计、失败分母、停止与清理正确，再冻结正式30分钟参数；短校准不算长跑通过。

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
2. 固定1883–1884张真实物理表／Manifest／启用表，12个合法MCP身份，67历史用户合成审计维护；每150秒一个真实短名／保存／重载周期，30分钟至少12个完整周期。表列数、会话聚类、审计文本宽度及查询数据形状明确，不等同客户全环境。
3. 三探针各1Hz、普通鉴权HTTP1Hz；普通MCP固定计划每5秒一次并记录实际发起率，不能由响应慢退成闭环低速后签吞吐PASS。预期容量拒绝、计划切换和稳态失败分别统计且均留分母。
4. 主性能窗不启动连续CPU profiler；另设真实诊断I/O超时／仅恢复路径控制，证明真实子进程退出、单在途与fresh恢复，控制窗不冒充自然复发。
5. 审计核对全部当前窗口原始行与唯一有效关联、用户／孤儿／重复和真实水位。未收敛或诊断采集超时保持GAP，不以状态complete自报替代。
6. 更新测试台INDEX、suite、runs、e2e和各Spec现值镜像；只清理本任务资源。未完成F62三类别、F63完整分支和原R-CAV高档时不签整套PASS，不发布或改客户环境。

**Formal command（仅Task0完成参数支持及校准后）:** `python3 scripts/uat/core-availability-1883-soak.py --image <冻结镜像ID> --out inbox/core-availability-followup/<run-id>/08-soak --mode formal --seconds 1800 --cycle-seconds 150 --contract-policy p1-69 --audit-evidence-copy --io-control --profile-seconds 0`。采样默认关闭，独立I/O控制与停止由Task0明确选项；旧7200秒入口仅为历史反例；实际执行须使用本轮已校准、带精确hash的1800秒入口。

**Exit:** FUP-01–06及每个实际被消费Spec的对应SC证据；完整发布结论另按原门禁处理。

## 验收矩阵

| 工作包ID | 必须证据与门槛 | 原归属 |
|---|---|---|
| FUP-01 | 精确同候选、30分钟实际时长、至少12完整周期、三重表计数≥1883、计划／实际／截尾分母可复算 | R-CAV-FDE-1883；不是新产品SC |
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

制定计划阶段无WebUI实现变更，未执行浏览器；本轮开发若改变用户可见交互，按仓库规则补对应浏览器验证及时间证据。

## 完成定义

每个任务有实际差异、反例、同候选结果和恢复证据；已存在修复不重复开发，新增语义有先行合同。测试／需求／开发三台账一致，失败和未覆盖项明确，阶段提交与后续改动可分别审阅／回退。功能合同收口、整套UAT PASS、可发布、客户现场已解决分别判定。

## 风险与控制

- immediate事务仍可能同步等待写锁：同时测探针和合法任务，不只看503数量。
- CPU采样及验证SQL本身干扰服务：诊断另窗、有界采集、保留观测开销，不剔除慢样本造PASS。
- 缓存优化误放陈旧权限：权威代次和拒绝／合法恢复双向回归，不放宽ACL。
- 热重载与全局TERM状态混用：分开生命周期、总deadline与实际资源终态，不用全局关停API做临时暂停。
- 共享工作区漂移：隔离分支、文件白名单和实际镜像hash；不纳入他人dirty实现或变更客户环境。
- 历史检查点曾有另一Plan的5处文档门禁问题；2026-11-20本次核查当前HEAD的5项文档／勾连检查全部通过，只保留原有提示。执行时重测基线，不把历史失败抄作当前阻断，也不增加豁免。

## 2026-11-20历史合入处置

委托人明确本次修复先合入0.30，后续计划放下次开发。本次只消费已完成的修复与现有真实I/O／MCP排空复测入口；本计划的工具改造、预算满量组合复验、热点与热重载新实现均未启动。后续开发从届时明确的0.30提交重新冻结，不把当前计划当已完成或整包放行。

## 多 agent 执行任务单（2026-11-20核查后编排）

本节将上文Task0–4拆为可派发工作，不另立状态事实源。`CA-xx`仅是本工程包任务ID；`FUP-xx`仍按上文验收矩阵解释，不能代替原Spec的SC。批准前仅完成计划制定，当时任务均为待执行；本轮已获批准执行，进展见头部与文末执行登记。CA-03确认的新合同差集已另行登记P1-69／REQ-030-090。

### 遗留计划检查结论

| 已核对事实 | 对下一轮执行的影响 | 处理任务 |
|---|---|---|
| 当前分支lucy-v0.30已含f98deeb9与18b63d01；已有合入修复局部PASS WITH GAP | 旧分支是历史来源；不重复开发预算／诊断取消／TERM排空，不借旧镜像证明新组合 | CA-00／02／07 |
| 原1883表长跑FAIL仍在；12次保存重载仅8次完成恢复；原候选不含预算锁修复 | 先复验已有预算修复，不能把历史5次预算503直接认作当前回归 | CA-02／08 |
| soak入口硬校验seconds≥7200；CPU profiler必启；tick_worker在响应结束后才发下一次 | 核查当时3600秒命令不可执行；本轮已整改并依最新指令采用1800／150，固定到达与全分母保留 | CA-01 |
| 基类Rig.request将所有调用截到min(timeout,15)，即使调用方传90／180秒 | 必须区分HTTP、MCP、变更操作与整轮deadline；写明实际生效值，不能以传参值代替 | CA-01 |
| 汇总用宽泛错误文本＋成功重载结束后10秒窗口归类expected；自然窗终点包含join等待 | 判定须依先行合同，失败全部保留；固定自然窗边界，排空／人工暂停另计 | CA-01／03／08 |
| audit_facts(full=True)主要计数合成历史关联，不能证明完整有效闭包；已有满量验证逻辑 | 复用rebuild-probe-budget.mjs的有效关联／水位规则，补有界采集；不得只看complete | CA-01／08 |
| 热重载已有reloadChain、inflight、requestId／digest回执；整实例TERM有独立协议 | 先审合同差集，再实现最小接缝；不得用beginInstanceShutdown做可逆重载 | CA-03／06 |
| P1-66批次A已收口、批次B暂停；P1-67／68仍未获开发授权 | 这是当前边界，不能继续称三项都在开发；本包不消费其未完成实现 | CA-00／09 |

依据：[合入复测](../qa/uat/suites/core-availability/runs/2026-11-20-codex-availability-merge-recheck.md)、[历史1883表FAIL](../qa/uat/suites/core-availability/runs/2026-11-20-codex-fde-1883-soak.md)、[执行总账](lucy-20261107-lucy-0-30-feature-inventory-pool.md)及本次脚本静态核查。没有执行新的产品测试或压力实验。

### 角色、并发与文件所有权

采用**1个主控M＋最多3个子agent**。角色可顺序复用，最多4个活跃agent，不能把下表每个任务同时启动。优先级表示调度次序，不是新增产品P0立项。

| 角色 | 职责 | 写入边界 |
|---|---|---|
| M：主控／集成／终审 | 基线、授权核对、文件锁、集成、候选冻结、三台账登记与最终裁决 | 共享治理／索引／总账／REQ／Spec状态镜像仅M写；任何公共接缝改动须先分配owner |
| A：验证工具／满量执行 | CA-01工具、CA-08真实Docker与原始证据 | scripts/uat/下明确白名单；inbox/本任务目录；不改产品运行代码 |
| B：预算复验／热点定位与整改 | CA-02／04／05 | 先只读；CA-05仅写获分配的具体函数及对应测试，不批量修改候选文件 |
| C：热重载合同／实现 | CA-03／06 | CA-03只交合同草案；CA-06在确权后写重载接缝，不改预算和审计算法 |
| R：独立复核 | CA-09时替换一个已结束的子agent；另一个人检查具体修改 | 只读代码与原始证据，结果写inbox/本任务目录；状态由M回写 |

并行规则：

1. M先冻结`BASE_SHA`，创建`codex/core-availability-followup-*`隔离工作树；各子agent从同一基线工作，交付白名单patch或在获准本地提交范围内交付SHA。各自的工作树根、端口、容器／网络／卷和输出目录必须不同。禁止在共享目录各自checkout、reset、stash或清理他人dirty。
2. 同工作树协作时使用M维护的文件owner表；独立工作树也不能绕过语义冲突审查。`proxy/audit.ts`只能由B写；`proxy/mcp-proxy.ts`、`runtime/mcp-process-work.ts`、`index.ts`及entrypoint如需同时涉及，由M指定一个owner串行整合，另一方只交接缝需求。CA-02默认不改运行代码。
3. 共享Markdown不是多写者文件：C将合同／REQ差集草案交M，M入账及维护镜像；A交测试结果草案，M登记测试台。子agent不得整文件覆盖当前总账或INDEX。
4. **代码阅读／草案可并行，重负载Docker、CPU诊断、性能定向回归与正式长跑共用一把测试资源锁。** 有容器隔离也不代表宿主CPU／磁盘隔离。CA-08期间暂停本任务其他构建／压测；记录可见外部宿主负载，无法稳定隔离时保留限制，不签无干扰性能结论。
5. 子agent完成不等于集成：M先核对范围、反例、恢复和资源清理，再收取改动。每个运行改动至少由另一位未编写该改动的agent复核；R给建议，终稿确权按DEVELOPMENT由Codex CLI终审，或无Codex时委托人明示确权。

### 调度依赖与开工关卡

| 波次 | 可以启动的任务 | 进入下一波的条件 |
|---|---|---|
| W0 | M：CA-00 | G0：当前授权矩阵、基线、范围、资源与文件owner冻结 |
| W1 | A：CA-01；B：CA-02；C：CA-03（合同草案可只读并行） | G1：工具短校准通过，预算结论明确；G2：热重载合同完成确权与该范围开发授权 |
| W2 | B：CA-04→CA-05；C：CA-06；A复核工具输出及准备证据核验 | CA-04使用G1工具；CA-05仅消费确证热点；CA-06必须满足G2；共享接缝串行、诊断独占资源 |
| W3 | M：CA-07 | 所有被纳入修复完成审查，集成回归通过，冻结G3同候选 |
| W4 | A：CA-08；M只读监督 | G3有效，正式性能窗独占测试资源；故障控制另窗 |
| W5 | R＋M：CA-09 | 独立重算、差集与全部已有状态镜像核对完成；结论按实际覆盖逐条登记 |

依赖：`CA-00 → {CA-01,CA-02,CA-03}`；`{CA-01,CA-02} → CA-04 → CA-05`；`CA-03＋G2 → CA-06`；`{CA-01,CA-02,CA-05,CA-06} → CA-07 → CA-08 → CA-09`。CA-05若证实无需运行改动，须交等价证据后由M明确免改；CA-06未获授权时只交合同，原整包保持待续，不绕开它签FUP-04／05。

G0须引用具体会话授权或Spec头部，不把本节“可执行”当“已授权”。检查与制定task后，委托人已在本轮明示“批准执行”，解除原下次开发约束；该授权不代替新增合同的先行确权。

### CA-00：重新冻结0.30基线与任务边界

**Owner／依赖：** M；首任务。**对应：** 原Task0前置、FUP-01身份部分。

**输入：** 本Plan、DEVELOPMENT、用户画像、总账现值、P1-60／61／62／63／64的Spec头部与历史FAIL。**可写：** `inbox/core-availability-followup/<run-id>/00-baseline/`；经开工授权建立隔离工作树。不改产品代码。

1. 记录当前`git status --short`、分支、`git rev-parse HEAD`，运行`git merge-base --is-ancestor 18b63d01 HEAD`及`git merge-base --is-ancestor f98deeb9 HEAD`；退出0证明祖先关系，不以commit标题代替。
2. 列出实际纳入的现有修复、每条归属／SC／授权和明确排除项；生成`baseline.json`、`scope.md`、`ownership.md`。冻结`BASE_SHA`、工具及运行文件hash、Node／KTX实值与候选构建方式。
3. 明确Docker资源预算、宿主并发限制、唯一资源前缀、私有凭据位置、输出根和清理白名单。私密Token不写任务包或原始公开日志。
4. 重跑5项文档／勾连门禁并保存基线；将下表各任务状态置为待执行，给A／B／C派发各自白名单。若有漂移，先刷新范围再派发。

**交付／通过：** 上述三文件＋检查原始日志，能追溯到确切基线及授权，G0成立。失败则不启动依赖的变更／重负载任务。

### CA-01：修正验证工具并证明计数、截止与停止可信

**Owner／依赖：** A；CA-00／G0。**对应：** 原Task0、FUP-01工具部分和FUP-06采集部分。

**Modify：** `scripts/uat/core-availability-1883-soak.py`、`scripts/uat/readyz-diagnostic-repro.py`。**Read：** `scripts/uat/verify-begin-zero-binding.py`、`scripts/uat/rebuild-probe-budget.mjs`的`migratedFacts`。**Create（计划路径）：** `scripts/uat/core-availability-1883-soak.test.py`，仅覆盖已发现的工具失真／终止反例，不写产品镜像式测试。公共helper若必须修改，先交M扩展白名单。

1. 先为3600秒被拒、闭环降速、自然窗含join、宽泛expected误判、外层超时但真实进程仍活等缺陷保留最小反例。测试允许受控本地子进程；不能伪装真实Docker验收。
2. 设计明确的正式／校准模式，正式支持1800秒且至少12完整周期；校准短窗永远不能输出正式PASS。自然窗固定`[start,start+seconds)`，之后只计排空／采集，不延长业务窗凑样本。
3. 固定到达序列。普通MCP是**12身份轮转、合计每5秒一次**，不是每身份每5秒；三探针各1Hz、HTTP1Hz。分别保留planned／dispatched／missed／terminal／inflight／censored；停止发起后结算剩余，计数守恒可重算。MCP允许有界并发，达到预先冻结的上限就记漏发，不能无界线程或排队补发抹去不足。
4. 每个请求保留计划时间、实际启动、终态、身份代号、操作类型、HTTP／RPC码、oracle与耗时；普通查询、短名恢复查询、握手和合成审计种入分开统计。oracle实查4／100，不能只给事件写入该标签。
5. CPU profiler默认关闭；独立I/O控制、短诊断窗可选择且有具名起止。分开HTTP3秒、MCP既有预算、变更操作预算和整轮总deadline；消除基类隐式15秒上限与调用方声明值不一致，不能靠延长原合同预算使测试通过。
6. 停止流程固定为停新到达→有界结算／截尾→停观测→有界采集→清理本任务资源。外层截止须终结本任务真实执行进程并验证实际close／退出，不能只杀docker客户端；TERM／INT及采集超时保留非成功结论。
7. 审计校验沿用既有有效关联／水位规则，按固定cutoff、用户与最大原始ID边界做索引友好分页；核对当前窗口全部行、用户归属、唯一有效关联、孤儿／重复和水位。记录查询时间与截止，不扫到超时后伪造complete；不改生产schema／索引来服务测试。
8. 去掉按字符串／重载后10秒宽限“洗白失败”的判定；暂未确权的切换错误保留未裁决，由CA-03合同逐项映射。运行工具测试，再执行一次短Docker校准，独立重算计数并主动停止一次。

**验证命令：** `python3 scripts/uat/core-availability-1883-soak.test.py`（完成该文件后）；短Docker校准的实际命令、参数与输出写入`01-tools/README.md`。新参数与测试入口由M在`docs/governance/test-layers-and-release-gates.md`登记，不新增CI产品能力。

**交付／通过：** 白名单patch、反例前后结果、`01-tools/`原始输出、独立重算、停止及资源终态证明；CLI帮助和正式调用样例冻结。只有短校准通过才成立G1的工具部分，不能签FUP-01长跑部分。

### CA-02：已有预算修复复验，先判定是否需要改代码

**Owner／依赖：** B；CA-00／G0。**对应：** 原Task1、FUP-02；归属P1-60／64。

**默认只读：** `webui/server/proxy/audit.ts`、`webui/server/proxy/question-experience.ts`。**测试：** `budget-state-sqlite-contention.test.ts`、`question-budget-window-mode.test.ts`、`mcp-proxy-execution-stale.test.ts`（均在`webui/server/__tests__/`）。可写`02-budget/`证据；发现新反例先交M分配运行文件owner。

1. 沿原Task1命令运行现有3文件回归，保留实际WAL争用、immediate事务、失败回滚与幂等断言。
2. 获测试资源锁后，以1883表、真实审计writer与普通查询同窗复验正常短锁争用；同步记录探针及查询尾延迟。工具未就绪时先完成组件证据，不拿小夹具充满量证据。CA-01完成后由M将已审工具patch或冻结工具快照交给B，记录hash后完成本步，不能直接使用A的在途dirty脚本。
3. 在独立故障窗制造既有合同的真实存储不可用，确认拒绝及零副作用；解除后同一合法身份、原问题成交。预算与ACL保持开启，结果4／100。
4. 输出“现有修复满足／新具体反例”两种结论之一；前者不提交重复运行修改，后者交出最小复现、合同归属、函数白名单和修复建议，由M纳入CA-05的小步修复或另行确定范围。

**交付／通过：** `02-budget/result.md`、原始回执和探针时间线；正常争用无非预期预算503，真实故障原子且可恢复。同步锁等待未满足原预算仍判失败，不能仅凭503变少通过。

### CA-03：热重载合同差集与先行确权材料

**Owner／依赖：** C；CA-00／G0；**只做分析与合同草案**。**对应：** 原Task3前半、FUP-04／05的合同前置。

**Read：** `webui/docs/191-execution-runtime-reload-spec.md`、P1-63／64 Spec；`webui/server/index.ts`写路径、`admin/mcp-runtime.ts`、`ktx-mcp-reload.ts`、`admin/mcp-runtime-reload.ts`、`runtime/mcp-process-work.ts`、`runtime/process-drain.ts`、`proxy/mcp-proxy.ts`、`scripts/runtime/docker-entrypoint.sh`。**Write：** `03-reload-contract/`草案；共享Spec／总账由M写。

1. 画出上传Manifest→保存启用表→自动重载，以及显式手动重载→回执→实际核验的调用链，标注真正stop／start所有者、已有串行／single-flight与重复重载来源；直接重载／容器通道都须查明。
2. 为每条新承诺标注“现行合同已有／真实缺口”。输出成功、短在途、切换新请求、超时、取消、权限收紧、启动失败、晚回执、并发digest、手动强制、TERM竞争的行为与SC映射。
3. 给出推荐的有界等待／明确可重试拒绝方案及总deadline建议，写明依据、同一合法身份恢复方式；待确权的数值和语义标为待定，不由实现agent自行决定。不能自动重放业务或承诺任意长查询零中断。
4. 若确有新功能合同差集，交M先补总账／REQ，再按实际开线日期创建同名Spec／Plan并登记索引／UAT；不预占新的P1／REQ号。若可在原合同内修正，明确哪条原Spec需要具名修订与相应镜像。两种路径都要具备4画像、↓补偿SC、伪代码、终态／预算及术语／交互合同适用性说明。
5. M准备可审阅的合同终稿及授权材料；按DEVELOPMENT完成终稿确权并取得该增量开发授权后记录G2。若触及WebUI保存反馈，验收增加真实前台浏览器＋计时；纯后端证据不能代签页面。

**交付／通过：** `03-reload-contract/call-chain.md`、`contract-delta.md`、`acceptance-matrix.md`和确权／授权引用。只有G2允许CA-06写运行代码；草案完成不代表合同已确权。

### CA-04：在无连续profiler的基线上定位剩余同步段

**Owner／依赖：** B；CA-01／02及G1。**对应：** 原Task2定位部分、FUP-03前置。

**Read：** 原Task2列出的6个候选文件、P1-47与展示快照隔离合同及现有worker接缝。**Write：** `04-profile/`诊断证据，不预设运行文件修改。

1. 用校准后的工具冻结一轮诊断候选与负载形状，先跑无CPU profiler对照。对同一慢请求串起准入、权限／元数据、KTX、审计持久化与响应时间线。
2. 对YAML解析、文件核对、同代命中、SQLite同步读／分组分别记录次数与单段耗时，结合主线程CPU／wchan、I/O和cgroup节流；不可把包含栈相加当CPU秒。
3. 仍需栈时申请具名短采样窗，记录启停／导出成本；该窗单列，不拼进无采样基准。只在独立候选／测试工具使用临时插桩并保留diff，不能暗中改变正式镜像。
4. 输出按证据排序的具体函数、触发输入、最小反例、原合同预算、建议方案和回归集合。已off-thread的写片／删除／PASSIVE不得重复搬迁；无法归因则写GAP并补最小诊断，不能直接全量worker化。

**交付／通过：** `04-profile/hotspots.md`＋原始时间线与候选身份。M据此冻结CA-05函数白名单；“没有达到整改条件”也须给可复核数据，不能凭感觉跳过。

### CA-05：按确证反例修复同步热点

**Owner／依赖：** B；CA-04及M冻结的合同／函数白名单。**对应：** 原Task2实施部分、FUP-03。

**候选修改范围：** `display-snapshot.ts`、`source-name-registry.ts`、`semantic-assets.ts`、`proxy/audit.ts`、`admin/inferred-turn-maintainer.ts`、`admin/audit-inquiry-serial.ts`（均在`webui/server/`）；仅实际确证者获分配。对应测试就近放`webui/server/__tests__/`。超出现有合同或授权的语义先回CA-03式合同流程。

1. 每个热点独立小步：稳定反例→确认修前失败→最小实现→同预算回归→另一agent复核。新预算反例若由CA-02转入，须单独列出，不混写成旧修复重做。
2. 优先复用现有版本缓存、去重、集合操作、有界分片和worker；保持权威权限代次、scope、dirty与水位。昂贵单次SQL／解析本身必须受控，不能只在其后yield。
3. 运行原Task2的4个回归文件；涉及源映射追加`source-name-registry.test.ts`及`source-shortname-runtime-ack.test.ts`。不得靠扩大探针截止、缓存TTL或陈旧ACL使结果变绿。
4. 在同候选无CPU profiler条件下复验普通HTTP和纯MCP原任务；记录p50／p95／p99／max及全量失败。涉及用户可见反馈时按CA-03要求追加浏览器取证。

**交付／通过：** `05-hotfix/`内每个反例的前后证据、精确diff、合同SC映射、恢复与回退方式。原预算和权限不退化；没有代码改动的免改单须经M审核，不能自称“全部性能问题已解决”。

### CA-06：按确权合同实现最小热重载保护

**Owner／依赖：** C；CA-03／G2；与CA-05共享接缝先交M排锁。**对应：** 原Task3实施部分、FUP-04／05。

**Modify（按合同缩小）：** `webui/server/ktx-mcp-reload.ts`、`webui/server/admin/mcp-runtime-reload.ts`、`webui/server/runtime/mcp-process-work.ts`、`webui/server/proxy/mcp-proxy.ts`、`scripts/runtime/docker-entrypoint.sh`。`index.ts`／`admin/mcp-runtime.ts`仅在已冻结接缝确需时由M扩展白名单。

1. 先为合同矩阵补可打假的反例；复用reloadChain／inflight／requestId／digest与真实在途settle，不新造并行控制器，不调用不可逆整实例关停API作重载开关。
2. 实施已确权的短在途、切换准入、排空及stop／start／核验共用总deadline；明确强制手动与同digest自动请求，不吞手动请求、不无界排队、不自动重放。
3. 覆盖权限收紧／吊销、配置代次变更、存储／启动失败、回执迟到、并发重载、TERM竞争与恢复；保存事实、执行层事实、未确认状态分别真实，不假ack或回填旧结果。
4. 运行原Task3的4文件回归并追加`process-drain.test.ts`；在真实Docker HTTP／MCP重现“先已受理短查询→重载→终态→同身份恢复”，留KTX PID、digest和回执。同一查询不能靠偷偷重发完成。

**交付／通过：** `06-reload/`内SC逐项结果、真实终态和恢复回执、精确diff及回退方式。组件绿或TERM三轮PASS不能代签热重载合同。G2缺失时仅交分析，保持待续。

### CA-07：串行集成与冻结最终同候选

**Owner／依赖：** M；CA-01／02／05／06完成并通过范围审查。**对应：** 原Task4前置、FUP-01身份部分。

1. 按白名单收取各任务patch／获准提交，先审预算、在途登记、deadline、权限代次和工具判定的交叉影响；发现接缝冲突由owner修正，不整文件覆盖。
2. 在集成树串行运行上述定向回归集合、`npm --prefix webui run typecheck`、`node --test scripts/runtime/docker-entrypoint.test.mjs`与5项文档门禁。性能相关定向检查不与其他重负载检查并行，失败原样保留。
3. 构建本机Docker候选，冻结源码SHA／dirty patch、镜像ID、实际Node／KTX、运行与工具文件hash、资源档、入口及完整参数；将精确SC／UAT用例到候选映射写进`07-candidate/manifest.json`。静态资源若仍沿旧镜像，明确不能签前端制品结论。
4. 用该镜像做最小业务／探针／保存重载smoke并冻结G3；后续运行／工具／负载参数改动都须重新冻结并重跑受影响检查，不拼接不同候选PASS。

**交付／通过：** `07-candidate/`身份、检查、白名单、采纳与排除清单；无未解决范围或接缝冲突，G3成立。

### CA-08：同候选1883表正式30分钟组合验收

**Owner／依赖：** A；CA-07／G3。**对应：** 原Task4、FUP-01–06；M监督资源锁与证据完整性。

1. 按G3工具CLI启动，沿用原Task4的正式命令骨架；CA-01未完成前禁止执行原1800秒命令。将实际生效的采样关闭、独立I/O、请求与总截止、停止选项全部展开写入`08-soak/command.txt`，不得留占位符。
2. 预检真实物理表／Manifest／启用表三计数始终≥1883；记录12身份、67历史用户、20万起始合成审计及每轮增量、列数／会话／文本／数据形状。合成输入不计真实RPC。
3. 自然窗连续1800秒，三探针各1Hz、HTTP1Hz、MCP合计每5秒一次；在t=0、150…1650秒计划12个完整保存／重载／新短名读取／恢复周期，全部须在自然窗内完成。少一轮或漏发不能延长自然窗补签；保留实际速率和不足结论。
4. 完整保留所有失败、慢样本、漏发与截尾；成功延迟和全量终态延迟分别报告。切换错误只能按CA-03确权SC判定，仍计用户可见失败；容量拒绝、切换、稳态、故障控制分别列分母，不能从总数删除。
5. 自然窗后单列真实1883表FIFO诊断截止与仅恢复路径fresh：验证真实子进程退出、单在途、同进程恢复以及同一合法身份查询；固定恢复观察deadline，不手工重启冒充自动恢复。
6. 停新业务并在有界收敛窗内按冻结cutoff／ID核对全部有效审计关联与水位；等待／采集超时保留GAP，原始结束状态真实。只有采集、归档及hash完成后清理本任务资源，保留资源终态回执。

**交付／通过：** `08-soak/`原始JSONL、全部回执、固定自然窗、资源与候选身份、审计闭包与恢复、hash和summary。逐项按FUP矩阵判定；重档livez p99≤400ms／max≤1000ms、readyz p99≤1500ms、HTTP每次3秒内正确、无稳态非预期MCP失败，轻档预算不放宽。任何未满足项不得签相应FUP；本跑次始终不能自动代签完整F62／F63／R-CAV。

### CA-09：独立重算、三台账登记与交接

**Owner／依赖：** R只读复核＋M唯一登记；CA-08结束，失败跑次也必须交接。**对应：** 原Task4出口及完成定义。

1. R从原始记录重算计划／发起／漏发／成功／拒绝／失败／超时／截尾、12周期、三重规模、延迟与失败分母，核对同一镜像／工具／参数；抽查之外还须完整执行审计有效关联／水位验证。复核者不能只复述summary。
2. 将FUP逐项映射到实际消费Spec的SC及测试用例，列出本次PASS／FAIL／GAP和未跑完整F61、F62三类别、F63分支、R-CAV高档。客户readyz根因仍按未确证边界记录。
3. M在`docs/qa/uat/suites/core-availability/runs/`落正式跑次及精选／压缩证据；更新该suite／cases／fixtures（仅必要差异）、测试台INDEX与e2e。过程输出继续留inbox；不清洗历史FAIL、不提交私密凭据。
4. 只有某条Spec实际满足自身出口才更新其头部；同次改齐已有Plan、总账、REQ、docs索引、登记册与project-overview镜像。未满足者保留现值／据实更新，不把部分FUP通过写成完整合同收口。
5. 做事实面减总账的差集核对；新增修复补REQ／SOT并标明授权，不动P1-66暂停范围或P1-67／68设计边界。按下节检查和DEVELOPMENT落盘清单复核，给出已完成／仍待执行／回退／资源清理清单。

**交付／通过：** 独立复核记录、正式run、三台账差异及镜像一致性、剩余任务与准确结论。功能合同、局部UAT、整套UAT、发布和客户结论逐项说清。本计划不含push、发布或客户环境变更；本地commit按届时明确授权处理。

### 子agent派发模板与回报格式

M每次派发须填实值，不能只发送“按Plan继续”：

```text
执行任务：本Plan CA-xx；仅执行该任务。
BASE_SHA／工作树绝对路径／输出绝对路径：<M填写>
合同及授权引用：<Spec路径＋SC＋授权范围；分析任务注明只读>
已完成依赖与关卡：<G0／G1／G2／G3及证据路径>
允许修改：<逐文件或函数白名单>；共享文件owner：<姓名／角色>
测试资源锁／资源前缀／端口／总deadline：<M填写>
先复用已有修复；发现超合同、越白名单或共享接缝冲突，交回反例与差集，继续可独立完成的部分。
交付：精确diff或获准提交SHA、反例前后证据、实际命令与退出码、候选与工具hash、SC/FUP结果、恢复／回退、剩余GAP、资源终态。
禁止自行改总账／INDEX或他人文件；不得关闭ACL／预算、放宽原截止、自动重放业务或用旧镜像PASS代签。
```

每份回报记录任务状态`完成／失败／待依赖／待授权`及原因；“完成”只指任务交付物，不等于功能收口。长任务及时报告有意义变化，原始失败不能被重跑结果覆盖。

### 本次计划制定的验证记录

2026-11-20在上述HEAD上，修订前后运行`npm run lint:spec-docs`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary`和`node scripts/uat/check-e2e-ledger.mjs`，均退出0；`git diff --check`通过。已存在1条STALE baseline提示及eval paired_quiz／access role migration两条WARN；未新增豁免。本轮只改本Plan，不变更各Spec状态，不新建产品SC／UAT PASS，不执行CA-00–09或浏览器测试。

## 多agent本轮执行登记

2026-11-20：上述“本次计划制定”是批准前的历史记录。委托人随后批准执行。G0通过，基线7dded5478a05e256aa23d33567b49beb3820ec3b，隔离分支codex/core-availability-followup-20261120。CA-00基线、工具与开发回归已具备本次候选验证前置；重载／新语义等待的实现与代码终审通过，完整真实定向矩阵仍分项待验；CA-08本次30分钟已完成且独立严格FAIL；CA-09正式取证及本轮交接完成，最终状态以下方本轮终态登记为准；执行证据位于inbox/core-availability-followup/20261120-execution/。历史计划制定与延期说明保留为历史，现行执行以本段与头部为准。


## 同候选窗口调整（委托人最新指令）

2026-11-20，委托人要求“压缩到半小时”。正式自然窗改为1800秒；保留12个完整变更周期，间隔150秒（t=0、150…1650）。三探针／普通HTTP各1Hz、普通MCP合计每5秒、原性能／正确性／预算／授权／完整审计／恢复门槛保持不变；200000历史行与每轮3000增量不缩量。独立故障控制、收敛与取证单列，不拼入30分钟自然窗。只能主张30分钟覆盖，不能宣称小时稳定性通过；历史约1h FAIL及旧3600秒工具快照原样保留。

本文件为隔离执行主副本。共享工作区其他任务dirty保持不动。

## 执行中新差集：正常语义写入与并发查询（发现时历史）

[候选4短校准](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r4-calibration.md)保留FAIL：7次精确重载拒绝与原身份恢复／预算／唯一SQL闭包已由独立备份SQL证实，另1次合法查询在正常Manifest原子写入／镜像期间触发既有D3恢复屏障。不能把该错误按维护窗或SC-03重载豁免。生产运行代码未针对本差集修改。

若增加“只对真实活跃写入所有者有界等待，实际结束后重查权威”的行为，应先按CA-03式流程补合同、预算时点、TERM／ACL优先及孤儿／损坏／失败日志仍关闭的验收，再取得该增量开发授权；不得删除连接提示或关闭恢复屏障。仅前移写后files_saved不能宣称修复本次写入中的拒绝。正式1800秒／150秒／12轮暂未启动；已批准且独立的自动保存、TERM及故障恢复矩阵继续执行。


### 新差集增量授权（当前）

委托人已在本轮选择“批准补充合同并修复”，解除上节待授权，正式登记P1-70／REQ-030-091。按[新Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md)／[配对Plan](lucy-20261120-semantic-read-write-settle-plan.md)先完成Codex CLI终稿确权，再实施最小修复；旧候选4 FAIL不回写。其余已批准独立矩阵继续；正式窗口仍1800秒／150秒／12轮，待新候选短校准与独立复核。

CA-01精确工具扩围：真实MySQL初始化竞态由原socket ping误就绪触发，按主控允许仅改`verify-begin-zero-binding.py`的原数据库就绪轮询，使用TCP只读SELECT1及同一原90秒绝对截止；禁止重放CREATE、未知业务SQL或重置就绪预算。原故障／隔离v4实测／新helper回归及hash分别保留，旧image与inflight driver依赖不改。


### 正式30分钟执行冻结（r6）

候选ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f，1247镜像内文件hash核对通过；360项集成回归、代码终审及r6短校准独立全量审计均通过。正式自然窗1800秒／150秒／12轮，负载与原门槛不变。后置逐条恢复取证总量按短校准7条约42秒估算，单独上限300秒／并发2；这只调整窗外证据收集总量，单RPC180秒与产品原120秒／其他预算不变，不豁免任何失败。命令及三工具hash冻结于inbox/core-availability-followup/20261120-execution/08-soak/r6-1800/。剩余直接CLI与新语义故障定向在本窗口后按同镜像补验；若发现需改运行代码的真实缺陷，须新候选重新验证，不借本跑次PASS。

### r6正式跑次终态与种子轮次说明

r6实际自然1800秒／12周期，生产者PASS WITH GAP，独立证据VALID／严格FAIL：在线审计进度一次截止与两次漏采保留。业务与性能、32重载拒绝原身份恢复、233481条完整审计闭包和FIFO真实控制通过；不据此签完整组合PASS。详见[正式run](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-1800.md)。定向用例与CA-09交接继续。

上文“每轮3000增量”须按开跑前冻结工具的实际轮次定义读取：第0轮承接200000初始合成历史，不重复追加；第1–11轮各3000，合成历史总233000。该算法在正式启动前runner快照、命令、短校准203000（两轮）及独立命令合同中均已固定，并非取证后补数。若按12轮每轮均额外追加的字面理解应为236000，本跑次不能宣称该规模；本文明确消除两种口径，原始计数和严格FAIL均不回写。

## 本轮终态与可执行后续任务（2026-11-20）

本轮已完成实现、冻结r6、正式1800秒／12周期、追加同镜像定向及CA-09失败跑次交接。CA-08独立证据VALID／严格FAIL（在线审计进度1超时＋2漏采），未达到完整组合通过；不是尚在运行。P1-69完整矩阵仍有缺口；P1-70 SC-01–07局部功能出口由组件、真实目录／HTTP和五项真实Docker＋独立审计完成，状态按其Spec及同句镜像登记。远端CI未执行，整套UAT／上线未签。原“执行中／待补验”段是对应历史时点，以本段及头部为现值。

| 任务 | 本轮交付及准确边界 |
|---|---|
| CA-00–01 | 基线、资源规则、原工具改造与资格、最终r6冻结完成；正式跑次后新发现stdin截止与ticket关联漏洞，另有已审且本机71项绿的prospective修复，尚未合回或Docker资格 |
| CA-02 | 已有预算修复复验，原约束与故障关闭不放宽，没有重复实现 |
| CA-03／06 | P169合同CLI确权及最小重载保护实现／终审完成；r6 core10／25及directCLI五项定向通过，完整SC缺口按后续N02／03处理 |
| CA-04–05 | 确证YAML重复解析并做精确内容有界纯memo；P170差集先入总账、获授权及合同终审后修复，局部功能收口 |
| CA-07 | 28文件360项回归、类型／脚本与文档检查完成，最终镜像1247源码hash一致；旧候选FAIL保留 |
| CA-08 | 正式30分钟及后置取证完成；严格FAIL，不能签完整FUP／整套UAT或1小时稳定性 |
| CA-09 | 独立完整审计、定向五项独立SQL、原始证据持久归档、10处现值镜像及三台账勾连、资源终态与交接完成；明确剩余缺口，不把失败跑次说成通过 |

[本轮交接与下一批CA-N01–05完整派发条件](../reviews/2026-11-20-core-availability-followup-handoff.md)已列owner、依赖、文件白名单、资源锁及可打假的完成判据。下一批分别为工具合回与Linux资格、P169证据归并及真正剩余矩阵、串行新候选、新30分钟独立复验；当前不宣称它们完成。F61／F62／F63／R-CAV原范围外剩余项继续按各Spec与测试台登记，不从本次局部通过自动收口。

最终代码与正式文档位于持久工作树`/Users/zhangxingchen/Projects/project-lucy/.worktrees/core-availability-followup-20261120`，原inbox/worktree为兼容链接。主工作区另有P168变更，28个受保护dirty文件及HEAD保持不变；没有把二者组合或主工作区demo签为r6已验，没有commit／push／发布／客户变更。


### 后续本地提交授权

委托人在上述交接后明确指令“commit 本任务”。本次据此在`codex/core-availability-followup-20261120`提交本任务实现、合同、台账与原始证据；不合并主工作区、不push、不发布，原正式组合严格FAIL及P169剩余GAP保持不变。前文“没有commit”为当时交接快照，不再解释为当前禁止本地提交。


## 0.30 分支集成登记（2026-11-20）

委托人随后追问为何未合并到0.30，本任务按该意图完成集成：`lucy-v0.30`从7dded547快进包含f865775d，原P168未提交运行／UI代码保留原位；七份共享文档按三方差集合并，P168现值不倒退，其改动不混入本任务提交。后续以主工作区本Plan及对应三台账为入口，原隔离指针和“未合并”为历史时点。

合并后的工作区相关38文件回归首次419／420（单个意外401）、原失败用例单独1／1通过，同源码同参数完整复跑420／420通过；首个失败与原因未确证事实保留。全库TypeScript通过，文档形态／术语／IA／e2e通过；lint:spec因P168原有8条API文档漏项仍失败。详见[集成复核](../reviews/2026-11-20-core-availability-v030-integration-review.md)。未重建Docker、未重跑正式30分钟、未签浏览器或新组合UAT；原正式严格FAIL与剩余矩阵不变，未push或发布。
