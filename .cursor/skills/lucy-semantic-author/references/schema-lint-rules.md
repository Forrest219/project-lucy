# 语义 YAML 契约硬规则（生成后必过）

与 KTX `resolvedSourceSchema` / Python `JoinDeclaration` 对齐。违反任一条 → **禁止交付**，须改完再交付。

## Source 文件形态（WebUI 上传包 — 强制）

Lucy Publish Workbench / Catalog 上传分类器要求 source YAML **必须**有 `table: <schema>.<table>`，
否则报 `OVERLAY_MISSING_TABLE`。

KTX 规则：有 `table:` / `sql:` → **standalone**（**不会**与 Manifest compose）。
因此上传包里的 `<source>.yaml` 必须自带完整物理列，不能只写计算列。

| 文件 | 必须包含 |
|---|---|
| `_schema/<schema>.yaml` | `tables.<name>.table` + 物理列 +（可选）合法 joins |
| `<source>.yaml` | `name` + **`table:`** + **全部物理列** + grain/measures/segments + 可选计算列（带 `expr`） |

**禁止**（会导致发布时 `grain column(s) absent from physical table` / `references unknown column`）：

```yaml
# BAD — 有 table: 但只有 2 个计算列
name: ksc_income_statement_detail
table: ai.ksc_income_statement_detail
columns:
  - name: 期间年份
    expr: fiscal_year
```

**正确**：

```yaml
# GOOD — standalone：物理列齐全 + 计算列
name: ksc_income_statement_detail
table: ai.ksc_income_statement_detail
grain: [line_item_code, fiscal_year, fiscal_quarter]
columns:
  - name: line_item_code
    type: string
  # ... 其余物理列 ...
  - name: 期间年份
    type: number
    expr: fiscal_year
measures: [...]
```

> 纯 overlay（无 `table:`，靠 Manifest compose）仅适用于仓库内手工落盘 / `ktx` 直写，**不能**走 WebUI 上传。

## `joins[].relationship`（枚举）

**仅允许**（三选一）：

| 合法值 | 典型用法 |
|---|---|
| `many_to_one` | 事实 → 维度（订单 → 客户） |
| `one_to_many` | 维度 → 事实（客户 → 订单） |
| `one_to_one` | 一对一扩展表 |

**禁止**（含但不限于）：

- `many_to_many`（KTX 不支持；期间对齐的多科目明细互 JOIN 也属此类）
- `belongs_to` / `has_many` / `has_one` / ORM 别名
- 中文标签（`多对一` 等）
- 空值、省略 `relationship`（有 join 时必须写）

## JOIN 建模决策（写之前先判）

| 场景 | 正确做法 |
|---|---|
| 事实表 ↔ 事实表，仅按期间/业务日对齐（两边 grain 含多行科目） | **不写 joins**；在表/字段中文描述 + Wiki 写清对齐键与跨表公式 |
| 事实 → 维度（FK 到主键） | `relationship: many_to_one` |
| 维度 → 事实 | `relationship: one_to_many` |
| 真一对一 | `relationship: one_to_one` |
| 需要多对多语义 | 引入中间维/桥表，拆成两条 `many_to_one`；或留给 Wiki/Agent 分表查询 |

**禁止**：为了「表达真实 ER」而写入 `many_to_many`「先过语义再说」——上传时会被 `ktx sl validate` 拒绝。

## 其它易错项（同次 lint）

- `joins[].on` 必须是等值 SQL 条件字符串；键名写 `on`（YAML 可写作 `"on"`）。
- `joins[].to` 必须是本 Manifest 内已有的 source 名。
- Overlay 的 `name` 与文件名（去 `.yaml`）一致；`table:` 为 `schema.physical`。
- 列 `type` 仅：`string` \| `number` \| `time` \| `boolean`。

## 交付前门禁

在声明「语义 YAML 已完成」之前，必须执行：

```bash
python3 .cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py <output_dir>
```

退出码非 0 → 修好再交付。若本机有可用的 Lucy 工程根且已配置同名 connection，可额外跑：

```bash
ktx sl validate <source> --connection-id <conn>
```

有 staging/正式工程时以 `ktx` 为准；无工程时以本 lint 脚本为最低硬门禁。
