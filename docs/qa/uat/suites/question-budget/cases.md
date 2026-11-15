# Cases — UAT-SUITE-QUESTION-BUDGET

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-BUDGET-01 | 指导文案 60／300 | MCP | Spec SC-T4 | initialize instructions 含 60／300，非 20／120 |
| UAT-BUDGET-02 | 第 21 次不误耗尽 | MCP 全真 | 旧阈值回归 | 同问询连续 ≥21 次数据工具仍未 exhausted |
| UAT-BUDGET-03 | 第 61 次耗尽（可选／推荐） | MCP 全真 | Spec SC-T1 | 第 61 次 → `question_budget_exhausted` |

---

## UAT-R0 — 环境门禁

### 步骤

1. health → 记 `gitSha`  
2. MCP initialize（问数 Bearer）成功  

### 期望

- health ok；MCP 可用  

---

## UAT-BUDGET-01 — 指导文案 60／300

### 步骤

1. MCP `initialize`  
2. 读取返回的 `instructions`（或宿主注入的 data-qa 指导全文）  

### 期望

- 文案含 **60** 次数据工具与 **300** 秒（或「300 秒」等价表述）  
- **不得**仍以 20 次／120 秒作为现行默认指导  

---

## UAT-BUDGET-02 — 第 21 次不误耗尽

### 前置

- 新开问询：`lucy_begin_question`（新 `question`／意图，确保新预算窗）  

### 步骤

1. 在同一问询作用域内，连续执行 **21** 次计费数据工具（优先重复轻量 `lucy_query` 同 measures；或 `lucy_read_source`）  
2. 每次记录是否返回 `question_budget_exhausted`  

### 期望

- 第 1…21 次均**未**因次数耗尽失败（允许个别业务／ACL 失败，但不得是预算耗尽）  
- 证明旧默认 20 已放宽  

### 清理

- 无；可继续进入 BUDGET-03  

---

## UAT-BUDGET-03 — 第 61 次耗尽（可选／推荐）

### 前置

- 可接在 BUDGET-02 同一问询窗继续计数；或新窗从 0 计到 61  
- 跑次必须写明累计次数如何计数  

### 步骤

1. 将同问询数据工具调用推到 **60** 次成功／已结算计入  
2. 发起第 **61** 次 `lucy_query` 或 `lucy_read_source`  

### 期望

- 第 61 次返回预算耗尽（原因码／文案含 `question_budget_exhausted` 或等价）  
- 跑次记下时间窗／agent，供 P1-14 审计导出定位  

### 备注

- 若本波跳过：标 `SKIPPED` 并说明；P1-14 套件必须自行跑满 61 次  
- **禁止**改源码常量图快  
