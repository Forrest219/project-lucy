# P1-54 → S5（严口径：无 new-deny）多 Agent 编排

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-54 → S5 严口径无 new-deny 多 Agent 编排 |
| 文档类型 | Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | P1-54／P1-53 Spec／Plan；Wave D candidate FAIL（[跑次](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-wave-d-candidate.md)；`inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json`）；委托人裁定 **严口径＝S5 必须无 new-deny** |
| 适用范围 | 开发台 P1-54 功能合同收口编排；连带修复判定归因与复跑环境；≠ 可上线；≠ 出包；≠ push |
| 输出位置 | `docs/plans/lucy-20261122-p154-s5-strict-no-new-deny-multi-agent-plan.md` |
| 状态 | 阶段:执行完成｜v0.1。**P1-54 → S5（2026-11-22）**：委托人选项 2；ENV Token＋fixture；T-RUN 严口径 PASS；T-CLOSE SC／CR PASS；R-2 镜像落盘。INDEX 仍 NOT RUN。证据 [复跑](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md)／[收口记录](../reviews/2026-11-22-p1-54-s5-closure-record.md)。≠ UAT PASS；≠ 可上线 |
| 授权边界 | **本文件＝编排授权草案，≠ 自动改运行代码。** 执行前须委托人明示「按本 Plan 执行」。P1-53／54 已有「开工，落地执行」覆盖白名单内脚本；Docker 重建／出包／commit／push 另授 |
| 验收 | P1-54→**S5**（严口径）；复跑证据 **零** `new deny`／**零** `expected denial becoming allow`；expected-allow 案最终 `observedOutcome=allow`（禁止仅靠预算改类洗绿）；SC 审计＋实现 CR PASS；总账同句；共享 INDEX 可不升 PASS；≠ 可上线 |

> **For agentic workers:** 按 §4 勾选执行；总账／INDEX／e2e 终态句 **只允许 R 写入**。先读 §1–§3，再动文件。REQUIRED SUB-SKILL（执行期）：`superpowers:subagent-driven-development` 或按本 Plan 角色派发。

**Goal:** 在严口径下把 P1-54 推到 **S5**：全真复跑功能理由中 **无 new-deny、无 deny→allow 翻转**，且 expected-allow 真成交；再关 SC／CR／镜像。

**Architecture:** 诊断分流（判定归因 ∥ 环境／预算 ∥ 合同残差）→ 串行复跑闸 → SC／CR → R 收口。P1-53 仅修消费／判定／跑参，不改放行产品语义；题库改写仅限证伪后的最小残差。

**Tech Stack:** `scripts/e2e/lib/mcp-compatibility*.mjs`、`mcp-upgrade-journeys.yaml`、CompatConfigProfile、`run-mcp-compatibility.mjs`、node:test、demo Docker、kimi（或已登记 Agent）。

## Global Constraints

- **严口径硬门禁（S5 前置，缺一不可）**
  1. 复跑 candidate／报告 `reasons` 中 **零** 子串 `new deny`；
  2. **零** 子串 `expected denial becoming allow`；
  3. 凡 identity `expect.outcome=allow` 的案，裁决后 `observedOutcome=allow`（**禁止**把预算停机改类成非 new-deny 后仍 deny 却宣称过门）；
  4. `requiredConfigFingerprint` 匹配；缺配置＝BLOCKED 不删题。
- **洗绿禁止**：`question_budget_exhausted`／`tool_is_error` 仅可正确归因；不得为消 `new deny` 字符串而放宽 oracle／删题／改 expect 凑绿。
- **S5 ≠ INDEX PASS ≠ 可上线**。本批默认 **不** 要求 `agentLatency` PASS、**不** 要求 INDEX 升 PASS（另开 P1-53 轨）。若复跑仍仅有 `budget_*` 归因且 allow 未成交 → **NO-GO S5**。
- P1-53 阶段码保持发布取证（`X_REL`）；本批 **不对** P1-53 宣称发布取证收口。
- 总账／REQ／INDEX／e2e／README 终态 **禁止** 各 Track 直接写；只交 `inbox/` 草稿，由 **R-2** 落盘。
- 不改 KTX；不改客户生产 Role；不打开产品默认 proven；不实现 P1-49 heal。

---

## 1. 锁定决策

| # | 决策 | 来源 |
|---|---|---|
| D1 | 严口径：S5 必须无 `new deny`，且无 `expected denial becoming allow`，且 expected-allow 真 allow | 委托人 2026-11-22 |
| D2 | Wave D 基线证据＝`inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json`（15 条功能漂移理由；多案 `question_budget_exhausted`／`tool_is_error`） | 取证 |
| D3 | 编排＝诊断三轨并行 → **单复跑闸** → 收口轨 | 本 Plan |
| D4 | 复跑默认 `--agent-concurrency 3`（或 4）；禁止再用 8 路争用作为 S5 举证 | Wave D 笔记 |
| D5 | **降级出口**：若产品缺陷（如 P1-72 致 03b 永久 allow）在授权白名单外无法修 → 开总账缺口行＋**NO-GO S5**（不得 scoped 洗绿）；委托人可另批产品修复授权或放宽口径 |
| D6 | INDEX／GAP-UAT-P1-54 关闭 **不** 绑本批 S5；R 仅可写「S5；共享测试台仍 NOT RUN／或附复跑 FAIL 轴」 |

### 1.1 Wave D 功能漂移分母（开工锁死）

| 簇 | 案／身份 | 表面理由 | 初判归属 |
|---|---|---|---|
| N1 allow→new deny | BIZ-01..03、FOLLOW-01..03、JOIN-01、ACL-01、ACL-02b × `allow_readonly` | `new deny`；attempt 常见 `question_budget_exhausted`／`tool_is_error` | **T-JUDGE** 归因是否漏标；**T-ENV** 预算／Token／并发 |
| N2 allow→new deny | OPS-10／11 × `allow_ops_w1w2` | 同上 | **T-ENV** W1／W2 夹具＋Token；次 **T-BANK** |
| N3 deny→allow | ACL-03b-gate × `row_scoped_unproven` | `expected denial becoming allow` | **T-BANK** 合同 vs **T-PROD**（产品／P1-72；默认 NO-GO 或另授） |

---

## 2. 非目标

- 宣称可上线／出包／push／客户实例变更
- P1-53 三维全 PASS、INDEX PASS、发布取证收口
- 为消 new-deny 删除／合并题库分母题
- CompatConfigProfile 产品化或改正式 `lucy_ops_reader` 作永久负例
- 全仓 Spec 阶段 MIG
- 修无关 WebUI／审计导出／KTX

---

## 3. 路径与授权白名单

### 3.1 各 Track 允许改动

| Track | 角色 | 允许 | 禁止 |
|---|---|---|---|
| **T-JUDGE** | A | `scripts/e2e/lib/mcp-compatibility-client.mjs`、`mcp-compatibility.mjs`、相关 `__tests__`（预算／deny 归因、case status 与 reasons 一致性） | 改 journeys 题面 expect；改产品 ACL；写总账 |
| **T-ENV** | B | 跑参／Runbook 笔记、`mcp-compat-clients.yaml` 候选、token env 注入、profile apply 调用链旁路修复、demo 平滑升级（**仅当委托人另授 Docker**）；复跑脚本参数 | 删题；放宽 120s 线洗 agentLatency；写 S5 |
| **T-BANK** | C | `mcp-upgrade-journeys.yaml`、`mcp-compat-config-profile.yaml`、`mcp-upgrade-question-bank.mjs`、题库契约测；**仅**在 N3／夹具证伪后最小改 | 改 P1-53 放行阈值；改 `webui/server` 行权限产品行为 |
| **T-PROD** | D（按需） | **默认不派发**。仅当 M 确认 N3＝产品缺陷且委托人另授：最小产品修复＋测 | 无另授则只出 NO-GO 说明 |
| **T-RUN** | E | 执行复跑；写 `docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-*-p154-s5-rerun.md`；结果 JSON → `inbox/p154-s5-strict-*/` | 擅自改 INDEX；宣称 UAT PASS |
| **T-CLOSE** | F | SC 审计、实现 CR、Spec／Plan **草稿** S4／S5 句、`docs/reviews/*p1-54*` | 总账终态；在硬门禁未过时写 S5 |
| **R** | 收口闸 | 总账、REQ、`docs/README.md`、`docs/plans/README.md`、e2e-ledger、INDEX（仅如实）、suite 头、P1-54 Spec／Plan 终态 | 扩 scope；硬门禁失败仍写 S5 |

### 3.2 并行锁

- `mcp-compatibility.mjs`／`mcp-compatibility-client.mjs`：**T-JUDGE 独占**；T-ENV 不改判定内核。
- `mcp-upgrade-journeys.yaml`：**T-BANK 独占**。
- 复跑：**仅 T-RUN**；须等 T-JUDGE／T-ENV／T-BANK（及可选 T-PROD）合并笔记 `inbox/.../01-merge-ready.md`。
- 总账终态：**仅 R-2**。

---

## 4. 任务与角色

角色：**M** 编排 · **A** T-JUDGE · **B** T-ENV · **C** T-BANK · **D** T-PROD（可选）· **E** T-RUN · **F** T-CLOSE · **R** 收口闸。

```
M-00
 ├─ T-JUDGE (A) ─┐
 ├─ T-ENV   (B) ─┼─► M-01 merge ─► T-RUN (E) ─► R-1 GO/NO-GO
 ├─ T-BANK  (C) ─┘         │                      │
 └─ T-PROD  (D,可选) ──────┘                      ├─► T-CLOSE (F) ─► R-2 镜像
                                                  └─ NO-GO：停 S5
```

### M-00：开工锁（M）

- [ ] **Step 1:** 建 `inbox/p154-s5-strict-20261122/`（lock、各 Track 笔记、merge、rerun、NO-GO）
- [ ] **Step 2:** 写 `00-lock.md`：粘贴 D1–D6、§1.1 分母表、白名单、并行锁
- [ ] **Step 3:** 确认委托人已说「按本 Plan 执行」；否则 **停止**
- [ ] **Step 4:** 记录 `git rev-parse HEAD`；派发 A／B／C（D 默认挂起）

**验证:** `00-lock.md` 含「禁止洗绿」与 D5 NO-GO 句。

---

### T-JUDGE-1：new-deny 归因审计（A）

**Files:** 只读 Wave D JSON；可改 `scripts/e2e/lib/mcp-compatibility-client.mjs`、`mcp-compatibility.mjs`、`scripts/e2e/__tests__/mcp-compat-budget-escape.test.mjs`、必要时 `mcp-compatibility.test.mjs`。

- [ ] **Step 1:** 对 §1.1 N1／N2 每案提取 `attempts[]`、`observedOutcome`、`observedDenyClass`、case `status`
- [ ] **Step 2:** 核对：若裁决 attempt＝`question_budget_exhausted` 却 reasons＝`new deny` → 记 **BUG-J1**（归因漏标）；补测锁定
- [ ] **Step 3:** 核对：case `status=PASS` 但功能 reasons 含该案 → 记 **BUG-J2**（案级 status 与轴理由不一致）；修到一致
- [ ] **Step 4:** 确认 `tool_is_error`／begin_not_available 不误判 ACL deny（沿用既有 begin 过滤）
- [ ] **Step 5:** `node --test` 相关文件全绿；写 `inbox/.../t-judge.md`（BUG 列表＋是否已修）

**验证:** 单测证明「预算停机 ≠ new deny」；**不**声称现场已无 new-deny。

---

### T-ENV-1：Token／预算／并发稳态（B）

**Files:** `scripts/e2e/run-mcp-compatibility.mjs`（仅跑参默认／文档注释）、`scripts/e2e/contracts/mcp-compat-clients.yaml`、inbox Runbook 笔记；**不**改判定内核。

- [ ] **Step 1:** 复盘 Wave D：`COMPAT_TOKEN_READONLY`／W1W2 Token、profile fingerprint、`--agent-concurrency 8`
- [ ] **Step 2:** 给出 S5 复跑配方：concurrency≤4、必要 env、是否需 `demo:upgrade`（升级须另授）
- [ ] **Step 3:** 对 N1 抽样 1 题（建议 QB-BIZ-01）做 **串行** 控制面冒烟：期望 `lucy_query` ok＝true；失败则分类（Token／ACL／预算／代理）
- [ ] **Step 4:** 写 `inbox/.../t-env.md`：配方＋冒烟证据路径；列出仍阻塞 allow 的环境项

**验证:** 至少一题 expected-allow 在控制面冒烟成交；否则 merge 不得标 ready。

---

### T-BANK-1：合同残差（C）

**Files:** `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`、`mcp-compat-config-profile.yaml`、题库测；Spec O1。

- [ ] **Step 1:** N3（ACL-03b-gate）：对照 Spec「断言 `row_policy_upstream_unproven`」与现场 allow；判定 **合同仍正确** vs **题写错** vs **夹具未施加**
- [ ] **Step 2:** 若夹具未施加／identity 绑错 → 最小修正 profile／journeys＋契约测
- [ ] **Step 3:** 若合同正确且产品 allow → 写 `t-bank-n3-product.md`，请求 M 激活 **T-PROD** 或 D5 NO-GO；**禁止**把 expect 改成 allow 洗绿
- [ ] **Step 4:** N2（OPS-10／11）：核对 W1／W2 fixtureRoles 工具集与 O1 双连接名单；**冻结 O1** 写入 Spec 开放项或 profile 注释
- [ ] **Step 5:** JOIN-01：仅当 T-ENV 冒烟证明非预算／Token 问题时，才允许最小题面／mcpControls 修正；写明 diff 理由
- [ ] **Step 6:** `node --test scripts/e2e/__tests__/mcp-upgrade-*.mjs scripts/e2e/__tests__/mcp-compat-config-profile.test.mjs` 全绿

**验证:** O1 冻结记录存在；N3 要么夹具修复可测，要么显式升级 T-PROD／NO-GO。

---

### T-PROD-1：产品最小修复（D，可选）

**仅当** M 写入 `inbox/.../activate-t-prod.md` 且委托人另授。

- [ ] **Step 1:** 复现 03b-gate 应 deny 却 allow 的最小路径
- [ ] **Step 2:** 最小修复（授权范围内）＋回归测
- [ ] **Step 3:** 写 CR 笔记；交 T-RUN

**验证:** 控制面可见 `row_policy_upstream_unproven`（或 Spec 等价码）；否则 NO-GO。

---

### M-01：合并闸（M）

- [ ] **Step 1:** 收齐 `t-judge.md`／`t-env.md`／`t-bank.md`（＋可选 t-prod）
- [ ] **Step 2:** 检查洗绿：无删题、无把 03b expect 改为 allow、无放宽分母
- [ ] **Step 3:** 写 `01-merge-ready.md`＝GO 或列出阻塞；GO 时派发 T-RUN

**验证:** GO 文件显式勾选 D1 三条硬门禁。

---

### T-RUN-1：严口径复跑（E）

**Files:** 新建跑次 md；JSON 落 `inbox/p154-s5-strict-20261122/rerun/`。

- [ ] **Step 1:** 按 t-env 配方跑全题库（34 QB）；concurrency≤4
- [ ] **Step 2:** 机器门禁：
  ```bash
  # reasons 与全文均不得出现：
  rg -n "new deny|expected denial becoming allow" inbox/p154-s5-strict-20261122/rerun/*.json
  # 期望：无匹配
  ```
- [ ] **Step 3:** 脚本或 jq：所有 `expect.outcome=allow` → `observedOutcome=allow`
- [ ] **Step 4:** 写跑次报告（元数据表齐全）；**不**改 INDEX
- [ ] **Step 5:** 若硬门禁失败 → `rerun-FAIL.md` 回 M；最多 **一轮** 回跳 T-JUDGE／T-ENV／T-BANK（防死循环）

**验证:** Step 2／3 通过才可交 R-1。

---

### R-1：GO／NO-GO（R）

- [ ] **Step 1:** 核对 T-RUN 硬门禁证据
- [ ] **Step 2:** GO → 派发 T-CLOSE；NO-GO → 写缺口，**禁止** S5

**验证:** `r1-go.md` 或 `r1-no-go.md` 二选一。

---

### T-CLOSE-1：SC 审计＋CR＋草稿（F）

**Files:** `docs/reviews/2026-11-22-p1-54-sc-evidence-audit.md`、`docs/reviews/2026-11-22-p1-54-implementation-cr.md`；Spec／Plan **草稿** 到 inbox。

- [x] **Step 1:** 阶段草稿 **S4**（实现已落地／待验收）——仅 inbox，待 R 可提前落或与 S5 同批
- [x] **Step 2:** SC-01–SC-24 逐条挂：契约测／YAML／fingerprint／**本批复跑**（严口径相关 SC-04／06／08／15／22／23）
- [x] **Step 3:** 实现 CR（题库＋profile＋与本批相关的判定修复）；须 PASS
- [x] **Step 4:** 写 S5 状态草稿（含收口日、复跑指针、`≠ UAT PASS`、`≠ 可上线`；**不得**含「实现进行中」）
- [x] **Step 5:** 交 R-2

**验证:** 审计无「未关闭 SC」；CR＝PASS；草稿无未收口短语。✓

---

### R-2：镜像落盘（R）

- [x] **Step 1:** 确认 R-1＝GO 且 T-CLOSE 齐套
- [x] **Step 2:** 一次写入：P1-54 Spec／Plan 阶段 **S5**＋收口句；总账／REQ-030-075；`docs/README.md`／`docs/plans/README.md`；e2e-ledger P1-54 行；suite／INDEX **如实**（默认仍 NOT RUN，附复跑指针）
- [x] **Step 3:** `npm run lint:status-funnel`（及既有 close-layer／e2e-ledger 若适用）
- [x] **Step 4:** 写 `docs/reviews/2026-11-22-p1-54-s5-closure-record.md`

**验证:** 开发台＝S5；硬门禁证据链完整；未宣称可上线；未把复跑冒充 INDEX PASS。✓

---

## 5. 成功／失败形态

| 形态 | 条件 |
|---|---|
| **完整成功** | 硬门禁过；SC＋CR；P1-54＝S5；INDEX 可仍 NOT RUN；≠ 可上线 |
| **判定修复成功但环境未过** | T-JUDGE 绿；T-RUN 仍有真 deny／预算 → NO-GO S5 |
| **N3 产品阻塞** | D5：缺口行＋NO-GO；保持 S3／S4 |
| **失败** | R-1 NO-GO 或洗绿被拒 |

---

## 6. 风险

| 风险 | 处理 |
|---|---|
| 只消 `new deny` 文案、allow 仍失败 | D1.3；R-1 拒 |
| 8 路争用再引入预算假 deny | D4；T-RUN 限流 |
| 03b 与 P1-72 冲突 | T-PROD 另授或 D5 NO-GO；禁改 expect |
| case PASS／轴 FAIL 不一致 | BUG-J2 必修 |
| 范围漂到 INDEX PASS | D6；非目标 |

---

## 7. 派发一句话（复制用）

| Agent | Prompt 摘要 |
|---|---|
| A | 执行 Plan T-JUDGE-1：审计 Wave D new-deny 归因；修判定一致性；单测绿；写 `t-judge.md` |
| B | 执行 T-ENV-1：复跑配方＋QB-BIZ-01 串行冒烟成交；写 `t-env.md` |
| C | 执行 T-BANK-1：N3／N2／O1；禁洗绿；契约测绿；写 `t-bank.md` |
| E | 仅 merge GO 后：T-RUN-1 全库复跑；零 new-deny／零翻转／allow 真 allow |
| F | 仅 R-1 GO 后：SC 审计＋CR＋S5 草稿 |
| R | R-1 闸 →（GO）等 F → R-2 镜像 |

---

**本 Plan 已执行完成（2026-11-22）。** P1-54＝S5；共享 INDEX 仍 NOT RUN；≠ UAT PASS；≠ 可上线。
