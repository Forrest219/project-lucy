---
name: moji-intl-weekly-brief
description: >-
  生成墨迹国际化近 7 日经营周报（本地 Markdown）。覆盖 DAU、新增双口径、
  Spend/CAC、D1 留存。在用户提到墨迹周报、国际化日报/周报、Markdown 经营报告、
  moji-intl-weekly-brief 时使用。
---

# 国际化经营近 7 日 Markdown 周报

默认产出：**近 7 个业务日**的本地 Markdown 周报（用户可见标题用「国际化经营周报」，勿写 ChatBI）。  
落盘 `inbox/YYYYMMDD-HHmm-intl-ops-weekly-brief.md`。

## 必读

1. [metric-contract.md](references/metric-contract.md) — 指标口径与取数硬规则  
2. [brief-structure.md](references/brief-structure.md) — 固定章节结构  
3. [../moji-intl-ops-dashboard/references/brand-tokens.md](../moji-intl-ops-dashboard/references/brand-tokens.md) — 墨迹品牌色（文案侧可写「墨迹天气」）  

## 输入（缺省即默认）

| 项 | 默认 |
|---|---|
| connection | `mysql-aliyun`（Cursor 用 `lucy-demo` MCP） |
| 窗口 | `max(date)` 往前含当日共 **7** 个业务日 |
| 平台 / 国家 | 全部（5 国 × android/iphone） |
| 输出 | `inbox/<ts>-intl-ops-weekly-brief.md` |
| 主 KPI | **周均 DAU**（窗口内按日 DAU 再平均；禁止把 7 日 DAU 直接加总当「周 DAU」） |
| 时区 | 业务日与生成时间均为北京时间 |

用户可覆盖：截止日期、只要某国、只要某平台。

## 执行清单

```text
- [ ] 读 metric-contract + brief-structure
- [ ] lucy_catalog：确认国际化四源可见（schema chatbi，用户文案勿写该名）
- [ ] 用 DATE_FORMAT(date,'%Y-%m-%d') 取业务日；禁止用 UTC ISO 当日当业务日
- [ ] 拉取经营 / 广告 / D1 留存（近 7 日）；UV 仅用户明确要求时
- [ ] 周 KPI/分国家/分平台 DAU 用**周均**；分日表用当日 DAU
- [ ] 周总览 KPI 表含「较上周」列（箭头 + 比率；对比上一等长窗口）
- [ ] 比率 sum/sum；跨端加总脚注「非去重」
- [ ] 用户可见业务正文禁止 ChatBI/Lucy/MCP/连接 ID
- [ ] 平台结构含周均占比 + **分日** android/iphone DAU 趋势表
- [ ] 留存正文不写 sum()/SQL 公式；复杂口径放脚注白话
- [ ] 文末含「数据来源」（表名 + 用途）与「附录 · 存档」
- [ ] **禁止文首「元数据|内容」表**
- [ ] 按 brief-structure 写中文 Markdown；落盘 inbox/
```

## 取数优先

1. MCP `lucy-demo` → `lucy_query`（source-qualified measures）  
2. 若 MCP 超时：DBeaver `mysql-aliyun` 只读 SQL（仍遵守合同）  
3. 禁止编造数字；某源失败则对应章节写明失败并省略数值结论  

## 完成回复（中文）

1. 文件路径  
2. 业务窗口 `[start, end]`  
3. 三条结论  
4. 已知数据缺口（如有）  
