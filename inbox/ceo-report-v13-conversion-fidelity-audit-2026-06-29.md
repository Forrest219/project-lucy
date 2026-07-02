# CEO 报告 V1.3 转换产物保真度审计

| 元数据 | 内容 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-06-29 |
| 范围 | `inbox/ceo_report_v13_conversion/output/*` 对 `temp/CEO一眼报数据溯源及验证报告V1.3(2).docx` 的忠实度 |
| 审计方 | Workhorse（hermes-agent，profile=workhorse） |
| 待复核 | Codex |
| 临时文件位置 | `inbox/`（本文件可随任务结束后删除） |

## 0. 背景

`temp/CEO一眼报数据溯源及验证报告V1.3(2).docx`（5709 行 / ~22MB，sha256 写入 `output/manifest.json`）由 `inbox/ceo_report_v13_conversion/convert_ceo_report_docx.py` 抽取为：

- 1 份 markdown（`ceo-report-v13.ai-readable.md`，4708 行）
- 1 份 structured JSON（`ceo-report-v13.structured.json`，19535 行）
- 1 份 structured XLSX
- 8 份 CSV：indicators / metric-rules / source-sql / warehouse-tables / table-catalog / ddl-fields / risk-notes / validation-notes

manifest 报告的产物计数（288 / 132 / 77 / 413 / 352 / 70 / 35 / 20）与脚本运行后实际行数完全一致，**抽取过程自洽**。本审计关心的是"产物对原文档的忠实度"。

## 1. 原文档结构 ground truth

原 docx 目录与 1.1 业务背景段都明确写了 18 个页面：

```
1.首页 / 2.净现金流 / 3.营业收入 / 4.营业收入-广告 / 5.营业收入-会员
6.营业收入-国际化广告 / 7.营业收入-国际化会员
8.净利润 / 9.M-ROE
10.负反馈率
11.CLV / 12.CLV-国内 / 13.CLV-国际
14.DAU
15.业务总览-国际化 / 16.业务总览-会员 / 17.业务总览-TOB / 18.业务总览-广告
```

每页固定 6 节：`1.1 指标清单 / 1.2 指标口径·计算规则 / 1.3 数据溯源 / 1.4 来源环境对比数据 / 1.5 FineDataLink 数仓 / 1.6 数据验证结论`。
（注：原 docx 编号体系是"页面号.X"，不同页面的 X 取值独立——比如"8.净利润"下没有"1.1"，而是"8.1~8.6"。为简洁本审计统一用"1.X"指代同位置节。）

## 2. 发现的偏离（按严重度排序）

### 🔴 P0-1：整页丢失

`ceo-report-v13.indicators.csv` 按 `page_title` 分组只有 16 个页面，**`16.业务总览-会员` 和 `18.业务总览-广告` 整页缺失**；`15.业务总览-国际化` 有 page 名但 indicators / source-sql / risk-notes / validation-notes 全 0 条。

| 期望 page_title | indicators | source-sql | risk-notes | validation-notes |
|---|---|---|---|---|
| 15.业务总览-国际化 | **0** ❌ | 0 | 0 | 0 |
| 16.业务总览-会员 | 缺失 ❌ | 缺失 | 缺失 | 缺失 |
| 18.业务总览-广告 | 缺失 ❌ | 缺失 | 缺失 | 缺失 |

#### Codex 复核要求

| # | 检查项 | 期望 |
|---|---|---|
| P0-1.1 | 打开原 docx 搜"16.业务总览-会员"和"18.业务总览-广告"，确认两节确实存在并包含指标表 | 应有 ≥1 个表 |
| P0-1.2 | 同样搜"15.业务总览-国际化"，确认其下确有指标清单表 | 应有 ≥1 个表 |
| P0-1.3 | 检查 `convert_ceo_report_docx.py:441` 处的指标匹配条件（`"指标清单" in current_subsection or "指标名称" in header_text`）在 15/16/18 页是否生效 | 给出失效原因（猜测：docx 样式 ID 是数字 `11/4/41`，`heading_level()` line 99-101 走的是 `Heading\s+N` 字符串匹配，匹配不到） |
| P0-1.4 | 用 `python-docx` 直接遍历 15/16/18 页的"指标清单"表头/行数，写出 ground truth 行数 | 实际行数 |

### 🔴 P0-2：数据验证结论（1.6 节）大面积漏抽

18 页 × 1.6 节 = 理论 **≥18 条** 验证结论文本（部分页有 2~3 段）。脚本仅抽到 35 条，覆盖 9 个页面。

缺失的 9 个页面（`validation-notes.csv` 里 page_title 不出现）：
`5.营业收入-会员 / 6.营业收入-国际化广告 / 7.营业收入-国际化会员 / 12.CLV-国内 / 13.CLV-国际 / 15.业务总览-国际化 / 16.业务总览-会员 / 17.业务总览-TOB / 18.业务总览-广告`

#### Codex 复核要求

| # | 检查项 | 期望 |
|---|---|---|
| P0-2.1 | 在原 docx 中逐页搜 `1.6 数据验证结论` 段落，记录每页段数与首段正文 | ≥18 页各 ≥1 段 |
| P0-2.2 | 解释 `is_natural_note()`（脚本 line 333-340）为什么把 9 页结论判定为非自然语言 | 给出正则 `^[A-Za-z0-9_.*()/%<>= '\"-]+$` 在这些页面失配的具体段落 |
| P0-2.3 | 列出 `validation-notes.csv` 实际缺失条数 vs 真实段落数 | 给数字差 |

### 🔴 P0-3：风险备注（risk-notes）误命中 + 漏抽

抽到 20 条，问题：
1. 2 条属于"二、文档编写说明"段下的 `2.规范要求`（被误判为 page），而非任何真实页面的风险点。
2. 大量真实风险未被抓到，比如：
   - `1.首页 / 1.3` 的"特殊场景说明"
   - `3.营业收入 / 1.6` 的"无法回溯验证"
   - `7.营业收入-国际化会员 / 1.6` 的核对差异
   - `8.净利润 / 1.3` 的"特殊场景/无内容"
   - `11.CLV / 1.6` 差异说明
   - `13.CLV-国际 / 1.6` 备注
   - `14.DAU / 1.6` 备注

#### Codex 复核要求

| # | 检查项 | 期望 |
|---|---|---|
| P0-3.1 | `risk-notes.csv` 里 page_title=`2.规范要求` 的 2 条（"数据核验时无法与页面前端核对一致…"和"鉴于安全因素，财务类数据不允许在阿里云数据库存放…"）应被剔除——它们是文档级总规则，不是某页风险 | 给出剔除方案 |
| P0-3.2 | 关键词列表（`无法/不一致/暂不能/省略/无内容/T+/安全因素/密码/...`）覆盖不到"特殊说明/差异/暂未/历史/动态/特殊场景/无法回溯" | 给出真实漏命中段落数与样例 |
| P0-3.3 | `8.净利润` 中"会员收入（查询需密码）https://finebi.matrixback.com/decision/link/eg82" 是验证来源（FineBI 链接），不是风险，应从 risk-notes 挪到 validation-notes | 给出迁移建议 |

### 🟡 P1-1：源 SQL 漏页

`source-sql.csv` 77 条，但 15/16/18 整页 0 条（与 P0-1 共因）。另外：
- `9.M-ROE` 只 2 条，目录里 9.3 + 9.4 + 9.5 应有多条溯源 SQL，疑似合并或漏判。
- `11.CLV` 6 条，11.3 + 11.5 应有 ≥10 条。

#### Codex 复核要求

| # | 检查项 | 期望 |
|---|---|---|
| P1-1.1 | 在原 docx 中 9.M-ROE 1.3/1.5 段下数实际 SQL 块数 | 给数字 |
| P1-1.2 | 同 11.CLV 1.3/1.5 | 给数字 |
| P1-1.3 | 检查匹配条件（脚本 line 444 `"溯源SQL" in header_text or ("系统表名" in header_text and "数据溯源" in current_subsection)`）为什么对 9/11 失配 | 给原因 |

### 🟡 P1-2：风险归类错位（risk vs validation 未做上下文区分）

脚本把 `8.净利润|8.6 数据验证结论` 下的 FineBI 链接当成 risk 抓出来（命中"密码"），但 FineBI 链接属于**验证来源**维度，不是风险点。

`is_natural_note()` 只在 1.6 段过滤，risk-notes 不过滤。两者都靠"是否在 1.6 段"做隐式区分，但脚本 line 417 risk 关键词匹配并不限制 subsection，等于一个段可以被两边都抓。

#### Codex 复核要求

| # | 检查项 | 期望 |
|---|---|---|
| P1-2.1 | 列出 `risk-notes.csv` 里属于 1.6 节的全部条目数 | 给数字 |
| P1-2.2 | 建议 risk/validation 用"`subsection` 是否等于 `1.6`"做主判，关键词做辅判 | 评估可行性 |

### 🟢 P2-1：warehouse-tables 计数合理性

`warehouse-tables.csv` 413 条，相同 page 重复累加（比如"首页"出现 3 次"客户关系建立"+"获取销售机会"+"提案反馈"等同类表）。这是"按出现位置拆行"的副作用，不是 bug。**Codex 复核可跳过本项**。

### 🟢 P2-2：DDL 字段 70 条可能偏少

原 docx 中带 `CREATE TABLE` 的段落（CLV 12/13 节）有 2~3 处，70 条对应这些 DDL 的列数总和。**Codex 复核可跳过本项**。

## 3. 根因分析（看脚本可定位）

`convert_ceo_report_docx.py` 是**纯正则 + 表头匹配**的抽取器，3 个隐性假设都不成立：

1. **docx 段落样式名是 `Heading 1/2/3` 的英文**（line 99-101 的 `re.match(r"Heading\s+(\d+)", style)`）。
   - 实际 docx 样式 ID 是数字 `11/4/41/21/3/2/18`（Microsoft Office 中文版默认样式 ID）。`heading_level()` 返回 `None`。
   - **后果**：整页 H2 标题没识别成 H2，后续 1.1~1.6 三级小节全部跟错 page → 15/16/18 整页直接被遗弃。

2. **`is_natural_note()`（line 333-340）正则过严**：`^[A-Za-z0-9_.*()/%<>= '\"-]+$` 且长度 < 80 才算"非自然语言"，但验证结论常含数字、URL、缩写、代码片段 → 大量被剔出 validation-notes。

3. **risk/validation 用关键词 + 标题位置双重判定**：
   - 关键词列表太死板，没覆盖"特殊说明/差异/暂未/历史/动态/特殊场景/无法回溯"等真实表述。
   - 文档级段落（如"一、文档编写说明"）一旦包含"无法/省略"就被错认成某页的 risk（误把 `2.规范要求` 标成 page）。
   - 1.6 节里的 FineBI 链接被 risk 关键词（"密码"）误抓。

## 4. Codex 复核产物要求

请把复核结果写到 **`inbox/ceo-report-v13-conversion-fidelity-audit-codex-2026-06-29.md`**，按以下结构：

```
| # | 检查项 | 期望 | 实际 | 结论（PASS/FAIL）|
```

- P0-1 / P0-2 / P0-3 全部 14 个子项必须给数字结论。
- 给出修复建议：是否重写 `convert_ceo_report_docx.py`（用 docx 段落样式 ID→中文标题名映射 + 数字编号切分章节），还是补 patch。
- 如果判定"产物不可信、需要重抽"，请明确列出重抽后的 ground truth 行数目标（每 CSV 应有 N 条）。
- 复核时长预算：≤ 30 分钟。

## 5. 签收条件（Codex → Workhorse）

| # | 条件 |
|---|---|
| SC-1 | P0-1 / P0-2 / P0-3 全部子项有 PASS/FAIL 结论，无空白 |
| SC-2 | 对每条 FAIL 给出"原 docx 第几节 / 第几行 / 实际行数"的取证（不靠猜测） |
| SC-3 | 给出"重抽 vs 补 patch"二选一明确建议，并标注影响范围 |
| SC-4 | 不修改 `inbox/ceo_report_v13_conversion/` 下任何文件（只读复核） |

---

_Workhorse: workhorse (hermes-agent) | 2026-06-29_
_待 Codex 复核 → 复核结果回填到本目录同前缀文件_
