# Audit Generated SQL Hot Store Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Audit Generated SQL Hot Store Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-21 |
| 撰写人 | Auto |
| 委托人 | xingchen |
| 基于材料 | 已批准计划「热库明文 generated SQL + 列表直展」；`webui/docs/62-trace-evidence-kernel-spec.md`；`webui/docs/124-audit-query-artifact-cold-store-spec.md` |
| 适用范围 | MCP Proxy 将 `lucy_query` 生成 SQL 明文写入审计热库；`/admin/audit` 调用流水列表与 CSV 直展 |
| 输出位置 | `webui/docs/125-audit-generated-sql-hot-store-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 125 |
| 关联页面 | `/admin/audit`（调用流水） |
| 关联域 | Access Control / Audit |
| 状态 | Implemented |
| 日期 | 2026-08-21 |
| 取代关系 | Spec 124 冷存主路径由本 Spec 取代；124 降为 optional / legacy |

## 1. 背景

私有化小范围部署需要运维定期在访问日志中 review 生成 SQL 的准确性。热库明文存 **generated SQL** 并在调用流水列表直接展示；不存 deny 路径的 raw `sql`/`query` 攻击载荷。

## 2. 目标

1. `access_log.generated_sql` 明文持久化上游 `sl_query` 返回的编译 SQL。
2. `lucy_query` 始终合并 `include: ["sql"]`，以便捕获生成 SQL。
3. `/admin/audit` 调用流水列表与 CSV 直接展示「生成 SQL」。
4. 不把 args 中的 raw SQL 写入 `generated_sql`。
5. 冷存双写与「查看查询原文」确认流不再作为运维主路径。

## 3. 非目标

- 削弱 `raw_query_forbidden`
- 热库存结果行、Token 明文、完整原问题
- 问询记录 Tab 主列表增加 SQL 列
- 强制删除 Spec 124 代码（可保留为 legacy，但不作为入口）

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- Generated SQL: UI 主术语为「生成 SQL」；指语义编译后的 SQL 文本，列/字段 `generated_sql` / `generatedSql`

Forbidden terms:
- 把 raw deny payload 称作「生成 SQL」
- 热库 SQL 原文（过宽；须标明 generated）

## 5. 存储边界（修订）

| 层 | 允许 | 禁止 |
|---|---|---|
| 热库 `access_log` | `generated_sql`（仅编译结果）、`query_hash`、脱敏 `query_preview`（raw 场景） | raw SQL AST / raw query 明文进 `generated_sql`、结果行、Token 明文 |
| Trace evidence | hash / summary | `raw_sql_ast` evidence kind（不变） |

## 6. 写入规则

| 场景 | 行为 |
|---|---|
| `lucy_query` 成功且结果含 `sql` | 写入 `generated_sql`；更新 `query_hash` / `query_length` / `query_operation` |
| `lucy_query` 成功但无 `sql` | `generated_sql` 为空 |
| args 含 raw `sql`/`query`（含 deny） | **不**写入 `generated_sql`；可写脱敏 `query_preview` |
| 非 `lucy_query` 工具 | 默认不写 `generated_sql` |

## 7. API / UI / CSV

- `GET /api/admin/audit` 返回 `generatedSql`
- 调用流水表新增列「生成 SQL」（`notranslate` + monospace；可横向滚动）
- CSV 导出增加「生成 SQL」列
- 不再要求确认解密即可查看 generated SQL

## 8. Acceptance Criteria

1. 热库可读到明文 `generated_sql`（仅 generated）。
2. 调用流水列表无二次点击即可看到生成 SQL。
3. deny raw query 的行 `generated_sql` 为空。
4. Trace blacklist 仍拒绝 `raw_sql_ast`。
5. 手册与术语与本 Spec 一致。

## 9. Design System Compliance

引用 Foundations / Data grid。新增列遵循现有 `pl-data-grid`；长 SQL 用单元格内滚动，不新增卡片模式。
