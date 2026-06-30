# POC 场景一：用户活跃分析（牛玉婷 · FineBI）

> Owner：牛玉婷 | 原始资产：FineBI 活跃分析 | POC 表：`poc_app_active_daily`

## 何时使用

用户询问以下内容时，首选本页：

- DAU（日活跃用户数）、启动次数
- Android / iPhone / Harmony 趋势对比
- 含刷新 vs 不含刷新口径差异
- 人均启动次数

## 表结构与粒度

`poc_app_active_daily` 粒度：每行一条 **(日期 × 包名)** 记录，共 3 个包名：

| pkg_name | 说明 |
|---|---|
| `墨迹天气_Android` | Android 端 |
| `墨迹天气_iPhone` | iPhone 端 |
| `墨迹天气_Harmony` | 鸿蒙端 |

## 核心指标

| 指标 | measure | 口径 |
|---|---|---|
| DAU不含刷新 | `dau_noback` | `sum(dau_noback)`；iPhone端排除后台启动 |
| DAU含刷新 | `dau_with_back` | `sum(dau_with_back)` |
| 日启动次数 | `start_cnt_noback` | `sum(start_cnt_noback)` |
| 人均启动次数 | `avg_start_cnt` | `sum(start_cnt_noback)/sum(dau_noback)`；禁止 avg(avg_start_cnt_check) |
| 后台刷新占比 | `back_refresh_ratio` | `(sum(dau_with_back)-sum(dau_noback))/sum(dau_with_back)` |

## 数据趋势（内置场景）

- **Android**：2026-01 → 2026-05 约下降 25%（1,200,000 → 900,000）
- **Harmony**：同期约增长 141%（100,000 → 250,000）
- **iPhone**：基本稳定（~800,000 ± 2%）

## 口径说明

**含刷新 vs 不含刷新**：

- `dau_noback`（不含后台刷新）是 FineBI 活跃分析的标准口径，优先使用
- iPhone 端差异较明显（后台启动在 iOS 上计数方式不同）
- `dau_with_back` 与 `dau_noback` 的差值可量化后台刷新的影响

**上游字段**：

| POC 字段 | 上游字段（rpt.rpt_app_basic_1d_d） |
|---|---|
| `dau_noback` | `app_aty_user_cnt_1d_noback` |
| `dau_with_back` | `app_aty_user_cnt_1d` |
| `start_cnt_noback` | `app_start_cnt_1d_noback` |
| `start_cnt_with_back` | `app_start_cnt_1d` |

## 常见错误

- 不要用 `avg(avg_start_cnt_check)` 计算人均启动，该列是预计算校验列；应使用 measure `avg_start_cnt`
- Android DAU 下降不代表整体 DAU 下降，需同时看 Harmony 增长抵消效果
- 询问"日活"时确认是含刷新还是不含刷新口径

## 演示问题示例

- 2026 年 1 月到 5 月 Android DAU 的趋势如何？
- 鸿蒙端 DAU 增长了多少？
- 三个平台人均启动次数哪个最高？
- 含刷新和不含刷新 DAU 差多少？
