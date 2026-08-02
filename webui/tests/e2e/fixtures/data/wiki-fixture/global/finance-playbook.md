---
title: finance-playbook
summary: finance_mart 利润分析 playbook（E2E fixture）
tags: [finance, analysis, fixture]
sl_refs:
  - mysql-aliyun/finance_mart/fact_revenue
---

# Finance Mart 利润分析

基于 `mysql-aliyun.finance_mart.fact_revenue` 的利润分析。

## 核心口径

- `gross_profit`: `sum(profit)`
- `net_margin`: `sum(profit) / sum(revenue)`
