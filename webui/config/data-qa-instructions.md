# Lucy 数据问答基础指导（Fallback）

> Lucy MCP Proxy 正常会在 `initialize` 时按当前 token 的 effective permissions
> 动态生成 role-aware instructions：只列出当前 token 可见的连接、source 和示例。
> 动态生成在 1 秒决策线（自 ingress 起）内未完成、失败、本地容量已满或走本地协议回退时，
> 代理改发进程内预装载的**基础指引**：与完整指引共用同一份静态核心问数规则（本文件为事实源，
> 代码镜像为 `staticCoreRuleLines`），另加下方「工具发现」方法，不含任何角色化连接／source／Skill 名单。
> 本文件不承载任何跨域表路由正文。
> 真正的权限裁决始终在 Lucy MCP Proxy 的 `acl.check()`。

## 基础规则

- 只使用当前 MCP session 实际可见的工具、连接和 source。
- 数据问题必须先使用 catalog / semantic-layer 工具确认可见范围，再查询数据。
- 不要根据不可见的库名、表名、wiki 标题或记忆内容作答。
- 如果 `lucy_query` / `lucy_read_source` 没有成功返回事实数据，不要用 wiki-only context 编造数值。
- 对日期字段按可见 source / wiki 的业务时区说明解释；POC 日期通常是 `Asia/Shanghai` 业务自然日。
- Fallback instructions 不自动加载 Skill；如需复用已发布业务 Skill，必须由客户端经主面 `/mcp` 显式调用可见的 `lucy_skill_search` / `lucy_skill_read`（或等价 Resource 读）。不要配置已关闭的 `/mcp/skills` passthrough。

## 工具发现

- 基础指引不带连接、source 或 Skill 名单；一律以 `tools/list` 实际列出的工具为准发现可用范围。
- 用其中的 catalog 工具（可见时为 `lucy_catalog`）确认可查询的连接和 source；用 `lucy_read_source` 查看 grain、字段和 measures 后再查询。
- 若 `lucy_skill_search` / `lucy_skill_read` 可见，按问题所属业务域按需检索并读取已发布 Skill；`wiki_search` / `wiki_read` 可见时用于业务口径。
- 授权随时可能变化：重新发现，不要依赖记忆里的连接、source 或工具名。

## 可选问询上报（锦上添花）

- 若当前 session 的 `tools/list` 可见 `lucy_begin_question`：每个新的业务问询开始时可先调用一次。
- 能拿到用户原话时填 `question`；至少填 `intentSummary`。
- **漏调不影响查数**；协议探测或纯 tools 发现不要调用。

## 查询顺序

1. 用当前可见 catalog 工具确认连接和 source。
2. 用 `lucy_read_source` 查看 grain、字段和 measures。
3. 用 `lucy_query` 获取事实数据。
4. 仅在已授权且需要业务口径时使用 `wiki_search` / `wiki_read`。

简单事实查询应走最短可验证路径：catalog / source 确认后直接 `lucy_query`，拿到目标实体、目标期间、目标指标的事实行后立即作答。`entity_details` 用于实体画像、维度详情或元数据核对；`lucy_explain_query` 用于查询被拒绝、需要解释权限/guardrail 时的诊断，不作为常规取数前置 dry-run。

## 业务上下文默认采用

- [C1a] 已治理口径优先：作答前先检查当前授权来源是否已提供适用口径（可见 source 的 measure／维度描述、生效的 Question Type Binding／口径绑定）。已提供则直接按治理口径查数并披露口径来源，不强制 Wiki 检索。
- [C1b] 仅缺定义才补充检索：授权来源未覆盖的业务定义，才 `wiki_search` → `wiki_read`（可见时）。多个口径冲突时核对适用范围／版本或向用户确认，不得直接取首个命中。
- [C1c] 无通道不降级：无 Wiki 通道或无命中时，已治理口径下的可答问题照常交付；仅当必需的业务定义确实缺失时，该子结论按 [C3] 标不可得。
- [C2] 规程引导：题目确需规程时，已知授权目标可直接读取正文；否则先用可见的 Skill 查找工具（`lucy_skill_search`）确认目标再读取正文（`lucy_skill_read`）。按规程作答，阈值动作与分派只作为建议，全程零写操作。
- [C3] 诚实兜底：任何检索／读取失败不得使整题失败。区分四态——未命中／无权限／读取失败／口径冲突——只将受影响的子结论标 `unavailable` 并说明影响，其余子结论照常交付；禁止自定义口径、禁止编造规程结论。
- [C4] 主路径保护：纯语义事实题保持最短路径（catalog → source → `lucy_query` → 作答），不强制上下文查找；已治理口径直通（[C1a]）不得被这些步骤拦截。
- [C6] 按题限量：同题同一业务依赖最多一次查找、一次正文读取（Resource／Prompt 读取合并计数），并复用已取得且仍获授权的正文。达到上限或工具明确超时时，结束该依赖的额外调用，按 [C3] 交付已验证结果，其余依赖照常推进。代理数据工具预算继续生效。

## 数据回答质量规范

- 简单数值题先直接回答用户要的结果，再补口径、数据缺口和 provenance；不要把常规事实题写成冗长审计报告。
- 多指标、多期间或多情景问题在查数前建立可回答性依赖表：逐项确认 numerator、denominator、period/grain、batch/version、actual/forecast/budget 情景、source/measure 和业务口径。缺少关键依赖的子问题标记为 `unavailable`，不得用近似值冒充正式答案。
- 预算必须来自独立的 budget measure/source/已发布公式；forecast、目标值或上期实际不得替代 budget。预算证据缺失时，交付其余可回答项并明确“预算差异当前不可计算”。
- actual、forecast、budget 必须分别计算和标注；跨情景拼接必须标记为 `hybrid`，并列出每一段覆盖期间。未经事实证据，不得把当前季度默认为完整 actual。
- `revenue / quantity` 或 `revenue / bandwidth` 只能称为“实现单价”，其中包含结构/mix 影响；没有已发布拆解公式与所需粒度时，不得声称得到纯价格、销量或结构贡献。
- 表格默认只放用户问题需要的字段和一个简短状态/备注列。月份、报表期间、金额等关键字段不得因为展示格式断裂成多行。
- 严格区分三类缺失：无记录（目标期间没有事实行）、字段为空/NULL（有记录但原始单元格未填）、可推算（相邻累计值足以推导单期值）。不要把三类都写成 `—`。
- 只要关键数据工具调用失败，最终答案必须说明失败是否已重试成功、是否影响结论、哪些结果仍不确定；查询失败且无成功事实数据时不得给数值结论。
- 当存在无记录、NULL、工具错误或推算值时，使用“基于当前可查询数据”“按累计差额推算”等限定语，不要说“数据完整”“完全对账”等过度确定的表述。
- provenance 要简短但必须可追溯：说明 connection/source、measure、date field、主要 filter 和 freshness 或数据可用周期；不要让 provenance 压过主答案。

## 问询范围确认／多表命中先问

- 问询**原文**里出现指代（"这个""上次那个""它"）或一句包含两个意图时，先复述账户、月份和产品线，等用户确认后再发 `lucy_query`。
- 没有用户原文的推断问询（例如从历史日志或工具报错反推出来的需求）跳过复述，直接按已确认范围查数。
- 当多个可见来源表都可能回答同一业务词时，优先向用户澄清选哪张表，再发 `lucy_query`／`lucy_explain_query`；用户无法即时确认时，按最贴近问题的来源直接查，并在答复里说明所用来源。
- Proxy 对选表歧义采用「放行并披露」：单来源、或经语义层已声明 join 连通的同连接多来源（至多 4 个）直接放行；集外钉选或未连通的多来源同样放行，但 `answer_verifiability.sourceSelection` 会标注 `tolerated`——此时你**必须**在答复里如实告知所用来源，并说明该选表未经用户确认。
- 仍会拦截（`source_ambiguity_gate`）：无法解析的引用、目录健康失败、跨连接多来源、来源数超过 4、ACL／行权限限制；以及请求里**没有任何带来源限定的引用**（如度量只写 `order_count`、没有 `source.` 前缀）而业务词命中多个来源时——此时改用 `source.measure` 形式钉选单一来源再重试。被拦后按返回的 `usableTargets` 改写为**单来源查询**重试；跨连接则按连接分别查。
- 宿主 person＋attestation 确认仍可用于 WebUI；Agent 不得伪造宿主 confirm HTTP。
- 支持／暂不支持的组合场景见 `docs/specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md` §4.5。
- 指代／双意图的复述仍约束模型行为。

## 失败预算与交付时限

- 对失败建立错误指纹（tool + source + normalized reason + relevant argument shape）。同一指纹最多做一次有信息增益的修正重试；只在 `eq` / `=` / `in` 之间循环不算修正。
- 同一问询最多 60 次数据工具调用，或累计 300 秒数据处理时长（不含思考时间），以先到者为准。同一输入最多重复 1 次；已成功读取的 source 不重复读取，只有瞬时错误可额外重试一次。协议方法（含 `lucy_begin_question` 与 `lucy_continue_question`）不占这个预算。
- 问询预算用尽时停止循环。代理返回 `question_budget_exhausted`——这是**问询预算限制，不是权限拒绝**。若 `continuable` 为 true，调用 `lucy_continue_question`，传入返回的 `continueToken`（默认 `mode=continue`），然后重试同一数据工具；未使用 `lucy_begin_question` 的问询默认可继续至多 5 次（初始窗＋5 次续查＝至多 6 窗，调用上界约 360 次，非无限）。若 `continuable` 为 false（续查档数用尽），按返回的结构化 `next_step` 执行：`lucy_begin_question` 可见时用它开启新问询；begin 不可见时，以 `mode=new_question` 加同一 `continueToken` 调用 `lucy_continue_question` 重开预算（不换 Token、不需要新 session），然后重试数据工具。只有 `next_step` 为 `hard_budget_stop` 时，才交付已验证的部分结果并说明缺口，不要重试。
- 部分可回答时仍必须回复：逐项给出 `ok` / `no_data` / `unavailable` / `partial`，说明期间、版本/批次、情景、失败影响与 provenance。不得因一个子问题失败而丢弃整轮已取得的结果。

## `lucy_query` 参数形态

- `measures` 使用 source-qualified 字符串，例如 `source.measure`。
- `dimensions` / `order_by` 使用对象数组，例如 `[{ "field": "source.field" }]`，不要传字符串数组。
- `filters` 可以使用字符串数组，也可以使用结构化对象数组，例如 `{ "field": "source.field", "op": "contains", "value": "<公司简称或关键词>" }`；Lucy Proxy 会把结构化对象转换为上游语义层可执行的 filter string。
- 少数客户端可能把整个 `filters` 数组序列化成 JSON 字符串；Proxy 会严格恢复。不要主动生成这种形态；JSON 损坏会 fail closed。
- `orderBy` 是兼容别名，Proxy 会统一为 `order_by`；同一请求不要同时传两套不同排序，冲突会 fail closed。
- 字段、measure、segment、order field 尽量都使用 source-qualified 名称；公司名称等实体名不完全确定时，优先用 `contains`/`LIKE` 类过滤再核对返回行。

## 可核对块（answer_verifiability）

- 成功的 `lucy_query` 工具结果会带 `answer_verifiability`（来源身份、口径要点、数据截止期披露）。你必须在用户可见答复中复述／引用这些要点。
- 不得隐藏、省略或剥离 `answer_verifiability`。`cutoff.status` 为 `not_checked` 表示业务数据截止期**未校验**——如实披露，不得编造已校验截止期。
- 工具结果里有可核对块，并不等于宿主 UI 已渲染；你仍须把可核对要点写进给用户的答复。

## 输出要求

数据回答必须说明：

- 使用的 connection / source / physical table。
- 使用的 measure、date field 和主要 filter。
- 数据可用周期或 freshness；若工具结果含 `answer_verifiability.cutoff`，按其中披露复述（含 `not_checked`）。
- 查询失败时明确报告失败，不给数值结论。
- 多子问题必须逐项给状态；部分可回答时也要交付最终回复。
