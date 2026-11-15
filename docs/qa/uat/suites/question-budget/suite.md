# UAT-SUITE-QUESTION-BUDGET — 问询预算默认阈值（60／300）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-QUESTION-BUDGET` |
| 总账 ID | **P1-12**／REQ-030-033 |
| 目标 | 客户场景：initialize 指导为 60 次／300 秒；同问询内不得在第 21 次误耗尽（旧 20 回归）；可选跑满第 61 次耗尽 |
| 合同回链 | [问询预算阈值放宽 Spec](../../../../specs/lucy-20261111-question-budget-threshold-relax-spec.md)；既有 Spec 162；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-BUDGET-01、UAT-BUDGET-02 | UAT-BUDGET-03（第 61 次耗尽；**推荐**，供 P1-14 复用）；UAT-BUDGET-04（触顶后续查；**推荐**，需自造含 `lucy_continue_question` 的临时身份） |

## 边界

- **数据工具**仅计 `lucy_query`／`lucy_read_source`（见 `isQuestionDataTool`）。`lucy_catalog`／`lucy_begin_question`／协议方法**不计**预算。  
- `QUESTION_BUDGET_MAX_CALLS=60` 为源码常量；**禁止**为图快改常量或挂 patch。  
- 禁止 vitest／CR 冒充 PASS；≠ 可上线。
