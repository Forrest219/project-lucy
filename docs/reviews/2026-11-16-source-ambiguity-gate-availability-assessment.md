# 表级歧义门闩可用性评估：P0-3 在纯 MCP 客户端场景不可用的四个修复方向与决策清单

| 元数据 | 内容 |
|---|---|
| 文档名称 | 表级歧义门闩可用性评估与修复方向决策清单 |
| 文档类型 | Review（能力评估／决策输入） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-16 |
| 撰写人 | MCode（MiniMax Code） |
| 委托人 | Forrest |
| 基于材料 | Spec [`lucy-20261107-source-ambiguity-gate-spec.md`](../specs/lucy-20261107-source-ambiguity-gate-spec.md) v0.5（P0-3／REQ-030-024）；实现 `webui/server/proxy/{source-ambiguity-gate,source-ambiguity-journey,mcp-proxy}.ts`；[实现复审](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md)；[错题本](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；UAT-SUITE-SOURCE-AMBIGUITY 全部跑次；本机 compose 实测（`compose-lucy-1`，`gitSha=d64414d68a19…`） |
| 适用范围 | 委托人决定「P0-3 表级歧义门闩怎么修、是否改合同、客户侧是否先解封」的输入；**仅评估与决策清单，不含开发授权，不改任何 Spec 状态，不动运行代码** |
| 输出位置 | `docs/reviews/2026-11-16-source-ambiguity-gate-availability-assessment.md` |

台账：总账 [P0-3](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)／REQ-030-024。本文不是 UAT 跑次，测试台 `not_registered`。**评审结论 ≠ UAT PASS ≠ 可上线。**

---

## 1. 结论

1. **故障是设计必然，不是回归。** 门闩自 2026-11-08（`91a9dfc3` 接入 Proxy）起持续生效；今天 15:25 与 17:27 两次行为的差异由**查询业务词的跨表命中数**决定，与版本、升级、重启无关（容器 `RestartCount=0`，运行版本未变）。
2. **P0-3 当前在纯 MCP 客户端场景不可用，且不可自愈。** 门闩唯一放行通道 `POST /mcp/host/source-ambiguity/confirm` 在**仓库内没有任何调用方**（只有服务端路由），准入还要求 `actorKind=person` ＋ `x-lucy-host-attestation`，而线上 `access.yaml` **没有任何 `actor_kind: person`**。三道门同时关着。
3. **合同已经把它收口了，但收口的是「拦得住」，不是「可用」。** `UAT-SAG-02`（宿主确认后放行）自 2026-11-14 起持续 **BLOCKED** 且在 `suite.md` 里被列为**可选**；P0-3 却于 2026-11-13 记「SC-01–SC-26 证据关闭／功能合同已收口」。
4. **拒绝载荷本身也不合格。** `usableTargets` 因 `schemaExists` 恒 `null` 而结构性恒空 → 即使宿主通道打通，Agent 拿到的候选也全是「缺少真实 Schema 证据，无法判定」，没有一个是「可重试目标」。
5. **建议路径：D（应急 kill switch）＋ A＋C（长期）；不建议 B。** B 等于放弃 CFO 误报防线，属改需求而非修 bug。

## 2. 事实基线（本机实测）

环境：`compose-lucy-1`（`lucyVersion=0.30.0`，`gitSha=d64414d68a19…`），MCP `:57881`。每组独立会话。

| # | 条件 | 实测 |
|---|---|---|
| S1 | `begin(意图含「超市」)`＋`lucy_query` 限定 `superstore_orders` | **DENY** `source_ambiguity_gate`；3 候选；`usableTargets=[]`；全部 `schema_evidence_unavailable` |
| S2 | `begin(意图只命中 1 张表)`＋同一 query | **ALLOW**，返回 100 行 |
| S3 | 无 `begin`＋限定 source | **DENY**（`detail=need_begin_or_confirm`） |
| S4 | 无 `begin`＋无 source 断言 | DENY `explicit_table_required`（另一道门） |

逃逸路径实测：原样重试 → 仍 DENY；改指候选表 → 仍 DENY；MCP 工具面**无**确认参数；宿主确认 API → 403（无 person actor）。

> 这与用户侧报告逐字吻合：`candidates` 非空、全部 `schema_evidence_unavailable`、`lucy_catalog`／`lucy_read_source` 正常、目标表在授权清单内。
>
> **独立复核**：同日并发会话另起 `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` 套件，得到逐条一致的结论——ESC-01（多表词＋已限定表名）FAIL＝拒绝且 `usableTargets=[]`；ESC-02（窄意图，不含泛化词）PASS＝成交；ESC-03（非 person 携伪 attestation 头）403 `host_confirm_requires_person`。两路取证互为印证（基线跑次见 §7）。

**推论**：门闩是否触发**只看旅程业务词命中了几张可见 source（≥2 即拦）**，**请求里已写死表名一律无效**（§4.5 规定请求引用集合只参与「确认放行」判定，不参与「是否触发」判定）。

## 3. 完整状态机：为什么是单向死路

```
lucy_query
  │
  ├─ BindingSession=never_begun 且请求已断言 source ──→ context_missing ──→ DENY(空候选)
  ├─ BindingSession=begun_bound 且 commitPhase=committed ──→ 跳过本门闩（走 P0-1 口径校验）
  │
  └─ 词源＝旅程 intentSummary/question（CJK n-gram L∈[2,8]）
       └─ 匹配字段＝sourceName + table + description + measureNames + dimensionNames
            ├─ 命中 ≥2 ──→ DENY（候选＝可见∩allow-list）
            │              └─ repair.usableTargets = []   ← 因 schemaExists 恒 null
            │              └─ 放行？需 confirmedSourceKey ∈ 候选快照
            │                        ＋ 用户参与证据（宿主 attested）
            │                        ＋ 请求引用集合 == {该身份}
            │              └─ 宿主 attested 通道：仓库内 0 个调用方
            │                              ＋ 准入需 actorKind=person（线上 0 个）
            │                              ⇒ 三个条件永远无法同时满足
            └─ 命中 <2 ──→ ALLOW
```

**三个独立缺陷叠加**，缺一不可解：

| # | 缺陷 | 位置 | 性质 |
|---|---|---|---|
| X1 | 触发判据过宽：中文业务词跨表重叠是常态 | Spec §4.1（D4） | **设计** |
| X2 | 拒绝载荷无可执行下一步：`usableTargets` 结构性恒空 | `source-ambiguity-gate.ts:404–432`（未实现真实 schema 探测） | **实现债**（D14/§4.7 本就要求「生产须传入真实探测结果」） |
| X3 | 唯一放行通道不可达：无调用方 ＋ 无 person 凭据 | `mcp-proxy.ts:200`、`:7474–7583`；`access.yaml` 无 `actor_kind` | **集成缺口**（§4.4 两条允许的 `sourceChannel` 都没实现） |

X2 与 X3 解释了 Agent 的观察「候选表全部报缺少真实 Schema 证据」和「确认机制只在 WorkBuddy 宿主侧可达」。

## 4. 四个修复方向评估

### 方向 A：补 MCP 侧确认参数载体（O1 的② `sourceConfirmationKey`）

| 项 | 评估 |
|---|---|
| 改什么 | 给 `lucy_query`／`lucy_explain_query` 加可选参数 `sourceConfirmationKey`；命中 ≥2 时，若该值 ∈ 本代候选快照且请求引用集合 == {该身份} → 放行 |
| 动合同 | **须重新闭合 O1**（现裁定为「①旅程字段」，spec:156 明确禁止 `OR` 兼备）→ 属改合同，需授权 |
| **致命冲突** | §4.4 层 B 明令「Agent 工具参数自述」**不构成**用户参与证据（spec:294–298）；D11 要求独立于 Agent 的核验路径。**只加参数不动层 B＝把 SC-17 钉死的反例放行**，直接违反 D11 |
| 安全的完整形态 | A ＋ 宿主侧实现「确认提交 API」或「用户回合写入」，二者择一写入 Plan／SC（spec:284–286 允许）。仓库内现在**两个都没有** |
| UAT 补测 | SC-17 固定反例必须保留并扩展（同一 Bearer 参数自证 → 必须仍 DENY）；新增「宿主确认后放行且引用集合一致」为**必做** |
| 成本 | 中（Proxy ＋ 宿主调用方 ＋ WebUI 会话通道）；跨 WebUI/Proxy 两侧 |
| 结论 | **可做，但必须与宿主通道捆绑**，单做 A 不安全 |

### 方向 B：限定名优先放行（请求已断言单一 source 时不触发）

| 项 | 评估 |
|---|---|
| 改什么 | §4.3 增设更高优先级分态：请求引用集合恰为单一已知可见 source → 跳过门闩 |
| 动合同 | 与 **D4 目标 2／3**（spec:113「限定名错表仍可拦」）**直接冲突**；与 §4.1「承诺覆盖」的固定反例冲突；与 P0-3 的立项初衷（CFO 误报防线，spec:11）冲突 |
| 性质 | **不是修 bug，是改需求／回退 P0-3**。走这条路要重开 REQ-030-024，并在总账记 P0-3 降级 |
| 影响面 | CFO 误报防线失效；spec §2 承诺作废 |
| 成本 | 低（代码），但治理成本高（需求重开＋对抗评审） |
| 结论 | **不建议**，除非委托人明确决定放弃误报防线 |

### 方向 C：修五项证据装配，让 `usableTargets` 非空

| 项 | 评估 |
|---|---|
| 改什么 | 实现真实 schema 探测（`schemaExists` 不再恒 `null`）＋ `compiled`（`completion=done`）＋ `parameterShapeValid`（相对本次 args 的形态检查） |
| 动合同 | **不改合同** —— D14／§4.7（spec:373）本就要求「与现网 repair 同源的真实 Schema 探测」。这是**补实现债** |
| 收益 | 候选从「不可判定」变成「可用」，拒绝载荷第一次给出可重试目标；`repair.text` 的「当前没有可用的合法目标」不再是死路 |
| **不能单独解死路** | 层 B 未满足时仍 DENY（用户参与证据仍缺）。**C 只是让拒绝载荷可操作，不是让门闩能放行** |
| 风险 | 「schema 探测」在 KTX 侧有已知坑（`ktx sql` 禁止 `DESC`，见 [错题本](../lessons/2026-11-13-external-catalog-column-read-ktx-describe.md)）；须复用 P1-20 的直连 `DESC`→`SHOW COLUMNS` 方案，成本高于表面 |
| UAT 补测 | SC-18 重断言（五项失败对象不得进 `availableCandidates`）—— 现状 `usableTargets` 恒空，这条 SC 事实上没被真实场景压到；新增「候选可用 ⇒ `availableCandidates` 与文案一致」 |
| 成本 | 中高（需接 schema/编译态探测） |
| 结论 | **建议做**（同时是独立成立的正确性修复：现在 `usableTargets` 恒空本身就是 bug） |

### 方向 D：加 kill switch（环境变量旁路）

| 项 | 评估 |
|---|---|
| 改什么 | 加 `LUCY_SOURCE_AMBIGUITY_GATE=off`（命名待定），运维不发版即可关闭门闩 |
| 动合同 | 不改 Spec 主体，但与 **D1**（spec:141「双层同批：instructions＋tool gate 硬拦」）有张力 —— fail-closed 是安全承诺 |
| 先例 | 行权限门有 `proven` 开关；WebUI 交互合同门禁有 `lint:spec-docs`。**本门闩目前无任何旁路**（全仓无 `process.env` 读取） |
| 收益 | **最快解除客户不可用**，且不改安全语义（只在客户明示下关）；可与 A／C 并行推进 |
| 风险 | 关掉＝CFO 误报防线同时失效；须配套：开关生效必留审计日志、默认关闭有到期日、客户侧须书面确认接受误报风险 |
| UAT 补测 | 新增「开关 off ⇒ 门闩不生效且有审计记录」；**开关 on（默认）行为不得变** |
| 成本 | 低 |
| 结论 | **建议作为应急手段**，但不作为长期方案 |

### 方向对比一览

| | A（MCP 确认参数） | B（限定名优先） | C（修五项证据） | D（kill switch） |
|---|---|---|---|---|
| 解死路 | ✅（须配宿主通道） | ✅ | ❌（只让拒绝载荷可操作） | ✅ |
| 合规 D11／SC-17 | 须捆绑宿主通道 | ✅ | ✅ | ✅（明示关闭） |
| 合规 D4／D1 | 须重闭 O1 | ❌ 与 D4 冲突 | ✅ | 与 D1 有张力 |
| 是否改合同 | 是（O1） | 是（回退需求） | 否（补实现债） | 否 |
| 成本 | 中 | 低（治理高） | 中高 | 低 |
| 建议 | ✅ 与 C 捆绑 | ❌ 不建议 | ✅ | ✅ 应急 |

## 5. 决策清单（需委托人拍板）

| # | 决策项 | 选项 | 我的建议 |
|---|---|---|---|
| **D-1** | 客户侧是否立即解封 | ① 先上 D（kill switch） ② 等 A／C 完成 ③ 客户侧改走 WebUI 宿主通道 | **①**，须委托人书面明示 ＋ 记录开关生效期与误报风险接受 |
| **D-2** | 长期修复方向 | ① A＋C ② 仅 C ③ A ＋ C ＋ D ④ B | **③**：C 独立成立（`usableTargets` 恒空本身是 bug）＋A 须捆绑宿主通道＋D 作应急 |
| **D-3** | O1 是否重新开放 | ① 改裁定为「②参数载体」 ② 「①②择一实现」 ③ 维持「①」不动 | 走 A 则必须选 ①②之一；**须授权后重新闭合**，不得由实现方自行 `OR` 兼备 |
| **D-4** | 宿主通道选哪条 `sourceChannel` | ① WebUI／宿主用户回合写入 ② 宿主确认提交 API | ② 工作量小且已有服务端路由；① 更贴近真实用户意图但需 WebUI 会话写入路径 |
| **D-5** | UAT 必做项 | ① SAG-02 由可选提为必做 ② 维持可选 | **①**：放行路径未验就不能记「功能合同已收口」。**已部分落地**：同日新建 [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)（纯 MCP 逃生专测，基线 FAIL）；仍需委托人确认其覆盖是否等价于「宿主确认放行」为必做 |
| **D-6** | P0-3 收口状态 | ① 维持已收口 ② 加限定「放行通道未验，不得据此声明客户可用」 ③ 回退状态 | **②**：不推翻已有工作，但阻断「已收口 ⇒ 可上线」的误推 |
| **D-7** | 存量 BLOCKED 归类 | ① P1-12／P1-28 的两处 BLOCKED 并入本条产品缺陷 ② 维持各记 BLOCKED | **①**：同一症状在两套件重复出现，按产品缺陷归并 |
| **D-8** | 客户实例复核 | ① 要 `finance` 可见源清单与描述重叠面 ② 不复核直接定方案 | **①**：命中面规模直接决定 X1 是否需要改判据（而非只补通道） |

## 6. 未验证边界（本机无法确认）

1. 客户 `finance` 实例的可见 source 数量、`会员/收入` 描述的实际重叠面 —— 决定 X1 的严重度，本机 demo 数据不可外推。
2. 客户侧 `access.yaml` 是否存在 `actor_kind: person`、以及 WorkBuddy 是否走 WebUI 会话（若走，通道可能已可达）。
3. 用户侧 15:25「币种字典表」那次的实际业务词 —— 机制上解释为单命中放行，但未见原始请求。
4. `begun_bound` 路径（`lucy_begin_question` 成功绑定口径后跳过门闩）在客户业务域的实际命中率 —— 本机因口径绑定未就绪未走通。

## 7. 证据指针

- 错题本：[`docs/lessons/2026-11-16-source-ambiguity-gate-deadlock.md`](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)（含完整复现表与 spec 条款对照）
- 本机复现脚本：`inbox/repro-sag-gate.sh`（临时证据，可删）
- 独立复核套件（并发会话，同日）：[`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)｜[基线跑次 FAIL](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-claude-sag-escape-baseline.md)
- 实现：`webui/server/proxy/source-ambiguity-gate.ts:404–432`（五项证据恒空）、`:690–843`（主入口）；`webui/server/proxy/source-ambiguity-journey.ts:208–236`（宿主准入）；`webui/server/proxy/mcp-proxy.ts:200`、`:4922–4998`、`:7474–7583`
- UAT 证据：`docs/qa/uat/suites/source-ambiguity-gate/suite.md:15`（SAG-02 可选）、`runs/2026-11-14-claude-macmini-p0-post-upgrade.md:45–46`（PASS／BLOCKED）、`docs/qa/uat/suites/question-budget/runs/2026-11-15-cursor-p1-12-budget.md:18`、`docs/qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md:35`
- 复审：[`docs/reviews/2026-11-13-source-ambiguity-gate-implementation-review.md`](2026-11-13-source-ambiguity-gate-implementation-review.md):36（已指出「仓库内没有 WebUI 调用这个路径」，至今未修）
