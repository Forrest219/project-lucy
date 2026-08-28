---
name: superstore-profit-breakdown
title: Superstore 利润与折扣拆解分析 SOP
version: 1.0.0
domain: superstore
status: published
roles_allowed: ["*"]
prerequisites:
  sources:
    - "mysql-aliyun.superstore_orders"
  measures:
    - "superstore_orders.profit"
    - "superstore_orders.sales"
    - "superstore_orders.discount_amount"
  wiki_docs:
    - "superstore-analysis-playbook.md"
triggers:
  - "利润下滑分析"
  - "折扣率与毛利相关性"
  - "亏损订单诊断"
  - "盈利归因"
eval_cases:
  - "evals/superstore/01_profit_summary.yaml"
description: Superstore 利润与折扣拆解分析 SOP，涵盖多维归因、异常大单穿透及折扣率加权计算避坑规则
---

# 1. 业务背景与分析逻辑
当分析利润异常变动或排查亏损原因时，必须按照「三层下钻法」进行归因：
1. **第一层（区域与时间）**：按 `region` 和 `order_date(month)` 聚合，识别利润异动的主要区域与月份。
2. **第二层（品类与折扣）**：下钻至 `category` / `sub_category`，分析平均折扣深度与利润率相关性。
3. **第三层（异常大单排查）**：提取亏损金额较大的离群订单明细，定位亏损根本原因。

# 2. 强制规则与避坑指南 (Pitfalls & Non-Negotiable Rules)
1. **折扣率聚合陷阱**：严禁直接计算 `avg(discount)`，必须计算加权折扣率：
   $$\text{Weighted Discount} = \frac{\sum(\text{discount\_amount})}{\sum(\text{original\_sales})}$$
2. **退货状态排除**：所有利润统计默认必须过滤有效未退货订单（`order_status != 'Returned'`）。
3. **汇率统一口径**：涉及跨币种计算时必须关联 `dim_exchange_rate` 做汇率对齐。

# 3. 标准执行路径 (Recommended Step-by-Step)
- **Step 1**: 调用 `sl_query`，以 `region` 为维度聚合 `superstore_orders.profit` 和 `superstore_orders.sales`。
- **Step 2**: 针对负利润区域，调用 `sl_query` 获取 `sub_category` 的 `profit_margin` 与 `discount_depth`。
- **Step 3**: 若发现特定单品毛利严重倒挂，执行明细下钻并附加 Provenance 证据。
