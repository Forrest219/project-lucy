---
summary: 获客成本（CAC）默认口径与常见误用。
allowed_roles: [finance_reader, discover_only, channel_only]
sl_refs: [fin-db/marketing_daily]
---

# 获客成本（CAC）口径

{{CANARY_FIN_WIKI}}

- 默认口径：`SUM(spend_cents) / SUM(new_customers)`，按所选时间窗聚合后相除。
- 禁止对每日比率取平均；`new_customers` 为 NULL 的行不计入分子与分母；某日客户数为 0 时该日比率无意义。
- 金额单位为分，对外展示换算为元并保留两位小数。
