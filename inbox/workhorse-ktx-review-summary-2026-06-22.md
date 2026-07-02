# KTX 财务语义层 Review 总结（2026-06-22）

**Reviewer**: workhorse (Hermes Agent)
**起**: "柯西 2026 年的收入总和" 一句自然语言查询触发
**止**: 6+1 个 eval case 上线 + 全部 measure NULL 语义化 + fact 路由补全
**结果**: KTM 财务域从"能用"升级到"财报级稳健"

---

## 起：真实事故链路

用户问"柯西 2026 年的收入总和是多少，请拆分到每月汇报"。

代理第一反应是走 `kx_fact_financial_amount` + `kx_dim_financial_item` join 路径，**理由**：
- 合计行在 dim 表里有 `is_total` 标志
- fact 表是最"全"的源

实际跑下来：
1. `sl_query` 报 `Ambiguous join path from kx_dim_financial_item to kx_fact_financial_amount: multiple equal-cost paths exist`
2. 改 order 字段后报 `ORDER BY field 'row_no' is not a recognized measure or dimension`
3. 退回 `kx_vw_balance_sheet_detail` 视图才出数

绕了 2 轮才意识到：**3 个 `kx_vw_*_detail` 视图就是为合计行 + 按行次排版设计的，根本不需要走 fact。**

根因：代理在选择查询源时，缺一条路由规则——"合计行走视图、明细行走 fact"。

---

## 中：3 轮 review，13 项修正

### 第 1 轮（基础路由）

| # | 改法 | 落地位置 |
|---|---|---|
| 1 | fact 表 YAML human/ai 段加"合计行走视图"自然语言提示 | `kx_fact_financial_amount.yaml:3` |
| 2 | dim 表加 `preferred_view` 派生列，机器可读路由（5 个 item_id 起点） | `kx_dim_financial_item.yaml:1` |
| 3 | eval case `kx-routing-balance-ratio-001` 锁死"资产负债率 → 视图" | `kx_financial-eval-cases.yaml` |

### 第 2 轮（语义层"更像财报模型"）

| # | 改法 | 落地位置 |
|---|---|---|
| 4 | 3 视图各加 6 个 period 派生列（期间年份/月份/月份标签/季度/季度标签/是否季末月份） | `kx_vw_*_detail.yaml × 3` |
| 5 | 3 视图各加中文 measures：资产负债率/流动比率/毛利率/净利率/3 个现金流量净额 | `kx_vw_*_detail.yaml × 3` |
| 6 | fact 表加 measures：total_amount/non_null_amount_count/null_amount_count | `kx_fact_financial_amount.yaml` |
| 7 | fact 表加 segments：kexi_company/fiscal_year_2026/income_statement/balance_sheet/cash_flow + 5 个 amount_type | `kx_fact_financial_amount.yaml` |
| 8 | 6 个新增 eval case 覆盖：月度营收/Q1 营收/现金流/资负合计/毛利率/反向护栏 | `kx_financial-eval-cases.yaml` |
| 9 | wiki playbook 补"报表路由 / 时间口径 / 金额口径" | `wiki/global/kx-financial-analysis-playbook.md:24` |

### 第 3 轮（财务语义稳健化 / P0-P2 全部清完）

| # | 改法 | 严重度 |
|---|---|---|
| 10 | 3 视图 18 处 period 派生列加 `IS NULL OR LENGTH != 6` 防御 | P1 |
| 11 | 5 个关键财务 measure description 补 NULL 语义（缺行/未填返回 NULL） | P1 |
| 12 | 资产负债表描述补"时点报表，无本月/累计口径" | P1 |
| 13 | 3 视图 `是否季末月份` 多行 CASE 显式三态（NULL/0/1） | P1 |
| 14 | 现金流 measure 改精确 `=` 行名（5 处真实行） | P1 |
| 15 | `item_aliases` 派生列 13 → 20 条（三大费用/流动合计/期初余额/净增加额） | P1 |
| 16 | `preferred_view` 扩展 cash flow item_id (102/109/116/117/119) | P1 |
| 17 | dim ai 描述补"preferred_view 是高置信子集，完整语义以 view measure 为准" | P1 |
| 18 | 6 个新 eval case 升级为 dataframe 数值/NULL 断言 | P1 |
| 19 | `expected_measures_semantics` 注释："评审提示，非 runner 强断言" | P1 |
| 20 | `yaml_value_typing` 契约：`null_is_yaml_null: true / string_null_requires_quotes: true` | P1 |

---

## 收：当前 KTM 财务域状态

**6 个 semantic layer source**：
- `kx_dim_company` — 公司主数据（1 行：深圳市柯西信息科技有限公司）
- `kx_dim_financial_item` — 财报项目维表（123 行）+ 20 条别名 + 5+6+5=16 个 preferred_view 路由
- `kx_fact_financial_amount` — 财报金额事实（2330 行）+ 3 measures + 9 segments
- `kx_vw_balance_sheet_detail` — 资负表明细（310 行）+ 6 period 派生 + 8 measures
- `kx_vw_income_statement_detail` — 利润表明细（160 行）+ 6 period 派生 + 10 measures
- `kx_vw_cash_flow_statement_detail` — 现金流明细（125 行）+ 6 period 派生 + 5 measures

**Eval 体系**（17 个 case）：
- basic: 5
- anti_pattern: 4
- boundary: 3
- degradation: 2
- multi_turn: 1
- path_selection: **10（含 7 个新增 routing case + 1 个反向护栏）**

**安全契约**：
- `readonly: true`（禁 DDL/DML）
- `forbid_cross_source_join: true`
- `forbid_secret_paths: [".ktx/secrets/"]`
- `forbidden_ast: UPDATE/DELETE/INSERT/MERGE/DROP/ALTER/TRUNCATE/CREATE`
- `yaml_value_typing: null_is_yaml_null / string_null_requires_quotes`

**端到端验证**（每轮都跑过）：
- YAML parse ✓
- Ruby YAML parser 确认 `null` 解析为 nil（非字符串）
- `ktx sl validate` 4 个 source 全过
- `ktx admin reindex` 成功：`scanned=10 updated=4 embeddings=4`
- `ktx sl read` 回显所有派生列/描述/路由

---

## 关键设计决策（留底，避免下次 review 推翻）

### 1. 路由提示放 yaml 而非 prompt
LLM 读 schema 时自动获得规则，不依赖会话上下文。**prompt 是会话级、易丢；schema overlay 是会话无关、所有 agent 共享。**

### 2. `preferred_view` 是高置信子集，不试图全映射
dim 表只标 16 个 item_id（资负 4 / 利润 3 / 现金流 5+其他 4）。其余 item 留 NULL，**默认走 fact**——LLM 自主判断空间不剥夺。

### 3. NULL 语义三态显式化
- 报表未填 → NULL（不等于 0）
- 缺合计行 → NULL（不可计算）
- 明示零 → 0

`measures` description 全部显式写明"未找到对应行时返回 NULL，不代表金额为 0"。

### 4. 期间字符串拼接 → 派生列
`2026Q1` / `2026-05` / 季度/月份 都从 `期间季度标签 / 期间月份标签` 派生，**避免每次手拼裸字符串范围**。Eval `kx-routing-income-quarter-001` 锁住这条。

### 5. 反向护栏 = 路由规则的健康度计
`kx-routing-fact-subject-detail-001` 必走 fact + 必 join dim + 必带科目名 + 必带起止期间。**防止将来把档 1 自然语言提示写得太强势，导致代理连明细问题都不走 fact。**

---

## 未做（建议留给下轮 review）

- `fact.grain` 字段显式维度列表（`[amount_id, company_id, report_period, item_id, amount_type]`）
- cash flow `202603 经营活动产生的现金流量净额 = 10000.20` 这条数值断言的数据来源复核
- 3 视图 period 派生列去重（KTX 不支持 yaml extends/imports，靠同步维护注释兜底）
- fact `non_null_amount_count / null_amount_count` measure 描述进一步增强

**以上 4 项是 nice-to-have，不阻塞生产。**

---

## 经验（下次类似 review 可复用）

1. **走错路是症状，路由缺失是病根**。修了 schema 比修 prompt 治本。
2. **KTM 端到端验证**（sl validate / reindex / read back）是 single source of truth，比 README 可靠。
3. **每改一处都加 eval**——软建议变硬约束。7 个 routing case + 1 反向护栏就把这轮成果锁住了。
4. **description 而非新表承载语义**。`item_aliases / preferred_view` 都是 `expr` 派生列，不是真物理列。改 yaml 即生效，**零 DDL**。
5. **NULL 语义是财务分析的隐藏大头**。"原始报表为空"和"明示零"是两种状态——把这件事显式化之后，LLM 不再把 NULL 当数据损坏。

---

**文件位置**（供后续 review 索引）：
- `~/Projects/project-lucy/inbox/workhorse-ktx-semantic-routing-recommendations-2026-06-22.md`（最初建议稿）
- `~/Projects/project-lucy/inbox/workhorse-ktx-review-summary-2026-06-22.md`（本文）
