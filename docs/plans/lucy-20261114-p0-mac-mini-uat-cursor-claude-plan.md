# P0 本机 Mac mini UAT（Cursor 制定／Claude Code 执行）Plan

> **For agentic workers:** 委托人审批本 Plan 后，按 Task 勾选执行。Cursor 负责用例矩阵、驱动与验收；Claude Code 负责本机全真跑次。禁止用 vitest／CR 冒充 PASS。

**Goal:** 在本机 Mac mini（demo Docker）上，对 **P0-1／P0-2／P0-3／P0-4／P0-5／P0-A** 完成可复查的客户场景 UAT；关闭或如实登记必做／可选缺口，更新测试台 INDEX 与 e2e-ledger 指针。

**Architecture:** 复用既有六套件（方案 B）。Cursor 产出「本机可跑」用例清单与 Claude 执行包；Claude Code 在真实 WebUI／MCP 上执行并写 `runs/`；Cursor 对照 cases 验收后才允许改 INDEX。可选夹具（CALIBER-02／EXPOSURE-02）单独成 Wave B，须委托人批夹具落盘范围。

**Tech Stack:** 本机 `deploy/compose/docker-compose.demo.yml`；WebUI `http://127.0.0.1:55176`；MCP Proxy `http://127.0.0.1:57881/mcp`；Bearer 仅从桌面 token 文件读入进程；`docs/qa/uat/` 约定。

## Global Constraints

- **环境**：仅本机 Mac mini + 现行 demo Docker；不以云端／客户机冒充本波 PASS
- **范围**：只做已落地 P0 问数六条；**P0-6／P0-7／P0-B 不做 UAT**（未实现／冻结）
- **全真**：真实 MCP／API／demo-mysql `superstore_*`；禁止 mock／CR／单测冒充 INDEX PASS
- **凭据**：只写路径；禁写 token／密码进仓库／runs／截图说明。默认 Bearer 文件：`/Users/forrest/Desktop/lucy token.txt`（或 `lucymcp.txt`）
- **合同状态**：本 Plan **不改** Spec「功能合同已收口」句；只动测试台 runs／INDEX／e2e-ledger 指针与总账 Spec 列测试台回链（若缺）
- **≠ 可上线；≠ 核心升级完成**
- **分工硬边界**：Claude Code **不得**自行改 Spec 头部合同句、不得自行宣称可上线、不得在无委托人授权时把 BLOCKED 降级为替身 PASS

---

## 0. 角色分工（审批重点）

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| **委托人（你）** | 审批本 Plan；Wave B 夹具是否允许写入 demo volume；对 BLOCKED／FAIL 做降级或修 bug 授权 | 不必亲手跑 MCP |
| **Cursor（本会话）** | 锁定用例矩阵；写 Claude 执行包；复核 runs；更新 INDEX／e2e-ledger；向委托人交验收结论 | 不把「读代码觉得对」写成 PASS；不替 Claude 伪造跑次 |
| **Claude Code** | 按执行包在本机全真跑用例；写 `runs/YYYY-MM-DD-claude-macmini-p0-*.md`；失败停表上报 | 不改运行产品代码（除非另获事故修复授权）；不改 Spec 合同状态；不把 token 写入文件 |

---

## 1. 本机可跑矩阵（Wave A＝默认审批范围）

> 判定列：✅＝本机现有环境可跑；🔧＝本机可跑但需先落夹具（Wave B）；⛔＝本波不做。

| 清单 | Suite | 用例 ID | 本机 | Wave | 期望要点 |
|---|---|---|---|---|---|
| P0-3 | `UAT-SUITE-SOURCE-AMBIGUITY` | UAT-R0 | ✅ | A | health ok；MCP initialize 成功 |
| P0-3 | 同上 | UAT-SAG-01 | ✅ | A | 业务词「超市」→ `source_ambiguity_gate`，不得静默成交 |
| P0-3 | 同上 | UAT-SAG-02 | ✅* | A-opt | 宿主 attested 确认后放行（需 person token + `x-lucy-host-attestation`）；缺则 `SKIPPED`／`BLOCKED` 写明 |
| P0-1 | `UAT-SUITE-CALIBER-BINDING` | UAT-R0、UAT-CALIBER-01 | ✅ | A | 零 published 绑定时查数不误强制 |
| P0-1 | 同上 | UAT-CALIBER-02 | 🔧 | B | published 绑定偏离 → `caliber_binding_violation` |
| P0-A | `UAT-SUITE-FIELD-EXPOSURE` | UAT-R0、UAT-EXPOSURE-01 | ✅ | A | 未配置暴露台账时全暴露基线 |
| P0-A | 同上 | UAT-EXPOSURE-02 | 🔧 | B | 点名未暴露列 → `field_not_exposed` |
| P0-4 | `UAT-SUITE-ANSWER-VERIFIABILITY` | UAT-R0、UAT-AV-01 | ✅ | A | 成功 `lucy_query` 带 `answer_verifiability`；cutoff 可 `not_checked` |
| P0-4 | 同上 | UAT-AV-02 | ✅ | A-opt | 三载体一致性深检；失败记 GAP 不挡必做 |
| P0-5 | `UAT-SUITE-EMPTY-NEXT-STEP` | UAT-R0、UAT-EMPTY-01 | ✅ | A | 过滤无命中 → 0 行 → `next_step.kind=empty_result` |
| P0-5 | 同上 | UAT-EMPTY-02 | ✅ | A-opt | 聚合 count=0 不得冒充空结果合同（对照） |
| P0-2 | `UAT-SUITE-CATALOG-SEMANTICS` | UAT-R0、UAT-CATSEM-01 | ✅ | A | 可见 `superstore_*` 带 description／descriptionState |
| P0-2 | 同上 | UAT-CATSEM-02 | ✅ | A-opt | 不可见表不得出现在 catalog |
| P0-6／7／B | — | — | ⛔ | — | 冻结未实现；测试台保持 `n/a` |

\*SAG-02：若桌面仅有 MCP agent token、无 person／attestation 路径，标 `BLOCKED` 并停表，**不**降级。

### 环境钉死（执行前 Claude 必须打印）

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Health | `http://127.0.0.1:55176/api/health` → 记录 `gitSha`／`lucyVersion`／`ktxRuntime` |
| MCP | `http://127.0.0.1:57881/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml`；容器 `compose-lucy-1` |
| 连接 | `demo-mysql`；源 `superstore_orders`／`people`／`returns` |
| Bearer 文件 | `/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`） |
| 用例正文 | 各套件 `cases.md`／`fixtures.md`（以仓库为准，本 Plan 不复写步骤细节） |

---

## 2. 文件与产物

| 产物 | 路径 | 谁写 |
|---|---|---|
| 本 Plan | `docs/plans/lucy-20261114-p0-mac-mini-uat-cursor-claude-plan.md` | Cursor |
| Claude 执行包 | `inbox/20261114-p0-macmini-uat-claude-brief.md` | Cursor（审批后） |
| 跑次 | `docs/qa/uat/suites/<suite>/runs/2026-11-14-claude-macmini-p0-qa.md`（可按套件拆文件） | Claude Code |
| 证据目录（可选） | `inbox/uat-p0-macmini-2026-11-14/`（JSON／摘录；**禁 token**） | Claude Code |
| INDEX | `docs/qa/uat/INDEX.md` | Cursor 验收后更新 |
| 勾连 | `docs/governance/e2e-ledger.md` 兜底队列备注 | Cursor |
| 总账 | 仅当需回链跑次指针时改 Spec 列；**不改跟进状态合同句** | Cursor |

---

## 3. Tasks

### Task 1: 委托人审批范围

**Files:** 本 Plan

- [x] **Step 1:** 确认 Wave A（六套件必做 + 标明的 A-opt）纳入本波
- [x] **Step 2:** 确认 Wave B（CALIBER-02／EXPOSURE-02 夹具写入 demo contentRoot）**批准／推迟／不做** → **推迟**
- [x] **Step 3:** 确认 SAG-02：有 attestation 路径则必跑；否则允许 `BLOCKED` 不停整波 → **允许 BLOCKED**

**验收：** 委托人 2026-11-14 已明确勾选。

---

### Task 2: Cursor 落盘 Claude 执行包

**Files:**
- Create: `inbox/20261114-p0-macmini-uat-claude-brief.md`
- Reference: 六套 `docs/qa/uat/suites/*/cases.md`、`fixtures.md`、本 Plan §1

**Produces:** 给 Claude Code 的一次性 brief（环境钉死、用例序、判定表、runs 模板、禁令）

- [x] **Step 1:** 按批准范围写 brief：跑序固定为 **P0-3 → P0-1 → P0-A → P0-4 → P0-5 → P0-2**（与 2026-11-13 方案 B 一致）
- [x] **Step 2:** 嵌入每条用例的「断言关键词」（如 `source_ambiguity_gate`、`answer_verifiability`、`next_step`）
- [x] **Step 3:** 规定跑次文件名与 INDEX 更新**禁止**由 Claude 直接提交（只交草稿建议）

**验收：** brief 已落 `inbox/20261114-p0-macmini-uat-claude-brief.md`。

---

### Task 3: Claude Code — Wave A 全真执行

**Files:**
- Create/Update: `docs/qa/uat/suites/*/runs/2026-11-14-claude-macmini-p0-qa.md`（或按套件拆分）
- Optional: `inbox/uat-p0-macmini-2026-11-14/evidence.json`

**Consumes:** Task 2 brief；桌面 Bearer 文件；healthy demo

- [x] **Step 1:** 打印 health `gitSha`／连接列表；MCP initialize；失败则整波 `BLOCKED` 停表
- [x] **Step 2:** 按跑序执行 Wave A 必做用例；每条记录：请求摘要（无 secret）、响应关键字段、判定
- [x] **Step 3:** 执行已批准的 A-opt；未批准则跳过并在跑次写「未纳入本波」
- [x] **Step 4:** 任一条必做 FAIL → 停表，写复现步骤，**不**改代码；上报 Cursor／委托人（本波无 FAIL）
- [x] **Step 5:** 交回跑次路径列表 + 一页汇总表（Suite／用例／结果）

**验收：** 2026-11-14 Claude 已交六 runs＋evidence；Cursor 抽查 SAG／AV／EMPTY 通过。

---

### Task 4: Cursor 验收 Wave A

**Files:**
- Modify: `docs/qa/uat/INDEX.md`（六行「最近跑次／结果」）
- Modify: `docs/governance/e2e-ledger.md`（GAP-UAT-P0 备注指向新跑次）
- Optional mirror: 总账 Spec 列测试台链接若过期则只改指针

- [x] **Step 1:** 抽查至少 2 条 MCP 响应摘录是否支持判定（优先 SAG-01、AV-01、EMPTY-01）
- [x] **Step 2:** 必做全绿 → INDEX 更新为新跑次；任一 FAIL → INDEX 写 FAIL／保留旧 PASS 并开缺陷行（须入总账，本 Plan 不自动开发）
- [x] **Step 3:** `npm run lint:e2e-ledger`
- [x] **Step 4:** 向委托人交「Wave A 验收结论」一页（可跑／GAP／阻断）

**验收：** INDEX／e2e-ledger 已指 2026-11-14；`lint:e2e-ledger` PASSED。

---

### Task 5: Wave B（仅当 Task 1 批准）— 夹具 + 可选去 GAP

**Files:**
- Create (runtime, not git secrets): demo contentRoot 下 `caliber-bindings/` 与 `.ktx-ui/field-exposure/` 测试夹具（路径以各 `fixtures.md` 为准）
- Runs: 同套件新跑次或同文件追加 CALIBER-02／EXPOSURE-02

**约束:**
- 夹具仅用于本机 UAT；不得提交真实客户数据；yaml 可进 `examples/` 或 inbox 草稿后再拷进 volume——**具体落点在 brief 写死**
- 夹具写入后需执行层可见（必要时按现网 reload／publish 约定；禁止 `docker restart` 伪装修复——见 CONVENTIONS）

- [ ] **Step 1:** Cursor 写夹具内容与拷贝命令进 brief 附录
- [ ] **Step 2:** Claude 落夹具 → 跑 CALIBER-02／EXPOSURE-02
- [ ] **Step 3:** Cursor 验收；若过则 INDEX 从 PASS WITH GAP 升为更紧结果（或保持 GAP 但关掉「缺夹具 BLOCKED」）

**验收：** 可选用例不再因「缺夹具」BLOCKED，或书面登记委托人推迟。

---

### Task 6: 收口叙事（文档 only）

- [x] **Step 1:** 跑次与 INDEX 回链本 Plan（INDEX 题注＋一键入口；`e2e-ledger` §5；总账变更 v0.70）
- [x] **Step 2:** 若发现产品缺陷：只在总账／inbox 开「待事故修复授权」条目，**本 Plan 不授权改 `webui/server`** → 本波必做 **0 FAIL**；无新事故修复行。已知缺口仍归测试台：SAG-02 BLOCKED、Wave B 推迟（CALIBER-02／EXPOSURE-02）
- [x] **Step 3:** 明确声明：本波完成 ≠ 可上线 ≠ P0-6／7／B 已推进；**未改** Spec 头部合同句（开发台）；UAT 判定只在 INDEX（测试台）

---

## 4. Claude Code 启动口令（审批后由 Cursor 填入 brief）

```text
你在本机 Mac mini 执行 P0 问数 UAT（Wave A）。
只读执行包：inbox/20261114-p0-macmini-uat-claude-brief.md
环境：WebUI :55176，MCP :57881，Bearer 仅从桌面 lucy token 文件读入进程。
全真跑；写 runs；禁止改 Spec 合同状态；禁止把 token 写入任何文件。
必做 FAIL 则停表上报。完成后只返回跑次路径与汇总表。
```

---

## 5. 成功标准（委托人验收清单）

| # | 标准 |
|---|---|
| 1 | Wave A 六套件必做均有 2026-11-14（或当日）Claude 跑次证据 |
| 2 | INDEX 六行指向新跑次；结果与跑次一致 |
| 3 | P0-6／7／B 未出现虚假 UAT PASS |
| 4 | 无 secret 进库 |
| 5 | Wave B：按审批结果「已跑去 GAP」或「明确推迟」二者之一 |

---

## 6. 风险与停表条件

| 条件 | 动作 |
|---|---|
| demo unhealthy／MCP 401 且 token 文件不可用 | 整波 BLOCKED；Cursor 修环境后再派 Claude |
| 本机镜像 `gitSha` 与仓库 HEAD 差很远 | 跑次必须记录实际 `gitSha`；验收结论注明「验的是容器内版本」；是否先 `demo:upgrade` 由委托人另定 |
| 必做 FAIL | 停表；不授权本 Plan 内改代码 |
| 可选缺 attestation／夹具 | BLOCKED／SKIPPED；不降级为 PASS |

---

## 7. 委托人审批（已闭合 2026-11-14）

- [x] **批准 Wave A**（六套件必做 + A-opt：**AV-02／EMPTY-02／CATSEM-02**）
- [x] **Wave B 夹具**：**推迟**
- [x] **SAG-02**：**允许 BLOCKED**
- [x] **容器版本**：**以当前 demo 原样跑**（不 upgrade）
- [x] **执行启动**：Cursor 已写 brief `inbox/20261114-p0-macmini-uat-claude-brief.md` 并驱动 Claude Code
