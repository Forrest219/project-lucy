# P1-27／28／12／14 UAT 本波（Cursor 用例／验收／台账 · Claude Code 全真执行）Plan

| 治理字段 | 内容 |
|---|---|
| 状态 | 执行进度以本文件原Task勾选和已有跑次为准；本次仅补齐文档形态，未复跑本计划业务验收，当前候选结果待验。 |
| 授权边界 | 仅本计划既有Task所列范围，原审批和禁止项见正文；本次文档治理修订不新增运行代码、提交、部署或发布授权。 |

> **For agentic workers:** 委托人 2026-11-15 批准「首选＋次选」：P1-27 复测、P1-28 行级隔离、P1-12／P1-14 预算首跑。全真优先；禁止 vitest／CR 冒充 INDEX PASS；严格按 [`docs/qa/uat/CONVENTIONS.md`](../qa/uat/CONVENTIONS.md) 落盘 `runs/` 并回链 INDEX／e2e-ledger。

**Goal:** 在已追平的本机 demo（health `gitSha=d64414d6…`、`gitDirty=false`，含 P1-27 修复 `ae155f86`）上，完成四条测试台全真跑次与台账登记。

**Architecture:** Cursor 写本 Plan＋四份 brief＋验收台账；Claude Code **按条串行**全真执行并只写 `runs/`（可选 `inbox/` 证据，禁 secret）。不改运行产品代码；不改 Spec 功能合同收口句为可上线。

**Tech Stack:** WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；compose project `compose`；容器 `compose-lucy-1`。

## 分工

| 角色 | 做 | 不做 |
|---|---|---|
| Cursor | Plan／brief；验收 runs；改 INDEX／e2e／总账指针／`check-e2e-ledger`；`npm run lint:e2e-ledger` | 不伪造跑次 |
| Claude Code | 按 brief 全真跑；写 `runs/YYYY-MM-DD-claude-macmini-*.md`；失败诚实 FAIL／BLOCKED | 不改 INDEX／合同句；不写 secret |
| 委托人 | 已批准本波范围 | — |

## Wave 范围（已批准）

| 序 | 清单 | Suite | 必做 | 备注 |
|---|---|---|---|---|
| 1 | P1-27／P1-11 | `UAT-SUITE-OPS-CONCEPTS` | R0／**R0-FIX**／01／02／03 | 关 GAP-UAT-P1-11-RUNTIME；04／05 默认 SKIPPED |
| 2 | P1-28／P1-29 | `UAT-SUITE-ROW-POLICY` | R0／ROW-01…08 | 核心分母；ROW-07 现行预期 FAIL（GAP-VALUE）；遇 `source_ambiguity_gate` 须先完成来源确认 |
| 3 | P1-12 | `UAT-SUITE-QUESTION-BUDGET` | R0／BUDGET-01／02；**推荐 03** | 禁止改预算常量；03 供 P1-14 复用 |
| 4 | P1-14 | `UAT-SUITE-BUDGET-AUDIT` | R0／AUDIT-01…03 | 无 `budget_stop` 则自跑 61 次 |

## 环境钉死

| 键 | 值 |
|---|---|
| 镜像 tip（本波） | `d64414d6`（须 `gitDirty=false`；含修复 `ae155f86`） |
| WebUI／Health／MCP | `:55176`／`/api/health`／`:57881/mcp` |
| WebUI 登录 | `/Users/forrest/Desktop/lucywebui logi.txt`；缺则 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` |
| 问数 Bearer | `/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`） |
| proven 切换 | 仅同一 project `compose`＋fixtures 所列 overlay；禁 `-p lucy-ac-p1-by01` |

## 产物

| 产物 | 路径 | 谁 |
|---|---|---|
| Plan | 本文件 | Cursor |
| Brief×4 | `inbox/20261115-p1-27-ops-retest-claude-brief.md` 等 | Cursor |
| 跑次 P1-27 | `docs/qa/uat/suites/ops-concepts/runs/2026-11-15-claude-macmini-p1-27-ops-retest.md` | Claude |
| 跑次 P1-28 | `docs/qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-claude-macmini-row-policy.md` | Claude |
| 跑次 P1-12 | `docs/qa/uat/suites/question-budget/runs/2026-11-15-claude-macmini-p1-12-budget.md` | Claude |
| 跑次 P1-14 | `docs/qa/uat/suites/budget-audit/runs/2026-11-15-claude-macmini-p1-14-audit.md` | Claude |
| 证据 | `inbox/uat-p1-27-28-12-14-2026-11-15/` | Claude（可选） |
| INDEX／e2e／lint | 每条验收后 | Cursor |

## Tasks

- [x] T0 委托人批准首选＋次选
- [x] T1 Cursor：本 Plan＋四 brief
- [x] T2 P1-27 全真复测 → 跑次（Claude CLI 本波 `unrecognized_model`／挂起；改由 Cursor 按 brief／cases 全真执行）
- [x] T3 Cursor：验收 P1-27 → INDEX／e2e／GAP 已关
- [x] T4 P1-28 全真 → 交跑次（仍 FAIL／BLOCKED；见 retest 跑次）
- [x] T5 Cursor：验收 P1-28 → INDEX／e2e 已指 retest
- [x] T6 P1-12 全真 → 跑次 FAIL（01／03 未过）
- [x] T7 Cursor：验收 P1-12 → INDEX 已挂
- [x] T8 P1-14 全真 → 跑次 FAIL（01 BLOCKED）
- [x] T9 Cursor：验收 P1-14＋台账／lint

**流水线：** 串行。上一条 Cursor 验收完成后再放行下一条（P1-12／14 可在 P1-27／28 验收后连续；P1-14 优先复用同日 BUDGET-03）。

**≠ 可上线；≠ 核心升级完成；≠ 把 ROW-07 现行 FAIL 改期望。**

## 目标（治理补齐）

复测P1-27，验证行级隔离及P1-12/14预算路径，按四条测试台登记。

## 开工前置（治理补齐）

先按环境钉死表核对d64414d6镜像及修复ae155f86，确认来源歧义已有可达确认路径。

## 验收（治理补齐）

按Wave范围逐案核对OPS、ROW、BUDGET、AUDIT；ROW-07现行预期FAIL和缺口单列，不伪造全绿。

## 完成定义（治理补齐）

四份真实跑次经Cursor验收并回链台账，未跑/FAIL/BLOCKED保持原始判定；预算审计复用证据须注明来源。

## 风险（治理补齐）

来源歧义、行域缺口和预算耗尽可能阻塞合法路径；停表记录，不改合同或常量取得PASS。
