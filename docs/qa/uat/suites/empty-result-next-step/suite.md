# UAT-SUITE-EMPTY-NEXT-STEP — 空结果下一步指导

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-EMPTY-NEXT-STEP` |
| 总账 ID | **P0-5**／REQ-030-018 |
| 目标 | 证明严格 0 行事实结果时返回结构化 `next_step` |
| 合同回链 | [Spec](../../../../specs/lucy-20261107-empty-result-next-step-guidance-spec.md)；[证据审计](../../../../reviews/2026-11-13-empty-result-next-step-sc-evidence-audit.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-EMPTY-01（0 行 → next_step） | UAT-EMPTY-02（聚合 count=0 不得冒充空结果合同，仅作对照） |
