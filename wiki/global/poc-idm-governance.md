---
visibility: private
sl_refs:
  - poc-mysql-aliyun/data_agent_poc/poc_metric_catalog
  - poc-mysql-aliyun/data_agent_poc/poc_ad_revenue_by_type_daily
  - poc-mysql-aliyun/data_agent_poc/poc_ceo_metric_snapshot
---

# POC 场景三：IDM 层治理验证（陶峙桦 · CEO一眼报）

> Owner：陶峙桦 | 原始资产：CEO一眼报溯源报告 V1.3 | POC 表：`poc_ad_revenue_by_type_daily`、`poc_ceo_metric_snapshot`

## 何时使用

用户询问以下内容时，首选本页：

- 分品类广告收入（品牌 / 电商 / 效果 / 外包）
- IDM 治理层广告 DAU（友盟三端）
- 人均打开次数
- 治理层 eCPM
- IDM 汇总收入与广告经营表的一致性校验
- CEO 一眼报标杆快照 / eval 回归

## 表结构与粒度

`poc_ad_revenue_by_type_daily` 粒度：每行一条 **(日期 × 收入品类 × 国家 × 平台)** 记录。

| 维度 | 枚举值 |
|---|---|
| `revenue_type`（收入品类）| 品牌、电商、效果、外包 |
| `platform`（平台）| Android、iPhone（**无 ALL 行**；seed data 只插明细行）|
| `country`（国家）| 国内（POC 范围） |

## 核心指标

| 指标 | measure | 口径 | 注意 |
|---|---|---|---|
| 分品类广告收入 | `ad_revenue` | `sum(ad_revenue)` | 四品类合计=广告经营表总收入 |
| 广告DAU（IDM层）| `ad_dau_idm` | `max(ad_dau_idm)` | 必须max，见下方警告 |
| 总打开次数 | `total_opens` | `max(total_opens)` | 必须max |
| 人均打开次数 | `avg_opens_per_user` | `sum/sum` | 重复倍数抵消，比率正确 |
| IDM层ARPU | `arpu_idm` | `sum/sum` | 分母有重复但比率正确 |
| 治理层eCPM | `ecpm_idm` | `sum(ad_revenue)/sum(ad_impressions)*1000` | 字段名待核实 |

## ⚠️ DAU/打开次数字段使用警告

`ad_dau_idm` 和 `total_opens` 在同一 **(dt, country, platform)** 下的 **4 个品类行中重复存储**（单平台日级总值）。

**绝对量**：
- ❌ 禁止：`sum(ad_dau_idm)` GROUP BY dt → 品类数（4）倍数放大
- ✅ 正确：`max(ad_dau_idm)` WHERE platform='Android' GROUP BY dt → Android 日级 DAU
- 跨平台总 DAU：分别对 Android/iPhone 取 max 后相加，或直接用 `poc_ad_revenue_daily.ad_dau`（已合计）

**比率（ratio）**：
- ✅ `avg_opens_per_user` = `sum(total_opens)/sum(ad_dau_idm)` → **sum/sum 正确**，重复倍数在分子分母中抵消

## IDM DAU vs 产品 DAU（口径差演示）

| DAU | 字段 | 数量级 | 说明 |
|---|---|---|---|
| 产品DAU（rpt）| `poc_app_active_daily.dau_noback` | Android: ~1,200,000 → ~900,000 | 不含后台刷新 |
| IDM广告DAU（友盟）| `poc_ad_revenue_by_type_daily.ad_dau_idm` | Android: ~1,450,000 → ~1,150,000 | 友盟口径，更大 |

**差异约 23%**，来自统计口径和系统不同，是预期行为。这是本场景的核心治理验证点。

## 治理层一致性校验

**内置可断言的一致性**：

```sql
-- 四品类合计（跨品类×平台双重sum）= 广告经营表总收入
SELECT
  b.dt,
  SUM(b.ad_revenue) AS type_total,
  SUM(d.ad_revenue) AS daily_total
FROM (
  SELECT dt, country, SUM(ad_revenue) AS ad_revenue
  FROM poc_ad_revenue_by_type_daily
  WHERE country = '国内'
  GROUP BY dt, country
) b
JOIN (
  SELECT dt, country, SUM(ad_revenue) AS ad_revenue
  FROM poc_ad_revenue_daily
  WHERE country = '国内'
  GROUP BY dt, country
) d USING (dt, country)
GROUP BY b.dt;
-- 预期：type_total == daily_total（误差 ≤ 0.02 元）
```

## 字段来源（上游溯源）

| POC 字段 | 上游来源 | 确认状态 |
|---|---|---|
| `revenue_type` 枚举 | CEO一眼报 docx §4.5 IDM层字段描述 | 已确认 |
| `ad_dau_idm` | `odm_umeng_all_threeends.act_num`（sum(act_num) as dau）| **已确认**（docx §4.3 SQL） |
| `total_opens` | `odm_umeng_all_threeends.start_num`（sum(start_num)）| **已确认**（docx §4.3 SQL） |
| `ad_revenue`（各品类）| `idm_ad_revenue_a_d` 字段描述推断 | **待核实**：字段名待数据平台确认 |
| `ad_impressions`（各品类）| `idm_ad_revenue_a_d` 字段描述推断 | **待核实** |

## CEO 快照表说明

`poc_ceo_metric_snapshot` 存储 2026-01-31、2026-03-31、2026-05-31 三个快照日期的指标基准值：

| metric_code | dimension_desc | 用途 |
|---|---|---|
| `ad_revenue` | ALL | 当日总广告收入基准 |
| `ad_arpu` | ALL | 当日总ARPU基准 |
| `ad_revenue_by_type` | 效果 | 效果品类当日收入基准 |

当前 `benchmark_type = 'mock_value'`（模拟值）。陶峙桦提供真实截图后升级为 `owner_screenshot`。

### 快照日期与 UTC 展示

`snapshot_dt` 是北京时间自然日。MCP 返回 JSON 时可能显示成 UTC ISO，例如 `2026-05-30T16:00:00.000Z`；这对应北京时间 `2026-05-31 00:00:00`，不是 2026-05-30。

对账前必须先把 UTC ISO 转成 `Asia/Shanghai` 日期。固定回归值：

- 北京 2026-05-31：`poc_ceo_metric_snapshot.ad_revenue / ALL = 196,314.31`
- 北京 2026-05-31：`poc_ad_revenue_daily` 国内总广告收入 = `196,314.31`
- 北京 2026-05-31：`poc_ad_revenue_by_type_daily` 国内四品类合计 = `196,314.31`
- 北京 2026-05-30：国内总广告收入 = `190,213.91`，不能用于 5 月 31 日快照校验

## 品类收入分布（内置场景）

| 品类 | 占比 | seed_scenario |
|---|---|---|
| 效果 | ~40% | `效果收入占比最大` |
| 品牌 | ~28% | — |
| 电商 | ~20% | — |
| 外包 | ~12% | — |

## 常见错误

- 询问"今天广告 DAU 多少"时，必须指定平台后用 `max(ad_dau_idm)`，不要跨品类 sum
- 不要用 IDM 层 DAU 与产品 DAU 直接对比说"数据不一致"——两者来源不同，差异是预期的
- ARPU 公式：IDM 层口径是**收入/DAU**，不是收入/打开次数（后者是 APP 层口径）

## 演示问题示例

- 效果类广告收入占总收入的比例是多少？
- IDM 层广告 DAU 和产品 DAU 差多少？
- 治理层四品类收入合计和广告经营表总收入是否一致？
- 1月31日广告 ARPU 是多少？
- 如果查询净利润会发生什么？（ACL deny 演示）
