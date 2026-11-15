# UAT：MCP Wiki／Skill 真读真用 + ACL（终端用户场景）

| 字段 | 值 |
|------|-----|
| 状态 | **v0.2 已定稿（2026-11-15）**——委托人确认定稿并授权落地；已并入 Claude Code 三轮对抗评审 MUST-1…10；Cursor＝Agent CLI |
| 评审依据 | [`inbox/uat-ctx-content-design-review-2026-11-15/round-{1,2,3}.md`](../../inbox/uat-ctx-content-design-review-2026-11-15/round-3.md)（inbox 可删；定稿后关键条款以本文为准） |
| 落地 Plan | [`docs/plans/lucy-20261115-uat-context-content-landing-plan.md`](../plans/lucy-20261115-uat-context-content-landing-plan.md) |
| 测试台路径 | `docs/qa/uat/suites/context-content/` |
| Suite ID | `UAT-SUITE-CONTEXT-CONTENT` |
| 总账 | **P1-30／REQ-030-051**（**不得**占用 P1-28／049 或 P1-29／050） |
| 必做宿主 | **Claude Code CLI**（`claude -p`）＋ **Cursor Agent CLI**（`agent`／`cursor-agent`；复用 `scripts/e2e/adapters/cursor-cli.mjs`） |
| 夹具策略 | 每跑 run-nonce；编进 Wiki key／Skill name；allow + 两种 deny |
| 环境 | 本机 demo Docker（WebUI + MCP Proxy）；默认不谈客户 K8s |
| 权威约定 | [`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)；三台账见 DEVELOPMENT／`e2e-ledger` |

本设计只定义测试台剧本与夹具形态。**≠ 功能合同收口 ≠ UAT PASS ≠ 可上线**。默认不改 Proxy／WebUI 运行代码；跑次证伪后须另获开发授权再改实现。

**委托人裁决（2026-11-15）**：Cursor 半边用 **Agent CLI**（非 GUI）。因此本套件两侧答复层均可机器 transcript；不再适用「Cursor 仅人工捕获」的 GAP-1 主路径。实施前须获独立授权：将本套件宿主口径写清，并处理 `docs/qa/real-e2e-clients.yaml` 中 `cursor-cli` 现为 `required: false`／「not in first-release denominator」与本套件「双宿主必做」的冲突（升口径或套件级例外说明）。

---

## 1. 问题与目标

### 1.1 问题

曾出现：MCP 对 Wiki／Skill **探查看起来正确**，但终端用户侧 **不能真实调取正文**，或调取后 **用户可见答复未使用** 这些信息。内部 smoke／探针／Code Review 无法单独证明客户场景可用。

### 1.2 目标（三层，缺一不可）

1. **通道真实可读**：授权路径读工具返回含本次 run-nonce 的正文；服务端审计可按夹具 key／skillUri 机器证明。  
2. **权限控制**：`deny-nochan`（工具面）与 `deny-noacl`（对象 ACL 门闩）均必做；审计 `errorDetail` 对齐期望内部 reason。  
3. **信息被使用**：用户可见答复含**同一** run-nonce；且不得用答复代替工具调用（见 §2.3）。

### 1.3 非目标

- 用 vitest、Code Review、配置 guard、`cc-lucy-skill-probe` alone 冒充本套件 PASS。  
- 本设计波次改运行时代码或重开 `/mcp/skills` passthrough。  
- 云端／客户现场（可选后续；非首版必做）。  
- 首版不设「在 ACL 内但无 `wiki_read`」deny 变体（`wiki_search` snippet 会泄漏正文 nonce）。

---

## 2. 套件身份与用例

| 项 | 约定 |
|---|---|
| Suite ID | `UAT-SUITE-CONTEXT-CONTENT` |
| 路径 | `docs/qa/uat/suites/context-content/`（`suite.md`／`cases.md`／`fixtures.md`／`runs/`） |
| INDEX | 挂行；初态 `NOT RUN`；PASS 须可由套件判定 JSON 复算 |
| 总账 | `P1-30／REQ-030-051`（执行总账补行；**不入核心分母**，但必须有行） |
| 编号 | `CONVENTIONS.md` 增 `UAT-CTX-*`；环境门禁用共用 `UAT-R0`；播种门禁用 `UAT-CTX-R0-SEED` |

### 2.1 用例

| ID | 场景 | 身份 | 通过要点 |
|---|---|---|---|
| `UAT-R0` | 环境门禁 | — | demo／MCP 可达 |
| `UAT-CTX-R0-SEED` | 播种门禁 | allow + 两 deny | 见 §5.2／§5.2.1；任一条不过停表 |
| `UAT-CTX-WIKI-01` | 授权读 Wiki（必做） | allow | 对**已知 key** `wiki_read`；工具结果含 nonce；审计 `argsSummary.key`＋`outcome=ok` |
| `UAT-CTX-WIKI-01S` | 授权搜 Wiki（条件） | allow | `wiki_search` 可见夹具；上游不可保证时 `BLOCKED` **不判 FAIL**（GAP-2） |
| `UAT-CTX-WIKI-02` | 授权用 Wiki | allow | 三件套：调用轨迹 ＋ 工具结果含 nonce ＋ 答复含同一 nonce |
| `UAT-CTX-WIKI-03` | 无通道 deny | deny-nochan | `tools/list` 无四工具；强制 call → 403 `-32003`；答复无 nonce |
| `UAT-CTX-WIKI-04` | 对象 ACL deny（必做） | deny-noacl | list **有**四工具；对**已知存在 key** call 被拒；审计 `errorDetail == role_not_granted`；答复无 nonce |
| `UAT-CTX-SKILL-01` | 授权读 Skill | allow | search（问句∈triggers）→ read URI；结果含 nonce；审计覆盖三条读通道 |
| `UAT-CTX-SKILL-02` | 授权用 Skill | allow | 同 WIKI-02 三件套 |
| `UAT-CTX-SKILL-03` | 无通道 deny | deny-nochan | 同 WIKI-03 |
| `UAT-CTX-SKILL-04` | 对象 ACL deny（必做） | deny-noacl | 同 WIKI-04；已知 skill URI；三通道任一读到正文即 FAIL |

### 2.2 必做／可选／条件

| 必做 | 条件／可选 |
|---|---|
| R0、R0-SEED、WIKI-01／02／03／04、SKILL-01／02／03／04；CC CLI＋Cursor Agent CLI 各一份完整跑次 | WIKI-01S（search）；默认 demo 问数 Token 探针（仅当委托人确认本机明文来源可用，否则不得自铸冒充） |
| | 云端复跑（可选） |

**禁止**：把对象门闩（`-04`）放回「可选」。

### 2.3 判定口径

- 单宿主全绿 → 该宿主 PASS。  
- **两宿主判定工件都绿** → 套件可主张 PASS。  
- 任一边 FAIL／BLOCKED → 套件不得 PASS。  
- **探查／list／search 命中不能代替 read**。  
- **tool `ok` 不能代替答复引用**。  
- **答复引用不能代替工具调用**：每个「用」类用例须同时具备 (i) 调用轨迹 (ii) 工具结果含本次 nonce (iii) 答复含同一 nonce；缺一 FAIL。  
- **删掉「或可核对要点」作为通过依据**（仅观察项）。  
- **证据机器判定**：扩展 `scripts/e2e/answer-assertions.mjs`（`requiredCanaries`）；输出 JSON 落 `inbox/uat-ctx-content-<date>/`。  
- deny：① list 出现／不出现 ② 强制 call 且 **code＝403 `-32003`** ③ 答复无 nonce ④ 审计 `errorDetail`＝期望内部 reason（`role_not_granted`／通道拒绝对应文案）。外皮 `context_not_available`≠内部 reason。  
- Skill 审计过滤：`tool ∈ {lucy_skill_read, resources/read, prompts/get}`。  
- 发现性只在**读行**断言（搜索审计恒 `ok` 且不记命中数）。  
- 「search 不含夹具」仅当 allow 侧 search 曾命中夹具时才用于 deny；否则按 GAP-2，不作 deny PASS／FAIL 依据。  
- 清理核对：旧 Token → **401 `-32001`**（断言 code）。

---

## 3. 夹具、身份、会话隔离

### 3.1 命名与可重复性

- 前缀 `uat-ctx-content-`；**Role id／Agent id 必须带 run-nonce 后缀**（防 `ROLE_ID_RETIRED` 墓碑；agent.id ≤32 须核算长度）。  
- **写死**：每次跑重建带 nonce 的内容页／Skill；**不**采用「固定夹具 ACL 锁死」与「每跑随机 nonce」并存的模糊选项。  
- 清理后可删 Role（接受墓碑）；下次用新 run-nonce id，保证能跑第二次。

### 3.2 nonce 与内容夹具

1. 每跑生成 **run-nonce**（12–16 位**小写** hex）。  
2. **编进身份**：
   - Wiki key：`uat-ctx-wiki-<run-nonce>.md`（必须是 `wiki/` 下以 `.md` 结尾的相对路径）。  
   - Skill：`domain=uat-ctx`，`name=skill-<run-nonce>`（两段均 `^[a-z0-9_-]+$`）；读取一律 `lucy-skill://uat-ctx/skill-<run-nonce>`（禁止裸 name 全局匹配）。  
3. **Wiki 无发布态**；就绪＝文件在内容根 + `allowed_roles` 含 allow **roleId**。  
4. **Skill**＝`status: published`（回读确认；非法值会静默变 draft）+ `roles_allowed` 含 allow roleId。  
5. nonce **放在 Wiki／Skill 正文**（Wiki `wiki_read` 已剥 frontmatter）。  
6. 另放不可猜数值 gold（观察／辅助）；**业务要点不作判定依据**。  
7. **Skill `triggers` 必须逐字包含答问用业务问句**（search 不索引正文）。  
8. 原始 nonce **只进** gitignored `inbox/uat-ctx-content-<date>/` 与**仓库外**临时文件；设计／`fixtures.md`／`runs/`／INDEX **只写 `sha256(nonce)` 前 12 位**。  
9. **只经 Admin API 播种**（仓库 tracked `wiki/`／`skills/` 不是代理内容根）。

### 3.3 身份矩阵

| 身份 | 通道工具 | 对象 ACL | agent | 用途 |
|---|---|---|---|---|
| `uat-ctx-content-allow-<run>` | 四工具，**同一 Role** | 含同一 roleId | 独立 agent id | 正例 |
| `uat-ctx-content-deny-nochan-<run>` | 无四工具 | 不含 | 独立 agent id | 工具面 deny |
| `uat-ctx-content-deny-noacl-<run>` | **有**四工具 | 不含 | 独立 agent id | **对象门闩 deny（必做）** |
| 条件：默认 demo 问数 Token | 现网默认 | 不含 | 现有 | 仅委托人确认本机可用时；禁止自铸冒充 |

硬约束：

1. 对象授权与通道落在**同一 Role**（不跨 Role 拼接）。  
2. **一个身份 = 一个独立 agent id**（同 agent 多 token ≠ deny）。  
3. Agent 绑正式 Role；禁止 legacy 直接授权。

### 3.4 客户端 Token 绑定与会话隔离

1. 每**身份 × 每阶段**＝独立进程 ＋ **只含单个 `lucy` server** 的生成配置；`Authorization: Bearer ${env:LUCY_UAT_TOKEN}`；明文只进环境变量与仓库外临时文件。  
2. 答问 `cwd`＝**仓库外**暂存目录（答问 agent 读不到设计／fixtures／inbox nonce）。  
3. Claude Code：`--strict-mcp-config`。  
4. Cursor Agent CLI：复用／对齐 `scripts/e2e/adapters/cursor-cli.mjs`；**另断言不加载**全局 `~/.cursor/mcp.json` 中的额外 Lucy server（可见 MCP server 数 == 1）。  
5. 换 Token 必起新进程；Token 不进 argv。  
6. 两侧均收集机器可读 transcript，供断言脚本消费。

---

## 4. 跑次证据

| 槽 | 要求 |
|---|---|
| `runs/YYYY-MM-DD-claude-ctx-content.md` | Claude Code CLI 全真 |
| `runs/YYYY-MM-DD-cursor-cli-ctx-content.md` | Cursor Agent CLI 全真 |
| `inbox/uat-ctx-content-<date>/` | 判定 JSON、nonce 指纹、证据 sha256、清理核对（无 secret） |

跑次须记：宿主与**二进制版本**、客户端形态（cli）、生成配置路径、会话隔离方式、`gitSha`、WebUI／MCP URL、用例 ID、工具名、`tools/list` 摘要、标记命中布尔、答复全文落点指针、审计关联键（user＋tool＋since＋key／skillUri）、清理结果。

INDEX PASS 必须能由判定 JSON **复算**；缺任一宿主工件不得写套件 PASS。

---

## 5. 执行剧本

### 5.1 治理（文档先于跑次）

落盘顺序：**先建 suite 目录 → 再挂总账 ID → 再挂 INDEX（`NOT RUN`）**。

1. 总账补 `P1-30／REQ-030-051`；`e2e-ledger` 勾连。  
2. `CONVENTIONS.md` 增 `UAT-CTX-*` 与 `NOT RUN`（若表中缺失）。  
3. `check-e2e-ledger.mjs` 的 `REQUIRED` 增行（存在性兜底，非唯一闭环）。  
4. 套件级判定脚本（跑次自执行 → JSON）。  
5. `docs/README.md` 设计索引登记本文。  
6. 处理 `real-e2e-clients.yaml` 与 Cursor Agent CLI 必做口径（独立授权）。

### 5.2 播种（测前）

Admin 身份＝Cookie `lucy_admin_session`（无管理员 Bearer）；禁止外来 `Origin`。

| # | 端点 | 要点 | dryRun |
|---|---|---|---|
| 1 | `POST /api/auth/login` | 凭据**文件路径** only | — |
| 2 | `POST /api/admin/roles` | `roleId` 带 run-nonce；`allow.tools` 四工具；**不传 `role.name`** | **必须 `dryRun:false`**（省略＝预览） |
| 3 | `POST /api/admin/agents` | `roles:[roleId]`；**不传 `agent.allow`** | **`dryRun:false`** |
| 4 | `POST .../tokens` | `label`＋`expires_in` | Token 省略即真实签发；显式 `dryRun:false` 亦可 |
| 5 | `PUT /api/wiki/uat-ctx-wiki-<run>.md` | `allowed_roles:[allow roleId]`＋正文含 nonce | **仅 `dryRun:false` 才写** |
| 6 | `POST /api/skills` | `domain`／`name`／`status:"published"`／`roles_allowed`／`triggers` 含问句／正文含 nonce | 无 dryRun 字段；**回读** status |
| 7 | deny-nochan／deny-noacl | 重复 2–4（各独立 role／agent） | 同上 |

播种顺序硬约束：**Role → Agent／Token → 内容（ACL 写入）**。ACL 先于 Role → 409 `ROLE_ID_HAS_CONTEXT_REFERENCES`。

每步**回读**证明；不以 201 代替 `status`／`roles_allowed`／`allowed_roles`。

#### 5.2.1 R0-SEED 断言（停表条件）

1. allow：`tools/list` 含四工具。  
2. allow：`wiki_read`／`lucy_skill_read`（URI）结果含 nonce。  
3. 审计：本次 key 的 wiki_read 行 `outcome=ok`、`responseBytes>0`。  
4. deny-noacl：list 含四工具；call 拒；`errorDetail == role_not_granted`。  
5. deny-nochan：list 不含四工具；强制 call → 403 `-32003`。  
6. 审计库健康（否则 Skill 全拒且零审计）。  
7. `GET /api/admin/roles/:allowRoleId` 的 wiki／skill readable 含本次夹具。  
8. （条件）wiki_search 命中；未命中先查上游，不误判 ACL。

### 5.3 场景（CC CLI 与 Cursor Agent CLI 各一遍）

固定提示词：

- 业务自然问句；答案依赖 nonce／数值 gold，无法凭常识猜出。  
- **问句与 Skill `triggers` 逐字一致**。  
- 提示词**不得**含 nonce、标记前缀、夹具 key／Skill 名、套件 ID、run-nonce。  
- 新进程；cwd 仓库外；不得读设计／跑次／fixtures。

allow：迫使 search（Skill）／read → 答复复述 nonce。  
deny：同题不得出现 nonce；对已知 key／URI 强制探测。

### 5.4 清理（测后强制）

| # | 动作 | 理由 |
|---|---|---|
| 1 | **先**撤 ACL／删标记 Wiki／Skill | 否则删 Role → 409 `ROLE_REFERENCED_BY_CONTEXT` |
| 2 | 删 Agent（连带吊销 Token） | 否则 → 409 `ROLE_IN_USE` |
| 3 | 删 Role | 墓碑 ⇒ 下次必须新 run-nonce id |
| 4 | 删本机临时 token；残留核对；旧 Token → 401 `-32001` | |

**禁止**旧顺序「删 Agent → 删 Role → 撤内容」。

---

## 6. 与内部门禁的关系

| 层级 | 例子 | 本套件角色 |
|---|---|---|
| 内部门禁 | `.mcp.json` guard、`cc-lucy-skill-probe`、单测 | 可选预检；**不算** INDEX PASS |
| 测试台 | 本套件双宿主全真＋判定 JSON | 「终端用户真读真用」唯一 SOT |

相对 `cc-lucy-skill-probe` 的增量：探针止于通道／读通；本套件覆盖**对象 ACL**、**用户答复三件套**、**Wiki**、双宿主会话隔离。

历史「假连通」修复（主面 `/mcp`）是实现背景，不替代本套件证据。

---

## 7. 首版 GAP（可接受；须显式登记）

| ID | 内容 | 解除条件 |
|---|---|---|
| GAP-2 | `wiki_search` 对新夹具可见性不可保证 | 上游 reindex 可控后升必做 |
| GAP-3 | Wiki／Skill 无产品侧答复可核对块 | 独立 Spec 扩展 |
| GAP-4 | 仓内无 secret 扫描护栏 | Nice：tracked 明文 Bearer 扫描 |
| GAP-5 | 捕获与复核可能同人 | 第二复核人或独立 artifact |
| GAP-6 | 本机全局 MCP 噪声／公网明文端点 | 独立安全事项；本套件靠 strict 单 server 隔离 |
| GAP-7 | UAT 树首个「用户可见答复」断言类 | CONVENTIONS 固化后成先例 |
| GAP-8 | INDEX 人手表可被改 | 后续机器生成段 |

~~GAP-1（Cursor 仅 GUI 人工）~~：**因委托人裁定 Agent CLI 而关闭主路径**；若 CLI adapter 实证失败，降级须重新授权，不得默默改回 GUI 却写套件 PASS。

---

## 8. 自检

- [x] MUST-1…10 并入正文  
- [x] Cursor＝Agent CLI 写入必做宿主与证据槽  
- [x] 对象 ACL deny 升必做；错误 `-06` 变体删除  
- [x] nonce／key／URI／triggers／清理顺序写死  
- [x] 判定 JSON 为 PASS 真源  
- [x] 总账号避开 P1-28／P1-29（本条＝P1-30）  
- [x] 委托人确认 v0.2 定稿并授权落地（2026-11-15）  
- [x] Cursor Agent CLI：套件级必做例外（不升全局 first-release 分母）  

---

## 9. 下一步

1. ~~定稿／落地授权~~（已完成）。  
2. 测试台树＋三台勾连＋判定脚本（见落地 Plan）。  
3. 另获**跑次执行授权**后再首跑双宿主 UAT（本条落地 ≠ 已跑通）。
