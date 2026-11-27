# Cases — UAT-SUITE-INTEGRATION-MCP-CAP

| ID | 标题 | 必做 | SC | 期望摘要 |
|---|---|---|---|---|
| UAT-IMC-R0 | 环境／身份／故障命中门禁 | 是 | SC-01／02 | 双 class Agent、独立 SQL、大响应与慢查询可命中；通过线已预注册 |
| UAT-IMC-01 | workloadClass 持久化与 OpenAPI | 是 | SC-01 | 读写／缺省 interactive／审计 |
| UAT-IMC-02 | 系统间必须 integration 打标 | 是 | SC-02 | 夹具与 SOP；未打标不得充当本套件 integration 臂 |
| UAT-IMC-03 | 多 integration Agent 打满 borrow | 是 | SC-03 | `capacityScope=workload`（或等价）；无新上游 |
| UAT-IMC-04 | borrow 满时 interactive 仍成交 | 是 | SC-04 | 独立 SQL 正确 |
| UAT-IMC-05 | 大明细流式触顶 | 是 | SC-05／06 | 不完整缓冲；interactive 仍成交 |
| UAT-IMC-06 | 上游出口全普查封闭 | 是 | SC-06 | 清单含 readUpstreamBody＋pipeResponse／passthrough；与 Task 0 grep 模式 diff 空；抽测 initialize＋原 pipe 路径触顶 |
| UAT-IMC-07 | 预算：容量拒绝 vs 豁免 | 是 | SC-07 | 容量拒绝不扣 calls；integration 豁免预算＋影子计数；SC-06 中止按 OQ-3(a) 结算 |
| UAT-IMC-08 | T2 混压预注册通过线 | 是 | SC-08 | 成功率＋p95 分母 |
| UAT-IMC-09 | Agent 编辑枚举 | 是（N/A） | SC-01 | **本轮裁定不做 WebUI 枚举** → 固定 **N/A**，以 IMC-01 OpenAPI 为据 |
| UAT-IMC-10 | T4 hold 宽限后回落 | 是 | SC-09 | wait≥hold+5s；capacity 回落 |
| UAT-IMC-11 | 观测＋指引诚实性 | 是 | SC-10／11／12 | health 聚合＋agentId Top-N＋用量聚合＋影子计数；指引含非官方声明与最低契约；sentinel 持续越线定义 |
| UAT-IMC-12 | 延长 soak | 否 | 稳健 | 不改必做判定 |
| UAT-IMC-13 | integration 握手轻量路径 | 是 | SC-13 | 静态指引；不占 instructionsWork 槽位；`tools/list` 同构 |

---

## UAT-IMC-R0 — 环境／身份／故障命中

### 步骤

1. 冻结候选 gitSha／镜像／资源档；启动隔离 Compose；记录 Task 0 预注册通过线。
2. 创建 Agent-I（`integration`）与 Agent-E（`interactive`），独立 Token；验证 OpenAPI／存储。
3. 独立 SQL 核对目标 source；两侧 `initialize → tools/list → lucy_query` 小查询成交。
4. 校准：慢查询在途；超限大响应可构造；记录 `CANCEL_HOLD_MS`。

### 期望

- 任一项未命中 → 依赖用例 `BLOCKED`，不得假绿。

---

## UAT-IMC-01 — workloadClass 持久化

### 步骤

1. 新建 Agent 不传 class → 读回 `interactive`。
2. 更新为 `integration` → 读回一致；审计有变更。
3. OpenAPI schema 含字段。

### 期望

- 与 SC-01 一致；错误 class 值拒绝。

---

## UAT-IMC-02 — 打标 SOP

### 步骤

1. 本套件 integration 臂必须使用 class=integration 的 Agent。
2. 用 interactive Agent 冒充系统间臂跑 IMC-03 前置检查应被测程拒绝（夹具断言）。

### 期望

- 测程 fail-closed，防止标错身份。

---

## UAT-IMC-03 — 多 Agent 打满 borrow

### 步骤

1. 记录 `global`、`R`、`borrowMax`。
2. ≥2 个 integration Agent 合计占满 borrowMax（慢查询保活）。
3. 再发 integration 查询；记录 scope／是否新上游（DB 在途）。

### 期望

- 立即 `query_concurrency_exceeded`＋workload 机读；上游计数不增。

### 反例

- 仅单 Agent 墙拦住、多 Agent 穿透 → **FAIL**。

---

## UAT-IMC-04 — interactive 在 borrow 满时成交

### 步骤

1. 保持 IMC-03 饱和。
2. Agent-E 小查询；独立 SQL 核对。

### 期望

- 成交；不因 integration 饱和而失败。

---

## UAT-IMC-05 — 大明细流式触顶

### 步骤

1. integration 发起超过 per-response 上限的读取／查询。
2. 观察服务端中止、内存／event-loop（sentinel）；同时 Agent-E 小查询。

### 期望

- 机读体量错误；无完整大包常驻；E 成交。客户端截断冒充 → **FAIL**。

---

## UAT-IMC-06 — 上游出口全普查封闭

### 步骤

1. 取得 Task 0 封闭清单与 grep 模式集；对本树重跑同一模式集，**diff 必须为空**。
2. 清单须含 `readUpstreamBody` 与 `pipeResponse`／passthrough／skills 出口及 disposition。
3. 抽测 initialize＋至少一条原 pipe／passthrough 路径的触顶；再抽 ≥1 个非 query 缓冲工具。若环境不可构造该触顶，跑次须注明并以 Plan Task 3 单测证据挂链，**不得无证据跳过**。

### 期望

- diff 非空或存在无界 pipe 合规项 → **FAIL**；触顶无证据 → **FAIL**／`BLOCKED`。

---

## UAT-IMC-07 — 预算：容量拒绝 vs 豁免

### 步骤

1. 记录 Token 预算 counters。
2. 触发纯容量拒绝（未上游）→ calls／busy **不**因该拒绝增加。
3. Agent-I 单会话连续执行**远超单问询上限**（≥ 60 次）的 `lucy_query`：全程**不**出现 `question_budget_exhausted`、无续问要求；同时影子计数随调用累计并可在 health 摘要读出。
4. （可选开关臂）将豁免 env 关回重启后重复步骤 3 前若干次调用 → 恢复预算拦截；恢复默认后 `interactive`（Agent-E）行为始终不变。
5. 触发 SC-06 中止（上游已开始）→ counters 按既有 upstream 失败规则结算（不重复扣减、无负计数）；不与 `question_budget_exhausted` 混淆。

### 期望

- 步骤 2／3／5 分别取证，缺一步 → **FAIL**；豁免生效期间出现 `question_budget_exhausted` → **FAIL**；Agent-E 行为发生变化 → **FAIL**。

---

## UAT-IMC-08 — T2 混压

### 步骤

1. 按冻结并发跑 integration 负载＋interactive 探针。
2. 计算成功率与 p95，对照 OQ-A3。
3. 全程 sentinel。

### 期望

- 通过预注册线；持续越线 → FAIL（SC-12）。

---

## UAT-IMC-09 — WebUI 枚举

### 步骤

1. 本轮已裁定不做 WebUI 枚举 → 记 **N/A**，挂 IMC-01 OpenAPI 证据与 Spec 交互合同裁定。

### 期望

- 不得误开浏览器臂冒充本轮范围。

---

## UAT-IMC-10 — T4 回落

### 步骤

1. 停 integration 压测。
2. 等待 ≥ `CANCEL_HOLD_MS`＋5s。
3. 查 capacity 回落；E／I 小查询恢复。

### 期望

- 「立刻」重试在 hold 窗内失败不记产品 FAIL；宽限后失败 → **FAIL**。

---

## UAT-IMC-11 — 观测与指引

### 步骤

1. 读 `/api/health`（或约定摘要）含 workload／integration 拒绝聚合，以及 **interactive 高并发／大响应触顶** 代理计数（可在压测后非零或有字段）。
2. 摘要含**脱敏 `agentId` 有界 Top-N**（无 Token／查询正文）、**每 agent 用量聚合**（调用次数／累计耗时／峰值并发／SC-06 触顶次数）、**预算影子计数**（SC-10 增强）。
3. 打开开发者指引：含 Python＋Java、水位表（含最坏回收时延含 hold）、**非官方 SDK** 显著声明、退避说明；并核对 SC-11 最低契约——`measures`／limit／分片说明、打标 SOP `curl`、机读错误处理（`retryAfterMs` 退避、`response_too_large` 禁无节流重打、`404` 重建会话、非预期严格抛错）、示例标注对应 lucy 版本。
4. 确认 sentinel 阈值与 fixtures 冻结表一致（默认 p99=250ms／连续 3／max=1000ms）。

### 期望

- SC-10／11／12；指引暗示官方包 → **FAIL**；摘要含 Token／查询正文 → **FAIL**；SC-11 最低契约缺项 → **FAIL**。

---

## UAT-IMC-13 — integration 握手轻量路径

### 步骤

1. Agent-I 发起 `initialize`：响应走静态极简指引路径（服务端日志／观测证实未进入 `decideInitializeInstructions` 动态构建、未占 instructionsWork 槽位、无目录／Skill 扫描）。
2. 对照 Agent-E `initialize`：行为与既有路径一致（回归确认）。
3. 双方各自 `tools/list`，比对可见工具集。

### 期望

- Agent-I 不占用动态构建槽位（批量建连时 instructionsWork 并发不为 integration 打满）；
- **两条路径 `tools/list` 可见集同构**——可见集不一致 → **FAIL**（SC-13 不变量）；
- Agent-E 握手行为变化 → **FAIL**。
