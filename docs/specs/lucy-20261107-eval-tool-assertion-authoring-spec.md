# Lucy Eval 路径断言在 WebUI 侧可编排 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派台账号后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只登记设计与验收口径，不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 需求池条目 | REQ-030-019，来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 配套 Plan | [lucy-20261107-eval-tool-assertion-authoring-plan.md](../plans/lucy-20261107-eval-tool-assertion-authoring-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 分支级决策 | D3＝**(b) 先补 4 个预算型**（`max_total_tool_calls` / `max_tool_calls` / `max_repeated_tool_input` / `max_tool_calls_by_input`）；路径型随 G1 稳定后再上。委托人 2026-11-07 裁定，本 Spec 直接采用，不再回头问 |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：管理员在 WebUI 用例编辑器里能新增、编辑、保存并导出路径（工具）断言，写出的 YAML 字段无损，跑批能按该断言判失败；写入前端不支持或不合法的断言类型时，保存与导出**一律报错**，不得静默丢弃。
- 本条出口：能打假这一条的检查——本机自动化（类型与编辑器往返、保存校验、跑批判定、既有断言回归）＋ CI job。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级
- 上线关系：本条收口不表示可上线

补充说明：镜像构建、客户交付、真实客户环境证据均不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。

---

## 1. 背景与取证

### 1.1 缺口性质：编排面缺，执行面不缺

路径断言的**判定能力在 runner 侧已经完备**。`scripts/eval/eval-runner.mjs:720` 起是 `checkToolAssertions(toolCalls, assertions)`，逐条按 `type` 分派；未知类型落在函数末尾的兜底分支（`scripts/eval/eval-runner.mjs:841`）。

缺口只在**三个编排面**，逐条取证如下（行号为本 Spec 编写时实际打开核对的行）：

| 编号 | 事实 | 位置 |
|---|---|---|
| F1 | 前端 `ToolAssertion` 只声明 4 型路径断言：`required_tool` / `forbidden_tool` / `required_tool_input_regex` / `forbidden_tool_input_regex`；**4 个预算型一个都没有** | `webui/src/lib/types.ts:2081-2086` |
| F2 | 前端 `EvalCase` **没有** `tool_assertions` 字段（用例编辑器消费的正是这个类型） | `webui/src/lib/types.ts:1949-1971` |
| F3 | 用例编辑器的页签只有 7 个：`meta` / `question` / `sql` / `result` / `advanced` / `yaml` / `raw`，**无工具断言入口** | `webui/src/pages/eval/CaseEditor.tsx:147-155` |
| F4 | 断言编辑区只有「SQL 断言」与「结果断言」两段，`sql_assertions` 与 `result_assertions` 各有独立编辑块 | `webui/src/pages/eval/CaseEditor.tsx:474-660` |
| F5 | 服务端 `EvalCase` **没有** `tool_assertions` 字段 | `webui/server/eval/cases.ts:33-64` |
| F6 | 服务端保存用例只校验「问法不能为空」，**对断言字段无任何校验** | `webui/server/eval/cases.ts:291-293` |
| F7 | 服务端写盘是整对象写入（`doc.createNode(caseData)`），不存在字段白名单 | `webui/server/eval/cases.ts:173` |
| F8 | 用例文件固定路径 `evals/{domain}/eval/{domain}-eval-cases.yaml` | `webui/server/eval/cases.ts:113` |
| F9 | 「YAML 预览」页签直接序列化表单对象（`yamlStringify(form)`） | `webui/src/pages/eval/CaseEditor.tsx:700-708` |
| F10 | 编辑器保存走 `POST` / `PUT /api/eval/cases/...` | `webui/src/pages/eval/CaseEditor.tsx:105-110`、`webui/server/eval/cases.ts:412-445` |

### 1.2 数据不丢——所以是编排面缺口，不是执行面缺口

| 编号 | 事实 | 位置 |
|---|---|---|
| F11 | legacy → canonical 归一化是整字段展开（`...record` 原样透传未知字段） | `webui/server/eval/suite-import.ts:140-158` |
| F12 | `canonicalizeInner` 不做字段白名单过滤，只排序键并剔除 `suite_hash` | `webui/server/eval/suite-schema.ts:392-412` |
| F13 | WebUI 跑批确实调 CLI runner：`["scripts/eval/eval-runner.mjs", "--cases", casesPath, ...]` | `webui/server/eval/runner.ts:322` |
| F14 | runner 侧读取用例的 `tool_assertions`（case 级 + turn 级 + `context_assertions` 级三处汇聚） | `scripts/eval/eval-runner.mjs:1608-1609`、`scripts/eval/eval-runner.mjs:1653` |

结论：既有 YAML 里的预算型断言**今天就能跑**，只是管理员在 WebUI 里既看不到、也写不了。**本条只补编排面，不碰执行面。**

### 1.3 计数口径更正（须在评审时确认）

分支计划与需求池条目都写「runner 支持 **7 型**工具断言」，但同两处各列了 **8 个**类型名。以 runner 代码为准，`checkToolAssertions` 实际分派 **8 型**：

- 路径型 4 型：`required_tool`、`forbidden_tool`、`required_tool_input_regex`、`forbidden_tool_input_regex`
- 预算型 4 型：`max_total_tool_calls`、`max_tool_calls`、`max_repeated_tool_input`、`max_tool_calls_by_input`

**口径现状（2026-11-07 复核）**：分支计划已更正为 8 型（`docs/plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md:38`、`:99`，含「2026-11-07 复核更正」注记）；**需求池条目正文仍写 7 型**（`docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md:478`、`:482`）。本 Spec 一律按 **8 型**叙述；池条目的更正由索引维护方处理，本 Spec 不代改。

### 1.4 预算型的字段合同（与 runner 逐条对齐）

失败关闭必须用**同一份字段口径**，否则会出现「WebUI 放行、runner 判 `unsupported tool_assertion`」的错位。以下取值直接来自 runner：

| 类型 | 必填字段 | runner 校验行 | 缺字段时的既有文案 |
|---|---|---|---|
| `max_total_tool_calls` | `max`（数值） | `scripts/eval/eval-runner.mjs:765-767` | `unsupported tool_assertion: <type>: <value> missing numeric max` |
| `max_tool_calls` | `tool`（缺时回落 `value`）、`max`（数值） | `scripts/eval/eval-runner.mjs:779-782` | `unsupported tool_assertion: ... missing tool or numeric max` |
| `max_repeated_tool_input` | `tool`、`input_path`、`max_per_value`（缺时回落 `max`） | `scripts/eval/eval-runner.mjs:795-799` | `unsupported tool_assertion: ... missing tool, input_path, or numeric max_per_value` |
| `max_tool_calls_by_input` | `tool`、`input_path`、`value`、`max`（数值） | `scripts/eval/eval-runner.mjs:821-826` | `unsupported tool_assertion: ... missing tool, input_path, value, or numeric max` |

### 1.5 既有用例已在用预算型

`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:147-155` 已在用 `max_total_tool_calls` 与 `max_repeated_tool_input`；同文件 `:13` 的 `scope` 明确「脱敏合成……**不包含客户原始问句或业务明细**」，`:142` 的 `semantic_version: synthetic_v1`。这两条是 REQ-030-020 的脱敏口径依据（见该条 Spec），也是本条「既有 4 型断言回归不破」的样本。

---

## 2. 设计决策

> 编号说明：本节 `D1…D8` 是**本 Spec 的冻结决策**；分支级拍板点是 `D3`（见头部元数据），两者不是同一组。

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | 本条在**类型层**补齐全部 8 型（既有 4 路径型保留 ＋ 新增 4 预算型）；在**编辑器 UI 层**只暴露 4 个预算型 | 落实分支级 D3：类型必须能表示现有 YAML 正在用的预算型；路径型的**编辑**留待 G1 稳定后另立条目 |
| D2 | 断言类型清单**单一登记在服务端**（新增 `webui/server/eval/tool-assertions.ts`），前端复用该清单派生联合类型 | 消除三处硬编码漂移。既有先例：前端组件直接 `import` 服务端常量（`webui/src/components/audit-trust/ReadonlySqlRowset.tsx:21`）。若实施时因打包边界无法 `import`，退化为「前端镜像 ＋ CI 一致性断言」，**二者择一必须落一个**，不得放任两份手写清单漂移 |
| D3 | 服务端 `EvalCase` 补 `tool_assertions?: ToolAssertion[]`；前端 `EvalCase` 同步补 | F2 / F5 是同构缺口，一处补一处不补则类型链断裂 |
| D4 | **失败关闭在服务端保存处强制**：`addCase` / `updateCase` 校验断言类型与字段合法性，非法即拒绝并回错误码 | 唯一强制点。编辑器的客户端校验只做体验优化，**不作为安全边界**；Raw JSON 页签绕过表单也必须被服务端拦住 |
| D5 | 失败关闭复用既有 `InvalidCaseSchemaError` 家族（`code = "INVALID_CASE_SCHEMA"`、`statusCode = 422`），不新造 HTTP 语义 | 既有错误通道已存在（`webui/server/eval/cases.ts:98-105`），不新增错误码族 |
| D6 | **路径型断言在编辑器里只读保留、不得丢弃**：打开既有用例时如实展示为「本条不支持编辑」，保存时原样带回 | D1 的直接后果。若编辑器把不支持的类型从表单模型里剔掉，保存就会静默删数据——这正是本条要禁止的行为 |
| D7 | 不改 runner 断言语义与既有失败文案（`budget: ` 前缀、`unsupported tool_assertion: ` 前缀保持原样） | 需求池 REQ-030-019 非目标明列；改文案会让既有跑批结果比对失真 |
| D8 | 数据不丢靠既有归一化与 canonicalize 承担（F11 / F12），本条**不改**这两处 | 只补编排面，避免把「类型补齐」扩大成「改导入管线」 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：断言类型清单与三处类型对齐

```text
# 位置：webui/server/eval/tool-assertions.ts（新增，单一事实源）
# 目标：8 型全集 + 预算型必填字段合同，三处（服务端类型 / 前端类型 / 编辑器）同源

PATH_TYPES = ["required_tool", "forbidden_tool",
              "required_tool_input_regex", "forbidden_tool_input_regex"]
BUDGET_TYPES = ["max_total_tool_calls", "max_tool_calls",
                "max_repeated_tool_input", "max_tool_calls_by_input"]
KNOWN_TYPES = PATH_TYPES + BUDGET_TYPES          # 8 型全集（runner 同口径）

# 本条编辑器**可编辑**集合（分支级 D3＝先补 4 个预算型）
EDITORIAL_TYPES = BUDGET_TYPES

# 预算型必填字段合同：与 scripts/eval/eval-runner.mjs:765-826 逐条对齐
# ⚠️ 必须照 runner 的**回落规则**写，不能写成严格必填：
#    max_tool_calls 的 tool 缺失时回落 value（:779 `String(a.tool || value || '')`）；
#    max_repeated_tool_input 的 max 缺失时回落 max_per_value（:797 `numericLimit(a.max_per_value, numericLimit(a.max))`）。
#    写成严格必填会把 runner 判合法的断言判非法（假失败）。
BUDGET_FIELD_CONTRACT = {
  "max_total_tool_calls":   require("max"),                       # runner :765-767
  "max_tool_calls":         require("tool" | "value", "max"),      # runner :779-782（tool 缺时回落 value）
  "max_repeated_tool_input":require("tool" | "value", "input_path", "max_per_value" | "max"),
                                                                            # runner :795-799（tool 回落 value；max 回落 max_per_value）
  "max_tool_calls_by_input":require("tool", "input_path", "value", "max"),   # runner :821-826（tool 无 value 回落）
}
# 注：require(a | b) ＝「a 或 b 至少其一存在」；require(a, b) ＝「a 与 b 均必填」。
# ⚠️ 「存在」的判定用 **undefined／null 检查**，**不是**真值判断：runner 的 numericLimit
#    用 `Number.isFinite(n)`（scripts/eval/eval-runner.mjs:715-718），故 **0 是合法阈值**
#    （max_per_value: 0 ＝ 不允许任何一次重复）。若用「非空／truthy」判定，0 会被误判为缺失 →
#    把合法的 max_per_value: 0 判成非法断言（假失败）。

# 派生（前端 webui/src/lib/types.ts）
type ToolAssertionType = typeof KNOWN_TYPES[number]
type ToolAssertion =
  | { type: Extract<ToolAssertionType, typeof PATH_TYPES>;  value: string; reason: string }
  | { type: Extract<ToolAssertionType, typeof BUDGET_TYPES>;
      tool?: string; input_path?: string; value?: string | number;
      max?: number; max_per_value?: number; reason: string }

# 服务端 webui/server/eval/cases.ts:33-64 的 EvalCase 同步补字段
type EvalCase = { ...; tool_assertions?: ToolAssertion[]; ... }
```

### 3.2 流程 2：编辑器「工具断言」页签的读写闭环

```text
# 位置：webui/src/pages/eval/CaseEditor.tsx（页签定义 :147-155、页签渲染 :474-660 一带）

# ── 新建 ──────────────────────────────────────────────
function onNewCase(domain):
    form = emptyCase(domain)              # 现有构造器，本条不改其字段集合
    form.tool_assertions = []             # 新增：显式初始化为空数组
    return openTab("meta")

# ── 打开既有用例 ──────────────────────────────────────
function onLoadCase(caseData):
    form = caseData
    # 既有用例若含路径型断言：如实展示为「本条不支持编辑」，但**不丢弃**（D6）
    for each a in (form.tool_assertions ?? []):
        if a.type not in EDITORIAL_TYPES:
            renderReadonlyRow(a, notice="本条不支持编辑该断言类型，请在 YAML / Raw JSON 中编辑")
    return openTab("meta")

# ── 编辑（仅预算型可编辑）──────────────────────────────
function onAddBudgetAssertion():
    a = { type: "max_repeated_tool_input", tool: "", input_path: "", max_per_value: 1, reason: "" }
    form.tool_assertions = [...(form.tool_assertions ?? []), a]

function onEditBudgetAssertion(idx, patch):
    updated = clone(form.tool_assertions)
    updated[idx] = { ...updated[idx], ...patch }
    form.tool_assertions = updated          # 顺序即断言顺序

# ── 客户端预校验（仅体验；服务端才是强制点 D4）──────
function onSaveClick():
    problems = validateToolAssertions(form.tool_assertions)
    if problems is not empty:
        toast.error(problems[0])             # 阻止本次提交
        return
    payload = { ...form, tool_assertions: form.tool_assertions ?? [] }
    if isNew:
        resp = POST /api/eval/cases/:domain      body={ case: payload }
    else:
        resp = PUT  /api/eval/cases/:domain/:id  body={ dryRun: false, case: payload }
        # ⚠️ 必须显式 dryRun: false —— PUT 路由默认 dryRun = true（cases.ts:435
        #    `request.body.dryRun !== false`），只回 diff / proposedYaml，**不落盘**（:332）。
        #    漏传 → 编辑既有用例「保存成功但文件没变」。
    # 422 时把服务端错误原样呈现，不吞掉
    if resp.status == 422:
        toast.error(resp.error.message)
        return
    navigate back to case list

# ── YAML 预览（yaml 页签；WebUI 无「导出下载」落点）──────────────────────
# ⚠️ 现行 WebUI 只有 YAML **预览**页签（自标「预览，不可直接编辑」，CaseEditor.tsx:700-708），
#    没有导出按钮、也没有导出路由（cases.ts:369-450 路由清单无 export）。
#    本条的「导出」一律指**预览文本**；若后续要真正的下载导出，须另立 Spec。
function onYamlPreview():
    problems = validateToolAssertions(form.tool_assertions)
    if problems is not empty:
        toast.error(problems[0])             # 预览同样必须报错，不得先出 YAML
        return
    return yamlStringify(form)               # 字段无损：tool_assertions 原样进 YAML
```

### 3.3 流程 3：保存 / 预览的失败关闭（服务端为唯一强制点）

```text
# 位置：webui/server/eval/cases.ts（addCase :279-299 / updateCase :312-）
# 目标：写入前端不支持或不合法的断言类型时，报错并拒绝；**不得静默丢弃**

function validateToolAssertions(assertions) -> string[]:      # 返回问题列表，空数组＝通过
    problems = []
    for each a in (assertions ?? []):
        if a is not an object:
            problems.push("tool_assertions 元素必须是对象")
            continue
        t = String(a.type ?? "")
        if t not in KNOWN_TYPES:                              # 8 型全集（流程 1）
            problems.push(`不支持的工具断言类型：${t}`)        # 未知类型 → 拒绝，不丢弃
            continue
        if t in BUDGET_TYPES:
            for each field in BUDGET_FIELD_CONTRACT[t]:
                if not present(a, field):
                    problems.push(`工具断言 ${t} 缺少必填字段 ${field}`)
        # 路径型：只校验 value 非空（runner 侧 required/forbidden 用 value 作正则或字面量）
        if t in PATH_TYPES and String(a.value ?? "").trim() == "":
            problems.push(`工具断言 ${t} 缺少 value`)
        # 路径型若按正则解释（*_input_regex 型）：必须可编译。
        # runner 对 *_input_regex 直接 `new RegExp(value, 'i')`（eval-runner.mjs:752），
        # 不可编译的正则在**跑批时抛异常**而非判失败 → 必须在保存侧拦住。
        if t in REGEX_PATH_TYPES:
            try:
                new RegExp(String(a.value ?? ""), 'i')
            except:
                problems.push(`工具断言 ${t} 的 value 不是合法正则`)
    return problems

function addCase(projectRoot, domain, caseData, dryRun, actor):
    ...                                    # 既有 id 冲突检查（:288-290）、问法非空检查（:291-293）顺序不变
    problems = validateToolAssertions(caseData.tool_assertions)
    if problems is not empty:
        throw new InvalidCaseSchemaError(problems.join("；"))
        #   → code = "INVALID_CASE_SCHEMA"，statusCode = 422（D5）
        #   → 用例**不落盘**；dryRun 同样拒绝，让预览与落盘口径一致
    upsertCaseInDoc(doc, caseData, true)    # 整对象写入（F7），tool_assertions 随之进 YAML
    ...

# ⚠️ 校验只作用于「用户提交写入」，不作用于服务端内部回写：
#    markStaleCases（webui/server/eval/cases.ts:389 GET → :260）会批量把用例回写为
#    review_status = "needs_review"。若校验挂在这条内部回写路径上，存量 YAML 里任何一条
#    不合规断言都会让「整域用例列表 GET」直接 500 —— 一次历史遗留的脏断言即打挂整域读取。
#    内部回写必须**跳过校验或降级为 warn**，不得 fail-closed。
function updateCase(projectRoot, domain, caseId, caseData, options):
    if options.internalRewrite:            # markStaleCases 走这条
        problems = validateToolAssertions(caseData.tool_assertions, { mode: "warn" })   # 只记录，不拒
    else:                                  # 用户 PUT 走这条
        problems = validateToolAssertions(caseData.tool_assertions)
        if problems is not empty:
            throw new InvalidCaseSchemaError(problems.join("；"))   # 422，且用例文件未变
    ...
    # dryRun 双态（webui/server/eval/cases.ts:435）：
    #   PUT 路由默认 dryRun = true（request.body.dryRun !== false），
    #   → 只回 diff / proposedYaml，**不落盘**（:332）。
    #   编辑既有用例要真正落盘，必须显式传 dryRun: false。
```

**失败关闭的三条硬约束**（评审要点）：

1. **不得静默丢弃**：断言类型不在 8 型全集内 → 保存直接失败，而不是「跳过这条」。
2. **Raw JSON 页签不是后门**：Raw 页签解析后仍走同一服务端校验（流程 3 在 `addCase` / `updateCase` 内，页签无关）。
3. **导出同样受约束**：编辑器导出 YAML 前先跑同一份校验，校验不过**不产出 YAML**（而不是产出一份缺字段的 YAML）。

### 3.4 流程 4：跑批判定闭环（验收取证口径）

```text
# 位置：scripts/eval/eval-runner.mjs（checkToolAssertions :720-844；evaluateCandidate :1641-1653）

# 用例侧（管理员在 WebUI 写）：
cases:
  - id: <case-id>
    tool_assertions:
      - type: max_repeated_tool_input
        tool: lucy_query
        input_path: filters
        max_per_value: 1
        reason: 相同查询输入不得重复碰撞。

# 跑批侧（WebUI 跑批 → CLI runner，F13）：
evaluateCandidate(case, parsed):
    toolCheck = checkToolAssertions(parsed.toolCalls || [], c.tool_assertions || [])   # :1653
    failures = [...sqlCheck.failures, ...toolCheck.failures, ...]                      # :1654-1660
    #   预算型命中 → 失败文案带 "budget: " 前缀（:771 / :787 / :812 / :834）
    #   未知类型 → "unsupported tool_assertion: <type>: <value>"（:841）
    return ok = (failures.length == 0)

# 验收断言：
#   ① WebUI 新建 → 保存 → 导出 YAML，tool_assertions 字段逐字保留
#   ② 跑批命中「同一 filter 重复查」时，该用例判失败且失败文案含 "budget: max_repeated_tool_input"
#   ③ 把断言类型改成未知值（如 "bogus_assertion"）→ 保存被拒（422），用例文件未新增该条
```

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 前端 `ToolAssertion` 的类型声明覆盖全部 8 型（既有 4 路径型 ＋ 新增 4 预算型），且预算型字段与 §1.4 合同一致。**回落必须逐条断言**：`max_tool_calls` 只给 `value`（无 `tool`）合法；`max_repeated_tool_input` 只给 `max`（无 `max_per_value`）合法——这两条若被误判非法，即为假失败 | 类型断言（编译期）＋ 单元（回落两例各一条） |
| SC-02 | 前端与服务端 `EvalCase` 均含 `tool_assertions` 字段；编辑器表单可承载该字段 | 类型断言＋ 单元（服务端 `cases.ts` 类型 + 前端 `types.ts` 类型） |
| SC-03 | 用例编辑器出现「工具断言」页签，可新增 / 编辑 / 删除 4 个预算型断言，顺序即断言顺序 | 组件测试（既有渲染 `CaseEditor` 的测试位：`webui/src/__tests__/eval-detail-page-header.test.tsx:7`） |
| SC-04 | 新建带 `max_repeated_tool_input` 的用例 → 保存 → **YAML 预览（yaml 页签）文本**：保存后回读 YAML 与预览文本**逐字一致**，`tool_assertions` 字段逐字保留，无字段丢失、无改名 | 组件测试 ＋ 单元（服务端写盘后回读 YAML 比对） |
| SC-05 | 该用例进跑批时能判出失败，失败文案含 `budget: max_repeated_tool_input` 且带 `actual` / `max` | 本机自动化（跑批打假） |
| SC-06 | 写入未知 / 非法断言类型（含预算型缺必填字段）时，保存被拒并回 422；**用例文件未新增 / 未修改**，断言**未被静默丢弃** | 单元（`addCase` / `updateCase` 抛 `InvalidCaseSchemaError`）＋ 写盘后回读比对 |
| SC-07 | 既有用例含路径型断言时，编辑器打开该用例**不丢断言**（只读呈现），保存往返后 YAML 中断言仍在 | 组件测试＋ 单元（往返比对） |
| SC-08 | 既有 4 型路径断言用例的跑批结果**不变**（`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml` 等既有文件不回归） | 既有跑批用例全绿 ＋ 回归比对 |
| SC-09 | runner 断言语义与失败文案不变（`budget: ` / `unsupported tool_assertion: ` 前缀保持） | runner 单测 ＋ 文本比对 |
| SC-10 | **存量脏断言不炸整域读取**：存量 YAML 含不合规断言时，`GET /api/eval/cases/:domain`（内部走 `markStaleCases` 回写）仍返回 **200**，不因内部回写触发 422/500 | 单元（造一条含非法断言的存量用例 → GET 列表 → 断言 200 且用例仍在） |
| SC-11 | **路径型正则可编译**：`value` 是正则（`*_input_regex` 型）时必须能被 `new RegExp(value, 'i')` 编译；不可编译的**在保存时**被拒（422），不拖到跑批时抛异常 | 单元（非法正则一条 → 拒 422）＋ 跑批回归（既有 `*_input_regex` 用例不受影响） |

### 4.1 出口与不在出口

- 本条出口＝SC-01–SC-11 全部关闭。
- 客户端环境、Agent 路径、整库旅程、客户环境证据不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 工具断言（Tool Assertion）— 用例编辑器里的页签名与断言族名，指向 YAML 字段 `tool_assertions`。**须在 `webui/docs/00-product-terminology-standard.md` 登记后方可实现**（Plan S0 前置项）。
- 路径断言（Path Assertion）— 断言族内的**子集**命名，指「必须走过 / 不得走过某工具」类断言（`required_tool` / `forbidden_tool` / `required_tool_input_regex` / `forbidden_tool_input_regex`）。
- 预算断言（Budget Assertion）— 断言族内的**子集**命名，指「工具调用次数 / 重复输入次数不得超限」类断言（`max_total_tool_calls` / `max_tool_calls` / `max_repeated_tool_input` / `max_tool_calls_by_input`）。

本条不新增产品概念、不新增用户可见译名之外的文案；`tool_assertions` / 8 个类型名是 YAML 字段与机器值，沿用既有 runner 口径，不译。

---

## 6. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/README.md`（Governance：状态与错误码呈现规则）
- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- `webui/docs/00-product-terminology-standard.md`（新增术语登记）

### What This Change Follows

- [ ] 新增页签沿用既有用例编辑器的页签形态与间距节奏（`webui/src/pages/eval/CaseEditor.tsx:147-155` 的既有页签），不新造 Tab 组件族
- [ ] 断言行沿用既有「SQL 断言」行的视觉结构（类型下拉 / 字段输入 / 删除按钮），不新造表单控件
- [ ] 输入框沿用既有 `pl-input` 语义 class，不新增硬编码色值
- [ ] 「本条不支持编辑」的只读断言用既有弱化文本样式呈现（与 `text-fg-muted` 一致），不新增状态色
- [ ] 校验失败提示走既有 Toast 通道（`sonner`），不新增弹窗形态
- [ ] PageHeader 可见动作数不变；本条不新增页面级动作
- [ ] 禁用态（不可编辑的路径型断言）有可见原因说明，不出现「点了没反应」
- [ ] 文案与术语符合 §5 登记口径

### Exceptions (If Any)

- 无。本条只增一个页签与断言行编辑块，不涉及窄屏 / 移动端表现差异；若评审认为断言表单在窄屏需另设布局，登记为 Follow-up 而非本条例外。

### Follow-up Needed

- 新增术语（工具断言 / 路径断言 / 预算断言）需登记进 `webui/docs/00-product-terminology-standard.md`（Plan S0 前置项）。
- 路径型断言的**编辑**能力不在本条（分支级 D3 裁定），需在 G1 稳定后另立条目；届时另走一次设计规范符合性说明。

---

## 7. 非目标

- 不改 runner 断言语义、判定顺序与既有失败文案（D7）。
- 不新增断言类型；8 型全集即 runner 现有全集（§1.3）。
- 不在编辑器暴露路径型断言的**编辑**能力（分支级 D3 裁定；类型层保留）。
- 不引入新的 Eval 跑批引擎；跑批仍走 CLI runner（F13）。
- 不改 legacy → canonical 归一化与 canonicalize（D8）。
- 不改 `evals/**` 既有 YAML 用例的内容；本条只让这些断言在 WebUI 侧可见可编辑。
- 不做 REQ-030-021（批量工具反哺通道）的任何部分。

## 8. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | 路径型断言在编辑器只读 | 分支级 D3 的直接结果；靠 D6 的「不丢弃」保证数据不丢，但管理员仍需手改 YAML | 后续条目（待 G1 稳定） |
| RES-02 | 断言类型清单跨工程复用方式 | D2 给出的首选是前端 `import` 服务端常量；若实施时受打包边界限制，退化为镜像 ＋ CI 断言 | 实施时裁决，须在 Plan S1 出口落定 |
| RES-03 | 失败文案在 WebUI 侧的呈现 | 服务端 422 错误信息沿用既有 `InvalidCaseSchemaError` 通道；具体用户可见文案待 §5 术语登记时定稿 | Plan S0 |

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 类型与运行器漂移 | 类型清单三处手写时，runner 加型而 WebUI 不认，就会出现「保存过了但跑批判 `unsupported`」 | D2 单一登记（源在服务端）+ SC-01 类型断言；SC-09 文案比对 |
| 编辑器改坏既有用例 | 编辑器表单重建 `form` 时把不支持的断言类型剔掉，保存即静默删数据 | D6 只读保留 + SC-07 往返比对；SC-06 断言不得静默丢弃 |
| 客户端校验被绕过 | Raw JSON 页签可绕过前端校验 | D4 把强制点放在服务端 `addCase` / `updateCase`；SC-06 走服务端路径断言 |
| 校验口径与 runner 不一致 | WebUI 放行但 runner 判 `unsupported tool_assertion`，白跑一轮 | §1.4 字段合同逐条对齐 runner 行号；SC-05 / SC-09 |
| 预算型字段口径歧义 | `max_tool_calls` 的 `tool` 可回落 `value`、`max_repeated_tool_input` 的 `max_per_value` 可回落 `max` | 编辑器按合同填全字段；服务端校验采用与 runner 相同的回落规则，**不放宽也不收紧** |
| 既有 YAML 被误改 | 编辑器保存会整对象重写 YAML（`doc.createNode`） | SC-08 回归比对；本条不改既有 YAML 内容 |
| 与 REQ-030-020 争同一断言面 | 020 导出的草稿可能含路径型断言，而本条编辑器不支持编辑该类 | 依赖登记在 020 的 Plan「开工前置」；本条 D6 保证这类断言在编辑往返中不丢 |

## 10. 出处

- 需求池：[`REQ-030-019`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.2（缺口 G2）、§4（W2 波次）、§5（开工前置）、§9（决策点 D3）
- 落盘清单：[`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」
- runner 判定实现：[`scripts/eval/eval-runner.mjs`](../../scripts/eval/eval-runner.mjs)（`:720-844`、`:1608-1609`、`:1653`）
- 编排面缺口：[`webui/src/lib/types.ts`](../../webui/src/lib/types.ts)、[`webui/src/pages/eval/CaseEditor.tsx`](../../webui/src/pages/eval/CaseEditor.tsx)、[`webui/server/eval/cases.ts`](../../webui/server/eval/cases.ts)、[`webui/server/eval/suite-import.ts`](../../webui/server/eval/suite-import.ts)、[`webui/server/eval/suite-schema.ts`](../../webui/server/eval/suite-schema.ts)、[`webui/server/eval/runner.ts`](../../webui/server/eval/runner.ts)
- 既有预算型用例样本：[`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml`](../../evals/agent_reliability/eval/agent-reliability-eval-cases.yaml)（`:13`、`:142`、`:147-155`）
