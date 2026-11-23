# Cases — UAT-SUITE-CONTEXT-CONTENT

下方真读真用与 ACL 用例为设计 v0.2 §2／§5 的可执行摘要。新增「默认使用业务上下文」组的步骤和判定见本页对应章节。

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用；记 `gitSha` |
| UAT-CTX-R0-SEED | 播种门禁 | Admin API＋MCP | 设计 §5.2.1 | allow 可读 nonce；两 deny 断言；审计闭合 |
| UAT-CTX-WIKI-01 | 授权读 Wiki | MCP 全真 | wiki_read＋审计 | 已知 key；结果含 nonce；`outcome=ok` |
| UAT-CTX-WIKI-01S | 授权搜 Wiki（条件） | MCP | wiki_search | 命中夹具；否则 BLOCKED 不判 FAIL |
| UAT-CTX-WIKI-02 | 授权用 Wiki | CC／Cursor CLI | 三件套 | 轨迹＋结果 nonce＋答复 nonce |
| UAT-CTX-WIKI-03 | 无通道 deny | MCP | deny-nochan | list 无四工具；403 `-32003`；答复无 nonce |
| UAT-CTX-WIKI-04 | 对象 ACL deny | MCP | deny-noacl | list 有工具；已知 key 拒；`errorDetail=role_not_granted` |
| UAT-CTX-SKILL-01 | 授权读 Skill | MCP | search→read URI | triggers 含问句；结果含 nonce；三通道审计 |
| UAT-CTX-SKILL-02 | 授权用 Skill | CC／Cursor CLI | 三件套 | 同 WIKI-02 |
| UAT-CTX-SKILL-03 | 无通道 deny Skill | MCP | deny-nochan | 同 WIKI-03 |
| UAT-CTX-SKILL-04 | 对象 ACL deny Skill | MCP | deny-noacl | 已知 URI；三通道任一读到正文即 FAIL |

---

## UAT-R0 — 环境门禁

### 步骤

1. `compose-lucy-1` healthy；端口以当次为准（默认 WebUI `55176`／MCP `57881`）  
2. `GET /api/health` → 记 `gitSha`  
3. WebUI Admin 登录（凭据**文件路径**见 fixtures）  

### 期望

- health ok；可进入 Admin  

---

## UAT-CTX-R0-SEED — 播种门禁

### 步骤

按设计 §5.2 有序表：生成 run-nonce → 建 allow／deny-nochan／deny-noacl（各独立 Role＋Agent＋Token）→ 写 Wiki／Skill（正文含 nonce；Skill `triggers`＝答问句；`status` 回读为 published）→ 跑设计 §5.2.1 十条断言。

### 期望

- 任一条不过 → **停表**，不进场景用例  
- 原始 nonce 只进仓库外／`inbox/`；本 cases／fixtures **无** nonce 字面量  

---

## UAT-CTX-WIKI-01 — 授权读 Wiki

### 步骤

1. allow 身份、单 server 会话  
2. `tools/call wiki_read`（**已知** `uat-ctx-wiki-<run-nonce>.md`）  
3. 查审计：`argsSummary.key`＋`outcome=ok`＋`responseBytes>0`  

### 期望

- 工具结果正文含本次 nonce  
- 不得仅用 search 命中代替  

---

## UAT-CTX-WIKI-01S — 授权搜 Wiki（条件）

### 步骤

1. allow：`wiki_search` 查询能定位夹具的关键词（**问句不含 nonce**）  

### 期望

- 命中含夹具 key → PASS  
- 上游／索引导致不可见 → **BLOCKED**（GAP-2），**不**记套件 FAIL  

---

## UAT-CTX-WIKI-02 — 授权用 Wiki

### 步骤

1. 仓库外 cwd；固定业务问句（答案依赖 nonce）  
2. 迫使 read → 用户可见答复  

### 期望

- **三件套**同时成立：调用轨迹；工具结果含 nonce；答复含**同一** nonce  
- 缺一 FAIL；禁止「答复代替工具调用」  

---

## UAT-CTX-WIKI-03 — 无通道 deny

### 步骤

1. deny-nochan：`tools/list`  
2. 强制 `wiki_read` 已知 key  

### 期望

- list **无** `wiki_search`／`wiki_read`／`lucy_skill_*`  
- call → JSON-RPC **403 `-32003`**  
- 答复无 nonce  

---

## UAT-CTX-WIKI-04 — 对象 ACL deny

### 步骤

1. deny-noacl：`tools/list`（须含四工具）  
2. 对**已知存在** key 强制 `wiki_read`  
3. 读审计 `errorDetail`  

### 期望

- call 被拒；`errorDetail == role_not_granted`  
- 答复无 nonce  
- 不得因 `wiki_not_found` 冒充对象门闩  

---

## UAT-CTX-SKILL-01 — 授权读 Skill

### 步骤

1. allow：`lucy_skill_search`（query＝triggers 中的问句）  
2. `lucy_skill_read`（URI `lucy-skill://uat-ctx/skill-<run-nonce>`）或等价 resources／prompts  
3. 审计：`tool ∈ {lucy_skill_read, resources/read, prompts/get}`  

### 期望

- 结果含 nonce；读行可机器关联  

---

## UAT-CTX-SKILL-02／03／04

与 WIKI-02／03／04 对称；Skill 侧 deny-04 须覆盖三条读通道（任一通道读到正文 → FAIL）。

---

## 跑次收尾

1. 清理顺序：ACL／内容 → Agent → Role → 临时 token 文件  
2. 残留核对；旧 Token → 401 `-32001`  
3. 写双宿主 `runs/`＋判定 JSON；`node scripts/uat/judge-context-content.mjs`  

## 默认使用业务上下文

合同回链：[P1-77／REQ-030-098 Spec](../../../../specs/lucy-20261123-default-business-context-adoption-spec.md) SC-01–SC-08。改前诊断：[KSCC](runs/2026-11-23-kscc-ctx-default.md) 复现「需提示才可用」，[Kimi](runs/2026-11-23-kimi-ctx-default.md) 未复现。正式性能 A 以 P1-75 通过 G1／G2 的构建为准。

所有问句均在已授权身份下通过真实 Agent 和 Lucy `/mcp` 提问。自然问句只给业务目标；显式对照在原问句后追加表中提示。每行均为必做，两种宿主分别记录结果。

| ID | 用户原话或追加提示 | 期望 |
|---|---|---|
| `UAT-CTX-DEFAULT-01` | 北辰区 2026 年 11 月 9 日至 15 日一共有多少笔订单？ | 通过语义资产和 `lucy_query` 答复 **7 笔**，轨迹中无业务 Wiki／业务 Skill 的查找和正文读取。 |
| `UAT-CTX-DEFAULT-02` | 北辰区 2026 年 11 月 9 日至 15 日有多少笔有效订单？ | 主动读取业务 Wiki 的口径，用 `lucy_query` 按已签收且配送查询，答复 **2 笔**并说明口径。 |
| `UAT-CTX-DEFAULT-02E` | 对 `02` 追加「请按已授权的业务 Wiki 核对有效订单口径。」 | 与 `02` 的业务结果和取证要求相同。 |
| `UAT-CTX-DEFAULT-03` | 北辰区 2026 年 11 月 9 日至 15 日的积压晨检结论是什么？ | 主动读取业务 Skill，按规程查询待处理订单，答复 **3 笔**、达到 **3 笔**阈值、转履约专员复核。 |
| `UAT-CTX-DEFAULT-03E` | 对 `03` 追加「请按已授权的业务 Skill 完成积压晨检。」 | 与 `03` 的业务结果和取证要求相同。 |
| `UAT-CTX-DEFAULT-04` | 北辰区 2026 年 11 月 9 日至 15 日的履约晨报结论是什么？ | 主动读取业务 Skill 的规程和业务 Wiki 的有效订单口径，查询待处理 **3 笔**和有效 **2 笔**，答复比值 **1.5**、列入优先复核。 |
| `UAT-CTX-DEFAULT-04E` | 对 `04` 追加「请按已授权的业务 Skill 完成履约晨报，并用业务 Wiki 核对有效订单口径。」 | 与 `04` 的业务结果和取证要求相同。 |
| `UAT-CTX-DEFAULT-05` | 用无 Wiki 通道但在语义度量描述或生效口径绑定中已有「有效订单」口径的已授权角色，提问 `02`。 | 按已治理口径答 2 笔并披露来源，Wiki／Skill 查找和读取为零。 |
| `UAT-CTX-DEFAULT-06` | 组合题依次覆盖 Wiki 未命中、Wiki 无权限、读取失败或超时、口径冲突、Skill 缺失。各对照保留至少一条独立可答的子结论。 | 对照实际工具返回区分四类原因，超时归读取失败并明确影响。可回答的子结论仍正确，冲突时保留可核实部分并请求确认，零猜测、零写调用。同题同一依赖最多一次查找、一次正文读取，核对超时后无重复请求。 |

### UAT-CTX-DEFAULT-R0 — 开跑门禁

1. 完成 `UAT-R0`，按[夹具](fixtures.md#默认使用业务上下文夹具)确认适用规模基线、真实 Source 和独立 SQL 结果。记录候选版本、镜像及两种宿主的版本和模型。
2. 用独立探针会话确认正式角色同时拥有问数权限、上下文工具通道与对象授权。核对 `initialize` 返回的 instructions 和可见目录，再用已知 key／URI 读取目标正文。用业务词探查 Wiki 和 Skill，记录是否返回目标对象、是否只返回摘要。Wiki 须确认索引就绪，Skill 须确认已发布。
3. 候选环境、夹具、索引就绪状态、授权或证据采集不能确认时，将受影响必做项记 `BLOCKED`。已确认目标可读且发现入口就绪时，检索漏掉已知应命中的业务词作为候选行为取证，按用例期望判定。显式提示对照仍使用相同发现路径。

### 执行与取证

1. 每种宿主先跑普通问数和全部自然问句，再跑显式对照。每题启动新进程与新 MCP session。使用同一候选、同一授权身份及固定模型配置，记录用户原话和实际提交的 prompt。测试配置只负责 MCP 连接、会话隔离和证据采集。提示词仅填写表中的用户原话和该行指定的追加提示。
2. 对 `02` 至 `04E`，记录发现来源、实际正文读取、`lucy_query` 的相关参数与结果及用户可见答复。Wiki 正文通过 `wiki_read` 核对，Skill 正文通过 `lucy_skill_read` 或实际支持的等价 MCP Resource／Prompt 读取核对。发现方式可由宿主选择，须能够从本会话追溯到产品给出的目标对象。正文返回的标记、查询结果与答复中的口径或规程结论须一致。普通问数对照记录是否发生对象查找或正文读取。协议级能力枚举单独记录。
3. 每题保存脱敏宿主轨迹、正文标记指纹、查询请求与结果、答复、同会话服务端审计关联键、用户提交到最终答复的耗时及 MCP 耗时。跑次记用例 ID、实际命令、证据路径、独立预期、逐步结果和清理回执。按 [UAT 判定约定](../../CONVENTIONS.md#判定)登记双宿主结论。

### 判定与清理

- 自然问句失败而同题显式提示通过，记录为该宿主和该场景复现「需提示才可用」。对失败的问句记录首次失败环节，可标记未发起查找、查找未命中、正文读取失败或缺失、查数错误、答复未采用正文。有完整证据证明未满足期望的必做项记 `FAIL`。
- 任一必做问句未满足期望，该组无法登记 `PASS`。在 Wiki 发现环境尚未就绪时，相关必做项按 `BLOCKED` 记录。两种宿主的全部必做项通过后方可登记该组 `PASS`。
- 测后经原管理入口依次清理本组业务 Wiki／业务 Skill、Agent、角色、Source 和合成数据，核对临时凭据失效和基线夹具完好。

### UAT-CTX-DEFAULT-PERF

1. 冻结 A＝通过 P1-75 完整 G1／G2 的候选，B＝A 加 P1-77。两侧固定 Docker 资源、镜像依赖、数据、模型、原生 MCP 接入、身份、问句、会话冷热状态和测程版本。按宿主和用例分别计时。先收 A 侧正式样本并锁定时限，再开启 B 侧出门测试。任何构建或环境条件变化须重新冻结可比对照。
2. `01／05` 每个宿主、用例各测至少两个独立区块，每区块至少 20 对首尝试，用交错 A/B 抵消环境波动。分别比较用户提交到首条与独立 SQL 核对值相符的查询回执，以及到最终正确答复的 P50／P95（最近秩）。任一同口径指标在两区块均高于 A 即失败。若某指标只在一个区块变慢，以同样条件追加第三个区块，按是否在至少两个区块变慢判定。两个计时指标均须通过，且两题均保持零上下文查找和读取。缺完整可比样本记 `BLOCKED`。
3. `02／03／04` 分别用 A 同宿主的正确显式路径 `02E／03E／04E` 冻结基线。每题每宿主至少 20 次首尝试，预先登记正确答复到达的 P95 和最大耗时。B 的自然题相同分母且逐题正确，最终答复 P95 ≤ A 的 P95，每题首尝试不得超过 A 冻结的最大耗时。途中验证同一依赖最多一次查找和一次正文读取，等价 MCP 入口合并计数。A 若无法取得完整正确的基线，记 `BLOCKED` 并保留原因。
4. 记录从提交到首条正确查询和最终正确答复的墙钟、各 MCP 工具耗时及可测的宿主等待。用逐次回执记录计划、发出、到达、正确、错误、超时与未完成。首尝试超时、错误结果或调用超限判失败，后续跑次或重试单列。受控超时 `06` 以正确交付部分结果并在预先登记的用例期限内完成为通过条件。

### UAT-CTX-DEFAULT-MIX

1. 在已通过的 [P1-75 G2](../interactive-read-resilience/cases.md#uat-read-res-07--多角色问数与同账号并发维护必做同窗运维场景) 上复用原分母、三种窗口、到达节奏、角色隔离、前台操作和探针。A、B 各跑相同的额外上下文负载。保留原 50 路握手和 50 路独立基础查询，在每窗增加 12 个独立的已授权纯 MCP 会话，按 4 条 Wiki、4 条 Skill、4 条组合旅程向真实 Proxy 发送查找、正文读取与正确查询。额外负载用确定性 MCP 测程，宿主是否遵循指引由 PERF 和自然问句用例取证。
2. 逐窗关联真实读正文回执、查询结果与 SQL 核对值。每窗实际 Wiki 和 Skill 调用均须与原 50 路查询批次的在途峰值重叠，写入窗仍须满足原名册／有效写入交叠证据。追加会话逐个在出发前核对授权，受限身份撤权对照验证旧／新会话不能读取已撤回的上下文或数据。
3. 逐窗继承 P1-75 的握手、查询、首响应、探针和恢复门槛。将额外上下文旅程的超时、首错误、调用次数和结果单列。两侧均满足原门槛，且 B 的追加合法旅程全部首尝试正确，方可通过。未证明交叠记 `BLOCKED`，已观察到的产品失败照记。
