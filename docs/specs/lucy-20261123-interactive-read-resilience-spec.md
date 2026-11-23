# MCP 握手与 Agent 名册读取长尾治理 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.2 |
| 日期 / 产品线 | 2026-11-23 / 0.30.0（`lucy-v0.30`） |
| 功能编号 | P1-75／REQ-030-096（拟 P1，不入核心分母） |
| 台账号 | 无 |
| 阶段 | S3 |
| 状态 | S3｜实现进行中（A1／A2 单元＋复审 PASS；A3 判定器 24/24；demo 镜像已含改动）。正式 G1 R0–07／G2 与多页面必做回归尚未封存跑次；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 2026-11-23 委托人批准修订 Spec、UAT 与并行任务；同日明示「完成落地和测试」＝运行代码＋测程开发授权。正式 UAT／INDEX 登记仍须实测回执。 |
| 需求 / 验收 | [总账 P1-75](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [REQ-030-096](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-096mcp-握手与-agent-名册读取长尾治理) · [UAT-SUITE-INTERACTIVE-READ-RESILIENCE](../qa/uat/suites/interactive-read-resilience/suite.md) |
| 配对计划／评审 | [修复与复现 Plan](../plans/lucy-20261123-interactive-read-resilience-plan.md) · [初审](../reviews/2026-11-23-p1-75-interactive-read-resilience-adversarial-review.md) · [Codex 复审及定稿处理](../reviews/2026-11-23-p1-75-interactive-read-resilience-codex-review.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：在冻结的 Docker 档位内，纯备注保存期间独立治理会话能打开一致的 Agent 名册，保存确认后首读见到新备注。概览、语义资产、Agent 名册和角色权限正常冷读可用，共享快照局部故障时受影响区域能明确报告错误并限时恢复。合法纯 MCP 客户端在预算内完成建连、发现并取得正确查询结果，动态指引等待超线时仍有基础指引和查询路径。
- 本条出口：SC-01–08 全部必做，覆盖真实前台、纯 MCP 正负例、局部故障、同一 Lucy 进程内 50 路握手和问数与名册保存重叠，以及四页共享读取回归。判定使用 [冻结的 UAT 用例和夹具](../qa/uat/suites/interactive-read-resilience/cases.md)。
- 不在本条出口：P1-66 原档冷读性能全矩阵、FUP-03 重档及 P1-13／R-CAV 长时组合、整库旅程、宿主 Agent 全套兼容、现场归因和升级交付。相关历史失败、诊断对照和发布取证单列。
- 上线关系：本条收口不表示可上线。

## 1. 现场证据与待验证假设

| 证据 | 已知事实 | 尚待验证 |
|---|---|---|
| 2026-11-23 现场名册复现 | Lucy `322438a2`。完整名册 `view=roster` 三次返回 `DISPLAY_SNAPSHOT_BUSY`。客户端 TTFB 6.03–8.26 秒，服务端 `total` 2.26–3.51 秒，均记录 `builds=0`。同窗一次事件循环 P99 为 1.76 秒。 | 原浏览器请求的完整 URL、摘要投影是否同样复现、快照 `busy` 具体原因、服务端计时外的等待归属。`builds=0` 只说明该请求未启动构建。 |
| 2026-11-23 现场握手审计复查 | 原窗口 14:20–14:50（北京时间）使用 `includeProtocol=true&accessGrade=all` 查询到 16 条 `initialize`，中位 26.8 秒，5 条超过 30 秒。另有三条 `lucy_catalog` 耗时 77–87 秒。 | 客户端日志与候选的精确对应、客户端是否及时收到响应。`access_log.ts` 接近响应结束，估算开始应减去 `durationMs`，RPC request id 可复用。 |
| 2026-11-23 第二轮阶段取证 | 四条慢握手的 `upstream_handshake` 在 4–657 ms 返回响应头。根阶段并集之外只剩 0–2 ms，未发现这四条存在响应体读取长尾。`instructions_build` 为 26.552–43.291 秒，其中 `catalog_resolve` 16.581–28.885 秒、`skills_load` 7.918–13.957 秒，两项合计占各自全调用 92.9%–95.5%。指引内另有 1.28–1.93 秒未分段，几乎都在目录读取前。三条独立 `lucy_catalog` 只有覆盖全调用的根阶段，收尾的 `local_handler` 记为 0。 | 诊断导出只用于已匹配的七条调用。阶段墙钟无法分解文件 I/O、ACL 计算或事件循环调度。独立 `lucy_catalog` 仍需在真实目录调用前后计时。其它样本的响应体、握手与名册的同实例关系以及客户端断开原因待核实。 |
| 2026-11-23 20:37 现场字节采样 | 管理 API 核验 24／26 份 Manifest，合计 6,482,102 字节，最大 2,347,590 字节。7 份成功解析的已发布 Skill 合计 43,463 字节，最大 9,464 字节。 | 这是事故后的已核验文件样本。未核验的 Manifest、逐连接 Overlay 和全部 Skill 候选文件统计仍待补采，事故时内容版本未确定。用于校准字节数与分布对照。 |
| 2026-11-23 FDE 管理站只读调查 | 现场 `322438a2`。概览系统状态、待处理事项以及语义资产、Agent 名册、角色权限出现读取异常，已登录 `/api/sources` 回显 `DISPLAY_SNAPSHOT_BUSY`。追加 9 次公共探针全为 HTTP 200，客户端耗时 490–4725 ms。三次健康响应的事件循环 P99 为 2324–2579 ms。 | 未取得失败业务请求的 HAR、状态行或快照内部原因。浏览器中止、服务端报忙、事件循环停顿、并发写入须分别取证。本次调查未执行写入和纯 MCP 问数。 |
| 全局规模 Docker 定向基线 | 同构 `322438a2`，500 Agent／200 正式角色／合成 `demo_readonly` 可见 1,403 个 Source。两轮正式 Agent 备注写入期间都出现摘要 `DISPLAY_SNAPSHOT_BUSY`。最终样本 `permissions` 1,432.5 ms，`builds=0`，同次重试成功。200 次顺序和 20 路并发只采握手，20 路 P50 为 1.578 s。写入同窗 4 条完整旅程正确，握手最长 5.433 s。 | 正式 `lucy_admin`、改前改后逐连接查询、正式变更窗和 50 路负载均需另跑。`busy` 分支和共享阻塞点待分段验证。现场数十秒长尾未在该跑次复现。[定向跑次](../qa/uat/suites/interactive-read-resilience/runs/2026-11-23-kscc-global-baseline.md) |
| 既有 Docker 证据 | [P1-37](lucy-20261116-mcp-ux-resilience-spec.md) 的宽目录 UAT 使用单连接。[P1-66](lucy-20261120-agent-roster-summary-projection-spec.md) 完整矩阵保留冷读失败。[核心可用性正式跑次](../qa/uat/suites/core-availability/runs/2026-11-22-kscc-cav-formal.md) 在重档上测到直连 `livez` 最大 1.215 秒并判失败。 | 两条用户路径和探针同窗时，冷热态、配置变更、资源压力与实际常驻工作各有多少贡献。 |

四条握手优先缩短 Lucy 本地指引中的目录与 Skill 阶段。`skills_load` 包含文件扫描、权限过滤与上下文快照解析，需分别量化。上游完整响应保留作诊断对照。WebUI 与 MCP 共用的事件循环提供了共同延迟的解释，但现场证据尚不能把两个症状归到同一热点。目录描述命中仍可能扫目录和逐文件核验元数据。名册展示快照核验依赖按时完成的协调工作。两条路径需要分别证明改善。

## 2. 修复合同

### 2.1 名册在正式备注保存期间持续可用

保存继续走正式发布协调、版本校验、持久审计和真实运行态确认。先准备可独立计算的输入，进入当前发布资格后重读基线，按完整候选和当前配置的实际语义差异分类。只有确证只改备注、存在已核验的完整已提交名册、授权依赖仍等价，才能打开写中的读取路径。等价核验覆盖项目、Agent／角色／凭据／状态、有效策略、来源映射、已启用表、工具分类、行策略和恢复状态。维持既有锁顺序、外部文件新鲜性边界和失效纪律。

写中仅向有权访问的独立治理会话提供一份一致的摘要。备注和配置版本、权限摘要及关联代次均来自同一份已提交视图。读取在响应前重验视图、读取身份和授权依赖，已知授权或内容输入变化、混合 PATCH、范围未核验、无已提交视图或恢复未确认时进入既有核验路径。真正授权变化开始前同步撤下读中可用视图，不能将未提交的新配置与旧权限拼接。写失败只在回滚可核验后恢复合法读取。

写入成功以对应修订已持久化、运行态确认及审计终态成立为准。对纯备注，名册的已提交视图在保存成功回包前发布，写后首读见该视图或后来已提交的一致版本。测试固定后续写入顺序，以核对本次新备注。允许如实反映更新审计时间及后续业务统计。`after.agent`、对象版本、配置版本及幂等回执绑定本次提交；可由已捕获事实生成的投影移出屏障。发起保存的浏览器沿用原写入代次与写后刷新；独立观察会话专测写中可用性。正常读和纯备注保存期间的合法名册首响应须为 200，首个 503 记失败。现有权限失效、撤权、回滚、错误与重试语义继续适用。真实授权切换或快照暂不可核验时，恢复条件成立后同一进程须在 UAT 冻结时限内恢复合法读取。正常组沿用既有 1.5 秒请求内恢复等待上限，受控长提交以写中首响应实际成交验收。

### 2.2 MCP 指引开销与超时降级

握手按请求取得授权后的连接、Source 四元组和已裁剪的示例。第一项单变量对照把握手不消费的描述增强移出应答路径，独立 `lucy_catalog` 保持描述、grain、列暴露与异常合同。对照核验完整动态指引的内容、顺序和作用域。Skill 仍按当前身份执行发现授权。首轮沿用现有描述索引，新增跨请求权限、指引或文件解析复用另议。若既定改动不足以达标，保留失败和阶段证据，回到设计复审。

从 Lucy 接受该 `initialize` 起，用单调时钟记 **1 秒动态指引决策截止**。上游握手和会话继续按既有协议处理。发送任何成功响应前重验请求身份和会话边界。完整指引还须在截止前通过当前授权及输入代次核验。在具备合法成功应答前提下，到点、动态构建失败或本地构建容量已满时使用进程预先装载的 Lucy 基础指引。基础指引提供按实际可见工具发现、查询与 Skill 读取的方法，包含核心问数规则，无角色化连接、Source 或 Skill 名单。保持现有问询上报与工具可见性边界。既有本地协议回退也走同一指引决策。慢上游响应头／响应体按原协议单独验证，1 秒决策线仅约束动态指引。

动态任务在进入昂贵工作前取有界执行容量，每实例同时运行上限 20，无等待任务队列。截止或断开后取消可取消工作，在发布结果前复核请求仍有效；实际工作终结前继续占用容量。迟到的任务只结算阶段和资源，禁止覆盖本次响应或发布旧指引。候选在冻结档位必须守住客户端完整响应和首次查询总时限，正常暖态握手组需完整指引。降级组须证明纯 MCP 用现有工具完成合法查询，且收窄后的旧会话、新会话和发现入口均遵守当前权限。账面分开记录完整指引、基础指引、客户端失败和底层退出。

完整指引与预载基础指引复用同一份静态核心问数规则。基础指引覆盖动态超时、容量满、构建失败和既有本地协议回退。握手只下发规则与本条约定的可见范围，业务 Wiki／Skill 的按题检索与正文读取由问询阶段执行。保留完整指引已有的授权 Skill 发现清单。

### 2.3 观测与证据边界

按请求关联读写阶段、内部 `busy` 理由、首响应、重试、代次和真实终态。目录测到实际闭包，区分权限投影、扫描／文件核验、读取／解析、描述增强与序列化。Skill 分开记录扫描读取、解析和上下文 ACL。客户端完整响应、上游响应头与响应体以及可测的排队／调度等待分开。用同候选开关对照核对观测自身开销，逐请求记录脱敏的数量、命中、时间与代次摘要。

正式 `lucy_admin` 用于全局档和四档目录对照，受限身份承担撤权及隔离校验。以已核验字节量和分布校准合成负载，各窗按 [夹具](../qa/uat/suites/interactive-read-resilience/fixtures.md) 核对实际可见范围。P1-66 的既有冷读失败和 FUP-03 的重档探针反例保留在原档，独立于本条局部冷读和探针门槛。当前 Agent 页的摘要入口和旧完整接口分别取证。现场完整名册发起者、成功下载耗时与客户握手长尾继续作为事故归因线索。

### 2.4 多页面共享读取回归

在同一候选上验证概览、语义资产、Agent 名册和角色权限的真实前台读取。正常无写冷读必须交付正确业务内容。局部故障明确区分按作用域核验变慢和快照构建等待变慢；只允许已受影响的依赖在其浏览器读取截止前返回明确的可重试错误。其余依赖、探针及合法纯 MCP 在各自预算内完成。故障解除后无需重启，按 UAT 时限恢复正确内容。健康状态、首响应、浏览器中止、重试及页面就绪独立判定。若达不到目标，按证据定位共享快照路径后复审修复方案。

## 核心流程（伪代码）

~~~text
saveAgent(request):
  prepare independent work and acquire existing publish and write guards in their order
  recheck current actor, versions and actual delta against persisted inputs
  if only the note changed and the committed view and authorization inputs verify:
    make that committed view eligible for independent roster readers
  else:
    withdraw any read eligibility and follow the existing policy change path
  persist, verify the actual runtime revision, and record durable audit terminal
  on failure withdraw eligibility, then use existing rollback or recovery gate
  on success publish the verified view, capture the committed response, then acknowledge

readAgentRoster(request):
  authorize this request and select one verified committed revision
  during a write select only an eligible note-only view, or use the normal bounded read
  verify current authorization, input freshness and view eligibility before responding
  bind the whole response to the selected revision, or report the existing retryable failure

initialize(request):
  set dynamic deadline from monotonic ingress time
  use existing handshake transport and session ownership rules
  if not eligible for successful response, return existing protocol outcome
  if time remains and a work permit is obtained:
    start full instructions from current authorized catalog facts and Skill discovery
    wait for completion, absolute deadline or disconnect, whichever comes first
    on deadline or disconnect stop awaiting and request cancellation
    release the permit only on actual work termination
  if disconnected, settle cancellation without writing a response
  else if identity, ownership or eligibility fail recheck, use existing outcome
  else if full instructions have a current proof before deadline, send them once
  else send preloaded basic instructions once
~~~

## 3. 验收

| 编号 | 可打假检查 | UAT |
|---|---|---|
| SC-01 | 冻结构建、夹具、身份和结果核对值。按请求复算阶段、客户端总耗时、首失败、重试、迟到和真实底层终态。详细观测开关对照满足约定开销和容量，产物脱敏。 | UAT-READ-RES-R0／01 |
| SC-02 | 正式 `lucy_admin` 与受限身份从无 WebUI 会话的纯 MCP 入口按冻结矩阵完成建连和真实查询。逐连接比对启用 Source、两条独立连接查询结果和默认 `lucy-ops` 排除。200 顺序和 20 并发分别保留 P1-37 门槛（P50 ≤ 200 ms、P99 ≤ 2 s、无 >30 s），正式政策变更窗保留 P99 ≤ 5 s、无 >30 s。冷态、独立 `lucy_catalog` 与首次查数另按用例预算。 | UAT-READ-RES-02 |
| SC-03 | 慢动态构建、取消和容量满时，基础指引下仍有合规的发现与查询。至少一个真实宿主用自然问题完成这条旅程。验证新旧会话、在途授权变化、外部输入变化和合法重连。响应至多一次，迟到及并发任务不会产生错代输出或残留容量。 | UAT-READ-RES-03 |
| SC-04 | 在全局档真实前台测无写热态、服务端构建或代次失效首读、自然备注写中和受控长提交写中。独立观察者首响应成功且页面显示一致名册，受控组在屏障解除前看见旧备注，保存确认后首个读取见对应新备注。原完整接口、统计和详情语义照常核对，字段及表现按对应组判定。 | UAT-READ-RES-04 |
| SC-05 | 快照不能核验时保留现有错误和重试，恢复无需重启。对照真正撤权、混合 PATCH、并发冲突、响应丢失与幂等、持久化／运行态确认／审计终态失败。验证终态和回执绑定本次提交，无假成功、错代、重复提交或假空态，未受影响用户仍成交。 | UAT-READ-RES-05 |
| SC-06 | 同一候选 G1 局部负载中，直连及反代探针和普通鉴权读在冻结预算内正确响应，同时合法 MCP 继续成交。等待、取消和实际工作容量可核对，故障解除后读恢复；与 FUP-03 历史重档判定分列。 | UAT-READ-RES-06 |
| SC-07 | 三个自然窗都达到规定的 50 路握手及 50 路独立真实问数，有效写入、名册请求和查询在途重叠。真实前台用同账号独立会话核对成功保存、冲突后成交、首响应与写后版本。按角色检查每个结果及授权变化。 | UAT-READ-RES-07 |
| SC-08 | 在无配置写入的冷读及受控共享核验／构建慢窗，逐页核对概览、语义资产、Agent 名册、角色权限的首响应、正确业务内容及限时恢复。区分正常首读、具名受影响依赖的可重试错误和独立控制；同窗探针及纯 MCP 仍守原预算。 | [UAT-READ-RES-08](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-08) |

## 4. 阶段安排

1. 以[历史全局规模跑次](../qa/uat/suites/interactive-read-resilience/runs/2026-11-23-kscc-global-baseline.md)作为已知反例，用正式身份和新测程冻结可比 A/B。先校验测程和阶段归因，再做名册与 MCP 单变量候选。
2. 用同一 P1-75 候选跑 G1 的局部用例、多页面回归和 G2 的 50 路同窗用例。首失败、恢复和不完整样本独立记账，SC-01–08 通过后冻结该候选，供 P1-77 性能对照使用。
3. 后续按现场请求、角色和输入分布补充事故归因对照。长时组合和升级仍走已有发布取证入口。

两项的执行依赖、文件归属和合流点见[配对 Plan 的任务批次](../plans/lucy-20261123-interactive-read-resilience-plan.md#并行任务批次)。P1-77 叠加后的上下文检索负载复验归 [P1-77 合同](lucy-20261123-default-business-context-adoption-spec.md#3-验收)。

## 受影响画像

> 事实源：[Lucy 用户画像](../governance/user-personas.md)。下表为设计判断，体验结果待运行验收。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 新连接可能超时；正常握手自带可见目录和 Skill 引导 | 预算内连接并取得真实查询结果；动态指引超线时主动发现当前可见目录和 Skill | 连接 ↑；超线时业务上下文预载 ↓；报告面 ＝，按最差判 ↓ | SC-02／03／07 | 无 WebUI 会话可用基础指引和实际可见目录／Skill 工具，按需取授权内容并完成原查数。SC-03 核验真实宿主路径。 |
| P2 治理方 | 名册、语义资产或角色权限冷读时可能报忙或超时 | 名册写中可读已提交视图，写后见新备注；多页面正常冷读及局部故障后的恢复可核验 | 权限授权面 ↑；语义资产读取 ↑ | SC-04／05／07／08 | — |
| P3 运维方 | 部分握手和快照等待只表现为长尾，定位依赖分散日志 | 可按同一请求定位等待、降级、快照核验与最终结果，探针和四页响应分别可复算 | 运行观察面 ↑；交付运维面 ＝ | SC-01／06／08 | — |
| P4 管理层 | 概览部分区域可能读不到数据，影响查看系统状态与待处理事项 | 验证概览区域在预算内交付真实业务内容或在局部故障解除后恢复；现行指标口径沿用 | 概览读取 ↑ | SC-08 | — |

P1 的降级须经主路径可用性复核。合法纯 MCP 仍可在同一入口取得授权范围并按原业务口径查数才符合原则，补偿场景失败即 SC-03 失败。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面，本条修订既有请求和快照的数据路径与性能。
- 不改变：现有路由、导航、布局、控件、错误文案和重试入口。前台浏览器验证与即时计时见 SC-04／05／07／08。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None
