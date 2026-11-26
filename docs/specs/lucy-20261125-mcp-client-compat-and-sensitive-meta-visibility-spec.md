# 敏感元数据工具可见性对齐与拒绝修复引导 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 敏感元数据工具可见性对齐与拒绝修复引导 Spec |
| 文档类型 / 版本 | Spec（纯 MCP 可用性加固）／**v1.1** |
| 日期 / 目标版本 | 2026-11-25／产品线 `0.35.0`（`lucy-v0.35`；总账与需求池暂挂 `0.30` 池） |
| 功能编号 / 优先级 | **P1-88**／REQ-030-109／**P1（纯 MCP 主路径可用性）**。**不入核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账（P1-88） |
| 阶段 | S4 |
| 状态 | S4｜v1.1。**终稿已确权**（委托人 2026-11-25 明示「审阅通过……授权定稿」；无 Codex CLI 复审，按委托人明示确权先例，额度恢复后可补审，若有阻断按版本升级处理）；**开发授权已获得**（委托人 2026-11-26 明示）；实现已落地（`allowedToolNames` 门禁对齐＋`buildDenialRepairPayload` 修复载荷）；[UAT-SUITE-MCP-CLIENT-COMPAT PASS](../qa/uat/suites/mcp-client-compat-sensitive-meta/runs/2026-11-26-claude-p1-88-mcp-client-compat.md)（R0／MCCC-01 Case A＋B／02／03／04 全绿，逃生链假设取证成立）；待委托人验收；不入核心分母；≠ 功能合同收口；≠ 可上线 |
| 需求来源 | 2026-11-25 现场 Debug 日志 [`inbox/lucy-ksc-finreport-error-log.md`](../../inbox/lucy-ksc-finreport-error-log.md)（会话 `5ce61b8c-f8f4-4bcc-b2c8-f6166ce62203`、`turnId: lucy_a4c95631-7951-4752-bd5d-1e9e41df75a1`）：Agent 4 次调用敏感元数据路径（步骤 3/7/8 `discover_data`、步骤 4 `entity_details`）均触发 `Access denied: sensitive_metadata_forbidden:kx`，随后因缺少有效列名获取引导在 `lucy_query` 上试错（步骤 10–15 含 6 次失败调用并触发 `question_budget_exhausted`）。日志中未调用 `lucy_read_source`，故「经 `lucy_read_source` 逃生」属**待 UAT-MCCC-03 验证的关键假设** |
| 实施主体 | Lucy 服务端（`webui/server/proxy/acl.ts`、`webui/server/proxy/mcp-proxy.ts`）；不依赖修改第三方 MCP 客户端源码，不改 KTX 源码 |
| 配对计划 | [`docs/plans/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-plan.md`](../plans/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-plan.md) |
| 测试台 | [`UAT-SUITE-MCP-CLIENT-COMPAT`](../qa/uat/suites/mcp-client-compat-sensitive-meta/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 2026-11-26 **实现落地与 UAT 通过**（开发授权已获得，委托人 2026-11-26 明示；合同正文不变）：`allowedToolNames()` 对 `policy.sensitiveMetadataTools` 增加与 `acl.ts:3436` 一致的 fail-closed 门禁（OQ-2 空匹配覆盖）；`buildDenialRepairPayload()` 新增 `sensitive_metadata_forbidden:*` 逃生分支（紧凑文案／来源清单单次拼接／`nextTools` 按 `allowedToolNames` 过滤／零来源 B15 事实性兜底）；定向单测 89 项全绿＋tsc 零错误；[UAT-SUITE-MCP-CLIENT-COMPAT PASS](../qa/uat/suites/mcp-client-compat-sensitive-meta/runs/2026-11-26-claude-p1-88-mcp-client-compat.md)（R0／MCCC-01 Case A＋B／02／03／04；`lucy_catalog→lucy_read_source→lucy_query` 逃生链假设取证成立）。→ 阶段 S4，待委托人验收；≠ 功能合同收口；≠ 可上线。 |
| v1.0 | 2026-11-25 **终稿确权**（委托人明示「审阅通过……授权定稿」）；入总账 **P1-88／REQ-030-109**；cases.md 重写对齐 SC-01–SC-05、fixtures.md 补齐（对抗评审 B1／B2 关闭）；Spec／Plan → v1.0、阶段 S2。开发未授权；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| v0.3-draft | 2026-11-25 按对抗性评审修正：1) 澄清 `DEFAULT_SENSITIVE_METADATA_TOOLS` 默认仅含 `dictionary_search`/`discover_data`，`entity_details` 属 DataPlane（除非现场 `access.yaml` 配入 `sensitive_metadata_tools`），`tools/list` 仅对 `policy.sensitiveMetadataTools` 生效；2) 修正 M1（重复来源清单改标为依代码审查确认）与 M2（精确区分 4 次敏感元数据拒调与后续 6 次 `lucy_query` 失败，逃生链标为待验证假设）；3) 修正 M3（伪代码与 `acl.ts:3436` 对齐，仅在 `runtime.sourceMap` 存在时检查）；4) 新增 OQ-3/OQ-4 登记日志暴露的同主题问题，明确本修复不收缩列名暴露面。 |
| v0.2-draft | 2026-11-25 拆分收口：剥离未取证的 `MCP_INVALID_OPERATION` / `inputSchema` 改造；裁定无匹配敏感表保持 fail-closed；修正锚点、B15 闭环、版本号 `0.35.0` 与复合画像。 |
| v0.1-draft | 2026-11-25 初稿。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在纯 MCP 部署实况下，无论客户端是否消费 `InitializeResult.instructions`，当 `runtime.sourceMap` 存在且 Agent 未显式拥有全部匹配敏感表时，`tools/list` 与 `initialize` 阶段计算的 `visibleTools` 中不会暴露 `policy.sensitiveMetadataTools`（默认 `dictionary_search`、`discover_data`，以及任何在 `access.yaml` 中配置进 `sensitive_metadata_tools` 的工具）；即使客户端直接调用被拒，也会收到区分「全局敏感元数据搜索受限」与「已授权数据源可查」的紧凑修复提示（保留 B15 闭环，并按该 Agent 实际 `allowedToolNames` 过滤 `nextTools`）。
- 本条出口：SC-01–SC-05 的本机自动化测试、实现审查，以及在隔离 Docker demo + 纯 MCP 上跑通 `UAT-R0` 与 `UAT-MCCC-01～04`（含验证 `lucy_catalog → lucy_read_source → lucy_query` 逃生假设）。
- 不在本条出口：`MCP_INVALID_OPERATION` 排查与 Tool `inputSchema` 改造（OQ-1）；默认配置下 DataPlane 工具 `entity_details` 在 `requested.length === 0` 路径（`acl.ts:3488-3496`）的调用时拒绝；`connection_list`／`kx_catalog` 与 `lucy_catalog` 连接差异（OQ-3）；`ambiguous_field` 问题（OQ-4）；修改第三方客户端或 KTX 上游源码。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- Agent 可见拒绝引导文案：「全局敏感元数据搜索工具受限，不影响查询已授权数据源……」——新增面向 Agent 的修复提示措辞，不新增 WebUI 界面术语；继续使用现有工具名与机器拒绝码 `sensitive_metadata_forbidden:kx`（「敏感元数据工具」仅作为内部 ACL 配置集合 `policy.sensitiveMetadataTools` 的工程称谓，不作为 WebUI 对外主术语）。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条仅修改 MCP Proxy 的 `allowedToolNames()` 过滤逻辑与 `buildDenialRepairPayload()` 拒绝修复文案。
- 不改变：WebUI 页面、导航、组件、按钮、表单及现有 WebUI 错误提示。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | **问数面**：使用未消费 `instructions` 的客户端时，看到 `tools/list` 中的 `discover_data`／`dictionary_search` 并误调，触发 `sensitive_metadata_forbidden:kx` 后因缺少紧凑逃生提示而误判或反复试错。**报告面**：未触碰 Live Report 表面 | **问数面**：`tools/list` 不再对未全量授权 Agent 暴露不可用的 `policy.sensitiveMetadataTools`；误调被拒时给出经 `allowedToolNames` 过滤且经过 B15 闭环的下一步。**报告面**：保持不变 | P1·问数面 ↑／P1·报告面 ＝ | 问数面：SC-01／SC-02／SC-03；报告面：不涉及 Live Report 路由与渲染逻辑 | — |
| P2 治理方 | 排查「为何某客户端反复误调 `discover_data`」缺少可见性对齐机制 | `access.yaml` 配置模型与 `authorizeAndRewrite()` 调用时门禁（`acl.ts:3436`）保持不变，仅将 `tools/list` 列表可见性收紧至与调用时一致 | ＝ | SC-02／SC-04（`acl.ts:3436` 未动，配置结构不变） | — |
| P3 运维方 | **运行观察面**：客户端反复误调 `discover_data` 产生无效拒绝流水与提示噪音。**交付运维面**：不涉及出包、部署与升级流程 | **运行观察面**：误调噪音减少，真实越权仍记录 `sensitive_metadata_forbidden:kx` 与修复载荷。**交付运维面**：保持不变 | P3·运行观察面 ↑／P3·交付运维面 ＝ | 运行观察面：SC-01／SC-03／SC-05；交付运维面：不涉及打包／部署脚本 | — |
| P4 管理层 | 不触碰业务指标口径与概览／审计展示面 | 业务口径、数据范围与审计汇总行为不变 | ＝ | SC-04（未触碰查数口径与审计聚合逻辑） | — |

## 1. 背景与已核实事实

| 事实 | 代码 / 证据锚点 | 问题影响 |
|---|---|---|
| `tools/list` 未校验敏感表全量授权：`allowedToolNames()` 现行校验 7 类门禁（`absoluteDenyOrUnclassifiedReason`、`knownTools`/`denyTools`、`degradedGlobal`、`CONTROL_PLANE_TOOL_SET`、`DATA_PLANE_TOOL_SET`、`CONTEXT_TOOL_SET`、`lucy_*` 前缀／`kx_catalog`），但未检查 `policy.sensitiveMetadataTools`（默认落到 `return true`） | `webui/server/proxy/acl.ts:2683-2717`（`2714` 行） | 未获全量匹配敏感表授权的 Agent 仍能在 `tools/list` 看到 `policy.sensitiveMetadataTools` 工具 |
| `DEFAULT_SENSITIVE_METADATA_TOOLS` 默认仅含 `["dictionary_search", "discover_data"]`；`entity_details` 属 `DATA_PLANE_TOOLS`，仅在 `requested.length === 0`（或现场 `access.yaml` 自定义配入 `sensitive_metadata_tools`）时触发 `sensitive_metadata_forbidden:kx` | `webui/server/proxy/acl.ts:105, 195, 3488-3496`；[`inbox/lucy-ksc-finreport-error-log.md`](../../inbox/lucy-ksc-finreport-error-log.md) | 现场日志中 `entity_details` 被拒属特定配置或解析零表路径；本 Spec 对齐 `policy.sensitiveMetadataTools`，不改变默认 DataPlane 可见性规则 |
| `tools/call` 严格执行 fail-closed：`authorizeAndRewrite()` 在 `sourceMap` 存在时调用 `hasExplicitAccessToAllSensitiveTables()`；当 `sensitiveTables(state, prefixes)` 为空或未显式全量包含时返回 `false`（`tables: ["*"]` 通配亦不算显式全量） | `webui/server/proxy/acl.ts:775-777, 779-782, 3436-3438`；`webui/server/__tests__/kx-acl.test.ts:541-542` | 不读 `instructions` 的客户端看到敏感元数据工具后调用，必得 `sensitive_metadata_forbidden:kx` |
| YAML `sensitive_table_prefixes: []` 不会清空运行时前缀：`aclPolicy()` 通过 `mergedConfigList()` 恒定并入 `DEFAULT_SENSITIVE_TABLE_PREFIXES`（`["dataforai.kx_"]`），demo 默认配置命中 fail-closed 是因为 `sourceMap` 无匹配 `dataforai.kx_` 的表 | `webui/server/proxy/acl.ts:196, 227-242`；4 份 demo `access.yaml` | 若 `tools/list` 与 `tools/call` 语义不对齐，默认 demo 亦存在接口语义分叉 |
| 依代码审查确认，`buildDenialRepairPayload()` 在 `!resolved?.ok` 时返回 `null`；命中时已具 B15 闭环，但未针对 `sensitive_metadata_forbidden:*` 给出逃生引导，且多来源时会拼接两遍全量列表（`5576-5578` 的「可用来源」与 hint 内 `suggestedSources`） | `webui/server/proxy/mcp-proxy.ts:5540-5582, 5676` | Agent 缺少明确下一步，误调后无法快速切换逃生路径 |
| 数据问答指引通过 `InitializeResult.instructions` 下发，同时在 `initialize` 阶段由 `resolveInstructionsVisibility()` 计算 `visibleTools` | `webui/server/proxy/mcp-proxy.ts:2179-2193, 2508-2535` | 忽略 MCP `instructions` 的客户端仅依赖 `tools/list` 与工具报错文本决策 |

## 2. 需求摘要

### 2.1 功能需求

1. **门禁双重生效对齐（与 `acl.ts:3436` 语义一致）**：
   - `allowedToolNames(identity)` 在判定 `policy.sensitiveMetadataTools.has(tool)` 时，执行与 `authorizeAndRewrite()`（`acl.ts:3436`）一致的判定：**当 `runtime.sourceMap` 存在时**，检查 `hasExplicitAccessToAllSensitiveTables(resolved.permissions.tables, runtime.sourceMap, policy.sensitiveTablePrefixes)`。
   - 具体规则：在 `runtime.sourceMap` 存在的前提下，若 `sensitiveTables(runtime.sourceMap, policy.sensitiveTablePrefixes)` 为空（无任何匹配敏感表）、或 Agent 的 `resolved.permissions.tables` 未显式包含全部匹配敏感表（`tables: ["*"]` 通配不算显式全量），则从 `tools/list` 与 `initialize` 阶段计算的 `visibleTools` 中隐藏 `policy.sensitiveMetadataTools` 内的全部工具。
   - 当且仅当 `sensitiveTables` 非空且 Agent 显式拥有全部敏感表（同时角色 `allow.tools` 已授予该工具且未命中其他门禁）时，保留其在 `tools/list` 的可见性与 `tools/call` 的可调用性。
   - **范围明确**：`allowedToolNames()` 仅过滤动态配置集合 `policy.sensitiveMetadataTools`（默认 `dictionary_search`、`discover_data`；若环境在 `access.yaml` 中将 `entity_details` 配入 `sensitive_metadata_tools` 亦一并隐藏，但默认 DataPlane 下的 `entity_details` 保持既有规则）。
2. **`sensitive_metadata_forbidden` 可执行修复提示（兼容 B15 闭环与身份权限过滤）**：
   - 当客户端仍直接调用被 `sensitive_metadata_forbidden:*` 拒绝时，`buildDenialRepairPayload()` 保持既有 `!resolved?.ok` 返回 `null` 边界与 B15 可用性闭环（`collectRepairEvidence` + `buildRepairClosure`）。
   - 在 `reason.startsWith("sensitive_metadata_forbidden")` 时：
     1. 明确说明「跨库全局敏感元数据搜索工具受限，不代表对已授权数据源没有查询权限，请勿继续重试原敏感元数据工具」；
     2. 按该 Agent 实际 `allowedToolNames(identity)` 过滤推荐工具链 `nextTools`（按 `["lucy_catalog", "lucy_read_source", "lucy_query"]` 交集输出，例如角色未授 `lucy_read_source` 时不得推荐 `lucy_read_source`）；
     3. 当 `allow.sources.length === 0` 时，由 B15 闭环输出「当前无可用来源」的事实性错误，严禁输出「请查询下方可用来源」的死路文案；当 `allow.sources` 较多时避免在 `text` 中重复拼接两遍完整来源清单。
   - **安全与暴露边界**：修复提示中仅允许出现当前 `effectivePermissions(identity)` 内的连接与来源，严禁泄露未授权表名或敏感表前缀细节。同时明确：**本修复定位为可见性对齐与降噪，不构成新的列名保密边界**（已授权来源的列名仍可经 `lucy_read_source` 或 `lucy_query` 报错信息获取）。

### 2.2 非功能需求

| 维度 | 要求 |
|---|---|
| 安全 | 绝不放宽 `authorizeAndRewrite()` 的 `sensitive_metadata_forbidden:kx`、ACL、Row Policy 或 `AbsoluteDeny` 判定；`tools/list` 隐藏敏感元数据工具只收紧暴露面，不扩大任何数据访问权；本修复不收缩既有已授权表的元数据暴露面 |
| 性能 | `allowedToolNames()` 复用已提交 `EffectivePolicy` 的 `runtime.sourceMap` 与 `resolved.permissions.tables`，不新增磁盘扫描或上游请求 |
| 兼容 | 不改动任何 Tool `inputSchema`，既有客户端参数形态与 `kx-acl` / `mcp-proxy` 行为 100% 向后兼容 |

## 3. 核心流程（伪代码）

```text
// 1. tools/list 与 visibleTools 过滤（webui/server/proxy/acl.ts -> allowedToolNames）
function isToolVisibleInList(tool, resolved, runtime, policy):
  if absoluteDenyOrUnclassifiedReason(tool): return false
  if !policy.knownTools.has(tool) or policy.denyTools.has(tool): return false
  if runtime.degradedGlobal and isDegradedBlockedTool(tool): return false

  // 新增：敏感元数据工具与 tools/call (acl.ts:3436) 门禁对齐
  if policy.sensitiveMetadataTools.has(tool):
    if runtime.sourceMap and !hasExplicitAccessToAllSensitiveTables(
         resolved.permissions.tables,
         runtime.sourceMap,
         policy.sensitiveTablePrefixes
       ):
      return false

  // 其余现有分支（ControlPlane / DataPlane / Context / lucy_*）保持不变
  ...

// 2. tools/call 拒绝修复载荷（webui/server/proxy/mcp-proxy.ts -> buildDenialRepairPayload）
function buildDenialRepairPayload(identity, reason):
  resolved = await effectivePermissions(identity).catch(() => null)
  if !resolved?.ok: return null

  allow = denialAllowList(resolved.permissions)
  closure = runB15RepairClosure(allow)

  if reason.startsWith("sensitive_metadata_forbidden"):
    actualAllowed = new Set(await allowedToolNames(identity))
    nextTools = ["lucy_catalog", "lucy_read_source", "lucy_query"].filter(t => actualAllowed.has(t))
    if allow.sources.length === 0:
      guidance = "全局敏感元数据搜索工具受限，且当前身份暂无已授权来源，请联系管理员授权数据源。"
    else:
      guidance = "全局敏感元数据搜索工具受限，但这不影响查询已授权数据源。请勿继续重试敏感元数据搜索工具；"
               + (nextTools.length > 0 ? "可改用 " + nextTools.join(" → ") + " 完成查询。" : "")
    return {
      text: formatAllowSummaryWithoutDuplicateSources(allow, guidance, closure),
      payload: { reason, failureDimension: "权限拒绝", connections: allow.connections, sources: allow.sources, nextTools }
    }
  ...
```

## 4. 验收（SC）

| ID | 合同 | 对应 UAT |
|---|---|---|
| SC-01 | 当 `runtime.sourceMap` 存在且 `sensitiveTables(runtime.sourceMap, policy.sensitiveTablePrefixes)` 非空而 Agent 未显式拥有全部敏感表（含 `tables: ["*"]` 通配），或 `sensitiveTables` 为空（无匹配敏感表）时，`tools/list` 与 `initialize` 阶段计算的 `visibleTools` 均不包含 `policy.sensitiveMetadataTools` 工具（默认 `discover_data`、`dictionary_search`；若环境将 `entity_details` 配入该集合则一并包含） | UAT-MCCC-01 |
| SC-02 | 当 `sensitiveTables` 非空且 Agent 显式拥有全部敏感表授权（且角色 `allow.tools` 已授予）时，`tools/list` 仍正常包含敏感元数据工具，且 `tools/call` 放行 | UAT-MCCC-02 |
| SC-03 | 未获全量敏感表授权的 Agent 直接调用 `policy.sensitiveMetadataTools` 工具时，仍返回 `Access denied: sensitive_metadata_forbidden:kx`；响应区分「全局搜索受限 vs 已授权表可查」，`nextTools` 经 `allowedToolNames` 过滤，零可用来源走 B15 事实性错误（无死路引导），多来源时不重复拼接两遍列表；并验证通过 `lucy_catalog → lucy_read_source → lucy_query` 逃生取数成交 | UAT-MCCC-03 |
| SC-04 | `kx-acl` 与 `mcp-proxy-acl` 单测全绿（含「`sensitiveTables` 为空 + `sensitive_metadata_tools` 非空」的 fail-closed 覆盖），绝对禁用工具与未授权 `kx_*` 表仍严格拦截，无权限放宽 | UAT-MCCC-04 |
| SC-05 | 审计流水正确记录被拒调用的 `decisionReason=sensitive_metadata_forbidden:kx` 与 `outcome=denied`，修复载荷与日志均不泄露未授权表名或凭据 | UAT-MCCC-03／04 |

## 5. 开放项

| ID | 问题 | 裁定结论 / 去向 |
|---|---|---|
| OQ-1 | 原 `MCP_INVALID_OPERATION` 与 `inputSchema`（`anyOf`／`additionalProperties`）改造如何处理？ | **本轮剥离**：现场日志未包含 `MCP_INVALID_OPERATION` 载荷，且 `lucy_query` 已正常成交；待拿到真实客户端报错抓包后再单开 Spec 评估 |
| OQ-2 | 当 `sensitive_table_prefixes` 为空或 `sourceMap` 无任何匹配敏感表时，`allowedToolNames()` 是否保持与 `acl.ts:779-782, 3436` 一致的 fail-closed？ | **裁定保持 fail-closed**：`runtime.sourceMap` 存在且 `sensitiveTables(...)` 为空时 `hasExplicitAccessToAllSensitiveTables` 返回 `false` → `tools/list` 隐藏 + `tools/call` 拒绝，并由单测与 UAT-MCCC-01 对照覆盖 |
| OQ-3 | 日志 §2.2 暴露 `connection_list`／`kx_catalog` 缺少 `lucy-ops` 而 `lucy_catalog` 包含 `lucy-ops` 的工具间可见性差异 | **本轮不改，单列登记**：属同类「工具间可见性不对齐」问题，待另案核查控制面/运维连接过滤口径并入错题本或独立 Spec |
| OQ-4 | 日志 §2.5 暴露 `dwd_ksc_finreport_release_metric_sum.amount` 在已使用 `source.column` 限定名时仍报 `ambiguous_field` | **本轮不改，单列登记**：属语义层字段消歧问题，不在本 Spec 范围，另案排查 |
