---
sl_refs:
  - demo-exec-mysql/dataforai/fct_ai_token_consumption
  - demo-exec-mysql/dataforai/fct_business_ticket_closed
---

# Executive POC：AI Token 与业务产出

## 何时使用

- 各部门 Token 消耗
- Token / 关闭工单数（单位业务产出）

## 口径

```text
token_per_ticket = sum(tokens) / sum(tickets_closed)
```

按 `dept` + `period_month` 分组；禁止跨 dept 直接 AVG。

## 附录场景

CIO 预算汇报附录；非 CFO/COO 主链路。
