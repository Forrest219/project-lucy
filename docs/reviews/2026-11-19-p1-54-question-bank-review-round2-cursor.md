# P1-54 题库 Spec／Plan v0.2 — Cursor 对抗式复审（Round 2）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-54 题库评审对抗式复审（Cursor） |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-19 |
| 撰写人 | Cursor |
| 委托人 | xingchen（经 Kimi brief 委托对抗式复审） |
| 基于材料 | [Kimi 一版评审](2026-11-19-p1-54-question-bank-spec-plan-review.md)；[brief](../../inbox/20261119-p1-54-question-bank-review-brief-for-cursor.md)；P1-54 Spec／Plan v0.2-draft；P1-53 v1.1；共享 UAT；运行时代码取证 |
| 适用范围 | 裁定是否采纳 Kimi B1–B13；给出修订建议；**不改** Spec／Plan／代码 |
| 输出位置 | `docs/reviews/2026-11-19-p1-54-question-bank-review-round2-cursor.md` |

## 总裁定

**整体认同 Kimi：「方向对，v0.2 不可直接终稿」。** A1–A6 全部站得住。B1–B5、B9、B12、B13 **认同为必修**；B6–B8、B10–B11 **认同，严重度可维持**。对 B2 的修法偏好与 Kimi brief Q2「倾向改题／删题」**不同意**——应钉 **frozen 夹具 Role**，而不是等 P1-49 改题。

建议路径：修 B1–B5＋B9＋B12＋B13（并入 B6–B8／B10）→ **v0.3-draft** → 终稿确权 → 另发开发授权。仍 ≠ 开发。

---

## Q1–Q13 逐条裁定

### Q1（B1）同意 — 门禁判读成立

**裁定：同意。**

证据：`scripts/lint-spec-docs.mjs:288` 要求层级**恰好**为 `功能合同` 或 `发布取证`；`:297-301` 在层级＝功能合同时要求上线关系字面含 `本条收口不表示可上线`。当前 Spec「层级」带括号附注 → 触发第一条；若只修层级，上线关系现句 `本条收口 ≠ 父门禁通过 ≠ 可上线` 仍缺字面短语 → 触发第二条。短路掩盖成立。

**可落文本：**

```text
- 层级：功能合同
- 本条承诺：……（题库内容与 CompatConfigProfile 形状写在这里）
- 上线关系：本条收口不表示可上线（本条收口 ≠ 父门禁通过 ≠ 可上线）。
```

---

### Q2（B2）同意耦合成立；修法不同意 Kimi「倾向改题」

**裁定：耦合链完整（同意 B2 成立）；修法选「钉 profile 夹具 Role」为主。**

① 链完整：P1-54 以「当前 `demo_ops`／`lucy_ops_reader`＝W0 两表」为负例前提；P1-49 D0＝B 命中规范 W0 指纹后升 `names` 全集并改 demo 模板 → 同一 Agent 问 `ops_agents` 变 allow → D7 deny→allow＝FAIL；fingerprint 漂移。中间环节无需再发明。

② **修法偏好（与 brief 倾向相反）**：

| 选项 | 评价 |
|---|---|
| A. QB-ACL-02c 身份＝profile **frozen W0-only 夹具 Role**（不叫 `lucy_ops_reader`／不绑会 heal 的正式 Role） | **采用**。永久回归「未放行 Source → 拒绝」 |
| B. 断言「产品当前状态」、P1-49 后改题／删题 | **不采用为主路径**。会让升级门禁负例随产品演进翻面；与「事故／权限看守要稳」冲突 |
| C. 另加一条产品态烟测（heal 后 allow） | **可选补充**，ID 分开，不算 COMPAT-07 永久负例分母 |

D8「当前身份能跑的不得伪造前置」约束的是**合法成交题**，不是「必须永远拒绝」的负例。负例本来就该夹具冻结。

**须委托人知悉**：P1-49 若先落地，demo 正式 Role 不再适合当 W0 负例载体——更说明 A 必须进 v0.3。

---

### Q3（B3）同意 — 以测试台＋父 D5 为准，补题

**裁定：同意 B3；COMPAT-02 以「四类各至少一题」为硬要求。**

父合同 P1-53 D5 与共享 `cases.md:72` 写明时间窗／过滤／分组／合法空。题库 §5 只映射 02a／02b＝空过。应**补 Spec §4.1**，不削弱测试台。

**建议补题（demo 真实维）：**

| ID | 自然语言 | oracle |
|---|---|---|
| QB-BIZ-02c | 「查询 2025 年订单销售额。」 | 时间窗；独立 SQL（`order_year=2025` 或等价日期半开窗） |
| QB-BIZ-02d | 「查询 Furniture 品类的订单数。」 | 过滤；`category='Furniture'`＋`order_count` |

§5：COMPAT-02 → `02a,02b,02c,02d`。

---

### Q4（B4）同意 — 须显式 `tools/call`＋权限拒绝证据

**裁定：同意。**

① `tools/list` 经 `effectivePermissions`／角色编译过滤（`mcp-proxy.ts:3958`、`:4052-4055` 一带）。无 `lucy_query` 的 Role 在 list 中看不到该工具时，Agent 可纯文本拒答，**未触达 ACL 裁决**。

② 合同应写死：负例 PASS 条件 ⊇ 显式 `tools/call(lucy_query)`（或等价受控发起）＋ 稳定拒绝码（如 `tool_forbidden`／表／连接拒绝族）＋ 审计可对账的 deny（既有范式见 `docs/access-control/uat-agent-permissions-v1.md:391`、`:437` ATK-08）＋ **零上游执行**。「仅 tools/list 缺工具」或「Agent 口头说查不了」**不得** PASS。

③ 可复用：`uat-agent-permissions-v1.md` 工具级降权；`checklist-single-deploy-phase0-1.md:226` 显式 `tools/call` 形态。

---

### Q5（B5）同意成立；修法须委托人裁定

**裁定：B5 成立。** Agent `constraints` **也会**进 proven 门。

① 证据：`acl.ts:3497-3527` — `finalRows`（EffectiveRowGrant **AND** Constraints，见同文件注释与 `agent-constraints.ts:379+` `synthesizeFinalRows`）一旦 `kind==="scoped"`，`lucy_query` 在 `!isUpstreamForcedPredicateProven()` 时直接 `row_policy_upstream_unproven`。proven 默认 false（`row-policy.ts:75-78`）。**没有**「constraints 折成普通 filter 从而绕过 proven」的成交捷径。

② 三条修法与主路径／不夹带产品变更：

| 修法 | 与原则 | 建议 |
|---|---|---|
| ① profile 环境前置打开 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` | 改变默认产品行为面（环境级） | **须委托人明示**；可作「门禁专用 lab profile」选项，不得默认同化为客户默认 |
| ② oracle 改为断言 `row_policy_upstream_unproven` | 不改产品；但测的是 proven 门不是行隔离 | **可作独立题**（如 QB-ACL-03b-gate），勿冒充行隔离成交 |
| ③ 通用车道放弃行级**成交**隔离，保留字段暴露差分；行隔离交给客户私有基线／另开行权限 UAT | 最贴「不夹带产品变更」 | **通用 demo 车道推荐主路径** |

**本复审推荐（待委托人拍板）**：通用 CompatConfigProfile **采用 ③**；另用 **②** 一条题显式看守 proven 门（诚实命名）；① 仅当委托人批准「lab 专用开关」时启用，并写进 profile 环境字段与证据。

③ `protectedSources.length > 1`（`acl.ts:3529-3531`）：凡夹具 Role 对**两个以上** source 同时 scoped 行收窄的单次 `lucy_query` 都会撞。QB-JOIN／多表追问若误加双表 row_policy 也会中招——§0.2 须写「行级夹具单次查询至多一个 protected source」。

---

### Q6（B6）同意 — 锚点由题库 oracle 定死

**裁定：同意。**

① W0：legacy 无 snapshot／gov 注入。oracle 建议写死：  
`anchor = max(call_day) in visible ops_calls for this identity`；半开或含端点写明；取 N 个 UTC 自然日；**缺日计 0 行仍属合法形状**（不要因缺日 FAIL）。

② QB-OPS-07a：治理窗＝`Asia/Shanghai` 日历日（`gov-filters`／`metric-window`），`call_day`＝UTC。应 **改措辞＋oracle**：例如「在 `gov.calendar_days=7`（上海）窗内，哪些 Agent 有访问？列出窗内出现的 UTC `call_day`」——以治理窗为准，UTC 仅作披露字段，避免「7 个 UTC 日」字面。

---

### Q7（B7）同意 — 合同形状对齐真实 filters

**裁定：同意。**

① §3 补映射：`mcpControls[].govWindow` → 展开为 `filters[]` 中的 `gov.*` 项；禁止虚构顶层 `gov` 对象直达 API。

② Plan 失败测试改为：`W1/W2 missing any allowed gov window knob => FAIL`；白名单 `calendar_days∈{7,30}` **或** `window_hours∈{24,168}` **或** 显式 ISO 半开窗（与 `gov-filters` 互斥规则一致）。

③ **值得保留**「题库强制带窗口旋钮」——标明为 **题库纪律**（可比性／可复现），不是产品对无窗查询的绝对拒绝。无窗时产品行为另测；本门禁要求 MCP 对照必须带窗。

---

### Q8（B8）部分同意 — 双题保留更干净

**裁定：问题成立；修法选「W0 钉 ops_calls ＋ W1 增设 ops_tokens」。**

`ops_calls` 确有 `token_label` 列（`_schema/main.yaml`）；SOP 默认路由 `ops_tokens`（W1）。仅放 W0 会让读 SOP 的 Agent 跑偏。

建议：QB-OPS-05 oracle 钉死 `ops_calls` 分组口径，并 footnote「≠ ops_tokens 快照口径」；§4.5 增 QB-OPS-05b（或并入 OPS-06 族）查 `ops_tokens`。

---

### Q9（B9）同意；部分传导排查

**裁定：同意。** `cases.md:149` 仍写「华东／西南」；摘要表与 `fixtures.md:12` 已 East／Southwest。

本轮抽查已跟踪面：未再发现第二处「华东／西南」残留于 mcp-upgrade-compatibility 目录（除 `:149`）。P1-53 Spec 场景族表未复述错误中文区划。**修 `cases.md:149` 即可闭合 B9。**

---

### Q10（B12）同意 — 必须补 identities

**裁定：同意；高优先级。**

① 最小形状建议：

```yaml
identities:
  - id: deny_no_query
    role: compat_no_lucy_query
    tokenRef: env:COMPAT_TOKEN_NO_QUERY
    expect: { outcome: deny, reasonFamily: tool_forbidden }
  - id: allow_readonly
    role: demo_readonly
    tokenRef: env:COMPAT_TOKEN_READONLY
    expect: { outcome: allow }
runsByIdentity: [deny_no_query, allow_readonly]  # 或 per-turn
```

② `agentRequirements` 只够「要不要同会话／Public MCP」，**不够**表达多身份；不要挤进去。

③ 补完后 SC-01／SC-22／§5 映射机检才可实现；否则「场景 PASS＝全部 QB PASS」在多身份题上无法机检。

---

### Q11（B13）同意 — 归属写死

**裁定：同意。**

| 产物 | 归属 |
|---|---|
| `mcp-upgrade-journeys.yaml` **内容**（题面／oracle／mapsTo／identities） | **P1-54** |
| YAML **加载、schema 校验、digest 计算、判定聚合** | **P1-53** |
| CompatConfigProfile **应用／备份／还原脚本** | **P1-54** |
| `applyCompatConfigProfile()` **调用与指纹门禁** | **P1-53**（D27） |

两条 Plan「授权边界」互相点名；P1-53 Task 1 改为 `Consume/Validate` journeys.yaml，勿再写 `Create` 内容；Task 2 Files 声明依赖 P1-54 profile 脚本。

---

### Q12 漏维补充 → 新发现 B14–B17

| # | 严重度 | 发现 |
|---|---|---|
| **B14** | 中 | 术语标准未登记 `CompatConfigProfile`／题库／W0–W2（`00-product-terminology-standard.md` 无命中）。Spec 自登记 New terms 对门禁够用，但终稿前建议补术语标准一行或显式「仅 Spec 登记」豁免 |
| **B15** | 中 | W0 轮次无 `snapshot_id`：§7「每轮保留快照 ID」对 W0 应改为 `snapshotId: null`＋`windowAnchor`（见 B6），避免造假 snapshot |
| **B16** | 低 | `evals/golden/superstore.yaml` 面向 SQL pattern／另一数据集年代（注释仍写 2014–2017），**不可直接当**本门禁 oracle；可参考口径（SUM/SUM、COUNT DISTINCT），数值必须以 demo `_baseline.json` 为准 |
| **B17** | 低 | `scripts/e2e` 现有 journey 是产品主线 Playwright／Agent 旅程，**无** COMPAT YAML 先例；P1-54 自造 schema 可接受，但应在 Plan 写明「不复用 mainline-scenarios 形状」以免实现者误并 |

P1-35／P1-37：题库已挂 ESC-11 同形即可；韧性（重试／空结果下一步）不必扩进 P1-54 分母，避免与 P1-37 双重验收——**不另开阻塞项**。

与 `20261118-…-technical-questions-for-cursor.md`：P1-53 原则冻结仍有效；本 brief 专打 P1-54 条款。冲突时 **题库语义以 P1-54＋本复审收敛为准**，放行阈值仍以 P1-53 为准。

---

### Q13 最可能被推翻的三条；整体判断

| 排名 | 条目 | 为何相对可推翻 | 本复审结论 |
|---|---|---|---|
| 1 | B8 | 若强制 Agent 忽略 SOP、钉死 `ops_calls`，单题也可能跑通 | 仍建议双题，降低跑偏 |
| 2 | B5 修法① | lab 开 proven 在受控 profile 下技术可行 | 成立性不倒；选哪条修法待委托人 |
| 3 | B2 修法争论 | 「改题」在 P1-49 永不落地时也可苟 | 耦合仍成立；夹具钉死更稳 |

**整体判断站得住**：方向认同、条款反对、不建议 v0.2 直接终稿。

---

## 对 Kimi A1–A6／B1–B13 对照表

| ID | Cursor |
|---|---|
| A1–A6 | **全部同意** |
| B1 | **同意** 阻塞 |
| B2 | **同意** 问题；修法选夹具 Role（不同意「以改题为主」） |
| B3 | **同意** |
| B4 | **同意** |
| B5 | **同意**；修法待委托人在 ①／②／③ 间裁定（推荐 ③＋②） |
| B6–B11 | **同意** |
| B12–B13 | **同意** |
| B14–B17 | **新增**（见上） |

---

## 须委托人裁定（不代做产品决策）

1. **QB-ACL-03b 行隔离**：通用车道放弃成交隔离（③）vs lab 开 proven（①）vs 只测 proven 拒绝（②）？
2. **P1-49 与 QB-ACL-02c**：是否批准「永久负例＝frozen 非 heal Role」？
3. **proven 环境开关**是否允许写入 CompatConfigProfile lab 变体？
4. v0.3 修订授权后是否直接终稿，还是再开一轮对抗？

---

## 建议修订序（仍只文档，待授权）

1. B1 形态字面  
2. B13 Plan 归属＋B12 identities  
3. B2／B4／B3／B9  
4. B5（按委托人选项）＋B6／B7／B8／B10／B15  
5. → v0.3-draft → 终稿

本轮**未改** Spec／Plan／测试台／运行代码。

---

## 闭合（2026-11-19）

委托人批准本复审建议并授权优化 Spec／Plan 定稿、**暂不开发**。修订已落入 [题库 Spec／Plan **v1.0**](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md)（闭合 B1–B13／B15）；共享测试台词表已对齐；总账 v1.55／需求池 v0.92 镜像。**终稿确权 ≠ 开发授权**。
