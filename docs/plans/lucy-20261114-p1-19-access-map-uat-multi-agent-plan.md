# P1-19 访问关系图 UAT 复跑（多 Agent）Plan

> **For agentic workers:** 委托人已选定主线 A。按 Task 勾选推进；全真优先；禁止 vitest／CR 冒充 PASS。

**Goal:** 在本机 Mac mini demo 上复跑 `UAT-SUITE-ACCESS-MAP`，验证 P1-19（`ok`／`allow` 词表）已关闭 F-1；把 P1-19 从测试台 `not_registered` 挂上套件与跑次；更新 INDEX／e2e-ledger／总账留痕。

**Architecture:** Cursor 编排＋验收；Claude Code 全真执行（浏览器 WebUI＋API＋MCP）。必做 01–03 先于可选 04（04 会写入 audit，可能抬高 `accessPaths`）。套件同时服务 **P1-17**（空桑基）与 **P1-19**（词表／04）。

**Tech Stack:** demo Docker WebUI `:55176`；MCP `:57881`；凭据只读路径；`docs/qa/uat/` 唯一测试台 SOT。

## Global Constraints

- **环境**：当前 demo **原样**（与 P0 Wave A 一致，不强制 upgrade）；跑次必须记录实际 `gitSha`
- **范围**：只 UAT／台账；**禁止**改 `webui/server`（除非另获事故修复授权）
- **全真**：真实登录／API／MCP；禁 CR 冒充
- **凭据**：WebUI `/Users/forrest/Desktop/lucywebui logi.txt`（fallback Projects 路径）；MCP `/Users/forrest/Desktop/lucy token.txt`；禁写入 runs
- **合同**：不改 Spec「功能合同已收口」类句为「可上线」；可更新 Spec 状态中「UAT 未复跑」→ 指向跑次
- **≠ 可上线**

## 多 Agent 分工

| Agent | 角色 | Task |
|---|---|---|
| **Cursor（编排）** | 写 Plan／brief；挂套件 P1-19；验收 INDEX／e2e-ledger／总账／Spec 镜像 | T0、T1、T3 |
| **Claude Code（执行）** | 本机全真跑 R0→01→02→03→**04**；写 runs；交汇总 | T2 |
| **（可选）对抗 Agent** | 仅当 T2 必做全绿且委托人另批时，加宽矩阵；本波默认不做 | — |

```text
T0 Plan+brief ──► T1 套件挂 P1-19 ──┐
                                    ├──► T2 Claude 全真跑 ──► T3 Cursor 验收台账
（T1 可与 T2 启动前并行完成）
```

---

### Task 0: Cursor — Plan／Brief

**Files:**
- Create: 本 Plan
- Create: `inbox/20261114-p1-19-access-map-uat-claude-brief.md`

- [x] 写清跑序、断言、F-1 对照期望、runs 文件名
- [x] 明确：04 期望 `accessPaths>0` 且 usage 流带；若仍 0／成功进 denied → **FAIL**（P1-19 未在本容器生效或回归）

---

### Task 1: Cursor — 测试台挂 P1-19（文档 prep）

**Files:**
- Modify: `docs/qa/uat/suites/access-map-sankey-empty/suite.md`（总账 ID 列增 P1-19／REQ-030-040）
- Modify: `docs/qa/uat/suites/access-map-sankey-empty/cases.md`（04 注：P1-19 关闭 F-1 后应收口）
- Modify: `docs/qa/uat/README.md` 套件表备注（若需）

- [x] suite／cases 回链 P1-19 Spec
- [x] **不**提前改 INDEX 结果（等 T2 跑次）

---

### Task 2: Claude Code — 全真执行

**Files:**
- Create: `docs/qa/uat/suites/access-map-sankey-empty/runs/2026-11-14-claude-macmini-p119-access-map.md`
- Optional: `inbox/uat-p1-19-access-map-2026-11-14/`（禁 secret）

**跑序（强制）:**

1. **UAT-R0** — compose healthy；health；WebUI 登录  
2. **UAT-ACCESS-MAP-01** — 空态骨干（尽量在 04 前；若窗内已有 accessPaths，记录基线并说明）  
3. **UAT-ACCESS-MAP-02** — 图例  
4. **UAT-ACCESS-MAP-03** — confirmed-only／非法 trust  
5. **UAT-ACCESS-MAP-04** — MCP `lucy_begin_question` → 成功 `lucy_query`（`superstore_orders` 合格 measures）→ 刷新图／API  
   - 对照 F-1：`outcome=ok` 的 confirmed 触表须进 `rawCalls`／`accessPaths`，**不得**仅抬 `deniedCalls`  
6. 写跑次；交汇总表；**不改 INDEX**

**停表:** 必做 01–03 任一 FAIL → 停；04 FAIL → 仍交跑次，标 FAIL＋复现，不改代码。

---

### Task 3: Cursor — 验收与台账

**Files:**
- Modify: `docs/qa/uat/INDEX.md`
- Modify: `docs/governance/e2e-ledger.md`（P1-19 行：`not_registered` → Suite＋跑次；GAP-UAT-P1-17 更新）
- Modify: `docs/specs/lucy-20261113-access-map-outcome-vocabulary-spec.md`（状态：UAT 已复跑指针；**不**写可上线）
- Modify: 总账变更行＋P1-19 Spec 列回链测试台
- Modify: `scripts/uat/check-e2e-ledger.mjs`（若登记 P1-19 新 REQUIRED 行或更新 ACCESS-MAP latestRun）

- [x] 抽查 04 证据是否支持关闭 F-1  
- [x] `npm run lint:e2e-ledger`  
- [x] 向委托人交一页结论  

---

## 成功标准

| # | 标准 |
|---|---|
| 1 | 必做 R0／01／02／03 有当日跑次 |
| 2 | 04 实跑（非 SKIPPED）；PASS 则 F-1 关闭叙述成立；FAIL 则台账诚实记 FAIL |
| 3 | INDEX／e2e-ledger 挂 P1-19；不再 `not_registered` |
| 4 | 无 secret 进库；≠ 可上线 |

## 委托人已批

- 主线 **A**：P1-19／ACCESS-MAP UAT  
- 多 Agent：Cursor 编排＋Claude 执行  
- demo **原样**（与近期 P0 波一致）
