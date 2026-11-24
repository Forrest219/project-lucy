# Cases — UAT-SUITE-MCP-UPGRADE-COMPATIBILITY

| ID | 标题 | 期望摘要 |
|---|---|---|
| UAT-COMPAT-R0 | 身份与全真环境门禁 | capture／候选／POST 身份、Public MCP、所选 Agent／模型指纹、**数据快照 ID**、Role／Token 指纹与题库摘要明确；不匹配即 BLOCKED |
| UAT-COMPAT-01 | 独立简单单表问题 | 真实 Agent 自然语言提问；typed gold 正确，至少一条本问真实 `lucy_query` |
| UAT-COMPAT-02 | 时间、过滤、分组与合法空结果 | 四类各至少一题（QB-BIZ-02a–d）；合法空≠错误／空信封 |
| UAT-COMPAT-03 | 同会话时间窗连续追问 | 「那 12 月呢？」等沿用前文；禁止重开新会话或改写成独立完整问题 |
| UAT-COMPAT-04 | 同会话分组与比较追问 | 「再按区域拆分」「和上月相比呢？」上下文与计算正确，逐轮计时 |
| UAT-COMPAT-05 | 单表、多表 join 与单表扩展多表 | 已声明 join 成交；同会话从单表扩展关联表仍成交且口径正确 |
| UAT-COMPAT-06 | 单库到多库 | 连接 A／B 分别查询并对比；非法跨连接混查拒绝且提示按连接拆分，无越权 |
| UAT-COMPAT-07 | 无问数工具／无 Source 权限 | **D7a** 显式 `tools/call` deny＋审计；含 **frozen W0-only／02c**；合法对照可成交 |
| UAT-COMPAT-08 | 表／字段分权限＋proven 门 | 表 A／B；字段暴露差分；**03b-gate** 断言 `row_policy_upstream_unproven`（非行隔离成交）；deny→allow FAIL |
| UAT-COMPAT-09 | 会员收入事故永久看守 | Demo＝ESC-11 同形；客户＝私有基线重放；首次不得 `source_ambiguity_gate` |
| UAT-COMPAT-10 | 冷启动首轮与稳态 | Ready 后首轮和稳态均完成真实问答；首轮单列，不被稳态样本掩盖 |
| UAT-COMPAT-11 | 绝对耗时与完整计时 | MCP 绝对预算硬拦；Agent 每轮＞120s → `agentLatency` FAIL；记 `batchWallClockMs`／模型用量；三维字段完整 |
| UAT-COMPAT-12 | 相对退化与回滚恢复 | 基线／POST 可比；相对双门；有回滚则 `ROLLBACK_VERIFY` 条件必做；双证据反篡改负例 |
| UAT-COMPAT-OPS-01 | Ops W0 工具／表调用与拒绝 | `ops_calls`／`ops_call_tables` 的调用、拒绝、耗时经独立 SQL 对账；UTC `call_day` |
| UAT-COMPAT-OPS-02 | Ops W0 表调用排行与拒绝 | 按 `physical_table` 统计调用与拒绝；不得误算成 Token 人口 |
| UAT-COMPAT-OPS-03 | Ops W0 连续追问与生成 SQL | 同会话保留目标表；过滤后读 `generated_sql`，禁止默认高基数分组 |
| UAT-COMPAT-OPS-04 | Ops W0 新鲜度 | `lucy_freshness` 合法可达；区分结构新鲜度与最近业务调用，禁止固定写时间 |
| UAT-COMPAT-OPS-05 | Ops token_label 双口径 | W0＝`ops_calls` 分组；W1＝`ops_tokens`（OPS-05b）；均≠ Token 人口 |
| UAT-COMPAT-OPS-06 | Ops W1 配置 Agent／Token | 配置 Agent 与可用 Token 人口；不得与活跃或 label 行混用；受控权限夹具 |
| UAT-COMPAT-OPS-07 | Ops W1 活跃与沉默 Agent | UTC 活跃名单；配置人口减窗口活跃为沉默；禁说「从未连接」 |
| UAT-COMPAT-OPS-08 | Ops W1 MECE 五档 | 无记录／仅连接／轻量业务未问／查数未问／问询活跃；最深水位只归一档 |
| UAT-COMPAT-OPS-09 | Ops W2 授权／访问路径与越权 | 与 builder meta 对账；确凿越权和孤儿授权有证据，禁第二套算法 |
| UAT-COMPAT-OPS-10 | Ops W2 近窗未访问与表活跃率 | 近窗未访问≠上线从未访问；Asia/Shanghai；比率与分母正确 |
| UAT-COMPAT-OPS-11 | Ops W2 图快照与覆盖率 | 原始调用、拒绝调用、pathKey 去重覆盖率与 builder meta 对账 |

## 通用判定规则

1. 真实 Agent 最终答案必须与本问 typed gold 和真实服务端查询对账；只有文字答案或无关查询不算 PASS。
2. 基线成功的请求在 POST 出现新增 deny、error、空信封、**快照未变**却非空变空或预期指标缺失均 FAIL。
3. 基线应拒绝的请求在 POST 变为允许、返回越权数据或泄露受限身份均 FAIL。
4. 任一必需轮次、所选客户端、尝试或样本缺失即分母不完整；禁止只保留最快／成功样本；禁止因成本删题。
5. 功能／权限／三维不接受 PASS WITH GAP；`DEGRADED_PROVIDER_LATENCY` 不得整体 PASS。
6. 通用车道可用 D21 合成夹具（用后还原）；客户车道禁止伪造基线。入口互不冒充；证据包负控 ≠ 旧版 UAT PASS。
7. Agent 来自 `mcp-compat-clients.yaml` 检测后单选；全程同指纹。

---

## UAT-COMPAT-R0 — 身份与环境

### 步骤

1. 记录候选／capture／POST 的完整 `gitSha`、镜像 digest、Public MCP URL、所选 Agent／模型指纹、Token 指纹、题库 SHA256、**数据快照 ID**。
2. 核对与发布合同声明一致；通用车道确认合成夹具可还原；客户车道确认私有基线路径 0700／0600（升级须已有文件；首次用 `captureInstanceBaseline`）。

### 期望

身份齐全且匹配；缺任一项 → **BLOCKED**（不得开跑冒充 PASS）。

---

## UAT-COMPAT-01 — 独立简单单表

### 步骤

1. 真实 Agent 用自然语言问一道单表简单指标题（通用：demo `superstore_orders`；客户：私有基线题）。
2. 保存最终答案、本问真实 `lucy_query` 请求 ID、typed gold 对账。

### 期望

答案与 gold 一致；至少一条真实成交查询；禁止无查询文字凑绿。

---

## UAT-COMPAT-02 — 时间／过滤／分组／合法空

### 步骤

1. 各发独立问题，映射 QB-BIZ-02a（分组）、02b（合法空）、**02c（时间窗，如 2025 年销售额）**、**02d（过滤，如 Furniture 订单数）**——四类各至少一题。
2. 对账独立 oracle／typed gold。

### 期望

四题均进分母；非空题不得变空（快照未变时）；合法空不得当错误，也不得冒充非空基线。

---

## UAT-COMPAT-03／04 — 连续追问

### 步骤

1. 在一个真实 Agent 会话中问首轮指标题。  
   - **客户层**：可用「查询 2025 年 11 月会员收入」等私有基线原文。  
   - **通用 demo**：无客户表时改用题库冻结的同形词（如超市订单销售额），**不得**因无「会员收入」表删题。
2. 同会话追问「那 12 月呢？」。
3. 同会话追问「再按区域拆分」（客户无区域维则用私有基线等价维）。
4. 同会话追问「和上月相比呢？」。
5. 对每轮保存最终答案、真实请求 ID、用户墙钟与 MCP／服务端耗时。

### 期望

- 各轮分别保留时间窗、分组与比较语义；不得每轮重新开始无关旅程。
- 所有合法轮次成交；出现 `source_ambiguity_gate`、上下文丢失、无真实查询或超时均 FAIL（Agent 墙钟超时按 D16a）。

---

## UAT-COMPAT-05 — 单表到多表

### 步骤

1. 首轮单表成交。
2. 同会话扩展到语义层已声明 join 的关联表（demo：orders→returns／people）。
3. 对照：未声明 join 的多来源不得发明跨表成交冒充 PASS。

### 期望

已声明 join 成交且口径正确；非法多表按产品合同拒绝或上游真实错误，不得越权。

---

## UAT-COMPAT-06 — 多库

### 步骤

1. 在同一授权身份下分别询问连接 A 与连接 B 的既有指标。
2. 要求基于两次已授权结果做对比。
3. 用无 B 权限身份重复，确认不泄露 B。
4. 发起产品不支持的跨连接混查，观察拒绝与下一步。

### 期望

- 合法分别查询与对比成交，不发明跨连接 join。
- 无权限身份不得看到 B 的数据或受限身份；混查提示按连接拆分。

---

## UAT-COMPAT-07 — 无工具／无 Source

### 步骤

1. 无 `lucy_query` 身份：须**显式** `tools/call(lucy_query)`（或等价）→ 稳定拒绝码＋审计 deny＋零上游；「仅 list 缺工具／口头拒答」≠ PASS。
2. 无 Source／跨连接负例（含 **frozen W0-only 夹具** 问 `ops_agents`＝QB-ACL-02c；不绑可 heal 的正式 `lucy_ops_reader`）。
3. 同题合法对照身份 → 成交。

### 期望

D7a 满足；deny→allow FAIL；合法对照 PASS。

---

## UAT-COMPAT-08 — 表／字段分权限＋proven 门

### 步骤

1. 表 A 可见／表 B 不可见：问 B → 拒绝；问 A → 成交。
2. **QB-ACL-03b-gate**：故意 scoped 行收窄后 `lucy_query` → 期望 `row_policy_upstream_unproven`（**不是** East／Southwest 行隔离成交；通用车道不做行隔离成交）。
3. 字段暴露差分：受限字段不得出现在成功结果。
4. 每项保留合法对照（适用时）。客户私有基线层另验行隔离成交。

### 期望

表／字段分权限生效；proven 门看守成立；串权／泄露／deny→allow 均 FAIL。

---

## UAT-COMPAT-09 — 事故负控与修复后

1. **分层负控（SC-14）**：
   - **判定器层**：固定坏 digest／冻结失败证据包回放 → 证明能拦事故。**不得**把证据包结果写成「旧版 UAT PASS」。
   - **当前候选层**：所选真实 Agent 全链路跑同形题；须 PASS 才计入候选／实例分母。
   - **可选**：现存未修旧实例全真复验。
2. 在当前候选上以泛化业务词 begin，再首次查询已明确唯一来源的指标。
3. 客户层用既有 WorkBuddy／MCP 配置与 Token 重放实际会员收入基线（无基线先走 `captureInstanceBaseline`）。
4. 记录首次结果，不允许先 deny 再重试凑绿。

### Demo 层与客户层分判

| 层 | 环境 | 映射 | 放行含义 |
|---|---|---|---|
| Demo 同形 | 本机 demo／通用候选＋MCP | 必跑／复用 [`UAT-SAG-ESC-11`](../source-ambiguity-mcp-escape/cases.md) | 证明事故类路径在候选镜像上已修；**≠** 客户实例放行 |
| 客户基线 | 客户既有 Public MCP＋Token＋私有参数 | 本条步骤 3；私有基线 0700／0600 仓外 | 无基线 → **BLOCKED**，不得客户升级声称「COMPAT-09 客户 PASS」 |

---

## UAT-COMPAT-10 — 冷启动首轮

### 步骤

1. Ready 后立即发首轮真实问答（MCP 对照＋Agent 各至少一题）。
2. 稳态后再跑同题。
3. 首轮与稳态分列证据。

### 期望

首轮不得被稳态样本替代；MCP 首轮受 D11；Agent 首轮受 D16a（＞120s＝FAIL）。

---

## UAT-COMPAT-11／12 — 耗时与回滚

每轮记录 `turnWallClockMs`、`mcpClientRttMs[]`、`serverDurationMs[]`、重试与 `unattributedMs`；入口级记录 `batchWallClockMs`、`modelCallCount`／`tokenUsage`（能取则取）。trace 缺失不编造阶段耗时。

- MCP 绝对／相对：D11／D12 硬拦 → `serviceLatency`。
- Agent 墙钟：每轮 ≤120s；越线 → `agentLatency` FAIL；可写 `DEGRADED_PROVIDER_LATENCY`，**不得**整体 PASS；MCP 绿不能救 Agent FAIL。
- 三维：`functionalCompatibility` ∧ `serviceLatency` ∧ `agentLatency` 全 PASS 才整体 PASS。
- COMPAT-12：基线／POST 相对双门；**发生回滚**则 `ROLLBACK_VERIFY` 条件必做；双证据文件反篡改负例通过。
