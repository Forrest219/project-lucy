# Lucy 循环单查 → 批量／聚合工具反哺通道 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派台账号后再登记 |
| 需求池条目 | REQ-030-021（循环单查 → 批量／聚合工具反哺通道），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 配套 Plan | [lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md](../plans/lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 上游来源 | [分支计划 §3.4（G4）](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) |
| 依赖 | 建议在 REQ-030-019（断言编排面）之后；见 §2 D8 |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：跑批里被 `budget: max_repeated_tool_input` 判定的「对同一 ID 列表反复单查」，能被识别成一条**可评审的批量候选**条目（合成问句、重复输入指纹、调用次数、涉及工具、脱敏后的证据引用）并进入人工评审队列；评审结论只能回写为「升工具／补 skill／改 instructions／不处理」四类之一；无法判定重复模式时**失败关闭**——不入队、不静默。
- 本条出口：能打假这两条的检查——本机 Eval 跑批产物解析与候选派生的自动化（脱敏断言：队列全文不得出现任何原始输入值；幂等断言：同一产物重复派生结果一致），与队列条目结构／判定口径的仓库级断言。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级（客户环境）、镜像构建与客户交付。
- 上线关系：本条收口不表示可上线

---

## 1. 背景与取证

### 1.1 现行能力（已经有的部分）

| 编号 | 事实 | 位置 |
|---|---|---|
| F0 | `max_repeated_tool_input` 断言按「同一输入值出现次数」判失败；失败文案固定为 `budget: max_repeated_tool_input <tool>.<input_path> value=<value> actual=<n> max=<m>`，同时进 `failures` 与 `budgetFailures` 两个数组 | `scripts/eval/eval-runner.mjs:794-818`（文案拼装在 `:812`，入队在 `:813-814`） |
| F0b | 现有用例已用该断言：`tool: lucy_query`、`input_path: filters`、`max_per_value: 1` | `evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:147-155` |
| F1 | 跑批失败分类：`classifyFailures` 把含 `budget:` 的失败归为 `logic_regression`；`tool_error`／`schema_drift`／`data_drift` 是同一张词表的其余取值 | `scripts/eval/eval-runner.mjs:1455-1463` |
| F1b | WebUI 侧同口径分类 `classifyDrift` | `webui/server/eval/runner.ts:127-138` |
| F1c | 分类结果落库到 `failure_classification` 列 | `webui/server/eval/db.ts:51` |
| F2 | 每个用例的跑批条目已带 `toolCalls`（**原始输入**）与 `toolSummary`（`byTool` / `inputValueCounts`） | `scripts/eval/eval-runner.mjs:1802-1803`；`summarizeToolCalls` 在 `:680-713` |
| F3 | 跑批产物写 `.ktx-ui/eval/latest.{md,json}`；`.ktx-ui/` 已在 gitignore 内 | `scripts/eval/eval-runner.mjs:2097-2100`；`.gitignore:81` |
| F4 | 用例集由 `--cases` **显式指路**加载，不做目录扫描 | `scripts/eval/eval-runner.mjs:33`、`:110-111`、`:2056` |
| F5 | 跑批条目**不含**问句原文（`id`／`pass`／`failures`／`toolCalls`／`finalText` 等，无 `question` 字段）；问句只存在于用例 YAML | `scripts/eval/eval-runner.mjs:1775-1803`；多轮用例的条目 id 形如 `<caseId>#turn-<turn_id>`（`:1813`） |
| F6 | Lucy 侧**已有**批量表达能力：`lucy_query` 的 `dimensions` / `order_by` 是**对象数组**、`filters` 可用**字符串数组或结构化对象数组**（Proxy 会把结构化对象转成上游 filter string）；`measures` 是 **source-qualified 字符串**（数组承载，元素形如 `source.measure`），不是对象数组 | `webui/config/data-qa-instructions.md:58-65`（measures 字符串形态见 `:60`，dimensions/order_by 数组见 `:61`，filters 双形态见 `:62`）|
| F7 | 截断时已有「结果已截断，改为聚合后再取明细。」提示 | `webui/server/proxy/question-experience.ts:1039` |

### 1.2 缺口

`max_repeated_tool_input` 能**检出**循环单查，但检出之后没有任何机制把它变成「升一级批量工具／写一条 skill／改工具描述」——没有队列、没有判定口径、没有评审结论回写位。缺的是**把失败模式反哺成工具面改动的闭环**，而不是查询能力本身（F6／F7 已具备）。

### 1.3 三处约束本条设计的事实（取证）

**G1（形状塌缩）**：`max_repeated_tool_input` 的计数键是 `String(inputValueAtPath(call.input, input_path))`（`scripts/eval/eval-runner.mjs:803-812`）。当 `input_path` 指向**对象数组**（现行用例即 `filters`）时，`String([{...}])` 恒等于 `"[object Object]"`——**等长的不同 filter 集合塌缩进同一个计数桶**，失败文案里的 `value=` 既区分不出是哪一组 filter，也无法从中还原「重复的是哪一组输入」。⚠️ **塌缩只发生在等长集合**：`String()` 对数组按元素 join，`String([{a:1}])` ≠ `String([{a:1},{b:2}])`（前者 `"[object Object]"`、后者 `"[object Object],[object Object]"`）——**长度不同则键不同**。故 SC-04 的前提须限定为「**等长的不同 filter 集合**」。

> **来源标注**：G1／G2 标为「本机实测」，但实测产物在**仓外**（`.ktx-ui/` 被 `.gitignore:81` 忽略，仓内无跑批产物留存）。⇒ **推断，待首跑复核**：本条的验收必须以首跑产物为准，不得把 G1／G2 当作既成事实直接引用。

⇒ 结论一：**现行失败文案不能充当「重复输入指纹」**。指纹必须从 `toolCalls` 的原始输入**重新计算**（F2 提供原料）。

**G2（明文泄漏面）**：同一个键取自**原始输入值**。当 `input_path` 指向标量叶子（如 `filters.0.value`），失败文案会直接印出业务值——本机实测输出 `"ACME"`（同为仓外实测，**待首跑复核**）。同一份 `latest.json` 的 `toolCalls` 里也是原始输入（F2）。

⇒ 结论二：队列**不得**复用失败文案作为证据，**不得**把 `toolCalls` 原样复制进队列；证据引用必须脱敏到「用例 id + 调用序号 + 指纹」这一层。

**G3（问句不在产物里）**：跑批条目不带问句（F5），问句只在用例 YAML。

⇒ 结论三：候选条目的问句必须由 `case_id` 回连用例文件取得；用例集是**脱敏合成**的（`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:13` 声明「不包含客户原始问句或业务明细」），因此回连得到的是**合成问句**，**天然不含客户原话**。⇒ 条目里的字段名 `question_ref` 与 SC-02 一律按「**合成问句**」表述，**不得**写成「原始问句」——两者所指不同，混写会让复核者误以为队列里带的是客户原话。

### 1.4 未核实（证据不在仓）

| 编号 | 待验项 | 状态 |
|---|---|---|
| U1 | 2026-11-07 之前是否有跑批实际命中 `budget: max_repeated_tool_input` | **未核实（证据不在仓）**——仓内只有断言用例（`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:151-155`）与单元断言（`scripts/eval/eval-runner.test.mjs:280-281`），无实跑产物 |
| U2 | `latest.json` 中 `toolCalls` 的实际体积、是否被裁剪或已含凭据字段 | **未核实（证据不在仓）**——`.ktx-ui/` 被 gitignore（`.gitignore:81`），仓内无样本产物 |
| U3 | 循环单查在真实 Agent 上的发生率与典型调用次数分布 | **未核实（证据不在仓）**——本条阈值取保守默认值，须在首批跑批后按实测校准 |

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | 队列形态＝**文件型评审队列**，落 `.ktx-ui/eval/bulk-candidates.json`（与 `latest.json` 同目录，F3） | 队列是跑批产物而非回归用例；放 `evals/**` 会被误当用例集（虽然 runner 按 `--cases` 指路不扫描，F4，但语义上会污染回归集） |
| D2 | 评审结论**先**回写队列条目（`decision` / `decision_note` / `decided_at`），**再**由人工誊写到版本化评审记录（`docs/reviews/`） | 队列在运行期目录、会被覆盖；结论必须另有版本化落点才可追 |
| D3 | **不改现有失败分类词表**：`logic_regression` / `tool_error` / `schema_drift` / `data_drift` 一律不动（F1／F1b／F1c）；候选队列是**旁路**，不占用 `failure_classification` 列 | REQ-030-019 已定「不改 runner 断言语义与既有失败文案（`budget: ...` 前缀保持）」；分类词表是跑批与 DB 的既有合同 |
| D4 | 指纹**重算**、**去明文**：指纹 = `sha256(规范化输入)` 前 16 hex；规范化对**值**只保留类型与长度占位，不留明文 | G1 要求重算、G2 要求去明文 |
| D5 | 「可批量」判定用**形状**不用值：同一工具、同一组 `(field, op)`、每次调用只带 1 个 ID 元素、调用次数 ≥ 阈值 → 形状候选 | 「对同一 ID 列表反复单查」的本质是**形状重复**（每次一个 ID），值本身正是要批量化的对象 |
| D6 | **失败关闭**：判定所需的任一输入不可得（输入缺失／非对象／不可规范化／分组混型）→ **不生成候选条目**，计入 `undecidable` 并在跑批输出里显式报出，**不得静默入队** | 候选队列若静默吞掉不可判定项，会让人以为「没有循环单查」 |
| D7 | **只登记队列与判定口径，不自动改工具面** | 池内落法明写；自动改工具面等于让一次跑批静默改生产行为 |
| D8 | 本条排在 **REQ-030-019（G2）之后** | 断言编排面先可用，「同一 filter 不得重复查」才有人能写、有人能看见 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：候选生成（离线，从跑批产物派生）

```text
# 位置：scripts/eval/eval-runner.mjs 新增派生步骤（读 .ktx-ui/eval/latest.json）
# 输入：summary.cases[]（每条含 toolCalls / budgetFailures / id）
#         ⚠️ 不是 summary.entries[] —— 跑批汇总的键是 `cases`（eval-runner.mjs:1952 `cases: entries`），
#            latest.json 落的是 JSON.stringify(summary)（:2097-2100）
# 输出：.ktx-ui/eval/bulk-candidates.json（D1）
# 本流程**只读**产物、**只写**队列文件；不碰工具面（D7）

function deriveBulkCandidates(summary, casesById):
    candidates = []
    undecidable = []                    # D6：不可判定的一律不入队

    for entry in summary.cases:
        # (a) 只认这一类失败；其它 budget 类型不进队列
        repeated = (entry.budgetFailures or []).filter(f -> f.startsWith("budget: max_repeated_tool_input"))
        if repeated is empty:
            continue

        # ⚠️ 工具名口径：跑批**直连原始 KTX MCP**（eval-runner.mjs:20 → http://localhost:7878/mcp），
        #    记录里的工具名一律带 `mcp__ktx__` 前缀（如 `mcp__ktx__sl_query`），**不是** Proxy 侧的
        #    `lucy_query`（Proxy 侧的映射是 `lucy_query` ↔ 上游 `sl_query`，见
        #    webui/docs/09-lucy-r1-mcp-tool-contract.md:201 与 scripts/smoke/p1-agent-e2e.test.mjs:151）。
        #    故白名单必须同时容纳两侧名：{lucy_query, sl_query}，短路名后匹配。
        calls = (entry.toolCalls or []).filter(c => shortToolName(c.name) in ("lucy_query", "sl_query"))
        if calls is empty:
            undecidable.push({ case_id: entry.id, reason: "no_query_call" })
            continue

        # (b1) 逐次调用算「脱敏指纹」（D4）与「批量形状」（D5）
        obs = []
        for call in calls:
            fp = fingerprintOf(call.input)
            if fp is null:
                undecidable.push({ case_id: entry.id, reason: "input_not_normalizable" })
                continue
            shape = batchShapeOf(call.input)
            if shape is null:
                undecidable.push({ case_id: entry.id, reason: "shape_not_normalizable" })
                continue
            obs.append({ tool: shortToolName(call.name), fp: fp, shape: shape, call_index: indexOf(calls, call) })

        if obs is empty:
            continue                    # 全部不可判定 → 不入队（D6）

        # (b2) 按形状分组：同形状的多次调用 = 一条候选
        for shapeKey, group in groupBy(obs, o => o.shape.key):
            if group.length < BULK_MIN_CALLS:          # 阈值默认 3（U3 待校准）
                continue                             # 次数不够 → 不是循环单查
            if not shapeIsSingleValued(group[0].shape):
                continue                             # 每次带多个 ID → 本就不是单查

            distinctFp = unique(group.map(o => o.fp))
            # 同形状下，若各次取值互不相同 → 「对同一 ID 列表反复单查」；
            # 若取值完全相同 → 「同一输入重复」，同样是候选。
            # 两种都接受；无法归类 → 失败关闭。
            if distinctFp.length not in (1, group.length):
                undecidable.push({ case_id: entry.id, reason: "shape_group_mixed" })
                continue

            # (b3) 生成候选条目（五要素齐备）
            candidates.append({
                id: candidateId(entry.id, shapeKey),
                case_id: entry.id,
                question_ref: questionRefOf(entry.id, casesById),   # G3：回连用例取**合成问句**（非客户原话）
                input_fingerprints: distinctFp,                     # 只落哈希，不落值（D4）
                batch_shape: shape.describe,                        # 字段名/op/元素个数，不含值（D5）
                call_count: group.length,
                tools: unique(group.map(o => o.tool)),
                evidence_refs: group.map(o => ({                    # 脱敏证据引用（G2）
                    call_index: o.call_index,
                    fingerprint: o.fp
                })),
                decision: "pending",                                # 四类之一，待评审（D2）
                decision_note: null
            })

    # (c) 进入人工评审队列（D1）：写文件，不进 evals/**，不改工具面
    writeQueue(".ktx-ui/eval/bulk-candidates.json", { candidates: candidates, undecidable: undecidable })
    reportUndecidable(undecidable)        # D6：不可判定必须显式报出，不得静默
    return { candidates: candidates, undecidable: undecidable }
```

**规范化与指纹（D4）**：

```text
function fingerprintOf(callInput):
    normalized = normalizeInput(callInput)
    if normalized is null: return null
    return "sha256:" + sha256(canonicalJson(normalized)).hex.slice(0, 16)

function normalizeInput(callInput):
    if callInput is not object: return null
    out = {}
    for key in ["measures", "dimensions", "order_by", "filters"]:
        if key not in callInput: continue
        out[key] = normalizeArray(callInput[key])
    return out or null                  # 没有查询语义位 → 不可规范化

function normalizeArray(value):
    if value is not array: return { kind: "scalar", type: typeOf(value) }   # 只留类型
    items = value.map(v => normalizeItem(v))
    items = sortBy(items, canonicalJson)   # 顺序无关
    return { kind: "array", size: items.length, items: items }

function normalizeItem(item):
    if item is object:
        out = {}
        for field in ["field", "op", "source"]:                # 语义层对象名：保留
            if field in item: out[field] = String(item[field])
        for field in ["value", "values"]:                      # 业务值：去明文，只留占位
            if field in item:
                out[field] = placeholderOf(item[field])        # "<str:12>" / "<num>" / "<bool>" / "<null>"
        # ⚠️ 未知键不得丢弃：只留 field/op/source/value 的子集时，
        #    「含业务字段但无这些键」的对象会归一化成 {} —— 不同业务语义得同一指纹，
        #    与 SC-04「不同 filter 集合应得不同指纹」的意图相反。
        #    故：未识别的键保留**键名 + 类型占位**（不保留值），使其仍可区分。
        for field in keys(item) not in ["field", "op", "source", "value", "values"]:
            out["~" + field] = placeholderOf(item[field])      # "<str:12>" / "<num>" / "<bool>" / "<null>" / "<obj>"
        return out
    return placeholderOf(item)                                 # 标量数组元素：只留类型与长度
```

> 说明：`field` / `op` / `source` 是语义层对象名，不是业务数据，保留后可读；**一切 `value` 一律去明文**（G2）。规范化对**对象数组逐元素**展开，因此两个语义不同的 filters 集合得到**不同**指纹——这正是 G1 要求重算的原因。⚠️ 未知键以 `~<键名>` 形式保留键名＋类型占位：既不泄漏值，也不让不同业务语义塌成同一指纹。

**批量形状（D5）**：

```text
function batchShapeOf(callInput):
    filters = callInput.filters
    if filters is not array or filters is empty: return null

    # ⚠️ 两种 filters 形态必须都支持：
    #    ① 结构化对象元素：{field, op, source, value|values} —— Proxy 侧形态
    #    ② 字符串元素："field op value" —— **上游 KTX 形态**。跑批直连 :7878 的原始 KTX MCP
    #       （eval-runner.mjs:20），Proxy 把上游 sl_query 转发前会把 filters 规范化为 string
    #       （webui/docs/09-lucy-r1-mcp-tool-contract.md:201）。故跑批侧实际看到的多半是 ②。
    #    若只认 ①，形状恒不可判定 → 候选恒 0 → SC-04 不成立。
    sig = filters.map(f => canonicalFieldOp(f)).sort()
    if any sig entry is null: return null                       # 形状不可判定

    # ⚠️ key 必须含**元素数**维度：只由 field/op 组成时，1 元素与 3 元素的 filters
    #    落同一个 key 并被合并成一条候选（形状被抹平）。故 key = 签名 + 元素数。
    return {
        key: sig.join("&") + "#n=" + String(filters.length),
        singleValued: filters.every(f => valueCountOf(f) == 1),  # 每次只带 1 个 ID
        describe: { fields: unique(sig), value_counts: filters.map(valueCountOf) }
    }
```

### 3.2 流程 2：评审结论回写（四类，且不改工具面）

```text
# 位置：评审侧（人工/受控脚本），只写队列文件与版本化评审记录
# 规则：结论只能四类之一；回写**不触发**任何工具面改动（D7）

ALLOWED_DECISIONS = ["upgrade_tool", "add_skill", "update_instructions", "no_action"]

function reviewCandidate(candidate, decision, note, reviewer):
    if decision not in ALLOWED_DECISIONS:
        return { ok: false, reason: "decision_not_allowed" }   # 失败关闭：不入队、不改写
    if candidate.decision != "pending" and candidate.decision != decision:
        return { ok: false, reason: "decision_already_fixed" }  # 结论不可被静默改写
    candidate.decision = decision
    candidate.decision_note = note
    candidate.decided_by = reviewer
    candidate.decided_at = now()
    writeQueue(".ktx-ui/eval/bulk-candidates.json", queue)     # D2 第一落点

    # 结论只产生「待办登记」；真正改工具面是**另一条** Spec 的事
    if decision == "no_action":
        return { ok: true, followup: null }
    return { ok: true, followup: registerFollowup({            # 登记到待办，不执行
        candidate_id: candidate.id,
        kind: decision,
        evidence: candidate.evidence_refs
    })}
```

### 3.3 流程 3：不自动改工具面（边界断言）

```text
# 位置：门禁（对流程 1＋流程 2 的全流程做前后摘要比对）

function assertToolSurfaceUntouched(beforeDigests, afterDigests):
    # 工具注册表、skill 文件、instructions 文件的摘要必须逐一相等
    # ⚠️ 路径必须是**真实具体路径**（占位符名不可执行、不可判定）：
    #    ① 工具注册表 = `webui/server/proxy/acl.ts`（工具全集在 DEFAULT_KNOWN_TOOLS，:161-168，
    #       由 ABSOLUTE_DENY_TOOLS ＋ DATA_PLANE_TOOLS ＋ META_TOOLS ＋ CONTROL_PLANE_TOOL_NAMES 组成）
    #    ② skill 文件 = `.cursor/skills/**`（本仓 skill 目录；逐文件取摘要）
    #    ③ instructions = `webui/config/data-qa-instructions.md`
    for path in ["webui/server/proxy/acl.ts",
                 ".cursor/skills/**",
                 "webui/config/data-qa-instructions.md"]:
        if beforeDigests[path] != afterDigests[path]:
            return { ok: false, reason: "tool_surface_mutated", path: path }
    return { ok: true }
```

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 只认 `budget: max_repeated_tool_input`：`max_total_tool_calls` / `max_tool_calls` / `max_tool_calls_by_input` 命中的用例**不**生成候选 | 单元（构造四类 budget 失败，只断言第一类产生候选） |
| SC-02 | 候选条目五要素齐备：**合成问句**（由 `case_id` 回连用例文件取得，非客户原话）、重复输入指纹、调用次数、涉及工具、脱敏证据引用 | 单元（对固定 `latest.json` 夹具断言条目字段全集） |
| SC-03 | **脱敏**：夹具里的业务值（如 `"ACME"`）在队列文件全文中**不出现**；只有 `sha256:` 指纹与类型占位 | 单元（全文正则扫描） |
| SC-04 | **不塌缩**：两个语义不同的 filters 集合得到**不同**指纹（现行 `String()` 口径会得到相同值，见 G1） | 单元（同工具、同连接、filters 字段不同 → 指纹不等） |
| SC-05 | **失败关闭**：输入缺失／非对象／不可规范化时**不生成**候选条目，且 `undecidable` 计数 > 0 并在跑批输出里显式报出 | 单元（注入四类坏输入，断言候选数 = 0 且 undecidable > 0） |
| SC-06 | **幂等**：同一份 `latest.json` 连续派生两次，候选集合、指纹、`call_count` 完全一致 | 单元（两次派生结果深比较） |
| SC-07 | 队列**不进回归集**：派生过程不写 `evals/**` 任何文件；`--cases` 路由与用例集合不变 | 单元（跑批前后 `evals/**` 摘要不变） |
| SC-08 | 现有合同不回归：含 `budget:` 的失败仍归 `logic_regression`；`failure_classification` 取值集合不新增；失败文案前缀 `budget: max_repeated_tool_input ...` 不变 | 单元（分类与文案断言）＋ 既有 `scripts/eval/eval-runner.test.mjs` 全绿 |
| SC-09 | 评审结论四类齐备：每条候选的 `decision` ∈ {`upgrade_tool`, `add_skill`, `update_instructions`, `no_action`}；非法值被拒；已定结论不被静默改写 | 单元（回写与拒绝路径） |
| SC-10 | **不自动改工具面**：派生＋回写全流程后，工具注册表、skill 文件、`webui/config/data-qa-instructions.md` 的摘要逐一未变 | 单元（前后摘要比对，即 §3.3） |

### 4.1 出口与不在出口

- 本条出口＝SC-01–SC-10 全部关闭。
- 客户端环境、Agent 真实路径、整库旅程、客户环境证据不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `bulk_candidate` — 机器队列条目（批量候选）。对应既有语义「循环单查」／「失败预算」，**不新造用户可见译名**；本条无 WebUI 呈现面，无用户可见文案。须在术语标准登记后方可实现。
- `undecidable` — 机器计数项（不可判定）。语义：候选判定所需输入不可得，按 D6 失败关闭、不入队。**不新造用户可见译名**。
- `input_fingerprint` — 机器字段（重复输入指纹）。语义：`sha256(规范化输入)` 前 16 hex，**不含明文业务值**。与既有 `traceId`（术语标准已登记，`webui/docs/00-product-terminology-standard.md:646`）同属机器标识族，须在 DOM 呈现时加 `translate="no"` + `notranslate`（若将来有 UI 面）。

本条不新增产品概念、不新增 WebUI 文案；`budget:` 前缀、`max_repeated_tool_input` 断言名、`logic_regression` 分类值均为既有字面量，本条不改。

---

## 6. Design System Compliance

本条**无 WebUI 视觉／交互改动**：队列是运行期文件（`.ktx-ui/eval/bulk-candidates.json`，D1），评审在管理端之外完成，不新增页面、组件、布局或交互。为保持门禁口径一致，仍按四段式登记如下。

### Referenced Specs

- `webui/docs/design-system/README.md`（Governance：状态与错误码呈现规则）
- `webui/docs/00-product-terminology-standard.md`（机器标识与 reason code 的呈现防御）

### What This Change Follows

- 不新增视觉模式、不新增组件、不改布局、不改交互；无移动端／窄屏表现。
- 若将来把队列搬到 WebUI 呈现，机器标识（`sha256:` 指纹、`case_id`、`decision` 枚举值）须沿用既有 `translate="no"` + `notranslate` 防御，本条不预埋 UI。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- `bulk_candidate` / `undecidable` / `input_fingerprint` 三个机器名须在术语标准登记（Plan S0 前置项）。

---

## 7. 非目标

- **不自动新增工具、不自动改工具面**（D7）：不写工具注册表、不写 skill、不改 `webui/config/data-qa-instructions.md`；结论只产出待办登记。
- **不放松白名单 SQL**：不让 Agent 临场写任意查询来「绕开」单查。
- **不新增查询能力**：`lucy_query` 的 `measures` / `dimensions` / `filters` 已是数组（F6），本条不扩参数。
- **不做从 Eval 反向回放生产审计**：不读生产问询来生成候选。
- **不改 runner 断言语义与既有失败文案**：REQ-030-019 的非目标延续（`budget: ...` 前缀保持，D3）。
- **不把「队列有候选」表述成工具面已改**：队列存在 ≠ 工具面已升级。
- **不自动跑批、不自动进回归集**：候选只进评审队列，不进 `evals/**`（D1）。

## 8. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | 现行 `max_repeated_tool_input` 在 `input_path` 指向对象数组时会把不同输入塌缩进同一计数桶（G1） | 本条**不修**检测器（F0 是既有断言合同），只在派生侧用重算指纹绕开；检测器本身的缺陷另立条目 | 后续条目，待与 REQ-030-019 一并评估 |
| RES-02 | 失败文案在 `input_path` 指向标量叶子时含业务明文（G2） | 同上；本条只保证**队列**不泄漏，不改既有文案 | 后续条目 |
| RES-03 | 阈值 `BULK_MIN_CALLS` 默认值未经实跑校准（U3） | 首批跑批后按实测分布调整；调整只改常量，不改判定结构 | Plan S4 收口时校准 |
| RES-04 | 队列落运行期目录，`.ktx-ui/` 被 gitignore（F3） | 队列**不是**长期资产；长期资产是评审记录（D2） | 本条内已处理 |

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 候选队列变成自动改工具的暗门 | 队列一旦能触发工具面改动，跑批就会静默改变生产行为 | D7 ＋ SC-10（前后摘要比对）＋ 结论只登记待办（§3.2） |
| 脱敏泄漏 | 指纹若从原始输入直接取哈希而不去明文、或把 `toolCalls` 原样复制，队列会带出业务值 | D4 规范化去明文 ＋ SC-03 全文扫描 ＋ 证据引用只到「调用序号 + 指纹」层（G2） |
| 形状塌缩被当成真判定 | 若直接复用失败文案的 `value=`，不同 filter 会被混为一谈（G1） | D4 重算 ＋ SC-04 指纹不等断言 |
| 候选不可判定被静默吞掉 | 不可判定项不入队，若不报出会被读成「没有循环单查」 | D6 失败关闭 ＋ SC-05 断言 `undecidable > 0` 且显式报出 |
| 分类词表被改动，连带影响既有合同 | 新增分类值会波及 `failure_classification` 列与允许清单 | D3 不动词表 ＋ 旁路设计 ＋ SC-08 |
| 误把「工具面已升级」当成本条已交付 | 评审结论与实际改动之间隔着另一条 Spec | §7 明写 ＋ 完成定义里「结论≠改动」 |
| 阈值过松导致候选泛滥 | 默认阈值 3 若遇高频重试型用例会大量入队，评审成本上升 | RES-03 待校准 ＋ 候选条目只带摘要不带全量证据 |
| 与 REQ-030-019 争同一文件 | 两者都可能动 `scripts/eval/eval-runner.mjs` | 开工前对照批次地图确认归属；同一文件同一时刻只允许一个写入方 |

## 10. 出处

- 需求池：[`REQ-030-021`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.4（G4）、§4 波次顺序、§5 开工前置
- 实施 Plan：[`lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md`](../plans/lucy-20261107-eval-failure-to-tool-surface-feedback-plan.md)
- 现行实现：[`scripts/eval/eval-runner.mjs`](../../scripts/eval/eval-runner.mjs)、[`webui/server/eval/runner.ts`](../../webui/server/eval/runner.ts)、[`webui/server/eval/db.ts`](../../webui/server/eval/db.ts)
- 运行时指导源：[`webui/config/data-qa-instructions.md`](../../webui/config/data-qa-instructions.md)
- Eval / Quiz 约定：[`docs/governance/eval-quiz-conventions.md`](../governance/eval-quiz-conventions.md)
- 用例集：[`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml`](../../evals/agent_reliability/eval/agent-reliability-eval-cases.yaml)
