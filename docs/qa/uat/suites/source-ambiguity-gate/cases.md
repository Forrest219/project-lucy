# Cases — UAT-SUITE-SOURCE-AMBIGUITY

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo healthy；MCP Proxy 可达 |
| UAT-R0-UPGRADE | 升级后镜像门禁 | 手工／脚本 | health `gitSha` | 记录 `gitSha`；**不得**仍为升级前 Wave A 镜像 `3aa402c9`；与当日升级后实例一致 |
| UAT-SAG-01 | 多表业务词未确认 → 门闩 deny | MCP 全真 | Spec SC-03 | `source_ambiguity_gate`；`isError=true` |
| UAT-SAG-02 | 宿主确认后可查（可选） | MCP＋host API | Spec SC-07／17 | person＋attestation 后放行 |

---

## UAT-R0 — 环境门禁

### 步骤

1. `docker compose -f deploy/compose/docker-compose.demo.yml ps` → lucy／demo-db healthy  
2. `curl -sS http://127.0.0.1:55176/api/health` → `ok`；记录 `gitSha`／`lucyVersion`  
3. `POST http://127.0.0.1:57881/mcp` initialize（Bearer 只从 fixtures 路径读入进程）→ 200＋`mcp-session-id`

### 期望

WebUI／MCP 同实例可用。

---

## UAT-R0-UPGRADE — 升级后镜像门禁

> 本波（升级后 P0 复跑）**必做**。用于确认 INDEX 不再挂升级前 Wave A 镜像。

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 解析 `data.gitSha`／`lucyVersion`／`ktxRuntime`  
2. 与前次跑次 [`2026-11-14-claude-macmini-p0-qa`](runs/2026-11-14-claude-macmini-p0-qa.md)（容器 `gitSha=3aa402c9…`）对照  
3. 记录本波完整 `gitSha` 到跑次元数据

### 期望

- health `ok`；`ktxRuntime` ready（或合同允许等价）  
- `gitSha` **不以** `3aa402c9` 为前缀（仍为该值 → **FAIL**，说明未升级到本波目标）  
- 跑次必须写明本波 `gitSha`；禁止沿用旧跑次文件冒充

---

## UAT-SAG-01 — 多表业务词未确认 → 门闩 deny

### 前置

UAT-R0 PASS；可见源含 ≥2 张「超市」相关表（demo：`superstore_orders`／`people`／`returns`）。

### 步骤

1. MCP `initialize` → `notifications/initialized`  
2. `lucy_begin_question`：`question`＝「超市最近怎么样」，`intentSummary`＝未选表概况  
3. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`

### 期望

- `result.isError === true`  
- 文本含 `source_ambiguity_gate`／「请先确认来源表」  
- 不得返回成功 `rows` 成交

### 清理

无（会话可丢弃）。

---

## UAT-SAG-02 — 宿主确认后可查（可选）

### 前置

person actor Bearer；可调用 `POST /mcp/host/source-ambiguity/confirm` 且带头 `x-lucy-host-attestation`。

### 步骤

1. 复现 UAT-SAG-01 至 deny，记录 journey `generation`  
2. person＋attestation 确认 `demo-mysql|dataforai|superstore_orders|…`  
3. 同会话再 `lucy_query` 订单数

### 期望

确认后查数可成功；缺 attestation／非 person → 403，查询仍 deny。
