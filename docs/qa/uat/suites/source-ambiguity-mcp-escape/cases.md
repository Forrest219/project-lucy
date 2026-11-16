# Cases — UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health＋MCP initialize | demo healthy；MCP Proxy 可达 |
| UAT-SAG-ESC-01 | 泛化业务词 begin＋唯一钉选首次即可成交 | MCP 全真 | Spec SC-E01；错题 S1 | **首次** `lucy_query` 直接成交／合法空结果；禁止先 deny 再凑绿 |
| UAT-SAG-ESC-02 | 窄意图 begin 对照仍可查 | MCP 全真 | Spec SC-E03；错题 S2 | 首次 query 成交或合法空结果；禁止业务拒绝凑绿 |
| UAT-SAG-ESC-03 | 非 person 不得伪造宿主 confirm | MCP＋HTTP | Spec SC-E04；SC-17 HTTP | confirm → 403；不得靠同 Bearer 自证放行 |
| UAT-SAG-ESC-04 | **v2** 客户形态：样例行查询（dimensions 限定＋即席度量） | MCP 全真 | 客户截图 1；Spec SC-E01 | 首次 query 成交；非 `source_ambiguity_gate` |
| UAT-SAG-ESC-05 | **v2** 客户形态：未限定字符串 filter／即席度量表名只在 expr 内 | MCP 全真 | 客户截图 2；Spec SC-E01／E15 | 首次 query 成交；未知 dotted filter 仍拦 |
| UAT-SAG-ESC-06 | **v2** explain 与 never_begun 同优先级；deny 后集内钉选重试；集外钉选后重新 begin | MCP 全真 | Spec SC-E05／E06／E13／E14／E16 | 见下 |
| UAT-SAG-ESC-07 | **v2** 合法多表 join（语义层已声明 join）在泛化词 begin 下可成交 | MCP 全真 | 第一性原理「主路径可用性」；Spec 未覆盖 | 见下 |
| UAT-SAG-ESC-08 | **v2** 硬线拦截（来源数超上限）的拒绝载荷须给可执行下一步 | MCP 全真 | Spec §4.4 H1／SC-E08／E29；错题 §5.2 | 见下 |
| UAT-SAG-ESC-09 | **v0.4** 容错披露与审计：档②放行带 `sourceSelection`，档①不带；审计有记录 | MCP＋审计 | Spec D13／D14；SC-E25／E26 | 见下 |
| UAT-SAG-ESC-10 | **v0.4** 跨连接多来源拦截并给「按连接拆分」下一步 | MCP 全真 | Spec D15；SC-E28 | 见下 |

> **v2 扩展（2026-11-16 夜）**：ESC-04～08 由 [fidelity 跑次](runs/2026-11-16-cursor-sag-escape-fidelity.md) 新增，补 ESC-01～03 未覆盖的客户形态与拒绝载荷。已按分析师群体主路径通用性升为**必做**（见 suite.md）；ESC-07 当前 FAIL。**v0.4（2026-11-16 夜）按容错三档修订 ESC-06／07／08 期望并新增 ESC-09／10**；修订期望依据 Spec §4.5。v0.4 已授权并实现，复测见 [v0.4 跑次](runs/2026-11-16-cursor-sag-escape-v04.md)。

---

## UAT-R0 — 环境门禁

### 前置

本机 demo compose 已起。

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 记录 `gitSha`／`lucyVersion`／`ktxRuntime`／`gitDirty`  
2. `POST http://127.0.0.1:57881/mcp` `initialize`（Bearer 只从 fixtures 路径读入进程）→ 200＋`mcp-session-id`

### 期望

WebUI／MCP 同实例可用；`ktxRuntime` ready（或合同允许等价）。

### 清理

无。

---

## UAT-SAG-ESC-01 — 泛化业务词 begin＋唯一钉选（WorkBuddy 死路）

> **优化后期望（PASS 判据）**，对齐 P1-35 Spec SC-E01。优化前基线 [FAIL](runs/2026-11-16-claude-sag-escape-baseline.md)；优化后复测 [PASS](runs/2026-11-16-cursor-sag-escape-retest.md)。不得改期望迁就实现。

### 前置

UAT-R0 PASS；可见源含 ≥2 张「超市」相关表（demo：`superstore_orders`／`people`／`returns`）。**本条全程不使用** person actor、**不调用**宿主 confirm、**不依赖** O1 参数确认（本波不做）。

### 步骤

1. 新 MCP 会话：`initialize` → `notifications/initialized`  
2. `lucy_begin_question`：  
   - `question`＝「超市最近怎么样」  
   - `intentSummary`＝「未选表概况：询问超市业务最近状况，未指定来源表」  
3. 同会话 **首次** `lucy_query`：  
   - `connectionId=demo-mysql`  
   - `measures=["superstore_orders.order_count"]`  
   （已限定订单表；模拟客户「表名已写死仍被拦」）

### 期望（优化后）

**仅**以下为 PASS：

- 步骤 3 的**首次** `lucy_query`：**直接**非 `isError`，有业务行或合同允许的**合法空结果**；且原因码**不是** `source_ambiguity_gate`

**明确 FAIL**：

- 首次 query 为 `source_ambiguity_gate`（无论 `usableTargets` 是否非空、无论后续重试／confirm 能否成交）  
- 或以「先 deny 再钉选重试」「MCP 确认通道」作为本条 PASS 分支（那些能力另由 SC-E13／实现债覆盖，**不**替代 ESC-01）

### 清理

会话可丢弃。

---

## UAT-SAG-ESC-02 — 窄意图 begin 对照

### 前置

UAT-R0 PASS；与 ESC-01 **不同**会话。

### 步骤

1. 新会话 `initialize` → `initialized`  
2. `lucy_begin_question`：  
   - `question`＝「查询 superstore_orders 订单数」  
   - `intentSummary`＝「仅查询 superstore_orders 订单明细金额」（**禁止**写入「超市」等仍会多表命中的泛化词；对照错题本 S2）  
3. 同会话 **首次** `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`

### 期望

- 首次 query：**成交**（有度量结果行）或合同允许的**合法空结果**（上游返回空行且非错误）  
- **不得**因 `source_ambiguity_gate` 失败  
- **不得**以「上游业务拒绝／其他错误码但不是 ambiguity」凑绿（对齐 Spec SC-E03）

### 清理

会话可丢弃。

---

## UAT-SAG-ESC-03 — 非 person 不得伪造宿主 confirm

### 前置

UAT-R0 PASS；可用与 MCP 相同的 Agent Bearer（demo 现行 token **无** `actor_kind: person`）。

### 步骤

1. （可选）构造任意会触发 `source_ambiguity_gate` 的多表未钉选请求，记录候选四元组与 generation（若响应可见）——**或**直接用已知四元组试探 confirm  
2. `POST http://127.0.0.1:57881/mcp/host/source-ambiguity/confirm`  
   - Authorization＝同一 MCP Bearer  
   - **不**带 `x-lucy-host-attestation`，或带 attestation 但身份非 person  
   - body 含 `sessionId`／`generation`／`selectedIdentity`（可用超市订单四元组；字段不全时仍应被拒）  
3. 观察 HTTP 状态与 JSON `reason`  
4. （可选）同会话再发满足 D1 的单钉选 `lucy_query`：按 Spec D1／D9，**可以**独立 allow——**不得**把「confirm 失败」推成「query 必 deny」；本条只断言步骤 2–3 的 HTTP 门

### 期望

- HTTP **403**（或合同等价禁止码）  
- `reason` 含 `host_confirm_requires_person`（或缺 attestation 的等价 reason）  
- **不得**返回 200；不得仅凭该自证使「未钉选多表」请求放行

### 清理

无持久化配置变更；会话可丢弃。

---

## UAT-SAG-ESC-04 — 客户形态：样例行查询（v2）

> 对应客户截图 1（「先看字段、字段含义和几条样例数据」，补完整来源后仍被拦）。`sl_query` 要求 `measures` 至少 1 项，故样例行＝即席度量＋限定维度。

### 前置

UAT-R0 PASS；新会话。

### 步骤

1. `lucy_begin_question`：`question`＝「先看这张表的字段、字段含义和几条样例数据，了解一下表结构。」；`intentSummary`＝「了解超市订单表的结构和样例数据」  
2. **首次** `lucy_query`：`connectionId=demo-mysql`；`measures=[{expr:"count(superstore_orders.order_id)",name:"n"}]`；`dimensions` 为 `superstore_orders.order_id`／`region`／`sales`；`limit=5`  
3. 同法再测两种限定写法：仅物理表 `superstore_returns`（无语义度量源）；全名 `dataforai.superstore_orders.order_id`

### 期望

三次**首次** query 均非 `source_ambiguity_gate`，响应含 `answer_verifiability` 与对应 `sourceName`。

---

## UAT-SAG-ESC-05 — 客户形态：未限定字符串 filter／即席度量（v2）

> 对应客户截图 2（`company_code='9999'`、`stats_yyyymm in (...)` 这类未带表前缀的字符串 filter）。

### 步骤

1. begin（泛化词，如 `超市`）  
2. **首次** `lucy_query`：`measures=["superstore_orders.total_sales"]`；`filters=["region='East'","discount > 0.2"]`  
3. 另会话：`measures=[{expr:"sum(superstore_orders.sales)",name:"s"}]`（表名只出现在 expr）  
4. 另会话：同 2，但 `filters=["foo_table.bar = 1"]`

### 期望

- 2、3：首次成交，非 ambiguity  
- 4：`source_ambiguity_gate`，`detail=unresolved_source_refs`（SC-E15，钉选不得放过幽灵引用）

---

## UAT-SAG-ESC-06 — explain／never_begun／重试路径（v2）

### 步骤（每步独立会话）

1. begin（`超市`）→ `lucy_explain_query` 单钉选 `superstore_orders.order_count` → 期望 allow  
2. **不** begin → `lucy_query` 单钉选 → 期望 allow（D3）  
3. **不** begin → `lucy_query` 双身份（orders＋returns，已声明 join）→ **v0.4 期望档① allow**（v0.3 曾期望 deny；已被 D12 取代）；**无任何钉选**（如 `sum(sales)`）→ `context_missing`／`explicit_table_required`（M12）  
4. 硬线 deny 后重试＝ESC-08 步 4（超上限 deny → 单来源重试 allow）；v0.3 的「多表 deny 后集内重试」随 D10 取消（多表不再 deny）  
5. begin（`退货和区域人员`，命中 returns／people）→ query 钉选 `superstore_orders`（集外）→ **v0.4 期望：allow＋披露 `pin_outside_hits`**（SC-E24；v0.3 曾期望 deny，已被 D10 取代）  
6. begin（`超市`）→ `lucy_read_source` → 期望不受门闩（SC-E11）

### 期望

逐步如上；任一不符即 FAIL。

---

## UAT-SAG-ESC-07 — 合法多表 join 可成交（v2）

> **期望依据**：仓库第一性原理「主路径可用性优先」＋语义层 `superstore_orders.yaml` 已声明 `joins`（→ returns／→ people）。P1-35 Spec 对多身份请求只写「不走钉选」，**未**给出 join 逃生；本条属 Spec 空白，非改期望迁就实现。

### 步骤

1. begin（`订单与退货关联`；`intentSummary`＝「查询 superstore_orders 与 superstore_returns 关联的退货分布」——**如实**点名两表）  
2. **首次** `lucy_query`：`measures=["superstore_orders.order_count"]`；`dimensions=[{field:"superstore_returns.returned"}]`；`limit=5`  
3. 对照（诚实性）：begin 改为不含任何表词的 intent（如「按原因拆分的统计」）后同 query

### 期望

- 步骤 2：成交或合法空结果，**不得** `source_ambiguity_gate`；**v0.4＝档① allow，响应不含 `tolerated`**（SC-E21）  
- 步骤 3 **不得**比步骤 2 更容易成交：如实声明意图的用户不得比含糊意图的用户更难查数
- 步骤 4（v0.4）星型三表：orders 度量＋returns 维度＋people 维度 → 档① allow 或上游合法拒绝（一对多聚合不安全等），**不得** `source_ambiguity_gate`（SC-E22）  
- 步骤 5（v0.4）未连通多来源（demo 的 returns＋people，或自造互无声明 join 的 `uat_sag_1`＋`uat_sag_2`）→ 门闩放行（档②，审计 `unjoined_multi_source`）；上游自行拒绝则返回上游错误且**不是** `source_ambiguity_gate`（SC-E23；上游规则下此类查询必被拒，披露字段仅在成功响应出现，故以审计事件取证）  
- 步骤 6（v0.4）单端声明 join（orders 声明→returns／people，对端无 yaml）亦算连通＝步骤 2／4 档①（SC-E30）

---

## UAT-SAG-ESC-08 — 硬线拦截的拒绝载荷可执行（v2；v0.4 改夹具）

> Spec §4.4：`argsShape` 校验「相对候选 T 的重试形态」，**不是**要求原多身份 args 对每个候选合法；H1（至少一个候选 schema／completion／visible／callable 全真）→ `usableTargets` **必须非空**。错题 §5.2：拒绝要么给出可重试目标，要么明确说明需宿主介入。  
> **v0.4**：多表词不再 deny（D10），故原夹具（orders＋returns 多身份 deny）已不是拦截场景。现行夹具＝**来源数超上限**（D15，SC-E29）。**v0.3 构建上**原夹具实测 `usableTargets=[]`、orders 被判 `invalid_parameter_shape`（见 fidelity 跑次），该偏差在 v0.4 实现中必须一并消除。

### 前置

UAT 自造 ≥5 个同词来源 `uat_sag_1`…`uat_sag_5`（带 yaml、completion 完成、命名含「超市」类共享词），授予测试 Agent 可见。

### 步骤

1. begin（共享词）  
2. `lucy_query` 同时引用 5 个来源的度量（`keys.length=5>4`）  
3. 读取 `data.repair.usableTargets`／`rejected`／`factualError`  
4. 取 `usableTargets` 任一目标改写为单来源重试

### 期望

- 步骤 2：`source_ambiguity_gate`，零执行  
- `usableTargets` 非空，含五来源之一；`rejected` 不得以 `invalid_parameter_shape` 拒绝其中可成交者；`factualError` 不得断言「没有可用的合法目标」  
- 步骤 4：成交

### 清理

删除 `uat_sag_*` 夹具；会话丢弃。

---

## UAT-SAG-ESC-09 — 容错披露与审计（v0.4）

### 步骤

1. 档①：begin（`超市`）＋单钉选 `superstore_orders.order_count` → 响应 `answer_verifiability.sourceSelection.status≠tolerated`（或字段缺省）  
2. 档②：begin（`退货和区域人员`）＋钉选 `superstore_orders`（集外）→ 响应含 `sourceSelection{status=tolerated,reason=pin_outside_hits,usedSources[],termHits[]}`  
3. 读审计（WebUI／sqlite 审计读路径）：步骤 2 有一条容错事件；步骤 1 无；事件不含取值与凭据  
4. 确认本波**不存在**自动收紧逻辑（无阈值开关）

### 期望

如上；披露不依赖 Agent 文本。

---

## UAT-SAG-ESC-10 — 跨连接多来源拦截（v0.4）

> 夹具：UAT 自造第二连接 `demo-mysql-b`（同 demo-db）及其专属来源 `uat_sag_b`（含「超市」词，授予测试 Agent 可见）；`lucy_query` 的 `connectionId` 取 `demo-mysql`，度量同时引用 `superstore_orders` 与仅存在于 B 连接的 `uat_sag_b`（`lucy_query` 无法直接写跨连接引用，跨连接键只能经反查产生）。

### 步骤

一次 `lucy_query` 引用两个不同连接的来源（或在 `connectionId` 之外引用另一连接来源）。

### 期望

拒绝，零执行；`message` 与 `usableTargets` 给出可执行下一步（按连接拆分为单连接查询）。
