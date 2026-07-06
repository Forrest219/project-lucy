# CEO 一眼报 SOW 可信 Eval/UAT Contract

| 元数据 | 内容 |
|---|---|
| 文档名称 | CEO 一眼报 SOW 可信 Eval/UAT Contract |
| 文档类型 | Product Contract / Eval Runtime Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-06 |
| 适用范围 | Lucy 产品层 Eval/UAT 闭环：trace、评分、多轮、context evidence、runtime reviewer、平台报告、observability |
| 关联文档 | `docs/ceo-one-report-sow-product-risk-register.md`, `docs/eval-quiz-conventions.md`, `docs/test-layers-and-release-gates.md` |

## 1. Scope

本 contract 只定义 Lucy 产品能力，不定义 CEO 一眼报数据主题、BI/rpt/SQL 解析、benchmark 签字值或业务 owner 审批流程。

SOW 可信验收 case 必须能回答三个问题：

1. 这道题是否真实经过 Lucy 受控链路。
2. 这道题是否按可复跑规则自动评分。
3. 失败时能否定位到 case、turn、tool、trace、context 或 reviewer gate。

## 2. Eval Case Schema 增量字段

旧 case 继续兼容；只有 SOW/主题级 gate 会强制以下字段。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---:|---|
| `trace_required` | boolean | `false` | `true` 时每个 case 必须有唯一 `traceId`，并能关联到工具调用或 Lucy metadata |
| `context_required` | boolean/object | `false` | `true` 时必须捕获 wiki/context evidence；object 可声明 `keys`、`titles`、`queries` |
| `risk_tags` | string[] | `[]` | 例如 `sow_p0`, `trace`, `context`, `multiturn`, `reviewer_gate` |
| `scoring` | object | `{}` | 结构化评分扩展；新 case 优先使用它补充 `result_assertions` |
| `turns` | object[] | legacy | 多轮 case 的逐轮用户问题、断言、继承约束 |

`context_required` object 示例：

```yaml
context_required:
  keys:
    - global/superstore-analysis-playbook.md
  titles:
    - Superstore
```

`scoring` object 当前支持：

```yaml
scoring:
  require_refusal_reason: true
  allowed_failure_classifications:
    - logic_regression
    - data_drift
```

## 3. Per-Case Artifact

Runner 和 agent E2E 必须输出同形态 artifact，字段缺失时保留 `null` 或空数组，不改字段名：

```json
{
  "caseId": "domain-topic-001",
  "profile": "main",
  "traceId": "eval-domain-topic-001-...",
  "turns": [],
  "toolCalls": [],
  "semanticQueries": [],
  "wikiContextEvidence": [],
  "lucyMeta": [],
  "finalAnswer": "",
  "score": {
    "status": "pass",
    "failures": [],
    "classification": "pass"
  },
  "failureClassification": "pass"
}
```

Trace 规则：

- `trace_required: true` 时，`traceId` 必须存在且本次 run 内唯一。
- `traceId` 优先取 Lucy `_meta.lucy.traceId` / `traceId` / `turnId`；没有上游 trace 时，runner 生成确定性 run-local trace，并标记 `generated: true`。
- 若 case 要求 Lucy metadata，但工具调用中没有可关联 metadata，则该 case fail-closed。

Context evidence 规则：

- `context_required` 为真时，必须出现 `wiki_search`、`wiki_read` 或等价 context evidence。
- Evidence 至少包含 `toolName` 和可读摘要；能提取时记录 `key`、`title`、`snippet`。
- 仅最终答案提到口径不算 context evidence。

## 4. Run-Level E2E Summary

SOW 可信 E2E 的 run-level evidence 必须让每个 rate 指标带分子、分母和值；不得只输出一个百分比或 boolean。

标准字段：

| 指标 | 必填字段 | 说明 |
|---|---|---|
| 整体通过率 | `passedChecks`, `totalChecks`, `passRate` | `passRate = passedChecks / totalChecks` |
| 评分通过率 | `scorePassCases`, `scoreTotalCases`, `scorePassRate` | 只统计 agent case 的自动评分结果 |
| Trace 覆盖率 | `tracedCases`, `agentCaseCount`, `traceCoverageRate` | `traceCoverage` boolean 可保留兼容，但标准展示使用 rate |
| Trace 唯一率 | `uniqueTraces`, `agentCaseCount`, `traceUniquenessRate` | 用于识别重复 trace |
| Artifact 完整度 | `artifactCompleteCases`, `artifactTotalCases`, `artifactCompleteness` | 每个 agent case 是否有 per-case artifact |
| Allow 放行率 | `accessControl.allowPass`, `accessControl.allowTotal`, `accessControl.allowPassRate` | 权限允许类检查 |
| Deny 拦截率 | `accessControl.denyPass`, `accessControl.denyTotal`, `accessControl.denyPassRate` | 权限拒绝类检查 |

HTML Summary 必须以 `100% (x/y)` 形态展示关键 rate，例如 `评分通过率 100% (2/2 cases)`、`Deny 拦截率 100% (12/12 hits)`。这样一眼报截图也能保留样本量。

## 5. Runtime Reviewer Gates

以下 reviewer rule 进入可执行 gate；命中时归类为 `logic_regression`：

- 禁止重复分母求和、禁止 `avg(ratio)` 或 `AVG(*_ratio/*_margin)`。
- 禁止绕开 Lucy/KTX 受控工具凭记忆回答。
- 禁止读取或输出 `.ktx/secrets/`、token、password、secret。
- 禁止越权泄露被 ACL 隐藏的 source/wiki。

## 6. Acceptance

SOW P0 主题级 gate 通过条件：

- `trace_required` case trace 覆盖率 100%，trace 唯一性 100%。
- `context_required` case context evidence 覆盖率 100%。
- 多轮 case 每轮有独立 turn artifact，继承断言不漂移。
- 自动评分结果可复跑，失败稳定输出分类和原因。
- 报告能按 case 展示 trace、tool、context、score、final answer。
- 证据包 `npm run package:sow-trust-evidence -- --strict` 必须返回 `READY`；缺少 run-level rate 分子/分母字段时不得通过。
