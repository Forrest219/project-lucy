---
visibility: private
sl_refs:
  - poc-mysql-aliyun/data_agent_poc/poc_ad_revenue_daily
  - poc-mysql-aliyun/data_agent_poc/poc_ad_revenue_by_type_daily
---

# POC 场景二：广告经营分析（何洲 · FineVis）

> Owner：何洲 | 原始资产：FineVis 营业收入-广告 | POC 表：`poc_ad_revenue_daily`

## 何时使用

用户询问以下内容时，首选本页：

- 广告收入、曝光量
- eCPM（千次曝光收益）
- 广告 ARPU
- 广告位对比（开屏 / 天气首页中部 / 信息流 / 详情页）

## 表结构与粒度

`poc_ad_revenue_daily` 粒度：每行一条 **(日期 × 广告位 × 国家)** 记录。

广告位枚举：`开屏`、`天气首页中部`、`信息流`、`详情页`

### 日期字段说明

`dt` 是北京时间自然日。MCP / JSON 返回时可能以 UTC ISO 展示，例如 `2026-05-30T16:00:00.000Z` 实际对应北京时间 `2026-05-31`。回答、过滤、同日对账或与 `poc_ceo_metric_snapshot.snapshot_dt` 比较前，必须先转成 `Asia/Shanghai` 日期；不要直接取 UTC 字符串的日期部分。

## 核心指标

| 指标 | measure | 口径 |
|---|---|---|
| 广告收入 | `ad_revenue` | `sum(ad_revenue)`，单位：元 |
| 广告曝光量 | `ad_impressions` | `sum(ad_impressions)`，单位：次 |
| 广告DAU | `ad_dau` | `max(ad_dau)`，单位：人；**必须用max，不能用sum** |
| eCPM | `ecpm` | `sum(ad_revenue)/sum(ad_impressions)*1000`，单位：元/千次曝光 |
| ARPU | `arpu` | `sum(ad_revenue)/max(ad_dau)`，单位：元/人 |

## ⚠️ DAU 字段使用警告

`ad_dau` 在同一 (dt, country) 下的 **4 个广告位行中重复存储**（日级总广告域DAU）。

- ❌ 禁止：`sum(ad_dau)` → DAU 被放大 4 倍，ARPU 缩小 4 倍
- ✅ 正确：`max(ad_dau)` → 取日级真实总DAU

`arpu_check` 列是每行存储的预计算日级总ARPU，可直接用于eval回归，但不作为正式measure。

## 广告位特征

| 广告位 | 特征 | 数据内置场景 |
|---|---|---|
| 开屏 | eCPM 最高（曝光少、单价高） | seed_scenario = '开屏eCPM最高' |
| 信息流 | 总收入最高（曝光量大） | seed_scenario = '信息流收入最高' |
| 天气首页中部 | 中等收入和曝光 | — |
| 详情页 | 收入最低 | — |

## 广告域 DAU vs 产品 DAU

| 来源 | 字段 | 数量级 | 说明 |
|---|---|---|---|
| 广告域 DAU（本表） | `ad_dau` | ~2,400,000 | 友盟三端合计；何洲 FineVis 口径 |
| 产品 DAU（活跃分析表） | `poc_app_active_daily.dau_noback` | ~2,000,000 | rpt表，不含刷新 |

两者差异来源：统计口径、来源系统不同，不是数据错误。广告 ARPU 使用广告域 DAU（本表 `ad_dau`）。

## ARPU 双公式说明

| 公式 | 来源 | 本表适用 |
|---|---|---|
| 广告收入 / 广告域 DAU | IDM层正式口径（§4.2） | ✅ measure `arpu` |
| 广告收入 / 总打开次数 | APP层 app_ad_impressions_a_d | ❌ 本表不采用 |

ARPU 口径最终需何洲确认。POC 采用 IDM 层口径（收入/DAU）。

## 常见错误

- 不要用 `sum(ad_dau)` 作为 ARPU 分母；使用 measure `arpu` 已内置 `max(ad_dau)`
- 不要把广告域 DAU 与产品 DAU 混用；两者数值不同是正常的
- 查询"总收入"时跨广告位 GROUP BY，sum(ad_revenue) 正确（无重复存储问题）

## 演示问题示例

- 哪个广告位的 eCPM 最高？
- 2026 年 1-5 月广告收入趋势如何？
- 开屏和信息流的收入差多少？
- 广告域 ARPU 是多少？
