# Eval 升级建议：结果 / 策略分轴、上下文消融、拒答与轨迹晋升

| 元数据 | 内容 |
|---|---|
| 文档名称 | Eval Result / Policy Split, Context Ablation, Refusal Cases, and Trace Promotion |
| 文档类型 | Product / Architecture Optimization Plan（形态 A：目标态与优先级，**不含**实现工单） |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-11 |
| 委托人 | xingchen |
| 基于材料 | 2026-10-11 对 Lucy evals 的代码与套件清点；知识库中的 agent eval 笔记；公网 2026 年数据分析 agent 评测材料 |
| 关联文档 | [`2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md`](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md)、[`../design/design-eval-monitoring.md`](../design/design-eval-monitoring.md)、[`../design/design-eval-tool-budget.md`](../design/design-eval-tool-budget.md)、[`../governance/eval-quiz-conventions.md`](../governance/eval-quiz-conventions.md)、[`../../webui/docs/132-governed-skill-abtest-and-evaluation-benchmark-spec.md`](../../webui/docs/132-governed-skill-abtest-and-evaluation-benchmark-spec.md)、[`../../webui/docs/65-safe-log-to-eval-spec.md`](../../webui/docs/65-safe-log-to-eval-spec.md) |
| 事实源代码 | [`scripts/eval/eval-runner.mjs`](../../scripts/eval/eval-runner.mjs) `evaluateCandidate`、[`webui/server/eval/runner.ts`](../../webui/server/eval/runner.ts)、[`webui/server/eval/db.ts`](../../webui/server/eval/db.ts)、`evals/*/eval/*-eval-cases.yaml` |
| 输出位置 | `docs/plans/2026-10-11-eval-result-policy-context-upgrade.md` |

本文是升级方向建议。它冻结优先级、分数语义和验收口径，不拆工单，不改 runner。

---

## 1. 结论

下一轮按依赖排序，后一项读取前一项产出的分数：

| 优先级 | 升级 | 做完的标志 |
|---|---|---|
| **P0** | 把一次运行的分数拆成**结果、策略、解释**三轴。发布通过率只计可回答数值题的结果轴 | 数字正确且使用了 `AVG(discount)` 时，结果通过、策略失败。`chatbi_intl` 的 80 道文本题退出通过率分母 |
| **P1** | 用 Spec 132 已写的三道陷阱题，对同一份 YAML 跑四臂：裸 schema、空脚手架、完整语义、预计算指标 | superstore 三道题给出结果轴差值。Skill 是否被读到记在策略轴 |
| **P2** | 用例增加三种结局：作答、拒答、先澄清再作答 | 答不了的题给出确定数字，结果失败；点名缺口并拒答，结果通过 |
| **P3** | 业务问答轨迹沿用安全候选的抽取、复核、晋升。90 天未再失败的题移出 golden | 同一失败至少出现两次，人工复核后才进入套件 |

本月只做 P0 也成立。P1、P2、P3 不要并行开工。

[`2026-08-26` 的准确率闭环与变更触发回归](2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md) 仍是运营项，与 P0 **并行**，不插到这四项前面。那个方案到 2026-10-11 仍未落地：`runner.ts` 插入运行记录时把 `trigger` 写成 `manual`；`consecutiveFailThreshold` 只保存在 Monitor 配置里，不参与判定。

---

## 2. 为何是这个顺序

`evaluateCandidate` 把 SQL 断言、结果断言、文本断言、安全契约和工具预算收成一个 `ok`。`score_raw` 的现有形状是 `{ status, classification, failures }`。Monitor 的 `pass_count` 因此分不清「数字错了」和「路径不合规」。

后面三项都会读这个通过率：

- 四臂消融比的是准确率。混合分会把工具预算失败算成语义层没有生效。
- 拒答题没有结果集。在现行断言里，诚实拒答会被判失败。
- 轨迹晋升需要失败能标成结果、策略、解释或拒答。混合失败会把噪声写进套件。

所以 P0 是阻塞项。P1 证明上下文层里哪一层在起作用。P2 让结果轴承认「不给数字」可以是正确结局。P3 等失败分类稳定，并且某个 domain 已经有重复的真实提问，再打开。

---

## 3. 现状基线（2026-10-11）

### 3.1 判分

| 已有 | 缺口 |
|---|---|
| 结果断言（标量 / 表）、SQL AST、只读与跨源契约、工具次数预算 | 全部失败合成一个 PASS/FAIL |
| `eval_run_case.score_raw`、`budget_failures`、`failure_classification` 已落库 | `score_raw` 仍是单值状态，不是三轴 |
| 禁止 AST、工具预算被归入 `logic_regression` | 策略失败与结果失真共用一个漂移类 |

### 3.2 套件

| 套件 | 规模 | 清点结论 |
|---|---|---|
| `evals/chatbi_intl` | 100 | 2026-08-06 写入。20 道标量，80 道 `value_type: text`。全部 `expected_source: semantic_layer` |
| `evals/superstore` | 17 | 快照日 2026-06-18。16 道单轮，1 道多轮。约定中的六维覆盖和 `gate_tier` 没有写进用例 |
| `evals/agent_reliability` | 5 | 带工具预算断言 |
| `examples/executive-poc` | 15 | 模板套件 |
| demo superstore | 7 | `examples/docker-demo` 与 `examples/postgres-demo` 各一份 |
| `customer-config.example` 的 `ceo_one_report` | 1 | 交付空壳 |

### 3.3 已有、本建议直接复用的能力

- Spec 132 已写下三道陷阱题和对照指标：加权折扣、退货过滤、杜邦时点与期间错配。规格未进入评测运行参数。
- 安全候选已有抽取、复核、晋升（`security_eval_candidate`）。业务问答飞轮在 8 月 26 日方案的 Wave 3 挂号，尚未做。
- 用例 YAML 与语义层同库，确定性别分优先。这一点与 Cube Evals（2026-06-25）的起点一致，保留。

---

## 4. P0：三轴分数

### 4.1 分数语义

一次 trial 写入三轴，各自取 `pass` 或 `fail`。缺该轴断言时记 `na`，不进该轴分母。

| 轴 | 计入什么 | 发布通过率 |
|---|---|---|
| **结果** | 标量或结果表的执行对照。列名、别名、SQL 写法可以不同，结果集一致即通过 | **只计** `outcome: answer` 的结果轴 |
| **策略** | 只读契约、禁止 AST、跨源限制、工具预算、必用工具、Skill 被读取的审计证据 | 单独成率，可见，不翻结果通过 |
| **解释** | `must_mention` 等文本包含断言 | 运行详情可见，不进发布通过率 |

示例：结果中的加权折扣与 ground truth 一致，但 SQL 使用 `AVG(discount)`。结果轴通过，策略轴失败。domain 准确率只随结果轴变化。

`chatbi_intl` 的 80 道文本题标为解释轴，离开 `pass_count` 分母。20 道标量留在结果轴。

### 4.2 落点

- `score_raw` 扩展为 `{ result, policy, explanation }`，每轴含 `status` 与 `failures`。旧运行保持现有单值，不回填。
- `evaluateCandidate` 继续计算现有断言，按断言种类分轴汇总。`ok` 不再作为发布通过率的唯一来源。
- Monitor 的通过率、连续跌破（一旦 8 月 26 日方案落地）使用结果轴。策略失败和解释失败在运行详情与单独比率中展示。
- 历史 `pass_count` 语义在新运行上改为「结果轴通过数」。文档和页面文案写明分母是可回答数值题。

### 4.3 验收

| ID | 场景 | 期望 |
|---|---|---|
| P0-1 | 数值一致，且命中禁止 AST | 结果 `pass`，策略 `fail`，该题计入结果通过 |
| P0-2 | 数值不一致，策略全部满足 | 结果 `fail`，策略 `pass`，该题不计入结果通过 |
| P0-3 | 仅有文本包含断言的 chatbi 题 | 解释轴有结论；不进入发布通过率分母 |
| P0-4 | 打开 2026-10-11 之前的运行 | 仍显示原来的单值 PASS/FAIL |

---

## 5. P1：单域四臂消融

P0 的结果轴可以单独阅读之后再做。目的是回答：准确率来自语义内容、检索脚手架，还是预计算指标。

### 5.1 题目与臂

题目使用 Spec 132 的三道，放在 superstore / KX 已有口径上，YAML 只保留一份。臂是运行参数 `context_arm`：

| 臂 | 给 Agent 的上下文 |
|---|---|
| `bare` | 裸 schema |
| `hollow` | 工具与目录还在，语义说明被抽空 |
| `full` | 现行语义层、wiki、Skill |
| `compiled` | 同一口径做成可调用的预计算指标 |

比较结果轴通过率、工具次数和 token。`hollow` 用来确认「有工具、没有口径」不把脚手架本身记成准确率。Skill 是否被读到记在策略轴，沿用 Spec 132 的审计检验，不另造确权通道。

预计算指标只加在 `full` 臂结果轴仍然失败的度量上。三次都通过的比例只在这三道 golden 上报告，不铺到 `chatbi_intl` 的 100 题。

### 5.2 验收

| ID | 场景 | 期望 |
|---|---|---|
| P1-1 | 三道题各跑四臂 | 每臂有独立运行，题目 id 相同，`context_arm` 可审计 |
| P1-2 | 报告 | 给出结果轴通过率差值、工具次数和 token；策略轴单独列出 Skill 读取 |
| P1-3 | `compiled` | 只覆盖 `full` 臂结果失败的度量 |

---

## 6. P2：三种结局

结果轴先承认「没有可对照的结果集」可以是正确结局，再加题。结局字段：

| `outcome` | 通过条件 |
|---|---|
| `answer` | 结果轴执行对照通过。即现行数值题 |
| `refuse` | 点名缺口（指标不存在、数据不覆盖、问题超出语义层），并且最终文本不给出确定数字 |
| `clarify` | 第一轮提出会改变数字的澄清；第二轮在澄清后的结果上做执行对照 |

先加在 superstore：一个语义层没有的指标、一个粒度含糊的问题、一个缺少会改数字的过滤。每个在用 domain 保持数道，放入该 domain 的 golden。答不了的题若给出确定数字，结果轴失败。

### 6.1 验收

| ID | 场景 | 期望 |
|---|---|---|
| P2-1 | 指标不在语义层，Agent 点名缺口且不给数字 | 结果 `pass` |
| P2-2 | 同一题给出确定数字 | 结果 `fail` |
| P2-3 | 澄清题 | 第一轮未澄清则失败；第二轮才做结果对照 |

---

## 7. P3：业务轨迹晋升

打开条件：P0 的失败能标成结果、策略、解释或拒答，并且某个 domain 已经出现重复的真实提问。在此之前保持关闭。

机制复用安全候选的三段：抽取、复核、晋升。业务池只收数据问答轨迹；安全池继续只收权限拒绝。候选带上失败轴。同一失败至少出现两次，人工复核后才写入 eval YAML。

golden 中 90 天没有再失败的题移出发布门，保留为能力集或归档。安全候选的晋升规则不变。

### 7.1 验收

| ID | 场景 | 期望 |
|---|---|---|
| P3-1 | 单次业务失败 | 可进入候选，不能直接晋升 |
| P3-2 | 同一失败至少两次且复核通过 | 生成一条带失败轴的用例 |
| P3-3 | 权限拒绝 | 仍走安全候选，不进业务池 |
| P3-4 | golden 题 90 天未再失败 | 移出发布通过率分母 |

---

## 8. 与 8 月 26 日方案的边界

| 项 | 归属 |
|---|---|
| Publish 后 `post_save_hook`、domain 映射、`gate_tier: smoke`、连续跌破判定与 Webhook | 8 月 26 日方案。与 P0 并行。落地后，连续跌破的通过率改读本方案的结果轴 |
| 三轴分数、四臂、拒答、业务轨迹晋升 | 本方案 |
| 产品内 cron、自动出题、用模型判分做发布门禁、把套件扩成公开榜 | 两份方案都不做 |
| 模型判分 | 只可能出现在解释轴，且先有人工校准集。不进入 P0–P3 的发布门 |

多次试验的一致性（三次都通过）是 P1 三道 golden 的报告项，不是独立项目，也不在百题套件上运行。

---

## 9. 依据

仓库内：

- 知识库笔记：Ben Hylak《How to Eval AI Agents》（页面标注 2026-05）；Anthropic 评测与上下文工程合成笔记（2026-06-12）；Braintrust 阶段论（2026-04-29）；评测飞轮摘要。
- 套件与 runner 清点日期：2026-10-11。

公网：

| 材料 | 用在哪一条 |
|---|---|
| [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026-01-09） | 结果优先于路径文本；代码判分优先；面向用户的一致性看多次都通过。多次试验只放在 P1 golden |
| [Cube, Introducing Cube Evals](https://cube.dev/blog/introducing-cube-evals)（2026-06-25）与[产品文档](https://docs.cube.dev/admin/ai/evals) | 结果集对照、用例随数据模型版本化、发布门保持确定性 |
| ROSE, ACL 2026 long paper 257 | 执行准确率与 SQL 文本匹配会把等价写法判错。支持结果轴与策略轴分离 |
| VLDB Text2SQL-Eval；ICDE 2026 extended abstract *When Text-to-SQL Evaluation Misleads* | 同上，结果对照要容忍列集与写法差异 |
| [arXiv 2609.22259](https://arxiv.org/html/2609.22259v1) | 四臂：语义内容、脚手架、预计算指标分开测。DABStep 难题上，补回语义后四个模型由 13.9%、22.6%、22.9%、37.0% 到 55.1%、56.6%、68.4%、77.4% |
| [arXiv 2607.23340](https://arxiv.org/abs/2607.23340v1) ABISS | 含糊与答不了的问题要单独成题；澄清之后仍要判最终 SQL |

公网数字是外部基准上的公开结果，不是 Lucy 的测量。

---

## 10. 术语

用户可见文案遵守 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)：使用「质量评测 / 评测用例 / 运行 / 通过率」。`结果轴`、`策略轴`、`解释轴`、`context_arm` 若进入界面，实现 Spec 时补术语表。本文不引入新的产品菜单名。
