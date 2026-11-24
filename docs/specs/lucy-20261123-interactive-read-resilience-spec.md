# MCP 握手与 Agent 名册读取长尾治理 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.4（SC-01–08 沿用 v1.2；全页面无 503 扩容设计定稿） |
| 日期 / 产品线 | 2026-11-23 / 0.30.0（`lucy-v0.30`） |
| 功能编号 | P1-75／REQ-030-096（拟 P1，不入核心分母） |
| 台账号 | 无 |
| 阶段 | S3 |
| 状态 | S3｜实现进行中（既有 SC-01–08：A1／A2 单元＋复审 PASS；A3 判定器 24/24；demo 镜像已含改动）。正式 G1 R0–07／G2 与多页面必做回归尚未封存跑次。2026-11-24 委托人明示定稿扩容设计（Spec v1.4／Plan v1.3／UAT v1.3）：目标「WebUI 全部页面含二级 tab 无 503」，503 按原因登记表判定（附录 A），超宽限的只读展示降级为 200；定稿不含开发授权，SC-09–10 对应运行代码开发未授权，仅设计与登记，测试台 `UAT-READ-RES-09／10` NOT RUN；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 2026-11-23 委托人批准修订 Spec、UAT 与并行任务；同日明示「完成落地和测试」＝运行代码＋测程开发授权，**范围仅 SC-01–08**。2026-11-24 委托人明示「定稿 Spec、Plan、UAT，不进行开发」：扩容部分按无 Codex 时的委托人明示确权口径登记**设计层终稿确权**，**不含 §2.5／SC-09–10 的开发授权**，须委托人另发。正式 UAT／INDEX 登记仍须实测回执。 |
| 扩容修订 | 2026-11-24 v1.4：定稿 §2.5 与附录 A（503 原因登记表），关闭 v1.3-draft 的 OQ-1 至 OQ-4；修订 §2.4 构建等待口径；新增 SC-09／SC-10；修订 UAT-READ-RES-08-B 的「可重试 503」口径；登记对 [Spec 195](lucy-20261030-display-snapshot-invalidation-isolation-spec.md)、[Spec 174](../../webui/docs/174-webui-entry-performance-spec.md) 的边界修订指针，并联动修订 [P1-81](lucy-20261124-stuck-state-self-healing-spec.md) §3。2026-11-24 复核修订（同版）：`reconcile_failed` 持续越界转 C 类 503 的状态机；四种 200 状态与待定计时；B 类补上限、`ACCESS_RECOVERY_REQUIRED` 与 `question_budget_unavailable` 改归 C。评审处置见 [Kimi 评审处置](../reviews/2026-11-24-p1-75-v1-3-kimi-review-disposition.md)。**旧 08-B 证据只保留历史意义，不能证明 v1.4 的 08-B。** |
| 需求 / 验收 | [总账 P1-75](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [REQ-030-096](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-096mcp-握手与-agent-名册读取长尾治理) · [UAT-SUITE-INTERACTIVE-READ-RESILIENCE](../qa/uat/suites/interactive-read-resilience/suite.md) |
| 配对计划／评审 | [修复与复现 Plan](../plans/lucy-20261123-interactive-read-resilience-plan.md) · [初审](../reviews/2026-11-23-p1-75-interactive-read-resilience-adversarial-review.md) · [Codex 复审及定稿处理](../reviews/2026-11-23-p1-75-interactive-read-resilience-codex-review.md) · [v1.3 扩容 Kimi 评审](../reviews/2026-11-24-p1-75-v1-3-all-pages-no-503-kimi-review.md) · [评审处置](../reviews/2026-11-24-p1-75-v1-3-kimi-review-disposition.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：在冻结的 Docker 档位内，纯备注保存期间独立治理会话能打开一致的 Agent 名册，保存确认后首读见到新备注。概览、语义资产、Agent 名册和角色权限正常冷读可用，共享快照局部故障时受影响区域按 §2.5 返回降级或待定状态（v1.2 为明确报错）并限时恢复。合法纯 MCP 客户端在预算内完成建连、发现并取得正确查询结果，动态指引等待超线时仍有基础指引和查询路径。
- 扩容承诺（v1.4）：WebUI 全部页面（以 `webui/src/app/navigation.ts` 现有菜单为准）及页内二级 tab，在正常运行与压力下，首读、tab 切换、写后首读不得因容量、慢 I/O、快照核验、构建等待或排队返回 503；503 按 §2.5 与附录 A 的原因登记表判定。超宽限的只读展示返回 200＋降级标记，无可服务视图时返回 200＋显式待定状态，不再返回 503。写入、权限判定和撤权仍 fail-closed。「零」指冻结样本内 0 次并报告 0/N，不外推为普遍保证。
- 本条出口：SC-01–10 全部必做，覆盖真实前台、纯 MCP 正负例、局部故障、同一 Lucy 进程内 50 路握手和问数与名册保存重叠、四页共享读取回归，以及全页面×二级 tab 无 503 矩阵和降级边界安全回归。判定使用 [冻结的 UAT 用例和夹具](../qa/uat/suites/interactive-read-resilience/cases.md)。
- 不在本条出口：P1-66 原档冷读性能全矩阵、FUP-03 重档及 P1-13／R-CAV 长时组合、整库旅程、宿主 Agent 全套兼容、现场归因和升级交付。安全与审计 fail-closed 的合同本身（企业安全 Spec、审计 Spec）不由本条修改。网关层 HTML 502／503、客户拓扑和多副本不在范围。相关历史失败、诊断对照和发布取证单列。
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

握手按请求取得授权后的连接、Source 四元组和已裁剪的示例。第一项单变量对照把握手不消费的描述增强移出应答路径，独立 `lucy_catalog` 保持描述、grain、列暴露与异常合同。对照核验完整动态指引的内容、顺序和作用域。Skill 仍按当前身份执行发现授权。保留现有描述索引及按请求构建的授权指引。若既定改动不足以达标，保留失败和阶段证据，回到设计复审。

语义资产列表、ACL Source Map、独立目录描述和查询歧义目录共用同一文件代次的只读 YAML 解析值。稳定读取与文件签名核对后才复用，同代次并发读取共用一次解析。读取时各入口继续应用自己的文件范围、权限和错误合同，编辑与发布使用独立的可变文档。性能诊断逐组记录实际解析次数、冷读与热读、文件换代后的首读和事件循环。

握手的 Skill 发现层共享已核验文件代次对应的只读名称、描述、状态和对象权限声明。并发核验与构建合并，同代次热读仅核对文件及目录元数据。目录变化刷新成员，已在册且未变更的文件继续复用。保持安全路径读取和请求级身份授权。生成完整指引后重验当次 Skill 文件代次，变更或无法核验时走基础指引。Skill 正文交由既有发现与读取工具的权限路径处理。拆测记录目录与文件读取、Markdown 解析、授权过滤及实际工作次数。

响应前 Skill 核验对同一根目录与快照共享尚未开始的元数据核验。口径绑定参与状态可共享同一文件根目录尚未开始的文件证明读取。已经开读的批次有固定成员，后到请求进入后续批次。会话参与状态、工具可见性和最终授权屏障仍按请求判定。

从 Lucy 接受该 `initialize` 起，用单调时钟记 **1 秒动态指引决策截止**。上游握手和会话继续按既有协议处理。发送任何成功响应前重验请求身份和会话边界。完整指引还须在截止前通过当前授权及输入代次核验。在具备合法成功应答前提下，到点、动态构建失败或本地构建容量已满时使用进程预先装载的 Lucy 基础指引。基础指引提供按实际可见工具发现、查询与 Skill 读取的方法，包含核心问数规则，无角色化连接、Source 或 Skill 名单。保持现有问询上报与工具可见性边界。既有本地协议回退也走同一指引决策。慢上游响应头／响应体按原协议单独验证，1 秒决策线仅约束动态指引。

动态任务在进入昂贵工作前取有界执行容量，每实例同时运行上限 20，无等待任务队列。截止或断开后取消可取消工作，在发布结果前复核请求仍有效；实际工作终结前继续占用容量。迟到的任务只结算阶段和资源，禁止覆盖本次响应或发布旧指引。候选在冻结档位必须守住客户端完整响应和首次查询总时限，正常暖态握手组需完整指引。降级组须证明纯 MCP 用现有工具完成合法查询，且收窄后的旧会话、新会话和发现入口均遵守当前权限。账面分开记录完整指引、基础指引、客户端失败和底层退出。

完整指引与预载基础指引复用同一份静态核心问数规则。基础指引覆盖动态超时、容量满、构建失败和既有本地协议回退。握手只下发规则与本条约定的可见范围，业务 Wiki／Skill 的按题检索与正文读取由问询阶段执行。保留完整指引已有的授权 Skill 发现清单。

### 2.3 观测与证据边界

按请求关联读写阶段、内部 `busy` 理由、首响应、重试、代次和真实终态。目录测到实际闭包，区分权限投影、扫描／文件核验、读取／解析、描述增强与序列化。Skill 分开记录扫描读取、解析和上下文 ACL。客户端完整响应、上游响应头与响应体以及可测的排队／调度等待分开。用同候选开关对照核对观测自身开销，逐请求记录脱敏的数量、命中、时间与代次摘要。

正式 `lucy_admin` 用于全局档和四档目录对照，受限身份承担撤权及隔离校验。以已核验字节量和分布校准合成负载，各窗按 [夹具](../qa/uat/suites/interactive-read-resilience/fixtures.md) 核对实际可见范围。P1-66 的既有冷读失败和 FUP-03 的重档探针反例保留在原档，独立于本条局部冷读和探针门槛。当前 Agent 页的摘要入口和旧完整接口分别取证。现场完整名册发起者、成功下载耗时与客户握手长尾继续作为事故归因线索。

### 2.4 多页面共享读取回归

在同一候选上验证概览、语义资产、Agent 名册和角色权限的真实前台读取。正常无写冷读必须交付正确业务内容。局部故障明确区分按作用域核验变慢和快照构建等待变慢；v1.3 起，已受影响的依赖不再以 503 作为合格结果：A 类原因按 §2.5 返回正确内容或降级 200，可重试错误仅限 §2.5 的 B、C 类（v1.2 曾允许浏览器读取截止前返回可重试错误，现取消，既有判定器须同步升级）。其余依赖、探针及合法纯 MCP 在各自预算内完成。故障解除后无需重启，按 UAT 时限恢复正确内容。健康状态、首响应、浏览器中止、重试及页面就绪独立判定。若达不到目标，按证据定位共享快照路径后复审修复方案。

展示快照构建共用请求级等待截止。v1.2 为 4 秒、到点返回可重试的 `DISPLAY_SNAPSHOT_BUSY`；**v1.4 起取消该 503**：无可服务视图时请求内等待构建至多 10 秒（与 08-A 首构建预算一致），到点返回 200＋显式待定状态，有同代次视图时按 §2.5 返回降级 200，均记录 `build_wait_timeout` 等内部原因。共享构建继续占用原槽位和执行容量，完成后核对当前作用域、新鲜度及代次，通过核验才发布。每个新请求仍执行独立鉴权和读取核验。既有 1.5 秒核验／写入恢复预算继续适用。已实现的 4 秒截止及其 T0 判定器须随 §2.5 升级。

### 2.5 全页面无 503 合同（v1.4 扩容，设计定稿）

**目标。** WebUI 全部页面和页内二级 tab，在正常运行与压力下，用户首读、tab 切换、写后首读及自动重试，都看不到 503。依据：`f5e4b14d` 压力跑次中概览首读 503 为 10/10，停压后 134 秒内展示读有 80 次 503。「零」指冻结样本内 0 次并报告 `0/N`，不外推为普遍保证。

**范围按原因登记，不按状态码一刀切。** 一刀切会要求安全存储或审计账本故障时也放行，违反企业安全与审计 Spec 的 fail-closed 要求。全部 503 出口登记在 [附录 A](#附录-a-503-原因登记表)，附录是 UAT 判定的唯一依据。

| 类别 | 含义 | 要求 |
|---|---|---|
| A 必须为零 | 容量、慢 I/O、快照核验、构建等待、排队、对账、代次切换、页面加载触发的自动探测排队 | 正常运行、压力、局部故障和停压恢复窗内，首读、tab 切换、写后首读、重试后均为 0。按 §2.5.1 处置 |
| B 有界登记 | 启动、排空、重载、写入进行中、自愈替换 | 只在计划内窗口、写入窗口或恢复核验期出现；附录给出起止事件与上限；页面显示明确状态与恢复入口，不显示原始错误；单独记账，不计入 A |
| C 仅真实故障 | 安全存储、审计账本、会话状态、配置损坏、环境缺失、访问恢复闸门、预算持久化、持续核验失败 | 保持 fail-closed。压力、慢磁盘、并发读不得触发；只有注入真实故障才允许；页面给明确状态和恢复路径 |
| D 不计入 | 用户主动动作的外部依赖失败、写入窗口占用、写后确认失败、网关层 HTML 502／503 | 属业务反馈或部署问题，不算页面读取 503。必须使用附录登记的稳定原因码，提示遵守术语标准 |

**判定规则。**

1. 每个 503 响应必须带机器可读原因。UAT 以附录归类，**未登记原因的 503 一律判失败**；新增 503 出口必须先登记再合入，X1 用自动化对账出口与附录。
2. 同一原因码同时出现在读取路径与动作路径时，按实际调用路径归类。页面加载或 tab 切换自动发起的请求视为读取路径，不得借 D 类逃逸。
3. A 类只约束页面业务读，**不禁止** P1-81 的 `readyz` 在自愈判定后返回 `stuck`（B 类）。
4. B、C 类出现次数、窗口时长与触发条件单独报告。压力窗内 C 类必须为 0。

#### 2.5.1 A 类处置：只读展示的四种 200 状态

A 类读不再返回 503，而是返回下列四种 200 之一。`fresh` 是正常成功；`grace`、`stale`、`pending` 是**降级态**，都带降级标记和视图代次，**都不是 fresh 成功**，不得被探针、前台或 UAT 记为 fresh。数据年龄：`grace`／`stale` 为所服务视图的年龄；`pending` 无视图，没有数据年龄，改记「连续待定时长」（该作用域自首次进入待定起的连续时间，只在回到 `fresh` 时清零）。

| 状态 | 条件 | 行为 |
|---|---|---|
| `fresh` | 在请求内完成核验 | 正常 200，正确内容 |
| `grace`（既有） | 同代次已提交视图，年龄在宽限内：元数据 120 秒、全量摘要 180 秒 | 立即 200，带 `degraded;desc=grace` |
| `stale`（新增） | 同代次已提交视图，年龄已越过宽限，且请求内 1.5 秒恢复等待后仍无法核验 | 200，带降级标记、数据年龄；页面提示数据可能不是最新并提供手动刷新 |
| `pending`（新增） | 没有可服务的同代次视图：写后代次切换首读、冷启动、`context_mismatch`、`generation_changed` 三次内部重试后、`build_capacity`、`reconcile_failed` | 请求内等待构建或核验至多 10 秒，仍未完成则 200＋显式待定状态，**不含数据字段**，页面显示加载中并自动轮询 |

**服务条件。** 只有同时满足下列各项，才可服务 `grace`／`stale`：

1. 同作用域（D／P／C）、同投影、同内容代次。
2. **同身份范围**：视图键含 `principalScope` 与权限版本，不得跨身份。按登录账户裁剪的结果必须随身份和权限版本隔离，沿用 [Spec 174](../../webui/docs/174-webui-entry-performance-spec.md) 的版本向量。
3. 请求先经现有鉴权与角色门禁。
4. **响应写出前再次核验**当前授权、撤权状态和权限版本。在途撤权或授权变化与读取交叠时，放弃降级，改走 fresh 核验并按原合同处理。
5. 该作用域没有进行中的展示写入（`write_pending` 属 B 类）。
6. 没有已记录的核验错误。对账错误不得用旧视图（沿用既有宽限判定）。

**边界。**

1. 仅限只读展示。保存、dryRun、权限预览、运行时 ACL／Policy、MCP 授权、撤权后的读取，不使用降级视图，仍走 fresh 核验并 fail-closed。
2. 真正授权变化开始前，降级视图必须同步撤下，沿用 §2.1。不得把未提交的新配置与旧权限拼接。
3. `pending` 不得用空列表、零值或「缺 Manifest」冒充。启用表范围页在 `stale`／`pending` 下，不得据旧数据或无数据触发缺 Manifest／无效启用判定，「移出无效启用」等危险动作不可达，沿用 [P1-80](lucy-20261123-enabled-tables-load-state-honesty-spec.md) 的三态诚实。
4. 无压力冷读（08-A）的 `stale`／`pending` 次数须为 0，降级不得成为常态。
5. **持续降级上限 D_max＝180 秒**（对齐 P1-81 的 T_B 默认值），按是否带核验错误分两条线，状态机如下：
   - **非错误型降级**（慢 I/O、排队、构建等待、年龄过期，没有已记录的核验错误）：`stale`／`pending` 连续服务超过 D_max 后，**仍返回 200**，页面提示升级为「长时间未更新」，记为持续降级失败，并作为 P1-81 假活判定的观测输入。**不得转 503。**
   - **核验错误型**（同一作用域持续 `reconcile_failed`）：D_max 内返回 200＋`pending`，不含数据字段、不服务旧视图；连续时长**超过 D_max** 后，该作用域改返回 **C 类 503**，使用稳定原因码（拟 `DISPLAY_RECONCILIATION_FAILED`，X1 冻结，不沿用带「可重试」含义的 `DISPLAY_SNAPSHOT_BUSY`），保留恢复入口，不返回旧内容。理由：这表示核验已失败，不只是变慢；长期无数据不得包装成正常降级。
   - **计时规则**：计时按作用域（D／P／C）独立；从首次 `reconcile_failed` 起连续计，新请求和自动重试都不重置；只有该作用域核验成功并回到 `fresh` 才清零，恢复后重新成交。
   - 这个 C 类 503 只在真实核验故障下出现；压力窗内出现即按「压力窗 C 类为 0」判失败。
6. 故障解除或停压后，`stale`／`pending` 须在 10 秒内回到 `fresh`，无需重启。

**页面加载自动探测。** 页面加载时自动发起的连接探测（`purpose=automatic`）遇到队列满或排队超时，返回最近一次结果并标注年龄，或 `pending`，不返回 503。用户主动探测（`purpose=manual`）保留 503＋`Retry-After`，归 D。

**与 P1-81 联动。** 降级响应不是健康证据。P1-81 的假活判定把超时、503、`stale`、`pending` 都记为展示读失败（`pending` 无年龄，任何 `pending` 都不是健康证据），见 P1-81 §3。A 类零目标不得让假活检测失明。

**根因优先。** 降级是兜底，不替代根因修复。共享核验得不到服务、I/O 竞争、构建占槽都只是**候选机制**，唯一根因须按 [`f5e4b14d` 关闭清单](../qa/uat/suites/interactive-read-resilience/close-checklist-f5e4b14d.md) A3 给出证据后才可定论。验收必须包含「关闭降级」的同口径混压对照（09-F），证明零 503 不是只靠状态码转换取得。

**覆盖矩阵。** Plan X0 生成「页面 × 二级 tab × 首读接口 × 可能的 503 原因」清单，来源为 `webui/src/app/navigation.ts`、[`06-navigation-ia.md`](../../webui/docs/06-navigation-ia.md) 和既有 [`UAT-SUITE-PAGE-OPEN`](../qa/uat/suites/page-open-exceptions/suite.md) PO-01／PO-02 的覆盖范围。该套件已知缺口（详情页带参数路由 PO-03 未做、页签上限 6 个）不得继承，矩阵须补入带真实 id 的详情页路由，并取消页签个数上限。由委托人指定的**非作者复核者**在 X1 前对账：路由、页面组件、既有清单的差集逐条解释；缺格或未解释的多余格判 `BLOCKED`。已知差异：登录账户路由在 `navigation.ts` 为 `/admin/accounts`，在 `06-navigation-ia.md` 为 `/admin/admins`，以 `navigation.ts` 为准并修正文档（不改导航）。矩阵版本摘要随候选封存。导航本身不改。

**关闭 v1.3-draft 开放问题。**

| 编号 | 决议 |
|---|---|
| OQ-1 年龄上限 | 持续降级上限 D_max＝180 秒，对齐 P1-81 T_B；非错误型降级越界不以 503 收场，提示升级并计为持续降级失败，同时作为 P1-81 观测输入；持续 `reconcile_failed` 越界转 C 类 503（见 §2.5.1 边界 5）。降级占比上限在 09 首次实测校准后由委托人写入变更行，校准前占比必须报告但不作通过条件，D_max 不得放宽 |
| OQ-2 无视图首读 | 请求内等待至多 10 秒，仍无结果则 200＋`pending`，不含数据字段；有同代次视图则按 `grace`／`stale` 处理 |
| OQ-3 降级标记 | 语义字段集合冻结：状态（`grace`／`stale`／`pending`）、数据年龄（毫秒）、视图代次。承载位置（响应头或信封）在 X3 冻结。页面文案先登记术语标准、先补交互合同再实现，这是 X3／X5 的**前置门槛**，不再是开放设计问题 |
| OQ-4 自动探测 | 页面加载自动探测归 A；用户主动探测归 D；`PROBE_QUEUE_FULL` 与 `PROBE_QUEUE_TIMEOUT` 均登记 |

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

readDisplay(request):
  authorize this request through existing gates
  if a fresh verification completes within the request budget: respond fresh
  else if a same-generation, same-identity committed view exists and no write or recorded verification error applies:
    recheck current authorization and permission version, then respond grace or stale with age and generation
  else:
    wait for build or verification up to 10 seconds; respond fresh, or pending without a data field
  on sustained non-error degraded state beyond D_max record a persistent-degrade failure, never a 503
  on continuous reconcile_failed for one scope beyond D_max (timer never reset by new requests) respond C-class 503 with recovery entry and no stale content; clear the timer only on verified fresh
  keep write, dryRun, permission preview and revoked reads on the fresh path, fail-closed

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
| SC-08 | 在无配置写入的冷读及受控共享核验／构建慢窗，逐页核对概览、语义资产、Agent 名册、角色权限的首响应、正确业务内容及限时恢复。区分正常首读、具名受影响依赖的降级 200（v1.3 起不再接受 A 类 503）和独立控制；同窗探针及纯 MCP 仍守原预算。 | [UAT-READ-RES-08](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-08) |
| SC-09 | 按冻结的「页面 × 二级 tab × 首读接口」矩阵，在无压冷读、局部核验／构建故障、`f5e4b14d` 同口径混压（500 Agent、200 角色、1,403 Source、百万审计、2 CPU／2 GiB、15 分钟）和停压恢复四种窗内，真实前台逐格测首读、tab 切换与写后首读。A 类 503 为 0；附录 A 登记表外 503 为 0；B、C 类按 §2.5 单独记账，压力窗 C 类为 0。`stale`／`pending` 响应次数、占比与数据年龄逐格记录，无压冷读为 0，连续降级不超 D_max，停压后 10 秒内回 `fresh`。另跑关闭降级的同口径对照（09-F）证明零 503 不是靠状态码转换取得。每窗分母与内容正确性逐格报告。同窗纯 MCP 合法 Agent 与探针守原预算。 | [UAT-READ-RES-09](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-09) |
| SC-10 | 降级边界安全：宽限外降级视图下，保存、dryRun、权限预览、撤权后读取和 MCP 授权仍走 fresh 核验；授权变化前降级视图被同步撤下，不出现新配置与旧权限拼接；无已核验视图时返回 `pending`，不返回空列表冒充；在途撤权与读取交叠时放弃降级；跨身份与权限版本不串视图；同一作用域持续核验失败越过 D_max 后返回 C 类 503、恢复后重新成交；真实注入安全存储或审计账本故障时 C 类仍 fail-closed，压力下 C 类为 0。约束生效与合法用户仍可用（含无 WebUI 会话的纯 MCP）同窗成立。 | [UAT-READ-RES-10](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-10) |

## 4. 阶段安排

1. 以[历史全局规模跑次](../qa/uat/suites/interactive-read-resilience/runs/2026-11-23-kscc-global-baseline.md)作为已知反例，用正式身份和新测程冻结可比 A/B。先校验测程和阶段归因，再做名册与 MCP 单变量候选。
2. 用同一 P1-75 候选跑 G1 的局部用例、多页面回归和 G2 的 50 路同窗用例。首失败、恢复和不完整样本独立记账，SC-01–08 通过后冻结该候选，供 P1-77 性能对照使用。
3. 后续按现场请求、角色和输入分布补充事故归因对照。长时组合和升级仍走已有发布取证入口。

两项的执行依赖、文件归属和合流点见[配对 Plan 的任务批次](../plans/lucy-20261123-interactive-read-resilience-plan.md#并行任务批次)。P1-77 叠加后的上下文检索负载复验归 [P1-77 合同](lucy-20261123-default-business-context-adoption-spec.md#3-验收)。

## 附录 A 503 原因登记表

> 版本 v1.4（2026-11-24 复核修订），冻结于当日 `webui/server` 现状。B 类每项须有可验证上限；标「暂定」的数值由 X0 复核，委托人可改，冻结前按暂定值判定。X1 用自动化对账代码出口与本表，缺登记即失败；本表之外的 503 UAT 一律判失败。同一原因码在读取与动作路径并存时按调用路径归类（§2.5 判定规则 2）。

| 原因 | 出处 | 类 | 处置或上限 |
|---|---|---|---|
| `DISPLAY_SNAPSHOT_BUSY`／`metadata_overdue` | `display-snapshot.ts` | A | 宽限（元数据 120 秒）内 `grace`，越界 `stale` |
| `DISPLAY_SNAPSHOT_BUSY`／`digest_overdue` | `display-snapshot.ts` | A | 宽限（摘要 180 秒）内 `grace`，越界 `stale` |
| `DISPLAY_SNAPSHOT_BUSY`／`build_wait_timeout` | `display-snapshot.ts` | A | 请求内等待至多 10 秒，`fresh` 或 `pending` |
| `DISPLAY_SNAPSHOT_BUSY`／`build_capacity` | `display-snapshot.ts` | A | 同上 |
| `DISPLAY_SNAPSHOT_BUSY`／`generation_changed` | `display-snapshot.ts` | A | 三次内部重试后，同上 |
| `DISPLAY_SNAPSHOT_BUSY`／`context_mismatch` | `display-snapshot.ts` | A | 同上 |
| `DISPLAY_SNAPSHOT_BUSY`／`reconcile_failed` | `display-snapshot.ts` | A（D_max 内） | 不用旧视图，等待至多 10 秒，`pending`（无数据字段）；同一作用域连续超过 D_max 转下一行 |
| `DISPLAY_RECONCILIATION_FAILED`（拟，X1 冻结） | 同上 | C | 仅在同一作用域持续 `reconcile_failed` 超过 D_max 时返回；保留恢复入口，不返回旧内容；核验成功后清零；压力窗内出现判失败 |
| `DISPLAY_SNAPSHOT_BUSY`／`write_pending` | `display-snapshot.ts` | B | 至写入终态，**暂定上限 180 秒**（取 D_max，X0 复核）；既有 1.5 秒恢复预算；终态后 10 秒内 `fresh`；仅改备注见 §2.1 |
| `PROBE_QUEUE_FULL`、`PROBE_QUEUE_TIMEOUT`（`purpose=automatic`） | `background-probes.ts` | A | 返回最近结果并标注年龄或 `pending` |
| 同上（`purpose=manual`） | `background-probes.ts` | D | 503＋`Retry-After` |
| `warming_up`（`readyz`） | `index.ts` | B | 启动预热窗，**暂定上限 120 秒**（对齐 P1-81 T_A，X0 以冷启动实测复核）；超出判失败 |
| `SERVICE_DRAINING` | 生命周期（P1-63） | B | 至多 20 秒 |
| `EXECUTION_RUNTIME_RELOADING`、`EXECUTION_RUNTIME_NOT_LOADED` | 运行时（P1-69） | B | 至多 60 秒 |
| `readyz` `stuck` | `index.ts`（P1-81） | B | 受 P1-81 T_B 约束；是自愈入口，不是读失败 |

| `PUBLISH_COORDINATOR_BUSY` | 发布协调 | D | 用户写入动作，按写入合同反馈 |
| `RUNTIME_ACK_FAILED` | 写后运行态确认 | D | 写后结果，按 outcome 明示 |
| `AUDIT_UNAVAILABLE`、`META_AUDIT_STORE_UNAVAILABLE`、`META_AUDIT_WRITE_FAILED`、`config_audit_unavailable`、`skill_audit_unavailable` | 审计账本 | C | 真实故障才允许；压力窗为 0 |
| `AUTH_STATE_UNAVAILABLE`、`SECURITY_STORE_UNAVAILABLE`、`STORE_UNAVAILABLE`、`RECONCILIATION_READ_REFUSED`、`RECONCILIATION_SECURITY_STORE_UNAVAILABLE` | 会话、安全存储、对账 | C | 同上 |
| `AUTH_CONFIG_UNAVAILABLE`、`ERR_QUERY_ARTIFACT_KEY_MISSING` | 配置、环境缺失 | C | 同上 |
| `ACCESS_RECOVERY_REQUIRED` | 访问恢复 | C | 访问恢复闸门保守关闭，只能由管理员显式恢复动作清除，没有时间上限，因此不属于 B 类；页面给恢复入口；压力窗为 0 |
| `question_budget_unavailable` | 问数预算持久化（`question-experience.ts`） | C | 持久化存储不可读写时失败关闭，不得记为预算终止凭据；压力窗为 0 |
| `KTX_CLI_ERROR`（读取路径） | KTX 适配 | C | 真实上游故障 |
| `KTX_CLI_ERROR`（用户主动测试、验证、重建动作） | KTX 适配 | D | 动作反馈 |
| `BOOTSTRAP_NOT_PROVISIONED`、`OIDC_NOT_AVAILABLE`、`MCP_ENDPOINT_UNAVAILABLE`、`NOTIFICATION_UNAVAILABLE`、`NOTIFICATION_QUEUE_UNAVAILABLE` | 引导、认证、通知 | D | 用户主动动作或可选能力 |
| MCP 调试台 `unavailable` | MCP 调试台 | D | 须在 X0 补稳定原因码；无稳定码前按未登记判失败 |
| 网关层 HTML 502／503 | 部署网关 | D | 不归 Lucy；UAT 记为环境事件并单独报告 |

## 受影响画像

> 事实源：[Lucy 用户画像](../governance/user-personas.md)。下表为设计判断，体验结果待运行验收。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 新连接可能超时；正常握手自带可见目录和 Skill 引导 | 预算内连接并取得真实查询结果；动态指引超线时主动发现当前可见目录和 Skill | 连接 ↑；超线时业务上下文预载 ↓；报告面 ＝，按最差判 ↓ | SC-02／03／07 | 无 WebUI 会话可用基础指引和实际可见目录／Skill 工具，按需取授权内容并完成原查数。SC-03 核验真实宿主路径。 |
| P2 治理方 | 名册、语义资产或角色权限冷读时可能报忙或超时 | 名册写中可读已提交视图，写后见新备注；多页面正常冷读及局部故障后的恢复可核验 | 权限授权面 ↑；语义资产读取 ↑；全页面 503 ↑；降级展示的数据新鲜度 ↓（按最差子面） | SC-04／05／07／08／09／10 | 降级页面标注数据年龄并提供手动刷新；保存、dryRun、权限预览、撤权后读取仍 fresh 核验，降级视图不进入任何判定（SC-10） |
| P3 运维方 | 部分握手和快照等待只表现为长尾，定位依赖分散日志 | 可按同一请求定位等待、降级、快照核验与最终结果，探针和四页响应分别可复算 | 运行观察面 ↑；全页面 503 判定面 ↑（附录 A 可复算）；交付运维面 ＝ | SC-01／06／08／09 | 降级与待定可按附录 A 原因登记和降级标记定位；`readyz` 的 `stuck` 属 B 类，仍可由 P1-81 判定与告警发现，不被降级 200 掩盖 |
| P4 管理层 | 概览部分区域可能读不到数据，影响查看系统状态与待处理事项 | 验证概览区域在预算内交付真实业务内容或在局部故障解除后恢复；现行指标口径沿用；全部页面无 503，降级时标注数据年龄，无可用视图时显示加载中而非空指标 | 概览读取 ↑；降级展示新鲜度 ↓（按最差子面） | SC-08／09／10 | 降级时概览标注数据年龄与手动刷新；不展示未经标注的旧指标 |

P1 的降级须经主路径可用性复核。合法纯 MCP 仍可在同一入口取得授权范围并按原业务口径查数才符合原则，补偿场景失败即 SC-03 失败。

## 交互合同豁免

- 原因：SC-01–08 不改变用户可见 WebUI 表面，只修订既有请求和快照的数据路径与性能。
- 不改变：现有路由、导航、布局、控件、错误文案和重试入口。前台浏览器验证与即时计时见 SC-04／05／07／08／09／10。**v1.3 例外**：§2.5 的降级提示（数据年龄、「数据可能不是最新」类文案、手动刷新）是新增的用户可见内容，豁免不适用于该部分；实现前须先补交互合同（位置、触发、样式）与术语标准登记，X3／X5 的前置门槛未满足前不得实现该提示。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 降级展示提示（拟，v1.4）：页面在展示较旧的已核验数据，或尚无可展示数据（待定）时的提示用语，含「数据可能不是最新」「长时间未更新」「正在加载」三类。先登记术语标准再写 UI 文案或测试断言（X3／X5 前置门槛）。`degraded`、`busyReason`、错误码仍只用于 Spec、UAT 与证据，不进入用户可见文案。
