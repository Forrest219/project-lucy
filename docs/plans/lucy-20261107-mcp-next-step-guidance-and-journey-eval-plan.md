# Lucy 0.30 分支计划：MCP「下一步指导」与「问询旅程 → 路径 Eval」

| 元数据 | 内容 |
|---|---|
| 文档类型 | 分支实施计划（**不是**功能 Spec，**不授权**实现） |
| 版本 / 日期 | v0.4 / 2026-11-07 |
| 状态 | **D1／D2／D3／D4／D5 已全部裁定（2026-11-07）**；G1（REQ-030-018）的 Spec／Plan 已至 **v0.4**（经第 1 轮对抗式评审 6 条阻断项全部修订，并入横切批评审 9 条、第 2 轮对抗式评审 16 条修订），G2（REQ-030-019）、G3（REQ-030-020）、G4（REQ-030-021）已各开 Spec 与 Plan，均 v0.2-draft；全部**待评审、未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。G1 的 **D3 落点反转（追加 content 块 → 单块内加键）待委托人确认**。本条只做差距登记与顺序裁决，**不授权实现**。**本条不表示任何功能已获授权实现，也不表示可上线** |本条只做差距登记、顺序裁决与决策点收口；实现须各自另立 Spec 并获授权 |
| 授权边界 | **只登记、不实现**。本文不改动任何运行代码，不开 Spec，不改现行协议 |
| 验收 | 本条验收＝① 差距判定逐条带 `file:line` 证据；② 候选条目已登记进 `0.30` 需求池；③ Plan 五类小节齐备且机器门禁通过。**不构成任何功能验收，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | The New Stack《Why MCP servers should tell agents what to do next》（Matthew Burns 记 AWS James Ward），2026-11-07 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「落盘清单」 |
| 关联需求池 | [`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（REQ-030-018…021） |

## 1. 目标

### 1.1 一句话抽象

> 把 Lucy MCP 从「薄 API 转发库表」做成对话里的**第三个声音**：回数据的同时告诉 Agent 刚做了什么、下一步该走哪条受控路径、缺口去哪补；再用整段问询旅程做 Eval 改工具面。

### 1.2 结论先行

对照 Lucy 现行实现，这句话里的能力**大部分已经落地**——真正缺的不是方向，是 4 个具体缺口。因此本计划不铺新叙事，只做三件事：

1. 把**已做**的钉住（不重复投入，不被新叙事带偏）；
2. 把**真缺的**登记进 `0.30` 需求池（REQ-030-018…021，只登记不实现）；
3. 把**顺序与决策点**摆出来，等拍板。

**若只选一刀**：G1（空结果 / 拒答 / 缺 measure 的结构化下一步指导）。它最贴原文主张，也最贴 Lucy 现有的 Proxy + Quality Pack 骨架。

### 1.3 原文主张 → Lucy 现状逐条对拍

| # | 原文主张 | Lucy 现状 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 工具响应要带下一步指导，不只靠 `initialize` | 部分落地：拒答、过滤下推、结果截断三类**已有**修复提示；**成功但 0 行没有任何指导** | `webui/server/proxy/mcp-proxy.ts:4017-4065`、`webui/server/proxy/mcp-proxy.ts:2892-2937`、`webui/server/proxy/question-experience.ts:1039`；空结果仅审计：`webui/server/proxy/question-experience.ts:1000-1007`、`webui/server/proxy/mcp-proxy.ts:3027` | **缺口 G1** |
| 2 | 用 session/goal 把零散调用拼成整段旅程 | 已落地：`lucy_begin_question` / `lucy_continue_question`、问询预算、turn 归因、审计调用链故事线 | `webui/server/proxy/mcp-proxy.ts:1063-1083`、`webui/server/proxy/mcp-proxy.ts:4719+`、`webui/server/proxy/question-experience.ts:9-12`、`webui/server/proxy/turn-correlation.ts`、`docs/specs/lucy-20261104-audit-call-storyline-spec.md` | 已有 |
| 3 | 观察 → 复现 → 评测 → 改工具面 / 批量工具 | 部分落地：Eval 能检出重复调用，但**没有「检出 → 升工具 → 复测」回哺通道** | `scripts/eval/eval-runner.mjs:794-818`（`max_repeated_tool_input`）、`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml:147` | **缺口 G4** |
| 4 | Eval 要测「改工具是否真被走」（路径断言） | runner 已支持 **8 型**工具断言（2026-11-07 复核更正：原写「7 型」有误，实测为 8 型）；**WebUI 用例编辑器无入口**，前端类型只声明 4 型 | `scripts/eval/eval-runner.mjs:720-844`、`webui/src/pages/eval/CaseEditor.tsx:474-660`、`webui/src/lib/types.ts:2081-2086` | 已有（编排面缺 → **G2**） |
| 5 | 用户原话 vs 工具序列「对拍」成一等公民 | 审计侧有原话与调用序列，Eval 侧有用例，**两者之间无桥** | `webui/server/proxy/mcp-proxy.ts:4719+`（写 turn）、`webui/server/eval/runner.ts:322`（WebUI 跑批走 CLI runner） | **缺口 G3** |
| 6 | 工具面设计避免「一条条取客户」式 scenic route | 已落地：数据面 6 工具白名单 + 手册一致性门禁 | `webui/server/proxy/acl.ts:86-93`、`scripts/gates/handbook-tool-surface.test.mjs` | 已有 |
| 7 | 指导 ≠ 权限（安全仍靠 Proxy + ACL） | 现状正确：instructions 是建议层，裁决在 `acl.check()`；修复提示只含当前角色可见对象 | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:25`、`:353`（SC-5） | 已有，**保持** |

## 2. 已做且必须坚持的（不重复投入）

这几项已经是原文主张的正确形态，任何新方案不得削弱：

1. **`initialize` 注入 role-aware instructions**——把查询顺序（catalog → read_source → query → wiki）写进协议，而不是指望客户端读仓库 `CLAUDE.md`。这正是「第三个人说话」。`webui/server/proxy/mcp-proxy.ts:1856-1868`、`webui/config/data-qa-instructions.md`
2. **数据面 6 工具白名单**——`lucy_query` / `lucy_read_source` / `lucy_explain_query` / `lucy_freshness` / `entity_details` / `sl_validate`。`webui/server/proxy/acl.ts:86-93`
3. **修复提示可用性闭环（B15）**——提示内容必须先过真实 Schema、编译能力、对象存在性、主体可见性、可调用性五项校验，才允许推荐目标。`webui/server/proxy/question-experience.ts:842-859`、`webui/server/proxy/question-experience.ts:1164-1240`
4. **问询旅程与失败预算**——`lucy_begin_question` 登记原话、20 次 / 120 秒预算、`lucy_continue_question` 续查。`webui/server/proxy/question-experience.ts:9-12`、`webui/server/proxy/mcp-proxy.ts:4673-4718`
5. **工具面与手册一致性门禁**——运行时注册表与手册 §4.4 必须同集合。`scripts/gates/handbook-tool-surface.test.mjs`

## 3. 四个真缺口

### 3.1 G1 空结果零指导（唯一真正的一刀）

**现状**：成功但返回 0 行时，`lucy_query` 返回**裸空结果**。`result_empty=1` 只是审计标记，**没有任何面向 Agent 的下一步指引**。`webui/server/proxy/question-experience.ts:1000-1007`、`webui/server/proxy/mcp-proxy.ts:3027`、`webui/server/proxy/audit.ts:1782`；合同口径见 `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:329`

**为什么它是真缺口**：这是文章点名的最糟失败形状——**半通**（看得到 catalog、查不出数）。当前三类修复提示里，拒答与下推都给了路，唯独「查得到、但没数」这条最常见的路径让 Agent 只能猜：换 filter？换 period？换 source？而 `data-qa-instructions.md:40` 又要求 Agent 严格区分**无记录 / 字段为空 / 可推算**三类缺失——工具响应此刻却什么都不给。

**落法**：`lucy_query` 成功且 0 行时，结构化返回下一步建议，且建议内容只含当前角色**可见**的工具与 ACL 内的来源。

> **2026-11-07 已开 Spec**：[`lucy-20261107-empty-result-next-step-guidance-spec.md`](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) **v0.4**（经第 1 轮对抗式评审 6 条阻断项、横切批评审 9 条、第 2 轮对抗式评审 16 条修订）＋ 实施 Plan [`lucy-20261107-empty-result-next-step-guidance-plan.md`](lucy-20261107-empty-result-next-step-guidance-plan.md) **v0.4**。D1＝结构化、D2＝提示不阻断已裁定；**D3 落点反转待委托人确认**。评审记录见 [`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)。**代码改动未授权。**

**相对本节初稿的收窄**（第 1 轮评审判定初稿伪码与 Spec 形状不一致，此处对齐 Spec v0.4）：

| 初稿写法 | 收窄后 | 原因 |
|---|---|---|
| 覆盖 `lucy_query` **与 `lucy_read_source`** | 只覆盖 `lucy_query` | 其余工具的空返回语义不同 |
| 伪码含 `candidates` / `no_visible_source` / `distinguish` | **三者皆无** | `candidates` 无可靠来源（AC 内 ≠ 本次可查）；`distinguish`（无记录／字段为空／可推算）空结果时工具无从区分 |
| 落点未写 | 单块内加键（`content[0].text` 的 JSON 内）＋ `structuredContent` ＋ `_meta.lucy`，**三处同生同灭** | 追加 content 块会打断 `scripts/eval/eval-runner.mjs:293-300` 的多块 JSON 解析 |

**核心流程（伪代码）**（以 Spec v0.4 §6 为准，此处只列骨架）：

```text
function onToolResult(tool, response, identity, visibleTools, scopeIntersectionEmpty):
    if outcome != "ok":  return response          # 失败路径各有修复提示，不叠加
    if rowCount is null: return response          # 未知行数 ≠ 空结果
    if rowCount > 0:     return response
    step = buildEmptyResultNextStep({
        toolName: tool, rowCount: 0,
        scopeIntersectionEmpty,                   # 行权限交集空 → 分流 kind 与建议
        provenance,                               # 不含 filters
        filtersSummary: summarizeFilters(originalUserFilters),   # 去值；策略谓词不出现
        visibleTools
    })
    if step == null: return response
    if response.isError == true: return response   # 200 + isError 不发（D13）
    if not isJsonObject(response.content[0].text): return response   # 模型可见位不成立 → 三处都不发（D4）
    if hasOwn(response.content[0].text, "next_step"): return response  # 不覆盖上游同名字段（D12）
    injectIntoContentTextJson(response, step)     # 模型可见位
    injectIntoStructuredContent(response, step)   # 结构化位
    attachToMetaLucy(response, step)              # 合同位（审计/运维）——三处同生同灭
```

> **第 2 轮评审（N2，blocker）**：v0.3 的骨架写成「三个注入并列、无先后依赖」，实现者照做就会让 `structuredContent` 与 `_meta.lucy` 在 text 不可注入时**照发** → 审计说「已下发」而模型一条没收到，正是 D3 不变式要防的静默消失。故改为「先判定模型可见位能否承载，再一次性写三处」。详见 Spec §4 D4。

**不做**：不做门闩（不因空结果拒绝后续调用）；不做跨角色推荐；不改 `result_empty` 审计语义；不替 Agent 下结论（「无记录」不等于「数据错误」）；**不追加 content 块**；不改上游数据载荷的值语义。

**验收方向**：0 行响应的三个落点内容一致（且**同生同灭**）；`next_tools` 只含 `allowedToolNames` 判可见的工具（且**只在 0 行路径**做可见性裁决）；`query.filters` 为去值摘要且不含策略谓词；载荷只由白名单键构成；行范围与用户筛选无交集时（`kind=scope_intersection_empty`，沿用既有机器码与主术语）`kind` 与建议分流（**不预设成因**）；有数据时响应**逐字节不变**。

### 3.2 G2 路径断言在 WebUI 侧不可编排

**现状**：路径断言能力在 runner 侧**已完备**——`required_tool` / `forbidden_tool` / `required_tool_input_regex` / `forbidden_tool_input_regex` / `max_total_tool_calls` / `max_tool_calls` / `max_repeated_tool_input` / `max_tool_calls_by_input` 共 **8 型**（路径型 4 ＋ 预算型 4；2026-11-07 复核更正：初稿写「7 型」有误，以 runner 为准）。`scripts/eval/eval-runner.mjs:720-844`

但三个编排面都缺：

- 前端类型只声明 4 型，**漏掉 4 个预算型**（现有 YAML 正在用）。`webui/src/lib/types.ts:2081-2086`
- 用例编辑器只有 SQL 断言与结果断言两个页签，**无 tool_assertions 入口**。`webui/src/pages/eval/CaseEditor.tsx:474-660`
- 服务端 `EvalCase` 类型**没有 `tool_assertions` 字段**。`webui/server/eval/cases.ts:33-64`

好消息：**数据不丢**。legacy → canonical 归一化是整字段展开（`webui/server/eval/suite-import.ts:140-158`），canonicalize 不做白名单过滤（`webui/server/eval/suite-schema.ts:392-412`），WebUI 跑批也确实走 CLI runner（`webui/server/eval/runner.ts:322`）。所以这是**编排面缺口**，不是执行面缺口——管理员想写「必须调用 `lucy_query`」或「同一 filter 不得重复查」，只能手改 YAML。

**落法**：类型补齐 8 型 + 用例编辑器增加「工具断言」页签 + 服务端类型补字段。**编辑器层只暴露 4 个预算型断言**（分支级 D3 已裁定取 (b)，见 §9）——路径型 4 个断言随 G1 稳定后再上。

**验收方向**：在 WebUI 里新建一条带 `max_repeated_tool_input` 的用例 → 导出 YAML 字段无损 → 跑批能判出该失败。

### 3.3 G3 审计旅程 ↔ Eval 用例缺一座桥

**现状**：审计侧已经能读出一段问询的「原话 → 调用序列 → 结果」故事线（`docs/specs/lucy-20261104-audit-call-storyline-spec.md`），Eval 侧也有带 `question` 与 `tool_assertions` 的用例，但**没有任何通道**把真实失败旅程变成回归用例。排障时看到「这个 Agent 连续查了 8 次同一个 ID」，只能人工翻译成 YAML。

**落法**（池内草案）：从审计问询导出 **Eval 用例草稿**——`question` 取用户原话，`tool_assertions` 从调用序列反推（重复输入 → `max_repeated_tool_input`；命中特定工具 → `required_tool` / `forbidden_tool`）。导出为**草稿**，人工确认后才进 `evals/**`；不自动进池、不自动进跑批。

**不做**：不做自动改工具面；不做从 Eval 反向回放生产审计；不把客户原始问句直接落进 YAML（沿用 `evals/agent_reliability` 的脱敏合成约定）。

**验收方向**：一段含重复调用的审计问询，导出的草稿能复现出等价的 `max_repeated_tool_input` 断言。

### 3.4 G4 批量 / 聚合工具缺「旅程反推」回哺通道

**现状**：`max_repeated_tool_input` 能**检出**「对同一 ID 列表反复单查」，但检出之后没有任何机制把它变成「升一级批量工具 / 写一条 skill / 改工具描述」。`scripts/eval/eval-runner.mjs:794-818`

Lucy 侧其实已具备批量表达能力（`lucy_query` 的 `measures` / `dimensions` / `filters` 都是数组），`webui/config/data-qa-instructions.md:58-66`；截断时也已有「改为聚合后再取明细」的提示 `webui/server/proxy/question-experience.ts:1039`。缺的是**把失败模式反哺成工具面改动**的闭环。

**落法**：跑批失败分类里，把 `budget: max_repeated_tool_input` 指向一个「批量候选」队列，人工评审后决定是升工具、补 skill 还是改 instructions；本条目只登记队列与判定口径，不自动改工具面。

**不做**：不自动新增工具；不放松白名单 SQL；不让 Agent 临场写任意查询来「绕开」单查。

## 4. 分支实施顺序（建议）

| 波次 | 条目 | 理由 | 依赖 |
|---|---|---|---|
| W1 | **G1**（REQ-030-018） | 唯一真正的一刀；直接改善 Agent 拿到数据后的下一步选择；改动面局限在 proxy 响应整形 | 无 |
| W2 | **G2**（REQ-030-019） | 把已存在的路径断言暴露到编排面；成本低、收益立即（管理员可自助写路径断言） | 无 |
| W3 | **G3**（REQ-030-020） | 让真实失败旅程进回归集；依赖 W1 产出稳定的 `next_step` 形状 | 建议在 W1 之后 |
| W4 | **G4**（REQ-030-021） | 工具面反哺；依赖 W2 的断言可稳定检出循环单查 | 建议在 W2 之后 |

W1 与 W2 可并行（文件不重叠：proxy 响应层 vs Eval 编排层）。

## 5. 开工前置

任何条目从需求池进入实施前，必须依次满足（沿用需求池 §开工前置）：

1. **需求澄清**：与委托人确认诉求边界、与现行约束冲突项与不做项，结论写回池条目。
2. **独立 Spec**：另立 `docs/specs/lucy-YYYYMMDD-<slug>-spec.md`，含「核心流程（伪代码）」与「闭口层级」。
3. **Plan**：另立 `docs/plans/lucy-YYYYMMDD-<slug>-plan.md`，登记进 [`docs/plans/README.md`](README.md)。
4. **开发授权**：获得明确开工授权后，才可改代码。

未满足上述四步时，条目状态保持 Deferred。

**本计划特有的前置约束**：

- G1 涉及 MCP 响应形状变更 → 须同步核对 `webui/docs/07-mcp-auth-proxy-spec.md` 与客户端兼容面（Claude Code / Codex / Cursor）。
- G2 涉及 Eval 用例编辑器 → 须走 WebUI 设计规范四段式（`webui/docs/design-system/30-pr-compliance-template.md`）。
- G3 / G4 产出草稿与队列 → 须先确认脱敏口径，沿用 `docs/governance/eval-quiz-conventions.md`。
- 四条都**不得**把「告诉下一步」表述成安全边界：instructions 是 fail-open 的建议层，裁决始终在 Proxy + ACL。

## 6. 验收

- **本条（Plan 级）验收**：§1.3 对拍表每行都有 `file:line` 证据；四个缺口各自登记为池条目（REQ-030-018…021），其中 REQ-030-018…021 均**已开 Spec／Plan，待评审、未授权实现**（池内其余条目仍为 Deferred）；Plan 五类小节齐备；`npm run lint:spec-docs` 通过。
- **条目级验收**：在各自 Spec 中完成，**不在本计划内验收**。
- **本计划不产出功能验收结论**，也不作为任何版本的发布取证。

## 7. 完成定义

- 本文件存在、可被索引登记、五类小节齐备。
- 四个缺口各有池条目，来源可追到本文与原文出处。
- 拍板结论写回 §10 对应条目；被否决的方向写明「不做」，不回抄成待办。
- 本轮**不改任何运行代码**，不改现行协议形状，不改 `0.30` 以外的版本范围。

## 8. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 把已有能力当缺口重做 | 原文的 7 条主张里 4 条 Lucy 已落地，容易重复投入 | §1.3 对拍表逐条给证据；本计划只登记 4 个真缺口 |
| 指导被当成安全边界 | 「告诉下一步」是建议层，instructions fail-open | 每条目的非目标写明「指导 ≠ 权限」；候选内容一律 ACL 内 |
| 空结果提示越权泄漏 | 候选 source 来自 ACL 快照，配置漂移可能夹带越权名 | 候选必须复用 `denialAllowList` / `buildRepairClosure` 既有闭环，不新造白名单 |
| 响应形状变更打破客户端 | 新增 `next_step` 字段影响既有客户端解析 | 字段只增不改；老客户端忽略未知字段；变更须在 Spec 中列兼容矩阵 |
| 需求池条目被当成实施依据 | 池内条目默认 Deferred，不授权实现；REQ-030-018…021 虽已开 Spec／Plan，**仍待评审、未授权实现** | 文件头沿用「只登记不实现」；状态列逐条写明 Deferred（已开线的 018…021 逐条写明「待评审、未授权实现」） |
| 把文章主张当既定路线 | 原文是 AWS 的做法，非 Lucy 必选项 | 本计划只给差距与顺序，方向留 §10 拍板 |

## 9. 待拍板决策点

> 编号说明：本节编号 `D1…D5` 是**分支级拍板点**；Spec 内部的冻结决策表另用 `D1…D13`（见 G1 的 Spec §4），两者不是同一组。

| # | 决策 | 选项 | 建议 | 状态（2026-11-07） |
|---|---|---|---|---|
| D1 | G1 的下一步指导落在**结构化字段**还是**文本**？ | (a) 结构化 `next_step` 字段 + 人类可读 hint；(b) 纯文本追加；(c) 两者都要 | (a) 结构化字段为准，文本 hint 由字段渲染 | **已裁定：结构化**。委托人 2026-11-07 裁定；落到 `next_step` 对象（`kind`/`summary`/`query`/`suggestions`/`next_tools`/`hint`） |
| D2 | G1 是**提示**还是**门闩**？ | (a) 只提示不阻断；(b) 空结果且无候选时拒绝后续查询 | (a) 只提示——门闩会与「部分可回答仍须交付」冲突 | **已裁定：提示不阻断**。委托人 2026-11-07 裁定；不拒绝后续调用、不改问询预算 |
| D3 | G2 的编辑器支持全部 8 型断言，还是先 4 型？ | (a) 全 8 型；(b) 先补 4 个预算型（现有 YAML 在用） | (b) 先补预算型，路径型随 G1 稳定后再上 | **已裁定：取 (b)**。委托人 2026-11-07 批准按推荐；Spec 见 [`lucy-20261107-eval-tool-assertion-authoring-spec.md`](../specs/lucy-20261107-eval-tool-assertion-authoring-spec.md)（SC-01–09） |
| D4 | G3 的方向是单向导出还是双向回放？ | (a) 审计 → 用例草稿（单向）；(b) 用例 → 审计回放（双向） | (a) 单向——双向回放涉及生产审计写入，风险与成本都不成比例 | **已裁定：取 (a)**。委托人 2026-11-07 批准按推荐；Spec 见 [`lucy-20261107-audit-journey-eval-case-draft-spec.md`](../specs/lucy-20261107-audit-journey-eval-case-draft-spec.md)（SC-01–09） |
| D5 | 本轮是否直接开 G1 的 Spec？ | (a) 只留池条目；(b) 同轮开 Spec 并授权实现 | 待定——取决于 §9 决策点 D1/D2 的答案 | **已裁定：开 Spec**（不含实施授权）。D1／D2 已给出，Spec 与实施 Plan 已落盘；**代码改动仍未授权** |

裁定后派生出的 Spec 级冻结决策（不再回本表）：指导落**三处**——`content[0].text` 的 JSON 对象内同名键（**模型可见，主落点**）、`structuredContent.next_step`（结构化位）、`_meta.lucy.next_step`（合同／审计位），**不追加 content 块**，且三处**同生同灭**（模型可见位不成立时三处都不发）。理由：既有截断修复提示至今只在 `_meta.lucy.repair`，**从未进入模型可见的 `content`**（`webui/server/proxy/mcp-proxy.ts:2699` 是唯一落点），只落 `_meta` 达不到原文主张；而追加 content 块会打断 `scripts/eval/eval-runner.mjs:293-300` 的多块 JSON 解析，且其可见性依赖客户端渲染全部块（仓内无法验证），故改为单块内加键——**不变式：凡出现 `next_step`，模型一定看得见**。⚠️ 该落点反转**待委托人确认**，详见 G1 的 Spec §4 D3。

## 10. 刻意不做（原文第 3 节）

- **不放松白名单 SQL、不允许 Agent 临场写任意查询**——那是反 Lucy。
- **不搬 CLI / 多 profile OAuth 那套 AWS 特例**——Lucy 的替代路径是 Token + Role + Proxy；跨客户端（Claude Code / Codex / Cursor）用 Eval 比**同一治理面下的完成率**，不比 OAuth 形态。
- **不把「告诉下一步」说成安全边界**——安全仍靠 Proxy + ACL；instructions 层的建议不构成任何授权。

## 11. 关联

- 需求池：[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 修复提示与失败分类合同：[`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md)
- MCP Proxy 合同：[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md)
- 审计调用链故事线：[`docs/specs/lucy-20261104-audit-call-storyline-spec.md`](../specs/lucy-20261104-audit-call-storyline-spec.md)
- 运行时指导源：[`webui/config/data-qa-instructions.md`](../../webui/config/data-qa-instructions.md)
- Eval / Quiz 约定：[`docs/governance/eval-quiz-conventions.md`](../governance/eval-quiz-conventions.md)
