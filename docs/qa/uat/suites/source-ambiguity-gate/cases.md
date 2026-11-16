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

## UAT-SAG-01 — 硬线仍拦（v3；v0.4 起取代 v2「多表词 deny」）

> **v3（2026-11-16 夜）**：P1-35 Spec D10／D12 起，多表词不再 deny（已声明 join＝放行；其余放行＋披露＋审计）。本条改验**硬线仍拦**：门闩降级不得放过未知引用、跨连接、超上限。v2 步骤（orders＋returns 双身份 deny）为 v0.3 构建证据，**不再**是合同；2026-11-13／14 跑次保留为历史对照。

### 前置

UAT-R0 PASS；可见源含 `superstore_orders`；跨连接／超上限夹具见 ESCAPE 套件 ESC-08／10（UAT 自造，用后还原）。

### 步骤

1. begin（`超市最近怎么样`）  
2. `lucy_query`：`measures=["superstore_orders.order_count"]`，`filters=["foo_table.bar = 1"]`  
3. （挂 ESCAPE）ESC-08：5 来源超上限；ESC-10：跨连接

### 期望

- 步骤 2：`source_ambiguity_gate`，`detail=unresolved_source_refs`，零上游执行  
- 步骤 3：见 ESC-08／10（拒绝，message 与 `usableTargets` 给可执行下一步）  
- 合法单来源／已声明 join 多来源**不得**被拦（ESC-01／07）

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

- person＋attestation 确认后，同会话再查可成功（可选通道）  
- 缺 attestation／非 person → confirm **HTTP 403**（SC-17 HTTP 部分）  
- **不得**把「confirm 403」推成「后续单钉选 query 必 deny」：若后续 `lucy_query` 已满足 D1（唯一可见钉选∈命中集），按 P1-35 D1／D9 **可独立 allow**；本条对「确认失败后的 query」仅在**未形成 D1**时仍期望 deny
