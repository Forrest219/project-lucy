# Lucy 审计问询旅程 → Eval 用例草稿导出 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派台账号后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只登记设计与验收口径，不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 需求池条目 | REQ-030-020，来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 配套 Plan | [lucy-20261107-audit-journey-eval-case-draft-plan.md](../plans/lucy-20261107-audit-journey-eval-case-draft-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 分支级决策 | D4＝**(a) 单向导出**（审计 → 用例草稿）；不做用例 → 审计回放。委托人 2026-11-07 裁定，本 Spec 直接采用，不再回头问 |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：管理员能从一段真实审计问询出发，导出一份**脱敏合成**的 Eval 用例草稿——`tool_assertions` 由调用序列确定性反推、题干为合成文本；草稿只落在草稿区，**不自动进池、不自动进跑批**，人工确认后才进 `evals/**`；导出过程**不写审计库**。
- 本条出口：能打假这一条的检查——本机自动化（读取与反推的纯函数单测、脱敏断言、草稿落位断言、写审计零副作用断言）＋ CI job。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级
- 上线关系：本条收口不表示可上线

补充说明：镜像构建、客户交付、真实客户环境证据均不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。

---

## 1. 背景与取证

### 1.1 两端都有，中间没桥

| 端 | 已有 | 位置 |
|---|---|---|
| 审计侧 | 能读出一段问询的「原话 → 调用序列 → 结果」故事线 | `docs/specs/lucy-20261104-audit-call-storyline-spec.md`；服务端读取入口 `GET /api/admin/audit/turns/:turnId`（`webui/server/admin/audit.ts:3891-3893`） |
| Eval 侧 | 有带 `question` 与 `tool_assertions` 的用例 | `evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:137-165`；用例文件路径 `webui/server/eval/cases.ts:113` |
| **桥** | **不存在** | 排障时看到「这个 Agent 连续查了 8 次同一个 ID」，今天只能人工翻译成 YAML |

### 1.2 审计侧读得出什么（逐条取证）

| 编号 | 事实 | 位置 |
|---|---|---|
| F1 | 原话登记在 `conversation_turns`：`question_hash` / `question_preview` / `question_summary` / `question_source` / `redaction_version` | `webui/server/proxy/audit.ts:633-647` |
| F2 | 调用流水在 `access_log`：`tool` / `args_summary` / `outcome` / `response_row_count` / `lucy_turn_id` 等 | `webui/server/proxy/audit.ts:538-568`（`tool` 在 `:548`、`args_summary` 在 `:550`、`outcome` 在 `:555`） |
| F3 | 两者的关联键是 `access_log.lucy_turn_id = conversation_turns.turn_id` | `webui/server/admin/audit-export-v2.ts:660` |
| F4 | 问询详情路由按 `lucy_turn_id` 取该问询的调用序列（按 `ts` 升序） | `webui/server/admin/audit.ts:4038-4044`（`WHERE lucy_turn_id = ?` 在 `:4042`） |
| F5 | 问询详情返回 `questionPreview` / `questionSummary` / `questionSource` 与 `accessLogs[]` | `webui/server/admin/audit.ts:4102-4108` |
| F6 | 每条调用映射出 `tool` / `outcome` / `argsSummary` / `responseRowCount` | `webui/server/admin/audit.ts:3902-3945` |
| F7 | `outcome` 值域：`ok` / `error` / `denied` / `budget_stop` | `webui/server/proxy/audit.ts:119` |
| F8 | 问询预算上限 20 次调用 / 120 秒 | `webui/server/proxy/question-experience.ts:9-10` |

### 1.3 Eval 侧现状与既有草稿语义

| 编号 | 事实 | 位置 |
|---|---|---|
| F9 | 用例可带 `review_status: "active" | "needs_review"` | `webui/server/eval/cases.ts:51`、`webui/src/lib/types.ts:2122` |
| F10 | 离线批量跑批**会跳过** `needs_review` 的用例（判 `SKIPPED`），并从可跑集合中剔除 | `webui/server/eval/offline-batch.ts:169-172`、`webui/server/eval/offline-batch.ts:189` |
| F11 | 人工确认走既有端点 `POST /api/eval/cases/:domain/:caseId/confirm-review`（置 `active`） | `webui/server/eval/cases.ts:393-403` |
| F12 | 用例域枚举只认 `evals/{domain}/eval/{domain}-eval-cases.yaml` 一个文件 | `webui/server/eval/cases.ts:113`、`webui/server/eval/cases.ts:216-221` |
| F13 | 跑批执行的是 CLI runner（`--cases` 指向该固定路径） | `webui/server/eval/runner.ts:321-322` |

### 1.4 脱敏口径依据

| 编号 | 事实 | 位置 |
|---|---|---|
| F14 | 既有 Eval 集的口径是「**脱敏合成**……**不包含客户原始问句或业务明细**」 | `evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:13` |
| F15 | 合成批次以 `semantic_version: synthetic_v1` 标记 | `evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:142` |
| F16 | 原话入库前已过自由文本脱敏（敏感键值对 / 邮箱 / 身份证 / 手机号） | `webui/server/proxy/audit-privacy.ts:50-56` |
| F17 | 原话预览可整体关闭（`LUCY_STORE_QUESTION_PREVIEW=false`），默认开启、长度上限 500 | `webui/server/proxy/audit-privacy.ts:41-47` |
| F18 | `args_summary` 不含自由文本键（`question` / `questionPreview` / `intentSummary`） | `webui/server/proxy/audit-privacy.ts:26`、`webui/server/proxy/audit-privacy.ts:187-207` |

结论：**审计侧拿得到的是已经过一次脱敏的原话**，但那仍是**客户原话**，不是合成题干。本条不得把它直接落进 YAML（F14 / F15）。

### 1.5 关键约束发现：`needs_review` 挡不住 WebUI 跑批

CLI runner **完全不读** `review_status`（`scripts/eval/eval-runner.mjs` 全文无该字段），而 WebUI 跑批走的就是 CLI runner（`webui/server/eval/runner.ts:321-322`），且 `mode: "all"` 选例时不做 `review_status` 过滤（`webui/server/eval/runner.ts:286-307`）。

因此：**「草稿不进跑批」不能靠 `review_status` 保证**，只能靠 ① 草稿不落在 `evals/**`（F12 / F13 的路径隔离）＋ ② 人工确认后才移入。本 Spec 据此设计，不允许评审时被 `review_status` 误导。

### 1.6 与 REQ-030-019（G2）的关系

019（[`lucy-20261107-eval-tool-assertion-authoring-spec.md`](lucy-20261107-eval-tool-assertion-authoring-spec.md)）已裁定：**编辑器本条只暴露 4 个预算型**，路径型断言在类型层保留但**不可在 WebUI 编辑**。本条会产出路径型断言（`required_tool` / `forbidden_tool`），故两者存在天然耦合：

- 本条草稿的落地路径必须是 **YAML 文件**，不能假定能在 WebUI 表单里编辑；
- 019 的「路径型断言只读保留、不得丢弃」（其 D6）是本条草稿并入 `evals/**` 后**不被编辑往返误删**的前提。

另注：**REQ-030-019 条目正文两处仍留「7 型」**（`docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:478`、`:482`），而**分支计划已自纠为 8 型**（`docs/plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md:38`、`:99`，含「2026-11-07 复核更正」注记），需求池的变更记录行亦已自纠；以 runner 代码为准为 **8 型**（019 的 Spec §1.3 已记）。需求池正文由索引维护方同步，本 Spec 不代改。

---

## 2. 设计决策

> 编号说明：本节 `D1…D8` 是**本 Spec 的冻结决策**；分支级拍板点是 `D4`（见头部元数据），两者不是同一组。

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | **单向导出**（审计 → 用例草稿）；不做「用例 → 审计回放」 | 落实分支级 D4。回放会写生产审计，风险与成本不成比例 |
| D2 | 导出面 = **服务端只读导出端点**，返回草稿 YAML 文本；**本条无 WebUI 视觉／交互改动**——不新增 WebUI 前端页面／组件，**新增一个服务端只读导出端点** | 导出是运维排障动作，本机接口足够；不扩审计数据的对外暴露面 |
| D3 | **不落客户原句**：草稿 `question` 用合成题干，原话只以 `question_hash` 指纹 + 长度入 `notes`；草稿带 `semantic_version: synthetic_v1` | 沿用 `evals/agent_reliability` 的脱敏合成约定（F14 / F15）；「已脱敏的原话」仍是客户原话，不能直接落 YAML |
| D4 | 反推只从**确定性信号**出发，四条规则（见 §3.2）；命中即产出，不命中不产出 | 反推必须可解释、可复算；不引入 LLM 猜测定性 |
| D5 | 草稿落**独立草稿区** `inbox/eval-drafts/{domain}/{case_id}.yaml`；**不在 `evals/**`**，不被 `listDomains`（F12）与 CLI runner 的 `--cases` 路径（F13）读取 | 「不自动进池、不自动进跑批」的第一道保证；`inbox/` 按 `AGENTS.md:71-72` 定位为过程性产物区，与「草稿」语义一致。⚠️ `inbox/` 全目录被 `.gitignore:59` 忽略且定位为「进程结束后可随时删除」→ 草稿若只落 `inbox/`，**第二人无从复核**；故 Plan 开工前置必须写死保留与复核证据落点（见 Plan 前置第 7 项） |
| D6 | 草稿带 `review_status: needs_review`（F9），人工确认走既有 `confirm-review` 端点（F11）；**但明确写下**：`needs_review` 只在离线批量跑批生效（F10），**挡不住 CLI runner / WebUI 跑批**（§1.5） | 不给评审者虚假安全感；「不自动进跑批」的保证是路径隔离 ＋ 人工确认，不是这个字段 |
| D7 | **反推不出断言时**：产出**零断言草稿**（`tool_assertions: []`）并显式标注「未从该旅程反推出可判定的路径断言」，**不产出空壳、不静默跳过** | 失败关闭：调用方必须看见「这条旅程推不出断言」 |
| D8 | 读不到原话 / 读不到调用序列 / 无权读该问询 → **不产出草稿**，返回明确错误，不产出半成品 | 失败关闭的第一形态；与 D7 区分：前者是「读不到」，后者是「读到了但推不出」 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：读取审计问询故事线（原话 → 调用序列 → 结果）

```text
# 位置：webui/server/admin/audit.ts（既有读路径 :3891-3893 / :4038-4049 / :4102-4108）
# 目标：取出一段问询的三段素材；**只读**

function readJourney(turnId, actor):
    # ⚠️ 授权判定必须复用**既有 admin 鉴权**，不得自造按 turn 的授权接口：
    #    现行 webui/server/admin/audit.ts 全文无按问询的鉴权判定（无 preHandler/requireAdmin 之类），
    #    本条**不新增**按 turn 粒度的授权模型——改为：整个导出端点走既有 admin 鉴权，
    #    无权则**整个端点 403**，不进入本函数。
    #    （本函数内的 turn 级存在性检查（turn_not_found）只是资源不存在，不是授权。）
    turn = SELECT turn_id, question_hash, question_preview, question_summary,
                    question_source, redaction_version
            FROM conversation_turns WHERE turn_id = ?          # F1
    if turn is null:
        return fail("turn_not_found")                        # D8：不产出草稿

    calls = SELECT id, ts, tool, outcome, args_summary, response_row_count
            FROM access_log
            WHERE lucy_turn_id = ? ORDER BY ts ASC           # F3 / F4
    if calls is empty:
        return fail("journey_has_no_calls")                  # D8：不产出草稿

    return {
        question: {
            hash:     turn.question_hash,                    # 指纹，可回溯
            preview:  turn.question_preview,                 # 仅用于本步内部判定
            summary:  turn.question_summary,
            source:   turn.question_source,
            redactionVersion: turn.redaction_version
        },
        calls: calls.map(c => ({
            tool: c.tool,
            outcome: c.outcome,                              # F7：ok / error / denied / budget_stop
            args: safeParse(c.args_summary),                 # F18：不含自由文本键
            rowCount: c.response_row_count
        }))
    }
```

### 3.2 流程 2：由调用序列反推路径断言

```text
# 位置：新增纯函数（服务端）
# 目标：四条确定性规则；命中即产出，不命中不产出（D4）

function deriveToolAssertions(journey) -> { assertions: [], notes: [] }:
    assertions = []
    notes = []

    # ── 规则 1：重复输入 → max_repeated_tool_input ──────────────
    # 同一工具 + 同一输入路径 + 同一取值，出现次数 > 1
    # ⚠️ 判据源必须是**原始入参**，不是 args_summary：
    #    runner 侧取 `inputValueAtPath(call.input, inputPath)`（eval-runner.mjs:804-806），
    #    即原始入参对象；而 audit 侧 `args_summary.filters` 经 summarizeFilterItem
    #    （webui/server/proxy/audit-privacy.ts:148-178）已**去值**——只剩 {kind,length}／valueCount，
    #    同长度的不同 filter 值摘要完全相同 → 直接拿摘要计数会**把不同取值误判为重复**；
    #    且 args_summary.filters 是对象、runner 侧 input.filters 是数组，input_path 语义错位。
    #    故：本条必须从审计的**原始入参**（非去值摘要）反推计数。
    for each (tool, inputPath) in observedInputPaths(journey.calls):
        counts = countByRawValue(journey.calls, tool, inputPath)   # 取原始入参，非 args_summary
        for each (value, times) in counts:
            if times > 1:
                assertions.push({
                    type: "max_repeated_tool_input",
                    tool: tool,
                    input_path: inputPath,
                    max_per_value: 1,                          # 语义：同一输入不得重复碰撞
                    reason: `该旅程对同一输入重复调用 ${times} 次`
                })
                notes.push(`max_repeated_tool_input: ${tool}.${inputPath}`)

    # ── 规则 2：单工具调用次数超阈 → max_tool_calls ──────────────
    for each tool in distinctTools(journey.calls):
        times = countCalls(journey.calls, tool)
        if times > TOOL_CALL_THRESHOLD:                       # 阈值来源见 D4 备注（可配，默认 3）
            assertions.push({
                type: "max_tool_calls",
                tool: tool,
                max: TOOL_CALL_THRESHOLD,
                reason: `该旅程对 ${tool} 调用 ${times} 次，超出预算`
            })
            notes.push(`max_tool_calls: ${tool}`)

    # ── 规则 3：总调用数超问询预算 → max_total_tool_calls ────────
    # ⚠️ 口径提醒：QUESTION_BUDGET_MAX_CALLS = 20（webui/server/proxy/question-experience.ts:9），
    #    而被测 Agent 走的是**同一套问询预算**（消费侧同值，:545、:613）。
    #    ⇒ 单轮旅程里总调用数 > 20 的情形**近乎不可能出现**（平台自己先截断），
    #    该断言在单轮场景下近乎恒真，只能在**续问／多轮累计**场景才可能触发。
    #    故本规则定位为「冗余护栏」：实现保留，但验收不得依赖它触发；
    #    若要真正有效，须改用「单次问询之外的口径」（如跨轮累计或代理侧自报预算），须回评审。
    if journey.calls.length > QUESTION_BUDGET_MAX_CALLS:     # 20（F8）
        assertions.push({
            type: "max_total_tool_calls",
            max: QUESTION_BUDGET_MAX_CALLS,
            reason: `该旅程共 ${journey.calls.length} 次工具调用，超出问询预算`
        })
        notes.push(`max_total_tool_calls`)

    # ── 规则 4：命中特定工具 → required_tool / forbidden_tool ───
    used_ok   = distinctTools(where outcome == "ok")           # F7
    # ⚠️ forbidden_tool 只在**工具级拒绝**时产出：
    #    `outcome == "denied"` 覆盖的不只是「工具不可用」——admission 的 denied 还包含
    #    「角色解析失败」（webui/server/proxy/admission.ts:326）与「信封校验失败」（:341），
    #    与该工具是否可用无关；`error` 则是系统/SQL 错误（mcp-proxy.ts:2802 等）。
    #    把 denied/error 一律转成 forbidden_tool 会产出**假失败回归断言**（断言工具禁用，
    #    但真实原因是别处出错）。
    used_bad  = distinctTools(where outcome == "denied" and decision_reason is 工具级拒绝)
    for each tool in used_ok:
        if tool in DATA_PLANE_TOOLS:                          # 数据面工具集（白名单）
            assertions.push({
                type: "required_tool",
                value: tool,
                reason: `该旅程成功走过 ${tool}`
            })
            notes.push(`required_tool: ${tool}`)
    for each tool in used_bad:
        assertions.push({
            type: "forbidden_tool",
            value: tool,
            reason: `该旅程在 ${tool} 上被工具级拒绝`
        })
        notes.push(`forbidden_tool: ${tool}`)
    # 非工具级 denied（角色解析失败／信封校验失败）与 error → 只进 notes，不产出断言
    for each call where outcome in ("denied","error") and not 工具级拒绝:
        notes.push(`skipped_assertion: ${call.tool} outcome=${call.outcome} reason=${call.decision_reason ?? "unknown"}`)

    return { assertions: assertions, notes: notes }
```

> **阈值口径备注（D4）**：规则 2 的 `TOOL_CALL_THRESHOLD` 与规则 4 的 `DATA_PLANE_TOOLS` 都是**可配置常量**，须在开工前与 PM 确认初值；本 Spec 给出默认值（3 次、数据面 6 工具白名单）作为起点。`DATA_PLANE_TOOLS` 取自既有数据面白名单（`webui/server/proxy/acl.ts:86-93`），**不得新造工具清单**。

### 3.3 流程 3：脱敏与合成（不得把客户原句落进 YAML）

```text
# 位置：新增纯函数（服务端）
# 目标：草稿里的题干是**合成文本**；原话只留指纹

function synthesizeQuestion(journey) -> string:
    # 1) 先脱敏（即便原话入库时已过一遍，仍再过一次）
    safe = redactQuestionText(journey.question.preview ?? "")   # F16

    # 1b) ⚠️ 原话预览不可用 → 不得产出空题干。
    #     原话预览受 `LUCY_STORE_QUESTION_PREVIEW` 开关控制（webui/server/proxy/audit-privacy.ts:45-47），
    #     关闭时 preview 为空。若继续往下走，generalizeQuestion("") 会产出空题干，
    #     generalizeQuestion 的降级行为在仓内无从核实。
    #     本条定义为：**预览不可用 ≠ 读不到素材**（读到了 turn，但原话未存），
    #     故走通用模板题干 ＋ notes 显式标注，而不是空题干，也不是 D8 的失败关闭。
    if String(safe).trim() == "":
        notes.push("原话预览不可用（question preview 未存储或已关闭）")
        return templateQuestion(journey)             # 通用模板题干（基于工具与调用次数），非空

    # 2) 命中客户专有信号 → 走合成模板，**不回填原句**
    if containsBusinessEntity(safe):                            # 表名 / measure 名 / 业务实体
        return templateQuestion(journey)                        # 例：基于所用工具与调用次数合成题干

    # 3) 通用措辞 → 保留语义骨架，剔除具体取值与实体
    return generalizeQuestion(safe)                             # 去数字 / 去实体名 / 去专有名词

function buildDraft(journey, derived):
    return {
        id: draftCaseId(journey),                  # 例：<domain>-journey-<turn_id>-<日期>
        case_type: "single_turn",
        question: synthesizeQuestion(journey),     # D3：合成题干，不是客户原话
        domain: domainOf(journey),
        skill_version: "v1.0",
        semantic_version: "synthetic_v1",           # F15：合成批次标记
        model_id: "runtime-default",
        expected_source: "semantic_layer",
        expected_measures: [],
        sql_assertions: [],
        tool_assertions: derived.assertions,       # 反推结果
        result_assertions: [],
        review_status: "needs_review",             # D6
        snapshot_date: today(),
        notes: [
            `来源：审计问询 ${journey.question.hash}（原话指纹，长度 ${len(journey.question.preview ?? "")}）`,
            `脱敏口径：不落客户原始问句；题干为合成文本`,
            `反推依据：${derived.notes.join("; ") || "无"}`
        ]
    }
```

### 3.4 流程 4：草稿产出与人工确认边界

```text
# 位置：服务端只读导出端点（新增）；落盘由调用方显式完成

function exportDraft(turnId, actor):
    journey = readJourney(turnId, actor)              # 失败 → 直接返回错误（D8）
    if journey is fail:
        return { ok: false, error: journey.reason }    # **不产出任何草稿内容**

    derived = deriveToolAssertions(journey)            # 可能为空（D7）
    draft   = buildDraft(journey, derived)
    yaml    = toEvalCaseYaml(draft)                    # 单条用例 YAML 片段

    return { ok: true, data: {
        draft_yaml: yaml,
        draft_path: `inbox/eval-drafts/${draft.domain}/${draft.id}.yaml`,  # D5：建议落位
        assertion_count: derived.assertions.length,
        review_status: draft.review_status,            # needs_review（D6）
        auto_registered: false,                        # 不自动进池
        auto_batched:   false                          # 不自动进跑批
    } }
    # 本端点**不写审计库**、**不写 evals/**、**不入跑批队列**（SC-08）

# 人工确认链（既有机制，不新建）：
#   ① 调用方把 draft_yaml 存到 draft_path（草稿区）
#   ② 人工复核题干与断言
#   ③ 人工把内容并入 evals/{domain}/eval/{domain}-eval-cases.yaml（F12）
#      —— 保持 review_status: needs_review，不得改成 active
#   ④ 走既有 POST /api/eval/cases/:domain/:caseId/confirm-review 置 active（F11）
#      —— 这一步是「人工确认」的落点
```

### 3.5 流程 5：反推不出断言的降级 / 失败关闭

```text
# 位置：deriveToolAssertions 的调用侧

function handleNoAssertion(journey, derived):
    if derived.assertions is not empty:
        return derived

    # D7：读到了旅程，但推不出任何可判定的路径断言
    #   → 产出**零断言草稿**并显式标注；不产出空壳；不静默跳过
    draft = buildDraft(journey, derived)               # tool_assertions: []
    draft.notes.push("未从该旅程反推出可判定的路径断言；本条为占位草稿，人工确认时可删除")
    draft.review_status = "needs_review"
    return draft
    # 调用方看到的必须是「零断言草稿」这一显式结果，
    # 而不是「导出失败」，也不是「导出成功且看起来有断言」

# 与 D8 的区别：
#   D8：读不到素材 → 不产出草稿（错误返回）
#   D7：读到了素材但推不出断言 → 产出零断言草稿并标注
```

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 能从一段审计问询读出「原话 → 调用序列 → 结果」三段素材，且调用序列按 `access_log.lucy_turn_id = conversation_turns.turn_id` 关联、按 `ts` 升序 | 单元（读路径纯函数）＋ 固定夹具问询的端到端断言 |
| SC-02 | 调用序列含重复输入时，反推出 `max_repeated_tool_input`（`max_per_value: 1`），字段名与 runner 口径一致（`tool` / `input_path` / `max_per_value`）。**判据源必须是原始入参**（runner 侧 `inputValueAtPath(call.input, ...)`，`eval-runner.mjs:804-806`），**不得**用去值后的 `args_summary.filters`（`audit-privacy.ts:148-178`）——同长度的不同 filter 值摘要完全相同，用摘要会把不同取值误判为重复 | 单元（反推纯函数）＋ 字段比对 runner 合同（`scripts/eval/eval-runner.mjs:795-799`）＋ 一条「同长度不同取值不被误判」的反例断言 |
| SC-03 | 调用序列命中特定工具时，反推出 `required_tool`（成功走过）与 `forbidden_tool`（**仅工具级拒绝**）。`outcome == "denied"` 中的「角色解析失败／信封校验失败」（`admission.ts:326`、`:341`）与 `error`（系统/SQL 错误）**不产出 `forbidden_tool`**，只进 `notes` | 单元（反推纯函数，按 `outcome` ＋ `decision_reason` 分支）＋ 一条「非工具级 denied 不产出 forbidden_tool」的反例断言 |
| SC-04 | 草稿 YAML 中**不出现客户原话原文**；含合成题干、`semantic_version: synthetic_v1`、原话指纹与长度 | 单元（脱敏断言：把原话全文塞进夹具，逐条比对草稿全文不含该子串） |
| SC-05 | 草稿落位在 `inbox/eval-drafts/**`，**不在 `evals/**`**；`listDomains` 与 CLI runner 的 `--cases` 路径均不指向该路径 | 单元（路径断言）＋ 目录扫描断言 |
| SC-06 | 草稿存在时，WebUI 跑批选出的用例集合**不含**该草稿。断言须覆盖**并入 `evals/**` 但 `needs_review` 未确认**这一真实风险（RES-01）——该场景下草稿已在 `evals/**`，只有 `review_status` 未确认；`review_status` **挡不住 CLI runner**（`eval-runner.mjs` 中无该字段），故此风险靠运营纪律，不能只测「草稿在 `inbox/`」这一恒真形态 | 本机自动化（跑批选例断言 ＋ 并入 `evals/` 未确认场景一条） |
| SC-07 | 调用序列推不出任何断言时，产出**零断言草稿**并显式标注；不产出空壳、不静默跳过 | 单元（反推空集合 → 草稿断言） |
| SC-08 | 导出过程**零写审计**：调用前后 `access_log` / `conversation_turns` 的行数与内容不变 | 本机自动化（前后快照比对） |
| SC-09 | 草稿并入 `evals/**` 时 `review_status` 初始为 `needs_review`；人工确认走既有 `confirm-review` 端点 | 单元（端点调用）＋ 既有端点回归 |
| SC-10 | **D8 失败分支必须可打假**：读不到素材（turn 不存在／无权访问）→ **错误返回**，且**草稿产出量为 0**（不产出任何 yaml、不写 `inbox/eval-drafts/**`）。本条不得出现「返回成功但草稿为空」的中间态 | 单元（turn 不存在一条 ＋ 无权一条：断言错误码 ＋ 草稿目录产出文件数 = 0） |
| SC-11 | 原话预览不可用（`LUCY_STORE_QUESTION_PREVIEW` 关闭，`audit-privacy.ts:45-47`）→ 走通用模板题干 ＋ `notes` 标注「原话预览不可用」；**不得产出空题干**，**也不**归入 D8 失败关闭 | 单元（preview 为空的夹具 → 断言题干非空 ＋ notes 含标注） |

### 4.1 出口与不在出口

- 本条出口＝SC-01–SC-11 全部关闭。
- 客户端环境、Agent 路径、整库旅程、客户环境证据不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 旅程草稿（Journey Draft）— 导出产物的名称，指「由一段审计问询反推出的、尚未经人工确认的 Eval 用例草稿」。**须在 `webui/docs/00-product-terminology-standard.md` 登记后方可实现**（Plan S0 前置项）。
- 合成题干（Synthetic Question）— 草稿里的 `question` 字段内容，指按脱敏合成口径生成的题干，**不是**客户原话。与既有 `semantic_version: synthetic_v1` 同口径（`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:142`）。
- 原话指纹（Question Fingerprint）— 原话的 `question_hash`，用于回溯来源问询，**不可反推原文**。与审计侧既有 `question_hash` 同名同义，不新造译名。

本条不新增产品概念、不新增用户可见译名之外的文案；`tool_assertions` 与 8 个断言类型名沿用既有 runner 口径。

---

## 6. 非目标

- **本条无 WebUI 视觉／交互改动**：不新增页面、不新增 WebUI 端点、不改任何既有 WebUI 组件；导出面是服务端只读端点 ＋ 调用方显式落盘（D2）。
- 不做反向回放：不实现「Eval 用例 → 回放生产审计」（分支级 D4）。
- 不自动改工具面；不新增工具；不改数据面白名单（沿用 `webui/server/proxy/acl.ts:86-93`）。
- 不把客户原始问句直接落进 YAML（D3）。
- 不自动进池、不自动进跑批；不新建跑批队列。
- 不改 REQ-030-019（G2）的编辑器暴露面裁定；路径型断言仍**不可**在 WebUI 编辑。
- 不改 REQ-030-021（批量工具反哺通道）的任何部分。
- 不写审计库：导出是纯读操作（SC-08）。

## 7. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | `needs_review` 挡不住 CLI runner | §1.5；草稿并入 `evals/**` 后若忘记人工确认，WebUI 跑批仍会跑到它 | 运营纪律 + 后续可评估「CLI runner 读 `review_status`」的独立条目 |
| RES-02 | 阈值初值待定 | `TOOL_CALL_THRESHOLD` 与「数据面工具集」取值需 PM 确认（§3.2 备注） | Plan 开工前置 |
| RES-03 | 路径型断言不可在 WebUI 编辑 | 与 019 的分支级 D3 裁定同源；草稿须走 YAML 路径 | REQ-030-019 后续条目 |
| RES-04 | 合成题干可能与真实问句语义偏离 | 合成必然损失细节；草稿为「待人工确认」正是为此 | D6 ＋ SC-04 |

## 8. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 脱敏泄漏 | 把已脱敏的原话当「安全文本」直接落 YAML，仍是客户原话 | D3 强制合成题干；SC-04 用「原话全文子串不得出现在草稿」打假 |
| 把客户原句落库 | 落盘路径选错（直接写 `evals/**`），客户原句进 Git | D5 草稿区固定在 `inbox/eval-drafts/**`；SC-05 路径断言 ＋ SC-08 写审计零副作用 |
| 草稿被误当成已批准用例 | 草稿进 `evals/**` 后被跑批、被当基线 | D6 明确 `needs_review` 的边界；SC-06 选例断言；人工确认走既有 `confirm-review`（F11） |
| 反推出的断言判据不稳 | 阈值拍脑袋导致断言忽松忽紧 | D4 只用确定性信号 ＋ 可配常量；阈值在开工前定（RES-02）；SC-02 / SC-03 字段级比对 |
| 与 REQ-030-019 的暴露面不一致 | 草稿含路径型断言，而 019 编辑器不可编辑该类 | §1.6 依赖登记；草稿落地走 YAML 路径；019 D6 保证往返不丢 |
| 反推不出断言时被当成有效草稿 | 空断言草稿进了回归集，稀释覆盖 | D7 显式标注；SC-07 断言 |
| 读不到素材却产出半成品 | 问询无调用 / 无权限，导出仍给出「像样」的草稿 | D8 失败关闭；SC-01 / SC-08 |

## 9. 出处

- 需求池：[`REQ-030-020`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.3（缺口 G3）、§4（W3 波次）、§5（开工前置）、§9（决策点 D4）
- 配对条目：[`lucy-20261107-eval-tool-assertion-authoring-spec.md`](lucy-20261107-eval-tool-assertion-authoring-spec.md)（REQ-030-019）
- 落盘清单：[`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」
- 审计侧：[`webui/server/proxy/audit.ts`](../../webui/server/proxy/audit.ts)、[`webui/server/proxy/audit-privacy.ts`](../../webui/server/proxy/audit-privacy.ts)、[`webui/server/admin/audit.ts`](../../webui/server/admin/audit.ts)、[`webui/server/admin/audit-export-v2.ts`](../../webui/server/admin/audit-export-v2.ts)、[`docs/specs/lucy-20261104-audit-call-storyline-spec.md`](lucy-20261104-audit-call-storyline-spec.md)
- Eval 侧：[`webui/server/eval/cases.ts`](../../webui/server/eval/cases.ts)、[`webui/server/eval/offline-batch.ts`](../../webui/server/eval/offline-batch.ts)、[`webui/server/eval/runner.ts`](../../webui/server/eval/runner.ts)、[`scripts/eval/eval-runner.mjs`](../../scripts/eval/eval-runner.mjs)、[`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml`](../../evals/agent_reliability/eval/agent-reliability-eval-cases.yaml)
