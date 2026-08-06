# Eval Case 模板（question / explanation 须中文）

```yaml
metadata:
  document_name: <中文或英文标识均可，推荐含业务域名>
  document_type: Eval
  version: v0.1
  runner_schema_version: v1.4
  written_date: <YYYY-MM-DD>
  author: <Agent 或分析师>
  requester: <团队>
  based_on:
    - <semantic yaml 路径或逻辑名>
    - <wiki 路径>
  scope: <中文：覆盖哪些口径/勾稽>
  output_path: evals/<domain>/eval/<domain>-eval-cases.yaml
  data_source: semantic_layer

safety_contract:
  readonly: true
  forbid_secret_paths:
    - ".ktx/secrets/"
  forbid_cross_source_join: true

cases:
  - id: <domain>-unit-retention-count-001
    case_type: single_turn
    skill_version: v0.1
    semantic_version: v0.1
    question: "（中文）请说明「次日留存人数」的单位是绝对人数还是百分比，并给出判断依据。"
    domain: <domain>
    trace_required: true
    context_required:
      keys:
        - global/<playbook>.md
    risk_tags:
      - unit
      - retention
    expected_source: semantic_layer
    tool_assertions:
      - type: required_tool
        value: sl_query
        reason: 需要结合语义字段说明单位，不能只凭猜测。
    # 按需补充 expected_measures / notes（notes 用中文）
```

## 推荐覆盖的 case 类型（命名用中文题干）

1. 单位识别（人数 vs % vs 美元/人）  
2. 双口径差异（如服务器 vs AF）  
3. 留存时间语义 + 留存率分母  
4. 跨表 JOIN KEY + CPI 公式  
5. 跨维度加总去重风险  
6. 脏数：留存率 >100% 或留存人数 > DAU  
