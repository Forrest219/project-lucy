# MCP Auth Proxy — 访问日志与多用户权限 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP Auth Proxy — 访问日志与多用户权限 Spec |
| 文档类型 | Spec |
| 版本 | v1.6.0（AC-P1.5 契约补丁：Agent Constraints / FinalRows AND 裁决码；**不改 runtime 直至 Spec 100 Gate B**） |
| 撰写日期 | 2026-06-18；v1.2 修订 2026-06-21；v1.3 修订 2026-06-23；v1.4 补丁 2026-08-08；v1.4.1 2026-08-08；v1.5.0 2026-08-09；v1.6.0 2026-08-09 |
| 撰写人 | Claude (Opus 架构设计)；v1.4 / v1.4.1 / v1.5 / v1.6 Cursor Agent |
| 委托人 | 张星晨 / xingchen |
| 基于材料 | project-lucy 代码库、KTX 上游源码；`design-upgrade.md` v1.1.2；Spec 98；Spec 99；Spec 100；`adr-upstream-forced-predicate.md` Gate A 已批准 |
| 适用范围 | MCP Auth Proxy 契约；v1.6 **不改变现网 runtime** 直至 Spec 100 Gate B + WP-I\*（P1 runtime 已按 Spec 99 交付） |
| 输出位置 | `webui/docs/07-mcp-auth-proxy-spec.md` |
| 冲突裁决 | AC-P0 → Spec 98；AC-P1 行授予 → Spec 99；AC-P1.5 Constraints → Spec 100；与 `design-upgrade.md` / Gate A ADR 冲突 → design-upgrade / ADR |

---

## 0. AC-P0 契约补丁（WP-S1）

> **权威语义（禁止另立口径）：** Capability 代数、Tool Class 全表、Canonical Source Key、`permission_model_version`、编译 / 提交 / 降级、Deny 全表 → [`98-access-control-p0-runtime-spec.md`](98-access-control-p0-runtime-spec.md)。  
> **AC-P1 行授予 / 强制谓词：** [`99-access-control-p1-row-policy-spec.md`](99-access-control-p1-row-policy-spec.md)；Gate A [`adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md)。  
> **AC-P1.5 Agent Constraints / FinalRows AND：** [`100-access-control-p15-agent-constraints-spec.md`](100-access-control-p15-agent-constraints-spec.md)。  
> **设计清单：** [`docs/access-control/design-upgrade.md`](../../docs/access-control/design-upgrade.md) §9。  
> 本节只把 Proxy / 审计契约钉到 Spec 07；Admin UI / API 见 Spec 14 / 15。

### 0.0 AC-P1 契约补丁（v1.5 / WO-60 WP-S2；已交付基线）

| 项 | AC-P0（v1.4.x） | AC-P1（本补丁） | Spec 99 锚点 |
|---|---|---|---|
| 行级波次 | AC-P0 不交付 scoped；AC-P1 另批 | **已交付**允许 `row_access: scoped` + `row_policy`；强制谓词经 `lucy_query`→`forced_filters` | §3–§6 |
| 未包装 / 非注入通道 | 仅 capability | 受保护源另加 `row_policy_requires_wrapped_tool`（O2；含 `lucy_read_source` / `lucy_freshness`） | §5.2 |
| 未证明取数 | — | `row_policy_upstream_unproven`（proven 前取数 fail-closed） | §6.3 |
| 禁止查询形态 | guardrail 子集 | 受保护源：`row_policy_query_shape_forbidden`（括号/自连接/LEFT JOIN/聚合·HAVING/子查询等） | §6.2 |
| Agent Constraints | 未交付 | P1 阶段配置出现 `constraints` → 拒绝；**P1.5 见 §0.0a** | §4.3 → Spec 100 |

### 0.0a AC-P1.5 契约补丁（v1.6 / WO-61 WP-S1）

| 项 | AC-P1（v1.5） | AC-P1.5（本补丁） | Spec 100 锚点 |
|---|---|---|---|
| Agent `constraints` | 出现即拒绝 | Spec 100 Gate B 后：合法 shape 可编译；参与 `FinalRows = EffectiveRowGrant AND AgentConstraints`（DNF） | §3–§5 |
| Role `constraints` | 拒绝 | **继续拒绝** `constraints_forbidden_on_role` | §3.3 |
| TokenScope | ≡ TRUE | **仍 ≡ TRUE**（Non-Goal；不引入 token 行谓词） | §2 |
| FinalRows / 受保护源 | ≈ EffectiveRowGrant | Constraints 可导致非 TRUE；注入 / O2 / unproven **复用** Spec 99 路径 | §5 / §7 |
| 编译失败码 | — | `constraints_invalid_shape` / `constraints_source_not_in_capability` / `final_rows_limit_exceeded` / `final_rows_unsatisfiable` | §11 |
| explain | E1–E5（P1） | 须含 **FinalRowsDigest**（Spec 100 §8；剪枝后 DNF）；不得暗示已取数 | §7 |

**本补丁不授权改 runtime**，直至 Spec 100 Gate B 批准。—— **Gate B 已于 2026-08-09 批准**；runtime 变更仅限 WO-61 WP-I\*。

### 0.1 相对 v1.3 的契约增量

| 项 | v1.3（现网文档） | AC-P0（本补丁） | Spec 98 锚点 |
|---|---|---|---|
| 数据面授权 | tools 与 tables 独立并集后做表检查 | `(tool, canonicalSourceKey)` ∈ Effective Data Capabilities；禁止 `(∪tools)×(∪sources)` | §5 |
| DataPlane 拒绝主码 | `table_forbidden:<table>` | `capability_forbidden:<tool>:<sourceKey>`（实施后主码；可短暂双写兼容审计） | §10.2 |
| 工具分级 | `defaults.deny_tools` + known tools | AbsoluteDeny / DataPlane / Meta；**未分类 = AbsoluteDeny**；`sl_*` 代码基线不可移除 | §4 |
| 策略版本 | snapshot hash / source map mtime 叙述 | `policyVersion = sha256(accessConfigDigest \|\| sourceMapVersion \|\| toolClassificationVersion)` | §8.1 |
| 行级表述 | Non-Goals「不实现行级权限」 | **波次边界**：AC-P0 不交付 scoped；**AC-P1 行授予见 Spec 99 / §0.0**（本 Spec v1.5） | §2 / Spec 99 |
| Agent 绑定 | `users[].role` 单 Role | `roles[]` Role Set；legacy `role: x` ≡ `roles: [x]`（Admin 见 Spec 14） | §3 |
| 审计 | snapshot hash / decision_reason | + `policy_version`、capability digest、`toolClassificationVersion`、`policy_scope_expanded`、降级事件 | §10.3 |

### 0.2 裁决码（增量；完整表见 Spec 98 §10.2）

现网 §6.1.1 枚举**继续有效**；AC-P0 实施后 DataPlane 源级拒绝**主裁决码**为：

```text
capability_forbidden:<tool>:<sourceKey>
```

其中 `<sourceKey>` 的展示 / 序列化口径遵循 Spec 98 §6（Canonical Source Key；禁止裸 `sourceName` / 裸 `physicalTable` 作唯一身份）。

新增 / 收紧码（实现以 Spec 98 §10.2 为准，此处不复述全表）：

| Code | 用途 |
|---|---|
| `capability_forbidden:<tool>:<sourceKey>` | DataPlane 缺 `(tool, source)` capability |
| `tool_absolute_deny:<tool>` | 代码基线 AbsoluteDeny（含 `sl_query` / `sl_read_source` 等） |
| `tool_unclassified:<tool>` | 未分类工具按 AbsoluteDeny |
| `policy_degraded_deny` | 策略降级态导致的 DataPlane deny |
| `row_policy_requires_wrapped_tool` | **AC-P1**：受保护源上非 `lucy_query` 取数通道（Spec 99 §9） |
| `row_policy_upstream_unproven` | **AC-P1**：取数且 FinalRows≠TRUE 且上游契约未证明 |
| `row_policy_query_shape_forbidden` | **AC-P1**：受保护源禁止的查询形态 |
| `row_policy_field_unresolved` | **AC-P1**：`row_policy.predicates[].field` 无法绑定到当前源已知字段（Spec 99 §3.2；多为编译/保存失败，亦可出现在 dryRun） |
| `constraints_forbidden_on_role` | **AC-P1.5**：Role 出现 `constraints`（编译 / lint） |
| `constraints_invalid_shape` | **AC-P1.5**：Agent constraints 结构非法 |
| `constraints_source_not_in_capability` | **AC-P1.5**：Constraints 引用无 capability 源 |
| `final_rows_limit_exceeded` | **AC-P1.5**：突破 Spec 100 §6 精确上限 |
| `final_rows_unsatisfiable` | **AC-P1.5**：Constraints 不可满足，或 DNF 剪枝后无剩余臂 |

`table_forbidden:<table>`：AC-P0 实施后**停止作为 DataPlane 主裁决码**；可短暂双写以兼容审计筛选；Admin 审计 UI 筛选项须补 `capability_forbidden`（术语与文案见术语标准 §4.8）。AC-P1 实施后审计筛选项须另补上表 `row_policy_*` 码；AC-P1.5 另补 `constraints_*` / `final_rows_*`。

#### explain / FinalRows digest（AC-P1.5）

`lucy_explain_query` 本地安全响应（ADR E1–E5）在 Spec 100 Gate B 后须额外满足：

| 字段（逻辑名） | 要求 |
|---|---|
| `finalRowsDigest` / 等价 | 每受保护源展示 Spec 100 §8 `FinalRowsDigest`（剪枝后 DNF；值侧保留 JSON 标量原值） |
| ForcedPredicateAST 摘要 | 与注入载荷一致；含 Constraints 贡献 |
| 文案 | 仍为权限/强制谓词诊断；**≠** 数据已返回 |

### 0.3 Tool Class 与 AbsoluteDeny（指针）

- 三分级定义与**全量分类表**不得在本文另写副本 → Spec 98 §4.1–§4.2。
- `defaults.deny_tools` 仍为 YAML 双保险；**不能**解除代码基线 AbsoluteDeny（U-DENY-01）。
- `tools/list` 与 `tools/call` 双重授权不变；DataPlane 工具可见性由「是否存在至少一条 capability」推导（Spec 98 §4.6）。
- 唯一上游数据闸门：`authorizeAndRewrite`（Spec 98 §4.6 / §10.1）；**全部 DataPlane**（含 freshness / explain / 未包装工具）均须过闸，不得旁路。

### 0.4 `policyVersion` 与编译输入

热路径只读当前原子引用的 Effective Policy（含 `policyVersion`）。编译输入与哈希定义 → Spec 98 §8.1；Admin 收窄提交与 `runtimeAck` → Spec 98 §8.2 / Spec 14·15。本文不另定义哈希公式。

### 0.5 审计 schema 增量（对齐 design-upgrade §9）

在既有 `access_log` / `permission_snapshots` / `config_change_log` 上增加（列名可实现为独立列或约定 metadata key；须可查询）：

| 表 | 字段 / 事件 | 语义 |
|---|---|---|
| `access_log` | `policy_version` | 当次裁决所用 `policyVersion` |
| `permission_snapshots` | capability digest；`toolClassificationVersion` | 与 `resolved_json` / roles 一并复盘「当时有效 capability」 |
| `config_change_log` | `policy_scope_expanded` | legacy v1 `prefix` 因 source map 变化导致授权集合扩大时的**显式**记录（不得静默） |
| `config_change_log` | 策略降级进入 / 恢复事件 | 对应 Spec 98 §8.3–§8.4；健康检查须区分「服务可用」与「策略降级」 |

canonical source keys 继续经 `access_log_sources`（Spec 08）落库；键口径升级为 Spec 98 §6。

### 0.6 Gate B P0 正文对齐（v1.4.1）

Gate B 审阅要求：§0 指针正确不足以过关——下文 **§5.1.2 / §5.1.3 / §6** 及 Role 示例不得再写与 Spec 98 冲突的旧语义。本版已按下列项改写（权威仍在 Spec 98）：

| Gate B ID | 正文落点 | 对齐 Spec 98 |
|---|---|---|
| P0-1 | §5.1.2 | §8.2–§8.3：非法 / 收窄失败不得沿用更宽旧权 |
| P0-2 | §6 | §6 / §8.1：`(connectionId, sourceName)` 正向键；反向 `(connectionId, physicalTable)`；mtime 检测须触发重编译 |
| P0-3 | §5.1.3 | §7：`prefix` 仅 legacy v1；v2 禁用；扩权须 `policy_scope_expanded` |
| P0-4 | §5.1 / §5.1.1 / §6.2 示例 | §4：Role.tools 用 `lucy_*`；`sl_*` = AbsoluteDeny |

### 0.6 与 design-upgrade §9 对照（本文件范围）

| design-upgrade §9 行 | 本补丁落点 | 状态 |
|---|---|---|
| Spec 07：`capability_forbidden`；工具分级；`policyVersion`；波次边界 | §0.2–§0.4、§3 | **草稿** |
| 审计 schema：`policy_version` / digest / `policy_scope_expanded` / 降级 | §0.5 | **草稿** |
| Admin 审计 UI 筛选项补 `capability_forbidden` | §0.2（契约要求）；UI 实现属 WP-I6 | 契约已登记 |
| 术语标准 | Spec 98 WP-S0 / `00-product-terminology-standard.md` | 已由 WP-S0 |
| Admin API `roles[]` / `runtimeAck` / 迁移 | Spec 14 / 15 WP-S1 | 见彼处 |
| Security Eval / vision.md | 非本文；见 Spec 98 §12 | 延后 |

---

## 1. 问题陈述

project-lucy 以 KTX HTTP MCP server（`localhost:7878/mcp`）暴露数据问答工具。当前状态：

- 所有客户端（张三的 Hermes、李四的 Cursor）共享同一个全局 Bearer token
- `userId` 在 KTX 源码中硬编码为 `'local'`，无多用户感知
- 没有访问记录，无法追溯谁查了什么表
- 无法做表级权限隔离（张三能看的表 ≠ 李四能看的表）

## 2. 目标与验收标准

| 目标 | 验收标准 |
|---|---|
| 访问可观测 | 任意工具调用 5 秒内写入 SQLite，含用户、工具、表名、耗时、结果 |
| 用户身份识别 | 张三、李四各用独立 Bearer token，代理正确映射到 userId |
| 表级权限控制 | 张三访问未授权表，代理返回 JSON-RPC 错误并写 `denied` 日志；不透传到 KTX |
| KTX 零改动 | KTX 上游仓库不需要任何修改 |
| MCP 协议兼容 | Streamable HTTP / SSE session 正常工作，不破坏初始化握手 |
| 客户端最小配置 | Codex app / Hermes / Claude Code 只配置 MCP URL + Bearer token，不配置 connection、表清单或 tool include |
| Token 角色化 | `kx_readonly` 这类权限模板可复用；新增同类 Agent 不需要复制逐表 ACL |

## 3. Non-Goals

- **波次边界（取代「永久不实现行级」表述）**：历史「不实现行级权限」解读为 **AC-P0 不交付** scoped / Row Policy 注入。**AC-P1 行授予**以 [`99-access-control-p1-row-policy-spec.md`](99-access-control-p1-row-policy-spec.md) 与 Gate A ADR 为准（专用强制字段 `forced_filters`；未证明取数 fail-closed；O2）。列级 / 动态掩码另立 CLS。**不得**解读为「永不做行级」，也**不得**在 Spec 99 Gate B 前宣称行级 runtime 已交付。
- 不实现 OIDC / OAuth，只用静态 Bearer token
- `sql_execution` 工具默认禁用，不做 SQL AST 表名解析（后期可扩展）；AC-P0 起该工具属 AbsoluteDeny 代码基线（Spec 98 §4），YAML 无法解除
- 不实现 Web UI 管理界面（Phase 3 可选）——**历史条目**：Admin UI 已由 Spec 14/15 交付；本条仅保留为 Phase 叙述上下文，不再约束产品范围
- 不把 skill 当作安全边界。skill 只指导模型怎么用工具；最终授权必须由 Lucy MCP Proxy 裁决
- v1.2 不实现 token scope。后续若引入，只允许在 role 基础上做交集收窄，不能增加权限
- v1.3 新增的 `initialize.result.instructions` 注入（见 §4.4）是"指导"职责的扩展，不具备安全边界效力——它只决定模型看到什么提示文字，不决定模型能调用什么工具或看到什么数据。真正的权限边界始终是 `acl.check()` / `authorizeAndRewrite` 和 `tools/list` 改写；instructions 文本写错或缺失最多导致模型少一些路由提示，不会导致越权

## 4. 架构设计

### 4.1 整体拓扑

```
张三 Hermes              --Bearer <token>-->      ┐
Workhorse                --Bearer <token>-->      ├─ Lucy MCP Proxy (:7879) ──> KTX MCP (:7878)
本地 Claude Code 开发会话 --Bearer <token>-->      ┘  识别 / 检查 / 转发 / 日志    内部 token

                                              │
                                     .ktx-ui/audit.sqlite
                                     (access_log, revoked_tokens)
```

- 客户端 `.mcp.json` 指向 `:7879`，每用户配置各自的 Bearer token
- 代理是 KTX 的唯一上游客户端，用内部独立 token（`KTX_INTERNAL_TOKEN` 环境变量）
- KTX 继续监听 `:7878`，对外部用户无感知
- v1.3 起，"本地 Claude Code 开发会话"也是一个普通客户端，不再走仓库 `CLAUDE.md` 兜底的数据问答指导——它和张三 Hermes、Workhorse 一样，通过 `.mcp.json` 配 `lucy` server + 自己的 token 连 `:7879`，指导文字来自 §4.4 的 `initialize` instructions 注入，不是仓库文件

### 4.2 请求生命周期

```
POST /mcp (client)
  → 读 Authorization header → 401 if 缺失
  → sha256(token) 查内存 tokenIndex → 401 if 未识别 / 已撤销
  → 读 mcp-session-id header，首次创建 session 缓存（用于记录 clientInfo）
  → 缓冲读取请求 body（单个 JSON-RPC 对象）
  → if method == "initialize": 缓存 params.clientInfo 到 session
  → if method == "tools/list":
      按 effective permissions 改写下行工具列表；必要时注入 kx_catalog
  → if method == "tools/call":
      tool = params.name
      acl.check(userId, tool, params.arguments)
        → 如被拒: 写 denied 日志, 返回 JSON-RPC error, 结束
  → 注入内部 Bearer token, 转发 body 到 KTX :7878
  → 透传 mcp-session-id 和响应 headers
  → pipe 响应流回 client，同时旁路 sniff 首个 chunk 判断 isError
  → 写 access_log（userId, tool, tables, outcome, durationMs）
```

### 4.3 MCP Session 透传

- `mcp-session-id` header **双向透传**，代理不生成新 session ID
- 一个 client session → 一个 upstream session（不复用连接）
- 请求 body 可缓冲（每次工具调用是单个 JSON 对象，通常 < 10KB）
- 非 `tools/list` 响应必须原样 pipe，不 buffer 完整响应，避免破坏 SSE/chunked 语义
- `tools/list` 是协议发现面，proxy 对该响应做有限缓冲改写：过滤无权工具，注入 proxy 自服务工具（如 `kx_catalog`），并重写 `content-length` / `transfer-encoding`

### 4.4 Initialize Instructions 注入（v1.3）

**设计意图**：本仓库曾经把"数据问答指导文字"（查询优先级、表路由、指标口径、reviewer 触发条件、provenance footer）放在根目录 `CLAUDE.md` 里——这是 Claude Code 专有的自动加载约定，外部客户端（Codex、Cursor、其他 Claude Code 用户的 Hermes/Workhorse）从不读这个仓库的 `CLAUDE.md`，导致同一份指导只有"本地仓库内的 Claude Code 开发会话"能看到，其他走 proxy 的客户端完全没有。v1.3 把这份指导迁移到 MCP 协议原生支持的 `InitializeResult.instructions` 字段，由 Lucy MCP Proxy 在 `initialize` 响应里统一注入，使所有走 `:7879` 的客户端（含本地 Claude Code 开发会话，见 §4.1）拿到同一份指导。

**内容来源**：`webui/config/data-qa-instructions.md`。这是事实源，模块加载时一次性读取并缓存到进程内存（不做 hot-reload，改完文件需要重启 proxy 才生效——MVP 范围内可接受，因为指导文字不是高频变更项）。

**MVP 不做权限差异化**：所有通过鉴权的 token 拿到同一份 instructions 文本，不按 role 拆分。差异化（比如不同 role 看到不同的表路由小节）留作后续迭代，不在 v1.3 范围内。

**覆盖策略**：KTX 上游 `initialize` 响应目前不填 `result.instructions`（字段为空或缺失）。proxy 无条件覆盖该字段为本地文本——这是"无中生有覆盖"，不是合并。若未来 KTX 上游也开始填充该字段，约定为整体替换、不做内容拼接（避免两份指导互相矛盾或重复）。

**失败语义（与 `tools/list` 刻意不同）**：`tools/list` 改写失败时 fail-closed，返回 JSON-RPC error（§6.1，因为它涉及权限边界，过滤失败可能导致越权暴露工具）。`initialize` 的 instructions 注入失败（文件未加载到、JSON 解析失败、content-type 不识别等）必须 fail-open——退化为原样透传上游响应，不能阻断 MCP session 建立。原因：instructions 只是指导文案，不是权限裁决；一旦在这里 fail-closed，注入功能任何一个小 bug 都会导致所有客户端连不上 proxy，影响范围远大于"少了一段指导文字"。失败时 proxy 仍写 audit（`tool=initialize`，`outcome=ok`，`decision_reason=instructions_injection_failed`，`error_detail` 记录失败原因），供事后排查，但不影响客户端侧的请求结果。

**Kill switch**：环境变量 `LUCY_ENABLE_INSTRUCTIONS_INJECTION`（默认 `!== "false"` 即启用）。关闭时 `initialize` 走原有透传分支，行为等价于 v1.3 上线前。

## 5. 数据结构

### 5.1 用户权限配置 `webui/config/access.yaml`

> **历史示例（v1.0 `users[].allow`）：** 下列 YAML 保留作兼容叙述。**AC-P0 Role / 新建 Agent 不得**在 `allow.tools` 中配置 `sl_query` / `sl_read_source`（AbsoluteDeny；见 Spec 98 §4）。主查询面为 `lucy_query` / `lucy_read_source`。

```yaml
users:
  - id: zhangsan
    name: 张三
    tokens:
      - hash: sha256:<hex>        # 明文 token 不落盘，只存 hash
        label: hermes-laptop
        created: 2026-06-18
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query              # AC-P0 DataPlane；历史配置可能仍写 sl_*（运行时 AbsoluteDeny）
        - lucy_read_source
        - wiki_search
        - wiki_read
        - entity_details
        - dictionary_search
        - discover_data
        - connection_list

  - id: lisi
    name: 李四
    enabled: false
    note: High-privilege sample agent; create token only when needed.
    tokens: []
    allow:
      tables: ["*"]               # 通配 = 全部已配置表
      tools: ["*"]

defaults:
  deny_tools:
    - sql_execution               # 原生 SQL 写口，默认对所有用户禁用
    - sl_query                    # AC-P0：YAML 双保险；真正边界在代码 AbsoluteDeny
    - sl_read_source
    - memory_ingest
    - memory_ingest_status
```

- `tools: ["*"]` 表示放行全部工具（除 `defaults.deny_tools`）；**AC-P0：** AbsoluteDeny / 未分类工具仍不可见、不可调用
- `tables: ["*"]` 表示放行全部已在 `ktx.yaml` 中 `enabled_tables` 声明的表
- yaml 变更后需重启，或通过 `fs.watch` hot reload（见 §7）；**AC-P0 热加载语义以 Spec 98 §8.2–§8.3 为准**（见 §5.1.2）

### 5.1.1 v1.2 Role 权限模型

v1.2 的目标用户体验是：同事拿到一个 `kx_readonly` token 后，只在 Codex app / Hermes / Claude Code 中配置 MCP URL 和 Bearer token；客户端不需要知道 `mysql-aliyun`、`dataforai.kx_*` 或工具白名单。

```yaml
roles:
  kx_readonly:
    description: KX 财务数据只读问答
    # AC-P0：新建 / 保存为 v2 时须 permission_model_version: 2，且禁止 prefix
    permission_model_version: 2
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - kx_dim_company
            - kx_dim_financial_item
            - kx_fact_financial_amount
            - kx_vw_balance_sheet_detail
            - kx_vw_cash_flow_statement_detail
            - kx_vw_income_statement_detail
          row_access: all
      tools:
        - kx_catalog
        - lucy_query              # DataPlane；禁止写 sl_query（AbsoluteDeny）
        - lucy_read_source        # DataPlane；禁止写 sl_read_source（AbsoluteDeny）
        - entity_details

users:
  - id: workhorse
    name: workhorse
    enabled: true
    role: kx_readonly
    tokens:
      - hash: sha256:<hex>
        label: codex-app
        created: 2026-06-21

defaults:
  deny_tools:
    - sql_execution
    - sl_query
    - sl_read_source
    - memory_ingest
    - memory_ingest_status
```

**有效权限合成规则（必须单向、可解释）：**

```text
# v1.2 / 现网（历史）
effective_permissions(token)
  = resolve(user.role)
  - defaults.deny_tools

# AC-P0（权威定义 Spec 98 §5；本处只钉契约方向，不另立代数）
EffectiveDataCapabilities(agent)
  = ∪_roles RoleCapabilities(r)   # 元组并集，禁止 (∪tools)×(∪sources)
EffectiveMetaTools(agent)
  = ∪_roles RoleMetaTools(r)
再减去 AbsoluteDeny / defaults.deny_tools 双保险
```

- `roles` 是长期主模型；`users[].role` 指向一个全局 role。**AC-P0：** Agent 使用 `roles: [...]` Role Set；legacy 单字段 `role: x` ≡ `roles: [x]`；`role` 与 `roles` 双写 → 保存拒绝 / reload fail-closed（Spec 98 §3）。
- `defaults.deny_tools` 是绝对否定；role 不能突破全局禁用工具。**AC-P0：** 另有代码基线 AbsoluteDeny（含 `sl_*`），YAML 删除 deny 条目仍拒绝。
- `users[].allow` 仅作为 v1.0 兼容层保留，标记 deprecated；新建 Agent 不再生成 `users[].allow`。迁移期内，如果同一 user 同时有 `role`/`roles` 和 `allow`，proxy 必须在 reload 阶段告警，并按 role 优先生效。
- `role.allow.tools` 必须显式列工具名；`["*"]` 仅允许出现在历史 `users[].allow` 兼容配置中。**AC-P0：** 不得包含 AbsoluteDeny / 未分类工具（lint fail）；示例与生产配置一律写 `lucy_*`，不得把 `sl_query` / `sl_read_source` 写进 Role.tools。
- 如果 role 授权任何表访问工具或 `tableSelectors`，则 `role.allow.connections` 必填且不能为空；缺失视为 `role_resolution_failed:<role>`。纯 wiki / 非数据工具 role 可以省略 `connections`。**AC-P0：** 含 selectors / DataPlane 时空 `allow.connections` → **编译失败**（与 Spec 98 §5.4 / Spec 15 对齐）。
- v1.2 不实现 `tokens[].scopes`；如未来实现，只能引用已有 role 作为交集收窄，不能增加工具、连接或表权限。
- 未识别 role、空 role、selector 解析失败、tool 不存在或 selector 匹配 0 个 source 时，配置 reload 必须 fail-closed；不得静默降级为全放行、空权限或历史 `users[].allow`。
- **AC-P0 补充：** `permission_model_version`、v2 禁 `prefix`、编译输入含 source map → Spec 98 §7–§8；Admin → Spec 14 / 15。
- **AC-P1 补充：** `scoped`+`row_policy`、`forced_filters`、行策略裁决码 → Spec 99；Gate B 前 runtime 行为仍按 AC-P0（拒绝 scoped）。

KX role 示例中的工具归属（AC-P0）：

| Tool | 来源 | 分级 | 说明 |
|---|---|---|---|
| `lucy_query` | Lucy proxy → KTX | DataPlane | 主查询面；经 `authorizeAndRewrite` |
| `lucy_read_source` | Lucy proxy → KTX | DataPlane | 整源读取 |
| `entity_details` | KTX upstream | DataPlane（未包装） | 仍过闸门做 capability 检查；若上游未暴露则 role 校验失败 |
| `kx_catalog` | Lucy proxy | Meta | proxy 注入并直接服务的能力发现工具 |
| `sl_query` / `sl_read_source` | KTX upstream | **AbsoluteDeny** | **不得**出现在 Role.tools；代码基线不可解除 |

### 5.1.2 Role 生命周期

- role 是全局命名权限模板；`users[].role` / `users[].roles[]` 只能引用已存在 role。
- role 改名不支持原地 rename；必须新增新 role、迁移引用、再删除旧 role。
- 删除仍被 user 引用的 role 是配置错误；reload fail-closed。
- 修改 role 的 tools / connections / tableSelectors 后，新的 Effective Policy 在下一次**成功编译并提交**后生效。热路径只读当前原子引用；**禁止**热路径解析 YAML 或重建 source map（Spec 98 §8.2）。
- 每次成功编译后，proxy 写入 `policyVersion`、capability digest，并为复盘生成 permission snapshot（与 Spec 98 §8.1 / §10.3 对齐）。
- **配置失败 / 热加载语义（权威 Spec 98 §8.2–§8.3；禁止沿用「继续使用上一份已验证配置」作为一般路径）：**
  - **Admin 推荐路径：** dryRun → 编译失败则不写盘、不切 runtime；编译成功才写盘并原子切换；切换失败回滚磁盘并保持写前 runtime。
  - **外部手改 YAML / 非法热加载：** 编译失败且可定位受影响 Agent → 这些 Agent 的 **DataPlane 全部 deny**（Meta 数据相关输出默认 deny / catalog 置空）；无法可靠定位（如 YAML 无法解析）→ **数据面整体 deny**，直至修复或回滚。
  - **last-known-good 仅允许：** 等价或放宽切换失败时回退；进程重启加载**上一份已验证成功**的策略。**禁止**在「意图收窄但编译/切换失败」时继续提供更宽旧权并表现为健康。
  - **启动期**无任何已验证策略 → 拒绝进入可服务状态。

### 5.1.3 `tableSelectors` 语义

`tableSelectors` 表达授权意图，proxy 通过 semantic-layer source map 解析为具体 `canonicalSourceKey = (connectionId, schema, sourceName, physicalTable)` 集合（Spec 98 §6）。role 编译必须钉住用于解析的 `sourceMapVersion`；admin preview 必须展示该版本，避免 preview 与运行时用不同 catalog。

| Selector | 语义 | AC-P0 可用性 |
|---|---|---|
| `{ connection, schema, names }`（+ v2 必填 `row_access: all\|scoped`） | 精确列举 source/table 名 | **v1 / v2 首选**；AC-P0 仅 `all`；**AC-P1** `scoped`+`row_policy` 见 Spec 99（Gate B 后） |
| `{ schema, names }` | 任一授权 connection 下，schema 内精确列举 | 兼容单 connection；同上 |
| `{ connection, schema, prefix }` | 指定 connection/schema 下，source/table 名以 prefix 开头 | **仅 `permission_model_version: 1`（legacy）**；**v2 禁用**（编译失败） |
| `{ schema, prefix }` | 任一授权 connection 下，schema 内 prefix 匹配 | 同上，仅 v1 |

规则：

- 多个 selector 之间是 union（同 Role 重叠 source 的 rowGrant digest 规则 → Spec 98 §5.6）。
- **`prefix`（仅 v1）：** 大小写敏感；不支持 glob、regex 或负向匹配。因 source map 变化导致授权集合扩大时，必须产生可观测 `policy_scope_expanded` 记录（§0.5 / Spec 98 §8.1）；**不得**静默扩权。
- **`prefix`（v2）：** 任何含 `prefix` 的 selector → **配置拒绝 / 编译失败**（Spec 98 §7）。Admin 迁移须将 v1 `prefix` 展开为 `names`（无法展开 → 保存失败）。
- selector 只匹配 semantic-layer 已注册 source；物理库里存在但未纳入 semantic-layer 的表不授权。
- selector 解析结果必须可预览，并在 reload / admin UI 中展示给管理员。
- selector 匹配 0 个 source 是错误：preview API 返回 `400 INVALID_ROLE`，配置保存 / reload fail-closed。
- KX 财务只读 role 必须使用 `names` 明示授权 source，不能用 `prefix: kx_` 作为默认或生产策略。
- 生产敏感数据 role：**禁止**依赖开放式 `prefix`；Admin 对仍存活的 v1 `prefix` 须显示开放式授权 warning，并要求人工确认迁移。

### 5.1.4 客户端配置合同

普通使用者只接收以下信息：

```json
{
  "mcpServers": {
    "lucy": {
      "url": "http://localhost:7879/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

客户端不得要求配置：

- `connectionId`
- 表名或 table prefix
- tool include / exclude
- 内部 role 名称

`kx_catalog` 负责在运行时返回该 token 可用的数据域、允许的查询入口和示例参数。它是能力发现工具，不是权限来源；所有工具调用仍必须走 proxy ACL。

### 5.2 SQLite Schema（`.ktx-ui/audit.sqlite`）

```sql
CREATE TABLE access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,   -- ISO8601 UTC, e.g. "2026-06-18T00:30:00.000Z"
  user_id       TEXT    NOT NULL,   -- 'zhangsan'
  client        TEXT,               -- 'hermes' | 'cursor'（从 initialize 握手的 clientInfo.name 抓）
  tool          TEXT    NOT NULL,   -- e.g. 'lucy_query'（历史日志可能含 sl_*）
  tables        TEXT,               -- JSON array: ["dataforai.superstore_orders"]
  args_summary  TEXT,               -- 精简入参 JSON（白名单字段，不含完整 rows）
  outcome       TEXT    NOT NULL,   -- 'ok' | 'error' | 'denied'
  error_detail  TEXT,               -- 失败原因，截断到 500 字符
  duration_ms   INTEGER NOT NULL,
  request_id    TEXT    NOT NULL    -- JSON-RPC id
);

CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
CREATE INDEX idx_al_tool_ts ON access_log(tool, ts);

CREATE TABLE revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason     TEXT
);
```

v1.2 扩展字段（可新增列或放入 JSON metadata，具体实现二选一）：

```sql
-- 建议字段；SQLite 迁移可用 ALTER TABLE 逐步追加
role_ids                         TEXT,  -- JSON array，如 ["kx_readonly"]；AC-P0 为 Role Set
permission_snapshot_hash          TEXT,  -- effective permissions 快照 hash
effective_tables_count            INTEGER,
decision_reason                   TEXT   -- 见 §6.1.1；AC-P0 主码含 capability_forbidden
```

**v1.4 / AC-P0 增量（WP-S1；与 §0.5 一致）：**

```sql
-- access_log 追加
policy_version                    TEXT   -- 当次裁决 policyVersion

-- permission_snapshots 追加（可入 resolved_json 旁路字段，须可查询）
capability_digest                 TEXT,  -- Effective Data Capabilities 摘要
tool_classification_version       TEXT   -- 参与 policyVersion 哈希的分类表版本
```

同时新增权限快照表；`access_log.permission_snapshot_hash` 必须能关联到当时的完整 effective permissions（AC-P0：含 capability 集合，而非仅 tools∪ + sources∪）。

```sql
CREATE TABLE permission_snapshots (
  hash        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  roles_json  TEXT NOT NULL,  -- 参与合成的 role 定义
  resolved_json TEXT NOT NULL -- AC-P0：须可复盘 capability 元组；禁止仅存双并集
);
```

`config_change_log`（Admin 写入审计，见 Spec 90）须能记录：`policy_scope_expanded`、策略降级进入 / 恢复（§0.5）。事件 payload 细节以实现 WP-I6 为准，本补丁只钉契约存在性。

写入顺序：

1. 计算 Effective Policy（含 `policyVersion`、capability digest）与 snapshot hash。
2. `INSERT OR IGNORE permission_snapshots(hash, ...)`。
3. 写 `access_log.permission_snapshot_hash` 与 `access_log.policy_version`。

审计日志必须足以解释「当时为什么允许或拒绝」。当 role 或 selector 未来变化时，仍应通过 `permission_snapshots.resolved_json` 复盘。

保留策略：`permission_snapshots` 按 hash 去重；清理时只能删除不再被近 90 天 `access_log.permission_snapshot_hash` 引用的快照。

## 6. 表名提取逻辑

代理从工具参数里提取物理表名 / canonical source key，用于 ACL 检查和日志。

> **AC-P0：** 身份键与裁决以 Spec 98 §6 Canonical Source Key 为准；本节不得再规范「全局裸 `sourceName` Map」。`sl_query` / `sl_read_source` 为 AbsoluteDeny，**不**作为可授权调用路径出现在下表「允许工具」列；下表保留参数提取形状，供审计兼容与拒绝对话诊断。

| 工具 | 表名 / 源键来源 | 提取方式 |
|---|---|---|
| `lucy_query`（及拒绝对话中的历史 `sl_query` 参数形） | `arguments.measures[]` / `arguments.dimensions[].field` | 取 `.` 前的 sourceName，与 `connectionId` 一并查正向 map → canonical key / 物理表 |
| `lucy_read_source`（及历史 `sl_read_source` 参数形） | `arguments.sourceName` + `arguments.connectionId` | 同上查正向 map |
| `entity_details` | `arguments.sourceName` / `arguments.entities[].table` / `schema+name` / `type|kind + name|id` / `qualifiedName` | 规范化后查 source map（须带 connection 语境） |
| `lucy_freshness` / `lucy_explain_query` / `sl_validate` | 各工具参数中的 source / connection | 一律经 `authorizeAndRewrite` 做 capability 检查（Spec 98 §4.5–§4.6） |
| `discover_data` / `dictionary_search` | 无具体表（敏感 Meta） | tool 级 + 前缀下「任意 DataPlane」parity（Spec 98 §4.4） |
| `wiki_search` / `wiki_read` | 与表无关 | 仅做 tool 级 / wiki ACL |
| `connection_list` / `lucy_catalog` / `kx_catalog` | 无单源绑定 | Meta；输出按 Effective Data Capabilities 过滤（Spec 98 §5.5） |

v1.2 / AC-P0 连接裁决：

- 对表访问 / DataPlane 工具，若 effective permissions 含连接约束，请求必须显式携带允许的 connection。
- 缺失 connection、未知 connection、非授权 connection 均拒绝并 audit（`unknown_or_forbidden_connection:<id>`，先于 capability 检查）。
- `schema` 只用于表归属，不等同于 connection；不得把 `{ schema: dataforai }` 误判为 connection。
- DataPlane 查询若没有可解析 source/table 引用，且用户不是历史 `tables: ["*"]` 兼容通配，必须拒绝为 `explicit_table_required:<empty>`。
- 一次请求引用多源时，任一源或缺 `(tool, canonicalSourceKey)` capability 则整体拒绝；主裁决码 `capability_forbidden:<tool>:<sourceKey>`（可短暂双写 `table_forbidden`）；`args_summary` 或 metadata 中保留违规总数。

**Canonical source map（AC-P0；权威 Spec 98 §6 / §8.1）：**

启动 / 编译时扫描 `semantic-layer/**/*.yaml`，读取每个 source 的 `name`（sourceName）、所属 `connectionId`、schema 与物理表，构建：

```typescript
// 正向：至少 (connectionId, sourceName) → { schema, physicalTable, ... }
// 反向：至少 (connectionId, physicalTable) → { schema, sourceName, ... }
// 禁止：全局裸 Map<sourceName, ...> 或裸 Map<physicalTable, ...> 作唯一身份
// 同 connectionId 内 sourceName 必须唯一；冲突 → 编译失败
```

**变更检测与重编译：**

- 可用文件 mtime / 哈希轮询（例如每 60 秒）**仅作变更检测**。
- 一旦检测到 source map 变化，必须触发与 access.yaml 变化**同等语义**的重编译，并产生新的 `policyVersion`（Spec 98 §8.1）。
- **禁止**依赖「60s TTL 静默刷新内存 Map、热路径直接读新 map 而不重编译」的旧语义。
- 同一 `policyVersion` 内所有请求使用同一份钉住的 source map 快照。
- v1 `prefix` 因 map 变化导致授权集合扩大 → 必须记 `policy_scope_expanded`（不得静默）。

### 6.1 `tools/list` 与 `tools/call` 双重授权

- `tools/list`：proxy 改写下行工具列表，只返回 token 有权看到的工具。若 effective permissions 允许 `kx_catalog` / `lucy_catalog`，proxy 可注入该自服务工具。
- `tools/call`：proxy 对每次调用再次校验工具、connection、canonical source / capability；不能依赖客户端只调用 list 中出现过的工具。
- **全部 DataPlane**（含 proxy-local `lucy_freshness` / `lucy_explain_query`、未包装 `entity_details` / `sl_validate`）均须经 `authorizeAndRewrite`（Spec 98 §4.6）；不得旁路。
- `kx_catalog` / `lucy_catalog`：由 proxy 直接服务，返回内容按 Effective Data Capabilities 过滤。纯 Meta、无 DataPlane capability 时：catalog **源列表为空**（仍可按 wiki ACL 使用 wiki 工具）；不得把「无数据权限」解释成「仍展示全量 catalog」。
- 拒绝必须 fail-closed，并写 `access_log.outcome='denied'`。

`tools/list` 改写策略：

- proxy 只对 `tools/list` 的有限响应做缓冲改写；非 `tools/list` 仍保持流式透传。
- 对 `application/json` 响应：完整读取 JSON-RPC 响应体，过滤 `result.tools`，保留其他字段。
- 对 SSE 响应：完整读取本次 `tools/list` 的 SSE 帧，解析 `event: message` / `data:` JSON，保留 `id:`、`retry:` 等非 data 字段，再重发改写后的单帧 SSE。
- 若上游返回多帧流式 `tools/list`、无法完整解析、body 超过 `MAX_TOOLS_LIST_REWRITE_BYTES = 4 MiB` 或 JSON-RPC 不是单个 response，proxy 必须 fail-closed 返回 JSON-RPC error，不得透传未过滤工具列表。
- 若上游 tools/list 支持分页 / cursor，proxy 过滤当前页并原样保留 pagination 字段；不得合并跨页工具。
- `initialize.capabilities` 不做权限过滤；权限发现以 `tools/list` 的实际响应为准。
- v1.2 不实现主动 `listChanged` 推送；role 变更后，新 `tools/list` 请求在配置 reload 后反映新权限。

### 6.1.1 `decision_reason` 枚举

| Code | 语义 |
|---|---|
| `allowed` | 允许执行 |
| `tool_forbidden` | role 未授权该工具 |
| `tool_forbidden_global` | 命中 `defaults.deny_tools` |
| `table_forbidden:<table>` | （v1.2/v1.3）表不在 effective permissions 中；**AC-P0 实施后 DataPlane 主码改为 `capability_forbidden`，本码可短暂双写兼容** |
| `table_forbidden:<table>; total=<n>` | 多表请求中至少一个表未授权，记录首个违规和违规总数（兼容同上） |
| `capability_forbidden:<tool>:<sourceKey>` | **AC-P0 新增**：缺少 `(tool, sourceKey)` Data Capability（权威定义 Spec 98 §10.2） |
| `tool_absolute_deny:<tool>` | **AC-P0 新增**：代码基线 AbsoluteDeny |
| `tool_unclassified:<tool>` | **AC-P0 新增**：未分类工具按 AbsoluteDeny |
| `policy_degraded_deny` | **AC-P0 新增**：策略降级态导致的 DataPlane deny |
| `unknown_or_forbidden_connection:<id>` | connection 缺失、未知或未授权；缺失用 `<missing>` |
| `explicit_table_required:<empty>` | 非通配用户调用表访问工具但没有明确表引用 |
| `role_not_found:<role>` | user 引用不存在 role |
| `role_resolution_failed:<role>` | role selector / tool / connection 解析失败 |
| `user_disabled` | user disabled（实现侧或称 `agent_disabled`；以代码与 Spec 98 对齐为准） |
| `token_revoked` | token 已撤销 |
| `token_expired` | token 已过期 |
| `tools_list_rewrite_failed` | `tools/list` 改写失败，拒绝透传 |

> AC-P0 完整裁决码表、流水线与审计字段以 Spec 98 §10 为准；上表是 Spec 07 既有枚举的**就地补丁**，避免两套互相矛盾的主码定义。

### 6.2 `kx_catalog` 返回合同

`kx_catalog` 面向 agent 能力发现，返回可执行所需信息。返回的 `connectionId` / `schema` / `sourceName` / `table` 是模型可读的机器字段，不在 token 交付页展示；Agent 最终回答不应主动向普通用户复述这些内部 id，除非用户明确要求调试或配置细节。

```json
{
  "dataDomains": [
    {
      "id": "kx_financial",
      "label": "KX 财务数据",
      "connections": ["mysql-aliyun"],
      "sources": [
        {
          "connectionId": "mysql-aliyun",
          "schema": "dataforai",
          "sourceName": "kx_fact_financial_amount",
          "table": "dataforai.kx_fact_financial_amount"
        }
      ],
      "examples": [
        {
          "tool": "lucy_query",
          "arguments": {
            "connectionId": "mysql-aliyun",
            "measures": [{ "$text": "kx_fact_financial_amount.amount" }]
          }
        }
      ]
    }
  ]
}
```

管理员 UI 可以展示完整 connection/source/table；普通 token 交付页不展示这些内部字段，只交付 URL 和 token。

## 7. 新增 / 改动文件

### 新增

```
webui/
├── config/
│   ├── access.yaml                  # 用户/权限配置（人工维护）
│   └── data-qa-instructions.md      # v1.3 新增：initialize instructions 注入内容来源（Claude 维护，见 §4.4）
└── server/
    └── proxy/
        ├── mcp-proxy.ts         # Fastify app，核心拦截 + 转发；v1.3 新增 writeInitializeResponse()
        ├── identity.ts          # Bearer token → userId / label
        ├── acl.ts               # 权限判定 + 表名提取
        └── audit.ts             # better-sqlite3 日志写入
```

### 改动

| 文件 | 改动内容 |
|---|---|
| `webui/server/index.ts` | 导入并启动 proxy app（端口 7879） |
| `.mcp.json` | `url` 改为 `http://localhost:7879/mcp`；加 `headers.Authorization`；v1.3：key 名改为 `lucy`，本地仓库切到走 proxy（见 §10） |
| `webui/package.json` | 新增依赖：`better-sqlite3`、`@types/better-sqlite3` |
| `webui/server/proxy/mcp-proxy.ts`（v1.3） | 新增 `loadDataQaInstructions()`、`instructionsInjectionEnabled()`、`writeInitializeResponse()`；`handlePost()` 新增 `initialize` 分支（见 §4.4） |

### 不改动

- KTX 上游任何文件（`/Users/zhangxingchen/Projects/ktx/**`）
- `ktx.yaml`、`semantic-layer/`、`skills/`

## 8. 关键接口定义（TypeScript）

```typescript
// identity.ts
interface Identity {
  userId: string;
  tokenLabel: string;
  client?: string;  // 从 session 缓存的 clientInfo.name
}
function identifyRequest(authHeader: string | undefined): Identity | null

// acl.ts
interface AclDecision {
  allowed: boolean;
  reason?: string;  // AC-P0: 见 §6.1.1 / Spec 98 §10.2；含 capability_forbidden:<tool>:<sourceKey>
}
function check(identity: Identity, toolName: string, args: unknown): AclDecision
function extractTables(toolName: string, args: unknown): string[]  // 物理表名列表

// audit.ts
interface AccessLogEntry {
  ts: string;
  userId: string;
  client?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  outcome: 'ok' | 'error' | 'denied';
  errorDetail?: string;
  durationMs: number;
  requestId: string | number;
}
function writeLog(entry: AccessLogEntry): void
```

## 9. 环境变量

| 变量名 | 说明 | 示例 |
|---|---|---|
| `KTX_INTERNAL_TOKEN` | 代理转发到 KTX 时使用的内部 Bearer token | 随机生成的 hex |
| `LUCY_PROXY_PORT` | 代理监听端口，默认 7879 | `7879` |
| `LUCY_AUDIT_DB` | SQLite 文件路径，默认 `.ktx-ui/audit.sqlite` | 可自定义 |
| `LUCY_ENABLE_INSTRUCTIONS_INJECTION` | v1.3 新增：`initialize` instructions 注入开关，`!== "false"` 即启用，默认开启 | `false`（关闭时退化为 v1.3 上线前的透传行为） |

## 10. 实施阶段

### Phase 1：可观测（1–2 天）
目标：有日志，没权限拦截

1. 新增 `webui/config/access.yaml`（只配用户和 token，ACL 暂时全放行）
2. 实现 `identity.ts`（暂时明文 token 比对，无 hash）
3. 实现 `audit.ts` + SQLite 建表
4. 实现 `mcp-proxy.ts` 转发骨架 + sniff 旁路写日志
5. `webui/server/index.ts` 启动 proxy
6. `.mcp.json` 切到 `:7879`

**验证**：张三和李四各发 5 个 `lucy_query`（历史阶段文档曾写 `sl_query`；AC-P0 主查询面为 `lucy_*`），`SELECT * FROM access_log` 能看到正确 user_id、tool、duration_ms。

### Phase 2：可治理（2–3 天）
目标：ACL 生效，权限拒绝有日志

7. token hash（sha256），引入 `revoked_tokens` 表
8. 实现 `acl.ts`：tool 级 + table 级检查
9. 实现 sourceName → 物理表名缓存
10. 代理在 `tools/call` 前插入 ACL check

**验证**：张三访问 `dataforai.superstore_returns` → 收到 JSON-RPC error；`access_log` 有 `outcome='denied'`，`error_detail='table_forbidden:dataforai.superstore_returns'`。李四访问三张表全部正常。

### Phase 2.5：角色化 token 与客户端最小配置（v1.2）

目标：同事使用 Codex app / Hermes / Claude Code 时只需要 MCP URL + token。

1. 在 `access.yaml` 增加 `roles` schema 与 `users[].role`。
2. 实现 role resolver 与 effective permissions preview。
3. 实现 `tableSelectors` 解析；selector 解析失败时 reload fail-closed。
4. `tools/list` 按 effective permissions 过滤，并注入 proxy 自服务工具 `kx_catalog`。
5. `kx_catalog` 由 proxy 直接服务，返回 token 可用的数据域和示例参数。
6. 保留 `users[].allow` 兼容读取，但新建 Agent 不再生成；若与 `role` 并存则告警并按 `role` 生效。
7. audit 增加 role / permission snapshot / decision reason。

**验证**：

- 新建 `kx_readonly` role 和 token 后，Codex app 只配 URL/token，`tools/list` 只能看到允许工具。
- `kx_catalog` 返回 `mysql-aliyun` 与 `dataforai.kx_*` 已注册 semantic-layer source。
- `lucy_query` 缺 connection、`connectionId=warehouse`、非授权源、无明确表引用均被拒绝并 audit；对 `sl_query` 调用须 `tool_absolute_deny`。
- 当前 `workhorse` 的逐表配置可迁移为 `role: kx_readonly`，行为等价或更严格。

### Phase 3：可运维（可选，半天）
11. `webui/server/index.ts` 加 `GET /api/audit` 接口（分页、按 user/tool 过滤）
12. yaml hot reload（fs.watch + 删 token 写 revoked_tokens）

### Phase 4：Initialize Instructions 注入与本地切换（v1.3，2026-06-23）

目标：把仓库 `CLAUDE.md` 里的数据问答指导迁移到 §4.4 描述的 proxy instructions 注入，并让本地仓库内的 Claude Code 开发会话也切到走 proxy。

> 说明：「`.mcp.json` 切到 `:7879`」这件事，Phase 1 步骤 6 当时就写过预期，但实际只切了 proxy 的监听端口/转发骨架，根目录 `.mcp.json` 一直没有真的改成指向 `:7879` 并带认证头——本阶段是把这条欠了很久的待办补完，不是新增需求。

13. 新增 `webui/config/data-qa-instructions.md`（内容来源，详见 §4.4），把原 `CLAUDE.md` 的查询优先级、表路由、指标口径、reviewer 触发条件、provenance footer 原样迁移过去。
14. `mcp-proxy.ts` 新增 `writeInitializeResponse()`，在 `handlePost()` 里给 `initialize` 方法新增独立分支，结构参照 `tools/list` 的 `writeToolsListResponse()`，但失败语义相反（fail-open，见 §4.4）。
15. `access.yaml` 新增 `local_dev_full_access` role（覆盖 `ktx.yaml` 全部 `enabled_tables`）+ `forrest_local` 用户，保证本地开发切换后数据访问范围不收紧。
16. 根目录 `.mcp.json`：`mcpServers` key 名从 `ktx` 改为 `lucy`，`url` 改为 `http://localhost:7879/mcp`，`headers.Authorization` 用 `"Bearer ${LUCY_LOCAL_TOKEN}"` 环境变量插值（不写明文 token）。token 明文存放在 `.ktx/secrets/lucy-local-token`（已在 `.gitignore`）。
17. 本机环境变量 `LUCY_LOCAL_TOKEN` 配置在用户级 shell 启动文件（如 `~/.zshrc`，不属于本仓库），从 `.ktx/secrets/lucy-local-token` 读取后导出，确保每个新开的 Claude Code 会话都能用。

**实测结论（供后续同类配置参考）**：

- Claude Code 对 HTTP transport `.mcp.json` 里 `headers.Authorization` 字段的 `${VAR}` 环境变量插值**确认生效**（用 `claude -p --mcp-config <file> --strict-mcp-config` 非交互模式实测，`kx_catalog` 调用成功返回数据域列表）。社区曾有的"插值不生效"顾虑在本机此版本上未复现。
- 之前一度怀疑的"KTX upstream SSE 握手 gap 导致 initialize 永远 400"**不成立**——用包含 `protocolVersion`/`capabilities`/`clientInfo` 全部必填字段的完整 initialize 请求直接测试 `:7878` 和 `:7879`，两者均返回 200。此前的 400 是测试请求本身缺字段（MCP SDK 的 zod schema 在缺字段时直接拒绝），与 SSE 握手无关，KTX 上游没有需要修复的兼容性问题。
- 本机日常通过 `claude` 命令启动的会话，实际由 `~/.zshrc` 里的 `claude()` shell 函数强制 `cd` 到 `~/Workspace` 再启动，因此真正生效的是 `~/Workspace/.mcp.json`（不在本仓库内），而不是 `project-lucy/.mcp.json`——这是本机 shell 配置的固有行为，不是本工单引入的问题。为了让"本地仓库内开发会话切到走 proxy"对日常工作流真正生效，额外把 `lucy` server 条目合并进 `~/Workspace/.mcp.json`（与已有的 `tableau` server 并列）。`project-lucy/.mcp.json` 本身仍按上述第 16 条切换、保持作为仓库内交付物的正确性，供任何显式 `--mcp-config` 指向该文件的场景使用。

**验证**：本地用 `claude -p --model claude-haiku-4-5-20251001 ... "调用 lucy 的 kx_catalog"`（默认配置，不带任何覆盖参数）验证，返回 `connections: ["mysql-aliyun"]`，确认本地开发会话默认即可走 proxy 拿到全量数据访问能力和 §4.4 的 instructions 指导。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| MCP session 握手破坏 | 代理透传 `mcp-session-id`；响应流原样 pipe，不 buffer；先跑集成测试验证初始化握手 |
| 响应 sniff 解析失败 | sniff 只做 best-effort（旁路），失败时 outcome 记 'unknown'，不阻断响应流 |
| access.yaml 格式错误 | 启动时做 schema 校验（zod），错误则拒绝启动 |
| token 明文泄漏 | 只存 sha256 hash；日志里不记录原始 token；`.mcp.json` 加入 `.gitignore` |
| better-sqlite3 同步写阻塞 | 本机、低 QPS 场景同步写可接受；后期可换 WAL 模式减少锁 |
| role / selector 配错导致越权 | reload fail-closed；selector 预览；audit 记录 permission snapshot hash |
| prefix selector 自动纳入未来敏感表 | **v2 禁用 `prefix`**；v1 扩权必须 `policy_scope_expanded`；管理员审查 selector 预览；敏感表不得挂在通用 `kx_` 前缀角色 |
| tools/list 改写破坏响应头 | 改写后删除原 `content-length` / `transfer-encoding`，按新 body 重算 |
