# UAT-SUITE-BUDGET-AUDIT — 问询预算复盘审计字段

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-BUDGET-AUDIT` |
| 总账 ID | **P1-14**／REQ-030-035 |
| 目标 | 运维场景：真实 `budget_stop` 后，`calls.csv` 含 `budgetSnapshot`／表尾扁平列；普通业务行无快照；v1 metadata 含列、v2 不含 |
| 合同回链 | [预算复盘审计 Spec](../../../../specs/lucy-20261113-question-budget-retrospective-audit-spec.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-BUDGET-AUDIT-01、UAT-BUDGET-AUDIT-02、UAT-BUDGET-AUDIT-03 | — |

## 边界

- 必须依赖**真实**预算终止审计行（来自同日 `UAT-BUDGET-03` 或本套件内自跑 61 次）。禁止 vitest CSV 夹具冒充。  
- 不改 Audit 页表格列（交付面 A）；主路径＝导出 CSV。  
- ≠ 可上线。
