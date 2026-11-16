# Cases — UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health＋MCP initialize | demo healthy；MCP Proxy 可达 |
| UAT-SAG-ESC-01 | 泛化业务词 begin＋唯一钉选首次即可成交 | MCP 全真 | Spec SC-E01；错题 S1 | **首次** `lucy_query` 直接成交／合法空结果；禁止先 deny 再凑绿 |
| UAT-SAG-ESC-02 | 窄意图 begin 对照仍可查 | MCP 全真 | Spec SC-E03；错题 S2 | 首次 query 成交或合法空结果；禁止业务拒绝凑绿 |
| UAT-SAG-ESC-03 | 非 person 不得伪造宿主 confirm | MCP＋HTTP | Spec SC-E04；SC-17 HTTP | confirm → 403；不得靠同 Bearer 自证放行 |

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
