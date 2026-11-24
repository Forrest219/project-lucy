# P1-73＋P1-35 → S5 收口多 Agent 编排

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-73＋P1-35 → S5 收口多 Agent 编排 |
| 文档类型 | Plan |
| 版本 | v0.1 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | 三 Spec 进度核验；委托人选范围 **选项 2**；P1-35 收口 **严口径 1**；P1-73 **1＋2**（Spec 出口＋清已授权缺阶段残余）；编排方案 **B** |
| 适用范围 | 开发台功能合同收口编排；≠ 可上线；≠ 出包；≠ push |
| 输出位置 | `docs/plans/lucy-20261122-p173-p135-s5-closure-multi-agent-plan.md` |
| 状态 | 阶段:S5｜v0.1。**执行完成（2026-11-22）**：P1-73＋P1-35 → S5；P1-53／54 镜像已纠偏。收口记录见 `docs/reviews/2026-11-22-p173-p135-s5-closure-record.md`。本条收口不表示可上线；未 commit／push |
| 授权边界 | **本文件＝编排授权，≠ 自动改运行代码。** 执行前须委托人明示「按本 Plan 执行」。白名单见 §3。git commit／push／Docker 重建／出包另授 |
| 验收 | P1-73→S5；P1-35→S5（严口径）；P1-53／54 仅镜像纠偏；总账同句；≠ 可上线 |

> **For agentic workers:** 按 §4 任务勾选执行；总账终态句**只允许 R 写入**。REQUIRED：先读本 Plan §1–§3，再动文件。

**Goal:** 将 P1-73／P1-35 功能合同推进到 **S5**；同步纠正 P1-53／54 过期「未授权」镜像；不宣称可上线。

**Architecture:** 方案 B——Track73 ∥ Track35 ∥ Track54mirror；收口闸 R 串行写镜像。

**Tech Stack:** 文档／`scripts/lint-spec-docs.mjs`／vitest（webui server）／既有 ESCAPE UAT 证据；不改 KTX。

## 开工前置

委托人明确批准执行本 Plan 后，按 M-00 冻结 D1–D5、§3 授权白名单、并行写入边界和 Git 基线。

## Global Constraints

- S5＝「功能合同已收口」且 SC 证据关闭＋有收口／CR 记录；**UAT PASS ≠ S5**；**S5 ≠ 可上线**。
- 状态行 S5 后不得含未收口短语（`实现进行中`／`≠功能合同收口` 等，见 P1-73 Spec D4）。
- 发布取证 Spec 终态是 `X_REL` 不是 S5——**本批不对 P1-53 标 X_REL／S5**。
- 全仓 MIG（附录 MIG-01…）**剔出**；仅允许 §3.2 最小阶段行补齐。
- 总账／INDEX／e2e／README 终态句 **禁止** T73／T35／T54m 直接写入；只交草稿，由 **R-2** 一次落盘。

---

## 1. 锁定决策

| # | 决策 | 来源 |
|---|---|---|
| D1 | 范围＝P1-73＋P1-35→S5；P1-53／54＝镜像纠偏 only | 委托人选项 2 |
| D2 | P1-35＝新 SC-E 证据审计＋实现 CR（须 PASS；或委托人另批 acceptance 代替） | 委托人严口径 1 |
| D3 | P1-73＝SC-01–SC-15＋实现 CR→S5，**并**清「状态行含授权口令／标记行且缺 `\| 阶段 \|`」残余 | 委托人 1＋2 |
| D4 | 编排＝方案 B（双轨并行＋R 闸） | 委托人确认 B |
| D5 | **降级出口（默认接受）**：若 P1-35 CR 再 FAIL → 本批仍可只完成 P1-73→S5＋53／54 镜像；P1-35 保持未收口并开缺口行。委托人可在执行前否定本条 | 设计推荐默认；执行前可改裁 |

## 2. 非目标

- 可上线／出包／push／客户实例变更
- P1-53 Wave D 翻绿、INDEX PASS、`X_REL` 收口
- P1-54 题库语义大改或 CompatConfigProfile 产品化
- 全仓 Spec `| 阶段 |` MIG
- 无授权改 `webui/src`（P1-35 若 CR 要求改 `webui/server`，须在 T35-2 证据里写明，且不超过 escape Spec 已授权范围）
- 把 Nov-17 FAIL CR 静默当成 PASS

## 3. 路径与授权白名单

### 3.1 各 Track 允许改动

| Track | 允许 | 禁止 |
|---|---|---|
| **T73** | `scripts/lint-spec-docs.mjs`、`scripts/lint-spec-docs.test.mjs`、`docs/governance/test-layers-and-release-gates.md`、P1-73 Spec／Plan／建议书（**草稿状态句**）、§3.2 名单内 Spec／其配对 Plan 的 `| 阶段 |`／Plan 镜像前缀、收口证据 `docs/reviews/2026-11-22-p1-73-*-closure*.md`（新建） | 总账终态；业务运行时；无名单 Spec 散文重写 |
| **T35** | P1-35 Spec／Plan（**草稿**）；`docs/reviews/` 下 SC 证据审计＋实现 CR；为过 CR 所需的最小 `webui/server/**`＋对应 `__tests__`（仅当审计证伪） | 总账终态；改父 P0-3 已收口出口句；kill switch |
| **T54m** | 草稿镜像句（可贴在 `inbox/`）；**不**直接改 INDEX／总账——或改完标 `DRAFT` 交 R | 执行器／题库 YAML 语义；宣称 INDEX PASS |
| **R** | 总账、需求池、`docs/README.md`、`docs/plans/README.md`、`docs/governance/e2e-ledger.md`、`docs/qa/uat/INDEX.md`、suite 头、两 Spec／Plan **终态 S5 句** | 扩 scope；改运行时代码 |

### 3.2 最小阶段行补齐（委托人 1＋2；≠ 全仓 MIG）

开工时用 **状态行单元格**（非全文）重扫 `spec-status-funnel-grandfather.json`：

- 条件：`(状态行含「开发授权已获得」 OR 正文有标记行「状态漏斗门禁：纳入检查」)` AND 头部无 `| 阶段 |`
- 对命中文件：补合法阶段码（按该 Spec 真实进度选 S3／S4／S5／X_*；**不得臆造 S5**）
- 配对 Plan：状态行加 `阶段:<CODE>` 前缀（P1-73 D7／SC-12）
- 预扫（落盘时 statusCell 严格重扫＝**0 命中**）：全文扫描曾误报 2 份。T73-3 以执行日 statusCell 为准；若仍为 0，则本步＝「确认归零＋修测试断言／test-layers 叙述」，**不得**借机扩改无关 Spec

## 4. 任务与角色

角色：**M** 编排 · **A** Track73 · **B** Track35 · **C** Track54mirror · **R** 收口闸。

```
M-00
 ├─ T73-1…3 (A)  ─┐
 ├─ T35-1…2 (B)  ─┼─► R-1 GO/NO-GO ─► R-2 写镜像
 └─ T54m   (C)  ─┘
```

### M-00：开工锁（M）

- [ ] **Step 1:** 建工作目录 `inbox/s5-closure-20261122/`（baseline 笔记、各 Track 草稿、NO-GO 记录）
- [ ] **Step 2:** 写入 `00-lock.md`：D1–D5、白名单、并行锁「总账终态＝R only」
- [ ] **Step 3:** 确认委托人已说「按本 Plan 执行」；若只批了方案未批执行，**停止**
- [ ] **Step 4:** 派发 A／B／C；记录 git SHA 基线（只读 `git rev-parse HEAD`）

**验证:** `inbox/s5-closure-20261122/00-lock.md` 存在且含 D5 降级句。

---

### T73-1：夹具与叙述对齐（A）

**Files:**
- Modify（仅当红）: `scripts/lint-spec-docs.test.mjs`（SC-09／SC-10 生产名单断言）
- Modify: `docs/governance/test-layers-and-release-gates.md`（删除／改写过时「PR CI 因 MIG 为红直至 MIG」若与本机 `lint:status-funnel` 绿矛盾）

- [ ] **Step 1:** 跑 `node --test scripts/lint-spec-docs.test.mjs`；记录红测
- [ ] **Step 2:** 跑 `npm run lint:status-vocab` 与 `npm run lint:status-funnel`（期望 exit 0）
- [ ] **Step 3:** 若生产名单断言仍要求 `hits.length > 0` 但本机零命中：改为「无口令无标记 → 0 失败；有口令缺阶段 → ≥1 失败」的双向断言（保持 SC-09／SC-10 语义）
- [ ] **Step 4:** 对齐 `test-layers` 登记句与本机事实
- [ ] **Step 5:** 产出 `inbox/s5-closure-20261122/t73-1-evidence.md`

**验证:** lint 两规则绿；相关 test 绿（或缺口写入证据等 T73-3 清残余后再绿）。

---

### T73-2：P1-73 实现 CR＋SC-01–15 证据包（A）

**Files:**
- Create: `docs/reviews/2026-11-22-p1-73-status-funnel-implementation-cr.md`
- Create: `docs/reviews/2026-11-22-p1-73-sc-evidence-audit.md`

- [ ] **Step 1:** 按 Spec §6 逐条 SC-01–SC-15 填证据表（夹具名／文件行／CI 接线）
- [ ] **Step 2:** 实现 CR：对照 §8 白名单做路径 diff 审计；结论须 **PASS** 或列阻断
- [ ] **Step 3:** 确认 SC-15：`.github/workflows/lucy-ci.yml` 含 `lint:status-funnel`
- [ ] **Step 4:** 写 P1-73 **S5 状态草稿**（勿写总账）到 `inbox/s5-closure-20261122/t73-s5-draft.txt`

**验证:** CR 文档结论＝PASS；证据表无空行。

---

### T73-3：最小阶段行补齐（A；委托人 1＋2）

- [ ] **Step 1:** statusCell 重扫 grandfather；列出最终 `phase-backfill.txt`
- [ ] **Step 2:** 对每份命中 Spec 补 `| 阶段 | <CODE> |`（CODE 不得无依据抬到 S5）
- [ ] **Step 3:** 配对 Plan 镜像前缀
- [ ] **Step 4:** 再跑 `npm run lint:status-funnel` 与 SC-10 相关 test
- [ ] **Step 5:** 在 P1-73 收口记录声明「本批最小补齐名单＝…；全仓 MIG 仍另授权」

**验证:** 重扫命中＝0；funnel 绿。

---

### T35-1：SC-E 证据审计（B）

**Files:**
- Create: `docs/reviews/2026-11-22-p1-35-sc-e-evidence-audit.md`
- Read: Spec `docs/specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md` §5；UAT `docs/qa/uat/suites/source-ambiguity-mcp-escape/`；Nov-17 CR `docs/reviews/2026-11-17-p1-35-p1-36-p1-37-code-review.md`

- [ ] **Step 1:** 建 SC-E01–E30 证据矩阵（vitest 文件：用例名；UAT：跑次＋case id）
- [ ] **Step 2:** 专节处理 Nov-17 **CR-01／CR-02**：对照现行 Spec §4.1 v0.4 修订句与现行测试；判定「已 Spec 确权覆盖」或「仍阻断」
- [ ] **Step 3:** 核对 INDEX PASS 跑次（含 ESC-11）与 Spec 出口「INDEX＝PASS」一致
- [ ] **Step 4:** 列出仍缺证据的 SC → 不得进入 S5 草稿

**验证:** 审计结论明示每条 SC 的证据指针或 GAP。

---

### T35-2：P1-35 实现 CR（B；严口径）

**Files:**
- Create: `docs/reviews/2026-11-22-p1-35-implementation-cr.md`
- Modify（仅阻断修复）: `webui/server/proxy/source-ambiguity-gate.ts` 等最小面＋`webui/server/__tests__/**`

- [ ] **Step 1:** 相对现网做实现 CR（可复用审计结论）；目标 **PASS**
- [ ] **Step 2:** 若发现阻断：最小修复＋单测锁死；跑相关 vitest
- [ ] **Step 3:** 若无法 PASS：写 NO-GO；触发 **D5 降级**（通知 M／R）；**禁止**写 P1-35 S5 草稿
- [ ] **Step 4:** PASS 时写 `inbox/s5-closure-20261122/t35-s5-draft.txt`（含 `| 阶段 | S5 |` 与收口句；去掉「≠功能合同收口」「实现进行中」）

**验证:** CR＝PASS 或正式降级记录；相关 vitest 绿。

---

### T54m：P1-53／54 镜像纠偏草稿（C）

**事实源（以 Spec／suite 为准，不以过期总账为准）:**

- Spec：开发已授权；实现进行中；测试台 NOT RUN
- suite：Wave D candidate **FAIL**；不得 INDEX PASS
- INDEX／总账／e2e 现仍写「开发未授权」→ **过期**

- [ ] **Step 1:** 起草同句状态（两行 P1-53／P1-54＋INDEX 行＋e2e 行＋GAP 行）到 `inbox/s5-closure-20261122/t54-mirror-draft.md`
- [ ] **Step 2:** 句中必须含：开发已授权；Wave D FAIL（链到 `docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-wave-d-candidate.md`）；INDEX＝**NOT RUN**；≠ 可上线
- [ ] **Step 3:** **禁止**写 S5／X_REL／UAT PASS

**验证:** 草稿无收口／放行动词。

---

### R-1：收口闸（R）

- [ ] **Step 1:** 核对 T73 CR＋SC 证据＝PASS；T73-3 名单归零
- [ ] **Step 2:** 核对 T35：PASS → 可进双 S5；FAIL → 仅 73＋镜像（D5）
- [ ] **Step 3:** 核对 T54m 草稿无越权
- [ ] **Step 4:** 路径白名单抽查（git diff --name-only）
- [ ] **Step 5:** 输出 `inbox/s5-closure-20261122/r1-gate.md`＝**GO** 或 **NO-GO**（列阻断）

**验证:** GO 文件存在且签名范围明确（「双 S5」或「仅 73」）。

---

### R-2：一次写镜像（R；仅 GO 后）

**同句写入（按 GO 范围）:**

1. P1-73 Spec／Plan／建议书 → `阶段:S5`＋「功能合同已收口（2026-11-22，…）」＋≠ 可上线
2. P1-35 Spec／Plan → 补 `| 阶段 | S5 |`＋收口句（若 GO 含 35）
3. 总账表行＋分节跟进；需求池 REQ-030-094／056；`docs/README.md`；`docs/plans/README.md`
4. `e2e-ledger.md`；本 Plan 头部状态→执行完成
5. P1-53／54：总账／INDEX／e2e／suite 采用 T54m 草稿
6. 总账变更行新增一条（勿改写历史行）

- [ ] **Step 1:** 按 GO 范围应用上述写入
- [ ] **Step 2:** 跑 `npm run lint:status-vocab`、`npm run lint:status-funnel`（S5 句不得含未收口短语）
- [ ] **Step 3:** 可选 `node scripts/uat/check-e2e-ledger.mjs`
- [ ] **Step 4:** 写 `docs/reviews/2026-11-22-p173-p135-s5-closure-record.md`（收口记录）
- [ ] **Step 5:** **不** git commit／push，除非委托人另授

**验证:** 开发台头部与总账同句；两规则 lint 绿；收口记录链到 CR／审计。

---

## 5. 浏览器验证

不适用 WebUI 新表面。P1-35 以既有 MCP UAT 证据＋vitest 为准；**本编排不强制重跑 ESCAPE**（除非 T35 CR 改了门闩行为——则须重跑或委托人批「沿用 2026-11-18 post-rebuild」）。

## 6. 完成定义

| 出口 | 条件 |
|---|---|
| **完整成功** | P1-73＝S5；P1-35＝S5；53／54 镜像已纠偏；收口记录齐；≠ 可上线 |
| **降级成功（D5）** | P1-73＝S5；P1-35 未收口＋缺口登记；53／54 镜像已纠偏 |
| **失败** | R-1 NO-GO 且 73 证据亦不足 → 不写任何 S5 |

## 7. 风险

| 风险 | 处理 |
|---|---|
| Nov-17 FAIL CR 被误升格 | T35-1／T35-2 强制对照；无 PASS 不写 S5 |
| 最小补齐被做成全仓 MIG | §3.2 名单制；超名单停问委托人 |
| 并行写总账冲突 | 仅 R-2 写终态 |
| S5 状态行残留「≠功能合同收口」 | funnel D4；R-2 后必跑 lint:status-funnel |
| 把 53／54 Wave D FAIL 写成 PASS | T54m／R 检查表禁止 |
| P1-35 CR 修复触发回归 | 相关 vitest；必要时重跑 ESCAPE（另授 Docker） |

## 8. 执行握手

委托人确认「**按本 Plan 执行**」后，M-00 开工。

执行方式（确认执行时再选）：

1. **Subagent-Driven（推荐）** — 每 Track 独立 agent；R 串行闸  
2. **本会话 Inline** — 同会话按任务推进  

**本 Plan 落盘 ≠ 已执行 ≠ 已 S5。**
