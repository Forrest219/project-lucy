# MCP 升级兼容底线与全真用户旅程门禁 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让客户出包与升级只有在通用全真 Agent 题库和实例真实 MCP 基线均功能零回归、权限不放宽、绝对与相对耗时均达标时才可放行。

**Architecture:** 一份版本化 YAML 题库驱动真实 Agent 旅程与确定性 MCP 对照；PRE 私有基线在 POST 以同 Public URL、Token、参数和环境重放。独立判定器产生脱敏证据，现有 customer-release 单一校验器、K8s 与客户 Compose 升级入口共同失败关闭。产品运行时不在本条修改。

**Tech Stack:** Node.js 22、现有 `yaml` 依赖、Node `node:test`、现有真实 Agent adapters／E2E evidence、Bash（兼容 macOS bash 3.2）、现有 Docker／K8s 实例。无新增依赖。

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.2-draft / 2026-11-18 |
| 状态 | **v0.2-draft。与 Spec 同句：委托人 2026-11-18 批准审阅修订落入合同（D20 拆分、耗时分档、双入口、D21 夹具车道、D6 分层等）；终稿未确权、开发未授权。测试台 NOT RUN。未授权不改执行器、发布门禁与运行代码。≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md`](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) |
| 总账 | **P1-53**／REQ-030-074；升级放行＝P0 底线；**不入**核心分母 |
| 授权边界 | 当前只允许本批文档登记／审阅修订。实施须另获终稿确权＋开发授权；授权后仅可改本 Plan 白名单中的测试、脚本、CI、Runbook 与证据校验，不得修 `webui/server`／`webui/src` 产品行为或 KTX。git commit、生产升级、回滚与出包均须另行明确授权 |
| 验收 | Spec SC-01–SC-22；UAT 必做分母完整且 INDEX=PASS；缺匹配环境时全真项 BLOCKED，不得假绿 |

## 目标

1. 建立可机检、可版本化、不可删题凑绿的全真用户旅程题库。
2. 建立 PRE 捕获、POST 回放、功能／权限／耗时统一判定和脱敏证据。
3. 把结果接进唯一客户发布聚合器与 K8s／Compose 客户升级入口。
4. 用真实事故旧版或现有同形环境证明负控有判定力，而非只证明新脚本自身能返回 PASS。

## 开工前置

1. P1-53／REQ-030-074、Spec／Plan、UAT suite／cases／fixtures 已登记。
2. 委托人另发终稿确权与开发授权；本 Plan 的 Task 1 起才可实现。
3. **环境（对齐 Spec D20／D21）**：起草／无授权阶段可不重建 Docker，缺环境记 BLOCKED。获开发授权后，门禁生命周期**允许**按 Runbook 部署被测候选与通用车道合成夹具（用后还原）；禁止 mock 库、预置答案、错 digest 临时镜像凑绿。
4. 真实 Agent／模型／数据库／Token 仅从受保护环境和既有秘密文件路径读取；不得在命令行、报告或 Git 中写秘密。
5. 开始每一 Task 前检查 `git status`，只暂存本任务明确文件；当前工作区已有他人改动，不得覆盖、回滚或格式化无关文件。
6. CI 策略（D23）：变更触发跑判定器负例＋事故同形子集；客户出包／升级跑全量。子集不得单独放行。

## Task 0：合同与测试台登记（本轮仅文档）

**Files:**
- Create: `docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md`
- Create: `docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md`
- Create: `docs/qa/uat/suites/mcp-upgrade-compatibility/{suite,cases,fixtures}.md`
- Modify: SOT、需求池、UAT INDEX、e2e-ledger、文档索引与 UAT CONVENTIONS

**Steps:**
1. 核对 P1-52／REQ-030-073 已被客户镜像升级可靠性占用，新增 P1-53／REQ-030-074。
2. 将已批准架构、完整题库矩阵、绝对与相对阈值、私有基线和无豁免口径写入 Spec。
3. 建 UAT suite，INDEX 只写 NOT RUN，不预写 PASS。
4. 运行文档形态门禁并保留结果；未跟踪新文件 WARN 不得冒充全量零违规。

**Task 0b（2026-11-18，委托人批准审阅）**：升 **v0.2-draft**——落入 D20 拆分、D11／D16／D16a、双入口、D21、D6 分层、SC-14／21／22、独立 `mcp-compat-clients.yaml` 等；仍 **≠ 终稿确权 ≠ 开发授权**。

## Task 1：版本化题库与纯判定器

**Files:**
- Create: `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`
- Create: `scripts/e2e/lib/mcp-compatibility.mjs`
- Test: `scripts/e2e/__tests__/mcp-compatibility.test.mjs`
- Modify: `package.json`
- Modify: `scripts/gates/root-test-registry.json`（若根测试登记要求覆盖新测试）

**Step 1：先写失败测试**

```js
test("rejects a suite missing follow-up, permission or multi-connection cases");
test("rejects an empty required denominator and duplicate case ids");
test("new deny, empty envelope, nonempty-to-empty and missing metric are FAIL");
test("expected denial becoming allow is FAIL");
test("simple query p95 5001ms is FAIL even when faster than baseline");
test("MCP relative regression requires both >20% and >50ms");
test("agent relative regression uses median, requires both >20% and >2s");
test("agent wall-clock over 120s without D16a audit fields is FAIL");
test("D16a exception cannot mask functional or MCP budget FAIL");
test("fewer than 20 MCP or 3 agent samples is BLOCKED");
test("missing PRE baseline or snapshotId is BLOCKED, never baseline-seed PASS");
test("candidate, suite, token fingerprint or client/model mismatch is rejected");
test("certifyCandidate PASS alone does not satisfy certifyInstanceUpgrade");
```

Run: `node --test scripts/e2e/__tests__/mcp-compatibility.test.mjs`
Expected: FAIL，模块尚不存在。

**Step 2：写最小题库**

YAML 顶层冻结 `schemaVersion`、`suiteId`、`suiteDigest` 输入、`requiredClients`、`cases[]`。每题必须有 `interaction`、`topology`、`permission`、`turns[]`、`mcpControls[]`、`gold`、`samples`、`absoluteBudget`、`relativeMetric` 和 `evidence`。至少包含 COMPAT-01–12，不得用 tags 代替必需分母。

**Step 3：实现最小纯函数**

```js
loadJourneySuite(path)
validateJourneySuite(raw, clientsDoc)
nearestRank(values, percentile)
median(values)
evaluateFunctionalCase({ expectation, pre, post })
evaluateAbsoluteBudgets(caseResult, budget)
evaluateRelativeRegression({ metricClass, preSamples, postSamples })
aggregateCompatibility({ suite, pre, generic, post, identity })
```

不得在这里发网络请求、读 Token 或修改产品状态。所有错误使用稳定 reason code；任何未知状态失败关闭。

**Step 4：验证**

Run: `node --test scripts/e2e/__tests__/mcp-compatibility.test.mjs`
Expected: PASS，包含上述负例与边界恰好等于阈值。

**Step 5：未来提交（须另行授权 git commit）**

```bash
git add package.json scripts/e2e/contracts/mcp-upgrade-journeys.yaml \
  scripts/e2e/lib/mcp-compatibility.mjs scripts/e2e/__tests__/mcp-compatibility.test.mjs
# 仅经委托人明确授权后执行 git commit
```

## Task 2：真实 MCP 基线捕获与回放执行器

**Files:**
- Create: `scripts/e2e/run-mcp-compatibility.mjs`
- Create: `scripts/e2e/lib/mcp-compatibility-client.mjs`
- Test: `scripts/e2e/__tests__/run-mcp-compatibility.test.mjs`
- Reuse: `scripts/uat/mcp-session-regression.mjs` 的响应解析／指标提取思路
- Reuse: `scripts/e2e/security/context.mjs` 的真实 MCP 传输与脱敏模式

**Step 1：先写 CLI 与私有附件失败测试**

```text
missing token file -> exit 2 / BLOCKED
missing baseline on replay -> exit 2 / BLOCKED
public evidence contains token/session/filter literal/business row -> FAIL
private baseline mode is not 0600 or parent is not 0700 -> BLOCKED
HTTP 200 + result.isError=true -> query FAIL
source_ambiguity_gate on previously successful query -> FAIL
all attempts are emitted, including timeout and retry
```

Run: `node --test scripts/e2e/__tests__/run-mcp-compatibility.test.mjs`
Expected: FAIL。

**Step 2：实现 CLI**

```text
node scripts/e2e/run-mcp-compatibility.mjs capture \
  --run <run.json> --suite <yaml> --phase PRE \
  --mcp-url <public-url> --token-file <private-file> \
  --private-baseline <outside-git/baseline.json> --out <results/mcp-pre.json>

node scripts/e2e/run-mcp-compatibility.mjs replay \
  --run <run.json> --suite <yaml> --phase POST \
  --mcp-url <same-public-url> --token-file <same-private-file> \
  --private-baseline <same-file> --out <results/mcp-post.json>
```

实现真实 initialize／initialized／begin／tools/call、显式及无 Session 客户端形状、同会话轮次、请求 ID、RTT 与重试记录。不得提供 `--skip-query`、`--allow-new-deny` 或 `--accept-regression`。

**Step 3：接真实服务端审计**

按请求 ID 读取现有 release evidence／访问日志事实，补 `duration_ms`、decision reason、trace ID。远程不能读审计时该字段明确 `not_available`；需要审计才能证明的用例 BLOCKED，不能凭空填 0。

**Step 4：验证**

Run: `node --test scripts/e2e/__tests__/run-mcp-compatibility.test.mjs && npm run uat:mcp-session:test`
Expected: PASS。此步不调用 Docker 重建。

## Task 3：真实 Agent 用户旅程执行器

**Files:**
- Modify: `scripts/e2e/run-agent-journey.mjs`（仅增加可选用入口，默认行为不变）
- Modify: `scripts/e2e/adapters/claude-code.mjs`、`openclaw.mjs`（仅在 adapter 缺少同会话多轮接口时）
- Create: `scripts/e2e/lib/mcp-agent-journeys.mjs`
- Create: `docs/qa/mcp-compat-clients.yaml`（**独立** COMPAT client profile；不改全局 `real-e2e-clients.yaml` 必做分母）
- Test: `scripts/e2e/__tests__/mcp-agent-journeys.test.mjs`
- Modify: `docs/qa/manual-gui-e2e-checklist.md`（WorkBuddy／Cursor 人工全真步骤；COMPAT 专节）

**Step 1：先写失败测试**

- 连续追问必须使用同一 adapter session／Lucy turn，不允许每轮调用一次性独立 `-p` 后仍标 follow-up PASS。
- Agent 最终答案须绑定 typed gold 与至少一条本问真实 `lucy_query`；无查询的文字答案 FAIL。
- 每轮记录 wall clock；缺轮次不能 PASS。
- 每客户端每案例保留 3 次，失败尝试也在分母。
- 直连 HTTP 结果不得填入 `realClients` 分母。

Run: `node --test scripts/e2e/__tests__/mcp-agent-journeys.test.mjs`
Expected: FAIL。

**Step 2：实现同会话多轮最小能力**

优先复用 adapter 原生会话；若现有 CLI 只能一次性调用，则通过其受支持的 resume/session 参数续接并记录真实会话 ID 的脱敏摘要。没有同会话能力的客户端该场景 BLOCKED，不降级成独立问题。

**Step 3：接题库与计时**

每轮从题库读自然语言，不改写为更明确的问题；记录 Agent／模型实测版本、开始／结束、最终答案摘要、工具请求 ID、wall clock 与重试。服务端证据仍由现有 observer／audit 对账。

**Step 4：验证**

Run: `node --test scripts/e2e/__tests__/mcp-agent-journeys.test.mjs scripts/e2e/__tests__/j01-agent-evidence.test.mjs`
Expected: PASS。真实 Agent 全跑仅在现有匹配环境执行；缺环境写 BLOCKED，不重建 Docker。

## Task 4：唯一发布校验器失败关闭

**Files:**
- Modify: `scripts/e2e/lib/assemble.mjs`
- Modify: `scripts/e2e/verify-evidence.mjs`
- Modify: `scripts/e2e/contracts/release-evidence.schema.json`
- Modify: `scripts/gates/customer-release-readiness.mjs`
- Test: `scripts/gates/customer-release-readiness.test.mjs`
- Test: `scripts/e2e/__tests__/evidence-verifier.test.mjs`
- Modify: `.github/workflows/lucy-release.yml`

**Step 1：先写反向测试**

逐一构造：文件缺失、status=failed／blocked／not_run、必做题删除、三次尝试只留一次、suiteDigest 旧值、candidate digest 不同、手动改 summary、相对退化被备注接受、私有参数泄漏。全部必须 `releaseReady=false` 且退出非零。

Run: `npm run test:e2e-harness`
Expected: 新断言 FAIL。

**Step 2：装配并重验真实文件**

`loadResults` 增加 `mcpCompatibility`；assembler 只登记路径和字节 SHA256。`verifyRelease` 必须重新读取 `results/mcp-compatibility.json`、重算分母和摘要，并核对 runId、candidate、实例、客户端与所有 SC 判定，不信任 runner 的顶层 `status` 或 `summary`。

**Step 3：接 CI**

在 real-e2e 同一候选 digest 部署后、archive 前执行通用全真包与 PRE／POST 可用部分，写 `results/mcp-compatibility.json`。步骤不得 `continue-on-error`；`gate:customer-release` 仍是唯一发布裁决。

**Step 4：验证**

Run: `npm run test:e2e-harness && npm run test:ci-workflow-contracts`
Expected: PASS。

## Task 5：K8s 与客户 Compose 升级接线

**Files:**
- Modify: `scripts/gates/k8s-upgrade-gate.sh`
- Modify: `scripts/gates/k8s-acceptance.sh`
- Modify: `scripts/gates/k8s-release-gate.sh`
- Modify: `scripts/upgrade/upgrade-lucy.sh`
- Test: `scripts/gates/k8s-gate-negative.test.mjs`
- Test: `scripts/gates/customer-release-workflow.test.mjs`
- Test: `scripts/upgrade/upgrade-lucy.test.mjs`
- Modify: `deploy/k8s/helm/lucy/UPGRADE.md`
- Modify: `docs/runbooks/customer-v2-upgrade-release-checklist.md`

**Step 1：先写脚本契约负例**

- H3 在 health 后必须调用兼容回放，回放非零则 H3 非零。
- H4 rollback 不仅比较 imageID，还必须重放 PRE 基线。
- acceptance 即使 health／tools/list 成功，query FAIL 也非零。
- 客户 Compose 缺 baseline／token file 时在变更前 BLOCKED；健康检查后 POST FAIL 非零。
- 不新增可绕过开关；已有诊断 skip 不得产生 release PASS。
- Bash 不使用 `readarray`／`mapfile`／负数数组下标。

Run: `npm run test:k8s-gate-negative && npm run smoke:p0:upgrade-lucy:test`
Expected: 新断言 FAIL。

**Step 2：实现最小接线**

K8s 通过 `--mcp-baseline <private-file>`、`--token-file <private-file>` 与既有 `--public-mcp-url` 调用 Task 2／3 runner。客户 Compose 只有识别到 customer config／mode 时强制实例基线；开发 demo 不伪造客户 PRE。

**Step 3：失败处置**

测试脚本只返回非零与脱敏证据，不自动执行生产 `helm rollback`、不恢复卷、不重启 Docker。Runbook 指明由操作者按既有备份和回滚合同处理，回滚后再验。

**Step 4：静态与单元验证**

Run: `npm run test:k8s-gate-negative && npm run smoke:p0:upgrade-lucy:test && npm run test:ci-workflow-contracts`
Expected: PASS；不运行真实升级、不重建 Docker。

## Task 6：全真执行、事故负控与证据收口

**Files:**
- Create: `docs/qa/uat/suites/mcp-upgrade-compatibility/runs/YYYY-MM-DD-<agent>-<phase>.md`
- Create: `docs/reviews/2026-11-18-mcp-upgrade-compatibility-acceptance.md`（实际验收时）
- Modify: `docs/qa/uat/INDEX.md`
- Modify: `docs/governance/e2e-ledger.md`
- Modify: `docs/governance/test-layers-and-release-gates.md`
- Modify: SOT、需求池、Spec／Plan 与文档索引状态镜像

**Step 1：环境预检，不变更环境**

记录现有实例版本、镜像、Agent／模型、数据库快照、Role／Token 指纹与题库摘要。若不是目标 PRE／候选或缺真实客户端，立即把对应项记 BLOCKED；禁止为跑通而重建 Docker。

**Step 2：先跑事故负控（SC-14）**

主路径：用固定坏 digest／冻结失败证据包回放判定器，证明 COMPAT-09 能拦住事故。可选加强：若存在未修旧实例且暴露 MCP，再全真复验。无旧实例不得宣称「负控不可做」；禁止用 mock 答案代替证据包。

**Step 3：跑 PRE 与通用候选全真包**

执行所有必需客户端、题和次数。任何失败保留原证据并停止放行，不修改产品缺陷凑绿。

**Step 4：跑 POST／回滚后**

仅在实际候选升级／回滚由另行授权发生后执行。比较功能、权限、绝对与相对耗时，写公开脱敏证据。

**Step 5：全量验证**

```bash
node --test scripts/e2e/__tests__/mcp-compatibility.test.mjs \
  scripts/e2e/__tests__/run-mcp-compatibility.test.mjs \
  scripts/e2e/__tests__/mcp-agent-journeys.test.mjs
npm run test:e2e-harness
npm run test:ci-workflow-contracts
npm run test:k8s-gate-negative
npm run smoke:p0:upgrade-lucy:test
npm run lint:spec-docs
npm run lint:spec
npm run lint:terminology
npm run lint:ia-boundary
node scripts/uat/check-e2e-ledger.mjs
```

Expected: 实现与文档门禁 PASS；全真 UAT 只有实际必做分母全绿才将 INDEX 改 PASS，否则如实 FAIL／BLOCKED。

## 浏览器验证

不适用：本条明确验证真实 Agent 与 MCP，不改变 WebUI；WorkBuddy／Cursor GUI 是用户要求的真实 Agent 客户端，不是新增浏览器页面测试。

## 验收

- Spec SC-01–SC-22 逐项有可重跑证据；不得以单测替代全真 UAT，也不得以全真一次运行替代判定器负例。
- 客户出包聚合器能独立发现缺题、改摘要、改状态、错版本与耗时越线；并分别校验 `certifyCandidate`／`certifyInstanceUpgrade`。
- 通用包 PASS 才可出包；实例 PRE／POST PASS 才可升级验收；二者不得互相冒充；健康检查不能替代。
- 门禁生命周期可按 Runbook 部署被测候选与 D21 夹具；禁止 mock／错 digest 凑绿。

## 完成定义

1. 版本化题库、执行器、私有基线、公开证据、发布校验与 K8s／Compose 接线全部落地。
2. 必做真实客户端与完整矩阵在匹配现有环境中执行，INDEX 有真实判定；缺环境部分保持 BLOCKED，不宣称全部完成。
3. 文档与状态镜像同步；新增命令登记 `test-layers-and-release-gates.md` 与 CI Mapping。
4. `git status` 无本任务产生的临时日志、Token、私有基线或测试输出；不触碰他人既有改动。
5. 本条 PASS 不表示各模块无问题，也不自动授权出包或生产升级。

## 风险

| 风险 | 处理 |
|---|---|
| 真实 LLM 波动造成误报 | 同客户端／模型、3 次全保留、中位数＋20%＆2s 双门；服务端另用 20 样本确定性对照 |
| 客户动态数据导致结果不可比 | 固定快照做精确 gold；现场只比合同形状与非空性，不可比 BLOCKED，不放行 |
| 私有基线泄露过滤值 | 私有附件 Git／inbox／公共包外、0700／0600；公开只留摘要、计数、指标名与耗时 |
| Agent 为答对而绕过 MCP | 最终答案必须绑定本问真实 `lucy_query` 与服务端 trace；直连数据库无证据即 FAIL |
| 权限测试被可用性修复冲垮 | deny→allow、泄露与越权上游执行均零容错，并配合法成交对照 |
| 升级脚本失败后扩大生产影响 | 门禁不自动改生产；候选预演先拦截，现场失败走既有备份回滚 Runbook |
| 本地缺候选却想凑绿 | D20：授权后可部署被测候选；禁止错 digest／mock 凑绿；起草阶段缺环境 BLOCKED |
| Agent 墙钟抖动误杀出包 | D16a 有限例外＋MCP 对照仍须绿；禁止例外掩盖功能／权限失败 |
| 通用包无权限矩阵环境 | D21 合成夹具脚本化 seed／还原；与客户车道隔离 |
| 共享脏工作区误带他人改动 | 每 Task 只暂存白名单文件；不格式化、不回滚无关文件；实际 commit 另需授权 |
| 改全局 real-e2e 客户端分母 | Task 3 使用独立 `mcp-compat-clients.yaml` |
