# 错题：表级歧义门闩把「已限定表名的查数」变成单向死路，且无逃生通道

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-16 |
| 标签 | `contract-stack` `gate-gap` `ux-regression` `sev-high` |
| 环境 | 本机 compose（`compose-lucy-1`，`gitSha=d64414d68a19…`，`lucyVersion=0.30.0`）；用户报障实例为客户侧 `finance` 连接（`bidm.viz_dm_hs_pl_metric_sum`），**该实例未在本机验证** |
| 相关 | Spec [`lucy-20261107-source-ambiguity-gate-spec.md`](../specs/lucy-20261107-source-ambiguity-gate-spec.md)（P0-3／REQ-030-024）｜实现 `webui/server/proxy/source-ambiguity-gate.ts`、`webui/server/proxy/source-ambiguity-journey.ts`｜接线提交 `91a9dfc3`（2026-11-08）｜复审 [implementation-review](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md) |
| 状态 | `open`（P0-3 已「功能合同已收口」，但唯一放行通道从未端到端跑通） |

## 1. 症状与影响

- 客户侧 Agent（WorkBuddy）执行「请使用 lucy 查询 25 年 11 月和 12 月会员收入」时，`lucy_query` 一律返回 `source_ambiguity_gate`（`表级歧义：请先确认来源表`）。请求已写明限定表 `bidm.viz_dm_hs_pl_metric_sum`、`company_code='9999'`、`metric_zh='会员收入'`、`stats_yyyymm in ('2025-11','2025-12')`。
- 拒绝载荷中 `candidates[]` 非空，但 `repair.usableTargets=[]`，每个候选的 `reason` 均为 `schema_evidence_unavailable` → 文案「缺少真实 Schema 证据，无法判定」。
- `lucy_catalog`／`lucy_read_source` 正常，目标表仍在授权清单内 → **不是权限问题，也不是表不存在**。
- 影响面：**纯 MCP 客户端（无宿主 UI 确认通道）的查数主路径**。门闩一旦触发，在 MCP 工具面内**不可自愈**（见 §2 复现要点）。

## 2. 复现要点

本机 `compose-lucy-1`（MCP `:57881`，Bearer 见本地凭据文件）四组对照，每组独立会话：

| # | 条件 | 实测结果 |
|---|---|---|
| S1 | `begin(intentSummary=「…超市业务…」)` + `lucy_query` 限定 `superstore_orders` | **DENY** `source_ambiguity_gate`；3 候选；`usableTargets=[]` |
| S2 | `begin(intentSummary=「仅查询 superstore_orders 订单明细金额」)` + 同一 query | **ALLOW**，返回 100 行 |
| S3 | 无 `begin` + 限定 source 的 `lucy_query` | **DENY** `source_ambiguity_gate`（`detail=need_begin_or_confirm`） |
| S4 | 无 `begin` + 无 source 断言 | DENY `explicit_table_required`（**另一道**门，非本条） |

逃逸路径实测（同一 S1 会话内）：

| 动作 | 结果 |
|---|---|
| 原样重试 `lucy_query` | 仍 DENY |
| 改指候选表 `superstore_people` | 仍 DENY |
| MCP 工具面携带确认身份 | **无此参数**（O1 只裁定旅程字段 `confirmedSourceKey`，无 `sourceConfirmationKey`） |
| `POST /mcp/host/source-ambiguity/confirm` | 需 `actorKind=person` **且** `x-lucy-host-attestation`；本机 `access.yaml` 无任何 `actor_kind: person`（`grep -c actor`＝0）→ 403 |

**判定条件**：门闩是否触发**只取决于旅程业务词命中了几张可见 source**（≥2 即拦），**与请求里是否已写死表名无关**。这与用户「17:27 全线收紧」的归因矛盾——见 §3 环境层。

## 3. 根因

### 3.1 合同层： implicated spec 条款（`docs/specs/lucy-20261107-source-ambiguity-gate-spec.md` v0.5）

| 条款 | 规定 | 造成的后果 |
|---|---|---|
| **§4.1（D4）**（spec:193–211） | 命中字段＝`sourceName`＋`table`＋`description`＋`measureNames`＋`dimensionNames`；词源＝旅程 `intentSummary`／`question`；CJK n-gram `L∈[2,min(8,|R|)]` | 中文业务词（"会员"、"收入"）在真实语义层里跨表重叠是常态，≥2 命中几乎必然 |
| **§4.1 尾部**（spec:214） | 「不同意图短语分别命中不同表，只要去重后命中身份 ≥2，同等触发」 | 命中宇宙随可见源数量线性膨胀；源越多越容易触发 |
| **§4.3 P1 硬裁决**（spec:245、250） | `never_begun` ＋ 请求已断言 source/限定字段 → `context_missing` fail-closed，**即便单命中也不放行** | 裸 `lucy_query`（未先 `begin`）100% 被拦（实测 S3） |
| **§4.5 ＋ D5**（spec:327–345） | 请求的 source 引用集合**只用于「确认放行」判定，不参与「是否触发」判定** | 显式写全限定表名也救不了（S1）——这是设计意图，不是实现 bug |
| **§4.7 ＋ D14**（spec:373、389–401） | `schemaExists` 无真实探测时一律 `null`；五项未全过不得进 `usableTargets` | `usableTargets` 结构性恒空 → 拒绝载荷不给出任何「可引用重试目标」 |
| **§4.4 层 B ＋ D11**（spec:271–292）／**O1**（spec:156） | 放行须有宿主 attested 用户参与证据；确认载体只有旅程字段 | 唯一放行路径在纯 MCP 客户端不可达 |

### 3.2 实现层

- `webui/server/proxy/source-ambiguity-gate.ts:404–432`（`buildRepairEvidenceForGate`）**硬编码** `schemaExists: null`、`compiled: false`、`parameterShapeValid: false`（无真实 schema 探测入口）→ `usableTargets` 恒为空集，与 §4.7 一致，但与 §3.1「至少给出可重试目标」的产品意图相反。
- `webui/server/proxy/source-ambiguity-gate.ts:285–287`：`never_begun` ＋ asserted → `context_missing`（实测 S3）。
- `webui/server/proxy/source-ambiguity-gate.ts:776–778`：命中 <2 → allow（实测 S2）——**门闩不是「一律拦」，是「按词拦」**。
- `webui/server/proxy/source-ambiguity-journey.ts:212–236`：`hostConfirmCallerAllowed` 要求 `actorKind==="person"`；`admitHostConfirmRequest` 另要求 `x-lucy-host-attestation`。本机与客户侧均无 person actor。
- **门闩无 kill switch**：全仓无任何 `process.env` 开关可旁路（对比：行权限门有 `proven` 开关）。

### 3.3 数据层

- 描述与度量名纳入匹配 ⇒ 命中宇宙随可见 source 数量与描述质量增长；客户 `finance` 业务域表多、中文业务词泛化 ⇒ 触发概率接近 1。
- 客户实例的 `finance`／`bidm` 语义层未在本机验证；本机复现走 demo 数据，但**代码路径完全同一条**。

### 3.4 环境层：**「17:27 全线收紧」不成立**

| 核查项 | 实测 |
|---|---|
| 容器启动 | `StartedAt=2026-11-15T14:40:15Z`，`RestartCount=0` → **今天 17:27 没有任何重启** |
| 容器内版本 | `gitSha=d64414d68a19…`（2026-11-15 22:14 提交）→ **今天的提交一个都没进容器** |
| 今日提交 | `299de2c9`（07:33，P1-12）**只改 instructions 文本**（`mcp-proxy.ts` +10 行），不碰门闩路径 |
| 门闩接入 Proxy | `91a9dfc3`（2026-11-08 23:14，`wire P0-2/P0-A/P0-3 into proxy and ACL paths`）→ **自 11-08 起持续生效** |

⇒ 15:25「币种字典表」查得通、17:27「会员收入」被拦，是**同一条门闩对不同查询内容的不同判定**（S1 vs S2），**不是** 17:27 发生了一次升级收紧。

### 3.5 「哪个功能升级导致的」

**0.30.0 的 P0-3 表级歧义门闩（REQ-030-024）**，经 `91a9dfc3`（2026-11-08）接入 MCP Proxy。配套依赖 **P0-1 口径绑定**（`b1273d4c`，2026-11-08）提供 BindingSession 四态，§4.2／§4.3 的分态依赖它。**不是** P1-12（instructions 预算行）。

## 4. 为何漏检

| 漏检点 | 证据 |
|---|---|
| **放行通道从未端到端验证，却按「功能合同已收口」记账** | `UAT-SAG-02`（宿主 attested 确认后放行）自 2026-11-14 起持续 **BLOCKED**（无 person actor），且在 `suite.md:15` 被列为**可选**；P0-3 仍于 2026-11-13 记「SC-01–SC-26 证据关闭」 |
| **必做用例只验证「拦得住」，不验证「拦得住还能放行」** | `UAT-SAG-01` PASS 的判据就是「返回 deny」；对真实用户而言 deny 本身是故障 |
| **多套件已连续记录同一症状，却按「用例前置不满足」归类为 BLOCKED 而非产品缺陷** | `2026-11-15-cursor-p1-12-budget.md:18`（「连续返回 `source_ambiguity_gate`」）；`2026-11-15-cursor-row-policy-retest.md:35`（「Gate-On 隔离主路径被表级歧义门闩挡住……未完成来源确认到可查数」）——**事故前一天已在台账里** |
| **单测覆盖函数，不覆盖「宿主缺席的纯 MCP 客户端」这一部署实况** | `source-ambiguity-gate.test.ts` 48/48 全绿（放行路径靠直接调 `attestSourceConfirmation` 打桩，绕开了真实 HTTP 准入） |
| **无 kill switch**，一旦触发无法旁路 | 行权限门有 `proven` 开关，本门闩没有 |

## 5. 举一反三

1. **「门禁类」功能必须有宿主缺席时的降级／钉选／确认路径。** 任何依赖宿主 UI 写回证据的门闩，都必须在纯 MCP 下仍有合同内逃生；kill switch 不得冒充正式修复。已升格为仓库第一性原理：[`DEVELOPMENT.md`「主路径可用性优先」](../governance/DEVELOPMENT.md)。
2. **拒绝载荷必须至少给出一个可执行的下一步。** `usableTargets=[]` ＋ 候选非空 ＝ 把「请确认来源表」变成没有出口的指令；契约应要求「拒绝要么给出可重试目标，要么明确说明需宿主介入」。
3. **验收必做项要覆盖「故障方向」而不是「安全方向」。** 只验「拦住」的门禁 UAT，PASS 不等于可用；放行路径未跑通就不能记「功能合同已收口」。
4. **同类症状在不同套件重复出现时，先当产品缺陷归并，不要各记 BLOCKED。** 本例在 11-15 的两个套件里独立出现，被记成「前置不满足」，导致 11-16 客户侧仍在踩同一个坑。
5. **「某时刻突然全坏」先查运行态版本与重启时间，再查代码。** 本例容器 `RestartCount=0` 且版本未变，5 分钟就能排除「升级导致」；反之就会一路追错提交。
6. **中文业务词的跨表重叠是常态，不是例外。** 任何以「命中 ≥2 即拦」为判据的设计，在中文语义层上都会趋近「必然触发」；须用更保守的判据（如完整限定名优先、要求命中同一维度组合、要求词长阈值）。

## 6. 后续动作

> 登记 ≠ 开发授权。下表一律未授权开工；需另开 Spec／Plan（走 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单）。

| 动作 | 状态 | 说明 |
|---|---|---|
| 决定 P0-3 的放行策略：① 补 MCP 侧确认参数载体 ② 放宽限定名优先 ③ 修五项证据使 `usableTargets` 非空 ④ 加 kill switch 旁路 | **已拍板持久方案并落盘 Spec／Plan（2026-11-16）** | 委托人认可：**钉选放行（收窄②）＋五项证据（③）**；不以 ④ 结案；① 作可选 O。见 [P1-35 Spec](../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)／[Plan](../plans/lucy-20261116-source-ambiguity-mcp-escape-plan.md)。**待 R2-F／R4** |
| 客户侧实例复核：`finance` 连接可见源数量、`会员/收入` 描述重叠面 | 未开 | 本机无法验证客户实例（评估材料 D-8） |
| 把「门闩无宿主通道时不可用」写入 P0-3 的 UAT 必做项 | **已挂测试台（2026-11-16）** | 新套件 [`UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`](../qa/uat/suites/source-ambiguity-mcp-escape/suite.md)；基线跑次 [FAIL](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-16-claude-sag-escape-baseline.md)；GAP-UAT-P0-3-ESCAPE。优化后同用例翻绿才关缺口 |
| 在 `docs/qa/uat/INDEX.md` 复核 P1-12／P1-28 两处 BLOCKED 的归类 | 未开 | 应并入本条产品缺陷，而非继续记「前置不满足」（评估材料 D-7） |
| 复核「功能合同已收口」口径：放行通道未验时是否应记收口 | 未开 | 影响 P0-3 总账状态行（评估材料 D-6） |

## 7. 证据指针

- 本机复现脚本：`inbox/repro-sag-gate.sh`（临时，可删）；对照结果见 §2。
- 门闩实现：`webui/server/proxy/source-ambiguity-gate.ts`（匹配 `:160–234`；分态 `:274–313`；五项证据 `:404–432`；主入口 `:690–843`）。
- 放行准入：`webui/server/proxy/source-ambiguity-journey.ts:208–236`；HTTP 入口 `webui/server/proxy/mcp-proxy.ts:200`、`:7474–7583`。
- 接线点：`webui/server/proxy/mcp-proxy.ts:4922–4998`（`buildMatchableSourcesForGate` → `checkSourceAmbiguityGate`）。
- 历史 UAT 证据：
  - `docs/qa/uat/suites/source-ambiguity-gate/runs/2026-11-14-claude-macmini-p0-post-upgrade.md:45–46`（SAG-01 PASS／SAG-02 BLOCKED）
  - `docs/qa/uat/suites/source-ambiguity-gate/suite.md:15`（SAG-02 列为可选）
  - `docs/qa/uat/suites/question-budget/runs/2026-11-15-cursor-p1-12-budget.md:18`
  - `docs/qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md:35`
- 合同条款：见 §3.1 表（spec 行号以 `docs/specs/lucy-20261107-source-ambiguity-gate-spec.md` v0.5 为准）。
