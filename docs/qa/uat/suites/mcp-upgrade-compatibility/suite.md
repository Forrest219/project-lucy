# UAT-SUITE-MCP-UPGRADE-COMPATIBILITY — MCP 升级兼容底线与全真用户旅程

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` |
| 总账 ID | **P1-53**／REQ-030-074（升级放行＝P0 底线；不入核心分母）；**P1-54**／REQ-030-075（独立多场景题库） |
| 目标 | **与 Spec 目标同句**：≥1 真实 Agent 经 Lucy Public MCP 跑**全题库**、对照基线；三维（功能／MCP 服务耗时／Agent 墙钟）全过 → 敢不敢部署／升级 |
| 合同回链 | [门禁 Spec **v1.1**](../../../../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)；[独立题库 Spec **v1.1／S5**](../../../../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md)；[门禁 Plan](../../../../plans/lucy-20261118-mcp-upgrade-compatibility-plan.md)；[题库 Plan v1.1／S5](../../../../plans/lucy-20261118-mcp-upgrade-question-bank-plan.md)；[事故错题](../../../../lessons/2026-11-16-source-ambiguity-gate-deadlock.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 全真性

真实 Agent 自然语言 → Public MCP → Lucy → 真库 → 最终答案；直连 MCP 仅对照。禁 mock／预置答案／绕过 ACL／`:7878`／健康检查或 CR 代替。

**入口**：`captureInstanceBaseline`（首次）／`certifyCandidate`（出包）／`certifyInstanceUpgrade`（升级）／`replayInstanceBaseline`（有回滚时条件必做 `ROLLBACK_VERIFY`）。互不冒充 PASS。回滚恢复 ≠ restored digest 可出包。

**环境（D20／D21／D27）**：门禁生命周期可按 Runbook 部署被测候选与通用合成夹具（用后还原）；每次构建／部署／生产升级仍须独立授权。禁错 digest／mock 凑绿。缺匹配环境记 `BLOCKED`。

**Lucy 配置前置（CompatConfigProfile）**：全真开跑前必须应用与题库 digest 绑定的连接／语义／Role／权限／Ops 投影配置并核对 fingerprint；**有题无配置＝不具备落地条件 → BLOCKED**，不得删题。配置合同在 P1-54 §0／§3；门禁强制在 P1-53 D27／SC-25。

**Agent（D25）**：`mcp-compat-clients.yaml` 为候选池；每次检测后单选 ≥1；PRE／POST 同指纹；报告不外推未测宿主。

## 必做／可选

| Lane | 必做 | 可选 |
|---|---|---|
| 通用候选（`certifyCandidate`） | R0、01–12＋COMPAT-OPS-01–11；所选真实 Agent 全题库；COMPAT-09 Demo（ESC-11）；Ops 当前 W0＋受控 W1／W2 | 更多客户端仅补充 |
| 客户捕获（`captureInstanceBaseline`） | 首次全真批题 → 仓外私有基线 | — |
| 客户升级（`certifyInstanceUpgrade`） | 既有基线＋POST 全题库＋09 客户层；同 Token／快照／指纹 | — |
| 回滚 | 发生回滚时 `ROLLBACK_VERIFY` 条件必做 | — |

功能／权限／三维：**不接受** `PASS WITH GAP`。Agent 墙钟＞120s／轮 → `agentLatency` FAIL；`DEGRADED_PROVIDER_LATENCY` **不得**整体 PASS。无总成本上限；必须跑完全题库并记录实际总墙钟／模型用量。

## 样本与耗时

- MCP：≥20／场景／版本；P95 绝对预算硬拦；相对＞20% 且＞50ms＝FAIL。
- Agent：所选客户端 ≥3／场景／版本；中位数相对＞20% 且＞2s＝FAIL；每轮＞120s＝FAIL。
- 缺基线／快照／指纹不可比 → BLOCKED。

## 私有基线与公开证据

私有基线仓外 0700／0600。公开：`results/mcp-compatibility-candidate.json` 与 `results/mcp-compatibility-instance.json`（实现后）；runs 只摘要。verifier 重读重算。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 日常变更 | 判定器负例＋事故同形子集（**不得**单独 release） |
| 出包 | `certifyCandidate` 全题库 |
| 首次客户 | `captureInstanceBaseline` |
| 升级 | `certifyInstanceUpgrade` POST 全题库 |
| 回滚后 | `ROLLBACK_VERIFY` |

## 当前判定

**NOT RUN（INDEX）；最近跑次 Wave D candidate 判定 FAIL**。门禁 Spec **v1.1**；题库 Spec／Plan **v1.0**；**开发已授权（2026-11-22）**；实现进行中。Wave D 全真 candidate（[2026-11-22-cursor-wave-d-candidate](runs/2026-11-22-cursor-wave-d-candidate.md)）总判定 FAIL：functionalCompatibility FAIL（QB-JOIN-01 chasm；QB-ACL-03b-gate unproven 漂移；另有 `allow → new deny` 待查）；agentLatency FAIL（`DEGRADED_PROVIDER_LATENCY`；kimi-code-cli 8 路并行中位约 127s，超 120s 线）。INDEX 判定保持 NOT RUN；不得写入通过判定。≠ 可上线。
