# Lucy User Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy User Guide |
| 文档类型 | Product / User Guide |
| 版本 | v0.2 |
| 撰写日期 | 2026-06-22；v0.2 更新 2026-07-06（同步 context compiler 定位） |
| 适用范围 | 使用 agent 通过 Lucy 访问数据的业务用户 |

## 1. What Lucy Gives You

Lucy lets your agent answer data questions through governed context, not through direct raw database access. It acts as a data agent context compiler + governed MCP runtime:

- approved tables and sources only.
- business metric definitions and semantic-layer measures.
- wiki/context retrieval for business meaning and caveats.
- safe MCP tools instead of unrestricted database credentials.
- audit trail for data access.
- repeatable eval checks for answer quality.

Business users do not need a Lucy WebUI account for the first customer delivery. The standard path is to ask questions through the customer's approved Agent MCP client connected to Lucy MCP Proxy.

## 2. How To Ask

Good questions include:

- time range.
- metric name.
- grouping dimension.
- filter/segment.
- expected output shape.

Example:

```text
按地区汇总 2024 年有效订单销售额，返回 region、total_sales，并说明使用的数据表和口径。
```

## 3. What To Expect

The agent should:

- use semantic-layer measures when available.
- avoid raw SQL unless explicitly approved by policy.
- cite source tables or semantic objects.
- explain the relevant context pack when it affects the answer, such as metric definitions, wiki caveats, or eval-backed assumptions.
- say when a requested table or tool is not allowed.

## 4. When Something Looks Wrong

Ask the agent to provide:

- used tables.
- measure definitions.
- generated SQL if policy allows it.
- row count and filters.

Then send the case to the admin with the question, expected answer, and observed output.

More user-facing HTML docs live under `docs/user-guide/`.
