# Lucy v0.25 行权限管理 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.2-requirements-review；2026-10-27 交叉审阅替代条款见 §14 |
| 日期 / 目标版本 | 2026-10-24 / v0.25；最近修订 2026-10-27 |
| 功能编号 / 优先级 | L25-14 / P0-2；R2、R4、R5 为 P0，R1、R3 保持 P1 |
| 状态 | **Spec／Plan 文档评审已关闭，修订通过（2026-10-27）**；已有局部实现，C14–C18 待实施及实现后静态复审，C19 待正式验收。实施基线 `21de5168`，本次另核对 HEAD `7382bac4`；R1／R3 的 P1 历史实施记录不计入 P0 完成判定；V01–V22 全部未执行 |
| 实施回写 | 2026-10-25 W5 历史回写见 §13；2026-10-27 经本次用户明确授权完成独立交叉审阅修订，现行规范性替代条款见 §14。文档修订不表示代码已修复 |
| 授权来源 | 2026-10-24 Forrest 批准首批 Spec 评审 Final 决议；2026-10-25 实施授权见实施计划；2026-10-27 用户授权本次独立核查并直接修订 Spec／Plan |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.8；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) |
| 审查入口 | [首批 P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md) |
| 实施主体 | Lucy；不改 KTX 源码；不新增第二套权限代数 |
| 上游裁决 | [行级策略后续迭代 ADR](../access-control/adr-row-policy-next-iteration.md) §2.2（可复用静态策略引用为下一次行策略增量候选）；[权限路线图冻结 ADR](../access-control/adr-post-p15-roadmap-freeze.md)（Dynamic RLS / TokenScope / 多租户仍冻结） |
| 权威现行契约 | Spec 99（行级策略 / FinalRows / 强制谓词）、Spec 100（Agent 个人行限制）、[术语标准](../../webui/docs/00-product-terminology-standard.md) |

本文件同时保留原设计条款、历史实施回写与现行替代条款；冲突时按 §14.1 的优先级处理。代码存在、历史测试或历史冒烟均不等于本条验收通过。本次仅修订文档：不修改程序、运行配置、客户资产、镜像或数据库，不新增测试代码，不执行功能验证或部署；V01–V22 全部保持「未执行」。

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

> **2026-10-27 替代条款提示**：§3.2、§3.4、§3.5 的现行保存绑定、恢复关闭与目录证明要求分别由 §14.2–§14.4 替换；本节原文仅保留原设计意图和历史追溯，不得脱离 §14 单独作为实现或验收依据。

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

以下伪代码描述原设计控制流。带 `现状` 标记的是 v2.0 已存在的函数，本条复用不改语义；带 `拟增` 标记的是本条新增。**§5.2 的逐 Agent 口径、§5.3 的保存与恢复全流程、§5.5 的目录证明与结构校验已由 §14.2–§14.5 整体替换，原伪代码不再可执行；实现者必须使用 §14 的替代伪代码。** §5.1 的 P1 模板设计及 §5.4 的既有失败关闭边界不在本次替换范围内。

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

**V01–V22 全部未执行**。P0 功能验收覆盖 R2／R4／R5 对应用例；R1／R3 的用例随 P1 实施验收，不提前计入 P0 完成。**V08–V13、V15、V16 的 Role 分支、V20、V21 的可取证判据由 §14.6 替换；下表对应原行仅保留历史索引。** V19／V22 是 D-03 在 **0.20.Z 维护线**修复后的集成回归：在受影响场景取得这些证据前，不得宣称该场景交付价值，但不作为 R2／R4／R5 的开工依赖；V20／V21 不依赖 G5 修复。任何声称完成的范围都必须有其全部适用证据，环境或维护修复前置不足时记录 blocked 原因，不计 passed。

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

- **2026-10-24 原设计阶段边界（历史记录）**：当时仅授权设计与需求审查，不授权实现；2026-10-25 已另行授权实施，授权与历史验证记录见实施计划。该历史声明不撤销后续实施授权，也不证明实施完整。
- 设计、规划、代码存在或历史测试通过均**不等于**本条运行时验收或客户交付通过；本文 §9 的 V01–V22 在本次交叉审阅中全部保持未执行。
- 不得对外宣称 Lucy 已具备「动态行级安全」「多租户隔离」「按人 / 按 Token 的行权限」。相关能力按冻结 ADR 保持冻结。
- R1 模板引用与 R3 视图的后续 P1 实施记录按文件头部保留；不得据此宣称其已通过验收、已在客户环境运行，或将其计为 P0 前置。
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

- **2026-10-25 历史规则**：本节当时只追加、不改写，§1.5、§3.2、§3.5、§5.2、§5.3、§5.5 的原文保留用于追溯。**2026-10-27 起，§14 经用户明确授权替换其中指定的现行条款；冲突优先级为 Spec 99／100 的现行权限代数 → §14 → §13 → 更早正文。** §13 中关于「不改验收矩阵」的历史声明不限制 §14 对验收判据的显式替代。
- **只做可归因诊断**：本节不含任何「已验收通过」「客户交付通过」结论；本 Spec 的 **V01–V22** 全部保持「未执行」。A01–A12 属其他 Spec，不是本表的一部分。
- **术语**：沿用 §3.5 既有三分归因标签（字段不存在／清单不可用／目录能力未知），并附对应机器原因码；不引入术语标准之外的新措辞。
- **历史行号口径**：本节的 `HEAD` 指 2026-10-25 回写时的实施前代码基线，「工作副本」指当时未提交实施代码；二者均为历史标签，不代表 2026-10-27 当前 HEAD。本次交叉审阅的实施基线固定为 `21de5168`，当前 HEAD 固定为 `7382bac4`。
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

## 14. 交叉审阅替代条款（2026-10-27，现行）

### 14.1 授权、证据基线与替代范围

本节依据 2026-10-27 用户对本任务的明确授权写入：独立核查 Codex 审阅意见，只落实有代码证据支持的内容，并同步修订 Spec 与实施 Plan。核查对象为实施基线 `21de5168` 与当前 HEAD `7382bac4`；两基线之间的差异已单独识别，历史问题不直接当作当前问题。

本次认同并落实：B-01 的保存确认与共享窗口缺口、H-01 的恢复异常与恢复标记失败关闭缺口、H-02 的回滚对外结果缺口、M-01 的服务端能力事实源缺口、M-02 的结构校验缺口、M-03 的比较主体歧义，以及 L-01 的状态与历史标签清理。R1／R3 仍属 P1；D-03 仍属 0.20.Z；不引入多副本、动态 RLS 或新权限代数。

| 原条款 | 现行替代条款 | 变更理由 |
|---|---|---|
| §3.2、§5.3 的预览／保存绑定 | §14.2 | 独立预览摘要必须成为保存的服务端确认输入，并在共享窗口内重算 |
| §5.2 的逐 Agent 展开与 V08–V12 比较口径 | §14.5、§14.6 | 全局 Role 并集仅用于管理展示，不能替代 Agent 实际 Role Set |
| §3.4、§5.3、§7 的恢复与对外结果 | §14.3 | 恢复辅助步骤自身可失败；回滚不得被表述为新策略已保存 |
| §3.5、§5.5 的目录能力与可靠装载 | §14.4 | 能力须由服务端解析，YAML 可解析不等于结构可靠 |
| §9 的 V08–V13、V15、V16 Role 分支、V20、V21 | §14.6 | 验收须覆盖真实故障路径和产品入口证据 |
| §11 D6 的协调器范围 | §14.2 | 锁内须包含基线复核、最终预览、写入、生效、终结与恢复 |

未列明的原条款继续有效；§13 的历史回写不删除。Spec 99／100 的权限代数不变。本节是文档合同修订，**不是代码修复记录**；V01–V22 全部保持「未执行」。

### 14.2 R2：成功预览确认与共享发布窗口

#### 14.2.1 预览确认合同

`POST /api/admin/roles/preview-row-policy` 只有在全部受影响表均成功生成最终行约束后，才返回可保存的确认材料。任一表失败时可以返回诊断，但不得返回可被保存接受的确认材料。

```ts
type RowPolicyPreviewConfirmation = {
  vocabularyVersion: string;
  candidateDigest: string;       // draft 覆盖后的完整内存 access 候选
  baseAccessVersion: string;     // 预览时 access.yaml 的版本／CAS 基线
  basePolicyVersion: string;     // 预览时的运行时策略输入基线
  compileInputsDigest: string;   // 下方列明的全部非 access 编译输入
  impactDigest: string;          // 规范化受影响表与 Agent 集合
  affectedTables: Array<{ connectionId: string; schema: string; sourceName: string }>;
  affectedAgentIds: string[];
};
```

`compileInputsDigest` 必须由服务端对下列实际输入规范化后计算：源映射及其版本、启用表集合及其摘要、工具分类版本、每个受影响表的 Schema Manifest 实际内容摘要、参与字段／个人行限制编译的 overlay 实际内容摘要，以及服务端解析出的目录能力结果。只记录 Manifest 路径摘要不足以证明内容未变。密钥和连接凭据不得进入确认材料。

`impactDigest` 绑定排序去重后的完整受影响表集合与受影响 Agent 集合。影响面按变更前后 Role、表选择器、Agent Role Set 及个人行限制共同计算；不得只取客户端当前展开的表，也不得只取发生文本变化的谓词。`candidateDigest`、`basePolicyVersion`、`compileInputsDigest`、`impactDigest` 是不同层级，禁止跨层比较。

所有可改变行级策略或其影响面的 Role 写入口都必须消费该确认；至少包括 `PATCH /api/admin/roles/:roleId`，不得以创建、复制或另一服务入口绕过。请求必须携带 `rowPolicyConfirmation`。服务端不信任客户端回传的表／Agent 列表本身，而是在锁内重新计算并比对全部摘要。

缺失确认、预览未成功、候选变化、任一基线变化或影响面变化，统一以 HTTP 409 / `ROW_POLICY_PREVIEW_REQUIRED` 拒绝，`detail.reason` 至少区分 `missing`、`preview_failed`、`candidate_mismatch`、`baseline_changed`、`compile_inputs_changed`、`impact_changed`。这些拒绝全部发生在 durable intent 与配置写入之前，结果为零配置写、零行策略 intent。

#### 14.2.2 规范性预览与保存流程

`previewCandidate` 必须接收调用方已经取得的同一份配置快照和编译输入快照，不得在中途重新读取另一版 `access.yaml`。它复用运行时 `previewSubjectPermissionsForCandidate` → `resolveEffectivePermissions` → `compileFinalRowsBySource` 路径；通用 `__role_preview__` 不能替代该入口。

```text
function previewRowPolicyDraft(draft, actor):
    requireCurrentPermission(actor)
    current = readAccessConfigSnapshotFresh()
    candidate = overlayDraftOnConfig(current.config, draft)
    requiredSources = sourcesRequiredBy(current.config, candidate)
    inputs = readCompilerInputsFresh(requiredSources)
    impact = computeCompleteImpact(current.config, candidate, inputs)
    result = previewCandidate(candidate, inputs, impact.tables)
    if not result.ok:
        return diagnostic_without_confirmation(result.failures)
    confirmation = makeConfirmation(
        candidate, current.version, inputs.basePolicyVersion,
        inputs.compileInputsDigest, impact)
    return { ok: true, preview: result.preview, confirmation }

function saveRowPolicyDraft(draft, confirmation, actor):
    with sharedSingleInstancePublishCoordinator:       # 同一进程内完整发布窗口
        requireCurrentPermission(actor)
        requireAccessRecoveryClearOrFailClosed()
        current = readAccessConfigSnapshotFresh()      # 锁内重读，禁用锁外旧 raw
        if current.version != confirmation.baseAccessVersion:
            return REJECT_PREVIEW("baseline_changed") # intent 前
        candidate = overlayDraftOnConfig(current.config, draft)
        requiredSources = sourcesRequiredBy(current.config, candidate)
        inputs = readCompilerInputsFresh(requiredSources)
        impact = computeCompleteImpact(current.config, candidate, inputs)
        finalPreview = previewCandidate(candidate, inputs, impact.tables)
        if not finalPreview.ok:
            return REJECT_PREVIEW("preview_failed")   # intent 前
        require confirmation.basePolicyVersion == inputs.basePolicyVersion
              else REJECT_PREVIEW("baseline_changed")
        require confirmation.compileInputsDigest == inputs.compileInputsDigest
              else REJECT_PREVIEW("compile_inputs_changed")
        require confirmation.impactDigest == digestImpact(impact)
              else REJECT_PREVIEW("impact_changed")
        require confirmation.candidateDigest == digestCandidate(candidate)
              else REJECT_PREVIEW("candidate_mismatch")
        require finalPreview covers exactly impact.tables and impact.agentIds
              else REJECT_PREVIEW("impact_changed")

        recoveryPoint = captureCurrentBytesAndRuntimeDigest()
        intent = durableIntent(actor, operationId, beforeDigest,
                               confirmation.candidateDigest, impact)
        if not intent.persisted:
            return FAIL_AUDIT_INTENT_UNAVAILABLE()     # 零配置写
        return writeCommitTerminalOrRecover(candidate, recoveryPoint, intent)
```

共享协调器窗口覆盖：权限／恢复状态复核、access 与编译输入基线重读、候选重建、最终预览与确认比对、intent、配置写入、运行态生效、终结审计，以及失败恢复。只读预览、独立校验和报告查询仍可在窗口外并行；提交复核不得移到窗口外。该要求仅适用于现行单实例／单副本边界。

### 14.3 R4：恢复关闭顺序与三态对外结果

#### 14.3.1 写入、回滚与恢复的规范流程

任何首次配置写入、首次 `commitEffectivePolicy`、committed terminal 的异常都必须进入同一恢复流程；`commitEffectivePolicy` 是可 reject 的异步调用，不得放在无保护的调用点。恢复文件、恢复 commit、恢复核验、恢复标记及恢复终结审计各自都可能失败，必须分别保护。

```text
function writeCommitTerminalOrRecover(candidate, recoveryPoint, intent):
    try:
        atomicWrite(candidate)
        firstStatus = await commitEffectivePolicy()
        requireRuntimeAck(firstStatus, candidate) else throw RuntimeAckFailed
        await durableTerminal(intent, committed, effectiveDigest(firstStatus))
        return COMMITTED(candidate, firstStatus, intent)
    catch writeCommitOrCommittedTerminalFailure:
        return rollbackOrClose(intent, recoveryPoint, writeCommitOrCommittedTerminalFailure)

function rollbackOrClose(intent, recoveryPoint, originalFailure):
    try:
        restoreBytesAtomically(recoveryPoint)
        oldStatus = await commitEffectivePolicy()
        if not runtimeAndDiskMatchRecoveryPoint(recoveryPoint, oldStatus):
            throw RecoveryVerificationFailed
        # 原配置不存在时也必须证明运行态回到对应空基线，不得直接视为成功。
        terminalState = tryDurableTerminal(intent, rolled_back, originalFailure)
        return ROLLED_BACK(oldStatus, intent, terminalState)
    catch recoveryFailure:
        return closeForRecovery(intent, originalFailure, recoveryFailure)

function closeForRecovery(intent, originalFailure, recoveryFailure):
    # 第一步不得 await：先在当前进程置闸。
    latch = setInMemoryRecoveryRequiredSync(originalFailure, recoveryFailure)
    assertAffectedDataPlaneDenied(latch)
    assertAllSubsequentAccessWritesDenied(latch)

    markerState = tryPersistRecoveryMarkerAtomically(latch)  # 捕获异常，不解除内存闸
    degradeState = tryRequestRuntimeDegrade(latch)          # 捕获 reject，不继续放行
    terminalState = tryDurableTerminal(
        intent, recovery_required,
        {originalFailure, recoveryFailure, markerState, degradeState})
    return RECOVERY_REQUIRED(markerState, degradeState, terminalState)
```

`setInMemoryRecoveryRequiredSync` 是后续实现必须提供的同步闭锁点；当前仅在 marker 写成功后更新内存状态不满足本合同。数据面热路径和每个 access 写入口都必须检查该内存闸，不能等下一次重新编译才发现恢复失败。所有 `try*` 仅用于收集失败事实并继续执行关闭步骤，不得把异常重新抛出以绕过 `RECOVERY_REQUIRED` 返回。

恢复标记仅把 `ENOENT` 且不存在未终结行策略 intent 视为无待恢复状态。权限不足、其他 I/O 错误、非法 JSON、缺字段、错误类型、未知 `required` 状态均按「恢复状态不可证明」失败关闭，不得等同于 `required:false`。标记写入使用同目录临时文件 + rename；即使标记写失败，当前进程内存闸仍保持关闭。

进程启动时，在开放受影响数据面与 access 写入之前，必须同时核验恢复标记和未终结行策略 intent。任一来源不可读、损坏或无法判定时保守关闭；不得自动覆盖损坏标记或猜测旧操作未落盘。只有管理员显式恢复动作证明磁盘配置、运行态摘要及目标旧策略一致、相关 intent 已对账且恢复标记可可靠更新后，才允许清除闸门；清闸后再次读取核验，失败则保持关闭。

#### 14.3.2 API 与用户可见结果

`written` 表示目标候选是否已被确认提交为当前生效配置，只有 `committed` 可以为 `true`；它不表示过程中从未尝试写入。是否发生过部分写入及恢复现场由 `attemptedWrite`、可取得的磁盘／运行态实际摘要单独披露，不能从 `written:false` 反推磁盘未变化。三种终态不得混用：

| 状态 | HTTP／业务合同 | 必须返回与展示的事实 |
|---|---|---|
| `committed` | HTTP 200，`ok:true`，`data.status="committed"`，`written:true`，`runtimeAck:true` | 仅在新配置已生效且 committed terminal 已持久化后使用；返回 actor、operationId、intentId／auditId、candidateDigest、目标与实际生效摘要、影响面 |
| `rolled_back` | HTTP 500，`ok:false`，`error.code="ROW_POLICY_SAVE_ROLLED_BACK"`，`written:false`，`runtimeAck:false`，`recoveryRequired:false` | 明确旧配置与旧策略已核验恢复，新候选未保存；返回原失败、candidateDigest、恢复后实际摘要及 `terminalAudit="rolled_back"｜"unconfirmed"`。补写 rolled_back terminal 失败时不得声称终结审计已完成 |
| `recovery_required` | HTTP 503，`ok:false`，`error.code="ACCESS_RECOVERY_REQUIRED"`，`written:false`，`recoveryRequired:true` | 明确受影响读取与后续写入已阻断；返回原失败、恢复失败、候选摘要、可取得的实际摘要，以及 `recoveryMarker`、`terminalAudit` 的 `persisted｜unconfirmed`，不得伪称持久化成功 |

UI 必须按同一终态显示：只有 `committed` 可显示保存成功；`rolled_back` 显示新变更未保存且旧策略已恢复；`recovery_required` 显示需要恢复核验及数据面／写入阻断。前端不得仅凭 HTTP 200、`runtimeAck` 单字段或本地草稿状态推导成功。

### 14.4 R5：服务端能力事实源与可靠目录结构

#### 14.4.1 能力解析与产品入口

新增服务端 `resolveSchemaManifestCatalogCapability(connection, deployment)`，按实际适配器与部署形态返回 `proven｜unknown` 及理由。缺省、调用方未传参数、客户端自报均不得解释为 `proven`。只有当前适配器／部署合同明确支持从 Schema Manifest 建立目录时才可返回 `proven`；文件缺失、拒绝读取或内容非法仍归「清单不可用」，不借能力未知掩盖 I/O／结构故障。

独立预览、保存前最终预览和运行时编译必须调用同一服务端解析结果，并把该结果纳入 `compileInputsDigest`。不得要求客户端传 `schemaManifestCatalogProven`，也不得只在测试直接调用 `compileScopedRowGrant` 时注入该参数。受控验收可以通过服务端适配器／部署夹具制造 `unknown`，但证据必须经 Admin 预览或保存 API 取得。

```text
function loadSourceFieldCatalogWithProvenance(tableKey, serverContext):
    capability = resolveSchemaManifestCatalogCapability(
        serverContext.adapterFor(tableKey.connectionId), serverContext.deployment)
    if capability.status == unknown:
        return {status: catalog_capability_unknown, catalogLoaded: false,
                identity: tableKey, reason: capability.reason}

    path = resolveRequestedManifestPath(tableKey)  # v0.25 不修 D-03 大小写
    bytes = readFile(path)
      on missing: return unavailable(stage=resolve, identity=tableKey)
      on other I/O failure: return unavailable(stage=read, identity=tableKey)
    manifest = parseYaml(bytes)
      on failure: return unavailable(stage=parse, identity=tableKey)
    validated = validateManifestAndTargetTable(manifest, tableKey)
      on YAML-shape failure: return unavailable(stage=parse, identity=tableKey)
      on target/catalog failure: return unavailable(stage=catalog, identity=tableKey)
    overlay = readValidateOptionalOverlayOrFail(tableKey)
      on YAML syntax failure: return unavailable(stage=parse, identity=tableKey)
      on other read/structure failure: return unavailable(stage=catalog, identity=tableKey)
    catalog = buildCatalog(validated, overlay)
      on failure: return unavailable(stage=catalog, identity=tableKey)
    return {status: loaded, catalogLoaded: true, catalog,
            contentDigests: digestsOf(bytes, overlay), identity: tableKey}
```

#### 14.4.2 可靠结构判据

`catalogLoaded=true` 至少要求：

- Manifest 根是非数组对象，`tables` 是非数组对象；目标表 entry 是非数组对象。
- 目标表 entry 必须显式包含 `columns` 数组。每个 column 是非数组对象，`name` 是去除空白后非空的字符串。重复规范化列名按目录冲突归 `catalog`，不得静默去重后声称完整。
- `tables: {table: {}}`、`columns` 缺失／非数组、列项为标量、列名缺失／空串均不是可靠目录。YAML 可解析但形状非法归 `parse`；目标表缺失、目标结构无法建立或重复冲突归 `catalog`，稳定返回，不抛出无归因异常。
- 显式 `columns: []` 可以是合法零列目录；只有上述结构与参与编译的 overlay 均验证通过后，才可据此判「字段不存在」。合法零列不等于目录能力未知，也不等于全部行。
- overlay 缺失可按现行规则视为可选；其他读取失败、非法 YAML 或参与编译的 `columns`／`dimensions`／`measures` 结构非法，不得静默吞掉。其失败须保留目录阶段与四元组，不能把 overlay 故障归成字段不存在。

`no_catalog` 与 `unknown` 都进入同一三分归因；`measure`、`shape`、`unsafe`、`cross_source` 等保留原机器原因，不误入字段不存在。每个产品入口错误同时保留机器原因、归因码、`row_grant` 阶段、适用的目录阶段及连接／Schema／表／字段四元组。三分归因只改变诊断，不改变拒绝行为。

### 14.5 R2：全局展示并集与逐 Agent 实际 Role Set

以下只澄清预览与比较主体，不改变 Spec 99／100：

```text
GlobalEffectiveRowGrant(table) = OR { grant(role, table) | role 为所有允许该表的 Role }
AgentRoleGrant(agent, table)   = OR { grant(role, table) | role ∈ ActualRoleSet(agent) }
FinalRows(agent, table)        = AgentRoleGrant(agent, table) AND AgentConstraints(agent, table)
```

`GlobalEffectiveRowGrant` 仅用于管理展示「该表所有 Role 的全局并集」。每个 Agent 的 `FinalRows` 必须由该 Agent 实际 Role Set 计算，不能把无关 Role 的分支授给该 Agent，也不能用全局并集代替逐 Agent 结果。Agent 没有任何允许该表的 Role 时按无授权／失败关闭处理，不回退为全局并集或全部行。

预览响应可同时返回全局并集与逐 Agent 结果，但字段名、展示标签和证据必须明确区分。V12 固定同一 Agent、目标表、候选与编译输入基线，比较该 Agent 的预览 `FinalRows` 与运行时实际 `forced_filters`；规范化 DNF 分支顺序、AND 谓词顺序及 IN 集合顺序后比较语义等价，不要求展示 digest 与注入 digest 字符串相等。

### 14.6 替代验收判据与证据要求

以下项目全部为**未执行**。文档修订、静态审阅、历史单元测试或历史 HTTP 200 均不得登记为通过。测试直接注入函数参数只能作为补充证据，不能替代要求的产品入口证据。

| 用例 | 当前规范判据与必须保留的证据 |
|---|---|
| V08／V09 | 固定小写 Schema 合成目录，覆盖两个受限 Role、真实 all Role、Agent 仅持部分 Role、Agent 无个人行限制及无关 all Role。分别保存全局并集和逐 Agent DNF JSON；只有全局／该 Agent 实际分支确有 all 时才显示「行权限：全部行」 |
| V10 | 对同一 Agent 比较实际 Role Set 并集与 FinalRows，证明个人行限制 AND 收窄；另一个无关 Role 不得进入该 Agent 结果。保存 Agent Role Set、constraints、全局及逐 Agent 预览 |
| V11 | 构造实际 Role 并集与个人行限制不可满足，预览给稳定 `final_rows_unsatisfiable`；保存拒绝且零配置写、零 intent，不显示空约束或全部行 |
| V12 | 固定 Agent／表／candidateDigest／compileInputsDigest，归档逐 Agent FinalRows 与运行时实际 `forced_filters`，按 §14.5 规范化比较；draft 未落盘时先取预览，再以同一已确认候选完成受控运行时验证。禁止用全局并集或 `__role_preview__` 代替 |
| V13 | 经保存 API 分别提交缺失／失败确认、错误 candidateDigest、access 基线变化、源映射／Manifest／overlay／启用表／工具分类／目录能力／影响面变化；全部在 intent 前拒绝并证明零配置写、零行策略 intent。语义写入／reindex 持窗时保存 busy 或合法重试后重新复核；只读预览与独立校验可并行 |
| V15 | 在 intent、原子写、首次 commit reject／无 ack、committed terminal、恢复文件、恢复 commit reject、恢复核验、恢复 marker 写入、rolled_back terminal 各阶段真实触发故障。直接读取运行态与强制谓词证明旧策略，不额外 commit「帮助恢复」。核验三种 API 终态；恢复失败证明数据面与后续写入拒绝、marker 不可写仍保持进程内关闭、重启依据 marker／未终结 intent 保守关闭、仅经核验解锁 |
| V16 | Role 行策略分支证明变更后 policyVersion 与运行态同步变化；R1 模板分支另随 P1 登记，不混作 P0 证据 |
| V20 | 经 Admin 预览／保存产品入口覆盖：缺文件→resolve；拒绝读取→read；非法 YAML／YAML 可解析但结构非法→合同规定的 parse；目标表或目录不能建立→catalog；服务端能力未证明→capability_unknown。保留机器原因、归因码、row_grant／catalog 阶段与四元组；`no_catalog` 和 `unknown` 均覆盖，measure 等其他原因不误分类 |
| V21 | 仅在 §14.4.2 完整结构与 overlay 校验通过的目录中验证缺字段，含显式合法零列目录；与 V20 的每类故障可区分，四元组完整且失败关闭 |

V19／V22 仍是 D-03 在 0.20.Z 修复后的集成回归；当前 `status=open`、`fixedIn=null`、`verifiedBy=[]`，前置未满足时登记 blocked 原因，不计 passed。它们不是 R2／R4／R5 的开工依赖。V20／V21 使用小写 Schema、受控目录与服务端能力夹具即可执行，不依赖 G5 修复，也不得以 G5 未修为由跳过。

### 14.7 当前实现核对结论（2026-10-27 实施轮次回写）

**（a）实施前基线结论（历史，保留）**

截至 HEAD `7382bac4`：独立预览已使用 draft 内存候选并复用运行时编译路径；锁内 access 版本复核是后续有效局部修正。但 Role PATCH 尚未消费预览确认，共享窗口尚未包含候选重建与最终预览；首次／恢复 commit 与恢复辅助步骤仍有未保护异常；恢复标记不可读／损坏仍被当作无需恢复；PATCH 回滚后仍返回成功写入；R5 能力未知没有生产入口事实源，Manifest／overlay 结构校验不足。

**（b）2026-10-27 实施轮次状态（代码存在 ≠ 验收通过）**

C14–C18 已完成代码实施并完成实现后静态复审（自审），落点见实施计划 §5.4。逐条现状：

| 条款 | 实施落点 | 现状 |
|---|---|---|
| §14.2.1 预览确认合同 | `server/admin/row-policy-confirmation.ts`、`server/proxy/row-policy-preview.ts`、`server/admin/row-policy-routes.ts` | 确认材料含五个分层摘要与完整影响面；仅当全部受影响表成功才签发；确认缺失／解析失败归 `missing` |
| §14.2.2 规范性预览与保存流程 | `server/admin/roles.ts`、`server/admin/access-config.ts` | PATCH／CREATE／COPY 三个入口均进入共享发布窗口，窗口内重读基线、重建候选、重跑同一最终预览并逐项比对；所有拒绝发生在 durable intent 与配置写入之前 |
| §14.3.1 写入、回滚与恢复的规范流程 | `server/admin/access-config.ts`、`server/access-recovery.ts`、`server/proxy/acl.ts` | 写入、首次 `commitEffectivePolicy`、committed terminal 同处一个 try；`closeForRecovery` 先同步置内存闸，再分别尝试原子 marker／运行态降级／终结审计；marker 不可读／损坏／不可写均失败关闭 |
| §14.3.2 API 与用户可见结果 | `server/admin/access-config.ts`、`src/lib/accessWriteOutcome.ts`、`src/pages/admin/RoleDetail.tsx` | 三态合同统一：`committed` 200、`rolled_back` 500、`recovery_required` 503；UI 仅 `committed` 显示保存成功 |
| §14.4 R5 能力事实源与可靠目录结构 | `server/proxy/row-policy-capability.ts`、`server/proxy/row-policy-catalog.ts` | 服务端按部署形态与已注册连接解析 `proven｜unknown`；缺省／未传参／客户端自报均不得为 `proven`；结构非法按 `parse`／`catalog` 稳定归因 |

**（c）未闭合事项**

- §14.6 的 V01–V22 **全部仍为「未执行」**。本轮只完成代码实施与实现后静态复审，未取得任何正式验收证据；文档修订、静态复审、单元测试与历史 HTTP 200 均不得登记为通过。
- C19（正式验收）未执行，需获授权的验收环境。
- 本轮按约束**未做 docker 重建**，未执行浏览器测试、real-e2e、镜像构建与真实环境连接。
- D-03（G5）仍归 0.20.Z；V19／V22 保持 `blocked`，本轮不修复。
- R1 模板与 R3 视图仍属 P1，未因本轮扩张。
- 恢复闸门分层落地：数据面策略重编译路径只核验持久标记与内存闸（不依赖审计库可用性），未终结行策略 intent 的核验放在进程启动与每次 access 写入准入两处；任一来源不可判定仍保守关闭。


### 14.8 Spec／Plan 文档评审关闭记录（2026-10-27）

依据用户“关闭 spec 和 plan 评审，commit 本任务”的明确指令，本次独立审阅、Kimi 交叉审阅及 Codex 静态复核的**文档评审已关闭，修订通过**。初审退回意见已落实到 §14.2–§14.6，并映射到实施计划 §5.4 C14–C19；本次无未决 P0 级文档异议。

本次关闭仅针对 Spec 与 Plan 的文档合同，不关闭代码缺口、缺陷台账或验收门禁。C14–C18 仍待代码实施及实现后静态复审，C19 待正式验收；V01–V22 全部保持未执行。D-03 仍归 0.20.Z，V19／V22 的维护修复与环境前置不足时保持 blocked。本次未执行功能测试、浏览器测试、real-e2e、镜像构建、部署或真实环境连接。

初审报告及本次复审关闭记录见 [Codex 独立审阅报告](../reviews/2026-10-27-codex-review-row-permission-management-p0.md)；初审“退回”保留为历史结论，不覆盖本节的文档关闭状态。

— 完
