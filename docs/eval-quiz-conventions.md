# project-lucy · Eval & Quiz 设计约定

| 元数据 | 内容 |
|---|---|
| 文档名称 | Eval & Quiz 设计约定 |
| 文档类型 | Spec |
| 版本 | v1.4 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude / Codex |
| 委托人 | project-lucy 团队 |
| 基于材料 | superstore-eval-cases.yaml (v1.3, 17 cases) / superstore-quiz-cases.html (v1.1, 30 题) / docs/DEVELOPMENT.md / 2026-06-18 Runner 可执行性评审意见 / 2026-06-19 安全边界与 CI 退出码评审意见 |
| 适用范围 | 项目内任何为数据集设计 eval cases（YAML，agent 测）和 quiz HTML（人类测）的 agent 必读 |
| 输出位置 | docs/eval-quiz-conventions.md |

## 1. 目的与适用范围

本文档约定 project-lucy 仓库内 `eval cases`（YAML，机器跑）和 `quiz HTML`（人类做）两类产物的**设计原则、数据获取路径、命名规范、版本同步机制、最小检查流程**。

**适用**：
- 为新数据集 / 新 domain 设计首批 eval cases 与 quiz
- 现有 eval / quiz 因 schema 变更、SL measure 新增 / 删除而需要同步刷新
- 季度 / 版本节奏的回归用例扩展

**不适用**：
- 临时性 demo 数据（按 Inbox@Projects 默认落盘规则）
- 治理规则本身（CLAUDE.md / AGENTS.md / DEVELOPMENT.md）

---

## 2. 产物清单与配对关系

| 产物 | 格式 | 路径模板 | 测试对象 | 触发 |
|---|---|---|---|---|
| Eval cases | YAML | `evals/{domain}/eval/{domain}-eval-cases.yaml` | Agent（LLM 跑 SQL / 工具调用）| CI gate / regression |
| Quiz cases | YAML（嵌入 eval cases）→ HTML（渲染生成） | `evals/{domain}/eval/{domain}-eval-cases.yaml`（quiz_cases section）；渲染：`node scripts/render-quiz.mjs` | 人类（业务 / 培训）| 培训 / 验收 |

**配对原则**：同一数据集的 eval 与 quiz **主题对齐**——eval 测机器会不会做，quiz 测人会不会想（覆盖矩阵一致，形式不同）。

---

## 3. 设计原则

### 3.1 覆盖矩阵（每类必含）

每个数据集的 eval + quiz 至少覆盖以下 6 个维度：

| 维度 | 目的 | 例 |
|---|---|---|
| **基础** | 测单测点查询 | 总销售额、订单数 |
| **Anti-pattern** | 测是否踩 AVG / COUNT(*) 等陷阱 | AVG(discount) 应被禁；COUNT(DISTINCT order_id) 应被用 |
| **边界 / 异常** | 测空过滤、未知 segment、is_deleted 处理 | 不写 WHERE is_deleted=0 会怎样 |
| **降级 / 健壮性** | 测 SL 不覆盖时的回应 | 客户 LTV 不在 SL，应明示 + 给 raw SQL |
| **多轮一致性** | 测追问中 measure 口径不漂移 | 同 session 内 profit_margin 应保持 |
| **路径选择** | 测 join 维度选择 / measure 选用 | 跨表 query 选哪几张表 |

### 3.2 题目类型与选项约束

| 题目类型 | 选项数 | 用途 |
|---|---|---|
| 单选 | 2–4 个 | 排名 / 比较 / 数值估算 |
| 对错 | 2 个 | 概念定义 / 反模式确认 |
| 多选 | 4–5 个 | 多个正确项（必须全选对才算 PASS）|

**禁止**：
- 题干对已知精确数字加"大约 / 约 / 左右"——见 feedback memory `feedback_no_redundant_hedging`
- 选项写成 8+ 个（噪声大）
- 多选题不标"（多选）"标记
- 选项写成全段描述（应简短，< 30 字）

### 3.3 措辞原则

- 题干用**自然口语化中文**（"统计一下……" / "以下哪个……"），避免直译或技术腔（如"激活订单"应改"正常订单"）
- measure 名 / segment 名 / 字段名等 SL 术语可保留英文，但配套人话说明
- 内部 SQL / measure 定义文档可以用术语，外部人类文档要转译

---

## 4. 数据获取路径

数据获取分为两层判定：先选**执行入口**，再选**语义能力**。Agent / Runner 不应为了满足 CLI 优先级而绕开已可用的 MCP 工具。

| 执行环境 | 首选入口 | 说明 |
|---|---|---|
| 自动化 Agent / Runner | KTX MCP `sl_query` / `sl_read` | 原生工具调用，可结构化记录输入输出 |
| 人工本地复核 | `ktx sl query --execute` | 适合人在 terminal 中快速复核 |
| SL 不覆盖 | `ktx sql --connection-id <conn>` | **fallback**：ktx 体系的 parser-validated read-only SQL，处理 time-grain / cohort / window function |
| 明确排障或人工确认 | dbeaver MCP / mysql CLI / 直连 | 非常规路径，不作为 eval / quiz 常规 ground truth 来源 |

语义能力优先级固定为：`semantic_layer` → `raw_sql_fallback` → `manual_debug_only`。只有当前语义能力无法表达需求时，才进入下一层，并在产物 metadata 或 notes 中记录 `data_source` 与原因。

**fallback 触发条件**：当前 SL measure / dimension 不覆盖所需分析（如 NTILE、cohort、跨年趋势）。

**fallback 前置流程**：
1. 在产物 metadata 明示 `data_source: raw_sql_fallback`
2. 每条 fallback 数据点对应一次 `ktx sql` 调用，记录可复查的 query / 结果摘要
3. 不复用历史 dbeaver / mysql CLI 的结果
4. 每次走 fallback 前，明示工具选择 + 原因；不要默选 dbeaver

---

## 5. 命名约定

按 `{domain}-{purpose}-{variant}.{ext}` 骨架（与 `superstore-eval-cases.yaml` 保持并行）：

| 位置 | 命名 | 例 |
|---|---|---|
| Eval cases | `{domain}-eval-cases.yaml` | `superstore-eval-cases.yaml` |
| Quiz cases | `{domain}-quiz-cases.html` | `superstore-quiz-cases.html` |
| Quiz answers（未来扩展） | `{domain}-quiz-answers.html` | （待用）|
| Benchmark | `{domain}-bench-{variant}.yaml` | （待用）|

**禁止**：`quiz.html` / `test.html` / `cases.yaml` 等缺 domain 的命名。

**版本号不进文件名**，放 metadata（`版本` / `snapshot_date` / `skill_version` 字段）。结构性标记可入名（如题量 `superstore-quiz-30q.html`）。

---

## 6. 版本与同步

### 6.1 版本字段

eval YAML 与 quiz HTML 的 metadata 必须包含：

| 字段 | 说明 |
|---|---|
| 版本 / skill_version | 文档版本，递增 |
| 撰写日期 | YYYY-MM-DD |
| snapshot_date | 数据快照日期，ground truth 校验用 |
| 关联 eval / 关联 quiz | 配对产物的引用 |

### 6.2 同步触发

| 事件 | eval YAML | quiz HTML |
|---|---|---|
| 新增 SL measure / segment | 加 case 测新 measure | 加对应人读题 |
| schema 变更（表 / 列）| 刷新 ground truth | 同步刷新 |
| snapshot drift（数据值漂移）| 更新 `result_assertions` | 按 answer binding 判断是否标记 stale |

### 6.3 漂移检测与 CI 退出码

`result_assertions` 若与当前 ground truth 查询不一致，按以下状态机处理，不使用"再决定"类人工模糊步骤：

| 状态 | Exit code | 触发条件 | Agent / Runner 动作 | CI 策略 | 产物状态 |
|---|---:|---|---|---|---|
| `pass` | `0` | 当前结果满足 `result_assertions` 且满足安全红线 | 通过 | 放行 | 不改文档 |
| `data_drift` | `10` | SQL / measure / schema 未变，仅结果断言失败 | 标记 drift，生成待更新 diff，bump 对应产物版本，并执行 quiz 级联判定 | 阻断自动合并；允许人工确认 drift diff 后重跑放行 | 允许人工确认后合并 |
| `schema_drift` | `20` | 表、字段、measure、dimension 缺失或重命名 | 标记 schema drift，阻断自动更新 | 阻断；通知 schema / SL owner | 需要人工修订 schema / SL |
| `logic_regression` | `30` | 生成 SQL 违反 matcher、违反安全红线或口径漂移 | 标记 regression，保留原 `result_assertions` | 阻断；PR 不得合并 | 不更新 ground truth |
| `tool_error` | `40` | 工具不可用、超时、权限失败 | 标记 inconclusive，记录错误 | 阻断本次判定；允许基础设施重试 | 不更新文档，不判失败为 drift |

Runner 只能输出上表中的状态和退出码；同一次运行出现多类失败时，按 `logic_regression` → `schema_drift` → `data_drift` → `tool_error` → `pass` 的优先级归类。安全红线失败一律归为 `logic_regression`，不得降级为 `tool_error` 或 `data_drift`。

示例：`superstore-ordercount-001` / `-002` 曾因 snapshot drift 从 `order_count: 5009` 刷新到 `5083`；处理方式是标记 drift、刷新 ground truth、bump 对应 eval 版本。

关联 quiz 的级联判定由题目的 `answer_binding` 决定：

| answer_binding | 阻断条件 | Runner 动作 |
|---|---|---|
| `exact_value` | 题干、选项或解析中的硬编码数值与新 ground truth 不一致 | 标记关联 quiz 为 `stale`，阻断流水线 |
| `ranking` | 排名顺序、Top N 成员或正确选项变化 | 标记 `stale`，阻断流水线 |
| `boolean` | 正误判断翻转 | 标记 `stale`，阻断流水线 |
| `range_bucket` | 新值落出原选项区间或正确 bucket 变化 | 标记 `stale`，阻断流水线 |
| `conceptual` | 数据漂移不影响概念题正确性 | 不阻断，仅记录 drift 影响评估 |

### 6.4 P1 完整业务 eval 证据链

`scripts/p1-business-eval-full.mjs` 是 P1 完整业务 LLM / agent eval 的编排入口，覆盖 `superstore`、`kx_financial`、`data_agent_poc` 三套 eval YAML。它不替代 `scripts/eval-runner.mjs` 的 case 执行逻辑，只负责前置可用性检查、逐套调用 runner、汇总证据。

运行前必须先做 precheck：agent CLI 可执行、模型密钥或 CLI 登录可用、MCP endpoint 可达、token 在 endpoint 需要鉴权时可用。precheck 不通过时仍必须写出 `inbox/p1-business-eval-full-evidence.json`，状态为 `blocked`，并不得进入 LLM case 执行。

P1 full eval 退出码：

| 状态 | Exit code | 说明 |
|---|---:|---|
| `pass` | `0` | 三套 runner summary 均为 0 fail |
| `fail` | `1` | precheck 通过，但任一 suite 的 runner 失败或 summary 含失败 case |
| `usage` | `2` | 参数错误或脚本级异常 |
| `blocked` | `42` | agent CLI / model secret / MCP endpoint / MCP token 等执行前置条件缺失 |

默认汇总证据落盘到 `inbox/p1-business-eval-full-evidence.json`；每套 runner JSON 和 stderr 摘要落在 `inbox/p1-business-eval-full-{suite}.json` 与 `.stderr.log`，用于保留从 precheck 到 case summary 的完整证据链。

---

## 7. 元数据要求

metadata 分两层：
- **文件级 metadata**：说明产物版本、数据来源、快照、配对文件，供维护和追溯使用
- **case / 题目级字段**：说明单条用例的预期行为、SQL 模式和 ground truth

### 7.1 eval YAML

eval YAML 文件级 metadata 必含：

| 字段 | 说明 |
|---|---|
| 版本 / skill_version | eval 文档版本，独立递增 |
| 撰写日期 | YYYY-MM-DD |
| snapshot_date | 数据快照日期，ground truth 校验用 |
| data_source | `semantic_layer` / `raw_sql_fallback` / `manual_debug_only` |
| 关联 quiz | 配对 quiz HTML 路径与版本 |
| safety_contract | 文件级只读、安全路径和全局 `forbidden_ast` 红线 |

以下为 v1.4 结构化 schema。新建 case 或结构性刷新 case 必须使用本 schema；既有 legacy case 可被 Runner 读取，但进入 CI gate 前必须迁移。

eval YAML 文件级必须声明 `safety_contract`。该契约是所有 case 的顶层安全红线，Runner 必须在执行前编译，在执行后复核；任一命中都视为 `logic_regression` 并返回 exit code `30`。

```yaml
safety_contract:
  readonly: true
  forbid_secret_paths:
    - ".ktx/secrets/"
  forbid_cross_source_join: true
  forbidden_ast:
    - type: forbidden_ast
      value: "UPDATE | DELETE | INSERT | MERGE | DROP | ALTER | TRUNCATE | CREATE"
      reason: "eval / fallback 只能只读，不允许 DDL 或 DML"
    - type: forbidden_ast
      value: "cross_source_join"
      reason: "禁止跨数据源 Join；跨源分析必须拆成单源结果后人工解释"
```

`safety_contract` 的规则不可被 case 级 `sql_assertions` 放宽。case 级只能追加更细的 `forbidden_ast` / `required_ast`，不能覆盖文件级红线。

`cases:` 列表下每条 case 的公共字段：

| 字段 | 说明 |
|---|---|
| id | 唯一 ID，命名 `{domain}-{topic}-{n}` |
| case_type | `single_turn` 或 `multi_turn` |
| expected_source | `semantic_layer` 或 `raw_sql_fallback` |
| expected_measures | case 级 measure 名列表；多轮 case 可在 turn 内补充 |
| sql_assertions | 结构化 SQL 断言列表；会生成 SQL 的新 case 必填 |
| tool_assertions | 结构化工具调用断言；semantic catalog/source 读取类 case 可用它替代 SQL 断言 |
| snapshot_date | 数据快照日期 |
| notes | 设计意图 / 反模式说明 |

`case_type` 分支约束：

| case_type | 必填字段 | 禁止字段 | Runner 入口 |
|---|---|---|---|
| `single_turn` | `question`, `result_assertions` | `turns` | 执行根层 `question` 并校验根层断言 |
| `multi_turn` | `turns` | 根层 `question`, 根层 `result_assertions` | 按 `turns[].turn_id` 顺序执行并逐轮校验 |

`multi_turn` case 的 `turns` 使用以下结构：

| 字段 | 说明 |
|---|---|
| turn_id | 从 1 开始递增 |
| user | 本轮用户问题 |
| expected_measures | 本轮必须保持或新增的 measure |
| result_assertions | 本轮结果断言 |
| context_assertions | 本轮必须继承或保持的上下文断言 |

`result_assertions` 是结果校验策略列表，不直接等同于结果值；每个 assertion item 使用以下结构：

| 字段 | 说明 |
|---|---|
| value_type | `scalar`, `dataframe`, `text`, `empty_result` |
| data | 期望值、期望行集、checksum、fixture path 或结构化摘要 |
| numeric_tolerance | 数值容差；仅适用于 numeric scalar 或 numeric columns |
| compare_mode | `exact`, `approx`, `schema_only`, `checksum`, `subset`, `unordered_rows` |
| key_columns | DataFrame 行匹配主键；`unordered_rows` / `subset` 时必填 |
| check_schema | 是否校验结果中至少包含期望列；需要强制列全集时在 `data.columns` 显式声明 |
| check_row_count | 是否校验行数 |

`context_assertions` 用于多轮口径继承，必须是 Runner 可编译结构：

| 字段 | 说明 |
|---|---|
| inherit_measures | 必须从历史轮次继承的 measure ID 列表 |
| inherit_filters | 必须继承的过滤条件 ID 或结构化表达式 |
| inherit_dimensions | 必须继承的分组 / 维度 ID 列表 |
| inherit_time_grain | 必须继承的时间粒度，例如 `month` / `year` |
| sql_assertions | 本轮额外 SQL 断言；Runner 与本轮 `sql_assertions` 合并编译 |
| tool_assertions | 本轮额外工具调用断言；Runner 与本轮 `tool_assertions` 合并编译 |

`required_sql_pattern` / `forbidden_sql_pattern` 是 legacy 字段：Runner 可读取旧文件并迁移，但新增 case 不再使用裸字符串列表。

`sql_assertions` 不做 substring match，必须声明 matcher 类型：

| 字段 | 说明 |
|---|---|
| type | `required_ast`, `forbidden_ast`, `required_normalized_regex`, `forbidden_normalized_regex`, `measure_lineage` |
| value | 断言内容；regex 必须针对规范化 SQL |
| normalize | 是否在匹配前统一大小写、空白、引号和表别名 |
| reason | 断言目的，例如禁止 `AVG(discount)` 或要求 `COUNT(DISTINCT order_id)` |

Runner 应优先使用 SQL parser / AST matcher；只有 parser 不支持当前 SQL 方言时，才降级到 normalized regex，并记录 `matcher_fallback: normalized_regex`。

全局 `safety_contract.forbidden_ast` 不允许降级到普通 substring match。若 SQL parser 不支持当前方言，Runner 必须使用 normalized AST-like classifier 或安全关键字 tokenizer；无法完成安全判定时返回 `tool_error` exit code `40`，不得执行 SQL。

`tool_assertions` 用于不一定产生 SQL 的 semantic catalog/source 读取类 case，例如检查是否调用 `sl_search` / `sl_read_source` 并面向指定 domain 检索：

| 字段 | 说明 |
|---|---|
| type | `required_tool`, `forbidden_tool`, `required_tool_input_regex`, `forbidden_tool_input_regex` |
| value | 工具名或针对工具输入的 regex；多个工具名可用 `|` 分隔 |
| reason | 断言目的，例如要求读取 KX source 定义而不是凭记忆回答 |

`raw_sql_fallback` 或 `sl_query` 等会产生 SQL 的 case 仍应使用 `sql_assertions` 校验 SQL 结构；`tool_assertions` 只补充工具路径，不替代结果断言。

### 7.2 quiz HTML

HTML 顶部 metadata 注释必含（per AGENTS.md §文档输出元数据要求）：

| 字段 | 说明 |
|---|---|
| 文档名称 | 人类可读标题，建议 `{domain} 数据 Quiz · {n} 题` |
| 文档类型 | 固定枚举 `Quiz`；人类说明放入 `文档说明` |
| 文档说明 | 例如 `HTML quiz, 人类测试用` |
| 版本 | quiz 文档版本，独立递增 |
| 撰写日期 | YYYY-MM-DD |
| 撰写人 | 实际生成 / 修订 agent |
| 委托人 | project-lucy 团队或具体业务方 |
| 基于材料 | SL、数据表、eval YAML、补充查询结果 |
| 适用范围 | 培训 / 验收 / 人工测验边界 |
| 输出位置 | HTML 文件路径 |
| 命名约定 | `{domain}-{purpose}-{variant}.{ext}` |
| 关联 eval | 配对 eval YAML 路径与版本 |
| 题目类型 | 单选 / 对错 / 多选 |
| 难度系数 | 题目难度范围和标记方式 |
| 数据来源 | `semantic_layer` / `raw_sql_fallback` / `manual_debug_only` |
| answer_binding | `exact_value` / `ranking` / `boolean` / `range_bucket` / `conceptual` |
| stale_status | `fresh` / `stale`；由 drift 级联判定维护 |

### 7.3 最小检查流程

新增或刷新 eval / quiz 后，至少执行以下检查：

| 检查项 | 通过标准 |
|---|---|
| 路径与命名 | 文件路径符合 §2 / §5，文件名带 domain |
| metadata | 必填字段齐全，关联 eval / quiz 指向真实文件 |
| 覆盖矩阵 | §3.1 六类至少各有覆盖；缺项需在 notes 中说明 |
| ground truth | `result_assertions` 可追溯到 KTX MCP、`ktx sl query --execute` 或 `ktx sql` |
| 反模式 | AVG / COUNT(*) 等禁止模式在 eval 中有明确 `sql_assertions` |
| 安全红线 | eval 文件声明 `safety_contract`，写操作、跨源 Join 和 secrets 路径有 `forbidden_ast` / 路径阻断规则 |
| 人类体验 | quiz 多选题标"多选"，选项简短，不对精确数字重复 hedge |
| drift 级联 | quiz 题目声明 `answer_binding`，data drift 后可判定是否 stale |

---

## 8. 联动与交叉引用

| 文档 | 何时引用本约定 |
|---|---|
| `MEMORY.md` | 4 条 feedback memory 是本约定的简化版；MEMORY 规则不重复写本约定，引用即可 |
| `docs/DEVELOPMENT.md` | "Spec 落位规则" 章节下应交叉引用本约定 |
| `skills/eval-quiz-builder/`（未来）| 若 eval / quiz 变季度常规任务，本约定可抽为 skill |
| `lucy-skills` MCP server（P1.5 计划）| 若实现 quiz 自动出题 / 自动批改能力，参考本约定 |

---

## 9. 反例（明确禁止）

| 反例 | 问题 | 正确做法 |
|---|---|---|
| `quiz.html` | 缺 domain，多模块并存无法区分 | `{domain}-quiz-cases.html` |
| 题干："样本期内订单销售额**大约**是多少？" 选项："约 1687 万" | known exact 数字双重 hedge | "是多少？" / "1687 万元" |
| 用 dbeaver 跑 ground truth | 绕过 SL，违背语义层一致性原则 | 自动化用 KTX MCP；人工复核用 `ktx sl query`；SL 不覆盖才用 `ktx sql` fallback |
| eval YAML 写 `result_assertions.data: 5009` 但今日实测 5083 | data drift 未标记 | 标记 drift + bump 版本 + 刷新 |
| quiz 题干："激活订单有多少" | 技术腔 | "统计一下正常订单有多少" |
| quiz 答案直接用 `AVG(discount)` | 反模式 | 用 `weighted_discount` measure |
| eval case 同一份 ground truth 既写 5009 又写 5083 不标 | 内部不一致 | 取一为 ground truth，另一标 drift |
| quiz 不标"(多选)"让用户猜 | 体验差 | 题目类型用 metadata 明示 |
| 用 `question: "第一轮...第二轮..."` 伪装多轮 | Runner 无法还原 session | 使用 `case_type: multi_turn` + `turns` |
| 新 case 继续写 `required_sql_pattern: ["COUNT(DISTINCT order_id)"]` | substring match 易误报 | 使用 `sql_assertions` 的 AST / normalized matcher |
| `multi_turn` 根层和 turn 内都写 `result_assertions` | Runner 无法判定断言来源 | `multi_turn` 只允许在 `turns[]` 内写结果断言 |
| quiz 选项硬编码数值但没有 `answer_binding` | data drift 后无法判断是否 stale | 按题型声明 `exact_value` / `ranking` 等绑定策略 |
| eval 文件没有 `safety_contract` | 安全边界只停留在文案，Runner 无法强阻断 | 文件级声明只读、secrets 路径、跨源 Join 和写操作 `forbidden_ast` |
| fallback SQL 出现 `UPDATE` / `DROP` / `TRUNCATE` | 越权写操作，必须阻断 | Runner 标记 `logic_regression`，返回 exit code `30` |

---

## 10. 待办 / 演进方向

| 项 | 说明 | 优先级 |
|---|---|---|
| 季度 eval 节奏 | 若每季度跑一次 regression，本约定可补"季度 checklist"章节 | P2 |
| 自动批改 quiz | 当前 quiz HTML 是手动 `grade()`，未来可考虑 LLM 评分 | P3 |
| 跨数据集模板验证 | 当前只覆盖 superstore；下个 domain（人 / 财 / 流程）落地时验证模板通用性 | P2 |
| lucy-skills MCP 集成 | 若 P1.5 立项落地，quiz 出题与批改可标准化 | P3 |

---

## 11. Changelog

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.4 | 2026-06-19 | 强化治理门禁：补 `safety_contract` / 全局 `forbidden_ast` 安全红线、CI exit codes、最小安全检查与安全反例 |
| v1.3 | 2026-06-18 | 收敛工业 Runner schema：补 case_type 分支互斥、独立 result_assertions、结构化 context_assertions、quiz answer_binding 与 stale 级联 |
| v1.2 | 2026-06-18 | 修正 Runner 可执行性问题：补 multi-turn schema、结构化 SQL matcher、执行环境路由、drift 状态机和 quiz 文档类型枚举 |
| v1.1 | 2026-06-18 | 统一文档版本与 superstore eval v1.2 引用；规范 fallback 说明；补齐 quiz metadata 字段表；新增最小检查流程 |
| v1.0 | 2026-06-18 | 初版，沉淀 eval / quiz 设计原则、命名、数据获取路径与同步机制 |
