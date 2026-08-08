# demo_ad Eval（投放账户漏斗）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 投放账户漏斗 Eval 说明 |
| 文档类型 | Other |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |

## 对标关系

由 AskTable `demo-0807` Batch-1 业务问数 + 口径反模式迁移到 Lucy；判分以 **exec-result**（`result_assertions` + gold CSV）为主。

## 产物

```text
evals/demo_ad/
  README.md
  eval/demo_ad-eval-cases.yaml
  gold/*.csv
```

## 金标来源

- 连接：MySQL `mysql-aliyun` / schema `dataforai`
- 表：`ad_account_daily`（10000 行）
- 快照日：`2026-08-08`
- 数据末日：`2026-07-06`

## 覆盖摘要

| 类型 | 代表 case |
|---|---|
| 基础取数 | 覆盖区间、账户映射、6 月花费/预约、近 30 天花费 Top3 |
| 比率 | 渠道预约 CPA、自运营 vs 代理 |
| 反模式 | 禁止日均再平均、默认 CPA=预约 CPA、锚定 max(date) |

## 刷新金标

数据变更后重跑 `golden_sql`，更新 `result_assertions` / `gold/*.csv`，并 bump `metadata.version` / `snapshot_date`。
