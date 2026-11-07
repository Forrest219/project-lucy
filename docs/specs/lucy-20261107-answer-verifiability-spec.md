# 答复可核对性 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无 |
| 功能编号 / 优先级 | 清单 **P0-4**；需求池 **REQ-030-022** / **P0** |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。须清单池 §2.2 R1–R4 后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码** |
| 需求来源 | [需求池 REQ-030-022](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 配套 Plan | [lucy-20261107-answer-verifiability-plan.md](../plans/lucy-20261107-answer-verifiability-plan.md) |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（第 1 轮：形式合规 ＋ 事实性核验，13 块分块；**评审通过并另获开发授权后方可改代码**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 实施主体 | Proxy 结果呈现合同 +（可选）只读核对入口。复用既有 provenance／审计故事线 |\n| 与既有 Spec 的关系 | Spec 162 `_meta.lucy`；审计调用链故事线；不改 ACL |

## 闭口层级

- 层级：功能合同
- 本条承诺：成功查数答复对终端／模型**强制可见**来源表、所用口径要点、数据截止期（或诚实披露「未校验」）；不得只埋在客户端默认不展示的 `_meta`。
- 本条出口：SC-01–SC-12。
- 不在本条出口：自动纠错、改数值、改 ACL、完整审计台重做、上线。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Answer Verifiability Block：中文主称「可核对块」。答复中强制露出的来源／口径／截止期结构。
- Data Cutoff Disclosure：中文主称「数据截止期披露」。含已校验截止期或明确「未校验／不可用」。

Forbidden:

- 把可核对写成自动正确；把披露写成安全边界。

落位：§4.8。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- `docs/specs/lucy-20261104-audit-call-storyline-spec.md`

### What This Change Follows

- [ ] 复用 `_meta.lucy.provenance` 字段，增加**模型／用户可见**落点（参照 018：勿盲目追加 content 块打断 eval JSON 解析）。
- [ ] 无新营销仪表盘。

### Exceptions (If Any)

- 核对入口若做 WebUI，须补 IA；可为 MCP 可见块先行。

### Follow-up Needed

- 真实 freshness 探测若依赖上游，另立取证。

## 1. 背景与取证

| # | 事实 | 证据 |
|---|---|---|
| E1 | provenance 在 `_meta.lucy`，客户端常不展示 | `mcp-proxy.ts:2701-2718` |
| E2 | instructions 鼓励先答再补口径 | `webui/config/data-qa-instructions.md:34`（先直接答结果、再补口径与 provenance）、`:43`（provenance 要简短但可追溯） |
| E3 | freshness.status 恒 not_checked | `mcp-proxy.ts:2710-2714` |

## 2. 目标

1. 成功 `lucy_query` 答复含可核对块（source、measures／filters 摘要、截止期披露）。
2. 模型一定看得见（落点策略见 D2，避开 eval 多块 JSON 陷阱）。
3. 可选：问询 ID → 只读核对（复用审计物理表／故事线）。

## 3. 非目标

- 不自动改表重查；不改 ACL；可核对 ≠ 自动正确。

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| D1 | **语义复用既有 provenance，字段与去值另定**：`_meta.lucy.provenance` 的来源／口径语义（`connectionId`／`sourceName`／`measures`／`filters`／`freshness`）直接复用，**不重造一套同义结构**；但**字段形状另定**——既有 `provenance.filters` 走 `boundedProvenanceValue` **原值透传**（`webui/server/proxy/mcp-proxy.ts:2706`），**不含去值**。本条的 `filtersSummary` 是**新逻辑**，去值能力在 `webui/server/proxy/audit-privacy.ts:171` 的 `summarizeFilters`（filter 级），但该函数**当前未导出**；已导出的 `summarizeArgsForAudit`（`:187`）是 **args 级**、口径不同，不能直接顶替 | 冻结（语义复用 ＋ 形状另定） |
| D2 | **可见落点＝三处同生同灭**：`content[0].text` 的 JSON 对象内同名键（模型可见，主落点）＋ `structuredContent` 同步键 ＋ `_meta.lucy` 合同位（审计可读）；**不追加 content 块**——追加块打断 `scripts/eval/eval-runner.mjs:293-300` 的多块拼接后 `JSON.parse`（失败即退化为 `{raw}`）。不变式：**凡出现该可核对块，三处必同时出现；任一路径失败则三处都不出现**（不出现半套）。落点口径与 018 的 D3 同源（`docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md:135`、`:249`） | 冻结 |
| D3 | freshness 未实现前必须诚实披露「未校验」，不得伪造截止期 | 冻结 |
| O1 | WebUI 核对页是否进本条出口 | 默认本条不做完整页，仅 MCP 可见块；O1 可升级 |
| O2 | 截止期真实探测范围 | **开工前必答**（本轮评审未给出结论，不得按「评审闭合」当作已定）——须裁定：① 探测哪些 source 的 freshness；② 探测失败时如何披露；③ 探测本身是否走 `lucy_freshness` 工具。裁定前不得实现 freshness 接入 |

> **开放决策守卫（本条统一，2026-11-07）**：本条所有 **O 项（开工前必答）在闭合前不得实现对应分支**——缺省一律 fail-closed（该分支不实现、依赖它的 SC 保持未关闭、不得以「评审已通过」当作已闭合）。闭合须由**委托人（PM）**在**开发授权前**书面裁定，并回写本表 O 行的状态格；**评审通过 ≠ O 项闭合**；未闭合即开工的，视为越权实现。


## 5. 核心流程（伪代码）

```text
# 分支 → 验收项映射（每条分支必须落到至少一条 SC）
#  B1 成功且有权限            → SC-01/02/03/04/05/06/07
#  B2 权限不足（degradedGlobal／无 source 可见）→ SC-07
#  B3 上游 isError            → 不产出可核对块
#  B4 非 lucy_query 工具      → 不产出可核对块

on lucy_query response:
  if tool != "lucy_query":
      return without_block()                      # B4：只有 lucy_query 产可核对块

  if upstream isError:                            # B3：上游失败时不得产出可核对块
      return without_block()

  prov := existing _meta.lucy.provenance
  if prov is null or prov.sourceName is null or not hasSourceVisibility(identity, prov.source):
      # B2：权限不足 / source 不可见 → 不得把对象信息写进模型可见载荷
      return without_block()                      # SC-07

  cutoff := freshness if checked else { status: "not_checked", note: "数据截止期未校验" }   # D3：不得伪造 checked
  filtersSummary := summarizeFiltersForVerifiability(args.filters)   # 去值；来源见 D1（audit-privacy.ts:171，当前未导出，需导出）
  block := { source, measures, filtersSummary, cutoff }
  attach block to model-visible payload:
      content[0].text 的 JSON 对象内加同名键（主落点，模型可见）
      + structuredContent 同步键
      + _meta.lucy 合同位
      # D2：三处同生同灭；任一路径失败则三处都不出现，不落半套
  keep _meta.lucy.provenance for ops
```

## 6. 验收

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 成功查询响应含可核对块 | 本机自动化（真实 MCP `tools/call` 回读 payload） |
| SC-02 | 含 source 限定名 | 单元（块字段断言） |
| SC-03 | 含口径要点（measures／filters 摘要，去值） | 单元（去值断言：夹具业务值不在块内） |
| SC-04 | 截止期或 not_checked 诚实披露 | 单元 |
| SC-05 | 不得伪造 checked 截止期 | 单元（freshness 未探测时断言 `status == "not_checked"`） |
| SC-06a | **不破坏 eval-runner JSON.parse 单块假设** | 跑批回归（`eval-runner.mjs:293-300` 多块拼接后仍能 parse） |
| SC-06b | **三处落点一致**：`content[0].text` 内键／`structuredContent`／`_meta.lucy` 同时出现且内容一致 | 单元（逐键比对） |
| SC-07 | 可见块不含越权对象 | 单元（不可见 source / degradedGlobal 场景 → 无块；SC-07 由分支 B2 覆盖） |
| SC-08 | instructions 不得要求隐藏可核对块 | 文案断言（`webui/config/data-qa-instructions.md`） |
| SC-09 | 核对入口（若做）**只读**：不写审计库、不改配置 | 本条**不做** ⇒ 记 **N/A**（O1 默认不进本条出口） |
| SC-10 | 核对入口（若做）不暴露审计原始内容 | 本条**不做** ⇒ 记 **N/A** |
| SC-11 | 核对入口（若做）不引入新的写路径 | 本条**不做** ⇒ 记 **N/A** |
| SC-12 | `lint:spec-docs` exit 0 | 门禁 |

**出口判定**：SC-01–SC-08 与 SC-12 必须**全部关闭**；SC-09–SC-11 本条不做，记 **N/A** 即可（但 O1 若升级为「做」，则三条改为必做并各自补断言）。

未执行。本条收口不表示可上线。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 打断 eval | D2／SC-06 |
| 伪造 freshness | D3／SC-05 |

## 8. 关联

- P0-4；串联 018 落点教训；审计故事线
