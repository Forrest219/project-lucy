# UAT-SUITE-FIELD-EXPOSURE — Source 字段暴露裁剪

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-FIELD-EXPOSURE` |
| 总账 ID | **P0-A**／REQ-030-012 |
| 目标 | 证明未配置暴露台账时行为不变；配置后未暴露列 fail-closed（后者需夹具） |
| 合同回链 | [Spec](../../../../specs/lucy-20261107-semantic-source-field-exposure-spec.md)；[证据审计](../../../../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-EXPOSURE-01（未配置全暴露基线） | UAT-EXPOSURE-02（点名未暴露列 → `field_not_exposed`；需台账夹具） |
