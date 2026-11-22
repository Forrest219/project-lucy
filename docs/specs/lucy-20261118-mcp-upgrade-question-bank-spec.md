# MCP 升级兼容多场景题库 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v1.0** |
| 日期 / 目标版本 | 2026-11-19／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-54**／REQ-030-075／**P0 底线的题库＋配置合同**。不入 0.30 核心分母 |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 状态 | **v1.0。终稿确权（委托人 2026-11-19 批准对抗复审修订并定稿；闭合 Cursor Round2／Kimi B1–B13 与 B15）。开发已授权（委托人 2026-11-22「开工，落地执行」；每 Wave 后 code review）。实现进行中（Wave 0 授权登记）。测试台沿用 `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`＝NOT RUN。≠ UAT PASS；≠ 可上线** |
| 决策来源 | 多场景题库独立成 Spec 并覆盖 Lucy Ops；全真须配合 Lucy 配置；2026-11-19 批准复审建议（配置前置、frozen 负例夹具、通用车道行隔离策略③＋proven 门②、Plan 归属拆分） |
| 父合同 | [P1-53](lucy-20261118-mcp-upgrade-compatibility-spec.md) **v1.1**；本 Spec＝题目语义＋CompatConfigProfile 正本；不另造放行阈值 |
| 配套 Plan | [lucy-20261118-mcp-upgrade-question-bank-plan.md](../plans/lucy-20261118-mcp-upgrade-question-bank-plan.md) |
| 评审 | [Kimi v0.2 评审](../reviews/2026-11-19-p1-54-question-bank-spec-plan-review.md)；[Cursor Round2](../reviews/2026-11-19-p1-54-question-bank-review-round2-cursor.md) |
| 关联合同 | [可问治理面](lucy-20261101-ops-evidence-askable-governance-spec.md)、[P1-49 Ops ACL 草案](lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md)、[P1-35](lucy-20261116-source-ambiguity-mcp-escape-spec.md)、[真实用户 E2E](lucy-20261018-enterprise-security-and-real-e2e-spec.md) |
| 测试台 | [`UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md) |
| 授权边界 | **终稿确权 ≠ 开发授权**。委托人 2026-11-22 已发「开工，落地执行」＝本 Plan 步骤 1–4 开发授权；不得改 P1-53 放行判定／发布接线；Docker 重建／出包另授；每 Wave 完成后 code review 再进入下一 Wave |

## 闭口层级

- 层级：功能合同
- 本条承诺：定义可由 ≥1 真实 Agent 经 Lucy Public MCP 执行的版本化题库，以及与之绑定的 CompatConfigProfile（连接、语义、Role、权限、多身份夹具）。无匹配配置指纹不得宣称全真可落地。
- 本条出口：SC-01–SC-24。文档与后续 schema 可机检；全真只认本 Spec 冻结 digest＋配置指纹。
- 不在本条出口：P1-53 执行器／发布接线／digest 判定器实现；修改现网客户 Role／Token；P1-49 heal 实现；打开产品默认 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`；客户生产验证；放宽父门禁；UAT PASS 宣称。
- 上线关系：本条收口不表示可上线（本条收口 ≠ 父门禁通过 ≠ 可上线）。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **题库（Question Bank）**：稳定问题集合及其连接、身份、轮次、oracle 与期望。（术语标准补登为 Follow-up，不阻塞本条终稿。）
- **CompatConfigProfile**：与题库 digest 绑定的连接／语义／Role／权限／夹具版本化集合（`configProfileId`／version／fingerprint）。
- **独立 oracle**：Agent 不可见的固定事实、独立 SQL／builder 或拒绝合同。
- **identity（题内身份）**：单题内一次执行所用的 Role／TokenRef／可选 constraints 与期望。
- **Ops W0／W1／W2**：同可问治理面。
- **frozen W0 负例 Role**：profile 内永不 heal 的只含 `ops_calls`／`ops_call_tables` 的夹具 Role；**不是**正式 `lucy_ops_reader`（避免 P1-49 翻面）。

Forbidden:

- 把 `token_label` 去重当 Token 人口；把连接 `enabled_tables` 说成 Role 已放行；把缺配置说成题库可选；用 `lucy_admin` 凑多库；把「Agent 口头说查不了」当权限拒绝 PASS；把 proven 门拒绝冒充行隔离成交。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/00-product-terminology-standard.md`
- [`lucy-20261101-ops-evidence-askable-governance-spec.md`](lucy-20261101-ops-evidence-askable-governance-spec.md)

### What This Change Follows

- [ ] 不新增 WebUI 页面、组件、样式或交互。
- [ ] 题目使用现有产品术语；保护 Agent、Token、MCP、Role、连接 ID、Source 名和工具名。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 将 CompatConfigProfile／题库／W0–W2 补入术语标准（或显式「仅 Spec 登记」豁免行）。
- 新增业务概念时先补术语标准再改题库。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；配置经既有 access／语义／连接机制落地。
- 不改变：路由、页面、按钮、空态、错误态、确认面与浏览器交互。

## 0. 落地前置（Normative）

> 全真须先有与题库绑定的 Lucy 配置。有题无匹配 fingerprint → **不具备落地条件** → 父门禁 **BLOCKED**，不得删题。

### 0.1 步骤位置

```text
P1-54 题目语义 + CompatConfigProfile 合同
  →（开发授权后）P1-54：profile 应用／还原脚本 + journeys.yaml 内容
  → P1-53：加载／digest／判定 + 开跑前 fingerprint 门禁（D27）
  → 真实 Agent 全真
```

### 0.2 CompatConfigProfile 必含

| 组件 | 最低内容 |
|---|---|
| 连接 | `demo-mysql`、`lucy-ops` |
| 语义 | superstore 三表＋已声明 join；ops 12 源覆盖题目引用 |
| 产品 Role 指纹 | `demo_readonly`、现行 `lucy_ops_reader`（盘点用；**不作永久 Source 负例载体**） |
| 受控夹具 | 无 `lucy_query`；表 A／B；字段暴露差分；**双连接只读编排**（禁 admin）；W1／W2 Source 放行；**frozen W0-only Role**（永久负例） |
| 行级策略（通用车道） | **不做行级成交隔离**（默认 proven=false 会撞 `row_policy_upstream_unproven`）。另设 proven 门看守题。行隔离成交归客户私有基线／既有行权限 UAT |
| 行级若启用（仅客户／另授 lab） | 单次 `lucy_query` 至多一个 protected source；demo 词表 East／Southwest；Role 须 v2＋`row_access` 且编译成功 |
| Ops | 扩展题 snapshot／投影就绪；W0 禁 `gov.*`；W1／W2 MCP 对照须含允许的窗口旋钮 |
| 生命周期 | 备份指纹→应用→用后还原；还原失败＝FAIL 并停 |

公共仓只存描述与非秘密路径；Token／密码不入库。

## 1. 盘点快照（2026-11-18；执行期须复验）

> 下列为本机 demo **盘点环境记录**，非永久合同端口。执行期以当时实例 fingerprint 为准。

| 对象 | 盘点事实 | 边界 |
|---|---|---|
| `demo-mysql` | gold `order_count=1000`、`total_sales=1459476.0953`；`order_year`∈{2024…2027}；`region`∈{East, Southwest, Central South, Northeast}；orders→returns／people join | 业务／过滤／时间窗 |
| `lucy-ops` | 启用 Source **恰好 12**（W0:2＋W1:4＋W2:6） | Ops／多库 |
| `demo_readonly`／`lucy_ops_reader`／`demo_ops` | 见 access 模板；W0 两表 | 合法路径；永久负例用 **frozen 夹具** 非 heal 后正式 Role |
| `lucy_admin` | `connections:["*"]` | 禁止凑绿 |

## 2. 题库合同（Normative）

| ID | 决策 | 裁定 |
|---|---|---|
| D1 | 正本 | Spec＝语义；`journeys.yaml`＝P1-54 维护的可执行实例；P1-53 只加载／校验／digest |
| D2 | 真实执行 | ≥1 真实 Agent＋Public MCP |
| D3 | 独立 oracle | 禁 Agent 自证；evals/golden 仅参考口径，数值以 demo baseline 为准 |
| D4 | 覆盖 | §4 全必做；Ops 不得只留 W0 |
| D5 | 连续会话 | 同 Agent 会话；逐轮计时 |
| D6 | 多库 | 受控双连接编排；禁 admin |
| D7 | 权限成对 | 每负例有合法对照；多身份见 `identities[]` |
| D7a | 拒绝形态 | 负例 PASS ⊇ 显式 `tools/call(lucy_query)`（或等价）＋稳定拒绝码＋审计 deny＋零上游。「仅 list 缺工具／口头拒答」≠ PASS |
| D8 | 夹具 | 扩展／差分／永久负例经 profile；合法成交不伪造前置 |
| D8a | P1-49 | heal 不得替代 frozen W0 负例；正式 Role heal 后 allow 可另开烟测，不占 COMPAT-07 永久分母 |
| D9 | 动态 | 同锚点独立对账；unready／partial 不伪 0 |
| D10 | gov | W0 禁任何 `gov.*`。W1／W2：**题库纪律**要求 MCP 对照含允许窗口旋钮（`gov.calendar_days∈{7,30}` **或** `gov.window_hours∈{24,168}` **或** 显式 ISO 半开窗；互斥规则同产品）。映射为 `lucy_query.filters[]`，非虚构顶层 `gov` 对象 |
| D11–D13 | 人口／高基数／事故 | 同 v0.2 |
| D14 | 拒绝 | 明确、零越权、无误导下一步 |
| D15 | 空结果 | 合法零行≠错误 |
| D16 | 耗时 | `budgetClass`；阈值归 P1-53 |
| D17 | 隐私 | 无秘密入库 |
| D18 | 变更 | 改题／oracle／身份／配置形状 → 升 digest／fingerprint |
| D19 | 配置前置 | 无匹配 profile → BLOCKED |
| D20 | 分母 | 场景 PASS＝§5 映射的全部 QB（含其全部 identities 跑次）PASS |
| D21 | 窗口锚点 | W0：`windowAnchor.maxCallDay`＝该身份可见 `ops_calls` 最大 UTC `call_day`；含端点取 N 自然日；缺日＝0 行合法。W1／W2：以治理窗为准，UTC `call_day` 仅披露 |
| D22 | 行级通用车道 | 不要求行隔离成交；设 proven 门看守题。客户／lab 行隔离另层 |
| D23 | 证据字段 | 与 P1-53 对齐：`mcpClientRttMs[]`、`serverDurationMs[]`；W0 `snapshotId` 可为 null，改记 `windowAnchor` |

## 3. 可执行题目结构

```yaml
id: QB-ACL-01
version: 1
lane: controlled-fixture
configProfileId: lucy-mcp-compat-demo
mapsTo: [COMPAT-07]
turns: [{ text: "查询订单销售额" }]
agentRequirements: { publicMcp: true, sameSession: false }
identities:
  - id: deny_no_query
    role: compat_fixture_no_lucy_query
    tokenRef: env:COMPAT_TOKEN_NO_QUERY
    expect:
      outcome: deny
      requireToolsCall: true
      reasonFamily: tool_forbidden
      upstreamExecutions: 0
  - id: allow_readonly
    role: demo_readonly
    tokenRef: env:COMPAT_TOKEN_READONLY
    expect: { outcome: allow }
runsByIdentity: [deny_no_query, allow_readonly]
connectionIds: [demo-mysql]
sources: [superstore_orders]
mcpControls:
  - identity: allow_readonly
    begin: <摘要>
    query:
      filters: []                 # W0：不得含 gov.*
      # W1/W2 例：
      # filters: [{ field: "gov.calendar_days", op: "eq", value: 7 }]
oracle: { kind: deny | exact | independent-query | invariant | privacy, ref: <...> }
budgetClass: denial
evidence:
  - requestId
  - traceId
  - turnWallClockMs
  - mcpClientRttMs
  - serverDurationMs
  - configProfileFingerprint
  - windowAnchor            # W0；snapshotId 可 null
```

`identities`／`runsByIdentity` 为多身份题必填；单身份题可省略 `runsByIdentity`（默认唯一 identity）。

## 伪代码豁免

- 原因：本条声明题目、oracle、身份与配置形状；加载／判定／发布状态机归 P1-53。
- 边界：Plan 给出 profile 应用／还原与 YAML 内容步骤；不得改写 P1-53 核心流程。

## 4. 必做题库

### 4.1 独立业务与事故同形

| ID／映射 | 问题 | oracle |
|---|---|---|
| **QB-BIZ-01**／COMPAT-01 | 「查询 superstore_orders 的订单数和销售总额。」 | `order_count=1000`、`total_sales=1459476.0953` |
| **QB-BIZ-02a**／COMPAT-02 | 「按区域统计订单数和利润率，亏损行也要算。」 | 分组；COUNT DISTINCT；SUM/SUM |
| **QB-BIZ-02b**／COMPAT-02 | 「查询 1900 年订单销售额。」 | 合法空 |
| **QB-BIZ-02c**／COMPAT-02 | 「查询 2025 年订单销售额。」 | 时间窗；独立 SQL |
| **QB-BIZ-02d**／COMPAT-02 | 「查询 Furniture 品类的订单数。」 | 过滤；`category='Furniture'` |
| **QB-BIZ-03**／COMPAT-09＋ESC-11 | 会员收入同形 begin＋钉选 query | 首次不得 `source_ambiguity_gate` |

### 4.2 连续追问与多表

| ID／映射 | 同一会话轮次 | oracle |
|---|---|---|
| **QB-FOLLOW-01**／COMPAT-03 | ①「查询 2025 年 11 月订单销售额」②「那 12 月呢？」③「和上月相比呢？」 | 同指标；环比独立 SQL；同会话 |
| **QB-FOLLOW-02**／COMPAT-04 | ①「查询 2025 年 11 月销售额」②「再按区域拆分」③「各区域利润率呢？」 | 保留月份／区域／SUM/SUM |
| **QB-FOLLOW-03**／COMPAT-05 | ①订单销售额②关联退货③按区域负责人 | 已声明 join；不丢路径 |
| **QB-JOIN-01**／COMPAT-05 | 「按区域统计订单销售额、退货量和区域负责人。」 | join SQL／粒度对账 |
| **QB-JOIN-02**／COMPAT-05 | 「把订单和不存在的表关联，返回销售额。」 | 未知引用拒绝；无误导下一步 |

### 4.3 多库与权限

| ID／映射 | 场景 | 期望 |
|---|---|---|
| **QB-DB-01**／COMPAT-06 | 双连接夹具：分查 demo-mysql 与 lucy-ops 并对比 | 分别成交；身份≠ admin |
| **QB-DB-02**／COMPAT-06 | 非法跨连接 join | 拒绝＋拆分下一步 |
| **QB-ACL-01**／COMPAT-07 | identities：无 `lucy_query` ＋ 合法对照 | D7a；成对 |
| **QB-ACL-02a**／COMPAT-07 | `demo_readonly` 问 lucy-ops | 拒绝＋D7a |
| **QB-ACL-02b**／COMPAT-07 | `demo_ops` 问 superstore | 拒绝＋D7a |
| **QB-ACL-02c**／COMPAT-07 | **frozen W0-only 夹具 Role** 问 `ops_agents` | 未放行 Source→拒绝；**不绑**可 heal 的 `lucy_ops_reader` |
| **QB-ACL-03a**／COMPAT-08 | 表 A 可见／B 不可见 | 成对 |
| **QB-ACL-03b-gate**／COMPAT-08 | 故意造 scoped 行收窄（单 source）后 `lucy_query` | 断言 `row_policy_upstream_unproven`（proven 门看守；**不是**行隔离成交） |
| **QB-ACL-03c**／COMPAT-08 | 字段暴露差分两身份 | 隐藏字段不出现；合法字段可用 |

> 通用车道**无**「East 身份成交且只含 East 行」题。客户私有基线层可另验行隔离成交。

### 4.4 Ops W0

| ID／映射 | 问题 | oracle |
|---|---|---|
| **QB-OPS-01**／COMPAT-OPS-01 | 「近 7 天每个工具的调用次数和拒绝次数？」 | `ops_calls`；UTC；**D21 锚点** |
| **QB-OPS-02**／COMPAT-OPS-02 | 「近 7 天哪张表调用最多？」 | `ops_call_tables`；同锚点 |
| **QB-OPS-03a/b**／COMPAT-OPS-03 | 追问拒绝原因／过滤后 `generated_sql` | 同会话；禁默认高基数分组 |
| **QB-OPS-04**／COMPAT-OPS-04 | 新鲜度 | `lucy_freshness` |
| **QB-OPS-05**／COMPAT-OPS-05 | 「各 Agent 的 token_label 调用量？」 | **钉 `ops_calls` 按 (agent_id,token_label)**；≠ `ops_tokens` 口径；不要求 Token 人口 |

### 4.5 Ops W1／W2（夹具＋filters 含窗口旋钮）

| ID／映射 | 问题 | oracle |
|---|---|---|
| **QB-OPS-05b**／COMPAT-OPS-05 | token_label 用量（问数归因） | **`ops_tokens`**；带 gov 窗 |
| **QB-OPS-06**／COMPAT-OPS-06 | 配置 Agent／可用 Token | `ops_agents.agent_count`／`available_token_count` |
| **QB-OPS-07a**／COMPAT-OPS-07 | 「在 gov.calendar_days=7（上海）窗内哪些 Agent 有访问？」 | 治理窗为准；披露 UTC `call_day` |
| **QB-OPS-07b**／COMPAT-OPS-07 | 沉默 Agent | 配置−活跃；禁「从未连接」 |
| **QB-OPS-08…11**／COMPAT-OPS-08…11 | MECE／路径／未访问／覆盖率 | 同可问治理面；builder 对账 |

## 5. COMPAT ↔ QB 分母表

| 场景 | 必含 QB |
|---|---|
| COMPAT-01 | QB-BIZ-01 |
| COMPAT-02 | QB-BIZ-02a、02b、**02c、02d** |
| COMPAT-03…05 | FOLLOW-01…03、JOIN-01…02 |
| COMPAT-06 | QB-DB-01、02 |
| COMPAT-07 | ACL-01、02a、02b、**02c（frozen）** |
| COMPAT-08 | ACL-03a、**03b-gate**、03c |
| COMPAT-09 | QB-BIZ-03（＋客户私有层归 P1-53） |
| COMPAT-10–12 | 复用首轮／计时／回放（P1-53） |
| COMPAT-OPS-01…04 | OPS-01…04 |
| COMPAT-OPS-05 | OPS-05 **与** OPS-05b |
| COMPAT-OPS-06…11 | OPS-06…11 |

## 6. 冷启动、耗时与回滚

冷启动首轮取 BIZ-01、FOLLOW-01、OPS-01。PRE／POST／ROLLBACK 同题、同客户端指纹、**同 config fingerprint**。预算归 P1-53。

## 7. 证据与隐私

每轮：题 ID、identity id、Agent／模型指纹、连接／Source、Role／Token 指纹、`configProfileFingerprint`、`snapshotId|null`、`windowAnchor`（W0）、请求／trace、`mcpClientRttMs[]`、`serverDurationMs[]`、oracle、判定。夹具还原失败即停。

## 8. 验收（SC）

| ID | 标准 |
|---|---|
| SC-01 | 每题字段完整；含 identities（多身份题）；YAML↔Spec |
| SC-02 | §4＋§5 分母完整 |
| SC-03 | CompatConfigProfile 形状完整；缺包不可落地 |
| SC-04 | BIZ-01／02a–d gold／空／窗／过滤正确 |
| SC-05 | 追问同会话 |
| SC-06 | join／未知 join |
| SC-07 | 多库夹具；未用 admin |
| SC-08 | ACL 成对；02c＝frozen；03b-gate＝proven 码；03c＝字段差分 |
| SC-09 | 事故同形 |
| SC-10 | W0 OPS-01–05；禁 gov.*；D21 锚点 |
| SC-11 | W1／W2 仅夹具；filters 含窗口旋钮；还原 |
| SC-12–14 | 时区／人口／高基数／独立 oracle |
| SC-15 | 同配置指纹；缺配置 BLOCKED |
| SC-16 | 证据字段对齐 P1-53；W0 snapshot 可 null |
| SC-17 | 分层事故负控 |
| SC-18 | 无秘密；还原失败即停 |
| SC-19 | digest／fingerprint 变更作废旧证 |
| SC-20 | 文档 lint；与 P1-53 勾连；close-layer 字面合规 |
| SC-21 | OPS-05≠人口；OPS-05b＝ops_tokens |
| SC-22 | §5 映射机检（含 identities 跑次） |
| SC-23 | D7a：负例须 tools/call＋拒绝码＋零上游 |
| SC-24 | journeys.yaml **内容**归本条；加载／digest 归 P1-53；profile 脚本归本条 |

## 9. 主路径可用性自检

| # | 答 |
|---|---|
| 合法成交？ | 业务／多表／多库／W0／W1／W2 均有合法题 |
| 逃生？ | 不新增产品门禁；夹具配合法对照 |
| 约束＋成交？ | 是；proven 门与行隔离成交分开 |
| BLOCKED 掩盖？ | 缺配置＝BLOCKED 且不删题 |

## 10. 版本

`questionBankId=lucy-mcp-upgrade-question-bank`；`configProfileId=lucy-mcp-compat-demo`。首版 version=1。P1-53 只接受声明的 id＋version＋digest＋requiredConfigFingerprint。

## 11. 开放项

| ID | 项 | 状态 |
|---|---|---|
| O1 | 双连接夹具最小工具集名单 | 开发授权后冻结 |
| O2 | 客户私有 profile 仓外落位 | 随 P1-53 私有基线 Runbook |
| O3 | P1-49 heal | **不**替代 frozen W0 负例（已闭合原则） |
| O4 | lab 开 proven 做行隔离成交 | **未授权**；须委托人另批环境变体 |
| O5 | 术语标准补登 | Follow-up |

## 12. 变更记录

| 版本 | 内容 |
|---|---|
| v0.1-draft | 入池；盘点；业务＋Ops |
| v0.2-draft | 配置前置；禁 admin；East／Southwest；gov 分立 |
| **v1.0** | **终稿确权（暂不开发）**：close-layer；identities；COMPAT-02 四题；D7a；frozen 02c；行级③＋03b-gate；D21／gov filters 映射；OPS-05／05b；证据字段对齐；Plan 归属 SC-24 |
