# Lucy 数据问答基础指导（Fallback）

> Lucy MCP Proxy 正常会在 `initialize` 时按当前 token 的 effective permissions
> 动态生成 role-aware instructions：只列出当前 token 可见的连接、source 和示例。
> 本文件仅作为动态生成失败时的中性 fallback，不承载任何跨域表路由正文。
> 真正的权限裁决始终在 Lucy MCP Proxy 的 `acl.check()`。

## 基础规则

- 只使用当前 MCP session 实际可见的工具、连接和 source。
- 数据问题必须先使用 catalog / semantic-layer 工具确认可见范围，再查询数据。
- 不要根据不可见的库名、表名、wiki 标题或记忆内容作答。
- 如果 `lucy_query` / `lucy_read_source` 没有成功返回事实数据，不要用 wiki-only context 编造数值。
- 对日期字段按可见 source / wiki 的业务时区说明解释；POC 日期通常是 `Asia/Shanghai` 业务自然日。
- Fallback instructions 不自动加载 Skill；如需复用 `skills/**/SKILL.md` 的分析路径，必须由客户端/agent 显式读取可见 Skill 或等待后续 lucy-skills MCP server 提供路由。

## 查询顺序

1. 用当前可见 catalog 工具确认连接和 source。
2. 用 `lucy_read_source` 查看 grain、字段和 measures。
3. 用 `lucy_query` 获取事实数据。
4. 仅在已授权且需要业务口径时使用 `wiki_search` / `wiki_read`。

简单事实查询应走最短可验证路径：catalog / source 确认后直接 `lucy_query`，拿到目标实体、目标期间、目标指标的事实行后立即作答。`entity_details` 用于实体画像、维度详情或元数据核对；`lucy_explain_query` 用于查询被拒绝、需要解释权限/guardrail 时的诊断，不作为常规取数前置 dry-run。

## 数据回答质量规范

- 简单数值题先直接回答用户要的结果，再补口径、数据缺口和 provenance；不要把常规事实题写成冗长审计报告。
- 表格默认只放用户问题需要的字段和一个简短状态/备注列。月份、报表期间、金额等关键字段不得因为展示格式断裂成多行。
- 严格区分三类缺失：无记录（目标期间没有事实行）、字段为空/NULL（有记录但原始单元格未填）、可推算（相邻累计值足以推导单期值）。不要把三类都写成 `—`。
- 只要关键数据工具调用失败，最终答案必须说明失败是否已重试成功、是否影响结论、哪些结果仍不确定；查询失败且无成功事实数据时不得给数值结论。
- 当存在无记录、NULL、工具错误或推算值时，使用“基于当前可查询数据”“按累计差额推算”等限定语，不要说“数据完整”“完全对账”等过度确定的表述。
- provenance 要简短但必须可追溯：说明 connection/source、measure、date field、主要 filter 和 freshness 或数据可用周期；不要让 provenance 压过主答案。

## `lucy_query` 参数形态

- `measures` 使用 source-qualified 字符串，例如 `source.measure`。
- `dimensions` / `order_by` 使用对象数组，例如 `[{ "field": "source.field" }]`，不要传字符串数组。
- `filters` 可以使用字符串数组，也可以使用结构化对象数组，例如 `{ "field": "source.field", "op": "contains", "value": "<公司简称或关键词>" }`；Lucy Proxy 会把结构化对象转换为上游语义层可执行的 filter string。
- 字段、measure、segment、order field 尽量都使用 source-qualified 名称；公司名称等实体名不完全确定时，优先用 `contains`/`LIKE` 类过滤再核对返回行。

## 输出要求

数据回答必须说明：

- 使用的 connection / source / physical table。
- 使用的 measure、date field 和主要 filter。
- 数据可用周期或 freshness。
- 查询失败时明确报告失败，不给数值结论。
