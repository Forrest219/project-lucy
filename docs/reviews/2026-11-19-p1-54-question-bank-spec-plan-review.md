# P1-54 题库 Spec／Plan v0.2 评审

> **状态**: Review（未实施任何修复；未改运行代码、未改执行器／权限／数据）
> **日期**: 2026-11-19
> **范围**: [`docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md`](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) **v0.2-draft**；[`docs/plans/lucy-20261118-mcp-upgrade-question-bank-plan.md`](../plans/lucy-20261118-mcp-upgrade-question-bank-plan.md) **v0.2-draft**；共享测试台 [`docs/qa/uat/suites/mcp-upgrade-compatibility/`](../qa/uat/suites/mcp-upgrade-compatibility/suite.md)；父合同 [P1-53 v1.1](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)
> **基准**: [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)（落盘清单 16 条／状态镜像／主路径可用性优先）；`webui/docs/00-product-terminology-standard.md`
> **影响等级**: 高（B1 一提交即门禁转红；B2 会让一条必做负例在 P1-49 落地后必然翻面；B3 留有空过路径）
> **交接**: 给 Cursor 的对抗式审阅委托见 [`inbox/20261119-p1-54-question-bank-review-brief-for-cursor.md`](../../inbox/20261119-p1-54-question-bank-review-brief-for-cursor.md)（本记录为待审阅的**一版意见**，不是定论）

---

## 1. 审阅方法

以**运行时代码与真实数据取证**为主，不依赖通读印象：

| 取证手段 | 说明 |
| --- | --- |
| 形态门禁 | `npm run lint:spec-docs`、`npm run lint:spec`、`npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:e2e-ledger` 实跑 |
| 门禁规则回读 | `scripts/lint-spec-docs.mjs` 的 `collectCloseLayerViolations` 逐条比对，并用同规则脚本模拟"修好第 1 处后第 2 处是否触发" |
| 语义层／连接契约回读 | `webui/server/ops-evidence/contract.ts`（W0／W1／W2 冻结名单）、`webui/server/ops-evidence/gov-filters.ts`（`gov.*` 白名单与窗口）、`webui/server/admin/metric-window.ts`（治理窗时区）、`webui/server/proxy/mcp-proxy.ts`（`gov.*` 剥离与 snapshot 注入）、`webui/server/proxy/acl.ts`（v2 `row_access` 约束） |
| 真实数据对账 | `examples/docker-demo/mysql/_baseline.json`（gold 值、region 词表、年份分布）、`semantic-layer/demo-mysql/superstore_orders.yaml`（measures／joins）、`examples/docker-demo/project-template/webui/config/access.yaml`（`demo_readonly`／`lucy_ops_reader`／`lucy_admin` 实际权限） |
| 跨 Spec 依赖回读 | P1-49 [`lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md`](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md) |
| 变更面比对 | `git diff` 本轮已跟踪文件（测试台三件套、P1-53 Spec／Plan、三台账），核对"v0.2 修订是否全量传导" |

---

## 2. 结论摘要

**方向认同，条款与形态反对。** v0.2 的修订方向是对的，而且抓住了本条最关键的现实约束（题库必须与 Lucy 配置资产包绑定才能落地）；但当前文本仍有 **2 处一提交即阻塞的形态违规**、**1 条必做负例会在半年内必然翻面**、**2 处分母／形状小于可实现口径（空过路径）**、**2 处权限负例在实现时必踩已知坑**、**1 处跨 Plan 归属重叠**。

| # | 严重度 | 问题 | 影响面 |
| --- | --- | --- | --- |
| **B1** | 阻塞 | 形态门禁 `close-layer` 两处违规（层级取值／上线关系字面），文件一旦 `git add` 即 exit 1 | CI 门禁转红 |
| **B2** | 阻塞（内容） | P1-49 落地会让 QB-ACL-02c 的"未放行 Source → 拒绝"由 deny 变 allow | D7 判负；指纹漂移致旧证据失效 |
| **B3** | 高 | COMPAT-02 分母（2 题）小于测试台步骤要求（4 类题各至少一题） | 场景空过 |
| **B4** | 高 | W0 负例未定义"拒绝形态"，`tools/list` 已按角色过滤 ⇒ "工具不存在"可冒充权限拒绝 | 权限负例空过 |
| **B5** | 高 | 行级夹具在默认环境跑不通：任何行级收窄（Role `row_policy` 或 Agent `constraints`）都撞 `row_policy_upstream_unproven` 门（proven 默认 false） | QB-ACL-03b 验证的不是行隔离；三条修法须合同写死 |
| **B6** | 中 | Ops 题"近 7 天"缺确定性锚点；W1 "7 个 UTC 日"撞治理窗 Asia/Shanghai 口径 | oracle 咬人，误判 FAIL |
| **B7** | 中 | §3 YAML 的 `gov` 字段与真实 `lucy_query.filters` 数组形状／白名单不一致 | 执行器需自造映射；Plan 失败测试会误判合法题 |
| **B8** | 中 | QB-OPS-05 放 W0 与运维 SOP 路由（`ops_tokens` 属 W1）冲突 | 题目跑不通或静默改口径 |
| **B9** | 中 | v0.2"行权限改 East／Southwest"只改了测试台摘要表，步骤正文仍是"华东／西南" | 测试台指导用错词表 |
| **B10** | 低 | §3 `evidence` 字段名 `mcpRttMs` 与父合同 `mcpClientRttMs[]` 漂移 | 执行器需做隐式映射 |
| **B11** | 低 | "约 12 个启用 Source" 实为精确 12；§1 混入本机临时端口 | 表述精度 |
| **B12** | 高 | §3 YAML 无"身份"维度，多身份题（成对对照、双 Token、行级两身份）无法表达 | SC-01／SC-22 与 §5 机检不可实现 |
| **B13** | 高 | `mcp-upgrade-journeys.yaml` 被两条 Plan 同时声明 Create；profile 应用脚本归属未写死 | 实现期撞车／D27 无人负责 |

**建议**：v0.2-draft 保持不确权；修 B1–B5、补 B6–B9 → v0.3-draft → 再走终稿确权。**开发授权仍另发**；本轮未改运行代码、未改执行器／权限／数据。

---

## 3. 认同项（附理由）

### A1. 配置资产包前置（§0／D19）是本轮最重要的修订，方向正确

- **现实约束成立**：题库本身不含可执行权限。demo 侧 `lucy_ops_reader` 只放行 `ops_calls`／`ops_call_tables`（`examples/docker-demo/project-template/webui/config/access.yaml:30-54`），W1／W2 的 10 个源不在任何现有角色的表选择器里；`demo_readonly` 只覆盖 demo-mysql 三表（同文件 `:2-13`）。没有 profile，QB-ACL-02c、QB-OPS-06…11 在物理上无解。
- **未制造第二套阈值**：父合同 P1-53 v1.1 的 D27／SC-25 强制消费指纹并把缺包判 BLOCKED，与本条 §0／D19 一致；P1-53 §3 的"题目语义／可执行实例／Lucy 配置"三层正本指向清晰。
- **治理语义正确**：缺配置判 BLOCKED 而非"删题凑绿"，拦的是"无证据的放行"，不是"合法用户的主路径"；§9 自检第 4 问写对了。

### A2. 禁止 `lucy_admin` 凑多库（D6／SC-07）正确

`lucy_admin` 的 `allow.connections: ["*"]` ＋ `source_scope: catalog_bound`（`access.yaml:56-62`）。用它跑多库题只能证明"高权能看"，证明不了"分连接授权后各连接分别成交"，更掩盖了跨连接混查是否被正确拒绝。D6 要求"受控双连接编排"，更接近客户现场形态（不同部门不同 Token）。

### A3. 行权限改用 demo 真实词表 East／Southwest 正确

demo region 实际取值为 `East / Southwest / Central South / Northeast`（`examples/docker-demo/mysql/_baseline.json` 的 `sales_by_region`）。用"华东／西南"造夹具等于造库里不存在的值，oracle 与产品行为都无法对账。

### A4. W0／W1 的 `gov.*` 分立（D10）有代码依据

`webui/server/ops-evidence/gov-filters.ts:155-167`：legacy 源（`ops_calls`／`ops_call_tables`）出现任一 `gov.*` 直接 `invalid_arguments`；治理源才解析 `gov.*` 并物化 snapshot。`webui/server/proxy/mcp-proxy.ts:4519` 一带只对治理源注入 `snapshot_id`。故"W0 禁 `gov.*`、W1／W2 必带 `gov.*`"确为两条不同执行路径，不是拍脑袋。

### A5. Ops 分母表（§5）与代码的源—车道映射完全对得上

`webui/server/ops-evidence/contract.ts:34-52` 的 W0（2）／W1（4）／W2（6）与 §4.4／§4.5 的 12 个源逐一对上；§4.5 每题 oracle 列（`agent_count`／`available_token_count`、`window_unvisited`／`activity_rate`、`confirmed_unauthorized`／`orphan_grants`、`coverage_ratio`／`denied_calls`）在 `semantic-layer/lucy-ops/_schema/main.yaml` 中都有对应物理列。

### A6. §4 业务题的 gold 与语义层口径一致

`order_count=1000`／`total_sales=1459476.0953` 与 `examples/docker-demo/mysql/_baseline.json` 的 `measures` 一致；`order_year∈{2024…2027}` 与 `sales_by_year` 一致；QB-BIZ-02a 要求 `COUNT(DISTINCT order_id)`、利润率 SUM/SUM，与 `semantic-layer/demo-mysql/superstore_orders.yaml:16-30` 的 measure 定义一致；QB-FOLLOW-03／QB-JOIN-01 依赖的 orders→returns／people join 已在同文件 `:45-54` 声明。

---

## 4. 反对项（必修）

### B1【阻塞·形态】两处 `close-layer` 违规，一提交即 exit 1

`npm run lint:spec-docs` 现输出：

```
WARN — 以下文件尚未被 git 跟踪（未 git add），形态违规不阻塞本工作树；一旦 git add 或提交即转为阻塞项：
  docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md [close-layer] 「闭口层级」的层级只能是「功能合同」或「发布取证」之一
```

规则在 `scripts/lint-spec-docs.mjs`：`:288` 要求层级取值**恰好**等于 `功能合同`／`发布取证`；`:299-303` 要求功能合同的"上线关系"**字面**包含 `本条收口不表示可上线`。

现状（Spec `:18`、`:22`）：

- 层级＝`功能合同（题库内容 **＋** 配套 Lucy 配置资产包形状）` → 取值不合法。
- 上线关系＝`本条收口 ≠ 父门禁通过 ≠ 可上线。` → **不含**字面 `本条收口不表示可上线`。

已用同规则脚本模拟验证：把层级改回 `功能合同` 后，第 2 条立即触发（当前因第 1 条先失败而被短路掩盖）。修法：层级写 `功能合同`（副标题内容移入"本条承诺"行）；上线关系写 `本条收口不表示可上线（本条收口 ≠ 父门禁通过 ≠ 可上线）`。

> 同一次 lint FAILED 的另一组报错来自 `docs/plans/lucy-20261118-ff4762c9-upgrade-blocker-integration-plan.md`（他人未跟踪草稿：未索引、缺 Plan 小节、缺头部字段），与 P1-54 无关，**不由本条代改**。

### B2【阻塞·内容】P1-49 落地会让 QB-ACL-02c 的负例翻面，P1-54 未登记这条依赖

- 本条把"当前 Role 仅 W0 两表"当作不变前提：Spec `:109`（`lucy_ops_reader`／`demo_ops` 仅 W0 两表）、`:93`（§0.2 当前 Role 指纹可核验）、`:127`（D10 W0 禁 `gov.*`）、`:197`（QB-ACL-02c「当前 `demo_ops` 问 `ops_agents` → 未放行 Source → 拒绝」）。
- 同产品线的 [P1-49](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md) D0＝B 的方案明确：ensure 命中"规范 W0 指纹"时把 `lucy_ops_reader.names` 幂等升为冻结全集（`:26`、`:119-121`），并把 demo 模板改为全集（`:133`）。
- 后果：`demo_ops`（绑 `lucy_ops_reader`）即可合法问 `ops_agents` → QB-ACL-02c 由 deny 变 allow → 按 D7"deny→allow＝FAIL"判负；同时 §0.2"当前 Role 指纹"漂移 → `configProfileFingerprint` 变 → D18"旧证据失效"。

**修法**：①QB-ACL-02c 的身份不得依赖"当前 `demo_ops`"，必须钉死为 profile 内受控夹具 Role（frozen fingerprint）；②在 §11 开放项或依赖登记中显式登记 P1-49 耦合——O3（Spec `:306`）只答了"heal 是否替代 W1／W2 夹具"，没答"heal 会让 W0 负例翻面"。

> 现状不矛盾：P1-49 状态为 v0.1-draft、未获开发授权。但这是"今天不成立、方向已错"的账，须在确权前登记。

### B3【高】COMPAT-02 分母小于测试台步骤要求，存在空过路径

- 测试台 [cases.md:68-72](../qa/uat/suites/mcp-upgrade-compatibility/cases.md) 的 UAT-COMPAT-02 步骤 1 要求"带时间窗、带过滤、带分组、故意合法空结果**各至少一题**"（4 类独立问）。
- 本条 §5（Spec `:232`）COMPAT-02 只映射 `QB-BIZ-02a`（分组）、`QB-BIZ-02b`（合法空）**两题**；既无"过滤"题，也无独立"时间窗"题（时间窗只出现在 QB-FOLLOW-01 的追问里）。
- 叠加 D20（Spec `:137`）"场景 PASS＝其所映射全部 QB 题 PASS"，COMPAT-02 可以在只跑 2 题的情况下判 PASS —— 与测试台步骤不自洽，正是本门禁要防的空过。

**修法**：§4.1 补"过滤"与"时间窗"两类独立题（用 demo 真实维度，如 `category='Furniture'`、`order_year=2025`），§5 分母表同步。

### B4【高】W0 负例未定义"拒绝形态"，"工具不存在"可冒充权限拒绝

- 代理在 `tools/list` 按角色编译后的权限过滤工具（`webui/server/proxy/mcp-proxy.ts:3958` 一带 `compileRole`／`effectivePermissions` 路径）。"无 `lucy_query` 角色"在 `tools/list` 里本就看不到该工具。
- 若负例只写"自然语言问一句"，Agent 会直接回答"我查不了"，**全程未触发任何 Lucy 权限判定**，而 oracle（`kind: deny`）却看起来满足。这条负例等于没测。
- 本条 D7（`:124`）只要求"deny→allow／越权／泄露＝FAIL"，未要求"必须存在权限拒绝证据"。

**修法**：QB-ACL-01（及 QB-ACL-02c）合同写死"必须显式发起 `tools/call(lucy_query)`"，oracle 收紧为"明确的权限拒绝响应 ＋ 审计 `authorization_status=denied` ＋ 上游零执行"；"工具不在 `tools/list` 里"不得计为 PASS。

### B5【高】行级夹具在默认环境根本跑不通：任何行级收窄都撞"上游强制谓词未证明"门

QB-ACL-03b（行级 East vs Southwest）、QB-ACL-03c（字段暴露差分）要求受控夹具身份，并期望"只含授权 region；禁串区"＝**成功成交且行集受限**。但按现有实现，这个期望在默认环境达不成：

- 任一路径的行级收窄都会变成同一个 `RowGrant(scoped)`：Role 侧 `row_policy` 与 Agent 侧 `constraints` 最终都汇入 `finalRows`（EffectiveRowGrant **AND** Constraints，见 `webui/server/proxy/acl.ts:3502-3507` 与 `webui/server/proxy/agent-constraints.ts:379-383` `synthesizeFinalRows`）。
- `finalRows.kind === "scoped"` 的源会被登记为 `protectedSources`；此时 `lucy_query` 先过形状门，再过 proven 门：`acl.ts:3527` → `row_policy_upstream_unproven`。
- proven 门**默认关闭**：`webui/server/proxy/row-policy.ts:74-79` —— `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 只有 `1`/`true`/`TRUE` 才为真；`docs/access-control/uat-ac-p1.md:17`、`:78` 同样记着"产品默认与当前 UAT 环境仍为 `false`"。
- 另有一条形状限制：`acl.ts:3529-3531` —— `protectedSources.length > 1` → `row_policy_query_shape_forbidden`（一个角色不能同时收窄两个源）。

**后果**：按 §0.2（Spec `:94`）"受控夹具 Role …… 行级（demo 用真实 `region` 值）"造夹具，QB-ACL-03b 拿到的不是"只含 East 的行"，而是 `row_policy_upstream_unproven` 拒绝；题目要么误判为"行隔离生效"，要么把 proven 门的拒绝当成行隔离证据 —— 测的根本不是行权限。

另外顺带踩到两条已登记的坑：demo 的 `demo_readonly` 无 `permission_model_version`（`npm run lint:spec` 现即该 WARN）⇒ v1 角色，不能 PATCH 升 scoped（`docs/access-control/plans/20260809-single-deploy-landing-plan.md:44`）；v2 下每张表必须声明 `row_access`，否则角色编译失败 `v2_row_access_required`（`acl.ts:1122-1131`）；Role×Agent 同表是 AND，值不同 → `final_rows_unsatisfiable`（`docs/reviews/2026-11-15-row-policy-core-scenario-claude-r3.md:25`）。

**修法（三选一，须在合同里写死）**：
1. 把"上游强制谓词已证明（`LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`）"列为 CompatConfigProfile 的**环境级前置**（§0.2 最低内容加一行），并在 §7 证据里记录该开关值 —— 但这会改变产品默认行为，属另开条目，须委托人明示；
2. 把 QB-ACL-03b 的 oracle 改成"断言 `row_policy_upstream_unproven` 拒绝形态" —— 诚实，但它验证的是 proven 门，不是行隔离，且与 SC-08「行级用 East／Southwest 等真实词表」的意图不符；
3. 放弃行级成交题，改用**字段暴露差分**（QB-ACL-03c，字段级不依赖行收窄）覆盖"最小可见面"，把行级隔离留给客户私有基线层（§5 的 COMPAT-09 私有层）。

无论选哪条，§0.2 的受控夹具行都要写明"角色／Agent 编译成功"与"行级收窄的实际形态"，Plan 步骤 1（Plan `:32`）的验证列同步。

### B6【中】Ops 题的"窗"缺确定性锚点；W1 的 UTC 日与治理窗时区打架

- W0（legacy）源既不注入 snapshot 也不注入窗，"近 7 天"只能由 Agent 自己按 `call_day` 算；§4.4 的 oracle 只写"UTC `call_day`"，未写"以哪一日为终点、含不含当日、缺日如何计"。数据里未必每天都有调用，答案形状会漂。
- QB-OPS-07a「过去 7 个 UTC 日」撞另一个口径差：治理窗是 `buildCalendarDayWindow(n, Asia/Shanghai)`（`gov-filters.ts:147`、`:308`；`metric-window.ts:25` `GOVERNANCE_CALENDAR_TZ`），而 `ops_agent_activity.call_day` 是 UTC 日期。7 个上海日历日 ≠ 7 个 UTC 日，边界会多／少一天。

**修法**：每个 Ops 题的 oracle 写死窗口锚点（建议"以快照内最大 `call_day` 为终点、含当日、取 N 个自然日"）与时区披露要求；QB-OPS-07a 要么改措辞，要么把 oracle 写成"治理窗内的 UTC `call_day` 集合"。

### B7【中】`gov` 的 YAML 形状与真实 API 不是一回事

- §3 YAML（Spec `:153-155`）用单字段 `gov: null` / `gov: {...}` 表达；真实 API 是 `filters: [{field:"gov.calendar_days", op:"eq", value:30}]` 数组，且支持多个旋钮（`gov.window_hours`／`gov.calendar_days`／`gov.calendar_tz`／`gov.start_iso`+`gov.end_iso`／`gov.trust`／`gov.focus_*`）。
- 取值有白名单：`gov.calendar_days ∈ {7,30}`、`gov.window_hours ∈ {24,168}`；窗口类互斥（`gov-filters.ts:19-20`、`:278-285`）。
- Plan 步骤 4 的失败测试（Plan `:44`）写死 `"W1/W2 missing gov.calendar_days => FAIL"`，会把"24 小时窗"这类合法题判错。

**修法**：§3 补 YAML↔`lucy_query.filters` 映射段（字段名／op／value／白名单）；D10 与 Plan 测试改为"缺 gov 窗口旋钮 FAIL"，而非"缺 `calendar_days` FAIL"。

### B8【中】QB-OPS-05 放 W0 与运维 SOP 路由冲突

运维 SOP 明确"Token 用量以问数 `(agent_id, token_label)` 为准"，对应源是 `ops_tokens` —— 而 `ops_tokens` 是 **W1**（`contract.ts:37-42`；`skills/lucy-ops/ops-questioning.md:13,63,66`）。QB-OPS-05 置于 §4.4 W0 车道（Spec `:211`），Agent 读到 SOP 会去查 `ops_tokens` → 在 W0 身份下被拒 → 题目跑不通，或静默改用 `ops_calls` 分组（口径不同：`ops_tokens` 是窗口内快照口径）。

**修法**：§4.4 oracle 明确"本问以 W0 `ops_calls` 按 `(agent_id, token_label)` 分组"并说明与 `ops_tokens` 的关系；或在 §4.5 增设 `ops_tokens` 的 W1 题承接该口径。

### B9【中】v0.2"行权限改 East／Southwest"只改了测试台摘要表，步骤正文没改

[cases.md:149](../qa/uat/suites/mcp-upgrade-compatibility/cases.md) 仍是"行权限（通用可用合成**华东／西南**夹具；客户用既有 Role）"，而同文件摘要表与 [fixtures.md:12](../qa/uat/suites/mcp-upgrade-compatibility/fixtures.md) 已改为 East／Southwest（fixtures 并明写"非「华东／西南」"）。测试台是执行台账，步骤正文会真的指导用错词表 —— 正好撞上 Plan 步骤 4 那条 `region vocabulary must be East/Southwest not 华东/西南` 失败测试。

**修法**：同步 `cases.md:149`。

### B10【低】证据字段名与父合同漂移

§3 YAML 的 `evidence: [..., mcpRttMs, ...]`（Spec `:159`）；P1-53 §5 的现值字段是 `mcpClientRttMs[]`／`serverDurationMs[]`。D1 声明 YAML 是可执行实例、P1-53 只认声明字段，命名不一致会逼执行器自造映射。**修法**：§3 直接采用父合同字段名。

### B11【低】表述精度

- §1（Spec `:107`）"共约 12 个启用 Source" —— 冻结源恰为 12 个（W0 2 ＋ W1 4 ＋ W2 6，`contract.ts:34-52`），"约"可删。
- §1（Spec `:102`）把本机临时端口（`127.0.0.1:55176`／`57881`）写进 Normative 章节的盘点表，宜标注为"盘点环境，非合同"。

### B12【高】§3 的 YAML 形状没有"身份"维度，多身份题无法表达

§3 YAML（Spec `:141-160`）的字段是 `id`／`version`／`lane`／`configProfileId`／`mapsTo`／`turns`／`agentRequirements`／`connectionIds`／**`roles`**／`sources`／`mcpControls`／`oracle`／`expect`／`budgetClass`／`evidence` —— `roles` 是一个扁平的 Role 名列表，没有 Agent、Token、Agent `constraints`、或"本题须在 N 个身份下分别执行"的表达位。

但下列题**必须**在多个不同身份下跑：

| 题 | 需要的身份 |
| --- | --- |
| QB-DB-01 | 受控双连接编排身份（D6 允许"专用夹具 Role **或**显式双 Token 分步对照"） |
| QB-ACL-01 | 无 `lucy_query` 身份 ＋ 合法对照身份（D7 强制成对） |
| QB-ACL-03a | 只放行表 A 的身份（B 须被拒） |
| QB-ACL-03b | `region=East` 身份 ＋ `region=Southwest` 身份 |
| QB-ACL-03c | 字段暴露差分的两个身份 |
| QB-OPS-06…11 | 放行 W1／W2 的扩展夹具身份 |

D7"每负例有合法对照"意味着几乎每条权限题都要在**同一题内**跑两个身份。当前形状做不到，D20"分母映射"也无从机检。

**修法**：§3 补身份维度（如 `identities: [{id, role, agent?, tokenRef?, constraints?, expect}]` ＋ 题内 `runsByIdentity`），否则 SC-01／SC-22 与 Plan 步骤 2 的"§5 映射机检"无法实现。

### B13【高】`mcp-upgrade-journeys.yaml` 与 profile 应用脚本的归属在两条 Plan 间重叠

- **同一个文件被两条 Plan 同时声明为 Create**：P1-54 Plan 步骤 2（Plan `:33`）"实例化 `mcp-upgrade-journeys.yaml`"；P1-53 Plan Task 1 的 Files 写的是 `Create: scripts/e2e/contracts/mcp-upgrade-journeys.yaml`，Step 2–4 还要"最小题库 YAML"（父 Plan `:43`、`:72`）。
- **profile 应用／还原脚本只有 P1-54 声明实现**（P1-54 Plan 步骤 1，`:32`），但 P1-53 的执行器伪代码直接调用 `applyCompatConfigProfile(configProfile)`（父 Spec `:162`），P1-53 Plan 的 Task 2 文件清单却没有这一项。

后果：实现期两条 Plan 都开工时会在同一个 YAML 上撞车；只开工 P1-53 时 profile 应用脚本无人负责，D27／SC-25 无法落地。

**修法**：在两条 Plan 的「授权边界」里写死归属 —— YAML **内容**归 P1-54（题库语义正本），**加载／判定／digest 计算**归 P1-53；profile 应用／还原脚本归 P1-54，P1-53 只调用。并在 P1-53 Plan Task 2 的 Files 补该依赖。

---

## 5. 合规核对（落盘清单 16 条）

| # | 要求 | 结论 |
| --- | --- | --- |
| 1 | Spec／Plan 同编号同 slug 落位 | ✅ `lucy-20261118-mcp-upgrade-question-bank` |
| 2 | 伪代码或显式豁免 | ✅ 伪代码豁免小节在位 |
| 3 | 头部元数据（状态／授权边界／验收） | ✅ |
| 4 | Plan 五类小节 | ✅ 目标／开工前置／验收／完成定义／风险 |
| 5 | Terminology Compliance 形状 | ✅ `This feature follows` ＋ `New terms:` |
| 6 | Design System 四段式 | ✅ |
| 7 | 双索引登记 | ✅ `docs/README.md:44`、`docs/plans/README.md:7` |
| 8 | 新增命令／CI 登记 | ⚠️ Plan 步骤 4 只写 `node --test` 相关用例，未指定测试文件路径与命令，无法登记到测试门禁文档 |
| 9 | 台账号 | ✅ 「无」 |
| 10 | 机器门禁 | ⚠️ `lint:spec` PASS（2 条既有 WARN 与本条无关）／`lint:terminology` PASS／`lint:ia-boundary` PASS／`lint:e2e-ledger` PASSED；`lint:spec-docs` 见 B1 |
| 11 | 闭口层级 | ❌ 见 B1 |
| 12 | 作废状态句 | ✅ 无裸写 |
| 13 | 交互合同豁免 | ✅ |
| 14 | SOT 总账行 | ✅ 总账 P1-54 行；「不入核心分母」在行属性上 |
| 15 | 三台账勾连 | ✅ INDEX、e2e-ledger GAP-UAT-P1-54、共享 suite 均登记；`lint:e2e-ledger` PASSED |
| 16 | 主路径可用性优先 | ✅ §9 自检四问写实；§0 的 BLOCKED 语义不牺牲合法用户主路径 |

**状态镜像**：Spec 头部为事实源；总账、`docs/README.md`、`docs/plans/README.md`、`e2e-ledger.md` 的措辞与 Spec 头部不是"同一句"（DEVELOPMENT「状态登记只有一份现值」要求同句）。但 P1-53 已有同样写法，属既有惯例、非 v0.2 引入 —— 建议终稿时统一一次，**不作为本次阻塞项**。

**父合同收编核对**：P1-53 v1.1 的 D27／SC-25／§3 三处对 P1-54 的引用与本条 §0／§3 对得上，未出现第二套阈值 ✅。

---

## 6. 结论

- **认同** v0.2 的修订方向（配置资产包前置、禁 admin、真实 region 词表、gov 分立、分母表），理由见 §3。
- **反对** 在 B1–B5、B12、B13 修完之前把 v0.2 定为终稿：B1 会让 CI 门禁转红；B2 会让一条必做负例在 P1-49 落地后必然翻面；B3 留下 COMPAT-02 空过路径；B4／B5 会让两条权限负例与行级夹具在实现时踩已知坑；B12 使 §5 分母映射在当前 YAML 形状下不可机检；B13 使实现期两条 Plan 会在同一 YAML 上撞车。
- **建议路径**：v0.2-draft →（修 B1–B5、B12、B13；补 B6–B9）→ v0.3-draft → 委托人终稿确权 →（另发）开发授权。**测试台仍 NOT RUN**；本条收口 ≠ 父门禁通过 ≠ 可上线。
- 本轮**未改**运行代码、执行器、权限与数据；**未**代改他人未跟踪草稿（`ff4762c9` Plan）。
- 本记录是**一版意见**，已委托 Cursor 做对抗式审阅（brief 见文首「交接」行）；以对抗式复审的收敛结论为准。
