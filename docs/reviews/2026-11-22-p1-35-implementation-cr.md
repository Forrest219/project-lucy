# P1-35 实现 Code Review（对照 Spec v0.4；复核 Nov-17 FAIL）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-35 实现 Code Review（T35-2） |
| 文档类型 | Review |
| 版本 | v2.0（取代同日 v1.0 摘要稿；v1.0 称「本波未改运行时代码」，与事实不符） |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Claude（Builder／Track B） |
| 委托人 | xingchen |
| 基于材料 | Spec [`lucy-20261116-source-ambiguity-mcp-escape-spec.md`](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) v0.4；[SC-E 证据审计 v2.0](2026-11-22-p1-35-sc-e-evidence-audit.md)；[Nov-17 CR（FAIL）](2026-11-17-p1-35-p1-36-p1-37-code-review.md)；源码 `webui/server/proxy/{source-ambiguity-gate,source-selection-tolerance,source-join-graph,answer-verifiability,mcp-proxy}.ts`、`webui/config/data-qa-instructions.md` |
| 适用范围 | P1-35／REQ-030-056 功能合同收口的实现层评审；≠ 终稿确权；≠ UAT PASS；≠ 可上线 |
| 输出位置 | `docs/reviews/2026-11-22-p1-35-implementation-cr.md` |

## 1. 结论

**PASS**（含本轮 1 处最小修复；无遗留阻断）。

- Nov-17 CR-01：**Spec 确权取代**（委托人 2026-11-17；Spec §4.1／SC-E06／变更表同步）；CR-02／CR-03／CR-05／CR-12／CR-17：已修且有夹具。
- 本轮 CR 发现 2 处缺口（SC-E09 F1 无实现；过上限文案字面 `${SOURCE_COUNT_CAP}`），均在 Spec D5／D15 授权内最小修复并锁测试；放行／拒绝判定未变。
- 与 Spec 的残余偏差仅观察项 N-1（`never_begun`＋`keys=0`，见审计 §5），不挡 S5。

## 2. 本轮改动（唯一运行代码改动）

| 文件 | 改动 | 授权 |
|---|---|---|
| `webui/server/proxy/source-ambiguity-gate.ts` | ① `denialMessageFor("source_count_over_cap")` 改模板字符串，上限数字取 `SOURCE_COUNT_CAP`；② `denyWithCandidates`：`sourceMapReliable===false` 且非显式 `repairEvidenceByName` 且无 usable → `factualError`／`text`＝`PROBE_FAILURE_TEXT`（探测失败＋稍后重试；不提钉选） | Spec D5／§4.4 F1／SC-E09；D15；Nov-17 CR-12 |
| `webui/server/__tests__/source-ambiguity-tolerance.test.ts` | `SC-E29` 增断言；新增 `SC-E09 F1…`、`SC-E07/E08 H2…` | 同上 |

未碰：ACL、行权限、宿主 confirm、`mcp-proxy.ts`、答案可核对块、`webui/src`、KTX、kill switch。

## 3. 对照 Spec 的逐面评审

| 面 | Spec | 实现 | 结论 |
|---|---|---|---|
| 互斥优先级（§4.1） | lost→bound skip→健康→unresolved→钉选→… | `checkSourceAmbiguityGate`：`lost_or_conflict`→`deny_caliber_unresolved`；`begun_bound`＋committed→`skip_bound`；journey 读失败→deny；`unresolved`→deny；keys≥1→`gateForRequestedSources`。`gateForRequestedSources` 内**先** `catalogHealthFailed`（覆盖全部请求来源，含 never_begun）→再不可见→再词源 | 符合；Nov-17 所指「never_begun 跳过健康判定」已不存在 |
| 词源与健康分离 | never_begun 只使 hits 为空，不等于健康 ok | `resolveTermHits` 的 never_begun 空集在健康裁定之后 | 符合 |
| 三档裁决（D10／D11） | 硬线 deny；档①无披露；档②放行＋披露＋审计 | `decideSourceSelection`：跨连接→deny；`>SOURCE_COUNT_CAP(4)`→deny；单来源在命中内→allow、集外→`pin_outside_hits`；多来源未连通→`unjoined_multi_source`；连通但含集外→`multi_hit_unconfirmed`；连通且在命中内→allow。与 §4.2 v0.4 伪代码逐行一致；`termHits<2` 视为在命中内 | 符合 |
| join 连通（D12） | overlay＋`_schema` 两处；排除 `source=candidate`；任一端声明；传递连通；节点＝完整身份 | `loadDeclaredJoinEdges` 读两处、`formalJoinTargets` 跳过 candidate；`joinConnected` 节点键＝`connectionId\0schema\0sourceName`，`to` 的 schema 限定仅在同连接匹配，BFS 传递。读盘失败＝无边（落档②，不阻断） | 符合（CR-03 已闭合） |
| 披露（D13） | `answer_verifiability.sourceSelection`；仅 `lucy_query` 成功；档①无；`schema_version` 不升 | `toSelectionDisclosure`（含 schema、`termHits` 截 8＋`termHitsTruncated`）；`mcp-proxy.ts:5590` 取自门闩结果；`:7398`／`:7848` 两条 query 成功路径传入；`answer-verifiability.ts:539` 仅有值时加字段；`ANSWER_VERIFIABILITY_SCHEMA_VERSION` 不变；explain 不产块 | 符合 |
| 审计（D14） | JSONL append-only、不含取值与凭据、无阈值、档①不写 | `appendToleratedEvent` 写 `.ktx-ui/source-ambiguity/tolerated-events.jsonl`；字段＝ts／reason／tool／session 哈希前缀／usedSources／termHits；无取值、无 token；写失败旁路吞掉不阻断；全文无阈值／告警逻辑；档①分支不调用 | 符合 |
| 上限与跨连接（D15） | 拒绝须给 MCP 可达下一步 | `denialMessageFor`：跨连接→「按连接拆分」，超上限→「拆成单来源…不超过 4 个」（本轮修字面 bug）；`denyWithCandidates` 带 H1 `usableTargets` | 符合（G-2 已修） |
| 五项证据（D5／§4.4） | schemaExists／completion／visible／callable／argsShape；H1／H2／F1 | `buildRepairEvidenceForGate`：`completion==="done"` 才 compiled；`retryMeasureShapeValid` 按真实度量名核验（CR-05）；生产探针 `mcp-proxy.ts:5538-5577` 由 `listSources` 装配，探测抛错→`sourceMapReliable=false`；本轮补 F1 文案 | 符合（G-1 已修） |
| 宿主 confirm（D9／SC-E04） | person＋attestation 才放行；其余 403 | 门闩内 `hostConfirmedPin` 仍要求 `verifyUserParticipationEvidence`；HTTP 403 由 HTTP 夹具与 UAT ESC-03 锁定 | 符合 |
| O2（read_source） | 不纳入门闩 | `sourceAmbiguityGateAppliesToTool` 仅 query／explain | 符合 |
| 运行时指导（CR-02） | 声明的拦截面＝实际 | 工具描述／`data-qa-instructions.md`／`ASK_FIRST_SECTION` 三处一致，含 keys=0 面与 `SOURCE_COUNT_CAP`；GATE `SC-01/02/22` 锁 md＝常量 | 符合（CR-02 已闭合） |
| 主路径可用性（第一性原理） | 约束生效＋合法用户仍可用 | 单来源钉选首次成交（ESC-01／11）、连通多表成交（ESC-07）、集外／未连通放行并披露；硬拒只在硬线并带可执行下一步；审计写失败不阻断；join 读失败不阻断 | 符合 |

## 4. Nov-17 阻断项处置汇总

| ID | 处置 | 依据 |
|---|---|---|
| CR-01 | **Spec 授权取代** | Spec §4.1 v0.4 修订句＋SC-E06 修订标注＋变更表「v0.4 复核修订」（委托人 2026-11-17 确权）；TOL `never_begun: connected pair → plain allow; unjoined pair → tolerated`；健康／不可见硬线现先于该裁决 |
| CR-02 | **已修** | `be34e05a`；见 §3 末行 |
| CR-03 | 已修 | JOIN `CR-03: same sourceName in two schemas…` |
| CR-05 | 已修 | TOL `CR-05: a candidate without the requested measure…` |
| CR-12 | 已修（本轮补最后一处） | TOL `SC-E29…` 断言文案无字面 `${` |
| CR-17 | 已修 | `brief()` 含 `schema` |
| CR-04／06／07／08／09／10／13–16／18–20 | 不在 P1-35 出口分母（P1-36／37、导出、UAT 脚本等），本 CR 不宣称其状态 | 审计 §5 |

## 5. 验证

| 命令（cwd=`webui`） | 结果 |
|---|---|
| 相关 8 文件：`source-ambiguity-tolerance`／`source-join-graph`／`source-ambiguity-gate`／`source-ambiguity-host-confirm-http`／`answer-verifiability`／`answer-verifiability-instructions`／`ambiguous-source-hint`／`scope-restatement-instructions` | **8 files／100 tests PASS** |
| 修复前同集 | 98/98 PASS |
| 新夹具对未改源码 | 2 例红，修复后绿 |
| `tsc --noEmit` 过滤 `source-ambiguity｜source-selection｜source-join｜answer-verifiability` | 0 条（存量 tsc 错误与本组文件无关） |
| 扩展集含 `empty-result-next-step-proxy`／`data-qa-instructions-contract`／`query-guardrails` | 19 例红（18＋1），**对未改源码同样 19 例**；零新增失败；均不属 P1-35 |

未重跑 ESCAPE UAT、未 Docker 重建：本轮改动仅拒绝载荷文字，判定未变。但 INDEX PASS 跑次 `gitSha=7ebedd4e` 早于 `77e2ad84`（2026-11-20，legacy 零绑定走普通歧义路径）与本轮补丁，**需 R／委托人明示「沿用 2026-11-18 post-rebuild」**（Plan §5），或下次 Docker 重建后补 ESC-01／06／08。

## 6. 放行条件

1. R 在收口记录中写明「沿用 2026-11-18 post-rebuild（`gitSha=7ebedd4e`），后续仅 `77e2ad84` 与拒绝文案补丁」。
2. S5 句必须含「功能合同已收口」与「≠ 可上线」；不得抄回「实现进行中」「≠功能合同收口」。
3. 观察项 N-1 若要关闭为「改文」或「改码」，须委托人另定；本 CR 不阻断。

**本 CR ≠ 终稿确权；≠ UAT PASS；≠ 可上线；无 git commit／push。**
