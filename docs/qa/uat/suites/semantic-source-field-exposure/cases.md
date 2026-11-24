# Cases — UAT-SUITE-FIELD-EXPOSURE

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-R0-UPGRADE | 升级后镜像门禁 | 手工／脚本 | health `gitSha` | `gitSha` 不得仍为 `3aa402c9` |
| UAT-EXPOSURE-01 | 未配置台账不误杀 | MCP 全真 | Spec SC-02／24 | 合法 `lucy_query` 成功 |
| UAT-EXPOSURE-02 | 未暴露列 fail-closed（Wave B 必做） | MCP＋夹具 | Spec SC-04 | `field_not_exposed`；上游 0 |
| UAT-EXPOSURE-02-R | 落点修复后复测 fail-closed（P1-26） | MCP＋夹具 | P1-26 SC-02／04 | publish reindex ok＋`field_not_exposed` |
| UAT-EXPOSURE-03 | 台账生效期间合法查数不挂连接（P1-26） | MCP＋夹具 | P1-26 SC-03 | 合法 `order_count` 成功；无 `composeOverlay` |
| UAT-EXPOSURE-04 | cleanup／恢复路径可 publish＋reindex（P1-26） | MCP＋夹具 | P1-26 SC-05 | cleanup reindex ok；数据面恢复 |

> **P1-26 复测**：`02-R`／`03`／`04` 在 [落点隔离 Spec](../../../../specs/lucy-20261114-field-exposure-ledger-landing-fix-spec.md) 实现落地并获 UAT 执行授权后必跑；关闭 [`GAP-UAT-P0-A-EXPOSURE`](../../../../governance/e2e-ledger.md)。Wave B 的 `02` 历史 BLOCKED 保留作对照，不以旧 `_exposure` 路径复跑冒充 PASS。

---

## UAT-R0-UPGRADE — 升级后镜像门禁

步骤与期望同 [`source-ambiguity-gate/cases.md`](../source-ambiguity-gate/cases.md)「UAT-R0-UPGRADE」。

---

## UAT-EXPOSURE-01 — 未配置台账不误杀

### 前置

demo 无 trimmed `field-exposure` 期望台账（或 Wave B cleanup 后为 `full_expose`／未配置）→ 合法度量可查。

### 步骤

1. begin「订单数是多少」  
2. `lucy_query`：`superstore_orders.order_count`＋`active_rows`

### 期望

成功返回数值；不得因本条新增无故拒绝。

---

## UAT-EXPOSURE-02 — 未暴露列 fail-closed（Wave B 必做）

### 前置

1. 已通过 WebUI **semantic-assets validate＋publish** 安装  
   [`fixtures/uat_wave_b_superstore_orders_exposure.yaml`](fixtures/uat_wave_b_superstore_orders_exposure.yaml)  
   （`excluded_columns: [customer_name]`；不引用 `order_count`／`active_rows` 依赖列）  
2. ServingGeneration 已 OPEN 且该 Source 为 **trimmed**

### 步骤

1. `lucy_begin_question`：`question`＝「订单客户名分布」／等价单表意图  
2. `lucy_query`：`connectionId=demo-mysql`，`dimensions=[{field:"superstore_orders.customer_name"}]`  
   （可附带合法 measure；关键是点名未暴露列）

### 期望

- 本机拒绝；`reason`／文本含 `field_not_exposed`  
- **不得**把「列不存在」上游错误冒充本条 PASS  
- 缺夹具／publish 失败 → **BLOCKED**

### 清理

publish [`fixtures/uat_wave_b_superstore_orders_exposure_cleanup.yaml`](fixtures/uat_wave_b_superstore_orders_exposure_cleanup.yaml)（`excluded_columns: []` → full_expose）；跑次注明已清理。

> Wave B（2026-11-14）：KTX 把 `_exposure` 当 overlay → **BLOCKED**；清理须 release restore／删文件＋reindex，勿依赖 cleanup publish。见跑次 [`…-p0-wave-b`](runs/2026-11-14-claude-macmini-p0-wave-b.md)。

---

## UAT-EXPOSURE-02-R — 落点修复后复测 fail-closed（P1-26）

### 前置

1. 运行镜像已含 **P1-26** 落点实现（正式路径 `exposure/<conn>/<source>.yaml`；**禁止**权威写 `_exposure`）  
2. 已通过 WebUI **semantic-assets validate＋publish** 安装  
   [`fixtures/uat_wave_b_superstore_orders_exposure.yaml`](fixtures/uat_wave_b_superstore_orders_exposure.yaml)  
3. 批次 **reindex ok**；ServingGeneration OPEN；该 Source **trimmed**；serving 含 ledger

### 步骤

1. `lucy_begin_question`：`question`＝「订单客户名分布」／等价单表意图  
2. `lucy_query`：点名 `superstore_orders.customer_name`（dimensions）

### 期望

- publish／reindex **不得** `reindex_failed`／`composeOverlay`  
- 本机拒绝；`reason`／文本含 `field_not_exposed`；上游执行 0  
- 缺实现／仍写 `_exposure` → **BLOCKED**（不得记 PASS）

### 清理

见 `UAT-EXPOSURE-04`（同会话可连续跑）。

---

## UAT-EXPOSURE-03 — 台账生效期间合法查数不挂连接（P1-26）

### 前置

同 `UAT-EXPOSURE-02-R`：trimmed 台账已激活；serving 含 ledger。

### 步骤

1. `lucy_begin_question`：「订单数是多少」  
2. `lucy_query`：`superstore_orders.order_count`＋`active_rows`（**不**点名 `customer_name`）

### 期望

- 查询**成功**返回数值  
- 错误体／日志**不得**出现 `composeOverlay`／`unhandled keys [version, source, excluded_columns, updated_at]`  
- 合法查数失败 → **FAIL**（附带伤害未消除）

---

## UAT-EXPOSURE-04 — cleanup／恢复路径可 publish＋reindex（P1-26）

### 前置

同会话刚跑过 `02-R`（或仍处 trimmed）。

### 步骤

1. publish [`fixtures/uat_wave_b_superstore_orders_exposure_cleanup.yaml`](fixtures/uat_wave_b_superstore_orders_exposure_cleanup.yaml)（`excluded_columns: []`）  
2. 确认 reindex **ok**、activation 确认  
3. `lucy_query` 点名 `superstore_orders.customer_name`（或合法 measure 冒烟）

### 期望

- cleanup publish **不得** `reindex_failed`  
- 数据面按 full_expose／未配置合同恢复（该列可查，或至少不再因 `_exposure` overlay 挂连接）  
- 仍须手删文件／restart 才能恢复 → **FAIL**
