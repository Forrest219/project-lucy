# 答复可核对性 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.4** |
| 日期 / 目标版本 | 2026-11-07（v0.4 修订 2026-11-09；收口镜像 2026-11-13）/ 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无 |
| 功能编号 / 优先级 | 清单 **P0-4**；需求池 **REQ-030-022** / **P0** |
| 状态 | **v0.4；R2-F＋R3＋R4 已闭合（2026-11-09）**。实现已落地；独立复审 **Approve with nits**（C1／C2／M5 已闭）；SC-16／17／21／22 夹具证据已补全（2026-11-13）；**功能合同已收口**。O1＝A／O2＝A。本条收口不表示可上线 |
| 授权边界 | **已获开发授权（R4，2026-11-09）**：可按配套 Plan 改运行代码与测试；不表示可上线 |
| 需求来源 | [需求池 REQ-030-022](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[误报防线](../plans/lucy-20261107-misreport-defense-and-stored-user-experience-plan.md)；[功能清单池](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 配套 Plan | [lucy-20261107-answer-verifiability-plan.md](../plans/lucy-20261107-answer-verifiability-plan.md)（**v0.4-draft**） |
| 评审记录 | [第 1 轮评审记录](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)；[Codex 对抗评审](../reviews/2026-11-09-answer-verifiability-codex-review.md)（**R2-F＋R3＋R4 已闭合 2026-11-09**） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 实施主体 | Proxy 结果呈现合同 +（可选）只读核对入口。复用既有 provenance／审计故事线 |
| 与既有 Spec 的关系 | Spec 162 `_meta.lucy`；审计调用链故事线；018 落点教训（本条更强：成功路径禁静默无块）；**不改 ACL**；物理新鲜度真源见 [P0-B Spec](lucy-20261109-physical-freshness-contract-spec.md)（v0.1-draft，终稿未确权，未授权）。本条 O2＝A 不变，cutoff 仍不得改成已校验 |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.4 | **2026-11-13**：SC-16／17／21／22 夹具证据补全；**功能合同已收口**；本条收口不表示可上线 |
| v0.1-draft | 首立：可核对块目标、三落点、SC 骨架 |
| v0.2-draft | 批次 R1 事实性修订：D1 语义复用＋形状另定、D2 同生同灭、O 项守卫 |
| v0.3-draft | **Codex R1 triage**：闭合 AV-01…AV-10（成功不变量、生产点枚举含 Hive、公开 schema、模型可读 vs 用户可见、完整来源身份、口径摘要、诚实 not_checked＋P0-B 缺口、JSON 保真、决策→SC→Plan 矩阵、格式／锚点）；**不代裁定 O1／O2**；过程修订 ≠ 终稿确权／开发授权 |
| v0.4-draft | **Codex R2 triage**：闭合 AV-08（全链路保真边界）、AV-03／AV-06（P0-1 请求不可变证据＋CaliberSummary 类型／归一）、AV-09（SSE／改写前／快照／error／保真映射夹具）；修正 §4.3／术语落位错引；**不代裁定 O1／O2**；**不宣称 R2-F／R4** |

## 闭口层级

- 层级：功能合同
- 本条承诺：分两层（见 §4.3／D5）——① **模型可读工具结果**：纳入范围的成功 `lucy_query` 响应，工具结果载荷内必须带合法可核对块（三载体同生同灭，见 D2／D4）；② **用户可见答复**：本条强制「模型侧不得被 instructions 要求隐藏」；**宿主最终 UI 强制渲染**不在本条默认出口（见 O1／§4.3），不得用「工具结果里有字段」冒充「终端用户一定看见」。
- 本条出口：SC-01–SC-23（含 SC-09–SC-11 在 O1＝不做时记 N/A）。
- 不在本条出口：自动纠错、改数值、改 ACL、完整审计台重做、物理新鲜度真源探测（P0-B）、上线。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Answer Verifiability Block：中文主称「可核对块」。协议字段名 `answer_verifiability`。答复中强制露出的来源／口径／截止期结构。
- Data Cutoff Disclosure：中文主称「数据截止期披露」。含已校验截止期或明确「未校验／不可用」。协议字段落在 `answer_verifiability.cutoff`。
- Model-Readable Tool Result：中文主称「模型可读工具结果」。MCP `tools/call` 返回的 `result`（含 `content`／`structuredContent`／`_meta`），供模型与自动化读。
- User-Visible Answer：中文主称「用户可见答复」。宿主（Claude Code／Cursor／WebUI 等）最终呈现给终端用户的文本／UI。

Forbidden:

- 把可核对写成自动正确；把披露写成安全边界。
- 把语义层文件 mtime、查询时刻、发布 `businessDate` 写成已校验业务截止期。
- 把「工具结果含块」写成「用户一定看见」。

落位：[`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) 对应分区（实现前补条目；**不是**本 Spec 自有章节号）。机器可读字段名保持 `translate="no"`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`
- `docs/specs/lucy-20261104-audit-call-storyline-spec.md`
- `docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md`（018；落点教训，**边界不完全相同**，见 §4.2）
- `docs/specs/lucy-20261107-question-type-caliber-binding-spec.md`（P0-1；已激活快照，口径关联）

### What This Change Follows

- [ ] 复用 `_meta.lucy.provenance` **语义**，公开可核对块字段形状**另定**（见 §5 schema）。
- [ ] 一次构造受控块，再投影到三载体；**保护** Spec 162 既有 `_meta.lucy` 合同字段（`contract`／`tool`／`upstreamTool`／`sources`／`guardrails`／`result`／`repair`／`applied_*`／`provenance` 等），本条只**新增** `answer_verifiability`（及装配失败时的显式错误／降级合同字段），不重算、不覆盖 Spec 162 字段。
- [ ] 无新营销仪表盘。

### Exceptions (If Any)

- 核对入口若做 WebUI，须补 IA；可为 MCP 可见块先行（O1）。

### Follow-up Needed

- 真实物理 freshness 探测见 [P0-B Spec](lucy-20261109-physical-freshness-contract-spec.md)（v0.1-draft，未授权）。本条首期仍只诚实 `not_checked`（D3／O2＝A）。

## 1. 背景与取证

| # | 事实 | 证据 |
|---|---|---|
| E1 | 既有 provenance 落在 `_meta.lucy.provenance`；客户端常不展示 `_meta` | `webui/server/proxy/mcp-proxy.ts` `withLucyResultMeta`（约 `:2752-2831`，以函数名为准） |
| E2 | 正常路径 instructions 由 `buildRoleAwareInstructions` 动态数组拼出；fallback 才是 `webui/config/data-qa-instructions.md` | `mcp-proxy.ts` `:1882-1967`；文件 `:34`／`:43` 仅覆盖 fallback |
| E3 | 现网 provenance.freshness 恒 `status:"not_checked"`；`lucy_freshness` 仅语义文件 mtime，`mode:"metadata_only"`，`physicalDataUpdatedAt:null` | `mcp-proxy.ts` provenance 块约 `:2819-2823`；`lucyFreshness` 约 `:1720-1730` |
| E4 | Hive 成功分流直接 `jsonRpcToolResult` 写响应并 `return`，**不经** `withLucyResultMeta` | `maybeWriteHiveDivertedResponse` 约 `:2129-2233`；调用点 `:6176-6190`（`lucy_query`／`lucy_read_source`）、`:4943-4957`（`lucy_explain_query`） |
| E5 | 认证路由／模板本地包装查询结果后直接返回，不经 KTX meta 装配 | `writeCertifiedRouteResponse` 约 `:3934+`；分叉 `:4927-4937` |
| E6 | KTX JSON／SSE 成功路径经 `withLucyResultMeta`；meta 装配抛错时 `lucy_query` 现行为回落原文（`metaFailed` → `body = originalBody`） | 约 `:2984-3011` |
| E7 | `SourceRef` 已含 `connectionId?`／`schema?`／`sourceName?`／`physicalTable`；现 provenance 却用 `sourceName` 回退 `sourceRefs[0]` | `acl.ts` `:667-674`；`mcp-proxy.ts` `:2810-2812` |
| E8 | 审计去值 `summarizeFilters` 对字符串过滤只留 `{kind,length}`，且未导出；行策略可能改写／前插 filters | `audit-privacy.ts` `:148-177`；行策略见 `row-policy.ts` 强制谓词相关 |
| E9 | 对文本内 JSON 做普通 `JSON.parse`→加键→`JSON.stringify` 会破坏 `> Number.MAX_SAFE_INTEGER` 整数（Codex R1 最小复现） | R1 原始产物 `inbox/2026-11-09-p0-4-codex-r1-last.txt` AV-08 |
| E10 | 018 对 `structuredContent` 是「**对象时**同步」；本条 v0.2 写无条件三处，边界不同 | 018 Spec §5.2／D3／D4；本条 §4.2 |
| E11 | 仅保 `content[0].text` 原始数值仍不够：外层 `JSON.parse`／SSE 归一后，`structuredContent.rows` 可将 `9007199254740993`→`…992`、超长小数截断；比较已舍入对象会假绿 | R2 原始产物 `inbox/2026-11-09-p0-4-codex-r2-last.txt` AV-08；`mcp-proxy.ts` JSON 路径约 `:2991`、SSE 解码约 `:1978` |
| E12 | P0-1 门禁返回 allow／deny；`BindingSession` 分 `generation` 与 `registryGeneration`；注册表另有内容 `digest`；响应阶段重读会话可把 A 数据贴上 B 引用 | `caliber-binding.ts` 门禁返回；`caliber-binding-session.ts`；P0-1 Spec D5／D11 |

## 2. 目标

1. 纳入范围的成功 `lucy_query` 答复**必须**含合法可核对块（完整来源身份、口径要点、截止期披露）。
2. 模型一定能在工具结果中读到该块（三载体投影，避开 eval 多块 JSON 陷阱）。
3. 禁止「成功返回数据却静默无块」；权限拒绝／解析失败／装配失败各有显式合同。
4. 可选（O1）：问询 ID → 只读核对入口。

## 3. 非目标

- 不自动改表重查；不改 ACL；可核对 ≠ 自动正确。
- 不在本条实现物理数据截止期探测（P0-B）。
- 不重造审计实体／不新增独立「事实」计算链路；响应字段与审计的对应关系见 §5.5。
- 不把 `lucy_certified_route`／`lucy_report_template`／`lucy_read_source`／`lucy_explain_query`／`lucy_freshness` 纳入本条强制可核对块出口（见 §4.1）。

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| D1 | **语义复用既有 provenance，公开块字段形状另定**：`_meta.lucy.provenance` 的来源／口径／freshness **语义**复用，**不**把现有 `filters` 原值透传形状直接当作用户可见块。公开块键名为 `answer_verifiability`（§5）。`filtersSummary` 等去值摘要**新逻辑**；可参考但不得直接把未导出的字符串级 `{kind,length}` 摘要当作可解释口径 | 冻结 |
| D2 | **可见落点＝一次构造、三处投影、同生同灭**：先构造唯一受控对象 `block`，再投影到：(1) `result.content[0].text` JSON 对象内顶层键 `answer_verifiability`；(2) `result.structuredContent.answer_verifiability`（仅当 `structuredContent` 为普通对象；见 D4）；(3) `result._meta.lucy.answer_verifiability`。**不追加 content 块**。不变式：**凡声明「块已下发」，三处合同位一致；成功查数路径禁止三处一致缺席**（AV-01，见 D6） | 冻结（相对 v0.2 收紧） |
| D3 | **首期截止期一律诚实 `not_checked`**：不得用语义 mtime、查询时间、发布 `businessDate`、或「调用过 `lucy_freshness` 成功」冒充业务截止期已校验。真实探测另立 P0-B | 冻结（首期合同） |
| D4 | **与 018 的异同（AV-10）**：复用「单块内加键、不追加块、eval 兼容」教训。差异：① 本条成功路径**禁止**「装配失败→静默无块仍 success」；② `structuredContent` 缺失／非对象时：仍必须在 text 与 `_meta.lucy` 落下同一 `block`，并设 `carriers.structuredContent="omitted_not_object"`；**不得**因此整单跳过块（相对 018「对象时才同步」更强）；③ 键冲突策略见 §5.3（与 018 的 `next_step` 不覆盖上游键不同：本条成功路径冲突→装配失败合同，不得静默跳过） | 冻结 |
| D5 | **模型可读 ≠ 用户可见（AV-04）**：本条强制出口是 MCP 工具结果三载体。instructions（**动态** `buildRoleAwareInstructions` ＋ **fallback** md）须要求模型在用户答复中**复述／引用**可核对要点，且**不得**要求隐藏。宿主 UI 强制渲染属 O1／后续；SC 分层见 §8 | 冻结 |
| D6 | **成功提交不变量（AV-01）**：对 §4.1 纳入范围的路径，若上游／本机判定为**成功查数**（HTTP 200、`result.isError !== true`、返回可解析数据载荷），则响应**必须**含合法 `answer_verifiability`。禁止静默成功无块。三类失败合同见 §6 | 冻结 |
| D7 | **来源身份取自权威解析集合（AV-05）**：`sources[]` 由本次查询权威解析的 `SourceRef[]`（及 catalog 补全的 schema／table）构造；**禁止**只取 `sourceRefs[0]` 或单一 `args.sourceName` 冒充全部。多源必须逐项列出；任一项 connection／logical source／physical table 不可解析→来源解析失败合同（§6 B-RESOLVE） | 冻结 |
| D8 | **口径摘要最小集合与捕获时点（AV-06）**：见 §5.2；用户条件取**改写前**快照；系统约束（行策略等）单独标记。若 P0-1 已激活口径绑定命中，摘要须引用**本请求随执行门禁取得并携带的不可变证据**（§5.2.1），禁止响应阶段重读会话／热读最新绑定／用 Catalog 描述替代执行口径 | 冻结 |
| D9 | **全链路数值保真（AV-08）**：保真边界覆盖 **外层响应解析 → SSE 归一（若适用）→ 块投影 → 最终序列化写回** 全阶段（§5.6）。`content[0].text` 内业务数据与 `structuredContent`（及最终 wire 等价位）**分别**验保真。普通 `JSON.parse`→改对象→`JSON.stringify`、或仅验 text 加键、或比较两个已 Number 舍入后的对象判通过，**均不足**。无法保真→B-ASSEMBLE，**不得**带着损坏数值标 success | 冻结 |
| D10 | **审计对应关系**：本条不新增审计表。`_meta.lucy.answer_verifiability` 可被后续审计导出引用，但**不等于**已写入 `access_log`。既有审计仍从 args_summary／outcome／provenance 故事线派生。实现时禁止为可核对块另起一套与 Spec 162 冲突的「平行事实」 | 冻结 |
| O1 | WebUI／宿主核对页或强制 UI 渲染是否进本条出口 | **已裁定＝A（2026-11-09）**：只做 MCP 块＋instructions；SC-09–11＝N/A |
| O2 | 截止期真实探测范围 | **已裁定＝A（2026-11-09）**：一律 `not_checked`；不得接 P0-B／freshness 探测 |

> **开放决策守卫**：所有 **O 项在闭合前不得实现对应分支**——缺省 fail-closed。闭合须由**委托人**在**开发授权前**书面裁定并回写本表。**评审通过 ≠ O 项闭合**；过程对抗 ≠ 终稿确权 ≠ 开发授权。

### 4.1 查询响应生产点：纳入／排除（AV-02）

> 不能只用工具名判断覆盖完成；须按**写响应的代码路径**枚举。

| 生产点 | 位置（锚点以符号／行为准） | 本条 |
|---|---|---|
| KTX `lucy_query` JSON 缓冲重写 | `withLucyResultMeta` + tools/call 下行约 `:2984-2991` | **纳入** |
| KTX `lucy_query` SSE→JSON 归一 | 同上（SSE decode 后同一装配） | **纳入** |
| Hive 分流成功 `lucy_query` | `maybeWriteHiveDivertedResponse` 约 `:2129-2233`；`:6176-6190` | **纳入**（须接入同一 `buildAnswerVerifiability`→投影；禁止旁路成功无块） |
| Hive／KTX `lucy_query` 上游／本机 `isError` | 各错误写回路径 | **排除产块**；走失败合同，不产块 |
| `lucy_read_source`（KTX／Hive） | 同分流与 meta 路径 | **排除**（发现面，非查数答复可核对出口） |
| `lucy_explain_query`（含 Hive divert） | 本地／分流 | **排除** |
| `lucy_freshness` | 本地工具 | **排除**（且其 mtime **不得**喂入本条 cutoff.checked） |
| `lucy_certified_route`／`lucy_report_template` | `writeCertifiedRouteResponse` 约 `:3934+`；`:4927-4937` | **排除**（登记覆盖缺口；若未来纳入须另升版） |
| Wiki／其他透传工具 | 各自路径 | **排除** |

### 4.2 与 018（空结果 next_step）边界

| 规则 | 018 | 本条（P0-4） |
|---|---|---|
| 触发 | 0 行等空结果 | **成功查数**（含 0 行成功若产品仍视为成功查询——若 0 行同时触发 018，两键可共存，见下） |
| 静默无指导／无块 | 允许记 `next_step_skipped_reason` 且不改 success | **禁止**成功无块；须改错误／装配失败合同 |
| `structuredContent` | 仅对象时同步 | 非对象时省略该载体但 **text＋meta 仍必须有块** |
| 上游已有同名键 | 不覆盖 `next_step` | 本条键 `answer_verifiability` 冲突→装配失败（§5.3） |
| 共存 | — | 允许同响应同时有 `next_step` 与 `answer_verifiability`；投影／保真夹具须覆盖双键（SC-18） |

### 4.3 模型可读 vs 用户可见（AV-04）

| 层 | 承诺 | 出口／验收 |
|---|---|---|
| A. 模型可读工具结果 | 纳入路径成功响应必带合法块（三载体合同） | SC-01／02／03／04／06／14／15／16／17／18 |
| B. Instructions 不隐藏 + 要求引用 | 动态数组与 fallback md **同步**条款：须在用户答复中露出可核对要点；不得指示隐藏 | SC-08（**两端**文案断言） |
| C. 用户可见强制 UI | 宿主／WebUI 强制渲染 | **默认不在本条**；升级见 O1 → SC-09–SC-11 |

### 4.4 P0-B 缺口登记（AV-07）

| 项 | 状态 |
|---|---|
| 物理数据截止期真源 | [P0-B Spec](lucy-20261109-physical-freshness-contract-spec.md) **v0.1-draft**；终稿未确权；未授权实现 |
| 本条首期 | 全部成功查数块的 `cutoff.status = "not_checked"`，`cutoff.note` 固定诚实文案（§5.1）。P0-B 开 Spec **不改变**本款 |
| 禁止冒充 | 语义 overlay／schema mtime、`Date.now()`、发布 `business_date`／`applied_version`、仅 `lucy_freshness` 调用成功 |
| 接入条件 | O2 已裁定为 A。把已校验水位写进本块必须另升本 Spec；不得把 P0-B 草案误当作本条已授权真实 freshness |

## 5. 公开 Schema 与投影合同（AV-03）

### 5.1 顶层键与版本

- 公开键名（三载体同名）：**`answer_verifiability`**
- 块内必填：

```text
answer_verifiability: {
  schema_version: "1",                 // string，本条冻结为 "1"
  sources: SourceIdentity[],         // 至少 1 项（成功路径）；见 5.1.1
  caliber: CaliberSummary,           // 见 5.2
  cutoff: CutoffDisclosure,          // 见 5.1.2
  carriers?: {                       // 可选诊断；结构化位省略时必填
    structuredContent?: "projected" | "omitted_not_object"
  }
}
```

#### 5.1.1 SourceIdentity

```text
SourceIdentity: {
  connectionId: string,              // 必填，非空
  schema: string | null,             // 权威解析有则填；否则 null，且不得用猜的
  sourceName: string,                // logical source 必填
  table: string,                     // physical table 必填（来自 SourceRef.physicalTable 或等价权威解析）
  display: string                    // 推荐格式：`${connectionId}.${schema}.${sourceName}`；schema 为 null 时 `${connectionId}.${sourceName}`；table 另在字段保留
}
```

- `sources` **按权威解析全集**输出；长度必须等于本次解析到的可见源个数；**禁止**只输出首项。
- 任一项缺 `connectionId`／`sourceName`／`table` → B-RESOLVE（§6），不得产半套来源。

#### 5.1.2 CutoffDisclosure（首期）

```text
CutoffDisclosure: {
  status: "not_checked",             // 首期唯一合法成功值
  note: "数据截止期未校验",            // 固定中文；禁止改成暗示已校验
  checkedAt?: never,                 // 首期不得出现
  asOf?: never                       // 首期不得出现业务截止时刻
}
```

### 5.2 口径摘要 CaliberSummary（AV-06／AV-03）

最小集合（成功路径**全部键必须出现**；数组可空）：

```text
CaliberSummary: {
  measures: string[],                 // 改写前；语义键或 expr 名；按出现序；去空白后非空
  dimensions: string[],               // 改写前；字段名；值不入摘要
  segments: string[],                 // 改写前；分段键／名
  orderBy: OrderBySummary[],          // 改写前
  userFilters: UserFilterSummary[],   // 改写前；见归一规则
  systemConstraints: SystemConstraintSummary[],
  caliberBinding: CaliberBindingRef,  // 见 §5.2.1
  omissions: OmissionsMap             // 对象；无省略时 {}
}

OrderBySummary: { field: string, direction?: "asc" | "desc" }

UserFilterSummary:
  | { form: "structured", field: string, op: string, valueRedacted: true, valueLength?: number }
  | { form: "string", fieldRefs: string[], opsNormalized: string[], valueRedacted: true, valueLength?: number }
  // 禁止仅 { kind, length }；须使 `>100` 与 `<100` 在 opsNormalized／op 上可区分

SystemConstraintSummary: {
  kind: "row_policy" | "injected_predicate" | "other",
  summary: string,                    // 去值、可解释
  omitted: boolean
}

OmissionsMap: {
  filters_truncated?: boolean,
  measures_truncated?: boolean,
  maxItems?: number,
  [k: string]: boolean | number | string | undefined
}
```

**归一规则（成功路径）**：

| 键 | 类型 | 归一 |
|---|---|---|
| `measures`／`dimensions`／`segments` | `string[]` | trim；去空串；保持相对顺序；禁止把对象整段 `JSON.stringify` 塞进一项 |
| `orderBy` | 对象数组 | 缺 `direction` 可省略键；禁止裸字符串项 |
| `userFilters` | 判别联合 | `form` 必填；结构化保留 `field`＋`op`；字符串保留规范化算子与字段引用；字面量只留 `valueRedacted`／可选 `valueLength` |
| `systemConstraints` | 对象数组 | 仅系统注入；不得与 `userFilters` 混列 |
| `omissions` | 普通对象 | 无则 `{}`；禁止 `null` |
| `caliberBinding` | 判别联合 | 见 §5.2.1；未知 `status` → 装配失败 |

捕获时点：在 `authorizeAndRewrite`／行策略改写 **之前**深拷贝用户口径字段为 `argsBeforeRewrite`；系统约束在改写后从权威诊断对象提取。二者不得混进同一无标记列表。调用点须保留「改写前／改写后」分离证据（SC-03／SC-22）。

#### 5.2.1 P0-1 请求不可变证据（AV-03／AV-06）

公开字段不再使用未定义的 `snapshotGenerationId` 单槽。命中已激活绑定时：

```text
CaliberBindingRef:
  | { status: "none" }
  | {
      status: "activated_snapshot",
      bindingId: string,                 // 非空
      sessionGeneration: number,         // BindingSession.generation（旅程代次）
      registryGeneration: number,        // begin 准备／pin 时的注册表 generation
      digest: string                     // 见 digest 合同
    }
```

**代次命名空间（分别命名、禁止混用）**：

| 名 | 含义 | 来源 |
|---|---|---|
| `sessionGeneration` | 本问询旅程 BindingSession 单调代次 | P0-1 `BindingSession.generation` |
| `registryGeneration` | begin／门禁 pin 时所见注册表代次 | P0-1 注册表 `generation`（≠ session） |

**digest 合同**：

- 对象：门禁实际强制所用的**已 pin** `caliberSnapshot`（及实现选定的绑定身份最小集：至少 `bindingId`＋`boundKey`）的**规范 UTF-8 字节**。
- 算法：`SHA-256`，输出 **小写 hex**（64 字符）。
- 规范序列化：UTF-8 JSON；对象键按字典序稳定排序；禁止依赖 JS `Number` 表示快照内整数／高精度量（快照内若含此类值须以字符串或已约定十进制文本入规范字节）。
- **不是**会话文件路径用的 scopeKey 短 hash；**不是**单独的注册表内容 digest（注册表 digest 仅可作诊断，不得替代本字段）。

**取得与携带（不可变证据）**：

1. 在执行门禁（allow）当拍，从当时已 pin 的 BindingSession／门禁上下文**拷贝** `{ bindingId, sessionGeneration, registryGeneration, digest, caliberSnapshot }` 写入**本请求**上下文（文档名：`RequestPinnedCaliberEvidence`；伪码 `ctx.requestPinnedCaliber`）。
2. 证据随该次 `lucy_query` 请求对象传递至响应装配；**禁止**在响应阶段重新 `loadBindingSession`／热读注册表再填 `caliberBinding`。
3. 未命中绑定：门禁当拍写入 `{ status:"none" }` 证据（同样随请求携带，禁止事后猜测）。
4. 应有已激活证据但缺失／字段不完整／`digest` 非 64 hex／代次非有限数 → **B-ASSEMBLE**（`reason` 含 `answer_verifiability_caliber_evidence_missing`），不得产半套引用，不得标 success。

**反例（须由夹具排除）**：查询按快照 A 过门禁；上游等待期间新 begin／supersede 提交快照 B；若响应重读会话，会给 A 的数据贴上 B 的引用——合同禁止；SC-22 夹具必须失败该实现。

### 5.3 三载体完整路径与冲突策略

| 载体 | 完整路径 | 缺失／类型规则 | 键冲突 |
|---|---|---|---|
| 模型主落点 | `result.content[0].text` → 解析为 JSON object → `.answer_verifiability` | text 非 JSON 对象 → **装配失败**（成功查数不得降级跳过） | 上游已有 `answer_verifiability` → **装配失败**（不覆盖） |
| 结构化 | `result.structuredContent.answer_verifiability` | `structuredContent` 缺失／非普通对象 → **省略该载体**，`carriers.structuredContent="omitted_not_object"`；另两处仍必须投影成功 | 对象内已有同名键 → **装配失败** |
| 合同／审计位 | `result._meta.lucy.answer_verifiability` | `_meta`／`lucy` 须确保为对象后写入；不得抹掉 Spec 162 既有键 | 已有同名键 → **装配失败** |

**一次构造再投影**：`block = buildAnswerVerifiability(...)` 纯函数；三处写入同一深拷贝语义（结构化省略时其余两处仍为同一 `block`）。

**保护 Spec 162**：投影不得删除或改写 `contract`、`tool`、`upstreamTool`、`sources`、`guardrails`、`result`、`repair`、`provenance`、applied version 相关键；仅新增 `answer_verifiability`。

### 5.4 与 `_meta.lucy.provenance` 关系

- `provenance` **保留**给运维／兼容。
- 公开核对以 `answer_verifiability` 为准；禁止实现「只写 provenance、不写公开块」却标成功。

### 5.5 与审计故事线

| 响应侧 | 审计侧（既有） | 本条要求 |
|---|---|---|
| `answer_verifiability` | 不自动等于 `access_log` 新列 | 不声称已持久化；若导出引用须另开审计合同 |
| Spec 162 `repair`／截断／version | 既有 usage evidence | **不得**为可核对块重算冲突值 |
| args_summary 去值 | `summarizeArgsForAudit` | 公开口径摘要可更可解释，但同样禁止落明文敏感值 |

### 5.6 全链路保真边界（AV-08）

保真阶段（任一阶段损坏业务数值 → B-ASSEMBLE）：

| 阶段 | 范围 | 要求 |
|---|---|---|
| P1 外层解析 | HTTP JSON body 或 SSE 事件字节 → 内存结果对象 | 不得在「仅为加块」路径上用会丢大整数／超长小数的默认 Number 解析吞掉业务字段 |
| P2 SSE 归一 | SSE → 与 JSON 路径相同的 `tools/call` result 形状 | 归一不得改写 `content[].text` 内数字字面量，也不得把 `structuredContent` 数值 Number 化后当权威 |
| P3 块投影 | 写入三载体 `answer_verifiability` | text：文本级无损加键（或等价）；structuredContent／`_meta`：不得为加块而重序列化损坏既有 rows／度量 |
| P4 最终序列化 | 写回客户端的最终 wire（JSON 或 SSE 最终事件） | 最终字节中业务数值与**投影前权威原始 wire 切片**一致（见下） |

**分别验证（禁止合并成一次深等）**：

1. **Text 数据保真**：对 `content[0].text` 内除新键 `answer_verifiability` 外的业务 JSON 文本，保留原始数字字面量（夹具至少含 `9007199254740993` 与 `0.12345678901234567890123456789`）。
2. **结构化数据保真**：对 `structuredContent` 内 rows／度量等业务字段，最终 wire 中的数字字面量与投影前原始 wire 一致；`structuredContent` 因非对象而省略载体时，不免除 text／meta 的保真义务。

**禁止的假绿判据**：

- 只比较 `JSON.parse` 后的 JS 对象／Number；
- 只断言三处 `answer_verifiability` 块彼此深等（SC-06b 仍要，但**不能**代替数据保真）；
- 用两个已经过默认解析舍入的对象互相 deepEqual 判「保真通过」。

**权威基线**：请求处理开始时保存的上游／分流**原始响应字节**（或等价不可变切片）。验收须从「原始 wire → 最终 wire」对照，而不是从「内存对象 → 内存对象」。

## 6. 失败与分支合同（AV-01）

| 分支 ID | 条件 | HTTP／MCP 形态 | 可核对块 | 映射 SC |
|---|---|---|---|---|
| B-OK | 纳入路径成功查数 | `isError !== true`，数据载荷可读 | **必须**合法块 | SC-01…SC-06, SC-14…SC-18 |
| B-DENY | 真实权限拒绝（ACL／degradedGlobal／源不可见） | 既有权限拒绝形状（保持既有 status／reason） | **不得**出现（防泄露） | SC-07 |
| B-RESOLVE | 来源权威解析不完整（缺 connection／source／table 等） | **不得**保持静默 success；须 `isError=true` 或等价错误载荷，`reason` 含 `answer_verifiability_source_unresolved` | 无块 | SC-13 |
| B-ASSEMBLE | 载荷装配／保真／键冲突／text 非 JSON 对象／P0-1 请求证据缺失或非法失败 | **不得**回落原文标成功；须 `isError=true`（或明确 JSON-RPC／MCP error result），`reason` 含 `answer_verifiability_assemble_failed` 或 `answer_verifiability_caliber_evidence_missing`；可附 `assemble_error` 诊断（无敏感值） | 无块 | SC-14, SC-22, SC-23 |
| B-UPSTREAM-ERR | 上游／Hive `isError` 或业务失败 | 保持既有错误合同 | 无块 | SC-15 |
| B-OUT-OF-SCOPE | §4.1 排除的工具／路径 | 不改本条合同 | 不产本条块 | SC-16 |
| B-HIVE-OK | Hive 成功 `lucy_query` | 同 B-OK | **必须**有块（禁止旁路） | SC-01, SC-17 |

> 相对 v0.2：删除「装配失败则三处都不出现但仍 success」；该路径升为 **B-ASSEMBLE**。

## 7. 核心流程（伪代码）

```text
# 分支 → SC 映射见 §6 与 §8 矩阵
# 请求入口（门禁当拍，早于上游等待）：
#   ctx.argsBeforeRewrite = deepCopy(userArgs)          # 改写前
#   ctx.requestPinnedCaliber = pinCaliberEvidenceAtGate() # §5.2.1；随请求携带
#   ctx.originalWire = immutableUpstreamOrDivertedBytes() # §5.6 保真基线

function onLucyQueryResponse(ctx):
  if not in_scope_production_point(ctx):          # §4.1
      return passthrough()                        # B-OUT-OF-SCOPE → SC-16

  if ctx.isError or ctx.upstreamFailed:
      return without_block()                      # B-UPSTREAM-ERR → SC-15

  if isPermissionDenied(ctx):
      return without_block()                      # B-DENY → SC-07

  if not validRequestPinnedCaliber(ctx.requestPinnedCaliber):
      return fail_closed("answer_verifiability_caliber_evidence_missing")  # B-ASSEMBLE → SC-22
  # 禁止：reload BindingSession / registry 再填 caliberBinding

  userCaliberSnapshot = snapshotUserCaliber(ctx.argsBeforeRewrite)   # D8；≠ 改写后 args
  sourceSet = resolveAuthoritativeSources(ctx)    # 全集 SourceRef + schema/table
  if not sourceSet.complete:
      return fail_closed("answer_verifiability_source_unresolved")  # B-RESOLVE → SC-13

  block = buildAnswerVerifiability({               # 纯函数；一次构造
    schema_version: "1",
    sources: sourceSet.items.map(toSourceIdentity),  # 禁止 [0] only
    caliber: summarizeCaliber(
      userCaliberSnapshot,
      ctx.systemConstraintsAfterRewrite,
      ctx.requestPinnedCaliber                 # §5.2.1；非热读
    ),
    cutoff: { status: "not_checked", note: "数据截止期未校验" }  # D3；禁 mtime 冒充
  })

  projected = projectBlockLossless(ctx.result, block, ctx.originalWire)  # D9／§5.6
  if projected.failed or not wireFidelityOk(ctx.originalWire, projected.finalWire):
      return fail_closed("answer_verifiability_assemble_failed")    # B-ASSEMBLE → SC-14／SC-23

  # D2：text + _meta.lucy 必有；structuredContent 按 §5.3
  assert carriers_consistent(projected)
  keep Spec162_meta_fields_intact(projected)      # 保护 repair/version/…
  return projected                                # B-OK / B-HIVE-OK（含 SSE 最终写回）
```

## 8. 验收

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 纳入路径成功查数响应含合法 `answer_verifiability`（禁静默无块） | 本机接口夹具：**KTX JSON** 成功写回 |
| SC-02 | `sources[]` 含完整 identity（connectionId／schema\|null／sourceName／table／display）；多源时长度＝解析全集 | 单元 + 夹具 |
| SC-03 | `caliber` 含 §5.2 最小集合与类型／归一；用户条件可区分不同谓词；去值；**真实调用点**保留改写前快照且与改写后分离；`caliberBinding` 来自请求 pin 证据而非响应期重读 | 单元 + 调用点夹具 |
| SC-04 | `cutoff.status == "not_checked"` 且无 `asOf`／`checkedAt` | 单元 |
| SC-05 | 不得用语义 mtime／查询时／businessDate／freshness 工具成功冒充 checked | 单元（注入假 mtime 仍 not_checked） |
| SC-06a | 不破坏 eval-runner 单块 `JSON.parse` 假设 | 跑批或夹具模拟多块拼接 |
| SC-06b | text 与 `_meta.lucy` 的块深等；`structuredContent` 为对象时三处深等，否则 `carriers.structuredContent="omitted_not_object"` | 单元（**不**代替 SC-23） |
| SC-07 | 权限拒绝／不可见源 → 无块、无来源泄露 | 单元 |
| SC-08 | **动态** instructions 与 **fallback** md 均不得要求隐藏；并要求用户答复引用可核对要点 | 文案／快照断言（两端） |
| SC-09 | 核对入口（若做）只读 | O1＝不做 ⇒ **N/A** |
| SC-10 | 核对入口不暴露审计原始内容 | O1＝不做 ⇒ **N/A** |
| SC-11 | 核对入口不引入新写路径 | O1＝不做 ⇒ **N/A** |
| SC-12 | `lint:spec-docs` exit 0 | 门禁 |
| SC-13 | B-RESOLVE：解析不完整 → 非 success，无块，reason 契约 | 单元 |
| SC-14 | B-ASSEMBLE：保真失败／键冲突／text 非对象 → 非 success，无块；**不得**回落损坏数值标成功 | 单元 + 接口；与 SC-23 联用 |
| SC-15 | 上游 isError／Hive 失败 → 无块；错误为既有 JSON-RPC／MCP error 形状（无块、无来源泄露） | 单元 + 接口夹具（JSON 与 SSE 错误写回各至少一） |
| SC-16 | 排除路径（read_source／explain／freshness／certified_route／template）不产本条块 | 单元 |
| SC-17 | **Hive 成功 lucy_query** 必有合法块（旁路闭合） | 本机接口夹具 |
| SC-18 | 与 018 `next_step` 共存：双键同时投影且数据保真 | 单元 |
| SC-19 | Spec 162 字段（如 `repair`／`result.truncated`／provenance／contract）在投影后仍在且语义不变 | 单元 |
| SC-20 | 决策／分支 → Plan 任务 → SC 矩阵行均可指向（见 Plan §4）；本条出口不依赖整库旅程 | 文档门禁 + 夹具清单 |
| SC-21 | **KTX SSE 最终写回**成功 `lucy_query` 含合法块；与 JSON 路径同一装配合同（AV-09） | 本机接口夹具：SSE 最终事件／归一后响应 |
| SC-22 | **在途查询＋supersede／发布代次变化**：门禁 pin 快照 A 后，等待期间新 begin／supersede 为 B，最终块 `caliberBinding` 仍引用 A 的 `sessionGeneration`／`registryGeneration`／`digest`；证据缺失→B-ASSEMBLE（AV-03／06） | 本机接口／会话夹具 |
| SC-23 | **各载体数值保真**：原始 wire→最终 wire；text 与 structuredContent **分别**断言大整数与超长小数字面量未损坏；禁止用已 Number 舍入对象 deepEqual 判通过（AV-08） | 单元 + JSON／SSE 接口夹具 |

**出口判定**：SC-01–SC-08、SC-12–SC-23 必须全部关闭；SC-09–SC-11 随 O1 为 N/A 或必做。

未执行。本条收口不表示可上线。**本版不构成终稿确权或开发授权。**

## 9. O1／O2 选项影响（写清、不代裁定）

### O1 — 用户可见强制面

| 选项 | 范围影响 | SC 影响 |
|---|---|---|
| **A（默认倾向）** 本条只做 MCP 模型可读块 + instructions | 无 WebUI 页；不验收宿主强制渲染 | SC-09–11＝N/A；SC-08 只控 instructions |
| **B** 本条增加 WebUI 只读核对入口 | +路由／只读 API；复用审计故事线 | SC-09–11 必做；Plan 增 S5 |
| **C** 本条要求特定宿主强制渲染块 | 须定义受支持宿主列表与呈现合同 | 新增宿主 SC；仓内可能无法全证，需委托人认证据形态 |

### O2 — 截止期真实探测

| 选项 | 范围影响 | SC 影响 |
|---|---|---|
| **A（与 D3 一致的首期合同）** 一律 `not_checked`，不接探测 | 无 P0-B 依赖；诚实披露 | SC-04／05 维持；禁止 checked |
| **B** 部分 source 接物理探测 | **依赖 P0-B 立项／Spec／授权**；须定义失败披露 | 新增 checked 形状 SC；未授权前禁止选 B 开工 |
| **C** 复用 `lucy_freshness` 工具结果 | **不可直接选**：现工具仅 metadata_only；若强行接入须先改 freshness 合同＝实质做 P0-B | 同 B |

> **R3 已闭合（2026-11-09）**：委托人定稿时采纳 **O1＝A、O2＝A**（文档默认倾向）。扩大范围须另升版＋再授权。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 打断 eval | D2／SC-06a |
| 伪造 freshness | D3／SC-05／P0-B 缺口登记 |
| 大整数／结构化静默损坏 | D9／§5.6／SC-14／SC-23 |
| Hive 旁路漏块 | §4.1／SC-17 |
| SSE 成功无独立夹具 | SC-21／Plan §4 |
| 在途 supersede 贴错口径引用 | §5.2.1／SC-22 |
| 把工具字段当成用户已见 | D5／§4.3／O1 |
| 与 Spec 162／018 冲突 | D4／SC-18／SC-19 |

## 11. 关联

- P0-4／REQ-030-022；串联 018 落点教训；审计故事线；Spec 162
- P0-1 已激活快照（口径绑定引用）
- P0-B／REQ-030-028（物理新鲜度真源缺口）
