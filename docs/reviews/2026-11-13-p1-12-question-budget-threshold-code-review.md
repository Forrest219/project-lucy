# P1-12 问询预算默认阈值放宽 · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（W1 Task W1-2） |
| 实现主体 | 本分支（2026-11-11 委托人授权） |
| 实现 commit | `2032e970`（`question-experience.ts` 常量＋指导文案＋测试字面量） |
| 对象 | Spec **v1.0**；SC-T1–SC-T5 |
| 复测 | `cd webui && npx vitest run server/__tests__/question-budget.test.ts server/__tests__/question-budget-continuation.test.ts server/__tests__/question-budget-window-mode.test.ts --reporter=dot` → **44 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— 默认 **60 次**／**300s 已结算忙时**（`questionBudgetWallMode()` 默认 `settled`）；续查额度仍为 **1**（`continuations >= 1` → `no_credit`）；initialize 指导 60／300 与代理一致。本轮复测 **44/44**。残余仅为 nits（见 Findings）。**本 CR 不表示可上线**／不做发布取证。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| SC-T1 第 61 次耗尽 | `QUESTION_BUDGET_MAX_CALLS = 60`；循环 60 次后 `decideConsume` 拒绝 |
| SC-T2 busyMs ≥ 300s | `QUESTION_BUDGET_MAX_BUSY_MS = 300_000`；`question-budget-window-mode`／`continuation` 夹具 |
| SC-T3 续查仍 1 次 | `consumeContinuation`：`continuations >= 1` → `no_credit`；continuation 测 44 文件内覆盖 |
| SC-T4 指导 60／300 | `webui/config/data-qa-instructions.md` L56 |
| SC-T5 `off` 开关 | `LUCY_QUESTION_BUDGET=off` 路径未改（既有 `question-budget.test.ts`） |
| 不变项 | `MAX_INFLIGHT=4`、`ABS_EXEC_MS=120_000`、默认 settled |

## Findings

### F-R1 [nit] SC-T5 未单列本轮复测文件名

`off` 断言在 broader `question-budget*.test.ts` 族；本轮仅显式跑 3 文件。不挡 PASS。

### F-R2 [nit] Spec 162 §7.2 数字与修订 Spec 双维护

合同在 threshold-relax Spec＋162；数字已一致，无代码分叉。

## 对 Spec SC 的裁定

| 范围 | 裁定 |
|---|---|
| SC-T1–SC-T5 | **接受**（常量＋指导＋本轮复测） |

## 下一步

1. W1 后续条目按 [landed 收口 Plan](../plans/lucy-20261113-landed-middev-closure-batch-plan.md) 落盘 CR。  
2. **不得**宣称可上线。
