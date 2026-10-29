# Customer Query Experience and Usage Evidence Spec

| 元数据 | 内容 |
|---|---|
| Spec | 162 |
| 文档名称 | Customer Query Experience and Usage Evidence |
| 文档类型 | Product / Proxy / Audit / Semantic Contract Spec |
| 版本 | v0.4 |
| 状态 | 已实现（lucy-v2.0）。WO-202610-12 / WO-13 / WO-14 均已验收合入；调用路径补丁见 WO-202610-15。**v0.4 为「修订声明」**：§7.2 的墙钟口径与续查兑现通道已由问询预算优化 Spec 修订，**但该修订尚未实现**，运行时仍以 §7.2 现行文本为准；生效条件见 §7.2 修订小节 |
| 撰写日期 | 2026-10-11 |
| 委托人 | xingchen |
| 来源计划 | [`docs/plans/2026-10-11-customer-log-next-optimizations.md`](../../docs/plans/2026-10-11-customer-log-next-optimizations.md) v1.1 |
| 关联工单 | [`wo-202610-12`](plans/wo-202610-12-query-turn-budget-and-repair.md)、[`wo-202610-13`](plans/wo-202610-13-usage-evidence-and-query-guardrails.md)、[`wo-202610-14`](plans/wo-202610-14-usage-signal-and-publish-gate.md) |
| 关联 Spec | 08 问询追踪、09 R1 工具契约、125 生成 SQL 热库、138 轮次归因、137 审计证据 |
| 修订 | 不取代 Spec 138 的归因枚举。不改 Eval 跑批的 tool budget（`docs/design/design-eval-tool-budget.md`）。不改 KTX 源码。v0.2：`wiki_not_found` 与 `explicit_table_required:<empty>` 归用法与语义；`wiki_forbidden` 与带表名的 `explicit_table_required` 归权限拒绝。复述只写进 initialize 指导，代理不因缺少确认而拒绝查数。生产环境的 turn 绑定率依赖客户端发版，不是 WO-12 的退出条件。v0.3：SC-16 补上探测连接的评测标记；新增 SC-25、SC-26。慢标记的新定义不覆盖其它工具，也不替换 Spec 143。**v0.4（2026-10-29，PM 授权代改）：§7.2 的墙钟口径与续查兑现通道由 `docs/specs/lucy-20261029-question-budget-window-optimization-spec.md` v0.2 修订**——墙钟第二维度改为「已结算的数据处理时长」（空闲不计入）；新增 `lucy_continue_question` 续查通道（持久化「声明—消费」）；`continuable` 改为「该调用者是否仍有可达的继续通道」。**该修订未实现、不改变现行运行时行为**，§7.1／§7.3／§7.8 其余语义、§10 SC-1–SC-26 现行判定均不变 |

> **问询预算优化 Spec 修订（2026-10-29）**：本文 §7.2 的**墙钟口径**与**续查兑现通道**由 [`docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`](../../docs/specs/lucy-20261029-question-budget-window-optimization-spec.md)（v0.2）修订，逐条改动见 §7.2 的「修订后口径（尚未实现）」小节。⚠️ **该修订尚未实现**：运行时仍以 §7.2 现行文本为准——墙钟仍是问询年龄的流逝时间（`webui/server/proxy/question-experience.ts` 的 `QUESTION_BUDGET_MAX_WALL_MS = 120000`），`continuable` 仍硬编码为 `true`，续查仍只经 HTTP 头兑现。**新口径自该 Spec 的 SC-01–SC-41 全部执行完毕并发布之日起生效**；在此之前不得按新口径解释既有审计行或验收结论。本次修订**不改变** §7.1 归因、§7.3 失败四维度、§7.8 认证路径的其余语义，也不改变 §10 的现行判定。

> **Spec 189 修订（2026-10-27）**：本文 §7.6「协议与评测探针退出默认用量 KPI」的规则**保留为基线**，并升级为唯一事实源（T2 建立 `webui/server/proxy/usage-classification.ts`）。两处边界扩展：① 协议集合扩至**完整集合**（新增 `prompts/list` 与任何 `server/*` 方法）；② **准入集合（11 个 JSON-RPC 方法）与协议集合不相等**，两者边界以 `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` §4.2 为准。评测探针判定规则（显式 `eval_mark` 为真 **且** 参数／连接名命中探针标记）不变，且只退出默认用量 KPI，仍保留在原始审计、导出、问询关联与真实表访问中。

## 1. 已拍板

1. 没有 `lucy_begin_question` 时，数据查询仍然成功。KSC 的 60 次 begin 与 60 条原话一一对应，兼容是刚需。
2. 问询预算用尽时返回可继续的部分结果。这条记录不进入四个失败维度。
3. 修复提示和拒绝名单只含该调用者 ACL 之内的连接和 source。
4. 过滤条件不得编成 `'字段' AS field, '操作符' AS op` 下推。KSC 上这是完整的 `STRUCT(...)`（MySQL 系错误文本，12 行）；MJ 上 Doris 用省略号截断，27 次语法错误全部含 `AS field`，其中 11 行只剩 `...RUCT(`。
5. `upstream_error` 不是平台故障维度。四个一级维度是：引擎超时与并发、过滤条件下推、用法与语义、权限拒绝。
6. 默认版本只来自已发布的语义声明，并写进结果。没有声明就不应用。
7. 使用人、Agent、自动化是三层。`token_label` 不是使用人。自动化要显式标记，不从 User-Agent 推断。
8. 第 10 条保持独立的 P2。第 16 条本版只有一个模板试点。P2 内部顺序是 19 → 18 → 17 → 10 → 20。
9. 验收按 KSC 与 MJ 分开，不合成一个通过率。客户 YAML、Wiki 正文、角色清单不提交进本仓库。

## 2. 问题

运维导出的调用日志对不上用户原话：KSC 83.6% 的问询是推断摘要，业务调用带 turn id 的只有约四分之一，会话 ID 几乎为空。查询失败集中在语义契约和权限拒绝，但 `decision_reason=upstream_error` 把 `COUNT(*)`、缺列和过滤条件下推包在同一个标签里。MJ 的这 27 次失败没有留下 `generated_sql`。`lucy_query` 不写 `response_truncated`。Wiki 对普通中文返回 `unparseable_text`。策略版本在 KSC 有 3,304 行为空，在 MJ 全空。

## 3. 目标

1. 官方客户端上报原话、session 和 turn；代理按 Spec 138 归属，缺了上报仍能查数。
2. 一次问询有步数和时间预算，用尽后可继续，且不制造新的失败签名。
3. 语义与参数错误返回修复提示；过滤条件下推在到达引擎前失败关闭，截断的引擎文本仍能归类。
4. 已发布的默认版本和新鲜度出现在结果元数据里。
5. 使用统计能按使用人、Agent、自动化、协议噪音分开。
6. 失败聚合、导出和鉴权失败使用同一条时间线，并按四个维度归类。
7. `lucy_query` 写明是否截断。Wiki 自然语言检索不再因 `q` 本身失败。
8. 认证路径和单个损益模板可版本化，执行仍走 `lucy_query` 的 ACL。

## 4. 非目标

- 不修改 KTX 源码。过滤条件下推若仍由上游编译器生成，Lucy 在转发前失败关闭，并把 `compiler_reason` 写入审计。
- 不把旧日志回填成高置信原话。
- 不从 `token_label` 或 User-Agent 推断人名，也不把 Python-urllib 默认划成自动化。
- 不在 P0 拆开一句里的多个问题。
- 不自动 join 歧义表。
- 不在本版交付第二个报表模板，也不把 43 个摘要 token 做成授权清单。
- 不把 `upstream_error` 展示为平台故障。
- 不把 Pod 对端地址改写成猜测的客户端地址。
- 不把 Eval runner 的 tool budget 和本 Spec 的问询预算混成一个开关。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 中文主术语 | 约束 |
|---|---|---|
| Question Budget | 问询预算 | 用尽时的状态是「可继续」，不得写成失败或拒绝。**`continuable` 字段取值语义见 §7.2 修订小节（尚未实现）：修订后该值表示「该调用者是否仍有可达的继续通道」，额度用尽但无可达通道时如实为 `false`；这不改变本行「状态是可继续、不得写成失败或拒绝」的约束** |
| Repair Hint | 修复提示 | 只含当前角色可见的连接和 source |
| Filter Pushdown | 过滤条件下推 | 失败维度名。不得在 UI 里把 `upstream_error` 显示成这个名字 |
| Actor | 使用人 | 与 Agent、自动化调用并列。`token_label` 仍叫 Token 备注 |
| Automation Call | 自动化调用 | 只来自 Token 上的显式标记 |
| Failure Dimension | 失败维度 | 四个主术语：引擎超时与并发、过滤条件下推、用法与语义、权限拒绝 |
| Certified Route | 认证路径 | 答案里写路径 id 和 source。不是「授权了 N 张表」 |
| Applied Version | 采用的版本 | 结果元数据。没有发布声明时不出现 |
| Eval Mark | 评测标记 | Token 上的显式标记，字段名 `eval_mark`。缺省为未标记。不从 User-Agent、Token 备注或连接名推断。与自动化调用不是同一个标记 |

`lucy_turn_id`、`compiler_reason`、`response_truncated`、`policy_version`、`eval_mark`、`STRUCT` 是协议或引擎标识，出现在 DOM 时加 `translate="no"` 与 `notranslate`。

工单第一项把上表写入术语标准。在此之前，界面不得先用别的译名。

## 6. 波次

| 波次 | 工单 | 覆盖建议条目 | 验收 |
|---|---|---|---|
| P0 | WO-202610-12 | 01、02、03、04、05 | SC-1 至 SC-9 |
| P1 | WO-202610-13 | 06、07、08、09、11、12、13、14、15、16 | SC-10 至 SC-19，以及 SC-25、SC-26 |
| P2 | WO-202610-14 | 19、18、17、10、20 | SC-20 至 SC-24 |

## 7. 核心流程（伪代码）

### 7.1 调用归入问询

归因枚举仍是 Spec 138：`explicit` / `session_bound` / `identity_inferred` / `unassigned`。本流程只增加「缺了 begin 不拒绝」和「会话补绑」。

```text
function onToolCall(call):
  if call.tool == lucy_begin_question:
    if call.intentSummary is empty:
      return error(missing_intent_summary)   # 不写入问询，也不拒绝此后的查数
    turn = createTurn(origin=user_text, text=call.intentSummary, session=call.sessionId)
    return ok { turnId: turn.id }

  turn = attribute(call)                      # Spec 138：显式 turn 必须属于该身份
  if turn is unassigned and call.sessionId maps to an open user turn:
    turn = that turn
    mode = session_bound
    confidence = low
    association_status = candidate             # 自动会话归属不得升级为 confirmed

  if isDataTool(call.tool) and budgetExceeded(turn):
    return continuable(question_budget_exhausted)   # 见 7.2

  result = dispatch(call)                     # ACL 在修复提示之前裁决
  audit(call, turn, result, classify(result)) # 见 7.3
  return withMeta(result)                     # 见 7.5
```

数据工具包括 `lucy_query`、`lucy_explain_query`、`lucy_read_source`、`wiki_search`、`wiki_read`。协议方法（`resources/list`、`resources/templates/list`、`ping`、`server/discover`、`notifications/*`）不占问询预算，也不进入使用分析的默认分子（SC-16）。

### 7.2 问询预算

默认值可配置：数据工具 20 次，或墙钟 120 秒，先到为准。同一问询允许继续一次，继续后计数清零再给同一档。第二次用尽后仍返回可继续，由客户端决定是否再问；服务端不再自动加档。

```text
function budgetExceeded(turn):
  if turn.continuations >= 1 and turn.usedSinceContinue >= budget:
    return true
  if turn.continuations == 0 and (turn.dataCalls >= 20 or turn.wallMs >= 120000):
    return true
  return false

function continuable(reason):
  record outcome = budget_stop          # 不是 error，不是 denied
  record failure_dimension = none
  return {
    reason: question_budget_exhausted,
    partial: turn.evidenceRefs,
    continueToken: turn.id
  }
```

模型侧指导的事实源是 `webui/config/data-qa-instructions.md`，由 Spec 07 §4.4 在 `initialize` 注入。注入失败 fail-open，不是权限边界。WO-12 的 T3 已把该文件改成与本节一致：同一问询最多 20 次数据工具或 120 秒，并写明可以继续一次。指导不得再宽于代理预算。

P0 不拆句。复述范围在 P1，载体仍是这份指导，不新增代理拦截。见 §7.2 的下一段，任务在 WO-13 T8。
#### 修订后口径（**尚未实现**，2026-10-29）

由 [`docs/specs/lucy-20261029-question-budget-window-optimization-spec.md`](../../docs/specs/lucy-20261029-question-budget-window-optimization-spec.md) v0.2 修订，**三处变更**：

1. **墙钟口径**：第二维度由「问询年龄流逝时间」改为「**已结算的数据处理时长**」，agent 思考等**空闲时间不计入**。配套约束：在途处理时长按**有界超支**计入（≤ 并发上限 × 绝对执行时限）；问询年龄退出额度判定，**只作观测**（慢标记用途不变，见 §8）。
2. **续查兑现通道**：新增 `lucy_continue_question` 工具，以**持久化待兑现状态**打通「声明 → 消费」；HTTP 头 `x-lucy-question-continue` 保留为次要路径。
3. **`continuable` 语义**：由「是否还有额度」改为「**该调用者是否仍有可达的继续通道**」（额度 **与** 通道可达性两个条件）。旧客户端看不到新工具时该值如实为 `false`。

**生效条件**：新 Spec 的 SC-01–SC-41 全部执行完毕并发布后生效；生效时本小节取代上方现行文本，§10 的 SC-4 须**同期改写**。**在此之前，本小节不构成运行时事实源**，也不改变 SC-4 的现行判定。

模型侧指导（`webui/config/data-qa-instructions.md`）的同步修订与本小节**同批发布**，避免指导口径宽于代理预算或指向不可见工具。

问询原文含指代或两个意图时，指导要求模型先复述账户、月份和产品线。用户尚未确认时，由模型不发 `lucy_query`。没有原文的推断问询跳过复述。代理不因请求里没有确认字段而拒绝查询，否则没有该字段的旧客户端会被切断，违反 SC-1。

### 7.3 失败分类与修复提示

分类只看已经发生的调用。顺序固定，先匹配先生效。`decision_reason=upstream_error` 不单独成为维度。

```text
function classify(result):
  text = result.errorDetail
  reason = result.decisionReason
  if reason == "wiki_not_found" or reason == "explicit_table_required:<empty>":
    return 用法与语义
  if reason starts with "explicit_table_required:" and reason != "explicit_table_required:<empty>":
    return 权限拒绝
  if reason in ACL_REASONS or reason starts with "table_forbidden:" or reason starts with "unknown_or_forbidden_connection:" or reason starts with "tool_unclassified:":
    return 权限拒绝
  if reason in {timeout, query_concurrency_exceeded} or text contains Timeout:
    return 引擎超时与并发
  if text matches FILTER_PUSHDOWN:          # "AS field" 且 ("AS op" 或 "STRUCT(")
    return 过滤条件下推
  if result.outcome != ok:
    return 用法与语义
  return none

ACL_REASONS = {
  sensitive_metadata_forbidden, wiki_forbidden,
  raw_query_forbidden, agent_disabled
}
```

`wiki_not_found` 不在 ACL_REASONS 里。`webui/server/proxy/wiki-acl.ts` 只在篇目 key 解析不到页面时返回它；角色看得见但无权读的页面返回 `wiki_forbidden`。KSC 日志里 10 次 `wiki_not_found` 的 key 都是模型猜的文件名。它归「用法与语义」。

`explicit_table_required:<empty>` 是请求里没有解析出任何 source（`acl.ts` 在 `requested.length === 0` 时返回）。日志里的 25 次与 21 次都是这个空值，归「用法与语义」。`explicit_table_required:<table>` 是点名的敏感表不在授权内，归「权限拒绝」。

连接未配置（`Connection "…" is not configured`）归「用法与语义」，即使 `decision_reason` 是 `upstream_error`。只有 `unknown_or_forbidden_connection:*` 归「权限拒绝」。因此 `sql_server` 的 11 行未配置与 1 行拒绝分开计数。`tool_unclassified` 仍归「权限拒绝」：工具没有分类策略，不是用户猜错了名字。

```text
function repairHint(result, role):
  visible = connectionsAndSources(role)     # 仅 ACL 内
  if classify(result) == 权限拒绝:
    return { connections: visible.connections, sources: visible.sources }
  if classify(result) == 过滤条件下推:
    return { acceptedFilter: "{ field, op, value }", sources: visible.sources }
  if measure references no source:
    candidates = visibleRepairCandidates(role, visible)
    valid = validateRepairSyntaxCapabilityExistenceAndVisibility(candidates)
    # 只用元数据／编译校验，不为验证提示盲发真实数据查询
    if valid is not empty:
      return { use: valid.preferred, sources: visible.sources }
    return { error: factualValidationError, sources: visible.sources }
  return { sources: visible.sources }
```

`row_count(source)` 只有在真实工具 Schema、编译能力、对象存在性、当前主体可见性和可调用性均验证通过时才可进入提示；同名对象存在不构成可调用证明。无法验证时给事实性错误和可用候选，不给虚构函数。

名单里出现 ACL 之外的名字即失败（SC-5、SC-14）。`lucy_read_source` 与 `lucy_query` 使用同一函数。列名同时来自 overlay yaml 和 `_schema/<schema>.yaml` 的 tables；SC-23 夹具应按 manifest 形状编写。

### 7.4 过滤条件下推

```text
function forwardQuery(call):
  filters = canonicalize(call.filters)      # Spec 138：JSON 字符串解析失败则失败关闭
  if filters.invalid:
    return invalid_arguments                # 不请求引擎
  compiled = ktxCompile(call)               # Lucy 不改 KTX
  if compiled.sql matches FILTER_PUSHDOWN:
    audit.compiler_reason = filter_pushdown
    audit.generated_sql = compiled.sql if present else empty   # Spec 125
    return repairHint(过滤条件下推)          # 不把这段 SQL 当作成功结果
  return execute(compiled)
```

引擎只返回截断文本时，`generated_sql` 允许为空，`compiler_reason=filter_pushdown` 仍然必填。这覆盖 MJ 上 `STRUCT` 字面量被省略号吃掉的情况。

### 7.5 结果元数据：版本、新鲜度、截断

```text
function withMeta(result):
  if result.tool == lucy_query and result.outcome == ok:
    result.response_truncated = 1 if result.hitRowCap or result.engineTruncated else 0
    if result.response_truncated == 1:
      result.repair = "结果已截断，改为聚合后再取明细"
  if result.tool == lucy_query and source.publishedDefaultVersion exists:
    if query omitted that dimension:
      apply(source.publishedDefaultVersion)
    result.meta.appliedVersion = applied value
    result.meta.businessDate = applied business date
    result.meta.valueKind = actual or forecast
  if source.publishedDefaultVersion is absent:
    do not invent a version
  return result
```

`lucy_freshness` 与 `lucy_explain_query` 已写入的 `response_truncated=0` 保持原样。

### 7.6 使用统计三层

```text
function usageRow(call):
  row.agent = call.userId
  row.actor = token.actorId or unset          # 不用 token_label
  row.automation = token.actorKind == automation
  row.protocol = call.tool in PROTOCOL_TOOLS
  if row.protocol:
    exclude from default usage KPI
```

协议工具与第 14 条的探测连接在使用分析的默认视图里分开，不从 KPI 中删除原始行。探测连接要同时满足两点：参数或连接名含 `probe-`、`rds-test`、`demo-mysql`，且 Token 的 `eval_mark` 为真。只命中名称、`eval_mark` 不为真的调用留在默认视图。`eval_mark` 是 Token 上的可选显式字段，缺省为未标记，不从 User-Agent、`token_label` 或 `actor_kind` 推断。

### 7.7 Wiki 检索

```text
function wikiSearch(args, role):
  if args.q is a non-empty string:
    hits = searchReadableWiki(role, args.q, args.limit)
    return ok(hits or empty)                  # 不得返回 unparseable_text
  return invalid_arguments
```

问数前注入的篇目必须属于 `role` 可读集合，审计记下篇目 id 与 Wiki 版本。

### 7.8 认证路径与单个模板

```text
function runCertifiedRoute(routeId, role):
  route = publishedRoute(routeId)             # 不在仓库内的客户发布物
  if route is absent or role cannot read route.source:
    return 权限拒绝 with repairHint
  result = lucyQuery(role, route.query)
  result.meta.routeId = routeId
  result.meta.source = route.source
  result.meta.appliedVersion = route.version when declared
  return result
```

本版唯一试点模板 id：`public_cloud_pnl_quarterly`（公有云损益，分季度，实际/预测）。没有「一次查询替下同主题的多轮试表」的前后对比之前，不增加第二个 id。

内建度量：

```text
function compileMeasure(measure, source):
  if measure is count star or count(1) without a source:
    candidate = candidateRepairTarget("row_count", source)
    if verifyRepairTarget(candidate, currentPrincipal):
      return repairHint(candidate)
    return factualErrorWithVisibleCandidates(count_without_source, currentPrincipal)
  if measure wraps an already aggregated published measure in sum:
    candidate = candidateRepairTarget(use the published measure name)
    if verifyRepairTarget(candidate, currentPrincipal):
      return repairHint(candidate)
    return factualErrorWithVisibleCandidates(aggregate_of_aggregate, currentPrincipal)
  if measure is completeness:
    require declared numerator and denominator grain
  return compile(measure)
```

`compileMeasure` 在 ACL 的空 source 拒绝之前运行；命中时返回经工具真实 Schema、编译能力、对象存在性、当前主体可见性与可调用性验证的修复提示，且不再同时返回 `explicit_table_required:<empty>`。无法验证候选时只给事实性错误与授权范围内可用候选，不推荐 `row_count(source)` 或其他未验证目标，也不为验证提示发送真实数据查询。

## 8. 审计字段

在现有 access log 上增加或写满：

| 字段 | 规则 |
|---|---|
| `compiler_reason` | `filter_pushdown` 或空。截断的引擎文本不足以恢复 SQL 时仍要写 |
| `failure_dimension` | 7.3 的四个值或空。`budget_stop` 不写维度 |
| `response_truncated` | `lucy_query` 成功时必为 `0` 或 `1` |
| `applied_version` / `business_date` / `value_kind` | 仅当发布物声明了默认或查询显式带了版本 |
| `actor_id` / `actor_kind` | 来自 Token 配置。备注留在 `token_label` |
| `policy_version` | 空值计为缺失，不计为一个版本 |
| `generated_sql` | 有编译结果就按 Spec 125 写入 |

导出：页大小默认 10,000，用游标取下一页，不把超出的行静默丢掉。缺权限快照时 `completeness=false`。鉴权失败（`missing_bearer`、`token_expired`、`token_unrecognized`）出现在 `GET /api/admin/audit` 的同一时间筛选里，类型与调用分开。该接口合并 `access_log` 与 `auth_failure_log`。证据包里的 `auth_failure_log.csv` 仍是独立文件。

慢调用的新定义（P2，替换使用信号里把约 1 秒以上都标慢的规则）：`lucy_query` 的 `duration_ms >= 5000`，或问询墙钟 `>= 120000`。成功且 `response_row_count = 0` 记 `result_empty=1`。`notifications/cancelled` 在 session 能对上问询时写入该 turn id。`wiki_read`、`discover_data` 等其它工具的单次耗时不按这个定义标慢。问询钻取里高于窗口 p95 的 `isSlowCall`，以及 Spec 143 调用监测的默认 30 秒阈值，不在这个定义里替换。

发布门禁（P2）：语义 YAML 的既有 TS/Python 契约失败则拒绝发布。豁免写审计：操作者、原因、到期时间。豁免到期后检查恢复。物理名映射和 join 白名单不由这条门禁自动生成。

客户端（P2）：结构化 `client` / `client_version` 为空时，从 User-Agent 解析已知家族。`client_ip` 保持 socket 对端。转发头写入单独字段 `client_forwarded_for`，没有头就为空。

## 9. 客户现场与仓库的边界

下列内容由客户发布，工单只提供机制和验收方法，不提交其正文：

- 哪张 source 的默认版本是哪一个业务版本
- 认证路径清单和 `public_cloud_pnl_quarterly` 的指标口径
- 按域拆开的角色与双轨期 Token
- 广告日表的物理名别名和允许的 join
- Wiki 篇目正文

## 10. 验收

| ID | 波次 | 断言 |
|---|---|---|
| SC-1 | P0 | 不调用 `lucy_begin_question` 的 `lucy_query` 在授权通过时成功 |
| SC-2 | P0 | 测试客户端送出 session 时，begin 之后的调用 `turn_attribution_mode=session_bound`、`association_status=candidate` 且置信度为 low；不得升级为 confirmed。生产环境的 turn 绑定率不是本条的退出条件 |
| SC-3 | P0 | begin 的 `intentSummary` 在问询导出里来源为用户原话；空 summary 返回 `missing_intent_summary` 且不阻断随后的查数 |
| SC-4 | P0 | 第 21 次数据工具或墙钟超过 120 秒时返回 `question_budget_exhausted`，`outcome=budget_stop`，失败维度为空 |
| SC-5 | P0 | 修复提示中的 source 全部属于该角色；夹入一个 ACL 外的名字时测试失败 |
| SC-6 | P0 | 日志中的 filter 形状不得编译出 `AS field` / `STRUCT(`。复现夹具用 KSC 的 MySQL 文本和 MJ 的 `...RUCT(` 文本各一条 |
| SC-7 | P0 | 引擎只返回截断文本时，`compiler_reason=filter_pushdown` 且 `generated_sql` 允许为空 |
| SC-8 | P0 | 发布物声明了默认版本时，结果含采用的版本、业务日、实际或预测。未声明时结果不含编造的版本 |
| SC-9 | P0 | 使用统计能按使用人、Agent、自动化分组。`token_label=测试2` 不会变成使用人。未标记的 Python-urllib 不计入自动化 |
| SC-10 | P1 | `lucy_query` 成功行的 `response_truncated` 为 0 或 1；打到行上限时为 1，并带聚合修复提示 |
| SC-11 | P1 | `wiki_search` 的 `q` 为「收入」时不返回 `unparseable_text` |
| SC-12 | P1 | 注入 Wiki 的篇目属于该角色，审计含篇目 id 与版本 |
| SC-13 | P1 | 认证路径的结果含 `routeId` 与 source。角色看不见该 source 时走权限拒绝 |
| SC-14 | P1 | `discover_data`、`lucy_query`、`lucy_read_source` 的拒绝载荷使用 7.3 的同一名单函数 |
| SC-15 | P1 | `count(*)` 无 source 时，只有真实 Schema、编译能力、对象存在性、当前主体可见性与可调用性均验证通过才推荐 `row_count(source)`；同名不可调用、不可见或不存在时只给事实性错误与授权候选。`sum(已聚合度量)` 不生成 `sum(sum())`，修复目标同样须先验证 |
| SC-16 | P1 | 默认使用 KPI 不含协议工具。参数或连接名含 `probe-`、`rds-test`、`demo-mysql` 且 `eval_mark` 为真的调用在默认视图分开；只命中名称、`eval_mark` 未标记的调用仍在默认视图。不凭 User-Agent 或 `token_label` 推断。原始行仍在 |
| SC-17 | P1 | 抽样：`COUNT(*)` 的 `upstream_error`、`wiki_not_found`、`explicit_table_required:<empty>` 归用法与语义；`AS field` 归过滤条件下推；超时归引擎超时与并发；`table_forbidden`、`wiki_forbidden`、`explicit_table_required:<table>` 归权限拒绝 |
| SC-18 | P1 | 导出第二页能取到第 10,001 行。空 `policy_version` 计为缺失。缺快照时 completeness 为 false |
| SC-19 | P1 | 仅存在模板 `public_cloud_pnl_quarterly`。结果带 source 与版本。仓库内没有客户口径 YAML |
| SC-25 | P1 | `data-qa-instructions.md` 写明：问询原文含指代或两个意图时，模型先复述账户、月份和产品线，确认前不发 `lucy_query`；没有原文的推断问询跳过复述。请求不带确认字段时，代理仍转发 `lucy_query` |
| SC-26 | P1 | 使用统计按 `matched_role_id` 并排给出权限拒绝次数。同一次拒绝不按 `role_ids` 里的每个角色各计一次。`matched_role_id` 为空时单独成行。不要求客户 `access.yaml` 入库 |
| SC-20 | P2 | 新慢调用定义不把 1.6 秒的成功查询标成慢。`wiki_read` 或 `discover_data` 单次超过 5 秒也不按本定义标慢。零行成功的 `result_empty=1`。取消在有 session 时挂上 turn |
| SC-20b | P2 | 调用流水在存储慢标记为真时显示「问询慢标记」。列表字段是 `usageSlowCall`，对应 access log 的 `is_slow_call`，不是问询钻取里相对 P95 的 `isSlowCall`（「慢于多数请求」）。1.6 秒成功的 `lucy_query` 不显示。`wiki_read` 即使单次耗时很长也不显示，除非该存储标记为真。不改 Spec 143 调用监测 |
| SC-21 | P2 | `GET /api/admin/audit` 的同一时间筛选能看见 `token_expired` 与普通调用，类型字段不同。鉴权失败不写成 `lucy_query` |
| SC-22 | P2 | User-Agent `kscc-code/1.3.7 (cli)` 在 `client` 为空时解析出客户端与版本。无转发头时 `client_forwarded_for` 为空，`client_ip` 仍为对端 |
| SC-23 | P2 | 歧义列的修复提示是 ACL 内的限定名。不生成自动 join。本条测试不依赖 SC-24 的门禁 |
| SC-24 | P2 | `columns.0.type` 契约失败拒绝发布。豁免行含操作者、原因、到期时间；到期后发布再次失败。用户可见入口是工作台已有的 `validate-changed` 检查，不新增端点 |

> **SC-4 的口径说明（2026-10-29）**：SC-4 按**现行实现**判定（第 21 次数据工具或问询墙钟超过 120 秒）。问询预算优化 Spec 修订的「已结算数据处理时长」口径**自其 SC-01–SC-41 全部执行完毕并发布之日起**取代本口径，**届时 SC-4 须同期改写**；在此之前 SC-4 的表述与判定**均不变**。

客户验收基线见来源计划的表。实现测试用夹具，不把客户日志原文提交进仓库。
