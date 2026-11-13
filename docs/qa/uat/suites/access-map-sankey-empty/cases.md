# Cases — UAT-SUITE-ACCESS-MAP

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo healthy；可登录 |
| UAT-ACCESS-MAP-01 | 空访问闲置骨干可读 | 浏览器＋API | Spec SC-05／SC-11 | accessPaths=0 时仍有骨干连通带 |
| UAT-ACCESS-MAP-02 | 图例披露闲置骨干 | 浏览器 | Spec SC-08 | 图例含连通骨干／不撑使用刻度 |
| UAT-ACCESS-MAP-03 | 访问面仍 confirmed-only | API | Spec SC-04／D1 | trust 口径已确认；非法 trust 拒 |
| UAT-ACCESS-MAP-04 | begin 后同会话触表进访问流带 | 浏览器／MCP＋刷新图 | Spec SC-01／SC-10 | 可选；confirmed 后 accessPaths>0 |

---

## UAT-R0 — 环境门禁

### 步骤

1. `docker compose -f deploy/compose/docker-compose.demo.yml ps` → lucy／demo-db healthy  
2. `curl -sS http://127.0.0.1:55176/api/health` → `ok`；记录 `gitSha`／`lucyVersion`  
3. 用 fixtures 凭据文件登录 WebUI（只写路径，不写密码）

### 期望

WebUI 可进管理面；容器含空桑基修复提交（或其后继 `gitSha`）。

---

## UAT-ACCESS-MAP-01 — 空访问闲置骨干可读

### 前置

UAT-R0 PASS；窗口内尽量无 confirmed 触表（demo 常见：`accessPaths=0`）。

### 步骤

1. 管理员登录 → 打开 `/admin/access-map`  
2. 将「问询种类」「访问等级」设为「全部」；窗口默认 `168h` 可保留  
3. 并行取 API：`GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all`  
4. 目视／DOM：`access-map-svg`（或等价画布）是否出现闲置骨干连通带（`access-map-backbone-*` 或等效 path）

### 期望

- API：`counts.grantPaths > 0`；若 `counts.accessPaths == 0`，不得仅靠「空流带」判定失败——须有骨干或诚实空态说明  
- 画布：两端在画布上的闲置授权边有连通骨干；**不是**几乎只有端点 stub  
- 闲置表仍不进列（无「只靠闲置授权」的表柱挤满画布）

### 清理

无。

---

## UAT-ACCESS-MAP-02 — 图例披露闲置骨干

### 步骤

1. 同页查看 `data-testid=access-map-legend`  
2. 确认含「连通骨干」或「不撑使用刻度」类披露

### 期望

图例可读；不把「授权路径宽度」写成主释义。

---

## UAT-ACCESS-MAP-03 — 访问面仍 confirmed-only

### 步骤

1. 已登录会话请求上述 access-map API，读 `meta.access.trust`／图例「关联口径：已确认关联」  
2. 若 API 支持 `trust=include_candidate`，尝试请求并记录状态码／错误（期望拒或忽略且仍 confirmed-only）

### 期望

访问面硬锁 confirmed；未放开 candidate 进分母。

---

## UAT-ACCESS-MAP-04 — begin 后同会话触表进访问流带（可选）

### 前置

MCP Proxy 可用；持有可触表连接／源。

### 步骤

1. 同会话：`lucy_begin_question` → 再 `lucy_query`／`lucy_read_source`（无冲突 turn header）  
2. 刷新 `/admin/access-map`（可缩短窗口或保持 168h）  
3. 核对 API `counts.accessPaths > 0` 且画布出现 usage 流带

### 期望

- audit 新触表行为 `association_status=confirmed`  
- 图上出现访问流带；骨干不替代 usage 厚度  

### 清理

无需删 audit；勿改历史 association_status。
