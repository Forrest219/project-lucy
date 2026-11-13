# UAT-SUITE-EVENT-LOOP-RELIEF — 重读路径与存活探针

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-EVENT-LOOP-RELIEF` |
| 总账 ID | **P1-21**／REQ-030-042 |
| 目标 | 持续看守 2026-11-13 事故：客户规模审计数据下，7 天访问日志把事件循环占住，Pod 被 liveness 误杀，系统概览出现「页面数据暂时无法完成刷新」 |
| 合同回链 | [Spec](../../../../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) SC-13／SC-14／SC-15；[Plan](../../../../plans/lucy-20261113-heavy-read-path-and-probe-relief-plan.md)；[性能证据](../../../../reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-LOOP-01、UAT-LOOP-02、UAT-LOOP-03、UAT-LOOP-04 | UAT-LOOP-05（已部署含 `/api/livez` 的镜像之后，在维护窗跑；0.25 无此路由时记 BLOCKED） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 每个包含本修复的 `0.30` 候选构建 | UAT-LOOP-01、UAT-LOOP-03 |
| 本机 demo 升级或重建之后 | UAT-R0、UAT-LOOP-02、UAT-LOOP-04 |
| 客户或预发镜像升级到带 `/api/livez` 的版本后 | 维护窗跑一次 UAT-LOOP-05 |
| 其后审计库明显变大，或再次出现概览红字、存活探针重启 | 重跑 UAT-LOOP-01；若在已升级实例上，再跑 UAT-LOOP-05 |
| 实例仍是没有 `/api/livez` 的 0.25 | UAT-LOOP-05 记 BLOCKED。不要把 Chart `0.2.9` 的存活探针改挂上去 |

## 边界

- 本套件是客户场景看守，**≠** 功能合同收口，**≠** 可上线。
- 开发机上的 `perf:event-loop-relief` 证据不能写成 INDEX PASS。INDEX 只认本套件 `runs/`。
- demo 的小审计库盖不住 11 万条调用。UAT-LOOP-02 只看守探针和概览红字；规模门槛只认 UAT-LOOP-01。
- 禁止在业务高峰对客户实例发 `GET /api/admin/audit/turns?hours=168`。
