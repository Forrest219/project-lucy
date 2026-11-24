# 行权限能力评审：能否支撑约 100 用户、30–40 人行级受限

| 元数据 | 内容 |
|---|---|
| 文档名称 | 行权限能力评审（100 用户／30–40 人行级受限目标） |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-14 |
| 撰写人 | Cursor Agent（Claude） |
| 委托人 | xingchen |
| 基于材料 | 主 Spec [`lucy-20261022-v2p5-row-permission-management-spec.md`](../specs/lucy-20261022-v2p5-row-permission-management-spec.md)；[模板与视图 Spec](../specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md)；[视图呈现 Spec](../specs/lucy-20261030-row-policy-view-presentation-spec.md)；[P1-2 编译门禁草案](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md)；[ADR 行级策略后续迭代](../access-control/adr-row-policy-next-iteration.md)；Spec 99／100；`webui/server/proxy/{acl,row-policy,agent-constraints,mcp-proxy}.ts`、`webui/server/admin/{agents,roles}.ts`；分支 `lucy-v0.30` @ `94693db8`；本机 demo 实测（浏览器＋MCP） |
| 适用范围 | 委托人决定「行权限是否作为下阶段核心能力立项、先补什么」的输入；**仅评审，不含开发授权，不改任何 Spec 状态** |
| 输出位置 | `docs/reviews/2026-11-14-row-policy-capability-assessment.md` |

台账：总账 [P1-25](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)／REQ-030-046。本文不是 UAT 跑次，测试台 `not_registered`。**评审结论 ≠ UAT PASS ≠ 可上线。**

---

## 1. 结论

**安全内核可信，产品化不足。** 实测中，强制过滤真实落到了 SQL 的 `WHERE`（聚合之前），伪造放宽和常见绕行都被挡住，隔离结果与数据库逐值一致。

但「开箱即用地支撑 30–40 人行级受限」这件事今天**不成立**，卡在四处：

1. **默认部署下受限用户根本查不了数。** 行级取数依赖一个**全局**环境变量 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`，默认关闭。Helm Chart 和 K8s 交付契约都没有登记这个开关，而且它不区分连接或引擎。
2. **这个开关的回归证据当前是红的。** BY-01／BY-18 两条线上注入证明测试，被 0.30 新增的 P0-3 歧义门闩拦截，测试一直没有更新。
3. **配错不报错。** 行限制的取值是自由文本，保存时不做任何校验。实测 40 人里有 24 人配了库里不存在的取值，静默看到 0 行，系统没有任何提示。
4. **受限用户体验降级明显。** `lucy_read_source`、`lucy_freshness` 被拒，不能联查多张受保护表，拒绝提示还自相矛盾。

在规模上，100 个 Agent 下单次写入约 314ms、读接口低于 30ms，**性能不是瓶颈**；瓶颈在管理成本和呈现。

建议：先补 §6 里的 P0 四项，再谈「核心能力」交付。动态 RLS 和 SSO claim 映射对这个规模**不是必需的**，可以继续冻结。

---

## 2. 评估口径

| 维度 | 目标下的要求 |
|---|---|
| 隔离正确性 | 30–40 个受限用户只能看到自己范围内的行；任何工具面都不能绕开 |
| 可用性 | 受限用户的问答质量不能明显差于不受限用户 |
| 可配置性 | 管理员能低错误率地给 30–40 人配置、调整范围，并能核查 |
| 规模 | 100 个 Agent 下写入、读取和热路径性能可接受 |
| 可交付 | 在已验证的客户交付形态（K8s／Helm）下能启用、能验收 |

---

## 3. 方法与证据

| 步骤 | 做了什么 | 结果 |
|---|---|---|
| Spec 审阅 | 主 Spec §1–§14（含替代条款）、模板与视图、呈现、P1-2 草案、ADR、Spec 99／100、runbook、KTX 载体证据 | 见 §4、§5 |
| 代码核对 | 沿「Role／Agent 配置 → 预编译 → `authorizeAndRewrite` → `forced_filters` → KTX／Hive → 审计」逐段对照 | 见 §4 |
| 自动化 | `vitest` 行权限相关 21 个文件 | **252 通过、2 失败**（BY-01、BY-18，原因见 R2） |
| demo 校验 | 宿主机与容器 `/app` 关键源码 sha256 一致，**未重建** | 运行的是当前代码 |
| 浏览器实测 | 以 `verify-admin` 身份新建 Role、用 UI 添加行策略、看预览、确认保存、看行权限视图、Agent 个人行限制编辑器 | 见 §8 |
| 规模实测 | 通过同源 admin API 建 98 个 Agent（共 100 个），其中 40 个带个人行限制，记录每次写入耗时 | 见 §8.2 |
| MCP 实测 | 给 1 个受限 Agent 签发测试 Token；分别在 proven 关闭、临时打开两种状态下调 `lucy_query` 等工具 | 见 §8.3 |
| 清理 | 98 个 Agent（连同 Token）和 2 个 Role 已删除；demo 恢复为 proven 未设置；Token 文件和临时脚本已删除 | `access.yaml` 中 `rpeval` 出现 0 次，用户数为 2 |

---

## 4. 能力矩阵（Spec ／ 代码 ／ 实测）

| 能力 | Spec 规定 | 代码 | 实测 |
|---|---|---|---|
| Role 级静态行策略（`eq`／`in` 字面量） | Spec 99 | 有 | 通过（UI 字段下拉 → 预览 → 确认保存，约 205ms） |
| Agent 个人行限制（AND 收窄） | Spec 100 | 有 | 通过（预编译与逐 Agent 最终行约束正确） |
| 强制过滤注入并剥离伪造字段 | Spec 99 §6 | `applyLucyQueryForcedFilters` | 通过：SQL 带 `WHERE region IN ('East')`；伪造放宽被剥离 |
| 受保护源上未包装工具拒绝 | Spec 99 §5 | `ROW_POLICY_UNWRAPPED_TOOLS` | 通过（`lucy_read_source`／`lucy_freshness` 被拒） |
| 形状门禁（字符串 filter／OR 树／`expr` 度量） | Spec 99 | `validateProtectedLucyQueryArgs` | 通过 |
| 度量作谓词字段本机拒绝 | P1-2 草案（冻结） | 无 | **未拦截，请求发到上游执行**（无泄漏，见 R7） |
| proven 开关 | runbook：Gate C 后由运维置真 | 全局环境变量 | 默认关闭 → 受限用户全部被拒（R1） |
| 保存前最终行约束预览与确认 | 主 Spec R2／§14.2 | 有 | 通过；呈现有误导（R6） |
| 配置审计（intent → 写入 → terminal，带 diff） | 主 Spec R4 | 有 | 写入返回 `auditId`、`operationId`；Agent 约束摘要只有布尔值，内容在 diff 里 |
| 字段诊断（四元组、三分归因） | 主 Spec R5 | 有 | 未专测（单测覆盖） |
| 模板（Role 侧） | 模板 Spec | 有 | 页面可见；**Agent 约束不能引用模板** |
| 行权限视图（按表反查） | 模板与视图 Spec | 有 | 详情正确；**列表摘要忽略个人约束**（R6） |
| 取值校验或候选提示 | **无** | 无 | 24／40 配错且无提示（R3） |
| 批量导入、按约束分组 | **无** | 无 | — |
| 认证路线／报告模板走同一 ACL | Spec 162 | `forwardAuthorizedLucyQuery` | 代码核实 |

---

## 5. 认同意见

**A1. 安全内核方向正确，并且实测成立。** 谓词只能是编译期字面量；注入由 Proxy 完成，不交给模型；任何失败都关闭；伪造 `forced_filters` 会被剥离；受保护源只留 `lucy_query` 一条取数通道。实测中 `rpeval_u01`（East）只拿到 East 一行（550,670.82／371 单），与库内 `GROUP BY region` 结果逐值一致。

**A2. 「Role 并集 + 个人约束交集」的代数清楚，足够表达 30–40 人的差异。** DNF 物化、矛盾分支剪枝和精确上限（每源 Role 分支 16、DNF 分支 64）都写死在 Spec 100 里。100 人这个规模远低于上限。

**A3. 运行时性能合理。** 策略提交时为全部用户预编译（`acl.ts` `byUserId`），请求热路径只查内存。实测 100 个 Agent 下：`/api/admin/agents` 27ms（269KB），行权限视图接口 25ms，单 Agent 有效权限 30ms。

**A4. 变更安全网完整。** 保存前 dryRun，确认框给出结构化变化、风险等级、受影响 Agent 和完整 YAML diff；`policyVersion` 热切换不需要重启；审计记录 intent 和 terminal。

**A5. 没有旁路。** `tables:["*"]` 只出现在旧式直配路径，而那条路径一旦带个人约束就会被拒，所以「通配表跳过行策略」走不通（`acl.ts:1706-1716`、`:3488`）。认证路线和报告模板复用同一个 `authorizeAndRewrite`（`mcp-proxy.ts:7358`）。答复可核对块会披露「行权限注入 1 条强制过滤（值已省略）」。

**A6. 认同 ADR「静态优先、动态另批」，但有前提。** 30–40 人、维度有限时，静态字面量配合个人约束能覆盖需求，没必要为此打开 Dynamic RLS 或 SSO claim 映射。前提是 §6 的管理工具补齐，否则静态模型的维护成本会抵消它的简单性。

**A7. Role 侧的编辑器设计得好。** 字段只能从「可证明为行级的物理列」下拉里选，度量不出现在列表里，从源头上杜绝了字段名拼错。

---

## 6. 反对意见与风险

严重度：**阻断**＝不解决就无法交付目标；**高**＝能交付但大概率出事故或被弃用；**中**、**低**依次递减。

### R1【阻断】默认部署下行级取数不可用，开关是全局的，交付面也没有登记

- 事实：`isUpstreamForcedPredicateProven()` 只读环境变量 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`，默认关闭（`row-policy.ts:76-79`）。关闭时所有受保护源上的 `lucy_query` 都返回 `row_policy_upstream_unproven`，本次 MCP 实测已复现。
- 开关不区分连接或引擎。一旦打开，Doris、Hive、SQL Server 等**所有**连接都会被当作「上游已证明」，而 Gate C 的行集抽检只覆盖过 bundled KTX + MySQL 这条路径。
- `deploy/k8s/helm/lucy` 的 values 和 `K8S_CONTRACT.md` 都没有这个开关的条目和验收项。能通过 `env`／`extraEnvFrom` 注入，但属于「没人知道的旋钮」。
- 反对点：主 Spec 和 runbook 把它当作「运维变更」，可它实际上就是行权限的产品总开关。要让 30–40 人用起来，它必须按连接（或引擎）粒度声明，并写进交付契约和验收清单。

### R2【阻断】proven 的回归证据当前分支为红

- 事实：`mcp-proxy-row-policy-by01-by18.test.ts` 的 BY-01（线上注入与行集）和 BY-18（explain 本地诊断）失败。真实返回是 `source_ambiguity_gate（表级歧义：请先确认来源表）`，0.30 的 P0-3 门闩在行策略之前就拦下了请求，测试夹具没有随之更新。
- 影响：runbook 的「proven 置真检查单」要求这组测试全绿。现在打开 proven，就是在没有回归证据的情况下打开。这不是越权（方向是失败关闭），但这条「证明」链断了。
- 反对点：P0-3 收口时没有把行权限的证明测试纳入回归面，说明行权限缺一个跨功能的守门用例集。

### R3【高】取值是自由文本，配错不报错，结果是静默 0 行

- 实测：给 40 人配置了 `West`／`Central`／`South`／`East`／`East,West`，库里实际只有 `Northeast`、`Southwest`、`East`、`Central South`。**24 人配了不存在的取值**，保存全部成功，没有任何警告；查询返回 0 行；空结果的 `next_tools` 指向 `lucy_read_source`、`lucy_freshness`，而这两个工具对受限用户恰恰被拒。
- Agent 个人约束编辑器（这 30–40 人主要依赖的入口）的**字段也是自由文本**，和 Role 编辑器的字段下拉不一致，输入框也没有 `aria-label`。
- 反对点：主 Spec 只要求「字段可证明为行级」，没有任何「取值存在性」要求。对真实客户来说，配错范围导致看不到数据，和越权同样是事故，只是方向相反。

### R4【高】受限用户成了「二等公民」

- 在受保护源上，`lucy_read_source`、`lucy_freshness`、`entity_details`、`sl_validate` 一律拒绝；多张受保护表不能出现在同一个查询里（`row_policy_query_shape_forbidden`，`acl.ts:3529`）；`expr` 度量也被拒。
- 运行时指导（`data-qa-instructions.md`）要求取数前先确认 source。受限用户拿不到字段说明和新鲜度，模型更容易猜字段、猜口径。
- 拒绝提示自相矛盾：拒绝 `superstore_orders` 时，修复建议写的是「请改用当前角色已授权的来源：superstore_orders」，模型容易陷入重试循环。
- 反对点：ADR §2.1 把 `lucy_read_source` 与取数一并拒绝，理由是防止样本行泄漏。我认同不能泄漏样本，但反对整工具拒绝：字段、口径、说明这些元数据不涉及任何行。应当提供「包装版」：剥掉样本值，保留元数据。

### R5【高】30–40 人的管理成本没有工具支撑

- Agent 个人约束**不能引用模板**（模板只挂在 Role 表选择器上），没有批量导入／导出，没有「同一约束的人」分组视图。
- Agent 和 Token 全靠手工创建。OIDC 只管 WebUI 登录，明确不从 IdP 组或 claim 推导任何东西（OIDC Spec D02）。人员入职、调岗、离职全部手工。
- 反对点：主 Spec 的范围是「管理面 R1–R5」，但它没有任何多用户运营的非功能需求（多少人、多少张表、多少种范围、改一次范围要动几处）。模板只解决了「同一谓词复制到 N 张表」，没有解决「同一范围分配给 N 个人」，而后者才是 30–40 人场景的主成本。

### R6【中】行权限视图和预览会误导安全核查

- 行权限视图的列表：`superstore_orders` 上 99 个 Agent、其中 40 人带个人约束，「有效行授予」一栏仍然显示「行权限：全部行」；勾上「仅受限表」后，这张表的摘要依旧是「全部行」。安全评审者扫一眼列表，会得出「这张表没有行限制」的结论。
- Role 编辑页的预览大标题是**这张表上所有 Role 的全局并集**，把 `demo_readonly`、`lucy_admin` 这类不相关的 Role 也算进去了。正在把 Role 改成「仅 East」的管理员看到的是「行权限：全部行」。
- 详情页把 99 个 Agent 平铺成一长列，不能按约束分组或只看受限人员；`candidateDigest` 哈希直接显示给管理员。
- 反对点：§14.5「全局展示并集」作为合同本身没有错，但「全局并集」不应该是页面上的主结论。对编辑者来说，主结论应该是「持有本 Role 的人看到什么」；对核查者来说，主结论应该是「受限人数／不受限人数」。

### R7【中】度量作过滤字段没有在本机拦截（P1-2 实测复现）

- 实测：在 proven 打开时，`filters:[{field:"superstore_orders.total_sales",op:"gt",value:0}]` 被放行并在上游执行，返回结果。强制 `WHERE` 仍然生效，**没有泄漏**。
- 这和 P1-2 草案的根因 R1 一致。该条目目前「终稿未确权、冻结」。如果行权限升为核心能力，它应该和 R1／R2 一起解冻。

### R8【低中】取值枚举类工具不受行策略管辖，只是被另一条规则偶然挡住

- `dictionary_search`／`discover_data` 返回的是画像采样得到的真实取值，被归为 Meta 工具，不经过行策略。它们之所以被拒，是「敏感前缀表」规则：必须存在 `dataforai.kx_` 前缀的表，并且用户对这些表全部有授权（`acl.ts:778-781`）。没有这类表时，所有人都被拒。
- 反对点：ADR §2.1 明确要求「维度取值列举」在受保护源上默认拒绝，但代码里没有这条行策略语义。一旦有人为了改善问答体验放宽这条前缀规则，就会泄漏其他范围的取值。

### R9【低】边角不一致

- 用户 filter 与强制范围不相交：KTX 路径返回空结果；Hive 路径（`hive/row-policy.ts` 第 4 条）规定拒绝。
- 删除一个**没有任何引用**的限定行 Role，同样要求先拿预览确认（`ROW_POLICY_PREVIEW_REQUIRED`）。安全上没问题，但会挡住批量清理。

### R10【残余风险，未实测】业务 Wiki／Skill 内容不受行权限约束

Wiki／Skill 只有对象级 ACL（`context-acl.ts`）。如果 Wiki 里写了按区域拆分的数字，受限用户能通过 `wiki_read` 读到其他区域的数据。这属于内容治理问题，需要在交付规范中约束，或给 Wiki 加范围标签。

### 对 Spec 文档本身的意见

- **反对：现行合同不可读。** 主 Spec 1043 行，靠 §13 实施回写和 §14 替代条款层层覆盖原文，冲突优先级要先读 §14.1 才知道。新人或客户安全评审几乎不可能从中提取「现在到底怎么工作」。建议另出一页「行权限现行合同（单页）」，旧文只做追溯。
- **反对：缺少面向多用户的需求。** 现有 SC 和 V 系列测的是正确性，没有测可运营性：规模、配错率、受限用户体验、交付开关都没有。
- **认同：** Non-Claim 的边界写得清楚（不宣称 Dynamic RLS、多租户、TokenScope），这能防止对外过度承诺。

---

## 7. 面向目标的建议

### 7.1 建模选择：30–40 人怎么配

| 方案 | 做法 | 适用 | 风险 |
|---|---|---|---|
| A 个人约束（ADR 推荐，现状可用） | 所有人共用一个全部行的 Role，每人在 Agent 上写个人约束 | 每个人的范围都不同 | 维护量约等于人数 × 表数；必须先补 R3、R5 |
| B 范围 Role | 每种范围一个限定行 Role（例如 6 个大区就是 6 个 Role），人只挂对应的 Role | 范围种类远少于人数 | 一个人挂两个范围 Role 会**取并集放宽**，必须靠流程避免 |
| A+B 混合 | 大多数人用 B；少数例外用 A 收窄 | 一般企业组织 | 呈现层需要能同时看懂两层（R6） |

是否可行取决于这 30–40 人有多少种**不同的范围**、涉及多少张表，需要委托人提供。

### 7.2 优先级建议（仅建议，不构成排期或授权）

**P0：不补就无法交付目标**

1. proven 开关按连接（或引擎）粒度声明，写进 Helm values 和 `K8S_CONTRACT.md`，并补对应的验收项。（R1）
2. 修复 BY-01／BY-18 夹具，让它们先走 P0-3 门闩，并把行权限证明用例纳入 0.30 回归集。（R2）
3. 保存时对取值做存在性校验：给出候选值或至少警告「库中不存在该取值」；Agent 约束编辑器的字段改为下拉，和 Role 编辑器一致。（R3）
4. 行权限视图的列表摘要计入个人约束，显示「受限人数／不受限人数」；Role 预览的主结论改为「持有本 Role 的人看到什么」。（R6）

**P1：决定 30–40 人能不能长期运营**

5. 提供包装版 `lucy_read_source`（剥掉样本值，保留元数据和口径）；修正拒绝时的修复提示。（R4）
6. Agent 约束支持引用模板；支持 CSV 批量导入／导出个人约束，并附 dryRun 报告；视图按约束分组。（R5）
7. 解冻 P1-2（度量／派生列谓词本机拒绝 + 拒绝码统一）。（R7）
8. 把取值枚举类工具（`dictionary_search`／`discover_data`）明确纳入受保护源拒绝矩阵，不再依赖敏感前缀规则。（R8）

**P2：规模更大或有 SSO 诉求时再议**

9. OIDC 组到 Role 的映射、Dynamic claim 都受冻结 ADR 约束，100 人规模下不建议优先做。
10. 出一页「行权限现行合同」，同时给 Wiki 加范围标签或内容规范。（R10）

### 7.3 对 0.30 排期的提示

总账里行权限目前是 **P1 正确性辅线**（P1-2 冻结，P1-7 待重开），核心方向文档也把它放在辅线。委托人现在把它定为下阶段核心，这和现行排期不一致。要么在 0.30 内把 §7.2 的 P0 立成新条目，要么明确留到下一个产品线。这个决定由委托人做，本文不代为改优先级。

---

## 8. 实测记录

### 8.1 浏览器（管理员 `verify-admin`）

| 步骤 | 观察 |
|---|---|
| Role 详情 → 行级策略 → 编辑 → 添加条件 | 字段是物理列下拉（30 列，度量不在其中）；运算符只有「等于／属于」；取值是自由文本 |
| 应用后 | 提示「受行级策略保护的表上，`lucy_read_source`、`lucy_freshness` 会被运行时拒绝」 |
| 展开「最终行约束预览」 | 大标题为「角色并集：全部行」，来源 Role 包括 `demo_readonly`、`lucy_admin` 等无关 Role；显示 `candidateDigest=…` |
| 保存 | 确认框给出结构化变化、风险「权限收缩」和完整 YAML diff；确认后约 205ms 写入，toast 显示 `policyVersion` |
| 行权限视图（100 Agent） | 列表：`superstore_orders` 4 个 Role、99 个 Agent，「有效行授予：全部行」；「仅受限表」筛选下摘要不变；详情页逐个列出 99 个 Agent 的最终行约束，计算正确 |
| Agent 详情 → 个人行限制 | 字段、取值都是自由文本输入框，没有 `aria-label`；没有模板入口 |
| 删除 0 引用的限定行 Role | API 直接调用返回 409 `ROW_POLICY_PREVIEW_REQUIRED`；通过 UI 确认框可以删除 |

截图接口在本次会话中持续超时，页面状态改用 DOM 文本读取作为证据。

### 8.2 规模（单 demo、单表，管理员 API 串行写入）

| 指标 | 结果 |
|---|---|
| 建 Agent／写个人约束（2 → 42 个 Agent） | 每次 70–90ms 增长到 230–245ms，近似线性，每多 1 个 Agent 约增加 4ms |
| 建 Agent（42 → 100 个） | 239ms → 314ms |
| 读接口（100 个 Agent） | `/api/admin/agents` 27ms／269KB；`/api/admin/roles` 29ms；`row-policy/views/tables` 25ms；单 Agent 有效权限 30ms |

注意：真实环境里每个 Agent 会涉及多张表，写入耗时会按表数放大。100 人一次性开通约等于 100 次写入，按当前数据约 30 秒。

### 8.3 MCP（受限 Agent `rpeval_u01`）

| 场景 | proven 关闭 | proven 临时打开 |
|---|---|---|
| `lucy_catalog` | 可见 `superstore_orders` | — |
| 直接 `lucy_query` | `row_policy_upstream_unproven` | `source_ambiguity_gate`（需先 `lucy_begin_question`） |
| `begin_question` 后按区域汇总（约束 `West`） | — | 0 行，SQL 为 `WHERE (region IN ('West'))` |
| 同上（约束改为 `East`） | — | 1 行 East：550,670.82／371 单，与库内一致 |
| 自带 `region = Northeast` | — | 空结果（不泄漏） |
| 伪造 `forced_filters` 放宽到全部区域 | — | 仍然只返回 East |
| 度量作过滤 `total_sales > 0` | — | **放行并执行**，结果仍限 East |
| `expr` 度量／OR 树 filter | — | 拒绝 |
| `lucy_read_source`／`lucy_freshness` | `row_policy_requires_wrapped_tool` | 同左 |
| `dictionary_search`／`discover_data` | `sensitive_metadata_forbidden:kx`（敏感前缀规则，不是行策略） | — |

demo 库实际区域取值：`Northeast` 213、`Southwest` 184、`East` 371、`Central South` 232 行。

---

## 9. 未覆盖与不确定项

- 只验证了 MySQL demo 单表；Doris、StarRocks、Hive、SQL Server 上的强制过滤**没有实测**（R1 的风险正来源于此）。
- 没有测客户 K8s 形态，也没有测高并发下的热路径延迟。
- Wiki／Skill 内容泄漏（R10）只做了设计层面的分析。
- 字段诊断（R5 四元组）、配置审计的故障回滚路径依赖既有单测，本次没有重放。

## 10. 不授权声明

本文是评审意见，不改变任何 Spec 状态，不构成立项、终稿确权或开发授权。§7 的优先级只是建议，进入实施前须按 DEVELOPMENT 入总账、开 Spec、终稿确权，并由委托人另发开发授权。
