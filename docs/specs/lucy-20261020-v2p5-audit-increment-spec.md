# Lucy v0.25 审计可靠性、准确性与链路追踪增量 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy v0.25 审计可靠性、准确性与链路追踪增量 Spec |
| 文档类型 | Spec（Cross-module Audit / Reliability / Accuracy / Traceability） |
| 版本 / 日期 | **v1.0-frozen / 2026-10-20，Asia/Shanghai**（v0.1 Kimi 初稿；v0.2 Codex 修订；v0.3 Kimi 裁决；v1.0 Codex 经授权完成复核修正与设计冻结） |
| target_release | **v0.25** |
| 功能编号 / 优先级 | **L25-09 / P0（P0-1）** |
| 状态 | **design_frozen，待需求审查签核（v0.25 设计基线已冻结；A01–A12 未执行；暂不开发，实现、测试执行及发布须按另行批准计划推进）** |
| 撰写人 | **Kimi（起草）** |
| 审阅者 / 冻结执行人 | **Codex（委托人明确授权“修改，完成冻结”）** |
| 裁决及收口 | **Kimi 完成 U1–U12 原始裁决；Codex 经委托人授权修正复核发现并收口，最终冻结值见 §15；冻结记录见 §17** |
| 委托人 | xingchen（经 2026-10-20 审计报告 v1.1 批准 S01–S08 纳入 v0.25） |
| 依据 | `Lucy日志审计报告20261020.docx` v1.1（F01–F07、S01–S08、A01–A12）及其交叉审阅意见；历史基线样本见 §13 |
| 关联 Plan | [2026-10-18-lucy-2.5-upgrade-proposal.md](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md)（已同步登记本增量）；实施 Plan 依据本冻结版本另行批准 |
| 审查入口 | [P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §2 L25-09；[首批 P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md) |
| Acceptance | 本文 §13（A01–A12 验收场景详表，全部标注未执行） |
| 基线 | `lucy-v2.0`，HEAD `2abc472`；历史导出样本为 2026-10-20 只读证据，本 spec 不改写历史证据 |
| 范围 | 审计事件状态与响应证据（S01）、入口持久化与恢复（S02）、跨端关联与重试标识（S03）、问询归属与来源可信度（S04）、对账指标与完整性（S05）、导出快照与证据封存（S06）、错误重试与预算（S07）、故障注入与历史回放（S08） |
| 部署边界 | **单实例 / 单副本**；开发 Mac arm64，客户 linux/amd64 Kubernetes；**只改 Lucy，不改 KTX 源码**；不修改 2026-10-20 历史审计证据 |

---

## 1. 目标与非目标（总）

**目标**

1. 将审计报告 v1.1 批准的 S01–S08 契约整合为 v0.25 唯一事实源，消除"同一指标多种口径"（F01）与"导出一致≠入口无漏记"（F04）两类结构性缺陷。
2. 建立跨端（客户端 ↔ Lucy ↔ 上游）可穿透的关联链与显式不可观测边界（F03、F05、F06）。
3. 用固定历史样本 + 故障注入把"可靠性声称"变成可执行验收（S08，覆盖全部发现）。

**非目标**

- 不重开审计报告 v1.1 明确排除的整改项：身份归责体系、最小权限与授权解释、字段敏感性分级、结果流向（外传）审计。本 spec 仅保证支撑这些主题的**事实字段**（reported/observed 分离、生效权限快照引用）可取得。
- 不另建竞争性事实源：安全账本（canonical ledger）、幂等投影、预算引擎、权限快照体系**沿用**既有批准设计，本 spec 只做增量契约（见 §2）。
- 不做多副本/分布式语义；单实例单副本边界内的崩溃恢复即全部可靠性范围。
- 不改变历史导出与历史审计证据；所有兼容与迁移均为 additive。

## 2. 生效关系与唯一事实源

以下为 **v0.25 已冻结的设计关系**，权威版本为本文 v1.0-frozen。§15 为唯一最终裁决记录，正文与伪代码按同一值执行；与既有规范冲突的具体条款以本文及 §14 修订清单为准，其余既有条款保持原义。§14 的旧文件同步属于后续实施准备，不以尚未同步的旧表述重新打开冻结值；实施 Plan 须逐项记录同步结果。设计冻结不代表功能已实现或验收已通过，不追溯覆盖历史证据。

| 议题 | 唯一事实源（v0.25 起） | 与既有规范的关系 |
|---|---|---|
| 事件身份 / attempt / 关联状态 | §6（S03），沿用 20261019 Spec §4.1 | 补充 question/client_call 命名映射与回传契约；冲突以本 spec 为准 |
| 状态模型（六维 + 主状态派生） | §4（S01），沿用 20261019 Spec §4.3 六维字典 | 保留事件类型及五项事实维度；classificationVersion 是规则版本元数据，不是第六维。主状态为派生视图，delivery 为补充观测 |
| 空值语义 | §4.3(d)，完整保留 20261019 Spec §4.4 五态，补充 not_supported | 不得丢失 redacted / parse_failed；U2 已冻结为单一六值枚举，无四态覆盖五态规则 |
| 接收持久化 / 先持久后释放 | §5（S02），沿用 20261018 Spec §5 与 ADR | 补充入口时点定义、endpoint 登记、恢复核对与故障注入验收；SEC-19 语义不变 |
| 问询归属 | §7（S04），沿用 20261019 Spec §4.1 五态与追加修订规则 | 补充归属证据顺序、冲突保留与旧回绑残留消除清单 |
| 计量口径 / 完整性维度 | §8（S05）；新增六项 auditCoverage 检查，保留 20261019 Spec §6 四子域 completeness | 四子域与既有 complete/combined_complete 含义不变；六项检查不可近似替代关联质量或文件完整性 |
| 导出与证据 | §9（S06），沿用 20261019 Spec §6（序列上界 S、冻结快照、nextCursor） | 补充版本链、排除项声明、跨文件关系 |
| 错误 / 重试 / 预算 | §10（S07），沿用 Spec 162 预算引擎与 20261019 Spec §7 | 补充统一错误分类、修复提示可用性闭环、防重置规则 |
| 展示层（治理台 WebUI） | L25-02/L25-03（v0.25 升级建议书） | 展示层对账与计数展示**以 S05 权威口径为数据源**，不得自定口径 |

**术语级约束**："证据校验"不得宣称"防篡改（本地 hash 自检）"或"独立签名"（术语标准 §3）；导出物的完整性宣称只能写"清单验证通过/失败"。

**显式绑定（2026-10-25 实施回写，N5）**：`combinedComplete` 的判定式**就是** audit-trust R1 验收矩阵判据 #6 的严格三项 AND —— `combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk`，**不得**增设第四个合取项。若需新增完整性闸门（如 as-of 上界），必须**折进已有因子**（本轮做法：折进 `scopeComplete` —— as-of 边界无法落到行上即「范围不可证明完整」→ `scopeComplete=false` → 正式导出 fail-closed），**不得**改写 `combinedComplete` 的合取项个数；否则在缺 `ledger_seq` 列的库上，三项皆为 true 而 combined 为 false，冻结判据 #6 被判 fail，即**修复本身破坏冻结判据**（台账 **D-12**，`docs/qa/security-findings.yaml`，status `fixed`）。§8.2(b) 的六项检查与 R1 判据 #6 **不可互相替代、也不可互相覆盖**：六项检查不可近似替代关联质量或文件完整性（同上表「计量口径 / 完整性维度」行），R1 判据 #6 则是 **manifest 契约的冻结不变式**。

> 实施回写见 §18（2026-10-25，N5）：`combinedComplete` 判定式与 R1 判据 #6 绑定，合取项个数不得改写。

## 3. 历史样本与冲突登记（只读基线）

以下数值为 2026-10-20 导出的固定历史样本，是 S08 回放的期望基线；任何实现不得要求修改这些数值来"通过"验收。

| 样本项 | 固定值 | 证据位置 |
|---|---|---|
| 调用流水 E02 | 177 条 = 175 次工具调用 + 2 次 server/discover 探测 | lucy-ori/audit-calls-20261020-105333-000002.csv |
| 证据包 access_log E03 | 192 条 = 177 + 15 条关联握手（握手行 id：2195–2197、2198–2200、2234–2236、2291、2380–2381、2600–2602） | audit-pack-20261020T025340Z-e9ba5908/access_log.csv |
| E02↔E03 一致性 | 共同 id 177 条逐字段一致（差异 0） | 按 id 关联比对 |
| 历史 outcome 计数（非新主状态） | ok 110 / denied 23（已含 2 次协议探测；工具级拒绝 21）/ error 43 / budget_stop 1；合计 177 | E02 outcome 字段重算 |
| 归属统计 | 137 unassigned·none + 36 session_bound·low + 2 explicit·high | E02 turn_attribution_mode/confidence |
| 仅握手会话 | 14 个 codex 会话（13 个 codex-mcp-client + 1 个 codex-mcp-connection-check）+ 3 个 workbuddy + 1 个 claude-code + 1 个 mavis-local-runtime-mcp | E01 问询 CSV |
| 冲突标签（保留，不回填） | 事件 2455（wiki_search，args 仅含 limit，outcome=ok；自报侧记缺 query 入参错误）；Claude 第 21 次自报查询无服务端对应记录（缺口的 1 次为语义校验失败组） | E02；E10 |
| request_id 复用事实 | 会话 9d2cb7a7 内 request_id 1→{2382,2451}、2→{2383,2452}、3→{2405,2453}、0→{2380,2454}，跨批次顺序复用 | E02+E03 |

**修正原则**（沿用报告 v1.1）：保留原事件与原归档；修正以追加记录（带原因、证据引用、规则版本）生效，不覆盖原记录；证据不足显示 unknown，不据此认定能力存在或不存在。

> 实施回写见 §18（2026-10-25，N22）：「归属统计」行的分母是**工具调用集合（175）**，不是调用流水（177）；原表数值不改，仅补记分母口径。

## 4. S01 事件状态与响应证据契约

### 4.1 目标与非目标

- **目标**：每个按已声明单位纳入汇总的对象有且仅有一个**汇总主状态**；authorization / execution / delivery 三视图可独立判定；原始值、解析值、修正值可区分；未观测的结果不填 0、不填成功。
- **非目标**：不改变权限裁决语义；不替代 20261019 Spec §4.3 六维字典（六维仍是执行侧事实源，主状态是其派生视图）。

### 4.2 现有条款映射

20261019 Spec §4.3（事件类型 + transportStatus / authorizationStatus / executionStatus / usabilityStatus / 关联质量，共六维）全部沿用；classificationVersion 单独作为规则版本元数据；§4.4 计量与空值部分沿用并按 §4.3 对齐；§4.5 response_prepared 三态区分与 digestVersion 沿用。

### 4.3 数据契约

**（a）主状态枚举与派生**（F01 修复核心）

```text
primaryStatus ∈ { succeeded, failed, denied, budget_stopped, cancelled, timeout, indeterminate, unknown }
```

**已确定的不变量**：原始错误码、原始 outcome、规范化原因及其证据引用分别保留。classificationVersion 标识事实分类规则，derivationVersion 标识主状态派生规则。主状态只汇总处理结果，不证明客户端收到；ACK 缺失不得把有凭据的 execution=succeeded 改成执行失败。校验失败不要求 transport=succeeded；预算终止不伪装为权限拒绝。未知、相互矛盾或缺少证据的历史行不得默认成功。

下表及 §12.3 为 **U10 已冻结的完整派生规则**（derivationVersion=v2p5-1）。先核验事实及竞争凭据，再按表顺序命中首项；失败/成功的闭合凭据先于取消/超时。取消请求、观察超时与执行完成可以发生在不同阶段，不因信号并存就称事实矛盾；但互斥闭合凭据、无法证明时序/同一尝试的竞争凭据须保留 unknown+conflict，不能猜顺序。凭据时间仅在同一时钟域或有可验证顺序时可用于裁决。

| 顺序 / 证据条件（均须带原始事件引用） | 唯一主状态 | 约束 |
|---|---|---|
| 1 事实相互矛盾且无法按凭据消解 | unknown + conflict 标签 | 最高优先，不以排序掩盖矛盾 |
| 2 预算引擎明确终止本次尝试，未实际执行 | budget_stopped | 保留原始 budget_stop |
| 3 明确授权拒绝，未实际执行 | denied | 不从入参错误倒推权限拒绝 |
| 4 有可核验执行失败或入参/语义校验失败凭据 | failed | 生成前失败 execution=not_executed |
| 5 有可核验执行成功凭据 | succeeded | delivery、结果可用性独立，不因 ACK 缺失改执行结果 |
| 6 有执行取消凭据，且无优先闭合结果 | cancelled | 取消请求本身不足；竞争时先完成凭据核验 |
| 7 有执行超时凭据，且无优先闭合结果/已确认取消 | timeout | 上游结果未知时 execution 不填 failed |
| 8 有持久前缀、处理中断且结果未定 | indeterminate | 不自动重放业务 |
| 9 其余证据不足或历史事实未经核验 | unknown | 不由旧 outcome=ok 推定 succeeded |

同一纳入集合内每个**计量单元**有且仅有一个主状态；生命周期多条账本事件不能重复增加工具调用数（单位见 §8.2）。API、UI、CSV、证据包调用同一版本分类函数。所有八个桶均须有断言，合计等于集合总数；汇总与明细须使用相同账本截止位置 S、筛选、计量单位与规则版本。历史 Codex 的 31 条协议记录原始 outcome 为 23+3+4+1，禁止漏掉 budget_stop，也禁止把这组原始数直接称为已核实的执行状态。

> 实施回写见 §18（2026-10-25，N16、N23、N24）：第 1 行的 `unknown+conflict` 判定条件、第 2 行的 execution 轴取值约定补记；`budget_stop` 不再映射为 `execution=interrupted`。

**（b）authorization / execution / delivery 三视图**

| 视图 | 取值 | 观察点 | 禁止 |
|---|---|---|---|
| authorization | allowed / denied / not_evaluated / unknown | Lucy 裁决时刻 | 把预算终止记为授权拒绝（沿用 20261019 §7） |
| execution | succeeded / failed / not_executed / interrupted / unknown | 上游或本地执行 | HTTP 200 推定执行成功 |
| delivery | 本期写入 prepared / sent / acknowledged / unknown；unacknowledged 仅保留值域、不写入 | prepared=持久响应凭据；sent=实际发送观测；acknowledged=已接通 dogfood 适配器提交并通过关联校验的 result_received | sent 不证明用户收到；无回执保留已知 prepared/sent，接收观察为 unknown；无 ACK 超时，不推导 unacknowledged |

> 实施回写见 §18（2026-10-25，N16、N17、N24）：`acknowledged` 路径此前不可达（可见父集合恒为空），本轮已打通；预算终止的 execution / authorization 轴取值补记为 `not_executed` / `not_evaluated`。

**（c）args_summary / query_preview / generated_sql 拆分与省略规则**（对应历史缺陷：2455）

沿用既有摘要、脱敏与受保护原文存储边界，不以本增量要求新增无限长明文。字段存在、摘要截断、解析失败和不适用分别记录，不能用空字符串混为一类。

| 字段 | 内容与来源 | 缺失/摘要规则 |
|---|---|---|
| args_summary | 工具实际收到的结构化入参摘要；保留参数名及 presence | 按既有最小记录策略；值为空不等于参数缺失。无法取得原入参时标 unknown，禁止编造 field_missing |
| query_preview | 检索文本或查询预览，按工具 Schema 映射实际参数名（如 q/query） | 允许有界预览并记录截断、原字节长度、摘要版本；仅在观测确认缺参时记 field_missing:<实际参数名> |
| generated_sql | 实际生成的 SQL 的受控记录或引用 | 未生成时记原因；未知不写成未生成；不强制把完整原文放进热审计存储 |
| query_hash / digest | 明确 digest_kind（检索文本/SQL/结果）、源字段、规范化版本、编码、是否完整输入 | 检索工具可以有哈希而无 SQL；不能以 generated_sql 为空判哈希不适用。低熵内容按既有受保护摘要策略 |

U11 冻结值（§15）：query_preview 在 v0.25 **由当前实现的 180 扩展至 500 个 Unicode 码点**，这是新增变更；当前 `webui/server/proxy/mcp-proxy.ts` 的 redactQueryPreview 为 `.slice(0, 180)`，不是沿用 500。`question_preview` 的默认 500 属于另一字段，不能作此基线依据。先沿用既有脱敏，再生成有界预览；截断不切断 Unicode 字符，记 preview_version=v2p5-1、truncated、原始输入 UTF-8 字节长度。args_summary 沿用 maxKeys=8，单值序列化后上限 512 UTF-8 字节，不切断字符；结构化值超限改用保留类型的摘要/省略标记，禁止截出无效 JSON。digest_kind 区分 search_text/sql/result，规范化及编码版本为 v2p5-1；摘要基于完整的受控规范化输入，不以截断预览冒充完整输入。新规则不重解释历史 query_hash，历史保留旧值与 legacy/unknown 版本标记。

历史案例：2455 只保留已观测参数、原始 outcome=ok、自报错误及 conflict_unresolved，不据此回填执行成功或失败。同批 2289/2309/2387/2460 的 query_preview、query_hash、query_length 为检索文本有记录而无 SQL 的正例。

**（d）空值语义保真**（U2 已裁决，§15：单一六值枚举）

必须可无损表达：not_applicable（不适用）、not_collected（确认可采但未采）、redacted（按既有策略隐藏）、parse_failed（解析失败）、unknown（状态未知）以及新增 not_supported（确认该形态不支持）。U2 已冻结为单一六值枚举；本期不采用分轴编码，不合并既有语义。

新记录缺值须带原因与证据来源，展示不得仅留空或填 0。历史 177 行 device_name/lucy_platform 为空，**不能仅凭空值断定 not_collected**：原字段保持原样，增量解释默认 unknown/legacy_unverified；仅有采集能力与配置证据时才可追加更具体原因。

**（e）reported / observed / inferred 来源分离**

| 字段族 | 来源与证据强度 | 使用规则 |
|---|---|---|
| reported_client / reported_client_version / reported_role | 客户端声明 | 不覆盖服务端生效事实 |
| observed_protocol / observed_user_agent / observed_role_ids | 实际协议/报文/裁决观测；角色附 permission_snapshot_hash | 只证明被观测内容；User-Agent 的声明性质仍须保留，不证明客户端真实身份 |
| inferred_client / inference_method / confidence / ruleVersion | 按协议特征推断客户端类型 | 与 observed 分开，不作为确认事实或强行配对依据 |

历史 WorkBuddy 自报角色与 Lucy 生效角色不同，仅用于验证来源分离，不据此重开身份归责或权限解释整改。

### 4.4 关键流程（状态机摘要）

接收→校验/授权→分派→执行→响应准备→发送，各阶段可分别产生账本记录；校验失败、拒绝、预算终止、取消、超时分别有分支。execution、delivery、主状态不强制同步前进。进程崩溃由恢复扫描识别未完成前缀（§12.2），不能假设进程死前必定写出 interrupted。

### 4.5 失败与恢复分支

- 账本提交失败：沿用 20261018 §5.1 的阻断规则。执行前无 admitted 凭据不分派；response_prepared 提交失败时上游可能已执行，但不得释放响应内容。
- Lucy 已持久成功凭据而发送丢失：execution=succeeded，delivery=unknown 或已有发送观测，主状态按 U10 汇总；不得因 ACK 缺失改成执行失败。
- 上游可能已执行而 Lucy 未收到结果：execution=unknown，主状态 indeterminate；只有新增上游凭据才能追加核验结果，禁止盲目业务重放。

### 4.6 历史兼容与迁移

- 旧 outcome 原样保留为 legacy_outcome；ok/denied/error/budget_stop 的历史直方图单列，不作为新执行状态的充分证据。新派生按可核验事实和规则版本计算；不足则 unknown/legacy_unverified，2455 同时保留冲突标签。
- 新字段、API/CSV 版本 additive。旧 v1 字段和既有 complete 含义保持可读；未来下线须另列明确版本及兼容方案，不以本 spec 自动下线，也不静默重算旧列。

### 4.7 验收

A05（协议成功不等于执行成功）、A06（八桶可达与闭合）、A09（参数/结果冲突）、A12（177 条旧 outcome 为 110/23/43/1；2 次探测已包含，工具级为 110/21/43/1=175）。

### 4.8 裁决状态

U1/U2/U10/U11 已冻结（§15）：ACK 入口 + 1 个 dogfood 适配器，有效回执可写 acknowledged，unacknowledged 本期不写；空值六值枚举；完整派生规则 v2p5-1；新增预览上限 500 个 Unicode 码点、args_summary 单值 512 字节、digest/preview 版本 v2p5-1。

> 实施回写见 §18（2026-10-25，N17）：U1 的「有效回执可写 acknowledged」此前无实现载体（可见父集合恒为空集），本轮已打通并保持 U1 冻结值不变。

## 5. S02 入口持久化与恢复契约

### 5.1 目标与非目标

- **目标**：定义"Lucy 确认接收"的唯一时点（**接收记录写成功后**才允许分派有业务影响的操作）；建立执行前持久化屏障、可靠事件传递与独立对账边界；崩溃恢复后每个已确认接收的请求状态可解释。
- **非目标**：不承诺端到端恰好一次（at-least-once + 幂等投影）；不改传输协议。

### 5.2 现有条款映射

沿用 20261018 Spec §5（先持久后释放、WAL + synchronous=FULL、503 AUDIT_UNAVAILABLE、SEC-19）与 20261019 Spec §6（canonical ledger 复用、幂等投影、complete=false 语义）；本 spec 补充入口时点、endpoint 登记与恢复核对规则。

### 5.3 数据契约：入口登记

| 字段 | 说明 |
|---|---|
| endpoint_id | 逻辑入口标识，如 `mcp-http`、`admin-http`、`agent-audit-ingest` |
| 传输类型 | streamable-http / stdio / http-admin |
| 监听登记 | 每个 endpoint 登记监听地址与用途；**57881（MCP）与 55176（管理）分别登记，端口并存是合法部署形态，不是缺陷** |
| 可观察路由组件 | 入口→准入→账本→投影的组件名，用于完整性六维的"入口接收覆盖"维度定位缺口 |

### 5.4 关键流程与失败恢复（摘要，伪代码见 §12.1）

- received/admitted 持久化失败：沿用既有阻断规则，不得向上游分派。U3 已冻结本期无缓冲；进内存队列不算接收成功，未来引入缓冲须另立 spec 批准。response_prepared 失败可能发生在上游执行之后，禁止发送内容，不得伪称上游未执行；
- 至少一次投递 + 事件 ID 幂等投影：区分**事件重放**（同 eventId 重投，投影幂等吸收）与**业务重试**（新 eventId + retry_of，S07）；
- 上游已执行但本地未收到完成响应：标 indeterminate 并进入恢复核对（上游凭据核对，A04），禁止为补日志盲目重放业务；
- 采集故障必须有明确降级或阻断策略及**独立告警**；记录背压、重放、丢弃尝试与恢复异常。

### 5.5 历史兼容与迁移

历史 access_log 与导出样本保持只读。新生命周期记录以 received/admitted/response_prepared 等 stage（或等价版本化字段）表达，事件类型仍保留 tool_call/protocol/client_observation/audit_management 分类；stage 不替代事件类型，也不按生命周期行重复计调用。有效修订通过追加事件与可重建投影呈现，不改写历史 177/192 行。

### 5.6 验收

A01（接收后崩溃，恢复可解释）、A02（审计存储不可用阻断，无缓冲）、A03（重复投递幂等吸收，业务计数不增）、A04（上游执行响应丢失→indeterminate→凭据核对）。

### 5.7 裁决状态

U3 已由 Kimi 裁决（§15）：本期仅阻断、无缓冲；20261018 §5.1 的请求/响应大小与上游时限不是缓冲容量，缓冲议题关闭，若未来需要以单独 spec 批准。

## 6. S03 跨端关联与重试标识契约

### 6.1 目标与非目标

- **目标**：区分问询、逻辑调用、执行尝试、内部操作、账本事件、客户端观测和上游操作；同一调用的多个观测可贯通，不被误合并或重复计数。
- **非目标**：不强制外部客户端改造；上游无 ID 时明确不可观测，不能拿 Lucy 内部 ID 冒充上游凭据。

### 6.2 标识字典与唯一性范围

| 标识 | 来源 / 对齐 | 关系与唯一性 |
|---|---|---|
| question_id | 既有显式 turnId | 登记问询；candidateTurnId 为推断候选，不替代显式 ID |
| client_call_id | 新增可选逻辑调用关联字段，**不等于 clientEventId** | 已认证适配器命名空间内唯一；一次逻辑调用可有多个尝试、多个客户端观测 |
| client_event_id | 既有 clientEventId | 一条客户端观测；按适配器+clientEventId 幂等，同 ID 不同内容为冲突 |
| attempt_id / parent_attempt_id | 既有 attemptId / parentAttemptId | 一次实际执行尝试；父引用只能指 attempt ID，不能填 event ID |
| operation_id | 既有 operationId | Lucy 内部操作过程；关联一次尝试的多个生命周期事件，不能充当上游 ID |
| event_id | 既有 eventId | 一条账本事件全局身份；同事件重投幂等，不合并不同阶段/独立执行 |
| upstream_operation_id | 上游真实回传的标识 | 连同上游实例/连接命名空间保存；无凭据则 null+原因，不得用 operationId 填充 |
| rpc_request_id | 原始 RPC request_id | 保留原值及 session/连接代次；不额外承诺批次内唯一，不作全局去重键 |

请求/响应的引用统一指向已提交 received 的 ingress_event_id，并同时保留 operation_id/attempt_id；生命周期事件各有自己的 event_id。跨端幂等仅针对同一观测重投或同一事件重放；client_call_id、RPC ID 或相同 SQL 都不能单独证明两次执行是同一次。

### 6.3 数据契约（补充）

- 入口关联凭据按 §15-U12 回传：x-lucy-event-id=**已提交 received 的 ingress_event_id**，不指 admitted。received 未确认提交时不发三项审计凭据头；提交后各失败分支保留同一入口 ID。未协商客户端不插 SSE 扩展帧。历史未回传时不虚构客户端知晓该 ID。
- 重连记录 reconnect_generation；显式 question_id 仍须通过既有同主体/凭证/会话边界校验。跨会话延续需可验证的续接关系；仅凭 question_id 相同或时间接近不能自动继承。续接机制按 §15-U12 冻结值执行。
- 重连本身不新增 attempt；重连后重新发送并实际准入执行的请求必须有独立 attempt，除非既有幂等执行契约已证明只是原尝试续接。不能把“重连”当去重证据。
- 上游不支持 ID 需要能力证据才记 not_supported；尚未取得或历史未知分别按空值原因表达。不可观测边界单列，禁止虚增覆盖率。

> 实施回写见 §18（2026-10-25，N10、N21）：标识列此前「已声明但未写入」（生产真实行恒为 NULL），本轮已补写 INSERT 列表；`ACCESS_LOG_COLUMNS` 原为双份重复常量，本轮收敛为单一来源。

### 6.4 验收

A07（request_id 复用不合并事件；相同 SQL 的两次独立请求分别保留）、A08（重连延续/并发不串链/迟到绑定保留历史）、A04（可穿透至可观察上游边界）。

### 6.5 失败与恢复与历史兼容

- 只对同 event_id 的账本重投幂等吸收；新执行保留新 attempt 及 retry_of/parent_attempt_id（§10.3）。
- 旧客户端不回传 ID 时仍完整审计 Lucy 侧事件。跨端覆盖的目标客户端集合须事先登记并冻结，不得事后按回传采用率缩分母。外部客户端缺独立证据时显示 unknown/不可观测数量，不能记作匹配成功。

### 6.6 裁决状态

U4/U12 已由 Kimi 裁决（§15）：目标客户端集合 v1 与能力矩阵、回传信封 correlationHeaders=v2p5-1、续接凭据 questionContinuation=v2p5-1。

## 7. S04 问询归属与来源可信度契约

### 7.1 目标与非目标

- **目标**：显式绑定 / 会话绑定 / 系统推断 / 未归属四类归属的语义、来源、置信度可区分；归属修订保留历史；问询原文可经 turn_id 与快照联结导出。
- **非目标**：不自动生成用户原话；不把推断归属升级为确认归属。

### 7.2 现有条款映射与生效优先级

沿用 20261019 Spec §4.1 五态（confirmed/candidate/unassigned/conflict/legacy_unverified）、never backbind（仅按经过时间不回绑旧事件）、追加修订事件（不 UPDATE 原始账本）、§4.4 会话访问入口（仅握手不占业务问询分母）。

**v0.25 归属证据顺序**（不得仅凭排序消解事实冲突；迟到不代表更可信）：

```
1. 显式绑定（begin_question 及其确认的更正事件）
2. 经既有可见性/显式关联校验的迟到修订（带原因、证据与规则版本；迟到推断仍只是 candidate）
3. 会话绑定（session_bound，low 置信）
4. 系统推断（identity_inferred / 候选，none 或 low 置信）
5. 未归属（unassigned）
```

### 7.3 数据契约（补充）

- 问询原文不冗余写入每次调用行：调用行经有效 `turn_id` 关联问询记录，经 `permission_snapshot_hash` 独立关联当次生效快照；权限快照不是问询的联合主键，不能靠相同快照推断同一问询，导出物（S06）在**包内**提供关联，消费者可自行联结；未上报原文的 turn 只显示"未上报问询原文"或推断摘要（历史样本：26 个分组中 19 个仅握手、7 个业务分组，其中 2 个有原文、5 个未上报；分组不等于已登记真实用户问询）。
- 旧回绑规则残留消除清单列入 §14（针对 Spec 173/172/08 的逐条核对结果）。

### 7.4 验收

A08（迟到绑定保留历史、并发问询不串链）；历史样本核对：Claude 事件 2490 之前调用保留原归属+补充关联历史，WorkBuddy 的 bfce80c0 与 7bf05682 两会话分开保留；仅在取得有效显式关联证据时建立跨会话关系，否则保持待核验。

### 7.5 失败与恢复与历史兼容

- 失败与恢复：归属判定服务不可用时调用照常审计，按既有字典记 mode=unassigned、confidence=none、association_status=unassigned，并另记归属计算不可用原因（不新增 mode=unknown、不阻塞数据面、不猜测归属）；恢复后按修订链规则补算，补算只产生追加修订事件。
- 历史兼容：既有四类 mode 及其 confidence 不重写；旧高置信 auto 关联默认 legacy_unverified（沿用 20261019 Spec §4.1），不静默升级。

### 7.6 裁决状态

U5 语义已冻结（§15）：聚类仅生成 candidate、none/low 置信；数值参数留实施 Plan 用 S08 回放样本标定。

## 8. S05 对账、指标与完整性契约

### 8.1 目标与非目标

- **目标**：协议请求 / 工具调用 / 执行尝试 / 拒绝 / 预算终止**分别计数**；每个计量单元唯一主状态（S01 派生）；完整性六维独立判定；差异可分类、可定位、可重复计算。
- **非目标**：不追求跨端 100% 匹配率本身；对账的目的是暴露差异集合。

### 8.2 数据契约

**（a）指标单位与集合字典**

每个指标记录 metric_id/version、unit、固定时间/序列截止位置、筛选、expected_ids、observed_ids、matched_ids、missing_ids、extra_ids、N、D、排除及不可观测原因。比率必须给出分子/分母定义；分母为 0 不显示 100%。大集合可用包内可复查清单引用。生命周期账本行、协议请求、工具调用、尝试、问询不是同一单位。

| 计量单位 | 集合定义 | 历史基线 / 边界 |
|---|---|---|
| 协议请求 | Lucy 登记入口所处理的独立请求，含握手、探测；按请求身份计，不按生命周期行计 | E02 177 是当时调用流水筛选，E03 192 是加入关联握手后的集合，均不自证全部入口覆盖 |
| 工具调用 | event_type=tool_call 的独立调用；含元数据、begin、拒绝、错误、预算终止 | E02 175；server/discover 的 2 条归 protocol。故障注入工具仍归 tool_call |
| 执行尝试 | 独立 attempt_id；一调用可多次尝试 | 不能凭 request_id、SQL 或投影行数补造历史 attempt |
| 已登记问询 | 按有效显式 turnId 去重；原文未上报与无显式问询分别标识 | 不由调用事件数或推断分组数推定真实问询数 |
| 展示分组 / 会话访问 | 按已声明聚类规则生成的业务候选分组及仅握手分组 | E01 共 26：19 仅握手 + 7 业务分组；19=14 Codex+3 WorkBuddy+1 Claude+1 mavis |

协议访问以请求为分母；业务问询以**已登记问询集合**为分母。推断业务分组单列，不能冒充真实问询分母；工具成功率按固定工具集合与已裁决主状态计算，未知数量一并披露。仅握手分组默认不进业务问询列表，但原始权威记录不采样、不因展示聚合消失。

**（b）六项 auditCoverage 检查**

各项独立取 pass/fail/unknown/not_applicable，带单位、N/D、证据源、截止位置、差异 ID 集合与理由。pass 的覆盖率要求 D>0、独立证据充分、N=D 且额外/冲突集合为空、没有未披露缺口；仍在处理、indeterminate、证据缺失不能被充作已完成。无法建立独立预期集合时记 unknown，禁止用同侧投影自证入口无漏记。

| 检查项 | D / N 与证据边界 | 不通过或未知的处理 |
|---|---|---|
| 1 入口接收覆盖 | D=在声明路由/窗口内由独立入口计数或受控发送凭据确认到达 Lucy 边界的请求 ID；N=有持久 received 的匹配 ID | 客户端仅 attempted/sent 不证明到达；缺独立边界证据记 unknown，边界外健康/恢复路由须事先声明 |
| 2 处理终态覆盖 | D=自持久 received_at 起经过 T1 的请求集合（含无 admitted），单位=request；尝试明细另按 attempt_id 展示；N=有可核验处理终态的 ID | 在途、取消请求未确认、indeterminate、超期缺终态分别列数，不互相抵销 |
| 3 投影追平 | D=canonical ledger 在 S 内应投影的事件 ID；N=冻结投影实际包含的匹配 ID | 账本提交上界是独立依据；缺失/额外/内容不一致均列出，不能从投影自己的最大序号取 S |
| 4 关联依赖齐全 | D=包内需关联的快照/来源/问询/握手引用；N=目标存在且有效的引用 | 引用有效不代表归属 confirmed；无明确问询的候选不得伪造引用 |
| 5 跨端匹配 | D=预先冻结目标客户端集合内、窗口中应有双侧观测的调用/尝试 ID；N=有有效关联凭据且参数/结果按同版本规则一致的 ID | 无适配器/无上游 ID/缺观测单列；不按已采用客户端事后缩分母。范围外客户端也披露不可观测数量 |
| 6 导出覆盖 | D=固定筛选+S+协议规则的预期导出 ID；N=包内实际匹配的 ID | 分页终止、重复、遗漏、额外行分别检测；文件 hash 验证另行判定 |

**保留既有四子域，不做近似替换**：

| 20261019 §6 子域 | 本增量关联检查 | 必须保留的独立语义 |
|---|---|---|
| dataScope | 3、4、6 提供证据 | 原有筛选、投影、快照与纳入范围判断不变 |
| associationQuality | 4 只检查引用有效性 | confirmed/candidate/conflict/unassigned/legacy_unverified 的语义质量分布；引用齐全不能替代 |
| clientCoverage | 5 提供匹配证据 | 已登记客户端能力、上报覆盖及不可观测边界 |
| integrityVerification | 6 的输出作为输入之一 | Manifest 文件清单、字节摘要、缺文件/替换验证独立执行，不等于行集合相同 |

旧 complete/combined_complete 保持原版本定义；新增 auditCoverage 六项结果不静默覆盖旧字段。若要提供新综合结论，须版本化定义组合规则并保留每项状态；unknown 不合成为 pass。

> 实施回写见 §18（2026-10-25，N20、N5）：检查 1「入口接收覆盖」的 D 取 canonical ledger 的 `received` 事件 ID ∪ `auth_failure_log` 拒绝记录 ID（裁决 D2）；`combinedComplete` 的判定式由 §2 显式绑定到 audit-trust R1 判据 #6，与本节六项检查互不替代。

**（c）对账生命周期与差异分类**

```
attempted → sent → accepted → dispatched → completed → response_created → delivery_observed
```

每阶段有独立证据边界；对账差异七分类：本地未发出 / 入口未观察到 / 终态缺失 / 参数冲突 / 结果冲突 / 过滤排除 / 待核验。历史实例登记：Claude 第 21 次自报查询→待核验（不强行配对）；wiki 工具不可用调用→本地未发出。

### 8.3 验收

A06（预算终止计入汇总、分类合计=关联记录总数）；A09（差异显式呈现不伪造匹配）；A12（历史集合 177/192/175、19 个仅握手分组〔其中 Codex 14〕及差异可重复计算；无独立入口证据的覆盖项仍为 unknown）；Codex 31 条协议记录旧 outcome 闭合（23 ok / 3 denied / 4 error / 1 budget_stop，23 ok 含 3 握手）、Session B 口径统一为工具调用 50。

### 8.4 失败与恢复与历史兼容

- 失败与恢复：对账任一侧不可用时，受影响维度标 unknown 并附原因与恢复计划，禁止以同侧数据自证 100%（呼应 F04：schema 可用不等于审计已持久）。
- 历史兼容：旧 outcome 保真见 S01 §4.6；协议请求/工具/尝试/登记问询/展示分组分开披露。旧字段不更名换义，不回改历史导出；旧口径下线须另有批准版本。

### 8.5 裁决状态

U6 已冻结（§15）：T1=24h 自持久 received_at 起算，覆盖无 admitted 的请求；T2=72h 同从 received_at 起算，仅用于跨端差异结算，不是 ACK 超时；T3=60s 自导出捕获账本上界 S 起算。期限不因重启、晚到事件或重试自动延长；重开须人工或追加修订事件。

## 9. S06 导出快照与证据封存契约

### 9.1 目标与非目标

- **目标**：导出在固定截止位置上生成、不可变、自洽；补包/纠错/重导出生成新版本并关联旧版；声明纳入集合=导出集合，排除项显式。
- **非目标**：不宣称抵御已控制主机者（沿用 20261018 §5.3）；本地清单验证不等于来源证明（术语标准禁止"防篡改签名"宣称）。

### 9.2 现有条款映射

沿用 Spec 185（SQLite backup 快照、快照后源库新行不得混入）、20261019 Spec §6（固定筛选 + 序列上界 S + 冻结快照 + nextCursor + completeness 四子域）、Spec 162 §8（导出页大小 10,000 + 游标，不静默丢行）。

### 9.3 数据契约

**（a）导出 manifest 必填字段**（在 137 §6.3 与 20261019 §6 基础上增补）

```
exportId, exportedAt, watermarkSeq(S), 对账评估时点(cutoff_at), 时间范围, filter(全量序列化), 协议包含规则,
握手范围声明(linkedHandshakeRowCount 语义沿用), 排序键, 分页游标与规则版本,
规则版本(classificationVersion / derivationVersion / specVersion / audit-profile), 行数(每文件),
每文件 sha256, 纳入文件清单, 排除项声明(排除什么、为什么), 前版 exportId(补包时),
exported_by, export_reason, export_approval_ref（无值按六值 null_reason 记录原因）
```

> 实施回写见 §18（2026-10-25，N13）：`watermarkSeq(S)` 的来源此前取投影自身序号，与本节「S 为账本已提交上界」冲突；本轮改为由 canonical ledger 已提交上界供给，未提供时正式导出 fail-closed。

**（b）版本链与封存三件套**

- 补包、纠错、重导出生成**新版本** exportId 并关联前版；旧版本事件集合不得漂移（历史反例：总清单 58/65 通过与 4 处哈希不一致并存——分包清单与总清单是不同层次，分别验证、分别记录）。
- 封存三件套分开定义：**清单**（覆盖范围与哈希）、**验证步骤**（如何重算）、**来源声明**（谁导出、依据什么授权）分别落字段；同目录可重写的清单不被当作不可抵赖证明。
- 相同截止位置 + 相同筛选/协议规则/计量单位/规则版本 ⇒ 相同事件集合（A10）；新增握手不改变旧包（A11）；删除/替换文件可被清单验证检测。

> 实施回写见 §18（2026-10-25，N15）：「删除/替换文件可被清单验证检测」此前不可能成立 —— 校验只验哈希字符串长度、不重算内容；本轮改为重算文件内容 sha256 并比对。

**（c）跨文件关系声明**

证据包内 access_log ↔ access_log_sources ↔ permission_snapshots ↔ 握手行的关联键在 manifest 中声明（沿用 20261019 §6 快照引用检查）；问询 CSV 与调用 CSV 经问询 ID 关联（沿用 Spec 140/172），导出包内必须保证"调用上的问询 ID 都能在问询 CSV 找到"（172 §2.7 配对规则）或显式声明例外集。

### 9.4 验收

A10（并发写入与分页不重不漏）、A11（缺失/替换可检测，补包不改旧清单）；历史样本核对：177 条两两一致、192-177=15 握手行身份可列、E07 七项异常可复现。

### 9.5 失败与恢复与历史兼容

- 失败与恢复：导出中断不得释放半成品包；manifest 构建失败即整体失败。冻结快照后源库新事件不混入（Spec 185 语义），新事件只能进入新 exportId。
- 历史兼容：旧导出物保持原样、不追补字段；新 manifest 字段只作用于新 exportId（历史样本 E06 保持只读基线）。

### 9.6 裁决状态

U7 已由 Kimi 裁决（§15）：本期仅来源声明（manifest 增补 exported_by / export_reason / export_approval_ref 三字段），不引入签名；术语标准相关禁令维持，客户 profile 需要时 v2.6+ 单独 spec。

## 10. S07 错误、重试与预算契约

### 10.1 目标与非目标

- **目标**：错误分类统一且版本化；修复提示必须指向真实支持的参数形态；重试关系可追踪；预算消耗四维计量且不可被重连/省略 begin_question 重置。
- **非目标**：不替换 Spec 162 预算引擎与四维度失败分类（沿用，不另建竞争计数器）。

### 10.2 现有条款映射

沿用 Spec 162 §7.2（预算默认值 20 次数据工具 / 120 秒墙钟、可继续语义、budget_stop 不是 error 不是 denied）、§7.3（classify() 固定顺序与 repairHint）、20261019 Spec §7（attemptId/scope_change、错误提示边界、预算复用）。

**v0.25 统一错误七分类 → 162 四维度映射**（classificationVersion 版本化，同源分类函数产出）：

| 七分类（v0.25 权威） | 162 failure_dimension | 例（历史样本） |
|---|---|---|
| client_schema_failure（入参校验失败） | 用法与语义 | measures 缺省（-32602） |
| validation_failed（语义校验失败） | 用法与语义 | count_without_source、ambiguous_field、aggregate_of_aggregate |
| policy_denied（策略拒绝） | 权限拒绝（须有真实授权裁决） | explicit_table_required:<table>、capability_forbidden、sensitive_metadata_forbidden:kx；explicit_table_required:<empty> 仍归 validation_failed / 用法与语义 |
| upstream_failed（上游错误） | 引擎超时与并发 / 用法与语义（按 162 既有规则归并） | Invalid use of group function、DNS ENOTFOUND |
| cancelled | U8：failure_dimension 留空，null_reason=not_applicable；旧四维枚举不变 | 有执行取消凭据；只有取消请求不够 |
| timeout | 引擎超时与并发 | 上游墙钟超时 |
| budget_stopped | 无维度（162 §8 保持），主状态有桶（S01） | question_budget_exhausted（事件 2642） |

### 10.3 数据契约（补充）

- **修复提示可用性闭环**（历史三包出现 count_without_source → row_count(source) → measure_not_found）：repairHint 返回前按工具真实 Schema/编译能力校验语法、参数形态、对象存在性、当前主体可见性和可调用性；同名对象存在不等于 row_count(source) 可执行。不得为校验提示盲目发真实数据查询；可复用受治理的元数据/编译校验。无可验证修复目标则给事实性错误与可用候选，不给虚构函数。A12 增加合法目标、同名不可调用、不可见/不存在目标三类断言。
- **重试关系**：新执行有新 attempt_id/operation_id 与新入口 event_id；retry_of 指向原入口 event_id，parent_attempt_id 只指原 attempt_id，client_call_id（如有）可保持。仅对实际可观测同一任务链的条件/上限/连接变化记 scope_change，禁止仅比较无关调用就推断“绕过预算”；边界沿用 20261019 §7。
- **预算四维计量**：业务调用数、尝试次数、墙钟、并发占用分别记录；**重连与省略 begin_question 不得重置任何一档预算**；续跑保留终止原因与 continuable 关系（2642 样本）。
- **禁止虚构**：本地未发出（客户端校验失败）不得记为服务端调用；本地失败与服务端失败分别入账（S05 差异分类）。

> 实施回写见 §18（2026-10-25，N19）：无 `turnId` 的请求此前直接放行且不计预算、预算计数器纯内存重启即清零；本轮按凭证 / 会话级兜底作用域限流并落库持久化。

### 10.4 验收

A05（错误码保留、成功率不误增）、A06 预算部分；A12 回归样本含 row_count 提示闭环与 2642 续跑关系。

### 10.5 失败与恢复与历史兼容

- 失败与恢复：预算计数器持久化失败按 S02 语义阻断（503 AUDIT_UNAVAILABLE），不得无预算放行；恢复后以账本为准幂等重建故障期间的计数，禁止凭内存计数继续。
- 历史兼容：既有 budget_stop 与可继续语义不变（Spec 162）；failure_dimension 四值不迁移，七分类以 classificationVersion 并行披露。

> 实施回写见 §18（2026-10-25，N19）：预算计数已改为以持久化状态为准；持久层读取失败独立为 `question_budget_unavailable` → HTTP 503，**不记** `budget_stop`，不得被读回为合法预算终止凭据。

### 10.6 裁决状态

U8 已由 Kimi 裁决（§15）：保留未映射——七分类独立版本化（classificationVersion=v2p5-1），failure_dimension 四值不变，cancelled 记空值 + null_reason=not_applicable；不静默增加旧枚举。

## 11. S08 故障注入与历史回放验收

### 11.1 目标与非目标

- **目标**：用固定历史样本 + 可控故障场景，把 S01–S07 的每一条声称变成可执行断言；验收覆盖入口、事件存储、投影、汇总与导出全链路，不只验证两份副本相等。
- **非目标**：本 spec 不实施测试开发；A01–A12 全部标注未执行。

### 11.2 现有条款映射

沿用 20261018 Spec §7 SEC-19 场景族（权威定义于该 Spec 场景表 + `scripts/e2e/contracts/case-catalog.yaml` V01–V07）与 docs/qa 验收矩阵接线；EA 编号族（20261019 Spec）与 A 编号族的映射见 §13.3。

### 11.3 数据契约：历史回放基线

- 固定样本：§3 样本表全部数值（177/192/175、旧 outcome 110/23/43/1〔2 次探测已含于 23〕、137/36/2、14+5=19 仅握手分组、request_id 复用映射）。
- 回放比对维度：**事件 ID 集合、事件间关系（握手↔会话、inferred↔turn、retry_of↔原调用）、冲突标签清单**——禁止只比总数（历史反例治理：总数一致但 2455 分类冲突、Claude 差额 1 次，均为总数对账不可见）。
- 预期结果登记：每个 A 场景在 case catalog 登记输入、前置条件、故障点、预期事件集合、状态与关系、证据位置、判定规则（§13.2 模板）。

### 11.4 失败与恢复与历史兼容

- 失败与恢复：历史静态回放与在线故障注入使用独立测试数据目录/账本命名空间及 test_run_id；不向历史样本写测试事件。在线故障调用按真实事件类型计入本次测试集合（工具仍是 tool_call），另标 fault_injected；不得以协议类型伪装、删除账本或临时调分母掩盖失败。历史样本只读，测试清理只作用于隔离环境。
- 历史兼容：回放样本（177/192/175 及关系、冲突标签）只读冻结；期望结果一经登记不得随实现进度回改，改基线须走本 spec 版本修订。

### 11.5 裁决状态

U9 已由 Kimi 裁决（§15）：Stage 1 开发单机全量 A01–A12，Stage 2 客户 K8s 单副本重跑 A01/A02/A04/A10/A11；两阶段证据独立成包。

---

## 12. 核心流程（伪代码）

### 12.1 入口接收与持久化屏障（S02，SEC-19 配套）

```text
onIngress(request, endpointId):
  # 按既有准入解析并分配身份；健康/恢复例外路由事先登记，不冒称业务覆盖
  ids = allocate(operation_id, attempt_id, ingress_event_id)
  durableAppend(received, ids, endpointId, received_at)
    else return failClosed(AUDIT_UNAVAILABLE) # 不确认持久接收，不分派（U3 已裁决：仅阻断，无缓冲）
  enableAuditCorrelationHeaders(ids.ingress_event_id, ids.operation_id, ids.attempt_id)
  # 仅到此才允许发送审计关联头；received 失败的 503 无此类凭据
  validateEnvelope()
    else return durableFailureOrBlock(validation_failed, execution=not_executed)
  evaluateAuthorizationAndBudget()
    else return durableFailureOrBlock(denied or budget_stopped, execution=not_executed)
  durableAppend(admitted, new_event_id, ids)
    else return failClosed(AUDIT_UNAVAILABLE) # received 成功也不能替代 admitted 屏障
  dispatchAuthorizedWork(ids)
```

每次 durableAppend 使用独立账本 event_id，并引用同一 operation/attempt；durableFailureOrBlock 也必须处理自身提交失败，不能发送无持久凭据的成功内容。沿用现有异常响应、流式中止与告警行为；U3 已冻结本期无缓冲，未来引入须另立 spec 批准。

> 实施回写见 §18（2026-10-25，N20）：认证 / 路径 / Origin 层拒绝发生在任何账本写入之前，从不进 canonical ledger；该类请求改以 `auth_failure_log` 作为独立入口证据参与覆盖分母（裁决 D2）。

### 12.2 执行、终态与恢复（S01/S02/S07）

```text
onExecutionDone(ids, result):
  recheckAuthorizationVersion() else return discardAndDurablyRecordDenial()
  durableAppend(response_prepared, new_event_id, ids,
                sanitizedSummary, executionEvidence, digestVersion)
    else return discardContentAndFailClosed() # 上游可能已执行；无此屏障不发内容
  observeSendOutcome()                      # 只能写实际观察到的发送结果
  durableAppend(delivery_observation_or_terminal, new_event_id, ids)
    else alertIndependently()               # 进程也可能在此前直接死亡

onRecovery(currentGeneration):
  committed = readCanonicalLedger()         # 不只查投影或 interrupted 列表
  pending = deriveUnfinishedOperations(committed, previousGenerations)
  for op in pending:                        # received/admitted/prepared 前缀无终结闭包
    appendRecoveryMarkerIdempotently(op, interrupted, recoveryGeneration)
    preserveAllExistingExecutionAndDeliveryEvidence(op)
    # 若屏障契约可证无 admitted 则不曾分派，保留 execution=not_executed；不猜上游结果
    evidence = reconcileReadOnlyWithAvailableUpstreamReceipt(op)
    if evidence proves result: appendVerifiedResolution(op, evidence)
    else: retain indeterminate + reason + nextReviewDeadline
  # 不为补日志重新执行业务；重复重启不得多计调用、丢弃未核验项或重复修订

onRetry(originalIngressEvent, originalAttempt, newRequest):
  allocate(new_attempt_id, new_operation_id, new_ingress_event_id)
  record(retry_of=originalIngressEvent.event_id,
         parent_attempt_id=originalAttempt.attempt_id)
  runNormalAdmissionAndPersistentBarriers(newRequest)
```

若旧终结定义不足以证明操作闭合，先保留 unknown/indeterminate，不自行推定成功。已有 execution=succeeded 而 delivery 未闭合时仅核对交付分支；核验以追加记录生效，原记录不改。恢复扫描批量大小与重扫期限在实施 Plan 中引用 U6 批准值；U3 已裁决无缓冲。

### 12.3 主状态派生与汇总（S01/S05）

```text
derivePrimaryStatus(facts):                  # 仅使用 as-of S 的可核验证据
  facts = reconcileCompletionAndCancellationReceipts(facts)
  if facts.unresolvedContradiction: return unknown + conflict
  if facts.budgetStopped and facts.notExecuted: return budget_stopped
  if facts.authorizationDenied and facts.notExecuted: return denied
  if facts.verifiedFailureOrValidationFailure: return failed
  if facts.verifiedExecutionSuccess: return succeeded
  if facts.verifiedCancellation: return cancelled
  if facts.executionTimeoutReceipt: return timeout
  if facts.durablePrefix and facts.interruptedWithoutResult: return indeterminate
  return unknown                            # legacy ok 不直接提供上述凭据

summarize(unit, filter, S, classificationVersion, derivationVersion):
  units = deriveUnitsFromCommittedEvents(unit, filter, seq <= S)
  assert ruleVersionsAreFrozen()            # 派生规则以 §15-U10 批准值 derivationVersion=v2p5-1 为准
  for u in units:
    facts = normalizeWithEvidence(u)        # 保留 raw_code / legacy_outcome / 冲突
    status[u] = derivePrimaryStatus(facts)  # 八桶完整覆盖，交付观测独立
  assert union(statusBuckets) == ids(units) and bucketsAreDisjoint()
reconcile(fixedWatermark, independentlyDeclaredSets):
  retain(matchedIds, missingIds, extraIds, conflictIds, unobservableIds)
  classifyDiffs() ∈ {本地未发出, 入口未观察到, 终态缺失, 参数冲突, 结果冲突, 过滤排除, 待核验}
  never forcePair(unmatched)               # Claude 差额样本保持待核验
```

> 实施回写见 §18（2026-10-25，N23）：首分支 `facts.unresolvedContradiction` 原无判定契约，本轮补记可执行判据（互斥闭合凭据 / 无法证明时序 / 闭合凭据与取消或超时并存且先后不可证）。

### 12.4 归属与修订（S04/S03）

```text
onExplicitBind(q, principal, credential, session):
  validateExistingBindingBoundary() else return recordConflictWithoutRebinding()
  freeze(original_* == effective_*); association_status=confirmed
onAdmissionWithoutExplicit():
  exactlyOneSessionCandidate() → session_bound/candidate(low)
  else → unassigned/none                   # NEVER backbind by elapsed time
onLateRevision(event, reason, evidence, ruleVersion):
  validateVisibilityAndEvidence() else return retainConflictOrCandidate()
  durableAppend(association_revision)      # 追加修订，不改原始账本；迟到本身不升可信度
```

### 12.5 导出（S06）

```text
onExport(filter):
  S = canonicalLedger.committedWatermark() # 账本已提交上界，禁止取投影自己的序号
  catchupDeadline = monotonicNowAtCapture(S) + 60s
  waitUntilProjectionCovers(S, deadline=catchupDeadline)
    else return failFormalExport()        # 追平超时仅出诊断 partial 包（§15-U6）
  snapshot = freezeConsistentProjectionSnapshot()
  assert snapshot.covers(S)                # SQLite backup / 一致读快照沿用 Spec 185
  expectedIds = selectDeclaredSet(snapshot, filter, seq <= S, protocolRules)
  files = renderAllPages(snapshot, expectedIds, seq <= S)
  # 所有关联、修订生效、聚合均 as-of S；投影已超过 S 也不得混入新事实
  assert exportedIds(files) == expectedIds and noDuplicateIds(files)
  manifest = buildManifest(files, sha256, filter, S, ruleVersions, exclusions, prevExportId?)
  verifyFilesAndReferences(manifest)
  atomicallyPublishCompletePackage()       # 中断/校验失败不发布正式半包
```

若底层投影只保留当前值而无法计算 as-of S，必须沿用可保留历史/重建的账本与冻结设计解决，不能仅给行加 seq 过滤便声称修订视图一致。诊断 partial 包须与正式导出区分，列出实际上界及缺失集合；不得携带“完整”结论。

> 实施回写见 §18（2026-10-25，N13、N14、N18）：v2 导出此前从投影自身取 S 且无 HTTP 路由（仅测试可达），本轮已修正并接入正式路由；投影只保留最新状态的限制仍未消除，as-of S 的实现路径与口径见 §18。

---

### 12.6 客户端接收观测与对账期限（S01/S03/S05）

```text
onClientObservation(observation):
  validateExistingAdapterAndVisibility() else return rejectObservation()
  if identicalObservationAlreadyCommitted(adapter_id, clientEventId):
    return resumeIdempotentObservationClosureAndReturnOriginalReceipt()
    # 只补未完成审计闭包/投影，不重复观测/ACK，不重执行业务
  if sameObservationIdWithDifferentContent(adapter_id, clientEventId):
    return appendConflictAndRejectUpgrade()
  durableAppend(client_observation, observation, observed_at, server_received_at)
    else return failClosed(AUDIT_UNAVAILABLE)
  if observation.type != result_received: return noDeliveryUpgrade()
  if adapterNotIntegratedOrParentAttemptDigestMismatch():
    return recordConflictOrUnknownWithoutAcknowledgement()
  durableAppendIdempotently(delivery_evidence, source_client_event_id, acknowledged,
                           parent_ingress_event_id, attempt_id)
    else return failClosedAndLeaveAuditablePendingObservation()
  # 接收观测已提交而 ACK 闭包失败时，重放仅幂等补审计闭包；不据内存发布 ACK
  # 不改 execution；缺回执、不支持回执、接入口 HTTP 200 均不产生 acknowledged

settleAt(cutoff, S):
  for request in committedReceivedRequests(seq <= S):
    T1_deadline = request.received_at + 24h
    T2_deadline = request.received_at + 72h
    # 无 admitted 也有 deadline；原请求时间不因重启/晚到/子重试重置
    if cutoff >= T1_deadline and noVerifiedProcessingClosure(request, S):
      appendDifferenceIdempotently(终态缺失, request, T1_deadline, profileVersion)
    if cutoff >= T2_deadline and expectedClientObservationMissing(request, S):
      appendDifferenceIdempotently(待核验, request, T2_deadline, missingClientEvidence)
    # 对缺适配器等情况披露不可观测，不写 unacknowledged，不缩原总体分母
  # 迟到证据始终追加；更正结算另追加 revision，旧 S/旧包不随之改变
```

正式导出 T3 使用捕获 S 时开始的单调等待计时（默认60s），不因重试追平操作重新计时。客户端观察时间和 Lucy 接收时间分别保存；期限采用账本的 Lucy UTC received_at，不以客户端时钟或补传时间回拨期限。

---

## 13. 追踪矩阵与验收场景详表

### 13.1 F → S → A 追踪矩阵

| 发现 | 关联 Spec | 验收场景 |
|---|---|---|
| F01 问询汇总不闭合 / 口径不一致 | S01（主状态唯一）、S05（指标字典） | A06、A12 |
| F02 跨端结果分类冲突（2455） | S01（三视图/空值语义保真/冲突标签）、S07（错误分类） | A05、A09 |
| F03 自报与入口数量差异 | S03（跨端关联）、S05（差异分类学） | A09、A12 |
| F04 导出一致≠入口无漏记 | S02（入口持久化）、S05（六维完整性）、S06（导出边界） | A01、A02、A03、A10、A11、A12 |
| F05 归属与唯一关联键不足 | S03（标识唯一性）、S04（归属优先级） | A07、A08 |
| F06 结果与上游证据断点 | S01（delivery/摘要）、S03（上游关联） | A04、A05、A09 |
| F07 总包证据版本漂移 | S06（版本链/清单分层） | A10、A11 |
| —（全部发现的可靠性声称） | S08 | A01–A12 |

### 13.2 验收场景详表（全部未执行）

执行器字母表：B=真实浏览器；P=直接协议/HTTP；D=真实 DB；A=真实 Agent 产品客户端；O=运维/故障；V=证据校验器（沿用 20261018 §7 符号）。每项状态均为 **未执行**。

| ID | 输入 / 前置条件 | 故障点 | 预期事件集合与状态/关系 | 证据位置 | 判定规则 |
|---|---|---|---|---|---|
| A01 持久前缀与崩溃恢复 | 合法请求；分别在 received 成功后/admitted 前、admitted 后/分派前、执行后/prepared 前、prepared 后/发送前强杀（O+P） | 各屏障之间崩溃，进程来不及写 interrupted | 只要求故障点之前已经提交的前缀存在；第一子例不强求 admitted。启动从账本派生未闭合操作并追加恢复标记；重复重启幂等，不自动重执行业务 | 账本原前缀、恢复修订、上游观测 | 已持久事件不消失；无 admitted 不分派；仅 received 的请求在 received_at+24h 也须结算；重启不延长截止时间 |
| A02 各持久化屏障不可用 | 分别注入 received、admitted、response_prepared 提交失败（O+P） | 只读/满/提交超时 | received 失败：无持久接收确认且无上游分派；admitted 失败：可有 received，但无上游分派；prepared 失败：上游可能已执行，不释放内容，保留此前前缀及独立告警 | 账本、入口观测、上游日志、发送观测 | 禁止“无凭据或未执行”二选一；逐屏障断言；U3 已冻结仅阻断；received 失败不回传三项审计凭据头，admitted 前失败若 received 已提交则头指该 received ID，不指不存在的 admitted；无缓冲测试项 |
| A03 事件重投与业务重试 | 同 event_id 账本重放；同 clientEventId 观测重投；新请求实际重试（P+O） | 重投/重复重启 | 同事件幂等不增调用；同观测 ID 异内容保留冲突；新执行生成新 attempt，retry_of 指原入口 event_id、父 attempt 指原 attempt_id | 账本、投影、客户端观测 | 同一调用多条生命周期/客户端事件不误合并、不重复计工具数 |
| A04 执行与交付断点 | a. Lucy 已持久执行成功但发送丢失；b. 上游执行而回包未达 Lucy（O） | 两种不同断点 | a.execution=succeeded，delivery=unknown/实际发送观测，不能改执行失败；b.execution=unknown、primary=indeterminate，凭据核验后追加结果；无客户端接收证据不写 acknowledged | 账本、上游凭据、客户端接收观测 | 不虚构 Lucy 已知成功、不自动重放；dogfood 有效 result_received 可升级 acknowledged；未接通/缺回执保留 prepared/sent 事实，客户端接收观察为 unknown；72h 仍不写 unacknowledged |
| A05 协议/执行/错误独立 | HTTP 成功但工具 isError；JSON-RPC -32602；explicit_table_required:<empty>/<table>；上游错误（P） | 不同层错误 | 保留原始码与规范化原因；transport、authorization、execution、usability 分别判定；空 source 归用法语义，有真实授权拒绝才归权限 | 原始响应、调用流水、汇总 | HTTP 200 不增加执行成功；无源错误不编权限拒绝 |
| A06 八桶与预算连续性 | 按 §15-U10 已裁决派生表构造八桶、完成/取消/超时竞争、预算耗尽与重连/缺 begin/续跑（P） | 取消请求、确认取消、超时、未知与预算终止 | 八桶均可达且互斥闭合；仅取消请求不证明 cancelled；budget_stopped 独立；预算四维不因重连/缺 begin 重置，续跑关系保留 | 同截止明细、汇总、预算事件 | 每单位恰一个桶；闭合失败/成功先于取消/超时，取消请求不算确认取消；同一尝试互斥闭合或无法核验时序则 unknown+conflict；历史旧 outcome 单列 31=23+3+4+1，不当新派生结果 |
| A07 多层 ID 与复用 | 同会话复用 RPC ID 0–3；同 SQL 两独立请求；一 client_call 多观测/多尝试；上游不支持 ID（P） | ID 复用/能力不足 | 独立执行不合并；观测各有 clientEventId；parent_attempt_id 类型正确；内部 operationId 不填 upstream_operation_id | 身份关系清单、账本、投影 | 历史 2380/2454 等关系保留；HTTP/SSE 回传均引用已提交 received，旧客户端未协商时不插 meta 扩展帧；无证据能力不虚报 |
| A08 重连与归属修订 | 两问询并发、断线重连/重发、迟到 begin、合法/不合法跨会话续接（A+P） | 重连与迟到绑定 | 重连本身不增 attempt，实际新执行有新 attempt；有效续接才延续显式问询；候选低置信；不合法续接保持冲突/未归属；原归属保留 | 归属修订链、续接凭据、预算链 | 无时间回绑、无并发串链；effective_* 可按 S 重建 |
| A09 参数/结果冲突与未知 | 缺参、空值、有界截断；结果错误码、行列、精度/类型、截断或摘要变异；已知脱敏/解析失败/历史未知（P+V） | 参数或结果单字段变化 | 区分缺参/空值/未知、保留 redacted/parse_failed；摘要按相同版本与完整输入边界比较；结果差异显式，不靠相同 SQL/hash 强配 | 原参数/响应的受控证据与摘要、导出 | 2455 保留冲突；500/501 Unicode码点、512/513 UTF-8字节及 emoji/中文边界不破字符/JSON，摘要不取截断预览；错父事件/错attempt/错摘要/heartbeat 不得升级 ACK；T2 前后与迟到修订分别断言，不补执行事实 |
| A10 账本领先与导出一致性 | 故意暂停投影使 ledger>S_projection；导出期间并发写入/归属修订，多页导出（P+O） | 投影积压、等待超时、并发 | S 取账本已提交上界；未追平正式导出失败；追平后冻结快照，所有视图 as-of S，分页不重不漏，>S 不混入；诊断 partial 单列 | 账本 S、快照/页 ID 集合、Manifest | 从投影取 S 的错误实现必须被检出；T3 从捕获 S 起算60s，等待重试不重置，超时无正式包；同 S/筛选/规则/单位/profile 结果一致 |
| A11 文件完整性与版本链 | 隔离副本删/改文件、改关联引用、补包/重导出（V+O） | 缺失、内容或关联变化 | 文件完整性与关联检查分别报失败并定位；新 exportId 关联旧版；旧包字节/清单不改 | 两层清单与校验报告、版本关系 | 不把本地 hash 验证当不可抵赖来源证明；来源三字段有值或明确原因，无审批不编审批引用 |
| A12 历史回放与提示能力样本 | 只读历史 CSV/包；另建隔离 repairHint 能力样本，含合法、同名不可调用、不存在/不可见目标（V+P） | 固定历史差异及提示目标不可用 | 历史 177/192/175；旧 outcome 110/23/43/1〔探测已含〕；归属 137/36/2；19 握手分组+7 业务分组〔5 未上报〕；Session B 50 工具；ID/关系/冲突一致。提示不生成虚构 row_count(source) | 静态回放报告与独立提示校验报告分开 | 2455/Claude 差额不强配；Manifest 65=58通过+3缺失+4不一致只作归档事实，不自动归咎 Lucy；旧180预览保持原样，新500预览按v2p5-1另测；缺独立入口数据项仍 unknown |

各子例仍为**未执行**。U1–U12 最终值已冻结（§15，Kimi 原始裁决及 Codex 经授权复核收口），各项预期引用 v1.0-frozen / audit-profile=v2p5-1；不得以实现选定值反向补齐验收标准。静态回放与真实故障运行报告分开，不能以回放通过宣称崩溃可靠性已通过。

### 13.3 与既有验收编号族的映射（登记用，非替代）

A01↔SEC-19-V05；A02↔SEC-19-V02/V04；A03↔SEC-19-V06 + 幂等投影；A04↔新增（挂 SEC-19 族）；A05–A09、A12↔EA 族对应条目按 20261019 Spec §9 验收矩阵逐条登记"已覆盖/待补充/不适用+证据"；A10–A11↔Spec 137/185 验收波次扩展。映射的最终登记责任在实施 Plan 阶段完成，本 spec 仅固定对应关系。

---

## 14. 既有规范修订清单（冻结内容，后续实施准备同步）

> 原则（沿用 20261019 Spec §2 模式）：2026-10-24 已按 Final 决议完成 R1–R10／R12 的文档同步，R11 维持既有同步；下表记录生效关系，不代表对应代码已实现或验收已通过。历史 10-19 批次与 10-20 基线分开，旧工单通过不视为本次 v0.25 通过。

| # | 目标文件 | 修订内容 | 关联 |
|---|---|---|---|
| R1 | `webui/docs/138-lucy-query-execution-and-turn-correlation-reliability-spec.md` §5/§6 | 归因优先级表第 2 条及 §6 伪代码的 session_bound/high 一并修订为 candidate 语义（confidence=low + association_status=candidate），与 20261019 Spec §4.1、Spec 173 v0.3 对齐；历史导出 36 行 session_bound·low 为正例 | S04 |
| R2 | `webui/docs/140-admin-audit-dual-csv-export-spec.md` §6.1/§6.2 | 保留 v1 原始 outcome；新版本按 S01 八桶完整披露 cancelled/timeout/indeterminate/unknown 等，筛选与汇总同函数同单位同 S，禁止仅四列造成不闭合 | S01/F01 |
| R3 | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` §7.1/§7.3/§8/SC-2/SC-15 | §7.1 与 SC-2 残留 high 对齐 candidate/low；§7.3 与 SC-15 不再无条件推荐 row_count(source)，校验语法、能力、存在性和可见性；七分类保留 explicit_table_required:<empty> 的语义校验分类 | S07 |
| R4 | `webui/docs/172-audit-session-visit-spec.md` §2 | 在 §2 增加替代声明，覆盖原 §2 第 4 条、§4、§6 与 §8 SC-3：PRIOR_BIND_MS=2000、同会话向前 2 秒回绑说明、伪代码 high 及 SC-3 一并标注被 173 v0.3 撤销；握手 attachment 单独列来源与 candidate/low，不混为已确认用户问询 | S04 |
| R5 | `webui/docs/173-audit-one-question-one-inquiry-spec.md` §6.1 | attemptId 占位正式化（S03 契约，T07 配套）；event_id 回传客户端条款；区分逻辑调用、客户端观测、内部 operation、上游 operation；RPC ID 不作为去重键；重连/重发 attempt 语义对齐 §6 | S03 |
| R6 | `webui/docs/08-mcp-audit-question-tracing-spec.md` §7.2 | 明确 Inferred Turn 聚类（120s gap）为展示层重建、非归属回绑（与 173 v0.3 NEVER backbind 的边界声明）；null 字段保留既有五态并补 not_supported（U2：六值枚举已冻结） | S04/S01 |
| R7 | `webui/docs/137-access-log-audit-evidence-hardening-spec.md` §5/§6.3 | summarizeArgsForAudit 增补工具感知 presence；query_preview 新上限由当前180扩展至500 Unicode码点、版本v2p5-1（不将其误写为137已有值）；args_summary 单值512字节；Manifest 增补版本链、profile及来源三字段（§9.3a） | S01/S06 |
| R8 | `webui/docs/185-audit-snapshot-spec.md` | 增补导出版本链/补包关联/排除项声明；登记"快照≠封存"边界 | S06 |
| R9 | `docs/specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md` §4.3/§4.4/§4.5/§6 | §4.3 增补主状态派生函数引用（权威在本文 §4.3）；§4.4 空值无损扩展（U2：六值枚举已冻结）；§4.5 保留 clientEventId 的观测身份并增补调用关联/入口 ID 回传；§6 保留四子域及旧 complete 含义，新增独立 auditCoverage 六项检查 | S01/S02/S03 |
| R10 | `docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md` §5.1 | SEC-19 语义不变；增补 endpoint_id 登记与 indeterminate 恢复核对引用；性能预算条款不变 | S02 |
| R11 | `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` | 已同步（v1.15：引用本 spec v1.0-frozen；U1–U12 全部收口，设计冻结，展示项沿用版本化指标） | 全部 |
| R12 | `webui/docs/00-product-terminology-standard.md` §4.7 分区 | 登记新术语：汇总主状态、空值原因（无损扩展）、协议访问分母、业务问询分母、入口标识、证据版本链、送达状态、尝试（attempt 已含 attemptId 引用但未正式登记词条） | 全部 |

## 15. U1–U12 最终裁决记录（v1.0 冻结值）

原始裁决：Kimi，2026-10-20（v0.3）；复核收口与冻结：Codex，2026-10-20，经委托人授权“修改，完成冻结”。适用 release profile 为 **v0.25 / audit-profile=v2p5-1**。以下为唯一最终值，正文、伪代码、验收与关联建议书保持一致；不存在仍待裁决的 U 项。U5 只将具体标定数值留给实施 Plan，不改变已冻结语义。不得以实现进度改验收标准，不得在实施 Plan 中无版本地覆盖冻结参数。

| # | 最终批准值 | 理由 / 收口说明 | 接口 / 版本 | 受影响验收 |
|---|---|---|---|---|
| U1 | Lucy 侧沿用 `POST /api/agent-audit/events`；v0.25 接入 **1 个 dogfood 客户端适配器（Lucy 调试台/playground）**。通过既有适配器/可见性校验的 result_received 须关联同一入口 event_id、attempt_id 及持久 response_prepared 证据/摘要，才能写 acknowledged。生效值为 **{prepared,sent,acknowledged,unknown}**；unacknowledged 仅保留值域、本期不写，不设 ACK 超时。能力未接通或回执缺失时不冒充已收到；已有 prepared/sent 事实保留，客户端接收观察为 unknown | 修正 v0.3 同时“接 ACK”又“仅预留 acknowledged”的冲突。接入口 HTTP 成功、heartbeat、发送成功或声明一个父 ID 都不是有效接收回执；摘要/父引用不符记冲突，拒绝升级交付状态。ACK 只证明适配器声明的接收观测，不证明用户阅读 | client-observation API v1；delivery 事实追加并保留来源，不改执行主状态 | A04/A09：有效 ACK 正例、未接通/缺失/错配/重复回执反例 |
| U2 | 单一六值枚举 `null_reason ∈ {not_applicable,not_collected,redacted,parse_failed,unknown,not_supported}`；历史空白默认 unknown/legacy_unverified，不推定 not_collected | 无损保留全部既有语义，本期不分轴 | additive TEXT 六值，编码即枚举值 | R6/R9/A09 |
| U3 | 本期仅阻断：503 AUDIT_UNAVAILABLE、fail-closed、**无缓冲**；received/admitted 提交失败不分派，prepared 失败不释放内容 | 沿用屏障，缓冲以后单独 spec 批准；审计性能预算是约束，不是“阻断损失可接受”的实测证明。§12.1 为规范流程，不声称现有实现已经通过 | 无缓冲新接口 | A01/A02 |
| U4 | 目标客户端集合 v1={Lucy 调试台/playground dogfood、WorkBuddy、Claude Code、Cursor、Codex MCP client}；集合外照常使用并披露不可观测。登记三项**集成验证状态**{读取并落盘回传 event_id、上报 ACK、原始证据落盘}，初始均为未验证/未接通，不能当成客户端物理能力不存在；dogfood 前两项通过相应验收后更新。其他客户端改造不承诺 v0.25 | 保留 Kimi 选定总体，不按采用率缩分母。dogfood 是新增受控样本，不能称为当日历史审计参与方；历史 WorkBuddy 多会话等原样保留。第三项只登记既有证据能力，不扩展结果外传范围 | client-capability 登记 v1，含状态来源与生效时间；能力事实未知仍记 unknown | A07/A09/auditCoverage-5 |
| U5 | gap 聚类沿用 Spec 08 §7.2，仅生成 candidate、confidence=none/low；不新增推断方法。具体 `LUCY_TURN_INFER_GAP_MS` 标定留实施 Plan，现基线120000，不回填历史 | 只将候选参数标定后置；显式与会话候选规则沿用，不恢复时间近邻回绑 | attributionRuleVersion 随标定登记 | A08 |
| U6 | **T1=24h，自账本已提交 received_at（Lucy UTC 时间）起算**；覆盖所有已持久接收请求，包括无 admitted、校验/授权失败及预算终止。attempt 的 admitted_at 仅另计执行耗时，不延后此期限。未闭合项超期列“终态缺失”差异，保留 indeterminate/unknown 执行事实。**T2=72h，同自该请求 received_at 起算**，用于客户端观测差异结算，与 T1 独立且不是 ACK 超时；纯本地未发出观测单列，不伪造 received_at。**T3=60s，自导出捕获已提交账本上界 S 起算**，超时正式导出失败，只可生成明确 partial 的诊断包。重启、重试、晚到数据不重置原请求期限；迟到证据追加保存，差异重开须人工或追加修订事件 | 修补 admitted 前崩溃永不结算，以及 T2 无起算点。保留 24h/72h/60s 数值；这些是审计差异结算上限，不放宽既有上游30s、预算120s或独立故障告警。v0.3 的“实施 Plan 可±50%自行调整”撤销；改值须批准新的 profile/version，并同步验收与 Manifest，不覆盖旧包 | `audit.windows.{t1SettlementHours=24,t2ObservationGraceHours=72,t3ExportCatchupSeconds=60}`；audit-profile=v2p5-1 | A01/A02/A04/A10：无 admitted、期限边界、重启、迟到、追平超时 |
| U7 | 仅来源声明：Manifest 增补 exported_by/export_reason/export_approval_ref；无签名/外部归档对接。无审批流程或无审批引用时按 U2 标 not_applicable/unknown，不虚构批准记录，也不新增导出审批流程 | 清单校验不等于独立来源证明；外部设施按未来单独 spec | Manifest schema=v2p5-1 | A11 |
| U8 | 保留未映射：cancelled 的 failure_dimension 留空并记 null_reason=not_applicable；旧四维值域不变，七分类独立版本化 | 兼容旧报表，不静默扩枚举 | classificationVersion=v2p5-1 | A05/A06 |
| U9 | Stage 1=开发单机全量 A01–A12；Stage 2=v0.25 发布前在 linux/amd64 K8s 单副本重跑 A01/A02/A04/A10/A11，其他项分环境登记。Stage 1 由 Lucy 开发实施、Codex 验；Stage 2 由交付工程执行；两阶段证据独立 | 冻结验证要求，当前两阶段均未执行。可复用 L25-07 或已有故障工具，但不得预设待建设的 L25-07 执行器已存在；实施 Plan 明确可执行路径。此项不把 L25-07 本身从非门禁项目自动变成全局门禁 | 登记 stage/environment/evidencePackId | S08、实施 Plan |
| U10 | 八桶定序与竞争规则按 §4.3(a)/§12.3 冻结：先核验矛盾；未执行的预算终止、授权拒绝；失败闭合；成功闭合；确认取消；未闭合超时；中断未定；其余未知。闭合凭据先于取消/超时；互斥闭合、不可验证顺序的冲突不选边，unknown+conflict。多阶段信号并存不自动等于事实矛盾 | 将原定序中的完成优先例外展开为同一可执行顺序，保持 Kimi 事实优先原则；旧 ok 不证明成功，交付独立 | derivationVersion=v2p5-1，API/UI/CSV/包同源 | S01/A04/A06/A12 |
| U11 | **新增变更**：query_preview 从当前实现180扩展至 **500个 Unicode 码点**，先执行既有脱敏，记截断/原始 UTF-8 字节长度及 preview_version=v2p5-1；question_preview 默认500是另一字段，不作为沿用依据。args_summary maxKeys=8、单值512 UTF-8字节，边界不切断字符/JSON。digest_kind={search_text,sql,result}；键排序、数组序/NULL/类型/精度保留、UTF-8；摘要取完整受控规范化输入，不重解释历史 query_hash | 保留 Kimi 选定上限，纠正“沿用已实施500”的事实；500/512为上限，不代表完整原文无条件落盘。沿用受保护摘要与原文边界 | preview_version/digest_version=v2p5-1；original_bytes/truncated additive；历史摘要 legacy/unknown | A09/A12/R7：180旧基线、500/501码点、512/513字节、多字节和完整输入摘要 |
| U12 | 响应头 x-lucy-event-id **固定指向已提交 received 的 ingress_event_id**，不是 admitted 的另一 event_id；operation/attempt 头分别沿用各自 ID。仅在 received 提交成功后回传这三个审计关联头；随后校验/拒绝/admitted/prepared 失败仍回传原 received ID。received 未提交（含提交结果未能确认）、入口解析/分配前失败及明确不纳入路由，不回传任何审计凭据头，不编 ID 或“已接收”。已协商关联扩展的受控 SSE 响应首个 meta 载体携带同等值；旧客户端不插入未经协商的 meta 事件，仅按原协议处理并使用响应头。跨会话凭据 question_continuation 沿用 question_id/original_session_id/continuation_token/claimed_new_session_id；HMAC 绑定主体、凭证、question_id、original_session_id，与服务端问询关系一致并通过既有边界校验后追加续接，不凭同名/时间继承 | 修补错误响应引用不存在 admitted，以及未提交 ID 冒充接收凭据；received 成功不等于 admitted/执行成功。token 延续不重置问询预算。客户端观测 ID≠调用 ID，内部 operation≠上游 ID，父 attempt 只指 attempt | correlationHeaders=v2p5-1；questionContinuation=v2p5-1；未协商客户端兼容规则与受控 SSE 载体纳入 A07/A08 | S03/A02/A03/A07/A08 |

## 16. Codex 修订记录（v0.2 历史记录）

本节保留 v0.2 时点的审阅记录，表中后续事项按当时状态记录，不作为当前待裁决清单。当前裁决与冻结结果分别见 §15、§17；文档修订不等于运行时验收。

2026-10-20 经委托人授权，Codex 直接修改确定性错误与契约缺口，变量交 Kimi 裁决。本轮只修改本 spec 与关联建议书；§14 其余目标文件未执行同步，A01–A12 未执行。下列风险等级描述原草案在未经修正情况下可能导致的风险，不能作为平台当前已发生缺陷的断言。

| 审阅项 | 风险 | 已修订内容 / 位置 | 仍需裁决或后续同步 |
|---|---|---|---|
| V25-01 | 高 | §3/§4.7/§7.3/§11.3/A12 更正 177=110+23+43+1、工具拒绝21、5/7业务分组无原文 | 历史数据不改写 |
| V25-02 | 高 | §4.2/§4.3/§12.3 区分六维与规则版本，补八桶候选全覆盖及冲突保留 | U10 冻结完整派生表 |
| V25-03 | 高 | §4.6 保留 legacy_outcome，取消 ok→succeeded 自动迁移及自动下线 | R2/R9 后续同步 |
| V25-04 | 高 | §12.5/A10 改账本提交上界、投影追平、一致快照、as-of S 与超时失败 | U6 参数；R8/R9 |
| V25-05 | 高 | §4.4/§12.2/A01 从持久前缀识别崩溃未完成项，追加恢复并幂等核验 | 实施 Plan 与故障验证 |
| V25-06 | 高 | §6/§10.3/§12.2 分离调用/观测/操作/上游 ID、纠正父 attempt 类型与重连/重发 | U12 接口；R5/R9 |
| V25-07 | 高 | §4.3(d/e) 保留空值语义与来源强度，不把历史空白或客户端推断写成事实 | U2/U11 编码与摘要策略 |
| V25-08 | 高 | §7.3/§8 明确问询与快照独立引用、计量单位及差异；保留四子域/旧 complete，禁止采用率缩分母 | U4/U6 范围及时限 |
| V25-09 | 高 | A01/A02/A04 拆屏障与丢包断点，取消“无接收凭据或未执行”错误放行条件 | 全部未执行 |
| V25-10 | 中 | §4.3(c)/A09 修正检索 hash≠SQL、原文有界和参数 presence | U11；R7 |
| V25-11 | 中 | §14-R1/R3/R4 补旧伪代码、high 验收及 row_count 提示能力校验的同步清单 | 旧规范尚未修改；A12 未执行 |
| V25-12 | 中 | §11.4/§13 隔离历史回放与在线故障集，按真实事件类型计量，补分支断言 | U9 验证范围；不以静态回放替代故障通过 |

## 17. 设计冻结记录（v1.0-frozen / v0.25）

**结论：设计审阅通过，设计基线已冻结。** 2026-10-20 委托人授权 Codex“修改，完成冻结”；本轮完成 v0.3 复核五项问题收口，保留 Kimi 原始裁决来源并将最终生效值统一到 §15。冻结只覆盖 S01–S08 的设计和验收标准，不包含代码开发、故障测试执行或发布放行。

| 冻结项 | 最终结果 | 条款 / 验收 |
|---|---|---|
| ACK 生效范围 | 1 个受控 dogfood；有效回执可写 acknowledged；unacknowledged 不写、无 ACK 超时 | §4.3(b)、U1、§12.6、A04/A09 |
| 结算盲区与时间锚点 | T1=24h、T2=72h 均从持久 received_at 起算；T3=60s 从捕获 S 起算；覆盖无 admitted，重启/晚到不重置 | §8.2/§8.5、U6、§12.5/§12.6、A01/A02/A09/A10 |
| 回传 ID 与失败分支 | 指已提交 received；提交未确认不发审计凭据头；未协商旧客户端不插 SSE 扩展帧 | §6、U12、§12.1、A02/A07/A08 |
| 预览真实基线与新上限 | 当前180；v0.25 新增500 Unicode码点，保持脱敏；单值512 UTF-8字节，保护字符/JSON边界；不改历史 | §4.3(c)、U11、R7、A09/A12 |
| 文档一致性与生效关系 | 正文、裁决、伪代码及建议书 v1.15 同步；原草案的候选语义已替换，§16 明确为历史记录；R1–R10／R12 已于 2026-10-24 完成文档同步，不改变冻结值 | §2、§14–§17、关联 Plan §2.3 |

**2026-10-24 收口记录**：按已批准 Final 决议重打 P0-1／v0.25 元数据并完成 R1–R10／R12 文档同步；S01–S08 与 U1–U12 未重开，A01–A12 仍未执行。本次只提交需求审查，不启动开发。

**责任与变更控制**：Kimi 为原始起草/裁决人，Codex 为原授权修订、审阅和冻结执行人。以后改变冻结契约、参数或目标集合须记录理由、受影响条款/验收、批准记录及新 spec/profile 版本；纯排版更正不改变契约。U5 数值标定纳入后续实施 Plan，不能借此改变候选/证据语义。没有尚待选择的 U 项。

**验证范围**：本轮执行术语门禁、差异/文档结构及冻结值一致性检查；其他任务并行修改的部署文件不纳入本轮差异，也未被本轮回写；历史 177/192/175 与旧 outcome 110/23/43/1 保持不变。A01–A12 及 U9 两阶段运行时验收仍为未执行，现有实现不因设计冻结自动获得通过状态。未修改历史证据或其他工作区文件。

---

## 18. 实施回写（2026-10-25，Lucy v0.25 W5）

### 18.0 本节性质与变更控制

本节记录 **Lucy v0.25 实施期（W1–W4）实证出的 14 条文档偏差**及其处置，逐条给出「偏差事实 + 证据」「本次裁决／处理」「受影响条款」「是否改变冻结契约」四要素。编号 N5、N10、N13–N24 沿用实施计划 `docs/plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md` §9 的偏差清单编号。

**本节不修改 §1–§17 的冻结正文**，原条款文本保持可追溯；受影响条款处只加锚点注记（`> 实施回写见 §18（2026-10-25）`）。文档头部元数据表不变。

**变更控制**：

- spec 版本仍为 **v1.0-frozen**，audit-profile 仍为 **v2p5-1**；本节**不改变冻结契约**。多数条目是实现向冻结契约对齐（原实现违约），正文无需改动。
- N5、N22、N23、N24 属冻结文本的**消歧与显式绑定**：只在冻结文本已隐含的语义范围内补记可执行判据或口径，不新增状态、不新增取值、不改判定方向、不改任何数值。若后续认定某条超出「消歧」范围，须按 §17「责任与变更控制」另立 spec/profile 版本并记录批准来源，不得以本节为依据原地改写冻结条款。
- **验收状态一律保持「未执行」**：A01–A12（§13.2）全部子例仍为未执行；§17 的「A01–A12 及 U9 两阶段运行时验收仍为未执行」结论不变。本节**不构成验收通过结论**，也**不构成客户交付通过结论**；实现落地只说明契约已有载体，不等于该场景已被验证。
- 本节引用的代码位置以**符号名**为主、行号为当前复核位置；源码后续变动时以符号名为准。

### 18.1 §2 唯一事实源与完整性判定式（N5）

#### N5 — `combinedComplete` 的判定式缺显式绑定

- **偏差事实**：§2「生效关系与唯一事实源」表「计量口径 / 完整性维度」行写明「四子域与既有 complete/combined_complete 含义不变」，但**没有写明 `combinedComplete` 的确切判定式**。该判定式实为 audit-trust R1 验收矩阵的**冻结判据 #6**：`combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk`（严格三项 AND，不含第四项）。本轮实施 D-10 修复时，最初把 as-of 上界闸门写成 `combinedComplete` 的第四个合取项（`&& asOfBoundEnforced`），导致 audit-trust manifest conformance 用例 2 条红；更严重的是在「无 `ledger_seq` 列」的库上，三项皆为 true 而 combined 为 false，**冻结判据 #6 被自身的修复判为 fail**。
- **证据**：判据文本见 `scripts/audit-trust/2026-10-19-r1-acceptance-matrix.mjs` 的 `EXPECTED_CRITERIA_NAMES`（第 6 条，`"combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk"`）；配套 `scripts/audit-trust/__tests__/2026-10-19-r1-acceptance-matrix.test.mjs` 有**双向防漂移守卫测试**（判据集合任一方向的增删改都会失败）。台账见 `docs/qa/security-findings.yaml` 条目 **D-12**（severity P1，status `fixed`，`spec: "audit-trust R1 验收矩阵判据 #6 / L25-09 §12.5"`；`fixedIn` 待回填 SHA）。
- **本次裁决／处理**：**不改冻结判据、不改判据文本**。as-of 上界闸门折进已有因子 `scopeComplete`（as-of 边界无法落到行上 → 范围不可证明完整 → `scopeComplete=false` → 正式导出 fail-closed），使 `combinedComplete ≡ scope && fileHash && relation` 由**构造**保证、对任何库都成立。落点见 `webui/server/admin/audit-export-v2.ts` 的 `performExportV2`（`asOfBoundEnforced` 判定与 `scopeComplete` 合成）。生产影响为零：`access_log.ledger_seq` 是 additive 列，由 `webui/server/proxy/audit.ts` 的 `ensureColumn` 保证存在，生产库 `scopeComplete` 取值不变。§2 已加注记：① 判定式**就是** R1 判据 #6 的严格三项 AND，**不得**增设第四个合取项；② 新完整性闸门必须**折进已有因子**，**不得**改写合取项个数；③ §8.2(b) 六项检查与 R1 判据 #6 **不可互相替代、也不可互相覆盖** —— 六项检查不可近似替代关联质量或文件完整性，R1 判据 #6 是 manifest 契约的**冻结不变式**。
- **受影响条款**：§2（唯一事实源表「计量口径 / 完整性维度」行 + §2 末尾注记）、§8.2(b)（六项 auditCoverage 检查与 `combined_complete` 的关系）、§9.3(a)（manifest 必填字段）、§9.3(b)（封存三件套）、§12.5（正式导出 fail-closed）、D-12 台账。
- **冻结契约**：**不改变**（spec 仍 v1.0-frozen）。本条是既有冻结判据的**显式绑定与引用澄清**，未新增判据、未改判据文本、未改合取项个数。

### 18.2 §3 历史样本分母口径（N22）

#### N22 — 归属统计未声明分母

- **偏差事实**：§3 表「归属统计：137 unassigned·none + 36 session_bound·low + 2 explicit·high」未声明分母是**工具调用（175）**还是**调用流水（177）**；该行与同表首行「调用流水 E02 177 条 = 175 次工具调用 + 2 次 server/discover 探测」并列时，易被误读为同一集合（175 与 177 不是同一集合）。
- **证据**：审计 Spec §3 表（本文件 §3）；§8.2(a) 计量单位字典已区分「工具调用（E02 175）」与「协议请求（E02 177 是当时调用流水筛选，E03 192 是加入关联握手后的集合）」。
- **本次裁决／处理**：**口径补记** —— 该三行的分母是**工具调用集合（175）**；`137+36+2=175`，剩余 2 条为 server/discover 探测（归 protocol），不参与归属统计。**§3 原表不改**（历史样本为只读冻结基线，§11.4「期望结果一经登记不得随实现进度回改」），仅在本节登记分母口径并在 §3 加锚点注记。
- **受影响条款**：§3（历史样本与冲突登记）、§8.2(a)（计量单位字典）、§11.3（历史回放基线）、A12。
- **冻结契约**：**不改变**。`175 / 177 / 192 / 137 / 36 / 2` 全部保持原值，本条只消除分母歧义。

### 18.3 §4.3(a) / §4.3(b) / §12.3 主状态派生与三视图（N16、N17、N23、N24）

#### N16 — `budget_stop` 映射为 `execution=interrupted`，且四轴分类函数生产未接线

- **偏差事实**：v1.1 四轴分类函数把 `budget_stop` 映射为 `executionStatus="interrupted"`，与 §4.3(a) 第 2 行「预算终止 → 独立 `budget_stopped` 桶」、§4.3(b)「`interrupted` 独占于处理中断且结果未定」冲突；且该分类函数**只在测试中被调用**，生产写 / 读路径均不使用，故 §4.3(a) 末段「API、UI、CSV、证据包调用同一版本分类函数」当时无生产载体。
- **证据**：`webui/server/proxy/audit-classification.ts` —— 旧函数 `classifyAccessLogEvent`（现 `:119`）在其 `executionStatus` 分支把 `outcome === "budget_stop"` 映射为 `interrupted`（现 `:172`）；新口径函数 `classifyAuditEvent`（现 `:310`，`classificationVersion=v2p5-1`）在 `:324`–`:329` 按预算终止 → `not_executed` 处理。本轮 `classifyAuditEvent` 已接入生产写路径 `webui/server/proxy/audit.ts` 的 `writeLog`（现 `:664` 的 `classifyAuditEvent(...)` 调用），与读路径共用同一函数。
- **本次裁决／处理**：v2p5-1 口径下预算终止记 `execution=not_executed` + `primary_status=budget_stopped`；主状态派生由 `webui/server/proxy/audit-derivation.ts` 的 `derivePrimaryStatus`（规则 2）与 `deriveExecutionView` 承担。v1.1 函数**保留**（属历史回放契约，不删不改），但不作生产口径。
- **受影响条款**：§4.3(a)（第 2 行）、§4.3(b)（execution 行）、§4.8（裁决状态）、§12.3（派生伪代码）、A05、A06。
- **冻结契约**：**不改变**。本条为实现向冻结契约对齐（冻结文本本身无歧义）。

#### N17 — `acknowledged` 路径不可达

- **偏差事实**：`AgentAuditAdapter.visibleParentIds` 恒为空集（`new Set<string>()`），任何带 `parent_event_id` 的客户端观测都被判 `parent_not_visible` 拒绝；U1「有效回执可写 acknowledged」整条契约**无实现载体**。
- **证据**：`webui/server/admin/agent-audit-events.ts` —— `visibleParentIds` 字段说明（现 `:52`）、本轮新增 `resolveVisibleParentIds`（现 `:76`）、`result_received` 升级校验 `validateAcknowledgement`（现 `:140`–`:171`，含 `parent_not_visible` / `parent_attempt_mismatch` / `parent_digest_mismatch` 等拒绝原因）。
- **本次裁决／处理**：可见父集合改由服务端按**凭据 scope + 可见性**解析，三条判据同时成立方可见 —— ① 父事件存在于 canonical ledger（不是客户端自称 ID）；② 父事件的 `operation_id` 与该父 ID 的登记 attempt 一致；③ 父事件的 actor / session 与当前适配器凭据 scope 一致。解析失败即空集（fail-closed），**不放宽**为「全部可见」。写 `acknowledged` 仍须父 `ingress_event_id` + `attempt_id` + 持久 `response_prepared` 摘要三重比对通过；不满足者记冲突 / unknown，**不得升级**送达状态，`execution` 不受影响。
- **受影响条款**：§4.3(b)（delivery 行）、§4.8（裁决状态，U1）、§12.6（客户端接收观测）、§15（U1 行）、A04、A09。
- **冻结契约**：**不改变**。U1 的冻结值（1 个 dogfood 适配器、`{prepared,sent,acknowledged,unknown}`、unacknowledged 不写、无 ACK 超时）保持原义；本条只补齐实现载体。

#### N23 — `facts.unresolvedContradiction` 无判定契约

- **偏差事实**：§4.3(a) 第 1 行要求「互斥闭合凭据、无法证明时序 / 同一尝试时保留 `unknown+conflict`，不能猜顺序」，但 §12.3 派生伪代码的首分支 `facts.unresolvedContradiction` **未给出判定条件**，实现无唯一依据（同一输入可能既判矛盾又不判矛盾）。
- **证据**：审计 Spec §4.3(a) 第 1 行 vs §12.3 首分支（本文件两处对照）；实现落点 `webui/server/proxy/audit-derivation.ts` 的 `DerivationFacts.unresolvedContradiction` / `conflictTags`（现 `:91`–`:95`）与 `derivePrimaryStatus` 规则 1（现 `:161`–`:168`）。
- **本次裁决／处理**：**补记判定条件**（消歧，绑定 §4.3(a) 既有措辞「互斥闭合凭据、无法证明时序时保留 unknown+conflict」）—— 满足以下任一即置 `unresolvedContradiction=true`，命中规则 1 → `primary_status=unknown` + conflict 标签：① 同一 attempt / 同一计量单元内同时存在**互斥的闭合凭据**（如既有可核验执行成功凭据又有可核验执行失败凭据）；② 存在两个闭合凭据但**无法证明时序**（无同一时钟域的可验证顺序，或无法证明属同一尝试）；③ 闭合凭据与「确认取消 / 观察超时」并存且先后不可证。反向约束：仅「取消请求 / 观察超时 / 执行完成并存」且可证明先后时**不**判矛盾（§4.3(a) 正文：多阶段信号并存不自动等于事实矛盾）；`conflict` 标签只允许与 `unknown` 组合。
- **受影响条款**：§4.3(a)（第 1 行）、§12.3（首分支）、A06。
- **冻结契约**：**不改变**。补记的是 §4.3(a) 已有措辞的可执行判据，未新增状态、未改判定方向、未改桶集合。

#### N24 — 预算终止时 execution 轴无唯一取值

- **偏差事实**：§4.3(a) 第 2 行「预算引擎明确终止本次尝试，未实际执行 → `budget_stopped`」**未指定 execution 轴取值**；而 §4.3(b) execution 取值域中的 `interrupted` 与 §4.3(a) 第 8 行「有持久前缀、处理中断且结果未定 → `indeterminate`」语义绑定，于是预算终止在 execution 轴出现两个相容读法，**无唯一答案**。
- **证据**：审计 Spec §4.3(a) 第 2 行 / 第 8 行 与 §4.3(b) execution 行（本文件对照）；实现落点 `webui/server/proxy/audit-derivation.ts` 的 `deriveExecutionView`（现 `:235`，`notExecuted` → `not_executed`；`interrupted` 仅由 `durablePrefix && interruptedWithoutResult` 命中）与 `deriveAuthorizationView`（现 `:223`，预算终止 → `not_evaluated`）；v2p5-1 分类入口 `webui/server/proxy/audit-classification.ts` 的 `classifyAuditEvent`（现 `:310`）。
- **本次裁决／处理**：**补记取值约定** —— 预算终止且未实际执行时，`execution = not_executed`；`interrupted` **只**用于「有持久前缀、处理中断且结果未定」（对应主状态 `indeterminate`），**不用于**预算终止。同场景 `authorization = not_evaluated`（预算终止不得记为授权拒绝，§4.3(b) 禁止列 + 20261019 §7）；`delivery` 轴独立取值，不因预算终止改写。主状态桶仍为 `budget_stopped`。
- **受影响条款**：§4.3(a)（第 2 行）、§4.3(b)（execution / authorization 行）、A06。
- **冻结契约**：**不改变**。该约定是 §4.3(b) execution 取值域与 §4.3(a) 第 8 行在现有取值下的**唯一相容解读**，未新增取值、未改桶定义。

### 18.4 §6 S03 列契约（N10、N21）

#### N10 — 标识列已声明但未写入

- **偏差事实**：`access_log` 表结构（`ensureColumn` additive 迁移）已声明 `attempt_id` / `parent_attempt_id` / `event_type` / `instance_id` / `credential_principal_id` / `classification_version` / `attribution_rule_version` 七列，但 `writeLog` 的 INSERT 语句**不包含这七列**，生产真实行该七列恒为 NULL —— §6.2 标识字典声明的关联凭据在落盘侧全部缺失。
- **证据**：`webui/server/proxy/audit.ts` —— `ACCESS_LOG_COLUMNS`（现 `:234`，七列声明在 `:300`–`:307`）与 `writeLog`（现 `:618`，`insertStmt` 的 INSERT 列表现 `:658`；`ledgerSeq` 取值 `:779`）。本轮修复后：INSERT 列表已含上述七列，写入值取自 `AccessLogEntry` 同名字段。
- **本次裁决／处理**：按 §6.2 标识字典补写 INSERT 列表。历史行保持 NULL，**不回填、不重解释**（§4.6 历史兼容：旧 outcome 原样保留为 legacy_outcome）。
- **受影响条款**：§6（S03 数据契约）、§6.2（标识字典）、§4.6（历史兼容）、A07、A08。
- **冻结契约**：**不改变**。冻结文本已声明这些列，本条是实现向冻结契约对齐。

#### N21 — `ACCESS_LOG_COLUMNS` 双份重复

- **偏差事实**：`ACCESS_LOG_COLUMNS` 曾同时存在于 `webui/server/proxy/audit.ts` 与 `webui/server/admin/audit.ts` 两处，新增列须两处同步，否则导出元数据与写入漂移（双写隐患）。
- **证据**：两处常量；本轮已消除重复 —— 保留 `webui/server/proxy/audit.ts` 的单一导出常量，`webui/server/admin/audit.ts` 改为 `import { ACCESS_LOG_COLUMNS as AUDIT_ACCESS_LOG_COLUMNS } from "../proxy/audit.js"`（现 `:22`）后本地引用（现 `:86`），不再自带副本。
- **本次裁决／处理**：确立单一事实源，新增列只在 `proxy/audit.ts` 增加；`admin/audit.ts` 一律引用导出常量。与 §4.3(a) 末段「API、UI、CSV、证据包调用同一版本分类函数」的同源要求一致。
- **受影响条款**：§6（S03 数据契约）、§9.3(a)（manifest 列集 / 规则版本）、§12.3（同源要求）、A03、A07、A09。
- **冻结契约**：**不改变**。本条是实现层去重，不改变任何契约字段。

### 18.5 §8.2(b) / §12.1 入口证据（N20）

#### N20 — 准入先于账本写入，入口接收覆盖的 D 无法计算

- **偏差事实**：认证 / 路径 / Origin 层拒绝发生在**任何账本写入之前**，被拒请求只写 `auth_failure_log`，从不进 canonical ledger；因此 §8.2(b) 检查 1「入口接收覆盖」的 D（由独立入口计数或受控发送凭据确认到达 Lucy 边界的请求 ID）**无法按 §12.1 口径计算**，同一侧投影自证入口无漏记又违反 §8.2(b) 末段与 §8.4。
- **证据**：`webui/server/proxy/admission.ts` —— `recordAuthFailure`（现 `:131`）、`recordIngressRefusal`（现 `:157`）、准入入口注释（现 `:290`–`:296`：HTTP 层认证失败按 D2 不进 canonical ledger，仍走 `auth_failure_log`）；`webui/server/proxy/mcp-proxy.ts` 的准入调用点；写入侧 `webui/server/proxy/audit.ts` 的 `auth_failure_log` 表（现 `:495`）与 `writeAuthFailureLog`（现 `:918`）。
- **本次裁决／处理**：**裁决 D2**（实施计划 §4.3 D2）—— 认证 / 路径 / Origin 层拒绝**仍不进** canonical ledger（避免开一条未鉴权写放大面），但 `auth_failure_log` 作为**独立于账本投影**的入口证据参与覆盖分母。据此，检查 1 的 D = canonical ledger 的 `received` 事件 ID ∪ `auth_failure_log` 的拒绝记录 ID；`auth_failure_log` 记录只算「入口尝试」证据，**不算**执行凭据、不进工具调用计量单位（§8.2(a)）。裁决记录来源：实施计划 `docs/plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md` §4.3 D2 与 §4.2 条目 B22。
- **受影响条款**：§12.1（入口接收与持久化屏障）、§8.2(b)（检查 1）、§8.2(a)（计量单位）、§8.4（禁止同侧自证）、A01、A02、A12。
- **冻结契约**：**不改变**。D2 是 §8.2(b)「独立入口计数**或**受控发送凭据」与 §12.1 注释「按既有准入解析并分配身份」的既有解释，未新增判定规则、未改检查项定义。

### 18.6 §9.3 / §12.5 导出与封存（N13、N14、N15、N18）

#### N13 — v2 导出从投影自身取 S

- **偏差事实**：v2 导出实现以 `SELECT IFNULL(MAX(id),0) FROM access_log` 取得 `S`，即取**投影自身的序号**；而 §12.5 首行明写「S = canonicalLedger.committedWatermark() # 账本已提交上界，禁止取投影自己的序号」，A10 判定规则明写「从投影取 S 的错误实现必须被检出」—— 这是**已存在的错误实现**，不是待实现项。
- **证据**：`webui/server/admin/audit-export-v2.ts` 旧实现（已改；现实现见文件头注释 `:19`–`:22`）、`performExportV2`（现 `:384`）的 `options.ledgerUpperSeq`（现 `:160`）与 fail-closed 判定（现 `:422`）。
- **本次裁决／处理**：`S` 改由 canonical ledger 的**已提交上界**供给（`webui/server/security/store.ts` 的 `maxEventSeq()`，现 `:624`），由调用方经 `options.ledgerUpperSeq` 传入；**未传入时正式导出一律 fail-closed**（不猜、不以投影序号顶替）。诊断 partial 包与正式包分离。
- **受影响条款**：§9.3(a)（manifest 的 `watermarkSeq(S)`）、§12.5（导出伪代码）、A10。
- **冻结契约**：**不改变**。本条为实现向冻结契约对齐。

#### N14 — v2 导出无 HTTP 路由

- **偏差事实**：`performExportV2` / `buildExportPackV2` **没有任何 HTTP 路由**，仅在测试中可达；正式导出路径实际仍走旧 v1 导出，§12.5 的正式导出流程（含 T3=60s 追平、失败不发布半成品包）没有生产载体。
- **证据**：`webui/server/admin/audit-export-v2.ts` 的 `performExportV2`（现 `:384`）与 `buildExportPackV2`（现 `:700`）；本轮已接路由 `GET /api/admin/audit/export-v2`（`webui/server/admin/audit.ts` 现 `:3940`）与 `GET /api/admin/audit/export-pack-v2`（现 `:4035`），路由登记见 `webui/server/index.ts`（`registerAuditRoutes`），路由清单同步见 `webui/docs/03-api-spec.md`。
- **本次裁决／处理**：把 v2 导出接成**正式路径**；S 来源、投影追平（T3=60s，自捕获 S 那一刻起算、等待重试不重置）、正式导出失败不发布半成品包一并落在该路径。
- **受影响条款**：§12.5、§9.5（失败与恢复）、A10。
- **冻结契约**：**不改变**。本条为实现向冻结契约对齐。

#### N15 — 文件完整性校验同义反复

- **偏差事实**：原 `verifyExportFiles` 只校验清单里 sha256 字符串长度是否为 64，**从不重算文件内容**，因此删除 / 替换文件不可能被检出 —— §9.3(b)「删除/替换文件可被清单验证检测」与 A11 判定规则当前不可能通过。
- **证据**：`webui/server/admin/audit-export-v2.ts` 的 `verifyExportFiles`（现 `:332`，逐文件重算 `sha256Hex(content)` 并与清单声明值比对，现 `:341`–`:342`）、`buildExportPackV2` 中的校验调用（现 `:766`）；实现说明见文件头注释 `:25`–`:26`。
- **本次裁决／处理**：清单验证从「声明自洽」升级为「**重算内容哈希** + 跨文件关联键校验」；文件清单与总清单分层、分别验证、分别记录（§9.3(b) 第 1 条）。结论表述只能是「清单验证通过 / 失败」，**不得**写成防篡改签名或独立签名（§2 术语级约束、术语标准 §3）。
- **受影响条款**：§9.3(b)（封存三件套）、§2（术语级约束）、A11。
- **冻结契约**：**不改变**。本条为实现向冻结契约对齐。

#### N18 — 投影只保留最新状态，as-of S 视图无实现路径

- **偏差事实**：`webui/server/security/projector.ts` 按 `operation_id` 合并事件、只保留**最新状态**，历史凭据被丢弃，因此**无法据投影计算 as-of S 视图**；§12.5 末段已自认该限制（「不能仅给行加 seq 过滤便声称修订视图一致」），但未给出实现路径。
- **证据**：`webui/server/security/projector.ts` —— `applyBatch`（现 `:238`）、`mergeEvent`（现 `:166`）与 `security_operation_projection` 表结构（`operation_id` 主键、单行覆盖）；实现路径落点为 `webui/server/proxy/audit.ts` 的 `ledger_seq` additive 列（`access_log.ledger_seq` 现 `:335`、`association_revisions.ledger_seq` 现 `:556`–`:557`，口径注释 `:590`–`:600`）与派生层 `webui/server/proxy/audit-derivation.ts`（只消费 as-of S 的可核验证据，`:15`）。
- **本次裁决／处理**：**登记实现路径** —— 基础行取 `ledger_seq <= S`，再折叠 `ledger_seq <= S` 的修订事件。口径为**保守上界**：行只在其 `ledger_seq` 之后才可能被后续账本事件改变，故纳入 `ledger_seq <= S` 的行是安全的；它**不是**「该行所依赖的全部账本事件序号」—— access_log 行在 `response_prepared` 提交**之前**写入，其 `delivery_status` 反映写入时刻的观测。§12.5 末段的约束**继续有效**：精确 as-of 视图仍需账本历史，本轮未宣称实现，也未把「只按 seq 过滤」当作修订视图一致。
- **受影响条款**：§12.5（末段）、§9.3(a)（as-of S 与 manifest 声明）、§8.2(b) 检查 3（投影追平）、A10。
- **冻结契约**：**不改变**。本条只补记实现路径与口径边界，不放宽 §12.5 末段的约束。

### 18.7 §10.3 / §10.5 预算（N19）

#### N19 — 无 `turnId` 直接放行且不计预算；预算计数器纯内存

- **偏差事实**：`question-experience.ts` 对**无 `turnId` 的请求直接放行且不计入预算**；预算计数器为进程内 `Map`，**进程重启即清零**。与 §10.3「重连与省略 begin_question 不得重置任何一档预算」、§10.5「预算计数器持久化失败按 S02 语义阻断（503 AUDIT_UNAVAILABLE），不得无预算放行；恢复后以账本为准幂等重建故障期间的计数，禁止凭内存计数继续」冲突。
- **证据**：`webui/server/proxy/question-experience.ts` —— 兜底作用域 `scopeKeyFor`（现 `:143`，无 turnId 时取 `scope:<fallbackScope>`）、持久化消费 `consumePersisted`（现 `:187`）、续跑判定 `applyConsume`（现 `:245`，`continuationPresented` / `continuationMatches`）、`isBudgetUnavailable`（现 `:62`）；消费点与 503 分支 `webui/server/proxy/mcp-proxy.ts`（现 `:3663`–`:3699`）。
- **本次裁决／处理**：① 无 `turnId` 时按**凭证指纹 + 会话**的兜底作用域限流，不再直接放行；② 计数以**持久化状态**为准（落库 `question_budget_state`），重启不丢，恢复后以持久态为准重建；③ 续跑凭据必须**非空**且与作用域匹配（避免两个同缺省值比较相等而白送第二个窗口）；④ 持久层读取失败独立为 `question_budget_unavailable` → HTTP **503**，以 `outcome=error` / `decision_reason=question_budget_unavailable` 记录，**不记** `budget_stop` —— 存储故障不得被读回为合法预算终止凭据。`budget_stop` 凭据仍只由真实预算耗尽产生（§10.2 映射表：`budget_stopped` 无 failure_dimension）。
- **受影响条款**：§10.3（预算四维计量、重连与省略 begin_question 不重置）、§10.5（失败与恢复）、§4.3(a)（预算终止独立桶）、A06。
- **冻结契约**：**不改变**。本条为实现向冻结契约对齐。

### 18.8 状态与遗留风险

- **验收矩阵状态**：A01–A12 全部子例**仍为未执行**；本节只登记实现偏差与处置，不改变 §13.2 的任何状态。V01–V22 属其他 Spec 的验收矩阵，本节不涉及。
- **文档元数据**：头部元数据表（版本 / 状态 / 冻结执行人等）**有意保持不变** —— 本节未改变冻结契约，故不产生新的 spec 版本号；「暂不开发」等表述的时效性不在本轮回写范围。
- **未在本轮闭环的项**：N18 所述的**精确** as-of S 视图仍需账本历史能力，本轮只交付保守上界口径与 `ledger_seq` 路径；§12.5 末段的约束继续有效。N20 的入口证据双源口径需要在 §8.2(b) 检查 1 的实际断言中与 auditCoverage 实现对齐后才可声称该检查可计算。
- **交叉引用**：N5 的台账 **D-12**（`docs/qa/security-findings.yaml`）与 N13 的 D-10 相关联 —— D-10 的修复方式由 D-12 收口，两者共同决定 v2 导出的 S 来源与完整性闸门形态。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（登记动作见 §14-R12）：

| English | 中文主术语 | 说明 | 禁止混淆 |
|---|---|---|---|
| Primary Status | 汇总主状态 | S01 派生的唯一汇总状态（8 取值） | outcome 原始枚举（迁移前字段） |
| Null Reason | 空值原因 | 保留 not_applicable/not_collected/redacted/parse_failed/unknown，补 not_supported；U2 已冻结单一六值编码 | 裸 null、未知填 0、丢失脱敏与解析语义 |
| Protocol Access Denominator | 协议访问分母 | 含握手/探测的独立请求集合，不按生命周期账本行计数 | 业务问询分母、工具调用数 |
| Business Inquiry Denominator | 业务问询分母 | 按有效显式 turnId 去重的登记问询集合；推断分组另列 | 事件数、推断业务分组数 |
| Endpoint ID | 入口标识 | 逻辑入口（mcp-http / admin-http / agent-audit-ingest） | 监听端口（端口是登记属性） |
| Evidence Version Chain | 证据版本链 | 导出版本间 prevExportId 关联 | 同目录清单重写 |
| Delivery Status | 送达状态 | 本期写入 prepared/sent/acknowledged/unknown；unacknowledged 仅保留、不写入 | HTTP 200、无 ACK 推定未收到 |
| Attempt | 尝试 | 一次执行尝试，attempt_id 唯一，父引用指 attempt_id | 重连本身、同事件投影重放；重发实际执行则是新尝试 |

已复用登记词条：问询（Turn）、问询 ID、调用流水、工具调用数、关联调用数、会话访问、问询预算、可继续、导出审计证据包、证据校验、归属待核验（conflict）、事件 ID。

## Design System Compliance

本文档不引入 UI 视觉/交互变更；展示层对账与计数呈现由 L25-02/L25-03 承担，其口径以 S05 为数据源。不适用。
