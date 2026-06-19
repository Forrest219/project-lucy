# Module 2: Eval 配置与监控 — 详细设计

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI Eval 配置与监控模块设计 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude Thinker |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/scripts/eval-runner.mjs, project-lucy/evals/superstore/eval/superstore-eval-cases.yaml v1.3, project-lucy/docs/eval-quiz-conventions.md, project-lucy/docs/user-guide/eval-meta-governance-training.html v1.2, project-lucy/webui/docs/01-architecture.md |
| 适用范围 | Builder / Reviewer / Minimax M3 直接进入实现 |
| 输出位置 | project-lucy/docs/design-eval-monitoring.md |

---

## 1. 设计原则与范围

### 1.1 解决的问题

当前 eval 工作流全在 CLI / YAML / Markdown 里：

1. **Case 管理**：`evals/<domain>/eval/<domain>-eval-cases.yaml` 手写，schema v1.3 包含 `expected_measures` `sql_assertions[]` `result_assertions[]` `safety_contract` 等深嵌套结构，新手容易写错。
2. **触发运行**：`node scripts/eval-runner.mjs [--case <id>] [--format md|json]`，需要终端、需要 `claude auth status`、需要 `EVAL_KTX_MCP_URL` 环境变量。
3. **结果查看**：`.ktx-ui/eval/latest.{md,json}` 是文件产物，没人去看；失败原因要 grep。
4. **持续监控**：完全缺失。user-guide product-intro 承诺的 "Ops Dashboard / 准确率趋势 / 失败 Top-N / 变更影响分析" 无实现。

本设计在 WebUI 里加 4 个子模块覆盖 A/B/C/D 四个能力，**事实源仍然是 YAML 文件 + runner 产物**，UI 是其上的安全编辑器与可视化。

### 1.2 不做什么

- 不重写 eval runner：`scripts/eval-runner.mjs` 保持 CLI 入口，WebUI 通过子进程调用。
- 不实现 Quiz（人类测验）编辑器：v1 只覆盖机器 eval；Quiz HTML 仍在 `evals/<domain>/*-quiz-cases.html` 手维护。
- 不实现 case 自动生成（让 LLM 替你写 case）：v1 只做结构化编辑表单。
- 不实现 Agent 多模型并跑（A/B 测试）：v1 只针对单个 Agent / 单个 Claude CLI auth 跑。
- 不实现告警通道发送（邮件/Slack）：v1 只配置阈值，触达机制后置。
- 不实现 stale quiz 自动判定：runner 已经有 `stale_status` 概念，WebUI 不参与判定。

### 1.3 设计假设

- [假设：runner 产物 `.ktx-ui/eval/latest.{md,json}` 的 JSON 格式即 `summarize()` 的输出]，从 `scripts/eval-runner.mjs` 末尾 export 与 main 流程推断。Builder 应在 spike 阶段把 `latest.json` 一份样本钉到测试 fixture。
- [假设：所有 eval cases 都遵守 `docs/eval-quiz-conventions.md v1.4` schema]。如有跨版本兼容需求，在 yaml 顶层用 `runner_schema_version` 标记，前端按版本走不同表单。
- [推断：`safety_contract` 是 domain 级而非 case 级] —— 看 v1.3 `cases[].sql_assertions` 内含 `forbidden_ast` 已经覆盖单 case 红线，文档里 `safety_contract` 出现在元治理培训里作为 domain 共享契约。Builder 实现时如发现 case 内也有 `safety_contract`，按 case 优先 + domain 兜底处理。
- [推断：`linked_quiz_questions` 是 quiz 的题号字符串列表]，UI 只读展示，不联动 quiz 编辑。

### 1.4 Module 2 的四个子能力与本设计的对应章节

| 子能力 | 章节 |
|---|---|
| A. Case 管理（CRUD） | §2.A / §3.A / §4.A / §5.A |
| B. 触发运行 | §2.B / §3.B / §4.B / §5.B |
| C. 结果查看 | §2.C / §3.C / §4.C / §5.C |
| D. 持续监控 | §2.D / §3.D / §4.D / §5.D |

§6 跨子能力的共享数据流；§7 与现有 runner / yaml / sqlite 的关系。

---

## 2. 页面结构

### 2.0 路由与导航

新增路由：

| 路由 | 页面 |
|---|---|
| `/eval` | Eval 总览（监控 dashboard + 入口卡片） |
| `/eval/cases` | Case 列表（按 domain 分组） |
| `/eval/cases/:domain` | 某 domain 的 case 表格 |
| `/eval/cases/:domain/:caseId` | Case 详情 + 编辑 |
| `/eval/cases/:domain/new` | 新建 case 向导 |
| `/eval/runs` | Run 历史列表 |
| `/eval/runs/:runId` | 单次 run 详情 |
| `/eval/monitor` | 质量趋势 + 告警阈值配置 |

左侧导航新增分组：

```
质量评测
- Eval 总览     →  /eval
- Case 管理     →  /eval/cases
- 运行历史      →  /eval/runs
- 趋势监控      →  /eval/monitor
```

---

### 2.A Case 管理

#### A1. Case 列表 `/eval/cases/:domain`

**线框：**

```
┌─ Header ────────────────────────────────────────────────────┐
│ 质量评测 / Case 管理 / superstore                            │
│ 维护 superstore domain 的 eval cases (v1.3 schema)           │
│                                          [新建 Case]  [导入] │
├─ 工具栏 ────────────────────────────────────────────────────┤
│ 搜索 [____]  case_type [全部 ▾]  expected_source [全部 ▾]    │
│ 覆盖维度 [基础/Anti-pattern/边界/降级/多轮/路径 全部 ▾]      │
├─ 表格 ──────────────────────────────────────────────────────┤
│ id                          类型      指标            最近运行 │
│ ─────────────────────────── ───────── ──────────────── ────── │
│ superstore-discount-001     single    weighted_disc.. PASS    │
│ superstore-discount-002     single    weighted_disc.. PASS    │
│ superstore-discount-003     single    profit_margin  FAIL     │
│ superstore-ordercount-001   single    order_count     PASS    │
│ ...                                                            │
│ 共 27 个 case · 26 PASS / 1 FAIL                              │
└────────────────────────────────────────────────────────────────┘
```

**核心元素：**
- 表格行点击进入详情；行尾「复制 / 删除」操作。
- 顶部 Domain 切换器（`superstore` / `finance` / `hr` 等，从 `evals/*/eval/` 目录扫描）。
- 「最近运行」列显示最新 run 中该 case 的状态（PASS/FAIL/不在最新 run 里则 "—"）。
- 「导入」按钮 = 上传现有 yaml 文件作为 dry-run 校验入口（兜底）。

#### A2. Case 详情/编辑 `/eval/cases/:domain/:caseId`

**线框（分区）：**

```
┌─ Header ────────────────────────────────────────────────────┐
│ ‹ 返回   superstore-discount-001        [复制] [删除] [保存] │
├─ Tab ───────────────────────────────────────────────────────┤
│ [元数据]  [问题 & 期望]  [SQL 断言]  [结果断言]  [上下文]    │
│ [关联]    [YAML 预览]                                        │
├──────────────────────────────────────────────────────────────┤
│ [元数据]                                                      │
│   case_type *        [single_turn ▾]                         │
│   domain (只读)      superstore                              │
│   skill_version      [v1.0]                                  │
│   semantic_version   [v1.0]                                  │
│   model_id           [claude-sonnet-4-6]                     │
│   snapshot_date      [2026-06-17]                            │
│   notes (textarea)   [最基础的折扣聚合用例...]                │
├──────────────────────────────────────────────────────────────┤
│ [问题 & 期望]                                                 │
│   question *         [superstore_orders 的整体加权平均...]    │
│   expected_source *  ◉ semantic_layer  ○ raw_sql_fallback    │
│   expected_measures  [weighted_discount] [+]                 │
├──────────────────────────────────────────────────────────────┤
│ [SQL 断言]                                                    │
│   类型 ▾   value                       reason   normalize    │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ measure_lineage  weighted_discount  必须使用…  ☑       │  │
│   │ required_ast     SUM(discount*sales) 分子按…   ☑       │  │
│   │ forbidden_ast    AVG(discount)      禁止简单… ☑       │  │
│   └───────────────────────────────────────────────────────┘  │
│   [+ 增加断言]                                                │
├──────────────────────────────────────────────────────────────┤
│ [结果断言]                                                    │
│   value_type *      ◉ scalar  ○ dataframe  ○ text  ○ empty   │
│   compare_mode      [approx ▾]                               │
│   numeric_tolerance [0.0001]                                 │
│   check_schema      ☑                                        │
│   data (JSON)       { "weighted_discount": 0.1398 }          │
├──────────────────────────────────────────────────────────────┤
│ [关联]                                                        │
│   linked_quiz_questions: [Q21] [+]                          │
├──────────────────────────────────────────────────────────────┤
│ [YAML 预览]                                                   │
│   ┌── 与磁盘 diff ──────────────────────────────────────┐    │
│   │ ...unified diff（复用 DiffViewer）...                │    │
│   └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**关键交互：**
- 「保存」走 dryRun → 预览 diff → 确认 → 落盘到 `evals/<domain>/eval/<domain>-eval-cases.yaml`。
- value_type 切换时，"data" 输入控件类型也切换（scalar = 键值对、dataframe = JSON 数组、text = textarea、empty = 隐藏）。
- 「立即运行此 case」CTA（详情页右上角辅助按钮）= 调用 §2.B 单 case 触发流程。

#### A3. 新建 Case 向导 `/eval/cases/:domain/new`

[推断：参考 user-guide eval-meta-governance-training §五最佳实践 1] "从覆盖矩阵开始"，向导第一步先选 case 在覆盖矩阵中的位置：

```
Step 1: 覆盖维度  → 基础 / Anti-pattern / 边界 / 降级 / 多轮 / 路径选择
Step 2: case_type → single_turn / multi_turn
Step 3: 复制模板  → 基于覆盖维度推荐 3 个模板，用户可选其一开干
Step 4: 编辑详情 → 跳到 A2 详情页（带预填）
```

模板示例（基础）：
```yaml
case_type: single_turn
expected_source: semantic_layer
expected_measures: [<待填>]
sql_assertions:
  - { type: measure_lineage, value: <待填>, normalize: true, reason: 必须使用语义层口径 }
result_assertions:
  - { value_type: scalar, compare_mode: exact, data: {} }
```

---

### 2.B 触发运行

#### B1. 触发 Run `/eval/runs` 顶部抽屉或独立模态

```
┌──────────────────────────────────────────────────────────┐
│ 触发一次 Eval Run                                         │
├──────────────────────────────────────────────────────────┤
│ Domain *           [superstore ▾]                        │
│ Case 选择          ◉ 全部 (27)                            │
│                    ○ 按维度筛选                           │
│                    ○ 手选 (复选树)                        │
│                    ○ 失败回归 (上次 run 里 FAIL 的)       │
│                                                          │
│ 目标 Agent         [Claude Code · localhost MCP ▾]       │
│ KTX MCP URL        [http://localhost:7878/mcp]           │
│ 触发原因 (备注)    [语义层 weighted_discount 改了 expr]   │
│                                                          │
│ ☐ 写入 .ktx-ui/eval/latest.* (覆盖最新视图)              │
│                                          [取消] [开始]   │
└──────────────────────────────────────────────────────────┘
```

提交后：
- 后端 spawn `node scripts/eval-runner.mjs ...`，把进程 PID + 工单 id 写入 SQLite。
- 弹「运行中…X/N」实时进度面板；进度来自 runner stderr 行 `# running <case_id>`。
- 完成自动跳到 §2.C 单次 run 详情。

#### B2. Run 历史 `/eval/runs`

```
┌──────────────────────────────────────────────────────────┐
│ 质量评测 / 运行历史                       [触发新 Run]    │
├──────────────────────────────────────────────────────────┤
│ Domain [全部 ▾] 触发人 [全部 ▾] 状态 [全部 ▾] 时间 [7d ▾] │
├──────────────────────────────────────────────────────────┤
│ run #128  superstore  2026-06-19 14:20  zhangxc          │
│   27 case · 26 PASS / 1 FAIL · 通过率 96.3%               │
│   触发原因: "语义层 weighted_discount 改了 expr"          │
├──────────────────────────────────────────────────────────┤
│ run #127  superstore  2026-06-19 02:00  cron             │
│   27 case · 27 PASS · 100%                                │
│ ...                                                       │
└──────────────────────────────────────────────────────────┘
```

---

### 2.C 结果查看

#### C1. 单次 Run 详情 `/eval/runs/:runId`

```
┌─ Summary ────────────────────────────────────────────────┐
│ Run #128 · superstore · 2026-06-19 14:20:15 ~ 14:23:42   │
│ 26 PASS / 1 FAIL · 通过率 96.3% · 耗时 3m27s              │
│ 触发: zhangxc · 原因: 语义层 weighted_discount 改了 expr  │
│ [下载 latest.md] [下载 latest.json] [对比 run #127]      │
├─ 结果分布 ───────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░  PASS 26                      │
│ ▓                            FAIL 1                       │
├─ 按维度 ─────────────────────────────────────────────────┤
│ 基础         8/8                                          │
│ Anti-pattern 6/6                                          │
│ 边界         4/5  ← 1 个 fail                             │
│ ...                                                       │
├─ Case 明细 ──────────────────────────────────────────────┤
│ id                       状态  Drift 类别       时长     │
│ ───────────────────────  ────  ────────────────  ───── │
│ superstore-discount-001  PASS  —                4.2s    │
│ superstore-discount-003  FAIL  data_drift       7.8s    │
│                          展开 ▾                          │
│   ┌── 失败明细 ──────────────────────────────────────┐  │
│   │ question: 折扣超过 20% 的订单，平均利润率是多少？│  │
│   │ expected: profit_margin_sign = negative           │  │
│   │ actual  : profit_margin_sign = positive (0.043)   │  │
│   │ SQL:                                              │  │
│   │   SELECT SUM(profit)/NULLIF(SUM(sales),0) ...     │  │
│   │ Drift: data_drift (exit code 10)                  │  │
│   │ 失败的断言:                                       │  │
│   │   - result_assertions[0].data.profit_margin_sign  │  │
│   │ Golden answer vs actual diff:                     │  │
│   │   ...DiffViewer...                                │  │
│   │ [跳到 Case 编辑]                                  │  │
│   └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

#### C2. Run 间对比

`?compare=<runId>` 进入对比视图，并排显示两次 run 的 case 状态变化：

```
case id                    run #127  run #128  变化
─────────────────────────  ────────  ────────  ────────
superstore-discount-003    PASS      FAIL      新增失败 ↓
superstore-edge-002        FAIL      PASS      修复 ↑
其余 25 个                  PASS      PASS      —
```

---

### 2.D 持续监控

#### D1. 总览 `/eval/monitor`

```
┌─ Overview ───────────────────────────────────────────────┐
│ 质量评测 / 趋势监控                                       │
│ Domain [superstore ▾]   时间 [30d ▾]                     │
├─ 准确率趋势 ─────────────────────────────────────────────┤
│   折线图: x=日期 y=通过率                                │
│   告警阈值线：90%（黄）/ 80%（红）                        │
├─ 失败 Case Top-N ────────────────────────────────────────┤
│   case_id                  最近 30d 失败次数              │
│   superstore-discount-003  5                              │
│   superstore-edge-002      3                              │
├─ Drift 分类分布 ─────────────────────────────────────────┤
│   柱状图: pass / data_drift / schema_drift / logic /     │
│            tool_error  在最近 7d                          │
├─ 最近运行 ───────────────────────────────────────────────┤
│   run #128, #127, #126 ... (mini 列表)                   │
└──────────────────────────────────────────────────────────┘
```

#### D2. 告警阈值配置（同页底部）

```
┌──────────────────────────────────────────────────────────┐
│ 告警阈值（按 domain）                                     │
├──────────────────────────────────────────────────────────┤
│ Domain        通过率黄线  红线   连续失败 N 次告警        │
│ superstore    [90%]       [80%]  [3]                     │
│ finance       [95%]       [85%]  [2]                     │
│                                            [保存]         │
├──────────────────────────────────────────────────────────┤
│ ☐ 启用每日 cron run (推断：定时全跑兜底)                  │
│   Cron 表达式 [0 2 * * *]                                │
└──────────────────────────────────────────────────────────┘
```

阈值落盘到 `.ktx-ui/eval/monitor-config.json`（不进 git）。

> v1 不实现告警发送（邮件/Slack）；阈值仅用于：(a) 趋势图渲染红黄线；(b) 总览页面顶部 banner 提示「当前 superstore 通过率 87%，已跌破黄线」。

---

## 3. 数据模型

### 3.A Case 数据模型

直接镜像 `docs/eval-quiz-conventions.md` v1.4 + 现有 yaml v1.3 schema：

```ts
export type EvalCaseType = "single_turn" | "multi_turn";

export type SqlAssertion = {
  type: "measure_lineage" | "required_ast" | "forbidden_ast" | "required_sql_pattern";
  value: string;
  normalize?: boolean;
  reason: string;
};

export type ResultAssertion = {
  value_type: "scalar" | "dataframe" | "text" | "empty_result";
  compare_mode: "exact" | "approx" | "schema_only" | "checksum" | "subset" | "unordered_rows";
  data?: Record<string, unknown> | { rows: Array<Record<string, unknown>> };
  numeric_tolerance?: number;
  check_schema?: boolean;
  check_row_count?: boolean;
  key_columns?: string[];            // unordered_rows / subset 时用
};

export type ContextAssertion = {
  inherit_measures?: string[];
  inherit_filters?: string[];
  inherit_time_grain?: string;
};

export type EvalTurn = {
  user: string;
  expected_measures?: string[];
  sql_assertions?: SqlAssertion[];
  result_assertions?: ResultAssertion[];
};

export type EvalCase = {
  id: string;                        // domain-topic-NNN
  case_type: EvalCaseType;
  question?: string;                 // single_turn
  turns?: EvalTurn[];                // multi_turn
  domain: string;
  skill_version?: string;
  semantic_version?: string;
  model_id?: string;
  expected_source: "semantic_layer" | "raw_sql_fallback";
  expected_measures?: string[];
  linked_quiz_questions?: string[];
  sql_assertions?: SqlAssertion[];
  result_assertions?: ResultAssertion[];
  context_assertions?: ContextAssertion;
  snapshot_date: string;
  coverage?: "basic" | "anti_pattern" | "edge" | "fallback" | "multi_turn" | "path";
  notes?: string;
};

export type EvalDomain = {
  domain: string;                    // "superstore"
  filePath: string;                  // "evals/superstore/eval/superstore-eval-cases.yaml"
  metadata: {
    document_name: string;
    version: string;
    runner_schema_version: string;
    snapshot_date: string;
    snapshot_batch?: string;
    snapshot_rows?: number;
    data_source: "semantic_layer" | string;
    linked_quiz?: string;
  };
  cases: EvalCase[];
};

export type EvalCasePatch = Partial<Omit<EvalCase, "id" | "domain">>;
```

### 3.B Run 数据模型

```ts
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type DriftClass = "pass" | "data_drift" | "schema_drift" | "logic_regression" | "tool_error";

export type RunCaseResult = {
  caseId: string;
  status: "PASS" | "FAIL";
  drift?: DriftClass;
  exitCode?: number;
  durationMs: number;
  sql?: string;                      // 模型生成的 SQL
  resultRaw?: unknown;               // tool_result
  expected?: unknown;                // 来自 case
  actual?: unknown;                  // 来自 runner
  failedAssertions?: string[];       // 路径如 "result_assertions[0].data.profit_margin_sign"
  errorMessage?: string;
  finalText?: string;                // 模型最终回答片段
};

export type EvalRun = {
  id: number;                        // auto-increment
  domain: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  triggeredBy: string;               // userId or "cron"
  trigger: "manual" | "cron" | "post_save_hook";
  triggerReason?: string;
  ktxMcpUrl: string;
  caseSelection: {
    mode: "all" | "ids" | "coverage" | "failed_in_last";
    ids?: string[];
    coverage?: EvalCase["coverage"];
  };
  totalCases: number;
  passCount: number;
  failCount: number;
  results: RunCaseResult[];
  runnerLogPath?: string;            // .ktx-ui/eval/runs/<id>.log
  jsonPath?: string;                 // .ktx-ui/eval/runs/<id>.json
};
```

### 3.C 监控配置

```ts
export type MonitorConfig = {
  domains: Record<string, {
    passRateYellow: number;          // 0.90
    passRateRed: number;             // 0.80
    consecutiveFailThreshold: number;// 3
  }>;
  cron?: {
    enabled: boolean;
    expression: string;              // "0 2 * * *"
    domains: string[];               // 跑哪些 domain
  };
};
```

### 3.D 落盘策略

| 数据 | 落盘位置 |
|---|---|
| Case 定义 | `evals/<domain>/eval/<domain>-eval-cases.yaml`（事实源，进 git） |
| Run 元数据 | `.ktx-ui/eval/runs.sqlite`（不进 git） |
| Run 详细产物 | `.ktx-ui/eval/runs/<id>.{json,md,log}`（不进 git） |
| Monitor 配置 | `.ktx-ui/eval/monitor-config.json`（不进 git） |
| 兼容 runner CLI 现状 | `.ktx-ui/eval/latest.{md,json}` 仍由 runner 产出（CLI 行为不变） |

### 3.E SQLite schema `.ktx-ui/eval/runs.sqlite`

```sql
CREATE TABLE eval_run (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain          TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  finished_at     TEXT,
  status          TEXT    NOT NULL,              -- queued/running/succeeded/failed/cancelled
  triggered_by    TEXT    NOT NULL,
  trigger         TEXT    NOT NULL,              -- manual/cron/post_save_hook
  trigger_reason  TEXT,
  ktx_mcp_url     TEXT    NOT NULL,
  case_selection  TEXT    NOT NULL,              -- JSON
  total_cases     INTEGER NOT NULL DEFAULT 0,
  pass_count      INTEGER NOT NULL DEFAULT 0,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  runner_pid      INTEGER,
  log_path        TEXT,
  json_path       TEXT
);

CREATE TABLE eval_run_case (
  run_id            INTEGER NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  case_id           TEXT    NOT NULL,
  status            TEXT    NOT NULL,            -- PASS/FAIL
  drift             TEXT,                         -- pass/data_drift/...
  exit_code         INTEGER,
  duration_ms       INTEGER,
  failed_assertions TEXT,                         -- JSON array
  error_message     TEXT,
  PRIMARY KEY (run_id, case_id)
);

CREATE INDEX idx_run_domain_started ON eval_run(domain, started_at);
CREATE INDEX idx_run_case_status    ON eval_run_case(case_id, status);
```

---

## 4. API 契约

### 4.0 通用

- envelope 同 ADR-09。
- 写类端点支持 `dryRun`。
- 新增错误码：`CASE_NOT_FOUND` `CASE_ID_TAKEN` `RUN_NOT_FOUND` `RUNNER_BUSY` `INVALID_CASE_SCHEMA` `RUNNER_PRECHECK_FAILED`。

### 4.A Case 管理

```text
GET    /api/eval/domains                                # 列 domain
GET    /api/eval/domains/:domain                        # domain 元数据 + case 索引
GET    /api/eval/cases/:domain                          # 全部 case
GET    /api/eval/cases/:domain/:caseId
POST   /api/eval/cases/:domain                          # 新建
PUT    /api/eval/cases/:domain/:caseId                  # 整体替换（含 dryRun）
DELETE /api/eval/cases/:domain/:caseId
POST   /api/eval/cases/:domain/import                   # 上传 yaml 校验
```

**`GET /api/eval/domains`**
```jsonc
{ "ok": true, "data": {
  "domains": [
    {
      "domain": "superstore",
      "filePath": "evals/superstore/eval/superstore-eval-cases.yaml",
      "caseCount": 27,
      "lastRun": { "runId": 128, "passRate": 0.963, "startedAt": "..." }
    }
  ]
}}
```

**`PUT /api/eval/cases/:domain/:caseId`**
```jsonc
{
  "dryRun": true,
  "case": { /* EvalCase 完整对象 */ }
}
```
- 校验：id 与 path 一致；YAML schema 通过 zod；sql_assertions[] 长度 ≥ 1；result_assertions[] 长度 ≥ 1。
- 后端复用 `semantic-layer.ts` 的 YAML Document API 做就地补丁：定位 yaml 顶层 `cases[id=<caseId>]` 节点，整体替换，保留注释和 key 顺序。
- 响应（dryRun）：`{ diff, proposedYaml }`；（非 dryRun）：`{ written: true }`。

### 4.B 触发运行

```text
POST   /api/eval/runs                            # 触发
GET    /api/eval/runs                            # 列历史
GET    /api/eval/runs/:runId                     # 详情
GET    /api/eval/runs/:runId/stream              # SSE 实时进度
POST   /api/eval/runs/:runId/cancel              # 取消（kill 子进程）
```

**`POST /api/eval/runs`**

Body:
```jsonc
{
  "domain": "superstore",
  "caseSelection": { "mode": "all" },
  "triggerReason": "语义层 weighted_discount 改了 expr",
  "ktxMcpUrl": "http://localhost:7878/mcp",
  "writeLatest": false
}
```
caseSelection 形态：
```ts
{ "mode": "all" }
{ "mode": "ids", "ids": ["superstore-discount-001", "superstore-discount-003"] }
{ "mode": "coverage", "coverage": "anti_pattern" }
{ "mode": "failed_in_last" }
```

后端流程：
1. preflight: 调用 `runCliCapture('claude', ['auth', 'status'])` 沿用 runner 的检查；失败返 `RUNNER_PRECHECK_FAILED`。
2. 当前已有 run status=`running` 时返 `RUNNER_BUSY`（v1 串行，不并发）。
3. 插入 `eval_run` 行 status=`queued`；
4. spawn `node scripts/eval-runner.mjs --cases <yamlPath> [--case id...] --format json`，stdout 管道到 `<id>.json`，stderr 管道到 `<id>.log`；
5. 立即返回 `{ runId }`，前端通过 SSE 流订阅进度。

Response:
```jsonc
{ "ok": true, "data": { "runId": 128, "status": "running" } }
```

**`GET /api/eval/runs/:runId/stream`** — `text/event-stream`

事件：
```
event: progress
data: { "current": 5, "total": 27, "caseId": "superstore-ordercount-002" }

event: case_done
data: { "caseId": "superstore-discount-003", "status": "FAIL", "drift": "data_drift" }

event: finished
data: { "runId": 128, "passCount": 26, "failCount": 1 }
```

后端从 runner stderr 抓 `# running <id>` 推 `progress`；当 stdout 累积到 `entries[i]` 完成时推 `case_done`；exit 时推 `finished`。

### 4.C 结果查看

```text
GET    /api/eval/runs/:runId                     # 含 results[]
GET    /api/eval/runs/:runId/artifact?type=json  # 下载 latest.json 等价物
GET    /api/eval/runs/:runId/artifact?type=md
GET    /api/eval/runs/:runId/compare?with=<otherRunId>
```

**`GET /api/eval/runs/:runId`**
```jsonc
{ "ok": true, "data": {
  "id": 128, "domain": "superstore", "status": "succeeded",
  "startedAt": "...", "finishedAt": "...",
  "triggeredBy": "zhangxc", "trigger": "manual", "triggerReason": "...",
  "totalCases": 27, "passCount": 26, "failCount": 1,
  "results": [{
    "caseId": "superstore-discount-003", "status": "FAIL", "drift": "data_drift",
    "exitCode": 10, "durationMs": 7800,
    "sql": "SELECT SUM(profit)/NULLIF(SUM(sales),0) ...",
    "expected": { "profit_margin_sign": "negative" },
    "actual":   { "profit_margin_sign": "positive", "value": 0.043 },
    "failedAssertions": ["result_assertions[0].data.profit_margin_sign"],
    "finalText": "..."
  }]
}}
```

**Compare：**
```jsonc
{ "ok": true, "data": {
  "left": { "runId": 127 }, "right": { "runId": 128 },
  "byCase": [
    { "caseId": "superstore-discount-003", "left": "PASS", "right": "FAIL", "delta": "regressed" },
    { "caseId": "superstore-edge-002", "left": "FAIL", "right": "PASS", "delta": "fixed" }
  ],
  "summary": { "regressed": 1, "fixed": 1, "unchanged": 25 }
}}
```

### 4.D 持续监控

```text
GET    /api/eval/monitor/trend?domain=&since=        # 趋势数据
GET    /api/eval/monitor/top-failures?domain=&days=  # 失败 Top-N
GET    /api/eval/monitor/drift-distribution?domain=&days=
GET    /api/eval/monitor/config
PUT    /api/eval/monitor/config
```

**`GET /api/eval/monitor/trend?domain=superstore&since=2026-05-19`**
```jsonc
{ "ok": true, "data": {
  "points": [
    { "date": "2026-06-15", "runs": 2, "passRate": 1.0, "lowestPassRate": 1.0 },
    { "date": "2026-06-19", "runs": 1, "passRate": 0.963, "lowestPassRate": 0.963 }
  ],
  "thresholds": { "yellow": 0.90, "red": 0.80 }
}}
```

**`GET /api/eval/monitor/top-failures?domain=superstore&days=30`**
```jsonc
{ "ok": true, "data": {
  "items": [
    { "caseId": "superstore-discount-003", "failCount": 5, "lastFailAt": "..." },
    { "caseId": "superstore-edge-002", "failCount": 3, "lastFailAt": "..." }
  ]
}}
```

**`PUT /api/eval/monitor/config`**
```jsonc
{ "config": { /* MonitorConfig */ } }
```
落盘到 `.ktx-ui/eval/monitor-config.json`，经 fs-safe（白名单 `.ktx-ui`）。

---

## 5. 关键交互流程

### 5.A Case 管理：从语义层改动到补 Case

```
数据工程师                WebUI                后端           evals/<domain>/eval/*.yaml
   │                       │                     │                          │
   │ 改了 weighted_discount │                     │                          │
   │ measure 公式            │                     │                          │
   │ /eval/cases/superstore  │                     │                          │
   │ 看 discount-001 标 FAIL │                     │                          │
   │ 点 case 进入编辑        │                     │                          │
   │                         │ GET /api/eval/cases/superstore/discount-001    │
   │                         │─────────────────────▶                          │
   │                         │ ◀── case JSON ──────                           │
   │ 改 result_assertions    │                     │                          │
   │ data.weighted_discount  │                     │                          │
   │ 0.1398 → 0.1421         │                     │                          │
   │ 点保存                  │                     │                          │
   │                         │ PUT /api/eval/cases/superstore/discount-001    │
   │                         │      dryRun=true                                │
   │                         │─────────────────────▶                          │
   │                         │ ◀── { diff } ───                               │
   │ 看 diff,确认             │                     │                          │
   │                         │ PUT dryRun=false                                │
   │                         │─────────────────────▶                          │
   │                         │      yaml Document  │ 就地改 cases[id=...].   │
   │                         │      就地补丁 → safeWrite ──────────────────▶ │
   │                         │ ◀── { written: true }                          │
   │ 跳到 /eval/runs 触发    │                     │                          │
   │ "失败回归" run          │                     │                          │
```

### 5.B 触发 → 实时进度 → 结果

```
管理员                  WebUI                  Fastify                child_process(eval-runner.mjs)
  │ 点「触发新 Run」       │                       │                              │
  │ 选 all/failed_in_last  │                       │                              │
  │                       │ POST /api/eval/runs    │                              │
  │                       │──────────────────────▶ │                              │
  │                       │                       │ preflightClaude (auth status) │
  │                       │                       │ INSERT eval_run status=running│
  │                       │                       │ spawn ──────────────────────▶ │
  │                       │ ◀── { runId: 128 } ── │                              │
  │ 跳 /eval/runs/128     │                       │                              │
  │                       │ SSE /api/eval/runs/128/stream                          │
  │                       │──────────────────────▶ │                              │
  │                       │                       │ tail stderr:                  │
  │                       │                       │  # running superstore-disc-001│
  │                       │                       │  ...                          │
  │                       │ ◀── event: progress ─ │                              │
  │                       │     {current:1,total:27}                              │
  │ 实时进度条更新          │                       │                              │
  │                       │ ◀── event: case_done ─                                │
  │ 单 case 状态变色        │                       │                              │
  │                       │                       │ child exit 1                  │
  │                       │                       │ 解析 stdout JSON              │
  │                       │                       │ UPDATE eval_run               │
  │                       │                       │ INSERT eval_run_case x27      │
  │                       │ ◀── event: finished ─ │                              │
  │ 跳 §C 详情             │                       │                              │
```

### 5.C 查看失败 → 跳回 Case

```
管理员 → /eval/runs/128 → 展开 FAIL 行 → 看到 expected vs actual
  → 判断："这是 data_drift，不是逻辑错误，应该更新 golden answer"
  → 点「跳到 Case 编辑」 → 落地 /eval/cases/superstore/superstore-discount-003
  → 改 result_assertions.data → 保存
  → 回到 /eval/runs → 触发 failed_in_last 重跑 → 验证 PASS
```

### 5.D 监控 → 告警 → 排查

```
管理员每天打开 /eval/monitor → 看 30 天趋势
  → 发现 superstore 连续 3 天通过率 < 90%（黄线）
  → 顶部 banner 红色提示 "superstore 通过率连续 3 天低于阈值"
  → 点 banner 跳「失败 Top-N」 → 看到 superstore-discount-003 反复失败
  → 跳 Run 详情看 Drift 分类 → 都是 data_drift
  → 判断 "底层数据快照刷新了，需要更新 snapshot_date + golden answer"
  → 走 §5.A 流程修 case → 重跑 → 趋势回到绿色
```

---

## 6. 跨子能力共享：runner 输出 → SQLite 落盘

后端启动 runner 子进程后，**通过 stdout JSON 和 stderr 文本两条流**双轨消费：

```
spawn('node', ['scripts/eval-runner.mjs',
       '--cases', yamlPath,
       '--format', 'json',
       ...(caseIds.map(id => ['--case', id]).flat())],
      { env: { ...process.env,
               EVAL_KTX_MCP_URL: ktxMcpUrl,
               EVAL_MCP_CONFIG: '/tmp/eval-mcp.json' } })
```

| 流 | 消费方 | 用途 |
|---|---|---|
| stderr 行 `# running <case_id>` | 进度推送 | SSE `event: progress` |
| stderr 行 `#   <case_id> → PASS/FAIL` | 单 case 完成事件 | SSE `event: case_done` |
| stdout JSON（runner 退出时一次性 flush 的 summary） | 写 `runs/<id>.json`，解析后写 `eval_run_case` | 详情页 results[] |
| stdout MD（如 `format=md`） | 写 `runs/<id>.md` | 下载按钮 |
| stderr 完整文本 | 写 `runs/<id>.log` | 排错回看 |

**注意**：当前 runner 末尾 `process.stdout.write(json)` 一次性输出整个 summary。SSE 的 per-case 推送依赖 stderr 的 `# running` 字符串。Builder 必须在 runner 侧确认这两行格式稳定（在 `main()` 里 ~744 / ~747 行）。

如果 builder 想做更细粒度的实时性，可以在 runner 里加 `--progress-fd <fd>` 选项把每 case 完成时的 JSON 推到 fd 3，但 v1 用 stderr 抓字符串足够。

---

## 7. 与现有 runner / yaml / sqlite 的关系

### 7.1 不动 runner CLI 行为

`scripts/eval-runner.mjs` 仍然是 CLI 一等公民：
- 终端用户可以继续 `node scripts/eval-runner.mjs --case <id>` 跑。
- CI 可以继续 `scripts/eval-runner.mjs --write-latest` 用 `.ktx-ui/eval/latest.{md,json}`。
- WebUI 通过 spawn 调用，**不修改 runner 源码**（除非 builder 在 spike 时发现 stderr 行格式不稳定，再做兼容性微调）。

### 7.2 不动 yaml schema

eval cases yaml 仍然是 `docs/eval-quiz-conventions.md` 定义的 schema。WebUI 表单是对 schema 的可视化映射，所有 yaml 字段在 UI 里都能编辑或至少能"以 raw JSON 兜底"。

### 7.3 不动 audit sqlite

`.ktx-ui/audit.sqlite`（MCP proxy 用）与 `.ktx-ui/eval/runs.sqlite`（本模块用）是两个独立文件，避免互相干扰。

### 7.4 与 webui-feature-map 的对应

本设计实现 webui-feature-map.md §1.4 全部「缺失」项 + §4 缺口排序的 #2。

### 7.5 改动文件清单

| 文件 | 改动 |
|---|---|
| `webui/server/eval/cases.ts` | 新：yaml 读写 + zod schema |
| `webui/server/eval/runner.ts` | 新：spawn runner 子进程、SSE、SQLite 写入 |
| `webui/server/eval/runs.ts` | 新：runs 查询 / compare |
| `webui/server/eval/monitor.ts` | 新：trend / top-failures / config |
| `webui/server/eval/db.ts` | 新：better-sqlite3 封装 `.ktx-ui/eval/runs.sqlite` |
| `webui/server/index.ts` | 改：注册 eval 路由 |
| `webui/server/fs-safe.ts` | 改：白名单加 `evals/<domain>/eval` 或更精确的 `evals` 根 |
| `webui/src/lib/types.ts` | 改：增 §3 全部类型 |
| `webui/src/lib/apiClient.ts` | 改：新增 SSE helper |
| `webui/src/pages/eval/*` | 新：8 个页面（CaseList, CaseDetail, CaseNew, RunList, RunDetail, Monitor, Overview） |
| `webui/src/app/App.tsx` | 改：路由 + 导航 |
| `package.json` | 改：依赖 `better-sqlite3`（如 spec 07 已加则复用）、`yaml` 已有 |

[假设：`evals/` 写入需要新加 fs-safe 白名单]。注意：与 secret/raw-sources 的禁写要继续保持。Builder 推荐将白名单写为 `'evals'` 根，单测验证不能穿越到 `.ktx/secrets`。

---

## 8. 测试策略

| 层 | 重点用例 |
|---|---|
| `eval/cases.ts` 单测 | yaml round-trip：保留注释、key 顺序、引号；新增 case 不破坏现有；id 重复拒绝；zod schema 全字段覆盖 |
| `eval/runner.ts` 单测 | spawn mock：stderr 行解析；stdout JSON 解析；preflight 失败处理；RUNNER_BUSY 锁 |
| `eval/db.ts` 单测 | 建表幂等；run + run_case 事务；外键级联删除 |
| `eval/monitor.ts` 单测 | trend 按日聚合；top-failures SQL；threshold 配置 round-trip |
| fs-safe 安全回归 | `evals/` 白名单不能穿越；`.ktx-ui/eval/` 不能穿越 |
| API supertest | 全部端点 envelope 形态；SSE 流格式 |
| RTL 前端 | CaseDetail 表单切换 value_type 不丢数据；运行进度 SSE 渲染；阈值线绘制 |
| E2E 手动 | 改 case → 触发 → 看实时进度 → 看结果 → 改阈值 → 趋势图红/黄线渲染正确 |

---

## 9. 验收标准

1. **Case CRUD**：在 `/eval/cases/superstore` 复制 `superstore-discount-001` → 改名 `superstore-discount-001-copy` → 保存 → `git diff evals/superstore/eval/superstore-eval-cases.yaml` 能看到新增段；`node scripts/eval-runner.mjs --list-cases` 能列出新 id。
2. **触发**：在 `/eval/runs` 点「触发新 Run」 → 选 `mode=ids` 单跑 discount-001 → 实时进度可见 → 完成自动跳详情页 → DB `eval_run` 多一条 succeeded 行。
3. **结果**：详情页能展开 FAIL 行看 expected/actual diff、SQL、drift 类别；下载 `latest.json` 能拿到 runner 原始 JSON。
4. **对比**：在 run #128 详情点「对比 run #127」 → 看到 regressed / fixed / unchanged 三档分布。
5. **监控**：`/eval/monitor` 显示 30d 趋势折线；改阈值黄线到 95% → 折线图红/黄线立即更新；阈值 round-trip 写入 `.ktx-ui/eval/monitor-config.json`。
6. **安全回归**：尝试 `PUT /api/eval/cases/superstore/../secrets` → 403 FORBIDDEN_PATH；`GET /api/eval/runs/:id` 不返回 token、不返回密码字段。
7. **CLI 不退化**：`node scripts/eval-runner.mjs --case superstore-discount-001 --write-latest` 仍工作，产物 `.ktx-ui/eval/latest.{md,json}` 仍按原格式写。
8. **回归**：现有所有页面与测试集仍绿。

---

## 10. 未确认假设

| 编号 | 假设 | 影响 | 建议确认方 |
|---|---|---|---|
| E1 | runner stdout 最终 JSON 即 `summarize()` 输出，结构稳定 | 决定 SSE / DB 写入解析方式 | spike：跑一次 superstore 全集，pin 一份 sample 到 fixture |
| E2 | runner stderr 行 `# running <id>` / `#   <id> → PASS/FAIL` 字符串格式稳定 | 决定 SSE 进度推送实现 | 同上 |
| E3 | `claude auth status` 在 webui 子进程环境里可用（PATH 继承） | preflight 失败处理 | 工程实现时跑一次 |
| E4 | `evals/` 加入 fs-safe 白名单不引入额外安全风险 | 决定白名单粒度 | 安全 review |
| E5 | `safety_contract` 字段是 domain 级，不是 case 级 | 决定 case 表单是否包含此 section | 产品/eval 维护者确认 |
| E6 | v1 不需要并发 run（串行 + RUNNER_BUSY 即可） | 决定 runner.ts 是否要队列 | 产品确认 |
| E7 | v1 不需要把 runner 改成 daemon 模式 | spawn 启动开销可接受（~claude 启动 ~1-2s + auth ~1s + 每 case 数秒） | 产品确认 |
| E8 | 告警通道（邮件/Slack）v1 不做 | UI 只渲染阈值线 / banner，不发外部消息 | 产品确认 |
| E9 | Cron 调度由 webui 进程承担（node-cron）vs 系统 crontab 调用 CLI | 决定是否引入 node-cron 依赖 | 工程评估；推荐：v1 文档化 crontab 调用 CLI，不在 webui 进程内做 cron |
| E10 | Quiz 与 Eval 联动（quiz stale 判定）v1 不做 | 决定 Case 编辑页是否加 quiz section | 产品确认 |

如未在开发前确认，按 E1=已稳定（先 spike 一份）、E2=已稳定、E3=可用、E4=可接受、E5=domain 级、E6=串行、E7=spawn、E8=不做、E9=文档化 crontab、E10=不做 实现。
