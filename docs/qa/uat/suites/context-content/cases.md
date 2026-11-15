# Cases — UAT-SUITE-CONTEXT-CONTENT

权威步骤与判定以设计 v0.2 §2／§5 为准。本文件是测试台可执行摘要。

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
