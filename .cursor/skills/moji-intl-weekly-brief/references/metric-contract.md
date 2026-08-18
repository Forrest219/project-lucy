# 国际化经营指标合同（周报 / 看板共用）

连接（内部）：`mysql-aliyun` · Schema：`chatbi`。  
**用户可见文案禁止出现** ChatBI / chatbi / Lucy / MCP 等技术词；对外称「国际化经营指标」。

时区：业务日与生成时间一律按 **北京时间（Asia/Shanghai）**。

## 业务日与生成时间（强制）

- 展示与分组键用 `DATE_FORMAT(date, '%Y-%m-%d')` 或 `CAST(date AS CHAR)`。  
- **禁止**把 UTC ISO（如 `2026-07-12T16:00:00.000Z`）直接当业务日（该例业务日是 `2026-07-13`）。  
- 近 7 日窗口：`end = MAX(业务日)`，`start = end - 6 天`（含首尾共 7 天）。  
- `generated_at` 格式：`YYYY-MM-DD HH:MM:SS（北京时间）`（不要用裸 UTC / 不带时区说明的 ISO）。

## 四源角色（内部）

| 源 | 用途 |
|---|---|
| `ai_intl_country_daily` | DAU、启动、新增墨迹/AF、经营表次日留存人数 |
| `ai_intl_ad_daily` | Spend、广告侧 AF 新增、CAC、曝光、点击 |
| `ai_intl_retention_daily` | N 日留存（默认 D1）；`date`=cohort 日 |
| `ai_intl_user_active_30d_uv_daily` | 仅「近 30 日去重活跃/UV」 |

跨表对齐键：`业务日 + platform + country_abbr`。**不写事实表 JOIN**。

## 指标公式

### 单日（分日趋势）

| 指标 | 公式 | 说明 |
|---|---|---|
| 当日 DAU | 当日 `sum(dau)` | 跨 android/iphone 相加为**端侧加总**，非全球去重 |
| 当日新增-墨迹 / AF | `sum(new_users_moji)` / `sum(new_users_af)` | 流量指标，可按日加总 |
| 当日 Spend | `sum(spend)` | USD |

### 近 7 日窗口 KPI / 分国家 / 分平台（默认）

| 指标 | 公式 | 用户可见名称 |
|---|---|---|
| **周均 DAU** | 先按业务日算全市场（或该国/该端）当日 DAU，再对窗口内业务日做算术平均 | **周均 DAU**（默认周报/看板主 KPI） |
| 周新增-墨迹 / AF | 窗口内 `sum(...)` | 周新增-墨迹 / 周新增-AF |
| AF 覆盖率 | `周新增AF / 周新增墨迹` | AF 覆盖率 |
| 周 Spend | 窗口内 `sum(spend)` | 周 Spend |
| CAC | `周Spend / 周新增AF`（广告表） | CAC |
| D1 留存率 | 窗口内 D1：`sum(retained_users)/sum(new_users_base_moji)` | D1 留存率 |

**不要**把 7 日 DAU 直接 `sum` 后标成「周 DAU」——那是「人天」累加，业务上默认应报**日均**。  
若用户明确要「活跃人天 / 累计 DAU」，再另标，且不得与周均 DAU 混名。

单日内跨端：`android + iphone` 的 DAU 仍为端侧加总；脚注写清「非去重」。

**禁止**对行级 CAC / 留存率 / 人均打开做 `AVG`（先 sum 分子分母再除）。

## KPI 变化（周总览 / 看板 KPI 条，强制）

默认对比：**较上周环比**（上一等长窗口）。

| 项 | 规则 |
|---|---|
| 本期窗口 | `[biz_start, biz_end]`（默认近 7 日） |
| 对比窗口 | `[biz_start - 7d, biz_end - 7d]`（等长、紧邻上一周） |
| 变化率 | `(本期 − 上期) / 上期`；上期为 0 / 无数据 → 显示 `—`，不编造 |
| 用户可见文案 | 「较上周」+ 箭头（↑/↓/→）+ 百分比（如 `↑ 3.2%`） |
| 好坏色 | DAU / 新增 / Spend / D1：**升好降坏**；**CAC：降好升坏**（成本类） |

说明：近 7 日经营周报/看板默认用环比上周；若用户明确要「同比（去年同期）」再另算 YoY，且不得与「较上周」混标。

## 同义词

- iOS/ios/iPhone → `platform='iphone'`  
- 新增-服务器/墨迹 → `new_users_moji`  
- 花费/Spend → `spend`  

## 脏数提示

- 留存率 > 1 或留存人数 > 同维 DAU → 脚注提示。  
- 当前市场仅 HK/KR/DE/US/TH；勿写「全球」。  
