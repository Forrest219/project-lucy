# Lucy E2E 功能试跑优化 Implementation Plan

> **For agentic workers:** 选择器、判定和 `--list` 已落地。去掉 `--list` 的试跑须另行要求。提交须用户另行要求。

| 元数据 | 内容 |
|---|---|
| 状态 | **功能合同已收口（2026-11-02）**。SC-01–SC-13 已由单测与 `e2e:product --list` 取证。八阶段试跑未执行。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261102-e2e-independent-trial-scaffold-spec.md`](../specs/lucy-20261102-e2e-independent-trial-scaffold-spec.md) v0.4 |
| 授权边界 | 定稿前不改运行代码，不新增 npm script，不试跑。定稿后只改本 Plan 点名的选择器、J01-07 证据读取、管理腿参数、结果选择记录、对应单测，以及 SOP / 测试门禁文档里的命令登记。不改覆盖清单分母、冻结 catalog / lock、`J01_STAGE_CONTRACT`、客户发布门禁，不把 protocol 分支改写成点击旅程 |
| 验收 | Spec SC-01–SC-13。单测与 `e2e:product --list` 已取证。八阶段试跑未执行 |

**Goal:** 一次试跑只启动主干或一个分支，并且主干 J01-07 的三条反作弊判定读的是本次 Agent 原文。

**Architecture:** 选择器持有 Spec §2.1 的文件表和 evidenceLayer。管理腿只把浏览器目标的文件交给 Playwright。J01-07 从 `results/j01-agent.json` 取 prompt、transcript、最终答案和工具调用。`selection.json` 把未选中项挡在本次失败判定之外。

**Tech Stack:** Node.js 单测（`node --test`）、现有 `j01-state.mjs` 断言、现有 Playwright real / upgrade 配置。

## Global Constraints

- 一次调用只有一个 target：`mainline`、`CONN`、`SEM`、`ACCESS`、`OBSERVE`、`AGENT`、`LIFECYCLE`。
- `mainline` 的浏览器文件只有 `webui/tests/real-e2e/journey-v025.spec.ts`。
- 五份冻结目录 spec 不进入任何产品目标。
- J01-07 缺 `results/j01-agent.json` 时为 `blocked`，不得 `passed`。阶段 `passed` 还要 typed gold、至少一次 `lucy_query`、同会话第二问和 `expectedBinding`。
- 防换题、防泄露、防代答只经 `judgeMainlineAgent`。`journey-v025.spec.ts` 不得把 `first.question` 同时传入两边，也不得用 `gold.expected` 拼最终答案。
- 证据层级按 Spec §2.1 的文件标注。纯 `protocol` 不得戳成 `browser`，含 `mixed` 的目标不得戳成纯 `protocol`。
- `AGENT` 只调度 `ownerBranch === AGENT`。`LIFECYCLE` 只调用 `run-upgrade-features.mjs`。
- 有 target 时退出码只看选中项。未选中项不计入 passed。
- `--list` 不起 Lucy、不跑 Playwright。
- 无 target 的 `e2e:real:management` 仍收集整个 `webui/tests/real-e2e/`。
- J01-02 使用 `journeySchemaName(runId)`，不用 Schema `analytics`。
- 本条收口不表示可上线。

---

## 1. 目标

落地 Spec v0.4：互斥入口、J01-07 读取函数判定、按文件标注的证据层级、按目标映射的 selectedIds。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec／Plan v0.4 已落盘 | 满足 |
| P2 | Codex 交叉审阅最多三轮后的定稿 | 满足。第 3 轮对 v0.4 给出可定稿 |
| P3 | 委托人授权改运行代码 | 满足。2026-11-02 授权落地 |

去掉 `--list` 的试跑不在本 Plan 的完成定义里。

## 3. 任务

### Task 1: 选择器（SC-01–SC-05、SC-11–SC-13）

**Files:**

- Create: `scripts/e2e/lib/product-targets.mjs`
- Create: `scripts/e2e/select-product-target.mjs`
- Modify: `scripts/e2e/run-management.mjs`
- Test: `scripts/e2e/__tests__/product-targets.test.mjs`

**Interfaces:**

- Produces: `filesFor(target)`、`evidenceLayerFor(target)`、`configFor(target)`、`selectProductTarget(argv)`。`--list` 返回 `{ execute: false }`。

- [x] 先写 SC-01–SC-03、SC-05、SC-11–SC-13 的失败单测。SC-12 断言交给执行器的集合等于 owner 与 `runner === "agent"` 的交集，且含全部交集 id，不含 `SEC-16-V04`。SC-13 用离线子 run 清单断言父判定读 `lucy-upgrade-checklist/v1`，不读 `UPG25`。
- [x] 实现 §2.1 与 §2.2。`AGENT` 与 `LIFECYCLE` 不进入 `playwright.real.config.ts`。
- [x] 无 target 时 `run-management` 的参数与现在一致。
- [x] `--list` 的包装测试断言不调用 prepare、管理腿或 Playwright。此步关闭 SC-04。

### Task 2: J01-07 只读本次证据（SC-07–SC-10）

**Files:**

- Create: `scripts/e2e/lib/j01-agent-evidence.mjs`
- Modify: `webui/tests/real-e2e/journey-v025.spec.ts`
- Test: `scripts/e2e/__tests__/j01-agent-evidence.test.mjs`
- 已有且只加断言、不改行为：`scripts/e2e/lib/j01-schema.mjs`、`scripts/e2e/__tests__/j01-schema.test.mjs`

**Interfaces:**

- Consumes: `results/j01-agent.json`、gold、`assertPromptUnchanged`、`assertNoGoldLeak`、`assertAgentOwnedCalls`、`journeySchemaName`
- Produces: `loadMainlineAgentEvidence(file)` 与 `judgeMainlineAgent(...)`。阶段 `passed` 仅当 Spec §3 的 1～6 全部成立，且 `expectedBinding` 的必填键齐全。

- [x] 夹具文件经 `loadMainlineAgentEvidence`：prompt 多一个空格；`transcriptText` 含 gold 金额；无工具调用；trace 冒充客户端调用；同 call id 但 `tokenLabel` 或 `policyVersion` 错误；缺 `tokenLabel`；答案不符；缺第二问。这些都不得 `passed`。缺文件为 `blocked`。
- [x] 正常对照：其他条件都满足，只有 `finalAnswer` 含正确金额时，防泄露通过，阶段可以 `passed`。
- [x] 浏览器 spec 只调用 `loadMainlineAgentEvidence`。它不得调用三条断言函数，也不得读取 `gold.expected`。
- [x] SC-10 写在 `scripts/e2e/__tests__/j01-schema.test.mjs`：`journeySchemaName("local-run")` 不等于 `analytics`，向导参数使用该返回值。注释写明这不关闭 2026-10-25 §5.2。

本任务不启动真实 Agent。写出 `j01-agent.json` 的客户端驱动留在试跑，不在 SC-07–SC-09。

### Task 3: 选择与退出码（SC-06）

**Files:**

- Modify: `scripts/e2e/collect-v025-results.mjs`
- Modify: `scripts/e2e/run-management.mjs` 里有 target 时的退出路径。无 target 时仍调用 `writeManagementEvidence` 并用其状态退出
- Test: `scripts/e2e/__tests__/product-targets.test.mjs`

- [x] `mainline` 的 selectedIds 只有 `J25-01`。包装层看到该旅程 `failed` 或 `blocked` 时，退出码跟随它。
- [x] 有 target 时，未选中项的 `failed` 与 `blocked` 都不改变退出码，也不计入 passed。
- [x] 选中 id 自己的 `failed` 仍使退出码失败。
- [x] 空选择被拒绝，聚合函数拿到空名单时不得返回 passed。
- [x] `selection.json` 的 target、files、evidenceLayer、selectedIds 来自选择器。

### Task 4: 命令登记

**Files:**

- Modify: `package.json`
- Modify: `docs/governance/test-layers-and-release-gates.md` §2
- Modify: `docs/qa/e2e-sop.md`
- Modify: `docs/runbooks/real-user-e2e.md`

- [x] `npm run e2e:product -- --list` 打印七个目标及 evidenceLayer。
- [x] 门禁文档写明该命令不是 PR 阻塞，也不替代 `e2e:real:*` 与 `gate:customer-release`。
- [x] 试跑说明写明：`e2e:real:prepare` → `--list` → 去掉 `--list`。去掉 `--list` 的那一次不在本 Plan 的完成定义里执行。

## 4. 验收

以 Spec §5 的 SC-01–SC-13 为准。必须跑完这三份测试，再加一次 `--list`：

| 文件 | SC |
|---|---|
| `scripts/e2e/__tests__/product-targets.test.mjs` | SC-01–SC-06、SC-11–SC-13 |
| `scripts/e2e/__tests__/j01-agent-evidence.test.mjs` | SC-07–SC-09 |
| `scripts/e2e/__tests__/j01-schema.test.mjs` | SC-10 |

不把浏览器旅程或真实 Agent 的 passed 写进本 Plan。

## 5. 完成定义

- Task 1–4 勾销。
- SC-01–SC-13 有上表三份测试或 `--list` 的证据。
- 旧管理腿无 target 时仍收集整目录。
- 本条收口不表示可上线。

## 6. 风险

| 风险 | 控制 |
|---|---|
| `--files` 让无 target 的冻结目录跑丢 | 无 target 不传文件列表，并留参数单测 |
| 防换题单测自己把 gold 题目写进两边，夹具变绿 | SC-07 的夹具必须让两字段不同；评审时看夹具原文 |
| `protocol` 通过被报告写成页面完成 | SC-11 拒绝带「页面旅程完成」的 protocol 记录 |
| 试跑仍撞 J01-02 端点门或没有模型出口 | 这两项不在本条出口。试跑按当次 `failed` / `blocked` 另记 |
