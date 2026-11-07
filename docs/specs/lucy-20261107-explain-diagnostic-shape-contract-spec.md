# Lucy `lucy_explain_query` 本地诊断形状合同 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；本条待 PM 指派台账号后再登记 |
| 需求池条目 | REQ-030-017（explain 诊断形状补全），来源 [0.30 需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07 开 Spec 与 Plan）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。本条只登记设计与验收口径，不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。实施须先取得本条的开工授权 |
| 配套 Plan | [lucy-20261107-explain-diagnostic-shape-contract-plan.md](../plans/lucy-20261107-explain-diagnostic-shape-contract-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 上位合同 | [`docs/access-control/adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md) **§2.1.1（lines 78–82，E1–E5 唯一权威）**、[`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md) |

---

## 闭口层级

- 层级：功能合同
- 本条承诺：`lucy_explain_query` 的本地诊断响应按权威 ADR 的 E1–E5 编号唯一解释，且实现产出 ADR E3 要求的「capability 裁决 ＋ FinalRows 判定 ＋ ForcedPredicateAST 摘要」三件齐备；实现、单元测试与 e2e harness 对同一响应断言同一组语义。
- 本条出口：能打假这条承诺的检查——本机单元（诊断体形状断言）＋ e2e harness BY-18 复跑（E1–E5 逐条按 ADR 编号断言）。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级（客户环境）、镜像构建与客户交付。
- 上线关系：本条收口不表示可上线

---

## 1. 背景与取证

### 1.1 现象

2026-11-05 row-policy 强度 B 实跑（`inbox/e2e/final-rds-20261105`，case `SEC-11-BY18`）记录：`lucy_explain_query` 的 forced 谓词本地诊断 E1..E4 可用，但 E5 `summary=undefined`。**实跑口径更正**：BY-18 的响应 envelope **已被识别**（走 `mcp_result_ok` 分支），E1–E4 四条断言 `passed=true`，失败点只是 E5 的 `summary` 断言；「envelope 不被识别」（`source=mcp_iserror_other`）是 **BY-19** 的失败形态（见 `evidence/phase-on/security.json:1017`），与本条无关。需求池据此登记 REQ-030-017「诊断形状合同不完整」。

### 1.2 权威口径

`docs/access-control/adr-upstream-forced-predicate.md` §2.1.1（lines 78–82）是 `lucy_explain_query` 严格本地安全响应的**唯一权威**，E1–E5 原文如下：

| # | ADR 要求 |
|---|---|
| E1 | **零上游转发**：不得对 `sl_query`／`sl_read_source` 或其它上游工具发起 `tools/call` |
| E2 | **零行数据**：响应不得包含 result rows／sample rows／聚合数值结果 |
| E3 | 响应必须包含：**capability 裁决**、`FinalRows` 是否非 TRUE、**ForcedPredicateAST 摘要**（或等价 digest） |
| E4 | 若 `upstream_forced_predicate_proven ≠ true`：响应必须标明**执行**路径将为 `row_policy_upstream_unproven`（explain 本地诊断仍可成功返回 E1–E3，但不得暗示「执行可取数」） |
| E5 | 客户端可读语义 =「权限/强制谓词诊断」，**≠**「数据已返回」 |

### 1.3 三处口径对照

| 语义 | ADR（权威） | 实现 | e2e harness（BY-18） |
|---|---|---|---|
| 零上游转发 | E1 | `upstreamForwarded`（注释标 E1） | **E2** |
| 零行数据 | E2 | `containsResultRows`（注释标 E2） | **E3** |
| capability 裁决 | E3 之一 | **无独立落点** | **未断言** |
| FinalRows 是否非 TRUE | E3 之二 | `finalRowsNonTrue`（注释标 E3） | **未断言** |
| ForcedPredicateAST 摘要 | E3 之三 | `forcedPredicateAst`（注释标 E3） | **E4** |
| 执行路径标注 | E4 | `executionPath`（注释标 E4） | **未断言** |
| 客户端可读语义 | E5 | `semantics`（注释标 E5） | **E1** |
| `summary` 字段 | **ADR 未定义** | **不产出** | **E5（要求非空字符串）** |

对应位置：实现接口 `webui/server/proxy/row-policy.ts:461-484`、返回体 `webui/server/proxy/row-policy.ts:559-576`；harness 断言 `scripts/e2e/security/row-policy-cases.mjs:871-880`；单元断言 `webui/server/__tests__/row-policy-ac-p1.test.ts:757-761`；另一处单测的注释本身混编编号（`webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts:365-372`，注释写「E5 / E1 / E2」但断言 `semantics`／`upstreamForwarded`／`containsResultRows`）。

### 1.4 根因

**REQ-030-017 描述的「E5 summary=undefined」是表象，不是根因。** 真根因有两条：

- **R1（编号分叉）**：ADR、实现注释、e2e harness 三处对 E1–E5 的编号互不一致。harness 把 `semantics` 当 E1（ADR 是 E5），把 `upstreamForwarded` 当 E2（ADR 是 E1），把 `containsResultRows` 当 E3（ADR 是 E2），把 `forcedPredicateAst` 当 E4（ADR 是 E3 之一）。**在 `semantics` 这个唯一共同锚点上，两套编号直接矛盾。**
- **R2（断言了一个不存在的字段）**：harness 的 E5 要求 `summary` 为非空字符串，但 ADR 未定义该字段，实现也不产出。**该断言在任何实现下都不可能通过**——除非有人为了让断言变绿而单方面新增字段，那是反向把 harness 写成合同。

**另有第三处形状缺口**：ADR E3 要求含「capability 裁决」，而实现返回体没有任何承载它的字段。不受保护的 source 上 `forcedPredicateAst` 为 `null`（`row-policy.ts:540-556`），响应里便完全不呈现任何裁决信息——诊断体在最需要解释「为什么没被拦」的场景下信息最少。

**因此本条不是「补一个 `summary` 字段」。** 补字段会把三处口径继续分叉，并绕过 ADR 的编号权威。

---

## 2. 设计决策

| 编号 | 决策 | 理由与边界 |
|---|---|---|
| D1 | **ADR §2.1.1（lines 78–82）的 E1–E5 表是唯一权威**；实现注释、单元测试、e2e harness 三处一律按它编号 | 编号冲突时以权威合同为准；不新造第三套编号 |
| D2 | 本条**不改 ADR 合同字面量**，只让实现与 harness 对齐既有合同 | ADR 属治理文件，改动须走 Plan Mode ＋ PM 授权；本条无此必要 |
| D3 | **不新增 `summary` 字段**。ADR E3 的「ForcedPredicateAST 摘要（或等价 digest）」由既有 `forcedPredicateAst` 承担；harness 的 `summary` 断言删除 | harness 单方面发明的字段不是合同。若产品确需人读摘要，另走 ADR 登记流程 |
| D4 | 实现侧补齐 ADR E3 的「capability 裁决」：新增 `capabilityVerdict` 字段，覆盖**全部被请求 source**（含不受保护者） | 修复「不受保护 source 诊断体无任何裁决信息」的缺口 |
| D5 | `capabilityVerdict` 只含裁决元数据（是否命中 capability、FinalRows 形态、行授予形态、digest），**不含任何行数据、样例行或聚合数值** | 守住 ADR E2（零行数据） |
| D6 | 本地诊断保持 local-only：零上游转发、零数据返回路径不因补字段而引入 | ADR E1／E2 是硬约束 |
| D7 | 单元测试与 harness 的 E 编号必须逐条对齐；注释也改，不留「注释写一套、断言跑另一套」 | 注释与断言不一致本身就是本条的缺陷面之一 |

---

## 3. 核心流程（伪代码）

### 3.1 诊断体构造（实现侧）

```text
# 位置：webui/server/proxy/row-policy.ts buildExplainForcedPredicateDiagnostics
# 目标：产出满足 ADR E1–E5 的诊断体，字段与编号一一对应

# ⚠️ 口径：以下 return 是 row-policy.ts 的**分量**；线上响应体＝本分量＋mcp-proxy.ts:1612-1644 叠加的
#   allowed／executionMode／executed／upstreamTool／requestedSources／resultRows／sampleRows／
#   aggregateResults／guardrails／policy／provenance。SC-04 的白名单扫描针对**叠加后**的完整响应体。
function buildExplainForcedPredicateDiagnostics(input):
    proven = isUpstreamForcedPredicateProven()

    # 3.1.1 capability 裁决（D4）：覆盖全部被请求 source
    verdicts = []
    for each requested in input.requestedSources:
        matches = input.capabilities.filter(cap =>
            cap.tool in {lucy_query, lucy_explain_query}
            and normalizeRef(cap.sourceName) == normalizeRef(requested.sourceName)
            and (not requested.connectionId or normalizeRef(cap.connectionId) == normalizeRef(requested.connectionId)))
        if matches is empty:
            verdicts.push({
                connectionId: requested.connectionId ?? "",
                sourceName:   normalizeRef(requested.sourceName),
                capabilityResolved: false,      # 未命中 capability
                finalRows: "UNKNOWN",            # 未命中即不谎报 TRUE
                rowGrantKind: "none"
            })
            continue
        match = matches[0]
        key = normalizeRef(match.connectionId) + "\0" + normalizeRef(match.sourceName)
        finalRows = input.finalRowsBySource[key] ?? match.rowGrant
        verdicts.push({
            connectionId: match.connectionId,
            sourceName:   match.sourceName,
            capabilityResolved: true,
            finalRows:    finalRows.kind == "all" ? "TRUE" : "NON_TRUE",
            rowGrantKind: finalRows.kind,       # "all" | "scoped"
            digest:       finalRows.kind == "scoped" ? finalRows.digest : undefined
        })

    finalRowsNonTrue = any(v.finalRows == "NON_TRUE" for v in verdicts)

    # 3.1.2 ForcedPredicateAST 摘要（既有逻辑不变）
    forcedPredicateAst = null
    if finalRowsNonTrue:
        or = []
        for each item in protectedSources:
            payload = buildForcedFiltersPayload(item.grant, item.sourceName)
            if payload: or.push(...payload.or)
        forcedPredicateAst = {
            digests:       protectedSources.map(i => i.digest),
            forcedFilters: {or},
            sources:       protectedSources.map(i => ({connectionId, sourceName, digest}))
        }

    wouldDeny = finalRowsNonTrue and not proven

    # 3.1.3 返回体：字段与 ADR 编号一一对应
    return {
        semantics: "permission_forced_predicate_diagnostic",  # ADR E5
        upstreamForwarded: false,                               # ADR E1
        containsResultRows: false,                             # ADR E2
        capabilityVerdict: verdicts,                           # ADR E3-①【新增】
        finalRowsNonTrue,                                       # ADR E3-②
        forcedPredicateAst,                                     # ADR E3-③
        executionPath: {                                        # ADR E4
            tool: "lucy_query",
            upstreamForcedPredicateProven: proven,
            wouldDeny,
            denyReason: wouldDeny ? "row_policy_upstream_unproven" : undefined,
            note: ...
        }
    }
```

### 3.2 断言口径（harness 侧）

```text
# 位置：scripts/e2e/security/row-policy-cases.mjs，case BY-18
# 规则：按 ADR §2.1 的 E 编号逐条断言；不发明字段

case BY_18:
    ...
    if denyMatched:
        checks.expect("deny", true, ...)            # 上游未证明时 explain 被拦，属既有允许分支
    else if envelope == "mcp_result_ok":
        diag = parseMcpToolResult(res).parsed

        # E1 零上游转发
        checks.expect("allow_control", diag.upstreamForwarded === false, ...)
        # E2 零行数据
        checks.expect("allow_control", diag.containsResultRows === false, ...)
        # E3 三件齐备：capability 裁决 + FinalRows 判定 + ForcedPredicateAST 摘要
        checks.expect("allow_control", Array.isArray(diag.capabilityVerdict) && diag.capabilityVerdict.length > 0, ...)
        checks.expect("allow_control", typeof diag.finalRowsNonTrue === "boolean", ...)
        checks.expect("allow_control", diag.forcedPredicateAst !== null
                      && Array.isArray(diag.forcedPredicateAst.digests)
                      && diag.forcedPredicateAst.digests.length > 0, ...)
        # E4 执行路径标注
        checks.expect("allow_control", diag.executionPath?.tool === "lucy_query"
                      && typeof diag.executionPath?.upstreamForcedPredicateProven === "boolean", ...)
        # E4 的可交付性限定：proven≠true 时必须标明执行路径将被 row_policy_upstream_unproven 拒绝
        checks.expect("allow_control",
                      diag.executionPath?.upstreamForcedPredicateProven === true
                      || diag.executionPath?.denyReason === "row_policy_upstream_unproven", ...)
        # E5 客户端可读语义
        checks.expect("allow_control", diag.semantics === "permission_forced_predicate_diagnostic", ...)
        # 删除原「E5: summary」断言（D3）：ADR 未定义该字段，实现不产出
    ...
    expectUpstreamZero(ctx, checks, "BY-18", win, {authorizedRequests: 0})   # E1 的执行侧取证
```

### 3.3 编号对照（改写后必须逐条成立）

| ADR | 响应字段 | harness 断言标记 | 实现注释 |
|---|---|---|---|
| E1 | `upstreamForwarded` | E1 | E1 |
| E2 | `containsResultRows` | E2 | E2 |
| E3 | `capabilityVerdict` ＋ `finalRowsNonTrue` ＋ `forcedPredicateAst` | E3（三件齐备） | E3（三处） |
| E4 | `executionPath` | E4 | E4 |
| E5 | `semantics` | E5 | E5 |

---

## 4. 验收

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 诊断响应体满足 ADR E1–E5 全部要求，逐条可断言（E1 零上游转发、E2 零行数据、E3 三件齐备、E4 执行路径标注、E5 客户端可读语义） | 单元（诊断体形状断言）＋ harness BY-18 |
| SC-02 | `capabilityVerdict` 覆盖全部被请求 source，每条含 `capabilityResolved`、`finalRows`（TRUE／NON_TRUE／UNKNOWN）、`rowGrantKind` | 单元（受保护／不受保护／未命中 capability 三种输入） |
| SC-03 | 不受保护的 source 下 `forcedPredicateAst` 为 `null`，但 `capabilityVerdict` 仍呈现裁决——诊断体不出现「无任何裁决信息」的响应 | 单元 |
| SC-04 | 响应不含 result rows／sample rows／聚合数值结果 | 单元（叠加后完整响应体的字段白名单扫描，见 F6 注）＋ harness 的 E2 断言 `containsResultRows === false`。**不用 harness `noLeak`**——它只扫 secrets／canaries，不检查数据行 |
| SC-05 | 上游未证明时 `executionPath.denyReason` = `row_policy_upstream_unproven`，且不暗示「执行可取数」 | 单元（`proven=false` 注入）＋ harness |
| SC-06 | harness BY-18 的 E1–E5 断言按 ADR 编号重排并逐条通过；**不再断言 ADR 未定义的 `summary` 字段** | harness 复跑 |
| SC-07 | 单元测试与 harness 对同一响应断言同一组语义，两侧 E 编号一致；现有混编注释一并改正 | 代码复核 ＋ 两侧断言比对 |
| SC-08 | `lucy_explain_query` 保持 local-only：零上游转发、零数据返回路径不因补字段而引入 | harness `expectUpstreamZero` ＋ 单元 |

**出口**：SC-01–SC-08 全部关闭。**本条收口不表示可上线。**

---

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `capabilityVerdict`（机器键，非用户可见术语）：`lucy_explain_query` 本地诊断体中承载 ADR E3「capability 裁决」的字段数组。**不新增用户可见译名**，不进入 WebUI 文案层。
- `finalRows` 取值 `TRUE`／`NON_TRUE`／`UNKNOWN`：机器枚举值，沿用既有 FinalRows 语义（`TRUE`＝行授予无限制；`NON_TRUE`＝受强制谓词约束；`UNKNOWN`＝未命中 capability，无法判定）。
- `rowGrantKind`（机器键，非用户可见术语）：`capabilityVerdict` 每条上的行授予形态标注，取值 `none`／`all`／`scoped`——`none`＝未命中 capability，无法判定；`all`＝行授予无限制（与 `finalRows=TRUE` 同义）；`scoped`＝受强制谓词约束（与 `finalRows=NON_TRUE` 同义）。**不新增用户可见译名**，不进入 WebUI 文案层。

本条不新增产品概念，不新增 WebUI 文案，不新增 reason code。

## 6. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/README.md`（Governance：状态与错误码呈现规则）
- `webui/docs/00-product-terminology-standard.md`（机器键与用户可见文案的分层）

### What This Change Follows

- 本条只改机器可读的本地诊断响应体形状，不涉及任何 WebUI 视觉、布局、交互或文案。
- 诊断体不被浏览器页面直接消费，故无设计系统例外需要登记。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 无。若后续把诊断体呈现到 Admin 界面，须另立 Spec 并补齐设计系统对照。

## 7. 非目标

- 不改 ADR §2.1.1（lines 78–82）的 E1–E5 合同字面量；不新造第三套编号（D1、D2）。
- 不新增 `summary` 字段（D3）。
- 不改 `lucy_explain_query` 的本地诊断定位；不引入任何数据返回路径（D6）。
- 不改上游强制谓词未证明时的 `row_policy_upstream_unproven` 口径。
- 不做浏览器端呈现改动。

## 8. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 误以为「补 `summary` 字段」即可解决 | 这是需求池记录的表象解法 | 本 Spec §1.4 给出三处口径对照表；评审以 ADR 为准 |
| 编号改写时漏改一處 | 实现注释、单测注释、harness 三处都带编号 | SC-07 要求编号逐条一致，注释一并改 |
| 新字段泄露数据 | `capabilityVerdict` 若带行级内容即破 E2 | SC-04 字段白名单扫描；字段定义只含裁决元数据 |
| 上游未证明时 explain 被拦的分支被漏测 | BY-18 存在 deny 分支与 allow 分支两支 | SC-05 单独覆盖 `proven=false`；deny 分支不要求 E 字段 |
| 与 REQ-030-016 批次争同一文件 | 本条改 `row-policy.ts`，并同改 harness 与同一份单测——与 REQ-030-016 批次 Spec（`lucy-20261107-row-policy-compile-gate-deny-code-spec.md`）**四个文件全部重叠**：`webui/server/proxy/row-policy.ts`＋`scripts/e2e/security/row-policy-cases.mjs`＋`webui/server/__tests__/row-policy-ac-p1.test.ts`＋`webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts` | 两批次按文件分工串行；同文件同刻只允许一个写入方 |

## 9. 出处

- 需求池：[`REQ-030-017`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)
- 权威合同：[`docs/access-control/adr-upstream-forced-predicate.md`](../../docs/access-control/adr-upstream-forced-predicate.md) §2.1
- 实现：[`webui/server/proxy/row-policy.ts`](../../webui/server/proxy/row-policy.ts)
- harness：[`scripts/e2e/security/row-policy-cases.mjs`](../../scripts/e2e/security/row-policy-cases.mjs)
