# 运维问数可问治理面 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.9.3**（短修订：SC-17e stock→upgraded；`enabled_tables` ⊆ Manifest） |
| 日期 / 目标版本 | 2026-11-01；收口 2026-11-02；短修订 2026-11-04 / 不绑定产品版本号。功能编号无；不进入 v0.25 升级台账 |
| 功能编号 / 优先级 | **无** / **P0**（W1）／**P1**（W2）／**P2**（行级与问询原文，本条不交付） |
| 状态 | **v0.9.3 功能合同已收口（2026-11-04）**。短修订并入 Manifest 升级自愈：官方 stock 可 `upgraded`，ensure 后 `enabled_tables` ⊆ 本地 Manifest。基线收口见 [收口审阅](../reviews/2026-11-02-ops-evidence-askable-governance-closure.md)。本条收口不表示可上线 |
| 修订记录 | v0.9.3（2026-11-04）SC-17e／D22 短修订：官方历史 stock 资产可自愈升级为当前模板（`upgraded`），仅非 stock 字节差才记冲突；ensure 之后 `lucy-ops.enabled_tables` ⊆ 本地 Manifest 物理表。见 [Manifest 升级自愈 Spec](lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md) 及其 [实施 Plan](../plans/lucy-20261104-lucy-ops-manifest-upgrade-heal-plan.md) |
| 决策来源 | 2026-11-01 产品对话；Codex 审阅见 [`docs/reviews/2026-11-01-codex-review-ops-evidence-askable-governance.md`](../reviews/2026-11-01-codex-review-ops-evidence-askable-governance.md)；PM 定夺记录见同文「PM 定夺」 |
| 需求来源 | 运维问数须支撑经营／治理追问，而非仅调用流水 |
| 实施主体 | Lucy（`lucy-ops` 投影／语义／Skill／Wiki；复用并**修正** access-map Token 归因键）。不改 KTX；不改运行时裁决语义（授权模型字段不新增） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | 消费 Spec 149／187／189／194／名册。修订 Spec 149 人口边界与 ensure 对 `enabled_tables` 的扩展义务。路径／边宜复用 access-map **builder**（免第二套算法），但**不要求**与图页展示数字逐项对等（PM：图静态／论述动态）。本条**不修改**图凭证清单聚合。不撤销 Spec 149 SELECT 禁列 |
| 实施计划 | [`docs/plans/lucy-20261101-ops-evidence-askable-governance-plan.md`](../plans/lucy-20261101-ops-evidence-askable-governance-plan.md) |

> 定稿 ≠ 开发授权。v0.4 为自洽冻结正文，不依赖「同 v0.x」悬空引用；决策全文写在本节与 §4。

---

## 闭口层级

- 层级：功能合同
- 本条承诺：授权运维问数 Agent 可按本条冻结口径查询配置人口、窗口活动、Agent 级访问分级汇总、与 `/api/admin/access-map` 同源的图事实，以及表采用／近窗未访问与活跃率
- 本条出口：SC-01–SC-18、SC-20–SC-24（不含已拆出的 SC-17f、SC-19）的本机自动化断言；SC-17e 与 `enabled_tables` 上限按 [Manifest 升级自愈 Spec](lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md) 修订（v0.9.3）
- 不在本条出口：整库旅程、自然语言 gold、浏览器／窄屏、镜像与客户环境、行级明细、问询原文；**部署拆出**见下
- 上线关系：本条收口不表示可上线

### 部署拆出（2026-11-02）

下列内容不再作为本条出口。问数合同本身不依赖它们成立。

| 原项 | 处置 |
|---|---|
| SC-17f 升级 runbook「检查正式 Role 表选择器」 | 不在本条出口。Wiki 仍写明已落盘 Role 须显式扩表；客户升级说明归交付，不进功能合同 |
| SC-17d 扩权后的现场查询 | 不单开旅程。扩权后能否查由 Spec 149 表选择器决定；本条只锁模板列全名、ensure **不改已存在** Role 表选择器（D22）、未列入名的源不在该 Role 允许集；缺失 Role 缺则创建见客户默认系统正式 Role Spec |
| SC-19 四门禁 + 落盘清单 11 项 | 收口过程记录，写在收口审阅，不是用户可观察承诺 |
| v0.25 升级台账、镜像、Helm、客户环境 | 继续不进入本条；不因收口而视为可部署到客户 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 问数主术语 | 定义 | 禁止混淆 |
|---|---|---|---|
| Askable Governance Surface | 可问治理面 | `lucy-ops` 上可查询的治理／用量只读事实；口径以问数合同为准 | `lucy_ops_*` 控制面工具；图页截图像素对等 |
| Shared Builder Reuse | 共享派生复用 | 路径／边等复杂结构优先调用 access-map builder，避免第二套守恒算法 | 强制与图页 KPI／折叠渲染逐格相等 |
| Configured Agent Population | 配置 Agent 人口 | 当前 `access.yaml` Agent 全集（含未启用）＝名册 Agent 总数 | 窗口活跃 Agent |
| Available Token Population | 可用 Token 人口 | 名册 `availableTokenCount` | `token_label` 去重；业务活跃 Token |
| Window Active Agent | 窗口活跃 Agent | 窗口内 §4.2 事件集上 `distinct agent_id` | Spec 189 近 N 活跃 Agent |
| Silent Agent | 沉默 Agent | 配置人口 − 窗口活跃 Agent | 窗口仅连接；名册闲置 |
| Window No-record Agent | 窗口无记录 | 窗内协议=0 且默认用量=0（Q4 档①） | 「从未连接」；沉默 Agent（默认用量反连接，口径不同） |
| Window Connect-only Agent | 窗口仅连接 | 有协议；默认用量=0（Q4 档②） | Spec 194 仅连接会话；名册固定近 7 天「仅连接」 |
| Window Soft-usage Agent | 窗口轻量业务未问 | 有默认用量；查数=0；真实问询=0（Q4 档③；含浏览／准备／失败的问询动作／运维操作／未分级等） | 仅「浏览未问会话」；勿缩成只含浏览工具 |
| Window Query-without-ask Agent | 窗口查数未问 | 有查数；无真实问询（Q4 档④） | 未上报查数会话 |
| Window Question-active Agent | 窗口问询活跃 | 至少 1 条真实问询（Q4 档⑤） | Spec 189 近 N 活跃 Agent；窗口活跃 Agent（§4.2） |
| Governance Snapshot | 治理投影快照 | §4.1 唯一键标识的一次物化 | 单行 `ts` |
| Table Activity Rate | 表活跃率 | D19 公式 | 调用次数占比 |
| Window-unvisited Table | 近窗未访问表 | 当前可授权／启用表集合中，查询窗口内无 access_path 的表（Q5＝C） | 「上线以来从未访问」；僵尸授权（有授权无访问，窗口／分子可不同） |

Forbidden terms:

- `count(distinct token_label)` 称为任何 Token 人口或用户数
- 「近 N 活跃 Agent」称为「有效 Agent 总数」
- 协议握手称为正式／真实问询
- 「窗口无 MCP 记录」称为「从未连接」
- 把「近窗未访问表」称为「上线以来从未访问」或「上线 30 天从未访问」
- 跨 Agent 同 label 聚合值称为「单枚 Token 精确用量」
- 在未交付 P2 时声称可检索问询原文或行级命中

Protected 标识（回答中保持原文）：`Agent`、`Token`、`MCP`、`lucy-ops`、`ops_calls`、`ops_call_tables`、`ops-questioning`、`lucy_ops_reader`、连接 ID、角色 ID、物理表名、工具名、`pathKey`、`confirmedUnauthorized`。

实现前登记术语标准。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

### What This Change Follows

- [ ] 默认不新增治理台页面／Metric Card
- [ ] 连接概览若增说明，沿用既有卡片
- [ ] 无裸十六进制
- [ ] Skill／Wiki 符合术语标准

### Exceptions (If Any)

- 主交付为 MCP 数据面；图页壳与图凭证聚合仍归 Spec 187／呈现 Spec。本条不改图归因。

### Follow-up Needed

- 可选：管理台「可问治理面」说明入口另起呈现 Spec。

---

## 1. 背景、六问与成功标准

### 1.1 规范六问（验收样例原文）

| ID | 规范问句 | 回答单位 | 本条交付 |
|---|---|---|---|
| Q1 | 现在有效的 Agent 数量和 Token 数量分别是多少？ | 配置 Agent 人口；可用 Token 人口（歧义见 D4／D5） | **必交付** |
| Q2 | 过去 7 天有哪些 Agent 进行了访问？ | 窗口活跃 Agent 名单（7 个 UTC `call_day`） | **必交付** |
| Q3 | 哪些 Agent 连续 30 天都没有访问？ | 沉默 Agent（30 日窗，§4.2） | **必交付** |
| Q4 | 访问如何区分：连接了没访问、连连接都没有、连接了但没有正式问询？ | Agent×窗 MECE 五档（D16）；默认窗 30 个 Asia/Shanghai 日 | **必交付** |
| Q5 | （定夺后规范问句）近 30 天哪些表没有被访问？ | 近窗未访问表名单 | **必交付**（D17＝C） |
| Q6 | 哪些表活跃率高（例如过去 30 天活跃天数／30）？ | 表活跃率（D19） | **必交付** |

产品基准（**PM 修订**）：

1. **图是静态的，论述是动态的，两者不必对等。** 问数不以「与 `/admin/access-map` 页展示逐格一致」为成功标准。  
2. 复杂结构（授权／访问路径、边状态）**优先复用** access-map builder，验收对 **builder／投影输出**，不对页面折叠与展示简化。  
3. 六问可路由且口径诚实；行级与问询原文为 P2。  

原「上线 30 天仍从未访问」→ Q5＝C。旧问法须改述。

### 1.2 成功标准

1. §5.4 **可问治理清单**各项有源与 SC；对账对象为共享 builder／投影，**不要求**与图页展示或现行凭证清单 UI 数字一致。  
2. Q1–Q6 可路由且口径诚实。  
3. Q5 禁止答成「从未／上线满 30 从未」；Token 调用量按 E，禁止与图串量口径混称。  
4. 旧两视图在治理源 `unready` 时仍可用（N01）。

---

## 2. 目标与非目标

目标：可问治理面；冻结合同；Skill／Wiki；旧实例诚实升级路径；P2 只登记。

非目标：改 Spec 187 图页凭证清单聚合或边状态机；改 189／194 分子定义；开放原文／哈希／IP／UA／`sql_execution`；控制面替代问数；NL gold；行级／血缘；自动补 `demo_ops`；强制图页与问数数字对等。

---

## 3. 决策（冻结，全文）

| ID | 决策 |
|---|---|
| D1 | 基准线＝六问可路由 + 可问治理面；**图≠论述**（不必对等）；Q5＝近窗未访问 |
| D2 | 挂 `lucy-ops` + `lucy_ops_reader` 显式表集；`*` 不自动带出 |
| D3 | 路径／边优先复用 access-map **builder**，禁止语义层另写守恒；不对页面渲染对账 |
| D4 | 「有效 Agent」默认＝配置 Agent 人口；含「活跃」→窗口活跃 Agent；歧义先澄清 |
| D5 | 「Token 数量」默认＝可用 Token；禁 `token_label` 去重；业务活跃 Token→使用概况 |
| D7 | 调用活跃用 UTC `call_day`；Spec 194／表活跃率用 Asia/Shanghai；回答写明 |
| D10 | 旧两视图不变；新源并列 |
| D11 | P2 不进本条 SC 出口 |
| D12 | 无 Skill／Wiki 路由不算完成 |
| D13 | 治理源＝服务端物化投影；旧源不走快照过滤 |
| D14 | unready／partial 禁止伪 0 |
| D15 | 窗口活跃事件集＝默认用量 ∧ 自追问排除（＝`ops_calls`）；≠ Spec 189 |
| D16 | **PM 定夺（2026-11-01）**：Q4＝配置 Agent × 窗口的 **MECE 五档**，按**最深水位**只归一档。分叉见 §4.3（③＝有默认用量且无查数且无真实问询，收尽失败 begin／未分级等）。工具／问询分界＝Spec 194。默认窗＝`calendar_days=30` 含今日公式（§4.1）。会话作第二层。禁止「从未连接」 |
| D17 | **PM 定夺 C（2026-11-01）**：Q5＝当前可授权／启用表中，查询窗口内 **无 access_path** 的表。默认窗＝30 个 Asia/Shanghai 日历日（可与 `gov` 窗对齐并写明）。**不要求**上线≥30 天，**不证明**上线以来从未访问。人口＝授权面表集合（与 grant 可解析表对齐），不是「曾出现在流水中的表」 |
| D18 | 表上线锚点 **不在本条 Q5 交付范围**。若日后要做「上线以来从未访问」，另开合同；本条不得用 mtime／首次访问冒充上线并塞回 Q5 |
| D19 | 表活跃率＝`active_days/denom_days`。`active_days`＝窗内 Asia/Shanghai 日中至少 1 条 access_path 触达日数；`denom_days`＝`[start,end)` 相交上海日历日数（<1 则不可用）；deny 不计；评测跟随 Spec 187；比率>1＝实现错；新表仍用全窗分母并披露 `days_online_in_window` |
| D20 | §5.4 为可问治理清单；字段名与 builder／投影对齐；**删除**「与图页逐格对等」合同 |
| D21 | 新源继承 Spec 149 禁列 + 禁快照原文／问询原文 |
| D22 | **PM 定夺 A（2026-11-01）**：ensure **只**扩 `lucy-ops.enabled_tables`、升级标准语义／Skill／Wiki（冲突保留并 `unready`）；**不**自动改**已存在**正式 Role／Agent 的 `access.yaml` 字节。参考模板 `lucy_ops_reader` 必须列出本条全部 sourceName（新装／从模板新建才带齐）。**已落盘**的正式 Role 须管理员显式扩表选择器或重建／改绑。不采用自动迁移补表名。升级 runbook 的现场检查不在本条出口（v0.9.2 拆出）。控制面改 Role 另议，不堵本条。**v0.9.3 短修订（2026-11-04）**：升级标准语义包含「官方历史 stock 资产 → 覆盖为当前模板」（`upgraded`）；`enabled_tables` 的扩展**以本地 Manifest 物理表为上限**。见 [Manifest 升级自愈 Spec](lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md)。**v0.9.4 指针（2026-11-05）**：缺失正式 `lucy_ops_reader` 的缺则创建例外见 [`lucy-20261105-customer-default-system-roles-spec.md`](lucy-20261105-customer-default-system-roles-spec.md)；旧句「永不写 access.yaml」作为**绝对值已作废，不得当作现值** |
| D23 | **PM 定夺 E（2026-11-01）**：`ops_tokens` 调用量按 `(agent_id, token_label)` 计默认用量。**本条不修改** access-map 图凭证清单聚合。不问数与图凭证数字对账。Wiki 披露两者可能不一致、以问数为准谈 Agent 用量。仍禁止 label 去重当人口；同 Agent 删建同 label 不可区分前后凭证 |
| D24 | 治理源缺省窗＝`gov.calendar_days=30`（上海）。亦支持 24／168h、`calendar_days` 7／30、或显式 ISO 半开窗。调用活跃名单的日粒可用 UTC `call_day`，须在回答写明 |
| D25 | **查询键 `query_key`**＝稳定哈希(`startIso,endIso,trust,filtersDigest,accessConfigVersion,policyVersion,sourceMapVersion,capabilityDigest`)。**不等于**物化代次 |
| D26 | Builder **注入**同一窗。物化代次 `materialization_id`＝每次重建新 UUID。`pointer[query_key]=materialization_id` 原子切换。读者在查询开始绑定代次，刷新不改写已绑定行集。TTL 默认 60s；配置／Token／策略变更立即失效 pointer。失败不发布半份。旧代 GC 规则：无绑定读者且超过 TTL×2 可删。SC-20b 覆盖同键刷新 |
| D27 | **PM 定夺 A（2026-11-01）**：治理窗／trust／focus 经 `lucy_query.filters` 中的 **`gov.*`** 传入；Proxy **必须剥光**后再进语义／KTX。不扩展顶层字段、不另造查询工具。名单／互斥／旧源拒绝见 §4.1。未知 `gov.*` → `invalid_arguments`。其余 filters＝行过滤；子图重建只用 `gov.focus_*`；`gov.focus_token_label` 只影响访问层 |
| D28 | 覆盖率按 `pathKey` 去重，同源 `summarizeSnapshotCoverage` |

---

## 4. 核心合同

### 4.1 投影生命周期与 `lucy_query` 合同

**参数处理顺序（治理源，Normative）**

1. ACL：显式 `lucy-ops` + 表选择器。  
2. 从 `filters`（及等价数组）中识别并**剥离**下列 `gov.*`（**完整名单**；此外任何 `gov.` 前缀 → `invalid_arguments`；剥离后不得出现在上游请求，SC-22）：  
   - **窗（三选一，同现 → `invalid_arguments`）**  
     - `gov.window_hours` ∈ {24,168} → `buildMetricWindow`  
     - `gov.calendar_days` ∈ {7,30} + 可选 `gov.calendar_tz`（缺省 `Asia/Shanghai`）→ 半开日历日窗  
     - `gov.start_iso` + `gov.end_iso`（须成对）  
   - `gov.trust`（与 access-map trust 枚举一致；缺省＝图默认）  
   - `gov.focus_agent` / `gov.focus_role` / `gov.focus_table`（`conn::schema::table`）→ **重建／收窄物化子图**  
   - `gov.focus_token_label` → **只**过滤访问层物化；**不得**改授权路径物化  
3. 缺省窗：未给任何窗字段时，治理源用 `gov.calendar_days=30`（上海）。Skill 问「近 7 天／24h／168h」须显式传对应 `gov.*`。  
4. **日历日窗端点（Normative，含今日）**：对 `calendar_days=N`、时区 `tz`（缺省 Asia/Shanghai）、快照时刻 `asOf`：  
   - `endExclusive = startOfCalendarDay(asOf, tz) + 1 day`（`asOf` 所在日历日的次日 00:00，半开）  
   - `startInclusive = endExclusive - N days`  
   - 查询键使用这对边界的 UTC ISO。  
   **含今日**：`asOf=2026-11-01T12:00:00+08:00`、`N=30` → `[2026-10-03T00:00:00+08:00, 2026-11-02T00:00:00+08:00)`。  
   不是「此前 N 个完整日、不含今日」。SC-24 锁此时钟与午夜边界。  
5. 计算 `query_key`（D25）。查 `pointer[query_key]`；若缺失／过期／输入代际变化 → `rebuildAtomic`。  
6. 查询开始绑定 `materialization_id`；行集限定该代次。  
7. **剩余** filters／dimensions＝行过滤（如 `ops_tokens.agent_id`）；**不**触发子图重建。

**旧源**：`ops_calls`／`ops_call_tables` 跳过 2–6；出现任一 `gov.*` → `invalid_arguments`。

```text
rebuildAtomic(query_key, window, trust, focus):
  mid = new_uuid()
  write staging with materialization_id=mid using buildAccessMap(
        injected startIso/endIso, trust,
        focus without applying token focus to grant layer)
  if fail: discard; return unready
  atomically pointer[query_key] = mid
```

**代表性 `lucy_query` JSON（Normative）**

Q1 配置 Agent 数：

```json
{
  "connectionId": "lucy-ops",
  "sourceName": "ops_agents",
  "measures": ["ops_agents.agent_count"],
  "filters": [{ "field": "gov.calendar_days", "op": "eq", "value": 30 }]
}
```

（`agent_count`＝`count(*)` 预置；`gov.*` 被 Proxy 剥离。）

Q2 近 7 个 UTC 日活跃 Agent：

```json
{
  "connectionId": "lucy-ops",
  "sourceName": "ops_agent_activity",
  "dimensions": [{ "field": "ops_agent_activity.agent_id" }],
  "filters": [
    { "field": "gov.window_hours", "op": "eq", "value": 168 },
    { "field": "ops_agent_activity.call_day", "op": "in", "values": ["/* 近7个UTC日由Skill填入 */"] }
  ]
}
```

图授权路径总数：

```json
{
  "connectionId": "lucy-ops",
  "sourceName": "ops_map_meta",
  "measures": ["ops_map_meta.grant_paths"],
  "filters": [{ "field": "gov.window_hours", "op": "eq", "value": 168 }]
}
```

Agent A 的 Token 用量（行过滤；**不对账图**）：

```json
{
  "connectionId": "lucy-ops",
  "sourceName": "ops_tokens",
  "dimensions": [
    { "field": "ops_tokens.token_label" },
    { "field": "ops_tokens.call_count" }
  ],
  "filters": [
    { "field": "gov.window_hours", "op": "eq", "value": 168 },
    { "field": "ops_tokens.agent_id", "op": "eq", "value": "A" }
  ]
}
```

`gov.focus_token_label` 若用于路径类源：只影响访问层物化（SC-08f）；与凭证 `call_count` 归因无关。

### 4.2 运维问数事件集

`defaultUsageConditionSql AND ops_evidence_self_exclusion`（与 `ops_calls` 相同）。禁止与裸 Spec 189 互换。

### 4.3 Q4（MECE 五档）

人口：配置 Agent。窗口：默认 30 个 Asia/Shanghai 日（可 `gov` 换窗）。

```text
配置 Agent × 窗口 W
├─① 窗口无记录              协议=0 ∧ 默认用量=0
└─ 有 MCP 痕迹
   ├─② 窗口仅连接            协议>0 ∧ 默认用量=0
   └─ 有默认用量
      ├─③ 窗口轻量业务未问    查数=0 ∧ 真实问询=0
      │                      （浏览/准备/失败的 begin/运维操作/未分级等均入此档）
      ├─④ 窗口查数未问        查数>0 ∧ 真实问询=0
      └─⑤ 窗口问询活跃        真实问询>0
```

**归类顺序（Normative）：** 先⑤ → ④ → ③ → ② → ①。  
每个配置 Agent 恰好一档；③ 收尽「有默认用量但未查数、未形成真实问询」的剩余（含仅失败的 `lucy_begin_question`）。  
原话映射：连都没连（本窗）→①；连了没访问→②；连了没正式问询→③或④；有正式问询→⑤。

第二层（可选下钻，不改主档）：该 Agent 窗内会话按 Spec 194 互斥类列出。

Skill 只输出术语表主术语；禁止「从未连接」。

### 4.4 Token（E）

见 D23。SC-10：问数夹具内 `(A,label)` 归因正确。SC-10b：A／B 同 label 调用 1／2 → 问数分别为 1／2。SC-10c：**不**断言与图附属区相等（允许图仍显示串量）。

### 4.5 Q5（近窗未访问）

见 D17。实现：`ops_table_adoption`（或等价）对授权面表 left anti-join 窗口 access_path。  
SC-11：窗内有访问的表不得入选；仅流水出现过、已不在授权面的表不入选；Skill 对「从未／上线 30 天」旧问法必须改述。  
热库只要覆盖**本查询窗口**即可，不要求锚点以来全史。

### 4.6 Q6

见 D19 全文。预置 measure：`active_days`、`denom_days`、`activity_rate`、`days_online_in_window`。SC-12 反例：仅 deny 触达、评测探针、跨日边界、同日重复、denom<1。
### 4.7 旧实例授权（D22＝A）

```text
ensure / 升级
  ├─ enabled_tables ∪ 新物理名          ✅（且 ⊆ 本地 Manifest 物理表）
  ├─ 标准语义／Skill／Wiki 可识别升级    ✅（官方历史 stock → upgraded；定制 → 冲突保留）
  ├─ 自定义资产冲突 → 治理源 unready    ✅（旧两视图仍可用）
  └─ 改已存在 access.yaml 正式 Role     ❌ 禁止（缺失 lucy_ops_reader 缺则创建见客户默认系统正式 Role Spec）

运营（显式）
  └─ 编辑已有 lucy_ops_reader（或等价）表选择器
     或从更新后模板新建 Role 并改绑 Agent
```

SC-17a：`enabled_tables` 含新名。SC-17b：参考模板含全部 sourceName。SC-17c：旧 Role 未扩权 → 新源不在该 Role 允许集（demo 正式 Role 只留 W0；不是静默空结果冒充无能数据）。SC-17e（v0.9.3 修订）：标准资产**官方历史 stock 版本**允许升级为当前模板（`upgraded`）；**仅非 stock 的字节差**才沿用 Spec 149 记冲突，不覆盖、不把冲突文件说成 current。SC-17d／SC-17f 已拆出，见闭口层级。

**新增不变量（v0.9.3，2026-11-04）**：ensure 之后，`lucy-ops.enabled_tables` ⊆ 本地 Manifest 物理表集合；属于冻结集合的表名不得超出当前有效 Manifest。升级后不得再出现冻结表的「已启用 · 本地无 Manifest」。见 [Manifest 升级自愈 Spec](lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md) §4.2。

---

## 5. 源集合

### 5.1 W0

`ops_calls`、`ops_call_tables` — Spec 149；**无** `snapshot_id` 列。

### 5.2 W1

`ops_agents`、`ops_tokens`、`ops_agent_activity`、`ops_question_kpi_agents` — 均含 `snapshot_id`。

### 5.3 W2

`ops_grant_paths`、`ops_access_paths`、`ops_edge_signals`（含 `confirmedUnauthorized` 布尔）、`ops_map_nodes`、`ops_map_meta`（含 `rawCalls`、`deniedCalls`、counts、coverage 分子分母、orphanGrants、versions）、`ops_table_adoption`。

### 5.4 可问治理清单（对 builder／投影，不对图页）

| 可问事实 | 源／字段 | 对账对象 | SC |
|---|---|---|---|
| 授权／访问路径总数 | `ops_map_meta` | builder／API `meta.counts.*`（非页头展示） | SC-08 |
| 僵尸／需复核／overflow 边 | `ops_edge_signals.state` | builder edges | SC-08／08b |
| 确凿越权 | `confirmed_unauthorized` | builder 布尔；措辞 Spec 187 | SC-09 |
| 节点计数 | `ops_map_nodes` | builder nodes | SC-08c |
| 孤儿授权 | `orphan_grants` | builder meta | SC-08d |
| 快照覆盖率 | pathKey 去重（D28） | builder coverage | SC-08e |
| 原始调用／拒绝 | `raw_calls`／`denied_calls` | builder `meta.access.*` | SC-08i |
| Agent×label 调用量 | `ops_tokens` | **问数夹具真值**（D23＝E）；**不对图** | SC-10／10b／10c |
| Token focus 不改授权层 | gov.focus_token_label | 同参 grant 不变 | SC-08f |
| trust／窗／focus | snapshot key | 投影键 | SC-08g |
| 折叠 | 问数默认未折叠全量 | Wiki 披露与图渲染之别 | SC-08h |

---

## 6. 核心流程（伪代码）

见 §4.1。Skill `route`：

```text
route(q):
  clarify D4/D5 if ambiguous
  Q1 -> configured agents / available tokens
  Q2/Q3 -> §4.2 activity only
  Q4 -> D16 MECE ①–⑤ (deepest wins)
  map -> §5.4
  Q5 -> window-unvisited tables (D17); if user said 从未/上线满30天: rephrase then answer C
  Q6 -> D19 measures
  P2 -> refuse
  business active token / UI accounts -> usage overview
```

---

## 7. Skill／Wiki

触发词：有效 Agent、配置 Agent、可用 Token、沉默、连续 N 天未访问、窗口无记录、窗口仅连接、窗口轻量业务未问、窗口浏览未问（别名→③）、窗口查数未问、窗口问询活跃、正式问询、真实问询、闲置授权、需复核、确凿越权、授权路径、访问路径、原始调用、近窗未访问、表活跃率、访问关系图、治理投影快照。

Wiki 必含：图≠论述；三套 Agent／Token 人口、§4.2≠189、Q4 MECE 五档、Q5＝近窗未访问、Q6 公式、§5.4、D23＝E（问数归因≠图凭证清单）、时区、旧 Role 须显式扩权、旧源与治理源分支。

---

## 8. Spec 149 冲突裁决

| 原句 | 裁决 |
|---|---|
| 人口只有活跃 Agent | 按源回答 |
| 两视图默认用量 | 保留；查询分支独立（D13／N01） |
| SELECT 禁列 | 扩至全部新源 |
| ensure 不扩展已有连接表集 | **修订**：必须扩展 `enabled_tables`，但**以本地 Manifest 物理表为上限**（v0.9.3） |
| ensure 不写已存在 Role／不自动扩表 | **保留**（D22）；缺失 `lucy_ops_reader` 缺则创建见 [`lucy-20261105-customer-default-system-roles-spec.md`](lucy-20261105-customer-default-system-roles-spec.md) |

---

## 9. 验收矩阵

| ID | 断言 |
|---|---|
| SC-01 | 旧两视图回归；**治理源 unready 时旧源仍可查** |
| SC-02 | 显式授权；`*` 不可见 |
| SC-03–SC-04 | 配置 Agent／可用 Token 对账；禁 label 去重冒充 |
| SC-05／05b | Q2 与 §4.2；自追问不等价断言 |
| SC-06 | 沉默含从未入流水的配置 Agent |
| SC-07 | Q4：五档 MECE；有真实问询+仅连接 →⑤；有查数无问询 →④；**仅失败 begin、无浏览/查数** →③；无「从未连接」 |
| SC-24 | `calendar_days=30` 含今日端点公式；固定 `asOf` 与跨午夜夹具；不含「整日不含今日」实现 |
| SC-08–SC-08i | §5.4 对账（含 raw／denied、coverage pathKey、confirmedUnauthorized） |
| SC-09 | 需复核／确凿越权措辞 |
| SC-10 | 问数 `(agent,label)` 调用量＝该 Agent 下该 label 的默认用量 |
| SC-10b | A／B 同 label 调用 1／2 → 问数 1 与 2 |
| SC-10c | 不要求与图凭证清单一行相等（E） |
| SC-11 | Q5＝近窗未访问：授权面 anti-join；有访问者剔除；旧问法改述；不依赖上线锚点／全史 |
| SC-12 | Q6：D19 公式；deny／探针／跨日／同日重复／denom 反例 |
| SC-13–SC-15 | Skill／Wiki／术语 |
| SC-16 | 新源禁列 |
| SC-17a–c／e | 表集／模板／未扩权时新源不在允许集／官方历史 stock 资产可升级为当前模板、仅非 stock 字节差才记冲突；ensure 后 `lucy-ops.enabled_tables` ⊆ 本地 Manifest 物理表（冻结表无「已启用 · 本地无 Manifest」）；ensure 后 access.yaml Role 字节不因本条自动变长 |
| SC-17d／SC-17f | **拆出。** 现场扩权查询与升级 runbook 不在本条出口 |
| SC-18 | unready／partial 不伪 0；半份物化不发布 |
| SC-19 | **拆出。** 四门禁与落盘清单记在收口审阅，不是本条用户承诺 |
| SC-20 | 不同 `query_key` 并发互不串读 |
| SC-20b | 同 `query_key` TTL 刷新：已绑定查询仍读旧 `materialization_id`；新查询读新代 |
| SC-21 | 构建中途配置变更 → 不发布脏快照 |
| SC-22 | §4.1 四则 JSON 在夹具可执行；`gov.*` 不出现在上游语义请求中 |
| SC-23 | `gov.focus_token_label` 不改变 `grant_paths`；普通 `agent_id` 行滤不触发子图重建 |

---

## 10. 风险

快照陈旧、旧 Role 未扩权被误报「无能」——用 D26／D22 与 SC 挡。Q5 已不再依赖全史热库。

开放问题（文档级）：台账号是否占用（当前无）。

---

## 11. 参考

- 审阅：`docs/reviews/2026-11-01-codex-review-ops-evidence-askable-governance.md`
- 收口：`docs/reviews/2026-11-02-ops-evidence-askable-governance-closure.md`
- Manifest 升级自愈：[Spec](lucy-20261104-lucy-ops-manifest-upgrade-heal-spec.md) ／ [Plan](../plans/lucy-20261104-lucy-ops-manifest-upgrade-heal-plan.md)
- Spec 149／187／189／194；名册 Spec
- `webui/server/admin/access-map.ts`；`webui/server/proxy/audit.ts`；`webui/server/ops-evidence/**`
