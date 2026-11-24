# UAT-SUITE-CONN-RELOAD — 连接写后执行层热重载

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CONN-RELOAD` |
| 总账 ID | **P1-15**／REQ-030-036 |
| 目标 | 证明新建／编辑连接后，在有 supervisor 的 demo Docker 里执行层自动（或经同协议手动）重载，新连接对 MCP／问数可见；**无需** `docker restart` |
| 合同回链 | Spec 191；[连接热重载 Plan](../../../../plans/lucy-20261112-connection-create-execution-runtime-reload-plan.md)；[B 轨 live](../../../../plans/lucy-20261113-connection-reload-live-e2e-uat-plan.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、VERIFY-191-C01、E2E-CON-07、E2E-MCP-02、UAT-CONN-RELOAD-01 | UAT-CONN-EDIT-01、UAT-CONN-RELOAD-02 |
