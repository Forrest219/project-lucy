---
visibility: private
sl_refs:
  - poc-mysql-aliyun/data_agent_poc/poc_metric_catalog
  - poc-mysql-aliyun/data_agent_poc/poc_app_active_daily
  - poc-mysql-aliyun/data_agent_poc/poc_ad_revenue_daily
  - poc-mysql-aliyun/data_agent_poc/poc_ad_revenue_by_type_daily
  - poc-mysql-aliyun/data_agent_poc/poc_ceo_metric_snapshot
---

# Data Agent MCP POC — 数据路由总纲

> 适用：`poc-mysql-aliyun` 连接，`data_agent_poc` 库，面向 lucy MCP 的 `wiki_search` / `wiki_read`。
> POC 数据期间：2026-01-01 ~ 2026-05-31（151天模拟数据）。

## 业务场景与表路由

| 用户问题类型 | 首选表 | Owner | 详细 wiki |
|---|---|---|---|
| DAU、启动次数、人均启动、包名趋势、Android/Harmony/iPhone对比 | `poc_app_active_daily` | 牛玉婷 | poc-active-analysis.md |
| 广告收入、曝光量、eCPM、ARPU、广告位排名 | `poc_ad_revenue_daily` | 何洲 | poc-ad-revenue.md |
| 分品类广告收入（品牌/电商/效果/外包）、IDM治理层DAU、人均打开次数、治理层eCPM | `poc_ad_revenue_by_type_daily` | 陶峙桦 | poc-idm-governance.md |
| 指标口径、来源表线索、证据等级、公式说明 | `poc_metric_catalog` | — | 直接查表 |
| CEO一眼报标杆快照、eval回归值 | `poc_ceo_metric_snapshot` | 陶峙桦 | poc-idm-governance.md |
| 财务数据（净利润、净现金流、营业收入） | `forbidden_finance` | — | ACL deny，无权访问 |

## 当前数据规模

| 表 | 行数 | 粒度 |
|---|---:|---|
| `poc_metric_catalog` | 11 | 指标（唯一） |
| `poc_app_active_daily` | 453 | 日 × 包名（3端 × 151天） |
| `poc_ad_revenue_daily` | 604 | 日 × 广告位 × 国家（4位 × 151天） |
| `poc_ad_revenue_by_type_daily` | 1,208 | 日 × 品类 × 国家 × 平台（4品类 × 2平台 × 151天） |
| `poc_ceo_metric_snapshot` | 9 | 快照日期 × 指标（3日期 × 3指标） |
| `forbidden_finance` | 5 | dummy，ACL deny演示 |

## 核心口径警告（必读）

**DAU 重复存储**：`poc_ad_revenue_daily` 的 `ad_dau` 和 `poc_ad_revenue_by_type_daily` 的 `ad_dau_idm`、`total_opens` 在各明细行（广告位/品类）中重复存储同一日级值。

- ❌ 禁止：`sum(ad_dau)` → 被广告位数（4）倍数放大
- ✅ 正确：`max(ad_dau)` 用于绝对DAU量；`sum/sum` 用于比率（arpu、avg_opens）

**两套 DAU 来源不同**：

| DAU 来源 | 字段 | 数量级（Android） |
|---|---|---|
| 产品 DAU（rpt表） | `poc_app_active_daily.dau_noback` | ~1,200,000 → ~900,000 |
| 广告域 DAU（友盟三端） | `poc_ad_revenue_daily.ad_dau` / `poc_ad_revenue_by_type_daily.ad_dau_idm` | ~1,450,000 → ~1,150,000 |

两者数值不同是正常的，不是数据错误。原因：统计口径和来源系统不同。

**四品类收入一致性**：`poc_ad_revenue_by_type_daily` 四品类（按dt, country跨platform和revenue_type聚合后）等于 `poc_ad_revenue_daily` 同日同国总收入，内置可断言的一致性。

## 反模式：UTC ISO 日期误读

POC 表里的 `dt` / `snapshot_dt` 都表示 **北京时间自然日**。Lucy / KTX / MCP 在 JSON 里可能把 MySQL `DATE` / `DATETIME` 序列化成 UTC ISO 字符串，例如：

| MCP 返回值 | 正确业务日期 | 错误读法 |
|---|---|---|
| `2026-05-30T16:00:00.000Z` | 北京时间 `2026-05-31` | 直接取 UTC 字符串日期当作 `2026-05-30` |

禁止直接用 UTC ISO 字符串的 `YYYY-MM-DD` 部分做业务日期判断、过滤或对账。展示给用户、与快照表比较、或做同日事实表校验前，必须先转成 `Asia/Shanghai` 业务日期。

CEO 快照回归的固定 sanity check：

- `snapshot_dt = 2026-05-31` 对应北京自然日 5 月 31 日；
- `poc_ad_revenue_daily` 当日国内广告收入合计 = `196,314.31`；
- `poc_ad_revenue_by_type_daily` 当日国内四品类合计 = `196,314.31`；
- `190,213.91` 是北京自然日 2026-05-30 的值，不能拿来和 2026-05-31 快照比较。

## ACL 演示说明

`forbidden_finance` 表已进入 manifest（`enabled_tables`），但未授权给 `poc_readonly` 角色。当 Agent 尝试访问该表时，lucy 返回 ACL deny，并记录 audit 事件。这是演示 role-first ACL 的核心场景。

## 检索关键词

墨迹天气, DAU, 启动次数, 广告收入, eCPM, ARPU, 开屏, 信息流, 品牌广告, 效果广告, 电商广告, 外包广告, IDM, 治理层, CEO一眼报, 友盟, 牛玉婷, 何洲, 陶峙桦, poc, data_agent_poc, forbidden_finance, ACL deny。
