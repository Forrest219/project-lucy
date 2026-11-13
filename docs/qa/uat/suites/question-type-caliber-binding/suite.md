# UAT-SUITE-CALIBER-BINDING — 问题类型口径绑定

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CALIBER-BINDING` |
| 总账 ID | **P0-1**／REQ-030-027 |
| 目标 | 证明无 published 绑定时查数不误强制；有绑定时偏离被拦（后者需夹具） |
| 合同回链 | [Spec](../../../../specs/lucy-20261107-question-type-caliber-binding-spec.md)；[证据审计](../../../../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-CALIBER-01（零绑定不强制） | UAT-CALIBER-02（published 绑定偏离 → `caliber_binding_violation`；需内容根夹具） |
