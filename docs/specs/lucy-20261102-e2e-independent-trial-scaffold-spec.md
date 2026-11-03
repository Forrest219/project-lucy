# Lucy E2E 功能试跑优化 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 测试入口与判定合同 / v0.4 |
| 日期 / 目标版本 | 2026-11-02 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / 不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **功能合同已收口（2026-11-02）**。SC-01–SC-13 已由单测与 `e2e:product --list` 取证。八阶段试跑未执行。本条收口不表示可上线 |
| 权威设计 | [主线与旁线 Spec](lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) §1.4、§4；操作定义见 [`docs/qa/e2e-sop.md`](../qa/e2e-sop.md) §0 |
| 实施计划 | [`docs/plans/lucy-20261102-e2e-independent-trial-scaffold-plan.md`](../plans/lucy-20261102-e2e-independent-trial-scaffold-plan.md) |
| 审阅 | 本机 Codex CLI 交叉审阅三轮。第 3 轮对 v0.4 给出可定稿。记录落 [`docs/reviews/2026-11-02-codex-review-e2e-independent-trial-scaffold.md`](../reviews/2026-11-02-codex-review-e2e-independent-trial-scaffold.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |

v0.1 只规定互斥入口。v0.2 补判定缺口。v0.3 收紧第 1 轮意见。v0.4 收紧第 2 轮仍部分闭合的 R01、R02、R04、R05、R06，并修正 N01。第 3 轮对这份 v0.4 给出可定稿。本文仍不要求八阶段或 173 个执行项在本条出口里跑绿。

## 闭口层级

- 层级：功能合同
- 本条承诺：一次调用只启动主干或一个分支；主干 J01-07 的防换题、防泄露、防代答只读取本次 Agent 证据里的原文；协议分支的结果标明 `protocol`，不得记成页面旅程完成。
- 本条出口：SC-01–SC-13。选择器单测、证据夹具单测、源码守卫和 `--list` 打假错误入口与错误判定。
- 不在本条出口：八阶段真实旅程通过、六类分支深度矩阵通过、真实模型调用、升级与备份恢复、镜像、Kubernetes、受保护 runner、`gate:customer-release`。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增 WebUI、API 或用户可见错误文案。

QA 文档里的说法：

| 说法 | 既有名称 | 不进入产品界面 |
|---|---|---|
| 主干 | 主线 `J25-01` | 是 |
| 分支 | 旁线 `CONN` / `SEM` / `ACCESS` / `OBSERVE` / `AGENT` / `LIFECYCLE` | 是 |
| 证据层级 `browser` / `protocol` / `real-agent` | 设计基线 §8.1 的浏览器 E2E、协议、真实 Agent | 是 |

## 1. 已落地与仍要改的判定

2026-11-02 对照源码。下面「已落地」指文件在仓库里；「试跑未复验」指没有新的通过记录。

| 项 | 源码 | 本条怎么处理 |
|---|---|---|
| 覆盖清单、八阶段合同、`j01-state` | `v025-coverage.yaml`、`mainline-scenarios.mjs`、`j01-state.mjs` | 不改阶段表，不改分母 |
| 主干 J01-01～J01-06 | `journey-v025.spec.ts` 经 `journey-v025.ts` 做页面动作 | 保留。2026-10-25 只跑通 J01-01 |
| J01-02 专用 Schema | `j01-schema.mjs` 的 `journeySchemaName(runId)` 已避开夹具 Schema `analytics` | 只锁定当前实现：向导参数用这个名字。不关闭 [2026-10-25 测试报告](../reviews/2026-10-25-lucy-v0.25-e2e-test-report.md) §5.2 的 PM 二选一，不代替那次试跑复验，也不核对 seed／dataset digest |
| J01-07 | 浏览器 spec 只读 `results/agent.json`。缺文件则 `blocked`。防换题把 `gold.question` 同时传给 `executedPrompt` 与 `goldQuestion`。防泄露的最终答案由 `gold.expected` 拼出 | 本条要改判定。缺证据仍是 `blocked`，不得 `passed` |
| 管理腿 | `run-management.mjs` 收集整个 `webui/tests/real-e2e/` | 本条要加 target 文件列表 |
| 分支浏览器 spec | 见 §2.1 按文件标注。不能因为文件里有 `page.request` 就把整份标成 `protocol` | 本条不把它们改写成完整点击旅程 |
| Agent runner | `run-agent-journey.mjs` 按 `runner === "agent"` 选题，其中有 owner 不是 `AGENT` 的项 | `AGENT` 目标只提交覆盖清单里 `ownerBranch === AGENT` 的 id |
| 生命周期 | `run-upgrade.mjs` 的 `UPG-01`–`16` 与 `run-upgrade-features.mjs` 的旧功能清单是两套编号 | 本 target 只用后者。前者的通过不能算进本次 |
| 结果汇总 | `run-management.mjs` 用冻结目录汇总做进程退出码；未覆盖项会变成 `blocked` | 有 target 时退出码只看选中项 |

留在全量 `e2e:real:management`、不进入任一产品目标的 spec：`mainline-journey.spec.ts`、`admin-auth.spec.ts`、`management-journey.spec.ts`、`context-isolation.spec.ts`、`audit-export.spec.ts`。

`e2e:contract:release` 与 `e2e:release-ux` 继续走各自配置。

## 2. 一次调用一个目标

```text
npm run e2e:product -- --list
npm run e2e:product -- --target mainline --list
npm run e2e:product -- --target CONN --list
```

`--list` 只打印目标、文件、证据层级和配置，不起 Lucy，不跑 Playwright。合法 target 只有 `mainline`、`CONN`、`SEM`、`ACCESS`、`OBSERVE`、`AGENT`、`LIFECYCLE`。一次调用只接受一个。

### 2.1 文件与证据层级

路径相对仓库根。

| target | 入口 | 配置 | evidenceLayer |
|---|---|---|---|
| `mainline` | `webui/tests/real-e2e/journey-v025.spec.ts` | `webui/playwright.real.config.ts` | 目标 `mixed`。J01-01～J01-06、J01-08 为 `browser`；J01-07 为 `real-agent` |
| `CONN` | `webui/tests/real-e2e/connection-matrix-v025.spec.ts` | 同上 | `mixed`。打开新建连接表单是 `browser`；`/api/connections/probe` 是 `protocol` |
| `SEM` | `webui/tests/real-e2e/semantic-batch-v025.spec.ts` | 同上 | `mixed`。发布工作台页面检查是 `browser`；`/api/semantic-assets/*` 是 `protocol` |
| `ACCESS` | `row-policy-v025.spec.ts` 为 `protocol`；`row-policy-templates-v025.spec.ts` 为 `mixed`；`authorization-summary-v025.spec.ts` 为 `protocol` | 同上 | 目标聚合 `mixed` |
| `OBSERVE` | `audit-reconciliation-v025.spec.ts` 与 `access-map-v025.spec.ts` 都是 `mixed` | 同上 | 目标聚合 `mixed`。页面检查是 `browser`；审计读取 API 是 `protocol` |
| `AGENT` | 不收集 Playwright 目录。调度名单见 §2.2 | 无 | `real-agent` |
| `LIFECYCLE` | `scripts/e2e/run-upgrade-features.mjs`，其 Playwright 文件是 `webui/tests/upgrade-e2e/upgrade-features.spec.ts` | `webui/playwright.upgrade.config.ts` | `mixed`。缺该入口所需夹具时 `blocked`，原因 `environment` |

`scripts/e2e/run-upgrade.mjs` 不在上表。它的 `UPG-01`–`16` 与升级功能清单的编号不同，本 target 不调用它，也不把它的结果写入本次通过。

`run-upgrade-features.mjs` 会自己 prepare，并写出合同 `lucy-upgrade-checklist/v1` 的 `upgrade-checklist.json`。产品调用不把已有的 `e2e:real:prepare` 目录当成这次升级的实例。`selection.json` 记录 `childRunId`、结果文件路径和合同名。本次 `selectedIds` 只取那份清单里的 id。离线夹具给一份子 run 的清单，父判定必须读它；读到 `UPG25` 结果不得算进本次。

Hive 真实 HS2 仍由 `hive-v025.mjs` 按环境记 `blocked`。它不在 `CONN` 这次试跑文件里，编译通过不得写成 HS2 通过。

### 2.2 AGENT 名单

`AGENT` 目标交给执行器的名单，等于覆盖清单 `ownerBranch === AGENT` 与冻结 catalog `runner === "agent"` 的交集。只满足一边的 id 不在名单里，也不得在调度后被静默丢掉后仍宣称名单已跑完。`SEC-16-V04` 的 owner 是 `AGENT`、runner 是 `security`，所以不在名单。`SEC-14-V12` 不在名单。J01-07 的两问不在名单，它们只属于 `mainline`。SC-12 断言这份交集与实际交给执行器的集合相同。

## 3. 主干 J01-07 的证据

J01-07 的证据文件是该 run 的 `results/j01-agent.json`。浏览器 spec 只把这份文件交给 `judgeMainlineAgent`。缺文件时阶段为 `blocked`，不得 `passed`。文件包含恰好两问，顺序为 `Q-J25-CAC-28D` 然后自然追问键，且两问的 `clientSessionRef` 相同。每一问保存：

```yaml
questionId: string
executedPrompt: string
transcriptText: string          # 送给防泄露的模型可见原文
transcript: []                  # 送给 assertAgentOwnedCalls 的条目，含 role / tool / call id
finalAnswer: string
clientSessionRef: string
```

读取与判定只走 `loadMainlineAgentEvidence(file)` 然后 `judgeMainlineAgent(evidence, gold, serverTrace, expectedBinding)`。浏览器 spec 不调用 `assertPromptUnchanged`、`assertNoGoldLeak`、`assertAgentOwnedCalls`，也不读取 `gold.expected` 来拼答案。夹具把改过的 prompt、拼出的答案或冒充的 trace 交给这个读取函数；函数内部再自比或改读 gold，夹具必须失败。

`expectedBinding` 的必填键是 `runId`、`instanceId`、`agentId`、`tokenLabel` 或 `tokenId`、`semanticVersion`、`policyVersion`。`tokenSecretRef` 只是秘密引用，不参与比较；缺任一必填键时阶段不得 `passed`，即使现有比较器会跳过空键。`tokenLabel` 在 J01-06 写入 `j01-state.json`，与秘密引用分开保存。同 run、同 call id、错误的 `tokenLabel` 或 `policyVersion` 不得 `passed`。

阶段 `passed` 必须同时满足：

1. 防换题：`assertPromptUnchanged` 的 `executedPrompt` 取自证据，`goldQuestion` 取自 gold。两字段不得由同一个 gold 题目变量填入。
2. 防泄露：模型可见面是 `transcriptText` 与 `executedPrompt`。`finalAnswer` 取自证据。禁止用 `gold.expected` 拼出字符串再送去扫描。`transcriptText` 含 gold 金额时本条失败；只有 `finalAnswer` 含该金额时不因此失败。
3. 防代答：`assertAgentOwnedCalls` 接收证据里的 `transcript` 数组、服务端 trace，以及 `expectedBinding`。没有 Agent 工具调用，或调用 id 对不上，或只对上另一个 run／Agent／Token 的 trace，本条失败。用 trace 事件冒充客户端调用时本条失败。
4. typed gold：`finalAnswer` 与该问 `gold.expected` 不一致时阶段不得 `passed`。不新写第二套口径。
5. 至少一次 `tool === "lucy_query"` 的 Agent 调用。只有检索调用时阶段不得 `passed`。
6. 第二问存在，且 `clientSessionRef` 与第一问相同。

三条反作弊通过而 4～6 失败时，阶段仍是 `failed`。

`journey-v025.spec.ts` 不得再出现把 `first.question` 同时传入防换题两边，或用 `gold.expected` 拼 `finalAnswer`。源码守卫与夹具都走 `judgeMainlineAgent`。

`run-agent-journey.mjs` 继续服务 `e2e:real:agent`。`mainline` 不调用那份套件来充 J01-07。

J01-02 向导参数等于 `journeySchemaName(runId)`，且该名字不是 `analytics`。这只锁定当前实现。本条不关闭 2026-10-25 报告 §5.2 的 PM 二选一，不代替那次试跑复验，也不宣称 seed／dataset digest 已经核对。

## 4. 结果边界

非 `--list` 调用写入该 run 的 `selection.json`：

```yaml
target: mainline
files: []
evidenceLayer: mixed
selectedIds: []
```

`selectedIds` 按目标取值，不从 Playwright 文件覆盖的冻结 id 反推：

| target | selectedIds |
|---|---|
| `mainline` | 只有 `J25-01`。阶段聚合失败或 `blocked` 就是这次退出状态 |
| `CONN` / `SEM` / `ACCESS` / `OBSERVE` | `product-targets.mjs` 里的显式数组，与对应 spec 的 `coversV025` 参数一致。单测比较这两处，不从整份 catalog 推导 |
| `AGENT` | §2.2 的交集 |
| `LIFECYCLE` | 子 run 的 `upgrade-checklist.json` 里的 id |

有 target 时，进程退出码只由上表的聚合决定。`J25-01` 为 `failed` 或 `blocked` 时，退出码跟随它，即使其他结果是 passed。未选中项不产生通过证据，不计入 passed 计数，报告只声明选中范围。未选中项的 `failed` 或 `blocked` 不改变本次退出码。选中项自己的 `failed` 仍使退出码为失败。空选择被选择器拒绝，不得变成 passed。

无 target 的 `e2e:real:management` 仍用今天的冻结目录汇总做退出码。

`protocol` 文件的通过不得写成「用户在页面上完成了该动作」。含 `mixed` 文件的目标不得被戳成纯 `protocol`。纯 `protocol` 文件不得被戳成 `browser`。

主干八阶段仍共用 `j01-state.json`。选择 `mainline` 不把八个阶段拆成八次独立通过。

## 核心流程（伪代码）

```text
function selectProductTarget(argv):
    target = requireOneOf(argv.target, TARGETS)    # --list 且无 target 时只打印七个目标
    files = FILES[target]
    assertDisjoint(files, filesOf(every other target))
    assertAbsent(files, FROZEN_SUITE_NOT_IN_PRODUCT_TARGETS)
    if argv.list:
        print(target, files, evidenceLayerOf(target), configOf(target))
        return
    require existing run.json
    write selection.json
    if target == mainline:
        playwright(real config, files)
        stage = judgeMainlineAgent(read j01-agent.json, gold, serverTrace, bindingFrom(j01-state))
        # stage.passed 仅当 §3 的 1～6 全部成立；缺文件 => blocked
    else if target in {CONN, SEM, ACCESS, OBSERVE}:
        playwright(real config, files)
        stamp per-file evidenceLayer from §2.1
    else if target == LIFECYCLE:
        if upgrade-features fixture capability missing:
            record blocked, reason=environment
        else:
            run scripts/e2e/run-upgrade-features.mjs
            refuse if argv contains run-upgrade.mjs
    else:                                         # AGENT
        ids = coverage.where(ownerBranch == AGENT)
        assert SEC-14-V12 not in ids
        assert J01 question ids not in ids
        run-agent-journey with ids only
    exitCode = verdict(selectedIds only)
```

`judgeMainlineAgent` 内部调用现有的 `assertPromptUnchanged`、`assertNoGoldLeak`、`assertAgentOwnedCalls`。浏览器 spec 不直接组这些参数。

## 5. 验收

| 编号 | 检查 | 通过时能看到 |
|---|---|---|
| SC-01 | 选择器单测 | 未知 target、空 target、两个 target 都拒绝；七个合法值各被接受一次 |
| SC-02 | 选择器单测 | `mainline` 的浏览器文件只有 `journey-v025.spec.ts` |
| SC-03 | 选择器单测 | 六个分支入口互不相交，且都不含 `journey-v025.spec.ts` 与 §1 的五份冻结目录 spec |
| SC-04 | `--list` | 退出码 0；输出含目标、路径、evidenceLayer；没有本次启动的 Lucy 或 Playwright |
| SC-05 | 管理腿参数单测 | `mainline`、`CONN`、`SEM`、`ACCESS`、`OBSERVE` 传给 Playwright 的路径等于 §2.1，配置为 `playwright.real.config.ts` |
| SC-06 | 命令包装与退出码 | `mainline` 的 `J25-01` 为 `failed` 或 `blocked` 时退出码跟随它。未选中 `failed` 不改变该退出码，也不计入 passed。空选择被拒绝 |
| SC-07 | 读取函数夹具 | 证据文件里的 prompt 比 gold 题目多一个空格，经 `loadMainlineAgentEvidence` 后防换题失败。浏览器 spec 不调用三条断言函数。在判定函数里改回 gold 自比、gold 拼答案或用 trace 代替客户端调用时，对应夹具失败 |
| SC-08 | 同一入口的泄露夹具 | `transcriptText` 含 gold 金额时失败。其他条件都满足、只有 `finalAnswer` 含该金额时，防泄露通过，阶段可以 `passed` |
| SC-09 | 同一入口的阶段夹具 | 无工具调用、调用 id 不符、trace 冒充客户端调用、同 run 同 call id 但 `tokenLabel` 或 `policyVersion` 错误、缺 `tokenLabel`、答案不符、缺第二问，都不得 `passed`。缺文件为 `blocked` |
| SC-10 | Schema 单测 | `journeySchemaName(runId)` 不等于 `analytics`，向导参数使用该返回值。单测通过不表示 §5.2 的 PM 事项已裁决或已复验 |
| SC-11 | 层级单测 | 纯 `protocol` 文件被戳成 `browser` 时失败。含 `mixed` 文件的目标被戳成纯 `protocol` 时失败。该记录不得带「页面旅程完成」 |
| SC-12 | Agent 名单单测 | 交给执行器的集合等于 §2.2 的交集。`SEC-16-V04`、`SEC-14-V12` 与 J01 两问都不在集合里。交集里的 id 一个都不能少 |
| SC-13 | 生命周期结果单测 | 调度命令是 `run-upgrade-features.mjs`。`selection.json` 指向子 run 的 `upgrade-checklist.json` 与合同 `lucy-upgrade-checklist/v1`。读到 `UPG25` 结果不算本次通过 |

## 6. 非目标

- 不修改 `J01_STAGE_CONTRACT`、覆盖清单分母、冻结 catalog / lock。
- 不把 `e2e:real:security`、`e2e:real:management`、`e2e:real:agent` 改成默认只跑一个目标。
- 不把 `protocol` 分支改写成完整点击旅程。
- 不登记新的 required check，不改 `gate:customer-release`。
- 不在本条里打开模型 API 出口，也不把 2026-10-25 的 J01-01 通过记录写成整条主干通过。

## 7. 落盘清单自查

| # | 要求 | 本文件 |
|---|---|---|
| 1 | 文件名保持 `lucy-20261102-e2e-independent-trial-scaffold-spec.md` | 是。范围已从 v0.1 入口扩到判定，文件名不改 |
| 2 | 核心流程（伪代码） | 有 |
| 3 | 文档类型 / 版本、状态 | 有 |
| 7 | 索引 | `docs/README.md`、`docs/plans/README.md` 与头部状态同一句 |
| 8 | 新命令 | 实施时才写入 `package.json` 与测试门禁文档 §2 |
| 9 | 台账号 | 无 |
| 11 | 闭口层级 | 功能合同 |
