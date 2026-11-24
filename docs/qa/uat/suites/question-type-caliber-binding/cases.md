# Cases — UAT-SUITE-CALIBER-BINDING

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-R0-UPGRADE | 升级后镜像门禁 | 手工／脚本 | health `gitSha` | `gitSha` 不得仍为 `3aa402c9` |
| UAT-CALIBER-01 | 零绑定不强制 | MCP 全真 | Spec SC-06 | 成功查数；`caliberBinding.status=none` |
| UAT-CALIBER-02 | 绑定偏离 deny（Wave B 必做） | MCP＋夹具 | Spec SC-07／08 | `caliber_binding_violation`；上游 0 |

---

## UAT-R0 — 环境门禁

同 [source-ambiguity-gate fixtures](../source-ambiguity-gate/fixtures.md) 的 WebUI／MCP 门禁。

## UAT-R0-UPGRADE — 升级后镜像门禁

步骤与期望同 [`source-ambiguity-gate/cases.md`](../source-ambiguity-gate/cases.md)「UAT-R0-UPGRADE」。

---

## UAT-CALIBER-01 — 零绑定不强制

### 前置

demo 内容根**无**命中本问句的 published `caliber-bindings`（Wave B 夹具安装**前**，或清理**后**）。

### 步骤

1. `lucy_begin_question`：`question`＝「订单数是多少」（单表词，避免歧义门闩）  
2. `lucy_query`：`connectionId=demo-mysql`，`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]`

### 期望

- 成功载荷（非 `isError`）  
- `answer_verifiability.caliber.caliberBinding.status === "none"`（或不存在强制绑定）  
- 有数值行（如 `order_count`）

---

## UAT-CALIBER-02 — 绑定偏离 deny（Wave B 必做）

### 前置

1. 已安装夹具 [`fixtures/uat_wave_b_order_count.yaml`](fixtures/uat_wave_b_order_count.yaml) 到容器  
   `LUCY_CONTENT_ROOT/caliber-bindings/uat_wave_b_order_count.yaml`（现行＝`/data/lucy/config/caliber-bindings/`）  
2. 已通过 **发布／手动 reindex** 提交口径绑定注册表（仅落盘未提交 → 记 `BLOCKED`，原因 `no_commit_evidence`／`caliber_binding_unresolved`）  
3. Bearer 可见 `demo-mysql`／`superstore_orders`

### 步骤

1. `lucy_begin_question`：`question`＝「请按 UAT订单数口径绑定 回答订单数」，`intentSummary`＝激活 Wave B 绑定  
2. 确认 begin 成功且 BindingSession 进入 `begun_bound`（或等价：后续 query 受绑定约束）  
3. `lucy_query`：**故意偏离**——`connectionId=demo-mysql`，带 `dimensions=[{field:"superstore_people.region"}]`（或任一使 `reqKeys`≠`{superstore_orders}` 的载体；勿用歧义词「超市」）

### 期望

- `result.isError === true`  
- 文本／`data.reason` 含 `caliber_binding_violation`（或合同等价）  
- 不得返回成功 `rows`；不得静默成交  
- 缺夹具／未提交注册表 → **BLOCKED**（写明），不得用 vitest 冒充 PASS

### 清理

删除 `caliber-bindings/uat_wave_b_order_count.yaml` 后再次 **reindex／publish**，使 published 绑定集回到空；跑次注明已清理。
