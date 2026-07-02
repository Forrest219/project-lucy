# KTX 语义路由改进建议（workhorse / MCP 层）

**作者**: workhorse (Hermes Agent)
**日期**: 2026-06-22
**触发场景**: 查柯西 2026-05 资产负债率时，走了 `kx_fact_financial_amount` + `kx_dim_financial_item` 的 join 路径，被 ktx 报 "Ambiguous join path" 拦下；改走 `kx_vw_balance_sheet_detail` 视图才出数。
**结论**: 代理在 schema 推断阶段缺一条"合计行走视图、明细行走 fact"的路由规则，导致无谓的 join 探查。

---

## 背景：发生了什么

问题：资产负债率 = 负债合计 / 资产合计。

我第一反应是走事实表 + 维度表 join，理由是：
- 合计行在 `kx_dim_financial_item` 里有 `is_total` 标志
- `kx_fact_financial_amount` 是最"全"的源，理论上能凑出任何指标

实际跑下来：
1. `sl_query` 报 "Ambiguous join path from kx_dim_financial_item to kx_fact_financial_amount: multiple equal-cost paths exist"
2. 改 order 字段后又报 "ORDER BY field 'row_no' is not a recognized measure or dimension in this query"
3. 最后回到 `kx_vw_balance_sheet_detail` 视图，单表无 join，一次出数

绕了一个弯才意识到：**资负表/利润表/现金流表现成的 3 个 `vw_*_detail` 视图就是为合计行 + 按行次排版设计的**，根本不需要走 fact。

---

## 根因

代理在选择查询源时，缺一条路由规则：

| 问的指标 | 应该走 | 不该走 |
|---|---|---|
| 资负表合计行（资产/负债/权益） | `kx_vw_balance_sheet_detail` | `kx_fact_financial_amount` |
| 利润表合计行（营业利润/利润总额/净利润） | `kx_vw_income_statement_detail` | `kx_fact_financial_amount` |
| 现金流合计行（经营/投资/筹资净额） | `kx_vw_cash_flow_statement_detail` | `kx_fact_financial_amount` |
| 单个 item_id 的金额时序 | `kx_fact_financial_amount` | 视图（视图无 item_id 维） |
| 跨期对比 / 自定义聚合 | `kx_fact_financial_amount` | 视图（视图按报表期间排版） |
| 枚举公司 / 枚举 item | 维度表 | 任何事实/视图 |

当前 KTX 的 schema / 工具描述里没有这条规则，代理只能"试 → 报错 → 换路径"，浪费 1-2 轮调用。

---

## 改进建议（仅 MCP 层可改的两档）

### 档 1：在 `kx_fact_financial_amount` YAML 的 `descriptions.human` 段加一句路由提示

**理由**：
- `sl_read_source` 拉 schema 时返回 YAML，代理 100% 会读到 `human` 段
- 一行文字就能阻止"合计行走 fact"这条死路
- 零 schema 变更，零 backfill

**当前 human 段**（来自 sl_read_source 返回）：
> KX 财报金额事实表。用于分析柯西公司（深圳市柯西信息科技有限公司，company_id=1）在 2026 年的经营情况、利润表、资产负债表和现金流量表。

**建议改为**：
> KX 财报金额事实表。用于分析柯西公司（深圳市柯西信息科技有限公司，company_id=1）在 2026 年的经营情况、利润表、资产负债表和现金流量表。
>
> ⚠️ 查询合计行（资产合计 / 负债合计 / 所有者权益合计 / 利润表行 / 现金流行）请直接走 3 个 `vw_*_detail` 视图，避免多表 join 歧义。事实表仅用于明细行（按 item_id 取单项金额、跨期对比、自定义聚合）。

**改动方式**：改 `kx_fact_financial_amount` 源定义 YAML 中的 `descriptions.human` 字段。KTX 源定义通常在 `~/.ktx/sources/` 或仓库 `ktx/sources/` 下，找一下 yaml 文件改字段即可。

---

### 档 2：在 `kx_dim_financial_item` 加 `preferred_view` 字段

**理由**：
- 把"item_id → 推荐视图"做成机器可读的列
- 代理读 schema 时直接拿到"问这个 item 走哪个源"，比 human 段那行文字更精确
- 配合 `sl_read_source` 拉维度表 schema，能做"查合计行 → 先查 item 的 preferred_view → 路由到对应视图"

**Schema 建议**：

```yaml
# kx_dim_financial_item 新增列
- name: preferred_view
  type: string
  descriptions:
    db: 推荐查询视图：vx_balance_sheet_detail / kx_vw_income_statement_detail / kx_vw_cash_flow_statement_detail / null（走事实表）
    ai: 该 item_id 推荐查询的数据源视图。合计行（资产合计/负债合计/利润总额等）走对应 vw_*_detail 视图；明细行留空走 kx_fact_financial_amount 事实表。
```

**Backfill 草稿**（按本次探测的 36 个 item_id 分类）：

| item_id | item_name | 归属 | preferred_view |
|---|---|---|---|
| 30 | 资产合计 | asset | kx_vw_balance_sheet_detail |
| 47 | 负债合计 | liability_equity | kx_vw_balance_sheet_detail |
| 52 | 所有者权益合计 | liability_equity | kx_vw_balance_sheet_detail |
| 53 | 负债和所有者权益合计 | liability_equity | kx_vw_balance_sheet_detail |
| 63 | 一、营业收入 | income | kx_vw_income_statement_detail |
| 64 | 减：营业成本 | income | kx_vw_income_statement_detail |
| 65 | 税金及附加 | income | kx_vw_income_statement_detail |
| 73 | 销售费用 | income | kx_vw_income_statement_detail |
| 76 | 管理费用 | income | kx_vw_income_statement_detail |
| 80 | 财务费用 | income | kx_vw_income_statement_detail |
| 81 | 其中：利息费用（收入以-号填列） | income | kx_vw_income_statement_detail |
| 83 | 二、营业利润（亏损以-号填列） | income | kx_vw_income_statement_detail |
| 84 | 加：营业外收入 | income | kx_vw_income_statement_detail |
| 85 | 其中：政府补助 | income | kx_vw_income_statement_detail |
| 86 | 减：营业外支出 | income | kx_vw_income_statement_detail |
| 92 | 三、利润总额（亏损以-号填列） | income | kx_vw_income_statement_detail |
| 93 | 减：所得税费用 | income | kx_vw_income_statement_detail |
| 94 | 四、净利润（亏损以-号填列） | income | kx_vw_income_statement_detail |
| 125 | 城市建设维护税 | income | kx_vw_income_statement_detail |
| 140 | 二、营业利润 | income | kx_vw_income_statement_detail |
| 149 | 三、利润总额 | income | kx_vw_income_statement_detail |
| 151 | 四、净利润 | income | kx_vw_income_statement_detail |
| 66/67/68/69/70/71/72/74/75/77/78/79/82/87/88/89/90/91 | 税金明细 / 费用明细 | income | kx_vw_income_statement_detail |
| 1-29 | 流动资产明细 / 非流动资产明细 | asset | （留空，走 fact） |
| 31-46 | 流动负债明细 / 非流动负债明细 | liability_equity | （留空，走 fact） |
| 48-51 | 实收资本 / 资本公积 / 盈余公积 / 未分配利润 | liability_equity | （留空，走 fact） |

具体哪些 item_id 走视图、哪些留空走 fact，需要你过一遍 item_name 列表确认。

**改动方式**：
1. ALTER TABLE 加列：`ALTER TABLE dataforai.kx_dim_financial_item ADD COLUMN preferred_view VARCHAR(64) NULL;`
2. UPDATE 填充：按上表批量赋值
3. 改 `kx_dim_financial_item` 源定义 YAML，加入新列定义

---

## 建议落地顺序

1. **先做档 1**（5 分钟改完）—— 一行 human 段就能阻止大部分"合计行走 fact"的死路
2. **再做档 2**（需要 backfill）—— 机器可读的精确路由，是档 1 的强化版

档 1 是 MVP，档 2 是长期解。两者不冲突，可以同时上。

---

## 验收

档 1 上线后，代理问"柯西资产负债率"时应该：
- 第一次 `sl_query` 就直接走 `kx_vw_balance_sheet_detail`，不再尝试 fact + dim join
- 没有 "Ambiguous join path" 报错

档 2 上线后，代理应能在 `sl_read_source` 拉 `kx_dim_financial_item` schema 时看到 `preferred_view` 字段，并按该字段路由查询。

---

## 不在本次建议范围内

- wiki / docs / system prompt 改动（按用户"只给 mcp 的建议"要求排除）
- 视图本身的结构调整（视图 grain 已经合理）
- kx_fact_financial_amount 表结构调整
