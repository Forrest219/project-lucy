# Lucy 行权限编译门禁与各面拒绝码统一 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；本条待 PM 指派台账号后再登记 |
| 需求池条目 | REQ-030-013（编译门禁）＋ REQ-030-016（拒绝码统一），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只登记设计与验收口径，不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 配套 Plan | [lucy-20261107-row-policy-compile-gate-deny-code-plan.md](../plans/lucy-20261107-row-policy-compile-gate-deny-code-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 上位合同 | [`webui/docs/99-access-control-p1-row-policy-spec.md`](../../webui/docs/99-access-control-p1-row-policy-spec.md)、[`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md)、[`docs/access-control/adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md)、[`docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md`](lucy-20261022-v2p5-row-permission-management-spec.md) **§14.2–§14.4**（该 Spec 的 §3.5／§5.5 已被 §14 整体替代，不得脱离 §14 单独作为实现或验收依据） |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：在受行权限保护的 source 上，把度量名或派生列用作谓词字段的查询请求，一律在本机被拒绝且不产生任何上游执行；同一拒绝语义在各 MCP 工具面与浏览器面返回同一个 reason code。
- 本条出口：能打假这两条的检查——本机单元／组件自动化（谓词字段门禁、拒绝码判定顺序）与真实进程内 Proxy 自动化（受保护 source 上零上游执行、各面拒绝码一致）。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级（客户环境）、镜像构建与客户交付。
- 上线关系：本条收口不表示可上线

---

## 1. 背景与取证

### 1.1 实跑证据

2026-11-05 row-policy 强度 B 两阶段实跑（`inbox/e2e/final-rds-20261105`，证据 `evidence/phase-on/security.json` 的 case `SEC-11-BY19`）：

| 断言 | 结果 | 证据原文 |
|---|---|---|
| `deny` | **失败** | `BY-19: response was not a recognized envelope (source=mcp_iserror_other)` |
| `upstream_exec_zero` | **失败** | `measured upstream executions=1, authorized baseline=0 (0 authorized request(s) × 2); unauthorized=1 (must be 0)` |
| `allow_control` | 通过 | `BY-19 control: Region set ["华东"] expected ["华东"]` |
| `typed_gold` / `real_query` | 通过 | 同 case 的合法对照（`filters: []`）仍返回正确 Region 集合 |

结论：**度量名作谓词字段的请求没有被本机门禁拦下，而是带着请求走到了上游**（上游执行被记 1 次），最终以不可识别的错误信封返回。这与合同口径「编译期拒绝且零上游执行（fail-closed）」相反。

同一实跑的 BY-06／BY-17 记录：同一类「受保护 source 上调用非取数工具」的拒绝，在各 MCP 工具面实测为 `tool_forbidden`，而**单元合同期望**（`webui/server/__tests__/row-policy-ac-p1.test.ts` 的 BY-06/07/17 用例）与 **e2e harness 断言**（`scripts/e2e/security/row-policy-cases.mjs:627`、`:629`、`:839`）均为 `row_policy_requires_wrapped_tool`。**浏览器面**：ROW25-V17 只是 e2e 合同定义处（`webui/tests/real-e2e/access-v025.mjs:287-297`），其 localCoverage 内无该码断言，**浏览器面实跑证据未核实**——本条不以浏览器面为口径依据，改以「服务端同一处 `AclDecision.reason`」为准（见 SC-09）。

### 1.2 代码事实

| 编号 | 事实 | 位置 |
|---|---|---|
| F1 | `validateProtectedLucyQueryArgs` 是受保护 source 上 `lucy_query` 的**形状门禁**：禁 raw SQL／query、禁形状键、`filters` 禁字符串与禁用树键、`measures[].expr` 禁止。**它不校验 `filters[].field` 是否可作谓词** | `webui/server/proxy/row-policy.ts:407-455` |
| F2 | 服务端**行策略自身**的字段绑定有 measure 分支：`catalog.measures.has(field)` → `row_policy_field_unresolved:measure`；否则 `catalog.columns.has(field)` 才放行 | `webui/server/proxy/row-policy.ts:196-204` |
| F3 | 客户端 `filters[].field` 走的是 F1 的形状门禁，**不经过 F2 的字段绑定** | `webui/server/proxy/acl.ts:3197-3200`（`lucy_query` 分支只调 `validateProtectedLucyQueryArgs`） |
| F4 | 受保护 source + unwrapped 工具 → `row_policy_requires_wrapped_tool` | `webui/server/proxy/acl.ts:3193-3196` |
| F5 | **工具级判定先于行策略判定**：工具未授予时先返回 `tool_forbidden` | `webui/server/proxy/acl.ts:3098-3103`（在 `3193-3196` 之前） |
| F6 | 行策略目录的 `columns` = 物理列 ∪ 已证明行级 overlay 派生列（`addProvenOverlayFields` 把证明为行级的 overlay 表达式并入 `columns`） | `webui/server/proxy/row-policy-catalog.ts:50-53`、`129-147` |
| F7 | 目录接口只暴露 `columns` 与 `measures` 两个集合，**不区分物理列与派生列** | `webui/server/proxy/row-policy-catalog.ts:50-53` |

### 1.3 根因

- **R1（对应 REQ-030-013）**：本机对客户端谓词只有**形状门禁**、没有**字段级门禁**。度量名 `total_sales` 出现在 `filters[].field` 时，F1 判为合法形状 → 请求放行到上游 → 上游语义编译失败 → 上游执行被记 1 次。这是**闸门缺失**，不是闸门失效。
- **R2（对应 REQ-030-016）**：授权主流程中**工具级判定先于行策略判定**（F5）。同一拒绝语义「受保护 source 上调用 unwrapped 工具」，因 Agent 是否被显式授予该工具而落到两个不同 reason code（`tool_forbidden` / `row_policy_requires_wrapped_tool`）。拒绝行为本身没问题，**码分叉**。

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | 字段级门禁落在 **Lucy MCP Proxy**（`acl.ts` / `row-policy.ts`），不落在 KTX 上游 | KTX 是上游依赖，本仓库不改其源码；闸门必须在本机、请求上行之前生效，才能兑现「零上游执行」 |
| D2 | 字段级门禁**只对受行权限保护的 source 生效**（`FinalRows ≠ TRUE`） | 不受保护的 source 上引入新的拒绝码会改变现有语义面，超出本条范围 |
| D3 | 对外只返回**一个** reason code：`row_policy_predicate_field_not_allowed`；**不区分**「是度量 / 是派生列 / 不存在」 | 区分会造成语义层字段枚举面。内部归因（measure／derived／unknown）只进审计回执，不随拒绝原因返回 |
| D4 | **行权限约束优先于工具授予**：受保护 source + unwrapped 工具 → 一律 `row_policy_requires_wrapped_tool` | 这是本产品线对受保护源的强承诺；工具未授予在别的路径仍以 `tool_forbidden` 呈现，不丢信息 |
| D5 | **不动**冻结的 catalog 合同字面量：可绑定字段集合、状态语义、R5 归因码均不改 | 需求池 REQ-030-013 明列「不改冻结 catalog 合同字面量」。目录只**增**可读拆分（物理列／派生列），不改变「哪些字段可绑定」 |
| D6 | 服务端行策略谓词绑定**已证明行级 overlay 派生列**的路径不改口径，登记为已知残余 | 该路径属 `docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md` **§14.4** 的现行合同（其 §3.5／§5.5 已被 §14 整体替代，仅作历史追溯）；改它等于改冻结合同 |
| D7 | 拒绝码统一在**同一处服务端判定**产生，浏览器面与 MCP 工具面共用同一 `AclDecision.reason` | 两面若各自映射，就不存在「同一码」可验证 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：受保护 source 上的客户端谓词字段门禁（REQ-030-013）

```text
# 位置：webui/server/proxy/acl.ts（lucy_query 授权分支）＋ webui/server/proxy/row-policy.ts（新增字段判定）
# 目标：度量／派生列作谓词字段 → 本机拒绝，零上游执行

function authorizeLucyQuery(args, identity):
    # 0) 既有形状门禁，顺序与码不变（F1）
    shapeDeny = validateProtectedLucyQueryArgs(args)
    if shapeDeny != null:
        return deny(shapeDeny)

    resolved = resolveEffectivePermissions(identity, config, policy, {sourceMap})
    if not resolved.ok:
        return deny(resolved.reason)

    requested = extractTables("lucy_query", args, {sourceMap: runtime.sourceMap})
    protectedSources = collectProtectedSources("lucy_query", requested, resolved, runtime.sourceMap)
    #   collectProtectedSources 复用现有 FinalRows 判定：
    #     capability = resolveCapabilityForTable(...)
    #     finalRows = lookupFinalRows(resolved.permissions.finalRowsBySource, ...)
    #     命中 finalRows.kind == "scoped" 即受保护

    # 1) 【新增】字段级门禁：只对受保护 source 生效（D2）
    if protectedSources is not empty:
        verdict = validatePredicateFieldsAgainstCatalog(args, protectedSources)
        if verdict.denyReason != null:
            #   对外单一码（D3）；内部归因只进审计
            recordAuditAttribution(verdict.attribution)   # measure / derived / unknown / catalog_unavailable.{manifest_unavailable|catalog_capability_unknown}
            return deny("row_policy_predicate_field_not_allowed")

    # 2) 既有行策略注入流程不变（FinalRows / forcedFilters / upstream proven）
    ...  # 现行 acl.ts:3197-3213 逻辑不动

function validatePredicateFieldsAgainstCatalog(args, protectedSources):
    for each filter in normalizeFilters(args.filters):
        field = normalizeRef(filter.field)
        for each src in protectedSources:
            catalog = loadSourceFieldCatalogWithProvenance(src.connectionId, src.sourceName, src.schema)
            #   复用既有 R5 目录装载；状态语义不改（D5）
            if catalog.status != "loaded":
                #   目录不可用 → fail-closed，拒；但对外码与字段类失败相同（D3）
                #   ⚠️ 内部归因必须保留两态（v2p5 §14.4：能力未知不得借以掩盖 I/O／结构故障）：
                #      catalog_unavailable.manifest_unavailable  ← 清单缺失／读失败／解析失败（I/O 或结构故障）
                #      catalog_unavailable.catalog_capability_unknown ← 目录能力未知（能力态）
                #   两态对外不可区分（单一码），审计回执必须可区分。
                return deny("row_policy_predicate_field_not_allowed"), attribution("catalog_unavailable." + catalog.status)
            if field in catalog.measures:
                return deny("row_policy_predicate_field_not_allowed"), attribution("measure")
            if field in catalog.derivedColumns:      # 目录新增可读拆分（D5）
                return deny("row_policy_predicate_field_not_allowed"), attribution("derived")
            if field not in catalog.physicalColumns:
                return deny("row_policy_predicate_field_not_allowed"), attribution("unknown")
    return allow()
```

**目录可读拆分（D5 的唯一改动）**：`SourceFieldCatalog` 增加两个只读集合，**不改变**既有 `columns`／`measures` 的内容与语义：

```text
interface SourceFieldCatalog:
    columns: Set<string>        # 既有：物理列 ∪ 已证明行级 overlay 派生列（口径不变）
    measures: Set<string>       # 既有：度量（口径不变）
    physicalColumns: Set<string>   # 新增：仅物理列
    derivedColumns: Set<string>    # 新增：已证明行级 overlay 派生列
```

### 3.2 流程 2：拒绝码归一——行权限语义优先（REQ-030-016）

```text
# 位置：webui/server/proxy/acl.ts 授权主流程
# 目标：同一拒绝语义在 MCP 工具面与浏览器面得到同一个 reason code

function authorizeAndRewrite(toolName, args, identity):     # 唯一授权入口 acl.ts:3045-3221
    resolved = resolveEffectivePermissions(identity, config, policy, {sourceMap})
    if not resolved.ok:
        return deny(resolved.reason)

    # 【新增·只读计算】复用现行 3163 门控语义：仅当 !allowedTables.includes("*") && sourceMap
    #   时该 Agent 才受行策略约束。tables:["*"] 的 Agent 不受约束 → 不参与归一，行为不变。
    rowPolicyApplies = (not allowedTables.includes("*")) and (sourceMap != null)
    protectedSources = []
    if rowPolicyApplies:
        requested = extractTables(toolName, args, {sourceMap: runtime.sourceMap})
        protectedSources = collectProtectedSources(toolName, requested, resolved, runtime.sourceMap)

    # 既有工具级判定（位置不变 acl.ts:3098-3103）：仅在「受行策略约束 + unwrapped 工具」时改码
    if allowedTools and not allowedTools.includes("*") and not allowedTools.includes(toolName):
        if rowPolicyApplies and protectedSources is not empty and ROW_POLICY_UNWRAPPED_TOOLS.contains(toolName):
            return deny("row_policy_requires_wrapped_tool")   # 归一后的唯一码（D4）
        return deny("tool_forbidden")          # 其余场景原样：工具未授予
    if allowedTools.includes("*") and not policy.knownTools.has(toolName):
        return deny("tool_forbidden")
    ...  # 3110-3169 的六类专门码顺序与码全部不变；3193 的行权限判定仍作为「已授予工具」的兜底
```

**顺序不变式**：本条**不移动任何既有判定**。归一不靠「前移」，靠在工具级判定处按「该 Agent 是否受行策略约束」换一个码；六类专门码与行权限注入分支的相对位置不变。

**流程 1 与流程 2 的关系**：两者同属 `authorizeAndRewrite` 单一入口。流程 1（字段级门禁）落在**行权限注入分支之前**（即 3192 与 3193 之间），流程 2（拒绝码归一）落在**工具级判定处**（3098）。最终行序＝工具级判定（含归一）→ 六类专门码 → 字段级门禁 → 行权限注入。

**判定优先级表**（同一场景唯一出口）：

| 场景 | 工具是否显式授予 | source 是否受保护 | 唯一 reason code |
|---|---|---|---|
| 受保护 source 调 unwrapped 工具 | 是 | 是（该 Agent 受行策略约束） | `row_policy_requires_wrapped_tool` |
| 受保护 source 调 unwrapped 工具 | 否 | 是（该 Agent 受行策略约束） | `row_policy_requires_wrapped_tool`（本条归一的唯一场景） |
| 受保护 source 调 unwrapped 工具 | 任意 | **否**（`tables:["*"]` 的 Agent 不受行策略约束） | `tool_forbidden`（现状不变，本条不介入） |
| 非受保护 source 调未授予工具 | 否 | 否 | `tool_forbidden` |
| 受保护 source 调 wrapped 工具（`lucy_query`）但未授予 | 否 | 是 | `tool_forbidden`（工具未授予，仍是更一般的 ACL 事实） |
| 命中其他专门约束（raw SQL／敏感元数据／未声明连接） | 任意 | 任意 | 各自的既有专门码，不受本条影响 |

### 3.3 流程 3：拒绝后的零上游执行（验收取证口径）

```text
# 位置：scripts/e2e/security/row-policy-cases.mjs（BY-19 / BY-06 / BY-17）

case BY_19:
    win = observeWindow(label="BY-19 (denied target)")
    res = lucyQuery(token, {...PACK_REGION_QUERY,
                            filters: [{field: "total_sales", op: "eq", value: 1}]})
    assert res.status < 500
    assert denyReason(res) == "row_policy_predicate_field_not_allowed"   # 可识别的拒绝信封
    win.finish()                       # 先关窗，再跑合法对照，避免对照的执行被计入
    assert upstreamExecutions(win) == 0 # 关键断言：拒绝不得产生任何上游执行

    control = lucyQuery(token, {...PACK_REGION_QUERY, filters: []})      # 合法对照
    assert allowed(control) and regionSet(control) == ["华东"]
```

---

## 4. 验收

### 4.1 A 组：REQ-030-013（编译门禁）

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 受保护 source 上 `filters[].field` = 度量名 → 本机拒绝，拒绝码 = `row_policy_predicate_field_not_allowed`，上游执行 = 0 | 真实进程内 Proxy 自动化（BY-19 复跑）＋ 单元 |
| SC-02 | 受保护 source 上 `filters[].field` = 派生列（overlay `columns[].expr`） → 同 SC-01 的拒绝码，零上游执行 | 单元（目录可读拆分）＋ 进程内自动化 |
| SC-03 | 受保护 source 上 `filters[].field` = 物理列 → 放行，结果集仍受行权限约束（合法对照不回归） | 进程内自动化（BY-19 control） |
| SC-04 | 目录不可用（清单缺失／解析失败／能力未知）时字段级门禁 **fail-closed**：拒绝而非放行。**对外拒绝码仍单一，但审计回执须保留 `manifest_unavailable` 与 `catalog_capability_unknown` 两态**（v2p5 §14.4：能力未知不得借以掩盖 I/O／结构故障） | 单元（目录状态注入 ＋ 审计回执两态断言） |
| SC-05 | 不受行权限保护的 source 上行为不变：不新增拒绝码，既有语义与结果集不回归 | 单元（未受保护 source 对照） |
| SC-06 | 对外拒绝码**不泄露字段存在性**：度量／派生列／未知三类对外码完全一致，差异只出现在审计回执的内部归因 | 单元（三类输入的对外码相等断言）＋ 审计回执断言 |

### 4.2 B 组：REQ-030-016（拒绝码统一）

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-07 | 受保护 source 上调用 `entity_details`／`sl_validate`／`lucy_freshness`／`lucy_read_source`，**无论 Agent 是否被显式授予该工具**，各面 reason code 均为 `row_policy_requires_wrapped_tool` | 进程内自动化（BY-06／BY-17 复跑）＋ 单元 |
| SC-08 | 非受保护 source 上未授予工具 → 仍为 `tool_forbidden` | 单元 |
| SC-09 | 浏览器面（行权限视图／预览路径）与 MCP 工具面在同一场景返回同一 reason code，且二者来自同一处服务端判定 | 单元（两侧读同一 `AclDecision.reason`） |
| SC-10 | 既有单元合同测试（`row-policy-ac-p1.test.ts` BY-06/07/17）与 e2e harness（BY-06/17）在改动后断言**同一码**，无需按场景分叉 | 既有测试全绿＋harness 断言改写 |
| SC-11 | `tables:["*"]` 的 Agent（不受行策略约束，`acl.ts:3163` 门控）在受保护 source 上调 unwrapped 工具时，**拒绝码仍为 `tool_forbidden`**（现状不变，本条不介入归一） | 单元（`tables:["*"]` 角色组合断言） |

### 4.3 出口与不在出口

- 本条出口＝SC-01–SC-11 全部关闭。
- 客户端环境、Agent 路径、整库旅程、客户环境证据不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `row_policy_predicate_field_not_allowed` — 机器 reason code（行权限 `row_policy_*` 命名空间）。对应既有「Row Policy」族的用户可见语义「行权限拦截」，**不新造用户可见译名**。须在 `webui/docs/00-product-terminology-standard.md` 的 reason code 表登记后方可实现。

本条不新增产品概念、不新增 WebUI 文案；`row_policy_requires_wrapped_tool` 是既有码，本条只改其触发时机使其各面一致，其登记信息不变。

---

## 6. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/README.md`（Governance：状态与错误码呈现规则）
- `webui/docs/00-product-terminology-standard.md`（reason code → 用户可见文案映射）

### What This Change Follows

- 本条不新增视觉模式、不新增组件、不改布局、不改交互。拒绝码到用户可见文案的映射沿用既有 reason code 表；新增一个 reason code 走既有登记流程，不新造文案。
- 本条不涉及浏览器窄屏或移动端表现。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 新增 reason code 需登记进 `webui/docs/00-product-terminology-standard.md`（Plan S1 前置项）。

---

## 7. 非目标

- 不改 KTX 上游源码；不改语义层 catalog 的「可绑定字段集合」口径（D5）。
- 不改服务端行策略绑定「已证明行级 overlay 派生列」的既有合同（D6，登记为残余）。
- 不改 `--pack row-policy` 的只读边界；不涵盖 forged forced 的处理口径（BY-05 归 debug，见需求池）。
- 不改上游强制谓词未证明时的 `row_policy_upstream_unproven` 口径。
- 不新增行权限产品能力；本条只补门禁与统一码。

## 8. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | 服务端行策略谓词可绑定「已证明行级 overlay 派生列」，该路径仍可能在上游语义编译阶段失败 | 属 `v2p5 §14.4` 既有合同；本条按 D6 不动 | 后续条目，待与 KTX 语义编译口径一并评估 |
| RES-02 | 客户端 `filters[]` 之外的谓词载体（`segments[]`、自然语言条件）未纳入字段级门禁 | ADR D-FP-07 明确它们永不成为强制谓词的一部分，风险面不同 | 后续条目 |

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 字段级门禁误杀合法查询 | 物理列判定若与目录装载口径不一致，会把合法过滤拦掉 | 目录可读拆分与 `columns` 同源同口径（D5）；SC-03 合法对照必须通过 |
| 判定顺序前移改变既有拒绝码 | 工具级判定前移会影响未授予工具的既有码 | 仅对「受保护 source + unwrapped 工具」生效；SC-08 锁住其余路径 |
| 对外码统一削弱可诊断性 | 合并为单一码后，运维看不出具体字段问题 | 内部归因进审计回执（SC-06）；运维读审计而非拒绝信封 |
| 目录不可用导致大面积拒绝 | 目录装载失败即 fail-closed，可能拦住本来合法的查询 | 目录不可用属配置故障（清单缺失／解析失败），本就该拒绝；SC-04 锁住 fail-closed 方向 |

## 10. 出处

- 需求池：[`REQ-030-013`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)、[`REQ-030-016`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 实跑证据：`inbox/e2e/final-rds-20261105/evidence/phase-on/security.json`（case `SEC-11-BY19`）
- harness 用例：[`scripts/e2e/security/row-policy-cases.mjs`](../../scripts/e2e/security/row-policy-cases.mjs)
- 上位合同：[`webui/docs/99-access-control-p1-row-policy-spec.md`](../../webui/docs/99-access-control-p1-row-policy-spec.md)、[`docs/access-control/adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md)
