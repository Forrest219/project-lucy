# P1-35 SC-E01–E30 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-35 SC-E01–E30 证据审计（T35-1） |
| 文档类型 | Review |
| 版本 | v2.0（取代同日 v1.0 摘要稿；v1.0 把 SC-E09 记为已有测试，事实上当时无对应夹具） |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Claude（Builder／Track B） |
| 委托人 | xingchen |
| 基于材料 | Spec [`lucy-20261116-source-ambiguity-mcp-escape-spec.md`](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md) v0.4 §4.1／§4.5／§5；UAT suite [`source-ambiguity-mcp-escape`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)（cases／runs）；[Nov-17 CR](2026-11-17-p1-35-p1-36-p1-37-code-review.md)；工作树 `webui/server/**` 源码与 vitest（2026-11-22）；基线 SHA `a093844f`（HEAD 已前进至 `e269937a`，见 §6） |
| 适用范围 | P1-35／REQ-030-056 功能合同收口的**证据层**；供 R 闸裁决。≠ 终稿确权；≠ UAT PASS；≠ 可上线；不写总账／INDEX |
| 输出位置 | `docs/reviews/2026-11-22-p1-35-sc-e-evidence-audit.md` |

## 1. 结论

| 项 | 结论 |
|---|---|
| SC-E01–E30 | 30 条均有证据指针。**SC-E09（F1）审计时无任何实现与夹具＝真 GAP**，本轮已按 Spec §4.4 F1 做最小修复并补夹具，现已关闭（见 §4） |
| Nov-17 CR-01 | **Spec 已确权取代**（非「静默当 PASS」），见 §3 |
| Nov-17 CR-02 | **已修**（`be34e05a`），现行文案与实现一致，见 §3 |
| 仍阻断 S5 的 GAP | **无**（残余与观察项见 §5，均不挡 S5） |
| INDEX | ESCAPE＝**PASS**，现值跑次 [2026-11-18 post-rebuild](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md)（含 ESC-11），与 Spec 出口一致；`gitSha` 早于现 HEAD 的门闩改动，见 §6 |

## 2. 证据矩阵

vitest 文件缩写：**TOL**＝`webui/server/__tests__/source-ambiguity-tolerance.test.ts`；**GATE**＝`source-ambiguity-gate.test.ts`；**JOIN**＝`source-join-graph.test.ts`；**AV**＝`answer-verifiability.test.ts`；**HTTP**＝`source-ambiguity-host-confirm-http.test.ts`。UAT 全部指向 2026-11-18 post-rebuild 跑次（R0／ESC-01～10＝28/28＋ESC-11 PASS）。

| SC-E | vitest（文件：用例名） | UAT（跑次＋case） | 判定 |
|---|---|---|---|
| E01 | GATE：`P1-35 SC-E01/E13: dual termHits + unique in-set pin allows without host attest`；TOL：`SC-E20 M1…` | 2026-11-18／UAT-SAG-ESC-01 | 关闭 |
| E02（v0.4 修订：多表不再一律 deny） | 仍 deny 的形态：GATE：`SC-03/04: dual description hit denies query and explain with executed=false`（keys=0＋多命中，query＋explain 均 `executed=false`）；HTTP：`…query still deny with zero upstream`（代理级上游零命中）；硬线见 E28／E29 | ESC-06 步 3（无钉选硬拦）、ESC-08、ESC-10 | 关闭 |
| E03 | GATE：`SC-06: true zero/single hit allows…`；TOL：`SC-E20 M1…` | ESC-02 | 关闭 |
| E04 | HTTP：`same Bearer without person+host attestation gets 403…`；GATE：`SC-17 HTTP admit: same MCP Bearer without person+host attestation cannot confirm` | ESC-03（403 `host_confirm_requires_person`） | 关闭 |
| E05（v0.4 取代→E24） | GATE：`P1-35 SC-E05 (v0.4 D11 supersedes): unique pin outside termHits → tolerated allow with disclosure` | ESC-06 步 5；ESC-09 步 2 | 关闭（以 E24 口径） |
| E06 | GATE：`P1-35 SC-E06: never_begun + unique visible pin allows`；`SC-10: begun_bound skips gate; … never_begun gates`（`need_begin_or_confirm`）；`SC-15: never_begun + asserted source is context_missing…`；TOL：`never_begun: connected pair → plain allow; unjoined pair → tolerated` | ESC-06 步 2／3 | 关闭（有观察项 N-1，见 §5） |
| E07（H1／H2） | TOL：**`SC-E07/E08 H2: probe healthy but every candidate legitimately fails…`**（本轮新增）；GATE：`P1-35 D5 H1: wired probes put five-true candidates into usableTargets`（断言无全员假 Schema） | ESC-08 | 关闭 |
| E08（H1 usable＋重试改写） | GATE：`P1-35 D5 H1…`（`partial` 不进 usable）；TOL：`SC-E08/ESC-08: multi-identity args do not make a compiled candidate invalid_parameter_shape`；`CR-05: a candidate without the requested measure is not a usable retry target`；`SC-E29…` | ESC-08（`usableTargets` 非空；单来源重试成交） | 关闭 |
| **E09（F1）** | TOL：**`SC-E09 F1: probe wholly unavailable → empty usable, honest probe-failure text…`**（本轮新增） | 无（探测整体失败在 demo 不可复现；Spec 允许 vitest 层证明） | **审计时 GAP→本轮修复后关闭**（§4） |
| E10（SAG-01 v3 硬线） | TOL：`SC-E27: ghost dotted filter stays a hard deny…`；GATE：`SC-16: unknown filter/order_by ghost.amount retained as unresolved` | 父套件 [2026-11-18 hardline post-rebuild](../qa/uat/suites/source-ambiguity-gate/runs/2026-11-18-cursor-sag-hardline-post-rebuild.md)（INDEX 行 `UAT-SUITE-SOURCE-AMBIGUITY`）；ESC-05 步 4 | 关闭 |
| E11 | GATE：`SC-21: lucy_read_source is not gated (O2=no)` | ESC-06 步 6 | 关闭 |
| E12 | 本表所列全部文件；Proxy 插入点：GATE：`SC-23: mcp-proxy inserts gate before local explain success body`；query／explain 分支：GATE `SC-03/04…` 循环两工具，TOL `explain_query follows the same tiers…` | — | 关闭 |
| E13 | GATE：`P1-35 SC-E01/E13…`（集内钉选无宿主 attest 即 allow）。v0.4 后多表不再先 deny，对应「硬线拒绝→单来源重试」＝TOL `SC-E29…`＋ESC-08 步 4 | ESC-08 步 4 | 关闭 |
| E14（v0.4 取代→E24） | 同 E05 | 同 E05 | 关闭 |
| E15 | TOL：`SC-E27: ghost dotted filter stays a hard deny…`；GATE：`SC-16: unknown filter/order_by…`、`SC-16 ACL: ghost.amount stays unresolved…`。ACL／行权限既有门在门闩之前执行，沿用既有套件（`sourceVisibleToPrincipal`→`denyEmpty`，见 CR §3） | ESC-05 步 4（代理级零上游） | 关闭 |
| E16 | TOL：`explain_query follows the same tiers…`；GATE：`SC-03/04…`、`SC-05/19: …`（explain） | ESC-06 步 1 | 关闭 |
| E17 | `npm run lint:spec-docs`／`lint:status-funnel`：**P1-35 Spec／Plan 无形态违规**；全仓仍有他批 Plan 红灯（见 §5）。术语：Spec Terminology Compliance 已补登（Nov-17 CR-11）。ESCAPE suite 回链 Spec：suite.md「合同回链」 | — | 关闭 |
| E18 | GATE：`P1-35 D5 H1…`（`partial`≠`done`）；`SC-16: dual-connection same name + multi-ref conflict denies`（跨连接同名）；`SC-16: unknown filter/order_by…`（错字段不进 usable）；JOIN：`CR-03: same sourceName in two schemas are distinct nodes…` | ESC-08 | 关闭 |
| E19 | GATE：`P1-35 SC-E19: never_begun + pin but description read_failed denies`；`SC-24: catalog_read_failure denies…`；TOL：`SC-E27: any requested source with description read_failed denies…`。query／explain 共用 `gateForRequestedSources`，无独立 explain 夹具（观察项 N-2） | — | 关闭 |
| E20 | TOL：`SC-E20 M1: single pin inside termHits → plain allow (no selection, no audit)` | ESC-01／ESC-09 步 1 | 关闭 |
| E21 | TOL：`SC-E21 M4: declared-join pair inside termHits → plain allow` | ESC-07 步 2 | 关闭 |
| E22 | TOL：`SC-E22 M4: star (orders+returns+people via hub) → plain allow` | ESC-07 步 4 | 关闭 |
| E23 | TOL：`SC-E23 M6: unjoined pair (returns+people) → allow + tolerated unjoined_multi_source + audit` | ESC-07 步 5（上游必拒，审计 `unjoined_multi_source`×2；非 gate） | 关闭 |
| E24 | TOL：`SC-E24 M5: pin outside termHits → allow + tolerated pin_outside_hits (supersedes E05/E14)`；`M7: …multi_hit_unconfirmed` | ESC-06 步 5；ESC-09 步 2 | 关闭 |
| E25 | AV：`P1-35 v0.4 D13：sourceSelection 披露随块投影` › `档②：block 与三载体均含 sourceSelection；schema_version 仍为 1`／`档①：不带 sourceSelection 字段`；接线：`mcp-proxy.ts:5590`（`toSelectionDisclosure`）→`:7398`／`:7848`；TOL：E23／E24 断言 `selection` | ESC-09 步 1／2 | 关闭 |
| E26 | TOL：E23（`events` 恰 1 条，不含 token／secret／password）、E20（档①`events=[]`）、explain 用例（`tool=lucy_explain_query`）。代码审：`appendToleratedEvent` 无阈值／无告警逻辑 | ESC-09 步 3／4 | 关闭 |
| E27 | 复用 E04（HTTP）＋E15（TOL／GATE ghost、`sourceVisibleToPrincipal`）＋E19 | ESC-03／ESC-05 | 关闭 |
| E28 | TOL：`SC-E28 D15 pure: cross-connection keys deny; cap boundary`；`D15: cross-connection message tells the agent to split by connection`；GATE：`SC-16: dual-connection same name…`。纯函数＋文案＋UAT；无跨连接端到端 vitest（跨连接键仅经反查产生，见 cases ESC-10 说明；观察项 N-3） | ESC-10 | 关闭 |
| E29 | TOL：`SC-E29: more than SOURCE_COUNT_CAP sources denies with usable single-source retry (H1)`（本轮补强：文案须含真实上限数字且不含字面 `${`） | ESC-08 | 关闭 |
| E30 | JOIN：`reads overlay joins; excludes candidate; counts one-sided declaration`；`reads manifest _schema joins too`；TOL 夹具＝orders 单端声明（E21／E22 即依赖） | ESC-07 步 6 | 关闭 |

## 3. Nov-17 CR-01／CR-02 专节

### CR-01（`never_begun`＋多钉选被 plain allow，对照旧 SC-E06）

| 对照项 | 现状 |
|---|---|
| Nov-17 判定依据 | 旧 SC-E06 文字：「never_begun＋双钉选／未钉选 → `context_missing`」 |
| 现行 Spec | SC-E06 行已加「**〔v0.4 修订：never_begun＋双／多钉选不再 `context_missing`…已声明 join 连通→档①放行，未连通→档②…；健康失败、未知引用、跨连接、超上限仍为硬线，先于本条裁决〕**」；§4.1 v0.4 修订句写明「**委托人 2026-11-17 确权维持**」及理由（词源命中集为空→无歧义；记 tolerated 会稀释 D14 容错率）；变更表「v0.4 复核修订」记录该确权 |
| 现行实现 | `gateForRequestedSources`：硬线（`catalogHealthFailed`→`denyEmpty`；不可见→`denyEmpty`）**先于** `resolveTermHits`／`decideSourceSelection`；Nov-17 指出的「同时跳过 `catalogHealthFailed`」已不成立 |
| 现行测试 | TOL：`never_begun: connected pair → plain allow; unjoined pair → tolerated`（注释写明委托人 2026-11-17 确权）；GATE：`SC-E06 never_begun + unique visible pin allows`、`SC-E19`（健康失败 deny）；`SC-10`（never_begun＋无钉选＝`need_begin_or_confirm`） |
| **判定** | **Spec 授权取代（superseded），不再阻断。** 依据是委托人明示确权＋Spec 正文同步修订，不是把 Nov-17 FAIL 当 PASS。条件：该确权口径只覆盖「连通多钉选维持档①」；若日后要观察未 begin 的连通多表，须另立审计计数并另行授权（Spec §4.1 已写） |

### CR-02（工具描述／instructions 与实现相反）

| 对照项 | 现状 |
|---|---|
| Nov-17 判定依据 | 新描述称「多表命中即放行」，但 keys=0 分支实际硬拒，描述点名场景走拒绝 |
| 现行文案 | `mcp-proxy.ts:1281`（`lucy_begin_question` 描述）：拦截面列出「unresolved refs, catalog health, cross-connection, more than ${SOURCE_COUNT_CAP} sources, **or no source-qualified reference at all while the business term matches several sources**」并写「Skipping begin does not bypass these hard checks」；`webui/config/data-qa-instructions.md:50-51` 与 `source-ambiguity-gate.ts:90-91`（`ASK_FIRST_SECTION`）同句，含「没有任何带来源限定的引用…业务词命中多个来源」，上限引用 `SOURCE_COUNT_CAP`（`be34e05a`） |
| 现行测试 | GATE：`SC-01/02/22: ASK_FIRST fragment matches md…`（断言 md 与 `ASK_FIRST_SECTION` 同含「没有任何带来源限定的引用」「来源数超过 ${SOURCE_COUNT_CAP}」）；`scope-restatement-instructions.test.ts` 通过 |
| 实现一致性 | keys=0＋begun＋命中≥2→`denyWithCandidates`（GATE `SC-03/04` 锁死），与文案一致 |
| **判定** | **已修，不再阻断。** |

另：Nov-17 CR-03（join 节点丢 schema）、CR-05（usable 不校验度量）、CR-12（上限写死）、CR-17（披露丢 schema）均已由 `be34e05a` 修复且有夹具；CR-12 在本轮审计中发现**残留一处**（过上限拒绝 `message` 用了普通双引号字符串，`${SOURCE_COUNT_CAP}` 被原样输出给用户），本轮已改模板字符串并补断言（§4）。

## 4. 本轮审计发现并修复的缺口

| # | 发现 | 授权依据 | 修复 | 夹具 |
|---|---|---|---|---|
| G-1 | **SC-E09／F1 无实现无测试**：`sourceMapReliable=false` 时全员 `schema_evidence_unavailable`，`factualError` 与 `text` 仍是「缺少真实 Schema 证据，无法判定」，没有探测失败类说明与「稍后重试」。Spec §4.4 F1 与 SC-E09 要求探测失败文案，且禁止暗示钉选即可越过目录健康门 | Spec D5／§4.4 F1／SC-E09（必做） | `source-ambiguity-gate.ts` `denyWithCandidates`：探测整体不可用（`sourceMapReliable===false`、非显式 `repairEvidenceByName`、无 usable）→ `factualError`／`text`＝`PROBE_FAILURE_TEXT`；`rejected` 保留；放行／拒绝判定不变 | TOL `SC-E09 F1…`（对未修复源码跑红，修复后绿） |
| G-2 | 过上限拒绝文案含字面 `${SOURCE_COUNT_CAP}` | Spec D15／§4.4（拒绝必须给可执行下一步）；Nov-17 CR-12 | `denialMessageFor` 改模板字符串 | TOL `SC-E29…` 增断言（对未修复源码跑红） |
| G-3 | SC-E07／E08 的 **H2** 分支（探测健康、候选合法全拒）无夹具 | Spec §4.4 H2／SC-E07 | 仅加测试 | TOL `SC-E07/E08 H2…` |

三项均**不改变** allow／deny 判定，只改拒绝载荷文案与测试。

## 5. 残余与观察项（均不挡 S5）

| ID | 内容 | 处置 |
|---|---|---|
| N-1 | `never_begun`＋`keys=0`：Spec §4.2 伪代码与 SC-E06 字面是 `context_missing`；实现沿用 v0.3／O3′——若请求含「断言来源」字面（`requestAssertsSource`）→ `need_begin_or_confirm`，否则按请求字面词命中裁决（可能 allow）。**不带来源限定的非通配主体**在门闩之前已被 ACL `explicit_table_required:<empty>` 拦下（`acl.ts:3451-3463`），M12 允许写「`context_missing`／`explicit_table_required`」；仅 `tables:["*"]` 主体且请求词零命中时 gate 放行（偏宽松，不伤主路径）。 | 记录；是否改文或改码由委托人定，本轮不动（改严会影响通配主体主路径，违反主路径可用性优先） |
| N-2 | SC-E19 的 explain 分支无独立夹具（共用同一函数） | 记录 |
| N-3 | SC-E28 无跨连接端到端 vitest | UAT ESC-10 PASS＋纯函数夹具 |
| N-4 | `lint:spec-docs` 全仓仍红：`lucy-20261122-s4-to-s5-parallel-wave-plan.md` plan-parts／metadata，`lucy-20261122-p173-p135-s5-closure-multi-agent-plan.md` 缺「开工前置」。均为他批文档，非 P1-35 Spec／Plan | 交 R／对应 Track |
| N-5 | 全量相关套件中既有失败：`empty-result-next-step-proxy.test.ts` 18 例、`data-qa-instructions-contract.test.ts` 1 例（预算停机）。对**未改动**门闩源码同样红，与 P1-35 无关 | 记录；不在 P1-35 出口分母 |

## 6. INDEX 跑次与 Spec 出口

| Spec 出口要求（§7） | 证据 | 判定 |
|---|---|---|
| SC-E01–E19 证据关闭 | §2 | 满足（E09 经 §4 修复） |
| v0.4：SC-E20–E30＋ESC-01～09 必做全绿＋D14 审计 | §2；2026-11-18 跑次 R0／ESC-01～10＝28/28，ESC-09 审计 1 条 | 满足 |
| ESCAPE INDEX＝**PASS**（不以 PASS WITH GAP 关闭） | INDEX 行 `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`＝**PASS**，现值跑次 2026-11-18 post-rebuild（含 ESC-11）；优先于 2026-11-16 v0.4 跑次 | 满足 |
| 父 SAG-01 v3 硬线 | INDEX 行 `UAT-SUITE-SOURCE-AMBIGUITY`＝PASS（hardline post-rebuild） | 满足 |

**同码性说明（须 R 读到）**：该跑次 `gitSha=7ebedd4e`（2026-11-18）。此后触及门闩文件的提交：`77e2ad84`（2026-11-20，legacy 零绑定：`lost_or_conflict`＋`optionalPreparing`＋inactive 按 never_begun 走普通歧义路径，不绕过来源检查）与本轮文案补丁（仅拒绝载荷文字）。Plan §5 要求：门闩行为变动须重跑 ESCAPE，或委托人批「沿用 2026-11-18 post-rebuild」。两处改动均不改变 SC-E 判定，但**需 R／委托人明示沿用**，或在下次 Docker 重建后补一遍 ESC-01／06／08（本轮禁止 Docker 重建）。

## 7. 验证

| 命令（cwd=`webui`） | 结果 |
|---|---|
| `npx vitest run --maxWorkers=1 server/__tests__/source-ambiguity-tolerance.test.ts source-join-graph.test.ts source-ambiguity-gate.test.ts source-ambiguity-host-confirm-http.test.ts answer-verifiability.test.ts answer-verifiability-instructions.test.ts ambiguous-source-hint.test.ts scope-restatement-instructions.test.ts` | **8 files／100 tests PASS**（修复前 98，新增 2 例；修复前基线 98/98 PASS） |
| 对未改源码单跑 TOL | 2 例红（`SC-E29` 字面 `${`、`SC-E09 F1`）→证实夹具有效 |
| `npm run lint:status-funnel` | 通过 |

本审计 ≠ 终稿确权；≠ UAT PASS；≠ 可上线。
