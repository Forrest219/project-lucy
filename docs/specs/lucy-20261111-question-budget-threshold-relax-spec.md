# 问询预算阈值放宽 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能修订基线 / **v1.0** |
| 日期 | 2026-11-11 |
| 功能编号 / 优先级 | **修订 Spec 162 §7.2 默认阈值** / P1（体验） |
| 状态 | **已实现**（委托人 2026-11-11 批准方案二并授权改代码）；不构成客户交付／上线授权 |
| 决策来源 | 2026-11-11 委托人：保留问询预算防火墙；高频数据分析用户在次数与忙时上体验受损；选定方案二放宽默认阈值；续查次数不明显，保持 1 次 |
| 与既有 Spec 的关系 | **只改默认数字**；不改结算口径（settled busy）、作用域、续查通道、`continuable` 语义、旁路纳管、失败四维度、审计桶。权威既有合同：`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` §7.2；墙钟／续查修订见 `docs/specs/lucy-20261029-question-budget-window-optimization-spec.md` |
| 实施主体 | Lucy（Proxy 常量 + initialize 指导 + Spec／合同中的数字） |

---

## 1. 问题与目标

问询预算对 runaway Agent 仍有必要。旧默认（**20 次数据工具** 或 **120s 已结算忙时**，先到为准）对高频数据分析用户偏紧。

目标：在**保留同一套防火墙语义**的前提下，把默认额度放到方案二水平；不增加续查档数。

---

## 2. 决策（已冻结）

| 项 | 旧默认 | 方案二（现行） |
|---|---|---|
| `QUESTION_BUDGET_MAX_CALLS` | 20 | **60** |
| `QUESTION_BUDGET_MAX_BUSY_MS` / `QUESTION_BUDGET_MAX_WALL_MS` | 120_000 | **300_000**（300s） |
| 续查次数 | 1 | **不变（1）** |
| `QUESTION_BUDGET_MAX_INFLIGHT` | 4 | **不变** |
| `QUESTION_BUDGET_ABS_EXEC_MS` | 120_000 | **不变** |
| 墙钟模式默认 | `settled` | **不变** |
| 关闭开关 | `LUCY_QUESTION_BUDGET=off` | **不变** |

派生上界：

- 单窗口 Lucy 等待上界 = `MAX_BUSY_MS + MAX_INFLIGHT × ABS_EXEC_MS` = **780s**
- 一次续查后问询上界 ≈ **1560s**

---

## 3. 落点

1. `webui/server/proxy/question-experience.ts` — 常量
2. `webui/config/data-qa-instructions.md` — initialize 指导
3. `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md` §7.2／SC-4
4. 相关 vitest 改为引用常量或新字面量

---

## 4. 验收

| ID | 期望 |
|---|---|
| SC-T1 | 第 61 次数据工具（未超忙时）→ `question_budget_exhausted` |
| SC-T2 | `busyMs` ≥ 300s 后下一次准入 → `question_budget_exhausted` |
| SC-T3 | 续查仍仅 1 次 |
| SC-T4 | 指导文案为 60／300 |
| SC-T5 | `LUCY_QUESTION_BUDGET=off` 不变 |
