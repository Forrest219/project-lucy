# Lucy 出包前客户已知缺口交付须知（PP-02）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 出包前客户已知缺口交付须知（PP-02） |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `inbox/prepack-closure-20261122/00-baseline/carve-out.md`；[`docs/reviews/2026-11-20-p160-p164-combined-final-review.md`](2026-11-20-p160-p164-combined-final-review.md)；[`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md)（FDE-PACKCHECK／CORE-AVAILABILITY／ROW-POLICY／RACS／MCP-UPGRADE／CATALOG-SCAN 等行） |
| 适用范围 | 出包前收口（选项 2）：向客户／内部交付说明本轮剔出项与不得宣称范围；**不**替代 UAT 台账、**不**替代出包 Checklist |
| 输出位置 | `docs/reviews/2026-11-22-prepack-customer-known-gaps.md`；草稿快照 `inbox/prepack-closure-20261122/02-known-gaps/draft.md` |

---

## 0. 定位（必读）

| 声明 | 含义 |
|---|---|
| **出包前须知** | 本文仅列本轮（prepack closure PP-02）已确认剔出／未闭合缺口，供交付沟通与评审引用 |
| **≠ 可上线** | 不得据此主张产品可上线或核心升级完成 |
| **≠ 已出包** | 本文不构成出包完成证明；无 amd64 制品、无 C01–C20 成套、无 bootstrap 成套、无 push／发布 |
| **本轮不做 amd64 出包** | 委托人确认：本轮交付范围外含出包本身（见 carve-out） |

BASE 对齐：`carve-out.md`（BASE_SHA `8e3e3f24ccc09cf08fda1dcb043471194e87d58e`；决策＝出包前收口选项 2）。

相关评审：[`2026-11-20-p160-p164-combined-final-review.md`](2026-11-20-p160-p164-combined-final-review.md)。  
测试台概念行：[`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md) → `UAT-SUITE-FDE-PACKCHECK`／`UAT-SUITE-CORE-AVAILABILITY`／`UAT-SUITE-ROW-POLICY`（及 RACS／MCP-UPGRADE／CATALOG-SCAN 相关行）。

---

## 1. 必写剔出项（Carve-outs）

| # | ID／主题 | 状态口径 | 允许留下的证据 | 禁止宣称 |
|---|---|---|---|---|
| 1 | **P1-58／P1-59**（Roles／Agent 并发与规模） | 仅 **B1 smoke**；完整 F58／F59、真实前台全矩阵、**2×／5×**、**R** 未验证 | 既有 B1／PASS WITH GAP 仅作历史 | **不得**声称功能合同收口或完整矩阵 PASS |
| 2 | **正式完整 CSV／ZIP 导出**（P1-57-G6／FIX-01） | **D7 延期**；正式完整导出未闭合 | diagnostic／限定范围跑次 ≠ 正式完整取证 | **不得**把 diagnostic 当作正式导出证据或整套 FDE-PACKCHECK PASS |
| 3 | **P1-28** 行级隔离场景套件 | 测试台仍 **FAIL／BLOCKED** | FAIL／BLOCKED 原样保留 | **不得**主张 P1-28 转绿或核心升级完成 |
| 4 | **P1-20** 客户生产 SelectDB | **NOT VERIFIED** | lab／替身 PASS **不顶替**客户生产 | **不得**用 lab 结果宣称客户生产 SelectDB 已验 |
| 5 | **CORE-AVAILABILITY** | 本轮仅 **定向** CAV（如诊断停／排空反例）；完整 **F61／F62／F63／R-CAV** 未签 | 定向跑次／历史条目可引用但不得扩写 | **不得**声称完整核心可用性矩阵已签或整套 UAT PASS |
| 6 | **P1-53／P1-54** MCP 升级兼容 | **NOT RUN**；按本轮 carve-out：**开发未授权**／不在本轮闭合 | Spec／题库存在 ≠ 已跑 UAT | **不得**主张兼容合同收口或 UAT PASS |

---

## 2. 测试台概念对照（不改 INDEX）

| 套件（INDEX 行） | 与本须知关系 |
|---|---|
| `UAT-SUITE-FDE-PACKCHECK`（P1-55／56／57） | 正式完整 CSV／ZIP＝D7 延期；整套非 PASS／非可上线 |
| `UAT-SUITE-CORE-AVAILABILITY`（P1-61／62／63 等） | 本轮定向 ≠ 完整 F61／F62／F63／R-CAV 签收 |
| `UAT-SUITE-ROW-POLICY`（P1-28／P1-29） | P1-28 场景套件 FAIL／BLOCKED 保留 |
| `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE`（P1-58／59） | 仅 B1；完整合同剔出 |
| `UAT-SUITE-CATALOG-SCAN`（含 P1-20） | 客户生产 SelectDB NOT VERIFIED |
| `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY`（P1-53／54） | NOT RUN；本轮不交付 |

（上表为概念指向；现值以 INDEX／Spec／总账为准，本文不改写测试台。）

---

## 3. 附带范围外（carve-out 同源，非六条主勾选）

| ID | 说明 |
|---|---|
| P1-52 | 客户升级可靠性门禁落地：draft only |
| 出包动作 | amd64、C01–C20、bootstrap 成套、push／发布：本轮 **无** |

---

## 4. 一句话给客户／内部

> 本材料是 **出包前已知缺口须知**，不是上线许可，也不是已出包证明；P1-58／59 完整合同、正式完整导出、P1-28 行隔离套件、客户生产 SelectDB、完整 CORE-AVAILABILITY 矩阵、MCP 升级兼容 UAT，以及 amd64 出包本身，均不在本轮交付宣称范围内。
