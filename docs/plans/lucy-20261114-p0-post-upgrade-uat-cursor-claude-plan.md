# P0 升级后复跑 UAT（Cursor 用例／Claude 执行／Cursor 验收）Plan

> **For agentic workers:** 委托人 2026-11-14 已批准执行。Cursor 写用例＋brief＋验收；Claude Code 全真跑六套；禁止 CR／vitest 冒充 PASS。

**Goal:** 在 **已完成 `demo:upgrade`** 的本机 demo 上，对 P0 问数六套件复跑全真 UAT，确认绿灯挂在升级后 `gitSha`（≠ 前次 Wave A 的 `3aa402c9`）。

**Architecture:** 复用六套件；新增必做 `UAT-R0-UPGRADE`；Wave B（CALIBER-02／EXPOSURE-02）仍推迟；SAG-02 无 person／attestation 允许 BLOCKED。

**Tech Stack:** WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；Bearer `/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`）。

## 分工

| 角色 | 做 | 不做 |
|---|---|---|
| Cursor | 补 `UAT-R0-UPGRADE`；写本 Plan＋brief；验收后改 INDEX／e2e／lint latestRun | 不伪造跑次 |
| Claude Code | 全真 MCP 执行；写 `runs/2026-11-14-claude-macmini-p0-post-upgrade.md`（每套一件）；可选 `inbox/uat-p0-post-upgrade-2026-11-14/` | 不改 Spec 合同；不改 cases 期望；不写 token |
| 委托人 | 已批准本波；Wave B 仍推迟 | — |

## Wave 范围（已批准）

| Suite | 必做 | A-opt | 不做 |
|---|---|---|---|
| SOURCE-AMBIGUITY | R0／R0-UPGRADE／SAG-01 | SAG-02（缺则 BLOCKED） | — |
| CALIBER-BINDING | R0／R0-UPGRADE／CALIBER-01 | — | CALIBER-02（Wave B） |
| FIELD-EXPOSURE | R0／R0-UPGRADE／EXPOSURE-01 | — | EXPOSURE-02（Wave B） |
| ANSWER-VERIFIABILITY | R0／R0-UPGRADE／AV-01 | AV-02 | — |
| EMPTY-NEXT-STEP | R0／R0-UPGRADE／EMPTY-01 | EMPTY-02 | — |
| CATALOG-SEMANTICS | R0／R0-UPGRADE／CATSEM-01 | CATSEM-02 | — |

## 产物

| 产物 | 路径 | 谁 |
|---|---|---|
| Plan | 本文件 | Cursor |
| Brief | `inbox/20261114-p0-post-upgrade-uat-claude-brief.md` | Cursor |
| 跑次 | `docs/qa/uat/suites/<suite>/runs/2026-11-14-claude-macmini-p0-post-upgrade.md` | Claude |
| INDEX／e2e／check-e2e-ledger latestRun | 验收后 | Cursor |

## Tasks

- [x] T0 委托人批准升级后 P0 六套
- [x] T1 Cursor：`UAT-R0-UPGRADE` 写入六套 `cases.md`＋Plan／brief
- [x] T2 Claude：全真执行并写六跑次（`…-p0-post-upgrade.md`）
- [x] T3 Cursor：验收 → INDEX／e2e／lint；向委托人交结论

**≠ 可上线；≠ 核心升级完成；≠ 改 Spec 功能合同收口句。**
