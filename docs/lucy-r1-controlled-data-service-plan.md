# Lucy R1 受控数据服务层底座方案与实施计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy R1 受控数据服务层底座方案与实施计划 |
| 文档类型 | Design / Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-02 |
| 适用范围 | Lucy R1 平台能力规划、实施排期、验收口径 |

## 1. 定位

Lucy R1 的核心角色是面向 AI Agent 的受控数据服务层底座。

Lucy 不负责 BI 资产梳理、业务 owner 协调、权限审批流程或指标口径仲裁。这些工作由外部 workflow 完成。Lucy 负责承接外部 workflow 已确认的数据资产、语义、权限策略和测试集，并把它们稳定地转化为 Agent 可调用、权限可控、查询可守护、行为可审计、质量可回归、运行可观测的数据服务。

R1 主线：

```text
Agent
  -> Role-aware MCP Tools
  -> Policy Runtime
  -> Query Guardrail
  -> Doris / 目标源
  -> 安全结果返回
  -> 审计链路
  -> Eval 门禁
  -> 可观测性
```

一句话目标：

> 先把 Doris 打穿，再把它包进稳定 MCP 契约，随后加 Policy、Guardrail、Role-aware runtime、审计、Eval 和可观测性，形成生产级受控数据服务底座。

## 2. R1 非目标

R1 明确不做：

- BI 报表资产盘点。
- 业务 owner 口径仲裁。
- 权限审批流程。
- 自助取数门户。
- BI 可视化。
- 跨源联邦查询。
- 多租户 SaaS。
- 企业 SSO / IAM。
- 行级权限。
- 列级权限。
- 字段脱敏策略引擎。
- 动态 masking。

R1 只做 tool / connection / source / table / view 级授权，加 Query Guardrail。

## 3. 核心能力

| 模块 | R1 要做什么 | 验收标准 |
|---|---|---|
| Doris / 目标源适配 | 打穿目标数据源连接、只读查询、SQL 方言、类型映射、分页、超时、错误归因 | Agent 可通过 Lucy 查询 Doris 权威视图；禁止写操作；慢查询和失败可归因 |
| MCP 工具契约 | 定义少而硬的工具面，不暴露混乱能力 | 工具列表稳定，文档清晰，Agent 不需要知道底层数据库连接 |
| Policy Runtime | 执行 token / role / tool / connection / source / table / view 授权 | 未授权工具、source、表、视图访问必须 fail-closed，并写 denied audit |
| Query Guardrail | 对合法工具调用继续做运行时保护 | 禁止 DML/DDL；限制 raw SQL；限制行数、超时、并发、敏感 source；所有拒绝有 reason |
| Role-aware Runtime | 不同 role 看到不同 catalog、source、tool、instructions | Agent 只能发现自己有权访问的资产，不泄露不可见表名和口径 |
| 审计链路 | 记录一次业务问题下的完整工具调用链 | 可追溯 question、user/token、tool、source/table、query 摘要、结果规模、拒绝原因、耗时 |
| Eval 门禁 | 对业务正确性和安全行为做回归 | 语义/policy/tool 变更后可跑 benchmark；失败阻断发布或标记风险 |
| 可观测性 | 服务运行状态和问题归因 | 有请求量、错误率、拒绝率、延迟、慢查询、数据源失败、eval 通过率等指标 |

## 4. MCP Tool Contract

R1 工具面暂定保留以下 6 个工具：

| Tool | 作用 |
|---|---|
| `lucy_catalog` | 返回当前 role 可见的数据资产目录 |
| `lucy_read_source` | 读取某个 source 的字段、指标、语义、限制、freshness |
| `lucy_query` | 执行受控语义查询 |
| `lucy_explain_query` | 返回权限判断、guardrail 判断、source 命中、查询计划解释 |
| `lucy_freshness` | 查询 source 数据新鲜度 |
| `lucy_begin_question` | 标记一次业务问题，串联后续审计链路 |

直接 SQL 工具默认不暴露。即使内部支持，也必须被 Policy Runtime 和 Query Guardrail 包裹。

## 5. Policy Runtime

R1 必须硬执行：

- token 识别。
- role 解析。
- tool allowlist。
- connection allowlist。
- source / table / view allowlist。
- 全局 deny tools。
- 查询只读约束。
- 最大返回行数。
- 超时限制。
- denied audit。

安全原则：

- 默认 fail-closed。
- 不可见资产不得出现在 catalog、instructions 或错误信息中。
- instructions 只是引导层，不是安全边界。
- 真正授权必须发生在 `tools/list` 改写、`tools/call` ACL、query 解析、source/table 裁决、返回结果过滤和 audit 记录。

## 6. Query Guardrail

R1 最小 guardrail 集合：

| Guardrail | 行为 |
|---|---|
| 只读校验 | 拒绝 `INSERT` / `UPDATE` / `DELETE` / `DROP` / `ALTER` 等 |
| 表解析 | 从 tool args、query、filter、where 等字段中解析访问 source/table |
| 未授权拒绝 | 命中未授权 source/table 直接拒绝 |
| 行数限制 | 默认 limit，上限不可由 Agent 任意突破 |
| 超时限制 | 超时中断并审计 |
| 并发限制 | 限制单 token 同时执行的 `lucy_query` 数量，超限拒绝并审计 |
| 结果截断 | 大结果返回摘要和截断标记 |
| 错误归因 | 区分权限拒绝、SQL 错误、数据源超时、语义缺失、系统错误 |
| provenance | 返回 connection/source/measure/filter/freshness/truncation 信息 |

## 7. Hermes 95% QA Accuracy Gate

R1 增加一个业务验收门槛：

```text
Hermes Agent 通过 Lucy MCP Proxy 访问 Doris/目标源，
在 R1 benchmark 题集上总体问答准确率 >= 95%，
且安全回归用例 100% 通过。
```

该目标只适用于已确认数据域、已授权资产、已定义 ground truth 的 benchmark，不泛化为所有自然语言问题。

| 项 | 内容 |
|---|---|
| 验收对象 | Hermes Agent + Lucy MCP Proxy + Doris/目标源 |
| 验收范围 | R1 已上线主题，例如 CEO一眼报及后续主题 |
| 题集来源 | 外部 workflow 整理后的 benchmark questions |
| 最低题量 | 首期建议不少于 100 题；CEO一眼报 MVP 可先 30-50 题 smoke |
| 准确率目标 | 总体 >= 95% |
| 核心指标题 | 核心指标类问题准确率必须 100% |
| 安全底线 | 任一越权泄露、不可见 source 泄露、DML/DDL 未拦截，直接失败 |
| 记录内容 | 问题、Hermes 答案、Lucy trace、查询 source、语义查询/SQL、Lucy `_meta.lucy` provenance 或受控拒绝 reason、预期答案、判分结果；题集必须全量覆盖，每个 benchmark case 只能提交一次，每道题必须有唯一 Lucy trace |
| 输出物 | Hermes QA Accuracy Report |

判分原则：

| 题型 | 判定标准 |
|---|---|
| 数值题 | 数值在容差范围内，且口径、时间、过滤条件正确 |
| 排名题 | 排名集合和排序正确 |
| 明细题 | 返回对象集合正确，无未授权字段 |
| 解释题 | 解释符合 Wiki/语义层口径，不能编造 |
| 不可回答题 | 正确拒绝或说明缺少数据，而不是幻觉 |
| 权限题 | 未授权问题必须拒绝，不能泄露不可见资产 |

## 8. Eval 门禁

Lucy 的 Eval 不只测问答准确率，也要测服务底座的安全行为。

| 类型 | 要测什么 |
|---|---|
| Business correctness eval | 指标数值、过滤条件、时间口径、解释、来源引用 |
| Security regression eval | 越权拒绝、不可见 source 不泄露、raw SQL 拦截、敏感字段不返回、disabled token 失效 |
| MCP contract eval | 工具 schema、返回结构、错误码、可见工具列表稳定 |
| Doris smoke regression | 连接、只读、limit、timeout、类型映射、错误归因 |

触发规则：

```text
语义包变更 -> business eval
policy 变更 -> security eval
tool contract 变更 -> contract eval
目标源适配变更 -> Doris smoke + regression
```

## 9. 可观测性

R1 可观测性优先服务问题归因，而不是先做复杂大屏。

必须能回答：

- 谁问的？
- 用哪个 token / role？
- 看到了哪些 tool？
- 查了哪个 source？
- 为什么被拒绝？
- SQL/语义查询耗时多少？
- Doris 是否慢或报错？
- 返回多少行/列？
- 是否截断？
- Eval 最近是否退化？

最小指标：

- 请求量。
- 成功率 / 错误率。
- denied rate。
- p50 / p95 latency。
- slow query list。
- source error distribution。
- token / role 使用统计。
- eval pass rate。
- Hermes QA accuracy。

## 10. 实施计划

### Phase 0：R1 范围复核与契约草案

时间：2026-07-02 至 2026-07-08

目标：冻结 R1 边界和工具契约，避免后续做散。

交付：

- Lucy R1 范围说明。
- MCP Tool Contract 草案。
- Doris 技术风险清单。
- 错误码与 deny reason taxonomy 草案。
- Query Guardrail 最小规则集。
- Eval 类型定义：业务正确性、安全回归、MCP contract、Doris smoke。
- Hermes 95% QA Accuracy Gate 口径、题集格式、判分规则。

验收：

- 明确 R1 只做平台底座，不做资产梳理/审批流。
- 工具面控制在 6 个强契约工具。
- 行级/列级权限冻结为 R1 非目标。
- 所有后续开发都能对齐 contract。

### Phase 1：Doris Vertical Slice

时间：2026-07-09 至 2026-07-21

目标：Doris 是必须项和最高风险项，先打穿端到端 vertical slice。

交付：

- Doris 连接配置。
- 只读账号验证。
- SQL 方言兼容验证。
- `LIMIT` / pagination 策略。
- 类型映射。
- timeout / cancellation。
- 错误归因映射。
- smoke test dataset。
- 最小 Hermes smoke：Hermes 通过 Lucy 能查询 Doris 并回答少量样例问题。
- 性能基线。

验收：

- Lucy 能稳定连接 Doris。
- 只读账号只能读。
- `LIMIT` / 分页 / 类型映射可靠。
- Doris SQL 方言和当前语义查询生成兼容。
- DDL / DML 能被 Lucy 拦截。
- 慢查询 / 超时 / SQL 错误能分类。
- 查询结果带 source、row count、truncation、freshness metadata。

如果 Phase 1 过不了，后续 MCP、Policy、Eval 不进入大规模实现。

### Phase 2：MCP 工具契约落地

时间：2026-07-22 至 2026-08-04

目标：形成 Lucy 自己稳定的 MCP tool surface，而不是只代理上游工具。

交付：

- `lucy_catalog`。
- `lucy_read_source`。
- `lucy_query`。
- `lucy_explain_query`。
- `lucy_freshness`。
- `lucy_begin_question`。
- Tool schema。
- 参数校验。
- 统一返回 envelope。
- 统一错误码。
- contract tests。
- runtime contract smoke evidence。
- tool 文档。

验收：

- Agent 不需要知道底层数据库连接。
- 不同 role 只能看到允许的 tools。
- 工具返回结构稳定，可被 Eval 和审计复用。

### Phase 3：Policy Runtime

时间：2026-08-05 至 2026-08-18

目标：把 token / role / tool / connection / source / table / view 授权做成硬边界。

交付：

- role 解析增强。
- tool allowlist。
- connection allowlist。
- source/table/view allowlist。
- deny reason 标准化。
- fail-closed 行为。
- permission snapshot。
- policy contract tests。

验收：

- 未授权 tool 拒绝。
- 未授权 source/table/view 拒绝。
- 不可见资产不出现在 catalog / instructions / error message 中。
- 所有拒绝写 audit。

### Phase 4：Query Guardrail

时间：2026-08-19 至 2026-09-01

目标：Agent 即使调用了合法工具，也不能发散成危险查询。

交付：

- 只读校验。
- raw SQL 限制策略。
- source/table 解析。
- 最大行数限制。
- query timeout。
- 结果截断。
- sensitive source 防护钩子。
- error taxonomy。
- provenance metadata。
- guardrail tests。

验收：

- DDL/DML 全部拒绝。
- 未授权表名藏在 query/filter/where 中也不能绕过。
- 大结果必须截断并标记。
- 超时和慢查询可审计。
- Agent 输出可说明 source、filter、freshness、truncation。

### Phase 5：Role-aware Runtime

时间：2026-09-02 至 2026-09-10

目标：让不同 role 拿到不同运行时上下文，但不把 instructions 当安全边界。

交付：

- role-aware `tools/list`。
- role-aware `lucy_catalog`。
- role-aware initialize instructions。
- 当前 role 可见 source 摘要。
- 当前 role 查询顺序说明。
- 当前 role 输出要求说明。
- fallback instructions。

验收：

- 每个 token 初始化时拿到自己的数据范围说明。
- 不可见 source 不出现在 catalog 和 instructions。
- instructions 注入失败不影响 session 建立。
- 真正权限仍由 Policy Runtime 裁决。

### Phase 6：审计链路

时间：2026-09-11 至 2026-09-18

目标：从单次 tool log 升级为业务问题级 trace。

交付：

- question-level trace。
- `lucy_begin_question` 与后续 calls 绑定。
- tool call audit。
- denied audit。
- query 摘要 / hash。
- result row/column count。
- truncation 标记。
- duration / error detail。
- audit export。
- trace detail API。

验收：

- 能回答“谁在什么时候问了什么，查了哪些 source，为什么成功/失败/被拒”。
- 每个 denied 都有 reason。
- 每次查询能追溯到 token、role、source、guardrail 结果。
- 审计数据可导出作为验收证据。

### Phase 7：Eval 门禁与 Hermes 95% 验收

时间：2026-09-19 至 2026-09-25

目标：把 Lucy 的发布质量变成可回归，而不是靠人工试问。

交付：

- business correctness eval runner。
- security regression eval runner。
- MCP contract eval。
- Doris smoke regression。
- policy regression。
- Hermes QA Accuracy Report。
- eval artifact。
- pass/fail gate。
- trend record。

验收：

- Hermes Agent 通过 Lucy MCP Proxy 访问 Doris/目标源，在 R1 benchmark 题集上总体问答准确率 >= 95%。
- benchmark 题集全量覆盖，不允许挑题提交结果，也不允许重复提交同一个 case。
- 核心指标类问题准确率 100%。
- 安全回归用例 100% 通过。
- benchmark 每道题都有唯一 Lucy trace，可追溯具体 tool call；每个 benchmark case 只能对应一条结果。
- benchmark 每道题都有 Lucy 受控链路证据：成功取数题带 `_meta.lucy` contract / provenance / freshness / truncation，安全拒绝题带 policy 或 guardrail reason。
- 越权拒绝用例稳定通过。
- 不可见 source 不泄露。
- raw SQL / DDL / DML 拦截有效。
- benchmark 数值类问题可对比预期答案。
- 失败能归因到 query、policy、source、freshness 或 eval case。

### Phase 8：可观测性与 R1 收口

时间：2026-09-26 至 2026-09-30

目标：形成可运行、可排障、可交接的 R1 底座。

交付：

- 请求量。
- 成功率 / 错误率。
- denied rate。
- p50 / p95 latency。
- slow query list。
- source error distribution。
- token / role 使用统计。
- eval pass rate。
- Hermes QA accuracy。
- release checklist。
- runbook。
- rollback checklist。

验收：

- 能快速判断问题来自 Agent、Policy、Guardrail、Doris、语义缺失还是 Eval case。
- R1 有明确发布门禁。
- 具备最小运维交接材料。

## 11. 优先级

P0 必须完成：

- Doris / 目标源适配。
- MCP Tool Contract。
- Policy Runtime。
- Query Guardrail。
- Role-aware catalog。
- 审计链路。
- 安全 Eval。
- Hermes 95% QA Accuracy Gate。
- 基础可观测性。

P1 尽量完成：

- Role-aware instructions 完整生成。
- business correctness eval。
- freshness 工具。
- audit export。
- slow query 分析。
- release checklist。

P2 R1 后续：

- 冷归档。
- K8s / Helm。
- 多 Agent A/B Eval。
- 告警通道。
- 外部审批流集成。
- 企业 SSO / IAM。

## 12. R1 发布门槛

R1 发布必须同时满足：

- Doris vertical slice 通过。
- MCP Tool Contract regression 通过。
- MCP contract smoke evidence 通过。
- Policy Runtime 安全回归通过。
- Query Guardrail 安全回归通过。
- Role-aware catalog 不泄露不可见资产。
- 审计链路可追溯 question-level trace。
- Hermes Agent benchmark 问答准确率 >= 95%。
- Hermes benchmark 题集全量覆盖，不能缺题或重复提交同一 case。
- 核心指标类问题准确率 100%。
- 安全回归用例 100% 通过。
- Hermes benchmark 每道题都有唯一 Lucy trace。
- 基础可观测性可用于问题归因。
