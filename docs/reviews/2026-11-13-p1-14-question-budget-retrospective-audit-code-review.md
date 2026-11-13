# P1-14 问询预算复盘审计字段 · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec／过程对抗） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（W1 Task W1-3） |
| 与 Claude 记录关系 | Spec 过程对抗见 [Claude 评审](2026-11-13-question-budget-retrospective-audit-claude-review.md)；**本文件仅评实现** |
| 实现主体 | 本分支（委托人 R4，2026-11-13） |
| 实现 commit | `a69adebd`（`budgetSnapshot` 写入 + `calls.csv` 扁平列 + v2 metadata 排除） |
| 对象 | Spec **v1.0**；SC-R1–R12 |
| 复测 | `cd webui && npx vitest run server/__tests__/question-budget-retrospective-snapshot.test.ts server/__tests__/question-budget-retrospective-csv.test.ts --reporter=dot` → **11 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— `args_summary.budgetSnapshot` 在 `budget_stop` 与 `continuation_rollover` 两类行写入；`calls.csv` 表尾扁平列与 v1 字段说明一致；v2 export-metadata **不含**新列；MCP 预算终止响应体未加快照。本轮复测 **11/11**。**本 CR 不表示可上线**／不做发布取证。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| SC-R1–R3／R3b | `classifyExhaustion` + `buildBudgetSnapshot`；calls／busy／both／wall |
| SC-R4／R5／R6／R11 | `question-budget-retrospective-csv.test.ts`：plain 行空列、metadata v1⊃／v2⊖、表头机械一致 |
| SC-R9 | 快照构造无 scopeKey／token 字段（单测负向 + 类型合同） |
| SC-R10／R12 | `continuation_rollover` 保留换窗前 `calls`／`archivedBusyMsByWindow`；sync consume 夹具 |
| SC-R7 | 未改 `Audit.tsx`（交付面 A） |
| SC-R8 | `mcp-proxy` 响应体路径未向客户端暴露 `budgetSnapshot`（写入仅 `argsSummary`） |

## Findings

### F-R1 [nit] SC-R8 未单列 HTTP 响应 JSON 快照断言

写入与响应体分离已由实现结构与 Spec R8 约束覆盖；未挡 PASS。

### F-R2 [nit] SC-R7 依赖静态「无 diff」而非专用测试

与 Spec 证据等级一致；不挡 PASS。

## 对 Spec SC 的裁定

| 范围 | 裁定 |
|---|---|
| SC-R1–R6／R9–R12 | **接受**（本轮复测夹具） |
| SC-R7／R8 | **接受**（实现约束 + 代码审阅；无回归信号） |

## 下一步

1. W1 后续按 [landed 收口 Plan](../plans/lucy-20261113-landed-middev-closure-batch-plan.md) 继续。  
2. **不得**宣称可上线。
