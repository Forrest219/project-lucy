# UAT-SUITE-MCP-INQUIRY-PERF — MCP 问询端到端性能基准与持续门禁

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-MCP-INQUIRY-PERF` / v0.2-draft |
| 日期 | 2026-11-23 |
| 总账 / 需求 | **P1-78／REQ-030-099**；P0 核心体验／发布底线，独立门禁，不改变 0.30 既有核心分母 |
| 合同 | [Spec](../../../../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [Plan](../../../../plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md) |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 运行环境 | 本机隔离 Docker compose、真实 KTX／数据库、Public MCP、≥1 真实 Agent；全局规模档须先通过规模基线断言 |
| 当前判定 | **NOT RUN**。仅有设计，未获测试基建开发与真实跑次授权；不得写入 PASS。 |

## 目标

验证 Spec SC-01–SC-15：真实用户自然提问到正确完整答复可计时、可按场景复算、可与已接受基线比较，并能通过持续门禁发现绝对越线和相对回退。套件只测性能与证据，不实施或验收某个具体产品优化。

**题目与数据来源（不自制）**：自然问题语义与 oracle 写法引用 [P1-54 题库 Spec](../../../../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md)；≥20 轮长链取自 [P1-79 长追问题组](../../../../specs/lucy-20261123-long-followup-question-pack-spec.md)（独立题组包与独立 `packDigest`）；身份、凭据、Wiki／Skill／审计行与 50 路压测 profile 引用[全局规模基线](../../scale-baseline.md)（含 §1.1 MCP-PERF 与 `uat:scale-baseline:seed:access｜wiki-skills｜audit`）；表夹具引用 [P1-34](../../../../specs/lucy-20261115-large-schema-ingestion-spec.md)。本套件不得新增自然语言题目、造数脚本或第二套规模数字；owner 侧未提供时相关用例记 BLOCKED。

## 全真性与双测程

- **Agent lane**：真实宿主自然语言→Public MCP→Lucy→真实库→最终答复。禁止 mock、预置答案、`:7878`、直连脚本冒充 Agent、换高权 Token 或更换模型凑绿。
- **MCP lane**：确定性客户端完成建连、通知、工具列表、目录／发现、查询和续查，只作阶段对照，不计入 Agent 分母。
- 两条 lane 使用同一 P1-54 题目引用和 oracle；性能套件不复制第二套自然问题。
- 所有计划尝试均保留，包括错误、意外拒绝、空信封、超时、取消、崩溃、重试和缺失证据。快速错误不算性能成功。

## 选择器

| 选择器 | 必做范围 | 允许主张 |
|---|---|---|
| `pr` | R0／01–06／08–09 的 PR 子集；SIMPLE／FOLLOW／JOIN／DENIAL＋合法对照；MCP≥20、Agent≥3／场景 | 绝对上限与中位数；不得声称 Agent 正式 P95 或完整发布性能 PASS |
| `nightly` | R0／01–12、14／15，全性能场景、冷／热、20 路、`SOAK` 持续压力与 `LONG_FOLLOW` 长追问；MCP≥100、Agent≥20／场景 | 正式分位、趋势和相对判定；连续两次无人值守后才能证明持续运行 |
| `release` | R0／01–15，全性能场景、20／50 路、`SOAK`、`LONG_FOLLOW` 和全部负控；消费已接受基线 | 出包性能门禁；SEED_ONLY／FAIL／BLOCKED／NOT RUN 均不得放行 |
| `upgrade-pre/post` | 与 release 同场景、同身份、同环境、同题库、同客户端／模型，含 `SOAK` 与 `LONG_FOLLOW`；PRE→POST→必要时 ROLLBACK | 实例升级性能门禁；缺 PRE 或指纹漂移即 BLOCKED |
| `optimization-ab` | 同夹具、同测程、单变量改前／改后；R0／03–09／11–12 | 供其他优化 Spec 消费，不在本套件修改产品或提高预算 |

## 必做判定

`UAT-MIP-R0／01–15` 全部为发布取证必做项。PR 的选择器只裁减本次执行范围，不改变 release 分母；`SOAK` 与 `LONG_FOLLOW` 不在 PR 执行，但不得从正式分母删除。

- 任一产品错误、错误答复、意外拒绝、预算越线、相对回退、证据篡改或负控未检出＝**FAIL**。
- 缺真实宿主、样本、基线、可比指纹或必要观测＝**BLOCKED**；题库缺长链、基线未登记压测 profile 同样 BLOCKED。
- 首次有效基线尚未具名接受＝**SEED_ONLY**，不是 PASS。
- **长链只跑一次**：同一跑次内 `LONG_FOLLOW` 复用 `SOAK` 已产生的长链证据，不重复发起第二轮 ≥20 轮追问；跨 `runId` 的链单独计数、不与 `SOAK` 混算。
- 必做项不接受 PASS WITH GAP；INDEX 是唯一结果 SOT，Spec 状态不由此文件倒推。

## 证据与清理

每轮保存候选／环境／题库／配置／预算／客户端／模型指纹、逐次原始尝试、实际在途、阶段耗时、分位、基线差、负控和 verifier 复算结果。`SOAK` 另存窗口序号、到达模型参数、计划到达与终态一一对应关系；`LONG_FOLLOW` 另存链级与逐轮轨迹、`chainId／turnIndex／processId／hostSessionId`。公开证据必须脱敏；私有凭据和任何客户材料留在仓库外。

每轮结束后恢复延迟注入、缓存和权限夹具，删除专用 Token、容器、网络和卷。原始失败不得因后续成功或清理而删除。纯 MCP 套件不改变 WebUI，不强制浏览器测试；新增 WebUI 看板不在本套件范围。
