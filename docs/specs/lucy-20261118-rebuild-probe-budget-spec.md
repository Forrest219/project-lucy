# 满量重建负载下探针预算内响应 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.6** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-47**／REQ-030-068／**P1**（事故修复；前方报告分级为 **P0-01**）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | **v0.7。终稿已确权；削峰已落地。代码：撤销 skip；写片 2–8；`write_slice`＋窗口 `delete_window`＋PASSIVE 经 rebuild worker off-thread；30 天回看不变。测试台＝**PASS**（[shave2-default](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-19-cursor-rpb-shave2-default.md) RPB-09＝3／3，livez max 7–17ms）。暂停仍为交付安全带。不入核心分母。≠ 可上线** |
| 决策来源 | 委托人 2026-11-18 要求按仓库规范为前方升级测试报告三则 P0 分别制定 Spec 与 UAT |
| 需求来源 | 前方报告 LUCY-TR-20261118-01 v1.2 §4.1 P0-01；证据 E07／E15–E18；客户事故错题 [`2026-11-17-k8s-upgrade-event-loop-readiness-timeout`](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md) |
| 实施主体 | WebUI 服务端：`webui/server/proxy/audit.ts`（重建前置事务）、`page-budget`／`yield-slices`、必要时 `inferred-turn-maintainer`。不改 Helm timeout 关单 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 [P1-38](lucy-20261117-inferred-turn-rebuild-yield-spec.md)、[P1-39](lucy-20261117-cold-start-audit-scan-spec.md)。P1-39 已写明「分配序号事务分块」等不在其原授权内——**本条单独立项承接该剩余阻塞段**。关单不得只靠放宽探针超时或缩小数据 |
| 实施计划 | [`docs/plans/lucy-20261118-rebuild-probe-budget-plan.md`](../plans/lucy-20261118-rebuild-probe-budget-plan.md) |
| 测试台 | [`UAT-SUITE-REBUILD-PROBE-BUDGET`](../qa/uat/suites/rebuild-probe-budget/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.7 | 2026-11-19 尖峰削峰 W0＋W1：保持 30 天回看；撤销 F2++ `wal_checkpoint_skip`；写片 2–8；写片＋PASSIVE 下沉 worker（OQ-2 写连接／off-thread 收口）。默认 UAT 待多跑关单；暂停仍为安全带 |
| v0.6 | 2026-11-18 FDE Track-F F2++（R07 第三轮）：`wal_autocheckpoint` 50→**25**；写片 INITIAL 4→**3**／MAX 16→**12**；片间 PASSIVE 在 residual log 已 ≤ autocheckpoint 且写片快时跳过（每 3 片强制一次）。目标收 `r07-p99-2` p99 441→≤400（实践目标 ≤380）。SC 不变；仍不得用暂停 PASS 关单；写连接分离仍不做 |
| v0.5 | 2026-11-18 FDE Track-F F2+（R07 第二轮）：`wal_autocheckpoint` 100→**50**；写片后**必** `pauseAfterStretch`；PASSIVE `busy=1` 不在写热路径重试、让出后再试一次；写片 INITIAL 8→4／MAX 25→16。目标收 F3 p99 500→≤400。SC 不变；仍不得用暂停 PASS 关单 |
| v0.4 | 2026-11-18 FDE Track-F／P1-47 B 线：OQ-2 中 `wal_autocheckpoint` 落地（默认 100 页；写片前预取 `access_log_sources`；片间 `wal_checkpoint(PASSIVE)`；`LUCY_REBUILD_TRACE=1` 分段计时）。SC 集合不变（仍 SC-01–10）；暂停仍为逃生阀。默认配置 UAT 待协调者复跑；**不得**用暂停 PASS 关单 |
| v0.3 | 2026-11-18 委托人批准暂停交付接力：SC-08–10 把运维暂停开关写入合同；出口扩至 SC-01–SC-10。暂停配置 UAT（RPB-05／06／07）单列；**暂停≠修复**；默认配置下 P1-47 仍 FAIL |
| v0.2 | 2026-11-18 委托人「授权定稿」：终稿确权＋开发授权；OQ-1＝分块事务内按簇顺序分配且不与并发 allocator 抢号；进入多 agent 并行实现。同日 Wave2 Agent-47 落地：allocate 分块＋yield；vitest 5＋回归 20；UAT 未跑 |
| v0.1-draft | 初稿。依据前方报告 P0-01 部分复现与源码同步段定位起草。终稿未确权；开发未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在约定满量／慢盘工况下，就绪后采样窗口内 `livez`／`readyz` 满足门槛，且按客户 `timeoutSeconds=3`、`failureThreshold=6` 观察模型时，连续失败次数不超过可摘端点阈值；合法用户已鉴权管理 API 在同窗口可用。
- 本条出口：SC-01–SC-10（其中 SC-08–10 为暂停交付合同；**SC-08–10 PASS 不构成 SC-01–SC-07／默认配置关单**）。
- 不在本条出口：真实 K8s EndpointSlice／OpenResty（发布取证另做）、中断自动恢复正确性（P1-45）、MCP 启动空窗（P1-46）、客户现网升级放行。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

## 交互合同豁免

- 原因：本条只改服务端重建同步段与让出策略，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/livez`／`/api/readyz`／`/api/health` 路径与响应字段含义；Chart 探针参数（关单不得靠放宽超时）

## 1. 问题陈述

P1-38／P1-39 已对读页、写片做时间预算让出；**前置整窗 DELETE + 全 plans `allocateInquiryNo` 仍在同一不可让出事务**（`audit.ts` 约 2816–2825）。前方 F：满量推断后近期用户重启，客户 3s 预算下出现 1 次 readyz 超时；高频采样另见秒级尾延迟。一次超时 ≠ Pod 已摘除，但是客户入口风险的残留证据。

## 2. 目标与非目标

**目标**

1. 定位并控制仍未让出的同步段（至少含前置删除／编号分配）。
2. 在原有探针预算下重跑满量冷启动、近期用户重建与持续业务请求。
3. 记录尾延迟与连续探针失败。

**非目标**

- 不以放宽 Helm `timeoutSeconds` 或缩小推断记录数关单。
- 不要求 CPU profile 唯一归因每一次慢请求（须证明治理后门槛达标）。

## 3. 门槛（与前方报告／UAT 冷启动建议对齐）

| 场景 | 门槛 |
|---|---|
| 重启稳态（就绪后 120s） | livez max ≤ 1000ms、p99 ≤ 400ms；readyz p99 ≤ 1500ms；全 200 |
| 首次升级补算窗口 | 沿用 P1-39 已批准放宽：livez max ≤ 2000ms、p99 ≤ 1000ms；readyz p99 ≤ 1500ms |
| 客户观察器模型 | timeout 3s；连续失败 &lt; 6 |

## 3.1 核心流程（伪代码）

```text
rebuildUnlocked(user):
  load pages with time budget + pauseAfterStretch
  cluster…
  # 治理点：下列同步段必须可分块让出，或证明单段恒 < 探针预算
  for chunk in chunked(delete_and_allocate_plans):
    transaction(chunk)
    await pauseAfterStretch(elapsed)
  for slice in write_slices:
    transaction(slice)
    await pauseAfterStretch(elapsed)

probe_window_after_ready(120s):
  sample livez/readyz at customer period
  assert consecutive_timeouts < failureThreshold
  assert p99/max within Spec table
```

## 4. 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 前置删除／编号分配不再以「单次不可让出、可无限随 plans 增长」的形态阻塞事件循环（分块或等价） |
| SC-02 | 满量推断夹具 + 慢盘冷启动后，客户周期观察器连续失败 &lt; 6 |
| SC-03 | 同窗口达到上表重启稳态门槛（或委托人书面批准的修订门槛） |
| SC-04 | 已鉴权项目／管理 API 同窗口可用，不以「只验单次 200」代替 |
| SC-05 | 不得靠预热全局缓存、缩小数据、放宽 timeout 关单 |
| SC-06 | 与 P1-45 水位方案不冲突：完整覆盖用户不无故全量重建 |
| SC-07 | 对应 UAT 必做项全真 PASS（**默认配置**下的 RPB-01／02／03；不含仅暂停配置的 05–07） |
| SC-08 | 默认未设 `LUCY_INFERRED_MAINTAINER`（或非 `off`）时行为与 v0.2 一致；设为 `off`（大小写不敏感、可 trim）时不创建后台补算维护器；`inferredRebuild` 状态如实返回 `paused: true` 且不得报 `complete: true` |
| SC-09 | 暂停配置下，满量推断夹具＋慢盘冷启动后达到上表「重启稳态」门槛（UAT-RPB-05）；**不得**据此将默认配置判定为 PASS |
| SC-10 | 暂停配置下 MCP 主路径可用：同窗循环 `initialize`→`tools/list`→一次目录／Wiki 类调用成功（UAT-RPB-06）；可行时加 `lucy_query`，接不上数据源须在跑次注明降级 |

## 5. 开放项

| ID | 问题 | 裁定 |
|---|---|---|
| OQ-1 | 编号分配分块时如何保持与并发 allocator 不抢号 | **已决**：每块短事务内仍按簇顺序 allocate；块间让出；已有 correlation_key 沿用 |
| OQ-2 | 是否引入只读 worker／`wal_autocheckpoint` | **已决（2026-11-19 削峰 Plan）**：`wal_autocheckpoint=25`＋写片前预取＋**每片后始终 PASSIVE（无 skip）**＋写片 INITIAL 2／MAX 8／MIN 1；**`write_slice`＋PASSIVE 经专用 worker off-thread**（`audit-rebuild-write-worker.mjs`）。只读通用 worker 仍不做。30 天回看不变 |
| OQ-3 | 关单是否必须含真实 K8s 摘端点 | **否**；归发布取证（UAT-RPB-04） |

## 6. 授权边界

- **终稿已确权、开发已授权（委托人 2026-11-18「授权定稿」）。**
- 实现范围见配对 Plan；不得靠放宽 Helm timeout 或缩小数据关单；不得并入「顺手扩 P1-39」叙事。
