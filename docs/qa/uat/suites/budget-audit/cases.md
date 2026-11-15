# Cases — UAT-SUITE-BUDGET-AUDIT

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health／登录 | Admin 可导出审计 |
| UAT-BUDGET-AUDIT-01 | budget_stop 行含快照 | Admin 导出 | Spec SC 主路径 | 终止行有 `budgetSnapshot` 或扁平列非空 |
| UAT-BUDGET-AUDIT-02 | 普通业务行无快照 | Admin 导出 | Spec SC-R4 | 非事件行无快照键／扁平列空 |
| UAT-BUDGET-AUDIT-03 | metadata v1 有／v2 无 | Admin API | Spec SC-R6 | v1 含列；v2 显式不含 |

---

## UAT-R0 — 环境门禁

### 步骤

1. health → 记 `gitSha`  
2. Admin WebUI 登录  
3. 确认可访问审计导出（`/api/admin/audit/export` 或 UI 等价）  

### 期望

- 登录成功；导出端点非 401／404  

---

## UAT-BUDGET-AUDIT-01 — budget_stop 行含快照

### 前置

- **优先**：同日 `UAT-SUITE-QUESTION-BUDGET`／`UAT-BUDGET-03` 已产生 `budget_stop`  
- **否则**：本条前先按 question-budget cases 自跑第 61 次耗尽，再导出  

### 步骤

1. `GET /api/admin/audit/export`（适当时间窗，覆盖本波耗尽）→ 保存为证据（inbox，禁 secret）  
2. 定位 `budget_stop`／预算终止相关行（或 `budget_event_kind` 非空行）  
3. 检查 `args_summary` JSON 中的 `budgetSnapshot`，或表尾扁平列  

### 期望

- 至少一行事件行：`budgetSnapshot` 存在，或 `budget_event_kind`／`budget_max_calls` 等扁平列非空  
- `budget_max_calls`（若有）体现 **60**（或快照内 `maxCalls=60`）  

### 停表

- 无终止行且无法跑满 61 次 → `BLOCKED`；不得用单测夹具凑绿  

---

## UAT-BUDGET-AUDIT-02 — 普通业务行无快照

### 步骤

1. 在同一份 `calls.csv` 中取至少一行成功业务调用（非预算终止／非续查换窗事件）  
2. 检查是否含 `budgetSnapshot` 键或扁平预算列  

### 期望

- 该行 **无** `budgetSnapshot` 键（或扁平列均为空）  

---

## UAT-BUDGET-AUDIT-03 — metadata v1 有／v2 无

### 步骤

1. `GET /api/admin/audit/export-metadata`  
2. `GET /api/admin/audit/v2/export-metadata`  

### 期望

- v1 字段说明含预算快照／扁平列名（至少 `budget_event_kind` 或 `budgetSnapshot` 相关说明）  
- v2 metadata **不含**本条新增扁平列（防 metadata 扩散）  
