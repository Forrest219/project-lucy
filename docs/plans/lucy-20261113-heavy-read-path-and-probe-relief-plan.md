# 重读路径与探针减负 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **未获委托人开发授权前不得改运行代码。**

| 元数据 | 内容 |
|---|---|
| 状态 | **功能合同已收口（2026-11-13）**。委托人将 SC-14 `/api/livez` p99 门槛从 300ms 调整为 400ms。实测 p99 359ms、max 487ms、BUSY＝0；`/turns?hours=168` p95 105ms。未启用 worker。O2 只改本分支。测试台 `UAT-SUITE-EVENT-LOOP-RELIEF`＝**PASS**（必做 R0／01–04；可选 LOOP-05 BLOCKED——客户 0.25 无 livez）。≠ 可上线 |
| 主 Spec | [`docs/specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md`](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md) **v0.1-draft** |
| 总账 | **P1-21**／REQ-030-042；**不入核心分母**；事故修复 |
| 授权边界 | 只改：推断问询重建触发位置、问询补充字段取数方式、审计投影读路径、`/api/diff` 扫描次数、健康／探针接口、Chart 探针默认值与相关门禁脚本。不改：KTX、页面与文案、推断聚类算法与回看窗口、展示快照 BUSY 语义、`/api/admin/agents`、既有接口字段含义 |
| 验收 | Spec SC-01–SC-16 |

## 目标

客户规模审计数据下，读接口不再长时间占住事件循环；Pod 不再被 liveness 误杀；系统概览不再因核对过期报 BUSY；所有接口返回与改前一致。

**Architecture:** 把「读时重建」「读时追投影」移到后台分片执行（复用 `createProjectionScheduler` 模式）；N+1 改集合查询；`/api/diff` 一次扫描；探针拆成无 I/O 的 `/api/livez` 与读缓存的 `/api/readyz`。先做算法减负，worker 线程仅作 O1 后备。

**Tech Stack:** Fastify、`better-sqlite3`（WAL）、Vitest、`perf_hooks.monitorEventLoopDelay`、Helm。

## 开工前置

- [ ] Spec v0.1 终稿确权（Codex CLI 终审，或委托人明示确权）
- [ ] 委托人裁决 O1（worker 后备时机）、O2（是否回补 `lucy-v0.25`）
- [ ] 委托人**另发开发授权**；总账 P1-21 跟进状态改「开发中」同句镜像
- [ ] 无授权则停止；不得改 `webui/server/**`、`deploy/k8s/**`

## 1. 文件地图

| 文件 | 职责 | SC |
|---|---|---|
| `webui/server/admin/inferred-turn-maintainer.ts`（新） | 后台推断问询维护器：水位轮询、脏用户、分片重建、状态 | SC-03 |
| `webui/server/admin/audit.ts` | `listAuditTurnEntries` 去读时重建、批量补充字段；`auditProjectionStatus` 只读状态；补索引；回退开关 | SC-01／04–08／16 |
| `webui/server/admin/access-map-echo.ts` | 读路径不再重建 | SC-02 |
| `webui/server/security/projector.ts` | 导出 `projectionStatus` 只读入口（如未导出） | SC-07 |
| `webui/server/index.ts` | 启动维护器；`/api/diff` 一次扫描；`/api/livez`、`/api/readyz`；`/api/health` 读缓存＋`eventLoop` | SC-09–12 |
| `webui/server/publish-*.ts` | `readPublishEvidence` 接受外部传入的扫描结果 | SC-09 |
| `webui/server/ktx-runtime.ts`、`admin/mcp-runtime.ts`、`content-layout.ts` | 后台缓存 | SC-12 |
| `webui/server/runtime/event-loop-delay.ts`（新） | 事件循环延迟滚动窗口 | SC-12／14 |
| 鉴权白名单（放行 `/api/health` 处） | 放行 `/api/livez`、`/api/readyz` | SC-10／11 |
| `webui/tests/performance/fixtures/audit-scale-fixture.ts`（新）、`webui/scripts/event-loop-relief-perf.mts`（新，`npm run perf:event-loop-relief`） | 客户规模合成夹具与负载场景（沿用 `perf:entry` 的 tsx 脚本形态） | SC-13／14 |
| `deploy/k8s/helm/lucy/values.yaml`、`Chart.yaml`、`UPGRADE.md`、`README.md` | 探针默认值、Chart 版本、升级提示 | SC-15 |
| `deploy/k8s/K8S_CONTRACT.md`、`scripts/gates/helm-lucy-gate.sh`、`k8s-acceptance.sh`、`deploy/k8s/gate/values.gate-ci.yaml`、`examples/values.local-test.yaml` | 合同与门禁同步 | SC-15 |
| `docs/governance/test-layers-and-release-gates.md` | 登记新增 perf 命令 | — |

## 2. 任务

### Task 1：基线与等价性夹具（先红／先锁）

- [ ] 写 `tests/performance/fixtures/audit-scale-fixture.ts`：参数化生成 `access_log`／`access_log_sources`／`conversation_turns`（默认 30 天 115,000 条、67 用户 Zipf 分布、183 表、含报告型问询与错误／拒绝结果），种子固定
- [ ] 在**改前代码**上用小规模夹具录制 golden：`/turns` 代表矩阵（SC-04）、导出（SC-05）、`/api/diff`（SC-09，≥17 个待发布文件）
- [ ] 写 SC-01／02／06／07／09／10／12 的 spy 测试，确认当前为红

```bash
cd webui && npx vitest run server/__tests__/event-loop-relief-*.test.ts
```

### Task 2：探针与健康接口（独立，可先合）

- [ ] `event-loop-delay.ts`：`monitorEventLoopDelay`，60s 滚动 p99／max
- [ ] `/api/livez`：无 I/O；`/api/readyz`：预热标志＋缓存状态；放行鉴权
- [ ] `readKtxRuntimeStatus` 改为启动取一次＋60s 后台刷新；`contentLayout` 30s 缓存；MCP 探测后台刷新
- [ ] `/api/health` 追加 `eventLoop`，其余字段不变
- [ ] SC-10／11／12 转绿

### Task 3：审计投影读路径只读

- [ ] `auditProjectionStatus` 改读状态＋`scheduler.trigger()`；导出路径同改（或单片上限）
- [ ] SC-07 转绿；跑既有 `audit-snapshot`、`proxy-audit`、`admin-audit` 测试

### Task 4：推断问询维护器

- [ ] 新建维护器（启动全量扫描、10s 水位轮询、不重叠、失败保留脏标记＋退避、`status()`）
- [ ] 管理侧初始化补建 `access_log(ts)`、`access_log(lucy_turn_id)` 索引（SC-16）
- [ ] `listAuditTurnEntries`、`access-map-echo` 去掉读时重建；响应追加 `inferredRebuild`；`LUCY_TURN_REBUILD_ON_READ=1` 回退
- [ ] SC-01／02／03／08／16 转绿；SC-04／05 golden 一致（维护器跑完后比对）

### Task 5：问询补充字段批量化

- [ ] `enrichTurnEntry` 系列改为对 ID 集合的批量查询（`json_each`），保留过滤／排序／分页顺序
- [ ] SC-06 转绿；SC-04／05 golden 仍一致

### Task 6：`/api/diff` 一次扫描

- [ ] `readPublishEvidence` 增加可选扫描结果参数；`/api/diff` 请求内复用扫描与内容布局；证据读取并发 ≤ 4
- [ ] SC-09 转绿（spy＋golden）

### Task 7：客户规模性能验收

- [x] `scripts/event-loop-relief-perf.mts`：起真实 Fastify 实例＋客户规模夹具，跑 SC-13（`/turns?hours=168` p95 ≤ 3s）、SC-14（60s 负载：`/api/livez` max ≤ 1,000ms、p99 ≤ 400ms；概览三接口 BUSY＝0）。2026-11-13 实测 p99 359ms，委托人确认通过
- [ ] 结果写入 `docs/reviews/YYYY-MM-DD-heavy-read-path-relief-perf-evidence.md`
- [ ] **未达标** → 停止，提交数据给委托人按 O1 决定是否启用 worker，不自行扩 scope

```bash
cd webui && npm run perf:event-loop-relief
```

### Task 8：Chart 与部署合同

- [ ] `values.yaml` 探针按 Spec §4.5；`Chart.yaml` 版本递增（产品版本不变）
- [ ] `K8S_CONTRACT.md`、`UPGRADE.md`（自定义探针 values 须改挂）、`README.md`、gate／local-test values
- [ ] `helm-lucy-gate.sh`、`k8s-acceptance.sh` 断言新路径
- [ ] `helm template` 渲染核对（SC-15）

### Task 9：回归与文档镜像

- [ ] 全量相关测试：

```bash
cd webui && npx vitest run server/__tests__/admin-audit.test.ts server/__tests__/audit-snapshot.test.ts \
  server/__tests__/proxy-audit.test.ts server/__tests__/p1-access-map*.test.ts \
  server/__tests__/display-*.test.ts server/__tests__/usage-metrics-cross-page.test.ts
cd .. && npm run lint:spec-docs
```

- [ ] `test-layers-and-release-gates.md` 登记 perf 命令
- [ ] Spec／Plan／总账／需求池／索引状态同句镜像；撰写 SC 证据审计
- [ ] 测试台：新建客户场景 UAT 套件（客户实例复测 `/turns?hours=168` 与 Pod 重启次数）前，总账与 Spec 保持 `UAT: not_registered`

## 浏览器验证

不适用：本条只改服务端与部署探针，不改变用户可见 WebUI 表面；验收以 vitest、性能夹具与 Chart 渲染为准。

## 验收

Spec SC-01–SC-16 全部有证据；性能证据文件落 `docs/reviews/`。

## 完成定义

- SC-01–SC-16 通过并有证据审计
- Spec／Plan 状态改为功能合同已收口，总账同句镜像
- 不表示可上线；客户现场复测归测试台

## 风险与回滚

| 风险 | 缓解／回滚 |
|---|---|
| 批量化改写导致结果差异 | golden 逐字段比对；不一致不合并 |
| 后台维护器异常导致访问日志过时 | `inferredRebuild.complete=false` 可读；`LUCY_TURN_REBUILD_ON_READ=1` 回退旧行为 |
| 探针改挂引发新的启动失败 | `/api/readyz` 预热超时 60s 兜底；Chart 回退到上一版本即恢复 `/api/health` 探针 |
| SC-14 不达标 | 按 O1 由委托人决定 worker；不在本 Plan 内自行引入 |
| Task 2 与其余任务耦合 | Task 2 独立可先合，单独回滚 |

## 非本 Plan

预聚合汇总表；`/api/admin/agents` 提速；页面「同步中」提示；客户现场 UAT 执行；多副本部署。
