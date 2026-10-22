# Lucy v2.5 行权限管理 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / v0.1-draft |
| 日期 / 目标版本 | 2026-10-22 / v2.5 |
| 功能编号 / 优先级 | L25-14 / P1，访问治理域核心能力 |
| 状态 | 纳入规划、待评审；仅授权起草和登记，暂不开发 |
| 授权来源 | 2026-10-22 Forrest 要求：在 v2.5 加入「行权限管理」需求 |
| 规划入口 | [Lucy 2.5 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.8 |
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

### 1.4 已复现的真实缺陷（2026-10-22 诊断报告）

诊断报告记录了一次**已复现**的行级条件保存失败：角色 `finbp_cdn` 对 `sql_server / BIDM / hs_sy_bu_metric` 设置 `hs_manage_bu_l2 = 'CDN产品'`，`PATCH /api/admin/roles/finbp_cdn`（`dryRun: true`）返回 HTTP 400 / `INVALID_ROLE` / `role_resolution_failed:finbp_cdn:row_policy_field_unresolved:unknown`。移除行级策略后返回 200。该列在 SQL Server 物理表和 Lucy 语义模型中均存在。

**根因（已用复现用例证明，非推测）：** 同读一份 Schema Manifest 的两条路径，对「schema 名」的处理不一致：

| 读取方 | 取 schema 的方式 | 读取路径 | 结果 |
|---|---|---|---|
| 源映射 `acl.ts:300` | `normalizeRef(basename(schemaFile))` → **小写化** | `glob("**/_schema/*.yaml")` 得到**磁盘真实文件名** | 命中 `BIDM.yaml` ✓ |
| 字段目录 `row-policy.ts` `loadPhysicalColumnsFromSchema` | 用上面已小写化的 `entry.schema` **拼路径** | `<semanticLayer>/<conn>/_schema/<schema>.yaml` → `bidm.yaml` | 大小写敏感文件系统上**不存在** ✗ |

清单读不到 → 物理列集合为空 → overlay 的普通列因「不在物理列集合中」被丢弃（`addProvenOverlayFields`）、计算列因 `isProvenRowLevelExpr` 依赖物理列也被丢弃 → `catalog.columns` 为空 → `bindRowPolicyField` 判定 `unknown`。

**为什么开发期看不到：** 本机 macOS / APFS 默认大小写不敏感，`bidm.yaml` 能命中 `BIDM.yaml`；客户环境是 Linux（大小写敏感），问题必现。仓库既有行策略测试全部使用小写 schema（`fin`），该路径从未被覆盖。

**复现步骤：** 用 vitest mock `node:fs/promises` 的 `readFile`，使其按**大小写敏感**语义判定文件名是否存在（macOS / APFS 默认大小写不敏感，直接跑会掩盖问题）；造一份 `_schema/BIDM.yaml`（含目标列）与同名 overlay，跑一次带 `scoped` 行级条件的角色编译。**同一内容仅清单文件名大小写不同**（大写 `BIDM.yaml` / 小写 `bidm.yaml`），结果从 `row_policy_field_unresolved:unknown` 变为可绑定，并可断言代码请求的是小写化路径。工作副本在 `inbox/2026-10-22-行级策略字段绑定诊断/`（`inbox/` 属 gitignore，不入库；持久复现步骤以本节与 §5.5 为准）。

**与本条的关系：** G5 是**存量缺陷**，不是 v2.5 新增能力——它必须在 v2.0 线修复，否则 v2.5 的行权限管理建在不可用的字段绑定之上。本条吸收它的**管理面要求**（R5）与**回归要求**（§9），修复本身的排期见 §11 D7。

**登记状态：** 已在机器可校验的缺陷台账 [`docs/qa/security-findings.yaml`](../qa/security-findings.yaml) 登记为 **D-03（P1 / open）**。2026-10-22 Forrest 裁决：**只登记不修，留给 v2.0 线排期**，本次不授权实现。因此本条**不宣称该缺陷已修复**，也不把它计入 v2.5 的能力范围。

---

## 2. 需求判断与边界

**判断**：行级策略是 Lucy 权限模型里唯一「按行裁剪数据面」的机制，也是当前唯一没有产品化管理面的权限层。表级授权、工具授权在治理台都有专门视图，行级授权只有一个逐表手填的表单，并且看不到配置后的实际行约束。这不是展示美化问题——**多 Role 行授权取并集**意味着配置看起来更严、实际却更宽，缺少最终行约束预览会直接导致越权投放。

**本期做**：把「行权限」从表单字段提升为可管理的对象——① 可复用的静态行策略模板；② 保存前的最终行约束预览；③ 按表反查的行权限视图；④ 行权限变更的配置审计。

**本期不做**（明确排除，见 §8 与 §10）：动态 / 按人 / 按 Token 的行策略；多租户隔离；数据库原生 RLS / CLS；新增权限代数；改动现有 `forced_filters` 注入路径；修改 KTX 源码；改变表级与工具级授权语义。

---

## 3. 能力范围

| 编号 | 能力 | 性质 | 是否改变运行时裁决语义 |
|---|---|---|---|
| R1 | 可复用静态行策略模板（命名引用） | 新增配置形态 | 否——编译成同一套 `RowPolicyAST` |
| R2 | 最终行约束预览（保存前 + 详情页） | 新增只读展示 | 否——复用 `compileFinalRowsBySource` 产物 |
| R3 | 行权限视图（按表反查） | 新增只读视图 | 否 |
| R4 | 行权限配置审计 | 新增审计事件 | 否 |
| R5 | 行级条件字段可诊断 | 改进错误信息 | 否——只补上下文，不改绑定语义 |

### 3.1 R1 可复用静态行策略模板

- 模板是**具名的静态谓词集合**，声明内容仅限：行级字段、比较符（`eq` / `in`）、字面量取值。
- 模板不引入取值来源：不允许宏、占位符、请求期表达式、环境变量或调用方 claim。取值只能与今天一样是编译期字面量。
- 挂载点仍是**角色上的表选择器**，不新增授权层级。
- 一个表选择器可同时声明「模板引用」与「附加手写条件」；两者在**同一 Role 分支内取 AND**（同一 `orArm`），跨 Role 仍取 OR（并集）。
- 引用不产生第二套权限代数：`row_policy` 仍只输出 `predicates` 形状，模板在编译期展开后与手写谓词并列进入同一个 `predicates` 数组。

### 3.2 R2 最终行约束预览

- 在保存行策略**之前**展示该表的最终行约束，而不是保存后才发现。
- 预览必须覆盖两层语义：**Role 之间的并集**（OR，可能放宽）+ **与 Agent 个人行限制的交集**（AND，收窄）。
- 预览结果与运行时注入使用**同一份编译产物**（`compileFinalRowsBySource` → `lookupFinalRows`），不允许管理台另算一套。
- 展示结构必须保持 DNF 形态：**任一分支满足其一**。不得把并集拍平成一条 AND 条件——那会让管理员看到比实际更严的约束，得出错误结论。

### 3.3 R3 行权限视图

- 以**表**为入口反查：哪些角色对该表设了行策略、每个角色的谓词内容、哪些 Agent 带个人行限制、该表的最终行约束摘要、是否处于「行权限：全部行」状态。
- 与 L25-08 访问关系图的分工：关系图是「谁授权了什么 / 谁访问了什么」的**全局横向**视角；行权限视图是「这张表的行到底受什么约束」的**单表纵向**视角。两者共用同一份编译产物，不重复实现两套数据口径。
- 视图只读，不提供在此处直接改策略的入口；改动仍从角色详情进入，避免出现第二条写入路径。

### 3.4 R4 行权限配置审计

- 记录：模板新增 / 修改 / 删除、角色行策略变更、引用与解引用。
- 每条记录含：actor、operationId、变更对象身份、变更前后摘要、影响面（受影响的表数 / Agent 数）、时间。
- 行权限变更属**配置审计**，不写入 L25-09 的问询运行时事件流；两者的事件模型与保留策略互不混用。

### 3.5 R5 行级条件字段可诊断

诊断报告第 3 条要求：字段无法解析时，返回具体连接、Schema、表和字段，便于定位。现状 `role_resolution_failed:<role>:row_policy_field_unresolved:unknown` 把**失败字段名整个丢掉**，管理员拿到的信息不足以定位。

- 失败原因必须带四元组：连接、Schema、表（sourceName）、字段名，外加失败阶段（`row_grant`）。
- 必须区分两类原因，不能都报 `unknown`：
  - **字段不存在**：该表确实没有这一列 → 拒绝，指向用户改条件。
  - **字段目录不可用**：清单未装载 / 清单文件不可读 / 该表无任何可用列（对应 §1.4 的 G5 缺陷）→ 拒绝，并明确提示「语义层清单未装载 / 不可读」，指向运维，而不是指向用户改条件。
- 该区分只增强诊断，**不放宽**任何绑定校验；两类的结果都是拒绝取数。

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
    effective = RowGrant{kind:"all"}
    for role in roles that allow this table:
        grant = compileRoleRowGrant(role, tableKey)     # 现状语义，含 §5.1 的模板展开
        if not grant.ok:
            return FAIL(grant.reason)                  # 任一 Role 编译失败 → 该表不可用
        effective = mergeRowGrants(effective, grant)   # 现状函数：OR；all 胜出

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

要点：`effectiveRowGrant` 是**并集**，可能比任何单个 Role 都宽。预览必须同时给出 `effectiveRowGrant` 与各 Agent 的 `finalRowsByAgent`，并保持 `orArms` 结构；**不得**把 orArms 拍平成一条 AND 条件后再展示。

### 5.3 保存前校验与预览（拟增）

```text
function saveRowPolicyDraft(draft, context):
    # context = { roles, templates, agents, tableKey, actor }

    # 1) 形状校验（现状 parseRowPolicyShape 扩展接受 template）
    shape = parseRowPolicyShapeWithTemplate(draft.rowPolicy)
    if not shape.ok:
        return REJECT(section="rowPolicy", reason=shape.reason)

    # 2) 模板引用存在性
    if shape.template is not None and context.templates[shape.template] is None:
        return REJECT(section="rowPolicy", reason="row_policy_template_unresolved")

    # 3) 字段绑定预检（现状 bindRowPolicyField，dry-run，不写盘）
    catalog = loadSourceFieldCatalog(connectionId, sourceName, schema)   # 现状
    for pred in shape.resolvedPredicates:
        bound = bindRowPolicyField(pred.field, sourceName, catalog)       # 现状
        if not bound.ok:
            return REJECT(section="rowPolicy", reason=bound.reason)

    # 4) 生成预览（复用 §5.2，不落盘）
    preview = computeFinalRowsForTable(tableKey, context.roles, context.agents)
    if not preview.ok:
        return REJECT(section="rowPolicy", reason=preview.reason)

    # 5) 写入（现状 admin/roles.ts 写入路径 + commitEffectivePolicy）
    persist(draft)
    await commitEffectivePolicy()        # 现状：重算 policyVersion 并原子换入

    # 6) 配置审计（拟增 R4）
    audit({
      actor: context.actor,
      operation: "row_policy.update",
      target: tableKey,
      beforeDigest: ..., afterDigest: ...,
      impact: { roles: N, agents: M }
    })
    return OK(preview)
```

要点：预览在**写入之前**生成（步骤 4 早于 5），不依赖写入后再回读；审计在生效后写，失败按既有 fail-closed 处理，不得因审计写失败而谎称已生效。

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

### 5.5 清单文件解析与失败归因（拟增，修复 §1.4 的 G5）

```text
function resolveManifestFile(schemaDir, schema):
    # schema 是源映射给出的小写化名；磁盘文件名可能保留原始大小写
    want = normalizeRef(schema)
    for entry in readdir(schemaDir):            # 与 catalog-reload / index 的做法一致
        if not entry.isFile(): continue
        if not (entry.name ends with ".yaml" or entry.name ends with ".yml"): continue
        if normalizeRef(entry.name without extension) == want:
            return path.join(schemaDir, entry.name)   # 用磁盘真实文件名
    return None                                   # 找不到 → 交由上层归因
```

配套的失败归因（写入 `row_grant` 阶段诊断）：

```text
function diagnoseFieldBinding(failure, source):
    # failure ∈ {unknown, measure, unsafe, shape, cross_source, no_catalog}
    if failure == "unknown":
        if source.catalogLoaded == false:
            return "row_policy_catalog_unavailable"   # 清单未装载/不可读 → 运维问题
        return "row_policy_field_unknown"              # 该表确实没有这一列 → 用户问题
    return failure                                     # 其余保持现状码
```

要点：归因**只影响错误信息的措辞**，不改变拒绝行为。修复后，「清单未装载」与「字段不存在」必须能被管理员区分——前者指向运维（§1.4 的 G5 场景），后者指向配置者。

---

## 6. 管理台交互

### 6.1 角色详情「行级策略（可选）」分区

- 保留现有逐表手填入口，改为**两种配置形态并存**：引用模板 / 直接写条件 / 两者并用。
- 每个受控表展示三项：已配置的模板名、内联条件数量、**最终行约束预览**（折叠展开可见完整 DNF 结构）。
- 预览区固定一句边界说明：多角色对同一张表的行授权**取并集**，并集可能比单个角色更宽；个人行限制在其上再收窄。
- 未配置任何行策略的表显示「行权限：全部行」。
- 模板下拉只列出**当前表字段可绑定**的模板：候选模板按「在目标表上字段可绑定」过滤；对目标表不可绑定的模板不隐藏，但标注「字段在此表不存在」，选择后在保存前给出明确阻断原因，不在保存时才报错。
- 模板被删除或改名后仍有引用时，配置页显示「引用缺失」并阻断保存，不静默丢弃条件。

### 6.2 行权限视图（按表反查）

- 入口：语义 / 连接侧已启用表的行权限入口，或治理台「访问治理」分组下的独立页；具体落点见 §11 D3。
- 列：表身份、角色行策略（角色名 + 谓词摘要）、涉及 Agent 与个人行限制、最终行约束摘要（按 Agent）、状态（全部行 / 受限）。
- 支持按角色、Agent、连接、是否受限筛选；支持键盘可达与表格视图（与 L25-08 的可达性要求一致）。
- 折叠或降级必须显式说明，不能用空表冒充「没有限制行」。

### 6.3 与 L25-01 摘要的复用

L25-01 要求 Agent 详情给出一句话（例如「行级策略按分公司」）。该句的数据来源就是本条的模板 / 行策略编译结果，两处必须同源、可对账，不得各自拼装。

---

## 7. 审计与可观测

| 事件 | 触发 | 关键字段 |
|---|---|---|
| `row_policy_template.create` / `.update` / `.delete` | 模板增删改 | 模板名、变更前后谓词摘要、影响引用数 |
| `row_policy.update` | 角色表选择器的行策略变更 | 表身份、变更前后 digest、模板名 / 内联条件变化、受影响 Agent 数 |
| `row_policy.reference.add` / `.remove` | 引用与解引用 | 表身份、模板名 |
| `row_policy.degrade` | 行策略编译失败导致降级 | 原因码、影响范围（现状策略降级事件口径） |

- 审计记录进入既有配置审计通道（与 L25-04「Skill 负责人变更」同一通道），不新增独立存储。
- 审计写入失败按现状 fail-closed 处理；不得先改配置再补审计而宣称已留痕。
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
| L25-11 语义资产批量维护 | 该条明确不改角色与行级策略；两条对象不同，若同批实施须避免同文件并发写入 |
| L25-10 Hive 直连 | 沿用既有 ACL 与行策略；本条不改变 Hive 适配的权限裁决路径 |

---

## 9. 验收矩阵

**全部用例当前未执行**。实施后按 V01–V18 逐条验证；任何一条未通过即不得宣称本能力可用。

| 编号 | 场景 | 期望 |
|---|---|---|
| V01 | 模板引用一条含 `eq` 的策略 | 编译成功；`RowGrant.kind=scoped`；`digest` 与直接写同条件时一致 |
| V02 | 模板引用一条含 `in` 的策略 | 同上；`values` 顺序不影响 digest |
| V03 | 模板 + 内联条件并存 | 同一 Role 分支内 AND；展开后 `predicates` 含两组条件 |
| V04 | 引用不存在的模板 | 编译失败，原因码 `row_policy_template_unresolved`；该表取数拒绝 |
| V05 | 模板字段在目标表不存在 | `row_policy_field_unresolved:unknown`；失败关闭 |
| V06 | 模板引用度量 | `row_policy_field_unresolved:measure`；失败关闭 |
| V07 | 模板谓词 `op` 非法 | `row_policy_op_forbidden`；失败关闭 |
| V08 | 同一表被两个角色授权（不同谓词） | 最终行约束预览显示 OR-of-AND；两个分支都在；不拍平成一条 AND |
| V09 | 两个角色中其一为「全部行」 | 并集结果为全部行；预览显示「行权限：全部行」，不得显示为受限 |
| V10 | Agent 带个人行限制 | 最终行约束 = 并集 ∧ 个人行限制；预览同时给出并集与交集两个结果 |
| V11 | 并集 ∧ 个人行限制后 DNF 剪枝为空 | 编译失败关闭；预览显示不可满足，不显示空约束 |
| V12 | 预览与运行时一致性 | 同一角色 / Agent / 表下，管理台预览的最终行约束与 `lucy_query` 实际注入的 `forced_filters` 等价 |
| V13 | 保存前预览 | 预览在写入前生成；预览失败时不落盘、不写审计 |
| V14 | 模板删除 | 被引用时删除被拒绝；未引用时可删；删除后引用方显示「引用缺失」并阻断保存 |
| V15 | 配置审计 | 模板增删改、角色行策略变更、引用变更各产生一条记录，含 actor 与前后摘要 |
| V16 | 策略摘要与版本 | 模板增删改后 `policyVersion` 变化；运行时换入生效，无需重启 |
| V17 | 受保护源工具闸门 | 引用形态下 `lucy_read_source` 等未包装通道仍按 `row_policy_requires_wrapped_tool` 拒绝 |
| V18 | 上游强制谓词未证明 | 引用形态下取数仍按 `row_policy_upstream_unproven` 拒绝；不得因新增模板而放宽 |
| V19 | **清单文件名为大写（如 `BIDM.yaml`）** | 在大小写敏感文件系统上，该表的合法行级字段可正常绑定；不再出现 `row_policy_field_unresolved:unknown`（§1.4 的 G5 回归） |
| V20 | 清单文件不可读 / 缺失 | 拒绝取数；错误归因为「字段目录不可用」，并带连接 / Schema / 表 / 字段四元组 |
| V21 | 字段确实不存在 | 拒绝取数；错误归因为「字段不存在」，与 V20 可区分，且四元组完整 |
| V22 | 同一 Role 在大写 schema 表上的行级条件 | 管理台预览与运行时注入的 `forced_filters` 等价（与 V12 同源校验，覆盖大写 schema 场景） |

---

## 10. Non-Claim 与不授权声明

- 本条**不授权**代码实现、测试编写、镜像构建、部署或发布；仅授权起草与登记。
- 设计与规划通过**不等于**运行时或客户交付通过；本文 §9 全部未执行。
- 不得对外宣称 Lucy 已具备「动态行级安全」「多租户隔离」「按人 / 按 Token 的行权限」。相关能力按冻结 ADR 保持冻结。
- 不得宣称模板引用已交付、已通过验收或已在客户环境运行。
- 本条不改变 Spec 99 / Spec 100 的运行时语义；若实现与这两份 Spec 冲突，以这两份 Spec 为准并先修订本文。
- §1.4 的 G5 是**存量缺陷**，本文只登记其根因、复现工件与回归要求，**不宣称已修复**；修复须另行批准、实施并验证（§11 D7）。
- 本条不改变「2.5 不把 Lucy 做成对话框、不动权限裁决与预算引擎」的边界；实施主体为 Lucy，不修改 KTX 源码；单实例 / 单副本边界不变。

---

## 11. 待裁决项

以下为起草时发现、需在评审时裁定的问题；本 Spec 已给出默认取向，但不代替裁决。

| 编号 | 问题 | 默认取向 | 影响 |
|---|---|---|---|
| D1 | 模板存放位置 | 与 `access.yaml` 同文件顶层 `row_policy_templates`。现状 `computeAccessConfigDigest` 按整份配置算摘要，同文件可自动进 `policyVersion`；写回路径 `toWrite = {...config}` 可保留未识别顶层键，但 `commitEffectivePolicy` 与配置审计须在实施时复核 | 影响配置写入与审计的实现范围 |
| D2 | 模板字段在部分表不存在 | 默认**失败关闭**（与内联条件一致）。备选是模板允许声明 per-source 字段映射 | 备选会引入第二套字段解析语义，风险较高 |
| D3 | 行权限视图落点 | 建议独立入口但复用同一编译产物；不并入 L25-08 关系图，避免一处改动牵动两页 | 影响导航与 IA |
| D4 | 模板取值来源 | 默认静态字面量，与今天一致；不引入语义层 segment、度量或任何动态取值 | 若允许 segment，会把「权限」与「业务口径」耦合，需另立 Spec |
| D5 | 模板删除策略 | 默认禁止删除仍被引用的模板，改为先解引用 | 影响配置审计与 UI 提示 |
| D6 | 与 L25-11 同批实施的写入冲突 | 若两者同期实施，行策略 / 模板写入与语义资产导入须串行化，避免同文件并发写 | 影响排期 |
| D7 | §1.4 的 G5 存量缺陷在哪个版本修复 | **已裁决（2026-10-22 Forrest）：只登记不修，留给 v2.0 线排期。** 缺陷已登记为 `security-findings.yaml` 的 **D-03（P1 / open）**；修复形态见 §5.5，回归用例见 V19–V22；本条不授权实现，也不宣称已修复 | 客户在 v2.0 修复前仍无法保存大写 schema 表的行级条件；**不得以改成「全部行」绕过**（会放宽数据可见范围） |

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

— 完
