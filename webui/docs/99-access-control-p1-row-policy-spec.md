# AC-P1 Runtime Spec — Row Policy / FinalRows / 强制谓词

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1 Runtime Spec（Row Policy） |
| 文档类型 | Spec |
| 版本 | v0.1.2（Gate B **已批准** 2026-08-09；禁止 measure 绑定 row_policy field） |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-control/design-upgrade.md` v1.1.2 ADR-AC-03/05/06；[`adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md) **v0.2 Gate A 已批准**；WO-60；Spec 98（AC-P0 基线，只读依赖） |
| 适用范围 | AC-P1 **行授予 / FinalRows / 强制谓词注入**的实现事实源；Gate B 已批准 → **授权 WP-I\* runtime**；**不含** AC-P1.5 Agent Constraints |
| 输出位置 | `webui/docs/99-access-control-p1-row-policy-spec.md` |
| 冲突裁决 | 与 `design-upgrade.md` / Gate A ADR 冲突 → **design-upgrade / ADR**，并回修本文；实现与本文冲突 → 本文 |
| 关联 WO | WO-202608-60；Gate A DONE；**Gate B DONE（2026-08-09）** → WP-I\* |
| 契约补丁 | Spec 07 / 14 / 15 + 术语标准（WP-S2）；`lint:spec` 随 WP-I1 允许合法 scoped |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New / 扩展 terms（须已登记于术语标准 §3 与 §4.8）：

| Canonical Term | UI 主术语 | 禁止混淆 |
|---|---|---|
| Row Policy | 行级策略 | Segment、用户查询 filters、overlay 表达式当权限 |
| Row Access Scoped | 行访问（受限） | 「行级已开启」而无注入、Dynamic RLS |
| Effective Row Grant | 有效行授予 | Role 间 AND、Agent Constraints |
| Final Rows | 最终行约束 | 仅 Role 并集、仅用户 filter |
| Forced Predicate | 强制谓词 | 拼进用户 filters 的 SQL 字符串 |
| Forced Filters Field | 专用强制字段 | 用户可写 `filters` |
| Upstream Forced Predicate Proven | 上游强制谓词已证明 | 「代码已写完即已证明」 |
| Row Policy Requires Wrapped Tool | 需包装工具 | capability_forbidden（混用为主文案） |
| Row Policy Upstream Unproven | 上游契约未证明 | 临时放行碰运气 |

Forbidden terms / 文案：

- 不得将 AC-P1 宣称为「Dynamic RLS / 多租户隔离 / DB 原生 RLS 已交付」
- Admin **禁止**展示「看起来有行级策略但未注入」的成功态（无 `forced_filters` 注入 / 未证明却显示「已生效」）
- 不得将 Segment 标为「行权限」

Protected DOM terms（`translate="no"` + `notranslate`）：既有 Spec 98 集合，另加 `row_policy`、`row_access`、`forced_filters`、`FinalRows`、裁决码全文。

---

## 1. 背景与定位

### 1.1 指针关系（Spec 98）

| 主题 | Spec 98（AC-P0） | 本文（AC-P1） |
|---|---|---|
| Capability / Tool Class / Canonical Key / 编译提交 / 降级 | **仍权威** | 不回退；继承 |
| `row_access: scoped` | 编译失败 | **合法**（须 `row_policy`） |
| `FinalRows` | 占位恒 TRUE | 非 TRUE 时强制谓词 |
| Deny 预留码 | 不得出现成功路径 | **正式路径** |

### 1.2 本文范围

1. `row_access: scoped` + `row_policy` schema 与编译  
2. `EffectiveRowGrant` OR；`FinalRows`（本波 Constraints/TokenScope ≡ TRUE）  
3. 工具闸门：O2 fail-closed；`lucy_query` 注入；explain / freshness 收口  
4. 上游载体主路径 **A：`forced_filters`**；未证明取数 deny  
5. Deny 全表、Admin dryRun、SC / BY 映射、lint 规则  

### 1.3 成功标准（WO SC-P1-\*）

| ID | 标准 | 本文 | 测试 |
|---|---|---|---|
| SC-P1-01 | 同源多 Role rowGrant OR 后为 TRUE 时不错误 AND | §5 | U-ROW-OR / BY-10 |
| SC-P1-02 | `scoped` + 合法 `row_policy` 可编译；非法 op / 缺 policy / 未知字段 / **非行级字段** / **measure 字段** → 失败 | §3.2 / §4 / §7 | U-ROW-COMP / U-ROW-FIELD-MEASURE / BY-19 |
| SC-P1-03 | 未包装工具 × scoped → `row_policy_requires_wrapped_tool` | §6 | BY-06/07/17 |
| SC-P1-04 | 契约未证明 → `row_policy_upstream_unproven` | §6.3 | BY-09 |
| SC-P1-05 | 包装工具注入后 bypass 矩阵全绿；编译期 BY-19 同步绿 | §9 / ADR §5.1 / §3.2 | BY-01…19 |
| SC-P1-06 | `constraints` 出现 → 配置拒绝 | §4.3 / §11 | lint + 编译 |
| SC-P1-07 | 收窄失败语义继承 AC-P0 | Spec 98 §8 | U-REL 回归 |
| SC-P1-08 | Release notes 未声称 Dynamic RLS | §10 | 文档评审 |

---

## 2. Non-Goals

| 非目标 | 说明 |
|---|---|
| Agent Constraints / TokenScope 收紧 | **AC-P1.5**；本波 `constraints` → lint/compile **fail** |
| `ne` / 范围比较 op | 另批 |
| DB 原生 RLS / Dynamic claim / Active Role / CLS | AC-P2+ |
| 依据 SUPERSEDED 行级文 | 禁止 |
| 未包装工具「加包装再放行」 | O2：本波一律 deny |
| 载体改选 B 而无 ADR §3.1.1 联签 | 禁止 |
| Gate B 前改 runtime | 禁止；本文评审通过前只作文稿 |
| 浏览器 E2E | 默认不做（DEVELOPMENT） |

---

## 3. 配置模型（AC-P1 合法增量）

```text
Role (permission_model_version: 2)
  └── allow.tableSelectors[]
        ├── names（禁用 prefix）
        ├── row_access: all | scoped     # v2 必填
        └── row_policy?: RowPolicy       # scoped 时必填；all 时禁止出现

RowPolicy =
  { predicates: Predicate[] }            # 数组非空；元素之间为 AND

Predicate =
  { field: FieldRef                      # 见 §3.2；非自由字符串
  , op: "eq" | "in"
  , value?: scalar                       # eq 必填；仅字面量
  , values?: scalar[]                    # in 必填且非空；仅字面量
  }

Agent
  ├── roles: [...]
  ├── constraints?: …                    # 本波：出现即编译/lint 失败
  └── tokens[]
```

### 3.1 合法 / 非法示例

**合法（scoped）：**

```yaml
permission_model_version: 2
allow:
  tableSelectors:
    - connection: demo-mysql
      schema: dataforai
      names: [superstore_orders]
      row_access: scoped
      row_policy:
        predicates:
          - field: region
            op: eq
            value: East
          - field: category
            op: in
            values: [Furniture, Office Supplies]
```

**非法：**

| 形态 | 结果 |
|---|---|
| `scoped` 且缺 `row_policy` / `predicates` 空 | 编译失败 |
| `op` ∉ {eq, in} | 编译失败 |
| `field` 未知 / 跨源 / 含表达式或 SQL 片段 | 编译失败（§3.2） |
| `field` 为 measure / 聚合表达式 / 比例 / window（如 `total_sales`、`profit_margin`、`count_distinct_order_id`） | 编译失败（§3.2；BY-19） |
| `row_access: all` 且出现 `row_policy` | 编译失败 |
| Agent / Role 出现 `constraints` | 编译失败 / lint fail |
| v2 + `prefix` | 仍失败（Spec 98） |

### 3.2 `predicates[].field` 安全绑定（Normative）

> **不得**将 `field` 当作任意字符串透传。编译期必须解析为**当前 selector 命中之 `canonicalSourceKey` 下、可证明为行级的源内确定性字段**；无法解析或无法证明行级 → **Role 编译失败**（`row_policy_field_unresolved`；整 Agent fail-closed）。  
> 本条闭合 ADR **D-FP-14**：**FinalRows / ForcedPredicateAST 约束的是基行**，不得滑入聚合 / HAVING 语义。

| 规则 | 要求 |
|---|---|
| **解析范围** | 仅针对该 `tableSelector` 解析出的每个 `canonicalSourceKey`（`names` 多源时：**每一个**源都必须成功解析到同一逻辑**行级**字段，否则失败） |
| **允许形态** | (1) 裸字段名，且在该源**行级字段目录**中唯一命中；(2) source-qualified `sourceName.field`（或语义层已登记的等价稳定引用），且限定符与当前命中源一致 |
| **行级字段目录（默认只含）** | **物理列**；以及语义层已登记、且编译器能**证明为行级**的 dimension / 行级 computed column（证明标准由实现钉死：无聚合、无窗口、无跨源依赖、对基行确定性求值） |
| **明确禁止绑定** | **一切 measure**（含 `sum` / `count` / `count distinct` / 比例 / ratio / 派生指标名，无论是否「也可出现在用户 filter」）；aggregate expression；window；跨 source / 跨 connection 字段；表达式、函数调用、运算符拼接、SQL 片段、子查询；未知字段；空 `field`；仅靠 Prompt 的别名 |
| **无法证明** | 目录缺失、类型不明、或无法证明「行级且源内确定性」→ 一律 `row_policy_field_unresolved`（**不得**因「用户查询里也能 filter 该名」而放行） |
| **值侧** | `value` / `values` 仅为 JSON 标量字面量（string / number / boolean）；禁止嵌套对象、表达式字符串冒充字面量 |
| **失败码** | 编译/保存失败；`row_policy_field_unresolved`（Spec 07 已登记）；**不得**降级为 warn 后放行 |

编译成功后写入 `RowPolicyAST` 的字段必须是**已解析的稳定行级字段标识**（含所属 `canonicalSourceKey`），供 `forced_filters` 注入与 digest 使用——禁止在热路径重新「猜」字段。

**必测（编译期，非取数路径）：**

| ID | 场景 | 期望 |
|---|---|---|
| **BY-19** / **U-ROW-FIELD-MEASURE** | `row_policy.predicates[].field` 取语义 measure 名（至少覆盖示意：`total_sales`、`profit_margin`、`count_distinct_order_id`，或以同仓库真实 measure 名等价替换） | **编译失败** / dryRun 拒绝；不得生成 EffectivePolicy |

---

## 4. 编译规则

### 4.1 rowGrant

```text
rowGrant(r, sourceKey) =
  permission_model_version = 1        → TRUE
  row_access = all                    → TRUE
  row_access = scoped                 → RowPolicyAST(r, sourceKey)   # 非 TRUE
```

`RowPolicyAST` digest：规范化 **已解析** predicates（稳定字段标识、op、值）的哈希；用于同 Role 多 selector 冲突检测（继承 Spec 98 §5.6：digest 不同 → **Role 编译失败**）。字段未通过 §3.2 不得进入 AST。

### 4.2 EffectiveRowGrant / FinalRows

```text
EffectiveRowGrant(sourceKey) = OR({ rowGrant | ∃tool: (tool, sourceKey, rowGrant) ∈ EffectiveDataCapabilities })

# 本波：
AgentConstraints(sourceKey) ≡ TRUE     # constraints 配置禁止出现
TokenScope(sourceKey)       ≡ TRUE

FinalRows(sourceKey) =
    TRUE                 if EffectiveRowGrant = TRUE
  | ForcedPredicateAST   if EffectiveRowGrant 为 OR(RowPolicyAST…)
```

`ForcedPredicateAST`：将各 Role 贡献的 `RowPolicyAST` 做 **OR** 合成（SC-P1-01）。叶子仅 `eq`/`in`。

### 4.3 `constraints`（SC-P1-06）

- `access.yaml` 中 Agent（`users[]`）或未来 Role 扩展字段出现 `constraints` → **lint fail** 且 **编译失败**
- **不得**静默忽略或生效

### 4.4 收窄失败（SC-P1-07）

完整继承 Spec 98 §8：Admin 保存失败时盘与 runtime 不留更宽；外部 YAML 失败语义不变。

---

## 5. 工具闸门与注入

### 5.1 受保护源

`FinalRows(sourceKey) ≠ TRUE` 的源为**受保护源**。

### 5.2 工具矩阵（对齐 Gate A ADR §2.1 / §2.1.1）

| 工具 | 受保护源 |
|---|---|
| `lucy_query` | 唯一**取数**注入通道 → `sl_query` + `forced_filters`（§6） |
| `lucy_read_source` | **deny** `row_policy_requires_wrapped_tool` |
| `entity_details` / `sl_validate` | **deny** `row_policy_requires_wrapped_tool` |
| `lucy_freshness` | **deny** `row_policy_requires_wrapped_tool` |
| `lucy_explain_query` | **严格本地安全响应**（ADR E1–E5）；非取数；BY-18 |
| `sl_*` AbsoluteDeny | 不变（Spec 98） |

### 5.3 流水线（相对 Spec 98 §10.1 增量）

```text
authorizeAndRewrite:
  … capability 检查 …
  for each sourceKey:
    if FinalRows ≠ TRUE:
      if tool ≠ lucy_query (取数) and tool ≠ lucy_explain_query:
        deny row_policy_requires_wrapped_tool
      if tool = lucy_query:
        if not upstream_forced_predicate_proven:
          deny row_policy_upstream_unproven
        inject forced_filters ← ForcedPredicateAST
        strip user-supplied forced_filters
        validate protected-source args shape (§6.2)
        rewrite → sl_query
      if tool = lucy_explain_query:
        local explain only (E1–E5); never upstream
```

---

## 6. 上游强制载体与 args 形状

### 6.1 主路径 A（Gate A 已批准）

| 项 | 规范 |
|---|---|
| 字段名 | **`forced_filters`**（Proxy → 上游 `sl_query` args）。KTX ktx-sl / MCP schema 已同名对齐（见 [`evidence-ktx-forced-filters.md`](../../docs/access-control/evidence-ktx-forced-filters.md)）；若未来上游改名须在此表记载映射 |
| 写入方 | **仅** Proxy；用户 / 模型写入必须剥离或导致 deny（BY-05） |
| 组合语义 | 外层 **AND**：结果行集 ⊆ 强制谓词为真的行集（ADR NR-01…）；KTX generator 对 WHERE 子句括号化以防 `AND`/`OR` 优先级放宽 |
| 备选 B | 仅 ADR §3.1.1 联签后可替换 |

**否决：** 将强制条件拼进用户可控 `filters` 字符串数组且无特权语义。

### 6.2 受保护源上 `lucy_query` args

| 类别 | 允许 | 禁止 → deny |
|---|---|---|
| `filters` | structured `{field,op,value\|values}`；彼此隐式 AND | 字符串 filter；OR/括号布尔树 |
| `measures` | 已登记 measure 字符串 key | ad-hoc `{expr}` |
| 自连接 / LEFT JOIN / 聚合+HAVING / 子查询 | — | **默认 deny** `row_policy_query_shape_forbidden`（或等价 `invalid_arguments:…`） |
| `query` / `sql` | — | `raw_query_forbidden` |

`FinalRows = TRUE` 的源：保持 AC-P0 guardrail，不适用本表加严项。

### 6.3 证明标志（SC-P1-04 / SC-P1-05）

```text
upstream_forced_predicate_proven ∈ { false, true }
```

| 值 | 行为 |
|---|---|
| `false`（默认直至 Gate C） | `lucy_query` × 受保护源 → `row_policy_upstream_unproven`；**禁止**碰运气取数 |
| `true` | 仅当 ADR §5 证明完成（含 BY-01…18 全绿）且 **BY-19** 编译拒绝 measure 字段通过后，由发版门禁置真 |

实现可落地注入代码，但 proven=false 时取数路径必须仍 deny（BY-09）。

---

## 7. Permission Model Version（相对 Spec 98 §7）

| 版本 | AC-P1 |
|---|---|
| **1** | 不变；rowGrant = TRUE；无 scoped |
| **2** | `row_access: all \| scoped`；`scoped` 须合法 `row_policy`；仍禁 `prefix` |

---

## 8. Admin（dryRun / preview）

| 要求 | 内容 |
|---|---|
| Role Admin | 允许编辑 v2 + `scoped` + `row_policy`；dryRun 展示 predicates / digest / 受影响源 |
| Agent Admin | preview 须展示 capability 上的 **rowGrant**（TRUE 或策略摘要）；**禁止**在未注入/未证明时显示「行级已生效取数」 |
| `constraints` UI | 本波不提供；若 YAML 含该字段 → 保存/lint 失败并明示 |
| 保存 | 继承 Spec 14/15：`runtimeAck` + `policyVersion`；收窄失败语义 Spec 98 §8 |

---

## 9. Deny reason 全表（AC-P1）

| Code | 语义 |
|---|---|
| （全部 Spec 98 §10.2） | 继承 |
| `row_policy_requires_wrapped_tool` | 受保护源上非 `lucy_query` 取数通道（含未包装、`lucy_read_source`、`lucy_freshness`） |
| `row_policy_upstream_unproven` | 取数且 FinalRows≠TRUE 且 proven≠true |
| `row_policy_query_shape_forbidden` | 受保护源禁止查询形态（括号/自连接/LEFT JOIN/聚合·HAVING/子查询等） |
| `row_policy_field_unresolved` | `predicates[].field` 无法绑定到当前源已知字段（§3.2） |
| `invalid_arguments:…` | 受保护源禁止的 filters/measures 等形状 |

---

## 10. 发版与 Non-Claim（SC-P1-08）

- Release notes / 对外说明 **不得**出现「Dynamic RLS / 多租户隔离 / DB 原生 RLS 已交付」
- Gate C 前不得置 `upstream_forced_predicate_proven = true`
- 域 README 仅在 Gate C 后改为「AC-P1 已交付」

---

## 11. lint:spec（WP-S2 规范；落地节奏）

| 规则 | Gate B 前（本文评审期） | Gate B 后随 WP-I1 |
|---|---|---|
| `constraints` 出现 | **立即 fail**（本波即可） | fail |
| `scoped` | 仍 fail（防无 runtime 的配置入库） | 允许，且强制 `row_policy` 形状 |
| `row_policy` | 未知键 / 随 scoped 拒绝 | 校验 op∈{eq,in}；§3.2 字段绑定；`all`+`row_policy` fail |
| 非法 op / 空 predicates | — | fail |

---

## 12. 验收映射

| 场景 | 锚点 |
|---|---|
| S4 行授予 OR | §4.2；BY-10 |
| AC-SEC-ROW / BYPASS | ADR §5.1 BY-01…18 |
| measure / 非行级 field 绑定 | §3.2；**BY-19** / U-ROW-FIELD-MEASURE |
| explain / freshness | §5.2；BY-17/18 |
| 未证明 | §6.3；BY-09 |
| constraints | §4.3；SC-P1-06 |

验证命令（实现后）：

```bash
npm run lint:spec
cd webui && npm test -- --run row-policy bypass acl-capability policy-compile
```

---

## 13. Gate B 检查表

- [x] Terminology Compliance 与术语标准已同步  
- [x] O2 / explain / freshness / 主路径 A 无歧义  
- [x] **§3.2 字段绑定**为硬规则；**仅行级目录**；**禁止 measure / 聚合 / 比例 / window**；未知或无法证明行级 → `row_policy_field_unresolved`  
- [x] **BY-19** 已列入验收（measure 名作 policy field → 编译失败）  
- [x] Spec 15 UI/测试/DoD 与「Gate B 前拒 / Gate B+WP-I1 后允 scoped」一致（无「永远拒 scoped」）  
- [x] SC-P1-01…08 均有锚点  
- [x] 与 Spec 98 指针清晰；P0 语义不回退  
- [x] Spec 07/14/15 补丁已合并（WP-S2）  
- [x] 确认：**批准本文才授权 WP-I\* runtime**  
- [x] **产品 / 工程签字批准 Gate B（2026-08-09，xingchen）**

— 完
