---
name: kx-dupont-analysis
title: 柯西财务杜邦分析与三表勾稽 SOP
version: 1.0.0
domain: kx_financial
status: published
roles_allowed: ["*"]
prerequisites:
  sources:
    - "mysql-aliyun.kx_fact_financial_amount"
  measures:
    - "kx_fact_financial_amount.amount"
  wiki_docs:
    - "kx-financial-analysis-playbook.md"
triggers:
  - "杜邦分析"
  - "ROE拆解"
  - "资产周转率"
  - "财务三表勾稽"
eval_cases:
  - "evals/kx_financial/01_financial_overview.yaml"
description: 柯西财务杜邦分析与三表勾稽 SOP，指导 ROE 核心驱动因素拆解与跨表口径核对
---

# 1. 业务背景与分析逻辑
杜邦分析体系将净资产收益率（ROE）层层拆解为三个核心驱动因素：
$$\text{ROE} = \text{净利润率} \times \text{总资产周转率} \times \text{权益乘数}$$

# 2. 强制规则与避坑指南 (Pitfalls & Non-Negotiable Rules)
1. **期间一致性**：资产负债表取期末数（或期初与期末平均数），利润表与现金流量表取当期累计发生额。
2. **科目勾稽**：净利润必须与资产负债表中未分配利润变动额相勾稽。
3. **合并抵消**：集团级财务分析必须确认是否已执行内部交易抵消。

# 3. 标准执行路径
- **Step 1**: 提取利润表中营业收入与净利润，计算销售净利率。
- **Step 2**: 提取资产负债表中总资产与所有者权益，计算总资产周转率及权益乘数。
- **Step 3**: 输出三维驱动力拆解结论与 Provenance Footer。
