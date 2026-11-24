# Run — 2026-11-19 — Codex P1-57 修复复验

> **后续D7范围裁决（2026-11-19，非新跑次）**：用户已明确延期正式完整导出；本跑次原完整范围实测FAIL、FIX-01 FAIL均不改。当前可按排除正式完整导出的范围进行客户功能测试，D6不实施。下文原“不能交客户测试”为延期决定前的判断，现准入见末尾§9及[Plan §13](../../../../../plans/lucy-20261119-fde-acceptance-remediation-plan.md)。

| 元数据 | 本轮事实 |
|---|---|
| Suite／总账 | UAT-SUITE-FDE-PACKCHECK；修复模式 UAT-FDE-FIX-*；P1-57／REQ-030-078 |
| 授权 | 委托人明确确认D1–D5、Task1–7；先全真、无法自然构造再按D5受控降级。D4要求新实例基线仍失败时回设计，本轮没有扩修该初始化路径 |
| 整套判定 | **FAIL；不能回复“全部阻塞已修复、可交客户测试”**。两处表读取功能阻塞已修复；新建正常初始化实例的正式complete CSV／ZIP仍失败，G6开放 |
| 产品候选 | ff8e9c0523e0263629898cc618109152a85848bb；包含运行修复提交2e02d367；干净独立checkout，health gitDirty=false |
| 镜像 | project-lucy:p157-ff8e9c05；sha256:b19486c2c3b928451846848962d3bcf7ce0a92e3ab83683a8e894636e45d5f69；arm64本机Docker |
| 构建边界 | 内部UAT缓存构建：基镜像08be21d3…，两份锁文件逐字节相同；覆盖完整干净源码并重建WebUI。不是客户发布镜像；未出包、推送、合并或修改KTX |
| 隔离入口 | WebUI http://127.0.0.1:55457；MCP http://127.0.0.1:58057/mcp；临时冷启动端口由各测程分配 |
| 身份对账 | identity.json记录10处镜像文件与干净ff8e9c05源码哈希一致。后续验收测程在宿主运行／只读挂载，最终测程SHA 77beab0f0fe6139c83114fce27dcb0beef465205，哈希见harness-identity.json；产品运行模块未再改变 |
| 凭据 | 随机测试管理员／引导密钥保存在仓库外0700目录、0600文件；口令、token、cookie不写入本跑次或inbox |
| 证据 | inbox/uat-p157-20261119/及对应uat-rebuild-probe-budget、uat-cold-start、uat-inferred-rebuild-recovery目录；均为过程证据，不是客户制品 |

## 1. 正式修复模式用例

本轮使用已确认D3的新修复身份门禁；不覆盖旧3b1c62af／三基线复现模式及历史BLOCKED。下表中的受控降级已经D5明示授权，但不记为全真客户驱动验证。

| Case | 判定 | 实际证据及边界 |
|---|---|---|
| FIX-R0 | PASS | 干净完整候选、固定image ID、health、架构及运行文件哈希对账；所有写入限隔离UAT夹具 |
| FIX-R1 | PASS（登记与映射） | R1／R2／G1–G9／SK1–SK4均落总账及对应验收；四个原skip保留且不计行为PASS，见§5 |
| FIX-01 | FAIL | 全新卷正常bootstrap、真实MCP成交后，complete CSV和ZIP均409；projectionComplete=true、lagMs=0仍缺as-of-S证明基线。没有补假基线或用diagnostic替代 |
| FIX-02 | PASS（受控降级D5） | 真Hive自然DESC读60列；指定首两语法拒绝及延迟后，第三合法语法真实读60列，7325ms；真实单语句超时8019ms后400；关代理后连接失败对照仍拒绝 |
| FIX-03 | PASS（受控降级D5） | 真实HTTP200披露deferred；实际客户端两次单表无进展后汇总失败，继续读另一张真实Hive表30列；各响应约10秒，最慢10021ms |
| FIX-04 | PASS（混合权限为D5） | 真实MySQL50×400全部读完，自然速度1请求约1.25秒、20000字段；延迟变体6请求、最慢12136ms；30表权限场景35请求，单表t0真实HTTP400后其余29表／290字段齐，最终仅汇总t0 |
| FIX-05 | PASS | 当前镜像完整entrypoint、实际管理员登录；默认后台与既有读时重建开关两路径各真实等待35秒，正式详情与调用流水HTTP返回编号一致，3调用保留。另有直接函数组件对照 |
| FIX-06 | PASS（真实SQL＋延迟） | 真实MyISAM600表，前50×1500＋550×30，91500字段全齐，154请求；50→25→13→7→4缩批；最慢12243ms，无固定100请求中止。注入与恢复耗时分列，未放宽正常60秒合同 |
| FIX-07 | PASS | 完整推断夹具默认3/3，含3163行原用户闭包完整收敛；同窗已鉴权业务请求、IRR真实SIGKILL及COLD R0／01–05全部通过，见§4 |
| FIX-08 | PASS | 纯MCP initialize、tools/list、lucy_query真实成交；instructions长度8447，按region汇总4行与demo金样本完全一致 |

## 2. 源码修复与L1检出证据

- R1：保留普通单表400／READ_FAILED／原文案。只有实际服务端表级终态拒绝、合法白名单scope／表名／reason才可继续；错误细节不泄露SQL／driver stderr。客户端仅在本次单表匹配时汇总该表，平台鉴权、stale、未知错误、连接／网络故障继续失败关闭。
- R2：去掉全局100次请求上限。终态减少pending、无终态严格缩批、同一单表最多两次deferred；对返回集合做无遗漏、无重复归属、无越界的精确划分验证；只累计实际产出字段和唯一终态。
- d8c3f097原断言2红／1绿；修复后原3条业务断言绿。原FDE测试直接调用preview而未模拟HTTP错误封装，本轮只加SchemaStructureError→ApiError的传输适配，业务断言不改；另有真实Fastify／实际error handler／实际客户端HTTP串接守卫。
- LS-19连续50→25→13三次截断树及每响应≤20秒在L1用虚拟SQL时钟检出；50×400精确20000字段、≤100请求。真实MySQL的10000行上限下，50、25整批deferred，13批出现终态；不能把它写成三次真实SQL截断。
- SC-12真实详情与流水编号；SC-15既有跨界问询及关联；SC-16逐ID页读取集合、闭包外对象逐行不变、编号与页／片预算均补齐。L1满量200102行／69用户，未给所有L1行填4KB负载；带负载的真实完整快照另由Docker验证。
- N26-6捕获S成本、首次投影读取成本、重试不后移截止均有检出；故意把起点移到S之后的局部mutation使4条断言红，随后恢复。原FDE一个it内CSV／ZIP各6变体（共12场景）在当前源码重放通过；不当作12条Vitest测试，不当作真实导出UAT。
- LS-24测试直接import实际runner使用的共享judge，删除副本；全deferred／零列／缺表／permission／HTTP错误不能变成PASS。真实跑次还发现旧runner把Hive30列期望误用于MySQL10列夹具，按既有合同纠正后全套R0／01…10通过，规模未降低。

门禁：Node22整轮含pretest，532文件、6600通过、4具名skip；根合同409/409、CI合同62/62。本地CI合同不等于远端CI job。typecheck当前37条存量，新增0条；已移除前轮新增BackupOptions.attached诊断，未声称typecheck全绿。文档及三台账门禁以本次最终日志为准。

## 3. 全真尝试与D5受控降级

自然权限尝试：临时MySQL用户只获t1…t29 SELECT。information_schema隐藏t0，单表接口为missing，不能自然触发“名称已解析、字段SQL权限拒绝”的分支。因此仅对指定t0相关字段SQL注入1142权限拒绝与延迟；29张合法表字段均透传真实数据库。未注入成功字段、truncated、HTTP或客户端结果。

自然方言尝试：实验室Doris→Hive的DESC直接成功读60列，不能自然触发前两语法慢拒绝。因此仅指定测试表的DESC／SHOW COLUMNS注入1064语法拒绝及固定延迟，第三合法语法透传真实Hive。单语句超时、共享预算deferred与关闭代理对照均走真实HTTP／实际客户端。

wire和attempts记录规则命中。命中记录代表收到的SQL尝试，含随后被预算取消者，不能等同于已经发出的错误包次数。临时账号、连接和代理撤除；不据此宣称客户生产SelectDB兼容已经验证。

## 4. 满量、探针与中断恢复

最终只认 full-2／full-3／full-4 三个有效默认跑次；full-1因测程seed程序语法失败未开始验收，修正后重跑。初次严格IRR因测程缺import未运行到SIGKILL，修正后的strict-final才计通过。所有失败／无效记录保留，不覆盖、不同源码数量累加。

旧种子随真实时间滑出30天窗口。补量时只在隔离工作副本追加9723条带相同负载的真实合成调用，不重写原时间戳、不增加运行时lookback、不手写推断关联。原始总数209723；首个有效跑次前窗口内200992条均唯一有效关联、67用户完成、水位覆盖。每次复用前重新检查当前窗口仍≥20万且关联齐备。原始旧快照987844608字节（约942MiB）；补量后规模升高。Docker4CPU、VM8GiB，读写30MB/s、读300／写100IOPS，默认维护器开启，清页缓存后独立冷启动。

- G7：旧RPB-03测程仅查未鉴权readyz，不能当同窗业务请求。本轮已改为至少50次真实已鉴权项目请求，记录code／max／p99。
- G8：旧IRR-02未杀到进程时用人工in_progress残留兜底；它不证明SIGKILL。严格测程必须观测真实部分关联后kill、退出137、同卷默认维护器完整恢复。R0实际SQL失败也不得判绿。
- G9：第一次预迁移固定等60秒后仅183433/200000关联，64用户complete。其后的探针／小目标闭包观察保留，但全部不计完整推断夹具PASS。守卫要求67原用户complete、水位覆盖、当前30天窗口内至少20万调用全部唯一有效关联后才能开始正式重跑；不把滑出窗口的旧调用强行补归属。
- 首个大用户变体在有界补查后仍in_progress（最后1949/3020关联），不计PASS；完整夹具重跑包含同一大用户目标，并保留原120秒探针窗口，另等后台真正完成，不放宽响应阈值。


### 完整夹具与探针实际值

| 跑次 | 窗口内已完整关联（预热前置） | 目标闭包 | Ready秒 | livez max／p99 ms | readyz p99 ms | 同窗业务请求 | 页／片最大 |
|---|---|---|---|---|---|---|---|
| full-2 | 200992，pending=0 | 161条／50级，完成 | 28.3 | 12／10 | 15 | 118次全200，max 9ms | 400／8 |
| full-3 | 200978，pending=0 | 3163条／50级，完成 | 32.3 | 20／16 | 14 | 117次全200，max 123ms | 400／2 |
| full-4 | 200938，pending=0 | 161条／50级，完成 | 34.8 | 93／59 | 25 | 117次全200，max 15ms | 400／8 |

三轮客户3秒观察器连续失败均0，livez≥1.5秒比例均0，health无degraded；全200。每轮闭包读取总数与精确关联集合吻合、重复0、原编号沿用、闭包外既有问询／关联hash保持；写片实际off-thread，页≤400、片≤8。大用户后台允许继续收敛，未修改120秒探针采样窗口。

严格IRR：真实20000调用，观测255条关联已提交时发SIGKILL；进程退出137、非OOM，停机后实际持久407条、in_progress；同卷重启后20000条全部关联、20000问询、无重复／悬空，readyz=200。没有人工in_progress兜底。IRR-04保留实际十进制水位120，重启前后完成时间、水位和120条完整关联完全不变，不再只比较问询条数。

COLD：R0／01–05全PASS。对照0.25.0约29.8秒就绪；新候选首次升级111.3秒就绪，livez max210／p99 202ms；已迁移重启31.5秒就绪，max8／p99 7ms；缓存冲刷max7／p99 7ms；合法管理员认领、项目读取、角色／Agent／token创建、MCP握手与tools/list均成交。COLD准备使用60秒预迁移，不拿它证明RPB完整推断；RPB另有上述完整性守卫。

暂停安全带单独PASS：满量前置同样通过；RPB-05／06／07通过，MCP循环成功、paused=true且complete=false。暂停不计默认三轮。可选K8s EndpointSlice不是本次Docker功能验收范围。

## 5. 剩余四个skip的承接

| 子项 | 本轮处理 | 不能声称 |
|---|---|---|
| SK1 旧结果读取形状 | 保留skip；P1-39／47当前性能承诺用完整真实探针复验，具体旧结果分页实现仍由该合同负责人承接 | 旧SQL页形状断言已执行 |
| SK2 单片恢复增长 | 保留skip；现合同允许MIN1／INITIAL2／MAX8，未授权改1→1策略 | 已恢复该特定增长行为 |
| SK3 covered-user SQL形状 | 保留skip；P1-50现合同为读快照ceilingId与完成水位一致，相关race／恢复守卫及严格IRR另证 | 已移植watermark_id或证明特定SQL扫描形状 |
| SK4 ≤32 mutation chunk | 保留skip；不把同事实现阈值冒充本线合同，不擅改现off-thread链接写入策略 | ≤32已验证或旧断言已通过 |

原空关联count=0的rolling测试已删除，指向真实SC-11–16。四个skip的行为都未被登记“洗绿”，责任继续挂P1-57-SK1–SK4／原合同维护方。

## 6. 正式导出阻塞与D4设计返回

新实例从正常初始化开始，MCP真实成交后complete CSV和ZIP均409 `EXPORT_FAILED / integrity_or_relation_failed`；diagnostic仅用于定位，projectionComplete=true、lagMs=0、scopeComplete=false、combinedComplete=false，只读证明器缺失集合指向attribution_journal_baseline_unknown。没有篡改基线、回填历史或放宽完整性。

源码路径：index.ts先warmAuditDatabases、后buildProxy；首次audit.getDb尝试基线时ledgerSeqResolver尚未装配，解析为null；后续缓存连接直接返回，不再尝试基线。不是F01的lag误拒，也不能用更多投影等待掩盖。

按照已确认D4，G6保持开放，回到整改Plan §11的D6设计裁决：先装配真实解析器并在首条事实前形成可证明基线，明确空新实例、旧实例缺证、重启及事务边界，保留失败关闭。D1–D5不推定为D6扩修授权。

## 7. 给FDE的结论

可以反馈：混合权限中止与600表请求上限两处功能缺陷已修复，已给出明确候选及真实数据库复验；验收测程的假绿风险也已补录纠正。

**目前不能反馈“全部阻塞已清、可交客户测试”。** 正式完整导出在正常新实例仍失败。待G6设计／修复及正式导出复验通过，再按测试台重新判断。功能合同、UAT与发布取证分开；本跑次不评价客户部署制品。


## 8. 复查入口与验收矩阵

- 主测程：scripts/uat/fde-fix-retest.mts；完整HTTP滚动：scripts/uat/fde-rolling-http.mjs。
- 正常规模：run-large-schema-ingestion.mts；真实延迟／权限规则及attempts／wire见live、hive-live。
- RPB：rebuild-probe-budget.mjs all --image project-lucy:p157-ff8e9c05 --crossing-fixture；大用户另加--crossing-existing-user --crossing-check-count 900；UAT_RPB_CPUS=4。守卫自动补齐当前窗口规模并等待真实物化完成，失败停表。
- IRR：inferred-rebuild-recovery.mjs all，实际SIGKILL子测程inferred-rebuild-real-kill.mjs；COLD：cold-start-slow-disk.mjs all。均保持原Spec阈值。
- AR-01…07、AR-10本轮证据满足；AR-08身份通过但正式导出FAIL，AR-09因必做FIX-01 FAIL而不满足。因此整体FAIL，不能交客户测试。
- 无效／未完成跑次、沙箱端口限制跑次、测程自身启动错误均保留过程日志，不当作产品回归失败，也不算PASS。正常SQLite状态和正式导出失败均未被人工改绿。


自然速度50×400附证：normal-wide.json，50表／20000字段，1请求，HTTP约384.7ms、全客户端约1253.9ms；无代理／延迟／SQL拒绝。完整HTTP滚动脚本结束后原默认容器已恢复，两个合成用户调用及推断记录已清理。

结束前复查：默认隔离实例health／readyz200，候选ff8e9c05／gitDirty=false；临时连接均已撤除，仅demo-mysql／lucy-ops，滚动合成行0、原4条MCP调用仍在，as-of基线仍为空，正式CSV／ZIP再次409。原demo仍为原3b1c62af-dirty身份，未替换。取证后清理本轮临时容器，专用合成夹具卷及仓库外私有重现凭据保留；没有修改真实demo审计库。


## 9. D7延期与当前客户测试范围（后续决策注，非重新执行）

委托人原话：“这个可以先不修，未来再修”。正式完整导出409／证明基线缺失作为已知缺陷延期，待另行安排；不关闭G6，不改运行完整性门槛，不启动D6。

当前结论：本轮已验证候选ff8e9c05的两处表读取阻塞已修复，其余本轮必做证据有效；客户可进行排除正式完整CSV／ZIP导出的功能测试。客户须知该能力仍不可用，diagnostic不等于正式完整取证。此项延期不表示原完整范围UAT变成PASS，也不表示客户部署包已发布或可上线。

没有新增代码、Docker或运行验证；沿用本跑次真实数据及D5边界。恢复该项时按原FIX-01成功／失败关闭标准重新验证，真实通过后再关闭。当前台账与范围事实源为[整改Plan §13](../../../../../plans/lucy-20261119-fde-acceptance-remediation-plan.md)。
