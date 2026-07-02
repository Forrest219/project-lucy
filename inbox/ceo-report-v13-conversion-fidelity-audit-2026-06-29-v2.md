# CEO 报告 V1.3 转换产物保真度审计（v2 复检）

| 元数据 | 内容 |
|---|---|
| 版本 | v2 复检 |
| 日期 | 2026-06-29 |
| 范围 | 修复后 `inbox/ceo_report_v13_conversion/output/*` 对原 docx 的忠实度 |
| 审计方 | Workhorse（hermes-agent，profile=workhorse） |
| 上游复核 | v1 brief：`inbox/ceo-report-v13-conversion-fidelity-audit-2026-06-29.md` |
| 临时文件位置 | `inbox/`（本文件可随任务结束后删除） |

## 0. 结论一句话

**修复版整体上达到了 ground truth 的完整性要求，并显著改进了语义分类**（page-inheritance / risk-candidates / freshness-notes / document-notes / 图像占位）。剩余 **1 处忠实度瑕疵 + 1 处建议性改进**，不影响决策使用，但应在 README/manifest 注释中明示。

## 1. 计数对齐（13 项全部 PASS）

| 产物 | 期望 | 实际 | 结论 |
|---|---|---|---|
| section-inventory | 95 | 95 | ✅ |
| page-inheritance | 2 | 2 | ✅ |
| indicators | 288 | 288 | ✅ |
| metric-rules | 132 | 132 | ✅ |
| source-sql | 77 | 77 | ✅ |
| warehouse-tables | 413 | 413 | ✅ |
| table-catalog | 352 | 352 | ✅ |
| ddl-fields | 70 | 70 | ✅ |
| validation-notes | 36 | 36 | ✅ |
| risk-notes | 3 | 3 | ✅ |
| risk-candidates | 9 | 9 | ✅ |
| freshness-notes | 40 | 40 | ✅ |
| document-notes | 5 | 5 | ✅ |

`manifest.counts.pages=20` = 18 业务页 + 2 文档级节（1.业务背景 / 2.规范要求），与 `structured.json.pages` 数组长度一致。

## 2. 18 页完整覆盖矩阵

| 页面 | indicators | source-sql | validation | risk | 说明 |
|---|---|---|---|---|---|
| 1.首页 | 27 | 4 | 1 | 0 | 全 |
| 2.净现金流 | 15 | 6 | 2 | 0 | 全 |
| 3.营业收入 | 37 | 3 | 2 | 0 | 全 |
| 4.营业收入-广告 | 18 | 5 | 1 | 0 | 全 |
| 5.营业收入-会员 | 15 | 2 | 1(占位) | 0 | 1.6 节 2 张图，未 OCR |
| 6.营业收入-国际化广告 | 8 | 4 | 1(占位) | 0 | 1.6 节 2 张图 |
| 7.营业收入-国际化会员 | 19 | 8 | 1(占位) | 0 | 1.6 节 2 张图 |
| 8.净利润 | 21 | 17 | 8 | 2 | 全（含 FineBI 验证链接） |
| 9.M-ROE | 22 | 2 | 1 | 0 | 全 |
| 10.负反馈率 | 8 | 6 | 3 | 0 | 全 |
| 11.CLV | 39 | 6 | 8 | 0 | 全 |
| 12.CLV-国内 | 11 | 3 | 2 | 0 | 全 |
| 13.CLV-国际 | 21 | 1 | 1(占位) | 0 | 1.6 节 2 张图 |
| 14.DAU | 11 | 7 | 3 | 0 | 全（已补回，v1 漏） |
| 15.业务总览-国际化 | 11 | 0 | 0 | 0 | 目录只有 15.1/15.2/15.3 三节，无 1.3/1.4/1.5/1.6，**正确语义** |
| 16.业务总览-会员 | 0 | 0 | 0 | 0 | page-inheritance：继承 5 营业收入-会员 |
| 17.业务总览-TOB | 5 | 3 | 1(占位) | 1 | 1.6 节 7 张图 |
| 18.业务总览-广告 | 0 | 0 | 0 | 0 | page-inheritance：继承 4 营业收入-广告 |

## 3. 修复版的新设计评估

### 3.1 page-inheritance：解决"16/18 整页丢失"的真问题

`page-inheritance.csv` 2 条：

```
16.业务总览-会员  →  referenced_page=5.营业收入-会员
18.业务总览-广告  →  referenced_page=4.营业收入-广告
```

**与原 docx 实际编排吻合**：原 docx 16/18 章节是**单张图片**（image_count=1），不包含独立指标/SQL/验证结论文字。原目录里也只有 16.业务总览-会员 / 18.业务总览-广告 这两个标题，正文是图片。继承声明是符合事实的。

### 3.2 section-inventory：18 页 × 6 节的章节清单

每页 subsection 数对得上：
- 大多数页 6 节
- 15.业务总览-国际化 3 节（15.1/15.2/15.3，原目录确实只有这三个）✅
- 16.业务总览-会员 1 节（"16.业务总览-会员"标题下空白+1 张图）✅
- 18.业务总览-广告 1 节（同上）✅

`has_indicator_table` / `has_source_sql_table` / `has_validation_section` 三列提供了结构化标志位，可直接用于 RAG/检索过滤。

### 3.3 risk-notes / risk-candidates：3 + 9 分层

- **risk-notes 3 条**（真风险）：8.净利润 2 条（"无页面数据验证" + "历史数据动态变化，无法回溯验证"）+ 17.业务总览-TOB 1 条（"TOB-签单表在结算中台线上数据未修复的情况下，手工填报持续录入"）
- **risk-candidates 9 条**（低置信度候选）：包含 2.净现金流 3 条 DDL 残段（`ENGINE=InnoDB...COMMENT='银行账户每日余额表-历史数据'`）、7.国际化会员口径"历史上有会员订单"长定义、8.净利润 2 条（已并入 risk-notes）、10.负反馈率"国际 dau 历史数据"、17.业务总览-TOB 1 条（已并入）

**评估**：把"无内容/省略/T+1/历史/密码"等过激关键词的命中拆成"真风险"和"候选"，是合理的**保守化设计**——宁可人工再判也不误报。v1 的 20 条里有 2 条 `2.规范要求`（文档级规则）误判，现在 0 条 ✅。

### 3.4 freshness-notes 40 条：T+ 与更新时点

按页分布合理（2.净现金流 4、8.净利润 5、6.国际化广告 5 等）。每条带 `page_title + subsection_title + text` 三列，可直接喂给"数据新鲜度"专题的检索/问答。

### 3.5 document-notes 5 条：剥离文档级说明

把"一、文档编写说明"（1.业务背景 + 2.规范要求 4 个编号项）整块从 page 抽取中剥离。这避免了 v1 里"2.规范要求"被错认为 page 的 bug ✅。

### 3.6 validation-notes 36 条：图像型占位

5/6/7/13/17 五个页面的 1.6 节是图片（image_count=2/2/2/2/7），抽取器用占位文本"\[图像型验证结论占位：原 DOCX 此节包含 N 张图片，未 OCR\]"明示，**未掩盖缺失**。这是诚实的处理方式，比 v1 漏抽更可信 ✅。

## 4. 剩余问题（按严重度）

### 🟡 M1：page-inheritance text 字段不是原文字面

`page-inheritance.csv` 的 `text` 字段：

```
'1、指标清单、指标口径/计算规则、数据溯源、FineDataLink数仓、数据更新时点同【营业收入-会员】一致。'
'指标清单、指标口径/计算规则、数据溯源、FineDataLink数仓、数据更新时点同【营业收入-广告】一致。'
```

在原 docx 的 plain text 里**完全搜不到**这两句（统计 0 次）。原 docx 这两页正文位置都是 image，没有可抽的 plain text。

**含义**：这段 text 字段是抽取器根据"目录结构 + 1.5 节常出现的标准表述模板"推断的总结，**不是 OCR 结果**（如果做 OCR 应该有 OCR 标记）。

**建议（非阻断）**：
- 在 `page-inheritance.csv` 加一列 `text_source = "inferred"` 或 `"image_unreadable"`
- 或在 README/manifest 注释里写明："page-inheritance.text 为抽取器综合推断，原 docx 该节为图片"
- 长远应该接 OCR 拿到真实图内文字（image1.png~image105.png 中对应 16/18 的那 1+1 张）

### 🟢 M2：risk-candidates 9 条里有 3 条是 DDL 残段

`risk-candidates.csv` 的 2.净现金流 3 条：

```
') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='银行账户每日余额表-历史数据';
'资金流水详情表历史数据'
'银行账户每日余额表历史数据'
```

这些是 DDL 定义的表名/注释（"银行账户每日余额表-历史数据"是表的 COMMENT），被"历史"关键词误抓。**实际上"历史数据"是表的描述（一张历史快照表），不是风险**。

**建议（非阻断）**：risk-candidates 的过滤条件应排除"`COMMENT=` 开头的 DDL 行"和"`表名+历史数据`模式"（正常的"历史数据表"表名）。

### 🟢 M3：1.6 节 16 个页面 text_count=0 但 image_count>0 的可发现性

5/6/7/13/17 五个页面 1.6 节 `text_count=0, image_count=2/2/2/2/7`，validation-notes 用占位文字标注。**对用户友好、可发现**，但 manifest 没有汇总"未 OCR 验证结论数"。

**建议（非阻断）**：在 `manifest.json` 增加 `unread_validation_conclusions` 字段，统计需要 OCR 的页面数（=5）与图片总数（=15），方便后续接 OCR 任务时一眼看到 backlog。

## 5. 最终评级

| 维度 | v1 | v2 |
|---|---|---|
| 计数自洽 | ✅ | ✅ |
| 18 页覆盖 | ❌ 16/18/15 漏 | ✅ 完整（含继承声明） |
| validation 覆盖 | ❌ 9/18 缺 | ✅ 全部 18 页（含 5 页图像占位） |
| risk 分类 | ❌ 关键词过激 | ✅ 真风险/候选分层 |
| 文档级章节剥离 | ❌ 混入 page | ✅ 独立 document-notes |
| 新鲜度信息 | ❌ 与 risk 混 | ✅ 独立 freshness-notes |
| 忠实度瑕疵 | — | 🟡 page-inheritance text 字段是推断非字面 |

**结论：v2 产物可作为 Lucy 数据问答的 ground truth 索引使用**，建议在交付时附 README 说明 page-inheritance.text 字段的推断属性，并记录"15 张验证结论图片待 OCR"作为后续任务。

## 6. 落点

- v2 产物：`inbox/ceo_report_v13_conversion/output/`（13 个文件）
- 本审计：`inbox/ceo-report-v13-conversion-fidelity-audit-2026-06-29-v2.md`（本文件）
- 上游 v1 brief：`inbox/ceo-report-v13-conversion-fidelity-audit-2026-06-29.md`

## 7. 下一步建议

| # | 任务 | 优先级 | 估时 |
|---|---|---|---|
| N1 | 写一份简短的 `output/README.md`，说明各 CSV 用途 + page-inheritance.text 推断属性 | P1 | 15 min |
| N2 | `manifest.json` 加 `unread_validation_conclusions` 字段（=5 页 / 15 张图） | P2 | 5 min |
| N3 | 修 risk-candidates 的 DDL 残段过滤（排除 `COMMENT=` 开头 + `表名+历史数据` 模式） | P2 | 10 min |
| N4 | 安排 OCR 任务：image1.png~image105.png 中 15 张验证截图 | P2（独立任务） | 视 OCR 工具 |
| N5 | 决定是否把 `ceo-report-v13.structured.json` (1.2MB) 视为 ground truth 入库 | P0 | 需用户决策 |

---

_Workhorse: workhorse (hermes-agent) | 2026-06-29 v2 复检完成_
_本审计仅做只读核查，未修改 `inbox/ceo_report_v13_conversion/` 任何文件_
