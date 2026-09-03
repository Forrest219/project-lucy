# Lucy 查询执行与轮次归因可靠性 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | Spec |
| 版本 | v1.1 |
| 日期 | 2026-09-03 |
| 状态 | Implemented（含 UAT 后三项代码修复，待部署复验） |
| 委托人 | 张星晨 |
| 基于材料 | 脱敏后的旧版单用户对话/审计样本、Spec 07/08/09/137、当前未部署代码 |
| 适用范围 | Lucy MCP Proxy 的 `lucy_query` 参数处理、上游透传、失败契约、Session/Turn 归因与审计证据 |

## 1. 背景与判断

2026-09-03 的单用户交互复盘显示，一个复杂经营分析轮次发生 22 次工具调用，其中
`lucy_query` 16 次、失败 6 次，且最终没有交付回答。旧版日志中存在两类确定性缺陷：

1. 客户端把 `filters` 以 JSON 字符串发送时，Proxy 未恢复成结构化对象，导致上游 SQL 解析失败；
2. 客户端发送 `orderBy` 时，Proxy 没有统一成上游契约 `order_by`，最终 SQL 退化为默认排序；
3. `userId + tokenHashPrefix` 的全局近邻匹配会把同一 Token 的并发客户端或 Session 归入错误 Turn。

本 Spec 把这些问题定义为 Proxy 契约和审计可信度问题，而不是要求 Agent 通过反复改写查询碰运气。

## 2. 目标与 Non-Goals

### 目标

- 在 ACL、审计摘要和上游请求之前，将 `lucy_query` 参数规范化为唯一 canonical shape。
- 对 JSON 字符串化的 `filters` 做严格、可审计的兼容恢复；失败时 fail closed，且不请求上游。
- 把 `orderBy` / `order_by` 统一成 `order_by`，冲突时拒绝请求，不静默选择。
- 用 `identity + session` 作为 Turn 归因主键；显式 Turn 也必须验证归属。
- 审计区分显式、Session 绑定、弱推断和未归因，不能把推断值伪装成确定事实。
- 用确定性单测、Proxy 集成测试与 contract smoke 证明参数与最终生成 SQL 一致。

### Non-Goals

- 不新增 raw SQL 能力，不绕过工具、Connection 或 Source ACL。
- 不在 Proxy 内实现业务指标公式、预算口径或价格/结构拆解。
- 不把旧日志离线推断结果回填成高置信历史事实。
- 本期不做 Docker 重建、浏览器验证或生产数据库写入。

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 中文说明 | 约束 |
|---|---|---|
| Turn Attribution | 轮次归因 | 审计机器字段；UI 若展示，使用“轮次归因”，不得简称“关联成功” |
| Attribution Mode | 归因方式 | 枚举 `explicit` / `session_bound` / `identity_inferred` / `unassigned` |
| Attribution Confidence | 归因置信度 | 枚举 `high` / `low` / `none`；不得把 `low` 渲染为确定归属 |

`order_by`、`orderBy`、`filters`、错误 reason、Session ID、Turn ID 属协议/代码标识，DOM
出现时按术语规范增加翻译防御。

## 4. 查询参数 canonical contract

### 4.1 `filters`

接受以下输入：

- 单个结构化 filter 对象；
- 结构化 filter 数组；
- 为兼容已知客户端，内容以 `[` 或 `{` 开头的 JSON 字符串；解析结果仍必须满足上述两种 shape。

普通字符串只允许继续作为既有表达式 filter。看似 JSON 但无法严格解析时返回：

```text
invalid_arguments:lucy_query:filters_serialized_json_invalid
```

不得将解析失败的字符串继续交给上游。

### 4.2 排序别名

- 只传 `order_by`：直接校验并透传。
- 只传 `orderBy`：校验后写为 `order_by`，删除 `orderBy`。
- 两者同时出现且深度等价：保留一个 canonical `order_by`。
- 两者同时出现但不等价：返回
  `invalid_arguments:lucy_query:order_by_conflict`，且不请求上游。
- `order_by` / `orderBy` 的每一项都必须包含安全的语义字段引用；不安全字段返回
  `invalid_arguments:lucy_query:order_by_field_unsafe`，且不请求上游。
- `direction` 可省略；显式提供时只能是 `asc` 或 `desc`，否则返回
  `invalid_arguments:lucy_query:order_by_direction_unsupported`，且不请求上游。

排序是否生效的验收以 `lucy_query` 返回的实际 `generatedSql` 为准，不能只断言请求对象含排序字段。

### 4.3 处理顺序

canonicalization 必须发生在以下步骤之前：

1. 参数摘要与 hash；
2. Source/字段抽取和 ACL 裁决；
3. 请求重写与上游调用；
4. 审计落盘。

拒绝的请求仍写审计，但不得把完整 filter 值或业务数据写入错误详情或 `args_summary`。
`args_summary.filters` 只保留列表/单项类型、filter 数量、值数量，以及通过安全标识符校验的
字段名和操作符；非法字段名、非法操作符和所有业务值一律省略。

## 5. Turn 归因契约

Turn 状态按以下 key 隔离：

```text
identityKey = userId + ":" + tokenHashPrefix
sessionKey  = identityKey + ":" + lucySessionId
```

归因优先级：

| 优先级 | 条件 | mode | confidence |
|---|---|---|---|
| 1 | 显式 `x-lucy-turn-id` 且属于当前 identity/session | `explicit` | `high` |
| 2 | 当前 Session 有未过期 active Turn | `session_bound` | `high` |
| 3 | 无 Session，且当前 identity 只有一个未过期 active Turn | `identity_inferred` | `low` |
| 4 | 多候选、归属不符或没有候选 | `unassigned` | `none` |

显式 Turn 归属不符必须拒绝关联；是否同时拒绝业务调用由兼容性开关决定，默认调用可继续但
审计记为 `unassigned`，并记录不含敏感值的 `turn_attribution_rejected` reason。

## 6. 核心流程（伪代码）

```text
FUNCTION canonicalizeLucyQueryArgs(rawArgs):
  REQUIRE rawArgs is object
  args = shallowCopy(rawArgs)

  IF args.filters is string AND trim(args.filters) startsWith "[" OR "{":
    parsed = strictJsonParse(args.filters)
    IF parse failed:
      RETURN error("invalid_arguments:lucy_query:filters_serialized_json_invalid")
    args.filters = parsed

  VALIDATE args.filters against supported filter shapes and operators

  snake = args.order_by
  camel = args.orderBy
  IF both are present AND deepNormalize(snake) != deepNormalize(camel):
    RETURN error("invalid_arguments:lucy_query:order_by_conflict")
  args.order_by = snake OR camel
  DELETE args.orderBy
  VALIDATE args.order_by

  NORMALIZE measure references and filter operators
  RETURN ok(args)

FUNCTION resolveTurn(identity, requestSessionId, explicitTurnId):
  expire stale active turns

  IF explicitTurnId exists:
    owner = lookupTurnOwner(explicitTurnId)
    IF owner matches identity AND owner.session matches requestSessionId when both exist:
      RETURN {turnId: explicitTurnId, mode: explicit, confidence: high}
    RETURN {turnId: null, mode: unassigned, confidence: none,
            reason: turn_attribution_rejected}

  IF requestSessionId exists:
    turn = activeTurnBySession(identity, requestSessionId)
    IF turn exists:
      RETURN {turnId: turn.id, mode: session_bound, confidence: high}
    RETURN unassigned

  candidates = activeTurnsByIdentity(identity)
  IF candidates.count == 1:
    RETURN {turnId: candidates[0].id, mode: identity_inferred, confidence: low}
  RETURN unassigned

FUNCTION handleLucyQuery(request):
  canonical = canonicalizeLucyQueryArgs(request.arguments)
  IF canonical is error:
    writeDeniedAudit(canonical.reason, resolveTurn(...))
    RETURN MCP error without upstream request

  decision = enforceAcl(canonical.args)
  IF denied: audit and return denial

  upstreamArgs = rewriteForUpstream(canonical.args)
  response = callUpstream("sl_query", upstreamArgs)
  audit actual generatedSql and result metadata
  RETURN response
```

## 7. 数据与兼容性

- 旧 `access_log.lucy_turn_id` 保留；新增归因字段必须为 nullable，历史行不得伪造默认高置信值。
- 新增 `turn_attribution_mode`、`turn_attribution_confidence`、`turn_attribution_reason`；迁移为 additive、幂等。
- `conversation_turns.session_id` 同样必须通过 additive migration 补齐，不能只依赖新建表 DDL；旧审计库升级后必须仍能写入新 Turn。
- Admin API、CSV 和审计证据包必须保留 `unknown` 与 `false/0` 的差异。
- 兼容 JSON 字符串 filter 是边界适配，不代表 MCP schema 鼓励字符串化参数；文档示例继续使用结构化对象。

## 8. 验收标准

| ID | 验收 |
|---|---|
| QE-01 | 结构化与 JSON 字符串化 `filters` 生成等价上游参数 |
| QE-02 | malformed JSON-looking filter 返回稳定 reason，mock upstream 调用数为 0 |
| QE-03 | `orderBy` 与 `order_by` 生成等价上游参数 |
| QE-04 | 排序别名冲突、不安全字段、非法 direction 均 fail closed，mock upstream 调用数为 0 |
| QE-05 | `load_time desc` 在实际 `generatedSql` 中为降序 |
| QE-06 | `explain` 返回 `executionMode: plan_only`、`executed: false`，只说明计划，不宣称业务查询执行成功 |
| TC-01 | 同 Token 两个 Session 交错调用不串 Turn |
| TC-02 | 外来显式 Turn ID 不得写入当前调用 |
| TC-03 | 无 Session 的唯一候选仅标 `identity_inferred/low` |
| AU-01 | API、CSV、证据包均可导出归因方式/置信度 |
| AU-02 | 行数、列数、截断的 unknown 不得被序列化成 `0/false` |
| HC-01 | Runtime 输出在 ready 行后继续写入时，Docker healthcheck 仍稳定返回成功；命令失败或非 ready 继续 fail closed |
| ACL-01 | 发布版 Lucy 数据角色显式允许 `lucy_begin_question`；零数据源及未授权角色仍 fail closed |
| UI-01 | 两个新增参数拒绝码分别显示“筛选条件格式无效”“排序条件互相冲突”，其他 `invalid_arguments:*` 有统一中文兜底 |
| UI-02 | 访问日志与 MCP 调试台复用同一裁决原因映射，不维护前后端副本 |

## 9. 验证机制

- 单元：canonicalization、alias conflict、Turn resolver 状态表。
- Proxy 集成：真实 `POST /mcp` + mock upstream，断言拒绝不出站、成功参数和审计行。
- Contract smoke：断言排序进入上游并体现在 `generatedSql`。
- 运维脚本：使用 stub KTX/Node 执行 healthcheck，覆盖长输出、非 ready、命令失败及探针失败。
- 配置模板：静态解析发布版 `access.yaml`，校验数据角色和 Meta 工具分类。
- UI/API：裁决原因组件与 MCP 调试台共享映射测试。
- 静态：TypeScript typecheck、`lint:spec`、`lint:terminology`、`git diff --check`。
- 本期明确不执行 Docker 重建和浏览器验证。

## 10. 2026-09-03 部署后 UAT 修正

首次真实链路 UAT 发现三项非查询主链缺陷：healthcheck 的 `pipefail + grep -q` 组合造成
EPIPE 假阴性；普通发布角色遗漏问询上报工具；新增参数拒绝码缺少中文主标签。本版本将三项
缺陷纳入 HC-01、ACL-01、UI-01 和 UI-02。代码验证通过不能替代部署复验；持久化
`access.yaml` 仍须走管理员确认，不由容器启动流程自动迁移。

实施顺序与命令见
[`plans/wo-202609-03-lucy-query-and-answer-reliability.md`](plans/wo-202609-03-lucy-query-and-answer-reliability.md)。
