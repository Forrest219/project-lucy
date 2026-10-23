# invest-db 数据问答 UAT

| 元数据 | 内容 |
|---|---|
| 文档名称 | invest-db 数据问答 UAT |
| 文档类型 | UAT Plan / Test Cases |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 基于材料 | `docs/qa/suite-semantic-onboard-mcp-eval.md`、`docs/qa/suite-user-journey.md`、财务事实库 `lucy/evals/investment/eval/investment-eval-cases.yaml` |
| 适用范围 | 用 `invest` 夹具验证 Lucy 的接入、语义查询、口径、空结果和只读。不验证夹具数字与公告是否一致 |
| 输出位置 | `docs/uat/uat-invest-db-data-qa.md` |

期望值等于当次 `lucy_query` 对 `invest-db` 的返回。夹具换 dump 时重跑查询更新短语，不改场景。

## 1. 参数

| 参数 | 值 |
|---|---|
| `CONN_ID` | `invest-db` |
| `SCHEMA` | `invest` |
| `TABLES` | `invest.fact_company`、`invest.fact_metric`、`invest.claim`、`invest.kpi_threshold`、`invest.governance_event`、`invest.fx_rate` |
| 角色 | 只读，仅此连接。不复用 `demo_readonly` |
| 工具 | `lucy_catalog`、`lucy_query`、`lucy_read_source`、`wiki_search`、`wiki_read` |
| 语义层 | `table` 前缀为 `invest.`，与目录名 `invest-db` 一致 |
| Wiki | `global/investment-playbook.md`，`sl_refs` 为 `invest-db/invest/<source>` |

`INV-00` 不过，后续用例记 blocked。

## 2. 场景

| 场景 | 路径 | 用例 |
|---|---|---|
| A 接入 | 发布连接与语义层，新开会话看目录，拒绝改数 | INV-00、INV-16、INV-18 |
| B 单公司 | 同一会话：赚多少 → 海外占比 → 减值性质 | INV-02、INV-14、INV-03、INV-13、INV-07、INV-19 |
| C 跨公司 | 立邦营收 → 分币种汇总 → 折人民币 → 缺窗口的季度 | INV-01、INV-08、INV-10、INV-11、INV-09、INV-12 |
| D 边界 | 未收录、空治理表、旁路连接、溯源 | INV-05、INV-06、INV-15、INV-17、INV-04 |

## 3. 用例

| ID | 问题或操作 | 通过时 |
|---|---|---|
| INV-00 | 无 token 调 MCP；有 token 后 `lucy_catalog` | 无 token 为 401。目录只有 `invest-db` 和上面 6 个 source |
| INV-16 | `lucy_query` 提交 `UPDATE` | 工具列表没有写入口。调用报错。库内原行不变。审计留痕 |
| INV-18 | 这个库收了哪些公司 | 行数等于 `fact_company` 的查询结果，不另补公司 |
| INV-02 | 伊利股份上半年赚了多少 | 同一次查询同时有 `gaap` 与 `company_adjusted`，并含减值行 |
| INV-14 | 追问海外收入占比 | `current_value_status=null_field`，当前值为空 |
| INV-03 | 减值是什么性质 | `claim` 返回核心论断，且 `falsification_conditions` 非空 |
| INV-13 | 商誉账面现在是多少 | 行的 `period_type=AS_OF` |
| INV-07 | 核心经营利润率和毛利率能不能平均 | 两个比率分成两行返回。不把它们合成一个平均数 |
| INV-19 | 口径为空是不是没数据 | Wiki 写明 caliber 为空是无口径变体 |
| INV-01 | 立邦 FY2024 营业收入 | 返回值带 `unit=100M` 且 `currency=JPY` |
| INV-08 | 所有公司营收加总 | 按 `currency` 分列。无 source 限定的 `sum(value)` 被拒绝 |
| INV-10 | 立邦 FY2024 营收折人民币 | `fx_rate` 命中 `rate_type=avg` 且窗口为 2024 全年 |
| INV-11 | 没有 avg 窗口的季度再折一次 | 该过滤的 `fx_rate` 为 0 行 |
| INV-09 | 立邦经常利润和宣伟营业利润哪个更高 | 两家 `accounting_standard` 不同，查询结果本身不给出跨准则名次 |
| INV-12 | 金山云 2025 年赚了多少，单季呢 | `FY` 与 `Q1`–`Q4` 分 `period_type` 出现 |
| INV-05 | 招商银行上半年赚了多少 | `fact_company` 过滤该公司为 0 行 |
| INV-06 | 伊利有没有治理事件 | `governance_event` 过滤为 0 行 |
| INV-15 | 同时存在其他连接时查伊利，并改查 `demo-mysql` | `demo-mysql` 被拒绝，原因含 `unknown_or_forbidden_connection` |
| INV-17 | 追问立邦营收的数从哪来 | `source_ref` 为相对路径 |
| INV-04 | 单独再问海外收入占比 | 与 INV-14 相同，状态为 `null_field` |

## 4. 通过线

INV-05、INV-06、INV-08、INV-11、INV-15、INV-16 任一失败，本轮失败。

其余用例看返回的数字、单位、口径、期间是否与当次查询一致。

本文件不替换 `uat-mysql-aliyun-data-qa.md`。
