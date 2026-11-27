# P1-91 语义层 overlay 发布通道冲突护栏与生命周期修复 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-28（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261125-overlay-publish-guard-spec.md`](../specs/lucy-20261125-overlay-publish-guard-spec.md)（收口后 **v1.2**） |
| Plan | [`docs/plans/lucy-20261125-overlay-publish-guard-plan.md`](../plans/lucy-20261125-overlay-publish-guard-plan.md)（收口后 **v1.2**） |
| 台账号 | P1-91／REQ-030-112（挂现行 `0.30` 执行总账；不入核心分母） |
| 层级 | **功能合同** |
| 结论 | **SC-01–SC-09 全部关闭；两 UAT 缺口（GAP-OPG-08-BATCH、GAP-OPG-02-ENGINE）均已关闭；测试台套件 `UAT-SUITE-OVERLAY-PUBLISH-GUARD` 判定 PASS。** 本条收口**不表示可上线**——发布取证、客户环境验证与交付不在本条出口 |
| 授权链 | 终稿确权（委托人 2026-11-26）→ 开发授权（2026-11-26，Task 0 实证通过后落地）→ UAT 跑次（2026-11-26／27／28）→ 功能合同收口（2026-11-28） |

## 一、出口矩阵（逐条 SC → 证据落点）

证据等级：本机自动化（vitest＋tsc）＋ 隔离 Docker demo 全真跑次（纯 API＋MCP）。无 CI job 证据、无客户环境证据——均不在本条出口。

| SC | 结果 | 证据落点 |
|---|---|---|
| SC-01（三段／两段物理名契约） | 通过 | UAT-OPG-01（[主跑次](../qa/uat/suites/overlay-publish-guard/runs/2026-11-26-claude-p19x-isolated.md)：三段/两段 200＋磁盘逐字、一段/四段 `422 OVERLAY_MISSING_TABLE`「两段或三段」）；单测 `webui/server/__tests__/semantic-overlay-publish-guard.test.ts`；本跑次补验再次实证 `physicalTable="internal.p191eng.t_orders"` 逐字落盘 |
| SC-02（引擎面可执行＋读源一致） | 通过 | **GAP-OPG-02-ENGINE 已关闭**：Task 0 实证（[`inbox/p191-task0/RECORD.md`](../../inbox/p191-task0/RECORD.md)，KTX 0.16.0 三段名 `sl_query rows=[[142.5]]`）＋ 委托人 2026-11-27 明示接受该口径 ＋ **2026-11-28 引擎面补验跑次**（[2026-11-28-claude-opg02-engine-doris](../qa/uat/suites/overlay-publish-guard/runs/2026-11-28-claude-opg02-engine-doris.md)）：隔离栈＋Doris 引擎上 `lucy_query` 全链路执行 `internal.p191eng.t_orders`，`rows=[[142.5, 142.5]]`，`lucy_read_source` 逐字一致 |
| SC-03（同名 shadow warnings＋双 409＋snapshot 保留） | 通过 | UAT-OPG-03（主跑次 12 checks：validate warnings、`409 OVERLAY_MANIFEST_CONFLICT`＋`pendingConfirmations`＋`nextSteps`、未确认不落盘、同 validationId 重试成交）；2026-11-28 补验复现 `pendingConfirmations` 双确认路径 |
| SC-04（删除回落 manifest＋缓存即时刷新） | 通过 | UAT-OPG-04（主跑次 8 checks：DELETE 200、文件删净、`lucy_read_source` 回落 manifest、catalog 行为不变） |
| SC-05（删除安全边界与审计信封） | 通过 | UAT-OPG-05（主跑次 11 checks：400/404 分流、dryRun diff 不落盘、审计行 actor/相对路径/无凭据）；恢复日志中断恢复语义由 L25-16 既有管线承载，p19x 栈遗留日志的人工结账过程见补验跑次环境注记（恢复核验机制真实生效） |
| SC-06（覆盖门禁＋plans 409/404 区分） | 通过 | UAT-OPG-06（主跑次 9 checks：覆盖 409→确认重试成交、双 409 `["confirmOverwrite","allowManifestShadow"]` 单次组合确认、`409 PLAN_PREVIEW_NOT_AVAILABLE` 与 `404 VALIDATION_SNAPSHOT_NOT_FOUND` 分流） |
| SC-07（只读盘点＋merge_overlay 防误删） | 通过 | UAT-OPG-07（主跑次 11 checks：standalone/merge 分类、未知参数 400、未确认删除 `409 OVERLAY_BUSINESS_ENRICHMENT_PROTECTED`、确认后删除回落） |
| SC-08（回归：表编辑器／manifest 通道／batch round-trip／幂等回放） | 通过 | UAT-OPG-08（主跑次普通发布回归）＋ **GAP-OPG-08-BATCH 已关闭**（[2026-11-27-claude-opg08-batch](../qa/uat/suites/overlay-publish-guard/runs/2026-11-27-claude-opg08-batch.md)：维护包 scopes→export→download→validate(staged)→publish 带 `planDigest` 真实 round-trip 全绿＋审计双路取证）＋ 既有 `api.semantic-batch` 套件全绿 |
| SC-09（文档登记） | 通过 | 文档审查（2026-11-28）：`webui/docs/03-api-spec.md` 已登记 overlay 物理名规则（:735）、shadow warnings（:737）、双 409 门禁（:747–753）、plans 409/404（:818）、盘点与受控删除端点及合同回链（:836–838，路由索引 :178–179）；`docs/SYSTEM_HANDBOOK.md` 已登记「publish overlay＝发布独立命名 source，不是新表接收入口」指引（:520）及与 P1-90 分工段交叉引用 |

## 二、状态与镜像

- Spec 阶段 `S4` → **`S5`**（功能合同已收口）；状态行同批改齐（本收口记录为现值锚点）。
- 配套镜像同批更新：Plan 状态行、`docs/README.md`、`docs/plans/README.md`、需求池 `docs/backlog/README.md`（REQ-030-112 阶段列）、[`docs/governance/e2e-ledger.md`](../governance/e2e-ledger.md) P1-91 行、测试台 [`docs/qa/uat/INDEX.md`](../qa/uat/INDEX.md) 套件行与 [suite.md](../qa/uat/suites/overlay-publish-guard/suite.md) runs 行。
- `docs/governance/project-overview.md` §9 无本条索引行，按「没有索引行就不新造」不新增。

## 三、边界与遗留

- **≠ 可上线**：发布取证层（组合／拓扑／客户环境）不在本条出口；客户 SQL Server 三段名场景的现场复核归交付层。
- **F2 观察项**（不阻塞）：batch 审计行 `write_status=pending` 在 config-audit API 不可见，维持观察。
- 测试夹具遗留（一次性 lab）：p19x 栈 `uat-doris-eng` 连接＋同名遮蔽 standalone、Doris lab 容器/卷；探针 Agent 处置移交委托人。
- 本条与 P1-89／P1-90 的 `semantic-layer.ts` vs `semantic-assets.ts` 零交叉边界在收口时复核成立。
