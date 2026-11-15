# UAT-SUITE-PAGE-SWEEP — 全页面／全 GET 路由事件循环看守

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-PAGE-SWEEP` |
| 总账 ID | **P1-31**／REQ-030-052（范围外的越线整改见 **P1-32**／REQ-030-053、**P1-33**／REQ-030-054） |
| 目标 | P1-21 只守住了访问日志与概览。本套件把同一把尺子量到**每个页面、每条 GET 路由**：重读是否占住事件循环、`/api/livez` 是否仍然很快、是否出现红字或 5xx。任何新增页面或接口默认进入看守范围 |
| 合同回链 | [Plan](../../../../plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md)；[排查报告](../../../../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)；P1-21 [Spec](../../../../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-SWEEP-01、UAT-SWEEP-02、UAT-SWEEP-03 | UAT-SWEEP-04（`SWEEP_STRICT=1`：已登记越线未清零前不得发版；整改条目关闭后才变必做。基线 `tracked` 已清零，待 P1-32／P1-33 功能合同终稿复核后升必做） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 每个 `0.30` 候选构建 | `npm --prefix webui run sweep:event-loop:gate`（UAT-SWEEP-03），退出码非 0 不得出包 |
| 新增或改动任一 GET 路由、页面、审计库读路径 | 同上；新增路由默认被扫到，新增未测路由也会让门禁变红 |
| P1-32／P1-33 任一条整改落地 | UAT-SWEEP-01／02 全量，并从 `page-event-loop-sweep.baseline.json` 删掉对应登记（只减不增）。**已于 2026-11-16 执行：`tracked` 清零**；输出等价另由 [`UAT-SUITE-EQUIV-GUARD`](../audit-scale-equivalence-guard/suite.md) 守 |
| 夹具补进新数据（评测运行、语义资产操作等） | 重跑 UAT-SWEEP-02，把「未测」转成「通过」或「越线」，同样只减不增 |

## 边界

- 本套件是开发机上的全真排查，**≠** 客户现场验证，**≠** 功能合同收口，**≠** 可上线。夹具是 Apple Silicon 单用户页面加载，不是客户 amd64。
- 禁止用「已登记越线」冒充通过：UAT-SWEEP-02 只要还有登记在册的越线，结果就是 FAIL。门禁（UAT-SWEEP-03）只判断**有没有变坏**。
- 夹具里的审计账本是合成的（见 fixtures），其覆盖不到的路径写成「未测」，不能写成通过。
