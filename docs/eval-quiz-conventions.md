# project-lucy · Eval & Quiz 设计约定

| 元数据 | 内容 |
|---|---|
| 文档名称 | Eval & Quiz 设计约定 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-18 |
| 撰写人 | Claude |
| 委托人 | project-lucy 团队 |
| 基于材料 | superstore-eval-cases.yaml (v1.1, 17 cases) / superstore-quiz-cases.html (v1.0, 30 题) / 本轮 4 条 feedback memory |
| 适用范围 | 项目内任何为数据集设计 eval cases（YAML，agent 测）和 quiz HTML（人类测）的 agent 必读 |
| 输出位置 | docs/eval-quiz-conventions.md |

## 1. 目的与适用范围

本文档约定 project-lucy 仓库内 `eval cases`（YAML，机器跑）和 `quiz HTML`（人类做）两类产物的**设计原则、数据获取路径、命名规范、版本同步机制**。

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
| Eval cases | YAML | `knowledge/{domain}/eval/{domain}-eval-cases.yaml` | Agent（LLM 跑 SQL / 工具调用）| CI gate / regression |
| Quiz cases | HTML | `knowledge/{domain}/{domain}-quiz-cases.html` | 人类（业务 / 培训）| 培训 / 验收 |

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

按优先级（不得跨级）：

| 优先级 | 路径 | 用途 |
|---|---|---|
| 1 | `ktx sl query --execute` | 走 SL measures，生成 quiz ground truth 的首选 |
| 2 | KTX MCP `sl_query` / `sl_read` | 等价能力，自动化场景 |
| 3 | `ktx sql --connection-id <conn>` | **fallback**——ktx 体系的 parser-validated read-only SQL，处理 SL 表达不了的 time-grain / cohort / window function |
| 4 | （避免）dbeaver MCP / mysql CLI / 直连 | 不再作为常规 fallback |

**fallback 触发条件**：当前 SL measure / dimension 不覆盖所需分析（如 NTILE、cohort、跨年趋势）。

**fallback 前置流程**：
1. 在产物 metadata 明示"SL fallback"
2. 每条 fallback 数据点对应一次 `ktx sql` 调用，结果可追溯
3. 不复用历史 dbeaver / mysql CLI 的结果
4. 每次走 fallback 前，明示工具选择 + 原因——不要默选 dbeaver

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
| snapshot drift（数据值漂移）| 更新 `expected_result` | 更新答案解析 |

### 6.3 漂移检测

`expected_result` 中的数值若与当前 `ktx sl query --execute` 不一致，先标记为"data drift"，再决定是否更新文档（更新时 bump 版本）。

当前 superstore 的已知 drift：
- ~~`superstore-ordercount-001` / `-002` 期望 `order_count: 5009`，今日实测 5083（+74）~~ — **v1.2 (2026-06-18) 已刷新至 5083**
- 其他 case 数值一致

---

## 7. 元数据要求

### 7.1 eval YAML

`cases:` 列表下每条 case 必含：

| 字段 | 说明 |
|---|---|
| id | 唯一 ID，命名 `{domain}-{topic}-{n}` |
| question | 自然语言问句 |
| expected_source | `semantic_layer` 或 `raw_sql` |
| expected_measures | SL measure 名列表 |
| required_sql_pattern | 必须出现的 SQL 片段（字符串列表）|
| forbidden_sql_pattern | 必须不出现的 SQL 片段（字符串列表）|
| expected_result | ground truth 数值 / 结构 |
| snapshot_date | 数据快照日期 |
| notes | 设计意图 / 反模式说明 |

### 7.2 quiz HTML

HTML 顶部 metadata 注释必含（per AGENTS.md §文档输出元数据要求）：

| 字段 | 说明 |
|---|---|
| 文档名称 / 文档类型 / 版本 / 撰写日期 / 撰写人 / 委托人 / 基于材料 / 适用范围 / 输出位置 / 命名约定 / 关联 eval / 题目类型 / 难度系数 / 数据来源 |

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
| 用 dbeaver 跑 ground truth | 绕过 SL，违背语义层一致性原则 | `ktx sl query` 优先；`ktx sql` fallback |
| eval YAML 写 `expected_result: order_count: 5009` 但今日实测 5083 | data drift 未标记 | 标记 drift + bump 版本 + 刷新 |
| quiz 题干："激活订单有多少" | 技术腔 | "统计一下正常订单有多少" |
| quiz 答案直接用 `AVG(discount)` | 反模式 | 用 `weighted_discount` measure |
| eval case 同一份 ground truth 既写 5009 又写 5083 不标 | 内部不一致 | 取一为 ground truth，另一标 drift |
| quiz 不标"(多选)"让用户猜 | 体验差 | 题目类型用 metadata 明示 |

---

## 10. 待办 / 演进方向

| 项 | 说明 | 优先级 |
|---|---|---|
| ~~刷新 v1.0 老 case 的 data drift~~ | ~~superstore-ordercount-001 / -002 的 5009 → 5083；其他保持~~ — **v1.2 已完成** | ~~P0~~ |
| 季度 eval 节奏 | 若每季度跑一次 regression，本约定可补"季度 checklist"章节 | P2 |
| 自动批改 quiz | 当前 quiz HTML 是手动 `grade()`，未来可考虑 LLM 评分 | P3 |
| 跨数据集模板验证 | 当前只覆盖 superstore；下个 domain（人 / 财 / 流程）落地时验证模板通用性 | P2 |
| lucy-skills MCP 集成 | 若 P1.5 立项落地，quiz 出题与批改可标准化 | P3 |