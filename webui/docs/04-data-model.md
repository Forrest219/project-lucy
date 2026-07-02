# 04 · 数据模型

内部模型 ↔ 真实 YAML 映射、人工/AI 描述策略、完成度算法。

## 1. 真实 YAML 结构（实测）

文件：`semantic-layer/<conn>/_schema/<schema>.yaml`
```yaml
tables:
  superstore_orders:                      # ← 表名是 key，编辑单元
    table: dataforai.superstore_orders  # schema.table 限定名
    columns:
      - name: order_id
        type: number              # number | string | time | boolean
        pk: true
        nullable: false
        descriptions:
          ai: "Unique numeric identifier ..."   # ← 按作者分桶
    descriptions:
      ai: "Master registry of all superstore_orders ..."
    joins:
      - to: superstore_people
        "on": superstore_orders.region = superstore_people.region   # ← 引号必须保留
        relationship: many_to_one                          # many_to_one|one_to_many|one_to_one
        source: formal                                     # formal|manual|candidate
```
> 现状：`grain / measures / segments / tags / role / visibility / primaryKey/naturalKey` 在真实 `_schema` 文件中**均不存在**。
> ADR-10 实测结论：`grain/measures/segments` 应写到独立 overlay 文件 `semantic-layer/<conn>/<table>.yaml`；不要写回 `_schema/<schema>.yaml`。`visibility` 当前不支持；已有真实列的 `role` 暂不落盘。

独立 overlay 文件示例（ktx 会与 `_schema` manifest 合并）：
```yaml
name: superstore_orders
grain:
  - order_id
measures:
  - name: total_sales
    expr: sum(sales)
    description: Total sales amount.
segments:
  - name: profitable_rows
    expr: profit > 0
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
  "conn": "mysql-aliyun", "schema": "dataforai", "fromTable": "superstore_returns",
  "join": { "to": "superstore_orders", "on": "superstore_returns.order_id = superstore_orders.order_id",
            "relationship": "many_to_one", "source": "candidate" },
  "confidence": "candidate", "note": "由字段名推断" }]}
```
仅 webui 内部使用，不污染语义层；用户在 Join Editor 把 candidate 提升为 confirmed 时才写正式 YAML。

## 6. Connections / `ktx.yaml`

`GET /api/project` 与 `GET /api/connections` 暴露连接摘要，永不返回 password 明文：

```ts
type ConnectionInfo = {
  id: string;
  driver?: string;
  engine?: string;                     // e.g. mysql, postgres, doris
  wireProtocol?: "mysql" | "postgres" | "native" | "unknown";
  r1Target?: boolean;                  // true for R1 target sources such as Doris
  readOnlyExpected?: boolean;          // defaults to true for governed Agent access
  passwordSource?: "file" | "inline" | "env";
  schemas: string[];
  enabledTables: string[];
};

type ProjectInfo = {
  root: string;
  connections: ConnectionInfo[];
  ktxAvailable: boolean;
};
```

`enabledTables` 映射到 `ktx.yaml`：

```yaml
connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
  doris-r1:
    driver: mysql
    engine: doris
    wire_protocol: mysql
    readonly: true
    r1_target: true
    enabled_tables:
      - mart.ceo_metric_snapshot
```

`PUT /api/connections/:connId/enabled-tables` 的写入模型：

```ts
type EnabledTablesPreview = {
  diff: string;
  proposedYaml: string;
  oldEnabledTables: string[];
  newEnabledTables: string[];
};

type EnabledTablesWrite = {
  written: true;
  auditId?: number;
  oldEnabledTables: string[];
  newEnabledTables: string[];
};
```

校验规则：每项必须是 `schema.table`，且必须存在于 `semantic-layer/<connId>/_schema/*.yaml` 中已扫描 source 的物理表清单。

## 7. Eval 模型

Eval case 文件位于 `evals/<domain>/eval/*-eval-cases.yaml`。

```ts
type EvalDomainInfo = {
  domain: string;
  filePath: string;
  caseCount: number;
  metadata?: Record<string, unknown>;
  lastRun?: { runId: number; passRate: number; startedAt: string };
};

type EvalCase = {
  id: string;
  case_type: string;
  question?: string;
  turns?: unknown[];
  domain: string;
  skill_version?: string;
  semantic_version?: string;
  model_id?: string;
  expected_source?: string;
  expected_measures?: string[];
  linked_quiz_questions?: string[];
  sql_assertions?: SqlAssertion[];
  result_assertions?: ResultAssertion[];
  context_assertions?: unknown;
  snapshot_date?: string;
  coverage?: string;
  notes?: string;
};

type CaseSelection =
  | { mode: "all" }
  | { mode: "ids"; ids: string[] }
  | { mode: "coverage"; coverage: string }
  | { mode: "failed_in_last" };
```

Eval run 写入 SQLite（`.ktx-ui/eval/*.sqlite` 由 eval db helper 管理），前端使用：

```ts
type EvalRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type EvalRun = {
  id: number;
  domain: string;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt?: string;
  triggeredBy: string;
  trigger: string;
  triggerReason?: string;
  ktxMcpUrl: string;
  caseSelection: CaseSelection;
  totalCases: number;
  passCount: number;
  failCount: number;
  passRate?: number;
};
```

Monitor config sidecar：

```ts
type MonitorConfig = {
  domains: Record<string, {
    passRateYellow: number;
    passRateRed: number;
    consecutiveFailThreshold: number;
  }>;
};
```

## 8. Access Governance 模型

`webui/config/access.yaml` 是访问治理事实源。

```yaml
roles:
  kx_readonly:
    description: KX 财务数据只读问答
    allow:
      connections: [mysql-aliyun]
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [kx_fact_financial_amount]
      tools: [kx_catalog, sl_query, sl_read_source, entity_details]

users:
  - id: workhorse
    name: Hermes Workhorse
    enabled: true
    role: kx_readonly
    tokens:
      - hash: "sha256:..."
        label: hermes-workhorse
        created: 2026-06-20
```

Role-first 规则：

- 新建 Agent 必须写 `role`，不得写 `allow`。
- `users[].allow` deprecated，仅兼容历史配置读取。
- 保存 role 到 legacy user 时删除该 user 的 `allow`。
- role 解析失败 fail closed，不回退到 legacy `allow`。
- `role.allow.tools` 不得包含 `*`。

前端共享类型：

```ts
type Agent = {
  id: string;
  name: string;
  note?: string;
  enabled: boolean;
  role?: string;
  tokens: TokenSummary[];
  allow?: { tables: string[] | ["*"]; tools: string[] | ["*"]; connections?: string[] };
  effectivePermissions?: EffectivePermissionsPreview;
  permissionWarnings?: string[];
  stats?: AgentStats;
};

type Role = {
  id: string;
  description?: string;
  tools: string[];
  connections: string[];
  sourceCount: number;
  invalid: boolean;
  warnings: string[];
};

type EffectivePermissionsPreview = {
  roleIds: string[];
  snapshotHash: string;
  sourceMapVersion?: string;
  tools: string[];
  connections: string[];
  sources: Array<{ connectionId: string; schema: string; sourceName: string; table: string }>;
  legacyAllow: boolean;
};

type AgentPatch = {
  name?: string;
  note?: string;
  enabled?: boolean;
  role?: string;
};

type CreateAgentBody = {
  id: string;
  name: string;
  note?: string;
  role: string;
};
```

Token 明文只在 `CreateTokenResponse.token` 返回一次：

```ts
type TokenSummary = {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
  last_used?: string | null;
  revoked?: boolean;
  revoked_at?: string;
  revoke_reason?: string;
};
```

## 9. Audit / Config Change 模型

访问日志表：

```sql
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client TEXT,
  tool TEXT NOT NULL,
  tables TEXT,
  args_summary TEXT,
  outcome TEXT NOT NULL,
  error_detail TEXT,
  duration_ms INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  role_ids TEXT,
  permission_snapshot_hash TEXT,
  effective_tables_count INTEGER,
  decision_reason TEXT
);
```

权限快照表：

```sql
CREATE TABLE IF NOT EXISTS permission_snapshots (
  hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  resolved_json TEXT NOT NULL
);
```

配置变更审计表：

```sql
CREATE TABLE IF NOT EXISTS config_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  session_id TEXT,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  target_id TEXT,
  old_summary TEXT,
  new_summary TEXT,
  diff TEXT,
  request_id TEXT
);
```

`actor` 当前固定为 `local-admin`。`change_type` 包括 `enabled_tables_update`、`agent_create`、`agent_patch`、`agent_delete`、`token_create`、`token_revoke`。token 明文不得进入 yaml、audit、日志。

---
_架构设计 by Claude (architect) · 2026-06-15_
