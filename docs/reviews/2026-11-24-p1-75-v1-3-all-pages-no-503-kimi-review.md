# P1-75 v1.3-draft「全页面无 503」独立审阅报告

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-75 v1.3-draft「WebUI 全部页面（含二级 tab）无 503」Kimi 独立审阅 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Kimi |
| 委托人 | xingchen |
| 基于材料 | P1-75 Spec v1.3-draft、配对 Plan、UAT 套件与 INDEX、总账与需求池、Spec 174／195、P1-63／69／80／81／82、企业安全与审计合同、`f5e4b14d` 跑次及原始证据、`webui/server/` 非测试 503 出口、导航事实源 |
| 适用范围 | 只读对抗式审阅；不构成终稿确权、开发授权或任何实测判定；未修改被审文档、运行代码或配置 |
| 输出位置 | `docs/reviews/2026-11-24-p1-75-v1-3-all-pages-no-503-kimi-review.md` |

## 1. 结论

**BLOCK**。§2.4 仍要求构建等待超时返回 503，与 A 类为零及 08-B3 直接冲突。实际 503 原因和错误码没有被白名单闭合，现有“未登记即失败”规则会误伤合同本意允许的安全拒绝与动作反馈。无年龄上限的降级 200 可掩盖混压根因，并使 P1-81 的“失败率 100%”判定无法触发；身份绑定和在途撤权验收也未闭合。覆盖矩阵、B 类时限、混压宿主隔离与真实故障注入尚不具备可复核的终稿条件。

## 2. 发现表

| ID | 严重度 | 位置 | 问题 | 证据 | 建议修法 |
|---|---|---|---|---|---|
| R-01 | BLOCK | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:75,85,92`；`docs/qa/uat/suites/interactive-read-resilience/cases.md:101-102`；`docs/plans/lucy-20261123-interactive-read-resilience-plan.md:100,147-148` | 同一 `build_wait_timeout` 同时被要求返回 503 和要求为零；Plan 的 V1／V2 也仍保留旧结果 | §2.4 写明“4 秒……到点时返回”该错误；08-B3 又把它列为首响应失败 | 统一 §2.4、§2.5、08-B 与 Plan 的旧段落；对 Spec 174:189、Spec 195:83,150,215 的相关旧句作精确修订指针，并先闭合无视图场景 |
| R-02 | BLOCK | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:85,90,110`；`webui/server/display-snapshot.ts:89-109`；`webui/server/background-probes.ts:23-57`；`webui/src/pages/connections/ConnectionOverview.tsx:482-492,536-543` | A／D 分类未覆盖实际快照原因、探测超时和自动动作 | 快照枚举另有 `reconcile_failed`、`write_pending`、`build_capacity`、`generation_changed`、`context_mismatch`；另有 `PROBE_QUEUE_TIMEOUT`；连接页实际发起 `purpose=automatic` | 以完整枚举逐项裁定类别；自动探测和页面后台刷新不得借 D 逃逸；同时登记队列满与排队超时 |
| R-03 | BLOCK | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:86-90`；本报告 §4 | 白名单与真实错误码不闭合，无法稳定执行“每个 503 都归类” | 未登记项包括 `AUTH_CONFIG_UNAVAILABLE`、`STORE_UNAVAILABLE`、`META_AUDIT_STORE_UNAVAILABLE`、`META_AUDIT_WRITE_FAILED`、`RECONCILIATION_SECURITY_STORE_UNAVAILABLE`、`config_audit_unavailable`、`skill_audit_unavailable`、`KTX_CLI_ERROR`、`PUBLISH_COORDINATOR_BUSY`、`RUNTIME_ACK_FAILED`、`EXECUTION_RUNTIME_NOT_LOADED`、`ERR_QUERY_ARTIFACT_KEY_MISSING`；MCP 调试台还使用通用 `unavailable` | 冻结“接口 × 动作 × 规范原因码 × 类别”映射；安全／审计别名应显式映射到 C，写入与运行态确认失败须另行裁定，不能靠自然语言消息猜类别 |
| R-04 | BLOCK | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:85,92,107`；`docs/specs/lucy-20261124-stuck-state-self-healing-spec.md:91-99,103-124,132-137` | 降级 200 会让假活检测失明；“假活期间的 503 为 A 类零”也未排除自愈所需的就绪探针转红 | P1-81 把失败限定为超时或 503，并要求展示读与 MCP 探针失败率达 100%；降级 200 不满足“失败”，即使 MCP 全超时也不再达到 100% | 联合修订两份合同：降级不得算 fresh 健康；使用独立的新鲜性／业务探针判定假活；明确 A 类只约束页面业务读，不禁止 P1-81 的就绪探针拒绝 |
| R-05 | BLOCK | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:92,94-99`；`webui/docs/174-webui-entry-performance-spec.md:90-93`；`docs/qa/uat/suites/interactive-read-resilience/cases.md:132-136` | “同作用域、同投影、同代次”不足以证明身份隔离，10-B 也未覆盖读取与撤权交叠 | Spec 174 的既有键还含 `principalScope`；10-B 只写授权变化前撤下及事后读取，没有同作用域不同身份、视图服务期间撤权、授权与读取交叠的样本 | 把身份裁剪边界、权限版本、内容代次和请求时复核写成必要条件；10-B 增加两身份及在途竞态，响应写出前再次验证当前授权 |
| R-06 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:92,98,159`；`docs/plans/lucy-20261123-interactive-read-resilience-plan.md:176-177`；`docs/qa/uat/suites/interactive-read-resilience/cases.md:116-118` | 根因优先只覆盖 09-A／09-B，混压可全靠降级 200 满足状态码判据 | X2 只要求无压与局部故障先于兜底；09-C 没要求 WebUI fresh 正确内容、降级比例上限或持续降级失败 | 增加不启用降级的同口径混压对照；09-C／09-D 分别断言 fresh 正确内容、持续降级阈值与恢复，不允许只凭 200 计数通过 |
| R-07 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:86,90`；`docs/qa/uat/suites/interactive-read-resilience/cases.md:111-124`；`webui/server/admin/roles.ts:941-949` | B 类“窗口有上限”没有数值或 UAT 失败阈值，“自动恢复”也未区分必须核验的恢复 | P1-63 有 20 秒排空上限、P1-69 有 60 秒调用上限，但 09 只要求记账；`warming_up` 与 `ACCESS_RECOVERY_REQUIRED` 在本合同没有数值，后者文案要求先完成恢复核验 | 为每个 B 类原因登记起止事件、数值上限、出处和恢复前提；09 增加超线失败及计划窗负控，区分自动恢复与需显式核验的恢复 |
| R-08 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:101`；`docs/plans/lucy-20261123-interactive-read-resilience-plan.md:174`；`webui/src/app/navigation.ts:20-50,393-400`；`webui/docs/06-navigation-ia.md:81-110` | 两个指定来源不足以生成完整 tab 矩阵，且没有独立对账来防止收窄 | `NavItem` 没有 tab 清单；IA 未完整枚举页内 tab；登录账户路由在两类材料中分别写 `/admin/accounts` 与 `/admin/admins`；既有页面打开跑次另列出 27 页面＋28 个页签／分段检查点 | X0 由矩阵作者生成后，交委托人指定的独立复核者在 X1 前对账实际路由、页面组件和既有页面清单；封存来源版本、逐组数量、每格接口与差集，缺格及多余格均须解释 |
| R-09 | MAJOR | `docs/qa/uat/suites/interactive-read-resilience/cases.md:113-124` | 只有 09-A 固定每格 5 次；其余窗口的分母、内容正确性和页面就绪断言不完整，可低覆盖或假通过 | 09-B 没有每格次数；09-C 仅写轮换和 MCP 值核对，没有每格 WebUI 正确内容／就绪要求；09-D 没写逐格频率；09-E 没写每个可写对象的样本身份与分母 | 为每窗、每格、每必需接口固定计划数、有效数和首尝数；所有窗口核对业务内容、降级引用视图和页面状态，重试始终分列；200 空内容、旧内容或持续降级均不得充当 fresh 成功 |
| R-10 | MAJOR | `docs/qa/uat/suites/interactive-read-resilience/cases.md:117`；`docs/qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md:7,34`；`docs/qa/uat/suites/interactive-read-resilience/close-checklist-f5e4b14d.md:28-30` | 09-C 直接沿用 T2，却没有落实 A2 的宿主混杂因素要求 | 原跑次明确前台 Chrome、诊断实例和数据库共用 Docker Desktop 宿主；A2 要求排除或量化争用 | 09-C 预检须选择隔离前台／诊断负载，或记录争用占比并做对照证明结果不依赖该争用；保留宿主 CPU、内存和浏览器开销 |
| R-11 | MAJOR | `docs/specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md:189,202`；`docs/specs/lucy-20261123-interactive-read-resilience-spec.md:85` | P1-82 SC-04 仍要求真实构造 WebUI 局部 503，与 P1-75 的 A 类零目标冲突 | 两份合同在同一最终候选上没有说明应注入哪类故障；若注入 A 类，必然触发另一合同失败 | 联合裁定 P1-82 的故障类别与先后顺序；若改用 C 类，须明确这验证的是安全故障隔离而不是 A 类容量反例，不能用历史跑次冒充候选实测 |
| R-12 | MAJOR | `docs/specs/lucy-20261123-enabled-tables-load-state-honesty-spec.md:23,101-110`；`docs/specs/lucy-20261123-interactive-read-resilience-spec.md:92-99` | 降级 200 与三态诚实展示之间缺少状态映射 | P1-80 以“有成功 data”进入 success 并据此计算缺 Manifest／无效启用；带旧数据的 HTTP 200 不会自动成为第四种可区分状态 | 明确降级是独立展示状态，不得触发只适用于 fresh success 的判定或危险动作；把启用表范围的降级、混合连接及动作禁用加入 09／10 |
| R-13 | MAJOR | `docs/qa/uat/suites/interactive-read-resilience/cases.md:130-136` | 10-D 的“真实注入”不可直接执行，且缺环境安全边界 | 未指定故障点、触发方式、目标端点、预期规范码、隔离卷、恢复和清理核验；直接破坏存储文件会有不必要风险 | 在 Plan／R0 冻结可恢复的真实故障注入方案，优先使用隔离实例与一次性卷；证明故障确实到达存储／账本层，并在结束后核对恢复与无残留 |
| R-14 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:12`；`docs/qa/uat/suites/interactive-read-resilience/cases.md:101-107`；`docs/qa/uat/INDEX.md:13` | 08-B 的通过条件已改，却声称既有 SC-01–08 合同与证据不变，未说明旧证据的适用范围 | 旧 08-B 允许可重试 503，新条件明确首响应出现该错误即失败；INDEX 也保留了既有 B3 历史记录 | 原文保留历史证据，但声明其不能证明 v1.3 的 08-B；在最终候选上用新判定器重跑受影响子场景，并保留旧口径与新口径的差集 |
| R-15 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:109,183-193`；`docs/plans/lucy-20261123-interactive-read-resilience-plan.md:177-179` | OQ-3 同时包含接口形态与页面文案，但当前只阻断提示实现；Plan 还允许 X3 先于 X5 | X3 已需要使用降级标记，X5 才处理交互与术语；09／10 没有把 OQ-3 或交互合同缺失列为阻断条件 | 将 OQ-3 闭合、交互合同和术语登记同时设为 X3／X5 前置；09／10 对缺前置的情况记 BLOCKED，而不是仅约束页面提示 |
| R-16 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:92`；`webui/server/display-snapshot.ts:80-83`；`docs/qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md:15-17` | 把“既有 180 秒”统一用于 A 类读，混淆了两种既有宽限 | 当前合同材料中元数据宽限为 120 秒，全量摘要为 180 秒；跑次也分别注入两类边界 | 按快照类型和投影分别写宽限值、起算点及年龄字段；若拟统一改为 180 秒，应明确这是变更而不是“既有”事实 |
| R-17 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:92`；`inbox/p175-pressure-f5e4b14d/p0-log-analysis.md:21-35`；`docs/plans/lucy-20261123-interactive-read-resilience-plan.md:176` | 主 Spec 将候选机制写成“根因”，强于现有证据 | 日志复盘只说“符合”共享调度长期得不到服务，并明确不能区分队列饥饿、文件 I/O 与摘要子步骤未返回；Plan X2 反而正确写成假设 | 改为候选机制清单，并引用根因关闭条件；在唯一根因和排除其他项的证据出现前，不作确定性归因 |
| R-18 | MAJOR | `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:170-181`；`docs/qa/uat/suites/interactive-read-resilience/cases.md:115-136` | 画像补偿没有完整挂到可验证浏览器行为；运维方还漏评“503 信号被降级取代”的影响 | P2／P4 依赖年龄提示和手动刷新，但 09 只局部检查年龄，10 没有验证手动刷新成交；P3 的依据不含 SC-09／10；10-E 只证明纯 MCP 路径 | 为提示、年龄、手动刷新、恢复后 fresh 内容增加逐画像验收；补评 P3 运行观察面的代价与替代告警；10-E 保留为纯 MCP 主路径证明，但不代替 WebUI 补偿 |
| R-19 | MINOR | `docs/qa/uat/INDEX.md:13`；`docs/governance/DEVELOPMENT.md:305-315` | 测试台结果单元格混入开发授权状态 | P1-75 行在测试结果中同时写新增用例结果与“开发未授权”；该授权事实已在 Spec 和 suite 登记 | INDEX 只保留测试范围、跑次和结果；授权说明留在开发台及套件说明，避免三台互写 |
| R-20 | MINOR | `docs/plans/lucy-20261123-interactive-read-resilience-plan.md:5-9`；`docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md:6,17`；`docs/governance/DEVELOPMENT.md:193-203` | Plan 头部状态没有镜像扩容后的 Spec 现值；总账头部版本也落后于变更行 | Plan 仍写旧的 SC-01–08 状态句；总账头部为 v2.61，而最新变更行是 v2.62 | 按状态事实源同步 Plan 镜像，并将总账头部版本与最新变更行对齐 |

## 3. D1–D7 逐维度判定

### D1 白名单完整性与正确性：**有问题**

- 相关发现：R-01、R-02、R-03、R-07。完整出口见 §4。
- A 类漏项不只发生在理论路径：连接页的自动探测已在 `ConnectionOverview.tsx:487,538-542` 直接可见，因此 OQ-4 的“若仅用户主动触发”前提并不符合当前调用面。快照错误枚举也明显大于 §2.5 括号中的三项。
- B 类的数值上限不能从“有上限”这句自动推出。P1-63 的 20 秒与 P1-69 的 60 秒可作既有出处，但必须进入本用例的判定式；启动与恢复核验仍需各自裁定。
- C 类“压力下为零”与企业安全 Spec `:228` 的 16 客户端、5 分钟无 `SQLITE_BUSY` 503 预算方向一致，本身不冲突。问题在于同一存储忙可能透出 `SECURITY_STORE_UNAVAILABLE`、`STORE_UNAVAILABLE` 或其他别名；若不按底层原因映射，A／C 会互相抢归类。
- D 类不能仅按“请求由用户发起”划分。自动探测、页面刷新和写后自动复读都是页面行为；真正主动动作也需使用已登记的稳定原因码。

### D2 降级边界安全性：**有问题**

- 相关发现：R-04、R-05、R-06、R-16、R-17。
- §2.1 有响应前复核和真正授权变化前撤下视图的原则，§2.5 也排除撤权后的降级读取；但新增条款没有证明跨身份键和在途竞态闭合，10-B 的样本也不足以打假这些边界。
- Spec 195 头部指针明确标出草案、授权边界和原合同优先，不会让细心读者误以为原文已被静默改写；但原 Spec 195 的逾期不返回成功载荷、Spec 174 的 busy 条款仍需显式列入修订范围，见 R-01。
- 降级不能证明全量摘要恢复服务。当前只有无压冷读降级为零，不能阻止混压期间长期旧视图成为唯一结果。
- OQ-1 的默认草案没有年龄上限，也没有把持续降级设为约束生效的反例，因此不满足“既验约束、又验合法主路径”的要求；与 P1-81 的冲突是可直接由判定式推导的结果。

### D3 可验证性与可打假：**有问题**

- 相关发现：R-08、R-09、R-10、R-13、R-14、R-15。
- 09-A 的每格 5 次可作为“本轮观察样本中零事件”的固定分母，但不构成统计意义上的普遍零风险证明；真正的问题是其余窗口没有同等明确的分母与内容断言。
- 重试冲抵首响应、无压降级、缺前台证据已有明确禁止；200 空内容、长期旧内容、混压低覆盖和矩阵收窄仍未完全封住。
- “清单缺格则 BLOCKED”只能约束已经生成的清单，无法证明生成前的全集完整。应由非作者在 X0 后、X1 前独立对账，并记录来源差集。
- 09-C 必须落实 A2，而不是只复制 T2 的规模与时长。10-D 必须先有可恢复、可核验的真实故障方案。
- 08-B 的历史结果继续作为历史事实保留，但不能充当新判据的证据。

### D4 与其他合同的冲突或重叠：**有问题**

- 相关发现：R-01、R-04、R-07、R-11、R-12。
- P1-81：降级 200 会使 100% 失败判定失效；A 类“假活持续期间”的字面范围还需排除自愈所要求的探针转红。
- P1-82：SC-04 的真实 WebUI 局部 503 与 A 类零目标必须联合改写或重新指定故障类别。
- P1-63／P1-69：现有上限可复用，但主要合同分别针对整实例排空和 MCP 重载；WebUI 读取在窗口中的状态、页面提示、恢复与计时仍需由 09 明确验证，不能从 MCP 结果代签。
- `roles-agent-read-responsiveness`：最多一次自动重试、遵从 `Retry-After` 仍可保留给 B 类和网关故障，与 A 类为零没有必然冲突。降级 200 必须被识别为“非 fresh 成功”，不能清掉数据年龄或触发额外重试风暴。
- P1-80：HTTP 200 不等于可参与缺 Manifest 判定的 fresh success；必须补降级状态及动作边界。

### D5 第一性原理与画像：**有问题**

- 相关发现：R-04、R-05、R-06、R-15、R-18。
- 10-E 对“无 WebUI Cookie 的纯 MCP 合法 Agent”及被吊销身份作了正负例，是必要的，但不足以证明 WebUI 治理与管理查看任务的补偿路径，也不能发现降级导致的假活检测失明。
- P2／P4 已判负向并写出补偿意图，但手动刷新、年龄提示与恢复后 fresh 内容没有完整验收锚点。P3 需要补评故障信号变化及替代观测；P1 的纯 MCP 主路径仍应由 10-E 和既有 SC-03 共同保障。
- 新增提示的豁免例外已写明，但阻断范围过窄且未进入 SC；OQ-3、交互合同和术语登记必须成为相关实现与验收的共同前置。

### D6 治理与登记合规：**有问题**

- 相关发现：R-19、R-20；矩阵的导航事实问题见 R-08。
- Spec 头部、总账 P1-75 行、需求池 REQ-030-096 表格行与正文的现值句逐字一致；Plan 头部没有同步，详见 §6。
- 未发现把扩容写成已获开发授权的句子；Spec 授权边界和 Plan X 区均明确限制在设计与登记。
- 本次文档 diff 未改运行导航。矩阵“只读取现有菜单”本身不会授权改导航，但为补齐 tab 而读取实际路由／组件也不等于获得导航变更授权。
- 两个允许的 lint 均以退出码 0 结束；它们没有检出上述合同冲突和安全边界问题。

### D7 证据准确性：**有问题**

| 核对项 | 结果 | 证据 |
|---|---|---|
| 概览校准后首读 | 10 个有效前台样本均出现 `/api/sources` 与名册摘要首响应 503，主内容就绪为 0；引用准确 | `inbox/p175-pressure-f5e4b14d/browser-calibrated-scope.json:2-59`；跑次 `:52` |
| 停压后展示读 | 90 次展示读中 80 次 503、10 次超时；末次超时结束后约 133.6 秒，符合“约 134 秒” | `post-soak-crosscheck.jsonl` 的 503 计数为 80；12 条 timeout 中另 2 条属于独立 MCP 旅程；首条 `:1`、末组 `:125-128` |
| 探针 P99 | 汇总值与跑次一致：`livez` 直连／反代约 1.199／1.205 秒；`/api/project` 约 3.522／3.700 秒 | `t2-metrics.json:19-39,52-72`；`t2-probes.jsonl` 每类合计 1,800 条，即两入口各 900 条 |
| 503 忙碌日志原因 | `metadata_overdue` 250 条、`digest_overdue` 7 条，合计 257 条，引用准确 | `display-probe.log` 分别计数 250／7；忙碌事件总数 257 |
| 根因表述 | 对外原因与复盘假设在原材料中有区分，但主 Spec §2.5 又把候选机制直接称为根因 | `p0-log-analysis.md:23-26,32-35`；主 Spec `:92`；见 R-17 |

## 4. D1：非测试 503 出口归类表

枚举方法：读取 `webui/server/` 中全部 `503` 命中，排除测试、纯注释、摘要值和非 HTTP 出口，再沿错误类、通用错误处理与状态映射追踪。下表按相同错误码聚合同一文件内的等价出口；“建议 C／D”表示业务语义适合该类，但当前白名单仍未登记其真实代码，不能视为已闭合。

| 文件与行 | 触发条件／真实代码 | 建议类别 |
|---|---|---|
| `webui/server/display-snapshot.ts:89-109,921,1035` | `DISPLAY_SNAPSHOT_BUSY`：`metadata_overdue`、`digest_overdue`、`build_wait_timeout` | A |
| `webui/server/display-snapshot.ts:89-97,921,1035` | 同一错误的 `reconcile_failed`、`write_pending`、`build_capacity`、`generation_changed`、`context_mismatch`；现白名单未逐项登记 | 无法归类；`build_capacity` 可按容量原因补 A，其余须裁定 |
| `webui/server/admin/agents.ts:1155,1608,1624,1859`；`webui/server/admin/roles.ts:1113` | 名册／角色读取抛出快照错误，含 `reconcile_failed` 与 `generation_changed` | 随具体原因；当前存在未登记原因 |
| `webui/server/ktx.ts:20-27,88-90,121-123,165-167,205-207,270-272`；`webui/server/ktx-mcp-reload.ts:61-63` | 找不到 KTX CLI，`KTX_CLI_ERROR`；可用于主动测试、验证、重建、SQL 或重载 | 无法归类；须按读／写／主动动作与部署故障拆分 |
| `webui/server/background-probes.ts:23-31,142-160,189-202` | 队列关闭、队列满或旧代次结算，`PROBE_QUEUE_FULL`；连接页存在自动调用 | A；不能由 D 自动豁免 |
| `webui/server/background-probes.ts:49-57`；`webui/server/live-table-queue.ts:42` | 排队超过 60 秒，`PROBE_QUEUE_TIMEOUT` | A；当前未登记 |
| `webui/server/publish-coordinator.ts:119-126,491-495`；`webui/server/admin/access-roles-agent-concurrent-edit.ts:231-255` | 发布锁已被占用，`PUBLISH_COORDINATOR_BUSY` | 无法归类；这是写入／发布窗口忙，不是现 B 类四项之一 |
| `webui/server/index.ts:198-209` | 配置已保存但执行层未加载，`EXECUTION_RUNTIME_NOT_LOADED` | 无法归类；不能直接等同于计划内 `EXECUTION_RUNTIME_RELOADING` |
| `webui/server/index.ts:1021-1037`；`webui/server/runtime/process-drain.ts:32-39` | Web API 在整实例排空时拒绝新业务，`SERVICE_DRAINING` | B |
| `webui/server/index.ts:1104-1111` | 就绪探针在启动或排空时返回 `warming_up`／`draining` | B；`draining` 别名须显式映射 |
| `webui/server/index.ts:1113-1117` | 自愈判定后就绪探针以 `stuck` 拒绝 | 无法归类；须与 P1-81 联动，不能按页面 A 类一概禁止 |
| `webui/server/index.ts:2086-2091` | Schema 读取重验时会话存储不可用，`AUTH_STATE_UNAVAILABLE` | C |
| `webui/server/auth/guard.ts:122-132` | 全局管理 API 鉴权：管理员配置不可用为 `AUTH_CONFIG_UNAVAILABLE`；状态存储不可用为 `AUTH_STATE_UNAVAILABLE` | 前者无法归类；后者 C |
| `webui/server/auth/bootstrap.ts:39-40` | 引导过程中的状态存储失败，`AUTH_STATE_UNAVAILABLE` | C |
| `webui/server/auth/bootstrap.ts:146-152` | 管理员配置损坏，`AUTH_CONFIG_UNAVAILABLE` | 无法归类；不属于现 C 类存储／账本清单 |
| `webui/server/auth/bootstrap.ts:164-168` | 客户引导未配置密钥，`BOOTSTRAP_NOT_PROVISIONED` | D |
| `webui/server/auth/routes.ts:128,213` | 登录／引导时管理员配置不可用，`AUTH_CONFIG_UNAVAILABLE` | 无法归类 |
| `webui/server/auth/routes.ts:168,173-180,189,234-237,521-523,658-659,684-685,698,749-750,761-762,837-838,860-861,944-945,967-968` | 登录、退出、账户及身份绑定写入时状态／会话／认证事件存储失败，`AUTH_STATE_UNAVAILABLE` | C |
| `webui/server/auth/account-state.ts:114-120,148-150,174-176` | 会话签发辅助层返回 503，由上述路由映射为 `AUTH_STATE_UNAVAILABLE` | C |
| `webui/server/auth/rate-limit.ts:192-203` | 限速桶或安全存储不可用，`AUTH_STATE_UNAVAILABLE` | C |
| `webui/server/auth/oidc-routes.ts:120-142`；`webui/server/auth/routes.ts:289-296,799-804,893-901` | 主动开始 OIDC 或维护绑定时身份源不可用，`OIDC_NOT_AVAILABLE` | D |
| `webui/server/admin/tokens.ts:479-490` | 签发 Token 且要求客户端配置时 MCP 地址不可用，`MCP_ENDPOINT_UNAVAILABLE` | D |
| `webui/server/admin/tokens.ts:834-871` | Token 有效期已写但运行态确认失败，`RUNTIME_ACK_FAILED` | 无法归类；写后状态须另行裁定 |
| `webui/server/admin/notifications.ts:49-79` | 主动发测试邮件时配置或队列不可用，`NOTIFICATION_UNAVAILABLE`／`NOTIFICATION_QUEUE_UNAVAILABLE` | D |
| `webui/server/admin/mcp-playground.ts:149-167` | 主动 `tools/list` 试调时本机端点缺失或无效，实际代码为通用 `unavailable` | D；须显式映射到登记码 |
| `webui/server/semantic-asset-export.ts:444-471` | 含 Wiki／Skill 的导出无法写操作记录，`SECURITY_STORE_UNAVAILABLE` | C |
| `webui/server/wiki-access-batch.ts:475-483,658-663,803-810` | 批量 Wiki 授权的存储、日志写入或结果读取失败，`SECURITY_STORE_UNAVAILABLE` | C |
| `webui/server/wiki-access-operation.ts:474-490,519-528,680-698,731-740` | Wiki 授权持有判定、准备或提交失败，`SECURITY_STORE_UNAVAILABLE` | C |
| `webui/server/wiki-access-operation.ts:560-573` | 配置审计意图／回滚／底层 SQLite 故障被映射为 `config_audit_unavailable` | C；现白名单未登记该代码 |
| `webui/server/skills/writer.ts:141-153` | Skill 写入的审计意图无法持久化，`skill_audit_unavailable` | C；现白名单未登记该代码 |
| `webui/server/admin/access-roles-agent-concurrent-edit.ts:211-221`；`webui/server/admin/roles.ts:1318-1321,1673-1676,2232-2235` | 访问控制处于恢复待核验，`ACCESS_RECOVERY_REQUIRED` | B；恢复动作和窗口上限须另写 |
| `webui/server/admin/access-config.ts:722-743` | 写入终态 `recovery_required` 映射为 503 `ACCESS_RECOVERY_REQUIRED` | B |
| `webui/server/admin/roles.ts:1009-1014,2076-2082` | 角色 ID 退役状态读取或写入失败，`SECURITY_STORE_UNAVAILABLE` | C |
| `webui/server/admin/audit.ts:763-773` | 客户端观测写入前的安全存储预检失败，实际代码 `STORE_UNAVAILABLE` | C；现白名单未登记该代码 |
| `webui/server/admin/audit.ts:3215-3235` | 排队后的导出请求重验会话失败，`AUTH_STATE_UNAVAILABLE` | C |
| `webui/server/admin/audit.ts:4590-4602,4694-4704,4766-4775` | 审计关联修订或敏感读取的 meta-audit 存储失败，`META_AUDIT_STORE_UNAVAILABLE` | C；现白名单未登记该代码 |
| `webui/server/admin/audit.ts:4662-4675` | meta-audit 写入失败并回滚关联修订，`META_AUDIT_WRITE_FAILED` | C；现白名单未登记该代码 |
| `webui/server/admin/audit.ts:4843-4852,4936-4944` | `export-v2`／`export-pack-v2` 的安全存储或账本上界不可用，`SECURITY_STORE_UNAVAILABLE` | C |
| `webui/server/admin/audit-export-v2.ts:8-12` | 本文件只有合同注释，没有直接 503 写回；实际路由出口在上一行所列 `admin/audit.ts` | C；按实际路由归类 |
| `webui/server/admin/audit-reconciliation-routes.ts:153-190,631-645,733-743,865-876` | 对账读取的身份或 meta-audit 守卫失败，路由返回 `RECONCILIATION_READ_REFUSED` | C |
| `webui/server/admin/audit-reconciliation-routes.ts:722-724,855-857,994-996` | 对账无法取得安全账本上界，`RECONCILIATION_SECURITY_STORE_UNAVAILABLE` | C；现白名单未登记该代码 |
| `webui/server/audit/query-artifact-store.ts:109-121` | 审计详情读取缺少查询制品解密密钥，`ERR_QUERY_ARTIFACT_KEY_MISSING` | 无法归类；这是读取面的配置故障 |
| `webui/server/proxy/admission.ts:302-315` | MCP 入口 `received` 无法持久化，`AUDIT_UNAVAILABLE` | C |
| `webui/server/security/response-commit.ts:114-124,186-200,288-300` | MCP 响应准入或 prepare 失败，`AUDIT_UNAVAILABLE` | C |
| `webui/server/proxy/mcp-proxy.ts:6150-6164` | 问询预算持久状态不可用，503 JSON-RPC 错误 | C；须把实际 reason 显式映射到规范码 |
| `webui/server/proxy/mcp-proxy.ts:7027-7034` | 开题预算读取／写入失败，503 且携带动态 reason | C；实际 reason 未进入白名单 |
| `webui/server/proxy/mcp-proxy.ts:6486-6492,7659-7665,7962-7969,8766-8784`；`webui/server/runtime/mcp-process-work.ts:8-14` | MCP 在整实例排空或执行层重载时拒绝，`SERVICE_DRAINING`／`EXECUTION_RUNTIME_RELOADING` | B |

补充：`notifications/smtp-client.ts` 中的 503 是对上游 SMTP 响应的分类，不是 Lucy 自身 HTTP 503 出口；其余纯注释、测试断言和摘要哈希不计入表中。

## 5. 附加回答

### 5.1 OQ-1 到 OQ-4

| 开放项 | 建议 | 默认草案是否可接受 |
|---|---|---|
| OQ-1 | 不建议无限年龄仅加强提示。应定义最大可服务年龄、持续降级预算和独立 fresh 健康信号；超过预算至少触发运维告警与 P1-81 的故障输入，且不得继续被当作正常业务恢复 | **不可接受**；与 P1-81 的 100% 失败判定直接冲突，也缺少“约束生效”的反例 |
| OQ-2 | 终稿前必须选定一种并写清时限。若选“200＋构建中”，它是明确的非数据状态，不得当作内容正确或 `primaryReady`；若选延长等待，必须有绝对截止和恢复出口 | 作为待裁定占位可以，作为终稿默认不可以；当前两种方案还没有共同的时限与页面判据 |
| OQ-3 | 同时冻结接口字段／响应头语义、身份与代次、数据年龄来源、页面位置、文案和手动刷新行为；既有 `degraded` 的兼容含义须单独核对 | 方向可接受，但当前阻断只覆盖提示，需扩到所有相关实现与 09／10 前置 |
| OQ-4 | 应裁为“自动与主动均存在”，并覆盖 `PROBE_QUEUE_FULL` 与 `PROBE_QUEUE_TIMEOUT`；自动／页面加载归 A，主动动作是否归 D 仍需独立列出 | “若仅主动则 D”的条件已被当前前台调用事实否定，默认草案不可沿用 |

### 5.2 Docker 单进程下“A 类为零”能否实现

在**冻结的有限负载和具名局部故障**内，它不是逻辑上不可能的目标；但现有材料不能证明只靠根因修复即可达到。`f5e4b14d` 只证明当前候选失败，复盘尚未唯一确定根因，也没有同口径的根因修复对照。若“压力”不限定到达率、对象数和故障窗，则任何单进程实现都无法据此承诺普遍为零，因此合同必须保持当前冻结档位的边界。

不依赖降级 200 时，至少需要先回答无视图冷启动、4 秒等待截止、写入中读取和停压后持续饥饿分别如何成交；这些问题目前仍互相矛盾或开放。建议把“不启用降级的 09-C 同口径对照”作为可行性判据，而不是用状态码转换替代证明。

### 5.3 若只能删掉一件扩容内容

删除**“宽限外、无年龄上限的只读降级 200”**这一组草案，保留全页面原因矩阵、A 类反例、真实故障 fail-closed 和根因修复验收。待身份隔离、新鲜度上限、自愈联动及根因对照闭合后，再作为独立、可打假的变更评审。

### 5.4 需要委托人另行裁定的问题（按重要性排序，最多 5 条）

1. **降级与安全的边界**：是否接受旧视图长期服务；最大年龄、持续降级预算、身份键、撤权在途复核和 P1-81 的新鲜健康信号分别是什么。
2. **503 分类全集**：确认 §4 中每个未登记代码及快照 reason 的 A／B／C／D 归属，尤其是写入后的运行态失败、发布锁忙、配置损坏与 KTX 缺失。
3. **根因证明门槛**：是否要求在不启用降级的情况下先通过同口径混压；P1-82 SC-04 应改用何种真实故障，P1-81 如何识别持续降级。
4. **验收覆盖与测试环境**：指定矩阵的独立复核者、各窗每格分母和内容判据，并裁定 09-C 如何隔离或量化 Chrome／诊断实例的宿主争用。
5. **开放项与既有证据**：闭合 OQ-1 至 OQ-4、B 类数值上限和 10-D 的安全注入方案；确认旧 08-B 证据只保留历史意义，新口径须重新取证。

## 6. 状态镜像逐字比对与 lint 摘要

### 6.1 状态镜像

| 位置 | 比对结果 |
|---|---|
| `docs/specs/lucy-20261123-interactive-read-resilience-spec.md:10` | 事实源现值 |
| `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md:383` | 与事实源逐字相同 |
| `docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:90` | 与事实源逐字相同 |
| `docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:1549` | 与事实源逐字相同 |
| `docs/plans/lucy-20261123-interactive-read-resilience-plan.md:7` | 不同；仍是扩容前状态句，缺少本次扩容与授权边界，见 R-20 |

版本号另有一处不一致：总账头部 `:6` 为 v2.61，最新变更行 `:17` 为 v2.62。需求池头部 `:14` 与其 v0.163 变更行一致。

### 6.2 lint 输出摘要

`npm run lint:spec-docs`：退出码 0。

```text
Spec/Plan doc lint passed (597 files scanned, 1034 baseline exemptions).
```

`npm run lint:e2e-ledger`：退出码 0；逐项链接检查均为 `ok`，最终摘要为：

```text
PASSED: e2e ledger links
```

## 7. 未审阅项与原因

- 未运行 Docker、浏览器、UAT、压测、故障注入或业务请求；本报告只审合同、文档、源码事实和既有证据。
- 未评审工作树中运行代码的未提交差异，也未把 `webui/server/`、`scripts/runtime/`、`deploy/compose/` 的增量当作 v1.3 已实现内容；源码仅用于回答现有 503 出口和调用面。
- 未对所有页面组件逐一建立完整 tab 清单，因为 v1.3 的冻结矩阵尚不存在；R-08 正是据此要求独立对账，而不是推测一个全覆盖清单。
- 未用自定义计算脚本重算 P99；任务允许的命令范围不包含此类脚本。本报告核对了原始样本数量、错误样本与已封存的 `t2-metrics.json` 汇总，精确重算仍可由后续证据复核者补做。
- 未实际执行跨身份撤权攻击或存储破坏，因此 R-05 表示合同与验收不能证明边界闭合，不声称已观察到现实泄露。
