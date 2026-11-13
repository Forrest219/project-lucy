# UAT-SUITE-ACCESS-MAP — 访问关系图空桑基

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ACCESS-MAP` |
| 总账 ID | **P1-17**／REQ-030-038 |
| 目标 | 证明部署侧打开「访问关系图」时：无 confirmed 访问也不会变成「几乎空图」；闲置骨干可读；图例披露；confirmed-only 未放开；begin 后同会话触表可进入访问流带 |
| 合同回链 | [空桑基 Spec](../../../../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md)；[closure](../../../../reviews/2026-11-13-access-map-sankey-empty-fix-closure.md)；[错题本](../../../../lessons/2026-11-13-access-map-sankey-empty.md)；主 Spec [`webui/docs/187-access-relation-sankey-spec.md`](../../../../../webui/docs/187-access-relation-sankey-spec.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-ACCESS-MAP-01（空态骨干）、UAT-ACCESS-MAP-02（图例）、UAT-ACCESS-MAP-03（API confirmed-only） | UAT-ACCESS-MAP-04（begin 后触表 → usage 流带；需 MCP 同会话） |
