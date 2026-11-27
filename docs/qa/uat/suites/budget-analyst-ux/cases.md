# Cases — UAT-SUITE-BUDGET-ANALYST-UX

| 元数据 | 内容 |
|---|---|
| UAT 设计版本 | **v1.1**（Spec §10.3 六项同步；取代 v1.0 旧映射） |
| 执行状态 | NOT RUN；设计已同步；实跑另按开发授权与跑次记录 |
| 公共判定 | 真实 MCP／真实 Claude Code；成交必须匹配独立数据库 oracle；拒绝臂与成交臂双覆盖 |

| ID | 标题 | Spec | 层级 | 期望摘要 |
|---|---|---|---|---|
| UAT-BA-R0 | 环境、身份、事实 oracle（引用 PRE-01 证据） | — | 手工／脚本 | 固定版本、多身份授予、慢源标定、预算零态；**只引用**已落盘 PRE-01，不现场抓包 |
| UAT-BA-01 | 重查询第 61 次触顶，防火墙仍生效 | SC-01 | MCP 全真 | 第 61 次 `lucy_query` → `question_budget_exhausted`，`outcome=budget_stop` |
| UAT-BA-02 | 轻工具独立 200 次上限且不占主预算 | SC-02 | MCP 全真 | 前 200 次放行且 `calls=0`、`busyMs=0`；第 201 次触独立上限 |
| UAT-BA-02b | 轻工具跨窗 runaway 有界＋合法换窗成交 | SC-02b／OQ-6＝A | MCP 全真 | 敌对臂：200→换窗循环→续查档尽硬停；正臂：合法换窗后继续探表成交；无 `metaCallsLifetime`／速率独立 reason |
| UAT-BA-03 | 轻重并发分池互不干扰＋超限结构化拒绝 | SC-03 | MCP 全真 | 8 轻＋8 重并行全放行；第 9 路重查询／第 17 路轻工具结构化拒绝且不扣主预算 |
| UAT-BA-04 | 缩并发重试真实成交 | SC-04 | MCP 全真 | 第 9 路被拒后缩并发重发，合法查询成功出数且匹配 oracle |
| UAT-BA-05 | 45 秒慢查询不被 30s 掐断 | SC-05 | MCP 全真 | 慢源 45s 首字节正常返回，`busyMs=45000` 全额结算 |
| UAT-BA-06 | 900s 忙时窗口与续查成交（兼 BESC-10A） | SC-06 | MCP 全真 | 15×60s 放行；第 16 次 exhausted；`lucy_continue_question` 换窗后成交 |
| UAT-BA-07 | 失败封顶＋`failedKind` 窄集合（OQ-4 正臂） | SC-07／OQ-4 | MCP 全真＋审计 | 4×超时封顶 30s 后第 5 次成交；settlement 含 `failedKind=timed_out`＋raw／billed；`no_data` 对照臂不封顶 |
| UAT-BA-07b | 持续失败最终停机＋跨窗总档（OQ-4 敌对臂） | SC-07b／OQ-4 | MCP 全真＋审计 | 单窗靠 calls／busy 截停为 `question_budget_exhausted`；换窗后仍受续查总档约束；无连败 N reason |
| UAT-BA-08 | Esc 中断后 5s 冻结期满可重问 | SC-08 | MCP 全真 | 断开 8 路在途后 5.5s 新查询成交 |
| UAT-BA-09 | 多 Token 共连接 32 路＋全信封＋释放后成交 | SC-09 | MCP 全真 | 32 路放行；第 33 路完整 D2 信封；槽释放后缩并发 oracle 成交 |
| UAT-BA-10 | begin active 续查 3 档与第 4 次硬停（兼 BESC-07） | SC-10 | MCP 全真 | active 前 3 次续查成交；第 4 次硬停指向 `lucy_begin_question` |
| UAT-BA-11 | 环境变量全量回退旧档 | SC-11 | 独立容器 | 容量与预算／超时／冻结精确回退 |
| UAT-BA-12A | Claude Code 静默逃生（begin 可见／continue） | SC-12 A | Agent 全真 | `continuable=true` 静默 `lucy_continue_question` 后成交；缩并发重试；无 `"stop looping"` 提前放弃 |
| UAT-BA-12B | Claude Code 静默逃生（begin 隐藏／new_question） | SC-12 B | Agent 全真 | 续查档尽后同一 `continueToken`＋`mode=new_question` 重开成交 |
| UAT-BA-13（可选） | `hive-jd` 真实目录现场补跑 | SC-05／09 变体 | 客户环境 | 真实外部 Hive Catalog 补验 |
| **勾连** UAT-IMC-03 | integration 轻／重混合 workload（REQ-0119） | SC-03 跨 Spec | 跨套件 | ≥2 integration Agent 轻元数据＋重查询混合计入 `integrationActive`、触达 `borrowMax`；保留 interactive meta 成交正臂 |

---

## 公共定义与证据

- **合法身份**：Token、Agent、数据工具、connection、source 和行权限均允许 fixtures 查询；开跑前用普通查询匹配 oracle，排除 ACL／语义／连接故障。
- **重查询工具**＝`lucy_query`／`lucy_certified_route`／`lucy_report_template`；**轻工具**＝`lucy_read_source`／`lucy_freshness`／`lucy_explain_query`／`wiki_search`／`wiki_read`。
- **真实成交**：工具成功、返回 fixtures 预期事实行、关键值匹配独立只读 oracle；空 envelope、ACL／上游错误均不算成交。
- **拒绝臂证据**：完整结构化载荷（`reason`、`retryable`、`retryAfterMs`、`next_step.action`、`next_step.max_inflight`）与准入审计快照；拒绝不扣 `calls`/`busyMs`。
- **预算证据**：脱敏 identity／session、round、windowId、calls、busyMs、metaCalls、continuations、requestId、reason、continuable 与 `budgetSettlement`（`failedKind`／`rawDeltaMs`／`billedBusyMs`）；不得记录 Token 明文。
- **PRE-01**：正式 UAT **不**再执行三模式抓包；R0 只引用 [`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../../../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)（OQ-5 未触发）。

---

## UAT-BA-R0 — 环境、身份与事实 oracle

### 步骤

1. `GET /api/health`，记录版本、gitSha、dirty、镜像／配置指纹和 KTX 版本。
2. **引用** PRE-01 证据路径与结论摘要（三模式无 `-` 桶；多终端独立 session；Subagent 复用父 session）。**禁止**本跑次重新抓包冒充 PRE-01。
3. 对每类身份执行真实 MCP `initialize`／`tools/list`，记录 begin、continue 与数据工具可见性；读取 interactive `initialize` instructions，确认 D7（无 `"stop looping"` 首句、含并发上限披露）。integration 静态指引不在本条验收。
4. 部署并标定慢源夹具（45s／60s／90s，见 [fixtures](fixtures.md)）。
5. 读取脱敏预算初态；非已知零态不得用于边界判定。
6. 独立数据库只读 SQL 计算 fixtures oracle，再执行一次普通合法 query 核对。
7. 记录跨套件勾连：`UAT-IMC-03` 轻／重混合臂待跑或已跑指针（不得用本套件 interactive 身份冒充）。

### 期望

- 依赖未命中 → 相关用例 `BLOCKED`，不得假绿。

---

## UAT-BA-01 — 重查询第 61 次触顶

### 步骤

1. 零态作用域连续发起 61 次成功路径 `lucy_query`（忙时未超）。
2. 记录第 60／61 次响应与审计。

### 期望

- 第 61 次 `question_budget_exhausted`，`outcome=budget_stop`。

---

## UAT-BA-02 — 轻工具 200 次独立上限

### 步骤

1. 零态连续 201 次 `lucy_read_source` 或 `wiki_search`。
2. 核对主桶 `calls`／`busyMs` 与 `metaCalls`。

### 期望

- 前 200 次放行且主桶 `calls=0`、`busyMs=0`；第 201 次独立上限触顶。

---

## UAT-BA-02b — 轻工具跨窗有界（OQ-6＝A）

### 步骤（敌对臂）

1. 单窗刷满 200 次轻工具至触顶。
2. `lucy_continue_question`（或 `mode=new_question` 按档）换窗，确认窗内 `metaCalls` 清零后可再调用。
3. 重复直至续查／`new_question` **总档尽**。
4. 再发轻工具，记录停机 reason。

### 步骤（正臂）

1. 新零态：未跑满总档前合法换窗，继续 `lucy_read_source` 探表并成交（匹配 oracle／元数据可读性约定）。

### 期望

- 敌对臂：档尽后硬停，reason 与查数路径一致（`question_budget_exhausted`／既有硬停再开）；**无** `metaCallsLifetime`、**无**速率护栏独立 reason。
- 正臂：合法换窗后继续成交。
- 缺任一臂 → 不得 PASS。

---

## UAT-BA-03 — 轻重并发分池

### 步骤

1. 同时并发 8×`lucy_read_source`＋8×`lucy_query`。
2. 另测单 Token 并发 17×`lucy_read_source`。
3. 第 9 路并发 `lucy_query` 记录完整拒绝载荷。

### 期望

- 8＋8 互不干扰放行；第 9 路重查询 `question_budget_concurrency_exceeded` 含 `retryable:true`、`retryAfterMs`、`next_step.max_inflight=8`，不扣 `calls`/`busyMs`；第 17 路轻工具被元数据池（token 16）拒绝并返回同等可执行重试信号。

---

## UAT-BA-04 — 缩并发重试成交

### 步骤

1. 承接 BA-03 第 9 路拒绝。
2. 待部分在途完成，客户端缩并发重发合法 `lucy_query`。

### 期望

- 成交且匹配 oracle。

---

## UAT-BA-05 — 45s 慢查询

### 步骤

1. `lucy_query` 打到 45s 首字节慢源夹具。

### 期望

- 不被 30s 空闲超时掐断；`busyMs=45000` 全额结算。

---

## UAT-BA-06 — 900s 忙时＋续查

### 步骤

1. 连续 15 次 60s 成功查询（累计 900s）。
2. 第 16 次应触顶；`lucy_continue_question` 换窗后重试成交。

### 期望

- 与 SC-06／BESC-10A 一致。

---

## UAT-BA-07 — 失败封顶正臂（OQ-4）

### 步骤

1. 连续 4 次构造上游超时失败（单次约 90s，封顶记账）。
2. 第 5 次正常查询。
3. 导出 `budgetSettlement`：核对 `failedKind=timed_out`（或 `upstream_disconnect`／`tool_is_error` 窄集合内）、`rawDeltaMs≈90000`、`billedBusyMs=30000`。
4. **对照臂**：构造合法空结果（`no_data`），确认**不**按 30s 失败封顶记账。

### 期望

- 4 次封顶合计 busy＜900s；第 5 次成交；审计三字段齐全；`no_data` 不冒充失败封顶。

---

## UAT-BA-07b — 持续失败敌对臂（OQ-4／SC-07b）

### 步骤

1. 单窗持续超时失败直至触顶（不要中途插入成功查询）。
2. 记录停机 reason 与 settlement。
3. 在仍有续查档时换窗，继续失败直至续查／`new_question` 总档尽。
4. 再发失败查询，记录最终硬停。

### 期望

- 单窗最终 `question_budget_exhausted`（由 `calls≤60` 或 `busyMs≤900s` 截停）；**无**「连续失败 N 次」独立 reason。
- 跨窗仍受 D6／P1-74 总档约束；全程可区分 `failedKind` 与 raw／billed。

---

## UAT-BA-08 — Esc 后 5s 可重问

### 步骤

1. 8 路慢查询在途时客户端断开（模拟 Esc）。
2. 自断开起等待 5.5s，再发新 `lucy_query`。

### 期望

- 新查询准入成交（不再锁死 30s）。

---

## UAT-BA-09 — 32 路＋全信封＋释放后成交（SC-09）

### 步骤

1. 4 个不同 Token 各并发 8 路访问同一连接（合计 32）。
2. 发第 33 路，保存完整拒绝载荷。
3. 待槽位释放，客户端按 `next_step` 缩并发重试，独立 SQL 核对 oracle。

### 期望

- 32 路全放行。
- 第 33 路按 `connection` 拒绝，且同时含：`retryable:true`、`retryAfterMs`、`next_step.action=reduce_concurrency_and_retry`、可执行 `max_inflight`（与 D2 一致）。**只验 `retryAfterMs` 不算 PASS**。
- 释放后缩并发重试成交且匹配 oracle。
- 若实现需改 D2 reason／字段语义 → 升 OQ，本臂不得静默改期望。

---

## UAT-BA-10 — begin active 3 档

### 步骤

1. active 身份连续耗尽 3 档续查。
2. 第 4 次续查前硬停。

### 期望

- 前 3 次换窗成交；第 4 次 `next_step` 指向 `lucy_begin_question`；预算终止不计四类失败维度。

---

## UAT-BA-11 — 环境变量回退

### 步骤

1. 独立容器设置 Spec SC-11 全量旧档变量。
2. 核对容量快照与行为回退。
3. 恢复默认档。

### 期望

- `resolveCapacityLimits()`＝`4/8/16/24`；预算并发／忙时／active 续查／超时／取消冻结全部精确回退。

---

## UAT-BA-12A — Claude Code begin 可见臂（SC-12 A）

### 步骤

1. 真实 Claude Code＋慢查询夹具；begin 可见，使能 `continuable=true` 路径。
2. 任务须触发预算触顶与并发超限。
3. 保存轨迹：工具调用、续查、缩并发重试、最终答复。

### 期望

- 静默调用 `lucy_continue_question` 后继续成交；自动缩并发；不因 `"stop looping"` 提前放弃；答复匹配 oracle。

---

## UAT-BA-12B — Claude Code begin 隐藏臂（SC-12 B）

### 步骤

1. begin 不可见／零绑定实况；耗尽续查档。
2. 按结构化 `next_step` 以**同一** `continueToken`＋`mode=new_question` 重开。
3. 保存轨迹与最终答复。

### 期望

- `mode=new_question` 端到端成交；缩并发重试；无提前放弃；匹配 oracle。
- **仅 12A PASS 而 12B 未跑／失败 → 套件不得主张 SC-12 PASS**。

---

## 跨套件勾连 — UAT-IMC-03（轻／重混合）

本条不替代 REQ-0119 套件执行；正式判定时须同时满足：

1. ≥2 个 `workloadClass=integration` Agent 发起**轻元数据**（如 `lucy_read_source`）与**重查询**混合负载；
2. 合计计入 `integrationActive`，触达 `borrowMax` 时 workload 拒绝且**无新上游**；
3. 另保留 interactive 身份元数据／小查询成交正臂（证明元数据池不绕过 workload，也不误伤 interactive）。

细则与步骤以 [`../integration-mcp-capacity/cases.md`](../integration-mcp-capacity/cases.md) `UAT-IMC-03` 为准（v1.0-r4 已扩写混合臂）。
