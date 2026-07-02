# KTX `sl_query` 结构化 Filter 调研报告

| 元数据 | 内容 |
|---|---|
| 文档名称 | KTX sl_query 结构化 Filter 调研报告 |
| 文档类型 | Research / Spike |
| 撰写日期 | 2026-06-22 |
| 调研目的 | 评估 Path B（proxy 层注入 region/product-line filter 实现行级权限）的可行性前提 |

## 1. 结论（一句话）

**支持，且是 engine 强制的真安全边界**：`sl_query` 的 MCP `inputSchema` 本身就是结构化参数（`measures`/`dimensions`/`filters`/`segments`/...），**不存在自由文本 NL 字段**——调用方（无论是 agent 还是 Lucy proxy）传入的 `filters: string[]` 数组由 KTX 语义层 parser/generator/planner 直接解析为 SQL `WHERE` 谓词后编译执行，不经过任何 LLM 二次解释，agent 无法通过"不老实"绕过 proxy 注入的 filter。

## 2. 证据

**Tool 注册与 schema**（0.13.0，本机 KTX 源码克隆 `/Users/forrest/Projects/ktx/ktx`，与 project-lucy `Dockerfile` 所 pin 版本一致）：

`packages/cli/src/context/mcp/context-tools.ts:124-151`
```ts
const slQuerySchema = z.object({
  connectionId: connectionIdSchema.optional()...,
  measures: z.array(slQueryMeasureSchema).min(1)...,
  dimensions: z.array(slQueryDimensionSchema).default([])...,
  filters: z
    .array(z.string().describe('Semantic-layer filter expression, e.g. "orders.status = paid".'))
    .default([])
    .describe('Semantic-layer filter expressions to apply.'),
  segments: z
    .array(z.string().describe('Semantic-layer segment key to apply.'))
    .default([])
    .describe('Semantic-layer segment keys to apply.'),
  order_by: z.array(slQueryOrderBySchema).default([])...,
  limit: z.number().int().min(0).default(1000)...,
  include_empty: z.boolean().default(true)...,
  include: z.array(z.enum(['plan', 'sql'])).default([])...,
});
```

注意：整个 schema **没有任何 "question"/"prompt" 类自由文本字段**。`sl_query` 从协议层面就是结构化调用，NL→结构化的转换发生在调用方（Claude/Codex 等 agent）的推理过程中，*在 MCP 请求发出之前*；KTX 收到的永远是已结构化的 `filters: string[]`。

**Filter 实际下传到 engine，不经 LLM**（`context-tools.ts:763-780`）：
```ts
async (input, context) => {
  const result = await semanticLayer.query(
    { connectionId: input.connectionId,
      query: { measures: input.measures, dimensions: input.dimensions,
               filters: input.filters, segments: input.segments,
               order_by: input.order_by, limit: input.limit,
               include_empty: input.include_empty } },
    ...);
  return jsonToolResult(projectSlQueryResult(result, input.include));
}
```

**Filter 由 parser 解析为谓词（非投影）**——`python/ktx-sl/semantic_layer/parser.py:218`，`def parse_predicate(expr: str, dialect: str) -> exp.Expression`。最近一次提交 `fb50c11d "fix(sl): parse user filter expressions as predicates, not projections (#307)"`（2026-06-19，已含于 0.13.0）专门修复了"用户传入的 filter 字符串在某些方言下被误解析为投影别名（`'value' AS col` 而非 `col = 'value'`）"的 bug，证明 filter 字符串确实经过专门的 SQL 谓词解析路径，而不是塞进某个发给模型的 NL prompt 里。

测试覆盖方言：`python/ktx-sl/tests/test_tsql_filter_alias_regression.py:81` — `DIALECTS = ["tsql", "postgres", "snowflake", "bigquery"]`。MySQL 不在这份回归测试的显式方言列表里，但 `parse_predicate(expr, dialect)` 是按 dialect 参数化的通用函数（基于 sqlglot，`mysql` 是 sqlglot 标准支持方言），机制本身不是 tsql 专用补丁——属于推断，非直接验证 mysql 用例通过。

## 3. 版本差异

0.12.0（本机已装，`/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx`）与 0.13.0（project-lucy Dockerfile pin）的 `slQuerySchema` **逐字段比对完全一致**（含 `filters`/`segments` 字段定义、描述文案），已直接读取两份 `context-tools.js`/`.ts` 源码确认。差异仅在于 0.13.0 修复了 filter 字符串在 T-SQL 方言下被误解析为投影别名的 bug——这是解析正确性修复，不是 schema 变更，不影响"是否支持结构化 filter"的结论本身。

**未能验证**：MySQL 方言下 equality filter 是否在 0.12.0 上也存在同样的别名误解析 bug（回归测试列表不含 mysql，且未实际跑测）。若 Path B 要在生产环境（Aliyun RDS MySQL）使用 0.13.0 之前的引擎版本，建议补一条 mysql 方言的同类回归测试再上线，而非假设安全。project-lucy 本身用的是 0.13.0（已修复），无需关注此风险。

## 4. 对 Path B 的影响

**结论：Path B 可行**，因为 filter 是 engine 强制谓词，不是 prompt hint。代理层改造范围大致为：

1. `mcp-proxy.ts` 当前对所有请求做字节级 pass-through（`forwardToKtx` 直接转发原始 `body` buffer）。需要新增一步：在 ACL 校验通过、转发前，针对 `method === "tools/call"` 且 `params.name === "sl_query"` 的请求，解析 JSON-RPC body，向 `params.arguments.filters` 数组 **追加**（而非替换，避免破坏 agent 自带的合法 filter）一条由角色配置决定的谓词字符串（如 `"superstore_orders.region = 'East'"`），再重新序列化转发。
2. 需要在 `access.yaml` 的角色定义里新增一个字段（如 `rowFilter: "superstore_orders.region = 'East'"`），与现有 `tableSelectors`/`tools` 同级，供 proxy 读取并拼接。
3. 需要确认 filter 表达式里引用的字段（如 `region`）在该 source 的 manifest/overlay 里确实存在且可直接按列名引用——`superstore_orders.yaml` overlay 未发现 `region` 列本身（该 overlay 通过 join 关联 `superstore_people` 取得 region），需要确认 `region` 是否能作为 join 后的可过滤字段直接出现在 `filters` 表达式里，这是一个**未验证的边界条件**，建议作为 Path B 实施前的第一个 spike 验证点。
4. 失败处理：若拼接后的 filter 表达式解析失败（如 KTX 返回 parse error），proxy 必须 fail-closed（直接拒绝转发并返回错误），不能 fallback 到不过滤的原始请求——否则等于没有强制行级权限。
5. 范围评估：改动集中在 `mcp-proxy.ts` 一个请求拦截点 + `access.yaml` schema 扩展 + 对应 ACL 校验逻辑（`acl.ts`）增加角色到 filter 的映射读取，不需要改 KTX 本身。规模上是"中等"而非"大改"——但仍需补充充分的回归测试（防止 filter 被恶意覆盖/绕过，例如 agent 自己传入冲突 filter、传入会被 OR 逻辑短路掉强制 filter 的表达式等边界场景）。

**不可行的部分需明确排除**：原方案中"仅靠 segments 让 agent 自觉使用"（如 `active_rows`/`loss_rows`）确实不构成安全边界——segments 是可选 hint，agent 完全可以不传；但这与 Path B 无关，Path B 依赖的是 proxy **强制注入** `filters`，而不是寄望 agent 主动调用 segment。

## 5. 置信度与局限

- **直接读源码确认**：`sl_query` 的 zod inputSchema（0.12.0 与 0.13.0 两份源码逐字比对）、filter 经 `semanticLayer.query()` 直传引擎、`parse_predicate` 的存在与其 docstring/commit 说明、0.12.0/0.13.0 schema 一致性。
- **推断（非直接验证）**：`parse_predicate` 对 MySQL 方言的覆盖正确性（回归测试未显式列出 mysql dialect）；`region` 字段能否在 join 后的 source 上直接出现在 `filters` 表达式里（未实际跑一次 `sl_query` 调用验证，本次调研未连接活跃 MCP daemon，按用户指示未尝试获取 token 调用 7878 端口）。
- **完全未找到证据 / 需后续确认**：filter 表达式中是否支持子查询或更复杂谓词（IN/BETWEEN 等）在 MySQL 方言下的边界情况；KTX upstream 是否有公开 issue/文档专门说明 `filters` 字段的"安全边界"定位（即官方是否明确背书其可用于多租户/行级权限场景，还是仅当作查询便利特性设计，未考虑被第三方代理强制注入的安全场景）——这点建议 Path B 真正实施前向 KTX upstream 确认设计意图，而不能仅凭"功能上可行"就假定"设计上鼓励这么用"。
