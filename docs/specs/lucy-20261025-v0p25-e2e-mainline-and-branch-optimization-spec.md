# Lucy v0.25 E2E 主线与旁线优化 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 测试架构设计基线 / v0.3-final |
| 日期 / 分支 | 2026-10-25 / `lucy-v0.25` |
| 范围 | 现有真实用户 E2E、WebUI E2E、P0／P1 新增功能与交付场景 |
| 状态 | **实施中**（W0 已授权启动）。实施计划 `docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md`；未执行浏览器、E2E、真实 Agent、升级或客户交付验证 |
| 权威功能基线 | [P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md)、[P1 实施计划](../plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md) |
| 现有 E2E 基线 | [企业安全与真实 E2E Spec](lucy-20261018-enterprise-security-and-real-e2e-spec.md)、[真实用户 E2E 运行手册](../runbooks/real-user-e2e.md) |
| 评审与签核 | [设计评审记录](../reviews/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-review.md) §4／§7／§8 |
| 实施入口 | [E2E 主线与旁线优化 Plan](../plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md) |

本文只定义测试组织、场景归属、执行合同与证据要求，不改变任何功能 Spec 的验收语义，不声明相关功能已经实现或通过验收。批准范围为设计基线本身与 W0 实施；W1 及以后按 Plan 依序推进，不得因本文获批而推定任何功能验收已通过。

---

## 1. 结论与设计决策

### 1.1 唯一主线

保留现有 **J-01 / UX-01** 作为唯一用户主线，不新增 J-02，也不把 `E2E-PUB-01`、`E2E-ONBOARD-EVAL` 或 `E2E-AGENT` 再定义为平行主线。

主线只覆盖最高频的真实端到端旅程：

> 登录／必要引导 → 新建连接 → 启用表与维护语义 → 校验并生效 → 新建 Role／Agent／Token → 复制本实例 MCP 配置 → 真实 Agent 问答与同会话追问 → 查询本次审计与对账。

主线侧重**广度和状态连续性**，不承载数据库类型矩阵、权限组合、批量边界、故障注入、历史回放或升级恢复等低频深度场景。J-01 使用 `journeyId=J25-01` 作为聚合身份，八阶段是 `stages[]`，冻结的 UX-01-V01–V03 继续作为证据变体；不新增八个独立 executionId。

### 1.2 六类旁线

旁线按单一责任域拆分，分别为 `CONN`、`SEM`、`ACCESS`、`OBSERVE`、`AGENT`、`LIFECYCLE`。每个既有冻结 variant、新增 P0／P1 执行项和后续新增场景都只有一个主责任域；跨域验证通过引用同一事实和证据完成，不复制成另一条“全流程”。

MECE 的机械校验对象包括两部分：**既有 32 场景／255 个 required variants**，以及 **160 个 P0／P1 新增需求执行项**。既有 SEC／UX／OPS／GATE ID 直接保留并归域，不因原稿未列映射而复制成新编号。

### 1.3 编号、证据与门禁分离

- 保留功能 Spec 原验收编号作为 `requirementId`，不改写原功能 Spec。
- 既有冻结 variant 继续以原 catalog ID 作为 executionId；只有 160 个 P0／P1 需求映射和真正新增场景使用 `<前缀>25-*`，避免多个 `V01`、新旧 `UPG-*` 和不同 `SC-*` 相互冲突。
- `AGT25-*` 仅保留给未来新增 Agent 场景；UX-02–UX-06 不复制为 AGT25。UX-07-S01 直接承接既有日志对账，LOG25 只覆盖其未包含的新增跨轮次分析。
- 新映射先进入独立的 v0.25 覆盖清单和证据命名空间；**不直接修改当前冻结的 32 个场景、255 个 required variants，不重算发布分母**。
- `passed` 只能来自对应层级的真实证据；实现完成、文档评审、静态检查、单元测试和历史通过记录均不能替代运行时验收。

---

## 2. 审阅依据与现状判断

### 2.1 已审阅的事实源

| 类别 | 事实源 | 本次审阅重点 |
|---|---|---|
| P0 功能 | [审计增量](lucy-20261020-v2p5-audit-increment-spec.md)、[行权限管理](lucy-20261022-v2p5-row-permission-management-spec.md)、[语义资产批量维护](lucy-20261020-v2p5-semantic-batch-operations-spec.md)、[审计只读对账](lucy-20261024-v0p25-audit-reconciliation-view-spec.md) | A01–A12、四组 V 系列、真实故障与运行证据 |
| P1 功能 | [行策略模板与按表反查](lucy-20261025-v0p25-row-policy-templates-and-view-spec.md)、[授权摘要](lucy-20261025-v0p25-access-authorization-summary-spec.md)、[访问关系图](../../webui/docs/187-access-relation-sankey-spec.md)、[Hive 直连](lucy-20261025-v0p25-hive-direct-connection-spec.md) | RTP／RTV／ASV／SC／Hive V 系列的责任域与测试层 |
| P1 交付 | [升级 E2E](lucy-20261025-v0p25-upgrade-e2e-automation-spec.md)、[升级候选验证](lucy-20261025-v0p25-upgrade-candidate-verification-spec.md) | 新旧 UPG 冲突、非门禁边界、真实环境依赖 |
| 主线实现 | `scripts/e2e/lib/mainline-scenarios.mjs`、`webui/tests/real-e2e/mainline-journey.spec.ts` | 声明的八步合同与实际驱动方式是否一致 |
| 既有测试资产 | `webui/tests/`、`scripts/e2e/`、`docs/qa/`、`.github/workflows/lucy-release.yml` | 重复主线、缺口、证据链与发布绑定 |

### 2.2 关键发现

| 级别 | 发现 | 影响 | 优化决定 |
|---|---|---|---|
| P0 | J-01 文件头把自身定义为 structural contract；连接、Wiki、发布等关键步骤存在 `page.request` 直接写入 | 能证明接口或结构合同，不能完整证明同一运行中的真实 UI 用户旅程 | 修复 J-01 的驱动方式和阶段状态交接，不另建主线 |
| P0 | J-01 使用预置 `e2e_finance`，MCP `initialize`／`tools/call` 与真实 Agent 问答是不同证据 | 预置 Agent／Token 和协议调用不能替代“用户新建并复制配置后，由真实 Agent 自主问答” | 主线创建专用 Role／Agent／Token，真实 Agent 使用复制配置执行问题 |
| P0 | P0／P1 大量验收仍标为未执行；P1 实施计划明确交付链仍为 `blocked_delivery` | 不能把代码、单测或设计完成转记为 E2E 通过 | 覆盖清单逐项记录证据层级、环境、状态和来源 |
| P1 | 发布、主题接入、Agent、人工用户旅程各自具有“主链路”叙事 | 责任重叠，易重复建设而遗漏深度场景 | 全部映射到唯一主线或六类旁线，不再扩张平行主线 |
| P1 | 多份功能 Spec 各自使用 V01；新旧 UPG 含义不同；访问关系图 SC 与其他 SC 可能冲突 | 报告、筛选、门禁和追踪容易串号 | `requirementId` 与唯一 `executionId` 解耦，保留 legacy 映射 |
| P1 | 旧 WebUI E2E 文档中的部分 selector、路由、文案和 impact map 未覆盖新页面 | 文档不能可靠指导定位和影响分析 | 在后续波次做活文档收敛，不在本次静态审阅中假装已修复 |
| P1 | Hive 编译侧、真实 HS2、客户 amd64、真实旧版和真实备份具有不同环境边界 | 单侧通过容易被误写为端到端支持或客户交付通过 | 每证据维度独立记录；缺环境为 `blocked`，不降级为通过 |

### 2.3 当前证据边界

本 Spec 的“现状”是静态代码与文档审阅结论，不是测试运行结论。尤其是：

1. [真实用户 E2E 运行手册](../runbooks/real-user-e2e.md)仍披露部分 `handler_not_implemented`；存在文件或历史结果不等于当前全链路可运行。
2. P0／P1 功能 Spec 中的“实施回写”不产生验收证据；原验收编号在取得真实证据前仍保持未执行。
3. 当前 P1 实施范围只承诺 Hive 编译侧，以及升级执行器、profile、产物和拒绝路径；真实 HS2、真实旧版升级和真实备份恢复不得因此被写成已通过。
4. 当前发布工作流已将同一候选 digest 绑定到 security／management／agent 和 readiness。新增主线必须复用该身份与证据体系，而不是建立弱化的第二发布通道。

---

## 3. 目标与非目标

### 3.1 目标

1. 让 J-01 成为可由证据复核的单一连续用户旅程，而非多个接口检查的集合。
2. 让旁线按 MECE 原则覆盖单点深度，避免跨域重复、遗漏和相互替代。
3. 为全部 P0／P1 验收编号建立唯一执行身份、主责任域、必需证据层级和环境要求。
4. 统一真实 Agent、独立 gold、审计关联、快照和产物要求。
5. 在不破坏冻结发布目录的前提下，为后续是否纳入发布门禁提供可评审输入。

### 3.2 非目标

- 不修改功能需求、权限代数、审计状态机、预算值、发布流程或 KTX。
- 不把所有验收项塞入 J-01，不以主线运行时间最短为由删除必要真实动作。
- 不用 `page.request`、MCP `tools/call`、组件测试或静态截图替代其不能证明的层级。
- 不默认执行移动窄屏测试，不扩大浏览器矩阵。
- 不修改 required check、冻结 case catalog／lock、发布分母或历史证据。
- 不在本 Spec 中承诺真实 HS2、真实客户升级或客户交付已经可用。

---

## 4. 唯一主线 J-01 的连续执行合同

### 4.1 总体不变量

1. **同一实例、同一运行、同一状态链**：所有写步骤消费前一步骤产生的受控状态；不得重新发现或改用预置同名对象冒充连续旅程。
2. **UI 动作由浏览器完成**：声明为用户操作的步骤必须经真实页面和控件驱动；直接 API 只允许受控 setup、故障注入和只读 oracle。
3. **真实 Agent 自主问答**：测试运行器可给出问题和断言，不得在主线答案路径中替 Agent 调用 `lucy_query` 或其他数据工具。辅助 Token 协议检查必须与问答证据分开标记，不得作为 gold 答案来源。
4. **独立 gold 与三类反作弊断言**：gold 从独立数据库夹具计算，类型、时间窗和 NULL／0 语义明确。① 防泄露：gold 与标准答案不得出现在 Agent prompt、模型可见上下文、Wiki、Skill、语义资产、MCP 配置或工具输入；最终答案为匹配 gold 而包含答案是正常结果，不误报为泄露。② 防代答：客户端 transcript 必须包含 Agent 自主工具调用，并能通过调用 ID 关联服务端 trace；重试 attempt 分别记录，不强制一次客户端调用只对应一个 attempt。③ 防静默换题：执行问题必须满足 `prompt === gold.question`。三项不可相互替代。
5. **失败即停**：任一必要阶段失败，该 stage 与整体 journey 均为 `failed`，后续依赖 stages 为 `not_run`，原因引用首个失败；不得换连接、换问题或换实例继续后仍声称 J-01 通过。阶段状态不拆成八个独立 executionId。
6. **主线最小化**：一个代表性允许路径、一笔高频问题、一次自然追问和一次审计对账足够；其他组合进入旁线。

### 4.2 阶段表

| 阶段 | 真实用户动作 | 输入 → 输出 | 必须断言 | 明确不纳入主线 |
|---|---|---|---|---|
| J01-01 登录与准备 | 新实例时经受控引导创建所有者；已有实例则正常登录 | run identity → 管理会话 | 当前实例标识与 run identity 一致；角色符合本阶段权限 | 并发首建、错误密钥、撤权矩阵 |
| J01-02 新建连接 | 在 `/connections` 通过真实向导新建 PostgreSQL 连接并执行连通测试 | 测试库参数的秘密引用 → `connectionId` | 页面显示连接与连通结果；只读 API 核对配置身份；无明文秘密入产物 | MySQL／Hive／错误凭据／重复端点矩阵 |
| J01-03 启用表与 Manifest | 选择 Schema，获取或上传本阶段 Manifest，启用问题所需表 | `connectionId` → Schema、规范源键集合 | 页面、Manifest 与启用范围一致；同名表不串连接／Schema | 多 Schema 全组合、上传攻击、容量边界 |
| J01-04 维护业务上下文 | 在真实 UI 维护一个能回答问题的指标／度量及关联业务 Wiki；必要时使用一个最小业务 Skill | 规范源键 → 语义版本、Wiki 路径、可选 Skill | 保存后只读 oracle 与页面一致；不包含 gold 值或 run 秘密 | 30 表批量、200 文件、复杂 Join／分群矩阵 |
| J01-05 校验并生效 | 经发布工作台执行校验与“同步索引并生效” | 语义候选 → 生效版本／索引状态 | 校验问题可诊断；生效版本可被后续 Agent 与审计共同关联 | 并发写、CAS、崩溃恢复、失败 reindex |
| J01-06 新建访问主体 | 在真实 UI 新建专用 Role、Agent、Token，限制到本问题所需范围；复制页面生成的 MCP 配置 | 生效版本 → `roleId`、`agentId`、Token 秘密引用、MCP snippet | snippet 指向本 run MCP URL；Token 只经秘密通道交给 Agent；配置不含超范围授权 | 多 Role 代数、模板、行权限深度、Token 吊销 |
| J01-07 真实 Agent 问答 | 真实 Agent 使用复制配置提出高频问题，并在同会话自然追问一次 | MCP snippet＋问题 → 最终答案、客户端 transcript、调用关系 | 最终答案匹配 typed gold；至少一次真实查询；追问沿用正确上下文；服务端 trace 与本 run／Agent／Token／版本关联 | 大量 Eval、NULL／0／超时矩阵、注入与预算耗尽 |
| J01-08 审计与对账 | 管理员在真实 UI 找到本次问询与调用，查看只读对账 | 问询／调用关联 → 审计详情与导出证据 | 完整表身份、主状态、调用／尝试、Token 和版本关系可核对；无秘密或 canary 泄露 | 历史回放、导出篡改、13+ 表、完整八桶矩阵 |

### 4.3 阶段状态交接

运行器维护受控的 `j01-state.json`，至少包含：

```yaml
journeyId: J25-01                 # 聚合身份，不替代冻结 catalog ID
catalogEvidenceIds: [UX-01-V01, UX-01-V02, UX-01-V03]
runId: string
instanceId: string
candidateDigest: string
stages:                           # J01-01..J01-08；各含 status / evidenceRefs / failureRef
connectionId: string | null
sourceKeys: string[]
semanticVersion: string | null
policyVersion: string | null
roleId: string | null
agentId: string | null
tokenSecretRef: string | null     # 只存受控引用，不存 Token 明文
questionId: string | null
clientSessionRef: string | null
evidenceRefs: string[]
```

状态文件由当前阶段写入并由下一阶段验证，不得从其他运行的静态 fixture 补齐。Token 明文、数据库密码和模型凭据只能存在受保护的秘密存储中；截图、日志、trace、状态文件和导出包均执行泄漏扫描。

### 4.4 API 与协议调用允许边界

| 用法 | 是否可计入 J-01 对应用户动作 | 说明 |
|---|---:|---|
| 准备独立测试库、计算 gold | 不替代用户动作 | 属受控 setup |
| `page.request` 新建连接／写 Wiki／发布 | **否** | 可作为独立协议测试，不得标为 UI 旅程完成 |
| 只读 GET 核对页面落盘结果 | 可作辅助证据 | 页面动作和页面反馈仍是必需证据 |
| MCP `initialize`／`tools/call` 验证 Token | 可作辅助证据 | 不证明真实 Agent 自主问答 |
| 真实 Agent 经 MCP 自主检索、查询并形成最终答案 | **是** | 保存客户端原始 transcript 和服务端关联 |
| 故障注入、强杀、账本故障、时间控制 | 不进入主线 | 仅用于对应旁线 |

---

## 5. MECE 旁线模型

### 5.1 责任域

| 旁线 | 唯一拥有的问题 | 典型深度场景 | 与其他域的边界 |
|---|---|---|---|
| `CONN` | 能否正确接入、采集、编译和执行不同连接／方言 | PostgreSQL／MySQL／既有支持类型；错误凭据、网络、TLS、同名表；Hive 子域 | 语义内容正确性归 SEM；运行时 ACL 归 ACCESS；答案正确性归 AGENT |
| `SEM` | 业务上下文如何维护、校验、批量变更、生效与恢复 | 单表语义、Wiki／Skill、30 表往返、200 文件边界、CAS、幂等、reindex 与恢复 | 只定义资产和生效；谁可访问归 ACCESS |
| `ACCESS` | 谁在什么条件下被允许或拒绝 | 登录职责、Role／Agent／Token、对象 ACL、行权限、模板、按表反查、授权摘要 | 运行时裁决归本域；只读访问关系展示归 OBSERVE，但使用同一编译事实 |
| `OBSERVE` | 已发生何事，证据是否可靠、可解释、可对账 | 审计屏障、崩溃恢复、多轮日志、八桶、归属、导出、只读对账、访问关系图 | 不重做权限裁决或预算；图不是裁决器 |
| `AGENT` | 真实 Agent 最终回答是否正确、稳健、可理解 | typed gold、多轮、空／NULL／0、失败、超时、取消、预算、注入、多客户端一致性 | J-01 只引用一个代表性问答；深度矩阵全部留在这里 |
| `LIFECYCLE` | 软件从安装到升级、恢复、重启是否保持业务与安全连续 | 新装、真实原地升级、独立恢复、候选重放、部署矩阵、中断时间 | 功能正确性仍引用其他域；本域只拥有版本与生命周期组合 |

### 5.2 横切合同不是产品旁线

以下内容作为所有相关用例共享的 contract，不新增第七类产品旁线：

- 选择器稳定性、路由、产品术语和浏览器翻译防御；
- run identity、instance marker、candidate digest 和快照身份；
- 秘密隔离、canary、证据泄漏扫描；
- typed gold、服务端 trace、审计关联和导出清单；
- 单元／组件／协议／浏览器／真实 Agent／运维故障证据分层。

### 5.3 Hive、数据库支持状态与升级的拆分

- Hive 是 `CONN` 下的独立 suite `HIVE`，不是第二条主线。`HIV25-V01/V02/V06` 可先形成编译侧证据；`HIV25-V03` 等同时要求 HS2／真实执行的部分必须拆成独立证据维度。
- 数据库类型及支持状态以[数据库支持矩阵](../governance/database-support-matrix.md)为唯一真源。MySQL、PostgreSQL 和限定本地文件场景的 SQLite 当前为 `verified`；StarRocks、Doris 为 `gated`；SQL Server、Athena 为 `experimental`；Oracle 为 `roadmap`。E2E 清单缺口不得改写成产品不支持，支持状态也不得替代本轮运行证据。
- `LIFECYCLE` 下分别保留原地升级 `UPG25-*` 与候选恢复验证 `RVC25-*`，二者不可互相替代。
- 旧 `docs/qa/upgrade-feature-checklist.md`／`scripts/e2e/contracts/upgrade-features.yaml` 的 UPG-01–14 是升级功能清单，不是 P1-5 的 UPG-01–16。两者语义不相交，但裸编号字符串重叠，旧编号保留为 `legacy:upgrade-feature:UPG-xx`，不直接映射为新用例。

### 5.4 既有编号优先原则

UX-02–UX-05 直接归 AGENT；UX-06 按 variant 分归 AGENT／ACCESS；UX-07 按 variant 分归 OBSERVE／ACCESS。UX-07-S01 已覆盖调用监控窗口、慢标记、Eval 排除与真实事件对账，直接作为“多次问答后日志分析”的既有执行项，不复制 LOG25。只有确属新增且现有 ID 未覆盖的跨轮次分析才新增 LOG25；未来新增 Agent 深度场景才使用 AGT25。

---

## 6. 冻结 32 场景与其他既有资产的归并

### 6.1 冻结场景逐条责任表

下表给场景默认主 owner； variant 例外必须落实到独立映射清单。主 owner 负责结果与 flake 统计，跨域证据通过 `evidenceRefs` 引用，不形成第二 owner。

| 场景 | 名称／定位 | 主责任域 | variant 级规则 |
|---|---|---|---|
| SEC-01 | 默认管理认证 | ACCESS | 全部 |
| SEC-02 | 引导密钥与并发 | ACCESS | 全部 |
| SEC-03 | 管理职责 | ACCESS | 全部 |
| SEC-04 | 会话回收 | ACCESS | 全部 |
| SEC-05 | 认证失败与限速 | ACCESS | 全部 |
| SEC-06 | Token 一次性展示 | ACCESS | 全部 |
| SEC-07 | 过期／吊销／停用 | ACCESS | 全部 |
| SEC-08 | 错误身份 | ACCESS | 全部 |
| SEC-09 | 连接／表／同名 source 权限边界 | ACCESS | 全部；连接类型本身另归 CONN |
| SEC-10 | Role Set | ACCESS | 全部 |
| SEC-11 | 真行集 | ACCESS | 全部 |
| SEC-12 | 绕过输入 | ACCESS | 全部 |
| SEC-13 | 策略／启用表变化 | ACCESS | 全部 |
| SEC-14 | 上下文隔离 | ACCESS | 全部 |
| SEC-15 | 文件内容供应链 | SEM | 全部；访问拒绝证据引用 ACCESS |
| SEC-16 | 间接提示注入 | AGENT | 全部；未授权内容拒绝引用 ACCESS |
| SEC-17 | 全载体泄漏 | AGENT | 全部；凭证与导出权限引用 ACCESS |
| SEC-18 | 可问责审计 | OBSERVE | 全部 |
| SEC-19 | 审计故障 | OBSERVE | 全部 |
| SEC-20 | 导出／保留／历史 | OBSERVE | V05 备份恢复归 LIFECYCLE，其余归 OBSERVE |
| SEC-21 | 会话跨 Token／客户端 | ACCESS | 全部；问询归属证据引用 OBSERVE |
| SEC-22 | 客户网络 | ACCESS | 全部；部署形态证据引用 LIFECYCLE |
| SEC-23 | 依赖与交付 | LIFECYCLE | 全部 |
| UX-01 | J-01 管理到使用 | AGENT | V01–V03 均为 J25-01 的证据变体；阶段事实跨域引用 |
| UX-02 | 业务正确性 | AGENT | 全部 |
| UX-03 | 空／NULL／0／失败 | AGENT | 全部；并发协议证据引用 ACCESS／OBSERVE，不另设 owner |
| UX-04 | 多轮／发布与恢复 | AGENT | 全部；发布与恢复事实引用 SEM／LIFECYCLE |
| UX-05 | 多产品一致性 | AGENT | 全部 |
| UX-06 | 离线 Eval | AGENT | V01–V03、V08 归 AGENT；V04–V07 的 hash／完整性／runner／Role 拒绝归 ACCESS |
| UX-07 | 现场提问／安全候选 | OBSERVE | V01、V03、V04 归 ACCESS；V02、S01 归 OBSERVE |
| OPS-01 | amd64 K8s 新装／升级／恢复 | LIFECYCLE | 全部；业务、安全和审计连续性引用对应域 |
| GATE-01 | 门禁反向测试 | LIFECYCLE | 全部；作为交付与发布生命周期守门，不新增第七域 |
| AUD25 | 审计增量运行时验收 | OBSERVE | 全部；2026-10-28 由 v0.25 影子清单并入冻结 catalog，成为 release 门禁的一部分 |
| ARV25 | 审计只读对账展示 | OBSERVE | 全部；同 AUD25，来源需求为 L25-02／L25-03 |

### 6.2 其他测试资产

| 既有资产／称谓 | 新定位 | 处理建议 |
|---|---|---|
| `E2E-PUB-01` | SEM 的浏览器／协议深度用例 | 改名称为“语义维护与生效闭环”，停止与 J-01 争抢用户主线定位 |
| `E2E-ONBOARD-EVAL` | CONN＋SEM 的主题接入 SOP，最终答案引用 AGENT | 保留按需执行和 Eval 资产，不新增主线编号；按具体 case 指定唯一 owner |
| `E2E-AGENT` | AGENT 深度与证据集合 | 承接 UX-02–UX-06 的适用变体、多轮、异常、Eval、多客户端 |
| `E2E-USER-JOURNEY`／人工 GUI 清单 | 主线的补充人工客户端证据 | 不把人工完成等同自动 J-01 通过；分别登记客户端与证据 |
| `docs/qa/lucy-webui-e2e-test-suite.md` | 待收敛的旧活文档 | 以真实路由、selector、测试文件和本 Spec 重建映射 |
| `docs/qa/impact-map.json` | 影响分析索引 | 增加 P0／P1 新页面、API、共享编译与审计读模型映射 |

---

## 7. 全量覆盖映射

### 7.1 三类身份与独立清单

覆盖清单同时登记三类对象，不能用其中一类代替另一类：

1. **既有冻结 variant**：255 项继续以原 catalog ID 作为 `executionId`，只登记 `ownerBranch`、跨域引用和证据引用；`executors`、`requires`、`assert`、`artifacts`、`gold` 仍以冻结 catalog 为真源，不在映射中复制第二份定义。
2. **新增执行项**：160 个 P0／P1 需求及本节新增的 CON25／LOG25 场景使用 `<前缀>25-*`。来源编号统一保存为 `sourceRequirementId`；没有来源需求编号的全新场景设为 `null`，不得编造 requirementId。

```text
sourceRequirementId = 原功能 Spec 的验收编号，只在 sourceSpec 命名空间内唯一
executionId         = <功能前缀>25-<原编号>
例：P0-2 V08 -> ROW25-V08；P1-3 SC-01 -> ACM25-SC-01
```

`25` 是映射版本，不是产品版本号，也不表示 2025 年。新增执行项保存 `sourceSpec`、`sourceRequirementId`、`executionId`、`ownerBranch`、`priority`，并复用 catalog 的 `executors`、`requires`、`assert`、`artifacts`、`gold` 词汇；`status`、`blockedReason` 与 `evidenceRefs` 只存在结果文件，不在静态清单另建环境、状态或证据真源。独立 manifest 使用既有 `validateAgainstSchema()` 校验，但不扩展或修改冻结 catalog／lock。

3. **聚合旅程**：J-01 使用 `journeyId=J25-01`，包含 `stages[]` 与 `catalogEvidenceIds=[UX-01-V01, UX-01-V02, UX-01-V03]`。它不是第九条主线，也不把八阶段或三个冻结 variant 复制成新 executionId。

### 7.2 P0 映射

| 功能／来源 | 全部 sourceRequirementId | executionId | 主责任域 | 最低证据组合 |
|---|---|---|---|---|
| P0-1 审计事实与可靠性 | A01、A02、A03、A04、A05、A06、A07、A08、A09、A10、A11、A12 | `AUD25-A01`…`AUD25-A12` | OBSERVE | 协议＋真实运行时＋故障／运维＋证据校验；A12 另含只读历史回放和独立 repairHint 样本 |
| P0-2 行权限最小闭环及关联项 | V01、V02、V03、V04、V05、V06、V07、V08、V09、V10、V11、V12、V13、V14、V15、V16、V17、V18、V19、V20、V21、V22 | `ROW25-V01`…`ROW25-V22` | ACCESS | 同源编译 contract＋浏览器管理动作＋真实 MCP 允许／拒绝＋配置审计；V15 需故障，V19／V22 单独登记维护线回归 |
| P0-3 语义资产批量维护 | V01、V02、V03、V04、V05、V06、V07、V08、V09、V10、V11、V12、V13、V14、V15、V16、V17、V18、V19、V20、V21、V22 | `SEM25-V01`…`SEM25-V22` | SEM | 浏览器批量旅程＋文件／包校验＋真实 KTX＋故障恢复；V03 含真实 Agent，V22 含客户 amd64 单副本证据 |
| P0-4 审计只读对账 | V01、V02、V03、V04、V05、V06、V07、V08、V09、V10、V11、V12 | `ARV25-V01`…`ARV25-V12` | OBSERVE | 真实事件＋API／UI／CSV 同源＋浏览器＋权限／泄漏检查；V12 为客户 amd64 单副本证据 |

补充约束：

- P0-2 的 P0 重点仍是 R2／R4／R5；V01–V07、V14、V16–V17 中属于模板等 P1 能力的项目，不因纳入统一清单而提前改优先级。
- P0-2 V19／V22 的证据与 v0.25 新功能证据分开，未修复 D-03 时不得伪造通过。
- P0-3 V03 的 Agent 证据只证明批量语义生效后的代表性问答，不替代 AGENT 的正确性矩阵。
- P0-4 V01 的 13+ 表、V07 的 5 个配置 Token／3 个活跃 Token 等深场景留在 OBSERVE，不进入 J-01。

### 7.3 P1 映射

| 功能／来源 | 全部 sourceRequirementId | executionId | 主责任域 | 最低证据组合 |
|---|---|---|---|---|
| P1-1 行策略模板 | RTP-01、RTP-02、RTP-03、RTP-04、RTP-05、RTP-06、RTP-07、RTP-08、RTP-09、RTP-10 | `RTP25-01`…`RTP25-10` | ACCESS | 编译／兼容 contract＋浏览器 dry-run／保存＋真实 MCP；RTP-07 需故障与恢复证据 |
| P1-1 按表反查 | RTV-01、RTV-02、RTV-03、RTV-04、RTV-05、RTV-06、RTV-07、RTV-08 | `RTV25-01`…`RTV25-08` | ACCESS | 同源快照 contract＋浏览器只读视图＋与摘要／关系图对账；无运行时写入 |
| P1-2 授权摘要 | ASV-01、ASV-02、ASV-03、ASV-04、ASV-05、ASV-06、ASV-07、ASV-08、ASV-09、ASV-10、ASV-11、ASV-12、ASV-13、ASV-14 | `ASV25-01`…`ASV25-14` | ACCESS | 编译同源 contract＋Agent／Role 浏览器视图＋深链＋秘密保护；与 RTV／ACM 同快照对账 |
| P1-3 访问关系图 | SC-01、SC-02、SC-03、SC-04、SC-05、SC-06、SC-07、SC-08、SC-09、SC-10、SC-11、SC-12、SC-13、SC-14 | `ACM25-SC-01`…`ACM25-SC-14` | OBSERVE | 单元守恒／计数＋组件交互＋真实事件＋浏览器深链与等价表格；不替代 ACCESS 裁决测试 |
| P1-4 Hive 直连 | V01、V02、V03、V04、V05、V06、V07、V08、V09、V10、V11、V12、V13、V14、V15、V16、V17 | `HIV25-V01`…`HIV25-V17` | CONN | 编译侧与真实执行分证；真实 HS2／JDBC、Proxy、ACL、审计、amd64／离线和升级按各自维度留证；HIVE 是 suite 名，不是第七责任域 |
| P1-5 客户升级 E2E | UPG-01、UPG-02、UPG-03、UPG-04、UPG-05、UPG-06、UPG-07、UPG-08、UPG-09、UPG-10、UPG-11、UPG-12、UPG-13、UPG-14、UPG-15、UPG-16 | `UPG25-01`…`UPG25-16` | LIFECYCLE | 固定旧版与候选 digest＋真实卷／备份＋运维故障＋公共 MCP＋安全／审计连续；保持非门禁 |
| P1-6 升级候选验证 | RVC-01、RVC-02、RVC-03、RVC-04、RVC-05、RVC-06、RVC-07、RVC-08、RVC-09、RVC-10、RVC-11、RVC-12、RVC-13 | `RVC25-01`…`RVC25-13` | LIFECYCLE | 一致性备份＋两个隔离空卷环境＋结构／业务／安全断言＋清理证据；保持非门禁 |

### 7.4 新增数据库与多轮日志场景

这些编号只补两套既有清单未覆盖的缺口，不复制 UX／SEC 场景，也不改变数据库支持矩阵的状态。

| executionId | 场景与支持状态 | 主责任域 | 通过边界 |
|---|---|---|---|
| `CON25-01` | MySQL／`verified` | CONN | 真实连接、采集与代表性只读查询；不得以历史支持声明代替本轮证据 |
| `CON25-02` | PostgreSQL／`verified` | CONN | 真实连接、采集与代表性只读查询；可引用 J-01 的同层事实，但结果独立记录 |
| `CON25-03` | StarRocks／`gated` | CONN | 按认证环境各自留真实证据；缺环境为 `blocked`，不得晋级支持状态 |
| `CON25-04` | Doris／`gated` | CONN | 按认证环境各自留真实证据；缺环境为 `blocked`，不得晋级支持状态 |
| `CON25-05` | SQL Server／`experimental` | CONN | 验证已知限制、失败关闭和支持口径；无实机证据不得声称真实查询支持通过 |
| `CON25-06` | Oracle／`roadmap` | CONN | 验证未承诺边界与口径；不把驱动存在或 mock 结果写成真实连接通过 |
| `CON25-07` | SQLite／`verified`，仅本地文件 | CONN | 真实本地文件连接与只读查询；不得外推为客户生产目标库支持 |
| `CON25-08` | Amazon Athena／`experimental` | CONN | 验证已知限制、失败关闭和支持口径；无实机证据不得声称真实查询支持通过 |
| `CON25-09` | 跨连接／Schema 同名表 | CONN | 采集与规范源键不串身份；权限拒绝深度仍归 ACCESS |
| `CON25-10` | 错误凭据 | CONN | 失败关闭、错误可诊断且秘密不泄漏 |
| `CON25-11` | 网络不可达／中断 | CONN | 超时、重试与恢复符合声明，不把网络失败误报为方言不支持 |
| `CON25-12` | TLS 配置与证书失败 | CONN | 按声明能力验证成功／拒绝路径；缺真实 TLS 环境时对应维度 `blocked` |
| `LOG25-01` | UX-07-S01 未覆盖的多轮日志增量 | OBSERVE | 同一多轮会话逐轮关联 Token、语义／策略版本、耗时与预算，重建跨轮调用关系；与 UX-07-S01 的监控窗口、慢标记、Eval 排除和真实事件对账互相引用而不重复 |

本期没有需要新增的 AGT25 场景；未来只有 UX-02–UX-06 与 J-01 均未覆盖的 Agent 深度场景才使用 `AGT25-*`。experimental／roadmap 项的通过只表示其声明的能力边界和支持口径得到验证，不表示真实数据库查询或产品支持通过。

### 7.5 允许共享、禁止相互替代

- `ROW25-*`、`RTP25-*`、`RTV25-*`、`ASV25-*` 可共享同一受控权限 fixture 和编译快照，但每个编号仍须有自己的断言与结果。
- `ARV25-*` 与 `ACM25-*` 可复用同一审计事件集合；前者证明对账读模型，后者证明关系图构图与展示，不互相代替。
- `HIV25-*` 的编译证据可支撑后续真实执行，但不能把“生成结构化 SQL／plan”写成“HS2 执行通过”。
- `UPG25-*` 与 `RVC25-*` 可复用备份检查和业务探针，但“新空卷恢复成功”不证明“原卷原地升级成功”。
- `CON25-*` 可复用 J-01 的数据库 fixture；`LOG25-01` 可复用 UX-07-S01 的事件流，但二者都必须保留自己的增量断言与结果。
- 任一需求的单元测试通过，只能关闭其 unit 证据维度；如果要求真实 Agent、浏览器或运维证据，其他维度仍为 `not_run` 或 `blocked`。

---

## 8. 测试层、运行状态与证据合同

### 8.1 证据层级

| 层级 | 可以证明 | 不能单独证明 |
|---|---|---|
| unit／component | 代数、派生、计数、组件交互、错误分支 | 真实浏览器旅程、真实 MCP、真实数据库、交付 |
| protocol／integration | API、MCP、真实服务间接口与拒绝语义 | 用户通过 UI 完成动作、真实 Agent 最终答案 |
| browser E2E | 真实页面动作、可见反馈、深链、下载、翻译防御 | Agent 自主问答、故障恢复、amd64 客户交付 |
| real-agent E2E | 真实客户端经 MCP 检索、查询、回答与同会话行为 | 未覆盖的管理 UI 或升级恢复 |
| ops／fault E2E | 强杀、账本失败、重试、恢复、卷与版本连续性 | 未执行环境下的客户支持声明 |
| evidence verifier | 快照闭合、hash、清单、版本、泄漏和跨端一致性 | 缺少原始运行证据时的功能通过 |

### 8.2 统一状态

覆盖清单使用以下五种主状态：

| 状态 | 含义 |
|---|---|
| `passed` | 该执行项全部必需证据维度在指定环境通过 |
| `failed` | 已执行且至少一项断言或证据校验失败 |
| `blocked` | 因环境、交付、能力或实现依赖无法执行；必须带结构化原因 |
| `not_run` | 应执行但尚未执行，或前置失败后未调度 |
| `not_applicable` | 仅用于预先定义的独立证据维度确实不适用，不可用于跳过必需场景 |

原功能 Spec 的 `pass`、`BLOCKED`、`UNIMPLEMENTED`、`SKIPPED` 等原值可保存在 `sourceStatus`，不得通过改名把未通过变成通过。`blocked` 至少区分 `environment`、`delivery`、`capability`、`implementation`；当前真实 HS2 和真实升级／备份分别按已批准计划的环境与交付边界记录。

### 8.3 每个运行产物的最小集合

```text
run.json / candidate identity / instance marker
coverage-result.json（executionId、requirementId、层级、状态、原因）
阶段状态与输入摘要（无秘密）
浏览器 trace／截图（仅适用项）
真实 Agent 原始 transcript 与最终答案（仅适用项）
typed gold 与计算版本（不暴露给 Agent）
服务端 trace、审计事件和版本关联（仅适用项）
环境／故障／恢复记录（仅适用项）
artifact manifest、hash 与 leak-scan 结果
```

所有证据必须绑定 `runId + instanceId + candidateDigest`；本地开发没有候选镜像 digest 时使用可复核的源码提交与工作树身份，但不得把这种证据升级为客户候选证据。

---

## 9. CI 与发布门禁关系

### 9.1 本次不改变的事实

`scripts/e2e/contracts/case-catalog.yaml` 与 lock 是当前冻结发布目录。新增 v0.25 覆盖清单不得隐式修改其中的场景、required 属性、断言或分母，也不得绕过现有同一候选 digest 的 release readiness。

### 9.2 两阶段接入

1. **观察期**：新增用例以独立 manifest、独立证据目录运行；结果可用于缺陷分析，不改变现有 required check。
2. **评审后接入**：仅在新用例稳定、环境责任明确、证据可复核后，另发变更评审其 required 属性和 lock；每次变更显式列出新增分母和迁移映射。

P1-5／P1-6 在其功能 Spec 当前决策下保持非门禁。不得借“统一 E2E”名义把它们自动变成发布阻断项。P0／其他 P1 项是否进入发布门禁，也必须在观察期后独立评审。

### 9.3 环境与调度

- PR／开发快速层：unit、component、无需外部能力的 protocol／contract。
- 受控真实服务层：PostgreSQL、KTX、浏览器、真实 Agent、故障工具。
- 受保护交付层：linux/amd64 单副本 K8s、同一候选 digest、真实客户端、隔离卷和 secrets。
- 不满足能力时保留结果为 `blocked`／`not_run`；不得使用 mock 静默降层后仍沿用原 executionId 的通过结论。

---

## 核心流程（伪代码）

```text
function runMainlineJ01(run):
    requireUniqueMainline("J-01")
    context = prepareIsolatedRun(run)       # 独立数据库、run secrets、gold、实例标记
    state = initialState(
        context,
        journeyId="J25-01",
        stages=J01_01_THROUGH_J01_08,
        catalogEvidenceIds=[UX-01-V01, UX-01-V02, UX-01-V03]
    )

    try:
        state = runStage("J01-01", uiLoginOrControlledBootstrap, context, state)
        state = runStage("J01-02", uiCreatePostgresAndTest, context, state)
        state = runStage("J01-03", uiSelectManifestAndEnableTables, context, state)
        state = runStage("J01-04", uiMaintainMetricAndBusinessContext, context, state)
        state = runStage("J01-05", uiValidateSyncAndPublish, context, state)
        state = runStage("J01-06", uiCreateRoleAgentTokenAndCopyMcp, context, state)

        state = startStage("J01-07", state)
        agent = startRealAgentFromCopiedConfig(context, state)
        gold1 = independentGold(context, HIGH_FREQUENCY_QUESTION)
        assertPromptUnchanged(HIGH_FREQUENCY_QUESTION, gold1.question)
        answer1 = agent.askIndependently(HIGH_FREQUENCY_QUESTION)
        assertTypedGold(answer1, gold1)
        gold2 = independentGold(context, NATURAL_FOLLOW_UP)
        assertPromptUnchanged(NATURAL_FOLLOW_UP, gold2.question)
        answer2 = agent.continueSameSession(NATURAL_FOLLOW_UP)
        assertFollowUpContextAndGold(answer2, gold2)
        assertModelVisibleInputsExcludeGold(agent.transcript, context.gold)
        assertAgentOwnedCallsCorrelateWithServerTrace(agent.transcript, serverTrace(state))
        # 关联调用 ID；重试 attempt 分开记录，不强制一次客户端调用只对应一个 attempt
        finishStage("J01-07", passed, state)

        state = runStage("J01-08", uiOpenThisInquiryAndTokenEvidence, context, state)
        assertAuditApiUiExportConsistent(state.reconciliation, state)
        assertNoSecretLeak(context.artifacts)
        assertNoGoldLeakOutsideFinalAnswer(context.artifacts, agent.transcript)
        recordJourney("J25-01", passed, state.stages, context.artifacts)
    catch error:
        markCurrentStageAndJourneyFailed("J25-01", error, state)
        markDependentStages(not_run, causedBy=error)
        recordJourney("J25-01", failed, state.stages, context.artifacts)
    finally:
        scanAndSealArtifacts(context)
        destroyRunScopedSecretsAndResources(context)

function runBranchCase(case, run):
    capabilities = inspectRealCapabilities(run)
    missing = requiredCapabilities(case.requires) - capabilities
    if missing is not empty:
        record(case.executionId, blocked, reason=classify(missing))
        return

    result = executeAtDeclaredLayers(case.executors, case, run)  # 不降层替代
    for executor in case.executors:
        dimension = result.evidence[executor]
        if dimension.notExecuted:
            result.status = not_run
        else if dimension.failed:
            result.status = failed
    if allDimensionsPassed(result) and evidenceVerifierPassed(result):
        record(case.executionId, passed, result.artifacts)
    else:
        record(case.executionId, result.status, result.artifacts)

function reconcileCoverage(manifest, frozenCatalog):
    assertUnique(manifest.newScenarios.executionId)
    assertSetEquals(manifest.newScenarios.where(sourceRequirementId != null).sourceRequirementId, P0_P1_BASELINE_160)
    assertSetEquals(manifest.newScenarios.executionId, NEW_P0_P1_160_PLUS_CON25_LOG25)
    assertSetEquals(manifest.existingCatalogMappings.executionId, frozenCatalog.lock.requiredIds)
    assertEveryItemHasExactlyOneOwner(manifest.existingCatalogMappings + manifest.newScenarios)
    assertAll32ScenesMatchApprovedMapping(manifest.existingCatalogMappings, SPEC_SECTION_6)
    assertJourneyContract(manifest.journeys, only="J25-01", stages=8, catalogEvidenceIds=3)
    assertEmpty(checkLock(frozenCatalog.cases, frozenCatalog.lock))
    # 只产出观察期报告；是否进入 required gate 另行评审
    return independentV025Report(manifest)
```

---

## 10. 验收标准

本优化方案本身满足以下条件才算设计验收完成；均不要求本次执行 E2E：

1. 只存在一条用户主线 J-01；`J25-01` 的八阶段均定义真实动作、输入输出、断言和失败语义，且与 UX-01-V01–V03 的聚合关系明确。
2. 六类旁线责任互斥；§6 的 32 个冻结场景全部逐条归域，255 个冻结 variant 与新增执行项均有唯一 owner。
3. §7 双向覆盖 160 个 P0／P1 来源需求，无遗漏、无虚构、无重复 executionId；新增 CON25-01–12 与 LOG25-01 只补数据库类型和跨轮日志缺口。
4. 明确 UI、协议、真实 Agent、gold、审计、故障和交付证据之间的禁止替代关系；gold 防泄露、防代答、防换题分别可校验。
5. 明确新旧 UPG 和多组 V／SC 的命名冲突解决方案，不要求修改原功能 Spec 编号；既有 UX／SEC／OPS／GATE ID 不复制为 `*25-*`。
6. 独立 manifest 复用 catalog 词汇和 schema 校验器；当前冻结 case catalog／lock 与 32／255 分母不被本次方案修改，并通过 `checkLock()` 核验。
7. 明确真实 HS2、真实旧版升级、真实备份恢复和 Wave 0b 的证据边界，不把 blocked 写成通过；experimental／roadmap 不被写成真实查询支持通过。
8. 实施 Plan 为每一波给出文件落点、依赖、验收、证据和退出标准；W0 可先启动，F-01／F-02 在 W0 退出前关闭后才可进入 W1，外部环境不足只阻断对应证据维度。

后续 J-01 修复的运行验收则必须至少取得：同一 run 的完整 UI 管理链、真实 Agent 两次问答、typed gold、三类反作弊断言、服务端 trace、审计对账、无泄漏和可复核产物。任何一项缺失均不得记完整 J-01 通过。

---

## 11. 风险与控制

| 风险 | 控制 |
|---|---|
| 把 API 写操作重新包装成 UI E2E | 对 J-01 写步骤做静态禁用规则与评审；保留网络证据以核对动作来源 |
| 主线过长、 flaky 后大量重跑 | 主线只保留代表性旅程；深度组合留旁线；阶段产物只用于诊断，不允许跨 run 拼接通过 |
| 多客户端导致主线膨胀 | J-01 选择一个已批准的代表客户端；客户端矩阵在 AGENT，发布所需客户端仍按冻结目录执行 |
| 编号迁移破坏历史追踪 | 原 sourceRequirementId 不变，保留 legacy 映射和 sourceSpec；新旧报告不覆盖 |
| 共享 fixture 造成跨域污染 | 每 run 隔离、状态版本化、独立 gold、run-scoped secrets 和资源清理 |
| 编译／单测结果误写为交付结果 | 每证据维度单列；状态聚合取最弱必需维度；证据校验失败不得通过 |
| 观察期用例自动阻断发布 | 独立 manifest 与 workflow；required 变更必须另行评审 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（产品术语）。`CONN`、`SEM`、`ACCESS`、`OBSERVE`、`AGENT`、`LIFECYCLE`、`J25-01`、`CON25-*`、`LOG25-*`、保留的 `AGT25-*` 及各 `executionId` 仅为内部测试工程标识，不作为 WebUI 文案。
- 用户动作沿用“新建连接”“连通测试”“启用表范围”“语义资产”“业务 Wiki”“业务 Skill”“同步索引并生效”“角色权限”“调用记录”等既有主术语。
- `Schema`、`Manifest`、`MCP`、`Role`、`Agent`、`Token` 及文件路径在相关 WebUI DOM 中继续使用 `translate="no"` 与 `notranslate`。
