# MCP 升级兼容底线与全真用户旅程门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 发布取证 Spec／**v1.1** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-53**／REQ-030-074。编号在 P1 序列；**升级放行优先级＝P0 底线**（挡「可升级／可出包」宣称）。**不入** 0.30 核心分母，**不挡**「0.30 核心升级完成」宣称 |
| 台账号 | 无。挂现行 `0.30` 执行总账；编号避让 P1-52／REQ-030-073 |
| 阶段 | X_REL |
| 状态 | X_REL｜**v1.1。发布取证已收口（2026-11-22）**。SC-01–SC-25＋实现 CR PASS；四入口全真 PASS（[四入口](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md)；[candidate](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md)；[SC](../reviews/2026-11-22-p1-53-sc-evidence-audit.md)；[CR](../reviews/2026-11-22-p1-53-implementation-cr.md)；[收口](../reviews/2026-11-22-p1-53-xrel-closure-record.md)）。测试台 INDEX＝PASS。本条通过不表示各模块无问题，更不表示可上线 |
| 决策来源 | 2026-11-16 客户 WorkBuddy「会员收入」被 `source_ambiguity_gate` 高频阻断；委托人要求每次升级不得破坏既有 MCP 问数能力；2026-11-18 目标对齐与 T1–T10 定稿；同日批准收编独立题库 Spec（P1-54）并确认全真须配合 Lucy 配置资产包 |
| 错题与证据 | [表级歧义门闩死路](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；[主路径可用性优先](../governance/DEVELOPMENT.md)；技术问题 brief `inbox/20261118-mcp-upgrade-compatibility-technical-questions-for-cursor.md`（可删） |
| 实施主体 | `scripts/e2e/` 全真 Agent／MCP 执行器与版本化题库、`scripts/upgrade/` 与 `scripts/gates/` 升级接线、发布证据校验器、测试台。不得修改 KTX 源码 |
| 配套 Plan | [lucy-20261118-mcp-upgrade-compatibility-plan.md](../plans/lucy-20261118-mcp-upgrade-compatibility-plan.md) |
| 题库合同 | [P1-54 多场景题库 **v1.1／S5**](lucy-20261118-mcp-upgrade-question-bank-spec.md)（语义正本；终稿确权、开发已授权）；可执行实例 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml` |
| 测试台 | [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md) |
| 关联合同 | [P1-35 纯 MCP 逃生](lucy-20261116-source-ambiguity-mcp-escape-spec.md)、[P1-37 MCP 体验韧性](lucy-20261116-mcp-ux-resilience-spec.md)、[P1-13 发版性能基线](lucy-20261113-release-perf-baseline-gate-spec.md)、P1-52 升级可靠性（并行登记）、[真实用户 E2E](lucy-20261018-enterprise-security-and-real-e2e-spec.md)、[可问治理面](lucy-20261101-ops-evidence-askable-governance-spec.md) |
| 授权边界 | **终稿确权 ≠ 开发授权**。委托人 2026-11-22 已发「开工，落地执行」＝Plan Task 1+ 开发授权；Docker 重建／出包／生产升级仍另授；每 Wave 完成后 code review 再进入下一 Wave |

## 闭口层级

- 层级：发布取证
- 本条承诺：见 **「目标（Normative，防漂移）」**；健康检查、Pod Ready、`tools/list`、单测、Code Review 或「只直连 MCP 脚本冒充 Agent」均不得替代。
- 本条出口：SC-01–SC-25；三维判定全部 PASS，且分母完整（含 P1-54 业务＋Ops）；客户发布聚合器只接受匹配 digest／`questionBankDigest`／配置指纹／证据 kind 的明确 PASS。
- 不在本条出口：修改门闩、ACL、行权限或 KTX 行为；编写题库题目语义（归 P1-54）；修复被本题库发现的产品缺陷；客户生产升级或自动回滚；新增 WebUI；实现全部候选 Agent 适配器；承诺覆盖一切未来客户问题。
- 上线关系：本条通过不表示各模块无问题；未通过则不得描述为「可部署／可升级兼容」。

## 目标（Normative，防漂移）

> **委托人对齐句（2026-11-18，冻结）**：用**至少一个真实 Agent 客户端**，**真实调用 Lucy Public MCP** 跑**一批问数问题**，与**基准线对照**，产出「**敢不敢给用户部署／升级**」的决策依据。

### 不可收窄

1. **真实 Agent 分母**：每个场景至少 **一个** 真实 Agent 完成全部必做题；直连 MCP 只作对照，不得计入 Agent 分母。更多客户端仅补充，**报告不得外推到未测宿主**。
2. **真实 Lucy MCP**：Public MCP Proxy；禁止 `:7878`、mock 库、预置答案。
3. **一批问题＝全题库硬约束**：不得因总时长或模型费用删题／缩题；连续追问轮次、既定采样、每轮 120s 与 MCP 硬门仍有效。
4. **对照基准线**：通用对照 gold／上一候选；客户对照 PRE 私有基线（同 Token、快照 ID、参数、客户端／模型指纹）。无客户基线 → 升级入口 BLOCKED。
5. **三维全过才敢部署／升级**：`functionalCompatibility`、`serviceLatency`、`agentLatency` 各自 PASS；任一 FAIL／BLOCKED → 整体非 PASS。供应商延迟只可归因，**不得**把整体改成 PASS。

### 决策入口

| 决策问题 | 入口 | 最低证据 |
|---|---|---|
| 敢不敢**出包／给用户部署该候选**？ | `certifyCandidate` | ≥1 真实 Agent＋全题库＋MCP 对照；三维 PASS |
| 敢不敢**在该客户实例升级**？ | `certifyInstanceUpgrade` | 候选已 PASS **且** 既有私有基线＋POST 三维 PASS |
| 首次如何得到客户基线？ | `captureInstanceBaseline` | 旧实例全真批题成功 → 仓外私有基线；**不**要求历史文件已存在 |
| 回滚后业务是否恢复？ | `replayInstanceBaseline(ROLLBACK_VERIFY)` | **发生回滚时条件必做**；证明基线恢复 ≠ 该 digest 可出包 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **MCP 问数兼容基线**：升级前在指定实例上，既有身份经 Public MCP 成功完成的版本化查询及可比较结果、环境与耗时事实（含 snapshotId）。
- **真实用户旅程**：真实 Agent 自然语言 → Public MCP → Lucy → 真实库 → 最终答案；直连 MCP 不冒充。
- **三维判定**：`functionalCompatibility`／`serviceLatency`／`agentLatency`；整体 PASS 当且仅当三者皆 PASS。
- **DEGRADED_PROVIDER_LATENCY**：Agent 墙钟越线时的归因标签；**不是**放行例外。
- **Lucy 兼容配置资产包（CompatConfigProfile）**：与题库 digest 绑定的连接／语义／Role／权限／夹具配置集合及其指纹；缺匹配配置不得开跑全题库放行。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`

### What This Change Follows

- [ ] 不新增或改变 WebUI 页面、组件、路由、交互和视觉样式。
- [ ] 用户可见错误与术语只通过真实客户端自然产生；测试报告使用既有产品术语。

### Exceptions (If Any)

- 无。本条为测试、证据与发布门禁。

### Follow-up Needed

- 若后续把结果做成 WebUI 看板，须另立功能 Spec，不在本条夹带。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。
- 不改变：路由、页面、按钮、空态、错误态、确认面、浏览器交互。

## 1. 已核实现状与缺口

1. `scripts/uat/mcp-session-regression.mjs` 能真调 MCP，但不是版本化用户旅程门禁。
2. K8s／Compose 升级门禁止于 health／`tools/list`，不证明问数成交。
3. ESCAPE／ESC-11 有事故同形，尚非每次出包强制稳定门禁。
4. P1-13 管热路径性能，不含真实 LLM 墙钟；本条补充不改写 P1-13。
5. P1-52 管镜像／资源可靠性；本条管问数功能／权限／体验，互不替代。
6. 执行器／题库 YAML／配置资产包／双文件证据／verifier **尚未实现**（定稿 ≠ 已落地）。
7. 独立题库合同已开 [P1-54](lucy-20261118-mcp-upgrade-question-bank-spec.md)；本条 v1.1 收编其分母与配置前置。

## 2. 决策（Normative）

| ID | 决策 | 裁定 |
|---|---|---|
| D1 | 双层门禁 | 通用题库＋实例真实基线缺一不可；无基线／不可读／分母不足＝BLOCKED |
| D2 | 双执行面 | 每场景须真实 Agent 旅程；关键场景另有确定性 MCP 对照；直连脚本∉ Agent 分母 |
| D3 | 全真 | 真实 Agent、Public MCP、Lucy、真库、真 Role／Token；禁 mock／预置答案／绕过 ACL／`:7878`／CR 代替 |
| D4 | 客户身份 | 基线与 POST 同一既有只读 Token；不能复用＝BLOCKED，禁换高权凑绿 |
| D5 | 覆盖矩阵 | 独立问、过滤／时间／空结果、追问、单表、多表 join、单／多库、无权限与分权限＋合法对照，以及 **Lucy Ops W0／受控 W1／W2**（COMPAT-OPS-01–11）全部必做；题目语义以 P1-54 为准 |
| D6 | 事故看守两层 | Demo／通用＝ESC-11 同形；客户＝私有会员收入基线。证据包负控≠旧版 UAT PASS；当前候选须真实 Agent 全链路 |
| D7 | 结果判定 | 固定夹具 typed gold；客户比形状／非空／容差；快照未变却非空变空等＝FAIL；不可比＝BLOCKED |
| D8 | 安全负例 | 拒绝须成立且无越权／泄露；deny→allow＝FAIL；每项配合法对照 |
| D9 | 连续追问 | 同 Agent 会话＋同 Lucy 旅程；另开／改写成独立题不得 PASS |
| D10 | 多库 | 分连接查询再比；禁发明跨连接 join；非法混查须拒绝＋按连接拆分下一步 |
| D11 | MCP 绝对耗时 | 拒绝 P95≤500ms、P99≤2s；简单单表 P95≤5s；复杂多表／多库 P95≤30s。越线＝`serviceLatency` FAIL |
| D12 | 相对耗时 | MCP：P95 增幅>20% 且>50ms＝FAIL。Agent：≥3 次中位数增幅>20% 且>2s＝FAIL。均不得豁免 |
| D13 | 样本 | MCP／场景／版本 ≥20；Agent／场景／所选客户端／版本 ≥3；保留全部尝试 |
| D14 | 冷启动 | Ready 后首轮单列；MCP 受 D11；Agent 受 D16a；禁稳态顶替首轮 |
| D15 | 环境可比 | 同实例、快照 ID、Token／Role、连接、**同客户端与模型指纹**、题库、同级环境；否则 BLOCKED |
| D16 | 功能／权限无豁免 | 不接受 PASS WITH GAP、删题、跳过必做、调低功能／权限阈值放行 |
| D16a | Agent 墙钟严格底线 | **每轮** `turnWallClockMs`＞120s → `agentLatency=FAIL`。可写归因 `DEGRADED_PROVIDER_LATENCY`，**禁止**据此整体 PASS。MCP 对照绿不能挽救 Agent 墙钟 FAIL |
| D17 | 私有基线 | 仓外 0700／0600；不含 Token／Session／密码／业务行；公开只摘要 |
| D18 | 候选绑定 | runId、实例、gitSha、digest、`questionBankId`／version／digest、**configProfileFingerprint**、客户端／模型指纹、Token 指纹；只晋级被测 digest |
| D19 | 四函数接线 | `captureInstanceBaseline`／`certifyCandidate`／`certifyInstanceUpgrade`／`replayInstanceBaseline`；见 §4。失败不自动改生产 |
| D20 | 环境生命周期 | 门禁生命周期可按 Runbook 部署被测候选与 D21 夹具（digest 一致、用后还原）。每次实际构建／部署／生产升级仍须**独立授权**。禁 mock／错 digest 凑绿 |
| D21 | 双车道夹具 | 通用可合成夹具用后还原；客户禁伪造 PRE |
| D27 | Lucy 配置前置 | **全真开跑前**须应用与题库 digest 绑定的 CompatConfigProfile（连接、语义层、Role／表选择器／工具、行／字段权限、Ops 投影就绪声明）。指纹不匹配或缺包 → **BLOCKED**，不得删题凑绿。配置资产包合同正本在 P1-54；本条只强制消费 |
| D22 | 与 P1-13 | 不重复 `tools/list` 相对闸；本条管业务 query＋Agent 墙钟 |
| D23 | 全题库与 CI | **不设**总成本／总墙钟上限。必须记录实际总墙钟、分题耗时、模型调用／Token（能取则取）。**全题库完成且三维 PASS** 才可出包／升级放行。CI 子集仅反馈，**不得**单独 `releaseReady` |
| D24 | 三维判定 | 整体 PASS ⇔ `functionalCompatibility=PASS` ∧ `serviceLatency=PASS` ∧ `agentLatency=PASS` |
| D25 | Agent 选择 | 候选池见 Plan／`mcp-compat-clients.yaml`。每次运行检测环境后由用户单选（CI 预选）。PRE／POST 禁止换客户端／模型。无适配器／未装／未认证／无多轮＝改选或 BLOCKED；禁脚本冒充。新适配器另任务另授权 |
| D26 | 双证据文件 | 公开：`results/mcp-compatibility-candidate.json` 与 `results/mcp-compatibility-instance.json`。assembler 只登记路径＋字节 SHA256；verifier **重读重算**分母与摘要，不信 runner 顶层 `status`／`summary` |

## 3. 版本化题库与配置

| 层 | 正本 | 说明 |
|---|---|---|
| 题目语义 | [P1-54 Spec](lucy-20261118-mcp-upgrade-question-bank-spec.md) | 自然语言、oracle、身份、映射 COMPAT／COMPAT-OPS |
| 可执行实例 | `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`（实现阶段） | 与 P1-54 一一映射；本条只认声明的 `questionBankId`＋version＋digest |
| Lucy 配置 | P1-54 CompatConfigProfile | 连接／语义／Role／权限／夹具；`configProfileFingerprint` 进证据 |
| UAT 剧本 | 测试台 suite／cases | 不另造第二套题 |

| 场景族 | 必做内容 |
|---|---|
| 独立单表 | 简单指标；时间／过滤／分组；合法空；客户会员收入同形 |
| 连续追问 | 时间窗→分组→比较；上下文不得丢 |
| 单表到多表 | 已声明 join 扩展成交 |
| 多库 | 分连接查询与对比；非法跨连接拒绝（须配置层提供合法双连接编排，禁 `lucy_admin` 凑绿） |
| 权限 | 无工具／Source／表／行／字段＋合法对照 |
| Lucy Ops | W0 当前车道＋受控 W1／W2（COMPAT-OPS-01–11） |
| 生命周期 | capture／候选／POST／ROLLBACK_VERIFY 分列证据 |

## 4. 核心流程（伪代码）

```text
function captureInstanceBaseline(instance, suite, agentClient, tokenFile, privateBaselinePath):
  // 首次：不要求历史基线文件
  require agentClient.selected && agentClient.fingerprint
  run = executeFullSuite(instance, suite, agentClient, phase="CAPTURE")
  if run.threeAxis != all PASS: return FAIL_OR_BLOCKED(run)
  writePrivateBaseline(privateBaselinePath, redactSecrets(run), mode=0600, parent=0700)
  return CAPTURE_PASS

function certifyCandidate(newCandidate, suite, agentClient, configProfile):
  require suite.questionBankDigest == approvedQuestionBankDigest
  require configProfile.fingerprint == suite.requiredConfigFingerprint
  require applyCompatConfigProfile(configProfile).status == READY  // D27；否则 BLOCKED
  require agentClient.selected  // ≥1；报告不得外推未测宿主
  generic = executeGenericFullRealPack(newCandidate, suite, agentClient)
  verdicts = threeAxis(generic)  // functional, serviceLatency, agentLatency
  write results/mcp-compatibility-candidate.json  // kind=candidate
  return PASS iff verdicts all PASS && denominatorComplete(generic)

function certifyInstanceUpgrade(instance, newCandidate, suite, agentClient, privateBaselinePath):
  require fileExists(privateBaselinePath) else return BLOCKED(BASELINE_MISSING)
  baseline = readPrivateBaseline(privateBaselinePath)
  require baseline.snapshotId && sameFingerprint(agentClient, baseline)
  require certifyCandidateEvidence(newCandidate).status == PASS
  post = replaySameIdentityAndArgs(instance, newCandidate, baseline, agentClient, phase="POST")
  verdicts = threeAxisCompare(baseline, post)  // 含功能零回归 + D11/D12 + D16a
  write results/mcp-compatibility-instance.json  // kind=instance; phases.POST
  return PASS iff verdicts all PASS && denominatorComplete(post)

function replayInstanceBaseline(instance, restoredCandidate, suite, agentClient, privateBaselinePath, phase):
  // phase = ROLLBACK_VERIFY（发生回滚时条件必做）
  require phase == "ROLLBACK_VERIFY"
  require fileExists(privateBaselinePath)
  baseline = readPrivateBaseline(privateBaselinePath)
  require sameFingerprint(agentClient, baseline)
  // 业务恢复 ≠ 可出包：若需声称 restored 可发布，另需该 digest 的 certifyCandidate PASS
  result = replaySameIdentityAndArgs(instance, restoredCandidate, baseline, agentClient, phase)
  appendPhase(results/mcp-compatibility-instance.json, ROLLBACK_VERIFY, result)
  return threeAxisCompare(baseline, result)
```

### 多步状态机合同

- **捕获**：`CAPTURE_RUNNING` → `CAPTURE_PASS`｜`FAIL`｜`BLOCKED`。
- **出包**：`CANDIDATE_RUNNING` → `CANDIDATE_PASS`｜`FAIL`｜`BLOCKED`。
- **升级**：`BASELINE_MISSING`｜`POST_RUNNING` → `POST_PASS`｜`FAIL`｜`BLOCKED`（读取既有基线；不再于本函数内「边 capture 边 upgrade」）。
- **回滚**：若操作者执行回滚 → **条件必做** `ROLLBACK_VERIFY`；未跑不得宣称业务已恢复。
- 合法转移：无基线不得 upgrade；candidate 未 PASS 不得客户出包／不得把 upgrade PASS 当出包；rollback 恢复 ≠ restored digest 自动可发布。
- 终态：`PASS`／`FAIL`／`BLOCKED`（各入口独立）。
- 禁止单一布尔冒充终态；须三维＋分母＋身份。

## 5. 计时、成本记录与证据

| 字段 | 含义 |
|---|---|
| `turnWallClockMs` | Agent 端到端墙钟；＞120000 → agentLatency FAIL |
| `mcpClientRttMs[]` | 客户端 MCP RTT（含 attempt） |
| `serverDurationMs[]` | 服务端 `duration_ms` |
| `unattributedMs` | 墙钟减已观测；只称未归因 |
| `batchWallClockMs` | 本入口全题库实际总墙钟（记录，不作上限） |
| `modelCallCount`／`tokenUsage` | 客户端能提供时必记；不能提供则 `not_available` |
| `verdicts.functionalCompatibility` | PASS／FAIL／BLOCKED |
| `verdicts.serviceLatency` | PASS／FAIL／BLOCKED |
| `verdicts.agentLatency` | PASS／FAIL／BLOCKED；可附 `attribution=DEGRADED_PROVIDER_LATENCY` |
| `entrypoint`／`kind` | `candidate`｜`instance` |
| `clientFingerprint`／`modelFingerprint` | 所选 Agent／模型；禁止中途切换 |
| `samples` | 分位数、样本数、全部尝试指针 |

### 5.1 公开证据文件（D26）

**`results/mcp-compatibility-candidate.json`**

- `kind: "candidate"`
- `suiteDigest`、`candidateDigest`、`clientFingerprint`、`modelFingerprint`
- `denominator`、`verdicts`、`cases[]`、`batchWallClockMs`
- 无私有过滤值／Token／Session／业务行

**`results/mcp-compatibility-instance.json`**

- `kind: "instance"`
- `phases`: 可含 `POST`、`ROLLBACK_VERIFY`（有回滚时必有）
- `snapshotId`（公开可持有 ID，不含行数据）、`suiteDigest`、`candidateDigest`、指纹
- `verdicts`、`denominator`、与 baseline 对照摘要

私有基线仍在仓外；公开 JSON 只脱敏结果。verifier 重读文件、重算分母与摘要。

## 6. 发布与升级接线

1. **出包**：聚合器重验 `mcp-compatibility-candidate.json`；非 PASS／缺文件／摘要错 → `releaseReady=false`。
2. **升级**：重验 `mcp-compatibility-instance.json` 的 POST；且候选证据已 PASS。
3. **回滚**：有回滚动作则必须有 `ROLLBACK_VERIFY` 相位；仍不得把未过 `certifyCandidate` 的 restored digest 标成可发布。
4. **Compose／K8s**：接线消费上述文件；`--skip-mcp` 不产生可发布证据。
5. **CI 子集**：可跑判定器负例＋事故同形；**禁止**子集单独放行。

## 7. 验收（SC）

| ID | 标准 | 证据 |
|---|---|---|
| SC-01 | 题库 schema／稳定 ID／完整矩阵／`questionBankDigest` 可机检；与 P1-54 一一映射 | 题库契约 |
| SC-02 | ≥1 真实 Agent 完成必做分母；直连 MCP 不冒充；报告不外推未测宿主；客户端来自 `mcp-compat-clients.yaml` 检测／单选 | 全真 runs |
| SC-03–SC-08 | 业务矩阵与事故看守（含 ESC-11／客户基线分层） | COMPAT-01–09 |
| SC-03b | Lucy Ops W0／受控 W1／W2 分母完整（COMPAT-OPS-01–11）；扩展车道缺配置指纹不得删题 | P1-54＋OPS runs |
| SC-09 | PRE／POST（或 capture／POST）同 URL、Token、快照、**客户端／模型指纹**；缺基线 BLOCKED | 绑定测试 |
| SC-10 | 成功变 deny／空信封／非空变空等 FAIL；拒绝变 allow FAIL | 判定器＋全真 |
| SC-11 | 计时与 `batchWallClockMs`／模型用量字段完整；冷启动首轮单列 | COMPAT-10／11 |
| SC-12 | MCP 绝对预算硬拦；Agent 每轮＞120s → agentLatency FAIL；归因不得整体 PASS | 判定器 |
| SC-13 | 相对门禁与样本下限；缺基线不假绿 | 判定器 |
| SC-14 | 分层负控：证据包＝判定器；当前候选＝真实 Agent；旧实例可选；禁证据包冒充旧版 UAT PASS | 负控＋全真 |
| SC-15 | 身份／digest／指纹不匹配拒证；尝试全进分母 | 发布校验 |
| SC-16 | 聚合器分别消费 candidate／instance；缺／FAIL／BLOCKED／NOT RUN／篡改 → releaseReady=false | 契约测试 |
| SC-17 | K8s／Compose 接线；health／tools/list 不能单独放行；有回滚必有 ROLLBACK_VERIFY | 脚本契约 |
| SC-18 | 私有基线权限与泄露扫描 | 扫描 |
| SC-19 | D20／D21 环境与夹具；错 digest／mock 不得 PASS | 跑次 |
| SC-20 | 台账勾连与文档门禁 | lint |
| SC-21 | 入口互不冒充；CI 子集不得 release PASS | 反向测试 |
| SC-22 | 三维判定；`DEGRADED_PROVIDER_LATENCY` 不能变整体 PASS | 判定器负控 |
| SC-23 | `captureInstanceBaseline` 与 `certifyInstanceUpgrade` 分离；无历史文件仍可首次捕获 | 契约＋全真 |
| SC-24 | 双证据文件 schema；verifier 重读重算 | schema＋verifier 测试 |
| SC-25 | 开跑前 CompatConfigProfile 已应用且指纹匹配；缺包／错指纹＝BLOCKED；用后受控夹具须还原 | 配置门禁＋清理记录 |

## 8. 主路径可用性自检

| # | 问 | 答 |
|---|---|---|
| 1 | 合法用户原任务是否仍能完成？ | 要求基线成功任务在 POST 仍成交 |
| 2 | 新增拒绝是否有逃生？ | 本条不新增产品拒绝；安全负例须有下一步＋合法对照 |
| 3 | 是否同时验约束与成交？ | 是；三维共同构成分子 |
| 4 | 是否用 BLOCKED 掩盖不可用？ | 否；客户无基线阻止升级放行 |

## 9. 开放项与边界

- **原则均已闭合**（严格墙钟、受控环境、≥1 Agent、分层负控、全题库无总成本上限、题库正本归 P1-54、配置资产包前置）。
- 具体客户题目只在私有基线；仓库只存通用合成题与通用配置 profile 描述（无秘密）。
- 产品缺陷修复另开条目。
- 各 Agent 适配器 **不在本条出口默认已实现**；缺则改选或 BLOCKED。
- **发布取证已收口（X_REL）≠ 可上线**；测试台 INDEX＝PASS；本条通过不表示各模块无问题。

## 10. 变更记录

| 版本 | 内容 |
|---|---|
| v0.1-draft | 入池双层门禁与耗时门禁 |
| v0.2-draft | 审阅修订＋目标对齐句 |
| v1.0 | 终稿确权（暂不开发）：T1–T10 |
| **v1.1** | **终稿补丁**：收编 P1-54 为题库语义正本；分母含 COMPAT-OPS；`questionBankDigest`；**D27／SC-25 Lucy 配置资产包前置**；禁无配置开跑 |
