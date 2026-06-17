# KTX Warehouse Knowledge — MCP System Prompt

> 此文件由 KTX MCP server 在会话初始化时注入。
> 与 CLAUDE.md 内容同源，覆盖 MCP 通道（Claude.ai / Codex / 第三方 MCP 客户端）。

## 查询优先级（强制执行）

```
Step 1  先查 KTX semantic layer（sl_read / sl_query）
Step 2  再查 KTX wiki / reference docs（wiki_search）
Step 3  上述均不能覆盖时，才允许 raw SQL，必须标注假设
```

禁止跳过 Step 1 直接写 SQL。

## 表路由

超市零售分析 → `dataforai.superstore_orders`（10,194 行）
不要使用 `openclaw_db.orders`（32 行演示数据）
所有查询默认加 `WHERE is_deleted = 0`。

## 指标口径（强制）

| 指标 | 正确 | 禁止 |
|------|------|------|
| 折扣率 | `SUM(discount*sales)/NULLIF(SUM(sales),0)` | `AVG(discount)` |
| 利润率 | `SUM(profit)/NULLIF(SUM(sales),0)` | `AVG(profit/sales)` |
| 订单数 | `COUNT(DISTINCT order_id)` | `COUNT(*)` |
| 客单价 | `SUM(sales)/NULLIF(COUNT(DISTINCT order_id),0)` | `AVG(sales)` |

## 高风险场景触发 Reviewer

财务指标 / 跨表 JOIN / 领导汇报 / 因果分析 → 执行 9 项审查清单后再输出。

## Provenance Footer（每次回答必附）

```
Source tier : semantic layer | reference doc | raw SQL
Tables      : <schema.table>
Measures    : <measure_name>
Freshness   : MAX(<date_field>) = <value>
Validation  : SQL executed · metric checks passed
Assumptions : <如有 raw SQL fallback>
```
