---
title: 国际化经营与广告指标口径（chatbi）
summary: chatbi 四表的 DAU/新增双口径/留存/广告花费与 CAC 口径，以及跨表勾稽与去重陷阱说明。
visibility: private
sl_refs:
  - mysql-aliyun/chatbi/ai_intl_country_daily
  - mysql-aliyun/chatbi/ai_intl_ad_daily
  - mysql-aliyun/chatbi/ai_intl_retention_daily
  - mysql-aliyun/chatbi/ai_intl_user_active_30d_uv_daily
---

# 国际化经营与广告指标口径（chatbi）

> 适用：`mysql-aliyun` / `chatbi` 四表。具体日期、国家以用户问题为准；口径与勾稽关系固定，随数据重算。

## 何时使用

用户询问以下内容时，首选本页：

- 国际化 DAU / MAU / 启动次数
- 新增-墨迹 vs 新增-AF
- 次日留存人数 / N 日留存率
- 广告花费、CAC、CTR
- 跨平台加总是否去重、脏数校验

## 表角色与粒度

| 角色 | 物理表 | 粒度 |
|---|---|---|
| 经营表 | `ai_intl_country_daily` | 日期 × 平台 × 国家 |
| 广告表 | `ai_intl_ad_daily` | 日期 × 平台 × 国家 |
| 留存表 | `ai_intl_retention_daily` | 日期 × 平台 × 国家 × 留存天数 |
| 30 日 UV | `ai_intl_user_active_30d_uv_daily` | 日期 × 平台 × 国家 |

跨表对齐键：`date` + `platform` + `country_region`（国家简称优先用 `country_abbr` 过滤）。**不写事实表 JOIN**，分表查询后在应用侧对齐。

## 同义词与过滤规则

| 用户说法 | 实际处理 |
|---|---|
| iOS / ios / iPhone | `platform = 'iphone'` |
| Android | `platform = 'android'` |
| 新增-服务器 / 服务器新增 / 墨迹新增 | `new_users_moji` |
| 新增-AF / AF新增 | `new_users_af` |
| 花费 / Spend | `spend`（单位：USD） |
| 韩国 / US / JP 等 | 优先 `country_abbr`，其次 `country_region_cn` / `country_region` |

## 单位

| 字段/指标 | 单位 | 注意 |
|---|---|---|
| `dau` / `mau` / 新增 / 留存人数 / `active_30d_uv` | 人 | 不是启动次数 |
| `launches` | 次 | 与 DAU 量纲不同 |
| `spend` | USD | `sum(spend)/sum(new_users_af)` = 美元/人（CAC） |
| `retention_rate` | 小数 | `0.37` 表示 37%；汇总须分子分母重算 |

## 新增双口径

- **墨迹/服务器**（`new_users_moji`）：服务器侧全量新增。
- **AF**（`new_users_af`）：广告归因成功的新增子集。
- 通常 `new_users_moji >= new_users_af`。
- 经营问答默认用经营表的 AF/墨迹字段；广告 CAC 语境用广告表 `new_users_af`。

## 留存时间语义

- 经营表 `retained_users_1d`：经营总览次日留存人数（绝对人数，不是率）。
- 完整 N 日留存用 `ai_intl_retention_daily`，过滤 `retention_days = N`。
- `date` = cohort 新增日；留存人数 = 该日新增在第 N 日回访的人数（「当天新增、第 N 日回访」）。
- 留存率默认：`sum(retained_users) / nullif(sum(new_users_base_moji), 0)`，禁止对行级 `retention_rate` 做 AVG。

## 广告与 CAC

- 花费、曝光、点击、CAC 默认用 `ai_intl_ad_daily`。
- CAC / CPI(AF) = `sum(spend) / nullif(sum(new_users_af), 0)`。
- CTR = `sum(clicks) / nullif(sum(impressions), 0)`。
- 本表无 DAU；问 DAU 回经营表。

## 30 日活跃

- 明确「近 30 日去重活跃 / UV」→ `ai_intl_user_active_30d_uv_daily.active_30d_uv`。
- 普通「近 30 日日均 DAU」→ 经营表按窗口对 `dau` 按日汇总后再平均，不要 AVG 行级 `avg_dau_30d`。

## 聚合陷阱与脏数

- 跨平台直接 `sum(dau)` 是端侧加总上限，不是全球去重 DAU。
- 行级比率（CAC、人均打开、留存率）跨维度汇总必须 `sum/sum` 重算。
- 若留存人数 > 同日 DAU、或留存率 > 1，应提示可能脏数/口径不一致，不要当正常结论硬报。
