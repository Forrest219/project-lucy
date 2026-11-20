# Core Availability Cases

以下为完整矩阵；2026-11-20仅执行[具名局部跑次](runs/2026-11-20-codex-readyz-diagnostic-repro.md)，结果逐项区分。只采用 [fixtures](fixtures.md) 与 [suite](suite.md) 的固定档位、真实性及判定；本次实际runner及范围见suite，未跑分支不得推定通过。

## R0：身份、基线与判定器

`UAT-CAV-R0`：记录镜像digest/SHA/dirty/架构、资源、卷、夹具、原模块可用输入。先验证普通HTTP鉴权读取、现有合法MCP工具和本用例需用的导出/发现路径成功。冻结独立oracle和所有分母；故意错报状态码、漏一个实际执行、伪造计数/成功payload，判定器必须检出。环境错误为BLOCKED，改前目标负例可记FAIL但不得伪造快基线。

## F61：轻探针与后台诊断

| ID | 步骤 | 必须看到的结果 / SC |
|---|---|---|
| UAT-CAV-61-01 | 启动真实实例，记录两端监听与首个ready；隔离计量三路由读配置/SQL/子进程/网络行为 | 请求内I/O=0，未就绪503、就绪200；SC-01／02／09 |
| UAT-CAV-61-02 | 真实限速/延迟诊断文件I/O达到单次≥5秒，保持主服务合法就绪；容器内120秒各1Hz串行轮询livez/readyz | 请求不等collector，全200、各p99≤100ms/max≤500ms；真实I/O未命中则BLOCKED；SC-01／05／08 |
| UAT-CAV-61-03 | 让诊断真实失败，先从首次失败观察到超过30秒，再恢复可读 | 首次失败即保留原采集时间并显示stale，既有data.status语义不变；持续失败仍stale，恢复后下一成功周期fresh；未知不造healthy；SC-03／04 |
| UAT-CAV-61-04 | 采集中改变隔离配置代次，保留迟到任务；再连续10tick、执行close | 旧结果不回填，实际采集器≤1、实际终结后无迟退许可/资源泄漏；SC-05／06／09 |
| UAT-CAV-61-05 | 诊断慢/陈旧期间真实收紧/吊销一个测试身份，再使用另一合法身份恢复读；同期运行不带WebUI Cookie的纯MCP | 被撤回身份拒绝；HTTP及纯MCP `initialize`→`tools/list`→合法轻量数据查询在慢/陈旧和恢复后均成交且结果正确；不把缓存健康当权限；SC-07 |
| UAT-CAV-61-06 | 将三接口与旧字段金样本逐字段比对；进程重启/可控单元时钟边界另附开发证据 | 字段兼容、unknown/null语义和安全字段检查通过；单元时钟证据不冒充UAT；SC-03／09 |

## F62：重任务容量

| ID | 步骤 | 必须看到的结果 / SC |
|---|---|---|
| UAT-CAV-62-01 | 三类真实入口、两个身份发出≥80次提交，包含同身份同类>4等待与全部类别有工作 | 实际running≤2/各类≤1，waiting≤16/身份同类≤4；第一个昂贵操作前已拿许可；SC-01／02／10 |
| UAT-CAV-62-02 | 保持一类迟退任务运行，持续提交另一类；逐个释放真实任务 | 类别轮转/同类FIFO，无双队列死锁；短deadline不被新5秒等待延长；SC-02／04 |
| UAT-CAV-62-03 | 取消waiting、断开running客户端、触发底层超时；另保留已到事务安全点但子进程未退、启动后抛错但工作已受理的反例，记录实际结束与资源关闭时间 | waiting结算；running许可保持到底层真实终结且子进程/DB连接/输出句柄关闭；无重复释放、无隐形超发；SC-03／09 |
| UAT-CAV-62-04 | 任务等待时吊销身份/变更代次；对原合同有回执的操作模拟提交后响应通道真实断开并查原回执 | 不执行已撤回操作/不回填旧结果；已提交事实不被后续撤权改写，执行仅一次且不自动重放；无回执模块不新造job API；SC-05／06 |
| UAT-CAV-62-05 | 捕获饱和429/Retry-After及无副作用；停止压力，再以同一合法输入重试；同时读已鉴权轻接口并运行不带WebUI Cookie的纯MCP | 明确busy、恢复后真实成功；饱和窗内轻接口及纯MCP `initialize`→`tools/list`→合法轻量数据查询成交且结果正确，均不取重任务许可；SC-07／08 |
| UAT-CAV-62-06 | 运行原重建/发现/当前可用导出金样本、Spec174/190独立配额回归；结束所有任务 | 原结果/水位/预算不变；指标守恒，waiting内存不积累；D7未被复活；SC-05／06／09／10 |

## F63：真实进程排空

| ID | 步骤 | 必须看到的结果 / SC |
|---|---|---|
| UAT-CAV-63-01 | 真进程TERM与HTTP/MCP新请求竞争≥100轮，分别记录外部信号、DRAINING确认与原子屏障，不用固定sleep猜时序 | 屏障关闭后0新受理；交接窗及之前已受理请求准确登记；SC-01 |
| UAT-CAV-63-02 | 在途真实依赖查询耗时10秒时TERM；三轮冷启动/排空，同时采样readyz/livez/health及上游PID | 依赖保留至查询终结、结果一次；DRAINING readyz503、livez200至关闭、health原诊断语义不变；原首Ready监听一致；SC-02／03 |
| UAT-CAV-63-03 | 保持空闲SSE，再受理一个业务RPC及一个后台等待项；RPC客户端断开或启动后抛错但底层未结束，重复TERM/INT | 不等空闲SSE；仍等底层工作；等待项不启动且原dirty事实保留；单次清理，无晚到回调复Ready；SC-02／04 |
| UAT-CAV-63-04 | 真实任务持续>20秒；另造原合同有回执的“提交已成功/回包连接断开”与未完成重建 | 截止不伪成功、不自动重放，原回执/恢复状态可查；无回执模块不新造job API；SC-05 |
| UAT-CAV-63-05 | 渲染标准Docker demo配置，并对默认预算、短grace、超长自定义stop超时及supervisor异常分别运行 | 标准demo stop grace≥45秒；正常配置总退出≤40秒且无孤儿；不支持预算组合明确拒绝主张；旧异常退出码/清理正确；SC-06／07／09 |
| UAT-CAV-63-06 | 用原卷重新启动，有原回执的未知写结果先查回执，再完成原合法HTTP主任务及无WebUI Cookie的纯MCP握手/查询 | HTTP主任务及纯MCP `initialize`→`tools/list`→合法轻量数据查询成交且结果正确，权限和水位不变；只读回执无重复副作用；SC-08／09 |

## R-CAV：组合发布取证补充

| ID | 步骤与固定门槛 | 归属 |
|---|---|---|
| UAT-CAV-R-01 | 原20万行/67用户完整审计夹具及慢盘档，同时重建、当前可用导出、批量发现和正常HTTP/MCP；2×/5×重任务提交各120秒，正常请求速率不降低；原模块金样本正确，livez重启稳态p99≤400ms/max≤1000ms、readyz p99≤1500ms；不可用/超时逐项归因，预期429单列 | P1-13组合补充，不作为F61/F62出口；首次升级窗口仍用P1-39已批准的专用门槛，不替换 |
| UAT-CAV-R-02 | 同候选直连与本机真实反代各采集；一个非关键测试数据源真实停服后恢复，另一个独立合法源完成问数；恢复后两者合法调用 | 不因单源失败让整站失去所有可用后端；不跨越全局授权/启动失败边界；实际K8s传播与客户升级归P1-52，真实Agent题库归P1-53／54 |
| UAT-CAV-R-03 | 重任务负载下通过真实TERM排空并原卷重启，记录预期关停503窗口与其外的错误；重启后HTTP/MCP合法成交 | P1-13组合补充；不承诺单副本关停窗零503，不把整段失败从统计中删除 |

R-CAV为新补充剧本，P1-13负责人在候选验证计划中具名选择并授权后执行；不改原P1-13／52／53的SC或其现值。系统级失败只打回被证伪合同。

## R-CAV-FDE-1883：具名持续运行补验

2026-11-20委托人已授权；[具名跑次](runs/2026-11-20-codex-fde-1883-soak.md)独立登记，不代替完整R-01～03。

| ID | 实际步骤 | 验收证据 |
|---|---|---|
| UAT-CAV-FDE-1883-01 | 至少1883张启用表、真实物理表与Manifest三重计数；12身份合法纯MCP与鉴权HTTP持续至少7200秒 | 原始计划／实际数量、全部失败及oracle；不拼接校准轮，不把小查询表行数当配置规模 |
| UAT-CAV-FDE-1883-02 | 每300秒真实改短名、validate／upload、保存启用表、重载KTX并恢复查询 | 至少24个完整周期；保存运行时确认、KTX PID变化、变更后短名可读及4／100查询；全程启用表≥1883 |
| UAT-CAV-FDE-1883-03 | 20万合成历史审计／67用户，持续加入新行并由真实维护器处理 | 明确合成输入；维护关联数在操作窗口实际增加；最终原始行数、唯一有效关联数和水位，未全量收敛则保留GAP／失败 |
| UAT-CAV-FDE-1883-04 | 自然负载采样探针、事件循环、主线程CPU／wchan、原生CPU栈及诊断进程 | 全量自然窗与控制窗分开；livez p99≤400ms／max≤1000ms、readyz p99≤1500ms，超时／非预期503失败；不把滚动最大值或纯I/O等待误称同步CPU阻塞 |
| UAT-CAV-FDE-1883-05 | 自然窗结束后独立真实FIFO诊断I/O控制60秒，只恢复路径后观察新周期，不释放旧句柄凑恢复 | 真正pipe_read、诊断超时与真实子进程退出；探针保持可用、恢复后fresh／合法查询；单列该控制不能作为现场自然复发证据 |

## 2026-11-20 首轮执行映射（历史）

- 61-02的真实慢I/O及SC-08预算通过；61-03的stale/实际I/O释放后恢复子项通过。61-04未全验，但§2.5／SC-05真实停止缺口已证伪；61-05仅合法HTTP/纯MCP路径通过，吊销未跑。61-01／06未全验。
- 62-01／05／06只覆盖真实小数据导出入口与一次429状态，没有80次三类别、实际许可关闭或完整饱和恢复证据；其余未跑。
- 63-02中真实10秒DB在途查询TERM反例为FAIL（故障/无故障共三轮）；63-05仅正常退出smoke；63-06同容器同卷恢复合法路径通过两轮。100轮竞态、完整三轮排空及其余分支未跑。
- R0只做身份/独立oracle与合法入口，不声称判定器全负控通过；R-CAV未执行。

## 2026-11-20 修复复测映射

[最新跑次](runs/2026-11-20-codex-readyz-diagnostic-repair.md)：61-02／SC-08预算通过；61-03自动恢复两轮通过，61-04中真实停止／单在途目标反例通过；61-05仅合法HTTP／纯MCP分支。63-02真实10秒查询TERM三轮通过，63-05实际PID等待及40秒退出预算子项通过，63-06同容器同卷合法恢复三轮通过。完整代次／撤权／reader计数／100轮竞态／长SSE／>20秒及未知写回执等未覆盖项仍GAP。F62和R-CAV不据此改判整套通过。

## R-CAV-FDE-1883收敛映射（2026-11-20）

[正式跑次](runs/2026-11-20-codex-fde-1883-soak.md)按用户59分45秒止测：1883-01局部PASS WITH GAP（规模／合法入口，原2h及速率缺口）；02 FAIL（12次提交重载、8次完整恢复、4次预算503）；03 PASS WITH GAP（真实维护重叠，最终全量核验超时）；04 FAIL（业务503／HTTP超时及长尾，采样影响分列）；05 NOT RUN（用户收敛取消后置控制）。完整矩阵不改PASS，后续18b63d01预算修复未在本候选，不重复打回其独立验收。


## F69：配置热重载在途保护与统一截止

P1-69／REQ-030-090：[功能合同](../../../../specs/lucy-20261120-runtime-reload-drain-spec.md)。当前NOT RUN；不改既有F61／F62／F63及R-CAV结论。

# CA-03：功能SC与真实验收矩阵

状态：设计完成，全部新SC **NOT RUN**；基线7dded5478a05e256aa23d33567b49beb3820ec3b。SC编号属于拟议新功能合同，须M正式登记后才能消费；FUP-04／05只作工程包汇总。默认Docker单实例／纯MCP合法Token，无WebUI Cookie／person／宿主attestation。

| 编号 | 反例／约束生效 | 合法用户／恢复证明 | 必须证据／归属 |
|---|---|---|---|
| SC-01 | 屏障关闭与新RPC并发≥100次，无屏障后的新upstream受理；业务不自动重放 | 屏障前真实10秒查询在授权仍有效条件下只执行一次且结果4／100 | 组件竞态＋真实HTTP/MCP／MySQL sleep已受理标记；原P1-63登记基础不替代本条 |
| SC-02 | 活跃RPC客户端断开、handler启动后抛错、durable response gate未结束时不能提前退票 | 实际upstream与response gate结束后才允许stop；闲置GET/SSE不阻止切换 | 真实句柄／HTTP流回归＋KTX stop时间线，组件测试补边角 |
| SC-03 | 切换新RPC明确HTTP503 EXECUTION_RUNTIME_RELOADING且无数据执行／预算消耗；不设置假恢复时刻 | 同一合法Token无需WebUI可重新initialize→tools/list→原只读问题4／100；吊销者仍拒绝 | 原始MCP回执／预算前后事实／唯一执行计数；所有拒绝保留失败分母 |
| SC-04 | 超过20秒仍有真实RPC：stop请求与KTX PID变化均为0，不能用全局HTTP计数自等 | 旧查询按原合同终结；配置未加载保持stale；原owner可随后显式重载并恢复 | 有限>20秒真实任务、实际PID／通道未发、caller失败＋工作终态分列；不延长查询预算 |
| SC-05 | 总60秒从入口计，直接链排队／前置／drain／stop+端口／start／verify均消费同deadline；各段无重置 | 正常10秒任务＋正常start/verify可完成，轻载probe原预算不退化 | 短override组件截止＋真实默认上界测量；实际子进程close/exit证明；caller超时不能当owner停止 |
| SC-06 | 截止后未消费请求不能迟到stop/start；已消费未真实结束不得释放slot／屏障或再发第二次 | 原requestId真实终态确认后有界撤自己的屏障，原身份恢复；旧回执不得完成新请求 | supervisor真实过期请求、late receipt／busy状态／启动计数；同digest与不同digest均覆盖 |
| SC-07 | 收紧／吊销发生于drain、upstream或response阶段，旧权威代次不能放行 | 未受收紧影响的合法身份仍可恢复原问题；被吊销身份始终拒绝 | 原authorization sequence／response barrier回归＋真实MCP两身份对照 |
| SC-08 | 在drain、stop/start、verify阶段与TERM竞争，TERM后无新reload、无重开SERVING | 原P1-63 drain-first、20／40／45秒预算和重启原卷恢复仍成立 | 实际TERM、Node/KTX PID、退出码及新RPC拒绝；≥3类阶段交错；TERM旧跑次不能代签 |
| SC-09 | 存储不可用、启动失败、核验失败、磁盘digest变化都不伪报current／success、不回滚已保存配置 | 修复路径后同一合法身份重新连接成交；未知写结果按既有回执处理，禁止自动重放 | 进程事实／requestedActualCurrent digest／配置核验分列，原P1-64 ack语义回归 |
| SC-10 | 手动相同digest仍发真实重载；自动重载不能凭无关旧证据吞请求；并发均使用原single-flight | 有效自动写保存与显式重载后新短名读取及普通查询正确；12轮正式周期另归FUP-01 | 自动与手动、同／不同digest、旧会话失效后同身份新会话的真实回执 |
| SC-11 | 无supervisor时自动CLI兜底有相同排空／deadline；显式API仍unsupported且无副作用；能力存在但失败不绕到CLI | 直接模式正常短在途、新准入拒绝和同身份恢复通过 | 直接CLI真实process／HTTP测试＋supervisor Docker对照；TCP成功不能代替配置证据 |
| SC-12 | 所有失败／拒绝／超时／截尾及真实执行中状态有完整记录；组件绿不可冒充真实跑次 | 每个↓补偿都有相同身份／相同问题恢复证据，原FAIL保留 | run记录、原始JSONL、hash、镜像／工具身份、SC逐项判定；未跑标NOT RUN |

## 建议复用的组件回归

在隔离工作树执行：

```sh
cd webui
npx vitest run --maxWorkers=1 server/__tests__/ktx-mcp-reload.test.ts server/__tests__/mcp-runtime-reload.test.ts server/__tests__/source-shortname-runtime-ack.test.ts server/__tests__/mcp-proxy-execution-stale.test.ts server/__tests__/process-drain.test.ts
```

按实现增补MCP-specific barrier／实settle与deadline反例，放既有测试文件或经M允许新增`server/__tests__/mcp-reload-inflight.test.ts`，不批量重写无关测试。

```sh
node --test scripts/runtime/docker-entrypoint.test.mjs
npm --prefix webui run typecheck
```

supervisor截止／过期请求测试应使用真实shell＋可控stub child证明实际终止和无迟到重启；这仍是进程合同组件证据，不能充真实KTX Docker UAT。

## 真实Docker最小跑次序列

1. 正常在途10秒＋自动启用表保存：等数据库实际sleep受理后发保存，原RPC只执行一次、结果正确；保存有真实PID变化／回执和配置核验。
2. 同样在途＋显式手动重载；再发同digest手动重载，必须有独立requestId／实际重启。
3. >20秒实际在途＋重载：排空失败且不停止KTX；原查询依原预算真实终结，之后显式重载成功。
4. 切换窗新纯MCP请求返回结构化503，然后同一Token新会话重试原合法问题；保留拒绝次数与耗时。
5. 吊销身份／缩权与reload交错：旧权限不成交；未受影响身份仍恢复。
6. 真实存储／配置失败、KTX启动失败与核验失败分别留caller结果和actual owner终态；修复后同进程／同卷恢复。
7. 三阶段TERM竞争：排空、启动、核验。证明不会用reload finally重新开放，随后同卷启动原任务恢复。
8. 直接模式真实进程合同对照，supervisor过期请求／迟到回执另测。所有镜像与运行代码hash匹配同候选。

1883表3600秒12完整周期、固定到达吞吐／探针重档、审计完整闭包及诊断FIFO只恢复路径归CA-08／FUP-01–06；该组合跑次不是单条功能合同全部出口的替代品。

## 浏览器触发判据

若本实现仅新增MCP服务器503与内部生命周期、页面／保存反馈完全未改，不强制浏览器。若修改TableWhitelist、CreateConnectionDrawer、Toast、错误交互或新的reload状态可见字段，必须真实前台浏览器＋导航/primaryReady和保存动作即时计时，与API耗时分列；缺失就不能签相应用户可见面PASS。移动窄屏不在本轮范围。


## F70：正常语义写入有界等待（NOT RUN）

[Spec](../../../../specs/lucy-20261120-semantic-read-write-settle-spec.md) SC-01–08：真实写／镜像阶段等待与首次执行；固定20秒及原剩余截止；孤儿／失败关闭和同身份恢复；files_saved阶段准确性；ACL／代次复核；TERM／断连／reload无自等；后继owner不延长；1883表短校准后30分钟12周期。用真实文件/WAL、实际owner和实际SQL／预算／审计核对；组件绿不代签Docker或完整矩阵。
