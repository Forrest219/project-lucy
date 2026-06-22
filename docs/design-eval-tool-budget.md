# Eval Tool-Budget Design

| 元数据 | 内容 |
|---|---|
| 文档名称 | Eval Tool-Budget Design |
| 文档类型 | Design |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-22 |
| 适用范围 | `scripts/eval-runner.mjs`、`evals/*/eval/*-eval-cases.yaml`、WebUI Eval run 展示 |
| 背景 | KTX MCP usage 复盘显示 `sql_execution` 与 `sl_read_source` 调用占比高，A3 目标是把“少重复调用”变成可测回归约束 |

## 1. 结论

可以进入 A3 设计后的开发预备，但不建议一次性改完整 WebUI。

当前 CLI runner 已经能从 Claude Code `stream-json` 中解析 `tool_use`，并把它们放入
`parsed.toolCalls`；现有 `tool_assertions` 也能做 `required_tool` / `forbidden_tool`
和 input regex 校验。缺口在于：

- 没有按 case 统计工具调用次数、重复 source、重复 input。
- 没有预算型断言，例如“同一 `sourceName` 最多读取 1 次”。
- WebUI SQLite `eval_run_case` 没有保存 tool summary / budget failures。
- 现有 `classifyDrift()` 会把包含 `tool` 的 failure 归入 `tool_error`，预算失败需要避免被误判为基础设施错误。

因此 A3 应先做 runner 侧最小增量，再给 KX Financial 关键 case 加预算断言，最后再补
WebUI 展示。

## 2. 当前能力

已存在能力：

- `scripts/eval-runner.mjs::parseClaudeOutput()` 提取：
  - `toolCalls`: `{ id, name, input }[]`
  - `toolCandidates`: 可从 KTX tool result 中恢复 SQL / result 的候选列表。
- `scripts/eval-runner.mjs::checkToolAssertions()` 支持：
  - `required_tool`
  - `forbidden_tool`
  - `required_tool_input_regex`
  - `forbidden_tool_input_regex`
- `evals/kx_financial/eval/kx_financial-eval-cases.yaml` 已经在部分 semantic-layer case 中使用
  `tool_assertions`。

缺失能力：

- 不支持 `max_tool_calls`、`max_total_tool_calls`、`max_repeated_tool_input`。
- Summary case 不输出 `toolSummary` / `budgetFailures`。
- WebUI DB 只存 `sql`、`result_raw`、`actual_raw`、`failed_assertions`、`final_text`，不存工具调用摘要。

## 3. 设计目标

1. 对每个 eval case 输出工具调用摘要。
2. 支持预算型 `tool_assertions`，让效率回归可以阻断或告警。
3. 预算失败不覆盖正确性断言；最终仍同时保留 SQL / result / text 检查。
4. 不把 KTX proxy-only 工具写入直连 KTX agent 的必调用路径。
5. 不存 bearer token、headers、secret path 内容。

## 4. 非目标

- 不在 A3 改 `CLAUDE.md`。
- 不在 A3 改 Lucy MCP Proxy 缓存。
- 不把 usage 周报中的 1,965 次统计硬编码进 eval cases。
- 不要求所有 case 都必须有预算；先覆盖 KX 财务高风险路径。

## 5. Tool Summary

Runner 每个 case 应生成稳定摘要：

```json
{
  "toolSummary": {
    "total": 5,
    "byTool": {
      "mcp__ktx__sl_read_source": 3,
      "mcp__ktx__sql_execution": 1,
      "mcp__ktx__connection_list": 1
    },
    "ktxByShortName": {
      "sl_read_source": 3,
      "sql_execution": 1,
      "connection_list": 1
    },
    "inputValueCounts": {
      "mcp__ktx__sl_read_source:sourceName": {
        "kx_fact_financial_amount": 1,
        "kx_dim_company": 1,
        "kx_dim_financial_item": 1
      }
    }
  }
}
```

`toolCalls` 原始列表可保留在 JSON artifact 中，但 WebUI 默认展示 `toolSummary`。原始 input
只允许记录 tool input，不记录 MCP headers、tokens 或 transport config。

## 6. Assertion Schema

继续复用 `tool_assertions`，新增预算型断言，避免引入第二套工具断言字段。

### 6.1 `max_total_tool_calls`

限制单 case 或单 turn 的全部工具调用数：

```yaml
tool_assertions:
  - type: max_total_tool_calls
    max: 6
    reason: 简单口径题不应发生大规模探索。
```

### 6.2 `max_tool_calls`

限制某个工具的调用次数：

```yaml
tool_assertions:
  - type: max_tool_calls
    tool: mcp__ktx__connection_list
    max: 0
    reason: 单 connection 项目中，已知 KX 财务 case 不应反复读取 connection_list。
```

`tool` 支持精确工具名；后续可扩展为 regex，但首版不需要。

### 6.3 `max_repeated_tool_input`

限制同一工具、同一 input path 的重复值：

```yaml
tool_assertions:
  - type: max_repeated_tool_input
    tool: mcp__ktx__sl_read_source
    input_path: sourceName
    max_per_value: 1
    reason: 同一 case 内同一个 sourceName 不应重复读取。
```

首版只支持一层 input path，例如 `sourceName`、`connectionId`。嵌套路径可后置。

### 6.4 `max_tool_calls_by_input`

限制某个工具在指定 input 条件下的调用次数：

```yaml
tool_assertions:
  - type: max_tool_calls_by_input
    tool: mcp__ktx__sl_read_source
    input_path: sourceName
    value: kx_fact_financial_amount
    max: 1
    reason: 金额事实表 source 定义最多读取一次。
```

该类型适合少数关键 source；大多数场景用 `max_repeated_tool_input` 即可。

## 7. Failure Semantics

预算失败应使用明确前缀：

```text
budget: max_tool_calls mcp__ktx__connection_list actual=2 max=0
budget: max_repeated_tool_input mcp__ktx__sl_read_source.sourceName value=kx_fact_financial_amount actual=2 max=1
```

Runner drift 分类需先识别 `budget:`，再识别 `tool` 基础设施错误。

首版建议：

- `budget:` 归入 `logic_regression`。
- 不新增 DB 枚举，降低 WebUI 改动面。
- 后续如果 budget 失败需要单独趋势图，再新增 `efficiency_regression` drift。

原因：预算失败是 agent 行为回归，不是 KTX tool 不可用；不能归为 `tool_error`。

## 8. KX Financial 首批预算建议

### 8.1 Source 路由类

适用 case：

- `kx-routing-001`
- `kx-schema-001`

建议预算：

```yaml
tool_assertions:
  - type: max_tool_calls
    tool: mcp__ktx__connection_list
    max: 0
    reason: 已知单 connection eval 不需要读取 connection_list。
  - type: max_repeated_tool_input
    tool: mcp__ktx__sl_read_source
    input_path: sourceName
    max_per_value: 1
    reason: 同一 source 定义不应重复读取。
```

`kx-schema-001` 可以允许 `discover_data`，因为题目本身是 source 数量/catalog 问题。
`kx-routing-001` 也可允许一次 catalog/search 行为，但不应读取同一 source 多次。

### 8.2 已知 source 规则类

适用 case：

- `kx-filter-001`
- `kx-source-file-001`
- `kx-amount-type-001`

建议预算：

```yaml
tool_assertions:
  - type: forbidden_tool
    value: mcp__ktx__connection_list
    reason: 已知 KX source 规则题不需要重新列 connection。
  - type: max_tool_calls
    tool: mcp__ktx__discover_data
    max: 1
    reason: 已知 KX source 规则题最多允许一次 broad discovery。
  - type: max_repeated_tool_input
    tool: mcp__ktx__sl_read_source
    input_path: sourceName
    max_per_value: 1
    reason: 同一 sourceName 不重复读取。
```

### 8.3 Raw SQL fallback 数值类

适用 case：

- `kx-rowcount-001`
- `kx-period-001`
- `kx-income-001`
- `kx-balance-001`
- `kx-cashflow-001`
- `kx-null-001`
- `kx-quarter-001`

建议预算：

```yaml
tool_assertions:
  - type: max_tool_calls
    tool: mcp__ktx__connection_list
    max: 0
    reason: 题目已指定 KX 财务域和 connection，简单 SQL case 不应列 connection。
  - type: max_tool_calls
    tool: mcp__ktx__sql_execution
    max: 2
    reason: 允许一次主查询和一次修正查询；超过 2 次视为探索过多。
  - type: max_repeated_tool_input
    tool: mcp__ktx__sl_read_source
    input_path: sourceName
    max_per_value: 1
    reason: 若读取 source 定义，同一 source 不重复读取。
```

### 8.4 多轮一致性类

适用 case：

- `kx-multiturn-001`

建议分两层：

- turn 内：`sql_execution <= 2`，`connection_list = 0`。
- case 总体：同一 `sourceName` 读取不超过 1 次；如首轮已读取 source，后续轮次不重复读取。

首版 runner 若只支持 turn-level，可先把预算放入每个 `turn.tool_assertions`；case-level
跨 turn 汇总作为第二步。

## 9. Runner Implementation Plan

### Step 1：tool summary helper

在 `scripts/eval-runner.mjs` 增加纯函数：

- `shortToolName(name)`
- `summarizeToolCalls(toolCalls)`
- `inputValueAtPath(input, path)`

输出 `toolSummary`。

### Step 2：扩展 `checkToolAssertions`

在现有函数中新增类型：

- `max_total_tool_calls`
- `max_tool_calls`
- `max_repeated_tool_input`
- `max_tool_calls_by_input`

保留现有 required/forbidden 语义。

### Step 3：summary 输出

`runSingleTurnCase()` 返回：

- `toolCalls`
- `toolSummary`
- `budgetFailures`

Markdown 输出增加一小段：

```markdown
- tools: total 5; sl_read_source 3; sql_execution 1; connection_list 1
```

失败时展示 `budget:` failure。

### Step 4：drift 分类

`webui/server/eval/runner.ts::classifyDrift()` 增加优先级：

```ts
if (joined.includes("budget:")) return "logic_regression";
```

放在 `tool_error` 判断之前。

### Step 5：WebUI DB 最小字段

给 `eval_run_case` 增加可空 JSON 文本列：

- `tool_calls_raw`
- `tool_summary_raw`
- `budget_failures`

`mapSummaryCaseToRunCase()` 透传这些字段；RunDetail API 解析返回。

如果希望最小化首批工作，也可以先不改 DB，只让 JSON artifact 保存 `toolSummary`；但这样
WebUI 详情页看不到预算摘要，不利于日常治理。

## 10. Test Plan

### Unit tests

给 runner helper 增加 Node 级单测或将纯函数导出到测试文件：

- `summarizeToolCalls()` 能统计 byTool / inputValueCounts。
- `max_tool_calls` 超限时产生 `budget:` failure。
- `max_repeated_tool_input` 对同一 `sourceName` 重复读取产生 failure。
- `required_tool` / `forbidden_tool` 现有行为不回归。

### WebUI contract tests

扩展 `webui/server/__tests__/eval-runner-contract.test.ts`：

- `mapSummaryCaseToRunCase()` 能保存 `tool_summary_raw` / `budget_failures`。
- `budget:` failure 分类为 `logic_regression`，不是 `tool_error`。

### Fixture test

新增一个静态 Claude stream-json fixture，包含：

- 2 次同名 `mcp__ktx__sl_read_source`。
- 1 次 `mcp__ktx__connection_list`。
- 1 次 `mcp__ktx__sql_execution`。

用于锁定 parse + budget 行为，不依赖真实 Claude / KTX。

## 11. Rollout

1. Runner 支持预算断言，但不修改 YAML，确认现有 eval 不变。
2. 给 3 个 KX semantic-layer case 增加预算断言，观察是否过严。
3. 给 raw SQL fallback 数值 case 增加 `connection_list = 0` 与 `sql_execution <= 2`。
4. 再评估是否把 budget failure 单独做成 `efficiency_regression` drift。

## 12. Go / No-Go

可以进入开发的部分：

- Runner tool summary helper。
- `tool_assertions` 预算类型。
- `budget:` 分类修正。
- KX Financial 少量 case 试点预算断言。

暂不进入的部分：

- 修改 `CLAUDE.md`。
- proxy cache。
- 大规模重写 WebUI Eval UI。
- 把所有 domain 的所有 case 一次性加预算。
