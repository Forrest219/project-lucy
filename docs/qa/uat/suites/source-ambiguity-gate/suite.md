# UAT-SUITE-SOURCE-AMBIGUITY — 表级歧义门闩

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SOURCE-AMBIGUITY` |
| 总账 ID | **P0-3**／REQ-030-024 |
| 目标 | 证明多表业务词未确认时，`lucy_query`／`lucy_explain_query` 返回 `source_ambiguity_gate` 且不静默成交 |
| 合同回链 | [Spec](../../../../specs/lucy-20261107-source-ambiguity-gate-spec.md)；[证据审计](../../../../reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-SAG-01（多表词 deny） | UAT-SAG-02（宿主 attested 确认后放行；需 person token + `x-lucy-host-attestation`） |
