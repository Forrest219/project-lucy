# Lucy v0.25 审计只读对账展示 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-requirements-review |
| 日期 / 目标版本 | 2026-10-24 / v0.25 |
| 功能编号 / 优先级 | L25-02、L25-03 / P0-4 |
| 状态 | **部分实现，未验收**（v0.25 P0-4 / L25-02・03）。实施计划 `docs/plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md` §P0-4；实施基准提交 `21de5168`。2026-10-27 交叉审阅确认：上游精确 as-of S 能力未闭合，正式完整读取与导出必须阻断；验收矩阵在取得真实证据前仍为「未执行」 |
| 交叉审阅 | **Spec 文档评审已关闭，修订通过（2026-10-27）**；本次随 P0-1 同步精确 as-of S 阻断边界与 V09／V10 断言。关闭不代表上游能力已闭合或 V01–V12 已执行 |
| 授权来源 | 2026-10-24 Forrest 批准首批 Spec 评审 Final 决议，并要求完成四个 P0 设计材料 |
| 权威事实源 | [L25-09 S01／S05／S07](lucy-20261020-v2p5-audit-increment-spec.md)、[审计可信度与管理员调查 Spec](lucy-20261019-audit-trust-and-admin-investigation-spec.md)、Spec 162 问询预算 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2 L25-02／L25-03；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) |
| 审查入口 | [首批 P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md) |
| 部署边界 | 单实例／单副本；只改 Lucy，不改 KTX；只读展示不改变 ACL、预算或数据面 |

本文件定义拟实现的只读展示与版本化读取合同。本轮不修改程序、运行配置、客户资产、镜像或数据库，不新增测试代码，不执行浏览器、功能验证或部署。V01–V12 全部未执行。

---

## 1. 需求判断与范围

管理员需要在一笔问询内回答「实际访问了哪些完整表、经历了多少轮次与尝试、耗时如何、预算是否明确用尽」，并能在使用概况中回答「当前配置多少 Token、窗口内多少 Token 有调用、差异由什么构成」。现状的截断表名和笼统「数据异常」不能支持对账。

P0 只补齐**只读解释与对账**，不重做 L25-09 的运行时事实采集。若源事实缺失、冲突或不可观测，页面必须展示相应状态与原因，不得为了界面完整而补造数据。

### 1.1 P0 范围

| 编号 | 能力 | 结果 |
|---|---|---|
| R1 | 问询只读详情 | 完整表身份清单、轮次、调用与尝试、已知耗时、预算状态及归属质量 |
| R2 | Token 配置／活跃对账 | 配置 Token 数、窗口内活跃 Token 数、差异分类与未知身份数量 |
| R3 | 表排行完整身份 | 截断时仍可展开或查看完整连接／Schema／表，不把同名表合并 |
| R4 | API／UI／CSV 同源 | 同一筛选、账本上界 S、计量单位与规则版本；汇总和明细可闭合 |

### 1.2 非目标

- 不新增或修改预算、配额、金额、计费、限流或自动拦截规则。
- 不把 Token 凭证数解释为模型 token 用量；本 Spec 的 Token 均为 **API 访问凭证**。
- 不改变问询归因、权限裁决、执行结果或送达状态；候选关联不升级为已确认关联。
- 不新增第二套审计事实源，不用页面聚合结果反写账本或覆盖率。
- 不补造缺失表名、轮次、耗时、Token 身份、客户端观测或 100% 覆盖率。

---

## 2. 权威口径与不变量

1. **主状态**：使用 L25-09 S01 的八桶 `succeeded / failed / denied / budget_stopped / cancelled / timeout / indeterminate / unknown` 与 `derivationVersion=v2p5-1`；旧 `outcome` 只作历史字段，不替代主状态。
2. **计量单位**：协议请求、工具调用、执行尝试、已登记问询、展示分组分别计数，不按生命周期账本行重复累计。工具调用含目录、元数据、begin、拒绝、错误与预算终止。
3. **统一截止**：同一次页面查询及其明细、汇总、CSV 使用相同规范化筛选、时区、账本上界 `watermarkSeq=S`、快照、`metricUnit`、`classificationVersion` 与 `derivationVersion`。
4. **集合闭合**：每个按声明单位纳入的对象有且仅有一个主状态；八桶合计等于集合总数。比率同时给出 N／D；D=0、未知或不可观测不得显示 0% 或 100% 的确定结论。
5. **归属保真**：`confirmed / candidate / unassigned / conflict / legacy_unverified` 分别展示。已确认与候选调用数分列；仅握手访问不进入业务问询分母。
6. **空值保真**：使用六值 `not_applicable / not_collected / redacted / parse_failed / unknown / not_supported`。空单元格、0、false 与未知不得混用。
7. **预算只读**：沿用 Spec 162 的 20 次数据工具或 120 秒墙钟及可继续语义。只有真实 `budget_stopped` 凭据才显示「问询预算已用尽」；接近上限、超时或普通失败不得冒充预算用尽。

---

## 3. 版本化读取合同

### 3.1 统一对账上下文

所有 R1–R4 响应携带同一逻辑上下文；字段是设计合同，不表示当前 API 已存在。

```yaml
reconciliationContext:
  schemaVersion: audit-reconciliation-view/v1
  instanceId: string
  filter: object                 # 服务端规范化后的完整筛选
  timeRange: {from, to, timezone}
  watermarkSeq: integer          # S，来自 canonical ledger 已提交上界
  snapshotId: string
  metricUnit: tool_call | attempt | inquiry | protocol_request | display_group
  classificationVersion: v2p5-1
  derivationVersion: v2p5-1
  attributionRuleVersion: string
  budgetRuleVersion: string
  generatedAt: timestamp
  completeness: object           # 保留旧 complete 与四子域
  auditCoverage: object          # L25-09 S05 六项独立检查，不由本页重算
```

请求超过 S 的新事件不得混入当前页面或导出。刷新产生新的上下文和 S；暂停时冻结筛选与 S。快照无法覆盖 S，或上游不能证明基础执行／交付事实、归属修订、关联与聚合均可按 S 精确重建时，**正式完整对账读取与导出必须失败关闭**；仅诊断模式可返回显式 `diagnostic_incomplete`、实际证据上界与缺失集合，不能静默换用较新数据、只过滤 `seq <= S` 或保留旧数字冒充当前完整结果。该能力由 P0-1 提供并给出可机器判定的证明状态，P0-4 不以列存在、投影已追平或页面八桶闭合代替。

### 3.2 问询详情 `InquiryReconciliation`

| 字段组 | 必须内容 | 边界 |
|---|---|---|
| 问询身份 | `turnId`、登记来源、原文可用性、会话／展示分组身份、关联状态 | 推断分组明确标候选，不冒充用户原话 |
| 调用与尝试 | 已确认调用数、候选调用数、工具调用清单、独立 `attemptId`、重试父引用 | RPC request_id 不作全局主键；调用数不等于尝试数 |
| 完整表清单 | `connectionId / schema / table`、首次与末次观测时间、调用 ID 引用、来源状态 | 完整身份去重；同名不同连接／Schema 不合并；未知单列 |
| 轮次 | 已登记问询轮次、可观测客户端轮次、无法证明的轮次原因 | 不把工具调用数直接称为用户轮次 |
| 耗时 | 已知起止的问询历时、调用观测跨度、累计工具耗时、最大调用耗时 | 并发累计可大于历时；缺起止时为 null + 空值原因 |
| 预算 | 当前规则版本、数据工具计数、墙钟、预算主状态与终止事件引用 | 不新增计数器；可继续部分结果不等于权限拒绝 |
| 结果与证据 | 八桶主状态、执行／授权／送达事实、auditCoverage、差异与排除项 | 执行成功不证明客户端收到，证据缺口不填绿色完成 |

表清单来自与调用事件关联的可核验来源引用。原始事件没有表身份时显示「来源未知」及原因，不从 SQL 文本无条件猜测；确需解析时必须保留解析版本、置信状态与原始事件引用，且不能覆盖已登记事实。

> 实施回写见 §3.5（2026-10-25）。

### 3.3 Token 对账 `TokenReconciliation`

| 指标 | 定义 | 必须披露 |
|---|---|---|
| 配置 Token 数 | 对账时点配置快照中属于当前实例、符合筛选的持久 Token 身份数 | 配置快照时间、启用／停用分列；不用 Token 备注去重 |
| 窗口内活跃 Token 数 | 同一筛选与 S 内，至少有一个独立工具调用的持久 Token 身份去重数 | 时间窗、计量单位、事件范围；协议事件另列，不偷换分母 |
| 差异集合 | 已配置未活跃、活跃但当前配置不可见、已停用／删除、身份未核验等 | 每类身份或受控 ID 清单、原因、证据引用 |
| 未知身份 | 调用存在但缺持久 Token 身份或历史映射无法核验 | 数量与原因；不得强行归入配置或活跃确定数 |

「活跃数大于当前配置数」不自动等于数据异常：窗口内停用／删除、配置快照时点不同、历史身份未核验均可形成差异。只有身份、窗口与快照口径一致且仍存在额外／冲突集合时，才标记对账失败。Token 页面、使用概况和 CSV 复用同一身份集合与差异结果。

### 3.4 完整表身份与排行

排行按完整表身份和已声明工具调用集合聚合，附 `metricUnit`、S 与规则版本。UI 可视觉截断，但必须提供展开、详情或可复制完整名称；API／CSV 始终保留完整 `connectionId / schema / table`，不以下拉显示字符串作关联键。缺表身份的调用进入独立未知桶，不按名称相似度合并。

> 实施回写见 §3.5（2026-10-25）。

### 3.5 实施回写（2026-10-25，Lucy v0.25 W5）

本小节只追加实施期实证的偏差事实与本轮处理，原则上不改写 §2、§3.1–§3.4 正文。2026-10-27 经委托人授权的交叉审阅属于例外：同步 P0-1 的精确 as-of S 正式阻断边界、实现状态与 V09／V10 验收断言，不改变主状态、计量单位、筛选、S 或规则版本。本小节及交叉审阅均不产生验收证据，§7 的 V01–V12 状态一律保持「未执行」。

#### N9 完整表身份在读路径上不可得

**（a）偏差事实与证据**

两处偏差都落在 §3.4。

1. 连接身份被硬编码。§3.4 要求 API／CSV 始终保留完整 `connectionId / schema / table`。`GET /api/admin/audit/sources` 此前把全部调用记入固定的 `"audit-derived"` 连接桶，无法区分两个连接下的同名 `schema.table`。
2. 去重键只取物理表名。§3.4 要求完整身份去重且不按名称相似度合并。`mergeTurnSources` 以 `physicalTable` 单独去重（`webui/server/admin/audit.ts:1652`），两个连接持有同名 `schema.table` 时被合并成一行，完整表身份在读路径上不可得。

**（b）本轮处理**

已修：

- 连接取自 `access_log_sources.connection_id`，不再硬编码（`webui/server/admin/audit.ts:2754-2761`、`webui/server/admin/audit.ts:2781`）。
- 去重键改为 connection／schema／table 三元组（`webui/server/admin/audit.ts:1640-1650`、`webui/server/admin/audit.ts:1657`）。
- 没有来源记录的历史调用归入显式的 unknown 连接，不编造连接名（`webui/server/admin/audit.ts:2808-2813`）。

**unknown 连接的语义**：连接段取 `unknown` 表示该调用的连接身份不可判定——`access_log_sources` 没有对应来源行，或来源行的 `connection_id` 为空。它不是任何真实连接名，不是默认连接，也不是全部连接的合集。这类调用进入独立的 unknown 连接桶，与 §3.4 要求的「缺表身份的调用进入独立未知桶，不按名称相似度合并」是同一原则在连接维度的落位：不可判定的事实只做显式表达，不因命名相近并入其他连接，也不用推测的连接名填补。API／CSV 中该值原样保留为 `unknown`，不得替换为任何展示用连接名。

**（c）受影响条款编号**

- §3.4 完整表身份与排行（API／CSV 保留完整 `connectionId / schema / table`、完整身份去重、缺身份进独立未知桶、不按名称相似度合并）。
- §3.2 问询详情「完整表清单」行的「完整身份去重；同名不同连接／Schema 不合并；未知单列」。
- §1.1 的 R3（表排行完整身份，不把同名表合并）。
- §7 的 V02、V03、V09。

**（d）是否改变冻结契约**

不改变。§2、§3.1–§3.4 正文一字未改。unknown 连接是 §3.4「独立未知桶」原则在连接维度的实现口径，不是新增数据合同，也不改变 `GET /api/admin/audit/sources` 的响应形状；§4.3 提出的三个拟议只读接口仍未实现。本小节不产生验收证据。

**与 §2 的交叉指认**：unknown 连接是表身份三元组中连接段的取值，与 §2 第 1 条八桶汇总主状态中的 `unknown`、§2 第 6 条空值原因六值中的 `unknown` 分属三个不同维度，不得互相替换或互相推断。§2 的七条不变式原文不因本小节修改。

#### N27 meta-audit 的 event_id 由 request.id 派生，重启后复用导致读取被误拒（D-25）

**（a）偏差事实与证据**

§4.3 要求「API 只读、要求现有管理员审计权限与 meta-audit」。本轮实现的三个只读端点在进入读取前先写一条 meta-audit（EA-11：读取敏感审计详情必须留痕；meta-audit 写入失败时**拒绝**该次读取，不静默放行）——方向正确。但该 meta-audit 的 `event_id` 此前取 `reconciliation-read-${request.id}`，而 Fastify 的 `request.id` 是**每进程计数器**（base-36），进程重启后会从低位重新走并复用上一轮用过的 id；`security_events.event_id` 是 `TEXT NOT NULL UNIQUE` 列。

后果：**每次 Lucy 重启后**，凡是 request id 与上一轮重叠的对账读取都会撞唯一约束 → 账本报 `SECURITY_CONFLICT` → 守卫把「id 撞车」与「安全账本不可用」混为一谈 → 一次**合法的管理员读取**被拒为 `503 RECONCILIATION_READ_REFUSED`，且该次读取的 meta-audit 未能落账。这是**本轮 P0-4 实现引入**的缺陷（既有只读路由用 `audit-association-revision-${row.id}` 这类内容派生的稳定 id，跨重启唯一）。

实证（2026-10-25 W6 重建后冒烟）：上一轮写过 `reconciliation-read-req-9` 与 `reconciliation-read-req-d`；重建后计数器重新走到 `req-9` / `req-d` 时，这两次读取 503，其余（`req-a` / `req-b` / `req-c`）200。

**（b）本轮处理**

- meta-audit 的 `event_id` / `operation_id` 改由**每次读取的随机 UUID** 派生（`randomUUID()`），保证跨进程重启唯一；`request.id` **降级为可追溯信息**（写入 `trace_id`，并保留在 `object_hash` 的输入里），不再承担唯一性职责。
- 拒绝语义不变：actor 不可解析 → 401；安全账本不可用 → 503；meta-audit 写入失败 → 503。**未**放宽任何一条。
- 已补回归用例：固定 `genReqId` 模拟「重启后计数器回到同一个值」，断言两次读取**都**成功、留下**两条不同**的 meta-audit、且 `trace_id` 仍记录 request id。已做去修复反向验证（移除修复后第二次读取确实 503）。

**（c）受影响条款编号**

- §4.3（API 只读、要求管理员审计权限与 meta-audit；meta-audit 失败不静默放行）。
- §3.1 / §3.2 / §3.4（三个只读端点的前置守卫）。
- §7 的 V09、V11、V12。

**（d）是否改变冻结契约**

不改变。N27 当时未改 §2、§3.1–§3.4、§4.3 正文；本条是实现向既有条款对齐（条款从未允许「拒绝合法读取」）。2026-10-27 交叉审阅对 §3.1 的后续同步以本节开头修订说明为准，不回写为 N27 的当时事实。本小节不产生验收证据，V01–V12 状态一律保持「未执行」。

#### 精确 as-of S 的正式阻断接线（2026-10-28 实施轮次）

**本小节性质**：登记 §3.1／§5 对「上游精确 as-of S 能力未证明时，正式完整读取与导出必须失败关闭」的实现落地事实。**不产生验收证据**：V01–V12 状态一律保持「未执行」；本轮**未**构建镜像、**未**执行浏览器测试／real-e2e、**未**连接真实环境。落地提交 `898aa2a1`（P0-1 证明函数与 P0-4 接线同批落地），验证记录见实施计划 §11.6.2。

- 证明口径由 **P0-1 提供**（`webui/server/proxy/audit-as-of-proof.ts` 的 `proveExactAsOfS`），本页**不自建**第二套证明：主状态、计量单位、筛选、S 与规则版本仍全部复用 L25-09。
- 三个只读端点（`GET /api/admin/audit/reconciliation/inquiries/:turnId`、`/usage`、`/export`）在 `mode=complete` 且证明 `ok=false` 时返回 **409 `RECONCILIATION_AS_OF_S_UNPROVABLE`**，**不静默换用较新数据**、不把当前页完整冒充全部匹配完整。
- `mode=diagnostic` 时返回显式 `diagnostic_incomplete`：含 `reason=as_of_s_unprovable`、`actualBound`（实际证据界）与 `missingSets`（缺失集合），并随 `asOfProof` 一并披露四个维度的判定与原因码。
- 证明的范围口径与视图**一致**：证明用的就是视图读到的同一批行，不引入第二种筛选。
- **完成边界**：历史库中「基线之前存在未登记的归属就地改写」无法被证明（`S < 基线` 即判定为不可证明）；台账 D-28 保持 `open`。V06／V09／V10 仍全部未执行。

---

## 4. 只读页面与交互

### 4.1 问询详情

- 从访问日志当前行进入详情，保留原筛选、时间窗、滚动位置和返回上下文。
- 首屏依次显示问询身份与归属、主状态、预算状态、耗时、完整表清单、调用／尝试与证据缺口；长 ID 可短显但完整复制可达。
- 完整表清单不使用「等 N 个」作为终点；默认展示全部或提供明确完整展开，数量与去重集合一致。
- 「问询预算已用尽」只在 `primaryStatus=budget_stopped` 且有预算终止凭据时显示；可继续结果另行说明。
- 已确认／候选／未归属、客户端后续不可见、未知耗时和缺表身份均用文本说明，不只依赖颜色。

### 4.2 使用概况

- Token 卡片并列显示配置数与窗口内活跃数，并提供差异明细入口；不再只显示「活跃 Token 数超过配置数，数据异常」。
- 差异明细至少分为已配置未活跃、活跃但当前配置不可见、已停用／删除、身份未核验；无差异时仍披露统计窗口与快照。
- 表排行保留现有布局，可展开完整表身份；排行、问询详情与调用流水可互相定位，但不提供写操作。
- 数据加载失败、快照不完整、S 未追平、精确 as-of S 能力未证明或规则版本不一致时，正式完整读取与导出阻断；诊断模式必须显式标记不完整及缺失范围，不保留旧数字冒充当前结果。

### 4.3 CSV 与 API

- 页面下载复用当前 `reconciliationContext`；CSV 与当前 UI 使用同一服务端响应或同一版本化派生函数，不在浏览器重算。
- CSV 至少分问询摘要、完整表清单、调用／尝试、Token 对账与差异集合；每文件携带上下文或由同一 Manifest 关联。
- CSV 保留 null 与空值原因，防公式注入，不导出超授权原文、凭据值或秘密。Token 仅使用持久 ID 或受保护摘要。
- API 只读、要求现有管理员审计权限与 meta-audit；分页使用游标并声明是否完整，不把当前页完整冒充全部匹配完整。

> 实施回写见 §3.5（2026-10-25，N27）：meta-audit 的 `event_id` 此前由 `request.id` 派生，而它是**每进程计数器**、重启后会复用 → 撞 `event_id` 唯一约束 → 一次合法读取被误拒为 `503 RECONCILIATION_READ_REFUSED`（本轮 P0-4 引入）。改为每次读取用随机 UUID 派生唯一 id，`request.id` 降级为 `trace_id` 保留可追溯性；**拒绝语义未放宽**（actor 不可解析 401／账本不可用 503／meta-audit 写入失败 503）。

拟议逻辑接口如下，实施时可按仓库 API 风格复用现有端点，但不得改变口径：

| 接口 | 合同 |
|---|---|
| `GET /api/admin/audit/reconciliation/inquiries/:turnId` | 返回问询详情与统一上下文；候选 turn 必须显式标识 |
| `GET /api/admin/audit/reconciliation/usage` | 返回 Token 对账、完整表排行、差异集合与统一上下文 |
| `GET /api/admin/audit/reconciliation/export` | 按当前筛选与 S 生成对应 CSV／Manifest；继承审计导出完整性与失败规则 |

---

## 5. 核心流程（伪代码）

```text
onOpenReconciliation(actor, filter, mode):
  requireAdminAuditPermissionAndMetaAudit(actor)
  S = canonicalLedger.committedWatermark()
  waitUntilProjectionCovers(S, deadline=60s)
    else return blocked_or_explicit_diagnostic
  snapshot = freezeConsistentProjectionSnapshotCovering(S)
  asOfProof = P01.proveExactAsOfS(snapshot, S, filter,
                                  baseFacts=true, revisions=true,
                                  relations=true, aggregates=true)
  if !asOfProof.ok:
    if mode == formal_complete: return failClosed(AS_OF_S_UNPROVABLE)
    else return explicitDiagnosticIncomplete(asOfProof.actualBound,
                                             asOfProof.missingSets)
  context = freezeContext(filter, timeRange, S, snapshot.id, ruleVersions,
                          asOfProof)
  return context

loadInquiry(context, turnId):
  requireSameContextAndPermission(context)
  events = selectDeclaredEvents(snapshot, context, turnId)
  association = preserveOriginalAndEffectiveAssociation(events)
  units = deriveIndependentUnits(events)       # 调用、尝试、协议、问询不混算
  statuses = derivePrimaryStatusWithSharedFunction(units, context)
  tables = resolveFullSourceIdentitiesWithEvidence(events)
  budget = readExistingBudgetFacts(events, context.budgetRuleVersion)
  durations = deriveOnlyKnownDurations(events)
  return detailWithUnknownsAndDifferences(association, units, statuses,
                                          tables, budget, durations, context)

reconcileTokens(context):
  configured = readConfigurationIdentitySnapshot(context)
  calls = selectIndependentToolCalls(snapshot, context)
  active = distinctVerifiedPersistentTokenIds(calls)
  unknown = callsWithoutVerifiablePersistentIdentity(calls)
  differences = classifyConfiguredActiveAndHistoricalDifferences(configured, active, unknown)
  return countsWithSetsAndReasons(configured, active, unknown, differences, context)

exportCurrentView(context):
  requireSameContextAndPermission(context)
  rows = renderFromSameServerDerivation(context)  # 不在浏览器另算
  assert statusBucketsClosedAndCrossFileRelationsMatch(rows)
  persistRequiredExportAudit()
  return csvFilesAndManifest(context, exclusions, relationKeys)
```

---

## 6. 失败、兼容与隐私

- 旧数据缺新字段时显示 unknown／legacy_unverified，不批量改写旧 `outcome`、归属、Token 身份或表名。
- 查询、快照、投影、精确 as-of S 证明或导出失败时保留可诊断错误；正式完整模式失败不得自动降级为完整成功。P0-1 能力未完成时，P0-4 正式完整读取与导出同样阻断，只允许显式诊断性不完整结果。
- 无客户端证据时显示「后续动作不可见」，不显示「未外发」；ACK 缺失不改变已证明的执行成功。
- 页面与导出沿用现有管理员可见性、脱敏、保留和 meta-audit 规则；完整表名仍受审计详情权限保护。
- 本 Spec 不延长问询原文、会话或所有日志保留期，不改变客户冻结 profile。

---

## 7. 验收矩阵

**V01–V12 全部未执行。** 以下仅为后续实施验收设计；文档审查通过、静态检查或历史样本回放均不等于运行时通过。需要交付环境的项目依赖 Wave 0b，未解锁保持 `blocked_delivery`。

| 编号 | 场景 | 必须断言 | 状态 |
|---|---|---|---|
| V01 | 一笔问询涉及 13 张以上表且含长名称 | 详情可见全部完整表身份，数量与去重集合一致，无「等 N 个」信息断点 | 未执行 |
| V02 | 同名表位于两个连接／Schema | 不合并；详情、排行、API、CSV 均保留完整身份 | 未执行 |
| V03 | 调用无表身份或只有不可核验 SQL 文本 | 显示未知与原因，不猜表、不填空数组冒充无访问 | 未执行 |
| V04 | 真实预算终止、普通超时、权限拒绝、部分可继续结果 | 只有预算终止显示已用尽；其余主状态与预算语义正确 | 未执行 |
| V05 | 并发调用、缺起止、多次重试 | 历时、累计耗时、调用数与尝试数分别正确；未知不填 0 | 未执行 |
| V06 | 已确认、候选、冲突、仅握手混合集合 | 分母与计数分别正确，候选不升级，握手不进业务问询分母 | 未执行 |
| V07 | 配置 5 个 Token，窗口内 3 个活跃 | 两数及已配置未活跃集合与 Token 页、调用流水一致 | 未执行 |
| V08 | 活跃数大于当前配置数，含停用／删除和未知历史身份 | 按差异原因解释，不统一报数据异常，不强行配平 | 未执行 |
| V09 | API／UI／CSV 同筛选与 S | 八桶互斥且合计闭合，表清单、Token 集合、规则版本与差异 ID 一致；精确 as-of 未证明时正式完整读取与导出阻断，诊断结果显式不完整 | 未执行 |
| V10 | 新事件在导出期间到达、投影未追平、分页及 S 后事实修订 | 当前上下文不混入 >S；捕获 S 后改变基础执行／交付事实、覆盖归属有效值或迟到 ACK，同 S 重读仍不漂移；未追平或 as-of 未证明时正式模式失败；分页不丢重 | 未执行 |
| V11 | 无权限、撤权、敏感表名、Token 与 CSV 注入 | 拒绝或脱敏符合既有策略；meta-audit 完整；无凭据值泄露 | 未执行 |
| V12 | 候选 linux/amd64 单副本 K8s 证据 | 同一候选镜像完成只读问询与 Token 对账旅程，证据包可复查；缺环境不记 passed | 未执行 |

完成 P0-4 至少需要 V01–V11 的适用真实证据及 V12 的交付证据；不得只凭静态页面截图或手工填数声称完成对账。

---

## 8. 追踪与审查边界

| 上游要求 | 本 Spec 落点 | 验收 |
|---|---|---|
| L25-02 完整表清单、轮次、耗时、预算状态 | §2、§3.2、§4.1、§5 | V01、V03–V06 |
| L25-03 配置／活跃 Token 与差异、完整表名 | §3.3–§3.4、§4.2 | V02、V07–V09 |
| Final 决议统一 S05、无新预算／配额／金额 | §1.2、§2、§3.1 | V04、V09–V10 |
| 审计 unknown／不可观测不填 0 或 100% | §2、§3、§6 | V03、V05–V10 |
| Wave 0b 未解锁不得交付通过 | §7 | V12 |

需求审查只确认范围、术语、数据合同与验收设计。审查签核不授权开发；后续实施 Plan、代码、测试、浏览器验证、构建与发布均需另行批准。

---

### 3.6 实施回写（2026-10-28，本轮：读取侧列名修复 + 只读页面接入）

2026-10-28 委托人拍板 D2（路径 A）与 D4（台账范围）后落地。本节**不改 §1–§5 的冻结正文**。

**3.6.1 读取侧列名漂移（D-32）—— §3.1／§3.3 的读取实现此前读的是不存在的列**

- 现象：`webui/server/admin/reconciliation.ts` 的 `ACCESS_LOG_SELECT_COLUMNS` 读
  `authorization_view` / `execution_view`，而 `access_log` 里**这两列从不存在**（写库写的是
  `authorization_status` / `execution_status`）。因 `probeColumns` 兜底把缺列投影成
  `NULL AS 列名`，**不报错**，而是静默让授权/执行视图恒为 `unknown`。
- 实证：真实 SQLite 库（`LUCY_AUDIT_DB` 指向临时库）验证 `authorization_view` /
  `execution_view` 两列 `exists: false`，`authorization_status` / `execution_status`
  两列 `exists: true`。`reconciliation-csv.ts` 早已使用正确列名。
- 处置：**改读侧**（`reconciliation.ts` + `reconciliation-ports.ts` 改读既有列），
  **不新增** `*_view` 列 —— `access_log` 已有同义列，新增会制造第二套竞争性事实源。
  缺列兜底保留（老库可能没有该列）：缺列时仍落 `unknown` 并附原因，**不得**当 0 / false。

**3.6.2 只读页面接入（§4.1／§4.2／§4.3）—— 此前三个端点前端零消费**

- 新增 `/admin/audit-reconciliation`（P0-4 使用概况页；不在侧栏导航，只在 URL 可达），
  消费 `GET /api/admin/audit/reconciliation/usage`（Token 对账 + 完整使用明细）、
  `GET /api/admin/audit/reconciliation/inquiries/:turnId`（单问询对账详情）与
  `GET /api/admin/audit/reconciliation/export`（对账证据包 CSV + 对账清单）。
- 展示口径：规模为 null 一律显示「不可观测 + 原因」，**不显示 0**；比率同时给出 N／D，
  分母为 0 或不可观测时不显示 0% / 100%；as-of S 不可证明时显式披露为**诊断视图**，
  不静默当完整结论；「活跃数 > 配置数」**不自动等于数据异常**。
- 治理页（`/admin/usage`）的 Token 卡片改为**配置数 · 活跃数并列**，并给出四类差异集合
  的明细入口；旧文案「活跃 Token 数超过配置数，数据异常」改为「口径未同时一致，不自动
  等于数据异常」。

**3.6.3 V01–V12 的验收状态（**未执行**）**

- V01–V12 的运行时验收**仍未执行**。本轮落地的是读取侧的正确性、页面对三个只读端点的
  消费，以及让 passed 结果**能被 `verify-evidence.mjs` 采信**的证据链（AUD25/ARV25 并入
  冻结 catalog）；三者都不等于场景已被验证。定向用例全绿不是验收。
- **Stage 1（开发单机）未取得真实 passed 证据**：ARV25-V01..V12 的 spec 此前只声明
  `coversV025`（v0.25 命名空间），冻结 collector 看不到这些 variant，它们在
  `evidence.cases` 里根本不会出现；本轮已补 `covers()` 声明，但**声明**不等于**真实通过**。
- **Stage 2（客户 amd64 K8s）未执行**，阻塞原因 G-01 / G-06。
- 台账 D-32 按 §18.11 同款纪律登记为 `open`、`fixedIn` 不填（实现提交 SHA 与回归用例
  记在 note 中）；待 Stage 1 取得真实 passed 用例后再置 fixed 并回填。

## Terminology Compliance

遵循 [产品术语标准](../../webui/docs/00-product-terminology-standard.md) §4.7 及 §4.7.2。沿用「问询」「工具调用数」「关联调用数」「汇总主状态」「空值原因」「业务问询分母」「证据版本链」「送达状态」「尝试」「问询预算」「可继续」。

新增展示措辞仅包括「配置 Token 数」「窗口内活跃 Token 数」「已配置未活跃」「活跃但当前配置不可见」「身份未核验」「完整表清单」。Token 指 API 访问凭证，不得写成模型 token 用量；「完整表清单」不等于证明物理表访问覆盖完整，证据缺口仍须展示。

`turnId`、`attemptId`、`eventId`、`client_call_id`、`primaryStatus`、`watermarkSeq`、`classificationVersion`、`derivationVersion`、连接／Schema／表完整身份、URL 与文件名的 DOM 节点使用 `translate="no"` 和 `notranslate`。

## Design System Compliance

遵循 [页面布局模式](../../webui/docs/design-system/20-patterns-page-layout.md)、[数据网格规范](../../webui/docs/design-system/11-components-data-grid.md)、[指标卡规范](../../webui/docs/design-system/12-components-metric-card.md) 与 [色彩基础](../../webui/docs/design-system/01-foundations-color.md)。复用 PageHeader、筛选、主网格与详情区域；指标卡提供口径说明，长身份可复制，键盘与焦点可达，状态同时提供文本。普通成功色不得覆盖 unknown、冲突、候选或证据缺口。本轮不执行浏览器或移动窄屏验证。
