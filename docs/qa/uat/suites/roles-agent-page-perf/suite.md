# UAT-SUITE-ROLES-AGENT-PERF — Roles／Agent 页性能体感

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ROLES-AGENT-PERF` |
| 总账 ID | **P1-13**／REQ-030-034 |
| 目标 | 客户场景复现：Roles 列表页可快速就绪；Agent 冷进页不预拉完整 Roles 权限预览；新建 Agent 弹窗打开后再拉 Roles；列表 API 单次批量（非 N× fresh preview 体感） |
| 合同回链 | [发版性能基线 Spec](../../../../specs/lucy-20261113-release-perf-baseline-gate-spec.md)；[Plan](../../../../plans/lucy-20261113-release-perf-baseline-gate-plan.md)；[acceptance](../../../../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md)；扩展 Spec 174 [`webui/docs/174-webui-entry-performance-spec.md`](../../../../../webui/docs/174-webui-entry-performance-spec.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-PERF-ROLES-01、UAT-PERF-AGENT-01、UAT-PERF-AGENT-02、UAT-PERF-ROLES-02 | UAT-PERF-BASELINE-01（`perf:release-baseline` release-medium／ci-small；发布取证轨，不代替浏览器体感） |

## 边界

- 本套件主张 **客户场景体感／网络行为** UAT，**≠** 发布取证整包通过，**≠** 可上线。  
- 禁止用 vitest／Code Review 冒充本套件 PASS。  
- 绝对墙钟受 demo 夹具规模影响；以「可交互就绪 + 网络合同」为主闸，数字作证据摘录。
