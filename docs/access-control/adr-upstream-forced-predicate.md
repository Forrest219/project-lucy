# ADR — 上游强制谓词契约（AC-P1 Gate A）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 上游强制谓词契约 ADR |
| 文档类型 | ADR |
| 版本 | v0.2（Gate A 已批准） |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `design-upgrade.md` v1.1.2 ADR-AC-03/05/06；WO-60；Spec 98（AC-P0 只读基线）；开波锁定 O2；Gate A 审阅 P1-1/P1-2/P2 |
| 适用范围 | **WO-60 Gate A** 已批准；授权 WP-S1/S2 Spec/契约补丁。**不授权 runtime 实现**（须 Gate B） |
| 输出位置 | `docs/access-control/adr-upstream-forced-predicate.md` |
| 状态 | **Gate A 已批准（2026-08-09）** |

### 修订摘要

| 版 | 变更 |
|---|---|
| v0.1-draft | 初稿 |
| v0.2-draft | **P1-1** 收口 `lucy_freshness` / `lucy_explain_query`；**P1-2** NR↔BY 对齐并默认 deny；**P2** 钉死载体主路径 A + B 退出条件 |
| v0.2 | Gate A 批准；§0 措辞「取数路径一律 deny」 |
| v0.2.1 | 附录：KTX `forced_filters` 上游实现对齐证据（Gate C 项 1）；proven 仍须发布制品 + UAT |
| v0.2.2 | §10 边界修正：`kaelio/ktx` 非本项目；Gate C 项 1 改由 **Lucy** `filters[]` 前缀承载；不以 Kaelio 发版为 proven 前置 |

---

## 0. 状态与裁决

| 项 | 内容 |
|---|---|
| 状态 | **Gate A 已批准** |
| 本批准授权 | WP-S1 AC-P1 Runtime Spec、WP-S2 契约补丁与术语 |
| 本批准**不**授权 | 改 `acl.ts` / `mcp-proxy.ts` 等 runtime（须 **Gate B** Spec 评审通过后） |
| 冲突裁决 | 与 `design-upgrade.md` 冲突 → design-upgrade；与本 ADR 冲突的 Spec 草稿必须回修 |
| 禁止依据 | `feasibility-row-acl.SUPERSEDED.md` |

**一句话：** Proxy 不得把 `FinalRows` 当成「往用户 `filters` 里拼一段 SQL 字符串碰运气」；必须有**不可放宽**的上游组合语义，且在证明完成前对 `FinalRows ≠ TRUE` 的**取数路径一律 deny**（`lucy_explain_query` 合规本地诊断见 §2.1.1，不属取数路径）。

---

## 1. 背景与问题

AC-P1 要将 `row_access: scoped` + `row_policy` 变成运行时强制行授予。若强制谓词能被调用方用 OR、括号、别名、自连接、LEFT JOIN、聚合或 HAVING 放宽，则行策略形同虚设。

今日 `lucy_query` 路径会把 structured filters **规范化为上游 SQL 片段字符串**（见 `normalizeLucyFiltersForUpstream`）。该形态**不能**单独作为安全边界：自由字符串 `filters`、用户可控布尔组合、以及未包装 DataPlane 工具（无改写通道）都会破坏强制语义。

因此 ADR-AC-05 §4–§5 要求：上游强制谓词契约为开工门禁；未证明前 deny（`row_policy_upstream_unproven`）。

---

## 2. 决策（Normative）

### 2.1 唯一可注入通道

| 决策 | 内容 |
|---|---|
| **D-FP-01** | 对 `FinalRows(sourceKey) ≠ TRUE` 的受保护源，**唯一**允许执行取数的注入通道是：经 Lucy MCP Proxy **包装改写**、且本契约列出的工具路径（初版 = **`lucy_query` → 上游 `sl_query`**）。 |
| **D-FP-02（O2）** | 任意**未包装** DataPlane 工具（含 `entity_details`、`sl_validate`，以及未来未改写别名）在上述源上 **一律 deny**，reason = `row_policy_requires_wrapped_tool`。本波**不做**「先加包装再放行」。 |
| **D-FP-03** | `lucy_read_source`（改写为 `sl_read_source`）在 `FinalRows ≠ TRUE` 时 **deny**（同 `row_policy_requires_wrapped_tool` 或 Spec 登记的等价码）。整源读取**无法**承载本契约的强制谓词，不得特例放行。 |
| **D-FP-04** | `lucy_explain_query` / `lucy_freshness` 在工具分级上均为 **DataPlane**（`design-upgrade` 工具表；`acl.ts` `DATA_PLANE_TOOLS`）。**不得**因「不返回行」而降级为 Meta 或跳过本契约。scoped（`FinalRows ≠ TRUE`）行为见 **§2.1.1**（已钉死，禁止留给实现判断）。 |
| **D-FP-05** | 原生 `sl_query` / `sl_read_source` 等 AbsoluteDeny 保持 AC-P0 基线，不可配置解除。 |

#### 2.1.1 `lucy_freshness` / `lucy_explain_query` × 受保护源（P1-1 收口）

> **受保护源** = 该调用解析出的 `canonicalSourceKey` 满足 `FinalRows ≠ TRUE`。  
> 二者仍须先过 AC-P0 capability；无 capability → 既有 `capability_forbidden:…`。

| 工具 | 受保护源上的规范行为 | 禁止 |
|---|---|---|
| **`lucy_freshness`** | **一律 deny**，reason = `row_policy_requires_wrapped_tool` | 返回成功 freshness / 元数据包；任何「仅元数据故放行」的实现分支 |
| **`lucy_explain_query`** | **仅允许严格本地安全响应**（见下表）；**不是**取数成功路径 | 转发上游 / KTX；返回行、样例行、聚合结果；在未满足下表时返回「查询可通过」类成功 |

**`lucy_explain_query` 严格本地安全响应（须全部满足，否则 deny）：**

| # | 要求 |
|---|---|
| E1 | **零上游转发**：不得对 `sl_query` / `sl_read_source` 或其它上游工具发起 `tools/call` |
| E2 | **零行数据**：响应不得包含 result rows / sample rows / 聚合数值结果 |
| E3 | 响应必须包含：capability 裁决、`FinalRows` 是否非 TRUE、**ForcedPredicateAST 摘要**（或等价 digest） |
| E4 | 若 `upstream_forced_predicate_proven ≠ true`：响应必须标明**执行**路径将为 `row_policy_upstream_unproven`（explain 本地诊断仍可成功返回 E1–E3，但不得暗示「执行可取数」） |
| E5 | 客户端可读语义 =「权限/强制谓词诊断」，**≠**「数据已返回」 |

Gate C 必测：BY-17（freshness deny）、BY-18（explain：无上游 + 无行 + 含强制谓词摘要）。

### 2.2 FinalRows → 强制对象

```text
# 与 design-upgrade ADR-AC-03 一致；AC-P1 本波：
AgentConstraints(sourceKey) ≡ TRUE     # P1.5 之前；配置出现 constraints → 编译/lint 失败
TokenScope(sourceKey)       ≡ TRUE     # 本波不收紧

EffectiveRowGrant(sourceKey) = OR({ rowGrant(r, sourceKey) … })
FinalRows(sourceKey) =
    TRUE                              # 若 EffectiveRowGrant 为无限制（row_access=all / legacy）
  | ForcedPredicateAST                # 若为 scoped 合成后的结构化行授予
```

| 决策 | 内容 |
|---|---|
| **D-FP-06** | Proxy 必须将非 TRUE 的 `FinalRows` 编译为 **ForcedPredicateAST**（仅 `eq` / `in` 叶子；多 Role 行授予按 **OR** 合成），再映射为上游**强制载体**（见 §3）。 |
| **D-FP-07** | Overlay Segment、用户 `segments[]`、自然语言条件 **永不**自动成为 ForcedPredicateAST 的一部分（ADR-AC-05 §2）。 |
| **D-FP-08** | 强制载体与用户查询条件的组合语义必须为：**结果行集 ⊆ 强制谓词为真的行集**。任何可观察到的放宽路径 = 契约失败。 |

### 2.3 未证明口径

| 决策 | 内容 |
|---|---|
| **D-FP-09** | 在 §5「证明完成」之前，对任意 `FinalRows(sourceKey) ≠ TRUE` 的取数路径 **deny**，reason = `row_policy_upstream_unproven`。 |
| **D-FP-10** | **禁止**「先把谓词拼进用户 `filters` 字符串 / 上游 SQL 碰运气，再以后补证明」。无证明标志时不得存在成功取数路径。 |
| **D-FP-11** | 实现期可落地注入代码与单测，但 runtime **必须**在 `upstream_forced_predicate_proven ≠ true`（或等价闸门）时走 D-FP-09；Gate C bypass 矩阵全绿后才允许将证明标志置真（发版门禁）。 |

---

## 3. 上游强制载体（契约形状）

### 3.1 Gate A 钉死：主路径 A；备选 B 仅经退出条件

| 决策 | 内容 |
|---|---|
| **D-FP-12（主路径）** | Gate A **批准主路径 = 选项 A（专用强制字段）**。WP-S1 Spec **必须**按 A 撰写字段名、注入点、用户伪造剥离规则与上游外层 AND 语义；**不得**在无豁免时改选 B 或发明第三路径。 |
| **D-FP-13（备选退出）** | 选项 B（受控 AST / mandatory 节点）**仅**在满足 §3.1.1 全部退出条件并获联签后，方可替换 A 成为 Spec 主路径。 |

| 选项 | 描述 | 最低要求 |
|---|---|---|
| **A. 专用强制字段（Gate A 主路径）** | Proxy 改写后的 `sl_query` args 携带上游认可的特权字段（示意名：`forced_filters` / `security_predicates`；**确切名字由 Spec 与 KTX 对齐后写入 Spec，不得由 Builder 自拟安全语义**）。用户 args **不得**伪造或覆盖该字段。 | 上游保证：该字段在规划器中以 **外层 AND**（或等价）作用于最终行集，且不受用户 filter 树 OR/括号影响 |
| **B. 受控 AST 通道（备选）** | 上游接受非字符串的结构化 filter AST，并提供「security / mandatory」节点类型，仅 Proxy 可设置。 | 对 §4 NR-01…12 与 §5.1 BY-01…18 提供与 A **等价**覆盖 |

#### 3.1.1 从 A 退出到 B 的条件（须全部满足）

1. 书面证明：目标 KTX/上游版本在 Gate C 前**无法**交付 A 的外层 AND 特权字段；且  
2. 差距说明：列出 A 不可用的具体阻塞（版本、接口、排期）；且  
3. 等价证明计划：B 对 NR-01…12 与 BY-01…18 的覆盖不低于 A；且  
4. **产品 + 工程联签**写入本 ADR §9 或附录豁免记录。  

未满足 → Spec / 实现必须继续以 A 为目标；不得静默降级为「往用户 `filters` 拼接」。

**明确否决的伪载体：**

- 仅将强制条件 `AND` 进用户可控的 `filters` 字符串数组，而无上游特权语义；
- 依赖 Prompt / instructions 要求模型「自觉加 filter」；
- 依赖 VIEW / 物理 RLS，却在 Release notes 或运行时声称「已证明」但无 §5 矩阵证据（DB 原生 RLS 为本波 Non-Goal，**不得**冒充本契约证明）。

### 3.2 Proxy 改写不变量

对包装路径 `lucy_query` → `sl_query`：

1. 解析 args → 得到涉及的每个 `canonicalSourceKey`（多源 join 则**每个**源各自检查）。
2. 对每个源：先 capability（AC-P0），再 `FinalRows`。
3. 若任一源 `FinalRows ≠ TRUE` 且未证明 → `row_policy_upstream_unproven`。
4. 若已证明：注入强制载体；**剥离/拒绝**用户对强制字段的写入；再转发。
5. 用户 `filters` 仅可**额外收紧**，不可放宽强制载体。

---

## 4. 不可放宽语义清单（硬约束）

下列任一可导致「强制谓词为假的行仍返回」⇒ **契约失败**。  
**D-FP-14（默认 deny）：** 受保护源上，凡 Proxy **无法证明**强制谓词作用于全部基行的查询形态 → **默认 deny**（reason 建议 `row_policy_query_shape_forbidden` 或 `invalid_arguments:lucy_query:…`，由 Spec 钉死码表）。**不得**依赖「转发给上游碰运气不泄漏」。Gate C 对每条 NR 必须有对应 BY **显式断言**（见 §5.1 / §5.2）。

| ID | 攻击 / 退化 | 规范结果 | Gate C |
|---|---|---|---|
| NR-01 | 用户 `filters` 用 **OR** 包住或旁路强制条件 | 域外行不出现，或整查询 deny | BY-02 |
| NR-02 | **括号**重写布尔树 | **默认 deny**（Proxy 拒收带旁路风险的布尔/括号形态）；若未来允许，须证明行集仍 ⊆ 强制域 | BY-13 |
| NR-03 | **别名** / 限定符逃避字段绑定 | 强制谓词绑定 canonical 源字段；逃逸 → deny 或无泄漏 | BY-12 |
| NR-04 | **自连接** 用未约束别名读出行 | **默认 deny** | BY-14 |
| NR-05 | **LEFT JOIN** 引入未约束侧行 | **默认 deny**（或证明未约束侧不扩大受保护源可见行——AC-P1 初版选 deny） | BY-12 |
| NR-06 | **聚合 / HAVING** 先聚合再过滤导致放宽 | **默认 deny** | BY-15 |
| NR-07 | 自由**字符串** `filters`（SQL 片段） | **deny**（§4.1） | BY-03 |
| NR-08 | 未审计 **ad-hoc** `measures[].expr` | **deny**（§4.1） | BY-04 |
| NR-09 | **子查询** / 嵌套查询逃避 | **默认 deny**（不采用「证明子查询出口」作为初版出路） | BY-16 |
| NR-10 | 未包装工具 / `lucy_read_source` | deny：`row_policy_requires_wrapped_tool` | BY-06/07 |
| NR-11 | `lucy_freshness` × 受保护源 | deny：`row_policy_requires_wrapped_tool` | BY-17 |
| NR-12 | `lucy_explain_query` 违反 E1–E5 | deny；合规本地诊断见 §2.1.1 | BY-18 |

### 4.1 受保护源上的 args 形状（`lucy_query`）

**受保护源** = 该次调用解析出的某个 `canonicalSourceKey` 满足 `FinalRows ≠ TRUE`。

| 类别 | 允许 | 禁止 |
|---|---|---|
| `filters` | 仅 structured 对象：`{ field, op, value\|values }`；`op` 为上游/Proxy 已允列表的**用户侧**算子（可与权限 op 不同，如 `contains`）；对象之间仅隐式 **AND**（不接受用户 OR/括号树） | 任意非空字符串 filter；OR/括号布尔树；可解析为原始 SQL/旁路的形状；用户写入强制字段 |
| `measures` | 语义层已登记的 measure **字符串 key** | `{ expr, … }` ad-hoc 表达式（未审计）；等价逃逸表达式 |
| `dimensions` / `order_by` | `{ field }` 对象数组，字段为安全语义引用 | 裸字符串数组（沿用现网 guardrail）；不安全 field |
| `segments` | 仅便利筛选；**不**替代 `row_policy` | 把 Segment 当行权限 |
| `query` / `sql` / raw | — | 一律拒绝（既有 `raw_query_forbidden`） |
| 自连接 / LEFT JOIN / 聚合+HAVING / 子查询 | — | **默认 deny**（D-FP-14）；Spec 列出可检测信号 |
| 多源 | 每个源均有 capability；每个 `FinalRows≠TRUE` 的源均注入对应强制谓词；初版若无法对多源证明基行约束 → **deny** | 任一源缺强制或未证明 |

`FinalRows = TRUE`（`row_access: all`）的源：保持 AC-P0 查询 guardrail，**不**适用本节「受保护源」加严项（仍禁止 raw SQL 等既有规则）。

### 4.2 权限谓词 op（配置侧）

与 ADR-AC-05 / D9 一致：`row_policy` 叶子 op **仅** `eq` | `in`。`ne` 与范围比较不进入本波。

---

## 5. 「证明完成」定义（Gate C 硬证据）

契约在同时满足时视为 **proven**（方可置 `upstream_forced_predicate_proven`）：

1. **书面闭合：** 本 ADR 已批准；AC-P1 Spec 按 **主路径 A**（或经 §3.1.1 联签的 B）钉死字段/节点名、包装工具集、deny 码表。  
2. **KTX/包装路径对齐：** 载体在目标上游版本上有明确外层 AND（或等价）语义（文档或可引用实现注释），与 §4 NR 不矛盾。  
3. **Bypass 矩阵全绿**（§5.1 **BY-01…18 全部**）：自动化测试 + 必要时手工抽检；每条 NR 在 §5.2 有映射。  
4. **Release notes** 未声称 Dynamic RLS / 多租户隔离 / DB 原生 RLS 已交付。

**不必**等待数据库原生 RLS。证明对象是 **Proxy 包装路径 + 上游强制载体**，不是存储引擎 RLS。

### 5.1 Bypass 矩阵最低条目（AC-SEC-ROW / BYPASS）

| ID | 场景 | 期望 |
|---|---|---|
| BY-01 | `lucy_query` × 受保护源，无用户 filter | 仅返回强制谓词内行 |
| BY-02 | 用户 filter **OR** 试图并入强制域外值 | 域外行不出现；或整查询 deny |
| BY-03 | 用户提交**字符串** `filters` | deny（受保护源） |
| BY-04 | 用户提交 ad-hoc `measures[].expr` | deny（受保护源） |
| BY-05 | 用户 args 夹带伪造 `forced_*` 字段 | 忽略或 deny；不得削弱 Proxy 注入 |
| BY-06 | `entity_details` / `sl_validate` × 受保护源 | `row_policy_requires_wrapped_tool` |
| BY-07 | `lucy_read_source` × 受保护源 | `row_policy_requires_wrapped_tool`（或等价） |
| BY-08 | 直接 `sl_query` | AbsoluteDeny（AC-P0 回归） |
| BY-09 | 契约未证明标志关闭时 `lucy_query` 取数 | `row_policy_upstream_unproven`（即使注入代码存在） |
| BY-10 | 多 Role **OR** 行授予：A 允区域=东，B 允区域=西 | 东∪西可见；不得变成东∩西 |
| BY-11 | 多源 join：一源 scoped、一源 all | scoped 侧强制生效；缺能力证明则 **deny**（初版） |
| BY-12 | LEFT JOIN / 别名试图读出强制域外行 | **deny**（AC-P1 初版；D-FP-14） |
| BY-13 | **括号** / 布尔树重写试图旁路强制条件 | **deny**（NR-02） |
| BY-14 | **自连接**未约束别名 | **deny**（NR-04） |
| BY-15 | **聚合 / HAVING** 可能导致基行放宽 | **deny**（NR-06） |
| BY-16 | **子查询** / 嵌套查询 | **deny**（NR-09） |
| BY-17 | `lucy_freshness` × 受保护源 | `row_policy_requires_wrapped_tool`（NR-11） |
| BY-18 | `lucy_explain_query` × 受保护源 | 满足 E1–E5 的本地诊断可成功；违反任一 → deny；**断言无上游调用、无行数据、含 ForcedPredicateAST 摘要**（NR-12） |

未列入但导致行集放宽的新路径 → 证明失效，必须撤回 proven 标志。

### 5.2 NR → BY 覆盖表（P1-2）

| NR | BY | 初版默认 |
|---|---|---|
| NR-01 | BY-02 | 无泄漏或 deny |
| NR-02 | BY-13 | **deny** |
| NR-03 | BY-12 | **deny** / 无泄漏 |
| NR-04 | BY-14 | **deny** |
| NR-05 | BY-12 | **deny** |
| NR-06 | BY-15 | **deny** |
| NR-07 | BY-03 | **deny** |
| NR-08 | BY-04 | **deny** |
| NR-09 | BY-16 | **deny** |
| NR-10 | BY-06, BY-07 | **deny** |
| NR-11 | BY-17 | **deny** |
| NR-12 | BY-18 | 合规 explain 或 **deny** |

---

## 6. Deny reason 登记（供 Spec 07 / 98→99 引用）

| reason | 何时 | 本 ADR |
|---|---|---|
| `row_policy_upstream_unproven` | `lucy_query` 取数且 `FinalRows ≠ TRUE` 且证明未完成 / proven 标志为假 | D-FP-09…11 |
| `row_policy_requires_wrapped_tool` | 未包装工具、`lucy_read_source`、`lucy_freshness` 等非注入通道触及受保护源 | D-FP-02/03；§2.1.1 |
| `row_policy_query_shape_forbidden` | 受保护源上括号/自连接/LEFT JOIN/聚合·HAVING/子查询等（D-FP-14；码名 Spec 可等价） | §4 NR-02/04/05/06/09 |
| `capability_forbidden:…` | AC-P0 既有 | 先于行策略 |
| `raw_query_forbidden` | raw SQL | 既有 |
| （Spec 细化）`invalid_arguments:…` | 受保护源禁止的 args 形状 | §4.1 |

AC-P0 预留码不得在 P0 成功路径出现；P1 Spec 将其标为正式成功/失败路径。

---

## 7. 与 WO-60 / 波次边界

| 在范围内 | 不在范围内 |
|---|---|
| 强制谓词契约、证明定义、args 禁令、O2 fail-closed | Agent Constraints / TokenScope 收紧（P1.5） |
| `eq` / `in` 权限 op | `ne` / 范围 op |
| `lucy_query` 取数注入；explain 本地诊断；freshness scoped deny | DB 原生 RLS、Dynamic claim、Active Role、CLS |
| Gate C bypass BY-01…18 作为证明 | 依据 SUPERSEDED 行级文 |
| 载体主路径 A + B 退出条件 | Spec 自行改选载体而无联签 |

---

## 8. Gate A 评审检查表

- [x] §2 决策与 WO-60 锁定 O2 / 无 P1.5 一致  
- [x] **P1-1：** §2.1.1 已收口 freshness=deny、explain=严格本地 E1–E5；无实现空缺  
- [x] **P1-2：** §5.2 NR→BY 完整；BY-13…16 默认 deny 可测  
- [x] **P2：** §3.1 主路径 A 已钉死；B 仅经 §3.1.1 退出  
- [x] §3 伪载体已否决  
- [x] §4 不可放宽清单 + 受保护源 args 形状闭合  
- [x] §5 证明定义可操作；不依赖 DB RLS；BY-01…18  
- [x] §6 deny 码无歧义（含 freshness / query_shape）  
- [x] 确认：**批准本文 ≠ 批准改 runtime**；下一步为 WP-S1/S2 Spec  
- [x] **产品 / 工程签字批准 Gate A**

---

## 9. 批准记录

| 项 | 内容 |
|---|---|
| 批准人 | xingchen |
| 批准日期 | 2026-08-09 |
| 备注 | 确认主路径 = 专用强制字段（A）；未证明取数路径 fail-closed；O2 未包装工具 scoped deny。**仅授权 WP-S1/S2 Spec/契约补丁，不授权 runtime。** |

---

## 10. 附录：强制谓词载体（Gate C 项 1，2026-08-09；v2 边界修正）

| 项 | 状态 |
|---|---|
| 责任边界 | **`kaelio/ktx` 非本项目**；不向 Kaelio 提交/发 npm。契约在 **Lucy** 闭合 |
| 字段名 | Proxy 仍写 `forced_filters`（审计 / 前向兼容；bundled 0.16.0 MCP schema 会丢弃未知键） |
| Lucy 生效路径 | 已绑定谓词安全编译后 **prepend** 到上游 `filters[]`；KTX 对 filters 做 AND |
| field 绑定 | 仅安全 `source.column`；unsafe 片段拒绝 emit（见 evidence） |
| 旁路防护 | 受保护源 shape gate：禁止用户字符串 filters / OR 布尔树 |
| 自动化证明 | [`evidence-ktx-forced-filters.md`](evidence-ktx-forced-filters.md)；`row-policy-ac-p1` + `mcp-proxy-row-policy-by01-by18` |
| proven | Gate C **已总签**（2026-08-09）；默认仍 false，置真为运维变更（**不**以 Kaelio 发版为前置） |

本附录满足 ADR §5「包装路径对齐」的 **Lucy 侧**证据门槛；**不**单独构成 Gate C 总签或 proven 置真。

— 完
