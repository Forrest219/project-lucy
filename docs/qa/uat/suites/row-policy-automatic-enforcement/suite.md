# UAT-SUITE-ROW-POLICY-AUTO

| 项目 | 内容 |
|---|---|
| 版本 / 日期 | v1.0 / 2026-11-20 |
| 总账 / REQ | P1-72／REQ-030-093 |
| 关联 | [Spec](../../../../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) · [Plan](../../../../plans/lucy-20261120-row-policy-automatic-enforcement-plan.md) |
| 状态 | PASS；仅本条默认自动强制执行合同；既有扩展回归缺口单列；≠ 可上线 |
| 用例 / 夹具 | [cases](cases.md) · [fixtures](fixtures.md) |
| 最近跑次 | [2026-11-20-codex-default-row-policy](runs/2026-11-20-codex-default-row-policy.md) |

本套件只验取消人工开关后的强制隔离合同；不替代 P1-28 多人业务场景既有 FAIL。纯 MCP 需合法成交＋旁路拒绝双覆盖。
