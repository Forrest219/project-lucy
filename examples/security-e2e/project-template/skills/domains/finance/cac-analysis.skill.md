---
name: finance-cac-analysis
title: 获客成本分析 SOP
version: 1.0.0
domain: finance
status: published
roles_allowed: [finance_reader]
prerequisites:
  sources:
    - "fin-db.marketing_daily"
triggers:
  - "获客成本"
  - "CAC"
description: 获客成本分析 SOP：先取默认口径，再按区域与渠道拆分
---

# 获客成本分析

{{CANARY_PUBLISHED_SKILL}}

1. 默认口径见 Wiki「获客成本（CAC）口径」。
2. 区域、渠道拆分各自重新 SUM/SUM，不得对子项比率求平均。
