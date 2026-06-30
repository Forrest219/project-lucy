# Lucy 数据问答指导（MCP Initialize Instructions）

> 本文件是 Lucy MCP Proxy 在 `initialize` 响应里注入给客户端的 `instructions` 文本来源。
> 任何走 `:7879`（Bearer token 鉴权）连接的客户端——Codex、Cursor、Claude Code（含本地仓库开发会话）——
> 在 MCP session 建立时都会拿到本文件的内容。不是安全边界，真正的权限裁决在 Lucy MCP Proxy 的 `acl.check()`。
> 内容变更需先走 Plan Mode（见 `docs/DEVELOPMENT.md`「修改前必须先出计划」清单）。

本项目是一个本地自服务数据分析 Agent 栈，底座为 KTX 语义层 + Aliyun RDS MySQL 8.0.34。

## 可用工具

| 工具 | 用途 |
|------|------|
| `sl_read` / `sl_read_source` | 读取语义层（表描述、字段、measures、joins） |
| `sl_query` | 使用语义层生成并执行 SQL |
| `wiki_search` / `wiki_read` | 检索 wiki / reference docs |
| `sl_validate` | 验证语义层定义 |
| `kx_catalog` | 查询当前 token 可见的数据域、连接、示例参数（proxy 自服务工具，能力发现入口） |

---

## 查询优先级（强制执行）

**每次回答数据问题，必须按此顺序执行：**

```
Step 1  先查语义层（sl_read_source / sl_query）
        → 获取 canonical table、字段描述、grain、measures、joins

Step 2  再查 wiki / reference docs（wiki_search）
        → 获取业务口径、Gotcha、路由规则

Step 3  以上均不能覆盖时，才允许 raw SQL
        → 必须标注：「以下基于 raw SQL，假设：…」
```

禁止跳过 Step 1 直接写 SQL。

---

## 表路由（关键）

本项目数据问答启用 `data_agent_poc` 下的 POC 内测 domain，以及 `dataforai` 下的超市样例 domain 与 KX 财务报表 domain。

| 分析意图 | 路由 |
|---|---|
| POC 数据总纲、表路由、指标口径 | `poc-mysql-aliyun` / `data_agent_poc.poc_metric_catalog`，也可读 wiki `poc-data-agent-playbook.md` |
| POC DAU、启动次数、人均启动、包名趋势、平台对比 | `poc-mysql-aliyun` / `data_agent_poc.poc_app_active_daily` |
| POC 广告收入、曝光量、eCPM、ARPU、广告位排名、月度广告收入趋势 | `poc-mysql-aliyun` / `data_agent_poc.poc_ad_revenue_daily` |
| POC 分品类广告收入（品牌 / 电商 / 效果 / 外包）、IDM治理层DAU、人均打开次数、治理层eCPM | `poc-mysql-aliyun` / `data_agent_poc.poc_ad_revenue_by_type_daily` |
| POC CEO一眼报标杆快照、eval 回归值 | `poc-mysql-aliyun` / `data_agent_poc.poc_ceo_metric_snapshot` |
| 超市零售明细（订单、折扣、利润、客户、产品、区域） | `dataforai.superstore_orders`（10194 行，4 年样本） |
| 月度 / 季度 / 年度趋势 | `dataforai.superstore_orders` 按 `order_date` 聚合（如 `DATE_FORMAT(order_date,'%Y-%m')`），不要依赖外部汇总表 |
| 退货关联 | `dataforai.superstore_returns` JOIN `superstore_orders` ON `order_id`（join 已在 sl yaml 中声明） |
| 区域经理 | `dataforai.superstore_people`（按 region 维表） |
| 华东区域订单（区域受限场景） | `dataforai.superstore_orders_huadong` |
| KX 财报金额明细（公司、期间、报表项目、金额） | `dataforai.kx_fact_financial_amount` JOIN `kx_dim_company` / `kx_dim_financial_item` |
| KX 公司维度 | `dataforai.kx_dim_company`（按 `company_id` 关联事实表） |
| KX 财报项目维度 | `dataforai.kx_dim_financial_item`（按 `item_id` 关联事实表） |
| KX 资产负债表明细视图 | `dataforai.kx_vw_balance_sheet_detail` |
| KX 现金流量表明细视图 | `dataforai.kx_vw_cash_flow_statement_detail` |
| KX 利润表明细视图 | `dataforai.kx_vw_income_statement_detail` |

超市表查询默认加 `WHERE is_deleted = 0`；查 returns 时再加 `returned = '是'`。KX 财务表不含 `is_deleted`，不要套用超市软删除过滤。

POC token 常见限制：`poc_readonly` 只授权 `poc-mysql-aliyun` 连接下的 5 张 POC 表。不要调用 `discover_data` / `dictionary_search` 做全局 metadata 发现；这些工具可能触达 KX 敏感 metadata 并被 ACL 拒绝。POC 查询必须显式传 `connectionId: "poc-mysql-aliyun"`，并用 source 前缀限定 measure / dimension，避免跨 source 重名。

POC 广告收入常用 `sl_query` 参数：

- 本年各月广告收入：`connectionId="poc-mysql-aliyun"`，`measures=["poc_ad_revenue_daily.ad_revenue"]`，按 `poc_ad_revenue_daily.dt` 做月粒度分组或日期过滤。
- 本年各广告位广告收入：`connectionId="poc-mysql-aliyun"`，`measures=["poc_ad_revenue_daily.ad_revenue"]`，`dimensions=[{"field":"poc_ad_revenue_daily.ad_slot"}]`。
- 本年各品类广告收入：`connectionId="poc-mysql-aliyun"`，`measures=["poc_ad_revenue_by_type_daily.ad_revenue"]`，`dimensions=[{"field":"poc_ad_revenue_by_type_daily.revenue_type"}]`。不要使用 `category`；品类字段名是 `revenue_type`。
- 如需校验广告收入合计一致性，比较 `poc_ad_revenue_daily.ad_revenue` 与 `poc_ad_revenue_by_type_daily.ad_revenue` 在同一日期 / 国家粒度下的合计。

当前 token 实际能看到哪些表/工具，以 `kx_catalog` 返回结果和 `tools/list` 的实际可见工具为准——本文件描述的是全量路由知识，不代表当前 token 一定有权限访问全部条目。

---

## 指标口径

指标公式以 `sl_read_source` 返回的 `measures` 为单一事实源（`dataforai.superstore_orders`），禁止跳过语义层手写聚合公式。常见口径：

| 指标 | 正确 | 禁止 |
|------|------|------|
| 折扣率 | `SUM(discount*sales)/NULLIF(SUM(sales),0)` | `AVG(discount)` |
| 利润率 | `SUM(profit)/NULLIF(SUM(sales),0)` | `AVG(profit/sales)` |
| 订单数 | `COUNT(DISTINCT order_id)` | `COUNT(*)` |
| 客单价 | `SUM(sales)/NULLIF(COUNT(DISTINCT order_id),0)` | `AVG(sales)` |

详细口径与 Gotcha 见 `wiki/global/discount-policy.md`、`wiki/global/profit-rule.md`。

---

## 高风险场景触发 Reviewer

涉及以下情况时，输出前调用 reviewer skill（若存在）；否则将其 9 项检查清单内联到回答前：

- 财务指标（利润率、折扣、收入）
- 跨表 JOIN
- 领导汇报
- 因果分析（"为什么"、"原因"）

---

## Provenance Footer

每个数据回答必须附：

```
Source tier : semantic layer | reference doc | raw SQL
Tables      : <schema.table>
Measures    : <measure_name>
Freshness   : MAX(<date_field>) = <value>
Validation  : SQL executed · metric checks passed
Assumptions : <raw SQL fallback 时列出假设>
```
