# 企业级 Data Agent 可回答性与交付标准

| 元数据 | 内容 |
|---|---|
| 文档类型 | Spec |
| 版本 | v1.0 |
| 日期 | 2026-09-03 |
| 状态 | Implemented（规则与合成 Eval 已落地，待生产 UAT） |
| 委托人 | 张星晨 |
| 基于材料 | 脱敏后的旧版单用户对话/审计样本、现行 data QA instructions 与 eval 约定 |
| 适用范围 | 通过 Lucy MCP 的企业数据问答 Agent：分析规划、证据收集、失败恢复和最终回答 |

## 1. 背景

样本中的主要损失不只来自工具错误，还来自回答治理缺口：预算没有独立证据、实现单价被误当
纯价格、实际与预测混合但标签不足、相同错误模式反复重试，最终在已有部分证据时仍未向用户交付。

企业级 Data Agent 的最低标准不是“尽量查到数字”，而是能判断哪些问题当前可回答、哪些必须
降级，并在有限时间内交付可复核的完整或部分答案。

## 2. 目标与 Non-Goals

### 目标

- 在查询前建立指标依赖表，明确口径、期间、版本和情景。
- 缺少预算、分母、版本或业务公式时，不用近似值冒充正式答案。
- 区分 actual、forecast、budget 与 hybrid，所有混合结果显式标注。
- 约束重试、调用总量和耗时，避免工具循环吞掉最终交付。
- 最终回复逐项覆盖用户问题，并给出来源、限制和不可回答项。

### Non-Goals

- 不在本 Spec 定义客户专属预算表、价格弹性公式或管理会计口径。
- 不允许 Agent 自行创造缺失的业务公式并写入语义资产。
- 不把执行计划、`EXPLAIN` 或检索摘要当作业务结果。
- 不要求本期新增聊天 UI。

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 中文说明 | 约束 |
|---|---|---|
| Answerability Gate | 可回答性门禁 | 内部运行规则；不能用“猜测可用”代替通过门禁 |
| Hybrid Result | 混合结果 | 指 actual + forecast 等不同情景拼接，必须展示组成 |
| Realized Unit Price | 实现单价 | `revenue / quantity`，包含价格与结构影响，不得简称“纯价格” |

## 4. 可回答性依赖表

每个用户子问题在执行前必须解析为：

| 维度 | 必填内容 |
|---|---|
| 指标 | numerator、denominator、单位、聚合方式 |
| 时间 | period、grain、同比/环比基期 |
| 数据版本 | batch、latest 的验证方式、刷新时间 |
| 情景 | actual / forecast / budget / hybrid |
| 来源 | Connection、Source、measure/column |
| 业务口径 | 已发布语义定义、Wiki/Skill 权威引用或明确缺失 |

以下任一情况成立时，该子问题不能输出正式数值：

- 预算没有独立 budget measure/source/formula；forecast 不得替代 budget。
- 比率缺失分母或时间粒度不一致。
- “最新”版本未通过数据值或 metadata 验证。
- 纯价格、销量、结构拆解缺少权威公式或所需粒度。
- actual 与 forecast 被合并但无法识别各自覆盖期间。

状态使用 `ok` / `no_data` / `unavailable` / `partial`，遵循 Spec 128；口径需要业务确认时
使用 `unavailable` 并说明缺失依赖，不能返回编造的 `0`。

## 5. 经营分析边界

### 5.1 情景与期间

- actual、forecast、budget 必须分别计算再展示。
- 类似“上半年实际 + 三季度预测”的结果必须标记 `hybrid`，并列出每段覆盖期间。
- 未经证据不能把 Q3 或当前季度默认为完整 actual。

### 5.2 价格、量与结构

- `revenue / bandwidth` 或 `revenue / quantity` 只能称为实现单价。
- 实现单价变化同时可能包含报价变化、客户/产品结构变化与交互项。
- “成本结构”描述成本构成；“成本量价拆解”要求独立方法，两者不得互换。
- 若语义层或业务文档没有权威拆解公式，输出方向性观察或 `unavailable`，不得临时发明公式。

## 6. 失败恢复与预算

### 6.1 错误指纹

错误指纹至少由 `tool + source + normalized reason + relevant argument shape` 构成。
同一指纹最多允许一次有信息增益的修正重试。只在 `eq` / `=` / `in` 间循环不算信息增益。

### 6.2 调用和时间预算

复杂企业分析默认门槛：

- 业务工具调用总量不超过 12；协议调用不计入。
- 同一输入最多重复 1 次；同一错误指纹最多 1 次修正重试。
- 已读 Source 不重复读取；因瞬时错误可额外重试一次。
- 120 秒内取得首个验证过的业务结果，或向用户说明阻塞。
- 8 分钟内交付完整或部分答案；不得因尚有未完成项而无限延迟全部输出。

## 7. 核心流程（伪代码）

```text
FUNCTION answerEnterpriseQuestion(question):
  subQuestions = decompose(question)
  dependencies = buildDependencyMatrix(subQuestions)

  FOR each dependency:
    resolve semantic source, measure, period, version and scenario
    IF required definition is missing:
      mark dependency unavailable with exact missing item

  executable = dependencies eligible for query
  WHILE executable remains AND within call/time budget:
    task = highestValueUnresolved(executable)
    result = callLucy(task)

    IF result succeeds:
      validate returned metadata, period, batch, scenario and generated SQL
      store evidence; mark covered subquestions
    ELSE:
      fingerprint = normalizeError(task, result)
      IF fingerprint already retried OR correction adds no information:
        mark task unavailable/partial; do not cycle
      ELSE:
        repair arguments once and retry

  FOR each numeric claim:
    REQUIRE evidence satisfies numerator, denominator, period, version and scenario
    IF claim is realized unit price:
      label as mix-inclusive; do not claim pure price effect
    IF claim combines scenarios:
      label hybrid and enumerate periods

  final = composeAnswer(
    core findings,
    per-subquestion status,
    period/batch/scenario labels,
    unavailable dependencies,
    source provenance,
    partial flag when applicable
  )
  RETURN final even when some subquestions remain unavailable
```

## 8. 最终回答合同

最终回答至少包含：

1. 核心结论或明确的部分结论；
2. 每个子问题的 `ok/no_data/unavailable/partial` 状态；
3. 期间、版本/批次、actual/forecast/budget/hybrid 标签；
4. 不可回答项及其缺失依赖；
5. 失败对结论的影响，不能只给工具错误堆栈；
6. Provenance Footer，列出实际使用的 Source/measure/文档。

如果预算不可用，应交付实际与预测部分，并明确“预算差异当前不可计算”；不得因此不回复整轮。

## 9. Eval 与验收标准

| ID | 验收 |
|---|---|
| AG-01 | 无 budget 证据时不输出预算差异数值 |
| AG-02 | actual + forecast 合并结果明确标 `hybrid` 和分段期间 |
| AG-03 | 实现单价不被表述为纯价格效应 |
| AG-04 | 缺少拆解公式时不发明价格/量/结构贡献率 |
| AG-05 | 同错误指纹最多一次修正重试 |
| AG-06 | 复杂样本业务工具调用数不超过 12 |
| AG-07 | 部分可回答时仍产生覆盖全部子问题状态的最终回复 |
| AG-08 | 所有数值结论可追溯到 Source、指标、期间和情景 |

新增 eval 必须遵循 `docs/eval-quiz-conventions.md`，客户日志只能抽象成脱敏合成 case，不能提交
原始问题、明细数据、Token、IP 或内部库表内容。

## 10. 验证机制

- 指令合同测试：关键门禁文本由 Proxy initialize instructions 注入且不在 `CLAUDE.md` 复制。
- 合成 eval：预算缺失、hybrid、实现单价、重复错误与 partial delivery 五类 case；配套 6 题脱敏人工 Quiz 覆盖基础、反模式、边界、降级、多轮一致性与路径选择。
- 预算断言：`max_total_tool_calls`、`max_repeated_tool_input`、失败预算均由现有 eval runner 执行。
- 回放：使用脱敏后的参数形状与 mock 响应做 deterministic replay。
- 发布证据：归档 eval result JSON、suite hash、失败明细和残余限制。
- 本期只做代码/文档验证，不做 Docker 重建和浏览器验证。
