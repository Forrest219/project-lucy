# Lucy 访问权限升级设计（Access Control Upgrade）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 访问权限升级设计 |
| 文档类型 | Design |
| 版本 | v1.1.2（微调，承接 v1.1.1 审阅意见） |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | v1.1.1 及其审阅意见（1 项 P0 回归风险 + 3 项缺口 + 文档层面问题）；v1.1 Major Revision 审批；`webui/server/proxy/{acl,mcp-proxy,identity}.ts`；`webui/server/index.ts`；`webui/config/access.yaml` |
| 适用范围 | 访问权限独立升级域的**审核基线**。批准后 **AC-P0 可写 Spec**；实施 WO 仍须在 Spec 评审通过后另批；AC-P1 继续冻结 |
| 输出位置 | `docs/access-control/design-upgrade.md` |
| 审核状态 | **待批准**（v1.1.1 为「有条件批准」；本版落实全部条件）；域档案见 `docs/access-control/README.md` |

### 版本沿革（本文为原地演进，历史版本不另存文件）

| 版本 | 关键内容 | 审批结果 |
|---|---|---|
| v1.0 | 独立成域；多 Role；Row Policy 初稿 | 不批准，Major Revision |
| v1.1 | 六项 ADR；OR 行授予；唯一闸门；canonical key | 不整体批准（3 项 P0） |
| v1.1.1 | capability tuple；`permission_model_version`；收窄失败语义 | **有条件批准**（1 项 P0 回归 + 3 项缺口） |
| **v1.1.2（本版）** | 全量工具分类表；编译输入含 source map；`prefix` 立场；版本缺省统一；connections 归属；反向映射 | 待批准 |

### 相对 v1.1.1 的修订

| 审阅意见 | v1.1.2 处置 |
|---|---|
| [P0] 工具分类闭集，Meta 兜底弱于今天 | **ADR-AC-02 §2**：全量工具分类表（覆盖 `known_tools` 每一项）+ **未分类默认 AbsoluteDeny** |
| [P0] `prefix` 选择器 + source map TTL 构成第二事实源 | **ADR-AC-06 §A0**：`policyVersion` 绑定 access.yaml digest 与 source map version；source map 变化触发重编译；**v2 Role 禁用 `prefix`** |
| [P1-1] 缺 `permission_model_version` 三处矛盾 | **ADR-AC-04**：统一为「一次性迁移标 1，之后缺字段编译失败」 |
| [P1-2] `connections` 在 capability 模型中无归属 | **ADR-AC-03 §4**：connections 由 capability 派生 + 保留纯 Meta Role 的显式声明 |
| [P1-3] 反向 source map 未纳入 | **ADR-AC-01 §5**：`physicalTable → source` 反向映射同样禁止全局裸键 |
| 悬空引用「与 v1.1 相同」 | 已内联，本文自足 |
| 编号冲突 / 未定义用例编号 | 已修正 |
| `capability_forbidden` 未登记契约 | **§9 契约变更清单** |
| 缺单 Role 等价不变量测试 | **U-COMPAT-01** |
| 「整体 deny」缺告警与恢复路径 | **ADR-AC-06 §E** |

---

## Terminology Compliance

本设计遵循 `webui/docs/00-product-terminology-standard.md`。以下术语须在 AC-P0 Spec 前登记。

| 英文 | 中文主术语 | 含义 | 禁止混淆 |
|---|---|---|---|
| Access Control Upgrade | 访问权限升级 | 本升级域总称 | Dynamic RLS |
| Data Capability | 数据能力元组 | `(tool, canonicalSourceKey, rowGrant)` | tools 并集、sources 并集 |
| Effective Data Capabilities | 有效数据能力集 | 多 Role capability 的并集 | `(∪tools)×(∪sources)` |
| Row Grant | 行授予 | 某 capability 上的行集合（AC-P0 恒为 TRUE） | Agent Constraints |
| Agent Constraints | Agent 强制约束 | 人级收紧，AND 到 FinalRows | Role 间 AND |
| Permission Model Version | 权限模型版本 | Role 上的 `permission_model_version: 1\|2` | 用户字段 `role`/`roles`、修改历史推断 |
| Row Policy | 行级策略 | 仅 `access.yaml` 内 structured 谓词 | Segment、查询 filters |
| Canonical Source Key | 规范源键 | `(connectionId, schema, sourceName, physicalTable)` | 裸 sourceName、裸 physicalTable |
| Tool Class | 工具分级 | `AbsoluteDeny` / `DataPlane` / `Meta` | `known_tools`、`table_touching_tools`（现网字段名） |
| Effective Policy | 有效策略包 | 编译后的不可变对象，含 `policyVersion` | 热路径临时拼装 |
| Policy Compilation Input | 策略编译输入 | `access.yaml` + source map（两者共同决定 `policyVersion`） | 仅 access.yaml |

---

## 0. 结论摘要（TL;DR）

1. **一人一 Agent、一 MCP**；多 Token 只鉴权，不改变权限。
2. **数据权限是 capability 并集**，不是 tools 与 sources 独立并集：
   `EffectiveDataCapabilities = ∪_roles (role.DataPlaneTools × role.sources × rowGrant)`。
3. **工具三分级且默认拒绝**：`AbsoluteDeny` / `DataPlane`（须绑 source capability） / `Meta`（无 source 绑定）；**未分类工具一律 AbsoluteDeny**。
4. **Role 带 `permission_model_version`**：v1 legacy 可读；v2 必须显式 `row_access`，且 **v2 禁用 `prefix` 选择器**。AC-P0 仅支持 `all`。
5. **策略编译输入 = `access.yaml` + source map**，二者共同决定 `policyVersion`；语义层变化必须触发重编译。
6. **Admin 收窄**：先编译候选 → 成功才原子写盘并切换 runtime；失败回滚且保存失败。外部手改 YAML 非法时不得沿用更宽旧权。
7. **AC-P1 冻结**；本版批准仅授权撰写 AC-P0 Spec。

| 波次 | 本版态度 |
|---|---|
| AC-P0 Spec | 批准本文后可写 |
| AC-P0 实施 WO | **另批**（Spec 评审通过后） |
| AC-P1 | **冻结**（须上游强制谓词契约另批） |

附录 [`feasibility-row-acl.SUPERSEDED.md`](feasibility-row-acl.SUPERSEDED.md) 已标 **SUPERSEDED**；冲突一律以本文为准。域索引：[`README.md`](README.md)。

---

## 1. 升级定位

### 1.1 为何单独成域

| 原因 | 说明 |
|---|---|
| 安全边界 | 权限错误是数据泄漏，不是 UX 缺陷 |
| 横切面 | Proxy、Admin、审计、Wiki ACL、Catalog、Eval、发布证据 |
| 与 202608 解耦 | 202608 明确不做 Dynamic RLS；本升级交付**配置期 Static** 能力 |
| 组织语义 | Role = 可组合职责授权包；Agent = 真人 |

### 1.2 升级目标

| ID | 目标 | 可验证 |
|---|---|---|
| G1 | 一人一 Agent / 多 Token 同权 | S1 |
| G2 | 多 Role；Effective Policy 可预览可审计 | preview + snapshot |
| G3 | 跨域可见 = capability 并集，无笛卡尔放大 | S2 / U-CAP-* |
| G4 | 行授予 OR（AC-P1）；人级收紧走 Agent Constraints | S4（P1/P1.5） |
| G5 | `permission_model_version` 静态可判；v2 显式 `row_access` 且禁 `prefix` | S3 / lint |
| G6 | 工具三分级；未分类默认拒绝；唯一数据闸门 | S5 / U-CLS-* |
| G7 | Canonical key（含反向映射）；同 connection 内 sourceName 唯一 | S8 |
| G8 | 收窄 / 禁用 / 撤销失败时不得保留更宽旧权 | S10 |
| G9 | 语义层变化不得静默改变授权（显式 `catalog_bound` 扩权须审计，见 ADR-AC-07；≠ 静默 prefix） | S12 |
| G10 | 单 Role Agent 行为与升级前等价 | U-COMPAT-01 |

### 1.3 非目标

- Dynamic 多租户 / 请求头 claim / JWT ABAC（AC-P2+）
- 完整列级权限 / 动态掩码（另立 CLS 升级）
- WebUI Admin SSO / 多管理员 RBAC
- 结果集后过滤作为安全方案
- Token 级**加权**权限（未来 scope 只允许收窄）
- 绕过 Proxy 的 KTX 直连 ACL
- 用 Semantic Segment / overlay 表达式充当权限事实源

### 1.4 设计原则

1. **事实源单一**：权限谓词只来自 `access.yaml`；source map 只提供**授权对象的身份解析**，不得成为「授权范围自动扩张」的入口（故 v2 禁 `prefix`，见 ADR-AC-06 §A0）。**例外（显式特权）**：Role 声明 `source_scope: catalog_bound` 时，授权意图仍写在 `access.yaml`；source map ∩ `enabled_tables` 仅解析对象集合，扩权必须 `policy_scope_expanded`（ADR-AC-07）。
2. **Fail-closed**：解析 / 合成 / 编译失败，或工具未分类，一律拒绝；「意图收窄」路径上不得继续提供更宽授权。
3. **dryRun → save**；裁决只在 Proxy；Admin 与 runtime 共用同一解析器。
4. **Role 可组合** = capability 并集，不是维度笛卡尔积。
5. **世代显式**：靠 `permission_model_version`，不靠「是否修改过」推断。
6. **不弱于现状**：任何 AC-P0 改动不得让某工具在某源上从「今天受检」变成「不受检」。

---

## 2. Permission Synthesis ADR

> 本节为 AC-P0 / AC-P1 共用硬约束。未批准不得实施多 Role 或 Row Policy。

### ADR-AC-01 — Canonical Source Key

**决策：**

```text
canonicalSourceKey = connectionId | schema | sourceName | physicalTable
```

1. 解析 / 合成 / 注入 / 审计 / Admin preview **禁止**以裸 `sourceName` 作唯一身份。
2. 正向 source map 的键必须至少为 `(connectionId, sourceName)`。
   - 现状缺陷：`acl.ts` 的 `loadSourceMap` 以**全局裸 `sourceName`** 为键，跨 connection 与跨 schema 同名都会静默覆盖。**AC-P0 必须修复**。
3. **同一 `connectionId` 内 `sourceName` 必须唯一**（跨 schema 亦不可撞名）；编译时冲突 → **编译失败**。
   - 理由：工具参数当前只携带 `connectionId + sourceName`，不含 schema；不约束唯一性则运行时仍有歧义。
4. AC-P0 **不改**工具参数结构。若未来要允许同 connection 重名，必须先扩展工具参数携带 schema——另批。
5. **反向映射同样受约束**：`buildReverseSourceMap` 现以全局 `physicalTable` 为键，两个 connection 存在同名物理表时会造成审计归属错误。AC-P0 必须将反向映射键改为 `(connectionId, physicalTable)`，并同步 `access_log_sources` 的写入口径。
6. 测试必含：
   - 同 connection、不同 schema、同 sourceName → **编译失败**；
   - 不同 connection、同 sourceName → 两键并存，策略不串；
   - 不同 connection、同 physicalTable → 审计归属正确。

### ADR-AC-02 — 工具分级与唯一数据闸门

#### 1. 三个分级

| 分级 | 定义 | 授权方式 |
|---|---|---|
| **AbsoluteDeny** | 任何 Agent 不可调用 | 代码基线硬编码；Role allow 与 YAML 均无法解除 |
| **DataPlane** | 可返回或推断具体源数据 / 源结构的工具 | 必须持有 `(tool, canonicalSourceKey)` capability |
| **Meta** | 不绑定单一源的元信息工具 | 仅需工具授权；**不得**由此获得任何源数据 |

#### 2. 全量分类表（覆盖现网 `defaults.known_tools`）

| 工具 | 现网形态 | 今天是否受表检查 | **本设计分级** | 说明 |
|---|---|---|---|---|
| `sl_query` | 上游，原样转发 | 是 | **AbsoluteDeny** | 未经闸门的原生查询面 |
| `sl_read_source` | 上游，原样转发 | 是 | **AbsoluteDeny** | 同上 |
| `sql_execution` | 上游 | — | **AbsoluteDeny** | 现网已 deny |
| `sql_dialect_notes` | 上游 | — | **AbsoluteDeny** | 现网已 deny |
| `memory_ingest` | 上游 | — | **AbsoluteDeny** | 现网已 deny |
| `memory_ingest_status` | 上游 | — | **AbsoluteDeny** | 现网已 deny |
| `lucy_query` | 本地校验后改写为 `sl_query` 转发 | 是 | **DataPlane** | 主查询面 |
| `lucy_read_source` | 本地校验后改写为 `sl_read_source` 转发 | 是 | **DataPlane** | 整源读取 |
| `lucy_explain_query` | Proxy 本地生成，不执行 | 是 | **DataPlane** | 不返回行，但泄漏源结构与可达性，必须绑 capability |
| `lucy_freshness` | Proxy 本地应答，入参含 `sourceName` | 是 | **DataPlane** | 今天即受表检查，不得降级为 Meta |
| `entity_details` | **上游，原样转发** | 是 | **DataPlane（未包装）** | 见 §3 |
| `sl_validate` | **上游，原样转发** | 是 | **DataPlane（未包装）** | 见 §3 |
| `dictionary_search` | 上游 | 否，但受 `sensitive_table_prefixes` 约束 | **Meta（敏感）** | 见 §4 |
| `discover_data` | 上游 | 否，但受 `sensitive_table_prefixes` 约束 | **Meta（敏感）** | 见 §4 |
| `lucy_catalog` | Proxy 本地应答 | 否 | **Meta** | 输出必须按 capability 过滤，见 ADR-AC-03 §5 |
| `kx_catalog` | Proxy 本地应答 | 否 | **Meta** | 同上 |
| `connection_list` | Proxy 本地应答 | 否 | **Meta** | 同上 |
| `wiki_search` | Proxy 本地应答 | 否 | **Meta** | 受 wiki ACL |
| `wiki_read` | Proxy 本地应答 | 否 | **Meta** | 受 wiki ACL |
| `lucy_begin_question` | Proxy 本地应答 | 否 | **Meta** | 审计埋点 |

#### 3. 未包装 DataPlane 工具（`entity_details` / `sl_validate`）

这两个工具今天受表检查，但**不经 Lucy wrapper 改写**，因此无法承载强制谓词。

| 波次 | 规则 |
|---|---|
| **AC-P0** | 保留为 DataPlane，按 `(tool, sourceKey)` 校验。**行为与今天等价，不构成回归** |
| **AC-P1** | 对任何 `FinalRows ≠ TRUE` 的源 **deny**（`row_policy_requires_wrapped_tool`）；或先提供 `lucy_*` 包装再放行——二选一由 AC-P1 Spec 决定 |

#### 4. 敏感 Meta 工具

`dictionary_search` / `discover_data` 保留现网 `sensitive_table_prefixes` 规则不变：仅当 Agent 对该前缀下**全部**源具备 DataPlane capability 时才可调用。AC-P0 只做「从表白名单口径平移到 capability 口径」，不放宽、不收紧。

#### 5. 缺省规则（fail-closed，本条为 P0 修订核心）

> **任何未出现在上述分类表中的工具——包括上游新增工具、别名、实验性工具——一律按 `AbsoluteDeny` 处理，直到显式分类并经权限评审。**

编译期检查：若 `defaults.known_tools` 或上游 `tools/list` 出现未分类工具名，**编译告警并按 AbsoluteDeny 生效**；Role 若显式 allow 未分类工具则 lint fail。

#### 6. 闸门

1. 全部 DataPlane 调用必须经统一函数 `authorizeAndRewrite(identity, tool, args)`；**仅此函数**可产生发往 KTX 的上游数据调用。
2. `tools/list` 过滤与 `tools/call` 拒绝**双重生效**；不得仅靠 list 隐藏。
3. `tools/list` 中 DataPlane 工具的可见性由 capability 推导：该工具至少存在一条 capability 才可见；capability 为空则隐藏且调用拒绝。

### ADR-AC-03 — Capability Tuple 合成

**决策：Effective Policy 的数据面是 capability 集合，不是两个独立并集。**

#### 1. 代数

```text
RoleCapabilities(r) =
  { (tool, sourceKey, rowGrant(r, sourceKey))
    | tool ∈ (r.allow.tools ∩ DataPlaneTools) \ AbsoluteDenyTools
    , sourceKey ∈ SourcesGrantedBy(r) }

RoleMetaTools(r) = (r.allow.tools ∩ MetaTools) \ AbsoluteDenyTools

EffectiveDataCapabilities(agent) = ∪_{r ∈ RoleSet} RoleCapabilities(r)
EffectiveMetaTools(agent)        = ∪_{r ∈ RoleSet} RoleMetaTools(r)

# 行授予（AC-P1 才有非 TRUE 值；AC-P0 恒为 TRUE）
rowGrant(r, sourceKey) =
  permission_model_version = 1        → TRUE
  row_access = all                    → TRUE
  row_access = scoped                 → row_policy      # 仅 AC-P1 合法

EffectiveRowGrant(sourceKey) = OR({ rowGrant | ∃tool: (tool, sourceKey, rowGrant) ∈ EffectiveDataCapabilities })
FinalRows(sourceKey)         = EffectiveRowGrant(sourceKey)
                               AND AgentConstraints(sourceKey)   # 无则 TRUE
                               AND TokenScope(sourceKey)         # 无则 TRUE
```

#### 2. 闸门硬检查

```text
对调用工具 tool 与 args 解析出的每个 canonicalSourceKey:
  要求 ∃ rowGrant: (tool, sourceKey, rowGrant) ∈ EffectiveDataCapabilities
  否则 deny，理由码 capability_forbidden:<tool>:<sourceKey>
跨 Role join：允许，当且仅当每个 source 各自具备该 tool 的 capability
```

#### 3. 禁止的错误代数

| Role A | Role B | 错误并集（v1.1 语义，本版禁止） | 正确 capability |
|---|---|---|---|
| `lucy_query` × 财务源 | `lucy_read_source` × 公共源 | 误授 `lucy_read_source` × 财务源 | 不存在该元组 |

#### 4. `connections` 的归属（本版新增）

| 情形 | 规则 |
|---|---|
| Role 含 tableSelectors | 有效连接集 **由 capability 派生**：`{ sourceKey.connectionId }`。`allow.connections` 退化为**声明与校验**用途：若声明的连接未出现在派生集合中 → 编译告警；若 capability 出现未声明连接 → **编译失败** |
| 纯 Meta Role（无 tableSelectors） | 保留 `allow.connections` 显式声明；仅用于 `connection_list` 等 Meta 输出 |
| 请求携带未授权 `connectionId` | 维持现网 `unknown_or_forbidden_connection` 裁决，先于 capability 检查 |

#### 5. Meta 工具的输出过滤

`lucy_catalog` / `kx_catalog` / `connection_list` 的可见范围 = **capability 中出现过的源与连接的并集**（跨全部 DataPlane 工具）。不得展示无任何 capability 的源。

#### 6. 同 Role 多 selector 命中同一 source

- 两次解析的 **rowGrant digest 完全相同** → 合并为一条；
- 否则 → **Role 编译失败**（整 Agent fail-closed）；
- 「每 source 至多一个 RoleGrant」由此强制，不留实现自由裁量。

#### 7. 产品含义（AC-P1）

两个 Role 均授同一 `(lucy_query, cost)`，rowGrant 分别为 `dept∈ABC` 与 `TRUE` → OR 后为 `TRUE`。若业务要求「此人看 cost 永不超过 ABC」，必须用 **Agent Constraints**，不得用 Role 间隐式 AND。

**Active Role：** 默认关闭；如需按请求激活单一职责，另批。

### ADR-AC-04 — `permission_model_version` 与显式 Row Access

**决策：世代挂在 Role 上、静态可读；禁止用「是否修改过」或 Agent 的 `role`/`roles` 字段推断。**

```yaml
roles:
  finance_bp:
    permission_model_version: 2   # 1 = legacy；2 = 显式模型
    allow: ...
```

| 版本 | Selector 规则 | AC-P0 行为 | AC-P1 行为 |
|---|---|---|---|
| **1**（legacy） | 可无 `row_access`；缺省视为 all；允许 `prefix` | rowGrant = TRUE | 同左；鼓励迁移 |
| **2** | 每个 tableSelector **必须**显式 `row_access: all \| scoped`；**禁用 `prefix`，只允许 `names`** | 仅允许 `all`；出现 `scoped` → 配置拒绝 / 编译失败 | 允许 `scoped` + `row_policy` |

#### 缺 `permission_model_version` 的唯一口径（本版统一，取代 v1.1.1 的三处矛盾表述）

```text
一次性迁移（随 AC-P0 发布执行一次）：
  为所有存量 Role 写入 permission_model_version: 1
迁移之后（稳态）：
  Role 缺少 permission_model_version → 编译失败（不再自动推断）
  Admin 新建 Role → 强制写入 2
```

lint 在迁移窗口内对缺字段报 warn，迁移完成后升为 fail。

#### Admin 编辑 legacy Role 的自动迁移

1. `permission_model_version` 升为 `2`；
2. 每个 selector 补显式 `row_access: all`；
3. 若该 selector 使用 `prefix`，**必须先展开为 `names` 明细**（dryRun 展示展开后的完整源清单）；无法展开则保存失败；
4. dryRun 展示迁移 diff，用户确认后落盘。

#### 敏感源 `row_policy_required`

原则保留，**AC-P1** 落地（AC-P0 无 `scoped`，无强制对象）。

### ADR-AC-05 — Row Policy（AC-P1 前置约束）

1. Row Policy **仅**允许 structured 谓词，且只存在于 `access.yaml`。
2. **禁止**将 overlay Segment 用作安全谓词；Segment 仍可作查询便利，但永不自动注入为权限。
3. **AC-P1 初版 op 仅 `eq` | `in`**。`ne` 与范围比较（`gt`/`gte`/`lt`/`lte`）会因新增数据自动扩大可见集，不进入初版，另批评估。
4. **上游强制谓词契约为 AC-P1 开工门禁**：Proxy 须将 `FinalRows` 编译为受控 AST 或上游专用强制字段，语义为与查询条件组合后不可被 OR、括号、别名、自连接、LEFT JOIN、聚合、HAVING 放宽；受保护源上拒绝自由字符串 `filters`、未审计 ad-hoc `measures[].expr`、子查询。
5. 契约未证明前：对 `FinalRows ≠ TRUE` 的源 **deny**（`row_policy_upstream_unproven`），不得先注入字符串碰运气。

### ADR-AC-06 — 策略编译、提交与失败语义

**核心：last-known-good 不得用于未确认的收窄 / 禁用 / 撤销。**

#### A0. 编译输入与版本绑定（本版新增，闭合第二事实源问题）

```text
PolicyCompilationInput = {
  accessConfigDigest : sha256(access.yaml 规范化内容)
  sourceMapVersion   : 现有 acl.ts sourceMapVersion
}
policyVersion = sha256(accessConfigDigest || sourceMapVersion || toolClassificationVersion)
```

规则：

1. **source map 变化必须触发重编译**，走与 `access.yaml` 变化完全相同的提交与失败语义；不得依赖 60 秒 TTL 静默生效。
2. **v2 Role 禁用 `prefix` 选择器**（ADR-AC-04）。理由：`prefix` 使「语义层新增一张表」等价于「授权自动扩大」，且不经 dryRun、审批与 `runtimeAck`，与 §1.4.1 事实源单一直接冲突。legacy v1 Role 允许保留 `prefix`，但 source map 变化导致其授权集合扩大时，**必须**在 Admin 可观测面产生一条显式记录（`policy_scope_expanded`），不得静默。
3. 编译必须**钉住**一份 source map 快照；同一 `policyVersion` 内的所有请求使用同一份解析结果。
4. `policyVersion` 与 capability digest 一并写入 `permission_snapshots` 与 `access_log`。

#### A. Admin 写入路径（唯一推荐变更路径）

WebUI 与 MCP Proxy 运行在**同一进程**（`webui/server/index.ts` 先启动 Fastify，再 `buildProxy().listen`），因此下述「写盘 + 切换 runtime」可在进程内完成，无需跨进程两阶段提交。

```text
dryRun → 用户确认 → save:
  1. 在内存编译候选 EffectivePolicy（全量或受影响闭包）
  2. 编译失败 → 不写盘、不切 runtime，返回保存失败（含失败原因与受影响 Role/Agent）
  3. 编译成功 → 写盘 access.yaml，随后原子替换 runtime 策略引用
  4. runtime 切换失败 → 回滚磁盘到写前版本，runtime 保持写前，返回保存失败
  5. 成功 → 返回 policyVersion 与 runtimeAck: true
```

收窄、禁用 Agent、删除或替换 Role、撤销 Token 导致的权限下降，全部走此路径；**不存在**「盘已新、权仍旧」却返回成功的响应。

#### B. 外部手改 YAML / 非法热加载

| 情况 | 行为 |
|---|---|
| 新版本编译成功，且相对运行中策略为**等价或放宽** | 可原子切换；切换失败时可回退 last-known-good |
| 新版本编译成功，且为**收窄 / 禁用** | 必须成功切换；切换失败则不承认新盘生效，进入告警；在 ack 前不得对调用方展示为已收窄 |
| 新版本**编译失败**，可定位受影响 Agent | 这些 Agent 的 **DataPlane 工具全部 deny**；Meta 工具默认一并 deny 数据相关输出（catalog 置空） |
| 编译失败，**无法可靠定位**（如 YAML 无法解析） | **数据面整体 deny**（全部 Agent 的 DataPlane 工具），直至修复或回滚 |
| 启动期无任何已验证策略 | 拒绝进入可服务状态 |

#### C. last-known-good 允许范围

- 允许：权限**等价或放宽**的切换失败回退；进程重启时加载上一份**已验证成功**的策略。
- 禁止：在「新配置意图收窄但编译或切换失败」时，继续提供**更宽**旧授权并对外表现为健康。

#### D. 热路径

查询只读当前原子引用的 EffectivePolicy；**禁止**在热路径解析 YAML 或重建 source map。

#### E. 降级态的可观测与恢复（本版新增）

| 要求 | 内容 |
|---|---|
| 告警 | 进入「受影响 Agent deny」或「数据面整体 deny」时，写 `config_change_log` 与结构化日志各一条，并在 Admin 顶部显示常驻 banner（含失败原因与受影响范围） |
| 健康信号 | 健康检查须区分「服务可用」与「策略降级」，不得因策略降级而表现为完全健康 |
| 恢复路径 | Runbook 须给出两条：Admin 修复后保存；或运维回滚 `access.yaml` 到上一可编译版本 |
| 紧急覆盖 | 若提供运维强制加载旧策略的开关，必须显式确认、限时生效、并写入审计；默认不提供 |
| 影响面 | AC-P0 Spec 须评估「整体 deny」对现网 Agent 的可用性影响，并写入发布检查项 |

### ADR-AC-07 — Catalog-Bound Scope（运维数据面）

**决策：** 允许 Role 显式声明 `allow.source_scope: catalog_bound`，在已声明 `allow.connections` 内将 SourcesGrantedBy 定义为 `source map ∩ enabled_tables`。预置参考模板 / 推荐正式 Role id 为 `lucy_admin`（MCP **数据面**，与 WebUI Admin 控制面正交）。

**规则：**

1. `catalog_bound` 要求 `permission_model_version: 2`；`allow.connections` 非空；禁止并存非空 `tableSelectors`；禁止 `tools: ["*"]`；AbsoluteDeny 不可解。
2. **新 connection 不自动纳入**；必须写入 `allow.connections`。
3. 同连接因 `enabled_tables` / source map 增长导致 source 集合变大时，**允许**扩权，但**禁止静默**：必须产生 `policy_scope_expanded`（与 v1 `prefix` 同级可观测性）。
4. 不得将 `catalog_bound` 表述或实现为 legacy `tables: ["*"]`，也不得借此恢复 v2 `prefix`。
5. 产品交付：`lucy_admin` 为 Reference Role Template；客户生产包默认不强制落盘 Agent；UI 必须展示高权限运维数据面警示。

**详规：** [`webui/docs/131-lucy-admin-catalog-bound-role-spec.md`](../../webui/docs/131-lucy-admin-catalog-bound-role-spec.md)。

---

## 3. 目标配置模型

### 3.1 实体

```text
Role
  ├── permission_model_version: 1 | 2
  └── allow
        ├── tools          # 仅 DataPlane / Meta；AbsoluteDeny 一律 lint fail
        ├── connections    # v2 且含 selectors 时为声明校验用；纯 Meta Role 为事实源
        └── tableSelectors[]
              ├── connection / schema / names        # v2 禁用 prefix
              ├── row_access?: all | scoped          # v2 必填；AC-P0 仅 all
              └── row_policy?: structured            # 仅 AC-P1 + scoped

Agent
  ├── roles: [...]           # Role Set
  ├── constraints?: ...      # Agent Constraints（AC-P1.5）
  └── tokens[]               # 仅鉴权
```

### 3.2 配置草案（AC-P0 合法示例）

```yaml
defaults:
  deny_tools:
    # 文档可见性与双保险；真正不可移除的 AbsoluteDeny 在 Proxy 代码基线
    - sl_query
    - sl_read_source
    - sql_execution
    - sql_dialect_notes
    - memory_ingest
    - memory_ingest_status

roles:
  finance_bp:
    permission_model_version: 2
    description: 财务 BP
    allow:
      connections: [mysql-aliyun]
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [fact_fin, dim_account, fact_cost]   # v2 禁用 prefix
          row_access: all                              # AC-P0 仅 all
      tools: [lucy_catalog, lucy_query, lucy_explain_query, lucy_freshness, wiki_search, wiki_read]
      # 本 Role 未授权 lucy_read_source

  public_reader:
    permission_model_version: 2
    description: 公共维度只读（含整源读取）
    allow:
      connections: [mysql-aliyun]
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [dim_vendor]
          row_access: all
      tools: [lucy_catalog, lucy_read_source, wiki_read]

users:
  - id: wang_bp
    name: 王BP
    enabled: true
    roles: [finance_bp, public_reader]
    # 有效 capability:
    #   lucy_query        × {fact_fin, dim_account, fact_cost}
    #   lucy_explain_query× {fact_fin, dim_account, fact_cost}
    #   lucy_freshness    × {fact_fin, dim_account, fact_cost}
    #   lucy_read_source  × {dim_vendor}
    # 不包含 lucy_read_source × fact_fin（无笛卡尔放大）
```

### 3.3 迁移

| 形态 | 行为 |
|---|---|
| Role 无 `permission_model_version` | 随 AC-P0 一次性迁移写入 `1`；稳态后缺字段编译失败 |
| Agent 仅 `role: x` | 视为 `roles: [x]` |
| `role` 与 `roles` 双写 | 保存拒绝 / reload fail-closed |
| v2 + `scoped`（AC-P0 阶段） | 拒绝配置 |
| v2 + `prefix` | 拒绝配置；Admin 迁移时展开为 `names` |
| tools 含 AbsoluteDeny 工具 | lint fail；runtime 代码基线仍 deny |
| tools 含未分类工具 | lint fail；runtime 按 AbsoluteDeny |

---

## 4. Runtime / Admin

### 4.1 裁决流水线

```text
Bearer → Identity(userId)
  → EffectivePolicy[userId]（原子引用，含 policyVersion）
  → tools/call:
       if tool ∈ AbsoluteDenyTools 或 未分类 → deny
       if tool ∈ DataPlaneTools:
            authorizeAndRewrite:
              连接校验（unknown_or_forbidden_connection）
              解析 canonical keys（同 connection 内 sourceName 唯一）
              要求 (tool, sourceKey) ∈ EffectiveDataCapabilities，否则 capability_forbidden
              （AC-P1）施加 FinalRows；未包装工具遇 scoped 源则 deny
              仅此处产生上游调用
       if tool ∈ EffectiveMetaTools:
            按 Meta 规则（catalog 输出按 capability 过滤；敏感 Meta 保留前缀规则）
       else deny
  → audit(policyVersion, capabilities digest, canonical source keys, reason)
```

### 4.2 关键文件（实施时）

| 区域 | 文件 | 要点 |
|---|---|---|
| Source map | `webui/server/proxy/acl.ts` | 正向键改 `(connectionId, sourceName)`；反向键改 `(connectionId, physicalTable)`；同 connection 重名编译失败 |
| 分级与合成 | `acl.ts` | Tool Class 表；capability 合成；EffectivePolicy 编译 |
| 闸门 | `webui/server/proxy/mcp-proxy.ts` | `authorizeAndRewrite`；AbsoluteDeny 代码基线；tools/list 由 capability 推导 |
| 提交 | `webui/server/index.ts` + admin | 进程内编译→写盘→原子切换→回滚 |
| 审计 | `proxy/audit.ts` | `policyVersion`、capability digest、canonical keys |
| Admin | `admin/{agents,roles}.ts` | `roles[]`、版本迁移、prefix 展开、`runtimeAck` |
| Lint | `scripts/lint-spec.mjs` | schema 白名单、AbsoluteDeny、未分类工具、v2 禁 prefix、版本字段 |
| Spec | `webui/docs/07`、`14`、`15`、术语标准 | 契约与文案 |

### 4.3 Admin UX 要点

- Agent 详情按 **capability 列表**展示（工具 × 源 × 行授予），**禁止**只展示「工具并集 + 表并集」两列。
- 版本迁移与 `prefix` 展开必须在 dryRun diff 中可见。
- 权限收窄保存必须 `runtimeAck: true` 才显示成功。
- 策略降级态显示常驻 banner（ADR-AC-06 §E）。

---

## 5. 模拟场景

### 5.0 Fixture

| 对象 | 设定 |
|---|---|
| Role A `finance_bp` | v2；tools = `lucy_query`, `lucy_explain_query`, `lucy_freshness`, `lucy_catalog`；sources = 财务三表；`row_access: all` |
| Role B `public_reader` | v2；tools = `lucy_read_source`, `lucy_catalog`；sources = `dim_vendor`；`all` |
| Role C `legacy_role` | v1；无 `row_access`；含 `prefix` |
| Agent `wang` | roles = [A, B]；tokens T1、T2 |
| Agent `legacy_user` | `role: legacy_role` |
| 全局 | `sl_query` / `sl_read_source` ∈ AbsoluteDeny |

### S1 — 一人一 Agent，多 Token 同权（G1）

| 步骤 | 期望 |
|---|---|
| T1 与 T2 分别调 `lucy_catalog` | 返回同一份源集合与同一 `policyVersion` |
| T1 与 T2 分别查同一源 | 结果一致；权限只随 `userId` |
| 撤销 T1 后用 T1 调用 | 401；T2 权限不变 |

### S2 — Capability 并集，无笛卡尔放大（G3）

| 步骤 | 期望 |
|---|---|
| `lucy_query` × 财务源 | allow |
| `lucy_read_source` × `dim_vendor` | allow |
| `lucy_read_source` × 财务源 | **deny** `capability_forbidden` |
| `lucy_query` × `dim_vendor` | **deny** |
| Admin preview | 展示元组列表，而非两个独立并集 |

### S2b — 跨 Role join

| 步骤 | 期望 |
|---|---|
| `lucy_query` 同时引用两个都具备 `lucy_query` capability 的源 | allow |
| join 中任一源缺少该工具 capability | deny |

### S3 — 版本、`row_access` 与 `prefix`（G5）

| 步骤 | 期望 |
|---|---|
| v2 + 缺 `row_access` | 编译 / 保存失败 |
| v2 + `scoped`（AC-P0 阶段） | 拒绝配置 |
| v2 + `prefix` | 拒绝配置 |
| Admin 编辑 v1 Role 保存 | 升 v2、补 `row_access: all`、`prefix` 展开为 `names`；diff 可见 |
| 迁移后 Role 缺版本字段 | 编译失败 |

### S4 — 行授予 OR 与 Agent Constraints

**整节属 AC-P1 / AC-P1.5。** AC-P0 仅保留占位断言：所有 rowGrant 恒为 TRUE，`FinalRows` 恒为 TRUE。

### S5 — 工具分级与闸门（G6）

| 步骤 | 期望 |
|---|---|
| 调 `sl_query` / `sl_read_source` | deny（代码基线） |
| 从 YAML `deny_tools` 删除 `sl_*` 后再调 | 仍 deny，证明基线不可配置解除 |
| `entity_details` × 有 capability 的源 | allow（与今天等价） |
| `entity_details` × 无 capability 的源 | deny |
| `lucy_freshness` × 无 capability 的源 | deny（不得因归 Meta 而放行） |
| 上游出现未分类新工具 | 不进 `tools/list`；调用 deny；编译告警 |
| `dictionary_search` 未覆盖敏感前缀全部源 | 维持现网拒绝口径 |

### S6 — Legacy 兼容（G10）

| 步骤 | 期望 |
|---|---|
| `legacy_user` 单 Role 调用 | 行为与升级前逐项等价 |
| legacy `prefix` 命中集合因语义层新增而扩大 | 授权可扩大（v1 允许），但必须产生 `policy_scope_expanded` 记录 |

### S7 — 编译失败语义（G8）

| 步骤 | 期望 |
|---|---|
| Admin 保存引入坏 Role | 保存失败；磁盘与 runtime 均保持写前 |
| Admin 保存后 runtime 切换失败 | 磁盘回滚；返回保存失败 |
| 外部改坏 YAML，可定位受影响 Agent | 这些 Agent 的 DataPlane 全部 deny |
| 外部改坏 YAML，无法解析 | 数据面整体 deny；banner 与日志可见 |
| 同 Role 两 selector 冲突 grant | 编译失败 |

### S8 — Canonical key（G7）

| 步骤 | 期望 |
|---|---|
| 不同 connection、同 sourceName | 两键并存；策略不串 |
| 同 connection、不同 schema、同 sourceName | **编译失败** |
| 不同 connection、同 physicalTable | 审计 `sourceRef` 归属正确 |
| snapshot 与 preview | 展示四元组，不以裸名为唯一 ID |

### S9 — 攻击面（AC-P0 子集）

| 攻击 | 期望 |
|---|---|
| 直接调用原生 `sl_*` | deny |
| 通过多 Role 并集拼出未授权 `(tool, source)` | deny |
| 用未分类 / 别名工具试探 | deny |
| raw `query` / `sql` 参数 | `raw_query_forbidden` |
| 未授权 `connectionId` | `unknown_or_forbidden_connection` |

### S10 — 收窄提交（G8）

| 步骤 | 期望 |
|---|---|
| Admin 移除某 capability 且编译成功 | `runtimeAck: true`；立即不可查 |
| 保存时 runtime 切换失败 | 磁盘回滚；返回失败；不得显示已生效 |
| 外部收窄但编译失败 | 不沿用更宽旧权（按 §B 表） |

### S11 — VIEW 兜底并存

现有 VIEW-as-pseudo-table Role 迁为 v2 + `names` + `row_access: all` 后行为不变；不强制改用 Row Policy。

### S12 — 语义层变化不得静默改权（G9）

| 步骤 | 期望 |
|---|---|
| 语义层新增一张表，v2 Role 用 `names` | 授权集合不变（`prefix` 已禁用） |
| 语义层变更导致 `sourceMapVersion` 变化 | 触发重编译；`policyVersion` 变化并写入审计 |
| v1 legacy `prefix` 命中集合扩大 | 产生 `policy_scope_expanded` 记录，Admin 可见 |
| `catalog_bound` Role 同连接 enabled 表集合扩大 | 授权可扩大，**必须** `policy_scope_expanded`；新连接未写入 `allow.connections` 则仍不可见（ADR-AC-07） |
| source map 出现同 connection 重名 | 编译失败，走 §B 降级语义 |

---

## 6. 测试方式

### 6.1 分层

```text
L1 单元   canonical key（正/反向）、工具分级、capability 合成、EffectivePolicy 编译
L2 契约   authorizeAndRewrite、AbsoluteDeny、tools/list 推导、提交与回滚
L3 安全   Security Eval 绕过矩阵
L4 实机   S1/S2/S2b/S3/S5/S6/S8/S10/S12 关键路径
L5 Admin  roles[]、版本迁移、prefix 展开、runtimeAck、lint
L6 UAT    docs/uat-access-control-upgrade.md（实施后产出）
```

### 6.2 L1 — AC-P0 必过

| ID | 断言 |
|---|---|
| U-KEY-01 | 不同 connection、同 sourceName → 两键并存 |
| U-KEY-02 | 同 connection、不同 schema、同 sourceName → 编译失败 |
| U-KEY-03 | 反向映射：不同 connection 同 physicalTable → 归属正确 |
| U-CLS-01 | 分类表覆盖 `known_tools` 全集，无遗漏项 |
| U-CLS-02 | 未分类工具 → 按 AbsoluteDeny，且不进 `tools/list` |
| U-CLS-03 | `entity_details` / `sl_validate` / `lucy_freshness` 仍受源检查（不弱于今天） |
| U-CAP-01 | A ∪ B 不产生 `lucy_read_source × 财务源` |
| U-CAP-02 | join 时每源分别校验 capability |
| U-CAP-03 | 同 Role 冲突 selector → 编译失败；digest 相同 → 合并 |
| U-CAP-04 | connections 由 capability 派生；出现未声明连接 → 编译失败 |
| U-VER-01 | 迁移后缺 `permission_model_version` → 编译失败 |
| U-VER-02 | v2 + `scoped`（P0）→ 拒绝 |
| U-VER-03 | v2 + `prefix` → 拒绝 |
| U-VER-04 | Admin 保存 v1 Role → 升 v2、补 `all`、展开 `prefix` |
| U-SYN-01 | legacy `role: x` → `roles: [x]` |
| U-DENY-01 | 移除 YAML `deny_tools` 后 `sl_*` 仍 deny |
| U-REL-01 | 编译失败 → 不写盘 |
| U-REL-02 | runtime 切换失败 → 磁盘回滚 |
| U-REL-03 | 外部非法 YAML → 受影响 Agent 或整体数据面 deny |
| U-REL-04 | `sourceMapVersion` 变化 → 重编译且 `policyVersion` 变化 |
| **U-COMPAT-01** | **单 Role、v1 legacy 的 Agent，其 capability 集合与升级前的「工具 × 授权表」逐项等价**（不弱不宽） |

**移出 AC-P0（归 AC-P1 / P1.5）：** `scoped` 行授予 OR、Agent Constraints、强制谓词注入、字符串 filter 与 ad-hoc expr 拒绝、未包装工具遇 scoped 源的拒绝。

### 6.3 L2 — 契约

| ID | 断言 |
|---|---|
| P-GATE-01 | 所有上游数据调用仅由 `authorizeAndRewrite` 产生 |
| P-GATE-02 | `tools/list` 与 `tools/call` 双重拒绝一致 |
| P-GATE-03 | DataPlane 工具 capability 为空时不可见且不可调用 |
| P-META-01 | catalog 输出仅含有 capability 的源 |
| P-REL-01 | 保存成功返回 `policyVersion` 与 `runtimeAck` |

### 6.4 L3 — Security Eval

| Case | 波次 | 通过标准 |
|---|---|---|
| AC-SEC-SL | P0 | 原生 `sl_*` 一律 deny |
| AC-SEC-CLS | P0 | 未分类 / 别名工具 deny；未包装工具仍受源检查 |
| AC-SEC-CAP | P0 | 无笛卡尔放大 |
| AC-SEC-KEY | P0 | 同名源不串策略 |
| AC-SEC-SCOPE | P0 | 语义层变化不产生静默授权扩张 |
| AC-SEC-ROW / BYPASS / CONSTRAINT | P1 / P1.5 | 另批 |

### 6.5 命令（示意）

```bash
cd webui
npm test -- canonical-source-key tool-classification acl-capability policy-compile mcp-proxy-acl
npm run lint:spec
./node_modules/.bin/tsc --noEmit
```

### 6.6 发版门禁

| Gate | AC-P0 | AC-P1 |
|---|---|---|
| L1 必过用例全绿 | 是 | 是 |
| `lint:spec` | 是 | 是 |
| AC-SEC-SL / CLS / CAP / KEY / SCOPE | 是 | 是 |
| U-COMPAT-01 单 Role 等价 | 是 | 是 |
| 收窄提交与回滚语义验证 | 是 | 是 |
| 降级态告警与恢复 Runbook | 是 | 是 |
| 上游强制谓词契约证明 | — | **是（缺则禁发）** |
| Bypass 矩阵 | — | 是 |
| Release notes 不得出现「Dynamic RLS / 多租户隔离已交付」 | 是 | 是 |

---

## 7. 分波交付

| 波次 | 范围 | 退出标准 | 开工前提 |
|---|---|---|---|
| **AC-P0 Spec** | 工具分级表；capability 合成；canonical key（正反向）；`permission_model_version` 与迁移；v2 禁 `prefix`；编译输入与提交语义；降级可观测 | Spec 评审通过 | **本文批准后** |
| **AC-P0 WO** | 按 Spec 实现 | §5 的 S1/S2/S2b/S3/S5–S12；§6.2 全部；AC-SEC-SL/CLS/CAP/KEY/SCOPE | **Spec 另批后** |
| **AC-P1** | `scoped` + `row_policy`；FinalRows OR；强制谓词；未包装工具规则；op ∈ {eq, in} | 上游契约证明 + bypass 矩阵 | **另批；本文不授权** |
| **AC-P1.5** | Agent Constraints | S4 constrained；AC-SEC-CONSTRAINT | AC-P0 已交付 |
| **AC-P2+** | Active Role、Dynamic claim、CLS、DB 原生 RLS | 另立项 | 冻结 |

---

## 8. 决策状态

### 8.1 本版冻结

| ID | 决策 |
|---|---|
| D1 | 数据面 = capability 并集，禁止 `(∪tools) × (∪sources)` |
| D2 | 行授予 OR（AC-P1）；人级收紧走 Agent Constraints |
| D3 | Role 带 `permission_model_version`；AC-P0 仅 `all` |
| D4 | 禁止 Segment 作安全谓词 |
| D5 | 工具三分级；`sl_*` 等为**代码级** AbsoluteDeny；**未分类默认 AbsoluteDeny** |
| D6 | Canonical key，正向与反向映射均禁裸键；同 connection 内 sourceName 唯一 |
| D7 | 同 Role 重叠 selector：digest 相同才合并，否则编译失败 |
| D8 | Admin 先编译后原子提交；外部非法配置 deny 而非沿用更宽旧权 |
| D9 | AC-P1 初版 op 仅 `eq` / `in` |
| D10 | `policyVersion` 绑定 access.yaml 与 source map；**v2 Role 禁用 `prefix`** |
| D11 | 缺 `permission_model_version`：一次性迁移标 1，稳态后编译失败 |
| D12 | connections 由 capability 派生；纯 Meta Role 保留显式声明 |
| D13 | 不弱于现状：`entity_details` / `sl_validate` / `lucy_freshness` 在 AC-P0 保持受源检查 |

### 8.2 仍开放（不阻断本文批准）

| ID | 问题 | 建议默认 |
|---|---|---|
| O1 | `role` 单字段兼容多久后删除 | 两个次版本后 lint warn 升 fail |
| O2 | 未包装工具在 AC-P1 是「deny」还是「加 `lucy_*` 包装」 | 由 AC-P1 Spec 决定；默认 deny |
| O3 | Active Role | 不做 |
| O4 | Wiki `allowed_roles` 与多 Role | Role 并集命中即允许 |
| O5 | 同步 reload 与编译 p95 SLO 数值 | AC-P0 Spec 给出 |
| O6 | 是否提供运维紧急覆盖开关 | 默认不提供；如提供须限时 + 审计 |
| O7 | legacy `prefix` 是否设强制迁移截止期 | 建议随 O1 一并设定 |

---

## 9. 契约变更清单（AC-P0 Spec 必须同步）

| 契约 | 变更 |
|---|---|
| `webui/docs/07-mcp-auth-proxy-spec.md` | 新增裁决码 `capability_forbidden:<tool>:<sourceKey>`；工具分级表；`policyVersion` 语义；删除「不实现行级」的过时非目标表述并改为波次边界 |
| 审计 schema | `access_log` 增 `policy_version`；`permission_snapshots` 增 capability digest 与工具分级版本；`config_change_log` 增 `policy_scope_expanded`、降级态事件 |
| Admin API | `roles[]`；`runtimeAck`；版本迁移与 `prefix` 展开的 dryRun diff |
| Admin 审计 UI | 裁决原因筛选项补 `capability_forbidden` |
| Security Eval | 新增 AC-SEC-CLS / CAP / KEY / SCOPE 用例 |
| 术语标准 | 登记本文 Terminology Compliance 表全部条目 |
| `docs/vision.md` / `webui-feature-map.md` | AC-P0+P1 交付后再更新「不做行级」口径 |

---

## 10. 审核清单

- [ ] 批准 **ADR-AC-01**（含反向映射与同 connection 唯一名）
- [ ] 批准 **ADR-AC-02**（全量分级表 + 未分类默认 AbsoluteDeny + 未包装工具规则）
- [ ] 批准 **ADR-AC-03**（capability tuple、connections 归属、Meta 输出过滤、重叠 selector）
- [ ] 批准 **ADR-AC-04**（`permission_model_version` 唯一口径；v2 禁 `prefix`）
- [ ] 批准 **ADR-AC-05** 作为 AC-P1 前置（op 仅 `eq`/`in`）
- [ ] 批准 **ADR-AC-06**（编译输入含 source map、原子提交、降级可观测）
- [ ] 确认批准后 **可写 AC-P0 Spec**，实施 WO 仍须另批
- [ ] 确认 **AC-P1 不得**凭本文开工
- [ ] 对 §8.2 O1–O7 无异议或已批注

### 关闭路径

1. 批准 v1.1.2 → 审核状态改为「ADR 已批准 / AC-P0 Spec 可写」。  
2. 按 [`plans/wo-202608-59-access-control-p0.md`](plans/wo-202608-59-access-control-p0.md) 执行：先 WP-S\* 产出 Spec（Gate B）→ 再 WP-I\* 实现。  
3. 并行起草 AC-P1 上游强制谓词契约 ADR；证明前不开 AC-P1 实现。  
4. AC-P0 与 AC-P1 均退出后，更新 `vision.md` 与 `webui-feature-map.md` 的能力口径。

— 完
