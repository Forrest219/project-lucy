# KSC Financial Eval（对标 Spider 2.0）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 金山云财务报表 Eval 说明 |
| 文档类型 | Other |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |

## 对标关系

对齐 [Spider 2.0](https://spider2-sql.github.io/) 的评测哲学，而不是照搬其 547 题库：

| Spider 2.0 | 本套件 |
|---|---|
| 企业级多步 SQL / 分析工作流 | 跨表杜邦、现金流勾稽、经营摘要 |
| 长上下文 + 外部知识 | Wiki `ksc-financial-dupont-playbook.md` |
| 以 **exec result** 判分（CSV），不全靠 Gold SQL 字符串匹配 | `result_assertions` + `gold/*.csv`；`golden_sql` 仅复现 |
| Gold SQL 不宜直接做 SFT | 同上声明于 suite metadata |

## 产物

```text
evals/ksc_financial/
  README.md
  eval/ksc_financial-eval-cases.yaml   # 33 cases + 8 quiz
  gold/*.csv                           # exec-result 金标表
```

仓库镜像路径：`project-lucy/evals/ksc_financial/`。

## 金标来源

- 连接：StarRocks `10.69.65.62:8090` / schema `ai`
- 快照日：`2026-08-08`
- 期间：`fiscal_year` 2021–2025，`fiscal_quarter = 0`（年报）
- Lucy connectionId：`starrocks-r1`

## 覆盖摘要

| 类型 | 题数（约） | 代表 case |
|---|---:|---|
| 基础取数 | 5 | `ksc-income-revenue-2024` |
| 反模式 / 口径 | 8 | 单位、符号、NULL≠0、合并 vs 母公司 |
| 杜邦 / 跨表硬题 | 5 | `ksc-dupont-2024`、面板、经营摘要 |
| 勾稽 / 边界 | 若干 | `fx_effect`、BS vs CF 现金差额 |
| 多轮 | 1 | `ksc-multiturn-dupont-001` |

## 刷新金标

数据变更后，用只读 SQL 重跑 `golden_sql` / `gold/*.csv` 对应查询，更新 `result_assertions` 并 bump `metadata.version` / `snapshot_date`。

## 端到端接入与 MCP 评测

上传包接入 WebUI、扩 ACL、用 MCP 对照 gold：先读  
[`docs/qa/e2e-sop.md`](../../docs/qa/e2e-sop.md)，再执行分表  
[`docs/qa/suite-semantic-onboard-mcp-eval.md`](../../docs/qa/suite-semantic-onboard-mcp-eval.md)  
（本主题 2026-08-08 冒烟报告：`inbox/ksc-financial-mcp-eval-smoke-20260808.md`）。
