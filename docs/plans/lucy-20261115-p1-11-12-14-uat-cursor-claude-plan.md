# P1-11／12／14 差集 UAT 收口（Cursor 用例＋验收／Claude 全真执行）Plan

| 治理字段 | 内容 |
|---|---|
| 状态 | 执行进度以本文件原Task勾选和已有跑次为准；本次仅补齐文档形态，未复跑本计划业务验收，当前候选结果待验。 |
| 授权边界 | 仅本计划既有Task所列范围，原审批和禁止项见正文；本次文档治理修订不新增运行代码、提交、部署或发布授权。 |

> **For agentic workers:** 委托人已选定范围 **A**＋协作 **预写齐 + 分条执行**。按 Task 勾选推进；全真优先；禁止 vitest／CR 冒充 INDEX PASS。

**Goal:** 在本机 Mac mini demo 上，为已落地且测试台仍为 `not_registered` 的 **P1-11／P1-12／P1-14** 建立 UAT 套件、完成可复查跑次，并回链 INDEX／e2e-ledger／总账；关闭这三条的测试台差集。

**Architecture:** Cursor 一次预写三套件（suite／cases／fixtures）与三份 Claude brief；Claude **按条串行**全真执行并只写 `runs/`；每条结束后 Cursor 验收台账再放行下一条。不改运行产品代码；不碰 P0-A／P1-16／P1-20／P1-26 缺口假装关闭。

**Tech Stack:** demo Docker WebUI `:55176`；MCP Proxy `:57881`；Admin 审计导出；凭据只读桌面路径；`docs/qa/uat/` 唯一测试台 SOT；约定见 [`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)。

## Global Constraints

- **环境**：仅本机 Mac mini + 现行 demo Docker；跑次记录实际 `gitSha`／端口
- **范围**：只 P1-11／REQ-030-032、P1-12／REQ-030-033、P1-14／REQ-030-035；**不做** P0-6／7／B、P1-26 实现、EXT live、云端冒充本波 PASS
- **全真**：真实 WebUI／API／MCP；禁止 mock／CR／单测冒充 INDEX PASS
- **凭据**：只写路径。WebUI：`/Users/forrest/Desktop/lucywebui logi.txt`；MCP 问数：`/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`）；禁写入 runs／inbox／回复
- **预算阈值**：`QUESTION_BUDGET_MAX_CALLS`／`MAX_BUSY_MS` 为**源码常量**（60／300000），**无**环境变量可下调。耗尽类用例必须真实跑到阈值（或诚实 `BLOCKED`），禁止为图快改常量／临时 patch
- **合同**：不改 Spec「功能合同已收口／已实现」类句为「可上线」；可增测试台指针
- **≠ 可上线；≠ 核心升级完成**
- **分工硬边界**：Claude **不得**改 INDEX／e2e-ledger／Spec 合同状态／总账跟进状态；不得在无委托人授权时把 `BLOCKED` 降级为替身 PASS；不得改 `webui/server` 运行代码

---

## 0. 角色与流水线

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| **委托人** | 审批本 Plan；对停表／FAIL 决定修 bug 或书面降级 | 不必亲手跑 MCP |
| **Cursor** | 写套件与 brief；每条验收 runs；更新 INDEX／e2e-ledger／总账／lint；向委托人交结论 | 不伪造跑次；不把「读代码觉得对」写成 PASS |
| **Claude Code** | 按 brief 全真跑；写 `runs/YYYY-MM-DD-claude-macmini-p1-*.md`；失败停表 | 不改 INDEX／合同句；不写 secret |

```text
T0 Plan（本文件）──► T1 Cursor 预写三套件＋三 brief
                         │
                         ▼
              T2 Claude 跑 P1-11 ──► T3 Cursor 验收 P1-11
                         │
                         ▼
              T4 Claude 跑 P1-12 ──► T5 Cursor 验收 P1-12
                         │
                         ▼
              T6 Claude 跑 P1-14 ──► T7 Cursor 验收 P1-14＋总收口
```

**依赖说明：** P1-14 需要真实 `budget_stop` 行。优先在 **T4（P1-12）** 的可选耗尽用例 `UAT-BUDGET-03` 已 PASS 时复用同批审计证据；若 T4 跳过耗尽，则 T6 必须自行完成 61 次数据工具调用。两条不得互相用 vitest 冒充。

---

## 1. 本机可跑矩阵

| 清单 | Suite ID | Case ID | 层级 | 期望要点 |
|---|---|---|---|---|
| P1-11 | `UAT-SUITE-OPS-CONCEPTS` | UAT-R0 | 必做 | compose healthy；WebUI 可登录；MCP initialize OK；记录 `gitSha` |
| P1-11 | 同上 | UAT-OPS-CONCEPT-01 | 必做 | 问数 Token（无 `allow.ops`）**不可见／不可调** `lucy_ops_concept_*` |
| P1-11 | 同上 | UAT-OPS-CONCEPT-02 | 必做 | Owner 在 WebUI 建临时 Role（`allow.ops` 含 list／show／summary／scan）＋Agent → 用该 Token：`list`（或等价只读）成功；`scan` 可只读预览／计划态，**默认不 commit 人审写** |
| P1-11 | 同上 | UAT-OPS-CONCEPT-03 | 必做 | 测后删除临时 Agent／Role（或禁用）；确认问数 Token 仍无 ops 工具 |
| P1-12 | `UAT-SUITE-QUESTION-BUDGET` | UAT-R0 | 必做 | 同环境门禁 |
| P1-12 | 同上 | UAT-BUDGET-01 | 必做 | MCP `initialize` instructions（或等价指导注入）含 **60 次／300 秒**；不得仍写 20／120 |
| P1-12 | 同上 | UAT-BUDGET-02 | 必做 | 新开问询后连续 ≥3 次成功数据工具（如 `lucy_catalog` 不计则改用允许的数据工具／`lucy_query`），确认未在第 21 次误耗尽（旧阈值回归） |
| P1-12 | 同上 | UAT-BUDGET-03 | 可选／推荐 | 同问询第 **61** 次数据工具 → `question_budget_exhausted`（SC-T1 客户场景）；证据可供 P1-14 复用 |
| P1-14 | `UAT-SUITE-BUDGET-AUDIT` | UAT-R0 | 必做 | Admin 可登录；审计导出可达 |
| P1-14 | 同上 | UAT-BUDGET-AUDIT-01 | 必做 | 存在本波产生的 `budget_stop`（来自 BUDGET-03 或本套件内自跑 61 次）；`GET /api/admin/audit/export`（calls.csv）对应行含 `budgetSnapshot` 或表尾扁平列非空 |
| P1-14 | 同上 | UAT-BUDGET-AUDIT-02 | 必做 | 同批导出中，普通成功业务调用行 **不含** `budgetSnapshot` 键（或扁平列为空） |
| P1-14 | 同上 | UAT-BUDGET-AUDIT-03 | 必做 | `export-metadata`（v1）字段说明含快照／扁平列；**v2 metadata 不含**本条新列 |

编号前缀登记进 CONVENTIONS（Cursor T1）：`UAT-OPS-CONCEPT-*`、`UAT-BUDGET-*`、`UAT-BUDGET-AUDIT-*`。

### 环境钉死（Claude 执行前必须打印）

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176`（以当次映射为准） |
| Health | `http://127.0.0.1:55176/api/health` → `gitSha`／`lucyVersion`／`ktxRuntime` |
| MCP | `http://127.0.0.1:57881/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml`；容器 `compose-lucy-1` |
| 问数连接 | `demo-mysql`；源 `superstore_*` |
| 凭据 | 桌面路径 only（见 Global Constraints） |
| 用例正文 | 各套件 `cases.md`／`fixtures.md`（以仓库为准） |

---

## 2. 文件与产物

| 产物 | 路径 | 谁写 |
|---|---|---|
| 本 Plan | `docs/plans/lucy-20261115-p1-11-12-14-uat-cursor-claude-plan.md` | Cursor |
| 套件 P1-11 | `docs/qa/uat/suites/ops-concepts/{suite,cases,fixtures}.md` + `runs/` | Cursor（跑次 Claude） |
| 套件 P1-12 | `docs/qa/uat/suites/question-budget/{suite,cases,fixtures}.md` + `runs/` | Cursor（跑次 Claude） |
| 套件 P1-14 | `docs/qa/uat/suites/budget-audit/{suite,cases,fixtures}.md` + `runs/` | Cursor（跑次 Claude） |
| Brief×3 | `inbox/20261115-p1-11-ops-concepts-claude-brief.md` 等 | Cursor |
| 跑次 | `runs/2026-11-15-claude-macmini-p1-11-ops.md` 等 | Claude |
| 证据（可选） | `inbox/uat-p1-11-12-14-2026-11-15/`（禁 secret） | Claude |
| INDEX／e2e／总账／lint | 见各验收 Task | Cursor |
| CONVENTIONS 前缀行 | `docs/qa/uat/CONVENTIONS.md` | Cursor T1 |
| README 套件表 | `docs/qa/uat/README.md` | Cursor T1 |
| `check-e2e-ledger.mjs` REQUIRED | 验收通过后追加三行 | Cursor |

---

## 3. Tasks

### Task 0: 委托人确认本 Plan

**Files:** 本文件

- [x] **Step 1:** 确认范围 A＝仅 P1-11／12／14（会话已选 A）
- [x] **Step 2:** 确认协作＝预写齐 + 分条执行（会话已选第三种）
- [x] **Step 3:** 确认耗尽类允许本机真实跑满 61 次；禁止改常量（Plan Global Constraints 已钉死；执行选「1」开工）
- [x] **Step 4:** demo 原样：`gitSha=9d59337d` 容器内已核 `MAX_CALLS=60`、`lucy_ops_concept_*`、`budget_event_kind`；不强制 upgrade

**验收：** 委托人已选执行「1」；Cursor 进入 T1。

---

### Task 1: Cursor — 预写三套件＋三 brief＋约定登记

**Files:**
- Create: `docs/qa/uat/suites/ops-concepts/suite.md`
- Create: `docs/qa/uat/suites/ops-concepts/cases.md`
- Create: `docs/qa/uat/suites/ops-concepts/fixtures.md`
- Create: `docs/qa/uat/suites/ops-concepts/runs/.gitkeep`（或首跑时再建）
- Create: `docs/qa/uat/suites/question-budget/suite.md`
- Create: `docs/qa/uat/suites/question-budget/cases.md`
- Create: `docs/qa/uat/suites/question-budget/fixtures.md`
- Create: `docs/qa/uat/suites/budget-audit/suite.md`
- Create: `docs/qa/uat/suites/budget-audit/cases.md`
- Create: `docs/qa/uat/suites/budget-audit/fixtures.md`
- Create: `inbox/20261115-p1-11-ops-concepts-claude-brief.md`
- Create: `inbox/20261115-p1-12-question-budget-claude-brief.md`
- Create: `inbox/20261115-p1-14-budget-audit-claude-brief.md`
- Modify: `docs/qa/uat/CONVENTIONS.md`（编号表加三前缀）
- Modify: `docs/qa/uat/README.md`（当前套件表加三行）

**Interfaces:**
- Consumes: Spec P1-11／12／14 头部与验收句；CONVENTIONS 第一性原则；模板 `docs/qa/uat/templates/*`
- Produces: 可执行 cases（步骤／期望／清理）；brief 含跑序、停表条件、runs 文件名、凭据路径

- [x] **Step 1:** 按模板写 P1-11 套件；临时资源命名前缀 `uat-ops-concept-`；清理步骤强制
- [x] **Step 2:** 写 P1-12 套件；BUDGET-02 明确「第 21 次不得 exhausted」；BUDGET-03 标可选但推荐，步骤含如何计数「数据工具」
- [x] **Step 3:** 写 P1-14 套件；依赖说明：优先复用同日 BUDGET-03 的 `budget_stop`；否则自跑 61 次；导出命令写清 `GET /api/admin/audit/export` 与 `export-metadata`／v2
- [x] **Step 4:** 写三份 Claude brief（每份一页内：环境钉死、跑序、断言、停表、runs 名、禁止项）
- [x] **Step 5:** 更新 CONVENTIONS／README；**不**提前把 INDEX 写成 PASS（可先不登记行，或登记「NOT RUN」等 T3／T5／T7）

**验收：** 三套件可独立打开执行；brief 无 secret；无「临时改常量」步骤。

---

### Task 2: Claude Code — 全真执行 P1-11

**Files:**
- Create: `docs/qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-11-ops.md`
- Optional: `inbox/uat-p1-11-12-14-2026-11-15/p1-11/`（禁 secret）

**跑序（强制）:**

1. 读 brief＋`fixtures.md`＋`cases.md`
2. UAT-R0 → UAT-OPS-CONCEPT-01 → 02 → 03
3. 写跑次；交汇总表；**不改 INDEX**

**停表:** 必做任一 FAIL／无法构造 ops Role → `FAIL`／`BLOCKED` 写明原因；不改代码；不跳过清理（能清则清）。

- [x] **Step 1:** 执行并落盘跑次（Cursor 调本机 Claude Code；跑次已落）
- [x] **Step 2:** 向 Cursor 交：Case 结果表＋关键摘录路径

**验收：** 跑次存在；清理完成。**套件判定 FAIL**（02）。

---

### Task 3: Cursor — 验收 P1-11 台账

**Files:**
- Modify: `docs/qa/uat/INDEX.md`（增 `UAT-SUITE-OPS-CONCEPTS` 行）
- Modify: `docs/governance/e2e-ledger.md`（P1-11：`not_registered` → Suite＋跑次）
- Modify: `docs/governance/lucy-20261107-lucy-0-30-feature-inventory-pool.md`（P1-11 Spec 列回链测试台；变更行；**不**改合同收口为可上线）
- Modify: `docs/specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md`（状态行可加 UAT 指针；不改收口语义）
- Modify: `scripts/uat/check-e2e-ledger.mjs`（追加 P1-11 REQUIRED）

- [x] **Step 1:** 抽查 01／02／03 证据是否支撑判定 → 同意 **FAIL**（授权 PASS；业务受理 FAIL）
- [x] **Step 2:** 更新 INDEX／e2e／总账／Spec 指针／lint 登记；登记 GAP-UAT-P1-11-RUNTIME
- [x] **Step 3:** `npm run lint:e2e-ledger`
- [ ] **Step 4:** PASS 才放行 T4；**本波 FAIL → 停串行闸**；请示委托人：修 P1-11 或放行继续 P1-12／14

**验收：** lint PASS；P1-11 已挂测试台（结果＝FAIL）。

---

### Task 4: Claude Code — 全真执行 P1-12

**Files:**
- Create: `docs/qa/uat/suites/question-budget/runs/2026-11-15-claude-macmini-p1-12-budget.md`
- Optional: inbox 证据子目录

**跑序:**

1. UAT-R0 → UAT-BUDGET-01 → UAT-BUDGET-02
2. **推荐**跑 UAT-BUDGET-03（61 次）；若时间／稳定性不足 → 标 `SKIPPED` 并说明，T6 必须自跑耗尽
3. 写跑次；**不改 INDEX**

**停表:** 01／02 FAIL → 停；03 失败记入跑次，不改常量。

- [ ] **Step 1:** 执行并落盘
- [ ] **Step 2:** 交汇总（含是否完成 03、预算终止审计行线索）

---

### Task 5: Cursor — 验收 P1-12 台账

**Files:** 同 T3 模式，对象改为 P1-12／`UAT-SUITE-QUESTION-BUDGET`／Spec `lucy-20261111-question-budget-threshold-relax-spec.md`

- [ ] **Step 1:** 验收 01／02（及 03 若跑）
- [ ] **Step 2:** 更新 INDEX／e2e／总账／Spec 指针／`check-e2e-ledger.mjs`
- [ ] **Step 3:** `npm run lint:e2e-ledger`
- [ ] **Step 4:** 放行 T6

---

### Task 6: Claude Code — 全真执行 P1-14

**Files:**
- Create: `docs/qa/uat/suites/budget-audit/runs/2026-11-15-claude-macmini-p1-14-audit.md`

**跑序:**

1. UAT-R0
2. 若 T4 已有当日 `budget_stop` → 直接 AUDIT-01…03；否则先完成本套件内 61 次耗尽再导出
3. Admin 登录 → 导出 calls.csv＋v1／v2 metadata → 断言
4. 写跑次；**不改 INDEX**

**停表:** 无 `budget_stop` 且无法跑满 61 次 → `BLOCKED`，申请委托人授权或另排期；**不得**用 vitest CSV 夹具冒充。

- [ ] **Step 1:** 执行并落盘
- [ ] **Step 2:** 交汇总（导出文件放 inbox，禁 cookie／token）

---

### Task 7: Cursor — 验收 P1-14＋本波总收口

**Files:**
- Modify: INDEX／e2e／总账／P1-14 Spec 指针／`check-e2e-ledger.mjs`
- Modify: `docs/governance/e2e-ledger.md` §3 兜底队列（注明 P1-11／12／14 差集已挂或残留）
- Optional: 本 Plan Task 勾选回写

- [ ] **Step 1:** 验收 AUDIT-01…03
- [ ] **Step 2:** 台账三联更新 + lint
- [ ] **Step 3:** 向委托人交一页结论：三条判定、未关缺口清单（P0-A／P1-16／20／26）、≠ 可上线

**验收：** 三条均已挂测试台；`npm run lint:e2e-ledger` PASS；无 secret 进库。

---

## 4. 成功标准

| # | 标准 |
|---|---|
| 1 | 三套件存在且 cases 可复查 |
| 2 | 每条有当日 Claude Mac mini 跑次；判定仅用 PASS／PASS WITH GAP／FAIL／SKIPPED／BLOCKED |
| 3 | INDEX 含三 Suite；e2e-ledger 中 P1-11／12／14 退出 `not_registered`（或诚实 BLOCKED 叙事） |
| 4 | `npm run lint:e2e-ledger` PASS |
| 5 | 无密码／token 进仓库；未改运行产品代码；≠ 可上线 |
| 6 | 本波**未**把 P0-A／P1-16／P1-20／P1-26 写成已关闭 |

## 5. 明确不做（本波）

- P1-26 实现与 EXPOSURE-02-R 复测  
- P1-16／P1-20 外部目录 live EXT  
- P0-6／7／B UAT  
- 将发布取证或 vitest 绿写成 UAT PASS  
- 为加快耗尽而修改 `QUESTION_BUDGET_MAX_*` 常量或挂临时 patch  

## 6. 委托人已批（会话）

- 范围 **A**：差集收口 P1-11／12／14  
- 协作 **第三种**：预写齐 + 分条执行  
- Cursor＝用例编写与结果确认；Claude＝执行测试  

（Task 0 其余勾选：耗尽允许真实 61 次、demo 是否 upgrade — 执行前再口头钉死即可。）

## 目标（治理补齐）

完成Ops概念、问询预算和预算审计三套差集UAT并分别登记。

## 开工前置（治理补齐）

先按本机可跑矩阵锁定容器、凭据和预算真实阈值60/300000；不为提速修改常量。

## 完成定义（治理补齐）

按§4成功标准核对三套runs及INDEX/e2e；耗尽类未跑到阈值须诚实BLOCKED，不能以单测替代。

## 风险（治理补齐）

预算耗尽成本高且复用有先后依赖；无budget_stop不得宣称审计出口已实测。
