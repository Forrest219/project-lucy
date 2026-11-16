# UAT-SUITE-MCP-UX-RESILIENCE — MCP 握手、失败信息、会话恢复与快速失败

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-MCP-UX-RESILIENCE` |
| 总账 ID | **P1-37**／REQ-030-058（主合同）；伴生 P1-35（门闩钉选放行与拒绝载荷）、P1-36（阶段记录取证）、P1-21（`/api/livez` 门槛） |
| 目标 | 证明：MCP 客户端（含纯 MCP、定时任务）在握手、被拒（门控）与上游会话失效时得到**有界延迟与可操作的下一步**；**同时**合法用户主路径（单表、多表 join、纯 MCP、钉选后的合法查询）不退化。每个约束类用例都配一个「合法路径仍成交」的对照 |
| 合同回链 | Spec [`lucy-20261116-mcp-ux-resilience-spec.md`](../../../../specs/lucy-20261116-mcp-ux-resilience-spec.md)（P1-37）；P1-35 [Spec](../../../../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)；P1-36 [Spec](../../../../specs/lucy-20261116-trace-span-ledger-spec.md)；逃生套件 [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../source-ambiguity-mcp-escape/suite.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-MCPX-01、02、04、05、06、07、08、11、12 | 伴生（不入必做、不入本条出口）：UAT-MCPX-03（依赖 P1-36，落地前**不得标 PASS**）；**UAT-MCPX-09／10（U3b 持续失效短路）**：Spec O7 定稿决策已将 U3b 移出本条出口，夹具闭合前记 BLOCKED 并停表，**不阻塞本套件整体判定**，也不得用 mock 冒充；U3b 启动后升为必做 |

## 状态说明

- 本套件**先于实现登记**（2026-11-16）：INDEX＝**NOT RUN**。实现授权前不得写任何 PASS／FAIL 现值。
- 实现授权后第一步是**改前基线跑次**（Plan 步骤 1）：预期 UAT-MCPX-04／05／06／08 FAIL（未知工具名无清单且 `lucy_` 前缀工具先得 `invalid_arguments`、缺 `measures` 透传内部名、重复被拒无提示、404 不恢复）；UAT-MCPX-09／10 属 U3b 伴生、夹具未闭合记 BLOCKED，UAT-MCPX-01／02／07 记录基线值。基线 FAIL 是合法基线，不是缺陷。
- **夹具就绪门禁**：脚本、身份、造数、计数入口等夹具由 Plan 步骤 0 交付；任一夹具未 dry-run 通过时，依赖它的用例记 **NOT READY**，不得写基线结果或 PASS／FAIL 现值。
- 阈值（P50 ≤ 200 ms、P99 ≤ 2 s、重载 P99 ≤ 5 s、拒绝 P95 ≤ 500 ms；U3b 的 N=5／60 s／T=5 s）是 Spec 的**定稿值**（O1／O5 已闭合）；若日后改值，须同改用例期望并在 Spec changelog 记录。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改动握手、会话恢复、拒绝路径或错误文案 | UAT-MCPX-01／02／04／05／06／08／09／10；建议同跑 `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` 必做项（持续节奏，非本条出口） |
| 每个 `0.30` 候选构建 | UAT-MCPX 全套必做＋UAT-MCPX-11 |
| 策略或 skills 加载逻辑变更 | UAT-MCPX-02（重载并发握手） |

## 边界

- 本套件是**本机 demo Docker 全真**复现，**≠** 客户现场验证，**≠** 功能合同收口，**≠** 可上线。客户基线数字仅作参考，不当 demo 验收值。
- 会话失效（单次）、策略重载、大目录夹具必须在 demo 里**真实构造**（见 fixtures）；构造不出来（含持续失效，O7；U3b 已因此移出出口）须停表上报，**不得**用 mock 或单测替身冒充通过，除非委托人另行书面授权降级。
- 不得因为本套件的约束而在 demo 中关闭 ACL、门闩或鉴权；用例用 demo 内置账号与 Bearer 文件路径，不依赖 person／宿主 attestation。
- 告警接线（P0-7 冻结）不在本套件；只验 M1–M6 取数口径，M7–M9 不在本套件验收。
- 禁止用 vitest／CR／读代码冒充本套件 PASS。跑次不得写入 Bearer／密码明文。
