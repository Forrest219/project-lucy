# Run — 2026-11-15 — cursor-p1-12-budget-retest — UAT-SUITE-QUESTION-BUDGET

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-QUESTION-BUDGET` |
| 总账 | P1-12／REQ-030-033 |
| Agent | Cursor（全真复测） |
| 对照 | 同日首跑 [2026-11-15-cursor-p1-12-budget](2026-11-15-cursor-p1-12-budget.md)（BUDGET-01 FAIL；BUDGET-03 BLOCKED） |
| Plan／Brief | [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../../../../../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)；[`inbox/20261115-p1-12-question-budget-claude-brief.md`](../../../../../inbox/20261115-p1-12-question-budget-claude-brief.md) |
| 环境 | WebUI `:55176`；MCP `:57881`；`gitSha=d64414d6…`；`gitDirty=true`；health `dataQaInstructions.source=project`（length=4201） |
| 凭据 | 问数 Bearer `/Users/forrest/Desktop/lucy token.txt`（sha12 `8e0ae3055cef`）；明文未写入 |
| 证据 | [`inbox/uat-p1-12-14-retest-2026-11-15/p1-12/`](../../../../../inbox/uat-p1-12-14-retest-2026-11-15/p1-12/) |
| 总判定 | **FAIL**（必做 **BUDGET-01 FAIL**；R0／BUDGET-02／BUDGET-03 **PASS**）。≠ 可上线 |

## 方法备注

- 首跑用 `lucy_query` 连续命中 `source_ambiguity_gate`（门闩在预算 `consume` 之前返回），**不计**次数 → BUDGET-03 假阴性。  
- 复测按 fixtures 备选：同窗 `lucy_begin_question` 后连续 `lucy_read_source`（`connectionId=demo-mysql`，`sourceName=superstore_orders`）。`lucy_read_source` **不经**表级歧义门闩（SC-21 O2），可真实结算。  
- 未改 `QUESTION_BUDGET_MAX_*` 常量。

## 结果

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health ok；MCP initialize 200；记 `gitSha`／token sha12 |
| UAT-BUDGET-01 | **FAIL** | initialize `instructions` 长度 7747，**无**「60」／「300」现行默认指导句；亦未见裸写 20／120 为默认阈值（仅有「120 seconds」交付时限句）。容器内 `data-qa-instructions.md` 第 56 行确有「60 次／300 秒」，但有可见 catalog 时走 `buildRoleAwareInstructions` 硬编码英文路径，**未并入**该 md 阈值句 |
| UAT-BUDGET-02 | **PASS** | 新 begin 后第 1…21 次 `lucy_read_source` 均为业务成功，**无** `question_budget_exhausted` |
| UAT-BUDGET-03 | **PASS** | 同窗第 1…60 次成功；第 **61** 次返回 `question_budget_exhausted`（`partial=true`，`continuable=false`）。窗：`2026-11-15T15:13:05.123Z`–`15:13:07.505Z`；session `f73db971-9d25-4908-97c9-0f1efe7c4e2a`；agent／user 见审计导出（供 P1-14） |

## 复跑／产品缺口

- BUDGET-01：须让 role-aware initialize instructions（或等价注入）稳定含 **60／300**，与 `data-qa-instructions.md` 对齐；不得仅靠 fallback 空 catalog 路径。  
- 运行时阈值行为（02／03）本波已全真证实。  
