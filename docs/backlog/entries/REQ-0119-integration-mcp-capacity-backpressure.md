# REQ-0119：系统间 MCP 查数容量保留、大明细背压与开发者水位

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池单条正文（一需一档）。**不是**功能 Spec，**不构成**开发授权 |
| 稳定 ID | `REQ-0119` |
| 类型 | `需求`（韧性／集成面） |
| 优先级 | `P1` |
| 阶段 | `S2`（Spec／Plan／UAT v1.0 终稿已确权 2026-11-27；**开发未授权**） |
| 目标版本 | `v0.35.0`（可调） |
| 授权边界 | **入池 ≠ 立项 ≠ 终稿确权 ≠ 开发授权**。进入开发前须：需求澄清 → 独立 Spec → 配对 Plan → 终稿确权 → 委托人另发开发授权 |

## 来源与背景

- 提出日期／来源：2026-11-27／委托人（xingchen）；用户希望以 Python／Java **系统间调用**拉数（非对话式 Agent），并担心大明细／高并发导致 MCP 阻塞、员工无法使用。
- 现状：无官方 Python／Java SDK；数据面为 MCP HTTP + Agent Bearer。P1-82 四层容量已落地，**SC-06 流式体积／内存背压未落地**（曾裁定下期）。
- 设计裁定：同进程方案——`integration` 可借槽 + interactive 保留槽 + 落地 SC-06 + 真实压测水位 + 开发者指引；**本轮不拆进程**；收口后隔离环境另做 B1 拆进程对照压测。

## 期望方向（非实现承诺）

- 系统集成方有可遵循的 MCP 接入与限流／大明细指引（Python／Java 示例，非官方 SDK）。
- 团队级（约 10–40）并发下测出安全水位并对外公布。
- 大处理量不得堵死 MCP：员工 interactive 主路径优先；integration 超额／超大体量快速失败可重试。
- 落地 P1-82 SC-06（流式字节上限与全局内存背压）。

## 非目标与边界

- 本轮不做 WebUI↔MCP 进程拆分、官方语言 SDK、REST 查数 API、零停机升级宣称。
- 入池与设计定稿不授权改运行代码。

## 关联

- Spec：[docs/specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md](../../specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md)
- Plan：[docs/plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md](../../plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md)
- UAT：[docs/qa/uat/suites/integration-mcp-capacity/suite.md](../../qa/uat/suites/integration-mcp-capacity/suite.md)
- 设计稿：[docs/design/design-2026-11-27-integration-mcp-capacity-backpressure.md](../../design/design-2026-11-27-integration-mcp-capacity-backpressure.md)
- 上游：[P1-82／REQ-030-103](../../specs/lucy-20261124-mcp-data-plane-isolation-ha-spec.md)（SC-06 改由本条验收）· [P1-78／REQ-030-099](../../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md)
- 跨 Spec 基线（2026-11-27 r4）：[REQ-0122](../../specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md)（P0 先落地；本条四层默认随其 D2 档 8/16/32/48，borrowMax 解耦初始 12，Task 0 后校准）
- 常青需求池：[docs/backlog/README.md](../README.md)
