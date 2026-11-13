# Cases — UAT-SUITE-FIELD-EXPOSURE

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-EXPOSURE-01 | 未配置台账不误杀 | MCP 全真 | Spec SC-02／24 | 合法 `lucy_query` 成功 |
| UAT-EXPOSURE-02 | 未暴露列 fail-closed（可选） | MCP＋夹具 | Spec SC-04 | `field_not_exposed`；上游 0 |

---

## UAT-EXPOSURE-01 — 未配置台账不误杀

### 前置

demo 无 `field-exposure` 期望台账（或期望未登记该 source）→ 全暴露。

### 步骤

1. begin「订单数是多少」  
2. `lucy_query`：`superstore_orders.order_count`＋`active_rows`

### 期望

成功返回数值；不得因本条新增无故拒绝。

---

## UAT-EXPOSURE-02 — 未暴露列 fail-closed（可选）

### 前置

已激活暴露台账，某物理列对 agent 未暴露。

### 步骤

`lucy_query` 在 `dimensions`／`filters` 等载体点名该列。

### 期望

本机拒绝，`field_not_exposed`；缺夹具 → **BLOCKED**。
