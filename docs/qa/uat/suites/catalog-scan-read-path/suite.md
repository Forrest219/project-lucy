# UAT-SUITE-CATALOG-SCAN — 库内扫表读法

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CATALOG-SCAN` |
| 总账 ID | **P1-16**／REQ-030-037 |
| 目标 | 证明普通 MySQL 宽库「准备表结构」走 Schema 宽一次 columns；外部目录合同由替身／可选 live 覆盖；错误无密码泄漏 |
| 合同回链 | [Spec](../../../../specs/lucy-20261111-catalog-scan-read-path-spec.md) SC-01–SC-14；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 本机模拟策略

| 场景 | 做法 |
|---|---|
| 宽 Schema（客户 `tblu`／多表超时类） | `scripts/uat/seed-catalog-scan-fixtures.sh` 在 `demo-db` 生成 `uat_wide_scan`（默认 200 表×5 列） |
| 外部目录 `SHOW`（客户 SelectDB／Hive） | 必做：仓内 vitest 替身；可选：真实 `catalog.database` 连接 live |

demo 默认连接无 `hive.*` 形态，**不得**把「只测了 demo-mysql」写成外部目录 live PASS。
