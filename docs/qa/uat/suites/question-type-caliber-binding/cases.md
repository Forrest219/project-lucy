# Cases — UAT-SUITE-CALIBER-BINDING

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-CALIBER-01 | 零绑定不强制 | MCP 全真 | Spec SC-06 | 成功查数；`caliberBinding.status=none` |
| UAT-CALIBER-02 | 绑定偏离 deny（可选） | MCP＋夹具 | Spec SC-07／08 | `caliber_binding_violation`；上游 0 |

---

## UAT-R0 — 环境门禁

同 [source-ambiguity-gate fixtures](../source-ambiguity-gate/fixtures.md) 的 WebUI／MCP 门禁。

---

## UAT-CALIBER-01 — 零绑定不强制

### 前置

demo 内容根无命中本问句的 published `caliber-bindings`（现行 demo 常态）。

### 步骤

1. `lucy_begin_question`：`question`＝「订单数是多少」（单表词，避免歧义门闩）  
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

### 期望

- 成功载荷（非 `isError`）  
- `answer_verifiability.caliber.caliberBinding.status === "none"`（或不存在强制绑定）  
- 有数值行（如 `order_count`）

---

## UAT-CALIBER-02 — 绑定偏离 deny（可选）

### 前置

内容根存在 published 绑定，`boundKey`＝`superstore_orders`，且触发词／显式 id 可激活。

### 步骤

1. begin 激活该绑定  
2. `lucy_query` 故意指向另一 source 或越出快照允许集

### 期望

`caliber_binding_violation`（或合同等价拒绝）；不得静默成功。缺夹具 → **BLOCKED**。
