# MCP 升级兼容底线与全真用户旅程门禁 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 ≥1 真实 Agent 调用 Lucy Public MCP，跑**全题库**并对照基线，给出「敢不敢部署／升级」的三维证据（功能／MCP 服务耗时／Agent 墙钟）。出包＝`certifyCandidate`；升级＝`certifyInstanceUpgrade`（先有 `captureInstanceBaseline`）；回滚后＝条件必做 `ROLLBACK_VERIFY`。Agent 每轮＞120s＝`agentLatency` FAIL（归因不得整体 PASS）。

**Architecture:** 版本化 YAML 题库驱动 Agent 旅程＋MCP 对照；双公开证据文件由 assembler 只登记路径／SHA256，verifier 重读重算。`mcp-compat-clients.yaml` 为候选池；每次运行检测后单选，PRE／POST 禁止换指纹。产品运行时不在本条修改。

**Tech Stack:** Node.js 22、现有 `yaml`、`node:test`、既有 Agent adapters／E2E evidence、Bash 3.2、现有 Docker／K8s。无新增依赖。

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v1.1** / 2026-11-18 |
| 状态 | S3｜**v1.1。终稿补丁（收编 P1-54 题库正本／Ops 分母／CompatConfigProfile 前置 D27）。开发已授权（委托人 2026-11-22「开工，落地执行」；每 Wave 后 code review）。实现进行中（Wave 0）。测试台 NOT RUN。≠ UAT PASS；≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md`](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) |
| 总账 | **P1-53**／REQ-030-074；升级放行＝P0 底线；**不入**核心分母 |
| 授权边界 | **终稿确权 ≠ 开发授权**。委托人 2026-11-22 已授权 Task 1+。白名单：判定器／执行器／证据校验／CI／Runbook。**题库 YAML 内容与 CompatConfigProfile 应用／还原脚本归 P1-54**；本条只 Consume／Validate／调用。不得修 `webui/server`／`webui/src` 或 KTX。git commit、Docker 重建、生产升级／回滚／出包另授权；每 Wave 完成后 code review 再进入下一 Wave |
| 验收 | Spec SC-01–SC-25；UAT 必做分母完整且 INDEX=PASS；缺匹配环境或 **缺 CompatConfigProfile 指纹**＝BLOCKED，不得假绿 |

## 目标

0. 与 Spec 目标同句：≥1 真实 Agent＋全题库＋基线对照 → 三维全过才敢部署／升级。
1. 消费 P1-54 题库 digest＋**CompatConfigProfile 指纹**（有题无配置＝BLOCKED）。
2. 四函数＋双证据＋分层负控；CI 子集不得单独放行。

## 开工前置

1. Spec／Plan **v1.1 终稿补丁**与 P1-54 题库合同已落盘。
2. **开发授权**已发（委托人 2026-11-22）；可执行 Task 1+；每 Wave 后 code review。
3. 环境：对齐 D20／D21／D27；构建／部署／生产升级另授权。
4. 秘密只从受保护路径读。
5. 每 Task 检查 `git status`；不覆盖他人改动。
6. D23：不设总成本上限；全题库＋三维 PASS 才可放行。

## Task 0：合同与测试台登记（文档；已完成至 v1.1）

**Done:** 入池→v1.0 定稿→**v1.1 收编 P1-54／D27 配置前置**。INDEX=NOT RUN。**开发授权已于 2026-11-22 发出**（历史 Task 0 完成时尚未授权）。

## Task 1：题库加载与纯判定器（须开发授权）

**Files:**
- Consume: `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`（**内容由 P1-54 Create**）
- Create: `scripts/e2e/lib/mcp-compatibility.mjs`（load／validate／digest／threeAxis／aggregate）
- Test: `scripts/e2e/__tests__/mcp-compatibility.test.mjs`
- Modify: `package.json`；必要时 `scripts/gates/root-test-registry.json`
- Depend: P1-54 CompatConfigProfile 应用／还原脚本（本条只调用）

**Step 1：先写失败测试（含负例）**

```js
test("rejects a suite missing follow-up, permission or multi-connection cases");
test("rejects empty denominator and duplicate case ids");
test("missing requiredConfigFingerprint => BLOCKED");
test("new deny, empty envelope, nonempty-to-empty, missing metric => FAIL");
test("expected denial becoming allow => FAIL");
test("simple query p95 5001ms => serviceLatency FAIL even if faster than baseline");
test("MCP relative needs both >20% and >50ms");
test("agent relative uses median; both >20% and >2s");
test("agent wall-clock >120s => agentLatency FAIL");
test("DEGRADED_PROVIDER_LATENCY cannot make overall PASS");
test("overall PASS requires threeAxis all PASS");
test("fewer than 20 MCP or 3 agent samples => BLOCKED");
test("missing baseline/snapshotId on instance lane => BLOCKED");
test("client/model fingerprint mismatch => rejected");
test("certifyCandidate PASS alone does not satisfy instance upgrade");
test("captureInstanceBaseline does not require prior baseline file");
test("evidence-pack neg-control is not old-version UAT PASS");
test("batchWallClockMs recorded; no total cost ceiling gate");
```

Run: `node --test scripts/e2e/__tests__/mcp-compatibility.test.mjs` → 期望 FAIL（模块不存在）。

**Step 2–4:** `loadJourneySuite`／`validateJourneySuite`／digest／`threeAxis`／`aggregateCompatibility`；**不**手写第二套题面；无网络／无 Token；验证 PASS。

## Task 2：基线捕获与回放执行器（须开发授权）

**Files:**
- Create: `scripts/e2e/run-mcp-compatibility.mjs`、`lib/mcp-compatibility-client.mjs`
- Call: P1-54 `applyCompatConfigProfile`／restore（开跑前／结束后）
- Test: `scripts/e2e/__tests__/run-mcp-compatibility.test.mjs`

**CLI（四入口）:**

```text
capture   → captureInstanceBaseline → private baseline 0600
candidate → certifyCandidate        → results/mcp-compatibility-candidate.json
upgrade   → certifyInstanceUpgrade  → results/mcp-compatibility-instance.json (POST)
rollback  → replayInstanceBaseline  → append ROLLBACK_VERIFY（条件必做）
```

负例：缺 token／缺基线（upgrade）／公开证据泄密／权限非 0600／`isError`／事故 gate／尝试不全。禁 `--skip-query`／`--allow-new-deny`／`--accept-regression`。

## Task 3：真实 Agent 旅程＋客户端选择（须开发授权）

**Files:**
- Create: `docs/qa/mcp-compat-clients.yaml`（候选池；非「全部必跑」）
- Create: `scripts/e2e/lib/mcp-agent-journeys.mjs`；必要时改 adapters 多轮
- Test: `scripts/e2e/__tests__/mcp-agent-journeys.test.mjs`
- Modify: `docs/qa/manual-gui-e2e-checklist.md`（COMPAT 专节）

**客户端合同（D25）:**
1. YAML 列候选：`id`、检测命令、adapter、多轮能力、认证提示。
2. 运行时检测 → 用户单选（CI 可预选）；写 `clientFingerprint`／`modelFingerprint`。
3. PRE／POST／capture 全程同一指纹；切换＝BLOCKED。
4. 无适配器／未装／未认证／无多轮＝改选或 BLOCKED；禁脚本冒充 Agent 分母。
5. 报告不得外推未测宿主。

## Task 4：双证据文件＋发布校验失败关闭（须开发授权）

**Files:** assemble／verify-evidence／schema／customer-release-readiness／workflow／相关测试

**合同（D26／T1）:**
- 公开：`results/mcp-compatibility-candidate.json`（`kind=candidate`）与 `results/mcp-compatibility-instance.json`（`kind=instance`）。
- assembler 只登记路径＋字节 SHA256。
- verifier **重读重算**分母、三维 verdict、摘要；不信 runner 顶层 `status`／`summary`。
- 聚合器分别消费两文件；CI 子集不得 `releaseReady=true`。

负例：缺文件、FAIL／BLOCKED／NOT RUN、删题、只留一次尝试、旧 digest、改 summary、相对退化备注接受、泄漏、三维缺一、用 attribution 冒充 PASS。

## Task 5：K8s／Compose 接线（须开发授权）

接线 Task 2／3；H3 后 POST；有回滚则 H4 必 `ROLLBACK_VERIFY`；acceptance 在 tools/list 后回放；Compose 客户路径强制基线。脚本不自动生产 rollback。Bash 3.2 兼容。

## Task 6：全真、分层负控与收口（须开发授权＋环境授权）

1. 环境预检；构建／部署另授权。
2. **分层负控（T8）:** 证据包回放判定器（≠ 旧版 UAT PASS）；当前候选真实 Agent 全链路；旧实例可选。
3. capture／candidate／POST／（条件）ROLLBACK_VERIFY。
4. 全量单测＋文档 lint；INDEX 仅在必做分母全绿时改 PASS。

## 浏览器验证

不适用：本条验证真实 Agent 与 MCP，不改变 WebUI；WorkBuddy／Cursor 是真实 Agent 客户端，不是新增浏览器页面测试。

## 验收

- SC-01–SC-24 有可重跑证据。
- 三维全过；全题库；双文件；四函数；分层负控；子集不放行。
- 本条 PASS ≠ 各模块无问题 ≠ 自动出包／升级。

## 完成定义

1. 题库、执行器、私有基线、双证据、校验与接线落地（仅在开发授权后）。
2. ≥1 真实 Agent 在匹配环境跑完必做分母；缺环境 BLOCKED。
3. 状态镜像同步；命令进 test-layers／CI Mapping。
4. 无 Token／私有基线进仓；不碰他人改动。

## 风险

| 风险 | 处理 |
|---|---|
| LLM 波动 | 同指纹、3 次全保留、中位数双门；MCP 20 样本对照 |
| 动态数据不可比 | 快照 ID；不可比 BLOCKED |
| 私有基线泄露 | 仓外 0700／0600；公开只摘要 |
| Agent 绕过 MCP | 答案绑定真实 `lucy_query`＋trace |
| 墙钟误杀 | **不豁免**；记归因；MCP 绿不能救 Agent FAIL |
| 成本压力删题 | D23 禁止；只记录实际成本 |
| 改全局 real-e2e 分母 | 独立 `mcp-compat-clients.yaml` |
| 未授权开工 | 本 Plan Task 1+ 默认禁止 |
