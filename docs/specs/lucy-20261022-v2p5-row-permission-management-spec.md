# Lucy v0.25 行权限管理 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.2-requirements-review |
| 日期 / 目标版本 | 2026-10-24 / v0.25 |
| 功能编号 / 优先级 | L25-14 / P0-2；R2、R4、R5 为 P0，R1、R3 保持 P1 |
| 状态 | **已实现，未验收**（v0.25 P0-2 / L25-14）。实施计划 `docs/plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md` §P0-2；提交 `21de5168`。R1 模板与 R3 按表反查视图在 P1-1 落地（提交 `28780eae`） |
| 实施回写 | 2026-10-25 W5 实施回写与勘误见 §13（N1／N2／N7／N8／N12）；只追加不改写，原文条款保留可追溯；未改运行时语义与 §9 验收矩阵 |
| 授权来源 | 2026-10-24 Forrest 批准首批 Spec 评审 Final 决议，并要求完成四个 P0 设计材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.8；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) |
| 审查入口 | [首批 P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md) |
| 实施主体 | Lucy；不改 KTX 源码；不新增第二套权限代数 |
| 上游裁决 | [行级策略后续迭代 ADR](../access-control/adr-row-policy-next-iteration.md) §2.2（可复用静态策略引用为下一次行策略增量候选）；[权限路线图冻结 ADR](../access-control/adr-post-p15-roadmap-freeze.md)（Dynamic RLS / TokenScope / 多租户仍冻结） |
| 权威现行契约 | Spec 99（行级策略 / FinalRows / 强制谓词）、Spec 100（Agent 个人行限制）、[术语标准](../../webui/docs/00-product-terminology-standard.md) |

本文件定义拟实现行为，不代表已实现、已冻结或已经通过验收。本次不修改程序、运行配置、客户资产、镜像或数据库，不新增测试代码，不执行功能验证或部署。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **行权限管理**：本 Spec 登记的功能名称，指治理台内对「行级策略」的配置、复用、预览与审计能力的产品化入口。它是**功能名**，不是新的存储字段，也不是新的权限代数。存储层继续使用既有 `row_policy` / `row_access` / `constraints`。
- **行策略模板**（Row Policy Template）：具名的静态行谓词集合，可被多个表选择器引用。存储键 `row_policy_templates`；模板只声明**行级字段、比较符和字面量取值**，不含任何宏、请求期表达式或调用方输入。
- **行权限视图**：按「表」为入口反查行约束的治理台视图。展示内容来自同一份编译产物，不新增数据面能力。

沿用既有术语（不改写）：行级策略（Row Policy）、行访问（`row_access`）、专用强制字段（`forced_filters`）、个人行限制（Agent Constraints）、最终行约束（Final Rows）、行权限：全部行（Row Access: All Rows）、等于 / 属于（Equals / In）、需包装工具、行策略未启用取数。

禁止口径（文案与文档均不得出现）：

- 不得把本能力写成「动态行级安全」「Dynamic RLS」「多租户隔离」「按人 / 按 Token 动态行收紧」——这些仍按冻结 ADR 保持冻结。
- 不得把「行权限管理」写成新的权限模型或新的授权层级；它只是现有 `row_policy` 的配置与呈现方式。
- 不得把模板描述成「策略继承」或「权限继承」；它是谓词的**复用**，不改变并集 / 交集语义。

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`row_policy`、`row_access`、`row_policy_templates`、`forced_filters`、`constraints`、`FinalRows`、`AgentConstraints`、`policyVersion`、`permission_model_version`、`Role`、`Agent`、`Token`。

---

## 1. 现状基线与证据边界

### 1.1 已交付的运行时事实（v2.0 已具备，非本条新增）

| 能力 | 事实锚点 | 语义要点 |
|---|---|---|
| 静态行策略编译 | `webui/server/proxy/row-policy.ts` `compileScopedRowGrant` | 谓词形状合法后，逐源绑定字段，产出 `RowGrant{kind:"scoped", digest, predicates, orArms}` |
| 谓词形状校验 | 同上 `parseRowPolicyShape` | 仅允许 `predicates` 键；`op ∈ {eq, in}`；取值必须是标量字面量；空谓词集拒绝 |
| 字段安全绑定 | 同上 `bindRowPolicyField` | 字段必须落在「物理列 ∪ 已证明行级 overlay 列」，度量不可绑定；失败原因码 `row_policy_field_unresolved:{empty\|unsafe\|shape\|cross_source\|no_catalog\|measure\|unknown}` |
| 多 Role 行授权合并 | 同上 `mergeRowGrants` | **OR 语义**；任一 Role 为 `all` 则整体 `all`（并集放宽） |
| Agent 个人行限制 | `webui/server/proxy/agent-constraints.ts` `compileAgentConstraints` | 挂在 Agent 上，在角色行级策略之上再收窄 |
| 最终行约束 | 同上 `compileFinalRowsBySource` / `lookupFinalRows` | `FinalRows = EffectiveRowGrant AND Constraints`，按源做 DNF 剪枝；剪枝为空即失败关闭 |
| 强制谓词注入 | `row-policy.ts` `buildForcedFiltersPayload` + `acl.ts` | 运行时写入 `forced_filters`；调用方自带同名字段被丢弃；空载荷按 `row_policy_forced_filters_empty` 失败关闭 |
| 受保护源工具闸门 | `row-policy.ts` `validateProtectedLucyQueryArgs` | 原始 SQL / join / subquery / having / from、filters 字符串、filters 里的 `or/and/not/expr/sql` 树、measure `expr` 一律拒绝 |
| 上游强制谓词证明 | `row-policy.ts` `isUpstreamForcedPredicateProven` | 未证明时受保护源取数按 `row_policy_upstream_unproven` 拒绝 |
| 管理台逐表手填 | `webui/src/pages/admin/RoleDetail.tsx`（`行级策略（可选）` 分区） | 按表手工填写 `eq` / `in` 条件；无复用、无最终行约束预览 |
| 管理台写入校验 | `webui/server/admin/roles.ts` | 表选择器键白名单严格；`row_policy` 仅在 `row_access: scoped` 下合法；`permission_model_version: 1` 禁止 `scoped` / `row_policy` |
| 配置摘要 | `webui/server/proxy/acl.ts` `computeAccessConfigDigest` / `commitEffectivePolicy` | 整份 `access.yaml` 参与 `policyVersion` 摘要，配置变更即切版本 |

### 1.2 管理台缺口（本次要补的）

| 缺口 | 现状 | 业务后果 |
|---|---|---|
| G1 谓词重复 | 同一条「按分公司」在 N 张表上各写一遍 | 口径漂移；改一处漏 N 处，是「行权限配错」的首要来源 |
| G2 看不到最终行约束 | 管理台只显示配置值，不显示并集 / 交集后的实际结果 | 多 Role 并集**放宽**权限，管理员常按直觉当成收紧来判断；Agent 个人行限制的收窄效果不可见 |
| G3 无法按表反查 | 只能从 Role 进到表；「这张表到底受谁限制」要靠逐个 Role 翻 | 客户侧的权限核查与安全评审缺少入口 |
| G4 变更留痕薄弱 | 行策略变更与普通配置变更同流 | 难以回答「谁在什么时候把哪张表的行权限放宽了」 |
| G5 合法列被误判为未知字段 | 字段目录按**小写化后的** schema 名拼清单路径；清单文件在磁盘上保留原始大小写（如 `BIDM.yaml`）时路径命中失败，物理列目录整体落空，该表的所有合法行级字段被判 `row_policy_field_unresolved:unknown` | SQL Server / Oracle 等**大写 schema** 的客户环境下无法保存任何行级条件；本机 macOS 文件系统大小写不敏感，问题在开发期不可见 |

### 1.3 已确认的迭代顺序（不得跳步）

按 [行级策略后续迭代 ADR](../access-control/adr-row-policy-next-iteration.md) §2 的裁决：

- **§2.1 当前版本**：维持静态行策略，运行时不改。
- **§2.2 下一次增量**：**可复用的静态策略引用**——命名模板只声明行级字段、比较符和字面量取值；引用与手写条件都编译成今天的 `row_policy` / `RowPolicyAST`，**不产生第二套权限代数**；挂载点仍是角色上的表选择器；模板与 `access.yaml` 一起版本化，挂载结果进入同一份生效策略摘要；**保存前展示该表的最终行约束**（Role 间并集 + 与 Agent 个人行限制的交集），只显示策略名不够。
- **§2.3 动态数据策略**：另批。动态 claim、`{user.claims.*}`、`{token.scope.*}`、Token 级行收紧**不在本条范围**。

本条即 §2.2 的落地登记，并按 §2.2 第 4 点补上 G2 的预览能力。

### 1.4 证据边界

本条现状判断来自本地源码静态阅读（`webui/server/proxy/`、`webui/server/admin/`、`webui/src/pages/admin/`）与仓库内既有 Spec / ADR，**未**对运行镜像做接口贯通验证，**未**执行任何行策略用例。文中「已具备」指 v2.0 代码路径存在，**不等于**已在客户环境验证通过。

### 1.5 已复现的真实缺陷（2026-10-22 诊断报告）

诊断报告记录了一次**已复现**的行级条件保存失败：角色 `finbp_cdn` 对 `sql_server / BIDM / hs_sy_bu_metric` 设置 `hs_manage_bu_l2 = 'CDN产品'`，`PATCH /api/admin/roles/finbp_cdn`（`dryRun: true`）返回 HTTP 400 / `INVALID_ROLE` / `role_resolution_failed:finbp_cdn:row_policy_field_unresolved:unknown`。移除行级策略后返回 200。该列在 SQL Server 物理表和 Lucy 语义模型中均存在。

**根因（已用复现用例证明，非推测）：** 同读一份 Schema Manifest 的两条路径，对「schema 名」的处理不一致：

| 读取方 | 取 schema 的方式 | 读取路径 | 结果 |
|---|---|---|---|
| 源映射 `acl.ts:300` | `normalizeRef(basename(schemaFile))` → **小写化** | `glob("**/_schema/*.yaml")` 得到**磁盘真实文件名** | 命中 `BIDM.yaml` ✓ |
| 字段目录 `row-policy.ts` `loadPhysicalColumnsFromSchema` | 用上面已小写化的 `entry.schema` **拼路径** | `<semanticLayer>/<conn>/_schema/<schema>.yaml` → `bidm.yaml` | 大小写敏感文件系统上**不存在** ✗ |

清单读不到 → 物理列集合为空 → overlay 的普通列因「不在物理列集合中」被丢弃（`addProvenOverlayFields`）、计算列因 `isProvenRowLevelExpr` 依赖物理列也被丢弃 → `catalog.columns` 为空 → `bindRowPolicyField` 判定 `unknown`。

**为什么开发期看不到：** 本机 macOS / APFS 默认大小写不敏感，`bidm.yaml` 能命中 `BIDM.yaml`；客户环境是 Linux（大小写敏感），问题必现。仓库既有行策略测试全部使用小写 schema（`fin`），该路径从未被覆盖。

**复现步骤：** 用 vitest mock `node:fs/promises` 的 `readFile`，使其按**大小写敏感**语义判定文件名是否存在（macOS / APFS 默认大小写不敏感，直接跑会掩盖问题）；造一份 `_schema/BIDM.yaml`（含目标列）与同名 overlay，跑一次带 `scoped` 行级条件的角色编译。**同一内容仅清单文件名大小写不同**（大写 `BIDM.yaml` / 小写 `bidm.yaml`），结果从 `row_policy_field_unresolved:unknown` 变为可绑定，并可断言代码请求的是小写化路径。工作副本在 `inbox/2026-10-22-行级策略字段绑定诊断/`（`inbox/` 属 gitignore，不入库；持久复现步骤以本节与 §5.5 为准）。

**与本条的关系：** G5 是**存量缺陷**，归属 **0.20.Z 维护线（当前基线 `0.20.0`）**，不是 v0.25 新增能力。它是受影响客户环境的交付价值依赖，**不是 R2／R4／R5 的开工依赖**；本条吸收其管理面要求（R5）与集成回归要求（§9），修复本身的排期见 §11 D7。

**登记状态：** 已在机器可校验的缺陷台账 [`docs/qa/security-findings.yaml`](../qa/security-findings.yaml) 登记为 **D-03（P1 / open）**。本次仍不授权实现，不宣称该缺陷已修复，也不把修复计入 v0.25 新功能；`fixedIn` 在实际修复验证前保持为空。

> 实施回写见 §13.1（N1）、§13.3（N7）（2026-10-25）：本节根因记法与 D-03 现状、G5 归因落点及失败原因枚举分布按该两节校准；原文保留可追溯。

---

## 2. 需求判断与边界

**判断**：行级策略是 Lucy 权限模型里唯一「按行裁剪数据面」的机制，也是当前唯一没有产品化管理面的权限层。表级授权、工具授权在治理台都有专门视图，行级授权只有一个逐表手填的表单，并且看不到配置后的实际行约束。这不是展示美化问题——**多 Role 行授权取并集**意味着配置看起来更严、实际却更宽，缺少最终行约束预览会直接导致越权投放。

**P0 做**：R2 保存前最终行约束预览、R4 行权限配置审计、R5 字段绑定诊断，形成最小安全闭环。**P1 保留**：R1 可复用静态行策略模板、R3 按表反查视图；本文保留其设计以避免后续重开权限语义，但不计入 P0 交付承诺。

**本期不做**（明确排除，见 §8 与 §10）：动态 / 按人 / 按 Token 的行策略；多租户隔离；数据库原生 RLS / CLS；新增权限代数；改动现有 `forced_filters` 注入路径；修改 KTX 源码；改变表级与工具级授权语义。

---

## 3. 能力范围

| 编号 | 优先级 | 能力 | 性质 | 是否改变运行时裁决语义 |
|---|---|---|---|---|
| R1 | P1 | 可复用静态行策略模板（命名引用） | 新增配置形态 | 否——编译成同一套 `RowPolicyAST` |
| R2 | P0 | 最终行约束预览（保存前 + 详情页） | 新增只读展示 | 否——复用 `compileFinalRowsBySource` 产物 |
| R3 | P1 | 行权限视图（按表反查） | 新增只读视图 | 否 |
| R4 | P0 | 行权限配置审计 | 新增审计事件 | 否 |
| R5 | P0 | 行级条件字段可诊断 | 改进错误信息 | 否——只补上下文，不改绑定语义 |

### 3.1 R1 可复用静态行策略模板（P1）

- 模板是**具名的静态谓词集合**，声明内容仅限：行级字段、比较符（`eq` / `in`）、字面量取值。
- 模板不引入取值来源：不允许宏、占位符、请求期表达式、环境变量或调用方 claim。取值只能与今天一样是编译期字面量。
- 挂载点仍是**角色上的表选择器**，不新增授权层级。
- 一个表选择器可同时声明「模板引用」与「附加手写条件」；两者在**同一 Role 分支内取 AND**（同一 `orArm`），跨 Role 仍取 OR（并集）。
- 引用不产生第二套权限代数：`row_policy` 仍只输出 `predicates` 形状，模板在编译期展开后与手写谓词并列进入同一个 `predicates` 数组。

### 3.2 R2 最终行约束预览（P0）

- 在保存行策略**之前**展示该表的最终行约束，而不是保存后才发现。
- 预览必须覆盖两层语义：**Role 之间的并集**（OR，可能放宽）+ **与 Agent 个人行限制的交集**（AND，收窄）。
- 预览输入是 **draft 覆盖当前配置后的内存候选配置**，并经运行时同一编译路径 dry-run；不得读取旧配置、另算展示逻辑或先落盘再回读。
- 预览结果与运行时注入使用**同一份编译产物**（`compileFinalRowsBySource` → `lookupFinalRows`），并绑定候选 `policyDigest / planDigest`；提交时基线变化须重新预览。
- 展示结构必须保持 DNF 形态：**任一分支满足其一**。不得把并集拍平成一条 AND 条件——那会让管理员看到比实际更严的约束，得出错误结论。

> 实施回写见 §13.5（N12）（2026-10-25）：本条「并集 + 各 Agent 交集」的承载入口按该节登记；原文保留可追溯。

### 3.3 R3 行权限视图（P1）

- 以**表**为入口反查：哪些角色对该表设了行策略、每个角色的谓词内容、哪些 Agent 带个人行限制、该表的最终行约束摘要、是否处于「行权限：全部行」状态。
- 与 L25-08 访问关系图的分工：关系图是「谁授权了什么 / 谁访问了什么」的**全局横向**视角；行权限视图是「这张表的行到底受什么约束」的**单表纵向**视角。两者共用同一份编译产物，不重复实现两套数据口径。
- 视图只读，不提供在此处直接改策略的入口；改动仍从角色详情进入，避免出现第二条写入路径。

### 3.4 R4 行权限配置审计（P0）

- 记录：P0 的角色行策略变更；R1 进入实施后同时覆盖模板新增 / 修改 / 删除、引用与解引用。
- 每条记录含：actor、operationId、变更对象身份、变更前后摘要、影响面（受影响的表数 / Agent 数）、时间、intent／terminal 状态与失败原因。
- 行权限变更属**配置审计**，不写入 L25-09 的问询运行时事件流；两者的事件模型与保留策略互不混用。
- 审计顺序固定为 **durable intent → 配置写入与 `commitEffectivePolicy` → durable terminal**。intent 失败不得写配置；terminal 失败必须回滚配置并重新换入旧策略。无法恢复时，受影响范围失败关闭并阻断后续写入，不得出现运行时权限已放宽但没有有效终结审计的状态。

### 3.5 R5 行级条件字段可诊断（P0）

诊断报告第 3 条要求：字段无法解析时，返回具体连接、Schema、表和字段，便于定位。现状 `role_resolution_failed:<role>:row_policy_field_unresolved:unknown` 把**失败字段名整个丢掉**，管理员拿到的信息不足以定位。

- 失败原因必须带四元组：连接、Schema、表（sourceName）、字段名，外加失败阶段（`row_grant`）。
- 必须区分三类原因，不能都报 `unknown`：
  - **字段不存在**：目录已可靠装载且该表确实没有这一列 → 拒绝，指向用户改条件。
  - **清单不可用**：真实路径解析、读取或解析失败，包括 §1.5 的 G5 场景 → 拒绝并指向运维。
  - **目录能力未知**：当前适配器或部署形态不能证明目录可用性 → 拒绝并披露能力边界，不能猜成字段不存在。
- 三类均失败关闭；诊断只增强归因，**不放宽**任何绑定校验。

> 实施回写见 §13.1（N1）、§13.3（N7）（2026-10-25）：本节三分归因的落点（G5 归「清单不可用」）与失败原因的实际枚举分布按该两节校准；原文保留可追溯。

---

## 4. 配置模型

### 4.1 模板声明

```yaml
# access.yaml 顶层新增键
row_policy_templates:
  by_region:
    description: 按大区限定行
    predicates:
      - field: region_code
        op: eq
        value: CN-EAST
  by_multi_region:
    description: 按大区集合限定行
    predicates:
      - field: region_code
        op: in
        values: [CN-EAST, CN-NORTH]
```

约束：

- 模板名是配置内唯一键；只允许 `[A-Za-z_][A-Za-z0-9_-]*`。
- 模板谓词的形状校验复用 `parseRowPolicyShape` 的同一套规则（`op ∈ {eq, in}`、标量字面量、非空取值），模板不得比内联条件宽松。
- 模板**不携带** `sourceName` / `schema`；字段在**引用目标表**的上下文中绑定，与今天内联谓词完全一致。
- 模板与其引用方在**同一份 `access.yaml`** 中版本化，一起进入 `computeAccessConfigDigest`（`policyVersion`）。

### 4.2 引用形态

```yaml
roles:
  finance_reader:
    permission_model_version: 2
    allow:
      tableSelectors:
        - connection: warehouse
          schema: finance
          names: [orders, invoices]
          row_access: scoped
          row_policy:
            template: by_region            # 引用
            predicates:                     # 附加手写条件（AND）
              - field: status
                op: eq
                value: SETTLED
```

约束：

- `row_policy` 下 `predicates` 与 `template` 至少其一存在；两者皆空拒绝。
- `template` 指向不存在的模板 → 编译期失败关闭，原因码 `row_policy_template_unresolved`。
- 引用不改变 `row_access` 的语义：`row_access: scoped` 仍必须带合法 `row_policy`；`row_access: all` 时不得带 `row_policy`。
- `permission_model_version: 1` 的角色禁止 `scoped` / `row_policy`，引用形态同样禁止。

### 4.3 编译规则

| 输入 | 输出 | 语义 |
|---|---|---|
| 模板引用 | 展开为该模板的谓词列表 | 与内联谓词同一形状，进入同一 `predicates` 数组 |
| 内联谓词 | 原样保留 | 不变 |
| 同一选择器的模板 + 内联 | 模板谓词 ∧ 内联谓词（同一 Role 分支内 AND） | 与今天单 Role 内多谓词 AND 一致 |
| 多个 Role 的同一张表 | OR（并集） | 与今天一致；`all` 胜出 |
| Agent 个人行限制 | AND 于 EffectiveRowGrant | 与今天一致（Spec 100） |

**关键不变量**：模板展开后，`RowGrant`、`FinalRows`、`forced_filters`、digest 的语义与形状**全部不变**。任何「模板路径产生第二种行约束表示」的实现都违反本 Spec。

### 4.4 与权限模型版本的关系

- 引用形态**不改变权限代数**，因此沿用现有 `permission_model_version: 2`，不新造版本号。
- 只有当未来引入动态值（宏 / claim / 请求期求值）时才需要新的权限模型版本；那是另批的动态策略波次（§8 冻结项），不得借本条夹带。

---

## 5. 核心流程（伪代码）

以下伪代码描述**拟实现**控制流。带 `现状` 标记的是 v2.0 已存在的函数，本条复用不改语义；带 `拟增` 标记的是本条新增。

### 5.1 模板引用编译（拟增 `resolveRowPolicyRefs`，其余复用现状）

```text
function resolveRowPolicyRefs(selector, templates, sources):
    # selector.row_policy 形如 { template?, predicates? }
    inline  = selector.row_policy?.predicates ?? []
    tplName = selector.row_policy?.template
    out     = []

    # 1) 模板引用展开（先展开，后与内联合并）
    if tplName is not None:
        tpl = templates[tplName]
        if tpl is None:
            return FAIL("row_policy_template_unresolved")        # 失败关闭，不降级为无约束
        parsed = parseRowPolicyShape({ predicates: tpl.predicates })   # 现状函数，复用同一形状校验
        if not parsed.ok:
            return FAIL(parsed.reason)                           # 模板本身不合法 → 拒绝
        out = out + parsed.predicates

    # 2) 内联谓词原样加入（与模板谓词同处一个 AND 分支）
    out = out + inline

    # 3) 空谓词集拒绝（与现状一致）
    if out is empty:
        return FAIL("row_policy_predicates_required")

    # 4) 交给现状编译器做字段绑定与摘要
    return compileScopedRowGrant({ predicates: out }, sources)    # 现状函数
```

要点：`compileScopedRowGrant` **不被修改**。模板在进入它之前就已被摊平成标准谓词，因此 digest、字段绑定失败原因码、跨源解析全部沿用现状。

### 5.2 最终行约束计算（复用现状，新增「按表」入口）

```text
function computeFinalRowsForTable(tableKey, roles, agents):
    # tableKey = (connectionId, schema, sourceName)

    # 1) 该表上每个 Role 的行授权：Role 内 AND，Role 间 OR（现状 mergeRowGrants）
    effective = None                              # OR 的空集单位；禁止用 all 初始化
    for role in roles that allow this table:
        grant = compileRoleRowGrant(role, tableKey)     # 现状语义，含 §5.1 的模板展开
        if not grant.ok:
            return FAIL(grant.reason)                  # 任一 Role 编译失败 → 该表不可用
        effective = grant if effective is None else mergeRowGrants(effective, grant)
    if effective is None:
        return FAIL("row_policy_no_applicable_grant")  # 无授权分支不得解释为全部行

    # 2) 每个 Agent 的个人行限制（AND），并求最终行约束（现状）
    out = {}
    for agent in agents that can reach this table:
        constraints = compileAgentConstraints(agent.constraints, capabilityRefs)  # 现状
        if not constraints.ok:
            return FAIL(constraints.reason)
        final = compileFinalRowsBySource(capabilityRefs, constraints.bySource)    # 现状：DNF 剪枝
        if not final.ok:
            return FAIL(final.reason)                 # 剪枝为空 → 失败关闭
        out[agent.id] = lookupFinalRows(final.finalRowsBySource, connectionId, sourceName, effective)

    return {
        effectiveRowGrant: effective,
        finalRowsByAgent: out,
        # 展示必须保留 DNF 形态：orArms 是「任一分支满足其一」
        displayShape: "OR-of-AND"
    }
```

要点：`effectiveRowGrant` 是**并集**，可能比任何单个 Role 都宽，但 `all OR scoped = all` 只应在确有 `all` 分支时发生；两个受限 Role 不得因累积初值为 `all` 而显示全部行。预览必须同时给出 `effectiveRowGrant` 与各 Agent 的 `finalRowsByAgent`，并保持 `orArms` 结构；**不得**把 orArms 拍平成一条 AND 条件后再展示。

> 实施回写见 §13.4（N8）（2026-10-25）：本节「OR 的空集单位」与 `row_policy_no_applicable_grant` 的承载物按该节登记；原文保留可追溯。

### 5.3 保存前校验、预览与审计闭环（拟增）

```text
function previewRowPolicyDraft(draft, context):
    # 只读 dry-run；draft 覆盖当前配置形成完整内存候选，不落盘、不换入运行策略
    candidate = overlayDraftOnCurrentConfigInMemory(context.currentConfig, draft)
    candidate.roles   # 含当前 draft 的角色、关联 Role
    candidate.agents  # 含可达 Agent 的个人行限制
    candidateDigest = digestCanonicalCandidate(candidate)

    # 形状、模板（P1 启用时）、目录与字段检查全部使用 candidate
    shape = validateCandidateWithRuntimeCompiler(candidate, context.tableKey)
    if not shape.ok:
        return REJECT(section="rowPolicy", reason=shape.reason)
    catalogResult = loadSourceFieldCatalogWithProvenance(context.tableKey)
    if catalogResult.status != loaded:
        return REJECT(section="rowPolicy", reason=diagnoseCatalog(catalogResult))

    # 与运行时同一路径生成最终行约束，不读取旧 roles/agents 另行拼装
    preview = computeFinalRowsForTable(context.tableKey, candidate.roles, candidate.agents)
    if not preview.ok:
        return REJECT(section="rowPolicy", reason=preview.reason)
    return OK(preview, candidateDigest, basePolicyVersion=context.currentPolicyVersion)

function saveRowPolicyDraft(draft, confirmedCandidateDigest, context):
    with sharedSingleInstancePublishCoordinator:  # 与 L25-11 D4 同一协调器
        requireCurrentPermissionAndMatchingBaseline(context)
        preview = previewRowPolicyDraft(draft, context)  # 内存候选，仍不落盘
        if not preview.ok or preview.candidateDigest != confirmedCandidateDigest:
            return REJECT(require_new_preview)
        intentId = durableConfigAuditIntent(actor, operationId, beforeDigest,
                                            preview.candidateDigest, impact)
          else return REJECT(audit_intent_unavailable)  # 不得写配置
        oldConfigAndPolicy = captureRecoveryPoint()
        try:
            persistCandidateAtomically(draft, expectedBaseline=preview.basePolicyVersion)
            await commitEffectivePolicy()             # 重算 policyVersion 并原子换入
            durableConfigAuditTerminal(intentId, committed, afterDigest=policyVersion)
              else throw AuditTerminalUnavailable
            return OK(preview)
        catch writeCommitOrTerminalFailure:
            restoreCandidateAtomically(oldConfigAndPolicy)
            await commitEffectivePolicy()             # 必须重新换入旧策略
            if rollbackVerified():
                durableConfigAuditTerminalBestEffort(intentId, rolled_back, failure)
                return FAIL(rolled_back)
            blockAffectedReadsAndAllSubsequentWrites(recoveryRequired=true)
            return FAIL(recovery_required)
```

要点：预览与保存共用 draft 覆盖后的内存候选及运行时编译路径，保存前不读旧配置冒充预览、不提前落盘。配置审计采用 durable intent → 配置写入／`commitEffectivePolicy` → durable terminal；intent 失败零配置写入，terminal 失败回滚并重新换入旧策略，恢复失败则受影响读取和后续写入均失败关闭。只有终结审计与策略生效均可证明时才返回成功。

> 实施回写见 §13.2（N2，原文第 349／355 行两处 `else` 缺 `if` 条件）（2026-10-25）：按该节只加条件语义注记，冻结伪代码原文不改写。

### 5.4 失败关闭与降级（复用现状，禁止新增宽松旁路）

| 情形 | 期望行为 | 依据 |
|---|---|---|
| 模板不存在 | 该表行策略编译失败，`row_policy_template_unresolved`；受保护源取数按现状路径拒绝 | 新增，形态与现状 `row_policy_field_unresolved` 一致 |
| 模板谓词形状非法 | 编译失败，透传 `parseRowPolicyShape` 原因码 | 现状 |
| 模板字段在目标表不存在 | `row_policy_field_unresolved:unknown`，失败关闭 | 现状 |
| 引用了度量 | `row_policy_field_unresolved:measure`，失败关闭 | 现状 |
| 模板被删除但仍有引用 | **写入侧禁止删除被引用模板**；若绕过写入侧产生该状态，编译失败关闭 | 现状写入校验的延伸 |
| 上游强制谓词未证明 | 取数按 `row_policy_upstream_unproven` 拒绝 | 现状 |
| 注入载荷为空 | `row_policy_forced_filters_empty`，失败关闭 | 现状 |
| 整个配置不可编译 | DataPlane 降级拒绝（`policy_degraded_deny`） | 现状 |

**禁止**：模板解析失败时退化为「该表不限制行」。这会把配置错误直接变成越权。

### 5.5 清单来源、字段诊断与 0.20.Z 缺陷修复边界

R5 的目录状态必须来自实际 I/O 与解析结果，而不是由字段绑定失败反推。`catalogLoaded=true` 仅在 Schema Manifest 的真实路径解析成功、文件读取成功、YAML／结构解析成功且目标表目录建立后成立；任何一步失败均记录具体阶段、稳定原因码与连接／Schema／表四元组。适配器或部署形态未提供可验证目录能力时另记 `catalog_capability_unknown`，不得伪装为已装载或字段不存在。

```text
function loadSourceFieldCatalogWithProvenance(tableKey, adapterCapabilities):
    if not adapterCapabilities.schemaManifestCatalogProven:
        return {status: catalog_capability_unknown, catalogLoaded: false}
    path = resolveManifestFileFromRealDirectoryEntry(tableKey)  # 保留磁盘真实大小写
    if path resolution failed:
        return {status: manifest_unavailable, stage: resolve, catalogLoaded: false}
    bytes = readFile(path)
      else return {status: manifest_unavailable, stage: read, catalogLoaded: false}
    manifest = parseAndValidateSchemaManifest(bytes)
      else return {status: manifest_unavailable, stage: parse, catalogLoaded: false}
    catalog = buildTableCatalog(manifest, tableKey)
      else return {status: manifest_unavailable, stage: catalog, catalogLoaded: false}
    return {status: loaded, catalogLoaded: true, catalog, manifestPathDigest}

function diagnoseFieldBinding(failure, source, catalogResult):
    if failure != "unknown": return failure
    if catalogResult.status == catalog_capability_unknown:
        return "row_policy_catalog_capability_unknown"  # 能力边界未知 → 失败关闭
    if catalogResult.catalogLoaded == false:
        return "row_policy_catalog_unavailable"         # 路径/读取/解析/目录失败 → 运维
    return "row_policy_field_unknown"                   # 仅在可靠目录中证明字段不存在
```

归因只影响错误信息与排查方向，不改变拒绝行为；字段不存在、清单不可用、目录能力未知三者均失败关闭。G5 的真实路径大小写修复属 **0.20.Z 维护线**；V19／V22 在 v0.25 仅作为 D-03 集成回归，不表示本 Spec 已实施该修复。

> 实施回写见 §13.1（N1）、§13.2（N2，原文第 396／398／400 行三处 `else` 缺 `if` 条件）、§13.3（N7）（2026-10-25）：本节的实现边界、归因落点、伪代码条件语义注记与失败原因枚举分布按该三节校准；冻结伪代码原文不改写。

---

## 6. 管理台交互

### 6.1 角色详情「行级策略（可选）」分区

- P0 保留现有逐表手填入口并增加最终行约束预览；R1 实施后才增加「引用模板 / 直接写条件 / 两者并用」，不得把 P1 模板入口算作 P0 已交付。
- 每个受控表展示三项：已配置的模板名（R1 启用时）、内联条件数量、**最终行约束预览**（折叠展开可见完整 DNF 结构）。
- 预览区固定一句边界说明：多角色对同一张表的行授权**取并集**，并集可能比单个角色更宽；个人行限制在其上再收窄。
- 未配置任何行策略的表显示「行权限：全部行」；目录状态未知或预览失败不得用该文案掩盖。
- R1 模板下拉统一展示全部候选并分组：可绑定项可直接选择；不可绑定项不隐藏但禁用并标注「字段在此表不存在」，目录不可用或能力未知时整组禁用并显示运维原因。不得在保存时才首次披露该问题。
- 仅外部异常造成模板删除或改名后仍有引用时，配置页显示「引用缺失」并阻断保存，不静默丢弃条件；正常写入路径按 D5 禁止这种删除。

### 6.2 行权限视图（按表反查，P1）

- 入口：治理台「访问治理」分组下的独立只读页，复用同一编译产物，不并入 L25-08。
- 列：表身份、角色行策略（角色名 + 谓词摘要）、涉及 Agent 与个人行限制、最终行约束摘要（按 Agent）、状态（全部行 / 受限）。
- 支持按角色、Agent、连接、是否受限筛选；支持键盘可达与表格视图（与 L25-08 的可达性要求一致）。
- 折叠或降级必须显式说明，不能用空表冒充「没有限制行」。

### 6.3 与 L25-01 摘要的复用

L25-01 要求 Agent 详情给出一句话（例如「行级策略按分公司」）。该句的数据来源就是本条的模板 / 行策略编译结果，两处必须同源、可对账，不得各自拼装。

---

## 7. 审计与可观测

| 事件 | 触发 | 关键字段 |
|---|---|---|
| `row_policy_template.create` / `.update` / `.delete`（P1） | 模板增删改 | 模板名、变更前后谓词摘要、影响引用数 |
| `row_policy.update.intent` / `.terminal`（P0） | 角色表选择器行策略保存前与终结后 | 表身份、actor、operationId、intentId、变更前后 digest、影响 Agent 数、状态与失败原因 |
| `row_policy.reference.add` / `.remove`（P1） | 引用与解引用 | 表身份、模板名 |
| `row_policy.degrade` | 行策略编译失败导致降级 | 原因码、影响范围（现状策略降级事件口径） |

- 审计记录进入既有配置审计通道（与 L25-04「Skill 负责人变更」同一通道），不新增独立存储。
- intent 未持久化不得写配置；terminal 未持久化必须回滚并重新换入旧策略，恢复失败按 §5.3 失败关闭。不得先改配置再补审计而宣称已留痕。
- 行权限审计**不写入** L25-09 的问询运行时事件流，也不改变其事件状态机与保留策略。

---

## 8. 与既有条目的关系

| 既有条目 | 关系 |
|---|---|
| Spec 99（行级策略 / FinalRows） | 权威现行契约。本条**不改**其运行时语义；模板在编译期摊平为同一 `predicates` 形状 |
| Spec 100（Agent 个人行限制） | 权威现行契约。本条的最终行约束预览需包含其交集结果，但不改变其编译与语义 |
| ADR 行级策略后续迭代 §2.2 | 本条是其登记的下一次增量候选落地；§2.3 动态策略仍另批 |
| ADR 权限路线图冻结 | Dynamic RLS / TokenScope / 多租户**继续不做**；本条不构成重开 |
| L25-01 Agent / 角色页授权摘要 | 本条提供摘要中「行级策略按什么维度」的数据来源，同源可对账 |
| L25-08 访问关系图 | 全局横向视角（谁授权、谁访问）vs 本条单表纵向视角（这张表的行受什么约束）；共用编译产物，不重复实现 |
| L25-09 审计运行时增量 | 问询运行时事件流；本条是配置审计，两者不混用事件模型 |
| L25-11 语义资产批量维护 | 该条不改角色与行级策略；按 D6 共用单实例发布协调器，角色保存、语义资产写入、运行镜像同步及生效串行，只读预览与独立校验可并行 |
| L25-10 Hive 直连 | 沿用既有 ACL 与行策略；本条不改变 Hive 适配的权限裁决路径 |

---

## 9. 验收矩阵

**V01–V22 全部未执行**。P0 功能验收覆盖 R2／R4／R5 对应用例；R1／R3 的用例随 P1 实施验收，不提前计入 P0 完成。V19／V22 是 D-03 在 **0.20.Z 维护线**修复后的集成回归：在受影响场景取得这些证据前，不得宣称该场景交付价值，但不作为 R2／R4／R5 的开工依赖。任何声称完成的范围都必须有其全部适用证据，环境不足保持 blocked。

| 编号 | 范围 | 场景 | 期望 |
|---|---|---|---|
| V01 | R1 / P1 | 模板引用一条含 `eq` 的策略 | 编译成功；`RowGrant.kind=scoped`；`digest` 与直接写同条件时一致 |
| V02 | R1 / P1 | 模板引用一条含 `in` 的策略 | 同上；`values` 顺序不影响 digest |
| V03 | R1 / P1 | 模板 + 内联条件并存 | 同一 Role 分支内 AND；展开后 `predicates` 含两组条件 |
| V04 | R1 / P1 | 引用不存在的模板 | 编译失败，原因码 `row_policy_template_unresolved`；该表取数拒绝 |
| V05 | R1／R5 | 模板字段在可靠目录的目标表不存在 | `row_policy_field_unknown`；失败关闭 |
| V06 | R1／R5 | 模板引用度量 | `row_policy_field_unresolved:measure`；失败关闭 |
| V07 | R1 / P1 | 模板谓词 `op` 非法 | `row_policy_op_forbidden`；失败关闭 |
| V08 | R2 / P0 | 同一表被两个受限 Role 以不同谓词授权 | 预览显示 OR-of-AND 两个分支，**不得显示全部行**，不拍平成一条 AND |
| V09 | R2 / P0 | 两个角色中其一为「全部行」 | 并集结果为全部行；预览显示「行权限：全部行」，不得显示为受限 |
| V10 | R2 / P0 | Agent 带个人行限制 | 最终行约束 = 并集 ∧ 个人行限制；预览同时给出并集与交集两个结果 |
| V11 | R2 / P0 | 并集 ∧ 个人行限制后 DNF 剪枝为空 | 编译失败关闭；预览显示不可满足，不显示空约束 |
| V12 | R2 / P0 | 预览与运行时一致性 | 同一候选 digest 下，预览与运行时 `forced_filters` 等价；draft 未落盘前即可得到该结果 |
| V13 | R2／R4 / P0 | 保存前预览与基线变化 | 使用 draft 覆盖后的内存候选；预览失败零落盘、零 intent；基线或 digest 变化要求重预览 |
| V14 | R1 / P1 | 模板删除与外部异常引用 | 正常写入路径下，被引用模板删除被拒绝，未引用时可删；仅在外部写入造成缺失引用时显示「引用缺失」并失败关闭 |
| V15 | R4 / P0 | intent、生效与终结审计故障 | intent 失败零配置写；terminal 失败回滚并重新换入旧策略；无法恢复时受影响读取及后续写入失败关闭；记录 actor 与前后摘要 |
| V16 | R1／R4 | 策略摘要与版本 | 角色／模板变更后 `policyVersion` 变化；运行时换入生效，无需重启 |
| V17 | R1 / P1 | 受保护源工具闸门 | 引用形态下 `lucy_read_source` 等未包装通道仍按 `row_policy_requires_wrapped_tool` 拒绝 |
| V18 | R2 / P0 | 上游强制谓词未证明 | 取数仍按 `row_policy_upstream_unproven` 拒绝；不得因预览或模板而放宽 |
| V19 | D-03 集成回归 | **清单文件名为大写（如 `BIDM.yaml`）** | 0.20.Z 修复后，在大小写敏感文件系统上合法字段可绑定；不再误报 unknown |
| V20 | R5 / P0 | 清单不可读、缺失、解析失败或目录能力未知 | 全部失败关闭；分别归因清单不可用或目录能力未知，并带连接 / Schema / 表 / 字段四元组 |
| V21 | R5 / P0 | 字段确实不存在 | 仅在目录可靠装载时归因「字段不存在」，与 V20 可区分，且四元组完整 |
| V22 | D-03 集成回归 | 同一 Role 在大写 schema 表上的行级条件 | 管理台预览与运行时注入的 `forced_filters` 等价；修复证据与 v0.25 新功能证据分开登记 |

---

## 10. Non-Claim 与不授权声明

- 本条**不授权**代码实现、测试编写、镜像构建、部署或发布；仅授权设计与需求审查。
- 设计与规划通过**不等于**运行时或客户交付通过；本文 §9 全部未执行。
- 不得对外宣称 Lucy 已具备「动态行级安全」「多租户隔离」「按人 / 按 Token 的行权限」。相关能力按冻结 ADR 保持冻结。
- 不得宣称模板引用已交付、已通过验收或已在客户环境运行。
- 本条不改变 Spec 99 / Spec 100 的运行时语义；若实现与这两份 Spec 冲突，以这两份 Spec 为准并先修订本文。
- §1.5 的 G5 是**存量缺陷**，本文只登记其根因、复现工件与回归要求，**不宣称已修复**；修复须另行批准、实施并验证（§11 D7）。
- 本条不改变「v0.25 不把 Lucy 做成对话框、不动权限裁决与预算引擎」的边界；实施主体为 Lucy，不修改 KTX 源码；单实例 / 单副本边界不变。

---

## 11. 已裁决设计项

D1–D7 已于 2026-10-24 按 P0 Final 决议收口；以下为实现必须遵守的唯一口径，不再留待开发时选择。

| 编号 | 已裁决值 | 影响 |
|---|---|---|
| D1 | R1 模板存放于 `access.yaml` 顶层 `row_policy_templates`；整份配置进入 `policyVersion`，保存与生效复用 §5.3 的 `commitEffectivePolicy` 和 durable intent／terminal 审计合同 | P1 实施不得另建存储或审计旁路 |
| D2 | 模板字段在部分表不存在时失败关闭，不引入 per-source 第二套字段映射 | R1／R5 |
| D3 | R3 使用独立只读视图并复用同一编译产物，不并入 L25-08，不提供第二写入入口 | P1 导航与 IA |
| D4 | 模板取值只允许静态字面量，不引入 segment、度量、宏、claim 或请求期表达式 | 权限语义不变 |
| D5 | 正常写入路径禁止删除仍被引用的模板；外部异常产生的缺失引用失败关闭 | V14 与配置审计 |
| D6 | 角色／行策略保存纳入 L25-11 共享单实例发布协调器，与语义资产写入、运行镜像同步及生效串行；只读预览和独立校验可并行 | P0-2 与 P0-3 可并行设计／实施，但写入口与生效不得并发 |
| D7 | D-03 归属 **0.20.Z 维护线（当前基线 `0.20.0`）**，是受影响客户场景的交付价值依赖，不是 R2／R4／R5 开工依赖；`fixedIn` 未经验证保持为空 | V19／V22 仅作集成回归；不得以「全部行」绕过 |

---

## 12. 引用材料

| 材料 | 用途 |
|---|---|
| [`docs/access-control/adr-row-policy-next-iteration.md`](../access-control/adr-row-policy-next-iteration.md) | 下一次增量 = 可复用静态策略引用；动态策略另批 |
| [`docs/access-control/adr-post-p15-roadmap-freeze.md`](../access-control/adr-post-p15-roadmap-freeze.md) | Dynamic RLS / TokenScope 冻结与重开条件 |
| [`webui/docs/99-access-control-p1-row-policy-spec.md`](../../webui/docs/99-access-control-p1-row-policy-spec.md) | 静态 `row_policy`、`forced_filters`、受保护源工具矩阵 |
| [`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md) | 个人行限制；并集 / 交集与最终行约束 |
| [`docs/access-control/adr-upstream-forced-predicate.md`](../access-control/adr-upstream-forced-predicate.md) | 强制谓词载体与未证明即拒绝 |
| [`docs/access-control/runbook-row-policy.md`](../access-control/runbook-row-policy.md) | 现行配置与运维口径 |
| `webui/server/proxy/row-policy.ts` | 编译、字段绑定、digest、注入载荷 |
| `webui/server/proxy/agent-constraints.ts` | 个人行限制与最终行约束 DNF 剪枝 |
| `webui/server/proxy/acl.ts` | 角色编译、权限合并、`policyVersion` |
| `webui/server/admin/roles.ts` | 表选择器写入校验 |
| `webui/src/pages/admin/RoleDetail.tsx` | 现有「行级策略（可选）」分区 |
| [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) | 术语事实源 |

---

## 13. 实施回写（2026-10-25，Lucy v0.25 W5）

本节是 v0.25 实施期（W5）的文档回写，记录实施期实证出的 5 条文档偏差，编号沿用[实施计划](../plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md) §7 待决项表（N1、N2、N7、N8、N12），便于对账。

回写规则：

- **只追加，不改写**：§1.5、§3.2、§3.5、§5.2、§5.3、§5.5 的原文一律保留，可追溯；本节与原文冲突之处以本节为准。
- **只做可归因诊断**：本节不含任何「已验收通过」「客户交付通过」结论；**§9 验收矩阵 V01–V22 与 A01–A12 状态一律保持「未执行」**。
- **术语**：沿用 §3.5 既有三分归因标签（字段不存在／清单不可用／目录能力未知），并附对应机器原因码；不引入术语标准之外的新措辞。
- **行号口径**：证据分两组引用——`HEAD`（v0.25 实施前基线，与 §1.5 原文引用的行号一致）与「工作副本」（本分支 `lucy-v0.25` 未提交的实施期代码）。同一事实在两组行号不同处均标出。
- **本文档自身行号**：本节引用的本文档行号均为**回写前冻结正文**的行号（与实施计划 §7／§9.0 的引用一致）；本节追加后正文整体后移，需要定位时按上下文检索，§13.2 另给出追加后的行号。

### 13.1 N1 — §5.5 的真实大小写解析与 G5 归因互斥

**（a）偏差事实与证据**

§3.5（原文第 164 行）要求把「§1.5 的 G5 场景」归因到清单不可用（指向运维）；§5.5（原文第 392 行）的伪代码写作 `path = resolveManifestFileFromRealDirectoryEntry(tableKey)  # 保留磁盘真实大小写`。该函数一旦实现即命中磁盘真实文件名 `BIDM.yaml`，G5 随之消失，归因将落到「字段不存在」，与 §1.5 记载的根因、§11 D7 的归属、缺陷台账 D-03 的 `fixedIn: null` 及 §9 中 V19／V22 的前置条件互相矛盾。

代码事实：

| 事实 | 位置 |
|---|---|
| 字段目录按 schema 名拼清单路径（大写 schema 被小写化为 `bidm.yaml`） | `HEAD` `webui/server/proxy/row-policy.ts:179`（`files.push(path.join(schemaDir, schema + ".yaml"))`） |
| 源映射对 schema 名小写化，但清单文件名取磁盘真实名（`glob("**/_schema/*.yaml")`） | `HEAD` `webui/server/proxy/acl.ts:300`；工作副本 `webui/server/proxy/acl.ts:312` |
| 实施期目录加载**锚定实际请求路径**，不做真实大小写解析 | `webui/server/proxy/row-policy-catalog.ts:264-266`（`resolveManifestFilePath`），调用点 `:325` |
| 请求路径来自绑定侧实际请求的 schema | `webui/server/proxy/row-policy.ts:317`（`source.schema`） |
| `resolveManifestFileFromRealDirectoryEntry` 在代码中不存在 | 全仓检索仅命中本 Spec 原文第 392 行 |
| 清单读不到 → `manifest_unavailable` / `stage=resolve`（`ENOENT` 归入 resolve 阶段） | `webui/server/proxy/row-policy-catalog.ts:324-337`、`:240-245` |
| D-03 仍为 open，`fixedIn: null`，`verifiedBy` 为空 | `docs/qa/security-findings.yaml:119-125` |

**（b）本次裁决（Forrest 2026-10-25 裁决，改法 1）**

1. v0.25 **只做可归因诊断，不修 G5**：不实现真实大小写解析，且不得把「清单不可用」改判为「字段不存在」。
2. 目录加载**锚定实际请求路径**（`bidm.yaml`），不做真实大小写解析；该行为由 `resolveManifestFilePath` 单一处承载。
3. G5 情形下判定为 `manifest_unavailable` 且 `stage=resolve`，归因「清单不可用，指向运维」，对应归因码 `row_policy_catalog_unavailable`。
4. 真实大小写解析留 **0.20.Z 维护线**，不在 v0.25；D-03 保持 `fixedIn: null`、状态 open；V19／V22 仍是「D-03 集成回归」条件项，保持成立。

**§5.5 边界说明（本轮实现到哪里为止、为什么不修 G5、归因落在哪）**

- **实现到**：清单路径按请求的 schema 名拼装并读取；读取失败按 `resolve → read → parse → catalog` 四阶段记录；失败一律失败关闭，并附连接／Schema／表／字段四元组与目录阶段。
- **为什么不修 G5**：G5 是 0.20.Z 维护线的存量缺陷（D-03，§11 D7）。本轮修掉它，会使 §3.5 的三分归因失去「清单不可用」分支，V19／V22 失去前置条件，受影响客户场景的交付价值证据将失去独立登记位置。
- **归因落在哪**：G5 → `manifest_unavailable` / `stage=resolve` → 归因码 `row_policy_catalog_unavailable`（指向运维）；**绝不**落到 `row_policy_field_unknown`（指向用户改条件）。
- **与 §13.2 的关系**：§5.5 伪代码回写前第 396／398／400 行的三处 `else` 与本条落在同一段；其条件形态问题见 §13.2。N1 决定**行为边界**，N2 决定**表述可判定性**，两者不冲突。

**（c）受影响条款编号**：§3.5（R5 三分归因）、§5.5（清单来源、字段诊断与 0.20.Z 缺陷修复边界，含原文第 392 行）、§1.5（G5 根因与登记状态）、§11 D7（归属与 `fixedIn`）、§9 的 V19／V22（条件项）、缺陷台账 D-03。

**（d）是否改变冻结契约**：**不改变**运行时语义、权限代数、`permission_model_version`、D1–D7 裁决与 §9 验收矩阵，原文一律保留。§5.5 原文第 392 行按本节**降级为 0.20.Z 目标形态、不属 v0.25 交付范围**——这是对既有条款的实施边界勘误，不是新增要求。批准记录来源：§11 D7（[2026-10-24 P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) 第 34 行）+ 实施计划 §10 待决事项 N1（**已裁决（Forrest，2026-10-25）：改法 1**），其在本 Spec 内的登记即本节。因不引入新条款、不改验收矩阵，文档「文档类型 / 版本」保持 `v0.2-requirements-review`，回写以本节日期与锚点为准。

### 13.2 N2 — 伪代码中 5 处缺 `if` 条件的 `else`

**（a）偏差事实与证据**

本 Spec 的伪代码块中有 5 处 `else`，其**前一行不是条件语句**——没有可挂载的 `if`，读者无法从上下文判定该 `else` 属于哪个分支。逐处核对结果：

| 回写前行号 | 追加后行号 | `else` 前一行 | `else` 分支内容 | 该分支的实际语义（按上下文判定） |
|---|---|---|---|---|
| 349 | 358 | `preview.candidateDigest, impact)` | `else return REJECT(audit_intent_unavailable)` | 审计意图未持久化 → 拒绝保存、零配置写入 |
| 355 | 364 | `durableConfigAuditTerminal(intentId, committed, afterDigest=policyVersion)` | `else throw AuditTerminalUnavailable` | 终结审计未持久化 → 抛错进入 catch → 回滚配置并重新换入旧策略 |
| 396 | 407 | `bytes = readFile(path)` | `else return {status: manifest_unavailable, stage: read, catalogLoaded: false}` | 清单读取失败 → 清单不可用，阶段 `read` |
| 398 | 409 | `manifest = parseAndValidateSchemaManifest(bytes)` | `else return {status: manifest_unavailable, stage: parse, catalogLoaded: false}` | 清单解析失败 → 清单不可用，阶段 `parse` |
| 400 | 411 | `catalog = buildTableCatalog(manifest, tableKey)` | `else return {status: manifest_unavailable, stage: catalog, catalogLoaded: false}` | 目录构建失败 → 清单不可用，阶段 `catalog` |

冻结正文中 `else` 检索共 6 处：除上表 5 处外，§5.2 伪代码第 292 行的 `effective = grant if effective is None else mergeRowGrants(effective, grant)` 是行内条件表达式（正常写法，非悬空 `else`），§5.1 伪代码无 `else`。**§5.2 伪代码块（第 283-313 行）与 §5.4（第 369-382 行的失败关闭表格）无同类悬空写法**，不在本条范围。

第 396／398／400 行（追加后第 407／409／411 行）与 §13.1 的 N1 落在 §5.5 同一段伪代码：这三处的 `else` 分支正是「清单不可用」归因的落点，其 `stage` 取值与实施期目录阶段机（`resolve → read → parse → catalog`，`webui/server/proxy/row-policy-catalog.ts:148`）一一对应。

**（b）本次裁决**

- 这 5 处 `else` 的**原文语义是「该步骤失败即走 else 分支」**：每个 `else` 挂载于上一步骤的成功返回，上一步骤失败即进入本分支。
- **本轮不改写冻结伪代码原文**，只加注记。理由：伪代码的条件形态属于冻结契约的表述方式，改写它会牵动 §5.5 的验收判据（V20 按 `stage` 区分 read／parse／catalog），且无法在不引入新条款的前提下证明改写后的形式与原意等价。
- 可判定的写法以**注记形式**给出（不改原伪代码行）：
  - 第 349 行（追加后第 358 行）：`else` 挂载于 `durableConfigAuditIntent(...)` 的成功返回；该调用失败即进入本分支（意图未持久化 → 零配置写入）。
  - 第 355 行（追加后第 364 行）：`else` 挂载于 `durableConfigAuditTerminal(...)` 的成功返回；该调用失败即进入本分支（终结审计未持久化 → 抛错并按 §5.3 回滚）。
  - 第 396 行（追加后第 407 行）：`else` 挂载于 `readFile(path)` 的成功返回；读取失败即进入本分支（`stage=read`）。
  - 第 398 行（追加后第 409 行）：`else` 挂载于 `parseAndValidateSchemaManifest(bytes)` 的成功返回；解析失败即进入本分支（`stage=parse`）。
  - 第 400 行（追加后第 411 行）：`else` 挂载于 `buildTableCatalog(manifest, tableKey)` 的成功返回；目录构建失败即进入本分支（`stage=catalog`）。

**（c）受影响条款编号**：§5.5（主，原文第 396／398／400 行）、§5.3（原文第 349／355 行）。§5.2、§5.4 无同类写法。

**（d）是否改变冻结契约**：**不改变**。原伪代码行一律保留，本条只追加条件语义注记，未新增要求、未改验收判据。批准记录来源：实施计划 §9.0 回写状态表的 N2 行（落点 = L25-14 §5.5 伪代码 5 处悬空 `else`，行 349／355／396／398／400）与 §7 待决项 N2 登记；因不引入新条款、不改 §9 验收矩阵，文档「文档类型 / 版本」保持 `v0.2-requirements-review`。

### 13.3 N7 — 字段绑定失败原因的实际枚举分布与归因短路语义

**（a）偏差事实与证据**

§1.5（原文第 96-100 行）把 G5 的复现结果记为 `row_policy_field_unresolved:unknown`，未区分该表 overlay 是否暴露度量。

代码事实：

| 事实 | 位置 |
|---|---|
| 目录为 `null` → `row_policy_field_unresolved:no_catalog` | `webui/server/proxy/row-policy.ts:196` |
| 命中度量 → `row_policy_field_unresolved:measure` | `webui/server/proxy/row-policy.ts:199-201` |
| 目录非 `null` 但字段不在列集合 → `row_policy_field_unresolved:unknown` | `webui/server/proxy/row-policy.ts:202-204` |
| 目录为 `null` 的条件：列集合与度量集合同时为空 | `webui/server/proxy/row-policy-catalog.ts:448`（实施前基线同条件见 `HEAD` `webui/server/proxy/row-policy.ts:271-274`） |
| G5 下物理列为空；overlay 普通列与计算列因依赖物理列被丢弃 | `webui/server/proxy/row-policy-catalog.ts:436-437`（`addProvenOverlayFields` → `isProvenRowLevelExpr`） |
| overlay 的 measures **无条件**计入，与物理列无关 | `webui/server/proxy/row-policy-catalog.ts:438-442` |

因此实际分布是：**overlay 无 measure → 目录为 `null` → 机器原因 `no_catalog`；overlay 有 measure → 目录非 `null` → 机器原因 `unknown`**。§1.5 记载的 `unknown` 只在后者成立；该节根因叙述中的「catalog.columns 为空 → 判定 unknown」隐含了「目录非 `null`」这一前提。

§5.5 伪代码（原文第 404 行）`if failure != "unknown": return failure` 会把 `no_catalog` 原样漏过，不进入三分归因。实施期实现的归因函数 `attributeBindingFailure`（`webui/server/proxy/row-policy.ts:121-156`）把 `no_catalog` 与 `unknown` 一并视为目录驱动（`:138-140`），再按目录状态分流（`:145-155`）：`catalog_capability_unknown` → `row_policy_catalog_capability_unknown`；`manifest_unavailable` → `row_policy_catalog_unavailable` 并带 `catalogStage`；`loaded` → `row_policy_field_unknown`。即**实现不短路 `no_catalog`**，§5.5 伪代码的首行语义未落地。

**（b）本次裁决**

- 以实现的枚举分布为准登记：`no_catalog` 与 `unknown` 是两个不同的机器原因码，必须各自可被归因；两者都不得被当成「字段不存在」的同义词。
- `diagnoseFieldBinding` 的首行短路语义按实现理解：**目录驱动类原因（`no_catalog` 与 `unknown`）不得短路**，必须按目录状态分流；`empty`／`unsafe`／`shape`／`cross_source`／`measure` 保留各自原因码，不参与三分归因。
- §1.5 的记法按本节校准：G5 的复现结果应记为「`row_policy_field_unresolved:no_catalog` 或 `row_policy_field_unresolved:unknown`，取决于该表 overlay 是否暴露度量」；2026-10-22 诊断报告所记的那一次复现落在 `unknown` 分支。
- 与 §13.1 的关系：G5 情形的**归因码**由 §13.1 规定（`row_policy_catalog_unavailable`）；本条只补记**机器原因码**的分布与短路语义，两者不冲突。

**（c）受影响条款编号**：§1.5（G5 复现记录与根因叙述）、§3.5（三分归因）、§5.5（`diagnoseFieldBinding` 伪代码）、§9 的 V20／V21（归因可区分）。

**（d）是否改变冻结契约**：**不改变**。本条只补记现状枚举分布与短路语义，未新增归因类别、未放宽任何绑定校验；§3.5 的三分归因与 §9 验收判据不变。批准记录来源：实施计划 §9.0 回写状态表的 N7 行（落点 = L25-14 §1.5／§3.5／§5.5）与 §7 待决项 N7 登记；因不引入新条款、不改 §9 验收矩阵，文档「文档类型 / 版本」保持 `v0.2-requirements-review`。

### 13.4 N8 — 「空集」的承载物缺失与 `row_policy_no_applicable_grant`

**（a）偏差事实与证据**

§5.2（原文第 294 行）要求 `return FAIL("row_policy_no_applicable_grant")`，并在第 287 行把并集的初值写成「OR 的空集单位；禁止用 `all` 初始化」。但现行 `RowGrant` 类型只有 `all` 与 `scoped` 两个变体，**没有「空集（无行可见）」的表示**：

| 事实 | 位置 |
|---|---|
| `RowGrant` 只有 `all` / `scoped` 两变体，无空集变体 | `webui/server/proxy/row-policy.ts:55-64` |
| `mergeRowGrants` 以 `all` 为并集吸收元（`all` 与任一分支合并即 `all`），无空集单位 | `webui/server/proxy/row-policy.ts:357-366` |
| 「无授权分支」在预览层由 `undefined` 哨兵承载，不进 `RowGrant` | `webui/server/proxy/row-policy-preview.ts:92`（`let effective: RowGrant \| undefined`）、`:100-103`（`effective === undefined` → `row_policy_no_applicable_grant`） |
| 路由层同一原因码 | `webui/server/proxy/row-policy-preview.ts:346-354` |
| 「空集」在 `RowGrant` 层被表达为**失败**而非值：AND 剪枝为空即失败关闭 | `webui/server/proxy/agent-constraints.ts:362`、`:385`（`final_rows_unsatisfiable`）、`:407-408` |

即：无授权分支与「全部行」在预览层已可区分（前者 `undefined` → `row_policy_no_applicable_grant`，后者 `all`），但 `RowGrant` 本身仍无法表达「经剪枝后无行可见」这一状态值。

**（b）本次裁决**

- §5.2 的「OR 的空集单位」在本轮由**预览层的 `undefined` 哨兵**承载；**禁止**用 `all` 初始化，否则「无授权」会被显示为「行权限：全部行」（与 §5.2 要点一致）。
- `RowGrant` **不新增变体**：新增变体会牵动 Spec 99／Spec 100 的行授权代数与 `forced_filters` 注入形状，超出本轮边界。
- **待补项（登记，不在本轮实现）**：`RowGrant` 层的「空集」表示尚未定义——即「并集 ∧ 个人行限制后无任何行可见」目前只能以失败（`final_rows_unsatisfiable`）表达，不能作为可展示、可摘要的授权值。该缺口登记为待补项 T-01，随 P1 迭代一并裁决；本轮不以任何含糊语义掩盖，也不臆造第三种授权含义。
- 本轮对「无授权分支」的处理边界即上述 `undefined` 哨兵 + `row_policy_no_applicable_grant` 原因码，**不改** §5.2 原文，也不新增放宽旁路。

**（c）受影响条款编号**：§5.2（最终行约束计算，含原文第 287／294 行）、§5.4（失败关闭矩阵，`final_rows_unsatisfiable` 归口）、待补项 T-01（新增，仅本节登记）。

**（d）是否改变冻结契约**：**不改变**。§5.2 的要求与失败关闭语义不变，本条只补记承载物的现状事实与处理边界；新增的 T-01 是待补项登记，不构成对本 Spec 的新增要求，也不进入 §9 验收矩阵。批准记录来源：实施计划 §9.0 回写状态表的 N8 行（落点 = L25-14 §5.2）与 §7 待决项 N8 登记；因不引入新条款、不改 §9 验收矩阵，文档「文档类型 / 版本」保持 `v0.2-requirements-review`。

### 13.5 N12 — 预览入口是否携带 Agent 个人行限制

**（a）偏差事实与证据**

§3.2 要求预览必须同时给出 Role 之间的并集与各 Agent 个人行限制的交集。实施期核对出两个入口，能力不同：

| 入口 | 是否带 Agent 个人行限制 | 证据 |
|---|---|---|
| 既有通用角色权限预览 `previewRolePermissionsForAdmin` | **不带**。以假用户 `__role_preview__` 构造候选用户，该用户对象无 `constraints` 键 | `webui/server/proxy/acl.ts:1864-1890`；假用户构造 `:1873`、`:1882-1885`；个人行限制仅在主体带 `constraints` 键时才编译（`:1532`、`:1533`），故该入口的 `agentConstraintsBySource` 为 `null`（`:1597`） |
| v0.25 新增最终行约束预览 `previewRowPolicyDraft` | **带**。对每个可达 Agent 以其自身 `constraints` 走同一编译路径，再按 Agent 求交集 | `webui/server/proxy/row-policy-preview.ts:222-419`；可达 Agent 判定 `:356-364`；带 `constraints` 解析 `:367-379`；按 Agent 求交集 `:105-113`（`lookupFinalRows`）；路由 `webui/server/admin/row-policy-routes.ts:93`（`POST /api/admin/roles/preview-row-policy`） |

**（b）本次裁决**

- §3.2 的「并集 + 各 Agent 交集」由 v0.25 新增的最终行约束预览入口承载；其验收状态随 §9 的 V08–V13 一律保持「未执行」。
- 既有 `__role_preview__` 入口**维持现状不改**：它是角色权限解析预览（工具／表／连接可达性），不是最终行约束预览；**不得**用它的产出充当 §3.2 的预览证据，两个入口的口径不得混用。
- 该差异登记为现状事实，不作为 §3.2 要求的放宽或替代。

**（c）受影响条款编号**：§3.2（最终行约束预览）、§5.2（最终行约束计算）、§5.3（保存前校验、预览与审计闭环）、§6.1（管理台交互）、§9 的 V08–V13。

**（d）是否改变冻结契约**：**不改变**。§3.2 的要求不变，本条只补记「哪个入口承载该要求」的现状事实。批准记录来源：实施计划 §9.0 回写状态表的 N12 行（落点 = L25-14 §3.2）、§5.2 实施条目 C6 与 §7 待决项 N12 登记；因不引入新条款、不改 §9 验收矩阵，文档「文档类型 / 版本」保持 `v0.2-requirements-review`。

— 完
