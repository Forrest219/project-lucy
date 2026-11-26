# REQ-0119 系统间 MCP 容量／背压 · 过程对抗评审归档

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-27 |
| 工作项 | REQ-0119 |
| 评审器 | Kimi Code（过程对抗；**非** Codex CLI 终审） |
| 对象 | 设计 → Spec／Plan／UAT |
| 结论 | 设计 R1 **BLOCK**（已吸收进 Spec）；Plan／UAT R1 **BLOCK** → 处置后 R2 **PASS WITH FIXES**（N-01～N-05 已吸收为 v1.0-r2） |
| 授权边界 | **≠ 开发授权**；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |

## 1. 轮次索引

| 轮 | 对象 | 产物 | 结论 |
|---|---|---|---|
| 设计 R1 | 设计稿 v1.0 | [`inbox/20261127-req-0119-adversarial-r1.md`](../../inbox/20261127-req-0119-adversarial-r1.md) | BLOCK（B-01～B-06） |
| Plan／UAT R1 | Plan＋UAT v1.0 | [`inbox/20261127-req-0119-plan-uat-adversarial-r1.md`](../../inbox/20261127-req-0119-plan-uat-adversarial-r1.md) | BLOCK（B-07／B-08） |
| Plan／UAT R2 | 修订后 v1.0-r1 | [`inbox/20261127-req-0119-plan-uat-adversarial-r2.md`](../../inbox/20261127-req-0119-plan-uat-adversarial-r2.md) | PASS WITH FIXES |
| （未开 R3） | — | — | R2 无新阻断；nits 已吸收，按「最多三轮」收束定稿 |

## 2. 定稿指针

- Spec：[`docs/specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md`](../specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md) **v1.0-r2**
- Plan：[`docs/plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md`](../plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md) **v1.0-r2**
- UAT：[`docs/qa/uat/suites/integration-mcp-capacity/`](../qa/uat/suites/integration-mcp-capacity/) **v1.0-r2**

## 3. 关键裁定摘要

- SC-06 由 REQ-0119 实现（覆盖 P1-82 移下期划分）
- OQ-global：出厂维持 `global=24`；SC-08 时延分母防假绿
- SC-06 覆盖 `pipeResponse`／passthrough／skills（禁止无界 pipe 合规）
- 本轮无 WebUI `workloadClass` 枚举（IMC-09=N/A）

## 4. 声明

本归档不构成开发授权。实现须委托人另行明示开发授权后方可改 `webui/server/**`。
