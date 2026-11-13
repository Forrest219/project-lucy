# Lucy 0.30 P0 治理优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按方案 C 分两波把 0.30 P0 主线的**实现 CR 证据债**与**未齐条目确权路径**收干净，使清单／Spec／`docs/reviews/` 三处现值一致；**不**借本 Plan 宣称可上线。

**Architecture:** Wave A 只对已落地且功能合同已收口的 P0（P0-2／P0-A／P0-4／P0-5）做**实现层 Code Review 落盘＋镜像回链**；模板对齐既有 P0-1 CR。Wave B 只推进 P0-6／P0-7／P0-B 的 **O 项闭合 → R2-F**；**R4 与改运行代码不在本 Plan 默认范围内**，须委托人另发。

**Tech Stack:** Markdown 落盘（`docs/reviews/`／Spec／Plan／清单池）；Vitest 复跑（CR 复测用）；可选 Codex CLI（R2-F）；不改 KTX。

| 元数据 | 内容 |
|---|---|
| 文档版本／日期 | **v0.1**／2026-11-13 |
| 决策来源 | 2026-11-13 分支审计（相对 `lucy-v0.25`）；委托人选定方案 **C**（先治理债、再未齐主线） |
| 状态 | **可执行（文档／评审）**。**Wave A 已完成（2026-11-13）**——P0-2／A／4／5 实现 CR 落盘＋镜像回链。**Wave B Task 6–8 O 裁定回写已完成（2026-11-13）**；**Task 9 R2-F 仍 OPEN**。**≠ 可上线**。Wave B **不授权改代码** |
| 授权边界 | 本 Plan **≠** 上线／客户出包／把 P0-6／7／B 直接开工。发现 BLOCK 时：Wave A 可修已授权条的实现；Wave B 只改 Spec／Plan／评审 |
| 对照事实源 | [功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md) §2.2／§3；[核心方向](lucy-20261107-lucy-0-30-core-direction.md) |
| 既有 CR 范本 | [P0-1 CR](../reviews/2026-11-08-p0-1-caliber-binding-code-review.md)；[P0-3 实现复审](../reviews/2026-11-13-source-ambiguity-gate-implementation-review.md) |

## Global Constraints

- 功能现行状态只以各 Spec 头部「状态」行为准；改状态须同句镜像清单池／Plan／`docs/README.md`（见 `docs/governance/DEVELOPMENT.md`）。
- **过程对抗 ≠ 终稿确权 ≠ 开发授权**；不得把 Wave A 的 CR PASS 写成「可上线」。
- Wave A **禁止**扩大产品 scope（不借 CR 新开功能）。
- Wave B **禁止**在无 R2-F＋R4 前改 `webui/server`／Eval runner 等运行路径。
- 不把旁路项（catalog-scan／mcp-skill／sankey／connection-reload）混进本 Plan；另开登记工单。
- 本地脚本兼容 stock macOS bash 3.2；客户镜像约束不变。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`。

---

## 范围与非目标

### 范围内

| 波次 | 条目 | 动作 |
|---|---|---|
| **A** | P0-2、P0-A、P0-4、P0-5 | 独立实现 CR → 落 `docs/reviews/` → Spec／清单回链 CR |
| **A′** | P0-1、P0-3 | 仅核对既有 CR 链接仍有效；不重开全量复审（除非发现链接／结论分叉） |
| **B** | P0-6、P0-7、P0-B | 决策纸齐套 → 委托人 O 闭合 → R2-F；停在「待 R4」 |

### 非目标

- 不宣称「0.30 核心升级完成」（P0-6／7／B 未齐前禁止）。
- 不在本 Plan 内做 P1／P2／旁路功能登记。
- 不自动授予 P0-6／7／B 的 R4。
- 不把 SC 证据审计当成实现 CR（审计可引用，不可替代）。

---

## 文件地图（将创建／修改）

| 路径 | 职责 |
|---|---|
| `docs/reviews/2026-11-13-p0-2-catalog-business-semantics-code-review.md` | P0-2 实现 CR（新建） |
| `docs/reviews/2026-11-13-p0-a-semantic-source-field-exposure-code-review.md` | P0-A 实现 CR（新建） |
| `docs/reviews/2026-11-13-p0-4-answer-verifiability-code-review.md` | P0-4 实现 CR（新建） |
| `docs/reviews/2026-11-13-p0-5-empty-result-next-step-code-review.md` | P0-5 实现 CR（新建） |
| `docs/reviews/2026-11-13-p0-7-o1-o6-decision-package.md` | P0-7 建议包 E 决策纸（新建；从 Spec 抽出可勾选表） |
| `docs/reviews/2026-11-13-p0-b-o1-o3-decision-package.md` | P0-B 建议包 F 决策纸（新建） |
| 各条 Spec／Plan 头部「状态」「评审记录」 | 回链 CR；Wave B 回写 O 闭合／R2-F |
| `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md` | §3 链接列补 CR；变更行登记本 Plan |
| `docs/README.md`／`docs/plans/README.md`／`docs/governance/project-overview.md` §9 | 镜像同句现值（仅在状态句变化时） |

**已存在、Wave A 只引用不重写：**

- P0-1 CR、P0-3 实现复审、各条 SC 证据审计、P0-6 O1–O3 决策纸 [`2026-11-13-p0-6-o1-o3-decision-package.md`](../reviews/2026-11-13-p0-6-o1-o3-decision-package.md)

---

## Wave A — 实现 CR 证据债

### 统一 CR 模板（每条必须含）

复制 P0-1 CR 结构，至少含：

1. 元数据表：文档类型＝**实现 code review（不是 Spec）**；日期；评审人；实现 commit（`git log` 取 feat 合入 hash）；对象 Spec／Plan 版本  
2. **结论**：`PASS`／`Approve with nits`／`BLOCK`（与正文一致；禁止只写在对话里）  
3. 已对齐摘要表（对照 Spec 关键 D／SC）  
4. Findings（must-fix／should-fix／nit）；CLOSED 须写复测命令与结果  
5. 明示：**本 CR 不表示可上线**

**复测基线命令（按条替换测试文件）：**

```bash
cd webui && npx vitest run <test-globs> --reporter=dot
```

预期：与各条 SC 证据审计中的通过数一致或在 CR 中解释差额。

---

### Task 1: P0-2 Catalog 业务语义 — 实现 CR 落盘

**Files:**
- Create: `docs/reviews/2026-11-13-p0-2-catalog-business-semantics-code-review.md`
- Modify: `docs/specs/lucy-20261107-catalog-business-semantics-spec.md`（评审记录／状态补 CR 链）
- Modify: `docs/plans/lucy-20261107-catalog-business-semantics-plan.md`（同句）
- Modify: `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`（§3 P0-2 链接列）
- Test: `webui` 内 `catalog-business-semantics` 相关 vitest（以 SC 审计所列文件为准）

**Interfaces:**
- Consumes: Spec v0.6；[`2026-11-13-catalog-business-semantics-sc-evidence-audit.md`](../reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md)；实现 commits `39512177`／`91a9dfc3`
- Produces: 落盘 CR 结论；清单可点开的 CR 链接

- [x] **Step 1: 锁定审查范围**

```bash
cd /Users/forrest/GitHub/project-lucy
git show --stat 39512177 91a9dfc3
rg -n "catalog-business-semantics|descriptionState|businessSemantics" webui/server --glob '*.ts' | head -40
```

- [x] **Step 2: 复跑自动化**

```bash
cd webui && npx vitest run catalog-business-semantics --reporter=dot
```

Expected: 与证据审计一致（审计记 23/23）；若失败，CR 结论不得写 PASS，先记 BLOCK。

- [x] **Step 3: 写 CR 正文**

对照 Spec D／SC（至少：可见性裁剪、缺描述态、零列预览、D7 排序现状）写「已对齐」与 Findings；结论三选一。

- [x] **Step 4: 镜像回链**

Spec／Plan「评审记录」加 CR 链接；清单 §3 P0-2 列仿 P0-1 加 `[CR](...)`；若结论为 PASS／Approve with nits，状态句可补「实现 CR 已落盘」，**不得**改「≠ 可上线」。

- [x] **Step 5: 变更行**

清单池「变更」追加一行：Wave A P0-2 CR 落盘（本 Plan）。

---

### Task 2: P0-A 字段暴露 — 实现 CR 落盘

**Files:**
- Create: `docs/reviews/2026-11-13-p0-a-semantic-source-field-exposure-code-review.md`
- Modify: `docs/specs/lucy-20261107-semantic-source-field-exposure-spec.md`
- Modify: `docs/plans/lucy-20261107-semantic-source-field-exposure-plan.md`
- Modify: `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`
- Test: SC 审计所列 5 files／75 passed 对应 vitest

**Interfaces:**
- Consumes: Spec v0.7；[`2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md`](../reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md)；`49c845ce`／`91a9dfc3`
- Produces: P0-A CR 落盘＋回链

- [x] **Step 1: 锁定路径与门禁插入点**

```bash
rg -n "field_not_exposed|field_exposure|loadExposureSet|expectedSetRequired" webui/server --glob '*.ts' | head -50
git show --stat 49c845ce
```

- [x] **Step 2: 复跑 vitest（按审计文件列表）**

Expected: 审计声称的 75 passed；失败则 BLOCK。

- [x] **Step 3: 写 CR**（重点核对 D20 先授权再暴露、D26 四透传、fail-closed）

- [x] **Step 4: Spec／Plan／清单回链**（同 Task 1）

---

### Task 3: P0-4 答复可核对 — 实现 CR 落盘

**Files:**
- Create: `docs/reviews/2026-11-13-p0-4-answer-verifiability-code-review.md`
- Modify: `docs/specs/lucy-20261107-answer-verifiability-spec.md`
- Modify: `docs/plans/lucy-20261107-answer-verifiability-plan.md`
- Modify: `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`
- Test: answer_verifiability／相关 proxy 测（以 Spec SC 与 `bcdeb624` 为准）

**Interfaces:**
- Consumes: Spec v0.4；实现 `bcdeb624`；既有状态句「Approve with nits（C1／C2／M5 已闭）」——**本 Task 必须把 C1／C2／M5 写成可追溯 Finding 或 CLOSED 行**，禁止继续无附件宣称
- Produces: 可引用的实现 CR；消掉「有结论无文件」分叉

- [x] **Step 1: 找回历史 nits 线索**

```bash
rg -n "C1|C2|M5|answer_verifiability|Approve with nits" docs/specs/lucy-20261107-answer-verifiability-spec.md docs/plans/lucy-20261107-answer-verifiability-plan.md inbox/ 2>/dev/null | head -40
git show --stat bcdeb624
```

若 inbox／对话无原始 CR：本轮**重新审查**并新编号 Findings，不得伪造「C1／C2／M5」闭合证明。

- [x] **Step 2: 复跑相关 vitest**

- [x] **Step 3: 写 CR**（强制覆盖：成功路径必有块、cutoff=`not_checked`、与 P0-5 共存、禁止静默无块）

- [x] **Step 4: 回链**；若重审结论与旧状态句冲突，以本轮 CR 为准改 Spec／清单同句

---

### Task 4: P0-5 空结果 next_step — 实现 CR 落盘

**Files:**
- Create: `docs/reviews/2026-11-13-p0-5-empty-result-next-step-code-review.md`
- Modify: `docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md`
- Modify: `docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md`
- Modify: `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`
- Test: [`2026-11-13-empty-result-next-step-sc-evidence-audit.md`](../reviews/2026-11-13-empty-result-next-step-sc-evidence-audit.md) 所列测

**Interfaces:**
- Consumes: Spec v0.8；`bcdeb624`；SC 审计 SC-01–SC-30
- Produces: P0-5 CR 落盘＋回链

- [x] **Step 1–4:** 同 Task 3 结构（范围改为 `next_step`／D1–D3＝A／与 P0-4 共存）

---

### Task 5: Wave A 收束 — 镜像索引与自检

**Files:**
- Modify: `docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md`（仅当状态句变化）
- Modify: `docs/plans/lucy-20261113-p0-governance-optimization-plan.md`（勾选 Wave A 完成）

- [x] **Step 1: 链接可达性**

```bash
cd /Users/forrest/GitHub/project-lucy
for f in \
  docs/reviews/2026-11-13-p0-2-catalog-business-semantics-code-review.md \
  docs/reviews/2026-11-13-p0-a-semantic-source-field-exposure-code-review.md \
  docs/reviews/2026-11-13-p0-4-answer-verifiability-code-review.md \
  docs/reviews/2026-11-13-p0-5-empty-result-next-step-code-review.md; do
  test -f "$f" && echo "OK $f" || echo "MISSING $f"
done
```

Expected: 四行均为 OK。

- [x] **Step 2: 清单 §3 四条均有 CR 链接**；P0-1／P0-3 旧链接仍 200（文件存在）。

- [x] **Step 3: 跑形态门禁（文档）**

```bash
npm run lint:spec-docs
```

Expected: 无因本波新增／改写 Spec 引入的新阻塞；若有，当场修。

- [x] **Step 4: Wave A 完成定义勾销**

Wave A Done when：四份 CR 落盘；无「Approve with nits／Cursor reviewer CR」无附件；清单／Spec 同句；**仍全部写明 ≠ 可上线**。

---

## Wave B — 未齐 P0 确权路径（冻结落地）

### Task 6: P0-6 — 推动 O1–O3 闭合（建议包 S）

**Files:**
- Read: `docs/reviews/2026-11-13-p0-6-o1-o3-decision-package.md`（已有）
- Modify（仅在委托人裁定后）: `docs/specs/lucy-20261107-eval-source-selection-correctness-spec.md`；配套 Plan；清单池 P0-6 行

**Interfaces:**
- Consumes: 建议包 S；清单 §2.2 门禁序
- Produces: Spec §4 O1–O3「已闭合」；**仍不是 R4**

- [ ] **Step 1: 向委托人呈送决策纸**（整包 S／逐条／本轮不裁定）

- [x] **Step 2: 若整包采纳 S** — 回写 Spec O 行＋Plan 开工前置；清单跟进状态改为「O1–O3 已闭合；待 R2-F」；**禁止**改代码（2026-11-13 完成；Task 13 镜像收束）

- [ ] **Step 3: 若本轮不裁定** — 在决策纸与清单注明「继续冻结」；本 Task 关闭为 Deferred（不适用：已采纳 S）

---

### Task 7: P0-7 — 抽出建议包 E 决策纸并推动 O1–O6

**Files:**
- Create: `docs/reviews/2026-11-13-p0-7-o1-o6-decision-package.md`
- Read: `docs/specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md`（建议包 E 正文）
- Modify（裁定后）: 同上 Spec／Plan；清单池 P0-7 行

**Interfaces:**
- Consumes: Spec 内建议包 E；[`2026-11-09-p0-6-p0-7-p0-b-spec-advance.md`](../reviews/2026-11-09-p0-6-p0-7-p0-b-spec-advance.md)
- Produces: 与 P0-6 同形的可勾选决策纸

- [x] **Step 1: 从 Spec 抽出 O1–O6 建议表**，写成独立决策纸（性质句照抄 P0-6 决策纸：不构成 R2-F／R3／R4）

- [x] **Step 2: 委托人勾选**（整包 E／改写／不裁定）

- [x] **Step 3: 裁定后回写 Spec／清单**（同 Task 6 Step 2／3）（2026-11-13 完成；Task 13 镜像收束）

---

### Task 8: P0-B — 抽出建议包 F 决策纸并推动 O1–O3

**Files:**
- Create: `docs/reviews/2026-11-13-p0-b-o1-o3-decision-package.md`
- Read: `docs/specs/lucy-20261109-physical-freshness-contract-spec.md`
- Modify（裁定后）: Spec／Plan；清单池 P0-B 行

**Interfaces:**
- Consumes: 建议包 F；约束「不改 P0-4 已冻 `not_checked`」
- Produces: 决策纸＋（裁定后）O 闭合镜像

- [x] **Step 1–3:** 同 Task 7（范围改为 O1–O3／建议包 F）（2026-11-13 完成；Task 13 镜像收束）

---

### Task 9: Wave B — R2-F 终稿确权（按条）— **仍 OPEN**

**Files:**
- Create or Modify: `docs/reviews/2026-11-*-p0-{6,7,b}-*-codex-review.md` 或委托人明示确权记录
- Modify: 对应 Spec／Plan 头部状态；清单池

**前置:** 该条 O 项已闭合（Task 6／7／8）。

- [ ] **Step 1: 每条任选其一**

  1. Codex CLI 终审（阻断清零／triage 闭合，结论落 `docs/reviews/`）  
  2. 委托人明示确权（无 Codex 或委托人选择直确）

- [ ] **Step 2: 头部状态改为「R2-F 已闭合；待 R4」**；清单同句

- [ ] **Step 3: 停止线** — 本 Plan **到此结束**。R4／实现须委托人新授权后另开 Implementation Plan

Wave B Done when：三条均有决策纸；每条要么 O＋R2-F 闭合，要么书面 Deferred；**零运行代码改动**（除非委托人中途另授且另开 Plan）。

---

## 完成定义（整 Plan）

| 项 | 标准 |
|---|---|
| Wave A | P0-2／A／4／5 各有一份 `docs/reviews/*-code-review.md`；清单可点；无无附件 CR 宣称 |
| Wave A′ | P0-1／P0-3 旧 CR 链接有效 |
| Wave B | P0-6／7／B 决策纸齐；O 与 R2-F 按条闭合或 Deferred |
| 门禁 | `lint:spec-docs` 无本 Plan 引入的新阻塞 |
| 红线 | 全文仍禁止「0.30 核心升级完成」「可上线」 |

---

## 风险

| 风险 | 缓解 |
|---|---|
| 重审发现 BLOCK | Wave A 允许修已授权实现并复测；结论写 BLOCK→CLOSED；不扩 scope |
| 历史「Approve with nits」无法溯源 | Task 3／4 允许全新 Findings；改掉虚假「C1／C2／M5 已闭」句 |
| 委托人暂不裁定 O 项 | Task 6–8 Deferred；不挡 Wave A 收束 |
| 把 R2-F 误当成可实现 | Task 9 停止线；清单必须保留「待 R4／未授权实现」 |

---

## 建议执行序

1. Task 1 → 2 → 3 → 4 → 5（可 1∥2，3∥4）  
2. Task 7∥8（决策纸起草）∥ Task 6（呈送已有 S）  
3. 等委托人勾选后 Task 6–8 回写 → Task 9  

**预计：** Wave A 可在无委托人额外授权下由 agent 跑完；Wave B 卡在委托人勾选与 R2-F。

---

## Self-Review（本 Plan）

| 检查 | 结果 |
|---|---|
| 覆盖审计三问中的 P0 缺口 | CR 债＝Wave A；未齐 Spec 确权＝Wave B；登记已齐的 P0 不重复入池 |
| 无占位符 TBD | 文件名与命令已写死 |
| 未把旁路／P1 混入 | 显式非目标 |
| 未授权实现 | Wave B 停止在 R2-F |

---

## 变更

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1 | 2026-11-13 | 初稿。委托人选 C；Wave A CR 债＋Wave B O／R2-F |
