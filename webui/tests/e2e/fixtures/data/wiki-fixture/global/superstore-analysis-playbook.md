---
title: superstore-analysis-playbook
summary: superstore_orders 表的分析 playbook，覆盖利润、订单、履约等核心场景
tags: [superstore, analysis, playbook]
sl_refs:
  - mysql-aliyun/dataforai/superstore_orders
---

# Superstore Analysis Playbook

本文是 `mysql-aliyun.dataforai.superstore_orders` 表的业务口径说明。

## 业务背景

Superstore 是模拟零售业务的核心订单表，覆盖订单、履约、退货全链路。

## 关键指标

- `total_profit`: `sum(profit)`
- `total_revenue`: `sum(sales)`
- `avg_discount`: `avg(discount)`

## 关联语义对象

- `mysql-aliyun.dataforai.superstore_orders`（本文分析对象）

## 注意事项

- `profit` 含负数（亏损订单）
- `order_date` 是订单创建时间，与 `ship_date` 不同
