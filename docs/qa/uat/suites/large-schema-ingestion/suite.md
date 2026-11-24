# UAT-SUITE-LARGE-SCHEMA — 大 Schema 接入（宽表与多表）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-LARGE-SCHEMA` |
| 总账 ID | **P1-34**／REQ-030-055 |
| 目标 | 持续看守客户规模：列非常多的表、表数非常多的 Schema，在「准备表结构」里**顺利接入**，而不是超时报错或页面卡死。以 2026-11-15 本机实测的规模为**下限** |
| 合同回链 | [Spec](../../../../specs/lucy-20261115-large-schema-ingestion-spec.md) §4 规模下限与预算、§8 LS-01–LS-15；[Plan](../../../../plans/lucy-20261115-large-schema-ingestion-plan.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 规模下限（不得降低，可以升高）

| 对象 | 下限 |
|---|---|
| 普通 MySQL 单 Schema | 1200 张表 × 10 列，外加 1 张 1000 列的表（13000 行字段，超过 `schema-wide` 的 10000 行） |
| 外部目录（Doris／SelectDB 指向 Hive）单 Schema | 600 张表 × 30 列，外加宽表 1500／1999／2000／3000／5000 列 |
| 一次准备 | 勾选 600 张表 |

任何缩小夹具规模的跑次，判定一律记为 `SKIPPED`，不得记 PASS。规模数字来自 2026-11-15 本机实测，不来自臆测。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-SCALE-R0、UAT-SCALE-01…10 | UAT-SCALE-11（Manifest 写入与热重载，只在隔离 compose project 里跑）、UAT-SCALE-12（MySQL 12000 张表的表清单，对应 `TABLE_NAME_LIMIT`） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 任何触及 `schema-structure`、`catalog-show`、`live-discovery`、`prepareSchemaStructure` 的改动合入前 | UAT-SCALE-R0、01…10 全量 |
| 本机 demo 升级或重建之后 | UAT-SCALE-R0、09（不依赖夹具，最快） |
| 客户反馈「大库拉取失败」或「准备表结构卡住」 | 全量；跑次里记下客户库的表数与最宽表的列数，若超出下限则**抬高夹具下限** |
| 发版前兜底 | 全量，且夹具必须来自当次 `seed-large-schema-fixtures.sh`，不得复用旧库 |

## 边界

- 本套件是客户规模场景看守，**≠** 功能合同收口，**≠** 可上线。
- 诊断环境（`inbox/hive-lab/`）的数字是诊断证据，不是 UAT。INDEX 只认本套件 `runs/`。
- 本机延迟远低于客户现场。耗时只看数量级与线性度，不当 SLA；本机 PASS 不证明客户 HMS 往返延迟下也 PASS。
- 无本机 demo 管理员口令时，HTTP 类用例记 `BLOCKED` 并向委托人上报。**禁止**绕过登录或改 `admins.yaml`。
