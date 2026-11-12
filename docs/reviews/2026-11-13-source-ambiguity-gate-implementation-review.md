# P0-3 表级歧义门闩 · 实现质量审查

| 元数据 | 内容 |
|---|---|
| 文档名称 | P0-3 表级歧义门闩实现质量审查 |
| 文档类型 | Review |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Cursor Reviewer；修复回写 Cursor coder |
| 委托人 | xingchen |
| 基于材料 | Spec v0.5、Plan、`c1043fae`、`91a9dfc3` 及 `lucy-v0.30` 接线；本地 vitest 相关套件 30/30 |
| 适用范围 | 实现合入后质量门；本记录不改代码、不构成上线授权 |
| 输出位置 | `docs/reviews/2026-11-13-source-ambiguity-gate-implementation-review.md` |

总体结论（初审）: **BLOCK**

## 修复回写（2026-11-13）

| Finding | 处置 |
|---|---|
| BLOCK 宿主 Bearer 自证 | **已修**：`admitHostConfirmRequest` 要求 `actorKind=person` + `x-lucy-host-attestation`；缺一 403 |
| BLOCK 描述单文件 fail-open | **已修**：`loadDescriptionIndexes` 记录 `failedConnections`／`failedSourceKeys`；`buildMatchableSourcesForGate` 标 `read_failed` |
| CHANGE ACL ghost→table_forbidden | **已修**：未知字面不再进 `extractTables`；`collectUnresolvedDottedRefs` 侧通道给门闩 |
| CHANGE 五项证据写绿 | **已修**：按 Source Identity 键；无真实探测时 `schemaExists=null`／`compiled=false`／`parameterShapeValid=false` |
| CHANGE 旅程读失败当空 | **已修**：IO／JSON 损坏 → `readSourceAmbiguityJourneyResult` fail-closed deny |
| SUGGEST ASK_FIRST 双写 | **未改**（非阻断；正文仍一致） |

自动化：`source-ambiguity-gate` + `catalog-business-semantics` vitest **46/46**。**待独立复验**；本条不表示可上线。

对照 Spec v0.5（O1＝`confirmedSourceKey`，O2＝`lucy_read_source` 不纳入，O4＝8）。query／explain 插入点、`begun_bound` 跳过、`lost_or_conflict` 走 `caliber_binding_unresolved`、候选从可见 source 经 `denialAllowList` 滤出、以及 instructions／begin 工具描述已去掉「无门闩」承诺，这些与 D1／D3／D8／D15／O2 对齐。本地 30/30 不能关闭下面两条：测试把健康态和宿主证据直接注入纯函数，生产装配与 HTTP 鉴权没有走到同一条合同。

## Findings

[BLOCK] `webui/server/proxy/mcp-proxy.ts`（`handleSourceAmbiguityHostConfirm`）— Agent 可以用与 MCP 相同的 Bearer 自证选表确认，D11／§4.4／SC-17 的用户参与证据不成立。

`handleSourceAmbiguityHostConfirm` 只调用 `identifyRequestDetailed`（与 tools/call 同一 token 表）。通过后 `attestSourceConfirmation` 把 `sourceChannel` 写成 `host_confirm_api`，并同时写入 O1 载体 `confirmedSourceKey` 和层 B 证据。门闩放行只检查这条记录，不区分调用方是宿主 UI 还是持有该 Bearer 的 Agent。仓库内没有 WebUI 调用这个路径。Agent 在 `source_ambiguity_gate` 拒绝后，用同一 token `POST /mcp/host/source-ambiguity/confirm`，再重试 `lucy_query`／`lucy_explain_query`，即可解除门闩。身份上的 `actorKind` 已解析但确认入口未使用。单测 SC-17 直接调用 `attestSourceConfirmation`，没有断言该 HTTP 入口拒绝 Agent token。

→ 建议：确认写入改为 Agent Bearer 不可达的宿主通道（例如仅 WebUI 会话／独立宿主凭据，并拒绝 `actorKind=agent`）；门闩只读该通道。补一条「同一 Bearer POST 确认后再 query」必须仍 deny 的测试。

[BLOCK] `webui/server/proxy/source-ambiguity-gate.ts`（`buildMatchableSourcesForGate`）— 单文件描述读取失败被当成真 `missing`，描述健康态 fail-open，违反 D12／§4.6／SC-25。

`buildMatchableSourcesForGate` 只有 `loadDescriptionIndexes` 整调用抛错时才把健康态标成 `index_unreliable`。`loadDescriptionIndexes` 对单文件损坏是内部吞掉并继续，受影响 source 按缺失回退，函数仍正常返回。装配结果是 `descriptionState=missing` 且 `descriptionHealth={status:"ok"}`。`matchVisibleSources` 把 ok＋missing 当成描述不参与匹配。两表本应都因描述命中时，其中一表 schema YAML 解析失败，会剩下单命中并 `allow`，query／explain 继续执行。SC-25 单测用手注健康态，没有走这条生产装配。

→ 建议：索引层把单文件／单连接读取失败标成 `read_failed` 或 `index_unreliable` 并挂到对应可见 source；`buildMatchableSourcesForGate` 原样传入。禁止把解析失败降成 ok＋missing。用坏 YAML 夹具断言生产装配路径 deny、执行计数为 0。

[CHANGE] `webui/server/proxy/acl.ts` — 未知 dotted 引用进入 ACL 表集合后被判 `table_forbidden`，改写了授权裁决，超出 D9 与 §4.5 授权形状。

§4.5 要求未知 filter／order_by 保留为 `unresolved`，供门闩 fail-closed。`collectTableRefs` 把 `ghost.amount` 这类字面塞进 `extractTables` 的同一集合后，`authorizeAndRewrite` 解析不到就返回 `table_forbidden`。原先静默丢弃、ACL 仍放行的查数，现在在进门闩之前就以表权限拒绝结束；无歧义的合法查数也会被未知字段字面拖死。门闩自己的 unresolved deny 在这条生产顺序上经常走不到。

→ 建议：未知字面只进 `collectCanonicalSourceKeys` 的 `unresolved` 侧通道，不要进入 ACL 的 table 能力循环。ACL 对同一请求的 allow／deny 保持原口径；`ghost.amount` 由门闩在放行前 deny。

[CHANGE] `webui/server/proxy/source-ambiguity-gate.ts`（`buildRepairEvidenceForGate`）— §4.7 五项证据被默认写绿，`usableTargets` 不能代表「可重试目标」。

`schemaExists`／`compiled` 设为「在可见权限里且 sourceMapReliable」，`parameterShapeValid` 恒为 `true`；证据 Map 的键是短名。可见候选几乎都会进入 `usableTargets`。双连接同名时后写覆盖先写，两条身份共用一份证据。

→ 建议：按 Source Identity 装配五项；缺 schema／编译态时 `schemaExists=null` 或 `compiled=false`，使该目标进 `rejected`。短名只留给 `denialAllowList` 成员检查。

[CHANGE] `webui/server/proxy/source-ambiguity-journey.ts`（`readJourneyFile`）— 旅程文件读失败被当成空旅程，词源丢失后可能按零命中放行。

非 ENOENT 和 JSON 损坏都返回 `null`，门闩得到空 `intentSummary`，可能走到 `zero_hits` 并 `allow`。这和 D10「上下文／读取失败不得静默放行」同一类失败。

→ 建议：旅程读失败或解析失败返回不可判定 deny（`source_ambiguity_gate`，零执行）。ENOENT 仍可视为尚无旅程。

[SUGGEST] `ASK_FIRST_SECTION` 与 `webui/config/data-qa-instructions.md` 各写一份先问条文。当前正文一致，但 D13 要求单一渲染片段，后续会漂。

→ 建议：动态路径与 fallback 都从 markdown 事实源切出同一片段再插入。

## 已核对且未单列的合同点

- O1 只读旅程 `confirmedSourceKey`，query／explain 参数没有第二确认载体。
- O2：`sourceAmbiguityGateAppliesToTool` 只覆盖 `lucy_query` 与 `lucy_explain_query`。
- D3：门闩在 ACL／口径之后、explain 本地成功体之前；deny 直接 return。
- D8：`lost_or_conflict` 返回 `caliber_binding_unresolved`；仅 `begun_bound` 且 `commitPhase=committed` 跳过。
- D6／D15：候选来自本次可见 source，再经 `denialAllowList` 过滤；不可见 source 不会作为候选身份出现。
- D14：`availableCandidates` 固定为 `[]`；在五项被写绿之后该项区分度不足，见上面的 CHANGE。
- O4：`MEASURE_SUMMARY_MAX = 8`。
- 字段级 `ambiguousFieldHint` 仍在 source 门闩放行后执行。
