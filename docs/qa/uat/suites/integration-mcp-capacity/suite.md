# UAT-SUITE-INTEGRATION-MCP-CAP — 系统间 MCP 容量保留与大明细背压

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-INTEGRATION-MCP-CAP` / **v1.0-r4** |
| 日期 | 2026-11-27（r4＝REQ-0122 §10.3 同步：IMC-03 轻／重混合臂） |
| 总账 / 合同 | **REQ-0119** · [Spec](../../../../specs/lucy-20261127-integration-mcp-capacity-backpressure-spec.md) SC-01–SC-13 · [Plan](../../../../plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md) |
| 目标 | 证明 integration 不可侵占 interactive 保留槽；SC-06 流式背压阻止整包大明细拖死 MCP；混压下员工 interactive 小查询在预注册通过线下仍可用；开发者指引诚实（非官方 SDK） |
| 运行环境 | 本机隔离 Docker demo／scale＋真实 KTX／只读数据连接＋多 Agent 纯 MCP（interactive＋integration）＋`stability-sentinel`；**本轮无浏览器臂**（IMC-09=N/A） |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md) 为唯一结果事实源。当前 **NOT RUN**（Spec／Plan／套件已定稿；**开发未授权**、实现未落地；正式跑次须开发授权后执行。≠ 功能合同收口；≠ UAT PASS；≠ 可上线） |

## 来源与定位

承接设计稿与 Kimi 设计对抗 R1：系统间 Python／Java 调用可能拉大明细，与对话式问数争用同进程 MCP。本套件验证 REQ-0119 合同，不替代 P1-82 全套、不替代 P1-78 性能基线。

| 套件 | 分工 |
|---|---|
| `UAT-SUITE-MCP-DATA-PLANE-HA`（P1-82） | 四层容量与跨 Agent；SC-06／UAT-MCPHA-05 **改由本套件验收** |
| `UAT-SUITE-MCP-INQUIRY-PERF`（P1-78） | 问询性能基线；本套件只做容量／背压／混压可用性 |
| `UAT-SUITE-QUESTION-BUDGET` 等 | 预算语义（`interactive` 身份）；**`integration` 豁免与影子计数由本套件验收**（SC-07／OQ-3 修订）；容量拒绝不冒充预算耗尽仍在本套件 |
| `UAT-SUITE-BUDGET-ANALYST-UX`（REQ-0122） | 分析师 interactive 预算／元数据池；**IMC-03 轻／重混合臂**同时作为其 SC-03 跨 Spec 组合证据（元数据池不得绕过 `borrowMax`） |

## 全真性

- 真实 Lucy／KTX／DB／Agent Token；禁止桩上游、假并发计数、客户端截断冒充服务端 SC-06。
- integration 与 interactive 必须是**不同 Agent**；integration 显式 `workloadClass=integration`。
- 大响应必须真正超过服务端 per-response 上限；未命中记 `BLOCKED`。
- T4 必须等待 ≥ `CANCEL_HOLD_MS`＋5s 后再判回落。
- OQ-A3 通过线必须在跑前冻结（见 fixtures／Task 0），禁止事后改阈值。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-IMC-R0、01–11、13 | UAT-IMC-12（延长 soak）；拆进程对照（另场，不入判定） |

## 当前边界

- 单实例同进程；不证明进程拆分 HA。
- HEALTHCHECK 假红记录但不单独构成本套件 FAIL（Spec OQ-HEALTHCHECK）。
- INDEX：**NOT RUN**。
