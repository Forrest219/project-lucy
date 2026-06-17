# 04 · 数据模型

内部模型 ↔ 真实 YAML 映射、人工/AI 描述策略、完成度算法。

## 1. 真实 YAML 结构（实测）

文件：`semantic-layer/<conn>/_schema/<schema>.yaml`
```yaml
tables:
  customers:                      # ← 表名是 key，编辑单元
    table: openclaw_db.customers  # schema.table 限定名
    columns:
      - name: customer_id
        type: number              # number | string | time | boolean
        pk: true
        nullable: false
        descriptions:
          ai: "Unique numeric identifier ..."   # ← 按作者分桶
    descriptions:
      ai: "Master registry of all customers ..."
    joins:
      - to: dim_region
        "on": customers.region_id = dim_region.region_id   # ← 引号必须保留
        relationship: many_to_one                          # many_to_one|one_to_many|one_to_one
        source: formal                                     # formal|manual|candidate
```
> 现状：`grain / measures / segments / tags / role / visibility / primaryKey/naturalKey` 在真实 `_schema` 文件中**均不存在**。
> ADR-10 实测结论：`grain/measures/segments` 应写到独立 overlay 文件 `semantic-layer/<conn>/<table>.yaml`；不要写回 `_schema/<schema>.yaml`。`visibility` 当前不支持；已有真实列的 `role` 暂不落盘。

独立 overlay 文件示例（ktx 会与 `_schema` manifest 合并）：
```yaml
name: accrual_demo
grain:
  - date
  - hospital
measures:
  - name: total_amount
    expr: sum(amount)
    description: Total accrued amount.
segments:
  - name: positive_amount
    expr: amount > 0
```

## 2. 内部模型（前后端共享 `model.ts`）

```ts
type TableModel = {
  conn: string; schema: string; table: string;   // 复合地址（ADR-02）
  filePath: string;                                // 相对项目根
  qualifiedName?: string;                          // = yaml 的 `table` 字段
  descriptions: AuthoredText;                       // 表描述（多作者）
  grain?: string[];                                 // overlay: semantic-layer/<conn>/<table>.yaml
  columns: Column[];
  measures?: Measure[];                             // overlay
  segments?: Segment[];                             // overlay
  joins?: Join[];
  unknownKeys?: string[];                           // 记录模型未覆盖的键，序列化时不丢
};

type AuthoredText = { ai?: string; human?: string }; // 渲染优先 human，回退 ai

type Column = {
  name: string;
  type: "string" | "number" | "time" | "boolean";
  pk?: boolean;
  nullable?: boolean;
  role?: "time" | "dimension" | "measure_source";   // 只读/内存态；当前不落盘覆盖已有列
  visibility?: "public" | "internal" | "hidden";    // 只读/内存态；当前 ktx overlay 不支持
  descriptions: AuthoredText;
};

type Measure = { name: string; expr: string; filter?: string; description?: string };
type Segment = { name: string; expr: string; description?: string };
type Join = {
  to: string; on: string;
  relationship: "many_to_one" | "one_to_many" | "one_to_one";
  alias?: string;
  source?: "formal" | "manual" | "candidate";
};
```

## 3. 编辑补丁（TablePatch）

仅描述「要改什么」，不是整表覆盖——配合就地补丁（ADR-01）：
```ts
type TablePatch = {
  tableDescription?: string;                 // 写入 descriptions.human
  grain?: string[];                           // 写入 overlay
  columns?: { name: string; description?: string; role?; visibility?; pk?; nullable? }[];
  measures?: Measure[];                       // 写入 overlay
  segments?: Segment[];                       // 写入 overlay
  joins?: Join[];                             // 仅 confirmed/formal 写正式 YAML
};
```

### 写入规则
1. 表/字段描述写 `descriptions.human`，**保留** `descriptions.ai`（ADR-03）。
2. 渲染显示优先 `human`，无则 `ai`。
3. `joins` 中仅 `source: formal`（即用户 confirm）的写入正式 YAML；
   candidate / rejected → `.ktx-ui/join-candidates.json` sidecar。
4. `grain/measures/segments` 写入或创建 `semantic-layer/<conn>/<table>.yaml` overlay；保存后必须跑 `ktx sl read` 或 `validate` 确认被合并。
5. `role/visibility` 不写入正式 YAML；UI 可展示为未来字段或本地草稿，但保存请求必须忽略或拒绝这些 patch 项。
6. 序列化保留原 key 顺序、注释、`"on"` 引号、未知键（`unknownKeys`）。

## 4. 完成度算法（`completion.ts`）

```text
not_started        : 无表描述 且 无 grain 且 无任一字段描述
partial            : 有表描述或 grain，但核心字段未全部有描述
done               : 有表描述 且 有 grain 且 主键/自然键明确
                     且 核心字段有描述 且 (有常用 measures 或显式标注该表无需 measures)
validation_failed  : 最近一次 ktx sl validate 失败（覆盖上述状态）
```
> 「核心字段」MVP 定义：`pk` 字段 + 非 `hidden` 字段。`validation_failed` 由 validate 结果旁路标记，不进纯函数（纯函数只算结构完成度，校验态在上层合并）。

## 5. sidecar：`.ktx-ui/join-candidates.json`

```jsonc
{ "version": 1, "candidates": [{
  "conn": "mysql-aliyun", "schema": "openclaw_db", "fromTable": "orders",
  "join": { "to": "customers", "on": "orders.customer_id = customers.customer_id",
            "relationship": "many_to_one", "source": "candidate" },
  "confidence": "candidate", "note": "由字段名推断" }]}
```
仅 webui 内部使用，不污染语义层；用户在 Join Editor 把 candidate 提升为 confirmed 时才写正式 YAML。

---
_架构设计 by Claude (architect) · 2026-06-15_
