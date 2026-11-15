# UAT-SUITE-EQUIV-GUARD — 审计与概览读路径等价守卫（防旧病复发）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-EQUIV-GUARD` |
| 总账 ID | **P1-32**／REQ-030-053、**P1-33**／REQ-030-054（整改）；同一把尺子的看守面见 `UAT-SUITE-PAGE-SWEEP`（P1-31） |
| 目标 | 整改把 F-1…F-7 的慢路径改成了集合式、分块、让出事件循环的写法。本套件保证：**以后任何升级迭代动到这些路径，输出必须与改前逐字等价，且不得把慢路径改回去**。等价靠冻结的旧实现／改前金样本，不靠「我觉得没变」 |
| 合同回链 | [Spec](../../../../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)；排查来源 [排查报告](../../../../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)；性能看守 [UAT-SUITE-PAGE-SWEEP](../page-event-loop-sweep/suite.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-EQ-R0、UAT-EQ-01、UAT-EQ-02、UAT-EQ-03 | UAT-EQ-04（变异自检：故意复发旧病，守卫必须红） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改动 [fixtures.md](fixtures.md)「受守卫文件」任一文件，或新增调用它们的路由 | UAT-EQ-01／02（`npm --prefix webui run test:equivalence`，秒级）；**红灯不得合入** |
| 每个 `0.30` 候选构建 | UAT-EQ-01／02＋`UAT-SUITE-PAGE-SWEEP` 的 UAT-SWEEP-03（`sweep:event-loop:gate`）。EQ-03 与之同跑 |
| 想改金样本或冻结旧实现 | 先在 Spec changelog 记委托人批准的行为变更，再 `UPDATE_EQUIVALENCE_GOLDEN=1` 重生并递增 `goldenRevision`；禁止为让红灯变绿而重生 |
| 新发现一条同类慢路径（同步 SQLite／整表扫／无界 `IN`） | 先入总账，再在 `equivalence-manifest.test.ts` 登记新条目（冻结旧实现＋测试），之后才改运行代码 |

## 边界

- 本套件是**开发机上的自动化回归守卫**（vitest），**≠** 客户现场验证，**≠** 功能合同收口，**≠** 可上线。
- 等价测试证明「输出没变」，**不**证明「不卡」；不卡由 UAT-EQ-03（性能门禁）与 `UAT-SUITE-PAGE-SWEEP` 证明。两者缺一不可。
- 冻结旧实现里允许保留旧的慢写法（它们只在测试里作为对照），**不得**被运行代码 import。
