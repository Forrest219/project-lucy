# Lucy 语义层孤儿路径治理（lucy-ops 反查孤儿） Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派台账号后再登记 |
| 需求池条目 | REQ-030-015（语义层孤儿路径治理），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 配套 Plan | [lucy-20261107-semantic-orphan-path-governance-plan.md](../plans/lucy-20261107-semantic-orphan-path-governance-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 上位合同 | [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)、[`docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md`](lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：按表反查（`GET /api/admin/row-policy/views/tables`）出现、而访问关系图（`GET /api/admin/access-map`）没有的孤儿表，能被逐条清点并做**三选一归因**（残留引用／已删对象／命名漂移）；反查与关系图读**同一份快照口径**；孤儿在两处的呈现**一致**（要么都不计入路径数，要么都计入并带标注）；归因不明时**失败关闭**——不擅自重建语义层对象、不静默丢弃。
- 本条出口：能打假这两条的检查——本机仓库自动化（归因枚举完整性、快照身份一致、孤儿处置两处同构、归因不明失败关闭）与既有关系图／反查合同测试不回归。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级（客户环境）、镜像构建与客户交付。
- 上线关系：本条收口不表示可上线

---

## 1. 背景与取证

### 1.1 池内记录的实跑现象（来源与边界）

需求池 REQ-030-015 记录：2026-11-05 row-policy 强度 B 实跑（RTV25-06，反查与关系图同快照维度证据）显示，**按表反查出现孤儿路径一批**，均指向 `lucy-ops::main::ops_*`；**关系图计数与反查路径数因此不一致**；性质为语义层／视图数据完整性问题，非用例问题。（[`docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) §REQ-030-015）

### 1.2 仓内可核实的合同事实

| 编号 | 事实 | 位置 |
|---|---|---|
| F1 | RTV25-06 的「孤儿」有**精确定义**：反查表键集合减去关系图表节点键集合；断言要求 `orphans.length === 0` 才算一致通过 | `webui/tests/real-e2e/row-policy-templates-v025.spec.ts:1176`、`:1188`、`:1191` |
| F2 | RTV25-06 读的两个端点：`GET /api/admin/row-policy/views/tables` 与 `GET /api/admin/access-map` | `webui/tests/real-e2e/row-policy-templates-v025.spec.ts:1169`（viewList 调用）、`:1170`（access-map 调用）；`:275-278` 是**共用 helper** 的定义处，不是 RTV25-06 的调用点 |
| F3 | 三面表键格式**本就不同**：access map node id = `table:<conn>::<schema>::<source>`；authorization summary = `<conn>|<schema>|<source>|<physicalTable>`；row-policy view = `{connectionId, schema, sourceName}`。测试侧靠 `canonicalTableKey` 归一成 `<conn>::<schema>::<source>` 才可比 | `webui/tests/real-e2e/helpers/table-identity.ts:5-18`、`:24-30` |
| F4 | 关系图的四个数各有定义、互不替代：授权路径（`(Agent, Role, Connection, Schema, Table)` 存在性实例）、访问路径（窗口内有允许调用的去重存在性路径）、闲置授权、需复核信号 | `webui/docs/187-access-relation-sankey-spec.md:43-46`、`:177-194`、`:207-209` |
| F5 | 「同源不等于同数」是既有明文合同：对账断言是「同一 Agent 的摘要表集合 == 本图授权路径的表集合并集」，**不是**「表数 == 路径数」；授权路径数、去重表数、访问路径数、调用数分别表达 | `webui/docs/187-access-relation-sankey-spec.md:149` |
| F6 | 关系图对「有授权但连接未启用（`ktx.yaml` `enabled_tables` 未包含）」的表**不入图**，计入 `meta.orphanGrants` | `webui/docs/187-access-relation-sankey-spec.md` §4.8；实现 `webui/server/admin/access-map.ts:2095-2125` |
| F7 | 关系图的计数装配走共享词汇：`counts.tables` / `counts.grantPaths` / `counts.grantUsers` / `counts.accessPaths` / `counts.accessUsers`，并跑 `assertCountingInvariant` | `webui/server/admin/access-map.ts:1929-1957`（计数装配块，`:1947`／`:1948`／`:1950`／`:1952`）；`webui/server/admin/counting.ts:92-105` |
| F8 | 授权摘要侧另算 `tableCount` 与 `grantPathCount`，同样走共享词汇 | `webui/server/admin/authorization-summary.ts:734`、`:743` |
| F9 | 反查的表集合来自「按 Role 编译出的 capabilities」，用 `tableCountKey` 归一（同名不同连接／Schema 不合并） | `webui/server/admin/row-policy-views.ts:648-675`、`:660` |
| F10 | 反查与关系图**各自**取快照：反查走 `readRowPolicyViewBase`（`readAccessSnapshot` ＋ `buildAdminPermissionContext` ＋ `compileRoleForAdmin`），关系图走 `buildAccessMap`；两者都带 `configVersion` / `policyVersion` / `capabilityDigest`，但**不是同一次调用** | `webui/server/admin/row-policy-views.ts:189-221`；`webui/server/admin/snapshot-identity.ts:36-47`、`:130` |
| F11 | RTV25-06 已经断言两侧 `policyVersion` 相等——即「同快照」在用例侧已有表达，但**没有**在服务端强制 | `webui/tests/real-e2e/row-policy-templates-v025.spec.ts:1189-1190` |
| F12 | 反查与关系图的**同快照对账**是既有关闭项 RTV-06：要求「同快照下表集合一致；授权路径数与去重表数分别表达、不混用」 | `docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md:285`（RTV-06 **通过**行）；⚠️ 同文件 `:260` 的状态列写「开放：两项 Spec 尚未验收」，该表述**已于 2026-11-03 作废**（同文件 `:239` 记明），不得引用为现状。仓库测试 `webui/server/__tests__/p1-row-policy-reconciliation.test.ts:247-298` |
| F13 | `lucy-ops` 的冻结语义层集合是 12 个 source（`ops_calls`／`ops_call_tables`／`ops_agents`／`ops_tokens`／`ops_agent_activity`／`ops_question_kpi_agents`／`ops_grant_paths`／`ops_access_paths`／`ops_edge_signals`／`ops_map_nodes`／`ops_map_meta`／`ops_table_adoption`），`enabled_tables` 取「冻结集合 ∩ Manifest 物理表」 | `webui/server/ops-evidence/contract.ts:84-119`；`webui/server/ops-evidence/connection-block.ts:87-90` |
| F14 | 仓内 `webui/config/ops-evidence/semantic-layer/lucy-ops/` 是**仓库模板**（`_schema/main.yaml` 自述「本文件是仓库模板，由 `ensureOpsEvidence` 复制到解析后的内容根」）；真实内容根在运行时解析 | `webui/config/ops-evidence/semantic-layer/lucy-ops/_schema/main.yaml:1-6`；`webui/server/ops-evidence/ensure.ts:1-24` |
| F15 | 仓内根 `ktx.yaml` **没有** `lucy-ops` 连接块（只有 `mysql-aliyun`（`:26`）/ `doris-r1`（`:43`）/ `starrocks-r1`（`:61`））；`lucy-ops` 的 `enabled_tables` 由 `ensureOpsEvidenceConnectionBlock` 在运行期写入 | `ktx.yaml:25-26`、`:43`、`:61`；`webui/server/ops-evidence/connection-block.ts:286`（`ensureOpsEvidenceConnectionBlock` 定义处，`:286-320`）；`:254-268` 是 `buildOpsEvidenceConnectionBlock`（**构造**用，非写入方） |
| F16 | 连接块收敛规则里已有「孤儿启用」概念：把 `enabled_tables` 收敛到 Manifest 时，**移出 Manifest 里没有的表** | `webui/server/ops-evidence/connection-block.ts:92-116`（`:96` 原文「移出 Manifest 里没有的表（孤儿启用）」） |

### 1.3 三个**候选**机制（仓内可核实「规则存在」，**未**核实「本次实跑由哪条引起」）

| 编号 | 候选机制 | 仓内依据 | 能否单独造成「反查有、图无」 |
|---|---|---|---|
| M1 | **残留引用**：语义层对象在，但授权侧／启用侧仍留有指向它的引用（如角色 `tableSelectors` 仍列着它，而连接 `enabled_tables` 未包含） | F6（不入图并计 `orphanGrants`）、F15（`enabled_tables` 运行期生成）、F16（「孤儿启用」收敛） | 能——图侧按 F6 排除，视图侧按 Role 编译能力列出 |
| M2 | **已删对象**：语义层对象已删除，但授权或启用配置仍引用它 | F13（冻结集合是权威名单）、F16（收敛时移出） | 能——若两侧对「已删」的判定口径不同 |
| M3 | **命名漂移**：对象存在，但两侧记录的表身份不一致（schema／source 名或键格式不同），导致同一张表在两处对不上 | F3（三种键格式本就不同，靠 `canonicalTableKey` 归一）、F9（`tableCountKey` 归一） | **不可判定（除非补齐身份映射集）**——`SourceMapEntry` 只有 `physicalTable`／`sourceName`／`schemaDisplay`（`acl.ts:268-279`），**无别名集**；缺了「sourceName↔physicalTable↔schemaDisplay」的映射事实，就无法判定两侧是否指同一张表 → M3 命中时**必走 `undecidable`**，不得直接判成 `naming_drift` |
| M4 | **快照口径漂移**：两侧各读各的快照，配置／策略代次不同 | F10（两次独立取快照）、F11（只在使用侧断言） | 能——但会被 F11 的 `policyVersion` 断言先暴露 |

### 1.4 未核实（证据不在仓）

| 编号 | 待验项 | 状态 |
|---|---|---|
| U1a | 2026-11-05 实跑 RTV25-06 的**孤儿键清单** | **本机产物已有（但被截断）**——`inbox/e2e/final-rds-20261105/v025/RTV25-06.json` 的 `executorResults.B.detail` 已含孤儿键名（`ops_access_paths`／`ops_agent_activity`／`ops_agents`／`ops_call_tables`／`ops_calls`／`ops_edge_signals`／`ops_grant_paths`…，串尾被截断）。⚠️ 该目录被 `.gitignore:59` 忽略，故「不在仓内」按 git 口径成立，但**本机可得**——不得当作证据缺失 |
| U1b | 该次实跑的**两侧快照身份**（`configVersion`／`policyVersion`／`capabilityDigest`） | **确实未取得**——`RTV25-06.json` 全文（1294 字节）不含这三个字段 |
| U2 | 本次孤儿是否确由 M1／M2／M3 中的哪一条引起，三者占比各多少 | **未核实（证据不在仓）**——需要运行期的 `lucy-ops` 连接块 `enabled_tables`、Manifest 物理表集合与 source map 命中集合三者对比，而这三者都是运行期产物（F14、F15） |
| U3 | 语义层内容根在目标实例上的**实际内容**（是否已被改写、是否与仓内模板一致） | **未核实（证据不在仓）**——仓内只有模板（F14） |
| U4 | 池内记录的「关系图计数与反查路径数不一致」中，「路径数」具体指授权路径数还是访问路径数 | **未核实（证据不在仓）**——池内未写明；F4／F5 已规定四数分别表达，实现前须由实跑产物确认口径 |

> U1–U4 是本条的**开工前置项**（见配套 Plan §开工前置），不是实现细节。未取得实跑证据前不得开工，也不得把 §1.3 的候选机制当结论。

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | 孤儿＝「反查表键集合 − 关系图表节点键集合」，沿用 RTV25-06 既有定义，不新造定义 | F1——复用既有断言口径，避免两套「孤儿」 |
| D2 | 归因**三选一**且必须落在**同一个**枚举上：`stale_reference`（残留引用）／`deleted_object`（已删对象）／`naming_drift`（命名漂移）；归因不明走 `undecidable` | 池内期望方向明列三选一；`undecidable` 是失败关闭的落点，不是第四种归因 |
| D3 | 归因判定**只读**三份运行期事实：Manifest 物理表集合、连接块 `enabled_tables` 集合、source map 命中集合；**不写**任何一份 | 归因是诊断，不是修复；D7 决定本条不重建语义层对象 |
| D4 | 反查与关系图**读同一份快照口径**：两侧的 `configVersion` / `policyVersion` / `capabilityDigest` 必须来自同一代；不一致时**不出数**（返回不可用），不得把混代数字呈现为一致 | F10／F11——把「同快照」从使用侧断言提升为服务端约束 |
| D5 | 孤儿呈现**全局单一模式**：`ORPHAN_PRESENTATION_MODE` 只有两值——`exclude`（孤儿不计入路径数）或 `annotate`（孤儿计入路径数，但两处都带 `orphan` 标注与归因）。**不得两处各选一套** | 池内期望方向「孤儿不再计入路径数，或在两处一致呈现」 |
| D6 | 计数**不混用**：去重表数 / 授权路径数 / 访问路径数分别表达；孤儿剔除不得把「表数」替换成「路径数」，也不得相加 | F4／F5／F7／F8——这是既有明文合同 |
| D7 | **不在本条重建语义层对象**：不新增／删除／改名任何语义层 YAML、Manifest、overlay、连接块 | 池内非目标明写 |
| D8 | **不改 RTV25 合同口径**：RTV25-06 的 `orphans` 定义与 `policyVersion` 对账结构不变；治理后 `orphans.length === 0` 仍成立 | 池内非目标明写 |
| D9 | 归因不明时**失败关闭**：不重建对象、不静默丢弃；单列 `undecidable` 并在反查与关系图**两处一致呈现** | D2 的配套；静默丢弃会被读成「没有孤儿」 |

---

## 3. 核心流程（伪代码）

### 3.1 流程 1：孤儿清点与三选一归因

```text
# 位置：管理端对账步骤（反查 views/tables 与关系图 access-map 共用）
# 目标：把「反查有、图无」的表逐条归因；三选一；归因不明 → 失败关闭

function reconcileOrphans(viewResponse, mapResponse, runtimeFacts):
    # D1：沿用 RTV25-06 的定义
    viewKeys = canonicalTableKeys(viewResponse.tables)        # <conn>::<schema>::<source>（F3）
    mapKeys  = canonicalTableKeys(tableNodesOf(mapResponse))
    orphanKeys = viewKeys - mapKeys

    if orphanKeys is empty:
        return { orphans: [], undecidable: [], snapshot: shared }

    # D3：只读三份运行期事实
    manifestTables = runtimeFacts.manifestPhysicalTables     # Manifest 物理表集合（F13）
    enabledTables  = runtimeFacts.enabledTablesByConnection   # 连接块 enabled_tables（F15）
    sourceMapNames = runtimeFacts.sourceMapSourceNames       # 语义层目录命中集合

    orphans = []
    undecidable = []
    for key in orphanKeys:
        conn, schema, source = splitCanonicalKey(key)

        # 归因 1：残留引用 —— 对象在，但启用/授权侧仍留有指向它的引用
        # ⚠️ 身份口径：`enabled_tables` 存的是**物理表名**（physicalTable），不是 sourceName。
        #    现行实现即如此：`enabled?.has(normalizeRefLike(entry.physicalTable))`
        #    （webui/server/admin/access-map.ts:2117）。而 physicalTable 形如
        #    `dataforai.superstore_orders`，与 sourceName 并不相等（acl.ts:268-269）——
        #    只有 lucy-ops 这类 sourceName == physicalTable 的连接才碰巧相等。
        #    ⇒ 用 sourceName 直接比对会在一般连接上**误判为 stale_reference**。
        #    正确做法：用反查行自带的 physicalTable（row-policy-views.ts:661-666 已带该字段）比对。
        if source in manifestTables and source in sourceMapNames:
            physical = physicalTableOf(reverseLookupRows, key)   # 反查行自带 physicalTable
            if physical is null:
                orphans.append({ key: key, cause: "undecidable",
                                 evidence: ["physical_table_unknown"] })
                continue
            if not enabledTables[conn].has(physical):
                orphans.append({ key: key, cause: "stale_reference",
                                 evidence: ["manifest_hit", "not_enabled"] })
                continue

        # 归因 2：已删对象 —— 对象已不在 Manifest 与目录里
        if source not in manifestTables and source not in sourceMapNames:
            orphans.append({ key: key, cause: "deleted_object",
                             evidence: ["absent_in_manifest", "absent_in_source_map"] })
            continue

        # 归因 3：命名漂移 —— 对象在，但两侧记录的身份不一致
        drift = detectNamingDrift(key, sourceMapNames, manifestTables, runtimeFacts.identityAliases)
        if drift is not null:
            orphans.append({ key: key, cause: "naming_drift", evidence: drift.evidence })
            continue

        # 归因不明 → 失败关闭（D9）：不重建、不静默丢弃
        undecidable.append({ key: key, reason: "attribution_undecidable",
                              evidence: ["manifest_hit" or "absent", "enabled_hit" or "miss"] })

    return { orphans: orphans, undecidable: undecidable, snapshot: shared }
```

**命名漂移的判定（D2 归因 3）**：

```text
function detectNamingDrift(key, sourceMapNames, manifestTables, identityAliases):
    conn, schema, source = splitCanonicalKey(key)
    # 同一物理表在另一处被记成别的 schema/source 名
    for alias in identityAliases.of(conn):
        if alias.sourceName != source and alias.sourceName in sourceMapNames:
            return { evidence: ["alias_hit", alias.schema, alias.sourceName] }
    # 同一 source 名被记成别的 schema
    if (conn, source) in sourceMapNames and schema not in schemaOf(conn, source):
        return { evidence: ["schema_mismatch", schema] }
    return null
```

### 3.2 流程 2：反查与关系图读同一份快照口径

```text
# 位置：两侧响应装配处（反查 row-policy-views ／ 关系图 access-map）
# 目标：同代快照才出数；不同代 → 不可用（D4）

function sharedSnapshot(viewIdentity, mapIdentity):
    same = viewIdentity.configVersion  == mapIdentity.configVersion and
           viewIdentity.policyVersion  == mapIdentity.policyVersion and
           viewIdentity.capabilityDigest == mapIdentity.capabilityDigest
    if not same:
        # 不同代 → 不出数；不得把混代数字呈现为一致
        return { ok: false, state: "unavailable", reason: "snapshot_drift",
                 detail: { view: viewIdentity, map: mapIdentity } }
    return { ok: true, state: "ok", identity: viewIdentity }
```

> 「同代」的判定沿用既有快照身份字段（F10）与 RTV25-06 的 `policyVersion` 对账表达（F11）；本条只是把该一致性从**使用侧断言**变成**服务端出数前提**。

### 3.3 流程 3：孤儿在两处的呈现一致

```text
# 口径二选一，由单一全局常量决定（D5）；两处必须用同一个常量
ORPHAN_PRESENTATION_MODE ∈ { "exclude", "annotate" }

function applyOrphanPolicy(side, orphanKeys, causes, mode):
    if mode == "exclude":
        # 孤儿不计入路径数：表节点、授权路径、访问路径三处同时剔除（D6：不混用）
        # ⚠️ 必须**两侧同构**：关系图侧三结构之外，**反查侧也必须剔除同一份 orphanKeys**，
        #    否则「关系图里没有孤儿、反查侧还列着孤儿表」→ SC-04 的「两处同构」不成立。
        #    故剔除走**同一个函数**，同一份 key 集合。
        side.tableNodes   = side.tableNodes.filter(n => n.key not in orphanKeys)
        side.grantRefs    = side.grantRefs.filter(r => r.key not in orphanKeys)
        side.accessRefs   = side.accessRefs.filter(r => r.key not in orphanKeys)
        side.counts.tables      = countTables(side.tableNodes)
        side.counts.grantPaths  = countGrantPaths(side.grantRefs)
        side.counts.accessPaths = countAccessPaths(side.accessRefs)
        # 反查侧同源剔除（同一 orphanKeys、同一剔除函数）
        side.rows = side.rows.filter(r => r.key not in orphanKeys)
        side.orphanReport = { mode: "exclude", excluded: size(orphanKeys), causes: causes }
        return side

    if mode == "annotate":
        # 孤儿计入路径数，但两处都必须带 orphan 标注与归因（D5：一致呈现）
        for row of side.rows where row.key in orphanKeys:
            row.orphan = true
            row.orphan_cause = causes[row.key]
        side.orphanReport = { mode: "annotate", annotated: size(orphanKeys), causes: causes }
        return side
```

### 3.4 流程 4：归因不明 → 失败关闭

```text
function guardUndecidable(result):
    if result.undecidable is not empty:
        # D9：不重建语义层对象（D7）、不静默丢弃
        # 归因不明的孤儿单列，不计入路径数，且在反查与关系图两处**同样**呈现
        return {
            status: "undecidable",
            orphan_count: size(result.orphans) + size(result.undecidable),
            attributed: result.orphans,
            undecidable: result.undecidable,
            action: "none"                     # 不触发任何修复动作
        }
    return { status: "attributed", orphan_count: size(result.orphans),
             attributed: result.orphans, undecidable: [], action: "none" }
```

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | **归因可枚举**：每条孤儿路径都带且只带一个归因，取值 ∈ {`stale_reference`, `deleted_object`, `naming_drift`}；未归因者不计入路径数 | 单元（三类夹具各造一条孤儿，断言归因值与唯一性） |
| SC-02 | **失败关闭**：归因不明时**不重建**任何语义层对象（语义层目录摘要前后一致）、**不静默丢弃**（单列 `undecidable` 且计数 > 0），且在反查与关系图**两处一致**呈现 | 单元（注入归因不明夹具 ＋ 语义层目录摘要前后比对） |
| SC-03 | **同快照**：反查与关系图的 `configVersion` / `policyVersion` / `capabilityDigest` 来自同一代；不一致时**不出数**（返回不可用），不得呈现混代数字 | 单元（注入两侧身份不一致，断言不可用且无数字） |
| SC-04 | **呈现一致**：`exclude` 模式下两处（关系图侧三结构 ＋ **反查侧行集合**）都不计入该表路径数，且走**同一份 orphanKeys、同一个剔除函数**；`annotate` 模式下两处都计入且都带 `orphan` 标注与归因；两处**不得**各选一套模式 | 单元（两种模式各跑一遍，断言两处处置同构 ＋ 单例模式常量 ＋ 反查侧行集合也已被剔除） |
| SC-05 | **计数不混用**：去重表数 / 授权路径数 / 访问路径数分别表达；孤儿剔除后不得把「表数」替换成「路径数」，也不得相加 | 单元（三个计数字段各自断言，并断言 `grantPaths > tables` 仍成立） |
| SC-06 | **证据可追**：每条归因都带具体证据引用（Manifest 物理表集合命中与否、连接块 `enabled_tables` 命中与否、source map 命中与否、别名命中与否） | 单元（断言每条归因的 `evidence` 非空且元素受限） |
| SC-07 | **不重建语义层对象**：全流程不新增／删除／改名任何语义层 YAML、Manifest、overlay、连接块 | 单元（语义层目录与连接块摘要前后比对） |
| SC-08 | **不改 RTV25 合同口径**：RTV25-06 的 `orphans` 定义（反查键集 − 图节点键集）与 `policyVersion` 对账结构不变。判定式须是「**原始差集先清点归因、后剔除**」：① 治理前对**原始差集**（未剔除前）清点并逐条归因；② 剔除后 `orphans.length === 0` 才成立——**若拿剔除后的集合去归因**，归因会自证为空 | 单元（RTV25-06 既有断言结构不变 ＋ 治理后断言转绿 ＋ 断言 `orphanReport.excluded` 与归因明细**逐条相等**） |
| SC-09 | **既有合同不回归**：关系图守恒与计数装配（`counts.grantPaths > counts.tables`）、反查四态（RTV-01…05）、只读与快照切换（RTV-07／RTV-08）不回归 | 既有仓库测试全绿（`webui/server/__tests__/p1-row-policy-reconciliation.test.ts` 等）＋ 本条单测 |

### 4.1 出口与不在出口

- 本条出口＝SC-01–SC-09 全部关闭。
- 客户端环境、Agent 真实路径、整库旅程、客户环境证据不在本条出口，按 `docs/governance/DEVELOPMENT.md`「证据等级门槛：本机 ＋ CI 即可」处理。
- **本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `stale_reference` / `deleted_object` / `naming_drift` — 机器归因码（孤儿路径三选一）。对应既有语义「孤儿授权」（`meta.orphanGrants`，`webui/docs/187-access-relation-sankey-spec.md` §4.8）与「孤儿启用」（`webui/server/ops-evidence/connection-block.ts:96`），**不新造用户可见译名**。若将来有 UI 呈现，须先登记进术语标准。
- `undecidable` — 机器计数项（归因不明）。语义：孤儿路径存在但三选一归因均不成立，按 D9 失败关闭、单列呈现。**不新造用户可见译名**。
- `orphan` — 机器布尔标注（孤儿）。仅在 `annotate` 模式（D5）下随行出现，与既有 `meta.orphanGrants` 同族。

本条不新增产品概念、不新增 WebUI 文案；「孤儿授权」「孤儿启用」「授权路径」「访问路径」「去重表数」均为既有术语，本条不改其定义。

---

## 6. Design System Compliance

本条**无新增视觉模式与新增组件**：只调整两处**计数与标注**的呈现口径，不新增页面、不改布局、不改交互。若 `annotate` 模式最终落地，孤儿标注沿用既有浮层／徽标样式与既有错误码呈现规则，不新造视觉语言。

### Referenced Specs

- `webui/docs/design-system/README.md`（Governance：状态与错误码呈现规则）
- `webui/docs/187-access-relation-sankey-spec.md` §4.2／§4.8（计数口径与孤儿授权浮层）
- `webui/docs/00-product-terminology-standard.md`（机器码 → 用户可见文案映射）

### What This Change Follows

- 不新增视觉模式、不新增组件、不改布局、不改交互。
- 计数口径沿用既有 `counting.ts` 共享词汇与关系图既有徽标；孤儿标注沿用既有「孤儿授权」浮层说明样式。
- 本条不涉及浏览器窄屏或移动端表现；既有移动窄屏表现不因计数口径变化而改动。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 三个归因码与 `undecidable` 须在术语标准登记（Plan S0 前置项）。
- `annotate` 模式若落地，需补孤儿标注的浮层文案登记。

---

## 7. 非目标

- **不在本条重建语义层对象**：不新增／删除／改名任何语义层 YAML、Manifest、overlay、连接块（D7）。
- **不改 RTV25 合同口径**：RTV25-06 的断言结构与对账口径不变（D8）。
- **不修复 `lucy-ops` 资产自愈／升级**：既有 `docs/specs/lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md` 的合同不在本条改动范围。
- **不把四个计数合并成一个**：「表数 == 路径数」不是本条要达成的目标（F5）。
- **不改 ACL 裁决口径、不改行策略编译语义**：本条只治「呈现与计数的一致性」，不治授权本身。
- **不做跨模块故障演练、不做客户环境验收**：不在本条出口。
- **不把「孤儿数归零」表述成语义层已健康**：归零可能来自 `exclude` 模式把孤儿移出计数；健康度须另由归因分布判断。

## 8. 已知残余

| 编号 | 残余 | 说明 | 归属 |
|---|---|---|---|
| RES-01 | `exclude` 模式下孤儿被移出路径数，治理面**看不到**这些表 | 这是本条的口径选择（D5）之一；两处口径一致即可，但「看不见」与「已修好」须在界面上分开表述 | 后续条目，待 `annotate` 模式的可用性验证 |
| RES-02 | 三面表键格式本就不同（F3），本条只做对账，不改各面自身的键 | 改键格式会波及 `authorization-summary` 与关系图前端，超出本条 | 后续条目 |
| RES-03 | 归因依赖的运行期事实（Manifest、`enabled_tables`、source map）都不在仓内 | 见 U1–U3；本条不开工则无法取证 | Plan 开工前置项 |
| RES-04 | 归因明度依赖 `source_map` 的身份别名信息 | 若源 map 不保留别名，命名漂移只能靠 Manifest 与 `enabled_tables` 交叉推断，归因精度下降 | 后续条目，随 source map 合同一并评估 |

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 误删仍在用的语义层对象 | 归因若把「在用对象」误判为「已删对象」，随后据以清理会打断真实查询 | 本条**不清理**（D7）＋ SC-07 摘要比对 ＋ 归因只产出诊断不产出动作 |
| 快照口径漂移 | 两侧各读各的快照，混代数字被呈现为一致 | D4 出数前提 ＋ SC-03 不一致即不可用 |
| 归因错误导致大面积不可见 | 若 `exclude` 模式下误把大量表判为孤儿，关系图会骤然变空，读成「授权都没了」 | SC-01 归因唯一性 ＋ SC-05 计数不混用 ＋ `exclude` 模式必须同时给出 `orphanReport`（剔除量与归因分布） |
| 口径两处不一致 | 反查与关系图各选一套孤儿处置模式，孤儿从「可见不一致」变成「不可见不一致」 | D5 单一全局常量 ＋ SC-04 两处同构断言 |
| 归因不明被静默吞掉 | 不入队又不呈现，会被读成「没有孤儿」 | D9 失败关闭 ＋ SC-02 单列 `undecidable` 且计数 > 0 |
| 计数混用被当成修复 | 把「去重表数」改成「授权路径数」会让两处数字对上，但违反既有明文合同 | D6 ＋ SC-05 ＋ F5 合同原文引用 |
| 依赖运行期证据而仓内无样本 | 无实跑产物时，实现会退化为「照候选机制猜」 | U1–U4 明写为未核实；Plan 开工前置要求先取得实跑证据 |

## 10. 出处

- 需求池：[`REQ-030-015`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 实施 Plan：[`lucy-20261107-semantic-orphan-path-governance-plan.md`](../plans/lucy-20261107-semantic-orphan-path-governance-plan.md)
- 关系图合同：[`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)
- 反查合同：[`docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md`](lucy-20261025-v0p25-row-policy-templates-and-view-spec.md)
- 现行实现：[`webui/server/admin/access-map.ts`](../../webui/server/admin/access-map.ts)、[`webui/server/admin/counting.ts`](../../webui/server/admin/counting.ts)、[`webui/server/admin/row-policy-views.ts`](../../webui/server/admin/row-policy-views.ts)、[`webui/server/admin/authorization-summary.ts`](../../webui/server/admin/authorization-summary.ts)、[`webui/server/admin/snapshot-identity.ts`](../../webui/server/admin/snapshot-identity.ts)
- 运维问数连接：[`webui/server/ops-evidence/contract.ts`](../../webui/server/ops-evidence/contract.ts)、[`webui/server/ops-evidence/connection-block.ts`](../../webui/server/ops-evidence/connection-block.ts)、[`webui/server/ops-evidence/ensure.ts`](../../webui/server/ops-evidence/ensure.ts)、[`webui/config/ops-evidence/semantic-layer/lucy-ops/`](../../webui/config/ops-evidence/semantic-layer/lucy-ops/)
- 用例侧断言：[`webui/tests/real-e2e/row-policy-templates-v025.spec.ts`](../../webui/tests/real-e2e/row-policy-templates-v025.spec.ts)、[`webui/tests/real-e2e/helpers/table-identity.ts`](../../webui/tests/real-e2e/helpers/table-identity.ts)
- 既有资产自愈合同：[`docs/specs/lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md`](lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md)
