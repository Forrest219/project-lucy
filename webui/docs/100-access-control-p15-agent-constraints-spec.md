# AC-P1.5 Runtime Spec — Agent Constraints / FinalRows AND

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1.5 Runtime Spec（Agent Constraints） |
| 文档类型 | Spec |
| 版本 | v0.1.1（Gate B **已批准** 2026-08-09；digest 保留值语义；不可满足臂剪枝） |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-control/design-upgrade.md` v1.1.2 ADR-AC-03 D2 / S4；[`WO-61`](../../docs/access-control/plans/wo-202608-61-access-control-p15-agent-constraints.md) **v1.3**（Gate A DONE；WP-S0/S1 DONE）；Spec 98 / Spec 99；[`adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md) |
| 适用范围 | AC-P1.5 **Agent Constraints 配置 / FinalRows AND 合成 / digest / 规模上限**的实现事实源；**Gate B 已批准 → 授权 WP-I\* runtime**；复用 AC-P1 强制谓词载体 |
| 输出位置 | `webui/docs/100-access-control-p15-agent-constraints-spec.md` |
| 冲突裁决 | 与 `design-upgrade.md` / Gate A ADR 冲突 → **design-upgrade / ADR**，并回修本文；实现与本文冲突 → 本文；与 Spec 99 冲突时以本文对 Constraints/FinalRows AND 的增量为准，其余行授予 OR / 注入规则仍以 Spec 99 为准 |
| 关联 WO | WO-202608-61；Gate A DONE；**Gate B DONE（2026-08-09）** → WP-I\* |
| 契约补丁 | Spec 07 v1.6 / 14 v0.4 / 15 v0.4 + 术语标准（WP-S1）；`lint:spec` 翻转随 Gate B 后 WP-I1 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New / 扩展 terms（须已登记于术语标准 §3 与 §4.8）：

| Canonical Term | UI 主术语 | 禁止混淆 |
|---|---|---|
| Agent Constraints | Agent 强制约束 | Role 间 AND、Row Grant OR（混称）、TokenScope |
| Final Rows | 最终行约束 | 仅 Role 并集、仅用户 filter |
| Effective Row Grant | 有效行授予 | FinalRows（混称）、Role 间 AND |
| Forced Predicate | 强制谓词 | 拼进用户 filters 的 SQL 字符串 |

Forbidden terms / 文案：

- 不得将 AC-P1.5 宣称为「Dynamic RLS / 多租户隔离 / DB 原生 RLS / TokenScope 行收紧已交付」
- Admin **禁止**展示「Constraints 已配置即取数已生效」而未经注入 / proven
- 不得暗示多 Role 会自动对人级行集做 AND

Protected DOM terms（`translate="no"` + `notranslate`）：既有 Spec 98/99 集合，另加 `constraints`、`AgentConstraints`、`FinalRows`、本 Spec 裁决码全文。

---

## 1. 背景与定位

### 1.1 指针关系

| 主题 | Spec 99（AC-P1） | 本文（AC-P1.5） |
|---|---|---|
| Capability / Tool Class / Canonical Key / 编译提交 / 降级 | 继承 Spec 98 | 不回退 |
| `row_access: scoped` + `row_policy` / EffectiveRowGrant **OR** | **仍权威** | 不改变 OR |
| `AgentConstraints` / Agent `constraints` | 出现即 fail（SC-P1-06） | **合法形态**见本文；Role 上仍 **forbidden** |
| `TokenScope` | ≡ TRUE | **本波仍 ≡ TRUE**（Non-Goal） |
| `FinalRows` | ≈ EffectiveRowGrant（Constraints≡TRUE） | `EffectiveRowGrant AND AgentConstraints` |
| 强制谓词 / `forced_filters` / O2 / proven | **仍权威** | 复用；Constraints 只扩展 FinalRows 输入 |

### 1.2 本文范围

1. Agent `constraints` schema 与编译（含字段绑定复用 Spec 99 §3.2）  
2. `FinalRows` **AND** 合成的 **DNF 规范化**、digest、**精确整数上限**、矛盾/空集口径  
3. 闸门：受保护源定义随 FinalRows；注入 / deny 码复用 Spec 99，另增 Constraints 编译失败码  
4. Admin：Agent 侧 Constraints；Role 侧禁止  
5. SC-P15-\* / 示例 / lint 节奏 / Gate B 检查表  

### 1.3 成功标准（WO SC-P15-\*）

| ID | 标准 | 本文 | 测试 |
|---|---|---|---|
| SC-P15-01 | 两 Role OR 为 TRUE 时 Constraints 可收紧为非 TRUE | §5 / §8.1 | U-CONSTR-OR-TIGHTEN / S4 |
| SC-P15-02 | 缺省 Constraints≡TRUE，无回归 AC-P1 | §5.1 | P1 回归 |
| SC-P15-03 | 合法 constraints 可编译；非法 op / 字段 / 无 capability 源失败 | §3 / §4 | U-CONSTR-COMP |
| SC-P15-04 | Role 出现 `constraints` → 仍拒绝 | §3.3 / §11 | lint + 编译 |
| SC-P15-05 | FinalRows≠TRUE → 包装注入；未包装 → `row_policy_requires_wrapped_tool` | §7 | AC-SEC-CONSTRAINT |
| SC-P15-06 | 未证明 → `row_policy_upstream_unproven` | §7 | BY-09 回归 |
| SC-P15-07 | 收窄失败语义继承 AC-P0/P1 | Spec 98 §8 | U-REL |
| SC-P15-08 | Release notes 未声称 Dynamic RLS / TokenScope 行收紧 | §10 | 文档评审 |
| SC-P15-09 | DNF / digest / **精确上限** / 超限 compile fail 已钉死 | §5 / §6 / §8 | U-CONSTR-DNF / U-CONSTR-LIMIT |

---

## 2. Non-Goals

| 非目标 | 说明 |
|---|---|
| **TokenScope 收紧** | **本波明确不交付**；`TokenScope(sourceKey) ≡ TRUE`；另立 WO / AC-P2+。配置模型**不**引入 token 级行谓词字段 |
| **Role 级 `constraints`** | **forbidden**：Role（`roles.*`）出现 `constraints` → lint fail + 编译失败（与 Agent 合法形态无关） |
| `ne` / 范围比较 op | 另批 |
| DB 原生 RLS / Dynamic claim / Active Role / CLS | AC-P2+ |
| 重开上游强制谓词载体选型 | 仍以 Gate A ADR 主路径 A（`forced_filters`）为准 |
| 依据 SUPERSEDED 行级文 | 禁止 |
| Gate B 前改 runtime | **已过时**：Gate B 已于 2026-08-09 批准；本条仅作历史约束记录 |
| 浏览器 E2E | 默认不做（DEVELOPMENT） |

---

## 3. 配置模型（AC-P1.5 合法增量）

```text
Agent (users[])
  ├── roles: [...]
  ├── constraints?: AgentConstraintsConfig   # 本波合法；缺省 = 无约束
  └── tokens[]                               # 仅鉴权；无行收紧字段（TokenScope Non-Goal）

AgentConstraintsConfig =
  { sources: ConstraintSourceBinding[] }     # 数组可空？→ 禁止：若键出现则 sources 非空

ConstraintSourceBinding =
  { connection: string
  , schema?: string
  , names: string[]                          # 非空；禁 prefix
  , predicates: Predicate[]                  # 非空；元素之间 AND
  }

Predicate =                                  # 与 Spec 99 RowPolicy 叶子同构
  { field: FieldRef
  , op: "eq" | "in"
  , value?: scalar                           # eq
  , values?: scalar[]                        # in；非空
  }

Role
  └── constraints?: …                        # FORBIDDEN（任何出现即失败）
```

### 3.1 合法示例

```yaml
users:
  - id: bp_alice
    name: Alice
    roles: [finance_cost_abc, finance_cost_all]
    constraints:
      sources:
        - connection: demo-mysql
          schema: dataforai
          names: [fact_cost]
          predicates:
            - field: dept
              op: in
              values: [ABC]
```

含义：即使两 Role 对 `fact_cost` 的 rowGrant OR 后为 TRUE，Alice 仍被收紧为 `dept ∈ {ABC}`。

### 3.2 非法示例（编译 / lint 失败）

| 形态 | 失败码（规范名） |
|---|---|
| Role 上出现 `constraints` | `constraints_forbidden_on_role` |
| Agent `constraints` 非 object / 缺 `sources` / `sources` 空 | `constraints_invalid_shape` |
| binding 缺 `names` / `names` 空 / 出现 `prefix` | `constraints_invalid_shape` |
| `predicates` 空或 `op` ∉ {eq,in} | `constraints_invalid_shape` |
| `field` 未知 / measure / 非行级（同 Spec 99 §3.2） | `row_policy_field_unresolved` |
| binding 命中源不在该 Agent 任一 Role 的 DataPlane capability 中 | `constraints_source_not_in_capability` |
| 超过 §6 任一精确上限 | `final_rows_limit_exceeded` |
| 静态不可满足（§5.4） | `final_rows_unsatisfiable` |

### 3.3 Role `constraints` forbidden（SC-P15-04）

- `access.yaml` → `roles.<id>.constraints`：**一律** lint fail + Role/Agent 编译失败  
- Role Admin：**不提供** Constraints 编辑器；保存路径若见到该字段 → 拒绝并明示  
- **不得**将 Role `constraints` 解释为「未来兼容字段而忽略」

### 3.4 字段绑定

`constraints.sources[].predicates[].field` **完整复用** Spec 99 §3.2（行级目录；禁 measure；多 `names` 时每一源均须可解析）。失败码同 `row_policy_field_unresolved`。

---

## 4. 编译：AgentConstraints(sourceKey)

对每个 `canonicalSourceKey`：

```text
MatchedBindings(sourceKey) =
  { b ∈ constraints.sources | sourceKey ∈ SourcesResolved(b) }

若 Agent 无 constraints 键:
  AgentConstraints(sourceKey) ≡ TRUE

否则:
  若存在 b 使 SourcesResolved(b) 与 capability 源集无交 → 编译失败 constraints_source_not_in_capability
  （每个 b 的每个 name 必须落入该 Agent EffectiveDataCapabilities 的某 source）

  Predicates(sourceKey) = ⋃_{b ∈ MatchedBindings} b.predicates   # 多重 binding → AND 合并
  若 Predicates(sourceKey) 为空（该源未被任何 binding 命中）:
    AgentConstraints(sourceKey) ≡ TRUE
  否则:
    AgentConstraints(sourceKey) = AND(Predicates(sourceKey))   # 单一 AND 组；非 OR
```

`SourcesResolved(b)`：按 Spec 98 canonical key 规则解析 `connection` / `schema` / `names`；`names` 多源时 predicates 必须对**每一个**命中源可绑定（同 Spec 99 §3.2）。

---

## 5. FinalRows = EffectiveRowGrant AND AgentConstraints（DNF）

### 5.1 产品代数（Normative）

```text
EffectiveRowGrant(sourceKey) = OR(RoleArms) | TRUE     # Spec 99；不变
AgentConstraints(sourceKey)  = AND(Preds) | TRUE       # §4
TokenScope(sourceKey)        ≡ TRUE                    # 本波 Non-Goal；禁止实现收紧

FinalRows(sourceKey) =
    TRUE
      if EffectiveRowGrant = TRUE ∧ AgentConstraints = TRUE
  | AgentConstraints
      if EffectiveRowGrant = TRUE ∧ AgentConstraints ≠ TRUE
  | EffectiveRowGrant
      if EffectiveRowGrant ≠ TRUE ∧ AgentConstraints = TRUE
  | DnfExpand(EffectiveRowGrant, AgentConstraints)
      if 二者均 ≠ TRUE
```

### 5.2 DNF 展开（Normative；禁止第二种热路径语义）

设：

- Role OR arms：`R_1, …, R_n`（每个 `R_i` 为 AND 谓词组；来自 Spec 99 `orArms`）
- Constraints AND 组：`C = (c_1 ∧ … ∧ c_m)`

则：

```text
DnfExpand = ∨_{i=1..n} (R_i ∧ C)
```

编译期**必须**物化为显式 DNF 叶子集（每个 arm = AND 叶子列表；叶子仅 `eq`/`in`）。  
**禁止**在热路径保留「外层 OR、外包一层 AND」却按另一套求值顺序解释。

吸收律（规范化时应用）：

| 输入 | 结果 |
|---|---|
| `TRUE ∧ C` | `C`（单 arm） |
| `R ∧ TRUE` | `R`（保持原 OR arms） |
| `TRUE ∧ TRUE` | `TRUE` |

### 5.3 注入形态

`FinalRows ≠ TRUE` 时，ForcedPredicateAST / `forced_filters` 载荷与 Spec 99 一致：

```text
{ or: [ { and: [ leaf, ... ] }, ... ] }
```

每个 DNF arm 对应一个 `{ and: [...] }`。叶子 `field` 使用已解析的 `sourceName.field`（同 Spec 99）。

### 5.4 矛盾 / 空集口径（Normative）

> **产品选择（收紧语义）：** 展开后对**不可满足的单个 DNF arm 予以删除**；若删除后仍至少保留一臂 → **编译成功**，FinalRows = 剩余臂的 OR。  
> **仅当**剩余臂集合为空（或 Constraints 单独 `C` 不可满足、或 EffectiveRowGrant=TRUE 时 `C` 不可满足）→ **编译失败** `final_rows_unsatisfiable`。  
> **不采用**「恒假 empty predicate 仍编译成功 / `runtimeAck: true`」。  
> **不采用**「任一臂不可满足即整 Agent fail」（会阻断 East∨West 被 Constraints 收紧为 East 的自然收窄，见 §9.5）。

本波**必须**检测的不可满足模式（同字段、已解析稳定字段标识；**值比较保留大小写与类型**，见 §8.1）：

| 模式 | 示例 |
|---|---|
| 两个 `eq` 字面量互斥 | `dept eq A` ∧ `dept eq B`（A≠B，按 JSON 标量严格相等） |
| `eq` 与 `in` 无交 | `dept eq A` ∧ `dept in [B,C]` |
| 两个 `in` 交集为空 | `dept in [A]` ∧ `dept in [B]` |
| 单条 `in` 的 `values` 去重后为空 | 非法 shape（亦属 `constraints_invalid_shape` / row_policy shape） |

检测与处置顺序：

1. 单独的 Constraints AND 组 `C` 不可满足 → **立即** `final_rows_unsatisfiable`（无臂可保留）  
2. 单独的任一 Role arm `R_i` 在 P1 已不可满足 → 保持 P1 拒绝（Role 编译失败）  
3. 展开 `R_i ∧ C`：删除不可满足臂；若剩余 ≥1 → 成功；若剩余 0 → `final_rows_unsatisfiable`  
4. 删除臂**不是**「截断以规避上限」：上限仍按 §6 在剪枝**前**计数（防用矛盾臂刷爆后再剪枝绕过）；剪枝后 `or.length` 用于注入与 digest  

**不要求**本波做 SMT / 跨字段定理证明；未列入上表的复杂情形不强制判定为不可满足。

---

## 6. 精确整数上限（Normative — 非 suggested）

以下常数为 **AC-P1.5 编译期硬上限**。实现必须使用下列精确值；变更须改本 Spec 并重新 Gate B。

| 常数 | 符号 | 值 | 计数对象 |
|---|---|---|---|
| 每源 Role OR arms 上限 | `MAX_ROLE_ARMS_PER_SOURCE` | **16** | `EffectiveRowGrant` 在该 `sourceKey` 上的 OR arm 数；`TRUE` 不计 arm（走吸收律） |
| 每源 Constraints predicates 上限 | `MAX_CONSTRAINT_PREDICATES_PER_SOURCE` | **16** | `Predicates(sourceKey)` 合并后的叶子数 |
| 每 DNF arm predicates 上限 | `MAX_PREDICATES_PER_DNF_ARM` | **32** | 每一物化臂 `R_i ∧ C`（或吸收后的单臂 `C` / `R`）内叶子数 |
| 每源展开后 DNF arms 上限 | `MAX_DNF_ARMS_PER_SOURCE` | **64** | `∨_i (R_i ∧ C)` **剪枝前**的 arm 数（`FinalRows=TRUE` 时为 0，不检查） |
| 每源展开后 predicates 总数上限 | `MAX_DNF_PREDICATES_TOTAL_PER_SOURCE` | **512** | 所有 DNF arms 叶子数之和（**剪枝前**） |

**超限行为（Normative）：**

- 任一上限在编译该 Agent 时被突破 → **编译失败**  
- 失败码：`final_rows_limit_exceeded`（dryRun / 保存 / 外部 YAML 重载同语义）  
- **禁止**截断 arms、抽样 predicates、或静默丢弃后放行  

计数时机：字段绑定成功之后、写入 EffectivePolicy 之前；按 **每个 sourceKey** 独立计数。

---

## 7. 闸门与强制谓词（复用 Spec 99）

`FinalRows(sourceKey) ≠ TRUE` ⇒ 该源为**受保护源**（定义同 Spec 99 §5.1，输入改为本文 §5）。

| 行为 | 规范 |
|---|---|
| `lucy_query` 取数 | 注入 `forced_filters` ← 本文 DNF；剥离用户写入的 `forced_filters` |
| 未包装 / `lucy_read_source` / `lucy_freshness` 等 | `row_policy_requires_wrapped_tool` |
| `lucy_explain_query` | 本地 E1–E5；摘要须能反映 Constraints 参与后的 FinalRows digest |
| `upstream_forced_predicate_proven ≠ true` | `row_policy_upstream_unproven` |
| O2 / args 形状 / AbsoluteDeny | 不回退 Spec 99 / 98 |

**禁止**为 Constraints 另开字符串拼接或第二注入通道。

---

## 8. Digest 归一化（Normative）

### 8.1 叶子规范化

每个叶子序列化为规范对象后再参与排序与哈希：

```text
NormLeaf =
  { sourceName: identNorm(resolvedSourceName)  # 稳定标识符：trim + case fold（与 normalizeRef 一致）
  , field:      identNorm(resolvedField)       # 同上；仅标识符
  , op:         "eq" | "in"
  , value?:     TypedScalar                    # eq：见下；禁止对 string 做 case fold / trim
  , values?:    TypedScalar[]                  # in：见下
  }

TypedScalar =
  { t: "string" | "number" | "boolean"
  , v: <JSON 标量原值>                         # string：保留原始码点序列（含大小写与首尾空格）
  }
```

**值侧硬规则（Normative）：**

- 行过滤 `value` / `values` **不是**标识符；`ABC` 与 `abc`、`"x"` 与 `"x "` 在大小写/空白敏感源上可为不同行集，**必须**产生不同 digest。  
- **禁止**对 string 值做 `lowerTrim` / `normalizeRef` / Unicode case fold。  
- `number` / `boolean` 保留 JSON 类型（`1` ≠ `"1"`）。  
- `values`：拷贝 → 转为 `TypedScalar[]` → 按 `(t, canonicalEncode(v))` **稳定排序** → 去重（同型同值）；去重后空 → shape 失败。  
- 禁止把未解析的原始 `field` 字符串写入 digest。  

**与 AC-P1 实现差异（刻意）：** 现网 `rowGrantDigest` 对 `in` 的 string 值调用了 `normalizeRef`（`row-policy.ts`），与 `eq` 保留原值不一致。**FinalRowsDigest 不得沿用该 `in` 折叠**；WP-I 实现 FinalRows digest 时以本文为准。P1 Role 级 `rowGrantDigest` 是否对齐属实现清理，不阻断本 Spec Gate B，但不得把折叠写回 FinalRows。

### 8.2 Arm / FinalRows digest

```text
NormArm   = sortedBy(NormLeafKey, leavesInArm)     # 键含 TypedScalar 编码
NormDnf   = sortedBy(ArmCanonicalJson, NormArm[])  # 臂与臂之间按 arm 的 canonical JSON 排序
FinalRowsDigest(sourceKey) =
  TRUE  → 固定标记 "TRUE"
  其他  → sha256(utf8(JSON.stringify(NormDnf))).hex[0:16]
         # NormDnf = §5.4 剪枝后的 DNF
```

说明：

1. **输入是物化并经 §5.4 剪枝后的 DNF**，不是「Role digest 列表 + Constraints digest」的松散拼接。  
2. 风格对齐 Spec 99（sha256 截断 16 hex），但 **值语义以本文 §8.1 为准**。  
3. Admin preview / explain / 审计展示的 FinalRows digest **必须**使用本算法。  
4. 同 Role 多 selector 冲突检测仍用 Spec 99 Role 级 digest；本文不放宽。

### 8.3 示例 digest 输入（规范性例子的 NormDnf）

对 §9.1 例 A（`dept in [ABC]`）物化后仅一臂：

```json
[
  [
    {
      "sourceName": "fact_cost",
      "field": "dept",
      "op": "in",
      "values": [{ "t": "string", "v": "ABC" }]
    }
  ]
]
```

同配置若值为 `"abc"`，则 `v` 为 `"abc"`，digest **必须**与上式不同。`sourceName` / `field` 的 identNorm 以实现 `normalizeRef` 为准并有单测锁定。

---

## 9. 规范性示例

### 9.1 例 A — OR 为 TRUE + Constraints 收紧（SC-P15-01）

| 组件 | 内容 |
|---|---|
| Role A | `(lucy_query, fact_cost)` rowGrant = `dept in [ABC]` |
| Role B | `(lucy_query, fact_cost)` rowGrant = TRUE（`row_access: all`） |
| EffectiveRowGrant | **TRUE**（OR 吸收） |
| Constraints | `dept in [ABC]` |
| FinalRows | **单臂** `dept in [ABC]`（非 TRUE） |

### 9.2 例 B — DNF 展开（多 Role scoped × Constraints）

| 组件 | 内容 |
|---|---|
| Role A arm | `region eq East` |
| Role B arm | `region eq West` |
| EffectiveRowGrant | `(region=East) ∨ (region=West)` |
| Constraints | `dept eq ACME` |
| FinalRows DNF | `(region=East ∧ dept=ACME) ∨ (region=West ∧ dept=ACME)` |
| `or.length` | **2** |

### 9.3 例 C — 无 Constraints（SC-P15-02 / P1 回归）

| 组件 | 内容 |
|---|---|
| EffectiveRowGrant | 例 B 的两臂 OR |
| Constraints | 缺省 TRUE |
| FinalRows | 与 Spec 99 相同：两臂 OR，**不得**被错误 AND |

### 9.4 例 D — 静态不可满足 → compile fail（§5.4）

| 组件 | 内容 |
|---|---|
| EffectiveRowGrant | TRUE |
| Constraints | `dept eq A` ∧ `dept eq B`（A≠B） |
| 结果 | **编译失败** `final_rows_unsatisfiable` |
| 禁止 | 生成空 `forced_filters` / 恒假谓词后仍 `runtimeAck: true` |

### 9.5 例 E — 部分臂矛盾 → 剪枝后成功（自然收窄）

| 组件 | 内容 |
|---|---|
| Role A arm | `region eq East` |
| Role B arm | `region eq West` |
| Constraints | `region eq East` |
| 展开 | `(East∧East) ∨ (West∧East)` |
| 处置 | 删除不可满足臂 `West∧East`；保留 `East` |
| FinalRows | **单臂** `region eq East`；**编译成功** |

> 本例闭合产品意图：Constraints 是对人级行集的**收紧**，不是「任一 Role 臂与 C 冲突就拒绝整 Agent」。

### 9.5b 例 E2 — 剪枝后无剩余臂 → compile fail

| 组件 | 内容 |
|---|---|
| Role arm（唯一） | `dept eq A` |
| Constraints | `dept eq B`（B≠A） |
| 展开 | 单臂不可满足 → 删除后空集 |
| 结果 | **编译失败** `final_rows_unsatisfiable` |

### 9.6 例 F — 上限溢出 → compile fail（SC-P15-09）

| 场景 | 计数 | 期望 |
|---|---|---|
| 17 个 Role OR arms（同 source） | `role_arms=17 > 16` | `final_rows_limit_exceeded` |
| Constraints 17 条 predicates（同 source） | `constraint_preds=17 > 16` | `final_rows_limit_exceeded` |
| 10 Role arms，每臂 20 preds，C 有 13 preds → 每臂 33 | `preds_per_arm=33 > 32` | `final_rows_limit_exceeded` |
| 展开后 `or.length=65` | `dnf_arms=65 > 64` | `final_rows_limit_exceeded` |
| 展开后叶子总数 513 | `total=513 > 512` | `final_rows_limit_exceeded` |

伪配置示意（Role arms 溢出；测试可用循环生成）：

```yaml
# 同 source 上 17 个 Role 各贡献不同 scoped arm → compile fail
# MAX_ROLE_ARMS_PER_SOURCE = 16
```

---

## 10. Admin / 发版 Non-Claim

| 面 | 要求 |
|---|---|
| Agent Admin | 可编辑 `constraints.sources`；dryRun 展示每源 FinalRows 摘要 / digest / 是否受保护；保存须 `runtimeAck` |
| Role Admin | **不提供** Constraints UI；Role YAML `constraints` → 拒绝（§3.3） |
| 文案 | 禁止「多 Role 自动收紧行集」；人级收紧仅 Constraints |
| Release notes | **不得**声称 Dynamic RLS / 多租户隔离 / DB 原生 RLS / **TokenScope 行收紧**已交付（SC-P15-08） |
| 域 README | 仅 Gate C 后标「AC-P1.5 已交付」 |

---

## 11. Deny / 编译失败码（AC-P1.5 增量）

| Code | 阶段 | 语义 |
|---|---|---|
| （全部 Spec 98 §10.2 + Spec 99 §9） | 继承 | 含 `row_policy_*` |
| `constraints_forbidden_on_role` | 编译 / lint | Role 出现 `constraints` |
| `constraints_invalid_shape` | 编译 / lint | Agent constraints 结构非法 |
| `constraints_source_not_in_capability` | 编译 | Constraints 引用无 capability 源 |
| `final_rows_limit_exceeded` | 编译 | 突破 §6 任一精确上限 |
| `final_rows_unsatisfiable` | 编译 | §5.4：`C` 不可满足，或剪枝后无剩余臂 |

取数路径**不**因 Constraints 新增「可放宽」码；未证明 / 未包装仍走 Spec 99 码。

---

## 12. lint:spec 节奏

| 规则 | Gate B 前（本文评审期） | Gate B 后随 WP-I1 |
|---|---|---|
| Role `constraints` | **fail**（已存在） | **fail**（保持） |
| Agent `constraints` | **fail**（防无 runtime 入库） | 允许合法 shape；校验 op/字段/上限与本文一致 |
| Token 上行谓词字段 | 不引入 | 不引入（TokenScope Non-Goal） |

---

## 13. 验收映射

| 场景 | 锚点 |
|---|---|
| S4 constrained | §9.1；SC-P15-01 |
| DNF 展开 | §5.2；§9.2；U-CONSTR-DNF |
| 矛盾：C 不可满足 / 剪枝后空 → fail；部分臂矛盾 → 剪枝成功 | §5.4；§9.4 / §9.5 / §9.5b |
| 上限 compile fail | §6；§9.6；SC-P15-09 |
| digest 保留 string 值大小写 | §8.1 |
| Role forbidden | §3.3；SC-P15-04 |
| TokenScope 非目标 | §2；`TokenScope≡TRUE` |
| 强制谓词复用 | §7；AC-SEC-CONSTRAINT |

验证命令（实现后）：

```bash
npm run lint:spec
cd webui && npm test -- --run row-policy agent-constraints constraint acl-capability
```

---

## 14. Gate B 检查表

- [x] Terminology Compliance；术语标准 §3 / §4.8 已更新 Agent Constraints / FinalRows 波次说明  
- [x] **§6 精确整数上限**已钉死（16 / 16 / 32 / 64 / 512）；无 “suggested” 措辞留口  
- [x] **§5.4**：部分臂不可满足 → **剪枝**；仅剩余空 / `C` 不可满足 → `final_rows_unsatisfiable`；不采用 empty predicate 成功编译；§9.5 自然收窄例已写明  
- [x] **§8 digest**：`sourceName`/`field` 可 identNorm；**value/values 保留 JSON 标量原值与类型**（禁止 string lowerTrim）；TypedScalar 编码无歧义  
- [x] **§9** 含 DNF 展开例、剪枝成功例、剪枝后 fail 例、overflow fail 例  
- [x] **Role `constraints` forbidden** 与 **TokenScope Non-Goal** 在 §2 / §3.3 清楚  
- [x] **WP-S1**：Spec 07 / 14 / 15 与本文无矛盾（随 Gate B 一并评审）  
- [x] SC-P15-01…09 均有锚点；与 Spec 99 指针清晰（OR 不回退）  
- [x] 确认：**批准本文才授权 WP-I\* runtime**  
- [x] **产品 / 工程签字批准 Gate B（2026-08-09，xingchen）**

— 完
